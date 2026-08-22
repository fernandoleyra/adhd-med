/** Deterministic randomness. Same seed, same session — always. */

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, good enough for making music out of numbers. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash-based value in [0,1) for a coordinate — no state, no order dependence. */
export function hashUnit(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Smooth deterministic noise over a continuous coordinate. */
export function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashUnit(seed, i);
  const b = hashUnit(seed, i + 1);
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}

export function pickFrom<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length) % items.length]!;
}

/** A seed the user can read, remember and retype. */
export function seedWord(seed: number): string {
  const parts = ['ka', 'lo', 'ma', 'ne', 'ri', 'sa', 'to', 'vu', 'ze', 'bi', 'da', 'fe', 'gi', 'hu', 'ja', 'ko'];
  let n = seed >>> 0;
  let out = '';
  for (let i = 0; i < 3; i++) {
    out += parts[n % parts.length]!;
    n = Math.floor(n / parts.length);
  }
  return out;
}
