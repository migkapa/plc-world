/**
 * Global learning-overlay settings shared by every scene view (and toggled by the page UI).
 *
 *   const showTags = useSceneOverlay((s) => s.showTags);      // inside a scene View
 *   useSceneOverlay.getState().setShowTags(true);             // from a toolbar button
 *
 * showTags = true pins the floating I/O tag chips (alias · address · live value) on every device;
 * when false, a chip appears only while its device is hovered.
 *
 * DEVICE HIGHLIGHT (3D "where is this device?"): the page highlights the physical device(s) behind one or more I/O
 * alias tags — e.g. while the player hovers a row of the I/O table, an alias chip in the briefing or an objective:
 *
 *   useSceneOverlay.getState().setHighlight('Light_0', 'io-table');   // hover in
 *   useSceneOverlay.getState().clearHighlight('io-table');            // hover out (the highlight lingers briefly)
 *   useSceneOverlay.getState().showDevice('Light_0');                 // click: highlight + fly the camera to it
 *
 * The scene kits (trainer/kit.tsx <IoTag>, conveyor-sort/kit.tsx <IoHotspot>) draw a pulsing outline around every
 * device whose tag lines / I/O points name a highlighted alias (or its address; case-insensitive), show its chip,
 * and report where the first highlighted alias is (`reportTarget`): whether it is on screen, and its world position
 * so the view can fly the camera there (`showSeq` / `showDevice`). Several sources may highlight at once (a chip
 * inside an objective): the most recent one wins, and clearing it falls back to the one underneath.
 */
import { create } from 'zustand';

/** Where the primary highlighted device is in the 3D view (reported by the scene kit's tag layer). */
export interface HighlightTarget {
  /** The highlighted alias this target belongs to. */
  alias: string;
  /** World position of the device (centre of its hover box). */
  position: [number, number, number];
  /** Rough device radius (m): half the largest hover-box side. */
  radius: number;
  /** Inside the view, in front of the camera, not behind a wall / panel back and not under the DOM HUD. */
  onScreen: boolean;
  /**
   * Where it is relative to the view when not on screen: beyond an edge, behind the camera, or inside the view but
   * hidden (behind a wall, under the operator pad…). Undefined when on screen.
   */
  side?: 'left' | 'right' | 'above' | 'below' | 'behind' | 'hidden';
  /** side 'hidden': the device's outline on screen (canvas CSS px, rounded) — the "Show" button keeps clear of it. */
  screen?: { x: number; y: number; w: number; h: number };
}

/** How long a highlight stays after its last source let go (lets the pointer reach the "Show" button). */
export const HIGHLIGHT_LINGER_MS = 1400;
/** How long `showDevice` keeps its highlight. */
export const SHOW_HIGHLIGHT_MS = 3500;

interface HighlightSource {
  id: string;
  aliases: string[];
}

export interface SceneOverlayState {
  /** Always show the floating I/O tag chips (not just on hover). */
  showTags: boolean;
  setShowTags(on: boolean): void;
  toggleShowTags(): void;

  /** Aliases whose devices are highlighted (most recent source; empty = none). */
  highlight: readonly string[];
  /** The first highlighted alias (the one `target` / "Show" refer to), or null. */
  highlightAlias: string | null;
  /** True while the highlight only lingers (its source let go; it clears after HIGHLIGHT_LINGER_MS). */
  highlightLingering: boolean;
  /**
   * Highlight the devices of `aliases` for `source` (default 'default'); replaces that source's previous highlight
   * and becomes the active one. `null` / empty clears the source (like clearHighlight).
   */
  setHighlight(aliases: string | readonly string[] | null, source?: string): void;
  /** Drop a source's highlight (default: every source, immediately). */
  clearHighlight(source?: string): void;
  /** Keep the current highlight while `on` (e.g. the pointer is over the "Show" button). */
  holdHighlight(on: boolean): void;

  /** Reported by the scene kit for `highlightAlias` (null: no such device in this view, or nothing highlighted). */
  target: HighlightTarget | null;
  reportTarget(t: HighlightTarget | null): void;

  /** Incremented to ask the 3D view to fly its camera to `showAlias`. */
  showSeq: number;
  showAlias: string | null;
  /** Highlight `alias` for a few seconds and fly the camera to it. */
  showDevice(alias: string): void;
}

let sources: HighlightSource[] = [];
let lingerTimer: ReturnType<typeof setTimeout> | undefined;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let held = false;

const norm = (a: string | readonly string[] | null | undefined): string[] => {
  const list = a == null ? [] : typeof a === 'string' ? [a] : [...a];
  const out: string[] = [];
  for (const s of list) {
    const t = s.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const useSceneOverlay = create<SceneOverlayState>((set, get) => {
  /** Publish the top source (or start lingering when none is left). */
  const apply = (): void => {
    const top = sources[sources.length - 1];
    if (top) {
      if (lingerTimer !== undefined) clearTimeout(lingerTimer);
      lingerTimer = undefined;
      const cur = get();
      if (!sameList(cur.highlight, top.aliases) || cur.highlightLingering) set({ highlight: top.aliases, highlightAlias: top.aliases[0] ?? null, highlightLingering: false });
      return;
    }
    if (get().highlight.length === 0 || lingerTimer !== undefined) return;
    set({ highlightLingering: true });
    const expire = (): void => {
      lingerTimer = undefined;
      if (sources.length > 0) return;
      if (held) {
        lingerTimer = setTimeout(expire, 250);
        return;
      }
      set({ highlight: [], highlightAlias: null, highlightLingering: false, target: null });
    };
    lingerTimer = setTimeout(expire, HIGHLIGHT_LINGER_MS);
  };
  return {
    showTags: false,
    setShowTags: (on) => set({ showTags: on }),
    toggleShowTags: () => set((s) => ({ showTags: !s.showTags })),

    highlight: [],
    highlightAlias: null,
    highlightLingering: false,
    setHighlight: (aliases, source = 'default') => {
      const list = norm(aliases);
      sources = sources.filter((s) => s.id !== source);
      if (list.length > 0) sources.push({ id: source, aliases: list });
      apply();
    },
    clearHighlight: (source) => {
      if (source === undefined) {
        sources = [];
        held = false;
        if (lingerTimer !== undefined) clearTimeout(lingerTimer);
        lingerTimer = undefined;
        set({ highlight: [], highlightAlias: null, highlightLingering: false, target: null });
        return;
      }
      const before = sources.length;
      sources = sources.filter((s) => s.id !== source);
      if (sources.length !== before) apply();
    },
    holdHighlight: (on) => {
      held = on;
    },

    target: null,
    reportTarget: (t) => {
      const cur = get().target;
      if (t === cur) return;
      if (
        t &&
        cur &&
        t.alias === cur.alias &&
        t.onScreen === cur.onScreen &&
        t.side === cur.side &&
        t.screen?.x === cur.screen?.x &&
        t.screen?.y === cur.screen?.y &&
        Math.abs(t.radius - cur.radius) < 1e-3 &&
        Math.hypot(t.position[0] - cur.position[0], t.position[1] - cur.position[1], t.position[2] - cur.position[2]) < 0.01
      )
        return;
      set({ target: t });
    },

    showSeq: 0,
    showAlias: null,
    showDevice: (alias) => {
      const a = alias.trim();
      if (!a) return;
      get().setHighlight(a, 'show');
      if (showTimer !== undefined) clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        showTimer = undefined;
        get().clearHighlight('show');
      }, SHOW_HIGHLIGHT_MS);
      set((s) => ({ showSeq: s.showSeq + 1, showAlias: a }));
    },
  };
});

/** Does a device carrying these tag names (aliases / addresses) match the highlight? (case-insensitive) */
export function matchesHighlight(names: ReadonlyArray<string | undefined>, highlight: readonly string[]): boolean {
  if (highlight.length === 0) return false;
  for (const n of names) {
    if (!n) continue;
    const l = n.toLowerCase();
    for (const h of highlight) if (h.toLowerCase() === l) return true;
  }
  return false;
}

// dev-only handle for QA scripts (highlight state, target reports)
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __sceneOverlay?: unknown }).__sceneOverlay = useSceneOverlay;
