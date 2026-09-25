import { describe, expect, it } from 'vitest';
import { getMission, MISSIONS } from '../../../game/missions';
import { SCENE_LOGICS } from '../../../sim/scenes';
import { aliasesInText, ioAliasOf, splitCode } from './aliases';
import { objectiveDevices, outputObservables } from './objectiveDevices';

const trainer = SCENE_LOGICS['trainer']!;
const motor = SCENE_LOGICS['motor-station']!;

describe('alias chips in mission text', () => {
  it('finds I/O aliases and module operands (case-insensitive) in code spans', () => {
    expect(ioAliasOf('Switch_0', trainer.io)).toBe('Switch_0');
    expect(ioAliasOf('local:2:o.data.0', trainer.io)).toBe('Light_0');
    expect(ioAliasOf('Run_Timer', trainer.io)).toBeUndefined();
    expect(splitCode('XIC Switch_0 OTE Light_0', trainer.io)).toEqual([{ text: 'XIC ' }, { text: 'Switch_0', alias: 'Switch_0' }, { text: ' OTE ' }, { text: 'Light_0', alias: 'Light_0' }]);
    expect(splitCode('XIC(Start_PB)', motor.io).filter((p) => p.alias)).toEqual([{ text: 'Start_PB', alias: 'Start_PB' }]);
    expect(aliasesInText('`Light_0` turns ON when `Switch_0` is ON; `Light_0` again', trainer.io)).toEqual(['Light_0', 'Switch_0']);
    expect(aliasesInText('Switch_0 without backticks', trainer.io)).toEqual([]);
  });
});

describe('objective devices', () => {
  it('maps observables to the outputs that drive them by probing the plant', () => {
    const m = outputObservables(motor);
    expect(m.get('contactor')).toContain('Motor_Starter');
    expect(outputObservables(trainer).get('light0')).toEqual(['Light_0']);
  });

  it('uses the aliases the objective names first', () => {
    const m = getMission('1-1')!;
    expect(objectiveDevices(m, trainer, 1)).toEqual(['Light_0', 'Switch_0']);
  });

  it('falls back to the devices the proving tests use, ranked by the objective words', () => {
    const m = getMission('2-1')!;
    // 'Start runs the motor and it keeps running after Start is released (seal-in)'
    const start = objectiveDevices(m, motor, 0);
    expect(start[0]).toBe('Start_PB');
    expect(start).toContain('Motor_Starter');
    expect(start).not.toContain('Stop_PB');
    // 'Stop (N.C.) stops the motor and it stays stopped'
    expect(objectiveDevices(m, motor, 1)[0]).toBe('Stop_PB');
  });

  it('gives every objective of every mission a sane list (≤ 4 known aliases)', () => {
    let withDevices = 0;
    let total = 0;
    for (const m of MISSIONS) {
      const scene = SCENE_LOGICS[m.sceneId]!;
      const known = new Set(scene.io.map((p) => p.alias));
      m.objectives.forEach((_, i) => {
        const d = objectiveDevices(m, scene, i);
        total++;
        if (d.length > 0) withDevices++;
        expect(d.length).toBeLessThanOrEqual(4);
        for (const a of d) expect(known.has(a)).toBe(true);
      });
    }
    // most objectives point at something in the plant
    expect(withDevices / total).toBeGreaterThan(0.8);
  });
});
