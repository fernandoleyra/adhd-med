import { describe, expect, it } from 'vitest';
import { decodeScript, encodeScript, packScript, unpackScript } from '../../src/core/codec.js';
import { generate } from '../../src/core/generate.js';
import { logosScript } from '../../src/core/logos.js';
import { cleanScript } from '../../src/core/ranges.js';
import { layer, type Script } from '../../src/core/types.js';

const elaborate: Script = cleanScript({
  v: 2,
  title: 'Everything at once',
  note: 'a stress test',
  seed: 12345,
  unsafe: true,
  origin: 'lab',
  segments: [
    {
      dur: 480,
      label: 'one',
      why: 'because',
      layers: [
        layer({
          method: 'binaural',
          carrier: 137.5,
          beat: 7.83,
          ratio: 1.5,
          detune: -35,
          gain: 0.42,
          pan: -0.6,
          wave: { kind: 'custom', harmonics: [1, 0.5, 0.25, 0.125] },
          am: { rate: 0.1, depth: 0.45, wave: 'triangle' },
          fm: { rate: 3, depth: 22, wave: 'square' },
          filter: { kind: 'bandpass', freq: 880, q: 4.5 },
          mods: [
            { target: 'beat', from: 7.83, to: 14.3, curve: 'sine' },
            { target: 'carrier', expr: 'b * (1 + 0.05*sin(tau*u))', jitter: 0.5 },
          ],
        }),
        layer({ kind: 'noise', color: 'violet', method: 'tone', gain: 0.2, mute: true }),
      ],
    },
    { dur: 120, label: 'two', layers: [layer({ method: 'isochronic', beat: 40, carrier: 320 })] },
  ],
});

describe('share-link codec', () => {
  it('round-trips a complicated session exactly', async () => {
    const payload = await encodeScript(elaborate);
    const back = await decodeScript(payload);
    expect(back).toEqual(elaborate);
  });

  it('round-trips every generated arc', async () => {
    for (const goal of ['focus', 'deep', 'study', 'read', 'calm', 'unwind', 'meditate', 'sleep', 'spark'] as const) {
      const script = generate({ goal, minutes: 25, seed: 3 });
      const back = await decodeScript(await encodeScript(script));
      expect(back, goal).toEqual(cleanScript(script));
    }
  });

  it('round-trips a word session', async () => {
    const { script } = logosScript('slow down');
    const back = await decodeScript(await encodeScript(script));
    expect(back).toEqual(cleanScript(script));
  });

  it('stays small enough for a URL', async () => {
    const payload = await encodeScript(generate({ goal: 'study', minutes: 90, seed: 1 }));
    expect(payload.length).toBeLessThan(1500);
  });

  it('reads the uncompressed form too', async () => {
    const raw = JSON.stringify(packScript(elaborate));
    const b64 = Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const back = await decodeScript(`0.${b64}`);
    expect(back?.title).toBe('Everything at once');
  });

  it('refuses nonsense instead of throwing', async () => {
    for (const bad of ['', 'x', 'nope', '9.abc', '1.!!!!', '0.eyJib2d1cyI6']) {
      await expect(decodeScript(bad)).resolves.toSatisfy((v) => v === null || typeof v === 'object');
    }
  });

  it('clamps a hostile payload to something safe to play', async () => {
    const hostile = {
      t: 'x'.repeat(500),
      x: 1,
      g: [
        {
          d: 999999,
          y: Array.from({ length: 200 }, () => ({ c: 1e9, b: 1e6, g: 99, p: 50 })),
        },
      ],
    };
    const raw = Buffer.from(JSON.stringify(hostile), 'utf8').toString('base64url');
    const script = await decodeScript(`0.${raw}`);
    expect(script).not.toBeNull();
    expect(script!.title.length).toBeLessThanOrEqual(64);
    expect(script!.segments[0]!.layers.length).toBeLessThanOrEqual(16);
    for (const l of script!.segments[0]!.layers) {
      expect(l.carrier).toBeLessThanOrEqual(14000);
      expect(l.beat).toBeLessThanOrEqual(400);
      expect(l.gain).toBeLessThanOrEqual(1);
      expect(Math.abs(l.pan)).toBeLessThanOrEqual(1);
    }
    expect(script!.segments[0]!.dur).toBeLessThanOrEqual(14400);
  });

  it('shortens keys on the way out and restores them on the way in', () => {
    const packed = packScript(elaborate) as Record<string, unknown>;
    expect(Object.keys(packed)).toContain('g');
    expect(Object.keys(packed)).not.toContain('segments');
    const restored = unpackScript(packed) as { segments: unknown[] };
    expect(Array.isArray(restored.segments)).toBe(true);
  });
});
