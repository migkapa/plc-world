/**
 * Floating UI used by the ladder editor: autocomplete input, context menu, hover card and the
 * rung text / comment editors. Styled with the ladder theme variables (--ld-ov-*).
 */
import { CornerDownLeft } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';

// ---------------------------------------------------------------------------
// Autocomplete input
// ---------------------------------------------------------------------------

export interface AutoItem {
  key: string;
  /** Text inserted when the item is accepted. */
  value: string;
  primary: string;
  secondary?: string;
  /** Right-aligned meta (data type…). */
  right?: string;
  badge?: string;
  /** Accepting inserts `value.` and keeps editing (structure members, bits). */
  expandable?: boolean;
  disabled?: boolean;
  /** Special rows (e.g. 'newTag': "New tag 'Motor' (BOOL)…"); passed back to onCommit. */
  action?: string;
  /** Emphasised row (drawn with an accent). */
  accent?: boolean;
}

export type CommitHow = 'enter' | 'tab' | 'shift-tab' | 'blur';

/**
 * What Enter takes with `enterTakesPrefixMatch` when no row is highlighted: the first selectable suggestion that
 * starts with the typed text (case-insensitive) — the same row Tab completes to — unless the typed text is itself
 * a suggestion (then it is kept). Action rows such as "New tag" are never taken implicitly.
 */
export function prefixMatch(items: readonly AutoItem[], value: string): AutoItem | undefined {
  const typed = value.trim().toLowerCase();
  if (typed === '') return undefined;
  const pickable = items.filter((i) => !i.action && !i.disabled);
  if (pickable.some((i) => i.value.toLowerCase() === typed)) return undefined;
  return pickable.find((i) => i.value.toLowerCase().startsWith(typed));
}

/**
 * Text input with a suggestion list.
 *
 * Keys: Enter commits the row highlighted with ↑/↓; without a highlight it commits what was TYPED (an exact
 * case-insensitive match in the item's spelling) — or, with `enterTakesPrefixMatch`, the first suggestion that
 * starts with the typed text (marked "↵").
 * Tab completes to the highlighted row, or to the first suggestion extending the typed text (marked
 * "Tab"). Mouse click picks a row. Esc cancels.
 */
export interface AutocompleteInputProps {
  value: string;
  onChange(value: string): void;
  items: readonly AutoItem[];
  /** Return false to reject the value and keep editing. `item` is the picked row (if any). */
  onCommit(value: string, how: CommitHow, item?: AutoItem): void | boolean;
  onCancel(): void;
  /** Custom accept (e.g. replace the current token); default: expandable → `value.`, else commit. */
  onAccept?(item: AutoItem, how: CommitHow): void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  inputClassName?: string;
  error?: string | null;
  /** Line shown above the suggestions (operand name / data type…). */
  header?: ReactNode;
  /** Line below the suggestions; a function gets the row Enter will take (highlighted with ↑/↓, or the prefix match). */
  footer?: ReactNode | ((highlighted: AutoItem | undefined) => ReactNode);
  /** Select the whole text on open. */
  selectAll?: boolean;
  /** Commit when the input loses focus (default true). */
  commitOnBlur?: boolean;
  listClassName?: string;
  ariaLabel?: string;
  /**
   * Enter with no highlighted row takes the first selectable row that starts with the typed text (like an IDE:
   * typing "sw" + Enter picks Switch_0, as Tab does). The typed text is kept when it matches a row exactly or
   * nothing starts with it; action rows (e.g. "New tag") are taken only when highlighted.
   */
  enterTakesPrefixMatch?: boolean;
}

export function AutocompleteInput(p: AutocompleteInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const { items, value } = p;
  /**
   * Row highlighted with ↑/↓ (-1: none — Enter commits the typed text). The highlight belongs to the list and text
   * it was made on: typing (or new suggestions) drops it. Derived during render, never reset from an effect — a
   * setState in a passive effect after every keystroke left an update pending per key, and ~50 keystrokes queued
   * behind a slow frame tripped React's nested-update limit (#185) and lost a character.
   */
  const [hl, setHl] = useState<{ index: number; items: readonly AutoItem[]; value: string }>(() => ({ index: -1, items, value }));
  const active = hl.items === items && hl.value === value ? hl.index : -1;
  const moveActive = (next: (a: number) => number): void => setHl((h) => ({ index: next(h.items === items && h.value === value ? h.index : -1), items, value }));

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (p.selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const token = (value.split(/\s+/).pop() ?? '').toLowerCase();
  /** Tab-completion candidate: the first enabled row that extends the last typed token. */
  const candidate = token === '' ? -1 : items.findIndex((i) => !i.disabled && !i.action && i.value.toLowerCase().startsWith(token) && i.value.toLowerCase() !== token);
  /** What Enter takes without a highlighted row (`enterTakesPrefixMatch`). */
  const enterPick = p.enterTakesPrefixMatch && !p.onAccept ? prefixMatch(items, value) : undefined;

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const accept = (item: AutoItem, how: CommitHow): void => {
    if (item.disabled) return;
    if (p.onAccept && !item.action) {
      p.onAccept(item, how);
      return;
    }
    // structures / arrays / integers with bits: drill into the members (Tab on "Blink" → "Blink_Timer.")
    if (item.expandable) {
      p.onChange(`${item.value}.`);
      return;
    }
    commit(item.value, how, item);
  };

  const commit = (v: string, how: CommitHow, item?: AutoItem): void => {
    if (done.current) return;
    done.current = true;
    if (p.onCommit(v, how, item) === false) done.current = false;
  };

  /** Enter / Tab without a highlighted row: the typed text, in an exact match's spelling. */
  const commitTyped = (how: CommitHow): void => {
    if (how === 'enter' && enterPick) {
      accept(enterPick, how);
      return;
    }
    const typed = value.trim().toLowerCase();
    const exact = !p.onAccept && typed !== '' ? items.find((i) => !i.action && !i.disabled && i.value.toLowerCase() === typed) : undefined;
    commit(exact ? exact.value : value, how);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) moveActive((a) => (a + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) moveActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = active >= 0 ? items[active] : undefined;
      if (it) accept(it, 'enter');
      else commitTyped('enter');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const how: CommitHow = e.shiftKey ? 'shift-tab' : 'tab';
      const pick = e.shiftKey ? -1 : active >= 0 ? active : candidate;
      const it = pick >= 0 ? items[pick] : undefined;
      if (it && (it.action || it.value.toLowerCase() !== value.trim().toLowerCase())) accept(it, how);
      else commitTyped(how);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      p.onCancel();
    }
  };

  return (
    <div className={cn('ld-pop absolute z-30', p.className)} style={p.style} onMouseDown={(e) => e.stopPropagation()}>
      <div
        className={cn(
          'flex items-center gap-1 rounded-md border bg-[var(--ld-ov-input)] px-1.5 shadow-lg shadow-black/30',
          p.error ? 'border-red-500/80' : 'border-[var(--ld-sel)]',
        )}
      >
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label={p.ariaLabel ?? 'Operand'}
          aria-autocomplete="list"
          aria-invalid={p.error ? true : undefined}
          placeholder={p.placeholder}
          onChange={(e) => {
            done.current = false;
            p.onChange(e.target.value);
          }}
          onKeyDown={onKey}
          onBlur={() => {
            if (p.commitOnBlur !== false && !done.current) commit(value, 'blur');
          }}
          className={cn('h-7 min-w-0 flex-1 bg-transparent font-mono text-[12px] font-semibold text-[var(--ld-ov-text)] outline-none placeholder:font-normal placeholder:text-[var(--ld-ov-muted)]', p.inputClassName)}
        />
        <CornerDownLeft size={12} className="shrink-0 text-[var(--ld-ov-muted)]" />
      </div>
      {p.error && <div className="mt-1 rounded bg-red-950/90 px-2 py-1 text-[11px] text-red-200 shadow">{p.error}</div>}
      {(items.length > 0 || p.header || p.footer) && (
        <div className={cn('mt-1 overflow-hidden rounded-md border border-[var(--ld-ov-border)] bg-[var(--ld-ov-bg)] shadow-xl shadow-black/40', p.listClassName)}>
          {p.header && <div className="border-b border-[var(--ld-ov-border)] bg-[var(--ld-ov-bg-2)] px-2 py-1 text-[10.5px] text-[var(--ld-ov-muted)]">{p.header}</div>}
          {items.length > 0 && (
            <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-0.5">
              {items.map((it, i) => (
                <div
                  key={it.key}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={it.disabled}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(it, 'enter');
                  }}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 px-2 py-1 hover:bg-[var(--ld-ov-hover)]',
                    i === active && 'bg-[var(--ld-ov-active)] hover:bg-[var(--ld-ov-active)]',
                    it.accent && 'border-b border-[var(--ld-ov-border)]',
                    it.disabled && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('truncate text-[12px] font-semibold', it.accent ? 'font-sans text-[var(--ld-sel)]' : 'font-mono text-[var(--ld-ov-text)]')}>{it.primary}</span>
                      {it.expandable && <span className="text-[10px] text-[var(--ld-ov-muted)]">▸</span>}
                      {it.badge && (
                        <span className="rounded bg-[var(--ld-ov-bg-2)] px-1 text-[9.5px] font-semibold text-[var(--ld-ov-muted)]">{it.badge}</span>
                      )}
                      {active < 0 && (it === enterPick || i === candidate) && (
                        <span
                          className="ml-auto rounded border border-[var(--ld-ov-border)] px-1 font-mono text-[9px] leading-[13px] text-[var(--ld-ov-muted)]"
                          title={it === enterPick ? 'Press Enter (or Tab) to use it' : 'Press Tab to complete'}
                          data-enter-pick={it === enterPick ? '' : undefined}
                        >
                          {it === enterPick ? '↵ Tab' : 'Tab'}
                        </span>
                      )}
                    </div>
                    {it.secondary && <div className="truncate text-[10.5px] leading-4 text-[var(--ld-ov-muted)]">{it.secondary}</div>}
                  </div>
                  {it.right && <span className="shrink-0 pt-0.5 font-mono text-[10px] text-[var(--ld-ov-muted)]">{it.right}</span>}
                </div>
              ))}
            </div>
          )}
          {p.footer && (
            <div className="border-t border-[var(--ld-ov-border)] px-2 py-1 text-[10px] text-[var(--ld-ov-muted)]">
              {typeof p.footer === 'function' ? p.footer(active >= 0 ? items[active] : enterPick) : p.footer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
  onSelect(): void;
}

export type MenuEntry = MenuItem | 'sep' | { heading: string };

export function ContextMenu({ x, y, entries, onClose, themeClass }: { x: number; y: number; entries: MenuEntry[]; onClose(): void; themeClass?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(-1);
  const items = useMemo(() => entries.map((e, i) => ({ e, i })).filter((x): x is { e: MenuItem; i: number } => typeof x.e === 'object' && 'onSelect' in x.e), [entries]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - r.width - 8);
    const ny = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    setPos({ x: Math.max(8, nx), y: ny });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const blur = (): void => onClose();
    window.addEventListener('mousedown', down, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, [onClose]);

  const run = (it: MenuItem): void => {
    if (it.disabled) return;
    // run the action first (it may open an editor that takes focus), then close the menu
    try {
      it.onSelect();
    } catch (e) {
      toast({ tone: 'error', title: `${it.label} failed`, body: e instanceof Error ? e.message : String(e) });
    } finally {
      onClose();
    }
  };

  return createPortal(
    <div className={cn('ld-root', themeClass)} style={{ background: 'transparent' }}>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        className="ld-pop fixed z-[80] min-w-56 rounded-lg border border-[var(--ld-ov-border)] bg-[var(--ld-ov-bg)] py-1 text-[12.5px] text-[var(--ld-ov-text)] shadow-2xl shadow-black/50 outline-none"
        style={{ left: pos.x, top: pos.y }}
        onKeyDown={(e) => {
          e.stopPropagation();
          const enabled = items.filter((x) => !x.e.disabled);
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (enabled.length === 0) return;
            const cur = enabled.findIndex((x) => x.i === active);
            const next = e.key === 'ArrowDown' ? (cur + 1) % enabled.length : cur <= 0 ? enabled.length - 1 : cur - 1;
            setActive(enabled[next]!.i);
          } else if (e.key === 'Enter') {
            const it = items.find((x) => x.i === active);
            if (it) run(it.e);
          }
        }}
      >
        {entries.map((e, i) => {
          if (e === 'sep') return <div key={i} className="my-1 border-t border-[var(--ld-ov-border)]" />;
          if ('heading' in e)
            return (
              <div key={i} className="px-3 pt-1 pb-0.5 text-[10px] font-semibold tracking-wider text-[var(--ld-ov-muted)] uppercase">
                {e.heading}
              </div>
            );
          return (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={e.disabled}
              title={e.hint}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(e)}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left disabled:cursor-default disabled:opacity-40',
                active === i && !e.disabled && 'bg-[var(--ld-ov-active)]',
                e.danger && 'text-red-400',
              )}
            >
              <span className="flex w-4 justify-center text-[var(--ld-ov-muted)]">{e.icon}</span>
              <span className="flex-1">{e.label}</span>
              {e.shortcut && <span className="font-mono text-[10.5px] text-[var(--ld-ov-muted)]">{e.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Hover card
// ---------------------------------------------------------------------------

export function HoverCard({ x, y, children, themeClass }: { x: number; y: number; children: ReactNode; themeClass?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: x + 14, y: y + 16 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x + 14;
    let ny = y + 18;
    if (nx + r.width > window.innerWidth - 8) nx = Math.max(8, x - r.width - 10);
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, y - r.height - 10);
    setPos({ x: nx, y: ny });
  }, [x, y, children]);
  return createPortal(
    <div className={cn('ld-root', themeClass)} style={{ background: 'transparent' }}>
      <div
        ref={ref}
        role="tooltip"
        className="ld-pop pointer-events-none fixed z-[75] max-w-sm rounded-lg border border-[var(--ld-ov-border)] bg-[var(--ld-ov-bg)] px-3 py-2 text-[12px] text-[var(--ld-ov-text)] shadow-2xl shadow-black/50"
        style={{ left: pos.x, top: pos.y }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Rung text editor & comment editor
// ---------------------------------------------------------------------------

export function RungTextEditor({
  initial,
  validate,
  onCommit,
  onCancel,
  style,
}: {
  initial: string;
  /** Returns an error message (and the character position) or null. */
  validate(text: string): { message: string; position?: number } | null;
  onCommit(text: string): void;
  onCancel(): void;
  style?: CSSProperties;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const err = useMemo(() => validate(text), [text, validate]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const lines = Math.min(6, Math.max(2, Math.ceil(text.length / 90) + 1));
  return (
    <div className="ld-pop absolute z-30" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg border border-[var(--ld-sel)] bg-[var(--ld-ov-bg)] p-2 shadow-2xl shadow-black/40">
        <div className="mb-1 flex items-center gap-2 text-[10.5px] text-[var(--ld-ov-muted)]">
          <span className="font-semibold tracking-wide text-[var(--ld-ov-text)] uppercase">Edit rung (neutral text)</span>
          <span>e.g. XIC(Start_PB)[XIC(Motor),XIC(Jog)]XIO(Stop_PB)OTE(Motor);</span>
        </div>
        <textarea
          ref={ref}
          value={text}
          rows={lines}
          spellCheck={false}
          aria-label="Rung neutral text"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!err) onCommit(text);
            }
          }}
          className={cn(
            'block w-full resize-y rounded border bg-[var(--ld-ov-input)] px-2 py-1.5 font-mono text-[12px] leading-5 text-[var(--ld-ov-text)] outline-none',
            err ? 'border-red-500/70' : 'border-[var(--ld-ov-border)] focus:border-[var(--ld-sel)]',
          )}
        />
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          {err ? (
            <span className="min-w-0 flex-1 truncate text-red-400" role="alert" title={err.message}>
              {err.message}
              {err.position !== undefined && (
                <button
                  type="button"
                  className="ml-1.5 cursor-pointer rounded bg-red-500/15 px-1 font-mono text-[10.5px] text-red-300 hover:bg-red-500/25"
                  title="Show where"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const el = ref.current;
                    if (!el || err.position === undefined) return;
                    const end = /^[A-Za-z_]\w*/.exec(text.slice(err.position))?.[0].length ?? 1;
                    el.focus();
                    el.setSelectionRange(err.position, err.position + Math.max(1, end));
                  }}
                >
                  col {err.position + 1}
                </button>
              )}
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-emerald-400">✓ Valid rung</span>
          )}
          <span className="text-[var(--ld-ov-muted)]">Enter accept · Esc cancel</span>
          <button
            type="button"
            className="cursor-pointer rounded bg-[var(--ld-sel)] px-2 py-0.5 font-semibold text-white disabled:opacity-40"
            disabled={!!err}
            onClick={() => onCommit(text)}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

export function CommentEditor({ initial, onCommit, onCancel, style }: { initial: string; onCommit(text: string, viaBlur?: boolean): void; onCancel(): void; style?: CSSProperties }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  const finish = (save: boolean, viaBlur = false): void => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(text, viaBlur);
    else onCancel();
  };
  return (
    <div className="ld-pop absolute z-30" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg border border-[var(--ld-sel)] bg-[var(--ld-ov-bg)] p-2 shadow-2xl shadow-black/40">
        <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-[var(--ld-ov-text)] uppercase">Rung comment</div>
        <textarea
          ref={ref}
          value={text}
          rows={3}
          aria-label="Rung comment"
          placeholder="Describe what this rung does…"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => finish(true, true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              finish(false);
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              finish(true);
            }
          }}
          className="block w-full resize-y rounded border border-[var(--ld-ov-border)] bg-[var(--ld-ov-input)] px-2 py-1.5 text-[12.5px] leading-5 text-[var(--ld-ov-text)] outline-none focus:border-[var(--ld-sel)]"
        />
        <div className="mt-1 text-right text-[10.5px] text-[var(--ld-ov-muted)]">Ctrl+Enter save · Esc cancel</div>
      </div>
    </div>
  );
}
