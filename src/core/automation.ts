/**
 * Turns a layer's Mods into concrete value curves.
 *
 * Slow shapes (sweeps, equations, drifts) become sampled curves handed to
 * AudioParam.setValueCurveAtTime — scheduled once, then owned by the audio
 * thread, so nothing depends on a JS timer that a locked phone would throttle.
 * Fast periodic movement is the job of the am/fm modulators instead, which run
 * at audio rate.
 */
import { compile, type Compiled, type ExprCtx } from './expr.js';
import { clamp, envelopeFor, MOD_RANGE, type Envelope } from './ranges.js';
import { valueNoise } from './rng.js';
import type { Layer, Mod, ModTarget, Script } from './types.js';

/** Curve resolution. 8 Hz resolves a 30-second sweep to a quarter of a second. */
export const SAMPLE_HZ = 8;
export const MAX_CURVE_POINTS = 8192;

export function baseValue(l: Layer, target: ModTarget): number {
  switch (target) {
    case 'carrier': return l.carrier;
    case 'beat': return l.beat;
    case 'ratio': return l.ratio;
    case 'gain': return l.gain;
    case 'pan': return l.pan;
    case 'filterFreq': return l.filter?.freq ?? 1000;
    case 'amRate': return l.am?.rate ?? 0;
    case 'amDepth': return l.am?.depth ?? 0;
    case 'fmRate': return l.fm?.rate ?? 0;
    case 'fmDepth': return l.fm?.depth ?? 0;
  }
}

function shape(u: number, curve: Mod['curve']): number {
  switch (curve) {
    case 'exp': return u * u;
    case 'sine': return 0.5 - Math.cos(Math.PI * u) / 2;
    case 'step': return u < 1 ? 0 : 1;
    default: return u;
  }
}

interface PreparedMod {
  mod: Mod;
  fn: Compiled | null;
}

export interface ModPlan {
  target: ModTarget;
  mods: PreparedMod[];
  range: [number, number];
}

/** Compile every expression once per segment build. Invalid ones are dropped. */
export function planMods(layer: Layer, env: Envelope): Map<ModTarget, ModPlan> {
  const plans = new Map<ModTarget, ModPlan>();
  for (const mod of layer.mods) {
    const prepared: PreparedMod = { mod, fn: null };
    if (mod.expr) {
      const c = compile(mod.expr);
      if (!c.ok) continue;
      prepared.fn = c.fn;
    }
    const existing = plans.get(mod.target);
    if (existing) existing.mods.push(prepared);
    else plans.set(mod.target, { target: mod.target, mods: [prepared], range: env[MOD_RANGE[mod.target]] as [number, number] });
  }
  return plans;
}

export function valueAt(base: number, plan: ModPlan | undefined, t: number, dur: number, seed: number): number {
  if (!plan) return base;
  const u = dur > 0 ? Math.min(1, Math.max(0, t / dur)) : 0;
  const r = valueNoise(seed, 0.5);
  let value = base;
  for (const { mod, fn } of plan.mods) {
    if (fn) {
      const ctx: ExprCtx = { t, u, d: dur, b: value, r, seed };
      value = fn(ctx);
    } else if (mod.from !== undefined || mod.to !== undefined) {
      const from = mod.from ?? value;
      const to = mod.to ?? value;
      value = from + (to - from) * shape(u, mod.curve);
    }
    if (mod.jitter) value += (valueNoise(seed + 7, t * 0.25) * 2 - 1) * mod.jitter;
  }
  return clamp(value, plan.range);
}

/**
 * A layer's automation, resolved. `number` when the value never moves.
 * Curves always cover exactly [offset, dur] of the segment.
 */
export type Resolved = number | Float32Array;

export function resolveTarget(
  layer: Layer,
  target: ModTarget,
  plans: Map<ModTarget, ModPlan>,
  dur: number,
  offset: number,
  seed: number,
): Resolved {
  const base = baseValue(layer, target);
  const plan = plans.get(target);
  if (!plan) return base;
  const span = Math.max(0.05, dur - offset);
  const points = Math.min(MAX_CURVE_POINTS, Math.max(2, Math.ceil(span * SAMPLE_HZ)));
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const t = offset + (span * i) / (points - 1);
    curve[i] = valueAt(base, plan, t, dur, seed);
  }
  return curve;
}

export function isCurve(v: Resolved): v is Float32Array {
  return typeof v !== 'number';
}

export function firstValue(v: Resolved): number {
  return isCurve(v) ? (v[0] ?? 0) : v;
}

/** Combine two resolved values sample-wise — used to build oscillator frequencies. */
export function combine(a: Resolved, b: Resolved, f: (x: number, y: number) => number): Resolved {
  if (!isCurve(a) && !isCurve(b)) return f(a, b);
  const len = Math.max(isCurve(a) ? a.length : 0, isCurve(b) ? b.length : 0);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = isCurve(a) ? a[Math.min(i, a.length - 1)]! : a;
    const y = isCurve(b) ? b[Math.min(i, b.length - 1)]! : b;
    out[i] = f(x, y);
  }
  return out;
}

/** Deterministic per-layer seed so jitter and noise differ per voice but repeat exactly. */
export function layerSeed(script: Script, segIndex: number, layerIndex: number): number {
  const base = script.seed ?? 1;
  return (base ^ Math.imul(segIndex + 1, 0x9e3779b1) ^ Math.imul(layerIndex + 13, 0x85ebca6b)) >>> 0;
}

/**
 * The beat frequency over a segment, for drawing the timeline.
 * Uses the loudest unmuted tone layer — the one the ear will follow.
 */
export function beatTrace(script: Script, segIndex: number, samples = 24): number[] {
  const seg = script.segments[segIndex];
  if (!seg) return [];
  const tones = seg.layers.filter((l) => !l.mute && l.kind === 'tone' && l.method !== 'tone');
  const lead = tones.sort((a, b) => b.gain - a.gain)[0];
  if (!lead) return new Array(samples).fill(0);
  const env = envelopeFor(script);
  const plans = planMods(lead, env);
  const seed = layerSeed(script, segIndex, seg.layers.indexOf(lead));
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (seg.dur * i) / Math.max(1, samples - 1);
    out.push(valueAt(lead.beat, plans.get('beat'), t, seg.dur, seed));
  }
  return out;
}
