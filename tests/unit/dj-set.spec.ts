import { describe, expect, it } from 'vitest';
import { aiSessionToScript } from '../../src/ai/client.js';
import { generate } from '../../src/core/generate.js';
import { readColour } from '../../src/core/colour.js';
import { soundingFreq } from '../../src/core/types.js';

/**
 * A set, not a list of holds.
 *
 * The model answers with the numbers at the ends of each segment; these tests
 * cover what the code does with them — the part that decides whether a session
 * plays like a DJ set or like four dials being set in turn.
 */

const SET = {
  title: 'Long Way Round',
  note: 'Up through SMR, a beta plateau, then down.',
  segments: [
    { minutes: 3, label: 'onset', why: 'pre-task', beat: 10, beatTo: 13, carrier: 200, carrierTo: 200, method: 'binaural' as const, noise: 0.1, noiseColor: 'pink' as const },
    { minutes: 9, label: 'climb', why: 'crossing SMR', beat: 14, beatTo: 16, carrier: 240, carrierTo: 210, method: 'binaural' as const, noise: 0.08, noiseColor: 'pink' as const },
    { minutes: 9, label: 'plateau', why: 'low beta hold', beat: 16, beatTo: 16, carrier: 240, carrierTo: 240, method: 'binaural' as const, noise: 0, noiseColor: 'pink' as const },
    { minutes: 3, label: 'release', why: 'alpha landing', beat: 9, beatTo: 9, carrier: 200, carrierTo: 200, method: 'binaural' as const, noise: 0.1, noiseColor: 'pink' as const },
  ],
};

const script = aiSessionToScript(SET, 'seed');
const lead = (i: number) => script.segments[i]!.layers[0]!;
const modOf = (i: number, target: string) => lead(i).mods.find((m) => m.target === target);

describe('an AI set', () => {
  it('keeps the shape the model asked for', () => {
    expect(script.segments).toHaveLength(4);
    expect(script.title).toBe('Long Way Round');
    expect(script.origin).toBe('dj-ai');
    expect(script.segments.map((s) => s.dur)).toEqual([180, 540, 540, 180]);
  });

  // A set has no jump cuts: segment two opened at 14 in the answer while
  // segment one ended at 13, so it is played from 13.
  it('stitches each segment onto the end of the last', () => {
    expect(lead(0).beat).toBeCloseTo(10, 4);
    expect(modOf(0, 'beat')).toMatchObject({ from: 10, to: 13 });
    expect(lead(1).beat).toBeCloseTo(13, 4);
    expect(modOf(1, 'beat')).toMatchObject({ from: 13, to: 16 });
    // A genuine hold gets no automation at all — 16 to 16 is a held note, and
    // scheduling a ramp between two identical values is just noise in the graph.
    expect(lead(2).beat).toBeCloseTo(16, 4);
    expect(modOf(2, 'beat')).toBeUndefined();
    // The model wrote the release as starting at 9. It lands at 9, but it comes
    // down from where the plateau actually left off rather than cutting there.
    expect(modOf(3, 'beat')).toMatchObject({ from: 16, to: 9 });
  });

  it('glides a carrier the model moved, and leaves a still one alone', () => {
    expect(modOf(1, 'carrier')).toMatchObject({ from: 240, to: 210 });
    expect(modOf(2, 'carrier')).toBeUndefined();
  });

  it('gives a long body segment something to notice', () => {
    // A slow sway, an eighth of the beat — movement, not a wobble.
    expect(lead(1).am).not.toBeNull();
    expect(lead(1).am!.rate).toBeLessThan(lead(1).beat / 4);
    // and a quiet fifth above, at a fraction of the lead's gain
    const fifth = script.segments[1]!.layers.find((l) => l.ratio === 1.5);
    expect(fifth).toBeDefined();
    expect(fifth!.gain).toBeLessThan(lead(1).gain / 2);
    expect(soundingFreq(fifth!)).toBeCloseTo(240 * 1.5, 2);
  });

  it('leaves the onset and the release plain', () => {
    expect(lead(0).am).toBeNull();
    expect(lead(3).am).toBeNull();
    expect(script.segments[0]!.layers.some((l) => l.ratio === 1.5)).toBe(false);
  });

  it('brings the bed in and takes it away', () => {
    const first = script.segments[0]!.layers.find((l) => l.kind === 'noise')!;
    const last = script.segments[3]!.layers.find((l) => l.kind === 'noise')!;
    expect(first.mods.find((m) => m.target === 'gain')).toMatchObject({ from: 0 });
    expect(last.mods.find((m) => m.target === 'gain')).toMatchObject({ to: 0 });
    // A bed the model asked for is never dropped, only shaped.
    expect(first.gain).toBeGreaterThan(0);
  });

  it('still clamps whatever the model sends', () => {
    const hostile = aiSessionToScript(
      {
        title: 'x'.repeat(400),
        note: 'n',
        segments: [
          { minutes: 9999, label: 'l', why: 'w', beat: 1e6, beatTo: -50, carrier: 1e9, carrierTo: 0, method: 'binaural' as const, noise: 99, noiseColor: 'pink' as const },
        ],
      },
      'seed',
    );
    const l = hostile.segments[0]!.layers[0]!;
    expect(hostile.title.length).toBeLessThanOrEqual(64);
    expect(hostile.segments[0]!.dur).toBeLessThanOrEqual(14400);
    expect(l.beat).toBeLessThanOrEqual(400);
    expect(l.carrier).toBeLessThanOrEqual(14000);
    expect(l.gain).toBeLessThanOrEqual(1);
  });
});

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
