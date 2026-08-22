/**
 * A tiny expression language for automation curves — the Lab's equation mode.
 *
 * No eval, no Function constructor: a hand-rolled parser over a fixed
 * vocabulary, so an equation from a stranger's share link can only ever
 * compute a number.
 *
 * Variables:  t seconds · u 0..1 through the segment · d segment seconds
 *             b the layer's base value · r a stable random 0..1
 * Constants:  pi · tau · e · phi
 */
import { valueNoise } from './rng.js';

export interface ExprCtx {
  t: number;
  u: number;
  d: number;
  b: number;
  r: number;
  seed: number;
}

export type Compiled = (ctx: ExprCtx) => number;

const CONSTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};

const VARS = new Set(['t', 'u', 'd', 'b', 'r']);

type Fn = { arity: number | 'variadic'; call: (args: number[], ctx: ExprCtx) => number };

const FNS: Record<string, Fn> = {
  sin: { arity: 1, call: (a) => Math.sin(a[0]!) },
  cos: { arity: 1, call: (a) => Math.cos(a[0]!) },
  tan: { arity: 1, call: (a) => Math.tan(a[0]!) },
  tanh: { arity: 1, call: (a) => Math.tanh(a[0]!) },
  exp: { arity: 1, call: (a) => Math.exp(a[0]!) },
  ln: { arity: 1, call: (a) => Math.log(Math.max(1e-12, a[0]!)) },
  log2: { arity: 1, call: (a) => Math.log2(Math.max(1e-12, a[0]!)) },
  log10: { arity: 1, call: (a) => Math.log10(Math.max(1e-12, a[0]!)) },
  sqrt: { arity: 1, call: (a) => Math.sqrt(Math.max(0, a[0]!)) },
  abs: { arity: 1, call: (a) => Math.abs(a[0]!) },
  floor: { arity: 1, call: (a) => Math.floor(a[0]!) },
  ceil: { arity: 1, call: (a) => Math.ceil(a[0]!) },
  round: { arity: 1, call: (a) => Math.round(a[0]!) },
  sign: { arity: 1, call: (a) => Math.sign(a[0]!) },
  /** 0 before the edge, 1 after */
  step: { arity: 2, call: (a) => (a[1]! >= a[0]! ? 1 : 0) },
  /** triangle wave, period 1, range 0..1 */
  tri: { arity: 1, call: (a) => 1 - Math.abs(2 * (((a[0]! % 1) + 1) % 1) - 1) },
  /** sawtooth, period 1, range 0..1 */
  saw: { arity: 1, call: (a) => ((a[0]! % 1) + 1) % 1 },
  /** square, period 1, range 0..1, second arg = duty */
  pulse: { arity: 2, call: (a) => (((a[0]! % 1) + 1) % 1 < a[1]! ? 1 : 0) },
  /** smooth deterministic noise */
  noise: { arity: 1, call: (a, ctx) => valueNoise(ctx.seed, a[0]!) },
  min: { arity: 'variadic', call: (a) => Math.min(...a) },
  max: { arity: 'variadic', call: (a) => Math.max(...a) },
  clamp: { arity: 3, call: (a) => Math.min(a[2]!, Math.max(a[1]!, a[0]!)) },
  /** linear interpolation */
  lerp: { arity: 3, call: (a) => a[0]! + (a[1]! - a[0]!) * a[2]! },
  /** smoothstep 0..1 */
  smooth: { arity: 1, call: (a) => { const x = Math.min(1, Math.max(0, a[0]!)); return x * x * (3 - 2 * x); } },
  /** quantise to a grid — number intervals as sound */
  quant: { arity: 2, call: (a) => (a[1]! === 0 ? a[0]! : Math.round(a[0]! / a[1]!) * a[1]!) },
};

export const EXPR_VOCAB = {
  vars: ['t', 'u', 'd', 'b', 'r'],
  consts: Object.keys(CONSTS),
  fns: Object.keys(FNS),
  ops: ['+', '-', '*', '/', '%', '^', '(', ')'],
};

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && /[0-9._]/.test(src[j]!)) j++;
      if (src[j] === 'e' || src[j] === 'E') {
        const k = src[j + 1] === '-' || src[j + 1] === '+' ? j + 2 : j + 1;
        if (/[0-9]/.test(src[k] ?? '')) { j = k; while (j < src.length && /[0-9]/.test(src[j]!)) j++; }
      }
      const n = Number(src.slice(i, j).replace(/_/g, ''));
      if (!Number.isFinite(n)) throw new Error(`bad number at ${i}`);
      toks.push({ k: 'num', v: n });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9]/.test(src[j]!)) j++;
      toks.push({ k: 'id', v: src.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ('+-*/%^(),'.includes(c)) { toks.push({ k: 'op', v: c }); i++; continue; }
    throw new Error(`unexpected "${c}"`);
  }
  return toks;
}

type Node = (ctx: ExprCtx) => number;

function parse(toks: Tok[]): Node {
  let p = 0;
  const peek = () => toks[p];
  const eat = (v: string) => {
    const t = toks[p];
    if (!t || t.k !== 'op' || t.v !== v) throw new Error(`expected "${v}"`);
    p++;
  };

  function expr(): Node {
    let left = term();
    for (;;) {
      const t = peek();
      if (t?.k === 'op' && (t.v === '+' || t.v === '-')) {
        p++;
        const right = term();
        const l = left;
        left = t.v === '+' ? (c) => l(c) + right(c) : (c) => l(c) - right(c);
      } else return left;
    }
  }

  function term(): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t?.k === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        p++;
        const right = unary();
        const l = left;
        if (t.v === '*') left = (c) => l(c) * right(c);
        else if (t.v === '/') left = (c) => { const d = right(c); return d === 0 ? 0 : l(c) / d; };
        else left = (c) => { const d = right(c); return d === 0 ? 0 : l(c) % d; };
      } else return left;
    }
  }

  function unary(): Node {
    const t = peek();
    if (t?.k === 'op' && (t.v === '-' || t.v === '+')) {
      p++;
      const inner = unary();
      return t.v === '-' ? (c) => -inner(c) : inner;
    }
    return power();
  }

  function power(): Node {
    const base = atom();
    const t = peek();
    if (t?.k === 'op' && t.v === '^') {
      p++;
      const exp = unary();
      return (c) => {
        const r = Math.pow(base(c), exp(c));
        return Number.isFinite(r) ? r : 0;
      };
    }
    return base;
  }

  function atom(): Node {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    if (t.k === 'num') { p++; const v = t.v; return () => v; }
    if (t.k === 'op' && t.v === '(') { p++; const inner = expr(); eat(')'); return inner; }
    if (t.k === 'id') {
      p++;
      const name = t.v;
      const next = peek();
      if (next?.k === 'op' && next.v === '(') {
        const fn = FNS[name];
        if (!fn) throw new Error(`unknown function "${name}"`);
        p++;
        const args: Node[] = [];
        if (!(peek()?.k === 'op' && (peek() as { v: string }).v === ')')) {
          for (;;) {
            args.push(expr());
            const n = peek();
            if (n?.k === 'op' && n.v === ',') { p++; continue; }
            break;
          }
        }
        eat(')');
        if (fn.arity !== 'variadic' && args.length !== fn.arity) {
          throw new Error(`${name}() takes ${fn.arity} argument${fn.arity === 1 ? '' : 's'}`);
        }
        if (fn.arity === 'variadic' && args.length === 0) throw new Error(`${name}() needs arguments`);
        return (c) => {
          const vals = args.map((a) => a(c));
          const r = fn.call(vals, c);
          return Number.isFinite(r) ? r : 0;
        };
      }
      if (name in CONSTS) { const v = CONSTS[name]!; return () => v; }
      if (VARS.has(name)) {
        return name === 't' ? (c) => c.t : name === 'u' ? (c) => c.u : name === 'd' ? (c) => c.d : name === 'b' ? (c) => c.b : (c) => c.r;
      }
      throw new Error(`unknown name "${name}"`);
    }
    throw new Error(`unexpected "${(t as { v: unknown }).v}"`);
  }

  const root = expr();
  if (p !== toks.length) throw new Error('trailing input');
  return root;
}

export type CompileResult = { ok: true; fn: Compiled } | { ok: false; error: string };

export function compile(src: string): CompileResult {
  try {
    const node = parse(lex(src));
    // Smoke-test the expression once so runtime surprises surface immediately.
    const probe = node({ t: 0, u: 0, d: 60, b: 1, r: 0.5, seed: 1 });
    if (!Number.isFinite(probe)) return { ok: false, error: 'does not evaluate to a number' };
    return {
      ok: true,
      fn: (ctx) => {
        const v = node(ctx);
        return Number.isFinite(v) ? v : 0;
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid expression' };
  }
}

/** Convenience for tests and previews. */
export function evaluate(src: string, ctx: Partial<ExprCtx> = {}): number | null {
  const r = compile(src);
  if (!r.ok) return null;
  return r.fn({ t: 0, u: 0, d: 60, b: 1, r: 0.5, seed: 1, ...ctx });
}
