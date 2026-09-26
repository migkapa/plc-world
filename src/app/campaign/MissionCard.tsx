/** Mission details for the campaign drawer: briefing card with stats and the Play / Replay button. */
import { ArrowLeft, ArrowRight, BookOpen, Cpu, Crown, Factory, Hammer, Lightbulb, Lock, Play, RotateCcw, Sparkles, Target, Wrench, X, Zap } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { sfx } from '../../audio/sfx';
import { getChapter } from '../../game/chapters';
import { nextMission, previousMission } from '../../game/missions';
import { missionXpValue } from '../../game/store';
import type { MissionDef, PlayerProfile } from '../../game/types';
import { Button, cn, GameIcon, IconButton, Stars } from '../../ui';
import { mix } from '../hud/RankInsignia';
import { routes } from '../routes';
import { DIFFICULTY_LABEL, KIND_LABEL, missionLockReason, missionState } from './progress';
import { sceneInfo } from './sceneInfo';

export function DifficultyPips({ value, color, className }: { value: number; color: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-label={`Difficulty ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="h-2.5 w-4 -skew-x-12 rounded-[2px]"
          style={i <= value ? { background: color, boxShadow: `0 0 6px ${color}88` } : { background: '#1e293b', boxShadow: 'inset 0 0 0 1px #334155' }}
        />
      ))}
    </span>
  );
}

const KIND_ICON = { build: Hammer, troubleshoot: Wrench, boss: Crown } as const;

/** Render `code` and **bold** spans of a one-line markdown string. */
export function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 1 ? (
          <code key={i} className="rounded bg-black/40 px-1 py-px font-mono text-[0.88em] text-emerald-300">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith('**') && p.endsWith('**') && p.length > 3 ? (
          <strong key={i} className="font-semibold text-white">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-panel/70 px-3 py-2">
      <div className="text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-slate-100">{children}</div>
    </div>
  );
}

export interface MissionCardProps {
  mission: MissionDef;
  profile: PlayerProfile;
  onSelect(m: MissionDef): void;
  onClose?: () => void;
  /** id for the title heading (the dialog / region is labelled by it). */
  titleId?: string;
}

export function MissionCard({ mission, profile, onSelect, onClose, titleId }: MissionCardProps) {
  const [, navigate] = useLocation();
  const chapter = getChapter(mission.chapter);
  const color = chapter?.color ?? '#e0252b';
  const pr = profile.missions[mission.id];
  const state = missionState(profile, mission);
  const lockReason = missionLockReason(profile, mission);
  const scene = sceneInfo(mission.sceneId);
  const KindIcon = KIND_ICON[mission.kind];
  const maxXp = missionXpValue(mission, 3);
  const earnedXp = missionXpValue(mission, pr?.stars ?? 0);
  const prev = previousMission(mission.id);
  const next = nextMission(mission.id);
  const inProgress = state === 'available' && ((pr?.attempts ?? 0) > 0 || (pr?.savedRungs?.length ?? 0) > 0);

  const play = () => {
    sfx.play('click');
    navigate(routes.mission(mission.id));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div
        className="relative shrink-0 overflow-hidden border-b border-edge px-5 pt-4 pb-5"
        style={{ background: `radial-gradient(130% 120% at 0% 0%, ${color}40, transparent 60%), linear-gradient(180deg, ${mix(color, '#0f1419', 0.88)}, #121820)` }}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `${color}33`, color }}>
            <GameIcon name={chapter?.icon} size={14} strokeWidth={2.4} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-300">
            Chapter {chapter?.order} · {chapter?.title}
          </span>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <span className="rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[12px] font-bold text-white">{mission.id}</span>
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
            style={
              mission.kind === 'boss'
                ? { borderColor: '#f5c40066', background: '#f5c4001a', color: '#fde68a' }
                : mission.kind === 'troubleshoot'
                  ? { borderColor: '#e0252b66', background: '#e0252b1a', color: '#fca5a5' }
                  : { borderColor: '#38bdf855', background: '#38bdf814', color: '#bae6fd' }
            }
          >
            <KindIcon size={11} /> {KIND_LABEL[mission.kind]}
          </span>
          {state === 'completed' && (
            <span className="ml-auto">
              <Stars value={pr?.stars ?? 0} size={18} />
            </span>
          )}
          {state === 'locked' && <Lock size={16} className="ml-auto text-slate-400" />}
        </div>
        <h2 id={titleId} className="mt-2 text-[26px] leading-tight font-bold tracking-tight text-white">
          <span className="sr-only">{mission.id}: </span>
          {mission.title}
        </h2>
        <p className="mt-1.5 text-[14px] leading-snug text-slate-300">
          <InlineText text={mission.tagline} />
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2 text-[12px] text-slate-400">
            <DifficultyPips value={mission.difficulty} color={color} />
            <span className="font-semibold text-slate-300">{DIFFICULTY_LABEL[mission.difficulty]}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-yellow-200">
            <Zap size={13} className="fill-yellow-400 text-yellow-400" />
            {mission.xp} XP
            <span className="font-normal text-slate-400">· up to {maxXp} with ★★★</span>
          </span>
        </div>
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {lockReason && (
          <div className="flex gap-2.5 rounded-xl border border-safety/30 bg-safety/[0.07] p-3 text-[13px] leading-snug text-slate-200">
            <Lock size={15} className="mt-0.5 shrink-0 text-safety" />
            <span>{lockReason}</span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Best">{state === 'completed' ? <Stars value={pr?.stars ?? 0} size={14} /> : <span className="text-slate-400">—</span>}</Stat>
          <Stat label="Attempts">{pr?.attempts ?? 0}</Stat>
          <Stat label="XP earned">
            <span className={earnedXp > 0 ? 'text-yellow-200' : 'text-slate-400'}>
              {earnedXp}
              <span className="text-[11px] font-normal text-slate-400">/{maxXp}</span>
            </span>
          </Stat>
          <Stat label="Instructions">
            {pr?.bestInstructionCount !== undefined ? pr.bestInstructionCount : <span className="text-slate-400">—</span>}
            {mission.parInstructions !== undefined && <span className="text-[11px] font-normal text-slate-400"> / par {mission.parInstructions}</span>}
          </Stat>
          <Stat label="Hints used">
            {pr?.hintsUsed ?? 0}
            <span className="text-[11px] font-normal text-slate-400">/{mission.hints.length}</span>
          </Stat>
          <Stat label="Tests">{mission.tests.length}</Stat>
        </div>

        {/* star rules */}
        <div className="rounded-xl border border-edge bg-panel/60 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            <Sparkles size={12} /> Earn your stars
          </div>
          <ul className="space-y-1.5 text-[12.5px] text-slate-300">
            <li className="flex items-center gap-2">
              <Stars value={1} size={12} /> All acceptance tests pass
            </li>
            <li className="flex items-center gap-2">
              <Stars value={2} size={12} />
              {mission.parInstructions !== undefined ? <>At or under par ({mission.parInstructions} instructions)</> : <>Clean solution</>}
            </li>
            <li className="flex items-center gap-2">
              <Stars value={3} size={12} /> …and no hints revealed
            </li>
          </ul>
        </div>

        {/* plant */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            <Factory size={12} /> Training plant
          </div>
          <div className="flex gap-3 rounded-xl border border-edge bg-panel/60 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel-3 text-slate-300">
              <Cpu size={20} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-white">{scene.title}</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-slate-400">
                {scene.platform}
                {scene.cpu && ` · ${scene.cpu}`}
                {scene.chassis && ` · ${scene.chassis}`}
              </div>
            </div>
          </div>
        </div>

        {/* concepts */}
        {mission.concepts.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              <BookOpen size={12} /> Concepts
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mission.concepts.map((c) => (
                <Link
                  key={c}
                  href={routes.reference(c)}
                  className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 font-mono text-[11.5px] font-semibold text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/20"
                >
                  {c}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* objectives */}
        {mission.objectives.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              <Target size={12} /> Objectives
            </div>
            <ul className="space-y-1.5">
              {mission.objectives.map((o, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-300">
                  <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: state === 'completed' ? '#22c55e' : color }} />
                  <span>
                    <InlineText text={o} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mission.hints.length > 0 && (
          <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
            <Lightbulb size={12} /> {mission.hints.length} progressive hints available (revealing one caps the mission at ★★).
          </p>
        )}
      </div>

      {/* footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-edge bg-panel/80 px-4 py-3">
        <IconButton
          label="Previous mission"
          size="md"
          variant="ghost"
          className="rounded-lg"
          disabled={!prev}
          onClick={() => prev && onSelect(prev)}
          title={prev ? `Previous: ${prev.id} ${prev.title}` : 'Previous mission'}
        >
          <ArrowLeft size={18} />
        </IconButton>
        <Button
          variant={state === 'completed' ? 'secondary' : 'primary'}
          size="lg"
          className="flex-1"
          disabled={state === 'locked'}
          data-autofocus
          onClick={play}
          icon={state === 'locked' ? <Lock size={18} /> : state === 'completed' ? <RotateCcw size={18} /> : <Play size={18} className="fill-current" />}
        >
          {state === 'locked' ? 'Locked' : state === 'completed' ? 'Replay' : inProgress ? 'Resume' : 'Play'}
        </Button>
        <IconButton
          label="Next mission"
          size="md"
          variant="ghost"
          className="rounded-lg"
          disabled={!next}
          onClick={() => next && onSelect(next)}
          title={next ? `Next: ${next.id} ${next.title}` : 'Next mission'}
        >
          <ArrowRight size={18} />
        </IconButton>
      </div>
    </div>
  );
}
