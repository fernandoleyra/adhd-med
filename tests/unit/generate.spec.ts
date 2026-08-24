import { describe, expect, it } from 'vitest';
import { ARCS, DURATIONS, generate, GOALS, MOODS, PRESETS, preset, surprise } from '../../src/core/generate.js';
import { cleanScript } from '../../src/core/ranges.js';
import { bandOf } from '../../src/core/octave.js';
import { totalSeconds } from '../../src/core/types.js';

const FOCUS_FAMILY = ['focus', 'deep', 'study', 'read', 'spark'] as const;

describe('scripted DJ', () => {
  it('produces a valid, playable session for every combination', () => {
    for (const goal of GOALS) {
      for (const minutes of DURATIONS) {
        const script = generate({ goal: goal.id, minutes, seed: 5 });
        expect(script.segments.length, `${goal.id}/${minutes}`).toBeGreaterThan(0);
        expect(script).toEqual(cleanScript(script));
        for (const seg of script.segments) {
          expect(seg.dur).toBeGreaterThan(0);
          expect(seg.layers.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('lands within 12% of the requested length', () => {
    for (const goal of GOALS) {
      for (const minutes of [15, 25, 45, 90]) {
        const actual = totalSeconds(generate({ goal: goal.id, minutes, seed: 1 })) / 60;
        expect(Math.abs(actual - minutes) / minutes, `${goal.id}/${minutes}`).toBeLessThan(0.12);
      }
    }
  });

  it('never parks a focus session in theta', () => {
    for (const goal of FOCUS_FAMILY) {
      for (const mood of MOODS) {
        const script = generate({ goal, moods: [mood.id], minutes: 45, seed: 2 });
        for (const seg of script.segments) {
          for (const l of seg.layers) {
            if (l.kind !== 'tone' || l.method === 'tone') continue;
            const band = bandOf(l.beat);
            expect(band, `${goal}/${mood.id} sat in ${band} at ${l.beat} Hz`).not.toBe('theta');
            expect(band).not.toBe('delta');
            // and sweeps must not descend into theta either
            for (const mod of l.mods) {
              if (mod.target !== 'beat') continue;
              for (const v of [mod.from, mod.to]) {
                if (v === undefined) continue;
                expect(v, `${goal} swept to ${v} Hz`).toBeGreaterThanOrEqual(8);
              }
            }
          }
        }
      }
    }
  });

  it('takes calm and sleep down into theta and delta, where the evidence is', () => {
    const calm = generate({ goal: 'calm', minutes: 15, seed: 1 });
    const beats = calm.segments.flatMap((s) => s.layers.map((l) => l.beat));
    expect(Math.min(...beats)).toBeLessThanOrEqual(8);

    const sleep = generate({ goal: 'sleep', minutes: 45, seed: 1 });
    const sleepBeats = sleep.segments.flatMap((s) =>
      s.layers.flatMap((l) => [l.beat, ...l.mods.filter((m) => m.target === 'beat').map((m) => m.to ?? l.beat)]),
    );
    expect(Math.min(...sleepBeats)).toBeLessThan(4);
    // and it must fade out rather than stopping abruptly
    const last = sleep.segments.at(-1)!;
    expect(last.layers.some((l) => l.mods.some((m) => m.target === 'gain' && (m.to ?? 1) === 0))).toBe(true);
  });

  it('always opens with an onset ramp, per the meta-analysis', () => {
    for (const goal of GOALS) {
      const script = generate({ goal: goal.id, minutes: 25, seed: 1 });
      const first = script.segments[0]!;
      expect(first.dur, goal.id).toBeGreaterThanOrEqual(60);
      expect(first.why, goal.id).toBeTruthy();
    }
  });

  it('is deterministic: same inputs, same session', () => {
    const a = generate({ goal: 'deep', moods: ['restless'], minutes: 45, seed: 99 });
    const b = generate({ goal: 'deep', moods: ['restless'], minutes: 45, seed: 99 });
    expect(a).toEqual(b);
    const c = generate({ goal: 'deep', moods: ['restless'], minutes: 45, seed: 100 });
    expect(JSON.stringify(a) === JSON.stringify(c)).toBe(false);
  });

  it('applies the mood modifiers it advertises', () => {
    const plain = generate({ goal: 'focus', minutes: 45, seed: 1 });
    const anxious = generate({ goal: 'focus', moods: ['anxious'], minutes: 45, seed: 1 });
    expect(anxious.segments[0]!.label).toBe('prelude');
    expect(anxious.segments.some((s) => s.layers.some((l) => l.kind === 'noise'))).toBe(true);

    const restless = generate({ goal: 'deep', moods: ['restless'], minutes: 45, seed: 1 });
    expect(restless.segments.length).toBeGreaterThan(plain.segments.length);

    const wired = generate({ goal: 'focus', moods: ['wired'], minutes: 45, seed: 1 });
    expect(wired.segments[0]!.layers[0]!.carrier).toBeLessThan(plain.segments[0]!.layers[0]!.carrier);
  });

  it('honours a speaker-safe delivery request everywhere', () => {
    for (const goal of GOALS) {
      const script = generate({ goal: goal.id, minutes: 25, seed: 1, method: 'isochronic' });
      for (const seg of script.segments) {
        for (const l of seg.layers) {
          if (l.kind === 'tone') expect(['isochronic', 'tone']).toContain(l.method);
        }
      }
    }
  });


  it('ships a preset for every named card', () => {
    for (const p of PRESETS) {
      const script = preset(p.id);
      expect(script, p.id).not.toBeNull();
      expect(script!.title).toBe(p.name);
      expect(Math.abs(totalSeconds(script!) / 60 - p.minutes) / p.minutes).toBeLessThan(0.12);
    }
    expect(preset('does-not-exist')).toBeNull();
  });

  it('rolls reproducible surprises', () => {
    expect(surprise(1234)).toEqual(surprise(1234));
    expect(Object.keys(ARCS)).toHaveLength(GOALS.length);
  });
});
