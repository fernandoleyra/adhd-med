import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../api/dj.js';

/**
 * The hosted DJ route. These tests are for whoever configures a deployment:
 * which model answers, what happens when the environment says nothing, and the
 * failures the client depends on being distinguishable from each other.
 */

const OK = {
  id: 'gen-1',
  model: 'served/model',
  choices: [{ message: { content: '{"title":"x","note":"y","segments":[]}' } }],
};

/** The body the app actually sends, trimmed to what this route inspects. */
function ask(model = 'openrouter/free'): Request {
  return new Request('https://example.test/api/dj', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: 'hi' }] }),
  });
}

/** Captures what was forwarded upstream, and answers with `status`/`body`. */
function stubUpstream(status = 200, body: unknown = OK) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

/**
 * Note for whoever adds a test here: the route's per-IP rate limit lives in
 * module memory and these all share one IP, so more than 20 requests that
 * reach upstream will start coming back 429.
 */
const ENV_KEYS = ['OPENROUTER_API_KEY', 'DJ_MODEL', 'DJ_MODELS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.DJ_MODEL;
  delete process.env.DJ_MODELS;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('the hosted DJ route', () => {
  it('forwards a model from the default allow-list', async () => {
    const calls = stubUpstream();
    const res = await handler(ask('openrouter/free'));
    expect(res.status).toBe(200);
    expect(calls[0]!.body.model).toBe('openrouter/free');
    expect(calls[0]!.url).toContain('openrouter.ai');
  });

  it('refuses a model nobody allowed, rather than paying for it', async () => {
    const calls = stubUpstream();
    const res = await handler(ask('some/expensive-model'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'model not allowed' });
    expect(calls).toHaveLength(0);
  });

  // The point of DJ_MODEL: the deployment pays, so the deployment chooses.
  it('DJ_MODEL answers whatever the browser asked for', async () => {
    process.env.DJ_MODEL = 'nvidia/nemotron-nano-9b-v2:free';
    const calls = stubUpstream();
    const res = await handler(ask('openrouter/free'));
    expect(res.status).toBe(200);
    expect(calls[0]!.body.model).toBe('nvidia/nemotron-nano-9b-v2:free');
  });

  it('DJ_MODEL needs no place on the allow-list', async () => {
    process.env.DJ_MODEL = 'some/obscure-model';
    const calls = stubUpstream();
    const res = await handler(ask('some/obscure-model'));
    expect(res.status).toBe(200);
    expect(calls[0]!.body.model).toBe('some/obscure-model');
  });

  it('DJ_MODELS replaces the allow-list the browser may choose from', async () => {
    process.env.DJ_MODELS = 'a/one, a/two';
    const calls = stubUpstream();
    expect((await handler(ask('a/two'))).status).toBe(200);
    expect(calls[0]!.body.model).toBe('a/two');
    // and the defaults no longer apply
    expect((await handler(ask('openrouter/free'))).status).toBe(400);
  });

  it('caps tokens however large the request asks', async () => {
    const calls = stubUpstream();
    const req = new Request('https://example.test/api/dj', {
      method: 'POST',
      body: JSON.stringify({ model: 'openrouter/free', max_tokens: 999_999, messages: [{ role: 'user', content: 'hi' }] }),
    });
    await handler(req);
    expect(calls[0]!.body.max_tokens).toBe(6000);
  });

  // Every free model on OpenRouter is a reasoning model, and reasoning tokens
  // come out of max_tokens. Dropping this field is how a working DJ returns an
  // empty answer.
  it('forwards the reasoning control instead of dropping it', async () => {
    const calls = stubUpstream();
    const req = new Request('https://example.test/api/dj', {
      method: 'POST',
      body: JSON.stringify({
        model: 'openrouter/free',
        max_tokens: 4000,
        reasoning: { effort: 'low' },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    await handler(req);
    expect(calls[0]!.body.reasoning).toEqual({ effort: 'low' });
    expect(calls[0]!.body.max_tokens).toBe(4000);
  });

  // The client tells these three apart, and behaves differently for each: 501
  // and 405 mean "this deployment has no DJ, stop asking"; 502 means a real
  // refusal worth showing. An upstream 404 must not masquerade as the first.
  it('says 501 when the deployment has no key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await handler(ask());
    expect(res.status).toBe(501);
  });

  it('says 405 to anything but a POST', async () => {
    const res = await handler(new Request('https://example.test/api/dj'));
    expect(res.status).toBe(405);
  });

  it('turns an upstream 404 into a 502, body intact', async () => {
    const refusal = { error: { message: 'No endpoints available matching your data policy', code: 404 } };
    stubUpstream(404, refusal);
    const res = await handler(ask());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(refusal);
  });

  it('passes other upstream failures through unchanged', async () => {
    stubUpstream(429, { error: 'slow down' });
    expect((await handler(ask())).status).toBe(429);
  });

  it('refuses a body far larger than any session prompt', async () => {
    const calls = stubUpstream();
    const req = new Request('https://example.test/api/dj', {
      method: 'POST',
      body: JSON.stringify({ model: 'openrouter/free', messages: [{ role: 'user', content: 'x'.repeat(20_000) }] }),
    });
    expect((await handler(req)).status).toBe(413);
    expect(calls).toHaveLength(0);
  });
});
