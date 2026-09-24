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
  FINISH,
  boxGeo,
  canvasTex,
  cylY,
  cylZ,
  hoverMat,
  ledOn,
  makeCanvas,
  mergeAll,
  mergeVc,
  planeGeo,
  roundedBox,
  roundedRectShape,
  sharedGeo,
  sharedMat,
  sharedTex,
  useClickable,
  useDisposable,
  vc,
  vcMaterial,
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
  /** Clicking the gate (e.g. to inspect it). Shows a pointer cursor + highlight on hover. */
  onClick?: () => void;
}

/** Common cabinet finishes. */
export const BARRIER_COLORS = {
  /** Safety orange (default). */
  orange: '#e8761c',
  /** Steel blue, RAL 5011. */
  steelBlue: '#233a52',
  /** Brushed stainless option. */
  stainless: '#c6cbd0',
  /** Traffic white, RAL 9016. */
  white: '#eef0ec',
} as const;

/** FAAC B680H-class cabinet: 469 W × 279 D × 1100 H mm. */
export const BARRIER_DIMS = {
  cabinetW: 0.469,
  cabinetD: 0.279,
  cabinetH: 1.1,
  pivotY: 0.98,
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

/** Cabinet (static) parts in one per-vertex-finish mesh: body, domed top, base plate & anchors, rear
 * service door + lock, side louvers, LED bar housing, drive hub. */
function cabinetGeometry(color: string): THREE.BufferGeometry {
  return sharedGeo(`gate:cabinet2:${color}`, () => {
    const paint = { color, roughness: 0.42, metalness: color === BARRIER_COLORS.stainless ? 0.85 : 0.25 };
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, f: { color: string; roughness?: number; metalness?: number }, pos?: [number, number, number], rot?: [number, number, number]) => parts.push(vc(xf(g, pos, rot), f));
    add(roundedBox(G.cabinetW, G.cabinetH - 0.08, G.cabinetD, 0.03, 3), paint, [0, (G.cabinetH - 0.08) / 2 + 0.02, 0]);
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
    add(top, paint, [0, G.cabinetH - 0.075, 0]);
    // base plate + anchors
    const metal = { color: '#8e9398', roughness: 0.45, metalness: 0.9 };
    add(roundedBox(G.cabinetW + 0.1, 0.02, G.cabinetD + 0.1, 0.006, 1), metal, [0, 0.01, 0]);
    for (const [x, z] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as const) {
      add(cylY(0.013, 0.013, 0.05, 8), metal, [x * (G.cabinetW / 2 + 0.03), 0.03, z * (G.cabinetD / 2 + 0.03)]);
      add(cylY(0.018, 0.018, 0.016, 6), metal, [x * (G.cabinetW / 2 + 0.03), 0.028, z * (G.cabinetD / 2 + 0.03)]);
    }
    // service door on the back (−Z): recessed seam + panel + lock
    add(roundedBox(G.cabinetW - 0.07, G.cabinetH - 0.26, 0.004, 0.02, 2), FINISH.blackPlastic, [0, 0.52, -G.cabinetD / 2 - 0.0005]);
    add(roundedBox(G.cabinetW - 0.08, G.cabinetH - 0.27, 0.006, 0.018, 2), paint, [0, 0.52, -G.cabinetD / 2 - 0.002]);
    add(cylZ(0.014, 0.014, 0.012, 16), FINISH.stainless, [G.cabinetW / 2 - 0.08, 0.78, -G.cabinetD / 2 - 0.008]);
    // vent louvers on the sides
    for (const sx of [-1, 1]) for (const y of [0.2, 0.24, 0.28, 0.32]) add(boxGeo(0.004, 0.012, G.cabinetD * 0.55), FINISH.blackPlastic, [sx * (G.cabinetW / 2 + 0.001), y, 0]);
    // LED status light bar housing on the top cover
    add(roundedBox(0.24, 0.03, 0.05, 0.012, 2), { color: '#1b1b1b', roughness: 0.4, metalness: 0.05 }, [0, G.cabinetH + 0.012, 0.06]);
    // drive hub on the front face
    add(cylZ(0.085, 0.09, 0.05, 32), { color: '#9da2a6', roughness: 0.35, metalness: 0.9 }, [0, G.pivotY, G.cabinetD / 2 + 0.025]);
    return mergeVc(parts);
  });
}

/** Compact boom holder (clamp plates + shaft cap + bolts) — stays within the cabinet outline. */
function holderGeometry(): THREE.BufferGeometry {
  return sharedGeo('gate:holder', () => {
    const al = { color: '#b4b8bc', roughness: 0.3, metalness: 0.9 };
    const parts: THREE.BufferGeometry[] = [vc(xf(roundedBox(0.3, G.armH + 0.05, 0.06, 0.012, 2), [0.08, 0, -0.01]), al)];
    parts.push(vc(xf(cylZ(0.035, 0.035, 0.02, 20), [0, 0, 0.03]), { color: '#7d8286', roughness: 0.35, metalness: 0.9 }));
    for (const x of [-0.03, 0.08, 0.19]) for (const y of [-0.045, 0.045]) parts.push(vc(xf(cylZ(0.008, 0.008, 0.01, 6), [x, y, 0.025]), FINISH.darkMetal));
    return mergeVc(parts);
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

/** Boom details in one per-vertex-finish mesh: rubber skirt, end cap, red reflectors. */
function armDetails(len: number): THREE.BufferGeometry {
  return sharedGeo(`gate:armDetails:${len}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    parts.push(vc(xf(roundedBox(len - 0.1, 0.035, G.armT * 0.7, 0.01, 2), [len / 2 + 0.07, -G.armH / 2 - 0.016, 0]), FINISH.rubber));
    parts.push(vc(xf(roundedBox(0.04, G.armH + 0.035, G.armT + 0.012, 0.01, 2), [len + 0.035, -0.017, 0]), FINISH.rubber));
    for (let x = 0.7; x < len - 0.2; x += 0.9) {
      for (const z of [G.armT / 2 + 0.001, -G.armT / 2 - 0.001]) parts.push(vc(xf(boxGeo(0.07, 0.035, 0.002), [x, 0, z]), { color: '#e0141a', roughness: 0.3, metalness: 0.1 }));
    }
    return mergeVc(parts);
  });
}

function armLeds(len: number): THREE.BufferGeometry {
  return sharedGeo(`gate:armLeds:${len}`, () => {
    const leds: THREE.BufferGeometry[] = [];
    for (let x = 0.4; x < len - 0.1; x += 0.3) leds.push(xf(cylY(0.007, 0.007, 0.006, 10), [x, G.armH / 2 + 0.003, 0]));
    return mergeAll(leds);
  });
}

function labelMat(): THREE.MeshStandardMaterial {
  return sharedMat('gate:labelMat', () => new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.5 }));
}

const LED_RGB: Record<LedColor, THREE.Color> = {
  red: new THREE.Color('#ff2010'),
  green: new THREE.Color('#20ff60'),
  amber: new THREE.Color('#ff8a00'),
  yellow: new THREE.Color('#ffd21a'),
  blue: new THREE.Color('#2a7dff'),
  white: new THREE.Color('#ffffff'),
};

export function BarrierGate({
  getPosition,
  armLength = 3.6,
  side = 'right',
  housingColor = BARRIER_COLORS.orange,
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
  useDisposable(useMemo(() => [ledMat, armLedMat], [ledMat, armLedMat]));
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
      ledMat.emissive.copy(LED_RGB[c]);
      ledMat.emissiveIntensity = 3.2;
    }
    armLedMat.emissiveIntensity = g.current.getArmLights && ledOn(g.current.getArmLights(), t) ? 4 : 0;
  });

  const { hovered, handlers } = useClickable(onClick);
  const cabinet = cabinetGeometry(housingColor);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group {...handlers}>
        <mesh geometry={cabinet} material={vcMaterial()} castShadow receiveShadow />
        {hovered && <mesh geometry={cabinet} material={hoverMat()} />}
        {/* warning label on the front */}
        <mesh geometry={planeGeo(0.22, 0.11)} position={[0, 0.45, G.cabinetD / 2 + 0.001]} material={labelMat()} />
        {/* LED status light bar */}
        <mesh geometry={roundedBox(0.22, 0.022, 0.045, 0.01, 2)} material={ledMat} position={[0, G.cabinetH + 0.02, 0.06]} />
      </group>
      {/* rotating arm assembly */}
      <group ref={arm} position={[0, G.pivotY, G.armZ]}>
        <group scale={[dir, 1, 1]}>
          <mesh geometry={holderGeometry()} material={vcMaterial()} castShadow />
          <mesh geometry={armGeoms(armLength)} material={stripeMat(armLength)} castShadow />
          <mesh geometry={armDetails(armLength)} material={vcMaterial()} castShadow />
          {getArmLights && <mesh geometry={armLeds(armLength)} material={armLedMat} />}
        </group>
      </group>
      {rest && (
        <group position={[dir * (armLength - 0.1), 0, G.armZ]}>
          <mesh geometry={restGeometry(housingColor)} material={vcMaterial()} castShadow receiveShadow />
        </group>
      )}
    </group>
  );
}

/** Fork rest post under the boom tip. */
function restGeometry(color: string): THREE.BufferGeometry {
  return sharedGeo(`gate:rest:${color}`, () => {
    const paint = { color, roughness: 0.45, metalness: 0.25 };
    const metal = { color: '#8e9398', roughness: 0.45, metalness: 0.9 };
    const parts: THREE.BufferGeometry[] = [];
    parts.push(vc(xf(cylY(0.03, 0.03, G.pivotY - 0.08, 16), [0, (G.pivotY - 0.08) / 2, 0]), paint));
    parts.push(vc(xf(roundedBox(0.14, 0.02, 0.1, 0.005, 1), [0, 0.01, 0]), metal));
    parts.push(vc(xf(roundedBox(0.08, 0.02, 0.08, 0.005, 1), [0, G.pivotY - G.armH / 2 - 0.045, 0]), FINISH.rubber));
    for (const sz of [-1, 1]) parts.push(vc(xf(boxGeo(0.06, 0.08, 0.008), [0, G.pivotY - G.armH / 2 - 0.005, sz * (G.armT / 2 + 0.008)]), FINISH.rubber));
    return mergeVc(parts);
  });
}
