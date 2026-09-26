import { describe, expect, it } from 'vitest';
import { SCENE_IDS, SCENE_LOGICS, SCENE_LOGICS_TYPED, getSceneLogic } from '../scenes';
import { FakeIo } from './fakeIo';

describe('scene registry', () => {
  it('registers exactly the six scenes, keyed by their own ids', () => {
    expect([...SCENE_IDS]).toEqual([
      'trainer', 'motor-station', 'traffic-light', 'conveyor-sort', 'tank-process', 'parking-garage',
    ]);
    expect(Object.keys(SCENE_LOGICS).sort()).toEqual([...SCENE_IDS].sort());
    for (const id of SCENE_IDS) {
      expect(SCENE_LOGICS[id]!.id).toBe(id);
      expect(SCENE_LOGICS_TYPED[id]).toBe(SCENE_LOGICS[id]);
      expect(getSceneLogic(id)).toBe(SCENE_LOGICS[id]);
    }
    expect(getSceneLogic('nope')).toBeUndefined();
  });

  it('every scene steps with a fresh state and an idle controller', () => {
    for (const id of SCENE_IDS) {
      const logic = SCENE_LOGICS[id]!;
      const state = logic.createState();
      const io = new FakeIo(logic.io);
      io.running = false;
      for (let i = 0; i < 100; i++) logic.step(state, 10, io);
      const inputs = logic.io.filter((p) => p.dir === 'input').map((p) => p.operand);
      for (const op of inputs) expect(io.written.has(op), `${id}: ${op} written`).toBe(true);
      // Anything else written must be a status bit of a wired analog input channel (e.g. Ch0Fault).
      for (const op of io.written) {
        if (!inputs.includes(op)) expect(op).toMatch(/^Local:\d+:I\.Ch\d+\.?(Fault|Underrange|Overrange)$/);
      }
    }
  });

  it('two createState() calls are independent', () => {
    for (const id of SCENE_IDS) {
      const logic = SCENE_LOGICS[id]!;
      const a = logic.createState();
      const b = logic.createState();
      expect(a).not.toBe(b);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const c = logic.controls.find((x) => x.type === 'maintained' || x.type === 'momentary')!;
      logic.setControl(a, c.id, !c.default);
      expect(logic.getControl(b, c.id)).toBe(c.default);
    }
  });
});
