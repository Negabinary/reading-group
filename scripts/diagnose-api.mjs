import { createHash, randomUUID } from 'node:crypto';
import { loadEnv } from 'vite';
import { validateApiUrl } from '../src/api-config.ts';

// Follow each response separately to distinguish script execution from Google's
// Content Service delivery. Never print response bodies or temporary URLs.
const env = loadEnv('production', process.cwd(), 'VITE_');
const endpoint = validateApiUrl(env.VITE_APPS_SCRIPT_URL || '');
const rounds = Number(process.argv[2] || 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5)
  throw new Error('Use npm run diagnose:api -- N, where N is 1–5 rounds.');
const allowedHosts = new Set([
  'script.google.com',
  'script.googleusercontent.com',
]);

async function probe(action, round) {
  let url = new URL(endpoint);
  url.searchParams.set('action', action);
  url.searchParams.set('_', randomUUID());
  const started = performance.now();
  const signal = AbortSignal.timeout(45000);
  for (let hop = 0; hop < 5; hop++) {
    const record = {
      round,
      action,
      hop,
      startedAt: new Date().toISOString(),
      host: url.hostname,
    };
    const hopStarted = performance.now();
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        credentials: 'omit',
        signal,
      });
      record.status = response.status;
      record.headersMs = Math.round(performance.now() - hopStarted);
      record.contentType = response.headers.get('content-type');
      record.allowOrigin = response.headers.get('access-control-allow-origin');
      record.responseDate = response.headers.get('date');
      const body = await response.text();
      record.totalMs = Math.round(performance.now() - started);
      const location = response.headers.get('location');
      if (location && [301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(location, url);
        record.redirectHost = next.hostname;
        if (next.protocol !== 'https:' || !allowedHosts.has(next.hostname)) {
          record.failure = 'Redirect left the expected API hosts.';
          console.log(JSON.stringify(record));
          return false;
        }
        console.log(JSON.stringify(record));
        url = next;
        continue;
      }
      record.bytes = Buffer.byteLength(body);
      record.bodyHash = createHash('sha256')
        .update(body)
        .digest('hex')
        .slice(0, 12);
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        record.failure = 'Response was not JSON.';
      }
      record.apiOk = payload?.apiVersion === 1 && payload?.ok === true;
      if (!response.ok) record.failure = `HTTP ${response.status}`;
      else if (!record.apiOk)
        record.failure ||= 'API reported an error or invalid envelope.';
      else if (action === 'getState') {
        record.papers = payload.data?.papers?.length;
        record.members = payload.data?.members?.length;
        if (
          !Array.isArray(payload.data?.papers) ||
          !Array.isArray(payload.data?.members) ||
          typeof payload.data?.today !== 'string'
        )
          record.failure = 'API returned an invalid group state.';
      } else if (payload.data?.service !== 'mplse-reading-group') {
        record.failure = 'API returned an unexpected health response.';
      }
      console.log(JSON.stringify(record));
      return !record.failure;
    } catch (error) {
      record.failure = error.name;
      record.totalMs = Math.round(performance.now() - started);
      console.log(JSON.stringify(record));
      return false;
    }
  }
  console.log(
    JSON.stringify({ round, action, failure: 'Too many redirects.' }),
  );
  return false;
}

let failed = false;
for (let round = 1; round <= rounds; round++) {
  for (const action of ['health', 'getState']) {
    if (!(await probe(action, round))) failed = true;
  }
}
if (failed) process.exitCode = 1;
