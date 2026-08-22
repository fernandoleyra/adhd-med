/**
 * The only screen where prose is the point — kept to facts and numbers.
 */
import { BANDS } from '../core/octave.js';
import { ENTRIES } from '../core/codex.js';
import { clear, el, section } from '../ui/dom.js';
import { openLeaflet } from '../ui/leaflet.js';
import { openLibrary, referenceCount } from '../ui/library.js';

const REPO = 'https://github.com/fernandoleyra/adhd-med';

export function renderAbout(host: HTMLElement): void {
  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('ADHD MED', [
        el('p', { class: 'lead', text: 'An ADHD digital med. Not medicine — arithmetic you can hear.' }),
        el('dl', { class: 'facts' }, [
          el('dt', { text: 'Runs' }),
          el('dd', { text: 'entirely in this browser · no account · no server · works offline' }),
          el('dt', { text: 'Costs' }),
          el('dd', { text: 'nothing · open source, MIT' }),
          el('dt', { text: 'Holds' }),
          el('dd', { text: `${ENTRIES.length} frequencies · ${referenceCount()} references` }),
        ]),
      ]),

      section('Bands', [
        el('dl', { class: 'facts mono-dd' },
          BANDS.flatMap((b) => [
            el('dt', { text: b.label.split(' ')[1] ?? b.key }),
            el('dd', { text: `${b.lo}–${b.hi} Hz` }),
          ]),
        ),
        el('p', { class: 'field-hint', text: 'Focus climbs alpha → SMR → beta and stays out of theta: raised theta is the most replicated EEG finding in ADHD.' }),
      ]),

      section('A beat', [
        el('p', { text: '220 Hz in one ear, 232 in the other, and you hear a 12 Hz pulse that is not in the air. That needs headphones. Monaural sums the tones first, so the pulse is real and works on a speaker. Isochronic just switches one tone on and off.' }),
      ]),

      section('Evidence', [
        el('dl', { class: 'facts' }, [
          el('dt', { text: 'Overall' }),
          el('dd', { text: 'g ≈ 0.45 across 22 studies (2019 meta-analysis)' }),
          el('dt', { text: 'Anxiety' }),
          el('dd', { text: 'g ≈ 0.69 with slow beats — the strongest finding' }),
          el('dt', { text: 'ADHD' }),
          el('dd', { text: 'mixed: better self-reported study, unchanged tests' }),
          el('dt', { text: 'Timing' }),
          el('dd', { text: 'before the task beat during it alone' }),
        ]),
      ]),

      section('Rules', [
        el('ul', { class: 'derive' }, [
          el('li', { text: 'every session opens with an onset ramp' }),
          el('li', { text: 'nothing flickers faster than 2 Hz' }),
          el('li', { text: 'a limiter sits after your volume, in every mode' }),
          el('li', { text: 'every number carries a tier: measured, protocol, lore' }),
          el('li', { text: 'the AI is optional; the scripted DJ needs no network' }),
        ]),
      ]),

      section('More', [
        el('div', { class: 'row' }, [
          el('button', { class: 'primary', type: 'button', onclick: () => openLibrary() }, ['Library']),
          el('button', { class: 'ghost', type: 'button', onclick: () => openLeaflet() }, ['Insert']),
          el('a', { class: 'ghost', href: REPO, target: '_blank', rel: 'noopener noreferrer' }, ['Source']),
        ]),
      ]),
    ]),
  );
}
