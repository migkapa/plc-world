import { describe, expect, it } from 'vitest';
import { createDemoRuntime } from '../../demo';
import { MOTOR_STATION_DEMO_RUNGS } from './demo';
import { motorStationLogic } from './logic';

const setup = () => createDemoRuntime(motorStationLogic, MOTOR_STATION_DEMO_RUNGS);

describe('motor-station demo program', () => {
  it('verifies and shows READY when healthy', () => {
    const { controller, runtime } = setup();
    expect(controller.verify()).toEqual([]);
    runtime.step(100);
    expect(runtime.observe().readyLight).toBe(true);
    expect(runtime.observe().contactor).toBe(false);
  });

  it('HAND: start seals in, stop drops out; OFF does nothing', () => {
    const { runtime } = setup();
    runtime.setControl('start', true);
    runtime.step(200);
    runtime.setControl('start', false);
    expect(runtime.observe().contactor).toBe(false); // HOA in OFF
    runtime.setControl('hoa', 0);
    runtime.setControl('start', true);
    runtime.step(100);
    runtime.setControl('start', false);
    runtime.step(3000);
    const o = runtime.observe();
    expect(o.contactor).toBe(true);
    expect(o.runLight).toBe(true);
    expect(o.readyLight).toBe(false);
    expect(Number(o.motorRpm)).toBeGreaterThan(1500);
    runtime.setControl('stop', true);
    runtime.step(100);
    runtime.setControl('stop', false);
    runtime.step(100);
    expect(runtime.observe().contactor).toBe(false);
  });

  it('JOG runs only while held', () => {
    const { runtime } = setup();
    runtime.setControl('hoa', 0);
    runtime.setControl('jog', true);
    runtime.step(300);
    expect(runtime.observe().contactor).toBe(true);
    runtime.setControl('jog', false);
    runtime.step(100);
    expect(runtime.observe().contactor).toBe(false);
  });

  it('JOG while running cancels the latched run command', () => {
    const { runtime } = setup();
    runtime.setControl('hoa', 0);
    runtime.setControl('start', true);
    runtime.step(100);
    runtime.setControl('start', false);
    runtime.step(500);
    expect(runtime.observe().runLight).toBe(true);
    runtime.setControl('jog', true);
    runtime.step(100);
    expect(runtime.observe().contactor).toBe(true);
    expect(runtime.observe().runLight).toBe(false);
    runtime.setControl('jog', false);
    runtime.step(100);
    expect(runtime.observe().contactor).toBe(false);
  });

  it('uses no unused output point as scratch memory', () => {
    const outputs = new Set(motorStationLogic.io.filter((p) => p.dir === 'output').map((p) => p.alias));
    for (const r of MOTOR_STATION_DEMO_RUNGS) {
      expect(r).not.toMatch(/Local:\d+:O\./);
      for (const m of r.matchAll(/OT[ELU]\(([^)]+)\)/g)) expect(outputs.has(m[1]!)).toBe(true);
    }
  });

  it('AUTO follows the upstream request; overload trip → fault light + horn until the selector goes to OFF', () => {
    const { runtime } = setup();
    runtime.setControl('hoa', 2);
    runtime.setControl('remote_run', true);
    runtime.step(500);
    expect(runtime.observe().contactor).toBe(true);
    runtime.setControl('overload_trip', true);
    runtime.step(100);
    let o = runtime.observe();
    expect(o.contactor).toBe(false);
    expect(o.faultLight).toBe(true);
    expect(o.horn).toBe(true);
    runtime.setControl('hoa', 1);
    runtime.step(50);
    o = runtime.observe();
    expect(o.horn).toBe(false);
    expect(o.faultLight).toBe(true);
    expect(o.readyLight).toBe(false);
  });
});
