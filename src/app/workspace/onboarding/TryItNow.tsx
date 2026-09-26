/**
 * "Try it now": right after an online edit applies, a small callout next to the operator control that exercises the
 * edited rung ("Flip Switch 0 to try your rung"; every input of an AND: "Flip Switch 2 and Switch 3…"), with a pulsing
 * ring around those controls. It goes away when the player has operated them, after a few seconds, on the next edit,
 * or with its close button. It waits while an operand / value box of the ladder is open (the edit is not finished).
 * When the 3D view is a picture-in-picture (no operator pad) the callout says so and offers "Show the controls" (back
 * to the split view); when the control is not on screen at all (phone on another tab) it falls back to a toast.
 */
import { MousePointerClick, PanelTopOpen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MissionDef } from '../../../game/types';
import { serializeRung } from '../../../plc/neutralText';
import type { SceneLogic } from '../../../sim/types';
import { Kbd, toast } from '../../../ui';
import type { WorkspaceRuntime } from '../useWorkspaceRuntime';
import { requestSplitView } from '../layoutPrefs';
import { isShown, padControl, placeCard, rectOf, sameRect, twinPanel, type Rect } from './dom';
import { suggestTryIt, type TryItSuggestion } from './tryIt';
import './onboarding.css';

/** Pause after the edit applied before the callout shows (the "Edits applied online" pill comes first). */
export const TRY_IT_DELAY_MS = 700;
/** How long the callout stays. */
export const TRY_IT_SHOW_MS = 9000;
/** The same control is not suggested again within this time. */
export const TRY_IT_REPEAT_MS = 30_000;
/** No suggestion for a control the player operated this recently (they are trying already). */
export const TRY_IT_RECENT_USE_MS = 6000;
/** While an operand / value box of the ladder is open the tip waits (re-checked this often, given up after the max). */
const TRY_IT_HOLD_POLL_MS = 300;
const TRY_IT_HOLD_MAX_MS = 30_000;

/**
 * The player is still typing an operand / value / rung text in the ladder (the edit that applied is not finished yet).
 * Only the editing boxes count — the hover card and the context menu share the `.ld-pop` class but hold no field.
 */
function ladderPopoverOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('.ld-pop input, .ld-pop textarea, .ld-pop select') !== null;
}

/** Rungs (neutral text) of `next` that are new compared with `prev` (edited or added). */
export function changedRungTexts(prev: ReadonlyArray<string>, next: ReadonlyArray<string>): string[] {
  const before = new Set(prev);
  return next.filter((t) => t.trim() !== '' && !before.has(t));
}

export interface TryItSetup {
  mission: MissionDef;
  scene: SceneLogic<unknown>;
  ws: Pick<WorkspaceRuntime, 'appliedAt' | 'rungs' | 'runtime'>;
  enabled: boolean;
  /** Quiet (a guided tour, a test run or a replay is on). */
  suppressed: boolean;
}

/** The suggestion to show now (null = nothing), and a way to close it. */
export function useTryItPrompt({ mission, scene, ws, enabled, suppressed }: TryItSetup): { suggestion: TryItSuggestion | null; dismiss(): void; keep(): void } {
  const [suggestion, setSuggestion] = useState<TryItSuggestion | null>(null);
  /** Bumped by keep(): restarts the time the callout stays. */
  const [epoch, setEpoch] = useState(0);
  /** Controls of the current suggestion operated since it showed (an AND needs every one of them). */
  const usedSince = useRef(new Set<string>());
  const texts = useMemo(() => ws.rungs.map((r) => serializeRung(r)), [ws.rungs]);
  const textsRef = useRef(texts);
  textsRef.current = texts;
  const applied = useRef<string[]>(texts);
  const seenAt = useRef(ws.appliedAt);
  const lastShown = useRef(new Map<string, number>());
  const lastUsed = useRef(new Map<string, number>());
  const current = useRef<TryItSuggestion | null>(null);
  current.current = suggestion;
  const gate = useRef({ enabled, suppressed });
  gate.current = { enabled, suppressed };

  const dismiss = useCallback(() => setSuggestion(null), []);
  const keep = useCallback(() => setEpoch((e) => e + 1), []);

  // operating the suggested control(s) closes the callout (and remembers recent use)
  const { runtime } = ws;
  useEffect(
    () =>
      runtime.onControl((id) => {
        lastUsed.current.set(id, performance.now());
        const cur = current.current;
        if (!cur || !cur.controlIds.includes(id)) return;
        usedSince.current.add(id);
        if (cur.controlIds.every((c) => usedSince.current.has(c))) setSuggestion(null);
      }),
    [runtime],
  );

  // after each accepted online edit
  useEffect(() => {
    if (ws.appliedAt === seenAt.current) return;
    seenAt.current = ws.appliedAt;
    const prev = applied.current;
    const next = textsRef.current;
    applied.current = next;
    setSuggestion(null);
    if (!gate.current.enabled || gate.current.suppressed) return;
    const edited = changedRungTexts(prev, next);
    const s = suggestTryIt(mission, scene, edited, (id) => runtime.getControl(id));
    if (!s) return;
    const key = s.controlIds.join('+');
    const now = performance.now();
    if (now - (lastShown.current.get(key) ?? -Infinity) < TRY_IT_REPEAT_MS) return;
    if (s.controlIds.every((id) => now - (lastUsed.current.get(id) ?? -Infinity) < TRY_IT_RECENT_USE_MS)) return;
    const since = now;
    let h = 0;
    const fire = (): void => {
      if (!gate.current.enabled || gate.current.suppressed) return;
      // the player is still in an operand / value box (e.g. a CTU's preset): wait until the edit is finished
      if (ladderPopoverOpen()) {
        if (performance.now() - since < TRY_IT_HOLD_MAX_MS) h = window.setTimeout(fire, TRY_IT_HOLD_POLL_MS);
        return;
      }
      lastShown.current.set(key, performance.now());
      usedSince.current = new Set();
      setSuggestion(s);
    };
    h = window.setTimeout(fire, TRY_IT_DELAY_MS);
    return () => window.clearTimeout(h);
  }, [ws.appliedAt, mission, scene, runtime]);

  useEffect(() => {
    if (!suggestion) return;
    const h = window.setTimeout(() => setSuggestion(null), TRY_IT_SHOW_MS);
    return () => window.clearTimeout(h);
  }, [suggestion, epoch]);

  useEffect(() => {
    if (suppressed || !enabled) setSuggestion(null);
  }, [suppressed, enabled]);

  return { suggestion, dismiss, keep };
}

/** The picture-in-picture 3D view the twin panel lives in right now, if any (it shows no operator pad). */
function pipBox(twin: HTMLElement | null): HTMLElement | null {
  return twin?.closest<HTMLElement>('[data-twin-pip]') ?? null;
}

function union(rs: ReadonlyArray<Rect>): Rect {
  const left = Math.min(...rs.map((r) => r.left));
  const top = Math.min(...rs.map((r) => r.top));
  const right = Math.max(...rs.map((r) => r.left + r.width));
  const bottom = Math.max(...rs.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

const sameRects = (a: ReadonlyArray<Rect>, b: ReadonlyArray<Rect>): boolean => a.length === b.length && a.every((r, i) => sameRect(r, b[i]!));

interface Anchor {
  /** Rings around the controls found on the pad (empty: none on screen). */
  rings: Rect[];
  /** What the callout sits next to. */
  target: Rect;
  /** The twin is a picture-in-picture: the pad is hidden until the split view is back. */
  pip: boolean;
}

export function TryItCallout({ suggestion, onClose, onKeep, reducedMotion }: { suggestion: TryItSuggestion; onClose(): void; onKeep?(): void; reducedMotion: boolean }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 260, height: 64 });
  const toasted = useRef(false);

  useEffect(() => {
    toasted.current = false;
    const find = (): void => {
      const rings = suggestion.controlIds.map((id) => padControl(id)).filter((el): el is HTMLElement => el !== null).map((el) => rectOf(el, 3));
      if (rings.length > 0) {
        setAnchor((a) => (a && sameRects(a.rings, rings) ? a : { rings, target: union(rings), pip: false }));
        return;
      }
      const twin = twinPanel();
      if (isShown(twin)) {
        const pip = pipBox(twin) !== null;
        const r = rectOf(twin, pip ? 0 : -8);
        setAnchor((a) => (a && a.rings.length === 0 && a.pip === pip && sameRect(a.target, r) ? a : { rings: [], target: r, pip }));
        return;
      }
      // not on screen at all: a toast instead
      if (!toasted.current) {
        toasted.current = true;
        toast({ tone: 'info', title: 'Try it now', body: `${suggestion.text}.`, duration: 5000 });
        onClose();
      }
    };
    find();
    const h = window.setInterval(find, 200);
    return () => window.clearInterval(h);
  }, [suggestion, onClose]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.width) > 1 || Math.abs(r.height - size.height) > 1) setSize({ width: r.width, height: r.height });
  });

  if (!anchor) return null;
  const vp = { width: window.innerWidth, height: window.innerHeight };
  // above the control(s) (the pad sits at the bottom of the 3D view); next to the 3D view when there is no control
  const ring = anchor.rings.length > 0 ? anchor.target : null;
  const pos = ring
    ? {
        left: Math.max(8, Math.min(vp.width - size.width - 8, ring.left + ring.width / 2 - size.width / 2)),
        top: ring.top - size.height - 12 >= 8 ? ring.top - size.height - 12 : ring.top + ring.height + 12,
      }
    : placeCard(anchor.target, size, vp, 10, 8, anchor.pip ? ['above', 'left', 'below', 'right'] : undefined);
  const animate = reducedMotion ? undefined : '';
  const keys = suggestion.keys ?? (suggestion.key ? [suggestion.key] : []);
  return createPortal(
    <>
      {anchor.rings.map((r, i) => (
        <div
          key={i}
          aria-hidden
          className="pw-try-ring pointer-events-none fixed z-[44] rounded-lg"
          data-animate={animate}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          data-testid="try-it-ring"
        />
      ))}
      <div
        ref={cardRef}
        role="status"
        aria-live="polite"
        className="fixed z-[44] flex max-w-[min(320px,calc(100vw-16px))] items-start gap-2 rounded-lg border border-safety/50 bg-panel-2/95 py-2 pr-1.5 pl-2.5 text-[12.5px] text-slate-100 shadow-xl shadow-black/50 backdrop-blur"
        style={{ left: pos.left, top: pos.top }}
        data-testid="try-it"
        data-control={suggestion.controlId}
        data-controls={suggestion.controlIds.join(' ')}
        data-pip={anchor.pip ? '' : undefined}
      >
        <MousePointerClick size={15} className="mt-0.5 shrink-0 text-safety" />
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-wide text-safety/90 uppercase">Try it now</div>
          <div>
            {suggestion.text}
            {keys.length > 0 && (
              <>
                {' '}
                <span className="whitespace-nowrap text-slate-400">
                  ({keys.length === 1 ? 'key' : 'keys'}{' '}
                  {keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && ' + '}
                      <Kbd>{k.toUpperCase()}</Kbd>
                    </span>
                  ))}
                  )
                </span>
              </>
            )}
          </div>
          {anchor.pip && (
            <div className="mt-1 text-[11.5px] text-slate-400">
              <div>The controls are hidden while the 3D view is small.</div>
              <button
                type="button"
                onClick={() => {
                  requestSplitView();
                  onKeep?.();
                }}
                className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md border border-safety/40 bg-safety/10 px-1.5 py-0.5 text-[11.5px] font-semibold text-amber-100 hover:bg-safety/20 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
                data-testid="try-it-show-controls"
              >
                <PanelTopOpen size={12} /> Show the controls
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
          aria-label="Close the tip"
          data-testid="try-it-close"
        >
          <X size={12} />
        </button>
      </div>
    </>,
    document.body,
  );
}
