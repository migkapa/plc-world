/**
 * Device highlight drawing shared by both scene kits' tag layers (trainer/kit.tsx, conveyor-sort/kit.tsx): a pulsing,
 * glowing outline around the on-screen footprint of a device's hover box, drawn in the kit's plain-DOM chip layer
 * (crisp at any distance, readable on the dark halls and the bright street scenes alike: cyan glow + dark rim).
 * Dashed when the device is hidden behind a wall or seen from the back of its panel. Motion: a slow glow pulse plus
 * a ring that "pings" outward; both stop for reduced motion (the player setting's `html.reduce-motion` class or the
 * OS preference) — the outline then stays, static.
 *
 * Also the on-screen test and the target report for the "Show" button (see overlay.ts).
 */
import * as THREE from 'three';
import { hitsHud, type HudRect } from '../../twin/hud';
import type { HighlightTarget } from './overlay';

const CSS_ID = 'plcw-hl-css';
const CSS = `
.plcw-hl-ring{position:absolute;left:0;top:0;display:none;pointer-events:none;box-sizing:border-box;border-radius:10px;
  border:2px solid #67e8f9;will-change:transform;z-index:0;
  box-shadow:0 0 0 1.5px rgba(2,10,20,.78),0 0 12px 2px rgba(34,211,238,.5),inset 0 0 0 1.5px rgba(2,10,20,.4),inset 0 0 10px rgba(34,211,238,.22);
  animation:plcw-hl-pulse 1.5s ease-in-out infinite}
.plcw-hl-ring::after{content:'';position:absolute;inset:-3px;border-radius:12px;border:2px solid rgba(103,232,249,.85);
  animation:plcw-hl-ping 1.5s cubic-bezier(0,0,.2,1) infinite}
.plcw-hl-ring[data-hidden]{border-style:dashed;opacity:.8}
.plcw-hl-ring[data-hidden]::after{display:none}
@keyframes plcw-hl-pulse{0%,100%{box-shadow:0 0 0 1.5px rgba(2,10,20,.78),0 0 10px 2px rgba(34,211,238,.45),inset 0 0 0 1.5px rgba(2,10,20,.4),inset 0 0 8px rgba(34,211,238,.18)}
  50%{box-shadow:0 0 0 1.5px rgba(2,10,20,.78),0 0 22px 6px rgba(34,211,238,.7),inset 0 0 0 1.5px rgba(2,10,20,.4),inset 0 0 16px rgba(34,211,238,.35)}}
@keyframes plcw-hl-ping{0%{inset:-3px;opacity:.85}75%,100%{inset:-16px;opacity:0}}
@media (prefers-reduced-motion: reduce){.plcw-hl-ring{animation:none}.plcw-hl-ring::after{display:none}}
html.reduce-motion .plcw-hl-ring{animation:none!important}
html.reduce-motion .plcw-hl-ring::after{display:none}
`;

function ensureCss(): void {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

export interface HighlightRing {
  el: HTMLDivElement;
  shown: boolean;
  hidden: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A ring element (appended to `container`, hidden until placed). */
export function createRing(container: HTMLElement | null): HighlightRing {
  ensureCss();
  const el = document.createElement('div');
  el.className = 'plcw-hl-ring';
  el.dataset.highlightRing = '';
  container?.appendChild(el);
  return { el, shown: false, hidden: false, x: -1e9, y: -1e9, w: 0, h: 0 };
}

/** Screen rectangle of a device's hover box (canvas CSS px) and whether it is in front of the camera. */
export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Centre of the box on screen. */
  cx: number;
  cy: number;
  /** At least one corner is in front of the camera. */
  front: boolean;
  /** The centre is in front of the camera and inside the view (NDC within ±inner). */
  inside: boolean;
}

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Project the unit box of `obj` (a hover proxy: unit BoxGeometry scaled to the device) onto the screen. `obj` must be
 * a mesh whose geometry is the unit box centred on its origin (both kits' proxies are).
 */
export function projectBox(obj: THREE.Object3D, camera: THREE.Camera, W: number, H: number, out: ScreenBox, inner = 0.94): ScreenBox {
  _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(obj.matrixWorld);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let front = false;
  for (let i = 0; i < 8; i++) {
    _p.set(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5).applyMatrix4(_m);
    if (_p.z > 1 || _p.z < -1) continue; // behind the camera (or beyond far)
    front = true;
    const sx = (_p.x * 0.5 + 0.5) * W;
    const sy = (-_p.y * 0.5 + 0.5) * H;
    if (sx < x0) x0 = sx;
    if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy;
    if (sy > y1) y1 = sy;
  }
  _p.set(0, 0, 0).applyMatrix4(_m);
  out.inside = _p.z < 1 && _p.z > -1 && Math.abs(_p.x) < inner && Math.abs(_p.y) < inner;
  out.cx = (_p.x * 0.5 + 0.5) * W;
  out.cy = (-_p.y * 0.5 + 0.5) * H;
  out.front = front;
  out.x0 = x0;
  out.y0 = y0;
  out.x1 = x1;
  out.y1 = y1;
  return out;
}

/** Minimum outline size (px): tiny devices far away still get a readable ring. */
const MIN_RING = 24;
const PAD = 4;

/** Place `r` around the projected box (`hidden`: behind a wall / panel back → dashed). */
export function placeRing(r: HighlightRing, b: ScreenBox, hidden: boolean): void {
  if (!b.front) {
    hideRing(r);
    return;
  }
  let w = b.x1 - b.x0 + 2 * PAD;
  let h = b.y1 - b.y0 + 2 * PAD;
  let x = b.x0 - PAD;
  let y = b.y0 - PAD;
  if (w < MIN_RING) {
    x -= (MIN_RING - w) / 2;
    w = MIN_RING;
  }
  if (h < MIN_RING) {
    y -= (MIN_RING - h) / 2;
    h = MIN_RING;
  }
  if (!r.shown) {
    r.el.style.display = 'block';
    r.shown = true;
  }
  if (hidden !== r.hidden) {
    r.hidden = hidden;
    if (hidden) r.el.dataset.hidden = '';
    else delete r.el.dataset.hidden;
  }
  if (Math.abs(w - r.w) > 0.5 || Math.abs(h - r.h) > 0.5) {
    r.w = w;
    r.h = h;
    r.el.style.width = `${w.toFixed(1)}px`;
    r.el.style.height = `${h.toFixed(1)}px`;
    // rounder for small rings, a gentle radius for big boxes
    r.el.style.borderRadius = `${Math.min(14, Math.max(8, Math.min(w, h) * 0.3)).toFixed(0)}px`;
  }
  if (Math.abs(x - r.x) > 0.3 || Math.abs(y - r.y) > 0.3) {
    r.x = x;
    r.y = y;
    r.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  }
}

export function hideRing(r: HighlightRing): void {
  if (!r.shown) return;
  r.el.style.display = 'none';
  r.shown = false;
  r.x = -1e9;
}

/** Is the device on screen for the player (inside the view, not hidden, centre not under the DOM HUD)? */
export function deviceOnScreen(b: ScreenBox, hidden: boolean, hud: readonly HudRect[]): boolean {
  if (!b.inside || hidden) return false;
  return !hitsHud({ x: b.cx, y: b.cy, w: 1, h: 1 }, hud, 0);
}

const _w = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Where an off-screen device is relative to the view (see HighlightTarget.side). */
function sideOf(pos: THREE.Vector3, camera: THREE.Camera): NonNullable<HighlightTarget['side']> {
  _s.copy(pos).applyMatrix4(camera.matrixWorldInverse);
  if (_s.z > 0) return 'behind';
  _s.copy(pos).project(camera);
  const ax = Math.abs(_s.x);
  const ay = Math.abs(_s.y);
  if (ax <= 1 && ay <= 1) return 'hidden';
  return ax >= ay ? (_s.x < 0 ? 'left' : 'right') : _s.y > 0 ? 'above' : 'below';
}

/** Target report for a highlighted device proxy (world centre + radius from its scale). */
export function targetOf(alias: string, proxy: THREE.Object3D, onScreen: boolean, camera: THREE.Camera, ring?: HighlightRing | null): HighlightTarget {
  proxy.getWorldPosition(_w);
  proxy.getWorldScale(_s);
  const t: HighlightTarget = { alias, position: [_w.x, _w.y, _w.z], radius: Math.max(_s.x, _s.y, _s.z) / 2, onScreen };
  if (!onScreen) {
    t.side = sideOf(_w, camera);
    if (t.side === 'hidden' && ring?.shown) {
      const q = (v: number) => Math.round(v / 4) * 4;
      t.screen = { x: q(ring.x), y: q(ring.y), w: q(ring.w), h: q(ring.h) };
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// Line of sight (shared with the view's "fly to the device" camera)
// ---------------------------------------------------------------------------

/**
 * Drawn, opaque meshes of a scene: what can hide a device from a camera. Hover / hit proxies (invisible or
 * colour-less materials, `noOcclude`, I/O tag boxes), glows (sprites), lines and see-through glass are left out.
 */
export function collectSolids(scene: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const ud = m.userData as { noOcclude?: boolean; ioTag?: string };
    if (ud.noOcclude || ud.ioTag) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((mt) => mt && mt.visible && mt.colorWrite !== false && mt.depthWrite !== false && !(mt.transparent && mt.opacity < 0.5))) out.push(m);
  });
  return out;
}

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _hits: THREE.Intersection[] = [];

/** Does solid geometry sit between `from` and a device at `to` (beyond the device's own radius)? */
export function sightBlocked(solids: THREE.Mesh[], from: THREE.Vector3, to: THREE.Vector3, radius: number, camera?: THREE.Camera): boolean {
  const dist = from.distanceTo(to);
  const far = dist - Math.max(0.03, radius * 1.15);
  if (far <= 0.05) return false;
  _ray.set(from, _dir.subVectors(to, from).normalize());
  _ray.near = 0.05;
  _ray.far = far;
  if (camera) _ray.camera = camera;
  _hits.length = 0;
  try {
    _ray.intersectObjects(solids, false, _hits);
  } catch {
    return false; // an exotic raycast implementation: better a view than no view
  }
  return _hits.length > 0;
}

/** Throttled line-of-sight test for the highlighted devices of a tag layer (solids re-collected every few seconds). */
export class SightCheck {
  private solids: THREE.Mesh[] = [];
  private scanAt = -1e9;
  private readonly memo = new Map<string, { at: number; blocked: boolean }>();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  /** Is the view of `proxy` from `camera` blocked? (re-evaluated at most every 200 ms per proxy) */
  blocked(scene: THREE.Object3D, camera: THREE.Camera, proxy: THREE.Object3D, now: number): boolean {
    if (now - this.scanAt > 3000) {
      this.solids = collectSolids(scene);
      this.scanAt = now;
      this.memo.clear();
    }
    const m = this.memo.get(proxy.uuid);
    if (m && now - m.at < 200) return m.blocked;
    camera.getWorldPosition(this.from);
    proxy.getWorldPosition(this.to);
    proxy.getWorldScale(_s);
    const blocked = sightBlocked(this.solids, this.from, this.to, Math.max(_s.x, _s.y, _s.z) / 2, camera);
    this.memo.set(proxy.uuid, { at: now, blocked });
    return blocked;
  }

  /** Forget the scene (e.g. the highlight ended). */
  reset(): void {
    this.solids = [];
    this.scanAt = -1e9;
    this.memo.clear();
  }
}
