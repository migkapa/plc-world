/**
 * 35 × 7.5 mm top-hat DIN rail (EN 60715 TS35, 199-DR1 style), zinc-plated, slotted web with real
 * slot openings, fastening screws near the ends.
 *
 * Origin: rail center on the mounting surface (backplate), rail runs along X. The clip plane where
 * DIN devices mount is at z = DIN.height. Children are placed in RAIL coordinates: origin on the
 * rail centerline AT THE CLIP PLANE (so a DIN device with position [x, 0, 0] sits on the rail).
 */
import type { ReactNode } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { F, addScrew, boxGeo, partsGeo, roundedRectPath, sharedGeo, sharedMat, uberMat } from '../operator/shared';

export const DIN = {
  width: 0.035,
  height: 0.0075,
  web: 0.027,
  t: 0.001,
  slot: { w: 0.015, h: 0.0052, pitch: 0.025 },
} as const;

/** Depth of the DIN clip plane above the mounting surface. */
export const DIN_RAIL_DEPTH = DIN.height;

export interface DinRailProps extends Placement {
  /** Rail length (m). */
  length: number;
  /** Slotted web (default true). */
  slotted?: boolean;
  /** Draw the fastening screws (default true). */
  screws?: boolean;
  children?: ReactNode;
}

export const railMaterial = () =>
  sharedMat('din-rail-zinc', () => new THREE.MeshStandardMaterial({ color: '#d2d6d9', metalness: 0.7, roughness: 0.36, shadowSide: THREE.BackSide }));

function webGeo(length: number, slotted: boolean) {
  return sharedGeo(`din-web:${length.toFixed(4)}:${slotted}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-length / 2, -DIN.web / 2);
    s.lineTo(length / 2, -DIN.web / 2);
    s.lineTo(length / 2, DIN.web / 2);
    s.lineTo(-length / 2, DIN.web / 2);
    s.closePath();
    if (slotted) {
      const n = Math.floor((length - 0.012) / DIN.slot.pitch);
      const start = -((n - 1) * DIN.slot.pitch) / 2;
      for (let i = 0; i < n; i++) {
        const h = new THREE.Path();
        roundedRectPath(h, start + i * DIN.slot.pitch - DIN.slot.w / 2, -DIN.slot.h / 2, DIN.slot.w, DIN.slot.h, DIN.slot.h / 2);
        s.holes.push(h);
      }
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: DIN.t, bevelEnabled: false, curveSegments: 6 });
    return g;
  });
}

export function DinRail({ length, slotted = true, screws = true, children, position, rotation, scale }: DinRailProps) {
  // one merged mesh: web + side walls + flanges + fastening screws
  const geo = partsGeo(`din-rail:${length.toFixed(4)}:${slotted}:${screws}`, (b) => {
    const zinc = F.metal('#d2d6d9', 0.36);
    zinc.metal = 0.7;
    const sideY = DIN.web / 2 - DIN.t / 2;
    const flangeW = (DIN.width - DIN.web) / 2 + DIN.t;
    const n = Math.floor((length - 0.012) / DIN.slot.pitch);
    const start = -((n - 1) * DIN.slot.pitch) / 2;
    b.add(webGeo(length, slotted), zinc);
    for (const s of [-1, 1]) {
      b.add(boxGeo(length, DIN.t, DIN.height), zinc, [0, s * sideY, DIN.height / 2]);
      b.add(boxGeo(length, flangeW, DIN.t), zinc, [0, s * (DIN.web / 2 + flangeW / 2 - DIN.t), DIN.height - DIN.t / 2]);
    }
    if (screws && slotted && n >= 2) for (const x of [start, start + (n - 1) * DIN.slot.pitch]) addScrew(b, [x, 0, DIN.t], 0.0034, 0.0018);
  });
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geo} material={uberMat()} receiveShadow castShadow />
      {children && <group position={[0, 0, DIN.height]}>{children}</group>}
    </group>
  );
}
