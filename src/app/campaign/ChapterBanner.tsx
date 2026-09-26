/** Chapter header on the campaign map: colour, icon, progress, stars, lock / unlock hint. */
import { CheckCircle2, Crown, Lock, Star } from 'lucide-react';
import type { ChapterProgress } from '../../game/store';
import type { ChapterDef } from '../../game/types';
import { cn, GameIcon } from '../../ui';
import { mix } from '../hud/RankInsignia';
import type { ChapterUnlock } from './progress';

export function ChapterHex({ chapter, size = 48, locked }: { chapter: ChapterDef; size?: number; locked?: boolean }) {
  const c = locked ? '#475569' : chapter.color;
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size * 1.1 }}>
      <svg viewBox="0 0 100 110" width={size} height={size * 1.1} className="absolute inset-0">
        <path d="M50 3 L95 29 V81 L50 107 L5 81 V29 Z" fill={mix(c, '#0b0f14', 0.7)} stroke={c} strokeWidth="5" />
        <path d="M50 16 L84 36 V74 L50 94 L16 74 V36 Z" fill="none" stroke={c} strokeOpacity="0.35" strokeWidth="2" />
      </svg>
      {locked ? (
        <Lock size={size * 0.4} className="relative text-slate-400" />
      ) : (
        <GameIcon name={chapter.icon} size={size * 0.44} className="relative" style={{ color: mix(c, '#ffffff', 0.25) }} strokeWidth={2.2} />
      )}
    </span>
  );
}

export interface ChapterBannerProps {
  chapter: ChapterDef;
  progress: ChapterProgress;
  unlock: ChapterUnlock;
  compact: boolean;
  style?: React.CSSProperties;
}

export function ChapterBanner({ chapter, progress, unlock, compact, style }: ChapterBannerProps) {
  const locked = !unlock.unlocked;
  const complete = progress.total > 0 && progress.completed === progress.total;
  const c = chapter.color;
  const status = locked ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-600/60 bg-slate-800/80 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
      <Lock size={11} /> Locked
    </span>
  ) : complete ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
      <CheckCircle2 size={11} /> Complete
    </span>
  ) : progress.bossCompleted ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400/40 bg-yellow-500/10 px-2 py-0.5 text-[11px] font-semibold text-yellow-200">
      <Crown size={11} /> Boss beaten
    </span>
  ) : progress.completed > 0 ? (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: `${c}66`, background: `${c}1f`, color: mix(c, '#ffffff', 0.4) }}>
      In progress
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ borderColor: `${c}66`, background: `${c}1f`, color: mix(c, '#ffffff', 0.4) }}>
      New
    </span>
  );

  return (
    <div
      id={`chapter-${chapter.id}`}
      className={cn(
        'absolute z-[5] flex overflow-hidden rounded-2xl border shadow-xl shadow-black/40 backdrop-blur-md',
        compact ? 'flex-col justify-center gap-2 px-3.5 py-3' : 'items-center gap-4 px-5',
        locked ? 'border-slate-700/80 bg-[#0f1419]/95' : 'bg-[#10161d]/95',
      )}
      style={{
        ...style,
        scrollMarginTop: 24,
        borderColor: locked ? undefined : `${c}55`,
        backgroundImage: locked ? undefined : `linear-gradient(100deg, ${c}26, transparent 55%)`,
      }}
    >
      {/* colour edge */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: locked ? '#334155' : c }} />
      <div className={cn('flex min-w-0 items-center', compact ? 'gap-3' : 'gap-4')}>
        <ChapterHex chapter={chapter} size={compact ? 38 : 50} locked={locked} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase" style={{ color: locked ? '#94a3b8' : mix(c, '#ffffff', 0.2) }}>
              Chapter {chapter.order}
            </span>
            {compact && status}
          </div>
          <h2 className={cn('truncate font-bold tracking-tight', compact ? 'text-[17px]' : 'text-xl', locked ? 'text-slate-400' : 'text-white')}>{chapter.title}</h2>
          {!compact && <p className="truncate text-[13px] text-slate-400">{chapter.subtitle}</p>}
        </div>
      </div>

      {locked ? (
        <div className={cn('flex min-w-0 items-start gap-2 text-[12px] leading-snug text-slate-400', compact ? '' : 'ml-auto max-w-[46%]')}>
          <Lock size={13} className="mt-0.5 shrink-0 text-safety" />
          <span className="line-clamp-3">
            <span className="font-semibold text-slate-200">To unlock: </span>
            {unlock.hint}
          </span>
        </div>
      ) : (
        <div className={cn('flex items-center gap-4', compact ? '' : 'ml-auto')}>
          <div className={cn('flex flex-col gap-1.5', compact ? 'flex-1' : 'w-44')}>
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="font-semibold text-slate-300">
                <span className="font-mono text-white">{progress.completed}</span>/{progress.total} missions
              </span>
              <span className="flex items-center gap-1 font-mono text-yellow-200">
                <Star size={11} className="fill-yellow-400 text-yellow-400" />
                {progress.stars}/{progress.maxStars}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${progress.percent}%`, background: c, boxShadow: `0 0 10px ${c}` }} />
            </div>
          </div>
          {!compact && status}
        </div>
      )}
    </div>
  );
}
