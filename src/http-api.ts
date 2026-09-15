import { validateApiUrl } from './api-config';

export type ApiAction =
  'getState' | 'searchPapers' | 'signIn' | 'setVote' | 'suggestPaper';

export async function requestApi<T>(
  endpoint: string,
  action: ApiAction,
  args: unknown[],
): Promise<T> {
  const url = new URL(validateApiUrl(endpoint));
  const reading = action === 'getState' || action === 'searchPapers';
  const options: RequestInit = {
    method: reading ? 'GET' : 'POST',
    mode: 'cors',
    credentials: 'omit',
    redirect: 'follow',
    signal: AbortSignal.timeout(45000),
  };
  if (reading) {
    url.searchParams.set('action', action);
    if (action === 'searchPapers')
      url.searchParams.set('query', String(args[0]));
    // Keep sheet reads fresh without adding a header that triggers CORS preflight.
    url.searchParams.set('_', crypto.randomUUID());
  } else {
    // Apps Script has no OPTIONS handler. text/plain keeps this a simple CORS
    // request; the body is still JSON and the response must remain readable.
    options.headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
    options.body = JSON.stringify({ action, args });
  }

  const unavailable = reading
    ? 'Could not reach the reading group. Please try Refresh.'
    : 'Could not confirm your change. Refresh to check whether it was saved before trying again.';
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(url.toString(), options);
  } catch {
    throw new Error(unavailable);
  }
  if (!response.ok) throw new Error(unavailable);
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      'The reading group API did not return JSON. Check its deployment URL and anonymous access settings.',
    );
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('apiVersion' in payload) ||
    payload.apiVersion !== 1 ||
    !('ok' in payload)
  ) {
    throw new Error(
      'The reading group API needs updating. Deploy the latest Code.gs.',
    );
  }
  if (
    payload.ok === false &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    throw new Error(payload.error);
  }
  if (payload.ok !== true || !('data' in payload)) {
    throw new Error(
      'The reading group API returned an invalid response. Please try Refresh.',
    );
  }
  return payload.data as T;
}
