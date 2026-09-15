import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const accountId = process.argv[2];
if (!/^[a-f0-9]{32}$/i.test(accountId || ''))
  throw new Error('Usage: npm run setup:github -- CLOUDFLARE_ACCOUNT_ID');
function gh(args, input) {
  const result = spawnSync('gh', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0)
    throw new Error(
      'GitHub configuration failed. Check gh auth status and repository permissions.',
    );
  return result.stdout;
}
const existing = JSON.parse(gh(['secret', 'list', '--json', 'name']));
if (!existing.some((secret) => secret.name === 'CLOUDFLARE_API_TOKEN'))
  throw new Error(
    'First add CLOUDFLARE_API_TOKEN in GitHub repository secrets, or run gh secret set CLOUDFLARE_API_TOKEN.',
  );
let secrets;
try {
  secrets = JSON.parse(await readFile('secrets.local.json', 'utf8'));
} catch {
  throw new Error('Run npm run setup:local first.');
}
for (const name of ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON']) {
  if (typeof secrets[name] !== 'string' || !secrets[name])
    throw new Error('Missing local setting ' + name);
}
for (const name of ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON'])
  gh(['secret', 'set', name], secrets[name]);
// Enable deployments only after both Google secrets are uploaded successfully.
gh(['variable', 'set', 'CLOUDFLARE_ACCOUNT_ID', '--body', accountId]);
console.log(
  'GitHub secrets and account ID configured. No credential values were printed.',
);
console.log('Run gh workflow run cloudflare.yml --ref main to deploy.');
