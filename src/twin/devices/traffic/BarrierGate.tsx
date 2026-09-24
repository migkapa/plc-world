/**
 * Parking barrier gate (FAAC B680H / Magnetic-style): powder-coated steel cabinet ≈ 1.1 m tall with a
 * domed top cover, LED status light bar, service door with lock, anchor base plate; drive hub on the
 * front face with a rotating arm holder; rectangular aluminum boom with yellow/black diagonal
 * chevrons, red reflectors, black rubber bottom skirt, end cap and optional red LED arm lights; optional
 * fork rest post at the arm tip.
 *
 * Origin: ground at the cabinet center. The arm pivots about the Z axis (in front of the cabinet, +Z
 * side) and spans the lane along +X (`side="right"`) or −X (`side="left"`); `getPosition` 0 = down
 * (horizontal) … 1 = up (vertical).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedColor, LedMode } from '../../common';
import type { Placement } from '../../contracts';
import {
  boxGeo,
  canvasTex,
  cylY,
  cylZ,
  ledOn,
  makeCanvas,
  mergeAll,
  planeGeo,
  roundedBox,
  roundedRectShape,
  sharedGeo,
  sharedMat,
  sharedTex,
  tmats,
  xf,
} from './shared';

export interface BarrierGateProps extends Placement {
  /** Arm position 0 = down … 1 = up (90°). */
  getPosition: () => number;
  /** Clear boom length from the pivot (m). Default 3.6. */
  armLength?: number;
  side?: 'left' | 'right';
  housingColor?: string;
  /** Status light override; default: red down, green up, flashing amber while moving. */
  getLed?: () => LedColor | 'off';
  /** Red LED strip along the boom (e.g. lit while down / flashing while moving). */
  getArmLights?: () => LedMode;
  /** Fork rest post under the arm tip. */
  rest?: boolean;
  /** Clicking the gate (e.g. to inspect it). */
  onClick?: () => void;
}

export const BARRIER_DIMS = {
  cabinetW: 0.36,
  cabinetD: 0.28,
  cabinetH: 1.02,
  pivotY: 0.9,
  /** Arm plane offset in front of the cabinet (+Z). */
  armZ: 0.2,
  armH: 0.1,
  armT: 0.045,
} as const;
const G = BARRIER_DIMS;

function stripeTexture(): THREE.CanvasTexture {
  return sharedTex('gate:stripes', () => {
    const [c, ctx] = makeCanvas(256, 64);
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#121212';
    for (let x = -64; x < 256 + 64; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.lineTo(x + 64, 64);
      ctx.lineTo(x + 128, 0);
      ctx.lineTo(x + 64, 0);
      ctx.closePath();
      ctx.fill();
    }
    const t = canvasTex(c, { repeat: true });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

function stripeMat(len: number): THREE.MeshStandardMaterial {
  return sharedMat(`gate:stripeMat:${len}`, () => {
    const map = stripeTexture().clone();
    map.repeat.set(len / 0.6, 1);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, roughness: 0.4, metalness: 0.1 });
  });
}

function labelTexture(): THREE.CanvasTexture {
  return sharedTex('gate:label', () => {
    const [c, ctx] = makeCanvas(256, 128);
    ctx.fillStyle = '#f5c400';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 256, 34);
    ctx.fillStyle = '#f5c400';
    ctx.font = 'bold 26px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚠ CAUTION', 128, 18);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 22px Arial, Helvetica, sans-serif';
    ctx.fillText('AUTOMATIC GATE', 128, 62);
    ctx.fillText('ONE VEHICLE ONLY', 128, 96);
    return canvasTex(c);
  });
}

/** Cabinet (static) geometry: body, domed top, base plate, hub, door outline. */
function cabinetGeoms() {
  return sharedGeo('gate:cabinet', () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(xf(roundedBox(G.cabinetW, G.cabinetH - 0.08, G.cabinetD, 0.03, 3), [0, (G.cabinetH - 0.08) / 2 + 0.02, 0]));
    // domed top cover (slightly larger)
    const top = new THREE.ExtrudeGeometry(roundedRectShape(G.cabinetW + 0.02, G.cabinetD + 0.02, 0.05), {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.012,
      bevelSegments: 5,
      curveSegments: 8,
    });
    top.rotateX(-Math.PI / 2);
    parts.push(xf(top, [0, G.cabinetH - 0.075, 0]));
    return mergeAll(parts);
  });
}

function baseGeom() {
  return sharedGeo('gate:base', () => {
    const parts: THREE.BufferGeometry[] = [xf(roundedBox(G.cabinetW + 0.1, 0.02, G.cabinetD + 0.1, 0.006, 1), [0, 0.01, 0])];
    for (const [x, z] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      parts.push(xf(cylY(0.013, 0.013, 0.05, 8), [x * (G.cabinetW / 2 + 0.03), 0.03, z * (G.cabinetD / 2 + 0.03)]));
      parts.push(xf(cylY(0.018, 0.018, 0.016, 6), [x * (G.cabinetW / 2 + 0.03), 0.028, z * (G.cabinetD / 2 + 0.03)]));
    }
    return mergeAll(parts);
  });
}

function armGeoms(len: number) {
  return sharedGeo(`gate:arm:${len}`, () => {
    // boom box from x=0.1 to len (UV along length on the faces)
    const g = new THREE.BoxGeometry(len, G.armH, G.armT, 1, 1, 1);
    g.translate(len / 2 + 0.02, 0, 0);
    return g;
  });
}

// sharedGeo caches BufferGeometry only; keep detail groups in their own map
const detailCache = new Map<number, { rubber: THREE.BufferGeometry; refl: THREE.BufferGeometry; leds: THREE.BufferGeometry }>();
function armDetails(len: number) {
  let d = detailCache.get(len);
  if (!d) {
    d = buildArmDetails(len);
    detailCache.set(len, d);
  }
  return d;
}
function buildArmDetails(len: number) {
  const rubber: THREE.BufferGeometry[] = [];
  rubber.push(xf(roundedBox(len - 0.1, 0.035, G.armT * 0.7, 0.01, 2), [len / 2 + 0.07, -G.armH / 2 - 0.016, 0]));
  rubber.push(xf(roundedBox(0.04, G.armH + 0.035, G.armT + 0.012, 0.01, 2), [len + 0.035, -0.017, 0]));
  const refl: THREE.BufferGeometry[] = [];
  for (let x = 0.7; x < len - 0.2; x += 0.9) {
    for (const z of [G.armT / 2 + 0.001, -G.armT / 2 - 0.001]) refl.push(xf(boxGeo(0.07, 0.035, 0.002), [x, 0, z]));
  }
  const leds: THREE.BufferGeometry[] = [];
  for (let x = 0.4; x < len - 0.1; x += 0.3) leds.push(xf(cylY(0.007, 0.007, 0.006, 10), [x, G.armH / 2 + 0.003, 0]));
  return { rubber: mergeAll(rubber), refl: mergeAll(refl), leds: mergeAll(leds) };
}

const LED_RGB: Record<LedColor, string> = {
  red: '#ff2010',
  green: '#20ff60',
  amber: '#ff8a00',
  yellow: '#ffd21a',
  blue: '#2a7dff',
  white: '#ffffff',
};

export function BarrierGate({
  getPosition,
  armLength = 3.6,
  side = 'right',
  housingColor = '#e8761c',
  getLed,
  getArmLights,
  rest = false,
  onClick,
  position,
  rotation,
  scale,
}: BarrierGateProps) {
  const arm = useRef<THREE.Group>(null);
  const ledMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2a2a2a', emissive: '#ff2010', emissiveIntensity: 0, roughness: 0.2, toneMapped: false }),
    [],
  );
  const armLedMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a0a08', emissive: '#ff1a0a', emissiveIntensity: 0, roughness: 0.3, toneMapped: false }),
    [],
  );
  const g = useRef({ getPosition, getLed, getArmLights });
  g.current = { getPosition, getLed, getArmLights };
  const last = useRef(0);
  const moving = useRef(0);
  const dir = side === 'right' ? 1 : -1;
  useFrame(({ clock }, dt) => {
    const p = THREE.MathUtils.clamp(g.current.getPosition(), -0.05, 1.05);
    if (arm.current) arm.current.rotation.z = dir * p * (Math.PI / 2);
    const t = clock.elapsedTime;
    // moving detection (hold for 0.2 s after the last change)
    if (Math.abs(p - last.current) > 1e-4) moving.current = 0.2;
    else moving.current = Math.max(0, moving.current - dt);
    last.current = p;
    let c: LedColor | 'off';
    if (g.current.getLed) c = g.current.getLed();
    else if (moving.current > 0) c = t % 0.6 < 0.3 ? 'amber' : 'off';
    else c = p > 0.9 ? 'green' : 'red';
    if (c === 'off') ledMat.emissiveIntensity = 0;
    else {
      ledMat.emissive.set(LED_RGB[c]);
      ledMat.emissiveIntensity = 3.2;
    }
    armLedMat.emissiveIntensity = g.current.getArmLights && ledOn(g.current.getArmLights(), t) ? 4 : 0;
  });

  const housing = tmats.paint(housingColor, 0.42, 0.25);
  const details = armDetails(armLength);
  const handlers = onClick
    ? {
        onPointerDown: (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onClick();
        },
      }
    : {};
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group {...handlers}>
        <mesh geometry={cabinetGeoms()} material={housing} castShadow receiveShadow />
        <mesh geometry={baseGeom()} material={tmats.metal('#8e9398', 0.45)} castShadow receiveShadow />
        {/* service door on the back (−Z): recessed seam + lock */}
        <mesh geometry={roundedBox(G.cabinetW - 0.07, G.cabinetH - 0.26, 0.004, 0.02, 2)} material={tmats.plastic('#1a1a1a', 0.8)} position={[0, 0.5, -G.cabinetD / 2 - 0.0005]} />
        <mesh geometry={roundedBox(G.cabinetW - 0.08, G.cabinetH - 0.27, 0.006, 0.018, 2)} material={housing} position={[0, 0.5, -G.cabinetD / 2 - 0.002]} />
        <mesh geometry={cylZ(0.014, 0.014, 0.012, 16)} material={tmats.metal('#c9cdd0', 0.25)} position={[G.cabinetW / 2 - 0.08, 0.72, -G.cabinetD / 2 - 0.008]} />
        {/* vent louvers on the sides */}
        {[-1, 1].map((sx) =>
          [0.2, 0.24, 0.28, 0.32].map((y) => (
            <mesh key={`${sx}:${y}`} geometry={boxGeo(0.004, 0.012, G.cabinetD * 0.55)} material={tmats.plastic('#151515', 0.8)} position={[sx * (G.cabinetW / 2 + 0.001), y, 0]} />
          )),
        )}
        {/* warning label on the front */}
        <mesh geometry={planeGeo(0.2, 0.1)} position={[0, 0.45, G.cabinetD / 2 + 0.001]}>
          <meshStandardMaterial map={labelTexture()} roughness={0.5} />
        </mesh>
        {/* LED status light bar on the top cover */}
        <mesh geometry={roundedBox(0.2, 0.03, 0.05, 0.012, 2)} material={tmats.plastic('#1b1b1b', 0.4)} position={[0, G.cabinetH + 0.012, 0.06]} />
        <mesh geometry={roundedBox(0.18, 0.022, 0.045, 0.01, 2)} material={ledMat} position={[0, G.cabinetH + 0.02, 0.06]} />
        {/* drive hub on the front face */}
        <mesh geometry={cylZ(0.085, 0.09, 0.05, 32)} material={tmats.metal('#9da2a6', 0.35)} position={[0, G.pivotY, G.cabinetD / 2 + 0.025]} castShadow />
      </group>
      {/* rotating arm assembly */}
      <group ref={arm} position={[0, G.pivotY, G.armZ]}>
        <group scale={[dir, 1, 1]}>
          {/* arm holder bracket + shaft cap */}
          <mesh geometry={roundedBox(0.28, G.armH + 0.05, 0.06, 0.012, 2)} material={tmats.metal('#b4b8bc', 0.3)} position={[0.04, 0, -0.01]} castShadow />
          <mesh geometry={cylZ(0.035, 0.035, 0.02, 20)} material={tmats.metal('#7d8286', 0.35)} position={[0, 0, 0.03]} />
          {[-0.06, 0.06, 0.14].map((x) =>
            [-0.045, 0.045].map((y) => <mesh key={`${x}:${y}`} geometry={cylZ(0.008, 0.008, 0.01, 6)} material={tmats.metal('#6f7478', 0.4)} position={[x, y, 0.025]} />),
          )}
          {/* counterweight stub behind the pivot */}
          <mesh geometry={roundedBox(0.22, G.armH * 0.9, G.armT, 0.01, 2)} material={tmats.plastic('#141414', 0.6)} position={[-0.18, 0, 0]} castShadow />
          <mesh geometry={armGeoms(armLength)} material={stripeMat(armLength)} castShadow />
          <mesh geometry={details.rubber} material={tmats.rubber('#121212')} castShadow />
          <mesh geometry={details.refl} material={tmats.retro('#e0141a')} />
          {getArmLights && <mesh geometry={details.leds} material={armLedMat} />}
        </group>
      </group>
      {rest && (
        <group position={[dir * (armLength - 0.1), 0, G.armZ]}>
          <mesh geometry={cylY(0.03, 0.03, G.pivotY - 0.08, 16)} material={tmats.paint(housingColor, 0.45, 0.25)} position={[0, (G.pivotY - 0.08) / 2, 0]} castShadow />
          <mesh geometry={roundedBox(0.14, 0.02, 0.1, 0.005, 1)} material={tmats.metal('#8e9398', 0.45)} position={[0, 0.01, 0]} />
          {/* fork */}
          <mesh geometry={roundedBox(0.08, 0.02, 0.08, 0.005, 1)} material={tmats.rubber()} position={[0, G.pivotY - G.armH / 2 - 0.045, 0]} />
          {[-1, 1].map((sz) => (
            <mesh key={sz} geometry={boxGeo(0.06, 0.08, 0.008)} material={tmats.rubber()} position={[0, G.pivotY - G.armH / 2 - 0.005, sz * (G.armT / 2 + 0.008)]} />
          ))}
        </group>
      )}
    </group>
  );
}
