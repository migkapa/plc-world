/**
 * Instruction set registry: metadata for the editor palette / docs, plus executable definitions.
 */
import type { InstructionInfo } from '../types';
import { BIT_INSTRUCTIONS } from './bit';
import { COMPARE_INSTRUCTIONS } from './compare';
import { MATH_INSTRUCTIONS } from './math';
import { MOVE_INSTRUCTIONS } from './move';
import { PROGRAM_CONTROL_INSTRUCTIONS } from './programControl';
import { SPECIAL_INSTRUCTIONS } from './special';
import { TIMER_COUNTER_INSTRUCTIONS } from './timerCounter';
import type { InstructionDef } from './types';

const ALL: readonly InstructionDef[] = [
  ...BIT_INSTRUCTIONS,
  ...TIMER_COUNTER_INSTRUCTIONS,
  ...COMPARE_INSTRUCTIONS,
  ...MATH_INSTRUCTIONS,
  ...MOVE_INSTRUCTIONS,
  ...PROGRAM_CONTROL_INSTRUCTIONS,
  ...SPECIAL_INSTRUCTIONS,
];

/** Executable instruction definitions keyed by mnemonic (upper case). */
export const INSTRUCTION_DEFS: Readonly<Record<string, InstructionDef>> = Object.freeze(
  Object.fromEntries(ALL.map((d) => [d.mnemonic, d])),
);

/** Instruction metadata keyed by mnemonic (palette, tooltips, reference pages, verification). */
export const INSTRUCTIONS: Readonly<Record<string, InstructionInfo>> = INSTRUCTION_DEFS;

/** Palette categories in Studio 5000 order. */
export const INSTRUCTION_CATEGORIES: ReadonlyArray<InstructionInfo['category']> = [
  'Bit',
  'Timer/Counter',
  'Compare',
  'Compute/Math',
  'Move/Logical',
  'Program Control',
  'Special',
];

/** Case-insensitive lookup of an executable definition. */
export function getInstruction(mnemonic: string): InstructionDef | undefined {
  return INSTRUCTION_DEFS[mnemonic.toUpperCase()];
}

/** Instructions grouped by palette category. */
export function instructionsByCategory(): Record<InstructionInfo['category'], InstructionInfo[]> {
  const out = Object.fromEntries(INSTRUCTION_CATEGORIES.map((c) => [c, [] as InstructionInfo[]])) as Record<
    InstructionInfo['category'],
    InstructionInfo[]
  >;
  for (const d of ALL) out[d.category].push(d);
  return out;
}

/** True for output instructions (may end a rung or a branch leg). Unknown mnemonics return undefined. */
export function isOutputInstruction(mnemonic: string): boolean | undefined {
  const d = getInstruction(mnemonic);
  return d ? d.kind === 'output' : undefined;
}

export type { InstructionDef, OperandSpec, Runtime, ExecInstr, OperandKind } from './types';
export { CompiledOperands, OperandError, compileOperand, compileOperandsFor, operandCountIssue, specAt, MSG } from './operands';
export type { CompileEnv, COperand, OperandIssue } from './operands';
