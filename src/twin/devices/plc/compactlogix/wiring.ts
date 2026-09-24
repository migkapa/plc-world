/**
 * Field wiring for 5069 RTBs: builds ONE vertex-colored geometry per module containing every wire, shielded
 * analog pair (jacket + heat-shrink + conductors), ferrule collar and white marker sleeve. Wires leave their
 * wire entries, comb down in front of the RTB (upper terminals outermost) and drop into the finger slots of a
 * wire duct below the rack (or bend back into the panel when there is no duct).
 */
import * as THREE from 'three';
import { COLORS } from '../../../common';
import { cachedGeometry, mergeColored } from './geometry';
import { ENTRY, M5069, rtbTerminal, STYLES, type DuctTarget, type Module5069Catalog } from './m5069';

const WIRE_R = 0.0011; // 18 AWG with insulation ≈ 2.2 mm OD
const COND_R = 0.00075; // analog pair conductor
const JACKET_R = 0.0023; // shielded pair cable
const COLORS_W = {
  dc: COLORS.wireBlue,
  dcCommon: '#e9edf5', // white with blue stripe (grounded DC)
  stripe: '#2553c9',
  shield: '#2e9d3e',
  shieldStripe: '#f2d21b',
  jacket: '#7d8389',
  shrink: '#141414',
  pos: '#f0f0ea',
  neg: '#151515',
  ferrule: '#a3a8ad',
  marker: '#f3f3ee',
};

type WireItem =
  | { kind: 'single'; term: number; color: string; stripe?: string; r: number }
  | { kind: 'pair'; a: number; b: number; colorA: string; colorB: string };

/**
 * Terminals to wire for a catalog. `points` = digital points / analog channels in use (default: all).
 * Commons / shield / SA power are added automatically.
 */
export function wireItems(catalog: Module5069Catalog, points?: number[]): WireItem[] {
  const st = STYLES[catalog];
  const used = points ?? Array.from({ length: st.points }, (_, i) => i);
  const items: WireItem[] = [];
  if (st.kind === 'DI' || st.kind === 'DO') {
    for (const p of used) if (p >= 0 && p < 16) items.push({ kind: 'single', term: p, color: COLORS_W.dc, r: WIRE_R });
    if (used.length) {
      items.push({ kind: 'single', term: 16, color: COLORS_W.dcCommon, stripe: COLORS_W.stripe, r: WIRE_R });
      if (used.length > 8) items.push({ kind: 'single', term: 17, color: COLORS_W.dcCommon, stripe: COLORS_W.stripe, r: WIRE_R });
    }
  } else if (st.kind === 'AI') {
    for (const c of used) if (c >= 0 && c < 8) items.push({ kind: 'pair', a: 2 * c, b: 2 * c + 1, colorA: COLORS_W.pos, colorB: COLORS_W.neg });
    if (used.length) items.push({ kind: 'single', term: 17, color: COLORS_W.shield, stripe: COLORS_W.shieldStripe, r: 0.0009 });
  } else {
    for (const c of used) if (c >= 0 && c < 4) items.push({ kind: 'pair', a: 4 * c + 1, b: 4 * c + 3, colorA: COLORS_W.pos, colorB: COLORS_W.neg });
    if (used.length) {
      items.push({ kind: 'single', term: 16, color: COLORS_W.dc, r: WIRE_R });
      items.push({ kind: 'single', term: 17, color: COLORS_W.dcCommon, stripe: COLORS_W.stripe, r: WIRE_R });
    }
  }
  return items;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function tube(points: THREE.Vector3[], r: number, color: string, stripe?: string, segs?: number): [THREE.BufferGeometry, null] {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const n = segs ?? Math.max(12, Math.round(curve.getLength() / 0.003));
  const radial = 6;
  const g = new THREE.TubeGeometry(curve, n, r, radial, false);
  const base = new THREE.Color(color);
  const st = stripe ? new THREE.Color(stripe) : null;
  const count = g.getAttribute('position').count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const j = i % (radial + 1);
    const c = st && (j === 1 || j === 2) ? st : base;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return [g, null];
}

const UP = new THREE.Vector3(0, 1, 0);

/** Short sleeve (cylinder) centered on a curve point, aligned with the tangent. */
function sleeve(curvePts: THREE.Vector3[], atMeters: number, r: number, len: number, color: string): [THREE.BufferGeometry, string, THREE.Matrix4] {
  const curve = new THREE.CatmullRomCurve3(curvePts, false, 'centripetal');
  const u = Math.min(0.95, atMeters / curve.getLength());
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, t);
  const g = new THREE.CylinderGeometry(r, r, len, 10, 1, false);
  return [g, color, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1))];
}

/** Ferrule collar sticking out of a wire entry (axis +Z). */
function collar(x: number, y: number, r: number, color: string): [THREE.BufferGeometry, string, THREE.Matrix4] {
  const g = new THREE.CylinderGeometry(r, r, 0.0024, 10, 1, false);
  const m = new THREE.Matrix4().compose(V(x, y, M5069.rtbFront - 0.0003), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2), V(1, 1, 1));
  return [g, color, m];
}

/** Route from a point in front of the RTB down into the duct (or back into the panel). */
function dropRoute(x: number, zRun: number, seed: number, duct: DuctTarget | null, panelZ: number): THREE.Vector3[] {
  const yBelow = M5069.rtbBottom - 0.005;
  if (!duct) {
    return [V(x, yBelow, zRun + 0.001), V(x * 1.2, -0.02, zRun * 0.8), V(x * 1.3, -0.038, panelZ + 0.03), V(x * 1.3, -0.045, panelZ - 0.002)];
  }
  // spread the bundle over the nearby duct slots
  const target = x * 1.9;
  const k = Math.round((target - duct.phase) / duct.pitch);
  const xs = duct.phase + k * duct.pitch + (((seed * 7) % 3) - 1) * 0.0008;
  const f = ((seed * 5) % 9) / 8;
  const zSlot = duct.zMin + 0.01 + f * Math.max(0, duct.zMax - duct.zMin - 0.02);
  const yMid = (yBelow + duct.top) / 2;
  return [
    V(x, yBelow, zRun + 0.001),
    V(x + (xs - x) * 0.45, yMid, zRun + (zSlot - zRun) * 0.55),
    V(xs, duct.top + 0.01, zSlot),
    V(xs, duct.top - 0.016, zSlot),
  ];
}

export interface WiringOptions {
  catalog: Module5069Catalog;
  /** Points / channels to wire (default all). */
  points?: number[];
  /** Duct target (module-local); null = wires bend back into the panel. */
  duct: DuctTarget | null;
  /** Panel surface z in module-local coordinates (for duct-less routing). */
  panelZ?: number;
}

export function wiringGeometry({ catalog, points, duct, panelZ = -0.0075 }: WiringOptions): THREE.BufferGeometry | null {
  const items = wireItems(catalog, points);
  if (!items.length) return null;
  const key = `5069-wiring:${catalog}:${points?.join(',') ?? 'all'}:${duct ? [duct.top, duct.zMin, duct.zMax, duct.pitch, duct.phase].map((n) => n.toFixed(5)).join(',') : 'panel'}:${panelZ}`;
  return cachedGeometry(key, () => {
    const parts: Array<[THREE.BufferGeometry, string | null, THREE.Matrix4?]> = [];
    const front = M5069.rtbFront;
    const floor = front - M5069.rtbRecess;
    items.forEach((it, idx) => {
      if (it.kind === 'single') {
        const t = rtbTerminal(it.term);
        const ye = t.v + ENTRY.dy;
        const zRun = front + 0.0034 + (8 - t.row) * 0.00175;
        const jit = ((((t.row * 37 + t.col * 11) % 5) - 2) * 0.0005) as number;
        const xRun = t.u + jit;
        const head = [
          V(t.u, ye, floor + 0.0002),
          V(t.u, ye - 0.0002, front + 0.0014),
          V(t.u + jit * 0.3, ye - 0.0036, zRun - 0.0008),
          V(xRun, ye - 0.0095, zRun),
        ];
        const pts = head.concat(dropRoute(xRun, zRun, idx + t.row, duct, panelZ));
        parts.push(tube(pts, it.r, it.color, it.stripe));
        parts.push(collar(t.u, ye, it.r + 0.0003, COLORS_W.ferrule));
        parts.push(sleeve(pts, 0.016, it.r + 0.00035, 0.005, COLORS_W.marker));
      } else {
        const ta = rtbTerminal(it.a);
        const tb = rtbTerminal(it.b);
        const topRow = Math.min(ta.row, tb.row);
        const lowRow = Math.max(ta.row, tb.row);
        const yLow = Math.min(ta.v, tb.v) + ENTRY.dy;
        const side = topRow % 2 === 0 ? -1 : 1;
        const qx = side * 0.0042;
        const zq = front + 0.0058 + (8 - topRow) * 0.0021;
        const qy = yLow - 0.011 - (lowRow - topRow) * 0.002;
        // conductors: entry → breakout
        for (const [t, color, dx] of [
          [ta, it.colorA, -0.0008],
          [tb, it.colorB, 0.0008],
        ] as const) {
          const ye = t.v + ENTRY.dy;
          const pts = [
            V(t.u, ye, floor + 0.0002),
            V(t.u, ye - 0.0002, front + 0.0014),
            V(t.u * 0.75 + qx * 0.25, ye - 0.0045, zq - 0.0022),
            V(qx + dx, qy + 0.0035, zq),
            V(qx + dx * 0.5, qy - 0.001, zq),
          ];
          parts.push(tube(pts, COND_R, color, undefined, 24));
          parts.push(collar(t.u, ye, COND_R + 0.0004, '#e8e8e2'));
        }
        // jacket from the breakout down into the duct, with a heat-shrink ring at the breakout
        const jacketPts = [V(qx, qy + 0.001, zq), V(qx, qy - 0.006, zq + 0.0004)].concat(dropRoute(qx, zq + 0.0006, idx * 3 + topRow, duct, panelZ));
        parts.push(tube(jacketPts, JACKET_R, COLORS_W.jacket));
        parts.push(sleeve(jacketPts, 0.002, JACKET_R + 0.0003, 0.007, COLORS_W.shrink));
        parts.push(sleeve(jacketPts, 0.02, JACKET_R + 0.00035, 0.006, COLORS_W.marker));
      }
    });
    return mergeColored(parts);
  });
}
