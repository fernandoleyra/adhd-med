/**
 * Settings. Short on purpose: there is no account, no key and no service — only
 * how it sounds and how it looks.
 */
import { engine } from '../audio/engine.js';
import { applyTheme, store } from '../store.js';
import { openAirplane } from '../pwa/offline.js';
import { getVeil } from '../viz/canvas.js';
import { el, field, openSheet, section, select, toast, toggle } from './dom.js';
import { openLeaflet } from './leaflet.js';
import { openLibrary } from './library.js';

export function openSettings(): void {
  const s = store.settings;

  openSheet({
    title: 'Settings',
    body: [
      section('Sound', [
        field({
          label: 'Volume',
          value: s.volume,
          min: 0,
          max: 1,
          unit: '%',
          format: (v) => String(Math.round(v * 100)),
          hint: 'a limiter sits after this, always',
          oninput: (v) => {
            store.update({ volume: v });
            engine.setVolume(v);
          },
        }),
        select(
          'Default delivery',
          [
            { value: 'binaural', label: 'binaural — headphones' },
            { value: 'monaural', label: 'monaural — speakers fine' },
            { value: 'isochronic', label: 'isochronic — speakers fine' },
          ],
          s.method,
          (v) => store.update({ method: v as typeof s.method }),
        ),
        toggle('Headphones', s.headphones, (v) => store.update({ headphones: v })),
      ]),

      section('Look', [
        select(
          'Theme',
          [
            { value: 'system', label: 'follow the system' },
            { value: 'light', label: 'light' },
            { value: 'dark', label: 'dark' },
          ],
          s.theme,
          (v) => {
            store.update({ theme: v as typeof s.theme });
            applyTheme(v as typeof s.theme);
            getVeil()?.refreshTheme();
          },
        ),
        el('p', { class: 'field-hint', text: 'nothing flickers faster than 2 Hz' }),
      ]),

      section('Offline', [
        el('div', { class: 'row' }, [
          el('button', { class: 'ghost', type: 'button', onclick: () => void openAirplane() }, ['Airplane']),
          el('button', { class: 'ghost', type: 'button', onclick: () => openLibrary() }, ['Library']),
          el('button', { class: 'ghost', type: 'button', onclick: () => openLeaflet() }, ['Insert']),
        ]),
      ]),

      section('This browser', [
        el('div', { class: 'row' }, [
          el('button', {
            class: 'ghost',
            type: 'button',
            onclick: () => {
              if (!confirm('Forget saved sessions, preferences and any key stored here?')) return;
              localStorage.clear();
              toast('Cleared.');
              window.setTimeout(() => location.reload(), 600);
            },
          }, [`Forget everything (${store.get().saved.length} saved)`]),
        ]),
      ]),
    ],
  });
}
