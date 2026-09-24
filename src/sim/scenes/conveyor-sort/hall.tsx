/**
 * Factory-hall environment & props shared by the `conveyor-sort` and `tank-process` views:
 *
 *  <FactoryHall>   epoxy-coated concrete floor with scene-painted markings (walkways, hatched keep-clear
 *                  zones, labels), insulated-panel walls with a concrete plinth and a clerestory window
 *                  band, painted H-columns with striped column guards, LED high-bay fixtures.
 *  <CableTray>     ladder-type cable tray along an orthogonal polyline with cables inside.
 *  <SafetyFence>   yellow-post machine guarding with black wire-mesh panels (one mesh + instanced posts).
 *  <PalletStack>   EUR pallet with a stack of cardboard boxes (instanced).
 *  <WallSign>      rectangular printed sign (canvas texture).
 *  <Bollard>, <FireExtinguisher>, <FloorDrain> small props.
 *
 * All geometry is built once (cached) and heavily instanced/merged to keep draw calls low.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxGeometry, boxMaterial } from '../../../twin/devices';
import type { Vec3 } from '../../../twin/contracts';

// ---------------------------------------------------------------------------
// Small caches
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const matCache = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}
const texCache = new Map<string, THREE.Texture>();
function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, color = true): THREE.CanvasTexture {
  let t = texCache.get(key) as THREE.CanvasTexture | undefined;
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    t = new THREE.CanvasTexture(c);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(key, t);
  }
  return t;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const paint = (color: string, roughness = 0.55, metalness = 0.2) =>
  mat(`hall:paint:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
export const steel = (color = '#9aa1a8', roughness = 0.4) =>
  mat(`hall:steel:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.85 }));
export const unitBox = geo('hall:unitBox', () => new THREE.BoxGeometry(1, 1, 1));
export const unitCylY = geo('hall:unitCylY', () => new THREE.CylinderGeometry(1, 1, 1, 18));

/** A static instanced mesh from a list of transforms (position, euler rotation, scale). */
export function Instances({
  geometry,
  material,
  items,
  castShadow = true,
  receiveShadow = true,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: { p: Vec3; r?: Vec3; s?: Vec3; c?: string }[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(...(it.r ?? [0, 0, 0]));
      o.scale.set(...(it.s ?? [1, 1, 1]));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.c) m.setColorAt(i, col.set(it.c));
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} />;
}

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

export interface FloorPainter {
  ctx: CanvasRenderingContext2D;
  /** Meters → pixels. */
  px(m: number): number;
  /** Polyline (world x, z) with a width in meters. */
  line(points: [number, number][], width: number, color: string, dash?: number[]): void;
  rect(x0: number, z0: number, x1: number, z1: number, color: string): void;
  outline(x0: number, z0: number, x1: number, z1: number, width: number, color: string): void;
  /** Diagonal safety hatching (yellow/black by default) inside a rectangle. */
  hatch(x0: number, z0: number, x1: number, z1: number, stripe?: number, colors?: [string, string]): void;
  /** Text centered at (x, z); size = cap height in meters; rot in radians (0 = readable from +Z). */
  text(s: string, x: number, z: number, size: number, color: string, rot?: number): void;
  /** Stencil arrow pointing along `angle` (0 = +X). */
  arrow(x: number, z: number, length: number, angle: number, color: string): void;
}

export const FLOOR_BASE = '#6f7577';
export const YELLOW = '#e8b90c';
export const WALKWAY = '#4f6d5c';

function concreteDetailTex() {
  const t = canvasTexture(
    'hall:concreteDetail',
    512,
    512,
    (ctx, w, h) => {
      const r = rng(77);
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const g = 110 + Math.floor(r() * 60);
        ctx.fillStyle = `rgba(${g},${g},${g},0.35)`;
        ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      for (let i = 0; i < 40; i++) {
        const g = 100 + Math.floor(r() * 80);
        ctx.fillStyle = `rgba(${g},${g},${g},0.12)`;
        ctx.beginPath();
        ctx.ellipse(r() * w, r() * h, 10 + r() * 60, 6 + r() * 30, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // saw-cut control joints
      ctx.fillStyle = 'rgba(30,30,30,0.9)';
      ctx.fillRect(0, 0, w, 2);
      ctx.fillRect(0, 0, 2, h);
    },
    false,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeFloorTexture(floor: [number, number, number, number], paintFloor?: (p: FloorPainter) => void, seed = 1) {
  const [x0, x1, z0, z1] = floor;
  const W = x1 - x0;
  const D = z1 - z0;
  const ppm = Math.min(2048 / W, 2048 / D);
  const cw = Math.round(W * ppm);
  const ch = Math.round(D * ppm);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = FLOOR_BASE;
  ctx.fillRect(0, 0, cw, ch);
  // mottling, tyre marks and stains (inside a margin so the clamped edge stays the base color)
  const r = rng(seed * 991 + 7);
  const m = 8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(m, m, cw - 2 * m, ch - 2 * m);
  ctx.clip();
  for (let i = 0; i < 220; i++) {
    const light = r() > 0.5;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)';
    ctx.beginPath();
    ctx.ellipse(r() * cw, r() * ch, 20 + r() * 160, 10 + r() * 80, r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(20,20,20,0.06)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    ctx.lineWidth = 0.18 * ppm;
    ctx.beginPath();
    const sx = r() * cw;
    const sy = r() * ch;
    ctx.moveTo(sx, sy);
    ctx.bezierCurveTo(sx + (r() - 0.5) * 600, sy + (r() - 0.5) * 600, sx + (r() - 0.5) * 900, sy + (r() - 0.5) * 900, sx + (r() - 0.5) * 1200, sy + (r() - 0.5) * 1200);
    ctx.stroke();
  }
  const X = (x: number) => (x - x0) * ppm;
  const Z = (z: number) => (z - z0) * ppm;
  const painter: FloorPainter = {
    ctx,
    px: (v) => v * ppm,
    line(points, width, color, dash) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width * ppm;
      ctx.lineCap = dash ? 'butt' : 'square';
      ctx.lineJoin = 'miter';
      if (dash) ctx.setLineDash(dash.map((d) => d * ppm));
      ctx.beginPath();
      points.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
      ctx.restore();
    },
    rect(ax, az, bx, bz, color) {
      ctx.fillStyle = color;
      ctx.fillRect(X(Math.min(ax, bx)), Z(Math.min(az, bz)), Math.abs(bx - ax) * ppm, Math.abs(bz - az) * ppm);
    },
    outline(ax, az, bx, bz, width, color) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width * ppm;
      ctx.strokeRect(X(Math.min(ax, bx)) + (width * ppm) / 2, Z(Math.min(az, bz)) + (width * ppm) / 2, Math.abs(bx - ax) * ppm - width * ppm, Math.abs(bz - az) * ppm - width * ppm);
      ctx.restore();
    },
    hatch(ax, az, bx, bz, stripe = 0.1, colors = [YELLOW, '#1b1b1b']) {
      const l = X(Math.min(ax, bx));
      const t = Z(Math.min(az, bz));
      const w = Math.abs(bx - ax) * ppm;
      const h = Math.abs(bz - az) * ppm;
      ctx.save();
      ctx.beginPath();
      ctx.rect(l, t, w, h);
      ctx.clip();
      ctx.fillStyle = colors[1];
      ctx.fillRect(l, t, w, h);
      ctx.fillStyle = colors[0];
      const s = stripe * ppm;
      for (let k = -h; k < w + h; k += 2 * s) {
        ctx.beginPath();
        ctx.moveTo(l + k, t);
        ctx.lineTo(l + k + s, t);
        ctx.lineTo(l + k + s - h, t + h);
        ctx.lineTo(l + k - h, t + h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
    text(s, x, z, size, color, rot = 0) {
      ctx.save();
      ctx.translate(X(x), Z(z));
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.font = `800 ${Math.round(size * ppm * 1.35)}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s, 0, 0);
      ctx.restore();
    },
    arrow(x, z, length, angle, color) {
      ctx.save();
      ctx.translate(X(x), Z(z));
      ctx.rotate(angle);
      ctx.fillStyle = color;
      const L = length * ppm;
      const w = L * 0.22;
      ctx.beginPath();
      ctx.moveTo(-L / 2, -w / 2);
      ctx.lineTo(L * 0.15, -w / 2);
      ctx.lineTo(L * 0.15, -w * 1.1);
      ctx.lineTo(L / 2, 0);
      ctx.lineTo(L * 0.15, w * 1.1);
      ctx.lineTo(L * 0.15, w / 2);
      ctx.lineTo(-L / 2, w / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
  paintFloor?.(painter);
  // worn paint: speckle the markings a little
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(${r() > 0.5 ? '90,95,97' : '60,62,64'},${0.25 + r() * 0.35})`;
    ctx.fillRect(r() * cw, r() * ch, 1 + r() * 2.5, 1 + r() * 2.5);
  }
  ctx.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

function wallPanelTex() {
  const t = canvasTexture('hall:wallPanels', 512, 1024, (ctx, w, h) => {
    // insulated sandwich panels (one panel = 1 m wide texture tile, micro-ribbed) — tile covers 1 m × 8 m
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#b9bec2');
    g.addColorStop(0.5, '#c4c8cb');
    g.addColorStop(1, '#b5babd');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 3, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, 4, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(4, 0, 2, h);
    // concrete plinth (bottom 0.6 m of 8 m)
    const ph = (0.6 / 8) * h;
    ctx.fillStyle = '#8d8f8c';
    ctx.fillRect(0, h - ph, w, ph);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h - ph - 3, w, 3);
    const r = rng(5);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
      ctx.fillRect(r() * w, h - ph + r() * ph, 2, 2);
    }
    // painted safety band above the plinth
    ctx.fillStyle = '#35506b';
    ctx.fillRect(0, h - ph - (0.45 / 8) * h, w, (0.3 / 8) * h);
    // dirt near the floor
    const dg = ctx.createLinearGradient(0, h - ph, 0, h);
    dg.addColorStop(0, 'rgba(40,35,30,0)');
    dg.addColorStop(1, 'rgba(40,35,30,0.35)');
    ctx.fillStyle = dg;
    ctx.fillRect(0, h - ph, w, ph);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function Wall({ length, height, position, rotationY }: { length: number; height: number; position: Vec3; rotationY: number }) {
  const m = useMemo(() => {
    const t = wallPanelTex().clone();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(length, height / 8);
    t.offset.set(0, 1 - height / 8);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.15 });
  }, [length, height]);
  useEffect(() => () => m.dispose(), [m]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh material={m} position={[0, height / 2, 0]} receiveShadow>
        <planeGeometry args={[length, height]} />
      </mesh>
      {/* clerestory window band */}
      <mesh position={[0, height - 1.1, 0.01]} material={windowMat()}>
        <planeGeometry args={[length - 1, 0.9]} />
      </mesh>
      {/* window mullions */}
      <Instances
        geometry={unitBox}
        material={paint('#50575e', 0.6)}
        castShadow={false}
        items={Array.from({ length: Math.floor(length / 1.5) + 1 }, (_, i) => ({ p: [-length / 2 + 0.5 + i * 1.5, height - 1.1, 0.03] as Vec3, s: [0.06, 0.95, 0.05] as Vec3 }))}
      />
    </group>
  );
}

function windowMat() {
  return mat(
    'hall:window',
    () => new THREE.MeshStandardMaterial({ color: '#8fb2cf', emissive: '#a9c8e6', emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.1 }),
  );
}

// ---------------------------------------------------------------------------
// Columns & high-bay lights
// ---------------------------------------------------------------------------

function hColumnGeo(h: number) {
  return geo(`hall:hcol:${h}`, () => {
    const f = 0.3; // flange width
    const d = 0.3; // depth
    const tf = 0.018;
    const tw = 0.011;
    const parts = [
      new THREE.BoxGeometry(f, h, tf).translate(0, h / 2, d / 2 - tf / 2),
      new THREE.BoxGeometry(f, h, tf).translate(0, h / 2, -d / 2 + tf / 2),
      new THREE.BoxGeometry(tw, h, d - 2 * tf).translate(0, h / 2, 0),
      new THREE.BoxGeometry(0.5, 0.02, 0.5).translate(0, 0.01, 0),
    ];
    return mergeGeometries(parts)!;
  });
}

function stripeTex() {
  const t = canvasTexture('hall:stripes', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = YELLOW;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#161616';
    for (let k = -h; k < w + h; k += 64) {
      ctx.beginPath();
      ctx.moveTo(k, 0);
      ctx.lineTo(k + 32, 0);
      ctx.lineTo(k + 32 - h, h);
      ctx.lineTo(k - h, h);
      ctx.closePath();
      ctx.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function stripeMaterial() {
  return mat('hall:stripeMat', () => new THREE.MeshStandardMaterial({ map: stripeTex(), roughness: 0.55, metalness: 0.1 }));
}

function Columns({ at, height }: { at: { x: number; z: number; ry?: number }[]; height: number }) {
  const items = useMemo(() => at.map((c) => ({ p: [c.x, 0, c.z] as Vec3, r: [0, c.ry ?? 0, 0] as Vec3 })), [at]);
  const guards = useMemo(() => at.map((c) => ({ p: [c.x, 0.55, c.z] as Vec3, r: [0, c.ry ?? 0, 0] as Vec3, s: [0.42, 1.1, 0.42] as Vec3 })), [at]);
  return (
    <group>
      <Instances geometry={hColumnGeo(height)} material={paint('#4a5d70', 0.5, 0.35)} items={items} />
      <Instances geometry={unitBox} material={stripeMaterial()} items={guards} />
    </group>
  );
}

function HighBays({ at, y }: { at: [number, number][]; y: number }) {
  const housing = useMemo(() => at.map(([x, z]) => ({ p: [x, y, z] as Vec3, s: [0.55, 0.12, 0.55] as Vec3 })), [at, y]);
  const lens = useMemo(() => at.map(([x, z]) => ({ p: [x, y - 0.065, z] as Vec3, s: [0.46, 0.012, 0.46] as Vec3 })), [at, y]);
  const rods = useMemo(() => at.map(([x, z]) => ({ p: [x, y + 1.5, z] as Vec3, s: [0.01, 3, 0.01] as Vec3 })), [at, y]);
  const lensMat = mat('hall:bayLens', () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#f4f8ff', emissiveIntensity: 3.2, toneMapped: false }));
  return (
    <group>
      <Instances geometry={unitBox} material={paint('#3c4247', 0.4, 0.6)} items={housing} castShadow={false} />
      <Instances geometry={unitBox} material={lensMat} items={lens} castShadow={false} receiveShadow={false} />
      <Instances geometry={unitBox} material={steel('#777d82')} items={rods} castShadow={false} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// FactoryHall
// ---------------------------------------------------------------------------

export interface FactoryHallProps {
  /** Marked floor area [xMin, xMax, zMin, zMax] (the floor itself extends much further). */
  floor: [number, number, number, number];
  backWallZ?: number;
  leftWallX?: number;
  rightWallX?: number;
  wallHeight?: number;
  columns?: { x: number; z: number; ry?: number }[];
  lights?: [number, number][];
  lightY?: number;
  paintFloor?: (p: FloorPainter) => void;
  seed?: number;
}

export function FactoryHall({ floor, backWallZ, leftWallX, rightWallX, wallHeight = 8, columns = [], lights = [], lightY = 6.2, paintFloor, seed = 1 }: FactoryHallProps) {
  const [x0, x1, z0, z1] = floor;
  const S = 70;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const floorMat = useMemo(() => {
    const map = makeFloorTexture(floor, paintFloor, seed);
    const W = x1 - x0;
    const D = z1 - z0;
    map.repeat.set(S / W, S / D);
    map.offset.set((cx - S / 2 - x0) / W, (z1 - cz - S / 2) / D);
    const detail = concreteDetailTex().clone();
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    detail.repeat.set(S / 3, S / 3);
    detail.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, roughnessMap: detail, bumpMap: detail, bumpScale: 0.6, roughness: 0.62, metalness: 0.06, envMapIntensity: 0.9 });
    // paintFloor is expected to be a stable module-level function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x0, x1, z0, z1, seed]);
  useEffect(
    () => () => {
      floorMat.map?.dispose();
      floorMat.roughnessMap?.dispose();
      floorMat.dispose();
    },
    [floorMat],
  );
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} material={floorMat} receiveShadow userData={{ noOcclude: true }}>
        <planeGeometry args={[S, S]} />
      </mesh>
      {backWallZ !== undefined && <Wall length={S} height={wallHeight} position={[cx, 0, backWallZ]} rotationY={0} />}
      {leftWallX !== undefined && <Wall length={S} height={wallHeight} position={[leftWallX, 0, cz]} rotationY={Math.PI / 2} />}
      {rightWallX !== undefined && <Wall length={S} height={wallHeight} position={[rightWallX, 0, cz]} rotationY={-Math.PI / 2} />}
      {columns.length > 0 && <Columns at={columns} height={wallHeight} />}
      {lights.length > 0 && <HighBays at={lights} y={lightY} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cable tray
// ---------------------------------------------------------------------------

export interface CableTrayProps {
  /** Orthogonal polyline of the tray bottom centerline. */
  points: Vec3[];
  width?: number;
  depth?: number;
  cables?: string[];
  /** Hanger rods up to this height (for horizontal runs). */
  hangTo?: number;
}

const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();

export function CableTray({ points, width = 0.3, depth = 0.08, cables = ['#2b2b2b', '#1f4fd1', '#3a3a3a', '#6b6f73', '#e8b90f'], hangTo }: CableTrayProps) {
  const data = useMemo(() => {
    const rails: { p: Vec3; r: Vec3; s: Vec3 }[] = [];
    const rungs: { p: Vec3; r: Vec3; s: Vec3 }[] = [];
    const hangers: { p: Vec3; s: Vec3 }[] = [];
    const sides: THREE.Vector3[] = [];
    // side vectors: horizontal segments -> up × dir; vertical -> inherit neighbour
    for (let i = 0; i < points.length - 1; i++) {
      _t.set(points[i + 1]![0] - points[i]![0], points[i + 1]![1] - points[i]![1], points[i + 1]![2] - points[i]![2]).normalize();
      if (Math.abs(_t.y) < 0.9) sides[i] = new THREE.Vector3().crossVectors(_up, _t).normalize();
    }
    for (let i = 0; i < points.length - 1; i++) {
      if (!sides[i]) sides[i] = (sides[i - 1] ?? sides[i + 1] ?? new THREE.Vector3(1, 0, 0)).clone();
    }
    const euler = new THREE.Euler();
    for (let i = 0; i < points.length - 1; i++) {
      const a = new THREE.Vector3(...points[i]!);
      const b = new THREE.Vector3(...points[i + 1]!);
      const L = a.distanceTo(b);
      _t.subVectors(b, a).normalize();
      _s.copy(sides[i]!);
      _n.crossVectors(_t, _s).normalize();
      if (_n.y < -0.1 || (Math.abs(_n.y) < 0.1 && _n.z < 0)) _n.negate();
      // basis: x = side, y = normal, z = along
      _m.makeBasis(_s, _n, _t);
      euler.setFromRotationMatrix(_m);
      const r: Vec3 = [euler.x, euler.y, euler.z];
      for (const k of [-1, 1]) {
        const c = a.clone().addScaledVector(_t, L / 2).addScaledVector(_s, (k * width) / 2).addScaledVector(_n, depth / 2);
        rails.push({ p: c.toArray() as Vec3, r, s: [0.004, depth, L + (i > 0 ? 0 : 0)] });
      }
      const n = Math.max(1, Math.floor(L / 0.3));
      for (let j = 0; j <= n; j++) {
        const c = a.clone().addScaledVector(_t, (j / n) * L).addScaledVector(_n, 0.006);
        rungs.push({ p: c.toArray() as Vec3, r, s: [width, 0.012, 0.022] });
      }
      if (hangTo !== undefined && Math.abs(_t.y) < 0.1) {
        const m = Math.max(1, Math.floor(L / 1.5));
        for (let j = 0; j <= m; j++) {
          const c = a.clone().addScaledVector(_t, (j / m) * L);
          for (const k of [-1, 1]) {
            const x = c.clone().addScaledVector(_s, (k * (width + 0.03)) / 2);
            const len = hangTo - x.y;
            if (len > 0.05) hangers.push({ p: [x.x, x.y + len / 2, x.z], s: [0.006, len, 0.006] });
          }
        }
      }
    }
    // cable polylines, offset inside the tray
    const lines: Vec3[][] = cables.map((_, ci) => {
      const off = (ci - (cables.length - 1) / 2) * Math.min(0.035, (width - 0.04) / Math.max(1, cables.length));
      const pts: Vec3[] = [];
      for (let i = 0; i < points.length; i++) {
        const s0 = sides[Math.min(i, sides.length - 1)]!;
        const s1 = sides[Math.max(0, i - 1)]!;
        const sv = s0.clone().add(s1).normalize();
        const seg = Math.min(i, points.length - 2);
        _t.set(points[seg + 1]![0] - points[seg]![0], points[seg + 1]![1] - points[seg]![1], points[seg + 1]![2] - points[seg]![2]).normalize();
        _n.crossVectors(_t, sides[seg]!).normalize();
        if (_n.y < -0.1 || (Math.abs(_n.y) < 0.1 && _n.z < 0)) _n.negate();
        const p = new THREE.Vector3(...points[i]!).addScaledVector(sv, off).addScaledVector(_n, 0.02 + (ci % 2) * 0.012);
        pts.push(p.toArray() as Vec3);
      }
      // round the corners: add points just before/after each interior vertex
      const out: Vec3[] = [pts[0]!];
      for (let i = 1; i < pts.length - 1; i++) {
        const p = new THREE.Vector3(...pts[i]!);
        const pa = new THREE.Vector3(...pts[i - 1]!);
        const pb = new THREE.Vector3(...pts[i + 1]!);
        out.push(p.clone().lerp(pa, Math.min(0.12 / p.distanceTo(pa), 0.45)).toArray() as Vec3);
        out.push(p.clone().lerp(pb, Math.min(0.12 / p.distanceTo(pb), 0.45)).toArray() as Vec3);
      }
      out.push(pts[pts.length - 1]!);
      return out;
    });
    return { rails, rungs, hangers, lines };
  }, [JSON.stringify(points), width, depth, cables.join(','), hangTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const galv = steel('#aeb4b8', 0.45);
  return (
    <group>
      <Instances geometry={unitBox} material={galv} items={data.rails} />
      <Instances geometry={unitBox} material={galv} items={data.rungs} />
      <Instances geometry={unitBox} material={steel('#8d9398', 0.5)} items={data.hangers} castShadow={false} />
      <Cables cables={data.lines.map((pts, i) => ({ points: pts, radius: 0.009, color: cables[i] }))} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Safety fence (machine guarding)
// ---------------------------------------------------------------------------

function meshAlphaTex() {
  const t = canvasTexture(
    'hall:fenceMesh',
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = '#262626';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d0d0d0';
      const cell = 32;
      for (let x = 0; x < w; x += cell) ctx.fillRect(x, 0, 5, h);
      for (let y = 0; y < h; y += cell) ctx.fillRect(0, y, w, 5);
    },
    false,
  );
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface SafetyFenceProps {
  /** Fence runs as [x, z] polylines (panels between consecutive points; max ~1.5 m per panel is added automatically). */
  runs: [number, number][][];
  height?: number;
}

export function SafetyFence({ runs, height = 1.9 }: SafetyFenceProps) {
  const data = useMemo(() => {
    const posts: { p: Vec3; s: Vec3 }[] = [];
    const feet: { p: Vec3; s: Vec3; r: Vec3 }[] = [];
    const frames: { p: Vec3; r: Vec3; s: Vec3 }[] = [];
    const panels: THREE.BufferGeometry[] = [];
    const bottom = 0.15;
    const ph = height - bottom - 0.04;
    for (const run of runs) {
      for (let i = 0; i < run.length - 1; i++) {
        const [ax, az] = run[i]!;
        const [bx, bz] = run[i + 1]!;
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 1.5));
        const ang = Math.atan2(-(bz - az), bx - ax);
        for (let k = 0; k < n; k++) {
          const f0 = k / n;
          const f1 = (k + 1) / n;
          const px0 = ax + (bx - ax) * f0;
          const pz0 = az + (bz - az) * f0;
          const px1 = ax + (bx - ax) * f1;
          const pz1 = az + (bz - az) * f1;
          const mx = (px0 + px1) / 2;
          const mz = (pz0 + pz1) / 2;
          const pl = len / n - 0.07;
          const g = new THREE.PlaneGeometry(pl, ph);
          const uv = g.attributes.uv as THREE.BufferAttribute;
          for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * (pl / 0.05), uv.getY(j) * (ph / 0.05));
          g.rotateY(ang);
          g.translate(mx, bottom + ph / 2 + 0.02, mz);
          panels.push(g);
          for (const y of [bottom + 0.02, bottom + ph + 0.02]) frames.push({ p: [mx, y, mz], r: [0, ang, 0], s: [pl, 0.02, 0.02] });
          frames.push({ p: [mx, bottom + 0.02 + ph / 2, mz], r: [0, ang, 0], s: [pl, 0.012, 0.012] });
        }
        for (let k = 0; k <= n; k++) {
          if (i > 0 && k === 0) continue;
          const x = ax + ((bx - ax) * k) / n;
          const z = az + ((bz - az) * k) / n;
          posts.push({ p: [x, height / 2, z], s: [0.06, height, 0.06] });
          feet.push({ p: [x, 0.005, z], s: [0.14, 0.01, 0.14], r: [0, ang, 0] });
        }
      }
    }
    const merged = panels.length ? mergeGeometries(panels) : null;
    panels.forEach((g) => g.dispose());
    return { posts, feet, frames, merged };
  }, [JSON.stringify(runs), height]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => data.merged?.dispose(), [data]);
  const meshMat = mat(
    'hall:fenceMeshMat',
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1c1d1f',
        roughness: 0.5,
        metalness: 0.5,
        alphaMap: meshAlphaTex(),
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
  );
  return (
    <group>
      <Instances geometry={unitBox} material={paint(YELLOW, 0.45, 0.3)} items={data.posts} />
      <Instances geometry={unitBox} material={paint(YELLOW, 0.45, 0.3)} items={data.feet} />
      <Instances geometry={unitBox} material={paint('#1f2023', 0.5, 0.4)} items={data.frames} />
      {data.merged && <mesh geometry={data.merged} material={meshMat} castShadow userData={{ noOcclude: true }} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Pallets & box stacks
// ---------------------------------------------------------------------------

/** EUR pallet 1.2 × 0.8 × 0.144 m, origin at the floor center, long side along X. */
export function palletGeometry() {
  return geo('hall:pallet', () => {
    const parts: THREE.BufferGeometry[] = [];
    // top deck boards (along X)
    for (const z of [-0.345, -0.17, 0, 0.17, 0.345]) parts.push(new THREE.BoxGeometry(1.2, 0.022, z === 0 || Math.abs(z) > 0.3 ? 0.145 : 0.1).translate(0, 0.133, z));
    // stringer boards (along Z) under the deck
    for (const x of [-0.53, 0, 0.53]) parts.push(new THREE.BoxGeometry(0.145, 0.022, 0.8).translate(x, 0.111, 0));
    // blocks
    for (const x of [-0.53, 0, 0.53]) for (const z of [-0.345, 0, 0.345]) parts.push(new THREE.BoxGeometry(0.145, 0.078, x === 0 ? 0.145 : 0.1).translate(x, 0.061, z));
    // bottom boards
    for (const z of [-0.345, 0, 0.345]) parts.push(new THREE.BoxGeometry(1.2, 0.022, 0.1).translate(0, 0.011, z));
    return mergeGeometries(parts)!;
  });
}

export function woodMaterial() {
  return mat('hall:wood', () => {
    const t = canvasTexture('hall:woodTex', 256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#b89668';
      ctx.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let i = 0; i < 90; i++) {
        ctx.strokeStyle = `rgba(${90 + r() * 40},${60 + r() * 30},${30 + r() * 20},${0.15 + r() * 0.2})`;
        ctx.lineWidth = 1 + r() * 2;
        ctx.beginPath();
        const y = r() * h;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 8, w * 0.6, y + (r() - 0.5) * 8, w, y + (r() - 0.5) * 6);
        ctx.stroke();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0 });
  });
}

export interface PalletStackProps {
  position?: Vec3;
  rotationY?: number;
  /** Boxes on the pallet: 'short' / 'tall' and grid (cols along X, rows along Z, layers). */
  kind?: 'short' | 'tall';
  cols?: number;
  rows?: number;
  layers?: number;
  /** Only the first `count` boxes are placed (partial stack). */
  count?: number;
  /** Stretch-wrap film over the stack. */
  wrapped?: boolean;
}

export function PalletStack({ position = [0, 0, 0], rotationY = 0, kind = 'short', cols = 4, rows = 3, layers = 3, count, wrapped = false }: PalletStackProps) {
  const size = kind === 'tall' ? { l: 0.3, h: 0.35, w: 0.25 } : { l: 0.3, h: 0.2, w: 0.2 };
  const items = useMemo(() => {
    const out: { p: Vec3; r: Vec3 }[] = [];
    const n = count ?? cols * rows * layers;
    const r = rng(cols * 31 + rows * 7 + layers);
    for (let k = 0; k < layers; k++)
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          if (out.length >= n) break;
          const x = (i - (cols - 1) / 2) * (size.l + 0.005);
          const z = (j - (rows - 1) / 2) * (size.w + 0.01);
          out.push({ p: [x + (r() - 0.5) * 0.01, 0.144 + k * size.h, z + (r() - 0.5) * 0.01], r: [0, (r() - 0.5) * 0.03, 0] });
        }
    return out;
  }, [cols, rows, layers, count, size.l, size.w, size.h]);
  const film = mat(
    'hall:film',
    () => new THREE.MeshPhysicalMaterial({ color: '#e8eef2', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={palletGeometry()} material={woodMaterial()} castShadow receiveShadow />
      <Instances geometry={boxGeometry(kind)} material={boxMaterial(kind)} items={items} />
      {wrapped && (
        <mesh material={film} position={[0, 0.144 + (layers * size.h) / 2, 0]} userData={{ noOcclude: true }}>
          <boxGeometry args={[cols * (size.l + 0.005) + 0.02, layers * size.h + 0.01, rows * (size.w + 0.01) + 0.02]} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Signs & small props
// ---------------------------------------------------------------------------

export interface WallSignProps {
  lines: string[];
  position: Vec3;
  rotation?: Vec3;
  size: [number, number];
  bg?: string;
  color?: string;
  /** ISO-style safety sign pictogram band at the top. */
  kind?: 'plain' | 'warning' | 'mandatory' | 'info';
}

export function WallSign({ lines, position, rotation, size, bg = '#f4f4f0', color = '#111', kind = 'plain' }: WallSignProps) {
  const tex = useMemo(() => {
    const W = 512;
    const H = Math.round((W * size[1]) / size[0]);
    return canvasTexture(`hall:sign:${kind}:${bg}:${color}:${lines.join('|')}:${W}x${H}`, W, H, (ctx, w, h) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      let top = 0;
      if (kind !== 'plain') {
        const band = h * 0.42;
        ctx.fillStyle = kind === 'warning' ? YELLOW : kind === 'mandatory' ? '#1d5fb8' : '#1f8a4c';
        ctx.fillRect(0, 0, w, band);
        ctx.fillStyle = kind === 'warning' ? '#111' : '#fff';
        const cx = w / 2;
        const cy = band / 2;
        const r = band * 0.36;
        if (kind === 'warning') {
          ctx.beginPath();
          ctx.moveTo(cx, cy - r);
          ctx.lineTo(cx + r * 1.1, cy + r * 0.8);
          ctx.lineTo(cx - r * 1.1, cy + r * 0.8);
          ctx.closePath();
          ctx.lineWidth = r * 0.16;
          ctx.strokeStyle = '#111';
          ctx.stroke();
          ctx.font = `900 ${Math.round(r * 1.1)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', cx, cy + r * 0.15);
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = kind === 'mandatory' ? '#1d5fb8' : '#1f8a4c';
          ctx.font = `900 ${Math.round(r * 1.2)}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(kind === 'mandatory' ? 'i' : '+', cx, cy + 2);
        }
        top = band;
      }
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const avail = h - top;
      const fs = Math.min(avail / (lines.length * 1.35), (w / Math.max(...lines.map((l) => l.length), 1)) * 1.7);
      ctx.font = `800 ${Math.round(fs)}px Arial, Helvetica, sans-serif`;
      lines.forEach((l, i) => ctx.fillText(l, w / 2, top + avail / 2 + (i - (lines.length - 1) / 2) * fs * 1.25));
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    });
  }, [lines.join('|'), size[0], size[1], bg, color, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <mesh position={position} rotation={rotation} userData={{ noOcclude: true }}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={tex} roughness={0.6} metalness={0} />
    </mesh>
  );
}

/** Steel bollard (yellow, 1.0 m) — origin at the floor. */
export function Bollards({ at }: { at: [number, number][] }) {
  const items = useMemo(() => at.map(([x, z]) => ({ p: [x, 0.5, z] as Vec3, s: [0.07, 1.0, 0.07] as Vec3 })), [at]);
  const caps = useMemo(() => at.map(([x, z]) => ({ p: [x, 1.0, z] as Vec3, s: [0.075, 0.02, 0.075] as Vec3 })), [at]);
  const bands = useMemo(() => at.map(([x, z]) => ({ p: [x, 0.8, z] as Vec3, s: [0.0715, 0.08, 0.0715] as Vec3 })), [at]);
  return (
    <group>
      <Instances geometry={unitCylY} material={paint(YELLOW, 0.4, 0.3)} items={items} />
      <Instances geometry={unitCylY} material={paint('#1a1a1a', 0.5)} items={bands} />
      <Instances geometry={unitCylY} material={paint(YELLOW, 0.4, 0.3)} items={caps} />
    </group>
  );
}

/** Wall-mounted fire extinguisher with its red sign board. Origin: wall surface at the bracket, +Z out. */
export function FireExtinguisher({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={unitCylY} material={paint('#c0161b', 0.35, 0.2)} position={[0, 0, 0.1]} scale={[0.075, 0.5, 0.075]} castShadow />
      <mesh geometry={unitCylY} material={paint('#1b1b1b', 0.5)} position={[0, 0.28, 0.1]} scale={[0.02, 0.07, 0.02]} />
      <mesh geometry={unitBox} material={paint('#1b1b1b', 0.5)} position={[0.03, 0.32, 0.1]} scale={[0.08, 0.02, 0.025]} />
      <mesh geometry={unitBox} material={steel()} position={[0, 0.1, 0.02]} scale={[0.06, 0.12, 0.04]} />
      <WallSign lines={['FIRE', 'EXTINGUISHER']} bg="#c0161b" color="#fff" position={[0, 0.62, 0.003]} size={[0.3, 0.2]} />
    </group>
  );
}

/** Floor drain grate (square, origin at the floor). */
export function FloorDrain({ position, size = 0.4 }: { position: Vec3; size?: number }) {
  const grate = useMemo(() => {
    const items: { p: Vec3; s: Vec3 }[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) items.push({ p: [-size / 2 + ((i + 0.5) * size) / n, 0.004, 0], s: [0.012, 0.008, size - 0.02] });
    return items;
  }, [size]);
  return (
    <group position={position}>
      <mesh geometry={unitBox} material={paint('#0d0e0f', 0.9, 0)} position={[0, 0.001, 0]} scale={[size, 0.002, size]} receiveShadow />
      <Instances geometry={unitBox} material={steel('#6b7176', 0.5)} items={grate} castShadow={false} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Merged cables (one draw call for all loose field cables of a scene)
// ---------------------------------------------------------------------------

export interface CableSpec {
  points: Vec3[];
  radius?: number;
  color?: string;
}

/** Many flexible cables / hoses (Catmull-Rom tubes) merged into ONE mesh with vertex colours. */
export function Cables({ cables }: { cables: CableSpec[] }) {
  const geom = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const col = new THREE.Color();
    for (const c of cables) {
      const curve = new THREE.CatmullRomCurve3(
        c.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
        false,
        'centripetal',
      );
      const len = curve.getLength();
      const g = new THREE.TubeGeometry(curve, Math.max(12, Math.round(len * 24)), c.radius ?? 0.004, 8, false);
      col.set(c.color ?? '#e8b90f').convertSRGBToLinear();
      const n = g.attributes.position!.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = col.r;
        arr[i * 3 + 1] = col.g;
        arr[i * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      parts.push(g);
    }
    const merged = parts.length ? mergeGeometries(parts) : null;
    parts.forEach((g) => g.dispose());
    return merged;
  }, [JSON.stringify(cables)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geom?.dispose(), [geom]);
  const m = mat('hall:cableMat', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 }));
  if (!geom) return null;
  return <mesh geometry={geom} material={m} castShadow receiveShadow />;
}
