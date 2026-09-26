/**
 * Mission chrome: the top mission bar, the hints dialog, the locked screen (the test-replay banner lives in
 * replay/ReplayBar.tsx).
 */
import { ArrowLeft, Lightbulb, Loader2, Lock, Map as MapIcon, Play, TriangleAlert } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { CHAPTERS, getChapter } from '../../game/chapters';
import { chapterBoss, getMission, missionsByChapter } from '../../game/missions';
import { CHAPTER_UNLOCK_SHARE, isChapterUnlockedFor, isMissionUnlockedFor, useGame } from '../../game/store';
import type { PlayerProfile } from '../../game/types';
import type { MissionDef } from '../../game/types';
import { Button, Kbd, Markdown, Modal, ProgressBar, Stars, cn } from '../../ui';
import { DockToggles } from './dockToggles';
import { routes } from '../routes';

export function ChapterChip({ chapterId, className }: { chapterId: string; className?: string }) {
  const ch = getChapter(chapterId);
  if (!ch) return null;
  return (
    <span
      className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap', className)}
      style={{ borderColor: `${ch.color}66`, background: `${ch.color}1f`, color: ch.color }}
      title={ch.subtitle}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ch.color }} />
      Ch. {ch.order} · {ch.title}
    </span>
  );
}

export interface MissionBarProps {
  mission: MissionDef;
  bestStars: number;
  /** Objectives met (from the last test run). */
  objectivesMet: number;
  testsRun: boolean;
  /** The program changed since that run: the count is dimmed (it describes the older program). */
  stale?: boolean;
  hintsUsed: number;
  running: boolean;
  onHints(): void;
  onRun(): void;
  extra?: ReactNode;
}

function MissionBarImpl({ mission, bestStars, objectivesMet, testsRun, stale = false, hintsUsed, running, onHints, onRun, extra }: MissionBarProps) {
  const total = mission.objectives.length;
  const hintsLeft = mission.hints.length - hintsUsed;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge bg-panel-2 px-2 sm:gap-3 sm:px-3" data-testid="mission-bar">
      <Link href={routes.campaign} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-slate-400 hover:bg-white/5 hover:text-white" title="Back to the campaign map">
        <ArrowLeft size={15} />
        <MapIcon size={14} className="hidden sm:block" />
      </Link>
      <span className="hidden md:block">
        <ChapterChip chapterId={mission.chapter} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 font-mono text-[11px] text-slate-500">{mission.id}</span>
          <h1 className="truncate text-[14px] font-semibold text-white">{mission.title}</h1>
        </div>
        <div className="hidden truncate text-[11.5px] text-slate-400 lg:block">{mission.tagline}</div>
      </div>
      <div className="hidden items-center gap-1 sm:flex" title={bestStars > 0 ? `Best: ${bestStars} of 3 stars` : 'Not completed yet'}>
        <Stars value={bestStars} size={15} />
      </div>
      <div
        className={cn('hidden w-32 shrink-0 flex-col gap-1 xl:flex', stale && 'opacity-55')}
        title={stale ? 'Objectives met in the last test run — your program changed since (Verify & Test again to update)' : 'Objectives met in the last test run'}
        data-testid="objectives-progress"
        data-stale={stale ? '' : undefined}
      >
        <div className="flex justify-between text-[10.5px] text-slate-400">
          <span>{stale ? 'Last run' : 'Objectives'}</span>
          <span className={cn('font-mono', stale ? 'text-slate-400' : objectivesMet === total ? 'text-emerald-300' : 'text-slate-300')}>
            {testsRun || objectivesMet > 0 ? objectivesMet : '–'}/{total}
          </span>
        </div>
        <ProgressBar value={objectivesMet / Math.max(1, total)} className="h-1.5" />
      </div>
      {extra}
      <DockToggles page="mission" left="the briefing panel" right="the tests panel" />
      <Button
        size="sm"
        variant="secondary"
        onClick={onHints}
        icon={<Lightbulb size={14} className={hintsLeft > 0 ? 'text-amber-300' : 'text-slate-500'} />}
        title={hintsUsed === 0 ? 'Hints (revealing one caps this mission at 2 stars)' : `${hintsUsed} of ${mission.hints.length} hints revealed`}
        data-testid="hints-button"
      >
        <span className="hidden sm:inline">Hints</span>
        <span className="rounded bg-black/30 px-1 font-mono text-[11px]">{hintsLeft}</span>
      </Button>
      <Button size="sm" variant="primary" onClick={onRun} disabled={running} icon={running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} data-testid="verify-test" title="Verify & Test (Ctrl+Enter)">
        <span className="hidden sm:inline">{running ? 'Testing…' : 'Verify & Test'}</span>
        <span className="hidden lg:inline-flex">
          <Kbd className="border-white/30 bg-white/10 text-white/80 shadow-none">Ctrl ↵</Kbd>
        </span>
      </Button>
    </div>
  );
}

/** Top mission bar (memoized: the page re-renders while tests run). */
export const MissionBar = memo(MissionBarImpl);

export function HintsModal({
  open,
  mission,
  hintsUsed,
  bestStars,
  onReveal,
  onClose,
}: {
  open: boolean;
  mission: MissionDef;
  hintsUsed: number;
  bestStars: number;
  onReveal(): void;
  onClose(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  const revealed = mission.hints.slice(0, hintsUsed);
  const left = mission.hints.length - hintsUsed;
  const firstHint = hintsUsed === 0;
  return (
    <Modal
      open={open}
      onClose={() => {
        setConfirm(false);
        onClose();
      }}
      title={
        <span className="flex items-center gap-2">
          <Lightbulb size={18} className="text-amber-300" /> Hints · {mission.title}
        </span>
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {left > 0 &&
            (firstHint && !confirm ? (
              <Button variant="warning" size="sm" onClick={() => setConfirm(true)} data-testid="reveal-hint">
                Reveal hint 1 of {mission.hints.length}
              </Button>
            ) : (
              <Button
                variant="warning"
                size="sm"
                onClick={() => {
                  setConfirm(false);
                  onReveal();
                }}
                data-testid={firstHint ? 'reveal-hint-confirm' : 'reveal-hint'}
              >
                {firstHint ? 'Yes, reveal it' : `Reveal hint ${hintsUsed + 1} of ${mission.hints.length}`}
              </Button>
            ))}
        </>
      }
    >
      <div className="space-y-3">
        {revealed.length === 0 && !confirm && (
          <p className="text-sm text-slate-300">
            Stuck? Hints go from a gentle nudge to (almost) the answer. Try <strong className="text-white">Watch this test</strong> on a failing test first — seeing what the
            plant does often tells you what is missing.
          </p>
        )}
        {(confirm || (firstHint && left > 0)) && (
          <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]', confirm ? 'border-amber-400/60 bg-amber-400/15 text-amber-100' : 'border-amber-400/25 bg-amber-400/5 text-amber-200/90')}>
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>
              Revealing a hint lowers this mission’s best possible rating to <strong>2 stars</strong> (the third star is for solving it without hints).
              {bestStars === 3 && ' Your existing 3-star record is kept.'}
            </span>
          </div>
        )}
        {revealed.map((h, i) => (
          <div key={i} className="rounded-lg border border-edge bg-panel px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold tracking-wide text-amber-300/80 uppercase">Hint {i + 1}</div>
            <Markdown source={h} />
          </div>
        ))}
        {left === 0 && <p className="text-xs text-slate-500">That was the last hint — the next step is yours!</p>}
      </div>
    </Modal>
  );
}

/** Why a mission is locked, and the mission to play first (if one clearly unlocks it). */
export function lockReason(profile: PlayerProfile, mission: MissionDef): { text: string; next?: MissionDef } {
  const ch = getChapter(mission.chapter);
  if (ch && !isChapterUnlockedFor(profile, ch.id)) {
    const prev = CHAPTERS.find((c) => c.order === ch.order - 1);
    const boss = prev ? chapterBoss(prev.id) : undefined;
    const firstOpen = prev ? missionsByChapter(prev.id).find((m) => !profile.missions[m.id]?.completed && isMissionUnlockedFor(profile, m.id)) : undefined;
    return {
      text: prev
        ? `Chapter ${ch.order} opens once you finish ${Math.round(CHAPTER_UNLOCK_SHARE * 100)} % of chapter ${prev.order} — ${prev.title}${boss ? ` (or beat its boss, “${boss.title}”)` : ''}.`
        : 'This chapter is not open yet.',
      ...(firstOpen ? { next: firstOpen } : {}),
    };
  }
  const reqs = mission.requires?.length ? mission.requires.map((id) => getMission(id)).filter((m): m is MissionDef => !!m) : missionsByChapter(mission.chapter).filter((m) => m.order < mission.order).slice(-1);
  const missing = reqs.filter((m) => !profile.missions[m.id]?.completed);
  if (missing.length > 0) {
    const first = missing[0]!;
    return { text: `Complete ${missing.map((m) => `${m.id} “${m.title}”`).join(' and ')} first.`, ...(isMissionUnlockedFor(profile, first.id) ? { next: first } : {}) };
  }
  return { text: 'Complete the previous missions first.' };
}

export function LockedMission({ mission }: { mission: MissionDef }) {
  const profile = useGame((s) => s.profile);
  const reason = lockReason(profile, mission);
  return (
    <div className="flex h-full items-center justify-center p-6" data-testid="mission-locked">
      <div className="max-w-md rounded-2xl border border-edge bg-panel-2 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800 text-slate-400">
          <Lock size={26} />
        </div>
        <div className="mb-1 flex justify-center">
          <ChapterChip chapterId={mission.chapter} />
        </div>
        <h1 className="mt-2 text-xl font-bold text-white">{mission.title} is locked</h1>
        <p className="mt-2 text-sm text-slate-400">{reason.text}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {reason.next && (
            <Link href={routes.mission(reason.next.id)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ab-red px-4 text-sm font-medium text-white hover:bg-red-500">
              <Play size={15} /> Play {reason.next.id} · {reason.next.title}
            </Link>
          )}
          <Link
            href={routes.campaign}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium',
              reason.next ? 'border border-edge bg-panel-3 text-slate-100 hover:bg-slate-700' : 'bg-ab-red text-white hover:bg-red-500',
            )}
          >
            <MapIcon size={16} /> Campaign map
          </Link>
        </div>
      </div>
    </div>
  );
}

export function NotFoundMission({ id }: { id: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
      <TriangleAlert size={36} className="text-amber-400" />
      <h1 className="text-xl font-semibold text-slate-100">Mission “{id}” does not exist</h1>
      <Link href={routes.campaign} className="text-sky-400 hover:underline">
        Back to the campaign map
      </Link>
    </div>
  );
}
