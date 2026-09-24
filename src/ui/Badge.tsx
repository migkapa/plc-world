import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'violet';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-700/60 text-slate-200 border-slate-600/60',
  green: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  red: 'bg-red-500/15 text-red-300 border-red-500/30',
  amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  blue: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
}

/** Small pill label (instruction chips, statuses...). */
export function Badge({ tone = 'neutral', mono, className, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-semibold',
        mono && 'font-mono',
        TONES[tone],
        className,
      )}
    />
  );
}

/** Keyboard key hint. */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      {...rest}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-slate-600 bg-slate-800 px-1 font-mono text-[10px] text-slate-300 shadow-[0_1px_0_#475569]',
        className,
      )}
    />
  );
}
