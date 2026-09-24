/**
 * 16" × 18" LED countdown pedestrian signal (ITE PTCSI / MUTCD 4E): overlaid UPRAISED HAND (Portland
 * orange) and WALKING PERSON (lunar white) on the left, 2-digit countdown (Portland orange) on the right,
 * in a one-section housing with a 3-sided hood or an "egg-crate" louver visor, side-of-pole clamshell
 * bracket.
 *
 * Origin: back face of the mounting bracket (the pole surface), at the vertical center of the housing;
 * the display faces +Z. With `mount="none"` the origin is the back-center of the housing.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedMode } from '../../common';
import type { Placement } from '../../contracts';
import { digitBaseTexture, digitTexture, pedOverlayBaseTexture, pedSymbolTexture } from './ledTextures';
import {
  INCH,
  SIGNAL_LIT,
  TRAFFIC_COLORS,
  boxGeo,
  cylX,
  cylY,
  cylZ,
  ledOn,
  mergeAll,
  planeGeo,
  roundedBox,
  roundedRectHole,
  roundedRectShape,
  sharedGeo,
  sharedMat,
  tmats,
  useDisposable,
  xf,
} from './shared';

export interface PedestrianSignalProps extends Placement {
  /** WALKING PERSON (white). */
  getWalk: () => LedMode;
  /** UPRAISED HAND (orange); flash it for the pedestrian change interval. */
  getDontWalk: () => LedMode;
  /** Countdown seconds (0..99); null / negative = blank. */
  getCountdown?: () => number | null;
  /** Show the countdown half (default true). Without it the symbol is centered. */
  countdown?: boolean;
  housingColor?: string;
  /** 3-sided hood (default), egg-crate louvers, or none. */
  visor?: 'hood' | 'crate' | 'none';
  /** Clamshell side-of-pole bracket (default) or none. */
  mount?: 'bracket' | 'none';
  intensity?: number;
}

export const PED_SIGNAL_DIMS = {
  width: 19 * INCH,
  height: 18.5 * INCH,
  depth: 8 * INCH,
  bracketStandoff: 0.11,
} as const;
const P = PED_SIGNAL_DIMS;

const FACE_W = 0.43;
const FACE_H = 0.4;

function hoodGeometry(w: number, h: number, len: number): THREE.BufferGeometry {
  return sharedGeo(`ped:hood:${w}:${h}:${len}`, () => {
    const t = 0.003;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -h / 2);
    s.lineTo(-w / 2, h / 2);
    s.lineTo(w / 2, h / 2);
    s.lineTo(w / 2, -h / 2);
    s.lineTo(w / 2 - t, -h / 2);
    s.lineTo(w / 2 - t, h / 2 - t);
    s.lineTo(-w / 2 + t, h / 2 - t);
    s.lineTo(-w / 2 + t, -h / 2);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    const pos = g.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const yn = (pos.getY(i) + h / 2) / h; // 0 bottom .. 1 top
      pos.setZ(i, pos.getZ(i) * (0.25 + 0.75 * yn));
    }
    g.computeVertexNormals();
    return g;
  });
}

function crateGeometry(w: number, h: number, depth: number): THREE.BufferGeometry {
  return sharedGeo(`ped:crate:${w}:${h}:${depth}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const t = 0.0025;
    const n = 10;
    for (let i = 1; i < n; i++) parts.push(xf(boxGeo(t, h, depth), [-w / 2 + (w * i) / n, 0, depth / 2]));
    for (let j = 1; j < 9; j++) parts.push(xf(boxGeo(w, t, depth), [0, -h / 2 + (h * j) / 9, depth / 2], [-0.35, 0, 0]));
    // frame
    const frame = roundedRectShape(w + 0.02, h + 0.02, 0.01);
    frame.holes.push(roundedRectHole(w, h, 0.004));
    parts.push(new THREE.ExtrudeGeometry(frame, { depth, bevelEnabled: false }));
    return mergeAll(parts);
  });
}

interface PedGeoms {
  housing: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
}

function buildGeoms(visor: 'hood' | 'crate' | 'none', mount: 'bracket' | 'none'): PedGeoms {
  return pedCache.get(`${visor}:${mount}`) ?? makeGeoms(visor, mount);
}
const pedCache = new Map<string, PedGeoms>();

function makeGeoms(visor: 'hood' | 'crate' | 'none', mount: 'bracket' | 'none'): PedGeoms {
  const z0 = mount === 'bracket' ? P.bracketStandoff : 0;
  const housing: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  housing.push(xf(roundedBox(P.width, P.height, P.depth, 0.025, 3), [0, 0, z0 + P.depth / 2]));
  // door frame around the module
  const door = roundedRectShape(P.width - 0.012, P.height - 0.012, 0.02);
  door.holes.push(roundedRectHole(FACE_W + 0.004, FACE_H + 0.004, 0.012));
  housing.push(
    xf(new THREE.ExtrudeGeometry(door, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 }), [0, 0, z0 + P.depth + 0.003]),
  );
  const zDoor = z0 + P.depth + 0.019;
  if (visor === 'hood') housing.push(xf(hoodGeometry(P.width - 0.02, P.height - 0.02, 0.2), [0, 0, zDoor - 0.004]));
  if (visor === 'crate') housing.push(xf(crateGeometry(FACE_W, FACE_H, 0.075), [0, 0, zDoor - 0.012]));
  // hinges + latch
  for (const dy of [-0.15, 0.15]) metal.push(xf(cylY(0.0065, 0.0065, 0.05, 10), [-P.width / 2 + 0.004, dy, zDoor - 0.008]));
  metal.push(xf(cylX(0.009, 0.009, 0.014, 12), [P.width / 2 - 0.002, 0, zDoor - 0.01]));
  metal.push(xf(roundedBox(0.006, 0.034, 0.012, 0.002, 1), [P.width / 2 + 0.007, 0, zDoor - 0.01]));
  // top & bottom tri-stud fittings
  metal.push(xf(cylY(0.045, 0.05, 0.02, 20), [0, P.height / 2 + 0.01, z0 + P.depth / 2]));
  metal.push(xf(cylY(0.045, 0.05, 0.02, 20), [0, -P.height / 2 - 0.01, z0 + P.depth / 2]));
  if (mount === 'bracket') {
    // clamshell bracket: vertical hinge tube at the pole + upper/lower arms into the housing fittings
    const armY = P.height / 2 + 0.035;
    metal.push(xf(cylY(0.022, 0.022, P.height + 0.12, 16), [0, 0, 0.03]));
    for (const y of [armY, -armY]) {
      metal.push(xf(roundedBox(0.05, 0.035, z0 + P.depth / 2 - 0.02, 0.008, 2), [0, y, (z0 + P.depth / 2) / 2 + 0.01]));
      metal.push(xf(cylY(0.03, 0.03, 0.05, 16), [0, y, z0 + P.depth / 2]));
      metal.push(xf(cylZ(0.035, 0.035, 0.02, 16), [0, y, 0.01]));
    }
  }
  const res = { housing: mergeAll(housing), metal: mergeAll(metal) };
  pedCache.set(`${visor}:${mount}`, res);
  return res;
}

/** Additive emissive overlay material (per instance; color scaled for bloom). */
function overlayMat(map: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color: '#000000',
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function coverMat(): THREE.MeshStandardMaterial {
  return sharedMat('ped:cover', () => new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }));
}

function faceMat(map: THREE.Texture, key: string): THREE.MeshStandardMaterial {
  return sharedMat(`ped:face:${key}`, () => new THREE.MeshStandardMaterial({ map, roughness: 0.35, metalness: 0 }));
}

export function PedestrianSignal({
  getWalk,
  getDontWalk,
  getCountdown,
  countdown = true,
  housingColor = TRAFFIC_COLORS.signalBlack,
  visor = 'hood',
  mount = 'bracket',
  intensity = 3,
  position,
  rotation,
  scale,
}: PedestrianSignalProps) {
  const geoms = useMemo(() => buildGeoms(visor, mount), [visor, mount]);
  const mats = useMemo(
    () => ({
      hand: overlayMat(pedSymbolTexture('hand', 'lit')),
      person: overlayMat(pedSymbolTexture('person', 'lit')),
      d0: overlayMat(digitTexture('8')),
      d1: overlayMat(digitTexture('8')),
    }),
    [],
  );
  useDisposable(useMemo(() => [mats.hand, mats.person, mats.d0, mats.d1], [mats]));
  const colors = useMemo(() => ({ orange: new THREE.Color(SIGNAL_LIT.orange), white: new THREE.Color(SIGNAL_LIT.white) }), []);
  const g = useRef({ getWalk, getDontWalk, getCountdown });
  g.current = { getWalk, getDontWalk, getCountdown };
  const lastCount = useRef<number | null>(-1);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const walk = ledOn(g.current.getWalk(), t);
    const hand = ledOn(g.current.getDontWalk(), t);
    mats.person.color.copy(colors.white).multiplyScalar(walk ? intensity : 0);
    mats.hand.color.copy(colors.orange).multiplyScalar(hand ? intensity : 0);
    if (countdown) {
      const v = g.current.getCountdown?.() ?? null;
      const n = v === null || v < 0 || !Number.isFinite(v) ? null : Math.min(99, Math.ceil(v));
      if (n !== lastCount.current) {
        lastCount.current = n;
        if (n !== null) {
          mats.d0.map = digitTexture(n >= 10 ? String(Math.floor(n / 10)) : ' ');
          mats.d1.map = digitTexture(String(n % 10));
        }
      }
      const on = n !== null;
      mats.d0.color.copy(colors.orange).multiplyScalar(on && n >= 10 ? intensity : 0);
      mats.d1.color.copy(colors.orange).multiplyScalar(on ? intensity : 0);
    }
  });

  const zFace = (mount === 'bracket' ? P.bracketStandoff : 0) + P.depth + 0.012;
  const symX = countdown ? -0.105 : 0;
  const symW = 0.19;
  const symH = 0.24;
  const digW = 0.095;
  const digH = 0.17;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geoms.housing} material={tmats.housing(housingColor)} castShadow receiveShadow />
      <mesh geometry={geoms.metal} material={tmats.metal('#8d9195', 0.45)} castShadow />
      {/* module face */}
      <mesh geometry={planeGeo(FACE_W, FACE_H)} material={tmats.plastic('#070707', 0.3)} position={[0, 0, zFace - 0.001]} />
      <mesh geometry={planeGeo(symW, symH)} material={faceMat(pedOverlayBaseTexture(), 'overlay')} position={[symX, 0, zFace]} />
      <mesh geometry={planeGeo(symW, symH)} material={mats.hand} position={[symX, 0, zFace + 0.0006]} />
      <mesh geometry={planeGeo(symW, symH)} material={mats.person} position={[symX, 0, zFace + 0.0008]} />
      {countdown && (
        <>
          {[0.055, 0.16].map((x, i) => (
            <group key={i} position={[x, 0, zFace]}>
              <mesh geometry={planeGeo(digW, digH)} material={faceMat(digitBaseTexture(), 'digit')} />
              <mesh geometry={planeGeo(digW, digH)} material={i === 0 ? mats.d0 : mats.d1} position={[0, 0, 0.0006]} />
            </group>
          ))}
          {/* divider between symbol and countdown halves */}
          <mesh geometry={boxGeo(0.004, FACE_H - 0.04, 0.002)} material={tmats.plastic('#1c1c1c', 0.5)} position={[0.0, 0, zFace]} />
        </>
      )}
      {/* polycarbonate lens cover (reflections) */}
      <mesh geometry={planeGeo(FACE_W, FACE_H)} position={[0, 0, zFace + 0.004]} renderOrder={2} material={coverMat()} />
    </group>
  );
}
