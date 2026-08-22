/**
 * The AI DJ.
 *
 * Optional by design. The app ships with no key and works completely without
 * one — the scripted generator uses the same session grammar. If a key is
 * present the SDK is loaded on demand (it is a separate chunk, so visitors
 * without a key never download it), and the request goes from this browser
 * straight to the API. There is no server in the middle unless you deploy the
 * optional proxy in extras/.
 */
import { cleanScript } from '../core/ranges.js';
import { layer, type Layer, type Script } from '../core/types.js';
import { hashString } from '../core/rng.js';
import { EMIT_SESSION_TOOL, SYSTEM_PROMPT, userMessage } from './prompt.js';

const TIMEOUT_MS = 30_000;

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

export class AiError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'network' | 'shape' | 'rate' | 'unknown') {
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

function readToolInput(content: unknown): AiSession | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    const b = block as { type?: string; name?: string; input?: unknown; text?: string };
    if (b.type === 'tool_use' && b.name === 'emit_session' && b.input) {
      return b.input as AiSession;
    }
  }
  // Some responses answer in text despite the instruction; try to recover JSON.
  for (const block of content) {
    const b = block as { type?: string; text?: string };
    if (b.type === 'text' && b.text) {
      const match = b.text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as AiSession;
        } catch {
          /* not JSON after all */
        }
      }
    }
  }
  return null;
}

function validate(session: AiSession | null): AiSession {
  if (!session || !Array.isArray(session.segments) || session.segments.length === 0) {
    throw new AiError('The DJ did not return a session', 'shape');
  }
  return session;
}

async function viaProxy(req: AiRequest): Promise<AiSession> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(req.proxyUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: req.model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [EMIT_SESSION_TOOL],
        messages: [{ role: 'user', content: userMessage(req.text, req) }],
      }),
    });
    if (res.status === 401 || res.status === 403) throw new AiError('The proxy refused the request', 'auth');
    if (res.status === 429) throw new AiError('Rate limited — try again in a moment', 'rate');
    if (!res.ok) throw new AiError(`Proxy error ${res.status}`, 'network');
    const data = (await res.json()) as { content?: unknown };
    return validate(readToolInput(data.content));
  } finally {
    clearTimeout(timer);
  }
}

async function viaSdk(req: AiRequest): Promise<AiSession> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({
    apiKey: req.apiKey,
    dangerouslyAllowBrowser: true,
    timeout: TIMEOUT_MS,
    maxRetries: 1,
  });
  try {
    const response = await client.messages.create({
      model: req.model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [EMIT_SESSION_TOOL as never],
      messages: [{ role: 'user', content: userMessage(req.text, req) }],
    });
    return validate(readToolInput(response.content));
  } catch (err) {
    if (err instanceof AiError) throw err;
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) throw new AiError('That API key was rejected', 'auth');
    if (status === 429) throw new AiError('Rate limited — try again in a moment', 'rate');
    if (status && status >= 500) throw new AiError('The API is having trouble', 'network');
    throw new AiError((err as Error).message || 'Request failed', 'network');
  }
}

/** Ask the DJ. Throws AiError; the caller falls back to the scripted generator. */
export async function requestSession(req: AiRequest): Promise<Script> {
  if (!req.proxyUrl && !req.apiKey) throw new AiError('No key and no proxy configured', 'auth');
  const session = req.proxyUrl ? await viaProxy(req) : await viaSdk(req);
  return aiSessionToScript(session, `${req.text}|${req.minutes}`);
}

export function aiAvailable(settings: { apiKey: string; proxyUrl: string }): boolean {
  return Boolean(settings.apiKey || settings.proxyUrl) && navigator.onLine !== false;
}
