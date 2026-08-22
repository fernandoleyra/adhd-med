import { describe, expect, it } from 'vitest';
import { baseHz, ENTRIES, entryMath, entryScript, searchEntries, stackScript, TIER_NOTES } from '../../src/core/codex.js';
import { CARRIER_LO, CARRIER_HI } from '../../src/core/octave.js';
import { cleanScript } from '../../src/core/ranges.js';
import { totalSeconds } from '../../src/core/types.js';

describe('codex catalogue', () => {
  it('has every tier documented', () => {
    expect(Object.keys(TIER_NOTES).sort()).toEqual(['lore', 'measured', 'protocol']);
  });

  it('is well formed: unique ids, real tiers, a note and a source each', () => {
    const ids = new Set<string>();
    for (const e of ENTRIES) {
      expect(ids.has(e.id), `duplicate id ${e.id}`).toBe(false);
      ids.add(e.id);
      expect(['measured', 'protocol', 'lore'], e.id).toContain(e.tier);
      expect(['band', 'frequency', 'period', 'number', 'protocol'], e.id).toContain(e.kind);
      expect(e.note.length, e.id).toBeGreaterThan(20);
      expect(e.source.length, e.id).toBeGreaterThan(3);
      // Every entry must be playable one way or the other.
      expect(Boolean(e.value !== undefined || e.stages?.length), e.id).toBe(true);
    }
    expect(ENTRIES.length).toBeGreaterThanOrEqual(35);
  });

  it('puts every numeric entry in a sensible carrier and beat range', () => {
    for (const e of ENTRIES) {
      const math = entryMath(e);
      if (!math) continue;
      expect(math.carrier.hz, e.id).toBeGreaterThanOrEqual(CARRIER_LO);
      expect(math.carrier.hz, e.id).toBeLessThan(CARRIER_HI);
      expect(math.beat.hz, e.id).toBeGreaterThan(0);
      expect(math.beat.hz, e.id).toBeLessThanOrEqual(40);
      expect(math.lines.length, e.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the brainwave bands at their own frequency, unshifted', () => {
    for (const id of ['delta', 'theta', 'alpha', 'smr', 'beta', 'gamma40']) {
      const e = ENTRIES.find((x) => x.id === id)!;
      const math = entryMath(e)!;
      expect(math.beat.hz, id).toBe(e.value);
      expect(math.lines.some((l) => l.includes('already a brainwave rate'))).toBe(true);
    }
  });

  it('computes the astronomy from raw periods, not hardcoded tones', () => {
    const cases: [string, number][] = [
      ['earth-day', 194.18],
      ['earth-year', 136.1],
      ['moon', 210.42],
      ['mercury', 141.27],
      ['venus', 221.23],
      ['mars', 144.72],
      ['jupiter', 183.58],
      ['saturn', 147.85],
      ['platonic-year', 172.06],
    ];
    for (const [id, hz] of cases) {
      const e = ENTRIES.find((x) => x.id === id)!;
      expect(e.kind, id).toBe('period');
      expect(entryMath(e)!.carrier.hz, id).toBeCloseTo(hz, 0);
    }
  });

  it('files the unit-error entries under lore, where they belong', () => {
    for (const id of ['light', 'pi', 'euler', 'phi']) {
      expect(ENTRIES.find((e) => e.id === id)!.tier, id).toBe('lore');
    }
    // and the genuinely measured quantities under measured
    for (const id of ['schumann', 'caesium', 'hydrogen', 'cmb', 'earth-day']) {
      expect(ENTRIES.find((e) => e.id === id)!.tier, id).toBe('measured');
    }
    expect(ENTRIES.find((e) => e.id === 'light')!.note).toMatch(/unit error/i);
  });

  it('turns every entry into a valid session', () => {
    for (const e of ENTRIES) {
      const script = entryScript(e, { method: 'monaural' });
      expect(script, e.id).toEqual(cleanScript(script));
      expect(totalSeconds(script), e.id).toBeGreaterThan(60);
      expect(script.segments.length, e.id).toBeGreaterThan(0);
    }
  });

  it('gives every protocol an arc with reasons attached', () => {
    for (const e of ENTRIES.filter((x) => x.tier === 'protocol')) {
      expect(e.stages?.length, e.id).toBeGreaterThan(0);
      for (const s of e.stages!) {
        expect(s.minutes, e.id).toBeGreaterThan(0);
        expect(s.beat, e.id).toBeGreaterThan(0);
        expect(s.why, e.id).toBeTruthy();
      }
    }
  });

  it('compounds a stack with one beat and the rest as drones', () => {
    const picks = ['schumann', 'earth-year', 'a432'].map((id) => ENTRIES.find((e) => e.id === id)!);
    const script = stackScript(picks)!;
    expect(script.segments).toHaveLength(1);
    const layers = script.segments[0]!.layers;
    const beating = layers.filter((l) => l.kind === 'tone' && l.method !== 'tone');
    expect(beating).toHaveLength(1);
    expect(beating[0]!.beat).toBeCloseTo(7.83, 2);
    expect(layers.filter((l) => l.method === 'tone' && l.kind === 'tone').length).toBe(2);
    expect(stackScript([])).toBeNull();
  });

  it('searches names, notes and sources', () => {
    expect(searchEntries('schumann').map((e) => e.id)).toContain('schumann');
    expect(searchEntries('gateway').length).toBeGreaterThan(0);
    expect(searchEntries('solfeggio').length).toBeGreaterThanOrEqual(5);
    expect(searchEntries('').length).toBe(ENTRIES.length);
    expect(searchEntries('zzzzz')).toHaveLength(0);
  });

  it('reads a period as a frequency', () => {
    const day = ENTRIES.find((e) => e.id === 'earth-day')!;
    expect(baseHz(day)).toBeCloseTo(1 / 86400, 12);
  });
});
