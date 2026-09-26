/**
 * The camera a replay should show right now: the device of the current step (see stepCameras), switching as the
 * test progresses — but never more often than every DWELL_MS of real time while playing (a 200 ms tap followed by a
 * check on a lamp must not whip the camera back and forth). Paused, stepped or finished: it switches at once.
 * Returns undefined without a replay, '' when the player took the camera over (TwinPanel keeps its view).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { stepCameras, type FocusMap } from '../replayCamera';
import type { ReplaySession } from './session';

export const DWELL_MS = 1100;

export function useReplayCamera(session: ReplaySession | undefined, sceneId: string, focus: FocusMap | undefined, follow: boolean, paused: boolean): string | undefined {
  const plan = useMemo(() => (session ? stepCameras(sceneId, session.test, focus, session.failure) : undefined), [session, sceneId, focus]);
  const subscribe = useCallback((cb: () => void) => (session ? session.subscribe(cb) : () => undefined), [session]);
  const desired = useSyncExternalStore(
    subscribe,
    () => (session && plan ? plan[session.done ? plan.length - 1 : Math.min(session.stepIndex, plan.length - 1)] : undefined),
    () => undefined,
  );
  const [shown, setShown] = useState<string | undefined>(desired);
  const lastSwitch = useRef(0);
  useEffect(() => {
    lastSwitch.current = 0;
  }, [session]);
  useEffect(() => {
    if (desired === shown) return;
    const now = performance.now();
    const immediate = !session || paused || session.done || lastSwitch.current === 0;
    const wait = immediate ? 0 : Math.max(0, lastSwitch.current + DWELL_MS - now);
    const h = window.setTimeout(() => {
      lastSwitch.current = performance.now();
      setShown(desired);
    }, wait);
    return () => window.clearTimeout(h);
  }, [desired, shown, session, paused]);
  if (!session) return undefined;
  if (!follow) return '';
  return shown ?? desired;
}
