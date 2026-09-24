/**
 * Continuations for the cables that a `wired` <ControlLogixRack> draws hanging below its modules (RTB
 * spiral-wrap sleeves, controller / EN2T patch cables, the power-supply mains cord): each one is carried
 * down and back into the top of the wire duct under the rack, so no cable ends in mid-air.
 *
 * Returns wires for the panel `<Wires>` component (one merged draw call), in the same coordinates as the
 * rack's `position` (backplate coordinates). Geometry constants mirror src/twin/devices/plc/controllogix
 * (MOD_Y0 / MOD_Z0, RTB sleeve, PatchCable, PS cord) — plain data, no React.
 */
import type { HardwareConfig } from '../../../plc/types';
import type { Vec3 } from '../../../twin/contracts';
import { catalogKind } from '../../../twin/live';

/** Rack-local cable ends (relative to the rack origin: back-bottom-center of the chassis). */
const MOD_Y0 = 0.009;
const MOD_Z0 = 0.004;
const RTB_SLEEVE = { yEnd: MOD_Y0 - 0.1, z: MOD_Z0 + 0.1305, r: 0.0046, color: '#16171a' } as const;
const PATCH = { yEnd: MOD_Y0 - 0.115, z: MOD_Z0 + 0.1288, r: 0.0029 } as const;
const PS_CORD = { yEnd: MOD_Y0 - 0.095, z: MOD_Z0 + 0.138 - 0.016 + 0.0075, r: 0.0055, color: '#8d9196' } as const;

export interface RackRunOpts {
  hardware: HardwareConfig;
  /** From controlLogixChassisLayout(). */
  layout: { width: number; psCenterX: number; slotCenterX(slot: number): number };
  /** Rack position (backplate coords). */
  rackX: number;
  rackY: number;
  /** Top edge (Y) of the duct the cables drop into, and the duct depth (Z) of its open fingers. */
  ductTop: number;
  ductZ?: number;
}

export function rackCableRuns({ hardware, layout, rackX, rackY, ductTop, ductZ = 0.03 }: RackRunOpts): { points: Vec3[]; color: string; radius: number }[] {
  const out: { points: Vec3[]; color: string; radius: number }[] = [];
  const x0 = rackX - layout.width / 2;
  const run = (x: number, yEnd: number, z: number, r: number, color: string) => {
    const y = rackY + yEnd;
    const drop = y - ductTop;
    out.push({
      color,
      radius: r,
      points: [
        [x, y + 0.012, z],
        [x, y - Math.min(0.006, drop * 0.25), z],
        [x, ductTop + drop * 0.35, (z + ductZ) / 2 + 0.012],
        [x, ductTop + 0.006, ductZ + 0.004],
        [x, ductTop - 0.012, ductZ],
      ],
    });
  };
  run(x0 + layout.psCenterX, PS_CORD.yEnd, PS_CORD.z, PS_CORD.r, PS_CORD.color);
  for (const m of hardware.modules) {
    const x = x0 + layout.slotCenterX(m.slot);
    const k = catalogKind(m.catalog);
    if (k === 'DI' || k === 'DO' || k === 'AI' || k === 'AO') run(x, RTB_SLEEVE.yEnd, RTB_SLEEVE.z, RTB_SLEEVE.r, RTB_SLEEVE.color);
    else if (k === 'CPU') run(x, PATCH.yEnd, PATCH.z, PATCH.r, '#2f9d62');
    else if (k === 'COMM') run(x, PATCH.yEnd, PATCH.z, PATCH.r, '#1f63d6');
  }
  return out;
}
