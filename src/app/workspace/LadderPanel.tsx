/**
 * Ladder area of the workspace: Studio 5000-style online toolbar (with the online-edit status, the
 * page actions and Download on the same row), the ladder editor (online, power flow animated) and a
 * compact list of verification problems (click to jump to the rung). When the panel is short (laptop
 * screens) the instruction palette collapses into one row so rungs keep most of the height.
 *
 * Game events from the ladder: Toggle Bit (`toggleBitUsed`) and "Edit Rung as Text" (`neutralTextUsed`)
 * come from the editor's onToggleBit / onRungTextCommit callbacks.
 */
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, Download, GitBranchPlus, Info, PencilLine, TriangleAlert } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode, type RefObject } from 'react';
import { DEFAULT_FAVORITES, INSTR_DRAG_TYPE, InstrGlyph, LadderEditor, OnlineToolbar, type EditsState, type LadderEditorHandle } from '../../editor';
import { BranchGlyph, RungGlyph } from '../../editor/glyphs';
import type { GameEvent } from '../../game/achievements';
import { INSTRUCTIONS } from '../../plc/instructions';
import type { PlcController, Rung, VerifyError } from '../../plc/types';
import { MAIN_PROGRAM, MAIN_ROUTINE } from '../../sim/project';
import { Button, cn } from '../../ui';
import { usePersistentState } from './hooks';
import { exampleEntryFor, friendlyVerifyError, mainRungs } from './program';
import type { WorkspaceRuntime } from './useWorkspaceRuntime';

export interface LadderPanelProps {
  ws: WorkspaceRuntime;
  editorRef?: RefObject<LadderEditorHandle | null>;
  allowedInstructions?: string[];
  /** Replay: show this controller (and its program) read-only instead of the live one. */
  replayController?: PlcController;
  onEvent?(e: GameEvent): void;
  allowKeySwitch?: boolean;
  /** Extra buttons next to Download (Reset program…). */
  actions?: ReactNode;
  className?: string;
}

/** Below this panel height the instruction palette collapses into a single row. */
export const COMPACT_PALETTE_BELOW_PX = 440;
/** How long the edits tile says "Edits Applied" after an online edit was accepted. */
export const APPLIED_FLASH_MS = 2600;

/** True for APPLIED_FLASH_MS after each accepted online edit (`at` changes). */
function useAppliedFlash(at: number | null): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (at === null) return;
    setVisible(true);
    const h = window.setTimeout(() => setVisible(false), APPLIED_FLASH_MS);
    return () => window.clearTimeout(h);
  }, [at]);
  return visible;
}

/** The online toolbar's edits tile for the workspace state. */
export function editsStateOf(pendingReason: WorkspaceRuntime['pendingReason'], justApplied: boolean): EditsState {
  if (pendingReason === 'errors') return 'pending';
  if (pendingReason === 'branch') return 'held';
  return justApplied ? 'applied' : 'none';
}

function AppliedIndicator({ visible }: { visible: boolean }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute right-4 bottom-9 z-10 flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/90 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-emerald-300 shadow-lg transition-opacity duration-700 @2xl:px-2',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      role="status"
      aria-live="polite"
      aria-label="Edits applied online"
      title="Your rung edits were verified and accepted online — the plant kept running"
      data-testid="edits-applied"
    >
      <CheckCircle2 size={12} />
      <span className="hidden @2xl:inline">Edits applied online</span>
    </span>
  );
}

/** Controller is executing logic (Run / Rem Run), re-read on controller events only. */
function useControllerRunning(controller: PlcController): boolean {
  const subscribe = useCallback((cb: () => void) => controller.subscribe(cb), [controller]);
  return useSyncExternalStore(
    subscribe,
    () => controller.getStatus().running,
    () => controller.getStatus().running,
  );
}

function EditStatus({ ws, replay }: { ws: WorkspaceRuntime; replay: boolean }) {
  const running = useControllerRunning(ws.controller);
  if (replay) {
    return (
      <span
        className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap text-sky-300"
        title="Replaying a test on its own controller — editing is paused"
      >
        <PencilLine size={12} /> <span className="hidden @2xl:inline">Replay · editing paused</span>
      </span>
    );
  }
  if (ws.pendingReason === 'branch') {
    const n = ws.heldRungs.length;
    return (
      <span
        className="flex shrink-0 items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-amber-200"
        title={`A branch leg on rung ${ws.heldRungs.join(', ')} has no instruction yet. An empty leg shorts the contacts around it and would switch the output on by itself, so the edit is held until the leg has an instruction (Studio 5000 warns “Shorted branch detected”). The controller keeps running the last accepted logic.`}
        data-testid="pending-edits"
        data-reason="branch"
      >
        <GitBranchPlus size={12} /> Finish the branch{n > 1 ? `es (${n})` : ''} — edits held
      </span>
    );
  }
  if (ws.pendingReason === 'errors') {
    const blocking = ws.errors.filter((e) => e.severity === 'error').length;
    const tail = running ? 'last good logic still running' : 'controller in Program mode';
    return (
      <span
        className="flex shrink-0 items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-amber-200"
        title={
          running
            ? 'The controller keeps running the last program that verified. Fix the errors and your edits are applied online automatically.'
            : 'The controller is in Program mode (outputs off). Fix the errors: the edits are applied and the controller goes to Run.'
        }
        data-testid="pending-edits"
        data-reason="errors"
      >
        <PencilLine size={12} /> Pending edits · {blocking} error
        {blocking === 1 ? '' : 's'}
        <span className="hidden font-normal text-amber-200/80 @5xl:inline"> — {tail}</span>
      </span>
    );
  }
  return (
    <span
      className="hidden shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-slate-500 @3xl:flex"
      title="Rungs are verified and accepted online as you edit (Studio 5000: test/accept edits)"
    >
      <CheckCircle2 size={12} className="text-emerald-500/70" /> Online editing
    </span>
  );
}

function ProblemList({ errors, rules, rungs, onJump }: { errors: VerifyError[]; rules: VerifyError[]; rungs: Rung[]; onJump(i: number): void }) {
  const [open, setOpen] = useState(true);
  const items = useMemo(
    () => [
      ...errors.filter((e) => e.severity === 'error').map((e) => ({ e, tone: 'error' as const })),
      ...rules.map((e) => ({ e, tone: 'rule' as const })),
      ...errors.filter((e) => e.severity === 'warning').map((e) => ({ e, tone: 'warning' as const })),
    ],
    [errors, rules],
  );
  if (items.length === 0) return null;
  const nErr = items.filter((i) => i.tone === 'error').length;
  const nRule = items.filter((i) => i.tone === 'rule').length;
  const nWarn = items.filter((i) => i.tone === 'warning').length;
  return (
    <div className="shrink-0 border-t border-edge bg-panel text-[11.5px]" data-testid="verify-problems">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center gap-3 px-3 py-1 text-left text-slate-300 hover:bg-white/[0.03]">
        {nErr > 0 && (
          <span className="flex items-center gap-1 text-red-300">
            <AlertCircle size={12} /> {nErr} error{nErr === 1 ? '' : 's'}
          </span>
        )}
        {nRule > 0 && (
          <span className="flex items-center gap-1 text-amber-300">
            <Info size={12} /> {nRule} mission rule{nRule === 1 ? '' : 's'}
          </span>
        )}
        {nWarn > 0 && (
          <span className="flex items-center gap-1 text-yellow-200/80">
            <TriangleAlert size={12} /> {nWarn} warning{nWarn === 1 ? '' : 's'}
          </span>
        )}
        <span className="ml-auto text-slate-500">{open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</span>
      </button>
      {open && (
        <ul className="max-h-24 overflow-y-auto px-2 pb-1.5">
          {items.map(({ e, tone }, i) => (
            <li key={i}>
              <button
                type="button"
                disabled={e.rungIndex < 0 || e.rungIndex >= rungs.length}
                onClick={() => onJump(e.rungIndex)}
                className={cn(
                  'flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left enabled:cursor-pointer enabled:hover:bg-white/5',
                  tone === 'error' ? 'text-red-200' : tone === 'rule' ? 'text-amber-200' : 'text-yellow-100/70',
                )}
              >
                <span className="mt-[3px] shrink-0">{tone === 'error' ? <AlertCircle size={11} /> : tone === 'rule' ? <Info size={11} /> : <TriangleAlert size={11} />}</span>
                <span className="min-w-0">{friendlyVerifyError(e)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact instruction palette (one row) for short ladder panels
// ---------------------------------------------------------------------------

function PaletteButton({ label, title, glyph, onClick, dragOp, accent }: { label: string; title: string; glyph: ReactNode; onClick(): void; dragOp?: string; accent?: boolean }) {
  const onDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    if (!dragOp) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(INSTR_DRAG_TYPE, dragOp);
    e.dataTransfer.setData('text/plain', dragOp);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      draggable={!!dragOp}
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[#cbd5e1] transition-colors hover:bg-sky-400/15 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none active:scale-95',
        accent && 'text-sky-400',
      )}
    >
      {glyph}
      <span className="font-mono text-[10px] leading-none font-semibold">{label}</span>
    </button>
  );
}

function CompactPalette({ editor, allowedInstructions, onExpand }: { editor: RefObject<LadderEditorHandle | null>; allowedInstructions?: readonly string[]; onExpand(): void }) {
  const ops = useMemo(
    () => (allowedInstructions?.length ? allowedInstructions.map((a) => a.toUpperCase()) : DEFAULT_FAVORITES).filter((op) => INSTRUCTIONS[op]),
    [allowedInstructions],
  );
  const run = (fn: (h: LadderEditorHandle) => void, refocus: boolean): void => {
    const h = editor.current;
    if (!h) return;
    fn(h);
    if (refocus) h.focus();
  };
  return (
    <div className="flex h-8 shrink-0 items-center border-b border-[#232e3a] bg-[#151c24] select-none" data-testid="compact-palette">
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1.5"
        style={{ scrollbarWidth: 'thin' }}
        role="toolbar"
        aria-label="Instruction palette (compact)"
      >
        <PaletteButton label="Rung" title="Add rung (Ctrl+R)" glyph={<RungGlyph width={18} height={12} />} onClick={() => run((h) => h.addRung(), true)} accent />
        <PaletteButton
          label="Branch"
          title="Add branch around the selection"
          glyph={<BranchGlyph width={18} height={12} />}
          onClick={() => run((h) => h.addBranch(), true)}
          accent
        />
        <PaletteButton label="Level" title="Add branch level" glyph={<BranchGlyph width={18} height={12} level />} onClick={() => run((h) => h.addBranchLevel(), true)} accent />
        <div className="mx-1 h-5 w-px shrink-0 bg-[#232e3a]" />
        {ops.map((op) => {
          const info = INSTRUCTIONS[op]!;
          return (
            <PaletteButton
              key={op}
              label={op}
              title={`${op} — ${info.name} (click to insert at the selection, or drag onto a rung wire)`}
              glyph={<InstrGlyph op={op} width={18} height={12} />}
              dragOp={op}
              onClick={() => run((h) => h.insertInstruction(op), info.operands.length === 0)}
            />
          );
        })}
      </div>
      <button
        type="button"
        onClick={onExpand}
        className="mx-1 flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold whitespace-nowrap text-slate-400 hover:bg-white/10 hover:text-white"
        title="Show the full instruction toolbar (all categories and search)"
        data-testid="palette-expand"
      >
        <ChevronsUpDown size={12} /> All instructions
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal overflow of the online toolbar (it shares its row with the edit status)
// ---------------------------------------------------------------------------

/**
 * Wraps a horizontally scrolling toolbar: a fade at the edge that hides content (key switch, status
 * lights…) and the mouse wheel scrolls it sideways.
 */
function ScrollFade({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });
  useEffect(() => {
    const host = ref.current;
    const el = host?.querySelector<HTMLElement>('[role="toolbar"]');
    if (!host || !el) return;
    const update = (): void => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    host.addEventListener('wheel', onWheel, { passive: false });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      host.removeEventListener('wheel', onWheel);
      ro?.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={cn('relative', className)} data-overflow-right={more.right ? '' : undefined}>
      {children}
      {more.left && <span className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[#10161d] to-transparent" />}
      {more.right && (
        <span
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#10161d] via-[#10161d]/80 to-transparent"
          title="Scroll for more (mouse wheel)"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function LadderPanelImpl({ ws, editorRef, allowedInstructions, replayController, onEvent, allowKeySwitch, actions, className }: LadderPanelProps) {
  const localRef = useRef<LadderEditorHandle>(null);
  const ref = editorRef ?? localRef;
  const rootRef = useRef<HTMLDivElement>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const replay = replayController !== undefined;
  const replayRungs = useMemo(() => (replayController ? mainRungs(replayController.project) : undefined), [replayController]);

  // short panel → one-row palette (unless the player asked for the full toolbar)
  const [short, setShort] = useState(false);
  const [fullPalette, setFullPalette] = usePersistentState('plcw-ladder-full-palette', false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setShort(el.clientHeight > 0 && el.clientHeight < COMPACT_PALETTE_BELOW_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compactPalette = short && !fullPalette && !replay;

  const editorErrors = useMemo(() => {
    const own = (e: VerifyError) =>
      (e.program === '' || e.program.toLowerCase() === MAIN_PROGRAM.toLowerCase()) && (e.routine === '' || e.routine.toLowerCase() === MAIN_ROUTINE.toLowerCase());
    return [...ws.errors.filter(own), ...ws.ruleErrors.filter((e) => e.rungIndex >= 0)];
  }, [ws.errors, ws.ruleErrors]);

  const setRungs = ws.setRungs;
  const onChange = useCallback((next: Rung[]): void => setRungs(next), [setRungs]);
  const onToggleBit = useCallback(() => {
    if (!replay) onEventRef.current?.({ type: 'toggleBitUsed' });
  }, [replay]);
  const onRungTextCommit = useCallback(() => onEventRef.current?.({ type: 'neutralTextUsed' }), []);
  const exampleEntry = useMemo(() => exampleEntryFor(ws.scene, allowedInstructions), [ws.scene, allowedInstructions]);
  const justApplied = useAppliedFlash(ws.appliedAt);
  const editsState = replay ? 'none' : editsStateOf(ws.pendingReason, justApplied);

  const jump = (i: number): void => {
    const ed = ref.current;
    const rung = ws.rungs[i];
    if (!ed || !rung) return;
    ed.scrollToRung(i);
    ed.setSelection({ rungId: rung.id });
    ed.focus();
  };

  const noteUserMode = ws.noteUserMode;
  const downloadBlocked = ws.pendingReason === 'errors';
  const nErr = ws.errors.filter((e) => e.severity === 'error').length;

  return (
    <div
      ref={rootRef}
      className={cn('@container relative flex h-full min-h-0 min-w-0 flex-col bg-panel', className)}
      data-no-hotkeys=""
      data-testid="ladder-panel"
    >
      <div className="flex shrink-0 items-stretch">
        <ScrollFade className="min-w-0 flex-1">
          <OnlineToolbar
            controller={replayController ?? ws.controller}
            online
            editsState={editsState}
            {...(allowKeySwitch && !replay ? { allowKeySwitch: true } : {})}
            onModeChange={noteUserMode}
          />
        </ScrollFade>
        <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-l border-[#232e3a] bg-[#10161d] px-2" data-testid="edit-strip">
          <EditStatus ws={ws} replay={replay} />
          {actions}
          {!replay && (
            <Button
              size="xs"
              variant="ghost"
              icon={<Download size={12} />}
              onClick={() => ws.download()}
              disabled={downloadBlocked}
              title={
                downloadBlocked
                  ? `Fix the ${nErr} verification error${nErr === 1 ? '' : 's'} first — a program that does not verify cannot be downloaded (the controller would not go to Run)`
                  : 'Download the program to the controller (tag values reset), then go to Run'
              }
              data-testid="download"
            >
              <span className="hidden @4xl:inline">Download</span>
            </Button>
          )}
        </div>
      </div>
      {compactPalette && <CompactPalette editor={ref} {...(allowedInstructions ? { allowedInstructions } : {})} onExpand={() => setFullPalette(true)} />}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <LadderEditor
          ref={ref}
          rungs={replayRungs ?? ws.rungs}
          onChange={onChange}
          program={MAIN_PROGRAM}
          routine={MAIN_ROUTINE}
          controller={replayController ?? ws.controller}
          online
          readOnly={replay}
          errors={replay ? [] : editorErrors}
          {...(allowedInstructions ? { allowedInstructions } : {})}
          {...(compactPalette ? { showToolbar: false } : {})}
          {...(short && fullPalette && !replay
            ? {
                headerExtra: (
                  <button
                    type="button"
                    onClick={() => setFullPalette(false)}
                    className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold whitespace-nowrap text-slate-400 hover:bg-white/10 hover:text-white"
                    title="One-row instruction palette (more room for rungs)"
                    data-testid="palette-collapse"
                  >
                    <ChevronsDownUp size={12} /> Compact palette
                  </button>
                ),
              }
            : {})}
          onTagsChanged={ws.reverify}
          onToggleBit={onToggleBit}
          onRungTextCommit={onRungTextCommit}
          exampleEntry={exampleEntry}
          className="min-h-0 flex-1"
        />
        {!replay && <AppliedIndicator visible={justApplied} />}
      </div>
      {!replay && <ProblemList errors={ws.errors} rules={ws.ruleErrors} rungs={ws.rungs} onJump={jump} />}
    </div>
  );
}

export const LadderPanel = memo(LadderPanelImpl);
