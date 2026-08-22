import { describe, expect, it } from 'vitest';
import { compile, evaluate } from '../../src/core/expr.js';

describe('expression engine', () => {
  it('does arithmetic with the usual precedence', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512); // right associative
    expect(evaluate('-4 + 1')).toBe(-3);
    expect(evaluate('7 % 3')).toBe(1);
  });

  it('exposes the session variables', () => {
    expect(evaluate('b', { b: 12 })).toBe(12);
    expect(evaluate('b + 3 * u', { b: 10, u: 1 })).toBe(13);
    expect(evaluate('t / d', { t: 30, d: 60 })).toBe(0.5);
  });

  it('knows the constants', () => {
    expect(evaluate('pi')).toBeCloseTo(Math.PI, 10);
    expect(evaluate('tau')).toBeCloseTo(Math.PI * 2, 10);
    expect(evaluate('phi')).toBeCloseTo(1.618033988, 6);
  });

  it('has the shaping functions the Lab advertises', () => {
    expect(evaluate('lerp(10, 18, 0.5)')).toBe(14);
    expect(evaluate('clamp(99, 0, 40)')).toBe(40);
    expect(evaluate('quant(13.4, 2)')).toBe(14);
    expect(evaluate('smooth(0.5)')).toBe(0.5);
    expect(evaluate('tri(0.5)')).toBeCloseTo(1, 10);
    expect(evaluate('tri(0)')).toBeCloseTo(0, 10);
    expect(evaluate('saw(1.25)')).toBeCloseTo(0.25, 10);
    expect(evaluate('pulse(0.1, 0.5)')).toBe(1);
    expect(evaluate('pulse(0.9, 0.5)')).toBe(0);
    expect(evaluate('step(5, 6)')).toBe(1);
    expect(evaluate('step(5, 4)')).toBe(0);
    expect(evaluate('min(3, 1, 2)')).toBe(1);
    expect(evaluate('max(3, 1, 2)')).toBe(3);
  });

  it('is deterministic for noise given a seed', () => {
    const a = evaluate('noise(t/10)', { t: 42, seed: 7 });
    const b = evaluate('noise(t/10)', { t: 42, seed: 7 });
    const c = evaluate('noise(t/10)', { t: 42, seed: 8 });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('never divides by zero or returns a non-number', () => {
    expect(evaluate('1 / 0')).toBe(0);
    expect(evaluate('1 % 0')).toBe(0);
    expect(evaluate('ln(0)')).toBeLessThan(0);
    expect(evaluate('sqrt(-4)')).toBe(0);
    expect(evaluate('0 ^ -1')).toBe(0);
  });

  it('rejects anything outside the vocabulary', () => {
    for (const bad of [
      'constructor',
      'window.alert(1)',
      'this',
      'globalThis',
      '[].map',
      'fetch("x")',
      'b; drop',
      '2 +',
      'sin()',
      'sin(1, 2)',
      'clamp(1, 2)',
      'nope(3)',
      '"str"',
      '`x`',
    ]) {
      const result = compile(bad);
      expect(result.ok, `${bad} should not compile`).toBe(false);
    }
  });

  it('caps runaway numbers rather than emitting Infinity', () => {
    const r = compile('10 ^ 400');
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number.isFinite(r.fn({ t: 0, u: 0, d: 1, b: 1, r: 0, seed: 1 }))).toBe(true);
  });
});
