/**
 * Inductive vehicle-detector loop as seen on the pavement: 1/4" saw-cut slots filled with glossy black
 * loop sealant that is squeegeed into a ≈ 40 mm over-band, over a slightly darker patch of asphalt — a
 * rectangle (or quadrupole with a center cut) with 45° chamfered corners and small saw over-cuts,
 * plus the lead-in cut (twisted pair) running to the curb / pull box. When `getActive` returns true
 * the sealant glows as a detection hint: `hint="subtle"` (default) is a faint cyan line glow,
 * `"strong"` adds a halo and tints the detection zone (game view), `"none"` shows nothing (realism).
 *
 * Origin: loop center on the road surface (y = 0). Length along X, width along Z; the lead-in runs
 * from the +Z edge toward +Z by `leadIn` meters (rotate the component to route it).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { TRAFFIC_COLORS, markingMat, mergeAll, planeGeo, sharedGeo, sharedMat, useDisposable } from './shared';

export interface InductiveLoopMarkingProps extends Placement {
  /** Loop length along X (m). Default 1.8 (6 ft). */
  length?: number;
  /** Loop width along Z (m). Default 1.8 (6 ft). */
  width?: number;
  /** 'rect' (default) or 'quadrupole' (extra center cut along X). */
  shape?: 'rect' | 'quadrupole';
  /** Lead-in saw cut length toward +Z (m); 0 = none. Default 2. */
  leadIn?: number;
  /** Lead-in offset along X from the loop center (m). */
  leadInX?: number;
  getActive?: () => boolean;
  /** Glow color when active. */
  glowColor?: string;
  /** How visible the "active" hint is. Default 'subtle'. */
  hint?: 'none' | 'subtle' | 'strong';
}

/** Sealant over-band width (m). */
const CUT_W = 0.04;
/** Darker sealer / fresh-asphalt patch around the cuts (m). */
const PATCH_W = 0.14;

const HINT = {
  none: { core: 0, halo: 0, zone: 0 },
  subtle: { core: 0.35, halo: 0.05, zone: 0 },
  strong: { core: 2.2, halo: 0.35, zone: 0.08 },
} as const;

function segs(len: number, wid: number, shape: 'rect' | 'quadrupole', leadIn: number, leadX: number): [number, number, number, number][] {
  const hx = len / 2;
  const hz = wid / 2;
  const c = Math.min(0.2, hx * 0.3, hz * 0.3);
  const o = 0.05; // saw over-cut
  const s: [number, number, number, number][] = [
    [-hx + c - o, -hz, hx - c + o, -hz],
    [-hx + c - o, hz, hx - c + o, hz],
    [-hx, -hz + c - o, -hx, hz - c + o],
    [hx, -hz + c - o, hx, hz - c + o],
    // chamfers
    [-hx, -hz + c, -hx + c, -hz],
    [hx - c, -hz, hx, -hz + c],
    [-hx, hz - c, -hx + c, hz],
    [hx - c, hz, hx, hz - c],
  ];
  if (shape === 'quadrupole') s.push([-hx, 0, hx, 0]);
  if (leadIn > 0) s.push([leadX, hz, leadX, hz + leadIn]);
  return s;
}

function cutGeometry(key: string, list: [number, number, number, number][], w: number): THREE.BufferGeometry {
  return sharedGeo(`loop:${key}:${w}`, () => {
    const parts = list.map(([x0, z0, x1, z1]) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.PlaneGeometry(len, w);
      g.rotateX(-Math.PI / 2);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      return g;
    });
    return mergeAll(parts);
  });
}

export function InductiveLoopMarking({
  length = 1.8,
  width = 1.8,
  shape = 'rect',
  leadIn = 2,
  leadInX = 0,
  getActive,
  glowColor = '#34d6ff',
  hint = 'subtle',
  position,
  rotation,
  scale,
}: InductiveLoopMarkingProps) {
  const list = useMemo(() => segs(length, width, shape, leadIn, leadInX), [length, width, shape, leadIn, leadInX]);
  const key = `${length}:${width}:${shape}:${leadIn}:${leadInX}`;
  const cuts = cutGeometry(key, list, CUT_W);
  const halo = cutGeometry(key + ':halo', list, CUT_W * 3);
  const patch = cutGeometry(key + ':patch', list, PATCH_W);
  const glowMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    [glowColor],
  );
  const zoneMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: glowColor, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    [glowColor],
  );
  const coreMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: TRAFFIC_COLORS.loopSealant, emissive: glowColor, emissiveIntensity: 0, roughness: 0.3, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false }),
    [glowColor],
  );
  useDisposable(useMemo(() => [glowMat, zoneMat, coreMat], [glowMat, zoneMat, coreMat]));
  const g = useRef(getActive);
  g.current = getActive;
  const level = useRef(0);
  useFrame(({ clock }, dt) => {
    const on = g.current?.() ?? false;
    level.current += ((on ? 1 : 0) - level.current) * (1 - Math.exp(-dt * 8));
    const pulse = 0.8 + 0.2 * Math.sin(clock.elapsedTime * 5);
    const l = level.current;
    const h = HINT[hint];
    coreMat.emissiveIntensity = l * h.core * pulse;
    glowMat.opacity = l * h.halo * pulse;
    zoneMat.opacity = l * h.zone;
  });
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* darker sealer patch, then the glossy sealant over-band on top */}
      <mesh geometry={patch} material={patchMat()} position={[0, 0.001, 0]} receiveShadow />
      <mesh geometry={cuts} material={coreMat} position={[0, 0.0015, 0]} receiveShadow />
      {hint !== 'none' && <mesh geometry={halo} material={glowMat} position={[0, 0.002, 0]} renderOrder={3} />}
      {hint === 'strong' && <mesh geometry={planeGeo(length, width)} material={zoneMat} position={[0, 0.0012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} />}
    </group>
  );
}

function patchMat(): THREE.MeshStandardMaterial {
  return sharedMat(
    'loop:patch',
    () =>
      new THREE.MeshStandardMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0.22,
        roughness: 0.85,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
  );
}

/** Sealant patch material (exported for scenes that draw their own cuts). */
export const loopSealantMaterial = () => markingMat(TRAFFIC_COLORS.loopSealant);
