import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const manifestPath = resolve('build/.vite/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entry = Object.values(manifest).find((chunk) => chunk.isEntry);

if (!entry?.file) {
  throw new Error(`No entry chunk found in ${manifestPath}.`);
}

const entryPath = resolve('build', entry.file);
const entryBytes = (await stat(entryPath)).size;
const budgetBytes = 450 * 1024;

if (entryBytes > budgetBytes) {
  throw new Error(
    `Entry bundle ${entry.file} is ${(entryBytes / 1024).toFixed(1)} KiB; budget is ${budgetBytes / 1024} KiB.`,
  );
}

console.log(
  `Entry bundle ${entry.file}: ${(entryBytes / 1024).toFixed(1)} KiB / ${budgetBytes / 1024} KiB budget.`,
);
