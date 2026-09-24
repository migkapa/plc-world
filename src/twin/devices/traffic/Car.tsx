/**
 * Passenger cars (sedan, hatchback, SUV, taxi) for the traffic & parking scenes.
 *
 * Construction (see carBody.ts): the lower body and the greenhouse are LOFTED GRIDS with smooth
 * normals — rounded bumper fascias (nose/tail plan radius ≈ 0.3–0.5 m, bullnose side profile), real
 * wheel-arch openings with black wells and a tight arch gap, bulged doors, shoulder shelf, tumblehome,
 * crowned hood and roof. One body atlas carries paint vs. glass vs. gloss-black trim vs. chrome
 * (per-texel clearcoat / roughness / paint mask), door cuts and handles; fascia parts (grille with a
 * honeycomb mesh, lower intake with fog pods, plates, rear diffuser) and the lamp clusters (angular
 * headlamps with projectors, DRL light guide and turn segment; wrap-around LED tail lamps) are decals
 * PROJECTED onto the body surface so they sit flush. Lamps are clear-coated physical lenses whose
 * emission (DRL, low beam, tail, brake, turn, taxi sign) is driven per car. Wheels: tire with tread
 * grooves, 10-spoke concave alloy with a dark barrel, lug nuts, brake disc and caliper.
 *
 * Conventions (match the scene logics' pose helpers): the car FRONT faces +X, Y up, origin = car
 * center on the ground (x = 0 halfway between the bumpers). Right side = +Z.
 *
 *  - <Car/>       one car (≈ 10 draw calls; geometry & materials shared per style/color).
 *  - <CarFleet/>  many cars in ≈ 23 draw calls total (InstancedMesh per style/part, per-instance paint
 *                 color, solid vs metallic paint meshes, wheel spin/steer, lamp levels).
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Placement } from '../../contracts';
import { buildBody, UV_PAINT, type BodyStyle, type BuiltBody, type DecalSpec } from './carBody';
import { DECAL_CELLS, LAMP_CELLS, bodyAtlas, decalAtlas, lampAtlas, type BodyAtlas } from './carTextures';
import { FINISH, cylY, hoverMat, mergeVc, sharedMat, useClickable, useDisposable, vc, vcMaterial, xf, type VcFinish } from './shared';

// ---------------------------------------------------------------------------
// Styles & variants
// ---------------------------------------------------------------------------

export type CarStyle = 'sedan' | 'hatchback' | 'suv' | 'taxi';
export type CarColorName = 'white' | 'silver' | 'black' | 'red' | 'blue' | 'gray' | 'yellow' | 'green' | 'orange' | 'teal' | 'beige';

export const CAR_PAINT: Record<CarColorName, { hex: string; metallic: boolean }> = {
  white: { hex: '#e8eaeb', metallic: false },
  silver: { hex: '#a9afb5', metallic: true },
  black: { hex: '#121417', metallic: true },
  red: { hex: '#a30f19', metallic: false },
  blue: { hex: '#1c3c8c', metallic: true },
  gray: { hex: '#4a5056', metallic: true },
  yellow: { hex: '#f0b400', metallic: false },
  green: { hex: '#2c5a40', metallic: true },
  orange: { hex: '#d45d16', metallic: false },
  teal: { hex: '#177079', metallic: true },
  beige: { hex: '#c8b89a', metallic: true },
};

const VARIANTS: { style: CarStyle; color: CarColorName }[] = [
  { style: 'sedan', color: 'white' },
  { style: 'hatchback', color: 'red' },
  { style: 'suv', color: 'blue' },
  { style: 'sedan', color: 'silver' },
  { style: 'suv', color: 'black' },
  { style: 'hatchback', color: 'teal' },
  { style: 'taxi', color: 'yellow' },
  { style: 'suv', color: 'gray' },
  { style: 'sedan', color: 'green' },
  { style: 'hatchback', color: 'orange' },
];

/** Deterministic style & color for a scene variant number (scenes use 0..7). */
export function carVariant(variant: number): { style: CarStyle; color: CarColorName } {
  const n = VARIANTS.length;
  return VARIANTS[((Math.floor(variant) % n) + n) % n]!;
}

const cell = (c: readonly [number, number, number, number]) => [...c] as [number, number, number, number];
const D = (at: [number, number, number], yaw: number, size: [number, number], c: readonly [number, number, number, number], offset: number, grid?: [number, number]): DecalSpec => ({
  at,
  yaw,
  size,
  cell: cell(c),
  offset,
  grid,
});

/** Mid-size sedan (≈ 4.80 × 1.84 × 1.44 m, 2.82 m wheelbase, 235/45R18). */
const SEDAN: BodyStyle = {
  base: 'sedan',
  W: 1.84,
  wheelR: 0.335,
  tireW: 0.225,
  archGap: 0.03,
  axleF: 1.44,
  axleR: -1.38,
  lower: [
    [2.4, 0.48],
    [2.395, 0.6],
    [2.37, 0.675],
    [2.31, 0.72],
    [2.2, 0.745],
    [1.9, 0.78],
    [1.4, 0.835],
    [1.0, 0.89],
    [0.6, 0.925],
    [-0.4, 0.955],
    [-1.2, 0.985],
    [-1.7, 1.005],
    [-2.1, 1.02],
    [-2.3, 1.015],
    [-2.37, 0.975],
    [-2.4, 0.88],
    [-2.4, 0.62],
    [-2.38, 0.46],
    [-2.31, 0.35],
    [-2.12, 0.27],
    [-1.8, 0.225],
    [0.0, 0.21],
    [1.9, 0.215],
    [2.18, 0.235],
    [2.33, 0.28],
    [2.39, 0.37],
  ],
  roof: [
    [0.98, 0.895],
    [0.7, 1.06],
    [0.4, 1.23],
    [0.12, 1.36],
    [-0.12, 1.425],
    [-0.45, 1.445],
    [-0.85, 1.44],
    [-1.1, 1.41],
    [-1.35, 1.32],
    [-1.6, 1.17],
    [-1.82, 1.035],
  ],
  planF: [0.3, 0.42, 2.8],
  planR: [0.2, 0.34, 3],
  ghPlanF: [0.35, 0.3],
  ghPlanR: [0.3, 0.3],
  shelf: 0.035,
  tumble: 0.15,
  rTop: 0.04,
  rBot: 0.06,
  bulge: 0.025,
  crease: [0.66, 0.87],
  creaseLean: 0.16,
  crownHood: 0.035,
  crownDeck: 0.025,
  roofR: 0.09,
  roofCrown: 0.035,
  xWsTop: -0.05,
  xRoofRear: -1.08,
  windows: [
    { x0: -0.26, x1: 0.98 },
    { x0: -1.34, x1: -0.36, rakeRear: 0.22 },
  ],
  blackPillars: [[-0.36, -0.26]],
  seams: [1.02, -0.31, -1.3],
  handles: [-0.13, -1.12],
  handleDrop: 0.11,
  cladding: false,
  head: D([2.26, 0.665, 0.62], 0.5, [0.52, 0.15], LAMP_CELLS.head, 0.004),
  tail: D([-2.34, 0.88, 0.63], Math.PI - 0.55, [0.5, 0.13], LAMP_CELLS.tail, 0.004),
  grille: D([2.4, 0.53, 0], 0, [0.8, 0.2], DECAL_CELLS.grille, 0.003),
  intake: D([2.4, 0.33, 0], 0, [1.25, 0.13], DECAL_CELLS.intake, 0.003),
  plateF: D([2.4, 0.4, 0], 0, [0.305, 0.152], DECAL_CELLS.plate, 0.008, [8, 4]),
  plateR: D([-2.4, 0.66, 0], Math.PI, [0.305, 0.152], DECAL_CELLS.plate, 0.006, [8, 4]),
  valance: D([-2.4, 0.37, 0], Math.PI, [1.4, 0.13], DECAL_CELLS.valance, 0.003),
  splitter: D([2.36, 0.245, 0], 0, [1.35, 0.05], DECAL_CELLS.splitter, 0.003, [18, 2]),
};

/** C-segment hatchback (≈ 4.28 × 1.79 × 1.46 m, 2.63 m wheelbase, 225/45R17). */
const HATCH: BodyStyle = {
  ...SEDAN,
  base: 'hatchback',
  W: 1.79,
  wheelR: 0.317,
  tireW: 0.215,
  archGap: 0.03,
  axleF: 1.27,
  axleR: -1.36,
  lower: [
    [2.14, 0.48],
    [2.135, 0.6],
    [2.11, 0.68],
    [2.05, 0.73],
    [1.93, 0.765],
    [1.65, 0.8],
    [1.25, 0.85],
    [0.92, 0.905],
    [0.5, 0.935],
    [-0.5, 0.965],
    [-1.3, 0.99],
    [-1.8, 1.005],
    [-2.02, 1.01],
    [-2.1, 0.985],
    [-2.135, 0.9],
    [-2.14, 0.62],
    [-2.125, 0.46],
    [-2.07, 0.35],
    [-1.93, 0.27],
    [-1.7, 0.23],
    [0.0, 0.215],
    [1.7, 0.22],
    [1.95, 0.24],
    [2.08, 0.285],
    [2.13, 0.37],
  ],
  roof: [
    [0.92, 0.9],
    [0.62, 1.07],
    [0.32, 1.25],
    [0.06, 1.39],
    [-0.2, 1.455],
    [-0.7, 1.465],
    [-1.2, 1.44],
    [-1.52, 1.4],
    [-1.74, 1.34],
    [-1.9, 1.2],
    [-2.0, 1.08],
    [-2.05, 1.0],
  ],
  planF: [0.28, 0.4, 2.8],
  planR: [0.18, 0.3, 3.2],
  ghPlanF: [0.35, 0.3],
  ghPlanR: [0.2, 0.25],
  shelf: 0.035,
  tumble: 0.14,
  crownDeck: 0.015,
  roofCrown: 0.03,
  crease: [0.67, 0.86],
  xWsTop: 0.0,
  xRoofRear: -1.72,
  windows: [
    { x0: -0.3, x1: 0.92 },
    { x0: -1.22, x1: -0.4, rakeRear: 0.1 },
    { x0: -1.62, x1: -1.3, rakeRear: 0.22 },
  ],
  blackPillars: [
    [-0.4, -0.3],
    [-1.3, -1.22],
  ],
  seams: [0.95, -0.35, -1.18],
  handles: [-0.17, -1.02],
  handleDrop: 0.1,
  head: D([2.02, 0.67, 0.6], 0.5, [0.48, 0.14], LAMP_CELLS.head, 0.004),
  tail: D([-2.11, 0.86, 0.6], Math.PI - 0.6, [0.42, 0.12], LAMP_CELLS.tail, 0.004),
  grille: D([2.14, 0.53, 0], 0, [0.72, 0.19], DECAL_CELLS.grille, 0.003),
  intake: D([2.14, 0.33, 0], 0, [1.15, 0.12], DECAL_CELLS.intake, 0.003),
  plateF: D([2.14, 0.4, 0], 0, [0.305, 0.152], DECAL_CELLS.plate, 0.008, [8, 4]),
  plateR: D([-2.14, 0.62, 0], Math.PI, [0.305, 0.152], DECAL_CELLS.plate, 0.006, [8, 4]),
  valance: D([-2.14, 0.36, 0], Math.PI, [1.3, 0.12], DECAL_CELLS.valance, 0.003),
  splitter: D([2.1, 0.245, 0], 0, [1.25, 0.05], DECAL_CELLS.splitter, 0.003, [18, 2]),
};

/** Compact SUV (≈ 4.60 × 1.86 × 1.70 m, 2.69 m wheelbase, 225/60R18). */
const SUV: BodyStyle = {
  ...SEDAN,
  base: 'suv',
  W: 1.86,
  wheelR: 0.36,
  tireW: 0.225,
  archGap: 0.05,
  axleF: 1.37,
  axleR: -1.32,
  lower: [
    [2.3, 0.58],
    [2.295, 0.74],
    [2.27, 0.86],
    [2.2, 0.94],
    [2.08, 0.975],
    [1.8, 1.0],
    [1.4, 1.04],
    [1.1, 1.08],
    [0.6, 1.1],
    [-0.5, 1.125],
    [-1.5, 1.145],
    [-2.0, 1.155],
    [-2.2, 1.15],
    [-2.27, 1.12],
    [-2.3, 1.02],
    [-2.3, 0.66],
    [-2.28, 0.5],
    [-2.2, 0.39],
    [-2.0, 0.33],
    [-1.7, 0.3],
    [0.0, 0.29],
    [1.75, 0.3],
    [2.05, 0.32],
    [2.2, 0.38],
    [2.28, 0.48],
  ],
  roof: [
    [1.1, 1.075],
    [0.82, 1.25],
    [0.52, 1.47],
    [0.28, 1.62],
    [0.0, 1.69],
    [-0.6, 1.705],
    [-1.5, 1.7],
    [-1.95, 1.68],
    [-2.12, 1.63],
    [-2.21, 1.5],
    [-2.25, 1.32],
    [-2.26, 1.12],
  ],
  planF: [0.3, 0.4, 3],
  planR: [0.2, 0.32, 3.2],
  ghPlanF: [0.35, 0.28],
  ghPlanR: [0.18, 0.2],
  shelf: 0.035,
  tumble: 0.13,
  rTop: 0.045,
  rBot: 0.07,
  bulge: 0.03,
  crease: [0.86, 1.0],
  crownHood: 0.04,
  crownDeck: 0.01,
  roofR: 0.1,
  roofCrown: 0.03,
  xWsTop: 0.25,
  xRoofRear: -2.1,
  windows: [
    { x0: -0.3, x1: 1.1 },
    { x0: -1.24, x1: -0.38 },
    { x0: -2.02, x1: -1.32, rakeRear: 0.1 },
  ],
  blackPillars: [
    [-0.38, -0.3],
    [-1.32, -1.24],
  ],
  seams: [1.1, -0.34, -1.22],
  handles: [-0.18, -1.07],
  handleDrop: 0.1,
  cladding: true,
  head: D([2.17, 0.87, 0.62], 0.5, [0.5, 0.15], LAMP_CELLS.head, 0.004),
  tail: D([-2.28, 1.0, 0.66], Math.PI - 0.6, [0.42, 0.15], LAMP_CELLS.tail, 0.004),
  grille: D([2.3, 0.7, 0], 0, [0.86, 0.26], DECAL_CELLS.grille, 0.003),
  intake: D([2.3, 0.43, 0], 0, [1.3, 0.15], DECAL_CELLS.intake, 0.003),
  plateF: D([2.3, 0.52, 0], 0, [0.305, 0.152], DECAL_CELLS.plate, 0.008, [8, 4]),
  plateR: D([-2.3, 0.8, 0], Math.PI, [0.305, 0.152], DECAL_CELLS.plate, 0.006, [8, 4]),
  valance: D([-2.3, 0.44, 0], Math.PI, [1.4, 0.16], DECAL_CELLS.valance, 0.003),
  splitter: D([2.26, 0.335, 0], 0, [1.1, 0.06], DECAL_CELLS.splitter, 0.003, [18, 2]),
};

const STYLES: Record<CarStyle, BodyStyle> = { sedan: SEDAN, hatchback: HATCH, suv: SUV, taxi: SEDAN };

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export interface CarParts {
  /** Painted body + glass (one mesh, body atlas). */
  body: THREE.BufferGeometry;
  /** Trim, chrome, mirror glass, wipers, rails, exhausts, rear calipers (per-vertex finishes). */
  trim: THREE.BufferGeometry;
  /** Fascia decals (grille, intake, plates, valance, splitter, taxi checker). */
  decals: THREE.BufferGeometry;
  /** Lamp lenses (head, tail, turn, repeaters, third brake light, taxi sign). */
  lamps: THREE.BufferGeometry;
  atlas: BodyAtlas;
  /** Wheel hub positions (x, y, z) — z > 0 = right side; order FR, FL, RR, RL. */
  wheels: [number, number, number][];
  /** Nominal bumper-to-bumper length (m). */
  length: number;
  def: BodyStyle;
  shape: BuiltBody;
}

const partsCache = new Map<CarStyle, CarParts>();

export function carParts(style: CarStyle): CarParts {
  let p = partsCache.get(style);
  if (!p) {
    p = buildParts(style);
    partsCache.set(style, p);
  }
  return p;
}

/** Nominal dimensions per style (m). */
export function carDims(style: CarStyle): { length: number; width: number; height: number; wheelR: number; wheelbase: number } {
  const p = carParts(style);
  const d = p.def;
  let top = 0;
  for (let x = p.shape.xg1; x <= p.shape.xg0; x += 0.05) top = Math.max(top, p.shape.ghTop(x));
  return { length: p.length, width: d.W, height: top, wheelR: d.wheelR, wheelbase: d.axleF - d.axleR };
}

/** Give a non-indexed geometry a trivial index so it can merge with indexed ones. */
function indexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) return g;
  const n = g.attributes.position!.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function keepPNU(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  return indexed(g);
}

function mergeIdx(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts.map(keepPNU), false);
  if (!m) throw new Error('car: merge failed');
  return m;
}

function constUv(g: THREE.BufferGeometry, [u, v]: [number, number]): THREE.BufferGeometry {
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return g;
}

/** Map all UVs of a geometry into an atlas cell (keeps relative UVs). */
function cellUv(g: THREE.BufferGeometry, [u0, v0, u1, v1]: [number, number, number, number]): THREE.BufferGeometry {
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  return g;
}

/** Box whose ±X faces show `faceCell` (u along Z) and other faces a plain `sideCell` texel. */
function signBox(w: number, h: number, d: number, faceCell: [number, number, number, number], sideCell: [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(d, h, w);
  const uv = g.attributes.uv!;
  const nor = g.attributes.normal!;
  const [su, sv] = [(sideCell[0] + sideCell[2]) / 2, (sideCell[1] + sideCell[3]) / 2];
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, faceCell[0] + (faceCell[2] - faceCell[0]) * uv.getX(i), faceCell[1] + (faceCell[3] - faceCell[1]) * uv.getY(i));
    else uv.setXY(i, su, sv);
  }
  return g;
}

function mirrorZ(d: DecalSpec): DecalSpec {
  return { ...d, at: [d.at[0], d.at[1], -d.at[2]], yaw: -d.yaw + (Math.abs(d.yaw) > Math.PI / 2 ? 2 * Math.PI : 0), flipU: !d.flipU };
}

function buildParts(style: CarStyle): CarParts {
  const st = STYLES[style];
  const taxi = style === 'taxi';
  const shape = buildBody(st);
  const S = shape;
  const atlas = bodyAtlas(style, st, shape, taxi);

  // --- mirrors (paint caps), spoiler ---------------------------------------------------------------
  const bodyParts: THREE.BufferGeometry[] = [S.lower, S.greenhouse];
  const mx = S.xg0 - 0.22;
  const my = S.yUp(mx) + 0.085;
  const mz = S.hwPlan(mx) + 0.095;
  // mirror housing: a flattened, tapered shell (wedge toward the door), open face toward the rear
  const cap = new THREE.SphereGeometry(1, 20, 12, Math.PI / 2, Math.PI);
  cap.scale(0.075, 0.058, 0.11);
  {
    const p = cap.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const t = (z + 0.11) / 0.22; // 0 inner .. 1 outer
      p.setY(i, p.getY(i) * (0.8 + 0.25 * t));
      p.setX(i, p.getX(i) * (0.7 + 0.4 * t));
    }
    cap.computeVertexNormals();
  }
  for (const s of [1, -1]) bodyParts.push(constUv(xf(cap, [mx, my, s * mz]), UV_PAINT));
  if (st.base === 'hatchback') {
    const x = st.xRoofRear;
    const y = S.ghTop(x);
    const hw = S.ghHalfWidth(x) - st.tumble - 0.1;
    const sp = new THREE.BoxGeometry(0.15, 0.026, 2 * hw, 2, 1, 4);
    bodyParts.push(constUv(xf(sp, [x - 0.02, y + 0.008, 0], [0, 0, -0.16]), UV_PAINT));
  }
  const body = mergeIdx(bodyParts);

  // --- trim & chrome (per-vertex finishes) --------------------------------------------------------------
  const black: VcFinish = { color: '#111213', roughness: 0.55, metalness: 0.05 };
  const gloss: VcFinish = { color: '#0c0d0e', roughness: 0.2, metalness: 0.1 };
  const chrome: VcFinish = { color: '#d9dee3', roughness: 0.08, metalness: 1 };
  const mirrorGlass: VcFinish = { color: '#9aa4ad', roughness: 0.02, metalness: 1 };
  const trim: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    // mirror glass (rear face) + tapered stalk to the door
    const glass = new THREE.CircleGeometry(1, 24);
    glass.rotateY(-Math.PI / 2);
    glass.scale(1, 0.055, 0.1);
    trim.push(vc(xf(glass, [mx - 0.002, my, s * mz]), mirrorGlass));
    const stalk = new THREE.BoxGeometry(0.07, 0.035, 0.13, 1, 1, 1);
    const p = stalk.attributes.position!;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setXYZ(i, p.getX(i) * 0.6, p.getY(i) * 0.7, p.getZ(i));
    stalk.computeVertexNormals();
    trim.push(vc(xf(stalk, [mx + 0.01, my - 0.045, s * (mz - 0.09)], [0, s > 0 ? 0 : Math.PI, 0]), gloss));
  }
  // wipers resting on the windshield base
  for (const [z0, len, rot] of [
    [-0.62, 0.62, 0.05],
    [0.02, 0.56, 0.08],
  ] as const) {
    const x = S.xg0 - 0.06;
    const w = new THREE.BoxGeometry(0.018, 0.012, len);
    trim.push(vc(xf(w, [x, S.ghTop(x) + 0.012, z0 + len / 2], [0, rot, 0]), black));
  }
  // shark-fin antenna
  {
    const x = st.xRoofRear + 0.12;
    const fin = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    fin.scale(0.09, 0.055, 0.03);
    trim.push(vc(xf(fin, [x, S.ghTop(x) - 0.003, 0]), gloss));
  }
  // roof rails (SUV)
  if (st.base === 'suv') {
    const x0 = st.xRoofRear + 0.25;
    const x1 = st.xWsTop - 0.2;
    const xm = (x0 + x1) / 2;
    for (const s of [1, -1]) {
      const z = s * (S.ghHalfWidth(xm) - st.tumble - 0.1);
      const y = S.ghTop(xm) - 0.005;
      trim.push(vc(xf(new THREE.BoxGeometry(x1 - x0, 0.025, 0.035), [xm, y + 0.05, z]), { color: '#aab0b6', roughness: 0.3, metalness: 0.85 }));
      for (const x of [x0 + 0.05, xm, x1 - 0.05]) trim.push(vc(xf(new THREE.BoxGeometry(0.09, 0.05, 0.045), [x, y + 0.025, z]), black));
    }
  }
  // exhaust tips
  const tips = st.base === 'hatchback' ? [0.45] : [0.52, -0.52];
  for (const z of tips) {
    const t = new THREE.CylinderGeometry(0.038, 0.04, 0.12, 16, 1, true);
    t.rotateZ(Math.PI / 2);
    const x = S.xr + 0.06;
    trim.push(vc(xf(t, [x, S.yLo(x) + 0.06, z]), chrome));
    const inner = new THREE.CircleGeometry(0.034, 16);
    inner.rotateY(-Math.PI / 2);
    trim.push(vc(xf(inner, [x - 0.02, S.yLo(x) + 0.06, z]), black));
  }
  // rear brake calipers (static in the body frame)
  for (const [x, y, z] of wheelPositions(st, S).slice(2)) {
    const g = caliperGeometry(z > 0);
    trim.push(vc(xf(g, [x, y, z], [0, 0, 0], [st.wheelR, st.wheelR, st.wheelR]), CALIPER));
  }
  const trimG = mergeVc(trim);

  // --- fascia decals --------------------------------------------------------------------------------
  const decalParts: THREE.BufferGeometry[] = [];
  for (const d of [st.grille, st.intake, st.plateF, st.plateR, st.valance, st.splitter]) decalParts.push(S.decal(d));
  if (taxi) {
    for (const s of [1, -1]) {
      const d: DecalSpec = { at: [-0.05, S.yUp(0) - 0.3, s * 0.9], yaw: s * (Math.PI / 2), size: [3.2, 0.09], cell: cell(DECAL_CELLS.checker), offset: 0.003, grid: [48, 2] };
      decalParts.push(S.decal(d));
    }
  }
  const decals = mergeIdx(decalParts);

  // --- lamps ----------------------------------------------------------------------------------------
  const lampParts: THREE.BufferGeometry[] = [S.decal(st.head), S.decal(mirrorZ(st.head)), S.decal(st.tail), S.decal(mirrorZ(st.tail))];
  // mirror turn repeaters (on the cap's lower front edge)
  for (const s of [1, -1]) {
    const r = new THREE.BoxGeometry(0.03, 0.012, 0.08);
    lampParts.push(cellUv(xf(r, [mx + 0.07, my - 0.04, s * (mz + 0.03)], [0, 0, -0.3]), LAMP_CELLS.repeater));
  }
  // third brake light at the top of the rear glass / spoiler
  {
    const x = st.xRoofRear - (st.base === 'sedan' ? 0.04 : 0.02);
    const y = S.ghTop(x) + (st.base === 'sedan' ? 0.004 : 0.03);
    lampParts.push(signBox(0.34, 0.022, 0.035, cell(LAMP_CELLS.brake3), cell(LAMP_CELLS.brake3)).translate(x, y, 0));
  }
  if (taxi) {
    const x = (st.xWsTop + st.xRoofRear) / 2 + 0.15;
    const y = S.ghTop(x) + 0.075;
    // sign housing sides use a plain yellow texel of the TAXI cell (they light up with the sign)
    lampParts.push(signBox(0.6, 0.15, 0.2, cell(LAMP_CELLS.taxi), [0.005, 0.3, 0.02, 0.45]).translate(x, y, 0));
  }
  const lamps = mergeIdx(lampParts);

  return {
    body,
    trim: trimG,
    decals,
    lamps,
    atlas,
    wheels: wheelPositions(st, S),
    length: S.xf - S.xr,
    def: st,
    shape: S,
  };
}

function wheelPositions(st: BodyStyle, S: BuiltBody): [number, number, number][] {
  const z = S.zWheel;
  return [
    [st.axleF, st.wheelR, z],
    [st.axleF, st.wheelR, -z],
    [st.axleR, st.wheelR, z],
    [st.axleR, st.wheelR, -z],
  ];
}

// ---------------------------------------------------------------------------
// Wheels (unit radius = tire radius; outer face toward +Z)
// ---------------------------------------------------------------------------

const RUBBER: VcFinish = { color: '#161616', roughness: 0.88, metalness: 0 };
/** Silver-painted alloy (metallic paint rather than a mirror, so it reads bright in any light). */
const SPOKE: VcFinish = { color: '#d2d6da', roughness: 0.32, metalness: 0.5 };
const BARREL: VcFinish = { color: '#1a1a1a', roughness: 0.6, metalness: 0.3 };
const DISC: VcFinish = { color: '#7a7d80', roughness: 0.42, metalness: 0.85 };
const CALIPER: VcFinish = { color: '#34373a', roughness: 0.45, metalness: 0.6 };

/** Surface of revolution about +Z; profile points [r, z] listed from the outer (+Z) face inward. */
function lathe(profile: [number, number][], seg = 40): THREE.BufferGeometry {
  // LatheGeometry faces outward for points ordered bottom→top in its own frame; after rotateX(+90°)
  // that is −Z→+Z, so reverse our (+Z first) profiles to get outward-facing surfaces.
  const g = new THREE.LatheGeometry(
    [...profile].reverse().map(([r, z]) => new THREE.Vector2(r, z)),
    seg,
  );
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function flipInside(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const pos = n.attributes.position!;
  const nor = n.attributes.normal!;
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, nor, n.attributes.uv!]) {
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.getComponent(i + 1, k);
        a.setComponent(i + 1, k, a.getComponent(i + 2, k));
        a.setComponent(i + 2, k, t);
      }
    }
  }
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  return n;
}

const TIRE_PROFILE: [number, number][] = [
  [0.69, 0.3],
  [0.8, 0.325],
  [0.92, 0.33],
  [0.975, 0.3],
  [0.997, 0.24],
  [1.0, 0.16],
  [0.985, 0.15],
  [0.985, 0.11],
  [1.0, 0.1],
  [1.0, 0.03],
  [0.985, 0.02],
  [0.985, -0.02],
  [1.0, -0.03],
  [1.0, -0.1],
  [0.985, -0.11],
  [0.985, -0.15],
  [1.0, -0.16],
  [0.997, -0.24],
  [0.975, -0.3],
  [0.92, -0.33],
  [0.8, -0.325],
  [0.69, -0.3],
];

let tireGeo: THREE.BufferGeometry | null = null;
let rimGeo: THREE.BufferGeometry | null = null;
let wheelGeo: THREE.BufferGeometry | null = null;

/** Tire of radius 1 (width 0.66) with tread grooves, axis +Z. */
export function unitTire(): THREE.BufferGeometry {
  if (!tireGeo) tireGeo = vc(lathe(TIRE_PROFILE, 40), RUBBER);
  return tireGeo;
}

/** 10-spoke (5 split spokes) concave alloy: lip, dark barrel & back, hub, lug nuts, brake disc. */
export function unitRim(): THREE.BufferGeometry {
  if (rimGeo) return rimGeo;
  const parts: THREE.BufferGeometry[] = [];
  // outer lip
  parts.push(
    vc(
      lathe([
        [0.575, 0.282],
        [0.6, 0.296],
        [0.685, 0.3],
        [0.708, 0.288],
        [0.712, 0.26],
      ]),
      SPOKE,
    ),
  );
  // barrel (seen from inside through the spokes) and dark back
  const barrel = new THREE.CylinderGeometry(0.665, 0.665, 0.5, 32, 1, true);
  barrel.rotateX(Math.PI / 2);
  barrel.translate(0, 0, 0.025);
  parts.push(vc(flipInside(barrel), BARREL));
  const back = new THREE.CircleGeometry(0.665, 32);
  back.translate(0, 0, -0.2);
  parts.push(vc(back, BARREL));
  // brake disc (rotates with the wheel) + hat
  parts.push(
    vc(
      lathe([
        [0.23, 0.02],
        [0.55, 0.02],
        [0.55, -0.05],
        [0.23, -0.05],
        [0.23, 0.02],
      ]),
      DISC,
    ),
  );
  const hat = new THREE.CylinderGeometry(0.22, 0.22, 0.09, 24);
  hat.rotateX(Math.PI / 2);
  hat.translate(0, 0, 0.02);
  parts.push(vc(hat, { color: '#4a4d50', roughness: 0.5, metalness: 0.7 }));
  // spokes: 5 pairs, concave (hub deeper than the lip), tapered
  for (let i = 0; i < 5; i++) {
    for (const off of [-0.11, 0.11]) {
      const a = (i / 5) * Math.PI * 2 + off;
      // runs from the hub (r 0.17) into the lip (r 0.61) so spokes merge with the rim flange
      const g = new THREE.BoxGeometry(0.44, 0.085, 0.06, 4, 1, 1);
      const p = g.attributes.position!;
      for (let k = 0; k < p.count; k++) {
        const t = (p.getX(k) + 0.22) / 0.44; // 0 hub .. 1 rim
        p.setY(k, p.getY(k) * (1 - 0.35 * t) + (off > 0 ? -1 : 1) * 0.02 * (1 - t));
        p.setZ(k, p.getZ(k) + 0.135 + 0.135 * t);
      }
      g.translate(0.17 + 0.22, 0, 0);
      g.computeVertexNormals();
      g.rotateZ(a);
      parts.push(vc(g, SPOKE));
    }
  }
  // hub face, center cap, lug nuts
  const hub = new THREE.CylinderGeometry(0.19, 0.205, 0.05, 30);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, 0.13);
  parts.push(vc(hub, SPOKE));
  const capG = new THREE.CylinderGeometry(0.075, 0.08, 0.025, 24);
  capG.rotateX(Math.PI / 2);
  capG.translate(0, 0, 0.162);
  parts.push(vc(capG, { color: '#2a2d30', roughness: 0.35, metalness: 0.5 }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
    const nut = new THREE.CylinderGeometry(0.026, 0.026, 0.04, 6);
    nut.rotateX(Math.PI / 2);
    nut.translate(Math.cos(a) * 0.125, Math.sin(a) * 0.125, 0.16);
    parts.push(vc(nut, { color: '#e2e6ea', roughness: 0.12, metalness: 1 }));
  }
  rimGeo = mergeVc(parts);
  return rimGeo;
}

/** Complete wheel (tire + rim + disc) in one geometry for one draw call. */
export function unitWheel(): THREE.BufferGeometry {
  if (!wheelGeo) wheelGeo = mergeVc([unitTire(), unitRim()]);
  return wheelGeo;
}

const caliperCache: Record<string, THREE.BufferGeometry> = {};
/** Brake caliper (unit scale) at the rear-upper side of the disc; `right` = outer face +Z. */
function caliperGeometry(right: boolean): THREE.BufferGeometry {
  const key = right ? 'r' : 'l';
  if (caliperCache[key]) return caliperCache[key]!;
  const a0 = THREE.MathUtils.degToRad(122);
  const a1 = THREE.MathUtils.degToRad(172);
  const s = new THREE.Shape();
  s.absarc(0, 0, 0.6, a0, a1, false);
  s.absarc(0, 0, 0.4, a1, a0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.08);
  if (!right) {
    g.scale(1, 1, -1);
    const f = flipInside(g);
    f.computeVertexNormals();
    caliperCache[key] = f;
  } else caliperCache[key] = g;
  return caliperCache[key]!;
}

/** Caliper geometry with per-vertex finish (for instancing / <Car/>). */
const caliperVc: Record<string, THREE.BufferGeometry> = {};
function caliperMesh(right: boolean): THREE.BufferGeometry {
  const k = right ? 'r' : 'l';
  return (caliperVc[k] ??= vc(caliperGeometry(right), CALIPER));
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function paintShader(s: { fragmentShader: string }): void {
  s.fragmentShader = s.fragmentShader.replace(
    '#include <color_fragment>',
    `#include <color_fragment>
	#if defined( USE_ROUGHNESSMAP ) && defined( USE_MAP )
		// props.b = paint mask: glass / trim / chrome keep their albedo (no paint tint)
		vec4 carProps = texture2D( roughnessMap, vRoughnessMapUv );
		diffuseColor.rgb = mix( sampledDiffuseColor.rgb, diffuseColor.rgb, carProps.b );
	#endif`,
  );
}

function makePaint(style: CarStyle, color: string, metallic: boolean): THREE.MeshPhysicalMaterial {
  const { atlas } = carParts(style);
  const m = new THREE.MeshPhysicalMaterial({
    color,
    map: atlas.color,
    roughnessMap: atlas.props,
    metalnessMap: atlas.props,
    clearcoatMap: atlas.props,
    roughness: 1,
    metalness: metallic ? 0.6 : 0.03,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  m.onBeforeCompile = paintShader;
  m.customProgramCacheKey = () => 'car-paint';
  return m;
}

/** Clear-coated paint (+ glass / trim regions from the body atlas) for one style & color. Shared. */
export function carPaintMaterial(style: CarStyle, color: string, metallic: boolean): THREE.MeshPhysicalMaterial {
  return sharedMat(`car:paint2:${style}:${color}:${metallic}`, () => makePaint(style, color, metallic));
}

function decalMat(): THREE.MeshPhysicalMaterial {
  return sharedMat(
    'car:decalMat',
    () =>
      new THREE.MeshPhysicalMaterial({
        map: decalAtlas(),
        alphaTest: 0.5,
        roughness: 0.38,
        metalness: 0.15,
        clearcoat: 0.6,
        clearcoatRoughness: 0.1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      }),
  );
}

/**
 * Lamp lens material. Emission levels come from `uLamp` (head, tail, turn) or, on an InstancedMesh,
 * from instanceColor (same channels). The function-ID map picks which level lights each texel.
 */
function makeLampMaterial(): THREE.MeshPhysicalMaterial & { userData: { uLamp: { value: THREE.Vector3 } } } {
  const atlas = lampAtlas();
  const m = new THREE.MeshPhysicalMaterial({
    map: atlas.base,
    emissive: '#ffffff',
    emissiveMap: atlas.emit,
    alphaTest: 0.5,
    roughness: 0.12,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const uLamp = { value: new THREE.Vector3() };
  const uDrl = { value: LAMP.drl };
  const lampId = { value: atlas.id };
  m.onBeforeCompile = (s) => {
    s.uniforms.uLamp = uLamp;
    s.uniforms.uDrl = uDrl;
    s.uniforms.lampId = lampId;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLamp;\nuniform float uDrl;\nuniform sampler2D lampId;')
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
	{
		#if defined( USE_INSTANCING_COLOR )
			vec3 lv = vColor.rgb;
		#else
			vec3 lv = uLamp;
		#endif
		float fid = texture2D( lampId, vEmissiveMapUv ).r;
		float lvl = 0.0;
		if ( fid > 0.1 && fid < 0.3 ) lvl = max( uDrl, lv.x > 0.5 ? 2.5 : 0.0 );
		else if ( fid >= 0.3 && fid < 0.5 ) lvl = lv.x;
		else if ( fid >= 0.5 && fid < 0.7 ) lvl = lv.z;
		else if ( fid >= 0.7 && fid < 0.9 ) lvl = lv.y;
		else if ( fid >= 0.9 ) lvl = lv.y > 1.0 ? lv.y : 0.0;
		totalEmissiveRadiance *= lvl;
	}`,
      );
  };
  m.customProgramCacheKey = () => 'car-lamp';
  m.userData.uLamp = uLamp;
  return m as THREE.MeshPhysicalMaterial & { userData: { uLamp: { value: THREE.Vector3 } } };
}

/** Emission levels (HDR multipliers; bloom threshold ≈ 1). DRL stays below the bloom threshold. */
const LAMP = {
  drl: 0.7,
  head: 5,
  tail: 0.45,
  brake: 5,
  turn: 5,
} as const;

// ---------------------------------------------------------------------------
// <Car/>
// ---------------------------------------------------------------------------

export type Blinker = 'left' | 'right' | 'hazard' | null;

export interface CarProps extends Placement {
  /** Scene variant 0..7 → style & color (see carVariant). Overridden by `style` / `color`. */
  variant?: number;
  style?: CarStyle;
  /** Named paint or any CSS color. */
  color?: CarColorName | string;
  /** Overall length (m); the body stretches, the wheels keep their size. */
  length?: number;
  /** Distance driven (m, signed) — spins the wheels. */
  getDistance?: () => number;
  /** Front-wheel steering angle (rad, + = left). */
  getSteer?: () => number;
  getBraking?: () => boolean;
  getHeadlights?: () => boolean;
  getBlinker?: () => Blinker;
  /** Click handler (pointer cursor + ground highlight on hover). */
  onClick?: () => void;
}

function resolvePaint(color: string): { hex: string; metallic: boolean } {
  return color in CAR_PAINT ? CAR_PAINT[color as CarColorName] : { hex: color, metallic: false };
}

/** Linear paint colors per named paint (no per-frame string parsing). */
const PAINT_COLOR: Record<string, THREE.Color> = Object.fromEntries(Object.entries(CAR_PAINT).map(([k, v]) => [k, new THREE.Color(v.hex)]));

function blinkOn(b: Blinker, side: 'left' | 'right', t: number): boolean {
  if (!b) return false;
  if (t % 0.8 >= 0.4) return false;
  return b === 'hazard' || b === side;
}

export function Car({ variant = 0, style, color, length, getDistance, getSteer, getBraking, getHeadlights, getBlinker, onClick, position, rotation, scale }: CarProps) {
  const v = carVariant(variant);
  const st = style ?? v.style;
  const paint = resolvePaint(color ?? v.color);
  const parts = carParts(st);
  const d = parts.def;
  const sx = length ? length / parts.length : 1;
  const lampMat = useMemo(() => makeLampMaterial(), []);
  useDisposable(useMemo(() => [lampMat], [lampMat]));
  const spins = useRef<(THREE.Group | null)[]>([]);
  const steers = useRef<(THREE.Group | null)[]>([]);
  const g = useRef({ getDistance, getSteer, getBraking, getHeadlights, getBlinker });
  g.current = { getDistance, getSteer, getBraking, getHeadlights, getBlinker };
  const { hovered, handlers } = useClickable(onClick);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const dist = g.current.getDistance?.() ?? 0;
    const ang = dist / d.wheelR;
    for (let i = 0; i < 4; i++) {
      const s = spins.current[i];
      if (s) s.rotation.z = parts.wheels[i]![2] > 0 ? -ang : ang;
    }
    const steer = g.current.getSteer?.() ?? 0;
    for (let i = 0; i < 2; i++) {
      const s = steers.current[i];
      if (s) s.rotation.y = steer;
    }
    const hl = g.current.getHeadlights?.() ?? false;
    const br = g.current.getBraking?.() ?? false;
    const bl = g.current.getBlinker?.() ?? null;
    const turn = blinkOn(bl, 'left', t) || blinkOn(bl, 'right', t);
    lampMat.userData.uLamp.value.set(hl ? LAMP.head : 0, br ? LAMP.brake : hl ? LAMP.tail : 0, turn ? LAMP.turn : 0);
  });
  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      <group scale={[sx, 1, 1]}>
        <mesh geometry={parts.body} material={carPaintMaterial(st, paint.hex, paint.metallic)} castShadow receiveShadow />
        <mesh geometry={parts.trim} material={vcMaterial()} castShadow />
        <mesh geometry={parts.decals} material={decalMat()} />
        <mesh geometry={parts.lamps} material={lampMat} />
        {hovered && (
          <mesh geometry={cylY(1, 1, 0.002, 40)} scale={[parts.length / 2 + 0.35, 1, d.W / 2 + 0.35]} position={[0, 0.01, 0]} material={hoverMat()} />
        )}
      </group>
      {parts.wheels.map(([x, y, z], i) => (
        <group key={i} position={[x * sx, y, z]} ref={(el) => void (i < 2 ? (steers.current[i] = el) : undefined)}>
          <group rotation={[0, z < 0 ? Math.PI : 0, 0]}>
            <group ref={(el) => void (spins.current[i] = el)} scale={d.wheelR}>
              <mesh geometry={unitWheel()} material={vcMaterial()} castShadow />
            </group>
          </group>
          {i < 2 && <mesh geometry={caliperMesh(z > 0)} material={vcMaterial()} scale={d.wheelR} />}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// <CarFleet/> — instanced
// ---------------------------------------------------------------------------

/** Per-car state filled by `CarFleet.getCar`. */
export interface CarInstance {
  x: number;
  y: number;
  z: number;
  /** Rotation about +Y (rad); 0 = facing +X. */
  yaw: number;
  /** Scene variant (style & color). */
  variant: number;
  /** Optional explicit length (m). */
  length: number;
  distance: number;
  steer: number;
  braking: boolean;
  headlights: boolean;
  blinker: Blinker;
  /** Extra roll / pitch (rad) e.g. for crash effects. */
  roll: number;
  pitch: number;
}

export interface CarFleetProps {
  /** Maximum number of cars. */
  capacity: number;
  /**
   * Fill `out` for car slot i (fields are reset to defaults first) and return true, or return false
   * when slot i is empty. Called every frame for i = 0 … capacity − 1 (stop early by returning false
   * for all remaining slots). Must not allocate.
   */
  getCar: (i: number, out: CarInstance) => boolean;
  castShadow?: boolean;
}

const FLEET_STYLES: CarStyle[] = ['sedan', 'hatchback', 'suv', 'taxi'];
type FleetPart = 'bodySolid' | 'bodyMetal' | 'trim' | 'decals' | 'lamps';
const FLEET_PARTS: FleetPart[] = ['bodySolid', 'bodyMetal', 'trim', 'decals', 'lamps'];

function fleetMaterial(style: CarStyle, key: FleetPart): THREE.Material {
  switch (key) {
    case 'bodySolid':
      return sharedMat(`car:fleetPaint:${style}:solid`, () => makePaint(style, '#ffffff', false));
    case 'bodyMetal':
      return sharedMat(`car:fleetPaint:${style}:metal`, () => makePaint(style, '#ffffff', true));
    case 'trim':
      return vcMaterial();
    case 'decals':
      return decalMat();
    default:
      return sharedMat('car:fleetLamp', () => makeLampMaterial());
  }
}

function fleetGeometry(style: CarStyle, key: FleetPart): THREE.BufferGeometry {
  const p = carParts(style);
  return key === 'bodySolid' || key === 'bodyMetal' ? p.body : p[key];
}

function newInstance(): CarInstance {
  return { x: 0, y: 0, z: 0, yaw: 0, variant: 0, length: 0, distance: 0, steer: 0, braking: false, headlights: false, blinker: null, roll: 0, pitch: 0 };
}

const DEFAULT_INSTANCE: CarInstance = newInstance();

export function CarFleet({ capacity, getCar, castShadow = true }: CarFleetProps) {
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const wheels = useRef<THREE.InstancedMesh>(null);
  const calR = useRef<THREE.InstancedMesh>(null);
  const calL = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(
    () => ({
      inst: newInstance(),
      m: new THREE.Matrix4(),
      body: new THREE.Matrix4(),
      w: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(0, 0, 0, 'YXZ'),
      p: new THREE.Vector3(),
      s: new THREE.Vector3(),
      c: new THREE.Color(),
      counts: {} as Record<string, number>,
    }),
    [],
  );
  const getter = useRef(getCar);
  getter.current = getCar;

  useLayoutEffect(() => {
    for (const mesh of Object.values(meshes.current)) {
      if (!mesh) continue;
      mesh.count = 0;
    }
    for (const r of [wheels.current, calR.current, calL.current]) if (r) r.count = 0;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const counts = tmp.counts;
    for (const s of FLEET_STYLES) for (const k of FLEET_PARTS) counts[`${s}:${k}`] = 0;
    let wheelN = 0;
    let calN = 0;
    const inst = tmp.inst;
    for (let i = 0; i < capacity; i++) {
      Object.assign(inst, DEFAULT_INSTANCE);
      if (!getter.current(i, inst)) continue;
      const v = carVariant(inst.variant);
      const parts = carParts(v.style);
      const d = parts.def;
      const sx = inst.length > 0 ? inst.length / parts.length : 1;
      tmp.e.set(inst.pitch, inst.yaw, inst.roll, 'YXZ');
      tmp.q.setFromEuler(tmp.e);
      tmp.p.set(inst.x, inst.y, inst.z);
      tmp.s.set(sx, 1, 1);
      tmp.body.compose(tmp.p, tmp.q, tmp.s);
      const paint = CAR_PAINT[v.color];
      const bodyKey: FleetPart = paint.metallic ? 'bodyMetal' : 'bodySolid';
      const turn = blinkOn(inst.blinker, 'left', t) || blinkOn(inst.blinker, 'right', t);
      for (const key of FLEET_PARTS) {
        if ((key === 'bodySolid' || key === 'bodyMetal') && key !== bodyKey) continue;
        const id = `${v.style}:${key}`;
        const mesh = meshes.current[id];
        if (!mesh) continue;
        const k = counts[id]!;
        counts[id] = k + 1;
        mesh.setMatrixAt(k, tmp.body);
        if (key === bodyKey) mesh.setColorAt(k, PAINT_COLOR[v.color]!);
        else if (key === 'lamps') {
          tmp.c.setRGB(inst.headlights ? LAMP.head : 0, inst.braking ? LAMP.brake : inst.headlights ? LAMP.tail : 0, turn ? LAMP.turn : 0, THREE.LinearSRGBColorSpace);
          mesh.setColorAt(k, tmp.c);
        }
      }
      // wheels & front calipers (body frame without the length stretch)
      tmp.s.set(1, 1, 1);
      tmp.body.compose(tmp.p, tmp.q, tmp.s);
      const ang = inst.distance / d.wheelR;
      for (let w = 0; w < 4; w++) {
        const [wx, wy, wz] = parts.wheels[w]!;
        const right = wz > 0;
        const steer = w < 2 ? inst.steer : 0;
        tmp.e.set(0, steer + (right ? 0 : Math.PI), right ? -ang : ang, 'YXZ');
        tmp.q.setFromEuler(tmp.e);
        tmp.p.set(wx * sx, wy, wz);
        tmp.s.setScalar(d.wheelR);
        tmp.w.compose(tmp.p, tmp.q, tmp.s);
        tmp.m.multiplyMatrices(tmp.body, tmp.w);
        wheels.current?.setMatrixAt(wheelN++, tmp.m);
        if (w < 2) {
          tmp.e.set(0, steer, 0, 'YXZ');
          tmp.q.setFromEuler(tmp.e);
          tmp.w.compose(tmp.p, tmp.q, tmp.s);
          tmp.m.multiplyMatrices(tmp.body, tmp.w);
          (right ? calR : calL).current?.setMatrixAt(calN, tmp.m);
          if (!right) calN++;
        }
      }
      tmp.p.set(inst.x, inst.y, inst.z);
    }
    for (const s of FLEET_STYLES) {
      for (const key of FLEET_PARTS) {
        const id = `${s}:${key}`;
        const mesh = meshes.current[id];
        if (!mesh) continue;
        mesh.count = counts[id]!;
        mesh.visible = mesh.count > 0; // no empty draw calls (incl. shadow passes)
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    if (wheels.current) {
      wheels.current.count = wheelN;
      wheels.current.visible = wheelN > 0;
      wheels.current.instanceMatrix.needsUpdate = true;
    }
    for (const r of [calR.current, calL.current]) {
      if (!r) continue;
      r.count = calN;
      r.visible = calN > 0;
      r.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {FLEET_STYLES.map((s) =>
        FLEET_PARTS.map((key) => (
          <instancedMesh
            key={`${s}:${key}`}
            ref={(el) => {
              meshes.current[`${s}:${key}`] = el;
              if (el && !el.instanceColor && (key === 'bodySolid' || key === 'bodyMetal' || key === 'lamps')) el.setColorAt(0, new THREE.Color(1, 1, 1));
            }}
            args={[fleetGeometry(s, key), fleetMaterial(s, key), capacity]}
            castShadow={castShadow && key !== 'decals' && key !== 'lamps'}
            receiveShadow={key === 'bodySolid' || key === 'bodyMetal'}
            frustumCulled={false}
          />
        )),
      )}
      <instancedMesh ref={wheels} args={[unitWheel(), vcMaterial(), capacity * 4]} castShadow={castShadow} frustumCulled={false} />
      <instancedMesh ref={calR} args={[caliperMesh(true), vcMaterial(), capacity]} frustumCulled={false} />
      <instancedMesh ref={calL} args={[caliperMesh(false), vcMaterial(), capacity]} frustumCulled={false} />
    </group>
  );
}

/** Soft blob shadow under a car (cheap alternative to shadow maps for far cars). */
export function carShadowGeometry() {
  return cylY(1, 1, 0.001, 24);
}

/** Finish helpers re-exported for scenes that add props to cars. */
export const CAR_FINISH = { rubber: RUBBER, spoke: SPOKE, chrome: FINISH.stainless } as const;
