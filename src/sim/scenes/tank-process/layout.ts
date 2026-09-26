/**
 * Shared layout constants of the `tank-process` twin (tank-local coordinates sit on the skid deck: world = tank
 * coordinates + (0, SKID_H, 0)).
 */
import { tankLayout } from '../../../twin/devices';

export const TANK_D = 1.3;
export const TANK_H = 1.25;
export const TL = tankLayout(TANK_D, TANK_H);
/** The process skid lifts the tank this much off the floor (= top of the checker-plate deck). */
export const SKID_H = 0.12;
/** Skid footprint (x × z) and deck top (world y). */
export const SKID = { w: 2.3, d: 2.1, deckTop: SKID_H } as const;
/** z of the inlet line / valve station (same as the inlet nozzle). */
export const ZI = TL.nozzles.inlet.position[2];
