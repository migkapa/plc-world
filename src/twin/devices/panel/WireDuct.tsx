/**
 * Slotted PVC wiring duct (Panduit type G style), light gray, narrow-slot fingers on both side
 * walls, snap-on cover with side skirts, optional wires visible inside the duct.
 *
 * Origin: center of the duct's BACK (mounting) face; runs along X (or Y when `vertical`).
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { boxGeo, mats, mergedCopies, sharedGeo } from '../operator/shared';

export interface WireDuctProps extends Placement {
  length: number;
  /** Duct width in the panel plane (m), default 0.04. */
  width?: number;
  /** Duct height out of the panel (m), default 0.06. */
  height?: number;
  /** Run along Y instead of X. */
  vertical?: boolean;
  /** Snap-on cover (default true). */
  cover?: boolean;
  /** Colors of wires lying in the duct (visible through the slots / with the cover off). */
  wires?: string[];
}

export const DUCT_GRAY = '#b9bbb6';
const WALL = 0.0018;
const FINGER = 0.0062;
const SLOT = 0.0042;

function wallGeo(length: number, height: number) {
  const pitch = FINGER + SLOT;
  const n = Math.max(1, Math.floor(length / pitch));
  const base = Math.min(0.012, height * 0.25);
  const fingerH = height - base;
  return mergedCopies(
    `duct-wall:${length.toFixed(4)}:${height.toFixed(4)}`,
    () => boxGeo(1, 1, 1).clone(),
    () => {
      const out: THREE.Matrix4[] = [];
      // base strip
      out.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0, base / 2), new THREE.Quaternion(), new THREE.Vector3(length, WALL, base)));
      const start = -((n - 1) * pitch) / 2;
      for (let i = 0; i < n; i++) {
        out.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(start + i * pitch, 0, base + fingerH / 2),
            new THREE.Quaternion(),
            new THREE.Vector3(FINGER, WALL, fingerH),
          ),
        );
      }
      return out;
    },
  );
}

export function WireDuct({ length, width = 0.04, height = 0.06, vertical = false, cover = true, wires, position, rotation, scale }: WireDuctProps) {
  const mat = mats.matte(DUCT_GRAY, 0.62);
  const coverMat = mats.matte('#c3c5c0', 0.58);
  const wireList = useMemo(() => {
    if (!wires || wires.length === 0) return [];
    // deterministic pseudo-random layout
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return wires.map((c, i) => ({ c, y: (rnd() - 0.5) * (width - 0.012), z: 0.004 + (i % 4) * 0.0035 + rnd() * 0.004 }));
  }, [wires, width]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group rotation={vertical ? [0, 0, Math.PI / 2] : undefined}>
        {/* bottom */}
        <mesh geometry={boxGeo(length, width, 0.002)} material={mat} position={[0, 0, 0.001]} receiveShadow />
        {/* slotted side walls */}
        <mesh geometry={wallGeo(length, height - (cover ? 0.002 : 0))} material={mat} position={[0, width / 2 - WALL / 2, 0]} castShadow receiveShadow />
        <mesh geometry={wallGeo(length, height - (cover ? 0.002 : 0))} material={mat} position={[0, -width / 2 + WALL / 2, 0]} castShadow receiveShadow />
        {cover && (
          <group position={[0, 0, height - 0.001]}>
            <mesh geometry={boxGeo(length, width + 0.002, 0.002)} material={coverMat} castShadow />
            <mesh geometry={boxGeo(length, 0.0012, 0.006)} material={coverMat} position={[0, width / 2 + 0.0008, -0.003]} />
            <mesh geometry={boxGeo(length, 0.0012, 0.006)} material={coverMat} position={[0, -width / 2 - 0.0008, -0.003]} />
          </group>
        )}
        {wireList.map((w, i) => (
          <mesh
            key={i}
            geometry={sharedGeo(`duct-wire:${length.toFixed(4)}`, () => new THREE.CylinderGeometry(0.0016, 0.0016, length - 0.004, 8).rotateZ(Math.PI / 2))}
            material={mats.matte(w.c, 0.5)}
            position={[0, w.y, w.z]}
          />
        ))}
      </group>
    </group>
  );
}
