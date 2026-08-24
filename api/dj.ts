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

/**
 * Which model answers, decided by the deployment rather than the browser —
 * this route is the one paying, and an OpenRouter account's provider and
 * data-policy guardrails can rule out every default here without a line of code
 * being wrong. Both variables take OpenRouter ids ("vendor/model").
 *
 * DJ_MODEL   pins one model. Whatever the browser asks for, this answers.
 * DJ_MODELS  a comma-separated allow-list the browser may choose from.
 *
 * Set DJ_MODEL for "this deployment DJs with this model", which is the simple
 * case. Set DJ_MODELS instead to let visitors pick. DJ_MODEL wins if both are
 * set. Neither one means the four defaults below.
 */
const DEFAULT_MODELS = [
  // Free, and able to hold a JSON schema — which most free models cannot.
  'z-ai/glm-5.2:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'openrouter/free',
];

/**
 * This deployment does not spend money. A free id on OpenRouter either ends in
 * `:free` or is the free auto-router, so the rule is checkable — and checking
 * it here means a typo in DJ_MODEL cannot quietly start billing an account.
 * A fork that wants paid models sets DJ_ALLOW_PAID=1 and owns that decision.
 */
function isFree(id: string): boolean {
  return id === 'openrouter/free' || id.endsWith(':free');
}

function paidAllowed(): boolean {
  return process.env.DJ_ALLOW_PAID === '1';
}

/** Read per request, so a test can vary it and an env change needs no code. */
function pinnedModel(): string {
  return process.env.DJ_MODEL?.trim() ?? '';
}

function allowedModels(): Set<string> {
  const list = process.env.DJ_MODELS?.split(',').map((m) => m.trim()).filter(Boolean);
  return new Set(list?.length ? list : DEFAULT_MODELS);
}

const MAX_BODY_BYTES = 16_000;
/**
 * A ceiling on what one request can spend, not a target. It has to clear the
 * reasoning tokens a thinking model burns before it writes any JSON — the app
 * asks for 4000 and a session is well under a thousand of them.
 */
const MAX_TOKENS = 6000;
const WINDOW_MS = 3_600_000;

/**
 * How many requests one address may make an hour, overridable with
 * DJ_RATE_LIMIT. This is a brake on a runaway loop, not the account's spend
 * guard — that is DJ_MODEL and a cap on OpenRouter. It used to be 20, which is
 * tighter than OpenRouter's own free-tier allowance of 20 a *minute* and made
 * this the first wall an ordinary session hit.
 */
function rateLimit(): number {
  const n = Number(process.env.DJ_RATE_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
}

/**
 * Per-IP counters in module memory. Edge instances come and go, so this is a
 * speed bump rather than a guarantee — enough to stop one impatient loop, not a
 * substitute for a spend cap on the OpenRouter account.
 */
const hits = new Map<string, { count: number; until: number }>();

/** Seconds until this address is allowed again, or 0 if it already is. */
function retryAfter(ip: string): number {
  const now = Date.now();
  const seen = hits.get(ip);
  if (!seen || seen.until < now) {
    hits.set(ip, { count: 1, until: now + WINDOW_MS });
    if (hits.size > 5000) for (const [key, v] of hits) if (v.until < now) hits.delete(key);
    return 0;
  }
  seen.count += 1;
  if (seen.count <= rateLimit()) return 0;
  return Math.max(1, Math.ceil((seen.until - now) / 1000));
}

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

/**
 * Which upstream headers reach the browser. OpenRouter says how long a rate
 * limit lasts in these, and the app needs them to tell someone when the DJ is
 * back rather than shrugging — dropping them was how "rate limited" became an
 * unanswerable sentence.
 */
const PASS_THROUGH = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

  const key = process.env.OPENROUTER_API_KEY;
  // 501, not 500: nothing is broken, this deployment simply has no hosted DJ.
  if (!key) return json({ error: 'no hosted DJ on this deployment' }, 501);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'request too large' }, 413);

  let body: {
    model?: unknown;
    messages?: unknown;
    max_tokens?: unknown;
    temperature?: unknown;
    response_format?: unknown;
    reasoning?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  // A pinned model needs no permission from the allow-list: naming it in the
  // environment *is* the permission.
  const pinned = pinnedModel();
  const model = pinned || (typeof body.model === 'string' ? body.model.trim() : '');
  if (!pinned && !allowedModels().has(model)) {
    return json({ error: 'model not allowed' }, 400);
  }
  // The one rule no list can enforce on its own.
  if (!isFree(model) && !paidAllowed()) {
    return json({ error: 'model not free', model }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'messages required' }, 400);
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const wait = retryAfter(ip);
  // `scope` is the whole point: the app has to tell this apart from
  // OpenRouter's own 429, because the two clear at different times and only one
  // of them is ours to raise.
  if (wait > 0) {
    return json(
      { error: 'rate limited', scope: 'device', retryAfter: wait, limit: rateLimit() },
      429,
      { 'retry-after': String(wait) },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.min(MAX_TOKENS, Number(body.max_tokens) || MAX_TOKENS),
        temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
        messages: body.messages,
        response_format: body.response_format,
        // Passed through rather than dropped: this is how the app keeps a
        // reasoning model from spending the whole budget thinking.
        reasoning: body.reasoning,
      }),
    });
  } catch {
    return json({ error: 'could not reach OpenRouter' }, 502);
  }

  // Never pass an upstream 404 through unchanged. The client reads 404 on this
  // path as "this deployment has no DJ" and stops asking for the session —
  // which is right for a static host, and quite wrong for OpenRouter declining
  // a model. Report a refusal as a refusal, body intact.
  const status = upstream.status === 404 ? 502 : upstream.status;

  const headers: Record<string, string> = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }

  return new Response(await upstream.text(), { status, headers });
}
