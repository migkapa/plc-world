/**
 * Learning aids of the mission workspace, in one component the page renders once:
 *  - the guided first rung (mission 1-1): starts by itself on the first visit (until finished or skipped), and on
 *    request from the '?' menu (asking first whether to clear a program that is already there);
 *  - "Try it now" callouts after online edits (quiet during the tour, test runs and replays).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LadderEditorHandle } from '../../../editor';
import { useGame } from '../../../game/store';
import type { MissionDef } from '../../../game/types';
import type { SceneLogic } from '../../../sim/types';
import { Button, Modal, toast } from '../../../ui';
import { useReducedMotion } from '../../hud/prefs';
import { modalOpen } from '../hooks';
import type { WorkspaceRuntime } from '../useWorkspaceRuntime';
import { useAssist } from './assistStore';
import { TourCoachMarks } from './TourCoachMarks';
import { FIRST_RUNG_MISSION, FIRST_RUNG_TOUR, type TourPanel } from './firstRungTour';
import { TryItCallout, useTryItPrompt } from './TryItNow';

/** Delay before the first-visit tour starts (the layout and the 3D view settle first). */
export const TOUR_AUTOSTART_MS = 900;

export interface MissionAssistProps {
  mission: MissionDef;
  scene: SceneLogic<unknown>;
  ws: WorkspaceRuntime;
  editorRef: RefObject<LadderEditorHandle | null>;
  /** A Verify & Test run is active. */
  running: boolean;
  /** A test replay is showing. */
  replaying: boolean;
  onRun(): void;
  /** Bring a workspace panel on screen (phones). */
  onShowPanel?(panel: TourPanel): void;
}

/** Should the first-rung tour start by itself? (mission 1-1, never finished or skipped, mission not completed yet) */
export function shouldAutoStartTour(missionId: string, tutorials: Record<string, unknown> | undefined, completed: boolean): boolean {
  return missionId === FIRST_RUNG_MISSION && !completed && !tutorials?.[FIRST_RUNG_TOUR];
}

export function MissionAssist({ mission, scene, ws, editorRef, running, replaying, onRun, onShowPanel }: MissionAssistProps) {
  const reduced = useReducedMotion();
  const tryItOn = useAssist((s) => s.tryIt);
  const request = useAssist((s) => s.tourRequest);
  const hostsTour = mission.id === FIRST_RUNG_MISSION;
  const [tour, setTour] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  const start = useCallback(() => {
    setConfirm(false);
    setTour(Date.now());
    useAssist.getState().setTourActive(FIRST_RUNG_TOUR);
  }, []);

  // first visit of 1-1: start by itself
  useEffect(() => {
    if (!hostsTour) return;
    const p = useGame.getState().profile;
    if (!shouldAutoStartTour(mission.id, p.tutorials, p.missions[mission.id]?.completed === true)) return;
    const h = window.setTimeout(() => {
      if (modalOpen()) return;
      start();
    }, TOUR_AUTOSTART_MS);
    return () => window.clearTimeout(h);
  }, [hostsTour, mission.id, start]);

  // replay requested from the '?' menu
  useEffect(() => {
    if (!request || request.id !== FIRST_RUNG_TOUR || !hostsTour) return;
    useAssist.getState().clearTourRequest();
    const hasProgram = wsRef.current.rungs.some((r) => r.elements.length > 0);
    if (hasProgram) setConfirm(true);
    else start();
  }, [request, hostsTour, start]);

  useEffect(() => () => useAssist.getState().setTourActive(null), []);

  const finish = useCallback((status: 'completed' | 'skipped') => {
    setTour(null);
    useAssist.getState().setTourActive(null);
    useGame.getState().finishTutorial(FIRST_RUNG_TOUR, status);
    if (status === 'completed') toast({ tone: 'success', title: 'Guided tour complete', body: 'Replay it any time from the ? menu next to Hints.' });
    else toast({ tone: 'info', title: 'Tour skipped', body: 'You can replay it any time from the ? menu next to Hints.' });
  }, []);

  const tourOn = tour !== null;
  const tip = useTryItPrompt({ mission, scene, ws, enabled: tryItOn, suppressed: tourOn || running || replaying });

  return (
    <>
      {tourOn && !replaying && (
        <TourCoachMarks
          key={tour}
          ws={ws}
          editorRef={editorRef}
          running={running}
          onRun={onRun}
          {...(onShowPanel ? { onShowPanel } : {})}
          onFinish={finish}
          reducedMotion={reduced}
        />
      )}
      {tip.suggestion && <TryItCallout suggestion={tip.suggestion} onClose={tip.dismiss} onKeep={tip.keep} reducedMotion={reduced} />}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Replay the guided tour?"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={start} data-testid="tour-keep-program">
              Keep my rungs
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const s = mission.starter;
                if (wsRef.current.loadProgram({ rungs: s.rungs.length ? [...s.rungs] : [''], comments: [...(s.comments ?? [])], tags: [] })) start();
                else setConfirm(false);
              }}
              data-testid="tour-reset-program"
            >
              Start from an empty rung
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          The tour builds rung 0 from scratch. <strong className="text-white">Start from an empty rung</strong> replaces your program with the starter program; with{' '}
          <strong className="text-white">Keep my rungs</strong> the steps you have already done are skipped.
        </p>
      </Modal>
    </>
  );
}
