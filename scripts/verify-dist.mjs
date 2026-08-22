/**
 * Assert the build is host-agnostic.
 *
 * This exists because it wasn't: the app once shipped with `/adhd-med/` baked
 * into every asset URL and was then served from a host's root, so the bundle
 * and the stylesheet both 404'd and the page rendered as a bare serif title.
 * Nothing failed — the build was fine, the tests were fine, the deploy was
 * fine. Only the mount point disagreed.
 *
 * So: every reference the shipped HTML makes, and every path the service worker
 * is told to precache, must be relative. A relative dist boots at a host root,
 * at a project subpath, and off a file server, and this check costs no browser.
 */
import { readFileSync } from 'node:fs';

const DIST = 'dist';
const problems = [];

/** Absolute paths and absolute URLs alike: both pin the build to one mount. */
function check(what, value) {
  if (/^https?:\/\//i.test(value)) problems.push(`${what}: absolute URL "${value}"`);
  else if (value.startsWith('//')) problems.push(`${what}: protocol-relative "${value}"`);
  else if (value.startsWith('/')) problems.push(`${what}: absolute path "${value}"`);
}

// --- index.html ---
const html = readFileSync(`${DIST}/index.html`, 'utf8');

// Local references only. A CDN or a font host is someone else's absolute URL
// and none of this check's business; these are the ones Vite rewrites with the
// configured base, which is exactly where the bug lived.
for (const [, attr, value] of html.matchAll(/\b(src|href)="([^"]+)"/g)) {
  if (/^(data:|mailto:|#|https?:\/\/)/i.test(value)) continue;
  check(`index.html ${attr}`, value);
}

// A bundle that imports another chunk by absolute path fails the same way, one
// layer deeper, where no smoke test would see it.
for (const [, value] of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) {
  check('index.html modulepreload', value);
}

// --- precache.json ---
const manifest = JSON.parse(readFileSync(`${DIST}/precache.json`, 'utf8'));
if (!Array.isArray(manifest.files) || manifest.files.length < 4) {
  problems.push(`precache.json lists ${manifest.files?.length ?? 0} files — too few to be a real build`);
}
for (const file of manifest.files ?? []) check('precache.json entry', file);

// The shell has to be in there under the name the worker falls back to, or an
// offline navigation has nothing to answer with.
if (!manifest.files?.includes('./')) problems.push('precache.json is missing the "./" shell entry');

// The stylesheet is the one that failed silently in production: no JS error, no
// missing element, just a page in Times New Roman.
if (!manifest.files?.some((f) => f.endsWith('.css'))) problems.push('precache.json lists no stylesheet');

if (problems.length) {
  console.error('✗ dist is not host-agnostic:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nEvery local reference must be relative, so one build boots wherever it is mounted.');
  process.exit(1);
}

console.log(`✓ dist is host-agnostic (${manifest.files.length} relative precache entries)`);
