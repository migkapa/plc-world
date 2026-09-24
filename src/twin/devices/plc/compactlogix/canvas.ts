/**
 * Canvas-texture helpers shared by the CompactLogix / PowerFlex / PanelView twins.
 *
 * - `canvasTexture()` draws a static decal once and caches it by key (safe to call during render).
 * - `DOT_FONT` is a classic 5x7 dot-matrix font (column-major, bit 0 = top row) used for the
 *   Logix 4-character scrolling status display.
 */
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

export const SANS = 'Inter Variable, Inter, Arial, Helvetica, sans-serif';
export const CONDENSED = '"Arial Narrow", "Roboto Condensed", Inter Variable, Arial, sans-serif';

/** Create (or reuse) a canvas texture drawn by `draw`. `key` must uniquely identify the artwork. */
export function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { mipmaps?: boolean } = {},
): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (opts.mipmaps === false) {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  }
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Helper: millimetre-based drawing surface. `s` = px per mm, origin bottom-left like the 3D face. */
export interface MmCtx {
  ctx: CanvasRenderingContext2D;
  s: number;
  /** Face height in mm (for flipping Y). */
  hMm: number;
  x(u: number): number;
  y(v: number): number;
  text(t: string, u: number, v: number, sizeMm: number, o?: TextOpts): void;
  rect(u: number, v: number, w: number, h: number, fill: string, radius?: number): void;
  strokeRect(u: number, v: number, w: number, h: number, stroke: string, lineMm?: number, radius?: number): void;
  line(u1: number, v1: number, u2: number, v2: number, stroke: string, lineMm?: number): void;
  circle(u: number, v: number, r: number, fill: string): void;
}

export interface TextOpts {
  color?: string;
  weight?: number | string;
  align?: CanvasTextAlign;
  font?: string;
  /** Rotate text (radians, CCW positive in face space). */
  rotate?: number;
  letterSpacing?: number;
}

export function mmCtx(ctx: CanvasRenderingContext2D, s: number, hMm: number): MmCtx {
  const x = (u: number) => u * s;
  const y = (v: number) => (hMm - v) * s;
  const roundRect = (u: number, v: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x(u), y(v + h), w * s, h * s, r * s);
  };
  return {
    ctx,
    s,
    hMm,
    x,
    y,
    text(t, u, v, sizeMm, o = {}) {
      ctx.save();
      ctx.fillStyle = o.color ?? '#f2f2ee';
      ctx.font = `${o.weight ?? 600} ${sizeMm * s}px ${o.font ?? SANS}`;
      ctx.textAlign = o.align ?? 'left';
      ctx.textBaseline = 'middle';
      if (o.letterSpacing !== undefined) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${o.letterSpacing * s}px`;
      ctx.translate(x(u), y(v));
      if (o.rotate) ctx.rotate(-o.rotate);
      ctx.fillText(t, 0, 0);
      ctx.restore();
    },
    rect(u, v, w, h, fill, radius = 0) {
      ctx.fillStyle = fill;
      if (radius > 0) {
        roundRect(u, v, w, h, radius);
        ctx.fill();
      } else ctx.fillRect(x(u), y(v + h), w * s, h * s);
    },
    strokeRect(u, v, w, h, stroke, lineMm = 0.2, radius = 0) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineMm * s;
      if (radius > 0) {
        roundRect(u, v, w, h, radius);
        ctx.stroke();
      } else ctx.strokeRect(x(u), y(v + h), w * s, h * s);
    },
    line(u1, v1, u2, v2, stroke, lineMm = 0.2) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineMm * s;
      ctx.beginPath();
      ctx.moveTo(x(u1), y(v1));
      ctx.lineTo(x(u2), y(v2));
      ctx.stroke();
    },
    circle(u, v, r, fill) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x(u), y(v), r * s, 0, Math.PI * 2);
      ctx.fill();
    },
  };
}

/** Subtle plastic grain / noise so large flat faces don't look CG-perfect. */
export function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount = 0.035, seed = 1) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000) / 1000;
  };
  const n = Math.floor((w * h) / 90);
  for (let i = 0; i < n; i++) {
    const a = rnd() * amount;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
}

/** Draw a fake 1D barcode (decorative) inside the rect. */
export function barcode(m: MmCtx, u: number, v: number, w: number, h: number, seed: number, color = '#111') {
  let s = seed >>> 0 || 7;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let x = u;
  while (x < u + w) {
    const bw = 0.12 + Math.floor(rnd() * 3) * 0.12;
    if (rnd() > 0.45) m.rect(x, v, Math.min(bw, u + w - x), h, color);
    x += bw + 0.12;
  }
}

// ---------------------------------------------------------------------------
// 5x7 dot-matrix font
// ---------------------------------------------------------------------------

/* prettier-ignore */
export const DOT_FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e], '1': [0x00, 0x42, 0x7f, 0x40, 0x00], '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31], '4': [0x18, 0x14, 0x12, 0x7f, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30], '7': [0x01, 0x71, 0x09, 0x05, 0x03], '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x49, 0x36], C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c], E: [0x7f, 0x49, 0x49, 0x49, 0x41], F: [0x7f, 0x09, 0x09, 0x01, 0x01],
  G: [0x3e, 0x41, 0x41, 0x51, 0x32], H: [0x7f, 0x08, 0x08, 0x08, 0x7f], I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01], K: [0x7f, 0x08, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x04, 0x02, 0x7f], N: [0x7f, 0x04, 0x08, 0x10, 0x7f], O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06], Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [0x01, 0x01, 0x7f, 0x01, 0x01], U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f], W: [0x7f, 0x20, 0x18, 0x20, 0x7f], X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x03, 0x04, 0x78, 0x04, 0x03], Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  a: [0x20, 0x54, 0x54, 0x54, 0x78], b: [0x7f, 0x48, 0x44, 0x44, 0x38], c: [0x38, 0x44, 0x44, 0x44, 0x20],
  d: [0x38, 0x44, 0x44, 0x48, 0x7f], e: [0x38, 0x54, 0x54, 0x54, 0x18], f: [0x08, 0x7e, 0x09, 0x01, 0x02],
  g: [0x0c, 0x52, 0x52, 0x52, 0x3e], h: [0x7f, 0x08, 0x04, 0x04, 0x78], i: [0x00, 0x44, 0x7d, 0x40, 0x00],
  j: [0x20, 0x40, 0x44, 0x3d, 0x00], k: [0x7f, 0x10, 0x28, 0x44, 0x00], l: [0x00, 0x41, 0x7f, 0x40, 0x00],
  m: [0x7c, 0x04, 0x18, 0x04, 0x78], n: [0x7c, 0x08, 0x04, 0x04, 0x78], o: [0x38, 0x44, 0x44, 0x44, 0x38],
  p: [0x7c, 0x14, 0x14, 0x14, 0x08], q: [0x08, 0x14, 0x14, 0x18, 0x7c], r: [0x7c, 0x08, 0x04, 0x04, 0x08],
  s: [0x48, 0x54, 0x54, 0x54, 0x20], t: [0x04, 0x3f, 0x44, 0x40, 0x20], u: [0x3c, 0x40, 0x40, 0x20, 0x7c],
  v: [0x1c, 0x20, 0x40, 0x20, 0x1c], w: [0x3c, 0x40, 0x30, 0x40, 0x3c], x: [0x44, 0x28, 0x10, 0x28, 0x44],
  y: [0x0c, 0x50, 0x50, 0x50, 0x3c], z: [0x44, 0x64, 0x54, 0x4c, 0x44],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08], '.': [0x00, 0x60, 0x60, 0x00, 0x00], ':': [0x00, 0x36, 0x36, 0x00, 0x00],
  '/': [0x20, 0x10, 0x08, 0x04, 0x02], '_': [0x40, 0x40, 0x40, 0x40, 0x40], '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
  '!': [0x00, 0x00, 0x5f, 0x00, 0x00], '(': [0x00, 0x1c, 0x22, 0x41, 0x00], ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14], '+': [0x08, 0x08, 0x3e, 0x08, 0x08], '%': [0x23, 0x13, 0x08, 0x64, 0x62],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00], "'": [0x00, 0x05, 0x03, 0x00, 0x00], '?': [0x02, 0x01, 0x51, 0x09, 0x06],
  '*': [0x14, 0x08, 0x3e, 0x08, 0x14], '>': [0x41, 0x22, 0x14, 0x08, 0x00], '<': [0x08, 0x14, 0x22, 0x41, 0x00],
};

/** Column bitmaps (6 per character incl. 1 blank spacing column) for a string. */
export function dotColumns(text: string): number[] {
  const cols: number[] = [];
  for (const ch of text) {
    const g = DOT_FONT[ch] ?? DOT_FONT[ch.toUpperCase()] ?? DOT_FONT['?']!;
    cols.push(...g, 0);
  }
  return cols;
}
