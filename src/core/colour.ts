/**
 * Colour as a frequency.
 *
 * A colour already *is* a frequency: light is a wave, and a visible one runs
 * around 4–7 ×10^14 Hz. Halve that enough times and it lands in the same
 * carrier octave the Codex folds a planet's year into — the arithmetic is
 * identical, and the exponent is printed so you can check it.
 *
 * What this is not: a claim that a colour does something to you. The colour
 * chooses the *carrier*, because that conversion is real. The beat still comes
 * from the goal, because that is where the evidence lives.
 */
import { CARRIER_HI, CARRIER_LO, fold, type Folded } from './octave.js';

/** metres per second, exact by definition since 1983 */
export const C_LIGHT = 299_792_458;

/**
 * The spectrum, as the eye divides it. Hue in degrees runs red → violet over
 * the first 270°; past that lies magenta, which no single wavelength produces —
 * the reading says so rather than inventing one.
 */
const RED_NM = 700;
const VIOLET_NM = 400;
const SPECTRAL_ARC = 270;

export interface ColourReading {
  /** 0..360 */
  hue: number;
  /** nanometres */
  wavelength: number;
  /** the light frequency itself, Hz */
  light: number;
  /** the audible carrier, folded down by octaves */
  folded: Folded;
  /** what to call it */
  name: string;
  /** true when the hue is a mix rather than a single wavelength */
  extraSpectral: boolean;
  /** the derivation, line by line */
  lines: string[];
}

const NAMES: { upTo: number; name: string }[] = [
  { upTo: 14, name: 'red' },
  { upTo: 40, name: 'orange' },
  { upTo: 70, name: 'yellow' },
  { upTo: 160, name: 'green' },
  { upTo: 200, name: 'cyan' },
  { upTo: 250, name: 'blue' },
  { upTo: 290, name: 'violet' },
  { upTo: 345, name: 'magenta' },
  { upTo: 361, name: 'red' },
];

export function colourName(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  return NAMES.find((n) => h < n.upTo)?.name ?? 'red';
}

/** Hue in degrees → the dominant wavelength that produces it, in nanometres. */
export function hueWavelength(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  const t = Math.min(1, h / SPECTRAL_ARC);
  return RED_NM - t * (RED_NM - VIOLET_NM);
}

/** Read a hue as a carrier frequency, showing every step. */
export function readColour(hue: number): ColourReading {
  const h = ((hue % 360) + 360) % 360;
  const wavelength = hueWavelength(h);
  const light = C_LIGHT / (wavelength * 1e-9);
  const folded = fold(light, CARRIER_LO, CARRIER_HI);
  const name = colourName(h);
  const extraSpectral = h > SPECTRAL_ARC;

  return {
    hue: h,
    wavelength,
    light,
    folded,
    name,
    extraSpectral,
    lines: [
      `${name} → ${wavelength.toFixed(0)} nm`,
      `c / λ → ${(light / 1e12).toFixed(1)} THz`,
      `÷2^${-folded.k} → ${folded.hz.toFixed(2)} Hz`,
      extraSpectral
        ? 'magenta is a mix, not a wavelength — read as the violet end'
        : 'the whole visible spectrum folds into a third of an octave',
    ],
  };
}

/**
 * The gradient this app is drawn in, as hues: purple → blue → green. Four
 * rather than five, chosen so that each one has a name of its own — two chips
 * both reading "blue" is a worse interface than one fewer choice.
 */
export const PALETTE_HUES = [262, 226, 192, 158] as const;

/** A colour as one line: what it is, its wavelength, its carrier. */
export function colourLine(r: ColourReading): string {
  return `${r.name} · ${r.wavelength.toFixed(0)} nm · ${r.folded.hz.toFixed(2)} Hz`;
}
