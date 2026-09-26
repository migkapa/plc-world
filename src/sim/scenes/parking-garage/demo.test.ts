import { describe, expect, it } from 'vitest';
import { createDemoRuntime } from '../../demo';
import { PARKING_DEMO_RUNGS, PARKING_DEMO_TAGS } from './demo';
import { parkingGarageLogic } from './logic';

const setup = () => createDemoRuntime(parkingGarageLogic, PARKING_DEMO_RUNGS, { tags: PARKING_DEMO_TAGS });
type Rt = ReturnType<typeof setup>['runtime'];
const tap = (rt: Rt, id: string) => {
  rt.setControl(id, true);
  rt.step(50);
  rt.setControl(id, false);
};
const count = (rt: Rt) => rt.controller.tags.readNumber('Cars.ACC');

describe('parking-garage demo program', () => {
  it('verifies, lets cars in and out, never hits a car, counts correctly', () => {
    const { controller, runtime } = setup();
    expect(controller.verify()).toEqual([]);
    for (let t = 0; t < 240_000; t += 100) runtime.step(100);
    const o = runtime.observe();
    expect(o.gateHits).toBe(0);
    expect(Number(o.carsEntered)).toBeGreaterThan(15);
    expect(Number(o.carsExited)).toBeGreaterThan(5);
    expect(count(runtime)).toBe(o.carsInside);
    expect(o.openSign).toBe(Number(o.carsInside) < 12);
  });

  it('shows FULL at 12 and turns drivers away; the attendant key reloads the count', () => {
    const { runtime } = setup();
    runtime.setControl('auto_traffic', false);
    for (let i = 0; i < 13; i++) {
      tap(runtime, 'spawn_entry');
      runtime.step(9_000);
    }
    runtime.step(20_000);
    let o = runtime.observe();
    expect(o.carsInside).toBe(12);
    expect(count(runtime)).toBe(12);
    expect(o.fullSign).toBe(true);
    expect(o.openSign).toBe(false);
    expect(Number(o.carsTurnedAway)).toBeGreaterThanOrEqual(1);
    expect(o.gateHits).toBe(0);
    tap(runtime, 'spawn_exit');
    runtime.step(20_000);
    o = runtime.observe();
    expect(o.carsInside).toBe(11);
    expect(count(runtime)).toBe(11);
    expect(o.openSign).toBe(true);
    tap(runtime, 'reset_key');
    runtime.step(100);
    expect(count(runtime)).toBe(0);
    expect(runtime.observe().fullSign).toBe(false);
  });

  it('cars parked at start: Count_Adjust + the key bring the count in line', () => {
    const { runtime } = setup();
    runtime.setControl('auto_traffic', false);
    runtime.setControl('initial_cars', 12);
    runtime.step(1000);
    expect(runtime.observe().carsInside).toBe(12);
    expect(count(runtime)).toBe(0); // the PLC never saw them
    runtime.controller.tags.writeNumber('Count_Adjust', 12);
    tap(runtime, 'reset_key');
    runtime.step(200);
    const o = runtime.observe();
    expect(count(runtime)).toBe(12);
    expect(o.fullSign).toBe(true);
    expect(o.openSign).toBe(false);
    // a new arrival is turned away, nobody is let in
    tap(runtime, 'spawn_entry');
    runtime.step(30_000);
    expect(runtime.observe().carsInside).toBe(12);
    expect(Number(runtime.observe().carsTurnedAway)).toBe(1);
  });

  it('keeps its memory in internal tags, not in the I/O image', () => {
    const { runtime } = setup();
    let toggles = 0;
    let prev = false;
    for (let t = 0; t < 120_000; t += 100) {
      runtime.step(100);
      const v = runtime.controller.tags.readBool('Local:2:O.Pt04.Data');
      if (v !== prev) toggles++;
      prev = v;
    }
    expect(toggles).toBe(0);
    expect(runtime.controller.tags.readNumber('Local:1:I.DiagnosticSequenceCount')).toBe(0);
  });
});
