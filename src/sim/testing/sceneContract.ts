/**
 * Generic conformance suite every scene model must pass (vitest). Call `sceneContractSuite(logic)`
 * from a scene's `logic.test.ts`. It checks the static definition (unique ids, well-formed operands,
 * aliases, controls, observables) and fuzzes the model with a seeded random control/output sequence:
 * every input written every step, observables well-typed & finite, state plain JSON data, determinism.
 */
import { describe, expect, it } from 'vitest';
import type { ControlDef, SceneLogic } from '../types';
import { FakeIo } from './fakeIo';
import { mulberry32 } from './sceneKit';

const LOGIX_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const DIGITAL_OPERAND = /^Local:\d+:[IO]\.(Data\.\d{1,2}|Pt\d{2}\.Data)$/;
const ANALOG_OPERAND = /^Local:\d+:[IO]\.Ch\d+Data$/;

export interface ContractOptions {
  /** Expected scene id. */
  id: string;
  /** Exact expected observable ids (order-insensitive). */
  observables: string[];
  /** Exact expected control ids (order-insensitive). */
  controls: string[];
  /** Fuzz length (ms of simulated time). Default 20 s. */
  fuzzMs?: number;
}

/** Deterministic pseudo-random driver used by the fuzz + determinism checks. */
function fuzz<S>(logic: SceneLogic<S>, seed: number, ms: number): { state: S; io: FakeIo; trace: string[] } {
  const rnd = mulberry32(seed);
  const state = logic.createState();
  const io = new FakeIo(logic.io);
  const outputs = logic.io.filter((p) => p.dir === 'output');
  const inputs = logic.io.filter((p) => p.dir === 'input');
  const trace: string[] = [];
  for (let t = 0; t < ms; t += 10) {
    // Occasionally flip the controller between running / not running.
    if (rnd() < 0.002) io.running = !io.running;
    for (const p of outputs) {
      if (rnd() < 0.02) {
        io.setOutput(
          p.operand,
          p.signal === 'digital' ? rnd() < 0.5 : (p.range?.[0] ?? 0) + rnd() * ((p.range?.[1] ?? 100) - (p.range?.[0] ?? 0)),
        );
      }
    }
    for (const c of logic.controls) {
      if (rnd() < (c.type === 'fault' ? 0.001 : 0.004)) logic.setControl(state, c.id, randomControlValue(c, rnd));
    }
    io.clearWritten();
    logic.step(state, 10, io);
    for (const p of inputs) {
      if (!io.written.has(p.operand)) throw new Error(`t=${t}ms: input ${p.alias} (${p.operand}) not written this step`);
    }
    if (t % 500 === 0) trace.push(JSON.stringify(logic.observe(state)));
  }
  return { state, io, trace };
}

function randomControlValue(c: ControlDef, rnd: () => number): boolean | number {
  switch (c.type) {
    case 'selector':
      return Math.floor(rnd() * (c.positions?.length ?? 1));
    case 'analog': {
      const [lo, hi] = c.range ?? [0, 100];
      return lo + rnd() * (hi - lo);
    }
    default:
      return rnd() < 0.5;
  }
}

/** Register the generic conformance tests for `logic`. */
export function sceneContractSuite<S>(logic: SceneLogic<S>, opts: ContractOptions): void {
  describe(`${opts.id}: scene contract`, () => {
    it('has the expected id, title and summary', () => {
      expect(logic.id).toBe(opts.id);
      expect(logic.title.length).toBeGreaterThan(3);
      expect(logic.summary.length).toBeGreaterThan(10);
    });

    it('declares well-formed, unique I/O points', () => {
      const operands = new Set<string>();
      const aliases = new Set<string>();
      const slots = new Set(logic.hardware.modules.map((m) => m.slot));
      for (const p of logic.io) {
        expect(operands.has(p.operand), `duplicate operand ${p.operand}`).toBe(false);
        expect(aliases.has(p.alias.toLowerCase()), `duplicate alias ${p.alias}`).toBe(false);
        operands.add(p.operand);
        aliases.add(p.alias.toLowerCase());
        expect(p.alias, 'alias must be a valid Logix tag name').toMatch(LOGIX_NAME);
        expect(p.operand).toMatch(p.signal === 'digital' ? DIGITAL_OPERAND : ANALOG_OPERAND);
        expect(p.operand.includes(p.dir === 'input' ? ':I.' : ':O.'), `${p.operand} direction`).toBe(true);
        expect(slots.has(Number(p.operand.split(':')[1])), `${p.operand} refers to a configured slot`).toBe(true);
        expect(p.device.length).toBeGreaterThan(3);
        expect(p.description.length).toBeGreaterThan(3);
        if (p.signal === 'analog') {
          expect(p.units, `${p.alias} units`).toBeTruthy();
          expect(p.range, `${p.alias} range`).toBeTruthy();
        }
      }
    });

    it('declares the expected controls with valid defaults', () => {
      expect(logic.controls.map((c) => c.id).sort()).toEqual([...opts.controls].sort());
      const state = logic.createState();
      for (const c of logic.controls) {
        expect(c.label.length).toBeGreaterThan(0);
        if (c.type === 'selector') expect(c.positions?.length ?? 0).toBeGreaterThan(1);
        if (c.type === 'analog') expect(c.range).toBeTruthy();
        expect(logic.getControl(state, c.id)).toEqual(c.default);
        const v = randomControlValue(c, mulberry32(7));
        logic.setControl(state, c.id, v);
        const back = logic.getControl(state, c.id);
        expect(typeof back).toBe(typeof c.default);
      }
      expect(() => logic.setControl(state, '__nope__', true)).toThrow();
    });

    it('observes exactly the expected, well-typed observables', () => {
      expect(logic.observables.map((o) => o.id).sort()).toEqual([...opts.observables].sort());
      const o = logic.observe(logic.createState());
      expect(Object.keys(o).sort()).toEqual([...opts.observables].sort());
      for (const def of logic.observables) {
        const v = o[def.id];
        expect(typeof v, def.id).toBe(def.type === 'boolean' ? 'boolean' : 'number');
      }
    });

    it('writes every input on every step, stays finite and plain under random operation', () => {
      const { state, trace } = fuzz(logic, 1234, opts.fuzzMs ?? 20_000);
      const o = logic.observe(state);
      for (const def of logic.observables) {
        const v = o[def.id];
        if (def.type === 'number') expect(Number.isFinite(v), def.id).toBe(true);
      }
      // Plain JSON data: a JSON round-trip preserves the state exactly.
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
      expect(trace.length).toBeGreaterThan(0);
    });

    it('is deterministic: same control sequence => identical observations and state', () => {
      const a = fuzz(logic, 99, opts.fuzzMs ?? 20_000);
      const b = fuzz(logic, 99, opts.fuzzMs ?? 20_000);
      expect(b.trace).toEqual(a.trace);
      expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    });
  });
}
