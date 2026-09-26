import { describe, expect, it } from 'vitest';
import { bool, dint, real, runLogic } from '../testUtils';

function cmp(instr: string, a: number, b: number, types: { a?: 'DINT' | 'REAL'; b?: 'DINT' | 'REAL' } = {}): boolean {
  const plc = runLogic([`XIC(En)${instr}(A,B)OTE(Out);`], [
    bool('En', { initial: true }),
    { name: 'A', dataType: types.a ?? 'DINT', initial: a },
    { name: 'B', dataType: types.b ?? 'DINT', initial: b },
    bool('Out'),
  ]);
  plc.scan(10);
  return plc.tags.readBool('Out');
}

describe('two-operand compares', () => {
  const table: Array<[string, number, number, boolean]> = [
    ['EQU', 5, 5, true],
    ['EQU', 5, 6, false],
    ['NEQ', 5, 6, true],
    ['NEQ', 5, 5, false],
    ['LES', 4, 5, true],
    ['LES', 5, 5, false],
    ['LEQ', 5, 5, true],
    ['LEQ', 6, 5, false],
    ['GRT', 6, 5, true],
    ['GRT', 5, 5, false],
    ['GEQ', 5, 5, true],
    ['GEQ', 4, 5, false],
  ];
  it.each(table)('%s(%d, %d) = %s', (instr, a, b, expected) => {
    expect(cmp(instr, a, b)).toBe(expected);
  });

  it('compares mixed DINT/REAL in REAL', () => {
    expect(cmp('GRT', 2, 1.5, { b: 'REAL' })).toBe(true);
    expect(cmp('EQU', 16777217, 16777216, { b: 'REAL' })).toBe(true); // DINT → REAL loses precision like Logix
    expect(cmp('EQU', 0.1, 0.1, { a: 'REAL', b: 'REAL' })).toBe(true);
  });

  it('is false when the rung-condition-in is false and highlights on the comparison result', () => {
    const plc = runLogic(['XIC(En)EQU(A,5)OTE(Out);'], [bool('En'), dint('A', { initial: 5 }), bool('Out')]);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(false);
    const equ = plc.project.programs[0]!.routines[0]!.rungs[0]!.elements[1]!;
    expect(plc.getLiveState('MainProgram', 'MainRoutine')!.elements[equ.id]).toEqual({ in: false, out: false, active: true });
  });

  it('accepts immediate values on both sides', () => {
    const plc = runLogic(['GEQ(Level,85.0)OTE(High);', 'LES(3,Count)OTE(Many);'], [real('Level', { initial: 90 }), dint('Count', { initial: 4 }), bool('High'), bool('Many')]);
    plc.scan(10);
    expect(plc.tags.readBool('High')).toBe(true);
    expect(plc.tags.readBool('Many')).toBe(true);
  });
});

describe('LIM / MEQ / CMP', () => {
  function lim(lo: number, test: number, hi: number): boolean {
    const plc = runLogic([`LIM(${lo},T,${hi})OTE(Out);`], [dint('T', { initial: test }), bool('Out')]);
    plc.scan(10);
    return plc.tags.readBool('Out');
  }

  it('LIM tests inside the band when Low <= High (inclusive)', () => {
    expect(lim(10, 10, 20)).toBe(true);
    expect(lim(10, 20, 20)).toBe(true);
    expect(lim(10, 15, 20)).toBe(true);
    expect(lim(10, 9, 20)).toBe(false);
    expect(lim(10, 21, 20)).toBe(false);
  });

  it('LIM tests outside the band when Low > High', () => {
    expect(lim(20, 25, 10)).toBe(true);
    expect(lim(20, 5, 10)).toBe(true);
    expect(lim(20, 10, 10)).toBe(true);
    expect(lim(20, 15, 10)).toBe(false);
  });

  it('MEQ compares masked bits', () => {
    const plc = runLogic(['MEQ(Src,16#0F,2#0101)OTE(Out);'], [dint('Src', { initial: 0xf5 }), bool('Out')]);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(true);
    plc.tags.writeNumber('Src', 0xf4);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(false);
  });

  it('CMP evaluates expressions', () => {
    const plc = runLogic(['CMP((A + B) / 2 >= Setpoint)OTE(Out);', 'CMP(A * 2)OTE(NonZero);'], [
      dint('A', { initial: 10 }),
      dint('B', { initial: 20 }),
      real('Setpoint', { initial: 15 }),
      bool('Out'),
      bool('NonZero'),
    ]);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(true);
    expect(plc.tags.readBool('NonZero')).toBe(true);
    plc.tags.writeNumber('Setpoint', 15.5);
    plc.tags.writeNumber('A', 0);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(false);
    expect(plc.tags.readBool('NonZero')).toBe(false);
  });
});
