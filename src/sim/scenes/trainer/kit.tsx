/**
 * Scene-composition kit shared by the `trainer` and `motor-station` views (owned by those scenes; the
 * traffic-light and parking-garage views reuse parts of it).
 *
 *  - <TagLayer> + <IoTag>: the LEARNING OVERLAY. Every wired device gets an invisible hover proxy; hovering it
 *    shows a floating chip "Start_PB · Local:1:I.Data.0 · 1" with the live tag value (clamped to the
 *    viewport). With `useSceneOverlay().showTags` on, a TagLayer with pinStyle="pill" pins compact value
 *    pills beside/below each device (never on top of another device); devices too small on screen collapse
 *    into one summary chip per TagGroup ("Switch_0..7  0100 1000"). Panel devices (`facing`) hide when seen
 *    from behind; coarse occluder boxes hide chips behind walls/cabinets. Chips are plain DOM positioned by
 *    ONE useFrame (no drei <Html>: its React root is not StrictMode-safe under React 19).
 *  - IoTag interaction: `onPress` makes the whole hover box one drag-safe click target (toggles, selectors,
 *    receives the local hit point), `momentary` makes it press/release (push buttons, RESET). The device
 *    underneath then gets no click of its own, so one physical click is exactly one action.
 *  - Control helpers (momentary / toggle / selector wiring to runtime.setControl + click sounds).
 *  - Sound helpers (throttled sfx loops driven from state, one-shots on transitions, stop on unmount).
 *  - <MergeStatic>: merges static child meshes per material after mount (fewer draw calls).
 *  - Environment props: procedural concrete / block wall / vinyl tile textures, conduit, ladder cable
 *    tray, cables, light fixtures, signs, hazard tape.
 */
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sfx, type LoopName, type SfxName } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import { filletedPath } from '../../../twin/devices/panel/Wire';
import { hitsHud, hudRects, type HudRect } from '../../../twin/hud';
import type { SimRuntime } from '../../types';
import { useSceneOverlay } from '../overlay';
import { useDisposeOnUnmount } from '../../../twin/dispose';

// ---------------------------------------------------------------------------
// Caches (geometry / material / texture shared across mounts)
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

export function kgeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export function kmat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

export function ktex<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = texCache.get(key) as T | undefined;
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

export const KBOX = () => kgeo('k:box1', () => new THREE.BoxGeometry(1, 1, 1));
export const KCYL = () => kgeo('k:cyl1', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 24));
export const KPLANE = () => kgeo('k:plane1', () => new THREE.PlaneGeometry(1, 1));

/** Common materials. */
export const km = {
  paint: (color: string, roughness = 0.55, metalness = 0.1) =>
    kmat(`k:paint:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness })),
  metal: (color: string, roughness = 0.35) => kmat(`k:metal:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.9 })),
  plastic: (color: string, roughness = 0.5) => kmat(`k:plastic:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })),
  galv: () => kmat('k:galv', () => new THREE.MeshStandardMaterial({ color: '#b9bec2', roughness: 0.42, metalness: 0.85 })),
  emissive: (color: string, intensity = 2) =>
    kmat(`k:emi:${color}:${intensity}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, toneMapped: false, roughness: 0.4 })),
  basic: (color: string) => kmat(`k:basic:${color}`, () => new THREE.MeshBasicMaterial({ color })),
  label: (tex: THREE.Texture, roughness = 0.6, transparent = false) =>
    kmat(
      `k:label:${tex.uuid}:${roughness}:${transparent}`,
      () => new THREE.MeshStandardMaterial({ map: tex, roughness, metalness: 0, transparent, polygonOffset: true, polygonOffsetFactor: -2 }),
    ),
};

// ---------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CanvasTexOpts {
  repeat?: boolean;
  /** Color texture (sRGB). Default true. */
  color?: boolean;
  anisotropy?: number;
}

/** Cached canvas texture; `draw` receives a 2D context of `w`×`h` pixels. */
export function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: CanvasTexOpts = {}) {
  return ktex(`k:tex:${key}`, () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    if (opts.color !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = opts.anisotropy ?? 8;
    if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  });
}

/** A repeat-wrapped clone of a cached texture with its own repeat (cached per repeat). */
export function repeatedTexture(base: THREE.Texture, rx: number, ry: number): THREE.Texture {
  return ktex(`k:rep:${base.uuid}:${rx.toFixed(3)}:${ry.toFixed(3)}`, () => {
    const t = base.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  });
}

export const FONT = 'Inter Variable, Inter, Arial, Helvetica, sans-serif';
export const MONO = 'JetBrains Mono, ui-monospace, Menlo, monospace';

/** Sealed plant-floor concrete (4 m tile with saw-cut joints along two edges). */
export function concreteTexture() {
  return canvasTexture(
    'concrete',
    1024,
    1024,
    (ctx, w, h) => {
      const rnd = mulberry(4242);
      ctx.fillStyle = '#8f8d88';
      ctx.fillRect(0, 0, w, h);
      // large soft tonal variation
      for (let i = 0; i < 70; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const r = 60 + rnd() * 220;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const dark = rnd() < 0.55;
        g.addColorStop(0, dark ? `rgba(60,58,54,${0.05 + rnd() * 0.08})` : `rgba(190,188,182,${0.04 + rnd() * 0.07})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      // aggregate speckle
      for (let i = 0; i < 26000; i++) {
        const v = 90 + Math.floor(rnd() * 90);
        ctx.fillStyle = `rgba(${v},${v - 2},${v - 5},${0.25 + rnd() * 0.35})`;
        const s = rnd() < 0.9 ? 1 : 2;
        ctx.fillRect(rnd() * w, rnd() * h, s, s);
      }
      // tire marks / scuffs
      ctx.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        ctx.strokeStyle = `rgba(35,35,35,${0.04 + rnd() * 0.05})`;
        ctx.lineWidth = 6 + rnd() * 14;
        ctx.beginPath();
        const x = rnd() * w;
        const y = rnd() * h;
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + rnd() * 300 - 150, y + rnd() * 300, x + rnd() * 400 - 200, y + 300 + rnd() * 200, x + rnd() * 300 - 150, y + 500);
        ctx.stroke();
      }
      // hairline cracks
      ctx.strokeStyle = 'rgba(40,38,36,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        let x = rnd() * w;
        let y = rnd() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 14; k++) {
          x += rnd() * 30 - 15;
          y += 8 + rnd() * 16;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // saw-cut control joints (every tile edge)
      ctx.fillStyle = 'rgba(30,29,27,0.75)';
      ctx.fillRect(0, 0, w, 3);
      ctx.fillRect(0, 0, 3, h);
      ctx.fillStyle = 'rgba(200,198,192,0.35)';
      ctx.fillRect(0, 3, w, 1);
      ctx.fillRect(3, 0, 1, h);
    },
    { repeat: true },
  );
}

/** Painted concrete-block (CMU) wall: 4 m × 2 m tile, 400 × 200 mm blocks, running bond; near-white (tint with color). */
export function blockWallTexture() {
  return canvasTexture(
    'cmu',
    1024,
    512,
    (ctx, w, h) => {
      const rnd = mulberry(77);
      ctx.fillStyle = '#f1f1ef';
      ctx.fillRect(0, 0, w, h);
      const bw = w / 10;
      const bh = h / 10;
      for (let r = 0; r < 10; r++) {
        const off = r % 2 ? bw / 2 : 0;
        for (let c = -1; c < 11; c++) {
          const v = 232 + Math.floor(rnd() * 16);
          ctx.fillStyle = `rgb(${v},${v},${v - 1})`;
          ctx.fillRect(c * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
        }
      }
      // paint texture
      for (let i = 0; i < 16000; i++) {
        const v = 200 + Math.floor(rnd() * 50);
        ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
        ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
      }
      // mortar joints (tooled, slightly darker)
      ctx.fillStyle = 'rgba(150,150,148,0.9)';
      for (let r = 0; r <= 10; r++) ctx.fillRect(0, r * bh - 1.5, w, 3);
      for (let r = 0; r < 10; r++) {
        const off = r % 2 ? bw / 2 : 0;
        for (let c = 0; c <= 10; c++) ctx.fillRect(c * bw + off - 1.5, r * bh, 3, bh);
      }
    },
    { repeat: true },
  );
}

/** Speckled vinyl composition tile floor: 1.2 m tile = 4 × 4 tiles of 300 mm. */
export function vinylTileTexture() {
  return canvasTexture(
    'vct',
    1024,
    1024,
    (ctx, w, h) => {
      const rnd = mulberry(9);
      const n = 4;
      const s = w / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const tone = (i + j) % 2 ? '#c9c6bd' : '#d3d0c8';
          ctx.fillStyle = tone;
          ctx.fillRect(i * s, j * s, s, s);
        }
      for (let k = 0; k < 30000; k++) {
        const pick = rnd();
        ctx.fillStyle = pick < 0.5 ? 'rgba(120,118,110,0.35)' : pick < 0.8 ? 'rgba(245,244,240,0.5)' : 'rgba(90,100,110,0.3)';
        const sz = rnd() < 0.85 ? 2 : 3;
        ctx.fillRect(rnd() * w, rnd() * h, sz, rnd() * 6 + 1);
      }
      ctx.fillStyle = 'rgba(80,78,72,0.45)';
      for (let i = 0; i <= n; i++) {
        ctx.fillRect(i * s - 1, 0, 2, h);
        ctx.fillRect(0, i * s - 1, w, 2);
      }
    },
    { repeat: true },
  );
}

/** Subtle painted drywall / plaster noise (near-white, tint with material color). */
export function plasterTexture() {
  return canvasTexture(
    'plaster',
    512,
    512,
    (ctx, w, h) => {
      const rnd = mulberry(5);
      ctx.fillStyle = '#f4f4f2';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 12000; i++) {
        const v = 215 + Math.floor(rnd() * 40);
        ctx.fillStyle = `rgba(${v},${v},${v},0.3)`;
        ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
    },
    { repeat: true },
  );
}

/** Yellow/black 45° hazard stripes (repeat along U). */
export function hazardTexture() {
  return canvasTexture(
    'hazard',
    256,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = '#f2c200';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#161616';
      for (let x = -h; x < w + h; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + 32, h);
        ctx.lineTo(x + 32 + h, 0);
        ctx.lineTo(x + h, 0);
        ctx.closePath();
        ctx.fill();
      }
    },
    { repeat: true },
  );
}

/** Draw a panel face (silk-screen) into one texture. `m(v)` converts meters to pixels. Origin = top-left. */
export function panelTexture(key: string, wM: number, hM: number, pxPerM: number, draw: (ctx: CanvasRenderingContext2D, m: (v: number) => number, w: number, h: number) => void) {
  const w = Math.round(wM * pxPerM);
  const h = Math.round(hM * pxPerM);
  return canvasTexture(`panel:${key}`, w, h, (ctx) => draw(ctx, (v) => v * pxPerM, w, h));
}

/** Set `ctx.font` to the largest size ≤ `px` at which `text` fits in `maxW` pixels; returns the size. */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number, weight: number | string = 800, family = FONT): number {
  let size = px;
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size = Math.floor((px * maxW) / w);
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Simple props
// ---------------------------------------------------------------------------

/**
 * Merges the STATIC meshes among its children into one mesh per material after mount (the originals are hidden,
 * instanced meshes and multi-material meshes are left alone). Use it only around props that never move or
 * change material: a panel full of small parts becomes a handful of draw calls.
 */
export function MergeStatic({ children }: { children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const [merged, setMerged] = useState<{ geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean; receive: boolean }[]>([]);
  useLayoutEffect(() => {
    const g = root.current;
    if (!g) return;
    g.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const m = new THREE.Matrix4();
    const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
    const hidden: THREE.Mesh[] = [];
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh || Array.isArray(mesh.material) || !mesh.visible) return;
      const src = mesh.geometry;
      const pos = src.getAttribute('position');
      if (!pos) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', pos.clone());
      const nrm = src.getAttribute('normal');
      if (nrm) geo.setAttribute('normal', nrm.clone());
      const uv = src.getAttribute('uv');
      geo.setAttribute('uv', uv ? uv.clone() : new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
      geo.setIndex(src.index ? src.index.clone() : Array.from({ length: pos.count }, (_, i) => i));
      if (!nrm) geo.computeVertexNormals();
      geo.applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
      let e = groups.get(mesh.material);
      if (!e) {
        e = { geos: [], cast: false, receive: false };
        groups.set(mesh.material, e);
      }
      e.geos.push(geo);
      e.cast ||= mesh.castShadow;
      e.receive ||= mesh.receiveShadow;
      hidden.push(mesh);
    });
    const out: { geo: THREE.BufferGeometry; mat: THREE.Material; cast: boolean; receive: boolean }[] = [];
    for (const [mat, e] of groups) {
      const geo = e.geos.length === 1 ? e.geos[0]! : mergeGeometries(e.geos, false);
      if (e.geos.length > 1) e.geos.forEach((x) => x.dispose());
      if (!geo) continue;
      geo.computeBoundingSphere();
      out.push({ geo, mat, cast: e.cast, receive: e.receive });
    }
    for (const h of hidden) h.visible = false;
    setMerged(out);
    return () => {
      for (const h of hidden) h.visible = true;
      for (const o of out) o.geo.dispose();
      setMerged([]);
    };
  }, []);
  return (
    <group ref={root}>
      {children}
      {merged.map((mm, i) => (
        <mesh key={i} geometry={mm.geo} material={mm.mat} castShadow={mm.cast} receiveShadow={mm.receive} />
      ))}
    </group>
  );
}

/**
 * Turns shadow CASTING off for every mesh below it (they still receive shadows): small devices inside a
 * cabinet or on a panel face add little to the picture but each costs a draw call in the shadow pass.
 * Re-applied once shortly after mount for parts that mount late.
 */
export function NoCastShadow({ children }: { children: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const apply = () =>
      root.current?.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = false;
      });
    apply();
    const t = window.setTimeout(apply, 1500);
    return () => window.clearTimeout(t);
  }, []);
  return <group ref={root}>{children}</group>;
}

/** Axis-aligned box from min to max corner (shared unit geometry, one draw call). */
export function Slab({
  min,
  max,
  material,
  castShadow = false,
  receiveShadow = true,
}: {
  min: Vec3;
  max: Vec3;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  return (
    <mesh
      geometry={KBOX()}
      material={material}
      position={[(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]}
      scale={[max[0] - min[0], max[1] - min[1], max[2] - min[2]]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
    />
  );
}

/** Horizontal floor plane (y = 0 unless `y` given) with a tiled texture. */
export function TexturedFloor({
  center,
  size,
  texture,
  tile,
  color = '#ffffff',
  roughness = 0.8,
  metalness = 0,
  y = 0,
}: {
  center: [number, number];
  size: [number, number];
  texture: THREE.Texture;
  /** Texture tile size in meters. */
  tile: number;
  color?: string;
  roughness?: number;
  metalness?: number;
  y?: number;
}) {
  const mat = useMemo(() => {
    const map = repeatedTexture(texture, size[0] / tile, size[1] / tile);
    return kmat(`k:floor:${map.uuid}:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ map, color, roughness, metalness }));
  }, [texture, size, tile, color, roughness, metalness]);
  return <mesh geometry={KPLANE()} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[center[0], y, center[1]]} scale={[size[0], size[1], 1]} receiveShadow />;
}

/** Vertical wall plane facing +Z (rotate the group for other walls) with a tiled texture. */
export function TexturedWall({
  position,
  rotation,
  size,
  texture,
  tile,
  color = '#ffffff',
  roughness = 0.9,
}: {
  position: Vec3;
  rotation?: Vec3;
  size: [number, number];
  texture: THREE.Texture;
  tile: [number, number];
  color?: string;
  roughness?: number;
}) {
  const mat = useMemo(() => {
    const map = repeatedTexture(texture, size[0] / tile[0], size[1] / tile[1]);
    return kmat(`k:wall:${map.uuid}:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ map, color, roughness, metalness: 0 }));
  }, [texture, size, tile, color, roughness]);
  return <mesh geometry={KPLANE()} material={mat} position={position} rotation={rotation} scale={[size[0], size[1], 1]} receiveShadow />;
}

/** Tube along a polyline with filleted bends (conduit, cable, hose). */
export function Tube({
  points,
  radius,
  material,
  bend = 0.08,
  radial = 12,
  castShadow = false,
}: {
  points: Vec3[];
  radius: number;
  material: THREE.Material;
  bend?: number;
  radial?: number;
  /** Default false: only the main light casts shadows and thin tubes add little but cost a shadow pass. */
  castShadow?: boolean;
}) {
  const key = JSON.stringify(points);
  const geo = useMemo(() => {
    const path = filletedPath(points, bend);
    const len = path.getLength();
    return new THREE.TubeGeometry(path, Math.min(400, Math.max(6, Math.round(len / 0.03))), radius, radial, false);
  }, [key, radius, bend, radial]); // eslint-disable-line react-hooks/exhaustive-deps
  useDisposeOnUnmount(geo);
  return <mesh geometry={geo} material={material} castShadow={castShadow} />;
}

/** Rigid EMT conduit run (galvanized) with compression couplings at both ends and pipe straps. */
export function Conduit({ points, radius = 0.0115, bend = 0.12, straps = [] }: { points: Vec3[]; radius?: number; bend?: number; straps?: Vec3[] }) {
  const ends = useMemo(() => {
    const out: { p: Vec3; r: Vec3 }[] = [];
    const n = points.length;
    if (n < 2) return out;
    const up = new THREE.Vector3(0, 1, 0);
    const e = new THREE.Euler();
    const mk = (a: Vec3, b: Vec3): Vec3 => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      e.setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
      return [e.x, e.y, e.z];
    };
    // fittings point along the run, away from the end (so they sit on the conduit)
    out.push({ p: points[0], r: mk(points[0], points[1]) });
    out.push({ p: points[n - 1], r: mk(points[n - 1], points[n - 2]) });
    return out;
  }, [JSON.stringify(points)]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = kgeo(`k:conduitfit:${radius}`, () => new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, 0.045, 14).translate(0, 0.0225, 0));
  const strap = kgeo(`k:strap:${radius}`, () => new THREE.TorusGeometry(radius * 1.12, 0.0022, 6, 16, Math.PI));
  // plain meshes (not instanced) so a surrounding <MergeStatic> folds every conduit run into ~2 draw calls
  return (
    <group>
      <Tube points={points} radius={radius} bend={bend} material={km.galv()} />
      {ends.map((e, i) => (
        <mesh key={i} geometry={fit} material={km.metal('#a9aeb2', 0.4)} position={e.p} rotation={e.r} />
      ))}
      {straps.map((p, i) => (
        <mesh key={`s${i}`} geometry={strap} material={km.galv()} position={p} />
      ))}
    </group>
  );
}

/** Instanced copies of one geometry (static transforms). */
export function Instances({
  geometry,
  material,
  items,
  castShadow = true,
  receiveShadow = true,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: { p: Vec3; r?: Vec3; s?: Vec3 }[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const key = JSON.stringify(items);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    items.forEach((it, i) => {
      e.set(...(it.r ?? [0, 0, 0]));
      q.setFromEuler(e);
      pos.set(...it.p);
      sc.set(...(it.s ?? [1, 1, 1]));
      mat.compose(pos, q, sc);
      m.setMatrixAt(i, mat);
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.computeBoundingBox();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // frustum culling uses the instance bounding sphere computed above (all instances), so off-screen groups
  // (pallet rack, columns, trays...) are skipped in both the main and the shadow pass
  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, items.length)]} castShadow={castShadow} receiveShadow={receiveShadow} />;
}

/**
 * Galvanized ladder-type cable tray running from `start` along +X (axis 'x') or +Z (axis 'z') for `length`.
 * `start` is the center of the tray bottom at the start end. Optional cables lying in the tray.
 */
export function LadderTray({
  start,
  length,
  axis = 'x',
  width = 0.3,
  sideH = 0.1,
  cables = [],
}: {
  start: Vec3;
  length: number;
  axis?: 'x' | 'z';
  width?: number;
  sideH?: number;
  cables?: string[];
}) {
  // rails (web + 2 flanges per side) and rungs: one instanced draw call
  const steel = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (const sd of [-1, 1]) {
      const z = (sd * width) / 2;
      out.push({ p: [0, sideH / 2, z], s: [length, sideH, 0.004] });
      out.push({ p: [0, sideH, z - sd * 0.011], s: [length, 0.004, 0.022] });
      out.push({ p: [0, 0, z - sd * 0.011], s: [length, 0.004, 0.022] });
    }
    const n = Math.max(2, Math.floor(length / 0.25));
    for (let i = 0; i <= n; i++) out.push({ p: [-length / 2 + 0.06 + (i * (length - 0.12)) / n, 0.012, 0], s: [0.025, 0.018, width] });
    return out;
  }, [length, width, sideH]);
  const cableItems = useMemo(
    () => cables.map((_, i) => ({ p: [0, 0.021 + 0.009 + (i % 2) * 0.012, -width / 2 + 0.04 + i * 0.026] as Vec3, r: [0, 0, Math.PI / 2] as Vec3, s: [0.018, length, 0.018] as Vec3 })),
    [cables.length, width, length], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rot: Vec3 = axis === 'x' ? [0, 0, 0] : [0, -Math.PI / 2, 0];
  const center: Vec3 = axis === 'x' ? [start[0] + length / 2, start[1], start[2]] : [start[0], start[1], start[2] + length / 2];
  return (
    <group position={center} rotation={rot}>
      <Instances geometry={KBOX()} material={km.galv()} items={steel} />
      {cables.length > 0 && <Instances geometry={KCYL()} material={km.plastic(cables[0]!, 0.6)} items={cableItems} castShadow={false} />}
    </group>
  );
}

/** Canvas-texture sign plate facing +Z. */
export function SignPlate({
  id,
  size,
  position,
  rotation,
  draw,
  px = 1600,
  thickness = 0.002,
}: {
  id: string;
  size: [number, number];
  position?: Vec3;
  rotation?: Vec3;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Pixels per meter. */
  px?: number;
  thickness?: number;
}) {
  const tex = panelTexture(`sign:${id}`, size[0], size[1], px, (ctx, _m, w, h) => draw(ctx, w, h));
  // One draw call: the thin plate carries the print on every face (edges just show the border color).
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={KBOX()} material={km.label(tex, 0.55)} scale={[size[0], size[1], thickness]} position={[0, 0, thickness / 2]} />
    </group>
  );
}

/** Standard safety sign drawing (ANSI Z535 style header band + message lines). */
export function drawSafetySign(kind: 'danger' | 'warning' | 'caution' | 'notice', lines: string[]) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const header = { danger: ['#c8102e', '#ffffff', 'DANGER'], warning: ['#f47920', '#000000', 'WARNING'], caution: ['#ffd100', '#000000', 'CAUTION'], notice: ['#1f5aa6', '#ffffff', 'NOTICE'] }[kind];
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const hh = h * 0.3;
    ctx.fillStyle = kind === 'danger' ? '#000' : header[0]!;
    ctx.fillRect(0, 0, w, hh);
    if (kind === 'danger') {
      ctx.fillStyle = header[0]!;
      roundRectPath(ctx, w * 0.12, hh * 0.14, w * 0.76, hh * 0.72, hh * 0.3);
      ctx.fill();
    }
    ctx.fillStyle = header[1]!;
    ctx.font = `800 ${Math.round(hh * 0.56)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(header[2]!, w / 2, hh / 2 + 1);
    ctx.fillStyle = '#111';
    const lh = (h - hh) / (lines.length + 0.6);
    ctx.font = `800 ${Math.round(Math.min(lh * 0.62, (w * 1.35) / Math.max(...lines.map((l) => l.length))))}px ${FONT}`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, hh + lh * (i + 0.8)));
    ctx.strokeStyle = '#111';
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.strokeRect(1, 1, w - 2, h - 2);
  };
}

// ---------------------------------------------------------------------------
// Controls → runtime (with click sounds)
// ---------------------------------------------------------------------------

export interface ControlWiring {
  momentary(id: string): { onPress: () => void; onRelease: () => void };
  toggle(id: string, sound?: SfxName): () => void;
  select(id: string): (index: number) => void;
  set(id: string, value: boolean | number): void;
  get(id: string): boolean | number;
}

/** Wiring helpers bound to a runtime (memoize per runtime). */
export function useControls(runtime: SimRuntime): ControlWiring {
  return useMemo<ControlWiring>(() => {
    const cache = new Map<string, unknown>();
    const memo = <T,>(key: string, make: () => T): T => {
      let v = cache.get(key) as T | undefined;
      if (!v) {
        v = make();
        cache.set(key, v);
      }
      return v;
    };
    return {
      momentary: (id) =>
        memo(`m:${id}`, () => ({
          onPress: () => {
            runtime.setControl(id, true);
            sfx.play('press');
          },
          onRelease: () => {
            runtime.setControl(id, false);
            sfx.play('release');
          },
        })),
      toggle: (id, sound = 'toggle') =>
        memo(`t:${id}:${sound}`, () => () => {
          runtime.setControl(id, !runtime.getControl(id));
          sfx.play(sound);
        }),
      select: (id) =>
        memo(`s:${id}`, () => (i: number) => {
          runtime.setControl(id, i);
          sfx.play('click');
        }),
      set: (id, v) => runtime.setControl(id, v),
      get: (id) => runtime.getControl(id),
    };
  }, [runtime]);
}

/**
 * A click that behaves like a momentary push: control true on pointer down, false on the next pointer up
 * anywhere (or after `maxMs`). For devices whose component only exposes a click (e.g. the 193-E RESET).
 */
export function momentaryClick(runtime: SimRuntime, id: string, maxMs = 1500): () => void {
  return () => {
    runtime.setControl(id, true);
    sfx.play('press');
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      window.removeEventListener('pointerup', release);
      runtime.setControl(id, false);
      sfx.play('release');
    };
    window.addEventListener('pointerup', release);
    window.setTimeout(release, maxMs);
  };
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

export type LoopLevels = Record<LoopName, number>;

/** True once the page has seen a user gesture (browsers refuse to start audio before that). */
export function audioAllowed(): boolean {
  const ua = (typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined);
  return ua ? ua.hasBeenActive : true;
}

/**
 * Drive sfx loops from scene state ~10×/s. `fill` writes intensities (0..1) into the given object for the
 * loops it uses (others are 0). All listed loops are stopped on unmount.
 */
export function useSfxLoops(names: readonly LoopName[], fill: (levels: LoopLevels) => void, periodS = 0.1) {
  const levels = useMemo<LoopLevels>(() => ({ motor: 0, conveyor: 0, horn: 0, buzzer: 0, pump: 0 }), []);
  const acc = useRef(0);
  const fillRef = useRef(fill);
  fillRef.current = fill;
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < periodS) return;
    acc.current = 0;
    for (const n of names) levels[n] = 0;
    fillRef.current(levels);
    const ok = audioAllowed();
    for (const n of names) sfx.setLoop(n, ok ? levels[n] : 0);
  });
  const key = names.join(',');
  useEffect(
    () => () => {
      for (const n of key.split(',') as LoopName[]) sfx.setLoop(n, 0);
    },
    [key],
  );
}

/** Play one-shots on rising / falling edges of a boolean read every frame. */
export function useEdgeSfx(get: () => boolean, rise?: SfxName, fall?: SfxName) {
  const prev = useRef<boolean | null>(null);
  const getRef = useRef(get);
  getRef.current = get;
  useFrame(() => {
    const v = getRef.current();
    const p = prev.current;
    prev.current = v;
    if (p === null || p === v || !audioAllowed()) return;
    if (v && rise) sfx.play(rise);
    if (!v && fall) sfx.play(fall);
  });
}

// ---------------------------------------------------------------------------
// Learning overlay: I/O tag chips
// ---------------------------------------------------------------------------

export interface IoTagLine {
  alias: string;
  address: string;
  dir: 'input' | 'output';
  analog: boolean;
  units?: string;
  /** Live tag value (BOOL as 0/1). */
  get: () => number;
  /** Forced in the controller. */
  forced: () => boolean;
  /** Custom value text (overrides the default formatting; '' hides the value). */
  format?: () => string;
}

/** Tag line for a wired I/O point of the runtime's scene, looked up by alias (value = controller tag). */
export function ioLine(runtime: SimRuntime, alias: string): IoTagLine {
  const pt = runtime.scene.io.find((p) => p.alias === alias);
  const operand = pt?.operand ?? alias;
  const analog = pt?.signal === 'analog';
  const ctl = runtime.controller;
  return {
    alias,
    address: operand,
    dir: pt?.dir ?? 'input',
    analog,
    units: pt?.units,
    get: () => {
      try {
        return analog ? ctl.tags.readNumber(operand) : ctl.tags.readBool(operand) ? 1 : 0;
      } catch {
        return 0;
      }
    },
    forced: () => {
      try {
        return ctl.getForce ? ctl.getForce(operand) !== undefined : false;
      } catch {
        return false;
      }
    },
  };
}

/** A text-only line (e.g. module catalog / slot). */
export function textLine(label: string, text: string | (() => string), address = ''): IoTagLine {
  return {
    alias: label,
    address,
    dir: 'output',
    analog: true,
    get: () => 0,
    forced: () => false,
    format: typeof text === 'function' ? text : () => text,
  };
}

/** A non-I/O info line (e.g. motor speed): shown like a tag line without an address. */
export function infoLine(label: string, get: () => number, units = '', decimals = 0): IoTagLine & { decimals: number } {
  return { alias: label, address: '', dir: 'output', analog: true, units, get, forced: () => false, decimals };
}

/**
 * Pinned-mode grouping: when the members of a group are too small on screen to carry their own value pill,
 * they share one summary chip (e.g. "Switch_0-7  0100 1000").
 */
export interface TagGroup {
  id: string;
  label: string;
  /** 'bits' = digital values as a bit string (grouped by 4); 'rows' = one "alias value" row per tag line. */
  mode?: 'bits' | 'rows';
  /** Collapse into the summary chip while the members' average projected half-size is below this (px). */
  collapseBelow?: number;
}

type Line = IoTagLine & { decimals?: number };

interface TagEntry {
  id: string;
  /** Registration order (stable member order inside a group). */
  order: number;
  /** Tag currently applicable (e.g. a fault marker that is only shown while the fault is active). */
  active?: () => boolean;
  /** The IoTag frame (device placement); its +Z is the panel normal for the facing test. */
  frame: THREE.Object3D;
  /** Proxy-box center (for the projected device size / pill placement). */
  center: THREE.Object3D;
  anchor: THREE.Object3D;
  /** Half the proxy face size (m), for the projected size. */
  radius: number;
  /** Hide when the camera is behind the device's panel (its +Z). */
  facing: boolean;
  /** Take part in the pinned overlay (showTags). */
  pin: boolean;
  group?: TagGroup;
  lines: Line[];
  // full chip (hover, legacy pinned)
  el: HTMLDivElement;
  box: HTMLDivElement;
  title: HTMLDivElement;
  values: HTMLSpanElement[];
  forces: HTMLSpanElement[];
  leader: HTMLDivElement;
  lastVals: string[];
  lastForce: boolean[];
  shown: boolean;
  occluded: boolean;
  /** Camera is behind the panel (facing test). */
  back: boolean;
  w: number;
  h: number;
  x: number;
  y: number;
  lx: number;
  ly: number;
  lnudge: number;
  titleShown: boolean;
  depth: number;
  // compact value pill (pinned 'pill' style)
  pill: HTMLDivElement;
  pillAlias: HTMLSpanElement;
  pillVal: HTMLSpanElement;
  pillShown: boolean;
  pillText: string;
  pillWide: boolean;
  /** The wide pill did not fit last time (value-only pill shown). */
  narrowed: boolean;
  pw: number;
  ph: number;
  plx: number;
  ply: number;
  // per-frame scratch
  cx: number;
  cy: number;
  pr: number;
  vis: boolean;
  /** Frame stamp: candidate for a pinned pill in this frame. */
  stamp: number;
}

interface GroupChip {
  g: TagGroup;
  el: HTMLDivElement;
  body: HTMLDivElement;
  members: TagEntry[];
  text: string;
  shown: boolean;
  collapse: boolean;
  w: number;
  h: number;
  lx: number;
  ly: number;
}

const CHIP_CSS =
  'position:absolute;left:0;top:0;display:none;pointer-events:none;will-change:transform;transition:opacity 120ms linear;';
const BOX_CSS =
  "background:rgba(10,14,20,0.9);border:1px solid rgba(148,163,184,0.35);border-radius:6px;padding:3px 7px 3px 6px;color:#e5e7eb;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.45);font:500 10.5px/1.35 'JetBrains Mono',ui-monospace,monospace;";
const PILL_CSS =
  "position:absolute;left:0;top:0;display:none;pointer-events:none;will-change:transform;white-space:nowrap;background:rgba(10,14,20,0.82);border:1px solid rgba(148,163,184,0.3);border-radius:9px;padding:0 4px 0 4px;color:#e5e7eb;font:600 9.5px/15px 'JetBrains Mono',ui-monospace,monospace;box-shadow:0 1px 5px rgba(0,0,0,0.4);";
const GROUP_CSS =
  "position:absolute;left:0;top:0;display:none;pointer-events:none;will-change:transform;white-space:pre;background:rgba(10,14,20,0.86);border:1px solid rgba(148,163,184,0.35);border-radius:6px;padding:2px 6px;color:#e5e7eb;font:500 10px/1.35 'JetBrains Mono',ui-monospace,monospace;box-shadow:0 2px 8px rgba(0,0,0,0.45);";

/** Pinned chips (legacy 'chip' style) are shown for devices within this distance of the camera (m). */
const PIN_RANGE = 6;
/** Pill style: a device gets its own pill when its projected half-size is at least this many pixels. */
const PIN_MIN_PX = 6;
/** Pill style: from this projected half-size on, the pill also shows the alias. */
const PIN_ALIAS_PX = 30;
/** Viewport margin for chips (px). */
const EDGE = 4;

class TagRegistry {
  entries = new Map<string, TagEntry>();
  groups = new Map<string, GroupChip>();
  container: HTMLDivElement | null = null;
  hovered: string | null = null;
  showTags = false;
  boxes: THREE.Box3[] = [];
  seq = 0;

  add(e: TagEntry) {
    this.entries.set(e.id, e);
    this.container?.appendChild(e.el);
    this.container?.appendChild(e.pill);
    if (e.group) {
      let gc = this.groups.get(e.group.id);
      if (!gc) {
        gc = buildGroupChip(e.group);
        this.groups.set(e.group.id, gc);
        this.container?.appendChild(gc.el);
      }
      gc.members.push(e);
      gc.members.sort((a, b) => a.order - b.order);
    }
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    e.el.remove();
    e.pill.remove();
    this.entries.delete(id);
    if (e.group) {
      const gc = this.groups.get(e.group.id);
      if (gc) {
        gc.members = gc.members.filter((m) => m !== e);
        if (gc.members.length === 0) {
          gc.el.remove();
          this.groups.delete(e.group.id);
        }
      }
    }
    if (this.hovered === id) this.hovered = null;
  }

  attach(c: HTMLDivElement) {
    this.container = c;
    for (const e of this.entries.values()) {
      c.appendChild(e.el);
      c.appendChild(e.pill);
    }
    for (const g of this.groups.values()) c.appendChild(g.el);
  }
}

const RegistryContext = createContext<TagRegistry | null>(null);

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _camW = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _ray = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _tmp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();

function formatValue(l: Line): string {
  if (l.format) return l.format();
  const v = l.get();
  if (!l.analog) return v ? '1' : '0';
  const d = l.decimals ?? 1;
  return `${v.toFixed(d)}${l.units ? ` ${l.units}` : ''}`;
}

/** Short value of an entry for pills / bit strings: its first line (plus the second for 2-line digital tags). */
function pillValue(e: TagEntry): string {
  const a = e.lines[0];
  if (!a) return '';
  const s = formatValue(a);
  const b = e.lines[1];
  if (b && !a.analog && !b.analog) return s + formatValue(b);
  return s;
}

/** True when the pill shows several "alias value" pairs (2-line digital tags such as a H-O-A selector). */
const multiDigital = (e: TagEntry) => e.lines.length > 1 && e.lines.every((l) => !l.analog && l.address);

function setBadge(span: HTMLSpanElement, s: string, digital: boolean) {
  span.textContent = s;
  span.style.display = s ? '' : 'none';
  if (digital) {
    const on = s === '1';
    span.style.background = on ? '#16a34a' : '#334155';
    span.style.color = on ? '#f0fdf4' : '#cbd5e1';
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Rect, b: Rect, gap = 2) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : v < lo ? lo : v > hi ? hi : v);

/**
 * Hosts the I/O tag chips of one scene view. `occluders` are coarse boxes [min, max] in this group's
 * coordinates (walls, cabinets, benches); a chip whose anchor is hidden behind one fades out.
 *
 * `pinStyle` selects what `showTags` pins: 'chip' (legacy: full chips for devices within 6 m, stacked
 * upward) or 'pill' (compact value pills placed beside/below each device without covering other devices;
 * devices too small on screen collapse into one summary chip per TagGroup). Hovering always shows the full
 * chip. All chips are clamped to the viewport and keep out of the DOM HUD over the canvas (camera bar, tools,
 * replay caption, operator pad: see twin/hud.ts); the layer itself sits below that HUD.
 */
export function TagLayer({ children, occluders = [], pinStyle = 'chip' }: { children: ReactNode; occluders?: Array<[Vec3, Vec3]>; pinStyle?: 'chip' | 'pill' }) {
  const gl = useThree((s) => s.gl);
  const frame = useRef<THREE.Group>(null);
  const reg = useMemo(() => new TagRegistry(), []);
  const showTags = useSceneOverlay((s) => s.showTags);
  reg.showTags = showTags;
  const occKey = JSON.stringify(occluders);
  useMemo(() => {
    reg.boxes = occluders.map(([a, b]) => new THREE.Box3(new THREE.Vector3(...a), new THREE.Vector3(...b)));
  }, [occKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const c = document.createElement('div');
    // stacked inside the canvas' own stacking context (see SceneCanvas): above the 3D view, below the DOM HUD
    c.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
    c.dataset.plcwTags = '1';
    parent.appendChild(c);
    reg.attach(c);
    return () => {
      c.remove();
      reg.container = null;
    };
  }, [gl, reg]);

  const timers = useRef({ text: 0, occ: 0, frame: 0 });
  const placed = useMemo<TagEntry[]>(() => [], []);
  const cands = useMemo<TagEntry[]>(() => [], []);
  const rects = useMemo<Rect[]>(() => [], []);
  const pillMode = pinStyle === 'pill';

  useFrame((state, dt) => {
    const cont = reg.container;
    if (!cont) return;
    const { camera, size } = state;
    const t = timers.current;
    t.text += dt;
    t.occ += dt;
    const doText = t.text > 0.1;
    const doOcc = t.occ > 0.15;
    if (doText) t.text = 0;
    if (doOcc) t.occ = 0;
    const stamp = ++t.frame;
    const f = frame.current;
    if (f) {
      _inv.copy(f.matrixWorld).invert();
      camera.getWorldPosition(_cam).applyMatrix4(_inv);
    }
    camera.getWorldPosition(_camW);
    const persp = camera as THREE.PerspectiveCamera;
    const focal = persp.isPerspectiveCamera ? size.height / (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2)) : size.height;
    placed.length = 0;
    cands.length = 0;
    const W = size.width;
    const H = size.height;
    const hud = hudRects(gl.domElement);

    for (const e of reg.entries.values()) {
      const hovered = reg.hovered === e.id;
      const act = !e.active || e.active();
      const pinned = reg.showTags && act && e.pin;
      let wantChip = act && (hovered || (reg.showTags && !pillMode));
      if (wantChip && !hovered) {
        // legacy pinned chips: only nearby devices (distant chips would just clutter the view)
        e.anchor.getWorldPosition(_v);
        if (_v.distanceToSquared(_camW) > PIN_RANGE * PIN_RANGE) wantChip = false;
      }
      const wantPill = pillMode && pinned && !hovered;
      e.vis = false;
      if (!wantChip && !wantPill) {
        if (e.shown) {
          e.el.style.display = 'none';
          e.shown = false;
        }
        continue;
      }
      // occlusion + facing (in layer coordinates), at ~7 Hz or when (re)appearing
      if ((doOcc || (!e.shown && !e.pillShown)) && f) {
        e.anchor.getWorldPosition(_v);
        const a = _hit.copy(_v).applyMatrix4(_inv);
        const dist = a.distanceTo(_cam);
        _dir.copy(a).sub(_cam).normalize();
        _ray.set(_cam, _dir);
        let occ = false;
        for (const b of reg.boxes) {
          if (b.containsPoint(a)) continue;
          const p = _ray.intersectBox(b, _tmp);
          if (p && p.distanceTo(_cam) < dist - 0.02) {
            occ = true;
            break;
          }
        }
        let back = false;
        if (e.facing) {
          e.frame.getWorldQuaternion(_q);
          _n.set(0, 0, 1).applyQuaternion(_q);
          e.center.getWorldPosition(_c);
          _tmp.copy(_camW).sub(_c);
          back = _n.dot(_tmp) < 0.03 * _tmp.length();
        }
        const was = e.occluded || e.back;
        e.occluded = occ;
        e.back = back;
        if (occ || back) {
          if (!was || !e.shown) e.el.style.opacity = hovered ? '1' : '0';
        } else if (was || !e.shown) e.el.style.opacity = '1';
      }
      if (hovered && e.el.style.opacity !== '1') e.el.style.opacity = '1';
      if ((e.occluded || e.back) && !hovered) {
        if (e.shown && !wantChip) {
          e.el.style.display = 'none';
          e.shown = false;
        }
        if (e.shown) continue; // faded out behind a wall: keep it out of the de-clutter pass
        if (!wantChip) continue;
      }
      // projection of the chip anchor
      e.anchor.getWorldPosition(_v);
      _v.project(camera);
      const inView = !(_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.3 || Math.abs(_v.y) > 1.3);
      e.depth = _v.z;
      if (wantPill) {
        e.center.getWorldPosition(_c);
        const dist = _c.distanceTo(_camW);
        _c.project(camera);
        const inner = _c.z < 1 && _c.z > -1 && Math.abs(_c.x) < 0.97 && Math.abs(_c.y) < 0.97;
        if (inner && !e.occluded && !e.back) {
          e.cx = (_c.x * 0.5 + 0.5) * W;
          e.cy = (-_c.y * 0.5 + 0.5) * H;
          e.pr = (e.radius * focal) / Math.max(0.05, dist);
          e.vis = true;
          e.stamp = stamp;
          cands.push(e);
        }
      }
      if (!wantChip) {
        if (e.shown) {
          e.el.style.display = 'none';
          e.shown = false;
        }
        continue;
      }
      if (!inView) {
        if (e.shown) {
          e.el.style.display = 'none';
          e.shown = false;
        }
        continue;
      }
      if (!e.shown) {
        e.el.style.display = 'block';
        e.shown = true;
        e.lx = -1e9;
        e.title.style.display = hovered ? 'block' : 'none';
        e.titleShown = hovered;
        e.w = e.box.offsetWidth;
        e.h = e.box.offsetHeight;
      }
      if (hovered !== e.titleShown) {
        e.titleShown = hovered;
        e.title.style.display = hovered ? 'block' : 'none';
        e.w = e.box.offsetWidth;
        e.h = e.box.offsetHeight;
      }
      e.x = (_v.x * 0.5 + 0.5) * W;
      e.y = (-_v.y * 0.5 + 0.5) * H;
      if (doText || e.lastVals[0] === '') {
        let changed = false;
        for (let i = 0; i < e.lines.length; i++) {
          const l = e.lines[i]!;
          const s = formatValue(l);
          if (s !== e.lastVals[i]) {
            e.lastVals[i] = s;
            setBadge(e.values[i]!, s, !l.analog);
            changed = true;
          }
          const fo = l.forced();
          if (fo !== e.lastForce[i]) {
            e.lastForce[i] = fo;
            e.forces[i]!.style.display = fo ? 'inline-block' : 'none';
            changed = true;
          }
        }
        if (changed) {
          e.w = e.box.offsetWidth;
          e.h = e.box.offsetHeight;
        }
      }
      placed.push(e);
    }

    // ---- full chips: hovered first, then near-to-far; (legacy pinned) push overlapping chips upward ----
    placed.sort((a, b) => (a.id === reg.hovered ? -1 : b.id === reg.hovered ? 1 : a.depth - b.depth));
    const GAP = 3;
    rects.length = 0;
    for (let i = 0; i < placed.length; i++) {
      const e = placed[i]!;
      // box bottom sits 6 px above the anchor (+ nudge); legacy pinned chips are pushed upward out of overlaps
      let nudge = 0;
      if (i > 0 && !pillMode) {
        for (let iter = 0; iter < 8; iter++) {
          const top = e.y - 6 - nudge - e.h;
          const left = e.x - e.w / 2;
          let moved = false;
          for (let j = 0; j < i; j++) {
            const o = rects[j]!;
            if (left < o.x + o.w + GAP && left + e.w + GAP > o.x && top < o.y + o.h + GAP && top + e.h + GAP > o.y) {
              nudge = e.y - 6 - (o.y - GAP);
              moved = true;
            }
          }
          if (!moved) break;
        }
      }
      // keep the box inside the viewport and out of the HUD; the leader runs from the box down to the device
      let x = clamp(e.x, e.w / 2 + EDGE, W - e.w / 2 - EDGE);
      let bottom = clamp(e.y - 6 - nudge, e.h + EDGE, H - EDGE);
      if (hud.length > 0 && hitsHud({ x: x - e.w / 2, y: bottom - e.h, w: e.w, h: e.h }, hud)) {
        const alt = chipOutsideHud(e, x, bottom, hud, e.id === reg.hovered ? null : rects, W, H);
        if (alt) {
          x = alt[0];
          bottom = alt[1];
        }
      }
      const lead = Math.max(0, e.y - bottom);
      rects.push({ x: x - e.w / 2, y: bottom - e.h, w: e.w, h: e.h });
      if (Math.abs(x - e.lx) > 0.3 || Math.abs(bottom - e.ly) > 0.3 || lead !== e.lnudge) {
        e.lx = x;
        e.ly = bottom;
        if (lead !== e.lnudge) e.leader.style.height = `${lead.toFixed(1)}px`;
        e.lnudge = lead;
        e.el.style.transform = `translate(${x.toFixed(1)}px,${(bottom + lead).toFixed(1)}px) translate(-50%,-100%)`;
        e.el.style.zIndex = e.id === reg.hovered ? '10' : '1';
      }
    }

    if (!pillMode) return;

    // ---- pinned value pills + group summary chips ----
    // groups whose members are small on screen collapse into one summary chip
    for (const gc of reg.groups.values()) {
      let n = 0;
      let sum = 0;
      for (const m of gc.members) {
        if (!m.vis) continue;
        n++;
        sum += m.pr;
      }
      gc.collapse = n > 0 && sum / n < (gc.g.collapseBelow ?? PIN_MIN_PX * 2.2);
      if (gc.collapse) for (const m of gc.members) if (m.vis) m.vis = false;
    }
    // the HUD and the device footprints are obstacles: pills never cover a control, a lamp or a button
    for (const h of hud) rects.push(h);
    for (const e of cands) {
      if (!e.vis) continue;
      const r = e.pr * 0.85;
      rects.push({ x: e.cx - r, y: e.cy - r, w: 2 * r, h: 2 * r });
    }
    cands.sort((a, b) => b.pr - a.pr);
    for (const e of cands) {
      if (!e.vis || e.pr < PIN_MIN_PX) {
        hidePill(e);
        continue;
      }
      // wide pills carry the alias; when a wide pill finds no free spot, retry with the value-only pill
      // (a pill that had to fall back retries the wide form only at the 10 Hz text rate: no per-frame re-measuring)
      let best: Rect | null = null;
      const canWide = e.pr >= PIN_ALIAS_PX;
      for (const wide of canWide && (doText || !e.narrowed) ? [true, false] : [false]) {
        if (doText || e.pillText === '' || wide !== e.pillWide) setPill(e, wide);
        best = placePill(e, rects, W, H);
        if (best) {
          e.narrowed = canWide && !wide;
          break;
        }
      }
      if (!best) {
        hidePill(e);
        continue;
      }
      rects.push(best);
      if (!e.pillShown) {
        e.pill.style.display = 'block';
        e.pillShown = true;
      }
      if (Math.abs(best.x - e.plx) > 0.3 || Math.abs(best.y - e.ply) > 0.3) {
        e.plx = best.x;
        e.ply = best.y;
        e.pill.style.transform = `translate(${best.x.toFixed(1)}px,${best.y.toFixed(1)}px)`;
      }
    }
    for (const e of reg.entries.values()) if (e.pillShown && e.stamp !== stamp) hidePill(e);

    for (const gc of reg.groups.values()) {
      if (!reg.showTags || !gc.collapse) {
        if (gc.shown) {
          gc.el.style.display = 'none';
          gc.shown = false;
        }
        continue;
      }
      let n = 0;
      let sx = 0;
      let top = Infinity;
      let low = -Infinity;
      for (const m of gc.members) {
        if (m.stamp !== stamp) continue;
        n++;
        sx += m.cx;
        top = Math.min(top, m.cy - m.pr);
        low = Math.max(low, m.cy + m.pr);
      }
      if (n === 0) {
        if (gc.shown) {
          gc.el.style.display = 'none';
          gc.shown = false;
        }
        continue;
      }
      if (doText || !gc.shown) {
        const txt = groupText(gc);
        if (txt !== gc.text || !gc.shown) {
          gc.text = txt;
          gc.body.textContent = txt;
          if (!gc.shown) gc.el.style.display = 'block';
          gc.w = gc.el.offsetWidth;
          gc.h = gc.el.offsetHeight;
        }
      }
      gc.shown = true;
      const cx0 = sx / n - gc.w / 2;
      const cand = placeGroupChip(cx0, top - 6 - gc.h, low + 6, gc.w, gc.h, rects, hud, W, H);
      // no spot outside the HUD: better no summary than one covering a control (kept measured, just invisible)
      const vis = cand ? '' : 'hidden';
      if (gc.el.style.visibility !== vis) gc.el.style.visibility = vis;
      if (!cand) continue;
      rects.push(cand);
      if (Math.abs(cand.x - gc.lx) > 0.3 || Math.abs(cand.y - gc.ly) > 0.3) {
        gc.lx = cand.x;
        gc.ly = cand.y;
        gc.el.style.transform = `translate(${cand.x.toFixed(1)}px,${cand.y.toFixed(1)}px)`;
      }
    }
  });

  return (
    <group ref={frame}>
      <RegistryContext.Provider value={reg}>{children}</RegistryContext.Provider>
    </group>
  );
}

/** (Re)build the pill content ("alias value", or several pairs for 2-line tags) and measure it. */
function setPill(e: TagEntry, wide: boolean) {
  const multi = multiDigital(e);
  const s = multi && wide ? e.lines.map((l) => `${l.alias} ${formatValue(l)}`).join(' · ') : pillValue(e);
  if (s === e.pillText && wide === e.pillWide) return;
  e.pillText = s;
  e.pillWide = wide;
  e.pillAlias.style.display = wide && !multi ? '' : 'none';
  const digital = !e.lines[0]?.analog;
  e.pillVal.textContent = s;
  const on = digital && /1/.test(s);
  e.pill.style.background = digital ? (on ? 'rgba(22,163,74,0.92)' : 'rgba(30,41,59,0.88)') : 'rgba(10,14,20,0.82)';
  e.pill.style.color = digital && !on ? '#cbd5e1' : '#f8fafc';
  // measure (needs layout: show it for the read, restore afterwards)
  if (!e.pillShown) e.pill.style.display = 'block';
  e.pw = e.pill.offsetWidth;
  e.ph = e.pill.offsetHeight;
  if (!e.pillShown) e.pill.style.display = 'none';
}

/**
 * Summary chip of a collapsed TagGroup: above its devices (preferred), beside that spot, below the devices, then
 * further up / down and sideways; the first spot free of other chips and of the HUD. Without a free spot, the one
 * that overlaps other chips least (if that overlap is small); null otherwise.
 */
function placeGroupChip(cx0: number, above: number, below: number, w: number, h: number, rects: Rect[], hud: HudRect[], W: number, H: number): Rect | null {
  const half = (h + 3) / 2;
  const ys: number[] = [];
  for (const k of [0, 1, 2, 3, 4, 6, 8]) {
    ys.push(above - k * half, below + k * half);
    if (k > 0) ys.push(above + k * half, below - k * half);
  }
  // snapped to the HUD: right below a top band / right above a bottom band (where the free space usually is)
  for (const r of hud) ys.push(r.y + r.h + 4, r.y - h - 4);
  const dxs = [0, w * 0.3, -w * 0.3, w * 0.55, -w * 0.55, w * 0.8, -w * 0.8, w * 1.05, -w * 1.05, w * 1.6, -w * 1.6, w * 2.2, -w * 2.2];
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (const y of ys) {
    if (y < EDGE - 2 * half || y > H - EDGE) continue; // off screen: clamping would only pile chips on the edge
    for (const dx of dxs) {
      const c = { x: clamp(cx0 + dx, EDGE, W - w - EDGE), y: clamp(y, EDGE, H - h - EDGE), w, h };
      if (hitsHud(c, hud)) continue;
      let area = 0;
      for (const o of rects) {
        if (!overlaps(c, o, 2)) continue;
        area += Math.max(1, (Math.min(c.x + c.w, o.x + o.w) - Math.max(c.x, o.x)) * (Math.min(c.y + c.h, o.y + o.h) - Math.max(c.y, o.y)));
      }
      if (area === 0) return c;
      if (area < bestArea) {
        best = c;
        bestArea = area;
      }
    }
  }
  // a small overlap keeps the summary readable; one mostly covering another chip is not shown
  return bestArea <= 0.35 * w * h ? best : null;
}

/**
 * A full chip whose default spot (centred above its anchor) hits the HUD: below a top band, above a bottom band,
 * or beside the anchor. With `rects` (pinned chips) the spot must not cover an already placed chip either.
 * Returns [centre x, box bottom] or null.
 */
function chipOutsideHud(e: TagEntry, x: number, bottom: number, hud: HudRect[], rects: Rect[] | null, W: number, H: number): [number, number] | null {
  const ok = (cx: number, b: number): boolean => {
    const r = { x: cx - e.w / 2, y: b - e.h, w: e.w, h: e.h };
    return !hitsHud(r, hud) && (!rects || !rects.some((o) => overlaps(r, o, 2)));
  };
  const cands: [number, number][] = [];
  for (const h of hud) {
    cands.push([x, h.y + h.h + 4 + e.h]); // below a band at the top
    cands.push([x, h.y - 4]); // above a band at the bottom
  }
  const side = e.w / 2 + 14;
  const mid = e.y + e.h / 2;
  cands.push([e.x + side, mid], [e.x - side, mid], [e.x + side, bottom], [e.x - side, bottom]);
  for (const [cx, b] of cands) {
    const cx1 = clamp(cx, e.w / 2 + EDGE, W - e.w / 2 - EDGE);
    const b1 = clamp(b, e.h + EDGE, H - EDGE);
    if (ok(cx1, b1)) return [cx1, b1];
  }
  return null;
}

/** First free spot around the device footprint: below, right, left, above, then the corners (null when all are taken). */
function placePill(e: TagEntry, rects: Rect[], W: number, H: number): Rect | null {
  const r = e.pr * 0.85 + 2;
  const spots: [number, number][] = [
    [e.cx - e.pw / 2, e.cy + r],
    [e.cx + r, e.cy - e.ph / 2],
    [e.cx - r - e.pw, e.cy - e.ph / 2],
    [e.cx - e.pw / 2, e.cy - r - e.ph],
    [e.cx + r * 0.7, e.cy + r * 0.7],
    [e.cx - r * 0.7 - e.pw, e.cy + r * 0.7],
    [e.cx + r * 0.7, e.cy - r * 0.7 - e.ph],
    [e.cx - r * 0.7 - e.pw, e.cy - r * 0.7 - e.ph],
  ];
  for (const [sx, sy] of spots) {
    const cand = { x: clamp(sx, EDGE, W - e.pw - EDGE), y: clamp(sy, EDGE, H - e.ph - EDGE), w: e.pw, h: e.ph };
    let hit = false;
    for (const o of rects) {
      if (overlaps(cand, o, 1)) {
        hit = true;
        break;
      }
    }
    if (!hit) return cand;
  }
  return null;
}

function hidePill(e: TagEntry) {
  if (e.pill.style.display !== 'none') e.pill.style.display = 'none';
  e.pillShown = false;
  e.plx = -1e9;
}

function groupText(gc: GroupChip): string {
  const mode = gc.g.mode ?? 'bits';
  if (mode === 'rows') {
    const rows: [string, string][] = [];
    for (const m of gc.members) for (const l of m.lines) rows.push([l.alias, formatValue(l)]);
    const w = Math.max(...rows.map((r) => r[0].length));
    return rows.map(([a, v]) => `${a.padEnd(w)} ${v}`).join('\n');
  }
  let bits = '';
  gc.members.forEach((m, i) => {
    if (i > 0 && i % 4 === 0) bits += ' ';
    bits += pillValue(m);
  });
  return bits;
}

function buildGroupChip(g: TagGroup): GroupChip {
  const el = document.createElement('div');
  el.style.cssText = GROUP_CSS;
  el.dataset.tagGroup = g.id;
  const head = document.createElement('div');
  head.style.cssText = "font:700 9.5px/1.3 'Inter Variable',Inter,sans-serif;color:#94a3b8;letter-spacing:0.02em;";
  head.textContent = g.label;
  const body = document.createElement('div');
  body.style.cssText = 'color:#f8fafc;font-weight:600;';
  el.appendChild(head);
  el.appendChild(body);
  return { g, el, body, members: [], text: '', shown: false, collapse: false, w: 0, h: 0, lx: -1e9, ly: -1e9 };
}

type ChipParts = Omit<TagEntry, 'anchor' | 'frame' | 'center' | 'radius' | 'facing' | 'pin' | 'group' | 'order' | 'active'>;

function buildChip(id: string, title: string, lines: IoTagLine[]): ChipParts {
  const el = document.createElement('div');
  el.style.cssText = CHIP_CSS;
  el.dataset.tag = id;
  const box = document.createElement('div');
  box.style.cssText = BOX_CSS;
  const t = document.createElement('div');
  t.style.cssText = "display:none;font:600 10px/1.3 'Inter Variable',Inter,sans-serif;color:#94a3b8;margin-bottom:2px;letter-spacing:0.02em;";
  t.textContent = title;
  box.appendChild(t);
  const values: HTMLSpanElement[] = [];
  const forces: HTMLSpanElement[] = [];
  for (const l of lines) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;';
    const alias = document.createElement('span');
    alias.style.cssText = `font-weight:600;color:${l.address ? (l.dir === 'input' ? '#67e8f9' : '#fcd34d') : '#c4b5fd'};`;
    alias.textContent = l.alias;
    row.appendChild(alias);
    if (l.address) {
      const sep = document.createElement('span');
      sep.style.color = '#64748b';
      sep.textContent = '·';
      row.appendChild(sep);
      const addr = document.createElement('span');
      addr.style.color = '#94a3b8';
      addr.textContent = l.address;
      row.appendChild(addr);
      const sep2 = document.createElement('span');
      sep2.style.color = '#64748b';
      sep2.textContent = '·';
      row.appendChild(sep2);
    }
    const val = document.createElement('span');
    val.style.cssText = l.analog
      ? 'color:#f8fafc;font-weight:600;'
      : 'display:inline-block;min-width:14px;text-align:center;border-radius:3px;padding:0 3px;font-weight:700;background:#334155;color:#cbd5e1;';
    val.textContent = l.analog ? '0.0' : '0';
    row.appendChild(val);
    const f = document.createElement('span');
    f.style.cssText = 'display:none;border-radius:3px;padding:0 3px;font-weight:700;background:#f59e0b;color:#111;';
    f.textContent = 'F';
    f.title = 'forced';
    row.appendChild(f);
    values.push(val);
    forces.push(f);
    box.appendChild(row);
  }
  el.appendChild(box);
  const leader = document.createElement('div');
  leader.style.cssText = 'width:1px;height:6px;margin:0 auto;background:rgba(203,213,225,0.7);';
  el.appendChild(leader);
  // compact pill
  const pill = document.createElement('div');
  pill.style.cssText = PILL_CSS;
  pill.dataset.tagPill = id;
  const pa = document.createElement('span');
  pa.style.cssText = 'display:none;color:inherit;opacity:0.85;margin-right:4px;font-weight:600;';
  pa.textContent = lines[0]?.alias ?? '';
  const pv = document.createElement('span');
  pv.style.cssText = 'font-weight:700;';
  pill.appendChild(pa);
  pill.appendChild(pv);
  return {
    id,
    lines,
    el,
    box,
    title: t,
    values,
    forces,
    leader,
    lastVals: lines.map(() => ''),
    lastForce: lines.map(() => false),
    shown: false,
    occluded: false,
    back: false,
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    lx: 0,
    ly: 0,
    lnudge: 0,
    titleShown: false,
    depth: 0,
    pill,
    pillAlias: pa,
    pillVal: pv,
    pillShown: false,
    pillText: '',
    pillWide: false,
    narrowed: false,
    pw: 0,
    ph: 0,
    plx: -1e9,
    ply: -1e9,
    cx: 0,
    cy: 0,
    pr: 0,
    vis: false,
    stamp: 0,
  };
}

let tagSeq = 0;

/** Pointer cursor (+ optional hover outline) while hovering a clickable proxy (does not stop propagation). */
function useCursorOnHover(enabled: boolean, isActive: () => boolean, outline?: { current: THREE.Object3D | null }) {
  const gl = useThree((st) => st.gl);
  useEffect(
    () => () => {
      if (enabled) gl.domElement.style.cursor = '';
    },
    [enabled, gl],
  );
  return useMemo(
    () => ({
      over: () => {
        if (!enabled || !isActive()) return;
        gl.domElement.style.cursor = 'pointer';
        if (outline?.current) outline.current.visible = true;
      },
      leave: () => {
        if (!enabled) return;
        gl.domElement.style.cursor = '';
        if (outline?.current) outline.current.visible = false;
      },
    }),
    [enabled, gl, isActive, outline],
  );
}

/** Thin rectangular frame (hover cue for clickable proxies), in the XY plane. */
function outlineGeo(w: number, h: number) {
  return kgeo(`k:outline:${w.toFixed(4)}:${h.toFixed(4)}`, () => {
    const t = Math.max(0.0009, Math.min(w, h) * 0.035);
    const r = Math.min(w, h) * 0.18;
    const rr = (sh: THREE.Shape | THREE.Path, x: number, y: number, ww: number, hh: number, rad: number) => {
      sh.moveTo(x + rad, y);
      sh.lineTo(x + ww - rad, y);
      sh.quadraticCurveTo(x + ww, y, x + ww, y + rad);
      sh.lineTo(x + ww, y + hh - rad);
      sh.quadraticCurveTo(x + ww, y + hh, x + ww - rad, y + hh);
      sh.lineTo(x + rad, y + hh);
      sh.quadraticCurveTo(x, y + hh, x, y + hh - rad);
      sh.lineTo(x, y + rad);
      sh.quadraticCurveTo(x, y, x + rad, y);
    };
    const shape = new THREE.Shape();
    rr(shape, -w / 2, -h / 2, w, h, r);
    const hole = new THREE.Path();
    rr(hole, -w / 2 + t, -h / 2 + t, w - 2 * t, h - 2 * t, Math.max(0, r - t));
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape, 6);
  });
}

const outlineMat = () =>
  kmat('k:outline-mat', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#58c8ff').multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false }));

/** Max pointer travel (px) between down and up for a click on a proxy (larger = a camera drag). */
const CLICK_SLOP = 6;

export interface IoTagProps {
  /** Device center (parent coordinates). */
  position: Vec3;
  rotation?: Vec3;
  /** Hover proxy box size around the device (device-local). */
  size: Vec3;
  /** Center of the hover proxy box relative to `position` (default: origin). */
  center?: Vec3;
  /** Chip anchor, relative to `position` (device-local); default: just above the proxy box. */
  anchor?: Vec3;
  /**
   * Make the whole proxy a click target (fires once per click, drag-safe). Receives the hit point in the
   * device frame (e.g. to tell the left/right half of a selector). The click is NOT passed on to the
   * device underneath, so give the device no own click handler for the same control (or keep it purely
   * cosmetic): one physical click = one action.
   */
  onPress?: (local: THREE.Vector3) => void;
  /** Momentary proxy: pointer down = press, pointer up anywhere = release (the device gets neither). */
  momentary?: { onPress: () => void; onRelease: () => void };
  /** When given and false, the tag neither shows nor reacts (e.g. a fault marker without the fault). */
  active?: () => boolean;
  /** Hide the chip while the camera is behind the device's panel (the frame's +Z). Default false. */
  facing?: boolean;
  /** Take part in the pinned overlay (showTags). Default true. */
  pin?: boolean;
  /** Pinned-overlay group (summary chip when the members are small on screen). */
  group?: TagGroup;
  /** Device title shown on hover, e.g. '800F green flush PB (N.O.)'. */
  title: string;
  lines: Line[];
  /** Children rendered inside the device frame (e.g. the device itself). */
  children?: ReactNode;
}

/**
 * Hover zone + floating chip for one physical device. Without `onPress` / `momentary` the invisible hover
 * proxy never stops event propagation, so the device underneath still receives its clicks.
 */
export function IoTag({ position, rotation, size, center = [0, 0, 0], anchor, title, lines, onPress, momentary, active, facing = false, pin = true, group, children }: IoTagProps) {
  const reg = useContext(RegistryContext);
  const frameRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<THREE.Group>(null);
  const centerRef = useRef<THREE.Group>(null);
  const id = useMemo(() => `tag${++tagSeq}`, []);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const activeRef = useRef(active);
  activeRef.current = active;
  const isActive = useMemo(() => () => (activeRef.current ? activeRef.current() : true), []);
  const radius = Math.max(size[0], size[1]) / 2;
  const groupKey = group ? `${group.id}|${group.label}|${group.mode ?? ''}` : '';
  useLayoutEffect(() => {
    if (!reg || !anchorRef.current || !frameRef.current || !centerRef.current) return;
    const e: TagEntry = {
      ...buildChip(id, title, linesRef.current),
      order: ++reg.seq,
      anchor: anchorRef.current,
      frame: frameRef.current,
      center: centerRef.current,
      radius,
      facing,
      pin,
      group,
      active: isActive,
    };
    reg.add(e);
    return () => reg.remove(id);
  }, [reg, id, title, radius, facing, pin, groupKey, lines.map((l) => l.alias + l.address).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlers = useMemo(
    () => ({
      onPointerMove: (ev: ThreeEvent<PointerEvent>) => {
        if (!reg || !isActive()) return;
        for (const hit of ev.intersections) {
          const tid = (hit.object.userData as { ioTag?: string }).ioTag;
          if (tid) {
            const ent = reg.entries.get(tid);
            if (ent?.active && !ent.active()) continue;
            if (tid === id) reg.hovered = id;
            return;
          }
        }
      },
      onPointerOut: () => {
        if (reg && reg.hovered === id) reg.hovered = null;
      },
    }),
    [reg, id],
  );
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  const momRef = useRef(momentary);
  momRef.current = momentary;
  const clickable = !!onPress || !!momentary;
  const press = useMemo(() => {
    if (!clickable) return {};
    const local = new THREE.Vector3();
    return {
      onPointerDown: (ev: ThreeEvent<PointerEvent>) => {
        if (ev.button !== 0 || !isActive()) return;
        ev.stopPropagation();
        const m = momRef.current;
        if (!m) return;
        m.onPress();
        let done = false;
        const release = () => {
          if (done) return;
          done = true;
          window.removeEventListener('pointerup', release);
          window.removeEventListener('pointercancel', release);
          window.removeEventListener('blur', release);
          momRef.current?.onRelease();
        };
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        window.addEventListener('blur', release);
      },
      onClick: (ev: ThreeEvent<MouseEvent>) => {
        if (ev.button !== 0 || !isActive()) return;
        ev.stopPropagation();
        const fn = pressRef.current;
        if (!fn || momRef.current || ev.delta > CLICK_SLOP) return;
        local.copy(ev.point);
        frameRef.current?.worldToLocal(local);
        fn(local);
      },
    };
  }, [clickable]); // eslint-disable-line react-hooks/exhaustive-deps
  const outline = useRef<THREE.Mesh>(null);
  const cursor = useCursorOnHover(clickable, isActive, outline);
  const a: Vec3 = anchor ?? [center[0], center[1] + size[1] / 2 + 0.004, center[2]];
  return (
    <group ref={frameRef} position={position} rotation={rotation}>
      {children}
      <mesh
        visible={false}
        geometry={KBOX()}
        position={center}
        scale={size}
        userData={{ ioTag: id }}
        {...handlers}
        {...press}
        onPointerOver={cursor.over}
        onPointerLeave={cursor.leave}
      />
      <group ref={centerRef} position={[center[0], center[1], center[2] + size[2] / 2]} />
      <group ref={anchorRef} position={a} />
      {clickable && (
        <mesh ref={outline} visible={false} geometry={outlineGeo(size[0], size[1])} material={outlineMat()} position={[center[0], center[1], center[2] - size[2] / 2 + 0.0012]} renderOrder={3} />
      )}
    </group>
  );
}
