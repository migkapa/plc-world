import { describe, expect, it } from 'vitest';
import type { ControlDef, IoPointDef } from '../types';
import { FakeIo } from './fakeIo';
import {
  approach,
  coerceControl,
  controlTable,
  createDelayedContact,
  createRng,
  defaultControls,
  firstOrder,
  mulberry32,
  nextRandom,
  randomInt,
  readControl,
  stepDelayedContact,
  wrapAngle,
  writeControl,
} from './sceneKit';

describe('mulberry32 PRNG', () => {
  it('is deterministic, in [0, 1) and reasonably uniform', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 10_000 }, () => a());
    expect(Array.from({ length: 10_000 }, () => b())).toEqual(xs);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeCloseTo(0.5, 1);
    expect(mulberry32(43)()).not.toBe(xs[0]);
  });

  it('keeps its state as a plain uint32 (JSON-safe) and matches the closure form', () => {
    const rng = createRng(7);
    const f = mulberry32(7);
    for (let i = 0; i < 100; i++) expect(nextRandom(rng)).toBe(f());
    expect(JSON.parse(JSON.stringify(rng))).toEqual(rng);
    expect(Number.isInteger(rng.seed) && rng.seed >= 0 && rng.seed < 2 ** 32).toBe(true);
  });

  it('randomInt covers the inclusive range', () => {
    const rng = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(randomInt(rng, 2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });
});

describe('controls', () => {
  const defs: ControlDef[] = [
    { id: 'pb', label: 'PB', type: 'momentary', default: false },
    { id: 'sel', label: 'Sel', type: 'selector', default: 1, positions: ['A', 'B', 'C'] },
    { id: 'pot', label: 'Pot', type: 'analog', default: 0, range: [0, 100] },
  ];
  const table = controlTable('test', defs);

  it('coerces values to the control type', () => {
    expect(coerceControl(defs[0]!, 1)).toBe(true);
    expect(coerceControl(defs[0]!, 0)).toBe(false);
    expect(coerceControl(defs[1]!, 7)).toBe(2);
    expect(coerceControl(defs[1]!, 0.6)).toBe(1);
    expect(coerceControl(defs[1]!, true)).toBe(1);
    expect(coerceControl(defs[2]!, 150)).toBe(100);
    expect(coerceControl(defs[2]!, Number.NaN)).toBe(0);
  });

  it('reads/writes with defaults and rejects unknown ids', () => {
    const c = defaultControls<{ pb: boolean; sel: number; pot: number }>(table);
    expect(c).toEqual({ pb: false, sel: 1, pot: 0 });
    expect(writeControl(table, c, 'pb', true)).toBe(false);
    expect(readControl(table, c, 'pb')).toBe(true);
    expect(() => writeControl(table, c, 'nope', true)).toThrow(/Unknown control 'nope'/);
    expect(() => controlTable('dup', [defs[0]!, defs[0]!])).toThrow(/Duplicate/);
  });
});

describe('physics helpers', () => {
  it('approach / firstOrder / wrapAngle', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(1, 0, 5)).toBe(0);
    expect(firstOrder(0, 100, 1, 1)).toBeCloseTo(100 * (1 - Math.exp(-1)));
    expect(firstOrder(0, 100, 1, 0)).toBe(100);
    expect(wrapAngle(-0.5)).toBeCloseTo(2 * Math.PI - 0.5);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI);
  });

  it('delayed contact honours separate on/off delays and ignores short glitches', () => {
    const c = createDelayedContact();
    const run = (cmd: boolean, n: number) => {
      for (let i = 0; i < n; i++) stepDelayedContact(c, cmd, 10, 40, 25);
      return c.on;
    };
    expect(run(true, 3)).toBe(false);
    expect(run(false, 1)).toBe(false); // glitch resets the timer
    expect(run(true, 3)).toBe(false);
    expect(run(true, 1)).toBe(true);
    expect(run(false, 2)).toBe(true);
    expect(run(false, 1)).toBe(false);
  });
});

describe('FakeIo', () => {
  const points: IoPointDef[] = [
    { operand: 'Local:1:I.Data.0', alias: 'Start_PB', dir: 'input', signal: 'digital', device: 'PB', description: 'N.O.' },
    { operand: 'Local:3:I.Ch0Data', alias: 'LT', dir: 'input', signal: 'analog', device: 'LT', description: 'level', units: '%', range: [0, 100] },
    { operand: 'Local:2:O.Data.0', alias: 'Motor', dir: 'output', signal: 'digital', device: 'M', description: 'motor' },
    { operand: 'Local:4:O.Ch0Data', alias: 'Speed', dir: 'output', signal: 'analog', device: 'AO', description: 'speed', units: '%', range: [0, 100] },
  ];

  it('outputs read 0 unless set, and 0 when the controller is not running', () => {
    const io = new FakeIo(points);
    expect(io.readBool('Local:2:O.Data.0')).toBe(false);
    io.setOutput('Motor', true);
    io.setOutput('Speed', 55);
    expect(io.readBool('Local:2:O.Data.0')).toBe(true);
    expect(io.readNumber('Local:4:O.Ch0Data')).toBe(55);
    io.running = false;
    expect(io.readBool('Local:2:O.Data.0')).toBe(false);
    expect(io.readNumber('Local:4:O.Ch0Data')).toBe(0);
  });

  it('records inputs by operand, readable by alias, and tracks writes', () => {
    const io = new FakeIo(points);
    expect(() => io.input('Start_PB')).toThrow(/never written/);
    io.writeBool('Local:1:I.Data.0', true);
    io.writeNumber('Local:3:I.Ch0Data', 12.5);
    expect(io.inputBool('start_pb')).toBe(true);
    expect(io.inputNumber('LT')).toBe(12.5);
    expect([...io.written].sort()).toEqual(['Local:1:I.Data.0', 'Local:3:I.Ch0Data']);
    io.clearWritten();
    expect(io.written.size).toBe(0);
    expect(io.inputOperands()).toEqual(['Local:1:I.Data.0', 'Local:3:I.Ch0Data']);
  });

  it('strict mode rejects unwired operands, wrong direction and wrong signal kind', () => {
    const io = new FakeIo(points);
    expect(() => io.writeBool('Local:1:I.Data.9', true)).toThrow(/not wired/);
    expect(() => io.writeBool('Local:2:O.Data.0', true)).toThrow(/output/);
    expect(() => io.readBool('Local:1:I.Data.0')).toThrow(/input/);
    expect(() => io.writeBool('Local:3:I.Ch0Data', true)).toThrow(/analog/);
    expect(() => io.writeNumber('Local:3:I.Ch0Data', Number.NaN)).toThrow(/Non-finite/);
    const loose = new FakeIo();
    loose.writeBool('Anything', true);
    expect(loose.strict).toBe(false);
  });

  it('accepts the status BOOLs of a wired analog input channel (module members), nothing else', () => {
    const io = new FakeIo(points);
    io.writeBool('Local:3:I.Ch0Fault', true);
    io.writeBool('Local:3:I.Ch0Underrange', true);
    io.writeBool('Local:3:I.Ch0Overrange', false);
    expect(io.inputBool('Local:3:I.Ch0Fault')).toBe(true);
    expect(io.written.has('Local:3:I.Ch0Underrange')).toBe(true);
    // Not part of the wired list (no alias tags, not required every step).
    expect(io.inputOperands()).toEqual(['Local:1:I.Data.0', 'Local:3:I.Ch0Data']);
    expect(() => io.writeBool('Local:3:I.Ch1Fault', true)).toThrow(/not wired/); // channel not wired
    expect(() => io.writeBool('Local:4:O.Ch0Fault', true)).toThrow(/not wired/); // outputs have no such input
    expect(() => io.writeBool('Local:3:I.Ch0Alarm', true)).toThrow(/not wired/);
    expect(() => io.writeNumber('Local:3:I.Ch0Fault', 1)).toThrow(/digital/);
    expect(() => io.readBool('Local:3:I.Ch0Fault')).toThrow(/input/);
    // 5069 style: 'Local:3:I.Ch00.Fault' for a wired 'Local:3:I.Ch00.Data'.
    const io5069 = new FakeIo([
      { operand: 'Local:3:I.Ch00.Data', alias: 'PT', dir: 'input', signal: 'analog', device: 'PT', description: 'p', units: 'bar', range: [0, 10] },
    ]);
    io5069.writeBool('Local:3:I.Ch00.Fault', true);
    expect(io5069.inputBool('Local:3:I.Ch00.Fault')).toBe(true);
    expect(() => io5069.writeBool('Local:3:I.Ch00Fault', true)).toThrow(/not wired/);
  });
});
