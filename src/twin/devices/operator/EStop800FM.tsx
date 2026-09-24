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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { F800, RoundLegendPrint, addBezel, addRear800F, addRoundLegendPlate, rearKey, type BezelKind } from './parts800F';
import { CAP_HEX, HoverRing, arcPts, canvasTexture, damp, latheZ, partsGeo, planarUVs, sharedGeo, sharedMat, uberMat, useClick } from './shared';

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

/**
 * Mushroom head + knurl ribs as ONE geometry with planar (XY) UVs over the head radius, so the
 * twist-arrow print on the top face comes from the same texture as the red body (one draw).
 */
function headGeo() {
  return sharedGeo('estop-head-40-merged', () => {
    const head = latheZ('estop-head-40', HEAD_PROFILE, 72).clone();
    // 90 fine knurl ribs sunk into the rim band: they bump only 0.15 mm so the silhouette stays round
    const n = 90;
    const rib = new THREE.BoxGeometry(0.0007, 0.0008, 0.0038);
    const parts: THREE.BufferGeometry[] = [head];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Matrix4().makeRotationZ((i / n) * Math.PI * 2);
      m.multiply(new THREE.Matrix4().makeTranslation(0, HEAD_R - 0.00025, 0.02));
      parts.push(rib.clone().applyMatrix4(m));
    }
    const g = mergeGeometries(parts, false) ?? head;
    parts.forEach((p) => p !== g && p.dispose());
    planarUVs(g, HEAD_R);
    return g;
  });
}

function arrowsTexture() {
  return canvasTexture('estop-head-arrows-v2', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = CAP_HEX.red;
    ctx.fillRect(0, 0, w, h);
    const px = w / (2 * HEAD_R); // texture spans [-HEAD_R, HEAD_R]
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = '#8e0d11';
    ctx.fillStyle = '#8e0d11';
    ctx.lineWidth = 0.001 * px;
    ctx.lineCap = 'round';
    const r = 0.0079 * px;
    const ah = 0.0022 * px;
    for (const base of [0, Math.PI]) {
      const a0 = base + Math.PI * 0.12;
      const a1 = base + Math.PI * 0.72;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
      const hx = cx + r * Math.cos(a1);
      const hy = cy + r * Math.sin(a1);
      const tang = a1 + Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(hx + ah * Math.cos(tang), hy + ah * Math.sin(tang));
      ctx.lineTo(hx + ah * 0.72 * Math.cos(a1), hy + ah * 0.72 * Math.sin(a1));
      ctx.lineTo(hx - ah * 0.72 * Math.cos(a1), hy - ah * 0.72 * Math.sin(a1));
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
  const { hovered, handlers } = useClick(onToggle ? () => onToggle() : undefined, frame);

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

  const headMat = sharedMat('estop-head-mat', () => new THREE.MeshStandardMaterial({ map: arrowsTexture(), roughness: 0.28, metalness: 0.02, shadowSide: THREE.BackSide }));
  const pt = panelThickness ?? F800.panelT;
  const staticGeo = partsGeo(`estop800f:${plateDiameter}:${bezel}:${rear ? rearKey(['NC', null, 'NC'], pt) : '-'}`, (b) => {
    addRoundLegendPlate(b, plateDiameter);
    addBezel(b, bezel, false, 0.0104);
    if (rear) addRear800F(b, ['NC', null, 'NC'], pt);
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={frame}>
        <mesh geometry={staticGeo} material={uberMat()} castShadow receiveShadow />
        <RoundLegendPrint text={legend} diameter={plateDiameter} />
        <HoverRing show={hovered} r={HEAD_R + 0.0015} />
        <group ref={head} {...handlers}>
          <mesh geometry={headGeo()} material={headMat} castShadow />
        </group>
      </group>
    </group>
  );
}
