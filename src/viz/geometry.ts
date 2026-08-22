/**
 * The drawing rules. Every figure in ADHD MED is computed from the sound —
 * no decorative motion anywhere.
 *
 * Safety rule, enforced here and nowhere else: nothing that changes brightness
 * or size may do so faster than FLICKER_CAP. A canvas driven by 0.5–40 Hz
 * parameters is otherwise one bug away from a strobe. Fast beats are shown as
 * rotation at beat / 2^k, and the divisor is printed on screen rather than
 * hidden.
 */

export const FLICKER_CAP = 2;

export interface SafeRate {
  rate: number;
  divisor: number;
}

/** Bring any rate under the flicker cap by halving, and report the divisor. */
export function safeRate(hz: number): SafeRate {
  let rate = Math.abs(hz);
  let divisor = 1;
  let guard = 0;
  while (rate > FLICKER_CAP && guard++ < 16) {
    rate /= 2;
    divisor *= 2;
  }
  return { rate, divisor };
}

export interface Sigil {
  /** 1 = circle, 2 = vesica, 3..9 = polygon */
  form: number;
  /** concentric rings = octaves used in the transposition */
  rings: number;
  /** node angles in radians, from the digits */
  nodes: number[];
  stroke: 'solid' | 'dashed' | 'dotted';
}

function digitsOf(n: number): number[] {
  const s = Math.abs(n).toString().replace('.', '').replace(/^0+/, '') || '0';
  return [...s].map((d) => Number(d)).filter((d) => Number.isFinite(d));
}

export function digitalRoot(n: number): number {
  const digits = digitsOf(n);
  let sum = digits.reduce((a, b) => a + b, 0);
  while (sum > 9) sum = digitsOf(sum).reduce((a, b) => a + b, 0);
  return sum === 0 ? 1 : sum;
}

/**
 * A number's signature figure: digital root chooses the form, the octave count
 * gives the ring count, and each digit places a node. Deterministic — the same
 * number always draws the same mark.
 */
export function sigilFor(value: number, octaves: number, tier: 'measured' | 'protocol' | 'lore'): Sigil {
  const digits = digitsOf(value);
  return {
    form: digitalRoot(value),
    rings: Math.min(8, Math.max(1, Math.abs(octaves))),
    nodes: digits.slice(0, 12).map((d) => (d * Math.PI * 2) / 10),
    stroke: tier === 'measured' ? 'solid' : tier === 'protocol' ? 'dashed' : 'dotted',
  };
}

/** A word draws itself as a closed path through a 26-point circle. */
export function wordPath(word: string): { points: [number, number][]; symmetry: number } {
  const letters = word.toUpperCase().replace(/[^A-Z]/g, '').split('');
  const points = letters.map((ch) => {
    const i = ch.charCodeAt(0) - 65;
    const angle = (i / 26) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(angle), Math.sin(angle)] as [number, number];
  });
  const vowels = new Set(letters.filter((c) => 'AEIOUY'.includes(c)));
  return { points, symmetry: Math.max(1, vowels.size) };
}

export interface LissajousParams {
  /** left-ear frequency */
  fl: number;
  /** right-ear frequency */
  fr: number;
}

/**
 * The player's figure. x from the left ear, y from the right: when the two
 * differ by the beat frequency, the closed curve precesses once per beat. The
 * beat is not illustrated, it is the rotation.
 */
export function lissajous(p: LissajousParams, phase: number, samples: number): [number, number][] {
  const points: [number, number][] = [];
  const ratio = p.fl === 0 ? 1 : p.fr / p.fl;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    points.push([Math.sin(t), Math.sin(t * ratio + phase)]);
  }
  return points;
}

/** Two hairline gratings; their moiré is the interference you are hearing. */
export function moireAngle(beat: number, carrier: number): number {
  const spread = Math.min(0.35, beat / Math.max(1, carrier) * 8);
  return spread;
}

export function polygon(sides: number, radius: number, rotation = 0): [number, number][] {
  const points: [number, number][] = [];
  const n = Math.max(2, Math.round(sides));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rotation - Math.PI / 2;
    points.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return points;
}
