/**
 * A "Watch this test" replay as a debugging session (headless): the test is first run to completion off-screen
 * (deterministic, a few ms) to record an expected-vs-actual TRACE of every signal it involves, the step
 * boundaries, the failure moment and its explanation; then a second runner replays it on screen (advance /
 * step / seek), so the page can pause at the failure knowing everything in advance.
 *
 *   const s = new ReplaySession(mission, project, index);
 *   s.runner.runtime            // render this (it is replaced by seeks: watch `generation`)
 *   s.advance(dtMs * speed)     // from the animation loop
 *   s.stepForward(); s.stepBack(); s.seekStep(k); s.jumpToFailure(); s.restart()
 *   s.trace, s.explanation, s.final
 */
import { classifyFailure } from '../../../game/objectives';
import type { MissionDef, MissionTest, TestResult } from '../../../game/types';
import { conditionHolds, createMissionTestRunner, missionScene, VALIDATION_STEP_MS, type MissionTestRunner } from '../../../game/validation';
import type { Project } from '../../../plc/types';
import { MAIN_PROGRAM } from '../../../sim/project';
import type { SceneLogic } from '../../../sim/types';
import { explainFailure, type FailureExplanation } from './explain';
import { checkedSignalOf, drivingTags, invariantSignals, readSignal, sameSignal, signalIsBool, signalLabel, stepSignal, testSignals, type SignalRef } from './signals';

export type Condition = { equals?: boolean | number; min?: number; max?: number };

/** Where a test expected a signal to meet a condition. */
export interface TraceBand {
  from: number;
  to: number;
  cond: Condition;
  /** Step index (−1 for a safety rule). */
  step: number;
  /** `within` deadline (absolute ms), when the check allowed time to settle. */
  deadline?: number;
  failed: boolean;
}

export interface TraceRow {
  signal: SignalRef;
  label: string;
  kind: 'bool' | 'number';
  units?: string;
  /** operated by the test · checked by it · the PLC output behind a check · read by a safety rule */
  role: 'input' | 'check' | 'output' | 'rule';
  bands: TraceBand[];
  /** The row the failure is about. */
  failing: boolean;
}

export interface ReplayTrace {
  rows: TraceRow[];
  /** Sample times (ms); `count` are valid. */
  times: Float64Array;
  /** One value column per row (NaN = unreadable). */
  values: Float64Array[];
  count: number;
  /** Simulated time at the end of the test (failure or last step). */
  endMs: number;
  /** Time each step started (NaN: never reached). */
  stepStarts: number[];
  failAtMs?: number;
}

/** A step boundary the replay can stop at (the runner pauses only inside steps that take time). */
export interface StepStop {
  step: number;
  /** Time at which the runner first shows this step. */
  atMs: number;
}

type Listener = () => void;

const MAX_ROWS = 8;

function rowRole(test: MissionTest, s: SignalRef): TraceRow['role'] {
  if (s.kind === 'control') return 'input';
  return test.steps.some((st) => st.do === 'expect' && sameSignal(stepSignal(st)!, s)) ? 'check' : 'output';
}

/** Run the test to completion off-screen, sampling every signal once per 10 ms step. */
export function recordTestTrace(
  mission: MissionDef,
  project: Project,
  index: number,
  known?: TestResult,
): { trace: ReplayTrace; result: TestResult; stops: StepStop[]; explanation: FailureExplanation | undefined } {
  const test = mission.tests[index]!;
  const scene = missionScene(mission);
  const runner = createMissionTestRunner(mission, project, index);
  const controller = runner.controller;

  // pass 1 decides the rows: we need the failing signal, which a quick headless run tells us
  let probeResult = known;
  if (!probeResult) {
    const probe = createMissionTestRunner(mission, project, index);
    probeResult = probe.finish();
    probe.dispose();
  }
  const f = probeResult.passed ? undefined : classifyFailure(mission, test, probeResult);
  const failSig = f && f.kind !== 'other' ? checkedSignalOf(mission, test, f.step, f.invariant) : undefined;
  const extra: SignalRef[] = [];
  const inv = f?.kind === 'invariant' ? mission.invariants?.[f.invariant] : undefined;
  if (inv) extra.push(...invariantSignals(inv));
  // every output that could be behind a failing observable is recorded; the explanation decides which rows stay
  const drivers: SignalRef[] = failSig?.kind === 'observe' ? drivingTags(scene, failSig.id).map((t) => ({ kind: 'tag', id: t })) : [];
  extra.push(...drivers);
  const signals = testSignals(test, extra);
  let rows: TraceRow[] = signals.map((s) => {
    const units = s.kind === 'observe' ? scene.observables.find((o) => o.id === s.id)?.units : s.kind === 'control' ? scene.controls.find((c) => c.id === s.id)?.units : undefined;
    const isRule = inv !== undefined && invariantSignals(inv).some((x) => sameSignal(x, s)) && !test.steps.some((st) => st.do === 'expect' && sameSignal(stepSignal(st)!, s));
    return {
      signal: s,
      label: signalLabel(scene, s),
      kind: signalIsBool(scene, controller, s, MAIN_PROGRAM) ? 'bool' : 'number',
      ...(units ? { units } : {}),
      role: isRule && s.kind !== 'control' ? 'rule' : rowRole(test, s),
      bands: [],
      failing: failSig !== undefined && sameSignal(s, failSig),
    };
  });

  // pass 2: record
  let cap = 1024;
  let times = new Float64Array(cap);
  let values = rows.map(() => new Float64Array(cap));
  let count = 0;
  const sample = (): void => {
    if (count >= cap) {
      cap *= 2;
      const t2 = new Float64Array(cap);
      t2.set(times);
      times = t2;
      values = values.map((v) => {
        const n = new Float64Array(cap);
        n.set(v);
        return n;
      });
    }
    const obs = runner.runtime.observe();
    times[count] = runner.runtime.timeMs;
    rows.forEach((r, k) => {
      values[k]![count] = readSignal(runner.runtime, r.signal, obs, MAIN_PROGRAM);
    });
    count++;
  };
  const stepStarts = new Array<number>(test.steps.length).fill(Number.NaN);
  const stops: StepStop[] = [];
  let idx = 0;
  stepStarts[0] = 0;
  sample();
  let guard = 0;
  while (!runner.done && guard++ < 200_000) {
    const before = runner.runtime.timeMs;
    runner.advance(VALIDATION_STEP_MS);
    const now = runner.stepIndex;
    for (let j = idx + 1; j <= Math.min(now, test.steps.length - 1); j++) stepStarts[j] = before;
    if (!runner.done && (stops.length === 0 || stops[stops.length - 1]!.step !== now)) stops.push({ step: now, atMs: runner.runtime.timeMs });
    idx = Math.max(idx, now);
    sample();
  }
  const result = runner.result;
  const endMs = runner.runtime.timeMs;
  const explanation = explainFailure({ mission, scene, test, result, runtime: runner.runtime, stepStarts });
  runner.dispose();

  // keep the driving outputs the explanation is about (else the first one), then cap the row count
  const why = new Set((explanation?.tags ?? []).map((t) => t.toLowerCase()));
  const keepDriver = drivers.filter((d) => why.has(d.id.toLowerCase()));
  const droppedDrivers = drivers.filter((d) => !(keepDriver.length ? keepDriver : drivers.slice(0, 1)).some((k) => sameSignal(k, d)) && !test.steps.some((st) => st.do === 'expect' && sameSignal(stepSignal(st)!, d)));
  let keepIdx = rows.map((_, k) => k).filter((k) => !droppedDrivers.some((d) => sameSignal(d, rows[k]!.signal)));
  if (keepIdx.length > MAX_ROWS) {
    const must = keepIdx.filter((k) => rows[k]!.failing || rows[k]!.role === 'output' || rows[k]!.role === 'rule');
    const rest = keepIdx.filter((k) => !must.includes(k)).slice(0, Math.max(0, MAX_ROWS - must.length));
    keepIdx = [...must, ...rest].sort((a, b) => a - b);
  }
  rows = keepIdx.map((k) => rows[k]!);
  values = keepIdx.map((k) => values[k]!);
  const failAt = result.passed ? undefined : (result.failedAtMs ?? endMs);

  // expected-value bands from the expect steps …
  test.steps.forEach((st, k) => {
    if (st.do !== 'expect') return;
    const sig = stepSignal(st)!;
    const row = rows.find((r) => sameSignal(r.signal, sig));
    const from = stepStarts[k]!;
    if (!row || !Number.isFinite(from)) return;
    const next = stepStarts.slice(k + 1).find((t) => Number.isFinite(t));
    const failedHere = f?.kind === 'check' && f.step === k;
    const to = failedHere ? (failAt ?? endMs) : (next ?? endMs);
    row.bands.push({
      from,
      to: Math.max(from, to),
      cond: { ...(st.equals !== undefined ? { equals: st.equals } : {}), ...(st.min !== undefined ? { min: st.min } : {}), ...(st.max !== undefined ? { max: st.max } : {}) },
      step: k,
      ...(st.within !== undefined ? { deadline: from + st.within } : {}),
      failed: failedHere,
    });
  });
  // … and from the failing safety rule (where its `when` condition held)
  if (inv) {
    const target = invariantSignals(inv).find((s) => (inv.observe !== undefined ? s.kind === 'observe' && s.id === inv.observe : s.kind === 'tag' && s.id === inv.tag));
    const row = target ? rows.find((r) => sameSignal(r.signal, target)) : undefined;
    const whenSig = inv.when ? invariantSignals(inv)[0] : undefined;
    const whenCol = whenSig ? rows.findIndex((r) => sameSignal(r.signal, whenSig)) : -1;
    const cond: Condition = { ...(inv.equals !== undefined ? { equals: inv.equals } : {}), ...(inv.min !== undefined ? { min: inv.min } : {}), ...(inv.max !== undefined ? { max: inv.max } : {}) };
    if (row) {
      let start = -1;
      for (let i = 0; i < count; i++) {
        const w = whenCol >= 0 && inv.when ? Number.isFinite(values[whenCol]![i]!) && conditionHolds(values[whenCol]![i]!, inv.when) : true;
        if (w && start < 0) start = i;
        if ((!w || i === count - 1) && start >= 0) {
          const endI = w ? i : i - 1;
          const to = times[endI]!;
          row.bands.push({ from: times[start]!, to, cond, step: -1, failed: failAt !== undefined && failAt >= times[start]! && failAt <= to + VALIDATION_STEP_MS });
          start = -1;
        }
      }
    }
  }

  return {
    trace: { rows, times, values, count, endMs, stepStarts, ...(failAt !== undefined ? { failAtMs: failAt } : {}) },
    result,
    stops,
    explanation,
  };
}

export class ReplaySession {
  readonly test: MissionTest;
  readonly scene: SceneLogic<unknown>;
  readonly trace: ReplayTrace;
  /** Result of the (deterministic) run: what the replay will end with. */
  readonly final: TestResult;
  readonly explanation: FailureExplanation | undefined;
  /** Step boundaries the replay can stop at (time-consuming steps, in order). */
  readonly stops: StepStop[];
  /** The failing step and the signal it failed on (for the camera). */
  readonly failure: { step: number; signal?: string } | undefined;
  private current: MissionTestRunner;
  private gen = 0;
  private acc = 0;
  private listeners = new Set<Listener>();
  private lastStep = -1;
  private lastDone = false;
  private disposed = false;

  constructor(
    readonly mission: MissionDef,
    readonly project: Project,
    readonly index: number,
    /** Result of this very program + test from the last test run (skips a pass; the run is deterministic). */
    known?: TestResult,
  ) {
    this.test = mission.tests[index]!;
    this.scene = missionScene(mission);
    const rec = recordTestTrace(mission, project, index, known);
    this.trace = rec.trace;
    this.final = rec.result;
    this.stops = rec.stops;
    this.explanation = rec.explanation;
    if (!rec.result.passed) {
      const f = classifyFailure(mission, this.test, rec.result);
      const sig = f.kind !== 'other' ? checkedSignalOf(mission, this.test, f.step, f.invariant) : undefined;
      this.failure = { step: f.step, ...(sig ? { signal: sig.id } : {}) };
    } else this.failure = undefined;
    this.current = createMissionTestRunner(mission, project, index);
  }

  /** The on-screen runner (replaced by seeks — see `generation`). */
  get runner(): MissionTestRunner {
    return this.current;
  }

  /** Increments whenever `runner` is replaced (the view must re-bind to the new runtime). */
  get generation(): number {
    return this.gen;
  }

  get timeMs(): number {
    return this.current.runtime.timeMs;
  }

  get stepIndex(): number {
    return this.current.stepIndex;
  }

  get done(): boolean {
    return this.current.done;
  }

  /** Finished on a failure (the replay reached the failing moment). */
  get failed(): boolean {
    return this.current.done && !this.current.result.passed;
  }

  get failingStep(): number {
    return this.failure?.step ?? -1;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emitIfChanged(force = false): void {
    const st = this.current.stepIndex;
    const d = this.current.done;
    if (!force && st === this.lastStep && d === this.lastDone) return;
    this.lastStep = st;
    this.lastDone = d;
    for (const l of [...this.listeners]) l();
  }

  /** Simulate `ms` more (fractions of the 10 ms step carry over to the next call). */
  advance(ms: number): void {
    if (this.disposed || this.current.done || !(ms > 0)) return;
    this.acc += ms;
    const n = Math.floor(this.acc / VALIDATION_STEP_MS);
    if (n <= 0) return;
    this.acc -= n * VALIDATION_STEP_MS;
    this.current.advance(n * VALIDATION_STEP_MS);
    this.emitIfChanged();
  }

  /** Run to the start of the next step (or the end). */
  stepForward(): void {
    if (this.disposed || this.current.done) return;
    const from = this.current.stepIndex;
    let guard = 0;
    while (!this.current.done && this.current.stepIndex === from && guard++ < 200_000) this.current.advance(VALIDATION_STEP_MS);
    this.acc = 0;
    this.emitIfChanged(true);
  }

  /** Back to the start of the current step (or of the previous one when already at its start). */
  stepBack(): void {
    const stops = this.stops;
    if (stops.length === 0) {
      this.restart();
      return;
    }
    if (this.current.done) {
      this.seekTime(stops[stops.length - 1]!.atMs);
      return;
    }
    const cur = this.current.stepIndex;
    let i = stops.findIndex((s) => s.step === cur);
    if (i < 0) i = stops.findIndex((s) => s.step > cur);
    if (i < 0) i = stops.length;
    const at = stops[i];
    if (at && this.timeMs > at.atMs) this.seekTime(at.atMs);
    else if (i > 0) this.seekTime(stops[i - 1]!.atMs);
    else this.restart();
  }

  /** Restart and fast-forward to the start of step `k` (the first stop at or after it; just before it for a check that takes no time). */
  seekStep(k: number): void {
    const stop = this.stops.find((s) => s.step >= k);
    if (stop) {
      this.seekTime(stop.atMs);
      return;
    }
    const start = this.trace.stepStarts[k];
    this.seekTime(start !== undefined && Number.isFinite(start) ? Math.max(0, start - VALIDATION_STEP_MS) : 0);
  }

  /** Restart and fast-forward to simulated time `ms`. */
  seekTime(ms: number): void {
    if (this.disposed) return;
    this.current.dispose();
    this.current = createMissionTestRunner(this.mission, this.project, this.index);
    this.gen++;
    this.acc = 0;
    let guard = 0;
    while (!this.current.done && this.current.runtime.timeMs < ms && guard++ < 200_000) this.current.advance(VALIDATION_STEP_MS);
    this.emitIfChanged(true);
  }

  /** To the start of the failing step (paused there, ready to watch it fail). */
  jumpToFailure(): void {
    if (this.failure) this.seekStep(this.failure.step);
  }

  restart(): void {
    this.seekTime(0);
  }

  dispose(): void {
    this.disposed = true;
    this.current.dispose();
    this.listeners.clear();
  }
}
