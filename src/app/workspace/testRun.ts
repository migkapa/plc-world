/**
 * Chunked mission test execution for the UI: verification first, then every test on its own fresh
 * controller + plant (exactly like `runMission`), advanced in small time slices from setTimeout so the
 * page stays responsive and results can animate in one by one. Headless (timers are injectable).
 */
import { checkMissionProgram, createMissionTestRunner, maxTestDurationMs, scoreMission } from '../../game/validation';
import type { MissionDef, MissionRunResult, TestResult } from '../../game/types';
import type { Project } from '../../plc/types';

export type TestStatus = 'idle' | 'queued' | 'running' | 'passed' | 'failed' | 'skipped';

export interface TestRunCallbacks {
  onVerified?(check: { verifyErrors: string[]; warnings: string[]; instructionCount: number }): void;
  onTestStart?(index: number): void;
  /** Progress of the running test, 0..1 (simulated time / upper bound). */
  onTestProgress?(index: number, progress: number): void;
  onTestDone?(index: number, result: TestResult): void;
}

export interface TestRunOptions extends TestRunCallbacks {
  hintsUsed?: number;
  /** Real-time budget per slice before yielding (ms, default 12). */
  sliceBudgetMs?: number;
  /** Simulated ms advanced between budget checks (default 1000). */
  sliceSimMs?: number;
  /** Pause before a test starts (ms, default 140) — lets the "running" state show. */
  startDelayMs?: number;
  /** Pause after a test finished (ms, default 110). */
  endDelayMs?: number;
  /** Timer (default setTimeout); tests pass a synchronous scheduler. */
  schedule?(fn: () => void, ms: number): unknown;
  now?(): number;
}

export interface TestRunHandle {
  readonly done: Promise<MissionRunResult>;
  cancel(): void;
  readonly cancelled: boolean;
}

/**
 * Verify, then run every test of `mission` against `project`. Resolves with the scored result
 * (a verification failure resolves immediately with `verifyErrors` and no test results).
 */
export function startTestRun(mission: MissionDef, project: Project, opts: TestRunOptions = {}): TestRunHandle {
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const budget = opts.sliceBudgetMs ?? 12;
  const sliceSim = opts.sliceSimMs ?? 1000;
  const startDelay = opts.startDelayMs ?? 140;
  const endDelay = opts.endDelayMs ?? 110;
  let cancelled = false;
  let resolveFn!: (r: MissionRunResult) => void;
  let rejectFn!: (e: unknown) => void;
  const done = new Promise<MissionRunResult>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });

  const tests: TestResult[] = [];
  let instructionCount = 0;

  const finish = (verifyErrors: string[]): void => {
    resolveFn(scoreMission(mission, { tests, verifyErrors, instructionCount }, opts.hintsUsed ?? 0));
  };

  const runTest = (i: number): void => {
    if (cancelled) return;
    if (i >= mission.tests.length) {
      finish([]);
      return;
    }
    opts.onTestStart?.(i);
    schedule(() => {
      if (cancelled) return;
      let runner: ReturnType<typeof createMissionTestRunner>;
      try {
        runner = createMissionTestRunner(mission, project, i);
      } catch (e) {
        rejectFn(e);
        return;
      }
      const bound = Math.max(1, maxTestDurationMs(mission.tests[i]!));
      const slice = (): void => {
        if (cancelled) {
          runner.dispose();
          return;
        }
        const t0 = now();
        try {
          while (!runner.done && now() - t0 < budget) runner.advance(sliceSim);
        } catch (e) {
          runner.dispose();
          rejectFn(e);
          return;
        }
        if (!runner.done) {
          opts.onTestProgress?.(i, Math.min(0.99, runner.runtime.timeMs / bound));
          schedule(slice, 0);
          return;
        }
        const result = runner.result;
        runner.dispose();
        tests[i] = result;
        opts.onTestProgress?.(i, 1);
        opts.onTestDone?.(i, result);
        schedule(() => runTest(i + 1), endDelay);
      };
      slice();
    }, startDelay);
  };

  schedule(() => {
    if (cancelled) return;
    let check: ReturnType<typeof checkMissionProgram>;
    try {
      check = checkMissionProgram(mission, project);
    } catch (e) {
      rejectFn(e);
      return;
    }
    instructionCount = check.instructionCount;
    opts.onVerified?.(check);
    if (check.verifyErrors.length > 0) {
      finish(check.verifyErrors);
      return;
    }
    runTest(0);
  }, 0);

  return {
    done,
    cancel() {
      cancelled = true;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

/**
 * Progress of the running test, kept OUTSIDE React state: only the progress bar of the running row
 * subscribes (useSyncExternalStore), so the ~80 Hz slice updates never re-render the workspace.
 * Values are quantized to 2 % steps and listeners are only called when a value changes.
 */
export interface TestProgressStore {
  get(index: number): number;
  set(index: number, progress: number): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createTestProgressStore(): TestProgressStore {
  let values = new Map<number, number>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  return {
    get: (i) => values.get(i) ?? 0,
    set(i, p) {
      const q = Math.round(Math.max(0, Math.min(1, p)) * 50) / 50;
      if (values.get(i) === q) return;
      values.set(i, q);
      notify();
    },
    reset() {
      if (values.size === 0) return;
      values = new Map();
      notify();
    },
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}
