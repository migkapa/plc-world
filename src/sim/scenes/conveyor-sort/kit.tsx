/**
 * Scene kit shared by the `conveyor-sort` and `tank-process` views (the tank view imports it from here):
 *
 *  <TagLayer>       one per scene, WRAPS the scene content: the learning overlay. It owns a plain-DOM layer on top
 *                   of the canvas (no drei <Html> / React roots) and lays out every visible I/O chip once per frame:
 *                   projection, screen-space de-overlap (hovered chip first, the others pushed up/down around it),
 *                   a 1 px leader line + dot from each chip to its device, occlusion (a few round-robin raycasts per
 *                   frame against a cached list of large opaque meshes), distance level-of-detail and grouping:
 *                   when the devices of one panel (`group`) are small on screen, their pinned chips collapse into one
 *                   summary chip ("OP-101 · Start 0 · Stop 1 · Disch 0 · E-stop 1").
 *  <IoHotspot>      invisible hover box around a physical device + its chip ("Start_PB · Local:1:I.Data.0 · 1"). Shown
 *                   while hovered, or pinned when the global overlay (`useSceneOverlay().showTags`) is on. Hovered chips
 *                   add the contact type and the point's description (N.C. points: healthy 1 is neutral, 0 is red).
 *                   With `press` / `onClick` the box is ALSO the device's hit target (forwarded to the same control
 *                   handlers, propagation stopped) so a click slightly beside a small button still works — and one
 *                   physical click is exactly one action. Without points it shows an `info` chip (instructor /
 *                   local controls that are NOT PLC I/O).
 *  <ShadowBudget>   turns off shadow casting for tiny meshes (screws, LEDs, labels) to keep the shadow pass lean.
 *  control helpers  momentary / toggle / selector wiring to runtime.setControl + click sounds.
 *  useThrottledFrame / audio helpers for scene sound loops & one-shots (no AudioContext before a user gesture).
 *
 * Values in the chips are read from the controller's I/O image (what the PLC program sees), throttled to ~8 Hz and
 * written straight into the DOM (no React re-renders per frame).
 */
import { useFrame, useThree, type RootState, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { sfx, type LoopName, type SfxName } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import { hudRects } from '../../../twin/hud';
import type { IoPointDef, SimRuntime } from '../../types';
import { matchesHighlight, useSceneOverlay } from '../overlay';
import { createRing, deviceOnScreen, hideRing, placeRing, projectBox, targetOf, type HighlightRing, type ScreenBox } from '../highlight';
import { useDisposeOnUnmount } from '../../../twin/dispose';

// ---------------------------------------------------------------------------
// Invisible hit material (raycastable, never drawn, never occludes chips)
// ---------------------------------------------------------------------------

let hitMat: THREE.MeshBasicMaterial | null = null;
/**
 * Shared material for hover / hit proxies. `visible = false`: the renderer skips the mesh entirely (no draw call),
 * while Mesh.raycast ignores material visibility, so pointer events still work.
 */
export function hitMaterial(): THREE.MeshBasicMaterial {
  if (!hitMat) {
    hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    hitMat.name = 'io-hit';
    hitMat.visible = false;
  }
  return hitMat;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------------------
// Controls (operator devices -> runtime)
// ---------------------------------------------------------------------------

export interface MomentaryWiring {
  getPressed: () => boolean;
  onPress: () => void;
  onRelease: () => void;
}

/** Push button wiring: true while held. */
export function momentaryControl(runtime: SimRuntime, id: string): MomentaryWiring {
  return {
    getPressed: () => Boolean(runtime.getControl(id)),
    onPress: () => {
      runtime.setControl(id, true);
      playSfx('press');
    },
    onRelease: () => {
      if (!runtime.getControl(id)) return;
      runtime.setControl(id, false);
      playSfx('release');
    },
  };
}

/** Maintained device (E-stop mushroom, latching switch): each click toggles. */
export function toggleControl(runtime: SimRuntime, id: string): () => void {
  return () => {
    runtime.setControl(id, !runtime.getControl(id));
    playSfx('toggle');
  };
}

/** Selector switch: each click steps to the next position (wraps). */
export function stepSelector(runtime: SimRuntime, id: string, positions: number): () => void {
  return () => {
    runtime.setControl(id, (Number(runtime.getControl(id)) + 1) % positions);
    playSfx('toggle');
  };
}

// ---------------------------------------------------------------------------
// I/O value formatting
// ---------------------------------------------------------------------------

function readPoint(runtime: SimRuntime, p: IoPointDef): number | boolean {
  try {
    const tags = runtime.controller.tags;
    return p.signal === 'analog' ? tags.readNumber(p.operand) : tags.readBool(p.operand);
  } catch {
    return p.signal === 'analog' ? 0 : false;
  }
}

function formatValue(p: IoPointDef, v: number | boolean): string {
  if (typeof v === 'boolean') return v ? '1' : '0';
  const units = p.units ? ` ${p.units}` : '';
  return `${v.toFixed(1)}${units}`;
}

const NC_RE = /\bN\.C\.|normally-closed|fail-safe/i;
/** Normally-closed input (healthy / not pressed = 1). */
export function isNormallyClosed(p: IoPointDef): boolean {
  return p.dir === 'input' && p.signal === 'digital' && (NC_RE.test(p.device) || NC_RE.test(p.description));
}

function contactType(p: IoPointDef): string {
  if (p.signal !== 'digital' || p.dir !== 'input') return '';
  if (isNormallyClosed(p)) return 'N.C.';
  if (/\bN\.O\.|normally-open/i.test(p.device) || /normally-open/i.test(p.description)) return 'N.O.';
  return '';
}

/** Short label of a point for grouped chips: 'Start_PB' -> 'Start', 'Batch_Done_Light' -> 'Batch Done'. */
function shortName(alias: string): string {
  return alias.replace(/_(PB|Light|OK|101)$/i, '').replace(/_/g, ' ');
}

const BADGE_BASE =
  'font:700 10.5px/1.35 "JetBrains Mono",ui-monospace,monospace;padding:0 5px;border-radius:4px;min-width:12px;text-align:center;display:inline-block;';

function styleBadge(el: HTMLElement, p: IoPointDef, v: number | boolean) {
  if (p.signal !== 'digital') {
    el.style.background = '#1e293b';
    el.style.color = '#e2e8f0';
    return;
  }
  const on = v === true;
  if (isNormallyClosed(p)) {
    // N.C.: healthy (1) is the normal state -> neutral; 0 = pressed / tripped -> red
    el.style.background = on ? '#475569' : '#dc2626';
    el.style.color = on ? '#f1f5f9' : '#fff1f2';
  } else {
    el.style.background = on ? '#16a34a' : '#334155';
    el.style.color = on ? '#f0fdf4' : '#cbd5e1';
  }
}

// ---------------------------------------------------------------------------
// Chip registry + layer
// ---------------------------------------------------------------------------

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface ChipRow {
  point: IoPointDef;
  detail: HTMLSpanElement;
  value: HTMLSpanElement;
  desc: HTMLDivElement;
}

type ChipMode = 'hidden' | 'full' | 'pinned' | 'compact';

interface ChipEntry {
  anchor: THREE.Object3D;
  target: THREE.Object3D;
  points: IoPointDef[];
  title?: string;
  info: string[];
  group?: string;
  hovered: boolean;
  /** Lower-case aliases + operands of the points (device highlight matching). */
  names: string[];
  /** Highlighted this frame (useSceneOverlay().highlight names one of its points). */
  hl: boolean;
  /** hovered || hl: shows the full chip, laid out first. */
  hot: boolean;
  ring: HighlightRing | null;
  // DOM
  el: HTMLDivElement;
  titleEl: HTMLDivElement | null;
  rows: ChipRow[];
  infoEl: HTMLDivElement | null;
  line: SVGLineElement;
  dot: SVGCircleElement;
  // layout state
  mode: ChipMode;
  w: number;
  h: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  right: boolean;
  dist: number;
  occluded: boolean;
  last: string[];
  collapsed: boolean;
  /** Placed screen rectangle (reused every frame, no allocation). */
  rect: Rect;
}

interface GroupChip {
  label: string;
  el: HTMLDivElement;
  labels: HTMLSpanElement[];
  values: HTMLSpanElement[];
  members: ChipEntry[];
  shown: boolean;
  w: number;
  h: number;
  last: string[];
  /** Summary chip rectangle this frame (valid when `hasRect`). */
  rect: Rect;
  hasRect: boolean;
}

const CHIP_CSS =
  'position:absolute;left:0;top:0;display:none;pointer-events:none;user-select:none;white-space:nowrap;' +
  'background:rgba(9,13,20,0.9);border:1px solid rgba(148,163,184,0.38);border-radius:6px;padding:3px 7px 4px;' +
  'font:500 11px/1.35 "Inter Variable",Inter,system-ui,sans-serif;color:#e2e8f0;box-shadow:0 2px 10px rgba(0,0,0,0.45);' +
  'transition:opacity 140ms linear;will-change:transform;';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text !== undefined) e.textContent = text;
  return e;
}

class ChipRegistry {
  entries: ChipEntry[] = [];
  groups = new Map<string, GroupChip>();
  container: HTMLDivElement | null = null;
  svg: SVGSVGElement | null = null;
  runtime: SimRuntime | null = null;

  attach(container: HTMLDivElement, svg: SVGSVGElement) {
    this.container = container;
    this.svg = svg;
    for (const e of this.entries) this.mount(e);
    for (const g of this.groups.values()) container.appendChild(g.el);
  }

  mount(e: ChipEntry) {
    if (!this.container || !this.svg) return;
    this.container.appendChild(e.el);
    this.svg.appendChild(e.line);
    this.svg.appendChild(e.dot);
  }

  add(e: ChipEntry) {
    this.entries.push(e);
    this.mount(e);
    if (e.group) {
      let g = this.groups.get(e.group);
      if (!g) {
        g = { label: e.group, el: el('div', CHIP_CSS), labels: [], values: [], members: [], shown: false, w: 0, h: 0, last: [], rect: { x0: 0, y0: 0, x1: 0, y1: 0 }, hasRect: false };
        this.groups.set(e.group, g);
        this.container?.appendChild(g.el);
      }
      g.members.push(e);
      this.rebuildGroup(g);
    }
  }

  remove(e: ChipEntry) {
    const i = this.entries.indexOf(e);
    if (i >= 0) this.entries.splice(i, 1);
    e.el.remove();
    e.line.remove();
    e.dot.remove();
    e.ring?.el.remove();
    if (e.group) {
      const g = this.groups.get(e.group);
      if (g) {
        g.members = g.members.filter((m) => m !== e);
        if (g.members.length === 0) {
          g.el.remove();
          this.groups.delete(e.group);
        } else this.rebuildGroup(g);
      }
    }
  }

  rebuildGroup(g: GroupChip) {
    g.el.textContent = '';
    g.labels = [];
    g.values = [];
    g.last = [];
    g.el.appendChild(el('span', 'color:#94a3b8;font-weight:700;font-size:10px;letter-spacing:0.3px;margin-right:6px;', g.label));
    let first = true;
    for (const m of g.members) {
      for (const p of m.points) {
        if (!first) g.el.appendChild(el('span', 'color:#475569;margin:0 4px;', '·'));
        first = false;
        const l = el('span', `font-weight:700;color:${p.dir === 'input' ? '#7dd3fc' : '#fcd34d'};margin-right:4px;`, shortName(p.alias));
        const v = el('span', BADGE_BASE + 'background:#334155;', '–');
        g.el.appendChild(l);
        g.el.appendChild(v);
        g.labels.push(l);
        g.values.push(v);
      }
    }
  }
}

const TagCtx = createContext<ChipRegistry | null>(null);

function buildEntryDom(points: IoPointDef[], title: string | undefined, info: string[]) {
  const root = el('div', CHIP_CSS);
  let titleEl: HTMLDivElement | null = null;
  if (title) {
    titleEl = el('div', 'color:#94a3b8;font-size:10px;font-weight:600;letter-spacing:0.3px;margin-bottom:1px;', title);
    root.appendChild(titleEl);
  }
  const rows: ChipRow[] = points.map((p) => {
    const row = el('div', 'display:flex;align-items:center;gap:6px;');
    row.appendChild(el('span', `font-weight:700;color:${p.dir === 'input' ? '#7dd3fc' : '#fcd34d'};`, p.alias));
    const detail = el('span', 'display:contents;');
    detail.appendChild(el('span', 'color:#64748b;', '·'));
    detail.appendChild(el('span', 'font:500 10.5px/1.35 "JetBrains Mono",ui-monospace,monospace;color:#cbd5e1;', p.operand));
    row.appendChild(detail);
    row.appendChild(el('span', 'color:#64748b;', '·'));
    const value = el('span', BADGE_BASE + 'background:#334155;', '–');
    row.appendChild(value);
    root.appendChild(row);
    const ct = contactType(p);
    const desc = el(
      'div',
      'display:none;white-space:normal;max-width:300px;color:#94a3b8;font-size:10.5px;line-height:1.3;margin:1px 0 3px;',
      `${ct ? `${ct} contact · ` : ''}${p.description}`,
    );
    root.appendChild(desc);
    return { point: p, detail, value, desc };
  });
  let infoEl: HTMLDivElement | null = null;
  if (info.length) {
    infoEl = el('div', 'white-space:normal;max-width:300px;color:#cbd5e1;font-size:10.5px;line-height:1.35;margin-top:1px;');
    info.forEach((line, i) => {
      const d = el('div', i === 0 && points.length === 0 ? 'color:#fcd34d;font-weight:600;' : '', line);
      infoEl!.appendChild(d);
    });
    root.appendChild(infoEl);
  }
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('stroke', 'rgba(148,163,184,0.75)');
  line.setAttribute('stroke-width', '1');
  line.style.display = 'none';
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', '#e2e8f0');
  dot.setAttribute('stroke', 'rgba(9,13,20,0.9)');
  dot.setAttribute('stroke-width', '1');
  dot.style.display = 'none';
  return { root, titleEl, rows, infoEl, line, dot };
}

function applyMode(e: ChipEntry, mode: ChipMode) {
  e.mode = mode;
  if (mode === 'hidden') {
    e.el.style.display = 'none';
    e.line.style.display = 'none';
    e.dot.style.display = 'none';
    return;
  }
  e.el.style.display = 'block';
  const full = mode === 'full';
  const compact = mode === 'compact';
  e.el.style.zIndex = full ? '3' : '1';
  e.el.style.borderColor = full ? 'rgba(125,211,252,0.75)' : 'rgba(148,163,184,0.38)';
  if (e.titleEl) e.titleEl.style.display = compact && e.points.length ? 'none' : 'block';
  for (const r of e.rows) {
    r.detail.style.display = compact ? 'none' : 'contents';
    r.desc.style.display = full ? 'block' : 'none';
  }
  if (e.infoEl) e.infoEl.style.display = full ? 'block' : 'none';
  e.w = e.el.offsetWidth;
  e.h = e.el.offsetHeight;
}

/** Beyond this camera distance (m) a pinned chip collapses to "alias · value". */
const COMPACT_DISTANCE = 4.2;
/** Pinned chips of a group collapse into one summary chip when its devices span less than this on screen (px). */
const GROUP_SPAN_PX = 72;
const PAD = 3;

const _ray = new THREE.Raycaster();
const _cam = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _hits: THREE.Intersection[] = [];

function collectOccluders(scene: THREE.Scene): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const scale = new THREE.Vector3();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    for (const c of o.children) visit(c);
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (m.userData.noOcclude) return;
    const mat = m.material as THREE.Material | THREE.Material[];
    const first = Array.isArray(mat) ? mat[0] : mat;
    if (!first || !first.visible || first.transparent || first.name === 'io-hit' || !first.depthWrite) return;
    const g = m.geometry as THREE.BufferGeometry | undefined;
    if (!g || !g.attributes.position) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    m.getWorldScale(scale);
    const r = (g.boundingSphere?.radius ?? 0) * Math.max(scale.x, scale.y, scale.z);
    if (r >= 0.12) out.push(m);
  };
  visit(scene);
  return out;
}

const byHoverThenY = (a: ChipEntry, b: ChipEntry) => (a.hot === b.hot ? a.ay - b.ay : a.hot ? -1 : 1);
const _sb: ScreenBox = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, front: false, inside: false };

function overlaps(a: Rect, b: Rect) {
  return a.x0 < b.x1 + PAD && a.x1 + PAD > b.x0 && a.y0 < b.y1 + PAD && a.y1 + PAD > b.y0;
}

/**
 * Move `r` vertically to the nearest free slot: resolve by pushing consistently DOWN past every rectangle in the way,
 * and consistently UP; take the smaller displacement that stays inside the viewport (never oscillates).
 */
function settle(r: Rect, placed: Rect[], H: number) {
  if (!placed.some((q) => overlaps(r, q))) return;
  const h = r.y1 - r.y0;
  const test: Rect = { x0: r.x0, x1: r.x1, y0: 0, y1: 0 };
  const tryDir = (dir: 1 | -1): number | null => {
    let y0 = r.y0;
    for (let it = 0; it < 48; it++) {
      test.y0 = y0;
      test.y1 = y0 + h;
      let hit: Rect | null = null;
      for (const q of placed) {
        if (overlaps(test, q)) {
          hit = q;
          break;
        }
      }
      if (!hit) return y0;
      y0 = dir > 0 ? hit.y1 + PAD + 0.5 : hit.y0 - PAD - 0.5 - h;
      if (y0 < 4 || y0 + h > H - 4) return null;
    }
    return null;
  };
  const down = tryDir(1);
  const up = tryDir(-1);
  let best = down;
  if (up !== null && (down === null || Math.abs(up - r.y0) < Math.abs(down - r.y0))) best = up;
  if (best === null) return;
  r.y0 = best;
  r.y1 = best + h;
}

/**
 * The learning overlay of a scene. Wrap the whole scene content in it (IoHotspots register with the nearest layer).
 * Also exposes `window.__sceneDebug` in dev builds for QA scripts.
 */
export function TagLayer({ runtime, children }: { runtime: SimRuntime; children: ReactNode }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const reg = useMemo(() => new ChipRegistry(), []);
  reg.runtime = runtime;
  const showTags = useSceneOverlay((s) => s.showTags);
  const show = useRef(showTags);
  show.current = showTags;

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    // stacked inside the canvas' own stacking context (see SceneCanvas): above the 3D view, below the DOM HUD
    const c = el('div', 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;');
    c.dataset.plcwChips = '1';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.cssText = 'position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:0;';
    c.appendChild(svg);
    parent.appendChild(c);
    reg.attach(c, svg);
    return () => {
      c.remove();
      reg.container = null;
      reg.svg = null;
    };
  }, [gl, reg]);

  useEffect(() => {
    // dev-only hook for QA scripts (draw calls, mesh counts, world -> screen projection for click tests)
    if (!import.meta.env.DEV) return;
    const project = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    (window as unknown as { __sceneDebug?: unknown }).__sceneDebug = { scene, gl, camera, project, THREE, runtime };
  }, [scene, gl, camera, runtime]);

  const occluders = useRef<THREE.Mesh[]>([]);
  const timers = useRef({ scan: -1e9, text: 0, measure: 0, cursor: 0 });
  const placed = useMemo<Rect[]>(() => [], []);
  const order = useMemo<ChipEntry[]>(() => [], []);
  /** Highlight bookkeeping: some ring shown last frame; primary alias of the last target report. */
  const hlState = useRef<{ rings: boolean; reported: string | null }>({ rings: false, reported: null });

  useFrame(({ camera: cam, clock, size }) => {
    if (!reg.container) return;
    const T = timers.current;
    const t = clock.elapsedTime;
    const W = size.width;
    const H = size.height;
    const pinned = show.current;
    if (t - T.scan > 2.5) {
      occluders.current = collectOccluders(scene);
      T.scan = t;
    }
    const doText = t - T.text > 0.12;
    if (doText) T.text = t;
    const doMeasure = t - T.measure > 0.5;
    if (doMeasure) T.measure = t;
    cam.getWorldPosition(_cam);
    // device highlight (I/O table row, briefing alias chip, objective…): full chip + outline
    const overlay = useSceneOverlay.getState();
    const hlList = overlay.highlight;
    const anyHl = hlList.length > 0;

    // 1. visibility, projection, mode
    order.length = 0;
    for (const e of reg.entries) {
      e.hl = anyHl && matchesHighlight(e.names, hlList);
      e.hot = e.hovered || e.hl;
      const want = e.hot || (pinned && e.points.length + e.info.length > 0);
      if (!want) {
        if (e.mode !== 'hidden') applyMode(e, 'hidden');
        e.collapsed = false;
        continue;
      }
      e.target.getWorldPosition(_pt);
      e.dist = _pt.distanceTo(_cam);
      _v.copy(_pt).project(cam);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.15 || Math.abs(_v.y) > 1.15) {
        if (e.mode !== 'hidden') applyMode(e, 'hidden');
        continue;
      }
      e.tx = (_v.x * 0.5 + 0.5) * W;
      e.ty = (-_v.y * 0.5 + 0.5) * H;
      e.anchor.getWorldPosition(_pt);
      _v.copy(_pt).project(cam);
      e.ax = (_v.x * 0.5 + 0.5) * W;
      e.ay = (-_v.y * 0.5 + 0.5) * H;
      e.right = e.ax >= e.tx - 2;
      order.push(e);
    }

    // highlight outlines + where the primary highlighted device is (for the view's "Show" button)
    const hs = hlState.current;
    if (anyHl || hs.rings) {
      const primary = anyHl ? overlay.highlightAlias : null;
      const hud = hudRects(gl.domElement);
      let best: ChipEntry | null = null;
      let bestOn = false;
      hs.rings = false;
      for (const e of reg.entries) {
        if (!e.hl) {
          if (e.ring) hideRing(e.ring);
          continue;
        }
        if (!e.ring) e.ring = createRing(reg.container);
        projectBox(e.target, cam, W, H, _sb);
        placeRing(e.ring, _sb, e.occluded);
        hs.rings = true;
        if (primary && matchesHighlight(e.names, [primary])) {
          const on = deviceOnScreen(_sb, e.occluded, hud);
          if (!best || (on && !bestOn)) {
            best = e;
            bestOn = on;
          }
        }
      }
      if (primary && (doText || hs.reported !== primary)) {
        hs.reported = primary;
        overlay.reportTarget(best ? targetOf(primary, best.target, bestOn, cam, best.ring) : null);
      }
      if (!primary) hs.reported = null;
    }

    if (order.length === 0) {
      for (const g of reg.groups.values()) {
        if (g.shown) {
          g.shown = false;
          g.el.style.display = 'none';
        }
      }
      return;
    }
    // 2. occlusion (round robin, 3 rays per frame) for pinned chips
    const list = occluders.current;
    const n = order.length;
    if (n > 0) {
      const start = Math.floor(t * 60) % n;
      for (let k = 0; k < Math.min(3, n); k++) {
        const e = order[(start + k) % n]!;
        e.anchor.getWorldPosition(_pt);
        _dir.subVectors(_pt, _cam);
        const dist = _dir.length();
        _dir.divideScalar(dist || 1);
        _ray.set(_cam, _dir);
        _ray.far = Math.max(0, dist - 0.06);
        _hits.length = 0;
        _ray.intersectObjects(list, false, _hits);
        e.occluded = _hits.length > 0;
      }
    }

    // 3. groups: collapse pinned members of a panel that is small on screen
    for (const g of reg.groups.values()) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let count = 0;
      let hovered = false;
      for (const m of g.members) {
        if (m.hot) hovered = true;
        if (!order.includes(m)) continue;
        count++;
        minX = Math.min(minX, m.tx);
        maxX = Math.max(maxX, m.tx);
        minY = Math.min(minY, m.ty);
        maxY = Math.max(maxY, m.ty);
      }
      const collapse = pinned && count > 1 && Math.max(maxX - minX, maxY - minY) < GROUP_SPAN_PX;
      for (const m of g.members) m.collapsed = collapse && !m.hot;
      if (collapse !== g.shown) {
        g.shown = collapse;
        g.el.style.display = collapse ? 'block' : 'none';
        if (collapse) {
          g.w = g.el.offsetWidth;
          g.h = g.el.offsetHeight;
        }
      }
      // one summary chip just above the panel's devices
      const cx = (minX + maxX) / 2;
      g.hasRect = collapse && !hovered;
      g.rect.x0 = cx - g.w / 2;
      g.rect.x1 = cx + g.w / 2;
      g.rect.y0 = minY - 22 - g.h;
      g.rect.y1 = minY - 22;
    }

    // 4. modes + text
    for (const e of order) {
      const occluded = e.occluded && !e.hot;
      let mode: ChipMode = e.hot ? 'full' : e.dist > COMPACT_DISTANCE ? 'compact' : 'pinned';
      // info-only chips (instructor controls, junction boxes …) are pinned only near the camera; far away: hover
      if (e.collapsed || occluded || (mode === 'compact' && e.points.length === 0)) mode = 'hidden';
      if (mode !== e.mode) applyMode(e, mode);
      else if (doMeasure && mode !== 'hidden') {
        e.w = e.el.offsetWidth;
        e.h = e.el.offsetHeight;
      }
      if ((doText || e.last.length === 0) && mode !== 'hidden' && reg.runtime) {
        for (let i = 0; i < e.rows.length; i++) {
          const r = e.rows[i]!;
          const v = readPoint(reg.runtime, r.point);
          const s = formatValue(r.point, v);
          if (e.last[i] !== s) {
            e.last[i] = s;
            r.value.textContent = s;
            styleBadge(r.value, r.point, v);
          }
        }
        if (e.last.length === 0) e.last.push('');
      }
    }
    if (doText && reg.runtime) {
      for (const g of reg.groups.values()) {
        if (!g.shown) continue;
        let i = 0;
        for (const m of g.members)
          for (const p of m.points) {
            const v = readPoint(reg.runtime, p);
            const s = formatValue(p, v);
            const badge = g.values[i];
            if (badge && g.last[i] !== s) {
              g.last[i] = s;
              badge.textContent = s;
              styleBadge(badge, p, v);
            }
            i++;
          }
      }
    }

    // 5. layout: hovered chips first, then groups, then by y; the DOM HUD over the canvas (camera bar, tools,
    //    replay caption, operator pad) is an obstacle chips settle around
    placed.length = 0;
    const hud = hudRects(gl.domElement);
    for (const h of hud) placed.push({ x0: h.x, y0: h.y, x1: h.x + h.w, y1: h.y + h.h });
    const nHud = hud.length;
    const onHud = (r: Rect) => {
      for (let i = 0; i < nHud; i++) if (overlaps(r, placed[i]!)) return true;
      return false;
    };
    /** `r` (the rect placed last) still overlaps the HUD or another chip (settling found no free slot). */
    const collides = (r: Rect) => {
      for (let i = 0; i < placed.length - 1; i++) if (overlaps(r, placed[i]!)) return true;
      return false;
    };
    order.sort(byHoverThenY);
    const place = (r: Rect) => {
      if (r.x0 < 4) {
        r.x1 += 4 - r.x0;
        r.x0 = 4;
      }
      if (r.x1 > W - 4) {
        r.x0 -= r.x1 - (W - 4);
        r.x1 = W - 4;
      }
      if (r.y0 < 4) {
        r.y1 += 4 - r.y0;
        r.y0 = 4;
      }
      settle(r, placed, H);
      placed.push(r);
      return r;
    };
    const layout = (e: ChipEntry) => {
      const r = e.rect;
      const put = (right: boolean) => {
        const x0 = right ? e.ax + 6 : e.ax - 6 - e.w;
        r.x0 = x0;
        r.x1 = x0 + e.w;
        r.y0 = e.ay - e.h / 2;
        r.y1 = e.ay + e.h / 2;
        place(r);
      };
      put(e.right);
      if (!e.hot && collides(r)) {
        // no free slot on this side: try the other side of the device; a pinned chip that still lands on the HUD
        // or on another chip is not shown (hovering the device shows it)
        placed.pop();
        put(!e.right);
        if (collides(r)) {
          placed.pop();
          e.el.style.opacity = '0';
          e.line.style.display = 'none';
          e.dot.style.display = 'none';
          return;
        }
      }
      if (Math.abs(r.x0 - e.x) > 0.4 || Math.abs(r.y0 - e.y) > 0.4) {
        e.x = r.x0;
        e.y = r.y0;
        e.el.style.transform = `translate(${Math.round(r.x0)}px,${Math.round(r.y0)}px)`;
      }
      // leader: from the chip side facing the device to the device
      const lx = e.tx >= (r.x0 + r.x1) / 2 ? r.x1 : r.x0;
      const ly = Math.min(Math.max(e.ty, r.y0 + 4), r.y1 - 4);
      e.line.setAttribute('x1', lx.toFixed(1));
      e.line.setAttribute('y1', ly.toFixed(1));
      e.line.setAttribute('x2', e.tx.toFixed(1));
      e.line.setAttribute('y2', e.ty.toFixed(1));
      e.dot.setAttribute('cx', e.tx.toFixed(1));
      e.dot.setAttribute('cy', e.ty.toFixed(1));
      const near = Math.hypot(e.tx - lx, e.ty - ly) < 6;
      e.line.style.display = near ? 'none' : '';
      e.dot.style.display = '';
      e.el.style.opacity = '1';
    };
    for (const e of order) if (e.hot && e.mode !== 'hidden') layout(e);
    for (const g of reg.groups.values()) {
      if (!g.shown) continue;
      if (!g.hasRect) {
        g.el.style.display = 'none';
        continue;
      }
      const r = place(g.rect);
      if (nHud > 0 && onHud(r)) {
        placed.pop();
        g.el.style.display = 'none';
        continue;
      }
      g.el.style.display = 'block';
      g.el.style.transform = `translate(${Math.round(r.x0)}px,${Math.round(r.y0)}px)`;
    }
    for (const e of order) if (!e.hot && e.mode !== 'hidden') layout(e);
    for (const e of order) {
      if (e.mode === 'hidden') {
        e.line.style.display = 'none';
        e.dot.style.display = 'none';
      }
    }
  });

  return <TagCtx.Provider value={reg}>{children}</TagCtx.Provider>;
}

// ---------------------------------------------------------------------------
// Hotspot
// ---------------------------------------------------------------------------

export interface IoHotspotProps {
  runtime: SimRuntime;
  /** IoPointDef.deviceId to show (all points of that device), or explicit aliases (in this order). */
  device?: string;
  aliases?: string[];
  /** Hover box size (m) and its center (parent coordinates). */
  size: Vec3;
  position?: Vec3;
  rotation?: Vec3;
  /** Chip anchor (parent coordinates); default: beside the hover box (+X side). The leader line goes to `position`. */
  anchor?: Vec3;
  /** Optional small header line, e.g. the instrument tag 'LT-101'. */
  title?: string;
  /** Extra lines shown when hovered; without I/O points the hotspot is an info chip (e.g. instructor controls). */
  info?: string[];
  /** Panel / device group label: pinned chips of a small-on-screen group collapse into one summary chip. */
  group?: string;
  /** Momentary device: the hover box forwards pointer down / up (push buttons). */
  press?: { onPress: () => void; onRelease: () => void };
  /** Click action (toggles, selectors): the hover box forwards clicks. */
  onClick?: () => void;
  children?: ReactNode;
}

/** Points of `runtime.scene.io` for a device id / alias list (stable per runtime). */
export function useIoPoints(runtime: SimRuntime, device?: string, aliases?: string[]): IoPointDef[] {
  const key = aliases?.join(',') ?? '';
  return useMemo(() => {
    const io = runtime.scene.io;
    if (aliases && aliases.length) return aliases.map((a) => io.find((p) => p.alias === a)).filter((p): p is IoPointDef => !!p);
    if (!device) return [];
    return io.filter((p) => p.deviceId === device);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.scene, device, key]);
}

const CLICK_SLOP_PX = 4;

/**
 * Hover area around a device + its I/O chip. Without `press` / `onClick` the box only hovers (clicks pass through to
 * the device underneath); with them it is the device's (larger) hit target and stops propagation.
 */
export function IoHotspot({ runtime, device, aliases, size, position = [0, 0, 0], rotation, anchor, title, info, group, press, onClick, children }: IoHotspotProps) {
  const reg = useContext(TagCtx);
  const points = useIoPoints(runtime, device, aliases);
  const anchorRef = useRef<THREE.Group>(null);
  const targetRef = useRef<THREE.Mesh>(null);
  const entryRef = useRef<ChipEntry | null>(null);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as { enabled?: boolean } | null;
  const infoKey = info?.join('\n') ?? '';
  const a: Vec3 = anchor ?? [position[0] + size[0] / 2 + 0.02, position[1], position[2]];
  const hasChip = points.length > 0 || !!info?.length;

  useEffect(() => {
    if (!reg || !hasChip || !anchorRef.current || !targetRef.current) return;
    const dom = buildEntryDom(points, title, info ?? []);
    const e: ChipEntry = {
      anchor: anchorRef.current,
      target: targetRef.current,
      points,
      title,
      info: info ?? [],
      group,
      hovered: false,
      names: points.flatMap((p) => [p.alias.toLowerCase(), p.operand.toLowerCase()]),
      hl: false,
      hot: false,
      ring: null,
      el: dom.root,
      titleEl: dom.titleEl,
      rows: dom.rows,
      infoEl: dom.infoEl,
      line: dom.line,
      dot: dom.dot,
      mode: 'hidden',
      w: 0,
      h: 0,
      x: -1e9,
      y: -1e9,
      ax: 0,
      ay: 0,
      tx: 0,
      ty: 0,
      right: true,
      dist: 0,
      occluded: false,
      last: [],
      collapsed: false,
      rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
    };
    entryRef.current = e;
    reg.add(e);
    return () => {
      reg.remove(e);
      entryRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg, points, title, infoKey, group, hasChip]);

  // momentary press forwarding (release anywhere: window listener, like the devices do)
  const pressRef = useRef(press);
  pressRef.current = press;
  const down = useRef(false);
  const release = useMemo(() => {
    const fn = () => {
      if (!down.current) return;
      down.current = false;
      window.removeEventListener('pointerup', fn);
      window.removeEventListener('blur', fn);
      if (controls && 'enabled' in controls) controls.enabled = true;
      pressRef.current?.onRelease();
    };
    return fn;
  }, [controls]);
  useEffect(() => () => release(), [release]);
  const interactive = !!press || !!onClick;

  return (
    <>
      <mesh
        ref={targetRef}
        geometry={unitBox}
        material={hitMaterial()}
        position={position}
        rotation={rotation}
        scale={size}
        userData={{ noOcclude: true }}
        onPointerOver={() => {
          if (entryRef.current) entryRef.current.hovered = true;
          if (interactive) gl.domElement.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          if (entryRef.current) entryRef.current.hovered = false;
          if (interactive) gl.domElement.style.cursor = '';
        }}
        onPointerDown={
          press
            ? (e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                if (e.button !== 0 || down.current) return;
                down.current = true;
                if (controls && 'enabled' in controls) controls.enabled = false;
                window.addEventListener('pointerup', release);
                window.addEventListener('blur', release);
                press.onPress();
              }
            : undefined
        }
        onPointerUp={
          press
            ? (e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                release();
              }
            : undefined
        }
        onClick={
          onClick
            ? (e: ThreeEvent<MouseEvent>) => {
                if (e.button !== 0 || e.delta > CLICK_SLOP_PX) return;
                e.stopPropagation();
                onClick();
              }
            : press
              ? (e: ThreeEvent<MouseEvent>) => e.stopPropagation()
              : undefined
        }
      />
      <group ref={anchorRef} position={a} />
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Glow sprite (lit lamps / tiers readable from far away)
// ---------------------------------------------------------------------------

let glowTex: THREE.CanvasTexture | null = null;
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/**
 * Additive halo around a lamp / stack-light tier / heater that is ON — keeps the state readable from the overview
 * camera (a lit 22 mm lens is only a few pixels there). Scales up slightly with camera distance. For lamp DEVICES
 * (800F / 855T / 856T), which bloom on their own up close, pass `fadeInFrom` (m): the halo is invisible nearer than
 * that and fades in over the next 60 % of the distance, so it only acts as a far-view readability cue.
 */
export function Glow({
  get,
  color,
  position,
  size = 0.12,
  intensity = 1.6,
  flash = false,
  grow = 0.05,
  fadeInFrom = 0,
}: {
  get: () => boolean | number;
  color: string;
  position: Vec3;
  size?: number;
  intensity?: number;
  flash?: boolean;
  grow?: number;
  fadeInFrom?: number;
}) {
  const ref = useRef<THREE.Sprite>(null);
  const mat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: new THREE.Color(color).multiplyScalar(intensity),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        opacity: 0,
      }),
    [color, intensity],
  );
  useDisposeOnUnmount(mat);
  useFrame(({ camera, clock }) => {
    const s = ref.current;
    if (!s) return;
    const v = get();
    let k = typeof v === 'number' ? v : v ? 1 : 0;
    if (flash && k > 0) k *= Math.sin(clock.elapsedTime * Math.PI * 3) > 0 ? 1 : 0.15;
    s.getWorldPosition(_v);
    const d = _v.distanceTo(camera.position);
    if (fadeInFrom > 0) k *= THREE.MathUtils.clamp((d - fadeInFrom) / (0.6 * fadeInFrom), 0, 1);
    s.visible = k > 0.01;
    if (!s.visible) return;
    mat.opacity = Math.min(1, k);
    const sc = size * (1 + grow * Math.max(0, d - 2));
    s.scale.set(sc, sc, sc);
  });
  return <sprite ref={ref} material={mat} position={position} visible={false} renderOrder={6} raycast={() => {}} />;
}

// ---------------------------------------------------------------------------
// Frame helpers & audio
// ---------------------------------------------------------------------------

/** useFrame callback throttled to `hz` (default 15 Hz). */
export function useThrottledFrame(fn: (state: RootState, dt: number) => void, hz = 15) {
  const acc = useRef(0);
  useFrame((state, dt) => {
    acc.current += dt;
    if (acc.current < 1 / hz) return;
    const d = acc.current;
    acc.current = 0;
    fn(state, d);
  });
}

/** Sound is only produced after the user interacted with the page (browser autoplay policy, no console noise). */
export function audioAllowed(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

/** Play a one-shot effect if audio is allowed. */
export function playSfx(name: SfxName) {
  if (audioAllowed()) sfx.play(name);
}

/**
 * Drive continuous loops from scene state (~12 Hz). `getLevels` returns the intensity per loop (0 = off).
 * Loops are silenced on unmount.
 */
export function useSceneLoops(names: LoopName[], getLevels: (out: Record<string, number>) => void) {
  const levels = useRef<Record<string, number>>({});
  const key = names.join(',');
  useThrottledFrame(() => {
    if (!audioAllowed()) return;
    const l = levels.current;
    for (const n of names) l[n] = 0;
    getLevels(l);
    for (const n of names) sfx.setLoop(n, l[n] ?? 0);
  }, 12);
  useEffect(
    () => () => {
      for (const n of key.split(',')) sfx.setLoop(n as LoopName, 0);
    },
    [key],
  );
}

/** Edge detector for one-shot sounds: calls `onChange(value)` when `get()` changes (checked ~30 Hz). */
export function useEdge<T>(get: () => T, onChange: (value: T, prev: T) => void) {
  const prev = useRef<T | undefined>(undefined);
  useThrottledFrame(() => {
    const v = get();
    if (prev.current === undefined) {
      prev.current = v;
      return;
    }
    if (v !== prev.current) {
      const p = prev.current;
      prev.current = v;
      onChange(v, p);
    }
  }, 30);
}

// ---------------------------------------------------------------------------
// Shadow budget
// ---------------------------------------------------------------------------

/**
 * Turns off `castShadow` on small meshes (screws, LEDs, terminals, labels...) under `root` so the shadow pass
 * only draws parts whose shadow is actually visible. Runs a few times after mount (devices mount lazily).
 */
export function ShadowBudget({ minRadius = 0.07 }: { minRadius?: number }) {
  const scene = useThree((s) => s.scene);
  const passes = useRef(0);
  const next = useRef(0.5);
  useFrame(({ clock }) => {
    if (passes.current >= 4 || clock.elapsedTime < next.current) return;
    passes.current++;
    next.current = clock.elapsedTime + 1.5;
    const s = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      const g = m.geometry as THREE.BufferGeometry | undefined;
      if (!g || !g.attributes.position) return;
      if ((o as THREE.InstancedMesh).isInstancedMesh) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      m.getWorldScale(s);
      const r = (g.boundingSphere?.radius ?? 0) * Math.max(s.x, s.y, s.z);
      if (r < minRadius) m.castShadow = false;
    });
  });
  return null;
}
