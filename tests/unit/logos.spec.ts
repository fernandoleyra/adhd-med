import { describe, expect, it } from 'vitest';
import { logosScript, readWord, VOWEL_BEATS } from '../../src/core/logos.js';
import { JUST_PENTATONIC } from '../../src/core/octave.js';
import { cleanScript } from '../../src/core/ranges.js';

describe('words into frequencies', () => {
  it('derives the documented example', () => {
    const calm = readWord('CALM');
    // C3 A1 L12 M13 = 29 → ×2^2 → 116 Hz
    expect(calm.sum).toBe(29);
    expect(calm.root).toBeCloseTo(116, 6);
    expect(calm.rootOctaves).toBe(2);
    expect(calm.beat).toBe(VOWEL_BEATS.A);
  });

  it('puts the root between 110 and 220 Hz for any word', () => {
    for (const word of ['a', 'zzzzzzzz', 'mitochondria', 'x', 'aeiou', 'Rhythm', 'STRENGTHS']) {
      const r = readWord(word);
      expect(r.root, word).toBeGreaterThanOrEqual(110);
      expect(r.root, word).toBeLessThan(220);
    }
  });

  it('only ever uses pentatonic ratios, so nothing can clash', () => {
    const r = readWord('abcdefghijklmnopqrstuvwxyz');
    for (const step of r.steps) {
      expect(JUST_PENTATONIC).toContain(step.ratio);
      expect([1, 2]).toContain(step.octave);
    }
  });

  it('picks the dominant vowel, not merely the first', () => {
    expect(readWord('BANANA').beat).toBe(VOWEL_BEATS.A);
    expect(readWord('ENOUGH').vowel).toBeTruthy();
    expect(readWord('RHYTHM').beat).toBe(VOWEL_BEATS.Y);
    expect(readWord('BRR').beat).toBe(10); // no vowel at all
  });

  it('is deterministic and survives validation', () => {
    const a = logosScript('slow down');
    const b = logosScript('slow down');
    expect(a.script).toEqual(b.script);
    expect(a.script).toEqual(cleanScript(a.script));
  });

  it('makes one segment per word, in order', () => {
    const { script, readings } = logosScript('finish the thing');
    expect(script.segments).toHaveLength(3);
    expect(script.segments.map((s) => s.label)).toEqual(['FINISH', 'THE', 'THING']);
    expect(readings[0]!.word).toBe('finish');
  });

  it('keeps at most five voices and low-passes the partials', () => {
    const { script } = logosScript('mitochondria');
    const layers = script.segments[0]!.layers;
    expect(layers.length).toBeLessThanOrEqual(5);
    for (const l of layers.slice(1)) {
      expect(l.method).toBe('tone');
      expect(l.filter?.kind).toBe('lowpass');
      expect(l.gain).toBeLessThan(layers[0]!.gain);
    }
  });

  it('handles punctuation, numbers and emptiness without breaking', () => {
    expect(readWord('!!!').letters).toHaveLength(0);
    expect(readWord('!!!').root).toBeGreaterThan(0);
    const { script } = logosScript('   ');
    expect(script.segments.length).toBeGreaterThan(0);
    expect(script.title).toBe('SILENCE');
  });

  it('respects an explicit length', () => {
    const { script } = logosScript('calm', { minutes: 10 });
    expect(script.segments[0]!.dur).toBe(600);
  });
});
