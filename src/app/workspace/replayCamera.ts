/**
 * Which camera preset shows the device a test checks, for "Watch this test" (headless): the replay flies there
 * so the player sees the lamp / valve / gate that failed instead of whatever view they left the plant in, and it
 * follows the test as it runs (the button a step presses, the lamp the next check waits for).
 *
 * A scene definition's optional `focus` map (control / observable / alias tag → camera id, see the scenes'
 * definition.tsx) wins; the regex rules below are the fallback (first matching rule wins).
 */
import { classifyFailure } from '../../game/objectives';
import type { MissionDef, MissionTest, TestResult, TestStep } from '../../game/types';

/** Device → camera preset map of a scene (`SceneDefinition.focus`). */
export type FocusMap = Readonly<Record<string, string>>;

type Rule = [RegExp, string];

const RULES: Record<string, Rule[]> = {
  trainer: [
    [/^(light|buzzer|meter)/i, 'outputs'],
    [/^(sw|pb_|pot)/i, 'console'],
    [/.*/, 'station'], // internal tags (counters…): the whole trainer
  ],
  'motor-station': [
    [/^(runlight|readylight|faultlight|run_light|ready_light|fault_light|start|stop|jog|estop|hoa)/i, 'operator'],
    [/^(motorrunning|motorrpm|motorstarts|jam|runtimems)/i, 'drive'],
    [/^(contactor|motor_starter|motor_aux|horn|overload|ol_ok|run_timer)/i, 'panel'],
    [/.*/, 'overview'],
  ],
  'conveyor-sort': [
    [/^(pusher|boxesrejected|pe_divert|pe_tall)/i, 'pusher'],
    [/^(light|start|stop|estop)/i, 'operator'],
    [/.*/, 'overview'],
  ],
  'tank-process': [
    [/^(runninglight|batchdonelight|alarmhorn|running_light|batch_done|alarm_horn|start|stop|estop|discharge)/i, 'operator'],
    [/^(fillvalve|drainvalve|fill_valve|drain_valve)/i, 'valves'],
    [/^(level|lt_|lsh|lsl|temperature|heater|mixer|step|batches)/i, 'tank'],
    [/.*/, 'overview'],
  ],
  'traffic-light': [
    [/^(walk|dontwalk|dont_walk|ped)/i, 'pedestrian'],
    [/.*/, 'overview'],
  ],
  'parking-garage': [
    [/^(exit|carsexited)/i, 'exit'],
    [/^(entry|ticket|carsentered|carsturnedaway)/i, 'ticket'],
    [/^(car_count|reset)/i, 'booth'],
    [/.*/, 'overview'],
  ],
};

/** Camera id for an observable / tag / control of a scene (undefined: keep the player's view). */
export function cameraForSignal(sceneId: string, id: string | undefined, focus?: FocusMap): string | undefined {
  if (!id) return undefined;
  if (focus) {
    const base = id.replace(/[.[].*$/, ''); // 'Run_Timer.DN' → 'Run_Timer', 'Arr[3]' → 'Arr'
    const direct = focus[id] ?? focus[base];
    if (direct) return direct;
    const l = id.toLowerCase();
    const bl = base.toLowerCase();
    for (const [k, cam] of Object.entries(focus)) if (k.toLowerCase() === l || k.toLowerCase() === bl) return cam;
  }
  for (const [re, cam] of RULES[sceneId] ?? []) if (re.test(id)) return cam;
  return undefined;
}

function stepSignalId(step: TestStep | undefined): string | undefined {
  if (!step) return undefined;
  if (step.do === 'control' || step.do === 'tap') return step.id;
  if (step.do === 'expect') return step.observe ?? step.tag;
  return undefined;
}

/**
 * Camera for every step of a test (index-aligned with `test.steps`, plus one entry for "finished"): a step that
 * operates or checks a device looks at that device; a wait looks at the device of the next action or check (else
 * keeps the previous view). `failure` (the failing step and the signal it failed on — e.g. an invariant tripped
 * during a wait) points the failing step and the end at the failing device.
 */
export function stepCameras(sceneId: string, test: MissionTest, focus?: FocusMap, failure?: { step: number; signal?: string | undefined }): Array<string | undefined> {
  const n = test.steps.length;
  const own = test.steps.map((s) => cameraForSignal(sceneId, stepSignalId(s), focus));
  const out: Array<string | undefined> = new Array<string | undefined>(n + 1).fill(undefined);
  let prev: string | undefined;
  for (let i = 0; i < n; i++) {
    let cam = own[i];
    if (cam === undefined) {
      // wait / mode: look ahead to the device of the next action or check (what the wait leads up to)
      for (let j = i + 1; j < n && cam === undefined; j++) cam = own[j];
      cam ??= prev;
    }
    out[i] = cam;
    if (cam !== undefined) prev = cam;
  }
  out[n] = prev;
  if (failure && failure.step >= 0) {
    const cam = cameraForSignal(sceneId, failure.signal, focus);
    if (cam !== undefined) {
      if (failure.step < n) out[failure.step] = cam;
      out[n] = cam;
    }
  }
  // the first steps (before any device) look where the test will look first
  const first = out.find((c) => c !== undefined);
  for (let i = 0; i < out.length && out[i] === undefined; i++) out[i] = first;
  return out;
}

/** The signal a replay should look at: the failing check (or invariant) of a failed run, else the test's first check. */
export function replaySignal(mission: Pick<MissionDef, 'invariants'>, test: MissionTest | undefined, result: TestResult | undefined): string | undefined {
  if (!test) return undefined;
  if (result && !result.passed) {
    const f = classifyFailure(mission, test, result);
    if (f.kind === 'invariant') {
      const inv = mission.invariants?.[f.invariant];
      if (inv) return inv.observe ?? inv.tag;
    }
    const step = f.step >= 0 ? test.steps[f.step] : undefined;
    if (step?.do === 'expect') return step.observe ?? step.tag;
  }
  for (const s of test.steps) if (s.do === 'expect') return s.observe ?? s.tag;
  return undefined;
}

/** Camera preset for replaying test `index` (undefined: keep the current view). */
export function replayCamera(sceneId: string, mission: Pick<MissionDef, 'invariants' | 'tests'>, index: number, result: TestResult | undefined, focus?: FocusMap): string | undefined {
  return cameraForSignal(sceneId, replaySignal(mission, mission.tests[index], result), focus);
}
