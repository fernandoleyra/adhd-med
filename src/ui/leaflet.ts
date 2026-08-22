/**
 * The package insert. Shown once on first run, and reachable from the footer
 * forever after. Written to be read, not clicked past.
 */
import { store } from '../store.js';
import { el, openSheet } from './dom.js';

export const DISCLAIMER_SHORT =
  'ADHD MED is not a medical device and not a treatment for ADHD or anything else. The evidence for brainwave entrainment is mixed: calming effects are plausible, measurable attention gains are unproven. If you are struggling, talk to a professional — real treatment works. Keep the volume moderate, and never use this while driving.';

function leafletBody(): HTMLElement {
  return el('div', { class: 'leaflet' }, [
    el('p', { text: 'A generative frequency instrument. Everything you hear is synthesised in this browser, in real time, from numbers you can inspect.' }),

    el('p', {}, [
      el('strong', { text: 'ADHD MED is not a medical device' }),
      ' and not a treatment for ADHD or anything else. The name is a joke told with a straight face; the sound is real, and so is the arithmetic. Nothing here diagnoses, treats or replaces care.',
    ]),

    el('h3', { text: 'Active ingredients' }),
    el('p', {}, [
      'Sine waves, 40–1200 Hz. A small difference between your ears, 0.5–40 Hz. Pink, brown, white, blue, violet or grey noise, optional. In experimental mode, considerably more.',
    ]),

    el('h3', { text: 'What it actually does' }),
    el('p', {}, [
      'Two tones a few hertz apart, one in each ear, produce a beat that exists in your hearing rather than in the air. A 2019 meta-analysis of 22 studies found a medium overall effect (g ≈ 0.45), strongest for anxiety with slow beats (g ≈ 0.69), and better results when the sound starts ',
      el('em', { text: 'before' }),
      ' the task rather than only during it. Every session here opens with a ramp for that reason.',
    ]),

    el('h3', { text: 'What it does not do' }),
    el('p', {}, [
      'ADHD trials are the weak spot, and this app says so where it matters. In the studies that exist, people reported studying better while the rating scales and attention tests did not move. Treat that as the honest ceiling: a sound you might like working to, not a treatment.',
    ]),

    el('h3', { text: 'How to take it' }),
    el('p', {}, [
      'Headphones for binaural sessions — the effect is the difference between your ears, so a speaker cancels it. Monaural and isochronic delivery work on any speaker. Start at a quarter volume; a limiter sits after your volume control in every mode and cannot be switched off.',
    ]),

    el('h3', { text: 'Warnings' }),
    el('p', { class: 'fine' }, [
      'Do not use while driving or operating machinery. If you have epilepsy or are photosensitive: visuals here never modulate brightness faster than 2 Hz, but you know your triggers better than a stylesheet does. Stop if you feel unwell, dizzy or agitated. Not for use as a substitute for sleep, medication or care. Loud sound damages hearing permanently; the WHO guidance is about level ',
      el('em', { text: 'and' }),
      ' duration together.',
    ]),

    el('h3', { text: 'Storage and disposal' }),
    el('p', { class: 'fine' }, [
      'Nothing leaves this device. There is no account, no analytics and no server: sessions travel as links, and your preferences live in this browser until you clear it. Free and open source — fork it, change the numbers, disagree with the arcs.',
    ]),

    el('h3', { text: 'Evidence tiers' }),
    el('p', { class: 'fine' }, [
      'The Codex labels every number: ',
      el('strong', { text: 'measured' }),
      ' for quantities someone actually measured, ',
      el('strong', { text: 'protocol' }),
      ' for procedures with a rationale, and ',
      el('strong', { text: 'lore' }),
      ' for the beautiful unproven material — planetary tones, solfeggio, 432 Hz. The lore is kept because it is lovely and because pretending it is science would be worse. The arithmetic is always real; the meaning is sometimes poetry.',
    ]),
  ]);
}

export function openLeaflet(): void {
  openSheet({ title: 'Package insert', body: [leafletBody()], wide: true });
}

/** First run: the leaflet, then two decisions, then out of the way forever. */
export function openFirstRun(onDone: () => void): void {
  let headphones = true;
  const hpChip = (label: string, value: boolean) =>
    el(
      'button',
      {
        class: `chip${headphones === value ? ' is-on' : ''}`,
        type: 'button',
        onclick: (e: Event) => {
          headphones = value;
          const parent = (e.target as HTMLElement).parentElement!;
          [...parent.children].forEach((c, i) => c.classList.toggle('is-on', (i === 0) === value));
        },
      },
      [label],
    );

  const close = openSheet({
    title: 'Read before use',
    wide: true,
    body: [
      leafletBody(),
      el('h3', { class: 'block-title', style: { marginTop: 'var(--s6)' }, text: 'Two questions' }),
      el('p', { class: 'lead', text: 'Are you on headphones? Binaural beats need them; everything else works on a speaker.' }),
      el('div', { class: 'chips' }, [hpChip('Headphones', true), hpChip('Speaker', false)]),
      el('p', { class: 'field-hint', style: { marginTop: 'var(--s4)' }, text: 'Volume starts at 25%. You can change everything later.' }),
      el('div', { class: 'row', style: { marginTop: 'var(--s5)' } }, [
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
          ['Understood — begin'],
        ),
      ]),
    ],
  });
}
