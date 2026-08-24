import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatWait } from '../../src/ai/client.js';

type Client = typeof import('../../src/ai/client.js');

/**
 * What the DJ does when it is told no.
 *
 * "Rate limited" was one sentence covering three different walls that clear at
 * different times — and the app kept spending requests against a refusal it had
 * already been given. These tests pin the behaviour that replaced it: name the
 * limit, say when it lifts, then stop asking.
 */

const SESSION = JSON.stringify({
  title: 'Test Set',
  note: 'n',
  segments: [
    { minutes: 3, label: 'onset', why: 'w', beat: 10, beatTo: 12, carrier: 200, carrierTo: 200, method: 'binaural', noise: 0, noiseColor: 'pink' },
  ],
});

const OK = { model: 'z-ai/glm-5.2:free', choices: [{ message: { content: SESSION } }] };

interface Sent {
  body: Record<string, unknown>;
}

/** Queue one reply per call; the last one repeats if the app asks again. */
function stub(replies: { status?: number; body?: unknown; headers?: Record<string, string> }[]): Sent[] {
  const sent: Sent[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push({ body: JSON.parse(String(init.body)) });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    return new Response(JSON.stringify(r.body ?? OK), { status: r.status ?? 200, headers: r.headers ?? {} });
  });
  return sent;
}

/**
 * A fresh copy of the module per test.
 *
 * The cooldown and the per-model schema memory are deliberately module state —
 * they last a page load and no longer. Re-importing gives each test the same
 * clean slate a reload gives a visitor, rather than adding a reset hook to
 * production code for the tests' convenience.
 */
let client: Client;

/** A request through the hosted route — no key, so nothing leaves the browser. */
function ask(model = 'z-ai/glm-5.2:free') {
  return client.requestSession({ text: 'need to write for an hour', minutes: 25, headphones: true, apiKey: '', model });
}

beforeEach(async () => {
  vi.stubGlobal('navigator', { onLine: true, language: 'en' });
  vi.resetModules();
  client = await import('../../src/ai/client.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('waits, said the way a person would', () => {
  it('rounds to a unit that means something', () => {
    expect(formatWait(1)).toBe('1 s');
    expect(formatWait(45)).toBe('45 s');
    expect(formatWait(600)).toBe('10 min');
    expect(formatWait(7200)).toBe('2 h');
  });
});

describe('a rate-limited DJ', () => {
  it('names our own limit as ours, and says when it lifts', async () => {
    stub([{ status: 429, body: { error: 'rate limited', scope: 'device', retryAfter: 900, limit: 60 }, headers: { 'retry-after': '900' } }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err).toBeInstanceOf(client.AiError);
    expect(err.kind).toBe('rate');
    expect(err.message).toContain('this device');
    expect(err.message).toContain('15 min');
  });

  it('names OpenRouter\'s limit differently, from its reset header', async () => {
    stub([{
      status: 429,
      body: { error: { code: 429, message: 'Rate limit exceeded' } },
      headers: { 'x-ratelimit-reset': String(Date.now() + 240_000) },
    }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.message).toContain('free tier');
    expect(err.message).toMatch(/back in [34] min/);
  });

  it('says what the allowance is when nothing says when', async () => {
    stub([{ status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } } }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.message).toContain('50 a day');
  });

  // The point of all of it: a refusal already given is not worth a request.
  it('stops asking until the limit lifts', async () => {
    const sent = stub([{ status: 429, body: { error: 'rate limited', scope: 'device', retryAfter: 600 }, headers: { 'retry-after': '600' } }]);
    await ask().catch(() => undefined);
    expect(sent).toHaveLength(1);
    expect(client.djCooldown()).toBeGreaterThan(500);

    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.kind).toBe('rate');
    expect(err.message).toContain('back in');
    expect(sent, 'a second ask must cost nothing').toHaveLength(1);
  });

  it('tries again once the wait is over', async () => {
    // A long wait, so the automatic retry stays out of it: this is about the
    // cooldown expiring, not about waiting out a queue.
    const sent = stub([
      { status: 429, body: { error: 'rate limited', scope: 'device', retryAfter: 900 }, headers: { 'retry-after': '900' } },
      { status: 200 },
    ]);
    await ask().catch(() => undefined);
    expect(sent).toHaveLength(1);

    // Stay on the faked clock for the retry: dropping back to real time would
    // put us before the cooldown again, which is what this asserts is over.
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 901_000);
    expect(client.djCooldown()).toBe(0);

    const script = await ask();
    expect(sent).toHaveLength(2);
    expect(script.title).toBe('Test Set');
  });

  // A busy free endpoint says "five seconds", and five seconds is not a wall.
  it('waits out a short hint and gets the set anyway', async () => {
    const waits: number[] = [];
    const sent = stub([
      { status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } }, headers: { 'retry-after': '5' } },
      { status: 200 },
    ]);
    vi.useFakeTimers();
    const pending = client.requestSession({
      text: 'need to write for an hour',
      minutes: 25,
      headphones: true,
      apiKey: '',
      model: 'z-ai/glm-5.2:free',
      onwait: (n) => waits.push(n),
    });
    await vi.advanceTimersByTimeAsync(6000);
    const script = await pending;

    expect(script.title).toBe('Test Set');
    expect(sent).toHaveLength(2);
    expect(waits).toEqual([5]);
    // Nothing to cool down from: the DJ answered.
    expect(client.djCooldown()).toBe(0);
  });

  it('does not wait out a long one', async () => {
    const sent = stub([{ status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } }, headers: { 'retry-after': '900' } }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.kind).toBe('rate');
    expect(sent, 'nine hundred seconds is a wall, not a queue').toHaveLength(1);
    expect(client.djCooldown()).toBeGreaterThan(800);
  });

  it('gives up if the wait did not help', async () => {
    const sent = stub([{ status: 429, body: { error: { code: 429, message: 'Rate limit exceeded' } }, headers: { 'retry-after': '3' } }]);
    vi.useFakeTimers();
    const pending = ask().catch((e) => e);
    await vi.advanceTimersByTimeAsync(4000);
    const err = (await pending) as InstanceType<Client['AiError']>;

    expect(err.kind).toBe('rate');
    expect(sent, 'one retry, not a loop').toHaveLength(2);
    expect(client.djCooldown()).toBeGreaterThan(0);
  });

  it('remembers what the account has left', async () => {
    stub([{ status: 200, headers: { 'x-ratelimit-remaining': '12' } }]);
    await ask();
    expect(client.djRemaining()).toBe(12);
  });
});

describe('the cost of one set', () => {
  it('asks twice the first time a model refuses a schema, then once', async () => {
    const model = 'schema-refuser/x:free';
    const sent = stub([
      { status: 400, body: { error: { message: 'response_format json_schema is not supported' } } },
      { status: 200 },
    ]);
    await ask(model);
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body.response_format).toMatchObject({ type: 'json_schema' });
    expect(sent[1]!.body.response_format).toEqual({ type: 'json_object' });

    // Second ask: it already knows, so one request buys one set.
    await ask(model);
    expect(sent).toHaveLength(3);
    expect(sent[2]!.body.response_format).toEqual({ type: 'json_object' });
  });

  it('costs one request for a model that holds the schema', async () => {
    const sent = stub([{ status: 200 }]);
    await ask('schema-keeper/y:free');
    await ask('schema-keeper/y:free');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.response_format).toMatchObject({ type: 'json_schema' });
  });

  it('gives a reasoning model room, and asks it not to dawdle', async () => {
    const sent = stub([{ status: 200 }]);
    await ask('budget/check:free');
    // Triple what the JSON needs, and small enough that a slow model cannot
    // hold the hosted route past its own deadline.
    expect(sent[0]!.body.max_tokens).toBe(2500);
    expect(sent[0]!.body.reasoning).toEqual({ effort: 'low' });
  });
});

/**
 * "The DJ service is having trouble" was one sentence over three causes, the
 * same failure of nerve as "rate limited". A model that was too slow, an
 * upstream that erred, and a route that could not be reached want different
 * answers from the listener.
 */
describe('a 5xx says which kind', () => {
  it('reads our own timeout as one', async () => {
    stub([{ status: 504, body: { error: 'upstream timed out', scope: 'timeout', ms: 22000 } }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.message).toContain('took too long');
    // Waiting does not make a model faster, so nothing is put on hold.
    expect(client.djCooldown()).toBe(0);
  });

  // The platform's own kill leaves HTML where the JSON should be.
  it('reads the platform\'s timeout as one too, HTML body and all', async () => {
    stub([{ status: 504, body: '<!DOCTYPE html><h1>504: FUNCTION_INVOCATION_TIMEOUT</h1>' }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.message).toContain('took too long');
  });

  it('passes on what OpenRouter actually said', async () => {
    stub([{ status: 502, body: { error: { message: 'Provider returned an internal error' } } }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.message).toContain('OpenRouter');
    expect(err.message).toContain('Provider returned an internal error');
  });

  it('trims a message too long for a badge', async () => {
    stub([{ status: 502, body: { error: { message: 'x'.repeat(300) } } }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.message.length).toBeLessThan(90);
    expect(err.message).toContain('…');
  });

  it('falls back to plain words when nobody said anything', async () => {
    stub([{ status: 500, body: {} }]);
    const err = (await ask().catch((e) => e)) as InstanceType<Client['AiError']>;
    expect(err.message).toBe('The DJ service is having trouble');
  });
});
