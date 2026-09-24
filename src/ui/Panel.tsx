import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Remove body padding (for tables, editors...). */
  flush?: boolean;
  bodyClassName?: string;
}

/** Dark card with an optional header bar. */
export function Panel({ title, icon, actions, flush, className, bodyClassName, children, ...rest }: PanelProps) {
  return (
    <section {...rest} className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border border-edge bg-panel-2', className)}>
      {(title || actions) && (
        <header className="flex h-9 shrink-0 items-center gap-2 border-b border-edge bg-panel-3/60 px-3 text-xs font-semibold tracking-wide text-slate-300 uppercase">
          {icon && <span className="text-slate-400">{icon}</span>}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {actions && <div className="flex items-center gap-1 normal-case">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', !flush && 'p-3', bodyClassName)}>{children}</div>
    </section>
  );
}
