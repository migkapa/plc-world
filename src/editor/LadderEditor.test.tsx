// @vitest-environment jsdom
/**
 * Component-level regression tests for the ladder editor UIs (jsdom + Testing Library): focus handling
 * of overlays opened from the context menu, Tab at the routine ends, undo across routine switches,
 * clipboard placement, autocomplete Enter semantics, New Tag, Branch → Level, forces by scope,
 * toolbar focus, End-rung double-click, rung text validation, organizer keyboard, online toolbar.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createController, type LogixController } from '@/plc/controller';
import { instructionsOf, parseRung, serializeRung } from '@/plc/neutralText';
import type { BranchNode, Rung, TagDef } from '@/plc/types';
import { createProjectForScene } from '@/sim/project';
import { trainerLogic } from '@/sim/scenes';
import { ControllerOrganizer } from './ControllerOrganizer';
import { LadderEditor, checkRungText, type LadderEditorHandle, type LadderEditorProps } from './LadderEditor';
import { OnlineToolbar } from './OnlineToolbar';

beforeAll(() => {
  const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
  g.CSS ??= {};
  g.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});
afterEach(() => cleanup());

const wait = (ms = 40): Promise<void> => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const texts = (rs: readonly Rung[]): string[] => rs.map((r) => serializeRung(r));
const idOf = (r: Rung, i: number): string => instructionsOf(r.elements)[i]!.id;
const branchOf = (r: Rung): BranchNode => r.elements.find((e): e is BranchNode => e.kind === 'branch')!;

interface Mounted {
  ref: React.RefObject<LadderEditorHandle | null>;
  state: { rungs: Rung[] };
  onChange: ReturnType<typeof vi.fn>;
  app: HTMLElement;
  container: HTMLElement;
  rerender(p: Partial<LadderEditorProps>): void;
}

function mount(initial: Rung[], props: Partial<LadderEditorProps> = {}): Mounted {
  const ref = createRef<LadderEditorHandle>();
  const state = { rungs: initial };
  const onChange = vi.fn();
  let setExternal: ((p: Partial<LadderEditorProps>) => void) | undefined;
  function Harness() {
    const [rungs, setRungs] = useState(initial);
    const [extra, setExtra] = useState<Partial<LadderEditorProps>>({});
    setExternal = (p) => {
      setExtra(p);
      if (p.rungs) {
        state.rungs = p.rungs;
        setRungs(p.rungs);
      }
    };
    return (
      <LadderEditor
        ref={ref}
        program="MainProgram"
        routine="MainRoutine"
        showToolbar
        {...props}
        {...extra}
        rungs={rungs}
        onChange={(r) => {
          onChange(r);
          state.rungs = r;
          setRungs(r);
        }}
      />
    );
  }
  const { container } = render(<Harness />);
  return {
    ref,
    state,
    onChange,
    app: screen.getByRole('application'),
    container,
    rerender: (p) => act(() => setExternal?.(p)),
  };
}

const opRect = (container: HTMLElement, elementId: string, index = 0): Element => container.querySelector(`[data-el="${elementId}"] [data-op="${index}"]`)!;

function trainerController(rungs: string[], tags: TagDef[] = []): LogixController {
  return createController(createProjectForScene(trainerLogic, rungs, { tags }));
}

// ---------------------------------------------------------------------------

describe('context menu actions that open an editor keep it open and focused', () => {
  const cases: Array<[RegExp, string]> = [
    [/^Edit Operand/, 'input'],
    [/^Change Instruction/, 'input'],
    [/Rung Comment/, 'textarea'],
    [/^Edit Rung as Text/, 'textarea'],
  ];
  for (const [label, tag] of cases) {
    it(String(label), async () => {
      const r = parseRung('XIC(Motor_Run)OTE(Light_0);');
      const m = mount([r]);
      fireEvent.contextMenu(opRect(m.container, idOf(r, 0)), { clientX: 40, clientY: 40 });
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      await wait(60);
      const editor = m.container.querySelector(`.ld-pop ${tag}`);
      expect(editor).not.toBeNull();
      expect(document.activeElement).toBe(editor);
    });
  }

  it('returns focus to the ladder after a plain action', async () => {
    const r = parseRung('XIC(A)OTE(B);');
    const m = mount([r, parseRung('XIC(C)OTE(D);')]);
    fireEvent.contextMenu(opRect(m.container, idOf(r, 0)), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Delete Instruction/ }));
    await wait(60);
    expect(texts(m.state.rungs)[0]).toBe('OTE(B);');
    expect(document.activeElement).toBe(m.app);
  });
});

describe('operand editor at the routine ends', () => {
  it('Tab on the last operand of the routine commits and closes', async () => {
    const r = parseRung('XIC(A)OTE(B);');
    const m = mount([r]);
    act(() => m.ref.current!.setSelection({ rungId: r.id, elementId: idOf(r, 1), operandIndex: 0 }));
    act(() => m.ref.current!.editOperand());
    const input = screen.getByRole('textbox', { name: /OTE/ });
    fireEvent.change(input, { target: { value: 'Motor' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await wait();
    expect(texts(m.state.rungs)).toEqual(['XIC(A)OTE(Motor);']);
    expect(screen.queryByRole('textbox', { name: /OTE/ })).toBeNull();
    expect(document.activeElement).toBe(m.app);
  });

  it('Shift+Tab on the first operand of the routine commits and closes', async () => {
    const r = parseRung('XIC(A)OTE(B);');
    const m = mount([r]);
    act(() => m.ref.current!.setSelection({ rungId: r.id, elementId: idOf(r, 0), operandIndex: 0 }));
    act(() => m.ref.current!.editOperand());
    const input = screen.getByRole('textbox', { name: /XIC/ });
    fireEvent.change(input, { target: { value: 'Start' } });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    await wait();
    expect(texts(m.state.rungs)).toEqual(['XIC(Start)OTE(B);']);
    expect(screen.queryByRole('textbox', { name: /XIC/ })).toBeNull();
  });

  it('Tab moves on to the next operand (fresh editor that still accepts Enter)', async () => {
    const r = parseRung('XIC(A)OTE(B);');
    const m = mount([r]);
    act(() => m.ref.current!.setSelection({ rungId: r.id, elementId: idOf(r, 0), operandIndex: 0 }));
    act(() => m.ref.current!.editOperand());
    fireEvent.keyDown(screen.getByRole('textbox', { name: /XIC/ }), { key: 'Tab' });
    const next = screen.getByRole('textbox', { name: /OTE/ });
    expect(document.activeElement).toBe(next);
    fireEvent.change(next, { target: { value: 'Lamp' } });
    fireEvent.keyDown(next, { key: 'Enter' });
    await wait();
    expect(texts(m.state.rungs)).toEqual(['XIC(A)OTE(Lamp);']);
    expect(screen.queryByRole('textbox', { name: /OTE/ })).toBeNull();
  });
});

describe('undo history is per routine', () => {
  it('undo after switching routine does not write the previous routine back', () => {
    const r1 = [parseRung('XIC(A)OTE(B);')];
    const r2 = [parseRung('XIC(C)OTE(D);')];
    const m = mount(r1, { routine: 'Sub_A' });
    act(() => m.ref.current!.addRung());
    expect(m.state.rungs).toHaveLength(2);
    m.rerender({ rungs: r2, routine: 'Sub_B' });
    m.onChange.mockClear();
    act(() => m.ref.current!.undo());
    expect(m.onChange).not.toHaveBeenCalled();
    expect(m.ref.current!.getSelection()).toBeNull();
    // the new routine records its own history
    act(() => m.ref.current!.addRung());
    act(() => m.ref.current!.undo());
    expect(texts(m.state.rungs)).toEqual(['XIC(C)OTE(D);']);
  });
});

describe('clipboard', () => {
  it('pastes input instructions before the coil of a selected rung', async () => {
    const rs = [parseRung('XIC(A)OTE(B);'), parseRung('XIC(C)OTE(D);')];
    const m = mount(rs);
    act(() => m.ref.current!.setSelection({ rungId: rs[0]!.id, elementId: idOf(rs[0]!, 0) }));
    fireEvent.keyDown(m.app, { key: 'c', ctrlKey: true });
    act(() => m.ref.current!.setSelection({ rungId: rs[1]!.id }));
    fireEvent.keyDown(m.app, { key: 'v', ctrlKey: true });
    await wait(80);
    expect(texts(m.state.rungs)).toEqual(['XIC(A)OTE(B);', 'XIC(C)XIC(A)OTE(D);']);
  });

  it('Ctrl+X on a branch level copies its logic before deleting it', async () => {
    const rs = [parseRung('[XIC(A),XIC(B)]OTE(C);'), parseRung('XIC(D)OTE(E);')];
    const m = mount(rs);
    act(() => m.ref.current!.setSelection({ rungId: rs[0]!.id, legPath: { branchId: branchOf(rs[0]!).id, leg: 1 } }));
    fireEvent.keyDown(m.app, { key: 'x', ctrlKey: true });
    expect(texts(m.state.rungs)[0]).toBe('XIC(A)OTE(C);');
    act(() => m.ref.current!.setSelection({ rungId: rs[1]!.id, wireIndex: 0 }));
    fireEvent.keyDown(m.app, { key: 'v', ctrlKey: true });
    await wait(80);
    expect(texts(m.state.rungs)[1]).toBe('XIC(B)XIC(D)OTE(E);');
  });

  it('Ctrl+X on an empty wire position deletes nothing', () => {
    const rs = [parseRung('XIC(A)OTE(B);')];
    const m = mount(rs);
    act(() => m.ref.current!.setSelection({ rungId: rs[0]!.id, wireIndex: 1 }));
    fireEvent.keyDown(m.app, { key: 'x', ctrlKey: true });
    expect(m.onChange).not.toHaveBeenCalled();
  });
});

describe('operand autocomplete', () => {
  const tags: TagDef[] = [{ name: 'Motor_Run', dataType: 'BOOL', description: 'Motor run command' }];
  const setup = () => {
    const c = trainerController(['XIC(Motor_Run)OTE(Light_0);', 'XIC(Switch_1)OTE(Light_1);'], tags);
    const rs = c.project.programs[0]!.routines[0]!.rungs;
    const m = mount(rs, { controller: c });
    act(() => m.ref.current!.setSelection({ rungId: rs[0]!.id, elementId: idOf(rs[0]!, 1), operandIndex: 0 }));
    act(() => m.ref.current!.editOperand());
    return { c, rs, m, input: screen.getByRole('textbox', { name: /OTE/ }) };
  };

  it('Enter commits the typed name — never a longer existing tag', async () => {
    const { m, input } = setup();
    fireEvent.change(input, { target: { value: 'Motor' } });
    // the explicit choices are listed: create it, or pick Motor_Run
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')[0]!.textContent).toMatch(/New tag 'Motor'/);
    expect(within(list).getByText('Motor_Run')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    await wait();
    expect(texts(m.state.rungs)[0]).toBe('XIC(Motor_Run)OTE(Motor);');
  });

  it('↑/↓ then Enter picks a suggestion; Tab completes', async () => {
    const { m, input } = setup();
    fireEvent.change(input, { target: { value: 'Motor' } });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    const k = options.findIndex((o) => o.textContent?.startsWith('Motor_Run'));
    for (let i = 0; i <= k; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await wait();
    expect(texts(m.state.rungs)[0]).toBe('XIC(Motor_Run)OTE(Motor_Run);');
  });

  it('Tab completes to the first matching tag', async () => {
    const { m, input } = setup();
    fireEvent.change(input, { target: { value: 'motor_r' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await wait();
    expect(texts(m.state.rungs)[0]).toBe('XIC(Motor_Run)OTE(Motor_Run);');
  });

  it('an exact match is committed in the tag spelling', async () => {
    const { m, input } = setup();
    fireEvent.change(input, { target: { value: 'motor_run' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await wait();
    expect(texts(m.state.rungs)[0]).toBe('XIC(Motor_Run)OTE(Motor_Run);');
  });

  it('the "New tag" row uses the name and opens the New Tag dialog', async () => {
    const { c, m, input } = setup();
    fireEvent.change(input, { target: { value: 'Horn' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await wait();
    expect(texts(m.state.rungs)[0]).toBe('XIC(Motor_Run)OTE(Horn);');
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('textbox', { name: 'Tag name' }) as HTMLInputElement).value).toBe('Horn');
    expect((within(dialog).getByRole('combobox', { name: 'Data type' }) as HTMLSelectElement).value).toBe('BOOL');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await wait();
    expect(c.tags.getDef('Horn')?.dataType).toBe('BOOL');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('New Tag from the ladder', () => {
  it('offers New Tag for an undefined operand and creates it with the instruction type', async () => {
    const c = trainerController(['XIC(Start_PB)TON(Delay_T,2000,0);']);
    const rs = c.project.programs[0]!.routines[0]!.rungs;
    const onTagsChanged = vi.fn();
    const m = mount(rs, { controller: c, onTagsChanged });
    fireEvent.contextMenu(opRect(m.container, idOf(rs[0]!, 1), 0), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /New Tag 'Delay_T'/ }));
    await wait();
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('combobox', { name: 'Data type' }) as HTMLSelectElement).value).toBe('TIMER');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), { target: { value: 'Start delay' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await wait();
    expect(c.tags.getDef('Delay_T')).toMatchObject({ dataType: 'TIMER', description: 'Start delay' });
    expect(onTagsChanged).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+W / Alt+W open it for the selected instruction; aliases and scope are supported', async () => {
    const c = trainerController(['XIC(Start_PB)OTE(Light_0);']);
    const rs = c.project.programs[0]!.routines[0]!.rungs;
    const m = mount(rs, { controller: c });
    act(() => m.ref.current!.setSelection({ rungId: rs[0]!.id, elementId: idOf(rs[0]!, 0) }));
    fireEvent.keyDown(m.app, { key: 'w', ctrlKey: true });
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(m.app, { key: '∑', code: 'KeyW', altKey: true });
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Alias' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Alias for' }), { target: { value: 'Local:1:I.Data.3' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Scope' }), { target: { value: 'program' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await wait();
    expect(c.tags.getDef('Start_PB', 'MainProgram')).toMatchObject({ aliasFor: 'Local:1:I.Data.3', dataType: 'BOOL' });
    expect(c.project.tags.find((t) => t.name === 'Start_PB')).toBeUndefined();
  });

  it('refuses invalid or duplicate names', () => {
    const c = trainerController(['XIC(Start_PB)OTE(Light_0);']);
    const rs = c.project.programs[0]!.routines[0]!.rungs;
    const m = mount(rs, { controller: c });
    act(() => m.ref.current!.setSelection({ rungId: rs[0]!.id, elementId: idOf(rs[0]!, 0) }));
    act(() => m.ref.current!.newTag());
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByRole('textbox', { name: 'Tag name' });
    fireEvent.change(name, { target: { value: 'Switch_0' } });
    expect(within(dialog).getByText(/already exists/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'Bad__Name' } });
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('branches', () => {
  it('Branch then Level fills the empty leg instead of leaving a short', async () => {
    const r = parseRung('XIC(Motor_Run)OTE(Light_0);');
    const m = mount([r]);
    act(() => m.ref.current!.setSelection({ rungId: r.id, wireIndex: 1 }));
    act(() => m.ref.current!.addBranch());
    act(() => m.ref.current!.startQuickEntry('XIC Switch_1'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ASCII instruction entry' }), { key: 'Enter' });
    act(() => m.ref.current!.addBranchLevel());
    act(() => m.ref.current!.startQuickEntry('XIC Switch_2'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ASCII instruction entry' }), { key: 'Enter' });
    await wait();
    expect(texts(m.state.rungs)).toEqual(['XIC(Motor_Run)[XIC(Switch_1),XIC(Switch_2)]OTE(Light_0);']);
    // a third level is a real new leg
    act(() => m.ref.current!.addBranchLevel());
    expect(texts(m.state.rungs)).toEqual(['XIC(Motor_Run)[XIC(Switch_1),XIC(Switch_2),]OTE(Light_0);']);
  });

  it('draws empty legs as shorts and outlines branch-level verify results', () => {
    const r = parseRung('XIC(M)[XIC(S1),]OTE(L);');
    const br = branchOf(r);
    const m = mount([r], {
      errors: [{ program: 'MainProgram', routine: 'MainRoutine', rungIndex: 0, elementId: br.id, message: 'Shorted branch detected', severity: 'warning' }],
    });
    const g = m.container.querySelector(`g.ld-br[data-el="${br.id}"]`)!;
    expect(g.querySelectorAll('.ld-short')).toHaveLength(1);
    expect(g.querySelector('.ld-warnbox')).not.toBeNull();
    // Delete on the empty level's wire removes the level
    act(() => m.ref.current!.setSelection({ rungId: r.id, legPath: { branchId: br.id, leg: 1 }, wireIndex: 0 }));
    fireEvent.keyDown(m.app, { key: 'Delete' });
    expect(texts(m.state.rungs)).toEqual(['XIC(M)XIC(S1)OTE(L);']);
  });
});

describe('focus', () => {
  it('the ladder has focus synchronously after an ASCII entry commit (no dropped keys)', () => {
    const r = parseRung('XIC(A)OTE(B);');
    const m = mount([r]);
    act(() => m.ref.current!.setSelection({ rungId: r.id }));
    act(() => m.ref.current!.startQuickEntry('XIC PB_Red'));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ASCII instruction entry' }), { key: 'Enter' });
    expect(document.activeElement).toBe(m.app);
    fireEvent.keyDown(m.app, { key: 'O' });
    expect((screen.getByRole('textbox', { name: 'ASCII instruction entry' }) as HTMLInputElement).value).toBe('O');
  });

  it('clicking a wire always gives the ladder keyboard focus', () => {
    const r = parseRung('XIC(A)OTE(B);');
    const m = mount([r]);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.mouseDown(m.container.querySelector('[data-gap="/1"]')!, { button: 0 });
    expect(document.activeElement).toBe(m.app);
    expect(m.ref.current!.getSelection()).toEqual({ rungId: r.id, wireIndex: 1 });
    outside.remove();
  });

  it('inserting an instruction without operands from the toolbar returns focus to the ladder', async () => {
    const r = parseRung('XIC(A)OTE(B);');
    const m = mount([r]);
    act(() => m.ref.current!.setSelection({ rungId: r.id }));
    fireEvent.click(screen.getByRole('tab', { name: 'Program Control' }));
    const nop = screen.getByRole('button', { name: /^NOP/ });
    nop.focus();
    fireEvent.click(nop);
    await wait(60);
    expect(texts(m.state.rungs)).toEqual(['XIC(A)OTE(B)NOP();']);
    expect(document.activeElement).toBe(m.app);
  });
});

describe('End rung', () => {
  it('double-click appends a rung at the end, whatever is selected', () => {
    const rs = [parseRung('XIC(A)OTE(B);'), parseRung('XIC(C)OTE(D);')];
    const m = mount(rs);
    act(() => m.ref.current!.setSelection({ rungId: rs[0]!.id }));
    fireEvent.doubleClick(m.container.querySelector('[data-end-rung]')!);
    expect(texts(m.state.rungs)).toEqual(['XIC(A)OTE(B);', 'XIC(C)OTE(D);', ';']);
    expect(m.ref.current!.getSelection()).toEqual({ rungId: m.state.rungs[2]!.id });
  });
});

describe('forces respect program scope', () => {
  it('Force On from the ladder forces the point the program-scoped alias names', async () => {
    const c = trainerController(['XIC(Switch_0)OTE(Light_0);']);
    c.upsertTag({ name: 'Switch_0', dataType: 'BOOL', aliasFor: 'Local:1:I.Data.9' }, 'MainProgram');
    const rs = c.project.programs[0]!.routines[0]!.rungs;
    const m = mount(rs, { controller: c, online: true });
    fireEvent.contextMenu(opRect(m.container, idOf(rs[0]!, 0)), { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByRole('menuitem', { name: /^Force On/ }));
    expect(Object.keys(c.getForces())).toEqual(['Local:1:I.Data.9']);
    await wait();
    fireEvent.contextMenu(opRect(m.container, idOf(rs[0]!, 0)), { clientX: 40, clientY: 40 });
    const remove = screen.getByRole('menuitem', { name: /^Remove Force/ }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    expect(c.getForces()).toEqual({});
  });
});

describe('rung text validation (Studio ASCII editor rules)', () => {
  it('rejects wrong operand counts and empty operands with a position', () => {
    expect(checkRungText('XIC()OTE(Light_0);')).toEqual({ message: 'XIC: Wrong number of operands (expected 1, found 0).', position: 0 });
    expect(checkRungText('TON(Blink_Timer);')?.message).toBe('TON: Wrong number of operands (expected 3, found 1).');
    expect(checkRungText('XIC(Motor_Run,Light_1)OTE(Light_0);')?.message).toBe('XIC: Wrong number of operands (expected 1, found 2).');
    expect(checkRungText('XIC(A)[XIC(B),XIC(C,D)]OTE(E);')).toMatchObject({ position: 14 });
    expect(checkRungText('MOV(,Dest);')?.message).toMatch(/MOV: Source is empty/);
    expect(checkRungText('CPT(Out,(A+B)*ABS(C))XIC(D)OTE(E);')).toBeNull();
  });

  it('accepts valid rungs (undefined tags are verify errors, not syntax errors)', () => {
    expect(checkRungText('XIC(A)OTE(B);')).toBeNull();
    expect(checkRungText('XIC(Undefined)TON(T,?,?);')).toBeNull();
    expect(checkRungText('NOP();')).toBeNull();
    expect(checkRungText('XYZ(A);')?.message).toBe("Unknown instruction 'XYZ'.");
    expect(checkRungText('XIC(A)OTE(B);', new Set(['XIC']))?.message).toBe('OTE is locked in this mission.');
    expect(checkRungText('XIC(A')?.message).toMatch(/Unterminated/);
  });

  it('keeps Accept disabled for a wrong operand count', () => {
    const r = parseRung('TON(Blink_Timer,1000,0);');
    const m = mount([r]);
    act(() => m.ref.current!.editRungText(r.id));
    const ta = screen.getByRole('textbox', { name: 'Rung neutral text' });
    fireEvent.change(ta, { target: { value: 'TON(Blink_Timer);' } });
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/expected 3, found 1/);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(m.onChange).not.toHaveBeenCalled();
  });
});

describe('ControllerOrganizer keyboard', () => {
  it('keeps working after the mouse collapses an ancestor of the focused node', () => {
    const c = trainerController(['XIC(A)OTE(B);']);
    const onSelect = vi.fn();
    render(<ControllerOrganizer project={c.project} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('treeitem', { name: /MainRoutine/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const tasks = screen.getByRole('treeitem', { name: /^Tasks/ });
    fireEvent.click(tasks.querySelector('span')!); // chevron
    expect(screen.queryByRole('treeitem', { name: /MainRoutine/ })).toBeNull();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

describe('OnlineToolbar', () => {
  it('disables Program Mode while faulted (Clear Majors first)', () => {
    const c = trainerController(['MOV(Recipe[Idx],Out);'], [
      { name: 'Recipe', dataType: 'DINT', dims: 10 },
      { name: 'Idx', dataType: 'DINT', initial: 99 },
      { name: 'Out', dataType: 'DINT' },
    ]);
    c.setKeySwitch('REM');
    c.requestMode('RUN');
    c.scan(10);
    expect(c.getStatus().mode).toBe('FAULTED');
    render(<OnlineToolbar controller={c} />);
    fireEvent.click(screen.getByTitle('Controller mode'));
    const prog = screen.getByRole('menuitem', { name: /^Program Mode/ }) as HTMLButtonElement;
    expect(prog.disabled).toBe(true);
    expect(prog.title).toBe('Clear Majors first');
  });
});
