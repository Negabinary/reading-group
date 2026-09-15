import { readFile, writeFile } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';

// Credentials are read from a local file, never placed in shell arguments/logs.
const [keyPath, sheet] = process.argv.slice(2);
if (!keyPath || !sheet) {
  console.error(
    'Setup needs two arguments: the downloaded JSON key file path and your Google Sheet URL.',
  );
  console.error(
    '\nRun this as one command, replacing both example values:\n' +
      'npm run setup:local -- "/Users/matt/Downloads/YOUR_KEY_FILE.json" "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"',
  );
  console.error(
    '\nKeep the -- and quote both arguments, especially paths containing spaces. No files were changed.',
  );
  process.exit(1);
}
const sheetId =
  sheet.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:\/|$)/,
  )?.[1] || sheet;
if (!/^[\w-]+$/.test(sheetId))
  throw new Error('Provide the Google Sheet URL or its spreadsheet ID.');
let account;
try {
  account = JSON.parse(await readFile(keyPath, 'utf8'));
} catch {
  throw new Error(
    'Could not read the service account JSON file. Check its path and format.',
  );
}
if (
  !/^[a-z0-9-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(
    account.client_email || '',
  ) ||
  !/^[A-Za-z0-9+/=\s-]+$/.test(account.private_key || '')
)
  throw new Error('Expected a Google service account JSON key.');
try {
  if (createPrivateKey(account.private_key).asymmetricKeyType !== 'rsa')
    throw new Error();
} catch {
  throw new Error(
    'The service account file does not contain a valid RSA private key.',
  );
}
const secrets = {
  GOOGLE_SHEET_ID: sheetId,
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: account.client_email,
    private_key: account.private_key,
  }),
};
// Single-quoted dotenv values preserve the JSON's literal backslash-n sequences.
await writeFile(
  '.dev.vars',
  Object.entries(secrets)
    .map(([name, value]) => `${name}='${value}'`)
    .join('\n') + '\n',
  { mode: 0o600 },
);
await writeFile('secrets.local.json', JSON.stringify(secrets, null, 2) + '\n', {
  mode: 0o600,
});
console.log(
  'Created ignored .dev.vars and secrets.local.json. No credentials were printed.',
);
console.log(
  `Share the existing Google Sheet with ${account.client_email} as Editor.`,
);
console.log('Then run npm run preview to test the Cloudflare runtime locally.');
