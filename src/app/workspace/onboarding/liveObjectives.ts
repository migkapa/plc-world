/**
 * Live objectives (headless): while the player edits, the mission's acceptance tests run silently in the background
 * against the current program — debounced after each accepted online edit / tag change, in small time slices so the
 * page never janks — and the objectives the program already satisfies are reported. Nothing here is graded: stars
 * and XP come only from an explicit "Verify & Test" run (which also pauses the live checker while it runs).
 *
 * Reuses `startTestRun` (same verification + fresh controller/plant per test as the graded run) and the explicit
 * objective → test map of `objectiveStates` (src/game/objectives.ts).
 */
import { objectiveStates, type ObjectiveState } from '../../../game/objectives';
import type { MissionDef, TestResult } from '../../../game/types';
import type { Project } from '../../../plc/types';
import type { ProgramSnapshot } from '../program';
import { startTestRun, type TestRunHandle } from '../testRun';

/** Default pause after the last accepted edit before the live run starts. */
export const LIVE_DEBOUNCE_MS = 800;
/** Real-time budget of one slice of a live run (ms): small, the 3D view and the plant keep their frame time. */
export const LIVE_SLICE_BUDGET_MS = 4;

/** Stable identity of a program for the checks: rungs + player tags (comments do not change behaviour). */
export function programSig(snap: Pick<ProgramSnapshot, 'rungs' | 'tags'>): string {
  return `${snap.rungs.join('\n')}\u0000${JSON.stringify(snap.tags)}`;
}

export interface LiveOutcome {
  /** Program the outcome is for (see `programSig`). */
  sig: string;
  /** Objective states of that program (same rules as the graded checklist). */
  states: ObjectiveState[];
  /** Every test passed (the program would earn at least one star). */
  allPassed: boolean;
  /** Verification / palette errors: no test ran. */
  verifyErrors: string[];
  tests: TestResult[];
  /** The outcome came from an explicit Verify & Test run (seeded), not from the live checker. */
  graded: boolean;
}

export interface LiveRequest {
  sig: string;
  /** Build the download image lazily (only when the run really starts). May throw. */
  build(): Project;
}

export interface LiveCheckerOptions {
  debounceMs?: number;
  sliceBudgetMs?: number;
  /** Simulated ms advanced between budget checks (default 250: small steps keep each slice short). */
  sliceSimMs?: number;
  /** Debounce timer (default setTimeout / clearTimeout). */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Scheduler of the chunked run (default setTimeout); the page passes an idle-time scheduler. */
  schedule?(fn: () => void, ms: number): unknown;
  now?(): number;
  /** A live run started (true) / ended, was cancelled or crashed (false). */
  onBusy?(busy: boolean): void;
  onResult(outcome: LiveOutcome): void;
  /** The run crashed or the program could not be built (the previous outcome stays). */
  onError?(sig: string, error: unknown): void;
}

export interface LiveChecker {
  /** Check this program after the debounce (replaces a queued request; re-running an already checked program is skipped). */
  request(req: LiveRequest): void;
  /** Pause (a graded run is active): the running live run is cancelled and re-queued for when the pause ends. */
  setPaused(paused: boolean): void;
  /** Adopt the results of a graded run for `sig` (no live run needed for that program). */
  seed(sig: string, tests: ReadonlyArray<TestResult>, verifyErrors?: ReadonlyArray<string>): void;
  /** Forget what was checked (e.g. the feature was switched off). */
  reset(): void;
  readonly busy: boolean;
  dispose(): void;
}

export function outcomeFor(mission: MissionDef, sig: string, tests: ReadonlyArray<TestResult>, verifyErrors: ReadonlyArray<string>, graded: boolean): LiveOutcome {
  const ran = verifyErrors.length === 0 && tests.length === mission.tests.length;
  const states = ran ? objectiveStates(mission, tests, false) : new Array<ObjectiveState>(mission.objectives.length).fill('pending');
  return {
    sig,
    states,
    allPassed: ran && tests.length > 0 && tests.every((t) => t.passed),
    verifyErrors: [...verifyErrors],
    tests: [...tests],
    graded,
  };
}

export function createLiveChecker(mission: MissionDef, opts: LiveCheckerOptions): LiveChecker {
  const debounce = opts.debounceMs ?? LIVE_DEBOUNCE_MS;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let queued: LiveRequest | null = null;
  let running: { sig: string; req: LiveRequest; handle: TestRunHandle } | null = null;
  let lastSig: string | null = null;
  let paused = false;
  let disposed = false;

  const stopTimer = (): void => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };

  const setRunning = (next: typeof running): void => {
    const was = running !== null;
    running = next;
    if (was !== (next !== null)) opts.onBusy?.(next !== null);
  };

  const cancelRun = (): LiveRequest | null => {
    if (!running) return null;
    const req = running.req;
    running.handle.cancel();
    setRunning(null);
    return req;
  };

  const fire = (): void => {
    timer = undefined;
    if (disposed || paused || !queued) return;
    const req = queued;
    queued = null;
    if (req.sig === running?.sig) return;
    cancelRun(); // an older program: its outcome would be stale
    if (req.sig === lastSig) return; // back to the program already reported
    let project: Project;
    try {
      project = req.build();
    } catch (e) {
      opts.onError?.(req.sig, e);
      return;
    }
    const handle = startTestRun(mission, project, {
      startDelayMs: 0,
      endDelayMs: 0,
      sliceBudgetMs: opts.sliceBudgetMs ?? LIVE_SLICE_BUDGET_MS,
      sliceSimMs: opts.sliceSimMs ?? 250,
      ...(opts.schedule ? { schedule: opts.schedule } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    const run = { sig: req.sig, req, handle };
    setRunning(run);
    handle.done.then(
      (result) => {
        if (handle.cancelled || disposed || running !== run) return;
        setRunning(null);
        lastSig = req.sig;
        opts.onResult(outcomeFor(mission, req.sig, result.tests, result.verifyErrors, false));
      },
      (e: unknown) => {
        if (handle.cancelled || disposed || running !== run) return;
        setRunning(null);
        opts.onError?.(req.sig, e);
      },
    );
  };

  const arm = (): void => {
    stopTimer();
    timer = setTimer(fire, debounce);
  };

  return {
    request(req) {
      if (disposed) return;
      if (req.sig === lastSig && !running) {
        queued = null;
        stopTimer();
        return;
      }
      if (req.sig === running?.sig) {
        queued = null;
        stopTimer();
        return;
      }
      cancelRun(); // the program changed: a run of the old one would only report stale checks
      queued = req;
      if (!paused) arm();
    },
    setPaused(p) {
      if (disposed || p === paused) return;
      paused = p;
      if (p) {
        stopTimer();
        const req = cancelRun();
        if (req && !queued) queued = req;
      } else if (queued) {
        arm();
      }
    },
    seed(sig, tests, verifyErrors = []) {
      if (disposed) return;
      if (running?.sig === sig) cancelRun();
      if (queued?.sig === sig) {
        queued = null;
        stopTimer();
      }
      lastSig = sig;
      opts.onResult(outcomeFor(mission, sig, tests, verifyErrors, true));
    },
    reset() {
      stopTimer();
      cancelRun();
      queued = null;
      lastSig = null;
    },
    get busy() {
      return running !== null;
    },
    dispose() {
      stopTimer();
      cancelRun();
      disposed = true;
      queued = null;
    },
  };
}
