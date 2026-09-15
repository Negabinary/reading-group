export type ApiAction =
  'getState' | 'searchPapers' | 'signIn' | 'setVote' | 'suggestPaper';

export async function requestApi<T>(
  action: ApiAction,
  args: unknown[],
): Promise<T> {
  const url = new URL('/api', window.location.origin);
  const reading = action === 'getState' || action === 'searchPapers';
  const options: RequestInit = {
    method: reading ? 'GET' : 'POST',
    mode: 'same-origin',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(45000),
  };
  if (reading) {
    url.searchParams.set('action', action);
    if (action === 'searchPapers')
      url.searchParams.set('query', String(args[0]));
  } else {
    options.headers = { 'Content-Type': 'application/json' };
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
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) throw new Error(unavailable);
    throw new Error(
      'The reading group API did not return JSON. Check the Cloudflare deployment.',
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
      'The reading group API needs updating. Deploy the latest Cloudflare Worker.',
    );
  }
  if (
    payload.ok === false &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    throw new Error(payload.error);
  }
  if (!response.ok) throw new Error(unavailable);
  if (payload.ok !== true || !('data' in payload)) {
    throw new Error(
      'The reading group API returned an invalid response. Please try Refresh.',
    );
  }
  return payload.data as T;
}
