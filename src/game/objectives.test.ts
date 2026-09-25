/**
 * The objectives checklist follows each mission's explicit objective → test map: the QA cases where the old
 * positional pairing (objective i ↔ test i) ticked the broken behaviour and crossed the working one.
 */
import { describe, expect, it } from 'vitest';
import { getMission } from './missions';
import { classifyFailure, objectiveStates } from './objectives';
import type { MissionDef, TestResult } from './types';
import { runMission, solutionProject } from './validation';

const states = (id: string, rungs: string[]) => {
  const m = getMission(id)!;
  return objectiveStates(m, runMission(m, rungs, { enforcePalette: false }).tests, false);
};

describe('objective states from the explicit map', () => {
  it('1-3 one-key rung: crosses "one key is not enough", ticks "both keys arm" (QA: it was the other way round)', () => {
    expect(states('1-3', ['XIC(Switch_2)OTE(Light_4);'])).toEqual(['failed', 'passed', 'failed', 'failed']);
  });

  it('1-7 with only the buzzer rung wrong: the buzzer objective is crossed, CALL is ticked, READY is never crossed', () => {
    const m = getMission('1-7')!;
    const rungs = [...m.solution.rungs.slice(0, 3), 'XIC(Switch_0)XIC(Switch_1)OTE(Buzzer);'];
    const s = states('1-7', rungs);
    expect(s[3]).toBe('failed'); // Buzzer when the guard opens with the key ON
    expect(s[1]).toBe('passed'); // CALL lamp from either station
    expect(s[0]).not.toBe('failed'); // READY works
    expect(s[4]).not.toBe('failed'); // lamp test works
  });

  it('an invariant trip is charged to the objective that lists the invariant', () => {
    // 2-1 without a Stop contact: the "Stop wins" invariant trips
    const s = states('2-1', ['[XIC(Start_PB),XIC(Motor_Starter)]OTE(Motor_Starter);', 'XIC(Motor_Aux)OTE(Run_Light);']);
    expect(s[0]).not.toBe('failed'); // start + seal-in work
    expect(s[1]).toBe('failed'); // Stop does not stop
    expect(s[2]).toBe('failed'); // Stop does not win
  });

  it('the reference solution ticks everything; before a run everything is open', () => {
    const m = getMission('5-5')!;
    expect(objectiveStates(m, runMission(m, solutionProject(m)).tests, false).every((x) => x === 'passed')).toBe(true);
    expect(objectiveStates(m, [], false).every((x) => x === 'pending')).toBe(true);
  });

  it('step proofs: broken at a listed step, holding after the last one, unknown before', () => {
    const m: Pick<MissionDef, 'objectives' | 'tests' | 'objectiveTests' | 'invariants'> = {
      objectives: ['early', 'late'],
      tests: [
        {
          name: 't',
          steps: [
            { do: 'expect', observe: 'a', equals: true, message: 'A on' },
            { do: 'wait', ms: 10 },
            { do: 'expect', observe: 'b', equals: true, message: 'B on' },
          ],
        },
      ],
      objectiveTests: [[{ test: 0, steps: [0] }], [{ test: 0, observe: ['b'] }]],
      invariants: [{ observe: 'c', equals: false, message: 'C must stay off' }],
    };
    const failAt = (step: number, failure: string): TestResult => ({
      name: 't',
      passed: false,
      failure,
      steps: Array.from({ length: step + 1 }, (_, i) => ({ ok: i < step, timeMs: 0 })),
    });
    expect(objectiveStates(m, [failAt(2, 'B on — expected b = 1, but it was 0')], false)).toEqual(['passed', 'failed']);
    expect(objectiveStates(m, [failAt(0, 'A on — expected a = 1, but it was 0')], false)).toEqual(['failed', 'pending']);
    // an invariant trip in the wait step: the early proof already held, the late one is unknown
    expect(objectiveStates(m, [failAt(1, 'C must stay off — c was 1 at 0.01 s')], false)).toEqual(['passed', 'pending']);
    expect(classifyFailure(m, m.tests[0], failAt(1, 'C must stay off — c was 1 at 0.01 s'))).toEqual({ kind: 'invariant', step: 1, invariant: 0 });
    // a controller fault breaks every proof on that test
    expect(objectiveStates(m, [failAt(1, 'The controller faulted (major fault).')], false)).toEqual(['passed', 'failed']);
  });
});
