/**
 * The AI DJ, over OpenRouter.
 *
 * Optional by design: the app ships with no key and the scripted generator uses
 * the same grammar. When a key is present this is one plain fetch to an
 * OpenAI-compatible endpoint — no SDK, so nothing is added to the bundle for
 * the people who never set a key.
 *
 * The key is the user's own and stays in their browser. Requests go straight
 * from the browser to OpenRouter unless a proxy URL is configured.
 */
import { cleanScript } from '../core/ranges.js';
import { layer, type Layer, type Script } from '../core/types.js';
import { hashString } from '../core/rng.js';
import { SESSION_SCHEMA, SYSTEM_PROMPT, userMessage } from './prompt.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const TIMEOUT_MS = 45_000;

export interface AiRequest {
  text: string;
  minutes: number;
  headphones: boolean;
  apiKey: string;
  model: string;
  proxyUrl?: string;
}

interface AiSegment {
  minutes: number;
  label: string;
  why: string;
  beat: number;
  beatTo: number;
  carrier: number;
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

/** Map the model's answer onto real layers. The physics stays ours. */
export function aiSessionToScript(session: AiSession, seedText: string): Script {
  const segments = session.segments.slice(0, 12).map((s) => {
    const main: Layer = layer({
      method: s.method,
      carrier: s.carrier,
      beat: s.beat,
      gain: 0.55,
    });
    if (Number.isFinite(s.beatTo) && Math.abs(s.beatTo - s.beat) > 0.05) {
      main.mods.push({ target: 'beat', from: s.beat, to: s.beatTo, curve: 'sine' });
    }
    const layers = [main];
    if (s.noise > 0.01) {
      layers.push(layer({ kind: 'noise', method: 'tone', color: s.noiseColor, gain: Math.min(0.35, s.noise) }));
    }
    return {
      dur: Math.round(Math.max(20, Math.min(3600, s.minutes * 60))),
      label: s.label,
      why: s.why,
      layers,
    };
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
  if (status === 404 || lower.includes('not a valid model')) return new AiError('That model is not available', 'model');
  if (status >= 500) return new AiError('OpenRouter is having trouble', 'network');
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
    throw new AiError('Could not reach OpenRouter', 'network');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the DJ. Throws AiError; the caller falls back to the scripted generator.
 *
 * Only Authorization and Content-Type are sent: OpenRouter's optional
 * attribution headers would add a preflight for no benefit here.
 */
export async function requestSession(req: AiRequest): Promise<Script> {
  if (!req.proxyUrl && !req.apiKey) throw new AiError('No key and no proxy configured', 'auth');

  const url = req.proxyUrl || ENDPOINT;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!req.proxyUrl) headers.authorization = `Bearer ${req.apiKey}`;

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
  if (response.status >= 400) throw describeError(response.status, response.text);

  let payload: unknown;
  try {
    payload = JSON.parse(response.text);
  } catch {
    throw new AiError('OpenRouter sent something unreadable', 'shape');
  }

  const session = readSession(payload);
  if (!session) throw new AiError('The DJ did not return a session', 'shape');
  return aiSessionToScript(session, `${req.text}|${req.minutes}`);
}

export function aiAvailable(settings: { apiKey: string; proxyUrl: string }): boolean {
  return Boolean(settings.apiKey || settings.proxyUrl) && navigator.onLine !== false;
}
