import { Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

/** 0-3 star rating. */
export function Stars({ value, size = 16, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-0.5', className)} aria-label={`${value} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          size={size}
          className={i < value ? 'fill-yellow-400 text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.5)]' : 'text-slate-600'}
        />
      ))}
    </span>
  );
}

/** Horizontal progress bar (0..1). */
export function ProgressBar({ value, className, color = 'bg-emerald-500' }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-slate-800', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

/** Compact tab strip. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-edge px-2', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors',
            t.id === value ? 'border-ab-red text-white' : 'border-transparent text-slate-400 hover:text-slate-200',
          )}
        >
          {t.icon}
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

/** A little LED dot for DOM UIs. */
export function LedDot({ on, color = 'green', blink, className }: { on: boolean; color?: 'green' | 'red' | 'amber' | 'blue'; blink?: boolean; className?: string }) {
  const c = { green: 'bg-emerald-400 shadow-emerald-400/70', red: 'bg-red-500 shadow-red-500/70', amber: 'bg-amber-400 shadow-amber-400/70', blue: 'bg-sky-400 shadow-sky-400/70' }[color];
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full', on ? cn(c, 'shadow-[0_0_8px]') : 'bg-slate-700', on && blink && 'animate-pulse', className)} />;
}
