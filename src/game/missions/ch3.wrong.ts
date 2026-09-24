/**
 * Test-only: plausible WRONG programs for chapter 3 (each must verify and fail at least one test) and
 * alternative CORRECT programs (`CH3_RIGHT`, each must pass). Enforced by src/game/missions.test.ts.
 * Never imported by the app.
 */
import type { WrongAnswerSet } from './authoring';

// --- motor station ------------------------------------------------------------
const SAFE_SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const RUN_LIGHT = 'XIC(Motor_Aux)OTE(Run_Light);';
const READY_LIGHT = 'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);';
const FAULT_SERVICE = '[XIO(EStop_OK),XIO(OL_OK),XIC(Run_Timer.DN)]OTE(Fault_Light);';

const WARN_REQ = '[XIC(Start_PB),XIC(Start_Warning)]XIO(Motor_Starter)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Start_Warning);';
const WARN_TMR = 'XIC(Start_Warning)TON(Warn_Timer,3000,0);';
const WARN_HORN = 'XIC(Warn_Timer.TT)OTE(Horn);';
const WARN_MOTOR = '[XIC(Warn_Timer.DN),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';

const HOUR_RTO = 'XIC(Motor_Aux)RTO(Run_Timer,30000,0);';
const HOLD_TON = 'XIC(Jog_PB)XIO(Motor_Aux)TON(Reset_Hold,2000,0);';
const HOLD_RES = 'XIC(Reset_Hold.DN)RES(Run_Timer);';

// --- traffic ----------------------------------------------------------------------
const TIMERS = [
  'XIO(T_All_Red_2.DN)TON(T_NS_Green,10000,0);',
  'XIC(T_NS_Green.DN)TON(T_NS_Yellow,3000,0);',
  'XIC(T_NS_Yellow.DN)TON(T_All_Red_1,1000,0);',
  'XIC(T_All_Red_1.DN)TON(T_EW_Green,8000,0);',
  'XIC(T_EW_Green.DN)TON(T_EW_Yellow,3000,0);',
  'XIC(T_EW_Yellow.DN)TON(T_All_Red_2,1000,0);',
];
const NS_GREEN = 'XIO(T_NS_Green.DN)OTE(NS_Green);';
const NS_YELLOW = 'XIC(T_NS_Green.DN)XIO(T_NS_Yellow.DN)OTE(NS_Yellow);';
const NS_RED = 'XIC(T_NS_Yellow.DN)OTE(NS_Red);';
const EW_GREEN = 'XIC(T_All_Red_1.DN)XIO(T_EW_Green.DN)OTE(EW_Green);';
const EW_YELLOW = 'XIC(T_EW_Green.DN)XIO(T_EW_Yellow.DN)OTE(EW_Yellow);';
const EW_RED = '[XIO(T_All_Red_1.DN),XIC(T_EW_Yellow.DN)]OTE(EW_Red);';
const LAMPS = [NS_GREEN, NS_YELLOW, NS_RED, EW_GREEN, EW_YELLOW, EW_RED];
const DW_STEADY = 'OTE(Dont_Walk);';

const PED_REQ = '[XIC(Ped_PB),XIC(Ped_Request)]XIO(Walk)OTE(Ped_Request);';
const PED_ACTIVE = '[XIC(Ped_Request)XIC(T_NS_Yellow.DN)XIO(T_All_Red_1.DN),XIC(Walk_Active)]XIC(T_NS_Yellow.DN)OTE(Walk_Active);';
const PED_TWALK = 'XIC(Walk_Active)TON(T_Walk,6000,0);';
const PED_FLASH = ['XIC(T_Walk.DN)XIO(T_Flash_Off.DN)TON(T_Flash_On,500,0);', 'XIC(T_Flash_On.DN)TON(T_Flash_Off,500,0);'];
const PED_DW = '[XIO(Walk_Active),XIC(T_Walk.DN)XIO(T_Flash_On.DN)]OTE(Dont_Walk);';
const PED_WALK = 'XIC(Walk_Active)XIO(T_Walk.DN)OTE(Walk);';
/** Full 3-7 program with some rungs replaced. */
const ped = (o: Partial<Record<'req' | 'active' | 'twalk' | 'dw' | 'walk', string>> & { flash?: string[] } = {}): string[] => [
  ...TIMERS,
  o.req ?? PED_REQ,
  o.active ?? PED_ACTIVE,
  o.twalk ?? PED_TWALK,
  ...(o.flash ?? PED_FLASH),
  ...LAMPS,
  o.dw ?? PED_DW,
  o.walk ?? PED_WALK,
];

export const CH3_WRONG: WrongAnswerSet = {
  '3-1': [
    { rungs: ['XIC(Switch_0)OTE(Light_0);'], why: 'no timer at all' },
    { rungs: ['XIC(Switch_0)TOF(Purge_Timer,3000,0);', 'XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'TOF instead of TON: lights at once, goes off late' },
    { rungs: ['XIC(Switch_0)RTO(Purge_Timer,3000,0);', 'XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'RTO: never resets, stays lit' },
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,3,0);', 'XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'preset in seconds (3 ms)' },
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,30000,0);', 'XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'preset 30 s' },
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,3000,0);', 'XIC(Purge_Timer.TT)OTE(Light_0);'], why: 'lamp on the timing bit: lit during the purge' },
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,3000,0);', 'XIC(Purge_Timer.EN)OTE(Light_0);'], why: 'lamp on the enable bit: no delay' },
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,3000,0);', 'XIC(Purge_Timer.DN)OTL(Light_0);'], why: 'latched lamp never goes off' },
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,3000,0);', 'XIO(Purge_Timer.DN)OTE(Light_0);'], why: 'done bit inverted' },
    { rungs: ['TON(Purge_Timer,3000,0);', 'XIC(Switch_0)XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'timer runs from power-up, not from the switch' },
    { rungs: ['XIC(Switch_1)TON(Purge_Timer,3000,0);', 'XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'wrong switch' },
  ],
  '3-2': [
    { rungs: ['XIC(Switch_1)TON(Fan_Overrun,5000,0);', 'XIC(Fan_Overrun.DN)OTE(Light_6);'], why: 'TON instead of TOF' },
    { rungs: ['XIC(Switch_1)TOF(Fan_Overrun,500,0);', 'XIC(Fan_Overrun.DN)OTE(Light_6);'], why: 'overrun 0.5 s' },
    { rungs: ['XIC(Switch_1)TOF(Fan_Overrun,50000,0);', 'XIC(Fan_Overrun.DN)OTE(Light_6);'], why: 'overrun 50 s' },
    { rungs: ['XIC(Switch_1)RTO(Fan_Overrun,5000,0);', 'XIC(Fan_Overrun.DN)OTE(Light_6);'], why: 'RTO' },
    {
      rungs: ['XIO(Switch_1)TON(Fan_Overrun,5000,0);', '[XIC(Switch_1),XIO(Fan_Overrun.DN)]OTE(Light_6);'],
      why: 'home-made off-delay from a TON: runs the fan 5 s at power-up',
    },
    { rungs: ['XIC(Switch_1)TOF(Fan_Overrun,5000,0);', 'XIC(Fan_Overrun.TT)OTE(Light_6);'], why: 'fan only during the overrun, not with the heater' },
    { rungs: ['XIO(Switch_1)TOF(Fan_Overrun,5000,0);', 'XIC(Fan_Overrun.DN)OTE(Light_6);'], why: 'rung inverted' },
    { rungs: ['XIC(Switch_1)TOF(Fan_Overrun,5000,0);', 'XIO(Fan_Overrun.DN)OTE(Light_6);'], why: 'done bit inverted' },
    {
      rungs: ['XIC(Switch_1)TOF(Fan_Overrun,5000,0)XIC(Fan_Overrun.DN)OTE(Light_6);'],
      why: 'inline output after the TOF: the rung is false as soon as the heater is off, overrun or not',
    },
  ],
  '3-3': [
    { rungs: ['XIC(Switch_2)OTE(Light_4);'], why: 'steady lamp, no flashing' },
    {
      rungs: ['XIC(Switch_2)XIO(Flash_On.DN)TON(Flash_On,500,0);', 'XIC(Flash_On.DN)OTE(Light_4);'],
      why: 'single self-resetting timer: a 10 ms blip every 0.5 s',
    },
    {
      rungs: ['XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,1000,0);', 'XIC(Flash_On.DN)TON(Flash_Off,1000,0);', 'XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);'],
      why: '1 s / 1 s instead of 0.5 s / 0.5 s',
    },
    {
      rungs: ['XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,250,0);', 'XIC(Flash_On.DN)TON(Flash_Off,250,0);', 'XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);'],
      why: '2 Hz instead of 1 Hz',
    },
    {
      rungs: ['XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,500,0);', 'XIC(Flash_On.DN)TON(Flash_Off,1000,0);', 'XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);'],
      why: 'uneven: 0.5 s on / 1 s off',
    },
    {
      rungs: ['XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,500,0);', 'XIC(Flash_On.DN)TON(Flash_Off,500,0);', 'XIO(Flash_On.DN)OTE(Light_4);'],
      why: 'lamp not gated by the alarm: lit while the alarm is off',
    },
    {
      rungs: ['XIC(Switch_2)TON(Flash_On,500,0);', 'XIC(Flash_On.DN)TON(Flash_Off,500,0);', 'XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);'],
      why: 'the dark-phase timer never resets the lit-phase timer: one flash only',
    },
    {
      rungs: ['XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,500,0);', 'XIC(Flash_On.DN)TOF(Flash_Off,500,0);', 'XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);'],
      why: 'TOF for the dark phase: the pair locks up',
    },
  ],
  '3-4': [
    { rungs: [SAFE_SEAL, 'XIC(Start_PB)OTE(Horn);'], why: 'horn only while Start is held, motor starts at once' },
    {
      rungs: ['XIC(Start_PB)TON(Warn_Timer,3000,0);', WARN_HORN, WARN_MOTOR],
      why: 'timer on the push button: Start must be held 3 s',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Start_Warning)]XIO(Motor_Starter)OTE(Start_Warning);', WARN_TMR, WARN_HORN, WARN_MOTOR],
      why: 'Stop / E-stop do not cancel the warning: the motor starts anyway',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Start_Warning)]XIO(Motor_Starter)XIC(Stop_PB)OTE(Start_Warning);', WARN_TMR, WARN_HORN, WARN_MOTOR],
      why: 'E-stop does not cancel the warning',
    },
    { rungs: [WARN_REQ, WARN_TMR, '[XIC(Warn_Timer.TT),XIC(Motor_Starter)]OTE(Horn);', WARN_MOTOR], why: 'horn keeps sounding while running' },
    { rungs: [WARN_REQ, WARN_TMR, 'XIC(Warn_Timer.DN)OTE(Horn);', WARN_MOTOR], why: 'horn after the delay instead of before' },
    { rungs: [WARN_REQ, 'XIC(Start_Warning)TOF(Warn_Timer,3000,0);', WARN_HORN, WARN_MOTOR], why: 'TOF instead of TON' },
    { rungs: [WARN_REQ, 'XIC(Start_Warning)TON(Warn_Timer,300,0);', WARN_HORN, WARN_MOTOR], why: '0.3 s warning' },
    {
      rungs: [WARN_REQ, WARN_TMR, WARN_HORN, 'XIC(Warn_Timer.DN)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);'],
      why: 'motor not sealed: it drops as soon as the warning ends',
    },
    {
      rungs: [WARN_REQ, WARN_TMR, WARN_HORN, '[XIC(Warn_Timer.DN),XIC(Motor_Starter)]OTE(Motor_Starter);'],
      why: 'Stop / E-stop / overload removed from the motor rung',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Start_Warning)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Start_Warning);', WARN_TMR, 'XIC(Start_Warning)OTE(Horn);', 'XIC(Warn_Timer.DN)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);'],
      why: 'horn on the request: it never stops while running',
    },
  ],
  '3-5': [
    { rungs: [SAFE_SEAL, 'XIC(Motor_Aux)TON(Run_Timer,30000,0);', HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE], why: 'TON: loses the time at every stop' },
    { rungs: [SAFE_SEAL, 'XIC(Start_PB)RTO(Run_Timer,30000,0);', HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE], why: 'counts while Start is held' },
    { rungs: [SAFE_SEAL, 'XIO(Motor_Aux)RTO(Run_Timer,30000,0);', HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE], why: 'counts stopped time' },
    { rungs: [SAFE_SEAL, HOUR_RTO, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE], why: 'no reset at all' },
    { rungs: [SAFE_SEAL, HOUR_RTO, 'XIC(Jog_PB)RES(Run_Timer);', RUN_LIGHT, READY_LIGHT, FAULT_SERVICE], why: 'any short press resets (no 2 s hold)' },
    {
      rungs: [SAFE_SEAL, HOUR_RTO, 'XIC(Jog_PB)TON(Reset_Hold,2000,0);', HOLD_RES, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE],
      why: 'reset allowed while the motor runs',
    },
    {
      rungs: [SAFE_SEAL, HOUR_RTO, 'XIC(Jog_PB)XIO(Motor_Aux)TON(Reset_Hold,200,0);', HOLD_RES, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE],
      why: 'hold time 0.2 s',
    },
    {
      rungs: [SAFE_SEAL, HOUR_RTO, HOLD_TON, HOLD_RES, 'XIC(S:FS)RES(Run_Timer);', RUN_LIGHT, READY_LIGHT, FAULT_SERVICE],
      why: 'first-scan reset: the hour meter is lost at every Program -> Run',
    },
    { rungs: [SAFE_SEAL, HOUR_RTO, HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);'], why: 'no SERVICE DUE indication' },
    { rungs: [SAFE_SEAL, HOUR_RTO, HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, 'XIC(Run_Timer.DN)OTE(Fault_Light);'], why: 'FAULT lamp lost the E-stop / overload indication' },
    { rungs: [SAFE_SEAL, 'XIC(Motor_Aux)RTO(Run_Timer,3000,0);', HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE], why: 'preset 3 s instead of 30 s' },
    { rungs: [SAFE_SEAL, HOUR_RTO, HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, '[XIO(EStop_OK),XIO(OL_OK),XIC(Run_Timer.TT)]OTE(Fault_Light);'], why: 'lamp on .TT: lit while running' },
  ],
  '3-6': [
    {
      rungs: [
        'XIO(T_EW_Yellow.DN)TON(T_NS_Green,10000,0);',
        'XIC(T_NS_Green.DN)TON(T_NS_Yellow,3000,0);',
        'XIC(T_NS_Yellow.DN)TON(T_EW_Green,8000,0);',
        'XIC(T_EW_Green.DN)TON(T_EW_Yellow,3000,0);',
        NS_GREEN,
        NS_YELLOW,
        NS_RED,
        'XIC(T_NS_Yellow.DN)XIO(T_EW_Green.DN)OTE(EW_Green);',
        EW_YELLOW,
        '[XIO(T_NS_Yellow.DN),XIC(T_EW_Yellow.DN)]OTE(EW_Red);',
        DW_STEADY,
      ],
      why: 'no all-red clearance',
    },
    {
      rungs: [...TIMERS.map((r) => r.replace('T_NS_Yellow,3000', 'T_NS_Yellow,300').replace('T_EW_Yellow,3000', 'T_EW_Yellow,300')), ...LAMPS, DW_STEADY],
      why: 'yellows of 0.3 s',
    },
    {
      rungs: [
        'XIO(T_All_Red_2.DN)TON(T_NS_Green,10,0);',
        'XIC(T_NS_Green.DN)TON(T_NS_Yellow,3,0);',
        'XIC(T_NS_Yellow.DN)TON(T_All_Red_1,1,0);',
        'XIC(T_All_Red_1.DN)TON(T_EW_Green,8,0);',
        'XIC(T_EW_Green.DN)TON(T_EW_Yellow,3,0);',
        'XIC(T_EW_Yellow.DN)TON(T_All_Red_2,1,0);',
        ...LAMPS,
        DW_STEADY,
      ],
      why: 'presets in seconds',
    },
    {
      rungs: [...TIMERS, NS_GREEN, NS_YELLOW, NS_RED, 'XIC(T_NS_Green.DN)XIO(T_EW_Green.DN)OTE(EW_Green);', EW_YELLOW, '[XIO(T_NS_Green.DN),XIC(T_EW_Yellow.DN)]OTE(EW_Red);', DW_STEADY],
      why: 'EW green starts with NS yellow: conflict',
    },
    { rungs: ['TON(T_NS_Green,10000,0);', ...TIMERS.slice(1), ...LAMPS, DW_STEADY], why: 'the cycle never repeats' },
    { rungs: [...TIMERS, ...LAMPS], why: "DON'T WALK not lit" },
    { rungs: [...TIMERS, NS_GREEN, NS_YELLOW, 'XIC(T_All_Red_1.DN)XIO(T_All_Red_2.DN)OTE(NS_Red);', EW_GREEN, EW_YELLOW, EW_RED, DW_STEADY], why: 'NS red missing in the all-red phases' },
    { rungs: [...TIMERS, NS_GREEN, NS_YELLOW, 'XIC(T_NS_Green.DN)OTE(NS_Red);', EW_GREEN, EW_YELLOW, EW_RED, DW_STEADY], why: 'NS red and yellow lit together' },
    { rungs: [...TIMERS, ...LAMPS, 'XIO(Walk)OTE(Dont_Walk);', 'XIC(T_All_Red_1.DN)XIO(T_EW_Green.DN)OTE(Walk);'], why: 'WALK lit with EW green' },
    { rungs: [...TIMERS.map((r) => r.replace('TON(', 'RTO(')), ...LAMPS, DW_STEADY], why: 'RTOs never reset: the cycle stops' },
    {
      rungs: [
        ...TIMERS.map((r) => r.replace('T_NS_Green,10000', 'T_NS_Green,8000').replace('T_EW_Green,8000', 'T_EW_Green,10000')),
        ...LAMPS,
        DW_STEADY,
      ],
      why: 'green times swapped',
    },
  ],
  '3-7': [
    { rungs: [...TIMERS, ...LAMPS, DW_STEADY], why: 'no pedestrian phase at all' },
    {
      rungs: ped({ req: 'XIC(Ped_PB)OTE(Ped_Request);' }),
      why: 'request not remembered: only a press during the all-red window works',
    },
    { rungs: ped({ req: 'XIC(Ped_PB)OTL(Ped_Request);' }), why: 'request never cleared: WALK every cycle' },
    {
      rungs: ped({ active: '[XIC(T_NS_Yellow.DN)XIO(T_All_Red_1.DN),XIC(Walk_Active)]XIC(T_NS_Yellow.DN)OTE(Walk_Active);' }),
      why: 'WALK every cycle, request ignored',
    },
    {
      rungs: ped({ active: '[XIC(Ped_Request)XIC(T_NS_Yellow.DN),XIC(Walk_Active)]XIC(T_NS_Yellow.DN)OTE(Walk_Active);' }),
      why: 'late request served at once during EW green',
    },
    {
      rungs: ped({ active: '[XIC(Ped_Request)XIC(T_All_Red_1.DN)XIO(T_EW_Green.DN),XIC(Walk_Active)]XIC(T_NS_Yellow.DN)OTE(Walk_Active);' }),
      why: 'WALK starts with EW green instead of when NS yellow ends',
    },
    { rungs: ped({ dw: 'XIO(Walk)OTE(Dont_Walk);' }), why: "steady DON'T WALK after WALK: no flashing clearance" },
    { rungs: ped({ twalk: 'XIC(Walk_Active)TON(T_Walk,3000,0);' }), why: 'WALK only 3 s' },
    { rungs: ped({ twalk: 'XIC(Walk_Active)TON(T_Walk,12000,0);' }), why: 'WALK 12 s' },
    { rungs: ped({ dw: DW_STEADY }), why: "WALK and DON'T WALK lit together" },
    { rungs: ped({ walk: 'XIC(Ped_Request)OTE(Walk);' }), why: 'WALK straight from the request: conflicts with NS green' },
    {
      rungs: ped({ active: '[XIC(Ped_Request)XIC(T_NS_Yellow.DN)XIO(T_All_Red_1.DN),XIC(Walk_Active)]OTE(Walk_Active);' }),
      why: 'pedestrian phase never ends: the clearance flashes forever',
    },
    {
      rungs: ped({ dw: '[XIO(Walk_Active),XIC(T_Walk.DN)XIO(T_Flash_On.DN)]OTE(Dont_Walk);', flash: ['XIC(T_Walk.DN)XIO(T_Flash_Off.DN)TON(T_Flash_On,1500,0);', 'XIC(T_Flash_On.DN)TON(T_Flash_Off,1500,0);'] }),
      why: 'clearance flashing far too slow',
    },
  ],
};

export const CH3_RIGHT: WrongAnswerSet = {
  '3-1': [
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,3000,0)XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'one rung: output after the timer box' },
    { rungs: ['XIC(Purge_Timer.DN)OTE(Light_0);', 'XIC(Switch_0)TON(Purge_Timer,3000,0);'], why: 'lamp rung first (one scan later)' },
    { rungs: ['XIC(Switch_0)TON(Purge_Timer,3000,0);', 'XIC(Switch_0)XIC(Purge_Timer.DN)OTE(Light_0);'], why: 'switch repeated on the lamp rung' },
  ],
  '3-2': [
    { rungs: ['XIC(Switch_1)TOF(Fan_Overrun,5000,0);', '[XIC(Switch_1),XIC(Fan_Overrun.TT)]OTE(Light_6);'], why: 'heater OR timing bit' },
  ],
  '3-3': [
    {
      rungs: ['XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,500,0);', 'XIC(Flash_On.DN)TON(Flash_Off,500,0);', 'XIC(Flash_On.DN)OTE(Light_4);'],
      why: 'dark phase first',
    },
    {
      rungs: ['XIO(Flash_Off.DN)TON(Flash_On,500,0);', 'XIC(Flash_On.DN)TON(Flash_Off,500,0);', 'XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);'],
      why: 'free-running flasher, lamp gated by the alarm',
    },
  ],
  '3-4': [
    {
      rungs: [
        '[XIC(Start_PB),XIC(Start_Warning)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Start_Warning);',
        WARN_TMR,
        WARN_HORN,
        'XIC(Warn_Timer.DN)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
      ],
      why: 'Start_Warning as a run request; the timer stays done while running',
    },
    {
      rungs: [WARN_REQ, WARN_TMR, 'XIC(Start_Warning)XIO(Warn_Timer.DN)OTE(Horn);', WARN_MOTOR],
      why: 'horn = request AND NOT done',
    },
  ],
  '3-5': [
    {
      rungs: [SAFE_SEAL, 'XIC(Motor_Starter)RTO(Run_Timer,30000,0);', 'XIC(Jog_PB)XIO(Motor_Starter)TON(Reset_Hold,2000,0);', HOLD_RES, RUN_LIGHT, READY_LIGHT, FAULT_SERVICE],
      why: 'counts the command instead of the feedback',
    },
    {
      rungs: [SAFE_SEAL, HOUR_RTO, HOLD_TON, HOLD_RES, RUN_LIGHT, READY_LIGHT, '[XIC(Run_Timer.DN),XIO(OL_OK),XIO(EStop_OK)]OTE(Fault_Light);'],
      why: 'branch legs reordered',
    },
  ],
  '3-6': [
    {
      rungs: [
        ...TIMERS,
        'XIC(T_NS_Green.TT)OTE(NS_Green);',
        'XIC(T_NS_Yellow.TT)OTE(NS_Yellow);',
        'XIO(T_NS_Green.TT)XIO(T_NS_Yellow.TT)OTE(NS_Red);',
        'XIC(T_EW_Green.TT)OTE(EW_Green);',
        'XIC(T_EW_Yellow.TT)OTE(EW_Yellow);',
        'XIO(T_EW_Green.TT)XIO(T_EW_Yellow.TT)OTE(EW_Red);',
        'XIO(Walk)OTE(Dont_Walk);',
      ],
      why: 'lamps from the timing (.TT) bits',
    },
    { rungs: [...LAMPS, ...TIMERS, DW_STEADY], why: 'lamp rungs before the timers' },
  ],
  '3-7': [
    {
      rungs: ped({ req: 'XIC(Ped_PB)OTL(Ped_Request);', walk: 'XIC(Walk_Active)XIO(T_Walk.DN)[OTE(Walk),OTU(Ped_Request)];' }),
      why: 'OTL request, unlatched on the WALK rung',
    },
    {
      rungs: [
        ...TIMERS,
        PED_REQ,
        'XIC(Ped_Request)XIC(T_NS_Yellow.DN)XIO(T_All_Red_1.DN)OTL(Walk_Active);',
        'XIO(T_NS_Yellow.DN)OTU(Walk_Active);',
        PED_TWALK,
        ...PED_FLASH,
        ...LAMPS,
        PED_DW,
        PED_WALK,
      ],
      why: 'pedestrian phase with OTL/OTU',
    },
  ],
};
