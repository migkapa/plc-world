/**
 * Compact 5000 I/O module (5069-IB16 / -OB16 / -IF8 / -OF4) digital twin.
 *
 * Real proportions (5069-TD001): 144.57 × 22 × 105.42 mm (H × W × D). Dark housing with an indicator
 * "head" at the top (module status + point status indicators with numbers, catalog label, color band)
 * and an 18-pin removable terminal block (5069-RTB18-SCREW) below it: real recessed wire entries and screw
 * wells, screws sunk into the wells, release latch tucked under the head overhang. Top AND bottom vents,
 * DIN-rail channel + latch tab on the back. Field wiring (wires, shielded analog pairs, ferrules, markers)
 * runs down into a wire duct.
 *
 * Draw calls per module: body (merged) + print (atlas) + LEDs (instanced) + screws (instanced) + wiring.
 *
 * Origin: center of the back mounting face at the bottom edge (front = +Z).
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { COLORS, type LedColor, type LedMode } from '../../../common';
import type { Placement } from '../../../contracts';
import { buildAtlas, decalGeometry, type Atlas } from './atlas';
import { barcode, CONDENSED, grain, type MmCtx } from './canvas';
import { cachedGeometry, holedPlate, mergeColored, roundedBox, screwHeadGeometry, xf, type HoleSpec } from './geometry';
import {
  ENTRY,
  HEAD_H,
  HEAD_Y0,
  housingGeometry,
  M5069,
  RTB_H,
  rtbTerminal,
  STYLES,
  WELL,
  type DuctTarget,
  type Module5069Catalog,
} from './m5069';
import { cachedMaterial, DUCT, HighlightFrame, PointLeds, StaticInstances, usePick, vertexColorMetal, vertexColorPlastic } from './parts';
import { wiringGeometry } from './wiring';

export { M5069, housingGeometry, rtbTerminal };
export type { Module5069Catalog, DuctTarget };

export const catalogInfo5069 = (c: Module5069Catalog) => STYLES[c];

const W = M5069.width;
const H = M5069.height;
const D = M5069.depth;
const RTB_D = M5069.rtbFront - M5069.bodyFront;
const RECESS = M5069.rtbRecess;
const RTB_CY = M5069.rtbBottom + RTB_H / 2;
/** Rail center height (matches the rack's DIN rail). */
const RAIL_Y = 0.071;

// ---------------------------------------------------------------------------
// Print (atlas)
// ---------------------------------------------------------------------------

/** LED grid (head-face mm coordinates, origin bottom-left of the head face). */
function headLedLayout(points: number) {
  const rows = points > 8 ? 8 : Math.ceil(points / 2);
  const pos: Array<{ u: number; v: number; n: number }> = [];
  const top = HEAD_H * 1000 - 11.2;
  const pitch = 2.72;
  for (let n = 0; n < points; n++) {
    const right = points > 8 ? n >= 8 : n >= rows;
    const r = points > 8 ? n % 8 : n % rows;
    pos.push({ u: right ? 13.4 : 8.6, v: top - r * pitch, n });
  }
  return pos;
}
const STATUS_LED = { u: 8.6, v: HEAD_H * 1000 - 8.9 };

function drawHead(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, catalog: Module5069Catalog) {
  const st = STYLES[catalog];
  const wMm = W * 1000;
  const hMm = HEAD_H * 1000;
  ctx.fillStyle = '#16171a';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 11);
  m.rect(0.8, hMm - 2.2, wMm - 1.6, 1.3, st.band, 0.3);
  m.text('5069', 1.4, hMm - 4.1, 1.7, { color: '#c8cacd', weight: 600, font: CONDENSED });
  m.text(st.title, wMm - 1.3, hMm - 4.1, 2.3, { color: '#ffffff', weight: 800, align: 'right', font: CONDENSED });
  m.text(st.sub, wMm / 2, hMm - 6.5, 1.25, { color: '#b7babd', weight: 600, align: 'center', font: CONDENSED });
  m.text('OK', STATUS_LED.u - 2.2, STATUS_LED.v, 1.35, { color: '#e6e6e6', weight: 700, align: 'right' });
  const win = (u: number, v: number) => {
    m.rect(u - 1.15, v - 0.7, 2.3, 1.4, '#030304', 0.45);
    m.strokeRect(u - 1.15, v - 0.7, 2.3, 1.4, '#34373b', 0.12, 0.45);
  };
  for (const p of headLedLayout(st.points)) {
    const right = p.u > wMm / 2;
    m.text(String(p.n), right ? p.u + 2.0 : p.u - 2.0, p.v, 1.35, { color: '#e8e8e8', weight: 700, align: right ? 'left' : 'right' });
    win(p.u, p.v);
  }
  win(STATUS_LED.u, STATUS_LED.v);
}

const RTB_PRINT = { w: W - 0.0014, h: RTB_H - 0.0016 };

/** RTB front print with transparent holes over the real wire entries / screw wells. */
function drawRtb(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, catalog: Module5069Catalog) {
  const st = STYLES[catalog];
  const wMm = RTB_PRINT.w * 1000;
  const v0 = (RTB_CY - RTB_PRINT.h / 2) * 1000; // print bottom in module mm
  ctx.fillStyle = '#1c1d20';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.035, 5);
  const pitch = (RTB_H * 1000) / 9;
  for (let n = 0; n < 18; n++) {
    const t = rtbTerminal(n);
    const cu = t.u * 1000 + wMm / 2;
    const cv = t.v * 1000 - v0;
    // funnel chamfer ring around the holes
    m.circle(cu, cv + WELL.dy * 1000, WELL.r * 1000 + 0.35, '#0e0f11');
    m.rect(cu - ENTRY.w * 500 - 0.3, cv + ENTRY.dy * 1000 - ENTRY.h * 500 - 0.3, ENTRY.w * 1000 + 0.6, ENTRY.h * 1000 + 0.6, '#0e0f11', 0.6);
    const label = st.terminals[n] ?? String(n);
    m.text(label, n % 2 === 0 ? 0.35 : wMm - 0.35, cv - 2.6 + 0.6, label.length > 2 ? 0.9 : 1.2, {
      color: '#d9d9d9',
      weight: 700,
      align: n % 2 === 0 ? 'left' : 'right',
      font: CONDENSED,
    });
    if (n % 2 === 0 && n < 16) m.line(0.6, cv - pitch / 2, wMm - 0.6, cv - pitch / 2, '#2a2c30', 0.18);
  }
  // punch the holes
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let n = 0; n < 18; n++) {
    const t = rtbTerminal(n);
    const cu = t.u * 1000 + wMm / 2;
    const cv = t.v * 1000 - v0;
    m.circle(cu, cv + WELL.dy * 1000, WELL.r * 1000 + 0.05, '#000');
    m.rect(cu - ENTRY.w * 500 - 0.05, cv + ENTRY.dy * 1000 - ENTRY.h * 500 - 0.05, ENTRY.w * 1000 + 0.1, ENTRY.h * 1000 + 0.1, '#000', 0.45);
  }
  ctx.restore();
}

/** Recess floor: dark clamp openings at the bottom of each wire entry. */
function drawRtbFloor(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const wMm = RTB_PRINT.w * 1000;
  const v0 = (RTB_CY - RTB_PRINT.h / 2) * 1000;
  ctx.fillStyle = '#141517';
  ctx.fillRect(0, 0, w, h);
  for (let n = 0; n < 18; n++) {
    const t = rtbTerminal(n);
    const cu = t.u * 1000 + wMm / 2;
    const cv = t.v * 1000 - v0 + ENTRY.dy * 1000;
    m.rect(cu - 1.3, cv - 1.2, 2.6, 2.1, '#010101', 0.3);
    m.rect(cu - 1.3, cv + 0.9, 2.6, 0.35, '#5c6166', 0.1); // clamp edge
  }
}

export function drawVents(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, wMm: number, dMm: number) {
  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, w, h);
  const n = Math.floor((dMm - 8) / 4.2);
  for (let i = 0; i < n; i++) m.rect(2.2, 5 + i * 4.2, wMm - 4.4, 1.9, '#060607', 0.9);
}

/** Back face: molded DIN-rail channel + product marks. */
export function drawBack(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, wMm: number, railY = RAIL_Y) {
  ctx.fillStyle = '#212327';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 31);
  const y0 = railY * 1000 - 17.5 - 0.003 * 1000;
  m.rect(0, y0, wMm, 36, '#131416');
  m.line(0, y0, wMm, y0, '#3a3d42', 0.5);
  m.line(0, y0 + 36, wMm, y0 + 36, '#3a3d42', 0.5);
  for (let x = 2; x < wMm - 1; x += 4) m.line(x, y0 + 3, x, y0 + 33, '#1c1d20', 1.2);
  m.rect(wMm / 2 - 3, 2, 6, 7, '#2d3035', 0.8);
  m.text('▲', wMm / 2, 12, 2.2, { color: '#4a4e53', weight: 700, align: 'center' });
}

function drawSideLabel(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, catalog: Module5069Catalog) {
  const st = STYLES[catalog];
  ctx.fillStyle = '#212327';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d9dbdc';
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, 14);
  ctx.fill();
  m.text('Compact 5000 I/O', 3, 45.5, 3.4, { color: '#1b1b1b', weight: 800 });
  m.text(`CAT ${catalog}`, 3, 40, 3.2, { color: '#1b1b1b', weight: 700 });
  m.text('SER A', 57, 40, 2.6, { color: '#1b1b1b', weight: 700, align: 'right' });
  m.line(3, 37.5, 57, 37.5, '#555', 0.25);
  const rows =
    st.kind === 'DI'
      ? ['16 Inputs, 24V DC Sink', 'Input: 10…32V DC, 6 mA', 'MOD Power: 18…32V DC, 75 mA', 'SA Power: 18…32V DC']
      : st.kind === 'DO'
        ? ['16 Outputs, 24V DC Source', 'Output: 10…32V DC, 0.5 A/pt', 'MOD Power: 18…32V DC, 75 mA', 'SA Power: 18…32V DC, 8 A']
        : st.kind === 'AI'
          ? ['8 Ch Analog Input', '±10V, 0…20 mA, 4…20 mA', 'MOD Power: 18…32V DC, 90 mA', 'SA Power: 18…32V DC, 100 mA']
          : ['4 Ch Analog Output', '±10V, 0…20 mA, 4…20 mA', 'MOD Power: 18…32V DC, 90 mA', 'SA Power: 18…32V DC, 400 mA'];
  rows.forEach((r, i) => m.text(r, 3, 34.5 - i * 3.6, 2.4, { color: '#2a2a2a', weight: 500 }));
  m.text('Temperature code T4', 3, 18.6, 2.2, { color: '#2a2a2a', weight: 500 });
  barcode(m, 3, 5, 32, 7.5, catalog.length * 97);
  m.text('IND. CONT. EQ.', 40, 10, 2.2, { color: '#2a2a2a', weight: 700 });
  m.strokeRect(38.5, 5, 18.5, 9.5, '#333', 0.3, 1.5);
  m.text('Made in U.S.A.', 3, 2.4, 1.9, { color: '#444', weight: 500 });
}

const VENT = { w: W - 0.003, d: 0.07, z0: 0.012 };

function moduleAtlas(catalog: Module5069Catalog): Atlas {
  return buildAtlas(`5069:${catalog}`, [
    { id: 'head', wMm: W * 1000 - 1.2, hMm: HEAD_H * 1000, ppm: 22, roughness: 0.35, bg: '#16171a', draw: (m, c, w, h) => drawHead(m, c, w, h, catalog) },
    { id: 'rtb', wMm: RTB_PRINT.w * 1000, hMm: RTB_PRINT.h * 1000, ppm: 22, roughness: 0.72, bg: '#1c1d20', draw: (m, c, w, h) => drawRtb(m, c, w, h, catalog) },
    { id: 'floor', wMm: RTB_PRINT.w * 1000, hMm: RTB_PRINT.h * 1000, ppm: 6, roughness: 0.8, bg: '#141517', draw: drawRtbFloor },
    { id: 'vents', wMm: VENT.w * 1000, hMm: VENT.d * 1000, ppm: 8, roughness: 0.7, bg: '#26282c', draw: (m, c, w, h) => drawVents(m, c, w, h, VENT.w * 1000, VENT.d * 1000) },
    { id: 'back', wMm: W * 1000 - 1, hMm: (H - 0.006) * 1000, ppm: 4, roughness: 0.7, bg: '#212327', draw: (m, c, w, h) => drawBack(m, c, w, h, W * 1000 - 1) },
    { id: 'side', wMm: 60, hMm: 50, ppm: 10, roughness: 0.5, bg: '#212327', draw: (m, c, w, h) => drawSideLabel(m, c, w, h, catalog) },
  ]);
}

function moduleDecals(catalog: Module5069Catalog, sideLabel: boolean) {
  const atlas = moduleAtlas(catalog);
  const placements = [
    { id: 'head', center: [0, HEAD_Y0 + HEAD_H / 2, D + 0.0002] as [number, number, number], size: [W - 0.0012, HEAD_H] as [number, number] },
    { id: 'rtb', center: [0, RTB_CY, M5069.rtbFront + 0.0002] as [number, number, number], size: [RTB_PRINT.w, RTB_PRINT.h] as [number, number] },
    { id: 'floor', center: [0, RTB_CY, M5069.rtbFront - RECESS + 0.0001] as [number, number, number], size: [RTB_PRINT.w, RTB_PRINT.h] as [number, number] },
    { id: 'vents', center: [0, H + 0.0002, VENT.z0 + VENT.d / 2] as [number, number, number], size: [VENT.w, VENT.d] as [number, number], rotation: [-Math.PI / 2, 0, 0] as [number, number, number] },
    { id: 'vents', center: [0, -0.0002, VENT.z0 + VENT.d / 2] as [number, number, number], size: [VENT.w, VENT.d] as [number, number], rotation: [Math.PI / 2, 0, 0] as [number, number, number] },
    { id: 'back', center: [0, 0.003 + (H - 0.006) / 2, -0.0002] as [number, number, number], size: [W - 0.001, H - 0.006] as [number, number], rotation: [0, Math.PI, 0] as [number, number, number] },
  ];
  if (sideLabel) placements.push({ id: 'side', center: [W / 2 + 0.0002, 0.062, 0.042], size: [0.06, 0.05], rotation: [0, Math.PI / 2, 0] });
  return { atlas, geometry: decalGeometry(`${catalog}:${sideLabel}`, atlas, placements) };
}

// ---------------------------------------------------------------------------
// Body geometry (shared by every module): housing + RTB core + holed RTB front plate + latches
// ---------------------------------------------------------------------------

function rtbHoles(yc: number): HoleSpec[] {
  const holes: HoleSpec[] = [];
  for (let n = 0; n < 18; n++) {
    const t = rtbTerminal(n);
    holes.push({ kind: 'circle', x: t.u, y: t.v + WELL.dy - yc, r: WELL.r });
    holes.push({ kind: 'rect', x: t.u, y: t.v + ENTRY.dy - yc, w: ENTRY.w, h: ENTRY.h, r: 0.0004 });
  }
  return holes;
}

/** RTB core + holed front plate (shared with the controller's power RTBs via `powerRtbParts`). */
function moduleBodyGeometry() {
  return cachedGeometry('5069-body', () => {
    const coreD = RTB_D - RECESS;
    return mergeColored([
      [housingGeometry(), COLORS.moduleCharcoal],
      [roundedBox(W - 0.0012, RTB_H, coreD, 0.0008), '#1c1d20', xf([0, RTB_CY, M5069.bodyFront + coreD / 2])],
      [holedPlate(W - 0.0012, RTB_H, RECESS, 0.0008, rtbHoles(RTB_CY)), '#1c1d20', xf([0, RTB_CY, M5069.rtbFront - RECESS])],
      // RTB release latch: tucked under the head overhang, above the RTB, front ≤ module front
      [latchGeometry(), '#3a3e43', xf([0, M5069.rtbTop + 0.0001, M5069.rtbFront - 0.0022])],
      // DIN-rail latch tab at the bottom back
      [roundedBox(0.009, 0.0035, 0.012, 0.0006), '#3a3e43', xf([0, -0.0006, 0.009])],
    ]);
  });
}

function latchGeometry() {
  return cachedGeometry('5069-latch-v2', () => {
    // side profile (z, y): 2 mm deep tab with a grip ridge; extruded 8 mm across X
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.0032, 0);
    s.lineTo(0.0032, 0.0012);
    s.lineTo(0.0024, 0.0024);
    s.lineTo(0, 0.0024);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelSize: 0.0002, bevelThickness: 0.0002, bevelSegments: 1 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.004, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}

const wireMaterial = () =>
  cachedMaterial('vcol-wire', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 }));

/** Default duct target for a standalone module (panel at z = -7.5 mm behind the module, DUCT below). */
export function defaultDuctTarget(panelZ = -0.0075, phase = -W / 2 - 0.004): DuctTarget {
  return { top: -DUCT.gap, zMin: panelZ + DUCT.wall, zMax: panelZ + DUCT.depth, pitch: DUCT.pitch, phase };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface Module5069Props extends Placement {
  catalog: Module5069Catalog;
  /** Digital point state (DI: input image, DO: output driven to field). */
  getPoint?: (index: number) => boolean;
  /** Digital point fault (the 5069-OB16 / IB16 point indicators are bi-color yellow/red). */
  getPointFault?: (index: number) => boolean;
  /** Analog channel value (engineering units); NaN = channel fault (red LED). */
  getChannel?: (ch: number) => number;
  /** Module status indicator (green unless getModuleStatusColor says otherwise). Default: steady green. */
  getModuleStatus?: () => LedMode;
  getModuleStatusColor?: () => LedColor;
  /** Show field wiring in the RTB. */
  wired?: boolean;
  /** Points (digital) / channels (analog) to wire when `wired` (default all); commons/shield/SA are added automatically. */
  wiredPoints?: number[];
  /** Where the wires go, in module-local coordinates (default: a DUCT below the module); null = bend back into the panel. */
  duct?: DuctTarget | null;
  /** Field wire insulation color for DC signal wires (default blue per NFPA 79). */
  wireColor?: string;
  /** Print the product label on the right side (hidden inside a rack, so off there). Default true. */
  sideLabel?: boolean;
  highlighted?: boolean;
  onSelect?: () => void;
}

const zero = () => false;
const on = (): LedMode => 'on';
const green = (): LedColor => 'green';

export function Module5069({
  catalog,
  getPoint = zero,
  getPointFault,
  getChannel,
  getModuleStatus = on,
  getModuleStatusColor = green,
  wired = false,
  wiredPoints,
  duct,
  wireColor,
  sideLabel = true,
  highlighted = false,
  onSelect,
  position,
  rotation,
  scale,
}: Module5069Props) {
  const st = STYLES[catalog];
  const { hovered, handlers } = usePick(onSelect);
  const decals = moduleDecals(catalog, sideLabel);

  const headZ = D + 0.0002;
  const ledPositions = useMemo<Array<[number, number, number]>>(
    () =>
      [{ u: STATUS_LED.u, v: STATUS_LED.v }, ...headLedLayout(st.points)].map((p) => [p.u / 1000 - W / 2, HEAD_Y0 + p.v / 1000, headZ + 0.0001]),
    [st.points, headZ],
  );
  const screwPositions = useMemo<Array<[number, number, number]>>(
    () =>
      Array.from({ length: 18 }, (_, n) => {
        const t = rtbTerminal(n);
        return [t.u, t.v + WELL.dy, M5069.rtbFront - 0.0005];
      }),
    [],
  );

  const analog = st.kind === 'AI' || st.kind === 'AO';
  const getLed = useMemo(
    () =>
      (i: number): LedMode => {
        if (i === 0) return getModuleStatus();
        if (analog) {
          const v = getChannel ? getChannel(i - 1) : 0;
          return Number.isFinite(v) ? 'on' : 'flash';
        }
        return getPoint(i - 1) || (getPointFault?.(i - 1) ?? false);
      },
    [analog, getChannel, getPoint, getPointFault, getModuleStatus],
  );
  const ledColor = useMemo(
    () =>
      (i: number): LedColor => {
        if (i === 0) return getModuleStatusColor();
        if (analog) {
          const v = getChannel ? getChannel(i - 1) : 0;
          return Number.isFinite(v) ? 'green' : 'red';
        }
        return getPointFault?.(i - 1) ? 'red' : 'yellow';
      },
    [analog, getChannel, getPointFault, getModuleStatusColor],
  );

  const wiring = useMemo(
    () => (wired ? wiringGeometry({ catalog, points: wiredPoints, duct: duct === undefined ? defaultDuctTarget() : duct, signalColor: wireColor }) : null),
    [wired, catalog, wiredPoints, duct, wireColor],
  );

  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      <mesh geometry={moduleBodyGeometry()} material={vertexColorPlastic()} castShadow receiveShadow />
      <mesh geometry={decals.geometry} material={decals.atlas.material} receiveShadow />
      <PointLeds positions={ledPositions} size={[0.0018, 0.001, 0.0006]} get={getLed} color={ledColor} intensity={1.8} />
      <StaticInstances geometry={screwHeadGeometry(0.00135, 0.001, 'combo')} material={vertexColorMetal()} positions={screwPositions} />
      {wiring && <mesh geometry={wiring} material={wireMaterial()} castShadow receiveShadow />}

      {(highlighted || hovered) && (
        <HighlightFrame center={[0, H / 2, D / 2 + 0.001]} size={[W + 0.0015, H + 0.002, D + 0.004]} strength={highlighted ? 1 : 0.35} />
      )}
    </group>
  );
}

export const MODULE_5069_WIDTH = W;
