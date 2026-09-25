/**
 * "Watch this test": replays one mission test on its own controller + plant in real time × playback speed, as a
 * debugging session (see replay/session.ts): the whole run is recorded first (trace, failure, explanation), then
 * played on screen with play / pause / step / seek. The replay pauses by itself at the failing moment. The page
 * swaps the 3D view / ladder to the replay while it plays; Stop returns to the live plant.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MissionDef, TestResult } from '../../game/types';
import type { MissionTestRunner } from '../../game/validation';
import type { Project } from '../../plc/types';
import { sfx } from '../../audio/sfx';
import type { SimRuntime } from '../../sim/types';
import { toast } from '../../ui';
import { ReplaySession } from './replay/session';

export interface TestReplay {
  index: number;
  session: ReplaySession;
  /** The on-screen runner (replaced when the replay seeks back). */
  runner: MissionTestRunner;
  /** Unique per runner (remounts the 3D view). */
  key: string;
}

export interface TestReplayApi {
  replay: TestReplay | null;
  speed: number;
  paused: boolean;
  /** The replay camera follows the test (off once the player picks a camera). */
  follow: boolean;
  setSpeed(s: number): void;
  setPaused(p: boolean): void;
  setFollow(f: boolean): void;
  /** `known`: the result of this program + test from the last run (saves a pass). */
  start(mission: MissionDef, project: Project, index: number, known?: TestResult): void;
  restart(): void;
  stop(): void;
  /** Pause and run to the next step / back to the previous one. */
  stepForward(): void;
  stepBack(): void;
  /** Pause at the start of step `k`. */
  seekStep(k: number): void;
  /** Pause at simulated time `ms`. */
  seekTime(ms: number): void;
  /** Pause at the start of the failing step. */
  jumpToFailure(): void;
}

let replaySeq = 0;

/**
 * A view of a replay runtime that the 3D scene can render but not operate: `setControl` does nothing
 * (clicks on 3D devices would otherwise change the replayed test and could fail a test that passed).
 * Everything else (state, observe, subscribe…) reads the real runtime.
 */
export function readOnlyRuntime<T extends SimRuntime>(runtime: T, onBlocked?: (id: string) => void): T {
  return new Proxy(runtime, {
    get(target, prop) {
      if (prop === 'setControl') return (id: string) => onBlocked?.(id);
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

let lastBlockedToast = 0;
/** Toast (at most every 4 s) when the player tries to operate a replayed plant. */
export function replayBlockedToast(): void {
  const now = Date.now();
  if (now - lastBlockedToast < 4000) return;
  lastBlockedToast = now;
  toast({ tone: 'info', title: 'This is a replay', body: 'A replayed test can’t be operated — press Stop to return to the live plant.' });
}

function snapshot(index: number, session: ReplaySession, seq: number): TestReplay {
  return { index, session, runner: session.runner, key: `replay-${seq}-${session.generation}` };
}

export function useTestReplay(): TestReplayApi {
  const [replay, setReplay] = useState<TestReplay | null>(null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPausedState] = useState(false);
  const [follow, setFollow] = useState(true);
  const src = useRef<{ mission: MissionDef; project: Project; index: number; known?: TestResult } | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const current = useRef(replay);
  current.current = replay;

  const setPaused = useCallback((p: boolean) => {
    const r = current.current;
    // play at the end of a replay starts it again
    if (!p && r && r.session.done) r.session.restart();
    pausedRef.current = p;
    setPausedState(p);
  }, []);

  const stop = useCallback(() => {
    setReplay((r) => {
      r?.session.dispose();
      return null;
    });
    src.current = null;
  }, []);

  const start = useCallback((mission: MissionDef, project: Project, index: number, known?: TestResult) => {
    src.current = { mission, project, index, ...(known ? { known } : {}) };
    const session = new ReplaySession(mission, project, index, known);
    // a test that is over in a blink plays in slow motion (the player can still speed it up)
    const end = session.trace.endMs;
    if (end < 1500) setSpeed(end < 400 ? 0.25 : 0.5);
    else setSpeed((s) => Math.max(1, s));
    replaySeq += 1;
    pausedRef.current = false;
    setPausedState(false);
    setFollow(true);
    setReplay((prev) => {
      prev?.session.dispose();
      return snapshot(index, session, replaySeq);
    });
  }, []);

  const restart = useCallback(() => {
    const r = current.current;
    if (!r) {
      const s = src.current;
      if (s) start(s.mission, s.project, s.index, s.known);
      return;
    }
    r.session.restart();
    pausedRef.current = false;
    setPausedState(false);
  }, [start]);

  const pauseThen = useCallback((fn: (s: ReplaySession) => void) => {
    const r = current.current;
    if (!r) return;
    pausedRef.current = true;
    setPausedState(true);
    fn(r.session);
  }, []);
  const stepForward = useCallback(() => pauseThen((s) => s.stepForward()), [pauseThen]);
  const stepBack = useCallback(() => pauseThen((s) => s.stepBack()), [pauseThen]);
  const seekStep = useCallback((k: number) => pauseThen((s) => s.seekStep(k)), [pauseThen]);
  const seekTime = useCallback((ms: number) => pauseThen((s) => s.seekTime(ms)), [pauseThen]);
  const jumpToFailure = useCallback(() => pauseThen((s) => s.jumpToFailure()), [pauseThen]);

  // a seek replaces the runner: re-bind the page (3D view, ladder) to the new one
  const session = replay?.session;
  useEffect(() => {
    if (!session) return;
    let gen = session.generation;
    return session.subscribe(() => {
      if (session.generation === gen) return;
      gen = session.generation;
      setReplay((r) => (r && r.session === session ? snapshot(r.index, session, replaySeq) : r));
    });
  }, [session]);

  // playback loop
  useEffect(() => {
    if (!session) return;
    let raf = 0;
    let last = performance.now();
    let wasDone = session.done;
    const loop = (t: number): void => {
      const dt = Math.min(100, t - last);
      last = t;
      if (!pausedRef.current && !session.done) session.advance(dt * speedRef.current);
      if (session.done && !wasDone) {
        sfx.play(session.failed ? 'fail' : 'success');
        // stop at the failing moment: the explanation card takes over
        if (session.failed) {
          pausedRef.current = true;
          setPausedState(true);
        }
      }
      wasDone = session.done;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [session]);

  // dispose the session when the page unmounts
  useEffect(() => () => current.current?.session.dispose(), []);

  return { replay, speed, paused, follow, setSpeed, setPaused, setFollow, start, restart, stop, stepForward, stepBack, seekStep, seekTime, jumpToFailure };
}
