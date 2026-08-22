/**
 * LOGOS — words into frequencies.
 *
 * Deterministic and fully shown: the same word always gives the same sound, and
 * every step of the derivation is printed on screen, because the derivation is
 * the point. Letters pick degrees of a just pentatonic scale, so no arbitrary
 * word can produce a harsh interval — there are no semitones or tritones in the
 * set to land on.
 */
import { fold, JUST_PENTATONIC } from './octave.js';
import { cleanScript } from './ranges.js';
import { hashString } from './rng.js';
import { layer, type Layer, type Script, type Segment } from './types.js';

/** Dark vowels sit low and slow, bright vowels high and fast. */
export const VOWEL_BEATS: Record<string, number> = { U: 4, O: 6, A: 10, E: 12, I: 14, Y: 18 };
const NO_VOWEL_BEAT = 10;

export interface LetterStep {
  letter: string;
  n: number;
  degree: number;
  ratio: number;
  octave: 1 | 2;
  hz: number;
}

export interface WordReading {
  word: string;
  letters: string[];
  sum: number;
  root: number;
  rootOctaves: number;
  vowel: string | null;
  beat: number;
  steps: LetterStep[];
  /** distinct sounding frequencies, low to high */
  chord: number[];
  minutes: number;
  /** the derivation, line by line, for the screen */
  lines: string[];
}

export function readWord(word: string, minutesOverride?: number): WordReading {
  const letters = word.toUpperCase().replace(/[^A-Z]/g, '').split('');
  const sum = letters.reduce((acc, ch) => acc + (ch.charCodeAt(0) - 64), 0);
  const folded = fold(sum || 1, 110, 220);
  const root = folded.hz;

  let vowel: string | null = null;
  for (const ch of letters) {
    if (ch in VOWEL_BEATS) { vowel = ch; break; }
  }
  const counts = new Map<string, number>();
  for (const ch of letters) if (ch in VOWEL_BEATS) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let best = 0;
  for (const [ch, count] of counts) {
    if (count > best) { best = count; vowel = ch; }
  }
  const beat = vowel ? VOWEL_BEATS[vowel]! : NO_VOWEL_BEAT;

  const steps: LetterStep[] = letters.map((letter) => {
    const n = letter.charCodeAt(0) - 64;
    const degree = (n - 1) % 5;
    const ratio = JUST_PENTATONIC[degree]!;
    const octave: 1 | 2 = n >= 14 ? 2 : 1;
    return { letter, n, degree, ratio, octave, hz: root * ratio * octave };
  });

  const chord = [...new Set(steps.map((s) => Math.round(s.hz * 100) / 100))].sort((a, b) => a - b).slice(0, 5);
  const minutes = minutesOverride ?? Math.min(26, Math.max(8, letters.length * 2));

  const lines = [
    letters.length ? letters.map((ch) => `${ch}${ch.charCodeAt(0) - 64}`).join(' · ') : 'no letters',
    `Σ ${sum} → ${folded.k >= 0 ? `×2^${folded.k}` : `÷2^${-folded.k}`} → root ${root.toFixed(2)} Hz`,
    `degrees ${steps.map((s) => s.degree + 1).join('·')} of the just pentatonic`,
    vowel ? `dominant vowel ${vowel} → beat ${beat} Hz` : `no vowel → beat ${beat} Hz`,
    `${chord.length} distinct voice${chord.length === 1 ? '' : 's'} · ${minutes} min`,
  ];

  return { word, letters, sum, root, rootOctaves: folded.k, vowel, beat, steps, chord, minutes, lines };
}

/** One word becomes one segment: a beating root plus its pentatonic partials. */
export function wordSegment(reading: WordReading, opts: { method?: Layer['method']; noise?: number } = {}): Segment {
  const layers: Layer[] = [
    layer({
      method: opts.method ?? 'binaural',
      carrier: reading.root,
      beat: reading.beat,
      gain: 0.55,
      wave: { kind: 'sine' },
    }),
  ];
  // Partials above the root: no beat of their own, gently filtered, quieter as
  // they climb, so arbitrary words stay listenable.
  const partials = reading.chord.filter((hz) => Math.abs(hz - reading.root) > 0.5).slice(0, 4);
  partials.forEach((hz, i) => {
    layers.push(
      layer({
        method: 'tone',
        carrier: hz,
        beat: 0,
        gain: 0.2 / (i + 1),
        pan: i % 2 === 0 ? -0.25 : 0.25,
        filter: { kind: 'lowpass', freq: 2000, q: 0.7 },
      }),
    );
  });
  if (opts.noise && opts.noise > 0) {
    layers.push(layer({ kind: 'noise', method: 'tone', color: 'pink', gain: opts.noise }));
  }
  return {
    dur: Math.round(reading.minutes * 60),
    label: reading.word.toUpperCase(),
    why: `${reading.root.toFixed(1)} Hz root from Σ${reading.sum}, ${reading.beat} Hz beat from “${reading.vowel ?? '—'}”`,
    layers,
  };
}

export interface LogosOptions {
  method?: Layer['method'];
  noise?: number;
  /** total minutes to spread across the words; omit to use the derived length */
  minutes?: number;
}

/** A phrase becomes a sequence — one segment per word. */
export function logosScript(text: string, opts: LogosOptions = {}): { script: Script; readings: WordReading[] } {
  const words = text.trim().split(/\s+/).filter((w) => /[a-zA-Z]/.test(w)).slice(0, 8);
  const source = words.length ? words : ['SILENCE'];
  const perWord = opts.minutes ? opts.minutes / source.length : undefined;
  const readings = source.map((w) =>
    readWord(w, perWord ?? (source.length > 1 ? Math.min(12, Math.max(4, w.replace(/[^a-zA-Z]/g, '').length * 2)) : undefined)),
  );
  const script: Script = cleanScript({
    v: 2,
    title: source.join(' ').toUpperCase().slice(0, 48),
    note: `Letters as numbers, numbers as pitch. ${readings[0]!.lines[1]}`,
    seed: hashString(text.toUpperCase()) % 1e9,
    origin: 'logos',
    segments: readings.map((r) => wordSegment(r, { method: opts.method, noise: opts.noise })),
  });
  return { script, readings };
}
