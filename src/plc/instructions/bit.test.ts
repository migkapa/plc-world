import { describe, expect, it } from 'vitest';
import type { LogixController } from '../controller';
import { bool, runLogic } from '../testUtils';
import type { BranchNode, InstructionNode, RoutineLiveState } from '../types';

const live = (plc: LogixController): RoutineLiveState => plc.getLiveState('MainProgram', 'MainRoutine')!;
const elements = (plc: LogixController, rung: number) => plc.project.programs[0]!.routines[0]!.rungs[rung]!.elements;

describe('XIC / XIO', () => {
  const cases: Array<[boolean, boolean]> = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ];
  it.each(cases)('rung-condition-in %s, bit %s', (rci, bit) => {
    const plc = runLogic(['XIC(En)XIC(B)OTE(Out_XIC);', 'XIC(En)XIO(B)OTE(Out_XIO);'], [bool('En'), bool('B'), bool('Out_XIC'), bool('Out_XIO')]);
    plc.tags.writeBool('En', rci);
    plc.tags.writeBool('B', bit);
    plc.scan(10);
    expect(plc.tags.readBool('Out_XIC')).toBe(rci && bit);
    expect(plc.tags.readBool('Out_XIO')).toBe(rci && !bit);
    const xic = elements(plc, 0)[1]!;
    const xio = elements(plc, 1)[1]!;
    // Studio 5000 highlights XIC when the bit is 1 and XIO when it is 0 — regardless of power flow.
    expect(live(plc).elements[xic.id]).toEqual({ in: rci, out: rci && bit, active: bit });
    expect(live(plc).elements[xio.id]).toEqual({ in: rci, out: rci && !bit, active: !bit });
    expect(live(plc).rungs).toEqual([rci && bit, rci && !bit]);
  });
});

describe('OTE / OTL / OTU', () => {
  it('OTE writes the rung condition every scan', () => {
    const plc = runLogic(['XIC(A)OTE(Out);'], [bool('A'), bool('Out')]);
    plc.tags.writeBool('A', true);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(true);
    plc.tags.writeBool('A', false);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(false);
  });

  it('OTL/OTU latch and unlatch; false rungs leave the bit alone', () => {
    const plc = runLogic(['XIC(Set)OTL(Latch);', 'XIC(Reset)OTU(Latch);'], [bool('Set'), bool('Reset'), bool('Latch')]);
    plc.tags.writeBool('Set', true);
    plc.scan(10);
    plc.tags.writeBool('Set', false);
    plc.scan(10);
    expect(plc.tags.readBool('Latch')).toBe(true);
    plc.tags.writeBool('Reset', true);
    plc.scan(10);
    expect(plc.tags.readBool('Latch')).toBe(false);
    plc.tags.writeBool('Reset', false);
    plc.scan(10);
    expect(plc.tags.readBool('Latch')).toBe(false);
  });

  it('output instructions pass the rung condition through (inline outputs)', () => {
    const plc = runLogic(['XIC(A)OTE(First)XIC(B)OTE(Second);'], [bool('A'), bool('B'), bool('First'), bool('Second')]);
    plc.tags.writeBool('A', true);
    plc.scan(10);
    expect(plc.tags.readBool('First')).toBe(true);
    expect(plc.tags.readBool('Second')).toBe(false);
    plc.tags.writeBool('B', true);
    plc.scan(10);
    expect(plc.tags.readBool('Second')).toBe(true);
  });
});

describe('one shots', () => {
  it('ONS passes power for one scan per false→true transition', () => {
    const plc = runLogic(['XIC(PB)ONS(PB_ONS)OTE(Pulse);'], [bool('PB'), bool('PB_ONS'), bool('Pulse')]);
    const pulses: boolean[] = [];
    for (const pb of [false, true, true, true, false, true, false]) {
      plc.tags.writeBool('PB', pb);
      plc.scan(10);
      pulses.push(plc.tags.readBool('Pulse'));
    }
    expect(pulses).toEqual([false, true, false, false, false, true, false]);
  });

  it('ONS does not fire on the first scan when the rung is already true (prescan sets storage)', () => {
    const plc = runLogic(['XIC(PB)ONS(PB_ONS)OTE(Pulse);'], [bool('PB', { initial: true }), bool('PB_ONS'), bool('Pulse')]);
    plc.scan(10);
    expect(plc.tags.readBool('Pulse')).toBe(false);
    expect(plc.tags.readBool('PB_ONS')).toBe(true);
  });

  it('OSR sets its output bit for one scan on the rising edge', () => {
    const plc = runLogic(['XIC(In)OSR(SB,OB)OTE(Rung_Out);'], [bool('In'), bool('SB'), bool('OB'), bool('Rung_Out')]);
    const ob: boolean[] = [];
    const rungOut: boolean[] = [];
    for (const v of [false, true, true, false, true]) {
      plc.tags.writeBool('In', v);
      plc.scan(10);
      ob.push(plc.tags.readBool('OB'));
      rungOut.push(plc.tags.readBool('Rung_Out'));
    }
    expect(ob).toEqual([false, true, false, false, true]);
    expect(rungOut).toEqual([false, true, true, false, true]);
  });

  it('OSF sets its output bit for one scan on the falling edge', () => {
    const plc = runLogic(['XIC(In)OSF(SB,OB);'], [bool('In'), bool('SB'), bool('OB')]);
    const ob: boolean[] = [];
    for (const v of [false, true, true, false, false, true, false]) {
      plc.tags.writeBool('In', v);
      plc.scan(10);
      ob.push(plc.tags.readBool('OB'));
    }
    expect(ob).toEqual([false, false, false, true, false, false, true]);
  });
});

describe('branches', () => {
  const tags = ['A', 'B', 'C', 'D', 'Out', 'O1', 'O2'].map((n) => bool(n));

  it('ORs parallel legs and handles nested branches', () => {
    const plc = runLogic(['[XIC(A),XIC(B)[XIC(C),XIC(D)]]OTE(Out);'], tags);
    const table: Array<[string, boolean]> = [
      ['', false],
      ['A', true],
      ['B', false],
      ['BC', true],
      ['BD', true],
      ['CD', false],
    ];
    for (const [on, expected] of table) {
      for (const n of ['A', 'B', 'C', 'D']) plc.tags.writeBool(n, on.includes(n));
      plc.scan(10);
      expect(plc.tags.readBool('Out'), `inputs ${on || 'none'}`).toBe(expected);
    }
  });

  it('executes every leg (outputs on false legs are written false)', () => {
    const plc = runLogic(['XIC(A)[OTE(O1),XIC(B)OTE(O2)];'], tags);
    plc.tags.writeBool('A', true);
    plc.tags.writeBool('B', true);
    plc.scan(10);
    expect([plc.tags.readBool('O1'), plc.tags.readBool('O2')]).toEqual([true, true]);
    plc.tags.writeBool('A', false);
    plc.scan(10);
    expect([plc.tags.readBool('O1'), plc.tags.readBool('O2')]).toEqual([false, false]);
  });

  it('reports branch live state (in = rung-condition-in, out = OR of legs)', () => {
    const plc = runLogic(['XIC(A)[XIC(B),XIC(C)]OTE(Out);'], tags);
    plc.tags.writeBool('A', true);
    plc.tags.writeBool('C', true);
    plc.scan(10);
    const els = elements(plc, 0);
    const br = els[1] as BranchNode;
    const legB = br.legs[0]![0] as InstructionNode;
    const legC = br.legs[1]![0] as InstructionNode;
    const l = live(plc);
    expect(l.elements[br.id]).toEqual({ in: true, out: true, active: true });
    expect(l.elements[legB.id]).toEqual({ in: true, out: false, active: false });
    expect(l.elements[legC.id]).toEqual({ in: true, out: true, active: true });
    expect(l.elements[els[2]!.id]).toEqual({ in: true, out: true, active: true });
    expect(l.rungs[0]).toBe(true);
  });

  it('reuses live state objects between scans (no per-scan allocation)', () => {
    const plc = runLogic(['XIC(A)OTE(Out);'], tags);
    plc.scan(10);
    const first = live(plc);
    const el = first.elements[elements(plc, 0)[0]!.id];
    plc.tags.writeBool('A', true);
    plc.scan(10);
    expect(live(plc)).toBe(first);
    expect(live(plc).elements[elements(plc, 0)[0]!.id]).toBe(el);
    expect(el?.active).toBe(true);
  });
});
