/**
 * LOGOS — words into frequencies.
 *
 * The derivation is the interface: every step from letters to hertz is printed
 * as you type, and the word draws itself as a closed path through a 26-point
 * circle. Letters choose degrees of a just pentatonic scale, which is why an
 * arbitrary word cannot come out harsh — there is nothing harsh in the set.
 */
import { logosScript, readWord, VOWEL_BEATS } from '../core/logos.js';
import { store } from '../store.js';
import { chip, clear, el, field, section } from '../ui/dom.js';
import { methodChips, playScript, sessionCard } from '../ui/player.js';
import { drawWordSigil } from '../viz/marks.js';
import type { Method } from '../core/types.js';

const EXAMPLES = ['CALM', 'FOCUS', 'ENOUGH', 'SLOW DOWN', 'FINISH THE THING', 'MITOCHONDRIA'];

export function renderLogos(host: HTMLElement): void {
  let text = 'FOCUS';
  let method: Method = store.settings.method;
  let minutes: number | undefined;

  const sigil = el('canvas', { 'aria-hidden': 'true', style: { width: '132px', height: '132px' } });
  const derivation = el('ul', { class: 'derive' });
  const cardHost = el('div');

  const rebuild = () => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const reading = readWord(words[0] ?? '', minutes);
    const { script } = logosScript(text, { method, minutes });

    drawWordSigil(sigil, words.join('') || 'X', 132);
    clear(derivation);
    reading.lines.forEach((line) => derivation.appendChild(el('li', { text: line })));
    if (words.length > 1) derivation.appendChild(el('li', { text: `${words.length} words → ${words.length} segments, in order` }));

    clear(cardHost);
    cardHost.appendChild(
      sessionCard(script, {
        detail: true,
        onplay: () => playScript(script),
        actionLabel: 'Play the word',
      }),
    );
  };

  const input = el('input', {
    type: 'text',
    value: text,
    placeholder: 'a word, or a short phrase',
    'aria-label': 'Word or phrase',
    autocapitalize: 'characters',
    oninput: (ev: Event) => {
      text = (ev.target as HTMLInputElement).value;
      rebuild();
    },
  });

  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('Logos', [
        el('p', { class: 'lead', text: 'Type something. The letters become numbers, the numbers become pitch, and the whole derivation stays on screen so you can check it.' }),
        input,
        el('div', { class: 'chips', style: { marginTop: 'var(--s3)' } },
          EXAMPLES.map((w) =>
            chip(w.toLowerCase(), {
              onclick: () => {
                text = w;
                input.value = w;
                rebuild();
              },
            }),
          ),
        ),
      ]),
      section('Derivation', [
        el('div', { style: { display: 'flex', gap: 'var(--s4)', alignItems: 'flex-start', flexWrap: 'wrap' } }, [
          sigil,
          el('div', { style: { flex: '1 1 200px' } }, [derivation]),
        ]),
        el('p', { class: 'field-hint' }, [
          `vowels set the beat — ${Object.entries(VOWEL_BEATS).map(([v, hz]) => `${v} ${hz}`).join(' · ')} Hz. Dark vowels slow, bright vowels fast.`,
        ]),
      ]),
      section('Delivery', [
        methodChips(method, (m) => {
          method = m;
          rebuild();
        }),
        field({
          label: 'length',
          value: 12,
          min: 2,
          max: 60,
          unit: 'min',
          hint: 'leave it and the word decides: two minutes a letter',
          oninput: (v) => {
            minutes = v;
            rebuild();
          },
        }),
      ]),
      cardHost,
    ]),
  );

  rebuild();
}
