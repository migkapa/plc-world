import { describe, expect, it } from 'vitest';
import { createDemoRuntime } from '../../demo';
import { TRAINER_DEMO_RUNGS } from './demo';
import { trainerLogic } from './logic';

describe('trainer demo program', () => {
  it('verifies, runs and animates the bench without input', () => {
    const { controller, runtime } = createDemoRuntime(trainerLogic, TRAINER_DEMO_RUNGS);
    expect(controller.verify()).toEqual([]);
    expect(controller.getStatus().running).toBe(true);
    const seen = new Set<number>();
    for (let t = 0; t < 6000; t += 100) {
      runtime.step(100);
      const o = runtime.observe();
      const lit = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => o[`light${i}`] === true);
      expect(lit.length).toBeLessThanOrEqual(1);
      lit.forEach((i) => seen.add(i));
    }
    expect(seen.size).toBe(8);
    const o = runtime.observe();
    expect(Number(o.meter1) + Number(o.meter2)).toBeCloseTo(100, 0);
  });

  it('responds to switches, lamp test, pots and the N.C. red button', () => {
    const { runtime } = createDemoRuntime(trainerLogic, TRAINER_DEMO_RUNGS);
    runtime.setControl('sw3', true);
    runtime.step(50);
    expect(runtime.observe().light3).toBe(true);
    runtime.setControl('pb_green', true);
    runtime.step(50);
    expect([0, 1, 2, 3, 4, 5, 6, 7].every((i) => runtime.observe()[`light${i}`] === true)).toBe(true);
    runtime.setControl('pb_green', false);
    runtime.setControl('pot1', 42);
    runtime.setControl('pot2', 77);
    runtime.step(50);
    expect(runtime.observe().meter1).toBeCloseTo(42, 3);
    expect(runtime.observe().meter2).toBeCloseTo(77, 3);
    expect(runtime.observe().buzzer).toBe(false);
    runtime.setControl('pb_red', true);
    runtime.step(50);
    expect(runtime.observe().buzzer).toBe(true);
    // the chaser follows the pot through Meter_1 (42 % -> lamp 3's window)
    runtime.setControl('pb_red', false);
    runtime.setControl('sw3', false);
    runtime.step(50);
    expect([0, 1, 2, 3, 4, 5, 6, 7].filter((i) => runtime.observe()[`light${i}`] === true)).toEqual([3]);
  });

  it('uses no unused output point as scratch memory', () => {
    for (const r of TRAINER_DEMO_RUNGS) expect(r).not.toMatch(/Local:\d+:O\./);
  });
});
