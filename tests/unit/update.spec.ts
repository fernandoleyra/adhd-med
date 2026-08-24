import { describe, expect, it } from 'vitest';
import { canTakeSilently } from '../../src/pwa/offline.js';

/**
 * Handing over to a new deploy.
 *
 * A build shipped and the app kept running the old one, because the only path
 * to a new worker was a prompt that an ordinary message could destroy and a
 * `updatefound` event that never fires twice. This covers the decision; the DOM
 * half is in the e2e suite, where there is a real browser to break.
 */
describe('when a new build can be taken without asking', () => {
  // The rule the original code was reaching for is "never cut the sound off",
  // and that only binds while something is playing.
  it('takes it at load with nothing playing', () => {
    expect(canTakeSilently(true, false)).toBe(true);
  });

  it('never interrupts a session', () => {
    expect(canTakeSilently(true, true)).toBe(false);
    expect(canTakeSilently(false, true)).toBe(false);
  });

  it('asks mid-session even when idle, because work may be in progress', () => {
    expect(canTakeSilently(false, false)).toBe(false);
  });
});
