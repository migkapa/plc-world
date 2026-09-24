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
import { boxGeo, circleGeo, cylY, latheZ, mats, roundedBox, sharedGeo, Screw } from './shared';

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
  const baseMat = variant === 'metal' ? mats.matte(baseColor, 0.45) : mats.matte(baseColor, 0.55);
  const coverMat = variant === 'metal' ? mats.matte(coverColor, 0.42) : mats.matte(coverColor, 0.5);
  const kids = Children.toArray(children).map((c) =>
    hideRear && isValidElement(c) && typeof c.type === 'function' ? cloneElement(c as ReactElement<{ rear?: boolean }>, { rear: false }) : c,
  );
  const sx = W / 2 - 0.0072;
  const sy = 0.0072;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* base */}
      <mesh geometry={roundedBox(W, H, D - coverT, r, 3)} material={baseMat} position={[0, H / 2, (D - coverT) / 2]} castShadow receiveShadow />
      {/* parting line shadow */}
      <mesh geometry={boxGeo(W - 0.003, H - 0.003, 0.0012)} material={mats.dark()} position={[0, H / 2, D - coverT]} />
      {/* cover */}
      <mesh geometry={roundedBox(W + 0.0004, H + 0.0004, coverT - 0.0004, r, 3)} material={coverMat} position={[0, H / 2, D - coverT / 2 + 0.0002]} castShadow receiveShadow />
      {/* captive cover screws in recessed pockets */}
      {[
        [-sx, sy],
        [sx, sy],
        [-sx, H - sy],
        [sx, H - sy],
      ].map(([x, y], i) => (
        <group key={i} position={[x!, y!, D]}>
          <mesh geometry={circleGeo(0.0036, 24)} material={mats.matte(coverColor === YELLOW ? '#c99f00' : '#9fa29f', 0.6)} position={[0, 0, 0.00005]} />
          <Screw position={[0, 0, -0.0004]} r={0.0028} h={0.0012} />
        </group>
      ))}
      {/* bottom cable gland (axis pointing down) */}
      {gland && (
        <group position={[0, 0, D * 0.45]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh geometry={sharedGeo('m20-gland-hex', () => new THREE.CylinderGeometry(0.0125, 0.0125, 0.005, 6).rotateX(Math.PI / 2))} material={mats.matte('#1b1b1b', 0.5)} position={[0, 0, 0.0025]} />
          <mesh geometry={glandGeo()} material={mats.matte('#1b1b1b', 0.5)} position={[0, 0, 0.005]} castShadow />
          <mesh geometry={cylY(0.0046, 0.0046, 0.06, 20)} material={mats.matte('#2a2a2a', 0.7)} position={[0, 0, 0.04]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      )}
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
