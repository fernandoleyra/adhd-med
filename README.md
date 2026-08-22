# ADHD MED

**An ADHD digital med. Not medicine — arithmetic you can hear.**

A generative frequency instrument for focus: build your own binaural beats, hear
physical constants and ordinary words as tones, and take the whole thing on a
plane. One static page, no accounts, no backend, no analytics. Everything is
synthesised in your browser from numbers you can inspect.

> ADHD MED is not a medical device and not a treatment for ADHD or anything
> else. The evidence for brainwave entrainment is mixed: calming effects are
> plausible, measurable attention gains are unproven. If you're struggling, talk
> to a professional — real treatment works. Keep the volume moderate, and never
> use this while driving.

---

## Four modes

| | | |
|---|---|---|
| **DJ** | Say how you feel and what you need, get a session with its reasons attached. Works with an OpenRouter key, works just as well without one — the scripted generator uses the same arc grammar and needs no network. | `#/dj` |
| **Lab** | The whole synthesiser: layers, waveforms drawn as harmonic bars, AM/FM modulators, filters, ratio stacks, equations over time, seeded randomness, and an experimental envelope for sounds nobody has tested. | `#/lab` |
| **Codex** | ~40 numbers from physics, astronomy, protocol and folklore, each with the exact arithmetic that makes it audible and a label saying how much weight it can bear. | `#/codex` |
| **Logos** | Words into frequencies. Letters become numbers, numbers become pitch, and the derivation stays on screen. | `#/logos` |

Plus **airplane mode** (✈ in the header), which opens the real Cache Storage and
tells you file by file whether this will work with the radio off.

## Three delivery methods

- **Binaural** — carrier − beat/2 in the left ear, carrier + beat/2 in the right.
  The beat exists in your hearing, not in the air. Needs headphones.
- **Monaural** — both tones in both ears, beating acoustically. Works on speakers.
- **Isochronic** — one tone gated at the beat rate, click-free by construction
  (a raised-cosine gate, not a switch). Works on speakers, most assertive.

## The evidence, honestly

Sessions here are shaped by what the literature actually supports, and the app
says so where it matters:

- A 2019 meta-analysis (22 studies) found a medium overall effect (g ≈ 0.45),
  largest for anxiety with theta/delta beats (g ≈ 0.69), and better results when
  exposure begins **before** the task as well as during it — so every arc opens
  with an onset ramp.
- Raised resting theta is the most replicated EEG finding in ADHD, so **focus
  arcs climb alpha → SMR → beta and stay out of theta**. Theta and delta are for
  calm, meditation and sleep.
- ADHD-specific trials are the weak spot: people reported studying better while
  rating scales and attention tests did not move.
- Moderate background noise has its own decent evidence for inattentive
  listeners, which is why the noise bed is a first-class control and not decoration.

`RESEARCH.md` is the long version. The in-app **Library** (footer) has ~60
papers, books and documents — the ones this is built on, and the ones worth your
evening.

Every number in the Codex carries a tier, drawn as a stroke style:

- **measured** (solid) — someone measured it, or it is a definition. Schumann
  resonance, the caesium second, the hydrogen line, EEG band anchors.
- **protocol** (dashed) — a procedure with a rationale. Onset dose, SMR
  up-train, the Hemi-Sync Focus ladder, GENUS 40 Hz.
- **lore** (dotted) — beautiful, old, unproven. Planetary tones, solfeggio,
  432 Hz, π as a frequency. Kept because it's lovely, labelled because pretending
  it's science would be worse.

## Safety, built in rather than promised

- A **limiter and a hard gain cap** sit after your volume control in every mode,
  including the experimental one. Volume starts at 25%.
- **Nothing in the visuals modulates brightness faster than 2 Hz.** Fast beats
  are shown as rotation at `beat / 2ᵏ`, with the divisor printed. A canvas driven
  by 0.5–40 Hz parameters is otherwise one bug away from a strobe.
- `prefers-reduced-motion` freezes the geometry.
- Every number entering the audio engine passes through a validator that clamps
  it — including numbers from a shared link or from the model.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173/adhd-med/
npm test           # unit tests (vitest)
npm run e2e        # end-to-end tests (Playwright, builds first)
npm run check      # typecheck + unit + build + bundle budget
```

Bundle budget, enforced in CI: **≤100 kB gzipped**. Current build is ~59 kB for
the whole app, including the AI adapter — no runtime dependencies, system fonts
only.

### Deploy

Push to `main` and GitHub Actions builds and publishes to Pages
(Settings → Pages → Source: **GitHub Actions**). For a different path:

```bash
BASE_PATH=/ npm run build       # root domain
BASE_PATH=/my-fork/ npm run build
```

## The AI DJ is optional

The field works without a key: your text is read by keyword and handed to the
scripted generator. To turn the model on, Settings → **AI DJ**:

- paste your own [OpenRouter](https://openrouter.ai/keys) key. It stays in this
  browser and requests go straight to OpenRouter — there is no server in the
  middle. The default model is `openrouter/free`, so this can cost nothing; the
  field takes any of OpenRouter's model ids if you'd rather pay for a better one.
- or deploy `extras/proxy-worker/` (about forty lines of Cloudflare Worker) with
  your own key and put its URL in the proxy field, so visitors need no key at all.

Either way the model only chooses the *shape*. Its answer comes back as strict
JSON, is validated and clamped by the same code as everything else, and the
physics is not up for negotiation.

## The look

One gradient — purple to blue to green — is the entire palette, and it carries
meaning rather than decoration: the geometry is stroked with it, and the three
evidence tiers take one stop each (measured green, protocol blue, lore purple),
reinforced by solid, dashed and dotted strokes so colour is never the only
channel. Everything else is ink on paper with hairline rules. Text is kept to
what a number cannot say; detail lives one tap in, not on the screen you are
trying to scan.

## How it's built

```
src/core/       the pure parts: types, validation, octave maths, expression
                engine, word mapping, share codec, session generator
src/audio/      engine (transport, master chain, scheduling), voice graphs,
                noise buffers, background/lock-screen handling
src/viz/        the geometry: Lissajous veil, sigils, timelines, heatmaps
src/modes/      dj · lab · codex · logos · about
src/ui/         tiny component kit, player, leaflet, library, settings
src/data/       codex.json, references.json — edit these, no code needed
src/pwa/        hand-written service worker and the airplane-mode check
```

Vanilla TypeScript, no framework, no dependencies, hash routing, one
full-screen canvas.
Everything compiles to one **SessionScript**: a timeline of segments, each with
layers, each layer a tone or noise source with its own waveform, modulators,
filter and automation. Producers emit validated scripts; the engine validates
again before it touches the audio thread.

Session scheduling goes onto the AudioParam timeline in half-hour windows rather
than being driven by a JS clock — background tabs throttle timers, and the audio
thread doesn't. Output goes through a MediaStream into a real `<audio>` element,
so the OS treats it as media playback and gives you lock-screen controls.

**Known caveat:** on iOS, audio from an *installed* PWA can stop when the screen
locks (an iOS 26 regression). The app detects that case and suggests opening it
in Safari instead, where the same page behaves. Verify on a real device — no
desktop test covers it.

## Contributing

The interesting files are data. `src/data/codex.json` takes a raw number and a
fold rule; the app computes the audible frequency and shows its own arithmetic.
`src/data/references.json` is the library. Adding an entry needs no code.

If you change the audio engine, run `npm run e2e` — those tests render sessions
through a real `OfflineAudioContext` and measure the samples, so they catch a
binaural layer that isn't actually splitting the ears.

Two rules that are not up for debate: the output limiter stays, and nothing in
the visuals flickers faster than 2 Hz.

MIT. Fork it, change the numbers, disagree with the arcs.
