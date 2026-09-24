/**
 * Layout of the `motor-station` bay (world meters, Y up, camera side = +Z). Plain data, no React.
 *
 *   back wall (z = -2.9) ── cabinet MCP-101 (left) · conveyor wall opening (x ≈ 0) · remote-run station
 *   conveyor runs along +Z from the opening (tail) to the head at z = 0; drive platform on its +X side
 *   motor (5 HP, 184T) → coupling guard → inline reducer → coupling guard → head pulley shaft
 *   pedestal push-button station at (1.8, 0.95); disconnect on a strut stanchion; overhead ladder tray.
 */
import type { Vec3 } from '../../../twin/contracts';

export const BAY = {
  wallZ: -2.9,
  wallT: 0.2,
  leftX: -4.4,
  rightX: 4.8,
  frontZ: 4.4,
  height: 5.2,
} as const;

/** Wall opening the conveyor comes through (upstream line). */
export const OPENING = { x0: -0.55, x1: 0.55, y1: 1.42 } as const;

/** Belt conveyor: tail pulley at z0, head pulley at z0 + length (= HEAD_Z). */
export const CONV = { x: 0, z0: -3.3, length: 3.3, width: 0.5, height: 0.85 } as const;
export const HEAD_Z = CONV.z0 + CONV.length;
/** Head pulley axis height (conveyor height − belt thickness − pulley radius). */
export const AXIS_Y = CONV.height - 0.005 - 0.057;
/** Head pulley radius incl. belt (for the output shaft angle). */
export const PULLEY_R = 0.062;
/** Drive-side outer face of the conveyor side frame. */
export const FRAME_X = CONV.width / 2 + 0.022 + 0.04;

export const DRIVE = {
  deck: { x0: 0.33, x1: 1.3, z0: -0.25, z1: 0.3, top: 0.658, t: 0.012 },
  reducer: { x0: 0.45, x1: 0.66, h: 0.21, d: 0.19 },
  /** Motor origin (under the feet, NEMA 184T) — shaft end at x = 0.74. */
  motor: [0.97, 0.6737, HEAD_Z] as Vec3,
  shim: { x0: 0.85, x1: 1.09, z0: -0.14, z1: 0.2 },
  /** Reducer ratio (motor rpm / head pulley rpm), visual only. */
  ratio: 22.6,
} as const;

/** Wall-mounted control cabinet: Enclosure origin (back-bottom-center) and size. */
export const CABINET = { pos: [-2.2, 0.75, BAY.wallZ] as Vec3, size: [0.8, 1.0, 0.3] as Vec3 };

/** Pedestal push-button station (post center on the floor). */
export const PEDESTAL = { x: 1.8, z: 0.95, plateY0: 1.0, plateY1: 1.4 } as const;

/** Strut stanchion with the local disconnect switch. */
export const STANCHION = { x: 1.45, z: 0.3 } as const;

/** Overhead ladder tray: along the back wall, then out over the machine at x = runX. */
export const TRAY = { y: 2.55, wallZ: -2.73, x0: -2.75, x1: 1.62, runX: 1.45, z1: 1.2, width: 0.3 } as const;

/** Upstream "remote run" interface station on the wall next to the opening. */
export const REMOTE = { x: 0.95, y: 1.18 } as const;

/** Discharge bin (gaylord on a pallet) under the head end. */
export const BIN = { x: 0, z: 0.62, w: 0.95, d: 0.78, h: 0.55, pallet: 0.14 } as const;
