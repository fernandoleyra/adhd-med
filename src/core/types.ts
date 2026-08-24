/**
 * The SessionScript: the one contract every mode in ADHD MED compiles down to.
 * DJ, Lab, Codex and Logos all emit this; the audio engine, the visuals, the
 * share-link codec and the visuals all consume it.
 */

export const SCHEMA_VERSION = 2;

export type WaveKind = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'custom';

/** `custom` builds a PeriodicWave from harmonic amplitudes (partial 1..n). */
export interface Wave {
  kind: WaveKind;
  harmonics?: number[];
}

/**
 * How the beat is delivered.
 * - binaural: carrier−beat/2 left, carrier+beat/2 right. Needs headphones.
 * - monaural: both tones in both ears, beating acoustically. Speaker-safe.
 * - isochronic: one tone gated at the beat rate. Speaker-safe, most assertive.
 * - tone: no beat at all — a plain drone, a partial in a stack.
 */
export type Method = 'binaural' | 'monaural' | 'isochronic' | 'tone';

export type NoiseColor = 'white' | 'pink' | 'brown' | 'blue' | 'violet' | 'grey';

export type LfoWave = 'sine' | 'triangle' | 'square' | 'sawtooth';

export interface Lfo {
  /** Hz */
  rate: number;
  /** 0..1 for amplitude, Hz of deviation for frequency modulation */
  depth: number;
  wave: LfoWave;
}

export type FilterKind = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking';

export interface Filter {
  kind: FilterKind;
  freq: number;
  q: number;
}

/** Anything a Mod can drive over the life of a segment. */
export type ModTarget =
  | 'carrier'
  | 'beat'
  | 'ratio'
  | 'gain'
  | 'pan'
  | 'filterFreq'
  | 'amRate'
  | 'amDepth'
  | 'fmRate'
  | 'fmDepth';

/**
 * Slow automation. Either an expression of time, or a from→to sweep, or both
 * (expression wins). Sampled at SAMPLE_HZ — for fast movement use am/fm, which
 * run on the audio thread.
 *
 * Expression variables: t (seconds), u (0..1 through the segment),
 * d (segment seconds), b (the layer's base value for this target),
 * r (stable random 0..1), plus pi, e, phi.
 */
export interface Mod {
  target: ModTarget;
  expr?: string;
  from?: number;
  to?: number;
  curve?: 'lin' | 'exp' | 'sine' | 'step';
  /** smooth seeded random walk, in target units */
  jitter?: number;
}

export interface Layer {
  kind: 'tone' | 'noise';
  method: Method;
  /** Hz. Multiplied by `ratio` to get the sounding frequency. */
  carrier: number;
  /** Hz difference between ears / gate rate. */
  beat: number;
  /** Frequency multiplier — for harmonic stacks and just-intonation intervals. */
  ratio: number;
  /** cents, applied to the right-hand oscillator only (deliberate strangeness) */
  detune: number;
  wave: Wave;
  color: NoiseColor;
  gain: number;
  /** -1 left .. 1 right */
  pan: number;
  am: Lfo | null;
  fm: Lfo | null;
  filter: Filter | null;
  mods: Mod[];
  mute?: boolean;
}

export interface Segment {
  /** seconds */
  dur: number;
  label?: string;
  /** one-line rationale, shown on the session card */
  why?: string;
  layers: Layer[];
}

export interface Script {
  v: number;
  title: string;
  note?: string;
  /**
   * Experimental mode: widens every range past the tested envelope so you can
   * build sounds nobody has tried. The output limiter and hard gain cap stay on.
   */
  unsafe?: boolean;
  seed?: number;
  /** provenance: which mode built this */
  origin?: 'dj' | 'lab' | 'codex' | 'logos' | 'link' | 'preset';
  segments: Segment[];
}

export const DEFAULT_LAYER: Layer = {
  kind: 'tone',
  method: 'binaural',
  carrier: 220,
  beat: 10,
  ratio: 1,
  detune: 0,
  wave: { kind: 'sine' },
  color: 'pink',
  gain: 0.6,
  pan: 0,
  am: null,
  fm: null,
  filter: null,
  mods: [],
};

export function layer(patch: Partial<Layer> = {}): Layer {
  return { ...DEFAULT_LAYER, ...patch, wave: { ...(patch.wave ?? DEFAULT_LAYER.wave) }, mods: patch.mods ? patch.mods.map((m) => ({ ...m })) : [] };
}

export function noiseLayer(color: NoiseColor, gain: number, patch: Partial<Layer> = {}): Layer {
  return layer({ kind: 'noise', color, gain, method: 'tone', ...patch });
}

/** A one-layer segment — the shape most presets need. */
export function segment(
  minutes: number,
  patch: Partial<Layer> & { label?: string; why?: string; noise?: number; noiseColor?: NoiseColor } = {},
): Segment {
  const { label, why, noise, noiseColor, ...layerPatch } = patch;
  const layers: Layer[] = [layer(layerPatch)];
  if (noise && noise > 0) layers.push(noiseLayer(noiseColor ?? 'pink', noise));
  return { dur: Math.round(minutes * 60), label, why, layers };
}

export function totalSeconds(script: Script): number {
  return script.segments.reduce((sum, s) => sum + s.dur, 0);
}

/** Absolute start time of each segment, in seconds. */
export function segmentStarts(script: Script): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of script.segments) {
    out.push(t);
    t += s.dur;
  }
  return out;
}

export function segmentAt(script: Script, seconds: number): { index: number; offset: number } {
  let t = 0;
  for (let i = 0; i < script.segments.length; i++) {
    const d = script.segments[i]!.dur;
    if (seconds < t + d || i === script.segments.length - 1) return { index: i, offset: Math.max(0, seconds - t) };
    t += d;
  }
  return { index: 0, offset: 0 };
}

/** True when any layer needs stereo separation to work as intended. */
export function needsHeadphones(script: Script): boolean {
  return script.segments.some((s) =>
    s.layers.some((l) => !l.mute && (l.method === 'binaural' || l.pan !== 0 || l.detune !== 0)),
  );
}

/** The frequency a tone layer actually sounds at. */
export function soundingFreq(l: Layer): number {
  return l.carrier * l.ratio;
}
