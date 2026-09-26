/**
 * PanelView 5310 graphic terminal digital twin (2713P-T7WD1 / T9WD1 / T10CD1 / T12WD1; the 15" size renders a
 * PanelView 5510 2715P-T15CD because the 5310 family has no 15" model).
 *
 * Real line (2713P-TD001 + distributor data): 7" WVGA 800×480 (236 × 178 mm), 9" WVGA 800×480 (280 × 190),
 * 10.4" SVGA 800×600 4:3 (297 × 252), 12.1" WXGA 1280×800 (340 × 246); all 69.6 mm deep. Wide black bezel
 * with the display recessed behind a chamfered lip, body behind the panel cutout with mounting levers and a
 * rear connector area: single EtherNet/IP RJ45 (green link / yellow activity LEDs), USB-A host, USB-B device,
 * SD card slot, 3-pin 24 V DC terminal block and the green STS status indicator.
 *
 * The screen content is REAL interactive DOM (`children`) projected onto the display area (see HtmlScreen),
 * letterboxed when `resolution` has a different aspect than the panel; with no children a sample
 * View-Designer-style screen (header, motor graphic, Start/Stop buttons) is shown.
 *
 * Origin: center of the bezel's BACK face (= the panel surface) at the bezel's bottom edge. The bezel is in
 * front (z ∈ [0, 5.8 mm]); the housing goes behind the panel (negative z). Front faces +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import type { LedColor, LedMode } from '../../../common';
import type { PanelView5310Props } from '../../../contracts';
import { buildAtlas, decalGeometry, type DecalPlacement } from '../compactlogix/atlas';
import { barcode, CONDENSED, grain, type MmCtx } from '../compactlogix/canvas';
import { box, cachedGeometry, holedPlate, mergeColored, roundedBox, roundedRectPath, screwHeadGeometry, xf } from '../compactlogix/geometry';
import { activityFlicker, cachedMaterial, drawRj45Face, HighlightFrame, PointLeds, usePick, vertexColorMetal, vertexColorPlastic } from '../compactlogix/parts';
import { HtmlScreen } from './HtmlScreen';

type PvSize = NonNullable<PanelView5310Props['size']>;

interface PvSpec {
  family: 'PanelView 5310' | 'PanelView 5510';
  catalog: string;
  /** Diagonal (inches) and native resolution. */
  diag: number;
  res: [number, number];
  /** Overall bezel size (mm) and total depth (mm, incl. the 5.8 mm bezel). */
  outer: [number, number];
  depthMm: number;
}

export const PV5310_SPECS: Record<PvSize, PvSpec> = {
  7: { family: 'PanelView 5310', catalog: '2713P-T7WD1', diag: 7, res: [800, 480], outer: [236, 178], depthMm: 69.6 },
  9: { family: 'PanelView 5310', catalog: '2713P-T9WD1', diag: 9, res: [800, 480], outer: [280, 190], depthMm: 69.6 },
  10: { family: 'PanelView 5310', catalog: '2713P-T10CD1', diag: 10.4, res: [800, 600], outer: [297, 252], depthMm: 69.6 },
  12: { family: 'PanelView 5310', catalog: '2713P-T12WD1', diag: 12.1, res: [1280, 800], outer: [340, 246], depthMm: 69.6 },
  /** Not a PV5310 size: rendered as a PanelView 5510 15" (4:3 XGA). */
  15: { family: 'PanelView 5510', catalog: '2715P-T15CD', diag: 15, res: [1024, 768], outer: [395, 305], depthMm: 72 },
};

const BEZEL_T = 0.0058; // bezel projection in front of the panel
const LIP = 0.0012; // chamfer of the window lip
const WINDOW_MARGIN = 0.0025; // window opening beyond the active area (black border)
const RECESS = 0.0012; // display surface behind the bezel front

function dims(size: PvSize) {
  const s = PV5310_SPECS[size];
  const [nx, ny] = s.res;
  const diagM = s.diag * 0.0254;
  const k = diagM / Math.hypot(nx, ny);
  const sw = nx * k; // active area (m)
  const sh = ny * k;
  const W = s.outer[0] / 1000;
  const H = s.outer[1] / 1000;
  const side = (W - sw) / 2;
  const vGap = H - sh;
  const bottom = vGap / 2 + Math.min(0.005, vGap * 0.12);
  const top = vGap - bottom;
  const depth = s.depthMm / 1000 - BEZEL_T; // housing behind the panel
  const bodyW = W - 0.026;
  const bodyH = H - 0.026;
  return { s, sw, sh, W, H, side, top, bottom, depth, bodyW, bodyH, screenY: bottom + sh / 2, bodyY: H / 2 };
}

type Dims = ReturnType<typeof dims>;

// ---------------------------------------------------------------------------
// Rear connector layout (mm, as seen from BEHIND: ru from the left edge of the rear face, rv from its bottom)
// ---------------------------------------------------------------------------

const REAR = {
  sts: { ru: 12, rv: 22 },
  tb: { ru: 34, rv: 18, w: 19, h: 11, d: 8 },
  usbB: { ru: 58, rv: 18 },
  usbA: { ru: 76, rv: 18 },
  sd: { ru: 99, rv: 18 },
  rj45: { ru: 126, rv: 18 },
} as const;

/** World x for a rear-view u (mm). */
const rx = (d: Dims, ru: number) => d.bodyW / 2 - ru / 1000;
/** World y for a rear-view v (mm). */
const ry = (d: Dims, rv: number) => d.bodyY - d.bodyH / 2 + rv / 1000;

// ---------------------------------------------------------------------------
// Print (atlas)
// ---------------------------------------------------------------------------

const BADGE = { w: 0.046, h: 0.009 } as const;

/** Small printed product name on the lower bezel (sized to the text so no seam shows on the textured bezel). */
function drawBezelBand(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, d: Dims) {
  ctx.fillStyle = '#151618';
  ctx.fillRect(0, 0, w, h);
  const wMm = BADGE.w * 1000;
  const hMm = BADGE.h * 1000;
  m.text(d.s.family, wMm - 0.5, hMm / 2, 4.2, { color: '#b9bdc2', weight: 600, align: 'right' });
}

function drawRear(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, d: Dims) {
  const wMm = d.bodyW * 1000 - 4;
  const hMm = d.bodyH * 1000 - 4;
  ctx.fillStyle = '#26282b';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 71);
  // connector panel recess
  m.rect(4, 5, Math.min(wMm - 8, 146), 27, '#1b1c1f', 1.5);
  const t = (s: string, ru: number, rv: number, size = 1.9) => m.text(s, ru - 2, rv - 2, size, { color: '#e2e4e6', weight: 700, align: 'center', font: CONDENSED });
  t('STS', REAR.sts.ru, REAR.sts.rv + 4.5);
  t('24V DC', REAR.tb.ru, REAR.tb.rv + 10);
  t('+   −   ⏚', REAR.tb.ru, REAR.tb.rv - 5.5, 1.7);
  t('USB', REAR.usbB.ru, REAR.usbB.rv + 9.5);
  t('DEVICE', REAR.usbB.ru, REAR.usbB.rv - 5.5, 1.5);
  t('USB', REAR.usbA.ru, REAR.usbA.rv + 9.5);
  t('HOST', REAR.usbA.ru, REAR.usbA.rv - 5.5, 1.5);
  t('SD', REAR.sd.ru, REAR.sd.rv + 9.5);
  m.rect(REAR.sd.ru - 2 - 13.5, REAR.sd.rv - 2 - 1.6, 27, 3.2, '#030304', 0.6);
  t('ETHERNET', REAR.rj45.ru, REAR.rj45.rv + 11);
  // vent slots in the upper half
  const vx0 = 8;
  const vx1 = wMm - 8;
  for (let i = 0; i < 6; i++) m.rect(vx0, hMm - 14 - i * 4.2, (vx1 - vx0) * 0.3, 1.8, '#0b0b0c', 0.8);
  for (let i = 0; i < 6; i++) m.rect(vx1 - (vx1 - vx0) * 0.3, hMm - 14 - i * 4.2, (vx1 - vx0) * 0.3, 1.8, '#0b0b0c', 0.8);
}

function drawBackLabel(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, s: PvSpec) {
  ctx.fillStyle = '#26282b';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#dcdddc';
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, 12);
  ctx.fill();
  m.text(s.family, 3, 32, 3.4, { color: '#111', weight: 800 });
  m.text(`CAT ${s.catalog}   SER A`, 3, 27.5, 2.6, { color: '#111', weight: 700 });
  m.text('24V DC  1.1 A max   Class 2', 3, 23.4, 2.2, { color: '#222', weight: 500 });
  m.text('Enclosure: Type 4X (indoor), 12, 13, IP66', 3, 19.8, 2.0, { color: '#222', weight: 500 });
  barcode(m, 3, 5, 34, 8, s.catalog.length * 131);
  m.text('IND. CONT. EQ.', 44, 9, 2.0, { color: '#222', weight: 800 });
  m.strokeRect(41.5, 5, 16, 8.5, '#333', 0.3, 1.5);
}

function drawVentBand(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, wMm: number, dMm: number) {
  ctx.fillStyle = '#2a2c2f';
  ctx.fillRect(0, 0, w, h);
  for (let x = 10; x < wMm - 10; x += 4) m.rect(x, 6, 2, dMm - 12, '#0a0a0b', 0.9);
}

function drawUsbA(_m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#07080a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1d4fb8';
  ctx.fillRect(w * 0.08, h * 0.12, w * 0.84, h * 0.34);
}

function pvAtlas(size: PvSize) {
  const d = dims(size);
  const ventD = (d.depth - 0.012) * 1000;
  return buildAtlas(`pv:${size}`, [
    { id: 'band', wMm: BADGE.w * 1000, hMm: BADGE.h * 1000, ppm: 12, roughness: 0.56, bg: '#151618', draw: (m, c, w, h) => drawBezelBand(m, c, w, h, d) },
    { id: 'rear', wMm: d.bodyW * 1000 - 4, hMm: d.bodyH * 1000 - 4, ppm: 4, roughness: 0.62, bg: '#26282b', draw: (m, c, w, h) => drawRear(m, c, w, h, d) },
    { id: 'label', wMm: 60, hMm: 36, ppm: 10, roughness: 0.5, bg: '#26282b', draw: (m, c, w, h) => drawBackLabel(m, c, w, h, d.s) },
    { id: 'vent', wMm: d.bodyW * 1000 - 20, hMm: ventD, ppm: 4, roughness: 0.62, bg: '#2a2c2f', draw: (m, c, w, h) => drawVentBand(m, c, w, h, d.bodyW * 1000 - 20, ventD) },
    { id: 'rj45', wMm: 15.8, hMm: 13.8, ppm: 10, roughness: 0.5, metalness: 0.2, bg: '#1a1b1d', draw: (_m, c, w, h) => drawRj45Face(c, w, h) },
    { id: 'usbA', wMm: 12, hMm: 4.6, ppm: 12, roughness: 0.5, bg: '#07080a', draw: drawUsbA },
  ]);
}

function pvDecals(size: PvSize) {
  const atlas = pvAtlas(size);
  const d = dims(size);
  const back: [number, number, number] = [0, Math.PI, 0];
  const zBack = -d.depth - 0.0002;
  const ventD = d.depth - 0.012;
  const placements: DecalPlacement[] = [
    { id: 'band', center: [d.sw / 2 + WINDOW_MARGIN - BADGE.w / 2, d.bottom / 2, BEZEL_T + 0.0002], size: [BADGE.w, BADGE.h] },
    { id: 'rear', center: [0, d.bodyY, zBack], size: [d.bodyW - 0.004, d.bodyH - 0.004], rotation: back },
    { id: 'label', center: [rx(d, d.bodyW * 500), d.bodyY + d.bodyH / 2 - 0.034, zBack - 0.0021], size: [0.06, 0.036], rotation: back },
    { id: 'vent', center: [0, d.bodyY + d.bodyH / 2 + 0.0002, -ventD / 2 - 0.006], size: [d.bodyW - 0.02, ventD], rotation: [-Math.PI / 2, 0, 0] },
    { id: 'vent', center: [0, d.bodyY - d.bodyH / 2 - 0.0002, -ventD / 2 - 0.006], size: [d.bodyW - 0.02, ventD], rotation: [Math.PI / 2, 0, 0] },
    { id: 'rj45', center: [rx(d, REAR.rj45.ru), ry(d, REAR.rj45.rv), zBack - 0.0005], size: [0.0158, 0.0138], rotation: back },
    { id: 'usbA', center: [rx(d, REAR.usbA.ru), ry(d, REAR.usbA.rv), zBack - 0.0004], size: [0.012, 0.0046], rotation: back },
  ];
  return { atlas, geometry: decalGeometry(`pv:${size}`, atlas, placements) };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Bezel: rounded frame with a window whose inner edge is a 45° chamfered lip. */
function bezelGeometry(size: PvSize) {
  return cachedGeometry(`pv-bezel-v2:${size}`, () => {
    const d = dims(size);
    const s = roundedRectPath(new THREE.Shape(), 0, d.H / 2, d.W, d.H, 0.007);
    const hole = roundedRectPath(new THREE.Path(), 0, d.screenY, d.sw + 2 * WINDOW_MARGIN, d.sh + 2 * WINDOW_MARGIN, 0.0015, true);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: BEZEL_T - 2 * LIP, bevelEnabled: true, bevelThickness: LIP, bevelSize: LIP, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, LIP);
    g.computeVertexNormals();
    return g;
  });
}

function bezelMaterial() {
  return cachedMaterial('pv-bezel-mat', () => {
    // fine molded texture: per-texel roughness + tone variation
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(256, 256);
    let seed = 1234567;
    for (let i = 0; i < 256 * 256; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = seed / 4294967296;
      const v = 225 + n * 30;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = 120 + n * 45; // roughness ≈ 0.47–0.65
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(70, 70);
    tex.colorSpace = THREE.NoColorSpace;
    return new THREE.MeshStandardMaterial({ color: '#151618', roughness: 1, metalness: 0.04, roughnessMap: tex });
  });
}

function usbBShell() {
  const s = new THREE.Shape();
  const w = 0.012;
  const h = 0.0108;
  const c = 0.0022;
  s.moveTo(-w / 2, -h / 2);
  s.lineTo(w / 2, -h / 2);
  s.lineTo(w / 2, h / 2 - c);
  s.lineTo(w / 2 - c, h / 2);
  s.lineTo(-w / 2 + c, h / 2);
  s.lineTo(-w / 2, h / 2 - c);
  s.closePath();
  const hole = new THREE.Path();
  const iw = 0.0104;
  const ih = 0.0092;
  const ic = 0.0018;
  hole.moveTo(-iw / 2, -ih / 2);
  hole.lineTo(-iw / 2, ih / 2 - ic);
  hole.lineTo(-iw / 2 + ic, ih / 2);
  hole.lineTo(iw / 2 - ic, ih / 2);
  hole.lineTo(iw / 2, ih / 2 - ic);
  hole.lineTo(iw / 2, -ih / 2);
  hole.closePath();
  s.holes.push(hole);
  return new THREE.ExtrudeGeometry(s, { depth: 0.0015, bevelEnabled: false });
}

/** Rear housing, ribs, levers, terminal block, port inserts — one draw. */
function housingGeometry(size: PvSize) {
  return cachedGeometry(`pv-housing:${size}`, () => {
    const d = dims(size);
    const zb = -d.depth;
    const flip: [number, number, number] = [0, Math.PI, 0];
    const parts: Array<[THREE.BufferGeometry, string, THREE.Matrix4?]> = [
      [roundedBox(d.bodyW, d.bodyH, d.depth, 0.004, 3), '#2a2c2f', xf([0, d.bodyY, -d.depth / 2])],
      // screen black matrix behind the window (recessed)
      [box(d.sw + 2 * WINDOW_MARGIN + 0.002, d.sh + 2 * WINDOW_MARGIN + 0.002, 0.001), '#07090c', xf([0, d.screenY, BEZEL_T - RECESS - 0.0006])],
    ];
    // rear ribs (upper part, around the label area) + a stiffening frame
    const ribH = d.bodyH * 0.55;
    const ribY = d.bodyY + d.bodyH * 0.18;
    for (const f of [-0.42, -0.2, 0.2, 0.42]) parts.push([roundedBox(0.004, ribH, 0.003, 0.001), '#232528', xf([f * d.bodyW, ribY, zb - 0.0012])]);
    parts.push([roundedBox(d.bodyW - 0.02, 0.004, 0.003, 0.001), '#232528', xf([0, ribY - ribH / 2, zb - 0.0012])]);
    // 24 V DC terminal block (3-pin, black) + port inserts
    const tb = REAR.tb;
    parts.push([roundedBox(tb.w / 1000, tb.h / 1000, tb.d / 1000, 0.0008), '#161718', xf([rx(d, tb.ru), ry(d, tb.rv), zb - tb.d / 2000])]);
    parts.push([box(0.0104, 0.0092, 0.0004), '#050506', xf([rx(d, REAR.usbB.ru), ry(d, REAR.usbB.rv), zb - 0.0002])]);
    parts.push([box(0.0066, 0.0036, 0.0022), '#e8e8e2', xf([rx(d, REAR.usbB.ru), ry(d, REAR.usbB.rv) + 0.0003, zb - 0.0011])]);
    // SD slot frame
    parts.push([holedPlate(0.031, 0.0065, 0.0015, 0.0008, [{ kind: 'rect', x: 0, y: 0, w: 0.027, h: 0.0032, r: 0.0003 }]), '#1d1e20', xf([rx(d, REAR.sd.ru), ry(d, REAR.sd.rv), zb], flip)]);
    // mounting levers (behind the panel, clamping the panel from the back)
    for (const sx of [-1, 1])
      for (const f of [0.22, 0.78]) {
        const x = sx * (d.bodyW / 2 + 0.004);
        const y = d.bodyY - d.bodyH / 2 + d.bodyH * f;
        parts.push([box(0.008, 0.016, 0.02), '#3a3d41', xf([x, y, -0.0125])]);
        parts.push([box(0.0035, 0.009, 0.0035), '#2d3034', xf([x + sx * 0.0048, y, -0.004])]);
      }
    return mergeColored(parts);
  });
}

function metalPartsGeometry(size: PvSize) {
  return cachedGeometry(`pv-metal:${size}`, () => {
    const d = dims(size);
    const zb = -d.depth;
    const flip: [number, number, number] = [0, Math.PI, 0];
    const parts: Array<[THREE.BufferGeometry, string | null, THREE.Matrix4?]> = [
      [usbBShell(), '#c3c7cb', xf([rx(d, REAR.usbB.ru), ry(d, REAR.usbB.rv), zb], flip)],
      [holedPlate(0.0134, 0.006, 0.0012, 0.0004, [{ kind: 'rect', x: 0, y: 0, w: 0.0122, h: 0.0048, r: 0.0002 }]), '#c3c7cb', xf([rx(d, REAR.usbA.ru), ry(d, REAR.usbA.rv), zb], flip)],
      [holedPlate(0.0166, 0.0146, 0.0012, 0.0006, [{ kind: 'rect', x: 0, y: 0, w: 0.0158, h: 0.0138, r: 0.0003 }]), '#aeb3b8', xf([rx(d, REAR.rj45.ru), ry(d, REAR.rj45.rv), zb], flip)],
    ];
    // terminal block screws (axis -Z)
    for (const i of [-1, 0, 1]) parts.push([screwHeadGeometry(0.0017, 0.0012, 'slot'), null, xf([rx(d, REAR.tb.ru) + i * 0.0058, ry(d, REAR.tb.rv) + 0.0015, zb - REAR.tb.d / 1000], flip)]);
    // lever screws
    for (const sx of [-1, 1])
      for (const f of [0.22, 0.78]) parts.push([screwHeadGeometry(0.0022, 0.0015, 'combo'), null, xf([sx * (d.bodyW / 2 + 0.004), d.bodyY - d.bodyH / 2 + d.bodyH * f, -0.0225], flip)]);
    return mergeColored(parts);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PanelView5310TwinProps extends PanelView5310Props {
  /** Screen backlight on (false = dark glass, DOM hidden). Default true. */
  getScreenOn?: () => boolean;
  highlighted?: boolean;
  onSelect?: () => void;
  /** Extra CSS for the screen root element. */
  screenStyle?: CSSProperties;
  /** Clip / hide the DOM screen where other opaque 3D objects are in front of it (default true). */
  occlude?: boolean;
}

export function PanelView5310({
  size = 7,
  children,
  resolution,
  getScreenOn,
  highlighted = false,
  onSelect,
  screenStyle,
  occlude = true,
  position,
  rotation,
  scale,
}: PanelView5310TwinProps) {
  const d = dims(size);
  const [rxPx, ryPx] = resolution ?? d.s.res;
  const { hovered, handlers } = usePick(onSelect);
  const [screenOn, setScreenOn] = useState(true);
  const lastOn = useRef(true);
  const root = useRef<THREE.Group>(null);
  const screenOnRef = useRef(true);

  useEffect(() => {
    const [nx, ny] = d.s.res;
    if (resolution && Math.abs(resolution[0] / resolution[1] - nx / ny) > 0.02)
      console.warn(`PanelView5310: resolution ${resolution.join('×')} does not match the ${d.s.diag}" panel aspect (${nx}×${ny}); content is letterboxed.`);
  }, [resolution, d.s]);

  useFrame(() => {
    const on = getScreenOn ? getScreenOn() : true;
    screenOnRef.current = on;
    if (on !== lastOn.current) {
      lastOn.current = on;
      setScreenOn(on);
    }
  });

  const decals = pvDecals(size);
  const leds = useMemo(() => {
    const zb = -d.depth - 0.0003;
    const positions: Array<[number, number, number]> = [
      [rx(d, REAR.sts.ru), ry(d, REAR.sts.rv), zb],
      [rx(d, REAR.rj45.ru - 6), ry(d, REAR.rj45.rv + 9.3), zb],
      [rx(d, REAR.rj45.ru + 6), ry(d, REAR.rj45.rv + 9.3), zb],
    ];
    const colors: LedColor[] = ['green', 'green', 'yellow'];
    const get = (i: number): LedMode => (i === 0 ? (screenOnRef.current ? 'on' : 'flash') : i === 1 ? true : activityFlicker(11));
    return { positions, get, color: (i: number) => colors[i]! };
  }, [d]);

  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} {...handlers}>
      <mesh geometry={bezelGeometry(size)} material={bezelMaterial()} castShadow receiveShadow />
      <mesh geometry={housingGeometry(size)} material={vertexColorPlastic()} castShadow receiveShadow />
      <mesh geometry={metalPartsGeometry(size)} material={vertexColorMetal()} receiveShadow />
      <mesh geometry={decals.geometry} material={decals.atlas.material} receiveShadow />
      <PointLeds positions={leds.positions} size={[0.0024, 0.0016, 0.0006]} get={leds.get} color={leds.color} intensity={1.8} />

      {/* display: dark panel when off + cover glass (the DOM is drawn on top when on) */}
      <mesh geometry={box(d.sw, d.sh, 0.0002)} material={screenMaterial(screenOn)} position={[0, d.screenY, BEZEL_T - RECESS - 0.0002]} receiveShadow />
      <mesh geometry={box(d.sw + 2 * WINDOW_MARGIN, d.sh + 2 * WINDOW_MARGIN, 0.0001)} material={glassMaterial()} position={[0, d.screenY, BEZEL_T - RECESS + 0.0002]} />

      {/* live screen content (DOM), recessed 1.2 mm behind the bezel front */}
      <HtmlScreen
        widthPx={rxPx}
        heightPx={ryPx}
        width={d.sw}
        height={d.sh}
        position={[0, d.screenY, BEZEL_T - RECESS]}
        visible={screenOn}
        occlude={occlude}
        occludeIgnore={root}
      >
        <div style={{ position: 'relative', width: rxPx, height: ryPx, background: '#0b0f14', userSelect: 'none', ...screenStyle }}>
          {children ?? <SampleHmiScreen width={rxPx} height={ryPx} />}
          {/* glass reflection overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background:
                'linear-gradient(118deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.035) 28%, rgba(255,255,255,0) 42%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.04) 100%)',
            }}
          />
        </div>
      </HtmlScreen>

      {(highlighted || hovered) && (
        <HighlightFrame center={[0, d.H / 2, (BEZEL_T - d.depth) / 2]} size={[d.W + 0.004, d.H + 0.004, BEZEL_T + d.depth + 0.004]} strength={highlighted ? 1 : 0.35} />
      )}
    </group>
  );
}

function screenMaterial(on: boolean) {
  return cachedMaterial(`pv-screen:${on}`, () => new THREE.MeshStandardMaterial({ color: on ? '#0b0f14' : '#050607', roughness: 0.3, metalness: 0 }));
}

function glassMaterial() {
  return cachedMaterial(
    'pv-glass',
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: 0.03,
        metalness: 0,
        transparent: true,
        opacity: 0.07,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        depthWrite: false,
      }),
  );
}

// ---------------------------------------------------------------------------
// Sample screen (shown when no children are given)
// ---------------------------------------------------------------------------

function SampleHmiScreen({ width, height }: { width: number; height: number }) {
  const k = height / 480;
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(45.3);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const px = (n: number) => `${Math.round(n * k)}px`;
  const btn = (bg: string, fg = '#fff'): CSSProperties => ({
    background: `linear-gradient(${bg}, ${shade(bg, -0.18)})`,
    color: fg,
    border: `${px(1)} solid ${shade(bg, -0.35)}`,
    borderRadius: px(6),
    fontWeight: 700,
    fontSize: px(20),
    padding: `${px(10)} ${px(12)}`,
    boxShadow: `inset 0 ${px(1)} 0 rgba(255,255,255,0.35), 0 ${px(2)} ${px(3)} rgba(0,0,0,0.35)`,
    cursor: 'pointer',
    minWidth: px(120),
  });
  return (
    <div style={{ width, height, fontFamily: 'Inter Variable, Inter, Arial, sans-serif', background: '#d7dade', color: '#1f2328', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div
        style={{
          height: px(44),
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${px(12)}`,
          gap: px(12),
          background: 'linear-gradient(#5c6570, #3b434c)',
          color: '#fff',
          borderBottom: `${px(2)} solid #2a3037`,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: px(20), letterSpacing: 0.3 }}>Conveyor 1 · Overview</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: px(15), opacity: 0.9 }}>{clock.toLocaleTimeString([], { hour12: false })}</div>
        <div style={{ background: '#2e8b3e', borderRadius: px(4), padding: `${px(3)} ${px(8)}`, fontSize: px(13), fontWeight: 700 }}>NO ALARMS</div>
      </div>
      {/* body */}
      <div style={{ flex: 1, display: 'flex', gap: px(12), padding: px(12) }}>
        <div style={{ flex: 1.35, background: '#eef0f2', border: `${px(1)} solid #a9afb6`, borderRadius: px(6), position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: px(10), top: px(6), fontSize: px(14), fontWeight: 700, color: '#4a525b' }}>M101 · Infeed Conveyor</div>
          <MotorGraphic running={running} k={k} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: px(10) }}>
          <div style={{ background: '#1d2126', color: '#8cf59b', borderRadius: px(6), padding: px(10), fontFamily: 'JetBrains Mono, monospace' }}>
            <div style={{ fontSize: px(13), color: '#9aa3ad', fontFamily: 'Inter Variable, Arial' }}>Drive speed</div>
            <div style={{ fontSize: px(38), fontWeight: 700 }}>
              {(running ? speed : 0).toFixed(1)} <span style={{ fontSize: px(18) }}>Hz</span>
            </div>
            <div style={{ height: px(8), background: '#333a42', borderRadius: px(4), overflow: 'hidden' }}>
              <div style={{ width: `${((running ? speed : 0) / 60) * 100}%`, height: '100%', background: '#3ccf5a', transition: 'width 0.6s' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: px(8) }}>
            <button style={btn('#2f9e44')} onClick={() => setRunning(true)}>
              START
            </button>
            <button style={btn('#d9363e')} onClick={() => setRunning(false)}>
              STOP
            </button>
          </div>
          <div style={{ display: 'flex', gap: px(8) }}>
            <button style={{ ...btn('#8a939c'), minWidth: 0, flex: 1 }} onClick={() => setSpeed((v) => Math.max(0, +(v - 5).toFixed(1)))}>
              − 5 Hz
            </button>
            <button style={{ ...btn('#8a939c'), minWidth: 0, flex: 1 }} onClick={() => setSpeed((v) => Math.min(60, +(v + 5).toFixed(1)))}>
              + 5 Hz
            </button>
          </div>
          <div style={{ fontSize: px(13), color: '#4a525b' }}>
            Status: <b style={{ color: running ? '#1f8a36' : '#6b737b' }}>{running ? 'RUNNING' : 'STOPPED'}</b>
          </div>
        </div>
      </div>
      {/* nav bar */}
      <div style={{ height: px(46), display: 'flex', gap: px(6), padding: `${px(6)} ${px(12)}`, background: '#b9bec4', borderTop: `${px(1)} solid #98a0a8` }}>
        {['Overview', 'Trends', 'Alarms', 'Settings'].map((t, i) => (
          <div
            key={t}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: px(5),
              fontWeight: 700,
              fontSize: px(15),
              background: i === 0 ? 'linear-gradient(#3f78c9, #2b5ea8)' : 'linear-gradient(#e9ebee, #cfd3d8)',
              color: i === 0 ? '#fff' : '#2a3037',
              border: `${px(1)} solid ${i === 0 ? '#244f8f' : '#9aa1a9'}`,
            }}
          >
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function MotorGraphic({ running, k }: { running: boolean; k: number }) {
  const color = running ? '#2fa84f' : '#8a929a';
  return (
    <svg viewBox="0 0 400 260" style={{ position: 'absolute', inset: `${Math.round(24 * k)}px 0 0 0`, width: '100%', height: `calc(100% - ${Math.round(24 * k)}px)` }}>
      <style>{`@keyframes pvspin{to{transform:rotate(360deg)}} @keyframes pvbelt{to{stroke-dashoffset:-40}}`}</style>
      {/* conveyor */}
      <rect x="30" y="170" width="340" height="22" rx="11" fill="#5b636b" />
      <line
        x1="40"
        y1="170"
        x2="360"
        y2="170"
        stroke="#2b3036"
        strokeWidth="5"
        strokeDasharray="14 6"
        style={running ? { animation: 'pvbelt 0.6s linear infinite' } : undefined}
      />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={70 + i * 100} y={138} width="46" height="32" rx="3" fill="#c8964f" stroke="#8f6a33" />
      ))}
      {/* motor */}
      <g transform="translate(150 40)">
        <rect x="0" y="20" width="100" height="62" rx="10" fill={color} stroke="#1c2024" strokeWidth="3" />
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={14 + i * 18} y1="26" x2={14 + i * 18} y2="76" stroke="rgba(0,0,0,0.25)" strokeWidth="4" />
        ))}
        <rect x="100" y="42" width="24" height="16" fill="#9aa2aa" stroke="#1c2024" strokeWidth="2" />
        <rect x="18" y="82" width="64" height="12" fill="#444b52" />
        <g transform="translate(-26 51)">
          <circle r="22" fill="#e6e9ec" stroke="#1c2024" strokeWidth="3" />
          <g style={running ? { animation: 'pvspin 0.8s linear infinite', transformOrigin: '0 0' } : undefined}>
            {[0, 120, 240].map((a) => (
              <path key={a} d="M0 0 L6 -18 L-6 -18 Z" fill={color} transform={`rotate(${a})`} />
            ))}
          </g>
        </g>
        <text x="50" y="12" textAnchor="middle" fontSize="16" fontWeight="700" fill="#1f2328">
          M101
        </text>
      </g>
      <text x="200" y="232" textAnchor="middle" fontSize="18" fontWeight="800" fill={running ? '#1f8a36' : '#59616a'}>
        {running ? '● RUNNING' : '○ STOPPED'}
      </text>
    </svg>
  );
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

