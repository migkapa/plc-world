/**
 * Campaign map (/campaign): seven chapter regions on a winding road; clicking a node opens the mission card
 * (docked on wide screens, a drawer / bottom sheet otherwise).
 */
import { Map as MapIcon, Play, Star, Trophy } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import { getMission } from '../../game/missions';
import { useGame } from '../../game/store';
import type { MissionDef } from '../../game/types';
import { Button, cn, useFocusTrap } from '../../ui';
import { CampaignMap } from '../campaign/CampaignMap';
import { useCampaignFocus } from '../campaign/focus';
import { MissionCard } from '../campaign/MissionCard';
import { campaignComplete, nextPlayableMission } from '../campaign/progress';
import { fmt, usePlayerSummary } from '../hud/player';
import { useReducedMotion } from '../hud/prefs';

function useIsDocked(): boolean {
  const q = '(min-width: 1280px)';
  const [docked, setDocked] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setDocked(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return docked;
}

export default function CampaignPage() {
  const profile = useGame((s) => s.profile);
  const summary = usePlayerSummary();
  const reduced = useReducedMotion();
  const docked = useIsDocked();

  const current = useMemo(() => nextPlayableMission(profile), [profile]);
  const done = campaignComplete(profile);

  const [selectedId, setSelectedId] = useState<string | undefined>(() => useCampaignFocus.getState().missionId ?? current?.id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selected: MissionDef | undefined = (selectedId && getMission(selectedId)) || current || getMission('1-1');
  const drawerMode = !docked && drawerOpen && !!selected;

  // Drawer / sheet focus: move into the dialog, keep Tab inside, and on close go back to the opener —
  // or to the node of the mission now shown if the player paged through missions with the arrows.
  const drawerRef = useRef<HTMLDivElement>(null);
  const openedWith = useRef<string | undefined>(undefined);
  const shownId = useRef<string | undefined>(undefined);
  shownId.current = selected?.id;
  useFocusTrap(drawerRef, drawerMode, {
    returnFocus: () => (shownId.current && shownId.current !== openedWith.current ? document.getElementById(`mission-node-${shownId.current}`) : null),
  });
  const openDrawer = useCallback((id: string) => {
    openedWith.current = id;
    setSelectedId(id);
    setDrawerOpen(true);
  }, []);

  // Docked card: replay the slide-in when the mission changes (without remounting, so focus stays put).
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!docked || reduced) return;
    asideRef.current?.animate(
      [
        { transform: 'translateX(24px)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 260, easing: 'ease-out' },
    );
  }, [selected?.id, docked, reduced]);

  const scrollToNode = useCallback(
    (id: string, smooth: boolean) => {
      const el = document.getElementById(`mission-node-${id}`);
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: smooth && !reduced ? 'smooth' : 'auto' });
    },
    [reduced],
  );

  // Initial scroll: focused chapter / mission (from Home) or the next mission.
  useEffect(() => {
    const { missionId, chapterId, clear } = useCampaignFocus.getState();
    const t = window.setTimeout(() => {
      if (chapterId) document.getElementById(`chapter-${chapterId}`)?.scrollIntoView({ block: 'start', behavior: 'auto' });
      else if (missionId ?? current?.id) scrollToNode((missionId ?? current?.id)!, false);
      clear();
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSelect = useCallback(
    (m: MissionDef) => {
      sfx.play('click');
      openDrawer(m.id);
    },
    [openDrawer],
  );

  const onCardSelect = useCallback(
    (m: MissionDef) => {
      setSelectedId(m.id);
      scrollToNode(m.id, true);
    },
    [scrollToNode],
  );

  useEffect(() => {
    if (!drawerOpen || docked) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, docked]);

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-y-auto" inert={drawerMode || undefined} style={{ background: 'radial-gradient(80% 50% at 50% 0%, rgba(224,37,43,0.08), transparent 70%), #0b0f14' }}>
        {/* page header */}
        <header className="mx-auto flex w-full max-w-[1120px] flex-wrap items-end gap-x-6 gap-y-4 px-4 pt-6 pb-5 sm:px-6 sm:pt-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.2em] text-ab-red uppercase">
              <MapIcon size={13} /> Campaign
            </div>
            <h1 className="mt-1.5 text-[28px] leading-tight font-bold tracking-tight text-white sm:text-[34px]">Riverside Manufacturing</h1>
            <p className="mt-1 max-w-xl text-[14px] text-slate-400">
              Your first job as the new controls tech. Work your way from a single pilot lamp to fixing the night shift’s broken programs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-4 rounded-xl border border-edge bg-panel-2/80 px-4 py-2.5">
              <div>
                <div className="text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">Missions</div>
                <div className="font-mono text-[17px] font-bold text-white">
                  {summary.missionsDone}
                  <span className="text-[13px] text-slate-400">/{summary.missionsTotal}</span>
                </div>
              </div>
              <div className="h-8 w-px bg-edge" />
              <div>
                <div className="text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">Stars</div>
                <div className="flex items-center gap-1 font-mono text-[17px] font-bold text-yellow-100">
                  <Star size={14} className="fill-yellow-400 text-yellow-400" />
                  {summary.stars}
                  <span className="text-[13px] text-slate-400">/{summary.maxStars}</span>
                </div>
              </div>
              <div className="h-8 w-px bg-edge" />
              <div>
                <div className="text-[10.5px] font-semibold tracking-wider text-slate-400 uppercase">XP</div>
                <div className="font-mono text-[17px] font-bold text-white">{fmt(summary.xp)}</div>
              </div>
            </div>
            {current ? (
              <Button
                variant="primary"
                size="lg"
                icon={<Play size={17} className="fill-current" />}
                onClick={() => {
                  openDrawer(current.id);
                  scrollToNode(current.id, true);
                }}
              >
                <span className="hidden sm:inline">Next:</span> {current.id}
              </Button>
            ) : done ? (
              <span className="flex h-12 items-center gap-2 rounded-xl border border-safety/40 bg-safety/10 px-4 text-sm font-semibold text-safety">
                <Trophy size={17} /> Campaign complete
              </span>
            ) : null}
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1120px] px-3 pb-24 sm:px-6">
          <CampaignMap
            profile={profile}
            selectedId={selected?.id}
            currentId={current?.id}
            reducedMotion={reduced}
            docked={docked}
            drawerOpen={drawerMode}
            onSelect={onSelect}
          />
        </div>
      </div>

      {/* docked mission card */}
      {docked && selected && (
        <aside ref={asideRef} id="mission-card" aria-labelledby="mission-card-title" className="w-[400px] shrink-0 border-l border-edge bg-panel-2">
          <MissionCard mission={selected} profile={profile} onSelect={onCardSelect} titleId="mission-card-title" />
        </aside>
      )}

      {/* drawer / bottom sheet */}
      {drawerMode && selected && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-end bg-black/50 backdrop-blur-[2px] md:items-stretch"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault(); // keep focus where it is so it can return to the opener
            setDrawerOpen(false);
          }}
        >
          <div
            ref={drawerRef}
            id="mission-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mission-card-title"
            className={cn(
              'flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl border border-edge bg-panel-2 shadow-2xl md:mt-12 md:max-h-none md:w-[420px] md:rounded-none md:rounded-l-2xl',
            )}
            style={{ animation: reduced ? undefined : 'pw-sheet-in 240ms ease-out' }}
          >
            <MissionCard mission={selected} profile={profile} onSelect={onCardSelect} onClose={() => setDrawerOpen(false)} titleId="mission-card-title" />
          </div>
        </div>
      )}
    </div>
  );
}
