/**
 * 800F-style push-button enclosure (surface-mount control station) with N holes in a vertical
 * column: light-gray thermoplastic (or die-cast metal) body, separate cover with 4 captive corner
 * screws, M20 cable gland at the bottom. Yellow cover for E-stop stations.
 *
 * Origin: center of the BACK (mounting) face at the bottom edge; front face at z = depth.
 * Children are placed at the holes in order (top → bottom) unless `autoPlace={false}`; use
 * `pushButtonStationHoles()` for manual placement (hole centers ON the front surface).
 */
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Placement, Vec3 } from '../../contracts';
import { F, addScrew, circleGeo, cylY, latheZ, partsGeo, roundedRectShape, sharedGeo, uberMat } from './shared';

export interface PushButtonStationOptions {
  /** Hole pitch (m), default 0.064 (fits 30 × 50 mm legend plates). */
  pitch?: number;
  /** Outer width (m), default 0.076. */
  width?: number;
  /** Outer depth (m), default 0.07. */
  depth?: number;
  /** Center the device in its cell (for round 60 mm E-stop legends) instead of leaving room for a legend plate above. */
  centered?: boolean;
}

export interface PushButtonStationProps extends Placement, PushButtonStationOptions {
  holes: number;
  variant?: 'plastic' | 'metal';
  /** 'gray' (default) or 'yellow' (E-stop station). */
  color?: 'gray' | 'yellow';
  /** Operators placed in the holes (in order, top → bottom). */
  children?: ReactNode;
  autoPlace?: boolean;
  /** Bottom M20 cable gland with cable stub (default true). */
  gland?: boolean;
  /** Skip rendering the (hidden) behind-panel assemblies of auto-placed operators (default true). */
  hideRear?: boolean;
}

const MARGIN = 0.009;

export function pushButtonStationLayout(holes: number, opts: PushButtonStationOptions = {}) {
  const pitch = opts.pitch ?? 0.064;
  const width = opts.width ?? 0.076;
  const depth = opts.depth ?? 0.07;
  const height = holes * pitch + 2 * MARGIN;
  const holePts: Vec3[] = [];
  for (let i = 0; i < holes; i++) {
    const cellBottom = height - MARGIN - (i + 1) * pitch;
    const y = opts.centered ? cellBottom + pitch / 2 : cellBottom + (pitch - 0.05) / 2 + 0.017;
    holePts.push([0, y, depth]);
  }
  return { width, height, depth, pitch, holes: holePts };
}

/** Hole centers (station-local, on the front surface), top → bottom. */
export function pushButtonStationHoles(holes: number, opts: PushButtonStationOptions = {}): Vec3[] {
  return pushButtonStationLayout(holes, opts).holes;
}

const GRAY = '#cfd1cc';
const YELLOW = '#f2c200';

function glandGeo() {
  return latheZ(
    'm20-gland-dome',
    [
      [0.0048, 0],
      [0.0112, 0],
      [0.0112, 0.004],
      [0.0104, 0.0052],
      [0.0098, 0.0092],
      [0.0078, 0.0118],
      [0.0056, 0.0126],
      [0.0047, 0.0126],
      [0.0047, 0.004],
    ],
    36,
  );
}

/** Rounded-rectangle (XY corners) prism from z = 0 to `depth` (+ optional bevel beyond both ends). */
function stationBodyGeo(w: number, h: number, r: number, depth: number, bevT: number, bevS: number) {
  return sharedGeo(`pbst-body:${w}:${h}:${r}:${depth}:${bevT}:${bevS}`, () => {
    const g = new THREE.ExtrudeGeometry(roundedRectShape(w - 2 * bevS, h - 2 * bevS, Math.max(0.0005, r - bevS)), {
      depth,
      bevelEnabled: bevT > 0,
      bevelThickness: bevT,
      bevelSize: bevS,
      bevelSegments: 3,
      curveSegments: 6,
    });
    return g;
  });
}

/** Thin dark band around the body at the cover parting plane (0.4 mm hairline). */
function partingGeo(w: number, h: number, r: number) {
  return sharedGeo(`pbst-parting:${w}:${h}:${r}`, () => {
    const s = roundedRectShape(w + 0.0002, h + 0.0002, r + 0.0001);
    s.holes.push(roundedRectShape(w - 0.003, h - 0.003, Math.max(0.0005, r - 0.0015)) as unknown as THREE.Path);
    return new THREE.ExtrudeGeometry(s, { depth: 0.0004, bevelEnabled: false, curveSegments: 6 });
  });
}

export function PushButtonStation({
  holes,
  variant = 'plastic',
  color = 'gray',
  children,
  autoPlace = true,
  gland = true,
  hideRear = true,
  pitch,
  width,
  depth,
  centered,
  position,
  rotation,
  scale,
}: PushButtonStationProps) {
  const L = pushButtonStationLayout(holes, { pitch, width, depth, centered });
  const W = L.width;
  const H = L.height;
  const D = L.depth;
  const coverT = variant === 'metal' ? 0.014 : 0.011;
  const r = variant === 'metal' ? 0.007 : 0.0045;
  const baseColor = color === 'yellow' && variant === 'metal' ? YELLOW : variant === 'metal' ? '#b9bcbc' : GRAY;
  const coverColor = color === 'yellow' ? YELLOW : variant === 'metal' ? '#b9bcbc' : GRAY;
  const kids = Children.toArray(children).map((c) =>
    hideRear && isValidElement(c) && typeof c.type === 'function' ? cloneElement(c as ReactElement<{ rear?: boolean }>, { rear: false }) : c,
  );
  const sx = W / 2 - 0.0072;
  const sy = 0.0072;
  const staticGeo = partsGeo(`pbstation:${W}:${H}:${D}:${variant}:${color}:${gland}`, (b) => {
    const baseF = F.matte(baseColor, variant === 'metal' ? 0.45 : 0.55);
    const coverF = F.matte(coverColor, variant === 'metal' ? 0.42 : 0.5);
    const zp = D - coverT; // parting plane
    // base: rounded vertical corners, square front edge (hidden under the cover's flush joint)
    b.add(stationBodyGeo(W, H, r, zp, 0, 0), baseF, [0, H / 2, 0]);
    // cover: rounded outer (front) edges only; its back bevel is buried inside the base
    const bev = Math.min(r * 0.8, 0.004);
    b.add(stationBodyGeo(W, H, r, coverT - bev, bev, bev), coverF, [0, H / 2, zp]);
    // hairline parting gap (dark gray, lit)
    b.add(partingGeo(W, H, r), F.matte('#3b3c3b', 0.8), [0, H / 2, zp - 0.0002]);
    // captive cover screws in recessed pockets
    for (const [x, y] of [
      [-sx, sy],
      [sx, sy],
      [-sx, H - sy],
      [sx, H - sy],
    ] as [number, number][]) {
      b.add(circleGeo(0.0036, 24), F.matte(coverColor === YELLOW ? '#c99f00' : '#9fa29f', 0.6), [x, y, D + 0.00005]);
      addScrew(b, [x, y, D - 0.0004], 0.0028, 0.0012);
    }
    // bottom M20 cable gland (axis pointing down) with cable stub
    if (gland)
      b.at([0, 0, D * 0.45], [Math.PI / 2, 0, 0], (g) => {
        g.add(sharedGeo('m20-gland-hex', () => new THREE.CylinderGeometry(0.0125, 0.0125, 0.005, 6).rotateX(Math.PI / 2)), F.matte('#1b1b1b', 0.5), [0, 0, 0.0025]);
        g.add(glandGeo(), F.matte('#1b1b1b', 0.5), [0, 0, 0.005]);
        g.add(cylY(0.0046, 0.0046, 0.06, 20), F.matte('#2a2a2a', 0.7), [0, 0, 0.04], [Math.PI / 2, 0, 0]);
      });
  });
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={staticGeo} material={uberMat()} castShadow receiveShadow />
      {autoPlace
        ? kids.map((child, i) =>
            i < L.holes.length ? (
              <group key={i} position={L.holes[i]}>
                {child}
              </group>
            ) : null,
          )
        : children}
    </group>
  );
}
