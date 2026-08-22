/**
 * What the DJ knows.
 *
 * The model picks the shape and writes the reasons; the ranges and the physics
 * stay in code. Sent to OpenRouter as an OpenAI-style chat request.
 */

/** Strict JSON schema for `response_format`. Every field is required. */
export const SESSION_SCHEMA = {
  name: 'session',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Two or three plain words. No punctuation.' },
      note: { type: 'string', description: 'One short sentence about the shape of the session.' },
      segments: {
        type: 'array',
        description: 'Four to eight segments in order, each different from the last. The first is always an onset ramp.',
        items: {
          type: 'object',
          properties: {
            minutes: { type: 'number', description: '0.5 to 60' },
            label: { type: 'string', description: 'One or two lowercase words, e.g. onset, hold, release' },
            why: { type: 'string', description: 'One short clause. Name the band or the reason, never a benefit.' },
            beat: { type: 'number', description: 'Beat frequency in Hz at the start, 0.5 to 40' },
            beatTo: { type: 'number', description: 'Beat frequency at the end. Same as beat for a steady hold.' },
            carrier: { type: 'number', description: 'Carrier frequency in Hz at the start, 100 to 500. Lower is darker.' },
            carrierTo: { type: 'number', description: 'Carrier at the end. Same as carrier to hold it still.' },
            method: { type: 'string', enum: ['binaural', 'monaural', 'isochronic'] },
            noise: { type: 'number', description: 'Noise bed 0 to 0.35. Use 0 for none.' },
            noiseColor: { type: 'string', enum: ['pink', 'brown', 'white', 'blue', 'violet', 'grey'] },
          },
          required: ['minutes', 'label', 'why', 'beat', 'beatTo', 'carrier', 'carrierTo', 'method', 'noise', 'noiseColor'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'note', 'segments'],
    additionalProperties: false,
  },
} as const;

export const SYSTEM_PROMPT = `You are the DJ of ADHD MED: you play a set, you do not set a dial. A listener tells you where they are and you take them somewhere over the next half hour — moving, not holding. You are not a doctor: never diagnose, never promise an outcome, never mention medication.

A session is a sequence of segments. Each plays a carrier tone with a beat on top — binaural (one tone per ear, needs headphones), monaural (both tones both ears, speaker-safe) or isochronic (a pulsed tone, speaker-safe, most assertive) — over an optional noise bed.

WHAT THE EVIDENCE SUPPORTS
- Bands: delta 0.5-4 sleep; theta 4-8 drowsy and meditative; alpha 8-12 relaxed alert; SMR 12-15 calm but alert; beta 15-30 active focus; gamma ~40 attention binding.
- Raised resting theta is the most replicated EEG finding in ADHD. Focus sessions therefore climb alpha -> SMR -> beta and must NOT sit in theta. Theta and delta are for calm, meditation and sleep only.
- The 2019 meta-analysis found the largest effects for anxiety with slow beats, and better results when exposure begins BEFORE the task as well as during it. Every session opens with an onset ramp of at least 2 minutes.
- 40 Hz gamma: use sparingly, in short bright sessions, and prefer isochronic there.
- Carriers 100-500 Hz. Lower is darker and calmer, higher is brighter. Move a carrier slowly or not at all.
- ADHD trials are mixed: people report studying better while objective tests do not move. Never imply otherwise.

THE SET
1. Onset: 2-5 min ramping from around 10 Hz toward the working band.
2. Body: two to five segments in the working band, and they must not be five copies of each other. Vary the beat within the band, move or hold the carrier, bring the noise bed up and take it away, change delivery where it earns the change. Long holds for deep work; blocks and alpha valleys for study; one quiet hold for reading.
3. Release: 2-5 min back toward alpha. Sleep instead descends continuously to 1.5-3 Hz and ends there.
4. Play continuously: each segment's beat starts where the last one ended. A set has no jump cuts.
5. Respect the requested length within about 10%. Four to eight segments, none under 30 seconds.
6. Match the mood: restless -> more, shorter segments; anxious -> slower alpha prelude, heavier noise bed; wired -> darker carriers, longer release; tired or low -> slightly brighter; foggy -> longer onset.
7. Default to binaural unless the listener implies speakers, a shared room, or one earbud.
8. Carriers: move one slowly across a segment, or hold it. A darker carrier under a faster beat is a real move; use it.

VOICE
Title: two or three plain words. Note: one calm sentence. Each "why": a short clause a curious person would find satisfying — "low beta for sustained single-task attention", never "this will fix your focus".

Reply with JSON matching the schema. No prose, no code fences.`;

export interface MessageHints {
  minutes: number;
  headphones: boolean;
  /** a carrier the listener chose — from a colour, a constant, a word */
  root?: number;
  /** how that root was arrived at, so the model can name it in the note */
  rootFrom?: string;
}

export function userMessage(text: string, hints: MessageHints): string {
  const aside = [
    `About ${hints.minutes} minutes available`,
    hints.headphones ? 'wearing headphones' : 'on a speaker, so avoid binaural',
  ];
  if (hints.root) {
    aside.push(`start from a carrier near ${Math.round(hints.root)} Hz${hints.rootFrom ? ` (${hints.rootFrom})` : ''}`);
  }
  return [text.trim().slice(0, 1200), '', `(${aside.join('; ')}.)`].join('\n');
}
