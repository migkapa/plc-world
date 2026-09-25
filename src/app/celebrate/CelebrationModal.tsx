/**
 * Mission complete! Stars pop in one by one, the XP counter runs, a level-up banner (with confetti)
 * and newly unlocked achievements follow; then the mission debrief, best stats and what to do next.
 *
 * Dialog behaviour: focus moves to "Next mission" (or the primary action), Tab stays inside, Escape
 * closes, focus returns to where it was. While open it sets `useUiStore.celebrating` so the global
 * level-up toasts / fanfare wait instead of doubling its own announcement.
 */
import { ArrowRight, Award, ChevronsUp, Lightbulb, Map as MapIcon, RotateCcw, Sparkles, Star, Trophy, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { sfx } from '../../audio/sfx';
import { getAchievement } from '../../game/achievements';
import { getChapter } from '../../game/chapters';
import { levelForXp } from '../../game/ranks';
import { useGame, type CompletionOutcome } from '../../game/store';
import type { MissionDef, MissionRunResult } from '../../game/types';
import { Button, Markdown, ProgressBar, cn, useFocusTrap } from '../../ui';
import { useUiStore } from '../hud/uiStore';
import { celebrateBurst, starPuff } from './confetti';
import { celebrationTimeline, countUp, replayGoal } from './timeline';

export interface CelebrationModalProps {
  open: boolean;
  mission: MissionDef;
  outcome: CompletionOutcome;
  result: MissionRunResult;
  hintsUsed: number;
  /** Next mission in the campaign (undefined at the end). */
  next?: MissionDef;
  nextUnlocked?: boolean;
  onNext(): void;
  onReplay(): void;
  onMap(): void;
  onClose(): void;
}

function BigStar({ lit, index, popped }: { lit: boolean; index: number; popped: boolean }) {
  const size = index === 1 ? 64 : 50;
  return (
    <span className={cn('relative inline-flex items-center justify-center', index === 1 ? '-mt-4' : '')} data-star={index} data-lit={lit && popped ? '1' : '0'}>
      <Star size={size} className="text-slate-700" strokeWidth={1.5} />
      {lit && popped && (
        <Star
          size={size}
          className="absolute inset-0 animate-[star-pop_520ms_cubic-bezier(.2,1.6,.4,1)] fill-yellow-400 text-yellow-300 drop-shadow-[0_0_14px_rgba(250,204,21,0.75)]"
          strokeWidth={1.5}
        />
      )}
    </span>
  );
}

function missingStarHint(mission: MissionDef, result: MissionRunResult, hintsUsed: number, stars: number): string | undefined {
  if (stars >= 3) return undefined;
  const par = mission.parInstructions;
  if (par !== undefined && result.instructionCount > par) return `Solve it with ${par} instructions or fewer (you used ${result.instructionCount}) for the second star.`;
  if (hintsUsed > 0) return 'The third star is for solving it without hints — this mission already had hints revealed, so 2 stars is the best here.';
  return undefined;
}

export function CelebrationModal({ open, mission, outcome, result, hintsUsed, next, nextUnlocked, onNext, onReplay, onMap, onClose }: CelebrationModalProps) {
  const reduced = useGame((s) => s.profile.settings.reducedMotion);
  const xpTotal = useGame((s) => s.profile.xp);
  const best = useGame((s) => s.profile.missions[mission.id]);
  const chapter = getChapter(mission.chapter);
  const cues = useMemo(
    () =>
      celebrationTimeline({
        stars: outcome.stars,
        xpGained: outcome.xpGained,
        previousLevel: outcome.previousLevel,
        newLevel: outcome.newLevel,
        newAchievements: outcome.newAchievements,
      }),
    [outcome],
  );
  const [popped, setPopped] = useState(0);
  const [xpShown, setXpShown] = useState(0);
  const [levelUp, setLevelUp] = useState(false);
  const [achShown, setAchShown] = useState(0);
  const starsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // focus moves into the dialog ("Next mission", else the primary action), Tab stays inside and focus
  // returns to the opener when it closes; plant hotkeys never reach the page behind it (aria-modal)
  useFocusTrap(dialogRef, open);

  // global level-up toasts / fanfare wait while the celebration announces its own
  const announcedLevel = outcome.newLevel > outcome.previousLevel ? outcome.newLevel : null;
  useEffect(() => {
    if (!open) return;
    useUiStore.getState().beginCelebration(announcedLevel);
    return () => useUiStore.getState().endCelebration();
  }, [open, announcedLevel]);

  useEffect(() => {
    if (!open) return;
    setPopped(0);
    setXpShown(0);
    setLevelUp(false);
    setAchShown(0);
    if (reduced) {
      setPopped(outcome.stars);
      setXpShown(outcome.xpGained);
      setLevelUp(outcome.newLevel > outcome.previousLevel);
      setAchShown(outcome.newAchievements.length);
      sfx.play('success');
      return;
    }
    sfx.play('success');
    const timers: number[] = [];
    let raf = 0;
    if (outcome.stars >= 3 || outcome.firstClear) timers.push(window.setTimeout(() => celebrateBurst({ big: outcome.stars >= 3 }), 250));
    for (const cue of cues) {
      timers.push(
        window.setTimeout(() => {
          switch (cue.kind) {
            case 'star': {
              setPopped(cue.index + 1);
              sfx.play('star');
              const el = starsRef.current?.querySelector(`[data-star="${cue.index}"]`);
              if (el) {
                const r = el.getBoundingClientRect();
                starPuff((r.left + r.width / 2) / window.innerWidth, (r.top + r.height / 2) / window.innerHeight);
              }
              break;
            }
            case 'xpStart': {
              sfx.play('xp');
              const t0 = performance.now();
              const step = (t: number): void => {
                const v = countUp(outcome.xpGained, t - t0, cue.durationMs);
                setXpShown(v);
                if (v < outcome.xpGained) raf = requestAnimationFrame(step);
              };
              raf = requestAnimationFrame(step);
              break;
            }
            case 'xpEnd':
              setXpShown(outcome.xpGained);
              sfx.play('xp');
              break;
            case 'levelUp':
              setLevelUp(true);
              sfx.play('levelUp');
              celebrateBurst({ big: true });
              break;
            case 'achievement':
              setAchShown(cue.index + 1);
              sfx.play('achievement');
              break;
            default:
              break;
          }
        }, cue.at),
      );
    }
    return () => {
      timers.forEach((h) => window.clearTimeout(h));
      cancelAnimationFrame(raf);
    };
  }, [open, cues, outcome, reduced]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const lvl = levelForXp(xpTotal);
  const par = mission.parInstructions;
  const tip = missingStarHint(mission, result, hintsUsed, outcome.stars);
  const goal = replayGoal(mission, result, hintsUsed, outcome.stars);
  const nextPrimary = !!next && !!nextUnlocked;
  const accent = chapter?.color ?? '#f5c400';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" data-testid="celebration">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Mission complete"
        tabIndex={-1}
        className="relative flex outline-none max-h-[92vh] w-full max-w-2xl animate-[toast-in_260ms_ease-out] flex-col overflow-hidden rounded-2xl border border-edge bg-panel-2 shadow-2xl"
      >
        <div className="relative overflow-hidden px-6 pt-6 pb-4 text-center" style={{ background: `radial-gradient(ellipse at 50% 0%, ${accent}33 0%, transparent 70%)` }}>
          <div className="text-[11px] font-semibold tracking-[0.2em] uppercase" style={{ color: accent }}>
            {chapter ? `Chapter ${chapter.order} · ${chapter.title}` : 'Mission'} · {mission.kind === 'boss' ? 'Boss' : `Mission ${mission.id}`}
          </div>
          <h2 className="mt-1 text-2xl font-bold text-white">{mission.kind === 'boss' ? 'Boss defeated!' : 'Mission complete!'}</h2>
          <div className="text-sm text-slate-400">{mission.title}</div>
          <div ref={starsRef} className="mt-4 flex items-end justify-center gap-3" aria-label={`${outcome.stars} of 3 stars`}>
            {[0, 1, 2].map((i) => (
              <BigStar key={i} index={i} lit={i < outcome.stars} popped={i < popped} />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className="font-mono text-3xl font-bold text-yellow-300 tabular-nums" data-testid="xp-counter">
              +{xpShown}
            </span>
            <span className="text-sm font-semibold text-yellow-200/70">XP</span>
          </div>
          {outcome.xpGained === 0 && (
            <div className="mt-1 text-xs text-slate-500">No new XP — replays only pay for improvements (more stars).</div>
          )}
          {levelUp && (
            <div className="mx-auto mt-3 flex max-w-sm animate-[star-pop_520ms_ease-out] items-center justify-center gap-2 rounded-xl border border-yellow-400/50 bg-yellow-400/15 px-4 py-2 text-yellow-100 shadow-[0_0_30px_rgba(250,204,21,0.25)]">
              <ChevronsUp size={18} />
              <span className="font-bold">Level up! Level {outcome.newLevel}</span>
              <span className="text-sm text-yellow-200/80">· {lvl.title}</span>
            </div>
          )}
          <div className="mx-auto mt-3 max-w-sm">
            <div className="mb-1 flex justify-between text-[11px] text-slate-400">
              <span>
                Level {lvl.level} · <span style={{ color: lvl.color }}>{lvl.title}</span>
              </span>
              <span>{lvl.xpToNext > 0 ? `${lvl.xpToNext} XP to level ${lvl.level + 1}` : 'Max level'}</span>
            </div>
            <ProgressBar value={lvl.progress} color="bg-gradient-to-r from-yellow-500 to-amber-300" />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-edge px-6 py-4">
          {outcome.newAchievements.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-yellow-300/90 uppercase">
                <Trophy size={13} /> Achievement{outcome.newAchievements.length === 1 ? '' : 's'} unlocked
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {outcome.newAchievements.map((id, i) => {
                  const a = getAchievement(id);
                  return (
                    <div
                      key={id}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border border-yellow-400/30 bg-yellow-400/[0.07] p-2.5 transition-all duration-500',
                        i < achShown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
                      )}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-yellow-400/20 text-yellow-300">
                        <Award size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-100">{a?.title ?? id}</span>
                        <span className="block text-[11px] leading-snug text-slate-400">{a?.description}</span>
                      </span>
                      {a && <span className="ml-auto shrink-0 font-mono text-[11px] text-yellow-300">+{a.xp}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Instructions" value={`${result.instructionCount}${par !== undefined ? ` / ${par}` : ''}`} good={par === undefined || result.instructionCount <= par} sub={par !== undefined ? 'par' : undefined} />
            <Stat label="Hints" value={String(hintsUsed)} good={hintsUsed === 0} icon={<Lightbulb size={12} />} />
            <Stat label="Best" value={`${best?.stars ?? outcome.stars} ★`} good sub={best?.bestInstructionCount !== undefined ? `fewest ${best.bestInstructionCount} instr.` : undefined} />
          </div>

          {tip && (
            <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[12.5px] text-sky-100">
              <Sparkles size={14} className="mt-0.5 shrink-0 text-sky-300" /> {tip}
            </div>
          )}

          {mission.debrief && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                <Wrench size={12} /> Debrief
              </div>
              <Markdown source={mission.debrief} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-edge bg-panel px-5 py-3">
          <Button variant="ghost" size="sm" icon={<MapIcon size={14} />} onClick={onMap} data-testid="celebrate-map" {...(!nextPrimary && next ? { 'data-autofocus': '' } : {})}>
            Back to map
          </Button>
          {goal && (
            <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={onReplay} data-testid="celebrate-replay">
              {goal}
            </Button>
          )}
          {next && (
            <Button variant="primary" size="sm" onClick={onNext} disabled={!nextUnlocked} title={nextUnlocked ? `Next: ${next.title}` : 'Locked'} data-testid="celebrate-next" {...(nextPrimary ? { 'data-autofocus': '' } : {})}>
              Next mission <ArrowRight size={14} />
            </Button>
          )}
          {!next && (
            <Button variant="success" size="sm" onClick={onMap} data-autofocus="">
              Campaign complete — back to map
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value, good, sub, icon }: { label: string; value: string; good: boolean; sub?: string | undefined; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-panel px-2 py-2">
      <div className="flex items-center justify-center gap-1 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
        {icon}
        {label}
      </div>
      <div className={cn('font-mono text-lg font-bold', good ? 'text-emerald-300' : 'text-amber-300')}>{value}</div>
      {sub && <div className="text-[10.5px] text-slate-500">{sub}</div>}
    </div>
  );
}
