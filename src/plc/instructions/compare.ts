/**
 * Compare instructions: EQU NEQ LES LEQ GRT GEQ LIM MEQ CMP.
 * All are input instructions: rung-condition-out = rung-condition-in AND comparison.
 * When either value is REAL the comparison is done in REAL (single precision), like Logix.
 */
import type { NumSource } from '../expression';
import type { InstructionDef, OperandSpec } from './types';

const num = (name: string): OperandSpec => ({ name, types: ['ANY_NUM', 'IMMEDIATE'], kind: 'num' });
const int = (name: string): OperandSpec => ({ name, types: ['ANY_INT', 'IMMEDIATE'], kind: 'int' });

type Test2 = (a: number, b: number) => boolean;

function safely(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}

function realPair(a: NumSource, b: NumSource): boolean {
  return a.real || b.real;
}

function compare2(mnemonic: string, name: string, summary: string, symbol: string, test: Test2): InstructionDef {
  return {
    mnemonic,
    name,
    category: 'Compare',
    kind: 'input',
    display: 'box',
    operands: [num('Source A'), num('Source B')],
    summary,
    details: `**${name}** — true when **Source A ${symbol} Source B**.

- Rung-condition-in true: rung-condition-out = (Source A ${symbol} Source B).
- Rung-condition-in false or prescan: rung-condition-out false.
- Sources can be SINT, INT, DINT, REAL tags or immediate values. With a REAL operand the comparison is done
  in REAL — be careful comparing REALs for exact equality.

\`\`\`
${mnemonic}(Tank_Level,${mnemonic === 'EQU' || mnemonic === 'NEQ' ? '0' : '85.0'})OTE(${mnemonic === 'EQU' ? 'Tank_Empty' : 'Level_Alarm'});
\`\`\``,
    costUs: 0.1,
    compile(ops) {
      const a = ops.num(0);
      const b = ops.num(1);
      const real = realPair(a, b);
      const evalNow = real
        ? () => test(Math.fround(a.readN()), Math.fround(b.readN()))
        : () => test(a.readN(), b.readN());
      const dynamic = a.dynamic === true || b.dynamic === true;
      const monitor = () => safely(evalNow);
      return {
        exec(rci, live) {
          if (rci) {
            const v = evalNow();
            live.active = v;
            return v;
          }
          live.active = dynamic ? monitor() : evalNow();
          return false;
        },
        monitor,
      };
    },
  };
}

export const EQU = compare2('EQU', 'Equal', 'Condition: true when Source A = Source B.', '=', (a, b) => a === b);
export const NEQ = compare2('NEQ', 'Not Equal', 'Condition: true when Source A ≠ Source B.', '≠', (a, b) => a !== b);
export const LES = compare2('LES', 'Less Than', 'Condition: true when Source A < Source B.', '<', (a, b) => a < b);
export const LEQ = compare2('LEQ', 'Less Than or Equal', 'Condition: true when Source A ≤ Source B.', '≤', (a, b) => a <= b);
export const GRT = compare2('GRT', 'Greater Than', 'Condition: true when Source A > Source B.', '>', (a, b) => a > b);
export const GEQ = compare2('GEQ', 'Greater Than or Equal', 'Condition: true when Source A ≥ Source B.', '≥', (a, b) => a >= b);

export const LIM: InstructionDef = {
  mnemonic: 'LIM',
  name: 'Limit Test',
  category: 'Compare',
  kind: 'input',
  display: 'box',
  operands: [num('Low Limit'), num('Test'), num('High Limit')],
  summary: 'Condition: true when Test is within the limits (inclusive).',
  details: `**Limit Test** checks whether a value is inside (or outside) a band.

- Low Limit ≤ High Limit: true when **Low Limit ≤ Test ≤ High Limit**.
- Low Limit > High Limit: true when **Test ≥ Low Limit or Test ≤ High Limit** (outside the band).
- Rung-condition-in false or prescan: rung-condition-out false.

\`\`\`
LIM(60.0,TT_101,80.0)OTE(Temp_In_Band);
\`\`\``,
  costUs: 0.14,
  compile(ops) {
    const lo = ops.num(0);
    const t = ops.num(1);
    const hi = ops.num(2);
    const real = lo.real || t.real || hi.real;
    const rd = (s: NumSource): number => (real ? Math.fround(s.readN()) : s.readN());
    const evalNow = (): boolean => {
      const l = rd(lo);
      const v = rd(t);
      const h = rd(hi);
      return l <= h ? v >= l && v <= h : v >= l || v <= h;
    };
    const dynamic = lo.dynamic === true || t.dynamic === true || hi.dynamic === true;
    const monitor = () => safely(evalNow);
    return {
      exec(rci, live) {
        if (rci) {
          const v = evalNow();
          live.active = v;
          return v;
        }
        live.active = dynamic ? monitor() : evalNow();
        return false;
      },
      monitor,
    };
  },
};

export const MEQ: InstructionDef = {
  mnemonic: 'MEQ',
  name: 'Mask Equal',
  category: 'Compare',
  kind: 'input',
  display: 'box',
  operands: [int('Source'), int('Mask'), int('Compare')],
  summary: 'Condition: true when (Source AND Mask) = (Compare AND Mask).',
  details: `**Mask Equal** compares only the bits selected by the mask.

- Rung-condition-in true: rung-condition-out = ((Source AND Mask) = (Compare AND Mask)).
- A mask bit of 1 means "compare this bit"; 0 means "ignore".

\`\`\`
MEQ(Local:1:I.Data,16#000F,2#0101)OTE(Pattern_Found);
\`\`\``,
  costUs: 0.12,
  compile(ops) {
    const s = ops.num(0);
    const m = ops.num(1);
    const c = ops.num(2);
    const evalNow = (): boolean => {
      const mask = m.readN();
      return (s.readN() & mask) === (c.readN() & mask);
    };
    const dynamic = s.dynamic === true || m.dynamic === true || c.dynamic === true;
    const monitor = () => safely(evalNow);
    return {
      exec(rci, live) {
        if (rci) {
          const v = evalNow();
          live.active = v;
          return v;
        }
        live.active = dynamic ? monitor() : evalNow();
        return false;
      },
      monitor,
    };
  },
};

export const CMP: InstructionDef = {
  mnemonic: 'CMP',
  name: 'Compare',
  category: 'Compare',
  kind: 'input',
  display: 'box',
  operands: [{ name: 'Expression', types: ['EXPRESSION'], kind: 'expr' }],
  summary: 'Condition: evaluates an expression such as (A + B) > C * 2.',
  details: `**Compare** evaluates an expression and is true when the result is non-zero (a true comparison).

Operators: \`+ - * / MOD ** AND OR XOR NOT = <> < <= > >=\`, functions \`ABS SQR SIN COS TAN LN LOG TRN\`,
parentheses, tags and literals (\`123\`, \`1.5e3\`, \`16#FF\`, \`2#1010\`).

- Rung-condition-in true: rung-condition-out = (expression ≠ 0).
- Rung-condition-in false or prescan: rung-condition-out false.

\`\`\`
CMP((Level_A + Level_B) / 2 >= Setpoint)OTE(Avg_High);
\`\`\``,
  costUs: 0.6,
  compile(ops) {
    const e = ops.expr(0);
    const evalNow = (): boolean => e.readN() !== 0;
    const monitor = () => safely(evalNow);
    return {
      exec(rci, live) {
        if (rci) {
          const v = evalNow();
          live.active = v;
          return v;
        }
        live.active = monitor();
        return false;
      },
      monitor,
    };
  },
};

export const COMPARE_INSTRUCTIONS: readonly InstructionDef[] = [EQU, NEQ, LES, LEQ, GRT, GEQ, LIM, MEQ, CMP];
