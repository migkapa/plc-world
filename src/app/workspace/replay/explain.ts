/**
 * Why did this test fail? (headless) — turns the state of a replayed test at its failure moment into a short
 * debugging lesson: what the test did, what it expected, what it saw, and where to look in the ladder
 * ("Light_0 is driven by rung 0 — its rung condition is false because Switch_0 (XIC) is 0").
 *
 * The analysis reads the controller's live rung state (power flow of the last scan): for the output behind the
 * failing check it finds the rung(s) that write it, then the instruction that broke (or completed) the power
 * path in front of it.
 */
import { classifyFailure } from '../../../game/objectives';
import type { MissionDef, MissionTest, TestResult, TestStep } from '../../../game/types';
import { INSTRUCTIONS } from '../../../plc/instructions';
import type { ElementLiveState, InstructionNode, PlcController, Rung, RungElement } from '../../../plc/types';
import { MAIN_PROGRAM, MAIN_ROUTINE } from '../../../sim/project';
import type { SceneLogic, SimRuntime } from '../../../sim/types';
import { describeStep, fmtDuration } from '../stepText';
import { checkedSignalOf, controlAliases, drivingTags, ioPoint, readSignal, signalLabel, type SignalRef } from './signals';

/** A piece of a hint: plain text, a tag name (shown as code, highlighted in the ladder), a rung link or code. */
export type HintPart = string | { tag: string } | { rung: number } | { code: string };

export interface FailureExplanation {
  kind: 'check' | 'invariant' | 'fault' | 'other';
  /** Index of the failing step (−1 when the test failed before any step, e.g. Run refused). */
  step: number;
  atMs: number;
  /** What the test did up to the failure (last few actions, oldest first). */
  did: Array<{ atMs?: number; text: string }>;
  /** The requirement in plain words ("Light 0 should be ON within 100 ms"). */
  expected: string;
  /** The author's wording of the requirement (the test message), when it adds something. */
  because?: string;
  /** What actually happened ("It stayed OFF (0) for the whole 100 ms"). */
  saw: string;
  /** Where to look: paragraphs of hint parts. */
  hint: HintPart[][];
  /** The signal the failing check / rule reads. */
  signal?: SignalRef;
  /** Condition the signal had to meet. */
  condition?: { equals?: boolean | number; min?: number; max?: number };
  /** Tags to highlight in the ladder (the output behind the failure). */
  tags: string[];
  /** Rungs to look at (index into MainRoutine; the first one is scrolled into view). */
  rungs: number[];
  /** The instructions that write those tags on those rungs (element ids, same order as `rungs`). */
  elements: Array<{ rung: number; id: string }>;
}

export interface ExplainContext {
  mission: MissionDef;
  scene: SceneLogic<unknown>;
  test: MissionTest;
  result: TestResult;
  /** Runtime (controller + plant) frozen at the failure moment. */
  runtime: SimRuntime;
  /** Simulated time at which each step started (from the replay trace), for "what the test did". */
  stepStarts?: ReadonlyArray<number>;
}

const lower = (s: string): string => s.toLowerCase();
const TIMER_OPS = new Set(['TON', 'TOF', 'RTO']);
const COUNTER_OPS = new Set(['CTU', 'CTD']);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

type Cond = { equals?: boolean | number; min?: number; max?: number };

function condWords(c: Cond, units?: string): string {
  const u = units ? ` ${units}` : '';
  if (c.equals !== undefined) return typeof c.equals === 'boolean' ? (c.equals ? 'ON' : 'OFF') : `${c.equals}${u}`;
  if (c.min !== undefined && c.max !== undefined) return `between ${c.min} and ${c.max}${u}`;
  if (c.min !== undefined) return `at least ${c.min}${u}`;
  if (c.max !== undefined) return `at most ${c.max}${u}`;
  return '?';
}

function valueWords(v: number, bool: boolean): string {
  if (!Number.isFinite(v)) return '—';
  if (bool) return v ? 'ON (1)' : 'OFF (0)';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** "Light 0 should be ON within 100 ms, then stay ON for 500 ms". */
export function expectedText(step: Extract<TestStep, { do: 'expect' }>, what: string, units?: string): string {
  const cond = condWords(step, units);
  let s = `${what} should be ${cond}`;
  if (step.within !== undefined) s += ` within ${fmtDuration(step.within)}`;
  if (step.for !== undefined) s += `${step.within !== undefined ? ', then' : ' and'} stay ${cond} for ${fmtDuration(step.for)}`;
  return s;
}

/** The runner's failure detail (after " — ") in plain words. */
export function sawText(rawDetail: string, what: string): string {
  const detail = rawDetail.replace(/<=/g, '≤').replace(/>=/g, '≥');
  let m = /^expected .+?, but it was (.+?)(?: for the whole (\d+) ms)?$/.exec(detail);
  if (m) return m[2] ? `It stayed ${m[1]} for the whole ${fmtDuration(Number(m[2]))}.` : `It was ${m[1]} at that moment.`;
  m = /^.+? should stay (.+?) for (\d+) ms, but became (.+?) after (\d+) ms$/.exec(detail);
  if (m) return `It was ${m[1]} at first, but became ${m[3]} after ${fmtDuration(Number(m[4]))} (it had to hold for ${fmtDuration(Number(m[2]))}).`;
  m = /^.+? was (.+?) at ([\d.]+ s)$/.exec(detail);
  if (m) return `${what} was ${m[1]} at ${m[2]}.`;
  return detail.endsWith('.') ? detail : `${detail}.`;
}

// ---------------------------------------------------------------------------
// Ladder analysis
// ---------------------------------------------------------------------------

interface Use {
  rung: number;
  instr: InstructionNode;
  operand: number;
  dest: boolean;
}

/** Canonical name of an operand for matching: alias ↔ I/O address, structure members stripped. */
function canon(scene: Pick<SceneLogic<unknown>, 'io'>, operand: string): string {
  const io = ioPoint(scene, operand);
  if (io) return lower(io.alias);
  return lower(operand.replace(/[.[].*$/, ''));
}

/** Member / bit part of an operand ('Run_Timer.DN' → 'DN'). */
function memberOf(operand: string): string | undefined {
  const m = /\.([A-Za-z]+)$/.exec(operand);
  return m ? m[1]!.toUpperCase() : undefined;
}

function usesOf(scene: Pick<SceneLogic<unknown>, 'io'>, rungs: ReadonlyArray<Rung>, tag: string): Use[] {
  const key = canon(scene, tag);
  const out: Use[] = [];
  rungs.forEach((r, ri) => {
    const walk = (els: RungElement[]): void => {
      for (const el of els) {
        if (el.kind === 'branch') {
          el.legs.forEach(walk);
          continue;
        }
        const info = INSTRUCTIONS[el.op];
        el.operands.forEach((o, oi) => {
          if (o === '?' || o === '' || canon(scene, o) !== key) return;
          out.push({ rung: ri, instr: el, operand: oi, dest: info?.operands[oi]?.dest === true && !(info.kind === 'input' && el.op !== 'ONS') });
        });
      }
    };
    walk(r.elements);
  });
  return out;
}

/** Chain of (series list, index) from the rung down to the element `id`. */
function pathTo(list: RungElement[], id: string): Array<{ list: RungElement[]; index: number }> | undefined {
  for (let i = 0; i < list.length; i++) {
    const el = list[i]!;
    if (el.id === id) return [{ list, index: i }];
    if (el.kind === 'branch') {
      for (const leg of el.legs) {
        const sub = pathTo(leg, id);
        if (sub) return [{ list, index: i }, ...sub];
      }
    }
  }
  return undefined;
}

type Live = Record<string, ElementLiveState>;

function firstBreak(list: RungElement[], upTo: number, live: Live): InstructionNode[] {
  for (let i = 0; i < upTo; i++) {
    const el = list[i]!;
    const st = live[el.id];
    if (!st) continue;
    if (!st.in) return [];
    if (st.out) continue;
    if (el.kind === 'instr') return [el];
    return el.legs.flatMap((leg) => firstBreak(leg, leg.length, live));
  }
  return [];
}

/** Instructions that stopped the power flow in front of element `id` (per branch leg). */
function blockersOf(rung: Rung, id: string, live: Live): InstructionNode[] {
  const path = pathTo(rung.elements, id);
  if (!path) return [];
  for (const { list, index } of path) {
    const b = firstBreak(list, index, live);
    if (b.length) return b;
  }
  return [];
}

function conducting(list: RungElement[], upTo: number, live: Live): InstructionNode[] {
  const out: InstructionNode[] = [];
  for (let i = 0; i < upTo; i++) {
    const el = list[i]!;
    if (el.kind === 'instr') {
      if (INSTRUCTIONS[el.op]?.kind === 'input') out.push(el);
      continue;
    }
    const leg = el.legs.find((l) => l.length === 0 || live[l[l.length - 1]!.id]?.out);
    if (leg) out.push(...conducting(leg, leg.length, live));
  }
  return out;
}

/** Input instructions that carried power to element `id` (the energized path). */
function conductorsOf(rung: Rung, id: string, live: Live): InstructionNode[] {
  const path = pathTo(rung.elements, id);
  if (!path) return [];
  return path.flatMap(({ list, index }) => conducting(list, index, live));
}

interface Reader {
  tags: PlcController['tags'];
  program: string;
  scene: SceneLogic<unknown>;
  /** Wiring notes already given (each N.C. device is explained once). */
  noted: Set<string>;
}

function readNum(r: Reader, operand: string): number {
  try {
    if (!r.tags.exists(operand, r.program)) return Number.NaN;
    const t = String(r.tags.typeOf(operand, r.program) ?? '');
    if (t === 'BOOL') return r.tags.readBool(operand, r.program) ? 1 : 0;
    if (t === 'SINT' || t === 'INT' || t === 'DINT' || t === 'REAL') return r.tags.readNumber(operand, r.program);
  } catch {
    // unreadable
  }
  return Number.NaN;
}

function typeOf(r: Reader, operand: string): string {
  try {
    return String(r.tags.typeOf(operand, r.program) ?? '');
  } catch {
    return '';
  }
}

const isLiteral = (o: string): boolean => /^[-+]?\d/.test(o);

/** N.C. wiring note for an input alias ("wired N.C.: 1 while NOT pressed"). */
function wiringNote(r: Reader, operand: string): string | undefined {
  const io = ioPoint(r.scene, operand);
  if (!io || io.dir !== 'input') return undefined;
  if (!/normally.closed|\bN\.C\./i.test(`${io.device} ${io.description}`) || r.noted.has(io.alias)) return undefined;
  r.noted.add(io.alias);
  const what = io.description.replace(/^Normally-closed:\s*/i, '').split(/\.\s/)[0]!.replace(/\.$/, '');
  return `wired N.C.: ${what}`;
}

function timerNote(r: Reader, operand: string): string | undefined {
  const mem = memberOf(operand);
  if (!mem) return undefined;
  const base = operand.replace(/\.[A-Za-z]+$/, '');
  const t = typeOf(r, base);
  if (t === 'TIMER') return `${base} has timed ${readNum(r, `${base}.ACC`)} of ${readNum(r, `${base}.PRE`)} ms`;
  if (t === 'COUNTER') return `${base} counts ${readNum(r, `${base}.ACC`)} of ${readNum(r, `${base}.PRE`)}`;
  return undefined;
}

/** "Switch_0 (XIC) is 0" and friends, for a contact that broke / carried the power flow. */
function instrState(r: Reader, ins: InstructionNode, blocking: boolean): HintPart[] {
  const op0 = ins.operands[0] ?? '?';
  if (ins.op === 'XIC' || ins.op === 'XIO') {
    const v = readNum(r, op0);
    const parts: HintPart[] = [{ tag: op0 }, ` (${ins.op}) is ${Number.isFinite(v) ? v : '?'}`];
    const note = timerNote(r, op0) ?? (blocking ? wiringNote(r, op0) : undefined);
    if (note) parts.push(` (${note})`);
    return parts;
  }
  if (ins.op === 'ONS') return [{ code: `ONS(${op0})` }, blocking ? ' passes power for one scan only, on a false→true transition' : ' passed its one-scan pulse'];
  const shown = `${ins.op}(${ins.operands.join(',')})`;
  const vals = ins.operands.filter((o) => o !== '?' && !isLiteral(o) && Number.isFinite(readNum(r, o)));
  const parts: HintPart[] = [{ code: shown }, ` is ${blocking ? 'false' : 'true'}`];
  if (vals.length) parts.push(` (${vals.map((o) => `${o} = ${valueWords(readNum(r, o), typeOf(r, o) === 'BOOL')}`).join(', ')})`);
  return parts;
}

function joinParts(items: HintPart[][], sep = ', ', last = ' and '): HintPart[] {
  const out: HintPart[] = [];
  items.forEach((p, i) => {
    if (i > 0) out.push(i === items.length - 1 ? last : sep);
    out.push(...p);
  });
  return out;
}

/** "because X (XIC) is 0" — or, when every branch leg is blocked, "every branch is blocked: …; …". */
function becauseParts(r: Reader, b: InstructionNode[]): HintPart[] {
  if (b.length === 1) return [' because ', ...instrState(r, b[0]!, true)];
  return [' — every branch is blocked: ', ...joinParts(b.map((x) => instrState(r, x, true)), '; ', '; ')];
}

const TIPS: Record<string, string> = {
  XIC: 'XIC is true only while its bit is 1.',
  XIO: 'XIO is true only while its bit is 0.',
};

interface TagVerdict {
  hint: HintPart[][];
  rungs: number[];
}

/**
 * Explain why `tag` is `actual` when the test wanted `want` ('on' / 'off' for BOOL, 'higher' / 'lower' / 'other'
 * for numbers).
 */
function explainTag(r: Reader, rungs: ReadonlyArray<Rung>, live: Live | undefined, tag: string, want: 'on' | 'off' | 'higher' | 'lower' | 'other', observed?: string): TagVerdict {
  const uses = usesOf(r.scene, rungs, tag);
  const base = tag.replace(/\.[A-Za-z]+$/, '');
  const baseType = typeOf(r, base);
  const member = memberOf(tag);
  const io = ioPoint(r.scene, tag);
  const hint: HintPart[][] = [];
  const rungsOut: number[] = [];

  // timers / counters: the box instruction that owns the structure
  if ((baseType === 'TIMER' || baseType === 'COUNTER') && base !== tag) {
    const boxes = uses.filter((u) => u.dest && (TIMER_OPS.has(u.instr.op) || COUNTER_OPS.has(u.instr.op)));
    const resets = uses.filter((u) => u.instr.op === 'RES');
    if (boxes.length === 0) {
      hint.push([{ tag: base }, ` is a ${baseType} but no ${baseType === 'TIMER' ? 'TON / TOF / RTO' : 'CTU / CTD'} in your program uses it — nothing ever ${baseType === 'TIMER' ? 'times' : 'counts'}.`]);
      return { hint, rungs: rungsOut };
    }
    const box = boxes[boxes.length - 1]!;
    rungsOut.push(box.rung);
    const st = live?.[box.instr.id];
    const acc = readNum(r, `${base}.ACC`);
    const pre = readNum(r, `${base}.PRE`);
    const showMember = member !== undefined && member !== 'ACC' && member !== 'PRE';
    const para: HintPart[] = [{ tag: base }, ` is a ${box.instr.op} on `, { rung: box.rung }, ` (${showMember ? `.${member} = ${readNum(r, tag)}, ` : ''}.ACC ${acc} of .PRE ${pre}).`];
    hint.push(para);
    if (st) {
      const rung = rungs[box.rung]!;
      if (TIMER_OPS.has(box.instr.op)) {
        if (!st.in) {
          const b = blockersOf(rung, box.instr.id, live!);
          const p2: HintPart[] = b.length ? ['It is not timing: its rung condition is false', ...becauseParts(r, b), '.'] : ['It is not timing: its rung condition is false.'];
          if (box.instr.op === 'TON' && (want === 'higher' || want === 'on')) p2.push(' A TON clears .ACC every time its rung goes false.');
          hint.push(p2);
        } else if (want === 'higher' || want === 'on') {
          hint.push([`Its rung is true, so it is timing — `, box.instr.op === 'TON' ? 'a TON restarts from 0 every time its rung goes false, and .DN comes on only when .ACC reaches .PRE.' : 'check the preset and when the rung went true.']);
        } else {
          hint.push(['Its rung condition is true, so it keeps timing.']);
        }
      } else {
        hint.push([
          `It counts each false→true transition of its rung condition (now ${st.in ? 'true' : 'false'}).`,
          want === 'higher' || want === 'on' ? ' A condition that stays true counts only once — and a count on the very first scan after Run is swallowed by the prescan.' : ' Too many counts? A condition that flickers (or a missing one-shot) counts every edge.',
        ]);
      }
    }
    if (resets.length) hint.push(['It is reset by ', { code: 'RES' }, ' on ', ...joinParts(resets.map((u) => [{ rung: u.rung }] as HintPart[])), '.']);
    for (const u of resets) if (!rungsOut.includes(u.rung)) rungsOut.push(u.rung);
    return { hint, rungs: rungsOut };
  }

  if (io?.dir === 'input') {
    hint.push([{ tag: io.alias }, ` is an input (${io.operand}) — the field device sets it, your logic only reads it. ${io.description}.`]);
    return { hint, rungs: rungsOut };
  }

  const writers = uses.filter((u) => u.dest);
  if (writers.length === 0) {
    const readers = uses.filter((u) => !u.dest);
    hint.push(
      readers.length
        ? ['Nothing in your program writes ', { tag }, ' — it is only read (', ...joinParts(readers.slice(0, 3).map((u) => [{ code: u.instr.op }, ' on ', { rung: u.rung }] as HintPart[])), '). Add an output instruction (OTE) for it.']
        : ['Nothing in your program writes ', { tag }, '. Add an output instruction (OTE) for it on the rung that should switch it.'],
    );
    for (const u of readers.slice(0, 3)) if (!rungsOut.includes(u.rung)) rungsOut.push(u.rung);
    return { hint, rungs: rungsOut };
  }

  const bool = typeOf(r, tag) === 'BOOL' || typeOf(r, tag) === '';
  const actual = readNum(r, tag);
  const otes = writers.filter((u) => u.instr.op === 'OTE');
  const otls = writers.filter((u) => u.instr.op === 'OTL');
  const otus = writers.filter((u) => u.instr.op === 'OTU');
  const add = (n: number): void => {
    if (!rungsOut.includes(n)) rungsOut.push(n);
  };

  if (bool && otes.length > 1) {
    const last = otes[otes.length - 1]!;
    hint.push([{ tag }, ' is written by OTE on ', ...joinParts(otes.map((u) => [{ rung: u.rung }] as HintPart[])), ' — every OTE writes it on every scan, so the last one (', { rung: last.rung }, ') always wins. Use one OTE per output and put the conditions in parallel branches.']);
  }

  // observable wrong although the output itself is right: the plant did not follow (yet)
  const tagRight = bool && ((want === 'on' && actual === 1) || (want === 'off' && actual === 0));
  if (tagRight && observed) {
    const w = writers[writers.length - 1]!;
    add(w.rung);
    hint.push([
      'Your logic has ',
      { tag },
      ` ${actual ? 'ON' : 'OFF'} (`,
      { rung: w.rung },
      `), but ${observed} did not follow in time — the plant needs more than this output (check its feedback, interlocks and how long it takes to react).`,
    ]);
    return { hint, rungs: rungsOut };
  }

  const describeRung = (u: Use, wantTrue: boolean): void => {
    add(u.rung);
    const st = live?.[u.instr.id];
    const rung = rungs[u.rung];
    const head: HintPart[] =
      u.instr.op === 'OTE' ? [{ tag }, ' is driven by ', { rung: u.rung }] : [{ code: `${u.instr.op}(${u.instr.operands.join(',')})` }, ' on ', { rung: u.rung }];
    if (!st || !rung) {
      hint.push([...head, '.']);
      return;
    }
    if (!st.in) {
      const b = blockersOf(rung, u.instr.id, live!);
      if (b.length === 0) hint.push([...head, ' — its rung condition is false.']);
      else {
        const para: HintPart[] = [...head, ' — its rung condition is false', ...becauseParts(r, b), '.'];
        const tip = b.length === 1 ? TIPS[b[0]!.op] : undefined;
        if (tip && wantTrue) para.push(` ${tip}`);
        hint.push(para);
      }
    } else {
      const c = conductorsOf(rung, u.instr.id, live!);
      hint.push(c.length ? [...head, ' — its rung condition is true: ', ...joinParts(c.slice(0, 4).map((x) => instrState(r, x, false))), '.'] : [...head, ' — its rung condition is true (nothing in front of it).']);
    }
  };

  if (bool && want === 'other') {
    for (const u of [...otes.slice(-1), ...otls, ...otus]) describeRung(u, false);
    return { hint, rungs: rungsOut };
  }

  if (bool && (want === 'on' || want === 'off')) {
    if (otes.length > 0) describeRung(otes[otes.length - 1]!, want === 'on');
    if (want === 'on') {
      for (const u of otls) describeRung(u, true);
      for (const u of otus) if (live?.[u.instr.id]?.in) describeRung(u, false);
    } else {
      if (otls.length && actual === 1) {
        hint.push([{ tag }, ' is latched by OTL (', ...joinParts(otls.map((u) => [{ rung: u.rung }] as HintPart[])), ') — a latched bit stays 1 until an OTU clears it.']);
        otls.forEach((u) => add(u.rung));
        if (otus.length === 0) hint.push(['Nothing unlatches it: there is no ', { code: `OTU(${tag})` }, '.']);
        else for (const u of otus) describeRung(u, true);
      }
    }
    if (hint.length === 0) for (const u of writers.slice(-2)) describeRung(u, want === 'on');
    return { hint, rungs: rungsOut };
  }

  // numeric destination (MOV / ADD / CPT / SCP…)
  hint.push([{ tag }, ` is ${valueWords(actual, false)} — written by `, ...joinParts(writers.slice(0, 4).map((u) => [{ code: u.instr.op }, ' on ', { rung: u.rung }] as HintPart[])), '.']);
  for (const u of writers.slice(0, 4)) {
    add(u.rung);
    const st = live?.[u.instr.id];
    if (st && !st.in) {
      const b = blockersOf(rungs[u.rung]!, u.instr.id, live!);
      if (b.length) hint.push([{ code: u.instr.op }, ' on ', { rung: u.rung }, ' does not execute: its rung condition is false', ...becauseParts(r, b), '.']);
    }
  }
  return { hint, rungs: rungsOut };
}

function wantOf(c: Cond, actual: number): 'on' | 'off' | 'higher' | 'lower' | 'other' {
  if (typeof c.equals === 'boolean') return c.equals ? 'on' : 'off';
  if (c.min !== undefined && actual < c.min) return 'higher';
  if (c.max !== undefined && actual > c.max) return 'lower';
  if (typeof c.equals === 'number') return actual < c.equals ? 'higher' : actual > c.equals ? 'lower' : 'other';
  return 'other';
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

function instructionsOfRung(r: Rung | undefined): InstructionNode[] {
  const out: InstructionNode[] = [];
  const walk = (els: RungElement[]): void => {
    for (const el of els) {
      if (el.kind === 'branch') el.legs.forEach(walk);
      else out.push(el);
    }
  };
  if (r) walk(r.elements);
  return out;
}

function rungsOfController(c: PlcController): Rung[] {
  const p = c.project.programs.find((x) => lower(x.name) === lower(MAIN_PROGRAM)) ?? c.project.programs[0];
  const rt = p?.routines.find((x) => lower(x.name) === lower(p.mainRoutine || MAIN_ROUTINE)) ?? p?.routines[0];
  return rt?.rungs ?? [];
}

/** What the test did before the failure: its actions (and waits) up to the failing step, newest last. */
function didList(ctx: ExplainContext, upTo: number): Array<{ atMs?: number; text: string }> {
  const out: Array<{ atMs?: number; text: string }> = [];
  for (let i = 0; i < Math.min(upTo, ctx.test.steps.length); i++) {
    const s = ctx.test.steps[i]!;
    if (s.do === 'expect') continue;
    const at = ctx.stepStarts?.[i];
    out.push({ ...(at !== undefined ? { atMs: at } : {}), text: describeStep(s, ctx.scene) });
  }
  return out.slice(-4);
}

/** Explain a failed test from the runtime frozen at its failure moment (undefined for a passed test). */
export function explainFailure(ctx: ExplainContext): FailureExplanation | undefined {
  const { mission, scene, test, result, runtime } = ctx;
  if (result.passed) return undefined;
  const controller = runtime.controller;
  const program = MAIN_PROGRAM;
  const reader: Reader = { tags: controller.tags, program, scene, noted: new Set() };
  const rungs = rungsOfController(controller);
  const live = controller.getLiveState(program, MAIN_ROUTINE)?.elements;
  const f = classifyFailure(mission, test, result);
  const failure = result.failure ?? 'Failed';
  const atMs = result.failedAtMs ?? runtime.timeMs;
  const base = { step: f.step, atMs, did: didList(ctx, f.step + (f.kind === 'check' ? 0 : 1)) };

  // controller fault / Run refused / invalid step
  if (f.kind === 'other') {
    const fault = /^The controller faulted/.test(failure);
    const rungM = /rung (\d+)\)/.exec(failure);
    const rungN = rungM ? Number(rungM[1]) : undefined;
    const missing = /Tag '([^']+)' does not exist in your project/.exec(failure);
    const hint: HintPart[][] = [];
    if (rungN !== undefined) hint.push(['The fault happened while ', { rung: rungN }, ' was executing — look at its instructions and operands.']);
    if (missing) hint.push(['The test reads ', { tag: missing[1]! }, ' — create that tag (the briefing names it) or check the spelling.']);
    if (/refused to go to Run/.test(failure)) hint.push(['The controller only goes to Run with a program that verifies — fix the verification errors first.']);
    const step = f.step >= 0 ? test.steps[f.step] : undefined;
    return {
      kind: fault ? 'fault' : 'other',
      ...base,
      expected: step?.do === 'expect' ? step.message : fault ? 'The controller should keep running (no major fault)' : 'The test should run to the end',
      saw: failure.endsWith('.') ? failure : `${failure}.`,
      hint,
      tags: missing ? [missing[1]!] : [],
      rungs: rungN !== undefined ? [rungN] : [],
      elements: [],
    };
  }

  const signal = checkedSignalOf(mission, test, f.step, f.invariant);
  const inv = f.kind === 'invariant' ? mission.invariants?.[f.invariant] : undefined;
  const step = f.kind === 'check' ? (test.steps[f.step] as Extract<TestStep, { do: 'expect' }>) : undefined;
  const cond: Cond = step ?? inv ?? {};
  const what = signal ? signalLabel(scene, signal) : '?';
  const units = signal?.kind === 'observe' ? scene.observables.find((o) => o.id === signal.id)?.units : undefined;
  const observed = signal ? readSignal(runtime, signal, undefined, program) : Number.NaN;
  const prefix = step ? `${step.message} — ` : inv ? `${inv.message} — ` : '';
  const detail = prefix && failure.startsWith(prefix) ? failure.slice(prefix.length) : failure.includes(' — ') ? failure.slice(failure.lastIndexOf(' — ') + 3) : failure;
  const numericObs = signal?.kind === 'observe' && scene.observables.find((o) => o.id === signal.id)?.type === 'number';
  const want = wantOf(cond, observed);

  // the tag(s) behind the failing signal
  let tags: string[] = [];
  if (signal?.kind === 'tag') tags = [signal.id];
  else if (signal?.kind === 'observe') {
    const drivers = drivingTags(scene, signal.id);
    // several outputs (e.g. a conflict): the ones that are in the wrong state
    const wrong = drivers.filter((t) => {
      const v = readNum(reader, t);
      return want === 'off' || want === 'lower' ? v === 1 : want === 'on' || want === 'higher' ? v === 0 : true;
    });
    tags = (wrong.length ? wrong : drivers).slice(0, 2);
  }

  const hint: HintPart[][] = [];
  const rungsOut: number[] = [];
  for (const t of tags) {
    // a numeric plant value (level, temperature, counts…) is not "the output is ON": describe the driving rungs as they are
    const tagWant = numericObs ? 'other' : want;
    const v = explainTag(reader, rungs, live, t, tagWant, signal?.kind === 'observe' ? what : undefined);
    hint.push(...v.hint);
    for (const n of v.rungs) if (!rungsOut.includes(n)) rungsOut.push(n);
  }
  // expected ON but it never came on, and the program never looks at the input the test just operated:
  // a missing contact, or one on the wrong tag (Switch_1 instead of Switch_0)?
  if (want === 'on' && rungsOut.length > 0 && !/should stay/.test(detail)) {
    const operated: string[] = [];
    for (let i = 0; i <= Math.min(f.step, test.steps.length - 1); i++) {
      const s = test.steps[i]!;
      if (s.do === 'control' || s.do === 'tap') for (const a of controlAliases(scene, s.id)) if (!operated.includes(a)) operated.push(a);
    }
    const seen = new Set<string>();
    for (const r of rungs) for (const ins of instructionsOfRung(r)) for (const o of ins.operands) seen.add(canon(scene, o));
    const missing = operated.filter((a) => !seen.has(a.toLowerCase())).slice(-2);
    if (missing.length > 0) {
      hint.push([
        'The test operated ',
        ...joinParts(missing.map((a) => [{ tag: a }] as HintPart[]), ', ', ' and '),
        `, but your program never looks at ${missing.length === 1 ? 'it' : 'them'} — is a contact missing, or on the wrong tag?`,
      ]);
    }
  }
  if (signal?.kind === 'observe' && tags.length === 0) {
    hint.push([`${what} is decided by the plant itself — look at what the test did before this check and at the outputs that move it.`]);
  }

  const expected = step ? expectedText(step, what, units) : inv ? inv.message : '';
  const because = step ? step.message : undefined;
  return {
    kind: f.kind,
    ...base,
    expected: inv ? `Safety rule, checked all the time: ${inv.message}` : expected,
    ...(because && because !== expected ? { because } : {}),
    saw: sawText(detail, what),
    hint,
    ...(signal ? { signal } : {}),
    condition: cond,
    tags: tags.map((t) => t.replace(/\.[A-Za-z]+$/, '')),
    rungs: rungsOut,
    elements: rungsOut.flatMap((n) =>
      tags.flatMap((t) =>
        usesOf(scene, rungs, t)
          .filter((u) => u.rung === n && u.dest)
          .map((u) => ({ rung: n, id: u.instr.id })),
      ),
    ),
  };
}

/** Plain-text rendering of hint parts (tests, aria labels). */
export function hintText(parts: ReadonlyArray<HintPart>): string {
  return parts.map((p) => (typeof p === 'string' ? p : 'tag' in p ? p.tag : 'rung' in p ? `rung ${p.rung}` : p.code)).join('');
}

