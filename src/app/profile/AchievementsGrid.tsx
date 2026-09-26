/** Profile: achievements grid (unlocked with date, locked dim, secret '???'). */
import { HelpCircle, Lock, Medal, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ACHIEVEMENTS, getAchievement } from '../../game/achievements';
import { MISSIONS } from '../../game/missions';
import { useGame } from '../../game/store';
import type { AchievementDef } from '../../game/types';
import { cn, gameIcon } from '../../ui';
import { routes } from '../routes';

type Filter = 'all' | 'unlocked' | 'locked';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function Medallion({ a, unlocked }: { a: AchievementDef; unlocked: boolean }) {
  const Icon = !unlocked && a.secret ? HelpCircle : gameIcon(a.icon);
  return (
    <span
      className={cn(
        'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
        unlocked ? 'bg-gradient-to-b from-yellow-300 to-amber-600 shadow-[0_0_18px_rgba(250,204,21,0.35)]' : 'bg-slate-800',
      )}
    >
      <span className={cn('absolute inset-[3px] rounded-full', unlocked ? 'bg-gradient-to-b from-[#3a2a06] to-[#171006]' : 'bg-[#10151b]')} />
      <Icon size={20} className={cn('relative', unlocked ? 'text-yellow-200' : 'text-slate-600')} strokeWidth={2.2} />
      {!unlocked && (
        <span className="absolute -right-0.5 -bottom-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border-2 border-panel-2 bg-slate-700 text-slate-300">
          <Lock size={9} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const first = MISSIONS[0];
  return (
    <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge bg-panel/40 px-6 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-b from-yellow-300/25 to-amber-600/20 text-yellow-200">
        <Medal size={22} />
      </span>
      {filter === 'unlocked' ? (
        <>
          <p className="text-[14px] font-semibold text-white">No medals yet</p>
          <p className="max-w-sm text-[12.5px] leading-snug text-slate-400">
            Clear {first ? <>mission {first.id} “{first.title}”</> : 'your first mission'} to earn <span className="font-semibold text-yellow-200">{firstAchievementTitle()}</span>.
          </p>
          {first && (
            <Link href={routes.mission(first.id)} className="rounded-lg bg-ab-red px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none">
              Play {first.id}
            </Link>
          )}
        </>
      ) : (
        <>
          <p className="text-[14px] font-semibold text-white">Every achievement unlocked</p>
          <p className="max-w-sm text-[12.5px] leading-snug text-slate-400">Nothing left to find — you have collected them all.</p>
        </>
      )}
    </div>
  );
}

function firstAchievementTitle(): string {
  return getAchievement('first-light')?.title ?? 'your first medal';
}

export function AchievementsGrid() {
  const unlockedMap = useGame((s) => s.profile.achievements);
  const [filter, setFilter] = useState<Filter>('all');
  const count = ACHIEVEMENTS.filter((a) => unlockedMap[a.id] !== undefined).length;
  const xpEarned = ACHIEVEMENTS.reduce((n, a) => n + (unlockedMap[a.id] !== undefined ? a.xp : 0), 0);

  const list = useMemo(() => {
    const items = ACHIEVEMENTS.map((a) => ({ a, at: unlockedMap[a.id] }));
    const f = items.filter(({ at }) => (filter === 'all' ? true : filter === 'unlocked' ? at !== undefined : at === undefined));
    // Unlocked first (newest first), then locked in definition order; secrets last.
    return f.sort((x, y) => {
      if ((x.at !== undefined) !== (y.at !== undefined)) return x.at !== undefined ? -1 : 1;
      if (x.at !== undefined && y.at !== undefined) return y.at - x.at;
      return (x.a.secret ? 1 : 0) - (y.a.secret ? 1 : 0);
    });
  }, [unlockedMap, filter]);

  const tabs: Array<[Filter, string, number]> = [
    ['all', 'All', ACHIEVEMENTS.length],
    ['unlocked', 'Unlocked', count],
    ['locked', 'Locked', ACHIEVEMENTS.length - count],
  ];

  return (
    <section className="rounded-2xl border border-edge bg-panel-2/80 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
          <Trophy size={17} className="text-yellow-300" /> Achievements
        </h2>
        <span className="font-mono text-[12px] text-slate-400">
          {count}/{ACHIEVEMENTS.length} · <span className="text-yellow-200">+{xpEarned} XP</span>
        </span>
        <div role="group" aria-label="Show achievements" className="ml-auto flex rounded-lg border border-edge bg-panel p-0.5">
          {tabs.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none',
                filter === id ? 'bg-panel-3 text-white shadow' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {label}
              <span className="font-mono text-[10.5px] text-slate-400">{n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-300" style={{ width: `${(count / ACHIEVEMENTS.length) * 100}%` }} />
      </div>

      {list.length === 0 && <EmptyState filter={filter} />}
      <ul className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {list.map(({ a, at }) => {
          const unlocked = at !== undefined;
          const hidden = !unlocked && a.secret;
          return (
            <li
              key={a.id}
              className={cn(
                'flex gap-3 rounded-xl border p-3 transition-colors',
                unlocked ? 'border-yellow-400/20 bg-gradient-to-br from-yellow-500/[0.07] to-transparent' : 'border-edge bg-panel/60',
              )}
            >
              <Medallion a={a} unlocked={unlocked} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className={cn('text-[13.5px] leading-snug font-semibold', unlocked ? 'text-white' : hidden ? 'font-mono tracking-widest text-slate-400' : 'text-slate-300')}>
                    {hidden ? '???' : a.title}
                  </span>
                  <span className={cn('shrink-0 font-mono text-[11px] font-semibold', unlocked ? 'text-yellow-200' : 'text-slate-400')}>+{a.xp}</span>
                </div>
                <p className={cn('mt-0.5 text-[12px] leading-snug', unlocked ? 'text-slate-400' : 'text-slate-400')}>{hidden ? 'Secret achievement — keep exploring the plant.' : a.description}</p>
                {unlocked && <p className="mt-1.5 font-mono text-[10.5px] text-emerald-300/80">Unlocked {dateFmt.format(new Date(at))}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
