/**
 * Small deterministic drawings: sigils, session arcs, band heatmaps.
 * All hairline, all computed from the data they claim to describe.
 */
import { beatTrace } from '../core/automation.js';
import { BANDS, bandOf } from '../core/octave.js';
import { segmentStarts, totalSeconds, type Script } from '../core/types.js';
import { polygon, sigilFor, wordPath, type Sigil } from './geometry.js';

export interface Ink {
  line: string;
  faint: string;
  accent: string;
  text: string;
  /** the three stops of the app's one gradient: purple, blue, green */
  stops: [string, string, string];
}

export function readInk(el: HTMLElement = document.body): Ink {
  const s = getComputedStyle(el);
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    line: get('--ink', '#16161a'),
    faint: get('--hairline', '#d8d8d2'),
    accent: get('--c2', '#1f8fff'),
    text: get('--ink-2', '#6e6e76'),
    stops: [get('--c1', '#6d4aff'), get('--c2', '#1f8fff'), get('--c3', '#12c79b')],
  };
}

/** The app's gradient, as something a canvas can stroke with. */
export function gradient(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, ink.stops[0]);
  g.addColorStop(0.52, ink.stops[1]);
  g.addColorStop(1, ink.stops[2]);
  return g;
}

/** Size a canvas for the device, capped so phones stay cool. */
export function fitCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(cssWidth * dpr));
  canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return ctx;
}

function dash(ctx: CanvasRenderingContext2D, stroke: Sigil['stroke']): void {
  if (stroke === 'dashed') ctx.setLineDash([4, 3]);
  else if (stroke === 'dotted') ctx.setLineDash([1, 3]);
  else ctx.setLineDash([]);
}

export function drawSigil(
  ctx: CanvasRenderingContext2D,
  sigil: Sigil,
  opts: { size: number; ink: Ink; rotation?: number; accent?: boolean },
): void {
  const { size, ink } = opts;
  const c = size / 2;
  const r = size * 0.42;
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(opts.rotation ?? 0);
  ctx.lineWidth = 1;
  const grad = gradient(ctx, ink, -r, -r, r, r);
  ctx.strokeStyle = grad;
  dash(ctx, sigil.stroke);

  // Rings: one per octave of transposition.
  ctx.globalAlpha = 0.45;
  for (let i = 1; i <= sigil.rings; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, (r * i) / sigil.rings, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Core form from the digital root.
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (sigil.form === 1) {
    ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
  } else if (sigil.form === 2) {
    ctx.arc(-r * 0.18, 0, r * 0.34, 0, Math.PI * 2);
    ctx.moveTo(r * 0.52, 0);
    ctx.arc(r * 0.18, 0, r * 0.34, 0, Math.PI * 2);
  } else {
    const pts = polygon(sigil.form, r * 0.62);
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  }
  ctx.stroke();

  // Digit nodes, connected back to centre.
  dash(ctx, sigil.stroke);
  ctx.globalAlpha = 0.8;
  sigil.nodes.forEach((angle, i) => {
    const rr = r * (0.5 + (0.5 * ((i % sigil.rings) + 1)) / sigil.rings);
    const x = Math.cos(angle - Math.PI / 2) * rr;
    const y = Math.sin(angle - Math.PI / 2) * rr;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    dash(ctx, sigil.stroke);
  });
  ctx.restore();
}

export function drawNumberSigil(
  canvas: HTMLCanvasElement,
  value: number,
  octaves: number,
  tier: 'measured' | 'protocol' | 'lore',
  size: number,
): void {
  const ctx = fitCanvas(canvas, size, size);
  drawSigil(ctx, sigilFor(value, octaves, tier), { size, ink: readInk(canvas) });
}

export function drawWordSigil(canvas: HTMLCanvasElement, word: string, size: number): void {
  const ctx = fitCanvas(canvas, size, size);
  const ink = readInk(canvas);
  const { points, symmetry } = wordPath(word);
  if (points.length === 0) return;
  const r = size * 0.4;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.lineWidth = 1;

  ctx.strokeStyle = ink.faint;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = ink.faint;
    ctx.fill();
  }

  ctx.strokeStyle = gradient(ctx, ink, -r, -r, r, r);
  ctx.globalAlpha = 1;
  for (let s = 0; s < symmetry; s++) {
    ctx.save();
    ctx.rotate((s / symmetry) * Math.PI * 2);
    ctx.globalAlpha = s === 0 ? 1 : 0.35;
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const px = x * r;
      const py = y * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (points.length > 2) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export interface TimelineOptions {
  width: number;
  height: number;
  position?: number;
  /** highlight one segment */
  active?: number;
  labels?: boolean;
}

/**
 * The session as a drawn line: x is time, y is beat frequency on a log scale
 * with the EEG bands ruled behind it. This is the "prescription" picture.
 */
export function drawTimeline(canvas: HTMLCanvasElement, script: Script, opts: TimelineOptions): void {
  const { width, height } = opts;
  const ctx = fitCanvas(canvas, width, height);
  const ink = readInk(canvas);
  const total = Math.max(1, totalSeconds(script));
  const starts = segmentStarts(script);
  const padL = opts.labels ? 26 : 6;
  const padR = 6;
  const padT = 6;
  const padB = opts.labels ? 14 : 6;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const loHz = 0.8;
  const hiHz = 48;
  const y = (hz: number) => {
    const clamped = Math.min(hiHz, Math.max(loHz, hz));
    const u = (Math.log2(clamped) - Math.log2(loHz)) / (Math.log2(hiHz) - Math.log2(loHz));
    return padT + h - u * h;
  };
  const x = (t: number) => padL + (t / total) * w;

  // Band rules — the map behind the line.
  ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (const band of BANDS) {
    const top = y(band.hi);
    const bottom = y(band.lo);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = ink.faint;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, top);
    ctx.lineTo(width - padR, top);
    ctx.stroke();
    if (opts.labels && bottom - top > 8) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = ink.text;
      ctx.fillText(band.label.split(' ')[0]!, 4, (top + bottom) / 2);
    }
  }
  ctx.setLineDash([]);

  // Segment boundaries.
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = ink.faint;
  starts.forEach((s) => {
    ctx.beginPath();
    ctx.moveTo(x(s), padT);
    ctx.lineTo(x(s), padT + h);
    ctx.stroke();
  });

  // The beat line itself, sampled through each segment's automation.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = gradient(ctx, ink, padL, padT + h, width - padR, padT);
  ctx.lineWidth = 1.75;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let first = true;
  script.segments.forEach((seg, i) => {
    const trace = beatTrace(script, i, 16);
    trace.forEach((hz, k) => {
      const t = starts[i]! + (seg.dur * k) / Math.max(1, trace.length - 1);
      const px = x(t);
      const py = y(hz);
      if (first) {
        ctx.moveTo(px, py);
        first = false;
      } else ctx.lineTo(px, py);
    });
  });
  ctx.stroke();

  // Active segment underline.
  if (opts.active !== undefined && script.segments[opts.active]) {
    const s = starts[opts.active]!;
    const e = s + script.segments[opts.active]!.dur;
    ctx.strokeStyle = ink.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x(s), padT + h + 3);
    ctx.lineTo(x(e), padT + h + 3);
    ctx.stroke();
  }

  // Playhead.
  if (opts.position !== undefined) {
    ctx.strokeStyle = ink.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x(opts.position), padT - 2);
    ctx.lineTo(x(opts.position), padT + h + 2);
    ctx.stroke();
  }
}

/** The session as a sound map: bands down, time across, ink density = gain. */
export function drawHeatmap(canvas: HTMLCanvasElement, script: Script, width: number, height: number): void {
  const ctx = fitCanvas(canvas, width, height);
  const ink = readInk(canvas);
  const total = Math.max(1, totalSeconds(script));
  const starts = segmentStarts(script);
  const rowH = height / BANDS.length;
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';

  BANDS.forEach((band, row) => {
    const yTop = row * rowH;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = ink.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(28, yTop);
    ctx.lineTo(width, yTop);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = ink.text;
    ctx.fillText(band.label.split(' ')[0]!, 2, yTop + rowH / 2);

    script.segments.forEach((seg, i) => {
      const x0 = 28 + ((starts[i]! / total) * (width - 28));
      const x1 = 28 + (((starts[i]! + seg.dur) / total) * (width - 28));
      let energy = 0;
      for (const l of seg.layers) {
        if (l.mute || l.kind !== 'tone' || l.method === 'tone') continue;
        if (bandOf(l.beat) === band.key) energy += l.gain;
      }
      if (energy <= 0) return;
      ctx.globalAlpha = Math.min(0.85, 0.2 + energy * 0.65);
      ctx.fillStyle = gradient(ctx, ink, 28, 0, width, height);
      ctx.fillRect(x0, yTop + 1.5, Math.max(1, x1 - x0 - 1), rowH - 3);
    });
  });
}
