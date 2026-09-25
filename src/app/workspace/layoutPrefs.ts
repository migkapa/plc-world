/**
 * Remembered editing-layout choices of the workspace (per device, localStorage):
 *
 *  - `pages[page].twinPip`: the 3D twin is a small picture-in-picture over the ladder (the ladder gets the whole center
 *    column);
 *  - `pages[page].autoPip`: … automatically, after the ladder has had the keyboard focus for AUTO_PIP_DELAY_MS, and back
 *    when the focus leaves the ladder.
 *    Both are kept per workspace page (the WorkspaceLayout id: 'mission', 'sandbox'): a PiP hides the operator pad, so
 *    a choice made while editing missions must not carry into the sandbox, where operating the plant is the point;
 *  - `pipCorner` / `pipWidth`: where the picture-in-picture sits (dragged there by the player) and how big it is;
 *  - `compactLabels`: the ladder shows tag names only (no descriptions / alias addresses above contacts & coils).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type PipCorner = 'tl' | 'tr' | 'bl' | 'br';

/** Focus time in the ladder before the automatic layout shrinks the twin (ms). */
export const AUTO_PIP_DELAY_MS = 2000;
export const PIP_MIN_W = 220;
export const PIP_MAX_W = 640;
export const PIP_DEFAULT_W = 340;

/** Picture-in-picture choice of one workspace page. */
export interface PagePip {
  twinPip: boolean;
  autoPip: boolean;
}

/** The page the PiP setters use when none is named (and the one the pre-per-page prefs are migrated to). */
export const DEFAULT_LAYOUT_PAGE = 'mission';
const NO_PIP: PagePip = { twinPip: false, autoPip: false };

export interface LayoutPrefs {
  /** Picture-in-picture choice per workspace page (see pipOf). */
  pages: Readonly<Record<string, PagePip>>;
  pipCorner: PipCorner;
  pipWidth: number;
  compactLabels: boolean;
  setTwinPip(on: boolean, page?: string): void;
  setAutoPip(on: boolean, page?: string): void;
  setPipCorner(c: PipCorner): void;
  setPipWidth(w: number): void;
  setCompactLabels(on: boolean): void;
}

const CORNERS: readonly PipCorner[] = ['tl', 'tr', 'bl', 'br'];

export const clampPipWidth = (w: number): number => Math.round(Math.max(PIP_MIN_W, Math.min(PIP_MAX_W, Number.isFinite(w) ? w : PIP_DEFAULT_W)));

/** The picture-in-picture choice of a page (none made yet: the split view). */
export function pipOf(s: Pick<LayoutPrefs, 'pages'>, page: string = DEFAULT_LAYOUT_PAGE): PagePip {
  return s.pages[page] ?? NO_PIP;
}

function cleanPages(raw: unknown): Record<string, PagePip> {
  const out: Record<string, PagePip> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const p = v as Partial<PagePip>;
    out[k] = { twinPip: p.twinPip === true, autoPip: p.autoPip === true };
  }
  return out;
}

export const useLayoutPrefs = create<LayoutPrefs>()(
  persist(
    (set) => ({
      pages: {},
      pipCorner: 'br',
      pipWidth: PIP_DEFAULT_W,
      compactLabels: false,
      setTwinPip: (on, page = DEFAULT_LAYOUT_PAGE) => set((s) => ({ pages: { ...s.pages, [page]: { ...pipOf(s, page), twinPip: on } } })),
      setAutoPip: (on, page = DEFAULT_LAYOUT_PAGE) => set((s) => ({ pages: { ...s.pages, [page]: { ...pipOf(s, page), autoPip: on } } })),
      setPipCorner: (c) => set({ pipCorner: CORNERS.includes(c) ? c : 'br' }),
      setPipWidth: (w) => set({ pipWidth: clampPipWidth(w) }),
      setCompactLabels: (on) => set({ compactLabels: on }),
    }),
    {
      name: 'plcw-layout-prefs-v1',
      version: 1,
      storage: createJSONStorage(() => {
        try {
          const ls = globalThis.localStorage;
          ls.getItem('x');
          return ls;
        } catch {
          const mem = new Map<string, string>();
          return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
        }
      }),
      partialize: (s) => ({ pages: s.pages, pipCorner: s.pipCorner, pipWidth: s.pipWidth, compactLabels: s.compactLabels }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LayoutPrefs> & { twinPip?: unknown; autoPip?: unknown };
        const pages = cleanPages(p.pages);
        // before per-page prefs one choice served every page: it was made while editing missions — keep it there only
        if (p.pages === undefined && (p.twinPip === true || p.autoPip === true)) pages[DEFAULT_LAYOUT_PAGE] = { twinPip: p.twinPip === true, autoPip: p.autoPip === true };
        return {
          ...current,
          pages,
          pipCorner: p.pipCorner && CORNERS.includes(p.pipCorner) ? p.pipCorner : current.pipCorner,
          pipWidth: p.pipWidth !== undefined ? clampPipWidth(p.pipWidth) : current.pipWidth,
          compactLabels: p.compactLabels === true,
        };
      },
    },
  ),
);

/** Nearest corner of a W×H area for a point (the snap target of a dragged picture-in-picture). */
export function nearestCorner(x: number, y: number, W: number, H: number): PipCorner {
  return `${y < H / 2 ? 't' : 'b'}${x < W / 2 ? 'l' : 'r'}` as PipCorner;
}

/** Corner reached by an arrow key from `c` (keyboard moving of the picture-in-picture). */
export function cornerAfterKey(c: PipCorner, key: string): PipCorner {
  const v = c[0]!;
  const h = c[1]!;
  if (key === 'ArrowUp') return `t${h}` as PipCorner;
  if (key === 'ArrowDown') return `b${h}` as PipCorner;
  if (key === 'ArrowLeft') return `${v}l` as PipCorner;
  if (key === 'ArrowRight') return `${v}r` as PipCorner;
  return c;
}

// ---------------------------------------------------------------------------
// "Bring the 3D view back": a request any part of the page can make (e.g. a "Try it now" tip whose control is on the
// operator pad, which a picture-in-picture hides). The desktop WorkspaceLayout answers it like a click on the PiP.
// ---------------------------------------------------------------------------

const splitListeners = new Set<() => void>();

/** Ask the workspace to leave the picture-in-picture (no-op when there is none). */
export function requestSplitView(): void {
  for (const l of [...splitListeners]) l();
}

/** Listen for requestSplitView() (returns the unsubscribe function). */
export function onSplitViewRequest(cb: () => void): () => void {
  splitListeners.add(cb);
  return () => void splitListeners.delete(cb);
}
