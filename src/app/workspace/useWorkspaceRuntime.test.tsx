// @vitest-environment jsdom
/**
 * The workspace program lifecycle (jsdom + Testing Library): debounced verification, online edits
 * applied while the plant runs, pending edits that keep the last good logic, tags created online,
 * autosave, game events, download / load program and the control-used wrapper.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../game/achievements';
import { getMission } from '../../game/missions';
import { buildMissionProject, paletteErrors } from '../../game/validation';
import { parseRung, serializeRung } from '../../plc/neutralText';
import type { Rung } from '../../plc/types';
import { createProjectForScene } from '../../sim/project';
import { SCENE_LOGICS } from '../../sim/scenes';
import { createDefaultProfile } from '../../game/store';
import { objectiveStates } from './BriefingPanel';
import { lockReason } from './MissionChrome';
import { controlTone } from './ControlPad';
import { contactKind } from './IoTable';
import { mainRungs, messagesToVerifyErrors, newShortedRungs, type ProgramSnapshot } from './program';
import { humanizeMessage } from './stepText';
import { AUTOSAVE_MS, EDIT_DEBOUNCE_MS, buildSafely, useWorkspaceRuntime, type WorkspaceSetup } from './useWorkspaceRuntime';
import { useToasts } from '../../ui';
import { readOnlyRuntime } from './useTestReplay';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useToasts.setState({ toasts: [] });
});

const trainer = SCENE_LOGICS.trainer!;
const texts = (rs: readonly Rung[]): string[] => rs.map((r) => serializeRung(r));

function setup(initial: ProgramSnapshot, extra: Partial<WorkspaceSetup> = {}) {
  const events: GameEvent[] = [];
  const saves: ProgramSnapshot[] = [];
  const hook = renderHook(() =>
    useWorkspaceRuntime({
      scene: trainer,
      initial,
      buildProject: (s) => createProjectForScene(trainer, s.rungs, { comments: s.comments, tags: s.tags }),
      onEvent: (e) => events.push(e),
      onSave: (s) => saves.push(s),
      ...extra,
    }),
  );
  return { hook, events, saves };
}

describe('useWorkspaceRuntime', () => {
  it('downloads the start program and runs it when it verifies', () => {
    const { hook } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: ['lamp'], tags: [] });
    const ws = hook.result.current;
    expect(ws.controller.getStatus().mode).toBe('REM_RUN');
    expect(texts(ws.rungs)).toEqual(['XIC(Switch_0)OTE(Light_0);']);
    expect(ws.rungs[0]!.comment).toBe('lamp');
    ws.runtime.setControl('sw0', true);
    ws.runtime.step(50);
    expect(ws.runtime.observe().light0).toBe(true);
  });

  it('applies verified edits online after the debounce, keeps running the last good logic otherwise', () => {
    vi.useFakeTimers();
    const { hook, events, saves } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: [], tags: [] });
    const ws0 = hook.result.current;
    // good edit → applied online (still running)
    act(() => ws0.setRungs([{ ...ws0.rungs[0]!, elements: parseRung('XIC(Switch_1)OTE(Light_0);').elements }]));
    expect(hook.result.current.appliedAt).toBeNull();
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    let ws = hook.result.current;
    expect(ws.pending).toBe(false);
    expect(ws.appliedAt).not.toBeNull();
    expect(ws.controller.getStatus().mode).toBe('REM_RUN');
    ws.runtime.setControl('sw1', true);
    ws.runtime.step(50);
    expect(ws.runtime.observe().light0).toBe(true);
    expect(events).toContainEqual({ type: 'rungEdited', count: 1 });
    // bad edit → pending, the controller keeps the last good rung
    act(() => ws.setRungs([parseRung('XIC(Nope)OTE(Light_0);')]));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    ws = hook.result.current;
    expect(ws.pending).toBe(true);
    expect(ws.errors.some((e) => e.severity === 'error' && e.rungIndex === 0)).toBe(true);
    expect(texts(ws.controller.project.programs[0]!.routines[0]!.rungs)).toEqual(['XIC(Switch_1)OTE(Light_0);']);
    expect(ws.runtime.observe().light0).toBe(true);
    // creating the missing tag online clears the error and applies the edit
    act(() => ws.controller.upsertTag({ name: 'Nope', dataType: 'BOOL' }));
    ws = hook.result.current;
    expect(ws.pending).toBe(false);
    expect(texts(ws.controller.project.programs[0]!.routines[0]!.rungs)).toEqual(['XIC(Nope)OTE(Light_0);']);
    // autosave carries the rung and the new tag
    act(() => void vi.advanceTimersByTime(AUTOSAVE_MS + 10));
    const last = saves[saves.length - 1]!;
    expect(last.rungs).toEqual(['XIC(Nope)OTE(Light_0);']);
    expect(last.tags.map((t) => t.name)).toEqual(['Nope']);
  });

  it('goes to Run automatically once a non-verifying start program is fixed', () => {
    vi.useFakeTimers();
    const { hook } = setup({ rungs: ['XIC(Missing)OTE(Light_0);'], comments: [], tags: [] });
    expect(hook.result.current.controller.getStatus().mode).toBe('REM_PROG');
    expect(hook.result.current.pending).toBe(true);
    act(() => hook.result.current.setRungs([parseRung('XIC(Switch_0)OTE(Light_0);')]));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    expect(hook.result.current.controller.getStatus().mode).toBe('REM_RUN');
  });

  it('does not force Run after the user chose Program mode', () => {
    vi.useFakeTimers();
    const { hook } = setup({ rungs: ['XIC(Missing)OTE(Light_0);'], comments: [], tags: [] });
    act(() => hook.result.current.noteUserMode('PROG'));
    act(() => hook.result.current.setRungs([parseRung('XIC(Switch_0)OTE(Light_0);')]));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    expect(hook.result.current.controller.getStatus().mode).toBe('REM_PROG');
  });

  it('reports forces, cleared major faults, toggle bits and operator controls', () => {
    const { hook, events } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: [], tags: [] });
    const ws = hook.result.current;
    act(() => ws.controller.setForce('Switch_0', true));
    expect(events).toContainEqual({ type: 'forceUsed' });
    act(() => ws.editorController.tags.writeBool('Switch_0', true));
    expect(events).toContainEqual({ type: 'toggleBitUsed' });
    act(() => ws.runtime.setControl('pb_green', true));
    act(() => ws.runtime.setControl('pb_green', false));
    expect(events.filter((e) => e.type === 'controlUsed')).toEqual([{ type: 'controlUsed', sceneId: 'trainer', controlId: 'pb_green' }]);
  });

  it('counts a cleared major fault', () => {
    const { hook, events } = setup(
      { rungs: ['XIC(Switch_0)MOV(Idx,Idx)XIC(Switch_0)MOV(Arr[Idx],Val);'], comments: [], tags: [{ name: 'Arr', dataType: 'DINT', dims: 2 }, { name: 'Idx', dataType: 'DINT', initial: 7 }, { name: 'Val', dataType: 'DINT' }] },
    );
    const ws = hook.result.current;
    ws.runtime.setControl('sw0', true);
    act(() => ws.runtime.step(50));
    expect(ws.controller.getStatus().mode).toBe('FAULTED');
    act(() => ws.controller.clearMajorFault());
    expect(events).toContainEqual({ type: 'majorFaultCleared' });
  });

  it('loads a new program (download) and re-downloads the editor rungs', () => {
    const { hook } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: [], tags: [] });
    act(() => void hook.result.current.loadProgram({ rungs: ['XIO(Switch_2)OTE(Light_3);', ''], comments: [undefined, 'spare'], tags: [{ name: 'Mine', dataType: 'DINT' }] }));
    const ws = hook.result.current;
    expect(texts(ws.rungs)).toEqual(['XIO(Switch_2)OTE(Light_3);', ';']);
    expect(ws.controller.getStatus().mode).toBe('REM_RUN');
    expect(ws.snapshot().tags.map((t) => t.name)).toEqual(['Mine']);
    ws.controller.tags.writeNumber('Mine', 42);
    act(() => void ws.download());
    expect(ws.controller.tags.readNumber('Mine')).toBe(0);
    expect(ws.controller.getStatus().mode).toBe('REM_RUN');
  });

  it('shows mission palette rules without blocking online edits', () => {
    vi.useFakeTimers();
    const mission = getMission('1-1')!;
    const { hook } = setup(
      { rungs: [''], comments: [], tags: [] },
      {
        buildProject: (s) => buildMissionProject(mission, s.rungs, s.comments, s.tags),
        extraErrors: (p) => messagesToVerifyErrors(paletteErrors(mission, p)),
      },
    );
    act(() => hook.result.current.setRungs([parseRung('XIC(Switch_0)TON(T1,100,0);')]));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    const ws = hook.result.current;
    // T1 does not exist → controller error; TON is not in the palette → mission rule on rung 0
    expect(ws.ruleErrors.some((e) => e.rungIndex === 0 && /TON/.test(e.message))).toBe(true);
  });
});

describe('useWorkspaceRuntime — review regressions', () => {
  const motor = SCENE_LOGICS['motor-station']!;
  const motorSetup = (rungs: string[]) =>
    setup({ rungs, comments: [], tags: [] }, { scene: motor, buildProject: (s) => createProjectForScene(motor, s.rungs, { comments: s.comments, tags: s.tags }) });
  const coil = (ws: { controller: { tags: { readBool(n: string): boolean } } }) => ws.controller.tags.readBool('Motor_Starter');

  it('holds an edit that leaves an empty branch leg (the motor must not start by itself)', () => {
    vi.useFakeTimers();
    const { hook, events } = motorSetup(['XIC(Start_PB)OTE(Motor_Starter);']);
    const ws0 = hook.result.current;
    act(() => ws0.runtime.step(100));
    expect(coil(ws0)).toBe(false);
    const id = ws0.rungs[0]!.id;
    // "Add branch around the selection" on the only contact → an empty leg shorts Start_PB
    act(() => hook.result.current.setRungs([{ ...parseRung('[XIC(Start_PB),]OTE(Motor_Starter);'), id }]));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    let ws = hook.result.current;
    expect(ws.pending).toBe(true);
    expect(ws.pendingReason).toBe('branch');
    expect(ws.heldRungs).toEqual([0]);
    expect(ws.appliedAt).toBeNull();
    expect(texts(mainRungs(ws.controller.project))).toEqual(['XIC(Start_PB)OTE(Motor_Starter);']);
    act(() => ws.runtime.step(200));
    expect(coil(ws)).toBe(false);
    // the seal-in contact goes into the new leg → applied online, still off until Start is pressed
    act(() => hook.result.current.setRungs([{ ...parseRung('[XIC(Start_PB),XIC(Motor_Starter)]OTE(Motor_Starter);'), id }]));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    ws = hook.result.current;
    expect(ws.pending).toBe(false);
    expect(ws.appliedAt).not.toBeNull();
    act(() => ws.runtime.step(200));
    expect(coil(ws)).toBe(false);
    expect(events.filter((e) => e.type === 'rungEdited').length).toBe(2);
  });

  it('does not hold edits of other rungs when an unchanged rung already has an empty leg', () => {
    const a = parseRung('[XIC(Switch_0),]OTE(Light_0);');
    const b = parseRung('XIC(Switch_1)OTE(Light_1);');
    expect(newShortedRungs([a, b], [a, b])).toEqual([]);
    expect(newShortedRungs([a, parseRung('XIO(Switch_1)OTE(Light_1);')], [a, b])).toEqual([]);
    expect(newShortedRungs([a, b], [parseRung('XIC(Switch_0)OTE(Light_0);'), b])).toEqual([0]);
    expect(newShortedRungs([parseRung('[XIC(A),XIC(B),]OTE(C);')], [parseRung('[XIC(A),XIC(B)]OTE(C);')])).toEqual([0]);
  });

  it('refuses to download rungs that do not verify and keeps the last good logic running', () => {
    vi.useFakeTimers();
    const { hook } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_1)OTE(Light_1);'], comments: [], tags: [] });
    const ws0 = hook.result.current;
    ws0.runtime.setControl('sw0', true);
    act(() => ws0.runtime.step(50));
    expect(ws0.runtime.observe().light0).toBe(true);
    act(() => hook.result.current.setRungs([ws0.rungs[0]!, { ...parseRung('XIC(Nope_Tag)OTE(Light_1);'), id: ws0.rungs[1]!.id }]));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    expect(hook.result.current.pendingReason).toBe('errors');
    let ok = true;
    act(() => {
      ok = hook.result.current.download();
    });
    expect(ok).toBe(false);
    act(() => ws0.runtime.step(50));
    expect(ws0.controller.getStatus().mode).toBe('REM_RUN');
    expect(ws0.runtime.observe().light0).toBe(true);
    expect(texts(mainRungs(ws0.controller.project))[1]).toBe('XIC(Switch_1)OTE(Light_1);');
    expect(useToasts.getState().toasts.some((t) => t.title === 'Download refused')).toBe(true);
  });

  it('counts a rung edit applied by a tag change inside the edit debounce', () => {
    vi.useFakeTimers();
    const { hook, events } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_1)OTE(Light_1);'], comments: [], tags: [] });
    const ws0 = hook.result.current;
    act(() => hook.result.current.setRungs([ws0.rungs[0]!, { ...parseRung('XIO(Switch_1)OTE(Light_1);'), id: ws0.rungs[1]!.id }]));
    act(() => void ws0.controller.upsertTag({ name: 'MyTimer', dataType: 'TIMER' }));
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    expect(texts(mainRungs(ws0.controller.project))[1]).toBe('XIO(Switch_1)OTE(Light_1);');
    expect(events).toContainEqual({ type: 'rungEdited', count: 1 });
    expect(hook.result.current.appliedAt).not.toBeNull();
    // the timer firing later must not count it twice
    expect(events.filter((e) => e.type === 'rungEdited').length).toBe(1);
  });

  it('refuses to load a program while the key switch is in RUN (nothing changes)', () => {
    const { hook } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: [], tags: [] });
    const ws0 = hook.result.current;
    act(() => void ws0.controller.setKeySwitch('RUN'));
    let ok = true;
    act(() => {
      ok = hook.result.current.loadProgram({ rungs: ['XIC(Switch_1)OTE(Light_1);'], comments: [], tags: [] });
    });
    expect(ok).toBe(false);
    expect(texts(hook.result.current.rungs)).toEqual(['XIC(Switch_0)OTE(Light_0);']);
    expect(texts(mainRungs(ws0.controller.project))).toEqual(['XIC(Switch_0)OTE(Light_0);']);
  });

  it('reports unparsable start rungs once, after mount (buildSafely is pure)', () => {
    const build = (s: ProgramSnapshot) => createProjectForScene(trainer, s.rungs, { comments: s.comments, tags: s.tags });
    const before = useToasts.getState().toasts.length;
    const r = buildSafely(build, { rungs: ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_1 OTE(Light_1);'], comments: [], tags: [] });
    expect(r.dropped).toBe(1);
    expect(useToasts.getState().toasts.length).toBe(before);
    expect(texts(mainRungs(r.project))).toEqual(['XIC(Switch_0)OTE(Light_0);', ';']);
    const { hook } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_1 OTE(Light_1);'], comments: [], tags: [] });
    hook.rerender();
    const warn = useToasts.getState().toasts.filter((t) => /could not be loaded/.test(t.title));
    expect(warn.length).toBe(1);
    expect(hook.result.current.rungs[1]!.comment).toMatch(/Could not load this rung/);
  });
});

describe('replay view', () => {
  it('renders a replay runtime but refuses to operate it', () => {
    const { hook } = setup({ rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: [], tags: [] });
    const rt = hook.result.current.runtime;
    const blocked: string[] = [];
    const view = readOnlyRuntime(rt, (id) => blocked.push(id));
    view.setControl('sw0', true);
    expect(blocked).toEqual(['sw0']);
    expect(rt.getControl('sw0')).toBe(false);
    // everything else reads the real runtime
    rt.setControl('sw1', true);
    expect(view.getControl('sw1')).toBe(true);
    expect(view.state).toBe(rt.state);
    expect(view.controller).toBe(rt.controller);
    act(() => rt.step(30));
    expect(view.timeMs).toBe(rt.timeMs);
    expect(view.observe()).toEqual(rt.observe());
  });
});

describe('workspace view helpers', () => {
  it('maps objectives to test results', () => {
    const m = { objectives: ['a', 'b'], tests: [{ name: 'x', steps: [] }, { name: 'y', steps: [] }] };
    expect(objectiveStates(m, [], false)).toEqual(['pending', 'pending']);
    expect(objectiveStates(m, [], true)).toEqual(['passed', 'passed']);
    expect(objectiveStates(m, [{ name: 'x', passed: true, steps: [] }, { name: 'y', passed: false, steps: [] }], false)).toEqual(['passed', 'failed']);
    const m3 = { objectives: ['a', 'b', 'c'], tests: m.tests };
    expect(objectiveStates(m3, [{ name: 'x', passed: true, steps: [] }, { name: 'y', passed: true, steps: [] }], false)).toEqual(['passed', 'passed', 'passed']);
    expect(objectiveStates(m3, [{ name: 'x', passed: true, steps: [] }, { name: 'y', passed: false, steps: [] }], false)).toEqual(['pending', 'pending', 'pending']);
  });

  it('classifies N.O. / N.C. devices and control colours', () => {
    const ms = SCENE_LOGICS['motor-station']!;
    const by = (alias: string) => ms.io.find((p) => p.alias === alias)!;
    expect(contactKind(by('Stop_PB'))).toBe('NC');
    expect(contactKind(by('Start_PB'))).toBe('NO');
    expect(contactKind(by('EStop_OK'))).toBe('NC');
    expect(controlTone({ id: 'start', label: 'Start' })).toBe('green');
    expect(controlTone({ id: 'stop', label: 'Stop' })).toBe('red');
    expect(controlTone({ id: 'jog', label: 'Jog' })).toBe('slate');
  });

  it('humanizes observable ids in failure messages', () => {
    expect(humanizeMessage('Lamp — expected light0 ON, but it was OFF (0)', trainer)).toMatch(/expected Light 0/);
    expect(humanizeMessage('no ids here', trainer)).toBe('no ids here');
  });
});

describe('lock reasons', () => {
  it('names the previous mission or the chapter rule', () => {
    const p = createDefaultProfile();
    const r = lockReason(p, getMission('1-3')!);
    expect(r.text).toMatch(/1-2/);
    expect(r.next).toBeUndefined(); // 1-2 itself is still locked (1-1 not done)
    const r2 = lockReason(p, getMission('1-2')!);
    expect(r2.next?.id).toBe('1-1');
    const r3 = lockReason(p, getMission('2-3')!);
    expect(r3.text).toMatch(/Chapter 2 opens/);
    expect(r3.next?.id).toBe('1-1');
  });
});
