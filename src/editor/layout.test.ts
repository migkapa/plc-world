import { describe, expect, it } from 'vitest';
import { instructionsOf, parseRung } from '@/plc/neutralText';
import type { Rung } from '@/plc/types';
import {
  LD,
  ellipsize,
  evalPower,
  glyphOf,
  isLiteral,
  isTagOperand,
  layoutRung,
  nearestGap,
  powerKey,
  textWidth,
  wrapText,
  type BranchLayout,
  type InstrLayout,
  type RungLayout,
} from './layout';

const instr = (l: RungLayout, r: Rung, i: number): InstrLayout => l.byId[instructionsOf(r.elements)[i]!.id] as InstrLayout;
const branches = (l: RungLayout): BranchLayout[] => l.nodes.filter((n): n is BranchLayout => n.kind === 'branch');

describe('text metrics', () => {
  it('measures monospace exactly and wraps words', () => {
    expect(textWidth('ABCD', 'mono', 10)).toBeCloseTo(24);
    expect(textWidth('iii', 'sans', 10)).toBeLessThan(textWidth('MMM', 'sans', 10));
    const lines = wrapText('Green flush push button normally open', 80, 'sans', 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l, 'sans', 10)).toBeLessThanOrEqual(80);
    const cut = wrapText('one two three four five six seven eight nine ten', 40, 'sans', 10, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1]!.endsWith('…')).toBe(true);
    expect(wrapText('Supercalifragilisticexpialidocious', 50, 'mono', 10).length).toBeGreaterThan(1);
    expect(ellipsize('abcdef', 4)).toBe('abc…');
  });

  it('recognises literals and tag operands', () => {
    expect(isLiteral('5000')).toBe(true);
    expect(isLiteral('-1.5e3')).toBe(true);
    expect(isLiteral('16#FF')).toBe(true);
    expect(isLiteral('Timer1')).toBe(false);
    expect(isTagOperand('Timer1.ACC')).toBe(true);
    expect(isTagOperand('?')).toBe(false);
    expect(isTagOperand('100')).toBe(false);
  });

  it('maps mnemonics to glyphs', () => {
    expect(glyphOf('XIC').glyph).toBe('xic');
    expect(glyphOf('otl')).toMatchObject({ display: 'coil', text: 'L' });
    expect(glyphOf('RES')).toMatchObject({ display: 'coil', text: 'RES' });
    expect(glyphOf('ONS')).toMatchObject({ display: 'contact', text: 'ONS' });
    expect(glyphOf('TON').display).toBe('box');
    expect(glyphOf('FOO')).toMatchObject({ display: 'box', known: false });
  });
});

describe('layoutRung', () => {
  it('lays out a series left to right and right-justifies the output', () => {
    const r = parseRung('XIC(Start)XIO(Stop)OTE(Motor);');
    const l = layoutRung(r, { width: 900 });
    expect(l.width).toBe(900);
    expect(l.railL).toBe(LD.margin);
    expect(l.railR).toBe(900 - LD.rightPad);
    const [a, b, c] = [instr(l, r, 0), instr(l, r, 1), instr(l, r, 2)];
    expect(a.x).toBe(l.railL + LD.gap);
    expect(b.x).toBe(a.x + a.w + LD.gap);
    expect(c.x + c.w).toBe(l.railR - LD.gap);
    for (const n of [a, b, c]) expect(n.y).toBe(l.y);
    expect(a.glyph).toBe('xic');
    expect(c.display).toBe('coil');
    // tag text sits above the glyph
    expect(a.operands[0]!.y).toBeLessThan(a.sym.y);
    // wires: rail → A, A → B, B → C, C → rail + lead wires of the 3 glyphs
    const series = l.wires.filter((w) => w.gap && !w.gap.legPath);
    expect(series.map((w) => w.gap!.index)).toEqual([0, 1, 2, 3]);
    expect(series[0]!.x1).toBe(l.railL);
    expect(series[3]!.x2).toBe(l.railR);
    expect(powerKey(series[1]!.power)).toBe(`in:${b.id}`);
    expect(powerKey(series[3]!.power)).toBe(`out:${c.id}`);
    expect(l.gaps).toHaveLength(4);
  });

  it('grows beyond the minimum width for long rungs', () => {
    const r = parseRung(Array.from({ length: 12 }, (_, i) => `XIC(Tag_${i})`).join('') + 'OTE(Out);');
    const l = layoutRung(r, { width: 400 });
    expect(l.width).toBeGreaterThan(400);
    const last = instr(l, r, 12);
    expect(last.x + last.w).toBe(l.railR - LD.gap);
  });

  it('stacks branch legs and wires connectors with power refs', () => {
    const r = parseRung('[XIC(Start),XIC(Motor)]XIO(Stop)OTE(Motor);');
    const l = layoutRung(r, { width: 800 });
    const [br] = branches(l);
    expect(br).toBeDefined();
    expect(br!.legYs).toHaveLength(2);
    expect(br!.legYs[0]).toBe(l.y);
    expect(br!.legYs[1]).toBeGreaterThan(l.y);
    const start = instr(l, r, 0);
    const seal = instr(l, r, 1);
    expect(start.y).toBe(l.y);
    expect(seal.y).toBe(br!.legYs[1]);
    expect(seal.top).toBeGreaterThan(start.bottom);
    // leg start aligned with the branch
    expect(start.x).toBe(br!.x + LD.gap);
    expect(seal.x).toBe(br!.x + LD.gap);
    const verticals = l.wires.filter((w) => w.x1 === w.x2);
    expect(verticals.map((w) => powerKey(w.power)).sort()).toEqual([`in:${br!.id}`, `out:${seal.id}`].sort());
    // the rung height accommodates the lower leg
    expect(l.height).toBeGreaterThan(seal.bottom);
    const legGaps = l.gaps.filter((g) => g.legPath?.branchId === br!.id);
    expect(legGaps.filter((g) => g.legPath!.leg === 1).map((g) => g.index)).toEqual([0, 1]);
  });

  it('right-justifies outputs inside output branches', () => {
    const r = parseRung('XIC(A)[OTE(B),XIC(C)OTE(D)]');
    const l = layoutRung(r, { width: 900 });
    const [br] = branches(l);
    expect(br!.x2).toBe(l.railR - LD.gap);
    const b = instr(l, r, 1);
    const d = instr(l, r, 3);
    expect(b.x + b.w).toBe(br!.x2 - LD.gap);
    expect(d.x + d.w).toBe(br!.x2 - LD.gap);
    const right = l.wires.filter((w) => w.x1 === br!.x2 && w.x2 === br!.x2);
    expect(right).toHaveLength(1);
    expect(powerKey(right[0]!.power)).toBe(`out:${d.id}`);
  });

  it('draws empty legs as shorts across the branch', () => {
    const r = parseRung('XIC(A)[XIC(B),,XIO(C)]OTE(D);');
    const l = layoutRung(r, { width: 900 });
    const [br] = branches(l);
    expect(br!.legYs).toHaveLength(3);
    const empty = l.wires.find((w) => w.gap?.legPath?.leg === 1)!;
    expect(empty.x1).toBe(br!.x);
    expect(empty.x2).toBe(br!.x2);
    expect(powerKey(empty.power)).toBe(`in:${br!.id}`);
    const right = l.wires.filter((w) => w.x1 === br!.x2 && w.x2 === br!.x2);
    expect(right).toHaveLength(2);
    expect(right[0]!.power.t).toBe('any');
  });

  it('nests branches', () => {
    const r = parseRung('XIC(A)[XIC(B),XIO(C)[XIC(D),XIC(E)]]OTE(F);');
    const l = layoutRung(r, { width: 1000 });
    const bs = branches(l);
    expect(bs).toHaveLength(2);
    const inner = bs.find((b) => b.legPath)!;
    const outer = bs.find((b) => !b.legPath)!;
    expect(inner.legPath!.branchId).toBe(outer.id);
    expect(inner.y).toBe(outer.legYs[1]);
    expect(outer.x2).toBeGreaterThanOrEqual(inner.x2 + LD.gap);
    const e = instr(l, r, 4);
    expect(e.y).toBe(inner.legYs[1]);
    expect(l.height).toBeGreaterThan(e.bottom);
  });

  it('lays out box instructions with operand rows and status bits', () => {
    const r = parseRung('XIC(Run)TON(Timer1,5000,0);');
    const l = layoutRung(r, { width: 700, showValues: true });
    const ton = instr(l, r, 1);
    expect(ton.display).toBe('box');
    expect(ton.operands.map((o) => [o.label, o.text])).toEqual([
      ['Timer', 'Timer1'],
      ['Preset', '5000'],
      ['Accum', '0'],
    ]);
    expect(ton.operands[1]!.inlineValue).toBe('Timer1.PRE');
    expect(ton.operands[2]!.inlineValue).toBe('Timer1.ACC');
    expect(ton.status.map((s) => [s.bit, s.operand])).toEqual([
      ['EN', 'Timer1.EN'],
      ['DN', 'Timer1.DN'],
    ]);
    expect(ton.status[0]!.y).toBe(l.y);
    expect(ton.status[1]!.y).toBeGreaterThan(l.y);
    expect(ton.sym.y).toBeLessThan(l.y);
    expect(ton.sym.y + ton.sym.h).toBeLessThanOrEqual(ton.bottom);
    // rows go down the box
    expect(ton.operands[0]!.y).toBeLessThan(ton.operands[1]!.y);
    expect(ton.texts.find((t) => t.cls === 'mnemonic')!.text).toBe('TON');
    expect(ton.texts.find((t) => t.cls === 'name')!.text).toBe('Timer On Delay');
    // the timer box is the rung's trailing output → right-justified
    expect(ton.x + ton.w).toBe(l.railR - LD.gap);
  });

  it('adds value lines under tag operands of compare/math boxes when online', () => {
    const r = parseRung('GRT(Level,50.0)MOV(Level,Out);');
    const off = layoutRung(r, { width: 700 });
    const on = layoutRung(r, { width: 700, showValues: true });
    const grtOn = instr(on, r, 0);
    expect(grtOn.values.map((v) => v.operand)).toEqual(['Level']);
    expect(instr(off, r, 0).values).toEqual([]);
    expect(instr(on, r, 1).values.map((v) => v.operand)).toEqual(['Level', 'Out']);
    expect(grtOn.sym.h).toBeGreaterThan(instr(off, r, 0).sym.h);
    expect(grtOn.status).toEqual([]);
  });

  it('shows descriptions and alias targets above contacts', () => {
    const r = parseRung('XIC(Start_PB)OTE(Motor);');
    const l = layoutRung(r, {
      width: 600,
      tagMeta: (op) => (op === 'Start_PB' ? { description: 'Green start push button on the operator station', aliasFor: 'Local:1:I.Data.0' } : undefined),
    });
    const x = instr(l, r, 0);
    const desc = x.texts.filter((t) => t.cls === 'desc');
    expect(desc.length).toBeGreaterThanOrEqual(2);
    expect(desc.length).toBeLessThanOrEqual(LD.descMaxLines);
    const alias = x.texts.find((t) => t.cls === 'alias')!;
    expect(alias.text).toBe('<Local:1:I.Data.0>');
    expect(alias.y).toBeGreaterThan(x.operands[0]!.y);
    expect(desc[desc.length - 1]!.y).toBeLessThan(x.operands[0]!.y);
    expect(x.top).toBeLessThan(desc[0]!.y - 8);
    const plain = layoutRung(r, { width: 600 });
    expect(plain.y - instr(plain, r, 0).top).toBeLessThan(l.y - x.top);
  });

  it('draws a comment box above the logic', () => {
    const r = parseRung('XIC(A)OTE(B);', 'Start/stop station with seal-in. The motor keeps running after the start button is released.');
    const l = layoutRung(r, { width: 500 });
    expect(l.comment).toBeDefined();
    expect(l.comment!.lines.length).toBeGreaterThan(1);
    expect(l.bodyTop).toBeGreaterThan(l.comment!.y);
    expect(instr(l, r, 0).top).toBeGreaterThan(l.comment!.y + l.comment!.h);
    expect(layoutRung(r, { width: 500, showComment: false }).comment).toBeUndefined();
  });

  it('handles empty rungs, unknown instructions and variadic operands', () => {
    const empty = layoutRung(parseRung(''), { width: 500 });
    expect(empty.nodes).toEqual([]);
    expect(empty.wires).toHaveLength(1);
    expect(empty.wires[0]!.power).toEqual({ t: 'rail' });
    expect(empty.gaps).toHaveLength(1);
    expect(empty.height).toBeGreaterThanOrEqual(LD.minHeight);
    const r = parseRung('FOO(A,B)JSR(Sub,1,In1)');
    const l = layoutRung(r, { width: 700 });
    const foo = instr(l, r, 0);
    expect(foo.known).toBe(false);
    expect(foo.operands.map((o) => o.label)).toEqual(['Operand 0', 'Operand 1']);
    const jsr = instr(l, r, 1);
    expect(jsr.operands.map((o) => o.label)).toEqual(['Routine Name', 'Input Count', 'Input Par']);
  });

  it('finds the nearest insertion gap', () => {
    const r = parseRung('[XIC(A),XIC(B)]OTE(C);');
    const l = layoutRung(r, { width: 700 });
    const [br] = branches(l);
    const b = instr(l, r, 1);
    const g = nearestGap(l, b.x + b.w + 4, br!.legYs[1]!)!;
    expect(g.legPath).toEqual({ branchId: br!.id, leg: 1 });
    expect(g.index).toBe(1);
    const g0 = nearestGap(l, l.railL + 2, l.y)!;
    expect(g0.legPath).toBeUndefined();
    expect(g0.index).toBe(0);
  });

  it('evaluates power refs', () => {
    const live = { a: { in: true, out: false }, b: { in: false, out: true } };
    expect(evalPower({ t: 'rail' }, live, true)).toBe(true);
    expect(evalPower({ t: 'in', id: 'a' }, live, true)).toBe(true);
    expect(evalPower({ t: 'out', id: 'a' }, live, true)).toBe(false);
    expect(evalPower({ t: 'any', refs: [{ t: 'out', id: 'a' }, { t: 'out', id: 'b' }] }, live, true)).toBe(true);
    expect(evalPower({ t: 'in', id: 'zz' }, live, true)).toBe(false);
  });

  it('lays out 100 rungs quickly', () => {
    const rungs = Array.from({ length: 100 }, (_, i) =>
      parseRung(`XIC(A_${i})[XIC(B_${i}),XIO(C_${i})]XIO(D)TON(T_${i},1000,0)OTE(Out_${i});`),
    );
    const t0 = performance.now();
    for (const r of rungs) layoutRung(r, { width: 1200, showValues: true });
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
