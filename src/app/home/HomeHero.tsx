/** Home hero: headline + CTAs on the left, a live 3D ControlLogix rack on the right. */
import { ArrowRight, Box, FlaskConical, Map as MapIcon, MousePointer2, Play, RotateCcw, Trophy } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'wouter';
import { sfx } from '../../audio/sfx';
import { getChapter } from '../../game/chapters';
import { MISSIONS } from '../../game/missions';
import { useGame } from '../../game/store';
import type { ControllerStatus } from '../../plc/types';
import { cn, hasWebGL } from '../../ui';
import { campaignComplete, nextPlayableMission } from '../campaign/progress';
import { usePlayerSummary } from '../hud/player';
import { useReducedMotion } from '../hud/prefs';
import { SafeBoundary } from './SafeBoundary';
import { routes } from '../routes';

const HeroRack = lazy(() => import('./HeroRack'));

interface LiveView {
  status: ControllerStatus;
  outs: boolean[];
  ins: boolean[];
}

/**
 * Tiny external store for the LIVE card: the 3D rack publishes ~5×/s and only <LiveCard/> re-renders
 * (keeping this state in <HomeHero/> would re-render the whole R3F tree each time).
 */
interface LiveFeed {
  get(): LiveView | null;
  subscribe(fn: () => void): () => void;
  publish(status: ControllerStatus, outs: boolean[], ins: boolean[]): void;
}

function createLiveFeed(): LiveFeed {
  let view: LiveView | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => view,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    publish(status, outs, ins) {
      view = { status: { ...status }, outs, ins };
      subs.forEach((fn) => fn());
    },
  };
}

/** 1756 digital I/O status indicators are yellow for inputs and outputs alike. */
function Led({ on }: { on: boolean }) {
  return <span className={cn('h-2 w-2 rounded-[2px] transition-colors duration-100', on ? 'bg-[#ffe14a] shadow-[0_0_8px_#ffe14a]' : 'bg-slate-700/80')} />;
}

function LiveCard({ feed }: { feed: LiveFeed }) {
  const view = useSyncExternalStore(feed.subscribe, feed.get, () => null);
  const running = view?.status.running ?? false;
  const mode = view?.status.displayText || (running ? 'Rem Run' : '…');
  return (
    <div className="pointer-events-none w-[244px] rounded-xl border border-white/10 bg-[#0b0f14]/75 p-3 shadow-2xl shadow-black/50 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full', running ? 'animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-600')} />
        <span className="font-mono text-[10.5px] font-bold tracking-[0.16em] text-emerald-300 uppercase">Live</span>
        <span className="ml-auto font-mono text-[10.5px] text-slate-400">1756-L85E</span>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md border border-white/5 bg-black/50 px-2 py-1.5 font-mono text-[12px] text-amber-200/90">
        <span>{mode}</span>
        <span className="text-[10px] text-slate-400">{view ? `${view.status.lastScanMs.toFixed(2)} ms` : ''}</span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-slate-400">Local:1:I.Data</span>
          <span className="flex gap-1">{Array.from({ length: 8 }, (_, i) => <Led key={i} on={view?.ins[i] ?? false} />)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-slate-400">Local:2:O.Data</span>
          <span className="flex gap-1">{Array.from({ length: 8 }, (_, i) => <Led key={i} on={view?.outs[i] ?? false} />)}</span>
        </div>
      </div>
      <div className="mt-2.5 border-t border-white/5 pt-2 font-mono text-[10px] leading-relaxed text-slate-400">
        <span className="text-sky-300">[XIC</span>(Switch_n)<span className="text-sky-300">,LIM</span>(…)<span className="text-sky-300">]OTE</span>(Light_n)
      </div>
    </div>
  );
}

/** Shown if WebGL / the 3D chunk is unavailable: a stylised rack silhouette and a short note. */
function RackFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
      <div className="flex h-[150px] items-end gap-1 rounded-lg border border-slate-700 bg-gradient-to-b from-slate-800 to-slate-900 p-2 shadow-2xl">
        <div className="h-full w-16 rounded bg-slate-700/80" />
        {['#e0252b', '#ffe14a', '#ffe14a', '#38bdf8', '#38bdf8', '#22c55e'].map((c, i) => (
          <div key={i} className="relative h-full w-9 rounded bg-[#1b1f24]">
            <span className="absolute top-2 left-1/2 h-1.5 w-5 -translate-x-1/2 rounded-sm" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[12px] text-slate-300 backdrop-blur">
        <Box size={13} className="text-slate-400" /> 3D preview unavailable on this device
      </p>
    </div>
  );
}

export function HomeHero() {
  const [, navigate] = useLocation();
  const profile = useGame((s) => s.profile);
  const reduced = useReducedMotion();
  const quality = useGame((s) => s.profile.settings.quality);
  const next = useMemo(() => nextPlayableMission(profile), [profile]);
  const done = campaignComplete(profile);
  const started = Object.values(profile.missions).some((m) => m.completed || m.attempts > 0);
  const summary = usePlayerSummary();
  const mastered = done && summary.stars >= summary.maxStars;
  const [feed] = useState(createLiveFeed);
  const [threeOk, setThreeOk] = useState(hasWebGL);
  const nextChapter = next ? getChapter(next.chapter) : undefined;
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e && e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const go = (href: string) => {
    sfx.play('click');
    navigate(href);
  };

  return (
    <section ref={sectionRef} className="relative isolate overflow-hidden">
      {/* backdrop */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 80% at 78% 45%, rgba(224,37,43,0.16), transparent 60%), radial-gradient(40% 60% at 10% 10%, rgba(56,189,248,0.07), transparent 70%), #0b0f14',
        }}
      />
      <div
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'linear-gradient(180deg, black, transparent 95%)',
        }}
      />

      <div className="relative mx-auto grid max-w-[1280px] grid-cols-1 lg:min-h-[620px] lg:grid-cols-[minmax(0,580px)_1fr]">
        {/* 3D */}
        <div
          className="relative h-[300px] sm:h-[380px] lg:absolute lg:inset-y-0 lg:right-[-4%] lg:left-[46%] lg:h-auto xl:right-[-6%] xl:left-[40%]"
          style={{ maskImage: 'linear-gradient(90deg, transparent 0%, black 22%, black 88%, transparent 100%), linear-gradient(180deg, black 80%, transparent)', maskComposite: 'intersect' }}
        >
          {threeOk ? (
            <SafeBoundary fallback={<RackFallback />} onError={() => setThreeOk(false)}>
              <Suspense
                fallback={
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-ab-red" />
                  </div>
                }
              >
                <HeroRack quality={quality} reducedMotion={reduced} active={visible} onStatus={feed.publish} />
              </Suspense>
            </SafeBoundary>
          ) : (
            <RackFallback />
          )}
        </div>
        {threeOk && (
          <>
            <div className="pointer-events-none absolute right-4 bottom-4 z-10 hidden md:block lg:right-8 lg:bottom-14">
              <LiveCard feed={feed} />
            </div>
            <div className="pointer-events-none absolute top-5 right-5 z-10 hidden items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur lg:flex">
              <MousePointer2 size={12} /> Drag to look around · click the key switch
            </div>
          </>
        )}

        {/* copy */}
        <div className="relative z-10 flex flex-col justify-center px-5 pt-2 pb-10 sm:px-8 lg:py-16 lg:pr-0">
          <div className="pw-fade-up inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pr-3 pl-1.5 text-[12px] text-slate-300 backdrop-blur">
            <span className="rounded-full bg-ab-red/90 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">LOGIX 5000</span>
            Ladder logic · 3D digital twins · {MISSIONS.length} missions
          </div>
          <h1 className="pw-fade-up mt-5 text-[34px] leading-[1.04] font-extrabold tracking-[-0.03em] text-white min-[400px]:text-[38px] sm:text-[50px] lg:text-[54px]" style={{ animationDelay: '60ms' }}>
            <span className="block">Master</span>
            <span className="block">Allen&#8209;Bradley PLCs</span>
            <span className="mt-1 block bg-gradient-to-r from-ab-red via-orange-400 to-safety bg-clip-text pb-1 text-transparent">— by playing.</span>
          </h1>
          <p className="pw-fade-up mt-5 max-w-[520px] text-[16px] leading-relaxed text-slate-300 sm:text-[17px]" style={{ animationDelay: '120ms' }}>
            Write real ladder logic in a Studio 5000–style editor, download it to a simulated ControlLogix and watch the machines obey. Seven chapters take you from your first{' '}
            <code className="rounded bg-white/5 px-1 font-mono text-[0.9em] text-emerald-300">XIC</code> to fixing the night shift’s broken programs.
          </p>

          <div className="pw-fade-up mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '180ms' }}>
            {next ? (
              <button
                type="button"
                onClick={() => go(routes.mission(next.id))}
                aria-label={started ? `Continue: ${next.id} ${next.title}` : `Start mission ${next.id}: ${next.title}`}
                className="group relative flex h-14 cursor-pointer items-center gap-3 overflow-hidden rounded-xl bg-ab-red pr-5 pl-4 text-left text-white shadow-[0_10px_30px_-8px_rgba(224,37,43,0.7)] ring-1 ring-white/10 transition-all hover:-translate-y-0.5 hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/20">
                  <Play size={18} className="fill-current" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold tracking-wide text-white/75 uppercase">{started ? `Continue · Chapter ${nextChapter?.order ?? ''}` : `Start mission ${next.id}`}</span>
                  <span className="max-w-[240px] truncate text-[16px] font-bold">
                    {next.id} · {next.title}
                  </span>
                </span>
                <ArrowRight size={18} className="ml-1 transition-transform group-hover:translate-x-1" />
              </button>
            ) : mastered ? (
              <button
                type="button"
                onClick={() => go(routes.sandbox())}
                className="flex h-14 cursor-pointer items-center gap-3 rounded-xl bg-safety pr-5 pl-4 text-left text-black shadow-[0_10px_30px_-8px_rgba(245,196,0,0.6)] transition-all hover:-translate-y-0.5 hover:bg-yellow-300 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/10">
                  <Trophy size={18} />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold tracking-wide text-black/65 uppercase">Campaign mastered · every ★★★</span>
                  <span className="text-[16px] font-bold">Build freely in the Sandbox</span>
                </span>
                <ArrowRight size={18} className="ml-1" />
              </button>
            ) : done ? (
              <button
                type="button"
                onClick={() => go(routes.campaign)}
                className="flex h-14 cursor-pointer items-center gap-3 rounded-xl bg-safety pr-5 pl-4 text-left text-black shadow-[0_10px_30px_-8px_rgba(245,196,0,0.6)] transition-all hover:-translate-y-0.5 hover:bg-yellow-300 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/10">
                  <RotateCcw size={18} />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-semibold tracking-wide text-black/65 uppercase">Campaign complete</span>
                  <span className="text-[16px] font-bold">
                    Go for ★★★ · {summary.maxStars - summary.stars} {summary.maxStars - summary.stars === 1 ? 'star' : 'stars'} left
                  </span>
                </span>
                <ArrowRight size={18} className="ml-1" />
              </button>
            ) : null}
            {mastered ? (
              <button
                type="button"
                onClick={() => go(routes.showroom())}
                className="flex h-14 cursor-pointer items-center gap-2.5 rounded-xl border border-white/12 bg-white/[0.04] px-5 text-[15px] font-semibold text-slate-100 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
              >
                <Box size={18} className="text-sky-300" /> Visit the Showroom
              </button>
            ) : (
              <button
                type="button"
                onClick={() => go(routes.sandbox())}
                className="flex h-14 cursor-pointer items-center gap-2.5 rounded-xl border border-white/12 bg-white/[0.04] px-5 text-[15px] font-semibold text-slate-100 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none"
              >
                <FlaskConical size={18} className="text-sky-300" /> Open Sandbox
              </button>
            )}
          </div>
          <Link href={routes.campaign} className="pw-fade-up mt-4 inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-slate-400 hover:text-white" style={{ animationDelay: '220ms' }}>
            <MapIcon size={14} /> View the campaign map <ArrowRight size={13} />
          </Link>

          <div className="pw-fade-up mt-9 flex flex-wrap gap-1.5" style={{ animationDelay: '260ms' }}>
            {['ControlLogix 1756', 'CompactLogix 5380', 'PowerFlex 525', 'PanelView 5310', '800F', '855T'].map((t) => (
              <span key={t} className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-slate-400">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
