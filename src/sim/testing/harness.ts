/**
 * Test harness around one scene: scene state + strict FakeIo + a fixed 10 ms step loop.
 *
 * Each fixed step mirrors the real runtime order: `scene.step()` (field → input image) followed by the
 * optional `plc` callback, which plays the role of the controller scan by reading `io` inputs and
 * setting `io` outputs for the next step.
 */
import type { SceneLogic } from '../types';
import { FakeIo } from './fakeIo';

/** Emulated controller scan: read inputs from `io`, set outputs with `io.setOutput()`. */
export type FakePlc = (io: FakeIo, timeMs: number) => void;

export interface SceneHarness<S> {
  readonly logic: SceneLogic<S>;
  readonly state: S;
  readonly io: FakeIo;
  /** Simulated time (ms). */
  readonly timeMs: number;
  /** Fixed step (ms). */
  readonly stepMs: number;
  /** Emulated PLC scan run after each scene step (null = outputs only change via `out()`). */
  plc: FakePlc | null;
  /** One fixed step. */
  step(): void;
  /** Advance `ms` of simulated time in fixed steps; `each` runs after every step. */
  run(ms: number, each?: () => void): void;
  /** Step until `cond` holds (checked after each step); returns the elapsed ms, or throws after `maxMs`. */
  runUntil(cond: () => boolean, maxMs: number, message?: string): number;
  set(id: string, value: boolean | number): void;
  get(id: string): boolean | number;
  /** Press a momentary control, run `ms`, release it. */
  tap(id: string, ms?: number): void;
  /** Drive an output (alias or operand). */
  out(aliasOrOperand: string, value: boolean | number): void;
  /** Read an input written by the scene (alias or operand). */
  inBool(aliasOrOperand: string): boolean;
  inNum(aliasOrOperand: string): number;
  observe(): Record<string, boolean | number>;
  obs(id: string): boolean | number;
  obsNum(id: string): number;
}

export interface HarnessOptions {
  stepMs?: number;
  plc?: FakePlc;
}

/** Build a harness with a fresh `createState()`. */
export function createHarness<S>(logic: SceneLogic<S>, opts: HarnessOptions = {}): SceneHarness<S> {
  const state = logic.createState();
  const io = new FakeIo(logic.io);
  const stepMs = opts.stepMs ?? 10;
  let timeMs = 0;

  const h: SceneHarness<S> = {
    logic,
    state,
    io,
    stepMs,
    plc: opts.plc ?? null,
    get timeMs() {
      return timeMs;
    },
    step() {
      logic.step(state, stepMs, io);
      timeMs += stepMs;
      h.plc?.(io, timeMs);
    },
    run(ms, each) {
      const n = Math.round(ms / stepMs);
      for (let i = 0; i < n; i++) {
        h.step();
        each?.();
      }
    },
    runUntil(cond, maxMs, message) {
      const start = timeMs;
      while (timeMs - start < maxMs) {
        h.step();
        if (cond()) return timeMs - start;
      }
      throw new Error(message ?? `Condition not reached within ${maxMs} ms`);
    },
    set(id, value) {
      logic.setControl(state, id, value);
    },
    get(id) {
      return logic.getControl(state, id);
    },
    tap(id, ms = 200) {
      logic.setControl(state, id, true);
      h.run(ms);
      logic.setControl(state, id, false);
    },
    out(aliasOrOperand, value) {
      io.setOutput(aliasOrOperand, value);
    },
    inBool(aliasOrOperand) {
      return io.inputBool(aliasOrOperand);
    },
    inNum(aliasOrOperand) {
      return io.inputNumber(aliasOrOperand);
    },
    observe() {
      return logic.observe(state);
    },
    obs(id) {
      const o = logic.observe(state);
      if (!(id in o)) throw new Error(`Unknown observable '${id}' in scene '${logic.id}'`);
      return o[id]!;
    },
    obsNum(id) {
      const v = h.obs(id);
      return typeof v === 'boolean' ? (v ? 1 : 0) : v;
    },
  };
  return h;
}
