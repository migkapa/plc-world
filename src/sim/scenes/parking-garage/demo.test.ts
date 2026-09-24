import { describe, expect, it } from 'vitest';
import { createDemoRuntime } from '../../demo';
import { PARKING_DEMO_RUNGS } from './demo';
import { parkingGarageLogic } from './logic';

const setup = () => createDemoRuntime(parkingGarageLogic, PARKING_DEMO_RUNGS);
const tap = (rt: ReturnType<typeof setup>['runtime'], id: string) => {
  rt.setControl(id, true);
  rt.step(50);
  rt.setControl(id, false);
};

describe('parking-garage demo program', () => {
  it('verifies, lets cars in and out, never hits a car, counts correctly', () => {
    const { controller, runtime } = setup();
    expect(controller.verify()).toEqual([]);
    for (let t = 0; t < 240_000; t += 100) runtime.step(100);
    const o = runtime.observe();
    expect(o.gateHits).toBe(0);
    expect(Number(o.carsEntered)).toBeGreaterThan(15);
    expect(Number(o.carsExited)).toBeGreaterThan(5);
    expect(controller.tags.readNumber('Local:1:I.DiagnosticSequenceCount')).toBe(o.carsInside);
    expect(o.openSign).toBe(Number(o.carsInside) < 12);
  });

  it('shows FULL at 12 and turns drivers away; the reset key clears the count', () => {
    const { runtime } = setup();
    runtime.setControl('auto_traffic', false);
    for (let i = 0; i < 13; i++) {
      tap(runtime, 'spawn_entry');
      runtime.step(9_000);
    }
    runtime.step(20_000);
    let o = runtime.observe();
    expect(o.carsInside).toBe(12);
    expect(o.fullSign).toBe(true);
    expect(o.openSign).toBe(false);
    expect(Number(o.carsTurnedAway)).toBeGreaterThanOrEqual(1);
    expect(o.gateHits).toBe(0);
    tap(runtime, 'spawn_exit');
    runtime.step(20_000);
    o = runtime.observe();
    expect(o.carsInside).toBe(11);
    expect(o.openSign).toBe(true);
    tap(runtime, 'reset_key');
    runtime.step(100);
    expect(runtime.observe().fullSign).toBe(false);
    expect(runtime.controller.tags.readNumber('Local:1:I.DiagnosticSequenceCount')).toBe(0);
  });
});
