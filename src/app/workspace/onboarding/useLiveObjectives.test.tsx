// @vitest-environment jsdom
/**
 * Live objectives wired to the real workspace runtime (jsdom): nothing runs before the first edit, an accepted
 * online edit triggers a quiet check after the debounce, pending (non-verifying) edits do not, a graded run pauses
 * it and is adopted, and switching the feature off clears it. The "Try it now" prompt follows accepted edits.
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMission } from '../../../game/missions';
import { buildMissionProject } from '../../../game/validation';
import { parseRung } from '../../../plc/neutralText';
import { SCENE_LOGICS } from '../../../sim/scenes';
import { EDIT_DEBOUNCE_MS, useWorkspaceRuntime } from '../useWorkspaceRuntime';
import { LIVE_DEBOUNCE_MS, programSig } from './liveObjectives';
import { TRY_IT_DELAY_MS, useTryItPrompt } from './TryItNow';
import { useLiveObjectives } from './useLiveObjectives';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const m11 = getMission('1-1')!;
const trainer = SCENE_LOGICS.trainer!;

function setup(opts: { paused?: boolean; enabled?: boolean } = {}) {
  let props = { paused: opts.paused ?? false, enabled: opts.enabled ?? true };
  const hook = renderHook(
    (p: { paused: boolean; enabled: boolean }) => {
      const ws = useWorkspaceRuntime({
        scene: trainer,
        initial: { rungs: [''], comments: [], tags: [] },
        buildProject: (s) => buildMissionProject(m11, s.rungs, s.comments, s.tags),
      });
      const live = useLiveObjectives({ mission: m11, ws, buildProject: (s) => buildMissionProject(m11, s.rungs, s.comments, s.tags), paused: p.paused, enabled: p.enabled });
      const tip = useTryItPrompt({ mission: m11, scene: trainer, ws, enabled: true, suppressed: false });
      return { ws, live, tip };
    },
    { initialProps: props },
  );
  const rerender = (next: Partial<typeof props>): void => {
    props = { ...props, ...next };
    hook.rerender(props);
  };
  const edit = async (text: string): Promise<void> => {
    act(() => hook.result.current.ws.setRungs([{ ...hook.result.current.ws.rungs[0]!, elements: parseRung(text).elements }]));
    await act(async () => void (await vi.advanceTimersByTimeAsync(EDIT_DEBOUNCE_MS + 10)));
  };
  const settle = async (ms = LIVE_DEBOUNCE_MS + 5000): Promise<void> => {
    await act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  };
  return { hook, rerender, edit, settle };
}

describe('useLiveObjectives', () => {
  it('stays quiet until an edit is accepted, then ticks what the program does', async () => {
    vi.useFakeTimers();
    const { hook, edit, settle } = setup();
    await settle();
    expect(hook.result.current.live.outcome).toBeNull();
    await edit('XIC(Switch_1)OTE(Light_0);');
    expect(hook.result.current.ws.appliedAt).not.toBeNull();
    await settle();
    const o = hook.result.current.live.outcome!;
    expect(o.graded).toBe(false);
    expect(o.allPassed).toBe(false);
    expect(o.states[0]).toBe('passed');
    expect(hook.result.current.live.fresh).toBe(true);
    await edit('XIC(Switch_0)OTE(Light_0);');
    expect(hook.result.current.live.fresh).toBe(false); // the check is about the previous program
    await settle();
    expect(hook.result.current.live.outcome!.allPassed).toBe(true);
    expect(hook.result.current.live.fresh).toBe(true);
  });

  it('does not check a program that does not verify', async () => {
    vi.useFakeTimers();
    const { hook, edit, settle } = setup();
    await edit('XIC(Nope)OTE(Light_0);');
    expect(hook.result.current.ws.pending).toBe(true);
    await settle();
    expect(hook.result.current.live.outcome).toBeNull();
  });

  it('pauses during a graded run, adopts its results, and clears when switched off', async () => {
    vi.useFakeTimers();
    const { hook, rerender, edit, settle } = setup({ paused: true });
    await edit('XIC(Switch_0)OTE(Light_0);');
    await settle();
    expect(hook.result.current.live.outcome).toBeNull(); // paused: nothing ran
    const sig = programSig(hook.result.current.ws.snapshot());
    act(() => hook.result.current.live.noteGraded(sig, [0, 1, 2].map((i) => ({ name: `t${i}`, passed: true, steps: [] })), []));
    expect(hook.result.current.live.outcome).toMatchObject({ graded: true, allPassed: true, sig });
    rerender({ paused: false });
    await settle();
    expect(hook.result.current.live.outcome!.graded).toBe(true); // the same program is not re-run
    rerender({ enabled: false });
    expect(hook.result.current.live.outcome).toBeNull();
    rerender({ enabled: true });
    await settle();
    expect(hook.result.current.live.outcome).toMatchObject({ graded: false, allPassed: true });
  });

  it('suggests the control of the edited rung after it applies, and closes when it is used', async () => {
    vi.useFakeTimers();
    const { hook, edit } = setup();
    await edit('XIC(Switch_2)OTE(Light_0);');
    expect(hook.result.current.tip.suggestion).toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(TRY_IT_DELAY_MS + 10)));
    expect(hook.result.current.tip.suggestion).toMatchObject({ controlId: 'sw2', text: 'Flip Switch 2 to try your rung' });
    act(() => hook.result.current.ws.runtime.setControl('sw2', true));
    expect(hook.result.current.tip.suggestion).toBeNull();
  });
});
