/**
 * Procedural car textures:
 *  - Body atlas (per style): COLOR map + PROPS map (R = clearcoat, G = roughness, B = "paint" mask —
 *    metalness factor and paint-color tint; 0 = glass / black trim / chrome keep their own color).
 *    Upper half: lower body side projection (door cuts, handles, fuel door, cladding, taxi checker);
 *    lower half: greenhouse (windshield with black frit, side glass with seals, pillars, belt molding,
 *    rear glass, optional panoramic roof).
 *  - Lamp atlas (shared): unlit look, emission color, and a function-ID map (nearest filtered):
 *    0 none · 0.2 DRL · 0.4 low beam / taxi sign · 0.6 turn · 0.8 tail+brake · 1.0 brake only.
 *  - Fascia decal atlas (shared): grille, lower intake, rear valance/diffuser, plates, splitter,
 *    taxi checker band.
 */
import * as THREE from 'three';
import type { BodyStyle, BuiltBody } from './carBody';
import { ATLAS, pxX, pyGreen, pyLower } from './carBody';
import { canvasTex, makeCanvas, sharedTex } from './shared';

// ---------------------------------------------------------------------------
// Body atlas
// ---------------------------------------------------------------------------

type Mat = 'paint' | 'glass' | 'gloss' | 'matte' | 'chrome' | 'seam' | 'handle';

/** Albedo per material class (paint = white so the material color shows through). */
const ALBEDO: Record<Mat, string> = {
  paint: '#ffffff',
  glass: '#0a0f13',
  gloss: '#0b0c0d',
  matte: '#141516',
  chrome: '#c9ced2',
  seam: '#2a2a2a',
  handle: '#8a8a8a',
};
/** Props (R clearcoat, G roughness, B paint mask). */
const PROPS: Record<Mat, string> = {
  paint: 'rgb(255,84,255)',
  glass: 'rgb(70,12,0)',
  gloss: 'rgb(200,60,0)',
  matte: 'rgb(0,205,0)',
  chrome: 'rgb(255,36,0)',
  seam: 'rgb(255,84,255)',
  handle: 'rgb(255,70,255)',
};

interface Painter {
  ctx: CanvasRenderingContext2D;
  /** Scale from atlas px to canvas px. */
  k: number;
  fill: (m: Mat) => void;
  stroke: (m: Mat, width: number) => void;
  albedo: boolean;
}

export interface BodyAtlas {
  color: THREE.CanvasTexture;
  props: THREE.CanvasTexture;
}

export function bodyAtlas(key: string, st: BodyStyle, body: BuiltBody, taxi: boolean): BodyAtlas {
  const color = sharedTex(`car:atlas:${key}:color`, () => drawBody(st, body, taxi, true));
  const props = sharedTex(`car:atlas:${key}:props`, () => drawBody(st, body, taxi, false));
  return { color, props };
}

function drawBody(st: BodyStyle, body: BuiltBody, taxi: boolean, albedo: boolean): THREE.CanvasTexture {
  const k = albedo ? 1 : 0.5;
  const [c, ctx] = makeCanvas(ATLAS.W * k, ATLAS.H * k);
  const pal = albedo ? ALBEDO : PROPS;
  const P: Painter = {
    ctx,
    k,
    albedo,
    fill: (m) => (ctx.fillStyle = pal[m]),
    stroke: (m, w) => {
      ctx.strokeStyle = pal[m];
      ctx.lineWidth = w * k;
    },
  };
  ctx.save();
  ctx.scale(k, k);
  // base: paint everywhere
  P.fill('paint');
  ctx.fillRect(0, 0, ATLAS.W, ATLAS.H);
  drawLowerBody(P, st, body, taxi);
  drawGreenhouse(P, st, body);
  ctx.restore();
  const t = canvasTex(c, { aniso: 8 });
  if (!albedo) t.colorSpace = THREE.NoColorSpace;
  return t;
}

const X = (x: number) => pxX(x);
const YL = (y: number) => pyLower(y);
const PX_PER_M = ATLAS.W / (ATLAS.X1 - ATLAS.X0);

function drawLowerBody(P: Painter, st: BodyStyle, body: BuiltBody, taxi: boolean): void {
  const { ctx } = P;
  const yb = body.yLo((st.axleF + st.axleR) / 2);
  // under / wheel-well region (matte black) up to just above the sill line (the floor maps here)
  P.fill('matte');
  ctx.fillRect(0, YL(yb + 0.012), ATLAS.W, YL(0) - YL(yb + 0.012));
  const belt = body.yUp((st.axleF + st.axleR) / 2);
  // soft ambient occlusion toward the sill (albedo only)
  if (P.albedo) {
    const g = ctx.createLinearGradient(0, YL(yb + 0.2), 0, YL(yb));
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(X(body.xr), YL(yb + 0.2), X(body.xf) - X(body.xr), YL(yb) - YL(yb + 0.2));
  }
  // cladding (SUV): black lower door band + arch flares
  if (st.cladding) {
    P.fill('matte');
    ctx.fillRect(X(st.axleR), YL(yb + 0.13), X(st.axleF) - X(st.axleR), YL(yb - 0.05) - YL(yb + 0.13));
    for (const ax of [st.axleF, st.axleR]) {
      ctx.beginPath();
      ctx.arc(X(ax), YL(st.wheelR), (body.archR + 0.065) * PX_PER_M, Math.PI, 0);
      ctx.arc(X(ax), YL(st.wheelR), (body.archR - 0.01) * PX_PER_M, 0, Math.PI, true);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(X(ax) - (body.archR + 0.065) * PX_PER_M, YL(st.wheelR), (body.archR + 0.065) * 2 * PX_PER_M, YL(yb - 0.05) - YL(st.wheelR));
    }
    // front & rear bumper lower cladding
    ctx.fillRect(X(body.xr), YL(yb + 0.16), X(st.axleR - body.archR) - X(body.xr), YL(0.1) - YL(yb + 0.16));
    ctx.fillRect(X(st.axleF + body.archR), YL(yb + 0.14), X(body.xf) - X(st.axleF + body.archR), YL(0.1) - YL(yb + 0.14));
  }
  // taxi checker band
  if (taxi) {
    const y0 = belt - 0.3;
    const s = 0.045 * PX_PER_M;
    for (let x = X(body.xr + 0.4), i = 0; x < X(body.xf - 0.55); x += s, i++) {
      for (let r = 0; r < 2; r++) {
        if ((i + r) % 2) continue;
        P.fill(P.albedo ? 'gloss' : 'paint');
        ctx.fillRect(x, YL(y0) - (r + 1) * s, s, s);
      }
    }
  }
  // door cut lines (dark seams with a light lip)
  const top = belt - 0.012;
  const bot = yb + 0.05;
  const [s0, s1, s2] = st.seams;
  const archFrontR = st.axleR + body.archR + 0.04;
  const seam = () => {
    ctx.beginPath();
    ctx.moveTo(X(s0), YL(top));
    ctx.lineTo(X(s0 + 0.02), YL(bot));
    ctx.moveTo(X(s1), YL(top));
    ctx.lineTo(X(s1), YL(bot));
    // rear door edge wraps in front of the rear arch
    ctx.moveTo(X(s2), YL(top));
    ctx.lineTo(X(s2 + 0.03), YL(st.wheelR + body.archR * 0.75));
    ctx.quadraticCurveTo(X(archFrontR), YL(st.wheelR + body.archR * 0.35), X(archFrontR), YL(bot));
    ctx.moveTo(X(s0 + 0.02), YL(bot));
    ctx.lineTo(X(archFrontR), YL(bot));
    ctx.stroke();
  };
  P.stroke('seam', 3);
  seam();
  if (P.albedo) {
    ctx.save();
    ctx.translate(-3, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    seam();
    ctx.restore();
  }
  // trunk-lid / hatch shut line on the deck (sedan) — transverse line on the top surface
  if (st.base === 'sedan') {
    const xt = body.xg1 - 0.04;
    const yt = body.yUp(xt);
    P.fill('seam');
    ctx.fillRect(X(xt) - 1.5, YL(yt + 0.05), 3, YL(yt - 0.03) - YL(yt + 0.05));
  }
  // door handles (flush pull handles with a shadowed recess)
  for (const hx of st.handles) {
    const hy = belt - st.handleDrop;
    P.fill('handle');
    ctx.beginPath();
    ctx.roundRect(X(hx) - 0.075 * PX_PER_M, YL(hy) - 0.017 * PX_PER_M, 0.15 * PX_PER_M, 0.034 * PX_PER_M, 0.017 * PX_PER_M);
    ctx.fill();
    if (P.albedo) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(X(hx) - 0.065 * PX_PER_M, YL(hy) + 0.004 * PX_PER_M, 0.13 * PX_PER_M, 0.008 * PX_PER_M);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(X(hx) - 0.06 * PX_PER_M, YL(hy) - 0.013 * PX_PER_M, 0.12 * PX_PER_M, 2);
    }
  }
  // fuel door
  P.stroke('seam', 2.5);
  ctx.beginPath();
  ctx.roundRect(X(st.axleR - 0.5) - 0.07 * PX_PER_M, YL(belt - 0.13) - 0.06 * PX_PER_M, 0.14 * PX_PER_M, 0.12 * PX_PER_M, 0.025 * PX_PER_M);
  ctx.stroke();
}

function drawGreenhouse(P: Painter, st: BodyStyle, body: BuiltBody): void {
  const { ctx } = P;
  const cols = body.ghColumns;
  const YG = (s: number) => pyGreen(s);
  const colAt = (x: number) => {
    let best = cols[0]!;
    for (const c of cols) if (Math.abs(c.x - x) < Math.abs(best.x - x)) best = c;
    return best;
  };
  const interp = (x: number, f: (c: (typeof cols)[number]) => number) => {
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i]!;
      const b = cols[i + 1]!;
      if (x >= a.x && x <= b.x) {
        const t = (x - a.x) / Math.max(1e-6, b.x - a.x);
        return f(a) + (f(b) - f(a)) * t;
      }
    }
    return f(colAt(x));
  };
  /** Filled region between two s-curves over [x0, x1]. */
  const band = (x0: number, x1: number, sLo: (x: number) => number, sHi: (x: number) => number, m: Mat, round = 0) => {
    const xs: number[] = [];
    for (const c of cols) if (c.x > x0 && c.x < x1) xs.push(c.x);
    xs.unshift(x0);
    xs.push(x1);
    const pts: [number, number][] = [];
    for (const x of xs) pts.push([X(x), YG(Math.max(0, sHi(x)))]);
    for (let i = xs.length - 1; i >= 0; i--) pts.push([X(xs[i]!), YG(Math.max(0, Math.min(sHi(xs[i]!), sLo(xs[i]!))))]);
    P.fill(m);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    if (round > 0) {
      ctx.lineJoin = 'round';
      P.stroke(m, round);
      ctx.stroke();
    }
  };
  const sSide = (x: number) => interp(x, (c) => c.sSide);
  const sCorner = (x: number) => interp(x, (c) => c.sCorner);
  const sTop = (x: number) => interp(x, (c) => c.sTop);
  const xg0 = body.xg0;
  const xg1 = body.xg1;

  // belt molding (bright strip at the base of the glass) along the whole greenhouse
  band(xg1 + 0.02, xg0 - 0.02, () => 0.008, () => 0.02, 'chrome');
  // windshield: black frit border, then glass
  band(st.xWsTop - 0.02, xg0, (x) => sCorner(x), (x) => sTop(x) + 0.05, 'gloss');
  band(st.xWsTop + 0.04, xg0 - 0.035, (x) => sCorner(x) + 0.03, (x) => sTop(x) + 0.05, 'glass');
  // rear glass: frit border then glass
  band(xg1, st.xRoofRear, (x) => sCorner(x), (x) => sTop(x) + 0.05, 'gloss');
  band(xg1 + 0.03, st.xRoofRear - 0.04, (x) => sCorner(x) + 0.03, (x) => sTop(x) + 0.05, 'glass');
  // gloss-black pillars
  for (const [x0, x1] of st.blackPillars) band(x0, x1, () => 0.02, (x) => sSide(x) - 0.012, 'gloss');
  // side windows: seal border then glass (rounded corners)
  for (const w of st.windows) {
    const rakeR = w.rakeRear ?? 0;
    const rakeF = w.rakeFront ?? 0;
    // window region: bottom at the belt molding, top just below the roof rail; raked edges
    const topS = (x: number) => sSide(x) - 0.018;
    const poly = (shrink: number) => {
      const xs: number[] = [];
      const x0 = w.x0 + shrink;
      const x1 = w.x1 - shrink;
      for (const c of cols) if (c.x > x0 && c.x < x1) xs.push(c.x);
      xs.unshift(x0);
      xs.push(x1);
      const sBot = 0.028 + shrink;
      const pts: [number, number][] = [];
      // top edge (with rake: the top ends are pulled inward)
      for (const x of xs) {
        const s = Math.max(sBot, topS(x) - shrink);
        const t = (s - sBot) / Math.max(0.05, topS((x0 + x1) / 2) - sBot);
        const xl = x0 + rakeR * t;
        const xh = x1 - rakeF * t;
        pts.push([X(Math.min(Math.max(x, xl), xh)), YG(s)]);
      }
      pts.push([X(x1), YG(sBot)]);
      pts.push([X(x0), YG(sBot)]);
      return pts;
    };
    const draw = (pts: [number, number][], m: Mat, r: number) => {
      P.fill(m);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.lineJoin = 'round';
      P.stroke(m, r);
      ctx.stroke();
    };
    draw(poly(0), 'gloss', 10);
    draw(poly(0.016), 'glass', 14);
  }
  // panoramic roof (SUV)
  if (st.base === 'suv') {
    band(st.xWsTop - 0.25, st.xRoofRear + 0.55, (x) => sCorner(x) + 0.16, (x) => sTop(x) + 0.05, 'glass', 12);
  }
}

// ---------------------------------------------------------------------------
// Lamp atlas
// ---------------------------------------------------------------------------

export const LAMP_CELLS = {
  head: [0, 0.5, 0.5, 1] as [number, number, number, number],
  tail: [0.5, 0.5, 1, 1] as [number, number, number, number],
  taxi: [0, 0.25, 0.25, 0.5] as [number, number, number, number],
  brake3: [0.25, 0.4375, 0.5, 0.5] as [number, number, number, number],
  repeater: [0.25, 0.375, 0.375, 0.4375] as [number, number, number, number],
  reflector: [0.375, 0.375, 0.5, 0.4375] as [number, number, number, number],
  /** Plain dark texel (lamp housings, sign sides). */
  dark: [0.55, 0.3, 0.6, 0.35] as [number, number, number, number],
} as const;

export interface LampAtlas {
  base: THREE.CanvasTexture;
  emit: THREE.CanvasTexture;
  id: THREE.CanvasTexture;
}

type LampLayer = 'base' | 'emit' | 'id';

/** Function IDs (R channel of the id map). */
const ID = { none: 0, drl: 51, head: 102, turn: 153, tail: 204, brake: 255 };

export function lampAtlas(): LampAtlas {
  const base = sharedTex('car:lamps:base', () => drawLamps('base'));
  const emit = sharedTex('car:lamps:emit', () => drawLamps('emit'));
  const id = sharedTex('car:lamps:id', () => {
    const t = drawLamps('id');
    t.colorSpace = THREE.NoColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  });
  return { base, emit, id };
}

function drawLamps(layer: LampLayer): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  const idc = (v: number) => `rgb(${v},${v},${v})`;
  // dark plain texel region
  ctx.fillStyle = layer === 'base' ? '#15171a' : layer === 'emit' ? '#000' : idc(ID.none);
  ctx.fillRect(0.5 * W, 0.6 * H, 0.2 * W, 0.2 * H);
  drawHeadlamp(ctx, 0, 0, 512, 256, layer, idc);
  drawTaillamp(ctx, 512, 0, 512, 256, layer, idc);
  drawTaxiSign(ctx, 0, 256, 256, 128, layer, idc);
  // third brake light
  box(ctx, 256, 256, 256, 64, layer === 'base' ? '#3a0a0c' : layer === 'emit' ? '#ff1a10' : idc(ID.brake), 10);
  if (layer === 'base') {
    ctx.fillStyle = 'rgba(255,90,90,0.35)';
    for (let x = 270; x < 500; x += 12) ctx.fillRect(x, 276, 6, 24);
  }
  // mirror repeater
  box(ctx, 256, 320, 128, 64, layer === 'base' ? '#8a5a1c' : layer === 'emit' ? '#ff9a10' : idc(ID.turn), 16);
  // rear reflector (never lit)
  box(ctx, 384, 320, 128, 64, layer === 'base' ? '#7a0c10' : '#000', 10);
  if (layer === 'id') {
    ctx.fillStyle = idc(ID.none);
    ctx.fillRect(384, 320, 128, 64);
  }
  const t = canvasTex(c, { aniso: 8 });
  return t;
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, r: number): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, w - 4, h - 4, r);
  ctx.fill();
}

/**
 * Headlamp (right lamp seen from the front; left edge = outboard end that wraps around the corner):
 * slim angular smoked housing, two projector modules, chrome reflector, DRL light guide along the top
 * edge + down the inner end, amber turn segment at the outboard end.
 */
function drawHeadlamp(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, layer: LampLayer, idc: (v: number) => string): void {
  ctx.save();
  ctx.translate(ox, oy);
  const P = (u: number, v: number): [number, number] => [u * w, v * h];
  const outline: [number, number][] = [P(0.02, 0.1), P(0.55, 0.2), P(0.97, 0.36), P(0.99, 0.55), P(0.9, 0.8), P(0.5, 0.86), P(0.06, 0.92), P(0.01, 0.55)];
  const path = () => {
    ctx.beginPath();
    outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  if (layer === 'base') {
    path();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a2e33');
    g.addColorStop(0.5, '#15181b');
    g.addColorStop(1, '#23272b');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#15181b';
    ctx.stroke();
    ctx.save();
    path();
    ctx.clip();
    // chrome reflector sweep behind the projectors
    const rg = ctx.createLinearGradient(0.3 * w, 0, 0.95 * w, 0);
    rg.addColorStop(0, 'rgba(210,216,222,0.0)');
    rg.addColorStop(0.3, 'rgba(210,216,222,0.55)');
    rg.addColorStop(0.7, 'rgba(120,128,136,0.35)');
    rg.addColorStop(1, 'rgba(210,216,222,0.5)');
    ctx.fillStyle = rg;
    ctx.fillRect(0.28 * w, 0.3 * h, 0.7 * w, 0.5 * h);
    // projector modules
    for (const u of [0.5, 0.74]) {
      const [cx, cy] = P(u, 0.56);
      const r = 0.2 * h;
      const cg = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.35);
      cg.addColorStop(0, '#e9edf1');
      cg.addColorStop(0.55, '#8d959d');
      cg.addColorStop(1, 'rgba(40,44,48,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0d10';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,220,255,0.55)';
      ctx.beginPath();
      ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // turn segment (unlit amber-chrome) at the outboard end
    ctx.fillStyle = '#8a6a36';
    ctx.fillRect(0.02 * w, 0.52 * h, 0.2 * w, 0.34 * h);
    ctx.fillStyle = 'rgba(255,220,160,0.25)';
    for (let x = 0.03 * w; x < 0.22 * w; x += 10) ctx.fillRect(x, 0.54 * h, 4, 0.3 * h);
    ctx.restore();
  } else {
    // alpha shape only matters for the base (alpha test); emit/id: fill black/none first
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = layer === 'emit' ? '#000' : idc(ID.none);
    ctx.fillRect(0, 0, w, h);
    // low-beam projectors + reflector
    ctx.fillStyle = layer === 'emit' ? '#f4f7ff' : idc(ID.head);
    for (const u of [0.5, 0.74]) {
      const [cx, cy] = P(u, 0.56);
      ctx.beginPath();
      ctx.arc(cx, cy, 0.2 * h * 1.05, 0, Math.PI * 2);
      ctx.fill();
    }
    // turn
    ctx.fillStyle = layer === 'emit' ? '#ff9a1a' : idc(ID.turn);
    ctx.fillRect(0.02 * w, 0.52 * h, 0.2 * w, 0.34 * h);
    ctx.restore();
  }
  // DRL light guide: along the top edge and down the inboard end
  ctx.beginPath();
  ctx.moveTo(...P(0.05, 0.2));
  ctx.lineTo(...P(0.55, 0.29));
  ctx.lineTo(...P(0.93, 0.42));
  ctx.lineTo(...P(0.9, 0.7));
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.075 * h;
  ctx.strokeStyle = layer === 'base' ? '#dfe5ec' : layer === 'emit' ? '#f2f6ff' : idc(ID.drl);
  ctx.stroke();
  ctx.restore();
}

/**
 * Tail lamp (right lamp seen from behind; left edge = inboard end, right edge = outboard end that
 * wraps around the rear corner): deep red faceted lens, LED light bar + brake zone, clear reverse
 * segment, amber turn segment.
 */
function drawTaillamp(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, layer: LampLayer, idc: (v: number) => string): void {
  ctx.save();
  ctx.translate(ox, oy);
  const P = (u: number, v: number): [number, number] => [u * w, v * h];
  const outline: [number, number][] = [P(0.01, 0.28), P(0.6, 0.14), P(0.97, 0.12), P(0.995, 0.4), P(0.97, 0.88), P(0.55, 0.84), P(0.03, 0.76)];
  const path = () => {
    ctx.beginPath();
    outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  if (layer === 'base') {
    path();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6e0b10');
    g.addColorStop(0.5, '#420509');
    g.addColorStop(1, '#5c080d');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#1a0507';
    ctx.stroke();
    ctx.save();
    path();
    ctx.clip();
    // faceted optic stripes
    ctx.fillStyle = 'rgba(255,120,120,0.12)';
    for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 7, h);
    // clear reverse segment (inboard, lower)
    ctx.fillStyle = '#b9bfc5';
    ctx.fillRect(...P(0.05, 0.55), 0.22 * w, 0.2 * h);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let x = 0.06 * w; x < 0.27 * w; x += 12) ctx.fillRect(x, 0.57 * h, 5, 0.16 * h);
    // amber turn segment
    ctx.fillStyle = '#7a4a14';
    ctx.fillRect(...P(0.3, 0.58), 0.18 * w, 0.16 * h);
    ctx.restore();
  } else {
    ctx.save();
    path();
    ctx.clip();
    ctx.fillStyle = layer === 'emit' ? '#ff1208' : idc(ID.tail);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = layer === 'emit' ? '#000' : idc(ID.none);
    ctx.fillRect(...P(0.05, 0.55), 0.22 * w, 0.2 * h);
    ctx.fillStyle = layer === 'emit' ? '#ff8a10' : idc(ID.turn);
    ctx.fillRect(...P(0.3, 0.58), 0.18 * w, 0.16 * h);
    ctx.restore();
  }
  // LED light bar along the top
  ctx.beginPath();
  ctx.moveTo(...P(0.04, 0.34));
  ctx.lineTo(...P(0.6, 0.24));
  ctx.lineTo(...P(0.95, 0.22));
  ctx.lineTo(...P(0.95, 0.7));
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.08 * h;
  ctx.strokeStyle = layer === 'base' ? '#ff5a5a' : layer === 'emit' ? '#ff3020' : idc(ID.tail);
  ctx.stroke();
  ctx.restore();
}

function drawTaxiSign(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, layer: LampLayer, idc: (v: number) => string): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = layer === 'base' ? '#f2c230' : layer === 'emit' ? '#ffd24a' : idc(ID.head);
  ctx.fillRect(0, 0, w, h);
  if (layer !== 'id') {
    ctx.fillStyle = layer === 'base' ? '#15130c' : '#000';
    ctx.font = `bold ${Math.round(h * 0.62)}px "Arial Black", Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', w / 2, h / 2 + 3);
    ctx.fillStyle = layer === 'base' ? '#2a2a2a' : '#000';
    ctx.fillRect(0, 0, w, 6);
    ctx.fillRect(0, h - 6, w, 6);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Fascia decal atlas
// ---------------------------------------------------------------------------

export const DECAL_CELLS = {
  grille: [0, 0.5, 0.5, 1] as [number, number, number, number],
  intake: [0.5, 0.75, 1, 1] as [number, number, number, number],
  valance: [0.5, 0.5, 1, 0.75] as [number, number, number, number],
  plate: [0, 0.25, 0.25, 0.5] as [number, number, number, number],
  splitter: [0.25, 0.375, 0.75, 0.5] as [number, number, number, number],
  checker: [0.25, 0.25, 0.75, 0.375] as [number, number, number, number],
} as const;

export function decalAtlas(): THREE.CanvasTexture {
  return sharedTex('car:decals', () => {
    const W = 1024;
    const H = 512;
    const [c, ctx] = makeCanvas(W, H);
    ctx.clearRect(0, 0, W, H);
    drawGrille(ctx, 0, 0, 512, 256);
    drawIntake(ctx, 512, 0, 512, 128);
    drawValance(ctx, 512, 128, 512, 128);
    drawPlate(ctx, 0, 256, 256, 128);
    // splitter: satin black lip
    ctx.fillStyle = '#121314';
    ctx.beginPath();
    ctx.roundRect(256 + 4, 256 + 8, 512 - 8, 64 - 16, 24);
    ctx.fill();
    // taxi checker band (2 rows)
    for (let i = 0; i < 32; i++)
      for (let r = 0; r < 2; r++) {
        ctx.fillStyle = (i + r) % 2 ? '#111' : '#f2c230';
        ctx.fillRect(256 + i * 16, 320 + r * 32, 16, 32);
      }
    return canvasTex(c, { aniso: 8 });
  });
}

function hexMesh(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, cell: number): void {
  ctx.strokeStyle = '#3a3e43';
  ctx.lineWidth = 2;
  const dy = cell * 0.866;
  for (let row = 0, y = y0; y < y0 + h + dy; row++, y += dy) {
    for (let x = x0 + (row % 2 ? cell / 2 : 0); x < x0 + w + cell; x += cell) {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = x + (cell / 2) * 0.95 * Math.cos(a);
        const py = y + (cell / 2) * 0.95 * Math.sin(a);
        if (k) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawGrille(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(ox, oy);
  // trapezoid grille with rounded corners, wider at the bottom
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(0.12 * w, 0.08 * h);
    ctx.lineTo(0.88 * w, 0.08 * h);
    ctx.quadraticCurveTo(0.97 * w, 0.1 * h, 0.98 * w, 0.4 * h);
    ctx.lineTo(0.94 * w, 0.84 * h);
    ctx.quadraticCurveTo(0.92 * w, 0.94 * h, 0.8 * w, 0.94 * h);
    ctx.lineTo(0.2 * w, 0.94 * h);
    ctx.quadraticCurveTo(0.08 * w, 0.94 * h, 0.06 * w, 0.84 * h);
    ctx.lineTo(0.02 * w, 0.4 * h);
    ctx.quadraticCurveTo(0.03 * w, 0.1 * h, 0.12 * w, 0.08 * h);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = '#050607';
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  // inner shadow for depth
  const g = ctx.createLinearGradient(0, 0.08 * h, 0, 0.94 * h);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.25, 'rgba(0,0,0,0)');
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, w, h);
  hexMesh(ctx, 0, 0.1 * h, w, h, 22);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // radar/camera plate (blank badge area, no logos)
  ctx.fillStyle = '#1a1c1f';
  ctx.beginPath();
  ctx.roundRect(0.44 * w, 0.4 * h, 0.12 * w, 0.2 * h, 10);
  ctx.fill();
  ctx.restore();
  // gloss-black surround with a satin-chrome top accent
  path();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#101113';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.14 * w, 0.11 * h);
  ctx.lineTo(0.86 * w, 0.11 * h);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#aeb4ba';
  ctx.stroke();
  ctx.restore();
}

function drawIntake(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = '#0a0b0c';
  ctx.beginPath();
  ctx.roundRect(0.03 * w, 0.15 * h, 0.94 * w, 0.7 * h, 0.3 * h);
  ctx.fill();
  ctx.save();
  ctx.clip();
  hexMesh(ctx, 0, 0, w, h, 18);
  ctx.restore();
  // fog/corner lamp pods (dark, unlit)
  for (const u of [0.1, 0.9]) {
    ctx.fillStyle = '#1b1e22';
    ctx.beginPath();
    ctx.ellipse(u * w, 0.5 * h, 0.07 * w, 0.28 * h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa2aa';
    ctx.beginPath();
    ctx.ellipse(u * w, 0.5 * h, 0.035 * w, 0.14 * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawValance(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = '#111214';
  ctx.beginPath();
  ctx.roundRect(0.02 * w, 0.2 * h, 0.96 * w, 0.62 * h, 0.2 * h);
  ctx.fill();
  // diffuser fins
  ctx.fillStyle = '#1e2023';
  for (let u = 0.3; u <= 0.7; u += 0.05) ctx.fillRect(u * w - 3, 0.3 * h, 6, 0.5 * h);
  // rear reflectors near the ends
  for (const u of [0.07, 0.93]) {
    ctx.fillStyle = '#8a0a10';
    ctx.beginPath();
    ctx.roundRect(u * w - 0.04 * w, 0.32 * h, 0.08 * w, 0.18 * h, 6);
    ctx.fill();
  }
  ctx.restore();
}

function drawPlate(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = '#101010';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 10);
  ctx.fill();
  ctx.fillStyle = '#f4f3ec';
  ctx.beginPath();
  ctx.roundRect(6, 6, w - 12, h - 12, 8);
  ctx.fill();
  ctx.strokeStyle = '#1d3b7a';
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.fillStyle = '#1d3b7a';
  ctx.font = 'bold 18px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PLC WORLD', w / 2, 28);
  ctx.fillStyle = '#16213a';
  ctx.font = 'bold 54px "Arial Narrow", Arial, Helvetica, sans-serif';
  ctx.fillText('L5X 380', w / 2, 78);
  ctx.restore();
}
