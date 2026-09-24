import { describe, expect, it } from 'vitest';
import { parseRung, serializeRung, instructionsOf } from '@/plc/neutralText';
import type { BranchNode, InstructionNode, Rung } from '@/plc/types';
import {
  EditHistory,
  QuickEntryError,
  addBranchLevel,
  addRung,
  addRungBefore,
  adjacentRung,
  clipboardFromText,
  clipboardToText,
  copyElements,
  defaultOperands,
  deleteRung,
  duplicateRung,
  insertAt,
  insertAtEnd,
  insertAtStart,
  insertBranch,
  insertPointFor,
  insertRelative,
  insertRung,
  locateElement,
  moveElement,
  moveElementTo,
  moveRung,
  newInstruction,
  nextInstruction,
  nextOperand,
  normalizeSelection,
  parseQuickEntry,
  pasteElements,
  pasteRungs,
  removeElement,
  removeLeg,
  replaceRungFromText,
  selectionAfterRemoval,
  setMnemonic,
  setOperand,
  setRungComment,
  trailingOutputStart,
  wrapInBranch,
} from './ops';

const text = (r: Rung | undefined): string => (r ? serializeRung(r) : '<none>');
const rungsOf = (...t: string[]): Rung[] => t.map((x) => parseRung(x));
const idOf = (r: Rung, i: number): string => instructionsOf(r.elements)[i]!.id;
const branchOf = (r: Rung, id?: string): BranchNode => {
  const out: BranchNode[] = [];
  const visit = (s: Rung['elements']): void =>
    s.forEach((e) => {
      if (e.kind === 'branch') {
        out.push(e);
        e.legs.forEach(visit);
      }
    });
  visit(r.elements);
  return id ? out.find((b) => b.id === id)! : out[0]!;
};

describe('insert', () => {
  it('inserts before/after an element and keeps untouched objects', () => {
    const rungs = rungsOf('XIC(A)OTE(B);', 'XIC(C)OTE(D);');
    const r0 = rungs[0]!;
    const out = insertRelative(rungs, r0.id, idOf(r0, 0), 'after', newInstruction('XIO', ['S']));
    expect(text(out[0])).toBe('XIC(A)XIO(S)OTE(B);');
    expect(out[1]).toBe(rungs[1]);
    expect(out[0]!.elements[0]).toBe(r0.elements[0]);
    expect(rungs[0]).toBe(r0); // input untouched
    const before = insertRelative(rungs, r0.id, idOf(r0, 1), 'before', newInstruction('XIO', ['S']));
    expect(text(before[0])).toBe('XIC(A)XIO(S)OTE(B);');
  });

  it('inserts at rung/leg start and end', () => {
    const rungs = rungsOf('[XIC(A),XIC(B)]OTE(C);');
    const r = rungs[0]!;
    const br = branchOf(r);
    expect(text(insertAtStart(rungs, r.id, newInstruction('XIC', ['S']))[0])).toBe('XIC(S)[XIC(A),XIC(B)]OTE(C);');
    expect(text(insertAtEnd(rungs, r.id, newInstruction('OTE', ['X']))[0])).toBe('[XIC(A),XIC(B)]OTE(C)OTE(X);');
    expect(text(insertAtEnd(rungs, r.id, newInstruction('XIO', ['Y']), { branchId: br.id, leg: 1 })[0])).toBe(
      '[XIC(A),XIC(B)XIO(Y)]OTE(C);',
    );
    expect(text(insertAtStart(rungs, r.id, newInstruction('XIO', ['Y']), { branchId: br.id, leg: 0 })[0])).toBe(
      '[XIO(Y)XIC(A),XIC(B)]OTE(C);',
    );
  });

  it('ignores unknown rungs / series and empty inserts', () => {
    const rungs = rungsOf('XIC(A)OTE(B);');
    expect(insertAt(rungs, { rungId: 'nope', index: 0 }, newInstruction('XIC'))).toBe(rungs);
    expect(insertAt(rungs, { rungId: rungs[0]!.id, legPath: { branchId: 'x', leg: 0 }, index: 0 }, newInstruction('XIC'))).toBe(rungs);
    expect(insertAt(rungs, { rungId: rungs[0]!.id, index: 0 }, [])).toBe(rungs);
    expect(text(insertAt(rungs, { rungId: rungs[0]!.id, index: 99 }, newInstruction('OTE', ['Z']))[0])).toBe('XIC(A)OTE(B)OTE(Z);');
  });

  it('computes the palette insert point for a selection', () => {
    const r = parseRung('XIC(A)XIO(B)OTE(C)OTE(D);');
    expect(trailingOutputStart(r.elements)).toBe(2);
    expect(insertPointFor(r, { rungId: r.id }, 'XIC')).toEqual({ rungId: r.id, index: 2 });
    expect(insertPointFor(r, { rungId: r.id }, 'OTE')).toEqual({ rungId: r.id, index: 4 });
    expect(insertPointFor(r, { rungId: r.id, elementId: idOf(r, 0) }, 'OTE')).toEqual({ rungId: r.id, index: 1 });
    expect(insertPointFor(r, { rungId: r.id, wireIndex: 3 }, 'XIC')).toEqual({ rungId: r.id, index: 3 });
    expect(insertPointFor(r, null, 'XIC')).toEqual({ rungId: r.id, index: 2 });
    const b = parseRung('XIC(A)[OTE(B),XIC(C)OTE(D)];');
    expect(trailingOutputStart(b.elements)).toBe(1);
    const br = branchOf(b);
    expect(insertPointFor(b, { rungId: b.id, legPath: { branchId: br.id, leg: 1 } }, 'XIC')).toEqual({
      rungId: b.id,
      legPath: { branchId: br.id, leg: 1 },
      index: 2,
    });
  });
});

describe('remove', () => {
  it('removes a series instruction', () => {
    const rungs = rungsOf('XIC(A)XIO(B)OTE(C);');
    const r = rungs[0]!;
    expect(text(removeElement(rungs, r.id, idOf(r, 1))[0])).toBe('XIC(A)OTE(C);');
  });

  it('removes an emptied leg and collapses a single-leg branch into the series', () => {
    const rungs = rungsOf('[XIC(A)XIC(E),XIC(B)]OTE(C);');
    const r = rungs[0]!;
    expect(text(removeElement(rungs, r.id, idOf(r, 2))[0])).toBe('XIC(A)XIC(E)OTE(C);');
    const three = rungsOf('[XIC(A),XIC(B),XIC(D)]OTE(C);');
    expect(text(removeElement(three, three[0]!.id, idOf(three[0]!, 1))[0])).toBe('[XIC(A),XIC(D)]OTE(C);');
  });

  it('keeps empty legs as shorts only when valid', () => {
    const rungs = rungsOf('[XIC(A),XIC(B)]OTE(C);');
    const r = rungs[0]!;
    expect(text(removeElement(rungs, r.id, idOf(r, 1), { keepEmptyLegs: true })[0])).toBe('[XIC(A),]OTE(C);');
    // at the end of the rung an empty leg is invalid → removed and collapsed
    const end = rungsOf('XIC(A)[OTE(B),OTE(C)];');
    expect(text(removeElement(end, end[0]!.id, idOf(end[0]!, 2), { keepEmptyLegs: true })[0])).toBe('XIC(A)OTE(B);');
  });

  it('cascades through nested branches', () => {
    const rungs = rungsOf('[XIC(A),[XIC(B),XIC(D)]]OTE(C);');
    const r = rungs[0]!;
    const once = removeElement(rungs, r.id, idOf(r, 1));
    expect(text(once[0])).toBe('[XIC(A),XIC(D)]OTE(C);');
    const twice = removeElement(once, r.id, idOf(r, 2));
    expect(text(twice[0])).toBe('XIC(A)OTE(C);');
  });

  it('removes whole branches and branch legs', () => {
    const rungs = rungsOf('XIC(S)[XIC(A),XIC(B)]OTE(C);');
    const r = rungs[0]!;
    const br = branchOf(r);
    expect(text(removeElement(rungs, r.id, br.id)[0])).toBe('XIC(S)OTE(C);');
    expect(text(removeLeg(rungs, r.id, br.id, 0)[0])).toBe('XIC(S)XIC(B)OTE(C);');
  });

  it('drops a branch whose legs are all empty', () => {
    const rungs = rungsOf('XIC(A)[,]OTE(C);');
    const r = rungs[0]!;
    const br = branchOf(r);
    expect(text(removeLeg(rungs, r.id, br.id, 1)[0])).toBe('XIC(A)OTE(C);');
  });
});

describe('branches', () => {
  it('wraps an element range in a branch with an empty lower leg', () => {
    const rungs = rungsOf('XIC(A)XIO(B)OTE(C);');
    const r = rungs[0]!;
    const res = wrapInBranch(rungs, r.id, [idOf(r, 1), idOf(r, 0)]);
    expect(text(res.rungs[0])).toBe('[XIC(A)XIO(B),]OTE(C);');
    expect(res.branchId).toBeTruthy();
    // non contiguous → refused
    const three = rungsOf('XIC(A)XIO(B)XIC(D)OTE(C);');
    expect(wrapInBranch(three, three[0]!.id, [idOf(three[0]!, 0), idOf(three[0]!, 2)]).rungs).toBe(three);
  });

  it('inserts an empty branch and adds branch levels', () => {
    const rungs = rungsOf('XIC(A)OTE(C);');
    const r = rungs[0]!;
    const res = insertBranch(rungs, { rungId: r.id, index: 1 });
    expect(text(res.rungs[0])).toBe('XIC(A)[,]OTE(C);');
    const lvl = addBranchLevel(res.rungs, r.id, res.branchId);
    expect(text(lvl.rungs[0])).toBe('XIC(A)[,,]OTE(C);');
    expect(lvl.legPath).toEqual({ branchId: res.branchId, leg: 2 });
    const mid = addBranchLevel(res.rungs, r.id, res.branchId, 0);
    expect(mid.legPath!.leg).toBe(1);
  });
});

describe('move', () => {
  it('moves an element left/right within its series', () => {
    const rungs = rungsOf('XIC(A)XIO(B)OTE(C);');
    const r = rungs[0]!;
    expect(text(moveElement(rungs, r.id, idOf(r, 1), -1)[0])).toBe('XIO(B)XIC(A)OTE(C);');
    expect(moveElement(rungs, r.id, idOf(r, 0), -1)).toBe(rungs);
  });

  it('moves an element to another place (drag & drop)', () => {
    const rungs = rungsOf('XIC(A)XIO(B)OTE(C);', 'XIC(D)OTE(E);');
    const [r0, r1] = rungs as [Rung, Rung];
    expect(text(moveElementTo(rungs, r0.id, idOf(r0, 0), { rungId: r0.id, index: 2 })[0])).toBe('XIO(B)XIC(A)OTE(C);');
    expect(moveElementTo(rungs, r0.id, idOf(r0, 0), { rungId: r0.id, index: 1 })).toBe(rungs);
    const across = moveElementTo(rungs, r0.id, idOf(r0, 1), { rungId: r1.id, index: 1 });
    expect(text(across[0])).toBe('XIC(A)OTE(C);');
    expect(text(across[1])).toBe('XIC(D)XIO(B)OTE(E);');
  });

  it('moving the last element out of a leg normalises the branch; a branch cannot move into itself', () => {
    const rungs = rungsOf('[XIC(A),XIC(B)]OTE(C);');
    const r = rungs[0]!;
    const out = moveElementTo(rungs, r.id, idOf(r, 1), { rungId: r.id, index: 0 });
    expect(text(out[0])).toBe('XIC(B)XIC(A)OTE(C);');
    const br = branchOf(r);
    expect(moveElementTo(rungs, r.id, br.id, { rungId: r.id, legPath: { branchId: br.id, leg: 0 }, index: 0 })).toBe(rungs);
  });

  it('moves rungs', () => {
    const rungs = rungsOf('OTE(A);', 'OTE(B);');
    expect(moveRung(rungs, rungs[1]!.id, -1).map((r) => text(r))).toEqual(['OTE(B);', 'OTE(A);']);
    expect(moveRung(rungs, rungs[0]!.id, -1)).toBe(rungs);
  });
});

describe('instructions', () => {
  it('changes the mnemonic keeping compatible operands', () => {
    const rungs = rungsOf('XIC(A)TON(T1,5000,0);');
    const r = rungs[0]!;
    expect(text(setMnemonic(rungs, r.id, idOf(r, 0), 'xio')[0])).toBe('XIO(A)TON(T1,5000,0);');
    expect(text(setMnemonic(rungs, r.id, idOf(r, 1), 'TOF')[0])).toBe('XIC(A)TOF(T1,5000,0);');
    // TIMER operand is not a COUNTER → '?', Preset/Accum kept by name
    expect(text(setMnemonic(rungs, r.id, idOf(r, 1), 'CTU')[0])).toBe('XIC(A)CTU(?,5000,0);');
    // BOOL → numeric compare: operands reset
    expect(text(setMnemonic(rungs, r.id, idOf(r, 0), 'EQU')[0])).toBe('EQU(?,?)TON(T1,5000,0);');
    const mov = rungsOf('MOV(Src,Dst);');
    expect(text(setMnemonic(mov, mov[0]!.id, idOf(mov[0]!, 0), 'ADD')[0])).toBe('ADD(Src,?,Dst);');
    expect(setMnemonic(rungs, r.id, idOf(r, 0), 'XIC')).toBe(rungs);
  });

  it('sets operand text', () => {
    const rungs = rungsOf('XIC(?)OTE(B);');
    const r = rungs[0]!;
    const out = setOperand(rungs, r.id, idOf(r, 0), 0, ' Start_PB ');
    expect(text(out[0])).toBe('XIC(Start_PB)OTE(B);');
    expect(setOperand(out, r.id, idOf(r, 0), 0, 'Start_PB')).toBe(out);
    expect(text(setOperand(rungs, r.id, idOf(r, 0), 0, '')[0])).toBe('XIC(?)OTE(B);');
  });

  it('builds new instructions with default operands', () => {
    expect(defaultOperands('TON')).toEqual(['?', '?', '0']);
    expect(defaultOperands('XIC')).toEqual(['?']);
    expect(defaultOperands('JSR')).toEqual(['?']);
    expect(defaultOperands('NOP')).toEqual([]);
    expect(newInstruction('ton', ['T1']).operands).toEqual(['T1', '?', '0']);
    expect(newInstruction('ton').op).toBe('TON');
  });
});

describe('rungs', () => {
  it('adds, inserts, duplicates and deletes rungs', () => {
    const rungs = rungsOf('OTE(A);', 'OTE(B);');
    const add = addRung(rungs, rungs[0]!.id);
    expect(add.rungs.map((r) => text(r))).toEqual(['OTE(A);', ';', 'OTE(B);']);
    expect(addRung(rungs).rungs.map((r) => text(r))).toEqual(['OTE(A);', 'OTE(B);', ';']);
    expect(addRungBefore(rungs, rungs[1]!.id).rungs.map((r) => text(r))).toEqual(['OTE(A);', ';', 'OTE(B);']);
    expect(insertRung(rungs, 0).length).toBe(3);
    const dup = duplicateRung(rungs, rungs[1]!.id);
    expect(dup.rungs.map((r) => text(r))).toEqual(['OTE(A);', 'OTE(B);', 'OTE(B);']);
    expect(dup.rung!.id).not.toBe(rungs[1]!.id);
    expect(idOf(dup.rung!, 0)).not.toBe(idOf(rungs[1]!, 0));
    expect(deleteRung(rungs, rungs[0]!.id).map((r) => text(r))).toEqual(['OTE(B);']);
  });

  it('sets and clears rung comments', () => {
    const rungs = rungsOf('OTE(A);');
    const withC = setRungComment(rungs, rungs[0]!.id, 'Start the motor  ');
    expect(withC[0]!.comment).toBe('Start the motor');
    const cleared = setRungComment(withC, rungs[0]!.id, '');
    expect('comment' in cleared[0]!).toBe(false);
    expect(setRungComment(rungs, rungs[0]!.id, undefined)).toBe(rungs);
  });

  it('replaces a rung from neutral text keeping ids where the structure matches', () => {
    const rungs = [parseRung('XIC(A)OTE(B);', 'Motor')];
    const r = rungs[0]!;
    const res = replaceRungFromText(rungs, r.id, 'XIC(A)XIO(S)OTE(B);');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const nr = res.rungs[0]!;
    expect(nr.id).toBe(r.id);
    expect(nr.comment).toBe('Motor');
    expect(text(nr)).toBe('XIC(A)XIO(S)OTE(B);');
    expect(idOf(nr, 0)).toBe(idOf(r, 0));
    const bad = replaceRungFromText(rungs, r.id, 'XIC(A');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Unterminated/);
  });
});

describe('clipboard', () => {
  it('copies and pastes elements with fresh ids', () => {
    const rungs = rungsOf('XIC(A)[XIC(B),XIC(C)]OTE(D);');
    const r = rungs[0]!;
    const br = branchOf(r);
    const clip = copyElements(r, [br.id, idOf(r, 0)]);
    expect(clip.map((e) => e.kind)).toEqual(['instr', 'branch']);
    const res = pasteElements(rungs, { rungId: r.id, index: 0 }, clip);
    expect(text(res.rungs[0])).toBe('XIC(A)[XIC(B),XIC(C)]XIC(A)[XIC(B),XIC(C)]OTE(D);');
    expect(res.ids).not.toContain(idOf(r, 0));
    const ids = instructionsOf(res.rungs[0]!.elements).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pastes rungs with fresh ids and converts clipboards to/from text', () => {
    const rungs = rungsOf('OTE(A);', 'OTE(B);');
    const res = pasteRungs(rungs, 1, [rungs[1]!]);
    expect(res.rungs.map((r) => text(r))).toEqual(['OTE(A);', 'OTE(B);', 'OTE(B);']);
    expect(res.ids[0]).not.toBe(rungs[1]!.id);
    expect(clipboardToText({ kind: 'rungs', rungs })).toBe('OTE(A);\nOTE(B);');
    const c = clipboardFromText('XIC(A)OTE(B);\nXIC(C)OTE(D);');
    expect(c?.kind).toBe('rungs');
    expect(c?.kind === 'rungs' && c.rungs.length).toBe(2);
    expect(clipboardFromText('XIC(A)')?.kind).toBe('elements');
    expect(clipboardFromText('hello world(')).toBeUndefined();
  });
});

describe('quick entry', () => {
  const q = (s: string): string => serializeRung({ elements: parseQuickEntry(s) });
  it('parses Studio ASCII entry', () => {
    expect(q('XIC Start_PB')).toBe('XIC(Start_PB);');
    expect(q('xic Start_PB xio Stop_PB ote Motor')).toBe('XIC(Start_PB)XIO(Stop_PB)OTE(Motor);');
    expect(q('TON Timer1 5000')).toBe('TON(Timer1,5000,0);');
    expect(q('TON Timer1,5000,0')).toBe('TON(Timer1,5000,0);');
    expect(q('XIC')).toBe('XIC(?);');
    expect(q('MOV Arr[Idx + 1] Dest')).toBe('MOV(Arr[Idx + 1],Dest);');
  });

  it('parses BST/NXB/BND branches and neutral text', () => {
    expect(q('BST XIC Start NXB XIC Motor BND XIO Stop OTE Motor')).toBe('[XIC(Start),XIC(Motor)]XIO(Stop)OTE(Motor);');
    expect(q('XIC(A)[XIC(B),XIC(C)]OTE(D);')).toBe('XIC(A)[XIC(B),XIC(C)]OTE(D);');
    expect(q('BST XIC A')).toBe('[XIC(A),];');
  });

  it('reports unknown instructions and extra operands', () => {
    expect(() => parseQuickEntry('Start_PB')).toThrow(QuickEntryError);
    expect(() => parseQuickEntry('XIC A B')).toThrow(/Too many operands/);
    expect(() => parseQuickEntry('NXB')).toThrow(/NXB without BST/);
    expect(parseQuickEntry('   ')).toEqual([]);
  });
});

describe('navigation & selection', () => {
  const rungs = rungsOf('XIC(A)[XIC(B),XIC(C)]OTE(D);', ';', 'XIC(E)OTE(F);');
  const [r0, r1, r2] = rungs as [Rung, Rung, Rung];

  it('walks instructions in reading order across rungs', () => {
    let sel = nextInstruction(rungs, { rungId: r0.id }, 1);
    const seen: string[] = [];
    for (let i = 0; i < 7 && sel; i++) {
      const loc = sel.elementId ? locateElement(rungs.find((r) => r.id === sel!.rungId)!.elements, sel.elementId) : undefined;
      seen.push(loc ? (loc.element as InstructionNode).operands[0]! : `rung${rungs.findIndex((r) => r.id === sel!.rungId)}`);
      sel = nextInstruction(rungs, sel, 1);
    }
    expect(seen).toEqual(['A', 'B', 'C', 'D', 'rung1', 'E', 'F']);
    expect(nextInstruction(rungs, { rungId: r2.id, elementId: idOf(r2, 1) }, 1)).toEqual({ rungId: r2.id, elementId: idOf(r2, 1) });
    expect(nextInstruction(rungs, { rungId: r2.id, elementId: idOf(r2, 0) }, -1)).toEqual({ rungId: r1.id });
    expect(nextInstruction(rungs, { rungId: r0.id, elementId: branchOf(r0).id }, 1)).toEqual({ rungId: r0.id, elementId: idOf(r0, 1) });
    expect(nextInstruction(rungs, { rungId: r0.id, wireIndex: 1 }, 1)).toEqual({ rungId: r0.id, elementId: idOf(r0, 1) });
  });

  it('moves between rungs and operands', () => {
    expect(adjacentRung(rungs, { rungId: r0.id }, 1)).toEqual({ rungId: r1.id });
    expect(adjacentRung(rungs, { rungId: r0.id }, -1)).toEqual({ rungId: r0.id });
    const t = rungsOf('TON(T1,100,0)OTE(A);');
    const tr = t[0]!;
    expect(nextOperand(t, { rungId: tr.id, elementId: idOf(tr, 0), operandIndex: 1 }, 1)).toEqual({
      rungId: tr.id,
      elementId: idOf(tr, 0),
      operandIndex: 2,
    });
    expect(nextOperand(t, { rungId: tr.id, elementId: idOf(tr, 0), operandIndex: 2 }, 1)).toEqual({
      rungId: tr.id,
      elementId: idOf(tr, 1),
      operandIndex: 0,
    });
  });

  it('normalises selections after edits', () => {
    expect(normalizeSelection(rungs, { rungId: 'gone' }, [...rungs.slice(0, 1), { id: 'gone', elements: [] }])).toEqual({ rungId: r1.id });
    expect(normalizeSelection(rungs, { rungId: r0.id, elementId: 'gone' })).toEqual({ rungId: r0.id });
    expect(normalizeSelection(rungs, { rungId: r0.id, elementId: idOf(r0, 0), operandIndex: 5 })).toEqual({ rungId: r0.id, elementId: idOf(r0, 0) });
    expect(normalizeSelection([], { rungId: r0.id })).toBeNull();
    const after = removeElement(rungs, r0.id, idOf(r0, 0));
    expect(selectionAfterRemoval(r0, idOf(r0, 0), after)).toEqual({ rungId: r0.id, elementId: branchOf(r0).id });
  });
});

describe('EditHistory', () => {
  it('undoes and redoes snapshots', () => {
    const h = new EditHistory<number>();
    h.record(1);
    h.record(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBeUndefined();
    expect(h.redo(1)).toBe(2);
    expect(h.redo(2)).toBe(3);
    expect(h.canRedo).toBe(false);
    h.record(3);
    expect(h.canRedo).toBe(false);
  });

  it('coalesces typing bursts and is bounded', () => {
    let now = 0;
    const h = new EditHistory<string>({ limit: 3, coalesceMs: 500, now: () => now });
    h.record('a', 'op:1');
    now = 100;
    h.record('ab', 'op:1');
    now = 200;
    h.record('abc', 'op:1');
    expect(h.undoDepth).toBe(1);
    expect(h.undo('abcd')).toBe('a');
    now = 2000;
    for (const s of ['1', '2', '3', '4', '5']) h.record(s);
    expect(h.undoDepth).toBe(3);
    expect(h.undo('6')).toBe('5');
    now = 5000;
    h.record('x', 'k');
    now = 6000; // outside the window
    h.record('y', 'k');
    expect(h.undo('z')).toBe('y');
  });
});
