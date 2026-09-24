/**
 * PowerFlex 525 AC drive digital twin (25B-…, frames A / B / C).
 *
 * Real outlines (PowerFlex 520-series technical data, W × H × D): A 72 × 152 × 172 mm, B 87 × 180 × 172 mm,
 * C 109 × 220 × 184 mm. The removable CONTROL MODULE (identical on every frame) carries the integral LCD
 * display (5-digit 7-segment value, status annunciators, scrolling text line), the ENET / LINK / FAULT
 * indicators and the integral keypad: Esc, Sel, ▲, ▼, Enter, Reverse, green Start, red Stop and the speed
 * potentiometer. Below it: the hinged control-terminal cover. The POWER MODULE carries the finger-safe power
 * terminal guard (R/L1 S/L2 T/L3 — U/T1 V/T2 W/T3), the embedded EtherNet/IP RJ45, the rear aluminium
 * heat sink and the top cooling fan.
 *
 * Origin: center of the back mounting face at the bottom edge. Front faces +Z.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { Led, materials } from '../../../common';
import type { PowerFlex525Props } from '../../../contracts';
import { barcode, canvasTexture, CONDENSED, grain, mmCtx, SANS } from '../compactlogix/canvas';
import { box, cachedGeometry, cylinderZ, plane, profileGeometry, roundedBox } from '../compactlogix/geometry';
import { activityFlicker, cachedMaterial, decalMaterial, HighlightFrame, Rj45Jack, StaticInstances, usePick } from '../compactlogix/parts';

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
  catalog: string;
  rating: string;
  amps: string;
}

export const PF525_FRAMES: Record<PowerFlexFrame, FrameSpec> = {
  A: { w: 0.072, h: 0.152, d: 0.172, hs: 0.042, catalog: '25B-D4P0N104', rating: '1.5 kW / 2.0 HP', amps: '4.0' },
  B: { w: 0.087, h: 0.18, d: 0.172, hs: 0.042, catalog: '25B-D010N104', rating: '4.0 kW / 5.0 HP', amps: '10.5' },
  C: { w: 0.109, h: 0.22, d: 0.184, hs: 0.048, catalog: '25B-D017N104', rating: '7.5 kW / 10 HP', amps: '17.0' },
};

/** Control module (same on all frames). */
const CM = { w: 0.07, h: 0.105, d: 0.044 } as const;

export type PowerFlexKey = 'esc' | 'sel' | 'up' | 'down' | 'enter' | 'reverse' | 'start' | 'stop';

interface KeyDef {
  id: PowerFlexKey;
  u: number; // mm, control-module local (0 = center)
  v: number; // mm from control-module bottom
  w: number;
  h: number;
  color: string;
  legend: string;
  legendColor?: string;
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

/** Height (mm) of the flat front face of the control module that carries the atlas. */
const FACE_H = 95;
const FACE_V0 = 3; // bottom chamfer
const LCD = { u0: -17.5, u1: 30.5, v0: 76, v1: 92 } as const;
const PAD = { u0: -33, u1: 33, v0: 41, v1: 94.2 } as const; // keypad membrane
const POT = { u: 0, v: 47.5, r: 5.4 } as const;
const PF_LEDS = [
  { id: 'ENET', v: 89.4, color: 'green' as const },
  { id: 'LINK', v: 84.2, color: 'green' as const },
  { id: 'FAULT', v: 79.0, color: 'red' as const },
];

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const KS = 14; // px per mm for the control module atlas

/** Control-module front atlas: membrane, key faces & legends, LED labels, lower cover print. */
function frontAtlas() {
  const wMm = CM.w * 1000;
  const hMm = FACE_H;
  return canvasTexture('pf525-front', Math.round(wMm * KS), Math.round(hMm * KS), (ctx, w, h) => {
    const m = mmCtx(ctx, KS, hMm);
    const U = (u: number) => u + wMm / 2;
    // body
    ctx.fillStyle = '#1e2023';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.025, 17);
    // keypad membrane (slightly lighter, satin)
    m.rect(U(PAD.u0), PAD.v0, PAD.u1 - PAD.u0, PAD.v1 - PAD.v0, '#2a2d31', 2.5);
    m.strokeRect(U(PAD.u0), PAD.v0, PAD.u1 - PAD.u0, PAD.v1 - PAD.v0, '#3a3e43', 0.3, 2.5);
    // LCD bezel
    m.rect(U(LCD.u0) - 1.4, LCD.v0 - 1.4, LCD.u1 - LCD.u0 + 2.8, LCD.v1 - LCD.v0 + 2.8, '#0c0d0f', 1.4);
    // LED labels
    for (const l of PF_LEDS) {
      m.rect(U(-30.2) - 1.3, l.v - 0.9, 2.6, 1.8, '#050505', 0.4);
      m.text(l.id, U(-28.3), l.v, 1.75, { color: '#e9e9e9', weight: 700, font: CONDENSED });
    }
    // keys
    for (const k of KEYS) {
      const x = U(k.u - k.w / 2);
      const y = k.v - k.h / 2;
      const g = ctx.createLinearGradient(0, m.y(k.v + k.h / 2), 0, m.y(k.v - k.h / 2));
      const base = new THREE.Color(k.color);
      const hi = base.clone().lerp(new THREE.Color('#ffffff'), 0.12).getStyle();
      const lo = base.clone().multiplyScalar(0.78).getStyle();
      g.addColorStop(0, hi);
      g.addColorStop(1, lo);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(m.x(x), m.y(y + k.h), k.w * KS, k.h * KS, 1.6 * KS);
      ctx.fill();
      const isSym = k.legend.length === 1;
      m.text(k.legend, U(k.u), k.v - (isSym ? 0.1 : 0), isSym ? 4.2 : 3.0, {
        color: k.legendColor ?? '#f4f4f4',
        weight: k.id === 'start' || k.id === 'stop' ? 800 : 700,
        align: 'center',
        font: isSym ? 'DejaVu Sans, Arial Unicode MS, Segoe UI Symbol, sans-serif' : SANS,
      });
    }
    // pot legend ring
    m.circle(U(POT.u), POT.v, POT.r + 1.4, '#16171a');
    for (let i = 0; i <= 10; i++) {
      const a = (-225 + (i * 270) / 10) * (Math.PI / 180);
      const r0 = POT.r + 1.7;
      const r1 = POT.r + (i % 5 === 0 ? 2.9 : 2.3);
      m.line(U(POT.u) + Math.cos(a) * r0, POT.v + Math.sin(a) * r0, U(POT.u) + Math.cos(a) * r1, POT.v + Math.sin(a) * r1, '#c9ccd0', 0.25);
    }
    // lower (control terminal) cover
    m.line(1.2, 39.4, wMm - 1.2, 39.4, '#0b0c0d', 0.35);
    m.text('PowerFlex', 5, 31.5, 5.2, { color: '#f2f2f2', weight: 700, font: SANS });
    m.text('525', 5 + 28.5, 31.5, 5.2, { color: '#f2f2f2', weight: 300, font: SANS });
    // vent louvres
    for (let i = 0; i < 5; i++) m.rect(5, 7 + i * 3.4, 38, 1.5, '#0a0b0c', 0.7);
    // warning label
    m.rect(47, 5, 18, 23, '#f2c200', 1.2);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(m.x(56), m.y(25.5));
    ctx.lineTo(m.x(62.5), m.y(15));
    ctx.lineTo(m.x(49.5), m.y(15));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2c200';
    ctx.beginPath();
    ctx.moveTo(m.x(56), m.y(23.6));
    ctx.lineTo(m.x(61), m.y(15.9));
    ctx.lineTo(m.x(51), m.y(15.9));
    ctx.closePath();
    ctx.fill();
    // lightning bolt
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(m.x(56.6), m.y(22.6));
    ctx.lineTo(m.x(54.8), m.y(19));
    ctx.lineTo(m.x(56.4), m.y(19));
    ctx.lineTo(m.x(55.2), m.y(16.6));
    ctx.lineTo(m.x(57.6), m.y(20));
    ctx.lineTo(m.x(56), m.y(20));
    ctx.closePath();
    ctx.fill();
    m.text('DANGER', 56, 12.6, 2.1, { color: '#111', weight: 900, align: 'center' });
    m.text('Wait 3 min after', 56, 9.8, 1.25, { color: '#111', weight: 600, align: 'center' });
    m.text('removing power', 56, 7.8, 1.25, { color: '#111', weight: 600, align: 'center' });
    // cover screw
    m.circle(wMm / 2, 5.2, 1.5, '#0d0e10');
    m.circle(wMm / 2, 5.2, 1.1, '#6d7278');
    m.line(wMm / 2 - 0.8, 5.2, wMm / 2 + 0.8, 5.2, '#222', 0.25);
  });
}

function guardTexture(frame: PowerFlexFrame, wMm: number, hMm: number) {
  return canvasTexture(`pf525-guard:${frame}`, Math.round(wMm * 12), Math.round(hMm * 12), (ctx, w, h) => {
    const m = mmCtx(ctx, 12, hMm);
    ctx.fillStyle = '#1a1b1e';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.03, 23);
    const labels = ['R/L1', 'S/L2', 'T/L3', 'U/T1', 'V/T2', 'W/T3'];
    const pitch = (wMm - 8) / 6;
    labels.forEach((l, i) => {
      const u = 4 + pitch * (i + 0.5) + (i >= 3 ? 1.2 : -1.2);
      m.rect(u - pitch * 0.32, 2.2, pitch * 0.64, hMm * 0.34, '#050506', 0.8); // wire entry
      m.circle(u, hMm * 0.62, Math.min(1.9, pitch * 0.22), '#060607'); // screw access
      m.circle(u, hMm * 0.62, Math.min(1.35, pitch * 0.16), '#8a9096');
      m.text(l, u, hMm - 3.4, Math.min(2.1, pitch * 0.26), { color: '#e6e6e6', weight: 700, align: 'center', font: CONDENSED });
    });
    m.line(wMm / 2, 3, wMm / 2, hMm - 2, '#303236', 0.3);
    m.text('LINE', 4 + pitch * 1.5 - 1.2, hMm - 6.6, 1.6, { color: '#9ea2a6', weight: 700, align: 'center' });
    m.text('MOTOR', 4 + pitch * 4.5 + 1.2, hMm - 6.6, 1.6, { color: '#9ea2a6', weight: 700, align: 'center' });
  });
}

function nameplateTexture(frame: PowerFlexFrame, catalog?: string) {
  const f = { ...PF525_FRAMES[frame], ...(catalog ? { catalog } : {}) };
  return canvasTexture(`pf525-nameplate:${frame}:${f.catalog}`, 700, 520, (ctx, w, h) => {
    const m = mmCtx(ctx, 10, 52);
    ctx.fillStyle = '#e4e5e3';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 16);
    ctx.fill();
    m.text('PowerFlex 525', 3, 47.5, 4.2, { color: '#111', weight: 800 });
    m.text('AC DRIVE', 67, 47.5, 2.6, { color: '#111', weight: 700, align: 'right' });
    m.text(`Cat No. ${f.catalog}`, 3, 42, 3.1, { color: '#111', weight: 700 });
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
  });
}

function fanGrilleTexture() {
  const t = canvasTexture('pf525-fan-grille', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000000';
    const cx = w / 2;
    const cy = h / 2;
    for (let r = 26; r < 120; r += 18) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((i * Math.PI) / 4 + Math.PI / 8);
      ctx.fillRect(-4, -128, 8, 256);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(cx, cy, 126, 0, Math.PI * 2);
    ctx.fill();
  });
  return t;
}

function knockoutTexture(frame: PowerFlexFrame, wMm: number) {
  return canvasTexture(`pf525-knockouts:${frame}`, Math.round(wMm * 8), 52 * 8, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const m = mmCtx(ctx, 8, 52);
    const n = wMm > 90 ? 3 : 2;
    const r = frame === 'A' ? 11 : 13.5;
    for (let i = 0; i < n; i++) {
      const u = (wMm / n) * (i + 0.5);
      m.circle(u, 30, r, '#0a0a0b');
      m.circle(u, 30, r - 1.2, '#2a2c2f');
    }
  });
}

function ventSlotsTexture(key: string, wMm: number, dMm: number) {
  return canvasTexture(`pf525-vents:${key}`, Math.round(wMm * 10), Math.round(dMm * 10), (ctx, w, h) => {
    ctx.fillStyle = '#1c1d20';
    ctx.fillRect(0, 0, w, h);
    const m = mmCtx(ctx, 10, dMm);
    const n = Math.floor((wMm - 6) / 3.2);
    for (let i = 0; i < n; i++) m.rect(3 + i * 3.2 + 0.4, 3, 1.6, dMm - 6, '#040405', 0.8);
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
    return { ctx: canvas.getContext('2d')!, tex, mat, key: '', last: -1 };
  }, []);
  useEffect(
    () => () => {
      st.tex.dispose();
      st.mat.dispose();
    },
    [st],
  );
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
  highlighted = false,
  onSelect,
  position,
  rotation,
  scale,
}: PowerFlex525TwinProps) {
  const f = PF525_FRAMES[frame];
  const { w: W, h: H, d: D, hs: HS } = f;
  const pmFront = D - CM.d; // power module front face
  const cmY0 = H - 0.004 - CM.h; // control module bottom
  const guardH = Math.min(cmY0 - 0.006, 0.052);
  const { hovered, handlers } = usePick(onSelect);

  const lcd = useLcd();
  const fan = useRef<THREE.Group>(null);
  const fanSpeed = useRef(0);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const running = getRunning();
    const faulted = getFaulted?.() ?? false;
    const reverse = getReverse?.() ?? false;
    const hz = Math.max(0, getFrequency());
    // fan spins up/down smoothly
    const target = running || hz > 0.5 ? 38 : 0;
    fanSpeed.current += (target - fanSpeed.current) * Math.min(1, dt * 1.5);
    if (fan.current) fan.current.rotation.y += fanSpeed.current * dt;

    // LCD: redraw at ≤ 8 Hz and only when content changes
    const tick = Math.floor(t * 8);
    if (tick === lcd.last) return;
    lcd.last = tick;
    let s: LcdState;
    if (faulted) {
      const code = getFaultCode?.() ?? 2;
      const blink = Math.floor(t * 2) % 2 === 0;
      s = {
        value: blink ? `F ${String(code).padStart(3, '0')}` : '',
        unit: '',
        run: false,
        fwd: false,
        rev: false,
        fault: true,
        spinner: -1,
        line: `F${String(code).padStart(3, '0')} ${FAULT_TEXT[code] ?? 'Drive Fault'}`,
        program: false,
      };
    } else {
      const shown = (Math.round(hz * 100) / 100).toFixed(2);
      s = {
        value: shown,
        unit: 'Hz',
        run: running,
        fwd: (running || hz > 0) && !reverse,
        rev: (running || hz > 0) && reverse,
        fault: false,
        spinner: running && hz > 0.1 ? (reverse ? 7 - (Math.floor(t * (2 + hz / 6)) % 8) : Math.floor(t * (2 + hz / 6)) % 8) : -1,
        line: running ? 'b001 Output Freq' : 'b001 Output Freq  Ready',
        program: false,
      };
    }
    const key = JSON.stringify(s);
    if (key === lcd.key) return;
    lcd.key = key;
    drawLcd(lcd.ctx, s);
    lcd.tex.needsUpdate = true;
  });

  // ------------------------------------------------------------------ geometry
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
  const cmGeo = profileGeometry(
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
  const fins = useMemo(() => {
    const n = Math.max(6, Math.floor((W - 0.006) / 0.0046));
    const pitch = (W - 0.006) / (n - 1);
    return Array.from({ length: n }, (_, i): [number, number, number] => [-(W - 0.006) / 2 + i * pitch, H / 2, (HS - 0.006) / 2]);
  }, [W, H, HS]);

  const body = materials.plastic('#1b1c1f', 0.55);
  const cmMat = materials.plastic('#1e2023', 0.42);
  const alu = materials.metal('#8f969d', 0.42);
  const atlas = frontAtlas();
  const atlasMat = decalMaterial(atlas, 0.5, 0.05);
  const guardW = Math.min(W - 0.008, 0.1);
  const fanR = Math.min(0.024, (W - 0.02) / 2);
  const fanZ = HS + 0.006 + fanR;
  const topVentD = pmFront - 0.006 - (fanZ + fanR + 0.006);

  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      {/* heat sink */}
      <mesh geometry={box(W - 0.003, H - 0.004, 0.006)} material={alu} position={[0, H / 2, HS - 0.003]} castShadow receiveShadow />
      <StaticInstances geometry={box(0.0012, H - 0.012, HS - 0.006)} material={alu} positions={fins} castShadow />
      {/* plastic housing (power module) */}
      <mesh geometry={housing} material={body} castShadow receiveShadow />
      {/* top vents + fan */}
      <mesh
        geometry={plane(W - 0.01, topVentD)}
        material={decalMaterial(ventSlotsTexture(`top:${frame}`, (W - 0.01) * 1000, topVentD * 1000), 0.7)}
        position={[0, H + 0.0002, pmFront - 0.006 - topVentD / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <FanAssembly W={W} H={H} cz={fanZ} spin={fan} />
      {/* side nameplate (right) */}
      <mesh
        geometry={plane(0.07 * Math.min(1, (pmFront - HS) / 0.08), 0.052 * Math.min(1, (pmFront - HS) / 0.08))}
        material={decalMaterial(nameplateTexture(frame, catalog), 0.5)}
        position={[W / 2 + 0.0002, H * 0.56, HS + (pmFront - HS) / 2]}
        rotation={[0, Math.PI / 2, 0]}
      />
      {/* bottom vents */}
      <mesh
        geometry={plane(W - 0.01, pmFront - HS - 0.03)}
        material={decalMaterial(ventSlotsTexture(`bot:${frame}`, (W - 0.01) * 1000, (pmFront - HS - 0.03) * 1000), 0.7)}
        position={[0, -0.0002, HS + 0.01 + (pmFront - HS - 0.03) / 2]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* power terminal guard */}
      <mesh geometry={roundedBox(guardW, guardH, 0.014, 0.0012)} material={body} position={[0, 0.003 + guardH / 2, pmFront + 0.005]} castShadow />
      <mesh
        geometry={plane(guardW - 0.002, guardH - 0.002)}
        material={decalMaterial(guardTexture(frame, (guardW - 0.002) * 1000, (guardH - 0.002) * 1000), 0.7)}
        position={[0, 0.003 + guardH / 2, pmFront + 0.0122]}
      />

      {/* conduit / EMC plate under the power terminals with knockouts */}
      <mesh geometry={box(W - 0.006, 0.0015, pmFront + 0.014 - (pmFront - 0.04))} material={materials.metal('#b9bec3', 0.4)} position={[0, 0.00075, pmFront - 0.04 + (0.054) / 2]} castShadow />
      <mesh
        geometry={plane(W - 0.008, 0.052)}
        material={decalMaterial(knockoutTexture(frame, (W - 0.008) * 1000), 0.45, 0.8, true)}
        position={[0, -0.0001, pmFront - 0.04 + 0.027]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* control module */}
      <group position={[0, cmY0, pmFront]}>
        <mesh geometry={cmGeo} material={cmMat} castShadow receiveShadow />
        <mesh geometry={atlasPlane()} material={atlasMat} position={[0, 0, CM.d + 0.0002]} />
        {/* LCD */}
        <mesh
          geometry={plane((LCD.u1 - LCD.u0) / 1000, (LCD.v1 - LCD.v0) / 1000)}
          material={lcd.mat}
          position={[(LCD.u0 + LCD.u1) / 2000, (LCD.v0 + LCD.v1) / 2000, CM.d + 0.0004]}
        />
        <mesh
          geometry={plane((LCD.u1 - LCD.u0) / 1000 + 0.001, (LCD.v1 - LCD.v0) / 1000 + 0.001)}
          material={lcdGlass()}
          position={[(LCD.u0 + LCD.u1) / 2000, (LCD.v0 + LCD.v1) / 2000, CM.d + 0.0009]}
        />
        {/* status indicators */}
        <Led color="green" get={() => (ethernet ? 'on' : 'off')} size={[0.0024, 0.0016, 0.0006]} position={[-0.0302, PF_LEDS[0].v / 1000, CM.d + 0.0005]} />
        <Led color="green" get={() => ethernet && activityFlicker(7)} size={[0.0024, 0.0016, 0.0006]} position={[-0.0302, PF_LEDS[1].v / 1000, CM.d + 0.0005]} />
        <Led color="red" get={() => (getFaulted?.() ? 'flash' : 'off')} size={[0.0024, 0.0016, 0.0006]} position={[-0.0302, PF_LEDS[2].v / 1000, CM.d + 0.0005]} />
        {/* keypad */}
        {KEYS.map((k) => (
          <Key key={k.id} def={k} z={CM.d} material={atlasMat} onKey={onKey} />
        ))}
        <Pot z={CM.d} />
        {/* USB (top of control module) */}
        <mesh geometry={box(0.0078, 0.0005, 0.0032)} material={materials.plastic('#050506', 0.8)} position={[0.022, CM.h + 0.0002, CM.d - 0.012]} />
        {/* embedded EtherNet/IP port on the underside, cable dropping down */}
        <Rj45Jack position={[-0.018, -0.0001, CM.d - 0.014]} rotation={[Math.PI / 2, 0, 0]} />
        {ethernet && <DropCable position={[-0.018, 0, CM.d - 0.014]} length={cmY0 + 0.08} />}
      </group>

      {(highlighted || hovered) && (
        <HighlightFrame center={[0, H / 2, D / 2]} size={[W + 0.004, H + 0.004, D + 0.004]} strength={highlighted ? 1 : 0.35} />
      )}
    </group>
  );
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

/** Front-face plane of the control module (y ∈ [FACE_V0, FACE_H] mm) with UVs into the atlas. */
function atlasPlane() {
  return cachedGeometry('pf525-atlas-plane', () => {
    const h = (FACE_H - FACE_V0) / 1000;
    const g = new THREE.PlaneGeometry(CM.w - 0.0024, h);
    g.translate(0, FACE_V0 / 1000 + h / 2, 0);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / (FACE_H / 1000));
    uv.needsUpdate = true;
    return g;
  });
}

/** Rounded key cap whose front face samples the control-module atlas (planar UV projection). */
function keyGeometry(def: KeyDef) {
  return cachedGeometry(`pf525-key:${def.id}`, () => {
    const g = roundedBox(def.w / 1000 - 0.0006, def.h / 1000 - 0.0006, 0.0018, 0.0009, 3).clone();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    // atlas: width CM.w - 0.0024 centered at u = 0, covering v ∈ [0, FACE_H]
    const aw = CM.w - 0.0024;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + def.u / 1000;
      const y = pos.getY(i) + def.v / 1000;
      uv.setXY(i, (x + aw / 2) / aw, y / (FACE_H / 1000));
    }
    uv.needsUpdate = true;
    return g;
  });
}

function Key({ def, z, material, onKey }: { def: KeyDef; z: number; material: THREE.Material; onKey?: (k: PowerFlexKey) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  const pressed = useRef(false);
  useCursor(hover && !!onKey);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const target = z + (pressed.current ? 0.0003 : 0.0009);
    m.position.z += (target - m.position.z) * Math.min(1, dt * 30);
  });
  return (
    <mesh
      ref={ref}
      geometry={keyGeometry(def)}
      material={material}
      position={[def.u / 1000, def.v / 1000, z + 0.0009]}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => {
        setHover(false);
        pressed.current = false;
      }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        pressed.current = true;
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (pressed.current) onKey?.(def.id);
        pressed.current = false;
      }}
    />
  );
}

function Pot({ z }: { z: number }) {
  const knurl = cachedGeometry('pf525-pot', () => {
    const pts: THREE.Vector2[] = [];
    pts.push(new THREE.Vector2(0, 0));
    pts.push(new THREE.Vector2(POT.r / 1000, 0));
    pts.push(new THREE.Vector2(POT.r / 1000, 0.0032));
    pts.push(new THREE.Vector2(POT.r / 1000 - 0.0006, 0.0038));
    pts.push(new THREE.Vector2(0, 0.0038));
    const g = new THREE.LatheGeometry(pts, 28);
    g.rotateX(Math.PI / 2);
    return g;
  });
  return (
    <group position={[POT.u / 1000, POT.v / 1000, z]}>
      <mesh geometry={knurl} material={materials.plastic('#121314', 0.45)} castShadow />
      <mesh geometry={box(0.0008, 0.0036, 0.0003)} material={materials.plastic('#e8e8e8', 0.4)} position={[0, 0.0022, 0.0039]} rotation={[0, 0, 0.6]} />
    </group>
  );
}

/** Top-mounted cooling fan: low shroud, dark plenum, 7-blade impeller (spins with the drive) under a grille. */
function FanAssembly({ W, H, cz, spin }: { W: number; H: number; cz: number; spin: RefObject<THREE.Group | null> }) {
  const r = Math.min(0.024, (W - 0.02) / 2);
  const grille = cachedMaterial(
    'pf525-grille',
    () => new THREE.MeshStandardMaterial({ color: '#1d1e21', roughness: 0.55, alphaMap: fanGrilleTexture(), alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  const blade = cachedGeometry('pf525-fan-blade', () => {
    const g = new THREE.BoxGeometry(0.0165, 0.0007, 0.0055);
    g.rotateX(0.38);
    g.translate(0.0118, 0, 0);
    return g;
  });
  const blades = useMemo(() => Array.from({ length: 7 }, (_, i) => (i / 7) * Math.PI * 2), []);
  const shroudMat = materials.plastic('#141517', 0.55);
  return (
    <group position={[0, H, cz]}>
      <mesh geometry={cachedGeometry(`pf525-fan-floor:${r}`, () => new THREE.CircleGeometry(r, 32))} material={materials.plastic('#060606', 0.95)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0002, 0]} />
      <mesh geometry={cachedGeometry(`pf525-fan-wall:${r}`, () => new THREE.CylinderGeometry(r + 0.0012, r + 0.0012, 0.003, 40, 1, true))} material={shroudMat} position={[0, 0.0015, 0]} />
      <mesh geometry={cachedGeometry(`pf525-fan-ring:${r}`, () => new THREE.RingGeometry(r, r + 0.0028, 40))} material={shroudMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} />
      <group ref={spin} position={[0, 0.0013, 0]} scale={[r / 0.021, 1, r / 0.021]}>
        <mesh geometry={cylinderZ(0.0075, 0.0075, 0.0016, 20)} material={materials.plastic('#2a2c2f', 0.5)} rotation={[Math.PI / 2, 0, 0]} />
        {blades.map((a) => (
          <mesh key={a} geometry={blade} material={materials.plastic('#2c2d30', 0.5)} rotation={[0, a, 0]} />
        ))}
      </group>
      <mesh geometry={cachedGeometry(`pf525-grille:${r}`, () => new THREE.CircleGeometry(r, 40))} material={grille} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0029, 0]} />
    </group>
  );
}

/** EtherNet/IP patch cable plugged into an RJ45 facing down, dropping straight down. */
function DropCable({ position, length }: { position: [number, number, number]; length: number }) {
  const cable = cachedGeometry(`pf525-drop:${length.toFixed(3)}`, () => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.019, 0),
      new THREE.Vector3(0, -0.035, 0.002),
      new THREE.Vector3(0, -0.06, 0.008),
      new THREE.Vector3(0, -length, 0.014),
    ]);
    return new THREE.TubeGeometry(curve, 24, 0.0028, 10, false);
  });
  const boot = materials.plastic('#2f7fd8', 0.5);
  return (
    <group position={position}>
      <mesh geometry={box(0.0114, 0.009, 0.0078)} material={cachedMaterial('rj45-plug-clear-pf', () => new THREE.MeshStandardMaterial({ color: '#9fb3c4', roughness: 0.12, transparent: true, opacity: 0.45 }))} position={[0, -0.0035, 0]} />
      <mesh geometry={roundedBox(0.0122, 0.011, 0.0098, 0.0028)} material={boot} position={[0, -0.013, 0]} castShadow />
      <mesh geometry={cable} material={boot} castShadow />
    </group>
  );
}
