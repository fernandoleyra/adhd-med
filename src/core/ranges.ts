/**
 * Every number that reaches the audio engine passes through here.
 *
 * Two envelopes:
 *  - TESTED: the ranges the research covers. Default for everything.
 *  - OPEN:   experimental mode. Deliberately wide, so you can build sounds
 *            nobody has tried. Hearing safety (the master limiter and the hard
 *            gain cap in audio/engine.ts) is NOT part of this envelope and is
 *            never relaxed.
 *
 * This is also the trust boundary: a shared link is a stranger.
 */
import {
  DEFAULT_LAYER,
  SCHEMA_VERSION,
  type Filter,
  type Layer,
  type Lfo,
  type Mod,
  type ModTarget,
  type Script,
  type Segment,
  type Wave,
} from './types.js';

export interface Envelope {
  carrier: [number, number];
  beat: [number, number];
  ratio: [number, number];
  detune: [number, number];
  amRate: [number, number];
  amDepth: [number, number];
  fmRate: [number, number];
  fmDepth: [number, number];
  filterFreq: [number, number];
  filterQ: [number, number];
  gain: [number, number];
  pan: [number, number];
  dur: [number, number];
  harmonics: number;
  layers: number;
  segments: number;
  jitter: [number, number];
}

export const TESTED: Envelope = {
  carrier: [40, 1200],
  beat: [0, 40],
  ratio: [0.125, 8],
  detune: [-100, 100],
  amRate: [0, 40],
  amDepth: [0, 1],
  fmRate: [0, 40],
  fmDepth: [0, 100],
  filterFreq: [40, 16000],
  filterQ: [0.05, 20],
  gain: [0, 1],
  pan: [-1, 1],
  dur: [5, 5400],
  harmonics: 24,
  layers: 8,
  segments: 32,
  jitter: [0, 20],
};

export const OPEN: Envelope = {
  carrier: [0.05, 14000],
  beat: [0, 400],
  ratio: [0.01, 64],
  detune: [-2400, 2400],
  amRate: [0, 400],
  amDepth: [0, 1],
  fmRate: [0, 2000],
  fmDepth: [0, 6000],
  filterFreq: [20, 20000],
  filterQ: [0.0001, 40],
  gain: [0, 1],
  pan: [-1, 1],
  dur: [1, 14400],
  harmonics: 48,
  layers: 16,
  segments: 64,
  jitter: [0, 400],
};

export function envelopeFor(script: { unsafe?: boolean }): Envelope {
  return script.unsafe ? OPEN : TESTED;
}

export const MOD_RANGE: Record<ModTarget, keyof Envelope> = {
  carrier: 'carrier',
  beat: 'beat',
  ratio: 'ratio',
  gain: 'gain',
  pan: 'pan',
  filterFreq: 'filterFreq',
  amRate: 'amRate',
  amDepth: 'amDepth',
  fmRate: 'fmRate',
  fmDepth: 'fmDepth',
};

export function clamp(n: number, [lo, hi]: [number, number]): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Every number is quantised to four decimals on the way in. That kills float
 * artefacts like 0.18000000000000002, and it is the same precision the share
 * codec writes — so a validated session always survives a round-trip exactly.
 */
export const PRECISION = 4;

export function quantise(n: number): number {
  const f = 10 ** PRECISION;
  return Math.round(n * f) / f;
}

function num(v: unknown, fallback: number, range: [number, number]): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return quantise(clamp(Number.isFinite(n) ? n : fallback, range));
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const WAVES = ['sine', 'triangle', 'square', 'sawtooth', 'custom'] as const;
const METHODS = ['binaural', 'monaural', 'isochronic', 'tone'] as const;
const COLORS = ['white', 'pink', 'brown', 'blue', 'violet', 'grey'] as const;
const LFO_WAVES = ['sine', 'triangle', 'square', 'sawtooth'] as const;
const FILTERS = ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'] as const;
const CURVES = ['lin', 'exp', 'sine', 'step'] as const;
const TARGETS = Object.keys(MOD_RANGE) as ModTarget[];
const ORIGINS = ['dj', 'lab', 'codex', 'logos', 'link', 'preset'] as const;

/** Expressions are parsed by core/expr.ts, but cap the length here. */
const MAX_EXPR = 240;

function cleanWave(v: unknown, env: Envelope): Wave {
  const raw = (v ?? {}) as Partial<Wave>;
  const kind = pick(raw.kind, WAVES, 'sine');
  if (kind !== 'custom') return { kind };
  const source = Array.isArray(raw.harmonics) ? raw.harmonics : [1];
  const harmonics = source.slice(0, env.harmonics).map((h) => num(h, 0, [0, 1]));
  return { kind: 'custom', harmonics: harmonics.length ? harmonics : [1] };
}

function cleanLfo(v: unknown, env: Envelope, rateKey: 'amRate' | 'fmRate', depthKey: 'amDepth' | 'fmDepth'): Lfo | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Partial<Lfo>;
  return {
    rate: num(raw.rate, 1, env[rateKey]),
    depth: num(raw.depth, 0, env[depthKey]),
    wave: pick(raw.wave, LFO_WAVES, 'sine'),
  };
}

function cleanFilter(v: unknown, env: Envelope): Filter | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Partial<Filter>;
  return {
    kind: pick(raw.kind, FILTERS, 'lowpass'),
    freq: num(raw.freq, 2000, env.filterFreq),
    q: num(raw.q, 1, env.filterQ),
  };
}

function cleanMod(v: unknown, env: Envelope): Mod | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as Partial<Mod>;
  const target = pick(raw.target, TARGETS, 'gain');
  const range = env[MOD_RANGE[target]] as [number, number];
  const mod: Mod = { target };
  if (typeof raw.expr === 'string' && raw.expr.trim()) mod.expr = raw.expr.trim().slice(0, MAX_EXPR);
  if (raw.from !== undefined) mod.from = num(raw.from, range[0], range);
  if (raw.to !== undefined) mod.to = num(raw.to, range[1], range);
  if (raw.curve !== undefined) mod.curve = pick(raw.curve, CURVES, 'lin');
  if (raw.jitter !== undefined) mod.jitter = num(raw.jitter, 0, env.jitter);
  if (!mod.expr && mod.from === undefined && mod.to === undefined && !mod.jitter) return null;
  return mod;
}

/**
 * Defaults come from DEFAULT_LAYER, not from literals repeated here. The share
 * codec omits any field equal to its default, so the two must agree exactly or
 * a link would come back subtly different from the session that made it.
 */
export function cleanLayer(v: unknown, env: Envelope): Layer {
  const raw = (v ?? {}) as Partial<Layer>;
  const kind = raw.kind === 'noise' ? 'noise' : 'tone';
  const mods = Array.isArray(raw.mods)
    ? raw.mods.map((m) => cleanMod(m, env)).filter((m): m is Mod => m !== null).slice(0, 8)
    : [];
  return {
    kind,
    method: pick(raw.method, METHODS, kind === 'noise' ? 'tone' : DEFAULT_LAYER.method),
    carrier: num(raw.carrier, DEFAULT_LAYER.carrier, env.carrier),
    beat: num(raw.beat, DEFAULT_LAYER.beat, env.beat),
    ratio: num(raw.ratio, DEFAULT_LAYER.ratio, env.ratio),
    detune: num(raw.detune, DEFAULT_LAYER.detune, env.detune),
    wave: cleanWave(raw.wave, env),
    color: pick(raw.color, COLORS, DEFAULT_LAYER.color),
    gain: num(raw.gain, DEFAULT_LAYER.gain, env.gain),
    pan: num(raw.pan, DEFAULT_LAYER.pan, env.pan),
    am: cleanLfo(raw.am, env, 'amRate', 'amDepth'),
    fm: cleanLfo(raw.fm, env, 'fmRate', 'fmDepth'),
    filter: cleanFilter(raw.filter, env),
    mods,
    ...(raw.mute ? { mute: true } : {}),
  };
}

function cleanSegment(v: unknown, env: Envelope): Segment {
  const raw = (v ?? {}) as Partial<Segment>;
  const layersIn = Array.isArray(raw.layers) && raw.layers.length ? raw.layers : [{}];
  const layers = layersIn.slice(0, env.layers).map((l) => cleanLayer(l, env));
  const seg: Segment = { dur: Math.round(num(raw.dur, 300, env.dur)), layers };
  if (typeof raw.label === 'string') seg.label = raw.label.slice(0, 48);
  if (typeof raw.why === 'string') seg.why = raw.why.slice(0, 200);
  return seg;
}

/**
 * Accepts anything and returns a Script that is safe to schedule.
 * Never throws — a malformed share link degrades to something playable.
 */
export function cleanScript(v: unknown): Script {
  const raw = (v ?? {}) as Partial<Script>;
  const unsafe = raw.unsafe === true;
  const env = unsafe ? OPEN : TESTED;
  const segmentsIn = Array.isArray(raw.segments) && raw.segments.length ? raw.segments : [{}];
  const script: Script = {
    v: SCHEMA_VERSION,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 64) : 'Untitled session',
    segments: segmentsIn.slice(0, env.segments).map((s) => cleanSegment(s, env)),
  };
  if (unsafe) script.unsafe = true;
  if (typeof raw.note === 'string' && raw.note.trim()) script.note = raw.note.trim().slice(0, 600);
  if (typeof raw.seed === 'number' && Number.isFinite(raw.seed)) script.seed = Math.floor(Math.abs(raw.seed)) % 1e9;
  if (typeof raw.origin === 'string' && (ORIGINS as readonly string[]).includes(raw.origin)) {
    script.origin = raw.origin as Script['origin'];
  }
  return script;
}

/** Human-readable notes about anything unusual — surfaced as badges in the UI. */
export function auditScript(script: Script): string[] {
  const notes: string[] = [];
  const env = envelopeFor(script);
  let loudest = 0;
  for (const seg of script.segments) {
    let sum = 0;
    for (const l of seg.layers) {
      if (l.mute) continue;
      sum += l.gain;
      if (l.beat > TESTED.beat[1]) notes.push(`beat ${l.beat.toFixed(1)} Hz is past the researched range`);
      if (l.carrier * l.ratio > 4000) notes.push('a layer sounds above 4 kHz — keep the volume low');
      if (l.carrier * l.ratio < 30 && l.kind === 'tone') notes.push('a layer sounds below 30 Hz — mostly inaudible on phone speakers');
      if (l.method === 'binaural' && Math.abs(l.pan) > 0.75) {
        notes.push('a binaural layer is balanced hard to one side — the quiet ear carries little, so the beat fades with it');
      }
    }
    loudest = Math.max(loudest, sum);
  }
  if (loudest > 2) notes.push('layers sum hot — the limiter will be working');
  if (script.unsafe) notes.push(`experimental envelope (carriers to ${env.carrier[1]} Hz, beats to ${env.beat[1]} Hz)`);
  return [...new Set(notes)];
}
