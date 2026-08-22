/**
 * Share links. A session is a URL — no accounts, no server, no database.
 *
 * Wire format: "<codec>.<base64url>" where codec 1 = deflate-raw JSON and
 * codec 0 = plain JSON. Keys are shortened and defaults stripped first, so a
 * typical session is a few hundred characters.
 */
import { cleanScript } from './ranges.js';
import { DEFAULT_LAYER, type Layer, type Script, type Segment } from './types.js';

const SCRIPT_KEYS = { v: 'v', title: 't', note: 'n', unsafe: 'x', seed: 's', origin: 'o', segments: 'g' } as const;
const SEG_KEYS = { dur: 'd', label: 'l', why: 'w', layers: 'y' } as const;
const LAYER_KEYS = {
  kind: 'k', method: 'm', carrier: 'c', beat: 'b', ratio: 'r', detune: 'e',
  wave: 'v', color: 'o', gain: 'g', pan: 'p', am: 'a', fm: 'f', filter: 'i', mods: 'z', mute: 'u',
} as const;
const WAVE_KEYS = { kind: 'k', harmonics: 'h' } as const;
const LFO_KEYS = { rate: 'r', depth: 'd', wave: 'w' } as const;
const FILTER_KEYS = { kind: 'k', freq: 'f', q: 'q' } as const;
const MOD_KEYS = { target: 't', expr: 'e', from: 'f', to: 'o', curve: 'c', jitter: 'j' } as const;

type Dict = Record<string, unknown>;

function shorten(src: Dict, map: Record<string, string>): Dict {
  const out: Dict = {};
  for (const [long, short] of Object.entries(map)) {
    if (src[long] !== undefined && src[long] !== null) out[short] = src[long];
  }
  return out;
}

function lengthen(src: Dict, map: Record<string, string>): Dict {
  const out: Dict = {};
  for (const [long, short] of Object.entries(map)) {
    if (src[short] !== undefined && src[short] !== null) out[long] = src[short];
  }
  return out;
}

/** Matches ranges.ts PRECISION, so encode/decode is lossless. */
function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function packLayer(l: Layer): Dict {
  const trimmed: Dict = {};
  const keys = Object.keys(LAYER_KEYS) as (keyof Layer)[];
  for (const key of keys) {
    const value = l[key];
    if (value === undefined || value === null) continue;
    if (key === 'wave') {
      if (l.wave.kind === 'sine') continue;
      const w = shorten({ kind: l.wave.kind, harmonics: l.wave.harmonics?.map((h) => round(h, 4)) }, WAVE_KEYS);
      trimmed.wave = w;
      continue;
    }
    if (key === 'am' || key === 'fm') {
      const lfo = l[key];
      if (!lfo) continue;
      trimmed[key] = shorten({ rate: round(lfo.rate, 4), depth: round(lfo.depth, 4), wave: lfo.wave }, LFO_KEYS);
      continue;
    }
    if (key === 'filter') {
      if (!l.filter) continue;
      trimmed.filter = shorten({ kind: l.filter.kind, freq: round(l.filter.freq, 4), q: round(l.filter.q, 4) }, FILTER_KEYS);
      continue;
    }
    if (key === 'mods') {
      if (!l.mods.length) continue;
      trimmed.mods = l.mods.map((m) =>
        shorten(
          {
            target: m.target,
            expr: m.expr,
            from: m.from === undefined ? undefined : round(m.from, 4),
            to: m.to === undefined ? undefined : round(m.to, 4),
            curve: m.curve,
            jitter: m.jitter === undefined ? undefined : round(m.jitter, 4),
          },
          MOD_KEYS,
        ),
      );
      continue;
    }
    if (typeof value === 'number') {
      const dflt = DEFAULT_LAYER[key];
      const rounded = round(value, 4);
      if (typeof dflt === 'number' && rounded === dflt) continue;
      trimmed[key] = rounded;
      continue;
    }
    if (value === DEFAULT_LAYER[key]) continue;
    trimmed[key] = value;
  }
  return shorten(trimmed, LAYER_KEYS);
}

function unpackLayer(d: Dict): Dict {
  const long = lengthen(d, LAYER_KEYS);
  if (long.wave) long.wave = lengthen(long.wave as Dict, WAVE_KEYS);
  if (long.am) long.am = lengthen(long.am as Dict, LFO_KEYS);
  if (long.fm) long.fm = lengthen(long.fm as Dict, LFO_KEYS);
  if (long.filter) long.filter = lengthen(long.filter as Dict, FILTER_KEYS);
  if (Array.isArray(long.mods)) long.mods = (long.mods as Dict[]).map((m) => lengthen(m, MOD_KEYS));
  return long;
}

function packSegment(s: Segment): Dict {
  return shorten(
    { dur: Math.round(s.dur), label: s.label, why: s.why, layers: s.layers.map(packLayer) },
    SEG_KEYS,
  );
}

export function packScript(script: Script): Dict {
  return shorten(
    {
      v: script.v,
      title: script.title,
      note: script.note,
      unsafe: script.unsafe ? 1 : undefined,
      seed: script.seed,
      origin: script.origin,
      segments: script.segments.map(packSegment),
    },
    SCRIPT_KEYS,
  );
}

export function unpackScript(d: Dict): Dict {
  const long = lengthen(d, SCRIPT_KEYS);
  if (long.unsafe !== undefined) long.unsafe = Boolean(long.unsafe);
  if (Array.isArray(long.segments)) {
    long.segments = (long.segments as Dict[]).map((s) => {
      const seg = lengthen(s, SEG_KEYS);
      if (Array.isArray(seg.layers)) seg.layers = (seg.layers as Dict[]).map(unpackLayer);
      return seg;
    });
  }
  return long;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === 'function') {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Encode a session into a URL payload. Falls back to uncompressed JSON. */
export async function encodeScript(script: Script): Promise<string> {
  const json = JSON.stringify(packScript(script));
  const raw = new TextEncoder().encode(json);
  const packed = await deflate(raw);
  if (packed && packed.byteLength < raw.byteLength) return `1.${toBase64Url(packed)}`;
  return `0.${toBase64Url(raw)}`;
}

/** Decode a payload. Returns null only when the payload is not ours at all. */
export async function decodeScript(payload: string): Promise<Script | null> {
  const dot = payload.indexOf('.');
  if (dot < 1) return null;
  const codec = payload.slice(0, dot);
  const body = payload.slice(dot + 1);
  let bytes: Uint8Array | null;
  try {
    bytes = fromBase64Url(body);
  } catch {
    return null;
  }
  if (codec === '1') {
    bytes = await inflate(bytes);
    if (!bytes) return null;
  } else if (codec !== '0') {
    return null;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Dict;
    return cleanScript(unpackScript(parsed));
  } catch {
    return null;
  }
}

export const MAX_PAYLOAD = 6000;

export async function shareUrl(script: Script, base = location.href): Promise<string> {
  const payload = await encodeScript(script);
  const url = new URL(base);
  url.hash = `#/play?m=${payload}`;
  return url.toString();
}
