import { describe, expect, it } from 'vitest';
import { createController } from './controller';
import { parseRung } from './neutralText';
import { bool, control, dint, makeProject, real, timer } from './testUtils';
import type { TagDef, VerifyError } from './types';
import { formatVerifyError } from './verify';

const TAGS: TagDef[] = [
  bool('A'),
  bool('B'),
  bool('Out'),
  dint('N'),
  real('R'),
  timer('T1'),
  control('Ctl'),
  dint('Arr', { dims: 4 }),
  dint('Max', { constant: true, initial: 10 }),
];

function verify(rungs: string[], routines?: Record<string, string[]>): VerifyError[] {
  return createController(makeProject(rungs, TAGS, routines ? { routines } : {})).verify();
}
const errors = (rungs: string[], routines?: Record<string, string[]>) => verify(rungs, routines).filter((e) => e.severity === 'error');
const warnings = (rungs: string[]) => verify(rungs).filter((e) => e.severity === 'warning');

describe('verify', () => {
  it('accepts a clean project and empty rungs', () => {
    expect(verify(['XIC(A)[XIC(Out),XIC(B)]OTE(Out);', '', 'TON(T1,1000,0);'])).toEqual([]);
  });

  it('reports unknown instructions', () => {
    const [e] = errors(['XIC(A)FOO(B)OTE(Out);']);
    expect(e).toMatchObject({ program: 'MainProgram', routine: 'MainRoutine', rungIndex: 0, message: "Unknown instruction 'FOO'." });
    expect(e?.elementId).toBeDefined();
  });

  it('reports wrong operand counts', () => {
    expect(errors(['XIC(A,B)OTE(Out);'])[0]?.message).toBe('XIC: Wrong number of operands (expected 1, found 2).');
    expect(errors(['TON(T1);'])[0]?.message).toMatch(/TON: Wrong number of operands \(expected 3, found 1\)/);
  });

  it("reports '?' operands", () => {
    const [e] = errors(['XIC(?)OTE(Out);']);
    expect(e).toMatchObject({ operandIndex: 0 });
    expect(e?.message).toMatch(/^XIC, Operand 0: Missing operand/);
  });

  it('allows "?" for the display operands of timers (keep the tag value)', () => {
    expect(errors(['XIC(A)TON(T1,?,?);'])).toEqual([]);
  });

  it('reports undefined tags, members and out-of-range subscripts', () => {
    expect(errors(['XIC(Nope)OTE(Out);'])[0]?.message).toBe("XIC, Operand 0: Undefined tag 'Nope'.");
    expect(errors(['XIC(T1.XX)OTE(Out);'])[0]?.message).toMatch(/not a member of TIMER/);
    expect(errors(['MOV(Arr[4],N);'])[0]?.message).toMatch(/Array subscript out of range/);
    expect(errors(['XIC(N.32)OTE(Out);'])[0]?.message).toMatch(/Bit number 32 is out of range/);
  });

  it('reports data type mismatches like Studio 5000', () => {
    const msg = 'Invalid data type. Argument must match parameter data type.';
    expect(errors(['XIC(N)OTE(Out);'])[0]?.message).toBe(`XIC, Operand 0: ${msg}`);
    expect(errors(['XIC(A)TON(N,1000,0);'])[0]?.message).toBe(`TON, Operand 0: ${msg}`);
    expect(errors(['XIC(A)CTU(T1,5,0);'])[0]?.message).toBe(`CTU, Operand 0: ${msg}`);
    expect(errors(['MOV(A,N);'])[0]?.message).toBe(`MOV, Operand 0: ${msg}`);
    expect(errors(['AND(R,1,N);'])[0]?.message).toBe(`AND, Operand 0: ${msg}`);
    expect(errors(['XIC(A)OTE(N.3);'])).toEqual([]); // a bit of a DINT is BOOL-addressable
  });

  it('rejects literal and constant destinations', () => {
    expect(errors(['XIC(A)OTE(1);'])[0]?.message).toBe('OTE, Operand 0: Invalid kind of operand or argument i.e. tag, literal, or expression.');
    expect(errors(['MOV(5,7);'])[0]?.operandIndex).toBe(1);
    expect(errors(['MOV(5,Max);'])[0]?.message).toMatch(/constant/);
    expect(errors(['XIC(A)OTE(S:FS);'])[0]?.message).toMatch(/constant/);
    expect(errors(['MOV(Max,N);'])).toEqual([]); // reading a constant is fine
  });

  it('requires every rung to end with an output instruction (including branch legs at the end)', () => {
    expect(errors(['XIC(A)XIC(B);'])[0]?.message).toBe('Rung must end with an output instruction.');
    expect(errors(['XIC(A)[OTE(Out),XIC(B)];'])[0]?.message).toBe('Every branch leg at the end of a rung must end with an output instruction.');
    expect(errors(['XIC(A)[OTE(Out),XIC(B)OTE(A)];'])).toEqual([]);
    expect(errors(['[OTE(Out),XIC(B)]OTE(A);'])).toEqual([]); // a branch in the middle may end with anything
    expect(errors(['XIC(A)OTE(Out)XIC(B);'])[0]?.message).toBe('Rung must end with an output instruction.');
    expect(errors(['EQU(N,1);'])).toHaveLength(1);
    expect(errors(['NOP();'])).toEqual([]);
  });

  it('warns about duplicate destructive bits and shorted branches', () => {
    const w = warnings(['XIC(A)OTE(Out);', 'XIC(B)OTE(Out);', 'XIC(A)OTL(Out);', 'XIC(A)[XIC(B),]OTE(N.1);']);
    const dup = w.filter((x) => x.message.includes('Duplicate destructive bit reference'));
    expect(dup.map((x) => x.rungIndex)).toEqual([0, 1]);
    expect(w.some((x) => x.message.startsWith('Shorted branch'))).toBe(true);
    // aliases resolve to the same bit
    const aliased = createController(
      makeProject(['XIC(A)OTE(Motor);', 'XIC(B)OTE(Local:2:O.Data.0);'], [bool('A'), bool('B'), { name: 'Motor', dataType: 'BOOL', aliasFor: 'Local:2:O.Data.0' }]),
    ).verify();
    expect(aliased.filter((x) => x.severity === 'warning')).toHaveLength(2);
  });

  it('does not treat same-named program-scoped tags of different programs as duplicates', () => {
    const line2 = (tags: TagDef[]) => ({
      name: 'Line2',
      mainRoutine: 'Main',
      tags,
      routines: [{ name: 'Main', type: 'RLL' as const, rungs: [parseRung('XIC(Start)OTE(Motor);')] }],
    });
    const separate = createController(
      makeProject(['XIC(Start)OTE(Motor);'], [bool('Start')], { programTags: [bool('Motor')], extraPrograms: [line2([bool('Motor')])] }),
    ).verify();
    expect(separate).toEqual([]);
    // Both programs writing one controller-scoped tag is still a duplicate.
    const shared = createController(makeProject(['XIC(Start)OTE(Motor);'], [bool('Start'), bool('Motor')], { extraPrograms: [line2([])] })).verify();
    expect(shared.filter((x) => x.message.includes('Duplicate destructive bit reference'))).toHaveLength(2);
  });

  it('checks JSR targets, labels and placement', () => {
    expect(errors(['JSR(Missing,0);'])[0]?.message).toBe("JSR, Operand 0: Undefined routine 'Missing'.");
    expect(errors(['JSR(Sub,0);'], { Sub: ['NOP();'] })).toEqual([]);
    expect(errors(['XIC(A)JMP(Nowhere);'])[0]?.message).toMatch(/Label 'Nowhere' is not defined/);
    const dup = errors(['LBL(L1)NOP();', 'LBL(L1)NOP();']);
    expect(dup[0]?.message).toMatch(/Duplicate label 'L1'/);
    expect(dup[0]?.rungIndex).toBe(1);
    expect(errors(['XIC(A)LBL(L2)OTE(Out);'])[0]?.message).toMatch(/LBL must be the first instruction/);
    expect(errors(['JSR(Sub,0);'], { Sub: ['NOP();', 'SBR(N)NOP();'] })[0]?.message).toMatch(/SBR must be the first instruction/);
  });

  it('reports expression errors', () => {
    expect(errors(['CPT(N,1+*2);'])[0]?.message).toMatch(/^CPT, Operand 1: Invalid expression/);
    expect(errors(['CMP(Nope > 1)OTE(Out);'])[0]?.message).toMatch(/Undefined tag 'Nope'/);
  });

  it('reports project-level problems with rungIndex -1', () => {
    const p = makeProject(['NOP();'], [bool('A'), { name: 'Bad', dataType: 'NOT_A_TYPE' }, { name: 'Broken', dataType: 'BOOL', aliasFor: 'Local:9:I.Data.0' }]);
    p.programs[0]!.mainRoutine = 'Main_Missing';
    const errs = createController(p).verify();
    expect(errs.map((e) => e.rungIndex)).toEqual([-1, -1, -1]);
    expect(errs.map((e) => e.message)).toEqual([
      "Tag 'Bad': Unknown data type 'NOT_A_TYPE' for tag 'Bad'.",
      expect.stringMatching(/^Tag 'Broken': Alias 'Broken' -> 'Local:9:I.Data.0': Undefined tag 'Local:9:I'/),
      "Program 'MainProgram': main routine 'Main_Missing' does not exist.",
    ]);
  });

  it('formats messages like the Studio 5000 errors window', () => {
    const [e] = errors(['XIC(A)TON(N,1000,0);']);
    expect(formatVerifyError(e!)).toBe('Error: MainProgram - MainRoutine, Rung 0, TON, Operand 0: Invalid data type. Argument must match parameter data type.');
  });
});
