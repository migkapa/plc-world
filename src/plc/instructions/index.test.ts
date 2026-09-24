import { describe, expect, it } from 'vitest';
import { parseRungs } from '../neutralText';
import { INSTRUCTIONS, INSTRUCTION_CATEGORIES, getInstruction, instructionsByCategory, isOutputInstruction } from './index';

const REQUIRED = [
  'XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'OSF',
  'TON', 'TOF', 'RTO', 'CTU', 'CTD', 'RES',
  'EQU', 'NEQ', 'LES', 'LEQ', 'GRT', 'GEQ', 'LIM', 'MEQ', 'CMP',
  'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'NEG', 'ABS', 'SQR', 'CPT', 'SCP',
  'MOV', 'MVM', 'CLR', 'AND', 'OR', 'XOR', 'NOT', 'BTD', 'COP', 'FLL',
  'JSR', 'RET', 'JMP', 'LBL', 'AFI', 'NOP',
  'BSL', 'BSR', 'SQO', 'FFL', 'FFU',
];

describe('instruction registry', () => {
  it('contains every required instruction', () => {
    for (const m of REQUIRED) expect(INSTRUCTIONS[m], m).toBeDefined();
  });

  it('has complete metadata with a neutral-text example that parses', () => {
    for (const [key, info] of Object.entries(INSTRUCTIONS)) {
      expect(info.mnemonic).toBe(key);
      expect(info.name.length).toBeGreaterThan(2);
      expect(info.summary.length).toBeGreaterThan(10);
      expect(INSTRUCTION_CATEGORIES).toContain(info.category);
      const example = /```\n([\s\S]*?)\n```/.exec(info.details ?? '');
      expect(example, `${key} example`).not.toBeNull();
      expect(() => parseRungs(example![1]!), `${key} example parses`).not.toThrow();
      for (const op of info.operands) expect(op.types.length).toBeGreaterThan(0);
    }
  });

  it('declares status bits for box instructions with control structures', () => {
    expect(INSTRUCTIONS.TON?.statusBits).toEqual(['EN', 'DN']);
    expect(INSTRUCTIONS.CTU?.statusBits).toEqual(['CU', 'DN']);
    expect(INSTRUCTIONS.SQO?.statusBits).toEqual(['EN', 'DN', 'ER']);
    expect(INSTRUCTIONS.XIC?.display).toBe('contact');
    expect(INSTRUCTIONS.OTE?.display).toBe('coil');
    expect(INSTRUCTIONS.TON?.operands.map((o) => o.name)).toEqual(['Timer', 'Preset', 'Accum']);
  });

  it('classifies input and output instructions', () => {
    expect(isOutputInstruction('xic')).toBe(false);
    expect(isOutputInstruction('OTE')).toBe(true);
    expect(isOutputInstruction('TON')).toBe(true);
    expect(isOutputInstruction('EQU')).toBe(false);
    expect(isOutputInstruction('ZZZ')).toBeUndefined();
    expect(getInstruction('ton')?.mnemonic).toBe('TON');
  });

  it('groups instructions by palette category', () => {
    const groups = instructionsByCategory();
    expect(Object.keys(groups)).toEqual([...INSTRUCTION_CATEGORIES]);
    expect(groups.Bit.map((i) => i.mnemonic)).toEqual(['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'OSF']);
    const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
    expect(total).toBe(Object.keys(INSTRUCTIONS).length);
  });
});
