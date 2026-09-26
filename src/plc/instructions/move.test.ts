import { describe, expect, it } from 'vitest';
import { bool, dint, int, real, runLogic, sint, timer } from '../testUtils';

describe('MOV / MVM / CLR', () => {
  it('MOV converts between types', () => {
    const plc = runLogic(['MOV(2.5,D1)MOV(3.5,D2)MOV(-2.5,D3)MOV(70000,I1)MOV(7,R1);'], [dint('D1'), dint('D2'), dint('D3'), int('I1'), real('R1')]);
    plc.scan(10);
    expect([plc.tags.readNumber('D1'), plc.tags.readNumber('D2'), plc.tags.readNumber('D3')]).toEqual([2, 4, -2]);
    expect(plc.tags.readNumber('I1')).toBe(4464);
    expect(plc.tags.readNumber('R1')).toBe(7);
    expect(plc.getStatus().minorFaults).toHaveLength(1); // INT overflow
  });

  it('MOV only acts while the rung is true', () => {
    const plc = runLogic(['XIC(En)MOV(42,D);'], [bool('En'), dint('D', { initial: 1 })]);
    plc.scan(10);
    expect(plc.tags.readNumber('D')).toBe(1);
    plc.tags.writeBool('En', true);
    plc.scan(10);
    expect(plc.tags.readNumber('D')).toBe(42);
  });

  it('MVM moves only masked bits and CLR zeroes', () => {
    const plc = runLogic(['MVM(16#FF,16#0F,D)CLR(C);'], [dint('D', { initial: 0x30 }), dint('C', { initial: 5 })]);
    plc.scan(10);
    expect(plc.tags.readNumber('D')).toBe(0x3f);
    expect(plc.tags.readNumber('C')).toBe(0);
  });
});

describe('AND / OR / XOR / NOT / BTD', () => {
  it('performs bitwise logic', () => {
    const plc = runLogic(['AND(16#F0F0,16#FF00,A)OR(16#0F,16#F0,O)XOR(16#FF,16#0F,X)NOT(0,N)NOT(S,SN);'], [
      dint('A'),
      dint('O'),
      dint('X'),
      dint('N'),
      sint('S', { initial: 0x0f }),
      sint('SN'),
    ]);
    plc.scan(10);
    expect(plc.tags.readNumber('A')).toBe(0xf000);
    expect(plc.tags.readNumber('O')).toBe(0xff);
    expect(plc.tags.readNumber('X')).toBe(0xf0);
    expect(plc.tags.readNumber('N')).toBe(-1);
    expect(plc.tags.readNumber('SN')).toBe(-16);
  });

  it('BTD distributes a bit field', () => {
    const plc = runLogic(['BTD(Src,4,Dst,8,4);'], [dint('Src', { initial: 0xab }), dint('Dst', { initial: 0xffff0000 | 0 })]);
    plc.scan(10);
    expect(plc.tags.readNumber('Dst')).toBe((0xffff0000 | 0xa00) | 0);
  });

  it('BTD truncates to the destination size without overflow', () => {
    const plc = runLogic(['BTD(16#FF,0,Dst,4,8);'], [sint('Dst')]);
    plc.scan(10);
    expect(plc.tags.readNumber('Dst')).toBe(-16); // 2#1111_0000
    expect(plc.getStatus().minorFaults).toHaveLength(0);
  });
});

describe('COP / FLL', () => {
  it('COP copies elements of the same type and stops at the array end', () => {
    const plc = runLogic(['COP(Src[1],Dst[0],3)COP(Src[0],Dst[3],10);'], [
      dint('Src', { dims: 4, initial: [1, 2, 3, 4] }),
      dint('Dst', { dims: 5 }),
    ]);
    plc.scan(10);
    expect(plc.tags.readValue('Dst')).toEqual([2, 3, 4, 1, 2]);
  });

  it('COP copies raw bytes between different types', () => {
    const plc = runLogic(['COP(R,D,1)COP(Words[0],Big,1);'], [
      real('R', { initial: 1 }),
      dint('D'),
      int('Words', { dims: 2, initial: [0x1234, 0x0001] }),
      dint('Big'),
    ]);
    plc.scan(10);
    expect(plc.tags.readNumber('D')).toBe(1065353216);
    expect(plc.tags.readNumber('Big')).toBe(0x00011234);
  });

  it('COP copies whole structures', () => {
    const plc = runLogic(['COP(A,B,1);'], [timer('A', { initial: { PRE: 5000, ACC: 12, DN: true } }), timer('B')]);
    plc.scan(10);
    expect(plc.tags.readValue('B')).toMatchObject({ PRE: 5000, ACC: 12, DN: true });
  });

  it('FLL fills with conversion', () => {
    const plc = runLogic(['FLL(2.5,Arr[1],3)FLL(0,Arr2[0],99);'], [dint('Arr', { dims: 5 }), real('Arr2', { dims: 3, initial: [1, 2, 3] })]);
    plc.scan(10);
    expect(plc.tags.readValue('Arr')).toEqual([0, 2, 2, 2, 0]);
    expect(plc.tags.readValue('Arr2')).toEqual([0, 0, 0]);
  });
});
