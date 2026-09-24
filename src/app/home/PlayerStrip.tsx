/** Home: player summary strip (rank, XP, stars, missions, streak, achievements). */
import { ChevronRight, Flame, Medal, Star, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { cn } from '../../ui';
import { fmt, usePlayerSummary } from '../hud/player';
import { mix, RankInsignia } from '../hud/RankInsignia';
import { routes } from '../routes';

function Tile({ icon, label, value, sub, accent }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; accent: string }) {
  return (
    <div className="flex h-full min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{
          background: `${accent}1a`,
          color: accent,
          boxShadow: `inset 0 0 0 1px ${accent}33`,
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">{label}</div>
        <div className="truncate font-mono text-[20px] leading-tight font-bold text-white">{value}</div>
        {sub && <div className="truncate text-[11.5px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

export function PlayerStrip() {
  const p = usePlayerSummary();
  const { level } = p;
  const pct = Math.round(level.progress * 100);
  return (
    <Link
      href={routes.profile}
      className="group relative block overflow-hidden rounded-2xl border border-edge bg-panel-2/80 shadow-xl shadow-black/30 transition-colors hover:border-slate-600 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
    >
      <div
        className="absolute inset-y-0 left-0 w-[40%]"
        style={{
          background: `radial-gradient(90% 140% at 0% 50%, ${level.color}22, transparent 70%)`,
        }}
      />
      {/* rank on its own row below xl (1280 px), one row of five from xl up */}
      <div className="relative flex flex-col xl:flex-row">
        {/* rank */}
        <div className="flex min-w-0 items-center gap-4 border-b border-edge px-4 py-4 sm:px-5 xl:w-[29%] xl:shrink-0 xl:border-r xl:border-b-0">
          <RankInsignia level={level.level} size={58} showLevel />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-bold text-white">{p.name}</div>
            <div className="text-[12.5px] font-semibold" style={{ color: level.color }}>
              {level.title} · Level {level.level}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{
                  width: `${Math.max(2, pct)}%`,
                  background: `linear-gradient(90deg, ${mix(level.color, '#000000', 0.3)}, ${level.color})`,
                  boxShadow: `0 0 10px ${level.color}88`,
                }}
              />
            </div>
            <div className="mt-1 flex justify-between gap-2 font-mono text-[10.5px] whitespace-nowrap text-slate-400">
              <span>
                {fmt(p.xp)} / {fmt(level.nextAt)} XP
              </span>
              <span>{level.xpToNext > 0 ? `${fmt(level.xpToNext)} to LV ${level.level + 1}` : 'Max level'}</span>
            </div>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 divide-edge md:grid-cols-4 md:divide-x">
          <Tile icon={<Star size={19} className="fill-current" />} label="Stars" value={p.stars} sub={`of ${p.maxStars} · ${p.threeStars} perfect`} accent="#facc15" />
          <Tile
            icon={<Target size={19} />}
            label="Missions"
            value={`${p.missionsDone}/${p.missionsTotal}`}
            sub={`${Math.round((p.missionsDone / Math.max(1, p.missionsTotal)) * 100)}% complete`}
            accent="#22c55e"
          />
          <Tile
            icon={<Flame size={19} className={cn(p.streak.activeToday && 'fill-current')} />}
            label="Streak"
            value={
              <>
                {p.streak.days}
                <span className="ml-1 text-[12px] font-medium text-slate-400">{p.streak.days === 1 ? 'day' : 'days'}</span>
              </>
            }
            sub={p.streak.activeToday ? 'Trained today' : p.streak.atRisk ? 'Play today to keep it' : 'Play a mission today'}
            accent="#f97316"
          />
          <div className="relative">
            <Tile icon={<Medal size={19} />} label="Achievements" value={`${p.achievements}/${p.achievementsTotal}`} sub="Open profile" accent="#a78bfa" />
            <ChevronRight
              size={18}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300"
            />
          </div>
        </div>
      </div>
    </Link>
  );
}
