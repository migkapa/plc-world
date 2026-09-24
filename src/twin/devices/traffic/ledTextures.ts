/**
 * Procedural LED textures: signal lens dot grids, pedestrian-signal symbols (upraised hand, walking
 * person) drawn as LED dot matrices, 7-segment-style countdown digits, and a 5×7 dot-matrix font for
 * LED message signs. All are grayscale so one texture serves every lamp color (material color /
 * emissive color tint them).
 */
import * as THREE from 'three';
import { canvasTex, makeCanvas, sharedTex } from './shared';

// ---------------------------------------------------------------------------
// 12" / 8" vehicle signal lens (LED module behind a Fresnel-ringed cover)
// ---------------------------------------------------------------------------

const LENS_PX = 512;

/** Hex-packed LED positions inside a unit circle (canvas px). */
function lensDots(px: number, pitch: number, margin: number): [number, number][] {
  const out: [number, number][] = [];
  const c = px / 2;
  const R = px / 2 - margin;
  const rowH = pitch * Math.sin(Math.PI / 3);
  for (let row = -Math.ceil(R / rowH); row <= Math.ceil(R / rowH); row++) {
    const y = row * rowH;
    const off = (row & 1) * (pitch / 2);
    for (let x = -R - pitch; x <= R + pitch; x += pitch) {
      const xx = x + off;
      if (xx * xx + y * y <= R * R) out.push([c + xx, c + y]);
    }
  }
  return out;
}

/**
 * Unlit look of an LED signal lens (multiply with the colored lens tint): fresnel rings over a dotted
 * LED array with a darker rim.
 */
export function lensBaseTexture(): THREE.CanvasTexture {
  return sharedTex('led:lensBase', () => {
    const S = LENS_PX;
    const [c, ctx] = makeCanvas(S, S);
    const g = ctx.createRadialGradient(S / 2, S * 0.42, S * 0.05, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#d8d8d8');
    g.addColorStop(0.75, '#a8a8a8');
    g.addColorStop(1, '#5a5a5a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // LED cups: dark ring + bright dome center
    for (const [x, y] of lensDots(S, 30, 22)) {
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(x - 2, y - 2.5, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fresnel rings on the outer cover
    for (let r = 14; r < S / 2; r += 13) {
      ctx.strokeStyle = r % 26 === 1 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // rim gasket
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 5, 0, Math.PI * 2);
    ctx.stroke();
    return canvasTex(c, { aniso: 8 });
  });
}

/** Emission pattern of a lit LED lens: bright LED dots with halos over a softly glowing diffuser. */
export function lensEmissiveTexture(): THREE.CanvasTexture {
  return sharedTex('led:lensEmissive', () => {
    const S = LENS_PX;
    const [c, ctx] = makeCanvas(S, S);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2 - 12);
    g.addColorStop(0, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.30)');
    g.addColorStop(1, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, y] of lensDots(S, 30, 22)) {
      const d = ctx.createRadialGradient(x, y, 0, x, y, 12);
      d.addColorStop(0, 'rgba(255,255,255,1)');
      d.addColorStop(0.45, 'rgba(255,255,255,0.85)');
      d.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = d;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvasTex(c, { aniso: 8 });
  });
}

// ---------------------------------------------------------------------------
// Pedestrian symbols (MUTCD upraised hand / walking person) as LED dot matrices
// ---------------------------------------------------------------------------

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** Symbols are designed in a 60 × 100 unit box (y down) and scaled to fill the target height. */
function fitBox(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.translate(w / 2, h / 2);
  const s = Math.min(w / 60, h / 100);
  ctx.scale(s, s);
}

/**
 * MUTCD upraised hand (Portland orange): solid palm, four fingers together (hairline gaps), thumb
 * out to the left, short wrist.
 */
const drawHand: Draw = (ctx, w, h) => {
  ctx.save();
  fitBox(ctx, w, h);
  ctx.fillStyle = '#fff';
  // palm + wrist
  ctx.beginPath();
  ctx.moveTo(-21, -8);
  ctx.lineTo(21, -8);
  ctx.lineTo(21, 24);
  ctx.quadraticCurveTo(20, 34, 12, 38);
  ctx.lineTo(12, 49);
  ctx.lineTo(-14, 49);
  ctx.lineTo(-14, 38);
  ctx.quadraticCurveTo(-21, 33, -21, 22);
  ctx.closePath();
  ctx.fill();
  // fingers (index..little), rounded tips, tiny gaps
  const fingers: [number, number][] = [
    [-15.6, -42],
    [-5.2, -48],
    [5.2, -46],
    [15.6, -38],
  ];
  for (const [x, top] of fingers) {
    ctx.beginPath();
    ctx.roundRect(x - 4.9, top, 9.8, -top + 2, 4.9);
    ctx.fill();
  }
  // thumb: angled up-left from the lower palm
  ctx.save();
  ctx.translate(-19, 20);
  ctx.rotate(-0.62);
  ctx.beginPath();
  ctx.roundRect(-5.2, -31, 10.4, 36, 5.2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
};

/** MUTCD walking person (lunar white) in profile, striding to the right: solid head, torso & limbs. */
const drawPerson: Draw = (ctx, w, h) => {
  ctx.save();
  fitBox(ctx, w, h);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // head (overlaps the neck: no gap)
  ctx.beginPath();
  ctx.arc(6, -40, 8.6, 0, Math.PI * 2);
  ctx.fill();
  // torso: thick tapered body leaning forward
  ctx.beginPath();
  ctx.moveTo(-2, -32);
  ctx.quadraticCurveTo(8, -35, 13, -29);
  ctx.lineTo(8, 2);
  ctx.lineTo(-6, 2);
  ctx.closePath();
  ctx.fill();
  // arms
  ctx.lineWidth = 8.5;
  ctx.beginPath();
  ctx.moveTo(8, -26);
  ctx.lineTo(16, -12);
  ctx.lineTo(23, -2);
  ctx.moveTo(1, -26);
  ctx.lineTo(-9, -12);
  ctx.lineTo(-17, -1);
  ctx.stroke();
  // legs in stride
  ctx.lineWidth = 11.5;
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(13, 21);
  ctx.lineTo(16, 42);
  ctx.moveTo(-2, 0);
  ctx.lineTo(-10, 20);
  ctx.lineTo(-21, 38);
  ctx.stroke();
  // feet
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(14, 45);
  ctx.lineTo(25, 45);
  ctx.moveTo(-21, 40);
  ctx.lineTo(-28, 36);
  ctx.stroke();
  ctx.restore();
};

/** Rasterize a symbol (fitted into w × h px) and return the LED dot centers that fall inside it. */
function symbolDots(draw: Draw, w: number, h: number, pitch: number): [number, number][] {
  const [, mctx] = makeCanvas(w, h);
  draw(mctx, w, h);
  const data = mctx.getImageData(0, 0, w, h).data;
  const out: [number, number][] = [];
  const nx = Math.floor(w / pitch);
  const ny = Math.floor(h / pitch);
  const ox = (w - (nx - 1) * pitch) / 2;
  const oy = (h - (ny - 1) * pitch) / 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ox + i * pitch;
      const y = oy + j * pitch;
      const a = data[(Math.floor(y) * w + Math.floor(x)) * 4 + 3]!;
      if (a >= 110) out.push([x, y]);
    }
  }
  return out;
}

/** One LED: lit = colored core with a soft halo; unlit = dark cup with a tiny specular dot. */
function drawLed(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string | null): void {
  if (color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.75);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, color);
    g.addColorStop(0.6, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.75, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#343434';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a7a7a';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
}

export type PedSymbol = 'hand' | 'person';

/** Symbol drawn solid (for printed signs, e.g. the push-button sign). */
export function drawPedSymbol(ctx: CanvasRenderingContext2D, sym: PedSymbol, x: number, y: number, w: number, h: number, color: string): void {
  const [c, cctx] = makeCanvas(Math.ceil(w), Math.ceil(h));
  (sym === 'hand' ? drawHand : drawPerson)(cctx, c.width, c.height);
  cctx.globalCompositeOperation = 'source-in';
  cctx.fillStyle = color;
  cctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(c, x, y);
}

// ---------------------------------------------------------------------------
// Countdown digits (7-segment layout drawn with a double row of LED dots)
// ---------------------------------------------------------------------------

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  ' ': '',
};

/** LED centers of one segment set in a w × h box (segments span 4 %…96 % of the height). */
function segmentDots(w: number, h: number, segs: string, pitch: number): [number, number][] {
  const L = 0.16;
  const R = 0.84;
  const T = 0.04;
  const M = 0.5;
  const B = 0.96;
  const lines: Record<string, [number, number, number, number]> = {
    a: [L, T, R, T],
    b: [R, T, R, M],
    c: [R, M, R, B],
    d: [L, B, R, B],
    e: [L, M, L, B],
    f: [L, T, L, M],
    g: [L, M, R, M],
  };
  const out: [number, number][] = [];
  const off = pitch * 0.42; // double row
  for (const s of segs) {
    const [x0, y0, x1, y1] = lines[s]!;
    const dx = (x1 - x0) * w;
    const dy = (y1 - y0) * h;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const n = Math.max(2, Math.round(len / pitch));
    for (let i = 1; i < n; i++) {
      const x = x0 * w + (dx * i) / n;
      const y = y0 * h + (dy * i) / n;
      out.push([x + nx * off, y + ny * off], [x - nx * off, y - ny * off]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Countdown pedestrian module face (16" × 18" class): symbol half + two countdown digits
// ---------------------------------------------------------------------------

export interface PedFaceLayout {
  /** Canvas size (px) and meters per px along x / y. */
  W: number;
  H: number;
  /** Rectangles in canvas px: [x, y, w, h]. */
  symbol: [number, number, number, number];
  digits: [number, number, number, number][];
}

export interface PedFaceLayers {
  layout: PedFaceLayout;
  /** Unlit face (every LED as a dark cup on a black face). Shared. */
  base: THREE.CanvasTexture;
  hand: HTMLCanvasElement;
  person: HTMLCanvasElement;
  /** Lit digit '0'..'9' (Portland orange) sized to one digit rectangle. */
  digits: HTMLCanvasElement[];
}

const PED_ORANGE = '#ff6a00';
const PED_WHITE = '#e8f2ff';

/**
 * Layers of a countdown ped-signal face. `face` = [width, height] m, `symbol` = [cx, w, h] m (centered
 * vertically), `digitCx` = digit centers (m), `digit` = [w, h] m. Canvas ≈ 1300 px/m, LED pitch ≈ 7 mm.
 */
export function pedFaceLayers(face: [number, number], symbol: [number, number, number], digitCx: number[], digit: [number, number]): PedFaceLayers {
  const key = `led:pedface:${face.join(',')}:${symbol.join(',')}:${digitCx.join(',')}:${digit.join(',')}`;
  const hit = pedFaceCache.get(key);
  if (hit) return hit;
  const ppm = 1300;
  const W = Math.round(face[0] * ppm);
  const H = Math.round(face[1] * ppm);
  const rect = (cx: number, w: number, h: number): [number, number, number, number] => [
    Math.round((face[0] / 2 + cx - w / 2) * ppm),
    Math.round((face[1] / 2 - h / 2) * ppm),
    Math.round(w * ppm),
    Math.round(h * ppm),
  ];
  const layout: PedFaceLayout = { W, H, symbol: rect(symbol[0], symbol[1], symbol[2]), digits: digitCx.map((x) => rect(x, digit[0], digit[1])) };
  const pitch = 9;
  const r = 3.3;
  const [sx, sy, sw, sh] = layout.symbol;
  const handDots = symbolDots(drawHand, sw, sh, pitch);
  const personDots = symbolDots(drawPerson, sw, sh, pitch);
  const layer = (w: number, h: number, dots: [number, number][], color: string) => {
    const [c, ctx] = makeCanvas(w, h);
    for (const [x, y] of dots) drawLed(ctx, x, y, r, color);
    return c;
  };
  const hand = layer(sw, sh, handDots, PED_ORANGE);
  const person = layer(sw, sh, personDots, PED_WHITE);
  const [, , dw, dh] = layout.digits[0] ?? [0, 0, 1, 1];
  const digits = '0123456789'.split('').map((d) => layer(dw, dh, segmentDots(dw, dh, SEGMENTS[d]!, 10), PED_ORANGE));
  const base = sharedTex(`${key}:base`, () => {
    const [c, ctx] = makeCanvas(W, H);
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, W, H);
    // union of both symbols' LEDs (overlaid module)
    const seen = new Set<string>();
    for (const [x, y] of [...handDots, ...personDots]) {
      const k = `${x}:${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      drawLed(ctx, sx + x, sy + y, r, null);
    }
    for (const [x0, y0, w, h] of layout.digits) for (const [x, y] of segmentDots(w, h, 'abcdefg', 10)) drawLed(ctx, x0 + x, y0 + y, r, null);
    // divider between the halves
    if (layout.digits.length) {
      const xd = Math.round((sx + sw + layout.digits[0]![0]) / 2);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(xd - 2, H * 0.08, 4, H * 0.84);
    }
    return canvasTex(c, { aniso: 8 });
  });
  const res = { layout, base, hand, person, digits };
  pedFaceCache.set(key, res);
  return res;
}
const pedFaceCache = new Map<string, PedFaceLayers>();

// ---------------------------------------------------------------------------
// 5×7 dot-matrix font (classic LED message sign font)
// ---------------------------------------------------------------------------

/** Each glyph: 7 rows of 5 bits (MSB = left column). */
const FONT_5X7: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x1f, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '>': [0x08, 0x04, 0x02, 0x01, 0x02, 0x04, 0x08],
  '<': [0x02, 0x04, 0x08, 0x10, 0x08, 0x04, 0x02],
  /** Right arrow. */
  '→': [0x04, 0x02, 0x1f, 0x1f, 0x1f, 0x02, 0x04],
  /** Left arrow. */
  '←': [0x04, 0x08, 0x1f, 0x1f, 0x1f, 0x08, 0x04],
  /** Up arrow. */
  '↑': [0x04, 0x0e, 0x1f, 0x04, 0x04, 0x04, 0x04],
  /** Down arrow. */
  '↓': [0x04, 0x04, 0x04, 0x04, 0x1f, 0x0e, 0x04],
};

/** Dot-matrix layout: which cells of a cols×rows grid are lit for `text` (centered, 1-dot margin). */
export function dotMatrixLayout(text: string, minCols = 0): { cols: number; rows: number; lit: Uint8Array } {
  const chars = [...text.toUpperCase()];
  const textCols = Math.max(0, chars.length * 6 - 1);
  const cols = Math.max(minCols, textCols + 2);
  const rows = 9;
  const lit = new Uint8Array(cols * rows);
  const x0 = Math.floor((cols - textCols) / 2);
  chars.forEach((ch, i) => {
    const glyph = FONT_5X7[ch] ?? FONT_5X7[' ']!;
    for (let r = 0; r < 7; r++) {
      for (let b = 0; b < 5; b++) {
        if (glyph[r]! & (1 << (4 - b))) lit[(r + 1) * cols + x0 + i * 6 + b] = 1;
      }
    }
  });
  return { cols, rows, lit };
}

/**
 * LED matrix textures for a message: `base` shows every LED as a dark dot on a black face, `emissive`
 * shows the lit LEDs (white with a halo). `px` = pixels per dot pitch.
 */
export function dotMatrixTextures(text: string, minCols = 0, px = 20): { base: THREE.CanvasTexture; emissive: THREE.CanvasTexture; cols: number; rows: number } {
  const { cols, rows, lit } = dotMatrixLayout(text, minCols);
  const base = sharedTex(`led:dm:base:${cols}:${rows}:${px}`, () => {
    const [c, ctx] = makeCanvas(cols * px, rows * px);
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const x = (q + 0.5) * px;
        const y = (r + 0.5) * px;
        ctx.fillStyle = '#2e2e2e';
        ctx.beginPath();
        ctx.arc(x, y, px * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#6a6a6a';
        ctx.beginPath();
        ctx.arc(x - px * 0.1, y - px * 0.1, px * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvasTex(c);
  });
  const emissive = sharedTex(`led:dm:lit:${text}:${cols}:${px}`, () => {
    const [c, ctx] = makeCanvas(cols * px, rows * px);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        if (!lit[r * cols + q]) continue;
        const x = (q + 0.5) * px;
        const y = (r + 0.5) * px;
        const g = ctx.createRadialGradient(x, y, 0, x, y, px * 0.55);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, px * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvasTex(c);
  });
  return { base, emissive, cols, rows };
}
