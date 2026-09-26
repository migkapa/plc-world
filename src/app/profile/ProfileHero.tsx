/** Profile header: big rank insignia, editable name, level & XP progress, rank ladder. */
import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import { RANKS, xpForLevel } from '../../game/ranks';
import { useGame } from '../../game/store';
import { cn } from '../../ui';
import { fmt, usePlayerSummary } from '../hud/player';
import { mix, RankInsignia } from '../hud/RankInsignia';

function NameEditor({ name }: { name: string }) {
  const setName = useGame((s) => s.setName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const nameButton = useRef<HTMLButtonElement>(null);
  /** Put focus back on the name after saving / cancelling (the input unmounts). */
  const refocus = useRef(false);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      nameButton.current?.focus();
    }
  }, [editing]);

  const open = (): void => {
    setDraft(name);
    setEditing(true);
  };

  const close = (): void => {
    refocus.current = true;
    setEditing(false);
  };

  const save = () => {
    const clean = draft.trim();
    if (clean && clean !== name) {
      setName(clean);
      sfx.play('success');
    }
    close();
  };

  if (!editing) {
    return (
      <button
        ref={nameButton}
        type="button"
        onClick={open}
        className="group -ml-2 flex max-w-full min-w-0 cursor-text items-center gap-2 rounded-lg px-2 py-0.5 text-left hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
        aria-label={`Player name: ${name}. Click to edit`}
      >
        <span className="truncate text-[30px] leading-tight font-extrabold tracking-tight text-white sm:text-[38px]">{name}</span>
        <Pencil size={17} className="shrink-0 text-slate-500 transition-colors group-hover:text-slate-200" />
      </button>
    );
  }
  return (
    <form
      className="flex max-w-full items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={draft}
        maxLength={32}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          close();
        }}
        aria-label="Player name"
        className="h-12 w-full max-w-[380px] min-w-0 rounded-lg border border-sky-500/50 bg-black/40 px-3 text-[24px] font-bold text-white outline-none focus:ring-2 focus:ring-sky-400/60"
      />
      <button type="submit" aria-label="Save name" className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-500">
        <Check size={18} />
      </button>
      <button type="button" aria-label="Cancel" onClick={close} className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-panel-3 text-slate-300 hover:bg-slate-700">
        <X size={18} />
      </button>
    </form>
  );
}

function NextRankCard() {
  const p = usePlayerSummary();
  const { level } = p;
  const next = level.nextRank;
  if (!next) {
    return (
      <div className="hidden w-[260px] shrink-0 rounded-2xl border border-safety/30 bg-safety/[0.06] p-4 text-center lg:block">
        <div className="text-[11px] font-semibold tracking-wider text-safety uppercase">Top rank reached</div>
        <p className="mt-2 text-[13px] text-slate-300">You are a Master of Automation. Go collect every ★★★.</p>
      </div>
    );
  }
  const from = xpForLevel(level.rank.minLevel);
  const to = xpForLevel(next.minLevel);
  const share = Math.max(0, Math.min(1, (p.xp - from) / Math.max(1, to - from)));
  return (
    <div className="hidden w-[270px] shrink-0 rounded-2xl border border-white/[0.07] bg-black/25 p-4 backdrop-blur lg:block">
      <div className="text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">Next promotion</div>
      <div className="mt-3 flex items-center gap-3">
        <RankInsignia rank={next} size={52} glow={false} className="opacity-80" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold" style={{ color: next.color }}>
            {next.title}
          </div>
          <div className="font-mono text-[11.5px] text-slate-400">at level {next.minLevel}</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: `linear-gradient(90deg, ${level.color}, ${next.color})` }} />
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-slate-400">{fmt(Math.max(0, to - p.xp))} XP to go</div>
    </div>
  );
}

export function ProfileHero() {
  const p = usePlayerSummary();
  const { level } = p;
  const c = level.color;
  const pct = level.progress * 100;

  // On narrow screens the ladder scrolls sideways: keep the player's own rank in view.
  const ladder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ladder.current;
    const li = box?.querySelector<HTMLElement>('li[data-current]');
    if (!box || !li || box.scrollWidth <= box.clientWidth) return;
    const b = box.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    box.scrollLeft += r.left + r.width / 2 - (b.left + b.width / 2);
  }, [level.rank.title]);

  return (
    <section className="relative isolate overflow-hidden border-b border-edge">
      <div className="absolute inset-0 -z-10" style={{ background: `radial-gradient(50% 120% at 12% 30%, ${c}2e, transparent 65%), radial-gradient(40% 80% at 90% 0%, rgba(224,37,43,0.08), transparent 70%), #0d1218` }} />
      <div
        className="absolute inset-0 -z-10 opacity-50"
        style={{
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          maskImage: 'linear-gradient(90deg, black, transparent 80%)',
        }}
      />
      <div className="mx-auto max-w-[1200px] px-4 pt-8 pb-6 sm:px-6 sm:pt-10">
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:text-left">
          <div className="relative">
            <div className="absolute inset-0 -z-10 scale-125 rounded-full blur-2xl" style={{ background: `${c}33` }} />
            <RankInsignia level={level.level} size={148} showLevel />
          </div>
          <div className="w-full min-w-0 flex-1">
            <div className="font-mono text-[11px] font-bold tracking-[0.2em] text-slate-400 uppercase">Controls tech · Riverside Manufacturing</div>
            <div className="mt-1 flex justify-center sm:justify-start">
              <NameEditor name={p.name} />
            </div>
            <div className="mt-1 text-[16px] font-semibold" style={{ color: c }}>
              {level.title} <span className="text-slate-500">·</span> <span className="text-slate-200">Level {level.level}</span>
            </div>

            <div className="mt-5 max-w-[640px]">
              <div className="flex items-baseline justify-between font-mono text-[12px]">
                <span className="text-slate-300">
                  <span className="text-[18px] font-bold text-white">{fmt(p.xp)}</span> XP
                </span>
                <span className="text-slate-400">{level.xpToNext > 0 ? `${fmt(level.xpToNext)} XP to level ${level.level + 1}` : 'Max level reached'}</span>
              </div>
              <div className="relative mt-2 h-3.5 overflow-hidden rounded-full bg-slate-800/90 ring-1 ring-white/5">
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                  style={{ width: `${Math.max(1.5, pct)}%`, background: `linear-gradient(90deg, ${mix(c, '#000000', 0.35)}, ${c})`, boxShadow: `0 0 14px ${c}99` }}
                />
                {[25, 50, 75].map((t) => (
                  <span key={t} className="absolute inset-y-0 w-px bg-black/40" style={{ left: `${t}%` }} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[11px] text-slate-400">
                <span>LV {level.level} · {fmt(level.currentAt)}</span>
                <span>
                  LV {level.level + 1} · {fmt(level.nextAt)}
                </span>
              </div>
            </div>
          </div>
          <NextRankCard />
        </div>

        {/* rank ladder */}
        <div ref={ladder} className="pw-no-scrollbar -mx-4 mt-8 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ol className="relative flex min-w-[760px] items-start justify-between gap-1">
            <span className="absolute top-[21px] h-0.5 rounded-full bg-slate-800" style={{ left: `${50 / RANKS.length}%`, right: `${50 / RANKS.length}%` }} />
            <span
              className="absolute top-[21px] h-0.5 rounded-full"
              style={{
                left: `${50 / RANKS.length}%`,
                width: `${(p.tier / RANKS.length) * 100}%`,
                background: `linear-gradient(90deg, ${RANKS[0]!.color}, ${level.color})`,
                boxShadow: `0 0 8px ${level.color}88`,
              }}
            />
            {RANKS.map((r) => {
              const reached = level.level >= r.minLevel;
              const current = level.rank.title === r.title;
              const need = xpForLevel(r.minLevel);
              return (
                <li key={r.title} data-current={current || undefined} className="relative flex flex-1 flex-col items-center" title={`${r.title} — level ${r.minLevel} (${fmt(need)} XP)`}>
                  <span className={cn('relative transition-transform', current && 'scale-[1.18]')}>
                    <RankInsignia rank={r} size={40} dim={!reached} glow={current} />
                    {current && <span className="absolute -inset-2 -z-10 rounded-full blur-md" style={{ background: `${r.color}44` }} />}
                  </span>
                  <span className={cn('mt-2 line-clamp-2 max-w-[92px] text-center text-[10.5px] leading-tight font-semibold', current ? 'text-white' : reached ? 'text-slate-200' : 'text-slate-400')}>{r.title}</span>
                  <span className={cn('font-mono text-[9.5px]', current ? '' : 'text-slate-400')} style={current ? { color: r.color } : undefined}>
                    LV {r.minLevel}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
