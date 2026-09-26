/**
 * Test-only: plausible WRONG programs for chapter 1. Each must verify and fail at least one test
 * (enforced by src/game/missions.test.ts). Never imported by the app.
 */
import type { WrongAnswerSet } from './authoring';

export const CH1_WRONG: WrongAnswerSet = {
  '1-1': [
    { rungs: ['XIO(Switch_0)OTE(Light_0);'], why: 'XIO instead of XIC: lamp is inverted' },
    { rungs: ['XIC(Switch_1)OTE(Light_0);'], why: 'wrong switch' },
    { rungs: ['OTE(Light_0);'], why: 'unconditional output: always on' },
    { rungs: ['[XIC(Switch_0),XIC(Switch_1)]OTE(Light_0);'], why: 'another switch also lights it' },
    { rungs: ['XIC(Switch_0)OTE(Light_1);'], why: 'wrong lamp' },
    { rungs: ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_1)OTE(Light_0);'], why: 'duplicate OTE: last rung wins' },
  ],
  '1-2': [
    { rungs: ['XIC(Switch_1)OTE(Light_2);'], why: 'XIC: warns when the guard is closed' },
    { rungs: ['XIO(Switch_0)OTE(Light_2);'], why: 'wrong switch' },
    { rungs: ['OTE(Light_2);'], why: 'always on' },
    { rungs: ['XIO(Switch_1)OTE(Light_3);'], why: 'wrong lamp' },
  ],
  '1-3': [
    { rungs: ['[XIC(Switch_2),XIC(Switch_3)]OTE(Light_4);'], why: 'OR instead of AND' },
    { rungs: ['XIC(Switch_2)OTE(Light_4);'], why: 'only one key' },
    { rungs: ['XIC(Switch_2)XIO(Switch_3)OTE(Light_4);'], why: 'XIO on the second key' },
    { rungs: ['XIC(Switch_2)OTE(Light_4);', 'XIC(Switch_3)OTE(Light_4);'], why: 'two rungs: last one wins' },
    { rungs: ['XIC(Switch_2)XIC(Switch_3)OTE(Light_5);'], why: 'wrong lamp' },
    { rungs: ['[XIC(Switch_2)XIC(Switch_3),XIC(Switch_0)]OTE(Light_4);'], why: 'a third switch alone arms the rig (defeats the two-person rule)' },
    { rungs: ['XIC(Switch_2)XIC(Switch_3)XIO(Switch_0)OTE(Light_4);'], why: 'an unrelated switch blocks arming' },
    { rungs: ['[XIC(Switch_2)XIC(Switch_3),XIC(Switch_2)XIC(Switch_7)]OTE(Light_4);'], why: 'operator key + an unrelated switch arms the rig' },
  ],
  '1-4': [
    { rungs: ['XIC(PB_Black_1)OTE(Buzzer);', 'XIC(PB_Black_2)OTE(Buzzer);'], why: 'duplicate destructive bit: station A never works' },
    { rungs: ['XIC(PB_Black_1)XIC(PB_Black_2)OTE(Buzzer);'], why: 'AND instead of OR' },
    { rungs: ['XIC(PB_Black_1)OTE(Buzzer);'], why: 'only station A' },
    { rungs: ['[XIC(PB_Black_1),XIC(PB_Green)]OTE(Buzzer);'], why: 'wrong button for station B' },
    { rungs: ['[XIC(PB_Black_1),XIC(PB_Black_2),XIC(Buzzer)]OTE(Buzzer);'], why: 'accidental seal-in: never stops' },
  ],
  '1-5': [
    { rungs: ['XIC(PB_Red)[OTE(Light_5),OTE(Buzzer)];', 'XIO(PB_Red)OTE(Light_1);'], why: 'the N.C. trap: everything inverted' },
    { rungs: ['XIO(PB_Red)OTE(Light_5);', 'XIC(PB_Red)OTE(Light_1);'], why: 'forgot the buzzer' },
    { rungs: ['XIO(PB_Red)[OTE(Light_5),OTE(Buzzer)];'], why: 'forgot the READY lamp' },
    { rungs: ['XIO(PB_Red)[OTE(Light_5),OTE(Buzzer),OTE(Light_1)];'], why: 'READY on at the wrong time' },
    { rungs: ['XIO(PB_Red)OTE(Light_5);', 'XIO(PB_Red)OTE(Buzzer);', 'XIO(PB_Red)OTE(Light_1);'], why: 'READY inverted' },
  ],
  '1-6': [
    { rungs: ['[XIC(Switch_4),XIC(Switch_5)]OTE(Light_6);'], why: 'OR: both ON must be dark' },
    { rungs: ['XIC(Switch_4)XIC(Switch_5)OTE(Light_6);'], why: 'AND' },
    { rungs: ['[XIC(Switch_4)XIC(Switch_5),XIO(Switch_4)XIO(Switch_5)]OTE(Light_6);'], why: 'XNOR: inverted' },
    { rungs: ['XIC(Switch_4)XIO(Switch_5)OTE(Light_6);'], why: 'only one leg' },
    { rungs: ['XIC(Switch_4)XIO(Switch_5)OTE(Light_6);', 'XIO(Switch_4)XIC(Switch_5)OTE(Light_6);'], why: 'two OTE rungs: last one wins' },
  ],
  '1-7': [
    {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1)XIO(PB_Red),XIC(PB_Green)]OTE(Light_0);',
        '[XIC(PB_Black_1),XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
      why: 'N.C. trap on READY',
    },
    {
      rungs: [
        'XIC(Switch_0)XIC(Switch_1)XIC(PB_Red)OTE(Light_0);',
        '[XIC(PB_Black_1),XIC(PB_Black_2)]OTE(Light_2);',
        'XIO(PB_Red)OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
        'XIC(PB_Green)OTE(Light_0);',
        'XIC(PB_Green)OTE(Light_2);',
        'XIC(PB_Green)OTE(Light_4);',
      ],
      why: 'lamp test as extra OTE rungs: they overwrite the real functions',
    },
    {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1)XIC(PB_Red),XIC(PB_Green)]OTE(Light_0);',
        '[XIC(PB_Black_1),XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        '[XIC(Switch_0)XIO(Switch_1),XIC(PB_Green)]OTE(Buzzer);',
      ],
      why: 'lamp test sounds the buzzer',
    },
    {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1)XIC(PB_Red),XIC(PB_Green)]OTE(Light_0);',
        '[XIC(PB_Black_1),XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        'XIO(Switch_1)OTE(Buzzer);',
      ],
      why: 'buzzer ignores the power key',
    },
    {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1),XIC(PB_Green)]OTE(Light_0);',
        '[XIC(PB_Black_1),XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
      why: 'READY ignores the STOP button',
    },
    {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1)XIC(PB_Red),XIC(PB_Green)]OTE(Light_0);',
        'XIC(PB_Black_1)XIC(PB_Black_2)OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
      why: 'CALL needs both buttons and misses the lamp test',
    },
    {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1)XIC(PB_Red),XIC(PB_Green)]OTE(Light_0);',
        '[XIC(PB_Black_1),XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        '[XIC(Switch_0)XIO(Switch_1),XIO(PB_Red)]OTE(Buzzer);',
      ],
      why: "buzzer also on STOP (carried over from 1-5) — caught in 'READY and the guard buzzer'",
    },
    {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1)XIC(PB_Red),XIC(PB_Green)]OTE(Light_0);',
        '[XIC(PB_Black_1)XIO(PB_Black_2),XIO(PB_Black_1)XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
      why: "CALL as the exclusive OR from 1-6: dark with both call buttons held — caught in 'CALL from either station'",
    },
  ],
};

/**
 * Alternative CORRECT programs a reasonable player might write: each must pass every test (palette
 * enforced). Proves the tests don't over-constrain the solution.
 */
export const CH1_RIGHT: WrongAnswerSet = {
  '1-1': [{ rungs: ['', 'XIC(Switch_0)OTE(Light_0);'], why: 'leading empty rung' }],
  '1-3': [{ rungs: ['XIC(Switch_3)XIC(Switch_2)OTE(Light_4);'], why: 'keys in the other order' }],
  '1-4': [{ rungs: ['[XIC(PB_Black_2),XIC(PB_Black_1)]OTE(Buzzer);'], why: 'legs swapped' }],
  '1-5': [
    { rungs: ['XIO(PB_Red)OTE(Light_5);', 'XIO(PB_Red)OTE(Buzzer);', 'XIC(PB_Red)OTE(Light_1);'], why: 'one rung per output (over par)' },
    { rungs: ['XIC(PB_Red)OTE(Light_1);', 'XIO(PB_Red)[OTE(Buzzer),OTE(Light_5)];'], why: 'rungs reordered' },
  ],
  '1-6': [{ rungs: ['[XIO(Switch_4)XIC(Switch_5),XIC(Switch_4)XIO(Switch_5)]OTE(Light_6);'], why: 'legs swapped' }],
  '1-7': [
    {
      rungs: [
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        '[XIC(PB_Green),XIC(PB_Black_2),XIC(PB_Black_1)]OTE(Light_2);',
        '[XIC(PB_Green),XIC(PB_Red)XIC(Switch_1)XIC(Switch_0)]OTE(Light_0);',
      ],
      why: 'rungs and legs in another order',
    },
  ],
};
