/**
 * Operand checking & compilation shared by the runtime compiler and `verify()`, so that what
 * verifies is exactly what runs. Messages follow Studio 5000's verification wording.
 */
import { isIntegerType, isNumericType, parseNumericLiteral } from '../convert';
import { ExpressionError, compileExpression, type CompiledExpression, type NumSource } from '../expression';
import { TagError } from '../errors';
import type { LogixTagDatabase, OperandRef } from '../tags';
import type { InstructionNode } from '../types';
import type { InstructionDef, OperandSpec } from './types';

export type COperand =
  | { k: 'ref'; ref: OperandRef }
  | { k: 'lit'; value: number; real: boolean }
  | { k: 'name'; name: string }
  | { k: 'expr'; expr: CompiledExpression }
  | { k: 'none' };

/** Operand problem found while compiling (becomes a verification error). */
export class OperandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperandError';
  }
}

export const MSG = {
  missing: "Missing operand: '?' must be replaced with a tag or value.",
  type: 'Invalid data type. Argument must match parameter data type.',
  kind: 'Invalid kind of operand or argument i.e. tag, literal, or expression.',
  constant: (tag: string) => `Tag '${tag}' is a constant and cannot be written by logic.`,
  immediate: (text: string) => `Invalid immediate value '${text}': an integer literal is required.`,
} as const;

/** Resolution context for one routine. */
export interface CompileEnv {
  readonly db: LogixTagDatabase;
  readonly program: string | undefined;
  hasRoutine(name: string): boolean;
  hasLabel(name: string): boolean;
}

const RE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function resolveRef(env: CompileEnv, text: string): OperandRef {
  try {
    return env.db.ref(text, env.program);
  } catch (e) {
    throw new OperandError(e instanceof Error ? e.message : String(e));
  }
}

function numericResolver(env: CompileEnv): (op: string) => NumSource {
  return (op) => {
    const r = env.db.ref(op, env.program);
    if (r.dims !== undefined || !(r.type === 'BOOL' || isNumericType(r.type))) {
      throw new TagError(`'${op}' is not a BOOL or numeric operand.`);
    }
    return r;
  };
}

/** Check and compile one operand text against its specification. */
export function compileOperand(spec: OperandSpec, text: string, env: CompileEnv, forceReal = false): COperand {
  const t = text.trim();
  if (t === '?' || t === '') {
    if (spec.kind === 'display') return { k: 'none' };
    throw new OperandError(MSG.missing);
  }
  switch (spec.kind) {
    case 'routine':
      if (!RE_IDENT.test(t)) throw new OperandError(`Invalid routine name '${t}'.`);
      if (!env.hasRoutine(t)) throw new OperandError(`Undefined routine '${t}'.`);
      return { k: 'name', name: t };
    case 'label':
      if (!RE_IDENT.test(t)) throw new OperandError(`Invalid label name '${t}'.`);
      if (!spec.dest && !env.hasLabel(t)) throw new OperandError(`Label '${t}' is not defined in this routine.`);
      return { k: 'name', name: t };
    case 'expr':
      try {
        return { k: 'expr', expr: compileExpression(t, numericResolver(env), { forceReal }) };
      } catch (e) {
        if (e instanceof ExpressionError) throw new OperandError(`Invalid expression: ${e.message}.`);
        throw new OperandError(e instanceof Error ? e.message : String(e));
      }
    case 'display':
    case 'imm': {
      const lit = parseNumericLiteral(t);
      if (!lit || lit.real) throw new OperandError(MSG.immediate(t));
      return { k: 'lit', value: lit.value, real: false };
    }
    default:
      break;
  }

  const lit = parseNumericLiteral(t);
  if (lit) {
    if (spec.kind === 'num' || spec.kind === 'scalar') return { k: 'lit', value: lit.value, real: lit.real };
    if (spec.kind === 'int') {
      if (lit.real) throw new OperandError(MSG.type);
      return { k: 'lit', value: lit.value, real: false };
    }
    throw new OperandError(MSG.kind);
  }

  const ref = resolveRef(env, t);
  const scalar = ref.dims === undefined;
  const writes = spec.dest === true;
  switch (spec.kind) {
    case 'bit':
    case 'bitDest':
      if (ref.type !== 'BOOL' || !scalar) throw new OperandError(MSG.type);
      break;
    case 'num':
    case 'numDest':
      if (!isNumericType(ref.type) || !scalar) throw new OperandError(MSG.type);
      break;
    case 'int':
    case 'intDest':
      if (!isIntegerType(ref.type) || !scalar) throw new OperandError(MSG.type);
      break;
    case 'scalar':
    case 'scalarDest':
      if (!(ref.type === 'BOOL' || isNumericType(ref.type)) || !scalar) throw new OperandError(MSG.type);
      break;
    case 'struct': {
      const ok = scalar && !ref.isBit && spec.types.some((ty) => ty.toUpperCase() === ref.type.toUpperCase());
      if (!ok) throw new OperandError(MSG.type);
      break;
    }
    case 'array':
      if (!ref.array || ref.isBit) throw new OperandError(`${MSG.type} An array element (e.g. MyArray[0]) is required.`);
      if (spec.elem && !spec.elem.some((e) => e.toUpperCase() === ref.array!.elemType.toUpperCase())) {
        throw new OperandError(MSG.type);
      }
      break;
    case 'any':
      if (ref.isBit) throw new OperandError(MSG.type);
      break;
    default:
      throw new OperandError(MSG.kind);
  }
  const destKind = spec.kind === 'bitDest' || spec.kind === 'numDest' || spec.kind === 'intDest' || spec.kind === 'scalarDest';
  if ((writes || destKind) && ref.constant) {
    throw new OperandError(MSG.constant(ref.path));
  }
  return { k: 'ref', ref };
}

/** Typed access to an instruction's compiled operands. */
export class CompiledOperands {
  readonly items: readonly COperand[];
  readonly texts: readonly string[];

  constructor(items: readonly COperand[], texts: readonly string[]) {
    this.items = items;
    this.texts = texts;
  }

  get count(): number {
    return this.items.length;
  }

  /** Tag operand accessor (bit, numeric, structure, array). */
  ref(i: number): OperandRef {
    const it = this.items[i];
    if (it?.k !== 'ref') throw new OperandError(`Operand ${i}: a tag is required.`);
    return it.ref;
  }

  /** Numeric source: tag or immediate. */
  num(i: number): NumSource {
    const it = this.items[i];
    if (it?.k === 'ref') return it.ref;
    if (it?.k === 'lit') {
      const v = it.value;
      return { readN: () => v, real: it.real, dynamic: false };
    }
    throw new OperandError(`Operand ${i}: a tag or immediate value is required.`);
  }

  /** Immediate literal value (undefined for '?' or tags). */
  literal(i: number): number | undefined {
    const it = this.items[i];
    return it?.k === 'lit' ? it.value : undefined;
  }

  /** Getter for a structure operand (constant-time for statically addressed tags). */
  struct<T>(i: number): () => T {
    const r = this.ref(i);
    if (!r.dynamic) {
      const v = r.value() as unknown as T;
      return () => v;
    }
    return () => r.value() as unknown as T;
  }

  name(i: number): string {
    const it = this.items[i];
    if (it?.k !== 'name') throw new OperandError(`Operand ${i}: a name is required.`);
    return it.name;
  }

  expr(i: number): CompiledExpression {
    const it = this.items[i];
    if (it?.k !== 'expr') throw new OperandError(`Operand ${i}: an expression is required.`);
    return it.expr;
  }
}

/** One operand-level issue (operandIndex undefined = instruction-level). */
export interface OperandIssue {
  operandIndex?: number;
  message: string;
}

/** Operand specification for position `i` of an instruction. */
export function specAt(def: InstructionDef, i: number, texts: readonly string[]): OperandSpec | undefined {
  return def.specFor ? def.specFor(i, texts) : (def.operands[i] ?? def.variadic);
}

/** Operand count problem, if any. */
export function operandCountIssue(def: InstructionDef, n: number): string | undefined {
  const min = def.minOperands ?? def.operands.length;
  const max = def.variadic ? Infinity : def.operands.length;
  if (n >= min && n <= max) return undefined;
  const expected = min === max ? String(min) : max === Infinity ? `at least ${min}` : `${min} to ${max}`;
  return `${def.mnemonic}: Wrong number of operands (expected ${expected}, found ${n}).`;
}

/**
 * Compile all operands of an instruction. Returns the compiled operands when every operand is
 * valid, plus the list of issues found (one per bad operand).
 */
export function compileOperandsFor(
  def: InstructionDef,
  node: InstructionNode,
  env: CompileEnv,
): { ops: CompiledOperands | undefined; issues: OperandIssue[] } {
  const issues: OperandIssue[] = [];
  const countIssue = operandCountIssue(def, node.operands.length);
  if (countIssue) return { ops: undefined, issues: [{ message: countIssue }] };
  const items: COperand[] = new Array<COperand>(node.operands.length);
  const pendingExpr: number[] = [];
  node.operands.forEach((text, i) => {
    const spec = specAt(def, i, node.operands);
    if (!spec) {
      issues.push({ operandIndex: i, message: `${def.mnemonic}, Operand ${i}: Unexpected operand.` });
      return;
    }
    if (spec.kind === 'expr') {
      pendingExpr.push(i);
      return;
    }
    try {
      items[i] = compileOperand(spec, text, env);
    } catch (e) {
      issues.push({ operandIndex: i, message: `${def.mnemonic}, Operand ${i}: ${e instanceof Error ? e.message : String(e)}` });
    }
  });
  for (const i of pendingExpr) {
    const spec = specAt(def, i, node.operands)!;
    const destIt = spec.realWithDest !== undefined ? items[spec.realWithDest] : undefined;
    const forceReal = destIt?.k === 'ref' && destIt.ref.type === 'REAL';
    try {
      items[i] = compileOperand(spec, node.operands[i]!, env, forceReal);
    } catch (e) {
      issues.push({ operandIndex: i, message: `${def.mnemonic}, Operand ${i}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return { ops: issues.length === 0 ? new CompiledOperands(items, node.operands) : undefined, issues };
}
