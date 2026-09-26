/**
 * PowerFlex 525 AC drive digital twin (25B-…, frames A / B / C).
 *
 * Real outlines (PowerFlex 520-series technical data, W × H × D): A 72 × 152 × 172 mm, B 87 × 180 × 172 mm,
 * C 109 × 220 × 184 mm. The removable CONTROL MODULE (identical on every frame) carries the integral LCD
 * display (5-digit 7-segment value, status annunciators, scrolling text line), the ENET / LINK / FAULT
 * indicators and the integral MEMBRANE keypad (flat printed keys with shallow pillows): Esc, Sel, ▲, ▼,
 * Enter, Reverse, green Start, red Stop and the speed potentiometer. Below it: the control-terminal cover.
 * The POWER MODULE carries the finger-safe power terminal guard (R/L1 S/L2 T/L3 — U/T1 V/T2 W/T3 plus
 * DC− DC+ BR+ BR−), the conduit plate with knockouts and PE ground screws, the embedded EtherNet/IP RJ45
 * (cable routed off to the left of the power terminals), the rear aluminium heat sink with top/bottom
 * mounting tabs (keyholes, protruding 5 mm beyond the housing) and the cooling fan centred over the fin
 * channels, which are capped top and bottom.
 *
 * Draw calls: plastic body (merged) + metal (merged) + print (atlas) + keypad pillows (1, morph targets for
 * key presses) + LCD + glass + LEDs (instanced) + fan grille + fan rotor + cable (2).
 *
 * Origin: center of the back mounting face at the bottom edge. Front faces +Z.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { LedColor, LedMode } from '../../../common';
import type { PowerFlex525Props } from '../../../contracts';
import { buildAtlas, decalGeometry, remapUv, type DecalPlacement } from '../compactlogix/atlas';
import { barcode, CONDENSED, grain, SANS, type MmCtx } from '../compactlogix/canvas';
import { box, cachedGeometry, holedPlate, mergeColored, profileGeometry, roundedBox, screwHeadGeometry, xf } from '../compactlogix/geometry';
import {
  activityFlicker,
  cableBootMaterial,
  cachedMaterial,
  downCablesGeometry,
  downPlugsGeometry,
  drawRj45Face,
  HighlightFrame,
  plugClearMaterial,
  PointLeds,
  usePick,
  vertexColorMetal,
  vertexColorPlastic,
} from '../compactlogix/parts';
import { useDisposeOnUnmount } from '../../../dispose';

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export type PowerFlexFrame = 'A' | 'B' | 'C';

interface FrameSpec {
  w: number;
  h: number;
  d: number;
  /** Heat sink depth (behind the plastic housing). */
  hs: number;
  /** Mounting hole spacing (horizontal, m). */
  holeX: number;
  catalog: string;
  rating: string;
  amps: string;
}

export const PF525_FRAMES: Record<PowerFlexFrame, FrameSpec> = {
  A: { w: 0.072, h: 0.152, d: 0.172, hs: 0.042, holeX: 0.0575, catalog: '25B-D4P0N104', rating: '1.5 kW / 2.0 HP', amps: '4.0' },
  B: { w: 0.087, h: 0.18, d: 0.172, hs: 0.042, holeX: 0.0725, catalog: '25B-D010N104', rating: '4.0 kW / 5.0 HP', amps: '10.5' },
  C: { w: 0.109, h: 0.22, d: 0.184, hs: 0.048, holeX: 0.0905, catalog: '25B-D017N104', rating: '7.5 kW / 10 HP', amps: '17.0' },
};

/** Control module (same on all frames). */
const CM = { w: 0.07, h: 0.105, d: 0.044 } as const;
/** Mounting tabs protrude this far above / below the housing. */
const TAB = 0.005;

export type PowerFlexKey = 'esc' | 'sel' | 'up' | 'down' | 'enter' | 'reverse' | 'start' | 'stop';

interface KeyDef {
  id: PowerFlexKey;
  u: number; // mm, control-module local (0 = center)
  v: number; // mm from control-module bottom
  w: number;
  h: number;
  color: string;
  legend: string;
}

const KEYS: KeyDef[] = [
  { id: 'esc', u: -20, v: 68.5, w: 15, h: 7.5, color: '#3b3f45', legend: 'Esc' },
  { id: 'up', u: 0, v: 68.5, w: 15, h: 7.5, color: '#3b3f45', legend: '▲' },
  { id: 'sel', u: 20, v: 68.5, w: 15, h: 7.5, color: '#3b3f45', legend: 'Sel' },
  { id: 'reverse', u: -20, v: 58.5, w: 15, h: 7.5, color: '#3b3f45', legend: '⟲' },
  { id: 'down', u: 0, v: 58.5, w: 15, h: 7.5, color: '#3b3f45', legend: '▼' },
  { id: 'enter', u: 20, v: 58.5, w: 15, h: 7.5, color: '#3b3f45', legend: '↵' },
  { id: 'start', u: -20, v: 47.5, w: 15, h: 8.5, color: '#1c9a3c', legend: 'I' },
  { id: 'stop', u: 20, v: 47.5, w: 15, h: 8.5, color: '#d0232b', legend: 'O' },
];
const KEY_R = 1.6; // mm corner radius (printed + pillow)

/** Control-module front print: width (mm) and height (mm, 0 = module bottom). */
const FRONT = { w: CM.w * 1000 - 2.4, h: 95, v0: 3 } as const;
const LCD = { u0: -17.5, u1: 30.5, v0: 76, v1: 92 } as const;
const PAD = { u0: -33, u1: 33, v0: 41, v1: 94.2 } as const; // keypad membrane
const POT = { u: 0, v: 47.5, r: 5.4 } as const;
const PF_LEDS = [
  { id: 'ENET', v: 89.4, color: 'green' as const },
  { id: 'LINK', v: 84.2, color: 'green' as const },
  { id: 'FAULT', v: 79.0, color: 'red' as const },
];
const LED_U = -30.2;
/** Embedded EtherNet/IP jack on the underside of the control module (CM-local x, z of the face center). */
const JACK = { x: -0.018, z: CM.d - 0.014 } as const;

// ---------------------------------------------------------------------------
// Print (atlas)
// ---------------------------------------------------------------------------

function drawFront(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const wMm = FRONT.w;
  const U = (u: number) => u + wMm / 2;
  ctx.fillStyle = '#1e2023';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.025, 17);
  // keypad membrane (satin overlay)
  m.rect(U(PAD.u0), PAD.v0, PAD.u1 - PAD.u0, PAD.v1 - PAD.v0, '#2a2d31', 2.5);
  m.strokeRect(U(PAD.u0), PAD.v0, PAD.u1 - PAD.u0, PAD.v1 - PAD.v0, '#3a3e43', 0.3, 2.5);
  // LCD bezel
  m.rect(U(LCD.u0) - 1.4, LCD.v0 - 1.4, LCD.u1 - LCD.u0 + 2.8, LCD.v1 - LCD.v0 + 2.8, '#0c0d0f', 1.4);
  // LED windows + labels
  for (const l of PF_LEDS) {
    m.rect(U(LED_U) - 1.35, l.v - 0.85, 2.7, 1.7, '#020203', 0.5);
    m.text(l.id, U(-28.3), l.v, 1.75, { color: '#e9e9e9', weight: 700, font: CONDENSED });
  }
  // printed keys (the pillows sample exactly these pixels)
  for (const k of KEYS) {
    const x = U(k.u - k.w / 2);
    const y = k.v - k.h / 2;
    const g = ctx.createLinearGradient(0, m.y(k.v + k.h / 2), 0, m.y(k.v - k.h / 2));
    const base = new THREE.Color(k.color);
    g.addColorStop(0, base.clone().lerp(new THREE.Color('#ffffff'), 0.08).getStyle());
    g.addColorStop(1, base.clone().multiplyScalar(0.86).getStyle());
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(m.x(x), m.y(y + k.h), k.w * m.s, k.h * m.s, KEY_R * m.s);
    ctx.fill();
    const isSym = k.legend.length === 1;
    m.text(k.legend, U(k.u), k.v - (isSym ? 0.1 : 0), isSym ? 4.2 : 3.0, {
      color: '#f4f4f4',
      weight: k.id === 'start' || k.id === 'stop' ? 800 : 700,
      align: 'center',
      font: isSym ? 'DejaVu Sans, Arial Unicode MS, Segoe UI Symbol, sans-serif' : SANS,
    });
  }
  // pot scale
  m.circle(U(POT.u), POT.v, POT.r + 1.4, '#16171a');
  for (let i = 0; i <= 10; i++) {
    const a = (-225 + (i * 270) / 10) * (Math.PI / 180);
    const r0 = POT.r + 1.7;
    const r1 = POT.r + (i % 5 === 0 ? 2.9 : 2.3);
    m.line(U(POT.u) + Math.cos(a) * r0, POT.v + Math.sin(a) * r0, U(POT.u) + Math.cos(a) * r1, POT.v + Math.sin(a) * r1, '#c9ccd0', 0.25);
  }
  // lower (control terminal) cover
  m.line(1.2, 39.4, wMm - 1.2, 39.4, '#0b0c0d', 0.35);
  m.text('PowerFlex', 4, 31.5, 5.1, { color: '#f2f2f2', weight: 700, font: SANS });
  m.text('525', 4 + 28, 31.5, 5.1, { color: '#f2f2f2', weight: 300, font: SANS });
  for (let i = 0; i < 5; i++) m.rect(4, 7 + i * 3.4, 37, 1.5, '#0a0b0c', 0.7);
  // warning label
  m.rect(45.5, 5, 18, 23, '#f2c200', 1.2);
  const tri = (cx: number, top: number, s: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(m.x(cx), m.y(top));
    ctx.lineTo(m.x(cx + s * 0.62), m.y(top - s));
    ctx.lineTo(m.x(cx - s * 0.62), m.y(top - s));
    ctx.closePath();
    ctx.fill();
  };
  tri(54.5, 25.5, 10.5, '#111');
  tri(54.5, 23.6, 7.7, '#f2c200');
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(m.x(55.1), m.y(22.6));
  ctx.lineTo(m.x(53.3), m.y(19));
  ctx.lineTo(m.x(54.9), m.y(19));
  ctx.lineTo(m.x(53.7), m.y(16.6));
  ctx.lineTo(m.x(56.1), m.y(20));
  ctx.lineTo(m.x(54.5), m.y(20));
  ctx.closePath();
  ctx.fill();
  m.text('DANGER', 54.5, 12.6, 2.1, { color: '#111', weight: 900, align: 'center' });
  m.text('Wait 3 min after', 54.5, 9.8, 1.25, { color: '#111', weight: 600, align: 'center' });
  m.text('removing power', 54.5, 7.8, 1.25, { color: '#111', weight: 600, align: 'center' });
  // cover screw
  m.circle(wMm / 2, 5.2, 1.5, '#0d0e10');
  m.circle(wMm / 2, 5.2, 1.1, '#6d7278');
  m.line(wMm / 2 - 0.8, 5.2, wMm / 2 + 0.8, 5.2, '#222', 0.25);
}

/** Satin keypad membrane / glossy LED windows / matte cover (per-pixel roughness). */
function drawFrontOrm(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) {
  const U = (u: number) => u + FRONT.w / 2;
  ctx.fillStyle = 'rgb(0,150,13)';
  ctx.fillRect(0, 0, w, h);
  m.rect(U(PAD.u0), PAD.v0, PAD.u1 - PAD.u0, PAD.v1 - PAD.v0, 'rgb(0,95,10)', 2.5);
  for (const l of PF_LEDS) m.rect(U(LED_U) - 1.35, l.v - 0.85, 2.7, 1.7, 'rgb(0,40,10)', 0.5);
  m.rect(45.5, 5, 18, 23, 'rgb(0,110,10)', 1.2);
}

const GUARD_TERMS = {
  main: ['R/L1', 'S/L2', 'T/L3', 'U/T1', 'V/T2', 'W/T3'],
  aux: ['DC-', 'DC+', 'BR+', 'BR-'],
};

function drawGuard(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, wMm: number, hMm: number) {
  ctx.fillStyle = '#1a1b1e';
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 0.03, 23);
  const pitch = (wMm - 8) / 6;
  GUARD_TERMS.main.forEach((l, i) => {
    const u = 4 + pitch * (i + 0.5) + (i >= 3 ? 1.2 : -1.2);
    m.rect(u - pitch * 0.32, 1.8, pitch * 0.64, hMm * 0.26, '#050506', 0.8);
    m.circle(u, hMm * 0.41, Math.min(1.9, pitch * 0.22), '#060607');
    m.circle(u, hMm * 0.41, Math.min(1.35, pitch * 0.16), '#8a9096');
    m.line(u - 0.8, hMm * 0.41, u + 0.8, hMm * 0.41, '#2a2c2e', 0.25);
    m.text(l, u, hMm * 0.555, Math.min(2.0, pitch * 0.25), { color: '#e6e6e6', weight: 700, align: 'center', font: CONDENSED });
  });
  // DC bus / brake terminals: smaller pitch, upper row
  const ap = Math.min(pitch * 0.72, 8.5);
  const a0 = wMm / 2 - ap * 1.5;
  GUARD_TERMS.aux.forEach((l, i) => {
    const u = a0 + ap * i;
    m.circle(u, hMm * 0.76, Math.min(1.5, ap * 0.19), '#060607');
    m.circle(u, hMm * 0.76, Math.min(1.05, ap * 0.13), '#8a9096');
    m.rect(u - ap * 0.26, hMm * 0.64, ap * 0.52, hMm * 0.07, '#050506', 0.4);
    m.text(l, u, hMm * 0.9, Math.min(1.6, ap * 0.2), { color: '#d2d4d6', weight: 700, align: 'center', font: CONDENSED });
  });
  m.line(wMm / 2, 1.5, wMm / 2, hMm * 0.58, '#303236', 0.3);
  m.text('LINE', 4 + pitch * 1.5 - 1.2, hMm * 0.64, 1.45, { color: '#9ea2a6', weight: 700, align: 'center' });
  m.text('MOTOR', 4 + pitch * 4.5 + 1.2, hMm * 0.64, 1.45, { color: '#9ea2a6', weight: 700, align: 'center' });
}

function drawNameplate(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, frame: PowerFlexFrame, catalog: string) {
  const f = PF525_FRAMES[frame];
  ctx.fillStyle = '#1b1c1f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e4e5e3';
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, 16);
  ctx.fill();
  m.text('PowerFlex 525', 3, 47.5, 4.2, { color: '#111', weight: 800 });
  m.text('AC DRIVE', 67, 47.5, 2.6, { color: '#111', weight: 700, align: 'right' });
  m.text(`Cat No. ${catalog}`, 3, 42, 3.1, { color: '#111', weight: 700 });
  m.text(`Frame ${frame}   Series A`, 67, 42, 2.4, { color: '#222', weight: 600, align: 'right' });
  m.line(3, 39.5, 67, 39.5, '#444', 0.25);
  const rows = [
    ['Input:', '380-480V AC  3 Ph  47-63 Hz'],
    ['', `${(Number(f.amps) * 1.25).toFixed(1)} A  Normal Duty`],
    ['Output:', `0-480V  3 Ph  0-500 Hz  ${f.amps} A`],
    ['Power:', f.rating],
    ['SCCR:', '100 kA'],
  ];
  rows.forEach(([a, b], i) => {
    m.text(a!, 3, 36 - i * 3.6, 2.3, { color: '#222', weight: 700 });
    m.text(b!, 16, 36 - i * 3.6, 2.3, { color: '#222', weight: 500 });
  });
  barcode(m, 3, 6.5, 36, 8, 525 + frame.charCodeAt(0));
  m.text('S/N 1A2B3C4D', 3, 4.2, 1.9, { color: '#333', weight: 600 });
  m.strokeRect(44, 6, 23, 11, '#333', 0.3, 1.5);
  m.text('IND. CONT. EQ.', 55.5, 13.2, 1.8, { color: '#222', weight: 800, align: 'center' });
  m.text('E-listed · IP20', 55.5, 9.3, 1.7, { color: '#222', weight: 600, align: 'center' });
  m.text('Made in Singapore', 67, 2.6, 1.6, { color: '#444', weight: 500, align: 'right' });
}

function drawVentSlots(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, wMm: number, dMm: number, bg = '#1c1d20') {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const n = Math.floor((wMm - 6) / 3.2);
  for (let i = 0; i < n; i++) m.rect(3 + i * 3.2 + 0.4, 2.5, 1.6, dMm - 5, '#040405', 0.8);
}

/** Conduit plate underside: metal with knockouts. */
function drawKnockouts(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, frame: PowerFlexFrame, wMm: number, dMm: number) {
  ctx.fillStyle = '#b9bec3';
  ctx.fillRect(0, 0, w, h);
  const n = wMm > 90 ? 3 : 2;
  const r = frame === 'A' ? 11 : 13.5;
  for (let i = 0; i < n; i++) {
    const u = (wMm / n) * (i + 0.5);
    m.circle(u, dMm * 0.52, r + 0.8, '#8d9398');
    m.circle(u, dMm * 0.52, r, '#a9aeb3');
    m.circle(u, dMm * 0.52, r - 1.2, '#b4b9be');
  }
}

/** PE ground marks on the conduit plate top. */
function drawPe(m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number, wMm: number) {
  ctx.fillStyle = '#b9bec3';
  ctx.fillRect(0, 0, w, h);
  for (const u of [5.5, wMm - 5.5]) {
    const x = u + (u < wMm / 2 ? 5.5 : -5.5);
    m.line(x, 5.5, x, 3.2, '#1e7a34', 0.35);
    m.line(x - 2, 3.2, x + 2, 3.2, '#1e7a34', 0.35);
    m.line(x - 1.3, 2.3, x + 1.3, 2.3, '#1e7a34', 0.35);
    m.line(x - 0.6, 1.4, x + 0.6, 1.4, '#1e7a34', 0.35);
  }
}

function pfAtlas(frame: PowerFlexFrame, catalog: string) {
  const g = frameGeometryInfo(frame);
  return buildAtlas(`pf525:${frame}:${catalog}`, [
    { id: 'front', wMm: FRONT.w, hMm: FRONT.h, ppm: 14, roughness: 0.5, bg: '#1e2023', draw: drawFront, drawOrm: drawFrontOrm },
    { id: 'guard', wMm: g.guardW * 1000 - 2, hMm: g.guardH * 1000 - 2, ppm: 12, roughness: 0.7, bg: '#1a1b1e', draw: (m, c, w, h) => drawGuard(m, c, w, h, g.guardW * 1000 - 2, g.guardH * 1000 - 2) },
    { id: 'plate', wMm: 70, hMm: 52, ppm: 10, roughness: 0.5, bg: '#1b1c1f', draw: (m, c, w, h) => drawNameplate(m, c, w, h, frame, catalog) },
    { id: 'ventTop', wMm: g.ventW * 1000, hMm: g.topVentD * 1000, ppm: 8, roughness: 0.7, bg: '#1c1d20', draw: (m, c, w, h) => drawVentSlots(m, c, w, h, g.ventW * 1000, g.topVentD * 1000) },
    { id: 'ventBot', wMm: g.ventW * 1000, hMm: g.botVentD * 1000, ppm: 8, roughness: 0.7, bg: '#1c1d20', draw: (m, c, w, h) => drawVentSlots(m, c, w, h, g.ventW * 1000, g.botVentD * 1000) },
    { id: 'capBot', wMm: g.capW * 1000, hMm: g.hs * 1000 - 2, ppm: 8, roughness: 0.6, bg: '#141517', draw: (m, c, w, h) => drawVentSlots(m, c, w, h, g.capW * 1000, g.hs * 1000 - 2, '#141517') },
    { id: 'knock', wMm: g.plateW * 1000 - 2, hMm: g.plateD * 1000, ppm: 8, roughness: 0.42, metalness: 0.8, bg: '#b9bec3', draw: (m, c, w, h) => drawKnockouts(m, c, w, h, frame, g.plateW * 1000 - 2, g.plateD * 1000) },
    { id: 'pe', wMm: g.plateW * 1000 - 2, hMm: 7, ppm: 10, roughness: 0.42, metalness: 0.8, bg: '#b9bec3', draw: (m, c, w, h) => drawPe(m, c, w, h, g.plateW * 1000 - 2) },
    { id: 'rj45', wMm: 15.8, hMm: 13.8, ppm: 10, roughness: 0.5, metalness: 0.2, bg: '#1a1b1d', draw: (_m, c, w, h) => drawRj45Face(c, w, h) },
  ]);
}

/** Derived per-frame geometry (m). */
function frameGeometryInfo(frame: PowerFlexFrame) {
  const f = PF525_FRAMES[frame];
  const W = f.w;
  const H = f.h;
  const D = f.d;
  const HS = f.hs;
  const pmFront = D - CM.d;
  const cmY0 = H - 0.004 - CM.h;
  const guardH = Math.min(cmY0 - 0.006, 0.052);
  const guardW = Math.min(W - 0.008, 0.1);
  const fanR = Math.min(0.024, (W - 0.02) / 2, HS / 2 - 0.0025);
  const fanZ = HS / 2;
  const ventW = W - 0.01;
  const topVentZ0 = HS + 0.004;
  const topVentD = pmFront - 0.006 - topVentZ0;
  const botVentD = pmFront - HS - 0.046;
  const capW = W - 0.003;
  const plateW = W - 0.006;
  const plateZ0 = pmFront - 0.04;
  const plateD = 0.062;
  return { W, H, D, hs: HS, pmFront, cmY0, guardH, guardW, fanR, fanZ, ventW, topVentZ0, topVentD, botVentD, capW, plateW, plateZ0, plateD };
}

function pfDecals(frame: PowerFlexFrame, catalog: string) {
  const atlas = pfAtlas(frame, catalog);
  const g = frameGeometryInfo(frame);
  const up: [number, number, number] = [-Math.PI / 2, 0, 0];
  const down: [number, number, number] = [Math.PI / 2, 0, 0];
  const plateScale = Math.min(1, (g.pmFront - g.hs) / 0.08);
  const faceH = (FRONT.h - FRONT.v0) / 1000;
  const placements: DecalPlacement[] = [
    { id: 'front', center: [0, g.cmY0 + FRONT.v0 / 1000 + faceH / 2, g.pmFront + CM.d + 0.0002], size: [FRONT.w / 1000, faceH], sub: [0, FRONT.v0 / FRONT.h, 1, 1] },
    { id: 'guard', center: [0, 0.003 + g.guardH / 2, g.pmFront + 0.0122], size: [g.guardW - 0.002, g.guardH - 0.002] },
    { id: 'plate', center: [g.W / 2 + 0.0002, g.H * 0.56, g.hs + (g.pmFront - g.hs) / 2], size: [0.07 * plateScale, 0.052 * plateScale], rotation: [0, Math.PI / 2, 0] },
    { id: 'ventTop', center: [0, g.H + 0.0002, g.topVentZ0 + g.topVentD / 2], size: [g.ventW, g.topVentD], rotation: up },
    { id: 'ventBot', center: [0, -0.0002, g.hs + 0.006 + g.botVentD / 2], size: [g.ventW, g.botVentD], rotation: down },
    { id: 'capBot', center: [0, -0.0002, (g.hs - 0.002) / 2 + 0.001], size: [g.capW, g.hs - 0.002], rotation: down },
    { id: 'knock', center: [0, -0.0002, g.plateZ0 + g.plateD / 2], size: [g.plateW - 0.002, g.plateD], rotation: down },
    { id: 'pe', center: [0, 0.0015 + 0.0002, g.plateZ0 + g.plateD - 0.0045], size: [g.plateW - 0.002, 0.007], rotation: up },
    { id: 'rj45', center: [JACK.x, g.cmY0 - 0.0003, g.pmFront + JACK.z], size: [0.0158, 0.0138], rotation: down },
  ];
  return { atlas, geometry: decalGeometry(`${frame}:${catalog}`, atlas, placements) };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function plasticGeometry(frame: PowerFlexFrame) {
  return cachedGeometry(`pf525-plastic:${frame}`, () => {
    const g = frameGeometryInfo(frame);
    const { W, H, hs: HS, pmFront } = g;
    const housing = profileGeometry(
      `pf525-housing:${frame}`,
      [
        [HS - 0.002, 0.003],
        [HS + 0.002, 0],
        [pmFront - 0.004, 0],
        [pmFront, 0.004],
        [pmFront, H - 0.004],
        [pmFront - 0.004, H],
        [HS + 0.002, H],
        [HS - 0.002, H - 0.003],
      ],
      W,
      0.0012,
    );
    const cm = profileGeometry(
      'pf525-control-module',
      [
        [0, 0],
        [CM.d - 0.003, 0],
        [CM.d, 0.003],
        [CM.d, CM.h - 0.009],
        [CM.d - 0.0035, CM.h - 0.001],
        [CM.d - 0.006, CM.h],
        [0, CM.h],
      ],
      CM.w,
      0.0012,
    );
    const potLathe = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(POT.r / 1000, 0),
        new THREE.Vector2(POT.r / 1000, 0.0032),
        new THREE.Vector2(POT.r / 1000 - 0.0006, 0.0038),
        new THREE.Vector2(0, 0.0038),
      ],
      28,
    );
    potLathe.rotateX(Math.PI / 2);
    const r = g.fanR;
    const parts: Array<[THREE.BufferGeometry, string, THREE.Matrix4?]> = [
      [housing, '#1b1c1f'],
      [cm, '#1e2023', xf([0, g.cmY0, pmFront])],
      [roundedBox(g.guardW, g.guardH, 0.014, 0.0012), '#1b1c1f', xf([0, 0.003 + g.guardH / 2, pmFront + 0.005])],
      // fin-channel caps (top carries the fan, bottom is the air intake)
      [box(g.capW, 0.003, HS), '#141517', xf([0, H - 0.0015, HS / 2])],
      [box(g.capW, 0.003, HS), '#141517', xf([0, 0.0015, HS / 2])],
      // fan shroud on the top cap
      [new THREE.CircleGeometry(r, 32), '#060606', xf([0, H + 0.0002, g.fanZ], [-Math.PI / 2, 0, 0])],
      [new THREE.CylinderGeometry(r + 0.0012, r + 0.0012, 0.003, 40, 1, true), '#141517', xf([0, H + 0.0015, g.fanZ])],
      [new THREE.RingGeometry(r, r + 0.0028, 40), '#141517', xf([0, H + 0.003, g.fanZ], [-Math.PI / 2, 0, 0])],
      // USB port (top of the control module)
      [box(0.0078, 0.0005, 0.0032), '#050506', xf([0.022, g.cmY0 + CM.h + 0.0002, pmFront + CM.d - 0.012])],
      // speed pot
      [potLathe, '#121314', xf([POT.u / 1000, g.cmY0 + POT.v / 1000, pmFront + CM.d])],
      [box(0.0008, 0.0036, 0.0003), '#e8e8e8', xf([POT.u / 1000 + 0.0022 * Math.sin(-0.6), g.cmY0 + POT.v / 1000 + 0.0022 * Math.cos(0.6), pmFront + CM.d + 0.0039], [0, 0, 0.6])],
    ];
    return mergeColored(parts);
  });
}

function metalGeometry(frame: PowerFlexFrame) {
  return cachedGeometry(`pf525-metal:${frame}`, () => {
    const g = frameGeometryInfo(frame);
    const f = PF525_FRAMES[frame];
    const { W, H, hs: HS } = g;
    const alu = '#8f969d';
    const parts: Array<[THREE.BufferGeometry, string | null, THREE.Matrix4?]> = [[box(W - 0.003, H - 0.004, 0.006), alu, xf([0, H / 2, HS - 0.003])]];
    const n = Math.max(6, Math.floor((W - 0.006) / 0.0046));
    const pitch = (W - 0.006) / (n - 1);
    const fin = box(0.0012, H - 0.006, HS - 0.006);
    for (let i = 0; i < n; i++) parts.push([fin, alu, xf([-(W - 0.006) / 2 + i * pitch, H / 2, (HS - 0.006) / 2])]);
    // mounting tabs with keyholes (top: keyhole slot up; bottom: open slot down)
    const tabW = f.holeX + 0.014;
    const tabH = TAB + 0.008;
    const topTab = holedPlate(tabW, tabH, 0.0025, 0.0015, [
      { kind: 'keyhole', x: -f.holeX / 2, y: 0.0005, r: 0.0028, slot: 0.0028, up: true },
      { kind: 'keyhole', x: f.holeX / 2, y: 0.0005, r: 0.0028, slot: 0.0028, up: true },
    ]);
    const botTab = holedPlate(tabW, tabH, 0.0025, 0.0015, [
      { kind: 'keyhole', x: -f.holeX / 2, y: -0.0005, r: 0.0028, slot: 0.0028, up: false },
      { kind: 'keyhole', x: f.holeX / 2, y: -0.0005, r: 0.0028, slot: 0.0028, up: false },
    ]);
    parts.push([topTab, alu, xf([0, H + TAB - tabH / 2, 0])]);
    parts.push([botTab, alu, xf([0, -TAB + tabH / 2, 0])]);
    // conduit / EMC plate with ground screws (screw heads facing up)
    parts.push([box(g.plateW, 0.0015, g.plateD), '#b9bec3', xf([0, 0.00075, g.plateZ0 + g.plateD / 2])]);
    for (const sx of [-1, 1]) parts.push([screwHeadGeometry(0.0022, 0.0015, 'combo'), null, xf([sx * (g.plateW / 2 - 0.0055), 0.0015 + 0.0015, g.plateZ0 + g.plateD - 0.0045], [-Math.PI / 2, 0, 0])]);
    return mergeColored(parts);
  });
}

function rotorGeometry() {
  return cachedGeometry('pf525-rotor', () => {
    const parts: Array<[THREE.BufferGeometry, string, THREE.Matrix4?]> = [[new THREE.CylinderGeometry(0.0075, 0.0075, 0.0016, 20), '#2a2c2f']];
    for (let i = 0; i < 7; i++) {
      const b = new THREE.BoxGeometry(0.0165, 0.0007, 0.0055);
      b.rotateX(0.38);
      b.translate(0.0118, 0, 0);
      b.rotateY((i / 7) * Math.PI * 2);
      parts.push([b, '#2c2d30']);
    }
    return mergeColored(parts);
  });
}

function fanGrilleMaterial() {
  return cachedMaterial('pf525-grille', () => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#000000';
    for (let r = 26; r < 120; r += 18) {
      ctx.beginPath();
      ctx.arc(128, 128, r + 10, 0, Math.PI * 2);
      ctx.arc(128, 128, r, 0, Math.PI * 2, true);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(128, 128);
      ctx.rotate((i * Math.PI) / 4 + Math.PI / 8);
      ctx.fillRect(-4, -128, 8, 256);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(128, 128, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(128, 128, 126, 0, Math.PI * 2);
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    return new THREE.MeshStandardMaterial({ color: '#1d1e21', roughness: 0.55, alphaMap: t, alphaTest: 0.5, side: THREE.DoubleSide });
  });
}

/**
 * Membrane keypad: every key is a very shallow pillow (0.35 mm) sampling the SAME atlas pixels as the printed
 * key underneath (no double outline). One geometry, one morph target per key (press sinks it 0.2 mm).
 */
const PILLOW = { depth: 0.00035, edge: 1.3, lift: 0.00005, press: 0.0002 } as const;

function keypadGeometry(rect: [number, number, number, number]) {
  return cachedGeometry(`pf525-keypad:${rect.map((n) => n.toFixed(5)).join(',')}`, () => {
    const nx = 30;
    const ny = 16;
    const perKey = (nx + 1) * (ny + 1);
    const total = perKey * KEYS.length;
    const pos = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const index: number[] = [];
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    KEYS.forEach((k, ki) => {
      const hx = k.w / 2;
      const hy = k.h / 2;
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const gx = -hx + (2 * hx * i) / nx;
          const gy = -hy + (2 * hy * j) / ny;
          const qx = Math.abs(gx) - (hx - KEY_R);
          const qy = Math.abs(gy) - (hy - KEY_R);
          const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - KEY_R;
          const h = PILLOW.depth * smooth(0, PILLOW.edge, -outside);
          const vi = ki * perKey + j * (nx + 1) + i;
          pos[vi * 3] = (k.u + gx) / 1000;
          pos[vi * 3 + 1] = (k.v + gy) / 1000;
          pos[vi * 3 + 2] = h + PILLOW.lift;
          uv[vi * 2] = (k.u + gx + FRONT.w / 2) / FRONT.w;
          uv[vi * 2 + 1] = (k.v + gy) / FRONT.h;
        }
      }
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = ki * perKey + j * (nx + 1) + i;
          const b = a + 1;
          const c = a + nx + 1;
          const d = c + 1;
          index.push(a, b, d, a, d, c);
        }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    remapUv(g, rect);
    g.morphAttributes.position = KEYS.map((_, ki) => {
      const m = new Float32Array(total * 3);
      for (let v = ki * perKey; v < (ki + 1) * perKey; v++) m[v * 3 + 2] = -PILLOW.press;
      return new THREE.BufferAttribute(m, 3);
    });
    g.morphTargetsRelative = true;
    g.computeBoundingSphere();
    return g;
  });
}

// ---------------------------------------------------------------------------
// LCD (dynamic canvas)
// ---------------------------------------------------------------------------

const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg',
  '9': 'abcdfg', '-': 'g', F: 'aefg', E: 'adefg', r: 'eg', n: 'ceg', o: 'cdeg', b: 'cdefg', d: 'bcdeg', P: 'abefg', A: 'abcefg',
  S: 'afgcd', H: 'bcefg', L: 'def', U: 'bcdef', t: 'defg', C: 'adef', ' ': '',
};

const LCD_W = 512;
const LCD_H = 176;
const LCD_ON = '#141a14';
const LCD_GHOST = 'rgba(20,30,20,0.045)';

function drawSegDigit(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number) {
  const on = SEG[ch] ?? '';
  const t = w * 0.17; // segment thickness
  const sl = 0.12; // slant
  const P = (px: number, py: number): [number, number] => [x + px + (h - py) * sl, y + py];
  const segs: Record<string, Array<[number, number]>> = {
    a: [P(t * 0.6, 0), P(w - t * 0.6, 0), P(w - t * 1.4, t), P(t * 1.4, t)],
    b: [P(w, t * 0.6), P(w, h / 2 - t * 0.4), P(w - t, h / 2 - t * 0.9 + t * 0.4), P(w - t, t * 1.4)],
    c: [P(w, h / 2 + t * 0.4), P(w, h - t * 0.6), P(w - t, h - t * 1.4), P(w - t, h / 2 + t * 0.5)],
    d: [P(t * 1.4, h - t), P(w - t * 1.4, h - t), P(w - t * 0.6, h), P(t * 0.6, h)],
    e: [P(0, h / 2 + t * 0.4), P(t, h / 2 + t * 0.5), P(t, h - t * 1.4), P(0, h - t * 0.6)],
    f: [P(0, t * 0.6), P(t, t * 1.4), P(t, h / 2 - t * 0.5), P(0, h / 2 - t * 0.4)],
    g: [P(t * 0.6, h / 2), P(t * 1.2, h / 2 - t / 2), P(w - t * 1.2, h / 2 - t / 2), P(w - t * 0.6, h / 2), P(w - t * 1.2, h / 2 + t / 2), P(t * 1.2, h / 2 + t / 2)],
  };
  for (const [name, pts] of Object.entries(segs)) {
    ctx.fillStyle = on.includes(name) ? LCD_ON : LCD_GHOST;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fill();
  }
}

interface LcdState {
  value: string; // up to 5 chars + '.'
  unit: 'Hz' | 'A' | 'V' | '%' | '';
  run: boolean;
  fwd: boolean;
  rev: boolean;
  fault: boolean;
  spinner: number; // -1 = off
  line: string;
  program: boolean;
}

function drawLcd(ctx: CanvasRenderingContext2D, s: LcdState) {
  const g = ctx.createLinearGradient(0, 0, 0, LCD_H);
  g.addColorStop(0, '#c9d3bf');
  g.addColorStop(1, '#b3bea9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LCD_W, LCD_H);
  // annunciators
  const ann = (text: string, x: number, on: boolean) => {
    ctx.fillStyle = on ? LCD_ON : LCD_GHOST;
    ctx.font = `700 19px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, 20);
  };
  ann('RUN', 16, s.run);
  ann('FWD', 74, s.fwd);
  ann('REV', 130, s.rev);
  ann('PROGRAM', 184, s.program);
  ann('FAULT', 290, s.fault);
  // rotation spinner
  const cx = 380;
  const cy = 20;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.strokeStyle = s.spinner >= 0 && (i === s.spinner || i === (s.spinner + 7) % 8) ? LCD_ON : LCD_GHOST;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5);
    ctx.lineTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
    ctx.stroke();
  }
  // digits: 5 positions, right aligned, decimal point attached to previous digit
  const chars: Array<{ c: string; dp: boolean }> = [];
  for (const ch of s.value) {
    if (ch === '.' && chars.length) chars[chars.length - 1]!.dp = true;
    else chars.push({ c: ch, dp: false });
  }
  while (chars.length < 5) chars.unshift({ c: ' ', dp: false });
  const dw = 58;
  const dh = 98;
  const x0 = 24;
  const y0 = 42;
  chars.slice(-5).forEach((d, i) => {
    const x = x0 + i * (dw + 18);
    drawSegDigit(ctx, d.c, x, y0, dw, dh);
    ctx.fillStyle = d.dp ? LCD_ON : LCD_GHOST;
    ctx.beginPath();
    ctx.arc(x + dw + 9, y0 + dh - 5, 5.5, 0, Math.PI * 2);
    ctx.fill();
  });
  // units
  const unit = (text: string, y: number, on: boolean) => {
    ctx.fillStyle = on ? LCD_ON : LCD_GHOST;
    ctx.font = `800 22px ${SANS}`;
    ctx.fillText(text, 430, y);
  };
  unit('Hz', 58, s.unit === 'Hz');
  unit('Amps', 84, s.unit === 'A');
  unit('Volts', 110, s.unit === 'V');
  unit('%', 136, s.unit === '%');
  // text line
  ctx.fillStyle = LCD_ON;
  ctx.font = `600 20px ${SANS}`;
  ctx.fillText(s.line, 18, 160);
}

function useLcd() {
  const st = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = LCD_W;
    canvas.height = LCD_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.42,
      roughness: 0.35,
      metalness: 0,
    });
    return { ctx: canvas.getContext('2d')!, tex, mat, prev: null as LcdState | null, last: -1 };
  }, []);
  useDisposeOnUnmount(st, () => {
    st.tex.dispose();
    st.mat.dispose();
  });
  return st;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PowerFlex525TwinProps extends PowerFlex525Props {
  /** Nameplate catalog number override. */
  catalog?: string;
  /** Fault code shown as 'F 002' when faulted (default 2 = Auxiliary In). */
  getFaultCode?: () => number;
  /** Keypad press (keys also animate). */
  onKey?: (key: PowerFlexKey) => void;
  /** Draw the EtherNet/IP patch cable in the embedded RJ45 (default true). */
  ethernet?: boolean;
  /** How far below the drive's bottom the Ethernet cable is drawn before its capped end (m, default 0.08). */
  cableLength?: number;
  highlighted?: boolean;
  onSelect?: () => void;
}

const FAULT_TEXT: Record<number, string> = {
  2: 'Auxiliary In',
  3: 'Power Loss',
  4: 'UnderVoltage',
  5: 'OverVoltage',
  7: 'Motor Overload',
  8: 'Heatsink OvrTmp',
  12: 'HW OverCurrent',
  13: 'Ground Fault',
  64: 'Drive Overload',
  81: 'Comm Loss',
};

function sameLcd(a: LcdState | null, b: LcdState): boolean {
  return (
    !!a &&
    a.value === b.value &&
    a.unit === b.unit &&
    a.run === b.run &&
    a.fwd === b.fwd &&
    a.rev === b.rev &&
    a.fault === b.fault &&
    a.spinner === b.spinner &&
    a.line === b.line &&
    a.program === b.program
  );
}

export function PowerFlex525({
  getFrequency,
  getRunning,
  getFaulted,
  getReverse,
  frame = 'A',
  catalog,
  getFaultCode,
  onKey,
  ethernet = true,
  cableLength = 0.08,
  highlighted = false,
  onSelect,
  position,
  rotation,
  scale,
}: PowerFlex525TwinProps) {
  const g = frameGeometryInfo(frame);
  const { W, H, D } = g;
  const cat = catalog ?? PF525_FRAMES[frame].catalog;
  const { hovered, handlers } = usePick(onSelect);

  const lcd = useLcd();
  const fan = useRef<THREE.Mesh>(null);
  const fanSpeed = useRef(0);
  const lcdState = useMemo<LcdState>(() => ({ value: '', unit: '', run: false, fwd: false, rev: false, fault: false, spinner: -1, line: '', program: false }), []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const running = getRunning();
    const faulted = getFaulted?.() ?? false;
    const reverse = getReverse?.() ?? false;
    const hz = Math.max(0, getFrequency());
    const target = running || hz > 0.5 ? 38 : 0;
    fanSpeed.current += (target - fanSpeed.current) * Math.min(1, dt * 1.5);
    if (fan.current) fan.current.rotation.y += fanSpeed.current * dt;

    // LCD: redraw at ≤ 8 Hz and only when a field changed (no per-frame allocations)
    const tick = Math.floor(t * 8);
    if (tick === lcd.last) return;
    lcd.last = tick;
    const s = lcdState;
    if (faulted) {
      const code = getFaultCode?.() ?? 2;
      const blink = Math.floor(t * 2) % 2 === 0;
      s.value = blink ? `F ${String(code).padStart(3, '0')}` : '';
      s.unit = '';
      s.run = s.fwd = s.rev = false;
      s.fault = true;
      s.spinner = -1;
      s.line = `F${String(code).padStart(3, '0')} ${FAULT_TEXT[code] ?? 'Drive Fault'}`;
      s.program = false;
    } else {
      s.value = (Math.round(hz * 100) / 100).toFixed(2);
      s.unit = 'Hz';
      s.run = running;
      s.fwd = (running || hz > 0) && !reverse;
      s.rev = (running || hz > 0) && reverse;
      s.fault = false;
      s.spinner = running && hz > 0.1 ? (reverse ? 7 - (Math.floor(t * (2 + hz / 6)) % 8) : Math.floor(t * (2 + hz / 6)) % 8) : -1;
      s.line = running ? 'b001 Output Freq' : 'b001 Output Freq  Ready';
      s.program = false;
    }
    if (sameLcd(lcd.prev, s)) return;
    lcd.prev = { ...s };
    drawLcd(lcd.ctx, s);
    lcd.tex.needsUpdate = true;
  });

  const decals = pfDecals(frame, cat);
  const leds = useMemo(() => {
    const positions = PF_LEDS.map((l): [number, number, number] => [LED_U / 1000, g.cmY0 + l.v / 1000, g.pmFront + CM.d + 0.0003]);
    const get = (i: number): LedMode => (i === 0 ? (ethernet ? 'on' : 'off') : i === 1 ? ethernet && activityFlicker(7) : getFaulted?.() ? 'flash' : 'off');
    const color = (i: number): LedColor => PF_LEDS[i]!.color;
    return { positions, get, color };
  }, [g.cmY0, g.pmFront, ethernet, getFaulted]);

  const cable = useMemo(() => {
    if (!ethernet) return null;
    const jack: [number, number, number] = [JACK.x, g.cmY0, g.pmFront + JACK.z];
    const z = jack[2];
    const path: Array<[number, number, number]> = [
      [JACK.x - 0.002, g.cmY0 - 0.03, z + 0.002],
      [-W / 2 - 0.004, Math.max(0.004, g.cmY0 - 0.05), z - 0.004],
      [-W / 2 - 0.011, -0.02, z - 0.02],
      [-W / 2 - 0.012, -cableLength, z - 0.026],
    ];
    const key = `pf525:${frame}:${cableLength.toFixed(3)}`;
    return { cables: downCablesGeometry(key, [{ jack, path }]), plugs: downPlugsGeometry(key, [{ jack, path }]) };
  }, [ethernet, frame, g.cmY0, g.pmFront, W, cableLength]);

  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      <mesh geometry={metalGeometry(frame)} material={vertexColorMetal()} castShadow receiveShadow />
      <mesh geometry={plasticGeometry(frame)} material={vertexColorPlastic()} castShadow receiveShadow />
      <mesh geometry={decals.geometry} material={decals.atlas.material} receiveShadow />

      {/* fan (centred over the fin channels) */}
      <mesh ref={fan} geometry={rotorGeometry()} material={vertexColorPlastic()} position={[0, H + 0.0013, g.fanZ]} scale={[g.fanR / 0.021, 1, g.fanR / 0.021]} />
      <mesh
        geometry={cachedGeometry(`pf525-grille:${g.fanR}`, () => new THREE.CircleGeometry(g.fanR, 40))}
        material={fanGrilleMaterial()}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, H + 0.0029, g.fanZ]}
      />

      {/* control module: LCD, LEDs, membrane keypad */}
      <group position={[0, g.cmY0, g.pmFront]}>
        <mesh geometry={plane((LCD.u1 - LCD.u0) / 1000, (LCD.v1 - LCD.v0) / 1000)} material={lcd.mat} position={[(LCD.u0 + LCD.u1) / 2000, (LCD.v0 + LCD.v1) / 2000, CM.d + 0.0004]} receiveShadow />
        <mesh
          geometry={plane((LCD.u1 - LCD.u0) / 1000 + 0.001, (LCD.v1 - LCD.v0) / 1000 + 0.001)}
          material={lcdGlass()}
          position={[(LCD.u0 + LCD.u1) / 2000, (LCD.v0 + LCD.v1) / 2000, CM.d + 0.0009]}
        />
        <Keypad rect={decals.atlas.rects.front!} material={decals.atlas.material} z={CM.d + 0.0002} onKey={onKey} />
      </group>
      <PointLeds positions={leds.positions} size={[0.0022, 0.0013, 0.0006]} get={leds.get} color={leds.color} intensity={1.8} />

      {cable && (
        <>
          <mesh geometry={cable.plugs} material={plugClearMaterial()} />
          <mesh geometry={cable.cables} material={cableBootMaterial()} castShadow receiveShadow />
        </>
      )}

      {(highlighted || hovered) && (
        <HighlightFrame center={[0, H / 2, D / 2]} size={[W + 0.004, H + 2 * TAB + 0.004, D + 0.004]} strength={highlighted ? 1 : 0.35} />
      )}
    </group>
  );
}

function plane(w: number, h: number) {
  return cachedGeometry(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h));
}

function lcdGlass() {
  return cachedMaterial(
    'pf525-lcd-glass',
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: 0.04,
        metalness: 0,
        transparent: true,
        opacity: 0.08,
        clearcoat: 1,
        depthWrite: false,
      }),
  );
}

const hitMaterial = () => cachedMaterial('hit-invisible', () => new THREE.MeshBasicMaterial({ visible: false }));

/** Membrane keypad: one pillow mesh (morph target per key) + invisible hit boxes per key. */
function Keypad({ rect, material, z, onKey }: { rect: [number, number, number, number]; material: THREE.Material; z: number; onKey?: (k: PowerFlexKey) => void }) {
  const mesh = useRef<THREE.Mesh>(null);
  const pressed = useRef<boolean[]>(KEYS.map(() => false));
  const [hover, setHover] = useState(false);
  useCursor(hover && !!onKey);
  const geo = keypadGeometry(rect);
  useLayoutEffect(() => {
    mesh.current?.updateMorphTargets();
  }, [geo]);
  useFrame((_, dt) => {
    const inf = mesh.current?.morphTargetInfluences;
    if (!inf) return;
    const k = Math.min(1, dt * 30);
    for (let i = 0; i < KEYS.length; i++) {
      const target = pressed.current[i] ? 1 : 0;
      if (inf[i] !== target) inf[i] = Math.abs(target - inf[i]!) < 0.01 ? target : inf[i]! + (target - inf[i]!) * k;
    }
  });
  useEffect(() => () => void (pressed.current = KEYS.map(() => false)), []);
  return (
    <group position={[0, 0, z]}>
      <mesh ref={mesh} geometry={geo} material={material} receiveShadow />
      {KEYS.map((k, i) => (
        <mesh
          key={k.id}
          geometry={box(k.w / 1000, k.h / 1000, 0.002)}
          material={hitMaterial()}
          position={[k.u / 1000, k.v / 1000, 0.0006]}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            setHover(true);
          }}
          onPointerOut={() => {
            setHover(false);
            pressed.current[i] = false;
          }}
          onPointerDown={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            pressed.current[i] = true;
          }}
          onPointerUp={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            if (pressed.current[i]) onKey?.(k.id);
            pressed.current[i] = false;
          }}
        />
      ))}
    </group>
  );
}
