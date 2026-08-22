/**
 * The package insert.
 *
 * Short by default, because a wall of text on first open is a wall. The
 * essential claims are always visible; the rest is one tap away and stays
 * available from the footer forever.
 */
import { store } from '../store.js';
import { el, openSheet } from './dom.js';

export const DISCLAIMER_SHORT = 'Not a medical device. Not a treatment. Evidence is mixed. Keep it quiet, not while driving.';

const LONG = [
  ['What it does', 'Two tones a few hertz apart, one per ear, make a beat that exists in your hearing rather than in the air. A 2019 meta-analysis of 22 studies found a medium overall effect, strongest for anxiety with slow beats, and better results when the sound starts before the task. Every session here opens with a ramp for that reason.'],
  ['What it does not', 'ADHD trials are the weak spot. People reported studying better; rating scales and attention tests did not move. That is the honest ceiling.'],
  ['How to take it', 'Headphones for binaural — the effect is the difference between your ears. Monaural and isochronic work on any speaker. A limiter sits after your volume in every mode and cannot be switched off.'],
  ['Warnings', 'Not while driving. Visuals never flicker faster than 2 Hz, but you know your triggers better than a stylesheet does. Stop if you feel unwell. Loud sound damages hearing permanently.'],
  ['Storage', 'Nothing leaves this device. No account, no analytics, no server. Sessions travel as links.'],
  ['Tiers', 'The Codex labels every number: measured, protocol, or lore. The lore — planetary tones, solfeggio, 432 Hz — is kept because it is lovely and labelled because pretending it is science would be worse.'],
];

function insert(): HTMLElement {
  return el('div', { class: 'leaflet' }, [
    el('p', { class: 'insert-lede' }, [
      el('strong', { text: 'Not a medical device.' }),
      ' Not a treatment for ADHD or anything else. The name is a joke told with a straight face; the sound and the arithmetic are real.',
    ]),
    el('dl', { class: 'facts' }, [
      el('dt', { text: 'Active' }),
      el('dd', { text: 'sine waves 40–1200 Hz · a difference of 0.5–40 Hz between your ears · optional noise' }),
      el('dt', { text: 'Evidence' }),
      el('dd', { text: 'mixed — calming is plausible, attention gains unproven' }),
      el('dt', { text: 'Dose' }),
      el('dd', { text: 'starts at 25% volume · limiter always on' }),
      el('dt', { text: 'Avoid' }),
      el('dd', { text: 'driving · loud volume · using it instead of care' }),
    ]),
    el(
      'details',
      { class: 'fold' },
      [
        el('summary', {}, ['the long version']),
        el('div', {}, LONG.flatMap(([head, body]) => [el('h3', { text: head }), el('p', { text: body })])),
      ],
    ),
  ]);
}

export function openLeaflet(): void {
  openSheet({ title: 'Insert', body: [insert()] });
}

/** First run: the insert, one question, done. */
export function openFirstRun(onDone: () => void): void {
  let headphones = true;
  const pick = (label: string, value: boolean) =>
    el(
      'button',
      {
        class: `chip${headphones === value ? ' is-on' : ''}`,
        type: 'button',
        onclick: (e: Event) => {
          headphones = value;
          const row = (e.currentTarget as HTMLElement).parentElement!;
          [...row.children].forEach((c, i) => c.classList.toggle('is-on', (i === 0) === value));
        },
      },
      [label],
    );

  const close = openSheet({
    title: 'Before you start',
    body: [
      insert(),
      el('div', { class: 'chips', style: { marginTop: 'var(--s5)' } }, [pick('Headphones', true), pick('Speaker', false)]),
      el('div', { class: 'row', style: { marginTop: 'var(--s4)' } }, [
        el(
          'button',
          {
            class: 'primary',
            type: 'button',
            onclick: () => {
              store.update({ seenLeaflet: true, headphones, method: headphones ? 'binaural' : 'isochronic' });
              close();
              onDone();
            },
          },
          ['Begin'],
        ),
      ]),
    ],
  });
}
