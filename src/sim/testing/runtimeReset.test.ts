import { describe, expect, it } from 'vitest';
import type { PlcController } from '../../plc/types';
import { createSimRuntime } from '../runtime';
import { motorStationLogic, parkingGarageLogic, type ParkingGarageState } from '../scenes';

/** Controller stand-in: every output off, inputs ignored (like a controller in PROG). */
function idleController(): PlcController {
  const stub = {
    readOutputForField: () => false,
    writeInputFromField: () => undefined,
    scan: () => undefined,
    subscribe: () => () => undefined,
  };
  return stub as unknown as PlcController;
}

describe('runtime.resetScene keeps the scene settings', () => {
  it('parking garage: initial_cars survives Reset and is applied to the fresh plant', () => {
    const rt = createSimRuntime(idleController(), parkingGarageLogic, { notifyIntervalMs: 0 });
    rt.setControl('initial_cars', 8);
    expect(rt.observe().carsInside).toBe(8);
    rt.step(120_000); // auto traffic: parked cars leave their spaces, the garage is no longer untouched
    expect((rt.state as ParkingGarageState).cars.some((c) => c.phase !== 'parked')).toBe(true);
    rt.setControl('initial_cars', 5); // mid-run: takes effect on the next reset
    expect(rt.getControl('initial_cars')).toBe(5);
    rt.resetScene();
    expect(rt.getControl('initial_cars')).toBe(5);
    expect(rt.getControl('auto_traffic')).toBe(true);
    expect(rt.observe().carsInside).toBe(5);
    rt.step(100);
    expect(rt.observe().carsInside).toBe(5);
  });

  it('motor station: selector, maintained and fault controls are kept, momentary buttons are released', () => {
    const rt = createSimRuntime(idleController(), motorStationLogic, { notifyIntervalMs: 0 });
    rt.setControl('hoa', 2);
    rt.setControl('estop', true);
    rt.setControl('jam', true);
    rt.setControl('start', true);
    rt.step(1000);
    rt.resetScene();
    expect(rt.getControl('hoa')).toBe(2);
    expect(rt.getControl('estop')).toBe(true);
    expect(rt.getControl('jam')).toBe(true);
    expect(rt.getControl('start')).toBe(false);
    expect(rt.timeMs).toBe(0);
  });
});
