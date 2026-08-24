/**
 * Airplane mode.
 *
 * Not a toggle that pretends: it opens the real Cache Storage, compares it
 * against the manifest the build emitted, and tells you file by file whether
 * this app will work with the radio off. Every tone is synthesised here, so
 * once these files are cached the radio has nothing left to do.
 */
import { engine } from '../audio/engine.js';
import { el, openSheet, toast } from '../ui/dom.js';

export interface CacheReport {
  supported: boolean;
  registered: boolean;
  version: string | null;
  expected: number;
  present: number;
  missing: string[];
  bytes: number;
}

const MANIFEST = `${import.meta.env.BASE_URL}precache.json`;

/** Don't badger the network on every tab switch. */
const RECHECK_MS = 60_000;
let lastCheck = 0;

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  try {
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });

    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      next?.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) handOver(reg, false);
      });
    });

    // A worker that finished installing before this page loaded is sitting in
    // `waiting`, and `updatefound` will never fire again to mention it. Without
    // this check the old worker keeps control until every tab closes, which is
    // how a deploy can go unnoticed for days.
    if (reg.waiting && navigator.serviceWorker.controller) handOver(reg, true);

    // And ask, rather than waiting to be told: an installed app opened from the
    // home screen may not navigate for a long time.
    void recheck(reg);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void recheck(reg);
    });
  } catch {
    // Offline support is a bonus, not a requirement.
  }
}

async function recheck(reg: ServiceWorkerRegistration): Promise<void> {
  const now = Date.now();
  if (now - lastCheck < RECHECK_MS) return;
  lastCheck = now;
  await reg.update().catch(() => undefined);
}

/**
 * True when a new build can be taken without asking.
 *
 * The rule the old code was reaching for: never cut the sound off. That only
 * applies while something is playing — at page load, with nothing playing,
 * there is no session to interrupt and no half-typed sentence to lose, so the
 * quiet thing to do is take the update and get on with it.
 */
export function canTakeSilently(atLoad: boolean, playing: boolean): boolean {
  return atLoad && !playing;
}

function applyUpdate(reg: ServiceWorkerRegistration): void {
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  reg.waiting?.postMessage('SKIP_WAITING');
}

function handOver(reg: ServiceWorkerRegistration, atLoad: boolean): void {
  if (canTakeSilently(atLoad, engine.snapshot().status === 'playing')) {
    applyUpdate(reg);
    return;
  }
  offerUpdate(reg);
}

/**
 * Mid-session: ask. Its own element, not `#toast` — `toast()` finds that one by
 * id and overwrites its contents, which used to throw this button away a second
 * after it appeared. No auto-hide either: an offer nobody saw is not an offer.
 */
export function offerUpdate(reg: ServiceWorkerRegistration): void {
  document.getElementById('update')?.remove();
  document.body.appendChild(
    el('div', { id: 'update', class: 'is-on', role: 'status' }, [
      'A new version is ready. ',
      el('button', {
        class: 'ghost',
        type: 'button',
        style: { minHeight: '32px', padding: '0 10px', marginLeft: '8px' },
        onclick: () => applyUpdate(reg),
      }, ['Restart']),
    ]),
  );
}

export async function cacheReport(): Promise<CacheReport> {
  const report: CacheReport = {
    supported: 'caches' in window && 'serviceWorker' in navigator,
    registered: false,
    version: null,
    expected: 0,
    present: 0,
    missing: [],
    bytes: 0,
  };
  if (!report.supported) return report;
  report.registered = Boolean(await navigator.serviceWorker.getRegistration());

  let files: string[] = [];
  try {
    const res = await fetch(MANIFEST, { cache: 'no-store' });
    const data = (await res.json()) as { version: string; files: string[] };
    files = data.files;
    report.version = data.version;
  } catch {
    // In dev there is no manifest; fall back to what is actually cached.
  }
  report.expected = files.length;

  const keys = await caches.keys();
  const name = keys.find((k) => k.startsWith('adhd-med-'));
  if (!name) {
    report.missing = files;
    return report;
  }
  const cache = await caches.open(name);
  if (!files.length) {
    const all = await cache.keys();
    report.expected = all.length;
    report.present = all.length;
  }
  for (const file of files) {
    const hit = await cache.match(file, { ignoreVary: true });
    if (hit) {
      report.present++;
      const len = Number(hit.headers.get('content-length') ?? 0);
      report.bytes += len;
    } else report.missing.push(file);
  }
  return report;
}

export function isOffline(): boolean {
  return navigator.onLine === false;
}

function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export async function openAirplane(): Promise<void> {
  const body = el('div');
  const close = openSheet({
    title: 'Airplane mode',
    body: [
      el('p', { class: 'lead' }, [
        'Every tone is generated on this device, so a session needs no network at all. This checks whether the app itself is cached, file by file, before you are somewhere without signal.',
      ]),
      body,
    ],
  });
  void close;

  const render = (r: CacheReport) => {
    const ready = r.registered && r.expected > 0 && r.missing.length === 0;
    body.replaceChildren(
      el('div', { class: 'badges' }, [
        el('span', { class: `badge ${ready ? 'is-accent' : 'is-warn'}`, text: ready ? 'ready for offline' : r.registered ? 'incomplete' : 'not installed' }),
        el('span', { class: 'badge', text: isOffline() ? 'no network now' : 'network available' }),
        r.version ? el('span', { class: 'badge', text: `build ${r.version}` }) : null,
      ]),
      el('ul', { class: 'derive' }, [
        el('li', { text: `service worker: ${r.registered ? 'registered' : 'not registered'}` }),
        el('li', { text: `cached ${r.present} of ${r.expected} files · ${formatBytes(r.bytes)}` }),
        ...r.missing.slice(0, 6).map((m) => el('li', { text: `missing: ${m}` })),
        r.missing.length > 6 ? el('li', { text: `…and ${r.missing.length - 6} more` }) : null,
      ]),
      el('p', { class: 'field-hint' }, [
        'Nothing here needs the network once these files are cached: every tone is computed in this browser.',
      ]),
      el('div', { class: 'row', style: { marginTop: 'var(--s4)' } }, [
        el('button', {
          class: 'ghost',
          type: 'button',
          onclick: async () => {
            const reg = await navigator.serviceWorker?.getRegistration();
            if (!reg) {
              await registerServiceWorker();
              toast('Installing. Give it a few seconds, then check again.');
            } else {
              await reg.update();
              toast('Re-checked with the server.');
            }
            render(await cacheReport());
          },
        }, ['Cache everything now']),
        el('button', {
          class: 'ghost',
          type: 'button',
          onclick: async () => render(await cacheReport()),
        }, ['Re-check']),
      ]),
      ...(import.meta.env.DEV
        ? [el('p', { class: 'field-hint', text: 'Dev server: the service worker is deliberately not registered. Run a production build to test this.' })]
        : []),
    );
  };

  render({ supported: true, registered: false, version: null, expected: 0, present: 0, missing: [], bytes: 0 });
  render(await cacheReport());
}
