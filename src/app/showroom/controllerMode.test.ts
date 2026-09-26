import { describe, expect, it } from 'vitest';
import { DemoStore } from './demo';
import { clearMajors, isRunning, simulateMajorFault, turnKey } from './stages/controllerMode';

const make = (key = 'REM', remoteRun = true) => new DemoStore({ key, remoteRun, faulted: false, faultTrail: '', forces: 'none' });

describe('showroom controller mode demo', () => {
  it('only faults while running', () => {
    const d = make('PROG');
    simulateMajorFault(d);
    expect(d.bool('faulted')).toBe(false);
    turnKey(d, 'RUN');
    simulateMajorFault(d);
    expect(d.bool('faulted')).toBe(true);
    expect(isRunning(d)).toBe(false);
  });

  it('key PROG → RUN → PROG clears a major fault (REM in between does not matter)', () => {
    const d = make('RUN');
    simulateMajorFault(d);
    turnKey(d, 'REM');
    turnKey(d, 'PROG');
    expect(d.bool('faulted')).toBe(true);
    turnKey(d, 'REM');
    turnKey(d, 'RUN');
    expect(d.bool('faulted')).toBe(true);
    turnKey(d, 'REM');
    turnKey(d, 'PROG');
    expect(d.bool('faulted')).toBe(false);
    expect(isRunning(d)).toBe(false);
  });

  it('a fault raised in Remote Run needs the full PROG → RUN → PROG sequence', () => {
    const d = make('REM', true);
    simulateMajorFault(d);
    turnKey(d, 'RUN');
    turnKey(d, 'PROG');
    expect(d.bool('faulted')).toBe(true);
    turnKey(d, 'RUN');
    turnKey(d, 'PROG');
    expect(d.bool('faulted')).toBe(false);
  });

  it('Clear Majors: REM → Remote Program, hard RUN → runs again', () => {
    const rem = make('REM', true);
    simulateMajorFault(rem);
    clearMajors(rem);
    expect(isRunning(rem)).toBe(false);
    const run = make('RUN');
    simulateMajorFault(run);
    clearMajors(run);
    expect(isRunning(run)).toBe(true);
  });
});
