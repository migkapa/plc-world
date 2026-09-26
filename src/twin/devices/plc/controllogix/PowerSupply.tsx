/**
 * <PowerSupply1756/> — ControlLogix standard power supplies 1756-PA72 (85-265V AC), 1756-PB72 (18-32V DC)
 * and 1756-PA75 (85-265V AC, 13 A), 140 x 112 x 145 mm, installed on the LEFT end of the 1756 chassis.
 *
 * Front: top vent grille, catalog/spec label with the green POWER indicator, two captive mounting
 * screws and a hinged terminal cover (flips up) over the L1 / L2-N / GND (or + / - / GND) terminals.
 *
 * Origin: back-bottom-center, front = +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../../contracts';
import { MOD_H, PS_FRONT_Z, PS_W, type PowerSupplyCatalog } from './dims';
import {
  Art,
  ArtPlane,
  FONT,
  FONT_COND,
  MAT,
  Screws,
  Selectable,
  StatusLed,
  cachedGeo,
  canvasTexture,
  merge,
  paint,
  rboxAt,
  texMaterial,
  type StatusLedState,
} from './shared';

export interface PowerSupply1756Props extends Placement {
  catalog?: PowerSupplyCatalog;
  /** Mains present (POWER LED). Default true. */
  getPowered?: () => boolean;
  /** Open the terminal cover. */
  doorOpen?: boolean;
  /** Show the mains wiring below the supply even when the cover is closed. */
  wired?: boolean;
  onSelect?: () => void;
  highlighted?: boolean;
}

const W = PS_W - 0.001;
const FACE = PS_FRONT_Z;
const LOWER_Y = 0.062; // top of the terminal compartment
const RECESS = 0.016;
const DOOR_W = 0.097;
const DOOR_H = 0.05;
const DOOR_T = 0.0018;
const DOOR_OPEN = -1.72;
const TB_Y = 0.036;
const TERM_X = [-0.026, 0, 0.026];

const SPECS: Record<PowerSupplyCatalog, { series: string; input: string[]; output: string[]; terms: [string, string, string]; wires: [string, string, string] }> = {
  '1756-PA72': {
    series: 'SERIES C',
    input: ['INPUT  85-265V AC  47-63 Hz', '100 VA  MAX'],
    output: ['OUTPUT  5.1V DC 10 A  ·  3.3V DC 4 A', '24V DC 2.8 A  ·  75 W TOTAL'],
    terms: ['L1', 'L2/N', 'GND'],
    wires: ['#141414', '#e8e8e2', '#2e9e4a'],
  },
  '1756-PA75': {
    series: 'SERIES B',
    input: ['INPUT  85-265V AC  47-63 Hz', '240 VA  MAX'],
    output: ['OUTPUT  5.1V DC 13 A  ·  3.3V DC 4 A', '24V DC 2.8 A  ·  75 W TOTAL'],
    terms: ['L1', 'L2/N', 'GND'],
    wires: ['#141414', '#e8e8e2', '#2e9e4a'],
  },
  '1756-PB72': {
    series: 'SERIES C',
    input: ['INPUT  18-32V DC', '95 W  MAX'],
    output: ['OUTPUT  5.1V DC 10 A  ·  3.3V DC 4 A', '24V DC 2.8 A  ·  75 W TOTAL'],
    terms: ['+', '−', 'GND'],
    wires: ['#c62828', '#1f4fd1', '#2e9e4a'],
  },
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Vent grille: 3 rows x 13 rounded slots, kept inside x = ±0.040 so the captive screws sit clear of it. */
const GRILLE = { x0: -0.0425, x1: 0.0425, y0: 0.1198, y1: 0.137, t: 0.0009, slotW: 0.005, slotH: 0.0026, cols: 13, rows: [0.1336, 0.1284, 0.1232] } as const;
const GRILLE_XS = Array.from({ length: GRILLE.cols }, (_, k) => -0.040 + GRILLE.slotW / 2 + (k * (0.08 - GRILLE.slotW)) / (GRILLE.cols - 1));

/** Molded grille plate with real rounded-slot cut-outs (the dark art behind shows through the slots). */
function grilleGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(GRILLE.x0, GRILLE.y0);
  s.lineTo(GRILLE.x1, GRILLE.y0);
  s.lineTo(GRILLE.x1, GRILLE.y1);
  s.lineTo(GRILLE.x0, GRILLE.y1);
  s.closePath();
  const r = GRILLE.slotH / 2;
  for (const cy of GRILLE.rows)
    for (const cx of GRILLE_XS) {
      const p = new THREE.Path();
      const xa = cx - GRILLE.slotW / 2 + r;
      const xb = cx + GRILLE.slotW / 2 - r;
      p.moveTo(xa, cy + r);
      p.lineTo(xb, cy + r);
      p.absarc(xb, cy, r, Math.PI / 2, -Math.PI / 2, true);
      p.lineTo(xa, cy - r);
      p.absarc(xa, cy, r, -Math.PI / 2, Math.PI / 2, true);
      s.holes.push(p);
    }
  return new THREE.ExtrudeGeometry(s, { depth: GRILLE.t + 0.0001, bevelEnabled: false, curveSegments: 5 }).translate(0, 0, FACE - 0.0001);
}

function bodyGeometry() {
  return cachedGeo('clx:ps:body:v2', () => {
    const lowerD = FACE - RECESS;
    return merge([
      grilleGeometry(),
      // upper full-depth body
      rboxAt(W, MOD_H - LOWER_Y, FACE, 0, (MOD_H + LOWER_Y) / 2, FACE / 2, 0.0015),
      // lower (recessed) body
      rboxAt(W, LOWER_Y + 0.001, lowerD, 0, LOWER_Y / 2, lowerD / 2, 0.0015),
      // compartment frame: side walls and the split bottom wall (cable entry in the middle)
      rboxAt(0.0062, LOWER_Y, RECESS + 0.002, -W / 2 + 0.0031, LOWER_Y / 2, FACE - (RECESS + 0.002) / 2, 0.0008),
      rboxAt(0.0062, LOWER_Y, RECESS + 0.002, W / 2 - 0.0031, LOWER_Y / 2, FACE - (RECESS + 0.002) / 2, 0.0008),
      rboxAt(0.03, 0.0085, RECESS - 0.001, -W / 2 + 0.015, 0.00425, FACE - 0.0015 - (RECESS - 0.001) / 2, 0.0008),
      rboxAt(0.03, 0.0085, RECESS - 0.001, W / 2 - 0.015, 0.00425, FACE - 0.0015 - (RECESS - 0.001) / 2, 0.0008),
      // terminal block & barriers (inside the compartment)
      rboxAt(0.082, 0.034, 0.008, 0, TB_Y, FACE - RECESS + 0.004, 0.0008),
      ...[-0.013, 0.013, -0.039, 0.039].map((x) => rboxAt(0.0022, 0.03, 0.009, x, TB_Y, FACE - RECESS + 0.0085, 0.0005)),
    ]);
  });
}

const DOOR_RIB_YS = Array.from({ length: 4 }, (_, i) => -DOOR_H + 0.0042 + i * 0.0019);

function doorGeometry() {
  return cachedGeo('clx:ps:door:v2', () =>
    merge([
      rboxAt(DOOR_W, DOOR_H, DOOR_T, 0, -DOOR_H / 2, 0, 0.0008),
      ...DOOR_RIB_YS.map((y) => rboxAt(0.05, 0.0007, 0.0007, 0, y, DOOR_T / 2 + 0.00025, 0.00025)),
      rboxAt(0.022, 0.0022, 0.0018, 0, -DOOR_H + 0.0012, DOOR_T / 2 + 0.0006, 0.0007), // finger lip
      new THREE.CylinderGeometry(0.0013, 0.0013, 0.012, 10).rotateZ(Math.PI / 2).translate(-DOOR_W / 2 + 0.008, 0, -0.0004),
      new THREE.CylinderGeometry(0.0013, 0.0013, 0.012, 10).rotateZ(Math.PI / 2).translate(DOOR_W / 2 - 0.008, 0, -0.0004),
    ]),
  );
}

function wiringGeometry(catalog: PowerSupplyCatalog) {
  return cachedGeo(`clx:ps:wires:${catalog}`, () => {
    const colors = SPECS[catalog].wires;
    const parts: THREE.BufferGeometry[] = [];
    const z0 = FACE - RECESS + 0.0095;
    TERM_X.forEach((x, i) => {
      const pts = [
        new THREE.Vector3(x, TB_Y + 0.0006, z0 - 0.0006),
        new THREE.Vector3(x, TB_Y - 0.008, z0 + 0.0025),
        new THREE.Vector3(x * 0.5, 0.012, z0 + 0.004),
        new THREE.Vector3((i - 1) * 0.0032, -0.004, z0 + 0.001),
        new THREE.Vector3((i - 1) * 0.0028, -0.03, z0 - 0.002),
      ];
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      parts.push(paint(new THREE.TubeGeometry(curve, 36, 0.0016, 8, false), colors[i]!));
      // green/yellow stripe for the protective earth
      if (i === 2) parts.push(paint(new THREE.TubeGeometry(curve, 36, 0.0007, 6, false), '#e5c21a').translate(0, 0, 0.0011));
      // ring lug under the screw
      parts.push(paint(new THREE.TorusGeometry(0.0032, 0.0009, 6, 16).translate(x, TB_Y + 0.004, FACE - RECESS + 0.0086), '#d6c79a'));
    });
    // gray mains cable jacket
    parts.push(paint(new THREE.CylinderGeometry(0.0055, 0.0055, 0.07, 16).translate(0, -0.06, z0 - 0.002), '#8d9196'));
    return merge(parts, true);
  });
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

const ART_X0 = -W / 2 + 0.0008;
const ART_X1 = W / 2 - 0.0008;
const ART_Y0 = LOWER_Y + 0.0005;
const ART_Y1 = MOD_H - 0.0006;
const LED_POS: [number, number, number] = [0.0405, 0.1036, FACE + 0.0004];

function frontTexture(catalog: PowerSupplyCatalog) {
  const spec = SPECS[catalog];
  return canvasTexture(`clx:ps:front:v2:${catalog}`, 768, Math.round((768 * (ART_Y1 - ART_Y0)) / (ART_X1 - ART_X0)), (ctx, w, h) => {
    const a = new Art(ctx, ART_X0, ART_X1, ART_Y0, ART_Y1, w, h);
    a.plastic('#1e1f22', 8);
    // dark interior seen through the grille cut-outs (the slotted plate itself is geometry)
    for (const y of GRILLE.rows)
      for (const x of GRILLE_XS) {
        a.rect(x, y, GRILLE.slotW + 0.0006, GRILLE.slotH + 0.0006, '#08090a', undefined, 0, 0.0016);
        a.rect(x, y - 0.0004, GRILLE.slotW - 0.001, GRILLE.slotH * 0.35, 'rgba(70,74,80,0.35)', undefined, 0, 0.0005); // fan/PCB glint
      }
    // label panel
    a.rect(0, 0.0915, 0.101, 0.0385, '#27282c', 'rgba(255,255,255,0.10)', 0.0003, 0.0014);
    a.text('ControlLogix', -0.0468, 0.1072, 0.0026, { align: 'left', weight: 600, color: '#b5b6b0' });
    a.text('POWER SUPPLY', -0.0468, 0.1036, 0.0032, { align: 'left', weight: 800, color: '#eeeee8' });
    a.text(catalog, -0.0468, 0.0978, 0.0056, { align: 'left', weight: 800, color: '#ffffff', font: FONT });
    a.text(spec.series, 0.0468, 0.0978, 0.0026, { align: 'right', weight: 700, color: '#c9c9c3' });
    a.line(-0.0468, 0.0936, 0.0468, 0.0936, 'rgba(255,255,255,0.18)', 0.0002);
    const small = { align: 'left' as CanvasTextAlign, weight: 600, color: '#c6c7c1', font: FONT_COND };
    a.text(spec.input[0]!, -0.0468, 0.0905, 0.0024, small);
    a.text(spec.input[1]!, 0.0468, 0.0905, 0.0024, { ...small, align: 'right' });
    a.text(spec.output[0]!, -0.0468, 0.0870, 0.0024, small);
    a.text(spec.output[1]!, -0.0468, 0.0838, 0.0024, small);
    a.text('Use 75 °C copper wire only. Tighten terminals to 0.8 N·m.', -0.0468, 0.0788, 0.0019, { ...small, color: '#9d9e98' });
    // POWER indicator legend
    a.text('POWER', LED_POS[0], LED_POS[1] + 0.0036, 0.0022, { weight: 800, color: '#dcdcd6', font: FONT_COND });
    a.rect(LED_POS[0], LED_POS[1], 0.0052, 0.0036, '#050505', undefined, 0, 0.0012);
    // warning strip
    a.rect(0, 0.0667, 0.101, 0.0058, '#26272a');
    a.text('WARNING: Do not remove or insert under power in hazardous locations.', 0, 0.0667, 0.0019, {
      weight: 600,
      color: '#a2a39d',
      font: FONT_COND,
    });
  });
}

function doorTexture(catalog: PowerSupplyCatalog) {
  const spec = SPECS[catalog];
  return canvasTexture(`clx:ps:door:v2:${catalog}`, 512, Math.round((512 * DOOR_H) / DOOR_W), (ctx, w, h) => {
    const a = new Art(ctx, -DOOR_W / 2, DOOR_W / 2, -DOOR_H, 0, w, h);
    a.plastic('#1c1d20', 8);
    a.rect(0, -DOOR_H / 2, DOOR_W - 0.002, DOOR_H - 0.002, undefined, 'rgba(255,255,255,0.07)', 0.0003, 0.0012);
    const c = a.ctx;
    const tx = -0.034;
    const ty = -0.016;
    const dc = catalog === '1756-PB72';
    // warning triangle: electrical hazard (AC mains) or general caution (DC input)
    c.fillStyle = '#f5c400';
    c.beginPath();
    c.moveTo(a.px(tx), a.py(ty + 0.0075));
    c.lineTo(a.px(tx + 0.0085), a.py(ty - 0.0072));
    c.lineTo(a.px(tx - 0.0085), a.py(ty - 0.0072));
    c.closePath();
    c.fill();
    c.fillStyle = '#111';
    if (dc) {
      c.fillRect(a.px(tx - 0.0008), a.py(ty + 0.0035), a.m(0.0016), a.m(0.0068));
      c.beginPath();
      c.arc(a.px(tx), a.py(ty - 0.0052), a.m(0.001), 0, Math.PI * 2);
      c.fill();
    } else {
      c.beginPath();
      c.moveTo(a.px(tx + 0.0012), a.py(ty + 0.004));
      c.lineTo(a.px(tx - 0.0022), a.py(ty - 0.0012));
      c.lineTo(a.px(tx + 0.0004), a.py(ty - 0.0012));
      c.lineTo(a.px(tx - 0.0014), a.py(ty - 0.0058));
      c.lineTo(a.px(tx + 0.0024), a.py(ty + 0.0002));
      c.lineTo(a.px(tx - 0.0002), a.py(ty + 0.0002));
      c.closePath();
      c.fill();
    }
    const txt = { align: 'left' as CanvasTextAlign, weight: 800, color: '#e6e6e0', font: FONT_COND };
    if (dc) {
      a.text('CAUTION', -0.023, -0.0115, 0.0036, txt);
      a.text('18-32V DC INPUT', -0.023, -0.0162, 0.0029, { ...txt, weight: 700 });
      a.text('Observe polarity. Remove power before wiring.', -0.023, -0.0205, 0.0024, { ...txt, weight: 500, color: '#b9bab4', maxWidth: 0.068 });
    } else {
      a.text('WARNING', -0.023, -0.0115, 0.0036, txt);
      a.text('HAZARDOUS VOLTAGE', -0.023, -0.0162, 0.0029, { ...txt, weight: 700 });
      a.text('Disconnect power before opening.', -0.023, -0.0205, 0.0024, { ...txt, weight: 500, color: '#b9bab4' });
    }
    // terminal legend aligned with the terminals below
    TERM_X.forEach((x, i) => a.text(spec.terms[i]!, x, -0.034, 0.0034, { weight: 800, color: '#e6e6e0' }));
    TERM_X.forEach((x) => a.rect(x, -0.0385, 0.0012, 0.003, '#c9c9c3'));
    // shadow lines under the molded grip ribs (the ribs are geometry)
    for (const y of DOOR_RIB_YS) a.rect(0, y - 0.0005, 0.05, 0.0004, 'rgba(0,0,0,0.4)');
  });
}

function terminalLabelTexture(catalog: PowerSupplyCatalog) {
  const spec = SPECS[catalog];
  return canvasTexture(`clx:ps:tb:${catalog}`, 512, 212, (ctx, w, h) => {
    const a = new Art(ctx, -0.041, 0.041, -0.017, 0.017, w, h);
    a.plastic('#2a2b2f', 4);
    TERM_X.forEach((x, i) => {
      a.rect(x, 0.004, 0.0105, 0.0105, '#141517', undefined, 0, 0.001);
      a.text(spec.terms[i]!, x, -0.0105, 0.0042, { weight: 800, color: '#f0f0ea' });
    });
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PowerSupply1756({
  catalog = '1756-PA72',
  getPowered,
  doorOpen = false,
  wired = false,
  onSelect,
  highlighted,
  position,
  rotation,
  scale,
}: PowerSupply1756Props) {
  const front = frontTexture(catalog);
  const doorTex = doorTexture(catalog);
  const tbTex = terminalLabelTexture(catalog);
  const doorPlane = cachedGeo('plane:psdoor', () => new THREE.PlaneGeometry(DOOR_W - 0.0004, DOOR_H - 0.0004));
  const tbPlane = cachedGeo('plane:pstb', () => new THREE.PlaneGeometry(0.082, 0.034));
  const ledState = useCallback((): StatusLedState => ((getPowered ?? (() => true))() ? 'green' : 'off'), [getPowered]);

  const [showWires, setShowWires] = useState(doorOpen || wired);
  useEffect(() => {
    if (doorOpen || wired) setShowWires(true);
  }, [doorOpen, wired]);

  const doorRef = useRef<THREE.Group>(null);
  const angle = useRef(doorOpen ? DOOR_OPEN : 0);
  useFrame((_, dt) => {
    const g = doorRef.current;
    if (!g) return;
    const target = doorOpen ? DOOR_OPEN : 0;
    if (Math.abs(target - angle.current) < 1e-4) return;
    angle.current += (target - angle.current) * Math.min(1, dt * 7);
    g.rotation.x = angle.current;
  });

  const screwPts: Array<[number, number, number]> = [
    [-0.0488, 0.1345, FACE],
    [0.0488, 0.1345, FACE],
  ];
  const tbScrews: Array<[number, number, number]> = TERM_X.map((x) => [x, TB_Y + 0.004, FACE - RECESS + 0.0092]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={[W + 0.002, MOD_H + 0.002, 0.02]} center={[0, MOD_H / 2, FACE - 0.009]} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={bodyGeometry()} material={MAT.body()} castShadow />
        <ArtPlane tex={front} x0={ART_X0} x1={ART_X1} y0={ART_Y0} y1={ART_Y1} z={FACE + 0.0001} />
        <StatusLed get={ledState} position={LED_POS} size={[0.0046, 0.003, 0.0008]} />
        <Screws points={screwPts} radius={0.0031} />
        {/* terminal compartment */}
        <mesh geometry={tbPlane} material={texMaterial(tbTex)} position={[0, TB_Y, FACE - RECESS + 0.0081]} />
        <Screws points={tbScrews} radius={0.0029} />
        {showWires && <mesh geometry={wiringGeometry(catalog)} material={MAT.vertexColoredGloss()} />}
        {/* hinged terminal cover (pivot at its top edge) */}
        <group ref={doorRef} position={[0, LOWER_Y - 0.0015, FACE - DOOR_T / 2 + 0.0004]} rotation-x={angle.current}>
          <mesh geometry={doorGeometry()} material={MAT.body()} castShadow />
          <mesh geometry={doorPlane} material={texMaterial(doorTex)} position={[0, -DOOR_H / 2, DOOR_T / 2 + 0.0001]} />
        </group>
      </Selectable>
    </group>
  );
}

