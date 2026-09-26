import { describe, expect, it } from 'vitest';
import type { LogixController } from '../controller';
import { bool, control, dint, runLogic } from '../testUtils';

function pulse(plc: LogixController, tag: string): void {
  plc.tags.writeBool(tag, true);
  plc.scan(10);
  plc.tags.writeBool(tag, false);
  plc.scan(10);
}

describe('BSL / BSR', () => {
  it('BSL shifts bits left on each rising edge and unloads the top bit', () => {
    const plc = runLogic(['XIC(Clk)BSL(Bits[0],Ctl,Src,4);'], [bool('Clk'), bool('Src'), dint('Bits', { dims: 1 }), control('Ctl')]);
    plc.scan(10);
    expect(plc.tags.readNumber('Ctl.LEN')).toBe(4);
    plc.tags.writeBool('Src', true);
    pulse(plc, 'Clk');
    expect(plc.tags.readNumber('Bits[0]')).toBe(0b0001);
    plc.tags.writeBool('Src', false);
    pulse(plc, 'Clk');
    pulse(plc, 'Clk');
    pulse(plc, 'Clk');
    expect(plc.tags.readNumber('Bits[0]')).toBe(0b1000);
    expect(plc.tags.readBool('Ctl.UL')).toBe(false);
    plc.tags.writeBool('Clk', true);
    plc.scan(10);
    expect(plc.tags.readNumber('Bits[0]')).toBe(0);
    expect(plc.tags.readBool('Ctl.UL')).toBe(true);
    expect(plc.tags.readBool('Ctl.DN')).toBe(true);
    plc.scan(10); // held true: no further shift
    expect(plc.tags.readBool('Ctl.UL')).toBe(true);
  });

  it('BSL carries across DINT words', () => {
    const plc = runLogic(['XIC(Clk)BSL(Bits[0],Ctl,Src,40);'], [bool('Clk'), bool('Src'), dint('Bits', { dims: 2, initial: [-2147483648, 0] }), control('Ctl')]);
    plc.scan(10);
    pulse(plc, 'Clk');
    expect(plc.tags.readValue('Bits')).toEqual([0, 1]);
  });

  it('BSR shifts right and loads the source at the top', () => {
    const plc = runLogic(['XIC(Clk)BSR(Bits[0],Ctl,Src,8);'], [bool('Clk'), bool('Src', { initial: true }), dint('Bits', { dims: 1, initial: [0b1] }), control('Ctl')]);
    plc.scan(10);
    pulse(plc, 'Clk');
    expect(plc.tags.readNumber('Bits[0]')).toBe(0b1000_0000);
    expect(plc.tags.readBool('Ctl.UL')).toBe(true);
  });

  it('faults T04:C20 when LEN exceeds the array', () => {
    const plc = runLogic(['XIC(Clk)BSL(Bits[0],Ctl,Src,64);'], [bool('Clk'), bool('Src'), dint('Bits', { dims: 1 }), control('Ctl')]);
    plc.scan(10);
    pulse(plc, 'Clk');
    expect(plc.getStatus().majorFault).toMatchObject({ type: 4, code: 20 });
  });
});

describe('SQO', () => {
  it('steps through output patterns (traffic light), wrapping from LEN back to 1', () => {
    const plc = runLogic(['XIC(Step)SQO(Steps[0],16#3F,Lights,Seq,4,0);'], [
      bool('Step'),
      dint('Steps', { dims: 5, initial: [0, 0b100001, 0b100010, 0b001100, 0b010100] }),
      dint('Lights', { initial: 0x100 }),
      control('Seq'),
    ]);
    plc.scan(10);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      pulse(plc, 'Step');
      seen.push(plc.tags.readNumber('Lights'));
    }
    expect(seen).toEqual([0x100 | 0b100001, 0x100 | 0b100010, 0x100 | 0b001100, 0x100 | 0b010100, 0x100 | 0b100001]);
    expect(plc.tags.readNumber('Seq.POS')).toBe(1);
    expect(plc.tags.readBool('Seq.DN')).toBe(false);
  });

  it('sets DN at the last step and ER for an invalid length', () => {
    const plc = runLogic(['XIC(Step)SQO(Steps[0],-1,Out,Seq,2,0);', 'XIC(Step)SQO(Steps[0],-1,Out2,Bad,0,0);'], [
      bool('Step'),
      dint('Steps', { dims: 3, initial: [0, 5, 6] }),
      dint('Out'),
      dint('Out2'),
      control('Seq'),
      control('Bad'),
    ]);
    plc.scan(10);
    pulse(plc, 'Step');
    pulse(plc, 'Step');
    expect(plc.tags.readNumber('Out')).toBe(6);
    expect(plc.tags.readBool('Seq.DN')).toBe(true);
    expect(plc.tags.readBool('Bad.ER')).toBe(true);
  });
});

describe('FFL / FFU', () => {
  it('loads and unloads first-in first-out', () => {
    const plc = runLogic(['XIC(Load)FFL(Id,Queue[0],Ctl,3,0);', 'XIC(Unload)FFU(Queue[0],Out,Ctl,3,0);'], [
      bool('Load'),
      bool('Unload'),
      dint('Id'),
      dint('Out'),
      dint('Queue', { dims: 3 }),
      control('Ctl'),
    ]);
    plc.scan(10);
    expect(plc.tags.readBool('Ctl.EM')).toBe(true);
    for (const id of [11, 22, 33, 44]) {
      plc.tags.writeNumber('Id', id);
      pulse(plc, 'Load');
    }
    expect(plc.tags.readValue('Queue')).toEqual([11, 22, 33]);
    expect(plc.tags.readBool('Ctl.DN')).toBe(true);
    pulse(plc, 'Unload');
    expect(plc.tags.readNumber('Out')).toBe(11);
    expect(plc.tags.readValue('Queue')).toEqual([22, 33, 0]);
    expect(plc.tags.readNumber('Ctl.POS')).toBe(2);
    pulse(plc, 'Unload');
    pulse(plc, 'Unload');
    expect(plc.tags.readNumber('Out')).toBe(33);
    expect(plc.tags.readBool('Ctl.EM')).toBe(true);
    pulse(plc, 'Unload'); // empty: Dest unchanged
    expect(plc.tags.readNumber('Out')).toBe(33);
  });
});
