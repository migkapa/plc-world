/** Home: horizontal chapter carousel with progress; a card opens the campaign map at that chapter. */
import { ChevronLeft, ChevronRight, Crown, Lock, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { sfx } from '../../audio/sfx';
import { CHAPTERS } from '../../game/chapters';
import { chapterBoss, missionsByChapter } from '../../game/missions';
import { chapterProgress, useGame } from '../../game/store';
import { cn, IconButton } from '../../ui';
import { ChapterHex } from '../campaign/ChapterBanner';
import { useCampaignFocus } from '../campaign/focus';
import { chapterUnlock } from '../campaign/progress';
import { mix } from '../hud/RankInsignia';
import { routes } from '../routes';

export function ChapterCarousel() {
  const profile = useGame((s) => s.profile);
  const [, navigate] = useLocation();
  const focusChapter = useCampaignFocus((s) => s.focusChapter);
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: true });

  const update = () => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(300, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  // Start scrolled to the first chapter that isn't finished.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const idx = CHAPTERS.findIndex((c) => chapterProgress(profile, c.id).share < 1);
    const card = el.children[Math.max(0, idx)] as HTMLElement | undefined;
    if (card && idx > 0) el.scrollLeft = card.offsetLeft - parseFloat(getComputedStyle(el).paddingLeft || '16');
    update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] font-bold tracking-[0.2em] text-ab-red uppercase">The campaign</div>
          <h2 className="mt-1 text-[24px] font-bold tracking-tight text-white sm:text-[28px]">Seven chapters, one plant</h2>
        </div>
        <div className="hidden gap-1.5 sm:flex">
          <IconButton label="Scroll left" variant="secondary" size="md" disabled={!edges.left} onClick={() => scrollBy(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Scroll right" variant="secondary" size="md" disabled={!edges.right} onClick={() => scrollBy(1)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
      </div>

      <div ref={scroller} onScroll={update} className="pw-no-scrollbar -mx-4 flex scroll-px-4 snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pt-1 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6">
        {CHAPTERS.map((ch) => {
          const pr = chapterProgress(profile, ch.id);
          const un = chapterUnlock(profile, ch.id);
          const locked = !un.unlocked;
          const boss = chapterBoss(ch.id);
          const count = missionsByChapter(ch.id).length;
          const c = ch.color;
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => {
                sfx.play('click');
                focusChapter(ch.id);
                navigate(routes.campaign);
              }}
              className={cn(
                'group relative flex w-[286px] shrink-0 cursor-pointer snap-start flex-col overflow-hidden rounded-2xl border text-left transition-all duration-300',
                'hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none',
                locked ? 'border-slate-800 bg-panel/80' : 'border-edge bg-panel-2 hover:shadow-2xl',
              )}
            >
              <div
                className="relative flex h-[118px] items-end justify-between overflow-hidden p-4"
                style={{
                  background: locked
                    ? 'repeating-linear-gradient(135deg, rgba(148,163,184,0.05) 0 12px, transparent 12px 24px), #0f1419'
                    : `radial-gradient(120% 120% at 100% 0%, ${c}55, transparent 60%), linear-gradient(160deg, ${mix(c, '#0b0f14', 0.72)}, #10161d)`,
                }}
              >
                <span
                  className="pointer-events-none absolute -top-3 right-2 font-black leading-none tracking-tighter select-none"
                  style={{ fontSize: 110, color: locked ? 'rgba(148,163,184,0.06)' : `${mix(c, '#ffffff', 0.2)}26` }}
                >
                  {ch.order}
                </span>
                <ChapterHex chapter={ch} size={46} locked={locked} />
                <span className="font-mono text-[10.5px] font-bold tracking-[0.18em] uppercase" style={{ color: locked ? '#64748b' : mix(c, '#ffffff', 0.35) }}>
                  Chapter {ch.order}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className={cn('text-[18px] font-bold tracking-tight', locked ? 'text-slate-400' : 'text-white')}>{ch.title}</h3>
                <p className="mt-0.5 text-[12.5px] font-medium" style={{ color: locked ? '#64748b' : mix(c, '#ffffff', 0.3) }}>
                  {ch.subtitle}
                </p>
                <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-slate-400">{ch.description}</p>
                <div className="mt-auto pt-4">
                  {locked ? (
                    <div className="flex items-start gap-1.5 text-[11.5px] leading-snug text-slate-400">
                      <Lock size={12} className="mt-0.5 shrink-0 text-safety/80" />
                      <span className="line-clamp-2">{un.hint}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-[11.5px]">
                        <span className="text-slate-400">
                          <span className="font-mono font-semibold text-white">{pr.completed}</span>/{count} missions
                        </span>
                        <span className="flex items-center gap-2">
                          {pr.bossCompleted && boss && <Crown size={13} className="text-yellow-300" />}
                          <span className="flex items-center gap-1 font-mono text-yellow-200">
                            <Star size={11} className="fill-yellow-400 text-yellow-400" />
                            {pr.stars}/{pr.maxStars}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full" style={{ width: `${pr.percent}%`, background: c, boxShadow: `0 0 8px ${c}` }} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {/* edge fades */}
      <div className={cn('pointer-events-none absolute top-[56px] bottom-4 -left-4 w-10 bg-gradient-to-r from-[#0b0f14] to-transparent transition-opacity sm:-left-6', edges.left ? 'opacity-100' : 'opacity-0')} />
      <div className={cn('pointer-events-none absolute top-[56px] -right-4 bottom-4 w-10 bg-gradient-to-l from-[#0b0f14] to-transparent transition-opacity sm:-right-6', edges.right ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}
