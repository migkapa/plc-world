/**
 * Slotted PVC wiring duct (Panduit type G style), light gray, narrow-slot fingers on both side
 * walls, snap-on cover with side skirts, optional wires visible inside the duct.
 *
 * Origin: center of the duct's BACK (mounting) face; runs along X (or Y when `vertical`).
 */
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { F, boxGeo, mergedCopies, partsGeo, sharedGeo, uberMat } from '../operator/shared';

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
  // one merged mesh: base, slotted walls, cover with skirts and the conductors lying inside
  const geo = partsGeo(`duct:${length.toFixed(4)}:${width}:${height}:${vertical}:${cover}:${(wires ?? []).join(',')}`, (b) =>
    b.at([0, 0, 0], vertical ? [0, 0, Math.PI / 2] : undefined, (d) => {
      const body = F.matte(DUCT_GRAY, 0.62);
      const coverF = F.matte('#c3c5c0', 0.58);
      d.add(boxGeo(length, width, 0.002), body, [0, 0, 0.001]);
      const wall = wallGeo(length, height - (cover ? 0.002 : 0));
      d.add(wall, body, [0, width / 2 - WALL / 2, 0]);
      d.add(wall, body, [0, -width / 2 + WALL / 2, 0]);
      if (cover)
        d.at([0, 0, height - 0.001], undefined, (c) => {
          c.add(boxGeo(length, width + 0.002, 0.002), coverF);
          c.add(boxGeo(length, 0.0012, 0.006), coverF, [0, width / 2 + 0.0008, -0.003]);
          c.add(boxGeo(length, 0.0012, 0.006), coverF, [0, -width / 2 - 0.0008, -0.003]);
        });
      if (wires && wires.length) {
        // deterministic pseudo-random layout
        let sd = 1234567;
        const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
        const wg = sharedGeo(`duct-wire:${length.toFixed(4)}`, () => new THREE.CylinderGeometry(0.0016, 0.0016, length - 0.004, 8).rotateZ(Math.PI / 2));
        wires.forEach((c, i) => d.add(wg, { color: c, rough: 0.4, metal: 0.02 }, [0, (rnd() - 0.5) * (width - 0.012), 0.004 + (i % 4) * 0.0035 + rnd() * 0.004]));
      }
    }),
  );
  return <mesh geometry={geo} material={uberMat()} position={position} rotation={rotation} scale={scale} castShadow receiveShadow />;
}
