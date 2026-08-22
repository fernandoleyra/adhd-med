/**
 * Optional Cloudflare Worker for the AI DJ.
 *
 * ADHD MED does not need this. The scripted DJ works offline with no key, and a
 * visitor can paste their own OpenRouter key in Settings. Deploy this only if
 * you want everyone who opens your copy to get the conversational DJ on your
 * account.
 *
 * Deliberately dull: one endpoint, an allow-list of models, a hard cap on
 * request size and tokens, a crude per-IP rate limit, and CORS locked to your
 * own origin. It never returns your key and forwards nothing else.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const ALLOWED_MODELS = new Set([
  'openrouter/free',
  'google/gemini-2.5-flash',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.2',
]);
const MAX_BODY_BYTES = 16_000;
const MAX_TOKENS = 2000;
const RATE_LIMIT = 20; // requests per IP per hour

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-max-age': '86400',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (!env.OPENROUTER_API_KEY) return json({ error: 'proxy is not configured' }, 500, cors);

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'request too large' }, 413, cors);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'invalid JSON' }, 400, cors);
    }

    if (!ALLOWED_MODELS.has(body.model)) return json({ error: 'model not allowed' }, 400, cors);

    // Rate limit, if a KV namespace called RATE is bound. Skipped otherwise.
    if (env.RATE) {
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
      const hour = Math.floor(Date.now() / 3_600_000);
      const key = `${ip}:${hour}`;
      const used = Number((await env.RATE.get(key)) ?? 0);
      if (used >= RATE_LIMIT) return json({ error: 'rate limited' }, 429, cors);
      await env.RATE.put(key, String(used + 1), { expirationTtl: 3600 });
    }

    const upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        ...(env.ALLOWED_ORIGIN ? { 'http-referer': env.ALLOWED_ORIGIN, 'x-title': 'ADHD MED' } : {}),
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: Math.min(MAX_TOKENS, Number(body.max_tokens) || MAX_TOKENS),
        temperature: body.temperature,
        messages: body.messages,
        response_format: body.response_format,
      }),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  },
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
