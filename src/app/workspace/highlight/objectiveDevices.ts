/**
 * Which physical devices an objective is about (headless), for the 3D highlight when the player hovers it:
 *
 *  1. the I/O tags its text names in code spans (`Switch_0`, `Light_0`…);
 *  2. otherwise the devices its proofs (`objectiveTests`) exercise: the controls the proving tests operate (mapped to
 *     their input aliases by probing the plant, see tryIt.ts `controlInputs`), the observables they check (mapped to the
 *     outputs that drive them, `outputObservables` below) and the I/O tags they check — ranked by the words of the
 *     objective ("Stop wins…" → Stop_PB first) and trimmed to the ones it mentions when it mentions any.
 */
import { proofSteps } from '../../../game/objectives';
import type { MissionDef } from '../../../game/types';
import type { IoAccess, SceneLogic } from '../../../sim/types';
import { controlInputs } from '../onboarding/tryIt';
import { aliasesInText, ioAliasOf } from './aliases';

/** At most this many devices per objective (the outline should point, not light up the plant). */
export const MAX_OBJECTIVE_DEVICES = 4;
/** Simulated time the output probe runs (ms): long enough for contactors, motors and valves to respond. */
const PROBE_MS = 2000;

const obsCache = new WeakMap<SceneLogic<unknown>, Map<string, string[]>>();

/**
 * Output aliases driving each observable, found by running the headless plant from a fresh state with one output on
 * (others off) and comparing its observables with an all-off run (e.g. `motorRunning` ← Motor_Starter).
 */
export function outputObservables(scene: SceneLogic<unknown>): Map<string, string[]> {
  const hit = obsCache.get(scene);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  obsCache.set(scene, out);
  const run = (operand?: string, range?: [number, number]): Record<string, boolean | number> => {
    const on = operand?.toLowerCase();
    const io: IoAccess = {
      readBool: (op) => op.toLowerCase() === on,
      readNumber: (op) => (op.toLowerCase() === on ? (range ? (range[0] + range[1]) / 2 || range[1] : 50) : 0),
      writeBool: () => {},
      writeNumber: () => {},
    };
    const state = scene.createState();
    for (let t = 0; t < PROBE_MS; t += 10) scene.step(state, 10, io);
    return scene.observe(state);
  };
  let base: Record<string, boolean | number>;
  try {
    base = run();
  } catch {
    return out;
  }
  for (const p of scene.io) {
    if (p.dir !== 'output') continue;
    let after: Record<string, boolean | number>;
    try {
      after = run(p.operand, p.range);
    } catch {
      continue;
    }
    for (const [id, v] of Object.entries(after)) {
      const b = base[id];
      const changed = typeof v === 'number' && typeof b === 'number' ? Math.abs(v - b) > 1e-6 : v !== b;
      if (!changed) continue;
      const list = out.get(id) ?? [];
      if (!list.includes(p.alias)) list.push(p.alias);
      out.set(id, list);
    }
  }
  return out;
}

const STOP = new Set(['the', 'and', 'for', 'are', 'not', 'with', 'when', 'while', 'its', 'all', 'any', 'one', 'has', 'but', 'was', 'then', 'after', 'both', 'must', 'from', 'into', 'that', 'this', 'only', 'again', 'still', 'more', 'than']);
const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

type MissionLike = Pick<MissionDef, 'objectives' | 'objectiveTests' | 'tests' | 'invariants'>;

/** Devices (I/O aliases, most relevant first) the objective `index` is about; [] when none can be told. */
export function objectiveDevices(mission: MissionLike, scene: SceneLogic<unknown>, index: number): string[] {
  const text = mission.objectives[index] ?? '';
  const named = aliasesInText(text, scene.io);
  // plain-text alias names count too, spelled exactly ("Fill_Valve closes when LT_101 reaches 80 %", "Buzzer ON…")
  for (const m of text.replace(/`[^`]*`/g, ' ').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const p = scene.io.find((x) => x.alias === m[0]);
    if (p && !named.includes(p.alias)) named.push(p.alias);
  }
  if (named.length > 0) return named.slice(0, MAX_OBJECTIVE_DEVICES);

  // signals the proofs exercise, in test order
  const controls: string[] = [];
  const observes: string[] = [];
  const tags: string[] = [];
  const add = (list: string[], id: string | undefined): void => {
    if (id && !list.includes(id)) list.push(id);
  };
  for (const p of mission.objectiveTests?.[index] ?? []) {
    if (typeof p === 'object' && 'invariant' in p) {
      const inv = mission.invariants?.[p.invariant];
      add(observes, inv?.observe);
      add(tags, inv?.tag);
      add(controls, inv?.when?.control);
      add(observes, inv?.when?.observe);
      add(tags, inv?.when?.tag);
      continue;
    }
    const test = mission.tests[typeof p === 'number' ? p : p.test];
    if (!test) continue;
    const steps = proofSteps(mission, p);
    const last = steps && steps.length > 0 ? Math.max(...steps) : test.steps.length - 1;
    test.steps.forEach((s, j) => {
      if (j > last) return;
      if (s.do === 'control' || s.do === 'tap') add(controls, s.id);
      else if (s.do === 'expect' && (!steps || steps.includes(j))) {
        add(observes, s.observe);
        add(tags, s.tag);
      }
    });
  }
  const inputs = controlInputs(scene);
  const outputs = outputObservables(scene);
  const labels = new Map<string, string[]>(); // alias → words that name it (alias, control / observable labels, device)
  const found: string[] = [];
  const take = (alias: string | undefined, label?: string): void => {
    if (!alias) return;
    if (!found.includes(alias)) found.push(alias);
    const l = labels.get(alias) ?? words(alias.replace(/_/g, ' '));
    if (label) l.push(...words(label));
    labels.set(alias, l);
  };
  for (const id of controls) {
    const c = scene.controls.find((x) => x.id === id);
    if (!c || c.type === 'fault') continue;
    for (const a of inputs.get(id) ?? []) take(a, c.label);
  }
  for (const id of observes) {
    const o = scene.observables.find((x) => x.id === id);
    for (const a of outputs.get(id) ?? []) take(a, o?.label);
  }
  for (const t of tags) take(ioAliasOf(t.replace(/[.[].*$/, ''), scene.io));
  if (found.length === 0) return [];

  // rank by where the objective first mentions them ("Stop wins…" → Stop_PB first; "stops" names "stop", "running"
  // names "run"); when it mentions some, only those
  const tw = words(text);
  const firstMention = (a: string): number => {
    const l = labels.get(a) ?? [];
    const i = tw.findIndex((t) => l.some((w) => t === w || t.startsWith(w)));
    return i < 0 ? Infinity : i;
  };
  const ranked = found.map((a, i) => ({ a, i, at: firstMention(a) })).sort((x, y) => x.at - y.at || x.i - y.i);
  const mentioned = ranked.filter((r) => r.at !== Infinity);
  if (mentioned.length === 0) return ranked.slice(0, MAX_OBJECTIVE_DEVICES).map((r) => r.a);
  // one device per mentioned word first ("switches … light" → a switch and the light), then the rest in order
  const out: string[] = [];
  const groups = [...new Set(mentioned.map((r) => r.at))].map((at) => mentioned.filter((r) => r.at === at));
  for (let k = 0; out.length < MAX_OBJECTIVE_DEVICES && groups.some((g) => g.length > k); k++) {
    for (const g of groups) if (g[k] && out.length < MAX_OBJECTIVE_DEVICES) out.push(g[k]!.a);
  }
  return out;
}
