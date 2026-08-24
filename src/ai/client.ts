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
 * A rate limit worth waiting out, in seconds.
 *
 * A free endpoint under load answers "come back in five seconds", and the right
 * response to that is to come back in five seconds — not to hand over a
 * scripted session and call it a limit. Anything longer than a short pause is a
 * real wall and gets the cooldown instead. Well inside TIMEOUT_MS either way.
 */
const RETRY_WAIT_MAX = 12;

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

/**
 * When a rate limit lifts, as a timestamp. Set from whatever the 429 told us —
 * our own route says so exactly, OpenRouter says so in a header — and until it
 * passes the DJ does not ask again. Spending a request that is certain to fail
 * is how a daily allowance disappears.
 *
 * Deliberately in memory, not storage: a reload costs one wasted request and
 * cannot leave the DJ switched off by a stale number.
 */
let coolUntil = 0;

/** How many of the account's allowance were left, last time it said. */
let remaining: number | null = null;

/**
 * Whether a model took `json_schema`, remembered per id. A model that refuses
 * it used to cost two upstream requests on every single ask — against a free
 * tier of fifty a day, that halved the sets available for no benefit.
 */
const schemaMode = new Map<string, 'schema' | 'object'>();

/** Seconds until the DJ will try again, or 0 if it will try now. */
export function djCooldown(): number {
  const left = coolUntil - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/** "12 min" / "40 s" — a wait, said the way a person would say it. */
export function formatWait(seconds: number): string {
  if (seconds >= 5400) return `${Math.round(seconds / 3600)} h`;
  if (seconds >= 90) return `${Math.round(seconds / 60)} min`;
  return `${Math.max(1, Math.round(seconds))} s`;
}

/** What the account has left, when the last answer said. */
export function djRemaining(): number | null {
  return remaining;
}

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
  /** called when the DJ is waiting out a short rate limit, so the UI can say so */
  onwait?: (seconds: number) => void;
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

function describeError(status: number, body: string, seconds = 0): AiError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new AiError('That key was rejected', 'auth');
  if (status === 402 || lower.includes('credit')) return new AiError('Out of credit on that key', 'credit');
  if (status === 429) {
    // Three different walls wearing one word. Ours we set and could raise;
    // OpenRouter's free tier is 20 a minute and 50 a day until an account has
    // bought credit. Saying which, and when it lifts, is the difference between
    // a wait and a mystery.
    const wait = seconds > 0 ? `, back in ${formatWait(seconds)}` : '';
    if (lower.includes('"scope":"device"')) {
      return new AiError(`Too many sets from this device${wait}`, 'rate');
    }
    if (seconds > 0) return new AiError(`The free tier is rate limiting${wait}`, 'rate');
    return new AiError('Rate limited — the free tier allows 50 a day', 'rate');
  }
  // The hosted route only forwards a short allow-list; your own key has no such
  // limit, so say which door to use rather than just refusing.
  if (lower.includes('model not allowed')) return new AiError('That model needs your own key', 'model');
  // OpenRouter's own guardrails — allowed providers, or the data policy that
  // gates the free endpoints. Nothing is broken; an account setting says no.
  if (lower.includes('settings/privacy') || lower.includes('no endpoints available') || lower.includes('allowed providers')) {
    return new AiError('OpenRouter settings block that model', 'model');
  }
  if (status === 404 || lower.includes('not a valid model')) return new AiError('That model is not available', 'model');
  // Two ways to be too slow, and they deserve the same sentence: the hosted
  // route ran out of its budget, or the platform killed it and left an HTML page
  // where the JSON should be. Either way the model was the slow part, and the
  // answer is a quicker one rather than a wait.
  if (status === 504 || lower.includes('"scope":"timeout"') || lower.includes('function_invocation_timeout')) {
    return new AiError('The model took too long — try a quicker one', 'network');
  }
  if (status >= 500) {
    // OpenRouter's own words when it has any: "having trouble" is what we say
    // when nobody told us anything.
    const said = upstreamMessage(body);
    return new AiError(said ? `OpenRouter: ${said}` : 'The DJ service is having trouble', 'network');
  }
  return new AiError(`Request failed (${status})`, 'network');
}

/**
 * The message inside an error body, short enough for a badge. OpenAI-compatible
 * errors nest it under `error.message`; some hosts send a bare string.
 */
function upstreamMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string };
    const raw = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const said = raw.trim().replace(/\s+/g, ' ');
    return said.length > 60 ? `${said.slice(0, 57)}…` : said;
  } catch {
    return null;
  }
}

/** True when the failure is the model refusing structured output rather than a real error. */
function isSchemaComplaint(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const lower = body.toLowerCase();
  return lower.includes('response_format') || lower.includes('json_schema') || lower.includes('schema');
}

interface Reply {
  status: number;
  text: string;
  /** seconds, from Retry-After or X-RateLimit-Reset, when either was sent */
  retryAfter: number;
  /** requests left on the account, when it said */
  remaining: number | null;
}

/**
 * Read the wait out of a reply. `Retry-After` is seconds; OpenRouter's
 * `X-RateLimit-Reset` is a unix time in milliseconds. Both mean the same thing
 * to the caller, so both come back as seconds from now.
 */
function readWait(res: Response): number {
  const after = Number(res.headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return Math.min(86_400, after);
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const seconds = Math.ceil((reset - Date.now()) / 1000);
    if (seconds > 0) return Math.min(86_400, seconds);
  }
  return 0;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Reply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const left = Number(res.headers.get('x-ratelimit-remaining'));
    return {
      status: res.status,
      text: await res.text(),
      retryAfter: readWait(res),
      remaining: Number.isFinite(left) ? left : null,
    };
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

  // Already told no, and told when to come back. Asking again would spend a
  // request to be told the same thing.
  const cooling = djCooldown();
  if (cooling > 0) throw new AiError(`Rate limited — back in ${formatWait(cooling)}`, 'rate');

  const url = route === 'proxy' ? req.proxyUrl! : route === 'key' ? ENDPOINT : HOSTED;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (route === 'key') headers.authorization = `Bearer ${req.apiKey}`;

  const base = {
    model: req.model,
    /**
     * Room for the answer *and* the thinking. Every free model on OpenRouter is
     * a reasoning model, and reasoning tokens are spent from this same budget —
     * too small and a model thinks its way past the end of the reply and returns
     * nothing parseable. A set of eight segments is under a thousand tokens of
     * JSON, so this is roughly triple what the answer needs while capping how
     * long a slow model can hold the hosted route's 22-second budget.
     */
    max_tokens: 2500,
    /**
     * And ask it not to deliberate for long. This is a constrained design task
     * with the rules already written down, so low effort keeps both the budget
     * and the 45-second timeout comfortable. Ignored by models without it.
     */
    reasoning: { effort: 'low' },
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage(req.text, req) },
    ],
  };

  // Ask for a schema-checked answer first; not every model on OpenRouter can do
  // it, and the ones that can't say so with a 400 rather than a bad answer. Once
  // a model has refused, remember it and ask the cheap way from then on: two
  // requests per set is a luxury a fifty-a-day allowance cannot afford.
  const schema = { type: 'json_schema', json_schema: SESSION_SCHEMA } as const;
  const object = { type: 'json_object' } as const;
  const known = schemaMode.get(req.model);

  let response = await post(url, headers, { ...base, response_format: known === 'object' ? object : schema });
  if (known !== 'object' && isSchemaComplaint(response.status, response.text)) {
    schemaMode.set(req.model, 'object');
    response = await post(url, headers, { ...base, response_format: object });
  } else if (known === undefined && response.status < 400) {
    schemaMode.set(req.model, 'schema');
  }

  if (response.remaining !== null) remaining = response.remaining;

  // A short hint is a queue, not a wall: wait it out once and ask again, which
  // is what the listener wanted when they pressed the button.
  if (response.status === 429 && response.retryAfter > 0 && response.retryAfter <= RETRY_WAIT_MAX) {
    req.onwait?.(response.retryAfter);
    await sleep((response.retryAfter + 0.5) * 1000);
    response = await post(url, headers, { ...base, response_format: schemaMode.get(req.model) === 'object' ? object : schema });
    if (response.remaining !== null) remaining = response.remaining;
  }

  if (response.status === 429) {
    // Still no, or too long to wait for. Stop asking until it lifts — a limit
    // with no stated end still deserves a pause, or the next tap spends another
    // request on the same refusal.
    coolUntil = Date.now() + (response.retryAfter > 0 ? response.retryAfter : 60) * 1000;
  }
  // A static host has no function behind that path. Stop asking, and let the
  // caller fall back — this is the ordinary case on a fork, not a failure.
  if (route === 'hosted' && NO_HOSTED.has(response.status)) {
    hostedUsable = false;
    throw new AiError('No hosted DJ here — add a key', 'auth');
  }
  if (response.status >= 400) throw describeError(response.status, response.text, response.retryAfter);

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
  const cooling = djCooldown();
  if (cooling > 0) return `waiting · ${formatWait(cooling)}`;
  const route = aiRoute(settings);
  if (route === 'proxy') return 'AI · proxy';
  if (route === 'key') return `AI · ${settings.model}`;
  // Hosted: name what answered once we know, since the deployment may have
  // pinned something other than the model in Settings.
  if (route === 'hosted') return `AI · ${hostedModel || settings.model}`;
  return navigator.onLine === false ? 'offline · scripted' : 'scripted · no key';
}
