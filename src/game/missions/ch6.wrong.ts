/**
 * Test-only: plausible WRONG programs for chapter 6 (each must verify and fail at least one test) and
 * alternative CORRECT programs (`CH6_RIGHT`, must pass). Enforced by src/game/missions.test.ts.
 * Never imported by the app.
 */
import type { WrongAnswerSet } from './authoring';

// --- 6-1 -------------------------------------------------------------------------
const T_START = 'EQU(Step,0)XIC(Start_PB)MOV(10,Step);';
const T_FILL = 'EQU(Step,10)GEQ(LT_101,87.0)MOV(20,Step);';
const MIX_TON = 'EQU(Step,20)TON(Mix_Timer,5000,0);';
const T_HEAT = 'EQU(Step,20)XIC(Mix_Timer.DN)GEQ(TT_101,62.0)MOV(30,Step);';
const T_DRAIN = 'EQU(Step,30)LES(LT_101,1.0)MOV(40,Step);';
const T_ACK = 'EQU(Step,40)XIC(Discharge_PB)MOV(0,Step);';
const ABORT = '[XIO(Stop_PB),XIO(EStop_OK)]MOV(0,Step);';
const OUTS = [
  'EQU(Step,10)OTE(Fill_Valve);',
  'EQU(Step,20)[OTE(Mixer),OTE(Heater)];',
  'EQU(Step,30)OTE(Drain_Valve);',
  'EQU(Step,40)OTE(Batch_Done_Light);',
  '[EQU(Step,10),EQU(Step,20),EQU(Step,30)]OTE(Running_Light);',
];
const batch = (over: Partial<Record<'start' | 'fill' | 'mix' | 'heat' | 'drain' | 'ack' | 'abort', string>>, outs = OUTS): string[] => [
  over.start ?? T_START,
  over.fill ?? T_FILL,
  over.mix ?? MIX_TON,
  over.heat ?? T_HEAT,
  over.drain ?? T_DRAIN,
  over.ack ?? T_ACK,
  over.abort ?? ABORT,
  ...outs,
];

// --- 6-2 -------------------------------------------------------------------------
const BELT = '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);';
const CLOCK = 'XIC(Conveyor_Run)XIO(Track_Clock.DN)TON(Track_Clock,100,0);';
const SHIFT = 'XIC(Track_Clock.DN)BSL(Track[0],Track_Ctl,PE_Tall,32);';
const PUSH = (bit: string): string =>
  `[XIC(PE_Divert)ONS(Divert_OS)XIC(${bit}),XIC(Pusher_Extend)]XIO(Pusher_Extended)OTE(Pusher_Extend);`;

// --- 6-3 / 6-4 ---------------------------------------------------------------------
const OUT_RUNGS = ['NS_Red', 'NS_Yellow', 'NS_Green', 'EW_Red', 'EW_Yellow', 'EW_Green', 'Walk', 'Dont_Walk'].map(
  (a, i) => `XIC(Lamps.${i})OTE(${a});`,
);
const load = (patterns: string[]): string =>
  `XIC(S:FS)[${patterns.map((p, i) => `MOV(${p},Lamp_Steps[${i}])`).join(',')}];`;
const PATTERNS = ['2#1000_1001', '2#1000_1100', '2#1000_1010', '2#1000_1001', '2#0110_0001', '2#1001_0001', '2#1000_1001'];
const LOAD = load(PATTERNS);
const TIMER = 'XIO(Step_Timer.DN)TON(Step_Timer,2000,0);';
const PRESET = 'MOV(Step_Times[Lamp_Seq.POS],Step_Timer.PRE);';
const SQO = 'XIC(Step_Timer.DN)SQO(Lamp_Steps[0],16#FF,Lamps,Lamp_Seq,6,0);';
const HOME = 'EQU(Lamp_Seq.POS,0)MOV(Lamp_Steps[0],Lamps);';
const DAY = [LOAD, TIMER, PRESET, SQO, HOME, ...OUT_RUNGS];

const NIGHT_ENTRY = 'XIC(Night_Mode)[EQU(Lamp_Seq.POS,3),EQU(Lamp_Seq.POS,6),XIC(Night_Active)]OTE(Night_Active);';
const NIGHT_TIMER = 'XIO(Night_Active)XIO(Step_Timer.DN)TON(Step_Timer,2000,0);';
const NIGHT_RES = 'XIC(Night_Active)RES(Lamp_Seq);';
const FLASH_TIMER = 'XIC(Night_Active)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);';
const FLASH = 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_1010,Lamps),GEQ(Flash_Timer.ACC,500)MOV(0,Lamps)];';
const night = (
  over: Partial<Record<'entry' | 'timer' | 'res' | 'home' | 'flashTimer' | 'flash', string>> = {},
  outs = OUT_RUNGS,
): string[] => [
  over.entry ?? NIGHT_ENTRY,
  over.timer ?? NIGHT_TIMER,
  PRESET,
  SQO,
  over.res ?? NIGHT_RES,
  over.home ?? HOME,
  over.flashTimer ?? FLASH_TIMER,
  over.flash ?? FLASH,
  ...outs,
];

export const CH6_WRONG: WrongAnswerSet = {
  '6-1': [
    { rungs: batch({ start: 'XIC(Start_PB)MOV(10,Step);' }), why: 'Start not limited to step 0: restarts the fill mid-batch' },
    { rungs: [ABORT, ...batch({ abort: 'NOP();' }).filter((r) => r !== 'NOP();')], why: 'abort rung BEFORE the transitions: Start beats Stop' },
    { rungs: batch({ heat: 'EQU(Step,20)GEQ(TT_101,62.0)MOV(30,Step);' }), why: 'no minimum mixing time' },
    { rungs: batch({ mix: 'EQU(Step,20)RTO(Mix_Timer,5000,0);' }), why: 'retentive RTO: the mixing time is not restarted' },
    { rungs: batch({ fill: 'EQU(Step,10)GEQ(LT_101,85.0)MOV(20,Step);' }), why: 'fills only to the QA limit (85 %), no margin' },
    { rungs: batch({ heat: 'EQU(Step,20)XIC(Mix_Timer.DN)GEQ(TT_101,60.0)MOV(30,Step);' }), why: 'heats only to 60 °C, no margin' },
    { rungs: batch({ drain: 'EQU(Step,30)LES(LT_101,5.0)MOV(40,Step);' }), why: 'stops draining at 5 %: not empty' },
    { rungs: batch({ ack: 'EQU(Step,40)MOV(0,Step);' }), why: 'no acknowledge: step 40 falls straight back to idle' },
    { rungs: batch({ ack: 'EQU(Step,40)[XIC(Discharge_PB),XIC(Start_PB)]MOV(0,Step);' }), why: 'Start also acknowledges step 40' },
    { rungs: batch({ abort: 'XIO(Stop_PB)MOV(0,Step);' }), why: 'E-stop does not abort the sequence' },
    {
      rungs: batch({}, [
        'EQU(Step,10)OTL(Fill_Valve);',
        'EQU(Step,20)[OTU(Fill_Valve),OTE(Mixer),OTE(Heater)];',
        ...OUTS.slice(2),
      ]),
      why: 'latched fill valve: an abort leaves it open',
    },
    {
      rungs: batch({}, ['[EQU(Step,10),EQU(Step,20)]OTE(Heater);', 'EQU(Step,10)OTE(Fill_Valve);', 'EQU(Step,20)OTE(Mixer);', ...OUTS.slice(2)]),
      why: 'heater already on while filling: heats dry',
    },
    {
      rungs: batch({}, [OUTS[0]!, OUTS[1]!, OUTS[2]!, OUTS[3]!, '[EQU(Step,10),EQU(Step,20)]OTE(Running_Light);']),
      why: 'Running_Light forgets the drain step',
    },
    { rungs: batch({}, [OUTS[0]!, 'EQU(Step,20)OTE(Mixer);', ...OUTS.slice(2)]), why: 'no heater: never reaches 62 °C' },
    {
      rungs: batch({}, [OUTS[0]!, OUTS[1]!, '[EQU(Step,30),EQU(Step,40)]OTE(Drain_Valve);', OUTS[3]!, OUTS[4]!]),
      why: 'drain valve left open in step 40',
    },
  ],
  '6-2': [
    { rungs: [BELT, 'XIC(PE_Divert)OTE(Pusher_Extend);'], why: 'pushes every box' },
    { rungs: [BELT, 'XIC(PE_Tall)XIC(PE_Divert)OTE(Pusher_Extend);'], why: 'needs both eyes at once — never true' },
    {
      rungs: [BELT, 'XIO(Track_Clock.DN)TON(Track_Clock,100,0);', SHIFT, PUSH('Track[0].22')],
      why: 'clock not gated by the belt: tracking drifts during stops',
    },
    { rungs: [BELT, CLOCK, SHIFT, PUSH('Track[0].10')], why: 'checks the wrong bit (too early)' },
    { rungs: [BELT, CLOCK, SHIFT, PUSH('Track[0].30')], why: 'checks the wrong bit (too late)' },
    {
      rungs: [BELT, CLOCK, SHIFT, 'XIC(PE_Divert)ONS(Divert_OS)XIC(Track[0].22)OTL(Pusher_Extend);'],
      why: 'never retracts: the next box jams',
    },
    { rungs: [BELT, CLOCK, 'XIC(Track_Clock.DN)BSL(Track[0],Track_Ctl,PE_Divert,32);', PUSH('Track[0].22')], why: 'shifts PE_Divert instead of PE_Tall' },
    { rungs: [BELT, 'XIC(Conveyor_Run)XIO(Track_Clock.DN)TON(Track_Clock,1000,0);', SHIFT, PUSH('Track[0].22')], why: 'clock far too slow' },
    { rungs: ['[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)OTE(Conveyor_Run);', CLOCK, SHIFT, PUSH('Track[0].22')], why: 'E-stop not in the logic' },
    { rungs: [BELT, CLOCK, SHIFT, '[XIC(PE_Divert)ONS(Divert_OS)XIC(Track[0].22),XIC(Pusher_Extend)]OTE(Pusher_Extend);'], why: 'pusher seal never breaks' },
    {
      rungs: [BELT, CLOCK, SHIFT, 'XIC(Track[0].20)ONS(Divert_OS)OTL(Pusher_Extend);', 'XIC(Pusher_Extended)OTU(Pusher_Extend);'],
      why: 'fires on the tracking bit alone, far too early',
    },
  ],
  '6-3': [
    {
      rungs: [load(PATTERNS.map((p, i) => (i === 4 ? '2#0110_0100' : p))), TIMER, PRESET, SQO, HOME, ...OUT_RUNGS],
      why: 'EW green pattern also lights NS green: conflict',
    },
    {
      rungs: [load(PATTERNS.map((p, i) => (i === 1 ? '2#0100_1100' : p))), TIMER, PRESET, SQO, HOME, ...OUT_RUNGS],
      why: 'WALK during the main-street green: conflict',
    },
    { rungs: [LOAD, TIMER, PRESET, SQO, ...OUT_RUNGS], why: 'no home step: dark at power-up' },
    { rungs: [LOAD, TIMER, SQO, HOME, ...OUT_RUNGS], why: 'no preset per step: every step lasts 2 s' },
    { rungs: [LOAD, TIMER, PRESET, 'XIC(Step_Timer.DN)SQO(Lamp_Steps[0],16#FF,Lamps,Lamp_Seq,5,0);', HOME, ...OUT_RUNGS], why: 'LEN 5: the last all-red is skipped' },
    { rungs: [LOAD, 'TON(Step_Timer,2000,0);', PRESET, SQO, HOME, ...OUT_RUNGS], why: 'timer never resets: the drum steps once' },
    { rungs: [LOAD, TIMER, PRESET, 'XIC(Step_Timer.DN)SQO(Lamp_Steps[0],16#0F,Lamps,Lamp_Seq,6,0);', HOME, ...OUT_RUNGS], why: 'mask 16#0F hides half of the lamps' },
    {
      rungs: [LOAD, TIMER, PRESET, SQO, HOME, ...OUT_RUNGS.map((r, i) => (i === 0 ? 'XIC(Lamps.2)OTE(NS_Red);' : i === 2 ? 'XIC(Lamps.0)OTE(NS_Green);' : r))],
      why: 'NS red and green bits swapped in the output mapping',
    },
    {
      rungs: [
        load(['2#1000_1001', '2#1000_1100', '2#1000_1010', '2#0110_0001', '2#1001_0001']),
        TIMER,
        'MOV(Step_Times[Lamp_Seq.POS],Step_Timer.PRE);',
        'XIC(Step_Timer.DN)SQO(Lamp_Steps[0],16#FF,Lamps,Lamp_Seq,4,0);',
        HOME,
        ...OUT_RUNGS,
      ],
      why: 'no all-red clearance steps',
    },
    { rungs: [LOAD, TIMER, PRESET, 'XIC(Step_Timer.DN)SQO(Lamp_Steps[1],16#FF,Lamps,Lamp_Seq,6,0);', HOME, ...OUT_RUNGS], why: 'drum array starts one element late' },
  ],
  '6-4': [
    { rungs: night({ entry: 'XIC(Night_Mode)OTE(Night_Active);' }), why: 'flash starts at once: cuts the green short' },
    { rungs: night({ entry: 'XIC(Night_Mode)[EQU(Lamp_Seq.POS,3),EQU(Lamp_Seq.POS,6)]OTE(Night_Active);' }), why: 'night bit does not seal in' },
    { rungs: night({ res: 'NOP();' }).filter((r) => r !== 'NOP();'), why: 'drum not sent home: no all-red on the way back' },
    {
      rungs: night({ flashTimer: 'XIC(Night_Active)XIO(Flash_Timer.DN)TON(Flash_Timer,500,0);', flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,250)MOV(2#0000_1010,Lamps),GEQ(Flash_Timer.ACC,250)MOV(0,Lamps)];' }),
      why: 'flashes at 2 Hz',
    },
    {
      rungs: night({ flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_1010,Lamps),GEQ(Flash_Timer.ACC,500)MOV(2#0000_1000,Lamps)];' }),
      why: 'EW red steady instead of flashing',
    },
    {
      rungs: night({ flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#1000_1010,Lamps),GEQ(Flash_Timer.ACC,500)MOV(2#1000_0000,Lamps)];' }),
      why: "DON'T WALK stays lit during the flash",
    },
    {
      rungs: night({ flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_1001,Lamps),GEQ(Flash_Timer.ACC,500)MOV(0,Lamps)];' }),
      why: 'flashes NS red instead of NS yellow',
    },
    {
      rungs: night({ flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#1000_1010,Lamps),GEQ(Flash_Timer.ACC,500)MOV(0,Lamps)];' }),
      why: "DON'T WALK flashes in phase with the NS yellow (caught by the ON-half dark-lamp check)",
    },
    {
      rungs: night({ flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_1011,Lamps),GEQ(Flash_Timer.ACC,500)MOV(0,Lamps)];' }),
      why: 'NS red and NS yellow lit together on the same head in the ON half',
    },
    {
      rungs: night({ flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#1000_1011,Lamps),GEQ(Flash_Timer.ACC,500)MOV(0,Lamps)];' }),
      why: "NS red and DON'T WALK flash in phase with the NS yellow",
    },
    {
      rungs: night({ flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_0010,Lamps),GEQ(Flash_Timer.ACC,500)MOV(2#0000_1000,Lamps)];' }),
      why: 'wig-wag: EW red flashes in anti-phase instead of together with the NS yellow',
    },
    { rungs: [...DAY.slice(0, 5), FLASH_TIMER.replace('Night_Active', 'Night_Mode'), FLASH.replace('Night_Active', 'Night_Mode'), ...OUT_RUNGS], why: 'flash painted over a running drum' },
    {
      rungs: night({ home: 'NOP();' }).filter((r) => r !== 'NOP();'),
      why: 'no home pattern: dark instead of all red when leaving night',
    },
  ],
};

export const CH6_RIGHT: WrongAnswerSet = {
  '6-1': [
    {
      rungs: batch({ mix: 'XIC(Mixer_Running)TON(Mix_Timer,5000,0);', abort: '[XIO(Stop_PB),XIO(EStop_OK)]CLR(Step);' }),
      why: 'mixing time from the mixer feedback, CLR to abort',
    },
    {
      rungs: batch({}, [
        '[EQU(Step,10)OTE(Fill_Valve),EQU(Step,20)[OTE(Mixer),OTE(Heater)],EQU(Step,30)OTE(Drain_Valve),EQU(Step,40)OTE(Batch_Done_Light)];',
        'LIM(10,Step,30)OTE(Running_Light);',
      ]),
      why: 'all outputs in one branched rung, LIM for the running light',
    },
    {
      rungs: [
        'XIC(Stop_PB)XIC(EStop_OK)OTE(Healthy);',
        'EQU(Step,0)XIC(Start_PB)XIC(Healthy)MOV(10,Step);',
        T_FILL,
        MIX_TON,
        T_HEAT,
        T_DRAIN,
        T_ACK,
        'XIO(Healthy)MOV(0,Step);',
        ...OUTS,
      ],
      tags: [{ name: 'Healthy', dataType: 'BOOL' }],
      why: 'permissive bit computed first',
    },
  ],
  '6-2': [
    {
      rungs: [BELT, CLOCK, SHIFT, 'XIC(Track[0].25)ONS(Divert_OS)OTL(Pusher_Extend);', 'XIC(Pusher_Extended)OTU(Pusher_Extend);'],
      why: 'fire on the tracking bit alone (bit 25), OTL/OTU',
    },
    {
      rungs: [BELT, CLOCK, 'XIC(Track_Clock.DN)BSL(Track[0],Track_Ctl,PE_Tall,64);', PUSH('Track[0].23')],
      why: '64-bit register, bit 23',
    },
    {
      rungs: [BELT, 'XIC(Conveyor_Run)XIO(Track_Clock.DN)TON(Track_Clock,80,0);', SHIFT, PUSH('Track[0].27')],
      why: '100 ms clock (5 cm per pulse), bit 27',
    },
  ],
  '6-3': [
    {
      rungs: [TIMER, PRESET, SQO, HOME, ...OUT_RUNGS],
      tags: [{ name: 'Lamp_Steps', dataType: 'DINT', dims: 7, initial: [137, 140, 138, 137, 97, 145, 137] }],
      why: 'drum filled in the tag editor (initial values) instead of first-scan MOVs',
    },
    {
      rungs: [
        load(['137', '140', '138', '137', '97', '145', '137']),
        TIMER,
        PRESET,
        SQO,
        HOME,
        '[XIC(Lamps.0)OTE(NS_Red),XIC(Lamps.1)OTE(NS_Yellow),XIC(Lamps.2)OTE(NS_Green),XIC(Lamps.3)OTE(EW_Red),XIC(Lamps.4)OTE(EW_Yellow),XIC(Lamps.5)OTE(EW_Green),XIC(Lamps.6)OTE(Walk),XIC(Lamps.7)OTE(Dont_Walk)];',
      ],
      why: 'decimal patterns, one branched output rung',
    },
  ],
  '6-4': [
    {
      rungs: night({
        entry: 'XIC(Night_Mode)[EQU(Lamp_Seq.POS,3)XIC(Step_Timer.DN),EQU(Lamp_Seq.POS,6)XIC(Step_Timer.DN),XIC(Night_Active)]OTE(Night_Active);',
      }),
      why: 'enters night at the END of the all-red step',
    },
    {
      rungs: [
        NIGHT_ENTRY,
        NIGHT_TIMER,
        PRESET,
        SQO,
        NIGHT_RES,
        HOME,
        'XIC(Night_Active)XIO(Flash_Off.DN)TON(Flash_On,500,0);',
        'XIC(Flash_On.DN)TON(Flash_Off,500,0);',
        '[XIO(Night_Active)XIC(Lamps.0)]OTE(NS_Red);',
        '[XIO(Night_Active)XIC(Lamps.1),XIC(Night_Active)XIO(Flash_On.DN)]OTE(NS_Yellow);',
        'XIO(Night_Active)XIC(Lamps.2)OTE(NS_Green);',
        '[XIO(Night_Active)XIC(Lamps.3),XIC(Night_Active)XIO(Flash_On.DN)]OTE(EW_Red);',
        'XIO(Night_Active)XIC(Lamps.4)OTE(EW_Yellow);',
        'XIO(Night_Active)XIC(Lamps.5)OTE(EW_Green);',
        'XIO(Night_Active)XIC(Lamps.6)OTE(Walk);',
        'XIO(Night_Active)XIC(Lamps.7)OTE(Dont_Walk);',
      ],
      tags: [
        { name: 'Flash_On', dataType: 'TIMER' },
        { name: 'Flash_Off', dataType: 'TIMER' },
      ],
      why: 'classic two-timer flasher, night handled in the output rungs',
    },
    { rungs: [LOAD, ...night()], why: 'keeps the first-scan drum loading rung' },
    {
      rungs: night({
        flashTimer: 'XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);',
        flash: 'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_1010,Lamps),GEQ(Flash_Timer.ACC,500)CLR(Lamps)];',
      }),
      why: 'free-running flasher (not gated by Night_Active), CLR for the dark half',
    },
  ],
};
