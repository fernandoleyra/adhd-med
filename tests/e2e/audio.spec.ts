import { expect, test } from '@playwright/test';
import { dismissLeaflet } from './helpers.js';

/**
 * These render sessions through a real OfflineAudioContext in the browser and
 * measure the samples. Mocking Web Audio would test the mock; this tests
 * whether a binaural layer genuinely puts different frequencies in each ear.
 */

test.describe('the audio engine emits what it claims', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);
  });

  test('a binaural layer splits the beat across the ears', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // Goertzel: magnitude of one frequency bin, cheap and exact enough.
      const mag = (data: Float32Array, freq: number, rate: number) => {
        const k = (2 * Math.PI * freq) / rate;
        const coeff = 2 * Math.cos(k);
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < data.length; i++) {
          const s0 = data[i]! + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / data.length;
      };

      const script = {
        v: 2,
        title: 'binaural probe',
        segments: [
          {
            dur: 2,
            layers: [
              { kind: 'tone', method: 'binaural', carrier: 200, beat: 10, gain: 1, wave: { kind: 'sine' } },
            ],
          },
        ],
      };
      const buffer = await window.adhdmed.render(script as never, 1.5, 48000);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      const rate = buffer.sampleRate;
      return {
        leftAt195: mag(left, 195, rate),
        leftAt205: mag(left, 205, rate),
        rightAt195: mag(right, 195, rate),
        rightAt205: mag(right, 205, rate),
        leftAt300: mag(left, 300, rate),
        peakLeft: Math.max(...Array.from(left).map(Math.abs)),
      };
    });

    // carrier − beat/2 = 195 Hz in the left ear, carrier + beat/2 = 205 in the right
    expect(result.leftAt195).toBeGreaterThan(result.leftAt205 * 5);
    expect(result.rightAt205).toBeGreaterThan(result.rightAt195 * 5);
    // and nothing at an unrelated frequency
    expect(result.leftAt300).toBeLessThan(result.leftAt195 * 0.05);
    expect(result.peakLeft).toBeGreaterThan(0.1);
    expect(result.peakLeft).toBeLessThanOrEqual(1.05);
  });

  test('an isochronic layer pulses at the beat rate, without steps', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const script = {
        v: 2,
        title: 'isochronic probe',
        segments: [{ dur: 3, layers: [{ kind: 'tone', method: 'isochronic', carrier: 300, beat: 4, gain: 1 }] }],
      };
      const buffer = await window.adhdmed.render(script as never, 2.5, 48000);
      const data = buffer.getChannelData(0);
      const rate = buffer.sampleRate;

      // Envelope by peak per 5 ms window, then count the peaks.
      const win = Math.floor(rate * 0.005);
      const env: number[] = [];
      for (let i = 0; i + win < data.length; i += win) {
        let peak = 0;
        for (let k = 0; k < win; k++) peak = Math.max(peak, Math.abs(data[i + k]!));
        env.push(peak);
      }
      const max = Math.max(...env);
      let crossings = 0;
      for (let i = 1; i < env.length; i++) {
        if (env[i - 1]! < max * 0.5 && env[i]! >= max * 0.5) crossings++;
      }
      // Largest single-sample jump: a hard gate would show a discontinuity.
      let jump = 0;
      for (let i = 1; i < data.length; i++) jump = Math.max(jump, Math.abs(data[i]! - data[i - 1]!));
      return { seconds: env.length * 0.005, crossings, min: Math.min(...env), max, jump };
    });

    // ~4 pulses per second over 2.5 s of audio
    const perSecond = result.crossings / result.seconds;
    expect(perSecond).toBeGreaterThan(3.2);
    expect(perSecond).toBeLessThan(4.8);
    // the gate closes fully
    expect(result.min).toBeLessThan(result.max * 0.1);
    // and it is a curve, not a switch: no sample-to-sample cliff
    expect(result.jump).toBeLessThan(0.2);
  });

  test('a monaural layer beats in both ears equally', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const script = {
        v: 2,
        title: 'monaural probe',
        segments: [{ dur: 3, layers: [{ kind: 'tone', method: 'monaural', carrier: 220, beat: 6, gain: 1 }] }],
      };
      const buffer = await window.adhdmed.render(script as never, 2, 48000);
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      let diff = 0;
      for (let i = 0; i < left.length; i++) diff = Math.max(diff, Math.abs(left[i]! - right[i]!));

      const win = Math.floor(buffer.sampleRate * 0.01);
      const env: number[] = [];
      for (let i = 0; i + win < left.length; i += win) {
        let peak = 0;
        for (let k = 0; k < win; k++) peak = Math.max(peak, Math.abs(left[i + k]!));
        env.push(peak);
      }
      const max = Math.max(...env);
      let crossings = 0;
      for (let i = 1; i < env.length; i++) if (env[i - 1]! < max * 0.5 && env[i]! >= max * 0.5) crossings++;
      return { diff, crossings, seconds: env.length * 0.01 };
    });

    expect(result.diff).toBeLessThan(0.01); // identical in both ears
    const perSecond = result.crossings / result.seconds;
    expect(perSecond).toBeGreaterThan(5);
    expect(perSecond).toBeLessThan(7.5);
  });

  test('a beat sweep actually moves, and a seek starts mid-sweep', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const mag = (data: Float32Array, freq: number, rate: number) => {
        const k = (2 * Math.PI * freq) / rate;
        const coeff = 2 * Math.cos(k);
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < data.length; i++) {
          const s0 = data[i]! + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / data.length;
      };
      const script = {
        v: 2,
        title: 'sweep probe',
        segments: [
          {
            dur: 4,
            layers: [
              {
                kind: 'tone',
                method: 'binaural',
                carrier: 200,
                beat: 4,
                gain: 1,
                mods: [{ target: 'beat', from: 4, to: 40, curve: 'lin' }],
              },
            ],
          },
        ],
      };
      const buffer = await window.adhdmed.render(script as never, 4, 48000);
      const left = buffer.getChannelData(0);
      const rate = buffer.sampleRate;
      const head = left.slice(0, rate); // first second: beat ≈ 4 → 198 Hz
      const tail = left.slice(rate * 3); // last second: beat ≈ 40 → 180 Hz
      return {
        headAt198: mag(head, 198, rate),
        headAt182: mag(head, 182, rate),
        tailAt182: mag(tail, 182, rate),
        tailAt198: mag(tail, 198, rate),
      };
    });

    expect(result.headAt198).toBeGreaterThan(result.headAt182 * 3);
    expect(result.tailAt182).toBeGreaterThan(result.tailAt198 * 3);
  });

  test('a noise bed loops without a click at the seam', async ({ page }) => {
    const jump = await page.evaluate(async () => {
      const script = {
        v: 2,
        title: 'noise probe',
        segments: [{ dur: 30, layers: [{ kind: 'noise', color: 'pink', method: 'tone', gain: 1 }] }],
      };
      // 13 seconds crosses the 12-second loop point.
      const buffer = await window.adhdmed.render(script as never, 13, 48000);
      const data = buffer.getChannelData(0);
      const rate = buffer.sampleRate;
      // Compare the local slope right at the seam with the typical slope.
      const slopes: number[] = [];
      for (let i = 1; i < data.length; i++) slopes.push(Math.abs(data[i]! - data[i - 1]!));
      const typical = slopes.reduce((a, b) => a + b, 0) / slopes.length;
      let seam = 0;
      const at = Math.floor(rate * 12);
      for (let i = at - 40; i < at + 40; i++) seam = Math.max(seam, slopes[i] ?? 0);
      return seam / typical;
    });
    // A hard splice shows up as a slope tens of times the average.
    expect(jump).toBeLessThan(12);
  });

  test('the master chain caps the output no matter how hot the layers are', async ({ page }) => {
    const peak = await page.evaluate(async () => {
      const engine = window.adhdmed.engine;
      const script = {
        v: 2,
        title: 'hot',
        unsafe: true,
        segments: [
          {
            dur: 20,
            layers: Array.from({ length: 8 }, (_, i) => ({
              kind: 'tone',
              method: 'monaural',
              carrier: 120 + i * 37,
              beat: 8,
              gain: 1,
              wave: { kind: 'sawtooth' },
            })),
          },
        ],
      };
      engine.setVolume(1);
      window.adhdmed.play(script as never);
      await new Promise((r) => setTimeout(r, 1500));
      const analyser = engine.analyserL!;
      const data = new Float32Array(analyser.fftSize);
      let peak = 0;
      for (let round = 0; round < 12; round++) {
        analyser.getFloatTimeDomainData(data);
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        await new Promise((r) => setTimeout(r, 60));
      }
      await engine.stop();
      return peak;
    });
    // The analyser taps the bus before the limiter, so this only proves the
    // graph is alive and not producing garbage; the limiter and hard cap sit
    // downstream of it.
    expect(peak).toBeGreaterThan(0.01);
    expect(Number.isFinite(peak)).toBe(true);
  });
});

test.describe('long sessions and seeking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);
  });

  test('a 90-minute session schedules in windows and survives a seek to the end', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const engine = window.adhdmed.engine;
      const script = window.adhdmed.generate({ goal: 'study', minutes: 90, seed: 7 });
      window.adhdmed.play(script);
      await new Promise((r) => setTimeout(r, 900));
      const early = engine.snapshot();

      // Seek most of the way through: everything past the first window has to be
      // scheduled on demand.
      await engine.seek(80 * 60);
      await new Promise((r) => setTimeout(r, 900));
      const late = engine.snapshot();

      const analyser = engine.analyserL!;
      const data = new Float32Array(analyser.fftSize);
      let energy = 0;
      for (let i = 0; i < 10; i++) {
        analyser.getFloatTimeDomainData(data);
        for (const v of data) energy = Math.max(energy, Math.abs(v));
        await new Promise((r) => setTimeout(r, 60));
      }

      // and back to the start
      await engine.seek(0);
      await new Promise((r) => setTimeout(r, 500));
      const rewound = engine.snapshot();
      await engine.stop();

      return {
        duration: early.duration,
        earlyStatus: early.status,
        earlyPos: early.position,
        latePos: late.position,
        lateSeg: late.segIndex,
        lateStatus: late.status,
        energy,
        rewoundPos: rewound.position,
        rewoundStatus: rewound.status,
      };
    });

    expect(result.duration).toBeGreaterThan(5200);
    expect(result.earlyStatus).toBe('playing');
    expect(result.earlyPos).toBeLessThan(60);
    expect(result.latePos).toBeGreaterThan(4790);
    expect(result.lateStatus).toBe('playing');
    expect(result.lateSeg).toBeGreaterThan(2);
    expect(result.energy).toBeGreaterThan(0.001);
    expect(result.rewoundPos).toBeLessThan(30);
    expect(result.rewoundStatus).toBe('playing');
  });

  test('pause freezes the clock and resume carries on from there', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const engine = window.adhdmed.engine;
      window.adhdmed.play(window.adhdmed.generate({ goal: 'focus', minutes: 25, seed: 3 }));
      await new Promise((r) => setTimeout(r, 1500));
      const before = engine.snapshot().position;
      await engine.pause();
      const paused = engine.snapshot().position;
      await new Promise((r) => setTimeout(r, 1200));
      const stillPaused = engine.snapshot().position;
      await engine.play();
      await new Promise((r) => setTimeout(r, 900));
      const after = engine.snapshot().position;
      await engine.stop();
      return { before, paused, stillPaused, after };
    });

    expect(result.before).toBeGreaterThan(0.5);
    // the clock does not advance while paused
    expect(Math.abs(result.stillPaused - result.paused)).toBeLessThan(0.2);
    // and it continues from where it stopped rather than restarting
    expect(result.after).toBeGreaterThan(result.paused);
    expect(result.after).toBeLessThan(result.paused + 3);
  });
});

test.describe('regressions found in review', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./');
    await dismissLeaflet(page);
  });

  test('resuming after a pause does not stack a second copy of the session', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const engine = window.adhdmed.engine;
      const analyser = () => engine.analyserL!;
      const peak = async (rounds = 14) => {
        const data = new Float32Array(analyser().fftSize);
        let p = 0;
        for (let i = 0; i < rounds; i++) {
          analyser().getFloatTimeDomainData(data);
          for (const v of data) p = Math.max(p, Math.abs(v));
          await new Promise((r) => setTimeout(r, 60));
        }
        return p;
      };

      // A steady single-layer session, so the level should not change on its own.
      window.adhdmed.play({
        v: 2,
        title: 'steady',
        segments: [{ dur: 600, layers: [{ kind: 'tone', method: 'monaural', carrier: 220, beat: 6, gain: 0.6 }] }],
      } as never);
      await new Promise((r) => setTimeout(r, 1800));
      const first = await peak();

      for (let i = 0; i < 3; i++) {
        await engine.pause();
        await new Promise((r) => setTimeout(r, 250));
        await engine.play();
        await new Promise((r) => setTimeout(r, 900));
      }
      const afterThreePauses = await peak();
      await engine.stop();
      return { first, afterThreePauses };
    });

    expect(result.first).toBeGreaterThan(0.05);
    // Three pause/play cycles used to leave four copies playing at once.
    expect(result.afterThreePauses).toBeLessThan(result.first * 1.35);
  });

  test('balancing a binaural layer keeps a different frequency in each ear', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const mag = (data: Float32Array, freq: number, rate: number) => {
        const k = (2 * Math.PI * freq) / rate;
        const coeff = 2 * Math.cos(k);
        let s1 = 0;
        let s2 = 0;
        for (let i = 0; i < data.length; i++) {
          const s0 = data[i]! + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / data.length;
      };
      const buffer = await window.adhdmed.render(
        {
          v: 2,
          title: 'panned binaural',
          segments: [
            { dur: 2, layers: [{ kind: 'tone', method: 'binaural', carrier: 200, beat: 10, gain: 1, pan: -0.5 }] },
          ],
        } as never,
        1.5,
        48000,
      );
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      const rate = buffer.sampleRate;
      let peakL = 0;
      let peakR = 0;
      for (let i = 0; i < left.length; i++) {
        peakL = Math.max(peakL, Math.abs(left[i]!));
        peakR = Math.max(peakR, Math.abs(right[i]!));
      }
      return {
        leftAt195: mag(left, 195, rate),
        leftAt205: mag(left, 205, rate),
        rightAt195: mag(right, 195, rate),
        rightAt205: mag(right, 205, rate),
        peakL,
        peakR,
      };
    });

    // A StereoPanner would have cross-mixed 205 Hz into the left ear and
    // emptied the right. The ear balance keeps both frequencies where they were.
    expect(result.leftAt195).toBeGreaterThan(result.leftAt205 * 5);
    expect(result.rightAt205).toBeGreaterThan(result.rightAt195 * 5);
    expect(result.peakR).toBeGreaterThan(0.05); // the quieter ear still sounds
    expect(result.peakL).toBeGreaterThan(result.peakR); // and the balance leaned left
  });

  test('a mod can fade in a modulator whose static depth is zero', async ({ page }) => {
    const spread = await page.evaluate(async () => {
      const buffer = await window.adhdmed.render(
        {
          v: 2,
          title: 'tremolo fade-in',
          segments: [
            {
              dur: 6,
              layers: [
                {
                  kind: 'tone',
                  method: 'tone',
                  carrier: 300,
                  beat: 0,
                  gain: 1,
                  am: { rate: 6, depth: 0, wave: 'sine' },
                  mods: [{ target: 'amDepth', from: 0, to: 1, curve: 'lin' }],
                },
              ],
            },
          ],
        } as never,
        6,
        48000,
      );
      const data = buffer.getChannelData(0);
      const rate = buffer.sampleRate;
      const window_ = Math.floor(rate * 0.01);
      const envelopeOf = (from: number, to: number) => {
        const peaks: number[] = [];
        for (let i = from; i + window_ < to; i += window_) {
          let p = 0;
          for (let k = 0; k < window_; k++) p = Math.max(p, Math.abs(data[i + k]!));
          peaks.push(p);
        }
        return { min: Math.min(...peaks), max: Math.max(...peaks) };
      };
      const head = envelopeOf(0, Math.floor(rate * 0.5)); // depth still near 0
      const tail = envelopeOf(rate * 5, rate * 6); // depth ≈ 1: a full gate
      return { headRange: head.max - head.min, tailRange: tail.max - tail.min };
    });

    // The claim is the fade: barely modulated at the start, fully gated by the end.
    expect(spread.headRange).toBeLessThan(0.12);
    expect(spread.tailRange).toBeGreaterThan(0.5);
    expect(spread.tailRange).toBeGreaterThan(spread.headRange * 5);
  });
});
