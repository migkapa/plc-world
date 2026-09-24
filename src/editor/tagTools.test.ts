import { describe, expect, it } from 'vitest';
import { createController } from '@/plc/controller';
import { INSTRUCTION_DEFS } from '@/plc/instructions';
import { createProjectForScene } from '@/sim/project';
import { trainerLogic } from '@/sim/scenes';
import { exampleFor } from './examples';
import { parseRung } from '@/plc/neutralText';
import {
  createLiveReader,
  forceInfo,
  formatReal,
  formatValue,
  makeTagMeta,
  newTagCandidate,
  parseUserValue,
  withAliasTarget,
  specOf,
  suggestMnemonics,
  suggestOperands,
} from './tagTools';

function plc() {
  const project = createProjectForScene(trainerLogic, ['XIC(Switch_0)TON(T1,1000,0);', 'XIC(T1.DN)OTE(Light_0);'], {
    tags: [
      { name: 'T1', dataType: 'TIMER', description: 'Delay timer' },
      { name: 'C1', dataType: 'COUNTER' },
      { name: 'Count', dataType: 'DINT', description: 'Parts' },
      { name: 'Level', dataType: 'REAL', initial: 62.5 },
      { name: 'Arr', dataType: 'DINT', dims: 4 },
    ],
  });
  return createController(project);
}

describe('formatting', () => {
  it('formats values in Studio 5000 styles', () => {
    expect(formatValue(true, 'BOOL')).toBe('1');
    expect(formatValue(5, 'DINT')).toBe('5');
    expect(formatValue(5, 'SINT', 'Binary')).toBe('2#0000_0101');
    expect(formatValue(-1, 'INT', 'Hex')).toBe('16#FFFF');
    expect(formatValue(255, 'DINT', 'Hex')).toBe('16#0000_00FF');
    expect(formatValue(15, 'DINT', 'Octal')).toBe('8#17');
    expect(formatValue(0x41424344, 'DINT', 'ASCII')).toBe("'ABCD'");
    expect(formatValue(62.5, 'REAL')).toBe('62.5');
    expect(formatValue(3, 'REAL')).toBe('3.0');
    expect(formatValue(undefined, 'DINT')).toBe('');
    expect(formatReal(0)).toBe('0.0');
    expect(formatReal(1e10)).toMatch(/e\+?10/);
  });

  it('parses user-typed values', () => {
    expect(parseUserValue('42')).toBe(42);
    expect(parseUserValue('-1.5')).toBe(-1.5);
    expect(parseUserValue('16#FF')).toBe(255);
    expect(parseUserValue('2#1010_1010')).toBe(170);
    expect(parseUserValue('8#17')).toBe(15);
    expect(parseUserValue('1.5e3')).toBe(1500);
    expect(parseUserValue('abc')).toBeUndefined();
  });
});

describe('controller helpers', () => {
  it('looks up descriptions and alias targets', () => {
    const c = plc();
    const meta = makeTagMeta(c, 'MainProgram')!;
    expect(meta('Switch_0')).toMatchObject({ aliasFor: 'Local:1:I.Data.0', dataType: 'BOOL' });
    expect(meta('Switch_0')?.description).toMatch(/toggle switch/);
    expect(meta('T1.DN')).toMatchObject({ description: 'Delay timer', dataType: 'BOOL' });
    expect(meta('Nope')).toBeUndefined();
    expect(meta('?')).toBeUndefined();
  });

  it('reads live values and follows tag structure changes', () => {
    const c = plc();
    const r = createLiveReader(c, 'MainProgram');
    expect(r.read('Level')).toBeCloseTo(62.5);
    expect(r.format('Level')).toBe('62.5');
    expect(r.read('T1.PRE')).toBe(1000);
    expect(r.read('T1')).toBeUndefined();
    expect(r.type('T1')).toBe('TIMER');
    expect(r.read('Missing')).toBeUndefined();
    c.upsertTag({ name: 'Missing', dataType: 'BOOL', initial: true });
    expect(r.read('Missing')).toBe(true);
    c.tags.writeNumber('Count', 7);
    expect(r.format('Count')).toBe('7');
  });

  it('reports forceable operands and installed forces', () => {
    const c = plc();
    expect(forceInfo(c, 'Switch_0').forceable).toBe(true);
    expect(forceInfo(c, 'Light_0').forceable).toBe(true);
    expect(forceInfo(c, 'Count').forceable).toBe(false);
    expect(forceInfo(c, 'Local:1:I.Data.3').forceable).toBe(true);
    c.setForce('Switch_0', true);
    expect(forceInfo(c, 'Switch_0').forced).toBe(true);
    expect(forceInfo(c, 'Local:1:I.Data.0').forced).toBe(true);
    expect(forceInfo(undefined, 'Switch_0').forceable).toBe(false);
  });

  it('resolves program-scoped aliases to the physical point (force by canonical path)', () => {
    const c = plc();
    c.upsertTag({ name: 'Switch_0', dataType: 'BOOL', aliasFor: 'Local:1:I.Data.9' }, 'MainProgram');
    const fi = forceInfo(c, 'Switch_0', 'MainProgram');
    expect(fi.forceable).toBe(true);
    expect(fi.path).toBe('Local:1:I.Data.9');
    c.setForce(fi.path!, true);
    expect(Object.keys(c.getForces())).toEqual(['Local:1:I.Data.9']);
    expect(forceInfo(c, 'Switch_0', 'MainProgram').forced).toBe(true);
    // the controller-scope alias of the same name is untouched
    expect(forceInfo(c, 'Switch_0').forced).toBeUndefined();
  });

  it('turns a tag into an alias without keeping array size / initial value', () => {
    const c = plc();
    c.upsertTag({ name: 'Arr2', dataType: 'DINT', dims: 10, initial: [1, 2, 3], constant: true, description: 'kept' });
    const def = c.tags.getDef('Arr2')!;
    const alias = withAliasTarget(def, ' Light_1 ', (op) => c.tags.typeOf(op));
    expect(alias).toEqual({ name: 'Arr2', dataType: 'BOOL', aliasFor: 'Light_1', description: 'kept' });
    c.upsertTag(alias);
    expect(c.tags.listAll().find((t) => t.name === 'Arr2')).toMatchObject({ dataType: 'BOOL', aliasFor: 'Light_1' });
    expect(c.tags.listAll().find((t) => t.name === 'Arr2')?.dims).toBeUndefined();
    // clearing the alias makes a base tag again
    expect(withAliasTarget(alias, '', (op) => c.tags.typeOf(op))).toEqual({ name: 'Arr2', dataType: 'BOOL', description: 'kept' });
  });

  it('proposes new tags for undefined operands with a type from the operand spec', () => {
    const c = plc();
    expect(newTagCandidate(c, 'Start_PB', 'MainProgram', specOf('XIC', 0))).toEqual({ name: 'Start_PB', dataType: 'BOOL' });
    expect(newTagCandidate(c, 'Delay', 'MainProgram', specOf('TON', 0))).toEqual({ name: 'Delay', dataType: 'TIMER' });
    expect(newTagCandidate(c, 'Parts', 'MainProgram', specOf('CTU', 0))).toEqual({ name: 'Parts', dataType: 'COUNTER' });
    expect(newTagCandidate(c, 'Total', 'MainProgram', specOf('ADD', 2))).toEqual({ name: 'Total', dataType: 'DINT' });
    // member / bit / element forms create the base tag
    expect(newTagCandidate(c, 'Timer9.DN', 'MainProgram', specOf('XIC', 0))).toEqual({ name: 'Timer9', dataType: 'TIMER' });
    expect(newTagCandidate(c, 'Cnt9.CU', 'MainProgram', specOf('XIC', 0))).toEqual({ name: 'Cnt9', dataType: 'COUNTER' });
    expect(newTagCandidate(c, 'Flags.3', 'MainProgram', specOf('XIC', 0))).toEqual({ name: 'Flags', dataType: 'DINT' });
    expect(newTagCandidate(c, 'Bits[3]', 'MainProgram', specOf('XIC', 0))).toEqual({ name: 'Bits', dataType: 'BOOL', dims: 10 });
    // existing tags, literals, I/O paths, invalid names, immediates: nothing to create
    expect(newTagCandidate(c, 'Switch_0', 'MainProgram', specOf('XIC', 0))).toBeUndefined();
    expect(newTagCandidate(c, 'T1.DN', 'MainProgram', specOf('XIC', 0))).toBeUndefined();
    expect(newTagCandidate(c, '5000', 'MainProgram', specOf('TON', 1))).toBeUndefined();
    expect(newTagCandidate(c, 'Local:9:I.Data.0', 'MainProgram', specOf('XIC', 0))).toBeUndefined();
    expect(newTagCandidate(c, 'Bad__Name', 'MainProgram', specOf('XIC', 0))).toBeUndefined();
    expect(newTagCandidate(c, 'X', 'MainProgram', specOf('TON', 1))).toBeUndefined();
    expect(newTagCandidate(undefined, 'Start_PB', 'MainProgram', specOf('XIC', 0))).toBeUndefined();
  });

  it('suggests operands filtered by data type', () => {
    const c = plc();
    const bit = specOf('XIC', 0);
    const names = suggestOperands(c, 'MainProgram', bit, 'swi').map((s) => s.operand);
    expect(names.slice(0, 3)).toEqual(['Switch_0', 'Switch_1', 'Switch_2']);
    expect(suggestOperands(c, 'MainProgram', bit, 'T1').find((s) => s.operand === 'T1')?.expandable).toBe(true);
    expect(suggestOperands(c, 'MainProgram', bit, 'T1.').map((s) => s.operand)).toEqual(['T1.EN', 'T1.TT', 'T1.DN', 'T1.PRE', 'T1.ACC']);
    expect(suggestOperands(c, 'MainProgram', bit, 'Count.1').map((s) => s.operand)).toContain('Count.15');
    // TIMER operand only lists timers
    const timers = suggestOperands(c, 'MainProgram', specOf('TON', 0), '').map((s) => s.operand);
    expect(timers).toEqual(['T1']);
    // numeric source: DINT/REAL tags directly, structures expandable, BOOL excluded
    const num = suggestOperands(c, 'MainProgram', specOf('MOV', 0), '');
    expect(num.find((s) => s.operand === 'Level')?.expandable).toBeUndefined();
    expect(num.some((s) => s.operand === 'Switch_0')).toBe(false);
    expect(suggestOperands(c, 'MainProgram', specOf('MOV', 0), 'T1.').map((s) => s.operand)).toEqual(['T1.PRE', 'T1.ACC']);
    expect(suggestOperands(c, 'MainProgram', specOf('MOV', 0), 'Arr[').map((s) => s.operand)).toEqual(['Arr[0]', 'Arr[1]', 'Arr[2]', 'Arr[3]']);
    // routines / labels
    expect(suggestOperands(c, 'MainProgram', specOf('JSR', 0), 'M', { routines: ['MainRoutine', 'Sub'] }).map((s) => s.operand)).toEqual(['MainRoutine']);
    expect(suggestOperands(c, 'MainProgram', specOf('TON', 1), '')).toEqual([]);
  });

  it('searches instructions and flags locked ones last', () => {
    expect(suggestMnemonics('XI').map((d) => d.mnemonic)).toEqual(['XIC', 'XIO']);
    expect(suggestMnemonics('timer')[0]!.category).toBe('Timer/Counter');
    const locked = suggestMnemonics('X', ['XIO']);
    expect(locked[0]!.mnemonic).toBe('XIO');
  });
});

describe('examples', () => {
  it('provides a parseable example for every instruction', () => {
    for (const op of Object.keys(INSTRUCTION_DEFS)) {
      const text = exampleFor(op);
      expect(() => parseRung(text), op).not.toThrow();
    }
  });
});
