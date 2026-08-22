/**
 * Noise beds, rendered once into looping buffers.
 *
 * A buffer loop costs almost nothing to play, which matters on a phone that has
 * to survive a 90-minute session. An AudioWorklet would be more elegant and
 * measurably worse for battery.
 */
import type { NoiseColor } from '../core/types.js';
import { rng } from '../core/rng.js';

const SECONDS = 12;
/** Baked into the loop so the seam cannot click. */
const SEAM = 0.05;

function normalise(data: Float32Array, peak = 0.5): void {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  if (max === 0) return;
  const scale = peak / max;
  for (let i = 0; i < data.length; i++) data[i]! *= scale;
}

function white(n: number, random: () => number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = random() * 2 - 1;
  return out;
}

/** Paul Kellet's economical pink filter: −3 dB/octave to within a fraction of a dB. */
function pink(n: number, random: () => number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/** −6 dB/octave: a leaky integrator over white. */
function brown(n: number, random: () => number): Float32Array {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    out[i] = last;
  }
  return out;
}

/** +3 dB/octave: the first difference of white. */
function blue(n: number, random: () => number): Float32Array {
  const w = white(n, random);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    out[i] = w[i]! - prev;
    prev = w[i]!;
  }
  return out;
}

/** +6 dB/octave: the second difference. Bright and thin. */
function violet(n: number, random: () => number): Float32Array {
  const b = blue(n, random);
  const out = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    out[i] = b[i]! - prev;
    prev = b[i]!;
  }
  return out;
}

/**
 * "Grey" here is a smile curve — energy pushed to both ends of the spectrum,
 * a rough stand-in for perceptual flatness rather than a calibrated
 * inverse-loudness contour.
 */
function grey(n: number, random: () => number): Float32Array {
  const p = pink(n, random);
  const v = violet(n, random);
  normalise(p, 1);
  normalise(v, 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = p[i]! * 0.6 + v[i]! * 0.4;
  return out;
}

const GENERATORS: Record<NoiseColor, (n: number, random: () => number) => Float32Array> = {
  white, pink, brown, blue, violet, grey,
};

export const NOISE_COLORS: NoiseColor[] = ['white', 'pink', 'brown', 'blue', 'violet', 'grey'];

export const NOISE_NOTES: Record<NoiseColor, string> = {
  white: 'flat energy per hertz — hiss',
  pink: '−3 dB/oct — rain, the usual bed',
  brown: '−6 dB/oct — distant surf',
  blue: '+3 dB/oct — bright',
  violet: '+6 dB/oct — thin and airy',
  grey: 'both ends lifted — a smile curve',
};

const cache = new Map<string, AudioBuffer>();

/** A seamless loop of the requested colour. Cached per context sample rate. */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const key = `${color}@${ctx.sampleRate}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const total = Math.floor(ctx.sampleRate * SECONDS);
  const seam = Math.floor(ctx.sampleRate * SEAM);
  const random = rng(0xa5f3 + NOISE_COLORS.indexOf(color) * 7919);
  const data = GENERATORS[color](total + seam, random);
  normalise(data, 0.5);

  const buffer = ctx.createBuffer(1, total, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  channel.set(data.subarray(0, total));
  // Crossfade the tail over the head so looping is inaudible.
  for (let i = 0; i < seam; i++) {
    const t = i / seam;
    channel[i] = channel[i]! * t + data[total + i]! * (1 - t);
  }
  cache.set(key, buffer);
  return buffer;
}

export function clearNoiseCache(): void {
  cache.clear();
}
