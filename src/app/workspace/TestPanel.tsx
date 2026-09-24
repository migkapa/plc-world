/**
 * Mission acceptance tests: status list (animated as tests run one by one), plain-language failure
 * messages with the simulated time, "Watch this test" replays, safety invariants and star criteria.
 */
import { AlertCircle, Check, RefreshCw, CircleDashed, Eye, FlaskConical, Loader2, Play, ShieldCheck, ShieldX, Shield, Star, X } from 'lucide-react';
import { memo, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import type { MissionDef, TestResult } from '../../game/types';
import type { SceneLogic } from '../../sim/types';
import { Button, Kbd, ProgressBar, cn } from '../../ui';
import { describeFailure, violatedInvariants } from './stepText';
import type { TestProgressStore, TestStatus } from './testRun';

export interface TestPanelProps {
  mission: MissionDef;
  /** For plain-language failure messages (observable labels). */
  scene?: SceneLogic<unknown>;
  statuses: TestStatus[];
  /** Live progress of the running test (external store: only the progress bar re-renders). */
  progress: TestProgressStore;
  results: (TestResult | undefined)[];
  /** Verification errors of the last run (null = not verified yet). */
  verifyErrors: string[] | null;
  running: boolean;
  onRun(): void;
  onWatch(index: number): void;
  /** Index of the test being replayed. */
  watching?: number | null;
  instructionCount?: number;
  hintsUsed: number;
  /** Message under the header (encouragement after a failed run…). */
  notice?: ReactNode;
  /** The program changed since these results were produced. */
  stale?: boolean;
  onJumpToRung?(index: number): void;
  className?: string;
}

function StatusIcon({ status }: { status: TestStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 size={16} className="animate-spin text-sky-400" />;
    case 'passed':
      return (
        <span className="flex h-4 w-4 animate-[pop-in_260ms_ease-out] items-center justify-center rounded-full bg-emerald-500 text-black">
          <Check size={11} strokeWidth={3} />
        </span>
      );
    case 'failed':
      return (
        <span className="flex h-4 w-4 animate-[pop-in_260ms_ease-out] items-center justify-center rounded-full bg-red-500 text-white">
          <X size={11} strokeWidth={3} />
        </span>
      );
    case 'queued':
      return <CircleDashed size={16} className="text-slate-500" />;
    case 'skipped':
      return <CircleDashed size={16} className="text-slate-600" />;
    default:
      return <span className="h-4 w-4 rounded-full border-2 border-slate-600" />;
  }
}

function rungOf(message: string): number | undefined {
  const m = /Rung (\d+)/.exec(message);
  return m ? Number(m[1]) : undefined;
}

function TestProgress({ store, index }: { store: TestProgressStore; index: number }) {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const value = useSyncExternalStore(subscribe, () => store.get(index), () => store.get(index));
  return <ProgressBar value={value} className="mt-1.5 h-1" color="bg-sky-400" />;
}

function TestPanelImpl({
  mission,
  scene,
  statuses,
  progress,
  results,
  verifyErrors,
  running,
  onRun,
  onWatch,
  watching,
  instructionCount,
  hintsUsed,
  notice,
  stale,
  onJumpToRung,
  className,
}: TestPanelProps) {
  const passed = statuses.filter((s) => s === 'passed').length;
  const total = mission.tests.length;
  const violated = violatedInvariants(mission, results);
  const allRun = results.length === total && results.every((r) => r !== undefined);
  const allPassed = allRun && passed === total;
  const par = mission.parInstructions;
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-panel', className)} data-testid="test-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <FlaskConical size={15} className="text-sky-300" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-100">Acceptance tests</div>
          <div className="text-[11px] text-slate-500">
            {results.some(Boolean) ? (
              <>
                <span className={cn(allPassed ? 'text-emerald-300' : passed > 0 ? 'text-slate-300' : 'text-slate-400')}>
                  {passed}/{total} passed
                </span>
              </>
            ) : (
              `${total} test${total === 1 ? '' : 's'} · run them on a fresh controller + plant`
            )}
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={onRun} disabled={running} icon={running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} data-testid="run-tests">
          {running ? 'Testing…' : 'Verify & Test'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {stale && (
          <div className="flex items-center gap-1.5 rounded-md border border-sky-500/25 bg-sky-500/[0.07] px-2 py-1 text-[11.5px] text-sky-200" data-testid="stale-results">
            <RefreshCw size={12} /> Your program changed since this run — Verify &amp; Test again to update the results.
          </div>
        )}
        {notice}

        {verifyErrors && verifyErrors.length > 0 && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5" data-testid="verify-failed">
            <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-red-200">
              <AlertCircle size={14} /> Verification failed — the tests can’t run yet
            </div>
            <ul className="space-y-1 text-[11.5px] text-red-100/90">
              {verifyErrors.slice(0, 8).map((e, i) => {
                const rung = rungOf(e);
                return (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-red-400">•</span>
                    <span className="min-w-0">
                      {e.replace(/^Error:\s*/, '').replace(/^MainProgram - MainRoutine,\s*/, '')}
                      {rung !== undefined && onJumpToRung && (
                        <button type="button" onClick={() => onJumpToRung(rung)} className="ml-1 cursor-pointer text-sky-300 hover:underline">
                          show rung
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
              {verifyErrors.length > 8 && <li className="text-red-300/70">… and {verifyErrors.length - 8} more</li>}
            </ul>
          </div>
        )}

        <ol className="space-y-1.5">
          {mission.tests.map((t, i) => {
            const st = statuses[i] ?? 'idle';
            const r = results[i];
            const failed = st === 'failed' && r && !r.passed;
            const f = failed ? describeFailure(r, scene) : undefined;
            return (
              <li
                key={i}
                data-test-index={i}
                data-status={st}
                className={cn(
                  'rounded-lg border px-2.5 py-2 transition-colors',
                  st === 'passed' ? 'border-emerald-500/25 bg-emerald-500/[0.06]' : failed ? 'border-red-500/35 bg-red-500/[0.07]' : st === 'running' ? 'border-sky-500/40 bg-sky-500/[0.06]' : 'border-edge bg-panel-2',
                  watching === i && 'ring-1 ring-sky-400/70',
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">
                    <StatusIcon status={st} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-snug font-medium text-slate-100">{t.name}</div>
                    {t.description && <div className="text-[11px] leading-snug text-slate-500">{t.description}</div>}
                    {st === 'running' && <TestProgress store={progress} index={i} />}
                    {f && (
                      <div className="mt-1.5 text-[11.5px] leading-snug text-red-100">
                        {f.message}
                        {f.at && <span className="text-red-300/70"> — {f.at}</span>}
                      </div>
                    )}
                  </div>
                  {r && r.steps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onWatch(i)}
                      disabled={running}
                      title="Replay this test in the 3D view and on the ladder"
                      className={cn(
                        'flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40',
                        failed ? 'border border-sky-400/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
                      )}
                      data-testid={`watch-${i}`}
                    >
                      <Eye size={12} /> {failed ? 'Watch this test' : 'Watch'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {(mission.invariants?.length ?? 0) > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              <Shield size={12} /> Safety rules · checked all the time
            </div>
            <ul className="space-y-1">
              {mission.invariants!.map((inv, i) => {
                const bad = violated.has(i);
                const ok = allRun && !bad && results.every((r) => r && r.steps.length > 0);
                return (
                  <li key={i} className={cn('flex items-start gap-1.5 rounded-md px-1.5 py-1 text-[11.5px]', bad ? 'bg-red-500/10 text-red-200' : ok ? 'text-emerald-200/90' : 'text-slate-400')}>
                    <span className="mt-px shrink-0">{bad ? <ShieldX size={13} className="text-red-400" /> : ok ? <ShieldCheck size={13} className="text-emerald-400" /> : <Shield size={13} className="text-slate-600" />}</span>
                    {inv.message}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="rounded-lg border border-edge bg-panel-2 p-2.5">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Stars</div>
          <ul className="space-y-1 text-[11.5px]">
            <StarLine ok={allPassed} label="All tests pass" />
            <StarLine
              ok={allPassed && (par === undefined || (instructionCount ?? Infinity) <= par)}
              label={par === undefined ? 'No instruction par for this mission' : `At or under par: ${instructionCount ?? '—'} / ${par} instructions`}
              neutral={!allPassed}
            />
            <StarLine ok={allPassed && hintsUsed === 0} label={hintsUsed === 0 ? 'No hints used' : `${hintsUsed} hint${hintsUsed === 1 ? '' : 's'} used (max 2 stars)`} neutral={!allPassed && hintsUsed === 0} />
          </ul>
        </div>
        <p className="text-center text-[10.5px] text-slate-600">
          <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> runs Verify &amp; Test
        </p>
      </div>
    </div>
  );
}

export const TestPanel = memo(TestPanelImpl);

function StarLine({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
  return (
    <li className={cn('flex items-center gap-1.5', ok ? 'text-yellow-200' : neutral ? 'text-slate-400' : 'text-slate-500')}>
      <Star size={13} className={ok ? 'fill-yellow-400 text-yellow-400' : 'text-slate-600'} />
      {label}
    </li>
  );
}
