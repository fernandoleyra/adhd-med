import { describe, expect, it } from 'vitest';
import { bandLabel, bandOf, centsBetween, derivation, fold, foldPeriod, formatNumber } from '../../src/core/octave.js';

describe('octave transposition', () => {
  it('lands inside the target window', () => {
    for (const n of [0.001, 0.1, 1, 7.83, 137.5, 440, 9192631770, 1.42e9]) {
      const f = fold(n);
      expect(f.hz, `${n}`).toBeGreaterThanOrEqual(128);
      expect(f.hz, `${n}`).toBeLessThan(256);
      expect(f.hz).toBeCloseTo(n * 2 ** f.k, 6);
    }
  });

  it('reproduces the published cosmic-octave tones', () => {
    // These are the numbers Cousto's tuning forks are cut to; the app computes
    // them from the raw periods rather than hardcoding them.
    expect(foldPeriod(86400).hz).toBeCloseTo(194.18, 1);
    expect(foldPeriod(31556925.97).hz).toBeCloseTo(136.1, 1);
    expect(foldPeriod(2551443).hz).toBeCloseTo(210.42, 1);
    expect(foldPeriod(7600530).hz).toBeCloseTo(141.27, 1);
    expect(foldPeriod(19414166).hz).toBeCloseTo(221.23, 1);
    expect(foldPeriod(59355072).hz).toBeCloseTo(144.72, 1);
    expect(foldPeriod(929596608).hz).toBeCloseTo(147.85, 1);
    expect(foldPeriod(817956000000).hz).toBeCloseTo(172.06, 0);
  });

  it('reproduces the physical constants', () => {
    expect(fold(9192631770).hz).toBeCloseTo(136.98, 1);
    expect(fold(1420405751.768).hz).toBeCloseTo(169.33, 1);
    expect(fold(160.23e9).hz).toBeCloseTo(149.24, 1);
    expect(fold(1).hz).toBe(128);
    expect(fold(13.5).hz).toBe(216); // an octave below the 432 the lore likes
  });

  it('refuses to loop forever on nonsense', () => {
    expect(fold(0).hz).toBe(128);
    expect(fold(-5).hz).toBe(128);
    expect(fold(NaN).hz).toBe(128);
  });

  it('writes the derivation the way the UI shows it', () => {
    expect(derivation(fold(7.83), 'Hz')).toBe('7.83 Hz → ×2^5 → 250.56 Hz');
    expect(derivation(fold(963), 'Hz')).toBe('963 Hz → ÷2^2 → 240.75 Hz');
  });

  it('maps frequencies to bands', () => {
    expect(bandOf(2)).toBe('delta');
    expect(bandOf(6)).toBe('theta');
    expect(bandOf(10)).toBe('alpha');
    expect(bandOf(13.5)).toBe('smr');
    expect(bandOf(18)).toBe('beta');
    expect(bandOf(40)).toBe('gamma');
    expect(bandOf(0.2)).toBeNull();
    expect(bandLabel(0.2)).toBe('sub-delta');
    expect(bandLabel(200)).toBe('above gamma');
    expect(bandLabel(0)).toBe('silent');
  });

  it('measures intervals in cents', () => {
    expect(centsBetween(220, 440)).toBeCloseTo(1200, 6);
    expect(centsBetween(200, 300)).toBeCloseTo(701.955, 2);
  });

  it('formats numbers for a monospace column', () => {
    expect(formatNumber(7.83)).toBe('7.83');
    expect(formatNumber(440)).toBe('440');
    expect(formatNumber(86400)).toBe('86,400');
    expect(formatNumber(0.1)).toBe('0.1000');
    expect(formatNumber(9192631770)).toContain('×10^');
  });
});
