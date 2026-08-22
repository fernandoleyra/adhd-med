/**
 * One Layer → one node graph.
 *
 * Everything a layer can do is built from stock Web Audio nodes: no worklets,
 * nothing that needs a JS callback to keep running. Once a voice is scheduled it
 * belongs to the audio thread, which is why a locked phone screen doesn't stop
 * it mid-session.
 *
 *   tone   osc(s) → [gate] → [am] → [filter] → [pan] → gain → segment bus
 *   noise  buffer → [am]   → [filter] → [pan] → gain → segment bus
 */
import {
  combine,
  firstValue,
  isCurve,
  layerSeed,
  planMods,
  resolveTarget,
  type Resolved,
} from '../core/automation.js';
import { envelopeFor, type Envelope } from '../core/ranges.js';
import type { Layer, Script } from '../core/types.js';
import { noiseBuffer } from './noise.js';

export interface VoiceHandle {
  stop(when: number): void;
}

/** Apply a constant or a curve to a parameter, starting at `t0`. */
function apply(param: AudioParam, value: Resolved, t0: number, span: number): void {
  if (isCurve(value)) {
    param.setValueAtTime(value[0] ?? 0, t0);
    try {
      param.setValueCurveAtTime(value, t0, Math.max(0.05, span));
      return;
    } catch {
      // Some engines refuse very long or very large curves; hold the first value.
      param.setValueAtTime(value[0] ?? 0, t0);
    }
  } else {
    param.setValueAtTime(value, t0);
  }
}

function periodicWave(ctx: BaseAudioContext, harmonics: number[]): PeriodicWave {
  const n = Math.min(harmonics.length, 64) + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 1; i < n; i++) imag[i] = harmonics[i - 1] ?? 0;
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function setWave(osc: OscillatorNode, ctx: BaseAudioContext, l: Layer): void {
  if (l.wave.kind === 'custom') {
    const harmonics = l.wave.harmonics?.length ? l.wave.harmonics : [1];
    osc.setPeriodicWave(periodicWave(ctx, harmonics));
  } else {
    osc.type = l.wave.kind;
  }
}

/**
 * A modulator: gain(t) = (1 − depth/2) + (depth/2)·lfo(t), i.e. it dips to
 * (1 − depth) and back. depth 1 gives a full raised-cosine gate — the
 * isochronic pulse, click-free because it is a curve, not a switch.
 */
function buildModulator(
  ctx: BaseAudioContext,
  wave: OscillatorType,
  rate: Resolved,
  depth: Resolved,
  t0: number,
  span: number,
  stopAt: number,
): { node: GainNode; nodes: { start(t: number): void; stop(t: number): void }[] } {
  const node = ctx.createGain();
  node.gain.value = 0;

  const lfo = ctx.createOscillator();
  lfo.type = wave;
  apply(lfo.frequency, rate, t0, span);

  const depthGain = ctx.createGain();
  apply(depthGain.gain, combine(depth, 0, (d) => d / 2), t0, span);

  const offset = ctx.createConstantSource();
  apply(offset.offset, combine(depth, 0, (d) => 1 - d / 2), t0, span);

  lfo.connect(depthGain).connect(node.gain);
  offset.connect(node.gain);
  lfo.start(t0);
  lfo.stop(stopAt);
  offset.start(t0);
  offset.stop(stopAt);
  return { node, nodes: [lfo, offset] };
}

export interface BuildOptions {
  ctx: BaseAudioContext;
  script: Script;
  segIndex: number;
  layerIndex: number;
  /** absolute context time at which the segment begins */
  t0: number;
  /** seconds of the segment still to play */
  span: number;
  /** how far into the segment we are starting (seek) */
  offset: number;
  dest: AudioNode;
  env?: Envelope;
}

/** Build and schedule one layer. Returns a handle that can cut it short. */
export function buildVoice(l: Layer, o: BuildOptions): VoiceHandle | null {
  if (l.mute) return null;
  const { ctx, script, segIndex, layerIndex, t0, span, offset, dest } = o;
  const env = o.env ?? envelopeFor(script);
  const seed = layerSeed(script, segIndex, layerIndex);
  const seg = script.segments[segIndex]!;
  const plans = planMods(l, env);
  const resolve = (target: Parameters<typeof resolveTarget>[1]) =>
    resolveTarget(l, target, plans, seg.dur, offset, seed);

  const stopAt = t0 + span + 0.2;
  const started: { start(t: number): void; stop(t: number): void }[] = [];

  const gainNode = ctx.createGain();
  apply(gainNode.gain, resolve('gain'), t0, span);

  let tail: AudioNode = gainNode;
  gainNode.connect(dest);

  const pan = resolve('pan');
  let head: AudioNode = gainNode;
  if (firstValue(pan) !== 0 || isCurve(pan)) {
    const panner = ctx.createStereoPanner();
    apply(panner.pan, pan, t0, span);
    panner.connect(head);
    head = panner;
  }

  if (l.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = l.filter.kind;
    apply(filter.frequency, resolve('filterFreq'), t0, span);
    filter.Q.value = l.filter.q;
    filter.connect(head);
    head = filter;
  }

  if (l.am && l.am.depth > 0) {
    const am = buildModulator(ctx, l.am.wave, resolve('amRate'), resolve('amDepth'), t0, span, stopAt);
    am.node.connect(head);
    head = am.node;
    started.push(...am.nodes);
  }

  if (l.kind === 'noise') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, l.color);
    src.loop = true;
    src.connect(head);
    src.start(t0, (offset * 0.37) % 10);
    src.stop(stopAt);
    started.push(src);
    void tail;
    return { stop: (when) => stopAll(started, when) };
  }

  // --- tone layers ---
  const carrier = resolve('carrier');
  const ratio = resolve('ratio');
  const beat = resolve('beat');
  const sounding = combine(carrier, ratio, (c, r) => c * r);

  const isoDepth = 1;
  let toneHead = head;
  if (l.method === 'isochronic') {
    const gate = buildModulator(ctx, 'sine', beat, isoDepth, t0, span, stopAt);
    gate.node.connect(toneHead);
    toneHead = gate.node;
    started.push(...gate.nodes);
  }

  const oscs: OscillatorNode[] = [];
  const makeOsc = (freq: Resolved, destination: AudioNode, detuneCents = 0) => {
    const osc = ctx.createOscillator();
    setWave(osc, ctx, l);
    apply(osc.frequency, freq, t0, span);
    if (detuneCents !== 0) osc.detune.value = detuneCents;
    osc.connect(destination);
    osc.start(t0);
    osc.stop(stopAt);
    oscs.push(osc);
    started.push(osc);
    return osc;
  };

  if (l.method === 'binaural') {
    // The beat lives in the difference between the ears; the centre frequency
    // stays put so the perceived pitch doesn't slide when the beat moves.
    const merger = ctx.createChannelMerger(2);
    merger.connect(toneHead);
    const left = ctx.createGain();
    const right = ctx.createGain();
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    makeOsc(combine(sounding, beat, (f, b) => Math.max(0.01, f - b / 2)), left);
    makeOsc(combine(sounding, beat, (f, b) => Math.max(0.01, f + b / 2)), right, l.detune);
  } else if (l.method === 'monaural') {
    const sum = ctx.createGain();
    sum.gain.value = 0.5;
    sum.connect(toneHead);
    makeOsc(sounding, sum);
    makeOsc(combine(sounding, beat, (f, b) => Math.max(0.01, f + b)), sum, l.detune);
  } else {
    makeOsc(sounding, toneHead);
  }

  if (l.fm && l.fm.depth > 0) {
    const lfo = ctx.createOscillator();
    lfo.type = l.fm.wave;
    apply(lfo.frequency, resolve('fmRate'), t0, span);
    const depth = ctx.createGain();
    apply(depth.gain, resolve('fmDepth'), t0, span);
    lfo.connect(depth);
    for (const osc of oscs) depth.connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(stopAt);
    started.push(lfo);
  }

  return { stop: (when) => stopAll(started, when) };
}

function stopAll(nodes: { stop(t: number): void }[], when: number): void {
  for (const n of nodes) {
    try {
      n.stop(when);
    } catch {
      /* already stopped */
    }
  }
}
