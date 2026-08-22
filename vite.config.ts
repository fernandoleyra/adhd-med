import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Emits the service worker with the full file list and a build hash inlined,
 * plus precache.json so the Airplane screen can verify the cache for real.
 *
 * This runs in closeBundle and reads the finished output directory rather than
 * Rollup's bundle map: the stylesheet and the copied public/ assets land there
 * after generateBundle, and a precache list that quietly omitted the CSS would
 * give a very convincing broken offline app.
 *
 * Entries are relative (`./`, `./assets/…`). In the worker they resolve against
 * the worker's own URL, in the page against the document — both land in the
 * directory holding index.html, wherever that has been mounted.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'adhd-med-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const walk = (dir: string, prefix = ''): string[] =>
        readdirSync(dir).flatMap((name) => {
          const full = join(dir, name);
          const rel = prefix ? posix.join(prefix, name) : name;
          return statSync(full).isDirectory() ? walk(full, rel) : [rel];
        });

      const emitted = walk(outDir).filter((f) => f !== 'sw.js' && f !== 'precache.json');
      const files = ['./', ...emitted.map((f) => `./${f}`)].sort();
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12);

      const template = readFileSync('src/pwa/sw-template.js', 'utf8')
        .replace('__PRECACHE__', JSON.stringify(files))
        .replace(/__VERSION__/g, version);

      writeFileSync(join(outDir, 'sw.js'), template);
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify({ version, files }));
      this.info?.(`service worker ${version} precaches ${files.length} files`);
    },
  };
}

export default defineConfig({
  /**
   * Relative, so one build boots wherever it is mounted: a host's root, a
   * project subpath, a plain file server. An absolute base is one deploy target
   * hardcoded into every asset URL, which is exactly how this app once shipped
   * a blank page. BASE_PATH remains for anyone who needs the absolute form.
   */
  base: process.env.BASE_PATH ?? './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    reportCompressedSize: true,
  },
  server: { host: true },
});
