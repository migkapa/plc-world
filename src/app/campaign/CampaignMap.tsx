/**
 * <CampaignMap/> — the winding road through the seven chapters (SVG road + HTML nodes & banners).
 */
import { Flag, Trophy } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHAPTERS, getChapter } from '../../game/chapters';
import { getMission, missionsByChapter } from '../../game/missions';
import { chapterProgress } from '../../game/store';
import type { MissionDef, PlayerProfile } from '../../game/types';
import { cn } from '../../ui';
import { ChapterBanner } from './ChapterBanner';
import { computeMapLayout, type MapLayout, type MapSegment } from './layout';
import { MissionNodeButton } from './MissionNode';
import { chapterUnlock, missionState, type MissionState } from './progress';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

type SegState = 'done' | 'active' | 'locked';

function segmentState(seg: MapSegment, states: Record<string, MissionState>): SegState {
  const from = seg.from ? states[seg.from] : 'completed';
  const to = seg.to ? states[seg.to] : undefined;
  if (seg.kind === 'finish') return from === 'completed' ? 'done' : 'locked';
  if (from === 'completed' && to === 'completed') return 'done';
  if (from === 'completed' && to === 'available') return 'active';
  return 'locked';
}

export interface CampaignMapProps {
  profile: PlayerProfile;
  selectedId?: string;
  currentId?: string;
  reducedMotion: boolean;
  /** Mission card docked beside the map (true) or opened as a dialog drawer (false). */
  docked: boolean;
  /** The drawer dialog is showing the selected mission. */
  drawerOpen: boolean;
  onSelect(m: MissionDef): void;
}

export function CampaignMap({ profile, selectedId, currentId, reducedMotion, docked, drawerOpen, onSelect }: CampaignMapProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const layout: MapLayout | null = useMemo(() => (width > 0 ? computeMapLayout(width, CHAPTERS, missionsByChapter) : null), [width]);

  const states = useMemo(() => {
    const out: Record<string, MissionState> = {};
    for (const ch of CHAPTERS) for (const m of missionsByChapter(ch.id)) out[m.id] = missionState(profile, m);
    return out;
  }, [profile]);

  const chapterInfo = useMemo(
    () => Object.fromEntries(CHAPTERS.map((ch) => [ch.id, { progress: chapterProgress(profile, ch.id), unlock: chapterUnlock(profile, ch.id) }])),
    [profile],
  );

  const colorOf = (missionId?: string): string => {
    const m = missionId ? getMission(missionId) : undefined;
    return (m && getChapter(m.chapter)?.color) ?? '#e0252b';
  };

  const allDone = Object.values(states).every((s) => s === 'completed');

  return (
    <div ref={ref} className="relative w-full" style={{ height: layout?.height ?? 1200 }}>
      {layout && (
        <>
          {/* region backdrops */}
          {layout.regions.map((reg) => {
            const locked = !chapterInfo[reg.chapter.id]!.unlock.unlocked;
            const c = reg.chapter.color;
            return (
              <div
                key={reg.chapter.id}
                className={cn('absolute inset-x-0 overflow-hidden rounded-[28px] border', locked ? 'border-slate-800/80' : 'border-white/[0.06]')}
                style={{
                  top: reg.top,
                  height: reg.height,
                  background: locked
                    ? 'repeating-linear-gradient(135deg, rgba(148,163,184,0.035) 0 14px, transparent 14px 28px), linear-gradient(180deg, #0d1217, #0b0f14)'
                    : `radial-gradient(120% 90% at ${reg.index % 2 === 0 ? '15%' : '85%'} 30%, ${c}1c, transparent 60%), linear-gradient(180deg, #0f151c, #0c1116)`,
                }}
              >
                {/* blueprint grid */}
                <div
                  className="absolute inset-0 opacity-[0.35]"
                  style={{
                    backgroundImage: 'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
                    backgroundSize: '32px 32px',
                    maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 85%)',
                  }}
                />
                {/* giant chapter number watermark */}
                <span
                  className="pointer-events-none absolute bottom-[-0.18em] font-black leading-none tracking-tighter select-none"
                  style={{
                    fontSize: layout.mode === 'wide' ? 190 : 150,
                    color: locked ? 'rgba(148,163,184,0.03)' : `${c}0f`,
                    [reg.index % 2 === 0 ? 'right' : 'left']: 24,
                  }}
                >
                  {String(reg.chapter.order).padStart(2, '0')}
                </span>
              </div>
            );
          })}

          {/* the road */}
          <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height} aria-hidden>
            <defs>
              <filter id="road-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {layout.segments.map((s, i) => (
              <path key={`o${i}`} d={s.d} fill="none" stroke="#06090c" strokeWidth={18} strokeLinecap="round" />
            ))}
            {layout.segments.map((s, i) => (
              <path key={`a${i}`} d={s.d} fill="none" stroke="#1a222b" strokeWidth={13} strokeLinecap="round" />
            ))}
            {layout.segments.map((s, i) => (
              <path key={`c${i}`} d={s.d} fill="none" stroke="#3b4756" strokeWidth={1.6} strokeDasharray="7 9" strokeLinecap="round" />
            ))}
            {layout.segments.map((s, i) => {
              const st = segmentState(s, states);
              if (st === 'locked') return null;
              const color = colorOf(s.to ?? s.from);
              return st === 'done' ? (
                <path key={`d${i}`} d={s.d} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" filter="url(#road-glow)" opacity={0.95} />
              ) : (
                // static glow under the marching dashes (drawn in their own layer below): the blur is rasterised once
                <path key={`d${i}`} d={s.d} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" filter="url(#road-glow)" opacity={0.28} />
              );
            })}
          </svg>
          {/* the open roads' marching dashes: a separate, unfiltered layer, so each animation frame repaints only them */}
          <svg className="pointer-events-none absolute inset-0 will-change-transform" width={layout.width} height={layout.height} aria-hidden>
            {layout.segments.map((s, i) =>
              segmentState(s, states) === 'active' ? (
                <path key={`m${i}`} d={s.d} fill="none" stroke={colorOf(s.to ?? s.from)} strokeWidth={4} strokeLinecap="round" strokeDasharray="10 18" className={reducedMotion ? undefined : 'pw-dash'} />
              ) : null,
            )}
          </svg>

          {/* chapter banners */}
          {layout.regions.map((reg) => {
            const info = chapterInfo[reg.chapter.id]!;
            return (
              <ChapterBanner
                key={reg.chapter.id}
                chapter={reg.chapter}
                progress={info.progress}
                unlock={info.unlock}
                compact={layout.mode === 'narrow'}
                style={{ left: reg.header.x, top: reg.header.y, width: reg.header.w, height: reg.header.h }}
              />
            );
          })}

          {/* start */}
          {layout.start && (
            <div className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: layout.start.x, top: layout.start.y }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ab-red bg-[#0b0f14] text-ab-red shadow-lg shadow-red-900/40">
                <Flag size={13} strokeWidth={2.6} />
              </span>
              <span className="absolute top-full mt-1 font-mono text-[9.5px] font-bold tracking-widest text-slate-400">START</span>
            </div>
          )}

          {/* mission nodes */}
          {layout.regions.flatMap((reg) =>
            reg.nodes.map((node) => (
              <MissionNodeButton
                key={node.mission.id}
                node={node}
                state={states[node.mission.id]!}
                stars={profile.missions[node.mission.id]?.stars ?? 0}
                color={reg.chapter.color}
                selected={selectedId === node.mission.id}
                current={currentId === node.mission.id}
                reducedMotion={reducedMotion}
                docked={docked}
                drawerOpen={drawerOpen}
                onSelect={onSelect}
              />
            )),
          )}

          {/* finish */}
          <div className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ left: layout.finish.x, top: layout.finish.y }}>
            <span
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-2xl border-2 shadow-xl',
                allDone ? 'border-safety bg-safety/15 text-safety shadow-yellow-900/40' : 'border-slate-700 bg-[#0f1419] text-slate-500',
              )}
            >
              <Trophy size={26} />
            </span>
            <span className={cn('mt-2 text-center text-[12px] font-semibold whitespace-nowrap', allDone ? 'text-safety' : 'text-slate-400')}>
              {allDone ? 'Campaign complete!' : 'Master of Automation'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
