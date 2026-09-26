/**
 * Mission workspace (/#/mission/:id): briefing, live 3D twin, online ladder editing, tag tools,
 * automated acceptance tests with replays, hints, and the mission-complete celebration.
 */
import { BookOpenText, Box, FlaskConical, Workflow, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useParams } from 'wouter';
import { sfx } from '../../audio/sfx';
import type { LadderEditorHandle } from '../../editor';
import { getMission, nextMission } from '../../game/missions';
import { isMissionUnlockedFor, useGame, type CompletionOutcome } from '../../game/store';
import type { MissionDef, MissionRunResult, TestResult } from '../../game/types';
import { buildMissionProject, missionStartProgram, paletteErrors } from '../../game/validation';
import { serializeRung } from '../../plc/neutralText';
import type { Project } from '../../plc/types';
import { SCENE_LOGICS } from '../../sim/scenes';
import { SCENES } from '../../sim/scenes/views';
import { useSimLoop } from '../../sim/useSimLoop';
import { Button, Modal, toast, useToasts } from '../../ui';
import { CelebrationModal } from '../celebrate/CelebrationModal';
import { routes } from '../routes';
import { BriefingPanel, objectiveStates } from '../workspace/BriefingPanel';
import { splitPadControls, useControlHotkeys } from '../workspace/ControlPad';
import { recordGameEvent } from '../workspace/gameEvents';
import { LeftDock, type DockTab } from '../workspace/Docks';
import { LadderPanel } from '../workspace/LadderPanel';
import { HintsModal, LockedMission, MissionBar, NotFoundMission } from '../workspace/MissionChrome';
import { messagesToVerifyErrors, type ProgramSnapshot } from '../workspace/program';
import { SpeedControl } from '../workspace/SpeedControl';
import { controlsUsedByTests } from '../workspace/stepText';
import { useReplayUi } from '../workspace/replay/useReplayUi';
import { TestPanel } from '../workspace/TestPanel';
import { createTestProgressStore, startTestRun, type TestRunHandle, type TestStatus } from '../workspace/testRun';
import { TwinPanel } from '../workspace/TwinPanel';
import { readOnlyRuntime, replayBlockedToast, useTestReplay } from '../workspace/useTestReplay';
import { useWorkspaceRuntime } from '../workspace/useWorkspaceRuntime';
import { WorkspaceLayout } from '../workspace/WorkspaceLayout';
import '../workspace/anim.css';
import { PENDING_ROUTINES } from '../workspace/Docks';
import { useDocumentTitle } from '../useDocumentTitle';
import { useReducedMotion } from '../hud/prefs';
import { useAssist } from '../workspace/onboarding/assistStore';
import { HelpMenu } from '../workspace/onboarding/HelpMenu';
import { LiveChip } from '../workspace/onboarding/LiveChip';
import { programSig } from '../workspace/onboarding/liveObjectives';
import { MissionAssist } from '../workspace/onboarding/MissionAssist';
import type { TourPanel } from '../workspace/onboarding/firstRungTour';
import { useLiveObjectives } from '../workspace/onboarding/useLiveObjectives';

export default function MissionPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? '');
  const mission = getMission(id);
  const unlocked = useGame((s) => (mission ? isMissionUnlockedFor(s.profile, mission.id) : false));
  useDocumentTitle(mission ? `${mission.id} ${mission.title}` : 'Mission not found');
  if (!mission) return <NotFoundMission id={id} />;
  if (!unlocked) return <LockedMission mission={mission} />;
  if (!SCENE_LOGICS[mission.sceneId]) return <NotFoundMission id={id} />;
  return <MissionWorkspace key={mission.id} mission={mission} />;
}

const FAIL_TIPS = [
  'Read the first failure: it says what the plant should have done and what it actually did.',
  'Press “Watch this test” to replay it in 3D — the ladder shows the power flow of that run.',
  'Operate the plant yourself with the control pad and watch your rungs light up.',
  'N.C. devices read 1 when nothing is pressed — check your XIC / XIO choices.',
];

function MissionWorkspace({ mission }: { mission: MissionDef }) {
  const [, navigate] = useLocation();
  const scene = SCENE_LOGICS[mission.sceneId]!;
  const definition = SCENES[mission.sceneId];
  // narrow selectors: autosaves (savedRungs) must not re-render the whole workspace
  const hintsUsed = useGame((s) => s.profile.missions[mission.id]?.hintsUsed ?? 0);
  const bestStars = useGame((s) => s.profile.missions[mission.id]?.stars ?? 0);
  const completed = useGame((s) => s.profile.missions[mission.id]?.completed === true);
  const startedAt = useRef(Date.now());
  const editorRef = useRef<LadderEditorHandle>(null);

  // --- mission session ---------------------------------------------------------------------
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startedAt.current = Date.now();
    useGame.getState().startMission(mission.id);
  }, [mission.id]);

  // --- program + live plant ------------------------------------------------------------------
  const [initial] = useState(() => {
    const p = missionStartProgram(mission, useGame.getState().profile.missions[mission.id]);
    return { rungs: p.rungs, comments: p.comments, tags: p.tags, fromSave: p.fromSave };
  });
  const ws = useWorkspaceRuntime({
    scene,
    initial,
    buildProject: (s: ProgramSnapshot) => buildMissionProject(mission, s.rungs, s.comments, s.tags),
    extraErrors: (p: Project) => messagesToVerifyErrors(paletteErrors(mission, p)),
    onEvent: recordGameEvent,
    onSave: (s) => useGame.getState().saveProgram(mission.id, s.rungs, s.comments, s.tags),
  });
  const replay = useTestReplay();
  useSimLoop(ws.runtime, !replay.replay);

  const usedByTests = useMemo(() => controlsUsedByTests(mission), [mission]);
  const padControls = useMemo(() => scene.controls.filter((c) => c.type !== 'fault'), [scene]);
  // the controls this mission is about first (its own list, else the ones its tests operate); the rest under "More"
  const pad = useMemo(() => splitPadControls(padControls, mission.controls ?? usedByTests), [padControls, mission.controls, usedByTests]);
  const faultControls = useMemo(() => scene.controls.filter((c) => c.type === 'fault' && usedByTests.has(c.id)), [scene, usedByTests]);
  useControlHotkeys(ws.runtime, padControls, !replay.replay);

  // --- tests ----------------------------------------------------------------------------------
  const n = mission.tests.length;
  const [statuses, setStatuses] = useState<TestStatus[]>(() => new Array<TestStatus>(n).fill('idle'));
  const [testProgress] = useState(createTestProgressStore);
  const [results, setResults] = useState<(TestResult | undefined)[]>([]);
  const [verifyErrors, setVerifyErrors] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);
  const [instructionCount, setInstructionCount] = useState<number | undefined>(undefined);
  const [notice, setNotice] = useState<ReactNode>(null);
  const lastProject = useRef<Project | null>(null);
  const [lastRunSig, setLastRunSig] = useState<string | null>(null);
  const currentSig = useMemo(() => ws.rungs.map((r) => serializeRung(r)).join('\n'), [ws.rungs]);
  const runHandle = useRef<TestRunHandle | null>(null);
  const [celebration, setCelebration] = useState<{ outcome: CompletionOutcome; result: MissionRunResult } | null>(null);
  const [hintsOpen, setHintsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('brief');
  const [mobileTab, setMobileTab] = useState('twin');

  useEffect(() => () => runHandle.current?.cancel(), []);

  // --- live objectives: the tests re-run quietly after edits (never graded) ----------------------
  const liveOn = useAssist((s) => s.liveObjectives);
  const reducedMotion = useReducedMotion();
  const liveObj = useLiveObjectives({
    mission,
    ws,
    buildProject: (s: ProgramSnapshot) => buildMissionProject(mission, s.rungs, s.comments, s.tags),
    paused: running,
    enabled: liveOn,
    runOnMount: initial.fromSave && initial.rungs.some((r) => r.trim() !== ''),
  });
  const noteGraded = liveObj.noteGraded;

  const runningRef = useRef(false);
  runningRef.current = running;
  const stopReplay = replay.stop;
  const runTests = useCallback(() => {
    if (runningRef.current) return;
    stopReplay();
    ws.flushSave();
    const snap = ws.snapshot();
    const sig = programSig(snap);
    let project: Project;
    try {
      project = buildMissionProject(mission, snap.rungs, snap.comments, snap.tags);
    } catch (e) {
      setVerifyErrors([e instanceof Error ? e.message : String(e)]);
      sfx.play('fail');
      return;
    }
    lastProject.current = project;
    setLastRunSig(snap.rungs.join('\n'));
    setRunning(true);
    setNotice(null);
    setVerifyErrors(null);
    setResults([]);
    setStatuses(new Array<TestStatus>(n).fill('queued'));
    testProgress.reset();
    setMobileTab('tests');
    const hints = useGame.getState().profile.missions[mission.id]?.hintsUsed ?? 0;
    const handle = startTestRun(mission, project, {
      hintsUsed: hints,
      onVerified: (c) => setInstructionCount(c.instructionCount),
      onTestStart: (i) => setStatuses((s) => s.map((x, j) => (j === i ? 'running' : x))),
      onTestProgress: (i, p) => testProgress.set(i, p),
      onTestDone: (i, r) => {
        setStatuses((s) => s.map((x, j) => (j === i ? (r.passed ? 'passed' : 'failed') : x)));
        setResults((s) => {
          const next = [...s];
          next[i] = r;
          return next;
        });
        sfx.play(r.passed ? 'toggle' : 'beep');
      },
    });
    runHandle.current = handle;
    handle.done
      .then((result) => {
        if (handle.cancelled) return;
        setRunning(false);
        noteGraded(sig, result.tests, result.verifyErrors);
        if (result.verifyErrors.length > 0) {
          setVerifyErrors(result.verifyErrors);
          setStatuses(new Array<TestStatus>(n).fill('skipped'));
          sfx.play('fail');
          setNotice(
            <p className="text-[12px] text-slate-400">
              Nothing ran: the controller refuses to go to Run with verification errors — just like Studio 5000. Fix them (red <span className="font-mono text-red-300">e</span> markers on the
              rungs) and test again.
            </p>,
          );
          return;
        }
        const outcome = useGame.getState().completeMission(mission.id, result, Date.now() - startedAt.current);
        if (result.passed) {
          // the celebration shows this run's achievements itself (no toasts on top of it)
          useGame.getState().consumeUnlocks();
          setCelebration({ outcome, result });
          return;
        }
        sfx.play('fail');
        const failedRuns = useGame.getState().session[mission.id]?.failedRuns ?? 1;
        const passedN = result.tests.filter((t) => t.passed).length;
        const hintsLeft = mission.hints.length - (useGame.getState().profile.missions[mission.id]?.hintsUsed ?? 0);
        setNotice(
          <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-[12.5px] text-amber-100" data-testid="fail-notice">
            <div className="font-semibold">
              {passedN > 0 ? `So close — ${passedN} of ${n} tests pass.` : 'Not yet — but every failure tells you something.'}
            </div>
            <div className="mt-0.5 text-amber-100/80">{FAIL_TIPS[(failedRuns - 1) % FAIL_TIPS.length]}</div>
            {failedRuns >= 3 && hintsLeft > 0 && (
              <button type="button" onClick={openHints} className="mt-1.5 cursor-pointer text-[12px] font-semibold text-amber-300 hover:underline">
                Stuck after {failedRuns} tries? Take a hint →
              </button>
            )}
          </div>,
        );
      })
      .catch((e: unknown) => {
        setRunning(false);
        toast({ tone: 'error', title: 'The test runner crashed', body: e instanceof Error ? e.message : String(e) });
      });
  }, [stopReplay, ws, mission, n, testProgress, noteGraded]);

  // Ctrl+Enter anywhere on the page
  const runRef = useRef(runTests);
  runRef.current = runTests;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        // text fields keep Ctrl+Enter (the rung comment editor saves with it); dialogs block it
        const t = e.target instanceof Element ? e.target : null;
        if (t?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        e.stopPropagation();
        runRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const startReplay = replay.start;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const watch = useCallback(
    (i: number): void => {
      if (!lastProject.current) return;
      // the replay re-runs the tested program: this run's result saves it a pass (tests are deterministic)
      startReplay(mission, lastProject.current, i, resultsRef.current[i]);
      setMobileTab('twin');
    },
    [startReplay, mission],
  );

  const revealHint = useCallback((): void => {
    const idx = useGame.getState().useHint(mission.id);
    if (idx >= 0) sfx.play('click');
  }, [mission.id]);

  const rungsRef = useRef(ws.rungs);
  rungsRef.current = ws.rungs;
  const jumpToRung = useCallback((i: number): void => {
    const rung = rungsRef.current[i];
    if (!rung) return;
    setMobileTab('ladder');
    window.setTimeout(() => {
      editorRef.current?.scrollToRung(i);
      editorRef.current?.setSelection({ rungId: rung.id });
      editorRef.current?.focus();
    }, 30);
  }, []);
  const openHints = useCallback(() => setHintsOpen(true), []);
  const closeHints = useCallback(() => setHintsOpen(false), []);

  // The celebration shows the level-up itself: drop the app-wide level-up / promotion toasts while it
  // is open (on phones they cover its buttons).
  useEffect(() => {
    if (!celebration) return;
    const sweep = (): void => {
      const st = useToasts.getState();
      for (const t of st.toasts) if (/^(Level up!|Promoted:)/.test(t.title)) st.dismiss(t.id);
    };
    sweep();
    return useToasts.subscribe(sweep);
  }, [celebration]);

  const next = nextMission(mission.id);
  const nextUnlocked = useGame((s) => (next ? isMissionUnlockedFor(s.profile, next.id) : false));
  const testsRun = results.length === n && results.every(Boolean);
  const objectivesMet = objectiveStates(mission, results, completed).filter((s) => s === 'passed').length;

  // --- panels (memoized: test progress, results and replays re-render only what changed) ---------
  const rep = replay.replay;
  const live = !rep;
  const activeRuntime = rep ? rep.runner.runtime : ws.runtime;
  // the 3D view of a replay is read-only: clicks on devices must not change the replayed test
  const viewRuntime = useMemo(() => (rep ? readOnlyRuntime(rep.runner.runtime, replayBlockedToast) : ws.runtime), [rep, ws.runtime]);
  const hintsRevealed = useMemo(() => mission.hints.slice(0, hintsUsed), [mission, hintsUsed]);
  const speedTools = useMemo(() => <SpeedControl runtime={ws.runtime} onResetPlant={ws.resetPlant} />, [ws.runtime, ws.resetPlant]);
  // replay debugger: banner + step controls, camera that follows the test, trace & explanation, ladder highlight
  const replayUi = useReplayUi({ replay, mission, scene, focus: definition?.focus, editorRef, onShowPanel: setMobileTab });
  const { banner, focusCamera: replayFocus, onCameraPick: onReplayCameraPick, watchDetail, highlight: replayHighlight } = replayUi;
  const noFaults = useMemo(() => [], []);

  const twin = useMemo(
    () => (
      <TwinPanel
        scene={scene}
        definition={definition}
        runtime={viewRuntime}
        viewKey={rep?.key ?? 'live'}
        controls={pad.primary}
        moreControls={pad.more}
        faults={live ? faultControls : noFaults}
        padDisabled={!live}
        focusCamera={replayFocus}
        onCameraPick={onReplayCameraPick}
        ioHint="the Briefing tab"
        {...(live ? { tools: speedTools } : {})}
        {...(banner ? { banner } : {})}
      />
    ),
    [scene, definition, viewRuntime, rep, pad, live, faultControls, noFaults, speedTools, banner, replayFocus, onReplayCameraPick],
  );

  const resetAction = useMemo(
    () => (
      <Button size="xs" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => setConfirmReset(true)} title="Reset program: throw away your changes and start from the mission's starter program" data-testid="reset-program">
        <span className="hidden @4xl:inline">Reset program</span>
      </Button>
    ),
    [],
  );
  const ladder = useMemo(
    () => (
      <LadderPanel
        ws={ws}
        editorRef={editorRef}
        {...(mission.allowedInstructions ? { allowedInstructions: mission.allowedInstructions } : {})}
        {...(rep ? { replayController: rep.runner.controller } : { actions: resetAction })}
        {...(replayHighlight ? { highlight: replayHighlight } : {})}
        onEvent={recordGameEvent}
      />
    ),
    [ws, mission, rep, resetAction, replayHighlight],
  );

  /** The program changed since the last Verify & Test: its results (and objective marks) describe an older program. */
  const stale = !running && lastRunSig !== null && lastRunSig !== currentSig;

  // soft "live" marks: only while the program in the editor has not been graded as it is
  const liveMarks = useMemo(() => {
    const o = liveObj.outcome;
    if (!o || (o.graded && liveObj.fresh) || o.verifyErrors.length > 0) return null;
    return { states: o.states, stale: !liveObj.fresh || liveObj.checking, allPassed: o.allPassed };
  }, [liveObj]);

  const briefing = useMemo(
    () => (
      <BriefingPanel
        mission={mission}
        scene={scene}
        controller={activeRuntime.controller}
        runtime={activeRuntime}
        results={results}
        completed={completed}
        hintsRevealed={hintsRevealed}
        onShowHints={openHints}
        live={liveMarks}
        gradedStale={stale}
      />
    ),
    [mission, scene, activeRuntime, results, completed, hintsRevealed, openHints, liveMarks, stale],
  );

  const errorsPending = ws.pendingReason === 'errors';
  const left = useMemo(
    () => (
      <LeftDock
        first={briefing}
        firstLabel="Briefing"
        controller={ws.controller}
        {...(errorsPending ? { errorRoutines: PENDING_ROUTINES } : {})}
        onTagsChanged={ws.reverify}
        editorRef={editorRef}
        tab={dockTab}
        onTab={setDockTab}
      />
    ),
    [briefing, ws.controller, ws.reverify, errorsPending, dockTab],
  );

  const tests = useMemo(
    () => (
      <TestPanel
        mission={mission}
        scene={scene}
        statuses={statuses}
        progress={testProgress}
        results={results}
        verifyErrors={verifyErrors}
        running={running}
        onRun={runTests}
        onWatch={watch}
        watching={rep?.index ?? null}
        watchDetail={watchDetail}
        {...(instructionCount !== undefined ? { instructionCount } : {})}
        hintsUsed={hintsUsed}
        notice={notice}
        stale={stale}
        onJumpToRung={jumpToRung}
      />
    ),
    [mission, scene, statuses, testProgress, results, verifyErrors, running, runTests, watch, rep, watchDetail, instructionCount, hintsUsed, notice, stale, jumpToRung],
  );

  const barExtra = useMemo(
    () => (
      <>
        <LiveChip live={liveObj} running={running} onRun={runTests} reducedMotion={reducedMotion} />
        <HelpMenu missionId={mission.id} />
      </>
    ),
    [liveObj, running, runTests, reducedMotion, mission.id],
  );
  const showPanel = useCallback((p: TourPanel) => {
    if (p === 'twin' || p === 'ladder') setMobileTab(p);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mission-page">
      <MissionBar
        mission={mission}
        bestStars={bestStars}
        objectivesMet={objectivesMet}
        testsRun={testsRun}
        stale={stale}
        hintsUsed={hintsUsed}
        running={running}
        onHints={openHints}
        onRun={runTests}
        extra={barExtra}
      />
      <WorkspaceLayout
        id="mission"
        className="min-h-0 flex-1"
        left={left}
        twin={twin}
        twinWanted={!!rep}
        ladder={ladder}
        right={tests}
        mobileTabs={[
          { id: 'twin', label: 'Twin', icon: <Box size={13} /> },
          { id: 'ladder', label: 'Ladder', icon: <Workflow size={13} /> },
          { id: 'brief', label: 'Brief', icon: <BookOpenText size={13} /> },
          { id: 'tests', label: 'Tests', icon: <FlaskConical size={13} /> },
        ]}
        mobileTab={mobileTab}
        onMobileTab={setMobileTab}
        renderMobile={(t) => (t === 'twin' ? twin : t === 'ladder' ? ladder : t === 'brief' ? left : tests)}
      />

      <HintsModal open={hintsOpen} mission={mission} hintsUsed={hintsUsed} bestStars={bestStars} onReveal={revealHint} onClose={closeHints} />

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset program?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setConfirmReset(false);
                replay.stop();
                const s = mission.starter;
                if (ws.loadProgram({ rungs: s.rungs.length ? [...s.rungs] : [''], comments: [...(s.comments ?? [])], tags: [] })) {
                  toast({ tone: 'info', title: 'Program reset', body: 'The starter program was downloaded to the controller.' });
                }
              }}
              data-testid="confirm-reset"
            >
              Reset to starter
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">Your rungs and the tags you created are replaced by the mission’s starter program. This cannot be undone.</p>
      </Modal>

      <MissionAssist mission={mission} scene={scene} ws={ws} editorRef={editorRef} running={running} replaying={!!rep} onRun={runTests} onShowPanel={showPanel} />

      {celebration && (
        <CelebrationModal
          open
          mission={mission}
          outcome={celebration.outcome}
          result={celebration.result}
          hintsUsed={hintsUsed}
          {...(next ? { next } : {})}
          nextUnlocked={nextUnlocked}
          onNext={() => next && navigate(routes.mission(next.id))}
          onReplay={() => setCelebration(null)}
          onMap={() => navigate(routes.campaign)}
          onClose={() => setCelebration(null)}
        />
      )}
    </div>
  );
}
