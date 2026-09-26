/**
 * Runtime-safe helpers shared by the headless scene models (`src/sim/scenes/<id>/logic.ts`) and their
 * tests: a seeded PRNG kept in plain scene state, control-value bookkeeping and tiny physics helpers.
 *
 * Headless: no React / DOM / three / test-framework imports (scene logic imports this module directly).
 */
import type { ControlDef } from '../types';

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

/** PRNG state stored inside a scene state object (plain JSON: one uint32). */
export interface RngState {
  seed: number;
}

/** New PRNG state. */
export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

/** mulberry32: advance `rng` and return a float in [0, 1). Deterministic for a given seed. */
export function nextRandom(rng: RngState): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Uniform float in [min, max). */
export function randomRange(rng: RngState, min: number, max: number): number {
  return min + (max - min) * nextRandom(rng);
}

/** Uniform integer in [min, max] (inclusive). */
export function randomInt(rng: RngState, min: number, max: number): number {
  return min + Math.floor(nextRandom(rng) * (max - min + 1));
}

/** Closure form of mulberry32 (handy in tests and for one-off sequences). */
export function mulberry32(seed: number): () => number {
  const rng = createRng(seed);
  return () => nextRandom(rng);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export type ControlValue = boolean | number;

/** Control definitions of one scene, indexed by id. Build once per scene module. */
export interface ControlTable {
  readonly sceneId: string;
  readonly defs: readonly ControlDef[];
  readonly byId: Readonly<Record<string, ControlDef>>;
}

/** Index a scene's control definitions (throws on duplicate ids). */
export function controlTable(sceneId: string, defs: readonly ControlDef[]): ControlTable {
  const byId: Record<string, ControlDef> = {};
  for (const def of defs) {
    if (byId[def.id]) throw new Error(`Duplicate control '${def.id}' in scene '${sceneId}'`);
    byId[def.id] = def;
  }
  return { sceneId, defs, byId };
}

/** Definition of control `id`; throws a descriptive error for unknown ids (catches typos in missions). */
export function controlDef(table: ControlTable, id: string): ControlDef {
  const def = table.byId[id];
  if (!def) throw new Error(`Unknown control '${id}' for scene '${table.sceneId}'`);
  return def;
}

/**
 * Coerce a raw value to the control's type: booleans for push buttons / switches / faults
 * (numbers: non-zero = true), integer position index for selectors, clamped number for analog.
 */
export function coerceControl(def: ControlDef, value: ControlValue): ControlValue {
  if (def.type === 'selector' || def.type === 'analog') {
    let n = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    if (!Number.isFinite(n)) n = Number(def.default);
    if (def.type === 'selector') {
      const max = Math.max(0, (def.positions?.length ?? 1) - 1);
      return clamp(Math.round(n), 0, max);
    }
    return def.range ? clamp(n, def.range[0], def.range[1]) : n;
  }
  return typeof value === 'number' ? value !== 0 : value;
}

/** Fresh control-value object holding every control's default. */
export function defaultControls<C extends object>(table: ControlTable): C {
  const out: Record<string, ControlValue> = {};
  for (const def of table.defs) out[def.id] = coerceControl(def, def.default);
  return out as unknown as C;
}

/** Store a coerced control value; returns the previous value (for edge-triggered actions). */
export function writeControl(table: ControlTable, controls: object, id: string, value: ControlValue): ControlValue {
  const def = controlDef(table, id);
  const record = controls as Record<string, ControlValue>;
  const prev = record[id] ?? coerceControl(def, def.default);
  record[id] = coerceControl(def, value);
  return prev;
}

/** Current value of control `id` (throws for unknown ids). */
export function readControl(table: ControlTable, controls: object, id: string): ControlValue {
  const def = controlDef(table, id);
  return (controls as Record<string, ControlValue>)[id] ?? coerceControl(def, def.default);
}

// ---------------------------------------------------------------------------
// Math / physics helpers
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Move `current` toward `target` by at most `maxDelta` (linear ramp). */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

/** Exact first-order lag step: `current` relaxes toward `target` with time constant `tauS` (seconds). */
export function firstOrder(current: number, target: number, dtS: number, tauS: number): number {
  return tauS <= 0 ? target : current + (target - current) * (1 - Math.exp(-dtS / tauS));
}

/** Wrap an angle to [0, 2π). */
export function wrapAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/**
 * Asymmetric on/off delay (e.g. contactor pull-in / drop-out, auxiliary contact follow).
 * Plain-data state so it can live inside a scene state object.
 */
export interface DelayedContact {
  /** Current (delayed) contact state. */
  on: boolean;
  /** Time the command has disagreed with `on` (ms). */
  pendingMs: number;
}

/** New delayed contact. */
export function createDelayedContact(on = false): DelayedContact {
  return { on, pendingMs: 0 };
}

/** Advance a delayed contact; `onDelayMs` applies to 0→1 changes, `offDelayMs` to 1→0. Returns the new state. */
export function stepDelayedContact(
  c: DelayedContact,
  command: boolean,
  dtMs: number,
  onDelayMs: number,
  offDelayMs: number,
): boolean {
  if (command === c.on) {
    c.pendingMs = 0;
    return c.on;
  }
  c.pendingMs += dtMs;
  if (c.pendingMs >= (command ? onDelayMs : offDelayMs) - 1e-9) {
    c.on = command;
    c.pendingMs = 0;
  }
  return c.on;
}
