/**
 * Test-only: plausible WRONG programs for chapter 2. Each must verify and fail at least one test
 * (enforced by src/game/missions.test.ts). Never imported by the app.
 */
import type { WrongAnswerSet } from './authoring';

const SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)OTE(Motor_Starter);';
const SAFE_SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const RUN_LIGHT = 'XIC(Motor_Aux)OTE(Run_Light);';
const READY_LIGHT = 'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);';
const FAULT_LIGHT = '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);';
const LIGHTS = [RUN_LIGHT, READY_LIGHT, FAULT_LIGHT];

export const CH2_WRONG: WrongAnswerSet = {
  '2-1': [
    { rungs: ['XIC(Start_PB)XIC(Stop_PB)OTE(Motor_Starter);'], why: 'no seal-in: runs only while Start is held' },
    { rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIO(Stop_PB)OTE(Motor_Starter);'], why: 'XIO on the N.C. stop: never runs' },
    { rungs: ['[XIC(Start_PB),XIC(Motor_Starter)XIC(Stop_PB)]OTE(Motor_Starter);'], why: 'stop only in the seal leg: Start wins' },
    { rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]OTE(Motor_Starter);'], why: 'no stop at all' },
    { rungs: ['XIO(Stop_PB)OTU(Motor_Starter);', 'XIC(Start_PB)OTL(Motor_Starter);'], why: 'latch after unlatch: Start wins' },
    { rungs: [SEAL, 'XIC(Start_PB)OTE(Motor_Starter);'], why: 'duplicate OTE overwrites the seal-in' },
  ],
  '2-2': [
    { rungs: [SEAL, 'XIC(Motor_Starter)OTE(Run_Light);', READY_LIGHT], why: 'RUN from the command instead of the feedback' },
    { rungs: [SEAL, RUN_LIGHT, 'XIC(EStop_OK)XIO(Motor_Aux)OTE(Ready_Light);'], why: 'READY ignores the overload' },
    { rungs: [SEAL, RUN_LIGHT, 'XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);'], why: 'READY ignores the E-stop' },
    { rungs: [SEAL, RUN_LIGHT, 'XIC(EStop_OK)XIC(OL_OK)OTE(Ready_Light);'], why: 'READY also while running' },
    { rungs: [SEAL, RUN_LIGHT, 'XIO(EStop_OK)XIO(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);'], why: 'N.C. confusion on READY' },
    { rungs: [SEAL, 'XIO(Motor_Aux)OTE(Run_Light);', READY_LIGHT], why: 'RUN inverted' },
    { rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)[OTE(Motor_Starter),OTE(Run_Light)];', READY_LIGHT], why: 'RUN on the motor rung (command, not feedback)' },
  ],
  '2-3': [
    { rungs: [SEAL, ...LIGHTS], why: 'E-stop / overload only hardwired: motor restarts after the reset' },
    {
      rungs: ['[XIC(Start_PB)XIC(EStop_OK)XIC(OL_OK),XIC(Motor_Starter)]XIC(Stop_PB)OTE(Motor_Starter);', ...LIGHTS],
      why: 'interlocks only on the Start leg: the seal survives the E-stop',
    },
    { rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)OTE(Motor_Starter);', ...LIGHTS], why: 'overload not interlocked' },
    { rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS], why: 'E-stop not interlocked' },
    { rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIO(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS], why: 'XIO on the N.C. E-stop: never runs' },
    { rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT, '[XIC(EStop_OK),XIC(OL_OK)]OTE(Fault_Light);'], why: 'FAULT light polarity' },
    { rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT, 'XIO(EStop_OK)OTE(Fault_Light);'], why: 'FAULT ignores the overload' },
    { rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT], why: 'no FAULT light' },
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Aux)]XIC(Stop_PB)OTE(Motor_Starter);', ...LIGHTS],
      why: 'aux-contact seal relying on the hardwired E-stop: the PLC keeps commanding the motor',
    },
  ],
  '2-4': [
    {
      rungs: ['XIC(Start_PB)OTL(Motor_Starter);', '[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK)]OTU(Motor_Starter);', ...LIGHTS],
      why: 'no first-scan unlatch: restarts after Program -> Run',
    },
    {
      rungs: ['[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK),XIC(S:FS)]OTU(Motor_Starter);', 'XIC(Start_PB)OTL(Motor_Starter);', ...LIGHTS],
      why: 'OTU before OTL: Start wins',
    },
    {
      rungs: ['XIC(Start_PB)OTL(Motor_Starter);', '[XIO(Stop_PB),XIO(OL_OK),XIC(S:FS)]OTU(Motor_Starter);', ...LIGHTS],
      why: 'E-stop does not unlatch',
    },
    {
      rungs: ['XIC(Start_PB)OTL(Motor_Starter);', '[XIC(Stop_PB),XIO(EStop_OK),XIO(OL_OK),XIC(S:FS)]OTU(Motor_Starter);', ...LIGHTS],
      why: 'N.C. trap on Stop: unlatched all the time',
    },
    {
      rungs: ['XIC(Start_PB)OTL(Motor_Starter);', '[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK),XIO(S:FS)]OTU(Motor_Starter);', ...LIGHTS],
      why: 'XIO(S:FS) unlatches on every scan but the first',
    },
  ],
  '2-5': [
    {
      rungs: ['[XIC(Start_PB),XIC(Jog_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'jog in the start branch: seals in',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Jog_PB),XIC(Motor_Aux)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'aux-contact seal: jog seals in too',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);',
        '[XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
      ],
      why: 'Run_Latch sealed by the output: jog seals in through it',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);',
        '[XIC(Run_Latch),XIC(Jog_PB)]OTE(Motor_Starter);',
        ...LIGHTS,
      ],
      why: 'jog bypasses Stop / E-stop / overload',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);',
        '[XIC(Run_Latch),XIC(Jog_PB)]XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
      ],
      why: 'Stop does not beat jog',
    },
    {
      rungs: [SAFE_SEAL, 'XIC(Jog_PB)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'jog as a second OTE rung: overwrites the start/stop rung',
    },
  ],
  '2-6': [
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Starter),XIC(HOA_Auto)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'HAND contact missing: Start works in OFF',
    },
    {
      rungs: ['[XIC(HOA_Hand)XIC(Start_PB),XIC(HOA_Auto)XIC(Remote_Run),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'seal outside the mode legs: survives OFF and AUTO',
    },
    {
      rungs: ['[XIC(HOA_Hand)[XIC(Start_PB),XIC(Motor_Starter)],XIC(HOA_Auto)XIC(Remote_Run)XIC(Start_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'AUTO also needs Start held',
    },
    {
      rungs: ['[XIC(HOA_Auto)[XIC(Start_PB),XIC(Motor_Starter)],XIC(HOA_Hand)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'HAND and AUTO swapped',
    },
    {
      rungs: ['[XIC(HOA_Hand)[XIC(Start_PB),XIC(Motor_Starter)],XIC(HOA_Auto)[XIC(Remote_Run),XIC(Motor_Starter)]]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'AUTO seals in: ignores Remote_Run going OFF',
    },
    {
      rungs: ['[XIC(HOA_Hand)[XIC(Start_PB),XIC(Motor_Starter)],XIC(HOA_Auto)XIC(Remote_Run)XIC(EStop_OK)XIC(OL_OK)]XIC(Stop_PB)OTE(Motor_Starter);', ...LIGHTS],
      why: 'HAND leg misses the E-stop / overload interlocks',
    },
  ],
  '2-7': [
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(HOA_Auto)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'AUTO not armed: restarts by itself after an E-stop',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'Stop does not disarm AUTO',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'E-stop / overload do not disarm AUTO',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        '[XIO(EStop_OK),XIO(OL_OK)]OTE(Horn);',
      ],
      why: 'horn also sounds on the E-stop',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'jog works in every mode',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Jog_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'jog seals HAND in',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        'XIC(Motor_Starter)OTE(Run_Light);',
        READY_LIGHT,
        FAULT_LIGHT,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'RUN light from the command',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        RUN_LIGHT,
        'XIO(Motor_Aux)OTE(Ready_Light);',
        FAULT_LIGHT,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'READY ignores the E-stop and the overload',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(HOA_Auto)XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        'XIO(OL_OK)OTE(Horn);',
      ],
      why: 'Auto_Armed ignores the selector: stays armed through OFF',
    },
  ],
};

/**
 * Alternative CORRECT programs a reasonable player might write: each must pass every test (palette
 * enforced). Proves the tests don't over-constrain the solution.
 */
export const CH2_RIGHT: WrongAnswerSet = {
  '2-1': [
    { rungs: ['[XIC(Start_PB),XIC(Motor_Aux)]XIC(Stop_PB)OTE(Motor_Starter);'], why: 'seal-in through the auxiliary contact' },
    { rungs: ['XIC(Stop_PB)[XIC(Start_PB),XIC(Motor_Starter)]OTE(Motor_Starter);'], why: 'Stop before the branch' },
  ],
  '2-2': [
    {
      rungs: [SEAL, 'XIC(Motor_Starter)XIC(Motor_Aux)OTE(Run_Light);', 'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Starter)OTE(Ready_Light);'],
      why: 'RUN = command AND feedback, READY from the command',
    },
  ],
  '2-3': [
    {
      rungs: ['XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)[XIC(Start_PB),XIC(Motor_Starter)]OTE(Motor_Starter);', ...LIGHTS],
      why: 'interlocks before the branch',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Aux)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'aux-contact seal with logic interlocks',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIO(Fault_Light)OTE(Motor_Starter);', RUN_LIGHT, READY_LIGHT, FAULT_LIGHT],
      why: 'interlock through the fault bit written one rung later (one-scan delay)',
    },
  ],
  '2-4': [
    {
      rungs: [
        'XIC(S:FS)OTU(Motor_Starter);',
        '[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK)]OTU(Motor_Starter);',
        'XIC(Start_PB)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTL(Motor_Starter);',
        ...LIGHTS,
      ],
      why: 'first-scan rung on top; OTL rung carries the permissives so Stop still wins',
    },
  ],
  '2-5': [
    {
      rungs: [
        '[XIC(Start_PB),XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)[OTE(Motor_Starter),XIO(Jog_PB)OTE(Run_Latch)];',
        ...LIGHTS,
      ],
      why: 'compact one-rung jog: jog breaks the run seal',
    },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Run_Latch)]XIO(Jog_PB)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);',
        '[XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
      ],
      why: 'jog while running drops the run request',
    },
  ],
  '2-6': [
    {
      rungs: [
        '[XIC(Start_PB),XIC(Run_Latch)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);',
        '[XIC(Run_Latch),XIC(HOA_Auto)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
      ],
      tags: [{ name: 'Run_Latch', dataType: 'BOOL' }],
      why: 'separate HAND run request',
    },
  ],
  '2-7': [
    {
      rungs: [
        '[XIC(Start_PB),XIC(Armed)][XIC(HOA_Hand),XIC(HOA_Auto)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Armed);',
        '[XIC(Armed)[XIC(HOA_Hand),XIC(HOA_Auto)XIC(Remote_Run)],XIC(HOA_Hand)XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
        'XIO(OL_OK)OTE(Horn);',
      ],
      tags: [{ name: 'Armed', dataType: 'BOOL' }],
      why: 'one "armed" memory for both modes',
    },
  ],
};
