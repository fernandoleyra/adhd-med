/**
 * Settings. Short on purpose: there is no account to manage, and the only
 * secret in here is a key you chose to paste.
 */
import { aiLabel } from '../ai/client.js';
import { engine } from '../audio/engine.js';
import { applyTheme, MODELS, store } from '../store.js';
import { openAirplane } from '../pwa/offline.js';
import { getVeil } from '../viz/canvas.js';
import { chip, el, field, openSheet, section, select, toast, toggle } from './dom.js';
import { openLeaflet } from './leaflet.js';
import { openLibrary } from './library.js';

export function openSettings(): void {
  const s = store.settings;

  const keyInput = el('input', {
    type: 'password',
    class: 'mono',
    value: s.apiKey,
    placeholder: 'sk-or-v1-…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'OpenRouter API key',
    oninput: (ev: Event) => store.update({ apiKey: (ev.target as HTMLInputElement).value.trim() }),
  });

  // OpenRouter has hundreds of models; the chips are a shortlist and the field
  // takes any id.
  const modelInput = el('input', {
    type: 'text',
    class: 'mono',
    value: s.model,
    placeholder: 'openrouter/free',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': 'Model',
    oninput: (ev: Event) => store.update({ model: (ev.target as HTMLInputElement).value.trim() }),
  });
  const modelChips = el('div', { class: 'chips' },
    MODELS.map((m) =>
      chip(m.label, {
        active: s.model === m.id,
        hint: `${m.id} — ${m.note}`,
        onclick: () => {
          store.update({ model: m.id });
          modelInput.value = m.id;
          modelChips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-on', c.textContent === m.label));
        },
      }),
    ),
  );

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

      section('AI DJ', [
        el('p', { class: 'field-hint', text: `${aiLabel(s)} · this deployment` }),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'OpenRouter key' })]),
          keyInput,
          el('span', { class: 'field-hint', text: 'only if you want your own · openrouter.ai/keys' }),
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'Model' })]),
          modelInput,
          el('span', { class: 'field-hint', text: 'yours · a hosted DJ may pin its own' }),
        ]),
        modelChips,
        el('label', { class: 'field', style: { marginTop: 'var(--s4)' } }, [
          el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'Proxy' })]),
          proxyInput,
          el('span', { class: 'field-hint', text: 'overrides both' }),
        ]),
      ], 'optional'),

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
