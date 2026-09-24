/**
 * Operator control pad: DOM controls for a scene's ControlDefs (momentary = hold, maintained = toggle,
 * selector = segmented, analog = slider, fault = instructor toggle) plus keyboard shortcuts from
 * `ControlDef.key` (active while focus is not in a text field or the ladder editor).
 */
import { ChevronDown, ChevronUp, Gamepad2, Keyboard, OctagonAlert, SlidersHorizontal, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { sfx } from '../../audio/sfx';
import type { ControlDef, SimRuntime } from '../../sim/types';
import { Kbd, cn } from '../../ui';
import { isTypingTarget, modalOpen, useHotkeysPaused, useRuntimeValue } from './hooks';

type Tone = 'green' | 'red' | 'amber' | 'blue' | 'slate' | 'white';

const TONE_BTN: Record<Tone, string> = {
  green: 'bg-gradient-to-b from-emerald-500 to-emerald-700 text-white shadow-emerald-900/50',
  red: 'bg-gradient-to-b from-red-500 to-red-700 text-white shadow-red-900/50',
  amber: 'bg-gradient-to-b from-amber-400 to-amber-600 text-black shadow-amber-900/50',
  blue: 'bg-gradient-to-b from-sky-500 to-sky-700 text-white shadow-sky-900/50',
  slate: 'bg-gradient-to-b from-slate-600 to-slate-800 text-white shadow-black/50',
  white: 'bg-gradient-to-b from-slate-100 to-slate-300 text-slate-900 shadow-black/40',
};

/** Colour of a control from its id / label (green start, red stop, black jog…). */
export function controlTone(c: Pick<ControlDef, 'id' | 'label'>): Tone {
  const s = `${c.id} ${c.label}`.toLowerCase();
  if (/e-?stop|emergency/.test(s)) return 'red';
  if (/\bstop\b|red|trip/.test(s)) return 'red';
  if (/start|green|\brun\b/.test(s)) return 'green';
  if (/amber|yellow|reset|discharge/.test(s)) return 'amber';
  if (/ped|ticket|spawn|car|blue/.test(s)) return 'blue';
  if (/white/.test(s)) return 'white';
  return 'slate';
}

const isEstop = (c: Pick<ControlDef, 'id' | 'label'>): boolean => /e-?stop|emergency/i.test(`${c.id} ${c.label}`);

function playFor(c: ControlDef, on: boolean): void {
  if (c.type === 'momentary') sfx.play(on ? 'press' : 'release');
  else if (c.type === 'maintained' || c.type === 'fault') sfx.play(isEstop(c) ? 'press' : 'toggle');
  else if (c.type === 'selector') sfx.play('toggle');
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

/** Keyboard shortcuts for controls with a `key` (momentary: hold the key; maintained: toggle; selector: next position). */
export function useControlHotkeys(runtime: SimRuntime | null | undefined, controls: ReadonlyArray<ControlDef>, enabled = true): void {
  const held = useRef(new Set<string>());
  useEffect(() => {
    if (!runtime || !enabled) return;
    const byKey = new Map<string, ControlDef>();
    for (const c of controls) if (c.key && c.type !== 'analog') byKey.set(c.key.toLowerCase(), c);
    if (byKey.size === 0) return;
    const heldSet = held.current;
    const releaseAll = (): void => {
      for (const id of heldSet) runtime.setControl(id, false);
      heldSet.clear();
    };
    const down = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || modalOpen()) return;
      const c = byKey.get(e.key.toLowerCase());
      if (!c) return;
      e.preventDefault();
      if (e.repeat) return;
      if (c.type === 'momentary') {
        heldSet.add(c.id);
        runtime.setControl(c.id, true);
        playFor(c, true);
      } else if (c.type === 'selector') {
        const n = c.positions?.length ?? 2;
        runtime.setControl(c.id, (Number(runtime.getControl(c.id)) + 1) % n);
        playFor(c, true);
      } else {
        const v = !runtime.getControl(c.id);
        runtime.setControl(c.id, v);
        playFor(c, v);
      }
    };
    const up = (e: KeyboardEvent): void => {
      const c = byKey.get(e.key.toLowerCase());
      if (!c || c.type !== 'momentary' || !heldSet.has(c.id)) return;
      heldSet.delete(c.id);
      runtime.setControl(c.id, false);
      playFor(c, false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
      releaseAll();
    };
  }, [runtime, controls, enabled]);
}

// ---------------------------------------------------------------------------
// Individual controls
// ---------------------------------------------------------------------------

function MomentaryButton({ c, runtime }: { c: ControlDef; runtime: SimRuntime }) {
  const on = useRuntimeValue(runtime, () => runtime.getControl(c.id) === true);
  const pressedRef = useRef(false);
  const press = (): void => {
    if (pressedRef.current) return;
    pressedRef.current = true;
    runtime.setControl(c.id, true);
    playFor(c, true);
  };
  const release = (): void => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    runtime.setControl(c.id, false);
    playFor(c, false);
  };
  useEffect(() => () => void (pressedRef.current && runtime.setControl(c.id, false)), [runtime, c.id]);
  const tone = controlTone(c);
  return (
    <button
      type="button"
      title={`${c.label}${c.description ? ` — ${c.description}` : ''} (hold${c.key ? `, key ${c.key.toUpperCase()}` : ''})`}
      aria-pressed={on}
      data-control={c.id}
      onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          press();
        }
      }}
      onKeyUp={(e: ReactKeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') release();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'group relative flex h-9 cursor-pointer touch-none items-center gap-2 rounded-lg border border-white/10 pr-2 pl-1 text-xs font-semibold select-none',
        'bg-black/40 text-slate-100 hover:bg-black/55 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        on && 'border-white/40 bg-black/70',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full shadow-md ring-2 ring-black/40 transition-transform',
          TONE_BTN[tone],
          on ? 'translate-y-px scale-90 brightness-125' : 'group-hover:brightness-110',
        )}
      />
      <span className="whitespace-nowrap">{c.label}</span>
      {c.key && <Kbd>{c.key.toUpperCase()}</Kbd>}
    </button>
  );
}

function ToggleControl({ c, runtime, instructor }: { c: ControlDef; runtime: SimRuntime; instructor?: boolean }) {
  const on = useRuntimeValue(runtime, () => runtime.getControl(c.id) === true);
  const estop = isEstop(c);
  const label = estop ? (on ? 'PUSHED' : 'Released') : on ? 'ON' : 'OFF';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-control={c.id}
      title={`${c.label}${c.description ? ` — ${c.description}` : ''} (click to ${estop ? (on ? 'pull out' : 'push') : 'toggle'}${c.key ? `, key ${c.key.toUpperCase()}` : ''})`}
      onClick={() => {
        runtime.setControl(c.id, !on);
        playFor(c, !on);
      }}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2 text-xs font-semibold select-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        instructor
          ? on
            ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
            : 'border-white/10 bg-black/40 text-slate-300 hover:bg-black/55'
          : estop && on
            ? 'border-red-400/70 bg-red-600/30 text-red-100'
            : 'border-white/10 bg-black/40 text-slate-100 hover:bg-black/55',
      )}
    >
      {estop ? (
        <OctagonAlert size={18} className={cn('shrink-0', on ? 'text-red-400' : 'text-red-500/80')} />
      ) : instructor ? (
        <Wrench size={14} className={on ? 'text-amber-300' : 'text-slate-500'} />
      ) : (
        <span className={cn('relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-emerald-500' : 'bg-slate-600')}>
          <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]', on ? 'left-3.5' : 'left-0.5')} />
        </span>
      )}
      <span className="whitespace-nowrap">{c.label}</span>
      <span className={cn('font-mono text-[10px]', on ? (estop ? 'text-red-300' : instructor ? 'text-amber-300' : 'text-emerald-300') : 'text-slate-500')}>{label}</span>
      {c.key && <Kbd>{c.key.toUpperCase()}</Kbd>}
    </button>
  );
}

function SelectorControl({ c, runtime }: { c: ControlDef; runtime: SimRuntime }) {
  const v = useRuntimeValue(runtime, () => Number(runtime.getControl(c.id)));
  const positions = c.positions ?? ['0', '1'];
  return (
    <div className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/40 pr-1 pl-2 text-xs" data-control={c.id} title={c.description ?? c.label}>
      <span className="font-semibold whitespace-nowrap text-slate-100">{c.label}</span>
      <div role="radiogroup" aria-label={c.label} className="flex overflow-hidden rounded-md border border-white/10">
        {positions.map((p, i) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={v === i}
            onClick={() => {
              runtime.setControl(c.id, i);
              playFor(c, true);
            }}
            className={cn(
              'cursor-pointer px-2 py-1 font-mono text-[10.5px] font-bold whitespace-nowrap',
              v === i ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:bg-white/10 hover:text-white',
            )}
          >
            {p}
          </button>
        ))}
      </div>
      {c.key && <Kbd>{c.key.toUpperCase()}</Kbd>}
    </div>
  );
}

function AnalogControl({ c, runtime }: { c: ControlDef; runtime: SimRuntime }) {
  const [min, max] = c.range ?? [0, 100];
  const step = max - min <= 20 ? 1 : (max - min) / 200;
  const v = useRuntimeValue(runtime, () => Number(runtime.getControl(c.id)));
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2 text-xs" data-control={c.id} title={c.description ?? c.label}>
      <SlidersHorizontal size={13} className="shrink-0 text-sky-300" />
      <span className="font-semibold whitespace-nowrap text-slate-100">{c.label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(v) ? v : min}
        onChange={(e) => runtime.setControl(c.id, Number(e.target.value))}
        className="w-28 accent-sky-500"
        aria-label={c.label}
      />
      <span className="w-14 text-right font-mono text-[11px] text-sky-200">
        {Number.isFinite(v) ? (Number.isInteger(step) ? v.toFixed(0) : v.toFixed(1)) : '—'}
        {c.units ? <span className="text-slate-400"> {c.units}</span> : null}
      </span>
    </label>
  );
}

/** One control of any type. */
export function ControlWidget({ c, runtime, instructor }: { c: ControlDef; runtime: SimRuntime; instructor?: boolean }) {
  switch (c.type) {
    case 'momentary':
      return <MomentaryButton c={c} runtime={runtime} />;
    case 'selector':
      return <SelectorControl c={c} runtime={runtime} />;
    case 'analog':
      return <AnalogControl c={c} runtime={runtime} />;
    case 'fault':
      return <ToggleControl c={c} runtime={runtime} instructor />;
    default:
      return <ToggleControl c={c} runtime={runtime} {...(instructor ? { instructor } : {})} />;
  }
}

// ---------------------------------------------------------------------------
// Pad
// ---------------------------------------------------------------------------

export interface ControlPadProps {
  runtime: SimRuntime;
  controls: ReadonlyArray<ControlDef>;
  className?: string;
  /** Start collapsed (small screens). */
  defaultCollapsed?: boolean;
  title?: string;
  /** Disable interaction (e.g. while watching a test replay). */
  disabled?: boolean;
  /** Compact block (short 3D panels): at most two rows, no header. */
  compact?: boolean;
  /** With `compact`: a single horizontally scrolling row (very short 3D panels). */
  singleRow?: boolean;
}

/** Shown while the ladder (or a text field) has the keyboard: the pad's key chips do nothing then. */
function KeysPausedNote({ compact }: { compact?: boolean }) {
  return (
    <span
      className={cn('flex shrink-0 items-center gap-1 text-[10.5px] font-medium whitespace-nowrap text-amber-200/90 normal-case', compact ? 'h-9 px-1' : 'tracking-normal')}
      title="Keyboard shortcuts are paused while the ladder editor or a text field has focus (there, letters type instructions). Click the 3D view or an empty spot of the page to use the keys again."
      data-testid="keys-paused"
    >
      <Keyboard size={12} /> keys paused · click the 3D view
    </span>
  );
}

/** Floating operator panel (rendered as an overlay over the 3D view). */
export function ControlPad({ runtime, controls, className, defaultCollapsed, title = 'Operator panel', disabled, compact, singleRow }: ControlPadProps) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  const focusPaused = useHotkeysPaused();
  if (controls.length === 0) return null;
  const keysPaused = focusPaused && !disabled && controls.some((c) => c.key);
  if (compact) {
    return (
      <div
        className={cn('pointer-events-auto flex max-w-full items-start gap-1 rounded-xl border border-white/10 bg-slate-950/75 p-1 shadow-2xl backdrop-blur-md', keysPaused && '[&_kbd]:opacity-30', className)}
        data-testid="control-pad"
        data-compact=""
        data-keys-paused={keysPaused ? '' : undefined}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title={collapsed ? `Show the ${title.toLowerCase()}` : `Hide the ${title.toLowerCase()}`}
          className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
        >
          <Gamepad2 size={14} className="text-sky-300" />
          {collapsed && <span className="whitespace-nowrap">{title}</span>}
          {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} className="-rotate-90" />}
        </button>
        {!collapsed && (
          <div
            className={cn('flex min-w-0 gap-1', singleRow ? 'flex-nowrap overflow-x-auto pb-0.5' : 'max-h-[4.9rem] flex-wrap overflow-y-auto', disabled && 'pointer-events-none opacity-50')}
            style={{ scrollbarWidth: 'thin' }}
            data-single-row={singleRow ? '' : undefined}
          >
            {keysPaused && <KeysPausedNote compact />}
            {controls.map((c) => (
              <ControlWidget key={c.id} c={c} runtime={runtime} />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className={cn('pointer-events-auto max-w-full rounded-xl border border-white/10 bg-slate-950/70 shadow-2xl backdrop-blur-md', keysPaused && '[&_kbd]:opacity-30', className)}
      data-testid="control-pad"
      data-keys-paused={keysPaused ? '' : undefined}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-slate-300 uppercase hover:text-white"
        aria-expanded={!collapsed}
      >
        <Gamepad2 size={13} className="text-sky-300" />
        {title}
        <span className="ml-auto flex items-center gap-1 font-normal tracking-normal text-slate-500 normal-case">
          {!collapsed && keysPaused && <KeysPausedNote />}
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {!collapsed && (
        <div className={cn('flex max-h-44 flex-wrap gap-1.5 overflow-y-auto px-2 pb-2', disabled && 'pointer-events-none opacity-50')}>
          {controls.map((c) => (
            <ControlWidget key={c.id} c={c} runtime={runtime} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Instructor fault-injection toggles (a list, for menus / side panels). */
export function FaultList({ runtime, controls, className }: { runtime: SimRuntime; controls: ReadonlyArray<ControlDef>; className?: string }) {
  if (controls.length === 0) return <p className={cn('text-xs text-slate-500', className)}>This plant has no fault injection.</p>;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {controls.map((c) => (
        <div key={c.id} className="flex flex-col gap-0.5">
          <ControlWidget c={c} runtime={runtime} instructor />
          {c.description && <span className="pl-1 text-[10.5px] text-slate-500">{c.description}</span>}
        </div>
      ))}
    </div>
  );
}
