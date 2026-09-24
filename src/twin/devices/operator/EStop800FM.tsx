/**
 * Bulletin 800FM-MT44 style 40 mm red mushroom E-stop, twist-to-release, on a Ø 60 mm yellow
 * "EMERGENCY STOP" legend plate (800F-15YSE112 style), two N.C. contact blocks behind the panel.
 *
 * Origin: center of the mounting hole on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { EStopProps } from '../../contracts';
import { Bezel800F, F800, Rear800F, RoundLegendPlate, type BezelKind } from './parts800F';
import { CAP_HEX, arcPts, boxGeo, canvasTexture, circleGeo, damp, latheZ, mats, mergedCopies, sharedMat, useClick } from './shared';

export interface EStop800FMProps extends EStopProps {
  bezel?: BezelKind;
  panelThickness?: number;
  /** Legend plate diameter (m), default 0.06. */
  plateDiameter?: number;
  rear?: boolean;
}

const HEAD_R = 0.02;
const TOP_Z = 0.0252;
const TRAVEL = 0.0048;

const HEAD_PROFILE: [number, number][] = [
  [0, 0.0012],
  [0.0104, 0.0012],
  [0.0104, 0.0128],
  // twist collar
  [0.0116, 0.0131],
  [0.0116, 0.0139],
  [0.0142, 0.0142],
  [0.0176, 0.0152],
  [0.0194, 0.0165],
  [HEAD_R, 0.0178],
  [HEAD_R, 0.0222],
  ...arcPts(HEAD_R - 0.0024, 0.0222, 0.0024, 0, 90, 7),
  [0.0145, TOP_Z - 0.0003],
  [0.0132, TOP_Z],
  [0, TOP_Z],
];

function headGeo() {
  return latheZ('estop-head-40', HEAD_PROFILE, 72);
}

function ribsGeo() {
  const n = 40;
  return mergedCopies(
    'estop-ribs-40',
    () => boxGeo(0.0013, 0.0009, 0.0046),
    () => {
      const out: THREE.Matrix4[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const m = new THREE.Matrix4().makeRotationZ(a);
        m.multiply(new THREE.Matrix4().makeTranslation(0, HEAD_R + 0.0002, 0.0201));
        out.push(m);
      }
      return out;
    },
  );
}

function arrowsTexture() {
  return canvasTexture('estop-top-arrows', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = CAP_HEX.red;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = '#8e0d11';
    ctx.fillStyle = '#8e0d11';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    const r = w * 0.3;
    for (const base of [0, Math.PI]) {
      const a0 = base + Math.PI * 0.12;
      const a1 = base + Math.PI * 0.72;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
      // arrow head at a1 (clockwise)
      const hx = cx + r * Math.cos(a1);
      const hy = cy + r * Math.sin(a1);
      const tang = a1 + Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(hx + 22 * Math.cos(tang), hy + 22 * Math.sin(tang));
      ctx.lineTo(hx + 16 * Math.cos(a1), hy + 16 * Math.sin(a1));
      ctx.lineTo(hx - 16 * Math.cos(a1), hy - 16 * Math.sin(a1));
      ctx.closePath();
      ctx.fill();
    }
  });
}

export function EStop800FM({
  getEngaged,
  onToggle,
  legend = 'EMERGENCY STOP',
  bezel = 'metal',
  panelThickness,
  plateDiameter = 0.06,
  rear = true,
  position,
  rotation,
  scale,
}: EStop800FMProps) {
  const frame = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const twist = useRef({ prev: false, t: 1 });
  const { handlers } = useClick(onToggle ? () => onToggle() : undefined, frame);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = head.current;
    if (!g) return;
    const engaged = getEngaged();
    const tw = twist.current;
    if (tw.prev && !engaged) tw.t = 0; // released: play the twist
    tw.prev = engaged;
    if (tw.t < 1) tw.t = Math.min(1, tw.t + dt / 0.55);
    g.rotation.z = -Math.sin(tw.t * Math.PI) * 0.55;
    // stays pushed in until the twist has mostly happened
    const target = engaged || tw.t < 0.45 ? -TRAVEL : 0;
    g.position.z = damp(g.position.z, target, engaged ? 40 : 18, dt);
  });

  const topMat = sharedMat('estop-top', () => new THREE.MeshStandardMaterial({ map: arrowsTexture(), roughness: 0.28, metalness: 0.02 }));
  const red = mats.gloss(CAP_HEX.red);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={frame}>
        <RoundLegendPlate text={legend} diameter={plateDiameter} />
        <group {...handlers}>
          <Bezel800F kind={bezel} />
          <group ref={head}>
            <mesh geometry={headGeo()} material={red} castShadow />
            <mesh geometry={ribsGeo()} material={red} />
            <mesh geometry={circleGeo(0.0131, 48)} material={topMat} position={[0, 0, TOP_Z + 0.00003]} />
          </group>
        </group>
      </group>
      {rear && <Rear800F items={['NC', null, 'NC']} panelThickness={panelThickness ?? F800.panelT} />}
    </group>
  );
}
