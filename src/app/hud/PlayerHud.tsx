/**
 * Player HUD for the TopNav right slot: rank insignia + level, XP bar (tooltip: xp / next level),
 * streak flame and total stars. Click → Profile. Shows a floating "+N XP" beside the HUD (inside the
 * top bar, so it never covers page controls such as the mission bar's Hints button) when XP is gained.
 */
import { Flame, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { cn } from '../../ui';
import { routes } from '../routes';
import { fmt, usePlayerSummary } from './player';
import { useReducedMotion } from './prefs';
import { mix, RankInsignia } from './RankInsignia';

interface XpPop {
  id: number;
  amount: number;
}

let popId = 1;

export function PlayerHud({ className }: { className?: string }) {
  const p = usePlayerSummary();
  const reduced = useReducedMotion();
  const { level, streak } = p;
  const pct = Math.round(level.progress * 100);
  const color = level.color;

  // "+N XP" pop when XP goes up (not on first render / hydration / reset).
  const prevXp = useRef(p.xp);
  const [pop, setPop] = useState<XpPop | null>(null);
  useEffect(() => {
    const gained = p.xp - prevXp.current;
    prevXp.current = p.xp;
    if (gained <= 0) return;
    const next = { id: popId++, amount: gained };
    setPop(next);
    const h = window.setTimeout(() => setPop((cur) => (cur?.id === next.id ? null : cur)), 1900);
    return () => window.clearTimeout(h);
  }, [p.xp]);

  const levelTip = level.xpToNext > 0 ? `${fmt(p.xp)} / ${fmt(level.nextAt)} XP — ${fmt(level.xpToNext)} to level ${level.level + 1}` : `${fmt(p.xp)} XP — max level`;
  const streakTip = streak.activeToday
    ? `${streak.days}-day streak — you trained today`
    : streak.atRisk
      ? `${streak.days}-day streak — play a mission today to keep it`
      : 'No streak yet — play a mission today to light the flame';

  return (
    <Link
      href={routes.profile}
      aria-label={`Profile: ${p.name}, level ${level.level} ${level.title}, ${levelTip}, ${p.stars} stars, streak ${streak.days} days`}
      className={cn(
        'group relative mr-1 flex h-10 items-center gap-2.5 rounded-xl border border-transparent px-1.5 transition-colors sm:px-2',
        'hover:border-edge hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        className,
      )}
    >
      {/* insignia + level */}
      <span className="relative flex items-center">
        <RankInsignia level={level.level} size={26} glow />
        <span
          className="absolute -right-1.5 -bottom-1 rounded-[5px] border px-[3px] font-mono text-[9px] leading-[13px] font-bold text-white sm:hidden"
          style={{ background: mix(color, '#0b0f14', 0.55), borderColor: color }}
        >
          {level.level}
        </span>
      </span>

      {/* level + XP bar */}
      <span className="hidden w-[118px] flex-col gap-1 sm:flex xl:w-[190px]">
        <span className="flex items-baseline justify-between gap-2 leading-none">
          <span className="truncate text-[11px] font-semibold text-slate-200">
            <span className="font-mono text-white">LV {level.level}</span>
            <span className="ml-1.5 hidden font-medium xl:inline" style={{ color }}>
              {level.title}
            </span>
          </span>
          <span className="font-mono text-[10px] text-slate-400">{pct}%</span>
        </span>
        <span className="relative h-1.5 overflow-hidden rounded-full bg-slate-800 ring-1 ring-white/5">
          <span
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(3, pct)}%`, background: `linear-gradient(90deg, ${mix(color, '#000000', 0.25)}, ${color})`, boxShadow: `0 0 8px ${color}88` }}
          />
          {!reduced && <span className="pw-bar-shine absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/35 to-transparent" />}
        </span>
      </span>

      {/* streak */}
      <span className="hidden items-center gap-1 min-[360px]:flex" title={streakTip}>
        <Flame
          size={17}
          className={cn(
            streak.activeToday ? 'fill-orange-500/80 text-orange-400 drop-shadow-[0_0_6px_rgba(249,115,22,0.7)]' : streak.atRisk ? 'text-orange-400/70' : 'text-slate-600',
            streak.activeToday && !reduced && 'pw-flame',
          )}
        />
        <span className={cn('font-mono text-[13px] font-semibold', streak.days > 0 ? 'text-orange-200' : 'text-slate-400')}>{streak.days}</span>
      </span>

      {/* stars */}
      <span className="hidden items-center gap-1 min-[360px]:flex" title={`${p.stars} of ${p.maxStars} stars`}>
        <Star size={16} className="fill-yellow-400 text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.45)]" />
        <span className="font-mono text-[13px] font-semibold text-yellow-100">{p.stars}</span>
      </span>

      {/* XP gained pop — floats up beside the HUD inside the top bar (never over the page below it) */}
      {pop && (
        <span
          key={pop.id}
          className="pointer-events-none absolute top-1/2 right-full z-50 mr-1 rounded-full border border-yellow-300/40 bg-yellow-400/15 px-2 py-0.5 font-mono text-[11px] font-bold whitespace-nowrap text-yellow-200 shadow-lg shadow-yellow-900/30 backdrop-blur"
          style={{ animation: reduced ? undefined : 'pw-xp-float 1.8s ease-out both', transform: reduced ? 'translateY(-50%)' : undefined }}
          data-testid="xp-pop"
          aria-hidden
        >
          +{fmt(pop.amount)} XP
        </span>
      )}

      {/* tooltip */}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute top-full right-0 z-50 mt-2 w-72 rounded-xl border border-edge bg-panel-2/95 p-3 text-left opacity-0 shadow-2xl shadow-black/50 backdrop-blur',
          'translate-y-1 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100',
          pop && 'hidden',
        )}
      >
        <span className="flex items-center gap-3">
          <RankInsignia level={level.level} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{p.name}</span>
            <span className="block text-xs" style={{ color }}>
              {level.title} · Level {level.level}
            </span>
          </span>
        </span>
        <span className="mt-3 block h-2 overflow-hidden rounded-full bg-slate-800">
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </span>
        <span className="mt-1.5 flex justify-between font-mono text-[11px] text-slate-400">
          <span>
            {fmt(p.xp)} / {fmt(level.nextAt)} XP
          </span>
          <span>{level.xpToNext > 0 ? `${fmt(level.xpToNext)} to go` : 'max'}</span>
        </span>
        {level.nextRank && (
          <span className="mt-2 block text-[11px] text-slate-400">
            Next rank: <span style={{ color: level.nextRank.color }}>{level.nextRank.title}</span> at level {level.nextRank.minLevel}
          </span>
        )}
        <span className="mt-2 flex gap-3 border-t border-edge pt-2 text-[11px] text-slate-300">
          <span className="flex items-center gap-1">
            <Flame size={12} className="text-orange-400" /> {streakTip}
          </span>
        </span>
        <span className="mt-1.5 block text-[11px] text-slate-400">Click to open your profile</span>
      </span>
    </Link>
  );
}
