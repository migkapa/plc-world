import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'warning';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ab-red text-white hover:bg-red-500 shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] shadow-red-900/40',
  secondary: 'bg-panel-3 text-slate-100 hover:bg-slate-700 border border-edge',
  ghost: 'text-slate-300 hover:bg-white/5 hover:text-white',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500',
  danger: 'bg-red-700 text-white hover:bg-red-600',
  warning: 'bg-safety text-black hover:bg-yellow-300',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-xs gap-1 rounded',
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  active?: boolean;
}

/** Standard button. */
export function Button({ variant = 'secondary', size = 'md', icon, active, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-colors select-none',
        'focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        active && 'ring-1 ring-sky-400/60',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  active?: boolean;
  children: ReactNode;
}

/** Square icon-only button with an accessible label (also used as tooltip). */
export function IconButton({ label, size = 'sm', variant = 'ghost', active, className, children, ...rest }: IconButtonProps) {
  const dim = { xs: 'h-6 w-6', sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }[size];
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors',
        'focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        dim,
        active && 'bg-sky-500/15 text-sky-300',
        className,
      )}
    >
      {children}
    </button>
  );
}
