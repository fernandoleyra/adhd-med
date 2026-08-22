/**
 * LAB — the whole instrument, exposed.
 *
 * Every field the audio engine reads is editable here: layers, waveforms drawn
 * as harmonic bars, amplitude and frequency modulators, filters, ratios,
 * equations over time, seeded randomness. Experimental mode widens every range
 * past the tested envelope so you can build combinations nobody has studied —
 * the limiter stays, the ranges do not.
 */
import { engine } from '../audio/engine.js';
import { NOISE_COLORS, NOISE_NOTES } from '../audio/noise.js';
import { baseValue } from '../core/automation.js';
import { compile, EXPR_VOCAB } from '../core/expr.js';
import { HARMONIC_SERIES, JUST_MAJOR, JUST_PENTATONIC, BANDS } from '../core/octave.js';
import { cleanScript, envelopeFor, MOD_RANGE, OPEN, TESTED, type Envelope } from '../core/ranges.js';
import { hashString, rng, seedWord } from '../core/rng.js';
import {
  layer,
  segment,
  soundingFreq,
  totalSeconds,
  type Layer,
  type Method,
  type Mod,
  type ModTarget,
  type NoiseColor,
  type Script,
  type WaveKind,
} from '../core/types.js';
import { store } from '../store.js';
import {
  accordion,
  chip,
  clear,
  el,
  field,
  formatMinutes,
  num,
  openSheet,
  section,
  select,
  toast,
  toggle,
} from '../ui/dom.js';
import { copyShare, playScript, segmentSummary } from '../ui/player.js';
import { drawTimeline, fitCanvas, readInk } from '../viz/marks.js';
import { moireAngle } from '../viz/geometry.js';
import { shareUrl } from '../core/codec.js';

const PRIMES = [1, 2, 3, 5, 7, 11, 13];
const FIB = [1, 2, 3, 5, 8, 13, 21];

const RATIO_SETS: { id: string; label: string; ratios: number[]; note: string }[] = [
  { id: 'harmonic', label: 'harmonic series', ratios: HARMONIC_SERIES, note: '1:2:3:4… the way a string actually vibrates' },
  { id: 'pentatonic', label: 'just pentatonic', ratios: JUST_PENTATONIC, note: 'no semitones, so nothing can clash' },
  { id: 'major', label: 'just major', ratios: JUST_MAJOR, note: 'small whole-number ratios' },
  { id: 'primes', label: 'primes', ratios: PRIMES, note: 'inharmonic, bell-like, slightly wrong on purpose' },
  { id: 'fib', label: 'Fibonacci', ratios: FIB, note: 'ratios drift toward φ and never repeat' },
  { id: 'octaves', label: 'octaves', ratios: [0.5, 1, 2, 4], note: 'the same pitch class, four registers' },
];

let current: Script = defaultScript();
let segIndex = 0;
let layerIndex = 0;
const openFolds = new Set<string>(['pad']);

function defaultScript(): Script {
  return cleanScript({
    v: 2,
    title: 'Lab bench',
    note: 'A single layer, waiting to be argued with.',
    seed: 1,
    origin: 'lab',
    segments: [segment(20, { carrier: 220, beat: 12, method: 'binaural', noise: 0.1 })],
  });
}

/** Adopt a script built elsewhere (the DJ's "Open in Lab", or a share link). */
export function loadIntoLab(script: Script): void {
  current = cleanScript({ ...script, origin: 'lab' });
  segIndex = 0;
  layerIndex = 0;
}

export function labScript(): Script {
  return current;
}

function seg() {
  return current.segments[Math.min(segIndex, current.segments.length - 1)]!;
}

function lay(): Layer {
  const s = seg();
  layerIndex = Math.min(layerIndex, s.layers.length - 1);
  return s.layers[layerIndex]!;
}

function env(): Envelope {
  return envelopeFor(current);
}

function commit(rebuild: () => void): void {
  current = cleanScript(current);
  segIndex = Math.min(segIndex, current.segments.length - 1);
  rebuild();
}

// ---------- XY pad ----------

function buildPad(rebuild: () => void): HTMLElement {
  const e = env();
  const canvas = el('canvas', { 'aria-hidden': 'true' });
  const readout = el('div', { class: 'pad-readout' });
  const pad = el('div', {
    class: 'pad',
    role: 'application',
    'aria-label': 'Beat and carrier pad. Drag to set both.',
  }, [canvas, readout]);

  const beatRange: [number, number] = [Math.max(0.5, e.beat[0] || 0.5), e.beat[1]];
  const carrierRange: [number, number] = [Math.max(20, e.carrier[0]), e.carrier[1]];
  const logPos = (v: number, [lo, hi]: [number, number]) =>
    (Math.log(Math.max(lo, v)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  const logVal = (u: number, [lo, hi]: [number, number]) => Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo)));

  const draw = () => {
    const w = pad.clientWidth || 320;
    const h = pad.clientHeight || 256;
    const ctx = fitCanvas(canvas, w, h);
    const ink = readInk(pad);
    const l = lay();
    const ux = logPos(l.beat, beatRange);
    const uy = 1 - logPos(l.carrier, carrierRange);

    // Two gratings whose moiré tracks the ratio you are setting.
    const spread = moireAngle(l.beat, soundingFreq(l));
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    for (const angle of [-spread, spread]) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);
      ctx.strokeStyle = ink.faint;
      ctx.beginPath();
      for (let x = -w; x < w; x += 9) {
        ctx.moveTo(x, -h);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Band gridlines on the beat axis.
    ctx.globalAlpha = 0.7;
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = ink.text;
    for (const band of BANDS) {
      if (band.lo < beatRange[0] || band.lo > beatRange[1]) continue;
      const x = logPos(band.lo, beatRange) * w;
      ctx.strokeStyle = ink.faint;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(band.label.split(' ')[0]!, x + 3, h - 4);
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ux * w, 0);
    ctx.lineTo(ux * w, h);
    ctx.moveTo(0, uy * h);
    ctx.lineTo(w, uy * h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ux * w, uy * h, 5, 0, Math.PI * 2);
    ctx.stroke();

    readout.replaceChildren(
      `beat ${l.beat.toFixed(2)} Hz · carrier ${l.carrier.toFixed(1)} Hz · ratio ${l.ratio} → ${soundingFreq(l).toFixed(1)} Hz`,
    );
  };

  let dragging = false;
  const set = (ev: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const ux = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    const uy = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
    const l = lay();
    l.beat = Number(logVal(ux, beatRange).toFixed(3));
    l.carrier = Number(logVal(1 - uy, carrierRange).toFixed(2));
    draw();
    stripDirty();
  };
  pad.addEventListener('pointerdown', (ev) => {
    dragging = true;
    pad.setPointerCapture(ev.pointerId);
    set(ev);
  });
  pad.addEventListener('pointermove', (ev) => dragging && set(ev));
  pad.addEventListener('pointerup', () => {
    dragging = false;
    commit(rebuild);
  });
  requestAnimationFrame(draw);
  return pad;
}

// ---------- harmonic drawing ----------

function buildHarmonics(l: Layer, rebuild: () => void): HTMLElement {
  const count = Math.min(env().harmonics, 16);
  const harmonics = l.wave.harmonics ?? [1];
  const bars = el('div', { class: 'harm', role: 'group', 'aria-label': 'Harmonic amplitudes' });
  for (let i = 0; i < count; i++) {
    const value = harmonics[i] ?? 0;
    const bar = el(
      'button',
      {
        type: 'button',
        title: `partial ${i + 1}`,
        'aria-label': `partial ${i + 1}, ${(value * 100).toFixed(0)} percent`,
        onclick: (ev: MouseEvent) => {
          const target = ev.currentTarget as HTMLElement;
          const rect = target.getBoundingClientRect();
          const u = 1 - Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
          const next = [...(l.wave.harmonics ?? [1])];
          while (next.length < count) next.push(0);
          next[i] = Number(u.toFixed(3));
          l.wave = { kind: 'custom', harmonics: next };
          commit(rebuild);
        },
      },
      [el('span', { style: { height: `${Math.round(value * 100)}%` } })],
    );
    bars.appendChild(bar);
  }
  return el('div', {}, [
    bars,
    el('p', { class: 'field-hint', text: 'tap a bar — this builds a waveform that may not have a name' }),
    el('div', { class: 'row tight' }, [
      ...['saw-ish', 'square-ish', 'organ', 'odd only', 'single'].map((name) =>
        chip(name, {
          onclick: () => {
            const n = count;
            const next = Array.from({ length: n }, (_, i) => {
              const h = i + 1;
              if (name === 'saw-ish') return 1 / h;
              if (name === 'square-ish') return h % 2 ? 1 / h : 0;
              if (name === 'organ') return [1, 0.5, 0, 0.35, 0, 0, 0, 0.2][i] ?? 0;
              if (name === 'odd only') return h % 2 ? 1 / (h * h) : 0;
              return i === 0 ? 1 : 0;
            });
            l.wave = { kind: 'custom', harmonics: next.map((v) => Number(v.toFixed(3))) };
            commit(rebuild);
          },
        }),
      ),
    ]),
  ]);
}

// ---------- mods ----------

const MOD_TARGETS: ModTarget[] = ['beat', 'carrier', 'ratio', 'gain', 'pan', 'filterFreq', 'amRate', 'amDepth', 'fmRate', 'fmDepth'];

/** Frequency-ish targets get a logarithmic slider; the rest are linear. */
const LOG_TARGETS = new Set<ModTarget>(['beat', 'carrier', 'filterFreq', 'amRate', 'fmRate', 'fmDepth']);

/**
 * Only offer what this layer actually has. A filterFreq mod on a layer with no
 * filter, or an amDepth mod with no modulator, would be a control that does
 * nothing — worse than a missing one.
 */
function targetsFor(l: Layer): ModTarget[] {
  return MOD_TARGETS.filter((t) => {
    if (t === 'filterFreq') return Boolean(l.filter);
    if (t === 'amRate' || t === 'amDepth') return Boolean(l.am);
    if (t === 'fmRate' || t === 'fmDepth') return Boolean(l.fm);
    if (l.kind === 'noise') return t === 'gain' || t === 'pan';
    if (t === 'beat') return l.method !== 'tone';
    return true;
  });
}

function unitFor(target: ModTarget): string | undefined {
  if (target === 'beat' || target === 'carrier' || target === 'filterFreq' || target === 'amRate' || target === 'fmRate' || target === 'fmDepth') return 'Hz';
  if (target === 'gain' || target === 'amDepth') return '%';
  return undefined;
}

function buildMods(l: Layer, rebuild: () => void): HTMLElement {
  const list = el('div');
  const targets = targetsFor(l);
  l.mods.forEach((mod, i) => {
    const range = env()[MOD_RANGE[mod.target]] as [number, number];
    const exprInput = el('input', {
      type: 'text',
      class: 'mono',
      value: mod.expr ?? '',
      placeholder: 'e.g. b + 3*sin(tau*u) or lerp(10,18,smooth(u))',
      'aria-label': 'Equation',
      oninput: (ev: Event) => {
        const value = (ev.target as HTMLInputElement).value.trim();
        mod.expr = value || undefined;
        const result = value ? compile(value) : null;
        status.textContent = !value
          ? ''
          : result && result.ok
            ? `ok · at u=0 → ${result.fn({ t: 0, u: 0, d: seg().dur, b: 10, r: 0.5, seed: 1 }).toFixed(2)} · at u=1 → ${result.fn({ t: seg().dur, u: 1, d: seg().dur, b: 10, r: 0.5, seed: 1 }).toFixed(2)}`
            : `× ${result?.ok === false ? result.error : 'invalid'}`;
      },
    });
    const status = el('div', { class: 'field-hint' });

    list.appendChild(
      el('div', { class: 'layer' }, [
        el('div', { class: 'layer-head' }, [
          el('span', { class: 'name', text: `mod ${i + 1}` }),
          el('div', { class: 'row tight' }, [
            el('button', {
              class: 'ghost',
              type: 'button',
              style: { minHeight: '32px', padding: '0 10px' },
              onclick: () => {
                l.mods.splice(i, 1);
                commit(rebuild);
              },
            }, ['remove']),
          ]),
        ]),
        select('drives', targets.map((t) => ({ value: t, label: t })), mod.target, (v) => {
          mod.target = v;
          // The new target has its own range, so re-anchor the sweep to the
          // layer's current value rather than clamping the old numbers into it.
          mod.from = baseValue(l, v);
          mod.to = baseValue(l, v);
          commit(rebuild);
        }),
        field({
          label: 'from',
          value: mod.from ?? range[0],
          min: range[0],
          max: range[1],
          unit: unitFor(mod.target),
          log: LOG_TARGETS.has(mod.target) && range[0] > 0,
          format: unitFor(mod.target) === '%' ? (v) => String(Math.round(v * 100)) : undefined,
          oninput: (v) => {
            mod.from = v;
          },
        }),
        field({
          label: 'to',
          value: mod.to ?? range[1],
          min: range[0],
          max: range[1],
          unit: unitFor(mod.target),
          log: LOG_TARGETS.has(mod.target) && range[0] > 0,
          format: unitFor(mod.target) === '%' ? (v) => String(Math.round(v * 100)) : undefined,
          oninput: (v) => {
            mod.to = v;
          },
        }),
        select(
          'shape',
          [
            { value: 'lin', label: 'linear' },
            { value: 'sine', label: 'ease' },
            { value: 'exp', label: 'accelerating' },
            { value: 'step', label: 'step halfway' },
          ],
          mod.curve ?? 'lin',
          (v) => {
            mod.curve = v as Mod['curve'];
          },
        ),
        field({
          label: 'drift',
          value: mod.jitter ?? 0,
          min: 0,
          max: env().jitter[1],
          hint: 'seeded random walk',
          oninput: (v) => {
            mod.jitter = v;
          },
        }),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'equation of t' })]),
          exprInput,
          status,
        ]),
      ]),
    );
  });

  return el('div', {}, [
    list,
    el('div', { class: 'row' }, [
      el('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          const target: ModTarget = targets.includes('beat') ? 'beat' : 'gain';
          const from = baseValue(l, target);
          l.mods.push({ target, from, to: target === 'beat' ? Math.max(0.5, from + 4) : from, curve: 'sine' });
          commit(rebuild);
        },
      }, ['Add motion']),
      chip('slow wobble', {
        hint: 'the beat breathes ±1.5 Hz on a 90-second cycle',
        onclick: () => {
          l.mods.push({ target: 'beat', expr: 'b + 1.5*sin(tau*t/90)' });
          commit(rebuild);
        },
      }),
      chip('stepped', {
        hint: 'climbs 8 → 20 Hz in 2 Hz steps',
        onclick: () => {
          l.mods.push({ target: 'beat', expr: 'quant(lerp(8,20,u), 2)' });
          commit(rebuild);
        },
      }),
      chip('noisy', {
        onclick: () => {
          l.mods.push({ target: 'carrier', expr: 'b * (1 + 0.06*(noise(t/20)-0.5))' });
          commit(rebuild);
        },
      }),
    ]),
    el('p', { class: 'field-hint' }, [
      `variables: ${EXPR_VOCAB.vars.join(' ')} · constants: ${EXPR_VOCAB.consts.join(' ')} · functions: ${EXPR_VOCAB.fns.join(' ')}`,
    ]),
    el('p', { class: 'field-hint', text: 'sampled 8×/s — for faster movement use the modulators' }),
  ]);
}

// ---------- layer editor ----------

function chipGroup(label: string, chips: HTMLElement[], hint?: string): HTMLElement {
  return el('div', { class: 'group' }, [
    el('span', { class: 'field-label', text: label }),
    el('div', { class: 'chips' }, chips),
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
  ]);
}

function buildLayerEditor(rebuild: () => void): HTMLElement {
  const l = lay();
  const e = env();
  const body: HTMLElement[] = [];

  body.push(
    chipGroup('source', [
      ...(['tone', 'noise'] as const).map((k) =>
        chip(k, {
          active: l.kind === k,
          onclick: () => {
            l.kind = k;
            if (k === 'noise') l.method = 'tone';
            commit(rebuild);
          },
        }),
      ),
      chip(l.mute ? 'muted' : 'audible', {
        active: !l.mute,
        onclick: () => {
          l.mute = !l.mute;
          commit(rebuild);
        },
      }),
    ]),
  );

  if (l.kind === 'noise') {
    body.push(
      chipGroup(
        'colour',
        NOISE_COLORS.map((c: NoiseColor) =>
          chip(c, {
            active: l.color === c,
            hint: NOISE_NOTES[c],
            onclick: () => {
              l.color = c;
              commit(rebuild);
            },
          }),
        ),
        NOISE_NOTES[l.color],
      ),
    );
  } else {
    body.push(
      chipGroup(
        'delivery',
        [
          ...(['binaural', 'monaural', 'isochronic'] as Method[]).map((m) =>
            chip(m, {
              active: l.method === m,
              hint:
                m === 'binaural'
                  ? 'one tone per ear — needs headphones'
                  : m === 'monaural'
                    ? 'the beat is really in the air — speakers fine'
                    : 'a pulsed tone — the most assertive, speakers fine',
              onclick: () => {
                l.method = m;
                commit(rebuild);
              },
            }),
          ),
          chip('drone', {
            active: l.method === 'tone',
            hint: 'no beat at all — use these as partials in a stack',
            onclick: () => {
              l.method = 'tone';
              commit(rebuild);
            },
          }),
        ],
      ),
      chipGroup(
        'waveform',
        (['sine', 'triangle', 'square', 'sawtooth', 'custom'] as WaveKind[]).map((w) =>
          chip(w, {
            active: l.wave.kind === w,
            onclick: () => {
              l.wave = w === 'custom' ? { kind: 'custom', harmonics: l.wave.harmonics ?? [1, 0.5, 0.25] } : { kind: w };
              commit(rebuild);
            },
          }),
        ),
        undefined,
      ),
      l.wave.kind === 'custom' ? buildHarmonics(l, rebuild) : el('div'),
      field({
        label: 'carrier',
        value: l.carrier,
        min: e.carrier[0],
        max: e.carrier[1],
        unit: 'Hz',
        log: true,
        hint: `sounding: ${soundingFreq(l).toFixed(1)} Hz`,
        oninput: (v) => {
          l.carrier = v;
          stripDirty();
        },
      }),
      field({
        label: 'beat',
        value: l.beat,
        min: Math.max(0.1, e.beat[0] || 0.1),
        max: e.beat[1],
        unit: 'Hz',
        log: true,
        hint: l.method === 'binaural' ? 'the difference between your ears' : l.method === 'isochronic' ? 'the pulse rate' : 'the acoustic beat',
        oninput: (v) => {
          l.beat = v;
          stripDirty();
        },
      }),
      field({
        label: 'ratio',
        value: l.ratio,
        min: e.ratio[0],
        max: e.ratio[1],
        log: true,
        hint: 'multiplies the carrier — 2 is an octave up, 1.5 a fifth',
        oninput: (v) => {
          l.ratio = v;
        },
      }),
      field({
        label: 'detune (right)',
        value: l.detune,
        min: e.detune[0],
        max: e.detune[1],
        unit: '¢',
        hint: 'cents added to the right-hand oscillator only',
        oninput: (v) => {
          l.detune = v;
        },
      }),
    );
  }

  body.push(
    field({
      label: 'gain',
      value: l.gain,
      min: 0,
      max: 1,
      unit: '%',
      format: (v) => String(Math.round(v * 100)),
      oninput: (v) => {
        l.gain = v;
      },
    }),
    field({
      label: 'pan',
      value: l.pan,
      min: -1,
      max: 1,
      step: 0.01,
      hint: '−1 left, +1 right',
      oninput: (v) => {
        l.pan = v;
      },
    }),
  );

  // Modulators
  const modBlock = (kind: 'am' | 'fm') => {
    const lfo = l[kind];
    const label = kind === 'am' ? 'amplitude modulation' : 'frequency modulation';
    return el('div', { class: 'layer' }, [
      toggle(label, Boolean(lfo), (on) => {
        l[kind] = on ? { rate: kind === 'am' ? 4 : 6, depth: kind === 'am' ? 0.4 : 8, wave: 'sine' } : null;
        commit(rebuild);
      }, kind === 'am' ? 'tremolo, or a full gate at depth 100%' : 'vibrato, and at high rates a whole new timbre'),
      ...(lfo
        ? [
            field({
              label: 'rate',
              value: lfo.rate,
              min: 0.01,
              max: kind === 'am' ? e.amRate[1] : e.fmRate[1],
              unit: 'Hz',
              log: true,
              oninput: (v) => {
                lfo.rate = v;
              },
            }),
            field({
              label: 'depth',
              value: lfo.depth,
              min: 0,
              max: kind === 'am' ? 1 : e.fmDepth[1],
              unit: kind === 'am' ? '%' : 'Hz',
              format: kind === 'am' ? (v) => String(Math.round(v * 100)) : undefined,
              oninput: (v) => {
                lfo.depth = v;
              },
            }),
            el('div', { class: 'chips' },
              (['sine', 'triangle', 'square', 'sawtooth'] as const).map((w) =>
                chip(w, {
                  active: lfo.wave === w,
                  onclick: () => {
                    lfo.wave = w;
                    commit(rebuild);
                  },
                }),
              ),
            ),
          ]
        : []),
    ]);
  };

  body.push(modBlock('am'), modBlock('fm'));

  // Filter
  body.push(
    el('div', { class: 'layer' }, [
      toggle('filter', Boolean(l.filter), (on) => {
        l.filter = on ? { kind: 'lowpass', freq: 2000, q: 1 } : null;
        commit(rebuild);
      }),
      ...(l.filter
        ? [
            el('div', { class: 'chips' },
              (['lowpass', 'highpass', 'bandpass', 'notch', 'peaking'] as const).map((k) =>
                chip(k, {
                  active: l.filter!.kind === k,
                  onclick: () => {
                    l.filter!.kind = k;
                    commit(rebuild);
                  },
                }),
              ),
            ),
            field({
              label: 'cutoff',
              value: l.filter.freq,
              min: e.filterFreq[0],
              max: e.filterFreq[1],
              unit: 'Hz',
              log: true,
              oninput: (v) => {
                l.filter!.freq = v;
              },
            }),
            field({
              label: 'resonance',
              value: l.filter.q,
              min: e.filterQ[0],
              max: e.filterQ[1],
              log: true,
              oninput: (v) => {
                l.filter!.q = v;
              },
            }),
          ]
        : []),
    ]),
  );

  body.push(accordion('mods', 'motion & equations', buildMods(l, rebuild), { openSet: openFolds, hint: `${l.mods.length}` }));

  body.push(
    el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [
      el('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          void engine.previewLayer(cleanScript({ segments: [{ layers: [l] }], unsafe: current.unsafe }).segments[0]!.layers[0]!, 20);
          toast('Auditioning this layer alone for 20 seconds.');
        },
      }, ['Audition layer']),
      el('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          engine.stopPreview();
        },
      }, ['Stop audition']),
    ]),
  );

  return el('div', {}, body);
}

// ---------- grid sequencer ----------

function buildGrid(rebuild: () => void): HTMLElement {
  const cols = 8;
  const grid = el('div', { class: 'grid-seq', style: { gridTemplateColumns: `36px repeat(${cols}, 1fr)` } });
  // Read the current script back into the grid: which band each column sits in.
  const columnBand = (c: number): number => {
    const seg = current.segments[c];
    if (!seg) return -1;
    const lead = seg.layers.find((l) => l.kind === 'tone' && l.method !== 'tone');
    if (!lead) return -1;
    return BANDS.findIndex((b) => lead.beat >= b.lo && lead.beat < b.hi);
  };

  BANDS.forEach((band, row) => {
    grid.appendChild(el('div', { class: 'rowlabel', text: band.label.split(' ')[0]! }));
    for (let c = 0; c < cols; c++) {
      const on = columnBand(c) === row;
      grid.appendChild(
        el('button', {
          class: `cell${on ? ' is-on' : ''}`,
          type: 'button',
          'aria-label': `${band.label} at step ${c + 1}`,
          'aria-pressed': on ? 'true' : 'false',
          onclick: () => {
            const minutes = 3;
            const beat = (band.lo + band.hi) / 2;
            const carrier = 120 + row * 40;
            while (current.segments.length <= c) {
              current.segments.push(segment(minutes, { carrier: 200, beat: 10, label: `step ${current.segments.length + 1}` }));
            }
            current.segments[c] = segment(minutes, {
              carrier,
              beat,
              method: store.settings.method,
              label: `${band.label.split(' ')[1] ?? band.key} ${c + 1}`,
              why: `grid step ${c + 1} placed in ${band.label}`,
            });
            commit(rebuild);
          },
        }),
      );
    }
  });

  return el('div', {}, [
    grid,
    el('p', { class: 'field-hint', text: 'column = segment · row = band' }),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          current.segments = current.segments.slice(0, 1);
          commit(rebuild);
        },
      }, ['Clear to one segment']),
    ]),
  ]);
}

// ---------- numbers ----------

function buildNumbers(rebuild: () => void): HTMLElement {
  const l = lay();
  return el('div', {}, [
    el('p', { class: 'field-hint', text: 'adds each ratio as a drone above this layer' }),
    ...RATIO_SETS.map((set) =>
      el('div', { class: 'row', style: { marginBottom: 'var(--s2)' } }, [
        chip(set.label, {
          hint: set.note,
          onclick: () => {
            const s = seg();
            const base = l.carrier;
            const room = env().layers - s.layers.length;
            set.ratios.slice(1, Math.max(1, room + 1)).forEach((r, i) => {
              s.layers.push(
                layer({
                  method: 'tone',
                  carrier: base,
                  ratio: r,
                  beat: 0,
                  gain: Math.max(0.06, 0.3 / (i + 1.5)),
                  pan: i % 2 === 0 ? -0.3 : 0.3,
                  filter: { kind: 'lowpass', freq: 5000, q: 0.7 },
                }),
              );
            });
            commit(rebuild);
            toast(`${set.label}: ${set.note}`);
          },
        }),
        el('span', { class: 'field-hint', text: set.ratios.map((r) => (Number.isInteger(r) ? r : r.toFixed(3))).join(' : ') }),
      ]),
    ),
    el('div', { class: 'row', style: { marginTop: 'var(--s4)' } }, [
      ...[2, 3, 5, 7].map((n) =>
        chip(`quantise beat /${n}`, {
          hint: `snap the beat to a multiple of ${n} Hz`,
          onclick: () => {
            l.beat = Math.max(0.5, Math.round(l.beat / n) * n);
            commit(rebuild);
          },
        }),
      ),
    ]),
  ]);
}

// ---------- dice ----------

function buildDice(rebuild: () => void): HTMLElement {
  const seedInput = el('input', {
    type: 'text',
    class: 'mono',
    value: seedWord(current.seed ?? 1),
    'aria-label': 'Seed word',
    oninput: (ev: Event) => {
      current.seed = hashString((ev.target as HTMLInputElement).value) % 1e9;
    },
  });

  const roll = (amount: number) => {
    const random = rng(current.seed ?? 1);
    const e = env();
    for (const s of current.segments) {
      for (const l of s.layers) {
        const jitter = (range: [number, number], value: number) => {
          const span = (range[1] - range[0]) * amount * 0.15;
          return Math.min(range[1], Math.max(range[0], value + (random() * 2 - 1) * span));
        };
        l.beat = Number(jitter(e.beat, l.beat).toFixed(2));
        l.carrier = Number(jitter(e.carrier, l.carrier).toFixed(1));
        l.gain = Number(jitter([0.05, 1], l.gain).toFixed(2));
        // Balance, not hard pan: ±0.6 keeps both ears fed, so a binaural beat
        // survives a scramble.
        if (random() > 0.7) l.pan = Number(((random() * 2 - 1) * 0.6).toFixed(2));
      }
    }
    commit(rebuild);
  };

  return el('div', {}, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'seed' }), num(String(current.seed ?? 1))]),
      seedInput,
      el('span', { class: 'field-hint', text: 'same seed, same session' }),
    ]),
    el('div', { class: 'row' }, [
      el('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => {
          current.seed = Math.floor(Math.random() * 1e9);
          seedInput.value = seedWord(current.seed);
          roll(1);
        },
      }, ['New seed & roll']),
      chip('nudge', { onclick: () => roll(0.35) }),
      chip('shake', { onclick: () => roll(1) }),
      chip('scramble', { onclick: () => roll(2.5) }),
    ]),
  ]);
}

// ---------- envelope ----------

function buildEnvelope(rebuild: () => void): HTMLElement {
  const rows = ([
    ['carrier', 'Hz'],
    ['beat', 'Hz'],
    ['ratio', '×'],
    ['fmDepth', 'Hz'],
    ['amRate', 'Hz'],
    ['layers', 'per segment'],
  ] as const).map(([key, unit]) => {
    const tested = TESTED[key];
    const open = OPEN[key];
    const fmt = (v: number | [number, number]) => (Array.isArray(v) ? `${v[0]} – ${v[1]}` : String(v));
    return el('li', { text: `${key}: tested ${fmt(tested)} ${unit} · open ${fmt(open)} ${unit}` });
  });

  return el('div', {}, [
    toggle(
      'Experimental envelope',
      Boolean(current.unsafe),
      (on) => {
        if (on && !store.settings.experimental) {
          // Re-render on close so a dismissed sheet leaves the switch showing
          // the truth, which is still "off".
          openSheet({
            title: 'Leaving the tested range',
            onclose: () => rebuild(),
            body: [
              el('p', { class: 'lead' }, [
                'Experimental mode widens every range far past anything in the literature: carriers down to a fraction of a hertz and up past hearing, beats to 400 Hz, deep frequency modulation, sixteen layers at once. You will be able to make sounds nobody has studied. Some of them will be unpleasant.',
              ]),
              el('p', {}, [
                'The output limiter and the hard gain cap stay on — those are hearing safety, not a creative restriction. Turn your volume down before you explore.',
              ]),
              el('ul', { class: 'derive' }, rows),
              el('div', { class: 'row', style: { marginTop: 'var(--s4)' } }, [
                el('button', {
                  class: 'primary',
                  type: 'button',
                  onclick: () => {
                    store.update({ experimental: true });
                    current.unsafe = true;
                    document.getElementById('sheet')?.remove();
                    commit(rebuild);
                  },
                }, ['I understand — open it up']),
              ]),
            ],
          });
          return;
        }
        current.unsafe = on || undefined;
        commit(rebuild);
      },
      'Widen every range past what anyone has tested.',
    ),
    el('ul', { class: 'derive' }, rows),
  ]);
}

// ---------- import / export ----------

function openJson(rebuild: () => void): void {
  const area = el('textarea', { class: 'mono', rows: '14', text: JSON.stringify(current, null, 2) });
  openSheet({
    title: 'Session as JSON',
    wide: true,
    body: [
      el('p', { class: 'field-hint', text: 'paste one in and load — it gets validated like anything else' }),
      area,
      el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [
        el('button', {
          class: 'primary',
          type: 'button',
          onclick: () => {
            try {
              current = cleanScript(JSON.parse(area.value));
              segIndex = 0;
              layerIndex = 0;
              document.getElementById('sheet')?.remove();
              rebuild();
              toast('Loaded.');
            } catch {
              toast('That is not valid JSON.', 'warn');
            }
          },
        }, ['Load']),
        el('button', {
          class: 'ghost',
          type: 'button',
          onclick: async () => {
            await navigator.clipboard.writeText(area.value).catch(() => undefined);
            toast('Copied.');
          },
        }, ['Copy']),
      ]),
    ],
  });
}

// ---------- strip ----------

let stripCanvas: HTMLCanvasElement | null = null;

function stripDirty(): void {
  if (!stripCanvas) return;
  const w = stripCanvas.parentElement?.clientWidth ?? 320;
  drawTimeline(stripCanvas, cleanScript(current), { width: w, height: 108, labels: true, active: segIndex });
}

// ---------- view ----------

export function renderLab(host: HTMLElement): void {
  const rebuild = () => renderLab(host);
  const e = env();
  const s = seg();

  const segChips = el('div', { class: 'chips' }, [
    ...current.segments.map((sg, i) =>
      chip(sg.label ?? `seg ${i + 1}`, {
        active: i === segIndex,
        tag: formatMinutes(sg.dur),
        onclick: () => {
          segIndex = i;
          layerIndex = 0;
          rebuild();
        },
      }),
    ),
    current.segments.length < e.segments
      ? chip('+ segment', {
          onclick: () => {
            current.segments.splice(segIndex + 1, 0, structuredClone(s));
            segIndex += 1;
            commit(rebuild);
          },
        })
      : null,
  ].filter(Boolean) as HTMLElement[]);

  stripCanvas = el('canvas', { class: 'strip', 'aria-hidden': 'true' });

  const layerChips = el('div', { class: 'chips' }, [
    ...s.layers.map((l, i) =>
      chip(l.kind === 'noise' ? `${l.color} noise` : `${l.method} ${soundingFreq(l).toFixed(0)}`, {
        active: i === layerIndex,
        tag: l.mute ? 'muted' : undefined,
        onclick: () => {
          layerIndex = i;
          rebuild();
        },
      }),
    ),
    s.layers.length < e.layers
      ? chip('+ layer', {
          onclick: () => {
            s.layers.push(layer({ method: 'tone', carrier: lay().carrier, ratio: 1.5, beat: 0, gain: 0.25 }));
            layerIndex = s.layers.length - 1;
            commit(rebuild);
          },
        })
      : null,
  ].filter(Boolean) as HTMLElement[]);

  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('Lab', [
        stripCanvas,
        el('div', { class: 'spread' }, [
          el('span', { class: 'field-hint', text: `${current.segments.length} segment${current.segments.length === 1 ? '' : 's'} · ${formatMinutes(totalSeconds(current))} · ${segmentSummary(s)}` }),
          el('span', { class: 'field-hint', text: current.unsafe ? 'experimental' : 'tested range' }),
        ]),
        el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [
          el('button', { class: 'primary', type: 'button', onclick: () => playScript(cleanScript(current)) }, ['Play']),
          el('button', { class: 'ghost', type: 'button', onclick: () => void copyShare(cleanScript(current)) }, ['Copy link']),
          el('button', {
            class: 'ghost',
            type: 'button',
            onclick: async () => {
              const url = await shareUrl(cleanScript(current));
              store.save({ id: Date.now().toString(36), title: current.title, payload: url.split('m=')[1] ?? '', at: Date.now() });
              toast('Saved to this browser.');
            },
          }, ['Save']),
          el('button', { class: 'ghost', type: 'button', onclick: () => openJson(rebuild) }, ['JSON']),
        ]),
      ]),

      section('Timeline', [
        segChips,
        el('label', { class: 'field' }, [
          el('span', { class: 'field-head' }, [
            el('span', { class: 'field-label', text: 'title' }),
          ]),
          el('input', {
            type: 'text',
            value: current.title,
            'aria-label': 'Session title',
            oninput: (ev: Event) => {
              current.title = (ev.target as HTMLInputElement).value;
            },
          }),
        ]),
        field({
          label: 'segment length',
          value: s.dur / 60,
          min: e.dur[0] / 60,
          max: e.dur[1] / 60,
          unit: 'min',
          log: true,
          oninput: (v) => {
            s.dur = Math.round(v * 60);
            stripDirty();
          },
        }),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: 'segment label' })]),
          el('input', {
            type: 'text',
            value: s.label ?? '',
            'aria-label': 'Segment label',
            oninput: (ev: Event) => {
              s.label = (ev.target as HTMLInputElement).value;
            },
          }),
        ]),
        el('div', { class: 'row' }, [
          current.segments.length > 1
            ? el('button', {
                class: 'ghost',
                type: 'button',
                onclick: () => {
                  current.segments.splice(segIndex, 1);
                  segIndex = Math.max(0, segIndex - 1);
                  commit(rebuild);
                },
              }, ['Delete segment'])
            : null,
          segIndex > 0
            ? el('button', {
                class: 'ghost',
                type: 'button',
                onclick: () => {
                  const [moved] = current.segments.splice(segIndex, 1);
                  current.segments.splice(segIndex - 1, 0, moved!);
                  segIndex -= 1;
                  commit(rebuild);
                },
              }, ['← earlier'])
            : null,
          segIndex < current.segments.length - 1
            ? el('button', {
                class: 'ghost',
                type: 'button',
                onclick: () => {
                  const [moved] = current.segments.splice(segIndex, 1);
                  current.segments.splice(segIndex + 1, 0, moved!);
                  segIndex += 1;
                  commit(rebuild);
                },
              }, ['later →'])
            : null,
        ].filter(Boolean) as HTMLElement[]),
      ]),

      accordion('pad', 'pad', buildPad(rebuild), { openSet: openFolds, hint: 'beat × carrier' }),
      accordion('layers', 'layers', el('div', {}, [layerChips, buildLayerEditor(rebuild),
        s.layers.length > 1
          ? el('button', {
              class: 'ghost',
              type: 'button',
              onclick: () => {
                s.layers.splice(layerIndex, 1);
                layerIndex = 0;
                commit(rebuild);
              },
            }, ['Delete layer'])
          : null,
      ].filter(Boolean) as HTMLElement[]), { openSet: openFolds, hint: `${s.layers.length} of ${e.layers}` }),
      accordion('grid', 'grid', buildGrid(rebuild), { openSet: openFolds, hint: 'bands × steps' }),
      accordion('numbers', 'numbers', buildNumbers(rebuild), { openSet: openFolds, hint: 'ratios & intervals' }),
      accordion('dice', 'dice', buildDice(rebuild), { openSet: openFolds, hint: 'seeded randomness' }),
      accordion('envelope', 'envelope', buildEnvelope(rebuild), { openSet: openFolds, hint: current.unsafe ? 'open' : 'tested' }),
    ]),
  );

  requestAnimationFrame(stripDirty);
}
