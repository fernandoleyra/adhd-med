/**
 * The AI DJ, over OpenRouter.
 *
 * Optional by design: the scripted generator uses the same grammar, so nothing
 * here is load-bearing. One plain fetch to an OpenAI-compatible endpoint — no
 * SDK, so nothing is added to the bundle for the people who never use it.
 *
 * Three routes, in this order of preference: a proxy you configured, a key you
 * pasted (which stays in this browser and goes straight to OpenRouter), or the
 * deployment's own /api/dj — which is what makes the DJ answer for a visitor
 * who has set nothing at all.
 */
import { cleanScript } from '../core/ranges.js';
import { layer, type Layer, type Script } from '../core/types.js';
import { hashString } from '../core/rng.js';
import { SESSION_SCHEMA, SYSTEM_PROMPT, userMessage } from './prompt.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 45_000;

/**
 * The deployment's own route, relative to wherever the app is mounted: one
 * build works both on a host that has the function and on a static host that
 * does not.
 */
const HOSTED = `${import.meta.env.BASE_URL}api/dj`;

/** A host without the function says so with one of these. */
const NO_HOSTED = new Set([404, 405, 501]);

/**
 * Optimistic until proven otherwise: the route is assumed to be there, so the
 * DJ answers out of the box, and the first request that comes back 404 turns it
 * off for the rest of the session rather than paying that round trip again.
 */
let hostedUsable = true;

/**
 * What the hosted route actually answered with. A deployment can pin its own
 * model, so the browser's setting is a request, not a fact — the only honest
 * label is the id that comes back in the reply.
 */
let hostedModel = '';

export interface AiRequest {
  text: string;
  minutes: number;
  headphones: boolean;
  apiKey: string;
  model: string;
  proxyUrl?: string;
  /** a carrier the listener chose, and how they arrived at it */
  root?: number;
  rootFrom?: string;
}

interface AiSegment {
  minutes: number;
  label: string;
  why: string;
  beat: number;
  beatTo: number;
  carrier: number;
  carrierTo?: number;
  method: 'binaural' | 'monaural' | 'isochronic';
  noise: number;
  noiseColor: 'pink' | 'brown' | 'white' | 'blue' | 'violet' | 'grey';
}

interface AiSession {
  title: string;
  note: string;
  segments: AiSegment[];
}

export type AiErrorKind = 'auth' | 'network' | 'shape' | 'rate' | 'credit' | 'model';

export class AiError extends Error {
  constructor(message: string, readonly kind: AiErrorKind) {
    super(message);
    this.name = 'AiError';
  }
}

/**
 * Map the model's answer onto real layers.
 *
 * The model chooses the arc; the movement is ours. It answers with numbers at
 * the ends of each segment, and this turns that into something that plays like
 * a set rather than a list of holds: the beat is stitched so one segment starts
 * where the last ended, carriers glide, the bed breathes in and out, and a long
 * body segment gets a slow tremolo and a quiet fifth above it so there is
 * always something moving to notice. Every number still goes through the
 * validator afterwards.
 */
export function aiSessionToScript(session: AiSession, seedText: string): Script {
  const list = session.segments.slice(0, 12);
  const last = list.length - 1;
  let carry: number | null = null;

  const segments = list.map((s, i) => {
    const dur = Math.round(Math.max(20, Math.min(3600, s.minutes * 60)));
    // No jump cuts: a segment opens on the beat the previous one closed with,
    // whatever the model said, and still lands where the model aimed.
    const from = carry ?? s.beat;
    const to = Number.isFinite(s.beatTo) ? s.beatTo : s.beat;
    carry = to;

    const main: Layer = layer({ method: s.method, carrier: s.carrier, beat: from, gain: 0.55 });
    if (Math.abs(to - from) > 0.05) {
      main.mods.push({ target: 'beat', from, to, curve: 'sine' });
    }
    const carrierTo = Number.isFinite(s.carrierTo) ? (s.carrierTo as number) : s.carrier;
    if (Math.abs(carrierTo - s.carrier) > 0.5) {
      main.mods.push({ target: 'carrier', from: s.carrier, to: carrierTo, curve: 'sine' });
    }
    // A slow amplitude sway, an eighth of the beat, on segments long enough for
    // it to read as movement rather than a wobble. Well under the beat itself,
    // so it never competes with what the session is for.
    const body = i > 0 && i < last;
    if (body && dur >= 240) {
      main.am = { rate: Math.max(0.02, Math.min(0.5, to / 8)), depth: 0.1, wave: 'sine' };
    }

    const layers = [main];
    // A quiet fifth above the carrier: the same beat, a fuller sound. Only in
    // the body, where a listener has settled and can take the extra weight.
    if (body) {
      layers.push(layer({ method: s.method, carrier: s.carrier, beat: from, ratio: 1.5, gain: 0.14 }));
    }
    if (s.noise > 0.01) {
      const bed = Math.min(0.35, s.noise);
      const noise = layer({ kind: 'noise', method: 'tone', color: s.noiseColor, gain: bed });
      // The bed arrives and leaves rather than switching on: up on the way in,
      // away on the way out, held through the middle.
      if (i === 0) noise.mods.push({ target: 'gain', from: 0, to: bed, curve: 'sine' });
      else if (i === last) noise.mods.push({ target: 'gain', from: bed, to: 0, curve: 'sine' });
      layers.push(noise);
    }

    return { dur, label: s.label, why: s.why, layers };
  });

  return cleanScript({
    v: 2,
    title: session.title,
    note: session.note,
    seed: hashString(seedText) % 1e9,
    origin: 'dj-ai',
    segments: segments.length ? segments : undefined,
  });
}

/** Pull the session object out of a chat completion, however it was wrapped. */
function readSession(payload: unknown): AiSession | null {
  const choice = (payload as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] })?.choices?.[0];
  const message = choice?.message;
  if (!message) return null;

  const candidates: string[] = [];
  if (typeof message.content === 'string') candidates.push(message.content);
  // Some providers return content as an array of parts.
  if (Array.isArray(message.content)) {
    for (const part of message.content as { text?: string }[]) {
      if (typeof part?.text === 'string') candidates.push(part.text);
    }
  }
  // And a few answer through a tool call even when asked for JSON.
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls as { function?: { arguments?: string } }[]) {
      if (typeof call?.function?.arguments === 'string') candidates.push(call.function.arguments);
    }
  }

  for (const raw of candidates) {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    for (const attempt of [text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
      if (!attempt) continue;
      try {
        const parsed = JSON.parse(attempt) as AiSession;
        if (parsed && Array.isArray(parsed.segments) && parsed.segments.length) return parsed;
      } catch {
        /* try the next shape */
      }
    }
  }
  return null;
}

function describeError(status: number, body: string): AiError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new AiError('That key was rejected', 'auth');
  if (status === 402 || lower.includes('credit')) return new AiError('Out of credit on that key', 'credit');
  if (status === 429) return new AiError('Rate limited — try again shortly', 'rate');
  // The hosted route only forwards a short allow-list; your own key has no such
  // limit, so say which door to use rather than just refusing.
  if (lower.includes('model not allowed')) return new AiError('That model needs your own key', 'model');
  // OpenRouter's own guardrails — allowed providers, or the data policy that
  // gates the free endpoints. Nothing is broken; an account setting says no.
  if (lower.includes('settings/privacy') || lower.includes('no endpoints available') || lower.includes('allowed providers')) {
    return new AiError('OpenRouter settings block that model', 'model');
  }
  if (status === 404 || lower.includes('not a valid model')) return new AiError('That model is not available', 'model');
  if (status >= 500) return new AiError('The DJ service is having trouble', 'network');
  return new AiError(`Request failed (${status})`, 'network');
}

/** True when the failure is the model refusing structured output rather than a real error. */
function isSchemaComplaint(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const lower = body.toLowerCase();
  return lower.includes('response_format') || lower.includes('json_schema') || lower.includes('schema');
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new AiError('The DJ took too long', 'network');
    throw new AiError('Could not reach the DJ', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** Which door this request will go through, and what to call it on screen. */
export type AiRoute = 'proxy' | 'key' | 'hosted' | 'none';

export function aiRoute(settings: { apiKey: string; proxyUrl: string }): AiRoute {
  if (navigator.onLine === false) return 'none';
  if (settings.proxyUrl) return 'proxy';
  if (settings.apiKey) return 'key';
  return hostedUsable ? 'hosted' : 'none';
}

/**
 * Ask the DJ. Throws AiError; the caller falls back to the scripted generator.
 *
 * Only Authorization and Content-Type are sent: OpenRouter's optional
 * attribution headers would add a preflight for no benefit here. On the proxy
 * and hosted routes no key leaves the browser because there is none to send.
 */
export async function requestSession(req: AiRequest): Promise<Script> {
  const route = aiRoute({ apiKey: req.apiKey, proxyUrl: req.proxyUrl ?? '' });
  if (route === 'none') throw new AiError('No DJ available — add a key', 'auth');

  const url = route === 'proxy' ? req.proxyUrl! : route === 'key' ? ENDPOINT : HOSTED;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (route === 'key') headers.authorization = `Bearer ${req.apiKey}`;

  const base = {
    model: req.model,
    max_tokens: 2000,
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(req.text, req) },
    ],
  };

  // Ask for a schema-checked answer first; not every model on OpenRouter can do
  // it, and the ones that can't say so with a 400 rather than a bad answer.
  let response = await post(url, headers, { ...base, response_format: { type: 'json_schema', json_schema: SESSION_SCHEMA } });
  if (isSchemaComplaint(response.status, response.text)) {
    response = await post(url, headers, { ...base, response_format: { type: 'json_object' } });
  }
  // A static host has no function behind that path. Stop asking, and let the
  // caller fall back — this is the ordinary case on a fork, not a failure.
  if (route === 'hosted' && NO_HOSTED.has(response.status)) {
    hostedUsable = false;
    throw new AiError('No hosted DJ here — add a key', 'auth');
  }
  if (response.status >= 400) throw describeError(response.status, response.text);

  let payload: unknown;
  try {
    payload = JSON.parse(response.text);
  } catch {
    // A host that answers a POST with its index page is also a host without the
    // function, whatever status it chose.
    if (route === 'hosted') hostedUsable = false;
    throw new AiError('The DJ sent something unreadable', 'shape');
  }

  const served = (payload as { model?: unknown }).model;
  if (route === 'hosted' && typeof served === 'string' && served) hostedModel = served;

  const session = readSession(payload);
  if (!session) throw new AiError('The DJ did not return a session', 'shape');
  return aiSessionToScript(session, `${req.text}|${req.minutes}`);
}

export function aiAvailable(settings: { apiKey: string; proxyUrl: string }): boolean {
  return aiRoute(settings) !== 'none';
}

/** One short label for the badge: which DJ will answer, in three words or less. */
export function aiLabel(settings: { apiKey: string; proxyUrl: string; model: string }): string {
  const route = aiRoute(settings);
  if (route === 'proxy') return 'AI · proxy';
  if (route === 'key') return `AI · ${settings.model}`;
  // Hosted: name what answered once we know, since the deployment may have
  // pinned something other than the model in Settings.
  if (route === 'hosted') return `AI · ${hostedModel || settings.model}`;
  return navigator.onLine === false ? 'offline · scripted' : 'scripted · no key';
}
