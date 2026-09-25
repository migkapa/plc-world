/**
 * Which camera preset shows the device a test checks, for "Watch this test" (headless): the replay flies there
 * so the player sees the lamp / valve / gate that failed instead of whatever view they left the plant in.
 * Rules per scene match an observable id or tag name to one of the scene's camera ids (see the scenes'
 * definition.tsx); the first matching rule wins.
 */
import { classifyFailure } from '../../game/objectives';
import type { MissionDef, MissionTest, TestResult } from '../../game/types';

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
export function cameraForSignal(sceneId: string, id: string | undefined): string | undefined {
  if (!id) return undefined;
  for (const [re, cam] of RULES[sceneId] ?? []) if (re.test(id)) return cam;
  return undefined;
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
export function replayCamera(sceneId: string, mission: Pick<MissionDef, 'invariants' | 'tests'>, index: number, result: TestResult | undefined): string | undefined {
  return cameraForSignal(sceneId, replaySignal(mission, mission.tests[index], result));
}
