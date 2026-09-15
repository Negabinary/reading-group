import { loadEnv } from 'vite';
import { validateApiUrl } from '../src/api-config.ts';

// No sign-ins, votes, or suggestions. This checks the deployed API before Pages
// publishes a frontend configured to use it; browser CORS still needs a real check.
const env = loadEnv('production', process.cwd(), 'VITE_');
const endpoint = validateApiUrl(env.VITE_APPS_SCRIPT_URL || '');
async function read(action) {
  const url = new URL(endpoint);
  url.searchParams.set('action', action);
  url.searchParams.set('_', crypto.randomUUID());
  const response = await fetch(url, {
    redirect: 'follow',
    credentials: 'omit',
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok)
    throw new Error(
      `API ${action} returned HTTP ${response.status}. Check anonymous access.`,
    );
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      'API returned HTML or invalid JSON. Deploy the API Code.gs with access set to Anyone.',
    );
  }
  if (body?.apiVersion !== 1 || body.ok !== true) {
    throw new Error(
      body?.error || 'Expected version 1 of the reading group API.',
    );
  }
  return body.data;
}

const health = await read('health');
if (health?.service !== 'mplse-reading-group')
  throw new Error('This is not the reading group API.');
const state = await read('getState');
if (
  !Array.isArray(state?.members) ||
  !Array.isArray(state?.papers) ||
  typeof state?.today !== 'string'
) {
  throw new Error('API returned an invalid group state.');
}
console.log(
  `API connected: ${state.papers.length} papers, ${state.members.length} members.`,
);
