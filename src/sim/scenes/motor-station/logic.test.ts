import { describe, expect, it } from 'vitest';
import { createHarness, sceneContractSuite, type FakePlc } from '../../testing';
import { MOTOR_STATION, motorStationLogic } from './logic';

sceneContractSuite(motorStationLogic, {
  id: 'motor-station',
  controls: ['start', 'stop', 'jog', 'estop', 'hoa', 'remote_run', 'overload_trip', 'overload_reset', 'jam'],
  observables: [
    'contactor', 'motorRunning', 'motorRpm', 'runLight', 'faultLight', 'horn', 'readyLight',
    'motorStarts', 'overloadTripped', 'runTimeMs',
  ],
});

/** Classic 3-wire start/stop seal-in, as a student would write it. */
const sealIn: FakePlc = (io) => {
  const run =
    (io.inputBool('Start_PB') || io.outputs.get('Local:2:O.Data.0') === true) &&
    io.inputBool('Stop_PB') &&
    io.inputBool('EStop_OK') &&
    io.inputBool('OL_OK');
  io.setOutput('Motor_Starter', run);
  io.setOutput('Run_Light', io.inputBool('Motor_Aux'));
  io.setOutput('Fault_Light', !io.inputBool('OL_OK'));
};

describe('motor-station: wiring', () => {
  it('uses the specified hardware and operands', () => {
    expect(motorStationLogic.hardware.modules.map((m) => m.catalog)).toEqual([
      '1756-L85E', '1756-IB16', '1756-OB16E', '1756-EN2T',
    ]);
    const map = Object.fromEntries(motorStationLogic.io.map((p) => [p.alias, p.operand]));
    expect(map).toEqual({
      Start_PB: 'Local:1:I.Data.0',
      Stop_PB: 'Local:1:I.Data.1',
      EStop_OK: 'Local:1:I.Data.2',
      Jog_PB: 'Local:1:I.Data.3',
      OL_OK: 'Local:1:I.Data.4',
      Motor_Aux: 'Local:1:I.Data.5',
      HOA_Hand: 'Local:1:I.Data.6',
      HOA_Auto: 'Local:1:I.Data.7',
      Remote_Run: 'Local:1:I.Data.8',
      Motor_Starter: 'Local:2:O.Data.0',
      Run_Light: 'Local:2:O.Data.1',
      Fault_Light: 'Local:2:O.Data.2',
      Horn: 'Local:2:O.Data.3',
      Ready_Light: 'Local:2:O.Data.4',
    });
  });

  it('control defaults: HOA in OFF, keys S/X/J', () => {
    const h = createHarness(motorStationLogic);
    expect(h.get('hoa')).toBe(1);
    const keys = Object.fromEntries(motorStationLogic.controls.filter((c) => c.key).map((c) => [c.id, c.key]));
    expect(keys).toEqual({ start: 'S', stop: 'X', jog: 'J' });
  });
});

describe('motor-station: input polarity', () => {
  it('idle station: N.C. devices read 1, N.O. devices read 0', () => {
    const h = createHarness(motorStationLogic);
    h.step();
    expect(h.inBool('Start_PB')).toBe(false);
    expect(h.inBool('Stop_PB')).toBe(true);
    expect(h.inBool('EStop_OK')).toBe(true);
    expect(h.inBool('Jog_PB')).toBe(false);
    expect(h.inBool('OL_OK')).toBe(true);
    expect(h.inBool('Motor_Aux')).toBe(false);
    expect(h.inBool('HOA_Hand')).toBe(false);
    expect(h.inBool('HOA_Auto')).toBe(false);
    expect(h.inBool('Remote_Run')).toBe(false);
  });

  it('actuated devices invert', () => {
    const h = createHarness(motorStationLogic);
    for (const id of ['start', 'stop', 'jog', 'estop', 'remote_run']) h.set(id, true);
    h.step();
    expect(h.inBool('Start_PB')).toBe(true);
    expect(h.inBool('Stop_PB')).toBe(false);
    expect(h.inBool('EStop_OK')).toBe(false);
    expect(h.inBool('Jog_PB')).toBe(true);
    expect(h.inBool('Remote_Run')).toBe(true);
  });

  it('HOA selector drives the HAND and AUTO contacts', () => {
    const h = createHarness(motorStationLogic);
    const read = () => [h.inBool('HOA_Hand'), h.inBool('HOA_Auto')];
    h.set('hoa', 0);
    h.step();
    expect(read()).toEqual([true, false]);
    h.set('hoa', 1);
    h.step();
    expect(read()).toEqual([false, false]);
    h.set('hoa', 2);
    h.step();
    expect(read()).toEqual([false, true]);
  });
});

describe('motor-station: contactor & hardwired interlocks', () => {
  it('aux contact follows the coil with 40 ms pull-in and 25 ms drop-out', () => {
    const h = createHarness(motorStationLogic);
    h.out('Motor_Starter', true);
    h.run(30);
    expect(h.obs('contactor')).toBe(true);
    expect(h.inBool('Motor_Aux')).toBe(false);
    h.run(10);
    expect(h.inBool('Motor_Aux')).toBe(true);
    h.out('Motor_Starter', false);
    h.run(20);
    expect(h.obs('contactor')).toBe(false);
    expect(h.inBool('Motor_Aux')).toBe(true);
    h.run(10);
    expect(h.inBool('Motor_Aux')).toBe(false);
  });

  it('E-stop drops the contactor even with the output on', () => {
    const h = createHarness(motorStationLogic);
    h.out('Motor_Starter', true);
    h.run(2000);
    expect(h.obs('motorRunning')).toBe(true);
    h.set('estop', true);
    h.step();
    expect(h.obs('contactor')).toBe(false);
    h.run(30);
    expect(h.inBool('Motor_Aux')).toBe(false);
    h.run(6000);
    expect(h.obs('motorRunning')).toBe(false);
    h.set('estop', false);
    h.step();
    expect(h.obs('contactor')).toBe(true); // output still on: the PLC program must prevent this restart
  });

  it('a tripped overload drops the contactor even with the output on', () => {
    const h = createHarness(motorStationLogic);
    h.out('Motor_Starter', true);
    h.run(100);
    h.set('overload_trip', true);
    h.step();
    h.step();
    expect(h.obs('overloadTripped')).toBe(true);
    expect(h.inBool('OL_OK')).toBe(false);
    expect(h.obs('contactor')).toBe(false);
  });

  it('nothing runs while the controller is not running', () => {
    const h = createHarness(motorStationLogic);
    h.out('Motor_Starter', true);
    h.io.running = false;
    h.run(1000);
    expect(h.obs('contactor')).toBe(false);
    expect(h.obs('motorRpm')).toBe(0);
  });
});

describe('motor-station: motor physics', () => {
  it('ramps to 1750 rpm with τ ≈ 0.6 s and coasts down with τ ≈ 1.5 s', () => {
    const h = createHarness(motorStationLogic);
    h.out('Motor_Starter', true);
    h.run(40); // pull-in
    h.run(600);
    expect(h.obsNum('motorRpm')).toBeGreaterThan(1750 * 0.6);
    expect(h.obsNum('motorRpm')).toBeLessThan(1750 * 0.66);
    h.run(5000);
    expect(h.obsNum('motorRpm')).toBeCloseTo(1750, -1);
    expect(h.state.motorCurrentA).toBeCloseTo(MOTOR_STATION.fullLoadAmps, 0);
    h.out('Motor_Starter', false);
    h.run(25); // drop-out
    h.run(1500);
    expect(h.obsNum('motorRpm')).toBeGreaterThan(1750 * 0.35);
    expect(h.obsNum('motorRpm')).toBeLessThan(1750 * 0.39);
    expect(h.state.motorCurrentA).toBe(0);
    h.run(20_000);
    expect(h.obsNum('motorRpm')).toBe(0);
  });

  it('motorRunning means > 100 rpm; belt and shaft move with the motor', () => {
    const h = createHarness(motorStationLogic);
    h.out('Motor_Starter', true);
    h.runUntil(() => h.obs('motorRunning') === true, 500);
    expect(h.obsNum('motorRpm')).toBeGreaterThan(100);
    h.run(10_000);
    const b0 = h.state.beltPosition;
    h.run(1000);
    expect(h.state.beltPosition - b0).toBeCloseTo(0.5, 2);
    expect(h.state.shaftAngle).toBeGreaterThanOrEqual(0);
    expect(h.state.shaftAngle).toBeLessThan(2 * Math.PI);
  });

  it('jam: stalls at ~150 rpm with high current and trips the overload after 3 s', () => {
    const h = createHarness(motorStationLogic, { plc: sealIn });
    h.tap('start');
    h.run(3000);
    h.set('jam', true);
    h.run(1500);
    expect(h.obsNum('motorRpm')).toBeCloseTo(150, -1);
    expect(h.state.motorCurrentA).toBeGreaterThan(35);
    expect(h.obs('overloadTripped')).toBe(false);
    const ms = h.runUntil(() => h.obs('overloadTripped') === true, 3000);
    expect(1500 + ms).toBeGreaterThanOrEqual(2990);
    expect(1500 + ms).toBeLessThanOrEqual(3010);
    h.step();
    expect(h.inBool('OL_OK')).toBe(false);
    expect(h.obs('contactor')).toBe(false);
    expect(h.obs('faultLight')).toBe(true);
    // Stays tripped (latched) even when the jam is cleared...
    h.set('jam', false);
    h.run(5000);
    expect(h.obs('overloadTripped')).toBe(true);
    // ...until the reset button is tapped.
    h.tap('overload_reset', 100);
    expect(h.obs('overloadTripped')).toBe(false);
    expect(h.inBool('OL_OK')).toBe(true);
  });

  it('overload_trip fault holds the relay tripped while active; reset works once it is gone', () => {
    const h = createHarness(motorStationLogic);
    h.set('overload_trip', true);
    h.step();
    expect(h.obs('overloadTripped')).toBe(true);
    h.tap('overload_reset');
    expect(h.obs('overloadTripped')).toBe(true);
    h.set('overload_trip', false);
    h.run(500);
    expect(h.obs('overloadTripped')).toBe(true);
    // A quick set/clear between steps still registers as a tap.
    h.set('overload_reset', true);
    h.set('overload_reset', false);
    h.step();
    expect(h.obs('overloadTripped')).toBe(false);
  });

  it('overload reset is refused while the jam is still there (the cause is not gone)', () => {
    const h = createHarness(motorStationLogic, { plc: sealIn });
    h.set('jam', true);
    h.tap('start');
    h.runUntil(() => h.obs('overloadTripped') === true, 4000);
    h.run(5000); // fully cooled, but the conveyor is still jammed
    expect(h.state.stallMs).toBe(0);
    expect(h.state.overloadResetReady).toBe(false);
    h.tap('overload_reset', 100);
    expect(h.obs('overloadTripped')).toBe(true);
    expect(h.inBool('OL_OK')).toBe(false);
    h.set('jam', false);
    h.step();
    expect(h.state.overloadResetReady).toBe(true);
    h.tap('overload_reset', 100);
    expect(h.obs('overloadTripped')).toBe(false);
    expect(h.inBool('OL_OK')).toBe(true);
  });

  it('overload reset is refused until the thermal memory has cooled below 25 %; the memory is not wiped', () => {
    const h = createHarness(motorStationLogic, { plc: sealIn });
    h.set('jam', true);
    h.tap('start');
    h.runUntil(() => h.obs('overloadTripped') === true, 4000);
    h.set('jam', false); // cause removed right away…
    h.run(1000);
    expect(h.state.overloadResetReady).toBe(false); // …but still hot (≈ 2000 of 3000)
    h.tap('overload_reset', 100);
    expect(h.obs('overloadTripped')).toBe(true);
    const ready = h.runUntil(() => h.state.overloadResetReady, 3000);
    // 3000 → below 750 at 1:1 cooling: 2.25 s after the trip
    expect(1000 + 100 + ready).toBeGreaterThan(2200);
    expect(1000 + 100 + ready).toBeLessThan(2300);
    h.tap('overload_reset', 20);
    expect(h.obs('overloadTripped')).toBe(false);
    // Thermal memory kept: restarting straight into a jam trips sooner than from cold.
    const warm = h.state.stallMs;
    expect(warm).toBeGreaterThan(600);
    h.set('jam', true);
    h.tap('start', 20);
    const ms = h.runUntil(() => h.obs('overloadTripped') === true, 4000);
    expect(ms).toBeLessThan(MOTOR_STATION.stallTripMs - 500);
  });

  it('is trip-free: holding RESET in cannot defeat or bypass a trip', () => {
    const h = createHarness(motorStationLogic, { plc: sealIn });
    h.set('overload_trip', true);
    h.step();
    h.set('overload_reset', true); // pressed while the fault is present: refused
    h.run(200);
    h.set('overload_trip', false); // fault gone, button still held: nothing happens by itself
    h.run(500);
    expect(h.obs('overloadTripped')).toBe(true);
    h.set('overload_reset', false);
    h.set('overload_reset', true); // a new press resets
    h.step();
    expect(h.obs('overloadTripped')).toBe(false);
    // Button still held: a new jam trips the relay and it STAYS tripped (no 10 ms blips of OL_OK).
    h.set('jam', true);
    h.tap('start', 20);
    h.runUntil(() => h.obs('overloadTripped') === true, 4000);
    let olOk = 0;
    h.run(3000, () => {
      if (h.inBool('OL_OK')) olOk++;
    });
    expect(olOk).toBe(0);
    expect(h.obs('contactor')).toBe(false);
  });

  it('counts contactor starts and run time', () => {
    const h = createHarness(motorStationLogic, { plc: sealIn });
    h.tap('start');
    h.run(1800);
    h.tap('stop');
    h.run(500);
    h.tap('start');
    h.run(800);
    h.set('estop', true);
    h.run(100);
    expect(h.obs('motorStarts')).toBe(2);
    // start tap (200 ms) + 1800 + (200 ms stop tap: 10 ms scan + 25 ms drop-out)…
    const rt = h.obsNum('runTimeMs');
    expect(rt).toBeGreaterThan(2900);
    expect(rt).toBeLessThan(3100);
    // Seal-in dropped on E-stop, so releasing it does not restart.
    h.set('estop', false);
    h.run(500);
    expect(h.obs('contactor')).toBe(false);
    expect(h.obs('motorStarts')).toBe(2);
  });

  it('pilot lights and horn follow the outputs', () => {
    const h = createHarness(motorStationLogic);
    h.out('Run_Light', true);
    h.out('Horn', true);
    h.out('Ready_Light', true);
    h.step();
    expect(h.observe()).toMatchObject({ runLight: true, faultLight: false, horn: true, readyLight: true });
  });
});
