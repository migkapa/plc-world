/**
 * Bulletin 193-E (E1 Plus style) electronic overload relay that plugs directly under a 100-C09:
 * FLA adjustment dial with printed scale, trip-class selector, blue RESET button that pops out when
 * tripped, red TEST/STOP button, orange TRIP indicator flag, output terminals 2/T1 4/T2 6/T3 and
 * auxiliary contacts 95-96 (N.C.) / 97-98 (N.O.).
 *
 * Origin: top edge of the BACK face, centered (the point where it meets the contactor's bottom).
 * The relay hangs downward (−Y) from the origin.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { OverloadRelayProps } from '../../contracts';
import { LEGEND_FONT, NARROW_FONT, Screw, boxGeo, canvasTexture, cylZ, damp, mats, planeGeo, sharedGeo, useClick } from '../operator/shared';
import { CONTACTOR_GRAY } from './Contactor100C';

export interface OverloadRelay193Props extends OverloadRelayProps {
  /** Click the RESET button. */
  onReset?: () => void;
  /** FLA dial setting in amps (visual), default 9. */
  fla?: number;
  /** FLA range printed on the dial [min, max], default [3.2, 16]. */
  range?: [number, number];
}

export const E193 = { w: 0.045, h: 0.068, d: 0.086, step: 0.058, front: 0.086 } as const;

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

function frontTexture(catalog: string, range: [number, number]) {
  return canvasTexture(`193e-front:${catalog}:${range.join('-')}`, 448, 340, (ctx, w, h) => {
    ctx.fillStyle = '#6f7378';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // FLA dial scale around dial center (left)
    const cx = w * 0.3;
    const cy = h * 0.42;
    const r = 88;
    ctx.strokeStyle = '#f2f2ee';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();
    ctx.font = `600 18px ${NARROW_FONT}`;
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const a = Math.PI * 0.75 + (Math.PI * 1.5 * i) / steps;
      const v = range[0] + ((range[1] - range[0]) * i) / steps;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * (r + 10), cy + Math.sin(a) * (r + 10));
      ctx.stroke();
      ctx.fillText(v.toFixed(v < 10 ? 1 : 0), cx + Math.cos(a) * (r + 26), cy + Math.sin(a) * (r + 22));
    }
    ctx.font = `700 22px ${LEGEND_FONT}`;
    ctx.fillText('FLA (A)', cx, cy + r + 14);
    // right column: labels
    ctx.font = `700 20px ${LEGEND_FONT}`;
    ctx.fillText('TRIP', w * 0.78, 22);
    ctx.fillText('RESET', w * 0.78, h * 0.565);
    ctx.fillText('TEST', w * 0.78, h * 0.875);
    // catalog
    ctx.font = `700 24px ${LEGEND_FONT}`;
    ctx.fillText(catalog, w * 0.3, h - 18);
  });
}

function markingsTexture() {
  return canvasTexture('193e-markings', 448, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.font = `700 26px ${NARROW_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ['2/T1', '4/T2', '6/T3'].forEach((t, i) => ctx.fillText(t, (0.23 + i * 0.27) * w, h / 2));
  });
}

function auxTexture() {
  return canvasTexture('193e-aux', 448, 48, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.font = `700 24px ${NARROW_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ['95', '96', '97', '98'].forEach((t, i) => ctx.fillText(t, (0.14 + i * 0.24) * w, h / 2));
  });
}

export function OverloadRelay193({ getTripped, catalog = '193-EEDB', onReset, fla = 9, range = [3.2, 16], position, rotation, scale }: OverloadRelay193Props) {
  const reset = useRef<THREE.Group>(null);
  const flag = useRef<THREE.Mesh>(null);
  const frame = useRef<THREE.Group>(null);
  const { handlers } = useClick(onReset ? () => onReset() : undefined, frame);
  const flagTrip = mats.gloss('#ff8a00');
  const flagOk = mats.matte('#1d1e20', 0.5);
  useFrame((_, dt) => {
    const t = getTripped();
    const r = reset.current;
    if (r) r.position.z = damp(r.position.z, t ? 0.0028 : 0, 25, Math.min(dt, 0.05));
    const f = flag.current;
    if (f) {
      const want = t ? flagTrip : flagOk;
      if (f.material !== want) f.material = want;
    }
  });
  const housing = mats.matte(CONTACTOR_GRAY, 0.55);
  const frontW = E193.w - 0.002;
  const frontH = 0.0326;
  const frontCy = -0.032;
  const fz = E193.front + 0.0002;
  const dialA = Math.PI * 0.75 + (Math.PI * 1.5 * (fla - range[0])) / (range[1] - range[0]);
  const dialX = -frontW / 2 + frontW * 0.3;
  const dialY = frontCy + frontH / 2 - frontH * 0.42;
  const colX = -frontW / 2 + frontW * 0.78;
  return (
    <group position={position} rotation={rotation} scale={scale} ref={frame}>
      <mesh geometry={bodyGeo()} material={housing} castShadow receiveShadow />
      {/* plug-in pins into the contactor's T terminals */}
      {[-0.012, 0, 0.012].map((x) => (
        <mesh key={x} geometry={boxGeo(0.0036, 0.009, 0.0012)} material={mats.metal('#c58b54', 0.35)} position={[x, 0.003, E193.step - 0.008]} />
      ))}
      {/* front panel print */}
      <mesh geometry={planeGeo(frontW, frontH)} material={mats.label(frontTexture(catalog, range), false, 0.55)} position={[0, frontCy, fz]} />
      {/* FLA dial */}
      <group position={[dialX, dialY, fz]} rotation={[0, 0, -dialA - Math.PI / 2]}>
        <mesh geometry={cylZ(0.0062, 0.0066, 0.0026, 32)} material={mats.matte('#e8e8e3', 0.45)} position={[0, 0, 0.0013]} castShadow />
        <mesh geometry={boxGeo(0.0011, 0.0045, 0.0004)} material={mats.dark()} position={[0, 0.0032, 0.0027]} />
        <mesh geometry={boxGeo(0.006, 0.0012, 0.0012)} material={mats.matte('#b8b8b2', 0.5)} position={[0, 0, 0.0029]} />
      </group>
      {/* trip indicator flag window */}
      <mesh geometry={boxGeo(0.0095, 0.0042, 0.0005)} material={mats.dark()} position={[colX, frontCy + frontH / 2 - 0.0058, fz + 0.0001]} />
      <mesh ref={flag} geometry={boxGeo(0.0082, 0.0032, 0.0006)} material={flagOk} position={[colX, frontCy + frontH / 2 - 0.0058, fz + 0.0002]} />
      {/* RESET (blue, pops out when tripped) */}
      <group position={[colX, frontCy + frontH / 2 - 0.0118, fz]} {...handlers}>
        <mesh geometry={cylZ(0.0052, 0.0052, 0.0006, 24)} material={mats.dark()} position={[0, 0, 0.0002]} />
        <group ref={reset}>
          <mesh geometry={cylZ(0.0042, 0.0044, 0.004, 24)} material={mats.gloss('#1e5bd6')} position={[0, 0, 0.001]} castShadow />
        </group>
      </group>
      {/* TEST/STOP (red) */}
      <mesh geometry={cylZ(0.0028, 0.003, 0.0022, 20)} material={mats.gloss('#c4161c')} position={[colX, frontCy + frontH / 2 - 0.0224, fz + 0.0011]} />
      {/* output terminals on the lower step */}
      {[-0.012, 0, 0.012].map((x) => (
        <group key={x} position={[x, -E193.h + 0.0075, E193.step]}>
          <mesh geometry={boxGeo(0.0078, 0.0078, 0.0002)} material={mats.matte('#3a3c3f', 0.7)} position={[0, 0, 0.0001]} />
          <Screw position={[0, 0, 0.0001]} r={0.0031} h={0.0014} />
          <mesh geometry={boxGeo(0.0072, 0.0004, 0.0065)} material={mats.dark()} position={[0, -0.0078, -0.012]} />
        </group>
      ))}
      <mesh geometry={planeGeo(frontW, 0.0028)} material={mats.label(markingsTexture(), true)} position={[0, -0.0551, E193.step + 0.0003]} />
      {/* aux contact terminals on the upper step */}
      {[-0.0165, -0.0055, 0.0055, 0.0165].map((x) => (
        <group key={x} position={[x, -0.0055, E193.step]}>
          <mesh geometry={boxGeo(0.0054, 0.0054, 0.0002)} material={mats.matte('#3a3c3f', 0.7)} position={[0, 0, 0.0001]} />
          <Screw position={[0, 0, 0.0001]} r={0.0021} h={0.0011} />
        </group>
      ))}
      <mesh geometry={planeGeo(frontW, 0.0022)} material={mats.label(auxTexture(), true)} position={[0, -0.0094, E193.step + 0.0003]} />
    </group>
  );
}
