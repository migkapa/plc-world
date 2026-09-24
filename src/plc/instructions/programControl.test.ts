import { describe, expect, it } from 'vitest';
import { createController } from '../controller';
import { parseRung } from '../neutralText';
import { bool, dint, makeProject, runLogic, scanN, timer } from '../testUtils';

describe('JSR / SBR / RET', () => {
  it('runs a subroutine only while the JSR rung is true; outputs freeze when not scanned', () => {
    const plc = runLogic(['XIC(Auto)JSR(Sub,0);', 'OTE(After_Jsr);'], [bool('Auto'), bool('In'), bool('Out'), bool('After_Jsr')], {
      routines: { Sub: ['XIC(In)OTE(Out);'] },
    });
    plc.tags.writeBool('Auto', true);
    plc.tags.writeBool('In', true);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(true);
    expect(plc.tags.readBool('After_Jsr')).toBe(true);
    plc.tags.writeBool('Auto', false);
    plc.tags.writeBool('In', false);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(true); // not scanned → keeps its last state
  });

  it('accepts JSR(Routine) without the input count', () => {
    const plc = runLogic(['JSR(Sub);'], [dint('N')], { routines: { Sub: ['ADD(N,1,N);'] } });
    scanN(plc, 3);
    expect(plc.tags.readNumber('N')).toBe(3);
  });

  it('RET ends the subroutine early', () => {
    const plc = runLogic(['JSR(Sub,0);'], [bool('Stop'), dint('A'), dint('B')], {
      routines: { Sub: ['ADD(A,1,A);', 'XIC(Stop)RET();', 'ADD(B,1,B);'] },
    });
    plc.scan(10);
    plc.tags.writeBool('Stop', true);
    plc.scan(10);
    expect([plc.tags.readNumber('A'), plc.tags.readNumber('B')]).toEqual([2, 1]);
    const live = plc.getLiveState('MainProgram', 'Sub')!;
    expect(live.rungs).toEqual([true, true, false]);
  });

  it('passes input and return parameters through SBR/RET', () => {
    const plc = runLogic(['JSR(Square,1,X,Result);'], [dint('X', { initial: 7 }), dint('Result'), dint('Par'), dint('Sq')], {
      routines: { Square: ['SBR(Par)MUL(Par,Par,Sq);', 'RET(Sq);'] },
    });
    plc.scan(10);
    expect(plc.tags.readNumber('Result')).toBe(49);
  });

  it('faults T04:C31 when parameters do not match', () => {
    const plc = runLogic(['JSR(Sub,1,5);'], [dint('A'), dint('B')], { routines: { Sub: ['SBR(A,B)NOP();'] } });
    plc.scan(10);
    expect(plc.getStatus().majorFault).toMatchObject({ type: 4, code: 31, routine: 'Sub' });
  });

  it('faults T04:C84 on runaway recursion', () => {
    const plc = runLogic(['JSR(Sub,0);'], [], { routines: { Sub: ['JSR(Sub,0);'] } });
    plc.scan(10);
    const st = plc.getStatus();
    expect(st.mode).toBe('FAULTED');
    expect(st.majorFault).toMatchObject({ type: 4, code: 84 });
    expect(st.displayText).toBe('Major Fault T04:C84');
  });

  it('nests subroutines', () => {
    const plc = runLogic(['JSR(A,0);'], [dint('Depth')], { routines: { A: ['ADD(Depth,1,Depth)JSR(B,0);'], B: ['ADD(Depth,10,Depth);'] } });
    plc.scan(10);
    expect(plc.tags.readNumber('Depth')).toBe(11);
  });
});

describe('JSR combined with JMP / RET / TND on one rung', () => {
  it('a JMP earlier on the rung does not act inside the subroutine', () => {
    const plc = runLogic(['JMP(Skip)JSR(Sub,0);', 'OTL(Skipped);', 'LBL(Skip)NOP();'], [bool('Skipped'), bool('Sub0'), bool('Sub1')], {
      routines: { Sub: ['OTL(Sub0);', 'OTL(Sub1);'] },
    });
    plc.scan(10);
    expect(plc.getStatus().mode).toBe('REM_RUN');
    expect([plc.tags.readBool('Sub0'), plc.tags.readBool('Sub1')]).toEqual([true, true]);
    expect(plc.tags.readBool('Skipped')).toBe(false); // the caller's jump still happens afterwards
  });

  it("a RET earlier on the rung belongs to the caller, not to the called routine", () => {
    const plc = runLogic(['JSR(Sub1,0);'], [bool('A', { initial: true }), bool('S2r0'), bool('S2r1'), bool('After')], {
      routines: { Sub1: ['[XIC(A)RET(),JSR(Sub2,0)];', 'OTL(After);'], Sub2: ['OTL(S2r0);', 'OTL(S2r1);'] },
    });
    plc.scan(10);
    expect([plc.tags.readBool('S2r0'), plc.tags.readBool('S2r1')]).toEqual([true, true]);
    expect(plc.tags.readBool('After')).toBe(false); // Sub1 returned after its first rung
  });

  it('a TND earlier on the rung ends the caller only', () => {
    const plc = runLogic(['TND()JSR(Sub,0);', 'OTL(Main_After);'], [bool('Main_After'), bool('Sub0'), bool('Sub1')], {
      routines: { Sub: ['OTL(Sub0);', 'OTL(Sub1);'] },
    });
    plc.scan(10);
    expect([plc.tags.readBool('Sub0'), plc.tags.readBool('Sub1')]).toEqual([true, true]);
    expect(plc.tags.readBool('Main_After')).toBe(false);
  });
});

describe('JMP / LBL', () => {
  it('skips rungs forward', () => {
    const plc = runLogic(['XIC(Skip)JMP(Here);', 'ADD(Skipped,1,Skipped);', 'LBL(Here)ADD(Done,1,Done);'], [bool('Skip'), dint('Skipped'), dint('Done')]);
    plc.scan(10);
    plc.tags.writeBool('Skip', true);
    plc.scan(10);
    expect(plc.tags.readNumber('Skipped')).toBe(1);
    expect(plc.tags.readNumber('Done')).toBe(2);
    expect(plc.getLiveState('MainProgram', 'MainRoutine')!.rungs).toEqual([true, false, true]);
  });

  it('loops backwards until a condition is met', () => {
    const plc = runLogic(['CLR(I);', 'LBL(Loop)ADD(I,1,I);', 'LES(I,10)JMP(Loop);'], [dint('I')]);
    plc.scan(10);
    expect(plc.tags.readNumber('I')).toBe(10);
  });

  it('an endless loop trips the task watchdog (T06:C01)', () => {
    const plc = runLogic(['LBL(Forever)NOP();', 'JMP(Forever);'], []);
    plc.scan(10);
    expect(plc.getStatus().majorFault).toMatchObject({ type: 6, code: 1 });
  });
});

describe('AFI / NOP / TND / MCR', () => {
  it('AFI disables a rung, NOP passes power', () => {
    const plc = runLogic(['AFI()OTE(A);', 'NOP()OTE(B);'], [bool('A', { initial: true }), bool('B')]);
    plc.scan(10);
    expect(plc.tags.readBool('A')).toBe(false);
    expect(plc.tags.readBool('B')).toBe(true);
  });

  it('TND ends the rest of the routine', () => {
    const plc = runLogic(['XIC(Stop)TND();', 'ADD(N,1,N);'], [bool('Stop'), dint('N')]);
    plc.scan(10);
    plc.tags.writeBool('Stop', true);
    plc.scan(10);
    expect(plc.tags.readNumber('N')).toBe(1);
    expect(plc.getLiveState('MainProgram', 'MainRoutine')!.rungs).toEqual([true, false]);
  });

  it('TND in a main routine hands over to the next program of the task', () => {
    const project = makeProject(['XIC(Stop)TND();', 'OTE(P1_After);'], [bool('Stop', { initial: true }), bool('P1_After'), bool('P2_Ran')], {
      extraPrograms: [{ name: 'Program2', mainRoutine: 'Main', tags: [], routines: [{ name: 'Main', type: 'RLL', rungs: [parseRung('OTL(P2_Ran);')] }] }],
    });
    project.tasks[0]!.programs.push('Program2');
    const plc = createController(project);
    expect(plc.requestMode('RUN')).toBe(true);
    plc.scan(10);
    expect(plc.tags.readBool('P1_After')).toBe(false);
    expect(plc.tags.readBool('P2_Ran')).toBe(true);
  });

  it('TND in a subroutine returns to the caller, which continues', () => {
    const plc = runLogic(['JSR(Sub,0)OTE(Jsr_Rung_Done);', 'OTE(Main_After);'], [bool('Jsr_Rung_Done'), bool('Main_After'), bool('Sub_After')], {
      routines: { Sub: ['TND();', 'OTE(Sub_After);'] },
    });
    plc.scan(10);
    expect(plc.tags.readBool('Sub_After')).toBe(false);
    expect(plc.tags.readBool('Jsr_Rung_Done')).toBe(true);
    expect(plc.tags.readBool('Main_After')).toBe(true);
  });

  it('MCR zone forces its rungs false while the zone is disabled', () => {
    const plc = runLogic(['XIC(Zone)MCR();', 'XIC(Run)OTE(Out);', 'XIC(Run)TON(T1,1000,0);', 'XIC(Run)OTL(Latched);', 'MCR();', 'XIC(Run)OTE(Outside);'], [
      bool('Zone', { initial: true }),
      bool('Run', { initial: true }),
      bool('Out'),
      timer('T1'),
      bool('Latched'),
      bool('Outside'),
    ]);
    scanN(plc, 3);
    expect(plc.tags.readBool('Out')).toBe(true);
    expect(plc.tags.readBool('Latched')).toBe(true);
    plc.tags.writeBool('Zone', false);
    plc.scan(10);
    expect(plc.tags.readBool('Out')).toBe(false);
    expect(plc.tags.readBool('T1.EN')).toBe(false);
    expect(plc.tags.readBool('Latched')).toBe(true); // retentive
    expect(plc.tags.readBool('Outside')).toBe(true);
  });
});

describe('run-time program control faults (project forced to Run with the key switch)', () => {
  it('JSR to a missing routine faults T04:C31', () => {
    const plc = createController(makeProject(['XIC(Go)JSR(Missing,0);'], [bool('Go', { initial: true })]));
    expect(plc.requestMode('RUN')).toBe(false); // verify refuses remotely
    plc.setKeySwitch('RUN'); // the physical key cannot be refused
    plc.scan(10);
    expect(plc.getStatus().majorFault).toMatchObject({ type: 4, code: 31, rungIndex: 0 });
  });

  it('JMP to a missing label faults T04:C42', () => {
    const plc = createController(makeProject(['XIC(Go)JMP(Nowhere);'], [bool('Go', { initial: true })]));
    plc.setKeySwitch('RUN');
    plc.scan(10);
    expect(plc.getStatus().majorFault).toMatchObject({ type: 4, code: 42 });
  });

  it('rungs that do not compile are skipped', () => {
    const plc = createController(makeProject(['XIC(Nope)OTE(Out);', 'OTE(Ok);'], [bool('Out'), bool('Ok')]));
    plc.setKeySwitch('RUN');
    plc.scan(10);
    expect(plc.getStatus().mode).toBe('RUN');
    expect(plc.tags.readBool('Ok')).toBe(true);
    expect(plc.getLiveState('MainProgram', 'MainRoutine')!.rungs).toEqual([false, true]);
  });
});
