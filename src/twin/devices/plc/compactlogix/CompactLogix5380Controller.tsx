/**
 * CompactLogix 5380 controller (5069-L320ER / 5069-L330ERM ...) digital twin.
 *
 * Real proportions (5069-TD002): 143.97 × 98.10 × 136.81 mm (H × W × D). The 5380 L3 shares the mechanical
 * packaging of the 5069-AEN2TR adapter: a left power column carrying the MOD power (4-pin) and SA power
 * (6-pin) removable terminal blocks, and a deeper main body with the 4-character dot-matrix status display,
 * status indicators (SA PWR, MOD PWR, RUN, FORCE, SD, OK, NET/LINK A1/A2), the 3-position mode switch
 * (RUN/REM/PROG), SD card slot, USB port and the two 1 Gb EtherNet/IP RJ45 ports (A1/A2) on the flat
 * UNDERSIDE (patch-cable boots point straight down). Product label on the left side (always exposed in a
 * rack), DIN-rail channel + latch tabs on the back, vents top and bottom.
 *
 * Draw calls: body (merged) + metal (merged) + smoked panel + print (atlas) + display + glass + LEDs
 * (instanced) + mode-switch lever + cables (2).
 *
 * Origin: center of the back mounting face at the bottom edge. Front faces +Z.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { COLORS, type LedColor, type LedMode } from '../../../common';
import type { Placement, RackLive } from '../../../contracts';
import type { ControllerStatus, KeySwitch } from '../../../../plc/types';
import { buildAtlas, decalGeometry, type DecalPlacement } from './atlas';
import { barcode, CONDENSED, grain, type MmCtx } from './canvas';
import { box, cachedGeometry, holedPlate, mergeColored, profileGeometry, roundedBox, screwHeadGeometry, xf, type HoleSpec } from './geometry';
import { ENTRY, housingGeometry, M5069, WELL } from './m5069';
import { drawBack, drawVents } from './Module5069';
import {
  activityFlicker,
  cableBootMaterial,
  cachedMaterial,
  DotMatrixDisplay,
  downCablesGeometry,
  downPlugsGeometry,
  drawRj45Face,
  glossyBlack,
  HighlightFrame,
  plugClearMaterial,
  PointLeds,
  usePick,
  vertexColorMetal,
  vertexColorPlastic,
  type DownCable,
} from './parts';

export type CompactLogix5380Catalog = '5069-L320ER' | '5069-L330ERM' | '5069-L306ER' | '5069-L310ER' | '5069-L340ER' | '5069-L350ERM';

export const CPX_CTRL = {
  width: 0.0981,
  height: 0.14397,
  depth: 0.13681,
  powerColumn: 0.022,
} as const;

const W = CPX_CTRL.width;
const H = CPX_CTRL.height;
const D = CPX_CTRL.depth;
const PW = CPX_CTRL.powerColumn;
const MW = W - PW;
const X_LEFT = -W / 2;
const X_MAIN = X_LEFT + PW + MW / 2; // main-body center x
const X_PWR = X_LEFT + PW / 2;

// Front-face layout in mm (u from main-body left edge, v from the bottom).
const U = (u: number) => X_LEFT + PW + u / 1000;
const V = (v: number) => v / 1000;

const PANEL = { u: 4, v: 88, w: 68, h: 48 } as const; // smoked display/indicator panel
const DISPLAY = { u: 4 + 4, v: 88 + 27.5, w: 33, h: 11 } as const;
const LED_ROWS = [23, 19.2, 15.4, 11.6, 7.8, 4].map((r) => 88 + r);
const LED_COL = [4 + 5, 4 + 38];
const POCKET = { u: 4, v: 46, w: 68, h: 38 } as const;
const SWITCH = { u: 11, vRun: 78.5, vRem: 71.5, vProg: 64.5 } as const;
const SD = { u: 49, v: 77.5 } as const;
const USB = { u: 49, v: 57 } as const;
/** RJ45 jacks on the underside: u (mm from main-body left edge) and face-center depth z. */
const JACKS = [22, 54];
const JACK_Z = D - 0.0105;
const FACE = { v0: 2, v1: H * 1000 - 6.2 } as const;

type IndicatorId = 'SA PWR' | 'MOD PWR' | 'RUN' | 'FORCE' | 'SD' | 'OK' | 'NET A1' | 'LINK A1' | 'NET A2' | 'LINK A2';
const INDICATORS: Array<{ id: IndicatorId; col: 0 | 1; row: number }> = [
  { id: 'SA PWR', col: 0, row: 0 },
  { id: 'MOD PWR', col: 0, row: 1 },
  { id: 'RUN', col: 0, row: 2 },
  { id: 'FORCE', col: 0, row: 3 },
  { id: 'SD', col: 0, row: 4 },
  { id: 'OK', col: 0, row: 5 },
  { id: 'NET A1', col: 1, row: 0 },
  { id: 'LINK A1', col: 1, row: 1 },
  { id: 'NET A2', col: 1, row: 2 },
  { id: 'LINK A2', col: 1, row: 3 },
];

/** Power RTB legends: MOD (4 terminals) above SA (6 terminals). u relative to the power column center. */
const PWR_TERMS: Array<{ label: string; u: number; v: number; group: 'MOD' | 'SA' }> = [
  { label: 'MOD+', u: -0.005, v: 0.0925, group: 'MOD' },
  { label: 'MOD+', u: 0.005, v: 0.0925, group: 'MOD' },
  { label: 'MOD-', u: -0.005, v: 0.0805, group: 'MOD' },
  { label: 'MOD-', u: 0.005, v: 0.0805, group: 'MOD' },
  { label: 'SA+', u: -0.005, v: 0.0555, group: 'SA' },
  { label: 'SA+', u: 0.005, v: 0.0555, group: 'SA' },
  { label: 'SA-', u: -0.005, v: 0.0435, group: 'SA' },
  { label: 'SA-', u: 0.005, v: 0.0435, group: 'SA' },
  { label: 'FE', u: -0.005, v: 0.0315, group: 'SA' },
  { label: 'FE', u: 0.005, v: 0.0315, group: 'SA' },
];
const PWR_RTB = { MOD: { y0: 0.0725, y1: 0.103 }, SA: { y0: 0.0045, y1: 0.0695 } } as const;
const POWER_HEAD_H = 0.0319;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Main body side profile (z, y): square bottom (the RJ45 ports sit in the flat underside). */
const MAIN_PROFILE: Array<[number, number]> = [
  [0, 0.002],
  [0.002, 0],
  [D - 0.002, 0],
  [D, 0.002],
  [D, H - 0.006],
  [D - 0.006, H],
  [0.004, H],
  [0, H - 0.003],
];

function powerRtbHoles(group: 'MOD' | 'SA', yc: number): HoleSpec[] {
  const holes: HoleSpec[] = [];
  for (const t of PWR_TERMS.filter((p) => p.group === group)) {
    holes.push({ kind: 'circle', x: t.u, y: t.v + WELL.dy - yc, r: WELL.r });
    holes.push({ kind: 'rect', x: t.u, y: t.v + ENTRY.dy - yc, w: ENTRY.w, h: ENTRY.h, r: 0.0004 });
  }
  return holes;
}

function latchParts(y: number): Array<[THREE.BufferGeometry, string, THREE.Matrix4]> {
  return [[roundedBox(0.008, 0.0022, 0.0028, 0.0005), '#3a3e43', xf([X_PWR, y, M5069.rtbFront - 0.0008])]];
}

function bodyGeometry() {
  return cachedGeometry('5380-body', () => {
    const rtbD = M5069.rtbFront - M5069.bodyFront;
    const coreD = rtbD - M5069.rtbRecess;
    const parts: Array<[THREE.BufferGeometry, string, THREE.Matrix4?]> = [
      [housingGeometry(PW), COLORS.moduleCharcoal, xf([X_PWR, 0, 0])],
      [profileGeometry('5380-main-v2', MAIN_PROFILE, MW, 0.0007), '#232528', xf([X_MAIN, 0, 0])],
    ];
    for (const g of ['MOD', 'SA'] as const) {
      const { y0, y1 } = PWR_RTB[g];
      const h = y1 - y0;
      const yc = y0 + h / 2;
      parts.push([roundedBox(PW - 0.0012, h, coreD, 0.0008), '#1c1d20', xf([X_PWR, yc, M5069.bodyFront + coreD / 2])]);
      parts.push([holedPlate(PW - 0.0012, h, M5069.rtbRecess, 0.0008, powerRtbHoles(g, yc)), '#1c1d20', xf([X_PWR, yc, M5069.rtbFront - M5069.rtbRecess])]);
      parts.push(...latchParts(y1 + 0.0013));
    }
    // pocket rim (raised frame around the switch / SD / USB pocket)
    const cx = U(POCKET.u + POCKET.w / 2);
    const cy = V(POCKET.v + POCKET.h / 2);
    const pw = POCKET.w / 1000;
    const ph = POCKET.h / 1000;
    const t = 0.0016;
    const z = D + 0.0009;
    parts.push(
      [box(pw + 2 * t, t, 0.0018), '#2c2f33', xf([cx, cy + ph / 2 + t / 2, z])],
      [box(pw + 2 * t, t, 0.0018), '#2c2f33', xf([cx, cy - ph / 2 - t / 2, z])],
      [box(t, ph, 0.0018), '#2c2f33', xf([cx - pw / 2 - t / 2, cy, z])],
      [box(t, ph, 0.0018), '#2c2f33', xf([cx + pw / 2 + t / 2, cy, z])],
    );
    // SD card edge (label is printed in the atlas), USB-B insulator + tongue
    parts.push([box(0.024, 0.0021, 0.004), '#2d3136', xf([U(SD.u), V(SD.v), D + 0.0005])]);
    parts.push([box(0.0104, 0.0092, 0.0004), '#050506', xf([U(USB.u), V(USB.v), D + 0.0006])]);
    parts.push([box(0.0066, 0.0036, 0.0024), '#e8e8e2', xf([U(USB.u), V(USB.v) + 0.0003, D + 0.0019])]);
    // DIN latch tabs at the bottom back
    parts.push([roundedBox(0.009, 0.0035, 0.012, 0.0006), '#3a3e43', xf([X_PWR, -0.0006, 0.009])]);
    parts.push([roundedBox(0.012, 0.0035, 0.012, 0.0006), '#3a3e43', xf([X_MAIN, -0.0006, 0.009])]);
    return mergeColored(parts);
  });
}

function usbShellGeometry() {
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
  return new THREE.ExtrudeGeometry(s, { depth: 0.0045, bevelEnabled: false });
}

/** Metal parts in one draw: USB-B shell + power RTB screws (sunk 0.5 mm into their wells). */
function metalGeometry() {
  return cachedGeometry('5380-metal', () => {
    const parts: Array<[THREE.BufferGeometry, string | null, THREE.Matrix4?]> = [[usbShellGeometry(), '#c3c7cb', xf([U(USB.u), V(USB.v), D - 0.0005])]];
    for (const t of PWR_TERMS) parts.push([screwHeadGeometry(0.00135, 0.001, 'combo'), null, xf([X_PWR + t.u, t.v + WELL.dy, M5069.rtbFront - 0.0005])]);
    return mergeColored(parts);
  });
}

function leverGeometry() {
  return cachedGeometry('5380-lever', () =>
    mergeColored([
      [roundedBox(0.0036, 0.0048, 0.0036, 0.0008), '#d8dadc'],
      [box(0.0028, 0.0005, 0.0002), '#6b7075', xf([0, 0, 0.0019])],
    ]),
  );
}

// ---------------------------------------------------------------------------
// Print (atlas)
// ---------------------------------------------------------------------------

const memOf = (catalog: string) =>
  catalog.includes('L306') ? '0.6 MB' : catalog.includes('L310') ? '1 MB' : catalog.includes('L320') ? '2 MB' : catalog.includes('L330') ? '3 MB' : catalog.includes('L340') ? '4 MB' : '5 MB';

function drawPanel(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, catalog: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#15171a');
  g.addColorStop(1, '#0b0c0e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  m.text('CompactLogix', 4, PANEL.h - 4.2, 3.4, { color: '#f4f4f2', weight: 700 });
  m.text('5380', 4 + 24.2, PANEL.h - 4.2, 3.4, { color: '#f4f4f2', weight: 400 });
  m.text(catalog, PANEL.w - 3.5, PANEL.h - 4.2, 2.4, { color: '#c9ccd0', weight: 600, align: 'right' });
  m.rect(DISPLAY.u - PANEL.u - 1.2, DISPLAY.v - PANEL.v - 1.2, DISPLAY.w + 2.4, DISPLAY.h + 2.4, '#2c2f33', 1.2);
  m.rect(DISPLAY.u - PANEL.u - 0.4, DISPLAY.v - PANEL.v - 0.4, DISPLAY.w + 0.8, DISPLAY.h + 0.8, '#020202', 0.8);
  m.text('LOGIX', 44, 88 + 36 - PANEL.v, 2.3, { color: '#9fa4aa', weight: 700, letterSpacing: 0.4 });
  m.text(`${memOf(catalog)} · 1 Gb`, 44, 88 + 32 - PANEL.v, 1.9, { color: '#8d9298', weight: 600 });
  m.text(catalog.endsWith('M') ? 'MOTION' : 'EtherNet/IP', 44, 88 + 28.6 - PANEL.v, 1.9, { color: '#8d9298', weight: 600 });
  for (const ind of INDICATORS) {
    const u = LED_COL[ind.col]! - PANEL.u;
    const v = LED_ROWS[ind.row]! - PANEL.v;
    m.rect(u - 1.4, v - 0.85, 2.8, 1.7, '#010101', 0.5);
    m.strokeRect(u - 1.4, v - 0.85, 2.8, 1.7, '#2e3135', 0.15, 0.5);
    m.text(ind.id, u + 2.5, v, 2.05, { color: '#eceeee', weight: 700, font: CONDENSED });
  }
  m.line(35, 3, 35, 25, '#2a2d31', 0.25);
}

function drawFace(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const off = FACE.v0;
  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 3);
  // write-on IP label + MAC / serial label
  m.rect(5, 30 - off, 34, 11, '#e9e9e4', 0.6);
  m.text('IP ADDRESS', 7, 38.6 - off, 1.8, { color: '#333', weight: 700 });
  m.text('192.168.1.10', 7, 34.2 - off, 2.6, { color: '#1c3f94', weight: 600, font: 'Comic Sans MS, cursive' });
  m.line(7, 32.3 - off, 37, 32.3 - off, '#9a9a96', 0.15);
  m.rect(43, 30 - off, 26, 11, '#d7d9db', 0.6);
  m.text('MAC 5C:88:16:A3:0F:2E', 44.2, 38.8 - off, 1.25, { color: '#333', weight: 600, font: CONDENSED });
  barcode(m, 44.2, 31.6 - off, 23.5, 4.8, 42);
  m.text('SER A  FW 36.011', 44.2, 30.8 - off, 1.05, { color: '#333', weight: 600, font: CONDENSED });
  // molded marks
  m.text('Class 1 Div 2 · IP20', 38, 24 - off, 1.3, { color: '#5d6166', weight: 600, align: 'center' });
  // port legends along the bottom front edge (the jacks are on the underside, right below)
  m.rect(3, 2.5 - off + 0.5, 70, 10.5, '#1e2023', 1);
  for (const [i, u] of JACKS.entries()) {
    m.text(`A${i + 1}`, u, 9.6 - off + 0.5, 2.8, { color: '#f0f0f0', weight: 800, align: 'center' });
    m.text('1 Gb', u, 6.4 - off + 0.5, 1.5, { color: '#b9bcbf', weight: 600, align: 'center' });
    m.text('▼', u, 4.1 - off + 0.3, 1.8, { color: '#d0d2d4', weight: 700, align: 'center' });
  }
  m.text('ETHERNET', 38, 8.3 - off + 0.5, 1.5, { color: '#b9bcbf', weight: 700, align: 'center', letterSpacing: 0.25 });
  m.text('▼  ▼', 38, 4.6 - off + 0.3, 1.4, { color: '#8d9196', weight: 700, align: 'center' });
}

function drawPocket(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#131416';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 9);
  const sx = SWITCH.u - POCKET.u;
  m.rect(sx - 2.4, SWITCH.vProg - POCKET.v - 3.4, 4.8, SWITCH.vRun - SWITCH.vProg + 6.8, '#050506', 2.2);
  for (const [lab, v] of [
    ['RUN', SWITCH.vRun],
    ['REM', SWITCH.vRem],
    ['PROG', SWITCH.vProg],
  ] as const) {
    m.line(sx + 2.8, v - POCKET.v, sx + 4.3, v - POCKET.v, '#d9d9d9', 0.25);
    m.text(lab, sx + 5, v - POCKET.v, 2.2, { color: '#f0f0f0', weight: 700 });
  }
  m.rect(SD.u - POCKET.u - 14, SD.v - POCKET.v - 2.1, 28, 4.2, '#030303', 0.8);
  m.text('SD', SD.u - POCKET.u - 14, SD.v - POCKET.v - 5, 2.1, { color: '#f0f0f0', weight: 800 });
  m.text('Do not remove while SD indicator flashes', SD.u - POCKET.u - 9, SD.v - POCKET.v - 5, 1.15, { color: '#a9adb1', weight: 500 });
  m.text('USB', USB.u - POCKET.u + 9.5, USB.v - POCKET.v - 3.6, 2.0, { color: '#f0f0f0', weight: 800 });
  const tx = USB.u - POCKET.u + 9.8;
  const ty = USB.v - POCKET.v + 2.2;
  m.line(tx, ty, tx + 6, ty, '#e0e0e0', 0.35);
  m.circle(tx, ty, 0.6, '#e0e0e0');
  m.line(tx + 1.8, ty, tx + 3, ty + 1.3, '#e0e0e0', 0.3);
  m.line(tx + 3, ty + 1.3, tx + 4.2, ty + 1.3, '#e0e0e0', 0.3);
  m.line(tx + 2.6, ty, tx + 3.6, ty - 1.2, '#e0e0e0', 0.3);
  m.rect(tx + 3.6, ty - 1.6, 0.8, 0.8, '#e0e0e0');
  m.circle(tx + 4.4, ty + 1.3, 0.45, '#e0e0e0');
  m.text('Temporary local programming only', USB.u - POCKET.u - 40, USB.v - POCKET.v - 8.4, 1.1, { color: '#8d9196', weight: 500 });
}

function drawPowerHead(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const hMm = POWER_HEAD_H * 1000;
  ctx.fillStyle = '#16171a';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 21);
  m.rect(0.8, hMm - 2.2, PW * 1000 - 1.6, 1.3, '#9aa1a8', 0.3);
  m.text('POWER', 11, hMm - 4.6, 2.0, { color: '#ffffff', weight: 800, align: 'center', font: CONDENSED });
  m.text('MOD', 11, hMm - 9.5, 2.0, { color: '#e8e8e8', weight: 800, align: 'center' });
  m.text('18–32V DC', 11, hMm - 12, 1.35, { color: '#b5b8bb', weight: 600, align: 'center' });
  m.text('SA', 11, hMm - 17.5, 2.0, { color: '#e8e8e8', weight: 800, align: 'center' });
  m.text('0–32V DC', 11, hMm - 20, 1.35, { color: '#b5b8bb', weight: 600, align: 'center' });
  m.text('Class 2', 11, hMm - 26.5, 1.3, { color: '#8e9296', weight: 600, align: 'center' });
}

/** Power RTB print with transparent holes over the real screw wells / wire entries. */
function drawPowerRtb(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, group: 'MOD' | 'SA') {
  const wMm = PW * 1000 - 1.4;
  const { y0, y1 } = PWR_RTB[group];
  const hMm = (y1 - y0) * 1000 - 1.2;
  const v0 = y0 * 1000 + 0.6;
  ctx.fillStyle = '#1c1d20';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.035, group === 'MOD' ? 2 : 4);
  m.text(group === 'MOD' ? 'MOD POWER' : 'SA POWER', wMm / 2, hMm - 3.2, 1.45, { color: '#ffffff', weight: 800, align: 'center', font: CONDENSED });
  const terms = PWR_TERMS.filter((p) => p.group === group);
  for (const t of terms) {
    const cu = t.u * 1000 + wMm / 2;
    const cv = t.v * 1000 - v0;
    m.circle(cu, cv + WELL.dy * 1000, WELL.r * 1000 + 0.35, '#0e0f11');
    m.rect(cu - 2.05, cv + ENTRY.dy * 1000 - 1.95, 4.1, 3.9, '#0e0f11', 0.6);
    m.text(t.label, t.u < 0 ? 0.3 : wMm - 0.3, cv - 2.5 + 0.2, 0.95, { color: '#d9d9d9', weight: 700, align: t.u < 0 ? 'left' : 'right', font: CONDENSED });
  }
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const t of terms) {
    const cu = t.u * 1000 + wMm / 2;
    const cv = t.v * 1000 - v0;
    m.circle(cu, cv + WELL.dy * 1000, WELL.r * 1000 + 0.05, '#000');
    m.rect(cu - ENTRY.w * 500 - 0.05, cv + ENTRY.dy * 1000 - ENTRY.h * 500 - 0.05, ENTRY.w * 1000 + 0.1, ENTRY.h * 1000 + 0.1, '#000', 0.45);
  }
  ctx.restore();
}

function drawPowerFloor(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, group: 'MOD' | 'SA') {
  const wMm = PW * 1000 - 1.4;
  const v0 = PWR_RTB[group].y0 * 1000 + 0.6;
  ctx.fillStyle = '#141517';
  ctx.fillRect(0, 0, w, h);
  for (const t of PWR_TERMS.filter((p) => p.group === group)) {
    const cu = t.u * 1000 + wMm / 2;
    const cv = t.v * 1000 - v0 + ENTRY.dy * 1000;
    m.rect(cu - 1.3, cv - 1.2, 2.6, 2.1, '#010101', 0.3);
    m.rect(cu - 1.3, cv + 0.9, 2.6, 0.35, '#5c6166', 0.1);
  }
}

/** Underside of the main body: vents at the back, RJ45 surround + A1/A2 legends at the front. */
function drawUnderside(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const wMm = MW * 1000 - 2;
  const dMm = D * 1000 - 4;
  ctx.fillStyle = '#212327';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 41);
  // texture v = depth from the FRONT edge (plane is rotated so that v grows toward the back)
  for (let i = 0; i < 12; i++) m.rect(4, dMm - 16 - i * 4.8, wMm - 8, 2.2, '#060607', 1);
  // texture u runs from the body's RIGHT edge (plane rotated 180° about its normal)
  for (const [i, u] of JACKS.entries()) {
    const cu = wMm - u + 1;
    m.rect(cu - 9.6, 0.4, 19.2, 16.4, '#17181a', 1.2);
    m.text(`A${i + 1}`, cu - 11.2, 8.5, 2.4, { color: '#e6e6e6', weight: 800, align: 'right' });
  }
}

function drawLeftLabel(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, catalog: string) {
  ctx.fillStyle = '#26282c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#dadcdd';
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 16);
  ctx.fill();
  m.text('CompactLogix 5380 Controller', 3, 44, 3.3, { color: '#161616', weight: 800 });
  m.text(`CAT ${catalog}`, 3, 39, 3.1, { color: '#161616', weight: 700 });
  m.text('SER A', 61, 39, 2.5, { color: '#161616', weight: 700, align: 'right' });
  m.line(3, 36.6, 61, 36.6, '#555', 0.25);
  const rows = [
    `Logix 5000 · ${memOf(catalog)} user memory`,
    'MOD Power: 18…32V DC, 330 mA',
    'SA Power: 0…32V DC, 10 A max',
    'Ports A1/A2: 1 Gb EtherNet/IP · USB 2.0',
    'Temperature code T4',
  ];
  rows.forEach((r, i) => m.text(r, 3, 33.3 - i * 3.4, 2.25, { color: '#2a2a2a', weight: 500 }));
  m.text('MAC ID 5C:88:16:A3:0F:2E', 3, 15.3, 2.1, { color: '#222', weight: 700, font: CONDENSED });
  barcode(m, 3, 4.5, 34, 8, 5380 + catalog.length);
  m.text('IND. CONT. EQ.', 49.5, 10.2, 2.1, { color: '#2a2a2a', weight: 800, align: 'center' });
  m.strokeRect(40, 5, 19, 9.5, '#333', 0.3, 1.5);
  m.text('Made in U.S.A.', 61, 2.6, 1.7, { color: '#444', weight: 500, align: 'right' });
}

function drawSdEdge(_m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#2d3136';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#d8dadc';
  ctx.fillRect(w * 0.03, h * 0.18, w * 0.43, h * 0.64);
  ctx.fillStyle = '#222';
  ctx.font = `700 ${h * 0.5}px Arial`;
  ctx.textBaseline = 'middle';
  ctx.fillText('1784-SD2', w * 0.055, h / 2 + 1);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = '#3d4248';
    ctx.fillRect(w * (0.55 + i * 0.039), h * 0.12, w * 0.02, h * 0.76);
  }
}

const VENT_P = { w: PW - 0.003, d: 0.07, z0: 0.012 };
const VENT_M = { w: MW - 0.004, d: 0.1, z0: 0.018 };
const LEFT_LABEL = { w: 0.064, h: 0.048, z: 0.043, y: 0.072 };

function controllerAtlas(catalog: string) {
  const faceH = FACE.v1 - FACE.v0;
  const modH = (PWR_RTB.MOD.y1 - PWR_RTB.MOD.y0) * 1000 - 1.2;
  const saH = (PWR_RTB.SA.y1 - PWR_RTB.SA.y0) * 1000 - 1.2;
  return buildAtlas(`5380:${catalog}`, [
    { id: 'face', wMm: MW * 1000 - 1.4, hMm: faceH, ppm: 10, roughness: 0.55, bg: '#26282c', draw: drawFace },
    { id: 'panel', wMm: PANEL.w - 1.2, hMm: PANEL.h - 1.2, ppm: 15, roughness: 0.22, bg: '#101113', draw: (m, c, w, h) => drawPanel(m, c, w, h, catalog) },
    { id: 'pocket', wMm: POCKET.w, hMm: POCKET.h, ppm: 12, roughness: 0.75, bg: '#131416', draw: drawPocket },
    { id: 'phead', wMm: PW * 1000 - 1.2, hMm: POWER_HEAD_H * 1000, ppm: 20, roughness: 0.35, bg: '#16171a', draw: drawPowerHead },
    { id: 'prtbMOD', wMm: PW * 1000 - 1.4, hMm: modH, ppm: 22, roughness: 0.72, bg: '#1c1d20', draw: (m, c, w, h) => drawPowerRtb(m, c, w, h, 'MOD') },
    { id: 'prtbSA', wMm: PW * 1000 - 1.4, hMm: saH, ppm: 22, roughness: 0.72, bg: '#1c1d20', draw: (m, c, w, h) => drawPowerRtb(m, c, w, h, 'SA') },
    { id: 'pfloorMOD', wMm: PW * 1000 - 1.4, hMm: modH, ppm: 6, roughness: 0.8, bg: '#141517', draw: (m, c, w, h) => drawPowerFloor(m, c, w, h, 'MOD') },
    { id: 'pfloorSA', wMm: PW * 1000 - 1.4, hMm: saH, ppm: 6, roughness: 0.8, bg: '#141517', draw: (m, c, w, h) => drawPowerFloor(m, c, w, h, 'SA') },
    { id: 'ventP', wMm: VENT_P.w * 1000, hMm: VENT_P.d * 1000, ppm: 6, roughness: 0.7, bg: '#26282c', draw: (m, c, w, h) => drawVents(m, c, w, h, VENT_P.w * 1000, VENT_P.d * 1000) },
    { id: 'ventM', wMm: VENT_M.w * 1000, hMm: VENT_M.d * 1000, ppm: 6, roughness: 0.7, bg: '#26282c', draw: (m, c, w, h) => drawVents(m, c, w, h, VENT_M.w * 1000, VENT_M.d * 1000) },
    { id: 'under', wMm: MW * 1000 - 2, hMm: D * 1000 - 4, ppm: 5, roughness: 0.7, bg: '#212327', draw: drawUnderside },
    { id: 'backP', wMm: PW * 1000 - 1, hMm: (H - 0.006) * 1000, ppm: 4, roughness: 0.7, bg: '#212327', draw: (m, c, w, h) => drawBack(m, c, w, h, PW * 1000 - 1) },
    { id: 'backM', wMm: MW * 1000 - 1, hMm: (H - 0.006) * 1000, ppm: 4, roughness: 0.7, bg: '#212327', draw: (m, c, w, h) => drawBack(m, c, w, h, MW * 1000 - 1) },
    { id: 'left', wMm: LEFT_LABEL.w * 1000, hMm: LEFT_LABEL.h * 1000, ppm: 10, roughness: 0.5, bg: '#26282c', draw: (m, c, w, h) => drawLeftLabel(m, c, w, h, catalog) },
    { id: 'rj45', wMm: 15.8, hMm: 13.8, ppm: 10, roughness: 0.5, metalness: 0.2, bg: '#1a1b1d', draw: (_m, c, w, h) => drawRj45Face(c, w, h) },
    { id: 'sd', wMm: 24, hMm: 2.1, ppm: 12, roughness: 0.5, bg: '#2d3136', draw: drawSdEdge },
  ]);
}

function controllerDecals(catalog: string) {
  const atlas = controllerAtlas(catalog);
  const faceH = (FACE.v1 - FACE.v0) / 1000;
  const headY0 = M5069.headBottom + 0.001;
  const modH = PWR_RTB.MOD.y1 - PWR_RTB.MOD.y0 - 0.0012;
  const saH = PWR_RTB.SA.y1 - PWR_RTB.SA.y0 - 0.0012;
  const back: [number, number, number] = [0, Math.PI, 0];
  const up: [number, number, number] = [-Math.PI / 2, 0, 0];
  const down: [number, number, number] = [Math.PI / 2, 0, 0];
  const placements: DecalPlacement[] = [
    { id: 'face', center: [X_MAIN, V(FACE.v0) + faceH / 2, D + 0.0002], size: [MW - 0.0014, faceH] },
    { id: 'panel', center: [U(PANEL.u + PANEL.w / 2), V(PANEL.v + PANEL.h / 2), D + 0.0016], size: [PANEL.w / 1000 - 0.0012, PANEL.h / 1000 - 0.0012] },
    { id: 'pocket', center: [U(POCKET.u + POCKET.w / 2), V(POCKET.v + POCKET.h / 2), D + 0.0004], size: [POCKET.w / 1000, POCKET.h / 1000] },
    { id: 'phead', center: [X_PWR, headY0 + POWER_HEAD_H / 2, M5069.depth + 0.0002], size: [PW - 0.0012, POWER_HEAD_H] },
    { id: 'prtbMOD', center: [X_PWR, (PWR_RTB.MOD.y0 + PWR_RTB.MOD.y1) / 2, M5069.rtbFront + 0.0002], size: [PW - 0.0014, modH] },
    { id: 'prtbSA', center: [X_PWR, (PWR_RTB.SA.y0 + PWR_RTB.SA.y1) / 2, M5069.rtbFront + 0.0002], size: [PW - 0.0014, saH] },
    { id: 'pfloorMOD', center: [X_PWR, (PWR_RTB.MOD.y0 + PWR_RTB.MOD.y1) / 2, M5069.rtbFront - M5069.rtbRecess + 0.0001], size: [PW - 0.0014, modH] },
    { id: 'pfloorSA', center: [X_PWR, (PWR_RTB.SA.y0 + PWR_RTB.SA.y1) / 2, M5069.rtbFront - M5069.rtbRecess + 0.0001], size: [PW - 0.0014, saH] },
    { id: 'ventP', center: [X_PWR, M5069.height + 0.0002, VENT_P.z0 + VENT_P.d / 2], size: [VENT_P.w, VENT_P.d], rotation: up },
    { id: 'ventP', center: [X_PWR, -0.0002, VENT_P.z0 + VENT_P.d / 2], size: [VENT_P.w, VENT_P.d], rotation: down },
    { id: 'ventM', center: [X_MAIN, H + 0.0002, VENT_M.z0 + VENT_M.d / 2], size: [VENT_M.w, VENT_M.d], rotation: up },
    // underside: rotation so that texture v grows toward the back (v = 0 at the front edge)
    { id: 'under', center: [X_MAIN, -0.0002, D / 2], size: [MW - 0.002, D - 0.004], rotation: [Math.PI / 2, 0, Math.PI] },
    { id: 'backP', center: [X_PWR, 0.003 + (H - 0.006) / 2, -0.0002], size: [PW - 0.001, H - 0.006], rotation: back },
    { id: 'backM', center: [X_MAIN, 0.003 + (H - 0.006) / 2, -0.0002], size: [MW - 0.001, H - 0.006], rotation: back },
    { id: 'left', center: [X_LEFT - 0.0002, LEFT_LABEL.y, LEFT_LABEL.z], size: [LEFT_LABEL.w, LEFT_LABEL.h], rotation: [0, -Math.PI / 2, 0] },
    { id: 'sd', center: [U(SD.u), V(SD.v), D + 0.00251], size: [0.024, 0.0021] },
    ...JACKS.map((u): DecalPlacement => ({ id: 'rj45', center: [U(u), -0.0004, JACK_Z], size: [0.0158, 0.0138], rotation: down })),
  ];
  return { atlas, geometry: decalGeometry(catalog, atlas, placements) };
}

// ---------------------------------------------------------------------------
// Live mapping
// ---------------------------------------------------------------------------

const DEFAULT_STATUS: ControllerStatus = {
  mode: 'REM_PROG',
  keySwitch: 'REM',
  running: false,
  ok: 'green',
  runLed: 'off',
  forceLed: 'off',
  ioLed: 'flashing-green',
  displayText: 'Rem Prog',
  minorFaults: [],
  scanCount: 0,
  lastScanMs: 0,
  maxScanMs: 0,
  uptimeMs: 0,
  forcesInstalled: false,
  forcesEnabled: false,
  firstScan: false,
};

export interface CompactLogix5380ControllerProps extends Placement {
  catalog?: CompactLogix5380Catalog;
  /** Live controller connection (status() + setKeySwitch()). */
  live?: Pick<RackLive, 'status' | 'setKeySwitch'>;
  /** Alternative to `live`: plain status getter. */
  getStatus?: () => ControllerStatus;
  /** Called when the mode switch is clicked (in addition to live.setKeySwitch). */
  onKeySwitch?: (pos: KeySwitch) => void;
  /** Ethernet cables plugged into A1 / A2 (affects LINK/NET indicators and draws a patch cable). */
  cables?: [boolean, boolean];
  /**
   * Where the patch cables go, as [y, z] in controller-local coordinates (e.g. inside a wire duct below).
   * Default: they hang ~9 cm below the controller with a capped end.
   */
  cableTo?: [number, number];
  highlighted?: boolean;
  onSelect?: () => void;
}

const LENS: [number, number, number] = [0.0022, 0.0012, 0.0006];

export function CompactLogix5380Controller({
  catalog = '5069-L320ER',
  live,
  getStatus,
  onKeySwitch,
  cables = [true, false],
  cableTo,
  highlighted = false,
  onSelect,
  position,
  rotation,
  scale,
}: CompactLogix5380ControllerProps) {
  const localKey = useRef<KeySwitch>('REM');
  const status = useMemo(
    () => (): ControllerStatus => {
      if (live) return live.status();
      if (getStatus) return getStatus();
      return { ...DEFAULT_STATUS, keySwitch: localKey.current, displayText: localKey.current === 'RUN' ? 'Run' : localKey.current === 'PROG' ? 'Prog' : 'Rem Prog' };
    },
    [live, getStatus],
  );
  const displayText = useMemo(() => () => status().displayText, [status]);
  const keyPos = useMemo(() => () => status().keySwitch, [status]);
  const setKey = (pos: KeySwitch) => {
    localKey.current = pos;
    live?.setKeySwitch?.(pos);
    onKeySwitch?.(pos);
  };

  const { hovered, handlers } = usePick(onSelect);
  const [c0, c1] = cables;

  // indicators → one instanced LED draw (index = INDICATORS order)
  const leds = useMemo(() => {
    const connected = !!(live || getStatus);
    const get = (i: number): LedMode => {
      switch (INDICATORS[i]!.id) {
        case 'SA PWR':
        case 'MOD PWR':
          return true;
        case 'RUN':
          return status().runLed === 'green';
        case 'FORCE': {
          const f = status().forceLed;
          return f === 'amber' ? 'on' : f === 'flashing-amber' ? 'flash' : 'off';
        }
        case 'SD':
          return 'off';
        case 'OK': {
          const o = status().ok;
          return o === 'off' ? 'off' : o === 'flashing-red' ? 'flash' : 'on';
        }
        case 'NET A1':
          return !c0 ? 'off' : status().ioLed === 'flashing-red' ? 'flash' : connected ? 'on' : 'flash';
        case 'LINK A1':
          return c0 && activityFlicker(0);
        case 'NET A2':
          return c1 ? 'on' : 'off';
        case 'LINK A2':
          return c1 && activityFlicker(3);
      }
    };
    const color = (i: number): LedColor => {
      const id = INDICATORS[i]!.id;
      if (id === 'FORCE') return 'amber';
      if (id === 'OK') return status().ok === 'green' ? 'green' : 'red';
      if (id === 'NET A1') return status().ioLed === 'flashing-red' ? 'red' : 'green';
      return 'green';
    };
    const positions = INDICATORS.map((ind): [number, number, number] => [U(LED_COL[ind.col]!), V(LED_ROWS[ind.row]!), D + 0.0019]);
    return { get, color, positions };
  }, [status, c0, c1, live, getStatus]);

  const decals = controllerDecals(catalog);
  const cableGeo = useMemo(() => {
    const list: DownCable[] = [];
    [c0, c1].forEach((on, i) => {
      if (!on) return;
      const x = U(JACKS[i]!);
      const jack: [number, number, number] = [x, 0, JACK_Z];
      const path: Array<[number, number, number]> = cableTo
        ? [
            [x, cableTo[0] * 0.35 - 0.01, JACK_Z + 0.003],
            [x + (i ? 0.004 : -0.004), cableTo[0] + 0.014, cableTo[1] + (JACK_Z - cableTo[1]) * 0.2],
            [x + (i ? 0.006 : -0.006), cableTo[0] - 0.012, cableTo[1]],
          ]
        : [
            [x, -0.034, JACK_Z + 0.004],
            [x, -0.06, JACK_Z + 0.011],
            [x, -0.088, JACK_Z + 0.015],
          ];
      list.push({ jack, path });
    });
    if (!list.length) return null;
    const key = `5380:${c0}:${c1}:${cableTo?.map((n) => n.toFixed(4)).join(',') ?? 'free'}`;
    return { cables: downCablesGeometry(key, list), plugs: downPlugsGeometry(key, list) };
  }, [c0, c1, cableTo]);

  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      <mesh geometry={bodyGeometry()} material={vertexColorPlastic()} castShadow receiveShadow />
      <mesh geometry={metalGeometry()} material={vertexColorMetal()} receiveShadow />
      {/* smoked display / indicator panel */}
      <mesh
        geometry={roundedBox(PANEL.w / 1000, PANEL.h / 1000, 0.0016, 0.0007)}
        material={glossyBlack()}
        position={[U(PANEL.u + PANEL.w / 2), V(PANEL.v + PANEL.h / 2), D + 0.0006]}
        receiveShadow
      />
      <mesh geometry={decals.geometry} material={decals.atlas.material} receiveShadow />
      <DotMatrixDisplay
        getText={displayText}
        width={DISPLAY.w / 1000}
        height={DISPLAY.h / 1000}
        position={[U(DISPLAY.u + DISPLAY.w / 2), V(DISPLAY.v + DISPLAY.h / 2), D + 0.0018]}
      />
      <mesh
        geometry={box(DISPLAY.w / 1000 + 0.001, DISPLAY.h / 1000 + 0.001, 0.0001)}
        material={displayGlass()}
        position={[U(DISPLAY.u + DISPLAY.w / 2), V(DISPLAY.v + DISPLAY.h / 2), D + 0.0021]}
      />
      <PointLeds positions={leds.positions} size={LENS} get={leds.get} color={leds.color} intensity={1.7} />

      <ModeSwitch getPos={keyPos} onSet={setKey} />

      {cableGeo && (
        <>
          <mesh geometry={cableGeo.plugs} material={plugClearMaterial()} />
          <mesh geometry={cableGeo.cables} material={cableBootMaterial()} castShadow receiveShadow />
        </>
      )}

      {(highlighted || hovered) && (
        <HighlightFrame center={[0, H / 2, D / 2 + 0.001]} size={[W + 0.002, H + 0.002, D + 0.004]} strength={highlighted ? 1 : 0.35} />
      )}
    </group>
  );
}

function displayGlass() {
  return cachedMaterial(
    '5380-display-glass',
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#1a0b08',
        roughness: 0.05,
        metalness: 0,
        transparent: true,
        opacity: 0.18,
        clearcoat: 1,
        depthWrite: false,
      }),
  );
}

const KEY_V: Record<KeySwitch, number> = { RUN: SWITCH.vRun, REM: SWITCH.vRem, PROG: SWITCH.vProg };

/** 3-position mode switch (slide lever). Click a position legend/zone to move it there. */
function ModeSwitch({ getPos, onSet }: { getPos: () => KeySwitch; onSet: (p: KeySwitch) => void }) {
  const lever = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  useCursor(hover);
  useFrame((_, dt) => {
    const g = lever.current;
    if (!g) return;
    const target = V(KEY_V[getPos()]);
    g.position.y += (target - g.position.y) * Math.min(1, dt * 18);
  });
  const zone = (p: KeySwitch) => ({
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setHover(true);
    },
    onPointerOut: () => setHover(false),
    onPointerDown: (e: ThreeEvent<PointerEvent>) => e.stopPropagation(),
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onSet(p);
    },
  });
  const hitMat = cachedMaterial('hit-invisible', () => new THREE.MeshBasicMaterial({ visible: false }));
  return (
    <group>
      {(['RUN', 'REM', 'PROG'] as const).map((p) => (
        <mesh key={p} geometry={box(0.016, 0.0066, 0.004)} material={hitMat} position={[U(SWITCH.u + 5), V(KEY_V[p]), D + 0.001]} {...zone(p)} />
      ))}
      <mesh ref={lever} geometry={leverGeometry()} material={vertexColorPlastic()} position={[U(SWITCH.u), V(SWITCH.vRem), D + 0.0004]} castShadow receiveShadow />
    </group>
  );
}

export const CONTROLLER_5380_WIDTH = W;
