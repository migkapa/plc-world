import { describe, expect, it } from 'vitest';
import { parseRung, parseRungs, serializeRung } from './neutralText';

describe('neutral text', () => {
  it('round-trips a seal-in rung', () => {
    const text = 'XIC(Start_PB)[XIC(Motor),XIC(Jog_PB)]XIC(Stop_PB)OTE(Motor);';
    expect(serializeRung(parseRung(text))).toBe(text);
  });

  it('accepts L5X export spacing and nested branches', () => {
    const r = parseRung('[XIC(A) ,[XIC(B) ,XIO(C) ]XIC(D) ]OTE(E);');
    expect(serializeRung(r)).toBe('[XIC(A),[XIC(B),XIO(C)]XIC(D)]OTE(E);');
  });

  it('keeps indexed and expression operands intact', () => {
    const r = parseRung('CPT(Result,(A+B)*Arr[Idx]) MOV(Arr[2],Dest) TON(T1,5000,0);');
    expect(serializeRung(r)).toBe('CPT(Result,(A+B)*Arr[Idx])MOV(Arr[2],Dest)TON(T1,5000,0);');
  });

  it('parses several rungs', () => {
    expect(parseRungs('XIC(a)OTE(b); XIO(a)OTE(c);')).toHaveLength(2);
  });

  it('supports no-operand instructions and empty rungs', () => {
    expect(serializeRung(parseRung('AFI OTE(x);'))).toBe('AFI()OTE(x);');
    expect(serializeRung(parseRung('AFI()NOP();'))).toBe('AFI()NOP();');
    expect(parseRung(';').elements).toHaveLength(0);
  });

  it('reports errors with a position', () => {
    expect(() => parseRung('XIC(a)[XIC(b)OTE(c);')).toThrow(/branch/i);
  });
});
