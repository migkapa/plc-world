/**
 * Headless ladder (RLL) edit operations for the editor.
 *
 * Every operation is immutable: it returns a new `Rung[]` in which only the objects on the path to the
 * change are new (unchanged rungs, branches and instructions keep their identity, which is what lets the
 * editor memoize rendering per rung). When nothing changes the input array itself is returned.
 *
 * Addressing:
 *  - a rung by its id,
 *  - an element (instruction or branch) by its id (unique within a routine),
 *  - a series list by a `LegPath` ({ branchId, leg }) — omitted = the rung's main series,
 *  - an insertion point by { rungId, legPath?, index } (index = position in that series).
 *
 * No React / DOM imports: unit tested in node.
 */
import { INSTRUCTION_DEFS } from '@/plc/instructions';
import {
  NeutralTextError,
  cloneElements,
  cloneRung,
  instructionsOf,
  newId,
  parseRungText,
  parseRungs,
  serializeElements,
  serializeRung,
} from '@/plc/neutralText';
import type { BranchNode, InstructionNode, Rung, RungElement } from '@/plc/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A branch leg: the `leg`-th series of branch `branchId`. */
export interface LegPath {
  branchId: string;
  leg: number;
}

/**
 * Editor selection.
 *  - `{ rungId }`                               the whole rung (rung number clicked)
 *  - `{ rungId, elementId }`                    an instruction or a branch
 *  - `{ rungId, elementId, operandIndex }`      one operand of an instruction
 *  - `{ rungId, legPath?, wireIndex }`          a wire position (insertion point) in a series
 *  - `{ rungId, legPath }`                      a branch leg
 */
export interface LadderSelection {
  rungId: string;
  elementId?: string;
  operandIndex?: number;
  legPath?: LegPath;
  /** Insertion index in the series given by `legPath` (main series when omitted). */
  wireIndex?: number;
}

/** Position in a series where elements are inserted. */
export interface InsertPoint {
  rungId: string;
  legPath?: LegPath;
  index: number;
}

export interface ElementLocation {
  element: RungElement;
  /** Series that holds the element (undefined = the rung's main series). */
  legPath?: LegPath;
  index: number;
  series: RungElement[];
}

export type LadderClipboard = { kind: 'elements'; elements: RungElement[] } | { kind: 'rungs'; rungs: Rung[] };

export type ReplaceResult = { ok: true; rungs: Rung[] } | { ok: false; error: string; position?: number };

// ---------------------------------------------------------------------------
// Instruction helpers
// ---------------------------------------------------------------------------

/** True when `op` is a known output instruction. */
export function isOutputOp(op: string): boolean {
  return INSTRUCTION_DEFS[op.toUpperCase()]?.kind === 'output';
}

/**
 * "Output-like" element: an output instruction, or a branch whose every leg is non-empty and ends with
 * an output-like element (a rung-ending output branch).
 */
export function isOutputElement(el: RungElement): boolean {
  if (el.kind === 'instr') return isOutputOp(el.op);
  return el.legs.length > 0 && el.legs.every((leg) => leg.length > 0 && isOutputElement(leg[leg.length - 1]!));
}

/** Index where the trailing group of output-like elements starts (series.length when there is none). */
export function trailingOutputStart(series: readonly RungElement[]): number {
  let i = series.length;
  while (i > 0 && isOutputElement(series[i - 1]!)) i--;
  return i;
}

/** Default operand texts for a new instruction ('?' placeholders, Accum/Position 0). */
export function defaultOperands(op: string): string[] {
  const def = INSTRUCTION_DEFS[op.toUpperCase()];
  if (!def) return [];
  const n = def.minOperands ?? def.operands.length;
  return def.operands.slice(0, n).map((s) => (s.kind === 'display' && /accum|position/i.test(s.name) ? '0' : '?'));
}

/** A new instruction node (fresh id). Missing operands are filled with defaults. */
export function newInstruction(op: string, operands?: readonly string[]): InstructionNode {
  const mnemonic = op.toUpperCase();
  const defaults = defaultOperands(mnemonic);
  const given = operands ? [...operands] : [];
  const out = given.length >= defaults.length ? given : [...given, ...defaults.slice(given.length)];
  return { kind: 'instr', id: newId('i'), op: mnemonic, operands: out };
}

/** A new empty rung (fresh id). */
export function newRung(elements: RungElement[] = [], comment?: string): Rung {
  return comment !== undefined ? { id: newId('r'), comment, elements } : { id: newId('r'), elements };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function findRung(rungs: readonly Rung[], rungId: string): Rung | undefined {
  return rungs.find((r) => r.id === rungId);
}

export function rungIndexOf(rungs: readonly Rung[], rungId: string): number {
  return rungs.findIndex((r) => r.id === rungId);
}

/** Locate an element (and the series holding it) by id. */
export function locateElement(elements: RungElement[], id: string, legPath?: LegPath): ElementLocation | undefined {
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    if (el.id === id) return legPath ? { element: el, legPath, index: i, series: elements } : { element: el, index: i, series: elements };
    if (el.kind === 'branch') {
      for (let l = 0; l < el.legs.length; l++) {
        const r = locateElement(el.legs[l]!, id, { branchId: el.id, leg: l });
        if (r) return r;
      }
    }
  }
  return undefined;
}

/** Find the rung holding an element. */
export function rungOfElement(rungs: readonly Rung[], elementId: string): Rung | undefined {
  return rungs.find((r) => locateElement(r.elements, elementId) !== undefined);
}

/** The series addressed by `legPath` (the main series when omitted); undefined when it does not exist. */
export function getSeries(elements: RungElement[], legPath?: LegPath): RungElement[] | undefined {
  if (!legPath) return elements;
  const loc = locateElement(elements, legPath.branchId);
  if (!loc || loc.element.kind !== 'branch') return undefined;
  return loc.element.legs[legPath.leg];
}

export function sameLegPath(a: LegPath | undefined, b: LegPath | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.branchId === b.branchId && a.leg === b.leg;
}

/** True when `inner` is `branch` itself or lies (at any depth) inside one of its legs. */
function isInside(elements: RungElement[], branchId: string, innerId: string): boolean {
  if (branchId === innerId) return true;
  const loc = locateElement(elements, branchId);
  if (!loc || loc.element.kind !== 'branch') return false;
  return loc.element.legs.some((leg) => locateElement(leg, innerId) !== undefined);
}

// ---------------------------------------------------------------------------
// Immutable plumbing
// ---------------------------------------------------------------------------

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Replace the series addressed by `legPath` with `fn(series)`, copying only the path to it.
 * Returns undefined when the series does not exist, the input array when nothing changed.
 */
function mapSeries(
  elements: RungElement[],
  legPath: LegPath | undefined,
  fn: (series: RungElement[]) => RungElement[],
): RungElement[] | undefined {
  if (!legPath) return fn(elements);
  let found = false;
  const out = elements.map((el): RungElement => {
    if (found || el.kind !== 'branch') return el;
    if (el.id === legPath.branchId) {
      const leg = el.legs[legPath.leg];
      if (!leg) return el;
      found = true;
      const next = fn(leg);
      if (next === leg) return el;
      const legs = el.legs.slice();
      legs[legPath.leg] = next;
      return { ...el, legs };
    }
    for (let i = 0; i < el.legs.length; i++) {
      const next = mapSeries(el.legs[i]!, legPath, fn);
      if (next !== undefined) {
        found = true;
        if (next === el.legs[i]) return el;
        const legs = el.legs.slice();
        legs[i] = next;
        return { ...el, legs };
      }
    }
    return el;
  });
  if (!found) return undefined;
  return sameItems(out, elements) ? elements : out;
}

function updateRung(rungs: Rung[], rungId: string, fn: (r: Rung) => Rung): Rung[] {
  const i = rungIndexOf(rungs, rungId);
  if (i < 0) return rungs;
  const next = fn(rungs[i]!);
  if (next === rungs[i]) return rungs;
  const out = rungs.slice();
  out[i] = next;
  return out;
}

function updateElements(rungs: Rung[], rungId: string, fn: (els: RungElement[]) => RungElement[]): Rung[] {
  return updateRung(rungs, rungId, (r) => {
    const els = fn(r.elements);
    return els === r.elements ? r : { ...r, elements: els };
  });
}

/** Replace element `id` by `replacement` (0..n elements) in its series. */
function replaceElement(elements: RungElement[], id: string, replacement: RungElement[]): RungElement[] {
  const loc = locateElement(elements, id);
  if (!loc) return elements;
  return (
    mapSeries(elements, loc.legPath, (s) => [...s.slice(0, loc.index), ...replacement, ...s.slice(loc.index + 1)]) ?? elements
  );
}

/** Update one element in place (by id). */
function mapElement(elements: RungElement[], id: string, fn: (el: RungElement) => RungElement): RungElement[] {
  const loc = locateElement(elements, id);
  if (!loc) return elements;
  const next = fn(loc.element);
  if (next === loc.element) return elements;
  return replaceElement(elements, id, [next]);
}

function clampIndex(i: number, len: number): number {
  if (!Number.isFinite(i)) return i > 0 ? len : 0;
  return Math.max(0, Math.min(len, Math.trunc(i)));
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/** Insert elements at a series position. */
export function insertAt(rungs: Rung[], point: InsertPoint, els: RungElement | RungElement[]): Rung[] {
  const list = Array.isArray(els) ? els : [els];
  if (list.length === 0) return rungs;
  return updateElements(
    rungs,
    point.rungId,
    (elements) =>
      mapSeries(elements, point.legPath, (s) => {
        const i = clampIndex(point.index, s.length);
        return [...s.slice(0, i), ...list, ...s.slice(i)];
      }) ?? elements,
  );
}

/** Insert elements before or after an existing element (in the same series). */
export function insertRelative(
  rungs: Rung[],
  rungId: string,
  elementId: string,
  where: 'before' | 'after',
  els: RungElement | RungElement[],
): Rung[] {
  const rung = findRung(rungs, rungId);
  const loc = rung && locateElement(rung.elements, elementId);
  if (!loc) return rungs;
  const point: InsertPoint = { rungId, index: loc.index + (where === 'after' ? 1 : 0) };
  if (loc.legPath) point.legPath = loc.legPath;
  return insertAt(rungs, point, els);
}

/** Insert at the start of the rung (or of a branch leg). */
export function insertAtStart(rungs: Rung[], rungId: string, els: RungElement | RungElement[], legPath?: LegPath): Rung[] {
  return insertAt(rungs, legPath ? { rungId, legPath, index: 0 } : { rungId, index: 0 }, els);
}

/** Insert at the end of the rung (or of a branch leg). */
export function insertAtEnd(rungs: Rung[], rungId: string, els: RungElement | RungElement[], legPath?: LegPath): Rung[] {
  return insertAt(rungs, legPath ? { rungId, legPath, index: Infinity } : { rungId, index: Infinity }, els);
}

/**
 * Where a palette insert goes for the current selection (Studio 5000 behaviour, with a friendly twist
 * for a selected rung):
 *  - wire position → there;
 *  - element → right after it (in its series);
 *  - branch leg → end of that leg;
 *  - rung → outputs at the end, inputs before the rung's trailing outputs.
 */
export function insertPointFor(rung: Rung, sel: LadderSelection | null | undefined, op?: string): InsertPoint {
  const base = (legPath: LegPath | undefined, index: number): InsertPoint =>
    legPath ? { rungId: rung.id, legPath, index } : { rungId: rung.id, index };
  if (sel && sel.rungId === rung.id) {
    if (sel.wireIndex !== undefined && getSeries(rung.elements, sel.legPath)) return base(sel.legPath, sel.wireIndex);
    if (sel.elementId) {
      const loc = locateElement(rung.elements, sel.elementId);
      if (loc) return base(loc.legPath, loc.index + 1);
    }
    if (sel.legPath) {
      const s = getSeries(rung.elements, sel.legPath);
      if (s) return base(sel.legPath, s.length);
    }
  }
  const output = op === undefined || isOutputOp(op) || INSTRUCTION_DEFS[op.toUpperCase()] === undefined;
  return base(undefined, output ? rung.elements.length : trailingOutputStart(rung.elements));
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

export interface RemoveOptions {
  /**
   * Keep a branch leg that becomes empty as a short (Studio 5000 behaviour) when that is valid, i.e. the
   * branch is not at the end of the rung. Default false: the empty leg is removed and a branch left with
   * a single leg collapses into the series.
   */
  keepEmptyLegs?: boolean;
}

/** Ids of branches on the rung's "end chain" (where every leg must end with an output). */
function endChainBranches(elements: RungElement[], out = new Set<string>()): Set<string> {
  const last = elements[elements.length - 1];
  if (last?.kind === 'branch') {
    out.add(last.id);
    for (const leg of last.legs) endChainBranches(leg, out);
  }
  return out;
}

/** Remove leg `leg` of a branch; collapse the branch when one leg remains; drop it when none remains. */
function removeLegFrom(elements: RungElement[], branchId: string, leg: number, opts: RemoveOptions): RungElement[] {
  const loc = locateElement(elements, branchId);
  if (!loc || loc.element.kind !== 'branch') return elements;
  const br = loc.element;
  if (leg < 0 || leg >= br.legs.length) return elements;
  const legs = br.legs.filter((_, i) => i !== leg);
  if (legs.length >= 2) return replaceElement(elements, branchId, [{ ...br, legs }]);
  if (legs.length === 1 && legs[0]!.length > 0) return replaceElement(elements, branchId, legs[0]!);
  return removeFrom(elements, branchId, opts);
}

function removeFrom(elements: RungElement[], id: string, opts: RemoveOptions): RungElement[] {
  const loc = locateElement(elements, id);
  if (!loc) return elements;
  const rest = loc.series.filter((_, i) => i !== loc.index);
  const next = mapSeries(elements, loc.legPath, () => rest) ?? elements;
  if (loc.legPath && rest.length === 0) {
    const keep = opts.keepEmptyLegs === true && !endChainBranches(next).has(loc.legPath.branchId);
    if (!keep) return removeLegFrom(next, loc.legPath.branchId, loc.legPath.leg, opts);
  }
  return next;
}

/** Remove an element (instruction or whole branch). Branches left with one leg collapse into series. */
export function removeElement(rungs: Rung[], rungId: string, elementId: string, opts: RemoveOptions = {}): Rung[] {
  return updateElements(rungs, rungId, (els) => removeFrom(els, elementId, opts));
}

/** Remove several elements of one rung. */
export function removeElements(rungs: Rung[], rungId: string, elementIds: readonly string[], opts: RemoveOptions = {}): Rung[] {
  return updateElements(rungs, rungId, (els) => elementIds.reduce((acc, id) => removeFrom(acc, id, opts), els));
}

/** Remove one leg of a branch (the branch collapses when a single leg remains). */
export function removeLeg(rungs: Rung[], rungId: string, branchId: string, leg: number, opts: RemoveOptions = {}): Rung[] {
  return updateElements(rungs, rungId, (els) => removeLegFrom(els, branchId, leg, opts));
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

/**
 * Wrap a contiguous range of elements (same series) in a new branch: the range becomes leg 0 and an
 * empty leg 1 is added below it (ready to receive a parallel condition).
 */
export function wrapInBranch(
  rungs: Rung[],
  rungId: string,
  elementIds: string | readonly string[],
): { rungs: Rung[]; branchId?: string } {
  const ids = typeof elementIds === 'string' ? [elementIds] : [...elementIds];
  const rung = findRung(rungs, rungId);
  if (!rung || ids.length === 0) return { rungs };
  const locs = ids.map((id) => locateElement(rung.elements, id));
  if (locs.some((l) => !l)) return { rungs };
  const first = locs[0]!;
  if (!locs.every((l) => sameLegPath(l!.legPath, first.legPath))) return { rungs };
  const idx = [...new Set(locs.map((l) => l!.index))].sort((a, b) => a - b);
  const min = idx[0]!;
  const max = idx[idx.length - 1]!;
  if (max - min + 1 !== idx.length) return { rungs };
  const branch: BranchNode = { kind: 'branch', id: newId('b'), legs: [first.series.slice(min, max + 1), []] };
  const next = updateElements(
    rungs,
    rungId,
    (els) => mapSeries(els, first.legPath, (s) => [...s.slice(0, min), branch, ...s.slice(max + 1)]) ?? els,
  );
  return { rungs: next, branchId: branch.id };
}

/** Insert an empty branch (two empty legs) at a series position. */
export function insertBranch(rungs: Rung[], point: InsertPoint, legCount = 2): { rungs: Rung[]; branchId: string } {
  const branch: BranchNode = {
    kind: 'branch',
    id: newId('b'),
    legs: Array.from({ length: Math.max(2, legCount) }, () => []),
  };
  return { rungs: insertAt(rungs, point, branch), branchId: branch.id };
}

/** Studio 5000 "Add Branch Level": add an empty leg to a branch (after `afterLeg`, default: at the bottom). */
export function addBranchLevel(
  rungs: Rung[],
  rungId: string,
  branchId: string,
  afterLeg?: number,
): { rungs: Rung[]; legPath?: LegPath } {
  const rung = findRung(rungs, rungId);
  const loc = rung && locateElement(rung.elements, branchId);
  if (!loc || loc.element.kind !== 'branch') return { rungs };
  const br = loc.element;
  const at = afterLeg === undefined ? br.legs.length : clampIndex(afterLeg + 1, br.legs.length);
  const legs = [...br.legs.slice(0, at), [], ...br.legs.slice(at)];
  const next = updateElements(rungs, rungId, (els) => replaceElement(els, branchId, [{ ...br, legs }]));
  return { rungs: next, legPath: { branchId, leg: at } };
}

/**
 * The editor's "Add Branch Level": when the branch already has an empty leg (e.g. the one left by
 * "Branch"), that leg is the target (preferring one below `afterLeg`) instead of adding another — an
 * extra empty leg would short the OR. Otherwise a new empty leg is added after `afterLeg`.
 */
export function branchLevelTarget(
  rungs: Rung[],
  rungId: string,
  branchId: string,
  afterLeg?: number,
): { rungs: Rung[]; legPath?: LegPath; reused: boolean } {
  const rung = findRung(rungs, rungId);
  const loc = rung && locateElement(rung.elements, branchId);
  if (!loc || loc.element.kind !== 'branch') return { rungs, reused: false };
  const empty = loc.element.legs.flatMap((leg, k) => (leg.length === 0 ? [k] : []));
  const pick = empty.find((k) => afterLeg === undefined || k > afterLeg) ?? empty[0];
  if (pick !== undefined) return { rungs, legPath: { branchId, leg: pick }, reused: true };
  return { ...addBranchLevel(rungs, rungId, branchId, afterLeg), reused: false };
}

/** The innermost branch containing an element (for "Add Branch Level" on a selected instruction). */
export function enclosingBranch(rung: Rung, elementId: string): LegPath | undefined {
  return locateElement(rung.elements, elementId)?.legPath;
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

/**
 * Move an element one position left (-1) or right (+1) within its series (Alt+← / Alt+→). At the end of a
 * branch leg it steps OUT of the branch, to the series position just after (→) or before (←) the branch; the
 * emptied leg is removed like after a drag. At the ends of the main series nothing changes.
 */
export function moveElement(rungs: Rung[], rungId: string, elementId: string, dir: -1 | 1): Rung[] {
  const rung = findRung(rungs, rungId);
  const loc = rung && locateElement(rung.elements, elementId);
  if (!loc) return rungs;
  const j = loc.index + dir;
  if (j < 0 || j >= loc.series.length) {
    if (!loc.legPath) return rungs;
    const br = locateElement(rung.elements, loc.legPath.branchId);
    if (!br) return rungs;
    return moveElementTo(rungs, rungId, elementId, { rungId, ...(br.legPath ? { legPath: br.legPath } : {}), index: dir > 0 ? br.index + 1 : br.index });
  }
  return updateElements(
    rungs,
    rungId,
    (els) =>
      mapSeries(els, loc.legPath, (s) => {
        const out = s.slice();
        out[loc.index] = s[j]!;
        out[j] = s[loc.index]!;
        return out;
      }) ?? els,
  );
}

/**
 * Move an element to an insertion point (drag & drop), possibly into another rung. Moving a branch into
 * itself is refused. The source leg is normalised (emptied legs removed, single legs collapsed).
 */
export function moveElementTo(rungs: Rung[], fromRungId: string, elementId: string, point: InsertPoint, opts: RemoveOptions = {}): Rung[] {
  const src = findRung(rungs, fromRungId);
  const loc = src && locateElement(src.elements, elementId);
  const dst = findRung(rungs, point.rungId);
  if (!loc || !dst) return rungs;
  const sameRung = fromRungId === point.rungId;
  if (point.legPath && sameRung && loc.element.kind === 'branch' && isInside(src.elements, loc.element.id, point.legPath.branchId)) {
    return rungs;
  }
  const sameSeries = sameRung && sameLegPath(loc.legPath, point.legPath);
  if (sameSeries && (point.index === loc.index || point.index === loc.index + 1)) return rungs;
  // 1. detach without normalising (the target series must keep existing)
  let next = updateElements(rungs, fromRungId, (els) => mapSeries(els, loc.legPath, (s) => s.filter((_, i) => i !== loc.index)) ?? els);
  // 2. insert
  const index = sameSeries && point.index > loc.index ? point.index - 1 : point.index;
  next = insertAt(next, { ...point, index }, loc.element);
  // 3. normalise the source leg
  if (loc.legPath) {
    const s = findRung(next, fromRungId);
    const series = s && getSeries(s.elements, loc.legPath);
    if (series && series.length === 0) {
      const keep = opts.keepEmptyLegs === true && !endChainBranches(s.elements).has(loc.legPath.branchId);
      if (!keep) next = removeLeg(next, fromRungId, loc.legPath.branchId, loc.legPath.leg, opts);
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

const NUMERIC = ['SINT', 'INT', 'DINT', 'REAL'];
const INTEGER = ['SINT', 'INT', 'DINT'];

function expandTypes(types: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of types) {
    const u = t.toUpperCase();
    if (u === 'ANY_NUM') NUMERIC.forEach((x) => out.add(x));
    else if (u === 'ANY_INT') INTEGER.forEach((x) => out.add(x));
    else out.add(u);
  }
  return out;
}

function compatibleTypes(a: readonly string[], b: readonly string[]): boolean {
  const sa = expandTypes(a);
  for (const t of expandTypes(b)) if (sa.has(t)) return true;
  return false;
}

/**
 * Change an instruction's mnemonic, keeping operands that stay meaningful: an operand with the same name
 * is kept first, then the operand at the same position when its data types are compatible; others
 * become '?' (Accum/Position 0).
 */
export function setMnemonic(rungs: Rung[], rungId: string, elementId: string, op: string): Rung[] {
  const mnemonic = op.trim().toUpperCase();
  if (!mnemonic) return rungs;
  return updateElements(rungs, rungId, (els) =>
    mapElement(els, elementId, (el) => {
      if (el.kind !== 'instr' || el.op === mnemonic) return el;
      const oldDef = INSTRUCTION_DEFS[el.op];
      const newDef = INSTRUCTION_DEFS[mnemonic];
      if (!newDef) {
        return { ...el, op: mnemonic };
      }
      const defaults = defaultOperands(mnemonic);
      const used = new Set<number>();
      const picked = new Map<number, string>();
      if (oldDef) {
        // 1. same operand name (e.g. Dest → Dest, Preset → Preset)
        defaults.forEach((_, i) => {
          const spec = newDef.operands[i]!;
          const j = oldDef.operands.findIndex((o, k) => !used.has(k) && o.name === spec.name && k < el.operands.length);
          if (j >= 0 && compatibleTypes(oldDef.operands[j]!.types, spec.types)) {
            used.add(j);
            picked.set(i, el.operands[j]!);
          }
        });
        // 2. same position with compatible data types
        defaults.forEach((_, i) => {
          if (picked.has(i)) return;
          const same = oldDef.operands[i];
          if (same && !used.has(i) && i < el.operands.length && compatibleTypes(same.types, newDef.operands[i]!.types)) {
            used.add(i);
            picked.set(i, el.operands[i]!);
          }
        });
      } else {
        defaults.forEach((_, i) => {
          if (i < el.operands.length) picked.set(i, el.operands[i]!);
        });
      }
      const operands = defaults.map((dflt, i) => picked.get(i) ?? dflt);
      return { ...el, op: mnemonic, operands };
    }),
  );
}

/** Set the text of one operand (the operand list grows with '?' when needed). */
export function setOperand(rungs: Rung[], rungId: string, elementId: string, index: number, text: string): Rung[] {
  const value = text.trim() === '' ? '?' : text.trim();
  return updateElements(rungs, rungId, (els) =>
    mapElement(els, elementId, (el) => {
      if (el.kind !== 'instr' || index < 0) return el;
      if (el.operands[index] === value) return el;
      const operands = el.operands.slice();
      while (operands.length < index) operands.push('?');
      operands[index] = value;
      return { ...el, operands };
    }),
  );
}

/** Replace every operand of an instruction. */
export function setOperands(rungs: Rung[], rungId: string, elementId: string, operands: readonly string[]): Rung[] {
  return updateElements(rungs, rungId, (els) =>
    mapElement(els, elementId, (el) => {
      if (el.kind !== 'instr' || sameItems(el.operands, operands)) return el;
      return { ...el, operands: [...operands] };
    }),
  );
}

// ---------------------------------------------------------------------------
// Rungs
// ---------------------------------------------------------------------------

/** Insert a rung at an index (a new empty rung by default). */
export function insertRung(rungs: Rung[], index: number, rung: Rung = newRung()): Rung[] {
  const i = clampIndex(index, rungs.length);
  return [...rungs.slice(0, i), rung, ...rungs.slice(i)];
}

/** Add a rung after `afterRungId` (at the end when omitted or not found). */
export function addRung(rungs: Rung[], afterRungId?: string, rung: Rung = newRung()): { rungs: Rung[]; rung: Rung } {
  const i = afterRungId === undefined ? -1 : rungIndexOf(rungs, afterRungId);
  return { rungs: insertRung(rungs, i < 0 ? rungs.length : i + 1, rung), rung };
}

/** Add a rung before `beforeRungId` (at the start when not found). */
export function addRungBefore(rungs: Rung[], beforeRungId: string, rung: Rung = newRung()): { rungs: Rung[]; rung: Rung } {
  const i = rungIndexOf(rungs, beforeRungId);
  return { rungs: insertRung(rungs, i < 0 ? 0 : i, rung), rung };
}

/** Duplicate a rung (fresh ids) right below it. */
export function duplicateRung(rungs: Rung[], rungId: string): { rungs: Rung[]; rung?: Rung } {
  const i = rungIndexOf(rungs, rungId);
  if (i < 0) return { rungs };
  const copy = cloneRung(rungs[i]!);
  if (copy.comment === undefined) delete copy.comment;
  return { rungs: insertRung(rungs, i + 1, copy), rung: copy };
}

export function deleteRung(rungs: Rung[], rungId: string): Rung[] {
  const i = rungIndexOf(rungs, rungId);
  return i < 0 ? rungs : rungs.filter((_, j) => j !== i);
}

export function deleteRungs(rungs: Rung[], rungIds: readonly string[]): Rung[] {
  const set = new Set(rungIds);
  const out = rungs.filter((r) => !set.has(r.id));
  return out.length === rungs.length ? rungs : out;
}

/** Move a rung up (-1) or down (+1). */
export function moveRung(rungs: Rung[], rungId: string, dir: -1 | 1): Rung[] {
  const i = rungIndexOf(rungs, rungId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rungs.length) return rungs;
  const out = rungs.slice();
  out[i] = rungs[j]!;
  out[j] = rungs[i]!;
  return out;
}

/** Set (or clear with an empty string / undefined) the rung comment. */
export function setRungComment(rungs: Rung[], rungId: string, comment: string | undefined): Rung[] {
  const text = comment?.replace(/\s+$/, '');
  return updateRung(rungs, rungId, (r) => {
    if ((r.comment ?? '') === (text ?? '')) return r;
    if (!text) {
      const { comment: _drop, ...rest } = r;
      void _drop;
      return rest;
    }
    return { ...r, comment: text };
  });
}

/** Replace a rung's logic from neutral text, keeping the rung id and comment. */
export function replaceRungFromText(rungs: Rung[], rungId: string, text: string): ReplaceResult {
  const i = rungIndexOf(rungs, rungId);
  if (i < 0) return { ok: false, error: 'Rung not found.' };
  try {
    const elements = parseRungText(text);
    const out = rungs.slice();
    out[i] = { ...rungs[i]!, elements: reuseIds(rungs[i]!.elements, elements) };
    return { ok: true, rungs: out };
  } catch (e) {
    if (e instanceof NeutralTextError) return { ok: false, error: e.message, position: e.position };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Keep the ids of structurally matching elements (same kind / mnemonic at the same place) after a text
 * edit, so selections and live-state keys survive "Edit rung as text" round trips.
 */
function reuseIds(old: RungElement[], fresh: RungElement[]): RungElement[] {
  return fresh.map((el, i) => {
    const o = old[i];
    if (!o || o.kind !== el.kind) return el;
    if (el.kind === 'instr' && o.kind === 'instr') return o.op === el.op ? { ...el, id: o.id } : el;
    if (el.kind === 'branch' && o.kind === 'branch') {
      return { ...el, id: o.id, legs: el.legs.map((leg, l) => reuseIds(o.legs[l] ?? [], leg)) };
    }
    return el;
  });
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Deep copies (original ids) of elements of a rung, in reading order. */
export function copyElements(rung: Rung, elementIds: readonly string[]): RungElement[] {
  const locs = elementIds
    .map((id) => locateElement(rung.elements, id))
    .filter((l): l is ElementLocation => l !== undefined);
  const order = new Map<string, number>();
  let n = 0;
  const visit = (series: RungElement[]): void => {
    for (const el of series) {
      order.set(el.id, n++);
      if (el.kind === 'branch') el.legs.forEach(visit);
    }
  };
  visit(rung.elements);
  return locs
    .sort((a, b) => (order.get(a.element.id) ?? 0) - (order.get(b.element.id) ?? 0))
    .map((l) => structuredClone(l.element));
}

/** Paste elements (cloned with fresh ids) at an insertion point. */
export function pasteElements(rungs: Rung[], point: InsertPoint, clip: readonly RungElement[]): { rungs: Rung[]; ids: string[] } {
  const els = cloneElements([...clip]);
  return { rungs: insertAt(rungs, point, els), ids: els.map((e) => e.id) };
}

/** Paste rungs (cloned with fresh ids) at a rung index. */
export function pasteRungs(rungs: Rung[], index: number, clip: readonly Rung[]): { rungs: Rung[]; ids: string[] } {
  const copies = clip.map((r) => {
    const c = cloneRung(r);
    if (c.comment === undefined) delete c.comment;
    return c;
  });
  const i = clampIndex(index, rungs.length);
  return { rungs: [...rungs.slice(0, i), ...copies, ...rungs.slice(i)], ids: copies.map((r) => r.id) };
}

/** Neutral text of a clipboard (rungs: one per line, terminated with ';'). */
export function clipboardToText(clip: LadderClipboard): string {
  return clip.kind === 'rungs' ? clip.rungs.map((r) => serializeRung(r)).join('\n') : serializeElements(clip.elements);
}

/**
 * Parse pasted text: `XIC(A)OTE(B);` (terminated with ';', possibly several) → rungs; `XIC(A)` →
 * elements. Returns undefined for text that is not neutral text.
 */
export function clipboardFromText(text: string): LadderClipboard | undefined {
  const t = text.trim();
  if (!t) return undefined;
  try {
    if (t.endsWith(';')) {
      const rungs = parseRungs(t);
      return rungs.length > 0 ? { kind: 'rungs', rungs } : undefined;
    }
    const elements = parseRungText(t);
    return elements.length > 0 ? { kind: 'elements', elements } : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// ASCII quick entry (Studio 5000 "type XIC Start_PB")
// ---------------------------------------------------------------------------

export class QuickEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuickEntryError';
  }
}

/** Split on whitespace / commas outside brackets and parentheses. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '[' || ch === '(') depth++;
    else if ((ch === ']' || ch === ')') && depth > 0) depth--;
    if (depth === 0 && (/\s/.test(ch) || ch === ',')) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Parse a quick-entry line into elements:
 *  - Studio ASCII style: `XIC Start_PB XIO Stop_PB OTE Motor`, `TON Timer1 5000 0`,
 *    branches with `BST … NXB … BND`;
 *  - neutral text: `XIC(Start_PB)[XIC(A),XIC(B)]OTE(Motor)`.
 * Missing operands become '?'. Throws `QuickEntryError` / `NeutralTextError`.
 */
export function parseQuickEntry(text: string): RungElement[] {
  const t = text.trim().replace(/;$/, '').trim();
  if (!t) return [];
  if (/^\[/.test(t) || /^[A-Za-z_]\w*\s*\(/.test(t)) return parseRungText(t);
  const root: RungElement[] = [];
  let cur = root;
  const stack: Array<{ branch: BranchNode; parent: RungElement[] }> = [];
  let pending: { op: string; operands: string[]; max: number } | undefined;
  const flush = (): void => {
    if (!pending) return;
    cur.push(newInstruction(pending.op, pending.operands));
    pending = undefined;
  };
  for (const tok of tokenize(t)) {
    const up = tok.toUpperCase();
    if (up === 'BST') {
      flush();
      const branch: BranchNode = { kind: 'branch', id: newId('b'), legs: [[]] };
      cur.push(branch);
      stack.push({ branch, parent: cur });
      cur = branch.legs[0]!;
      continue;
    }
    if (up === 'NXB') {
      flush();
      const top = stack[stack.length - 1];
      if (!top) throw new QuickEntryError('NXB without BST: start a branch with BST first.');
      const leg: RungElement[] = [];
      top.branch.legs.push(leg);
      cur = leg;
      continue;
    }
    if (up === 'BND') {
      flush();
      const top = stack.pop();
      if (!top) throw new QuickEntryError('BND without BST.');
      if (top.branch.legs.length < 2) top.branch.legs.push([]);
      cur = top.parent;
      continue;
    }
    const def = INSTRUCTION_DEFS[up];
    const wantsOperand = pending !== undefined && pending.operands.length < pending.max;
    if (def && !(wantsOperand && !/^[A-Z]{2,4}$/.test(tok))) {
      flush();
      pending = { op: up, operands: [], max: def.variadic ? Infinity : def.operands.length };
      continue;
    }
    if (wantsOperand) {
      pending!.operands.push(tok);
      continue;
    }
    if (pending) throw new QuickEntryError(`Too many operands for ${pending.op}: '${tok}'.`);
    throw new QuickEntryError(`Unknown instruction '${tok}'. Type a mnemonic first, e.g. XIC Start_PB.`);
  }
  flush();
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.branch.legs.length < 2) top.branch.legs.push([]);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Selection & keyboard navigation (headless part; the editor adds spatial up/down)
// ---------------------------------------------------------------------------

/** Instructions of a rung in reading order (left to right, top leg first). */
export function instructionOrder(rung: Rung): InstructionNode[] {
  return instructionsOf(rung.elements);
}

/** Selection of an element (and its first '?' operand when `focusMissing`). */
export function selectElement(rungId: string, elementId: string, operandIndex?: number): LadderSelection {
  return operandIndex === undefined ? { rungId, elementId } : { rungId, elementId, operandIndex };
}

/** Reading-order token of a rung: a wire (insertion) position or an instruction. */
type ReadingToken = { t: 'wire'; legPath?: LegPath; index: number } | { t: 'instr'; id: string };

/**
 * Wire positions and instructions of a rung in reading order: for every series, the wire before each
 * element, the element (a branch expands to its legs, top to bottom), then the wire after the last one.
 */
function readingTokens(elements: RungElement[], legPath?: LegPath, out: ReadingToken[] = []): ReadingToken[] {
  elements.forEach((el, i) => {
    out.push(legPath ? { t: 'wire', legPath, index: i } : { t: 'wire', index: i });
    if (el.kind === 'instr') out.push({ t: 'instr', id: el.id });
    else el.legs.forEach((leg, l) => readingTokens(leg, { branchId: el.id, leg: l }, out));
  });
  out.push(legPath ? { t: 'wire', legPath, index: elements.length } : { t: 'wire', index: elements.length });
  return out;
}

/** The instruction after (+1) / before (-1) a wire position in reading order, within the rung. */
function instructionFromWire(rung: Rung, legPath: LegPath | undefined, index: number, dir: 1 | -1): string | undefined {
  const tokens = readingTokens(rung.elements);
  const at = tokens.findIndex((k) => k.t === 'wire' && k.index === index && sameLegPath(k.legPath, legPath));
  if (at < 0) return undefined;
  for (let i = at + dir; i >= 0 && i < tokens.length; i += dir) {
    const k = tokens[i]!;
    if (k.t === 'instr') return k.id;
  }
  return undefined;
}

/**
 * Next (+1) / previous (-1) instruction in reading order, continuing into the neighbouring rungs.
 * From a rung selection, +1 selects its first instruction and -1 the previous rung's last one.
 * From a wire position (also at a branch-leg boundary or on an empty leg) the reading order of the
 * whole rung is followed before leaving it. Returns undefined at the start / end of the routine.
 */
export function nextInstruction(rungs: readonly Rung[], sel: LadderSelection | null | undefined, dir: 1 | -1): LadderSelection | undefined {
  if (rungs.length === 0) return undefined;
  if (!sel) {
    const r = dir === 1 ? rungs[0]! : rungs[rungs.length - 1]!;
    const list = instructionOrder(r);
    const pick = dir === 1 ? list[0] : list[list.length - 1];
    return pick ? { rungId: r.id, elementId: pick.id } : { rungId: r.id };
  }
  const ri = rungIndexOf(rungs, sel.rungId);
  if (ri < 0) return undefined;
  const rung = rungs[ri]!;
  const list = instructionOrder(rung);
  let pos: number;
  if (sel.elementId) {
    const i = list.findIndex((x) => x.id === sel.elementId);
    if (i >= 0) pos = i + dir;
    else {
      // a branch: next instruction after/before the branch start in reading order
      const flat: string[] = [];
      const visit = (s: RungElement[]): void => s.forEach((el) => (flat.push(el.id), el.kind === 'branch' && el.legs.forEach(visit)));
      visit(rung.elements);
      const bi = flat.indexOf(sel.elementId);
      const ids = new Set(list.map((x) => x.id));
      const after = flat.slice(bi + 1).filter((id) => ids.has(id));
      const before = flat.slice(0, bi).filter((id) => ids.has(id));
      const target = dir === 1 ? after[0] : before[before.length - 1];
      if (target) return { rungId: rung.id, elementId: target };
      pos = dir === 1 ? list.length : -1;
    }
  } else if (sel.wireIndex !== undefined) {
    const series = getSeries(rung.elements, sel.legPath) ?? [];
    const neighbour = dir === 1 ? series[sel.wireIndex] : series[sel.wireIndex - 1];
    // an adjacent branch without instructions is selected itself (so it can be deleted)
    if (neighbour?.kind === 'branch' && instructionsOf([neighbour]).length === 0) return { rungId: rung.id, elementId: neighbour.id };
    const id = instructionFromWire(rung, sel.legPath, sel.wireIndex, dir);
    if (id) return { rungId: rung.id, elementId: id };
    pos = dir === 1 ? list.length : -1;
  } else {
    pos = dir === 1 ? 0 : -1;
  }
  if (pos >= 0 && pos < list.length) return { rungId: rung.id, elementId: list[pos]!.id };
  // continue into the neighbouring rung
  const nri = ri + dir;
  if (nri < 0 || nri >= rungs.length) return undefined;
  const nr = rungs[nri]!;
  const nl = instructionOrder(nr);
  const pick = dir === 1 ? nl[0] : nl[nl.length - 1];
  return pick ? { rungId: nr.id, elementId: pick.id } : { rungId: nr.id };
}

/** Select the previous (-1) / next (+1) rung. */
export function adjacentRung(rungs: readonly Rung[], sel: LadderSelection | null | undefined, dir: 1 | -1): LadderSelection | undefined {
  if (rungs.length === 0) return undefined;
  if (!sel) return { rungId: (dir === 1 ? rungs[0] : rungs[rungs.length - 1])!.id };
  const i = rungIndexOf(rungs, sel.rungId);
  const j = Math.max(0, Math.min(rungs.length - 1, (i < 0 ? 0 : i) + dir));
  return { rungId: rungs[j]!.id };
}

/**
 * Next/previous operand of the selected instruction, continuing into neighbouring instructions (Tab).
 * Returns undefined past the last operand of the routine (or before its first one).
 */
export function nextOperand(rungs: readonly Rung[], sel: LadderSelection | null | undefined, dir: 1 | -1): LadderSelection | undefined {
  if (!sel?.elementId) return nextInstruction(rungs, sel, dir);
  const rung = findRung(rungs, sel.rungId);
  const loc = rung && locateElement(rung.elements, sel.elementId);
  if (!loc || loc.element.kind !== 'instr') return nextInstruction(rungs, sel, dir);
  const n = loc.element.operands.length;
  const cur = sel.operandIndex ?? (dir === 1 ? -1 : n);
  const j = cur + dir;
  if (j >= 0 && j < n) return { rungId: sel.rungId, elementId: sel.elementId, operandIndex: j };
  let next = nextInstruction(rungs, { rungId: sel.rungId, elementId: sel.elementId }, dir);
  // skip operand-less instructions and empty rungs
  for (let guard = 0; next && guard < 10000; guard++) {
    const r = findRung(rungs, next.rungId);
    const l = r && next.elementId ? locateElement(r.elements, next.elementId) : undefined;
    if (l?.element.kind === 'instr' && l.element.operands.length > 0) {
      return { ...next, operandIndex: dir === 1 ? 0 : l.element.operands.length - 1 };
    }
    const after: LadderSelection | undefined = nextInstruction(rungs, next, dir);
    if (!after || (after.rungId === next.rungId && after.elementId === next.elementId)) break;
    next = after;
  }
  return undefined;
}

/**
 * Make a selection valid for `rungs` (after an edit / undo): drop an element that no longer exists
 * (keeping the rung), drop a rung that no longer exists (selecting the nearest one).
 */
export function normalizeSelection(
  rungs: readonly Rung[],
  sel: LadderSelection | null | undefined,
  previous?: readonly Rung[],
): LadderSelection | null {
  if (!sel) return null;
  const rung = findRung(rungs, sel.rungId);
  if (!rung) {
    if (rungs.length === 0) return null;
    const oldIndex = previous ? rungIndexOf(previous, sel.rungId) : -1;
    const i = Math.max(0, Math.min(rungs.length - 1, oldIndex < 0 ? rungs.length - 1 : oldIndex));
    return { rungId: rungs[i]!.id };
  }
  if (sel.elementId) {
    const loc = locateElement(rung.elements, sel.elementId);
    if (!loc) return { rungId: rung.id };
    if (sel.operandIndex !== undefined && (loc.element.kind !== 'instr' || sel.operandIndex >= loc.element.operands.length)) {
      return { rungId: rung.id, elementId: sel.elementId };
    }
    return sel;
  }
  if (sel.legPath && !getSeries(rung.elements, sel.legPath)) return { rungId: rung.id };
  if (sel.wireIndex !== undefined) {
    const s = getSeries(rung.elements, sel.legPath) ?? [];
    if (sel.wireIndex > s.length) return { ...sel, wireIndex: s.length };
  }
  return sel;
}

/** Selection after deleting an element: its right neighbour, else its left neighbour, else the wire/rung. */
export function selectionAfterRemoval(before: Rung, elementId: string, after: readonly Rung[]): LadderSelection {
  const loc = locateElement(before.elements, elementId);
  const rung = findRung(after, before.id);
  if (!loc || !rung) return { rungId: before.id };
  const candidates = [loc.series[loc.index + 1], loc.series[loc.index - 1]];
  for (const c of candidates) if (c && locateElement(rung.elements, c.id)) return { rungId: rung.id, elementId: c.id };
  if (loc.legPath && getSeries(rung.elements, loc.legPath)) return { rungId: rung.id, legPath: loc.legPath, wireIndex: 0 };
  return { rungId: rung.id };
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

export interface HistoryOptions {
  /** Maximum number of undo steps kept (default 100). */
  limit?: number;
  /** Edits recorded with the same coalesce key within this many ms merge into one step (default 1200). */
  coalesceMs?: number;
  /** Clock (default Date.now). */
  now?: () => number;
}

/**
 * Bounded undo/redo stack of snapshots. Call `record(before)` right before applying an edit; typing-like
 * edits pass a `coalesceKey` (e.g. `operand:<id>:<n>`) so a burst of changes undoes in one step.
 */
export class EditHistory<T = Rung[]> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | undefined;
  private lastTime = Number.NEGATIVE_INFINITY;
  private readonly limit: number;
  private readonly coalesceMs: number;
  private readonly now: () => number;

  constructor(opts: HistoryOptions = {}) {
    this.limit = Math.max(1, opts.limit ?? 100);
    this.coalesceMs = opts.coalesceMs ?? 1200;
    this.now = opts.now ?? (() => Date.now());
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  /** Record the state before an edit. Clears the redo stack. */
  record(before: T, coalesceKey?: string): void {
    const t = this.now();
    const merge = coalesceKey !== undefined && coalesceKey === this.lastKey && t - this.lastTime <= this.coalesceMs && this.past.length > 0;
    this.lastKey = coalesceKey;
    this.lastTime = t;
    this.future = [];
    if (merge) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
  }

  /** Undo: returns the state to restore (and remembers `current` for redo). */
  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    this.lastKey = undefined;
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    this.lastKey = undefined;
    return next;
  }

  /** Break coalescing (the next record starts a new step). */
  seal(): void {
    this.lastKey = undefined;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = undefined;
  }
}
