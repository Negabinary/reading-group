import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import { GoogleSheets } from '../worker/google';

export function testAccount() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    publicKey,
    json: JSON.stringify({
      client_email: 'reading-group@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://never-use-this.example/token',
    }),
  };
}

test('Google OAuth signs a scoped JWT, uses fixed Google endpoints and caches only the token', async () => {
  const account = testAccount();
  let tokens = 0,
    reads = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokens++;
      const form = new URLSearchParams(init!.body as URLSearchParams);
      const [header, claims, signature] = form.get('assertion')!.split('.');
      assert.equal(
        JSON.parse(Buffer.from(header, 'base64url').toString()).alg,
        'RS256',
      );
      const payload = JSON.parse(Buffer.from(claims, 'base64url').toString());
      assert.equal(
        payload.scope,
        'https://www.googleapis.com/auth/spreadsheets',
      );
      assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
      assert.equal(payload.exp - payload.iat, 3600);
      assert.equal(
        verify(
          'RSA-SHA256',
          Buffer.from(`${header}.${claims}`),
          account.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
        true,
      );
      return Response.json({ access_token: 'test-token', expires_in: 3600 });
    }
    reads++;
    assert.equal(
      new Headers(init!.headers).get('Authorization'),
      'Bearer test-token',
    );
    assert.ok(
      String(url).startsWith(
        'https://sheets.googleapis.com/v4/spreadsheets/sheet-id?',
      ),
    );
    return Response.json({ read: reads });
  };
  const google = new GoogleSheets(
    { GOOGLE_SHEET_ID: 'sheet-id', GOOGLE_SERVICE_ACCOUNT_JSON: account.json },
    fetcher,
  );
  assert.deepEqual(
    await google.request('?fields=test', AbortSignal.timeout(5000)),
    { read: 1 },
  );
  assert.deepEqual(
    await google.request('?fields=test', AbortSignal.timeout(5000)),
    { read: 2 },
  );
  assert.equal(tokens, 1);
});

test('Google errors hide provider details and never repeat uncertain writes', async () => {
  const account = testAccount();
  for (const status of [401, 403, 404, 429, 500]) {
    let writes = 0;
    const google = new GoogleSheets(
      {
        GOOGLE_SHEET_ID: 'sheet-id',
        GOOGLE_SERVICE_ACCOUNT_JSON: account.json,
      },
      async (url) => {
        if (url === 'https://oauth2.googleapis.com/token')
          return Response.json({ access_token: 'token', expires_in: 3600 });
        writes++;
        return new Response('SENSITIVE_PROVIDER_DETAIL', { status });
      },
    );
    await assert.rejects(
      google.request(':batchUpdate', AbortSignal.timeout(5000), {
        requests: [],
      }),
      (error: any) => {
        assert.ok(!error.message.includes('SENSITIVE_PROVIDER_DETAIL'));
        assert.equal(
          error.status,
          status === 429 ? 429 : status === 500 ? 502 : 503,
        );
        return true;
      },
    );
    assert.equal(writes, 1);
  }
});
