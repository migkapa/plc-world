/**
 * Road construction kit: asphalt (procedural canvas texture), thermoplastic lane markings (MUTCD:
 * 4" double yellow center line, 12"–24" white stop bars, 24" continental crosswalk bars), 6" concrete
 * curbs with gutter pans, broom-finished sidewalks with control joints, ADA curb-ramp detectable
 * warning pads (yellow truncated domes), grass verges, and painted parking stalls with numbers and
 * wheel stops.
 *
 * All pieces lie on the ground (road surface y = 0). Plan coordinates for <Intersection/> match the
 * traffic scene: x = east, z = south, NS road along Z, EW road along X, right-hand traffic.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import {
  TRAFFIC_COLORS,
  canvasTex,
  concreteTexture,
  makeCanvas,
  markingMat,
  mergeAll,
  mulberry32,
  roundedBox,
  sharedGeo,
  sharedMat,
  sharedTex,
  tmats,
  xf,
} from './shared';

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Sidewalk concrete with 1.5 m control joints (texture tile = 3 m). */
function sidewalkTexture(): THREE.CanvasTexture {
  return sharedTex('road:sidewalk', () => {
    const base = concreteTexture('#c4c0b6').image as HTMLCanvasElement;
    const [c, ctx] = makeCanvas(base.width, base.height);
    ctx.drawImage(base, 0, 0);
    ctx.strokeStyle = 'rgba(60,58,52,0.55)';
    ctx.lineWidth = 3;
    const S = base.width;
    for (const p of [0, S / 2]) {
      ctx.beginPath();
      ctx.moveTo(p + 1.5, 0);
      ctx.lineTo(p + 1.5, S);
      ctx.moveTo(0, p + 1.5);
      ctx.lineTo(S, p + 1.5);
      ctx.stroke();
    }
    return canvasTex(c, { repeat: true });
  });
}

function grassTexture(): THREE.CanvasTexture {
  return sharedTex('road:grass', () => {
    const S = 256;
    const [c, ctx] = makeCanvas(S, S);
    ctx.fillStyle = '#4f7a36';
    ctx.fillRect(0, 0, S, S);
    const rnd = mulberry32(12);
    for (let i = 0; i < 5000; i++) {
      const g = 90 + rnd() * 70;
      ctx.fillStyle = `rgba(${g * 0.55},${g},${g * 0.35},0.5)`;
      ctx.fillRect(rnd() * S, rnd() * S, 1.5, 3);
    }
    return canvasTex(c, { repeat: true });
  });
}

function domesTexture(): THREE.CanvasTexture {
  return sharedTex('road:domes', () => {
    const [c, ctx] = makeCanvas(128, 128);
    ctx.fillStyle = '#e8b400';
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 8; y < 128; y += 16)
      for (let x = 8; x < 128; x += 16) {
        const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 6);
        g.addColorStop(0, '#ffe066');
        g.addColorStop(1, '#b88a00');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }
    return canvasTex(c, { repeat: true });
  });
}

export const roadMats = {
  asphalt: () => tmats.asphalt(),
  sidewalk: () => sharedMat('road:sidewalkMat', () => new THREE.MeshStandardMaterial({ map: sidewalkTexture(), roughness: 0.9 })),
  curb: () => sharedMat('road:curbMat', () => new THREE.MeshStandardMaterial({ map: concreteTexture('#cfcbc2'), roughness: 0.85 })),
  gutter: () => sharedMat('road:gutterMat', () => new THREE.MeshStandardMaterial({ map: concreteTexture('#a9a59c'), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
  grass: () => sharedMat('road:grassMat', () => new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  domes: () => sharedMat('road:domesMat', () => new THREE.MeshStandardMaterial({ map: domesTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
  white: () => markingMat(TRAFFIC_COLORS.markingWhite),
  yellow: () => markingMat(TRAFFIC_COLORS.markingYellow),
};

/** Horizontal rectangle (on the ground) with world-scaled UVs (1 UV unit = `tile` m). */
function groundRect(x0: number, z0: number, x1: number, z1: number, y: number, tile = 0): THREE.BufferGeometry {
  const w = Math.abs(x1 - x0);
  const d = Math.abs(z1 - z0);
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  if (tile > 0) worldUv(g, tile);
  return g;
}

/** Planar XZ UVs in world meters / tile. */
function worldUv(g: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / tile, -pos.getZ(i) / tile);
  uv.needsUpdate = true;
  return g;
}

// ---------------------------------------------------------------------------
// Intersection
// ---------------------------------------------------------------------------

export type Arm = 'N' | 'S' | 'E' | 'W';

export interface IntersectionProps extends Placement {
  /** Half width of the NS road (curb to center, m). Default 3.5 (one 3.5 m lane per direction). */
  nsHalfWidth?: number;
  /** Half width of the EW road. Default 3.5. */
  ewHalfWidth?: number;
  /** Length of each arm from the center (m). Default 50. */
  armLength?: number;
  /** Stop-bar distance from the center (near edge of the bar). Default 8. */
  stopLineDist?: number;
  /** Arms that have a crosswalk. Default all four. */
  crosswalks?: Arm[];
  /** Crosswalk center distance from the intersection center. Default 5.5. */
  crosswalkDist?: number;
  crosswalkWidth?: number;
  sidewalkWidth?: number;
  /** Curb return radius at the corners. Default 3 m (≈ 10 ft, NACTO urban). */
  cornerRadius?: number;
  curbHeight?: number;
  /** Grass verges beyond the sidewalks (default true). */
  grass?: boolean;
}

export const INTERSECTION_DEFAULTS = {
  nsHalfWidth: 3.5,
  ewHalfWidth: 3.5,
  armLength: 50,
  stopLineDist: 8,
  crosswalkDist: 5.5,
  crosswalkWidth: 3,
  sidewalkWidth: 3,
  cornerRadius: 3,
  curbHeight: 0.15,
  /** Lawns sit this much below the walk. */
  lawnDrop: 0.03,
} as const;

/** Rectangle of marking paint, possibly rotated about Y. */
function stripe(cx: number, cz: number, lenX: number, lenZ: number, y = 0.003): THREE.BufferGeometry {
  return groundRect(cx - lenX / 2, cz - lenZ / 2, cx + lenX / 2, cz + lenZ / 2, y);
}

/**
 * Sidewalk band of one quadrant (quadrant-local positive coords): from the curb (straight curbs at
 * x = hx / z = hz joined by a curb return of radius R centred at (hx+R, hz+R)) to the back of walk
 * at hx+sw / hz+sw, out to the arm ends at L.
 */
function walkShape(hx: number, hz: number, L: number, R: number, sw: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(hx + R, hz);
  s.lineTo(L, hz);
  s.lineTo(L, hz + sw);
  if (R <= sw) {
    s.lineTo(hx + sw, hz + sw);
  } else {
    // back of walk concentric with the curb return
    const r2 = R - sw;
    s.lineTo(hx + R, hz + sw);
    s.absarc(hx + R, hz + R, r2, Math.PI * 1.5, Math.PI, true);
  }
  s.lineTo(hx + sw, L);
  s.lineTo(hx, L);
  s.lineTo(hx, hz + R);
  s.absarc(hx + R, hz + R, R, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Lawn behind the walk (quadrant-local). */
function lawnShape(hx: number, hz: number, L: number, R: number, sw: number): THREE.Shape {
  const s = new THREE.Shape();
  if (R <= sw) {
    s.moveTo(hx + sw, hz + sw);
  } else {
    const r2 = R - sw;
    s.moveTo(hx + sw, hz + R);
    s.absarc(hx + R, hz + R, r2, Math.PI, Math.PI * 1.5, false);
  }
  s.lineTo(L, hz + sw);
  s.lineTo(L, L);
  s.lineTo(hx + sw, L);
  s.closePath();
  return s;
}

/** Curb line offset from the road centerline at distance d along the other axis (quadrant-local). */
function curbAt(h: number, hOther: number, R: number, d: number): number {
  const c = hOther + R;
  if (d >= c) return h;
  const dz = c - d;
  return h + R - Math.sqrt(Math.max(0, R * R - dz * dz));
}

/** Extrude a quadrant shape (XY → XZ plane) from y0 to y1 and mirror it into quadrant (sx, sz). */
function extrudeQuadrant(shape: THREE.Shape, y0: number, y1: number, sx: number, sz: number, tile: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 16 });
  g.rotateX(Math.PI / 2); // shape XY -> XZ (y -> z), extrude -> -Y
  g.translate(0, y1, 0);
  g.scale(sx, 1, sz);
  if (sx * sz < 0) flipWinding(g);
  worldUv(g, tile);
  return g;
}

/** Flat annulus-sector strip on the ground (gutter pan around a curb return). */
function arcStrip(cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, y: number, tile: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r0, r1, 24, 1, a0, a1 - a0);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  return worldUv(g, tile);
}

export function Intersection({
  nsHalfWidth = INTERSECTION_DEFAULTS.nsHalfWidth,
  ewHalfWidth = INTERSECTION_DEFAULTS.ewHalfWidth,
  armLength = INTERSECTION_DEFAULTS.armLength,
  stopLineDist = INTERSECTION_DEFAULTS.stopLineDist,
  crosswalks = ['N', 'S', 'E', 'W'],
  crosswalkDist = INTERSECTION_DEFAULTS.crosswalkDist,
  crosswalkWidth = INTERSECTION_DEFAULTS.crosswalkWidth,
  sidewalkWidth = INTERSECTION_DEFAULTS.sidewalkWidth,
  cornerRadius = INTERSECTION_DEFAULTS.cornerRadius,
  curbHeight = INTERSECTION_DEFAULTS.curbHeight,
  grass = true,
  position,
  rotation,
  scale,
}: IntersectionProps) {
  const key = [nsHalfWidth, ewHalfWidth, armLength, stopLineDist, crosswalks.join(''), crosswalkDist, crosswalkWidth, sidewalkWidth, cornerRadius, curbHeight, grass].join(':');
  const geo = useMemo(() => buildIntersection(key), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  function buildIntersection(k: string) {
    return intersectionCache.get(k) ?? makeIntersection(k);
  }
  function makeIntersection(k: string) {
    const L = armLength;
    const hx = nsHalfWidth;
    const hz = ewHalfWidth;
    const R = cornerRadius;
    const H = curbHeight;
    const asphalt = groundRect(-L, -L, L, L, 0, 4);

    // Sidewalk bands (curb face included) and lawns 3 cm lower behind them: separate solids, so no
    // coplanar / overlapping surfaces anywhere.
    const blocks: THREE.BufferGeometry[] = [];
    const lawns: THREE.BufferGeometry[] = [];
    const gutters: THREE.BufferGeometry[] = [];
    const sw = grass ? sidewalkWidth : L;
    const lawnTop = H - INTERSECTION_DEFAULTS.lawnDrop;
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        blocks.push(extrudeQuadrant(walkShape(hx, hz, L, R, Math.min(sw, L - Math.max(hx, hz) - 0.01)), 0, H, sx, sz, 3));
        if (grass) lawns.push(extrudeQuadrant(lawnShape(hx, hz, L, R, sidewalkWidth), 0, lawnTop, sx, sz, 3));
        // gutter pans along both straight curbs + around the curb return
        gutters.push(groundRect(sx > 0 ? hx - 0.45 : -hx, sz * (hz + R), sx > 0 ? hx : -hx + 0.45, sz * L, 0.002, 3));
        gutters.push(groundRect(sx * (hx + R), sz > 0 ? hz - 0.45 : -hz, sx * L, sz > 0 ? hz : -hz + 0.45, 0.002, 3));
        if (R > 0.05) {
          const cx = sx * (hx + R);
          const cz = sz * (hz + R);
          // the curb return faces the origin: centre → (-sx, -sz) direction. RingGeometry angle a lies at
          // plan direction (cos a, -sin a) after rotateX(-π/2), so a = atan2(sz, -sx).
          const mid = Math.atan2(sz, -sx);
          gutters.push(arcStrip(cx, cz, R, R + 0.45, mid - Math.PI / 4, mid + Math.PI / 4, 0.002, 3));
        }
      }

    // markings
    const white: THREE.BufferGeometry[] = [];
    const yellow: THREE.BufferGeometry[] = [];
    const domes: THREE.BufferGeometry[] = [];
    const cwOuter = crosswalkDist + crosswalkWidth / 2;
    // double yellow center lines (4" lines, 4" gap) from the stop bar outwards
    const yStart = Math.max(stopLineDist, cwOuter);
    for (const s of [1, -1]) {
      const mid = s * (yStart + (L - yStart) / 2);
      for (const o of [-0.1, 0.1]) {
        yellow.push(stripe(o, mid, 0.1, L - yStart)); // NS
        yellow.push(stripe(mid, o, L - yStart, 0.1)); // EW
      }
    }
    // stop bars (0.45 m) across the approach lanes (right-hand traffic)
    const sb = 0.45;
    white.push(stripe((0.15 + hx - 0.1) / 2, stopLineDist + sb / 2, hx - 0.25, sb)); // NB (south arm, east half)
    white.push(stripe(-(0.15 + hx - 0.1) / 2, -stopLineDist - sb / 2, hx - 0.25, sb)); // SB
    white.push(stripe(-stopLineDist - sb / 2, (0.15 + hz - 0.1) / 2, sb, hz - 0.25)); // EB (west arm, south half)
    white.push(stripe(stopLineDist + sb / 2, -(0.15 + hz - 0.1) / 2, sb, hz - 0.25)); // WB
    // dashed lane-edge extension lines are omitted (single-lane approaches)
    // continental crosswalks: 0.6 m bars, 0.6 m gaps, parallel to traffic
    for (const arm of crosswalks) {
      const ns = arm === 'N' || arm === 'S';
      const sgn = arm === 'S' || arm === 'E' ? 1 : -1;
      const half = ns ? hx : hz;
      const c = sgn * crosswalkDist;
      const n = Math.floor((2 * half - 0.3) / 1.2);
      const span = n * 1.2 - 0.6;
      for (let i = 0; i < n; i++) {
        const o = -span / 2 + 0.3 + i * 1.2;
        white.push(ns ? stripe(o, c, 0.6, crosswalkWidth) : stripe(c, o, crosswalkWidth, 0.6));
      }
      // detectable warning pads (truncated domes, 5 mm proud) at both curb ramps, front edge at the
      // curb line (which may lie on the curb return)
      for (const e of [1, -1]) {
        const pw = Math.min(1.5, crosswalkWidth - 0.4) / 2; // ramp width ≈ 5 ft
        const hThis = ns ? hx : hz;
        const d0 = Math.abs(c) - pw;
        const curb = Math.max(curbAt(hThis, ns ? hz : hx, R, d0), curbAt(hThis, ns ? hz : hx, R, Math.abs(c) + pw));
        const near = e * (curb + 0.05);
        const far = e * (curb + 0.05 + 0.61);
        const box = (x0: number, z0: number, x1: number, z1: number) => {
          const g = new THREE.BoxGeometry(Math.abs(x1 - x0), 0.005, Math.abs(z1 - z0));
          g.translate((x0 + x1) / 2, H + 0.0025, (z0 + z1) / 2);
          return worldUv(g, 0.4);
        };
        domes.push(ns ? box(near, c - pw, far, c + pw) : box(c - pw, near, c + pw, far));
      }
    }
    const res = {
      asphalt,
      blocks: mergeAll(blocks),
      lawns: lawns.length ? mergeAll(lawns) : null,
      gutters: mergeAll(gutters),
      white: mergeAll(white),
      yellow: mergeAll(yellow),
      domes: domes.length ? mergeAll(domes) : null,
    };
    intersectionCache.set(k, res);
    return res;
  }
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geo.asphalt} material={roadMats.asphalt()} receiveShadow />
      <mesh geometry={geo.gutters} material={roadMats.gutter()} receiveShadow />
      <mesh geometry={geo.blocks} material={roadMats.sidewalk()} receiveShadow castShadow />
      {geo.lawns && <mesh geometry={geo.lawns} material={roadMats.grass()} receiveShadow />}
      <mesh geometry={geo.white} material={roadMats.white()} receiveShadow />
      <mesh geometry={geo.yellow} material={roadMats.yellow()} receiveShadow />
      {geo.domes && <mesh geometry={geo.domes} material={roadMats.domes()} receiveShadow />}
    </group>
  );
}

interface IntersectionGeoms {
  asphalt: THREE.BufferGeometry;
  blocks: THREE.BufferGeometry;
  lawns: THREE.BufferGeometry | null;
  gutters: THREE.BufferGeometry;
  white: THREE.BufferGeometry;
  yellow: THREE.BufferGeometry;
  domes: THREE.BufferGeometry | null;
}
const intersectionCache = new Map<string, IntersectionGeoms>();

function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, a);
    }
  } else {
    const pos = g.attributes.position!;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i += 3) {
      for (const attr of [pos, nor, uv]) {
        if (!attr) continue;
        for (let k = 0; k < attr.itemSize; k++) {
          const a = attr.getComponent(i + 1, k);
          attr.setComponent(i + 1, k, attr.getComponent(i + 2, k));
          attr.setComponent(i + 2, k, a);
        }
      }
    }
  }
  g.computeVertexNormals();
}

// ---------------------------------------------------------------------------
// Straight road segment
// ---------------------------------------------------------------------------

export interface RoadSegmentProps extends Placement {
  /** Length along X (m). */
  length: number;
  /** Lanes per direction. Default 1. */
  lanesPerDirection?: number;
  laneWidth?: number;
  /** Center marking. Default 'double-yellow'. 'one-way' draws dashed white lane lines only. */
  center?: 'double-yellow' | 'dashed-yellow' | 'none' | 'one-way';
  /** Sidewalk width on each side (0 = no curb/sidewalk). Default 3. */
  sidewalkWidth?: number;
  curbHeight?: number;
  /** White edge lines (rural style). */
  edgeLines?: boolean;
  /** Stop bars: x position (near edge) and which side (+Z lanes or −Z lanes). */
  stopBars?: { x: number; side: 1 | -1 }[];
  /** Continental crosswalks centered at these x positions. */
  crosswalks?: { x: number; width?: number }[];
}

/** Straight road along X, centered at the origin: asphalt, markings, gutters, curbs & sidewalks. */
export function RoadSegment({
  length,
  lanesPerDirection = 1,
  laneWidth = 3.5,
  center = 'double-yellow',
  sidewalkWidth = 3,
  curbHeight = 0.15,
  edgeLines = false,
  stopBars = [],
  crosswalks = [],
  position,
  rotation,
  scale,
}: RoadSegmentProps) {
  const key = JSON.stringify([length, lanesPerDirection, laneWidth, center, sidewalkWidth, curbHeight, edgeLines, stopBars, crosswalks]);
  const geo = useMemo(() => {
    const hw = lanesPerDirection * laneWidth * (center === 'one-way' ? 0.5 : 1);
    const L = length / 2;
    const white: THREE.BufferGeometry[] = [];
    const yellow: THREE.BufferGeometry[] = [];
    const halfW = center === 'one-way' ? hw : hw;
    const asphalt = groundRect(-L, -halfW, L, halfW, 0, 4);
    if (center === 'double-yellow') for (const o of [-0.1, 0.1]) yellow.push(stripe(0, o, length, 0.1));
    if (center === 'dashed-yellow') for (let x = -L + 1; x < L - 3; x += 12) yellow.push(stripe(x + 1.5, 0, 3, 0.1));
    // lane lines between same-direction lanes (dashed white 3 m / 9 m)
    const lanes = center === 'one-way' ? lanesPerDirection * 2 : lanesPerDirection;
    for (const s of center === 'one-way' ? [1] : [1, -1])
      for (let i = 1; i < lanes; i++) {
        const z = center === 'one-way' ? -halfW + i * laneWidth : s * i * laneWidth;
        for (let x = -L + 1; x < L - 3; x += 12) white.push(stripe(x + 1.5, z, 3, 0.1));
      }
    if (edgeLines) for (const s of [1, -1]) white.push(stripe(0, s * (halfW - 0.25), length, 0.15));
    for (const b of stopBars) white.push(stripe(b.x + 0.225, b.side * (halfW / 2 + 0.05), 0.45, halfW - 0.3));
    for (const c of crosswalks) {
      const w = c.width ?? 3;
      const n = Math.floor((2 * halfW - 0.3) / 1.2);
      const span = n * 1.2 - 0.6;
      for (let i = 0; i < n; i++) white.push(stripe(c.x, -span / 2 + 0.3 + i * 1.2, w, 0.6));
    }
    const sides: THREE.BufferGeometry[] = [];
    const gutters: THREE.BufferGeometry[] = [];
    if (sidewalkWidth > 0) {
      for (const s of [1, -1]) {
        const sw = xf(roundedBox(length, curbHeight, sidewalkWidth, 0.02, 1), [0, curbHeight / 2, s * (halfW + sidewalkWidth / 2)]);
        worldUv(sw, 3);
        sides.push(sw);
        gutters.push(groundRect(-L, s > 0 ? halfW - 0.45 : -halfW, L, s > 0 ? halfW : -halfW + 0.45, 0.002, 3));
      }
    }
    return {
      asphalt,
      white: white.length ? mergeAll(white) : null,
      yellow: yellow.length ? mergeAll(yellow) : null,
      sides: sides.length ? mergeAll(sides) : null,
      gutters: gutters.length ? mergeAll(gutters) : null,
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geo.asphalt} material={roadMats.asphalt()} receiveShadow />
      {geo.gutters && <mesh geometry={geo.gutters} material={roadMats.gutter()} receiveShadow />}
      {geo.sides && <mesh geometry={geo.sides} material={roadMats.sidewalk()} receiveShadow castShadow />}
      {geo.white && <mesh geometry={geo.white} material={roadMats.white()} receiveShadow />}
      {geo.yellow && <mesh geometry={geo.yellow} material={roadMats.yellow()} receiveShadow />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Ground slab
// ---------------------------------------------------------------------------

export interface GroundSlabProps extends Placement {
  /** Size along X and Z (m). */
  size: [number, number];
  kind?: 'asphalt' | 'concrete' | 'grass' | 'sidewalk';
  /** Slab thickness; 0 = a flat plane at y = 0. */
  thickness?: number;
}

/** Flat asphalt / concrete / grass area (e.g. the garage deck). Top surface at y = thickness. */
export function GroundSlab({ size, kind = 'concrete', thickness = 0, position, rotation, scale }: GroundSlabProps) {
  const geo = sharedGeo(`road:slab:${size[0]}:${size[1]}:${thickness}:${kind === 'asphalt' ? 4 : 3}`, () => {
    if (thickness <= 0) return groundRect(-size[0] / 2, -size[1] / 2, size[0] / 2, size[1] / 2, 0, kind === 'asphalt' ? 4 : 3);
    const g = new THREE.BoxGeometry(size[0], thickness, size[1]);
    g.translate(0, thickness / 2, 0);
    return worldUv(g, kind === 'asphalt' ? 4 : 3);
  });
  const mat =
    kind === 'asphalt'
      ? roadMats.asphalt()
      : kind === 'grass'
        ? roadMats.grass()
        : kind === 'sidewalk'
          ? roadMats.sidewalk()
          : sharedMat('road:deck', () => new THREE.MeshStandardMaterial({ map: concreteTexture('#9f9d98'), roughness: 0.82 }));
  return <mesh geometry={geo} material={mat} position={position} rotation={rotation} scale={scale} receiveShadow />;
}

// ---------------------------------------------------------------------------
// Parking stall
// ---------------------------------------------------------------------------

export interface ParkingSpaceProps extends Placement {
  /** Painted space number. */
  number?: number | string;
  /** Stall width (Z) and depth (X). Default 2.5 × 5. */
  width?: number;
  depth?: number;
  lineColor?: 'white' | 'yellow';
  /** Which side lines to paint (neighbors can share a line). Default 'both'. */
  sides?: 'both' | 'left' | 'right' | 'none';
  /** Line across the back (+X end). */
  backLine?: boolean;
  /** Precast concrete wheel stop near the back. Default true. */
  wheelStop?: boolean;
  /** Accessible stall (blue lines + wheelchair symbol). */
  accessible?: boolean;
  /** Occupied highlight (e.g. from a space sensor) — tints the stall. */
  getOccupied?: () => boolean;
}

function numberTexture(text: string, color: string): THREE.CanvasTexture {
  return sharedTex(`road:num:${text}:${color}`, () => {
    const [c, ctx] = makeCanvas(256, 256);
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 190px "Arial Narrow", Arial, Helvetica, sans-serif';
    ctx.fillText(text, 128, 138);
    return canvasTex(c);
  });
}

function wheelchairTexture(): THREE.CanvasTexture {
  return sharedTex('road:isa', () => {
    const [c, ctx] = makeCanvas(256, 256);
    ctx.fillStyle = '#1f5fbf';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(118, 52, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(112, 84);
    ctx.lineTo(112, 150);
    ctx.lineTo(170, 150);
    ctx.lineTo(196, 206);
    ctx.moveTo(112, 110);
    ctx.lineTo(160, 110);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(116, 168, 50, Math.PI * 0.15, Math.PI * 1.35);
    ctx.stroke();
    return canvasTex(c);
  });
}

/**
 * Painted parking stall. Origin: stall center on the ground; the stall is `depth` long along X with
 * its BACK (wheel stop, number) at +X and the entrance at −X — rotate it with the same yaw as a car
 * parked nose-in (cars face +X).
 */
export function ParkingSpace({
  number,
  width = 2.5,
  depth = 5,
  lineColor = 'white',
  sides = 'both',
  backLine = false,
  wheelStop = true,
  accessible = false,
  position,
  rotation,
  scale,
}: ParkingSpaceProps) {
  const color = accessible ? '#2a6fd6' : lineColor === 'yellow' ? TRAFFIC_COLORS.markingYellow : TRAFFIC_COLORS.markingWhite;
  const lines = sharedGeo(`road:stall:${width}:${depth}:${sides}:${backLine}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const lw = 0.1;
    if (sides === 'both' || sides === 'left') parts.push(stripe(0, -width / 2, depth, lw));
    if (sides === 'both' || sides === 'right') parts.push(stripe(0, width / 2, depth, lw));
    if (backLine) parts.push(stripe(depth / 2 - lw / 2, 0, lw, width));
    if (parts.length === 0) parts.push(stripe(0, 0, 0.001, 0.001));
    return mergeAll(parts);
  });
  const label = number !== undefined ? String(number) : null;
  const numMat = label ? sharedMat(`road:numMat:${label}:${color}`, () => new THREE.MeshStandardMaterial({ map: numberTexture(label, color), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false })) : null;
  const stop = sharedGeo('road:wheelstop', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.1, 0);
    s.lineTo(0.1, 0);
    s.lineTo(0.07, 0.1);
    s.lineTo(-0.07, 0.1);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.8, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 });
    g.translate(0, 0, -0.9);
    return worldUv(g, 3);
  });
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={lines} material={markingMat(color)} receiveShadow />
      {label && numMat && (
        <mesh position={[depth / 2 - 0.95, 0.004, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
          <planeGeometry args={[0.9, 0.9]} />
          <primitive object={numMat} attach="material" />
        </mesh>
      )}
      {accessible && (
        <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
          <planeGeometry args={[1.2, 1.2]} />
          <meshStandardMaterial map={wheelchairTexture()} roughness={0.6} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
      )}
      {wheelStop && <mesh geometry={stop} material={roadMats.curb()} position={[depth / 2 - 0.55, 0, 0]} castShadow receiveShadow />}
    </group>
  );
}
