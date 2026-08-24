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
function stubUpstream(status = 200, body: unknown = OK, headers: Record<string, string> = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status, headers });
  });
  return calls;
}

/** Answers each call in turn; the last reply repeats. Returns what was sent. */
function stubSequence(replies: { status?: number; body?: unknown; headers?: Record<string, string> }[]) {
  const calls: { model: string }[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    calls.push({ model: JSON.parse(String(init.body)).model });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    return new Response(JSON.stringify(r.body ?? OK), { status: r.status ?? 200, headers: r.headers ?? {} });
  });
  return calls;
}

/** A request from a named address, so the per-IP limiter can be exercised. */
function askFrom(ip: string): Request {
  return new Request('https://example.test/api/dj', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ model: 'openrouter/free', messages: [{ role: 'user', content: 'hi' }] }),
  });
}

/**
 * Note for whoever adds a test here: the route's per-IP counters live in module
 * memory and outlive a single test, so the setup raises DJ_RATE_LIMIT out of the
 * way and the limiter's own tests use their own addresses.
 */
const ENV_KEYS = ['OPENROUTER_API_KEY', 'DJ_MODEL', 'DJ_MODELS', 'DJ_RATE_LIMIT', 'DJ_ALLOW_PAID'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.DJ_MODEL;
  delete process.env.DJ_MODELS;
  delete process.env.DJ_ALLOW_PAID;
  // A limit high enough that only the tests that mean to hit it, do.
  process.env.DJ_RATE_LIMIT = '10000';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  // The budget tests move the clock; leaving it moved would quietly poison the
  // rate-limit tests, which read it.
  vi.useRealTimers();
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
    process.env.DJ_MODEL = 'some/obscure-model:free';
    const calls = stubUpstream();
    const res = await handler(ask('some/obscure-model:free'));
    expect(res.status).toBe(200);
    expect(calls[0]!.body.model).toBe('some/obscure-model:free');
  });

  it('DJ_MODELS replaces the allow-list the browser may choose from', async () => {
    process.env.DJ_MODELS = 'a/one:free, a/two:free';
    const calls = stubUpstream();
    expect((await handler(ask('a/two:free'))).status).toBe(200);
    expect(calls[0]!.body.model).toBe('a/two:free');
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

  // This deployment does not spend money, and a list is not enough to promise
  // that — a typo in DJ_MODEL would be a bill.
  it('refuses a model that is not free, however it was named', async () => {
    process.env.DJ_MODELS = 'anthropic/claude-sonnet-4.6';
    const calls = stubUpstream();
    const res = await handler(ask('anthropic/claude-sonnet-4.6'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'model not free' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a paid model even when it is pinned', async () => {
    process.env.DJ_MODEL = 'openai/gpt-5.2';
    const calls = stubUpstream();
    expect((await handler(ask())).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('lets a fork opt into paying, explicitly', async () => {
    process.env.DJ_MODEL = 'openai/gpt-5.2';
    process.env.DJ_ALLOW_PAID = '1';
    const calls = stubUpstream();
    expect((await handler(ask())).status).toBe(200);
    expect(calls[0]!.body.model).toBe('openai/gpt-5.2');
  });

  it('takes the free auto-router, which has no :free suffix', async () => {
    const calls = stubUpstream();
    expect((await handler(ask('openrouter/free'))).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  // "Rate limited" has to say whose limit it was. Ours is the one this
  // deployment can raise; OpenRouter's is not.
  describe('its own rate limit', () => {
    it('says whose limit it is, and for how long', async () => {
      process.env.DJ_RATE_LIMIT = '2';
      stubUpstream();
      expect((await handler(askFrom('1.1.1.1'))).status).toBe(200);
      expect((await handler(askFrom('1.1.1.1'))).status).toBe(200);

      const res = await handler(askFrom('1.1.1.1'));
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body).toMatchObject({ error: 'rate limited', scope: 'device', limit: 2 });
      expect(body.retryAfter).toBeGreaterThan(0);
      expect(body.retryAfter).toBeLessThanOrEqual(3600);
      expect(Number(res.headers.get('retry-after'))).toBe(body.retryAfter);
    });

    it('counts per address, so one visitor cannot lock out another', async () => {
      process.env.DJ_RATE_LIMIT = '1';
      stubUpstream();
      expect((await handler(askFrom('2.2.2.2'))).status).toBe(200);
      expect((await handler(askFrom('2.2.2.2'))).status).toBe(429);
      expect((await handler(askFrom('3.3.3.3'))).status).toBe(200);
    });
  });

  // The reset time is the whole answer to "when will it work again", and this
  // route used to drop it on the floor.
  it('passes the upstream rate-limit headers through', async () => {
    stubUpstream(429, { error: { code: 429, message: 'Rate limit exceeded' } }, {
      'retry-after': '42',
      'x-ratelimit-limit': '50',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1700000000000',
    });
    const res = await handler(ask());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(res.headers.get('x-ratelimit-reset')).toBe('1700000000000');
  });

  /**
   * OpenRouter sends Retry-After when every provider for a model returned a
   * retry hint. Waiting for that same pool is a coin flip; a different free
   * model has a different pool and costs no wait.
   */
  describe('a busy model', () => {
    it('falls through to the next free one', async () => {
      process.env.DJ_MODELS = 'a/one:free, a/two:free';
      const calls = stubSequence([
        { status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } }, headers: { 'retry-after': '5' } },
        { status: 200 },
      ]);
      const res = await handler(ask('a/one:free'));
      expect(res.status).toBe(200);
      expect(calls.map((c) => c.model)).toEqual(['a/one:free', 'a/two:free']);
    });

    it('does the same for a 503', async () => {
      process.env.DJ_MODELS = 'a/one:free, a/two:free';
      const calls = stubSequence([{ status: 503 }, { status: 200 }]);
      expect((await handler(ask('a/one:free'))).status).toBe(200);
      expect(calls).toHaveLength(2);
    });

    it('tries two models, not the whole list', async () => {
      process.env.DJ_MODELS = 'a/one:free, a/two:free, a/three:free, a/four:free';
      const calls = stubSequence([{ status: 429, headers: { 'retry-after': '5' } }]);
      const res = await handler(ask('a/one:free'));
      expect(res.status).toBe(429);
      expect(calls).toHaveLength(2);
      // and the wait still reaches the browser, so it can decide to hold off
      expect(res.headers.get('retry-after')).toBe('5');
    });

    it('never falls through to a model that costs money', async () => {
      process.env.DJ_MODEL = 'a/one:free';
      process.env.DJ_MODELS = 'anthropic/claude-sonnet-4.6';
      const calls = stubSequence([{ status: 429, headers: { 'retry-after': '5' } }]);
      await handler(ask('a/one:free'));
      expect(calls.map((c) => c.model)).toEqual(['a/one:free']);
    });

    it('leaves an ordinary failure alone', async () => {
      const calls = stubSequence([{ status: 400, body: { error: 'bad request' } }]);
      expect((await handler(ask())).status).toBe(400);
      expect(calls, 'a 400 is not a busy pool').toHaveLength(1);
    });
  });

  /**
   * Vercel kills an Edge function that has not started responding in 25 seconds
   * and leaves an HTML error page behind — which the app can only read as a
   * shrug. Finishing inside our own budget keeps the reason in JSON.
   */
  describe('the invocation budget', () => {
    it('says it timed out rather than letting the platform say nothing', async () => {
      vi.stubGlobal('fetch', async () => {
        throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      });
      const res = await handler(ask());
      expect(res.status).toBe(504);
      expect(await res.json()).toMatchObject({ error: 'upstream timed out', scope: 'timeout' });
    });

    it('still calls an unreachable upstream unreachable', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed');
      });
      expect((await handler(ask())).status).toBe(502);
    });

    it('gives each attempt a deadline', async () => {
      const signals: (AbortSignal | null | undefined)[] = [];
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        signals.push(init.signal);
        return new Response(JSON.stringify(OK), { status: 200 });
      });
      await handler(ask());
      expect(signals[0], 'no deadline means the platform sets it').toBeInstanceOf(AbortSignal);
    });

    // The fall-through must not be what pushes an invocation over the edge.
    it('skips the second model when the first one ate the budget', async () => {
      process.env.DJ_MODELS = 'a/one:free, a/two:free';
      const calls: string[] = [];
      vi.useFakeTimers();
      vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)).model);
        // A slow answer: eighteen seconds of a twenty-two second budget.
        vi.setSystemTime(Date.now() + 18_000);
        return new Response(JSON.stringify({ error: { code: 429 } }), {
          status: 429,
          headers: { 'retry-after': '5' },
        });
      });

      const res = await handler(ask('a/one:free'));
      expect(res.status).toBe(429);
      expect(calls, 'one slow attempt is all there was room for').toEqual(['a/one:free']);
    });

    it('takes the second model when the first failed quickly', async () => {
      process.env.DJ_MODELS = 'a/one:free, a/two:free';
      const calls = stubSequence([{ status: 429, headers: { 'retry-after': '5' } }, { status: 200 }]);
      expect((await handler(ask('a/one:free'))).status).toBe(200);
      expect(calls).toHaveLength(2);
    });
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
