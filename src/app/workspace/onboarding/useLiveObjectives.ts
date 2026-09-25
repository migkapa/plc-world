/**
 * React side of the live objectives: runs the mission's acceptance tests in the background (idle time, small
 * slices) ~800 ms after each accepted online edit or tag change, pauses while a graded Verify & Test run is
 * active, and exposes the objectives the current program satisfies. Never awards anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MissionDef, TestResult } from '../../../game/types';
import type { Project } from '../../../plc/types';
import type { ProgramSnapshot } from '../program';
import type { WorkspaceRuntime } from '../useWorkspaceRuntime';
import { createLiveChecker, programSig, type LiveChecker, type LiveOutcome } from './liveObjectives';

export interface LiveObjectives {
  enabled: boolean;
  /** Latest outcome (live or adopted from a graded run); null before the first check. */
  outcome: LiveOutcome | null;
  /** A background run is in progress. */
  checking: boolean;
  /** Signature of the program in the editor now (see `programSig`). */
  currentSig: string;
  /** `outcome` is about the program in the editor now. */
  fresh: boolean;
  /** Report a graded run's results (the live checker adopts them for that program). */
  noteGraded(sig: string, tests: ReadonlyArray<TestResult>, verifyErrors: ReadonlyArray<string>): void;
}

export interface LiveObjectivesSetup {
  mission: MissionDef;
  ws: Pick<WorkspaceRuntime, 'controller' | 'rungs' | 'appliedAt' | 'pendingReason' | 'snapshot'>;
  buildProject(snap: ProgramSnapshot): Project;
  /** A graded run is active (live runs pause). */
  paused: boolean;
  enabled: boolean;
  /** Check the opening program too (a saved program the player comes back to). */
  runOnMount?: boolean;
}

type IdleWindow = Window & { requestIdleCallback?(cb: () => void, opts?: { timeout: number }): number };

/** Slices in idle time (at the latest after 100 ms on a saturated page), delays with setTimeout. */
function idleSchedule(fn: () => void, ms: number): unknown {
  const w = window as IdleWindow;
  if (ms <= 0 && typeof w.requestIdleCallback === 'function') return w.requestIdleCallback(() => fn(), { timeout: 100 });
  return window.setTimeout(fn, Math.max(ms, 4));
}

export function useLiveObjectives(setup: LiveObjectivesSetup): LiveObjectives {
  const { mission, ws, paused, enabled } = setup;
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const [outcome, setOutcome] = useState<LiveOutcome | null>(null);
  const [checking, setChecking] = useState(false);

  const checkerRef = useRef<LiveChecker | null>(null);
  useEffect(() => {
    const checker = createLiveChecker(mission, {
      schedule: idleSchedule,
      onBusy: setChecking,
      onResult: setOutcome,
    });
    checkerRef.current = checker;
    return () => {
      checker.dispose();
      if (checkerRef.current === checker) checkerRef.current = null;
    };
  }, [mission]);

  // program identity: editor rungs + player tags (tag edits arrive as controller 'project' events)
  const [projTick, setProjTick] = useState(0);
  const { controller } = ws;
  useEffect(
    () =>
      controller.subscribe((e) => {
        if (e.type === 'project') setProjTick((t) => (t + 1) % 1_000_000);
      }),
    [controller],
  );
  const snapshot = ws.snapshot;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const currentSig = useMemo(() => programSig(snapshot()), [snapshot, ws.rungs, projTick]);

  const request = useCallback(() => {
    const s = setupRef.current;
    const checker = checkerRef.current;
    if (!checker || !s.enabled || s.ws.pendingReason !== null) return;
    const snap = s.ws.snapshot();
    checker.request({ sig: programSig(snap), build: () => s.buildProject(snap) });
  }, []);

  // after each accepted online edit / tag change (the program verifies: nothing is pending); values seen at mount
  // do not count (StrictMode re-runs effects: compare with the last seen values instead of a "mounted" flag)
  const seen = useRef({ appliedAt: ws.appliedAt, projTick });
  useEffect(() => {
    const last = seen.current;
    if (last.appliedAt === ws.appliedAt && last.projTick === projTick) return;
    seen.current = { appliedAt: ws.appliedAt, projTick };
    request();
  }, [ws.appliedAt, projTick, request]);
  useEffect(() => {
    if (setupRef.current.runOnMount) request();
  }, [request]);

  useEffect(() => {
    checkerRef.current?.setPaused(paused);
  }, [paused]);

  // switched off: forget everything; switched back on: check the current program again
  const wasEnabled = useRef(enabled);
  useEffect(() => {
    if (wasEnabled.current === enabled) return;
    wasEnabled.current = enabled;
    if (enabled) {
      request();
      return;
    }
    checkerRef.current?.reset();
    setOutcome(null);
    setChecking(false);
  }, [enabled, request]);

  const noteGraded = useCallback((sig: string, tests: ReadonlyArray<TestResult>, verifyErrors: ReadonlyArray<string>) => {
    checkerRef.current?.seed(sig, tests, verifyErrors);
  }, []);

  return useMemo(
    () => ({
      enabled,
      outcome: enabled ? outcome : null,
      checking: enabled && checking,
      currentSig,
      fresh: outcome !== null && outcome.sig === currentSig,
      noteGraded,
    }),
    [enabled, outcome, checking, currentSig, noteGraded],
  );
}
