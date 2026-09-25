import { describe, expect, it } from 'vitest';
import { createDemoRuntime } from '../../demo';
import { TANK_DEMO_RUNGS } from './demo';
import { tankProcessLogic } from './logic';

const setup = () => createDemoRuntime(tankProcessLogic, TANK_DEMO_RUNGS);
const tap = (rt: { setControl(id: string, v: boolean): void; step(ms: number): void }, id: string) => {
  rt.setControl(id, true);
  rt.step(200);
  rt.setControl(id, false);
  rt.step(100);
};

describe('tank-process demo program', () => {
  it('verifies and does NOT start by itself', () => {
    const { controller, runtime } = setup();
    expect(controller.verify()).toEqual([]);
    runtime.step(5000);
    const o = runtime.observe();
    expect(o.runningLight).toBe(false);
    expect(o.fillValve).toBe(false);
    expect(o.heaterOn).toBe(false);
  });

  it('runs complete batches after START: no spill, no dry run, no dry heating', () => {
    const { runtime } = setup();
    tap(runtime, 'start');
    let maxL = 0;
    for (let t = 0; t < 400_000; t += 100) {
      runtime.step(100);
      maxL = Math.max(maxL, Number(runtime.observe().level));
    }
    const o = runtime.observe();
    expect(Number(o.batches)).toBeGreaterThanOrEqual(3);
    expect(o.spills).toBe(0);
    expect(o.dryRunMs).toBe(0);
    expect(o.dryHeatMs).toBe(0);
    expect(maxL).toBeLessThan(97);
  });

  it('E-stop drops RUNNING and it stays off after the reset until START', () => {
    const { runtime } = setup();
    tap(runtime, 'start');
    runtime.step(5000);
    expect(runtime.observe().runningLight).toBe(true);
    runtime.setControl('estop', true);
    runtime.step(1000);
    expect(runtime.observe().runningLight).toBe(false);
    runtime.setControl('estop', false);
    runtime.step(3000);
    expect(runtime.observe().runningLight).toBe(false);
    expect(runtime.observe().fillValve).toBe(false);
  });
});
