/**
 * Bulletin 1489-M miniature circuit breaker (UL 489), 1-, 2- or 3-pole, 17.5 mm per pole, 45 mm
 * front: light-gray housing, stepped MCB profile, one dark toggle per pole joined by a handle-tie pin
 * (ON = up), red/green contact position window, printed rating (e.g. C10) and catalog, terminal
 * screws top & bottom. Click the toggle to switch (if `onToggle` given; drag-safe click).
 * Performance: housing = one merged mesh, handles = one merged mesh, print (incl. window) = one quad.
 *
 * Origin: DIN clip plane on the rail centerline at the CENTER of the breaker (all poles).
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { F, LEGEND_FONT, NARROW_FONT, addScrew, boxGeo, canvasTexture, cylZ, damp, mats, partsGeo, planeGeo, roundedBox, sharedGeo, uberMat, useClick } from '../operator/shared';

export interface CircuitBreaker1489Props extends Placement {
  poles?: 1 | 2 | 3;
  /** Trip curve + current rating printed on the front, e.g. 'C10'. */
  rating?: string;
  /** Catalog number label (default derived: 1489-M{poles}{rating}). */
  catalog?: string;
  /** Handle state (default: always ON). */
  getOn?: () => boolean;
  onToggle?: () => void;
}

export const MCB = { pole: 0.0175, height: 0.09, depth: 0.0745, shoulder: 0.0445, front: 0.045 } as const;

function poleGeo() {
  return sharedGeo('1489m-pole', () => {
    const H = MCB.height / 2;
    const F = MCB.front / 2;
    const P: [number, number][] = [
      [-H, 0],
      [H, 0],
      [H, MCB.shoulder - 0.002],
      [H - 0.002, MCB.shoulder],
      [F + 0.004, MCB.shoulder],
      [F, MCB.shoulder + 0.006],
      [F, MCB.depth - 0.002],
      [F - 0.002, MCB.depth],
      [-F + 0.002, MCB.depth],
      [-F, MCB.depth - 0.002],
      [-F, MCB.shoulder + 0.006],
      [-F - 0.004, MCB.shoulder],
      [-H + 0.002, MCB.shoulder],
      [-H, MCB.shoulder - 0.002],
    ];
    const s = new THREE.Shape();
    P.forEach(([y, z], i) => (i === 0 ? s.moveTo(y, z) : s.lineTo(y, z)));
    s.closePath();
    const w = MCB.pole - 0.0004;
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelOffset: -0.0004, bevelSegments: 1 });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -w / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    g.computeVertexNormals();
    return g;
  });
}

const WIN_H = MCB.front - 0.004;
const IND = { y: 0.0108, w: 0.004, h: 0.0028 };

function frontTexture(poles: number, rating: string, catalog: string, on: boolean) {
  return canvasTexture(`1489m-front:${poles}:${rating}:${catalog}:${on}`, 128 * poles, 320, (ctx, w, h) => {
    ctx.fillStyle = '#e4e5e1';
    ctx.fillRect(0, 0, w, h);
    const cw = w / poles;
    for (let p = 0; p < poles; p++) {
      const cx = p * cw + cw / 2;
      ctx.fillStyle = '#1a1a1a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 36px ${LEGEND_FONT}`;
      ctx.fillText(rating, cx, 28);
      ctx.font = `600 16px ${NARROW_FONT}`;
      ctx.fillText(p === 0 ? catalog : '', cx, 56);
      ctx.fillText('277V~ / 48V=', cx, h - 40);
      ctx.fillText('10kA', cx, h - 18);
      if (p > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(p * cw - 1, 0, 2, h);
      }
    }
    // contact position indicator window on pole 1 (red = closed / green = open)
    const pxW = w / (poles * MCB.pole - 0.001);
    const pxH = h / WIN_H;
    const ix = cw / 2;
    const iy = (WIN_H / 2 - IND.y) * pxH;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(ix - ((IND.w + 0.0008) * pxW) / 2, iy - ((IND.h + 0.0008) * pxH) / 2, (IND.w + 0.0008) * pxW, (IND.h + 0.0008) * pxH);
    ctx.fillStyle = on ? '#d62222' : '#2aa84a';
    ctx.fillRect(ix - (IND.w * pxW) / 2, iy - (IND.h * pxH) / 2, IND.w * pxW, IND.h * pxH);
  });
}

export function CircuitBreaker1489({ poles = 1, rating = 'C10', catalog, getOn, onToggle, position, rotation, scale }: CircuitBreaker1489Props) {
  const frame = useRef<THREE.Group>(null);
  const handle = useRef<THREE.Group>(null);
  const print = useRef<THREE.Mesh>(null);
  const { handlers } = useClick(onToggle ? () => onToggle() : undefined, frame);
  const W = poles * MCB.pole;
  const m = /^([A-Z])(\d+(?:\.\d+)?)$/.exec(rating);
  const cat = catalog ?? (m ? `1489-M${poles}${m[1]}${String(Math.round(Number(m[2]) * 10)).padStart(3, '0')}` : `1489-M${poles}`);
  const printOn = mats.label(frontTexture(poles, rating, cat, true), false, 0.6);
  const printOff = mats.label(frontTexture(poles, rating, cat, false), false, 0.6);
  useFrame((_, dt) => {
    const on = getOn ? getOn() : true;
    const h = handle.current;
    if (h) h.rotation.x = damp(h.rotation.x, on ? -0.38 : 0.38, 30, Math.min(dt, 0.05));
    const pr = print.current;
    const want = on ? printOn : printOff;
    if (pr && pr.material !== want) pr.material = want;
  });
  const housingGeo = partsGeo(`1489m:${poles}`, (b) => {
    const housing = F.matte('#dcddd9', 0.55);
    for (let p = 0; p < poles; p++) {
      const x = -W / 2 + (p + 0.5) * MCB.pole;
      b.add(poleGeo(), housing, [x, 0, 0]);
      for (const sy of [-1, 1]) {
        // terminal screw in its well, wire entry on the end face
        b.add(cylZ(0.0042, 0.0042, 0.0002, 20), F.matte('#4a4c4e', 0.7), [x, sy * 0.0345, MCB.shoulder + 0.0001]);
        addScrew(b, [x, sy * 0.0345, MCB.shoulder + 0.0001], 0.0032, 0.0014);
        b.add(boxGeo(0.0078, 0.0004, 0.0048), F.hole, [x, sy * (MCB.height / 2 + 0.0002), 0.03]);
      }
      // toggle slot per pole
      b.add(roundedBox(0.0118, 0.0142, 0.002, 0.0008, 1), F.matte('#1a1b1c', 0.8), [x, 0, MCB.depth]);
    }
  });
  const handleGeo = partsGeo(`1489m-handles:${poles}`, (b) => {
    for (let p = 0; p < poles; p++) {
      const x = -W / 2 + (p + 0.5) * MCB.pole;
      b.add(roundedBox(0.009, 0.0068, 0.0145, 0.0018, 2), F.matte('#3b3e41', 0.5), [x, 0, 0.0085]);
      b.add(boxGeo(0.007, 0.0004, 0.004), F.matte('#e8e8e2', 0.5), [x, 0.0035, 0.0128]);
    }
    // handle-tie pin through all handles
    if (poles > 1) b.add(cylZ(0.0011, 0.0011, W - 0.006, 12), F.metal('#9aa0a5', 0.4), [0, 0, 0.011], [0, Math.PI / 2, 0]);
  });
  return (
    <group position={position} rotation={rotation} scale={scale} ref={frame}>
      <mesh geometry={housingGeo} material={uberMat()} castShadow receiveShadow />
      {/* printed front with the contact-position window */}
      <mesh ref={print} geometry={planeGeo(W - 0.001, WIN_H)} material={printOn} position={[0, 0, MCB.depth + 0.0002]} />
      {/* toggle handles (pivot inside the slot) */}
      <group ref={handle} position={[0, 0, MCB.depth - 0.002]} {...handlers}>
        <mesh geometry={handleGeo} material={uberMat()} castShadow />
      </group>
    </group>
  );
}
