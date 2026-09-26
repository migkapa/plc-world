import { describe, expect, it } from 'vitest';
import { applyDemoStart, createDemoRuntime, describeDemoStart } from './demo';
import { SCENE_IDS } from './scenes';
import { SCENES } from './scenes/views';

const run = (rt: { step(ms: number): void }, ms: number) => {
  for (let t = 0; t < ms; t += 100) rt.step(100);
};

describe('demo start (SceneDefinition.demoStart)', () => {
  it('every scene with a demo program either runs on its own or declares how to start it', () => {
    for (const id of SCENE_IDS) {
      const def = SCENES[id];
      if (!def?.demoRungs?.length) continue;
      for (const s of def.demoStart ?? []) {
        const cid = typeof s === 'string' ? s : s[0];
        expect(def.logic.controls.some((c) => c.id === cid), `${id}: unknown control ${cid}`).toBe(true);
      }
    }
  });

  it.each([
    ['tank-process', (o: Record<string, boolean | number>) => o.fillValve === true || Number(o.level) > 1],
    ['conveyor-sort', (o: Record<string, boolean | number>) => o.conveyorRunning === true],
    ['motor-station', (o: Record<string, boolean | number>) => Number(o.motorRpm) > 100],
  ])('%s: the demo stays idle until demoStart is applied', (id, alive) => {
    const def = SCENES[id]!;
    expect(def.demoStart?.length).toBeGreaterThan(0);
    const idle = createDemoRuntime(def.logic, def.demoRungs ?? [], { tags: def.demoTags });
    run(idle.runtime, 4000);
    expect(alive(idle.runtime.observe())).toBe(false);
    const started = createDemoRuntime(def.logic, def.demoRungs ?? [], { tags: def.demoTags });
    applyDemoStart(started.runtime, def.demoStart);
    run(started.runtime, 4000);
    expect(alive(started.runtime.observe())).toBe(true);
  });

  it('describes the start steps for the operator', () => {
    expect(describeDemoStart(SCENES['tank-process']!.logic, ['start'])).toBe('Press Start.');
    expect(describeDemoStart(SCENES['motor-station']!.logic, [['hoa', 0], 'start'])).toBe('Set Hand-Off-Auto to HAND, then press Start.');
    expect(describeDemoStart(SCENES['trainer']!.logic, undefined)).toBeNull();
  });
});
