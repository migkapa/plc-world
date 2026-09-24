/**
 * Studio 5000-style instruction toolbar: a "Favorites" row (Rung, Branch, Branch Level, XIC, XIO,
 * OTE…) plus category tabs built from the INSTRUCTIONS metadata. Click inserts at the editor
 * selection; buttons can also be dragged onto a rung wire. Hover shows the instruction help card.
 */
import { Lock, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { INSTRUCTION_CATEGORIES, instructionsByCategory } from '@/plc/instructions';
import type { InstructionInfo } from '@/plc/types';
import { cn } from '@/ui/cn';
import { BranchGlyph, InstrGlyph, RungGlyph } from './glyphs';
import { InstructionHelp } from './InstructionHelp';

export type ToolbarAction = { type: 'rung' } | { type: 'branch' } | { type: 'branchLevel' } | { type: 'instr'; mnemonic: string };

/** Drag & drop MIME type carrying a mnemonic. */
export const INSTR_DRAG_TYPE = 'application/x-plc-instruction';

export const DEFAULT_FAVORITES = ['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'TON', 'TOF', 'RTO', 'CTU', 'CTD', 'RES', 'EQU', 'GRT', 'LES', 'MOV', 'ADD', 'CPT'];

export interface InstructionToolbarProps {
  onAction(action: ToolbarAction): void;
  /** When set, other instructions are shown locked. */
  allowedInstructions?: readonly string[];
  disabled?: boolean;
  favorites?: readonly string[];
  /** Theme of the example ladder in the hover help. */
  helpTheme?: 'dark' | 'classic';
  className?: string;
}

type TabId = 'Favorites' | InstructionInfo['category'];

const BY_CATEGORY = instructionsByCategory();

function useHoverHelp() {
  const [hover, setHover] = useState<{ op: string; rect: DOMRect; locked: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const enter = (op: string, el: HTMLElement, locked: boolean): void => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover({ op, rect: el.getBoundingClientRect(), locked }), hover ? 60 : 450);
  };
  const leave = (): void => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHover(null), 80);
  };
  const keep = (): void => window.clearTimeout(timer.current);
  return { hover, enter, leave, keep, close: () => setHover(null) };
}

function ToolButton({
  label,
  title,
  glyph,
  onClick,
  locked,
  disabled,
  dragOp,
  onEnter,
  onLeave,
  accent,
}: {
  label: string;
  title: string;
  glyph: ReactNode;
  onClick(): void;
  locked?: boolean;
  disabled?: boolean;
  dragOp?: string;
  onEnter?(el: HTMLElement): void;
  onLeave?(): void;
  accent?: boolean;
}) {
  const onDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    if (!dragOp || locked || disabled) {
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
      title={locked ? `${title} — locked in this mission` : title}
      aria-label={title}
      aria-disabled={locked || disabled}
      draggable={!!dragOp && !locked && !disabled}
      onDragStart={onDragStart}
      onClick={() => {
        if (!locked && !disabled) onClick();
      }}
      onMouseEnter={(e) => onEnter?.(e.currentTarget)}
      onMouseLeave={() => onLeave?.()}
      onFocus={(e) => onEnter?.(e.currentTarget)}
      onBlur={() => onLeave?.()}
      className={cn(
        'group relative flex h-[40px] min-w-[44px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-1.5 transition-colors',
        'focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        locked || disabled
          ? 'cursor-not-allowed text-[var(--ld-chrome-muted,#7b8a9c)] opacity-40'
          : 'cursor-pointer text-[var(--ld-chrome-text,#cbd5e1)] hover:bg-[var(--ld-ov-active,rgba(56,189,248,0.16))] active:scale-95',
        accent && !locked && !disabled && 'text-[var(--ld-sel,#38bdf8)]',
      )}
    >
      {glyph}
      <span className="font-mono text-[9.5px] leading-none font-semibold">{label}</span>
      {locked && <Lock size={9} className="absolute top-1 right-1 text-[var(--ld-chrome-muted,#7b8a9c)]" />}
    </button>
  );
}

export function InstructionToolbar({ onAction, allowedInstructions, disabled, favorites = DEFAULT_FAVORITES, helpTheme = 'dark', className }: InstructionToolbarProps) {
  const [tab, setTab] = useState<TabId>('Favorites');
  const [query, setQuery] = useState('');
  const help = useHoverHelp();
  const allowed = useMemo(() => (allowedInstructions ? new Set(allowedInstructions.map((a) => a.toUpperCase())) : undefined), [allowedInstructions]);
  const isLocked = (op: string): boolean => allowed !== undefined && !allowed.has(op);

  const list: InstructionInfo[] = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q) {
      return INSTRUCTION_CATEGORIES.flatMap((c) => BY_CATEGORY[c]).filter(
        (d) => d.mnemonic.includes(q) || d.name.toUpperCase().includes(q) || d.category.toUpperCase().includes(q),
      );
    }
    if (tab === 'Favorites') return favorites.map((m) => INSTRUCTION_CATEGORIES.flatMap((c) => BY_CATEGORY[c]).find((d) => d.mnemonic === m)).filter((d): d is InstructionInfo => !!d);
    return BY_CATEGORY[tab];
  }, [tab, query, favorites]);

  const tabs: TabId[] = ['Favorites', ...INSTRUCTION_CATEGORIES];

  return (
    <div
      className={cn('border-b border-[var(--ld-chrome-border,#232e3a)] bg-[var(--ld-chrome,#10161d)] select-none', className)}
      role="toolbar"
      aria-label="Instruction toolbar"
    >
      <div className="flex items-center gap-2 px-2 pt-1">
        <div role="tablist" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t && !query}
              onClick={() => {
                setTab(t);
                setQuery('');
              }}
              className={cn(
                '-mb-px shrink-0 cursor-pointer rounded-t-md border border-b-0 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors',
                tab === t && !query
                  ? 'border-[var(--ld-chrome-border,#232e3a)] bg-[var(--ld-chrome-2,#151c24)] text-[var(--ld-chrome-text,#cbd5e1)]'
                  : 'border-transparent text-[var(--ld-chrome-muted,#7b8a9c)] hover:text-[var(--ld-chrome-text,#cbd5e1)]',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="relative flex shrink-0 items-center">
          <Search size={12} className="pointer-events-none absolute left-2 text-[var(--ld-chrome-muted,#7b8a9c)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setQuery('');
              if (e.key === 'Enter' && list[0] && !isLocked(list[0].mnemonic)) onAction({ type: 'instr', mnemonic: list[0].mnemonic });
            }}
            placeholder="Find instruction"
            aria-label="Find instruction"
            className="h-6 w-36 rounded-md border border-[var(--ld-chrome-border,#232e3a)] bg-[var(--ld-ov-input,#0c1117)] pr-6 pl-6 text-[11px] text-[var(--ld-chrome-text,#cbd5e1)] outline-none placeholder:text-[var(--ld-chrome-muted,#7b8a9c)] focus:border-sky-500/70"
          />
          {query && (
            <button type="button" aria-label="Clear search" className="absolute right-1.5 cursor-pointer text-[var(--ld-chrome-muted,#7b8a9c)]" onClick={() => setQuery('')}>
              <X size={11} />
            </button>
          )}
        </label>
      </div>
      <div className="flex items-center gap-0.5 overflow-x-auto border-t border-[var(--ld-chrome-border,#232e3a)] bg-[var(--ld-chrome-2,#151c24)] px-1.5 py-0.5" style={{ scrollbarWidth: 'thin' }}>
        <ToolButton label="Rung" title="Add rung (Ctrl+R)" glyph={<RungGlyph width={30} height={14} />} onClick={() => onAction({ type: 'rung' })} disabled={disabled} accent />
        <ToolButton label="Branch" title="Add branch around the selection" glyph={<BranchGlyph width={30} height={14} />} onClick={() => onAction({ type: 'branch' })} disabled={disabled} accent />
        <ToolButton label="Level" title="Add branch level" glyph={<BranchGlyph width={30} height={14} level />} onClick={() => onAction({ type: 'branchLevel' })} disabled={disabled} accent />
        <div className="mx-1 h-7 w-px shrink-0 bg-[var(--ld-chrome-border,#232e3a)]" />
        {list.map((d) => (
          <ToolButton
            key={d.mnemonic}
            label={d.mnemonic}
            title={`${d.mnemonic} — ${d.name}`}
            glyph={<InstrGlyph op={d.mnemonic} width={30} height={14} />}
            onClick={() => {
              help.close();
              onAction({ type: 'instr', mnemonic: d.mnemonic });
            }}
            locked={isLocked(d.mnemonic)}
            disabled={disabled}
            dragOp={d.mnemonic}
            onEnter={(el) => help.enter(d.mnemonic, el, isLocked(d.mnemonic))}
            onLeave={help.leave}
          />
        ))}
        {list.length === 0 && <div className="px-3 py-3 text-[11px] text-[var(--ld-chrome-muted,#7b8a9c)]">No instruction matches “{query}”.</div>}
      </div>
      {help.hover &&
        createPortal(
          <div
            className="ld-pop fixed z-[85] w-[400px] rounded-xl border border-edge bg-panel-2/98 p-3 shadow-2xl shadow-black/60 backdrop-blur"
            style={{
              left: Math.max(8, Math.min(help.hover.rect.left - 12, window.innerWidth - 410)),
              top: help.hover.rect.bottom + 6,
            }}
            onMouseEnter={help.keep}
            onMouseLeave={help.leave}
          >
            <InstructionHelp info={help.hover.op} compact locked={help.hover.locked} theme={helpTheme} />
          </div>,
          document.body,
        )}
    </div>
  );
}
