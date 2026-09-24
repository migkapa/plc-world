/**
 * Compact 5000 I/O module (5069-IB16 / -OB16 / -IF8 / -OF4) digital twin.
 *
 * Real proportions (5069-TD001): 144.57 × 22 × 105.42 mm (H × W × D). Dark housing with an indicator
 * "head" at the top (module status + point status indicators with numbers, catalog label, color band)
 * and an 18-pin removable terminal block (5069-RTB18-SCREW) below it with a release latch.
 *
 * Origin: center of the back mounting face at the bottom edge (front = +Z).
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { COLORS, Led, materials, type LedColor, type LedMode } from '../../../common';
import type { Placement } from '../../../contracts';
import { barcode, canvasTexture, CONDENSED, grain, mmCtx } from './canvas';
import { cachedGeometry, plane, profileGeometry, roundedBox, screwHeadGeometry } from './geometry';
import { decalMaterial, HighlightFrame, PointLeds, StaticInstances, usePick, vertexColorMetal } from './parts';

export type Module5069Catalog = '5069-IB16' | '5069-OB16' | '5069-IF8' | '5069-OF4';

export const M5069 = {
  width: 0.022,
  height: 0.14457,
  depth: 0.10542,
  /** Housing front (behind the RTB). */
  bodyFront: 0.0795,
  /** Indicator head (top) front face. */
  headBottom: 0.1062,
  rtbBottom: 0.0045,
  rtbTop: 0.1032,
  rtbFront: 0.1038,
} as const;

interface CatalogStyle {
  kind: 'DI' | 'DO' | 'AI' | 'AO';
  points: number;
  title: string;
  sub: string;
  band: string;
  terminals: string[];
}

const DIG_TERMS = Array.from({ length: 16 }, (_, i) => String(i)).concat(['COM', 'COM']);

const STYLES: Record<Module5069Catalog, CatalogStyle> = {
  '5069-IB16': { kind: 'DI', points: 16, title: 'IB16', sub: '24V DC SINK IN', band: '#2f6fd6', terminals: DIG_TERMS },
  '5069-OB16': { kind: 'DO', points: 16, title: 'OB16', sub: '24V DC SRC OUT', band: '#2f6fd6', terminals: DIG_TERMS.slice(0, 16).concat(['SA-', 'SA-']) },
  '5069-IF8': {
    kind: 'AI',
    points: 8,
    title: 'IF8',
    sub: 'ANALOG IN 8',
    band: '#2e9e4f',
    terminals: Array.from({ length: 8 }, (_, i) => [`I${i}+`, `I${i}-`]).flat().concat(['RTN', 'SHLD']),
  },
  '5069-OF4': {
    kind: 'AO',
    points: 4,
    title: 'OF4',
    sub: 'ANALOG OUT 4',
    band: '#2e9e4f',
    terminals: Array.from({ length: 4 }, (_, i) => [`V${i}+`, `I${i}+`, `RT${i}`, `-`]).flat().concat(['SA+', 'SA-']),
  },
};

export const catalogInfo5069 = (c: Module5069Catalog) => STYLES[c];

// ---------------------------------------------------------------------------
// Geometry (shared by every module instance)
// ---------------------------------------------------------------------------

const W = M5069.width;
const H = M5069.height;
const D = M5069.depth;

/** Housing side profile (z, y): body + indicator head at the top. */
const HOUSING_PROFILE: Array<[number, number]> = [
  [0, 0.002],
  [0.002, 0],
  [M5069.bodyFront, 0],
  [M5069.bodyFront, M5069.rtbTop + 0.0005],
  [D - 0.004, M5069.rtbTop + 0.0005],
  [D - 0.0005, M5069.headBottom],
  [D, M5069.headBottom + 0.001],
  [D, H - 0.0055],
  [D - 0.005, H],
  [0.004, H],
  [0, H - 0.003],
];

export function housingGeometry(width = W) {
  return profileGeometry('5069-housing', HOUSING_PROFILE, width, 0.0005);
}

const RTB_H = M5069.rtbTop - M5069.rtbBottom;
const RTB_D = M5069.rtbFront - M5069.bodyFront;
const HEAD_H = H - 0.0055 - M5069.headBottom - 0.001;

/** RTB terminal layout: 2 columns × 9 rows, terminal n → (col = n % 2, row = floor(n / 2) from the top). */
export function rtbTerminal(n: number): { u: number; v: number } {
  const col = n % 2;
  const row = Math.floor(n / 2);
  const pitch = RTB_H / 9;
  return { u: col === 0 ? -0.005 : 0.005, v: M5069.rtbTop - pitch * (row + 0.5) };
}

// ---------------------------------------------------------------------------
// Decals
// ---------------------------------------------------------------------------

const PX = 22; // px per mm for small print

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

function headTexture(catalog: Module5069Catalog) {
  const st = STYLES[catalog];
  const wMm = W * 1000;
  const hMm = HEAD_H * 1000;
  return canvasTexture(`5069-head:${catalog}`, Math.round(wMm * PX), Math.round(hMm * PX), (ctx, w, h) => {
    const m = mmCtx(ctx, PX, hMm);
    ctx.fillStyle = '#16171a';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.03, 11);
    // color band + catalog
    m.rect(0.8, hMm - 2.2, wMm - 1.6, 1.3, st.band, 0.3);
    m.text('5069', 1.4, hMm - 4.1, 1.7, { color: '#c8cacd', weight: 600, font: CONDENSED });
    m.text(st.title, wMm - 1.3, hMm - 4.1, 2.3, { color: '#ffffff', weight: 800, align: 'right', font: CONDENSED });
    m.text(st.sub, wMm / 2, hMm - 6.5, 1.25, { color: '#b7babd', weight: 600, align: 'center', font: CONDENSED });
    // module status indicator label
    m.text('OK', 6.4, hMm - 8.9, 1.35, { color: '#e6e6e6', weight: 700, align: 'right' });
    // LED numbers
    for (const p of headLedLayout(st.points)) {
      const right = p.u > wMm / 2;
      m.text(String(p.n), right ? p.u + 2.2 : p.u - 2.2, p.v, 1.35, {
        color: '#e8e8e8',
        weight: 700,
        align: right ? 'left' : 'right',
      });
      m.rect(p.u - 1.25, p.v - 0.8, 2.5, 1.6, '#050505', 0.2);
    }
    m.rect(8.6 - 1.25, hMm - 8.9 - 0.8, 2.5, 1.6, '#050505', 0.2);
  });
}

function rtbTexture(catalog: Module5069Catalog) {
  const st = STYLES[catalog];
  const wMm = W * 1000 - 1.4;
  const hMm = RTB_H * 1000;
  return canvasTexture(`5069-rtb:${catalog}`, Math.round(wMm * PX), Math.round(hMm * PX), (ctx, w, h) => {
    const m = mmCtx(ctx, PX, hMm);
    ctx.fillStyle = '#1c1d20';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.035, 5);
    const pitch = hMm / 9;
    for (let n = 0; n < 18; n++) {
      const t = rtbTerminal(n);
      const cu = t.u * 1000 + wMm / 2;
      const cv = (t.v - M5069.rtbBottom) * 1000;
      // screw well
      m.circle(cu, cv + 1.9, 2.05, '#07080a');
      m.circle(cu, cv + 1.9, 1.75, '#0f1012');
      // wire entry (square funnel)
      m.rect(cu - 1.75, cv - 3.9, 3.5, 3.3, '#050506', 0.5);
      m.strokeRect(cu - 1.75, cv - 3.9, 3.5, 3.3, '#2c2e32', 0.25, 0.5);
      // terminal legend
      const label = st.terminals[n] ?? String(n);
      m.text(label, n % 2 === 0 ? 0.35 : wMm - 0.35, cv - 2.6, label.length > 2 ? 0.95 : 1.25, {
        color: '#d9d9d9',
        weight: 700,
        align: n % 2 === 0 ? 'left' : 'right',
        font: CONDENSED,
      });
      if (n % 2 === 0 && n < 16) m.line(0.6, cv - pitch / 2, wMm - 0.6, cv - pitch / 2, '#2a2c30', 0.18);
    }
  });
}

function ventTexture(wMm: number, dMm: number) {
  return canvasTexture(`vents:${wMm}:${dMm}`, Math.round(wMm * 12), Math.round(dMm * 12), (ctx, w, h) => {
    ctx.fillStyle = '#26282c';
    ctx.fillRect(0, 0, w, h);
    const m = mmCtx(ctx, 12, dMm);
    const n = Math.floor((dMm - 8) / 4.2);
    for (let i = 0; i < n; i++) {
      const v = 5 + i * 4.2;
      m.rect(2.2, v, wMm - 4.4, 1.9, '#060607', 0.9);
    }
  });
}

export function VentDecal({ width, depth, y, z0 }: { width: number; depth: number; y: number; z0: number }) {
  const tex = ventTexture(Math.round(width * 1000), Math.round(depth * 1000));
  return (
    <mesh geometry={plane(width, depth)} material={decalMaterial(tex, 0.7)} position={[0, y + 0.0002, z0 + depth / 2]} rotation={[-Math.PI / 2, 0, 0]} />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface Module5069Props extends Placement {
  catalog: Module5069Catalog;
  /** Digital point state (DI: input image, DO: output driven to field). */
  getPoint?: (index: number) => boolean;
  /** Analog channel value (engineering units); NaN = channel fault (red LED). */
  getChannel?: (ch: number) => number;
  /** Module status indicator (green unless getModuleStatusColor says otherwise). Default: steady green. */
  getModuleStatus?: () => LedMode;
  getModuleStatusColor?: () => LedColor;
  /** Show field wiring in the RTB. */
  wired?: boolean;
  /** Field wire insulation color. */
  wireColor?: string;
  /** Print the product label on the right side (hidden inside a rack, so off there). Default true. */
  sideLabel?: boolean;
  highlighted?: boolean;
  onSelect?: () => void;
}

const zero = () => false;

export function Module5069({
  catalog,
  getPoint = zero,
  getChannel,
  getModuleStatus = () => 'on',
  getModuleStatusColor = () => 'green',
  wired = false,
  wireColor = COLORS.wireBlue,
  sideLabel = true,
  highlighted = false,
  onSelect,
  position,
  rotation,
  scale,
}: Module5069Props) {
  const st = STYLES[catalog];
  const { hovered, handlers } = usePick(onSelect);

  const headZ = D + 0.0002;
  const headY0 = M5069.headBottom + 0.001;
  const ledPositions = useMemo<Array<[number, number, number]>>(
    () => headLedLayout(st.points).map((p) => [p.u / 1000 - W / 2, headY0 + p.v / 1000, headZ + 0.0003]),
    [st.points, headY0, headZ],
  );
  const screwPositions = useMemo<Array<[number, number, number]>>(
    () =>
      Array.from({ length: 18 }, (_, n) => {
        const t = rtbTerminal(n);
        return [t.u, t.v + 0.0019, M5069.rtbFront + 0.00035];
      }),
    [],
  );
  const wirePositions = useMemo<Array<[number, number, number]>>(
    () =>
      Array.from({ length: 18 }, (_, n) => {
        const t = rtbTerminal(n);
        return [t.u, t.v - 0.00225, M5069.rtbFront - 0.002];
      }),
    [],
  );

  const analog = st.kind === 'AI' || st.kind === 'AO';
  const getLed = useMemo(
    () =>
      analog
        ? (i: number): LedMode => {
            const v = getChannel ? getChannel(i) : 0;
            return Number.isFinite(v) ? 'on' : 'flash';
          }
        : (i: number): LedMode => getPoint(i),
    [analog, getChannel, getPoint],
  );
  const ledColor = useMemo(
    () =>
      analog
        ? (i: number): LedColor => {
            const v = getChannel ? getChannel(i) : 0;
            return Number.isFinite(v) ? 'green' : 'red';
          }
        : ('yellow' as LedColor),
    [analog, getChannel],
  );

  const housingMat = materials.plastic(COLORS.moduleCharcoal, 0.62);
  const rtbMat = materials.plastic('#1c1d20', 0.7);
  const latchMat = materials.plastic('#3a3d42', 0.5);

  return (
    <group position={position} rotation={rotation} scale={scale} {...handlers}>
      <mesh geometry={housingGeometry()} material={housingMat} castShadow receiveShadow />
      {/* indicator head face */}
      <mesh
        geometry={plane(W - 0.0012, HEAD_H)}
        material={decalMaterial(headTexture(catalog), 0.35, 0.05)}
        position={[0, headY0 + HEAD_H / 2, headZ]}
      />
      <Led
        color="green"
        get={getModuleStatus}
        getColor={getModuleStatusColor}
        size={[0.0025, 0.0016, 0.0006]}
        position={[0.0086 - W / 2, headY0 + HEAD_H - 0.0089, headZ + 0.0003]}
      />
      <PointLeds positions={ledPositions} size={[0.0025, 0.0016, 0.0008]} get={getLed} color={ledColor} />
      <VentDecal width={W - 0.003} depth={0.07} y={H} z0={0.012} />

      {/* removable terminal block */}
      <mesh
        geometry={roundedBox(W - 0.0012, RTB_H, RTB_D, 0.0008)}
        material={rtbMat}
        position={[0, M5069.rtbBottom + RTB_H / 2, M5069.bodyFront + RTB_D / 2]}
        castShadow
      />
      <mesh
        geometry={plane(W - 0.0014, RTB_H - 0.0016)}
        material={decalMaterial(rtbTexture(catalog), 0.72)}
        position={[0, M5069.rtbBottom + RTB_H / 2, M5069.rtbFront + 0.0002]}
      />
      <StaticInstances geometry={screwHeadGeometry(0.00135, 0.001, 'combo')} material={vertexColorMetal()} positions={screwPositions} />
      {/* RTB release latch at the top */}
      <mesh geometry={latchGeometry()} material={latchMat} position={[0, M5069.rtbTop - 0.0012, M5069.rtbFront - 0.001]} castShadow />
      {sideLabel && (
        <mesh
          geometry={plane(0.06, 0.05)}
          material={decalMaterial(sideLabelTexture(catalog), 0.55)}
          position={[W / 2 + 0.0002, 0.062, 0.042]}
          rotation={[0, Math.PI / 2, 0]}
        />
      )}
      {wired && <StaticInstances geometry={wireGeometry()} material={wireMaterial(wireColor)} positions={wirePositions} castShadow />}

      {(highlighted || hovered) && (
        <HighlightFrame center={[0, H / 2, D / 2 + 0.001]} size={[W + 0.0015, H + 0.002, D + 0.004]} strength={highlighted ? 1 : 0.35} />
      )}
    </group>
  );
}

function sideLabelTexture(catalog: Module5069Catalog) {
  const st = STYLES[catalog];
  return canvasTexture(`5069-side:${catalog}`, 600, 500, (ctx, w, h) => {
    const m = mmCtx(ctx, 10, 50);
    ctx.fillStyle = '#d9dbdc';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 14);
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
  });
}

function latchGeometry() {
  return cachedGeometry('5069-latch', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.004, 0);
    s.lineTo(0.0046, 0.0022);
    s.lineTo(0.0005, 0.0026);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.0003, bevelThickness: 0.0003, bevelSegments: 1 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.006, -0.0012, 0);
    g.computeVertexNormals();
    return g;
  });
}

function wireGeometry() {
  return cachedGeometry('5069-wire', () => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -0.0015, 0.008),
      new THREE.Vector3(0, -0.009, 0.016),
      new THREE.Vector3(0, -0.03, 0.02),
      new THREE.Vector3(0, -0.06, 0.021),
    ]);
    return new THREE.TubeGeometry(curve, 24, 0.0011, 8, false);
  });
}

function wireMaterial(color: string) {
  return materials.plastic(color, 0.45);
}

export const MODULE_5069_WIDTH = W;
