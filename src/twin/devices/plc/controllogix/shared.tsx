/**
 * Shared building blocks for the ControlLogix 1756 twins: cached geometries & canvas textures,
 * instanced point LEDs, bi-color status LEDs, the 4-character dot-matrix display, RJ45/USB jacks,
 * screws and the selectable/highlight wrapper.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, LED_HEX, Led, materials, type LedColor, type LedMode } from '../../../common';
import type { Vec3 } from '../../../contracts';
import { glyphColumn, glyphColumns } from './font5x7';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Module-level geometry cache (geometries are shared by every instance of a device). */
export function cachedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Rounded box centered at the origin (cached). */
export function roundedBox(w: number, h: number, d: number, r = 0.001, seg = 2): THREE.BufferGeometry {
  return cachedGeo(`rb:${w}:${h}:${d}:${r}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)));
}

/** New (uncached) box translated to a center point — for merging. */
export function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** New (uncached) rounded box translated to a center point — for merging. */
export function rboxAt(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.0008): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5)).translate(x, y, z);
}

/** Cylinder whose axis points along +Z, centered at (x,y,z). */
export function cylZ(r: number, len: number, x: number, y: number, z: number, seg = 20, r2 = r): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r2, r, len, seg).rotateX(Math.PI / 2).translate(x, y, z);
}

/** Merge geometries (all converted to non-indexed, uv/normal/color attributes normalized). */
export function merge(geos: THREE.BufferGeometry[], withColor = false): THREE.BufferGeometry {
  const prepared = geos.map((g) => {
    let n = g.index ? g.toNonIndexed() : g;
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    if (!n.getAttribute('uv')) {
      n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2));
    }
    if (!withColor && n.getAttribute('color')) {
      n = n.clone();
      n.deleteAttribute('color');
    }
    for (const name of Object.keys(n.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') n.deleteAttribute(name);
    }
    n.morphAttributes = {};
    return n;
  });
  const out = mergeGeometries(prepared, false);
  if (!out) throw new Error('controllogix: mergeGeometries failed');
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Paint a whole geometry with one vertex color (for vertex-colored merged meshes). */
export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const count = n.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  n.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return n;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const matCache = new Map<string, THREE.Material>();
function cachedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/**
 * Low-contrast mottled roughness map (~0.28-0.42) for zinc-plated sheet steel. UVs of the extruded chassis
 * plates are in meters, so the texture repeats every 0.125 m.
 */
function zincRoughnessMap(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const base = Math.round(0.35 * 255);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  let seed = 0x2545f491;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // soft blotches (plating variation) — drawn with wrap-around so the texture tiles seamlessly
  for (let i = 0; i < 140; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 6 + rnd() * 22;
    const v = Math.round((0.28 + rnd() * 0.14) * 255);
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        g.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
  }
  // fine grain
  for (let i = 0; i < 9000; i++) {
    const v = Math.round((0.3 + rnd() * 0.1) * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export const MAT = {
  /** 1756 module housings: dark charcoal, slightly textured plastic. */
  body: () => materials.plastic(COLORS.moduleBlack, 0.62),
  face: () => materials.plastic('#232428', 0.55),
  darkPlastic: () => materials.plastic('#0d0e10', 0.7),
  /** Zinc-plated (clear-chromated) steel of the 1756 chassis: cool metallic sheen with a faint mottled finish. */
  steel: () =>
    cachedMat('clx:zinc', () => {
      const m = new THREE.MeshStandardMaterial({
        color: '#b8c0c7',
        roughness: 1,
        metalness: 0.8,
        roughnessMap: zincRoughnessMap(),
      });
      // closed sheet-metal solids: render shadow-map depth from back faces to avoid acne on the plates
      m.shadowSide = THREE.BackSide;
      return m;
    }),
  steelDark: () =>
    cachedMat('clx:zincDark', () => new THREE.MeshStandardMaterial({ color: '#9aa1a8', roughness: 0.45, metalness: 0.6 })),
  nickel: () =>
    cachedMat('clx:nickel', () => new THREE.MeshStandardMaterial({ color: '#dfe2e5', roughness: 0.28, metalness: 0.7 })),
  brass: () => cachedMat('clx:brass', () => new THREE.MeshStandardMaterial({ color: '#d0b264', roughness: 0.32, metalness: 0.7 })),
  guide: () => materials.plastic('#3a3d42', 0.6),
  vertexColored: () =>
    cachedMat('clx:vcol', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 })),
  vertexColoredGloss: () =>
    cachedMat('clx:vcolGloss', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 })),
  hole: () => cachedMat('clx:hole', () => new THREE.MeshBasicMaterial({ color: '#050506' })),
  /** Glossy dark-red filter lens in front of the dot-matrix displays. */
  displayGlass: () =>
    cachedMat(
      'clx:glass',
      () =>
        new THREE.MeshStandardMaterial({
          color: '#1a0302',
          roughness: 0.05,
          metalness: 0.1,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          ...OVERLAY_OFFSET,
        }),
    ),
  /** Smoked, glossy light-pipe window over indicator blocks (catches reflections, dims unlit LEDs). */
  smokedLens: () =>
    cachedMat(
      'clx:smoked',
      () =>
        new THREE.MeshStandardMaterial({
          color: '#050506',
          roughness: 0.08,
          metalness: 0.2,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          ...OVERLAY_OFFSET,
        }),
    ),
  clearPlastic: () =>
    cachedMat(
      'clx:clear',
      () => new THREE.MeshStandardMaterial({ color: '#dfe6ea', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55 }),
    ),
  invisible: () => cachedMat('clx:invisible', () => new THREE.MeshBasicMaterial({ visible: false })),
};

/**
 * Decals (front art, labels) sit 0.1-0.3 mm in front of the surface they are printed on. polygonOffset pulls
 * them forward in depth so they never z-fight with it, even at 5-10 m with the app camera's near = 0.02.
 */
export const DECAL_OFFSET = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 } as const;
/** Parts that sit on top of decals (LED lenses, display windows) get a stronger offset. */
export const OVERLAY_OFFSET = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 } as const;

const texMatCache = new WeakMap<THREE.Texture, THREE.MeshStandardMaterial>();
/** Opaque label/front-art material for a canvas texture (cached per texture). */
export function texMaterial(tex: THREE.Texture, transparent = false): THREE.MeshStandardMaterial {
  let m = texMatCache.get(tex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.62,
      metalness: 0.02,
      transparent,
      alphaTest: transparent ? 0.02 : 0,
      ...DECAL_OFFSET,
    });
    texMatCache.set(tex, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Canvas textures (front art)
// ---------------------------------------------------------------------------

const canvasCache = new Map<string, THREE.CanvasTexture>();

/** Cached canvas texture drawn once with `draw`. */
export function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const hit = canvasCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(width));
  canvas.height = Math.max(4, Math.round(height));
  const ctx = canvas.getContext('2d')!;
  draw(ctx, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  canvasCache.set(key, tex);
  return tex;
}

export const FONT = 'Inter Variable, Inter, Arial, Helvetica, sans-serif';
export const FONT_COND = '"Arial Narrow", "Roboto Condensed", Inter Variable, Arial, sans-serif';

/**
 * Maps a rectangle of module-local meters onto a canvas so front art can be drawn with the exact
 * same coordinates the 3D parts (LEDs, jacks) use.
 */
export class Art {
  readonly sx: number;
  readonly sy: number;
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly x0: number,
    readonly x1: number,
    readonly y0: number,
    readonly y1: number,
    readonly w: number,
    readonly h: number,
  ) {
    this.sx = w / (x1 - x0);
    this.sy = h / (y1 - y0);
  }
  px(x: number): number {
    return (x - this.x0) * this.sx;
  }
  py(y: number): number {
    return (this.y1 - y) * this.sy;
  }
  /** meters -> pixels (horizontal scale). */
  m(v: number): number {
    return v * this.sx;
  }
  /**
   * Draw text at module-local (x, y). `maxWidth` (meters) shrinks the font (down to 70 %) and then
   * condenses the glyphs so the text never runs into neighbouring art.
   */
  text(
    s: string,
    x: number,
    y: number,
    sizeM: number,
    opts: { color?: string; weight?: number | string; align?: CanvasTextAlign; font?: string; rotate?: number; maxWidth?: number } = {},
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = opts.color ?? '#e9e9e4';
    let px = Math.max(1, sizeM * this.sy);
    const family = opts.font ?? FONT;
    ctx.font = `${opts.weight ?? 600} ${px}px ${family}`;
    let maxPx: number | undefined;
    if (opts.maxWidth !== undefined) {
      maxPx = Math.max(1, opts.maxWidth * this.sx);
      const w = ctx.measureText(s).width;
      if (w > maxPx) {
        px = Math.max(px * 0.7, (px * maxPx) / w);
        ctx.font = `${opts.weight ?? 600} ${px}px ${family}`;
      }
    }
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(this.px(x), this.py(y));
    if (opts.rotate) ctx.rotate(opts.rotate);
    if (maxPx !== undefined) ctx.fillText(s, 0, 0, maxPx);
    else ctx.fillText(s, 0, 0);
    ctx.restore();
  }
  rect(x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lineM = 0.0002, radiusM = 0): void {
    const { ctx } = this;
    const X = this.px(x - w / 2);
    const Y = this.py(y + h / 2);
    const W = this.m(w);
    const H = h * this.sy;
    ctx.beginPath();
    if (radiusM > 0) ctx.roundRect(X, Y, W, H, radiusM * this.sx);
    else ctx.rect(X, Y, W, H);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, lineM * this.sx);
      ctx.stroke();
    }
  }
  line(xa: number, ya: number, xb: number, yb: number, color: string, lineM = 0.0002): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(this.px(xa), this.py(ya));
    ctx.lineTo(this.px(xb), this.py(yb));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, lineM * this.sx);
    ctx.stroke();
  }
  /** Subtle plastic grain / vertical gradient so faces don't look flat. */
  plastic(base: string, noise = 6): void {
    const { ctx, w, h } = this;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.035)');
    g.addColorStop(1, 'rgba(0,0,0,0.05)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (noise > 0) {
      // deterministic speckle (mulberry32 — avoids the column artifacts of a plain LCG)
      let seed = 0x9e3779b9;
      const rnd = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const n = Math.floor((w * h) / 90);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(rnd() * w);
        const y = Math.floor(rnd() * h);
        ctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${noise / 1000})` : `rgba(0,0,0,${noise / 600})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
}

/** Plane mesh with a canvas texture spanning a module-local rectangle, facing +Z at depth `z`. */
export function ArtPlane({
  tex,
  x0,
  x1,
  y0,
  y1,
  z,
  transparent = false,
}: {
  tex: THREE.Texture;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z: number;
  transparent?: boolean;
}) {
  const geo = cachedGeo(`plane:${(x1 - x0).toFixed(5)}:${(y1 - y0).toFixed(5)}`, () => new THREE.PlaneGeometry(x1 - x0, y1 - y0));
  return <mesh geometry={geo} material={texMaterial(tex, transparent)} position={[(x0 + x1) / 2, (y0 + y1) / 2, z]} />;
}

// ---------------------------------------------------------------------------
// LEDs
// ---------------------------------------------------------------------------

/** States of the bi-color status indicators on 1756 modules. */
export type StatusLedState =
  | 'off'
  | 'green'
  | 'red'
  | 'amber'
  | 'yellow'
  | 'flashing-green'
  | 'flashing-red'
  | 'flashing-amber'
  | 'flashing-yellow';

type LitColor = 'green' | 'red' | 'amber' | 'yellow';

const COLOR_OF: Record<StatusLedState, LitColor> = {
  off: 'green',
  green: 'green',
  red: 'red',
  amber: 'amber',
  yellow: 'yellow',
  'flashing-green': 'green',
  'flashing-red': 'red',
  'flashing-amber': 'amber',
  'flashing-yellow': 'yellow',
};

/**
 * Lit LED colours in LINEAR space (rendered with toneMapped = false). Only the dominant channel exceeds 1,
 * so the on-screen hue stays saturated (green stays green, amber stays amber) while the luminance is high
 * enough (> 1) for the Bloom pass to add the glow.
 */
export const LED_LIT: Record<LitColor, THREE.Color> = {
  green: new THREE.Color(0.02, 1.8, 0.05),
  red: new THREE.Color(6.0, 0.05, 0.03),
  amber: new THREE.Color(4.4, 0.33, 0.0),
  yellow: new THREE.Color(3.0, 0.72, 0.0),
};

/** Unlit lens albedo: near-black light pipe with a trace of the LED tint. */
function offAlbedo(c: LitColor): THREE.Color {
  const l = LED_LIT[c];
  const m = Math.max(l.r, l.g, l.b);
  return new THREE.Color(0.0037, 0.004, 0.0037).add(new THREE.Color(l.r / m, l.g / m, l.b / m).multiplyScalar(0.006));
}

const statusLedGeoCache = new Map<string, THREE.BufferGeometry>();

/**
 * Bi-color status indicator driven by a state getter. Own material: glossy near-black lens when off,
 * saturated emissive colour when lit ('flashing-*' blink at 1 Hz).
 */
export function StatusLed({
  get,
  position,
  size = [0.0026, 0.0016, 0.0004],
  offColor = 'green',
}: {
  get: () => StatusLedState;
  position: Vec3;
  size?: [number, number, number];
  offColor?: LitColor;
}) {
  const key = size.join(':');
  let geo = statusLedGeoCache.get(key);
  if (!geo) {
    geo = new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(0.00025, size[2] / 2 - 1e-5));
    statusLedGeoCache.set(key, geo);
  }
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: offAlbedo(offColor),
        roughness: 0.22,
        metalness: 0,
        emissive: '#000000',
        toneMapped: false,
        ...OVERLAY_OFFSET,
      }),
    [offColor],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const shown = useRef<StatusLedState | null>(null);
  useFrame(({ clock }) => {
    const s = get();
    let lit = s !== 'off';
    if (lit && s.charCodeAt(0) === 102 /* 'f'lashing */) lit = Math.floor(clock.elapsedTime * 2) % 2 === 0;
    const next: StatusLedState = lit ? s : 'off';
    if (next === shown.current) return;
    shown.current = next;
    if (lit) mat.emissive.copy(LED_LIT[COLOR_OF[s]]);
    else mat.emissive.setRGB(0, 0, 0);
  });
  return <mesh geometry={geo} material={mat} position={position} />;
}

const pointLedMat = new THREE.MeshBasicMaterial({ toneMapped: false, ...OVERLAY_OFFSET });
const _m4 = new THREE.Matrix4();

/**
 * Many small single-color status LEDs in ONE draw call (instanced). `get(i)` is read every frame;
 * instance colors are only re-uploaded when a state changes. Unlit points are near-black so the on/off
 * contrast (what learners read) is unmistakable.
 */
export function PointLeds({
  positions,
  z,
  size = [0.0022, 0.0015, 0.0004],
  color,
  get,
}: {
  positions: ReadonlyArray<readonly [number, number]>;
  z: number;
  size?: [number, number, number];
  color: LitColor;
  get: (i: number) => boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = positions.length;
  const geo = cachedGeo(`led:${size.join(':')}`, () => new THREE.BoxGeometry(size[0], size[1], size[2]));
  const state = useMemo(() => new Int8Array(count).fill(-1), [count]);
  const lit = LED_LIT[color];
  const dim = useMemo(() => offAlbedo(color).multiplyScalar(1.6), [color]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < count; i++) {
      const p = positions[i]!;
      _m4.makeTranslation(p[0], p[1], z);
      mesh.setMatrixAt(i, _m4);
      mesh.setColorAt(i, dim);
      state[i] = 0;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [positions, z, count, dim, state]);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    let changed = false;
    for (let i = 0; i < count; i++) {
      const v = get(i) ? 1 : 0;
      if (state[i] !== v) {
        state[i] = v;
        mesh.setColorAt(i, v ? lit : dim);
        changed = true;
      }
    }
    if (changed && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, pointLedMat, count]} frustumCulled={false} />;
}

/** Smoked light-pipe window over an indicator block (w x h meters, centered at `position`, facing +Z). */
export function SmokedLens({ w, h, position }: { w: number; h: number; position: Vec3 }) {
  const geo = cachedGeo(`plane:${w.toFixed(5)}:${h.toFixed(5)}`, () => new THREE.PlaneGeometry(w, h));
  return <mesh geometry={geo} material={MAT.smokedLens()} position={position} raycast={() => null} />;
}

// ---------------------------------------------------------------------------
// 4-character dot-matrix display
// ---------------------------------------------------------------------------

/** Red-orange LED dot-matrix color of the 1756 status displays. */
export const DISPLAY_COLOR = '#ff5a1f';

const DISPLAY_CANVAS_W = 256;
const DISPLAY_CANVAS_H = 80;

export interface DotMatrixDisplayProps {
  /** Text to show; longer than 4 characters scrolls. Empty string = display blank (unpowered). */
  getText: () => string;
  /** Visible window size (meters). */
  width: number;
  height: number;
  position: Vec3;
  color?: string;
  /** Seconds per scroll step. */
  step?: number;
}

/** A 4-character 5x7 LED dot-matrix display (like the HDSP displays on 1756-L8x / 1756-EN2T). */
export function DotMatrixDisplay({ getText, width, height, position, color = DISPLAY_COLOR, step = 0.26 }: DotMatrixDisplayProps) {
  const { ctx, tex, mat } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = DISPLAY_CANVAS_W;
    canvas.height = DISPLAY_CANVAS_H;
    const c = canvas.getContext('2d')!;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    m.color.setScalar(2.6);
    return { ctx: c, tex: t, mat: m };
  }, []);
  const st = useRef({ text: null as string | null, offset: -1, t0: 0 });
  const colors = useMemo(() => {
    const lit = new THREE.Color(color);
    const dim = lit.clone().multiplyScalar(0.07);
    return { lit: `#${lit.getHexString()}`, dim: `#${dim.getHexString()}` };
  }, [color]);

  useLayoutEffect(
    () => () => {
      tex.dispose();
      mat.dispose();
    },
    [tex, mat],
  );

  useFrame(({ clock }) => {
    const text = getText() ?? '';
    const t = clock.elapsedTime;
    const s = st.current;
    if (text !== s.text) {
      s.text = text;
      s.t0 = t;
      s.offset = -1;
    }
    let offset = 0;
    if (text.length > 4) {
      const steps = Math.floor((t - s.t0) / step);
      const cycle = text.length + 3;
      offset = steps < 4 ? 0 : (steps - 4) % cycle;
    }
    if (offset === s.offset) return;
    s.offset = offset;
    // draw
    const W = DISPLAY_CANVAS_W;
    const H = DISPLAY_CANVAS_H;
    ctx.fillStyle = '#080404';
    ctx.fillRect(0, 0, W, H);
    const cellW = 62;
    const pitch = 10;
    const x0 = (W - cellW * 4 + (cellW - 5 * pitch)) / 2;
    const y0 = (H - 7 * pitch) / 2;
    const r = 3.7;
    const cycle = text.length + 3;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? colors.dim : colors.lit;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const idx = text.length > 4 ? (offset + k) % cycle : k;
        const ch = idx < text.length ? text.charAt(idx) : ' ';
        const go = glyphColumns(ch);
        for (let c = 0; c < 5; c++) {
          const bits = glyphColumn(go, c);
          for (let row = 0; row < 7; row++) {
            const on = (bits >> row) & 1;
            if (on !== pass) continue;
            const cx = x0 + k * cellW + c * pitch + pitch / 2;
            const cy = y0 + row * pitch + pitch / 2;
            ctx.moveTo(cx + r, cy);
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
          }
        }
      }
      ctx.fill();
    }
    tex.needsUpdate = true;
  });

  const geo = cachedGeo(`plane:${width.toFixed(5)}:${height.toFixed(5)}`, () => new THREE.PlaneGeometry(width, height));
  return (
    <group position={position}>
      <mesh geometry={geo} material={mat} />
      <mesh geometry={geo} material={MAT.displayGlass()} position={[0, 0, 0.0006]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

function drawRj45Face(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // metal shield frame
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#d7dadd');
  g.addColorStop(1, '#9ea3a8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // opening
  const ox = w * 0.1;
  const oy = h * 0.14;
  const ow = w * 0.8;
  const oh = h * 0.62;
  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(ox, oy, ow, oh);
  // latch notch (bottom)
  ctx.fillRect(w * 0.34, oy + oh - 1, w * 0.32, h * 0.16);
  // gold contacts at the top of the opening
  ctx.fillStyle = '#d8b04a';
  for (let i = 0; i < 8; i++) {
    const x = ox + ow * 0.12 + i * (ow * 0.76) / 7;
    ctx.fillRect(x - 1.5, oy + 2, 3, oh * 0.28);
  }
  // shield spring tabs
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(w * 0.08, h * 0.86, w * 0.12, h * 0.06);
  ctx.fillRect(w * 0.8, h * 0.86, w * 0.12, h * 0.06);
}

/** Shielded RJ45 jack. Origin = center of the jack face; the jack faces +Z. */
export function Rj45Jack({ position, rotation }: { position?: Vec3; rotation?: Vec3 }) {
  const tex = canvasTexture('rj45face', 96, 84, drawRj45Face);
  const body = cachedGeo('rj45body', () => new THREE.BoxGeometry(0.0158, 0.0138, 0.014).translate(0, 0, -0.0071));
  const face = cachedGeo('rj45face', () => new THREE.PlaneGeometry(0.0158, 0.0138));
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={body} material={MAT.steelDark()} />
      <mesh geometry={face} material={texMaterial(tex)} position={[0, 0, 0.0002]} />
    </group>
  );
}

function drawUsbBFace(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#b9bec3';
  ctx.fillRect(0, 0, w, h);
  // USB-B outline: square with chamfered top corners
  const m = w * 0.1;
  ctx.fillStyle = '#0a0a0b';
  ctx.beginPath();
  ctx.moveTo(m + w * 0.16, m);
  ctx.lineTo(w - m - w * 0.16, m);
  ctx.lineTo(w - m, m + h * 0.16);
  ctx.lineTo(w - m, h - m);
  ctx.lineTo(m, h - m);
  ctx.lineTo(m, m + h * 0.16);
  ctx.closePath();
  ctx.fill();
  // tongue
  ctx.fillStyle = '#e8e8e2';
  ctx.fillRect(w * 0.3, h * 0.3, w * 0.4, h * 0.45);
  ctx.fillStyle = '#c9a54a';
  ctx.fillRect(w * 0.32, h * 0.32, w * 0.08, h * 0.1);
  ctx.fillRect(w * 0.6, h * 0.32, w * 0.08, h * 0.1);
  ctx.fillRect(w * 0.32, h * 0.62, w * 0.08, h * 0.1);
  ctx.fillRect(w * 0.6, h * 0.62, w * 0.08, h * 0.1);
}

/** USB type-B receptacle, facing +Z. Origin = face center. */
export function UsbBPort({ position, rotation }: { position?: Vec3; rotation?: Vec3 }) {
  const tex = canvasTexture('usbbface', 64, 64, drawUsbBFace);
  const face = cachedGeo('usbbfaceGeo', () => new THREE.PlaneGeometry(0.0085, 0.0078));
  return <mesh geometry={face} material={texMaterial(tex)} position={position} rotation={rotation} />;
}

/** RJ45 patch plug + boot + cable going straight down (-Y). Origin = plug tip inside the jack (jack facing -Y). */
export function PatchCable({ position, color = '#1f63d6', length = 0.09 }: { position?: Vec3; color?: string; length?: number }) {
  const geo = cachedGeo(`patch:${length}`, () =>
    merge([
      rboxAt(0.0112, 0.012, 0.0132, 0, -0.0075, 0, 0.0015), // boot base
      new THREE.CylinderGeometry(0.0034, 0.0052, 0.012, 16).translate(0, -0.019, 0), // boot taper
      new THREE.CylinderGeometry(0.0029, 0.0029, length, 12).translate(0, -0.025 - length / 2, 0), // cable
    ]),
  );
  const plug = cachedGeo('patchplug', () => new THREE.BoxGeometry(0.0118, 0.004, 0.0082).translate(0, -0.0016, 0));
  return (
    <group position={position}>
      <mesh geometry={plug} material={MAT.clearPlastic()} />
      <mesh geometry={geo} material={materials.plastic(color, 0.5)} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Screws
// ---------------------------------------------------------------------------

/** Phillips pan-head screws facing +Z (one draw call for the heads, one for the recesses). */
export function Screws({
  points,
  radius = 0.0022,
  material,
}: {
  points: ReadonlyArray<Vec3>;
  radius?: number;
  material?: THREE.Material;
}) {
  const head = cachedGeo(`screwhead:${radius}`, () => {
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(radius, 0),
      new THREE.Vector2(radius, radius * 0.35),
      new THREE.Vector2(radius * 0.8, radius * 0.72),
      new THREE.Vector2(0, radius * 0.8),
    ];
    return new THREE.LatheGeometry(pts, 18).rotateX(Math.PI / 2);
  });
  const cross = cachedGeo(`screwcross:${radius}`, () =>
    merge([
      new THREE.BoxGeometry(radius * 1.1, radius * 0.26, radius * 0.2).translate(0, 0, radius * 0.78),
      new THREE.BoxGeometry(radius * 0.26, radius * 1.1, radius * 0.2).translate(0, 0, radius * 0.78),
    ]),
  );
  return (
    <>
      <StaticInstances geometry={head} material={material ?? MAT.nickel()} points={points} />
      <StaticInstances geometry={cross} material={MAT.hole()} points={points} />
    </>
  );
}

/** Static instanced mesh placed at points (optional per-point Z rotation). */
export function StaticInstances({
  geometry,
  material,
  points,
  rotations,
  castShadow,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  points: ReadonlyArray<Vec3>;
  rotations?: ReadonlyArray<Vec3>;
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    points.forEach((pt, i) => {
      const r = rotations?.[i];
      if (r) e.set(r[0], r[1], r[2]);
      else e.set(0, 0, 0);
      q.setFromEuler(e);
      p.set(pt[0], pt[1], pt[2]);
      _m4.compose(p, q, s);
      mesh.setMatrixAt(i, _m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [points, rotations]);
  return <instancedMesh ref={ref} args={[geometry, material, points.length]} castShadow={castShadow} />;
}

// ---------------------------------------------------------------------------
// Selection / highlight wrapper
// ---------------------------------------------------------------------------

const hiMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#38bdf8').multiplyScalar(3.2), toneMapped: false });
const hoverMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#7dd3fc').multiplyScalar(0.9), toneMapped: false });
const hiFillMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color('#38bdf8').multiplyScalar(0.5),
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

export interface SelectableProps {
  /** Envelope (meters) and center (module-local) of the outline box. */
  size: Vec3;
  center: Vec3;
  onSelect?: () => void;
  highlighted?: boolean;
  children: ReactNode;
}

/** Wraps a device: hover cursor + outline, click (pointer down/up without dragging) -> onSelect, glow outline when highlighted. */
export function Selectable({ size, center, onSelect, highlighted, children }: SelectableProps) {
  const [hovered, setHovered] = useState(false);
  const down = useRef(false);
  useCursor(hovered && !!onSelect);
  const edges = cachedGeo(`edges:${size.map((v) => v.toFixed(4)).join(':')}`, () => new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2])));
  const fill = cachedGeo(`hiFill:${size[0].toFixed(4)}:${size[1].toFixed(4)}`, () => new THREE.PlaneGeometry(size[0], size[1]));
  const handlers = onSelect
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
        },
        onPointerOut: () => {
          setHovered(false);
          down.current = false;
        },
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          down.current = true;
        },
        onPointerUp: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (down.current && e.delta < 8) onSelect();
          down.current = false;
        },
      }
    : {};
  const showOutline = highlighted || (hovered && !!onSelect);
  return (
    <group {...handlers}>
      {children}
      {showOutline && (
        <group position={center} raycast={() => null}>
          <lineSegments geometry={edges} material={highlighted ? hiMat : hoverMat} raycast={() => null} />
          {highlighted && (
            <mesh geometry={fill} material={hiFillMat} position={[0, 0, size[2] / 2 + 0.0008]} raycast={() => null} />
          )}
        </group>
      )}
    </group>
  );
}

/** Groups LED state helpers used by modules. */
export const LED_YELLOW = LED_HEX.yellow;
export const LED_GREEN = LED_HEX.green;
