/**
 * Outdoor "city" kit shared by the `traffic-light` and `parking-garage` views (owned by those scenes):
 *
 *  - <SkyDome/>, <GroundPlane/>            gradient sky + far ground under the fog
 *  - <Buildings specs=[…]/>                low-poly buildings with procedural facades (brick, curtain wall,
 *                                          stucco, precast) and storefront ground floors; every facade kind is
 *                                          ONE merged mesh for all buildings (world-scaled UVs), roofs + trim one more
 *  - <Trees/>, <StreetLights/>, <PullBoxes/>, <Bollards/>   instanced street furniture (1–4 draw calls each)
 *  - <KeySwitch800F/>                      22.5 mm key-operated selector (maintained or spring-return) built from
 *                                          the 800F bezel + legend plate (the operator kit has no key operator)
 *  - small hooks: useHoverCursor, useLatest
 *
 * Coordinates: meters, Y up, plan x = east, z = south (both scene logics use this frame).
 */
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from '../../../twin/contracts';
import { Bezel800F, LegendPlate800F, selectorAngle } from '../../../twin/devices';
import { canvasTexture, kgeo, kmat, mulberry } from '../trainer/kit';

// ---------------------------------------------------------------------------
// Small hooks
// ---------------------------------------------------------------------------

/** Ref that always holds the latest value (for getters used inside useFrame). */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

/** Dispose per-mount GPU resources (materials, geometries, cloned textures) on unmount. */
export function useDisposeOnUnmount(items: ReadonlyArray<{ dispose: () => void } | null | undefined>) {
  useEffect(() => () => items.forEach((i) => i?.dispose()), [items]);
}

/** Pointer cursor + hover flag for a clickable custom mesh. */
export function useHoverCursor(enabled = true) {
  const gl = useThree((s) => s.gl);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    gl.domElement.style.cursor = hovered ? 'pointer' : '';
  }, [hovered, enabled, gl]);
  useEffect(() => () => void (gl.domElement.style.cursor = ''), [gl]);
  const handlers = useMemo(
    () => ({
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHovered(true);
      },
      onPointerOut: () => setHovered(false),
    }),
    [],
  );
  return { hovered: hovered && enabled, handlers };
}

// ---------------------------------------------------------------------------
// Sky & far ground
// ---------------------------------------------------------------------------

export function SkyDome({ top = '#5f8fcf', horizon = '#d3e2ee', ground = '#aab4b8' }: { top?: string; horizon?: string; ground?: string }) {
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(330, 32, 16);
    const pos = g.attributes.position!;
    const cols = new Float32Array(pos.count * 3);
    const cTop = new THREE.Color(top);
    const cHor = new THREE.Color(horizon);
    const cGnd = new THREE.Color(ground);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 330;
      if (y >= 0) c.copy(cHor).lerp(cTop, Math.pow(y, 0.55));
      else c.copy(cHor).lerp(cGnd, Math.min(1, -y * 6));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  }, [top, horizon, ground]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = kmat('city:sky', () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  return <mesh geometry={geo} material={mat} renderOrder={-10} frustumCulled={false} />;
}

function grassTex() {
  return canvasTexture(
    'city:grass',
    256,
    256,
    (ctx, w, h) => {
      const rnd = mulberry(31);
      ctx.fillStyle = '#58733e';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 6000; i++) {
        const g = 80 + rnd() * 80;
        ctx.fillStyle = `rgba(${g * 0.6},${g},${g * 0.38},0.45)`;
        ctx.fillRect(rnd() * w, rnd() * h, 1.5, 3);
      }
    },
    { repeat: true },
  );
}

/** Large lawn plane under everything (slightly below y = 0). */
export function GroundPlane({ size = 700, y = -0.04, tile = 6, color = '#ffffff' }: { size?: number; y?: number; tile?: number; color?: string }) {
  const mat = useMemo(() => {
    const t = grassTex().clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(size / tile, size / tile);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color, roughness: 1 });
  }, [size, tile, color]);
  useEffect(
    () => () => {
      mat.map?.dispose();
      mat.dispose();
    },
    [mat],
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} material={mat} receiveShadow>
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Facade textures (one tile = one bay × one floor)
// ---------------------------------------------------------------------------

export type FacadeKind = 'brick' | 'brickDark' | 'office' | 'stucco' | 'store' | 'precast' | 'blank';

interface FacadeSpec {
  tileW: number;
  tileH: number;
  px: number;
  draw: (ctx: CanvasRenderingContext2D, m: (v: number) => number, w: number, h: number, gloss: boolean) => void;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rgb: [number, number, number], alpha: number, seed: number) {
  const rnd = mulberry(seed);
  for (let i = 0; i < n; i++) {
    const k = 0.75 + rnd() * 0.5;
    ctx.fillStyle = `rgba(${Math.round(rgb[0] * k)},${Math.round(rgb[1] * k)},${Math.round(rgb[2] * k)},${alpha})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

/** Window with frame, mullion and a sky reflection gradient (y measured from the TOP of the canvas). */
function drawWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: number,
  frameColor: string,
  gloss: boolean,
  opts: { mullion?: boolean; transom?: number } = {},
) {
  ctx.fillStyle = gloss ? '#8a8a8a' : frameColor;
  ctx.fillRect(x - frame, y - frame, w + 2 * frame, h + 2 * frame);
  if (gloss) {
    ctx.fillStyle = '#141414';
    ctx.fillRect(x, y, w, h);
  } else {
    const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
    g.addColorStop(0, '#8fa7bb');
    g.addColorStop(0.45, '#3b4d5e');
    g.addColorStop(1, '#1f2a35');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // interior hint (blinds) and a soft diagonal sky reflection
    ctx.fillStyle = 'rgba(210,205,190,0.12)';
    ctx.fillRect(x, y, w, h * 0.22);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.15, y);
    ctx.lineTo(x + w * 0.45, y);
    ctx.lineTo(x + w * 0.1, y + h);
    ctx.lineTo(x - w * 0.2 < x ? x : x - w * 0.2, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = gloss ? '#8a8a8a' : frameColor;
  if (opts.mullion) ctx.fillRect(x + w / 2 - frame / 2, y, frame, h);
  if (opts.transom) ctx.fillRect(x, y + opts.transom, w, frame * 0.8);
}

const FACADES: Record<FacadeKind, FacadeSpec> = {
  brick: {
    tileW: 3.2,
    tileH: 3.4,
    px: 90,
    draw: (ctx, m, w, h, gloss) => {
      ctx.fillStyle = gloss ? '#ececec' : '#9a4b37';
      ctx.fillRect(0, 0, w, h);
      if (!gloss) {
        const course = m(0.075);
        for (let r = 0, y = 0; y < h; r++, y += course) {
          ctx.fillStyle = 'rgba(214,200,184,0.55)';
          ctx.fillRect(0, y, w, 1);
          const off = r % 2 ? m(0.11) : 0;
          for (let x = off; x < w; x += m(0.22)) ctx.fillRect(x, y, 1, course);
        }
        noise(ctx, w, h, 2400, [150, 70, 50], 0.35, 7);
      }
      const ww = m(1.3);
      const wh = m(1.75);
      const x = (w - ww) / 2;
      const y = h - m(0.95) - wh;
      // stone lintel + sill
      ctx.fillStyle = gloss ? '#d0d0d0' : '#d5cbb6';
      ctx.fillRect(x - m(0.12), y - m(0.2), ww + m(0.24), m(0.14));
      ctx.fillRect(x - m(0.08), y + wh + m(0.03), ww + m(0.16), m(0.08));
      drawWindow(ctx, x, y, ww, wh, m(0.06), '#ece8e0', gloss, { mullion: true, transom: m(0.45) });
    },
  },
  brickDark: {
    tileW: 2.8,
    tileH: 3.3,
    px: 90,
    draw: (ctx, m, w, h, gloss) => {
      ctx.fillStyle = gloss ? '#ececec' : '#5d4238';
      ctx.fillRect(0, 0, w, h);
      if (!gloss) {
        const course = m(0.075);
        for (let r = 0, y = 0; y < h; r++, y += course) {
          ctx.fillStyle = 'rgba(160,150,140,0.45)';
          ctx.fillRect(0, y, w, 1);
          const off = r % 2 ? m(0.11) : 0;
          for (let x = off; x < w; x += m(0.22)) ctx.fillRect(x, y, 1, course);
        }
        noise(ctx, w, h, 2000, [90, 64, 55], 0.35, 8);
      }
      const ww = m(1.1);
      const wh = m(1.9);
      const x = (w - ww) / 2;
      const y = h - m(0.8) - wh;
      drawWindow(ctx, x, y, ww, wh, m(0.07), '#1c1f22', gloss, { transom: m(0.5) });
    },
  },
  office: {
    tileW: 1.6,
    tileH: 3.7,
    px: 90,
    draw: (ctx, m, w, h, gloss) => {
      // spandrel (lower 0.95 m) + vision glass, aluminum mullions
      const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
      g.addColorStop(0, '#a7bfd0');
      g.addColorStop(0.5, '#4d6a80');
      g.addColorStop(1, '#2a3b4a');
      ctx.fillStyle = gloss ? '#101010' : g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = gloss ? '#3c3c3c' : '#27313a';
      ctx.fillRect(0, h - m(1.0), w, m(1.0));
      ctx.fillStyle = gloss ? '#7a7a7a' : '#b3b9bd';
      ctx.fillRect(0, 0, m(0.06), h);
      ctx.fillRect(0, h - m(1.0), w, m(0.05));
      ctx.fillRect(0, h - m(0.04), w, m(0.04));
    },
  },
  stucco: {
    tileW: 3.4,
    tileH: 3.2,
    px: 90,
    draw: (ctx, m, w, h, gloss) => {
      ctx.fillStyle = gloss ? '#f0f0f0' : '#d8c8a6';
      ctx.fillRect(0, 0, w, h);
      if (!gloss) noise(ctx, w, h, 3500, [200, 186, 156], 0.3, 9);
      const ww = m(1.25);
      const wh = m(1.45);
      const x = (w - ww) / 2;
      const y = h - m(1.0) - wh;
      drawWindow(ctx, x, y, ww, wh, m(0.06), '#f2efe8', gloss, { mullion: true });
      if (!gloss) {
        ctx.fillStyle = '#4f6b58';
        ctx.fillRect(x - m(0.42), y - m(0.03), m(0.32), wh + m(0.06));
        ctx.fillRect(x + ww + m(0.1), y - m(0.03), m(0.32), wh + m(0.06));
      }
    },
  },
  store: {
    tileW: 5,
    tileH: 4.4,
    px: 80,
    draw: (ctx, m, w, h, gloss) => {
      ctx.fillStyle = gloss ? '#e0e0e0' : '#e4ddcf';
      ctx.fillRect(0, 0, w, h);
      // bulkhead
      ctx.fillStyle = gloss ? '#9a9a9a' : '#3d3f42';
      ctx.fillRect(0, h - m(0.5), w, m(0.5));
      // glazing 0.5 .. 3.2 m with mullions every 1.25 m
      const top = h - m(3.2);
      const gh = m(2.7);
      if (gloss) {
        ctx.fillStyle = '#121212';
        ctx.fillRect(m(0.1), top, w - m(0.2), gh);
      } else {
        const g = ctx.createLinearGradient(0, top, m(1.5), top + gh);
        g.addColorStop(0, '#9fb3c2');
        g.addColorStop(0.4, '#40505c');
        g.addColorStop(1, '#262e35');
        ctx.fillStyle = g;
        ctx.fillRect(m(0.1), top, w - m(0.2), gh);
        // warm interior glow + displays
        ctx.fillStyle = 'rgba(255,214,150,0.14)';
        ctx.fillRect(m(0.1), top + gh * 0.35, w - m(0.2), gh * 0.65);
        ctx.fillStyle = 'rgba(40,30,20,0.35)';
        for (let i = 0; i < 4; i++) ctx.fillRect(m(0.4 + i * 1.15), top + gh * 0.62, m(0.7), gh * 0.38);
      }
      ctx.fillStyle = gloss ? '#707070' : '#2a2e33';
      for (let x = m(0.05); x < w; x += m(1.25)) ctx.fillRect(x, top, m(0.07), gh);
      ctx.fillRect(0, top - m(0.06), w, m(0.08));
      ctx.fillRect(0, top + gh - m(0.02), w, m(0.06));
      // sign band
      ctx.fillStyle = gloss ? '#cfcfcf' : '#6d665b';
      ctx.fillRect(0, 0, w, m(0.9));
      ctx.fillStyle = gloss ? '#b0b0b0' : '#8a8173';
      ctx.fillRect(0, m(0.85), w, m(0.08));
    },
  },
  precast: {
    tileW: 6,
    tileH: 3.2,
    px: 60,
    draw: (ctx, m, w, h, gloss) => {
      ctx.fillStyle = gloss ? '#efefef' : '#bdb8ad';
      ctx.fillRect(0, 0, w, h);
      if (!gloss) noise(ctx, w, h, 2500, [175, 170, 160], 0.35, 11);
      // open deck level: dark opening between spandrel beams
      ctx.fillStyle = gloss ? '#d0d0d0' : '#2b2d2f';
      ctx.fillRect(m(0.25), m(0.35), w - m(0.5), h - m(1.45));
      ctx.fillStyle = gloss ? '#e0e0e0' : '#a9a498';
      ctx.fillRect(0, h - m(1.1), w, m(0.04));
      ctx.fillRect(w - m(0.25), 0, m(0.25), h);
      ctx.fillRect(0, 0, m(0.25), h);
    },
  },
  blank: {
    tileW: 4,
    tileH: 4,
    px: 40,
    draw: (ctx, _m, w, h, gloss) => {
      ctx.fillStyle = gloss ? '#f0f0f0' : '#c9c3b6';
      ctx.fillRect(0, 0, w, h);
      if (!gloss) noise(ctx, w, h, 800, [190, 184, 172], 0.3, 12);
    },
  },
};

function facadeMaterial(kind: FacadeKind): THREE.MeshStandardMaterial {
  return kmat(`city:facade:${kind}`, () => {
    const f = FACADES[kind];
    const w = Math.round(f.tileW * f.px);
    const h = Math.round(f.tileH * f.px);
    const m = (v: number) => v * f.px;
    const map = canvasTexture(`city:facade:${kind}`, w, h, (ctx) => f.draw(ctx, m, w, h, false), { repeat: true });
    const rough = canvasTexture(`city:facade-r:${kind}`, w, h, (ctx) => f.draw(ctx, m, w, h, true), { repeat: true, color: false });
    return new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: kind === 'office' ? 0.25 : 0.05, envMapIntensity: 1.1 });
  });
}

function roofMaterial(): THREE.MeshStandardMaterial {
  return kmat('city:roof', () => {
    const map = canvasTexture(
      'city:roof',
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#8e9092';
        ctx.fillRect(0, 0, w, h);
        noise(ctx, w, h, 5000, [120, 122, 124], 0.4, 21);
        ctx.fillStyle = 'rgba(60,60,60,0.25)';
        for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 2, h);
      },
      { repeat: true },
    );
    return new THREE.MeshStandardMaterial({ map, roughness: 0.95 });
  });
}

function trimMaterial(): THREE.MeshStandardMaterial {
  return kmat('city:trim', () => new THREE.MeshStandardMaterial({ color: '#cfc9bd', roughness: 0.8 }));
}

function hvacMaterial(): THREE.MeshStandardMaterial {
  return kmat('city:hvac', () => new THREE.MeshStandardMaterial({ color: '#b7bcbf', roughness: 0.5, metalness: 0.5 }));
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export interface BuildingSpec {
  /** Plan footprint (m). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Ground elevation. */
  y?: number;
  /** Upper floors (above the ground floor). */
  floors: number;
  facade: FacadeKind;
  /** Ground floor: shopfronts (default), same facade or blank wall. */
  ground?: FacadeKind;
  groundH?: number;
  /** Rooftop mechanical units. */
  hvac?: number;
  /** Faces NOT to draw (hidden against another building): 'N' | 'S' | 'E' | 'W'. */
  skip?: string;
}

/** A vertical wall quad with world-scaled UVs; `side` gives the outward normal. */
function wallQuad(side: 'N' | 'S' | 'E' | 'W', b: BuildingSpec, y0: number, y1: number, tileW: number, tileH: number, v0: number): THREE.BufferGeometry {
  const len = side === 'N' || side === 'S' ? b.x1 - b.x0 : b.z1 - b.z0;
  const n = Math.max(1, Math.round(len / tileW));
  const U = n; // u runs 0..n across the wall (tile width stretched to fit whole bays)
  let p: number[];
  let nor: [number, number, number];
  switch (side) {
    case 'S':
      p = [b.x0, y0, b.z1, b.x1, y0, b.z1, b.x1, y1, b.z1, b.x0, y1, b.z1];
      nor = [0, 0, 1];
      break;
    case 'N':
      p = [b.x1, y0, b.z0, b.x0, y0, b.z0, b.x0, y1, b.z0, b.x1, y1, b.z0];
      nor = [0, 0, -1];
      break;
    case 'E':
      p = [b.x1, y0, b.z1, b.x1, y0, b.z0, b.x1, y1, b.z0, b.x1, y1, b.z1];
      nor = [1, 0, 0];
      break;
    default:
      p = [b.x0, y0, b.z0, b.x0, y0, b.z1, b.x0, y1, b.z1, b.x0, y1, b.z0];
      nor = [-1, 0, 0];
  }
  const v1 = v0 + (y1 - y0) / tileH;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([...nor, ...nor, ...nor, ...nor], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, U, v0, U, v1, 0, v1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Low-poly buildings; one draw call per facade kind + roofs + trim + rooftop units. */
export function Buildings({ specs }: { specs: BuildingSpec[] }) {
  const key = JSON.stringify(specs);
  const built = useMemo(() => {
    const byKind = new Map<FacadeKind, THREE.BufferGeometry[]>();
    const roofs: THREE.BufferGeometry[] = [];
    const trim: THREE.BufferGeometry[] = [];
    const hvac: THREE.BufferGeometry[] = [];
    const add = (k: FacadeKind, g: THREE.BufferGeometry) => {
      let a = byKind.get(k);
      if (!a) byKind.set(k, (a = []));
      a.push(g);
    };
    const rnd = mulberry(77);
    for (const b of specs) {
      const y = b.y ?? 0;
      const ground = b.ground ?? 'store';
      const gh = b.groundH ?? (ground === 'store' ? 4.4 : FACADES[b.facade].tileH);
      const fh = FACADES[b.facade].tileH;
      const top = y + gh + b.floors * fh;
      for (const side of ['N', 'S', 'E', 'W'] as const) {
        if (b.skip?.includes(side)) continue;
        const gf = FACADES[ground];
        add(ground, wallQuad(side, b, y, y + gh, gf.tileW, gf.tileH, ground === 'store' ? 0 : 0));
        if (b.floors > 0) add(b.facade, wallQuad(side, b, y + gh, top, FACADES[b.facade].tileW, fh, 0));
      }
      // roof + coping
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const r = new THREE.PlaneGeometry(w, d);
      r.rotateX(-Math.PI / 2);
      r.translate(cx, top, cz);
      const uv = r.attributes.uv!;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 8), uv.getY(i) * (d / 8));
      roofs.push(r);
      const c = 0.35;
      trim.push(boxAt(w + 0.12, c, 0.3, cx, top + c / 2, b.z0 + 0.15), boxAt(w + 0.12, c, 0.3, cx, top + c / 2, b.z1 - 0.15));
      trim.push(boxAt(0.3, c, d - 0.6, b.x0 + 0.15, top + c / 2, cz), boxAt(0.3, c, d - 0.6, b.x1 - 0.15, top + c / 2, cz));
      // storefront canopy band / cornice between ground floor and upper floors
      if (b.floors > 0) {
        const t = 0.22;
        if (!b.skip?.includes('S')) trim.push(boxAt(w + 0.1, t, 0.25, cx, y + gh + t / 2, b.z1 + 0.1));
        if (!b.skip?.includes('N')) trim.push(boxAt(w + 0.1, t, 0.25, cx, y + gh + t / 2, b.z0 - 0.1));
        if (!b.skip?.includes('E')) trim.push(boxAt(0.25, t, d + 0.1, b.x1 + 0.1, y + gh + t / 2, cz));
        if (!b.skip?.includes('W')) trim.push(boxAt(0.25, t, d + 0.1, b.x0 - 0.1, y + gh + t / 2, cz));
      }
      for (let i = 0; i < (b.hvac ?? 0); i++) {
        const hw = 1.2 + rnd() * 1.4;
        const hd = 1 + rnd() * 1.2;
        hvac.push(boxAt(hw, 0.9 + rnd() * 0.6, hd, b.x0 + 1.5 + rnd() * Math.max(0.1, w - 3), top + 0.6, b.z0 + 1.5 + rnd() * Math.max(0.1, d - 3)));
      }
    }
    const merged: { kind: FacadeKind; geo: THREE.BufferGeometry }[] = [];
    for (const [kind, gs] of byKind) merged.push({ kind, geo: mergeGeometries(gs)! });
    return {
      merged,
      roofs: mergeGeometries(roofs)!,
      trim: mergeGeometries(trim.map((g) => g.toNonIndexed()))!,
      hvac: hvac.length ? mergeGeometries(hvac.map((g) => g.toNonIndexed()))! : null,
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      for (const m of built.merged) m.geo.dispose();
      built.roofs.dispose();
      built.trim.dispose();
      built.hvac?.dispose();
    },
    [built],
  );
  return (
    <group>
      {built.merged.map((m) => (
        <mesh key={m.kind} geometry={m.geo} material={facadeMaterial(m.kind)} castShadow receiveShadow />
      ))}
      <mesh geometry={built.roofs} material={roofMaterial()} receiveShadow />
      <mesh geometry={built.trim} material={trimMaterial()} castShadow receiveShadow />
      {built.hvac && <mesh geometry={built.hvac} material={hvacMaterial()} castShadow receiveShadow />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Instancing helper
// ---------------------------------------------------------------------------

export interface InstXf {
  p: Vec3;
  r?: Vec3;
  s?: Vec3;
  color?: string;
}

/** Static instanced mesh (transforms baked once). */
export function StaticInstances({
  geometry,
  material,
  items,
  castShadow = true,
  receiveShadow = true,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  items: InstXf[];
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
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      e.set(...(it.r ?? [0, 0, 0]));
      q.setFromEuler(e);
      p.set(...it.p);
      s.set(...(it.s ?? [1, 1, 1]));
      mat.compose(p, q, s);
      m.setMatrixAt(i, mat);
      if (it.color) m.setColorAt(i, c.set(it.color));
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, items.length)]} castShadow={castShadow} receiveShadow={receiveShadow} />;
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

export interface TreeSpec {
  x: number;
  z: number;
  y?: number;
  /** Size scale (1 ≈ 7 m tall street tree). */
  s?: number;
}

const trunkGeo = () => kgeo('city:trunk', () => new THREE.CylinderGeometry(0.1, 0.17, 1, 7).translate(0, 0.5, 0));
const canopyGeo = () => kgeo('city:canopy', () => new THREE.IcosahedronGeometry(1, 1));
const trunkMat = () => kmat('city:trunkMat', () => new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.95 }));
const canopyMat = () => kmat('city:canopyMat', () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: true }));
const GREENS = ['#4f7a36', '#5c8a3c', '#476f33', '#6a9243', '#3f6530'];

/** Deciduous street trees: 2 instanced draw calls for any number of trees. */
export function Trees({ items }: { items: TreeSpec[] }) {
  const { trunks, blobs } = useMemo(() => {
    const rnd = mulberry(5);
    const trunks: InstXf[] = [];
    const blobs: InstXf[] = [];
    for (const t of items) {
      const s = t.s ?? 1;
      const y = t.y ?? 0;
      const h = 2.6 * s;
      trunks.push({ p: [t.x, y, t.z], s: [s, h + 0.8 * s, s] });
      const col = GREENS[Math.floor(rnd() * GREENS.length)]!;
      blobs.push({ p: [t.x, y + h + 1.5 * s, t.z], s: [2.0 * s, 1.75 * s, 2.0 * s], r: [0, rnd() * 3, 0], color: col });
      for (let k = 0; k < 3; k++) {
        const a = rnd() * Math.PI * 2;
        const r = 1.1 * s;
        blobs.push({ p: [t.x + Math.cos(a) * r, y + h + (0.9 + rnd() * 1.2) * s, t.z + Math.sin(a) * r], s: [1.25 * s, 1.1 * s, 1.25 * s], r: [rnd(), rnd() * 3, 0], color: GREENS[Math.floor(rnd() * GREENS.length)] });
      }
    }
    return { trunks, blobs };
  }, [JSON.stringify(items)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <StaticInstances geometry={trunkGeo()} material={trunkMat()} items={trunks} />
      <StaticInstances geometry={canopyGeo()} material={canopyMat()} items={blobs} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Street lights (cobra-head luminaires on davit poles)
// ---------------------------------------------------------------------------

export interface StreetLightSpec {
  x: number;
  z: number;
  y?: number;
  /** Heading of the arm about +Y (0 = arm along +X). */
  angle: number;
  height?: number;
}

const lightPoleGeo = () => kgeo('city:lpole', () => new THREE.CylinderGeometry(0.065, 0.11, 1, 12).translate(0, 0.5, 0));
const lightArmGeo = () =>
  kgeo('city:larm', () => {
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(0.05, 0.05, 0), new THREE.Vector3(0.6, 0.35, 0), new THREE.Vector3(2.2, 0.45, 0)]);
    return new THREE.TubeGeometry(path, 16, 0.045, 8, false);
  });
const lightHeadGeo = () =>
  kgeo('city:lhead', () => {
    const g = new THREE.SphereGeometry(1, 16, 8);
    g.scale(0.38, 0.1, 0.19);
    g.translate(0.3, 0, 0);
    return g;
  });
const lightLensGeo = () =>
  kgeo('city:llens', () => {
    const g = new THREE.CircleGeometry(1, 20);
    g.rotateX(Math.PI / 2);
    g.scale(0.3, 1, 0.15);
    g.translate(0.32, -0.035, 0);
    return g;
  });
const poleMat = () => kmat('city:lpoleMat', () => new THREE.MeshStandardMaterial({ color: '#8f9598', roughness: 0.45, metalness: 0.7 }));
const headMat = () => kmat('city:lheadMat', () => new THREE.MeshStandardMaterial({ color: '#6c7176', roughness: 0.4, metalness: 0.5 }));

/** Street lights; `getLit` switches the LED lenses (4 draw calls total). */
export function StreetLights({ items, getLit }: { items: StreetLightSpec[]; getLit?: () => boolean }) {
  const lensMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#dfe6ea', emissive: '#fff4dc', emissiveIntensity: 0, roughness: 0.2, toneMapped: false }), []);
  useEffect(() => () => lensMat.dispose(), [lensMat]);
  const get = useLatest(getLit);
  useFrame(() => {
    const lit = get.current?.() ?? false;
    const target = lit ? 4 : 0.05;
    if (lensMat.emissiveIntensity !== target) lensMat.emissiveIntensity = target;
  });
  const { poles, parts } = useMemo(() => {
    const poles: InstXf[] = [];
    const parts: InstXf[] = [];
    for (const l of items) {
      const h = l.height ?? 8.5;
      poles.push({ p: [l.x, l.y ?? 0, l.z], s: [1, h, 1] });
      parts.push({ p: [l.x, (l.y ?? 0) + h, l.z], r: [0, l.angle, 0] });
    }
    return { poles, parts };
  }, [JSON.stringify(items)]); // eslint-disable-line react-hooks/exhaustive-deps
  const headParts = useMemo(() => parts.map((p) => ({ ...p, p: offsetAlong(p, 2.2, 0.45) })), [parts]);
  return (
    <group>
      <StaticInstances geometry={lightPoleGeo()} material={poleMat()} items={poles} />
      <StaticInstances geometry={lightArmGeo()} material={poleMat()} items={parts} />
      <StaticInstances geometry={lightHeadGeo()} material={headMat()} items={headParts} />
      <StaticInstances geometry={lightLensGeo()} material={lensMat} items={headParts} castShadow={false} />
    </group>
  );
}

function offsetAlong(it: InstXf, d: number, dy: number): Vec3 {
  const a = it.r?.[1] ?? 0;
  return [it.p[0] + Math.cos(a) * d, it.p[1] + dy, it.p[2] - Math.sin(a) * d];
}

// ---------------------------------------------------------------------------
// Pull boxes (utility hand holes) and bollards
// ---------------------------------------------------------------------------

function pullBoxTexture(text: string) {
  return canvasTexture(`city:pullbox:${text}`, 256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#5b5d5f';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3f4143';
    ctx.fillRect(0, 0, w, 14);
    ctx.fillRect(0, h - 14, w, 14);
    ctx.fillRect(0, 0, 14, h);
    ctx.fillRect(w - 14, 0, 14, h);
    // anti-slip pattern
    ctx.fillStyle = 'rgba(30,30,30,0.35)';
    for (let y = 40; y < h - 30; y += 22) for (let x = 30; x < w - 20; x += 22) ctx.fillRect(x, y, 10, 4);
    ctx.fillStyle = '#e8e8e2';
    ctx.font = '700 34px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 40));
  });
}

/** Traffic-signal pull boxes (lid flush with the ground). `text` e.g. 'TRAFFIC\nSIGNAL'. */
export function PullBoxes({ items, text = 'TRAFFIC\nSIGNAL' }: { items: { x: number; z: number; y?: number; angle?: number }[]; text?: string }) {
  const geo = kgeo('city:pullboxGeo', () => new THREE.BoxGeometry(0.45, 0.04, 0.7));
  const mat = kmat(`city:pullboxMat:${text}`, () => {
    const tex = pullBoxTexture(text);
    const side = new THREE.MeshStandardMaterial({ color: '#b3aea4', roughness: 0.9 });
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.3 });
    return [side, side, top, side, side, side] as unknown as THREE.Material;
  });
  const xf = useMemo<InstXf[]>(() => items.map((i) => ({ p: [i.x, (i.y ?? 0) - 0.012, i.z], r: [0, i.angle ?? 0, 0] })), [JSON.stringify(items)]); // eslint-disable-line react-hooks/exhaustive-deps
  return <StaticInstances geometry={geo} material={mat} items={xf} castShadow={false} />;
}

const bollardGeo = () => kgeo('city:bollard', () => new THREE.CylinderGeometry(0.1, 0.1, 1, 16).translate(0, 0.5, 0));
const bollardCapGeo = () => kgeo('city:bollardCap', () => new THREE.SphereGeometry(0.1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2));
const bollardMat = (c: string) => kmat(`city:bollardMat:${c}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.2 }));

/** Steel pipe bollards (painted). */
export function Bollards({ at, height = 1, color = '#f2c200', y = 0 }: { at: [number, number][]; height?: number; color?: string; y?: number }) {
  const bodies = useMemo<InstXf[]>(() => at.map(([x, z]) => ({ p: [x, y, z], s: [1, height, 1] })), [JSON.stringify(at), height, y]); // eslint-disable-line react-hooks/exhaustive-deps
  const caps = useMemo<InstXf[]>(() => at.map(([x, z]) => ({ p: [x, y + height, z] })), [JSON.stringify(at), height, y]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <StaticInstances geometry={bollardGeo()} material={bollardMat(color)} items={bodies} />
      <StaticInstances geometry={bollardCapGeo()} material={bollardMat(color)} items={caps} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Key-operated selector switch (800F-style, 22.5 mm)
// ---------------------------------------------------------------------------

export interface KeySwitch800FProps {
  position?: Vec3;
  rotation?: Vec3;
  /** Legend plate title lines. */
  legend: string[];
  /** Position labels, left → right. */
  positions: [string, string];
  /** True = key turned to the right position. */
  getOn: () => boolean;
  /** Maintained: a click toggles. */
  onToggle?: () => void;
  /** Spring return: pressed while the pointer is held. */
  onPress?: () => void;
  onRelease?: () => void;
  /** Extra scale (1 = real 22.5 mm device). */
  scale?: number;
}

const cylGeo = () => kgeo('city:keycyl', () => new THREE.CylinderGeometry(0.0106, 0.0108, 0.009, 32).rotateX(Math.PI / 2).translate(0, 0, 0.0045));
const cylFaceGeo = () => kgeo('city:keyface', () => new THREE.CircleGeometry(0.0098, 32).translate(0, 0, 0.0091));
const slotGeo = () => kgeo('city:keyslot', () => new THREE.BoxGeometry(0.0016, 0.0085, 0.0006).translate(0, 0, 0.0092));
const bladeGeo = () => kgeo('city:keyblade', () => new THREE.BoxGeometry(0.0021, 0.0075, 0.012).translate(0, 0, 0.015));
const bowGeo = () =>
  kgeo('city:keybow', () => {
    const s = new THREE.Shape();
    const w = 0.024;
    const h = 0.021;
    const r = 0.008;
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const hole = new THREE.Path();
    hole.absellipse(0, h / 2 - 0.0055, 0.0028, 0.0028, 0, Math.PI * 2, false, 0);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0032, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 10 });
    // bow stands edge-on along the key axis: its flat faces are ±X, its long axis is Z (out of the panel)
    g.rotateY(Math.PI / 2);
    g.rotateX(-Math.PI / 2);
    g.translate(-0.0016, 0, 0.021 + h / 2);
    return g;
  });
const chromeMat = () => kmat('city:chrome', () => new THREE.MeshStandardMaterial({ color: '#d9dcdf', roughness: 0.18, metalness: 1 }));
const darkMat = () => kmat('city:keydark', () => new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.5 }));
const brassMat = () => kmat('city:brass', () => new THREE.MeshStandardMaterial({ color: '#c8a24c', roughness: 0.25, metalness: 1 }));
const bowMat = () => kmat('city:keybowMat', () => new THREE.MeshStandardMaterial({ color: '#1d2126', roughness: 0.45 }));
const hoverRingMat = () =>
  kmat('city:hoverRing', () => new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }));
const hoverRingGeo = () => kgeo('city:hoverRingGeo', () => new THREE.RingGeometry(0.0152, 0.0172, 40).translate(0, 0, 0.0075));

/**
 * 22.5 mm key-operated selector switch (2 positions). Origin: hole center on the panel front, +Z out.
 * Click the key: maintained switches toggle; spring-return ones turn while the pointer is held.
 */
export function KeySwitch800F({ position, rotation, legend, positions, getOn, onToggle, onPress, onRelease, scale = 1 }: KeySwitch800FProps) {
  const key = useRef<THREE.Group>(null);
  const get = useLatest(getOn);
  const cb = useLatest({ onToggle, onPress, onRelease });
  const clickable = !!(onToggle || onPress);
  const { hovered, handlers } = useHoverCursor(clickable);
  useFrame((_, dt) => {
    const k = key.current;
    if (!k) return;
    const target = selectorAngle(get.current() ? 1 : 0, 2);
    k.rotation.z = THREE.MathUtils.damp(k.rotation.z, target, 18, Math.min(dt, 0.05));
  });
  const down = useMemo(
    () => (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const c = cb.current;
      if (c.onToggle) c.onToggle();
      else if (c.onPress) {
        c.onPress();
        let done = false;
        const up = () => {
          if (done) return;
          done = true;
          window.removeEventListener('pointerup', up);
          cb.current.onRelease?.();
        };
        window.addEventListener('pointerup', up);
        window.setTimeout(up, 4000);
      }
    },
    [cb],
  );
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <LegendPlate800F lines={legend} positions={positions} />
      <Bezel800F kind="metal" />
      <mesh geometry={cylGeo()} material={chromeMat()} castShadow />
      {hovered && <mesh geometry={hoverRingGeo()} material={hoverRingMat()} />}
      <group ref={key} {...(clickable ? { ...handlers, onPointerDown: down } : {})}>
        <mesh geometry={cylFaceGeo()} material={chromeMat()} />
        <mesh geometry={slotGeo()} material={darkMat()} />
        <mesh geometry={bladeGeo()} material={brassMat()} />
        <mesh geometry={bowGeo()} material={bowMat()} castShadow />
        {/* enlarged invisible hit volume around the key */}
        <mesh visible={false} position={[0, 0, 0.02]}>
          <boxGeometry args={[0.03, 0.03, 0.04]} />
        </mesh>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Canvas-texture sign (both faces printed) on an optional post. Origin: ground at the post. */
export function PostSign({
  id,
  size,
  draw,
  position,
  rotationY = 0,
  postHeight = 2.1,
  px = 400,
  children,
}: {
  id: string;
  size: [number, number];
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  position: Vec3;
  rotationY?: number;
  postHeight?: number;
  px?: number;
  children?: ReactNode;
}) {
  const tex = canvasTexture(`city:sign:${id}`, Math.round(size[0] * px), Math.round(size[1] * px), draw);
  const face = kmat(`city:signMat:${id}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1 }));
  const back = kmat('city:signBack', () => new THREE.MeshStandardMaterial({ color: '#a5aaae', roughness: 0.5, metalness: 0.6 }));
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {postHeight > 0 && (
        <mesh position={[0, (postHeight + size[1]) / 2, -0.03]} material={poleMat()} castShadow>
          <boxGeometry args={[0.05, postHeight + size[1], 0.05]} />
        </mesh>
      )}
      <group position={[0, postHeight + size[1] / 2, 0]}>
        <mesh material={face}>
          <planeGeometry args={size} />
        </mesh>
        <mesh material={back} position={[0, 0, -0.004]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={size} />
        </mesh>
        {children}
      </group>
    </group>
  );
}
