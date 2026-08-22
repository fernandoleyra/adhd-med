import { describe, expect, it } from 'vitest';
import { auditScript, cleanLayer, cleanScript, OPEN, TESTED } from '../../src/core/ranges.js';
import { SCHEMA_VERSION, layer, needsHeadphones, segmentAt, segmentStarts, soundingFreq } from '../../src/core/types.js';

describe('validation and safety ranges', () => {
  it('accepts garbage and returns something playable', () => {
    for (const junk of [null, undefined, 0, 'x', [], {}, { segments: 'no' }, { segments: [] }]) {
      const script = cleanScript(junk);
      expect(script.v).toBe(SCHEMA_VERSION);
      expect(script.segments.length).toBeGreaterThan(0);
      expect(script.segments[0]!.layers.length).toBeGreaterThan(0);
    }
  });

  it('clamps to the tested envelope by default', () => {
    const l = cleanLayer({ carrier: 99999, beat: -5, gain: 12, pan: -9, ratio: 1000, detune: 5000 }, TESTED);
    expect(l.carrier).toBe(TESTED.carrier[1]);
    expect(l.beat).toBe(0);
    expect(l.gain).toBe(1);
    expect(l.pan).toBe(-1);
    expect(l.ratio).toBe(TESTED.ratio[1]);
    expect(l.detune).toBe(TESTED.detune[1]);
  });

  it('opens up when the script asks for it, but never past OPEN', () => {
    const tested = cleanScript({ segments: [{ layers: [{ beat: 200, carrier: 6000 }] }] });
    expect(tested.segments[0]!.layers[0]!.beat).toBe(TESTED.beat[1]);

    const open = cleanScript({ unsafe: true, segments: [{ layers: [{ beat: 200, carrier: 6000 }] }] });
    expect(open.segments[0]!.layers[0]!.beat).toBe(200);
    expect(open.segments[0]!.layers[0]!.carrier).toBe(6000);

    const absurd = cleanScript({ unsafe: true, segments: [{ layers: [{ beat: 1e9, carrier: 1e9 }] }] });
    expect(absurd.segments[0]!.layers[0]!.beat).toBe(OPEN.beat[1]);
    expect(absurd.segments[0]!.layers[0]!.carrier).toBe(OPEN.carrier[1]);
  });

  it('caps how much there can be of everything', () => {
    const big = cleanScript({
      segments: Array.from({ length: 500 }, () => ({ layers: Array.from({ length: 50 }, () => ({})) })),
    });
    expect(big.segments.length).toBe(TESTED.segments);
    expect(big.segments[0]!.layers.length).toBe(TESTED.layers);

    const harmonics = cleanLayer({ wave: { kind: 'custom', harmonics: Array.from({ length: 200 }, () => 5) } }, TESTED);
    expect(harmonics.wave.harmonics!.length).toBe(TESTED.harmonics);
    expect(Math.max(...harmonics.wave.harmonics!)).toBe(1);
  });

  it('falls back to safe defaults for bad enums', () => {
    const l = cleanLayer({ method: 'telepathy', wave: { kind: 'wobble' }, color: 'octarine', filter: { kind: 'magic' } }, TESTED);
    expect(l.method).toBe('binaural');
    expect(l.wave.kind).toBe('sine');
    expect(l.color).toBe('pink');
    expect(l.filter!.kind).toBe('lowpass');
  });

  it('drops empty mods and keeps real ones', () => {
    const l = cleanLayer({ mods: [{ target: 'beat' }, { target: 'beat', from: 4, to: 8 }, { target: 'nope', expr: 'b' }] }, TESTED);
    expect(l.mods).toHaveLength(2);
    expect(l.mods[1]!.target).toBe('gain'); // unknown target falls back
  });

  it('truncates long strings rather than trusting them', () => {
    const script = cleanScript({ title: 'x'.repeat(400), note: 'y'.repeat(900), segments: [{ label: 'z'.repeat(200), why: 'w'.repeat(900), layers: [{}] }] });
    expect(script.title.length).toBeLessThanOrEqual(64);
    expect(script.note!.length).toBeLessThanOrEqual(600);
    expect(script.segments[0]!.label!.length).toBeLessThanOrEqual(48);
    expect(script.segments[0]!.why!.length).toBeLessThanOrEqual(200);
  });

  it('flags the things a listener should know about', () => {
    const loud = cleanScript({
      unsafe: true,
      segments: [{ layers: [{ beat: 120, gain: 1 }, { beat: 90, gain: 1 }, { carrier: 9000, ratio: 1, gain: 0.8 }] }],
    });
    const notes = auditScript(loud);
    expect(notes.join(' ')).toMatch(/researched range/);
    expect(notes.join(' ')).toMatch(/4 kHz/);
    expect(notes.join(' ')).toMatch(/limiter/);
    expect(notes.join(' ')).toMatch(/experimental/);
    expect(auditScript(cleanScript({ segments: [{ layers: [{ beat: 10, gain: 0.5 }] }] }))).toHaveLength(0);
  });

  it('answers the practical questions about a script', () => {
    const script = cleanScript({
      segments: [
        { dur: 60, layers: [layer({ method: 'binaural' })] },
        { dur: 120, layers: [layer({ method: 'isochronic' })] },
      ],
    });
    expect(needsHeadphones(script)).toBe(true);
    expect(needsHeadphones(cleanScript({ segments: [{ layers: [layer({ method: 'isochronic', pan: 0 })] }] }))).toBe(false);
    expect(segmentStarts(script)).toEqual([0, 60]);
    expect(segmentAt(script, 90)).toEqual({ index: 1, offset: 30 });
    expect(segmentAt(script, 0)).toEqual({ index: 0, offset: 0 });
    expect(soundingFreq(layer({ carrier: 200, ratio: 1.5 }))).toBe(300);
  });
});

describe('audit notes', () => {
  it('warns when a binaural layer is balanced hard enough to lose the beat', () => {
    const hard = cleanScript({ segments: [{ layers: [layer({ method: 'binaural', pan: -0.9 })] }] });
    expect(auditScript(hard).join(' ')).toMatch(/balanced hard/);
    const gentle = cleanScript({ segments: [{ layers: [layer({ method: 'binaural', pan: -0.4 })] }] });
    expect(auditScript(gentle).join(' ')).not.toMatch(/balanced hard/);
    // panning a speaker-safe layer is unremarkable
    const mono = cleanScript({ segments: [{ layers: [layer({ method: 'isochronic', pan: -1 })] }] });
    expect(auditScript(mono).join(' ')).not.toMatch(/balanced hard/);
  });
});
