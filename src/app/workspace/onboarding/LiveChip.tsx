/**
 * Live objectives UI: the mission-bar chip ("Live 2/4", or the "Looks good — press Verify & Test" nudge when every
 * test passes in the background) and the soft per-objective marks of the briefing checklist. Deliberately unlike
 * the graded result (dashed outlines, "live" wording): nothing here gives stars or XP.
 */
import { Activity, AlertCircle, Check, Play } from 'lucide-react';
import { memo } from 'react';
import type { ObjectiveState } from '../../../game/objectives';
import { cn } from '../../../ui';
import type { LiveObjectives } from './useLiveObjectives';
import './onboarding.css';

/** What the chip shows for a live-objectives state (pure, for tests). */
export type LiveChipState =
  | { kind: 'hidden' }
  | { kind: 'blocked'; stale: boolean }
  | { kind: 'progress'; met: number; total: number; stale: boolean }
  | { kind: 'ready' };

export function liveChipState(live: Pick<LiveObjectives, 'enabled' | 'outcome' | 'fresh' | 'checking'>, running: boolean): LiveChipState {
  const o = live.outcome;
  if (!live.enabled || !o || running) return { kind: 'hidden' };
  // a graded run of this very program: the regular results say it all
  if (o.graded && live.fresh) return { kind: 'hidden' };
  const stale = !live.fresh || live.checking;
  if (o.verifyErrors.length > 0) return { kind: 'blocked', stale };
  if (o.allPassed && !stale) return { kind: 'ready' };
  return { kind: 'progress', met: o.states.filter((s) => s === 'passed').length, total: o.states.length, stale };
}

export interface LiveChipProps {
  live: LiveObjectives;
  running: boolean;
  onRun(): void;
  reducedMotion?: boolean;
}

function LiveChipImpl({ live, running, onRun, reducedMotion }: LiveChipProps) {
  const st = liveChipState(live, running);
  const announce = st.kind === 'ready' ? 'Live check: your program meets every objective. Press Verify and Test to score it.' : '';
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" data-testid="live-status">
        {announce}
      </span>
      {st.kind === 'ready' ? (
        <button
          type="button"
          onClick={onRun}
          className={cn(
            'pw-live-nudge flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-emerald-400/50 bg-emerald-500/10 px-2 text-[12px] font-semibold whitespace-nowrap text-emerald-200',
            'hover:bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
          )}
          data-animate={reducedMotion ? undefined : ''}
          aria-label="Looks good — press Verify & Test"
          title="Live check (not graded): your current program passes every acceptance test in the background. Press Verify & Test to score it and earn stars."
          data-testid="live-nudge"
        >
          <Check size={14} className="text-emerald-300" />
          <span className="hidden md:inline">Looks good — press Verify &amp; Test</span>
          <span className="hidden sm:inline md:hidden">Looks good</span>
          <Play size={12} className="hidden text-emerald-300/80 lg:block" />
        </button>
      ) : st.kind === 'progress' ? (
        <span
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-emerald-400/35 px-2 text-[11.5px] whitespace-nowrap text-emerald-200/85 transition-opacity',
            st.stale && 'opacity-60',
          )}
          title={`Live check (not graded): your current program already meets ${st.met} of ${st.total} objectives. The tests re-run quietly after each edit; stars and XP only come from Verify & Test.`}
          data-testid="live-chip"
          data-met={st.met}
        >
          <Activity size={13} className={cn('text-emerald-300/80', st.stale && !reducedMotion && 'animate-pulse')} />
          <span className="hidden sm:inline">Live</span>
          <span className="font-mono">
            {st.met}/{st.total}
          </span>
        </span>
      ) : st.kind === 'blocked' ? (
        <span
          className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-amber-400/35 px-2 text-[11.5px] whitespace-nowrap text-amber-200/85', st.stale && 'opacity-60')}
          title="Live check (not graded): the tests cannot run — the program breaks a verification error or a mission rule (see the problems under the ladder)."
          data-testid="live-chip"
          data-blocked=""
        >
          <AlertCircle size={13} />
          <span className="hidden sm:inline">Live: fix errors</span>
        </span>
      ) : null}
    </>
  );
}

/** Mission-bar chip (memoized: the page re-renders while tests run). */
export const LiveChip = memo(LiveChipImpl);

/** Soft "live" mark next to an objective the current program already satisfies (not graded). */
export function LiveMark({ state, stale }: { state: ObjectiveState | undefined; stale?: boolean }) {
  if (state !== 'passed') return null;
  return (
    <span
      className={cn(
        'ml-auto flex h-[18px] shrink-0 items-center gap-0.5 self-start rounded-full border border-dashed border-emerald-400/45 px-1.5 text-[10px] font-semibold text-emerald-300/90',
        stale && 'opacity-50',
      )}
      title="Live check: your current program already does this (not graded — press Verify & Test to score it)"
      data-testid="live-mark"
    >
      <Check size={10} /> live
    </span>
  );
}

/** One-line explanation under the objectives while live marks are shown. */
export function LiveNote({ allPassed }: { allPassed: boolean }) {
  return (
    <p className="text-[11px] leading-snug text-slate-500" data-testid="live-note">
      <span className="rounded-full border border-dashed border-emerald-400/40 px-1 text-[10px] font-semibold text-emerald-300/80">live</span>{' '}
      {allPassed ? (
        <span className="text-emerald-200/80">Looks good — your current program meets every objective. Press Verify &amp; Test to score it.</span>
      ) : (
        'marks what your current program already does. They are checked quietly after each edit; only Verify & Test is graded.'
      )}
    </p>
  );
}
