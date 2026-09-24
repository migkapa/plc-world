/**
 * ControlLogix 1756 physical dimensions (meters).
 *
 * Sources: 1756-TD006 (chassis), 1756-TD005 (power supplies), distributor spec sheets.
 *  - Slot pitch 35 mm (1.38 in); module ~140 mm tall x ~145 mm deep (incl. RTB).
 *  - Chassis overall widths: A4 263 mm, A7 367.6 mm, A10 483 mm, A13 588 mm, A17 738 mm;
 *    body height 158 mm (169 mm across the mounting tabs); depth 145 mm with modules installed.
 *  - 1756-PA72 / PB72 / PA75: 140 x 112 x 145 mm (H x W x D), installed on the LEFT end of the chassis.
 *
 * Chassis coordinates: origin back-bottom-left of the chassis body, +X right, +Y up, +Z out of the front.
 * Module coordinates: origin back-bottom-center of the module (the backplane connector face).
 */
export type ChassisCatalog = '1756-A4' | '1756-A7' | '1756-A10' | '1756-A13' | '1756-A17';
export type PowerSupplyCatalog = '1756-PA72' | '1756-PB72' | '1756-PA75';

export const CHASSIS_SPECS: Record<ChassisCatalog, { slots: number; width: number }> = {
  '1756-A4': { slots: 4, width: 0.263 },
  '1756-A7': { slots: 7, width: 0.3676 },
  '1756-A10': { slots: 10, width: 0.483 },
  '1756-A13': { slots: 13, width: 0.588 },
  '1756-A17': { slots: 17, width: 0.738 },
};

export const SLOT_PITCH = 0.035;
/** Chassis body height (without mounting tabs). */
export const CHASSIS_H = 0.158;
/** Mounting tab protrusion above/below the body. */
export const TAB_H = 0.0055;
/** Steel thickness. */
export const SHEET = 0.0012;
/** Z of the front edge of the chassis top/bottom shelves. */
export const SHELF_Z = 0.124;
/** Bottom / top shelf planes (module envelope between them). */
export const SHELF_BOTTOM_Y = 0.0085;
export const SHELF_TOP_Y = 0.1495;

/** Module envelope. */
export const MOD_W = 0.0336;
export const MOD_H = 0.14;
/** Module bottom Y in chassis coordinates. */
export const MOD_Y0 = SHELF_BOTTOM_Y + 0.0005;
/** Backplane (module back) Z in chassis coordinates. */
export const MOD_Z0 = 0.004;
/** Module housing (main body) depth, from the backplane. */
export const MOD_BODY_D = 0.112;
/** Front of the indicator head / controller front face (module-local z). */
export const MOD_FRONT_Z = 0.134;
/** RTB housing & door (module-local). */
export const RTB_TOP_Y = 0.1035;
export const RTB_BOTTOM_Y = 0.002;
export const RTB_FRONT_Z = 0.1375;
export const DOOR_T = 0.0016;

/** Power supply body. */
export const PS_W = 0.112;
export const PS_FRONT_Z = 0.138;

export interface ChassisLayout {
  catalog: ChassisCatalog;
  slots: number;
  width: number;
  /** Left edge of the power-supply bay. */
  psX0: number;
  /** Center X of the power supply. */
  psCenterX: number;
  /** Left edge of slot 0. */
  slot0X: number;
  slotCenterX(slot: number): number;
}

const layoutCache = new Map<ChassisCatalog, ChassisLayout>();

export function chassisLayout(catalog: ChassisCatalog = '1756-A7'): ChassisLayout {
  const hit = layoutCache.get(catalog);
  if (hit) return hit;
  const spec = CHASSIS_SPECS[catalog] ?? CHASSIS_SPECS['1756-A7'];
  const leftover = spec.width - PS_W - spec.slots * SLOT_PITCH;
  // Base end walls ~5 mm left / ~6 mm right; larger chassis spread the extra width over both ends.
  const extra = Math.max(0, leftover - 0.011) / 2;
  const psX0 = 0.005 + extra;
  const slot0X = psX0 + PS_W;
  const l: ChassisLayout = {
    catalog,
    slots: spec.slots,
    width: spec.width,
    psX0,
    psCenterX: psX0 + PS_W / 2,
    slot0X,
    slotCenterX: (slot: number) => slot0X + (slot + 0.5) * SLOT_PITCH,
  };
  layoutCache.set(catalog, l);
  return l;
}

/** All ControlLogix dimensions in one namespace (for scene layout code). */
export const CLX = {
  CHASSIS_SPECS,
  SLOT_PITCH,
  CHASSIS_H,
  TAB_H,
  SHELF_Z,
  SHELF_BOTTOM_Y,
  SHELF_TOP_Y,
  MOD_W,
  MOD_H,
  MOD_Y0,
  MOD_Z0,
  MOD_FRONT_Z,
  RTB_FRONT_Z,
  PS_W,
  PS_FRONT_Z,
  /** Approx. installed depth incl. RTB doors (m). */
  DEPTH: 0.146,
} as const;
