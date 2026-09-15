import { build } from 'esbuild';
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';

const out = 'dist/apps-script';
await mkdir(out, { recursive: true });
const result = await build({
  entryPoints: ['apps-script/http.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'ReadingGroupServer',
  target: 'es2020',
  write: false,
});
const wrappers = `
// Tests whether execution reaches a function body; no sheet access or changes.
function checkMplseRuntime() {
  console.log('MPLSE runtime check: function body reached.');
  return 'MPLSE runtime check: function body reached.';
}
function doGet(event) { return ReadingGroupServer.handleGet(event); }
function doPost(event) { return ReadingGroupServer.handlePost(event); }
// Visible in the editor's Run menu; setup requires a bound spreadsheet, not its UI.
function setupMplse() { return ReadingGroupServer.setup(); }
`;
await writeFile(`${out}/Code.gs`, result.outputFiles[0].text + wrappers);
await rm(`${out}/Index.html`, { force: true });
await copyFile('apps-script/appsscript.json', `${out}/appsscript.json`);
console.log(
  'Apps Script API ready in dist/apps-script (Code.gs, appsscript.json). No HTML file is needed.',
);
