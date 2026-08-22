/**
 * The Codex: numbers from the world, turned into sound.
 *
 * The catalogue itself is data (src/data/codex.json) so it can be edited without
 * touching code. Everything here is the arithmetic that turns an entry into
 * something audible — always by octave transposition, always showing the
 * exponent it used.
 */
import codexData from '../data/codex.json';
import { derivation, fold, type Folded } from './octave.js';
import { cleanScript } from './ranges.js';
import { layer, type Layer, type Method, type Script, type Segment } from './types.js';
import { hashString } from './rng.js';

export type Tier = 'measured' | 'protocol' | 'lore';
export type EntryKind = 'band' | 'frequency' | 'period' | 'number' | 'protocol';

export interface Stage {
  label: string;
  beat: number;
  beatTo?: number;
  carrier: number;
  minutes: number;
  why?: string;
  method?: Method;
  noise?: number;
  am?: { rate: number; depth: number };
}

export interface CodexEntry {
  id: string;
  name: string;
  tier: Tier;
  kind: EntryKind;
  value?: number;
  unit?: string;
  note: string;
  source: string;
  stages?: Stage[];
}

export const TIER_NOTES: Record<Tier, string> = codexData.tiers as Record<Tier, string>;
export const ENTRIES: CodexEntry[] = codexData.entries as CodexEntry[];

export function entryById(id: string): CodexEntry | undefined {
  return ENTRIES.find((e) => e.id === id);
}

export function byTier(tier: Tier): CodexEntry[] {
  return ENTRIES.filter((e) => e.tier === tier);
}

/** The frequency an entry is "about", in Hz, before any folding. */
export function baseHz(e: CodexEntry): number | null {
  if (e.value === undefined) return null;
  if (e.kind === 'period') return e.value > 0 ? 1 / e.value : null;
  return e.value;
}

export interface EntryMath {
  carrier: Folded;
  beat: Folded;
  /** the derivation lines shown under the entry */
  lines: string[];
}

export function entryMath(e: CodexEntry): EntryMath | null {
  const hz = baseHz(e);
  if (hz === null) return null;
  const carrier = fold(hz);
  const beat = e.kind === 'band' ? { hz: hz, k: 0, from: hz } : fold(hz, 0.5, 40);
  const lines: string[] = [];
  if (e.kind === 'period') {
    lines.push(`period ${e.value} s → 1/T = ${hz.toExponential(4)} Hz`);
    lines.push(derivation({ ...carrier, from: hz }, 'Hz'));
  } else {
    lines.push(derivation(carrier, e.unit || 'Hz'));
  }
  if (e.kind !== 'band') lines.push(`beat: same number, ${beat.k >= 0 ? `×2^${beat.k}` : `÷2^${-beat.k}`} → ${beat.hz.toFixed(2)} Hz`);
  else lines.push(`beat: ${beat.hz.toFixed(2)} Hz — already a brainwave rate, no shift needed`);
  return { carrier, beat, lines };
}

export interface EntryPlayOptions {
  method?: Method;
  minutes?: number;
  noise?: number;
}

function stageSegment(s: Stage, opts: EntryPlayOptions): Segment {
  const main = layer({
    method: s.method ?? opts.method ?? 'binaural',
    carrier: s.carrier,
    beat: s.beat,
    gain: 0.55,
  });
  if (s.beatTo !== undefined && s.beatTo !== s.beat) {
    main.mods.push({ target: 'beat', from: s.beat, to: s.beatTo, curve: 'sine' });
  }
  if (s.am) main.am = { rate: s.am.rate, depth: s.am.depth, wave: 'sine' };
  const layers: Layer[] = [main];
  const noise = s.noise ?? opts.noise ?? 0;
  if (noise > 0) layers.push(layer({ kind: 'noise', method: 'tone', color: 'pink', gain: noise }));
  return { dur: Math.round(s.minutes * 60), label: s.label, why: s.why, layers };
}

/** One entry, playable. Protocols become their arc; numbers become a drone with a beat. */
export function entryScript(e: CodexEntry, opts: EntryPlayOptions = {}): Script {
  const base: Script = {
    v: 2,
    title: e.name,
    note: e.note,
    seed: hashString(e.id) % 1e9,
    origin: 'codex',
    segments: [],
  };
  if (e.stages?.length) {
    base.segments = e.stages.map((s) => stageSegment(s, opts));
    return cleanScript(base);
  }
  const math = entryMath(e);
  const minutes = opts.minutes ?? 20;
  if (!math) {
    base.segments = [{ dur: minutes * 60, label: e.name, layers: [layer({ method: opts.method ?? 'binaural' })] }];
    return cleanScript(base);
  }
  base.segments = [
    stageSegment(
      {
        label: e.name,
        beat: math.beat.hz,
        carrier: math.carrier.hz,
        minutes,
        why: math.lines[0],
        noise: opts.noise ?? 0.12,
      },
      opts,
    ),
  ];
  return cleanScript(base);
}

/**
 * Compound several entries into one sounding stack: the first entry carries the
 * beat, the rest become drones at their own folded carriers. This is where the
 * catalogue stops being a list and starts being an instrument.
 */
export function stackScript(entries: CodexEntry[], opts: EntryPlayOptions = {}): Script | null {
  const playable = entries.filter((e) => entryMath(e) !== null);
  if (!playable.length) return null;
  const minutes = opts.minutes ?? 20;
  const [lead, ...rest] = playable;
  const leadMath = entryMath(lead!)!;
  const layers: Layer[] = [
    layer({
      method: opts.method ?? 'binaural',
      carrier: leadMath.carrier.hz,
      beat: leadMath.beat.hz,
      gain: 0.5,
    }),
  ];
  rest.slice(0, 6).forEach((e, i) => {
    const m = entryMath(e)!;
    layers.push(
      layer({
        method: 'tone',
        carrier: m.carrier.hz,
        beat: 0,
        gain: Math.max(0.08, 0.3 / (i + 1)),
        pan: i % 2 === 0 ? -0.3 : 0.3,
        filter: { kind: 'lowpass', freq: 4000, q: 0.7 },
      }),
    );
  });
  if ((opts.noise ?? 0.1) > 0) {
    layers.push(layer({ kind: 'noise', method: 'tone', color: 'pink', gain: opts.noise ?? 0.1 }));
  }
  return cleanScript({
    v: 2,
    title: playable.map((e) => e.name).join(' + ').slice(0, 48),
    note: `Stack of ${playable.length}: ${lead!.name} carries the beat at ${leadMath.beat.hz.toFixed(2)} Hz.`,
    seed: hashString(playable.map((e) => e.id).join('|')) % 1e9,
    origin: 'codex',
    segments: [{ dur: Math.round(minutes * 60), label: 'stack', why: 'compounded carriers, one beat', layers }],
  });
}

/** Search across names, notes and sources. */
export function searchEntries(query: string): CodexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return ENTRIES;
  return ENTRIES.filter((e) =>
    [e.name, e.note, e.source, e.tier, e.id].some((f) => f.toLowerCase().includes(q)),
  );
}
