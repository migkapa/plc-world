/**
 * Plain-language descriptions of mission test steps and results (for the Test panel and the
 * "watch this test" playback). Headless.
 */
import type { MissionDef, MissionInvariant, TestResult, TestStep } from '../../game/types';
import type { ControlDef, ObservableDef, SceneLogic } from '../../sim/types';

type SceneInfo = Pick<SceneLogic<unknown>, 'controls' | 'observables'>;

/** Seconds with sensible precision: 0.2 s, 1.5 s, 12 s. */
export function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  if (s >= 10) return `${Math.round(s)} s`;
  if (s >= 1) return `${Math.round(s * 10) / 10} s`;
  return `${Math.round(s * 100) / 100} s`;
}

/** Duration: 200 ms, 1.5 s. */
export function fmtDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : fmtSeconds(ms);
}

function controlValueText(def: ControlDef | undefined, value: boolean | number): string {
  if (!def) return String(value);
  if (def.type === 'selector') {
    const pos = def.positions?.[Number(value)];
    return pos ? `“${pos}”` : `position ${String(value)}`;
  }
  if (def.type === 'analog') return `${typeof value === 'number' ? Math.round(value * 100) / 100 : String(value)}${def.units ? ` ${def.units}` : ''}`;
  if (def.id === 'estop' || /e-?stop/i.test(def.label)) return value ? 'PUSHED' : 'released';
  if (def.type === 'fault') return value ? 'ON (fault injected)' : 'OFF (fault cleared)';
  if (def.type === 'momentary') return value ? 'pressed' : 'released';
  return value ? 'ON' : 'OFF';
}

function label(scene: SceneInfo | undefined, kind: 'control' | 'observe', id: string): string {
  if (!scene) return id;
  if (kind === 'control') return scene.controls.find((c) => c.id === id)?.label ?? id;
  return scene.observables.find((o) => o.id === id)?.label ?? id;
}

function condText(c: { equals?: boolean | number; min?: number; max?: number }, obs?: ObservableDef): string {
  const units = obs?.units ? ` ${obs.units}` : '';
  if (c.equals !== undefined) return typeof c.equals === 'boolean' ? (c.equals ? 'ON' : 'OFF') : `= ${c.equals}${units}`;
  if (c.min !== undefined && c.max !== undefined) return `between ${c.min} and ${c.max}${units}`;
  if (c.min !== undefined) return `≥ ${c.min}${units}`;
  if (c.max !== undefined) return `≤ ${c.max}${units}`;
  return '';
}

/** One-line description of a test step, e.g. "Press Start for 200 ms". */
export function describeStep(step: TestStep, scene?: SceneInfo): string {
  switch (step.do) {
    case 'wait':
      return `Wait ${fmtDuration(step.ms)}`;
    case 'control': {
      const def = scene?.controls.find((c) => c.id === step.id);
      return `Set ${label(scene, 'control', step.id)} to ${controlValueText(def, step.value)}`;
    }
    case 'tap':
      return `Press ${label(scene, 'control', step.id)} for ${fmtDuration(step.ms ?? 200)}`;
    case 'mode':
      return step.mode === 'PROG' ? 'Switch the controller to Program mode' : 'Switch the controller back to Run mode';
    case 'expect': {
      const obs = step.observe ? scene?.observables.find((o) => o.id === step.observe) : undefined;
      const what = step.observe ? label(scene, 'observe', step.observe) : `tag ${step.tag ?? '?'}`;
      const timing: string[] = [];
      if (step.within !== undefined) timing.push(`within ${fmtDuration(step.within)}`);
      if (step.for !== undefined) timing.push(`for ${fmtDuration(step.for)}`);
      return `Check: ${step.message} (${what} ${condText(step, obs)}${timing.length ? `, ${timing.join(', ')}` : ''})`;
    }
    default:
      return 'Unknown step';
  }
}

/** Short action label for the playback banner ("Checking…", "Pressing Start"). */
export function stepVerb(step: TestStep | undefined): string {
  if (!step) return 'Finished';
  switch (step.do) {
    case 'wait':
      return 'Waiting';
    case 'control':
    case 'tap':
      return 'Operating';
    case 'mode':
      return 'Mode change';
    case 'expect':
      return 'Checking';
    default:
      return '';
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace observable ids in a runner message by their labels ("expected light0 ON" → "expected Light 0 ON"). */
export function humanizeMessage(message: string, scene?: Pick<SceneLogic<unknown>, 'observables'>): string {
  if (!scene) return message;
  let out = message;
  for (const o of scene.observables) {
    if (!o.label || o.label === o.id) continue;
    out = out.replace(new RegExp(`(expected |— |, )${escapeRe(o.id)}(?= )`, 'g'), `$1${o.label}`);
  }
  return out;
}

/** The failure of a test in plain language: message + when it happened. */
export function describeFailure(result: TestResult, scene?: Pick<SceneLogic<unknown>, 'observables'>): { message: string; at?: string } {
  const message = humanizeMessage((result.failure ?? 'Failed').replace(/^Not run: /, ''), scene);
  const out: { message: string; at?: string } = { message };
  if (result.failedAtMs !== undefined && result.failedAtMs > 0) out.at = `after ${fmtSeconds(result.failedAtMs)} of simulated time`;
  return out;
}

/** Which invariants a set of results violated (matched by message prefix). */
export function violatedInvariants(mission: Pick<MissionDef, 'invariants'>, results: ReadonlyArray<TestResult | undefined>): Set<number> {
  const out = new Set<number>();
  (mission.invariants ?? []).forEach((inv: MissionInvariant, i) => {
    if (results.some((r) => r?.failure !== undefined && r.failure.startsWith(`${inv.message} — `))) out.add(i);
  });
  return out;
}

/** Control ids a mission's tests operate (used to reveal fault controls in the Instructor menu). */
export function controlsUsedByTests(mission: Pick<MissionDef, 'tests' | 'invariants'>): Set<string> {
  const ids = new Set<string>();
  for (const t of mission.tests) for (const s of t.steps) if (s.do === 'control' || s.do === 'tap') ids.add(s.id);
  for (const inv of mission.invariants ?? []) if (inv.when?.control) ids.add(inv.when.control);
  return ids;
}
