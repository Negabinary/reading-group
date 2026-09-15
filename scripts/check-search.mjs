import { catalogs } from '../src/catalogs.ts';

const query =
  process.argv.slice(2).join(' ') ||
  'A Theory of Type Polymorphism in Programming Robin Milner';
let found = false;
for (const catalog of catalogs(query)) {
  try {
    const response = await fetch(catalog.url, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = catalog.parse(await response.json());
    if (!results.length) {
      console.log(`${catalog.source}: no results, trying the next source.`);
      continue;
    }
    console.log(`${catalog.source}: ${results.length} results for “${query}”`);
    for (const paper of results.slice(0, 3))
      console.log(`  ${paper.title} (${paper.year}) — ${paper.url}`);
    found = true;
    break;
  } catch (error) {
    console.log(
      `${catalog.source}: unavailable or not a JSON API response (${error.name}).`,
    );
  }
}
if (!found) {
  console.error('No catalog returned papers. Manual entry remains available.');
  process.exitCode = 1;
}
