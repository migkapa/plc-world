import { describe, expect, it } from 'vitest';
import { bool, control, counter, dint, runLogic, scanN, timer } from '../testUtils';
import type { CounterValue, TimerValue } from '../types';

describe('TON', () => {
  it('times while enabled, sets DN at PRE, clamps ACC and resets when the rung goes false', () => {
    const plc = runLogic(['XIC(En)TON(T1,1000,0);'], [bool('En'), timer('T1')]);
    const t = () => plc.tags.getStruct<TimerValue>('T1')!;
    expect(t().PRE).toBe(1000); // preset from the instruction box
    plc.tags.writeBool('En', true);
    plc.scan(10); // first enabled scan only starts the timer
    expect(t()).toMatchObject({ EN: true, TT: true, DN: false, ACC: 0 });
    scanN(plc, 50);
    expect(t().ACC).toBe(500);
    scanN(plc, 49);
    expect(t()).toMatchObject({ ACC: 990, DN: false, TT: true });
    plc.scan(10);
    expect(t()).toMatchObject({ ACC: 1000, DN: true, TT: false, EN: true });
    scanN(plc, 20);
    expect(t().ACC).toBe(1000);
    plc.tags.writeBool('En', false);
    plc.scan(10);
    expect(t()).toMatchObject({ ACC: 0, EN: false, TT: false, DN: false });
  });

  it('uses the scan dt (variable scan times) and does not overshoot PRE', () => {
    const plc = runLogic(['XIC(En)TON(T1,100,0);'], [bool('En', { initial: true }), timer('T1')]);
    plc.scan(7);
    plc.scan(33);
    expect(plc.tags.readNumber('T1.ACC')).toBe(33);
    plc.scan(50);
    expect(plc.tags.readNumber('T1.ACC')).toBe(83);
    plc.scan(50);
    expect(plc.tags.readNumber('T1.ACC')).toBe(100);
    expect(plc.tags.readBool('T1.DN')).toBe(true);
  });

  it('carries fractional milliseconds between scans', () => {
    const plc = runLogic(['XIC(En)TON(T1,100,0);'], [bool('En', { initial: true }), timer('T1')]);
    plc.scan(7.5);
    for (let i = 0; i < 4; i++) plc.scan(7.5);
    expect(plc.tags.readNumber('T1.ACC')).toBe(30);
  });

  it('a self-resetting timer pulses every PRE + 2 scans (one scan to reset, one to restart)', () => {
    const plc = runLogic(['XIO(Pulse.DN)TON(Pulse,100,0);', 'XIC(Pulse.DN)ONS(P_ONS)ADD(Ticks,1,Ticks);'], [
      timer('Pulse'),
      bool('P_ONS'),
      dint('Ticks'),
    ]);
    scanN(plc, 101); // 1010 ms: DN on scans 11, 23, 35 … 95 (period 120 ms)
    expect(plc.tags.readNumber('Ticks')).toBe(8);
  });

  it('faults with T04:C34 on a negative preset', () => {
    const plc = runLogic(['XIC(En)TON(T1,-5,0);'], [bool('En', { initial: true }), timer('T1')]);
    plc.scan(10);
    const st = plc.getStatus();
    expect(st.mode).toBe('FAULTED');
    expect(st.majorFault).toMatchObject({ type: 4, code: 34, program: 'MainProgram', routine: 'MainRoutine', rungIndex: 0 });
    expect(st.displayText).toBe('Major Fault T04:C34');
  });
});

describe('TOF', () => {
  it('keeps DN on for PRE ms after the rung goes false', () => {
    const plc = runLogic(['XIC(En)TOF(T1,300,0);'], [bool('En'), timer('T1')]);
    const t = () => plc.tags.getStruct<TimerValue>('T1')!;
    plc.scan(10);
    expect(t()).toMatchObject({ DN: false, ACC: 300 }); // prescan sets ACC = PRE
    plc.tags.writeBool('En', true);
    plc.scan(10);
    expect(t()).toMatchObject({ EN: true, DN: true, TT: false, ACC: 0 });
    plc.tags.writeBool('En', false);
    plc.scan(10);
    expect(t()).toMatchObject({ EN: false, DN: true, TT: true, ACC: 0 });
    scanN(plc, 29);
    expect(t()).toMatchObject({ DN: true, ACC: 290 });
    plc.scan(10);
    expect(t()).toMatchObject({ DN: false, TT: false, ACC: 300 });
  });

  it('restarts when the rung goes true again before timing out', () => {
    const plc = runLogic(['XIC(En)TOF(T1,300,0);'], [bool('En', { initial: true }), timer('T1')]);
    plc.scan(10);
    plc.tags.writeBool('En', false);
    scanN(plc, 20);
    plc.tags.writeBool('En', true);
    plc.scan(10);
    expect(plc.tags.readNumber('T1.ACC')).toBe(0);
    expect(plc.tags.readBool('T1.DN')).toBe(true);
  });
});

describe('RTO', () => {
  it('retains ACC when the rung goes false and is cleared by RES', () => {
    const plc = runLogic(['XIC(En)RTO(T1,1000,0);', 'XIC(Rst)RES(T1);'], [bool('En'), bool('Rst'), timer('T1')]);
    plc.tags.writeBool('En', true);
    scanN(plc, 41);
    expect(plc.tags.readNumber('T1.ACC')).toBe(400);
    plc.tags.writeBool('En', false);
    scanN(plc, 10);
    expect(plc.tags.readNumber('T1.ACC')).toBe(400);
    expect(plc.tags.readBool('T1.EN')).toBe(false);
    plc.tags.writeBool('En', true);
    scanN(plc, 61);
    expect(plc.tags.readBool('T1.DN')).toBe(true);
    expect(plc.tags.readNumber('T1.ACC')).toBe(1000);
    plc.tags.writeBool('En', false);
    plc.scan(10);
    expect(plc.tags.readBool('T1.DN')).toBe(true);
    plc.tags.writeBool('Rst', true);
    plc.scan(10);
    expect(plc.tags.getStruct<TimerValue>('T1')).toMatchObject({ ACC: 0, DN: false, EN: false, TT: false });
  });
});

describe('CTU / CTD', () => {
  it('counts rising edges only', () => {
    const plc = runLogic(['XIC(PE)CTU(C1,3,0);'], [bool('PE'), counter('C1')]);
    plc.scan(10); // first scan (prescan) with the rung false
    for (const v of [true, true, false, true, false, true]) {
      plc.tags.writeBool('PE', v);
      plc.scan(10);
    }
    expect(plc.tags.getStruct<CounterValue>('C1')).toMatchObject({ ACC: 3, DN: true, CU: true, PRE: 3 });
  });

  it('does not count a rung that is already true on the first scan (prescan sets CU)', () => {
    const plc = runLogic(['XIC(PE)CTU(C1,3,0);'], [bool('PE', { initial: true }), counter('C1')]);
    scanN(plc, 3);
    expect(plc.tags.readNumber('C1.ACC')).toBe(0);
  });

  it('counts up and down on the same counter with DN = ACC >= PRE', () => {
    const plc = runLogic(['XIC(In)CTU(Cars,2,0);', 'XIC(Out)CTD(Cars,2,0);'], [bool('In'), bool('Out'), counter('Cars')]);
    plc.scan(10);
    const pulse = (tag: string) => {
      plc.tags.writeBool(tag, true);
      plc.scan(10);
      plc.tags.writeBool(tag, false);
      plc.scan(10);
    };
    pulse('In');
    pulse('In');
    expect(plc.tags.readBool('Cars.DN')).toBe(true);
    pulse('Out');
    expect(plc.tags.readNumber('Cars.ACC')).toBe(1);
    expect(plc.tags.readBool('Cars.DN')).toBe(false);
    pulse('Out');
    pulse('Out');
    expect(plc.tags.readNumber('Cars.ACC')).toBe(-1);
  });

  it('sets OV on overflow and clears UN when counting back into range', () => {
    const plc = runLogic(['XIC(Up)CTU(C1,0,0);', 'XIC(Dn)CTD(C1,0,0);'], [bool('Up'), bool('Dn'), counter('C1', { initial: { ACC: 2147483647 } })]);
    plc.scan(10);
    plc.tags.writeNumber('C1.ACC', 2147483647);
    plc.tags.writeBool('Up', true);
    plc.scan(10);
    expect(plc.tags.getStruct<CounterValue>('C1')).toMatchObject({ ACC: -2147483648, OV: true, UN: false });
    plc.tags.writeBool('Dn', true);
    plc.scan(10);
    // counting down back past the limit clears OV instead of setting UN
    expect(plc.tags.getStruct<CounterValue>('C1')).toMatchObject({ ACC: 2147483647, OV: false, UN: false });
    plc.tags.writeBool('Dn', false);
    plc.scan(10);
    plc.tags.writeNumber('C1.ACC', -2147483648);
    plc.tags.writeBool('Dn', true);
    plc.scan(10);
    expect(plc.tags.getStruct<CounterValue>('C1')).toMatchObject({ ACC: 2147483647, UN: true, OV: false });
    plc.tags.writeBool('Up', false);
    plc.scan(10);
    plc.tags.writeBool('Up', true);
    plc.scan(10);
    expect(plc.tags.getStruct<CounterValue>('C1')).toMatchObject({ ACC: -2147483648, UN: false, OV: false });
  });

  it('RES clears ACC, OV, UN, DN but keeps the CU edge memory', () => {
    const plc = runLogic(['XIC(PE)CTU(C1,1,0);', 'XIC(Rst)RES(C1);'], [bool('PE'), bool('Rst'), counter('C1')]);
    plc.scan(10);
    plc.tags.writeBool('PE', true);
    plc.scan(10);
    expect(plc.tags.readBool('C1.DN')).toBe(true);
    plc.tags.writeBool('Rst', true);
    plc.scan(10);
    expect(plc.tags.getStruct<CounterValue>('C1')).toMatchObject({ ACC: 0, DN: false, CU: true });
    plc.tags.writeBool('Rst', false);
    plc.scan(10);
    expect(plc.tags.readNumber('C1.ACC')).toBe(0); // PE still held: no new edge
  });

  it('RES clears a CONTROL structure', () => {
    const plc = runLogic(['XIC(Rst)RES(Ctl);'], [bool('Rst', { initial: true }), control('Ctl', { initial: { POS: 3, LEN: 4, DN: true, EN: true } })]);
    plc.scan(10);
    expect(plc.tags.readValue('Ctl')).toMatchObject({ POS: 0, LEN: 4, DN: false, EN: false });
  });
});
