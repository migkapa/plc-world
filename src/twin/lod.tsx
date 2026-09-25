/**
 * Distance / screen-size level of detail for heavy device assemblies (racks, cabinet interiors, cars).
 *
 *   <DistanceLod minPixels={90} size={0.37} near={<LiveRack/>} far={<RackImpostor/>} />
 *   <DistanceLod distance={6} near={…} far={…} />
 *
 * Both children stay MOUNTED (a live model keeps its per-frame state and its hooks); only visibility swaps, with
 * 15 % hysteresis so the switch never flickers. The criterion is either a fixed camera `distance` (m) or the
 * projected size: `near` is shown while an object `size` meters across covers at least `minPixels` CSS pixels
 * of the canvas height (perspective camera), which adapts to the canvas size (thumbnail vs. full screen) and to
 * the field of view.
 */
import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import * as THREE from 'three';

const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

export interface DistanceLodProps {
  near: ReactNode;
  far: ReactNode;
  /** Switch at this camera distance (m). */
  distance?: number;
  /** …or when an object `size` meters across shrinks below `minPixels` on screen. */
  minPixels?: number;
  /** Characteristic size (m) for `minPixels` (e.g. the rack width). */
  size?: number;
}

/** Camera distance (m) at which an object `size` m across covers `px` CSS pixels of a `heightPx` tall canvas. */
export function distanceForPixels(size: number, px: number, fovDeg: number, heightPx: number): number {
  const t = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  return (size * heightPx) / (2 * t * Math.max(1, px));
}

export function DistanceLod({ near, far, distance, minPixels, size = 1 }: DistanceLodProps) {
  const root = useRef<THREE.Group>(null);
  const n = useRef<THREE.Group>(null);
  const f = useRef<THREE.Group>(null);
  const isNear = useRef(true);
  useFrame(({ camera, size: view }) => {
    const g = root.current;
    if (!g || !n.current || !f.current) return;
    let limit = distance ?? Infinity;
    if (minPixels !== undefined) {
      const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 40;
      limit = Math.min(limit, distanceForPixels(size, minPixels, fov, view.height));
    }
    g.getWorldPosition(_p);
    camera.getWorldPosition(_c);
    const d = _p.distanceTo(_c);
    const want = isNear.current ? d < limit * 1.15 : d < limit;
    if (want !== isNear.current || n.current.visible !== want) {
      isNear.current = want;
      n.current.visible = want;
      f.current.visible = !want;
    }
  });
  return (
    <group ref={root}>
      <group ref={n}>{near}</group>
      <group ref={f} visible={false}>
        {far}
      </group>
    </group>
  );
}
