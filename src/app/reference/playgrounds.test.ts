import { describe, expect, it } from 'vitest';
import { INSTRUCTION_DEFS } from '../../plc/instructions';
import { parseRung } from '../../plc/neutralText';
import { createDemoRuntime } from '../../sim/demo';
import { trainerLogic } from '../../sim/scenes';
import { PLAYGROUNDS, type PlaygroundDef } from './playgrounds';

function boot(def: PlaygroundDef) {
  const { controller, runtime } = createDemoRuntime(trainerLogic, def.rungs, { tags: def.tags, run: false });
  for (const r of def.routines ?? []) controller.updateRoutine('MainProgram', r.name, r.rungs.map((t) => parseRung(t)));
  const errors = controller.verify().filter((e) => e.severity === 'error');
  const ran = controller.requestMode('RUN');
  // Let the prescan + first scan happen with every input off: Logix prescan sets ONS storage bits and the
  // .EN bits of FFL/BSL/…, so an input that is already on in the first scan would not trigger them.
  runtime.step(50);
  return { controller, runtime, errors, ran };
}

describe('instruction playgrounds', () => {
  it('cover every instruction', () => {
    const missing = Object.keys(INSTRUCTION_DEFS).filter((m) => !PLAYGROUNDS[m]);
    expect(missing).toEqual([]);
  });

  for (const [m, def] of Object.entries(PLAYGROUNDS)) {
    it(`${m}: verifies, runs, and every input / trace resolves`, () => {
      const { controller, runtime, errors, ran } = boot(def);
      expect(errors.map((e) => `${e.routine}#${e.rungIndex}: ${e.message}`)).toEqual([]);
      expect(ran).toBe(true);
      runtime.step(200);
      expect(controller.getStatus().mode).not.toBe('FAULTED');
      for (const i of def.inputs) expect(controller.tags.exists(i.tag), `input ${i.tag}`).toBe(true);
      for (const t of def.traces) expect(controller.tags.exists(t.tag), `trace ${t.tag}`).toBe(true);
    });
  }

  it('TON times 3 s and sets .DN', () => {
    const { controller, runtime } = boot(PLAYGROUNDS.TON!);
    controller.tags.writeBool('Start_PB', true);
    runtime.step(2000);
    expect(controller.tags.readBool('Delay_Timer.DN')).toBe(false);
    expect(controller.tags.readBool('Delay_Timer.TT')).toBe(true);
    runtime.step(1100);
    expect(controller.tags.readBool('Delay_Timer.DN')).toBe(true);
    expect(controller.tags.readBool('Motor')).toBe(true);
  });

  it('ONS counts once per press, the rung without it once per scan', () => {
    const { controller, runtime } = boot(PLAYGROUNDS.ONS!);
    controller.tags.writeBool('Count_PB', true);
    runtime.step(500);
    controller.tags.writeBool('Count_PB', false);
    runtime.step(50);
    expect(controller.tags.readNumber('Parts')).toBe(1);
    expect(controller.tags.readNumber('Parts_No_ONS')).toBeGreaterThan(40);
  });

  it('BSL shifts the source bit in on each rising edge', () => {
    const { controller, runtime } = boot(PLAYGROUNDS.BSL!);
    controller.tags.writeBool('Part_Present', true);
    for (let i = 0; i < 2; i++) {
      controller.tags.writeBool('Shift_PB', true);
      runtime.step(30);
      controller.tags.writeBool('Shift_PB', false);
      runtime.step(30);
    }
    expect(controller.tags.readNumber('Track[0]') & 0xff).toBe(0b11);
  });

  it('SQO walks the lamp pattern', () => {
    const { controller, runtime } = boot(PLAYGROUNDS.SQO!);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      runtime.step(10);
      seen.add(controller.tags.readNumber('Lamps') & 0xf);
    }
    expect([...seen].filter((v) => v !== 0).sort((a, b) => a - b)).toEqual([1, 2, 4, 8]);
  });

  it('JSR with parameters returns the scaled value', () => {
    const { controller, runtime } = boot(PLAYGROUNDS.SBR!);
    controller.tags.writeNumber('Raw_Value', 10);
    runtime.step(50);
    expect(controller.tags.readNumber('Scaled_Value')).toBeCloseTo(25, 3);
  });

  it('FFL / FFU queue first in, first out', () => {
    const { controller, runtime } = boot(PLAYGROUNDS.FFL!);
    const tapTag = (t: string) => {
      controller.tags.writeBool(t, true);
      runtime.step(30);
      controller.tags.writeBool(t, false);
      runtime.step(30);
    };
    controller.tags.writeNumber('Part_ID', 111);
    tapTag('Load_PB');
    controller.tags.writeNumber('Part_ID', 222);
    tapTag('Load_PB');
    expect(controller.tags.readNumber('Queue_Ctl.POS')).toBe(2);
    tapTag('Unload_PB');
    expect(controller.tags.readNumber('Next_Part')).toBe(111);
  });
});
