import { describe, expect, it } from 'vitest';
import {
  baseValue,
  beatTrace,
  combine,
  isCurve,
  layerSeed,
  planMods,
  resolveTarget,
  SAMPLE_HZ,
  valueAt,
} from '../../src/core/automation.js';
import { TESTED, cleanScript, envelopeFor } from '../../src/core/ranges.js';
import { layer, type Script } from '../../src/core/types.js';

describe('automation', () => {
  it('reads base values off the layer', () => {
    const l = layer({ carrier: 200, beat: 12, gain: 0.4, pan: -0.5, filter: { kind: 'lowpass', freq: 900, q: 1 }, am: { rate: 3, depth: 0.5, wave: 'sine' } });
    expect(baseValue(l, 'carrier')).toBe(200);
    expect(baseValue(l, 'beat')).toBe(12);
    expect(baseValue(l, 'gain')).toBe(0.4);
    expect(baseValue(l, 'pan')).toBe(-0.5);
    expect(baseValue(l, 'filterFreq')).toBe(900);
    expect(baseValue(l, 'amRate')).toBe(3);
    expect(baseValue(l, 'fmDepth')).toBe(0);
  });

  it('sweeps from → to across the segment', () => {
    const l = layer({ beat: 10, mods: [{ target: 'beat', from: 10, to: 20, curve: 'lin' }] });
    const plans = planMods(l, TESTED);
    expect(valueAt(10, plans.get('beat'), 0, 600, 1)).toBeCloseTo(10, 6);
    expect(valueAt(10, plans.get('beat'), 300, 600, 1)).toBeCloseTo(15, 6);
    expect(valueAt(10, plans.get('beat'), 600, 600, 1)).toBeCloseTo(20, 6);
  });

  it('lets an equation see the base value and the clock', () => {
    const l = layer({ beat: 10, mods: [{ target: 'beat', expr: 'b + 10*u' }] });
    const plans = planMods(l, TESTED);
    expect(valueAt(10, plans.get('beat'), 0, 100, 1)).toBeCloseTo(10, 6);
    expect(valueAt(10, plans.get('beat'), 50, 100, 1)).toBeCloseTo(15, 6);
  });

  it('clamps automation to the envelope, so an equation cannot escape it', () => {
    const l = layer({ beat: 10, mods: [{ target: 'beat', expr: '99999' }] });
    const plans = planMods(l, TESTED);
    expect(valueAt(10, plans.get('beat'), 0, 60, 1)).toBe(TESTED.beat[1]);
  });

  it('drops an invalid equation instead of failing the session', () => {
    const l = layer({ beat: 10, mods: [{ target: 'beat', expr: 'window.alert(1)' }] });
    const plans = planMods(l, TESTED);
    expect(plans.has('beat')).toBe(false);
    expect(valueAt(10, undefined, 0, 60, 1)).toBe(10);
  });

  it('returns a constant when nothing is automated, and a curve when something is', () => {
    const plain = layer({ beat: 10 });
    const moving = layer({ beat: 10, mods: [{ target: 'beat', from: 10, to: 14 }] });
    const plans = planMods(moving, TESTED);
    expect(isCurve(resolveTarget(plain, 'beat', planMods(plain, TESTED), 60, 0, 1))).toBe(false);
    const curve = resolveTarget(moving, 'beat', plans, 60, 0, 1);
    expect(isCurve(curve)).toBe(true);
    if (isCurve(curve)) {
      expect(curve.length).toBe(Math.ceil(60 * SAMPLE_HZ));
      expect(curve[0]).toBeCloseTo(10, 4);
      expect(curve.at(-1)).toBeCloseTo(14, 4);
    }
  });

  it('starts a curve at the seek offset', () => {
    const l = layer({ beat: 10, mods: [{ target: 'beat', from: 10, to: 20, curve: 'lin' }] });
    const curve = resolveTarget(l, 'beat', planMods(l, TESTED), 100, 50, 1);
    expect(isCurve(curve)).toBe(true);
    if (isCurve(curve)) expect(curve[0]).toBeCloseTo(15, 3);
  });

  it('drifts deterministically', () => {
    const l = layer({ beat: 10, mods: [{ target: 'beat', jitter: 2 }] });
    const plans = planMods(l, TESTED);
    const a = valueAt(10, plans.get('beat'), 33, 60, 42);
    const b = valueAt(10, plans.get('beat'), 33, 60, 42);
    const c = valueAt(10, plans.get('beat'), 33, 60, 43);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(Math.abs(a - 10)).toBeLessThanOrEqual(2);
  });

  it('combines curves and constants sample-wise', () => {
    const constant = combine(200, 10, (a, b) => a - b / 2);
    expect(constant).toBe(195);
    const l = layer({ beat: 10, mods: [{ target: 'beat', from: 10, to: 20 }] });
    const curve = resolveTarget(l, 'beat', planMods(l, TESTED), 10, 0, 1);
    const mixed = combine(200, curve, (a, b) => a + b);
    expect(isCurve(mixed)).toBe(true);
    if (isCurve(mixed)) {
      expect(mixed[0]).toBeCloseTo(210, 3);
      expect(mixed.at(-1)).toBeCloseTo(220, 3);
    }
  });

  it('gives each layer its own stable seed', () => {
    const script: Script = { v: 2, title: 't', seed: 5, segments: [] };
    expect(layerSeed(script, 0, 0)).toBe(layerSeed(script, 0, 0));
    expect(layerSeed(script, 0, 0)).not.toBe(layerSeed(script, 0, 1));
    expect(layerSeed(script, 0, 0)).not.toBe(layerSeed(script, 1, 0));
  });

  it('traces the leading beat for the timeline drawing', () => {
    const script = cleanScript({
      segments: [
        { dur: 60, layers: [layer({ beat: 10, gain: 0.2 }), layer({ beat: 16, gain: 0.9, mods: [{ target: 'beat', from: 16, to: 8 }] })] },
      ],
    });
    const trace = beatTrace(script, 0, 5);
    expect(trace).toHaveLength(5);
    expect(trace[0]).toBeCloseTo(16, 1); // the loudest beating layer leads
    expect(trace.at(-1)).toBeCloseTo(8, 1);
    expect(beatTrace(script, 9)).toEqual([]);
  });

  it('uses the wider envelope when a script is experimental', () => {
    expect(envelopeFor({ unsafe: true }).beat[1]).toBeGreaterThan(envelopeFor({}).beat[1]);
  });
});
