/**
 * Bulletin 193 E100 electronic overload relay (current line; default 193-1EEDB Basic, 3.2–16 A,
 * for 100-C09…C23), plugging directly under a 100-C contactor: rotary FLA (trip current) dial with
 * printed scale, rotary TRIP CLASS selector (Basic 10/20; Advanced 193-1EF: 10/15/20/30 plus a
 * manual/auto reset-mode selector), blue TRIP/RESET button that pops out when tripped, push-to-TEST
 * button, trip indicator window (orange flag when tripped), output terminals 2/T1 4/T2 6/T3 and
 * auxiliary contacts 95-96 (N.C.) / 97-98 (N.O.).
 * The discontinued E1 Plus (193-EE…) is available as `variant="E1Plus"` (legacy print).
 *
 * Origin: top edge of the BACK face, centered (the point where it meets the contactor's bottom).
 * The relay hangs downward (−Y) from the origin.
 * Performance: body/terminals/dials = one merged mesh; front print (incl. trip flag) = one quad
 * whose material swaps; terminal markings = one quad pair; RESET = one mesh.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OverloadRelayProps } from '../../contracts';
import { F, LEGEND_FONT, NARROW_FONT, addScrew, boxGeo, canvasTexture, cylZ, damp, mats, partsGeo, planeGeo, roundedBox, sharedGeo, uberMat, useClick } from '../operator/shared';
import { CONTACTOR_GRAY } from './Contactor100C';

export type OverloadVariant = 'E100' | 'E100-Advanced' | 'E1Plus';

export interface OverloadRelay193Props extends OverloadRelayProps {
  /** Click the TRIP/RESET button (drag-safe click). */
  onReset?: () => void;
  /** FLA dial setting in amps (visual), default 9. */
  fla?: number;
  /** FLA range printed on the dial [min, max], default [3.2, 16] (…DB range). */
  range?: [number, number];
  /** Product: 'E100' Basic (default, 193-1EE), 'E100-Advanced' (193-1EF), legacy 'E1Plus' (193-EE). */
  variant?: OverloadVariant;
  /** Trip class shown on the selector (default 10). */
  tripClass?: 10 | 15 | 20 | 30;
}

export const E193 = { w: 0.045, h: 0.068, d: 0.086, step: 0.058, front: 0.086 } as const;

const DEFAULT_CATALOG: Record<OverloadVariant, string> = { E100: '193-1EEDB', 'E100-Advanced': '193-1EFDB', E1Plus: '193-EEDB' };

function bodyGeo() {
  return sharedGeo('193e-body', () => {
    const H = E193.h;
    // (y, z) profile, y from 0 (top) down to -H
    const P: [number, number][] = [
      [0, 0],
      [0, E193.step - 0.002],
      [-0.002, E193.step],
      [-0.0105, E193.step],
      [-0.0125, E193.front - 0.004],
      [-0.015, E193.front],
      [-0.049, E193.front],
      [-0.0515, E193.front - 0.003],
      [-0.0515, E193.step + 0.004],
      [-0.0535, E193.step],
      [-H + 0.002, E193.step],
      [-H, E193.step - 0.002],
      [-H, 0],
    ];
    const s = new THREE.Shape();
    P.forEach(([y, z], i) => (i === 0 ? s.moveTo(y, z) : s.lineTo(y, z)));
    s.closePath();
    const w = E193.w - 0.0008;
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelOffset: -0.0004, bevelSegments: 1 });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -w / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    g.computeVertexNormals();
    return g;
  });
}

// front print layout (fractions of the print quad: x from left, y from top)
const FRONT = { w: E193.w - 0.002, h: 0.0326, cy: -0.032 } as const;
const LAY = {
  dial: [0.3, 0.44],
  flag: [0.78, 0.13],
  cls: [0.78, 0.38],
  mode: [0.3, 0.9],
  reset: [0.78, 0.66],
  test: [0.78, 0.9],
} as const;
const DIAL_R = 0.0066;

function frontTexture(catalog: string, range: [number, number], variant: OverloadVariant, tripped: boolean) {
  return canvasTexture(`193-front-v3:${catalog}:${range.join('-')}:${variant}:${tripped}`, 448, 340, (ctx, w, h) => {
    const pxX = w / FRONT.w;
    ctx.fillStyle = '#6f7378';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.strokeStyle = '#f2f2ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // FLA scale around the dial
    const cx = w * LAY.dial[0];
    const cy = h * LAY.dial[1];
    const r = (DIAL_R + 0.0012) * pxX;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();
    ctx.font = `600 17px ${NARROW_FONT}`;
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI * 0.75 + (Math.PI * 1.5 * i) / steps;
      const v = range[0] + ((range[1] - range[0]) * i) / steps;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * (r + 9), cy + Math.sin(a) * (r + 9));
      ctx.stroke();
      ctx.fillText(v.toFixed(v < 10 ? 1 : 0), cx + Math.cos(a) * (r + 24), cy + Math.sin(a) * (r + 20));
    }
    ctx.font = `700 18px ${LEGEND_FONT}`;
    ctx.fillText('A', cx, cy + r + 12);
    // trip indicator window
    const fx = w * LAY.flag[0];
    const fy = h * LAY.flag[1];
    ctx.fillStyle = '#1a1b1d';
    ctx.fillRect(fx - 26, fy - 13, 52, 26);
    ctx.fillStyle = tripped ? '#ff8a00' : '#2c2d30';
    ctx.fillRect(fx - 22, fy - 9, 44, 18);
    ctx.fillStyle = '#f2f2ee';
    ctx.font = `700 15px ${LEGEND_FONT}`;
    ctx.fillText('TRIP', fx - 48, fy);
    // trip class legend
    const kx = w * LAY.cls[0];
    const ky = h * LAY.cls[1];
    ctx.font = `600 15px ${NARROW_FONT}`;
    // (knob radius ≈ 3 mm ≈ 31 px: keep all legends outside it)
    if (variant === 'E100-Advanced') {
      ctx.fillText('10', kx - 40, ky - 26);
      ctx.fillText('15', kx + 40, ky - 26);
      ctx.fillText('20', kx - 40, ky + 26);
      ctx.fillText('30', kx + 40, ky + 26);
    } else if (variant === 'E100') {
      ctx.fillText('10', kx - 46, ky);
      ctx.fillText('20', kx + 46, ky);
    }
    if (variant !== 'E1Plus') {
      ctx.font = `700 12px ${LEGEND_FONT}`;
      ctx.fillText('CLASS', kx, ky - 42);
    }
    // reset mode (Advanced)
    if (variant === 'E100-Advanced') {
      const mx = w * LAY.mode[0];
      const my = h * LAY.mode[1];
      ctx.font = `700 15px ${LEGEND_FONT}`;
      ctx.fillText('M', mx - 40, my);
      ctx.fillText('A', mx + 40, my);
    }
    ctx.font = `700 13px ${LEGEND_FONT}`;
    ctx.fillText('TRIP/RESET', w * LAY.reset[0], h * LAY.reset[1] + 32);
    ctx.fillText('TEST', w * LAY.test[0] - 56, h * LAY.test[1]);
    // product + catalog
    ctx.font = `800 20px ${LEGEND_FONT}`;
    ctx.fillText(variant === 'E1Plus' ? 'E1 Plus' : 'E100', w * 0.3, 20);
    ctx.font = `700 16px ${LEGEND_FONT}`;
    if (variant !== 'E100-Advanced') ctx.fillText(catalog, w * 0.3, h - 14);
    else ctx.fillText(catalog, w * 0.78, 20 + 0 * h);
  });
}

function markingsTexture() {
  return canvasTexture('193-markings-atlas', 448, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 24px ${NARROW_FONT}`;
    ['95', '96', '97', '98'].forEach((t, i) => ctx.fillText(t, (0.14 + i * 0.24) * w, h * 0.25));
    ctx.font = `700 26px ${NARROW_FONT}`;
    ['2/T1', '4/T2', '6/T3'].forEach((t, i) => ctx.fillText(t, (0.23 + i * 0.27) * w, h * 0.75));
  });
}

/** Aux (upper step) + power (lower step) marking quads, UV-mapped into one atlas. */
function markingsGeo() {
  return sharedGeo('193-markings-geo', () => {
    const fw = FRONT.w;
    const a = new THREE.PlaneGeometry(fw, 0.0022);
    const b = new THREE.PlaneGeometry(fw, 0.0028);
    const remap = (g: THREE.PlaneGeometry, v0: number, v1: number) => {
      const uv = g.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setY(k, v0 + uv.getY(k) * (v1 - v0));
    };
    remap(a, 0.5, 1);
    remap(b, 0, 0.5);
    a.translate(0, -0.0094, E193.step + 0.0003);
    b.translate(0, -0.0551, E193.step + 0.0003);
    const g = mergeGeometries([a, b], false)!;
    a.dispose();
    b.dispose();
    return g;
  });
}

export function OverloadRelay193({
  getTripped,
  catalog,
  onReset,
  fla = 9,
  range = [3.2, 16],
  variant = 'E100',
  tripClass = 10,
  position,
  rotation,
  scale,
}: OverloadRelay193Props) {
  const reset = useRef<THREE.Group>(null);
  const print = useRef<THREE.Mesh>(null);
  const frame = useRef<THREE.Group>(null);
  const { handlers } = useClick(onReset ? () => onReset() : undefined, frame);
  const cat = catalog ?? DEFAULT_CATALOG[variant];
  const printOk = mats.label(frontTexture(cat, range, variant, false), false, 0.55);
  const printTrip = mats.label(frontTexture(cat, range, variant, true), false, 0.55);
  useFrame((_, dt) => {
    const t = getTripped();
    const r = reset.current;
    if (r) r.position.z = damp(r.position.z, t ? 0.0028 : 0, 25, Math.min(dt, 0.05));
    const p = print.current;
    const want = t ? printTrip : printOk;
    if (p && p.material !== want) p.material = want;
  });
  const fz = E193.front + 0.0002;
  const px = (fx: number) => -FRONT.w / 2 + FRONT.w * fx;
  const py = (fy: number) => FRONT.cy + FRONT.h / 2 - FRONT.h * fy;
  const dialA = Math.PI * 0.75 + (Math.PI * 1.5 * (fla - range[0])) / (range[1] - range[0]);
  const clsAngle = variant === 'E100-Advanced' ? { 10: 2.36, 15: 0.79, 20: -2.36, 30: -0.79 }[tripClass] : tripClass >= 20 ? -Math.PI / 2 : Math.PI / 2;
  const staticGeo = partsGeo(`193:${variant}:${fla}:${range.join('-')}:${tripClass}`, (b) => {
    const pad = F.matte('#3a3c3f', 0.7);
    b.add(bodyGeo(), F.matte(CONTACTOR_GRAY, 0.55));
    // plug-in pins into the contactor's T terminals
    for (const x of [-0.012, 0, 0.012]) b.add(boxGeo(0.0036, 0.009, 0.0012), F.metal('#c58b54', 0.35), [x, 0.003, E193.step - 0.008]);
    // FLA dial (light knob with pointer + grip bar), set to `fla`
    b.at([px(LAY.dial[0]), py(LAY.dial[1]), fz], [0, 0, -dialA - Math.PI / 2], (d) => {
      d.add(cylZ(DIAL_R - 0.0004, DIAL_R, 0.0026, 32), F.matte('#e8e8e3', 0.45), [0, 0, 0.0013]);
      d.add(boxGeo(0.0011, 0.0045, 0.0004), F.hole, [0, 0.0032, 0.0027]);
      d.add(boxGeo(0.006, 0.0012, 0.0012), F.matte('#b8b8b2', 0.5), [0, 0, 0.0029]);
    });
    // trip class rotary (and reset-mode rotary on Advanced)
    if (variant !== 'E1Plus')
      b.at([px(LAY.cls[0]), py(LAY.cls[1]), fz], [0, 0, clsAngle], (d) => {
        d.add(cylZ(0.0028, 0.003, 0.0014, 20), F.black, [0, 0, 0.0007]);
        d.add(boxGeo(0.0005, 0.0042, 0.0004), F.matte('#e8e8e2', 0.5), [0, 0, 0.0015]);
      });
    if (variant === 'E100-Advanced')
      b.at([px(LAY.mode[0]), py(LAY.mode[1]), fz], [0, 0, Math.PI / 2], (d) => {
        d.add(cylZ(0.0024, 0.0026, 0.0012, 20), F.black, [0, 0, 0.0006]);
        d.add(boxGeo(0.0005, 0.0036, 0.0004), F.matte('#e8e8e2', 0.5), [0, 0, 0.0013]);
      });
    // RESET surround + TEST button
    b.add(roundedBox(0.0118, 0.0082, 0.0006, 0.0015, 2), F.hole, [px(LAY.reset[0]), py(LAY.reset[1]), fz + 0.0002]);
    b.add(cylZ(0.0022, 0.0024, 0.0016, 16), F.matte('#d9d9d4', 0.45), [px(LAY.test[0]), py(LAY.test[1]), fz + 0.0008]);
    // output terminals on the lower step
    for (const x of [-0.012, 0, 0.012])
      b.at([x, -E193.h + 0.0075, E193.step], undefined, (t) => {
        t.add(boxGeo(0.0078, 0.0078, 0.0002), pad, [0, 0, 0.0001]);
        addScrew(t, [0, 0, 0.0001], 0.0031, 0.0014);
        t.add(boxGeo(0.0072, 0.0004, 0.0065), F.hole, [0, -0.0078, -0.012]);
      });
    // aux contact terminals on the upper step
    for (const x of [-0.0165, -0.0055, 0.0055, 0.0165])
      b.at([x, -0.0055, E193.step], undefined, (t) => {
        t.add(boxGeo(0.0054, 0.0054, 0.0002), pad, [0, 0, 0.0001]);
        addScrew(t, [0, 0, 0.0001], 0.0021, 0.0011);
      });
  });
  const resetGeo = partsGeo('193-reset-btn', (b) => {
    b.add(roundedBox(0.0098, 0.0064, 0.004, 0.0015, 2), F.gloss('#1e5bd6'), [0, 0, 0.0016]);
    b.add(boxGeo(0.0052, 0.0006, 0.0003), F.matte('#e8eefa', 0.5), [0, 0, 0.0037]);
  });
  return (
    <group position={position} rotation={rotation} scale={scale} ref={frame}>
      <mesh geometry={staticGeo} material={uberMat()} castShadow receiveShadow />
      {/* front print incl. the trip indicator flag (material swaps when tripped) */}
      <mesh ref={print} geometry={planeGeo(FRONT.w, FRONT.h)} material={printOk} position={[0, FRONT.cy, fz]} />
      <mesh geometry={markingsGeo()} material={mats.label(markingsTexture(), true)} />
      {/* TRIP/RESET (blue, pops out when tripped) */}
      <group position={[px(LAY.reset[0]), py(LAY.reset[1]), fz]} {...handlers}>
        <group ref={reset}>
          <mesh geometry={resetGeo} material={uberMat()} castShadow />
        </group>
      </group>
    </group>
  );
}
