/**
 * Boot: theme, canvas, transport, routes, footer. Roughly a hundred lines,
 * because there is no framework underneath any of this.
 */
import './app.css';
import { attachBackground } from './audio/background.js';
import { engine, renderScript } from './audio/engine.js';
import { decodeScript, encodeScript } from './core/codec.js';
import { generate } from './core/generate.js';
import { renderAbout } from './modes/about.js';
import { renderCodex } from './modes/codex.js';
import { renderDj } from './modes/dj.js';
import { loadIntoLab, renderLab } from './modes/lab.js';
import { renderLogos } from './modes/logos.js';
import { openAirplane, registerServiceWorker } from './pwa/offline.js';
import { clearPayload, navigate, parseHash, startRouter } from './router.js';
import { applyTheme, store } from './store.js';
import { el, toast } from './ui/dom.js';
import { DISCLAIMER_SHORT, openFirstRun, openLeaflet } from './ui/leaflet.js';
import { openLibrary, referenceCount } from './ui/library.js';
import { mountMini, openSession, playScript } from './ui/player.js';
import { openSettings } from './ui/settings.js';
import { mountVeil } from './viz/canvas.js';

const REPO = 'https://github.com/fernandoleyra/adhd-med';

const TABS: { path: string; label: string; glyph: string }[] = [
  {
    path: '/dj',
    label: 'DJ',
    glyph: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.2"/>',
  },
  {
    path: '/lab',
    label: 'Lab',
    glyph: '<path d="M3 12h18M12 3v18"/><circle cx="16" cy="8" r="3.2"/>',
  },
  {
    path: '/codex',
    label: 'Codex',
    glyph: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.6"/>',
  },
  {
    path: '/logos',
    label: 'Logos',
    glyph: '<polygon points="12,3 20.4,17 3.6,17"/><circle cx="12" cy="12" r="4"/>',
  },
];

function mountTabs(host: HTMLElement): void {
  host.replaceChildren(
    ...TABS.map((t) =>
      el('a', { href: `#${t.path}`, 'data-path': t.path }, [
        el('span', {
          'aria-hidden': 'true',
          html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">${t.glyph}</svg>`,
        }),
        t.label,
      ]),
    ),
  );
}

function markTab(path: string): void {
  document.querySelectorAll('#tabs a').forEach((a) => {
    const match = (a as HTMLAnchorElement).dataset.path === path;
    if (match) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function mountFooter(host: HTMLElement): void {
  const link = (label: string, onclick: () => void) =>
    el('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); onclick(); } }, [label]);

  host.replaceChildren(
    link(`Library · ${referenceCount()} references`, () => openLibrary()),
    link('Package insert', () => openLeaflet()),
    link('About the science', () => navigate('/about')),
    el('a', { href: REPO, target: '_blank', rel: 'noopener noreferrer' }, ['Source · MIT']),
    el('span', { class: 'disc', text: DISCLAIMER_SHORT }),
  );
}

async function handlePayload(payload: string): Promise<void> {
  const script = await decodeScript(payload);
  if (!script) {
    toast('That link could not be read.', 'warn');
    navigate('/dj');
    return;
  }
  script.origin = 'link';
  loadIntoLab(script);
  engine.load(script);
  clearPayload();
  if (script.unsafe) {
    toast('This session uses the experimental envelope. Turn your volume down first.', 'warn');
  }
  navigate('/lab');
  openSession();
}

function boot(): void {
  applyTheme(store.settings.theme);
  engine.setVolume(store.settings.volume);

  const canvas = document.getElementById('veil') as HTMLCanvasElement;
  mountVeil(canvas);
  attachBackground(engine);
  mountTabs(document.getElementById('tabs')!);
  mountMini(document.getElementById('mini')!);
  mountFooter(document.getElementById('foot')!);
  void registerServiceWorker();

  document.getElementById('btn-settings')!.addEventListener('click', () => openSettings());
  document.getElementById('btn-plane')!.addEventListener('click', () => void openAirplane());

  const plane = document.getElementById('btn-plane')!;
  const markOnline = () => plane.dataset.on = navigator.onLine === false ? 'true' : 'false';
  window.addEventListener('online', markOnline);
  window.addEventListener('offline', markOnline);
  markOnline();

  const view = document.getElementById('view')!;
  startRouter((route) => {
    const payload = route.params.get('m');
    if (payload) {
      void handlePayload(payload);
      return;
    }
    markTab(route.path);
    switch (route.path) {
      case '/lab':
        renderLab(view);
        break;
      case '/codex':
        renderCodex(view);
        break;
      case '/logos':
        renderLogos(view);
        break;
      case '/about':
        renderAbout(view);
        break;
      case '/library':
        renderAbout(view);
        openLibrary();
        break;
      default:
        renderDj(view);
    }
    view.scrollIntoView({ block: 'start' });
  });

  // Space toggles the transport, unless you are typing.
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (e.key === ' ' && engine.snapshot().script) {
      e.preventDefault();
      void engine.toggle();
    }
  });

  if (!store.settings.seenLeaflet && !parseHash().params.get('m')) {
    openFirstRun(() => {
      engine.setVolume(store.settings.volume);
    });
  }
}

boot();

// A small public surface: the end-to-end tests drive the app through it, and
// anyone poking around in the console gets the same handles. This is a hackable
// toy, not a black box.
declare global {
  interface Window {
    adhdmed: {
      engine: typeof engine;
      play: typeof playScript;
      store: typeof store;
      /** render a session offline — useful for measuring what it actually emits */
      render: typeof renderScript;
      generate: typeof generate;
      encode: typeof encodeScript;
      decode: typeof decodeScript;
    };
  }
}
window.adhdmed = { engine, play: playScript, store, render: renderScript, generate, encode: encodeScript, decode: decodeScript };
