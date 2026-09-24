/**
 * Shared helpers for the traffic & parking twins: geometry/material/texture caches, procedural canvas
 * textures (asphalt, concrete, galvanized steel), LED dot-pattern textures, pointer-interaction hooks.
 *
 * Everything cached here is module level and shared by every instance (never disposed).
 */
import { useCursor } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LedMode } from '../../common';

// ---------------------------------------------------------------------------
// Units & colors
// ---------------------------------------------------------------------------

export const INCH = 0.0254;
export const FT = 0.3048;

export const TRAFFIC_COLORS = {
  /** Black polycarbonate / powder-coated signal housings. */
  signalBlack: '#18191b',
  /** "Federal yellow" polycarbonate housings. */
  signalYellow: '#e6ad0c',
  /** Dark "traffic green" housings (some cities). */
  signalGreen: '#1f3b2a',
  /** Fluorescent yellow retroreflective sheeting (backplate border). */
  retroYellow: '#ffe41c',
  /** Hot-dip galvanized steel. */
  galvanized: '#a6aba9',
  asphalt: '#3a3b3d',
  concrete: '#b9b6ae',
  markingWhite: '#ecebe4',
  markingYellow: '#f0b00e',
  /** Sealant in saw-cut loop slots. */
  loopSealant: '#101010',
} as const;

/** Lit LED signal colors (HDR-ish, toneMapped=false). Green LED signals are blue-green (~505 nm). */
export const SIGNAL_LIT = {
  red: '#ff2008',
  yellow: '#ffa600',
  green: '#00ffa2',
  /** Pedestrian signal "Portland orange" (hand / countdown). */
  orange: '#ff6a00',
  /** Pedestrian signal "lunar white" (walking person). */
  white: '#e8f2ff',
} as const;

/** Unlit lens tints (dark, colored glass with LEDs behind). */
export const SIGNAL_UNLIT = {
  red: '#4a0b07',
  yellow: '#4d3406',
  green: '#073a2a',
} as const;

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
export function sharedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map<string, THREE.Material>();
export function sharedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

const texCache = new Map<string, THREE.Texture>();
export function sharedTex<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = texCache.get(key) as T | undefined;
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  return sharedGeo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5);
  return sharedGeo(`rbox:${w}:${h}:${d}:${rr}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, rr));
}

/** Vertical cylinder (Y axis) centered at origin. */
export function cylY(rTop: number, rBottom: number, len: number, seg = 24, open = false): THREE.BufferGeometry {
  return sharedGeo(`cyly:${rTop}:${rBottom}:${len}:${seg}:${open}`, () => new THREE.CylinderGeometry(rTop, rBottom, len, seg, 1, open));
}

/** Cylinder along +Z (rTop at +Z), centered at origin. */
export function cylZ(rTop: number, rBottom: number, len: number, seg = 24): THREE.BufferGeometry {
  return sharedGeo(`cylz:${rTop}:${rBottom}:${len}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** Cylinder along +X (rTop at +X), centered at origin. */
export function cylX(rTop: number, rBottom: number, len: number, seg = 24): THREE.BufferGeometry {
  return sharedGeo(`cylx:${rTop}:${rBottom}:${len}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
    g.rotateZ(-Math.PI / 2);
    return g;
  });
}

export function planeGeo(w: number, h: number): THREE.BufferGeometry {
  return sharedGeo(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h));
}

export function circleGeo(r: number, seg = 32): THREE.BufferGeometry {
  return sharedGeo(`circle:${r}:${seg}`, () => new THREE.CircleGeometry(r, seg));
}

/** Rounded-rectangle shape centered at the origin. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  roundedRectPath(s, -w / 2, -h / 2, w, h, r);
  return s;
}

export function roundedRectPath(p: THREE.Path, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
}

/** Hole (clockwise path) version of a rounded rectangle. */
export function roundedRectHole(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Path {
  const p = new THREE.Path();
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.quadraticCurveTo(x, y, x, y + rr);
  p.lineTo(x, y + h - rr);
  p.quadraticCurveTo(x, y + h, x + rr, y + h);
  p.lineTo(x + w - rr, y + h);
  p.quadraticCurveTo(x + w, y + h, x + w, y + h - rr);
  p.lineTo(x + w, y + rr);
  p.quadraticCurveTo(x + w, y, x + w - rr, y);
  p.lineTo(x + rr, y);
  return p;
}

/**
 * Lathe around +Z (profile points are [radius, z]); UVs are planar (u,v = x,y mapped over ±uvR) so
 * flat textures (lens dots, symbols) can be applied to the front face.
 */
export function latheZ(key: string, profile: [number, number][], segments = 48, uvR?: number): THREE.BufferGeometry {
  return sharedGeo(`latheZ:${key}`, () => {
    const g = new THREE.LatheGeometry(
      profile.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-6), z)),
      segments,
    );
    // Lathe revolves around +Y: map Y -> Z (front), keep the circle in XY.
    g.rotateX(Math.PI / 2);
    if (uvR) {
      const pos = g.attributes.position!;
      const uv = g.attributes.uv!;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * uvR) + 0.5, pos.getY(i) / (2 * uvR) + 0.5);
      uv.needsUpdate = true;
    }
    g.computeVertexNormals();
    return g;
  });
}

/** Points on a quarter/partial arc in the (r, z) profile plane (degrees). */
export function arcPts(cr: number, cz: number, rad: number, a0: number, a1: number, n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / n);
    out.push([cr + rad * Math.cos(a), cz + rad * Math.sin(a)]);
  }
  return out;
}

/** Merge several geometries (converted to non-indexed, attributes position/normal/uv only). */
export function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(n.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') n.deleteAttribute(name);
    }
    if (!n.attributes.uv) {
      n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position!.count * 2), 2));
    }
    if (!n.attributes.normal) n.computeVertexNormals();
    n.clearGroups();
    return n;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('mergeAll: incompatible geometries');
  return merged;
}

/** Clone + transform a geometry. */
export function xf(g: THREE.BufferGeometry, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  const c = g.clone();
  c.applyMatrix4(m);
  return c;
}

/** Replace all UVs with a constant (used to point untextured parts at a plain texel). */
export function constUv(g: THREE.BufferGeometry, u: number, v: number): THREE.BufferGeometry {
  const uv = g.attributes.uv;
  if (uv) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
    uv.needsUpdate = true;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Deterministic noise for procedural textures
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function canvasTex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = opts.aniso ?? 8;
  t.needsUpdate = true;
  return t;
}

/** Fill a canvas with tileable value noise (multi-octave), calling `paint(value 0..1)` for colors. */
function tileableNoise(size: number, seed: number, octaves: number[]): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(size * size);
  let totalAmp = 0;
  for (const cells of octaves) {
    const amp = 1 / Math.sqrt(cells);
    totalAmp += amp;
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[(y0 % cells) * cells + (x0 % cells)]!;
        const b = grid[(y0 % cells) * cells + ((x0 + 1) % cells)]!;
        const c = grid[((y0 + 1) % cells) * cells + (x0 % cells)]!;
        const d = grid[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)]!;
        out[y * size + x]! += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i]! /= totalAmp;
  return out;
}

/** Asphalt: dark gray with aggregate speckles and subtle patchiness. Tileable; 1 tile ≈ 4 m. */
export function asphaltTexture(): THREE.CanvasTexture {
  return sharedTex('tex:asphalt', () => {
    const S = 512;
    const [c, ctx] = makeCanvas(S, S);
    const n = tileableNoise(S, 7, [4, 16, 64]);
    const img = ctx.createImageData(S, S);
    const rnd = mulberry32(99);
    for (let i = 0; i < S * S; i++) {
      const v = n[i]!;
      let g = 52 + (v - 0.5) * 38;
      const r = rnd();
      if (r < 0.06) g += 30 + rnd() * 40; // light aggregate
      else if (r < 0.14) g -= 16; // dark pits
      img.data[i * 4] = g;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = g + 2;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvasTex(c, { repeat: true });
  });
}

/** Broom-finished concrete with subtle blotches. Tileable; 1 tile ≈ 3 m. */
export function concreteTexture(tint = '#bdb9b0'): THREE.CanvasTexture {
  return sharedTex(`tex:concrete:${tint}`, () => {
    const S = 512;
    const [c, ctx] = makeCanvas(S, S);
    const n = tileableNoise(S, 21, [3, 12, 48]);
    const base = new THREE.Color(tint);
    const img = ctx.createImageData(S, S);
    const rnd = mulberry32(5);
    for (let i = 0; i < S * S; i++) {
      const y = Math.floor(i / S);
      const broom = Math.sin(y * 1.9 + n[i]! * 8) * 3; // faint broom texture lines
      const k = 0.86 + (n[i]! - 0.5) * 0.22 + broom / 255 + (rnd() - 0.5) * 0.06;
      img.data[i * 4] = Math.min(255, base.r * 255 * k);
      img.data[i * 4 + 1] = Math.min(255, base.g * 255 * k);
      img.data[i * 4 + 2] = Math.min(255, base.b * 255 * k);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvasTex(c, { repeat: true });
  });
}

/** Hot-dip galvanized spangle (mottled crystalline zinc). Tileable. */
export function galvanizedTexture(): THREE.CanvasTexture {
  return sharedTex('tex:galv', () => {
    const S = 256;
    const [c, ctx] = makeCanvas(S, S);
    const n = tileableNoise(S, 3, [6, 24]);
    const img = ctx.createImageData(S, S);
    const rnd = mulberry32(17);
    // spangle: voronoi-ish cells with random brightness
    const cells: [number, number, number][] = [];
    for (let i = 0; i < 160; i++) cells.push([rnd() * S, rnd() * S, 0.92 + rnd() * 0.12]);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let best = 1e9;
        let b = 1;
        for (const [cx, cy, cb] of cells) {
          let dx = Math.abs(x - cx);
          let dy = Math.abs(y - cy);
          if (dx > S / 2) dx = S - dx;
          if (dy > S / 2) dy = S - dy;
          const d = dx * dx + dy * dy;
          if (d < best) {
            best = d;
            b = cb;
          }
        }
        const i = y * S + x;
        const v = 255 * Math.min(1, b * (0.84 + (n[i]! - 0.5) * 0.12));
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasTex(c, { repeat: true });
  });
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

export const tmats = {
  housing: (color: string) =>
    sharedMat(`tr:housing:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05 })),
  paint: (color: string, roughness = 0.45, metalness = 0.2) =>
    sharedMat(`tr:paint:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness })),
  plastic: (color: string, roughness = 0.6) =>
    sharedMat(`tr:plastic:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })),
  metal: (color = '#b9bdc0', roughness = 0.3) =>
    sharedMat(`tr:metal:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.95 })),
  rubber: (color = '#141414') =>
    sharedMat(`tr:rubber:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 })),
  galvanized: () =>
    sharedMat('tr:galv', () => {
      const map = galvanizedTexture().clone();
      map.repeat.set(3, 8);
      map.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ color: TRAFFIC_COLORS.galvanized, map, roughness: 0.42, metalness: 0.75 });
    }),
  /** Retroreflective sheeting: bright, a bit glossy (catches headlights/sun). */
  retro: (color: string = TRAFFIC_COLORS.retroYellow) =>
    sharedMat(`tr:retro:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.1, emissive: color, emissiveIntensity: 0.08 })),
  asphalt: () =>
    sharedMat('tr:asphalt', () => new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.93, metalness: 0 })),
  concrete: (tint?: string) =>
    sharedMat(`tr:concrete:${tint ?? ''}`, () => new THREE.MeshStandardMaterial({ map: concreteTexture(tint), roughness: 0.88, metalness: 0 })),
  /** Dark tinted glass (car windows, display covers). */
  darkGlass: () =>
    sharedMat('tr:darkglass', () => new THREE.MeshStandardMaterial({ color: '#0b1014', roughness: 0.06, metalness: 0.55, envMapIntensity: 1.4 })),
  black: () => sharedMat('tr:black', () => new THREE.MeshStandardMaterial({ color: '#0e0e0f', roughness: 0.55, metalness: 0.05 })),
};

/** Road-marking paint (slightly worn thermoplastic). polygonOffset avoids z-fighting with the road. */
export function markingMat(color: string): THREE.MeshStandardMaterial {
  return sharedMat(
    `tr:marking:${color}`,
    () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.62,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
  );
}

// ---------------------------------------------------------------------------
// LED modes
// ---------------------------------------------------------------------------

/** Resolve a LedMode (boolean | 'on' | 'flash' ...) at time t (s). */
export function ledOn(mode: LedMode, t: number): boolean {
  if (mode === true || mode === 'on') return true;
  if (mode === 'flash') return t % 1 < 0.5;
  if (mode === 'flash-fast') return t % 0.25 < 0.125;
  return false;
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------

interface LockableControls {
  enabled: boolean;
}
function isLockable(c: unknown): c is LockableControls {
  return typeof c === 'object' && c !== null && 'enabled' in c;
}

/**
 * Momentary press handlers: onPress on pointer down, onRelease on pointer up anywhere (window
 * listener), camera controls disabled while held. Spread `handlers` onto the clickable mesh/group.
 */
export function usePress(onPress?: () => void, onRelease?: () => void) {
  const enabled = !!(onPress || onRelease);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && enabled);
  const controls = useThree((s) => s.controls);
  const down = useRef(false);
  const cb = useRef({ onPress, onRelease });
  useEffect(() => {
    cb.current = { onPress, onRelease };
  }, [onPress, onRelease]);

  const lock = useCallback(
    (locked: boolean) => {
      if (isLockable(controls)) controls.enabled = !locked;
    },
    [controls],
  );

  const release = useCallback(() => {
    if (!down.current) return;
    down.current = false;
    window.removeEventListener('pointerup', release);
    window.removeEventListener('blur', release);
    lock(false);
    cb.current.onRelease?.();
  }, [lock]);

  useEffect(
    () => () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('blur', release);
    },
    [release],
  );

  const handlers = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;
      e.stopPropagation();
      setHovered(true);
    },
    onPointerOut: () => setHovered(false),
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;
      e.stopPropagation();
      if (e.button !== 0 || down.current) return;
      down.current = true;
      lock(true);
      window.addEventListener('pointerup', release);
      window.addEventListener('blur', release);
      cb.current.onPress?.();
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;
      e.stopPropagation();
      release();
    },
  };
  return { hovered, handlers };
}

/** Invisible (but raycastable) material for enlarged hit areas. */
export function hitMat(): THREE.MeshBasicMaterial {
  return sharedMat('tr:hit', () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
}

export const damp = THREE.MathUtils.damp;

/** Dispose per-instance materials/geometries when the component unmounts. */
export function useDisposable(items: readonly { dispose: () => void }[]): void {
  useEffect(() => () => items.forEach((i) => i.dispose()), [items]);
}
