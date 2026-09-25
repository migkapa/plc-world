/**
 * The DOM HUD drawn over a <SceneCanvas> (camera bar, tools, replay caption, operator pad…), seen from inside
 * the canvas: screen-space layers (I/O tag chips, value pills) keep out of it, and the camera can frame its
 * target in the part of the view the HUD leaves free.
 *
 * The HUD boxes are the outermost elements of the canvas overlay (`<SceneCanvas overlay>`) that take pointer
 * events: an overlay lays itself out with `pointer-events: none` and makes only its controls interactive.
 * Rects are in canvas-local CSS pixels and are cached per canvas for `HUD_MAX_AGE_MS`.
 */

export interface HudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Attributes of the SceneCanvas wrapper and of its overlay container (set in Stage.tsx). */
const STAGE_ROOT_ATTR = 'data-stage-root';
const STAGE_OVERLAY_ATTR = 'data-stage-overlay';

const HUD_MAX_AGE_MS = 200;
const cache = new WeakMap<HTMLCanvasElement, { t: number; rects: HudRect[] }>();
const EMPTY: HudRect[] = [];

function collect(el: Element, origin: DOMRect, out: HudRect[], depth: number): void {
  for (const child of Array.from(el.children)) {
    const cs = getComputedStyle(child);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (cs.pointerEvents !== 'none') {
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
      continue;
    }
    if (depth < 8) collect(child, origin, out, depth + 1);
  }
}

/** HUD boxes over `canvas` (canvas-local CSS px); empty when the canvas has no HUD overlay. */
export function hudRects(canvas: HTMLCanvasElement): HudRect[] {
  if (typeof window === 'undefined') return EMPTY;
  const now = performance.now();
  const hit = cache.get(canvas);
  if (hit && now - hit.t < HUD_MAX_AGE_MS) return hit.rects;
  const rects: HudRect[] = [];
  const root = canvas.closest(`[${STAGE_ROOT_ATTR}]`);
  const overlay = root?.querySelector(`:scope > [${STAGE_OVERLAY_ATTR}]`);
  if (overlay) collect(overlay, canvas.getBoundingClientRect(), rects, 0);
  cache.set(canvas, { t: now, rects });
  return rects;
}

/** Vertical space the HUD takes at the top and at the bottom of a W x H view (bands that span the edges). */
export function hudInsets(rects: readonly HudRect[], H: number): { top: number; bottom: number } {
  let top = 0;
  let bottom = 0;
  for (const r of rects) {
    if (r.y < H * 0.3 && r.y + r.h < H * 0.5) top = Math.max(top, r.y + r.h);
    else if (r.y + r.h > H * 0.7 && r.y > H * 0.5) bottom = Math.max(bottom, H - r.y);
  }
  return { top, bottom };
}

export function rectsOverlap(a: HudRect, b: HudRect, gap = 2): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

export function hitsHud(r: HudRect, hud: readonly HudRect[], gap = 3): boolean {
  for (const h of hud) if (rectsOverlap(r, h, gap)) return true;
  return false;
}
