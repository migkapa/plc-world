/**
 * Compact 5000 (5069) mechanical constants, terminal layout and catalog styles shared by the module, the
 * controller (same housing family) and the field-wiring builder.
 */
import { profileGeometry } from './geometry';

export type Module5069Catalog = '5069-IB16' | '5069-OB16' | '5069-IF8' | '5069-OF4';

export const M5069 = {
  width: 0.022,
  height: 0.14457,
  depth: 0.10542,
  /** Housing front (behind the RTB). */
  bodyFront: 0.0795,
  /** Indicator head (top) front face. */
  headBottom: 0.1062,
  rtbBottom: 0.0045,
  rtbTop: 0.1032,
  rtbFront: 0.1038,
  /** Depth of the wire-entry / screw-well recesses in the RTB front. */
  rtbRecess: 0.0015,
} as const;

/** Housing side profile (z, y): body + indicator head at the top. */
export const HOUSING_PROFILE: Array<[number, number]> = [
  [0, 0.002],
  [0.002, 0],
  [M5069.bodyFront, 0],
  [M5069.bodyFront, M5069.rtbTop + 0.0005],
  [M5069.depth - 0.004, M5069.rtbTop + 0.0005],
  [M5069.depth - 0.0005, M5069.headBottom],
  [M5069.depth, M5069.headBottom + 0.001],
  [M5069.depth, M5069.height - 0.0055],
  [M5069.depth - 0.005, M5069.height],
  [0.004, M5069.height],
  [0, M5069.height - 0.003],
];

export function housingGeometry(width: number = M5069.width) {
  return profileGeometry('5069-housing', HOUSING_PROFILE, width, 0.0005);
}

export const RTB_H = M5069.rtbTop - M5069.rtbBottom;
/** Indicator head face height. */
export const HEAD_H = M5069.height - 0.0055 - M5069.headBottom - 0.001;
export const HEAD_Y0 = M5069.headBottom + 0.001;

/** RTB terminal layout: 2 columns × 9 rows, terminal n → (col = n % 2, row = floor(n / 2) from the top). */
export function rtbTerminal(n: number): { u: number; v: number; col: number; row: number } {
  const col = n % 2;
  const row = Math.floor(n / 2);
  const pitch = RTB_H / 9;
  return { u: col === 0 ? -0.005 : 0.005, v: M5069.rtbTop - pitch * (row + 0.5), col, row };
}

/** Screw well (round) and wire entry (square funnel) centers relative to the terminal center (m). */
export const WELL = { dy: 0.0019, r: 0.00205 } as const;
export const ENTRY = { dy: -0.00225, w: 0.0035, h: 0.0033 } as const;

export interface CatalogStyle {
  kind: 'DI' | 'DO' | 'AI' | 'AO';
  points: number;
  title: string;
  sub: string;
  band: string;
  terminals: string[];
}

const DIG_TERMS = Array.from({ length: 16 }, (_, i) => String(i));

export const STYLES: Record<Module5069Catalog, CatalogStyle> = {
  '5069-IB16': { kind: 'DI', points: 16, title: 'IB16', sub: '24V DC SINK IN', band: '#2f6fd6', terminals: DIG_TERMS.concat(['COM', 'COM']) },
  '5069-OB16': { kind: 'DO', points: 16, title: 'OB16', sub: '24V DC SRC OUT', band: '#2f6fd6', terminals: DIG_TERMS.concat(['SA-', 'SA-']) },
  '5069-IF8': {
    kind: 'AI',
    points: 8,
    title: 'IF8',
    sub: 'ANALOG IN 8',
    band: '#2e9e4f',
    terminals: Array.from({ length: 8 }, (_, i) => [`I${i}+`, `I${i}-`]).flat().concat(['RTN', 'SHLD']),
  },
  '5069-OF4': {
    kind: 'AO',
    points: 4,
    title: 'OF4',
    sub: 'ANALOG OUT 4',
    band: '#2e9e4f',
    terminals: Array.from({ length: 4 }, (_, i) => [`V${i}+`, `I${i}+`, `RT${i}`, `-`]).flat().concat(['SA+', 'SA-']),
  },
};

/** Duct target for field wiring, in the MODULE's local coordinates. */
export interface DuctTarget {
  /** y of the duct top wall (wires enter the finger slots here). */
  top: number;
  /** z range of the duct opening (between base and cover). */
  zMin: number;
  zMax: number;
  /** Slot centers: x = phase + k * pitch. */
  pitch: number;
  phase: number;
}
