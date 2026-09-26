/**
 * Simulation speed control: pause / 0.5x / 1x / 2x / 4x (segmented), and a plant reset button.
 */
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { SimRuntime } from '../../sim/types';
import { cn } from '../../ui';
import { useRuntimeValue } from './hooks';

export const SPEEDS = [0.5, 1, 2, 4] as const;

export function speedLabel(s: number): string {
  return s === 0.5 ? '½×' : s === 0.25 ? '¼×' : `${s}×`;
}

/** Segmented speed selector (controlled). */
export function SpeedSegments({
  speed,
  paused,
  onSpeed,
  onPause,
  speeds = SPEEDS,
  className,
}: {
  speed: number;
  paused: boolean;
  onSpeed(s: number): void;
  onPause(p: boolean): void;
  speeds?: ReadonlyArray<number>;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center overflow-hidden rounded-lg border border-white/10 bg-black/50 backdrop-blur', className)} role="group" aria-label="Simulation speed">
      <button
        type="button"
        onClick={() => onPause(!paused)}
        title={paused ? 'Resume simulation' : 'Pause simulation'}
        aria-pressed={paused}
        className={cn('flex h-7 w-8 cursor-pointer items-center justify-center', paused ? 'bg-amber-400 text-black' : 'text-slate-200 hover:bg-white/10')}
      >
        {paused ? <Play size={13} /> : <Pause size={13} />}
      </button>
      {speeds.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => {
            onSpeed(s);
            if (paused) onPause(false);
          }}
          aria-pressed={!paused && speed === s}
          title={`Simulation speed ${s}×`}
          className={cn(
            'h-7 cursor-pointer px-2 font-mono text-[11px] font-semibold',
            !paused && speed === s ? 'bg-sky-500/90 text-white' : 'text-slate-300 hover:bg-white/10',
          )}
        >
          {speedLabel(s)}
        </button>
      ))}
    </div>
  );
}

/** Speed control bound to a SimRuntime (+ optional Reset plant). */
export function SpeedControl({ runtime, onResetPlant, className }: { runtime: SimRuntime; onResetPlant?: () => void; className?: string }) {
  // re-render only when speed / pause really change (not on every plant notification)
  useRuntimeValue(runtime, () => `${runtime.speed}|${runtime.paused ? 1 : 0}`);
  const [, force] = useState(0);
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <SpeedSegments
        speed={runtime.speed}
        paused={runtime.paused}
        onSpeed={(s) => {
          runtime.speed = s;
          force((n) => n + 1);
        }}
        onPause={(p) => {
          runtime.paused = p;
          force((n) => n + 1);
        }}
      />
      {onResetPlant && (
        <button
          type="button"
          onClick={onResetPlant}
          title="Reset plant (machine state back to the start; the program keeps running)"
          className="flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-white/10 bg-black/50 px-2 text-[11px] font-semibold text-slate-200 backdrop-blur hover:bg-white/10"
        >
          <RotateCcw size={12} /> Reset plant
        </button>
      )}
    </div>
  );
}
