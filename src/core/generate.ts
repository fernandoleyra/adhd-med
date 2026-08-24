/**
 * The scripted DJ — the part that works with no key, no network, no account.
 *
 * Arcs are grounded in what the reading actually supports:
 *  · every arc opens with an onset ramp, because exposure before *and* during a
 *    task beat exposure during it alone in the 2019 meta-analysis;
 *  · focus arcs climb alpha → SMR → beta and never sit in theta, since raised
 *    theta is the most-replicated EEG finding in ADHD;
 *  · calm and sleep arcs descend into theta and delta, where the anxiety effect
 *    sizes are largest;
 *  · nothing claims to treat anything.
 */
import { cleanScript } from './ranges.js';
import { pickFrom, rng } from './rng.js';
import { layer, type Layer, type Method, type Script, type Segment } from './types.js';

export type GoalId = 'focus' | 'deep' | 'study' | 'read' | 'calm' | 'unwind' | 'meditate' | 'sleep' | 'spark';
export type MoodId = 'restless' | 'foggy' | 'anxious' | 'wired' | 'tired' | 'low';

export interface Tag<T extends string> {
  id: T;
  label: string;
  hint: string;
}

export const GOALS: Tag<GoalId>[] = [
  { id: 'focus', label: 'Focus', hint: 'one task, moderate climb' },
  { id: 'deep', label: 'Deep work', hint: 'long beta hold' },
  { id: 'study', label: 'Study', hint: 'waves with valleys' },
  { id: 'read', label: 'Read', hint: 'quiet alpha–SMR' },
  { id: 'calm', label: 'Calm', hint: 'down into theta' },
  { id: 'unwind', label: 'Unwind', hint: 'slow evening descent' },
  { id: 'meditate', label: 'Meditate', hint: 'theta plateau' },
  { id: 'sleep', label: 'Sleep', hint: 'descent to delta, fades out' },
  { id: 'spark', label: 'Spark', hint: 'short climb to 40 Hz' },
];

export const MOODS: Tag<MoodId>[] = [
  { id: 'restless', label: 'restless', hint: 'shorter segments, more movement' },
  { id: 'foggy', label: 'foggy', hint: 'longer onset' },
  { id: 'anxious', label: 'anxious', hint: 'alpha prelude, more noise bed' },
  { id: 'wired', label: 'wired', hint: 'darker carriers, longer release' },
  { id: 'tired', label: 'tired', hint: 'a touch brighter and faster' },
  { id: 'low', label: 'low', hint: 'brighter carriers' },
];

export const DURATIONS = [5, 15, 25, 45, 90] as const;

interface Stage {
  label: string;
  why: string;
  /** a single beat frequency, or a sweep [from, to] */
  beat: number | [number, number];
  carrier: number | [number, number];
  /** minutes fixed regardless of session length */
  fixed?: number;
  /** share of the remaining time */
  weight?: number;
  noise?: number;
  method?: Method;
  fade?: 'out';
}

interface Arc {
  goal: GoalId;
  name: string;
  note: string;
  stages: Stage[];
}

const ONSET: Stage = {
  label: 'onset',
  why: 'starting before the work matters: pre-task exposure outperformed during-task alone',
  beat: [10, 14],
  carrier: 220,
  fixed: 3,
};

export const ARCS: Record<GoalId, Arc> = {
  focus: {
    goal: 'focus',
    name: 'Focus',
    note: 'Alpha up into SMR, then a beta hold, then a short release.',
    stages: [
      ONSET,
      { label: 'settle', why: 'SMR is the band ADHD neurofeedback tries to raise', beat: 14, carrier: 220, weight: 0.3 },
      { label: 'hold', why: 'low beta for sustained single-task attention', beat: 16, carrier: 240, weight: 0.7 },
      { label: 'release', why: 'back to alpha so stopping is not a wall', beat: 10, carrier: 200, fixed: 3 },
    ],
  },
  deep: {
    goal: 'deep',
    name: 'Deep work',
    note: 'A slow climb and a long beta plateau. Headphones, door shut.',
    stages: [
      { ...ONSET, fixed: 4 },
      { label: 'climb', why: 'crossing SMR before beta keeps the step small', beat: [14, 16], carrier: 240, weight: 0.25 },
      { label: 'plateau', why: 'a long steady hold — the point is not noticing it', beat: [16, 18], carrier: 260, weight: 0.75, noise: 0.1 },
      { label: 'release', why: 'alpha landing', beat: 10, carrier: 200, fixed: 4 },
    ],
  },
  study: {
    goal: 'study',
    name: 'Study',
    note: 'Beta waves with alpha valleys — attention is not a straight line.',
    stages: [
      { ...ONSET, fixed: 4 },
      { label: 'wave I', why: 'beta block', beat: 17, carrier: 260, weight: 0.38 },
      { label: 'valley', why: 'a deliberate alpha dip: rest is part of the protocol', beat: 10, carrier: 200, weight: 0.12 },
      { label: 'wave II', why: 'second beta block', beat: 17, carrier: 260, weight: 0.38 },
      { label: 'release', why: 'alpha landing', beat: 10, carrier: 200, weight: 0.12 },
    ],
  },
  read: {
    goal: 'read',
    name: 'Read',
    note: 'Quiet. Alpha into low SMR, nothing that pulls at the words.',
    stages: [
      { ...ONSET, beat: [10, 12], fixed: 3 },
      { label: 'hold', why: 'low SMR: alert but not pushy', beat: 12, carrier: 220, weight: 1, noise: 0.08 },
      { label: 'release', why: 'alpha landing', beat: 10, carrier: 200, fixed: 2 },
    ],
  },
  calm: {
    goal: 'calm',
    name: 'Calm',
    note: 'Down through alpha into theta, where the anxiety effect sizes are largest.',
    stages: [
      { label: 'onset', why: 'meeting you where you are: alpha first', beat: 10, carrier: 180, fixed: 3 },
      { label: 'descend', why: 'alpha into theta', beat: [10, 8], carrier: 165, weight: 0.4 },
      { label: 'theta', why: 'theta/delta beats carried the strongest anxiety effect (g≈0.69)', beat: 6, carrier: 150, weight: 0.6, noise: 0.14 },
    ],
  },
  unwind: {
    goal: 'unwind',
    name: 'Unwind',
    note: 'An evening descent that passes through 7.83 Hz on the way down.',
    stages: [
      { label: 'onset', why: 'alpha to begin', beat: 10, carrier: 180, fixed: 3 },
      { label: 'schumann', why: 'the Earth–ionosphere resonance, 7.83 Hz — measured, and conveniently on the path', beat: 7.83, carrier: 160, weight: 0.5, noise: 0.16 },
      { label: 'theta', why: 'settling into theta', beat: 6, carrier: 140, weight: 0.5, noise: 0.16 },
    ],
  },
  meditate: {
    goal: 'meditate',
    name: 'Meditate',
    note: 'Theta plateau with alpha at both ends. Hemi-Sync shaped: carrier, beat, pink bed.',
    stages: [
      { label: 'entry', why: 'alpha entry', beat: 8, carrier: 160, fixed: 4 },
      { label: 'plateau', why: 'theta: the band of light meditation and inward attention', beat: 6, carrier: 140, weight: 1, noise: 0.18 },
      { label: 'return', why: 'alpha before you open your eyes', beat: 8, carrier: 160, fixed: 4 },
    ],
  },
  sleep: {
    goal: 'sleep',
    name: 'Sleep',
    note: 'A long ladder down to delta that fades to nothing. Set it and forget it.',
    stages: [
      { label: 'onset', why: 'alpha', beat: 10, carrier: 180, fixed: 4 },
      { label: 'theta', why: 'alpha into theta', beat: [8, 6], carrier: 160, weight: 0.3, noise: 0.18 },
      { label: 'deep theta', why: 'drowsy band', beat: [6, 4], carrier: 140, weight: 0.3, noise: 0.2 },
      { label: 'delta', why: 'delta: the band of deep sleep', beat: [3, 1.5], carrier: 110, weight: 0.4, noise: 0.22, fade: 'out' },
    ],
  },
  spark: {
    goal: 'spark',
    name: 'Spark',
    note: 'Short and bright, up to 40 Hz gamma. Isochronic, so it works on a speaker.',
    stages: [
      { label: 'onset', why: 'SMR to start', beat: 12, carrier: 240, fixed: 2 },
      { label: 'climb', why: 'beta', beat: 18, carrier: 280, weight: 0.5, method: 'isochronic' },
      { label: 'gamma', why: '40 Hz — the frequency the MIT sensory-entrainment work is built on', beat: 40, carrier: 320, weight: 0.5, method: 'isochronic' },
      { label: 'land', why: 'back to SMR', beat: 14, carrier: 240, fixed: 1 },
    ],
  },
};

export interface GenerateOptions {
  goal: GoalId;
  moods?: MoodId[];
  minutes?: number;
  seed?: number;
  /** headphones off → speaker-safe delivery */
  method?: Method;
  title?: string;
  /**
   * Move the whole arc to a different carrier — from a colour, a constant, a
   * word. The arc's own carrier movement is preserved, scaled around this root,
   * because the shape is the part with evidence behind it.
   */
  root?: number;
}

interface MoodEffect {
  carrierScale: number;
  onsetBonus: number;
  noiseBonus: number;
  beatShift: number;
  releaseScale: number;
  splitSegments: boolean;
  alphaPrelude: boolean;
}

function moodEffect(moods: MoodId[]): MoodEffect {
  const e: MoodEffect = {
    carrierScale: 1, onsetBonus: 0, noiseBonus: 0, beatShift: 0,
    releaseScale: 1, splitSegments: false, alphaPrelude: false,
  };
  for (const m of moods) {
    if (m === 'restless') e.splitSegments = true;
    if (m === 'foggy') e.onsetBonus += 2;
    if (m === 'anxious') { e.alphaPrelude = true; e.noiseBonus += 0.08; }
    if (m === 'wired') { e.carrierScale *= 0.85; e.releaseScale *= 2; e.noiseBonus += 0.05; }
    if (m === 'tired') e.beatShift += 1;
    if (m === 'low') e.carrierScale *= 1.1;
  }
  return e;
}

function stageLayers(
  stage: Stage,
  opts: { method: Method; carrierScale: number; beatShift: number; noiseBonus: number; jitter: number },
): Layer[] {
  const [beatFrom, beatTo] = Array.isArray(stage.beat) ? stage.beat : [stage.beat, stage.beat];
  const [carrierFrom, carrierTo] = Array.isArray(stage.carrier) ? stage.carrier : [stage.carrier, stage.carrier];
  const shift = beatFrom > 8 ? opts.beatShift : 0; // never speed up a descent
  const carrier = carrierFrom * opts.carrierScale;
  const main = layer({
    method: stage.method ?? opts.method,
    carrier,
    beat: Math.max(0.5, beatFrom + shift),
    gain: 0.55,
  });
  const mods = main.mods;
  if (beatTo !== beatFrom) mods.push({ target: 'beat', from: Math.max(0.5, beatFrom + shift), to: Math.max(0.5, beatTo + shift), curve: 'sine' });
  if (carrierTo !== carrierFrom) mods.push({ target: 'carrier', from: carrier, to: carrierTo * opts.carrierScale, curve: 'sine' });
  if (opts.jitter > 0) mods.push({ target: 'beat', jitter: opts.jitter });
  if (stage.fade === 'out') mods.push({ target: 'gain', from: 0.55, to: 0, curve: 'exp' });

  const layers = [main];
  const noise = (stage.noise ?? 0) + opts.noiseBonus;
  if (noise > 0.01) {
    layers.push(layer({ kind: 'noise', method: 'tone', color: 'pink', gain: Math.min(0.35, noise), filter: { kind: 'lowpass', freq: 6000, q: 0.7 } }));
  }
  return layers;
}

/** Build a session from tags. Same inputs → same session. */
export function generate(options: GenerateOptions): Script {
  const arc = ARCS[options.goal] ?? ARCS.focus;
  const moods = options.moods ?? [];
  const effect = moodEffect(moods);
  const minutes = Math.max(3, Math.min(240, options.minutes ?? 25));
  const seed = options.seed ?? 1;
  const random = rng(seed);
  const method: Method = options.method ?? 'binaural';

  // A root retunes the arc without reshaping it: 220 Hz is what the stages are
  // written around, so the ratio is the scale.
  const rootScale = options.root && options.root > 20 ? options.root / 220 : 1;

  const stages: Stage[] = [...arc.stages];
  if (effect.alphaPrelude) {
    stages.unshift({
      label: 'prelude',
      why: 'a slower start when the body is already busy',
      beat: 10,
      carrier: 180,
      fixed: 3,
      noise: 0.12,
    });
  }
  if (effect.onsetBonus) {
    const first = stages.findIndex((s) => s.fixed !== undefined);
    if (first >= 0) stages[first] = { ...stages[first]!, fixed: (stages[first]!.fixed ?? 3) + effect.onsetBonus };
  }

  // Fixed stages take their minutes first; the rest share what's left by weight.
  const fixedTotal = stages.reduce((sum, s) => sum + (s.fixed ?? 0) * (s.label === 'release' ? effect.releaseScale : 1), 0);
  const weightTotal = stages.reduce((sum, s) => sum + (s.weight ?? 0), 0);
  const flexible = Math.max(0, minutes - fixedTotal);

  const segments: Segment[] = [];
  stages.forEach((stage, i) => {
    const fixedMinutes = (stage.fixed ?? 0) * (stage.label === 'release' ? effect.releaseScale : 1);
    const share = weightTotal > 0 ? ((stage.weight ?? 0) / weightTotal) * flexible : 0;
    let stageMinutes = fixedMinutes + share;
    if (stageMinutes < 0.4) return;
    // "Restless" splits long stages in two with a small drift between them, so
    // there is always something changing to notice.
    const pieces = effect.splitSegments && stageMinutes > 8 ? 2 : 1;
    stageMinutes /= pieces;
    for (let p = 0; p < pieces; p++) {
      const jitter = effect.splitSegments ? 0.3 + random() * 0.3 : 0;
      segments.push({
        dur: Math.round(stageMinutes * 60),
        label: pieces > 1 ? `${stage.label} ${p + 1}` : stage.label,
        why: p === 0 ? stage.why : `${stage.why} — second pass, slightly drifted`,
        layers: stageLayers(stage, {
          method,
          carrierScale: effect.carrierScale * rootScale * (p === 1 ? 1.02 : 1),
          beatShift: effect.beatShift,
          noiseBonus: effect.noiseBonus,
          jitter,
        }),
      });
    }
    void i;
  });

  const moodText = moods.length ? ` · ${moods.join(', ')}` : '';
  // Producers emit canonical, validated sessions: numbers quantised, ranges
  // enforced. Everything downstream can then assume a clean script.
  return cleanScript({
    v: 2,
    title: options.title ?? `${arc.name} ${Math.round(minutes)}`,
    note: `${arc.note}${moodText}`,
    seed,
    origin: 'dj',
    segments: segments.length ? segments : [{ dur: 300, label: 'hold', layers: stageLayers(arc.stages[0]!, { method, carrierScale: rootScale, beatShift: 0, noiseBonus: 0, jitter: 0 }) }],
  });
}

/** The named presets shown as one-tap cards. */
export const PRESETS: { id: string; goal: GoalId; minutes: number; name: string }[] = [
  { id: 'focus-25', goal: 'focus', minutes: 25, name: 'Focus 25' },
  { id: 'deep-45', goal: 'deep', minutes: 45, name: 'Deep Work 45' },
  { id: 'study-90', goal: 'study', minutes: 90, name: 'Study 90' },
  { id: 'read-30', goal: 'read', minutes: 30, name: 'Read 30' },
  { id: 'calm-15', goal: 'calm', minutes: 15, name: 'Calm 15' },
  { id: 'unwind-20', goal: 'unwind', minutes: 20, name: 'Unwind 20' },
  { id: 'meditate-20', goal: 'meditate', minutes: 20, name: 'Meditate 20' },
  { id: 'sleep-45', goal: 'sleep', minutes: 45, name: 'Sleep 45' },
  { id: 'spark-10', goal: 'spark', minutes: 10, name: 'Spark 10' },
];

export function preset(id: string, method?: Method): Script | null {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return null;
  const script = generate({ goal: p.goal, minutes: p.minutes, seed: 1, method, title: p.name });
  script.origin = 'preset';
  return script;
}

/** A single random-but-reproducible session, for the "surprise me" button. */
export function surprise(seed: number): Script {
  const random = rng(seed);
  const goal = pickFrom(random, GOALS).id;
  const moods = random() > 0.5 ? [pickFrom(random, MOODS).id] : [];
  const minutes = pickFrom(random, DURATIONS);
  const script = generate({ goal, moods, minutes, seed });
  script.title = `${ARCS[goal].name} ${minutes} · ${seed.toString(36)}`;
  return script;
}
