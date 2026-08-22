# The research behind ADHD MED

Written before the code, and the reason the app is shaped the way it is. Every
claim here is either sourced in the in-app Library or marked as unproven.

---

## 1. Brainwave fundamentals

EEG activity is conventionally split into bands. The boundaries are conventions,
not natural joints, and different labs draw them slightly differently.

| Band | Hz | Associated state | Role in this app |
|---|---|---|---|
| Delta | 0.5–4 | Deep sleep, restoration | sleep sessions |
| Theta | 4–8 | Drowsiness, light meditation, inward attention | meditation, calm, sleep — **never focus** |
| Alpha | 8–12 | Relaxed alertness; rises when you close your eyes | on-ramps and landings |
| SMR | 12–15 | Sensorimotor rhythm: still body, alert mind | the core focus band |
| Beta | 15–30 | Active thinking, judgement, single-task effort | focus and deep-work holds |
| Gamma | 30–100 | Attention binding, peak processing | short 40 Hz sessions |

**Why focus arcs avoid theta.** The most studied EEG marker in ADHD is an
elevated **theta/beta ratio**: excess theta read as cortical hypo-arousal,
reduced beta as low activation. Its value as a *diagnostic* is contested — the
distributions overlap heavily between groups — but it is the foundation of the
neurofeedback protocols that do have an evidence base (theta down, SMR up).
Whatever else is true, deliberately driving a listener toward theta while they
are trying to concentrate is the wrong direction. So: focus arcs here climb
alpha → SMR → beta, and theta appears only in calm, meditation and sleep, where
the effect sizes happen to be largest anyway.

## 2. How the beats work

**Binaural.** Play a carrier `f` in one ear and `f + Δ` in the other. Neither ear
receives an amplitude modulation, yet you perceive a beat at `Δ` Hz: the
binaural interaction happens centrally, first in the superior olivary complex.
It works for `Δ` up to roughly 30–40 Hz and for carriers below about 1000 Hz —
best between 100 and 500. **It requires stereo headphones**, because the effect
*is* the difference between the ears; a speaker sums them and it disappears.

**Monaural.** Sum the two tones before they reach the ear and the beat is a real
amplitude modulation in the air. Steady-state EEG responses to monaural beats are
measurably stronger than to binaural ones — the physical modulation wins on
amplitude. Works on any speaker.

**Isochronic.** Gate a single tone on and off at the target rate. The most
perceptually assertive of the three; also the shape used in the 40 Hz sensory
stimulation trials, which used pulses rather than binaural illusions. In this app
the gate is a raised cosine (a sine LFO on a gain node), so it is click-free by
construction rather than by tuning.

**Frequency-following response.** The claimed mechanism for all three: rhythmic
sensory input pulls cortical activity toward the stimulus frequency. The
phenomenon is real for visual flicker and for amplitude-modulated sound. How
strongly it applies to a binaural beat, at what amplitudes, and whether the
resulting shift changes anything you care about, is exactly where the literature
gets thin.

## 3. CIA / Hemi-Sync — the "Gateway Process" document

In 1983 US Army Lt. Col. Wayne M. McDonnell wrote *Analysis and Assessment of
Gateway Process*, an assessment of the Monroe Institute's **Hemi-Sync**
technique. The CIA declassified it in 2003; it went viral much later, partly for
its long-missing page 25.

What the document actually contains: a competent explanation of the
frequency-following response and of **hemispheric synchronisation** (the two
hemispheres converging in frequency and amplitude), wrapped in a great deal of
holographic-universe cosmology. It is a primary source about what people believed
and tried, not evidence that it worked.

What it gives this app, technically:

- carriers in the **100–400 Hz** range with a beat offset (e.g. 100 Hz left,
  104 Hz right → a 4 Hz beat);
- **pink noise beds** over the carrier, to mask it and reduce listening fatigue;
- **progressive ramps** through named "Focus levels" — Focus 10 ("mind awake,
  body asleep"), 12, 15, 21.

The consequence for the design is the important one: **sessions are arcs, not
static tones.** The Focus ladder ships in the Codex as `protocol`, not `measured`.

## 4. What the evidence supports

**García-Argibay, Santed & Reales (2019)**, *Psychological Research* — the
anchor. Meta-analysis of 22 studies, 35 effect sizes:

- overall effect **g ≈ 0.45** (medium, consistent) across cognition, anxiety and
  pain;
- **theta/delta beats and anxiety: g ≈ 0.69** — the strongest single finding;
- masking the beat with noise is **not** required for it to work;
- exposure **before and during** a task outperformed exposure during it alone.

That last point is a design instruction, and it is why every arc in this app
opens with an onset ramp of at least two minutes.

**Ingendoh et al. (2022)** is the more cautious sibling: some promise for memory
and attention, and a clear-eyed account of how uneven the study designs are.

**40 Hz gamma.** Colzato et al. (2017) found 40 Hz binaural beats narrowed the
attentional spotlight in a global–local task. Separately, MIT's GENUS programme
(Iaccarino et al. 2016, *Nature*; Martorell et al. 2019, *Cell*) showed 40 Hz
light and sound stimulation reduces amyloid and tau pathology in Alzheimer's
mouse models, with human trials since reporting safety and slowed myelin loss.
That work is about dementia, not attention — but it is the strongest evidence
that sound at a frequency changes a brain at all.

**ADHD specifically — the honest part.** A pediatric pilot (Kennel et al. 2010)
found no significant change on inattention scales, while parents and teenagers
reported homework going better. An adult add-on RCT (2022) found improved
*subjective* study performance with unchanged rating scales and attention tests.
Read together: plausibly pleasant to work to, unproven as an attention
treatment. The app's ceiling is set there deliberately.

**Noise deserves its own line.** Söderlund, Sikström & Smart (2007) found
moderate background noise *improved* cognitive performance in inattentive
children while slightly impairing controls — a stochastic-resonance account tied
to dopamine-dependent arousal. Follow-ups sharpened it: what helps one attention
profile can hinder another. That is why the noise bed here is a first-class
control with six spectra, not decoration.

**And the counter-evidence.** López-Caballero & Escera (2017) looked carefully
for entrainment in the EEG and did not find it. Pietschnig et al.'s
Mozart-effect meta-analysis is the cautionary tale about how a small, fragile
finding becomes a product category. Both are in the Library on purpose.

## 5. Turning numbers into sound

Doubling a frequency gives the same pitch class, so any positive number can be
moved into hearing range by multiplying by a power of two: `f × 2ᵏ`. That is
arithmetic, not interpretation — which makes it an honest way to let people hear
a constant, as long as the exponent is shown.

This app folds into a single **carrier octave, 128–256 Hz**. That window sits
comfortably inside the 100–500 Hz range where binaural carriers work best, and it
happens to be the octave Hans Cousto's "cosmic octave" tuning forks are cut to —
so the app's arithmetic can be checked against someone else's published numbers.
Fold the Earth's rotation into it and you get his 194.18 Hz exactly; the tropical
year gives 136.10 Hz; the synodic month 210.42 Hz. The unit tests assert those
values, computed from the raw periods rather than hardcoded.

The same rule gives the beat: the same number, folded into 0.5–40 Hz.

Where honesty gets load-bearing is the **tier**:

- **measured** — Schumann resonance 7.83 Hz (a genuinely measured
  Earth–ionosphere cavity mode), the caesium hyperfine transition that *defines*
  the second, the 21 cm hydrogen line, the CMB spectral peak, the EEG band
  anchors, ISO concert pitch.
- **protocol** — the onset dose, the SMR up-train, the anxiolytic descent, the
  Hemi-Sync Focus levels, GENUS 40 Hz, coherent breathing at 0.1 Hz.
- **lore** — the planetary tones, all nine solfeggio frequencies (assembled in
  the 1970s from a numerological reading of a Latin hymn — not medieval), 432 Hz,
  π and e as frequencies, and the speed of light, which is filed here rather than
  under *measured* because reading metres per second as hertz is a unit error, not
  physics.

Keeping the lore and labelling it is the whole editorial stance. The arithmetic is
always real; the meaning is sometimes poetry.

## 6. Safety notes that shaped the code

- **Photosensitivity.** Flicker in the 15–25 Hz range is the most provocative for
  photosensitive epilepsy; guidance treats below ~3 Hz as low risk. A canvas
  driven by 0.5–40 Hz parameters is one careless line away from a strobe, so a
  single utility caps every visual rate at 2 Hz and fast beats are shown as
  rotation at `beat / 2ᵏ`, with the divisor stated.
- **Listening dose.** WHO/ITU H.870 frames safe listening as level *and*
  duration together. Sessions here run up to 90 minutes, so the volume starts at
  25% and a limiter plus a hard gain cap sit after the user's control, in every
  mode, including the experimental one.

## 7. What would change my mind

The app would deserve stronger claims if someone ran a preregistered,
adequately powered, active-controlled trial in adults with ADHD, measuring
sustained-attention performance rather than self-report, with the exposure
starting before the task as the meta-analysis recommends. Until then the honest
description is the one on the tin: sine waves, a small difference between your
ears, and arithmetic you can hear.
