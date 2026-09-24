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
  // not pure black: a molded black cap must still catch a highlight (else it reads as an empty bore)
  black: '#2a2a2a',
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
    // LatheGeometry already generates seam-consistent normals; rotateX transforms them correctly.
    // (Recomputing them would split the phi=0 seam into a visible hard edge.)
    g.rotateX(Math.PI / 2);
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
// Merged static parts ("uber" material): one draw call per static assembly
// ---------------------------------------------------------------------------

/** Surface finish of a merged part: base color + roughness + metalness (baked per vertex). */
export interface Finish {
  color: string;
  rough?: number;
  metal?: number;
}

/** Common finishes. */
export const F = {
  chrome: { color: '#e9ecef', rough: 0.14, metal: 1 } as Finish,
  satin: { color: '#d5d9dd', rough: 0.28, metal: 1 } as Finish,
  black: { color: '#141516', rough: 0.42, metal: 0.05 } as Finish,
  darkPlastic: { color: '#2a2c2f', rough: 0.55, metal: 0.05 } as Finish,
  screw: { color: '#d4d7d9', rough: 0.38, metal: 0.85 } as Finish,
  brass: { color: '#c8a45a', rough: 0.35, metal: 1 } as Finish,
  rubber: { color: '#0e0e0e', rough: 0.9, metal: 0 } as Finish,
  /** Recess / opening interior (near black, dull). */
  hole: { color: '#060606', rough: 0.95, metal: 0 } as Finish,
  gloss: (color: string): Finish => ({ color, rough: 0.28, metal: 0.02 }),
  matte: (color: string, rough = 0.6): Finish => ({ color, rough, metal: 0.02 }),
  metal: (color: string, rough = 0.35): Finish => ({ color, rough, metal: 0.95 }),
};

type V3 = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function xform(p?: V3, r?: V3, s?: V3 | number): THREE.Matrix4 {
  _q.setFromEuler(_e.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0));
  if (typeof s === 'number') _s.set(s, s, s);
  else if (s) _s.set(s[0], s[1], s[2]);
  else _s.set(1, 1, 1);
  return new THREE.Matrix4().compose(_v.set(p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0), _q, _s);
}

/**
 * Accumulates transformed copies of geometries with a baked finish (vertex color + roughness +
 * metalness) and merges them into ONE BufferGeometry rendered with {@link uberMat}.
 * Supports a transform stack (`at`) to build sub-assemblies in local coordinates.
 */
export class Parts {
  private geos: THREE.BufferGeometry[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  private get top() {
    return this.stack[this.stack.length - 1]!;
  }

  /** Run `fn` inside a local frame (position / Euler rotation / scale). */
  at(p: V3 | undefined, r: V3 | undefined, fn: (b: Parts) => void, s?: V3 | number): this {
    this.stack.push(this.top.clone().multiply(xform(p, r, s)));
    fn(this);
    this.stack.pop();
    return this;
  }

  add(src: THREE.BufferGeometry, f: Finish, p?: V3, r?: V3, s?: V3 | number): this {
    return this.addM(src, f, xform(p, r, s));
  }

  addM(src: THREE.BufferGeometry, f: Finish, m: THREE.Matrix4): this {
    const g = new THREE.BufferGeometry();
    const pos = src.getAttribute('position');
    if (!pos) return this;
    g.setAttribute('position', pos.clone());
    const nrm = src.getAttribute('normal');
    if (nrm) g.setAttribute('normal', nrm.clone());
    else g.computeVertexNormals();
    if (src.index) g.setIndex(src.index.clone());
    else g.setIndex(Array.from({ length: pos.count }, (_, i) => i));
    g.applyMatrix4(_m.multiplyMatrices(this.top, m));
    const n = pos.count;
    _c.set(f.color);
    const col = new Float32Array(n * 3);
    const pbr = new Float32Array(n * 2);
    const rough = f.rough ?? 0.55;
    const metal = f.metal ?? 0.02;
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
      pbr[i * 2] = rough;
      pbr[i * 2 + 1] = metal;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
    this.geos.push(g);
    return this;
  }

  get empty() {
    return this.geos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = this.geos.length ? mergeGeometries(this.geos, false) : null;
    this.geos.forEach((x) => x.dispose());
    this.geos = [];
    const out = g ?? new THREE.BufferGeometry();
    out.computeBoundingSphere();
    out.computeBoundingBox();
    return out;
  }
}

/** Cached merged geometry built by `build` (key must capture every parameter). */
export function partsGeo(key: string, build: (b: Parts) => void): THREE.BufferGeometry {
  return sharedGeo(`parts:${key}`, () => {
    const b = new Parts();
    build(b);
    return b.build();
  });
}

/**
 * Shared material for merged parts: vertex colors + per-vertex roughness / metalness
 * (attribute `pbr` = [roughness, metalness]).
 */
export function uberMat(): THREE.MeshStandardMaterial {
  return sharedMat('op:uber', () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, shadowSide: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = pbr;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vPbr.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vPbr.y;');
    };
    m.customProgramCacheKey = () => 'op-uber-pbr-v1';
    return m;
  });
}

/** Renders a merged parts geometry with the shared uber material. */
export function PartsMesh({
  geo,
  castShadow = true,
  receiveShadow = true,
  position,
  rotation,
}: {
  geo: THREE.BufferGeometry;
  castShadow?: boolean;
  receiveShadow?: boolean;
  position?: V3;
  rotation?: V3;
}) {
  return <mesh geometry={geo} material={uberMat()} castShadow={castShadow} receiveShadow={receiveShadow} position={position} rotation={rotation} />;
}

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

/** Adds a pan-head cross screw (head base at `p`, facing +Z of the rotated frame) to a parts builder. */
export function addScrew(b: Parts, p: V3, r = 0.0022, h = 0.0012, rot?: V3, finish: Finish = F.screw): Parts {
  return b.at(p, rot, (s) => {
    s.add(screwHeadGeo(r, h), finish);
    s.add(crossRecessGeo(r), F.hole, [0, 0, h - r * 0.07]);
  });
}

/** Terminal clamp screw: slotted/cross combi head sitting in a square pressure plate. */
export function addClampScrew(b: Parts, p: V3, r: number, rot?: V3): Parts {
  return b.at(p, rot, (s) => {
    s.add(cylZ(r, r, r * 0.55, 20), F.screw, [0, 0, r * 0.275]);
    s.add(crossRecessGeo(r * 0.95), F.hole, [0, 0, r * 0.52]);
  });
}

/** A small cross-head screw (head only) facing +Z — a single merged mesh (no shadow). */
export function Screw({ position, r = 0.0022, h = 0.0012, rotation }: { position: [number, number, number]; r?: number; h?: number; rotation?: [number, number, number] }) {
  const geo = partsGeo(`screw:${r}:${h}`, (b) => addScrew(b, [0, 0, 0], r, h));
  return <mesh geometry={geo} material={uberMat()} position={position} rotation={rotation} />;
}

// ---------------------------------------------------------------------------
// Lamp lenses
// ---------------------------------------------------------------------------

/**
 * Translucent-looking lamp lens material: saturated daylight color, a small emissive floor so the
 * unlit lens reads as colored polycarbonate (not paint), and a view-dependent "hot core" (emission
 * strongest where the lens faces the viewer, like an LED seen through a diffusing lens).
 */
export function makeLensMaterial(led: LedColor, opts: { map?: THREE.Texture; emissiveMap?: THREE.Texture; bumpMap?: THREE.Texture; bumpScale?: number; edge?: number } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: LENS_HEX[led],
    map: opts.map ?? null,
    emissive: LIT_HEX[led],
    emissiveMap: opts.emissiveMap ?? opts.map ?? null,
    bumpMap: opts.bumpMap ?? null,
    bumpScale: opts.bumpScale ?? 1,
    emissiveIntensity: 0,
    roughness: 0.24,
    metalness: 0,
    toneMapped: false,
  });
  const edge = (opts.edge ?? 0.3).toFixed(3);
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float lensNdv = abs(dot(normalize(normal), normalize(vViewPosition)));
      totalEmissiveRadiance *= mix(${edge}, 1.0, lensNdv * lensNdv);`,
    );
  };
  m.customProgramCacheKey = () => `lens-core:${edge}`;
  return m;
}

/** Lit/unlit tints + emissive levels for a lens (unlit keeps ~95 % of the lens color). */
export function lensTints(led: LedColor, litIntensity = 2.6) {
  const white = led === 'white';
  return {
    unlit: new THREE.Color(LENS_HEX[led]).multiplyScalar(white ? 0.85 : 0.95),
    lit: new THREE.Color(LIT_HEX[led]).multiplyScalar(white ? 0.6 : 0.85),
    unlitE: white ? 0.03 : 0.07,
    litE: litIntensity,
  };
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

/** Max pointer travel (px) between down and up for a click to count (larger = camera drag). */
export const CLICK_SLOP_PX = 4;

/**
 * Single-click handler (toggle / step) with hover cursor. Fires on CLICK (pointer up on the same
 * object), primary button only, and only if the pointer moved less than {@link CLICK_SLOP_PX}
 * — so starting a camera orbit on a switch never flips it. `fn` receives the local hit point.
 */
export function useClick(fn: ((local: THREE.Vector3) => void) | undefined, frame: RefObject<THREE.Object3D | null>) {
  const { hovered, bind } = useHover(!!fn);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!fn) return;
      if (e.button !== 0 || e.delta > CLICK_SLOP_PX) return;
      e.stopPropagation();
      tmp.copy(e.point);
      frame.current?.worldToLocal(tmp);
      fn(tmp);
    },
    [fn, frame, tmp],
  );
  return { hovered, handlers: { ...bind, onClick } };
}

/**
 * Gamified hover cue: a thin glowing ring drawn around an operator ONLY while hovered (no cost
 * otherwise). Sits just above the legend-plate surface, facing +Z.
 */
export function HoverRing({ show, r, z = 0.0024 }: { show: boolean; r: number; z?: number }) {
  if (!show) return null;
  const mat = sharedMat(
    'op:hover-ring',
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#58c8ff').multiplyScalar(1.4),
        toneMapped: false,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      }),
  );
  return <mesh geometry={sharedGeo(`hover-ring:${r}`, () => new THREE.RingGeometry(r, r + 0.0011, 56))} material={mat} position={[0, 0, z]} renderOrder={2} />;
}

/** Frame-rate independent exponential smoothing. */
export const damp = THREE.MathUtils.damp;
