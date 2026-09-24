/**
 * Scene-composition kit shared by the `trainer` and `motor-station` views (owned by those scenes).
 *
 *  - <TagLayer> + <IoTag>: the LEARNING OVERLAY. Every wired device gets an invisible hover proxy; hovering
 *    it (or turning on `useSceneOverlay().showTags`) shows a small floating chip
 *    "Start_PB · Local:1:I.Data.0 · 1" with the live tag value. Chips are plain DOM elements positioned
 *    by ONE useFrame for the whole layer (no drei <Html>: its React root is not StrictMode-safe under
 *    React 19), occlusion-tested against a few coarse boxes (walls, cabinet, bench) and de-cluttered.
 *  - Control helpers (momentary / toggle / selector wiring to runtime.setControl + click sounds).
 *  - Sound helpers (throttled sfx loops driven from state, one-shots on transitions, stop on unmount).
 *  - Environment props: procedural concrete / block wall / vinyl tile textures, conduit, ladder cable
 *    tray, cables, light fixtures, signs, hazard tape.
 */
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { sfx, type LoopName, type SfxName } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import { filletedPath } from '../../../twin/devices/panel/Wire';
import type { SimRuntime } from '../../types';
import { useSceneOverlay } from '../overlay';

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
  castShadow = true,
}: {
  points: Vec3[];
  radius: number;
  material: THREE.Material;
  bend?: number;
  radial?: number;
  castShadow?: boolean;
}) {
  const key = JSON.stringify(points);
  const geo = useMemo(() => {
    const path = filletedPath(points, bend);
    const len = path.getLength();
    return new THREE.TubeGeometry(path, Math.min(400, Math.max(6, Math.round(len / 0.03))), radius, radial, false);
  }, [key, radius, bend, radial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} castShadow={castShadow} />;
}

/** Rigid EMT conduit run (galvanized) with compression couplings at both ends and pipe straps. */
export function Conduit({ points, radius = 0.0115, bend = 0.12, straps = [] }: { points: Vec3[]; radius?: number; bend?: number; straps?: Vec3[] }) {
  const ends = useMemo(() => {
    const out: { p: Vec3; q: THREE.Quaternion }[] = [];
    const n = points.length;
    if (n < 2) return out;
    const up = new THREE.Vector3(0, 1, 0);
    const mk = (a: Vec3, b: Vec3) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      return new THREE.Quaternion().setFromUnitVectors(up, d);
    };
    out.push({ p: points[0], q: mk(points[0], points[1]) });
    out.push({ p: points[n - 1], q: mk(points[n - 2], points[n - 1]) });
    return out;
  }, [JSON.stringify(points)]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = kgeo(`k:conduitfit:${radius}`, () => new THREE.CylinderGeometry(radius * 1.35, radius * 1.35, 0.045, 14).translate(0, 0.0225, 0));
  const strap = kgeo(`k:strap:${radius}`, () => new THREE.TorusGeometry(radius * 1.12, 0.0022, 6, 16, Math.PI));
  return (
    <group>
      <Tube points={points} radius={radius} bend={bend} material={km.galv()} />
      {ends.map((e, i) => (
        <mesh key={i} geometry={fit} material={km.metal('#a9aeb2', 0.4)} position={e.p} quaternion={e.q} />
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
  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, items.length)]} castShadow={castShadow} receiveShadow={receiveShadow} frustumCulled={false} />;
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
  const rungs = useMemo(() => {
    const out: { p: Vec3 }[] = [];
    const n = Math.max(2, Math.floor(length / 0.25));
    for (let i = 0; i <= n; i++) out.push({ p: [-length / 2 + 0.06 + (i * (length - 0.12)) / n, 0.012, 0] });
    return out;
  }, [length]);
  const rot: Vec3 = axis === 'x' ? [0, 0, 0] : [0, -Math.PI / 2, 0];
  const center: Vec3 = axis === 'x' ? [start[0] + length / 2, start[1], start[2]] : [start[0], start[1], start[2] + length / 2];
  const rungGeo = kgeo(`k:trayrung:${width}`, () => new THREE.BoxGeometry(0.025, 0.018, width));
  return (
    <group position={center} rotation={rot}>
      {[-1, 1].map((s) => (
        <group key={s} position={[0, sideH / 2, (s * width) / 2]}>
          <mesh geometry={KBOX()} material={km.galv()} scale={[length, sideH, 0.004]} castShadow receiveShadow />
          <mesh geometry={KBOX()} material={km.galv()} scale={[length, 0.004, 0.022]} position={[0, sideH / 2, -s * 0.011]} />
          <mesh geometry={KBOX()} material={km.galv()} scale={[length, 0.004, 0.022]} position={[0, -sideH / 2, -s * 0.011]} />
        </group>
      ))}
      <Instances geometry={rungGeo} material={km.galv()} items={rungs} />
      {cables.map((c, i) => (
        <mesh
          key={i}
          geometry={KCYL()}
          material={km.plastic(c, 0.6)}
          rotation={[0, 0, Math.PI / 2]}
          position={[0, 0.021 + 0.009 + (i % 2) * 0.012, -width / 2 + 0.04 + i * 0.026]}
          scale={[0.018, length, 0.018]}
        />
      ))}
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
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={KBOX()} material={km.paint('#d9d9d6', 0.5)} scale={[size[0], size[1], thickness]} position={[0, 0, thickness / 2]} />
      <mesh geometry={KPLANE()} material={km.label(tex, 0.55)} scale={[size[0], size[1], 1]} position={[0, 0, thickness + 0.0003]} />
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

interface TagEntry {
  id: string;
  anchor: THREE.Object3D;
  lines: (IoTagLine & { decimals?: number })[];
  el: HTMLDivElement;
  title: HTMLDivElement;
  values: HTMLSpanElement[];
  forces: HTMLSpanElement[];
  leader: HTMLDivElement;
  lastVals: string[];
  lastForce: boolean[];
  shown: boolean;
  occluded: boolean;
  w: number;
  h: number;
  x: number;
  y: number;
  lx: number;
  ly: number;
  lnudge: number;
  titleShown: boolean;
  depth: number;
}

const CHIP_CSS =
  'position:absolute;left:0;top:0;display:none;pointer-events:none;will-change:transform;transition:opacity 120ms linear;';
const BOX_CSS =
  "background:rgba(10,14,20,0.9);border:1px solid rgba(148,163,184,0.35);border-radius:6px;padding:3px 7px 3px 6px;color:#e5e7eb;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.45);font:500 10.5px/1.35 'JetBrains Mono',ui-monospace,monospace;";

class TagRegistry {
  entries = new Map<string, TagEntry>();
  container: HTMLDivElement | null = null;
  hovered: string | null = null;
  showTags = false;
  boxes: THREE.Box3[] = [];

  add(e: TagEntry) {
    this.entries.set(e.id, e);
    this.container?.appendChild(e.el);
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    e.el.remove();
    this.entries.delete(id);
    if (this.hovered === id) this.hovered = null;
  }

  attach(c: HTMLDivElement) {
    this.container = c;
    for (const e of this.entries.values()) c.appendChild(e.el);
  }
}

const RegistryContext = createContext<TagRegistry | null>(null);

const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _ray = new THREE.Ray();
const _inv = new THREE.Matrix4();
const _tmp = new THREE.Vector3();

function formatValue(l: IoTagLine & { decimals?: number }): string {
  if (l.format) return l.format();
  const v = l.get();
  if (!l.analog) return v ? '1' : '0';
  const d = l.decimals ?? 1;
  return `${v.toFixed(d)}${l.units ? ` ${l.units}` : ''}`;
}

/**
 * Hosts the I/O tag chips of one scene view. `occluders` are coarse boxes [min, max] in this group's
 * coordinates (walls, cabinets, benches); a chip whose anchor is hidden behind one fades out.
 */
export function TagLayer({ children, occluders = [] }: { children: ReactNode; occluders?: Array<[Vec3, Vec3]> }) {
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
    c.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5;';
    c.dataset.plcwTags = '1';
    parent.appendChild(c);
    reg.attach(c);
    return () => {
      c.remove();
      reg.container = null;
    };
  }, [gl, reg]);

  const timers = useRef({ text: 0, occ: 0 });
  const placed = useMemo<TagEntry[]>(() => [], []);

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
    const f = frame.current;
    if (f) {
      _inv.copy(f.matrixWorld).invert();
      camera.getWorldPosition(_cam).applyMatrix4(_inv);
    }
    placed.length = 0;
    for (const e of reg.entries.values()) {
      const want = reg.showTags || reg.hovered === e.id;
      if (!want) {
        if (e.shown) {
          e.el.style.display = 'none';
          e.shown = false;
        }
        continue;
      }
      e.anchor.getWorldPosition(_v);
      // occlusion (in layer coordinates)
      if ((doOcc || !e.shown) && f) {
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
        if (occ !== e.occluded || !e.shown) {
          e.occluded = occ;
          e.el.style.opacity = occ ? '0' : '1';
        }
        e.anchor.getWorldPosition(_v);
      }
      // projection
      _v.project(camera);
      if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.3 || Math.abs(_v.y) > 1.3) {
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
        const tt = reg.hovered === e.id;
        e.title.style.display = tt ? 'block' : 'none';
        e.titleShown = tt;
        e.w = e.el.offsetWidth;
        e.h = e.el.offsetHeight;
      }
      const wantTitle = reg.hovered === e.id;
      if (wantTitle !== e.titleShown) {
        e.titleShown = wantTitle;
        e.title.style.display = wantTitle ? 'block' : 'none';
        e.w = e.el.offsetWidth;
        e.h = e.el.offsetHeight;
      }
      e.x = (_v.x * 0.5 + 0.5) * size.width;
      e.y = (-_v.y * 0.5 + 0.5) * size.height;
      e.depth = _v.z;
      if (doText) {
        let changed = false;
        for (let i = 0; i < e.lines.length; i++) {
          const l = e.lines[i]!;
          const s = formatValue(l);
          if (s !== e.lastVals[i]) {
            e.lastVals[i] = s;
            const span = e.values[i]!;
            span.textContent = s;
            span.style.display = s ? '' : 'none';
            if (!l.analog) {
              const on = s === '1';
              span.style.background = on ? '#16a34a' : '#334155';
              span.style.color = on ? '#f0fdf4' : '#cbd5e1';
            }
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
          e.w = e.el.offsetWidth;
          e.h = e.el.offsetHeight;
        }
      }
      placed.push(e);
    }
    // de-clutter: hovered first, then near-to-far; push overlapping chips upward
    placed.sort((a, b) => (a.id === reg.hovered ? -1 : b.id === reg.hovered ? 1 : a.depth - b.depth));
    const GAP = 3;
    for (let i = 0; i < placed.length; i++) {
      const e = placed[i]!;
      let nudge = 0;
      for (let iter = 0; iter < 8; iter++) {
        const top = e.y - e.h - nudge;
        const left = e.x - e.w / 2;
        let moved = false;
        for (let j = 0; j < i; j++) {
          const o = placed[j]!;
          const ot = o.y - o.h - o.lnudge;
          const ol = o.x - o.w / 2;
          if (left < ol + o.w + GAP && left + e.w + GAP > ol && top < ot + o.h + GAP && top + e.h + GAP > ot) {
            nudge = e.y - (ot - GAP);
            moved = true;
          }
        }
        if (!moved) break;
      }
      if (Math.abs(e.x - e.lx) > 0.3 || Math.abs(e.y - e.ly) > 0.3 || nudge !== e.lnudge) {
        e.lx = e.x;
        e.ly = e.y;
        if (nudge !== e.lnudge) e.leader.style.height = `${6 + nudge}px`;
        e.lnudge = nudge;
        e.el.style.transform = `translate(${e.x.toFixed(1)}px,${e.y.toFixed(1)}px) translate(-50%,-100%)`;
        e.el.style.zIndex = e.id === reg.hovered ? '10' : '1';
      }
    }
  });

  return (
    <group ref={frame}>
      <RegistryContext.Provider value={reg}>{children}</RegistryContext.Provider>
    </group>
  );
}

function buildChip(id: string, title: string, lines: IoTagLine[]): Omit<TagEntry, 'anchor'> {
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
  return {
    id,
    lines,
    el,
    title: t,
    values,
    forces,
    leader,
    lastVals: lines.map(() => ''),
    lastForce: lines.map(() => false),
    shown: false,
    occluded: false,
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    lx: 0,
    ly: 0,
    lnudge: 0,
    titleShown: false,
    depth: 0,
  };
}

let tagSeq = 0;

/** Pointer cursor while hovering a clickable proxy (does not stop propagation). */
function useCursorOnHover(enabled: boolean) {
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
        if (enabled) gl.domElement.style.cursor = 'pointer';
      },
      leave: () => {
        if (enabled) gl.domElement.style.cursor = '';
      },
    }),
    [enabled, gl],
  );
}

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
  /** Make the whole proxy clickable (pointer down), e.g. for small toggle levers. Stops propagation. */
  onPress?: () => void;
  /** Device title shown on hover, e.g. '800F green flush PB (N.O.)'. */
  title: string;
  lines: (IoTagLine & { decimals?: number })[];
  /** Children rendered inside the device frame (e.g. the device itself). */
  children?: ReactNode;
}

/**
 * Hover zone + floating chip for one physical device. The hover proxy is an invisible box that never stops
 * event propagation, so the device underneath still receives its clicks.
 */
export function IoTag({ position, rotation, size, center = [0, 0, 0], anchor, title, lines, onPress, children }: IoTagProps) {
  const reg = useContext(RegistryContext);
  const anchorRef = useRef<THREE.Group>(null);
  const id = useMemo(() => `tag${++tagSeq}`, []);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  useLayoutEffect(() => {
    if (!reg || !anchorRef.current) return;
    const e: TagEntry = { ...buildChip(id, title, linesRef.current), anchor: anchorRef.current };
    reg.add(e);
    return () => reg.remove(id);
  }, [reg, id, title, lines.map((l) => l.alias + l.address).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlers = useMemo(
    () => ({
      onPointerMove: (ev: ThreeEvent<PointerEvent>) => {
        if (!reg) return;
        for (const hit of ev.intersections) {
          const tid = (hit.object.userData as { ioTag?: string }).ioTag;
          if (tid) {
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
  const press = useMemo(
    () =>
      onPress
        ? {
            onPointerDown: (ev: ThreeEvent<PointerEvent>) => {
              if (ev.button !== 0) return;
              ev.stopPropagation();
              pressRef.current?.();
            },
          }
        : {},
    [!!onPress], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const cursor = useCursorOnHover(!!onPress);
  const a: Vec3 = anchor ?? [center[0], center[1] + size[1] / 2 + 0.004, center[2]];
  return (
    <group position={position} rotation={rotation}>
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
      <group ref={anchorRef} position={a} />
    </group>
  );
}
