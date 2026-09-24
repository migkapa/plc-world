/**
 * Internal instruction-set types: metadata (extends the public `InstructionInfo`) plus a compile
 * step that turns an instruction node into executable closures bound to resolved operands.
 */
import type { CompiledExpression } from '../expression';
import type { OperandRef } from '../tags';
import type { DataTypeName, ElementLiveState, InstructionInfo } from '../types';
import type { CompiledOperands } from './operands';

/**
 * How an operand is checked and compiled.
 *
 *  bit / bitDest    BOOL-addressable tag operand (BOOL tag, BOOL member, bit of integer)
 *  num / int        SINT/INT/DINT/REAL (int: SINT/INT/DINT) tag or immediate value
 *  numDest/intDest  writable SINT/INT/DINT/REAL (intDest: integer) tag
 *  scalar           BOOL/SINT/INT/DINT/REAL tag or immediate (JSR/RET parameters)
 *  scalarDest       writable BOOL/SINT/INT/DINT/REAL tag (JSR return / SBR parameters)
 *  struct           tag of the structure type(s) listed in `types` (TIMER, COUNTER, CONTROL)
 *  display          immediate shown in the instruction box that initialises a structure member
 *                   (TON Preset/Accum, SQO Length/Position…); '?' means "keep the tag value"
 *  imm              immediate integer
 *  array            array element / whole array (element types limited by `elem`)
 *  any              any tag (COP source/destination)
 *  routine / label  routine name (JSR) / label name (JMP, LBL)
 *  expr             expression (CPT, CMP)
 */
export type OperandKind =
  | 'bit'
  | 'bitDest'
  | 'num'
  | 'int'
  | 'numDest'
  | 'intDest'
  | 'scalar'
  | 'scalarDest'
  | 'struct'
  | 'display'
  | 'imm'
  | 'array'
  | 'any'
  | 'routine'
  | 'label'
  | 'expr';

export interface OperandSpec {
  name: string;
  types: InstructionInfo['operands'][number]['types'];
  /** Written by the instruction (for 'label': the instruction defines the label, i.e. LBL). */
  dest?: boolean;
  kind: OperandKind;
  /** For 'array' operands: allowed element types (undefined = any). */
  elem?: readonly DataTypeName[];
  /** For 'display' operands: the structure operand/member initialised from the literal. */
  init?: { operand: number; member: string; onEdit: boolean };
  /** For 'expr' operands: evaluate with REAL math when this operand index is a REAL destination. */
  realWithDest?: number;
}

/** Runtime services the engine provides to instructions. */
export interface Runtime {
  /** Simulated controller clock (ms) of the scan in progress. */
  readonly now: number;
  /** Hidden per-timer start timestamps (the "free-running clock" part of a Logix TIMER). */
  readonly timerStamps: WeakMap<object, number>;
  /**
   * Update the arithmetic status flags S:N, S:Z, S:V after an instruction that affects them.
   * An overflow also logs minor fault T04:C04 (arithmetic overflow).
   */
  arith(result: number, overflow: boolean): void;
  minorFault(type: number, code: number, message: string): void;
  majorFault(type: number, code: number, message?: string): never;
  /** Call a subroutine of the current program (JSR). */
  jsr(routine: string, inputs: readonly number[], returns: readonly OperandRef[]): void;
  /** SBR: receive the JSR input parameters. */
  sbr(params: readonly OperandRef[]): void;
  /** RET: return from the current routine (optionally with return values). */
  ret(values: readonly number[]): void;
  jmp(label: string): void;
  /** TND: end the current routine (a subroutine returns to its JSR; a main routine ends its program's scan). */
  tnd(): void;
  /** MCR: start/end a master control reset zone. */
  mcr(rci: boolean): void;
  /** Prescan a routine of the current program once (JSR prescan). */
  prescanRoutine(routine: string): void;
}

/** Executable form of one instruction. */
export interface ExecInstr {
  /**
   * Execute with the given rung-condition-in and return rung-condition-out.
   * `live.active` is preset to `rci`; instructions override it for their highlight state.
   */
  exec(rci: boolean, live: ElementLiveState): boolean;
  /** Prescan behaviour (entering Run). */
  prescan?(): void;
  /** Highlight state while logic is not executing (online monitoring in Program mode). */
  monitor?(): boolean;
}

export interface InstructionDef extends InstructionInfo {
  readonly operands: OperandSpec[];
  /** Minimum operand count when trailing operands are optional (JSR(Routine) / JSR(Routine,0)). */
  readonly minOperands?: number;
  /** Additional operands of this kind may follow (JSR/SBR/RET parameters). */
  readonly variadic?: OperandSpec;
  /** Position-dependent operand spec (JSR: inputs vs. return parameters). */
  specFor?(index: number, texts: readonly string[]): OperandSpec | undefined;
  /** Simulated execution time (µs) used for the scan-time display. */
  readonly costUs: number;
  compile(ops: CompiledOperands, rt: Runtime): ExecInstr;
}

export type { CompiledExpression, OperandRef };
