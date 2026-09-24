/**
 * Logix data conversions and literal parsing.
 *
 * Rules (Logix 5000 "Data Conversions"):
 *  - REAL -> integer rounds to the nearest integer; an exact .5 rounds to the even integer.
 *  - A value that does not fit the destination integer width is truncated to its low-order bits
 *    (two's complement wrap) and an overflow is reported (S:V, minor fault T04:C04).
 *  - REAL values are IEEE-754 single precision (`Math.fround`).
 *
 * Conversion helpers report overflow through a module-level flag read with `takeOverflow()`
 * so hot paths don't allocate result objects.
 */
import type { AtomicType, DataTypeName } from './types';

export const DINT_MIN = -2147483648;
export const DINT_MAX = 2147483647;

let overflowFlag = false;

/** Returns (and clears) the overflow flag set by the last conversions. */
export function takeOverflow(): boolean {
  const o = overflowFlag;
  overflowFlag = false;
  return o;
}

/** Flag an overflow from outside this module (e.g. integer math). */
export function flagOverflow(): void {
  overflowFlag = true;
}

/** Round half to even (banker's rounding) as Logix does for REAL -> integer. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function toInteger(x: number, bits: 8 | 16 | 32): number {
  let r: number;
  if (Number.isInteger(x)) r = x;
  else if (Number.isFinite(x)) r = roundHalfEven(x);
  else {
    overflowFlag = true;
    return 0;
  }
  const w = bits === 32 ? r | 0 : bits === 16 ? (r << 16) >> 16 : (r << 24) >> 24;
  if (w !== r) overflowFlag = true;
  return w === 0 ? 0 : w; // normalise -0
}

export function toSint(x: number): number {
  return toInteger(x, 8);
}
export function toInt(x: number): number {
  return toInteger(x, 16);
}
export function toDint(x: number): number {
  return toInteger(x, 32);
}
export function toReal(x: number): number {
  const f = Math.fround(x);
  if (!Number.isFinite(f) && Number.isFinite(x)) overflowFlag = true;
  return f;
}

/** Convert a JS number to the storage representation of an atomic type (sets the overflow flag). */
export function convertAtomic(type: AtomicType, x: number): number | boolean {
  switch (type) {
    case 'BOOL':
      return x !== 0;
    case 'SINT':
      return toSint(x);
    case 'INT':
      return toInt(x);
    case 'DINT':
      return toDint(x);
    case 'REAL':
      return toReal(x);
  }
}

const ATOMICS: ReadonlySet<string> = new Set(['BOOL', 'SINT', 'INT', 'DINT', 'REAL']);
const INTEGERS: ReadonlySet<string> = new Set(['SINT', 'INT', 'DINT']);

export function isAtomic(t: DataTypeName): t is AtomicType {
  return ATOMICS.has(t);
}
export function isIntegerType(t: DataTypeName): boolean {
  return INTEGERS.has(t);
}
export function isNumericType(t: DataTypeName): boolean {
  return INTEGERS.has(t) || t === 'REAL';
}
/** Bit width of an integer type (0 for anything else). */
export function intWidth(t: DataTypeName): number {
  return t === 'DINT' ? 32 : t === 'INT' ? 16 : t === 'SINT' ? 8 : 0;
}
/** Storage size in bytes of an atomic numeric type (for COP byte copies). */
export function byteSize(t: DataTypeName): number {
  return t === 'SINT' ? 1 : t === 'INT' ? 2 : t === 'DINT' || t === 'REAL' ? 4 : 0;
}

export interface NumericLiteral {
  value: number;
  /** True for REAL literals (decimal point or exponent). */
  real: boolean;
}

const RE_DEC_INT = /^[+-]?\d[\d_]*$/;
const RE_REAL = /^[+-]?(?:\d[\d_]*\.\d*|\.\d+)(?:[eE][+-]?\d+)?$|^[+-]?\d[\d_]*[eE][+-]?\d+$/;
const RE_BASED = /^([+-])?(2|8|10|16)#([0-9A-Fa-f_]+)$/;

/**
 * Parse a Logix immediate value: `123`, `-4.5`, `1.5e3`, `16#FF`, `2#1010_1010`, `8#17`.
 * Returns undefined when the text is not a numeric literal.
 */
export function parseNumericLiteral(text: string): NumericLiteral | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  if (RE_DEC_INT.test(t)) {
    const v = Number(t.replace(/_/g, ''));
    return v >= DINT_MIN && v <= DINT_MAX ? { value: v, real: false } : { value: Math.fround(v), real: true };
  }
  if (RE_REAL.test(t)) return { value: Math.fround(Number(t.replace(/_/g, ''))), real: true };
  const m = RE_BASED.exec(t);
  if (m) {
    const base = Number(m[2]);
    const digits = m[3]!.replace(/_/g, '');
    if (digits === '') return undefined;
    const valid = base === 16 ? /^[0-9A-Fa-f]+$/ : base === 10 ? /^\d+$/ : base === 8 ? /^[0-7]+$/ : /^[01]+$/;
    if (!valid.test(digits)) return undefined;
    const raw = parseInt(digits, base);
    if (raw > 0xffffffff) return undefined;
    // Based literals are 32-bit patterns: 16#FFFF_FFFF is -1 as a DINT.
    let v = raw | 0;
    if (m[1] === '-') v = -v | 0;
    return { value: v, real: false };
  }
  return undefined;
}
