import { describe, expect, it } from 'vitest';
import { createController } from '../plc/controller';
import { parseRung } from '../plc/neutralText';
import { cloneProject, createProjectForScene, withRoutineRungs } from './project';
import type { SceneProjectSource } from './project';

const scene: SceneProjectSource = {
  id: 'bench',
  title: 'Test bench',
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
    { operand: 'Local:1:I.Data.8', alias: 'PB_Green', dir: 'input', signal: 'digital', device: 'Green flush PB, N.O.', description: '' },
    { operand: 'Local:2:O.Data.0', alias: 'Light_0', dir: 'output', signal: 'digital', device: 'Green pilot light', description: '' },
    { operand: 'Local:3:I.Ch0Data', alias: 'Pot_1', dir: 'input', signal: 'analog', device: 'Potentiometer 0-100 %', description: '' },
    { operand: 'Local:4:O.Ch0Data', alias: 'Meter_1', dir: 'output', signal: 'analog', device: 'Analog meter', description: '' },
  ],
  extraTags: [{ name: 'Setpoint', dataType: 'REAL', initial: 50 }],
};

describe('createProjectForScene', () => {
  it('builds the standard project structure', () => {
    const p = createProjectForScene(scene);
    expect(p.controllerName).toBe('PLC_World');
    expect(p.hardware).toEqual(scene.hardware);
    expect(p.hardware).not.toBe(scene.hardware);
    expect(p.tasks).toEqual([{ name: 'MainTask', type: 'CONTINUOUS', programs: ['MainProgram'] }]);
    expect(p.programs).toHaveLength(1);
    expect(p.programs[0]).toMatchObject({ name: 'MainProgram', mainRoutine: 'MainRoutine', tags: [] });
    expect(p.programs[0]!.routines[0]!.name).toBe('MainRoutine');
    expect(p.programs[0]!.routines[0]!.rungs).toHaveLength(1);
    expect(p.programs[0]!.routines[0]!.rungs[0]!.elements).toEqual([]);
  });

  it('creates one alias tag per I/O point plus the scene extra tags', () => {
    const p = createProjectForScene(scene);
    expect(p.tags).toEqual([
      { name: 'PB_Green', dataType: 'BOOL', aliasFor: 'Local:1:I.Data.8', description: 'Green flush PB, N.O.' },
      { name: 'Light_0', dataType: 'BOOL', aliasFor: 'Local:2:O.Data.0', description: 'Green pilot light' },
      { name: 'Pot_1', dataType: 'REAL', aliasFor: 'Local:3:I.Ch0Data', description: 'Potentiometer 0-100 %' },
      { name: 'Meter_1', dataType: 'REAL', aliasFor: 'Local:4:O.Ch0Data', description: 'Analog meter' },
      { name: 'Setpoint', dataType: 'REAL', initial: 50 },
    ]);
  });

  it('parses neutral text rungs with comments and merges extra tags', () => {
    const p = createProjectForScene(scene, ['XIC(PB_Green)OTE(Light_0);', 'MOV(Pot_1,Meter_1);'], {
      comments: ['Push to light', undefined],
      tags: [{ name: 'Setpoint', dataType: 'REAL', initial: 75 }, { name: 'Count', dataType: 'DINT' }],
    });
    const rungs = p.programs[0]!.routines[0]!.rungs;
    expect(rungs).toHaveLength(2);
    expect(rungs[0]!.comment).toBe('Push to light');
    expect(rungs[1]!.comment).toBeUndefined();
    expect(p.tags.find((t) => t.name === 'Setpoint')?.initial).toBe(75);
    expect(p.tags.map((t) => t.name)).toContain('Count');
  });

  it('accepts Rung objects (deep-copied)', () => {
    const rung = parseRung('XIC(PB_Green)OTE(Light_0);');
    const p = createProjectForScene(scene, [rung]);
    const copy = p.programs[0]!.routines[0]!.rungs[0]!;
    expect(copy).toEqual(rung);
    expect(copy).not.toBe(rung);
  });

  it('produces a project that verifies and runs', () => {
    const plc = createController(createProjectForScene(scene, ['XIC(PB_Green)OTE(Light_0);', 'MOV(Pot_1,Meter_1);']));
    expect(plc.verify()).toEqual([]);
    expect(plc.requestMode('RUN')).toBe(true);
    plc.writeInputFromField('Local:1:I.Data.8', true);
    plc.writeInputFromField('Local:3:I.Ch0Data', 33.5);
    plc.scan(10);
    expect(plc.readOutputForField('Local:2:O.Data.0')).toBe(true);
    expect(plc.readOutputForField('Local:4:O.Ch0Data')).toBe(33.5);
    expect(plc.tags.getDef('PB_Green')?.description).toBe('Green flush PB, N.O.');
  });
});

describe('cloneProject / withRoutineRungs', () => {
  it('deep-clones projects', () => {
    const p = createProjectForScene(scene, ['XIC(PB_Green)OTE(Light_0);']);
    const c = cloneProject(p);
    c.tags.push({ name: 'Extra', dataType: 'BOOL' });
    c.programs[0]!.routines[0]!.rungs.length = 0;
    expect(p.tags.some((t) => t.name === 'Extra')).toBe(false);
    expect(p.programs[0]!.routines[0]!.rungs).toHaveLength(1);
  });

  it('replaces or creates a routine without touching the original', () => {
    const p = createProjectForScene(scene, ['XIC(PB_Green)OTE(Light_0);']);
    const q = withRoutineRungs(p, 'MainProgram', 'MainRoutine', ['JSR(Sub,0);']);
    const r = withRoutineRungs(q, 'mainprogram', 'Sub', ['XIC(PB_Green)OTE(Light_0);', 'NOP();']);
    expect(p.programs[0]!.routines[0]!.rungs[0]!.elements[0]).toMatchObject({ op: 'XIC' });
    expect(q.programs[0]!.routines[0]!.rungs[0]!.elements[0]).toMatchObject({ op: 'JSR' });
    expect(q.programs[0]!.routines).toHaveLength(1);
    expect(r.programs[0]!.routines.map((x) => x.name)).toEqual(['MainRoutine', 'Sub']);
    expect(r.programs[0]!.routines[1]!.rungs).toHaveLength(2);
    expect(createController(r).verify()).toEqual([]);
    expect(() => withRoutineRungs(p, 'Nope', 'MainRoutine', [])).toThrow(/does not exist/);
    expect(withRoutineRungs(p, 'MainProgram', 'MainRoutine', []).programs[0]!.routines[0]!.rungs).toHaveLength(1);
  });
});
