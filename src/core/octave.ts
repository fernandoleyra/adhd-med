/**
 * Octave transposition — the trick that lets any number be heard.
 *
 * Doubling or halving a frequency is the same pitch class, so a number of any
 * magnitude can be moved into hearing range by multiplying by a power of two.
 * That step is arithmetic, not interpretation: the app always shows the
 * exponent it used, so you can check the claim yourself.
 */

export interface Folded {
  /** the audible frequency, Hz */
  hz: number;
  /** the exponent applied: hz = n * 2^k */
  k: number;
  /** the number we started from */
  from: number;
}

/**
 * The carrier octave: 128 Hz to 256 Hz.
 *
 * One octave, comfortably inside the 100–500 Hz range where binaural carriers
 * work best, and — usefully for checking our arithmetic against someone else's
 * — the same octave Cousto's cosmic-octave tuning forks are cut to. Fold the
 * Earth's day into it and you get his 194.18 Hz exactly.
 */
export const CARRIER_LO = 128;
export const CARRIER_HI = 256;

/** Fold a positive number into [lo, hi) by powers of two. */
export function fold(n: number, lo = CARRIER_LO, hi = CARRIER_HI): Folded {
  if (!Number.isFinite(n) || n <= 0) return { hz: lo, k: 0, from: n };
  let hz = n;
  let k = 0;
  const guard = 200;
  let i = 0;
  while (hz < lo && i++ < guard) { hz *= 2; k += 1; }
  i = 0;
  while (hz >= hi && i++ < guard) { hz /= 2; k -= 1; }
  return { hz, k, from: n };
}

/** A period in seconds is a frequency: 1/T, then folded up into hearing. */
export function foldPeriod(seconds: number, lo = CARRIER_LO, hi = CARRIER_HI): Folded {
  return fold(1 / seconds, lo, hi);
}

/** Pretty-print the derivation, e.g. "86400 s → ×2^24 → 194.18 Hz". */
export function derivation(f: Folded, unit = 'Hz'): string {
  const sign = f.k === 0 ? '×1' : f.k > 0 ? `×2^${f.k}` : `÷2^${-f.k}`;
  return `${formatNumber(f.from)} ${unit} → ${sign} → ${f.hz.toFixed(2)} Hz`;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9 || (abs < 1e-4 && abs > 0)) return n.toExponential(4).replace('e+', '×10^').replace('e-', '×10^-');
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(abs < 1 ? 4 : 2);
}

/** Musical helpers — ratios rather than note names, since the app thinks in numbers. */
export const JUST_PENTATONIC = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
export const JUST_MAJOR = [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];
export const HARMONIC_SERIES = [1, 2, 3, 4, 5, 6, 7, 8];

export function centsBetween(a: number, b: number): number {
  return 1200 * Math.log2(b / a);
}

/** Where a frequency sits among the EEG bands — used for the session heatmap. */
export const BANDS = [
  { key: 'delta', label: 'δ delta', lo: 0.5, hi: 4 },
  { key: 'theta', label: 'θ theta', lo: 4, hi: 8 },
  { key: 'alpha', label: 'α alpha', lo: 8, hi: 12 },
  { key: 'smr', label: 'σ SMR', lo: 12, hi: 15 },
  { key: 'beta', label: 'β beta', lo: 15, hi: 30 },
  { key: 'gamma', label: 'γ gamma', lo: 30, hi: 100 },
] as const;

export type BandKey = (typeof BANDS)[number]['key'];

export function bandOf(hz: number): BandKey | null {
  for (const b of BANDS) if (hz >= b.lo && hz < b.hi) return b.key;
  return null;
}

export function bandLabel(hz: number): string {
  const key = bandOf(hz);
  const band = BANDS.find((b) => b.key === key);
  return band ? band.label : hz <= 0 ? 'silent' : hz < 0.5 ? 'sub-delta' : 'above gamma';
}
