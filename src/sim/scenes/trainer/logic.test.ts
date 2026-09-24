import { describe, expect, it } from 'vitest';
import { createHarness, sceneContractSuite } from '../../testing';
import { trainerLogic } from './logic';

sceneContractSuite(trainerLogic, {
  id: 'trainer',
  controls: [
    'sw0', 'sw1', 'sw2', 'sw3', 'sw4', 'sw5', 'sw6', 'sw7',
    'pb_green', 'pb_red', 'pb_black1', 'pb_black2', 'pot1', 'pot2',
  ],
  observables: [
    'light0', 'light1', 'light2', 'light3', 'light4', 'light5', 'light6', 'light7',
    'buzzer', 'meter1', 'meter2', 'buzzerOnMs',
  ],
});

describe('trainer: hardware & wiring', () => {
  it('uses the specified ControlLogix rack', () => {
    const hw = trainerLogic.hardware;
    expect(hw.platform).toBe('ControlLogix');
    expect(hw.chassis).toBe('1756-A7');
    expect(hw.powerSupply).toBe('1756-PA72');
    expect(hw.modules.map((m) => [m.slot, m.catalog, m.name ?? null])).toEqual([
      [0, '1756-L85E', null],
      [1, '1756-IB16', 'DI_Bench'],
      [2, '1756-OB16E', 'DO_Bench'],
      [3, '1756-IF8', 'AI_Bench'],
      [4, '1756-OF8', 'AO_Bench'],
      [5, '1756-EN2T', 'ENET_Bench'],
    ]);
  });

  it('maps every alias to the exact operand', () => {
    const map = Object.fromEntries(trainerLogic.io.map((p) => [p.alias, p.operand]));
    for (let i = 0; i < 8; i++) {
      expect(map[`Switch_${i}`]).toBe(`Local:1:I.Data.${i}`);
      expect(map[`Light_${i}`]).toBe(`Local:2:O.Data.${i}`);
    }
    expect(map).toMatchObject({
      PB_Green: 'Local:1:I.Data.8',
      PB_Red: 'Local:1:I.Data.9',
      PB_Black_1: 'Local:1:I.Data.10',
      PB_Black_2: 'Local:1:I.Data.11',
      Buzzer: 'Local:2:O.Data.8',
      Pot_1: 'Local:3:I.Ch0Data',
      Pot_2: 'Local:3:I.Ch1Data',
      Meter_1: 'Local:4:O.Ch0Data',
      Meter_2: 'Local:4:O.Ch1Data',
    });
    expect(trainerLogic.io).toHaveLength(8 + 4 + 8 + 1 + 2 + 2);
  });
});

describe('trainer: inputs', () => {
  it('toggle switches are maintained and read 1 when ON', () => {
    const h = createHarness(trainerLogic);
    h.step();
    for (let i = 0; i < 8; i++) expect(h.inBool(`Switch_${i}`)).toBe(false);
    h.set('sw3', true);
    h.set('sw7', true);
    h.run(50);
    expect(h.inBool('Switch_3')).toBe(true);
    expect(h.inBool('Switch_7')).toBe(true);
    expect(h.inBool('Switch_0')).toBe(false);
    h.run(1000);
    expect(h.inBool('Switch_3')).toBe(true); // stays on (maintained)
    h.set('sw3', false);
    h.step();
    expect(h.inBool('Switch_3')).toBe(false);
  });

  it('N.O. buttons read 1 only while pressed; the red N.C. button reads 1 until pressed', () => {
    const h = createHarness(trainerLogic);
    h.step();
    expect(h.inBool('PB_Green')).toBe(false);
    expect(h.inBool('PB_Black_1')).toBe(false);
    expect(h.inBool('PB_Black_2')).toBe(false);
    expect(h.inBool('PB_Red')).toBe(true);
    for (const [id, alias] of [
      ['pb_green', 'PB_Green'],
      ['pb_black1', 'PB_Black_1'],
      ['pb_black2', 'PB_Black_2'],
    ] as const) {
      h.set(id, true);
      h.step();
      expect(h.inBool(alias)).toBe(true);
      h.set(id, false);
      h.step();
      expect(h.inBool(alias)).toBe(false);
    }
    h.set('pb_red', true);
    h.step();
    expect(h.inBool('PB_Red')).toBe(false);
    h.set('pb_red', false);
    h.step();
    expect(h.inBool('PB_Red')).toBe(true);
  });

  it('potentiometers write REAL 0–100 % and clamp out-of-range control values', () => {
    const h = createHarness(trainerLogic);
    h.set('pot1', 42.5);
    h.set('pot2', 150);
    h.step();
    expect(h.inNum('Pot_1')).toBeCloseTo(42.5);
    expect(h.inNum('Pot_2')).toBe(100);
    expect(h.get('pot2')).toBe(100);
    h.set('pot2', -5);
    h.step();
    expect(h.inNum('Pot_2')).toBe(0);
  });
});

describe('trainer: outputs', () => {
  it('pilot lights and buzzer follow the outputs', () => {
    const h = createHarness(trainerLogic);
    h.out('Light_0', true);
    h.out('Light_5', true);
    h.out('Buzzer', true);
    h.step();
    const o = h.observe();
    expect(o.light0).toBe(true);
    expect(o.light5).toBe(true);
    expect(o.light1).toBe(false);
    expect(o.buzzer).toBe(true);
    expect(h.state.lights).toEqual([true, false, false, false, false, true, false, false]);
  });

  it('everything is off when the controller is not running', () => {
    const h = createHarness(trainerLogic);
    for (let i = 0; i < 8; i++) h.out(`Light_${i}`, true);
    h.out('Meter_1', 70);
    h.io.running = false;
    h.step();
    expect(h.state.lights.every((l) => !l)).toBe(true);
    expect(h.obs('meter1')).toBe(0);
  });

  it('meters clamp to what the scale can show; bar graph lights 10 % segments', () => {
    const h = createHarness(trainerLogic);
    h.out('Meter_1', 55.5);
    h.out('Meter_2', 37);
    h.step();
    expect(h.obs('meter1')).toBeCloseTo(55.5);
    expect(h.obs('meter2')).toBe(37);
    expect(h.state.barSegments).toBe(4);
    h.out('Meter_1', 140);
    h.out('Meter_2', -20);
    h.step();
    expect(h.obs('meter1')).toBe(100);
    expect(h.obs('meter2')).toBe(0);
    expect(h.state.meter1Raw).toBe(140);
  });

  it('meter needle swings to the reading and settles', () => {
    const h = createHarness(trainerLogic);
    h.out('Meter_1', 80);
    h.run(100);
    expect(h.state.needle1).toBeGreaterThan(5);
    expect(h.state.needle1).toBeLessThan(80);
    h.run(1500);
    expect(h.state.needle1).toBeCloseTo(80, 0);
  });

  it('buzzerOnMs accumulates only while the buzzer is on', () => {
    const h = createHarness(trainerLogic);
    h.run(500);
    expect(h.obs('buzzerOnMs')).toBe(0);
    h.out('Buzzer', true);
    h.run(1230);
    h.out('Buzzer', false);
    h.run(700);
    expect(h.obs('buzzerOnMs')).toBe(1230);
  });
});
