/**
 * Shared helpers for operator devices (800F family, 855T, trainer devices) and panel parts:
 * cached geometries/materials/canvas textures, pointer interaction hooks, colors.
 *
 * Everything cached here is module-level and shared by every instance (never disposed).
 */
import { useCursor } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LED_HEX, type LedColor } from '../../common';
import type { OperatorColor } from '../../contracts';

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** Sans font stack for printed legends (no network fonts). */
export const LEGEND_FONT = 'Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif';
export const NARROW_FONT = '"Arial Narrow", "Liberation Sans Narrow", Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/** Molded cap colors for non-illuminated 800F operators. */
export const CAP_HEX: Record<OperatorColor, string> = {
  green: '#128a38',
  red: '#c3141b',
  black: '#161616',
  yellow: '#f0c40c',
  blue: '#1a4aa8',
  white: '#e9e8e2',
  amber: '#ee8400',
};

/** Unlit (daylight) colors of translucent lenses. */
export const LENS_HEX: Record<LedColor, string> = {
  green: '#1c9a45',
  red: '#c01820',
  amber: '#e88a10',
  yellow: '#e9cf2a',
  blue: '#2458c4',
  white: '#e6e6e0',
};

export function operatorToLed(c: OperatorColor): LedColor {
  switch (c) {
    case 'black':
      return 'white';
    default:
      return c;
  }
}

/** Lit lamp colors (slightly deeper than the generic LED palette so bloom keeps the hue). */
export const LIT_HEX: Record<LedColor, string> = {
  ...LED_HEX,
  green: '#18ff3c',
  // deep orange so the clipped HDR core stays amber (not yellow) while still blooming
  amber: '#ff6a00',
  red: '#ff1f1f',
  yellow: '#ffd21a',
  blue: '#2a7dff',
  white: '#fff7ea',
};

export const litHex = (c: LedColor) => LIT_HEX[c];

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Create (once) and share a geometry by key. */
export function sharedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map<string, THREE.Material>();
/** Create (once) and share a material by key. */
export function sharedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/** Rounded box centered at origin. */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5, d / 2 - 1e-5);
  return sharedGeo(`rbox:${w}:${h}:${d}:${rr}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, rr));
}

export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  return sharedGeo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

/** Cylinder whose axis is +Z (front-facing), centered at origin. */
export function cylZ(rTop: number, rBottom: number, len: number, seg = 32): THREE.BufferGeometry {
  return sharedGeo(`cylz:${rTop}:${rBottom}:${len}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
    g.rotateX(Math.PI / 2); // +Y -> +Z  (rTop ends up at +Z)
    return g;
  });
}

/** Cylinder with Y axis (vertical), centered at origin. */
export function cylY(rTop: number, rBottom: number, len: number, seg = 32, open = false): THREE.BufferGeometry {
  return sharedGeo(`cyly:${rTop}:${rBottom}:${len}:${seg}:${open}`, () => new THREE.CylinderGeometry(rTop, rBottom, len, seg, 1, open));
}

export function planeGeo(w: number, h: number): THREE.BufferGeometry {
  return sharedGeo(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h));
}

export function circleGeo(r: number, seg = 48): THREE.BufferGeometry {
  return sharedGeo(`circle:${r}:${seg}`, () => new THREE.CircleGeometry(r, seg));
}

/**
 * Lathe around the +Z axis. `profile` is a list of [radius, z] points walked counter-clockwise
 * around the cross-section (solid on the left) so normals face outward.
 */
export function latheZ(key: string, profile: [number, number][], segments = 48, planarUvRadius?: number): THREE.BufferGeometry {
  return sharedGeo(`lathe:${key}:${segments}:${planarUvRadius ?? ''}`, () => {
    const g = new THREE.LatheGeometry(
      profile.map(([r, z]) => new THREE.Vector2(Math.max(0, r), z)),
      segments,
    );
    g.rotateX(Math.PI / 2);
    g.computeVertexNormals();
    if (planarUvRadius) planarUVs(g, planarUvRadius);
    return g;
  });
}

/** Replace UVs by a planar XY projection (texture faces +Z, spans [-r, r]). */
export function planarUVs(g: THREE.BufferGeometry, r: number) {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / (2 * r) + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / (2 * r) + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Quarter/partial arc points helper for building lathe profiles (angles in degrees). */
export function arcPts(cx: number, cz: number, r: number, a0: number, a1: number, n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / n);
    out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return out;
}

/** Merge many transformed copies of a base geometry (for ribs, fins, screws...). */
export function mergedCopies(key: string, make: () => THREE.BufferGeometry, matrices: () => THREE.Matrix4[]): THREE.BufferGeometry {
  return sharedGeo(`merged:${key}`, () => {
    const base = make();
    const parts = matrices().map((m) => base.clone().applyMatrix4(m));
    const g = mergeGeometries(parts, false) ?? base;
    parts.forEach((p) => p.dispose());
    return g;
  });
}

/** Rounded-rectangle 2D shape centered at origin. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  roundedRectPath(s, -w / 2, -h / 2, w, h, r);
  return s;
}

export function roundedRectPath(p: THREE.Path, x: number, y: number, w: number, h: number, r: number) {
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

// ---------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------

const texCache = new Map<string, THREE.CanvasTexture>();

/** Cached canvas texture drawn by a callback (keyed by `key`). */
export function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { repeat?: boolean; color?: boolean } = {},
): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.color !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (opts.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  texCache.set(key, tex);
  return tex;
}

/** Fit text into a max width by shrinking the font. Returns the used px size. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, px: number, weight: string | number, family = LEGEND_FONT): number {
  let size = px;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > 6 && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

/** Concentric fresnel-ring lens texture (grayscale, used as map/emissiveMap/bumpMap). */
export function fresnelTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'fresnel-lens',
    256,
    256,
    (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      // concentric prism rings
      for (let r = w / 2; r > 4; r -= 9) {
        const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - 9), cx, cy, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.75, '#d8d8d8');
        g.addColorStop(1, '#9a9a9a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // bright core
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.3);
      core.addColorStop(0, 'rgba(255,255,255,0.9)');
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, w, h);
    },
    { color: false },
  );
}

/** Faceted (small pyramids) lens texture for pilot lights. */
export function facetTexture(): THREE.CanvasTexture {
  return canvasTexture(
    'facet-lens',
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#d0d0d0';
      ctx.fillRect(0, 0, w, h);
      const n = 12;
      const s = w / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const x = i * s;
          const y = j * s;
          const tri = (a: [number, number], b: [number, number], c: string) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.moveTo(x + s / 2, y + s / 2);
            ctx.lineTo(x + a[0] * s, y + a[1] * s);
            ctx.lineTo(x + b[0] * s, y + b[1] * s);
            ctx.closePath();
            ctx.fill();
          };
          tri([0, 0], [1, 0], '#ffffff');
          tri([1, 0], [1, 1], '#c4c4c4');
          tri([1, 1], [0, 1], '#8e8e8e');
          tri([0, 1], [0, 0], '#e4e4e4');
        }
      const core = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      core.addColorStop(0, 'rgba(255,255,255,0.55)');
      core.addColorStop(0.7, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, w, h);
    },
    { color: false },
  );
}

// ---------------------------------------------------------------------------
// Common materials (all shared)
// ---------------------------------------------------------------------------

export const mats = {
  chrome: () =>
    sharedMat('op:chrome', () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color: '#e9ecef', metalness: 1, roughness: 0.14 })),
  satinChrome: () =>
    sharedMat('op:satin', () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color: '#d5d9dd', metalness: 1, roughness: 0.28 })),
  blackPlastic: () =>
    sharedMat('op:blackPlastic', () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color: '#141516', metalness: 0.05, roughness: 0.42 })),
  darkPlastic: () =>
    sharedMat('op:darkPlastic', () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color: '#2a2c2f', metalness: 0.05, roughness: 0.55 })),
  gloss: (color: string) =>
    sharedMat(`op:gloss:${color}`, () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color, metalness: 0.02, roughness: 0.28 })),
  matte: (color: string, roughness = 0.6) =>
    sharedMat(`op:matte:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color, metalness: 0.02, roughness })),
  metal: (color: string, roughness = 0.35) =>
    sharedMat(`op:metal:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color, metalness: 0.95, roughness })),
  screw: () =>
    sharedMat('op:screw', () => new THREE.MeshStandardMaterial({ color: '#d4d7d9', metalness: 0.85, roughness: 0.38 })),
  brass: () => sharedMat('op:brass', () => new THREE.MeshStandardMaterial({ color: '#c8a45a', metalness: 1, roughness: 0.35 })),
  rubber: () => sharedMat('op:rubber', () => new THREE.MeshStandardMaterial({ shadowSide: THREE.BackSide, color: '#0e0e0e', metalness: 0, roughness: 0.9 })),
  dark: () => sharedMat('op:hole', () => new THREE.MeshBasicMaterial({ color: '#050505' })),
  label: (tex: THREE.Texture, transparent = false, roughness = 0.7) =>
    sharedMat(
      `op:label:${tex.uuid}:${transparent}:${roughness}`,
      () =>
        new THREE.MeshStandardMaterial({
          map: tex,
          transparent,
          roughness,
          metalness: 0,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          depthWrite: !transparent,
        }),
    ),
};

// ---------------------------------------------------------------------------
// Screws
// ---------------------------------------------------------------------------

/** Pan-head screw facing +Z with a cross (Pozidriv) recess. Geometry center = head base. */
export function screwHeadGeo(r: number, h: number): THREE.BufferGeometry {
  const pts: [number, number][] = [
    [0, 0],
    [r, 0],
    [r, h * 0.35],
  ];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    pts.push([r * Math.cos(a), h * 0.35 + h * 0.65 * Math.sin(a)]);
  }
  return latheZ(`screwhead:${r}:${h}`, pts, 20);
}

export function crossRecessGeo(r: number): THREE.BufferGeometry {
  return sharedGeo(`cross:${r}`, () => {
    const a = new THREE.BoxGeometry(r * 1.05, r * 0.2, r * 0.2);
    const b = new THREE.BoxGeometry(r * 0.2, r * 1.05, r * 0.2);
    const g = mergeGeometries([a, b]) ?? a;
    return g;
  });
}

/** A small cross-head screw (head only) facing +Z. */
export function Screw({ position, r = 0.0022, h = 0.0012, rotation }: { position: [number, number, number]; r?: number; h?: number; rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={screwHeadGeo(r, h)} material={mats.screw()} />
      <mesh geometry={crossRecessGeo(r)} material={mats.dark()} position={[0, 0, h - r * 0.07]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Interaction hooks
// ---------------------------------------------------------------------------

interface LockableControls {
  enabled: boolean;
}

function isLockable(c: unknown): c is LockableControls {
  return typeof c === 'object' && c !== null && 'enabled' in c;
}

/** Temporarily disables the default camera controls (e.g. while dragging a knob). */
export function useControlsLock() {
  const controls = useThree((s) => s.controls);
  return useCallback(
    (locked: boolean) => {
      if (isLockable(controls)) controls.enabled = !locked;
    },
    [controls],
  );
}

/** Hover state + pointer cursor. */
export function useHover(enabled = true) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && enabled);
  const onPointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
  }, []);
  const onPointerOut = useCallback(() => setHovered(false), []);
  return { hovered, bind: { onPointerOver, onPointerOut } };
}

/**
 * Momentary action handlers (push buttons). onPress on pointer down, onRelease on pointer up
 * anywhere (window listener) so the button never sticks.
 */
export function useMomentary(onPress?: () => void, onRelease?: () => void) {
  const enabled = !!(onPress || onRelease);
  const { hovered, bind } = useHover(enabled);
  const lock = useControlsLock();
  const down = useRef(false);
  const cb = useRef({ onPress, onRelease });
  useEffect(() => {
    cb.current = { onPress, onRelease };
  }, [onPress, onRelease]);

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

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;
      e.stopPropagation();
      if (e.button !== 0 || down.current) return;
      down.current = true;
      lock(true);
      window.addEventListener('pointerup', release);
      window.addEventListener('blur', release);
      cb.current.onPress?.();
    },
    [enabled, lock, release],
  );
  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enabled) return;
      e.stopPropagation();
      release();
    },
    [enabled, release],
  );
  return { hovered, handlers: { ...bind, onPointerDown, onPointerUp } };
}

/** Single-click handler (toggle / step) with hover cursor. `fn` receives the local hit point. */
export function useClick(fn: ((local: THREE.Vector3) => void) | undefined, frame: RefObject<THREE.Object3D | null>) {
  const { hovered, bind } = useHover(!!fn);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!fn) return;
      e.stopPropagation();
      if (e.button !== 0) return;
      tmp.copy(e.point);
      frame.current?.worldToLocal(tmp);
      fn(tmp);
    },
    [fn, frame, tmp],
  );
  return { hovered, handlers: { ...bind, onPointerDown } };
}

/** Frame-rate independent exponential smoothing. */
export const damp = THREE.MathUtils.damp;
