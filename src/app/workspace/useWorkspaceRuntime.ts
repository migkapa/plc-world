/**
 * The live program lifecycle shared by the Mission and Sandbox pages:
 *
 *  - one LogixController (download of the start program, key REM, Run when it verifies) coupled to the
 *    scene's plant by a SimRuntime (ticked by the PAGE with useSimLoop, never by the 3D view);
 *  - editor edits update local rungs immediately; after a ~250 ms pause the routine is verified and,
 *    when clean, applied as an ONLINE EDIT (`controller.updateRoutine`) while the plant keeps running.
 *    Otherwise the last good logic keeps running and the errors / pending-edit badge are shown.
 *    Edits that leave an empty branch leg (a branch being built) are held too: the empty leg would
 *    short the contacts around it and energize the output by itself;
 *  - Download refuses a program that does not verify (like Studio 5000) and keeps the running logic;
 *  - tags created in the Tag Monitor / New Tag dialog are part of the saved program;
 *  - debounced autosave; game events (forces, fault cleared, rung edits, operator controls). Toggle Bit and
 *    neutral-text edits are reported by the ladder panel (LadderEditor onToggleBit / onRungTextCommit).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent } from '../../game/achievements';
import { createController, type LogixController } from '../../plc/controller';
import { parseRung } from '../../plc/neutralText';
import type { Project, Rung, TagDef, VerifyError } from '../../plc/types';
import { verifyProject } from '../../plc/verify';
import { MAIN_PROGRAM, MAIN_ROUTINE, withRoutineRungs } from '../../sim/project';
import { createSimRuntime, type SimRuntimeEx } from '../../sim/runtime';
import type { SceneLogic } from '../../sim/types';
import { toast } from '../../ui';
import { compactComments, countChangedRungs, mainRungs, newShortedRungs, rungsToText, tagSignature, userTagsOf, type ProgramSnapshot } from './program';

export const EDIT_DEBOUNCE_MS = 250;
export const AUTOSAVE_MS = 800;

export interface WorkspaceSetup {
  scene: SceneLogic<unknown>;
  /** Program to open with. */
  initial: ProgramSnapshot;
  /** Build a full project (download image) from a program snapshot. May throw on unparsable rungs. */
  buildProject(snapshot: ProgramSnapshot): Project;
  /** Mission rules as editor errors (palette); shown but they never block online edits. */
  extraErrors?(project: Project): VerifyError[];
  onEvent?(event: GameEvent): void;
  /** Debounced autosave of the current program. */
  onSave?(snapshot: ProgramSnapshot): void;
}

/**
 * Why the editor rungs are not running yet:
 *  - 'errors': they do not verify (the controller keeps the last good logic);
 *  - 'branch': a branch leg is still empty (a shorted branch would energize the output by itself).
 */
export type PendingReason = 'errors' | 'branch';

export interface WorkspaceRuntime {
  controller: LogixController;
  runtime: SimRuntimeEx;
  scene: SceneLogic<unknown>;
  /** Rungs shown in the editor (may be ahead of the running logic). */
  rungs: Rung[];
  setRungs(next: Rung[]): void;
  /** Controller verification of the editor rungs (errors block the online edit; warnings don't). */
  errors: VerifyError[];
  /** Mission rules (palette / required instructions) for the editor rungs — they never block online edits. */
  ruleErrors: VerifyError[];
  /** The editor rungs are ahead of the running logic (see `pendingReason`). */
  pending: boolean;
  pendingReason: PendingReason | null;
  /** Rungs held because of an empty branch leg (pendingReason 'branch'). */
  heldRungs: number[];
  /** Time of the last online edit that was accepted (for the "Edits applied" indicator). */
  appliedAt: number | null;
  /** Current program (neutral text + comments + player tags). */
  snapshot(): ProgramSnapshot;
  /** Download a new program (Reset program, Load example, Load slot, Import). False when refused. */
  loadProgram(snapshot: ProgramSnapshot): boolean;
  /**
   * Re-download the editor rungs (resets tag values) and go to Run when possible. Refused (false,
   * with a toast) when the rungs do not verify: the running logic is kept.
   */
  download(): boolean;
  resetPlant(): void;
  /** The user picked a mode in the online toolbar (stops automatic Run after verification). */
  noteUserMode(mode: 'RUN' | 'PROG'): void;
  /** Re-verify now (after tag changes). */
  reverify(): void;
  /** Flush a pending autosave immediately. */
  flushSave(): void;
}

function emptySnapshot(): ProgramSnapshot {
  return { rungs: [''], comments: [], tags: [] };
}

/**
 * Build a project, replacing rungs that cannot be parsed by empty rungs (their text is kept in the rung
 * comment) instead of failing. Pure: the caller reports `dropped`.
 */
export function buildSafely(build: (s: ProgramSnapshot) => Project, snap: ProgramSnapshot): { project: Project; dropped: number } {
  try {
    return { project: build(snap), dropped: 0 };
  } catch {
    const rungs: string[] = [];
    const comments: (string | undefined)[] = [];
    let dropped = 0;
    snap.rungs.forEach((r, i) => {
      try {
        parseRung(r);
        rungs.push(r);
        comments.push(snap.comments[i]);
      } catch {
        dropped++;
        rungs.push('');
        comments.push(`Could not load this rung: ${r}`);
      }
    });
    try {
      return { project: build({ rungs, comments, tags: snap.tags }), dropped };
    } catch {
      return { project: build(emptySnapshot()), dropped: Math.max(1, dropped) };
    }
  }
}

function droppedToast(dropped: number): void {
  if (dropped <= 0) return;
  toast({
    tone: 'warning',
    title: `${dropped} rung${dropped === 1 ? '' : 's'} could not be loaded`,
    body: 'They were replaced by empty rungs (the text is kept in the rung comment).',
  });
}

function sameProgram(a: ReadonlyArray<Rung>, b: ReadonlyArray<Rung>): boolean {
  if (a.length !== b.length) return false;
  return countChangedRungs(a, b) === 0;
}

function verifySafely(project: Project, controller: LogixController): VerifyError[] {
  try {
    return verifyProject(project, controller.tags);
  } catch (e) {
    return [{ program: '', routine: '', rungIndex: -1, message: e instanceof Error ? e.message : String(e), severity: 'error' }];
  }
}

interface Core {
  controller: LogixController;
  runtime: SimRuntimeEx;
  baseTags: TagDef[];
  autoRun: boolean;
  dropped: number;
}

function createCore(setup: WorkspaceSetup): Core {
  const build = (s: ProgramSnapshot): Project => setup.buildProject(s);
  const { project, dropped } = buildSafely(build, setup.initial);
  const controller = createController(project);
  const baseTags = buildSafely(build, emptySnapshot()).project.tags;
  const ran = controller.requestMode('RUN');
  const runtime = createSimRuntime(controller, setup.scene);
  return { controller, runtime, baseTags, autoRun: !ran, dropped };
}

export function useWorkspaceRuntime(setup: WorkspaceSetup): WorkspaceRuntime {
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const emit = useCallback((e: GameEvent) => setupRef.current.onEvent?.(e), []);

  // --- controller + plant (created once per workspace instance; a ref, not a useState initializer, so
  //     StrictMode's double render does not build a second controller) -------------------------
  const coreRef = useRef<Core | null>(null);
  coreRef.current ??= createCore(setupRef.current);
  const core = coreRef.current;
  const { controller, runtime, baseTags } = core;

  const [rungs, setRungsState] = useState<Rung[]>(() => structuredClone(mainRungs(controller.project)));
  const rungsRef = useRef(rungs);
  const [errors, setErrors] = useState<VerifyError[]>([]);
  const [ruleErrors, setRuleErrors] = useState<VerifyError[]>([]);
  const [pendingReason, setPendingReason] = useState<PendingReason | null>(null);
  const [heldRungs, setHeldRungs] = useState<number[]>([]);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  /** Run automatically once the program verifies (after a download that could not go to Run). */
  const autoRunRef = useRef(core.autoRun);
  const lastEvaluated = useRef<Rung[]>(rungs);
  const editTimer = useRef<number | undefined>(undefined);
  const saveTimer = useRef<number | undefined>(undefined);
  const downloading = useRef(false);
  /** The player changed the rungs since the last evaluation (an evaluation triggered by something else — a tag edit — still counts as the player's edit). */
  const userDirty = useRef(false);

  // rungs dropped from the start program: reported once, after mount (never during render)
  const droppedReported = useRef(false);
  useEffect(() => {
    if (droppedReported.current) return;
    droppedReported.current = true;
    droppedToast(core.dropped);
  }, [core]);

  const snapshot = useCallback((): ProgramSnapshot => {
    const t = rungsToText(rungsRef.current);
    return { rungs: t.rungs, comments: compactComments(t.comments), tags: userTagsOf(controller.project, baseTags) };
  }, [controller, baseTags]);

  const flushSave = useCallback(() => {
    if (saveTimer.current !== undefined) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      setupRef.current.onSave?.(snapshot());
    }
  }, [snapshot]);

  const scheduleSave = useCallback(() => {
    if (!setupRef.current.onSave) return;
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined;
      setupRef.current.onSave?.(snapshot());
    }, AUTOSAVE_MS);
  }, [snapshot]);

  const tryAutoRun = useCallback(() => {
    if (!autoRunRef.current) return;
    const st = controller.getStatus();
    if (st.keySwitch !== 'REM' || st.mode !== 'REM_PROG') return;
    if (controller.requestMode('RUN')) autoRunRef.current = false;
  }, [controller]);

  /** Verify the editor rungs against the live project; apply them online when they verify. */
  const evaluate = useCallback(
    (userEditArg: boolean) => {
      if (editTimer.current !== undefined) {
        window.clearTimeout(editTimer.current);
        editTimer.current = undefined;
      }
      const userEdit = userEditArg || userDirty.current;
      userDirty.current = false;
      const next = rungsRef.current;
      let project: Project;
      try {
        project = withRoutineRungs(controller.project, MAIN_PROGRAM, MAIN_ROUTINE, next);
      } catch {
        return;
      }
      const errs = verifySafely(project, controller);
      const blocking = errs.some((e) => e.severity === 'error');
      const running = mainRungs(controller.project);
      const shorted = blocking ? [] : newShortedRungs(next, running);
      const reason: PendingReason | null = blocking ? 'errors' : shorted.length > 0 ? 'branch' : null;
      if (reason === null) {
        if (!sameProgram(running, next)) {
          controller.updateRoutine(MAIN_PROGRAM, MAIN_ROUTINE, next);
          if (userEdit) setAppliedAt(Date.now());
        }
        tryAutoRun();
      }
      setPendingReason(reason);
      setHeldRungs((prev) => (prev.length === shorted.length && prev.every((x, i) => x === shorted[i]) ? prev : shorted));
      setErrors(errs);
      setRuleErrors(setupRef.current.extraErrors?.(project) ?? []);
      if (userEdit) {
        const n = countChangedRungs(lastEvaluated.current, next);
        if (n > 0) emit({ type: 'rungEdited', count: n });
      }
      lastEvaluated.current = next;
    },
    [controller, emit, tryAutoRun],
  );

  const setRungs = useCallback(
    (next: Rung[]) => {
      rungsRef.current = next;
      userDirty.current = true;
      setRungsState(next);
      if (editTimer.current !== undefined) window.clearTimeout(editTimer.current);
      editTimer.current = window.setTimeout(() => evaluate(true), EDIT_DEBOUNCE_MS);
      scheduleSave();
    },
    [evaluate, scheduleSave],
  );

  const reverify = useCallback(() => evaluate(false), [evaluate]);

  // initial verification (errors shown right away)
  useEffect(() => {
    evaluate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- controller events → game events, tag edits → re-verify + save ------------------------
  useEffect(() => {
    let mode = controller.getStatus().mode;
    let forces = Object.keys(controller.getForces()).length;
    let sig = tagSignature(controller.project);
    return controller.subscribe((e) => {
      if (e.type === 'mode') {
        const now = controller.getStatus().mode;
        if (mode === 'FAULTED' && now !== 'FAULTED' && !downloading.current) emit({ type: 'majorFaultCleared' });
        mode = now;
      } else if (e.type === 'forces') {
        const n = Object.keys(controller.getForces()).length;
        if (n > forces && !downloading.current) emit({ type: 'forceUsed' });
        forces = n;
      } else if (e.type === 'project') {
        const s = tagSignature(controller.project);
        if (s !== sig) {
          sig = s;
          if (!downloading.current) {
            evaluate(false);
            scheduleSave();
          }
        }
      }
    });
  }, [controller, emit, evaluate, scheduleSave]);

  // --- operator controls → controlUsed (pad, hotkeys and 3D clicks all go through setControl) ------
  useEffect(() => {
    const last = new Map<string, number>();
    return runtime.onControl((id, value) => {
      const isNum = typeof value === 'number';
      if (value !== true && !isNum) return;
      const t = performance.now();
      const gap = isNum ? 1500 : 250;
      if (t - (last.get(id) ?? -Infinity) <= gap) return;
      last.set(id, t);
      emit({ type: 'controlUsed', sceneId: runtime.scene.id, controlId: id });
    });
  }, [runtime, emit]);

  // --- flush the autosave when leaving -------------------------------------------------------
  useEffect(() => {
    const onHide = (): void => flushSave();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (editTimer.current !== undefined) {
        window.clearTimeout(editTimer.current);
        editTimer.current = undefined;
      }
      flushSave();
    };
  }, [flushSave]);

  const download = useCallback((): boolean => {
    let project: Project;
    try {
      project = withRoutineRungs(controller.project, MAIN_PROGRAM, MAIN_ROUTINE, rungsRef.current);
    } catch {
      return false;
    }
    // Studio 5000 refuses to download a project that does not verify: keep the running logic.
    const n = verifySafely(project, controller).filter((e) => e.severity === 'error').length;
    if (n > 0) {
      toast({
        tone: 'error',
        title: 'Download refused',
        body: `Fix the ${n} verification error${n === 1 ? '' : 's'} first — the controller would not go to Run. The last good logic keeps running.`,
        duration: 6000,
      });
      return false;
    }
    downloading.current = true;
    try {
      controller.loadProject(project);
    } catch (e) {
      toast({ tone: 'error', title: 'Download refused', body: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      downloading.current = false;
    }
    const ran = controller.requestMode('RUN');
    autoRunRef.current = !ran;
    evaluate(false);
    return true;
  }, [controller, evaluate]);

  const loadProgram = useCallback(
    (snap: ProgramSnapshot): boolean => {
      if (controller.getStatus().keySwitch === 'RUN') {
        toast({ tone: 'error', title: 'Download refused', body: 'The key switch is in RUN. Turn it to REM or PROG to load a program.' });
        return false;
      }
      const { project, dropped } = buildSafely((s) => setupRef.current.buildProject(s), snap);
      downloading.current = true;
      try {
        controller.loadProject(project);
      } catch (e) {
        toast({ tone: 'error', title: 'Download refused', body: e instanceof Error ? e.message : String(e) });
        return false;
      } finally {
        downloading.current = false;
      }
      droppedToast(dropped);
      if (editTimer.current !== undefined) {
        window.clearTimeout(editTimer.current);
        editTimer.current = undefined;
      }
      userDirty.current = false;
      const next = structuredClone(mainRungs(controller.project));
      rungsRef.current = next;
      lastEvaluated.current = next;
      setRungsState(next);
      const ran = controller.requestMode('RUN');
      autoRunRef.current = !ran;
      evaluate(false);
      scheduleSave();
      return true;
    },
    [controller, evaluate, scheduleSave],
  );

  const resetPlant = useCallback(() => runtime.resetScene(), [runtime]);

  const noteUserMode = useCallback((_mode: 'RUN' | 'PROG') => {
    autoRunRef.current = false;
  }, []);

  const scene = setup.scene;

  // one object per state change, so memoized consumers (LadderPanel…) skip unrelated page renders
  return useMemo(
    () => ({
      controller,
      runtime,
      scene,
      rungs,
      setRungs,
      errors,
      ruleErrors,
      pending: pendingReason !== null,
      pendingReason,
      heldRungs,
      appliedAt,
      snapshot,
      loadProgram,
      download,
      resetPlant,
      noteUserMode,
      reverify,
      flushSave,
    }),
    [controller, runtime, scene, rungs, setRungs, errors, ruleErrors, pendingReason, heldRungs, appliedAt, snapshot, loadProgram, download, resetPlant, noteUserMode, reverify, flushSave],
  );
}

export type { TagDef };
