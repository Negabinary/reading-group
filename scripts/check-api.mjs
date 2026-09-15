// No sign-in, vote, or suggestion. getState can assign missing stable IDs.
const base =
  process.argv[2] || process.env.DEPLOYMENT_URL || 'http://127.0.0.1:8787';
const url = new URL('/api', base);
if (
  url.protocol !== 'https:' &&
  !(
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname)
  )
)
  throw new Error('Provide an HTTPS site URL, or a local preview URL.');
async function read(action) {
  url.searchParams.set('action', action);
  const start = performance.now();
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      'API ' + action + ' returned HTTP ' + response.status + ' without JSON.',
    );
  }
  if (!response.ok || body?.apiVersion !== 1 || body.ok !== true)
    throw new Error(
      body?.error || 'API ' + action + ' failed: HTTP ' + response.status,
    );
  console.log(
    action +
      ': HTTP ' +
      response.status +
      ', ' +
      Math.round(performance.now() - start) +
      ' ms',
  );
  return body.data;
}
const health = await read('health');
if (
  health?.service !== 'mplse-reading-group' ||
  health.backend !== 'google-sheets'
)
  throw new Error('This is not the Cloudflare + Sheets API.');
const state = await read('getState');
if (
  !Array.isArray(state?.members) ||
  !Array.isArray(state?.papers) ||
  typeof state?.today !== 'string'
)
  throw new Error('API returned an invalid group state.');
console.log(
  'Connected: ' +
    state.papers.length +
    ' papers, ' +
    state.members.length +
    ' members. No votes or suggestions changed.',
);
