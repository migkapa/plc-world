import { describe, expect, it } from 'vitest';
import { createDemoRuntime } from '../../demo';
import { CONVEYOR_DEMO_RUNGS, CONVEYOR_DEMO_RUNGS_NO_TAGS, CONVEYOR_DEMO_TAGS } from './demo';
import { definition } from './definition';
import { conveyorSortLogic } from './logic';

const run = (rt: { step(ms: number): void }, ms: number) => {
  for (let t = 0; t < ms; t += 100) rt.step(100);
};
const tap = (rt: { setControl(id: string, v: boolean): void; step(ms: number): void }, id: string) => {
  rt.setControl(id, true);
  rt.step(200);
  rt.setControl(id, false);
  rt.step(100);
};

const variants = [
  { name: 'reference (BOOL / TIMER tags)', rungs: CONVEYOR_DEMO_RUNGS, tags: CONVEYOR_DEMO_TAGS },
  { name: 'bare starter project fallback', rungs: CONVEYOR_DEMO_RUNGS_NO_TAGS, tags: undefined },
];

describe.each(variants)('conveyor-sort demo program ($name)', ({ rungs, tags }) => {
  const setup = () => createDemoRuntime(conveyorSortLogic, rungs, { tags });

  it('verifies and does NOT start by itself (amber = ready)', () => {
    const { controller, runtime } = setup();
    expect(controller.verify()).toEqual([]);
    run(runtime, 3000);
    const o = runtime.observe();
    expect(o.conveyorRunning).toBe(false);
    expect(o.lightAmber).toBe(true);
    expect(o.lightGreen).toBe(false);
    expect(o.boxesFed).toBe(0);
  });

  it.each([0, 1, 2, 3])('sorts box pattern %i without missorts or jams (AUTO feeder)', (pattern) => {
    const { runtime } = setup();
    runtime.setControl('box_pattern', pattern);
    tap(runtime, 'start');
    run(runtime, 120_000);
    const o = runtime.observe();
    expect(Number(o.boxesFed)).toBeGreaterThan(40);
    expect(o.missorted).toBe(0);
    expect(o.jams).toBe(0);
    if (pattern !== 1) expect(Number(o.boxesRejected)).toBeGreaterThan(10);
    if (pattern !== 2) expect(Number(o.boxesGood)).toBeGreaterThan(10);
  });

  it('keeps feeding and sorting in PLC feeder mode', () => {
    const { runtime } = setup();
    runtime.setControl('feeder_mode', 1);
    tap(runtime, 'start');
    run(runtime, 120_000);
    const o = runtime.observe();
    expect(Number(o.boxesFed)).toBeGreaterThan(40);
    expect(o.missorted).toBe(0);
    expect(o.jams).toBe(0);
  });

  it('survives stop / start and an E-stop (restart needs START)', () => {
    const { runtime } = setup();
    tap(runtime, 'start');
    run(runtime, 20_000);
    tap(runtime, 'stop');
    run(runtime, 3000);
    expect(runtime.observe().conveyorRunning).toBe(false);
    tap(runtime, 'start');
    run(runtime, 20_000);
    runtime.setControl('estop', true);
    run(runtime, 1000);
    expect(runtime.observe().lightRed).toBe(true);
    runtime.setControl('estop', false);
    run(runtime, 2000);
    expect(runtime.observe().conveyorRunning).toBe(false);
    tap(runtime, 'start');
    run(runtime, 40_000);
    const o = runtime.observe();
    expect(o.conveyorRunning).toBe(true);
    expect(o.missorted).toBe(0);
  });

  it('never drives the unwired OB16E points 6-15', () => {
    const { controller, runtime } = setup();
    tap(runtime, 'start');
    for (let t = 0; t < 30_000; t += 10) {
      runtime.step(10);
      for (let b = 6; b < 16; b++) expect(controller.tags.readBool(`Local:2:O.Data.${b}`)).toBe(false);
    }
  });
});

describe('conveyor-sort definition', () => {
  it('ships the tagged demo with its tags', () => {
    expect(definition.demoRungs).toBe(CONVEYOR_DEMO_RUNGS);
    expect(definition.demoTags).toBe(CONVEYOR_DEMO_TAGS);
  });
});
