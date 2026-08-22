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
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  let base = '/adhd-med/';
  return {
    name: 'adhd-med-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      base = config.base;
    },
    closeBundle() {
      const walk = (dir: string, prefix = ''): string[] =>
        readdirSync(dir).flatMap((name) => {
          const full = join(dir, name);
          const rel = prefix ? posix.join(prefix, name) : name;
          return statSync(full).isDirectory() ? walk(full, rel) : [rel];
        });

      const emitted = walk(outDir).filter((f) => f !== 'sw.js' && f !== 'precache.json');
      const files = [base, ...emitted.map((f) => base + f)].sort();
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
  base: process.env.BASE_PATH ?? '/adhd-med/',
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Keep the AI adapter out of the main chunk: it only loads with a key present.
        manualChunks(id) {
          if (id.includes('@anthropic-ai') || id.includes('/src/ai/')) return 'ai';
          return null;
        },
      },
    },
  },
  server: { host: true },
});
