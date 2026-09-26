import { describe, expect, it } from 'vitest';
import { createController } from '../plc/controller';
import { createProjectForScene } from './project';
import { createSimRuntime } from './runtime';
import type { SceneLogic } from './types';

interface MotorState {
  start: boolean;
  stop: boolean;
  speedRef: number;
  contactor: boolean;
  starts: number;
  meter: number;
}

/** Tiny plant: N.O. start button, N.C. stop button, contactor coil, a pot and a meter. */
const motorScene: SceneLogic<MotorState> = {
  id: 'fake-motor',
  title: 'Fake motor',
  summary: 'Seal-in test plant',
  hardware: {
    platform: 'ControlLogix',
    chassis: '1756-A7',
    powerSupply: '1756-PA72',
    modules: [
      { slot: 0, catalog: '1756-L85E' },
      { slot: 1, catalog: '1756-IB16' },
      { slot: 2, catalog: '1756-OB16E' },
      { slot: 3, catalog: '1756-IF8' },
      { slot: 4, catalog: '1756-OF8' },
    ],
  },
  io: [
    { operand: 'Local:1:I.Data.0', alias: 'Start_PB', dir: 'input', signal: 'digital', device: '800F green flush PB (N.O.)', description: '1 while pressed' },
    { operand: 'Local:1:I.Data.1', alias: 'Stop_PB', dir: 'input', signal: 'digital', device: '800F red extended PB (N.C.)', description: '0 while pressed' },
    { operand: 'Local:2:O.Data.0', alias: 'Motor', dir: 'output', signal: 'digital', device: '100-C09 contactor coil', description: '' },
    { operand: 'Local:3:I.Ch0Data', alias: 'Speed_Pot', dir: 'input', signal: 'analog', device: 'Potentiometer', description: '', units: '%', range: [0, 100] },
    { operand: 'Local:4:O.Ch0Data', alias: 'Speed_Meter', dir: 'output', signal: 'analog', device: 'Analog meter', description: '', units: '%', range: [0, 100] },
  ],
  controls: [
    { id: 'start', label: 'Start', type: 'momentary', default: false },
    { id: 'stop', label: 'Stop', type: 'momentary', default: false },
    { id: 'pot', label: 'Speed', type: 'analog', default: 0, range: [0, 100] },
  ],
  observables: [
    { id: 'contactor', label: 'Contactor', type: 'boolean' },
    { id: 'starts', label: 'Starts', type: 'number' },
    { id: 'meter', label: 'Meter', type: 'number' },
  ],
  createState: () => ({ start: false, stop: false, speedRef: 0, contactor: false, starts: 0, meter: 0 }),
  step(s, _dt, io) {
    const coil = io.readBool('Local:2:O.Data.0');
    if (coil && !s.contactor) s.starts++;
    s.contactor = coil;
    s.meter = io.readNumber('Local:4:O.Ch0Data');
    io.writeBool('Local:1:I.Data.0', s.start);
    io.writeBool('Local:1:I.Data.1', !s.stop);
    io.writeNumber('Local:3:I.Ch0Data', s.speedRef);
  },
  setControl(s, id, v) {
    if (id === 'start') s.start = Boolean(v);
    else if (id === 'stop') s.stop = Boolean(v);
    else if (id === 'pot') s.speedRef = Number(v);
  },
  getControl(s, id) {
    return id === 'start' ? s.start : id === 'stop' ? s.stop : s.speedRef;
  },
  observe: (s) => ({ contactor: s.contactor, starts: s.starts, meter: s.meter }),
};

const SEAL_IN = ['[XIC(Start_PB),XIC(Motor)]XIC(Stop_PB)OTE(Motor);', 'MOV(Speed_Pot,Speed_Meter);'];

function setup(opts: Parameters<typeof createSimRuntime>[2] = { notifyIntervalMs: 0 }) {
  const plc = createController(createProjectForScene(motorScene, SEAL_IN));
  expect(plc.requestMode('RUN')).toBe(true);
  const rt = createSimRuntime(plc, motorScene, opts);
  return { plc, rt };
}

describe('SimRuntime', () => {
  it('runs the seal-in circuit end to end (N.C. stop button)', () => {
    const { rt } = setup();
    rt.step(100);
    expect(rt.observe()).toMatchObject({ contactor: false, starts: 0 });
    rt.setControl('start', true);
    rt.step(50);
    rt.setControl('start', false);
    rt.step(200);
    expect(rt.observe()).toMatchObject({ contactor: true, starts: 1 });
    rt.setControl('stop', true);
    rt.step(30);
    expect(rt.observe().contactor).toBe(false);
    rt.setControl('stop', false);
    rt.step(100);
    expect(rt.observe()).toMatchObject({ contactor: false, starts: 1 });
    expect(rt.getControl('stop')).toBe(false);
  });

  it('latches a momentary tap released before any scan saw it (QA: taps lost between two slow frames)', () => {
    const { rt } = setup();
    const seen: Array<[string, boolean | number]> = [];
    rt.onControl((id, v) => seen.push([id, v]));
    rt.step(100);
    // press and release between two animation frames: no fixed step in between
    rt.setControl('start', true);
    rt.setControl('start', false);
    expect(rt.getControl('start')).toBe(true); // held for the next step
    expect(seen).toEqual([['start', true]]);
    rt.tick(16);
    expect(rt.getControl('start')).toBe(false); // released right after the step that scanned it
    expect(seen).toEqual([
      ['start', true],
      ['start', false],
    ]);
    rt.step(200);
    expect(rt.observe()).toMatchObject({ contactor: true, starts: 1 });
    // a normal press (released after a scan) is not delayed
    rt.setControl('stop', true);
    rt.step(20);
    rt.setControl('stop', false);
    expect(rt.getControl('stop')).toBe(false);
    rt.step(50);
    expect(rt.observe().contactor).toBe(false);
    // re-pressed before the latched release: stays pressed
    rt.setControl('start', true);
    rt.setControl('start', false);
    rt.setControl('start', true);
    rt.step(30);
    expect(rt.getControl('start')).toBe(true);
    rt.setControl('start', false);
    expect(rt.getControl('start')).toBe(false);
    // a reset drops a pending latched release
    rt.setControl('stop', true);
    rt.setControl('stop', false);
    rt.resetScene();
    rt.step(20);
    expect(rt.getControl('stop')).toBe(false);
    // non-momentary controls are applied as they come
    rt.setControl('pot', 40);
    rt.setControl('pot', 0);
    expect(rt.getControl('pot')).toBe(0);
  });

  it('passes analog values through the controller', () => {
    const { rt } = setup();
    rt.setControl('pot', 42.5);
    rt.step(30);
    expect(rt.observe().meter).toBe(42.5);
  });

  it('reads outputs as 0 when the controller is not running', () => {
    const { plc, rt } = setup();
    rt.setControl('pot', 60);
    rt.step(30);
    plc.requestMode('PROG');
    rt.step(20);
    expect(rt.observe().meter).toBe(0);
  });

  it('advances in fixed steps: scene.step then controller.scan', () => {
    const { plc, rt } = setup();
    expect(rt.stepMs).toBe(10);
    rt.step(25);
    expect(rt.timeMs).toBe(20);
    expect(rt.version).toBe(2);
    rt.step(5);
    expect(rt.timeMs).toBe(30);
    expect(plc.getStatus().scanCount).toBe(3);
    expect(plc.getStatus().uptimeMs).toBe(30);
  });

  it('tick() honours speed, paused and caps catch-up work', () => {
    const { rt } = setup();
    rt.tick(16);
    expect(rt.timeMs).toBe(10);
    rt.tick(4);
    expect(rt.timeMs).toBe(20);
    rt.speed = 2;
    rt.tick(15);
    expect(rt.timeMs).toBe(50);
    rt.paused = true;
    rt.tick(100);
    expect(rt.timeMs).toBe(50);
    rt.paused = false;
    rt.speed = 1;
    rt.tick(5000);
    expect(rt.timeMs).toBe(50 + 25 * 10);
    rt.tick(10);
    expect(rt.timeMs).toBe(310); // backlog was dropped
  });

  it('throttles listener notifications (~30 Hz) with an injectable clock', () => {
    let clock = 0;
    const { plc, rt } = setup({ notifyIntervalMs: 33, now: () => clock });
    let calls = 0;
    const off = rt.subscribe(() => calls++);
    rt.step(10);
    expect(calls).toBe(1);
    clock = 10;
    rt.step(10);
    clock = 20;
    rt.tick(16);
    expect(calls).toBe(1);
    clock = 40;
    rt.step(10);
    expect(calls).toBe(2);
    rt.setControl('start', true); // user actions notify immediately
    expect(calls).toBe(3);
    plc.requestMode('PROG'); // controller events are forwarded
    expect(calls).toBe(4);
    off();
    clock = 1000;
    rt.step(10);
    expect(calls).toBe(4);
  });

  it('resetScene resets the plant in place, optionally the tags', () => {
    const { plc, rt } = setup();
    const stateRef = rt.state;
    rt.setControl('start', true);
    rt.step(50);
    rt.setControl('start', false);
    rt.step(50);
    expect(plc.tags.readBool('Motor')).toBe(true);
    rt.resetScene();
    expect(rt.state).toBe(stateRef);
    expect(rt.observe()).toMatchObject({ contactor: false, starts: 0 });
    expect(rt.timeMs).toBe(0);
    expect(plc.tags.readBool('Motor')).toBe(true); // sealed in: tag values kept
    rt.resetScene({ resetTags: true });
    expect(plc.tags.readBool('Motor')).toBe(false);
  });

  it('ignores non-finite or non-positive time and speed without wedging', () => {
    const { rt } = setup();
    rt.step(Number.POSITIVE_INFINITY); // must return (no endless loop)
    rt.step(Number.NaN);
    rt.step(-10);
    expect(rt.timeMs).toBe(0);
    rt.tick(Number.POSITIVE_INFINITY);
    expect(rt.timeMs).toBe(0);
    rt.speed = Number.POSITIVE_INFINITY; // ignored
    rt.speed = Number.NaN; // ignored
    rt.speed = -1; // ignored
    expect(rt.speed).toBe(1);
    rt.tick(16);
    rt.speed = 1;
    rt.tick(100);
    rt.step(100);
    expect(rt.timeMs).toBe(10 + 100 + 100);
    expect(rt.version).toBe(21);
    rt.speed = 0; // a finite 0 pauses tick() but not step()
    rt.tick(100);
    rt.step(10);
    expect(rt.timeMs).toBe(220);
  });

  it('flushes a throttled notification when paused (listeners see the final state)', () => {
    let clock = 100;
    const { rt } = setup({ notifyIntervalMs: 33, now: () => clock });
    const versions: number[] = [];
    rt.subscribe(() => versions.push(rt.version));
    rt.tick(10);
    expect(versions).toEqual([1]);
    clock = 110;
    rt.tick(10); // throttled: version 2 not delivered yet
    expect(versions).toEqual([1]);
    rt.paused = true; // pausing notifies right away
    expect(versions).toEqual([1, 2]);
    for (let i = 0; i < 5; i++) {
      clock += 100;
      rt.tick(10);
    }
    expect(rt.version).toBe(2);
    expect(versions).toEqual([1, 2]);
  });

  it('flushes a pending notification on a later paused tick', () => {
    let clock = 0;
    const { rt } = setup({ notifyIntervalMs: 33, now: () => clock });
    let calls = 0;
    rt.subscribe(() => calls++);
    rt.step(10); // notifies (first)
    clock = 10;
    rt.step(10); // throttled: dirty
    expect(calls).toBe(1);
    rt.speed = 0; // setter notifies
    expect(calls).toBe(2);
    clock = 20;
    rt.step(10); // dirty again, throttled
    clock = 100;
    rt.tick(16); // speed 0: no step, but the pending notification is flushed
    expect(calls).toBe(3);
  });

  it('dispose() stops forwarding controller events and drops listeners', () => {
    const { plc, rt } = setup();
    let calls = 0;
    rt.subscribe(() => calls++);
    rt.dispose();
    plc.requestMode('PROG');
    rt.step(20);
    rt.setControl('start', true);
    expect(calls).toBe(0);
  });

  it('onControl() reports every setControl (unthrottled) until unsubscribed or disposed', () => {
    const { rt } = setup({ notifyIntervalMs: 1000, now: () => 0 });
    const seen: Array<[string, boolean | number]> = [];
    const off = rt.onControl((id, value) => seen.push([id, value]));
    rt.setControl('start', true);
    rt.step(10); // (a release before any scan is latched to the next step: see the momentary latch test)
    rt.setControl('start', false);
    rt.setControl('pot', 42);
    expect(seen).toEqual([
      ['start', true],
      ['start', false],
      ['pot', 42],
    ]);
    // the plant has already taken the value when listeners run
    const order: boolean[] = [];
    const off2 = rt.onControl(() => order.push(rt.getControl('stop') === true));
    rt.setControl('stop', true);
    expect(order).toEqual([true]);
    off2();
    // a throwing listener does not break the others
    const off3 = rt.onControl(() => {
      throw new Error('boom');
    });
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    try {
      rt.setControl('start', true);
    } finally {
      console.error = origError;
    }
    expect(seen[seen.length - 1]).toEqual(['start', true]);
    expect(errors.length).toBe(1);
    off3();
    off();
    rt.setControl('start', false);
    expect(seen.length).toBe(5); // start,start,pot,stop,start — nothing after off()
    const late: string[] = [];
    rt.onControl((id) => late.push(id));
    rt.dispose();
    rt.setControl('start', true);
    expect(late).toEqual([]);
  });
});
