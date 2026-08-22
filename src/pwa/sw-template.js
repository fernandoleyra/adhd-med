/* ADHD MED service worker.
   Hand written on purpose: the whole app is a couple of dozen files, and a
   contributor should be able to read the offline story in one sitting.
   Built by the plugin in vite.config.ts, which injects the file list and a
   version hash so each deploy is a new worker. */

const VERSION = '__VERSION__';
const CACHE = `adhd-med-${VERSION}`;
const PRECACHE = __PRECACHE__;

/**
 * Always ignore Vary. Precached entries are stored from plain Requests, while
 * the browser's real requests carry an Origin header — and any host that sends
 * `Vary: Origin` (vite preview does) would otherwise make every cache lookup
 * miss, giving a page that looks cached and is not.
 */
function match(cache, request) {
  return cache.match(request, { ignoreVary: true });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Cache files one at a time: a single 404 should not abandon the install.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('adhd-med-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // The AI adapter talks to the network or not at all — never serve it stale.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const shell = (await match(cache, PRECACHE[0])) ?? (await match(cache, './'));
        try {
          const fresh = await fetch(request);
          return fresh;
        } catch {
          return shell ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await match(cache, request);
      if (hit) return hit;
      try {
        const fresh = await fetch(request);
        if (fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone());
        return fresh;
      } catch {
        const loose = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
        return loose ?? Response.error();
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: VERSION, files: PRECACHE.length });
  }
});
