/**
 * Compact controls for the 3D view's HUD: a square icon button and a small dropdown menu, both sized to sit in a
 * single toolbar row over the scene (dark translucent chips, 28 px tall).
 */
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../ui';

const CHIP = 'pointer-events-auto flex h-7 cursor-pointer items-center rounded-lg border backdrop-blur transition-colors';
const IDLE = 'border-white/10 bg-black/50 text-slate-200 hover:bg-black/70 hover:text-white';

/** Icon-only HUD button; `label` is both the tooltip and the accessible name. */
export function HudIconButton({
  label,
  onClick,
  active,
  tone = 'sky',
  badge,
  children,
  className,
  testId,
}: {
  label: string;
  onClick(): void;
  active?: boolean;
  tone?: 'sky' | 'emerald' | 'amber';
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const on = {
    sky: 'border-sky-400/50 bg-sky-500/25 text-sky-100',
    emerald: 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100',
    amber: 'border-amber-400/60 bg-amber-500/25 text-amber-100',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-testid={testId}
      className={cn(CHIP, 'relative justify-center', badge ? 'gap-1 px-2' : 'w-7', active ? on : IDLE, className)}
    >
      {children}
      {badge !== undefined && badge !== null && <span className="font-mono text-[10.5px] font-bold">{badge}</span>}
    </button>
  );
}

export interface HudMenuItem {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
}

/** Button showing the current choice; opens a small menu below it. Closes on pick, Escape or a click outside. */
export function HudMenu({
  icon,
  value,
  label,
  items,
  selected,
  onPick,
  align = 'left',
  header,
  className,
}: {
  icon?: ReactNode;
  /** Text shown on the button (the current choice). */
  value: ReactNode;
  /** Accessible name / tooltip. */
  label: string;
  items: ReadonlyArray<HudMenuItem>;
  selected?: string | null;
  onPick(id: string): void;
  align?: 'left' | 'right';
  header?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className={cn('pointer-events-auto relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={cn(CHIP, IDLE, 'gap-1.5 pr-1.5 pl-2 text-[11px] font-semibold whitespace-nowrap')}
      >
        {icon}
        <span className="max-w-[9rem] truncate">{value}</span>
        <ChevronDown size={12} className={cn('text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute top-8 z-30 min-w-40 overflow-hidden rounded-lg border border-edge bg-panel-2/95 py-1 shadow-2xl backdrop-blur',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {header && <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{header}</div>}
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected === it.id}
              onClick={() => {
                onPick(it.id);
                setOpen(false);
              }}
              className={cn(
                'flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-left text-xs whitespace-nowrap',
                selected === it.id ? 'bg-sky-500/15 text-sky-200' : 'text-slate-200 hover:bg-white/5',
              )}
            >
              <span>{it.label}</span>
              {it.hint && <span className="text-[10.5px] text-slate-500">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
