/**
 * Workspace layout. Desktop (≥ 1024 px): resizable panels — left dock | center (3D twin over the
 * ladder) | right dock. The first layout depends on the window height (short laptop screens give the
 * ladder most of the center column); once the player drags a separator, that layout is remembered
 * (localStorage). Smaller screens: one panel at a time behind a tab strip (Twin / Ladder / Brief / Tests).
 *
 * Editing layout (desktop): the twin can shrink into a picture-in-picture over a corner of the ladder (still live;
 * click it to restore, drag it to another corner, resize it from its inner corner) so the ladder gets the whole center
 * column — toggled from the twin toolbar (TwinLayout.tsx), or automatically after the ladder has had the keyboard
 * focus for 2 s when the player enabled "Auto" (and back to the split view when they leave the ladder). The choice is
 * remembered (layoutPrefs.ts). The twin element is never remounted: the same node becomes a fixed-position panel.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type PanelSize } from 'react-resizable-panels';
import { cn, Tabs, type TabDef } from '../../ui';
import { useReducedMotion } from '../hud/prefs';
import { useMediaQuery } from './hooks';
import { AUTO_PIP_DELAY_MS, clampPipWidth, onSplitViewRequest, pipOf, useLayoutPrefs, type PipCorner } from './layoutPrefs';
import { PipChrome, TwinLayoutContext, type TwinLayoutApi } from './TwinLayout';

export interface WorkspaceLayoutProps {
  /** Layout persistence id (e.g. 'mission', 'sandbox'). */
  id: string;
  left: ReactNode;
  twin: ReactNode;
  ladder: ReactNode;
  right?: ReactNode;
  /** Small screens: the tabs and what each shows. */
  mobileTabs: TabDef<string>[];
  renderMobile(tab: string): ReactNode;
  mobileTab?: string;
  onMobileTab?(tab: string): void;
  /** The page needs the 3D twin at full size right now (e.g. a test replay): a picture-in-picture steps aside meanwhile. */
  twinWanted?: boolean;
  className?: string;
}

function storage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const ls = globalThis.localStorage;
    if (ls) return ls;
  } catch {
    // ignore
  }
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** Grip dots in the middle of a separator: shows the split can be dragged (QA: nothing told beginners it exists). */
function Grip({ vertical }: { vertical?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-slate-500/70 bg-panel-3 shadow-[0_1px_4px_rgba(0,0,0,0.5)] group-data-[separator=active]:border-sky-400/80 group-data-[separator=hover]:border-sky-400/70',
        vertical ? 'h-9 w-3 flex-col gap-[3px]' : 'h-3 w-14 gap-[4px]',
      )}
    >
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="h-[3px] w-[3px] rounded-full bg-slate-300 group-data-[separator=hover]:bg-sky-300" />
      ))}
    </span>
  );
}

function HSeparator() {
  return (
    <Separator className="group relative w-1.5 shrink-0 bg-panel outline-none data-[separator=active]:bg-sky-500/40 data-[separator=hover]:bg-sky-500/25" title="Drag to resize the panels">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge group-data-[separator=hover]:bg-sky-400/60" />
      <Grip vertical />
    </Separator>
  );
}

function VSeparator({ pip }: { pip: boolean }) {
  return (
    <Separator
      className="group relative h-2.5 shrink-0 bg-panel outline-none focus-visible:bg-sky-500/30 data-[separator=active]:bg-sky-500/40 data-[separator=hover]:bg-sky-500/25"
      title={
        pip
          ? 'Drag down to bring the 3D view back above the ladder'
          : 'Drag to give the ladder or the 3D view more room (remembered; double-click resets)'
      }
      aria-label="Resize the 3D view and the ladder"
      data-testid="twin-ladder-splitter"
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-edge group-data-[separator=hover]:bg-sky-400/60" />
      <Grip />
    </Separator>
  );
}

/**
 * Share of the center column given to the 3D twin before the player resizes it (the rest is the ladder). Laptop
 * heights (< 1000 px) favour the ladder: multi-rung missions otherwise need constant scrolling.
 */
export function defaultTwinShare(viewportHeight: number): number {
  if (viewportHeight < 1000) return 38;
  if (viewportHeight < 1150) return 43;
  return 48;
}

interface Area {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Margin of the picture-in-picture inside the ladder area (px); the right side also clears the ladder's scrollbar. */
const PIP_MARGIN = 10;
const PIP_SCROLLBAR = 12;
/** Picture-in-picture aspect (height / width). */
const PIP_ASPECT = 0.62;

/** Fixed-position rectangle of the picture-in-picture for a corner of `area` (viewport px). */
export function pipRect(area: Area, corner: PipCorner, width: number): Area {
  const w = Math.round(Math.max(160, Math.min(width, area.width - 2 * PIP_MARGIN - 80)));
  const h = Math.round(Math.max(100, Math.min(w * PIP_ASPECT, area.height - 2 * PIP_MARGIN)));
  const left = corner[1] === 'l' ? area.left + PIP_MARGIN : area.left + area.width - w - PIP_MARGIN - PIP_SCROLLBAR;
  const top = corner[0] === 't' ? area.top + PIP_MARGIN : area.top + area.height - h - PIP_MARGIN;
  return { left, top: Math.max(area.top, top), width: w, height: h };
}

/**
 * Where the ladder's floating "Edits applied online" chip goes (CSS vars read by LadderPanel; default: bottom right) so a
 * PiP in the bottom-right corner never covers it — this chip is how a beginner sees an edit went live. Left of the PiP
 * when the row has room for it, else above the PiP.
 */
export function pipChipVars(rect: Area | null, corner: PipCorner, area: Area | null): Record<string, string> {
  if (!rect || !area || corner !== 'br') return {};
  const fromRight = area.left + area.width - rect.left; // PiP width + its right margin + the scrollbar gap
  if (area.width - fromRight >= 190) return { '--pip-chip-right': `${Math.round(fromRight + 10)}px` };
  return { '--pip-chip-bottom': `calc(2.25rem + ${Math.round(rect.height + PIP_MARGIN)}px)` };
}

/** The rung area of the ladder (where the picture-in-picture floats): the editor's scroller, else the whole column. */
function measureArea(center: HTMLElement | null, ladder: HTMLElement | null): Area | null {
  const c = center?.getBoundingClientRect();
  if (!c || c.width < 1 || c.height < 1) return null;
  const s = ladder?.querySelector('.ld-scroll')?.getBoundingClientRect();
  const top = s && s.height > 120 ? Math.max(c.top, s.top) : c.top;
  const bottom = s && s.height > 120 ? Math.min(c.bottom, s.bottom) : c.bottom;
  return { left: c.left, top, width: c.width, height: Math.max(0, bottom - top) };
}

function DesktopLayout({ id, left, twin, ladder, right, twinWanted = false }: Pick<WorkspaceLayoutProps, 'id' | 'left' | 'twin' | 'ladder' | 'right' | 'twinWanted'>) {
  const store = storage();
  const hIds = right ? ['left', 'center', 'right'] : ['left', 'center'];
  // v2 keys: only layouts the player made by dragging are stored (v1 also stored the mount layout)
  const h = useDefaultLayout({ id: `plcw-${id}-v2-h${right ? '3' : '2'}`, panelIds: hIds, storage: store, onlySaveAfterUserInteractions: true });
  const v = useDefaultLayout({ id: `plcw-${id}-v2-v`, panelIds: ['twin', 'ladder'], storage: store, onlySaveAfterUserInteractions: true });
  const [twinShare] = useState(() => defaultTwinShare(typeof window !== 'undefined' ? window.innerHeight : 1000));

  // --- picture-in-picture ------------------------------------------------------------------------
  // the PiP choice is per page (a sandbox must not open with its operator pad hidden by a mission's choice)
  const manualPip = useLayoutPrefs((s) => pipOf(s, id).twinPip);
  const autoPip = useLayoutPrefs((s) => pipOf(s, id).autoPip);
  const corner = useLayoutPrefs((s) => s.pipCorner);
  const savedWidth = useLayoutPrefs((s) => s.pipWidth);
  const [autoActive, setAutoActive] = useState(false);
  const pip = !twinWanted && (manualPip || autoActive);
  const reduced = useReducedMotion();
  const twinPanel = usePanelRef();
  const centerRef = useRef<HTMLDivElement>(null);
  const ladderRef = useRef<HTMLDivElement>(null);
  const pipRef = useRef(pip);
  pipRef.current = pip;
  const autoRef = useRef(autoPip);
  autoRef.current = autoPip;
  const wantedRef = useRef(twinWanted);
  wantedRef.current = twinWanted;
  /** The player left an automatic PiP while still in the ladder: no new automatic PiP until the focus comes back. */
  const suppressed = useRef(false);
  const autoTimer = useRef<number | undefined>(undefined);

  // a replay (twinWanted) or switching auto off ends an automatic PiP
  useEffect(() => {
    if (twinWanted || !autoPip) setAutoActive(false);
  }, [twinWanted, autoPip]);
  useEffect(() => () => window.clearTimeout(autoTimer.current), []);

  // collapse the twin panel while it is the picture-in-picture, bring it back after
  const shownPip = useRef(false);
  /** Twin share (%) before the picture-in-picture, restored after it (none when the page opened in PiP). */
  const splitShare = useRef<number | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    let tries = 0;
    const apply = (): void => {
      const p = twinPanel.current;
      if (p) {
        if (pip) {
          if (!p.isCollapsed()) {
            const pct = p.getSize().asPercentage;
            if (pct > 5) splitShare.current = pct;
            p.collapse();
          }
        } else if (shownPip.current && p.isCollapsed()) {
          p.expand();
          // back to the split the player had (or the remembered / default one when the page opened in PiP)
          const want = splitShare.current ?? v.defaultLayout?.twin ?? twinShare;
          if (Math.abs(p.getSize().asPercentage - want) > 1) p.resize(`${want}%`);
        }
      }
      // right after mount the group may not have a layout yet: try again on the next frames
      const done = p && (pip ? p.isCollapsed() : true);
      if (!done && ++tries < 20) raf = requestAnimationFrame(apply);
      else shownPip.current = pip;
    };
    apply();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the remembered split is read when the PiP ends
  }, [pip, twinPanel]);

  const leavePip = useCallback(() => {
    suppressed.current = true;
    setAutoActive(false);
    useLayoutPrefs.getState().setTwinPip(false, id);
  }, [id]);
  // someone on the page needs the full twin (e.g. a "Try it now" tip pointing at the operator pad)
  useEffect(() => onSplitViewRequest(() => pipRef.current && leavePip()), [leavePip]);
  // dragging the splitter down while in PiP brings the split view back
  const onTwinResize = useCallback(
    (size: PanelSize, _id: string | number | undefined, prev: PanelSize | undefined) => {
      if (prev && pipRef.current && shownPip.current && size.inPixels > 24 && prev.inPixels <= 24) leavePip();
    },
    [leavePip],
  );

  const api = useMemo<TwinLayoutApi>(
    () => ({
      pip,
      manualPip,
      autoPip,
      setPip: (on) => {
        if (!on) suppressed.current = true;
        setAutoActive(false);
        useLayoutPrefs.getState().setTwinPip(on, id);
      },
      setAutoPip: (on) => useLayoutPrefs.getState().setAutoPip(on, id),
    }),
    [pip, manualPip, autoPip, id],
  );

  // auto: PiP after AUTO_PIP_DELAY_MS of keyboard focus inside the ladder
  const onLadderFocus = (e: FocusEvent<HTMLDivElement>): void => {
    const el = ladderRef.current;
    const from = e.relatedTarget as Node | null;
    if (!el || !el.contains(e.target as Node)) return; // focus inside a portal (dialog) opened from the ladder
    if (!from || !el.contains(from)) suppressed.current = false;
    if (!autoRef.current || pipRef.current || suppressed.current || autoTimer.current !== undefined) return;
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = undefined;
      const now = ladderRef.current;
      if (!now || !now.contains(document.activeElement) || !autoRef.current || wantedRef.current || suppressed.current) return;
      setAutoActive(true);
    }, AUTO_PIP_DELAY_MS);
  };
  const onLadderBlur = (e: FocusEvent<HTMLDivElement>): void => {
    const to = e.relatedTarget as Node | null;
    if (to && ladderRef.current?.contains(to)) return;
    window.clearTimeout(autoTimer.current);
    autoTimer.current = undefined;
  };
  // while an automatic PiP is up: leaving the ladder (click or focus elsewhere, not a dialog it opened) restores the split
  useEffect(() => {
    if (!autoActive) return;
    const outside = (t: EventTarget | null): boolean => {
      const n = t instanceof Node ? t : null;
      if (!n || ladderRef.current?.contains(n)) return false;
      if (n instanceof Element && n.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-twin-pip]')) return false;
      return true;
    };
    const onFocusIn = (e: Event): void => {
      if (outside(e.target)) setAutoActive(false);
    };
    const onDown = (e: Event): void => {
      if (outside(e.target)) setAutoActive(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [autoActive]);

  // where the picture-in-picture floats: the ladder's rung area (re-measured on resize)
  const [area, setArea] = useState<Area | null>(null);
  useLayoutEffect(() => {
    if (!pip) return;
    const measure = (): void => {
      const a = measureArea(centerRef.current, ladderRef.current);
      setArea((prev) => (a && prev && Math.abs(a.left - prev.left) < 0.5 && Math.abs(a.top - prev.top) < 0.5 && Math.abs(a.width - prev.width) < 0.5 && Math.abs(a.height - prev.height) < 0.5 ? prev : a));
    };
    measure();
    // the ladder grows once the twin panel has collapsed: measure again after the layout settled
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (centerRef.current) ro?.observe(centerRef.current);
    if (ladderRef.current) ro?.observe(ladderRef.current);
    const scroller = ladderRef.current?.querySelector('.ld-scroll');
    if (scroller) ro?.observe(scroller);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [pip]);
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
  const [settled, setSettled] = useState(false);
  const shown = pip && area !== null;
  useEffect(() => {
    if (!shown) {
      setSettled(false);
      return;
    }
    const raf = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(raf);
  }, [shown]);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const width = liveWidth ?? savedWidth;
  const rect = pip && area ? pipRect(area, corner, width) : null;
  const onPipWidth = useCallback((w: number, commit: boolean) => {
    if (commit) {
      setLiveWidth(null);
      useLayoutPrefs.getState().setPipWidth(clampPipWidth(w));
    } else setLiveWidth(clampPipWidth(w));
  }, []);

  // one element in both layouts (the twin inside is never remounted): in the panel, or the fixed picture-in-picture
  // (the first frame of a PiP, before the ladder area is measured, keeps the twin in place)
  const twinBox = (
    <div
      className={
        rect
          ? 'fixed z-30 overflow-hidden rounded-xl border border-white/15 bg-[#0d1117] shadow-[0_14px_40px_rgba(0,0,0,0.65)] ring-1 ring-black/60'
          : 'h-full min-h-0 overflow-hidden'
      }
      style={
        rect
          ? {
              left: dragPos?.left ?? rect.left,
              top: dragPos?.top ?? rect.top,
              width: rect.width,
              height: rect.height,
              // glide to a new corner (not on the first frame: the node was just the split panel)
              transition: !settled || dragPos || liveWidth !== null || reduced ? 'none' : 'left 180ms ease-out, top 180ms ease-out',
            }
          : undefined
      }
      data-twin-pip={rect ? corner : undefined}
    >
      {twin}
      {rect && area && (
        <PipChrome
          corner={corner}
          width={width}
          area={area}
          auto={autoActive && !manualPip}
          onMove={setDragPos}
          onCorner={(c) => useLayoutPrefs.getState().setPipCorner(c)}
          onWidth={onPipWidth}
          onRestore={leavePip}
        />
      )}
    </div>
  );

  return (
    <TwinLayoutContext.Provider value={api}>
      <Group orientation="horizontal" className="h-full min-h-0 w-full" defaultLayout={h.defaultLayout} onLayoutChanged={h.onLayoutChanged}>
        <Panel id="left" defaultSize={right ? '23%' : '26%'} minSize={220} collapsible collapsedSize={0} className="min-w-0">
          <div className="h-full min-h-0 overflow-hidden">{left}</div>
        </Panel>
        <HSeparator />
        <Panel id="center" defaultSize={right ? '53%' : '74%'} minSize={360} className="min-w-0">
          <div ref={centerRef} className="h-full min-h-0">
            <Group orientation="vertical" className="h-full min-h-0" defaultLayout={v.defaultLayout} onLayoutChanged={v.onLayoutChanged}>
              <Panel id="twin" panelRef={twinPanel} defaultSize={`${twinShare}%`} minSize={120} collapsible collapsedSize={0} onResize={onTwinResize}>
                {twinBox}
              </Panel>
              <VSeparator pip={pip} />
              <Panel id="ladder" defaultSize={`${100 - twinShare}%`} minSize={160}>
                <div
                  ref={ladderRef}
                  // a PiP in a bottom corner: room to scroll the last rungs above it
                  className="h-full min-h-0 overflow-hidden [&_.ld-scroll]:pb-(--pip-pad)"
                  style={{ '--pip-pad': rect && corner[0] === 'b' ? `${rect.height + 2 * PIP_MARGIN}px` : '0px', ...pipChipVars(rect, corner, area) } as CSSProperties}
                  onFocus={onLadderFocus}
                  onBlur={onLadderBlur}
                  data-pip-area=""
                >
                  {ladder}
                </div>
              </Panel>
            </Group>
          </div>
        </Panel>
        {right && (
          <>
            <HSeparator />
            <Panel id="right" defaultSize="24%" minSize={240} collapsible collapsedSize={0} className="min-w-0">
              <div className="h-full min-h-0 overflow-hidden">{right}</div>
            </Panel>
          </>
        )}
      </Group>
    </TwinLayoutContext.Provider>
  );
}

export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [tabState, setTabState] = useState(props.mobileTabs[0]?.id ?? 'twin');
  const tab = props.mobileTab ?? tabState;
  const setTab = (t: string): void => {
    setTabState(t);
    props.onMobileTab?.(t);
  };
  if (desktop) {
    return (
      <div className={cn('h-full min-h-0', props.className)}>
        <DesktopLayout
          id={props.id}
          left={props.left}
          twin={props.twin}
          ladder={props.ladder}
          {...(props.right ? { right: props.right } : {})}
          {...(props.twinWanted ? { twinWanted: true } : {})}
        />
      </div>
    );
  }
  return (
    <div className={cn('flex h-full min-h-0 flex-col', props.className)}>
      <Tabs tabs={props.mobileTabs} value={tab} onChange={setTab} className="shrink-0 bg-panel" />
      <div className="relative min-h-0 flex-1">{props.renderMobile(tab)}</div>
    </div>
  );
}
