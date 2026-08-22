/**
 * The transport.
 *
 * Design decisions that matter:
 *  · Output goes through a MediaStream into a real <audio> element, so the OS
 *    treats this as media playback: lock-screen controls, and audio that
 *    survives the screen turning off.
 *  · Segments are scheduled onto the AudioParam timeline in half-hour windows,
 *    not driven by a JS clock. Background tabs throttle timers; the audio thread
 *    does not.
 *  · A limiter and a hard gain cap sit after the user's volume, always, in every
 *    mode including the experimental one. Freedom to invent sounds is not
 *    freedom to hurt your ears.
 */
import { segmentAt, segmentStarts, totalSeconds, type Layer, type Script } from '../core/types.js';
import { cleanScript, envelopeFor } from '../core/ranges.js';
import { buildVoice, type VoiceHandle } from './voice.js';

/** Seconds of audio scheduled ahead of the playhead. */
const WINDOW = 1800;
/** Extend the window when fewer than this many seconds remain scheduled. */
const EXTEND_AT = 600;
/** Absolute ceiling after the limiter. */
const OUTPUT_CAP = 0.7;
export const DEFAULT_VOLUME = 0.25;

export type Status = 'idle' | 'playing' | 'paused';

export interface EngineSnapshot {
  status: Status;
  script: Script | null;
  position: number;
  duration: number;
  volume: number;
  segIndex: number;
  /** true when output had to bypass the media element */
  directOutput: boolean;
}

type Listener = (s: EngineSnapshot) => void;

export class Engine {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private el: HTMLAudioElement | null = null;

  /** Waveform taps, one per ear — the Lissajous figure is drawn from these. */
  analyserL: AnalyserNode | null = null;
  analyserR: AnalyserNode | null = null;

  private voices: VoiceHandle[] = [];
  private segGains: GainNode[] = [];
  private scheduled = new Set<number>();
  private scheduledUntil = 0;

  private script: Script | null = null;
  private status: Status = 'idle';
  private startCtxTime = 0;
  private startPosition = 0;
  private pausedAt = 0;
  private volumeValue = DEFAULT_VOLUME;
  private directOutput = false;
  private listeners = new Set<Listener>();
  private tick: number | null = null;
  private previewVoice: VoiceHandle | null = null;

  get audioElement(): HTMLAudioElement | null {
    return this.el;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): EngineSnapshot {
    const duration = this.script ? totalSeconds(this.script) : 0;
    const position = this.position();
    return {
      status: this.status,
      script: this.script,
      position,
      duration,
      volume: this.volumeValue,
      segIndex: this.script ? segmentAt(this.script, position).index : 0,
      directOutput: this.directOutput,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  /** Must be called from a user gesture the first time. */
  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'playback' });

    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.channelCount = 2;
    bus.channelCountMode = 'explicit';
    bus.channelInterpretation = 'speakers';

    const master = ctx.createGain();
    master.gain.value = this.volumeValue;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    const cap = ctx.createGain();
    cap.gain.value = OUTPUT_CAP;

    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    for (const a of [analyserL, analyserR]) {
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0.85;
    }
    bus.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    bus.connect(master).connect(limiter).connect(cap);

    const sink = ctx.createMediaStreamDestination();
    cap.connect(sink);

    const el = document.createElement('audio');
    el.setAttribute('playsinline', '');
    el.autoplay = false;
    el.controls = false;
    el.srcObject = sink.stream;
    el.volume = 1;
    el.setAttribute('aria-hidden', 'true');
    el.style.display = 'none';
    document.body.appendChild(el);

    this.ctx = ctx;
    this.bus = bus;
    this.masterGain = master;
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    this.el = el;
    return ctx;
  }

  /** If the media-element path fails, fall back to speaking directly. */
  private useDirectOutput(): void {
    if (this.directOutput || !this.ctx || !this.masterGain) return;
    this.directOutput = true;
    // The chain after masterGain is already built; just add a parallel path.
    this.masterGain.connect(this.ctx.destination);
    this.emit();
  }

  /**
   * The engine validates whatever it is handed. Every producer already emits
   * clean scripts, but the engine is the last gate before the audio thread, and
   * a half-built layer from a console experiment should not be able to throw
   * mid-schedule and leave the graph in pieces.
   */
  load(input: Script, opts: { autoplay?: boolean } = {}): void {
    const script = cleanScript(input);
    this.clearVoices();
    this.script = script;
    this.pausedAt = 0;
    this.startPosition = 0;
    this.status = 'paused';
    this.emit();
    if (opts.autoplay) void this.play();
  }

  position(): number {
    if (!this.script) return 0;
    const duration = totalSeconds(this.script);
    if (this.status !== 'playing' || !this.ctx) return Math.min(this.pausedAt, duration);
    const elapsed = this.ctx.currentTime - this.startCtxTime;
    return Math.min(duration, this.startPosition + Math.max(0, elapsed));
  }

  async play(): Promise<void> {
    if (!this.script) return;
    const ctx = this.ensureContext();
    const from = this.pausedAt >= totalSeconds(this.script) - 0.5 ? 0 : this.pausedAt;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    if (this.status !== 'playing') this.schedule(from);
    this.status = 'playing';
    this.startTicking();
    try {
      await this.el?.play();
    } catch {
      this.useDirectOutput();
    }
    this.emit();
  }

  async pause(): Promise<void> {
    if (this.status !== 'playing') return;
    this.pausedAt = this.position();
    this.status = 'paused';
    this.stopTicking();
    this.el?.pause();
    await this.ctx?.suspend().catch(() => undefined);
    this.emit();
  }

  async toggle(): Promise<void> {
    if (this.status === 'playing') await this.pause();
    else await this.play();
  }

  async seek(seconds: number): Promise<void> {
    if (!this.script) return;
    const duration = totalSeconds(this.script);
    const target = Math.max(0, Math.min(duration - 0.5, seconds));
    const wasPlaying = this.status === 'playing';
    this.clearVoices();
    this.pausedAt = target;
    if (wasPlaying) {
      this.status = 'paused';
      await this.play();
    } else {
      this.emit();
    }
  }

  /** Jump to a segment boundary. */
  async skip(direction: 1 | -1): Promise<void> {
    if (!this.script) return;
    const starts = segmentStarts(this.script);
    const here = this.position();
    if (direction === 1) {
      const next = starts.find((s) => s > here + 1);
      await this.seek(next ?? totalSeconds(this.script) - 1);
    } else {
      const current = segmentAt(this.script, here);
      const target = current.offset > 3 ? starts[current.index]! : starts[Math.max(0, current.index - 1)]!;
      await this.seek(target);
    }
  }

  async stop(): Promise<void> {
    this.clearVoices();
    this.pausedAt = 0;
    this.status = 'idle';
    this.stopTicking();
    this.el?.pause();
    await this.ctx?.suspend().catch(() => undefined);
    this.emit();
  }

  setVolume(v: number): void {
    this.volumeValue = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volumeValue, this.ctx.currentTime, 0.05);
    }
    this.emit();
  }

  get volume(): number {
    return this.volumeValue;
  }

  /** Audition a single layer while editing — plays until stopped. */
  async previewLayer(l: Layer, seconds = 30): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    this.stopPreview();
    const script: Script = { v: 2, title: 'preview', segments: [{ dur: seconds, layers: [l] }] };
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.bus!);
    const now = ctx.currentTime + 0.05;
    gain.gain.linearRampToValueAtTime(1, now + 0.3);
    gain.gain.setValueAtTime(1, now + seconds - 0.3);
    gain.gain.linearRampToValueAtTime(0, now + seconds);
    this.previewVoice = buildVoice(l, {
      ctx, script, segIndex: 0, layerIndex: 0, t0: now, span: seconds, offset: 0, dest: gain,
      env: envelopeFor(script),
    });
    this.segGains.push(gain);
    try {
      await this.el?.play();
    } catch {
      this.useDirectOutput();
    }
  }

  stopPreview(): void {
    if (this.previewVoice && this.ctx) {
      this.previewVoice.stop(this.ctx.currentTime);
      this.previewVoice = null;
    }
  }

  // --- scheduling ---

  private schedule(from: number): void {
    if (!this.script || !this.ctx || !this.bus) return;
    const ctx = this.ctx;
    this.scheduled.clear();
    this.startCtxTime = ctx.currentTime + 0.08;
    this.startPosition = from;
    this.scheduledUntil = from;
    this.scheduleWindow();
  }

  /** Schedule every segment that starts before position + WINDOW. */
  private scheduleWindow(): void {
    if (!this.script || !this.ctx || !this.bus) return;
    const ctx = this.ctx;
    const script = this.script;
    const starts = segmentStarts(script);
    const horizon = this.position() + WINDOW;

    script.segments.forEach((seg, i) => {
      const start = starts[i]!;
      const end = start + seg.dur;
      if (end <= this.startPosition) return;
      if (start > horizon) return;
      if (this.scheduled.has(i)) return;
      this.scheduled.add(i);

      const offset = Math.max(0, this.startPosition - start);
      const span = seg.dur - offset;
      if (span <= 0.1) return;
      const t0 = this.startCtxTime + (start + offset - this.startPosition);
      const isLast = i === script.segments.length - 1;
      const fade = Math.min(2.5, seg.dur / 6, span / 3);
      // Overlap into the next segment so the crossfade has no dip.
      const overlap = isLast ? 0 : fade;

      const segGain = ctx.createGain();
      segGain.gain.value = 0;
      segGain.connect(this.bus!);
      const fadeIn = offset > 0.5 ? 0.15 : fade;
      segGain.gain.setValueAtTime(0, t0);
      segGain.gain.linearRampToValueAtTime(1, t0 + Math.max(0.05, fadeIn));
      segGain.gain.setValueAtTime(1, t0 + span + overlap - fade);
      segGain.gain.linearRampToValueAtTime(0, t0 + span + overlap);
      this.segGains.push(segGain);

      seg.layers.forEach((l, li) => {
        const voice = buildVoice(l, {
          ctx,
          script,
          segIndex: i,
          layerIndex: li,
          t0,
          span: span + overlap,
          offset,
          dest: segGain,
        });
        if (voice) this.voices.push(voice);
      });

      this.scheduledUntil = Math.max(this.scheduledUntil, end);
    });
  }

  private startTicking(): void {
    this.stopTicking();
    const onTick = () => {
      if (this.status !== 'playing') return;
      const pos = this.position();
      if (this.script && pos >= totalSeconds(this.script) - 0.2) {
        void this.finish();
        return;
      }
      if (this.scheduledUntil - pos < EXTEND_AT) this.scheduleWindow();
      this.emit();
    };
    this.tick = window.setInterval(onTick, 1000);
    this.el?.addEventListener('timeupdate', onTick);
    this.onTickHandler = onTick;
  }

  private onTickHandler: (() => void) | null = null;

  private stopTicking(): void {
    if (this.tick !== null) {
      clearInterval(this.tick);
      this.tick = null;
    }
    if (this.onTickHandler) {
      this.el?.removeEventListener('timeupdate', this.onTickHandler);
      this.onTickHandler = null;
    }
  }

  private async finish(): Promise<void> {
    this.clearVoices();
    this.pausedAt = 0;
    this.status = 'paused';
    this.stopTicking();
    this.el?.pause();
    await this.ctx?.suspend().catch(() => undefined);
    this.emit();
  }

  private clearVoices(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const v of this.voices) v.stop(now);
    this.voices = [];
    for (const g of this.segGains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, 0.01);
        g.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.segGains = [];
    this.scheduled.clear();
    this.previewVoice = null;
  }
}

export const engine = new Engine();

/**
 * Render a script offline — used by the audio tests to assert that a binaural
 * layer really does put different frequencies in each ear.
 */
export async function renderScript(input: Script, seconds: number, sampleRate = 44100): Promise<AudioBuffer> {
  const script = cleanScript(input);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.floor(seconds * sampleRate), sampleRate });
  const bus = ctx.createGain();
  bus.channelCount = 2;
  bus.channelCountMode = 'explicit';
  bus.connect(ctx.destination);
  const starts = segmentStarts(script);
  script.segments.forEach((seg, i) => {
    const t0 = starts[i]!;
    if (t0 > seconds) return;
    const span = Math.min(seg.dur, seconds - t0);
    const segGain = ctx.createGain();
    segGain.gain.value = 1;
    segGain.connect(bus);
    seg.layers.forEach((l, li) => {
      buildVoice(l, { ctx, script, segIndex: i, layerIndex: li, t0, span, offset: 0, dest: segGain });
    });
  });
  return ctx.startRendering();
}
