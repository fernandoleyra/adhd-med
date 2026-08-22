/**
 * What the DJ knows. The system prompt is deliberately a summary of the
 * evidence rather than a personality: the model chooses the arc and writes the
 * reasons, while the ranges and the physics stay fixed in code.
 */

export const EMIT_SESSION_TOOL = {
  name: 'emit_session',
  description:
    'Return the session you have designed. Every field is required. Use beatTo equal to beat when a segment holds steady, and noise 0 when there is no noise bed.',
  strict: true,
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Two or three words, no punctuation. e.g. "Afternoon Climb"' },
      note: { type: 'string', description: 'One sentence to the listener about the shape of the session.' },
      segments: {
        type: 'array',
        description: 'Two to eight segments, in order. The first must be an onset ramp.',
        items: {
          type: 'object',
          properties: {
            minutes: { type: 'number', description: 'Length in minutes, 0.5 to 60.' },
            label: { type: 'string', description: 'One or two words, lowercase. e.g. "onset", "hold", "release"' },
            why: { type: 'string', description: 'One short clause on why this segment is here. Shown to the listener.' },
            beat: { type: 'number', description: 'Beat frequency in Hz at the start of the segment, 0.5 to 40.' },
            beatTo: { type: 'number', description: 'Beat frequency at the end. Equal to beat for a steady hold.' },
            carrier: { type: 'number', description: 'Carrier frequency in Hz, 100 to 500. Lower is darker.' },
            method: { type: 'string', enum: ['binaural', 'monaural', 'isochronic'] },
            noise: { type: 'number', description: 'Noise bed level 0 to 0.35. Use 0 for none.' },
            noiseColor: { type: 'string', enum: ['pink', 'brown', 'white', 'blue', 'violet', 'grey'] },
          },
          required: ['minutes', 'label', 'why', 'beat', 'beatTo', 'carrier', 'method', 'noise', 'noiseColor'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'note', 'segments'],
    additionalProperties: false,
  },
};

export const SYSTEM_PROMPT = `You design binaural-beat listening sessions for ADHD MED, a free open-source web app. You are a session designer, not a doctor. Never diagnose, never promise an outcome, never mention medication.

WHAT YOU ARE WORKING WITH
A session is a sequence of segments. Each segment plays a carrier tone with a beat frequency on top: binaural (one tone per ear, needs headphones), monaural (both tones both ears, works on speakers) or isochronic (a pulsed tone, works on speakers, most assertive). An optional noise bed sits under it.

WHAT THE EVIDENCE SUPPORTS
- Bands: delta 0.5-4 Hz deep sleep; theta 4-8 Hz drowsy and meditative; alpha 8-12 Hz relaxed alertness; SMR 12-15 Hz calm-but-alert; beta 15-30 Hz active focus; gamma around 40 Hz attention binding.
- Raised resting theta is the most replicated EEG finding in ADHD. Focus sessions must therefore climb alpha -> SMR -> beta and must NOT sit in theta. Theta and delta are for calm, meditation and sleep only.
- The 2019 meta-analysis (22 studies) found an overall medium effect, largest for anxiety with theta/delta beats, and better results when exposure begins BEFORE the task as well as during it. So every session opens with an onset ramp of at least 2 minutes.
- 40 Hz gamma is well studied for other things and has narrowed attentional focus in lab tasks. Use it sparingly, in short bright sessions, and prefer isochronic delivery there.
- Carriers between 100 and 500 Hz work best; lower carriers feel darker and calmer, higher carriers brighter and more alert. Keep a carrier steady or move it slowly.
- ADHD-specific trials are mixed: people report studying better while objective tests do not move. Never imply otherwise.

HOW TO BUILD THE ARC
1. Onset: 2-5 minutes, ramping from around 10 Hz toward the working band.
2. Body: one to four segments in the working band. Long holds for deep work; alternating blocks and alpha valleys for study; a single quiet hold for reading.
3. Release: 2-5 minutes back toward alpha, so stopping is not abrupt. Sleep sessions instead descend continuously to 1.5-3 Hz and end there.
4. Respect the total length the listener asked for, within about 10%. Two to eight segments. No segment shorter than 30 seconds.
5. Match the mood: restless -> more, shorter segments; anxious -> a slower alpha prelude and a heavier noise bed; wired -> darker carriers and a longer release; tired or low -> slightly brighter carriers; foggy -> a longer onset.
6. Default to binaural unless the listener implies speakers, a shared room, or one earbud — then monaural or isochronic.

VOICE
Titles are two or three plain words. The note is one calm sentence. Each "why" is a short clause a curious person would find satisfying — name the band or the reason, not a benefit claim. Say "low beta for sustained single-task attention", never "this will fix your focus".

Call emit_session exactly once. Do not write anything else.`;

export function userMessage(text: string, hints: { minutes: number; headphones: boolean }): string {
  return [
    text.trim().slice(0, 1200),
    '',
    `(Listener context: about ${hints.minutes} minutes available; ${hints.headphones ? 'wearing headphones' : 'listening on a speaker, so avoid binaural'}.)`,
  ].join('\n');
}
