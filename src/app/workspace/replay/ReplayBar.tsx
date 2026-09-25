/**
 * Test-replay UI: the transport controls (restart · step back · play/pause · step forward · jump to the failure ·
 * speed), the banner over the 3D view (test, time, current step, and — paused at the failure — the explanation
 * card), and the debugger shown under the watched test in the Tests panel (step list, expected-vs-actual trace,
 * explanation). Everything reads the ReplaySession live: the page does not re-render while a replay plays.
 */
import { ChevronDown, ChevronUp, Cctv, CircleCheck, CircleDashed, CircleX, Eye, LineChart, Pause, Play, RotateCcw, SkipForward, Square, StepBack, StepForward } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import type { SceneLogic } from '../../../sim/types';
import { cn } from '../../../ui';
import { speedLabel } from '../SpeedControl';
import { describeStep, fmtSeconds, humanizeMessage } from '../stepText';
import type { TestReplayApi } from '../useTestReplay';
import { ExplanationCard } from './ExplanationCard';
import { ReplayTrace } from './ReplayTrace';
import type { ReplaySession } from './session';

export const REPLAY_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16] as const;

/** Re-render on session step / end / seek changes, plus every `ms` while `live` (the clock). */
export function useSessionTick(session: ReplaySession, ms = 0): number {
  const subscribe = useCallback((cb: () => void) => session.subscribe(cb), [session]);
  const v = useSyncExternalStore(
    subscribe,
    () => `${session.generation}|${session.stepIndex}|${session.done ? 1 : 0}`,
    () => '',
  );
  const [t, setT] = useState(0);
  useEffect(() => {
    if (ms <= 0) return;
    const h = window.setInterval(() => setT((n) => (n + 1) % 1_000_000), ms);
    return () => window.clearInterval(h);
  }, [ms]);
  return v.length + t;
}

type Controls = Pick<TestReplayApi, 'paused' | 'speed' | 'setPaused' | 'setSpeed' | 'restart' | 'stepBack' | 'stepForward' | 'jumpToFailure'>;

function TBtn({ label, onClick, children, disabled, active, testId }: { label: string; onClick(): void; children: ReactNode; disabled?: boolean; active?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-200 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35',
        active && 'bg-amber-400 text-black hover:bg-amber-300',
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** Transport controls of a replay (keyboard: ← / → step while focused). */
export function ReplayControls({ session, api, compact, className }: { session: ReplaySession; api: Controls; compact?: boolean; className?: string }) {
  useSessionTick(session);
  const done = session.done;
  const failing = session.failure !== undefined;
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      api.stepBack();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      api.stepForward();
    }
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} role="toolbar" aria-label="Replay controls (← / → step)" onKeyDown={onKey}>
      <div className="flex items-center rounded-lg border border-white/10 bg-black/40">
        <TBtn label="Replay from the start" onClick={api.restart} testId="replay-restart">
          <RotateCcw size={13} />
        </TBtn>
        <TBtn label="Step back (←)" onClick={api.stepBack} testId="replay-step-back">
          <StepBack size={14} />
        </TBtn>
        <TBtn label={done ? 'Replay again' : api.paused ? 'Play' : 'Pause'} onClick={() => api.setPaused(done ? false : !api.paused)} active={api.paused && !done} testId="replay-play">
          {done || api.paused ? <Play size={14} /> : <Pause size={14} />}
        </TBtn>
        <TBtn label="Next step (→)" onClick={api.stepForward} disabled={done} testId="replay-step">
          <StepForward size={14} />
        </TBtn>
        {failing && (
          <TBtn label="Jump to the failing step" onClick={api.jumpToFailure} testId="replay-jump-fail">
            <SkipForward size={14} className="text-red-300" />
          </TBtn>
        )}
      </div>
      {compact ? (
        <select
          value={String(api.speed)}
          onChange={(ev) => api.setSpeed(Number(ev.target.value))}
          aria-label="Replay speed"
          title="Replay speed"
          className="h-7 cursor-pointer rounded-lg border border-white/10 bg-black/40 px-1 font-mono text-[11px] font-semibold text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
          data-testid="replay-speed"
        >
          {REPLAY_SPEEDS.map((s) => (
            <option key={s} value={String(s)} className="bg-slate-900 text-slate-100">
              {speedLabel(s)}
            </option>
          ))}
        </select>
      ) : (
        <div className="flex items-center overflow-hidden rounded-lg border border-white/10 bg-black/40" role="group" aria-label="Replay speed">
          {REPLAY_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => api.setSpeed(s)}
              aria-pressed={api.speed === s}
              title={`Replay speed ${speedLabel(s)}`}
              className={cn(
                'h-7 cursor-pointer px-1.5 font-mono text-[10.5px] font-semibold focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
                api.speed === s ? 'bg-sky-500/90 text-white' : 'text-slate-300 hover:bg-white/10',
              )}
            >
              {speedLabel(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ReplayBarProps {
  session: ReplaySession;
  api: TestReplayApi;
  scene: SceneLogic<unknown>;
  testCount: number;
  onRung?(rung: number): void;
  /** Show the trace / details (Tests panel). */
  onDetails?(): void;
}

/** Banner over the 3D view while a test replays. */
/** The 3D panel is tall enough to show the explanation card over it without hiding the plant. */
const TALL_TWIN_PX = 460;

export function ReplayBar({ session, api, scene, testCount, onRung, onDetails }: ReplayBarProps) {
  useSessionTick(session, 150);
  const rootRef = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(true);
  useEffect(() => {
    const panel = rootRef.current?.closest<HTMLElement>('[data-testid="twin-panel"]');
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTall(panel.clientHeight >= TALL_TWIN_PX));
    ro.observe(panel);
    return () => ro.disconnect();
  }, []);
  // open by default where it fits; the player's choice wins
  const [cardChoice, setCardChoice] = useState<boolean | null>(null);
  const cardOpen = cardChoice ?? tall;
  const test = session.test;
  const done = session.done;
  const res = session.runner.result;
  const step = test.steps[Math.min(session.stepIndex, test.steps.length - 1)];
  const e = session.explanation;
  const showCard = session.failed && e;
  return (
    <div ref={rootRef} className="w-[min(48rem,100%)] rounded-xl border border-sky-400/40 bg-slate-950/88 px-2.5 py-2 shadow-2xl backdrop-blur-md" data-testid="replay-banner" data-state={done ? (res.passed ? 'passed' : 'failed') : api.paused ? 'paused' : 'playing'}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Eye size={14} className="shrink-0 text-sky-300" />
        <div className="min-w-[8rem] flex-1 truncate text-[12.5px] font-semibold text-slate-100" title={test.name}>
          Test {session.index + 1}/{testCount}: {test.name}
        </div>
        <span className="font-mono text-[11px] text-slate-400" aria-live="off">
          t = {fmtSeconds(session.timeMs)}
        </span>
        <ReplayControls session={session} api={api} compact />
        <button
          type="button"
          onClick={() => api.setFollow(!api.follow)}
          aria-pressed={api.follow}
          aria-label="Auto camera"
          title={api.follow ? 'Auto camera: the view follows the device each step is about (click a camera preset, or here, to take over)' : 'Auto camera is off — click to follow the test again'}
          className={cn(
            'flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-1.5 text-[10.5px] font-semibold focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
            api.follow ? 'border-sky-400/50 bg-sky-500/20 text-sky-100' : 'border-white/10 bg-black/40 text-slate-400 hover:bg-white/10',
          )}
          data-testid="replay-follow"
        >
          <Cctv size={12} /> <span className="hidden sm:inline">Auto camera</span>
        </button>
        <button
          type="button"
          onClick={api.stop}
          title="Stop and return to the live plant"
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2 text-[11px] font-semibold text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
          data-testid="replay-stop"
        >
          <Square size={11} /> Stop
        </button>
      </div>
      <div className="mt-1 text-[12px]" aria-live="polite">
        {done ? (
          res.passed ? (
            <span className="flex items-center gap-1 text-emerald-300" data-testid="replay-passed">
              <CircleCheck size={13} /> Test passed — every check held.
            </span>
          ) : showCard ? (
            <div className="rounded-lg border border-red-400/30 bg-red-500/[0.08] p-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {cardOpen ? (
                    <ExplanationCard explanation={e} onRung={onRung} compact />
                  ) : (
                    <button type="button" onClick={() => setCardChoice(true)} className="block w-full cursor-pointer text-left" title="Show why it failed" data-testid="replay-why">
                      <span className="line-clamp-2">
                        <span className="font-semibold text-red-200">✗ {e.expected}.</span> <span className="text-red-100/75">{e.saw}</span>{' '}
                        <span className="font-semibold whitespace-nowrap text-sky-300">Why? ▾</span>
                      </span>
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setCardChoice(!cardOpen)}
                  aria-expanded={cardOpen}
                  aria-label={cardOpen ? 'Collapse the explanation' : 'Show the explanation'}
                  title={cardOpen ? 'Collapse (more room for the 3D view)' : 'Show the explanation'}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-300 hover:bg-white/10"
                >
                  {cardOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>
              {onDetails && cardOpen && (
                <button type="button" onClick={onDetails} className="mt-1 flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-sky-300 hover:underline" data-testid="replay-details">
                  <LineChart size={12} /> Expected vs. actual trace
                </button>
              )}
            </div>
          ) : (
            <span className="text-red-200">✗ {humanizeMessage(res.failure ?? 'Failed', scene)}</span>
          )
        ) : (
          <div className="flex items-start gap-2">
            <span className="shrink-0 rounded bg-sky-500/20 px-1.5 font-mono text-[10.5px] text-sky-200">
              step {Math.min(session.stepIndex + 1, test.steps.length)}/{test.steps.length}
            </span>
            <span className="min-w-0 text-slate-300">{step ? describeStep(step, scene) : ''}</span>
            {session.failure && session.stepIndex === session.failingStep && <span className="shrink-0 rounded bg-red-500/20 px-1.5 text-[10.5px] font-semibold text-red-200">this check fails</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function StepIcon({ state }: { state: 'done' | 'current' | 'failed' | 'todo' }) {
  if (state === 'done') return <CircleCheck size={13} className="text-emerald-400" />;
  if (state === 'failed') return <CircleX size={13} className="text-red-400" />;
  if (state === 'current') return <Play size={12} className="text-sky-300" />;
  return <CircleDashed size={13} className="text-slate-600" />;
}

export interface ReplayDebuggerProps {
  session: ReplaySession;
  api: TestReplayApi;
  scene: SceneLogic<unknown>;
  onRung?(rung: number): void;
}

/** The debugger under the watched test (Tests panel): steps, trace, explanation. */
export function ReplayDebugger({ session, api, scene, onRung }: ReplayDebuggerProps) {
  useSessionTick(session, 250);
  const test = session.test;
  const failStep = session.failingStep;
  const e = session.explanation;
  const reached = session.failed;
  // finished: every step ran — or, on a failure, the steps after the failing one never did
  const cur = session.done ? (reached ? failStep : test.steps.length) : session.stepIndex;
  // keep the current (or failed) step visible in the list — scrolling the list only, never the page
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-step="${Math.min(cur, test.steps.length - 1)}"]`);
    if (!list || !item) return;
    const top = item.offsetTop; // the list is the offset parent (relative)
    if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 3);
  }, [cur, test.steps.length]);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-sky-400/25 bg-slate-950/60 p-2" data-testid="replay-debugger">
      <ReplayControls session={session} api={api} />
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
          <LineChart size={12} /> Expected vs. actual
        </div>
        <ReplayTrace session={session} onSeekTime={api.seekTime} className="rounded-md bg-black/30" />
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm border border-dashed border-violet-400 bg-violet-400/15" /> expected
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 bg-emerald-500" /> actual (1)
          </span>
          {session.trace.failAtMs !== undefined && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-0.5 bg-red-400" /> failure
            </span>
          )}
          <span>click the trace to jump there</span>
        </div>
      </div>
      {e && (reached ? (
        <ExplanationCard explanation={e} onRung={onRung} className="rounded-md border border-red-400/25 bg-red-500/[0.06] p-2" />
      ) : (
        <div className="rounded-md border border-red-400/20 bg-red-500/[0.05] px-2 py-1.5 text-[11.5px] text-red-100/90">
          This test fails at <span className="font-mono">t = {fmtSeconds(e.atMs)}</span>
          {failStep >= 0 && <> (step {failStep + 1})</>}. Watch it happen, or{' '}
          <button type="button" onClick={api.jumpToFailure} className="cursor-pointer font-semibold text-sky-300 hover:underline">
            jump to the failing step
          </button>
          .
        </div>
      ))}
      <div>
        <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Steps · click one to jump there</div>
        <ol ref={listRef} className="relative max-h-56 space-y-px overflow-y-auto pr-1" data-testid="replay-steps">
          {test.steps.map((s, i) => {
            const failed = reached && i === failStep;
            const state = failed ? 'failed' : i < cur ? 'done' : i === cur && !session.done ? 'current' : 'todo';
            const at = session.trace.stepStarts[i];
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => api.seekStep(i)}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-start gap-1.5 rounded px-1 py-0.5 text-left text-[11.5px] leading-snug hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
                    state === 'current' && 'bg-sky-500/10 text-sky-100',
                    state === 'failed' && 'bg-red-500/10 text-red-100',
                    state === 'todo' && 'text-slate-500',
                    state === 'done' && 'text-slate-300',
                  )}
                  data-step={i}
                  data-state={state}
                >
                  <span className="mt-[2px] shrink-0">
                    <StepIcon state={state} />
                  </span>
                  <span className="w-9 shrink-0 font-mono text-[10px] text-slate-500">{at !== undefined && Number.isFinite(at) ? fmtSeconds(at) : ''}</span>
                  <span className="min-w-0">
                    {describeStep(s, scene)}
                    {i === failStep && !reached && <span className="ml-1 rounded bg-red-500/15 px-1 text-[10px] text-red-300">fails</span>}
                    {reached && i > failStep && <span className="ml-1 text-[10px] text-slate-600">(not run)</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
