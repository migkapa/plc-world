/**
 * Renders a device's demo controls (switches, momentary buttons, sliders, I/O point grids, readouts)
 * bound to its DemoStore.
 */
import { Gamepad2 } from 'lucide-react';
import { useCallback, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { sfx } from '../../audio/sfx';
import { cn } from '../../ui';
import { useDemoVersion, type ControlTone, type DemoControl, type DemoStore } from './demo';

const TONE_ON: Record<ControlTone, string> = {
  green: 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.55)]',
  red: 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.55)]',
  amber: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.55)]',
  blue: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.55)]',
  neutral: 'bg-slate-200 shadow-[0_0_10px_rgba(226,232,240,0.35)]',
};

const TONE_BTN: Record<ControlTone, string> = {
  green: 'border-emerald-500/40 bg-emerald-600/90 text-white hover:bg-emerald-500',
  red: 'border-red-500/40 bg-red-700/90 text-white hover:bg-red-600',
  amber: 'border-amber-400/40 bg-amber-500/90 text-black hover:bg-amber-400',
  blue: 'border-sky-400/40 bg-sky-600/90 text-white hover:bg-sky-500',
  neutral: 'border-edge bg-panel-3 text-slate-100 hover:bg-slate-700',
};

const TONE_TEXT: Record<ControlTone, string> = {
  green: 'text-emerald-300',
  red: 'text-red-300',
  amber: 'text-amber-300',
  blue: 'text-sky-300',
  neutral: 'text-slate-300',
};

export function DemoControls({ controls, demo, className, title = 'Try it' }: { controls: DemoControl[]; demo: DemoStore; className?: string; title?: string }) {
  useDemoVersion(demo);
  if (controls.length === 0) return null;
  return (
    <section className={cn('rounded-xl border border-edge bg-panel-2/95', className)} aria-label="Demo controls">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        <Gamepad2 size={14} className="text-ab-red" />
        {title}
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-2.5 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
        {controls.map((c, i) => (
          <ControlCell key={i} control={c} demo={demo} />
        ))}
      </div>
    </section>
  );
}

function Cell({ label, hint, children, wide }: { label?: ReactNode; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-lg border border-edge/70 bg-panel/60 px-2.5 py-2', wide && 'col-span-full sm:col-span-2')}>
      {label !== undefined && <div className="truncate text-[11px] font-medium text-slate-400">{label}</div>}
      {children}
      {hint && <div className="text-[10.5px] leading-snug text-slate-400">{hint}</div>}
    </div>
  );
}

function ControlCell({ control: c, demo }: { control: DemoControl; demo: DemoStore }) {
  switch (c.kind) {
    case 'toggle': {
      const on = demo.bool(c.key);
      return (
        <Cell label={c.label} hint={c.hint}>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={c.label}
            onClick={() => {
              demo.toggle(c.key);
              sfx.play('toggle');
            }}
            className="group flex cursor-pointer items-center gap-2 text-left focus-visible:outline-none"
          >
            <span className={cn('relative h-5 w-9 shrink-0 rounded-full border transition-colors', on ? 'border-white/20 bg-slate-700' : 'border-edge bg-slate-800', 'group-focus-visible:ring-2 group-focus-visible:ring-sky-400/70')}>
              <span className={cn('absolute top-[2px] h-3.5 w-3.5 rounded-full transition-all', on ? cn('left-[18px]', TONE_ON[c.tone ?? 'green']) : 'left-[2px] bg-slate-500')} />
            </span>
            <span className={cn('font-mono text-xs font-semibold', on ? TONE_TEXT[c.tone ?? 'green'] : 'text-slate-400')}>{on ? 'ON' : 'OFF'}</span>
          </button>
        </Cell>
      );
    }
    case 'momentary':
      return (
        <Cell label={c.label} hint={c.hint}>
          <MomentaryButton demo={demo} k={c.key} label={c.label} tone={c.tone ?? 'neutral'} />
        </Cell>
      );
    case 'select': {
      const current = c.value ? c.value(demo) : String(demo.get(c.key) ?? '');
      const disabled = c.disabled?.(demo) ?? false;
      return (
        <Cell label={c.label} hint={c.hint} wide={c.options.length > 4}>
          <div role="radiogroup" aria-label={c.label} aria-disabled={disabled || undefined} className="flex flex-wrap gap-1">
            {c.options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                disabled={disabled}
                aria-checked={current === o.value}
                onClick={() => {
                  if (c.onSet) c.onSet(demo, o.value);
                  else {
                    demo.set(c.key, o.value);
                    sfx.play('click');
                  }
                }}
                className={cn(
                  'h-7 cursor-pointer rounded-md border px-2 text-[11.5px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
                  current === o.value ? 'border-ab-red/60 bg-ab-red/20 text-white' : 'border-edge bg-panel-3/70 text-slate-400 hover:text-slate-100',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Cell>
      );
    }
    case 'slider': {
      const v = demo.num(c.key);
      const p = ((v - c.min) / (c.max - c.min)) * 100;
      return (
        <Cell
          label={
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate">{c.label}</span>
              <span className="font-mono text-xs font-semibold text-slate-100">
                {v.toFixed(c.digits ?? 0)} {c.unit}
              </span>
            </span>
          }
          hint={c.hint}
        >
          <input
            type="range"
            aria-label={c.label}
            min={c.min}
            max={c.max}
            step={c.step}
            value={v}
            onChange={(e) => demo.set(c.key, Number(e.target.value))}
            className="sr-range w-full cursor-pointer"
            style={{ ['--p' as string]: `${p}%` }}
          />
        </Cell>
      );
    }
    case 'points': {
      const bits = demo.bits(c.key);
      return (
        <Cell label={c.label} hint={c.hint} wide={c.count > 4}>
          <div className={cn('grid gap-1', c.count > 8 ? 'grid-cols-8' : 'grid-flow-col auto-cols-fr')}>
            {Array.from({ length: c.count }, (_, i) => (
              <button
                key={i}
                type="button"
                data-on={bits[i] === true}
                aria-pressed={bits[i] === true}
                aria-label={`${c.prefix ?? 'Point'} ${i}`}
                disabled={c.readOnly}
                onClick={() => {
                  demo.setBit(c.key, i, !bits[i]);
                  sfx.play('toggle');
                }}
                className="sr-point h-7 cursor-pointer rounded-md border border-edge bg-slate-800 font-mono text-[10.5px] font-semibold text-slate-400 transition-colors hover:border-slate-500 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
              >
                {c.prefix && c.count <= 4 ? `${c.prefix}${i}` : i}
              </button>
            ))}
          </div>
        </Cell>
      );
    }
    case 'action': {
      const disabled = c.disabled?.(demo) ?? false;
      return (
        <Cell hint={c.hint}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => c.run(demo)}
            className={cn(
              'h-8 cursor-pointer rounded-md border px-3 text-[12.5px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35',
              TONE_BTN[c.tone ?? 'neutral'],
            )}
          >
            {c.label}
          </button>
        </Cell>
      );
    }
    case 'readout': {
      const tone = c.tone?.(demo) ?? 'neutral';
      return (
        <Cell label={c.label}>
          <div className="flex min-h-8 items-center gap-2 rounded-md border border-edge bg-black/35 px-2 py-1">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', tone === 'neutral' ? 'bg-slate-600' : TONE_ON[tone])} />
            <span className={cn('font-mono text-[11.5px] leading-tight', TONE_TEXT[tone])}>{c.value(demo)}</span>
          </div>
        </Cell>
      );
    }
  }
}

function MomentaryButton({ demo, k, label, tone }: { demo: DemoStore; k: string; label: string; tone: ControlTone }) {
  const down = demo.bool(k);
  const set = useCallback(
    (v: boolean) => {
      if (demo.bool(k) === v) return;
      demo.set(k, v);
      sfx.play(v ? 'press' : 'release');
    },
    [demo, k],
  );
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    set(true);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, v: boolean) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      set(v);
    }
  };
  return (
    <button
      type="button"
      aria-pressed={down}
      aria-label={`${label} (hold)`}
      onPointerDown={onDown}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      onBlur={() => set(false)}
      className={cn(
        'h-8 cursor-pointer touch-none rounded-md border px-3 text-[12.5px] font-bold tracking-wide transition-all select-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        TONE_BTN[tone],
        down ? 'translate-y-px brightness-125' : 'shadow-[0_2px_0_rgba(0,0,0,0.45)]',
      )}
    >
      {down ? 'Pressed' : 'Hold'}
    </button>
  );
}
