// @vitest-environment jsdom
/**
 * The workspace ladder panel wired to a live workspace runtime (jsdom): game events come from the
 * editor callbacks (no controller proxy, no focus heuristics), the empty-routine hint uses the plant's
 * own tags and the online toolbar's edits tile follows the workspace state.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../game/achievements';
import type { LadderEditorHandle } from '../../editor';
import { instructionsOf } from '../../plc/neutralText';
import { createProjectForScene } from '../../sim/project';
import { SCENE_LOGICS } from '../../sim/scenes';
import { useToasts } from '../../ui';
import { LadderPanel, editsStateOf } from './LadderPanel';
import { exampleEntryFor, type ProgramSnapshot } from './program';
import { EDIT_DEBOUNCE_MS, useWorkspaceRuntime, type WorkspaceRuntime } from './useWorkspaceRuntime';
import { createRef, type RefObject } from 'react';

beforeAll(() => {
  const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  g.CSS ??= {};
  g.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useToasts.setState({ toasts: [] });
});

const trainer = SCENE_LOGICS.trainer!;

interface HarnessProps {
  initial: ProgramSnapshot;
  events: GameEvent[];
  editorRef: RefObject<LadderEditorHandle | null>;
  out: { ws?: WorkspaceRuntime };
  allowed?: string[];
}

function Harness({ initial, events, editorRef, out, allowed }: HarnessProps) {
  const ws = useWorkspaceRuntime({
    scene: trainer,
    initial,
    buildProject: (s) => createProjectForScene(trainer, s.rungs, { comments: s.comments, tags: s.tags }),
    onEvent: (e) => events.push(e),
  });
  out.ws = ws;
  return (
    <div style={{ height: 600 }}>
      <LadderPanel ws={ws} editorRef={editorRef} onEvent={(e) => events.push(e)} {...(allowed ? { allowedInstructions: allowed } : {})} />
    </div>
  );
}

function mountPanel(rungs: string[], allowed?: string[]) {
  const events: GameEvent[] = [];
  const editorRef = createRef<LadderEditorHandle>();
  const out: { ws?: WorkspaceRuntime } = {};
  render(<Harness initial={{ rungs, comments: [], tags: [] }} events={events} editorRef={editorRef} out={out} {...(allowed ? { allowed } : {})} />);
  return { events, editor: editorRef, app: screen.getByRole('application'), ws: () => out.ws! };
}

describe('LadderPanel game events (editor callbacks)', () => {
  it('Toggle Bit from the ladder counts as toggleBitUsed', () => {
    const { events, editor, app, ws } = mountPanel(['XIC(Switch_0)OTE(Light_0);']);
    const rung = ws().rungs[0]!;
    const ote = instructionsOf(rung.elements)[1]!;
    act(() => editor.current!.setSelection({ rungId: rung.id, elementId: ote.id, operandIndex: 0 }));
    fireEvent.keyDown(app, { key: '†', code: 'KeyT', altKey: true });
    expect(events.filter((e) => e.type === 'toggleBitUsed')).toHaveLength(1);
    expect(ws().controller.tags.readBool('Light_0', 'MainProgram')).toBe(true);
  });

  it('a rung accepted from "Edit Rung as Text" counts as neutralTextUsed; other edits do not', () => {
    const { events, editor } = mountPanel(['XIC(Switch_0)OTE(Light_0);']);
    act(() => editor.current!.addRung());
    expect(events.some((e) => e.type === 'neutralTextUsed')).toBe(false);
    act(() => editor.current!.editRungText());
    const ta = screen.getByRole('textbox', { name: 'Rung neutral text' });
    fireEvent.change(ta, { target: { value: 'XIC(Switch_1)OTE(Light_1);' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(events.filter((e) => e.type === 'neutralTextUsed')).toHaveLength(1);
  });
});

describe('LadderPanel empty routine', () => {
  it('suggests an entry with the plant’s own input tag', () => {
    mountPanel(['']);
    expect(screen.getByTestId('ld-empty-example').textContent).toBe('XIC Switch_0');
  });

  it('exampleEntryFor follows the scene I/O and the mission palette', () => {
    expect(exampleEntryFor(trainer)).toBe('XIC Switch_0');
    expect(exampleEntryFor(SCENE_LOGICS['motor-station']!)).toMatch(/^XIC \w+$/);
    expect(exampleEntryFor(trainer, ['XIO', 'OTE'])).toBe('XIO Switch_0');
    expect(exampleEntryFor(trainer, ['OTE'])).toBe('OTE Light_0');
    expect(exampleEntryFor(trainer, ['MOV'])).toBe('MOV');
    expect(exampleEntryFor({ io: [] })).toBe('XIC Start_PB');
  });
});

describe('LadderPanel edits tile', () => {
  it('maps the workspace state', () => {
    expect(editsStateOf(null, false)).toBe('none');
    expect(editsStateOf(null, true)).toBe('applied');
    expect(editsStateOf('errors', true)).toBe('pending');
    expect(editsStateOf('branch', false)).toBe('held');
  });

  it('shows pending edits, then applied, then no edits', () => {
    vi.useFakeTimers();
    const { editor, ws } = mountPanel(['XIC(Switch_0)OTE(Light_0);']);
    const id = ws().rungs[0]!.id;
    const tile = (): string | null => screen.getByTestId('edits-tile').getAttribute('data-state');
    const statusText = (): string => screen.queryAllByRole('status').map((e) => e.textContent ?? '').join('|');
    expect(tile()).toBe('none');
    // no false "Edits applied online" status for assistive tech on page load
    expect(statusText()).not.toMatch(/applied/i);
    expect(screen.getByTestId('edits-applied').getAttribute('aria-hidden')).toBe('true');
    // an undefined tag → pending (last good logic keeps running)
    act(() => editor.current!.editRungText(id));
    let ta = screen.getByRole('textbox', { name: 'Rung neutral text' });
    fireEvent.change(ta, { target: { value: 'XIC(Nope)OTE(Light_0);' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    expect(tile()).toBe('pending');
    // fixed → applied online, then the tile settles back
    act(() => editor.current!.editRungText(id));
    ta = screen.getByRole('textbox', { name: 'Rung neutral text' });
    fireEvent.change(ta, { target: { value: 'XIC(Switch_1)OTE(Light_0);' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    act(() => void vi.advanceTimersByTime(EDIT_DEBOUNCE_MS + 10));
    expect(tile()).toBe('applied');
    expect(statusText()).toMatch(/Edits applied online/);
    act(() => void vi.advanceTimersByTime(3000));
    expect(tile()).toBe('none');
    expect(statusText()).not.toMatch(/applied/i);
  });
});
