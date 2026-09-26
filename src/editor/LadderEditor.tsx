/**
 * LadderEditor — the Studio 5000 Logix Designer-style RLL editor.
 *
 * Controlled component: `rungs` in, `onChange(rungs)` out (the parent decides whether an edit is
 * downloaded / applied online with `controller.updateRoutine`). With a controller and `online`, the
 * editor animates power flow at ~25 Hz by polling `controller.getLiveState()` and patching only the
 * visible rungs' DOM (no React re-render per frame).
 *
 * Mouse: click selects (instruction, operand, wire position, rung number); double-click edits (operand
 * → tag autocomplete, glyph/box title → mnemonic, rung number → neutral text, comment); right-click
 * opens the context menu; drag an instruction to move it; drop toolbar buttons on a wire.
 * Keyboard: arrows / Home / End / Tab navigate, Enter edits, typing starts ASCII quick entry
 * ("XIC Start_PB"), Del deletes, Ctrl+C/X/V, Ctrl+Z/Y, Ctrl+R (rung), Ctrl+T or Alt+T (toggle bit),
 * Ctrl+W or Alt+W (new tag for an undefined operand), Ctrl+D (rung comment), Alt+arrows move, F1 help,
 * Ctrl +/-/0 zoom. (Browsers reserve Ctrl+T / Ctrl+W for tabs, hence the Alt aliases.)
 *
 * Integration notes:
 *  - Controlled: keep `rungs` in the host and apply `onChange`; pass `errors` computed from those rungs.
 *  - Undo history, selection and open editors are reset when `program` / `routine` change.
 *  - Give the editor a height-constrained parent (flex column + min-h-0). Its grid / flex track must be
 *    allowed to shrink: use `minmax(0,1fr)` / `min-w-0`, otherwise the ladder's min-content width
 *    widens the page. Long rungs wrap onto continuation lines at the available width.
 *  - Mount `<Toaster/>` from @/ui once (the editor reports refusals with toasts).
 */
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Tag as TagIcon,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  FileText,
  GitBranchPlus,
  Minus,
  MessageSquareText,
  Moon,
  Captions,
  CaptionsOff,
  Pencil,
  Plus,
  Redo2,
  Replace,
  Scissors,
  Sun,
  ToggleRight,
  Trash2,
  TriangleAlert,
  Undo2,
  XCircle,
  Zap,
  ZapOff,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { INSTRUCTION_DEFS, operandCountIssue } from '@/plc/instructions';
import { NeutralTextError, instructionsOf, parseRungText, serializeRung } from '@/plc/neutralText';
import type { OperandSpec } from '@/plc/instructions/types';
import type { InstructionNode, PlcController, Rung, RungElement, VerifyError } from '@/plc/types';
import { Modal } from '@/ui/Modal';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { AutocompleteInput, CommentEditor, ContextMenu, HoverCard, RungTextEditor, type AutoItem, type CommitHow, type MenuEntry } from './EditorOverlays';
import { RoutineIcon } from './glyphs';
import { InstructionHelp } from './InstructionHelp';
import { NewTagDialog, type NewTagRequest } from './NewTagDialog';
import { INSTR_DRAG_TYPE, InstructionToolbar, type ToolbarAction } from './InstructionToolbar';
import { LD, layoutRung, nearestGap, type GapLayout, type InstrLayout, type RungLayout } from './layout';
import {
  EditHistory,
  addRung,
  addRungBefore,
  adjacentRung,
  branchLevelTarget,
  clipboardFromText,
  clipboardToText,
  copyElements,
  deleteRung,
  duplicateRung,
  findRung,
  getSeries,
  insertAt,
  insertBranch,
  insertPointFor,
  locateElement,
  moveElement,
  moveElementTo,
  moveRung,
  newInstruction,
  newRung,
  nextInstruction,
  nextOperand,
  normalizeSelection,
  parseQuickEntry,
  pasteElements,
  pasteRungs,
  removeElement,
  removeLeg,
  replaceRungFromText,
  rungIndexOf,
  selectionAfterRemoval,
  setMnemonic,
  setOperand,
  setRungComment,
  wrapInBranch,
  type InsertPoint,
  type LadderClipboard,
  type LadderSelection,
  type LegPath,
} from './ops';
import { EndRung, MarginPlate, RungMargin, RungSvg, parseGapKey, type LiveFrame, type RungBinding, type RungSvgProps } from './RungSvg';
import {
  createLiveReader,
  forceInfo,
  makeTagMeta,
  newTagCandidate,
  routinesOf,
  specOf,
  structureVersionOf,
  suggestMnemonics,
  suggestOperands,
  type LiveReader,
} from './tagTools';
import './ladder.css';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type LadderTheme = 'dark' | 'classic';

export interface LadderEditorProps {
  rungs: Rung[];
  onChange(rungs: Rung[]): void;
  program: string;
  routine: string;
  /** Controller for tag descriptions, autocomplete, live values, toggle bit & forces. */
  controller?: PlcController;
  /** Animate power flow and show live values (requires `controller`). */
  online?: boolean;
  readOnly?: boolean;
  /** Instructions the learner may use (others are locked in the palette and refused by entry). */
  allowedInstructions?: string[];
  /** Verification results (filtered to this program/routine). */
  errors?: VerifyError[];
  onSelectionChange?(sel: LadderSelection | null): void;
  className?: string;
  /** Initial theme ('dark' default); the header toggle switches it (reported by onThemeChange). */
  theme?: LadderTheme;
  onThemeChange?(theme: LadderTheme): void;
  /**
   * Compact operand labels: contacts & coils show the tag name only — no description above it, no alias base tag
   * under it (both are in the hover card, which then opens faster). The header toggle switches it (reported by
   * onCompactLabelsChange). Default false.
   */
  compactLabels?: boolean;
  onCompactLabelsChange?(compact: boolean): void;
  /** Show the instruction toolbar (default true unless readOnly). */
  showToolbar?: boolean;
  /** Show the header bar (default true). */
  showHeader?: boolean;
  initialSelection?: LadderSelection | null;
  /** Initial zoom (default 1). */
  zoom?: number;
  /** Extra content on the right of the header bar. */
  headerExtra?: ReactNode;
  /** A tag was created from the ladder (New Tag…): re-verify. */
  onTagsChanged?(): void;
  /**
   * Example ASCII entry shown by the empty-routine hint and the quick-entry placeholder, e.g.
   * 'XIC Switch_0' (use tags that exist in this plant). Default: an input alias tag of the controller.
   */
  exampleEntry?: string;
  /** Toggle Bit flipped a BOOL operand (Ctrl/Alt+T or the context menu), after the write. */
  onToggleBit?(operand: string): void;
  /** A rung was accepted from the neutral-text rung editor ("Edit Rung as Text"). */
  onRungTextCommit?(rungIndex: number, text: string): void;
  /**
   * Tags to highlight (e.g. the tag behind a failing test in a replay): every instruction whose operand names one of
   * them — or a member / bit of it — is marked. Case-insensitive; pass alias and address to match both spellings.
   */
  highlight?: string[];
  ref?: Ref<LadderEditorHandle>;
}

export interface LadderEditorHandle {
  focus(): void;
  getSelection(): LadderSelection | null;
  setSelection(sel: LadderSelection | null): void;
  /** Insert an instruction at the selection (like clicking the toolbar). */
  insertInstruction(mnemonic: string): void;
  addRung(): void;
  addBranch(): void;
  addBranchLevel(): void;
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  /** Open the ASCII quick-entry box at the selection. */
  startQuickEntry(text?: string): void;
  /** Edit the selected operand (or the first operand of the selected instruction). */
  editOperand(): void;
  editRungText(rungId?: string): void;
  editRungComment(rungId?: string): void;
  /** Open the context menu for the current selection. */
  openContextMenu(): void;
  showHelp(mnemonic?: string): void;
  /** Open the New Tag dialog for the selected (undefined) operand. */
  newTag(): void;
  setZoom(zoom: number): void;
  scrollToRung(index: number): void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type EditState =
  /**
   * `seq` makes every operand edit a fresh editor instance (Tab onto the same operand re-arms it).
   * `fill`: the operands of a just-inserted instruction are being filled in — Enter moves on to the
   * next unset ('?') operand of the rung instead of closing.
   */
  | { kind: 'operand'; rungId: string; elementId: string; index: number; initial?: string; seq: number; fill?: boolean }
  | { kind: 'quick'; rungId: string; point: InsertPoint; sel: LadderSelection; initial: string }
  | { kind: 'mnemonic'; rungId: string; elementId: string }
  | { kind: 'rungText'; rungId: string }
  | { kind: 'comment'; rungId: string };

type HitTarget =
  | { type: 'rung' | 'rungnum' | 'comment' | 'marker'; rungId: string }
  | { type: 'element'; rungId: string; elementId: string; sym: boolean }
  | { type: 'operand'; rungId: string; elementId: string; operandIndex: number }
  | { type: 'wire'; rungId: string; legPath?: LegPath; index: number };

interface DropTarget {
  rungId: string;
  gap: GapLayout;
}

/** Shared by every editor instance (copy in one routine, paste in another). */
let CLIPBOARD: LadderClipboard | null = null;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const LIVE_INTERVAL_MS = 38; // ≈ 26 Hz
const OFFLINE_FRAME: LiveFrame = { online: false, running: false, elements: undefined, reader: undefined };
const lower = (s: string): string => s.toLowerCase();
let EDIT_SEQ = 0;

function operandEdit(rungId: string, elementId: string, index: number, initial?: string, fill = false): EditState {
  EDIT_SEQ += 1;
  return { kind: 'operand', rungId, elementId, index, seq: EDIT_SEQ, ...(initial !== undefined ? { initial } : {}), ...(fill ? { fill: true } : {}) };
}

/**
 * The next unset ('?') operand after `index` of an instruction: in the same instruction, or (`sameRung`)
 * anywhere later in the same rung.
 */
function nextUnsetOperand(rungs: readonly Rung[], rungId: string, elementId: string, index: number, sameRung: boolean): LadderSelection | undefined {
  let cur: LadderSelection | undefined = { rungId, elementId, operandIndex: index };
  for (let guard = 0; guard < 500; guard++) {
    const next: LadderSelection | undefined = nextOperand(rungs, cur, 1);
    if (!next?.elementId || next.operandIndex === undefined || next.rungId !== rungId) return undefined;
    if (!sameRung && next.elementId !== elementId) return undefined;
    if (next.elementId === cur?.elementId && next.operandIndex === cur.operandIndex) return undefined;
    if (findInstr(rungs, next.rungId, next.elementId)?.operands[next.operandIndex] === '?') return next;
    cur = next;
  }
  return undefined;
}

/** A typed number can be this operand (a literal: preset, source, expression…) — not a tag-only operand like a TIMER. */
function takesLiteral(spec: OperandSpec | undefined): boolean {
  if (!spec) return true;
  return spec.kind === 'num' || spec.kind === 'int' || spec.kind === 'scalar' || spec.kind === 'display' || spec.kind === 'imm' || spec.kind === 'expr' || spec.kind === 'any';
}

/** Default empty-routine example: XIC on an input alias of the controller (a tag that exists here). */
function defaultExampleEntry(controller: PlcController | undefined): string {
  let input: string | undefined;
  try {
    input = controller?.tags.listAll().find((t) => t.dataType === 'BOOL' && t.aliasFor !== undefined && /:I\./.test(t.aliasFor))?.name;
  } catch {
    input = undefined;
  }
  return `XIC ${input ?? 'Start_PB'}`;
}

/** Character offsets of the instructions of a neutral-text rung (mnemonics outside operand lists). */
function instructionPositions(text: string): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[A-Za-z_]/.test(ch)) {
      out.push(i);
      while (i + 1 < text.length && /[A-Za-z0-9_]/.test(text[i + 1]!)) i++;
    }
  }
  return out;
}

/**
 * Validate a rung typed as neutral text like Studio's ASCII editor: syntax, known (and allowed)
 * instructions, operand counts and empty operands. Undefined tags are accepted (they are verify errors).
 */
export function checkRungText(text: string, allowed?: ReadonlySet<string>): { message: string; position?: number } | null {
  let els: RungElement[];
  try {
    els = parseRungText(text);
  } catch (err) {
    if (err instanceof NeutralTextError) return { message: err.message, position: err.position };
    return { message: err instanceof Error ? err.message : String(err) };
  }
  const list = instructionsOf(els);
  const pos = instructionPositions(text);
  for (let k = 0; k < list.length; k++) {
    const i = list[k]!;
    const at = pos[k];
    const where = at !== undefined ? { position: at } : {};
    const def = INSTRUCTION_DEFS[i.op];
    if (!def) return { message: `Unknown instruction '${i.op}'.`, ...where };
    if (allowed && !allowed.has(i.op)) return { message: `${i.op} is locked in this mission.`, ...where };
    const count = operandCountIssue(def, i.operands.length);
    if (count) return { message: count, ...where };
    const empty = i.operands.findIndex((o) => o.trim() === '');
    if (empty >= 0) {
      const name = specOf(i.op, empty, i.operands)?.name ?? `operand ${empty + 1}`;
      return { message: `${i.op}: ${name} is empty (type ? for "not specified yet").`, ...where };
    }
  }
  return null;
}

function hitTarget(target: EventTarget | null): HitTarget | null {
  if (!(target instanceof Element)) return null;
  const svg = target.closest('svg[data-rung]');
  if (!svg) return null;
  const rungId = svg.getAttribute('data-rung')!;
  if (target.closest('[data-marker]')) return { type: 'marker', rungId };
  if (target.closest('[data-rungnum]')) return { type: 'rungnum', rungId };
  const el = target.closest('[data-el]');
  if (el) {
    const elementId = el.getAttribute('data-el')!;
    const op = target.closest('[data-op]');
    if (op) return { type: 'operand', rungId, elementId, operandIndex: Number(op.getAttribute('data-op')) };
    return { type: 'element', rungId, elementId, sym: target.closest('[data-sym]') !== null };
  }
  const gap = target.closest('[data-gap]');
  if (gap) {
    const g = parseGapKey(gap.getAttribute('data-gap') ?? '');
    if (g) return g.legPath ? { type: 'wire', rungId, legPath: g.legPath, index: g.index } : { type: 'wire', rungId, index: g.index };
  }
  if (target.closest('[data-comment]')) return { type: 'comment', rungId };
  return { type: 'rung', rungId };
}

function tagSignature(c: PlcController): string {
  let s = `${structureVersionOf(c)}`;
  for (const t of c.tags.listAll()) s += `|${t.name}:${t.description ?? ''}:${t.aliasFor ?? ''}`;
  return s;
}

function labelsOf(rungs: readonly Rung[]): string[] {
  const out = new Set<string>();
  for (const r of rungs) for (const i of instructionsOf(r.elements)) if (i.op === 'LBL' && i.operands[0] && i.operands[0] !== '?') out.add(i.operands[0]);
  return [...out];
}

function findInstr(rungs: readonly Rung[], rungId: string, elementId: string): InstructionNode | undefined {
  const r = findRung(rungs, rungId);
  const loc = r && locateElement(r.elements, elementId);
  return loc?.element.kind === 'instr' ? loc.element : undefined;
}

/** Operand a Toggle Bit / Force acts on for the selection. */
function dataOperandOf(instr: InstructionNode | undefined, operandIndex: number | undefined): string | undefined {
  if (!instr) return undefined;
  const i = operandIndex ?? 0;
  const t = instr.operands[i];
  return t && t !== '?' ? t : undefined;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface RungRowProps extends RungSvgProps {
  overlay?: ReactNode;
  observe(el: HTMLElement, id: string): () => void;
}

const RungRow = memo(function RungRow({ overlay, observe, ...svg }: RungRowProps) {
  const id = svg.rung.id;
  const h = Math.ceil(svg.layout.height * svg.zoom);
  const refCb = useCallback((el: HTMLDivElement | null) => (el ? observe(el, id) : undefined), [observe, id]);
  const s = svg.selection;
  const rungSelected = s !== undefined && !s.elementId && s.wireIndex === undefined && !s.legPath;
  return (
    <div
      ref={refCb}
      className="ld-row"
      data-rung-row={id}
      style={{ height: h, containIntrinsicSize: `auto ${h}px`, ...(overlay ? { contentVisibility: 'visible', zIndex: 20 } : {}) }}
    >
      <RungSvg {...svg} separateMargin />
      {/* rung number & verify marker, pinned to the left edge when the routine scrolls sideways */}
      <div className="ld-margin-pin">
        <RungMargin rungId={id} index={svg.index} layout={svg.layout} zoom={svg.zoom} selected={rungSelected} {...(svg.errors ? { errors: svg.errors } : {})} />
      </div>
      {overlay}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Small chrome pieces
// ---------------------------------------------------------------------------

function ChromeButton({
  label,
  onClick,
  disabled,
  children,
  active,
  pressed,
  className,
  testId,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  children: ReactNode;
  active?: boolean;
  /** Toggle button state (aria-pressed). */
  pressed?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 text-[var(--ld-chrome-text)] transition-colors',
        'hover:bg-[var(--ld-ov-active)] focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent',
        active && 'bg-[var(--ld-ov-active)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function K({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded border border-[var(--ld-chrome-border)] bg-[var(--ld-chrome-2)] px-1 font-mono text-[9.5px] text-[var(--ld-chrome-text)]">
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Overlays bound to the editor
// ---------------------------------------------------------------------------

function OperandOverlay({
  instr,
  node,
  index,
  initial,
  zoom,
  controller,
  program,
  routines,
  labels,
  onCommit,
  onCancel,
  maxLeft,
}: {
  instr: InstructionNode;
  node: InstrLayout;
  index: number;
  initial?: string;
  zoom: number;
  controller?: PlcController;
  program: string;
  routines: string[];
  labels: string[];
  onCommit(text: string, how: CommitHow, item?: AutoItem): void;
  onCancel(): void;
  /** Right-most left position that keeps the box inside the viewport. */
  maxLeft: number;
}) {
  const current = instr.operands[index] ?? '?';
  const start = initial ?? (current === '?' ? '' : current);
  const [text, setText] = useState(start);
  // unchanged text → show every compatible tag (the current one is just pre-selected)
  const query = text === start && initial === undefined ? '' : text;
  const spec = specOf(instr.op, index, instr.operands);
  const o = node.operands.find((x) => x.index === index);
  const items: AutoItem[] = useMemo(() => {
    const list: AutoItem[] = suggestOperands(controller, program, spec, query, { routines, labels, limit: 60 }).map((s) => ({
      key: s.operand,
      value: s.operand,
      primary: s.operand,
      secondary: [s.description, s.aliasFor ? `→ ${s.aliasFor}` : undefined].filter(Boolean).join('  ·  ') || undefined,
      right: s.dataType,
      ...(s.expandable ? { expandable: true } : {}),
      ...(s.scope && s.scope !== 'Controller' ? { badge: 'Local' } : {}),
    }));
    // a valid name that is not a tag yet: offer to create it (explicit choice, never a silent swap)
    const typed = query.trim();
    const cand = typed && !list.some((i) => lower(i.value) === lower(typed)) ? newTagCandidate(controller, typed, program, spec) : undefined;
    if (cand) {
      list.unshift({
        key: '__newtag',
        value: typed,
        primary: `New tag '${cand.name}'…`,
        secondary: `Use ${typed} here and create it`,
        right: `${cand.dataType}${cand.dims ? `[${cand.dims}]` : ''}`,
        action: 'newTag',
        accent: true,
      });
    }
    return list;
  }, [controller, program, spec, query, routines, labels]);
  if (!o) return null;
  const width = Math.max(260, Math.min(360, o.hit.w * zoom + 90));
  const left = Math.min(o.anchor === 'middle' ? o.x * zoom - width / 2 : (o.hit.x + o.hit.w) * zoom - width + 26, maxLeft);
  const types = spec ? spec.types.join(' | ') : 'operand';
  return (
    <AutocompleteInput
      value={text}
      onChange={setText}
      items={items}
      enterTakesPrefixMatch
      selectAll={initial === undefined}
      placeholder={spec?.kind === 'display' || spec?.kind === 'imm' ? 'Enter a value' : 'Type a tag name…'}
      header={
        <span>
          <b className="text-[var(--ld-ov-text)]">
            {instr.op} · {spec?.name ?? `Operand ${index}`}
          </b>{' '}
          <span className="font-mono">{types}</span>
        </span>
      }
      footer={(takes) => {
        // what Enter does right now: the highlighted row, else the first prefix match, else the typed text
        return (
          <span>
            <b>Enter</b>{' '}
            {takes?.action === 'newTag' ? (
              'new tag'
            ) : takes ? (
              <>
                {takes.expandable ? 'open' : 'use'} <span className="font-mono">{takes.value}</span>
              </>
            ) : (
              'as typed'
            )}{' '}
            · <b>Tab</b> complete · <b>↑↓</b> pick · <b>Esc</b> cancel
            {items.some((i) => i.expandable) ? ' · ▸ members: type “.”' : ''}
          </span>
        );
      }}
      onCommit={(v, how, item) => onCommit(v, how, item)}
      onCancel={onCancel}
      ariaLabel={`${instr.op} ${spec?.name ?? 'operand'}`}
      style={{ left: Math.max(4, left), top: o.hit.y * zoom - 5, width }}
    />
  );
}

/** Figure out what the last token of a quick-entry line is (mnemonic or n-th operand of an instruction). */
function analyzeQuick(text: string): { mode: 'mnemonic' | 'operand' | 'none'; token: string; op?: string; index?: number; start: number } {
  if (/\(/.test(text)) return { mode: 'none', token: '', start: text.length };
  const m = /([^\s,]*)$/.exec(text)!;
  const token = m[1] ?? '';
  const start = text.length - token.length;
  const prior = text.slice(0, start).split(/[\s,]+/).filter(Boolean);
  let op: string | undefined;
  let count = 0;
  let max = 0;
  for (const tok of prior) {
    const up = tok.toUpperCase();
    if (up === 'BST' || up === 'NXB' || up === 'BND') {
      op = undefined;
      continue;
    }
    const def = INSTRUCTION_DEFS[up];
    if (def && !(op && count < max && !/^[A-Z]{2,4}$/.test(tok))) {
      op = up;
      count = 0;
      max = def.variadic ? 99 : def.operands.length;
    } else if (op && count < max) count++;
  }
  if (op && count < max) return { mode: 'operand', token, op, index: count, start };
  return { mode: 'mnemonic', token, start };
}

function QuickEntryOverlay({
  initial,
  example,
  style,
  controller,
  program,
  allowed,
  routines,
  labels,
  onCommit,
  onCancel,
}: {
  initial: string;
  /** Example entry for the placeholder (a tag of this plant). */
  example: string;
  style: CSSProperties;
  controller?: PlcController;
  program: string;
  allowed?: readonly string[];
  routines: string[];
  labels: string[];
  /** Returns an error message to keep the box open. */
  onCommit(text: string): string | null;
  onCancel(): void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const ctx = analyzeQuick(text);
  const items: AutoItem[] = useMemo(() => {
    if (ctx.mode === 'mnemonic') {
      const allow = allowed ? new Set(allowed.map((a) => a.toUpperCase())) : undefined;
      return suggestMnemonics(ctx.token, allowed, 10).map((d) => ({
        key: d.mnemonic,
        value: d.mnemonic,
        primary: d.mnemonic,
        secondary: d.name,
        right: d.category,
        ...(allow && !allow.has(d.mnemonic) ? { disabled: true, badge: 'locked' } : {}),
      }));
    }
    if (ctx.mode === 'operand') {
      const spec = specOf(ctx.op!, ctx.index!, []);
      return suggestOperands(controller, program, spec, ctx.token, { routines, labels, limit: 30 }).map((s) => ({
        key: s.operand,
        value: s.operand,
        primary: s.operand,
        secondary: s.description,
        right: s.dataType,
        ...(s.expandable ? { expandable: true } : {}),
      }));
    }
    return [];
  }, [ctx.mode, ctx.token, ctx.op, ctx.index, controller, program, allowed, routines, labels]);
  const opName = ctx.mode === 'operand' ? specOf(ctx.op!, ctx.index!, [])?.name : undefined;
  return (
    <AutocompleteInput
      value={text}
      onChange={(v) => {
        setText(v);
        setError(null);
      }}
      items={items}
      error={error}
      placeholder={`${example}  ·  TON Timer1 5000  ·  BST … NXB … BND`}
      header={
        ctx.mode === 'operand' ? (
          <span>
            <b className="text-[var(--ld-ov-text)]">{ctx.op}</b> · {opName ?? `operand ${ctx.index}`}
          </span>
        ) : (
          <span>
            <b className="text-[var(--ld-ov-text)]">ASCII quick entry</b> — type a mnemonic, then its operands
          </span>
        )
      }
      footer={
        <span>
          <b>Enter</b> insert · <b>Esc</b> cancel · neutral text like <span className="font-mono">XIC(A)OTE(B)</span> works too
        </span>
      }
      onAccept={(item, how) => {
        if (how === 'enter' && item.value.toLowerCase() === ctx.token.toLowerCase() && !item.expandable) {
          const err = onCommit(text);
          if (err) setError(err);
          return;
        }
        const before = text.slice(0, ctx.start);
        setText(`${before}${item.value}${item.expandable ? '.' : ' '}`);
        setError(null);
      }}
      onCommit={(v, how) => {
        if (how === 'blur') {
          onCancel();
          return;
        }
        const err = onCommit(v);
        if (err) {
          const hint = ctx.mode === 'mnemonic' && items.some((i) => !i.disabled) && /Unknown instruction/.test(err) ? ' Press Tab to complete it.' : '';
          setError(`${err}${hint}`);
          return false;
        }
        return undefined;
      }}
      onCancel={onCancel}
      commitOnBlur
      ariaLabel="ASCII instruction entry"
      style={style}
    />
  );
}

function MnemonicOverlay({ instr, style, allowed, onCommit, onCancel }: { instr: InstructionNode; style: CSSProperties; allowed?: readonly string[]; onCommit(op: string): string | null; onCancel(): void }) {
  const [text, setText] = useState(instr.op);
  const [error, setError] = useState<string | null>(null);
  const items: AutoItem[] = useMemo(() => {
    const allow = allowed ? new Set(allowed.map((a) => a.toUpperCase())) : undefined;
    const q = text.trim().toUpperCase() === instr.op ? '' : text;
    const cur = INSTRUCTION_DEFS[instr.op];
    const list = suggestMnemonics(q, allowed, 40);
    if (!q && cur) {
      const score = (d: (typeof list)[number]): number => (d.category === cur.category ? 2 : 0) + (d.display === cur.display ? 1 : 0);
      list.sort((a, b) => score(b) - score(a));
    }
    return list.slice(0, 12).map((d) => ({
      key: d.mnemonic,
      value: d.mnemonic,
      primary: d.mnemonic,
      secondary: d.name,
      right: d.category,
      ...(allow && !allow.has(d.mnemonic) ? { disabled: true, badge: 'locked' } : {}),
    }));
  }, [text, instr.op, allowed]);
  return (
    <AutocompleteInput
      value={text}
      onChange={(v) => {
        setText(v);
        setError(null);
      }}
      items={items}
      selectAll
      error={error}
      header={<b className="text-[var(--ld-ov-text)]">Change instruction</b>}
      onCommit={(v, how) => {
        if (how === 'blur') {
          onCancel();
          return;
        }
        const err = onCommit(v.trim().toUpperCase());
        if (err) {
          setError(/Unknown instruction/.test(err) && items.some((i) => !i.disabled) ? `${err} Press Tab to complete, or pick from the list.` : err);
          return false;
        }
        return undefined;
      }}
      onCancel={onCancel}
      ariaLabel="Instruction mnemonic"
      style={style}
    />
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function LadderEditor(props: LadderEditorProps) {
  const {
    rungs,
    program,
    routine,
    controller,
    readOnly = false,
    allowedInstructions,
    errors,
    className,
  } = props;
  const online = props.online === true && controller !== undefined;
  const showValues = online;
  const highlightKey = (props.highlight ?? []).map((t) => t.toLowerCase()).join('|');
  const highlight = useMemo(() => (highlightKey ? new Set(highlightKey.split('|')) : undefined), [highlightKey]);

  const [theme, setThemeState] = useState<LadderTheme>(props.theme ?? 'dark');
  const [compactLabels, setCompactState] = useState(props.compactLabels === true);
  useEffect(() => {
    if (props.compactLabels !== undefined) setCompactState(props.compactLabels);
  }, [props.compactLabels]);
  const compactRef = useRef(compactLabels);
  compactRef.current = compactLabels;
  useEffect(() => {
    if (props.theme) setThemeState(props.theme);
  }, [props.theme]);
  const [zoom, setZoomState] = useState(props.zoom ?? 1);
  const [sel, setSel] = useState<LadderSelection | null>(props.initialSelection ?? null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  const [helpOp, setHelpOp] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const dropRef = useRef<DropTarget | null>(null);
  dropRef.current = drop;
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string } | null>(null);
  const [viewW, setViewW] = useState(960);
  const [tagVersion, setTagVersion] = useState(0);
  const [forcesVersion, setForcesVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const [faulted, setFaulted] = useState(false);
  const [, setHistVersion] = useState(0);
  const [newTag, setNewTag] = useState<NewTagRequest | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rungsRef = useRef(rungs);
  rungsRef.current = rungs;
  const selRef = useRef(sel);
  selRef.current = sel;
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  /** Current editor overlay (read by deferred callbacks — never trust a render-time closure there). */
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const modalOpenRef = useRef(false);
  modalOpenRef.current = newTag !== null || helpOp !== null;
  const onTagsChangedRef = useRef(props.onTagsChanged);
  onTagsChangedRef.current = props.onTagsChanged;
  const onToggleBitRef = useRef(props.onToggleBit);
  onToggleBitRef.current = props.onToggleBit;
  const onRungTextCommitRef = useRef(props.onRungTextCommit);
  onRungTextCommitRef.current = props.onRungTextCommit;
  const historyRef = useRef(new EditHistory<Rung[]>({ limit: 200 }));
  const registryRef = useRef(new Map<string, RungBinding>());
  const visibleRef = useRef(new Set<string>());
  const ioRef = useRef<IntersectionObserver | null>(null);
  const frameRef = useRef<LiveFrame>(OFFLINE_FRAME);
  const dirtyRef = useRef(true);
  const runningRef = useRef(false);
  const readerRef = useRef<LiveReader | undefined>(undefined);
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverKey = useRef('');
  const dragRef = useRef<{ x: number; y: number; rungId: string; elementId: string; active: boolean; label: string } | null>(null);
  const pasteHandled = useRef(false);
  const prevRungsRef = useRef(rungs);

  const allowedSet = useMemo(() => (allowedInstructions ? new Set(allowedInstructions.map((a) => a.toUpperCase())) : undefined), [allowedInstructions]);

  // ---------------------------------------------------------------- controller events
  useEffect(() => {
    if (!controller) return;
    let sig = tagSignature(controller);
    const st = controller.getStatus();
    runningRef.current = st.running;
    setRunning(st.running);
    setFaulted(st.mode === 'FAULTED');
    return controller.subscribe((e) => {
      if (e.type === 'mode') {
        const now = controller.getStatus();
        runningRef.current = now.running;
        setRunning(now.running);
        setFaulted(now.mode === 'FAULTED');
      } else if (e.type === 'forces') {
        setForcesVersion((v) => v + 1);
      } else if (e.type === 'project') {
        const s = tagSignature(controller);
        if (s !== sig) {
          sig = s;
          setTagVersion((v) => v + 1);
        }
      }
      dirtyRef.current = true;
    });
  }, [controller]);

  // ---------------------------------------------------------------- layout
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => setViewW(Math.max(320, el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tagMeta = useMemo(() => makeTagMeta(controller, program), [controller, program, tagVersion]);
  const cacheRef = useRef(new WeakMap<Rung, { key: string; layout: RungLayout }>());
  const baseW = Math.floor(viewW / zoom);
  const layouts = useMemo(() => {
    const cache = cacheRef.current;
    // every rung is laid out at the viewport width: long rungs wrap onto continuation lines (Studio
    // 5000 style) instead of widening the whole routine; only an element wider than the viewport widens
    // its own rung (the pinned margin keeps rung numbers visible then)
    const key = `${baseW}|${showValues}|${tagVersion}|${compactLabels}`;
    return rungs.map((r) => {
      const c = cache.get(r);
      if (c && c.key === key) return c.layout;
      const layout = layoutRung(r, { width: baseW, wrap: true, ...(tagMeta ? { tagMeta } : {}), showValues, ...(compactLabels ? { showDescriptions: false, showAliases: false } : {}) });
      cache.set(r, { key, layout });
      return layout;
    });
  }, [rungs, baseW, showValues, tagVersion, tagMeta, compactLabels]);
  const contentW = layouts.reduce((w, l) => Math.max(w, l.width), baseW) * zoom;
  const layoutById = useMemo(() => {
    const m = new Map<string, { layout: RungLayout; index: number }>();
    rungs.forEach((r, i) => m.set(r.id, { layout: layouts[i]!, index: i }));
    return m;
  }, [rungs, layouts]);

  // ---------------------------------------------------------------- errors per rung (stable arrays)
  const errCache = useRef(new Map<string, { key: string; list: VerifyError[] }>());
  const errorsByRung = useMemo(() => {
    const out = new Map<string, VerifyError[]>();
    for (const e of errors ?? []) {
      if (lower(e.program) !== lower(program) || lower(e.routine) !== lower(routine)) continue;
      const r = rungs[e.rungIndex];
      if (!r) continue;
      const list = out.get(r.id) ?? [];
      list.push(e);
      out.set(r.id, list);
    }
    const stable = new Map<string, VerifyError[]>();
    for (const [id, list] of out) {
      const key = list.map((e) => `${e.severity}${e.elementId}${e.operandIndex}${e.message}`).join('\n');
      const c = errCache.current.get(id);
      if (c && c.key === key) stable.set(id, c.list);
      else {
        errCache.current.set(id, { key, list });
        stable.set(id, list);
      }
    }
    return stable;
  }, [errors, program, routine, rungs]);
  const errorCount = useMemo(() => {
    let e = 0;
    let w = 0;
    for (const list of errorsByRung.values()) for (const x of list) x.severity === 'error' ? e++ : w++;
    return { e, w };
  }, [errorsByRung]);

  // ---------------------------------------------------------------- forces
  const forceOf = useMemo(() => {
    if (!controller || Object.keys(controller.getForces()).length === 0) return undefined;
    const cache = new Map<string, boolean | number | undefined>();
    return (op: string) => {
      if (!cache.has(op)) cache.set(op, forceInfo(controller, op, program).forced);
      return cache.get(op);
    };
  }, [controller, program, forcesVersion, tagVersion]);

  // ---------------------------------------------------------------- live animation
  const register = useCallback((id: string, b: RungBinding | null) => {
    const reg = registryRef.current;
    if (b) {
      reg.set(id, b);
      b.apply(frameRef.current);
    } else reg.delete(id);
  }, []);

  const observe = useCallback((el: HTMLElement, id: string) => {
    if (typeof IntersectionObserver === 'undefined') {
      visibleRef.current.add(id);
      return () => visibleRef.current.delete(id);
    }
    if (!ioRef.current) {
      ioRef.current = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            const rid = en.target.getAttribute('data-rung-row');
            if (!rid) continue;
            if (en.isIntersecting) {
              visibleRef.current.add(rid);
              registryRef.current.get(rid)?.apply(frameRef.current);
            } else visibleRef.current.delete(rid);
          }
        },
        { rootMargin: '240px 0px' },
      );
    }
    ioRef.current.observe(el);
    return () => {
      ioRef.current?.unobserve(el);
      visibleRef.current.delete(id);
    };
  }, []);

  useEffect(() => () => ioRef.current?.disconnect(), []);

  useEffect(() => {
    const reg = registryRef.current;
    if (!controller || !online) {
      readerRef.current = undefined;
      frameRef.current = OFFLINE_FRAME;
      for (const b of reg.values()) b.apply(OFFLINE_FRAME);
      return;
    }
    const reader = createLiveReader(controller, program);
    readerRef.current = reader;
    let raf = 0;
    let last = -1e9;
    let lastVer = -1;
    dirtyRef.current = true;
    const tick = (t: number): void => {
      raf = requestAnimationFrame(tick);
      if (t - last < LIVE_INTERVAL_MS) return;
      const ver = controller.tags.version;
      if (ver === lastVer && !dirtyRef.current) return;
      last = t;
      lastVer = ver;
      dirtyRef.current = false;
      const live = controller.getLiveState(program, routine);
      const frame: LiveFrame = { online: true, running: runningRef.current, elements: live?.elements, reader };
      frameRef.current = frame;
      for (const id of visibleRef.current) reg.get(id)?.apply(frame);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [controller, online, program, routine]);

  // ---------------------------------------------------------------- selection bookkeeping
  useEffect(() => {
    const prev = prevRungsRef.current;
    prevRungsRef.current = rungs;
    if (prev === rungs) return;
    setSel((s) => normalizeSelection(rungs, s, prev));
    setEditing((ed) => {
      if (!ed) return ed;
      if (!findRung(rungs, ed.rungId)) return null;
      if ((ed.kind === 'operand' || ed.kind === 'mnemonic') && !findInstr(rungs, ed.rungId, ed.elementId)) return null;
      return ed;
    });
  }, [rungs]);

  // another routine in the same editor instance: its undo history, selection and editors do not apply
  const routineKey = `${program}\u0000${routine}`;
  const routineKeyRef = useRef(routineKey);
  useLayoutEffect(() => {
    if (routineKeyRef.current === routineKey) return;
    routineKeyRef.current = routineKey;
    historyRef.current.clear();
    setHistVersion((v) => v + 1);
    setSel(null);
    selRef.current = null;
    setEditing(null);
    setMenu(null);
    setNewTag(null);
  }, [routineKey]);

  const onSelectionChange = props.onSelectionChange;
  useEffect(() => {
    onSelectionChange?.(sel);
  }, [sel, onSelectionChange]);

  // describe the selection for screen readers & the status bar
  const selectionInfo = useMemo(() => {
    if (!sel) return 'No selection';
    const i = rungIndexOf(rungs, sel.rungId);
    if (i < 0) return 'No selection';
    const base = `Rung ${i}`;
    if (sel.elementId) {
      const r = rungs[i]!;
      const loc = locateElement(r.elements, sel.elementId);
      if (!loc) return base;
      if (loc.element.kind === 'branch') return `${base} · Branch (${loc.element.legs.length} levels)`;
      const def = INSTRUCTION_DEFS[loc.element.op];
      const opTxt = sel.operandIndex !== undefined ? ` · ${specOf(loc.element.op, sel.operandIndex, loc.element.operands)?.name ?? 'Operand'} = ${loc.element.operands[sel.operandIndex] ?? '?'}` : '';
      return `${base} · ${loc.element.op}(${loc.element.operands.join(',')})${def ? ` — ${def.name}` : ''}${opTxt}`;
    }
    if (sel.wireIndex !== undefined) return `${base} · wire position ${sel.wireIndex}${sel.legPath ? ` (branch level ${sel.legPath.leg})` : ''} — type to insert`;
    if (sel.legPath) return `${base} · branch level ${sel.legPath.leg}`;
    return `${base}${rungs[i]!.comment ? ` · “${rungs[i]!.comment!.split('\n')[0]}”` : ''}`;
  }, [sel, rungs]);

  // scroll the selection into view
  useEffect(() => {
    if (!sel) return;
    const root = scrollRef.current;
    const row = root?.querySelector<HTMLElement>(`[data-rung-row="${CSS.escape(sel.rungId)}"]`);
    if (!row) return;
    const target = (sel.elementId && row.querySelector<Element>(`[data-el="${CSS.escape(sel.elementId)}"]`)) || row;
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [sel]);

  // ---------------------------------------------------------------- editing core
  const focusEditor = useCallback(() => scrollRef.current?.focus({ preventScroll: true }), []);

  const commit = useCallback((next: Rung[], opts: { coalesce?: string; select?: LadderSelection | null } = {}) => {
    if (readOnlyRef.current) return;
    const cur = rungsRef.current;
    if (next !== cur) {
      historyRef.current.record(cur, opts.coalesce);
      rungsRef.current = next;
      onChangeRef.current(next);
      setHistVersion((v) => v + 1);
    }
    if (opts.select !== undefined) setSel(opts.select);
  }, []);

  const undo = useCallback(() => {
    if (readOnlyRef.current) return;
    const prev = historyRef.current.undo(rungsRef.current);
    if (!prev) return;
    rungsRef.current = prev;
    onChangeRef.current(prev);
    setHistVersion((v) => v + 1);
    setEditing(null);
  }, []);

  const redo = useCallback(() => {
    if (readOnlyRef.current) return;
    const next = historyRef.current.redo(rungsRef.current);
    if (!next) return;
    rungsRef.current = next;
    onChangeRef.current(next);
    setHistVersion((v) => v + 1);
    setEditing(null);
  }, []);

  const isAllowed = useCallback((op: string) => !allowedSet || allowedSet.has(op.toUpperCase()), [allowedSet]);

  const disallowedIn = useCallback(
    (els: RungElement[]): string | undefined => {
      if (!allowedSet) return undefined;
      const bad = instructionsOf(els).find((i) => !allowedSet.has(i.op));
      return bad?.op;
    },
    [allowedSet],
  );

  /** The rung to act on (selected, else last; creates one in an empty routine). */
  const ensureRung = useCallback((): { rungs: Rung[]; rung: Rung } => {
    const rs = rungsRef.current;
    const s = selRef.current;
    const r = (s && findRung(rs, s.rungId)) || rs[rs.length - 1];
    if (r) return { rungs: rs, rung: r };
    const nr = newRung();
    return { rungs: [nr], rung: nr };
  }, []);

  const insertInstruction = useCallback(
    (mnemonic: string) => {
      if (readOnlyRef.current) return;
      const op = mnemonic.toUpperCase();
      if (!isAllowed(op)) {
        toast({ tone: 'warning', title: `${op} is locked`, body: 'This instruction is not available in this mission yet.' });
        return;
      }
      const { rungs: rs, rung } = ensureRung();
      const point = insertPointFor(rung, selRef.current, op);
      const ins = newInstruction(op);
      const next = insertAt(rs, point, ins);
      const firstMissing = ins.operands.findIndex((o) => o === '?');
      commit(next, { select: ins.operands.length > 0 ? { rungId: rung.id, elementId: ins.id, operandIndex: Math.max(0, firstMissing) } : { rungId: rung.id, elementId: ins.id } });
      if (ins.operands.length > 0) setEditing(operandEdit(rung.id, ins.id, Math.max(0, firstMissing), undefined, true));
    },
    [commit, ensureRung, isAllowed],
  );

  const addRungAfterSel = useCallback(
    (where: 'after' | 'before' = 'after') => {
      if (readOnlyRef.current) return;
      const rs = rungsRef.current;
      const s = selRef.current;
      const res = where === 'before' && s ? addRungBefore(rs, s.rungId) : addRung(rs, s?.rungId);
      commit(res.rungs, { select: { rungId: res.rung.id } });
    },
    [commit],
  );

  const addBranch = useCallback(() => {
    if (readOnlyRef.current) return;
    const { rungs: rs, rung } = ensureRung();
    const s = selRef.current;
    if (s?.rungId === rung.id && s.elementId) {
      const res = wrapInBranch(rs, rung.id, s.elementId);
      if (res.branchId) {
        commit(res.rungs, { select: { rungId: rung.id, legPath: { branchId: res.branchId, leg: 1 }, wireIndex: 0 } });
        return;
      }
    }
    const point = s?.rungId === rung.id ? insertPointFor(rung, s, 'XIC') : insertPointFor(rung, { rungId: rung.id }, 'XIC');
    const res = insertBranch(rs, point);
    commit(res.rungs, { select: { rungId: rung.id, legPath: { branchId: res.branchId, leg: 0 }, wireIndex: 0 } });
  }, [commit, ensureRung]);

  const addLevel = useCallback(() => {
    if (readOnlyRef.current) return;
    const s = selRef.current;
    const rs = rungsRef.current;
    const rung = s && findRung(rs, s.rungId);
    if (!rung || !s) {
      toast({ tone: 'info', title: 'Select a branch first', body: 'Add Branch Level adds a parallel leg to the selected branch.' });
      return;
    }
    let branchId: string | undefined;
    let after: number | undefined;
    if (s.elementId) {
      const loc = locateElement(rung.elements, s.elementId);
      if (loc?.element.kind === 'branch') branchId = loc.element.id;
      else if (loc?.legPath) {
        branchId = loc.legPath.branchId;
        after = loc.legPath.leg;
      }
    } else if (s.legPath) {
      branchId = s.legPath.branchId;
      after = s.legPath.leg;
    }
    if (!branchId) {
      toast({ tone: 'info', title: 'Select a branch first', body: 'Click a branch rail or an instruction inside a branch, then add a level.' });
      return;
    }
    // an existing empty level (e.g. the one "Branch" leaves) is used before adding another short
    const res = branchLevelTarget(rs, rung.id, branchId, after);
    if (res.legPath) commit(res.rungs, { select: { rungId: rung.id, legPath: res.legPath, wireIndex: 0 } });
  }, [commit]);

  const deleteSelection = useCallback(() => {
    if (readOnlyRef.current) return;
    const s = selRef.current;
    const rs = rungsRef.current;
    if (!s) return;
    const rung = findRung(rs, s.rungId);
    if (!rung) return;
    if (s.elementId) {
      const next = removeElement(rs, rung.id, s.elementId);
      commit(next, { select: selectionAfterRemoval(rung, s.elementId, next) });
    } else if (s.legPath && (s.wireIndex === undefined || getSeries(rung.elements, s.legPath)?.length === 0)) {
      // a selected level, or the wire of an empty level (a short): remove the level
      const next = removeLeg(rs, rung.id, s.legPath.branchId, s.legPath.leg);
      commit(next, { select: { rungId: rung.id } });
    } else if (s.wireIndex === undefined) {
      const i = rungIndexOf(rs, rung.id);
      const next = deleteRung(rs, rung.id);
      const pick = next[Math.min(i, next.length - 1)];
      commit(next, { select: pick ? { rungId: pick.id } : null });
    }
  }, [commit]);

  const copySelection = useCallback((): LadderClipboard | null => {
    const s = selRef.current;
    const rung = s && findRung(rungsRef.current, s.rungId);
    if (!s || !rung) return null;
    if (s.elementId) CLIPBOARD = { kind: 'elements', elements: copyElements(rung, [s.elementId]) };
    else if (s.legPath && s.wireIndex === undefined) {
      // a branch level: its logic
      const leg = getSeries(rung.elements, s.legPath);
      if (!leg || leg.length === 0) return null;
      CLIPBOARD = { kind: 'elements', elements: structuredClone(leg) };
    } else if (s.wireIndex === undefined && !s.legPath) CLIPBOARD = { kind: 'rungs', rungs: [structuredClone(rung)] };
    else return null;
    return CLIPBOARD;
  }, []);

  const pasteClip = useCallback(
    (clip: LadderClipboard | null) => {
      if (readOnlyRef.current || !clip) return;
      const bad = clip.kind === 'elements' ? disallowedIn(clip.elements) : disallowedIn(clip.rungs.flatMap((r) => r.elements));
      if (bad) {
        toast({ tone: 'warning', title: `Cannot paste: ${bad} is locked`, body: 'The clipboard contains an instruction that is not available in this mission.' });
        return;
      }
      const rs = rungsRef.current;
      const s = selRef.current;
      if (clip.kind === 'rungs') {
        const i = s ? rungIndexOf(rs, s.rungId) : rs.length - 1;
        const res = pasteRungs(rs, i + 1, clip.rungs);
        commit(res.rungs, { select: { rungId: res.ids[res.ids.length - 1]! } });
        return;
      }
      const { rungs: base, rung } = ensureRung();
      // like quick entry: inputs go before the rung's trailing outputs, outputs at the end
      const point = insertPointFor(rung, s, clip.elements.every((e) => e.kind === 'instr' && INSTRUCTION_DEFS[e.op]?.kind === 'output') ? 'OTE' : 'XIC');
      const res = pasteElements(base, point, clip.elements);
      commit(res.rungs, { select: { rungId: rung.id, elementId: res.ids[res.ids.length - 1]! } });
    },
    [commit, disallowedIn, ensureRung],
  );

  const cutSelection = useCallback(() => {
    if (readOnlyRef.current) return;
    if (copySelection()) deleteSelection();
  }, [copySelection, deleteSelection]);

  const toggleBit = useCallback(
    (operand?: string) => {
      if (!controller || !online) {
        toast({ tone: 'info', title: 'Toggle Bit needs an online controller', body: 'Go online to change tag values from the ladder.' });
        return;
      }
      const s = selRef.current;
      const op = operand ?? (s?.elementId ? dataOperandOf(findInstr(rungsRef.current, s.rungId, s.elementId), s.operandIndex) : undefined);
      if (!op) return;
      try {
        if (controller.tags.typeOf(op, program) !== 'BOOL') {
          toast({ tone: 'info', title: `${op} is not a BOOL`, body: 'Toggle Bit works on BOOL operands (contacts and coils).' });
          return;
        }
        const v = controller.tags.readBool(op, program);
        controller.tags.writeBool(op, !v, program);
        dirtyRef.current = true;
        onToggleBitRef.current?.(op);
      } catch (e) {
        toast({ tone: 'error', title: 'Toggle Bit failed', body: e instanceof Error ? e.message : String(e) });
      }
    },
    [controller, online, program],
  );

  const applyForce = useCallback(
    (op: string, value: boolean | null) => {
      if (!controller) return;
      try {
        // force the physical point the operand resolves to in THIS program's scope (a program-scoped
        // alias may shadow a controller tag of the same name; setForce resolves controller scope first)
        const path = forceInfo(controller, op, program).path ?? op;
        if (value === null) controller.removeForce(path);
        else {
          controller.setForce(path, value);
          if (!controller.getStatus().forcesEnabled) {
            toast({ tone: 'warning', title: `Force installed on ${op}`, body: 'Forces are installed but DISABLED. Use Forces ▸ Enable All I/O Forces in the online toolbar to apply them.' });
          }
        }
        dirtyRef.current = true;
      } catch (e) {
        toast({ tone: 'error', title: 'Cannot force', body: e instanceof Error ? e.message : String(e) });
      }
    },
    [controller, program],
  );

  /** Studio 5000 "New Tag…" for an undefined operand of an instruction (the given one, else the first). */
  const openNewTag = useCallback(
    (rungId: string, elementId: string, operandIndex?: number): boolean => {
      if (readOnlyRef.current || !controller) return false;
      const instr = findInstr(rungsRef.current, rungId, elementId);
      if (!instr) return false;
      const indexes = operandIndex !== undefined ? [operandIndex] : instr.operands.map((_, i) => i);
      for (const i of indexes) {
        const text = instr.operands[i];
        const cand = text ? newTagCandidate(controller, text, program, specOf(instr.op, i, instr.operands)) : undefined;
        if (!cand) continue;
        const ri = rungIndexOf(rungsRef.current, rungId);
        setNewTag({ ...cand, usedBy: `${instr.op} on rung ${ri}` });
        return true;
      }
      return false;
    },
    [controller, program],
  );

  const newTagForSelection = useCallback(() => {
    const s = selRef.current;
    if (!s?.elementId || !openNewTag(s.rungId, s.elementId, s.operandIndex)) {
      toast({ tone: 'info', title: 'No undefined tag here', body: 'Select an instruction (or operand) whose tag does not exist yet, then use New Tag.' });
    }
  }, [openNewTag]);

  // ---------------------------------------------------------------- overlays
  const startOperandEdit = useCallback((rungId: string, elementId: string, index: number, initial?: string) => {
    if (readOnlyRef.current) return;
    const instr = findInstr(rungsRef.current, rungId, elementId);
    if (!instr || index >= Math.max(instr.operands.length, specOf(instr.op, index, instr.operands) ? index + 1 : 0)) return;
    setSel({ rungId, elementId, operandIndex: index });
    setEditing(operandEdit(rungId, elementId, index, initial));
  }, []);

  const startQuickEntry = useCallback(
    (text = '') => {
      if (readOnlyRef.current) return;
      const { rungs: rs, rung } = ensureRung();
      if (rs !== rungsRef.current) commit(rs, { select: { rungId: rung.id } });
      const s: LadderSelection = selRef.current?.rungId === rung.id ? selRef.current : { rungId: rung.id };
      // provisional point for placing the box (inputs go before the rung's outputs); the final point is
      // computed from the typed instruction when the entry is accepted
      const point = insertPointFor(rung, s, 'XIC');
      setEditing({ kind: 'quick', rungId: rung.id, point, sel: s, initial: text });
    },
    [commit, ensureRung],
  );

  const editRungText = useCallback((rungId?: string) => {
    if (readOnlyRef.current) return;
    const id = rungId ?? selRef.current?.rungId;
    if (!id || !findRung(rungsRef.current, id)) return;
    setSel({ rungId: id });
    setEditing({ kind: 'rungText', rungId: id });
  }, []);

  const editComment = useCallback((rungId?: string) => {
    if (readOnlyRef.current) return;
    const id = rungId ?? selRef.current?.rungId;
    if (!id || !findRung(rungsRef.current, id)) return;
    setSel((s) => (s?.rungId === id ? s : { rungId: id }));
    setEditing({ kind: 'comment', rungId: id });
  }, []);

  const closeEditing = useCallback(() => {
    // focus synchronously (not in a frame): keys typed right after Enter must reach the ladder
    focusEditor();
    setEditing(null);
  }, [focusEditor]);

  const setZoom = useCallback((z: number) => setZoomState(Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10), []);

  const setTheme = useCallback(
    (t: LadderTheme) => {
      setThemeState(t);
      props.onThemeChange?.(t);
    },
    [props.onThemeChange],
  );

  // ---------------------------------------------------------------- context menu
  const buildMenu = useCallback(
    (t: HitTarget): MenuEntry[] => {
      const rs = rungsRef.current;
      const rung = findRung(rs, t.rungId);
      if (!rung) return [];
      const ri = rungIndexOf(rs, rung.id);
      const ro = readOnlyRef.current;
      const out: MenuEntry[] = [];
      const instr = t.type === 'element' || t.type === 'operand' ? findInstr(rs, rung.id, t.elementId) : undefined;
      const branch = t.type === 'element' && !instr ? locateElement(rung.elements, t.elementId)?.element : undefined;
      if (instr) {
        const opIndex = t.type === 'operand' ? t.operandIndex : undefined;
        const dataOp = dataOperandOf(instr, opIndex ?? (INSTRUCTION_DEFS[instr.op]?.display === 'box' ? undefined : 0));
        const isBool = !!(dataOp && controller && (() => {
          try {
            return controller.tags.typeOf(dataOp, program) === 'BOOL';
          } catch {
            return false;
          }
        })());
        if (dataOp && isBool && controller) {
          out.push({ heading: dataOp });
          out.push({ label: 'Toggle Bit', shortcut: 'Ctrl/Alt+T', icon: <ToggleRight size={14} />, disabled: !online, hint: online ? undefined : 'Go online to toggle bits', onSelect: () => toggleBit(dataOp) });
          const fi = forceInfo(controller, dataOp, program);
          if (fi.forceable) {
            out.push({ label: 'Force On', icon: <Zap size={14} className="text-amber-400" />, disabled: !online, onSelect: () => applyForce(dataOp, true) });
            out.push({ label: 'Force Off', icon: <ZapOff size={14} className="text-amber-400" />, disabled: !online, onSelect: () => applyForce(dataOp, false) });
            out.push({ label: 'Remove Force', icon: <XCircle size={14} />, disabled: !online || fi.forced === undefined, onSelect: () => applyForce(dataOp, null) });
          }
          out.push('sep');
        }
        // undefined tag → Studio 5000 "New Tag…"
        const undefinedIdx = (opIndex !== undefined ? [opIndex] : instr.operands.map((_, i) => i)).find(
          (i) => instr.operands[i] !== undefined && newTagCandidate(controller, instr.operands[i]!, program, specOf(instr.op, i, instr.operands)) !== undefined,
        );
        if (undefinedIdx !== undefined) {
          const cand = newTagCandidate(controller, instr.operands[undefinedIdx]!, program, specOf(instr.op, undefinedIdx, instr.operands))!;
          out.push({
            label: `New Tag '${cand.name}'…`,
            shortcut: 'Ctrl/Alt+W',
            icon: <TagIcon size={14} className="text-sky-400" />,
            disabled: ro,
            onSelect: () => void openNewTag(rung.id, instr.id, undefinedIdx),
          });
        }
        out.push({ label: 'Edit Operand', shortcut: 'Enter', icon: <Pencil size={14} />, disabled: ro || instr.operands.length === 0, onSelect: () => startOperandEdit(rung.id, instr.id, opIndex ?? 0) });
        out.push({ label: 'Change Instruction…', icon: <Replace size={14} />, disabled: ro, onSelect: () => setEditing({ kind: 'mnemonic', rungId: rung.id, elementId: instr.id }) });
        out.push({ label: `${instr.op} Instruction Help`, shortcut: 'F1', icon: <BookOpen size={14} />, disabled: !INSTRUCTION_DEFS[instr.op], onSelect: () => setHelpOp(instr.op) });
        out.push('sep');
        out.push({ label: 'Cut Instruction', shortcut: 'Ctrl+X', icon: <Scissors size={14} />, disabled: ro, onSelect: cutSelection });
        out.push({ label: 'Copy Instruction', shortcut: 'Ctrl+C', icon: <Copy size={14} />, onSelect: () => void copySelection() });
        out.push({ label: 'Paste', shortcut: 'Ctrl+V', icon: <ClipboardPaste size={14} />, disabled: ro || !CLIPBOARD, onSelect: () => pasteClip(CLIPBOARD) });
        out.push({ label: 'Delete Instruction', shortcut: 'Del', icon: <Trash2 size={14} />, danger: true, disabled: ro, onSelect: deleteSelection });
        out.push('sep');
        out.push({ label: 'Add Branch Around', icon: <GitBranchPlus size={14} />, disabled: ro, onSelect: addBranch });
        const loc = locateElement(rung.elements, instr.id);
        if (loc?.legPath) out.push({ label: 'Add Branch Level', icon: <Plus size={14} />, disabled: ro, onSelect: addLevel });
        // at the end of a branch leg, Move Left / Right steps out of the branch
        const firstInLeg = !!loc && loc.index === 0;
        const lastInLeg = !!loc && loc.index >= loc.series.length - 1;
        out.push({ label: loc?.legPath && firstInLeg ? 'Move Out of Branch (Left)' : 'Move Left', shortcut: 'Alt+←', icon: <ArrowLeft size={14} />, disabled: ro || !loc || (firstInLeg && !loc.legPath), onSelect: () => commit(moveElement(rungsRef.current, rung.id, instr.id, -1)) });
        out.push({ label: loc?.legPath && lastInLeg ? 'Move Out of Branch (Right)' : 'Move Right', shortcut: 'Alt+→', icon: <ArrowRight size={14} />, disabled: ro || !loc || (lastInLeg && !loc.legPath), onSelect: () => commit(moveElement(rungsRef.current, rung.id, instr.id, 1)) });
        out.push('sep');
      } else if (branch?.kind === 'branch') {
        out.push({ heading: `Branch · ${branch.legs.length} levels` });
        out.push({ label: 'Add Branch Level', icon: <Plus size={14} />, disabled: ro, onSelect: addLevel });
        out.push({ label: 'Copy Branch', shortcut: 'Ctrl+C', icon: <Copy size={14} />, onSelect: () => void copySelection() });
        out.push({ label: 'Cut Branch', shortcut: 'Ctrl+X', icon: <Scissors size={14} />, disabled: ro, onSelect: cutSelection });
        out.push({ label: 'Delete Branch', shortcut: 'Del', icon: <Trash2 size={14} />, danger: true, disabled: ro, onSelect: deleteSelection });
        out.push('sep');
      } else if (t.type === 'wire') {
        if (t.legPath && getSeries(rung.elements, t.legPath)?.length === 0) {
          out.push({ heading: 'Empty branch level (short)' });
          out.push({ label: 'Delete Branch Level', shortcut: 'Del', icon: <Trash2 size={14} />, danger: true, disabled: ro, onSelect: deleteSelection });
        }
        out.push({ label: 'Insert Instruction…', shortcut: 'type', icon: <Pencil size={14} />, disabled: ro, onSelect: () => startQuickEntry('') });
        out.push({ label: 'Paste', shortcut: 'Ctrl+V', icon: <ClipboardPaste size={14} />, disabled: ro || !CLIPBOARD, onSelect: () => pasteClip(CLIPBOARD) });
        out.push({ label: 'Add Branch Here', icon: <GitBranchPlus size={14} />, disabled: ro, onSelect: addBranch });
        out.push('sep');
      }
      out.push({ heading: `Rung ${ri}` });
      out.push({ label: rung.comment ? 'Edit Rung Comment' : 'Add Rung Comment', shortcut: 'Ctrl+D', icon: <MessageSquareText size={14} />, disabled: ro, onSelect: () => editComment(rung.id) });
      out.push({ label: 'Edit Rung as Text', icon: <FileText size={14} />, disabled: ro, onSelect: () => editRungText(rung.id) });
      out.push({ label: 'Add Rung Above', icon: <ArrowUp size={14} />, disabled: ro, onSelect: () => {
        setSel({ rungId: rung.id });
        const res = addRungBefore(rungsRef.current, rung.id);
        commit(res.rungs, { select: { rungId: res.rung.id } });
      } });
      out.push({ label: 'Add Rung Below', shortcut: 'Ctrl+R', icon: <ArrowDown size={14} />, disabled: ro, onSelect: () => {
        const res = addRung(rungsRef.current, rung.id);
        commit(res.rungs, { select: { rungId: res.rung.id } });
      } });
      out.push({ label: 'Duplicate Rung', icon: <CopyPlus size={14} />, disabled: ro, onSelect: () => {
        const res = duplicateRung(rungsRef.current, rung.id);
        if (res.rung) commit(res.rungs, { select: { rungId: res.rung.id } });
      } });
      out.push({ label: 'Copy Rung', icon: <Copy size={14} />, onSelect: () => {
        CLIPBOARD = { kind: 'rungs', rungs: [structuredClone(rung)] };
      } });
      if (CLIPBOARD?.kind === 'rungs') out.push({ label: 'Paste Rung Below', icon: <ClipboardPaste size={14} />, disabled: ro, onSelect: () => {
        setSel({ rungId: rung.id });
        const res = pasteRungs(rungsRef.current, ri + 1, (CLIPBOARD as { rungs: Rung[] }).rungs);
        commit(res.rungs, { select: { rungId: res.ids[0]! } });
      } });
      out.push({ label: 'Move Rung Up', shortcut: 'Alt+↑', icon: <ArrowUp size={14} />, disabled: ro || ri === 0, onSelect: () => commit(moveRung(rungsRef.current, rung.id, -1)) });
      out.push({ label: 'Move Rung Down', shortcut: 'Alt+↓', icon: <ArrowDown size={14} />, disabled: ro || ri === rs.length - 1, onSelect: () => commit(moveRung(rungsRef.current, rung.id, 1)) });
      out.push({ label: 'Delete Rung', icon: <Trash2 size={14} />, danger: true, disabled: ro, onSelect: () => {
        const i = rungIndexOf(rungsRef.current, rung.id);
        const next = deleteRung(rungsRef.current, rung.id);
        const pick = next[Math.min(i, next.length - 1)];
        commit(next, { select: pick ? { rungId: pick.id } : null });
      } });
      return out;
    },
    [controller, online, program, toggleBit, applyForce, openNewTag, startOperandEdit, cutSelection, copySelection, pasteClip, deleteSelection, addBranch, addLevel, commit, startQuickEntry, editComment, editRungText],
  );

  // ---------------------------------------------------------------- hover cards
  const hideHover = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    hoverKey.current = '';
    setHover(null);
  }, []);

  const hoverContent = useCallback(
    (t: HitTarget): ReactNode => {
      const rs = rungsRef.current;
      const rung = findRung(rs, t.rungId);
      if (!rung) return null;
      const ri = rungIndexOf(rs, rung.id);
      const errs = errorsByRung.get(rung.id) ?? [];
      if (t.type === 'marker' || (t.type === 'rungnum' && errs.length > 0)) {
        return (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold tracking-wide text-[var(--ld-ov-muted)] uppercase">
              Rung {ri} · {errs.filter((e) => e.severity === 'error').length} error(s), {errs.filter((e) => e.severity === 'warning').length} warning(s)
            </div>
            {errs.map((e, i) => (
              <div key={i} className="flex gap-1.5 text-[12px] leading-snug">
                {e.severity === 'error' ? <XCircle size={13} className="mt-0.5 shrink-0 text-red-400" /> : <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-400" />}
                <span>
                  <b>{e.severity === 'error' ? 'Error' : 'Warning'}:</b> Rung {ri}, {e.message}
                </span>
              </div>
            ))}
          </div>
        );
      }
      if (t.type === 'rungnum') {
        return (
          <div className="text-[12px]">
            <b>Rung {ri}</b> — double-click to edit as text
            <div className="mt-1 font-mono text-[11px] break-all text-[var(--ld-ov-muted)]">{serializeRung(rung)}</div>
          </div>
        );
      }
      if (t.type === 'wire') {
        if (!t.legPath || getSeries(rung.elements, t.legPath)?.length !== 0) return null;
        return (
          <div className="max-w-xs space-y-1 text-[12px] leading-snug">
            <div className="flex items-center gap-1.5 font-semibold text-amber-400">
              <TriangleAlert size={13} /> Empty branch level — a short
            </div>
            <div className="text-[var(--ld-ov-muted)]">Power always flows through an empty level, so the OR is always true. Click it and type an instruction, or press Del to remove the level.</div>
          </div>
        );
      }
      if (t.type !== 'element' && t.type !== 'operand') return null;
      const instr = findInstr(rs, rung.id, t.elementId);
      if (!instr) return null;
      const def = INSTRUCTION_DEFS[instr.op];
      const idx = t.type === 'operand' ? t.operandIndex : def?.display === 'box' ? undefined : 0;
      const operand = idx !== undefined ? instr.operands[idx] : undefined;
      const meta = operand && operand !== '?' ? tagMeta?.(operand) : undefined;
      const reader = readerRef.current;
      const live = operand && reader && online ? reader.format(operand) : '';
      const type = operand && controller ? (() => {
        try {
          return controller.tags.typeOf(operand, program);
        } catch {
          return undefined;
        }
      })() : undefined;
      const fi = operand && controller ? forceInfo(controller, operand, program) : undefined;
      const undefinedTag = operand && idx !== undefined ? newTagCandidate(controller, operand, program, specOf(instr.op, idx, instr.operands)) : undefined;
      const elErrs = errs.filter((e) => e.elementId === instr.id);
      return (
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] font-bold">{instr.op}</span>
            <span className="font-semibold">{def?.name ?? 'Unknown instruction'}</span>
            {def && <span className="ml-auto text-[10.5px] text-[var(--ld-ov-muted)]">{def.category}</span>}
          </div>
          {operand !== undefined && (
            <div className="rounded-md bg-[var(--ld-ov-bg-2)] px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{operand}</span>
                {type && <span className="font-mono text-[10.5px] text-[var(--ld-ov-muted)]">{type}</span>}
                {live !== '' && (
                  <span className="ml-auto rounded bg-emerald-500/15 px-1.5 font-mono text-[11px] font-semibold text-emerald-400">= {live}</span>
                )}
              </div>
              {meta?.aliasFor && <div className="font-mono text-[10.5px] text-[var(--ld-ov-muted)]">alias for {meta.aliasFor}</div>}
              {meta?.description && <div className="text-[11.5px] text-[var(--ld-ov-muted)]">{meta.description}</div>}
              {fi?.forced !== undefined && (
                <div className="mt-0.5 text-[11px] font-semibold text-amber-400">
                  Forced {typeof fi.forced === 'boolean' ? (fi.forced ? 'ON' : 'OFF') : fi.forced}
                </div>
              )}
              {operand === '?' && <div className="text-[11px] text-red-400">Operand not set — double-click to enter a tag.</div>}
              {undefinedTag && (
                <div className="mt-0.5 text-[11px] text-sky-400">
                  Tag not defined — right-click ▸ New Tag… (Ctrl/Alt+W) creates it as {undefinedTag.dataType}
                  {undefinedTag.dims ? `[${undefinedTag.dims}]` : ''}.
                </div>
              )}
            </div>
          )}
          {def && <div className="text-[11.5px] leading-snug text-[var(--ld-ov-muted)]">{def.summary}</div>}
          {elErrs.map((e, i) => (
            <div key={i} className={cn('text-[11.5px]', e.severity === 'error' ? 'text-red-400' : 'text-amber-400')}>
              {e.severity === 'error' ? 'Error' : 'Warning'}: {e.message}
            </div>
          ))}
        </div>
      );
    },
    [errorsByRung, tagMeta, online, controller, program],
  );

  // ---------------------------------------------------------------- pointer drag (move instructions)
  const dropAt = useCallback(
    (clientX: number, clientY: number, from?: Element | null): DropTarget | null => {
      const hit = (from ?? document.elementFromPoint(clientX, clientY))?.closest('[data-rung-row]');
      if (!hit) return null;
      const id = hit.getAttribute('data-rung-row')!;
      const info = layoutById.get(id);
      if (!info) return null;
      const rect = hit.getBoundingClientRect();
      const gap = nearestGap(info.layout, (clientX - rect.left) / zoom, (clientY - rect.top) / zoom);
      return gap ? { rungId: id, gap } : null;
    },
    [layoutById, zoom],
  );

  const setDropIfChanged = useCallback((d: DropTarget | null) => {
    dropRef.current = d;
    setDrop((cur) => (cur?.rungId === d?.rungId && cur?.gap === d?.gap ? cur : d));
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        d.active = true;
        hideHover();
      }
      setGhost({ x: e.clientX, y: e.clientY, label: d.label });
      setDropIfChanged(dropAt(e.clientX, e.clientY));
    };
    const up = (): void => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d?.active) return;
      const target = dropRef.current;
      setGhost(null);
      setDrop(null);
      if (!target) return;
      const point: InsertPoint = target.gap.legPath
        ? { rungId: target.rungId, legPath: target.gap.legPath, index: target.gap.index }
        : { rungId: target.rungId, index: target.gap.index };
      const next = moveElementTo(rungsRef.current, d.rungId, d.elementId, point);
      if (next !== rungsRef.current) commit(next, { select: { rungId: target.rungId, elementId: d.elementId } });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dropAt, setDropIfChanged, commit, hideHover]);

  // ---------------------------------------------------------------- mouse handlers
  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    hideHover();
    if (e.button !== 0) return;
    const t = hitTarget(e.target);
    if (!t) return;
    // keyboard focus must not depend on the clicked node surviving the re-render (typed entries)
    focusEditor();
    // operand / quick / mnemonic / comment overlays resolve themselves on blur (commit or cancel)
    if (editing?.kind === 'rungText') setEditing(null);
    switch (t.type) {
      case 'rung':
      case 'rungnum':
      case 'marker':
      case 'comment':
        setSel({ rungId: t.rungId });
        break;
      case 'element': {
        setSel({ rungId: t.rungId, elementId: t.elementId });
        const instr = findInstr(rungsRef.current, t.rungId, t.elementId);
        if (instr && !readOnlyRef.current) dragRef.current = { x: e.clientX, y: e.clientY, rungId: t.rungId, elementId: t.elementId, active: false, label: `${instr.op}(${instr.operands.join(',')})` };
        break;
      }
      case 'operand':
        setSel({ rungId: t.rungId, elementId: t.elementId, operandIndex: t.operandIndex });
        break;
      case 'wire':
        setSel(t.legPath ? { rungId: t.rungId, legPath: t.legPath, wireIndex: t.index } : { rungId: t.rungId, wireIndex: t.index });
        break;
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const t = hitTarget(e.target);
    if (!t || readOnlyRef.current) {
      if (t && (t.type === 'element' || t.type === 'operand')) {
        const instr = findInstr(rungsRef.current, t.rungId, t.elementId);
        if (instr) setHelpOp(instr.op);
      }
      return;
    }
    dragRef.current = null;
    switch (t.type) {
      case 'rungnum':
      case 'marker':
        editRungText(t.rungId);
        break;
      case 'comment':
        editComment(t.rungId);
        break;
      case 'operand':
        startOperandEdit(t.rungId, t.elementId, t.operandIndex);
        break;
      case 'element': {
        const instr = findInstr(rungsRef.current, t.rungId, t.elementId);
        if (!instr) break;
        const node = layoutById.get(t.rungId)?.layout.byId[t.elementId];
        const isBox = node?.kind === 'instr' && node.display === 'box';
        if (t.sym || instr.operands.length === 0) setEditing({ kind: 'mnemonic', rungId: t.rungId, elementId: t.elementId });
        else if (!isBox) startOperandEdit(t.rungId, t.elementId, 0);
        else setEditing({ kind: 'mnemonic', rungId: t.rungId, elementId: t.elementId });
        break;
      }
      case 'wire':
        startQuickEntry('');
        break;
      case 'rung':
        startQuickEntry('');
        break;
    }
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const t = hitTarget(e.target);
    if (!t) return;
    e.preventDefault();
    hideHover();
    dragRef.current = null;
    const s = selRef.current;
    const same =
      s &&
      s.rungId === t.rungId &&
      ((t.type === 'element' && s.elementId === t.elementId) || (t.type === 'operand' && s.elementId === t.elementId && s.operandIndex === t.operandIndex));
    if (!same) {
      if (t.type === 'element') setSel({ rungId: t.rungId, elementId: t.elementId });
      else if (t.type === 'operand') setSel({ rungId: t.rungId, elementId: t.elementId, operandIndex: t.operandIndex });
      else if (t.type === 'wire') setSel(t.legPath ? { rungId: t.rungId, legPath: t.legPath, wireIndex: t.index } : { rungId: t.rungId, wireIndex: t.index });
      else setSel({ rungId: t.rungId });
    }
    selRef.current = t.type === 'element' ? { rungId: t.rungId, elementId: t.elementId } : t.type === 'operand' ? { rungId: t.rungId, elementId: t.elementId, operandIndex: t.operandIndex } : selRef.current;
    setMenu({ x: e.clientX, y: e.clientY, entries: buildMenu(t) });
  };

  const onMouseMove = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (dragRef.current?.active || menu) return;
    const t = hitTarget(e.target);
    const emptyLeg = (x: HitTarget): boolean => {
      if (x.type !== 'wire' || !x.legPath) return false;
      const r = findRung(rungsRef.current, x.rungId);
      return !!r && getSeries(r.elements, x.legPath)?.length === 0;
    };
    const interesting = t && (t.type === 'element' || t.type === 'operand' || t.type === 'marker' || t.type === 'rungnum' || emptyLeg(t));
    const key = interesting ? JSON.stringify(t) : '';
    if (key === hoverKey.current) {
      if (hover) setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
      return;
    }
    hoverKey.current = key;
    window.clearTimeout(hoverTimer.current);
    setHover(null);
    if (!interesting || !t) return;
    const x = e.clientX;
    const y = e.clientY;
    hoverTimer.current = window.setTimeout(() => {
      const content = hoverContent(t);
      if (content) setHover({ x, y, content });
    }, t.type === 'marker' ? 150 : compactRef.current && (t.type === 'operand' || t.type === 'element') ? 250 : 550); // compact labels: descriptions are in the card, open it sooner
  };

  // HTML5 drag & drop from the toolbar
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (readOnlyRef.current || !e.dataTransfer.types.includes(INSTR_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropIfChanged(dropAt(e.clientX, e.clientY, e.target as Element));
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
    const op = e.dataTransfer.getData(INSTR_DRAG_TYPE);
    const target = drop ?? dropAt(e.clientX, e.clientY, e.target as Element);
    setDrop(null);
    if (!op || !target || readOnlyRef.current) return;
    e.preventDefault();
    const pt: LadderSelection = target.gap.legPath
      ? { rungId: target.rungId, legPath: target.gap.legPath, wireIndex: target.gap.index }
      : { rungId: target.rungId, wireIndex: target.gap.index };
    selRef.current = pt;
    setSel(pt);
    insertInstruction(op);
    focusEditor();
  };

  // ---------------------------------------------------------------- keyboard
  const spatial = useCallback(
    (dir: 1 | -1) => {
      const rs = rungsRef.current;
      const s = selRef.current;
      if (!s) {
        const pick = adjacentRung(rs, null, dir);
        if (pick) setSel(pick);
        return;
      }
      const info = layoutById.get(s.rungId);
      if (info && s.elementId) {
        const n = info.layout.byId[s.elementId];
        if (n) {
          const cx = n.kind === 'instr' ? n.x + n.w / 2 : (n.x + n.x2) / 2;
          const cy = n.y;
          let best: InstrLayout | undefined;
          let bestD = Infinity;
          for (const m of info.layout.nodes) {
            if (m.kind !== 'instr' || m.id === n.id) continue;
            if (dir > 0 ? m.y <= cy + 1 : m.y >= cy - 1) continue;
            const d = Math.abs(m.y - cy) * 3 + Math.abs(m.x + m.w / 2 - cx);
            if (d < bestD) {
              bestD = d;
              best = m;
            }
          }
          if (best) {
            setSel({ rungId: s.rungId, elementId: best.id });
            return;
          }
          const ni = info.index + dir;
          const nr = rs[ni];
          const nl = nr && layoutById.get(nr.id);
          if (nr && nl) {
            const instrs = nl.layout.nodes.filter((m): m is InstrLayout => m.kind === 'instr');
            if (instrs.length === 0) {
              setSel({ rungId: nr.id });
              return;
            }
            const rowY = dir > 0 ? Math.min(...instrs.map((m) => m.y)) : Math.max(...instrs.map((m) => m.y));
            const row = instrs.filter((m) => m.y === rowY);
            row.sort((a, b) => Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx));
            setSel({ rungId: nr.id, elementId: row[0]!.id });
          }
          return;
        }
      }
      const pick = adjacentRung(rs, s, dir);
      if (pick) setSel(pick);
    },
    [layoutById],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== scrollRef.current || helpOp !== null || menu !== null) return;
    hideHover();
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lowerKey = key.toLowerCase();
    const s = selRef.current;
    const rs = rungsRef.current;
    const handled = (): void => {
      e.preventDefault();
    };
    if (ctrl && lowerKey === 'z') {
      handled();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (ctrl && lowerKey === 'y') return handled(), redo();
    if (ctrl && lowerKey === 'r') return handled(), addRungAfterSel();
    // Studio 5000: Ctrl+T toggle bit, Ctrl+W new tag (browsers keep those for tabs → Alt+T / Alt+W too)
    if ((ctrl && lowerKey === 't') || (e.altKey && e.code === 'KeyT')) return handled(), toggleBit();
    if ((ctrl && lowerKey === 'w') || (e.altKey && e.code === 'KeyW')) return handled(), newTagForSelection();
    if (ctrl && lowerKey === 'd') return handled(), editComment();
    if (ctrl && lowerKey === 'c') {
      copySelection();
      return;
    }
    if (ctrl && lowerKey === 'x') {
      if (readOnlyRef.current) return;
      pasteHandled.current = true;
      // cut only what could be copied (never delete without filling the clipboard)
      if (copySelection()) deleteSelection();
      return;
    }
    if (ctrl && lowerKey === 'v') {
      pasteHandled.current = false;
      window.setTimeout(() => {
        if (!pasteHandled.current) pasteClip(CLIPBOARD);
        pasteHandled.current = true;
      }, 30);
      return;
    }
    if (ctrl && (key === '=' || key === '+')) return handled(), setZoom(zoom + 0.1);
    if (ctrl && key === '-') return handled(), setZoom(zoom - 0.1);
    if (ctrl && key === '0') return handled(), setZoom(1);
    if (ctrl && (key === 'Home' || key === 'End')) {
      handled();
      const r = key === 'Home' ? rs[0] : rs[rs.length - 1];
      if (r) setSel({ rungId: r.id });
      return;
    }
    if (key === 'Insert') return handled(), addRungAfterSel();
    if (e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      handled();
      if (s?.elementId) commit(moveElement(rs, s.rungId, s.elementId, key === 'ArrowLeft' ? -1 : 1));
      return;
    }
    if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      handled();
      if (s) commit(moveRung(rs, s.rungId, key === 'ArrowUp' ? -1 : 1));
      return;
    }
    switch (key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        handled();
        const next = nextInstruction(rs, s, key === 'ArrowRight' ? 1 : -1);
        if (next) setSel(next);
        return;
      }
      case 'ArrowDown':
      case 'ArrowUp':
        handled();
        spatial(key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Home':
      case 'End': {
        handled();
        const rung = s && findRung(rs, s.rungId);
        if (!rung) return;
        const list = instructionsOf(rung.elements);
        const pick = key === 'Home' ? list[0] : list[list.length - 1];
        setSel(pick ? { rungId: rung.id, elementId: pick.id } : { rungId: rung.id });
        return;
      }
      case 'Tab': {
        handled();
        const next = nextOperand(rs, s, e.shiftKey ? -1 : 1);
        if (next) setSel(next);
        return;
      }
      case 'Enter':
      case 'F2': {
        handled();
        if (!s) return;
        if (s.elementId) {
          const instr = findInstr(rs, s.rungId, s.elementId);
          if (instr && instr.operands.length > 0) {
            const idx = s.operandIndex ?? Math.max(0, instr.operands.findIndex((o) => o === '?'));
            startOperandEdit(s.rungId, s.elementId, idx);
          } else if (instr) setEditing({ kind: 'mnemonic', rungId: s.rungId, elementId: s.elementId });
        } else if (s.wireIndex !== undefined) startQuickEntry('');
        else editRungText(s.rungId);
        return;
      }
      case 'F1': {
        handled();
        const instr = s?.elementId ? findInstr(rs, s.rungId, s.elementId) : undefined;
        setHelpOp(instr?.op ?? 'XIC');
        return;
      }
      case 'Delete':
      case 'Backspace':
        handled();
        deleteSelection();
        return;
      case 'Escape':
        handled();
        if (!s) return;
        if (s.operandIndex !== undefined) setSel({ rungId: s.rungId, elementId: s.elementId! });
        else if (s.elementId || s.wireIndex !== undefined || s.legPath) setSel({ rungId: s.rungId });
        return;
      case 'ContextMenu': {
        handled();
        openMenuAtSelection();
        return;
      }
      default:
        break;
    }
    if (!ctrl && !e.altKey && key.length === 1 && /[A-Za-z_[]/.test(key) && !readOnlyRef.current) {
      handled();
      if (s?.elementId && s.operandIndex !== undefined) startOperandEdit(s.rungId, s.elementId, s.operandIndex, key);
      else startQuickEntry(key.toUpperCase());
    } else if (!ctrl && !e.altKey && /^[0-9]$/.test(key) && s?.elementId && s.operandIndex !== undefined && !readOnlyRef.current) {
      handled();
      // a number typed on a tag-only operand (the TIMER of a TON…) goes to the instruction's next
      // operand that takes a literal (its preset) — it never overwrites the tag
      const instr = findInstr(rs, s.rungId, s.elementId);
      let idx: number | undefined = s.operandIndex;
      if (instr && !takesLiteral(specOf(instr.op, idx, instr.operands))) {
        const n = instr.operands.length;
        const order = [...Array(n).keys()].map((k) => (s.operandIndex! + 1 + k) % n);
        idx = order.find((i) => instr.operands[i] === '?' && takesLiteral(specOf(instr.op, i, instr.operands))) ?? order.find((i) => takesLiteral(specOf(instr.op, i, instr.operands)));
      }
      if (idx !== undefined) startOperandEdit(s.rungId, s.elementId, idx, key);
    }
  };

  const openMenuAtSelection = useCallback(() => {
    const s = selRef.current;
    if (!s) return;
    const row = scrollRef.current?.querySelector(`[data-rung-row="${CSS.escape(s.rungId)}"]`);
    const el = (s.elementId && row?.querySelector(`[data-el="${CSS.escape(s.elementId)}"]`)) || row;
    const r = el?.getBoundingClientRect();
    const t: HitTarget = s.elementId
      ? s.operandIndex !== undefined
        ? { type: 'operand', rungId: s.rungId, elementId: s.elementId, operandIndex: s.operandIndex }
        : { type: 'element', rungId: s.rungId, elementId: s.elementId, sym: false }
      : s.wireIndex !== undefined
        ? s.legPath
          ? { type: 'wire', rungId: s.rungId, legPath: s.legPath, index: s.wireIndex }
          : { type: 'wire', rungId: s.rungId, index: s.wireIndex }
        : { type: 'rung', rungId: s.rungId };
    setMenu({ x: r ? r.left + Math.min(r.width, 60) : 200, y: r ? r.top + Math.min(r.height, 40) : 200, entries: buildMenu(t) });
  }, [buildMenu]);

  // clipboard events (system clipboard interop: rungs as neutral text)
  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    if (e.target !== scrollRef.current) return;
    const clip = CLIPBOARD;
    if (!clip) return;
    e.clipboardData.setData('text/plain', clipboardToText(clip));
    e.preventDefault();
  };
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    if (e.target !== scrollRef.current) return;
    e.preventDefault();
    pasteHandled.current = true;
    const text = e.clipboardData.getData('text/plain');
    const internal = CLIPBOARD && clipboardToText(CLIPBOARD) === text.trim() ? CLIPBOARD : null;
    const clip = internal ?? (text ? clipboardFromText(text) : undefined) ?? CLIPBOARD;
    if (clip) pasteClip(clip);
  };

  // Ctrl + wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomState((z) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) * 100) / 100);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---------------------------------------------------------------- imperative handle
  useImperativeHandle(
    props.ref,
    (): LadderEditorHandle => ({
      focus: focusEditor,
      getSelection: () => selRef.current,
      setSelection: (s) => setSel(s ? normalizeSelection(rungsRef.current, s) : null),
      insertInstruction,
      addRung: () => addRungAfterSel(),
      addBranch,
      addBranchLevel: addLevel,
      undo,
      redo,
      deleteSelection,
      startQuickEntry: (text) => startQuickEntry(text ?? ''),
      editOperand: () => {
        const s = selRef.current;
        if (s?.elementId) startOperandEdit(s.rungId, s.elementId, s.operandIndex ?? 0);
      },
      editRungText: (id) => editRungText(id),
      editRungComment: (id) => editComment(id),
      openContextMenu: openMenuAtSelection,
      showHelp: (m) => {
        const s = selRef.current;
        const instr = s?.elementId ? findInstr(rungsRef.current, s.rungId, s.elementId) : undefined;
        setHelpOp(m ?? instr?.op ?? 'XIC');
      },
      newTag: newTagForSelection,
      setZoom,
      scrollToRung: (i) => {
        const r = rungsRef.current[i];
        if (r) setSel({ rungId: r.id });
      },
    }),
    [focusEditor, insertInstruction, addRungAfterSel, addBranch, addLevel, undo, redo, deleteSelection, startQuickEntry, startOperandEdit, editRungText, editComment, openMenuAtSelection, newTagForSelection, setZoom],
  );

  // ---------------------------------------------------------------- toolbar
  const onToolbar = useCallback(
    (a: ToolbarAction) => {
      if (a.type === 'rung') addRungAfterSel();
      else if (a.type === 'branch') addBranch();
      else if (a.type === 'branchLevel') addLevel();
      else insertInstruction(a.mnemonic);
      if (a.type !== 'instr') focusEditor();
      // an instruction without operands (NOP, AFI…) opens no editor: give the ladder its keys back
      else requestAnimationFrame(() => {
        if (!editingRef.current && !modalOpenRef.current) focusEditor();
      });
    },
    [addRungAfterSel, addBranch, addLevel, insertInstruction, focusEditor],
  );

  // ---------------------------------------------------------------- overlay rendering
  const routines = useMemo(() => routinesOf(controller, program), [controller, program, tagVersion]);
  const labels = useMemo(() => labelsOf(rungs), [rungs]);
  const defaultExample = useMemo(() => defaultExampleEntry(controller), [controller, tagVersion]);
  const exampleEntry = props.exampleEntry?.trim() || defaultExample;

  const validateRungText = useCallback((text: string) => checkRungText(text, allowedSet), [allowedSet]);

  const appendRung = useCallback(() => {
    if (readOnlyRef.current) return;
    const last = rungsRef.current[rungsRef.current.length - 1];
    const res = addRung(rungsRef.current, last?.id);
    commit(res.rungs, { select: { rungId: res.rung.id } });
    focusEditor();
  }, [commit, focusEditor]);

  const overlayFor = (rung: Rung, layout: RungLayout): ReactNode => {
    if (!editing || editing.rungId !== rung.id) return undefined;
    switch (editing.kind) {
      case 'operand': {
        const instr = findInstr(rungs, rung.id, editing.elementId);
        const node = layout.byId[editing.elementId];
        if (!instr || node?.kind !== 'instr') return undefined;
        return (
          <OperandOverlay
            key={`${editing.elementId}:${editing.index}:${editing.seq}`}
            instr={instr}
            node={node}
            index={editing.index}
            {...(editing.initial !== undefined ? { initial: editing.initial } : {})}
            zoom={zoom}
            {...(controller ? { controller } : {})}
            program={program}
            routines={routines}
            labels={labels}
            maxLeft={viewW - 372}
            onCancel={closeEditing}
            onCommit={(text, how, item) => {
              const value = text.trim() === '' ? '?' : text.trim();
              const next = setOperand(rungsRef.current, rung.id, instr.id, editing.index, value);
              commit(next);
              if (item?.action === 'newTag') {
                // use the typed name here, then create it (Studio: type the name, then New Tag…)
                setSel({ rungId: rung.id, elementId: instr.id, operandIndex: editing.index });
                setEditing(null);
                const cand = newTagCandidate(controller, value, program, specOf(instr.op, editing.index, instr.operands));
                if (cand) setNewTag({ ...cand, usedBy: `${instr.op} on rung ${rungIndexOf(rungsRef.current, rung.id)}` });
                return;
              }
              if (how === 'tab' || how === 'shift-tab') {
                const after = nextOperand(next, { rungId: rung.id, elementId: instr.id, operandIndex: editing.index }, how === 'tab' ? 1 : -1);
                // at the routine's first / last operand there is nowhere to go: accept and close
                if (after?.elementId && after.operandIndex !== undefined && !(after.elementId === instr.id && after.operandIndex === editing.index)) {
                  setSel(after);
                  setEditing(operandEdit(after.rungId, after.elementId, after.operandIndex));
                  return;
                }
              }
              if (how === 'blur') {
                setEditing(null);
                return;
              }
              if (how === 'enter') {
                // filling a new instruction (or an instruction with unset operands): Enter goes on to the
                // next '?' operand, like Tab — the preset is never typed into the timer tag's editor
                const after = nextUnsetOperand(next, rung.id, instr.id, editing.index, editing.fill === true);
                if (after?.elementId && after.operandIndex !== undefined) {
                  setSel(after);
                  setEditing(operandEdit(after.rungId, after.elementId, after.operandIndex, undefined, editing.fill === true));
                  return;
                }
                if (editing.fill) {
                  // done filling in: select the instruction (typing then inserts, it does not edit an operand)
                  setSel({ rungId: rung.id, elementId: instr.id });
                  closeEditing();
                  return;
                }
              }
              setSel({ rungId: rung.id, elementId: instr.id, operandIndex: editing.index });
              closeEditing();
            }}
          />
        );
      }
      case 'mnemonic': {
        const instr = findInstr(rungs, rung.id, editing.elementId);
        const node = layout.byId[editing.elementId];
        if (!instr || node?.kind !== 'instr') return undefined;
        return (
          <MnemonicOverlay
            instr={instr}
            {...(allowedInstructions ? { allowed: allowedInstructions } : {})}
            style={{ left: Math.max(4, Math.min(node.sym.x * zoom - 20, viewW - 262)), top: node.sym.y * zoom - 4, width: 250 }}
            onCancel={closeEditing}
            onCommit={(op) => {
              if (!op) return 'Type an instruction mnemonic.';
              if (!INSTRUCTION_DEFS[op]) return `Unknown instruction '${op}'.`;
              if (!isAllowed(op)) return `${op} is locked in this mission.`;
              commit(setMnemonic(rungsRef.current, rung.id, instr.id, op), { select: { rungId: rung.id, elementId: instr.id } });
              closeEditing();
              return null;
            }}
          />
        );
      }
      case 'quick': {
        const g = layout.gaps.find((x) => x.index === editing.point.index && (x.legPath?.branchId ?? '') === (editing.point.legPath?.branchId ?? '') && (x.legPath?.leg ?? -1) === (editing.point.legPath?.leg ?? -1));
        const x = g ? g.x : layout.railL + 20;
        const y = g ? g.y : layout.y;
        return (
          <QuickEntryOverlay
            initial={editing.initial}
            example={exampleEntry}
            style={{ left: Math.max(4, Math.min(x * zoom - 20, viewW - 372)), top: y * zoom + 12, width: 360 }}
            {...(controller ? { controller } : {})}
            program={program}
            {...(allowedInstructions ? { allowed: allowedInstructions } : {})}
            routines={routines}
            labels={labels}
            onCancel={closeEditing}
            onCommit={(text) => {
              let els: RungElement[];
              try {
                els = parseQuickEntry(text);
              } catch (err) {
                return err instanceof Error ? err.message : String(err);
              }
              if (els.length === 0) {
                closeEditing();
                return null;
              }
              const unknown = instructionsOf(els).find((i) => !INSTRUCTION_DEFS[i.op]);
              if (unknown) return `Unknown instruction '${unknown.op}'.`;
              const bad = disallowedIn(els);
              if (bad) return `${bad} is locked in this mission.`;
              const cur = findRung(rungsRef.current, rung.id) ?? rung;
              const firstOp = instructionsOf(els)[0]?.op;
              const point = insertPointFor(cur, editing.sel, els.every((e) => e.kind === 'instr' && INSTRUCTION_DEFS[e.op]?.kind === 'output') ? firstOp : 'XIC');
              const next = insertAt(rungsRef.current, point, els);
              const list = instructionsOf(els);
              const firstMissing = list.find((i) => i.operands.includes('?'));
              const last = els[els.length - 1]!;
              if (firstMissing) {
                const idx = firstMissing.operands.indexOf('?');
                commit(next, { select: { rungId: rung.id, elementId: firstMissing.id, operandIndex: idx } });
                setEditing(operandEdit(rung.id, firstMissing.id, idx, undefined, true));
              } else {
                commit(next, { select: { rungId: rung.id, elementId: last.id } });
                closeEditing();
              }
              return null;
            }}
          />
        );
      }
      case 'rungText':
        return (
          <RungTextEditor
            initial={serializeRung(rung)}
            style={{ left: Math.max(4, (layout.railL - 6) * zoom), top: 4, width: Math.max(420, (layout.railR - layout.railL + 12) * zoom) }}
            validate={validateRungText}
            onCancel={closeEditing}
            onCommit={(text) => {
              const res = replaceRungFromText(rungsRef.current, rung.id, text);
              if (res.ok) {
                commit(res.rungs, { select: { rungId: rung.id } });
                if (!readOnlyRef.current) onRungTextCommitRef.current?.(rungIndexOf(rungsRef.current, rung.id), text);
              }
              closeEditing();
            }}
          />
        );
      case 'comment': {
        const c = layout.comment;
        return (
          <CommentEditor
            initial={rung.comment ?? ''}
            style={{ left: ((c?.x ?? layout.railL + 10) - 6) * zoom, top: Math.max(2, (c?.y ?? 6) * zoom - 6), width: Math.max(360, Math.min(720, (c?.w ?? 500) * zoom + 12)) }}
            onCancel={closeEditing}
            onCommit={(text, viaBlur) => {
              if (viaBlur) {
                commit(setRungComment(rungsRef.current, rung.id, text));
                setEditing(null);
                return;
              }
              commit(setRungComment(rungsRef.current, rung.id, text), { select: { rungId: rung.id } });
              closeEditing();
            }}
          />
        );
      }
    }
  };

  // ---------------------------------------------------------------- render
  const themeClass = `ld-theme-${theme}`;
  const allEmpty = rungs.every((r) => r.elements.length === 0);
  const noRungs = rungs.length === 0;
  const endRail = { railL: LD.margin, railR: baseW - LD.rightPad, width: baseW };
  const history = historyRef.current;

  return (
    <div className={cn('ld-root relative flex min-h-0 min-w-0 flex-col overflow-hidden', themeClass, online && running && 'ld-running', className)}>
      {props.showHeader !== false && (
        // container queries: at narrow widths the header drops labels (theme text, program name, zoom %)
        // and shortens the pills instead of wrapping them onto a second line
        <div
          className="@container flex h-9 shrink-0 items-center gap-1.5 overflow-hidden border-b border-[var(--ld-chrome-border)] bg-[var(--ld-chrome)] px-2 text-[12px] whitespace-nowrap text-[var(--ld-chrome-text)] @2xl:gap-2"
          data-testid="ld-header"
        >
          <RoutineIcon main size={15} className="shrink-0" />
          <span className="hidden min-w-0 truncate font-semibold @xl:inline" title={program}>
            {program}
          </span>
          <ChevronRight size={12} className="hidden shrink-0 text-[var(--ld-chrome-muted)] @xl:inline" />
          <span className="min-w-0 truncate font-semibold" title={`${program} ▸ ${routine}`}>
            {routine}
          </span>
          <span
            className={cn(
              'ml-1 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold',
              online
                ? faulted
                  ? 'border-red-500/40 bg-red-500/10 text-red-500'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                : 'border-[var(--ld-chrome-border)] text-[var(--ld-chrome-muted)]',
            )}
            title={online ? (running ? 'Online · Run mode' : faulted ? 'Online · Faulted' : 'Online · Program mode') : 'Offline'}
            data-testid="ld-status-pill"
          >
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', online ? (faulted ? 'animate-pulse bg-red-500' : 'animate-pulse bg-emerald-500') : 'bg-slate-500')} />
            {online ? (
              <>
                <span className="hidden @3xl:inline">Online · </span>
                {running ? 'Run' : faulted ? 'Faulted' : <><span className="hidden @3xl:inline">Program</span><span className="@3xl:hidden">Prog</span></>}
              </>
            ) : (
              'Offline'
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              const first = rungs.find((r) => errorsByRung.has(r.id));
              if (first) setSel({ rungId: first.id });
              focusEditor();
            }}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold',
              errorCount.e > 0
                ? 'border-red-500/40 bg-red-500/10 text-red-500'
                : errorCount.w > 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                  : 'border-[var(--ld-chrome-border)] text-[var(--ld-chrome-muted)]',
            )}
            title={`Verification results${errorCount.e > 0 || errorCount.w > 0 ? `: ${errorCount.e} error${errorCount.e === 1 ? '' : 's'}, ${errorCount.w} warning${errorCount.w === 1 ? '' : 's'}` : ''} — click to jump to the first rung with a problem`}
            data-testid="ld-verify-pill"
          >
            {errorCount.e > 0 ? <XCircle size={11} /> : errorCount.w > 0 ? <TriangleAlert size={11} /> : <CheckCircle2 size={11} className="text-emerald-500" />}
            {errorCount.e > 0 || errorCount.w > 0 ? (
              <>
                <span className="hidden @2xl:inline">
                  {`${errorCount.e} error${errorCount.e === 1 ? '' : 's'}, ${errorCount.w} warning${errorCount.w === 1 ? '' : 's'}`}
                </span>
                <span className="@2xl:hidden">{errorCount.e > 0 ? `${errorCount.e}${errorCount.w > 0 ? ` · ${errorCount.w}` : ''}` : errorCount.w}</span>
              </>
            ) : (
              <span className="hidden @md:inline">{errors ? 'Verified' : 'Not verified'}</span>
            )}
          </button>
          <div className="min-w-0 flex-1" />
          {props.headerExtra}
          {!readOnly && (
            <>
              <ChromeButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!history.canUndo} className="shrink-0">
                <Undo2 size={14} />
              </ChromeButton>
              <ChromeButton label="Redo (Ctrl+Y)" onClick={redo} disabled={!history.canRedo} className="shrink-0">
                <Redo2 size={14} />
              </ChromeButton>
              <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--ld-chrome-border)]" />
            </>
          )}
          <span className="hidden @lg:contents">
            <ChromeButton label="Zoom out (Ctrl+-)" onClick={() => setZoom(zoom - 0.1)} disabled={zoom <= ZOOM_MIN} className="shrink-0">
              <Minus size={13} />
            </ChromeButton>
          </span>
          <button
            type="button"
            className="w-11 shrink-0 cursor-pointer rounded text-center font-mono text-[11px] text-[var(--ld-chrome-muted)] hover:text-[var(--ld-chrome-text)]"
            onClick={() => setZoom(1)}
            title="Reset zoom (Ctrl+0)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <span className="hidden @lg:contents">
            <ChromeButton label="Zoom in (Ctrl++)" onClick={() => setZoom(zoom + 0.1)} disabled={zoom >= ZOOM_MAX} className="shrink-0">
              <Plus size={13} />
            </ChromeButton>
          </span>
          <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--ld-chrome-border)]" />
          <ChromeButton
            label={compactLabels ? 'Compact labels on: tag names only (hover a tag for its description) — click to show descriptions' : 'Compact labels: tag names only, descriptions on hover'}
            onClick={() => {
              const next = !compactLabels;
              setCompactState(next);
              props.onCompactLabelsChange?.(next);
            }}
            pressed={compactLabels}
            active={compactLabels}
            className="shrink-0"
            testId="ld-compact-labels"
          >
            {compactLabels ? <CaptionsOff size={14} /> : <Captions size={14} />}
            <span className="hidden text-[11px] @4xl:inline">{compactLabels ? 'Tags only' : 'Labels'}</span>
          </ChromeButton>
          <ChromeButton label={theme === 'dark' ? 'Studio 5000 classic look' : 'Dark look'} onClick={() => setTheme(theme === 'dark' ? 'classic' : 'dark')} className="shrink-0">
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span className="hidden text-[11px] @3xl:inline">{theme === 'dark' ? 'Classic' : 'Dark'}</span>
          </ChromeButton>
        </div>
      )}
      {(props.showToolbar ?? !readOnly) && (
        <InstructionToolbar onAction={onToolbar} {...(allowedInstructions ? { allowedInstructions } : {})} disabled={readOnly} helpTheme={theme} />
      )}
      <div
        ref={scrollRef}
        className={cn('ld-scroll relative min-h-0 flex-1 overflow-auto outline-none', ghost && 'ld-dragging')}
        tabIndex={0}
        role="application"
        aria-roledescription="ladder logic editor"
        aria-label={`Ladder editor — ${program} ${routine}`}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onMouseMove={onMouseMove}
        onMouseLeave={hideHover}
        onScroll={hover ? hideHover : undefined}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
        onDrop={onDrop}
        onCopy={onCopy}
        onCut={onCopy}
        onPaste={onPaste}
      >
        <div className="relative" style={{ width: Math.max(contentW, 1), minHeight: '100%' }}>
          {rungs.map((r, i) => {
            const layout = layouts[i]!;
            return (
              <RungRow
                key={r.id}
                rung={r}
                index={i}
                layout={layout}
                zoom={zoom}
                {...(sel?.rungId === r.id ? { selection: sel } : {})}
                {...(errorsByRung.has(r.id) ? { errors: errorsByRung.get(r.id)! } : {})}
                {...(forceOf ? { forceOf } : {})}
                forcesVersion={forcesVersion}
                {...(drop?.rungId === r.id ? { dropGap: drop.gap } : {})}
                showValues={showValues}
                {...(highlight ? { highlight } : {})}
                register={register}
                observe={observe}
                overlay={overlayFor(r, layout)}
              />
            );
          })}
          <div className="ld-row-end group relative" data-end-rung="" onDoubleClick={appendRung}>
            <EndRung width={endRail.width} zoom={zoom} railL={endRail.railL} railR={endRail.railR} separateMargin />
            <div className="ld-margin-pin">
              <MarginPlate railL={endRail.railL} height={LD.endHeight} zoom={zoom} />
            </div>
            {!readOnly && (
              <button
                type="button"
                onClick={appendRung}
                className="absolute top-1/2 -translate-y-1/2 cursor-pointer rounded-md border border-dashed border-[var(--ld-chrome-border)] bg-[var(--ld-bg)] px-2 py-0.5 text-[11px] text-[var(--ld-chrome-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--ld-sel)] hover:text-[var(--ld-sel)] focus-visible:opacity-100"
                style={{ left: (endRail.railL + 16) * zoom }}
              >
                + Add rung
              </button>
            )}
          </div>
          {allEmpty && !readOnly && (
            <div
              className="pointer-events-none mt-3 pr-4 pb-6 text-[12px] leading-relaxed text-[var(--ld-chrome-muted)]"
              style={{ marginLeft: Math.max(16, (endRail.railL + 24) * zoom) }}
            >
              <span className="font-semibold text-[var(--ld-chrome-text)]" data-testid="ld-empty-title">
                {noRungs ? 'This routine is empty' : 'No instructions yet'}
              </span>
              .{' '}
              {noRungs ? 'Pick an instruction from the toolbar' : `Click ${rungs.length === 1 ? 'the rung' : 'a rung'}`} and type{' '}
              <span className="font-mono font-semibold whitespace-nowrap text-[var(--ld-chrome-text)]" data-testid="ld-empty-example">{exampleEntry}</span> +{' '}
              <K>Enter</K>, or drag an instruction from the toolbar.
            </div>
          )}
        </div>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-[var(--ld-chrome-border)] bg-[var(--ld-chrome)] px-3 text-[11px] text-[var(--ld-chrome-muted)]">
        <span className="min-w-0 flex-1 truncate font-mono text-[var(--ld-chrome-text)]">{selectionInfo}</span>
        <span className="hidden items-center gap-1 lg:flex">
          <K>Enter</K> edit <K>type</K> insert <K>Del</K> delete <K>Ctrl+Z</K> undo {online && (<><K>Alt+T</K> toggle</>)} <K>F1</K> help
        </span>
        <span className="font-mono">{rungs.length} rung{rungs.length === 1 ? '' : 's'}</span>
      </div>
      <div aria-live="polite" className="sr-only">
        {selectionInfo}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menu.entries}
          themeClass={themeClass}
          onClose={() => {
            setMenu(null);
            // give the ladder its focus back — unless the chosen action opened an editor / dialog that
            // took it (read through refs: this runs after the action's state updates were rendered)
            requestAnimationFrame(() => {
              if (editingRef.current || modalOpenRef.current) return;
              const a = document.activeElement;
              if (!a || a === document.body || !a.isConnected) focusEditor();
            });
          }}
        />
      )}
      {hover && !menu && (
        <HoverCard x={hover.x} y={hover.y} themeClass={themeClass}>
          {hover.content}
        </HoverCard>
      )}
      {ghost && (
        <div className="ld-ghost rounded-md border border-[var(--ld-sel)] bg-[var(--ld-ov-bg)] px-2 py-1 font-mono text-[11px] text-[var(--ld-ov-text)] shadow-xl" style={{ left: ghost.x + 12, top: ghost.y + 10 }}>
          {ghost.label}
        </div>
      )}
      <Modal open={helpOp !== null} onClose={() => { setHelpOp(null); focusEditor(); }} title="Instruction help" size="lg">
        {helpOp && <InstructionHelp info={helpOp} theme={theme} />}
      </Modal>
      {controller && (
        <NewTagDialog
          controller={controller}
          program={program}
          request={newTag}
          onClose={() => {
            setNewTag(null);
            focusEditor();
          }}
          onCreated={() => {
            setTagVersion((v) => v + 1);
            onTagsChangedRef.current?.();
          }}
        />
      )}
    </div>
  );
}

