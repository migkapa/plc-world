/**
 * Wires a "Watch this test" replay into the mission workspace: the banner over the 3D view, the camera that follows
 * the test, the debugger under the watched test, and the ladder highlight + scroll to the rung behind a failure
 * (once the replay reaches it). The page passes the pieces to TwinPanel / TestPanel / LadderPanel.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { LadderEditorHandle } from '../../../editor';
import type { MissionDef } from '../../../game/types';
import { useSceneOverlay } from '../../../sim/scenes/overlay';
import type { SceneLogic } from '../../../sim/types';
import { mainRungs } from '../program';
import type { FocusMap } from '../replayCamera';
import type { TestReplayApi } from '../useTestReplay';
import { ReplayBar, ReplayDebugger } from './ReplayBar';
import { ioPoint } from './signals';
import { useReplayCamera } from './useReplayCamera';

export interface ReplayUiOptions {
  replay: TestReplayApi;
  mission: MissionDef;
  scene: SceneLogic<unknown>;
  /** The scene definition's device → camera map. */
  focus?: FocusMap | undefined;
  editorRef: RefObject<LadderEditorHandle | null>;
  /** Small screens: show a workspace tab ('ladder', 'tests'). */
  onShowPanel?(tab: string): void;
}

export interface ReplayUi {
  banner: ReactNode | undefined;
  /** For TwinPanel.focusCamera (undefined: no replay; '' the player took the camera). */
  focusCamera: string | undefined;
  onCameraPick(id: string): void;
  /** For TestPanel.watchDetail. */
  watchDetail: ReactNode | undefined;
  /** For LadderPanel.highlight (set once the replay reached the failure). */
  highlight: string[] | undefined;
}

export function useReplayUi({ replay, mission, scene, focus, editorRef, onShowPanel }: ReplayUiOptions): ReplayUi {
  const rep = replay.replay;
  const session = rep?.session;
  const subscribe = useCallback((cb: () => void) => (session ? session.subscribe(cb) : () => undefined), [session]);
  const reached = useSyncExternalStore(subscribe, () => session?.failed === true, () => false);
  const explanation = session?.explanation;
  const showRef = useRef(onShowPanel);
  showRef.current = onShowPanel;

  // tags behind the failure, as alias and I/O address (the program may use either spelling)
  const highlight = useMemo(() => {
    if (!reached || !explanation || explanation.tags.length === 0) return undefined;
    const out = new Set<string>();
    for (const t of explanation.tags) {
      out.add(t);
      const io = ioPoint(scene, t);
      if (io) {
        out.add(io.alias);
        out.add(io.operand);
      }
    }
    return [...out];
  }, [reached, explanation, scene]);

  const runnerRef = useRef(rep?.runner);
  runnerRef.current = rep?.runner;
  /** Select rung `i` of the replayed program (its writing instruction when known) — the editor scrolls to it. */
  const selectRung = useCallback(
    (i: number, reveal: boolean): void => {
      const runner = runnerRef.current;
      if (!runner) return;
      const rung = mainRungs(runner.controller.project)[i];
      if (!rung) return;
      if (reveal) showRef.current?.('ladder');
      const el = explanation?.elements.find((e) => e.rung === i);
      window.setTimeout(() => {
        editorRef.current?.setSelection(el ? { rungId: rung.id, elementId: el.id } : { rungId: rung.id });
      }, reveal ? 40 : 0);
    },
    [editorRef, explanation],
  );
  const onRung = useCallback((i: number) => selectRung(i, true), [selectRung]);

  // …and points at the device behind it in the 3D view (the scene kits outline highlighted aliases)
  const deviceKey = reached && explanation ? explanation.tags.join('|') : '';
  useEffect(() => {
    if (!deviceKey) return;
    useSceneOverlay.getState().setHighlight(deviceKey.split('|'), 'replay');
    return () => useSceneOverlay.getState().clearHighlight('replay');
  }, [deviceKey]);

  // reaching the failure scrolls the ladder to the rung behind it
  useEffect(() => {
    if (!reached || !explanation || explanation.rungs.length === 0) return;
    selectRung(explanation.rungs[0]!, false);
  }, [reached, explanation, selectRung, rep?.key]);

  const onDetails = useCallback(() => {
    showRef.current?.('tests');
    window.setTimeout(() => document.querySelector('[data-testid="replay-debugger"]')?.scrollIntoView({ block: 'nearest' }), 40);
  }, []);

  const focusCamera = useReplayCamera(session, scene.id, focus, replay.follow, replay.paused);
  const setFollow = replay.setFollow;
  const onCameraPick = useCallback(() => {
    if (session) setFollow(false);
  }, [session, setFollow]);

  const { paused, speed, follow } = replay;
  const testCount = mission.tests.length;
  const banner = useMemo(
    () => (session ? <ReplayBar session={session} api={replay} scene={scene} testCount={testCount} onRung={onRung} onDetails={onDetails} /> : undefined),
    // `replay` is a fresh object every render: its state is in the deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, rep?.key, paused, speed, follow, scene, testCount, onRung, onDetails],
  );
  const watchDetail = useMemo(
    () => (session ? <ReplayDebugger key={session.index} session={session} api={replay} scene={scene} onRung={onRung} /> : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, rep?.key, paused, speed, follow, scene, onRung],
  );

  return { banner, focusCamera, onCameraPick, watchDetail, highlight };
}
