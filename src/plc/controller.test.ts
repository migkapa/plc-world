import { describe, expect, it } from 'vitest';
import { createController } from './controller';
import { parseRung } from './neutralText';
import { TEST_HARDWARE_5380, bool, counter, dint, makeProject, real, runLogic, scanN, timer } from './testUtils';
import type { ControllerEvent, ControllerStatus, TagDef } from './types';

const sealIn = ['[XIC(Start_PB),XIC(Motor)]XIC(Stop_PB)OTE(Motor);', 'XIC(Motor)OTE(Local:2:O.Data.0);'];
const sealInTags: TagDef[] = [
  { name: 'Start_PB', dataType: 'BOOL', aliasFor: 'Local:1:I.Data.0' },
  { name: 'Stop_PB', dataType: 'BOOL', aliasFor: 'Local:1:I.Data.1' },
  bool('Motor'),
];

describe('key switch and modes (1756-L8x behaviour)', () => {
  it('starts in REM_PROG after a download', () => {
    const plc = createController(makeProject(sealIn, sealInTags));
    expect(plc.getStatus()).toMatchObject({ keySwitch: 'REM', mode: 'REM_PROG', running: false, runLed: 'off', ok: 'green', displayText: 'PROG' });
  });

  it('follows the key: RUN, PROG and REM (remembering the previous run state)', () => {
    const plc = createController(makeProject(sealIn, sealInTags));
    plc.setKeySwitch('RUN');
    expect(plc.getStatus()).toMatchObject({ mode: 'RUN', running: true, runLed: 'green', displayText: 'RUN' });
    plc.setKeySwitch('REM');
    expect(plc.getStatus().mode).toBe('REM_RUN');
    plc.setKeySwitch('PROG');
    expect(plc.getStatus().mode).toBe('PROG');
    plc.setKeySwitch('REM');
    expect(plc.getStatus().mode).toBe('REM_PROG');
  });

  it('honours remote mode requests only with the key in REM', () => {
    const plc = createController(makeProject(sealIn, sealInTags));
    expect(plc.requestMode('RUN')).toBe(true);
    expect(plc.getStatus().mode).toBe('REM_RUN');
    expect(plc.requestMode('PROG')).toBe(true);
    expect(plc.getStatus().mode).toBe('REM_PROG');
    plc.setKeySwitch('RUN');
    expect(plc.requestMode('PROG')).toBe(false);
    expect(plc.getStatus().mode).toBe('RUN');
    plc.setKeySwitch('PROG');
    expect(plc.requestMode('RUN')).toBe(false);
  });

  it('refuses to run a project that does not verify', () => {
    const plc = createController(makeProject(['XIC(Nope)OTE(Motor);'], [bool('Motor')]));
    expect(plc.verify().some((e) => e.severity === 'error')).toBe(true);
    expect(plc.requestMode('RUN')).toBe(false);
    expect(plc.getStatus().mode).toBe('REM_PROG');
  });

  it('emits mode events', () => {
    const plc = createController(makeProject(sealIn, sealInTags));
    const events: ControllerEvent[] = [];
    const off = plc.subscribe((e) => events.push(e));
    plc.requestMode('RUN');
    plc.requestMode('PROG');
    off();
    plc.requestMode('RUN');
    expect(events).toEqual([
      { type: 'mode', mode: 'REM_RUN' },
      { type: 'mode', mode: 'REM_PROG' },
    ]);
  });
});

describe('scan, field I/O and outputs', () => {
  it('runs a seal-in circuit with a normally-closed stop button', () => {
    const plc = runLogic(sealIn, sealInTags);
    plc.writeInputFromField('Local:1:I.Data.1', true); // N.C. stop not pressed
    plc.scan(10);
    expect(plc.readOutputForField('Local:2:O.Data.0')).toBe(false);
    plc.writeInputFromField('Local:1:I.Data.0', true);
    plc.scan(10);
    plc.writeInputFromField('Local:1:I.Data.0', false);
    plc.scan(10);
    expect(plc.readOutputForField('Local:2:O.Data.0')).toBe(true);
    expect(plc.tags.readBool('Local:2:I.Data.0')).toBe(true); // output echo
    plc.writeInputFromField('Local:1:I.Data.1', false); // press stop
    plc.scan(10);
    expect(plc.readOutputForField('Local:2:O.Data.0')).toBe(false);
  });

  it('drives outputs to the field only while running; tags keep their values in PROG', () => {
    const plc = runLogic(['XIC(En)OTE(Local:2:O.Data.3)MOV(42.5,Local:4:O.Ch0Data);'], [bool('En', { initial: true })]);
    plc.scan(10);
    expect(plc.readOutputForField('Local:2:O.Data.3')).toBe(true);
    expect(plc.readOutputForField('Local:4:O.Ch0Data')).toBe(42.5);
    plc.requestMode('PROG');
    plc.scan(10);
    expect(plc.readOutputForField('Local:2:O.Data.3')).toBe(false);
    expect(plc.readOutputForField('Local:4:O.Ch0Data')).toBe(0);
    expect(plc.tags.readBool('Local:2:O.Data.3')).toBe(true);
    expect(plc.tags.readNumber('Local:2:I.Data')).toBe(0); // echo: module outputs are off
  });

  it('reads analog inputs written by the field', () => {
    const plc = runLogic(['GRT(Local:3:I.Ch0Data,50.0)OTE(High);'], [bool('High')]);
    plc.writeInputFromField('Local:3:I.Ch0Data', 62.25);
    plc.scan(10);
    expect(plc.tags.readBool('High')).toBe(true);
  });

  it('ignores unknown field operands without throwing', () => {
    const plc = runLogic([], []);
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      expect(() => plc.writeInputFromField('Local:9:I.Data.0', true)).not.toThrow();
      expect(plc.readOutputForField('Local:9:O.Data.0')).toBe(false);
    } finally {
      console.warn = warn;
    }
  });

  it('sets RunMode on Compact 5000 I/O modules while running', () => {
    const plc = runLogic(['XIC(Local:1:I.Pt00.Data)OTE(Local:2:O.Pt07.Data);'], [], { hardware: TEST_HARDWARE_5380 });
    plc.writeInputFromField('Local:1:I.Pt00.Data', true);
    plc.scan(10);
    expect(plc.tags.readBool('Local:1:I.RunMode')).toBe(true);
    expect(plc.readOutputForField('Local:2:O.Pt07.Data')).toBe(true);
    expect(plc.tags.readBool('Local:2:I.Pt07.Data')).toBe(true);
    plc.requestMode('PROG');
    plc.scan(10);
    expect(plc.tags.readBool('Local:1:I.RunMode')).toBe(false);
  });

  it('keeps status counters and a deterministic simulated scan time', () => {
    const plc = runLogic(sealIn, sealInTags);
    scanN(plc, 5);
    const st = plc.getStatus();
    expect(st.scanCount).toBe(5);
    expect(st.uptimeMs).toBe(50);
    expect(st.lastScanMs).toBeGreaterThanOrEqual(0.15);
    expect(st.lastScanMs).toBeLessThan(0.2);
    expect(st.maxScanMs).toBeGreaterThanOrEqual(st.lastScanMs);
    expect(st.ioLed).toBe('green');
    const again = runLogic(sealIn, sealInTags);
    scanN(again, 5);
    expect(again.getStatus().lastScanMs).toBe(st.lastScanMs);
  });

  it('runs periodic tasks at their period', () => {
    const project = makeProject(['ADD(Fast,1,Fast);'], [dint('Fast'), dint('Slow')], {
      tasks: [{ name: 'Periodic_100ms', type: 'PERIODIC', periodMs: 100, programs: ['Slow_Program'] }],
      extraPrograms: [
        { name: 'Slow_Program', mainRoutine: 'Main', tags: [], routines: [{ name: 'Main', type: 'RLL', rungs: [parseRung('ADD(Slow,1,Slow);')] }] },
      ],
    });
    const plc = createController(project);
    plc.requestMode('RUN');
    scanN(plc, 100);
    expect(plc.tags.readNumber('Fast')).toBe(100);
    expect(plc.tags.readNumber('Slow')).toBe(10);
  });
});

describe('prescan and S:FS', () => {
  it('prescan clears OTEs (even in routines that are not called), resets TON, keeps OTL and RTO', () => {
    const plc = createController(
      makeProject(['XIC(Never)JSR(Sub,0);', 'XIC(Go)TON(T1,1000,0);', 'XIC(Go)RTO(T2,1000,?);', 'XIC(Go)OTL(Latched);'], [
        bool('Never'),
        bool('Go'),
        bool('Out', { initial: true }),
        bool('Latched', { initial: true }),
        timer('T1', { initial: { ACC: 500, EN: true, TT: true } }),
        timer('T2', { initial: { ACC: 500 } }),
      ], { routines: { Sub: ['XIC(Go)OTE(Out);'] } }),
    );
    plc.requestMode('RUN');
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(false);
    expect(plc.tags.readValue('T1')).toMatchObject({ ACC: 0, EN: false, TT: false, DN: false });
    expect(plc.tags.readNumber('T2.ACC')).toBe(500);
    expect(plc.tags.readBool('Latched')).toBe(true);
  });

  it('S:FS is set for exactly the first scan after entering run', () => {
    const plc = runLogic(['XIC(S:FS)ADD(Starts,1,Starts);', 'XIC(S:FS)MOV(100,Setpoint);'], [dint('Starts'), dint('Setpoint')]);
    scanN(plc, 5);
    expect(plc.tags.readNumber('Starts')).toBe(1);
    expect(plc.tags.readNumber('Setpoint')).toBe(100);
    plc.requestMode('PROG');
    plc.scan(10);
    plc.requestMode('RUN');
    plc.scan(10);
    expect(plc.getStatus().firstScan).toBe(true);
    plc.scan(10);
    expect(plc.getStatus().firstScan).toBe(false);
    expect(plc.tags.readNumber('Starts')).toBe(2);
  });

  it('counters do not count on the first scan; CTU CU set in prescan', () => {
    const plc = runLogic(['XIC(PE)CTU(C1,5,0);'], [bool('PE', { initial: true }), counter('C1')]);
    plc.scan(10);
    expect(plc.tags.readValue('C1')).toMatchObject({ ACC: 0, CU: true });
  });
});

describe('faults', () => {
  it('major fault on array subscript out of range (T04:C20): logic stops, outputs off', () => {
    const plc = runLogic(['XIC(En)OTE(Local:2:O.Data.0);', 'MOV(Arr[Idx],Val);', 'ADD(After,1,After);'], [
      bool('En', { initial: true }),
      dint('Arr', { dims: 5 }),
      dint('Idx', { initial: 2 }),
      dint('Val'),
      dint('After'),
    ]);
    plc.scan(10);
    expect(plc.tags.readNumber('After')).toBe(1);
    const events: ControllerEvent[] = [];
    plc.subscribe((e) => events.push(e));
    plc.tags.writeNumber('Idx', 7);
    plc.scan(10);
    const st = plc.getStatus();
    expect(st.mode).toBe('FAULTED');
    expect(st.running).toBe(false);
    expect(st.ok).toBe('flashing-red');
    expect(st.displayText).toBe('Major Fault T04:C20');
    expect(st.majorFault).toMatchObject({ type: 4, code: 20, program: 'MainProgram', routine: 'MainRoutine', rungIndex: 1, timeMs: 20 });
    expect(plc.tags.readNumber('After')).toBe(1); // rung 2 did not execute
    expect(plc.readOutputForField('Local:2:O.Data.0')).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['fault', 'mode']);
    scanN(plc, 3);
    expect(plc.tags.readNumber('After')).toBe(1);
    expect(plc.requestMode('RUN')).toBe(false);
    plc.tags.writeNumber('Idx', 0);
    plc.clearMajorFault();
    expect(plc.getStatus()).toMatchObject({ mode: 'REM_PROG', majorFault: undefined, ok: 'green' });
    expect(plc.requestMode('RUN')).toBe(true);
    plc.scan(10);
    expect(plc.tags.readNumber('After')).toBe(2);
  });

  it('turning the key to PROG clears a major fault', () => {
    const plc = runLogic(['MOV(Arr[Idx],Val);'], [dint('Arr', { dims: 2 }), dint('Idx', { initial: 5 }), dint('Val')]);
    plc.setKeySwitch('RUN');
    plc.scan(10);
    expect(plc.getStatus().mode).toBe('FAULTED');
    plc.setKeySwitch('PROG');
    expect(plc.getStatus()).toMatchObject({ mode: 'PROG', majorFault: undefined });
  });

  it('minor faults are logged (deduplicated) and execution continues', () => {
    const plc = runLogic(['DIV(1,Zero,R);', 'ADD(N,1,N);'], [dint('Zero'), dint('R'), dint('N')]);
    scanN(plc, 5);
    const st = plc.getStatus();
    expect(st.mode).toBe('REM_RUN');
    expect(st.minorFaults).toHaveLength(1);
    expect(st.minorFaults[0]).toMatchObject({ type: 4, code: 4, rungIndex: 0, timeMs: 50 });
    expect(plc.tags.readNumber('N')).toBe(5);
    plc.clearMinorFaults();
    expect(plc.getStatus().minorFaults).toHaveLength(0);
  });

  it('scan() never throws', () => {
    const plc = runLogic(['MOV(Arr[Idx],Val);'], [dint('Arr', { dims: 2 }), dint('Idx', { initial: 5 }), dint('Val')]);
    expect(() => {
      plc.scan(10);
      plc.scan(Number.NaN);
      plc.scan(-5);
    }).not.toThrow();
  });
});

describe('forces', () => {
  it('input forces override the field; LED shows installed/enabled state', () => {
    const plc = runLogic(sealIn, sealInTags);
    expect(plc.getStatus().forceLed).toBe('off');
    plc.setForce('Stop_PB', true);
    expect(plc.getForces()).toEqual({ 'Local:1:I.Data.1': true });
    expect(plc.getStatus()).toMatchObject({ forceLed: 'flashing-amber', forcesInstalled: true, forcesEnabled: false });
    plc.enableForces(true);
    expect(plc.getStatus().forceLed).toBe('amber');
    plc.writeInputFromField('Local:1:I.Data.1', false); // field says pressed…
    plc.writeInputFromField('Local:1:I.Data.0', true);
    plc.scan(10);
    expect(plc.tags.readBool('Stop_PB')).toBe(true); // …logic sees the forced value
    expect(plc.tags.readBool('Motor')).toBe(true);
    plc.removeForce('Local:1:I.Data.1');
    expect(plc.tags.readBool('Stop_PB')).toBe(false); // field value restored
    plc.scan(10);
    expect(plc.tags.readBool('Motor')).toBe(false);
    expect(plc.getStatus().forceLed).toBe('off');
  });

  it('output forces override the tag and the field', () => {
    const plc = runLogic(['XIC(Run)OTE(Local:2:O.Data.5);'], [bool('Run')]);
    plc.setForce('Local:2:O.Data.5', true);
    plc.enableForces(true);
    plc.scan(10);
    expect(plc.tags.readBool('Local:2:O.Data.5')).toBe(true);
    expect(plc.readOutputForField('Local:2:O.Data.5')).toBe(true);
    plc.enableForces(false);
    plc.scan(10);
    expect(plc.readOutputForField('Local:2:O.Data.5')).toBe(false);
    plc.removeAllForces();
    expect(plc.getForces()).toEqual({});
  });

  it('forces analog values and rejects non-I/O tags', () => {
    const plc = runLogic(['MOV(Local:3:I.Ch0Data,Copy);'], [real('Copy'), bool('Internal')]);
    plc.setForce('Local:3:I.Ch0Data', 75);
    plc.enableForces(true);
    plc.writeInputFromField('Local:3:I.Ch0Data', 10);
    plc.scan(10);
    expect(plc.tags.readNumber('Copy')).toBe(75);
    expect(() => plc.setForce('Internal', true)).toThrow(/only module I\/O/);
    expect(() => plc.setForce('Missing_Tag', true)).toThrow(/Undefined tag/);
  });
});

describe('online edits, tags and live state', () => {
  it('updateRoutine replaces rungs and keeps tag values', () => {
    const plc = runLogic(['ADD(N,1,N);'], [dint('N'), timer('T1')]);
    scanN(plc, 3);
    const events: ControllerEvent[] = [];
    plc.subscribe((e) => events.push(e));
    plc.updateRoutine('MainProgram', 'MainRoutine', [parseRung('ADD(N,10,N);'), parseRung('TON(T1,2500,0);')]);
    expect(events).toEqual([{ type: 'project' }]);
    plc.scan(10);
    expect(plc.tags.readNumber('N')).toBe(13);
    expect(plc.tags.readNumber('T1.PRE')).toBe(2500); // preset written by the edit
    expect(plc.getStatus().mode).toBe('REM_RUN');
  });

  it('upsertTag / deleteTag update the database and recompile', () => {
    const plc = createController(makeProject(['XIC(New_Bit)OTE(Out);'], [bool('Out')]));
    expect(plc.requestMode('RUN')).toBe(false);
    plc.upsertTag(bool('New_Bit', { initial: true, description: 'added online' }));
    expect(plc.project.tags.some((t) => t.name === 'New_Bit')).toBe(true);
    expect(plc.requestMode('RUN')).toBe(true);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(true);
    plc.upsertTag(bool('New_Bit', { description: 'renamed description' }));
    expect(plc.tags.readBool('New_Bit')).toBe(true); // compatible redefinition keeps the value
    expect(plc.tags.getDef('New_Bit')?.description).toBe('renamed description');
    plc.upsertTag(dint('Program_Tag'), 'MainProgram');
    expect(plc.tags.list('MainProgram').map((t) => t.name)).toEqual(['Program_Tag']);
    plc.deleteTag('New_Bit');
    expect(plc.tags.exists('New_Bit')).toBe(false);
    plc.scan(10); // rung no longer compiles: it is skipped, the scan does not throw
    expect(plc.verify().some((e) => e.message.includes("Undefined tag 'New_Bit'"))).toBe(true);
    expect(() => plc.deleteTag('Local:1:I')).toThrow();
  });

  it('applies instruction-box presets when the tag is created after the rung', () => {
    const plc = createController(makeProject(['XIC(Go)TON(Delay,2500,0);'], [bool('Go')]));
    plc.upsertTag(timer('Delay'));
    expect(plc.requestMode('RUN')).toBe(true);
    plc.scan(10);
    expect(plc.tags.readNumber('Delay.PRE')).toBe(2500);
  });

  it('getLiveState shows data highlighting in Program mode', () => {
    const plc = createController(makeProject(['XIC(A)XIO(B)OTE(C);'], [bool('A', { initial: true }), bool('B'), bool('C')]));
    const els = plc.project.programs[0]!.routines[0]!.rungs[0]!.elements;
    const live = plc.getLiveState('MainProgram', 'MainRoutine')!;
    expect(live.elements[els[0]!.id]).toEqual({ in: false, out: false, active: true });
    expect(live.elements[els[1]!.id]).toEqual({ in: false, out: false, active: true });
    expect(live.elements[els[2]!.id]?.active).toBe(false);
    expect(plc.getLiveState('MainProgram', 'Nope')).toBeUndefined();
  });

  it('resetTagValues restores initial values without changing the mode', () => {
    const plc = runLogic(['ADD(N,1,N);'], [dint('N', { initial: 5 })]);
    scanN(plc, 3);
    plc.resetTagValues();
    expect(plc.tags.readNumber('N')).toBe(5);
    plc.scan(10);
    expect(plc.tags.readNumber('N')).toBe(6);
    expect(plc.getStatus().mode).toBe('REM_RUN');
  });

  it('loadProject resets values and forces and returns to REM_PROG', () => {
    const plc = runLogic(['ADD(N,1,N);'], [dint('N')]);
    plc.setForce('Local:1:I.Data.0', true);
    scanN(plc, 3);
    plc.loadProject(makeProject(['ADD(N,2,N);'], [dint('N')]));
    expect(plc.getStatus()).toMatchObject({ mode: 'REM_PROG', keySwitch: 'REM', forcesInstalled: false, scanCount: 0 });
    expect(plc.tags.readNumber('N')).toBe(0);
  });
});

describe('regressions: instruction-box values vs. values written by logic', () => {
  const recipe = ['XIC(Load)ONS(Load_ONS)MOV(5000,T.PRE);', 'XIC(En)TON(T,1000,0);'];
  const recipeTags = (): TagDef[] => [bool('Load'), bool('Load_ONS'), bool('En'), bool('Other'), timer('T')];

  it('a logic-written preset survives tag create/delete and edits of other rungs', () => {
    const plc = runLogic(recipe, recipeTags());
    plc.scan(10);
    expect(plc.tags.readNumber('T.PRE')).toBe(1000); // from the download
    plc.tags.writeBool('Load', true);
    plc.scan(10);
    expect(plc.tags.readNumber('T.PRE')).toBe(5000);
    plc.upsertTag(dint('Unrelated_Tag'));
    plc.scan(10);
    expect(plc.tags.readNumber('T.PRE')).toBe(5000);
    plc.deleteTag('Unrelated_Tag');
    plc.scan(10);
    expect(plc.tags.readNumber('T.PRE')).toBe(5000);
    plc.updateRoutine('MainProgram', 'MainRoutine', [...recipe, 'XIC(En)OTE(Other);'].map((r) => parseRung(r)));
    plc.scan(10);
    expect(plc.tags.readNumber('T.PRE')).toBe(5000); // the TON rung was re-accepted unchanged
  });

  it('editing the preset literal writes the new value', () => {
    const plc = runLogic(recipe, recipeTags());
    plc.tags.writeBool('Load', true);
    plc.scan(10);
    plc.updateRoutine('MainProgram', 'MainRoutine', [recipe[0]!, 'XIC(En)TON(T,2500,0);'].map((r) => parseRung(r)));
    expect(plc.tags.readNumber('T.PRE')).toBe(2500);
  });

  it('an S:FS-initialised counter preset is kept when a tag is created', () => {
    const plc = runLogic(['XIC(S:FS)MOV(25,C.PRE);', 'XIC(PE)CTU(C,10,0);'], [bool('PE'), counter('C')]);
    scanN(plc, 2);
    expect(plc.tags.readNumber('C.PRE')).toBe(25);
    plc.upsertTag(bool('X'));
    scanN(plc, 2);
    expect(plc.tags.readNumber('C.PRE')).toBe(25);
  });

  it('a tag deleted and re-created gets the instruction-box preset again', () => {
    const plc = runLogic(recipe, recipeTags());
    plc.tags.writeNumber('T.PRE', 5000);
    plc.deleteTag('T');
    plc.upsertTag(timer('T'));
    plc.scan(10);
    expect(plc.tags.readNumber('T.PRE')).toBe(1000);
  });

  it('updateRoutine finishes a pending tag change (presets of other routines, refs)', () => {
    const plc = createController(
      makeProject(['JSR(Sub,0);'], [bool('En', { initial: true })], { routines: { Sub: ['XIC(En)TON(T1,1000,0);'] } }),
    );
    plc.setKeySwitch('RUN'); // T1 does not exist yet: the Sub rung is skipped
    plc.upsertTag(timer('T1'));
    plc.updateRoutine('MainProgram', 'MainRoutine', [parseRung('JSR(Sub,0);'), parseRung('NOP();')]);
    scanN(plc, 3);
    expect(plc.tags.readValue('T1')).toMatchObject({ PRE: 1000, TT: true, DN: false });
  });
});

describe('regressions: online tag edits and verification', () => {
  it('changing the constant flag online recompiles: what verifies is what runs', () => {
    const plc = createController(makeProject(['MOV(5,K);'], [dint('K', { constant: true })]));
    expect(plc.verify().some((e) => e.severity === 'error' && e.message.includes('constant'))).toBe(true);
    plc.upsertTag(dint('K', { constant: false }));
    expect(plc.verify()).toEqual([]);
    expect(plc.requestMode('RUN')).toBe(true);
    scanN(plc, 2);
    expect(plc.tags.readNumber('K')).toBe(5);
    plc.upsertTag(dint('K', { constant: true }));
    plc.tags.writeNumber('K', 0);
    scanN(plc, 2);
    expect(plc.tags.readNumber('K')).toBe(0); // logic no longer writes the constant
    expect(plc.verify().some((e) => e.message.includes("Tag 'K' is a constant"))).toBe(true);
  });

  it('deleting a broken alias clears its error and allows Run', () => {
    const plc = createController(
      makeProject(['XIC(A)OTE(C);'], [bool('A'), { name: 'Broken', dataType: 'BOOL', aliasFor: 'Missing_Tag' }, bool('C')]),
    );
    expect(plc.verify().map((e) => e.message)).toEqual(["Tag 'Broken': Alias 'Broken' -> 'Missing_Tag': Undefined tag 'Missing_Tag'."]);
    expect(plc.requestMode('RUN')).toBe(false);
    plc.deleteTag('Broken');
    expect(plc.verify()).toEqual([]);
    expect(plc.requestMode('RUN')).toBe(true);
  });

  it('creating the alias target clears the alias error', () => {
    const plc = createController(makeProject(['MOV(3,Al);'], [{ name: 'Al', dataType: 'DINT', aliasFor: 'Target' }]));
    expect(plc.requestMode('RUN')).toBe(false);
    plc.upsertTag(dint('Target'));
    expect(plc.verify()).toEqual([]);
    expect(plc.requestMode('RUN')).toBe(true);
    plc.scan(10);
    expect(plc.tags.readNumber('Target')).toBe(3);
  });

  it('redefining a bad definition (any letter case) clears its error', () => {
    const plc = createController(makeProject([], [{ name: 'Bad', dataType: 'NOPE' }]));
    expect(plc.verify()[0]?.message).toMatch(/^Tag 'Bad': Unknown data type 'NOPE'/);
    plc.upsertTag({ name: 'BAD', dataType: 'DINT' });
    expect(plc.verify()).toEqual([]);
    expect(plc.project.tags.map((t) => t.name)).toEqual(['BAD']);
  });

  it('reports system tags and duplicate names in the project', () => {
    const plc = createController(makeProject([], [bool('Dup'), dint('DUP'), bool('Sys', { system: true })]));
    const msgs = plc.verify().map((e) => e.message);
    expect(msgs).toContain("Tag 'DUP': Duplicate tag name in controller scope.");
    expect(msgs).toContain("Tag 'Sys': system tags are created by the controller.");
  });

  it('skips inhibited programs', () => {
    const project = makeProject(['ADD(Main_Runs,1,Main_Runs);'], [dint('Main_Runs'), dint('Inh_Runs')], {
      extraPrograms: [
        { name: 'Inhibited', mainRoutine: 'Main', inhibited: true, tags: [], routines: [{ name: 'Main', type: 'RLL', rungs: [parseRung('ADD(Inh_Runs,1,Inh_Runs);')] }] },
      ],
    });
    project.tasks[0]!.programs.push('Inhibited');
    const plc = createController(project);
    expect(plc.requestMode('RUN')).toBe(true);
    scanN(plc, 3);
    expect(plc.tags.readNumber('Main_Runs')).toBe(3);
    expect(plc.tags.readNumber('Inh_Runs')).toBe(0);
  });
});

describe('regressions: S:FS per program', () => {
  it('a program in a periodic task sees S:FS on its own first execution', () => {
    const project = makeProject(['XIC(S:FS)OTL(Cont_Init);'], [bool('Cont_Init'), bool('Per_Init'), dint('Per_Runs'), dint('Per_Fs')], {
      tasks: [{ name: 'Fast', type: 'PERIODIC', periodMs: 50, programs: ['PerProg'] }],
      extraPrograms: [
        {
          name: 'PerProg',
          mainRoutine: 'Main',
          tags: [],
          routines: [{ name: 'Main', type: 'RLL', rungs: ['XIC(S:FS)OTL(Per_Init);', 'XIC(S:FS)ADD(Per_Fs,1,Per_Fs);', 'ADD(Per_Runs,1,Per_Runs);'].map((r) => parseRung(r)) }],
        },
      ],
    });
    const plc = createController(project);
    expect(plc.requestMode('RUN')).toBe(true);
    scanN(plc, 20);
    expect(plc.tags.readBool('Cont_Init')).toBe(true);
    expect(plc.tags.readBool('Per_Init')).toBe(true);
    expect(plc.tags.readNumber('Per_Runs')).toBe(4);
    expect(plc.tags.readNumber('Per_Fs')).toBe(1);
  });

  it('every program of the continuous task sees S:FS once', () => {
    const project = makeProject(['XIC(S:FS)ADD(Fs_1,1,Fs_1);'], [dint('Fs_1'), dint('Fs_2')], {
      extraPrograms: [{ name: 'Second', mainRoutine: 'Main', tags: [], routines: [{ name: 'Main', type: 'RLL', rungs: [parseRung('XIC(S:FS)ADD(Fs_2,1,Fs_2);')] }] }],
    });
    project.tasks[0]!.programs.push('Second');
    const plc = createController(project);
    expect(plc.requestMode('RUN')).toBe(true);
    scanN(plc, 5);
    expect([plc.tags.readNumber('Fs_1'), plc.tags.readNumber('Fs_2')]).toEqual([1, 1]);
  });

  it('S:FS reads 0 outside program execution, after leaving Run and after a first-scan fault', () => {
    const plc = runLogic(['XIC(S:FS)OTE(Saw_Fs);'], [bool('Saw_Fs')]);
    plc.scan(10);
    expect(plc.tags.readBool('Saw_Fs')).toBe(true);
    expect(plc.tags.readBool('S:FS')).toBe(false);
    plc.requestMode('PROG');
    expect(plc.tags.readBool('S:FS')).toBe(false);

    const faulty = runLogic(['XIC(S:FS)OTE(Saw_Fs);', 'MOV(Arr[Idx],V);'], [bool('Saw_Fs'), dint('Arr', { dims: 2 }), dint('Idx', { initial: 9 }), dint('V')]);
    faulty.scan(10);
    expect(faulty.getStatus().mode).toBe('FAULTED');
    expect(faulty.tags.readBool('Saw_Fs')).toBe(true);
    expect(faulty.tags.readBool('S:FS')).toBe(false);
  });
});

describe('regressions: forces act on tag memory', () => {
  it('logic after the OTE sees the forced output value, whatever the rung order', () => {
    const plc = runLogic(
      ['XIC(Cmd)OTE(Local:2:O.Data.0);', 'XIC(Local:2:O.Data.0)OTE(Fb);', 'MOV(0,Local:2:O.Data);', 'XIC(Local:2:O.Data.0)OTE(Fb2);'],
      [bool('Cmd'), bool('Fb'), bool('Fb2')],
    );
    plc.setForce('Local:2:O.Data.0', true);
    plc.enableForces(true);
    scanN(plc, 3);
    expect(plc.tags.readBool('Fb')).toBe(true);
    expect(plc.tags.readBool('Fb2')).toBe(true); // a whole-word write keeps the forced bit
    expect(plc.tags.readBool('Local:2:O.Data.0')).toBe(true);
    expect(plc.readOutputForField('Local:2:O.Data.0')).toBe(true);

    plc.setForce('Local:2:O.Data.0', false); // force OFF beats the logic
    plc.tags.writeBool('Cmd', true);
    scanN(plc, 2);
    expect(plc.tags.readBool('Fb')).toBe(false);
    expect(plc.readOutputForField('Local:2:O.Data.0')).toBe(false);

    plc.enableForces(false);
    scanN(plc, 2);
    expect(plc.tags.readBool('Fb')).toBe(true);
    expect(plc.tags.readBool('Fb2')).toBe(false);
  });

  it('logic cannot overwrite a forced input; the field value returns when the force is removed', () => {
    const plc = runLogic(['OTU(Local:1:I.Data.3);', 'XIC(Local:1:I.Data.3)OTE(Seen);'], [bool('Seen')]);
    plc.writeInputFromField('Local:1:I.Data.4', true);
    plc.setForce('Local:1:I.Data.3', true);
    plc.enableForces(true);
    scanN(plc, 2);
    expect(plc.tags.readBool('Seen')).toBe(true);
    expect(plc.tags.readBool('Local:1:I.Data.4')).toBe(true); // neighbouring bits untouched
    plc.removeForce('Local:1:I.Data.3');
    expect(plc.tags.readBool('Local:1:I.Data.3')).toBe(false); // field value (0) restored
  });

  it('forces survive resetTagValues()', () => {
    const plc = runLogic(['XIC(Local:1:I.Data.2)OTE(Seen);'], [bool('Seen')]);
    plc.setForce('Local:1:I.Data.2', true);
    plc.enableForces(true);
    plc.resetTagValues();
    plc.scan(10);
    expect(plc.tags.readBool('Seen')).toBe(true);
  });

  it('rejects indirect addresses', () => {
    const plc = runLogic([], [dint('Idx', { initial: 99 })]);
    expect(() => plc.setForce('Local:1:I.Data.[Idx]', true)).toThrow(/indirect addresses cannot be forced/);
    plc.enableForces(true);
    plc.scan(10);
    expect(plc.getStatus().mode).toBe('REM_RUN');
  });

  it('getForce() looks a force up by the operand text (alias or path)', () => {
    const plc = runLogic(sealIn, [...sealInTags, bool('Unforced')], {
      programTags: [{ name: 'Local_Stop', dataType: 'BOOL', aliasFor: 'Local:1:I.Data.1' }],
    });
    expect(plc.getForce('Stop_PB')).toBeUndefined();
    plc.setForce('Stop_PB', true);
    expect(plc.getForces()).toEqual({ 'Local:1:I.Data.1': true });
    expect(plc.getForce('Stop_PB')).toBe(true);
    expect(plc.getForce('Local:1:I.Data.1')).toBe(true);
    expect(plc.getForce('Local_Stop', 'MainProgram')).toBe(true);
    expect(plc.getForce('Start_PB')).toBeUndefined();
    expect(plc.getForce('Unforced')).toBeUndefined();
    expect(plc.getForce('No_Such_Tag')).toBeUndefined();
  });
});

describe('regressions: download and fault events', () => {
  it('refuses a download with the key in RUN (the key never moves by itself)', () => {
    const plc = runLogic(['ADD(N,1,N);'], [dint('N')]);
    plc.setKeySwitch('RUN');
    scanN(plc, 2);
    expect(() => plc.loadProject(makeProject([], [dint('N')]))).toThrow(/key switch is in RUN/);
    expect(plc.getStatus()).toMatchObject({ keySwitch: 'RUN', mode: 'RUN' });
    plc.scan(10);
    expect(plc.tags.readNumber('N')).toBe(3); // the old project keeps running
    plc.setKeySwitch('PROG');
    plc.loadProject(makeProject([], [dint('N')]));
    expect(plc.getStatus()).toMatchObject({ keySwitch: 'PROG', mode: 'PROG' });
    plc.setKeySwitch('REM');
    plc.loadProject(makeProject([], [dint('N')]));
    expect(plc.getStatus()).toMatchObject({ keySwitch: 'REM', mode: 'REM_PROG' });
  });

  it('the fault event sees the faulted status and may clear the fault', () => {
    const plc = runLogic(['MOV(Arr[Idx],V);'], [dint('Arr', { dims: 2 }), dint('Idx', { initial: 5 }), dint('V')]);
    const seen: Array<Pick<ControllerStatus, 'mode' | 'running' | 'majorFault'>> = [];
    const events: ControllerEvent[] = [];
    plc.subscribe((e) => {
      events.push(e);
      if (e.type !== 'fault') return;
      const st = plc.getStatus();
      seen.push({ mode: st.mode, running: st.running, majorFault: st.majorFault });
      plc.clearMajorFault();
    });
    plc.scan(10);
    expect(seen[0]).toMatchObject({ mode: 'FAULTED', running: false, majorFault: { type: 4, code: 20 } });
    expect(plc.getStatus()).toMatchObject({ mode: 'REM_PROG', majorFault: undefined, ok: 'green', displayText: 'PROG' });
    expect(events.map((e) => (e.type === 'mode' ? `mode:${e.mode}` : e.type))).toEqual(['fault', 'mode:REM_PROG']);
    expect(plc.requestMode('RUN')).toBe(true);
  });
});
