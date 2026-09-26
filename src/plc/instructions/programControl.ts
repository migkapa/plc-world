/**
 * Program control instructions: JSR SBR RET JMP LBL AFI NOP TND MCR.
 */
import { parseNumericLiteral } from '../convert';
import type { NumSource } from '../expression';
import type { OperandRef } from '../tags';
import { OperandError } from './operands';
import type { InstructionDef, OperandSpec } from './types';

const ROUTINE: OperandSpec = { name: 'Routine Name', types: ['ROUTINE'], kind: 'routine' };
const INPUT_COUNT: OperandSpec = { name: 'Input Count', types: ['IMMEDIATE'], kind: 'imm' };
const INPUT_PAR: OperandSpec = { name: 'Input Par', types: ['BOOL', 'ANY_NUM', 'IMMEDIATE'], kind: 'scalar' };
const RETURN_PAR: OperandSpec = { name: 'Return Par', types: ['BOOL', 'ANY_NUM'], kind: 'scalarDest', dest: true };

export const JSR: InstructionDef = {
  mnemonic: 'JSR',
  name: 'Jump to Subroutine',
  category: 'Program Control',
  kind: 'output',
  display: 'box',
  operands: [ROUTINE, INPUT_COUNT],
  minOperands: 1,
  variadic: INPUT_PAR,
  specFor(i, texts) {
    if (i === 0) return ROUTINE;
    if (i === 1) return INPUT_COUNT;
    const nIn = parseNumericLiteral(texts[1] ?? '0')?.value ?? 0;
    return i - 2 < nIn ? INPUT_PAR : RETURN_PAR;
  },
  summary: 'Output: when the rung is true, executes another routine of the same program, then continues.',
  details: `**Jump to Subroutine** runs a routine and returns to the instruction after the JSR.

- Rung-condition-in true: the routine executes (all its rungs, until the end or a RET), then execution
  continues on this rung.
- Rung-condition-in false: the routine is **not scanned** — its outputs keep their last state!
- Prescan: the subroutine is prescanned once.

Neutral text: \`JSR(Routine,InputCount,Input1…,Return1…)\`. Without parameters the input count is 0:

\`\`\`
XIC(Auto_Mode)JSR(Auto_Sequence,0);
\`\`\`

Nesting too deep (e.g. a routine calling itself) causes major fault T04:C84 (stack overflow).`,
  costUs: 0.4,
  compile(ops, rt) {
    const routine = ops.name(0);
    const nIn = ops.count >= 2 ? (ops.literal(1) ?? 0) : 0;
    if (nIn < 0 || (ops.count >= 2 && 2 + nIn > ops.count)) {
      throw new OperandError(`JSR, Operand 1: Input count ${nIn} does not match the ${Math.max(0, ops.count - 2)} parameter(s) given.`);
    }
    const inputs: NumSource[] = [];
    const returns: OperandRef[] = [];
    for (let i = 2; i < ops.count; i++) {
      if (i - 2 < nIn) inputs.push(ops.num(i));
      else returns.push(ops.ref(i));
    }
    const values = new Array<number>(inputs.length).fill(0);
    return {
      exec(rci) {
        if (rci) {
          for (let i = 0; i < inputs.length; i++) values[i] = inputs[i]!.readN();
          rt.jsr(routine, values, returns);
        }
        return rci;
      },
      prescan: () => rt.prescanRoutine(routine),
    };
  },
};

export const SBR: InstructionDef = {
  mnemonic: 'SBR',
  name: 'Subroutine',
  category: 'Program Control',
  kind: 'output',
  display: 'box',
  operands: [],
  variadic: { name: 'Input Par', types: ['BOOL', 'ANY_NUM'], kind: 'scalarDest', dest: true },
  summary: 'First instruction of a subroutine: receives the JSR input parameters.',
  details: `**Subroutine** must be the first instruction of a subroutine that receives parameters. It copies the
JSR input parameters into its own operands (in order). The number must match the JSR (fault T04:C31).

\`\`\`
SBR(Recipe_Index)MOV(Recipes[Recipe_Index].Setpoint,Setpoint);
\`\`\``,
  costUs: 0.2,
  compile(ops, rt) {
    const params: OperandRef[] = [];
    for (let i = 0; i < ops.count; i++) params.push(ops.ref(i));
    return {
      exec(rci) {
        if (rci) rt.sbr(params);
        return rci;
      },
    };
  },
};

export const RET: InstructionDef = {
  mnemonic: 'RET',
  name: 'Return',
  category: 'Program Control',
  kind: 'output',
  display: 'box',
  operands: [],
  variadic: { name: 'Return Par', types: ['BOOL', 'ANY_NUM', 'IMMEDIATE'], kind: 'scalar' },
  summary: 'Output: when true, ends the current routine and returns to the calling JSR.',
  details: `**Return** ends a subroutine early (the remaining rungs are not scanned this time) and hands optional
return values back to the JSR's return parameters. Without a RET the routine returns after its last rung.

\`\`\`
XIO(Sequence_Enabled)RET();
\`\`\``,
  costUs: 0.15,
  compile(ops, rt) {
    const params: NumSource[] = [];
    for (let i = 0; i < ops.count; i++) params.push(ops.num(i));
    const values = new Array<number>(params.length).fill(0);
    return {
      exec(rci) {
        if (rci) {
          for (let i = 0; i < params.length; i++) values[i] = params[i]!.readN();
          rt.ret(values);
        }
        return rci;
      },
    };
  },
};

export const JMP: InstructionDef = {
  mnemonic: 'JMP',
  name: 'Jump to Label',
  category: 'Program Control',
  kind: 'output',
  display: 'coil',
  operands: [{ name: 'Label Name', types: ['LABEL'], kind: 'label' }],
  summary: 'Output: when true, skips to the rung that starts with the matching LBL.',
  details: `**Jump to Label** — when the rung is true, execution continues at the rung whose first instruction is
\`LBL(<same name>)\` in the same routine. Skipped rungs are not scanned (their outputs keep their state).

Jumping backwards creates a loop; if it never ends the task watchdog faults the controller (T06:C01).

\`\`\`
XIC(Bypass_Checks)JMP(Skip_Checks);
XIC(Guard_Closed)OTE(Checks_OK);
LBL(Skip_Checks)XIC(Run)OTE(Motor);
\`\`\``,
  costUs: 0.1,
  compile(ops, rt) {
    const label = ops.name(0);
    return {
      exec(rci) {
        if (rci) rt.jmp(label);
        return rci;
      },
    };
  },
};

export const LBL: InstructionDef = {
  mnemonic: 'LBL',
  name: 'Label',
  category: 'Program Control',
  kind: 'input',
  display: 'contact',
  operands: [{ name: 'Label Name', types: ['LABEL'], kind: 'label', dest: true }],
  summary: 'Target of a JMP. Must be the first instruction on its rung; always passes power.',
  details: `**Label** marks the destination of a **JMP**. It must be the first instruction in the rung and its name must be
unique in the routine. Logically it is always true.

\`\`\`
LBL(Skip_Checks)XIC(Run)OTE(Motor);
\`\`\``,
  costUs: 0.02,
  compile() {
    return { exec: (rci) => rci };
  },
};

export const AFI: InstructionDef = {
  mnemonic: 'AFI',
  name: 'Always False',
  category: 'Program Control',
  kind: 'input',
  display: 'contact',
  operands: [],
  summary: 'Condition: always false — used to temporarily disable a rung.',
  details: `**Always False Instruction** makes the rest of the rung false. Handy during commissioning to disable a rung
without deleting it.

\`\`\`
AFI()OTE(Test_Output);
\`\`\``,
  costUs: 0.02,
  compile() {
    return {
      exec(_rci, live) {
        live.active = false;
        return false;
      },
    };
  },
};

export const NOP: InstructionDef = {
  mnemonic: 'NOP',
  name: 'No Operation',
  category: 'Program Control',
  kind: 'output',
  display: 'box',
  operands: [],
  summary: 'Does nothing; a placeholder that passes power through.',
  details: `**No Operation** is a placeholder. Rung-condition-out = rung-condition-in.

\`\`\`
NOP();
\`\`\``,
  costUs: 0.01,
  compile() {
    return { exec: (rci) => rci };
  },
};

export const TND: InstructionDef = {
  mnemonic: 'TND',
  name: 'Temporary End',
  category: 'Program Control',
  kind: 'output',
  display: 'box',
  operands: [],
  summary: 'Output: when true, acts as the end of the current routine (debugging aid).',
  details: `**Temporary End** acts as the end of the routine when its rung is true: the rest of the rungs in this
routine are not scanned this time (their outputs keep their state).

- In a **subroutine**, control returns to the calling routine (the JSR rung finishes).
- In a program's **main routine**, control goes on to the **next program** in the task.

Used while commissioning to test a routine piece by piece.

\`\`\`
XIC(Debug_Stop)TND();
\`\`\``,
  costUs: 0.05,
  compile(_ops, rt) {
    return {
      exec(rci) {
        if (rci) rt.tnd();
        return rci;
      },
    };
  },
};

export const MCR: InstructionDef = {
  mnemonic: 'MCR',
  name: 'Master Control Reset',
  category: 'Program Control',
  kind: 'output',
  display: 'coil',
  operands: [],
  summary: 'Output: MCR pairs bound a zone; when the first MCR rung is false every rung in the zone is false.',
  details: `**Master Control Reset** instructions are used in pairs. The first MCR starts a zone, the second (unconditional)
MCR ends it. While the rung of the starting MCR is false, every rung inside the zone executes with a
false rung-condition — non-retentive outputs (OTE, TON…) turn off, OTL/OTU keep their state.

This is **not** a substitute for a hard-wired safety MCR relay.

\`\`\`
XIC(Zone_Enable)MCR();
XIC(Start)OTE(Conveyor_1);
MCR();
\`\`\``,
  costUs: 0.05,
  compile(_ops, rt) {
    return {
      exec(rci) {
        rt.mcr(rci);
        return rci;
      },
    };
  },
};

export const PROGRAM_CONTROL_INSTRUCTIONS: readonly InstructionDef[] = [JSR, SBR, RET, JMP, LBL, AFI, NOP, TND, MCR];
