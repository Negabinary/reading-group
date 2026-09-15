import { ApiError } from './errors';

export interface GoogleEnv {
  GOOGLE_SHEET_ID: string;
  GOOGLE_SERVICE_ACCOUNT_JSON: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function encode(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** One client per sheet coordinator; only the OAuth token is cached, never sheet data. */
export class GoogleSheets {
  private token?: { value: string; expires: number };
  private signingKey?: CryptoKey;
  constructor(
    private env: GoogleEnv,
    private fetcher: typeof fetch = fetch.bind(globalThis),
  ) {}

  private async accessToken(signal: AbortSignal): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60000)
      return this.token.value;
    let account: { client_email: string; private_key: string };
    try {
      account = JSON.parse(this.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      if (
        !account.client_email?.endsWith('.iam.gserviceaccount.com') ||
        !account.private_key?.includes('BEGIN PRIVATE KEY')
      )
        throw new Error();
      if (!this.signingKey) {
        const pem = account.private_key
          .replace(/-----[^-]+-----/g, '')
          .replace(/\s/g, '');
        this.signingKey = await crypto.subtle.importKey(
          'pkcs8',
          Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['sign'],
        );
      }
    } catch {
      throw new ApiError(
        'The Google service account is not configured. Ask the organizer to finish the Cloudflare setup.',
        503,
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      this.signingKey,
      new TextEncoder().encode(unsigned),
    );
    const response = await this.fetcher(TOKEN_URL, {
      method: 'POST',
      signal,
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
      }),
    });
    if (!response.ok)
      throw new ApiError(
        'Google could not authenticate the service account. Ask the organizer to check its key.',
        503,
      );
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token || !Number.isFinite(data.expires_in))
      throw new ApiError(
        'Google returned an invalid authentication response.',
        502,
      );
    this.token = {
      value: data.access_token,
      expires: Date.now() + data.expires_in! * 1000,
    };
    return this.token.value;
  }

  async request<T>(
    suffix: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    if (!/^[\w-]+$/.test(this.env.GOOGLE_SHEET_ID || ''))
      throw new ApiError(
        'The Google Sheet ID is not configured. Ask the organizer to finish the Cloudflare setup.',
        503,
      );
    const token = await this.accessToken(signal);
    const response = await this.fetcher(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.env.GOOGLE_SHEET_ID}${suffix}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        signal,
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    // Never echo Google's response body (which can include credential/project details).
    // Never retry a write: a lost response does not prove it wasn't committed.
    if (response.status === 401) {
      this.token = undefined;
      throw new ApiError(
        'Google authentication expired. Refresh and check your change before trying again.',
        503,
      );
    }
    if (response.status === 403 || response.status === 404)
      throw new ApiError(
        'The service account cannot access the reading group sheet. Check the Sheet ID, Editor sharing, and that the Sheets API is enabled.',
        503,
      );
    if (response.status === 429)
      throw new ApiError(
        'Google Sheets is receiving too many requests. Please wait a minute before refreshing.',
        429,
      );
    if (!response.ok)
      throw new ApiError(
        'Google Sheets could not complete this request. Refresh to check whether your change was saved before trying again.',
        502,
      );
    return response.json() as Promise<T>;
  }
}
