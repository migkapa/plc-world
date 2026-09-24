import { describe, expect, it } from 'vitest';
import { roundHalfEven, takeOverflow, toDint, toInt, toReal, toSint, parseNumericLiteral } from './convert';
import { PlcFault, TagError } from './errors';
import { createTagDatabase, isValidTagName, parseOperandPath } from './tags';
import type { StructType, TimerValue } from './types';

function db() {
  const d = createTagDatabase();
  d.define({ name: 'Motor', dataType: 'BOOL' });
  d.define({ name: 'Count', dataType: 'DINT' });
  d.define({ name: 'Word', dataType: 'INT' });
  d.define({ name: 'Small', dataType: 'SINT' });
  d.define({ name: 'Level', dataType: 'REAL' });
  d.define({ name: 'T1', dataType: 'TIMER' });
  d.define({ name: 'C1', dataType: 'COUNTER' });
  d.define({ name: 'Arr', dataType: 'DINT', dims: 10 });
  d.define({ name: 'Idx', dataType: 'DINT' });
  d.define({ name: 'Timers', dataType: 'TIMER', dims: 3 });
  d.define({ name: 'Flags', dataType: 'BOOL', dims: 32 });
  return d;
}

describe('conversions', () => {
  it('rounds REAL to integer half to even', () => {
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(-2.5)).toBe(-2);
    expect(roundHalfEven(-3.5)).toBe(-4);
    expect(roundHalfEven(2.4999)).toBe(2);
    expect(roundHalfEven(-0.6)).toBe(-1);
    expect(toDint(1.5)).toBe(2);
    expect(toDint(0.5)).toBe(0);
  });

  it('wraps integers two’s complement and reports overflow', () => {
    takeOverflow();
    expect(toDint(2147483647)).toBe(2147483647);
    expect(takeOverflow()).toBe(false);
    expect(toDint(2147483648)).toBe(-2147483648);
    expect(takeOverflow()).toBe(true);
    expect(toInt(40000)).toBe(-25536);
    expect(takeOverflow()).toBe(true);
    expect(toSint(200)).toBe(-56);
    expect(takeOverflow()).toBe(true);
    expect(toSint(-128)).toBe(-128);
    expect(takeOverflow()).toBe(false);
  });

  it('stores REAL in single precision', () => {
    expect(toReal(0.1)).toBe(Math.fround(0.1));
    expect(toReal(0.1)).not.toBe(0.1);
    takeOverflow();
    expect(toReal(1e39)).toBe(Infinity);
    expect(takeOverflow()).toBe(true);
  });

  it('parses Logix literals', () => {
    expect(parseNumericLiteral('123')).toEqual({ value: 123, real: false });
    expect(parseNumericLiteral('-4.5')).toEqual({ value: -4.5, real: true });
    expect(parseNumericLiteral('1.5e3')).toEqual({ value: 1500, real: true });
    expect(parseNumericLiteral('16#FF')).toEqual({ value: 255, real: false });
    expect(parseNumericLiteral('2#1010_1010')).toEqual({ value: 170, real: false });
    expect(parseNumericLiteral('8#17')).toEqual({ value: 15, real: false });
    expect(parseNumericLiteral('16#FFFF_FFFF')?.value).toBe(-1);
    expect(parseNumericLiteral('2#102')).toBeUndefined();
    expect(parseNumericLiteral('Motor')).toBeUndefined();
  });
});

describe('tag database', () => {
  it('matches names case-insensitively and preserves case', () => {
    const d = db();
    d.writeBool('MOTOR', true);
    expect(d.readBool('motor')).toBe(true);
    expect(d.getDef('mOtOr')?.name).toBe('Motor');
    expect(d.ref('t1.dn').path).toBe('T1.DN');
  });

  it('resolves program scope before controller scope', () => {
    const d = db();
    d.define({ name: 'Count', dataType: 'REAL' }, 'MainProgram');
    d.writeNumber('Count', 1.5, 'MainProgram');
    d.writeNumber('Count', 7);
    expect(d.readNumber('Count', 'MainProgram')).toBe(1.5);
    expect(d.readNumber('Count')).toBe(7);
    expect(d.readBool('Motor', 'MainProgram')).toBe(false); // falls back to controller scope
    expect(d.list('MainProgram').map((t) => t.name)).toEqual(['Count']);
    expect(d.listAll().find((t) => t.scope === 'MainProgram')?.dataType).toBe('REAL');
  });

  it('resolves alias tags recursively and detects cycles', () => {
    const d = db();
    d.define({ name: 'Status', dataType: 'DINT', aliasFor: 'Count' });
    d.define({ name: 'Status_Bit3', dataType: 'BOOL', aliasFor: 'Status.3' });
    d.writeBool('Status_Bit3', true);
    expect(d.readNumber('Count')).toBe(8);
    expect(d.ref('Status_Bit3').path).toBe('Count.3');
    expect(d.readBool('Status.3')).toBe(true);
    expect(d.typeOf('Status')).toBe('DINT');
    d.define({ name: 'LoopA', dataType: 'BOOL', aliasFor: 'LoopB' });
    d.define({ name: 'LoopB', dataType: 'BOOL', aliasFor: 'LoopA' });
    expect(() => d.readBool('LoopA')).toThrow(TagError);
    expect(d.exists('LoopA')).toBe(false);
  });

  it('addresses structure members and bits of integers', () => {
    const d = db();
    d.writeNumber('T1.PRE', 5000);
    expect(d.getStruct<TimerValue>('T1')?.PRE).toBe(5000);
    d.writeBool('Count.31', true);
    expect(d.readNumber('Count')).toBe(-2147483648);
    d.writeBool('Word.15', true);
    expect(d.readNumber('Word')).toBe(-32768);
    d.writeBool('Small.7', true);
    d.writeBool('Small.0', true);
    expect(d.readNumber('Small')).toBe(-127);
    expect(d.exists('Small.8')).toBe(false);
    expect(d.exists('Word.16')).toBe(false);
    expect(d.exists('Level.0')).toBe(false);
    expect(d.exists('T1.XX')).toBe(false);
    expect(() => d.ref('Word.16')).toThrow(/out of range/);
  });

  it('indexes arrays with literals, tags and expressions', () => {
    const d = db();
    d.writeNumber('Arr[3]', 42);
    d.writeNumber('Idx', 3);
    expect(d.readNumber('Arr[Idx]')).toBe(42);
    expect(d.readNumber('Arr[Idx+0]')).toBe(42);
    d.writeNumber('Arr[Idx-1]', 9);
    expect(d.readNumber('Arr[2]')).toBe(9);
    d.writeBool('Timers[1].DN', true);
    expect(d.readBool('Timers[1].DN')).toBe(true);
    d.writeNumber('Idx', 1);
    expect(d.readBool('Timers[Idx].DN')).toBe(true);
    d.writeBool('Flags[31]', true);
    expect(d.readBool('Flags[31]')).toBe(true);
    expect(d.ref('Arr[Idx]').dynamic).toBe(true);
    expect(d.ref('Arr[Idx]').array).toEqual({ length: 10, elemType: 'DINT' });
  });

  it('checks array bounds: literal at compile time, indirect at run time (T04:C20)', () => {
    const d = db();
    expect(() => d.ref('Arr[10]')).toThrow(TagError);
    expect(() => d.ref('Arr[Level]')).toThrow(/integer/);
    d.writeNumber('Idx', 10);
    let fault: unknown;
    try {
      d.readNumber('Arr[Idx]');
    } catch (e) {
      fault = e;
    }
    expect(fault).toBeInstanceOf(PlcFault);
    expect((fault as PlcFault).type).toBe(4);
    expect((fault as PlcFault).code).toBe(20);
    d.writeNumber('Idx', -1);
    expect(() => d.writeNumber('Arr[Idx]', 1)).toThrow(PlcFault);
  });

  it('supports indirect bit addressing Tag.[Idx]', () => {
    const d = db();
    d.writeNumber('Idx', 4);
    d.writeBool('Count.[Idx]', true);
    expect(d.readNumber('Count')).toBe(16);
    d.writeNumber('Idx', 32);
    expect(() => d.readBool('Count.[Idx]')).toThrow(PlcFault);
  });

  it('converts on write with Logix rules', () => {
    const d = db();
    d.writeNumber('Count', 2.5);
    expect(d.readNumber('Count')).toBe(2);
    d.writeNumber('Count', -3.5);
    expect(d.readNumber('Count')).toBe(-4);
    d.writeNumber('Word', 70000);
    expect(d.readNumber('Word')).toBe(4464);
    d.writeNumber('Level', 0.1);
    expect(d.readNumber('Level')).toBe(Math.fround(0.1));
    d.writeNumber('Motor', 5);
    expect(d.readBool('Motor')).toBe(true);
    expect(d.readNumber('Motor')).toBe(1);
  });

  it('returns deep clones from readValue and live objects from getStruct', () => {
    const d = db();
    const clone = d.readValue('T1') as Record<string, unknown>;
    clone.PRE = 99;
    expect(d.readNumber('T1.PRE')).toBe(0);
    const live = d.getStruct<TimerValue>('T1')!;
    live.ACC = 123;
    expect(d.readNumber('T1.ACC')).toBe(123);
    expect(d.readValue('Arr')).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(d.readValue('Nope')).toBeUndefined();
    expect(d.getStruct('Count')).toBeUndefined();
  });

  it('bumps version on writes and structureVersion on definitions', () => {
    const d = db();
    const v = d.version;
    const s = d.structureVersion;
    d.writeBool('Motor', true);
    expect(d.version).toBeGreaterThan(v);
    expect(d.structureVersion).toBe(s);
    d.define({ name: 'Extra', dataType: 'BOOL' });
    expect(d.structureVersion).toBeGreaterThan(s);
    d.remove('Extra');
    expect(d.exists('Extra')).toBe(false);
  });

  it('validates names and data types', () => {
    const d = db();
    expect(() => d.define({ name: '1Bad', dataType: 'BOOL' })).toThrow(TagError);
    expect(() => d.define({ name: 'Bad__Name', dataType: 'BOOL' })).toThrow(TagError);
    expect(() => d.define({ name: 'X', dataType: 'FOO' })).toThrow(/Unknown data type/);
    expect(isValidTagName('Start_PB')).toBe(true);
    expect(isValidTagName('Trailing_')).toBe(false);
    expect(() => d.readBool('Undefined_Tag')).toThrow(/Undefined tag/);
  });

  it('applies initial values including structures, and resets them', () => {
    const d = db();
    d.define({ name: 'Delay', dataType: 'TIMER', initial: { PRE: 2500 } });
    d.define({ name: 'Recipe', dataType: 'REAL', dims: 3, initial: [1.5, 2.5] });
    expect(d.readNumber('Delay.PRE')).toBe(2500);
    expect(d.readValue('Recipe')).toEqual([1.5, 2.5, 0]);
    d.writeNumber('Delay.PRE', 1);
    d.resetValues();
    expect(d.readNumber('Delay.PRE')).toBe(2500);
  });

  it('registers user-defined structures (UDT) with nested members and bit aliases', () => {
    const d = createTagDatabase();
    const valve: StructType = {
      name: 'Valve_UDT',
      members: [
        { name: 'Cmd', dataType: 'BOOL' },
        { name: 'Status', dataType: 'SINT' },
        { name: 'Open_LS', dataType: 'BOOL', bitOf: { member: 'Status', bit: 0 } },
        { name: 'Stroke', dataType: 'TIMER' },
        { name: 'History', dataType: 'DINT', dims: 4 },
      ],
    };
    d.registerDataType(valve);
    d.define({ name: 'XV101', dataType: 'Valve_UDT' });
    d.writeBool('XV101.Open_LS', true);
    expect(d.readNumber('XV101.Status')).toBe(1);
    d.writeNumber('XV101.Stroke.PRE', 3000);
    d.writeNumber('XV101.History[3]', 7);
    expect(d.readValue('XV101')).toMatchObject({ Cmd: false, Status: 1, Open_LS: true, History: [0, 0, 0, 7] });
  });

  it('parses operand paths', () => {
    expect(parseOperandPath('Local:1:I.Data.0').segs).toEqual([
      { k: 'm', name: 'Data' },
      { k: 'b', n: 0 },
    ]);
    expect(parseOperandPath('Arr[Idx[2]].PRE').base).toBe('Arr');
    expect(() => parseOperandPath('A[1,2]')).toThrow(/Multi-dimensional/);
    expect(() => parseOperandPath('A b')).toThrow(TagError);
  });

  it('defines hidden system operands', () => {
    const d = createTagDatabase();
    d.defineSystem({ name: 'S:FS', dataType: 'BOOL', constant: true });
    expect(d.exists('S:FS')).toBe(true);
    expect(d.ref('s:fs').constant).toBe(true);
    expect(d.listAll()).toHaveLength(0);
  });
});

describe('whole-value writes, metadata and data types', () => {
  it('writeValue converts arrays and structures member by member', () => {
    const d = db();
    d.writeValue('Arr', [1.5, 3000000000, true, 2.5]);
    expect([0, 1, 2, 3].map((i) => d.readNumber(`Arr[${i}]`))).toEqual([2, -1294967296, 1, 2]);
    d.writeValue('T1', { PRE: 2.5, EN: 1, dn: true, Bogus: 7 } as unknown as TimerValue & Record<string, number>);
    expect(d.readNumber('T1.PRE')).toBe(2);
    expect(d.readBool('T1.EN')).toBe(true);
    expect(typeof d.getStruct<TimerValue>('T1')?.EN).toBe('boolean');
    expect(d.readBool('T1.DN')).toBe(true);
    expect(d.readValue('T1')).not.toHaveProperty('Bogus');
    d.writeValue('Timers[1]', { ACC: 7.5 });
    expect(d.readNumber('Timers[1].ACC')).toBe(8);
    d.writeValue('Level', 1 / 3);
    expect(d.readNumber('Level')).toBe(Math.fround(1 / 3));
    d.writeValue('Arr[0]', 1.5);
    expect(d.readNumber('Arr[0]')).toBe(2);
  });

  it('getDataType returns built-in and registered types', () => {
    const d = createTagDatabase();
    expect(d.getDataType('timer')?.members.map((m) => m.name)).toEqual(['PRE', 'ACC', 'EN', 'TT', 'DN']);
    expect(d.getDataType('COUNTER')?.name).toBe('COUNTER');
    expect(d.getDataType('CONTROL')).toBeDefined();
    expect(d.getDataType('Missing_Type')).toBeUndefined();
    d.registerDataType({ name: 'Valve', members: [{ name: 'Open', dataType: 'BOOL' }] });
    expect(d.getDataType('VALVE')?.members).toHaveLength(1);
  });

  it('changing the constant flag bumps the structure version (compiled refs carry it)', () => {
    const d = db();
    const v0 = d.structureVersion;
    d.updateDefMetadata({ name: 'Count', dataType: 'DINT', description: 'parts' });
    expect(d.structureVersion).toBe(v0);
    d.updateDefMetadata({ name: 'Count', dataType: 'DINT', constant: true });
    expect(d.structureVersion).toBe(v0 + 1);
    expect(d.ref('Count').constant).toBe(true);
  });

  it('checkDef reports why a definition cannot be created, without defining it', () => {
    const d = db();
    expect(d.checkDef({ name: 'Ok_Tag', dataType: 'DINT' })).toBeUndefined();
    expect(d.checkDef({ name: 'Bad', dataType: 'NOPE' })).toMatch(/Unknown data type 'NOPE'/);
    expect(d.checkDef({ name: '9Lives', dataType: 'DINT' })).toMatch(/Invalid tag name/);
    expect(d.exists('Ok_Tag')).toBe(false);
  });

  it('reports the resolved scope of an operand', () => {
    const d = db();
    d.define({ name: 'Motor', dataType: 'BOOL' }, 'Line2');
    d.define({ name: 'Alias_Count', dataType: 'DINT', aliasFor: 'Count' }, 'Line2');
    expect(d.ref('Motor').scope).toBe('');
    expect(d.ref('Motor', 'Line2').scope).toBe('Line2');
    expect(d.ref('Alias_Count.3', 'Line2')).toMatchObject({ scope: '', path: 'Count.3' });
  });
});

describe('force overlay', () => {
  it('keeps forced bits and values whatever logic writes', () => {
    const d = db();
    d.setForceOverlay([
      { ref: d.ref('Count.0'), value: true },
      { ref: d.ref('Count.31'), value: false },
      { ref: d.ref('Level'), value: 42.5 },
      { ref: d.ref('Motor'), value: true },
      { ref: d.ref('Word.15'), value: true },
    ]);
    expect(d.readBool('Count.0')).toBe(true);
    d.writeNumber('Count', -2); // ...1110 with the sign bit set
    expect(d.readNumber('Count')).toBe(0x7ffffffe | 1);
    d.writeBool('Count.0', false);
    expect(d.readBool('Count.0')).toBe(true);
    d.writeBool('Count.4', true);
    expect(d.readBool('Count.4')).toBe(true); // other bits stay writable
    d.writeNumber('Level', 1);
    expect(d.readNumber('Level')).toBe(42.5);
    d.writeBool('Motor', false);
    expect(d.readBool('Motor')).toBe(true);
    d.writeNumber('Word', 1);
    expect(d.readNumber('Word')).toBe(-32767); // INT sign bit forced on
    d.setForceOverlay([]);
    d.writeBool('Motor', false);
    d.writeNumber('Level', 1);
    expect([d.readBool('Motor'), d.readNumber('Level')]).toEqual([false, 1]);
  });

  it('ignores indirect refs and is cleared by resetValues()', () => {
    const d = db();
    d.setForceOverlay([
      { ref: d.ref('Arr[Idx]'), value: 5 },
      { ref: d.ref('Arr[2]'), value: 9 },
    ]);
    expect(d.readNumber('Arr[0]')).toBe(0);
    expect(d.readNumber('Arr[2]')).toBe(9);
    d.writeValue('Arr', [1, 1, 1]);
    expect(d.readNumber('Arr[2]')).toBe(9); // whole-array writes are re-masked
    d.resetValues();
    d.writeNumber('Arr[2]', 3);
    expect(d.readNumber('Arr[2]')).toBe(3);
  });
});
