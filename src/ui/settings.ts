/**
 * Settings. Short on purpose: there is no account to manage, and the only
 * secret in here is a key you chose to paste.
 */
import { engine } from '../audio/engine.js';
import { applyTheme, MODELS, store } from '../store.js';
import { openAirplane } from '../pwa/offline.js';
import { getVeil } from '../viz/canvas.js';
import { el, field, openSheet, section, select, toast, toggle } from './dom.js';
import { openLeaflet } from './leaflet.js';
import { openLibrary } from './library.js';

export function openSettings(): void {
  const s = store.settings;

  const keyInput = el('input', {
    type: 'password',
    class: 'mono',
    value: s.apiKey,
    placeholder: 'sk-ant-…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Anthropic API key',
    oninput: (ev: Event) => store.update({ apiKey: (ev.target as HTMLInputElement).value.trim() }),
  });

  const proxyInput = el('input', {
    type: 'text',
    class: 'mono',
    value: s.proxyUrl,
    placeholder: 'https://your-worker.workers.dev',
    'aria-label': 'Proxy URL',
    oninput: (ev: Event) => store.update({ proxyUrl: (ev.target as HTMLInputElement).value.trim() }),
  });

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
          hint: 'A limiter and a hard cap sit after this in every mode.',
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
        toggle('I usually wear headphones', s.headphones, (v) => store.update({ headphones: v })),
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
        el('p', { class: 'field-hint', text: 'Visuals never modulate brightness faster than 2 Hz, and freeze entirely if your system asks for reduced motion.' }),
      ]),

      section('AI DJ', [
        el('p', { class: 'field-hint' }, [
          'Optional. Without a key the DJ still works — it reads your text by keyword and uses the scripted generator, which needs no network at all. With a key, requests go from this browser straight to the API: there is no server in between, and the key never leaves this device.',
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'Anthropic API key' })]),
          keyInput,
          el('span', { class: 'field-hint', text: 'Stored in this browser only. Roughly a cent or two per session.' }),
        ]),
        select('Model', MODELS.map((m) => ({ value: m.id, label: `${m.label} — ${m.note}` })), s.model, (v) =>
          store.update({ model: v }),
        ),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'Or a proxy URL' })]),
          proxyInput,
          el('span', { class: 'field-hint', text: 'If you deployed the worker in extras/proxy-worker, put it here and leave the key blank.' }),
        ]),
      ]),

      section('Offline', [
        el('div', { class: 'row' }, [
          el('button', { class: 'ghost', type: 'button', onclick: () => void openAirplane() }, ['Airplane mode']),
        ]),
        el('p', { class: 'field-hint', text: 'Checks the real cache, file by file, so you know before the plane doors close.' }),
      ]),

      section('Reading', [
        el('div', { class: 'row' }, [
          el('button', { class: 'ghost', type: 'button', onclick: () => openLibrary() }, ['Library']),
          el('button', { class: 'ghost', type: 'button', onclick: () => openLeaflet() }, ['Package insert']),
        ]),
      ]),

      section('This browser', [
        el('p', { class: 'field-hint', text: `${store.get().saved.length} saved sessions. Nothing is stored anywhere else.` }),
        el('div', { class: 'row' }, [
          el('button', {
            class: 'ghost',
            type: 'button',
            onclick: () => {
              if (!confirm('Forget saved sessions, preferences and any key stored here?')) return;
              localStorage.clear();
              toast('Cleared. Reloading.');
              window.setTimeout(() => location.reload(), 600);
            },
          }, ['Forget everything']),
        ]),
      ]),
    ],
  });
}
