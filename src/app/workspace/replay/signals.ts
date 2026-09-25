/**
 * The signals a mission test is about (headless): which controls it operates, which observables / tags it checks,
 * the PLC output(s) that drive each plant observable, and how to read any of them from a running test. Used by the
 * test-replay debugger (trace rows, failure explanation, ladder highlight, camera moves).
 */
import type { MissionDef, MissionInvariant, MissionTest, TestStep } from '../../../game/types';
import type { PlcController } from '../../../plc/types';
import type { SceneLogic, SimRuntime } from '../../../sim/types';

export type SignalKind = 'control' | 'observe' | 'tag';

export interface SignalRef {
  kind: SignalKind;
  id: string;
}

type SceneInfo = Pick<SceneLogic<unknown>, 'id' | 'controls' | 'observables' | 'io'>;

const lower = (s: string): string => s.toLowerCase();

export const sameSignal = (a: SignalRef, b: SignalRef): boolean => a.kind === b.kind && lower(a.id) === lower(b.id);

/** The signal a step operates or checks (wait / mode steps have none). */
export function stepSignal(step: TestStep | undefined): SignalRef | undefined {
  if (!step) return undefined;
  if (step.do === 'control' || step.do === 'tap') return { kind: 'control', id: step.id };
  if (step.do === 'expect') {
    if (step.observe !== undefined) return { kind: 'observe', id: step.observe };
    if (step.tag !== undefined) return { kind: 'tag', id: step.tag };
  }
  return undefined;
}

/** Signal an invariant checks (and the one its `when` condition reads). */
export function invariantSignals(inv: MissionInvariant): SignalRef[] {
  const out: SignalRef[] = [];
  if (inv.when?.control !== undefined) out.push({ kind: 'control', id: inv.when.control });
  else if (inv.when?.observe !== undefined) out.push({ kind: 'observe', id: inv.when.observe });
  else if (inv.when?.tag !== undefined) out.push({ kind: 'tag', id: inv.when.tag });
  if (inv.observe !== undefined) out.push({ kind: 'observe', id: inv.observe });
  else if (inv.tag !== undefined) out.push({ kind: 'tag', id: inv.tag });
  return out;
}

function pushUnique(list: SignalRef[], s: SignalRef | undefined): void {
  if (s && !list.some((x) => sameSignal(x, s))) list.push(s);
}

/**
 * The signals of a test in a useful reading order: controls it operates (inputs first), then what it checks.
 * `extra` (e.g. the failing invariant's signals, the output driving a failing observable) is appended.
 */
export function testSignals(test: MissionTest, extra: ReadonlyArray<SignalRef> = []): SignalRef[] {
  const controls: SignalRef[] = [];
  const checks: SignalRef[] = [];
  for (const s of test.steps) {
    const sig = stepSignal(s);
    if (!sig) continue;
    pushUnique(sig.kind === 'control' ? controls : checks, sig);
  }
  const out = [...controls, ...checks];
  for (const e of extra) pushUnique(out, e);
  return out;
}

// ---------------------------------------------------------------------------
// Observable → PLC output(s)
// ---------------------------------------------------------------------------

/**
 * The output alias tags whose PLC output makes a plant observable happen, per scene (what to look for in the
 * ladder when the observable is wrong). Counters and physics values list the output that moves them.
 */
const DRIVEN_BY: Record<string, Record<string, string[]>> = {
  trainer: {
    buzzerOnMs: ['Buzzer'],
  },
  'motor-station': {
    contactor: ['Motor_Starter'],
    motorRunning: ['Motor_Starter'],
    motorRpm: ['Motor_Starter'],
    motorStarts: ['Motor_Starter'],
    runTimeMs: ['Motor_Starter'],
    overloadTripped: [],
  },
  'traffic-light': {
    conflict: ['NS_Green', 'NS_Yellow', 'EW_Green', 'EW_Yellow', 'Walk'],
    conflicts: ['NS_Green', 'NS_Yellow', 'EW_Green', 'EW_Yellow', 'Walk'],
    carsPassed: ['NS_Green', 'EW_Green'],
    carsWaitingEW: ['EW_Green'],
    pedWaiting: ['Walk'],
    pedCrossed: ['Walk'],
  },
  'conveyor-sort': {
    conveyorRunning: ['Conveyor_Run'],
    beltSpeed: ['Conveyor_Run'],
    boxesGood: ['Conveyor_Run', 'Pusher_Extend'],
    jams: ['Conveyor_Run'],
    boxesFed: ['Feeder_Release'],
    boxesOnBelt: ['Feeder_Release'],
    pusherPosition: ['Pusher_Extend'],
    boxesRejected: ['Pusher_Extend'],
    missorted: ['Pusher_Extend'],
    lightGreen: ['Light_Green'],
    lightAmber: ['Light_Amber'],
    lightRed: ['Light_Red'],
  },
  'tank-process': {
    level: ['Fill_Valve', 'Drain_Valve'],
    overflow: ['Fill_Valve'],
    spills: ['Fill_Valve'],
    temperature: ['Heater'],
    heaterOn: ['Heater'],
    dryHeatMs: ['Heater'],
    mixerRunning: ['Mixer'],
    dryRunMs: ['Mixer'],
    fcvPosition: ['FCV_101'],
    batches: ['Drain_Valve'],
  },
  'parking-garage': {
    entryGateUp: ['Entry_Gate_Up'],
    entryGatePos: ['Entry_Gate_Up'],
    carsEntered: ['Entry_Gate_Up'],
    exitGateUp: ['Exit_Gate_Up'],
    exitGatePos: ['Exit_Gate_Up'],
    carsExited: ['Exit_Gate_Up'],
    gateHits: ['Entry_Gate_Up', 'Exit_Gate_Up'],
    carsTurnedAway: ['Full_Sign'],
    carsInside: [],
  },
};

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Output alias tags that drive observable `id` (empty: the plant alone decides it). Uses the scene's table, else a
 * name match with an output alias ('runLight' → Run_Light, 'light0' → Light_0, 'nsGreen' → NS_Green).
 */
export function drivingTags(scene: SceneInfo, id: string): string[] {
  const table = DRIVEN_BY[scene.id]?.[id];
  if (table) return [...table];
  const outs = scene.io.filter((p) => p.dir === 'output');
  const key = squash(id);
  const exact = outs.find((p) => squash(p.alias) === key);
  if (exact) return [exact.alias];
  return [];
}

/**
 * Input alias tag(s) a control drives (the device it operates): matched by device id ('pb_green' ↔ 'pb-green'),
 * or by name ('Switch 0' ↔ Switch_0, 'Start' ↔ Start_PB, 'E-Stop' ↔ EStop_OK).
 */
const CONTROL_INPUTS: Record<string, Record<string, string[]>> = {
  'motor-station': { overload_trip: ['OL_OK'], overload_reset: ['OL_OK'] },
  'traffic-light': { ped: ['Ped_PB'], night: ['Night_Mode'], spawn_ew: ['Car_Sensor_EW'] },
  'conveyor-sort': { pe_infeed_fail: ['PE_Infeed'] },
  'tank-process': { lt_fail: ['LT_101'], lsh_fail: ['LSH_101'] },
};

export function controlAliases(scene: Pick<SceneLogic<unknown>, 'id' | 'controls' | 'io'>, controlId: string): string[] {
  const table = CONTROL_INPUTS[scene.id]?.[controlId];
  if (table) return [...table];
  const c = scene.controls.find((x) => x.id === controlId);
  if (!c) return [];
  const id = squash(c.id);
  const label = squash(c.label);
  const ins = scene.io.filter((p) => p.dir === 'input');
  const byDevice = ins.filter((p) => p.deviceId !== undefined && (squash(p.deviceId) === id || squash(p.deviceId) === label));
  if (byDevice.length) return byDevice.map((p) => p.alias);
  const exact = ins.filter((p) => squash(p.alias) === label || squash(p.alias) === id);
  if (exact.length) return exact.map((p) => p.alias);
  return ins.filter((p) => label.length >= 3 && squash(p.alias).startsWith(label)).map((p) => p.alias);
}

/** The I/O point of an alias (case-insensitive). */
export function ioPoint(scene: Pick<SceneLogic<unknown>, 'io'>, tag: string) {
  const l = lower(tag);
  return scene.io.find((p) => lower(p.alias) === l || lower(p.operand) === l);
}

// ---------------------------------------------------------------------------
// Labels & values
// ---------------------------------------------------------------------------

/** Human label: control / observable label from the scene, tags as written. */
export function signalLabel(scene: SceneInfo | undefined, s: SignalRef): string {
  if (!scene) return s.id;
  if (s.kind === 'control') return scene.controls.find((c) => c.id === s.id)?.label ?? s.id;
  if (s.kind === 'observe') return scene.observables.find((o) => o.id === s.id)?.label ?? s.id;
  return s.id;
}

/** Whether a signal is drawn as a BOOL waveform (else a numeric step line). */
export function signalIsBool(scene: SceneInfo, controller: PlcController | undefined, s: SignalRef, program?: string): boolean {
  if (s.kind === 'control') {
    const c = scene.controls.find((x) => x.id === s.id);
    return !c || c.type === 'momentary' || c.type === 'maintained' || c.type === 'fault';
  }
  if (s.kind === 'observe') return scene.observables.find((o) => o.id === s.id)?.type !== 'number';
  if (!controller) return true;
  try {
    return String(controller.tags.typeOf(s.id, program) ?? '') === 'BOOL';
  } catch {
    return true;
  }
}

/** Current value of a signal as a number (booleans 0/1; NaN when it cannot be read). */
export function readSignal(runtime: SimRuntime, s: SignalRef, observed?: Record<string, boolean | number>, program?: string): number {
  try {
    let v: boolean | number | undefined;
    if (s.kind === 'control') v = runtime.getControl(s.id);
    else if (s.kind === 'observe') v = (observed ?? runtime.observe())[s.id];
    else {
      const tags = runtime.controller.tags;
      if (!tags.exists(s.id, program)) return Number.NaN;
      const type = String(tags.typeOf(s.id, program) ?? '');
      if (type === 'BOOL') v = tags.readBool(s.id, program);
      else if (type === 'SINT' || type === 'INT' || type === 'DINT' || type === 'REAL') v = tags.readNumber(s.id, program);
      else return Number.NaN;
    }
    if (v === undefined) return Number.NaN;
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  } catch {
    return Number.NaN;
  }
}

/** The failing check or invariant of a mission test, if the failure was one. */
export function checkedSignalOf(mission: Pick<MissionDef, 'invariants'>, test: MissionTest, failedStep: number, invariant: number): SignalRef | undefined {
  if (invariant >= 0) {
    const inv = mission.invariants?.[invariant];
    if (inv?.observe !== undefined) return { kind: 'observe', id: inv.observe };
    if (inv?.tag !== undefined) return { kind: 'tag', id: inv.tag };
    return undefined;
  }
  const step = failedStep >= 0 ? test.steps[failedStep] : undefined;
  return step?.do === 'expect' ? stepSignal(step) : undefined;
}
