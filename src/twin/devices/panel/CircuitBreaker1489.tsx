/**
 * Bulletin 1489-M miniature circuit breaker (UL 489), 1-, 2- or 3-pole, 17.5 mm per pole, 45 mm
 * front: light-gray housing, stepped MCB profile, dark toggle (ON = up) tied across poles, red/green
 * contact position window, printed rating (e.g. C10) and catalog, terminal screws top & bottom.
 * Click the toggle to switch (if `onToggle` given).
 *
 * Origin: DIN clip plane on the rail centerline at the CENTER of the breaker (all poles).
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { LEGEND_FONT, NARROW_FONT, Screw, boxGeo, canvasTexture, cylZ, damp, mats, planeGeo, roundedBox, sharedGeo, useClick } from '../operator/shared';

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

function frontTexture(poles: number, rating: string, catalog: string) {
  return canvasTexture(`1489m-front:${poles}:${rating}:${catalog}`, 128 * poles, 320, (ctx, w, h) => {
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
  });
}

export function CircuitBreaker1489({ poles = 1, rating = 'C10', catalog, getOn, onToggle, position, rotation, scale }: CircuitBreaker1489Props) {
  const frame = useRef<THREE.Group>(null);
  const handle = useRef<THREE.Group>(null);
  const indicator = useRef<THREE.Mesh>(null);
  const { handlers } = useClick(onToggle ? () => onToggle() : undefined, frame);
  const W = poles * MCB.pole;
  const indOn = mats.matte('#d62222', 0.4);
  const indOff = mats.matte('#2aa84a', 0.4);
  useFrame((_, dt) => {
    const on = getOn ? getOn() : true;
    const h = handle.current;
    if (h) h.rotation.x = damp(h.rotation.x, on ? -0.38 : 0.38, 30, Math.min(dt, 0.05));
    const ind = indicator.current;
    const want = on ? indOn : indOff;
    if (ind && ind.material !== want) ind.material = want;
  });
  const housing = mats.matte('#dcddd9', 0.55);
  const m = /^([A-Z])(\d+(?:\.\d+)?)$/.exec(rating);
  const cat = catalog ?? (m ? `1489-M${poles}${m[1]}${String(Math.round(Number(m[2]) * 10)).padStart(3, '0')}` : `1489-M${poles}`);
  const tex = frontTexture(poles, rating, cat);
  const winH = MCB.front - 0.004;
  return (
    <group position={position} rotation={rotation} scale={scale} ref={frame}>
      {Array.from({ length: poles }, (_, p) => {
        const x = -W / 2 + (p + 0.5) * MCB.pole;
        return (
          <group key={p} position={[x, 0, 0]}>
            <mesh geometry={poleGeo()} material={housing} castShadow receiveShadow />
            {/* terminal screw wells + screws, wire entries */}
            {[-1, 1].map((s) => (
              <group key={s}>
                <mesh geometry={cylZ(0.0042, 0.0042, 0.0002, 20)} material={mats.matte('#4a4c4e', 0.7)} position={[0, s * 0.0345, MCB.shoulder + 0.0001]} />
                <Screw position={[0, s * 0.0345, MCB.shoulder + 0.0001]} r={0.0032} h={0.0014} />
                <mesh geometry={boxGeo(0.0078, 0.0004, 0.0048)} material={mats.dark()} position={[0, s * (MCB.height / 2 + 0.0002), 0.03]} />
              </group>
            ))}
          </group>
        );
      })}
      {/* printed front */}
      <mesh geometry={planeGeo(W - 0.001, winH)} material={mats.label(tex, false, 0.6)} position={[0, 0, MCB.depth + 0.0002]} />
      {/* toggle slot */}
      <mesh geometry={roundedBox(Math.min(W - 0.004, 0.0125 + (poles - 1) * MCB.pole), 0.0142, 0.002, 0.0008, 1)} material={mats.matte('#1a1b1c', 0.8)} position={[0, 0, MCB.depth]} />
      {/* contact position indicator window (red = closed / green = open) */}
      <mesh ref={indicator} geometry={boxGeo(0.004, 0.0028, 0.0004)} material={indOn} position={[-W / 2 + MCB.pole / 2, 0.0108, MCB.depth + 0.0005]} />
      {/* toggle handle (pivot inside the slot) */}
      <group ref={handle} position={[0, 0, MCB.depth - 0.002]} {...handlers}>
        <mesh geometry={roundedBox(Math.min(W - 0.006, 0.0098 + (poles - 1) * MCB.pole), 0.0066, 0.0145, 0.0018, 2)} material={mats.matte('#3b3e41', 0.5)} position={[0, 0, 0.0085]} castShadow />
        <mesh geometry={boxGeo(Math.min(W - 0.006, 0.0098 + (poles - 1) * MCB.pole) - 0.002, 0.0004, 0.004)} material={mats.matte('#e8e8e2', 0.5)} position={[0, 0.0034, 0.0128]} />
      </group>
    </group>
  );
}
