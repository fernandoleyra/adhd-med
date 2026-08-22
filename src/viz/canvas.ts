/**
 * The full-screen veil.
 *
 * While a session plays this is a Lissajous figure of the actual output — the
 * left channel on x, the right on y, straight off the analysers. Nothing is
 * simulated: when the two ears differ by the beat frequency, the closed curve
 * precesses once per beat, so what you see is the interference you are hearing.
 *
 * 30 fps, device pixel ratio capped, and it stops entirely when the tab is
 * hidden or the session is idle.
 */
import { engine } from '../audio/engine.js';
import { segmentAt } from '../core/types.js';
import { safeRate } from './geometry.js';
import { readInk, type Ink } from './marks.js';

const FPS = 30;
const TRAIL = 5;

interface Frame {
  points: Float32Array;
  count: number;
}

export class Veil {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private ink: Ink;
  private frames: Frame[] = [];
  private phase = 0;
  private reduced = false;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true })!;
    this.ink = readInk(document.body);
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.start();
      else this.stop();
    });
    window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => {
      this.reduced = e.matches;
    });
    this.resize();
  }

  refreshTheme(): void {
    this.ink = readInk(document.body);
  }

  private resize(): void {
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (now - this.last < 1000 / FPS) return;
      const dt = this.last === 0 ? 1 / FPS : (now - this.last) / 1000;
      this.last = now;
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private draw(dt: number): void {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    const snap = engine.snapshot();
    const cx = width / 2;
    const cy = height * 0.42;
    const r = Math.min(width, height) * 0.3;

    this.drawGrid(snap.position, snap.duration);

    const L = engine.analyserL;
    const R = engine.analyserR;
    const playing = snap.status === 'playing' && L && R;

    if (playing) {
      const n = 1024;
      const left = new Float32Array(n);
      const right = new Float32Array(n);
      L.getFloatTimeDomainData(left);
      R.getFloatTimeDomainData(right);
      let peak = 1e-4;
      for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
      const scale = r / peak;

      const pts = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        pts[i * 2] = cx + left[i]! * scale;
        pts[i * 2 + 1] = cy + right[i]! * scale;
      }
      this.frames.push({ points: pts, count: n });
      while (this.frames.length > (this.reduced ? 1 : TRAIL)) this.frames.shift();

      this.frames.forEach((frame, i) => {
        const alpha = ((i + 1) / this.frames.length) * 0.55;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = i === this.frames.length - 1 ? this.ink.line : this.ink.faint;
        ctx.lineWidth = i === this.frames.length - 1 ? 1.1 : 1;
        ctx.beginPath();
        for (let k = 0; k < frame.count; k++) {
          const x = frame.points[k * 2]!;
          const y = frame.points[k * 2 + 1]!;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    } else {
      this.frames.length = 0;
      this.drawIdle(cx, cy, r);
    }

    // Interference rings, rotating at the beat rate divided down under the
    // flicker cap. Rotation only — no brightness modulation, ever.
    const seg = snap.script ? snap.script.segments[segmentAt(snap.script, snap.position).index] : undefined;
    const lead = seg?.layers.find((l) => !l.mute && l.kind === 'tone' && l.method !== 'tone');
    const beat = lead?.beat ?? 0;
    const { rate } = safeRate(beat);
    if (!this.reduced) this.phase += dt * rate * Math.PI * 2;
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = this.ink.faint;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const rr = r * (1 + i * 0.28);
      ctx.beginPath();
      const wobble = Math.sin(this.phase + i) * (playing ? 3 : 1.5);
      ctx.ellipse(cx, cy, rr + wobble, rr - wobble, this.phase / (i + 2), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawIdle(cx: number, cy: number, r: number): void {
    const { ctx } = this;
    const breath = this.reduced ? 1 : 1 + Math.sin(this.phase * 0.25) * 0.03;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this.ink.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55 * breath, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.2 * breath, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Architecture-plan rules: a sparse grid, and a scale bar for the session. */
  private drawGrid(position: number, duration: number): void {
    const { ctx, width, height } = this;
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = this.ink.faint;
    ctx.lineWidth = 1;
    const step = 64;
    ctx.beginPath();
    for (let x = step; x < width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = step; y < height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    if (duration > 0) {
      const u = Math.min(1, position / duration);
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = this.ink.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, height - 0.75);
      ctx.lineTo(width * u, height - 0.75);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

let veil: Veil | null = null;

export function mountVeil(canvas: HTMLCanvasElement): Veil {
  veil = new Veil(canvas);
  veil.start();
  return veil;
}

export function getVeil(): Veil | null {
  return veil;
}
