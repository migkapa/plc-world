/**
 * Test-only: plausible WRONG programs for chapter 7 — mostly incomplete or misguided repairs of the broken
 * starter programs (each must verify and fail at least one test) — and alternative CORRECT repairs
 * (`CH7_RIGHT`, must pass). Enforced by src/game/missions.test.ts. Never imported by the app.
 */
import type { WrongAnswerSet } from './authoring';

// --- motor station -------------------------------------------------------------
const SAFE_SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const RUN_LIGHT = 'XIC(Motor_Aux)OTE(Run_Light);';
const READY_LIGHT = 'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);';
const FAULT_LIGHT = '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);';
const LIGHTS = [RUN_LIGHT, READY_LIGHT, FAULT_LIGHT];

const RUN_LATCH = '[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);';
const JOG_MOTOR = '[XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const CONTRACTOR_JOG = 'XIC(Jog_PB)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';

// 7-6
const HAND_RUN = '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);';
const AUTO_ARMED = '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);';
const MOTOR = '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const HORN = 'XIO(OL_OK)OTE(Horn);';
const BROKEN = {
  hand: '[XIC(Start_PB)XIC(EStop_OK),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(OL_OK)OTE(Hand_Run);',
  motor: '[XIC(Hand_Run),XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
  run: 'XIC(Motor_Starter)OTE(Run_Light);',
  ready: 'XIO(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);',
  beep: 'XIC(Start_PB)OTE(Horn);',
};
/** The 7-6 program with some of the five bugs still in place. */
function line3(keep: Partial<Record<keyof typeof BROKEN, true>>): string[] {
  const rungs = [
    keep.hand ? BROKEN.hand : HAND_RUN,
    AUTO_ARMED,
    keep.motor ? BROKEN.motor : MOTOR,
    keep.run ? BROKEN.run : RUN_LIGHT,
    keep.ready ? BROKEN.ready : READY_LIGHT,
    FAULT_LIGHT,
    HORN,
  ];
  if (keep.beep) rungs.push(BROKEN.beep);
  return rungs;
}

// --- conveyor (7-4) ------------------------------------------------------------------
const BELT = '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)XIO(Pallet_Count.DN)OTE(Conveyor_Run);';
const GREEN = 'XIC(Conveyor_Run)OTE(Light_Green);';
const CTU_EXIT = 'XIC(PE_Exit)CTU(Pallet_Count,10,0);';
const AMBER = 'XIC(Pallet_Count.DN)OTE(Light_Amber);';
const NEW_PALLET = 'XIC(Pallet_Count.DN)XIC(Start_PB)RES(Pallet_Count);';
const TOTAL_OS = 'XIC(PE_Exit)ONS(Exit_OS)ADD(Box_Total,1,Box_Total);';
const TOTAL_BAD = 'XIC(PE_Exit)ADD(Box_Total,1,Box_Total);';
const EXTRA_CTU = 'XIC(PE_Divert)CTU(Pallet_Count,10,0);';

// --- tank (7-5) -------------------------------------------------------------------------
const RUN_L = 'XIC(Fill_Valve)OTE(Running_Light);';
const DRAIN = 'XIC(Discharge_PB)OTE(Drain_Valve);';
const FILL_OK = '[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)LES(LT_101,92.0)XIC(LSHH_101)OTE(Fill_Valve);';
const HORN_OK = '[XIO(LSHH_101),XIC(Local:3:I.Ch0Fault),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);';

export const CH7_WRONG: WrongAnswerSet = {
  '7-1': [
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Starter)XIC(Stop_PB)]XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'Stop only in the seal leg: Start beats Stop',
    },
    {
      rungs: ['[XIC(Start_PB)XIC(Stop_PB),XIC(Motor_Starter)]XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'Stop only in the Start leg: Stop cannot break the seal',
    },
    {
      rungs: ['[XIC(Start_PB)XIC(EStop_OK)XIC(OL_OK),XIC(Motor_Starter)]XIC(Stop_PB)OTE(Motor_Starter);', ...LIGHTS],
      why: 'E-stop / overload moved to the Start leg: the seal survives them',
    },
    { rungs: ['XIC(Start_PB)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS], why: 'branch deleted: no seal-in at all' },
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIO(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'XIO on the N.C. stop: never runs',
    },
    {
      rungs: ['XIC(Start_PB)OTL(Motor_Starter);', 'XIO(Stop_PB)OTU(Motor_Starter);', ...LIGHTS],
      why: '"fixed" with a latch that the E-stop and overload never unlatch',
    },
    { rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT], why: 'fault light rung deleted during the repair' },
  ],
  '7-2': [
    { rungs: [SAFE_SEAL, ...LIGHTS], why: 'jog rung deleted: Jog is dead' },
    {
      rungs: ['[XIC(Start_PB),XIC(Jog_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'jog merged into the seal branch: jog seals in',
    },
    { rungs: [CONTRACTOR_JOG, SAFE_SEAL, ...LIGHTS], why: 'rungs swapped: jog now seals in through the start rung' },
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Starter)XIO(Jog_PB),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      why: 'XIO(Jog_PB) in the seal leg: seals as soon as Jog is released',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);', JOG_MOTOR, ...LIGHTS],
      why: 'Run_Latch sealed by the output: jog seals in through it',
    },
    { rungs: [RUN_LATCH, '[XIC(Run_Latch),XIC(Jog_PB)]OTE(Motor_Starter);', ...LIGHTS], why: 'jog bypasses Stop / E-stop / overload' },
    { rungs: [SAFE_SEAL, ...LIGHTS, CONTRACTOR_JOG.replace('OTE', 'OTL')], why: 'jog rung changed to OTL' },
    {
      rungs: ['[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)OTE(Run_Latch);', JOG_MOTOR, ...LIGHTS],
      why: 'Run_Latch without OL_OK: the motor restarts by itself after an overload reset',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(OL_OK)OTE(Run_Latch);', JOG_MOTOR, ...LIGHTS],
      why: 'Run_Latch without EStop_OK: the motor restarts by itself after the E-stop is released',
    },
  ],
  '7-3': [
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,500,0);', 'XIC(Switch_0)XIC(Flash_Timer.DN)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'self-resetting timer, lamp on DN: a one-scan blip every 0.5 s',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,500,0);', 'XIC(Switch_0)XIC(Flash_Timer.TT)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'lamp on .TT: on 0.5 s, off for only two scans',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,500,0);', 'XIC(Switch_0)LES(Flash_Timer.ACC,250)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'flashes at 2 Hz',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);', 'XIC(Switch_0)LES(Flash_Timer.ACC,800)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'wrong duty cycle: 0.8 s on, 0.2 s off',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);', 'LES(Flash_Timer.ACC,500)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'lamp not gated by the alarm: lit steady when there is no alarm',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)RTO(Flash_Timer,1000,0);', 'XIC(Switch_0)LES(Flash_Timer.ACC,500)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'RTO never resets itself: stuck again',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);', 'XIC(Switch_0)LES(Flash_Timer.ACC,500)OTE(Light_4);', 'XIC(Switch_0)XIC(Switch_1)OTE(Buzzer);'],
      why: 'buzzer broken during the repair (silence logic inverted)',
    },
  ],
  '7-4': [
    { rungs: [BELT, GREEN, CTU_EXIT, AMBER, NEW_PALLET, TOTAL_BAD], why: 'extra CTU deleted, but ADD still counts every scan' },
    { rungs: [BELT, GREEN, CTU_EXIT, AMBER, NEW_PALLET, TOTAL_OS, EXTRA_CTU], why: 'one-shot added, but the second CTU still shares the counter' },
    {
      rungs: [BELT, GREEN, CTU_EXIT, AMBER, 'XIC(Start_PB)RES(Pallet_Count);', TOTAL_OS],
      why: 'Start always resets the pallet: a mid-pallet stop loses the count',
    },
    { rungs: [BELT, GREEN, CTU_EXIT, AMBER, NEW_PALLET, 'XIC(PE_Divert)ONS(Exit_OS)ADD(Box_Total,1,Box_Total);'], why: 'Box_Total counted at the pusher eye' },
    { rungs: [BELT, GREEN, EXTRA_CTU, AMBER, NEW_PALLET, TOTAL_OS], why: 'kept the pusher-eye CTU and deleted the exit one' },
    {
      rungs: [BELT, GREEN, 'XIC(PE_Exit)ONS(Exit_OS)CTU(Pallet_Count,10,0);', AMBER, NEW_PALLET, TOTAL_OS],
      why: 'two ONS instructions share one storage bit: the second never fires',
    },
    {
      rungs: [BELT, GREEN, CTU_EXIT, AMBER, 'XIC(Pallet_Count.DN)XIC(Start_PB)[RES(Pallet_Count),CLR(Box_Total)];', TOTAL_OS],
      why: 'shift total reset with every pallet',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);', GREEN, CTU_EXIT, AMBER, NEW_PALLET, TOTAL_OS],
      why: 'belt no longer stops on a full pallet',
    },
    { rungs: [BELT, GREEN, 'XIC(PE_Exit)CTU(Pallet_Count,11,0);', AMBER, NEW_PALLET, TOTAL_OS], why: 'preset 11: off by one' },
  ],
  '7-5': [
    {
      rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)LES(LT_101,92.0)OTE(Fill_Valve);', RUN_L, HORN_OK, DRAIN],
      why: 'no high-high layer in the fill rung',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)XIC(LSHH_101)OTE(Fill_Valve);', RUN_L, HORN_OK, DRAIN],
      why: 'no transmitter layer: a stuck LSH fills to 97 %',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)LES(LT_101,92.0)XIO(LSHH_101)OTE(Fill_Valve);', RUN_L, HORN_OK, DRAIN],
      why: 'N.C. confusion on LSHH-101: the valve never opens',
    },
    {
      rungs: ['[XIC(Start_PB)LES(LT_101,92.0)XIC(LSHH_101),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)OTE(Fill_Valve);', RUN_L, HORN_OK, DRAIN],
      why: 'backup layers only on the Start leg: the seal ignores them',
    },
    {
      rungs: [FILL_OK, RUN_L, '[XIO(LSHH_101),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);', DRAIN],
      why: 'no alarm for the failed transmitter',
    },
    {
      rungs: [FILL_OK, RUN_L, '[XIO(LSHH_101),XIC(Local:3:I.Ch0Fault)]OTE(Alarm_Horn);', DRAIN],
      why: 'no disagreement alarm: the stuck switch stays silent',
    },
    {
      rungs: [FILL_OK, RUN_L, '[XIC(LSHH_101),XIC(Local:3:I.Ch0Fault),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);', DRAIN],
      why: 'N.C. confusion on the horn: sounds when healthy',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)LES(LT_101,0.92)XIC(LSHH_101)OTE(Fill_Valve);', RUN_L, HORN_OK, DRAIN],
      why: 'fraction instead of percent: never opens',
    },
    {
      rungs: [FILL_OK, RUN_L, '[XIO(LSHH_101),XIC(Local:3:I.Ch0Fault),GEQ(LT_101,91.0)XIC(LSH_101)]OTE(Alarm_Horn);', DRAIN],
      why: 'disagreement alarm with the wrong switch polarity',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)LES(LT_101,97.0)XIC(LSHH_101)OTE(Fill_Valve);', RUN_L, HORN_OK, DRAIN],
      why: 'transmitter cutoff at 97 % instead of 92 %',
    },
    {
      rungs: [FILL_OK, RUN_L, '[XIO(LSHH_101),LEQ(LT_101,0.1),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);', DRAIN],
      why: 'failed transmitter detected from a ~0 % reading instead of Ch0Fault: the horn sounds on every empty tank',
    },
    {
      rungs: [FILL_OK, RUN_L, '[XIO(LSHH_101),LEQ(LT_101,0.0),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);', DRAIN],
      why: 'failed transmitter detected from a 0.0 % reading: the horn sounds (and chatters with noise) on an empty tank',
    },
    {
      rungs: [FILL_OK, RUN_L, '[XIO(LSHH_101),LES(LT_101,1.0),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);', DRAIN],
      why: 'failed transmitter detected from a reading below 1 %: the horn sounds on an empty tank',
    },
  ],
  '7-6': [
    { rungs: line3({ ready: true }), why: 'READY still on XIO(EStop_OK)' },
    { rungs: line3({ hand: true }), why: 'Hand_Run seal still survives the E-stop' },
    { rungs: line3({ motor: true }), why: 'Jog still works in OFF and AUTO' },
    { rungs: line3({ beep: true }), why: 'the Friday beep rung still overwrites the overload horn' },
    { rungs: line3({ run: true }), why: 'RUN light still from the command' },
    {
      rungs: [
        '[XIC(Start_PB),XIC(Jog_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        AUTO_ARMED,
        '[XIC(Hand_Run),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        RUN_LIGHT,
        READY_LIGHT,
        FAULT_LIGHT,
        HORN,
      ],
      why: 'jog moved into the Hand_Run seal: jog seals in',
    },
    {
      rungs: [HAND_RUN, AUTO_ARMED, MOTOR, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT],
      why: 'deleted both horn rungs',
    },
    {
      rungs: [HAND_RUN, '[XIC(Start_PB),XIC(Auto_Armed)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);', MOTOR, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT, HORN],
      why: 'Auto_Armed no longer requires AUTO: leaving AUTO does not disarm',
    },
    {
      rungs: [HAND_RUN, '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)OTE(Auto_Armed);', MOTOR, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT, HORN],
      why: 'Auto_Armed without OL_OK: AUTO restarts by itself after an overload reset',
    },
  ],
};

export const CH7_RIGHT: WrongAnswerSet = {
  '7-1': [
    { rungs: ['[XIC(Start_PB),XIC(Motor_Aux)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS], why: 'seal through the auxiliary contact' },
    { rungs: ['XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)[XIC(Start_PB),XIC(Motor_Starter)]OTE(Motor_Starter);', ...LIGHTS], why: 'interlocks before the branch' },
  ],
  '7-2': [
    {
      rungs: ['[XIC(Start_PB),XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)[OTE(Motor_Starter),XIO(Jog_PB)OTE(Run_Latch)];', ...LIGHTS],
      why: 'compact one-rung jog: jog breaks the run seal',
    },
    { rungs: [...LIGHTS, RUN_LATCH, JOG_MOTOR], why: 'light rungs first, two-rung jog after' },
  ],
  '7-3': [
    {
      rungs: [
        'XIC(Switch_0)XIO(Off_Timer.DN)TON(On_Timer,500,0);',
        'XIC(On_Timer.DN)TON(Off_Timer,500,0);',
        'XIC(Switch_0)XIO(On_Timer.DN)OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
      tags: [
        { name: 'On_Timer', dataType: 'TIMER' },
        { name: 'Off_Timer', dataType: 'TIMER' },
      ],
      why: 'classic two-timer flasher',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);', 'XIC(Switch_0)GEQ(Flash_Timer.ACC,500)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'off half first (GEQ)',
    },
    {
      rungs: ['XIC(Switch_0)XIO(Flash_Timer.DN)TOF(Flash_Timer,1000,0);', 'XIC(Switch_0)LES(Flash_Timer.ACC,500)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'unusual but valid: a self-resetting TOF also sweeps ACC 0 → 1000',
    },
    {
      rungs: ['XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);', 'XIC(Switch_0)LES(Flash_Timer.ACC,500)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      why: 'free-running flasher (not gated by the alarm): the first flash may be short',
    },
    {
      rungs: [
        'XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);',
        'LES(Flash_Timer.ACC,500)OTE(Flash_1Hz);',
        'XIC(Switch_0)XIC(Flash_1Hz)OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
      tags: [{ name: 'Flash_1Hz', dataType: 'BOOL' }],
      why: 'one shared free-running 1 Hz flasher bit (plant idiom)',
    },
  ],
  '7-4': [
    {
      rungs: [BELT, GREEN, CTU_EXIT, AMBER, NEW_PALLET, 'XIC(PE_Exit)OSR(Exit_OS,Exit_Pulse);', 'XIC(Exit_Pulse)ADD(Box_Total,1,Box_Total);'],
      tags: [{ name: 'Exit_Pulse', dataType: 'BOOL' }],
      why: 'OSR pulse bit',
    },
    {
      rungs: [BELT, GREEN, CTU_EXIT, AMBER, NEW_PALLET, 'XIC(PE_Exit)XIO(Exit_Last)ADD(Box_Total,1,Box_Total);', 'XIC(PE_Exit)OTE(Exit_Last);'],
      tags: [{ name: 'Exit_Last', dataType: 'BOOL' }],
      why: 'hand-made one-shot with a "last state" bit',
    },
    {
      rungs: [
        BELT,
        GREEN,
        'XIO(PE_Exit)CTU(Pallet_Count,10,0);',
        AMBER,
        NEW_PALLET,
        'XIC(PE_Exit)OSF(Exit_OS,Exit_Gone);',
        'XIC(Exit_Gone)ADD(Box_Total,1,Box_Total);',
      ],
      tags: [{ name: 'Exit_Gone', dataType: 'BOOL' }],
      why: 'counts each box as it clears the exit eye (falling edge: XIO-CTU and OSF)',
    },
  ],
  '7-5': [
    {
      rungs: [
        '[XIC(LSH_101),GEQ(LT_101,92.0),XIO(LSHH_101)]OTE(Tank_Full);',
        '[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(Tank_Full)OTE(Fill_Valve);',
        RUN_L,
        'LIM(91.0,LT_101,150.0)XIO(LSH_101)OTE(Level_Disagree);',
        '[XIO(LSHH_101),XIC(Local:3:I.Ch0Fault),XIC(Level_Disagree)]OTE(Alarm_Horn);',
        DRAIN,
      ],
      tags: [
        { name: 'Tank_Full', dataType: 'BOOL' },
        { name: 'Level_Disagree', dataType: 'BOOL' },
      ],
      why: 'internal "tank full" and "disagree" bits',
    },
  ],
  '7-6': [
    {
      rungs: [
        'XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)[XIC(Start_PB),XIC(Hand_Run)]OTE(Hand_Run);',
        AUTO_ARMED,
        MOTOR,
        'XIC(Motor_Starter)XIC(Motor_Aux)OTE(Run_Light);',
        READY_LIGHT,
        FAULT_LIGHT,
        HORN,
      ],
      why: 'permissives before the branch; RUN = command AND feedback',
    },
  ],
};
