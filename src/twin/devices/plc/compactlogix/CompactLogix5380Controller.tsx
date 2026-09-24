/**
 * CompactLogix 5380 controller (5069-L320ER / 5069-L330ERM ...) digital twin.
 *
 * Real proportions (5069-TD002): 143.97 × 98.10 × 136.81 mm (H × W × D). The 5380 L3 shares the mechanical
 * packaging of the 5069-AEN2TR adapter: a left power column carrying the MOD power (4-pin) and SA power
 * (6-pin) removable terminal blocks, and a deeper main body with the 4-character dot-matrix status display,
 * status indicators (SA PWR, MOD PWR, RUN, FORCE, SD, OK, NET/LINK A1/A2), the 3-position mode switch
 * (RUN/REM/PROG), SD card slot, USB port and the two 1 Gb EtherNet/IP RJ45 ports (A1/A2) on the bottom.
 *
 * Origin: center of the back mounting face at the bottom edge. Front faces +Z.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { COLORS, Led, materials, type LedColor, type LedMode } from '../../../common';
import type { Placement, RackLive } from '../../../contracts';
import type { ControllerStatus, KeySwitch } from '../../../../plc/types';
import { barcode, canvasTexture, CONDENSED, grain, mmCtx } from './canvas';
import { box, cachedGeometry, plane, profileGeometry, roundedBox, screwHeadGeometry } from './geometry';
import { housingGeometry, M5069, VentDecal } from './Module5069';
import {
  activityFlicker,
  cachedMaterial,
  decalMaterial,
  DotMatrixDisplay,
  glossyBlack,
  HighlightFrame,
  Rj45Jack,
  StaticInstances,
  usePick,
  vertexColorMetal,
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
const CHAMFER = 0.024; // bottom-front chamfer carrying the RJ45 ports

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
const JACKS = [22, 54];

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

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const MAIN_PROFILE: Array<[number, number]> = [
  [0, 0.002],
  [0.002, 0],
  [D - CHAMFER, 0],
  [D, CHAMFER],
  [D, H - 0.006],
  [D - 0.006, H],
  [0.004, H],
  [0, H - 0.003],
];

function mainBodyGeometry() {
  return profileGeometry('5380-main', MAIN_PROFILE, MW, 0.0007);
}

// ---------------------------------------------------------------------------
// Decals
// ---------------------------------------------------------------------------

const S = 16; // px/mm

function panelTexture(catalog: string) {
  return canvasTexture(`5380-panel:${catalog}`, PANEL.w * S, PANEL.h * S, (ctx, w, h) => {
    const m = mmCtx(ctx, S, PANEL.h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#15171a');
    g.addColorStop(1, '#0b0c0e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // title
    m.text('CompactLogix', 4, PANEL.h - 4.2, 3.4, { color: '#f4f4f2', weight: 700 });
    m.text('5380', 4 + 24.2, PANEL.h - 4.2, 3.4, { color: '#f4f4f2', weight: 400 });
    m.text(catalog, PANEL.w - 3.5, PANEL.h - 4.2, 2.4, { color: '#c9ccd0', weight: 600, align: 'right' });
    // display bezel
    m.rect(DISPLAY.u - PANEL.u - 1.2, DISPLAY.v - PANEL.v - 1.2, DISPLAY.w + 2.4, DISPLAY.h + 2.4, '#2c2f33', 1.2);
    m.rect(DISPLAY.u - PANEL.u - 0.4, DISPLAY.v - PANEL.v - 0.4, DISPLAY.w + 0.8, DISPLAY.h + 0.8, '#020202', 0.8);
    // right of the display: controller memory/nodes print
    const mem = catalog.includes('L306') ? '0.6 MB' : catalog.includes('L310') ? '1 MB' : catalog.includes('L320') ? '2 MB' : catalog.includes('L330') ? '3 MB' : '5 MB';
    m.text('LOGIX', 44, 88 + 36 - PANEL.v, 2.3, { color: '#9fa4aa', weight: 700, letterSpacing: 0.4 });
    m.text(`${mem} · 1 Gb`, 44, 88 + 32 - PANEL.v, 1.9, { color: '#8d9298', weight: 600 });
    m.text(catalog.endsWith('M') ? 'MOTION' : 'EtherNet/IP', 44, 88 + 28.6 - PANEL.v, 1.9, { color: '#8d9298', weight: 600 });
    // indicator labels + LED windows
    for (const ind of INDICATORS) {
      const u = LED_COL[ind.col]! - PANEL.u;
      const v = LED_ROWS[ind.row]! - PANEL.v;
      m.rect(u - 1.6, v - 0.95, 3.2, 1.9, '#020202', 0.35);
      m.text(ind.id, u + 2.6, v, 2.05, { color: '#eceeee', weight: 700, font: CONDENSED });
    }
    m.line(35, 3, 35, 25, '#2a2d31', 0.25);
  });
}

function mainFaceTexture(catalog: string) {
  const hMm = (H - CHAMFER) * 1000;
  const wMm = MW * 1000 - 1.4;
  return canvasTexture(`5380-face:${catalog}`, Math.round(wMm * 12), Math.round(hMm * 12), (ctx, w, h) => {
    const m = mmCtx(ctx, 12, hMm);
    const off = CHAMFER * 1000; // face v=0 is at y=CHAMFER
    ctx.fillStyle = '#26282c';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.03, 3);
    // pocket labels (pocket floor itself is geometry)
    // write-on IP label
    m.rect(5, 30 - off, 34, 11, '#e9e9e4', 0.6);
    m.text('IP ADDRESS', 7, 38.6 - off, 1.8, { color: '#333', weight: 700 });
    m.text('192.168.1.10', 7, 34.2 - off, 2.6, { color: '#1c3f94', weight: 600, font: 'Comic Sans MS, cursive' });
    m.line(7, 32.3 - off, 37, 32.3 - off, '#9a9a96', 0.15);
    // MAC / serial label
    m.rect(43, 30 - off, 26, 11, '#d7d9db', 0.6);
    m.text('MAC 5C:88:16:A3:0F:2E', 44.2, 38.8 - off, 1.25, { color: '#333', weight: 600, font: CONDENSED });
    barcode(m, 44.2, 31.6 - off, 23.5, 4.8, 42);
    m.text('SER A  FW 36.011', 44.2, 30.8 - off, 1.05, { color: '#333', weight: 600, font: CONDENSED });
    // port legends above the RJ45 chamfer
    for (const [i, u] of JACKS.entries()) {
      m.text(`A${i + 1}`, u, CHAMFER * 1000 + 3.2 - off, 2.6, { color: '#f0f0f0', weight: 800, align: 'center' });
      m.text('1 Gb', u, CHAMFER * 1000 + 0.9 - off, 1.4, { color: '#b9bcbf', weight: 600, align: 'center' });
    }
    m.text('ETHERNET', 38, CHAMFER * 1000 + 2.2 - off, 1.4, { color: '#b9bcbf', weight: 700, align: 'center', letterSpacing: 0.25 });
  });
}

function pocketTexture() {
  return canvasTexture('5380-pocket', POCKET.w * S, POCKET.h * S, (ctx, w, h) => {
    const m = mmCtx(ctx, S, POCKET.h);
    ctx.fillStyle = '#131416';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.03, 9);
    // mode switch legends
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
    // SD
    m.rect(SD.u - POCKET.u - 14, SD.v - POCKET.v - 2.1, 28, 4.2, '#030303', 0.8);
    m.text('SD', SD.u - POCKET.u - 14, SD.v - POCKET.v - 5, 2.1, { color: '#f0f0f0', weight: 800 });
    m.text('Do not remove while SD indicator flashes', SD.u - POCKET.u - 9, SD.v - POCKET.v - 5, 1.15, { color: '#a9adb1', weight: 500 });
    // USB legend + trident
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
    // warning text
    m.text('Temporary local programming only', USB.u - POCKET.u - 40, USB.v - POCKET.v - 8.4, 1.1, { color: '#8d9196', weight: 500 });
  });
}

function powerHeadTexture() {
  const hMm = 31.9;
  return canvasTexture('5380-powerhead', Math.round(PW * 1000 * 20), Math.round(hMm * 20), (ctx, w, h) => {
    const m = mmCtx(ctx, 20, hMm);
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
  });
}

/** Power RTB legends: MOD (4 terminals) above SA (6 terminals). */
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

function powerRtbTexture(group: 'MOD' | 'SA', v0: number, hMm: number) {
  const wMm = PW * 1000 - 1.4;
  return canvasTexture(`5380-prtb:${group}`, Math.round(wMm * 22), Math.round(hMm * 22), (ctx, w, h) => {
    const m = mmCtx(ctx, 22, hMm);
    ctx.fillStyle = '#1c1d20';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.035, group === 'MOD' ? 2 : 4);
    m.text(group === 'MOD' ? 'MOD POWER' : 'SA POWER', wMm / 2, hMm - 3.6, 1.45, { color: '#ffffff', weight: 800, align: 'center', font: CONDENSED });
    for (const t of PWR_TERMS.filter((p) => p.group === group)) {
      const cu = t.u * 1000 + wMm / 2;
      const cv = (t.v - v0) * 1000;
      m.circle(cu, cv + 1.9, 2.05, '#07080a');
      m.rect(cu - 1.75, cv - 3.9, 3.5, 3.3, '#050506', 0.5);
      m.strokeRect(cu - 1.75, cv - 3.9, 3.5, 3.3, '#2c2e32', 0.25, 0.5);
      m.text(t.label, t.u < 0 ? 0.3 : wMm - 0.3, cv - 2.5, 1.0, { color: '#d9d9d9', weight: 700, align: t.u < 0 ? 'left' : 'right', font: CONDENSED });
    }
  });
}

function sdCardTexture() {
  return canvasTexture('1784-sd2-edge', 256, 32, (ctx, w, h) => {
    ctx.fillStyle = '#2d3136';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8dadc';
    ctx.fillRect(8, 6, 110, h - 12);
    ctx.fillStyle = '#222';
    ctx.font = `700 ${h * 0.5}px Arial`;
    ctx.textBaseline = 'middle';
    ctx.fillText('1784-SD2', 14, h / 2 + 1);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#3d4248';
      ctx.fillRect(140 + i * 10, 4, 5, h - 8);
    }
  });
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
  highlighted?: boolean;
  onSelect?: () => void;
}

export function CompactLogix5380Controller({
  catalog = '5069-L320ER',
  live,
  getStatus,
  onKeySwitch,
  cables = [true, false],
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
  const setKey = (pos: KeySwitch) => {
    localKey.current = pos;
    live?.setKeySwitch?.(pos);
    onKeySwitch?.(pos);
  };

  const { hovered, handlers } = usePick(onSelect);

  // indicator getters
  const ledGet = useMemo(() => {
    const okColor = (s: ControllerStatus): LedColor => (s.ok === 'green' ? 'green' : 'red');
    const g: Record<IndicatorId, { get: () => LedMode; getColor?: () => LedColor; color: LedColor }> = {
      'SA PWR': { color: 'green', get: () => true },
      'MOD PWR': { color: 'green', get: () => true },
      RUN: { color: 'green', get: () => status().runLed === 'green' },
      FORCE: {
        color: 'amber',
        get: () => {
          const f = status().forceLed;
          return f === 'amber' ? 'on' : f === 'flashing-amber' ? 'flash' : 'off';
        },
      },
      SD: { color: 'green', get: () => 'off' },
      OK: {
        color: 'green',
        getColor: () => okColor(status()),
        get: () => {
          const o = status().ok;
          return o === 'off' ? 'off' : o === 'flashing-red' ? 'flash' : 'on';
        },
      },
      'NET A1': {
        color: 'green',
        get: () => (!cables[0] ? 'off' : status().ioLed === 'flashing-red' ? 'flash' : live || getStatus ? 'on' : 'flash'),
        getColor: () => (status().ioLed === 'flashing-red' ? 'red' : 'green'),
      },
      'LINK A1': { color: 'green', get: () => cables[0] && activityFlicker(0) },
      'NET A2': { color: 'green', get: () => (cables[1] ? 'on' : 'off') },
      'LINK A2': { color: 'green', get: () => cables[1] && activityFlicker(3) },
    };
    return g;
  }, [status, cables, live, getStatus]);

  const mainMat = materials.plastic('#232528', 0.6);
  const powerHeadH = 0.0319;
  const headY0 = M5069.headBottom + 0.001;
  const screwPositions = useMemo<Array<[number, number, number]>>(
    () => PWR_TERMS.map((t) => [X_LEFT + PW / 2 + t.u, t.v + 0.0019, M5069.rtbFront + 0.00035]),
    [],
  );

  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      {/* ---------------- power column (MOD / SA power RTBs) ---------------- */}
      <group position={[X_LEFT + PW / 2, 0, 0]}>
        <mesh geometry={housingGeometry(PW)} material={materials.plastic(COLORS.moduleCharcoal, 0.62)} castShadow receiveShadow />
        <mesh
          geometry={plane(PW - 0.0012, powerHeadH)}
          material={decalMaterial(powerHeadTexture(), 0.35)}
          position={[0, headY0 + powerHeadH / 2, M5069.depth + 0.0002]}
        />
        <VentDecal width={PW - 0.003} depth={0.07} y={M5069.height} z0={0.012} />
        <PowerRtb group="MOD" y0={0.0725} y1={0.1030} />
        <PowerRtb group="SA" y0={0.0045} y1={0.0695} />
      </group>
      <StaticInstances geometry={screwHeadGeometry(0.00135, 0.001, 'combo')} material={vertexColorMetal()} positions={screwPositions} />

      {/* ---------------- main body ---------------- */}
      <group position={[X_MAIN, 0, 0]}>
        <mesh geometry={mainBodyGeometry()} material={mainMat} castShadow receiveShadow />
        <mesh
          geometry={plane(MW - 0.0014, H - CHAMFER - 0.0062)}
          material={decalMaterial(mainFaceTexture(catalog), 0.55)}
          position={[0, CHAMFER + (H - CHAMFER - 0.0062) / 2, D + 0.0002]}
        />
        <VentDecal width={MW - 0.004} depth={0.1} y={H} z0={0.018} />
      </group>

      {/* smoked display / indicator panel */}
      <mesh
        geometry={roundedBox(PANEL.w / 1000, PANEL.h / 1000, 0.0016, 0.0007)}
        material={glossyBlack()}
        position={[U(PANEL.u + PANEL.w / 2), V(PANEL.v + PANEL.h / 2), D + 0.0006]}
      />
      <mesh
        geometry={plane(PANEL.w / 1000 - 0.0012, PANEL.h / 1000 - 0.0012)}
        material={decalMaterial(panelTexture(catalog), 0.22, 0.05)}
        position={[U(PANEL.u + PANEL.w / 2), V(PANEL.v + PANEL.h / 2), D + 0.0016]}
      />
      <DotMatrixDisplay
        getText={() => status().displayText}
        width={DISPLAY.w / 1000}
        height={DISPLAY.h / 1000}
        position={[U(DISPLAY.u + DISPLAY.w / 2), V(DISPLAY.v + DISPLAY.h / 2), D + 0.0018]}
      />
      {/* display cover glass */}
      <mesh
        geometry={plane(DISPLAY.w / 1000 + 0.001, DISPLAY.h / 1000 + 0.001)}
        material={displayGlass()}
        position={[U(DISPLAY.u + DISPLAY.w / 2), V(DISPLAY.v + DISPLAY.h / 2), D + 0.0021]}
      />
      {INDICATORS.map((ind) => {
        const g = ledGet[ind.id];
        return (
          <Led
            key={ind.id}
            color={g.color}
            get={g.get}
            getColor={g.getColor}
            size={[0.0028, 0.0016, 0.0006]}
            position={[U(LED_COL[ind.col]!), V(LED_ROWS[ind.row]!), D + 0.0019]}
          />
        );
      })}

      {/* recessed pocket: mode switch, SD card, USB */}
      <PocketFrame />
      <ModeSwitch getPos={() => status().keySwitch} onSet={setKey} />
      <SdCard />
      <UsbB position={[U(USB.u), V(USB.v), D - 0.0005]} />

      {/* RJ45 ports on the bottom chamfer */}
      {JACKS.map((u) => (
        <Rj45Jack key={u} position={[U(u), CHAMFER / 2 + 0.001, D - CHAMFER / 2 + 0.001]} rotation={[Math.PI / 4, 0, 0]} />
      ))}
      {cables.map((on, i) => (on ? <PatchCable key={i} position={[U(JACKS[i]!), CHAMFER / 2 + 0.001, D - CHAMFER / 2 + 0.001]} /> : null))}

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

function PowerRtb({ group, y0, y1 }: { group: 'MOD' | 'SA'; y0: number; y1: number }) {
  const h = y1 - y0;
  const d = M5069.rtbFront - M5069.bodyFront;
  return (
    <group>
      <mesh
        geometry={roundedBox(PW - 0.0012, h, d, 0.0008)}
        material={materials.plastic('#1c1d20', 0.7)}
        position={[0, y0 + h / 2, M5069.bodyFront + d / 2]}
        castShadow
      />
      <mesh
        geometry={plane(PW - 0.0014, h - 0.0012)}
        material={decalMaterial(powerRtbTexture(group, y0, h * 1000), 0.72)}
        position={[0, y0 + h / 2, M5069.rtbFront + 0.0002]}
      />
      <mesh geometry={box(0.012, 0.0022, 0.003)} material={materials.plastic('#3a3d42', 0.5)} position={[0, y1 - 0.0008, M5069.rtbFront - 0.0002]} />
    </group>
  );
}

/** Raised frame around the pocket (reads as a recess) + pocket floor texture. */
function PocketFrame() {
  const tex = pocketTexture();
  const cx = U(POCKET.u + POCKET.w / 2);
  const cy = V(POCKET.v + POCKET.h / 2);
  const w = POCKET.w / 1000;
  const h = POCKET.h / 1000;
  const t = 0.0016;
  const rim = materials.plastic('#2c2f33', 0.5);
  const z = D + 0.0009;
  return (
    <group>
      <mesh geometry={plane(w, h)} material={decalMaterial(tex, 0.75)} position={[cx, cy, D + 0.0004]} />
      <mesh geometry={box(w + 2 * t, t, 0.0018)} material={rim} position={[cx, cy + h / 2 + t / 2, z]} />
      <mesh geometry={box(w + 2 * t, t, 0.0018)} material={rim} position={[cx, cy - h / 2 - t / 2, z]} />
      <mesh geometry={box(t, h, 0.0018)} material={rim} position={[cx - w / 2 - t / 2, cy, z]} />
      <mesh geometry={box(t, h, 0.0018)} material={rim} position={[cx + w / 2 + t / 2, cy, z]} />
    </group>
  );
}

const KEY_V: Record<KeySwitch, number> = { RUN: SWITCH.vRun, REM: SWITCH.vRem, PROG: SWITCH.vProg };

/** 3-position mode switch (slide lever). Click a position legend/zone to move it there; clicking the lever cycles. */
function ModeSwitch({ getPos, onSet }: { getPos: () => KeySwitch; onSet: (p: KeySwitch) => void }) {
  const lever = useRef<THREE.Group>(null);
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
      <group ref={lever} position={[U(SWITCH.u), V(SWITCH.vRem), D + 0.0004]}>
        <mesh geometry={roundedBox(0.0036, 0.0048, 0.0036, 0.0008)} material={materials.plastic('#d8dadc', 0.45)} castShadow />
        <mesh geometry={box(0.0028, 0.0005, 0.0002)} material={materials.plastic('#6b7075', 0.5)} position={[0, 0, 0.0019]} />
      </group>
    </group>
  );
}

function SdCard() {
  const edge = sdCardTexture();
  return (
    <group position={[U(SD.u), V(SD.v), D]}>
      <mesh geometry={box(0.024, 0.0021, 0.004)} material={materials.plastic('#2d3136', 0.45)} position={[0, 0, 0.0005]} />
      <mesh geometry={plane(0.024, 0.0021)} material={decalMaterial(edge, 0.5)} position={[0, 0, 0.00251]} />
    </group>
  );
}

function UsbB({ position }: { position: [number, number, number] }) {
  const shell = cachedGeometry('usb-b-shell', () => {
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
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0045, bevelEnabled: false });
    return g;
  });
  return (
    <group position={position}>
      <mesh geometry={shell} material={materials.metal('#c3c7cb', 0.3)} />
      <mesh geometry={plane(0.0104, 0.0092)} material={materials.plastic('#050506', 0.8)} position={[0, 0, 0.0012]} />
      <mesh geometry={box(0.0066, 0.0036, 0.0024)} material={materials.plastic('#e8e8e2', 0.5)} position={[0, 0.0003, 0.0024]} />
    </group>
  );
}

/** Short blue patch cable with an RJ45 plug + boot hanging down from a jack on the 45° chamfer. */
function PatchCable({ position }: { position: [number, number, number] }) {
  const cable = cachedGeometry('patch-cable', () => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.0141, 0.0141),
      new THREE.Vector3(0, -0.026, 0.021),
      new THREE.Vector3(0, -0.05, 0.026),
      new THREE.Vector3(0, -0.11, 0.027),
    ]);
    return new THREE.TubeGeometry(curve, 20, 0.0028, 10, false);
  });
  const bootMat = materials.plastic('#2f7fd8', 0.5);
  const plugMat = cachedMaterial(
    'rj45-plug-clear',
    () => new THREE.MeshStandardMaterial({ color: '#9fb3c4', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.45 }),
  );
  return (
    <group position={position}>
      <group rotation={[Math.PI / 4, 0, 0]}>
        <mesh geometry={box(0.0114, 0.0078, 0.009)} material={plugMat} position={[0, 0.0003, 0.0035]} />
        <mesh geometry={roundedBox(0.0122, 0.0098, 0.011, 0.0028)} material={bootMat} position={[0, 0.0003, 0.013]} castShadow />
      </group>
      <mesh geometry={cable} material={bootMat} castShadow />
    </group>
  );
}

export const CONTROLLER_5380_WIDTH = W;
