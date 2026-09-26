import { describe, expect, it } from 'vitest';
import { bool, dint, int, real, runLogic, sint } from '../testUtils';
import type { TagDef } from '../types';

function compute(rung: string, tags: TagDef[]): ReturnType<typeof runLogic> {
  const plc = runLogic([rung], tags);
  plc.scan(10);
  return plc;
}

describe('ADD / SUB / MUL / DIV / MOD', () => {
  it('does integer math when all operands are integers', () => {
    const tags = [dint('A', { initial: 7 }), dint('B', { initial: 2 }), dint('R1'), dint('R2'), dint('R3'), dint('R4'), dint('R5')];
    const plc = compute('ADD(A,B,R1)SUB(A,B,R2)MUL(A,B,R3)DIV(A,B,R4)MOD(A,B,R5);', tags);
    expect(['R1', 'R2', 'R3', 'R4', 'R5'].map((t) => plc.tags.readNumber(t))).toEqual([9, 5, 14, 3, 1]);
  });

  it('truncates integer division and rounds REAL results stored into integers', () => {
    const plc = compute('DIV(-7,2,R1)DIV(7.0,2,R2)DIV(5.0,2,R3)DIV(7,2,RealDest);', [dint('R1'), dint('R2'), dint('R3'), real('RealDest')]);
    expect(plc.tags.readNumber('R1')).toBe(-3);
    expect(plc.tags.readNumber('R2')).toBe(4); // 3.5 rounds half to even → 4
    expect(plc.tags.readNumber('R3')).toBe(2); // 2.5 → 2
    expect(plc.tags.readNumber('RealDest')).toBe(3.5); // REAL destination → REAL math
  });

  it('does REAL math in single precision', () => {
    const plc = compute('ADD(0.1,0.2,R);', [real('R')]);
    expect(plc.tags.readNumber('R')).toBe(Math.fround(Math.fround(0.1) + Math.fround(0.2)));
  });

  it('executes every scan while the rung is true (use a one-shot to count events)', () => {
    const plc = runLogic(['XIC(En)ADD(N,1,N);', 'XIC(En)ONS(Ons)ADD(M,1,M);'], [bool('En', { initial: true }), dint('N'), dint('M'), bool('Ons')]);
    for (let i = 0; i < 5; i++) plc.scan(10);
    expect(plc.tags.readNumber('N')).toBe(5);
    expect(plc.tags.readNumber('M')).toBe(0); // ONS storage set by prescan; rung true from the start
  });

  it('sets S:Z and S:N', () => {
    const plc = compute('SUB(5,5,R)XIC(S:Z)OTE(Zero)SUB(1,5,R2)XIC(S:N)OTE(Neg);', [dint('R'), dint('R2'), bool('Zero'), bool('Neg')]);
    expect(plc.tags.readBool('Zero')).toBe(true);
    expect(plc.tags.readBool('Neg')).toBe(true);
  });

  it('wraps on overflow, sets S:V and logs minor fault T04:C04 without stopping', () => {
    const plc = compute('ADD(Big,1,Big)XIC(S:V)OTE(Ovf)MUL(Word,Word,Word)OTE(Still_Running);', [
      dint('Big', { initial: 2147483647 }),
      int('Word', { initial: 300 }),
      bool('Ovf'),
      bool('Still_Running'),
    ]);
    expect(plc.tags.readNumber('Big')).toBe(-2147483648);
    expect(plc.tags.readBool('Ovf')).toBe(true);
    expect(plc.tags.readNumber('Word')).toBe(24464); // 90000 truncated to 16 bits
    expect(plc.tags.readBool('Still_Running')).toBe(true);
    const st = plc.getStatus();
    expect(st.mode).toBe('REM_RUN');
    expect(st.minorFaults.length).toBeGreaterThanOrEqual(1);
    expect(st.minorFaults[0]).toMatchObject({ type: 4, code: 4, rungIndex: 0, program: 'MainProgram' });
  });

  it('divide by zero: minor fault; integer Dest = Source A, REAL Dest = infinity', () => {
    const plc = compute('DIV(9,Zero,R1)DIV(9.0,Zero,R2)XIC(S:MINOR)OTE(Minor);', [dint('Zero'), dint('R1'), real('R2'), bool('Minor')]);
    expect(plc.tags.readNumber('R1')).toBe(9);
    expect(plc.tags.readNumber('R2')).toBe(Infinity);
    expect(plc.tags.readBool('Minor')).toBe(true);
    expect(plc.getStatus().minorFaults.every((f) => f.code === 4)).toBe(true);
  });

  it('MOD takes the sign of the dividend', () => {
    const plc = compute('MOD(-7,3,R1)MOD(7.5,2,R2);', [dint('R1'), real('R2')]);
    expect(plc.tags.readNumber('R1')).toBe(-1);
    expect(plc.tags.readNumber('R2')).toBe(1.5);
  });
});

describe('NEG / ABS / SQR / CPT / SCP', () => {
  it('computes single-operand math', () => {
    const plc = compute('NEG(5,R1)ABS(-12,R2)SQR(10,R3)SQR(-16.0,R4)NEG(Small,R5);', [
      dint('R1'),
      dint('R2'),
      dint('R3'),
      real('R4'),
      sint('Small', { initial: -128 }),
      sint('R5'),
    ]);
    expect(plc.tags.readNumber('R1')).toBe(-5);
    expect(plc.tags.readNumber('R2')).toBe(12);
    expect(plc.tags.readNumber('R3')).toBe(3);
    expect(plc.tags.readNumber('R4')).toBe(4);
    expect(plc.tags.readNumber('R5')).toBe(-128); // 128 does not fit a SINT → wraps
    expect(plc.getStatus().minorFaults).toHaveLength(1);
  });

  it('ABS of the most negative DINT overflows', () => {
    const plc = compute('ABS(-2147483648,R);', [dint('R')]);
    expect(plc.tags.readNumber('R')).toBe(-2147483648);
    expect(plc.tags.readBool('S:V')).toBe(true);
  });

  it('CPT evaluates an expression with REAL math when the destination is REAL', () => {
    const plc = compute('CPT(R,(A + B) * 2 / 3)CPT(D,(A + B) * 2 / 3);', [dint('A', { initial: 4 }), dint('B', { initial: 3 }), real('R'), dint('D')]);
    expect(plc.tags.readNumber('R')).toBe(Math.fround(14 / 3));
    expect(plc.tags.readNumber('D')).toBe(4);
  });

  it('SCP scales linearly without clamping', () => {
    const plc = compute('SCP(Pot,0.0,100.0,0.0,1750.0,Rpm)SCP(Raw,4.0,20.0,0.0,100.0,Pct)SCP(1,5,5,0,10,Bad);', [
      real('Pot', { initial: 50 }),
      real('Rpm'),
      real('Raw', { initial: 22 }),
      real('Pct'),
      real('Bad'),
    ]);
    expect(plc.tags.readNumber('Rpm')).toBe(875);
    expect(plc.tags.readNumber('Pct')).toBe(112.5);
    expect(plc.tags.readNumber('Bad')).toBe(0);
    expect(plc.getStatus().minorFaults).toHaveLength(1);
  });
});
