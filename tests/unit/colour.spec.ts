import { describe, expect, it } from 'vitest';
import { C_LIGHT, colourName, hueWavelength, PALETTE_HUES, readColour } from '../../src/core/colour.js';
import { generate } from '../../src/core/generate.js';
import { CARRIER_HI, CARRIER_LO } from '../../src/core/octave.js';

/**
 * Colour → carrier. The claim being tested is narrow and checkable: this is
 * c/λ and then a power of two, nothing else. If someone later decides violet
 * "should" be higher than red, these tests are what says no.
 */
describe('colour as a frequency', () => {
  it('reads hue as a wavelength across the visible band', () => {
    expect(hueWavelength(0)).toBeCloseTo(700, 6); // red
    expect(hueWavelength(270)).toBeCloseTo(400, 6); // violet
    expect(hueWavelength(135)).toBeCloseTo(550, 6); // green, halfway
  });

  it('folds every colour into the carrier octave', () => {
    for (let hue = 0; hue < 360; hue += 5) {
      const r = readColour(hue);
      expect(r.folded.hz).toBeGreaterThanOrEqual(CARRIER_LO);
      expect(r.folded.hz).toBeLessThan(CARRIER_HI);
    }
  });

  it('is c/λ and nothing else', () => {
    const r = readColour(0);
    expect(r.light).toBeCloseTo(C_LIGHT / 700e-9, -6);
    // The exponent is the whole derivation: undo it and you are back at light.
    expect(r.folded.hz * 2 ** -r.folded.k).toBeCloseTo(r.light, -6);
  });

  // A violet wave is faster than a red one, and halving cannot reorder them:
  // the audible carriers keep the spectrum's order.
  it('keeps violet above red, as the physics has it', () => {
    expect(readColour(262).folded.hz).toBeLessThan(readColour(0).folded.hz);
    expect(readColour(0).light).toBeLessThan(readColour(262).light);
  });

  it('says when a hue is a mix rather than a wavelength', () => {
    expect(readColour(320).extraSpectral).toBe(true);
    expect(readColour(320).lines.join(' ')).toContain('mix');
    expect(readColour(200).extraSpectral).toBe(false);
  });

  // Two chips reading "blue" is a worse interface than one fewer choice.
  it('offers a palette whose names are all distinct', () => {
    const names = PALETTE_HUES.map((h) => colourName(h));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('violet');
    expect(names).toContain('green');
  });

  it('never returns a carrier a validator would have to clamp', () => {
    for (const hue of PALETTE_HUES) {
      const hz = readColour(hue).folded.hz;
      expect(Number.isFinite(hz)).toBe(true);
      expect(hz).toBeGreaterThan(100);
      expect(hz).toBeLessThan(500);
    }
  });
});

/**
 * A colour is an input to a session, not a mood board: it moves the carrier and
 * leaves the arc alone, because the arc is the half with evidence behind it.
 */
describe('a colour retunes an arc without reshaping it', () => {
  const plain = generate({ goal: 'focus', minutes: 25, seed: 7 });
  const violet = readColour(262).folded.hz;
  const tuned = generate({ goal: 'focus', minutes: 25, seed: 7, root: violet });

  it('keeps the arc: same segments, same beats', () => {
    expect(tuned.segments).toHaveLength(plain.segments.length);
    expect(tuned.segments.map((s) => s.layers[0]!.beat)).toEqual(plain.segments.map((s) => s.layers[0]!.beat));
  });

  it('moves every carrier by the same ratio', () => {
    const ratios = tuned.segments.map((s, i) => s.layers[0]!.carrier / plain.segments[i]!.layers[0]!.carrier);
    for (const r of ratios) expect(r).toBeCloseTo(violet / 220, 2);
  });

  it('ignores a root that is not a frequency', () => {
    const nonsense = generate({ goal: 'focus', minutes: 25, seed: 7, root: 0 });
    expect(nonsense.segments[0]!.layers[0]!.carrier).toBe(plain.segments[0]!.layers[0]!.carrier);
  });
});
