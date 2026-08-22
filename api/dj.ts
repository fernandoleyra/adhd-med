/**
 * The AI DJ, hosted.
 *
 * A Vercel Edge Function so the conversational DJ works for everyone without
 * anyone pasting a key: set OPENROUTER_API_KEY in the project's environment and
 * this forwards to OpenRouter on the server side. Same origin as the app, so
 * there is no CORS dance and the key never reaches a browser.
 *
 * Deliberately dull, and the same shape as extras/proxy-worker/worker.js for
 * anyone hosting the static build elsewhere: an allow-list of models, a hard cap
 * on body size and tokens, and a crude per-IP rate limit.
 *
 * Without the environment variable it answers 501, which the client reads as
 * "no hosted DJ" and falls back to the scripted generator.
 */

export const config = { runtime: 'edge' };

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const ALLOWED_MODELS = new Set([
  'openrouter/free',
  'google/gemini-2.5-flash',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.2',
]);

const MAX_BODY_BYTES = 16_000;
const MAX_TOKENS = 2000;
const RATE_LIMIT = 20;
const WINDOW_MS = 3_600_000;

/**
 * Per-IP counters in module memory. Edge instances come and go, so this is a
 * speed bump rather than a guarantee — enough to stop one impatient loop, not a
 * substitute for a spend cap on the OpenRouter account.
 */
const hits = new Map<string, { count: number; until: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const seen = hits.get(ip);
  if (!seen || seen.until < now) {
    hits.set(ip, { count: 1, until: now + WINDOW_MS });
    if (hits.size > 5000) for (const [key, v] of hits) if (v.until < now) hits.delete(key);
    return false;
  }
  seen.count += 1;
  return seen.count > RATE_LIMIT;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = process.env.OPENROUTER_API_KEY;
  // 501, not 500: nothing is broken, this deployment simply has no hosted DJ.
  if (!key) return json({ error: 'no hosted DJ on this deployment' }, 501);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'request too large' }, 413);

  let body: { model?: unknown; messages?: unknown; max_tokens?: unknown; temperature?: unknown; response_format?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  if (typeof body.model !== 'string' || !ALLOWED_MODELS.has(body.model)) {
    return json({ error: 'model not allowed' }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'messages required' }, 400);
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (rateLimited(ip)) return json({ error: 'rate limited' }, 429);

  let upstream: Response;
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: Math.min(MAX_TOKENS, Number(body.max_tokens) || MAX_TOKENS),
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        messages: body.messages,
        response_format: body.response_format,
      }),
    });
  } catch {
    return json({ error: 'could not reach OpenRouter' }, 502);
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
