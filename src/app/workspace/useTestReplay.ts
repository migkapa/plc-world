/**
 * "Watch this test": replays one mission test on its own controller + plant (createMissionTestRunner)
 * in real time × playback speed, so the page can swap the 3D view / ladder to the runner while it
 * plays. Stop returns to the live plant.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MissionDef } from '../../game/types';
import { createMissionTestRunner, type MissionTestRunner } from '../../game/validation';
import type { Project } from '../../plc/types';
import { sfx } from '../../audio/sfx';
import type { SimRuntime } from '../../sim/types';
import { toast } from '../../ui';

export interface TestReplay {
  index: number;
  runner: MissionTestRunner;
  /** Unique per replay start (remounts the 3D view). */
  key: string;
}

export interface TestReplayApi {
  replay: TestReplay | null;
  speed: number;
  paused: boolean;
  setSpeed(s: number): void;
  setPaused(p: boolean): void;
  start(mission: MissionDef, project: Project, index: number): void;
  restart(): void;
  stop(): void;
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

export function useTestReplay(): TestReplayApi {
  const [replay, setReplay] = useState<TestReplay | null>(null);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const src = useRef<{ mission: MissionDef; project: Project; index: number } | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const stop = useCallback(() => {
    setReplay((r) => {
      r?.runner.dispose();
      return null;
    });
    src.current = null;
  }, []);

  const start = useCallback((mission: MissionDef, project: Project, index: number) => {
    src.current = { mission, project, index };
    const runner = createMissionTestRunner(mission, project, index);
    replaySeq += 1;
    setPaused(false);
    setReplay((prev) => {
      prev?.runner.dispose();
      return { index, runner, key: `replay-${replaySeq}` };
    });
  }, []);

  const restart = useCallback(() => {
    const s = src.current;
    if (s) start(s.mission, s.project, s.index);
  }, [start]);

  // playback loop
  useEffect(() => {
    if (!replay) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number): void => {
      const dt = Math.min(100, t - last);
      last = t;
      const r = replay.runner;
      if (!pausedRef.current && !r.done) {
        r.advance(dt * speedRef.current);
        if (r.done) sfx.play(r.result.passed ? 'success' : 'fail');
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay]);

  // dispose the runner when the page unmounts
  const current = useRef(replay);
  current.current = replay;
  useEffect(() => () => current.current?.runner.dispose(), []);

  return { replay, speed, paused, setSpeed, setPaused, start, restart, stop };
}
