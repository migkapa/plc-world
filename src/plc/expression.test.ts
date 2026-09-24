import { describe, expect, it } from 'vitest';
import { takeOverflow } from './convert';
import { ExpressionError, compileExpression } from './expression';
import { createTagDatabase } from './tags';

function evalExpr(text: string, forceReal = false): number {
  const d = createTagDatabase();
  d.define({ name: 'A', dataType: 'DINT', initial: 7 });
  d.define({ name: 'B', dataType: 'DINT', initial: 2 });
  d.define({ name: 'R', dataType: 'REAL', initial: 2.5 });
  d.define({ name: 'Arr', dataType: 'DINT', dims: 4, initial: [10, 20, 30, 40] });
  d.define({ name: 'I', dataType: 'DINT', initial: 1 });
  d.define({ name: 'Flag', dataType: 'BOOL', initial: true });
  return compileExpression(text, (op) => d.ref(op), { forceReal }).readN();
}

describe('expression compiler', () => {
  it('evaluates literals in all Logix formats', () => {
    expect(evalExpr('123')).toBe(123);
    expect(evalExpr('-4.5')).toBe(-4.5);
    expect(evalExpr('1.5e3')).toBe(1500);
    expect(evalExpr('16#FF')).toBe(255);
    expect(evalExpr('2#1010_1010')).toBe(170);
    expect(evalExpr('8#17')).toBe(15);
  });

  it('honours precedence and parentheses', () => {
    expect(evalExpr('2 + 3 * 4')).toBe(14);
    expect(evalExpr('(2 + 3) * 4')).toBe(20);
    // RM003: operations of equal order are performed left to right, ** included.
    expect(evalExpr('2 ** 3 ** 2')).toBe(64);
    expect(evalExpr('2 ** -1')).toBe(0.5);
    expect(evalExpr('2 ** 2 * 3')).toBe(12);
    expect(evalExpr('-2 ** 2')).toBe(-4);
    expect(evalExpr('10 - 4 - 3')).toBe(3);
    expect(evalExpr('1 + 2 = 3')).toBe(1);
    expect(evalExpr('A > B AND B > 1')).toBe(1);
    expect(evalExpr('A < B OR B = 2')).toBe(1);
  });

  it('evaluates all relational operators at one level, left to right', () => {
    // (A = B) < 3 → 0 < 3 → 1; a separate lower '=' level would give A = (B < 3) → 7 = 1 → 0.
    expect(evalExpr('A = B < 3')).toBe(1);
    expect(evalExpr('A <> B >= 1')).toBe(1);
    expect(evalExpr('B < A = 1')).toBe(1);
  });

  it('uses integer math (truncating division) unless something is REAL', () => {
    expect(evalExpr('A / B')).toBe(3);
    expect(evalExpr('-7 / 2')).toBe(-3);
    expect(evalExpr('A MOD B')).toBe(1);
    expect(evalExpr('-7 MOD 2')).toBe(-1);
    expect(evalExpr('A / B', true)).toBe(3.5);
    expect(evalExpr('A / 2.0')).toBe(3.5);
    expect(evalExpr('R * 2')).toBe(5);
    expect(evalExpr('7.5 MOD 2')).toBe(1.5);
  });

  it('supports bitwise operators and NOT', () => {
    expect(evalExpr('16#F0 AND 16#3C')).toBe(0x30);
    expect(evalExpr('16#F0 OR 16#0F')).toBe(0xff);
    expect(evalExpr('16#FF XOR 16#0F')).toBe(0xf0);
    expect(evalExpr('NOT 0')).toBe(-1);
    expect(evalExpr('5 & 3')).toBe(1);
  });

  it('supports comparisons', () => {
    expect(evalExpr('A <> B')).toBe(1);
    expect(evalExpr('A <= 7')).toBe(1);
    expect(evalExpr('A >= 8')).toBe(0);
    expect(evalExpr('R = 2.5')).toBe(1);
  });

  it('supports functions', () => {
    expect(evalExpr('ABS(-5)')).toBe(5);
    expect(evalExpr('SQR(16)')).toBe(4);
    expect(evalExpr('SQRT(2.25)')).toBe(1.5);
    expect(evalExpr('TRN(-2.7)')).toBe(-2);
    expect(evalExpr('SIN(0)')).toBe(0);
    expect(evalExpr('COS(0)')).toBe(1);
    expect(evalExpr('LN(1)')).toBe(0);
    expect(evalExpr('LOG(1000)')).toBe(3);
    expect(evalExpr('FRD(16#25)')).toBe(25);
    expect(evalExpr('TOD(25)')).toBe(0x25);
    expect(evalExpr('DEG(0)')).toBe(0);
  });

  it('reads tag operands including indexed and bits', () => {
    expect(evalExpr('Arr[I] + Arr[3]')).toBe(60);
    expect(evalExpr('Arr[I+1]')).toBe(30);
    expect(evalExpr('A.0 + A.1 + A.2 + A.3')).toBe(3);
    expect(evalExpr('Flag + 1')).toBe(2);
  });

  it('flags integer overflow and division by zero', () => {
    takeOverflow();
    expect(evalExpr('2147483647 + 1')).toBe(-2147483648);
    expect(takeOverflow()).toBe(true);
    expect(evalExpr('A / 0')).toBe(7);
    expect(takeOverflow()).toBe(true);
    expect(evalExpr('1.0 / 0')).toBe(Infinity);
    expect(takeOverflow()).toBe(true);
    expect(evalExpr('A + B')).toBe(9);
    expect(takeOverflow()).toBe(false);
  });

  it('reports syntax errors and unknown tags', () => {
    expect(() => evalExpr('')).toThrow(ExpressionError);
    expect(() => evalExpr('(1 + 2')).toThrow(/Expected '\)'/);
    expect(() => evalExpr('1 + ')).toThrow(ExpressionError);
    expect(() => evalExpr('1 $ 2')).toThrow(/Unexpected character/);
    expect(() => evalExpr('Missing + 1')).toThrow(/Undefined tag/);
  });

  it('reports metadata', () => {
    const d = createTagDatabase();
    d.define({ name: 'A', dataType: 'DINT' });
    const e = compileExpression('A * 2 > 10', (op) => d.ref(op));
    expect(e.operands).toEqual(['A']);
    expect(e.hasComparison).toBe(true);
    expect(e.real).toBe(false);
  });
});
