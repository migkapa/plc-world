/**
 * Mission authoring helpers: concise builders for test steps and the wrong-answer file format.
 * Using them is optional — plain `TestStep` objects work just as well. Headless.
 *
 *   steps: [
 *     wait(300),
 *     tap('start'),
 *     expectObs('contactor', true, 'Start must pull in the contactor', { within: 150 }),
 *     expectObs('contactor', true, 'The motor must keep running after Start is released (seal-in)', { for: 2000 }),
 *   ]
 */
import type { TagDef } from '../../plc/types';
import type { TestStep } from '../types';

/** Timing options of an expect step. */
export interface ExpectTiming {
  /** Keep simulating up to `within` ms until the condition holds. */
  within?: number;
  /** The condition must then hold continuously for `for` ms. */
  for?: number;
}

type ExpectStep = Extract<TestStep, { do: 'expect' }>;

/** Let `ms` of simulated time pass. */
export const wait = (ms: number): TestStep => ({ do: 'wait', ms });

/** Set a scene control (maintained switch, selector position, fault injection, analog value...). */
export const set = (id: string, value: boolean | number): TestStep => ({ do: 'control', id, value });

/** Press a momentary control for `ms` (default 200 ms) and release it. */
export const tap = (id: string, ms?: number): TestStep => (ms === undefined ? { do: 'tap', id } : { do: 'tap', id, ms });

/** Hold a momentary control (remember to release it with `release`). */
export const press = (id: string): TestStep => ({ do: 'control', id, value: true });

/** Release a held momentary control. */
export const release = (id: string): TestStep => ({ do: 'control', id, value: false });

/** Controller mode change (key stays in REM): 'PROG' stops the logic, 'RUN' prescans and runs again. */
export const mode = (m: 'PROG' | 'RUN'): TestStep => ({ do: 'mode', mode: m });

function timing(t: ExpectTiming | undefined): Pick<ExpectStep, 'within' | 'for'> {
  const out: Pick<ExpectStep, 'within' | 'for'> = {};
  if (t?.within !== undefined) out.within = t.within;
  if (t?.for !== undefined) out.for = t.for;
  return out;
}

/** Expect a scene observable to equal a value. */
export function expectObs(id: string, equals: boolean | number, message: string, t?: ExpectTiming): TestStep {
  return { do: 'expect', observe: id, equals, message, ...timing(t) };
}

/** Expect a scene observable within [min, max] (either bound optional). */
export function expectObsRange(
  id: string,
  range: { min?: number; max?: number },
  message: string,
  t?: ExpectTiming,
): TestStep {
  return { do: 'expect', observe: id, ...range, message, ...timing(t) };
}

/** Expect a controller tag (alias, member or bit operand) to equal a value. */
export function expectTag(tag: string, equals: boolean | number, message: string, t?: ExpectTiming): TestStep {
  return { do: 'expect', tag, equals, message, ...timing(t) };
}

/** Expect a controller tag within [min, max] (either bound optional). */
export function expectTagRange(
  tag: string,
  range: { min?: number; max?: number },
  message: string,
  t?: ExpectTiming,
): TestStep {
  return { do: 'expect', tag, ...range, message, ...timing(t) };
}

// ---------------------------------------------------------------------------
// Wrong answers (test-only files: src/game/missions/chN.wrong.ts)
// ---------------------------------------------------------------------------

/**
 * A plausible WRONG program for a mission. The generic suite (src/game/missions.test.ts) requires every
 * wrong answer to verify (compile) and to FAIL at least one of the mission's tests — proof that the
 * tests catch that mistake. `why` documents the mistake (and ideally which test catches it).
 */
export interface WrongAnswer {
  rungs: string[];
  /** Extra tags the wrong program needs (mission starter/solution tags are always present). */
  tags?: TagDef[];
  why?: string;
}

/** Mission id -> wrong programs (plain rung arrays or WrongAnswer objects). */
export type WrongAnswerSet = Record<string, ReadonlyArray<string[] | WrongAnswer>>;

/** Normalize a wrong-answer entry. */
export function normalizeWrongAnswer(w: string[] | WrongAnswer): WrongAnswer {
  return Array.isArray(w) ? { rungs: w } : w;
}
