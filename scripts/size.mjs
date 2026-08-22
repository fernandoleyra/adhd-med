/**
 * Bundle budget. This app promises to be lightweight; CI should enforce it
 * rather than trusting anyone's discipline.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist';
const BUDGET_INITIAL_KB = 100; // JS + CSS the first paint needs
const BUDGET_TOTAL_KB = 250; // everything except the lazy AI chunk

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(DIST);
let initial = 0;
let total = 0;
const rows = [];

for (const path of files) {
  const raw = readFileSync(path);
  const gz = gzipSync(raw).length;
  const isCode = /\.(js|css)$/.test(path);
  const isLazyAi = /ai-[^/]*\.js$/.test(path) || path.includes('anthropic');
  if (isCode && !isLazyAi) initial += gz;
  if (!isLazyAi) total += gz;
  rows.push({ path: path.replace(`${DIST}/`, ''), raw: raw.length, gz, lazy: isLazyAi });
}

rows.sort((a, b) => b.gz - a.gz);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log('file'.padEnd(46), 'raw'.padStart(10), 'gzip'.padStart(10));
for (const r of rows.slice(0, 14)) {
  console.log(`${r.path}${r.lazy ? ' (lazy)' : ''}`.padEnd(46), kb(r.raw).padStart(10), kb(r.gz).padStart(10));
}
console.log('-'.repeat(68));
console.log(`initial code (gzip): ${kb(initial)} / budget ${BUDGET_INITIAL_KB} kB`);
console.log(`total shipped (gzip, minus lazy AI chunk): ${kb(total)} / budget ${BUDGET_TOTAL_KB} kB`);

let failed = false;
if (initial > BUDGET_INITIAL_KB * 1024) {
  console.error(`\n✗ initial code is over budget by ${kb(initial - BUDGET_INITIAL_KB * 1024)}`);
  failed = true;
}
if (total > BUDGET_TOTAL_KB * 1024) {
  console.error(`\n✗ total is over budget by ${kb(total - BUDGET_TOTAL_KB * 1024)}`);
  failed = true;
}
if (failed) process.exit(1);
console.log('\n✓ within budget');
