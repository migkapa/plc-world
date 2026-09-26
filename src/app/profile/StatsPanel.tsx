/** Profile: career stats + per-chapter campaign progress. */
import { Activity, BarChart3, Clock3, Flame, Lightbulb, MousePointerClick, Pencil, RotateCcw, Sparkles, Star, Target, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { CHAPTERS } from '../../game/chapters';
import { chapterProgress, useGame } from '../../game/store';
import { cn, GameIcon } from '../../ui';
import { chapterUnlock } from '../campaign/progress';
import { fmt, usePlayerSummary } from '../hud/player';

function duration(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return ms > 0 ? '< 1 min' : '0 min';
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

function StatTile({ icon, label, value, sub, accent }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-edge bg-panel/70 p-3.5">
      <div className="absolute -top-6 -right-6 h-16 w-16 rounded-full blur-2xl" style={{ background: `${accent}22` }} />
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">
        <span style={{ color: accent }}>{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 font-mono text-[22px] leading-none font-bold text-white">{value}</div>
      {sub && <div className="mt-1 truncate text-[11.5px] text-slate-400">{sub}</div>}
    </div>
  );
}

export function StatsPanel() {
  const p = usePlayerSummary();
  const profile = useGame((s) => s.profile);
  const stats = profile.stats ?? {};
  return (
    <section className="rounded-2xl border border-edge bg-panel-2/80 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
        <BarChart3 size={17} className="text-sky-300" /> Career stats
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile icon={<Target size={13} />} label="Missions" value={`${p.missionsDone}/${p.missionsTotal}`} sub={`${Math.round((p.missionsDone / Math.max(1, p.missionsTotal)) * 100)}% complete`} accent="#22c55e" />
        <StatTile icon={<Star size={13} />} label="Total stars" value={`${p.stars}`} sub={`of ${p.maxStars}`} accent="#facc15" />
        <StatTile icon={<Sparkles size={13} />} label="3-star clears" value={p.threeStars} sub="perfect missions" accent="#f5c400" />
        <StatTile icon={<Activity size={13} />} label="Total XP" value={fmt(p.xp)} sub={`level ${p.level.level}`} accent={p.level.color} />
        <StatTile icon={<RotateCcw size={13} />} label="Attempts" value={p.attempts} sub="mission starts" accent="#38bdf8" />
        <StatTile icon={<Lightbulb size={13} />} label="Hints used" value={p.hintsUsed} sub="revealed in missions" accent="#fbbf24" />
        <StatTile icon={<XCircle size={13} />} label="Failed runs" value={stats.testRunsFailed ?? 0} sub="test runs that didn't pass" accent="#f87171" />
        <StatTile
          icon={<Flame size={13} />}
          label="Streak"
          value={
            <>
              {p.streak.days}
              <span className="ml-1 text-[12px] font-medium text-slate-400">{p.streak.days === 1 ? 'day' : 'days'}</span>
            </>
          }
          sub={p.streak.activeToday ? 'trained today' : p.streak.atRisk ? 'play today to keep it' : 'start one today'}
          accent="#f97316"
        />
        <StatTile icon={<Clock3 size={13} />} label="Sandbox time" value={duration(stats.sandboxMs ?? 0)} sub="free experimenting" accent="#2dd4bf" />
        <StatTile icon={<Pencil size={13} />} label="Rung edits" value={fmt(stats.rungEdits ?? 0)} sub="in the ladder editor" accent="#a78bfa" />
        <StatTile icon={<MousePointerClick size={13} />} label="Controls used" value={fmt(stats.controlsUsed ?? 0)} sub="buttons, switches, pots" accent="#60a5fa" />
        <StatTile icon={<Star size={13} />} label="Achievements" value={`${p.achievements}/${p.achievementsTotal}`} sub="unlocked" accent="#c084fc" />
      </div>

      <h3 className="mt-6 mb-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Campaign progress</h3>
      <ul className="space-y-2.5">
        {CHAPTERS.map((ch) => {
          const pr = chapterProgress(profile, ch.id);
          const locked = !chapterUnlock(profile, ch.id).unlocked;
          return (
            <li key={ch.id} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3">
              <GameIcon name={ch.icon} size={16} style={{ color: locked ? '#475569' : ch.color }} />
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                  <span className={cn('truncate font-semibold', locked ? 'text-slate-400' : 'text-slate-200')}>
                    {ch.order}. {ch.title}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">
                    {pr.completed}/{pr.total}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full" style={{ width: `${pr.percent}%`, background: ch.color, boxShadow: pr.percent ? `0 0 8px ${ch.color}88` : undefined }} />
                </div>
              </div>
              <span className="flex w-14 items-center justify-end gap-1 font-mono text-[11.5px] text-yellow-200/90">
                <Star size={11} className="fill-yellow-400 text-yellow-400" />
                {pr.stars}
                <span className="text-slate-400">/{pr.maxStars}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
