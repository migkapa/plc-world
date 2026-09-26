/**
 * "Try it now" suggestions (headless): after an online edit applies, which operator control should the player
 * operate to see the edited rung work? Derived from the mission's tests and the plant wiring:
 *
 *  1. `controlInputs(scene)` finds, by probing the headless plant model, which input aliases each operator control
 *     drives (Switch 0 → `Switch_0`, the Stop button → `Stop_PB`…);
 *  2. `suggestTryIt()` first looks for the operator inputs the edited rung *needs*: contacts in its main series path
 *     (not inside a branch) that are false at rest and true once their control is operated (XIC on a N.O. switch, XIO
 *     on a N.C. button…). Two or more of them (an AND) are all named — "Flip Switch 2 and Switch 3 to try your rung" —
 *     because operating only one shows nothing. Otherwise it prefers a control whose alias appears in the edited rungs,
 *     among the controls the mission's tests operate (in test order); else the first control the tests operate.
 */
import type { MissionDef } from '../../../game/types';
import { parseRungText } from '../../../plc/neutralText';
import type { RungElement } from '../../../plc/types';
import type { ControlDef, IoAccess, SceneLogic } from '../../../sim/types';

/** An input alias a control drives: its value at rest and once the control is operated. */
export interface ControlInput {
  alias: string;
  rest: boolean | number;
  active: boolean | number;
}

const cache = new WeakMap<SceneLogic<unknown>, Map<string, ControlInput[]>>();
const aliasCache = new WeakMap<SceneLogic<unknown>, Map<string, string[]>>();

/** The value that "operates" a control from its default (press, flip, next position, other end of the range). */
export function activeValue(c: ControlDef): boolean | number {
  switch (c.type) {
    case 'selector': {
      const n = Math.max(2, c.positions?.length ?? 2);
      return (Number(c.default) + 1) % n;
    }
    case 'analog': {
      const [lo, hi] = c.range ?? [0, 100];
      return Number(c.default) <= (lo + hi) / 2 ? hi : lo;
    }
    default:
      return !c.default;
  }
}

/**
 * Input aliases each operator control drives (fault injections skipped), found by stepping the headless plant from
 * a fresh state with and without the control operated and comparing what it writes to the input image.
 */
export function controlInputs(scene: SceneLogic<unknown>): Map<string, string[]> {
  const hit = aliasCache.get(scene);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  for (const [id, list] of controlProbe(scene)) out.set(id, list.map((i) => i.alias));
  aliasCache.set(scene, out);
  return out;
}

/** Like controlInputs, with each input's value at rest and operated (cached per scene). */
export function controlProbe(scene: SceneLogic<unknown>): Map<string, ControlInput[]> {
  const hit = cache.get(scene);
  if (hit) return hit;
  const aliasOf = new Map(scene.io.filter((p) => p.dir === 'input').map((p) => [p.operand.toLowerCase(), p.alias] as const));
  const run = (operate?: ControlDef): Map<string, boolean | number> => {
    const writes = new Map<string, boolean | number>();
    const io: IoAccess = {
      readBool: () => false,
      readNumber: () => 0,
      writeBool: (op, v) => void writes.set(op.toLowerCase(), v),
      writeNumber: (op, v) => void writes.set(op.toLowerCase(), v),
    };
    const state = scene.createState();
    for (let i = 0; i < 3; i++) scene.step(state, 10, io);
    if (operate) scene.setControl(state, operate.id, activeValue(operate));
    for (let i = 0; i < 3; i++) scene.step(state, 10, io);
    return writes;
  };
  const out = new Map<string, ControlInput[]>();
  let base: Map<string, boolean | number>;
  try {
    base = run();
  } catch {
    cache.set(scene, out);
    return out;
  }
  for (const c of scene.controls) {
    if (c.type === 'fault') continue;
    let after: Map<string, boolean | number>;
    try {
      after = run(c);
    } catch {
      continue;
    }
    const inputs: ControlInput[] = [];
    for (const [op, v] of after) {
      const b = base.get(op);
      const changed = typeof v === 'number' && typeof b === 'number' ? Math.abs(v - b) > 1e-6 : v !== b;
      const alias = aliasOf.get(op);
      if (changed && alias && !inputs.some((i) => i.alias === alias)) inputs.push({ alias, rest: b ?? false, active: v });
    }
    out.set(c.id, inputs);
  }
  cache.set(scene, out);
  return out;
}

/** Tag names used as operands in neutral-text rungs (base names: `T1.DN` → `T1`, `Arr[2]` → `Arr`), lower case. */
export function operandNames(rungs: ReadonlyArray<string>): Set<string> {
  const out = new Set<string>();
  for (const r of rungs) {
    for (const m of r.matchAll(/\(([^()]*)\)/g)) {
      for (const raw of (m[1] ?? '').split(',')) {
        const t = raw.trim();
        const base = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(t)?.[1];
        if (base) out.add(base.toLowerCase());
      }
    }
  }
  return out;
}

/** Controls operated by the mission's tests, in the order they are first used. */
export function testControlsInOrder(mission: Pick<MissionDef, 'tests'>): string[] {
  const out: string[] = [];
  for (const t of mission.tests) for (const s of t.steps) if ((s.do === 'control' || s.do === 'tap') && !out.includes(s.id)) out.push(s.id);
  return out;
}

export interface TryItSuggestion {
  /** The (first) control to operate. */
  controlId: string;
  label: string;
  /** "Flip", "Press", "Turn", "Move", "Push". */
  verb: string;
  key?: string;
  /**
   * Every control to operate, `controlId` first: an AND rung needs all of them at once (length ≥ 2), otherwise just
   * `[controlId]`.
   */
  controlIds: string[];
  /** Keyboard keys of controlIds that have one (in the same order). */
  keys?: string[];
  /** e.g. "Flip Switch 0 to try your rung", "Flip Switch 2 and Switch 3 to try your rung". */
  text: string;
  /** Whether the control drives an operand of the edited rungs (else: the first control the tests operate). */
  matched: boolean;
}

/** Top-level (series) contacts of a rung: those that must all be true for power to reach the output. */
function seriesContacts(elements: ReadonlyArray<RungElement>): Array<{ op: 'XIC' | 'XIO'; tag: string }> {
  const out: Array<{ op: 'XIC' | 'XIO'; tag: string }> = [];
  for (const el of elements) {
    if (el.kind !== 'instr' || (el.op !== 'XIC' && el.op !== 'XIO')) continue;
    const tag = /^([A-Za-z_][A-Za-z0-9_]*)/.exec((el.operands[0] ?? '').trim())?.[1];
    if (tag) out.push({ op: el.op, tag: tag.toLowerCase() });
  }
  return out;
}

const truthy = (v: boolean | number): boolean => (typeof v === 'number' ? v !== 0 : v);

/**
 * Controls (of `order`) the rung needs operated: series contacts false at rest that turn true when their control is
 * operated. Empty when the rung does not parse or needs none.
 */
export function neededControls(rungText: string, order: ReadonlyArray<string>, probe: Map<string, ControlInput[]>): string[] {
  let elements: RungElement[];
  try {
    elements = parseRungText(rungText);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const k of seriesContacts(elements)) {
    for (const id of order) {
      const input = (probe.get(id) ?? []).find((i) => i.alias.toLowerCase() === k.tag && typeof i.rest === 'boolean');
      if (!input) continue;
      const atRest = k.op === 'XIC' ? truthy(input.rest) : !truthy(input.rest);
      const operated = k.op === 'XIC' ? truthy(input.active) : !truthy(input.active);
      if (!atRest && operated && !out.includes(id)) out.push(id);
      break;
    }
  }
  return out;
}

/** "Flip Switch 2 and Switch 3", "Flip Switch 2 and press Black PB 1", "Hold Black PB 1 and Black PB 2 together". */
function actionText(cs: ReadonlyArray<ControlDef>): string {
  const holdMany = cs.filter((c) => c.type === 'momentary').length >= 2;
  const verbOf = (c: ControlDef): string => (holdMany && c.type === 'momentary' ? 'Hold' : verbFor(c));
  const parts = cs.map((c, i) => {
    const v = verbOf(c);
    if (i === 0) return `${v} ${c.label}`;
    return v === verbOf(cs[i - 1]!) ? c.label : `${v.toLowerCase()} ${c.label}`;
  });
  const list = parts.length <= 2 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return holdMany ? `${list} together` : list;
}

export function verbFor(c: Pick<ControlDef, 'type' | 'id' | 'label'>): string {
  if (/e-?stop|emergency/i.test(`${c.id} ${c.label}`)) return 'Push';
  switch (c.type) {
    case 'momentary':
      return 'Press';
    case 'selector':
      return 'Turn';
    case 'analog':
      return 'Move';
    default:
      return 'Flip';
  }
}

/**
 * The control to suggest after `editedRungs` (neutral text) were applied online, or null when nothing fits (no
 * instruction on the edited rungs, or the mission's tests operate no control).
 */
export function suggestTryIt(
  mission: Pick<MissionDef, 'tests' | 'controls'>,
  scene: SceneLogic<unknown>,
  editedRungs: ReadonlyArray<string>,
  /** The live value of a control (the plant as it is now): a switch already in place is not asked for again. */
  current?: (id: string) => boolean | number | undefined,
): TryItSuggestion | null {
  const names = operandNames(editedRungs);
  if (names.size === 0) return null;
  const byId = new Map(scene.controls.filter((c) => c.type !== 'fault').map((c) => [c.id, c] as const));
  const tested = testControlsInOrder(mission).filter((id) => byId.has(id));
  const order = [...tested, ...(mission.controls ?? []).filter((id) => byId.has(id) && !tested.includes(id))];
  const probe = controlProbe(scene);
  // what the edited rung needs operated (an AND of operator inputs: all of them, else nothing lights up)
  for (const rungText of editedRungs) {
    const needed = neededControls(rungText, order, probe);
    if (needed.length === 0) continue;
    // maintained switches already in their operated position need nothing more (unless that is all of them)
    const todo = current
      ? needed.filter((id) => {
          const c = byId.get(id)!;
          return c.type === 'momentary' || current(id) !== activeValue(c);
        })
      : needed;
    const ids = todo.length > 0 ? todo : needed.slice(0, 1);
    const cs = ids.map((id) => byId.get(id)!);
    const first = cs[0]!;
    const keys = cs.map((c) => c.key).filter((k): k is string => !!k);
    const holdMany = cs.filter((c) => c.type === 'momentary').length >= 2;
    const text = `${actionText(cs)} to try your rung${holdMany ? ' — one alone does nothing (series = AND)' : ''}`;
    const out: TryItSuggestion = { controlId: first.id, label: first.label, verb: verbFor(first), controlIds: ids, text, matched: true };
    if (first.key) out.key = first.key;
    if (keys.length > 0) out.keys = keys;
    return out;
  }
  const inputs = controlInputs(scene);
  const matchedId = order.find((id) => (inputs.get(id) ?? []).some((a) => names.has(a.toLowerCase())));
  const id = matchedId ?? order[0];
  const c = id ? byId.get(id) : undefined;
  if (!c) return null;
  const verb = verbFor(c);
  const what = matchedId ? 'to try your rung' : 'and watch your rung';
  const out: TryItSuggestion = { controlId: c.id, label: c.label, verb, controlIds: [c.id], text: `${verb} ${c.label} ${what}`, matched: matchedId !== undefined };
  if (c.key) {
    out.key = c.key;
    out.keys = [c.key];
  }
  return out;
}
