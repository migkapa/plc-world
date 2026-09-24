import { describe, expect, it } from 'vitest';
import { createHarness, sceneContractSuite, type FakePlc } from '../../testing';
import { TANK_PROCESS, tankProcessLogic } from './logic';

sceneContractSuite(tankProcessLogic, {
  id: 'tank-process',
  controls: ['start', 'stop', 'estop', 'discharge', 'lt_fail', 'lsh_fail'],
  observables: [
    'level', 'temperature', 'fillValve', 'drainValve', 'mixerRunning', 'heaterOn', 'alarmHorn',
    'batchDoneLight', 'runningLight', 'fcvPosition', 'overflow', 'spills', 'dryRunMs', 'dryHeatMs', 'batches',
  ],
});

const tank = () => createHarness(tankProcessLogic);

describe('tank-process: wiring', () => {
  it('uses the specified hardware and operands', () => {
    const hw = tankProcessLogic.hardware;
    expect(hw.chassis).toBe('1756-A10');
    expect(hw.powerSupply).toBe('1756-PA75');
    expect(hw.modules.map((m) => m.catalog)).toEqual([
      '1756-L85E', '1756-IB16', '1756-OB16E', '1756-IF8', '1756-OF8', '1756-EN2T',
    ]);
    const map = Object.fromEntries(tankProcessLogic.io.map((p) => [p.alias, p.operand]));
    expect(map).toEqual({
      Start_PB: 'Local:1:I.Data.0',
      Stop_PB: 'Local:1:I.Data.1',
      LSL_101: 'Local:1:I.Data.2',
      LSH_101: 'Local:1:I.Data.3',
      LSHH_101: 'Local:1:I.Data.4',
      Mixer_Running: 'Local:1:I.Data.5',
      Discharge_PB: 'Local:1:I.Data.6',
      EStop_OK: 'Local:1:I.Data.7',
      LT_101: 'Local:3:I.Ch0Data',
      TT_101: 'Local:3:I.Ch1Data',
      Fill_Valve: 'Local:2:O.Data.0',
      Drain_Valve: 'Local:2:O.Data.1',
      Mixer: 'Local:2:O.Data.2',
      Heater: 'Local:2:O.Data.3',
      Alarm_Horn: 'Local:2:O.Data.4',
      Batch_Done_Light: 'Local:2:O.Data.5',
      Running_Light: 'Local:2:O.Data.6',
      FCV_101: 'Local:4:O.Ch0Data',
    });
  });

  it('empty tank polarity: N.C. Stop/E-stop/LSHH read 1, level switches 0', () => {
    const h = tank();
    h.step();
    expect(h.inBool('Start_PB')).toBe(false);
    expect(h.inBool('Stop_PB')).toBe(true);
    expect(h.inBool('EStop_OK')).toBe(true);
    expect(h.inBool('Discharge_PB')).toBe(false);
    expect(h.inBool('LSL_101')).toBe(false);
    expect(h.inBool('LSH_101')).toBe(false);
    expect(h.inBool('LSHH_101')).toBe(true);
    expect(h.inBool('Mixer_Running')).toBe(false);
    for (const id of ['start', 'stop', 'estop', 'discharge']) h.set(id, true);
    h.step();
    expect(h.inBool('Start_PB')).toBe(true);
    expect(h.inBool('Stop_PB')).toBe(false);
    expect(h.inBool('EStop_OK')).toBe(false);
    expect(h.inBool('Discharge_PB')).toBe(true);
  });
});

describe('tank-process: hydraulics', () => {
  it('fills at 4.5 %/s with XV-101 and drains at 5 %/s with XV-102', () => {
    const h = tank();
    h.out('Fill_Valve', true);
    h.run(10_000);
    expect(h.obsNum('level')).toBeCloseTo(45, 6);
    expect(h.obs('fillValve')).toBe(true);
    h.out('Fill_Valve', false);
    h.out('Drain_Valve', true);
    h.run(4000);
    expect(h.obsNum('level')).toBeCloseTo(25, 6);
    h.run(10_000);
    expect(h.obsNum('level')).toBe(0);
    expect(h.state.outflowRate).toBe(0);
  });

  it('FCV-101 inflow is proportional; with XV-101 open the larger one wins; position clamps', () => {
    const h = tank();
    h.out('FCV_101', 50);
    h.run(10_000);
    expect(h.obsNum('level')).toBeCloseTo(22.5, 6);
    expect(h.obsNum('fcvPosition')).toBe(50);
    h.out('Fill_Valve', true);
    h.run(2000);
    expect(h.obsNum('level')).toBeCloseTo(31.5, 6);
    h.out('Fill_Valve', false);
    h.out('FCV_101', 150);
    h.step();
    expect(h.obsNum('fcvPosition')).toBe(100);
    h.out('FCV_101', -20);
    h.step();
    expect(h.obsNum('fcvPosition')).toBe(0);
  });

  it('level switches: LSL at 10 %, LSH at 90 %, LSHH (N.C.) opens at 97 %', () => {
    const h = tank();
    h.out('Fill_Valve', true);
    const at = (alias: string, v: boolean) => {
      h.runUntil(() => h.inBool(alias) === v, 30_000);
      return h.obsNum('level');
    };
    expect(at('LSL_101', true)).toBeCloseTo(10, 0);
    expect(at('LSH_101', true)).toBeCloseTo(90, 0);
    expect(at('LSHH_101', false)).toBeCloseTo(97, 0);
    expect(h.inBool('LSL_101')).toBe(true);
    expect(h.inBool('LSH_101')).toBe(true);
  });

  it('overflow: spills once per overflow event, only while net inflow at 100 %', () => {
    const h = tank();
    h.out('Fill_Valve', true);
    h.run(22_300);
    expect(h.obsNum('level')).toBe(100);
    expect(h.obs('overflow')).toBe(true);
    expect(h.obs('spills')).toBe(1);
    expect(h.state.spillRate).toBeCloseTo(4.5);
    h.run(3000);
    expect(h.obs('spills')).toBe(1);
    h.out('Drain_Valve', true); // drain 5 > fill 4.5: stops spilling
    h.step();
    expect(h.state.spillRate).toBe(0);
    expect(h.obs('overflow')).toBe(true); // the event ends once the level is below 99.5 %…
    h.run(1100);
    expect(h.obs('overflow')).toBe(false);
    h.run(900);
    h.out('Drain_Valve', false);
    h.run(3000);
    expect(h.obs('overflow')).toBe(true);
    expect(h.obs('spills')).toBe(2);
    h.out('Fill_Valve', false);
    h.run(1990);
    expect(h.obs('overflow')).toBe(true); // …or once nothing has gone over the rim for 2 s
    h.step();
    expect(h.obs('overflow')).toBe(false);
    expect(h.obs('spills')).toBe(2);
  });

  it('a fill valve chattering at the rim is ONE overflow event (not one spill per scan)', () => {
    // Valve toggled every 10 ms scan at 100 %.
    const h = tank();
    h.state.level = 99.9;
    let on = true;
    h.run(30_000, () => {
      h.out('Fill_Valve', on);
      on = !on;
    });
    expect(h.obs('spills')).toBe(1);
    expect(h.obs('overflow')).toBe(true);
    // The classic rung without hysteresis on the noisy transmitter: LES LT_101 100.0 OTE Fill_Valve.
    const g = createHarness(tankProcessLogic, {
      plc: (io) => io.setOutput('Fill_Valve', io.inputNumber('LT_101') < 100),
    });
    let toggles = 0;
    let prev = false;
    let overflowDrops = 0;
    let wasOverflow = false;
    g.run(60_000, () => {
      if (g.state.fillValve !== prev) toggles++;
      prev = g.state.fillValve;
      const ov = g.obs('overflow') === true;
      if (wasOverflow && !ov) overflowDrops++;
      wasOverflow = ov;
    });
    expect(toggles).toBeGreaterThan(100); // it really chatters…
    expect(g.obs('spills')).toBe(1); // …but it is one overflow
    expect(overflowDrops).toBe(0);
  });
});

describe('tank-process: heat', () => {
  it('heater adds 1.2 °C/s × 50 / max(level, 20) (above 10 %)', () => {
    for (const [lvl, rate] of [[50, 1.2], [100, 0.6], [15, 3.0]] as const) {
      const h = tank();
      h.state.level = lvl;
      h.out('Heater', true);
      h.run(1000);
      // cooling term at ~20 °C is negligible over 1 s
      expect(h.obsNum('temperature') - 20).toBeCloseTo(rate, 1);
      expect(h.obs('heaterOn')).toBe(true);
    }
  });

  it('heating an (almost) empty tank does nothing to the liquid but counts dryHeatMs', () => {
    const h = tank();
    h.state.level = 5;
    h.out('Heater', true);
    h.run(2500);
    expect(h.obsNum('temperature')).toBeCloseTo(20, 6);
    expect(h.obs('dryHeatMs')).toBe(2500);
    expect(h.state.heaterDry).toBe(true);
  });

  it('cools toward 20 °C (Newton) and 15 °C inflow mixes in proportionally', () => {
    const h = tank();
    h.state.level = 50;
    h.state.temperature = 70;
    h.run(10_000);
    expect(h.obsNum('temperature')).toBeCloseTo(20 + 50 * Math.exp(-TANK_PROCESS.coolingCoeff * 10), 1);
    const h2 = tank();
    h2.state.level = 45;
    h2.state.temperature = 60;
    h2.out('Fill_Valve', true);
    h2.run(10_000); // adds 45 % at 15 °C -> 37.5 °C less a little cooling
    expect(h2.obsNum('temperature')).toBeGreaterThan(36);
    expect(h2.obsNum('temperature')).toBeLessThan(37.5);
  });

  it('the spec batch is reachable: 90 % from 15 °C reaches 60 °C in about 80 s', () => {
    const h = tank();
    h.state.level = 90;
    h.state.temperature = 15;
    h.out('Heater', true);
    const ms = h.runUntil(() => h.obsNum('temperature') >= 60, 120_000);
    expect(ms).toBeGreaterThan(70_000);
    expect(ms).toBeLessThan(85_000);
  });

  it('never exceeds boiling', () => {
    const h = tank();
    h.state.level = 20;
    h.out('Heater', true);
    h.run(60_000);
    expect(h.obsNum('temperature')).toBe(100);
    expect(h.state.boiling).toBe(true);
  });
});

describe('tank-process: agitator', () => {
  it('Mixer_Running follows the Mixer output with 100 ms; E-stop drops it (hardwired)', () => {
    const h = tank();
    h.state.level = 50;
    h.out('Mixer', true);
    h.run(90);
    expect(h.inBool('Mixer_Running')).toBe(false);
    h.run(10);
    expect(h.inBool('Mixer_Running')).toBe(true);
    expect(h.obs('mixerRunning')).toBe(true);
    h.run(3000);
    expect(h.state.agitatorRpm).toBeGreaterThan(85);
    h.set('estop', true);
    h.run(90);
    expect(h.inBool('Mixer_Running')).toBe(true);
    h.run(10);
    expect(h.inBool('Mixer_Running')).toBe(false);
    expect(h.obs('dryRunMs')).toBe(0);
  });

  it('running the agitator below 10 % counts dryRunMs', () => {
    const h = tank();
    h.state.level = 8;
    h.out('Mixer', true);
    h.run(1500);
    expect(h.obs('dryRunMs')).toBe(1500);
  });
});

describe('tank-process: instruments & faults', () => {
  it('transmitter noise is within ±0.05 % of span', () => {
    const h = tank();
    h.state.level = 42;
    h.state.temperature = 55;
    let maxLt = 0;
    let maxTt = 0;
    const lts = new Set<number>();
    h.run(5000, () => {
      maxLt = Math.max(maxLt, Math.abs(h.inNum('LT_101') - h.state.level));
      maxTt = Math.max(maxTt, Math.abs(h.inNum('TT_101') - h.state.temperature));
      lts.add(h.inNum('LT_101'));
    });
    expect(maxLt).toBeLessThanOrEqual(0.05);
    expect(maxTt).toBeLessThanOrEqual(0.075);
    expect(lts.size).toBeGreaterThan(100); // it really is noisy
  });

  it('lt_fail: LT_101 reads 0.0 and the 1756-IF8 raises Ch0Fault + Ch0Underrange; lsh_fail: LSH_101 stuck at 0', () => {
    const h = tank();
    h.state.level = 95;
    h.step();
    expect(h.inBool('Local:3:I.Ch0Fault')).toBe(false);
    expect(h.inBool('Local:3:I.Ch0Underrange')).toBe(false);
    h.set('lt_fail', true);
    h.set('lsh_fail', true);
    h.step();
    expect(h.inNum('LT_101')).toBe(0);
    expect(h.state.ltChannelFault).toBe(true);
    expect(h.inBool('Local:3:I.Ch0Fault')).toBe(true);
    expect(h.inBool('Local:3:I.Ch0Underrange')).toBe(true);
    expect(h.inNum('TT_101')).toBeGreaterThan(19); // other channels unaffected
    expect(h.inBool('LSH_101')).toBe(false);
    expect(h.inBool('LSL_101')).toBe(true);
    h.set('lt_fail', false);
    h.set('lsh_fail', false);
    h.step();
    expect(h.inNum('LT_101')).toBeCloseTo(95, 1);
    expect(h.inBool('Local:3:I.Ch0Fault')).toBe(false);
    expect(h.inBool('Local:3:I.Ch0Underrange')).toBe(false);
    expect(h.inBool('LSH_101')).toBe(true);
  });

  it('writes the LT-101 channel status bits on every step (not wired aliases, but real module members)', () => {
    const h = tank();
    for (let i = 0; i < 5; i++) {
      h.io.clearWritten();
      h.step();
      expect(h.io.written.has('Local:3:I.Ch0Fault')).toBe(true);
      expect(h.io.written.has('Local:3:I.Ch0Underrange')).toBe(true);
    }
    // They are not part of the wired I/O list (no alias tags are created for them).
    expect(tankProcessLogic.io.some((p) => p.operand.includes('Fault') || p.operand.includes('range'))).toBe(false);
  });

  it('lights and horn follow the outputs', () => {
    const h = tank();
    h.out('Alarm_Horn', true);
    h.out('Running_Light', true);
    h.step();
    expect(h.observe()).toMatchObject({ alarmHorn: true, runningLight: true, batchDoneLight: false });
  });
});

describe('tank-process: batch accounting', () => {
  /** Reference batch sequence: fill to LSH, mix + heat to 60 °C, drain to empty. */
  function batchPlc(opts: { heat: boolean; mixSeconds: number }): FakePlc {
    let phase: 'fill' | 'heat' | 'drain' | 'done' = 'fill';
    let mixStart = 0;
    return (io, t) => {
      if (phase === 'fill') {
        io.setOutput('Fill_Valve', true);
        if (io.inputBool('LSH_101')) {
          io.setOutput('Fill_Valve', false);
          phase = 'heat';
          mixStart = t;
        }
      } else if (phase === 'heat') {
        const mixing = t - mixStart < opts.mixSeconds * 1000;
        io.setOutput('Mixer', mixing);
        io.setOutput('Heater', opts.heat);
        const hot = !opts.heat || io.inputNumber('TT_101') >= 61;
        if (hot && !mixing) {
          io.setOutput('Heater', false);
          phase = 'drain';
        }
      } else if (phase === 'drain') {
        io.setOutput('Mixer', false);
        io.setOutput('Drain_Valve', true);
        if (io.inputNumber('LT_101') <= 0.5) {
          io.setOutput('Drain_Valve', false);
          phase = 'done';
        }
      }
    };
  }

  it('fill ≥ 85 %, heat ≥ 60 °C, mix ≥ 5 s, drain < 5 % → one batch', () => {
    const h = createHarness(tankProcessLogic, { plc: batchPlc({ heat: true, mixSeconds: 6 }) });
    h.runUntil(() => h.obs('batches') === 1, 200_000);
    expect(h.state.batch.lastResult).toBe('complete');
    expect(h.obs('spills')).toBe(0);
    expect(h.obs('dryRunMs')).toBe(0);
    expect(h.obs('dryHeatMs')).toBe(0);
  });

  it('not heated or mixed too briefly → no batch', () => {
    const cold = createHarness(tankProcessLogic, { plc: batchPlc({ heat: false, mixSeconds: 6 }) });
    cold.run(60_000);
    expect(cold.obs('batches')).toBe(0);
    expect(cold.state.batch.lastResult).toBe('incomplete');
    const brief = createHarness(tankProcessLogic, { plc: batchPlc({ heat: true, mixSeconds: 3 }) });
    brief.run(200_000);
    expect(brief.obs('batches')).toBe(0);
    expect(brief.state.batch.lastResult).toBe('incomplete');
  });
});
