/**
 * Procedural car body geometry (no earcut slivers): the lower body and the greenhouse are LOFTED GRIDS
 * — a fixed-topology cross-section ring evaluated at many stations along the car (X) and stitched into
 * quads, so normals are smooth everywhere (area-weighted over a regular grid) and creased only where
 * we duplicate a row on purpose (wheel-arch lip).
 *
 *  - Lower body section: floor → wheel-well wall → wheel-well ceiling (at the arch height, so the
 *    arches are real openings with a black well behind them) → rocker/arch-lip radius → gently bulged
 *    side → shoulder radius → crowned hood/deck. The side silhouette (upper & lower chains) comes
 *    from a smoothed control polygon; the plan view is a superellipse at the nose and tail, so the
 *    sections converge to a line at the bumper tips and the ends close without caps.
 *  - Greenhouse section: base on the belt (inset by the shoulder shelf) → tumblehome side → roof-rail
 *    radius → crowned roof; it degenerates to a line at the windshield base and at the rear glass base.
 *
 * UVs index a 2048 × 1024 body atlas: the upper half is a side projection (x, y) of the lower body
 * (door cuts, handles, cladding), the lower half is the greenhouse in (x, arc length from the belt)
 * space so windows / pillars / windshield are crisp regions aligned with the grid rows.
 *
 * Conventions: meters, car front = +X, Y up, right side = +Z, origin = center on the ground.
 */
import * as THREE from "three";

export type CarBase = "sedan" | "hatchback" | "suv";

/** Side-window daylight opening in the greenhouse side band: x range (front edge at x1). */
export interface WindowSpec {
  x0: number;
  x1: number;
  /** Rear edge rake: the top of the rear edge sits this much further forward (m). */
  rakeRear?: number;
  /** Front edge rake (top further back). */
  rakeFront?: number;
}

export interface DecalSpec {
  /** Approximate target point on the body surface. */
  at: [number, number, number];
  /** Projection heading about +Y: rays travel along (−cos ψ, 0, −sin ψ). 0 = from the front. */
  yaw: number;
  /** Size along the decal's right / up axes (m). */
  size: [number, number];
  /** Atlas cell [u0, v0, u1, v1]. */
  cell: [number, number, number, number];
  /** Offset from the surface toward the viewer (m). */
  offset: number;
  /** Mirror the texture horizontally. */
  flipU?: boolean;
  /** Grid resolution. */
  grid?: [number, number];
}

export interface BodyStyle {
  base: CarBase;
  /** Body width without mirrors. */
  W: number;
  wheelR: number;
  tireW: number;
  archGap: number;
  axleF: number;
  axleR: number;
  /** Lower-body side silhouette control points: closed, counter-clockwise from the nose tip. */
  lower: [number, number][];
  /** Greenhouse roof line control points, windshield base → rear glass base. */
  roof: [number, number][];
  /** Plan-view superellipse at the nose / tail: [rx, rz, exponent]. */
  planF: [number, number, number];
  planR: [number, number, number];
  /** Greenhouse plan taper at the windshield base / rear glass base: [rx, rz]. */
  ghPlanF: [number, number];
  ghPlanR: [number, number];
  /** Shoulder shelf between the body side and the greenhouse base (m). */
  shelf: number;
  /** Greenhouse tumblehome: inward lean at roof height (m). */
  tumble: number;
  rTop: number;
  rBot: number;
  bulge: number;
  /** Character line (crisp crease) height at the nose and at the tail (m); the upper door leans in above it. */
  crease: [number, number];
  /** Inward lean of the surface above the crease (m per m). */
  creaseLean: number;
  crownHood: number;
  crownDeck: number;
  roofR: number;
  roofCrown: number;
  /** Greenhouse zones along X: windshield top (roof front) and rear glass top. */
  xWsTop: number;
  xRoofRear: number;
  windows: WindowSpec[];
  /** Gloss-black pillar bands in the greenhouse side (x ranges). */
  blackPillars: [number, number][];
  /** Door cut lines on the lower body: front door front x, B-pillar x, rear door rear x (at the belt). */
  seams: [number, number, number];
  handles: number[];
  handleDrop: number;
  /** Black lower cladding & arch flares (SUV). */
  cladding: boolean;
  /** Lamp / fascia decal targets. */
  head: DecalSpec;
  tail: DecalSpec;
  grille: DecalSpec;
  intake: DecalSpec;
  plateF: DecalSpec;
  plateR: DecalSpec;
  valance: DecalSpec;
  splitter: DecalSpec;
}

// ---------------------------------------------------------------------------
// Atlas mapping
// ---------------------------------------------------------------------------

export const ATLAS = {
  X0: -2.6,
  X1: 2.6,
  /** Lower body: y 0..Y1 → v 0.5..1. */
  Y1: 1.6,
  /** Greenhouse: arc length 0..S1 → v 0..0.5. */
  S1: 1.6,
  W: 2048,
  H: 1024,
} as const;

export const uOf = (x: number) => (x - ATLAS.X0) / (ATLAS.X1 - ATLAS.X0);
export const vLower = (y: number) => 0.5 + (0.5 * y) / ATLAS.Y1;
export const vGreen = (s: number) => (0.5 * s) / ATLAS.S1;
/** Black "under / wheel well" texel region (below every body point). */
export const UV_UNDER: [number, number] = [0.5, vLower(0.04)];
/** Plain paint texel region (above every lower-body point). */
export const UV_PAINT: [number, number] = [0.5, vLower(1.5)];
/** Canvas px of the atlas. */
export const pxX = (x: number) => uOf(x) * ATLAS.W;
export const pyLower = (y: number) => (1 - vLower(y)) * ATLAS.H;
export const pyGreen = (s: number) => (1 - vGreen(s)) * ATLAS.H;

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

function sampleSpline(
  points: [number, number][],
  closed: boolean,
  n: number,
): THREE.Vector3[] {
  const c = new THREE.CatmullRomCurve3(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0)),
    closed,
    "centripetal",
  );
  return c.getSpacedPoints(n);
}

/** Monotone piecewise-linear function y(x) from samples (x ascending). */
class Chain {
  constructor(
    readonly xs: Float64Array,
    readonly ys: Float64Array,
  ) {}
  static from(pts: { x: number; y: number }[]): Chain {
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of sorted) {
      if (xs.length && p.x - xs[xs.length - 1]! < 1e-5) {
        ys[ys.length - 1] = (ys[ys.length - 1]! + p.y) / 2;
        continue;
      }
      xs.push(p.x);
      ys.push(p.y);
    }
    return new Chain(Float64Array.from(xs), Float64Array.from(ys));
  }
  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (x <= xs[0]!) return this.ys[0]!;
    if (x >= xs[n - 1]!) return this.ys[n - 1]!;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m]! <= x) lo = m;
      else hi = m;
    }
    const t = (x - xs[lo]!) / (xs[hi]! - xs[lo]!);
    return this.ys[lo]! + (this.ys[hi]! - this.ys[lo]!) * t;
  }
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Superellipse falloff: 1 inside, → 1 − rz/half at the tip (t = 0 at the start of the taper, 1 at the tip). */
function superTaper(t: number, n: number): number {
  const tt = clamp01(t);
  return Math.pow(1 - Math.pow(tt, n), 1 / n);
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/** Rows of the lower-body half section. */
const LOWER_ROWS = 26;
/** Index (in the half section) of the first of the two duplicated character-line rows. */
const CREASE_ROW = 12;
/** Index of the first of the two duplicated rocker / arch-lip rows. */
const LIP_ROW = 5;
/** Rows of the greenhouse half section. */
const GH_ROWS = 19;

export interface GhColumn {
  x: number;
  /** Arc length from the base to the side top (window top), corner end and roof center. */
  sSide: number;
  sCorner: number;
  sTop: number;
}

export interface BuiltBody {
  lower: THREE.BufferGeometry;
  greenhouse: THREE.BufferGeometry;
  ghColumns: GhColumn[];
  xf: number;
  xr: number;
  /** Silhouette queries. */
  yUp: (x: number) => number;
  yLo: (x: number) => number;
  hwPlan: (x: number) => number;
  /** Lower-body top height at x on the centerline (with crown) and the greenhouse base/top. */
  ghBase: (x: number) => number;
  ghTop: (x: number) => number;
  ghHalfWidth: (x: number) => number;
  xg0: number;
  xg1: number;
  archR: number;
  zWheel: number;
  /** Ray-march onto the lower body. Returns the hit point or null. */
  hit: (
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist?: number,
  ) => THREE.Vector3 | null;
  /** Conforming decal grid geometry (position, normal, uv in the given atlas cell). */
  decal: (spec: DecalSpec) => THREE.BufferGeometry;
}

export function buildBody(st: BodyStyle): BuiltBody {
  // --- side silhouette chains --------------------------------------------------------------------
  const samples = sampleSpline(st.lower, true, 700);
  samples.pop(); // closed curve repeats the first point
  let iTip = 0;
  let iTail = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i]!.x > samples[iTip]!.x) iTip = i;
    if (samples[i]!.x < samples[iTail]!.x) iTail = i;
  }
  const n = samples.length;
  const walk = (from: number, to: number) => {
    const out: THREE.Vector3[] = [];
    for (let i = from; ; i = (i + 1) % n) {
      out.push(samples[i]!);
      if (i === to) break;
    }
    return out;
  };
  // counter-clockwise from the tip: tip → top → tail = upper chain; tail → bottom → tip = lower chain
  const upPts = walk(iTip, iTail);
  const loPts = walk(iTail, iTip);
  // enforce monotone x (drop spline overshoot backtracks)
  const monotone = (pts: THREE.Vector3[], decreasing: boolean) => {
    const out: THREE.Vector3[] = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || (decreasing ? p.x < last.x : p.x > last.x)) out.push(p);
    }
    return out;
  };
  const up = monotone(upPts, true);
  const lo = monotone(loPts, false);
  const xf = samples[iTip]!.x;
  const xr = samples[iTail]!.x;
  const tipY = samples[iTip]!.y;
  const tailY = samples[iTail]!.y;
  const upChain = Chain.from([...up, { x: xf, y: tipY }, { x: xr, y: tailY }]);
  const loChain = Chain.from([...lo, { x: xf, y: tipY }, { x: xr, y: tailY }]);
  const yUp = (x: number) => upChain.at(x);
  const yLo = (x: number) => Math.min(loChain.at(x), upChain.at(x));

  // --- plan ----------------------------------------------------------------------------------------
  const half = st.W / 2;
  const hwPlan = (x: number) => {
    const [rxF, rzF, nF] = st.planF;
    const [rxR, rzR, nR] = st.planR;
    let hw = half;
    if (x > xf - rxF) {
      const s = superTaper((x - (xf - rxF)) / rxF, nF);
      hw = half - rzF + rzF * s;
    }
    if (x < xr + rxR) {
      const s = superTaper((xr + rxR - x) / rxR, nR);
      hw = Math.min(hw, half - rzR + rzR * s);
    }
    return hw;
  };

  // --- greenhouse extents -------------------------------------------------------------------------
  const roofSamples = sampleSpline(st.roof, false, 260);
  const roofChain = Chain.from(roofSamples);
  const xg0 = Math.max(...st.roof.map((p) => p[0]));
  const xg1 = Math.min(...st.roof.map((p) => p[0]));
  const ghFactor = (x: number) =>
    smoothstep(xg1 - 0.25, xg1 + 0.02, x) *
    (1 - smoothstep(xg0 - 0.02, xg0 + 0.3, x));
  const crownAt = (x: number, h: number) => {
    const c = x > 0 ? st.crownHood : st.crownDeck;
    return c * (1 - ghFactor(x)) * Math.min(1, h / 0.25);
  };

  // --- wheels / wells --------------------------------------------------------------------------------
  const archR = st.wheelR + st.archGap;
  const zWheel = half - st.tireW / 2 - 0.03;
  const zWell = zWheel - st.tireW / 2 - 0.03;

  // --- lower-body section --------------------------------------------------------------------------
  interface Half {
    z: Float64Array;
    y: Float64Array;
    under: Uint8Array;
    /** 0..1 strength of the character-line crease at this station. */
    crease: number;
    /** Station cuts through a wheel arch (keep the lip crease). */
    arch: boolean;
  }
  const lowerHalf = (x: number): Half => {
    const z = new Float64Array(LOWER_ROWS);
    const y = new Float64Array(LOWER_ROWS);
    const under = new Uint8Array(LOWER_ROWS);
    let yb = yLo(x);
    let yt = yUp(x);
    // The loft ends are open rings: the end stations must collapse to a line or they leave a slit.
    if (x <= xr + 1e-7 || x >= xf - 1e-7) {
      yb = yt = (yb + yt) / 2;
    }
    const h = Math.max(0, yt - yb);
    const hw = hwPlan(x);
    let ya = -Infinity;
    for (const ax of [st.axleF, st.axleR]) {
      const dx = x - ax;
      if (Math.abs(dx) < archR)
        ya = Math.max(ya, st.wheelR + Math.sqrt(archR * archR - dx * dx));
    }
    const inArch = ya > yb + 1e-4;
    const yLow = inArch ? Math.max(yb, Math.min(ya, yt - 0.03)) : yb;
    const hs = Math.max(0, yt - yLow);
    const rB = Math.min(inArch ? 0.024 : st.rBot, 0.45 * hs);
    const rT = Math.min(st.rTop, 0.45 * hs);
    const cr = crownAt(x, h);
    const ym = yb + 0.42 * h;
    const hRef = Math.max(h, 0.3);
    const ySide0Est = yLow + rB;
    // character line: crisp crease (duplicated row) with the upper door leaning in above it
    const tX = clamp01((x - xr) / Math.max(1e-6, xf - xr));
    const ycRaw = st.crease[1] + (st.crease[0] - st.crease[1]) * tX;
    const ySideTopEst = yt - cr - rT;
    const room = Math.min(ycRaw - ySide0Est, ySideTopEst - ycRaw);
    // the crease lives on the flanks: fade it out before the plan-view corners of nose and tail
    const endFade =
      smoothstep(xr + st.planR[0] * 0.6, xr + st.planR[0] + 0.15, x) *
      (1 - smoothstep(xf - st.planF[0] - 0.15, xf - st.planF[0] * 0.6, x));
    const lean = st.creaseLean * smoothstep(0.03, 0.1, room) * endFade;
    const yc = Math.min(
      Math.max(ycRaw, ySide0Est),
      Math.max(ySide0Est, ySideTopEst),
    );
    const sideZ = (yy: number) =>
      hw -
      st.bulge * ((yy - ym) / hRef) ** 2 -
      (yy > yc ? lean * (yy - yc) : 0);
    const zIn = Math.max(0, Math.min(zWell, sideZ(yLow + rB) - rB - 0.01));
    let k = 0;
    const put = (zz: number, yy: number, u: boolean) => {
      z[k] = Math.max(0, zz);
      y[k] = yy;
      under[k] = u ? 1 : 0;
      k++;
    };
    // floor (side-projected UVs: it curls up into the bumper faces at the ends)
    for (let i = 0; i < 3; i++) put((zIn * i) / 3, yb, false);
    put(zIn, yb, inArch);
    put(zIn, yLow, inArch);
    const zB = sideZ(yLow + rB) - rB;
    put(zB, yLow, inArch); // well ceiling end
    put(zB, yLow, false); // duplicate row: UV seam at the rocker / arch lip
    for (const a of [-60, -30, 0]) {
      const r = THREE.MathUtils.degToRad(a);
      put(zB + rB * Math.cos(r), yLow + rB + rB * Math.sin(r), false);
    }
    // top corner centre (one refinement pass for the crown)
    let ySide1 = yt - cr - rT;
    let zc = sideZ(ySide1) - rT;
    ySide1 = yt - cr * (hw > 1e-6 ? (zc / hw) ** 2 : 0) - rT;
    ySide1 = Math.max(ySide1, yLow + rB);
    zc = sideZ(ySide1) - rT;
    const ySide0 = yLow + rB;
    const ycc = Math.min(Math.max(yc, ySide0), ySide1);
    for (const f of [1 / 3, 2 / 3]) {
      const yy = ySide0 + (ycc - ySide0) * f;
      put(sideZ(yy), yy, false);
    }
    put(sideZ(ycc), ycc, false);
    put(sideZ(ycc), ycc, false); // duplicate row: crisp character line
    for (const f of [1 / 3, 2 / 3]) {
      const yy = ycc + (ySide1 - ycc) * f;
      put(sideZ(yy), yy, false);
    }
    put(sideZ(ySide1), ySide1, false);
    for (const a of [22.5, 45, 67.5, 90]) {
      const r = THREE.MathUtils.degToRad(a);
      put(zc + rT * Math.cos(r), ySide1 + rT * Math.sin(r), false);
    }
    const yEdge = ySide1 + rT;
    for (let i = 1; i <= 5; i++) {
      const zz = zc * (1 - i / 5);
      const f = zc > 1e-6 ? (zz / zc) ** 2 : 0;
      put(zz, yEdge + (yt - yEdge) * (1 - f), false);
    }
    return { z, y, under, crease: smoothstep(0.02, 0.06, lean), arch: inArch };
  };

  // --- lower-body stations ------------------------------------------------------------------------
  const cols: number[] = [xf, xr];
  for (const p of [...up, ...lo])
    if (p.x > xf - 0.55 || p.x < xr + 0.55) cols.push(p.x);
  for (let x = xr + 0.3; x < xf - 0.3; x += 0.07) cols.push(x);
  for (const ax of [st.axleF, st.axleR]) {
    for (let i = 0; i <= 26; i++)
      cols.push(ax + archR * Math.cos((Math.PI * i) / 26));
    cols.push(ax - archR - 0.002, ax + archR + 0.002);
  }
  cols.push(xg0, xg1);
  const xsL = dedupe(cols.filter((x) => x >= xr && x <= xf));
  const halves = xsL.map((x) => lowerHalf(x));

  const lower = gridGeometry(
    xsL,
    (i) => ringFromHalf(halves[i]!),
    (i, j, ring) => {
      const x = xsL[i]!;
      const r = ring.meta[j]!;
      return r.under ? UV_UNDER : [uOf(x), vLower(ring.y[j]!)];
    },
    true,
  );
  // The character-line rows are duplicated for a crisp crease; where the crease fades out (nose,
  // tail, above the arches) blend the two normals back together so no shading seam remains.
  {
    const nor = lower.attributes.normal!;
    const R = 2 * LOWER_ROWS - 2;
    const creasePairs: [number, number][] = [
      [CREASE_ROW, CREASE_ROW + 1],
      [R - CREASE_ROW, R - CREASE_ROW - 1],
    ];
    // rocker / arch-lip UV seam rows: crisp only where a wheel arch is cut
    const lipPairs: [number, number][] = [
      [LIP_ROW, LIP_ROW + 1],
      [R - LIP_ROW, R - LIP_ROW - 1],
    ];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const m = new THREE.Vector3();
    for (let i = 0; i < xsL.length; i++) {
      for (const [pairs, f] of [
        [creasePairs, halves[i]!.crease],
        [lipPairs, halves[i]!.arch ? 1 : 0],
      ] as const) {
        if (f >= 0.999) continue;
        for (const [j0, j1] of pairs) {
          const i0 = i * R + j0;
          const i1 = i * R + j1;
          a.fromBufferAttribute(nor, i0);
          b.fromBufferAttribute(nor, i1);
          m.copy(a).add(b).normalize();
          a.lerp(m, 1 - f).normalize();
          b.lerp(m, 1 - f).normalize();
          nor.setXYZ(i0, a.x, a.y, a.z);
          nor.setXYZ(i1, b.x, b.y, b.z);
        }
      }
    }
    nor.needsUpdate = true;
  }

  // --- greenhouse ------------------------------------------------------------------------------------
  const hwMidG = half - st.shelf;
  const ghHalfWidth = (x: number) => {
    let hw = Math.min(hwPlan(x) - st.shelf, hwMidG);
    const [rxF, rzF] = st.ghPlanF;
    const [rxR, rzR] = st.ghPlanR;
    if (x > xg0 - rxF)
      hw = Math.min(
        hw,
        hwMidG - rzF + rzF * superTaper((x - (xg0 - rxF)) / rxF, 2.2),
      );
    if (x < xg1 + rxR)
      hw = Math.min(
        hw,
        hwMidG - rzR + rzR * superTaper((xg1 + rxR - x) / rxR, 2.2),
      );
    return Math.max(0.05, hw);
  };
  const ghBase = (x: number) => {
    const yt = yUp(x);
    const cr = crownAt(x, Math.max(0, yt - yLo(x)));
    const hw = hwPlan(x);
    const zb = ghHalfWidth(x);
    return yt - cr * (hw > 1e-6 ? (zb / hw) ** 2 : 0) - 0.008;
  };
  const ghTop = (x: number) => Math.max(ghBase(x), roofChain.at(x));
  const hRefG =
    Math.max(0.3, ...roofSamples.map((p) => p.y)) - ghBase((xg0 + xg1) / 2);
  const phi = Math.atan2(st.tumble, hRefG);
  const ghHalf = (x: number, forceFlat: boolean) => {
    const z = new Float64Array(GH_ROWS);
    const y = new Float64Array(GH_ROWS);
    const s = new Float64Array(GH_ROWS);
    const yB = ghBase(x);
    const h = forceFlat ? 0 : Math.max(0, ghTop(x) - yB);
    const hwB = ghHalfWidth(x);
    const zSide = (yy: number) => hwB - Math.tan(phi) * (yy - yB);
    const rc = Math.min(st.roofR, 0.4 * h);
    const cr = st.roofCrown * Math.min(1, h / 0.2);
    const yEdge = yB + h - cr;
    const Cy = yEdge - rc;
    const Sy = Math.max(yB, Cy + rc * Math.sin(phi));
    const Sz = zSide(Sy);
    const Cz = Math.max(0.02, Sz - rc * Math.cos(phi));
    let k = 0;
    const put = (zz: number, yy: number) => {
      z[k] = Math.max(0, zz);
      y[k] = yy;
      if (k > 0)
        s[k] = s[k - 1]! + Math.hypot(z[k]! - z[k - 1]!, y[k]! - y[k - 1]!);
      k++;
    };
    for (let i = 0; i < 8; i++) {
      const yy = yB + ((Sy - yB) * i) / 7;
      put(zSide(yy), yy);
    }
    for (let i = 1; i <= 5; i++) {
      const a = phi + ((Math.PI / 2 - phi) * i) / 5;
      put(Cz + rc * Math.cos(a), Cy + rc * Math.sin(a));
    }
    for (let i = 1; i <= 6; i++) {
      const zz = Cz * (1 - i / 6);
      put(zz, yEdge + cr * (1 - (zz / Cz) ** 2));
    }
    return { z, y, s };
  };
  const gcols: number[] = [xg0, xg1];
  for (const p of roofSamples)
    if (p.x > xg0 - 0.9 || p.x < xg1 + 0.9) gcols.push(p.x);
  for (let x = xg1; x < xg0; x += 0.06) gcols.push(x);
  const xsG = dedupe(gcols.filter((x) => x >= xg1 && x <= xg0));
  const gh = xsG.map((x, i) => ghHalf(x, i === 0 || i === xsG.length - 1));
  const ghColumns: GhColumn[] = xsG.map((x, i) => ({
    x,
    sSide: gh[i]!.s[7]!,
    sCorner: gh[i]!.s[12]!,
    sTop: gh[i]!.s[GH_ROWS - 1]!,
  }));
  const greenhouse = gridGeometry(
    xsG,
    (i) => ringFromHalfOpen(gh[i]!),
    (i, j, ring) => [uOf(xsG[i]!), vGreen(ring.s![j]!)],
    false,
  );

  // --- ray queries on the lower body -----------------------------------------------------------------
  const tmpZ = new Float64Array(LOWER_ROWS);
  const tmpY = new Float64Array(LOWER_ROWS);
  const inside = (p: THREE.Vector3) => {
    if (p.x >= xf || p.x <= xr) return false;
    // bracket stations
    let lo = 0;
    let hi = xsL.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xsL[m]! <= p.x) lo = m;
      else hi = m;
    }
    const t = (p.x - xsL[lo]!) / Math.max(1e-9, xsL[hi]! - xsL[lo]!);
    const a = halves[lo]!;
    const b = halves[hi]!;
    for (let k = 0; k < LOWER_ROWS; k++) {
      tmpZ[k] = a.z[k]! + (b.z[k]! - a.z[k]!) * t;
      tmpY[k] = a.y[k]! + (b.y[k]! - a.y[k]!) * t;
    }
    // point in polygon (half section closed along the centerline)
    const pz = Math.abs(p.z);
    const py = p.y;
    let c = false;
    for (let i = 0, j = LOWER_ROWS - 1; i < LOWER_ROWS; j = i++) {
      const zi = tmpZ[i]!;
      const yi = tmpY[i]!;
      const zj = tmpZ[j]!;
      const yj = tmpY[j]!;
      if (
        yi > py !== yj > py &&
        pz < ((zj - zi) * (py - yi)) / (yj - yi + 1e-12) + zi
      )
        c = !c;
    }
    return c;
  };
  const pt = new THREE.Vector3();
  const hit = (origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 1.6) => {
    const step = 0.012;
    let prev = 0;
    for (let d = 0; d <= maxDist; d += step) {
      pt.copy(origin).addScaledVector(dir, d);
      if (inside(pt)) {
        let a = prev;
        let b = d;
        for (let k = 0; k < 14; k++) {
          const m = (a + b) / 2;
          pt.copy(origin).addScaledVector(dir, m);
          if (inside(pt)) b = m;
          else a = m;
        }
        return origin.clone().addScaledVector(dir, b);
      }
      prev = d;
    }
    return null;
  };

  const decal = (spec: DecalSpec) => projectDecal(spec, hit);

  return {
    lower,
    greenhouse,
    ghColumns,
    xf,
    xr,
    yUp,
    yLo,
    hwPlan,
    ghBase,
    ghTop,
    ghHalfWidth,
    xg0,
    xg1,
    archR,
    zWheel,
    hit,
    decal,
  };
}

function dedupe(xs: number[], eps = 0.0025): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) {
    if (!out.length || x - out[out.length - 1]! > eps) out.push(x);
  }
  // keep the exact extremes
  out[0] = s[0]!;
  out[out.length - 1] = s[s.length - 1]!;
  return out;
}

interface Ring {
  z: number[];
  y: number[];
  s?: number[];
  meta: { under: boolean }[];
}

/** Closed ring: right half (floor centre → roof centre) + mirrored left half. */
function ringFromHalf(h: {
  z: Float64Array;
  y: Float64Array;
  under: Uint8Array;
}): Ring {
  const K = h.z.length;
  const z: number[] = [];
  const y: number[] = [];
  const meta: { under: boolean }[] = [];
  for (let k = 0; k < K; k++) {
    z.push(h.z[k]!);
    y.push(h.y[k]!);
    meta.push({ under: !!h.under[k] });
  }
  for (let k = K - 2; k >= 1; k--) {
    z.push(-h.z[k]!);
    y.push(h.y[k]!);
    meta.push({ under: !!h.under[k] });
  }
  return { z, y, meta };
}

/** Open ring (greenhouse): right base → roof centre → left base. */
function ringFromHalfOpen(h: {
  z: Float64Array;
  y: Float64Array;
  s: Float64Array;
}): Ring {
  const K = h.z.length;
  const z: number[] = [];
  const y: number[] = [];
  const s: number[] = [];
  const meta: { under: boolean }[] = [];
  for (let k = 0; k < K; k++) {
    z.push(h.z[k]!);
    y.push(h.y[k]!);
    s.push(h.s[k]!);
    meta.push({ under: false });
  }
  for (let k = K - 2; k >= 0; k--) {
    z.push(-h.z[k]!);
    y.push(h.y[k]!);
    s.push(h.s[k]!);
    meta.push({ under: false });
  }
  return { z, y, s, meta };
}

/**
 * Stitch rings at stations xs (ascending) into an indexed grid. Ring order must run up the right
 * side (+Z) so quads face outward.
 */
function gridGeometry(
  xs: number[],
  ringAt: (i: number) => Ring,
  uvAt: (i: number, j: number, ring: Ring) => [number, number],
  closed: boolean,
): THREE.BufferGeometry {
  const rings = xs.map((_, i) => ringAt(i));
  const R = rings[0]!.z.length;
  const pos = new Float32Array(xs.length * R * 3);
  const uv = new Float32Array(xs.length * R * 2);
  for (let i = 0; i < xs.length; i++) {
    const ring = rings[i]!;
    for (let j = 0; j < R; j++) {
      const o = i * R + j;
      pos[o * 3] = xs[i]!;
      pos[o * 3 + 1] = ring.y[j]!;
      pos[o * 3 + 2] = ring.z[j]!;
      const [u, v] = uvAt(i, j, ring);
      uv[o * 2] = u;
      uv[o * 2 + 1] = v;
    }
  }
  const idx: number[] = [];
  const J = closed ? R : R - 1;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < J; j++) {
      const j2 = (j + 1) % R;
      const a = i * R + j;
      const b = (i + 1) * R + j;
      const c = (i + 1) * R + j2;
      const d = i * R + j2;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Project a decal grid onto the body along its heading (see DecalSpec). */
function projectDecal(
  spec: DecalSpec,
  hit: (
    o: THREE.Vector3,
    d: THREE.Vector3,
    maxDist?: number,
  ) => THREE.Vector3 | null,
): THREE.BufferGeometry {
  const [nu, nv] = spec.grid ?? [18, 8];
  const dir = new THREE.Vector3(
    -Math.cos(spec.yaw),
    0,
    -Math.sin(spec.yaw),
  ).normalize();
  const upV = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, upV).normalize();
  const target = new THREE.Vector3(...spec.at);
  const [w, h] = spec.size;
  const [u0, v0, u1, v1] = spec.cell;
  const pos: number[] = [];
  const uv: number[] = [];
  const o = new THREE.Vector3();
  const back = 0.5;
  let lastHit: THREE.Vector3 | null = null;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const a = (i / nu - 0.5) * w;
      const b = (j / nv - 0.5) * h;
      o.copy(target)
        .addScaledVector(dir, -back)
        .addScaledVector(right, a)
        .addScaledVector(upV, b);
      const p = hit(o, dir, back + 0.45);
      const surf: THREE.Vector3 =
        p ?? (lastHit ? lastHit.clone() : o.clone().addScaledVector(dir, back));
      lastHit = surf.clone();
      const q = surf.addScaledVector(dir, -spec.offset);
      pos.push(q.x, q.y, q.z);
      const fu = spec.flipU ? 1 - i / nu : i / nu;
      uv.push(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * (j / nv));
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 2;
      const d = a + nu + 1;
      // viewer looks along dir; right × up faces the viewer
      idx.push(a, b, c, a, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
