/**
 * Logix expression compiler for CPT / CMP (and array subscripts such as `Arr[Idx+1]`).
 *
 *   Operators (low → high precedence; equal order evaluates left to right, including `**`):
 *     OR · XOR · AND (&) · = <> < <= > >= · + - · * / MOD · unary - NOT · **
 *   Functions: ABS SQR/SQRT SIN COS TAN ASN/ASIN ACS/ACOS ATN/ATAN LN LOG DEG RAD TRN FRD TOD
 *   Literals:  123  -4.5  1.5e3  16#FF  2#1010_1010  8#17
 *   Operands:  any tag operand, e.g. Tank.Level, Recipe[Idx], Local:3:I.Ch0Data, MyDint.5
 *
 * Data type rule ("optimal data type"): if any operand, literal, the destination (via
 * `forceReal`), a trigonometric/log/root function or `**` is REAL, the whole expression is evaluated
 * with REAL (single precision) math; otherwise with DINT math (integer division truncates, overflow
 * wraps and sets the shared overflow flag from `convert.ts`).
 */
import { DINT_MAX, DINT_MIN, flagOverflow, parseNumericLiteral, toDint } from './convert';

/** A numeric value source: a tag operand or a literal. */
export interface NumSource {
  readN(): number;
  /** The source is REAL (drives the optimal data type). */
  readonly real: boolean;
  /** Reading may raise a runtime fault (e.g. indirect array subscript). */
  readonly dynamic?: boolean;
}

export interface CompiledExpression extends NumSource {
  readonly text: string;
  /** Operand texts referenced by the expression (for cross reference / verification). */
  readonly operands: readonly string[];
  /** True when the expression contains a comparison operator (CMP). */
  readonly hasComparison: boolean;
}

/** Resolves an operand text to a numeric source; throws (TagError) when it cannot. */
export type OperandResolver = (operand: string) => NumSource;

export class ExpressionError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = 'ExpressionError';
    this.position = position;
  }
}

type Tok =
  | { t: 'num'; v: number; real: boolean; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'fn'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number };

type Node =
  | { k: 'num'; v: number; real: boolean }
  | { k: 'ref'; src: NumSource }
  | { k: 'un'; op: '-' | 'NOT'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'fn'; name: string; a: Node };

const KEYWORD_OPS = new Set(['AND', 'OR', 'XOR', 'NOT', 'MOD']);
const REAL_FUNCS = new Set(['SQR', 'SQRT', 'SIN', 'COS', 'TAN', 'ASN', 'ASIN', 'ACS', 'ACOS', 'ATN', 'ATAN', 'LN', 'LOG', 'DEG', 'RAD']);
const INT_FUNCS = new Set(['ABS', 'TRN', 'TRUNC', 'FRD', 'TOD']);
const COMPARE_OPS = new Set(['=', '<>', '<', '<=', '>', '>=']);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const pos = i;
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const rest = src.slice(i);
      const mm = /^\d+#[0-9A-Fa-f_]+/.exec(rest) ?? /^(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
      const lit = mm ? parseNumericLiteral(mm[0]) : undefined;
      if (!mm || !lit) throw new ExpressionError(`Invalid number at position ${pos + 1}`, pos);
      toks.push({ t: 'num', v: lit.value, real: lit.real, pos });
      i += mm[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_:]/.test(src[j]!)) j++;
      let plain = true;
      for (;;) {
        if (src[j] === '.' && /[A-Za-z0-9_[]/.test(src[j + 1] ?? '')) {
          plain = false;
          j++;
          while (j < n && /[A-Za-z0-9_]/.test(src[j]!)) j++;
        } else if (src[j] === '[') {
          plain = false;
          let depth = 0;
          for (; j < n; j++) {
            if (src[j] === '[') depth++;
            else if (src[j] === ']' && --depth === 0) break;
          }
          if (j >= n) throw new ExpressionError(`Missing ']' in operand starting at position ${pos + 1}`, pos);
          j++;
        } else break;
      }
      const word = src.slice(i, j);
      const upper = word.toUpperCase();
      i = j;
      if (plain && KEYWORD_OPS.has(upper)) {
        toks.push({ t: 'op', v: upper, pos });
        continue;
      }
      if (plain && (REAL_FUNCS.has(upper) || INT_FUNCS.has(upper))) {
        let k = i;
        while (k < n && /\s/.test(src[k]!)) k++;
        if (src[k] === '(') {
          toks.push({ t: 'fn', v: upper, pos });
          continue;
        }
      }
      toks.push({ t: 'id', v: word, pos });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '**' || two === '<>' || two === '<=' || two === '>=') {
      toks.push({ t: 'op', v: two, pos });
      i += 2;
      continue;
    }
    if ('+-*/()=<>&'.includes(c)) {
      toks.push({ t: 'op', v: c === '&' ? 'AND' : c, pos });
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected character '${c}' at position ${pos + 1}`, pos);
  }
  return toks;
}

class ExprParser {
  private i = 0;
  readonly operands: string[] = [];
  hasComparison = false;
  constructor(
    private readonly toks: Tok[],
    private readonly resolve: OperandResolver,
    private readonly textLength: number,
  ) {}

  parse(): Node {
    if (this.toks.length === 0) throw new ExpressionError('Expression is empty', 0);
    const node = this.parseBinary(0);
    const extra = this.toks[this.i];
    if (extra) throw new ExpressionError(`Unexpected '${extra.v}' at position ${extra.pos + 1}`, extra.pos);
    return node;
  }

  /**
   * Binary operator levels, lowest first (1756-RM003 CPT/CMP order of operation). Operators of equal
   * order are evaluated left to right; all six relational operators share one level.
   */
  private static readonly LEVELS: ReadonlyArray<ReadonlySet<string>> = [
    new Set(['OR']),
    new Set(['XOR']),
    new Set(['AND']),
    new Set(['=', '<>', '<', '<=', '>', '>=']),
    new Set(['+', '-']),
    new Set(['*', '/', 'MOD']),
  ];

  private peekOp(): string | undefined {
    const t = this.toks[this.i];
    return t && t.t === 'op' ? t.v : undefined;
  }

  private parseBinary(level: number): Node {
    if (level >= ExprParser.LEVELS.length) return this.parseUnary();
    const ops = ExprParser.LEVELS[level]!;
    let left = this.parseBinary(level + 1);
    for (;;) {
      const op = this.peekOp();
      if (!op || !ops.has(op)) return left;
      this.i++;
      if (COMPARE_OPS.has(op)) this.hasComparison = true;
      const right = this.parseBinary(level + 1);
      left = { k: 'bin', op, a: left, b: right };
    }
  }

  private parseUnary(): Node {
    const op = this.peekOp();
    if (op === '-' || op === 'NOT') {
      this.i++;
      const a = this.parseUnary();
      if (op === '-' && a.k === 'num') return { k: 'num', v: -a.v, real: a.real };
      return { k: 'un', op, a };
    }
    if (op === '+') {
      this.i++;
      return this.parseUnary();
    }
    return this.parsePower();
  }

  /** `**` binds tighter than negation and is evaluated left to right: 2**3**2 = (2**3)**2 = 64. */
  private parsePower(): Node {
    let left = this.parsePrimary();
    while (this.peekOp() === '**') {
      this.i++;
      left = { k: 'bin', op: '**', a: left, b: this.parseExponent() };
    }
    return left;
  }

  /** Exponent operand: a primary, optionally negated (2**-1); never swallows a following `**`. */
  private parseExponent(): Node {
    const op = this.peekOp();
    if (op === '-' || op === 'NOT') {
      this.i++;
      const a = this.parseExponent();
      if (op === '-' && a.k === 'num') return { k: 'num', v: -a.v, real: a.real };
      return { k: 'un', op, a };
    }
    if (op === '+') {
      this.i++;
      return this.parseExponent();
    }
    return this.parsePrimary();
  }

  private expect(v: string): void {
    const t = this.toks[this.i];
    if (!t || t.t !== 'op' || t.v !== v) {
      const pos = t ? t.pos : this.textLength;
      throw new ExpressionError(`Expected '${v}' at position ${pos + 1}`, pos);
    }
    this.i++;
  }

  private parsePrimary(): Node {
    const t = this.toks[this.i];
    if (!t) throw new ExpressionError('Unexpected end of expression', this.textLength);
    this.i++;
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v, real: t.real };
      case 'id':
        this.operands.push(t.v);
        return { k: 'ref', src: this.resolve(t.v) };
      case 'fn': {
        this.expect('(');
        const a = this.parseBinary(0);
        this.expect(')');
        return { k: 'fn', name: t.v, a };
      }
      case 'op':
        if (t.v === '(') {
          const inner = this.parseBinary(0);
          this.expect(')');
          return inner;
        }
        throw new ExpressionError(`Unexpected '${t.v}' at position ${t.pos + 1}`, t.pos);
    }
  }
}

function isRealTree(n: Node): boolean {
  switch (n.k) {
    case 'num':
      return n.real;
    case 'ref':
      return n.src.real;
    case 'un':
      return isRealTree(n.a);
    case 'bin':
      return n.op === '**' || isRealTree(n.a) || isRealTree(n.b);
    case 'fn':
      return REAL_FUNCS.has(n.name) || isRealTree(n.a);
  }
}

function isDynamicTree(n: Node): boolean {
  switch (n.k) {
    case 'num':
      return false;
    case 'ref':
      return n.src.dynamic === true;
    case 'un':
    case 'fn':
      return isDynamicTree(n.a);
    case 'bin':
      return isDynamicTree(n.a) || isDynamicTree(n.b);
  }
}

type Fn = () => number;

function wrapInt(x: number): number {
  if (x > DINT_MAX || x < DINT_MIN) {
    flagOverflow();
    return x | 0;
  }
  return x;
}

function fromBcd(v: number): number {
  let out = 0;
  let mul = 1;
  let x = v >>> 0;
  while (x > 0) {
    const d = x & 0xf;
    if (d > 9) flagOverflow();
    out += d * mul;
    mul *= 10;
    x >>>= 4;
  }
  return wrapInt(out);
}

function toBcd(v: number): number {
  if (v < 0 || v > 99999999) {
    flagOverflow();
    return 0;
  }
  let out = 0;
  let shift = 0;
  let x = v;
  while (x > 0) {
    out |= (x % 10) << shift;
    x = Math.floor(x / 10);
    shift += 4;
  }
  return out | 0;
}

/** Real-math guard: flag overflow when finite operands produced a non-finite result. */
function realResult(r: number, a: number, b: number): number {
  const f = Math.fround(r);
  if (!Number.isFinite(f) && Number.isFinite(a) && Number.isFinite(b)) flagOverflow();
  return f;
}

function compileInt(n: Node): Fn {
  switch (n.k) {
    case 'num': {
      const v = n.v | 0;
      return () => v;
    }
    case 'ref': {
      const s = n.src;
      return () => s.readN();
    }
    case 'un': {
      const a = compileInt(n.a);
      return n.op === '-' ? () => wrapInt(-a()) : () => ~a();
    }
    case 'fn': {
      const a = compileInt(n.a);
      switch (n.name) {
        case 'ABS':
          return () => wrapInt(Math.abs(a()));
        case 'FRD':
          return () => fromBcd(a());
        case 'TOD':
          return () => toBcd(a());
        default: // TRN / TRUNC on an integer is the identity
          return a;
      }
    }
    case 'bin': {
      const a = compileInt(n.a);
      const b = compileInt(n.b);
      switch (n.op) {
        case '+':
          return () => wrapInt(a() + b());
        case '-':
          return () => wrapInt(a() - b());
        case '*':
          return () => {
            const x = a();
            const y = b();
            const p = x * y;
            if (p > DINT_MAX || p < DINT_MIN) {
              flagOverflow();
              return Math.imul(x, y);
            }
            return p;
          };
        case '/':
          return () => {
            const x = a();
            const y = b();
            if (y === 0) {
              flagOverflow();
              return x;
            }
            return wrapInt(Math.trunc(x / y));
          };
        case 'MOD':
          return () => {
            const x = a();
            const y = b();
            if (y === 0) {
              flagOverflow();
              return x;
            }
            return x % y | 0;
          };
        case 'AND':
          return () => a() & b();
        case 'OR':
          return () => a() | b();
        case 'XOR':
          return () => a() ^ b();
        default:
          return compareFn(n.op, a, b);
      }
    }
  }
}

function compareFn(op: string, a: Fn, b: Fn): Fn {
  switch (op) {
    case '=':
      return () => (a() === b() ? 1 : 0);
    case '<>':
      return () => (a() !== b() ? 1 : 0);
    case '<':
      return () => (a() < b() ? 1 : 0);
    case '<=':
      return () => (a() <= b() ? 1 : 0);
    case '>':
      return () => (a() > b() ? 1 : 0);
    case '>=':
      return () => (a() >= b() ? 1 : 0);
    default:
      throw new ExpressionError(`Unsupported operator '${op}'`, 0);
  }
}

function compileReal(n: Node): Fn {
  switch (n.k) {
    case 'num': {
      const v = Math.fround(n.v);
      return () => v;
    }
    case 'ref': {
      const s = n.src;
      return () => s.readN();
    }
    case 'un': {
      const a = compileReal(n.a);
      return n.op === '-' ? () => -a() : () => ~toDint(a());
    }
    case 'fn': {
      const a = compileReal(n.a);
      const f1 = (g: (x: number) => number): Fn => () => {
        const x = a();
        return realResult(g(x), x, 0);
      };
      switch (n.name) {
        case 'ABS':
          return f1(Math.abs);
        case 'SQR':
        case 'SQRT':
          return f1((x) => Math.sqrt(Math.abs(x)));
        case 'SIN':
          return f1(Math.sin);
        case 'COS':
          return f1(Math.cos);
        case 'TAN':
          return f1(Math.tan);
        case 'ASN':
        case 'ASIN':
          return f1(Math.asin);
        case 'ACS':
        case 'ACOS':
          return f1(Math.acos);
        case 'ATN':
        case 'ATAN':
          return f1(Math.atan);
        case 'LN':
          return f1(Math.log);
        case 'LOG':
          return f1(Math.log10);
        case 'DEG':
          return f1((x) => (x * 180) / Math.PI);
        case 'RAD':
          return f1((x) => (x * Math.PI) / 180);
        case 'TRN':
        case 'TRUNC':
          return f1(Math.trunc);
        case 'FRD':
          return () => fromBcd(toDint(a()));
        case 'TOD':
          return () => toBcd(toDint(a()));
        default:
          throw new ExpressionError(`Unknown function '${n.name}'`, 0);
      }
    }
    case 'bin': {
      const a = compileReal(n.a);
      const b = compileReal(n.b);
      const op2 = (g: (x: number, y: number) => number): Fn => () => {
        const x = a();
        const y = b();
        return realResult(g(x, y), x, y);
      };
      switch (n.op) {
        case '+':
          return op2((x, y) => x + y);
        case '-':
          return op2((x, y) => x - y);
        case '*':
          return op2((x, y) => x * y);
        case '/':
          return op2((x, y) => {
            if (y === 0) flagOverflow();
            return x / y;
          });
        case 'MOD':
          return op2((x, y) => {
            if (y === 0) {
              flagOverflow();
              return x;
            }
            return x - y * Math.trunc(x / y);
          });
        case '**':
          return op2(Math.pow);
        case 'AND':
          return () => toDint(a()) & toDint(b());
        case 'OR':
          return () => toDint(a()) | toDint(b());
        case 'XOR':
          return () => toDint(a()) ^ toDint(b());
        default:
          return compareFn(n.op, a, b);
      }
    }
  }
}

/**
 * Compile an expression. Throws `ExpressionError` for syntax errors; resolver errors
 * (undefined tags) propagate unchanged.
 */
export function compileExpression(
  text: string,
  resolve: OperandResolver,
  opts: { forceReal?: boolean } = {},
): CompiledExpression {
  const toks = tokenize(text);
  const parser = new ExprParser(toks, resolve, text.length);
  const tree = parser.parse();
  const real = opts.forceReal === true || isRealTree(tree);
  const fn = real ? compileReal(tree) : compileInt(tree);
  return {
    text,
    real,
    dynamic: isDynamicTree(tree),
    operands: parser.operands,
    hasComparison: parser.hasComparison,
    readN: fn,
  };
}
