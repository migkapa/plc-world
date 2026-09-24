/**
 * Stylized mid-poly passenger cars (sedan, hatchback, SUV, taxi) for the traffic & parking scenes.
 *
 * Construction: side-profile silhouettes (with real wheel-arch cut-outs) extruded across the car
 * width with rounded bevels, then shaped per vertex (plan-view nose/tail taper, cabin tumblehome,
 * tucked rocker). The greenhouse is a glass extrusion framed by body-colored pillars/roof skin with
 * window openings; door cut lines, handles, rocker trim and fuel door are a grayscale side texture
 * multiplied by the (clear-coated) paint. Lamps are unlit HDR materials (brake lights bloom).
 *
 * Conventions (match the scene logics' pose helpers): the car FRONT faces +X, Y up, origin = car
 * center on the ground (x = 0 halfway between the bumpers). Right side = +Z.
 *
 *  - <Car/>       one car (≈16 draw calls; geometry & materials shared per style/color).
 *  - <CarFleet/>  many cars in ≈30 draw calls total (InstancedMesh per style/part, per-instance paint
 *                 color, wheel spin, brake/head/turn lamps). Use this for traffic.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTex, cylY, makeCanvas, mergeAll, roundedBox, sharedMat, sharedTex, tmats, useDisposable, xf } from './shared';

// ---------------------------------------------------------------------------
// Styles & variants
// ---------------------------------------------------------------------------

export type CarStyle = 'sedan' | 'hatchback' | 'suv' | 'taxi';
export type CarColorName = 'white' | 'silver' | 'black' | 'red' | 'blue' | 'gray' | 'yellow' | 'green' | 'orange' | 'teal' | 'beige';

export const CAR_PAINT: Record<CarColorName, { hex: string; metallic: boolean }> = {
  white: { hex: '#e8eaeb', metallic: false },
  silver: { hex: '#a9afb5', metallic: true },
  black: { hex: '#141619', metallic: true },
  red: { hex: '#a8101a', metallic: false },
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

interface StyleDef {
  /** Geometry style (taxi = sedan body). */
  base: 'sedan' | 'hatchback' | 'suv';
  width: number;
  cabinWidth: number;
  wheelR: number;
  archR: number;
  axleF: number;
  axleR: number;
  tireW: number;
  bottomY: number;
  bottomStart: [number, number];
  front: [number, number][];
  top: [number, number][];
  rear: [number, number][];
  cabin: [number, number][];
  roof: [number, number][];
  windows: [number, number][][];
  beltY: number;
  roofY: number;
  tumble: number;
  /** Door cut lines (x) and handle positions. */
  seams: number[];
  handles: number[];
  handleY: number;
  lampY: { head: number; tail: number; plateF: number; plateR: number };
  frontX: number;
  rearX: number;
}

const SEDAN: StyleDef = {
  base: 'sedan',
  width: 1.8,
  cabinWidth: 1.6,
  wheelR: 0.32,
  archR: 0.378,
  axleF: 1.36,
  axleR: -1.34,
  tireW: 0.215,
  bottomY: 0.25,
  bottomStart: [-2.05, 0.25],
  front: [
    [1.95, 0.25],
    [2.17, 0.29],
    [2.25, 0.42],
    [2.24, 0.6],
    [2.15, 0.7],
    [1.6, 0.8],
    [1.0, 0.875],
  ],
  top: [
    [0.92, 0.885],
    [-1.3, 0.925],
    [-1.62, 0.955],
    [-2.12, 0.955],
  ],
  rear: [
    [-2.23, 0.88],
    [-2.26, 0.62],
    [-2.23, 0.36],
    [-2.12, 0.27],
  ],
  cabin: [
    [1.04, 0.86],
    [0.12, 1.38],
    [-0.4, 1.42],
    [-0.98, 1.38],
    [-1.74, 0.94],
    [-1.72, 0.86],
  ],
  roof: [
    [0.12, 1.38],
    [-0.4, 1.42],
    [-0.98, 1.38],
  ],
  windows: [
    [
      [0.76, 1.0],
      [0.16, 1.335],
      [-0.27, 1.36],
      [-0.27, 1.0],
    ],
    [
      [-0.36, 1.0],
      [-0.36, 1.36],
      [-0.93, 1.335],
      [-1.44, 1.03],
      [-1.44, 1.0],
    ],
  ],
  beltY: 0.95,
  roofY: 1.42,
  tumble: 0.2,
  seams: [0.93, -0.31, -1.02],
  handles: [-0.22, -0.93],
  handleY: 0.84,
  lampY: { head: 0.64, tail: 0.83, plateF: 0.4, plateR: 0.55 },
  frontX: 2.25,
  rearX: -2.26,
};

const HATCH: StyleDef = {
  base: 'hatchback',
  width: 1.76,
  cabinWidth: 1.58,
  wheelR: 0.31,
  archR: 0.366,
  axleF: 1.25,
  axleR: -1.27,
  tireW: 0.205,
  bottomY: 0.24,
  bottomStart: [-1.8, 0.24],
  front: [
    [1.72, 0.24],
    [1.93, 0.28],
    [2.0, 0.42],
    [1.99, 0.6],
    [1.9, 0.71],
    [1.4, 0.81],
    [0.95, 0.88],
  ],
  top: [
    [0.9, 0.89],
    [-1.72, 0.95],
  ],
  rear: [
    [-1.98, 0.92],
    [-2.0, 0.6],
    [-1.97, 0.36],
    [-1.86, 0.26],
  ],
  cabin: [
    [0.98, 0.86],
    [0.08, 1.42],
    [-0.6, 1.455],
    [-1.3, 1.45],
    [-1.74, 1.39],
    [-1.94, 0.98],
    [-1.9, 0.86],
  ],
  roof: [
    [0.08, 1.42],
    [-0.6, 1.455],
    [-1.3, 1.45],
    [-1.74, 1.39],
  ],
  windows: [
    [
      [0.72, 1.0],
      [0.13, 1.37],
      [-0.3, 1.395],
      [-0.3, 1.0],
    ],
    [
      [-0.38, 1.0],
      [-0.38, 1.395],
      [-1.15, 1.39],
      [-1.38, 1.24],
      [-1.38, 1.0],
    ],
  ],
  beltY: 0.95,
  roofY: 1.455,
  tumble: 0.18,
  seams: [0.86, -0.34, -1.0],
  handles: [-0.25, -0.92],
  handleY: 0.85,
  lampY: { head: 0.65, tail: 0.84, plateF: 0.4, plateR: 0.58 },
  frontX: 2.0,
  rearX: -2.0,
};

const SUV: StyleDef = {
  base: 'suv',
  width: 1.88,
  cabinWidth: 1.7,
  wheelR: 0.37,
  archR: 0.435,
  axleF: 1.42,
  axleR: -1.4,
  tireW: 0.235,
  bottomY: 0.33,
  bottomStart: [-2.05, 0.33],
  front: [
    [2.05, 0.33],
    [2.26, 0.38],
    [2.31, 0.55],
    [2.3, 0.86],
    [2.2, 0.98],
    [1.6, 1.03],
    [1.05, 1.08],
  ],
  top: [
    [1.0, 1.09],
    [-2.0, 1.12],
  ],
  rear: [
    [-2.26, 1.1],
    [-2.3, 0.75],
    [-2.28, 0.45],
    [-2.15, 0.35],
  ],
  cabin: [
    [1.1, 1.04],
    [0.26, 1.66],
    [-1.0, 1.7],
    [-2.05, 1.68],
    [-2.22, 1.56],
    [-2.27, 1.12],
    [-2.24, 1.04],
  ],
  roof: [
    [0.26, 1.66],
    [-1.0, 1.7],
    [-2.05, 1.68],
  ],
  windows: [
    [
      [0.86, 1.17],
      [0.32, 1.6],
      [-0.32, 1.625],
      [-0.32, 1.17],
    ],
    [
      [-0.4, 1.17],
      [-0.4, 1.625],
      [-1.28, 1.635],
      [-1.28, 1.17],
    ],
    [
      [-1.36, 1.17],
      [-1.36, 1.635],
      [-1.98, 1.625],
      [-2.1, 1.53],
      [-2.1, 1.17],
    ],
  ],
  beltY: 1.12,
  roofY: 1.7,
  tumble: 0.14,
  seams: [1.0, -0.36, -1.32],
  handles: [-0.26, -1.2],
  handleY: 1.0,
  lampY: { head: 0.86, tail: 1.0, plateF: 0.5, plateR: 0.7 },
  frontX: 2.31,
  rearX: -2.3,
};

const STYLES: Record<CarStyle, StyleDef> = { sedan: SEDAN, hatchback: HATCH, suv: SUV, taxi: { ...SEDAN } };

/** Nominal dimensions per style (m). */
export function carDims(style: CarStyle): { length: number; width: number; height: number; wheelR: number; wheelbase: number } {
  const d = STYLES[style];
  return { length: d.frontX - d.rearX + 0.1, width: d.width, height: d.roofY + 0.03, wheelR: d.wheelR, wheelbase: d.axleF - d.axleR };
}

// ---------------------------------------------------------------------------
// Geometry building
// ---------------------------------------------------------------------------

const TEX_X0 = -2.5;
const TEX_X1 = 2.5;
const TEX_Y0 = 0;
const TEX_Y1 = 2.0;
/** UV of a plain white texel (top-left corner area of the side texture). */
const PLAIN_UV: [number, number] = [0.02, 0.98];

function lowerShape(d: StyleDef): THREE.Shape {
  const pts: [number, number][] = [d.bottomStart];
  for (const ax of [d.axleR, d.axleF]) {
    // the bevel grows the silhouette by BODY_BEVEL, so cut the arch that much larger
    const R = d.archR + BODY_BEVEL;
    const a0 = Math.asin(THREE.MathUtils.clamp((d.bottomY - d.wheelR) / R, -1, 1));
    const start = Math.PI - a0;
    const end = a0;
    const n = 20;
    for (let i = 0; i <= n; i++) {
      const a = start + ((end - start) * i) / n;
      pts.push([ax + R * Math.cos(a), d.wheelR + R * Math.sin(a)]);
    }
  }
  pts.push(...d.front, ...d.top, ...d.rear);
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

function polyShape(pts: [number, number][]): THREE.Shape {
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

function polyHole(pts: [number, number][]): THREE.Path {
  return new THREE.Path(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

/** Extrude a side-profile shape symmetrically across Z (total width incl. bevel). */
function extrudeAcross(shape: THREE.Shape, width: number, bevel: number, bevelSize = bevel, segs = 3): THREE.ExtrudeGeometry {
  const depth = Math.max(0.001, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize,
    bevelSegments: segs,
    curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Map extrude caps (group 0) to the side texture frame, walls to a plain texel. */
function sideUvs(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  const capGroup = g.groups.find((gr) => gr.materialIndex === 0);
  const c0 = capGroup ? capGroup.start : 0;
  const c1 = capGroup ? capGroup.start + capGroup.count : 0;
  for (let i = 0; i < pos.count; i++) {
    if (i >= c0 && i < c1) uv.setXY(i, (pos.getX(i) - TEX_X0) / (TEX_X1 - TEX_X0), (pos.getY(i) - TEX_Y0) / (TEX_Y1 - TEX_Y0));
    else uv.setXY(i, PLAIN_UV[0], PLAIN_UV[1]);
  }
  uv.needsUpdate = true;
  return g;
}

function plainUvs(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const uv = g.attributes.uv;
  if (uv) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, PLAIN_UV[0], PLAIN_UV[1]);
    uv.needsUpdate = true;
  }
  return g;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Per-vertex body shaping: plan taper at the ends, tumblehome above the beltline, rocker tuck. */
function shapeVertices(g: THREE.BufferGeometry, d: StyleDef): THREE.BufferGeometry {
  const pos = g.attributes.position!;
  const half = (d.frontX - d.rearX) / 2;
  const mid = (d.frontX + d.rearX) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    let z = pos.getZ(i);
    const fx = Math.abs(x - mid) / half;
    const t = smooth(0.72, 1.02, fx);
    z *= 1 - 0.11 * t * t;
    const ty = THREE.MathUtils.clamp((y - d.beltY) / (d.roofY - d.beltY), 0, 1.2);
    z *= 1 - d.tumble * ty;
    const tuck = smooth(d.bottomY + 0.25, d.bottomY - 0.02, y);
    z *= 1 - 0.035 * tuck;
    pos.setZ(i, z);
  }
  return g;
}

interface CarParts {
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  chrome: THREE.BufferGeometry;
  plate: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  turn: THREE.BufferGeometry;
  /** Wheel hub positions (x, y, z) — z > 0 = right side. */
  wheels: [number, number, number][];
  def: StyleDef;
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

/** Bevel size of the lower body (the silhouette grows by this much). */
const BODY_BEVEL = 0.05;

/** Point on a front/rear contour at height y: outer surface x (incl. bevel) and outward normal angle. */
function contourAt(pts: [number, number][], y: number, bevel = BODY_BEVEL): { x: number; y: number; angle: number } {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    if ((y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) || i === pts.length - 2) {
      const f = Math.abs(y1 - y0) < 1e-6 ? 0 : THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
      const dx = x1 - x0;
      const dy = y1 - y0;
      // outward normal: to the right of an upward-going front contour / downward-going rear contour
      let nx = dy;
      let ny = -dx;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      return { x: x0 + dx * f + nx * bevel, y: y0 + dy * f + ny * bevel, angle: Math.atan2(ny, nx) };
    }
  }
  return { x: pts[0]![0], y, angle: 0 };
}

/** A box of depth `dep` sitting on the front/rear contour at height y, protruding `out` m. */
function onContour(pts: [number, number][], y: number, z: number, size: [number, number, number], out: number, radius: number): THREE.BufferGeometry {
  const c = contourAt(pts, y);
  const [dep, h, w] = size;
  const off = out - dep / 2;
  const nx = Math.cos(c.angle);
  const ny = Math.sin(c.angle);
  return xf(roundedBox(dep, h, w, radius, 2), [c.x + nx * off, c.y + ny * off, z], [0, 0, c.angle]);
}

function flipFaces(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const pos = n.attributes.position!;
  const nor = n.attributes.normal;
  const uv = n.attributes.uv;
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
  if (nor) for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  return n;
}

/** Smooth shading for extrusions: weld vertices that share position+uv, recompute normals. */
function smoothed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

function buildParts(style: CarStyle): CarParts {
  const d = STYLES[style];
  const W = d.width;
  const Wc = d.cabinWidth;
  const shape = (g: THREE.BufferGeometry) => shapeVertices(g, d);
  const rx = d.rearX;
  const frontC: [number, number][] = [[d.front[0]![0], d.bottomY], ...d.front];
  const rearC: [number, number][] = [...d.rear, [d.bottomStart[0], d.bottomY]];

  // --- paint -------------------------------------------------------------
  const lower = smoothed(shape(sideUvs(extrudeAcross(lowerShape(d), W, 0.075, BODY_BEVEL, 4))));
  const frameShape = polyShape(d.cabin);
  for (const w of d.windows) frameShape.holes.push(polyHole(w));
  const frameT = 0.018;
  const frames = [1, -1].map((s) => {
    const g = new THREE.ExtrudeGeometry(frameShape, { depth: frameT, bevelEnabled: false, curveSegments: 4 });
    sideUvs(g);
    g.translate(0, 0, s > 0 ? Wc / 2 - frameT + 0.004 : -Wc / 2 - 0.004);
    shape(g);
    g.computeVertexNormals();
    return g;
  });
  // roof skin: band along the roof line
  const roofTop = d.roof.map(([x, y]) => [x, y + 0.02] as [number, number]);
  const roofBot = [...d.roof].reverse().map(([x, y]) => [x, y - 0.012] as [number, number]);
  const roofSkin = smoothed(shape(plainUvs(extrudeAcross(polyShape([...roofTop, ...roofBot]), Wc + 0.004, 0.028, 0.01, 3))));
  // mirrors (body color)
  const mirrorX = d.windows[0]![0]![0] - 0.04;
  const mirrorY = d.windows[0]![0]![1] + 0.03;
  const mirrorZ = Wc / 2 + 0.14;
  const mirrors = [1, -1].map((s) => plainUvs(xf(roundedBox(0.13, 0.085, 0.13, 0.03, 2), [mirrorX - 0.04, mirrorY, s * mirrorZ])));
  const paint = mergeAll([lower, ...frames, roofSkin, ...mirrors]);

  // --- glass ---------------------------------------------------------------
  const glass = smoothed(shape(plainUvs(extrudeAcross(polyShape(d.cabin), Wc, 0.03, 0.008, 3))));

  // --- trim (black plastic) -----------------------------------------------
  const trim: THREE.BufferGeometry[] = [];
  const grilleY = d.lampY.head - 0.09;
  const grilleH = 0.1;
  trim.push(onContour(frontC, grilleY, 0, [0.05, grilleH, W * 0.46], 0.012, 0.02));
  trim.push(onContour(frontC, d.bottomY + 0.055, 0, [0.05, 0.06, W * 0.6], 0.01, 0.02));
  trim.push(onContour(rearC, d.bottomY + 0.07, 0, [0.05, 0.06, W * 0.72], 0.01, 0.02));
  // wheel-well liners (upper half-shells facing the wheel) + underbody
  for (const ax of [d.axleF, d.axleR]) {
    const liner = new THREE.CylinderGeometry(d.archR - 0.006, d.archR - 0.006, W - 0.12, 20, 1, true, Math.PI / 2 - 0.3, Math.PI + 0.6);
    liner.rotateX(Math.PI / 2);
    trim.push(flipFaces(xf(liner, [ax, d.wheelR, 0])));
  }
  trim.push(xf(roundedBox(d.axleF - d.axleR + 1.4, 0.1, W - 0.25, 0.04, 1), [(d.axleF + d.axleR) / 2, d.bottomY - 0.02, 0]));
  // B/C-pillar blackout between side windows
  for (let i = 0; i < d.windows.length - 1; i++) {
    const a = d.windows[i]!;
    const b = d.windows[i + 1]!;
    const x0 = Math.min(...a.map((p) => p[0]));
    const x1 = Math.max(...b.map((p) => p[0]));
    const yb = a[0]![1];
    const top = Math.min(Math.max(...a.map((p) => p[1])), Math.max(...b.map((p) => p[1])));
    const h = top - yb + 0.02;
    for (const s of [1, -1]) trim.push(xf(roundedBox(x0 - x1 + 0.012, h, 0.012, 0.003, 1), [(x0 + x1) / 2, yb + h / 2 - 0.01, s * (Wc / 2 + 0.008)]));
  }
  // mirror glass + stalks
  for (const s of [1, -1]) {
    trim.push(xf(roundedBox(0.012, 0.07, 0.11, 0.01, 1), [mirrorX - 0.106, mirrorY, s * mirrorZ]));
    trim.push(xf(roundedBox(0.06, 0.03, 0.14, 0.01, 1), [mirrorX - 0.02, mirrorY - 0.03, s * (Wc / 2 + 0.05)]));
  }
  if (d.base === 'suv') {
    for (const s of [1, -1]) {
      const [x0, y0] = d.roof[0]!;
      const [x1, y1] = d.roof[d.roof.length - 1]!;
      const len = x0 - x1 - 0.3;
      const ry = Math.max(y0, y1) + 0.075;
      trim.push(xf(roundedBox(len, 0.03, 0.04, 0.012, 2), [(x0 + x1) / 2, ry, s * (Wc / 2 - 0.22)]));
      for (const px of [x0 - 0.25, (x0 + x1) / 2, x1 + 0.25]) trim.push(xf(roundedBox(0.08, 0.07, 0.04, 0.01, 1), [px, ry - 0.035, s * (Wc / 2 - 0.22)]));
    }
  }
  if (d.base === 'hatchback') {
    const [x, y] = d.roof[d.roof.length - 1]!;
    trim.push(xf(roundedBox(0.24, 0.035, Wc * 0.8, 0.015, 2), [x - 0.02, y + 0.025, 0]));
  }
  const [ax, ay] = d.roof[d.roof.length - 1]!;
  trim.push(xf(roundedBox(0.16, 0.05, 0.05, 0.02, 2), [ax + 0.28, ay + 0.045, 0])); // shark-fin antenna
  const trimG = mergeAll(trim.map((g) => shape(plainUvs(g))));

  // --- chrome ----------------------------------------------------------------
  const chrome: THREE.BufferGeometry[] = [];
  chrome.push(onContour(frontC, grilleY + grilleH / 2 - 0.01, 0, [0.03, 0.018, W * 0.52], 0.02, 0.008));
  const exhaust = new THREE.CylinderGeometry(0.035, 0.035, 0.14, 14);
  exhaust.rotateZ(Math.PI / 2);
  chrome.push(xf(exhaust, [contourAt(rearC, d.bottomY + 0.05).x + 0.03, d.bottomY + 0.05, W * 0.3]));
  const chromeG = mergeAll(chrome.map((g) => shape(plainUvs(g))));

  // --- plates ------------------------------------------------------------------
  const pw = 0.305;
  const ph = 0.152;
  const pf = contourAt(frontC, d.lampY.plateF);
  const pr = contourAt(rearC, d.lampY.plateR);
  const plateF = new THREE.PlaneGeometry(pw, ph);
  plateF.rotateY(Math.PI / 2);
  const plateR = new THREE.PlaneGeometry(pw, ph);
  plateR.rotateY(-Math.PI / 2);
  const plate = mergeAll([
    xf(plateF, [pf.x + 0.022 * Math.cos(pf.angle), pf.y + 0.022 * Math.sin(pf.angle), 0], [0, 0, pf.angle]),
    xf(plateR, [pr.x + 0.012 * Math.cos(pr.angle), pr.y + 0.012 * Math.sin(pr.angle), 0], [0, 0, pr.angle - Math.PI]),
  ]);
  shape(plate);

  // --- lamps -------------------------------------------------------------------
  const head: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  const turn: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    head.push(onContour(frontC, d.lampY.head, s * (W / 2 - 0.27), [0.05, 0.085, 0.36], 0.014, 0.022));
    turn.push(onContour(frontC, d.lampY.head - 0.01, s * (W / 2 - 0.06), [0.05, 0.06, 0.07], 0.012, 0.02));
    tail.push(onContour(rearC, d.lampY.tail, s * (W / 2 - 0.24), [0.05, 0.1, 0.4], 0.014, 0.025));
    turn.push(onContour(rearC, d.lampY.tail - 0.085, s * (W / 2 - 0.15), [0.05, 0.045, 0.16], 0.012, 0.018));
    // wrap-around tail piece on the rear quarter
    tail.push(xf(roundedBox(0.2, 0.08, 0.03, 0.012, 2), [rx + 0.12, d.lampY.tail, s * (W / 2 + 0.004)]));
    // mirror repeaters
    turn.push(xf(roundedBox(0.05, 0.014, 0.05, 0.006, 1), [mirrorX - 0.06, mirrorY - 0.042, s * (mirrorZ + 0.03)]));
  }
  // third brake light at the top of the rear glass
  const [crx, cry] = d.roof[d.roof.length - 1]!;
  tail.push(xf(roundedBox(0.04, 0.022, 0.36, 0.01, 1), [crx - 0.06, cry - 0.035, 0]));
  if (style === 'taxi') {
    const [x0, y0] = d.roof[1]!;
    head.push(xf(roundedBox(0.32, 0.15, 0.68, 0.045, 3), [x0 + 0.05, y0 + 0.09, 0]));
  }
  const headG = mergeAll(head.map((g) => shape(plainUvs(g))));
  const tailG = mergeAll(tail.map((g) => shape(plainUvs(g))));
  const turnG = mergeAll(turn.map((g) => shape(plainUvs(g))));
  return finish(style, d, { paint, glass, trim: trimG, chrome: chromeG, plate, head: headG, tail: tailG, turn: turnG });
}

function finish(style: CarStyle, d: StyleDef, g: Omit<CarParts, 'wheels' | 'def'>): CarParts {
  void style;
  const zW = d.width / 2 - d.tireW / 2 - 0.035;
  const wheels: [number, number, number][] = [
    [d.axleF, d.wheelR, zW],
    [d.axleF, d.wheelR, -zW],
    [d.axleR, d.wheelR, zW],
    [d.axleR, d.wheelR, -zW],
  ];
  return { ...g, wheels, def: d };
}

// --- wheels (unit radius; scale by wheelR) ------------------------------------

let tireGeo: THREE.BufferGeometry | null = null;
let rimGeo: THREE.BufferGeometry | null = null;

/** Tire of radius 1 (width 0.66), axis +Z. */
export function unitTire(): THREE.BufferGeometry {
  if (tireGeo) return tireGeo;
  const w = 0.33;
  const prof: [number, number][] = [
    [0.66, w * 0.82],
    [0.8, w * 0.95],
    [0.93, w * 0.98],
    [0.985, w * 0.8],
    [1.0, w * 0.45],
    [1.0, -w * 0.45],
    [0.985, -w * 0.8],
    [0.93, -w * 0.98],
    [0.8, -w * 0.95],
    [0.66, -w * 0.82],
  ];
  const g = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    32,
  );
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  tireGeo = g;
  return g;
}

/** 5-spoke alloy rim of radius 1 scale (outer face at +Z). */
export function unitRim(): THREE.BufferGeometry {
  if (rimGeo) return rimGeo;
  const R = 0.68;
  const s = new THREE.Shape();
  s.absarc(0, 0, R, 0, Math.PI * 2, false);
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2 + 0.3;
    const a1 = a0 + (Math.PI * 2) / 5 - 0.6;
    const h = new THREE.Path();
    h.absarc(0, 0, R * 0.86, a0, a1, false);
    h.absarc(0, 0, R * 0.34, a1 - 0.08, a0 + 0.08, true);
    h.closePath();
    s.holes.push(h);
  }
  const face = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 2, curveSegments: 24 });
  face.translate(0, 0, 0.14);
  const barrel = new THREE.CylinderGeometry(R, R, 0.5, 32, 1, true);
  barrel.rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.16, 0.18, 0.08, 20);
  hub.rotateX(Math.PI / 2);
  const back = new THREE.CircleGeometry(R, 32);
  back.translate(0, 0, -0.05);
  rimGeo = mergeAll([face, barrel, xf(hub, [0, 0, 0.23]), back]);
  return rimGeo;
}

// ---------------------------------------------------------------------------
// Textures & materials
// ---------------------------------------------------------------------------

function sideTexture(style: CarStyle): THREE.CanvasTexture {
  return sharedTex(`car:side:${style}`, () => {
    const d = STYLES[style];
    const W = 1024;
    const H = 410;
    const [c, ctx] = makeCanvas(W, H);
    const X = (x: number) => ((x - TEX_X0) / (TEX_X1 - TEX_X0)) * W;
    const Y = (y: number) => H - ((y - TEX_Y0) / (TEX_Y1 - TEX_Y0)) * H;
    const px = W / (TEX_X1 - TEX_X0); // px per meter
    ctx.fillStyle = '#efefef';
    ctx.fillRect(0, 0, W, H);
    // plain white corner for untextured parts
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 40, 40);
    // subtle shading: lighter shoulder, darker lower door
    const gr = ctx.createLinearGradient(0, Y(d.beltY), 0, Y(d.bottomY));
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, Y(d.beltY), W, Y(d.bottomY) - Y(d.beltY));
    // character line
    const cl = d.bottomY + (d.beltY - d.bottomY) * 0.62;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(X(d.rearX + 0.2), Y(cl), X(d.frontX - 0.35) - X(d.rearX + 0.2), 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(X(d.rearX + 0.2), Y(cl) - 2, X(d.frontX - 0.35) - X(d.rearX + 0.2), 2);
    // door cut lines
    ctx.strokeStyle = 'rgba(20,20,20,0.85)';
    ctx.lineWidth = 2;
    const top = d.beltY + 0.02;
    const bot = d.bottomY + 0.07;
    const [s0, s1, s2] = d.seams as [number, number, number];
    ctx.beginPath();
    ctx.moveTo(X(s0), Y(top));
    ctx.lineTo(X(s0), Y(bot));
    ctx.moveTo(X(s1), Y(top));
    ctx.lineTo(X(s1), Y(bot));
    // rear door edge wraps in front of the rear arch
    const archFront = d.axleR + d.archR + 0.04;
    ctx.moveTo(X(s2), Y(top));
    ctx.lineTo(X(s2), Y(d.wheelR + d.archR * 0.55));
    ctx.quadraticCurveTo(X(archFront), Y(d.wheelR + d.archR * 0.3), X(archFront), Y(bot));
    // door bottoms
    ctx.moveTo(X(s0), Y(bot));
    ctx.lineTo(X(archFront), Y(bot));
    ctx.stroke();
    // handles
    for (const hx of d.handles) {
      ctx.fillStyle = 'rgba(25,25,25,0.8)';
      ctx.beginPath();
      ctx.roundRect(X(hx) - 0.07 * px, Y(d.handleY) - 0.018 * px, 0.14 * px, 0.036 * px, 0.018 * px);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(X(hx) - 0.06 * px, Y(d.handleY) - 0.016 * px, 0.12 * px, 2);
    }
    // fuel door
    ctx.strokeStyle = 'rgba(20,20,20,0.6)';
    ctx.beginPath();
    ctx.arc(X(d.axleR - 0.42), Y(d.beltY - 0.14), 0.07 * px, 0, Math.PI * 2);
    ctx.stroke();
    // rocker trim (black cladding) between the arches
    ctx.fillStyle = 'rgba(18,18,18,0.95)';
    ctx.fillRect(X(d.axleR + d.archR * 0.8), Y(d.bottomY + 0.075), X(d.axleF - d.archR * 0.8) - X(d.axleR + d.archR * 0.8), 0.1 * px);
    // SUV arch cladding
    if (d.base === 'suv') {
      ctx.strokeStyle = 'rgba(18,18,18,0.95)';
      ctx.lineWidth = 0.07 * px;
      for (const ax of [d.axleF, d.axleR]) {
        ctx.beginPath();
        ctx.arc(X(ax), Y(d.wheelR), (d.archR + 0.035) * px, Math.PI, 0);
        ctx.stroke();
      }
    }
    // taxi stripe
    if (style === 'taxi') {
      ctx.fillStyle = '#111';
      for (let x = X(d.rearX + 0.35); x < X(d.frontX - 0.5); x += 0.08 * px) {
        ctx.fillRect(x, Y(cl + 0.03), 0.04 * px, 0.04 * px);
        ctx.fillRect(x + 0.04 * px, Y(cl + 0.07), 0.04 * px, 0.04 * px);
      }
    }
    return canvasTex(c, { aniso: 8 });
  });
}

function plateTexture(): THREE.CanvasTexture {
  return sharedTex('car:plate', () => {
    const [c, ctx] = makeCanvas(256, 128);
    ctx.fillStyle = '#f6f5ef';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#1d3b7a';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 120);
    ctx.fillStyle = '#1d3b7a';
    ctx.font = 'bold 20px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PLC WORLD', 128, 30);
    ctx.fillStyle = '#16213a';
    ctx.font = 'bold 60px "Arial Narrow", Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('L5X 380', 128, 80);
    return canvasTex(c);
  });
}

export function carPaintMaterial(style: CarStyle, color: string, metallic: boolean): THREE.MeshPhysicalMaterial {
  return sharedMat(
    `car:paint:${style}:${color}:${metallic}`,
    () =>
      new THREE.MeshPhysicalMaterial({
        color,
        map: sideTexture(style),
        roughness: metallic ? 0.34 : 0.4,
        metalness: metallic ? 0.55 : 0.05,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      }),
  );
}

const carMats = {
  glass: () => sharedMat('car:glass', () => new THREE.MeshStandardMaterial({ color: '#1b252d', roughness: 0.05, metalness: 0.7, envMapIntensity: 2 })),
  trim: () => tmats.plastic('#121314', 0.62),
  chrome: () => tmats.metal('#d8dde2', 0.12),
  plate: () => sharedMat('car:plateMat', () => new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.45, metalness: 0.2 })),
  tire: () => tmats.rubber('#171717'),
  rim: () => sharedMat('car:rim', () => new THREE.MeshStandardMaterial({ color: '#c3c8cd', roughness: 0.28, metalness: 0.75 })),
};

/** Lamp colors (linear RGB multipliers for unlit, HDR, toneMapped=false materials). */
const LAMP = {
  headOff: new THREE.Color(0.72, 0.74, 0.78),
  headDrl: new THREE.Color(1.6, 1.6, 1.55),
  headOn: new THREE.Color(5, 4.9, 4.4),
  tailOff: new THREE.Color(0.3, 0.02, 0.025),
  tailOn: new THREE.Color(1.3, 0.05, 0.04),
  brake: new THREE.Color(6, 0.2, 0.12),
  turnOff: new THREE.Color(0.5, 0.25, 0.03),
  turnOn: new THREE.Color(6, 2.2, 0.1),
  taxiOn: new THREE.Color(3.5, 3.2, 1.6),
};

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
  onClick?: () => void;
}

function resolvePaint(color: string): { hex: string; metallic: boolean } {
  return color in CAR_PAINT ? CAR_PAINT[color as CarColorName] : { hex: color, metallic: false };
}

/** Linear paint colors per named paint (no per-frame string parsing). */
const PAINT_COLOR: Record<string, THREE.Color> = Object.fromEntries(Object.entries(CAR_PAINT).map(([k, v]) => [k, new THREE.Color(v.hex)]));

export function Car({ variant = 0, style, color, length, getDistance, getSteer, getBraking, getHeadlights, getBlinker, onClick, position, rotation, scale }: CarProps) {
  const v = carVariant(variant);
  const st = style ?? v.style;
  const paint = resolvePaint(color ?? v.color);
  const parts = carParts(st);
  const d = parts.def;
  const nominal = d.frontX - d.rearX + 0.1;
  const sx = length ? length / nominal : 1;
  const lamps = useMemo(
    () => ({
      head: new THREE.MeshBasicMaterial({ color: LAMP.headOff.clone(), toneMapped: false }),
      tail: new THREE.MeshBasicMaterial({ color: LAMP.tailOff.clone(), toneMapped: false }),
      turn: new THREE.MeshBasicMaterial({ color: LAMP.turnOff.clone(), toneMapped: false }),
    }),
    [],
  );
  useDisposable(useMemo(() => [lamps.head, lamps.tail, lamps.turn], [lamps]));
  const spins = useRef<(THREE.Group | null)[]>([]);
  const steers = useRef<(THREE.Group | null)[]>([]);
  const g = useRef({ getDistance, getSteer, getBraking, getHeadlights, getBlinker });
  g.current = { getDistance, getSteer, getBraking, getHeadlights, getBlinker };
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
    lamps.head.color.copy(hl ? LAMP.headOn : LAMP.headDrl);
    lamps.tail.color.copy(g.current.getBraking?.() ? LAMP.brake : hl ? LAMP.tailOn : LAMP.tailOff);
    const bl = g.current.getBlinker?.() ?? null;
    lamps.turn.color.copy(bl && t % 0.8 < 0.4 ? LAMP.turnOn : LAMP.turnOff);
  });
  const handlers = onClick
    ? {
        onPointerDown: (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onClick();
        },
      }
    : {};
  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      <group scale={[sx, 1, 1]}>
        <mesh geometry={parts.paint} material={carPaintMaterial(st, paint.hex, paint.metallic)} castShadow receiveShadow />
        <mesh geometry={parts.glass} material={carMats.glass()} castShadow />
        <mesh geometry={parts.trim} material={carMats.trim()} castShadow />
        <mesh geometry={parts.chrome} material={carMats.chrome()} />
        <mesh geometry={parts.plate} material={carMats.plate()} />
        <mesh geometry={parts.head} material={lamps.head} />
        <mesh geometry={parts.tail} material={lamps.tail} />
        <mesh geometry={parts.turn} material={lamps.turn} />
      </group>
      {parts.wheels.map(([x, y, z], i) => (
        <group key={i} position={[x * sx, y, z]} ref={(el) => void (i < 2 ? (steers.current[i] = el) : undefined)}>
          <group rotation={[0, z < 0 ? Math.PI : 0, 0]}>
            <group ref={(el) => void (spins.current[i] = el)} scale={d.wheelR}>
              <mesh geometry={unitTire()} material={carMats.tire()} castShadow />
              <mesh geometry={unitRim()} material={carMats.rim()} />
            </group>
          </group>
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
type PartKey = 'paint' | 'glass' | 'trim' | 'chrome' | 'plate' | 'head' | 'tail' | 'turn';
const PART_KEYS: PartKey[] = ['paint', 'glass', 'trim', 'chrome', 'plate', 'head', 'tail', 'turn'];

function fleetMaterial(style: CarStyle, key: PartKey): THREE.Material {
  switch (key) {
    case 'paint':
      return sharedMat(
        `car:fleetPaint:${style}`,
        () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: sideTexture(style), roughness: 0.36, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 }),
      );
    case 'glass':
      return carMats.glass();
    case 'trim':
      return carMats.trim();
    case 'chrome':
      return carMats.chrome();
    case 'plate':
      return carMats.plate();
    default:
      return sharedMat('car:fleetLamp', () => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  }
}

function newInstance(): CarInstance {
  return { x: 0, y: 0, z: 0, yaw: 0, variant: 0, length: 0, distance: 0, steer: 0, braking: false, headlights: false, blinker: null, roll: 0, pitch: 0 };
}

export function CarFleet({ capacity, getCar, castShadow = true }: CarFleetProps) {
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const tires = useRef<THREE.InstancedMesh>(null);
  const rims = useRef<THREE.InstancedMesh>(null);
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
      mesh.frustumCulled = false;
    }
    for (const r of [tires.current, rims.current]) {
      if (r) {
        r.count = 0;
        r.frustumCulled = false;
      }
    }
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const blinkOn = t % 0.8 < 0.4;
    const counts = tmp.counts;
    for (const s of FLEET_STYLES) counts[s] = 0;
    let wheelN = 0;
    const inst = tmp.inst;
    for (let i = 0; i < capacity; i++) {
      Object.assign(inst, DEFAULT_INSTANCE);
      if (!getter.current(i, inst)) continue;
      const v = carVariant(inst.variant);
      const parts = carParts(v.style);
      const d = parts.def;
      const k = counts[v.style]!;
      counts[v.style] = k + 1;
      const nominal = d.frontX - d.rearX + 0.1;
      const sx = inst.length > 0 ? inst.length / nominal : 1;
      tmp.e.set(inst.pitch, inst.yaw, inst.roll, 'YXZ');
      tmp.q.setFromEuler(tmp.e);
      tmp.p.set(inst.x, inst.y, inst.z);
      tmp.s.set(sx, 1, 1);
      tmp.body.compose(tmp.p, tmp.q, tmp.s);
      const paintColor = PAINT_COLOR[v.color]!;
      for (const key of PART_KEYS) {
        const mesh = meshes.current[`${v.style}:${key}`];
        if (!mesh) continue;
        mesh.setMatrixAt(k, tmp.body);
        if (key === 'paint') mesh.setColorAt(k, paintColor);
        else if (key === 'head') mesh.setColorAt(k, inst.headlights ? (v.style === 'taxi' ? LAMP.taxiOn : LAMP.headOn) : LAMP.headDrl);
        else if (key === 'tail') mesh.setColorAt(k, inst.braking ? LAMP.brake : inst.headlights ? LAMP.tailOn : LAMP.tailOff);
        else if (key === 'turn') mesh.setColorAt(k, inst.blinker && blinkOn ? LAMP.turnOn : LAMP.turnOff);
      }
      // wheels
      tmp.s.set(1, 1, 1);
      tmp.body.compose(tmp.p, tmp.q, tmp.s);
      const ang = inst.distance / d.wheelR;
      for (let w = 0; w < 4; w++) {
        const [wx, wy, wz] = parts.wheels[w]!;
        const right = wz > 0;
        tmp.e.set(0, (w < 2 ? inst.steer : 0) + (right ? 0 : Math.PI), right ? -ang : ang, 'YXZ');
        tmp.q.setFromEuler(tmp.e);
        tmp.p.set(wx * sx, wy, wz);
        tmp.s.setScalar(d.wheelR);
        tmp.w.compose(tmp.p, tmp.q, tmp.s);
        tmp.m.multiplyMatrices(tmp.body, tmp.w);
        tires.current?.setMatrixAt(wheelN, tmp.m);
        rims.current?.setMatrixAt(wheelN, tmp.m);
        wheelN++;
      }
      tmp.p.set(inst.x, inst.y, inst.z);
    }
    for (const s of FLEET_STYLES) {
      for (const key of PART_KEYS) {
        const mesh = meshes.current[`${s}:${key}`];
        if (!mesh) continue;
        mesh.count = counts[s]!;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const r of [tires.current, rims.current]) {
      if (!r) continue;
      r.count = wheelN;
      r.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {FLEET_STYLES.map((s) => {
        const parts = carParts(s);
        return PART_KEYS.map((key) => (
          <instancedMesh
            key={`${s}:${key}`}
            ref={(el) => {
              meshes.current[`${s}:${key}`] = el;
              if (el && !el.instanceColor && (key === 'paint' || key === 'head' || key === 'tail' || key === 'turn')) {
                el.setColorAt(0, new THREE.Color(1, 1, 1));
              }
            }}
            args={[parts[key], fleetMaterial(s, key), capacity]}
            castShadow={castShadow && (key === 'paint' || key === 'glass' || key === 'trim')}
            receiveShadow={key === 'paint'}
            frustumCulled={false}
          />
        ));
      })}
      <instancedMesh ref={tires} args={[unitTire(), carMats.tire(), capacity * 4]} castShadow={castShadow} frustumCulled={false} />
      <instancedMesh ref={rims} args={[unitRim(), carMats.rim(), capacity * 4]} frustumCulled={false} />
    </group>
  );
}

const DEFAULT_INSTANCE: CarInstance = newInstance();

/** Soft blob shadow under a car (cheap alternative to shadow maps for far cars). */
export function carShadowGeometry() {
  return cylY(1, 1, 0.001, 24);
}
