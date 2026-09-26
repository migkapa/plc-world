/**
 * Error types and Logix fault code texts shared by the runtime.
 *
 * - `TagError`  : static problems (undefined tag, bad member, subscript out of range for a literal index...).
 *                 Surfaced by `verify()` and by the tag database API.
 * - `PlcFault`  : runtime faults raised while logic executes. The controller turns them into a
 *                 major fault record (mode FAULTED) — see `MAJOR_FAULTS`.
 */

/** Static tag / operand resolution error. */
export class TagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagError';
  }
}

/** Runtime fault raised by an instruction; `type`/`code` follow the Logix fault tables. */
export class PlcFault extends Error {
  readonly type: number;
  readonly code: number;
  constructor(type: number, code: number, message?: string) {
    super(message ?? faultText(type, code));
    this.name = 'PlcFault';
    this.type = type;
    this.code = code;
  }
}

/** Fault texts (Logix 5000 Major, Minor and I/O Faults programming manual, 1756-PM014). */
export const FAULT_TEXT: Record<string, string> = {
  '4:4': 'Arithmetic overflow. An arithmetic instruction generated an overflow.',
  '4:16': 'Unknown instruction encountered.',
  '4:20': 'Array subscript too large, or CONTROL data type POS or LEN invalid.',
  '4:21': 'Control data type LEN or POS < 0.',
  '4:31': 'The parameters of the JSR instruction do not match those of the associated SBR or RET instruction.',
  '4:34': 'A timer instruction has a negative preset or accumulated value.',
  '4:42': 'JMP to a label that did not exist or was deleted.',
  '4:84': 'Stack overflow. Too many nested JSR calls.',
  '6:1': 'Task watchdog expired. User task has not completed in specified period of time.',
};

/** Canonical fault text for a type/code pair. */
export function faultText(type: number, code: number): string {
  return FAULT_TEXT[`${type}:${code}`] ?? `Fault type ${type} code ${code}.`;
}

/** Studio 5000 style fault id, e.g. `T04:C20`. */
export function faultId(type: number, code: number): string {
  return `T${String(type).padStart(2, '0')}:C${String(code).padStart(2, '0')}`;
}
