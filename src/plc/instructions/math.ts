/**
 * Compute/Math instructions: ADD SUB MUL DIV MOD NEG ABS SQR CPT SCP.
 *
 * "Optimal data type": when any source or the destination is REAL the operation is performed in
 * REAL (single precision); otherwise in DINT (SINT/INT are sign-extended). Integer overflow wraps
 * (two's complement), sets S:V and logs minor fault T04:C04. Storing the result converts to the
 * destination type (REAL → integer rounds half to even; too-large values truncate + overflow).
 */
import { DINT_MAX, DINT_MIN, flagOverflow, takeOverflow } from '../convert';
import type { NumSource } from '../expression';
import type { InstructionDef, OperandSpec } from './types';

const num = (name: string): OperandSpec => ({ name, types: ['ANY_NUM', 'IMMEDIATE'], kind: 'num' });
const dest = (name = 'Dest'): OperandSpec => ({ name, types: ['SINT', 'INT', 'DINT', 'REAL'], kind: 'numDest', dest: true });

/** DINT result of integer math: wraps and flags overflow when out of range. */
export function intResult(x: number): number {
  if (x > DINT_MAX || x < DINT_MIN) {
    flagOverflow();
    return x | 0;
  }
  return x;
}

/** REAL result: single precision, flags overflow when finite inputs produce a non-finite result. */
export function realResult(r: number, ...inputs: number[]): number {
  const f = Math.fround(r);
  if (!Number.isFinite(f) && inputs.every(Number.isFinite)) flagOverflow();
  return f;
}

type Op2 = (a: number, b: number) => number;

const INT_OPS: Record<string, Op2> = {
  ADD: (a, b) => intResult(a + b),
  SUB: (a, b) => intResult(a - b),
  MUL: (a, b) => {
    const p = a * b;
    if (p > DINT_MAX || p < DINT_MIN) {
      flagOverflow();
      return Math.imul(a, b);
    }
    return p;
  },
  DIV: (a, b) => {
    if (b === 0) {
      flagOverflow();
      return a;
    }
    return intResult(Math.trunc(a / b));
  },
  MOD: (a, b) => {
    if (b === 0) {
      flagOverflow();
      return a;
    }
    return a % b | 0;
  },
};

const REAL_OPS: Record<string, Op2> = {
  ADD: (a, b) => realResult(a + b, a, b),
  SUB: (a, b) => realResult(a - b, a, b),
  MUL: (a, b) => realResult(a * b, a, b),
  DIV: (a, b) => {
    if (b === 0) flagOverflow();
    return Math.fround(a / b);
  },
  MOD: (a, b) => {
    if (b === 0) {
      flagOverflow();
      return a;
    }
    return realResult(a - b * Math.trunc(a / b), a, b);
  },
};

const MATH_TEXT: Record<string, { name: string; formula: string; example: string; extra?: string }> = {
  ADD: { name: 'Add', formula: 'Dest = Source A + Source B', example: 'XIC(PE_Exit)ONS(PE_Exit_ONS)ADD(Total_Boxes,1,Total_Boxes);' },
  SUB: { name: 'Subtract', formula: 'Dest = Source A − Source B', example: 'SUB(Setpoint,Level,Level_Error);' },
  MUL: { name: 'Multiply', formula: 'Dest = Source A × Source B', example: 'MUL(Speed_Pct,17.5,Motor_Rpm);' },
  DIV: {
    name: 'Divide',
    formula: 'Dest = Source A ÷ Source B',
    example: 'DIV(Total_Ms,1000,Total_Sec);',
    extra: `With all-integer operands the quotient is **truncated** (7 ÷ 2 = 3). With a REAL operand or destination the
division is done in REAL and rounded when stored to an integer. Dividing by zero sets S:V and logs minor fault
T04:C04; the destination gets Source A (integers) or ±∞ / NaN (REAL).`,
  },
  MOD: {
    name: 'Modulo',
    formula: 'Dest = Source A − (Source B × TRN(Source A ÷ Source B))',
    example: 'MOD(Step_Counter,4,Phase);',
    extra: 'The remainder takes the sign of Source A. Modulo by zero sets S:V and logs minor fault T04:C04.',
  },
};

function math2(mnemonic: 'ADD' | 'SUB' | 'MUL' | 'DIV' | 'MOD'): InstructionDef {
  const txt = MATH_TEXT[mnemonic]!;
  const intOp = INT_OPS[mnemonic]!;
  const realOp = REAL_OPS[mnemonic]!;
  return {
    mnemonic,
    name: txt.name,
    category: 'Compute/Math',
    kind: 'output',
    display: 'box',
    operands: [num('Source A'), num('Source B'), dest()],
    summary: `Output: ${txt.formula}.`,
    details: `**${txt.name}** — when the rung is true: **${txt.formula}**.

- Rung-condition-in false or prescan: no action. Rung-condition-out follows rung-condition-in.
- Arithmetic status flags S:N, S:Z and S:V are updated; overflow logs minor fault **T04:C04** and wraps.
${txt.extra ? `\n${txt.extra}\n` : ''}
Math instructions execute on **every** scan the rung is true — add a one-shot (ONS) to do it once per event.

\`\`\`
${txt.example}
\`\`\``,
    costUs: 0.15,
    compile(ops, rt) {
      const a = ops.num(0);
      const b = ops.num(1);
      const d = ops.ref(2);
      const op = a.real || b.real || d.real ? realOp : intOp;
      return {
        exec(rci) {
          if (rci) {
            takeOverflow();
            d.writeN(op(a.readN(), b.readN()));
            rt.arith(d.readN(), takeOverflow());
          }
          return rci;
        },
      };
    },
  };
}

export const ADD = math2('ADD');
export const SUB = math2('SUB');
export const MUL = math2('MUL');
export const DIV = math2('DIV');
export const MOD = math2('MOD');

function math1(
  mnemonic: string,
  name: string,
  formula: string,
  details: string,
  fn: (x: number, real: boolean) => number,
  alwaysReal = false,
): InstructionDef {
  return {
    mnemonic,
    name,
    category: 'Compute/Math',
    kind: 'output',
    display: 'box',
    operands: [num('Source'), dest()],
    summary: `Output: ${formula}.`,
    details,
    costUs: 0.12,
    compile(ops, rt) {
      const s = ops.num(0);
      const d = ops.ref(1);
      const real = alwaysReal || s.real || d.real;
      return {
        exec(rci) {
          if (rci) {
            takeOverflow();
            d.writeN(fn(s.readN(), real));
            rt.arith(d.readN(), takeOverflow());
          }
          return rci;
        },
      };
    },
  };
}

export const NEG = math1(
  'NEG',
  'Negate',
  'Dest = 0 − Source',
  `**Negate** changes the sign of the source: **Dest = −Source**.

Negating -2,147,483,648 (DINT) overflows (S:V, minor fault T04:C04).

\`\`\`
NEG(Offset,Neg_Offset);
\`\`\``,
  (x, real) => (real ? Math.fround(-x) : intResult(-x)),
);

export const ABS = math1(
  'ABS',
  'Absolute Value',
  'Dest = |Source|',
  `**Absolute Value**: **Dest = |Source|**.

\`\`\`
SUB(Setpoint,Actual,Error)ABS(Error,Abs_Error);
\`\`\``,
  (x, real) => (real ? Math.fround(Math.abs(x)) : intResult(Math.abs(x))),
);

export const SQR: InstructionDef = math1(
  'SQR',
  'Square Root',
  'Dest = √Source',
  `**Square Root**: **Dest = √Source**. A negative source uses its absolute value.
An integer destination receives the rounded result (√10 → 3).

\`\`\`
SQR(Diff_Pressure,Flow_Raw);
\`\`\``,
  (x) => Math.fround(Math.sqrt(Math.abs(x))),
  true,
);

export const CPT: InstructionDef = {
  mnemonic: 'CPT',
  name: 'Compute',
  category: 'Compute/Math',
  kind: 'output',
  display: 'box',
  operands: [dest('Dest'), { name: 'Expression', types: ['EXPRESSION'], kind: 'expr', realWithDest: 0 }],
  summary: 'Output: Dest = result of an expression, e.g. (A + B) * 2.',
  details: `**Compute** evaluates a whole expression in one instruction.

Operators: \`+ - * / MOD **\` and bitwise \`AND OR XOR NOT\`; functions \`ABS SQR SIN COS TAN ASN ACS ATN LN LOG
DEG RAD TRN FRD TOD\`; parentheses; tags and literals (\`123\`, \`-4.5\`, \`1.5e3\`, \`16#FF\`, \`2#1010_1010\`).

The expression is evaluated in REAL when any operand (or Dest) is REAL, otherwise in DINT (integer division truncates).
S:N, S:Z, S:V are updated; overflow logs minor fault T04:C04.

\`\`\`
CPT(Tank_Volume_L,Level_Pct * 20.0);
CPT(Avg,(T1 + T2 + T3) / 3);
\`\`\``,
  costUs: 0.8,
  compile(ops, rt) {
    const d = ops.ref(0);
    const e = ops.expr(1);
    return {
      exec(rci) {
        if (rci) {
          takeOverflow();
          d.writeN(e.readN());
          rt.arith(d.readN(), takeOverflow());
        }
        return rci;
      },
    };
  },
};

export const SCP: InstructionDef = {
  mnemonic: 'SCP',
  name: 'Scale with Parameters',
  category: 'Compute/Math',
  kind: 'output',
  display: 'box',
  operands: [num('Input'), num('Input Min'), num('Input Max'), num('Scaled Min'), num('Scaled Max'), dest('Output')],
  summary: 'Output: linearly scales Input from [Input Min, Input Max] to [Scaled Min, Scaled Max].',
  details: `**Scale with Parameters** converts a value from one range to another (raw counts → %, % → rpm…):

**Output = (Input − Input Min) × (Scaled Max − Scaled Min) ÷ (Input Max − Input Min) + Scaled Min**

The result is not clamped — an input outside its range extrapolates. Input Max = Input Min logs minor
fault T04:C04 and outputs Scaled Min.

\`\`\`
SCP(Pot_1,0.0,100.0,0.0,1750.0,Speed_Ref_Rpm);
\`\`\``,
  costUs: 0.3,
  compile(ops, rt) {
    const src: NumSource[] = [0, 1, 2, 3, 4].map((i) => ops.num(i));
    const [inp, inMin, inMax, sMin, sMax] = src as [NumSource, NumSource, NumSource, NumSource, NumSource];
    const out = ops.ref(5);
    return {
      exec(rci) {
        if (rci) {
          takeOverflow();
          const x0 = inMin.readN();
          const x1 = inMax.readN();
          const y0 = sMin.readN();
          const y1 = sMax.readN();
          let r: number;
          if (x1 === x0) {
            flagOverflow();
            r = y0;
          } else {
            const x = inp.readN();
            r = realResult(((x - x0) * (y1 - y0)) / (x1 - x0) + y0, x, x0, x1, y0, y1);
          }
          out.writeN(r);
          rt.arith(out.readN(), takeOverflow());
        }
        return rci;
      },
    };
  },
};

export const MATH_INSTRUCTIONS: readonly InstructionDef[] = [ADD, SUB, MUL, DIV, MOD, NEG, ABS, SQR, CPT, SCP];
