/**
 * What this is, in one screen, with the numbers that justify each design choice.
 */
import { referenceCount, openLibrary } from '../ui/library.js';
import { openLeaflet } from '../ui/leaflet.js';
import { clear, el, section } from '../ui/dom.js';
import { BANDS } from '../core/octave.js';

export function renderAbout(host: HTMLElement): void {
  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('What this is', [
        el('p', { class: 'lead' }, [
          'A generative frequency instrument for focus, built as a single static page. Every tone is synthesised here, in your browser: no accounts, no server, no analytics, nothing uploaded. Sessions travel as links. It works with the network off.',
        ]),
        el('p', {}, [
          'The framing is a joke with a straight face — an “ADHD digital med”, with a package insert. The sound is real, the arithmetic is real, and the evidence is exactly as strong as it is, which is the part most apps in this genre skip.',
        ]),
      ]),

      section('The bands', [
        el('ul', { class: 'derive' },
          BANDS.map((b) => el('li', { text: `${b.label}: ${b.lo}–${b.hi} Hz` })),
        ),
        el('p', { class: 'field-hint' }, [
          'Focus arcs here climb alpha → SMR → beta and stay out of theta, because raised resting theta is the most replicated EEG finding in ADHD. Theta and delta are used for calm, meditation and sleep, where the effect sizes are actually largest.',
        ]),
      ]),

      section('How a beat works', [
        el('p', {}, [
          'Play 220 Hz in one ear and 232 Hz in the other and you hear a 12 Hz pulse that is not in the air — your brainstem makes it from the difference. That is a binaural beat, and it needs headphones. A monaural beat sums the two tones before they reach you, so the pulse is physically real and works on speakers. An isochronic tone just switches one tone on and off at the target rate, which is the most assertive of the three.',
        ]),
      ]),

      section('What the evidence says', [
        el('p', {}, [
          'A 2019 meta-analysis of 22 studies found a medium overall effect (g ≈ 0.45), strongest for anxiety with slow beats (g ≈ 0.69), and better results when the sound starts before the task rather than only during it. ADHD specifically is the weakest part of the literature: in the trials that exist, people reported studying better while rating scales and attention tests did not move. Moderate background noise has its own separate, decent evidence for inattentive listeners, which is why the noise bed is a first-class control here.',
        ]),
        el('p', { class: 'field-hint' }, [
          'The honest summary: plausibly calming, pleasant to work to, unproven as an attention treatment, and not a substitute for care.',
        ]),
      ]),

      section('Design rules', [
        el('ul', { class: 'derive' }, [
          el('li', { text: 'every session opens with an onset ramp — pre-task exposure outperformed during-task alone' }),
          el('li', { text: 'nothing in the visuals modulates brightness faster than 2 Hz' }),
          el('li', { text: 'a limiter and a hard gain cap sit after your volume, in every mode, including the experimental one' }),
          el('li', { text: 'every number in the Codex carries a tier: measured, protocol, or lore' }),
          el('li', { text: 'the AI is optional; the scripted DJ uses the same grammar and needs no network' }),
        ]),
      ]),

      section('Reading', [
        el('p', { class: 'lead', text: `${referenceCount()} papers, books and documents — the ones this is built on and the ones worth your evening.` }),
        el('div', { class: 'row' }, [
          el('button', { class: 'primary', type: 'button', onclick: () => openLibrary() }, ['Open the library']),
          el('button', { class: 'ghost', type: 'button', onclick: () => openLeaflet() }, ['Package insert']),
        ]),
      ]),
    ]),
  );
}
