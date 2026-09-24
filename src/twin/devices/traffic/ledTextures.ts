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

/** Upraised hand (palm facing viewer, fingers together, thumb out to the left). */
const drawHand: Draw = (ctx, w, h) => {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const s = Math.min(w, h) / 100;
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // palm
  ctx.beginPath();
  ctx.moveTo(-20, -8);
  ctx.lineTo(22, -8);
  ctx.lineTo(22, 22);
  ctx.quadraticCurveTo(20, 40, 4, 44);
  ctx.lineTo(-10, 44);
  ctx.quadraticCurveTo(-22, 38, -22, 20);
  ctx.closePath();
  ctx.fill();
  // fingers
  const fingers: [number, number][] = [
    [-15, -38],
    [-4.5, -44],
    [6, -42],
    [16.5, -33],
  ];
  for (const [x, top] of fingers) {
    ctx.beginPath();
    ctx.roundRect(x - 5, top, 10, -top - 2, 5);
    ctx.fill();
  }
  // thumb
  ctx.save();
  ctx.translate(-20, 14);
  ctx.rotate(-0.75);
  ctx.beginPath();
  ctx.roundRect(-5.5, -30, 11, 32, 5.5);
  ctx.fill();
  ctx.restore();
  ctx.restore();
};

/** Walking person in profile, striding to the right. */
const drawPerson: Draw = (ctx, w, h) => {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  const s = Math.min(w, h) / 100;
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // head
  ctx.beginPath();
  ctx.arc(3, -38, 7.5, 0, Math.PI * 2);
  ctx.fill();
  // torso
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(1, -24);
  ctx.lineTo(-2, 4);
  ctx.stroke();
  // arms
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(1, -22);
  ctx.lineTo(-10, -6);
  ctx.lineTo(-16, 8);
  ctx.moveTo(2, -22);
  ctx.lineTo(12, -8);
  ctx.lineTo(20, 2);
  ctx.stroke();
  // legs
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-2, 4);
  ctx.lineTo(-12, 24);
  ctx.lineTo(-22, 42);
  ctx.moveTo(-2, 4);
  ctx.lineTo(10, 22);
  ctx.lineTo(14, 43);
  ctx.stroke();
  // feet
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-22, 42);
  ctx.lineTo(-28, 40);
  ctx.moveTo(14, 43);
  ctx.lineTo(22, 43);
  ctx.stroke();
  ctx.restore();
};

/** Rasterize a symbol into a mask, then re-draw it as a grid of LED dots. */
function dotify(draw: Draw, w: number, h: number, pitch: number, dotR: number, mode: 'lit' | 'unlit'): HTMLCanvasElement {
  const [mask, mctx] = makeCanvas(w, h);
  draw(mctx, w, h);
  const data = mctx.getImageData(0, 0, w, h).data;
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  for (let y = pitch / 2; y < h; y += pitch) {
    for (let x = pitch / 2; x < w; x += pitch) {
      const a = data[(Math.floor(y) * w + Math.floor(x)) * 4 + 3]!;
      if (a < 100) continue;
      if (mode === 'lit') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, dotR * 1.7);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, dotR * 1.7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#4a4a4a';
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8a8a8a';
        ctx.beginPath();
        ctx.arc(x - dotR * 0.3, y - dotR * 0.3, dotR * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  void mask;
  return c;
}

export type PedSymbol = 'hand' | 'person';

/** LED dot pattern of a pedestrian symbol ('lit' = emissive map, 'unlit' = faint dark dots for the base map). */
export function pedSymbolTexture(sym: PedSymbol, mode: 'lit' | 'unlit'): THREE.CanvasTexture {
  return sharedTex(`led:ped:${sym}:${mode}`, () => canvasTex(dotify(sym === 'hand' ? drawHand : drawPerson, 256, 320, 9, 3.4, mode)));
}

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
// Countdown digits (7-segment layout drawn with LED dots)
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

function drawSegments(ctx: CanvasRenderingContext2D, w: number, h: number, segs: string, mode: 'lit' | 'unlit'): void {
  // segment endpoints in a 0..1 box
  const m = 0.14;
  const L = m;
  const R = 1 - m;
  const T = 0.08;
  const M = 0.5;
  const B = 0.92;
  const lines: Record<string, [number, number, number, number]> = {
    a: [L, T, R, T],
    b: [R, T, R, M],
    c: [R, M, R, B],
    d: [L, B, R, B],
    e: [L, M, L, B],
    f: [L, T, L, M],
    g: [L, M, R, M],
  };
  const pitch = 10;
  const dotR = 3.6;
  for (const s of 'abcdefg') {
    const on = segs.includes(s);
    if (mode === 'lit' && !on) continue;
    const [x0, y0, x1, y1] = lines[s]!;
    const len = Math.hypot((x1 - x0) * w, (y1 - y0) * h);
    const n = Math.max(2, Math.round(len / pitch));
    for (let i = 1; i < n; i++) {
      const x = (x0 + ((x1 - x0) * i) / n) * w;
      const y = (y0 + ((y1 - y0) * i) / n) * h;
      if (mode === 'lit') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, dotR * 1.7);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, dotR * 1.7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#474747';
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Lit dot pattern of one countdown digit ('0'..'9'). */
export function digitTexture(d: string): THREE.CanvasTexture {
  return sharedTex(`led:digit:${d}`, () => {
    const [c, ctx] = makeCanvas(128, 224);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 224);
    drawSegments(ctx, 128, 224, SEGMENTS[d] ?? '', 'lit');
    return canvasTex(c);
  });
}

/** Unlit "8" (all segments as dark dots) for the base map of a countdown digit. */
export function digitBaseTexture(): THREE.CanvasTexture {
  return sharedTex('led:digit:base', () => {
    const [c, ctx] = makeCanvas(128, 224);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 224);
    drawSegments(ctx, 128, 224, 'abcdefg', 'unlit');
    return canvasTex(c);
  });
}

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

/** Unlit base of an overlaid hand/person module: the union of both symbols' LED dots. */
export function pedOverlayBaseTexture(): THREE.CanvasTexture {
  return sharedTex('led:ped:overlayBase', () => {
    const a = pedSymbolTexture('hand', 'unlit').image as HTMLCanvasElement;
    const b = pedSymbolTexture('person', 'unlit').image as HTMLCanvasElement;
    const [c, ctx] = makeCanvas(a.width, a.height);
    ctx.drawImage(a, 0, 0);
    ctx.globalCompositeOperation = 'lighten';
    ctx.drawImage(b, 0, 0);
    return canvasTex(c);
  });
}
