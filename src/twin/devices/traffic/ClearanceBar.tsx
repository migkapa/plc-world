/**
 * Parking-garage entrance clearance bar: a yellow/black striped PVC pipe hung on chains from the
 * ceiling (or a gantry), with a "CLEARANCE 7'-0\"" legend. It swings a little when hit (optional
 * `getSwing` getter, radians).
 *
 * Origin: ground level under the bar's center; the bar spans X, its underside at `clearance`.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { canvasTex, cylY, makeCanvas, mergeAll, sharedGeo, sharedMat, sharedTex, tmats, xf } from './shared';

export interface ClearanceBarProps extends Placement {
  /** Bar length (m). Default 3.6. */
  width?: number;
  /** Height of the bar's underside (m). Default 2.13 (7 ft). */
  clearance?: number;
  /** Chain anchor height (ceiling). Default clearance + 0.6. */
  mountHeight?: number;
  text?: string;
  getSwing?: () => number;
}

function barTexture(text: string): THREE.CanvasTexture {
  return sharedTex(`clr:${text}`, () => {
    const [c, ctx] = makeCanvas(1024, 128);
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#111';
    for (let x = -128; x < 1024 + 128; x += 128) {
      if (x > 260 && x < 700) continue;
      ctx.beginPath();
      ctx.moveTo(x, 128);
      ctx.lineTo(x + 64, 128);
      ctx.lineTo(x + 128, 0);
      ctx.lineTo(x + 64, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(330, 0, 364, 128);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 34px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 68);
    return canvasTex(c);
  });
}

export function ClearanceBar({ width = 3.6, clearance = 2.13, mountHeight, text = "CLEARANCE 7'-0\"", getSwing, position, rotation, scale }: ClearanceBarProps) {
  const top = mountHeight ?? clearance + 0.6;
  const r = 0.05;
  const swing = useRef<THREE.Group>(null);
  const g = useRef(getSwing);
  g.current = getSwing;
  useFrame(() => {
    if (swing.current) swing.current.rotation.x = g.current?.() ?? 0;
  });
  const barGeo = sharedGeo(`clr:bar:${width}`, () => {
    const b = new THREE.CylinderGeometry(r, r, width, 24, 1, false);
    b.rotateZ(Math.PI / 2);
    // UV u along the length on the pipe (cylinder u = around) -> swap for a readable legend
    const uv = b.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getY(i), uv.getX(i));
    return b;
  });
  const chainGeo = sharedGeo(`clr:chain:${top - clearance}`, () => {
    const len = top - clearance - r;
    const links: THREE.BufferGeometry[] = [];
    const n = Math.max(2, Math.round(len / 0.05));
    for (let i = 0; i < n; i++) {
      const t = new THREE.TorusGeometry(0.018, 0.004, 5, 10);
      t.scale(0.7, 1.4, 1);
      links.push(xf(t, [0, -(i + 0.5) * (len / n), 0], [0, i % 2 ? Math.PI / 2 : 0, 0]));
    }
    return mergeAll(links);
  });
  const barMat = sharedMat(`clr:mat:${text}`, () => new THREE.MeshStandardMaterial({ map: barTexture(text), roughness: 0.4 }));
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={swing} position={[0, top, 0]}>
        {[-width / 2 + 0.25, width / 2 - 0.25].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh geometry={chainGeo} material={tmats.metal('#9ba0a4', 0.35)} />
            <mesh geometry={cylY(0.03, 0.03, 0.02, 12)} material={tmats.metal('#8b9094', 0.4)} position={[0, 0.01, 0]} />
          </group>
        ))}
        <mesh geometry={barGeo} material={barMat} position={[0, -(top - clearance) + r, 0]} rotation={[Math.PI + 0.2, 0, 0]} castShadow />
      </group>
    </group>
  );
}
