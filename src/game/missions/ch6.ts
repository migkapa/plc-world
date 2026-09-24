/**
 * Chapter 6 — Sequencing (scenes 'tank-process', 'conveyor-sort', 'traffic-light'): step-number state
 * machines with EQU/MOV, BSL part tracking with a time-based "virtual encoder", an SQO drum sequencer and
 * a night-flash boss.
 * Mission ids '6-1' … '6-4'. See docs/CURRICULUM.md for the authoring guide.
 */
import type { TagDef } from '../../plc/types';
import type { MissionDef, MissionInvariant, TestStep } from '../types';
import { expectObs, expectObsRange, expectTag, press, release, set, tap, wait } from './authoring';

// ---------------------------------------------------------------------------
// 6-1 Step by Step (tank-process)
// ---------------------------------------------------------------------------

const BATCH_SOLUTION = [
  'EQU(Step,0)XIC(Start_PB)MOV(10,Step);',
  'EQU(Step,10)GEQ(LT_101,87.0)MOV(20,Step);',
  'EQU(Step,20)TON(Mix_Timer,5000,0);',
  'EQU(Step,20)XIC(Mix_Timer.DN)GEQ(TT_101,62.0)MOV(30,Step);',
  'EQU(Step,30)LES(LT_101,1.0)MOV(40,Step);',
  'EQU(Step,40)XIC(Discharge_PB)MOV(0,Step);',
  '[XIO(Stop_PB),XIO(EStop_OK)]MOV(0,Step);',
  'EQU(Step,10)OTE(Fill_Valve);',
  'EQU(Step,20)[OTE(Mixer),OTE(Heater)];',
  'EQU(Step,30)OTE(Drain_Valve);',
  'EQU(Step,40)OTE(Batch_Done_Light);',
  '[EQU(Step,10),EQU(Step,20),EQU(Step,30)]OTE(Running_Light);',
];

const BATCH_TAGS: TagDef[] = [
  { name: 'Step', dataType: 'DINT', description: 'Batch sequence step: 0 idle, 10 fill, 20 mix & heat, 30 drain, 40 done' },
  { name: 'Mix_Timer', dataType: 'TIMER', description: 'Minimum mixing time in step 20' },
];

const TANK_SAFETY: MissionInvariant[] = [
  { observe: 'spills', max: 0, message: 'The tank overflowed' },
  { observe: 'dryHeatMs', max: 0, message: 'The heater was ON with its element uncovered' },
  { observe: 'dryRunMs', max: 0, message: 'The agitator ran in an empty tank' },
  {
    when: { tag: 'Fill_Valve', equals: true },
    tag: 'Drain_Valve',
    equals: false,
    message: 'Fill_Valve and Drain_Valve must never be open at the same time',
  },
  {
    when: { control: 'estop', equals: true },
    tag: 'Heater',
    equals: false,
    graceMs: 20,
    message: 'Heater must be OFF while the E-stop is pushed',
  },
  {
    when: { control: 'estop', equals: true },
    tag: 'Fill_Valve',
    equals: false,
    graceMs: 20,
    message: 'Fill_Valve must be closed while the E-stop is pushed',
  },
  {
    when: { control: 'stop', equals: true },
    tag: 'Heater',
    equals: false,
    graceMs: 20,
    message: 'Heater must be OFF while Stop is pressed',
  },
];

// ---------------------------------------------------------------------------
// 6-2 Sort It Out (conveyor-sort)
// ---------------------------------------------------------------------------

const BELT = '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);';

const SORT_TAGS: TagDef[] = [
  { name: 'Track', dataType: 'DINT', dims: 2, description: 'Tracking shift register: bit 0 = at PE_Tall, one bit per clock pulse' },
  { name: 'Track_Ctl', dataType: 'CONTROL', description: 'BSL control' },
  { name: 'Track_Clock', dataType: 'TIMER', description: 'Virtual encoder: one pulse per 6 cm of belt travel' },
  { name: 'Divert_OS', dataType: 'BOOL', description: 'One-shot storage bit' },
];

/** Belt pattern selector positions. */
const RANDOM = 0;
const ALL_SHORT = 1;
const ALL_TALL = 2;
const ALTERNATE = 3;

const startBelt = (pattern: number): TestStep[] => [
  set('box_pattern', pattern),
  wait(200),
  tap('start'),
  expectObs('conveyorRunning', true, 'Start must run the belt', { within: 500 }),
];

// ---------------------------------------------------------------------------
// 6-3 / 6-4 Traffic (traffic-light)
// ---------------------------------------------------------------------------

/** Lamps word bits = output points Pt00..Pt07. */
const LAMP_ALIASES = ['NS_Red', 'NS_Yellow', 'NS_Green', 'EW_Red', 'EW_Yellow', 'EW_Green', 'Walk', 'Dont_Walk'];
const LAMP_OBS = ['nsRed', 'nsYellow', 'nsGreen', 'ewRed', 'ewYellow', 'ewGreen', 'walk', 'dontWalk'];
const LAMP_RUNGS = LAMP_ALIASES.map((a, i) => `XIC(Lamps.${i})OTE(${a});`);
const LAMP_COMMENTS = LAMP_ALIASES.map((a, i) => `Lamps.${i} → ${a}`);

/** Lamp patterns (bit 0 NS_Red … bit 7 Dont_Walk). */
const ALL_RED = 0b1000_1001; // 137
const NS_GREEN = 0b1000_1100; // 140
const NS_YELLOW = 0b1000_1010; // 138
const EW_GREEN = 0b0110_0001; // 97
const EW_YELLOW = 0b1001_0001; // 145
const DRUM = [ALL_RED, NS_GREEN, NS_YELLOW, ALL_RED, EW_GREEN, EW_YELLOW, ALL_RED];
const STEP_TIMES = [2000, 10000, 3000, 1000, 8000, 3000, 1000];

const LOAD_DRUM =
  'XIC(S:FS)[MOV(2#1000_1001,Lamp_Steps[0]),MOV(2#1000_1100,Lamp_Steps[1]),MOV(2#1000_1010,Lamp_Steps[2]),' +
  'MOV(2#1000_1001,Lamp_Steps[3]),MOV(2#0110_0001,Lamp_Steps[4]),MOV(2#1001_0001,Lamp_Steps[5]),MOV(2#1000_1001,Lamp_Steps[6])];';
const STEP_TIMER = 'XIO(Step_Timer.DN)TON(Step_Timer,2000,0);';
const STEP_PRESET = 'MOV(Step_Times[Lamp_Seq.POS],Step_Timer.PRE);';
const DRUM_SQO = 'XIC(Step_Timer.DN)SQO(Lamp_Steps[0],16#FF,Lamps,Lamp_Seq,6,0);';
const DRUM_HOME = 'EQU(Lamp_Seq.POS,0)MOV(Lamp_Steps[0],Lamps);';

const TRAFFIC_TAGS: TagDef[] = [
  { name: 'Lamp_Steps', dataType: 'DINT', dims: 7, description: 'Drum: one lamp pattern per step (bit 0 NS_Red … bit 7 Dont_Walk)' },
  {
    name: 'Step_Times',
    dataType: 'DINT',
    dims: 7,
    initial: STEP_TIMES,
    description: 'Duration of each drum step (ms)',
  },
  { name: 'Lamp_Seq', dataType: 'CONTROL', description: 'SQO control (.POS = current step)' },
  { name: 'Step_Timer', dataType: 'TIMER', description: 'Times the current drum step' },
  { name: 'Lamps', dataType: 'DINT', description: 'Lamp pattern word driven by the SQO' },
];

const NIGHT_TAGS: TagDef[] = [
  { ...TRAFFIC_TAGS[0]!, initial: DRUM },
  ...TRAFFIC_TAGS.slice(1),
  { name: 'Night_Active', dataType: 'BOOL', description: 'Intersection is in night flash' },
  { name: 'Flash_Timer', dataType: 'TIMER', description: '1 Hz flasher' },
];

const NO_CONFLICT: MissionInvariant[] = [
  { observe: 'conflict', equals: false, graceMs: 20, message: 'Conflicting signals (both streets go, or WALK against a main-street go) — crash!' },
  { observe: 'conflicts', max: 0, message: 'The conflict monitor tripped' },
];

/** Every lamp of the intersection at this instant (lamp → on). */
function lampsAre(pattern: number, label: string): TestStep[] {
  return LAMP_OBS.map((id, i) => {
    const on = (pattern & (1 << i)) !== 0;
    return expectObs(id, on, `${label}: ${LAMP_ALIASES[i]} must be ${on ? 'ON' : 'OFF'}`);
  });
}

/**
 * One drum phase: `key` lamp comes on within 500 ms, the whole pattern is right, and the phase lasts
 * `ms` (it holds for ms − 300, then the key lamp goes off within 500 ms).
 */
function phase(key: string, pattern: number, ms: number, label: string, within = 500): TestStep[] {
  return [
    expectObs(key, true, `${label} must come next`, { within }),
    wait(100),
    ...lampsAre(pattern, label),
    expectObs(key, true, `${label} must last ${ms / 1000} s`, { for: ms - 400 }),
    ...lampsAre(pattern, `${label} (end of the phase)`),
    expectObs(key, false, `${label} must end after ${ms / 1000} s`, { within: 500 }),
  ];
}

/**
 * NS yellow + EW red flash together at ~1 Hz (on and off ≈ 0.5 s each), everything else dark — checked in
 * the ON half (just after the NS yellow lights) and again in the OFF half.
 */
const flashing = (label: string, firstWithin = 1200): TestStep[] => [
  expectObs('nsYellow', false, `${label}: NS yellow must flash (off)`, { within: firstWithin }),
  expectObs('nsYellow', true, `${label}: NS yellow must flash (on)`, { within: firstWithin }),
  wait(50),
  expectObs('ewRed', true, `${label}: EW red must flash together with the NS yellow (both ON in the same half)`),
  expectObs('nsRed', false, `${label}: NS red must stay dark while the NS yellow is lit (one lamp per head)`),
  expectObs('nsGreen', false, `${label}: NS green must stay dark in the flash`),
  expectObs('ewGreen', false, `${label}: EW green must stay dark in the flash`),
  expectObs('ewYellow', false, `${label}: EW yellow must stay dark in the flash`),
  expectObs('walk', false, `${label}: the pedestrian heads must stay dark in the flash (WALK)`),
  expectObs('dontWalk', false, `${label}: the pedestrian heads must stay dark in the flash (DON'T WALK)`),
  expectObs('nsYellow', true, `${label}: NS yellow ON for about 0.5 s`, { for: 330 }),
  expectObs('nsYellow', false, `${label}: NS yellow must flash (off) — about 0.5 s on, 0.5 s off`, { within: 250 }),
  expectObs('nsYellow', false, `${label}: NS yellow OFF for about 0.5 s`, { for: 380 }),
  expectObs('nsYellow', true, `${label}: NS yellow must keep flashing`, { within: 250 }),
  expectObs('ewRed', false, `${label}: EW red must flash (off)`, { within: 1100 }),
  expectObs('ewRed', false, `${label}: EW red OFF for about 0.5 s`, { for: 380 }),
  expectObs('ewRed', true, `${label}: EW red must flash (on) — about 0.5 s on, 0.5 s off`, { within: 250 }),
  expectObs('ewRed', true, `${label}: EW red ON for about 0.5 s`, { for: 380 }),
  expectObs('nsGreen', false, `${label}: NS green must be dark`, { for: 200 }),
  expectObs('nsRed', false, `${label}: NS red must be dark (NS shows flashing yellow)`),
  expectObs('ewGreen', false, `${label}: EW green must be dark`),
  expectObs('ewYellow', false, `${label}: EW yellow must be dark`),
  expectObs('walk', false, `${label}: the pedestrian heads must be dark (WALK)`),
  expectObs('dontWalk', false, `${label}: the pedestrian heads must be dark (DON'T WALK)`),
];

export const CH6_MISSIONS: MissionDef[] = [
  // -------------------------------------------------------------------------
  {
    id: '6-1',
    chapter: 'sequencing',
    order: 1,
    title: 'Step by Step',
    tagline: 'A batch recipe as a state machine: one step number rules them all.',
    kind: 'build',
    sceneId: 'tank-process',
    difficulty: 4,
    xp: 200,
    briefing: `Riverside just won a contract for a **pasteurized syrup**, made in batches in tank T-101. The recipe is a
sequence of steps, and Dana has one rule for sequences: *"One DINT holds the step number. Every step has an
EQU. Every transition is a MOV. Outputs are driven from the step — never latched."*

**The hardware** (tank T-101)
- \`Start_PB\` (**N.O.**), \`Stop_PB\` (**N.C.**: 1 when not pressed), \`EStop_OK\` (**N.C.**: 1 = released), \`Discharge_PB\` (**N.O.**).
- \`LT_101\` level (REAL %), \`TT_101\` temperature (REAL °C).
- Outputs \`Fill_Valve\`, \`Mixer\`, \`Heater\`, \`Drain_Valve\`, \`Batch_Done_Light\` (green), \`Running_Light\` (amber).
- Tags \`Step\` (DINT) and \`Mix_Timer\` (TIMER) are created for you.

**The recipe** — the QA limits are 85 % fill and 60 °C; the setpoints leave margin for instrument accuracy.

- **Step 0 — IDLE:** no outputs. **Start** → step 10.
- **Step 10 — FILL:** \`Fill_Valve\` open. \`LT_101\` ≥ **87 %** → step 20.
- **Step 20 — MIX & HEAT:** \`Mixer\` and \`Heater\` on. Mixed at least **5 s** in this step **and** \`TT_101\` ≥ **62 °C** → step 30.
- **Step 30 — DRAIN:** \`Drain_Valve\` open. \`LT_101\` < **1 %** (empty) → step 40.
- **Step 40 — DONE:** \`Batch_Done_Light\` on. **Discharge_PB** (the operator acknowledges) → step 0.

**Rules**
- \`Running_Light\` is on in steps 10, 20 and 30.
- **Start** only works in step 0. **Stop** or the **E-stop** abort the batch at once: back to step 0, everything off.
- \`Mix_Timer\` restarts every time step 20 is entered.`,
    objectives: [
      'Step 0 → 10 on Start (only from idle)',
      '10 FILL → 20 at 87 %',
      '20 MIX & HEAT → 30 after ≥ 5 s of mixing and 62 °C',
      '30 DRAIN → 40 when empty; 40 DONE → 0 on Discharge',
      'Stop / E-stop abort to step 0',
      'One complete batch is counted by the plant',
    ],
    concepts: ['EQU', 'MOV', 'TON', 'GEQ', 'LES'],
    starter: {
      rungs: ['EQU(Step,0)XIC(Start_PB)MOV(10,Step);', '', '', '', '', '', '', 'EQU(Step,10)OTE(Fill_Valve);', '', '', '', ''],
      comments: [
        'Step 0 IDLE → 10 on Start',
        'Step 10 FILL → 20 at 87 %',
        'Step 20: minimum mixing time',
        'Step 20 MIX & HEAT → 30 when mixed ≥ 5 s and 62 °C',
        'Step 30 DRAIN → 40 when empty',
        'Step 40 DONE → 0 on Discharge',
        'Stop / E-stop: abort to step 0 (keep this rung AFTER the transitions)',
        'Outputs of step 10',
        'Outputs of step 20',
        'Outputs of step 30',
        'Outputs of step 40',
        'RUNNING light: steps 10, 20, 30',
      ],
      tags: BATCH_TAGS,
    },
    solution: { rungs: BATCH_SOLUTION },
    hints: [
      'Two kinds of rungs: **transitions** (`EQU(Step,n)` + condition → `MOV(next,Step)`) and **outputs** (`EQU(Step,n)` → `OTE`). One output rung per output — an output that is ON in several steps gets parallel EQU branches.',
      'The mixing time is a TON that runs only while `EQU(Step,20)` is true — leaving the step resets it. The abort rung `[XIO(Stop_PB),XIO(EStop_OK)]MOV(0,Step)` goes **after** the transitions so Stop wins.',
      '`EQU(Step,10)GEQ(LT_101,87.0)MOV(20,Step);` `EQU(Step,20)TON(Mix_Timer,5000,0);` `EQU(Step,20)XIC(Mix_Timer.DN)GEQ(TT_101,62.0)MOV(30,Step);` `EQU(Step,30)LES(LT_101,1.0)MOV(40,Step);` `EQU(Step,40)XIC(Discharge_PB)MOV(0,Step);` `[XIO(Stop_PB),XIO(EStop_OK)]MOV(0,Step);` then `EQU(Step,20)[OTE(Mixer),OTE(Heater)];` etc.',
    ],
    tests: [
      {
        name: 'Idle at power-up',
        steps: [
          wait(300),
          expectTag('Step', 0, 'The sequence must wait in step 0 (IDLE) until Start', { for: 1000 }),
          expectObs('fillValve', false, 'IDLE: Fill_Valve must be closed'),
          expectObs('drainValve', false, 'IDLE: Drain_Valve must be closed'),
          expectObs('heaterOn', false, 'IDLE: the heater must be off'),
          expectObs('mixerRunning', false, 'IDLE: the mixer must be off'),
          expectObs('runningLight', false, 'IDLE: Running_Light must be off'),
          expectObs('batchDoneLight', false, 'IDLE: Batch_Done_Light must be off'),
        ],
      },
      {
        name: 'One complete batch',
        description: 'Fill, mix & heat, drain, done, acknowledge — about two minutes of plant time.',
        steps: [
          wait(200),
          tap('start'),
          expectTag('Step', 10, 'Start must move the sequence to step 10 (FILL)', { within: 50 }),
          expectObs('fillValve', true, 'Step 10 must open Fill_Valve', { within: 100 }),
          expectObs('runningLight', true, 'Running_Light must be on while a batch runs', { within: 100 }),
          expectObs('heaterOn', false, 'No heating while filling'),
          expectTag('Step', 20, 'At 87 % the sequence must move to step 20 (MIX & HEAT)', { within: 25000 }),
          expectObsRange('level', { min: 86.5, max: 87.6 }, 'Filling must stop at 87 %'),
          expectObs('fillValve', false, 'Step 20: Fill_Valve must be closed', { within: 100, for: 300 }),
          expectObs('mixerRunning', true, 'Step 20 must run the mixer', { within: 500 }),
          expectObs('heaterOn', true, 'Step 20 must heat', { within: 100 }),
          expectObs('runningLight', true, 'Running_Light must stay on in step 20'),
          tap('start'),
          expectTag('Step', 20, 'Start must be ignored while a batch is running', { for: 1000 }),
          expectTag('Step', 30, 'At 62 °C (after at least 5 s of mixing) the sequence must move to step 30 (DRAIN)', { within: 110000 }),
          expectObsRange('temperature', { min: 61.8, max: 63.5 }, 'The batch must be heated to 62 °C before draining'),
          expectObs('heaterOn', false, 'Step 30: the heater must be off', { within: 100 }),
          expectObs('mixerRunning', false, 'Step 30: the mixer must be off', { within: 300 }),
          expectObs('drainValve', true, 'Step 30 must open Drain_Valve', { within: 100 }),
          expectObs('runningLight', true, 'Running_Light must stay on while draining (step 30)', { within: 100 }),
          expectTag('Step', 40, 'When the tank is empty (< 1 %) the sequence must move to step 40 (DONE)', { within: 25000 }),
          expectObs('drainValve', false, 'Step 40: Drain_Valve must be closed', { within: 100 }),
          expectObsRange('level', { max: 1.2 }, 'The tank must be drained empty'),
          expectObs('batches', 1, 'The plant must count one good batch (filled ≥ 85 %, ≥ 60 °C, mixed ≥ 5 s, drained)', { within: 100 }),
          expectObs('batchDoneLight', true, 'Step 40 must light Batch_Done_Light until the operator acknowledges', { within: 100, for: 2000 }),
          expectObs('runningLight', false, 'Running_Light must be off when the batch is done'),
          tap('start'),
          expectTag('Step', 40, 'In step 40 Start must be ignored — the operator acknowledges with Discharge', { for: 500 }),
          tap('discharge'),
          expectTag('Step', 0, 'Discharge_PB must acknowledge the batch: back to step 0', { within: 50 }),
          expectObs('batchDoneLight', false, 'Batch_Done_Light must go off after the acknowledge', { within: 100, for: 500 }),
          tap('start'),
          expectTag('Step', 10, 'Start must begin the next batch', { within: 50 }),
          expectObs('fillValve', true, 'The next batch must start filling', { within: 100 }),
        ],
      },
      {
        name: 'Stop and E-stop abort the batch',
        steps: [
          wait(200),
          press('stop'),
          tap('start'),
          expectTag('Step', 0, 'With Stop held, Start must not start a batch', { for: 300 }),
          release('stop'),
          expectTag('Step', 0, 'Releasing Stop must not start a batch', { for: 500 }),
          tap('start'),
          expectTag('Step', 10, 'Start must begin a batch', { within: 50 }),
          wait(2000),
          tap('stop'),
          expectTag('Step', 0, 'Stop must abort to step 0', { within: 50 }),
          expectObs('fillValve', false, 'After Stop, Fill_Valve must be closed', { within: 100, for: 1500 }),
          expectObs('runningLight', false, 'After Stop, Running_Light must be off'),
          tap('start'),
          expectTag('Step', 10, 'Start must begin a new batch after an abort', { within: 50 }),
          wait(1000),
          set('estop', true),
          expectTag('Step', 0, 'The E-stop must abort to step 0', { within: 50 }),
          expectObs('fillValve', false, 'The E-stop must close Fill_Valve', { within: 100 }),
          wait(500),
          set('estop', false),
          expectTag('Step', 0, 'Releasing the E-stop must NOT restart the batch', { for: 1500 }),
        ],
      },
      {
        name: 'Mixing time is respected',
        description: 'Stop the batch when it is almost hot, restart it: step 20 must still mix for 5 s.',
        steps: [
          wait(200),
          tap('start'),
          expectTag('Step', 20, 'The sequence must reach step 20', { within: 25000 }),
          expectObsRange('temperature', { min: 61 }, 'The batch should heat up in step 20', { within: 100000 }),
          tap('stop'),
          expectTag('Step', 0, 'Stop must abort to step 0', { within: 50 }),
          expectObs('heaterOn', false, 'Stop must switch the heater off', { within: 100 }),
          wait(500),
          tap('start'),
          expectTag('Step', 20, 'The tank is still full: the sequence must pass step 10 and reach step 20 quickly', { within: 400 }),
          expectTag('Step', 20, 'Step 20 must mix for at least 5 s every time it is entered — even when the batch is already hot (Mix_Timer)', {
            for: 4500,
          }),
          expectTag('Step', 30, 'After the mixing time the hot batch must move on to step 30', { within: 5000 }),
        ],
      },
    ],
    invariants: TANK_SAFETY,
    parInstructions: 36,
    requiredInstructions: ['EQU', 'MOV'],
    debrief: `That's a **state machine** — the way most real machines are programmed. Every rung asks *"which step
am I in?"* (EQU) and *"may I move on?"*; exactly one step is active at any moment, and outputs follow the step.

Why steps of **10**? So you can insert step 15 ("wait for the inlet valve's limit switch") next year without
renumbering everything. And because the step is a plain DINT, an HMI can show it, and a tech can see at a
glance where a stuck machine is waiting.

**Field tip:** in Studio 5000 you'd also add a **step timer** that alarms when a step takes too long (a fill
that never reaches 87 % means a closed hand valve or an empty supply tank). Large sequences are often
written in **SFC** (Sequential Function Chart) — the same idea, drawn as boxes and transitions.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '6-2',
    chapter: 'sequencing',
    order: 2,
    title: 'Sort It Out',
    tagline: 'Track every box with a bit shift register and kick out the tall ones.',
    kind: 'build',
    sceneId: 'conveyor-sort',
    difficulty: 4,
    xp: 220,
    briefing: `Shipping is furious: **tall boxes** keep ending up in the good lane and short ones in the reject chute.
Last week's program remembers "a tall box went by" in **one bit** — but the photo-eyes are 1.5 m apart and the
boxes only ~1.2 m apart, so there are often **two boxes** between the eyes, and one bit can't tell them apart.

**The hardware** (belt 0.5 m/s, box length 0.30 m)
- \`Start_PB\` (**N.O.**), \`Stop_PB\` (**N.C.**), \`EStop_OK\` (**N.C.**, also hardwired in the belt starter).
- \`PE_Tall\` → \`Local:1:I.Data.3\` at **2.5 m** — high photo-eye, 1 while a **tall** box is in front of it.
- \`PE_Divert\` → \`Local:1:I.Data.4\` at **4.0 m** — photo-eye in front of the pusher, 1 while **any** box is there.
- \`Pusher_Extend\` → \`Local:2:O.Data.1\` — 5/2 spring-return valve (extends in 250 ms, retracts in 300 ms).
- \`Pusher_Extended\` → \`Local:1:I.Data.5\` — reed switch, 1 when fully extended.
- \`Conveyor_Run\` → \`Local:2:O.Data.0\` — belt motor starter.

**The idea — a bit shift register (BSL)**
Make a **virtual encoder**: while the belt runs, a self-resetting \`Track_Clock\` (TON, PRE 100 ms) pulses every
**120 ms** (PRE + 2 scans) = every **6 cm** of belt travel. On each pulse, **BSL** shifts \`Track[0]\` one bit
up and loads \`PE_Tall\` into bit 0. The bits now *ride along with the boxes*: bit *n* is what \`PE_Tall\` saw
*n* × 6 cm upstream. A tall box writes about five 1-bits; when its front edge reaches \`PE_Divert\` it has travelled
1.5 m = **25 pulses**, so its bits sit at about **20…24** — bit **22** is right in the middle. (Always test the middle
of the window, never its edge: every stop and restart of the belt can shift the tracking by a pulse.)

**Your task**
- Start / Stop / E-stop run the belt (\`Conveyor_Run\`, seal-in). The tracking clock runs **only while the belt runs**.
- When a box arrives at \`PE_Divert\` and the tracking says it is tall: extend the pusher, and retract it as soon as \`Pusher_Extended\` is made. Short boxes pass.
- **Zero missorted boxes, zero jams** — for three minutes of random boxes, with stops in between.

Tags \`Track\` (DINT[2]), \`Track_Ctl\` (CONTROL), \`Track_Clock\` (TIMER) and \`Divert_OS\` (BOOL) are created for you.`,
    objectives: [
      'Start / Stop / E-stop run the belt',
      'Tracking clock only while the belt runs',
      'BSL tracks PE_Tall down the belt',
      'Tall boxes are pushed off at PE_Divert, short boxes pass',
      'Pusher retracts on Pusher_Extended — no jams',
      'Zero missorts over 3 minutes and through stops',
    ],
    concepts: ['BSL', 'TON', 'ONS', 'XIC', 'OTE'],
    starter: {
      rungs: [
        BELT,
        'XIC(PE_Tall)OTL(Tall_Seen);',
        '[XIC(PE_Divert)XIC(Tall_Seen),XIC(Pusher_Extend)]XIO(Pusher_Extended)OTE(Pusher_Extend);',
        'XIC(Pusher_Extended)OTU(Tall_Seen);',
      ],
      comments: [
        'Belt start/stop',
        'Remember a tall box (ONE bit — fails when two boxes are between the eyes!)',
        'Fire the pusher when the remembered box reaches the pusher',
        'Forget it once pushed',
      ],
      tags: [...SORT_TAGS, { name: 'Tall_Seen', dataType: 'BOOL', description: 'Last week\'s one-bit memory' }],
    },
    solution: {
      rungs: [
        BELT,
        'XIC(Conveyor_Run)XIO(Track_Clock.DN)TON(Track_Clock,100,0);',
        'XIC(Track_Clock.DN)BSL(Track[0],Track_Ctl,PE_Tall,32);',
        '[XIC(PE_Divert)ONS(Divert_OS)XIC(Track[0].22),XIC(Pusher_Extend)]XIO(Pusher_Extended)OTE(Pusher_Extend);',
      ],
      tags: SORT_TAGS,
    },
    hints: [
      'Replace the one-bit memory with a **shift register**: a clock that pulses per distance travelled, and a BSL that loads `PE_Tall` on every pulse. Gate the clock with `Conveyor_Run`, otherwise the bits keep moving while the boxes stand still.',
      'Clock: `XIC(Conveyor_Run)XIO(Track_Clock.DN)TON(Track_Clock,100,0);` Shift: `XIC(Track_Clock.DN)BSL(Track[0],Track_Ctl,PE_Tall,32);` Pusher: a seal-in that starts on the **rising edge** of `PE_Divert` (ONS) only if `Track[0].22` is 1, and breaks on `Pusher_Extended`.',
      '`[XIC(PE_Divert)ONS(Divert_OS)XIC(Track[0].22),XIC(Pusher_Extend)]XIO(Pusher_Extended)OTE(Pusher_Extend);` — plus the clock and BSL rungs above, and delete the Tall_Seen rungs.',
    ],
    tests: [
      {
        name: 'Belt start, stop and E-stop',
        steps: [
          ...startBelt(ALL_SHORT),
          expectObs('conveyorRunning', true, 'The belt must keep running after Start is released', { for: 2000 }),
          tap('stop'),
          expectObs('conveyorRunning', false, 'Stop must stop the belt', { within: 500 }),
          expectObs('conveyorRunning', false, 'The belt must stay stopped', { for: 1000 }),
          tap('start'),
          expectObs('conveyorRunning', true, 'Start must restart the belt', { within: 500 }),
          set('estop', true),
          expectTag('Conveyor_Run', false, 'The E-stop must drop Conveyor_Run in the logic too', { within: 30 }),
          wait(500),
          set('estop', false),
          expectObs('conveyorRunning', false, 'The belt must not restart by itself after the E-stop', { for: 1500 }),
          tap('start'),
          expectObs('conveyorRunning', true, 'Start must work after the E-stop', { within: 500 }),
        ],
      },
      {
        name: 'Short boxes pass straight through',
        steps: [
          ...startBelt(ALL_SHORT),
          expectObsRange('pusherPosition', { max: 0.01 }, 'The pusher must never fire for a short box', { for: 40000 }),
          expectObsRange('boxesGood', { min: 10 }, 'Short boxes must reach the good lane'),
        ],
      },
      {
        name: 'Tall boxes are rejected',
        steps: [
          ...startBelt(ALL_TALL),
          wait(40000),
          expectObsRange('boxesRejected', { min: 10 }, 'Every tall box must be pushed into the reject chute'),
          expectObs('boxesGood', 0, 'No tall box may reach the good lane'),
        ],
      },
      {
        name: 'Alternating boxes',
        steps: [
          ...startBelt(ALTERNATE),
          wait(60000),
          expectObsRange('boxesRejected', { min: 9 }, 'Tall boxes must be rejected'),
          expectObsRange('boxesGood', { min: 9 }, 'Short boxes must reach the good lane'),
        ],
      },
      {
        name: 'Three minutes of random boxes',
        description: '~35 % tall boxes in random order, often two boxes between the eyes.',
        steps: [
          ...startBelt(RANDOM),
          wait(180000),
          expectObsRange('boxesRejected', { min: 25 }, 'Tall boxes must be rejected'),
          expectObsRange('boxesGood', { min: 25 }, 'Short boxes must reach the good lane'),
        ],
      },
      {
        name: 'Tracking survives stops',
        description: 'Tall boxes only; the belt is stopped (Stop and E-stop) with boxes between the eyes.',
        steps: [
          ...startBelt(ALL_TALL),
          wait(9000),
          tap('stop'),
          wait(3000),
          tap('start'),
          wait(7000),
          set('estop', true),
          wait(2500),
          set('estop', false),
          wait(300),
          tap('start'),
          wait(6000),
          tap('stop'),
          wait(1500),
          tap('start'),
          wait(15000),
          expectObsRange('boxesRejected', { min: 10 }, 'Tall boxes must be rejected before and after the stops'),
        ],
      },
    ],
    invariants: [
      { observe: 'missorted', max: 0, message: 'A box ended up in the wrong lane (missorted)' },
      { observe: 'jams', max: 0, message: 'The pusher jammed a box against the guide — retract it in time, fire it only for the box in front of it' },
      {
        when: { control: 'estop', equals: true },
        tag: 'Conveyor_Run',
        equals: false,
        graceMs: 20,
        message: 'Conveyor_Run must be OFF while the E-stop is pushed',
      },
      {
        when: { control: 'stop', equals: true },
        tag: 'Conveyor_Run',
        equals: false,
        graceMs: 20,
        message: 'Conveyor_Run must be OFF while Stop is pressed',
      },
    ],
    parInstructions: 18,
    debrief: `Every box now carries its own "tall" flag down the belt — that's **part tracking**, and the BSL shift
register is its classic tool. Because the clock only ticks while the belt moves, the bits and the boxes stay
in step through every stop.

The rising-edge one-shot on \`PE_Divert\` makes the pusher fire once per box, and breaking the seal on
\`Pusher_Extended\` pulls the paddle back long before the next box arrives.

**Field tip:** real tracking uses a shaft **encoder** on the belt (or a high-speed counter), not a timer,
so slips and speed changes don't matter. Big plants track whole records (barcode, weight, destination) with
**FFL/FFU** FIFOs or UDT arrays indexed by encoder position — the same idea as your bits, with more data per box.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '6-3',
    chapter: 'sequencing',
    order: 3,
    title: 'Sequencer Traffic',
    tagline: 'Put the whole signal cycle on an SQO drum.',
    kind: 'build',
    sceneId: 'traffic-light',
    difficulty: 4,
    xp: 200,
    briefing: `The city's traffic department maintains dozens of intersections and wants every signal program to look
the same: **one table of lamp patterns, one table of times, one sequencer.** Changing a timing then means
editing a number, not rewiring rungs. The tool is the **SQO** (*Sequencer Output*) — a software drum
sequencer.

**The hardware** (CompactLogix 5380, outputs on a 5069-OB16)
\`NS_Red\`, \`NS_Yellow\`, \`NS_Green\`, \`EW_Red\`, \`EW_Yellow\`, \`EW_Green\`, \`Walk\`, \`Dont_Walk\` — the lamps.
Dana has already mapped the bits of the DINT \`Lamps\` to them (**bit 0** = \`NS_Red\` … **bit 7** = \`Dont_Walk\`).

**The drum** (\`Lamp_Steps[0..6]\` — you fill it; \`Step_Times\` is already filled in)
- **Step 0 — ALL RED** (home, at power-up): NS red, EW red, Don't walk — 2 s
- **Step 1 — NS GREEN:** NS green, EW red, Don't walk — 10 s
- **Step 2 — NS YELLOW:** NS yellow, EW red, Don't walk — 3 s
- **Step 3 — ALL RED:** NS red, EW red, Don't walk — 1 s
- **Step 4 — EW GREEN:** NS red, EW green, **Walk** — 8 s
- **Step 5 — EW YELLOW:** NS red, EW yellow, Don't walk — 3 s
- **Step 6 — ALL RED:** NS red, EW red, Don't walk — 1 s

That's the timing sheet of your **Traffic Cycle** (mission 3-6) plus a 2 s all-red home step at power-up. After step 6 the drum wraps back to step 1. Pedestrians now cross the main street together with every side-street green ("pedestrian recall").

**Your task**
- Fill \`Lamp_Steps\` (e.g. with MOVs on the first scan, \`XIC(S:FS)\`). Binary literals help: \`2#1000_1001\` = ALL RED.
- Step the drum with \`SQO(Lamp_Steps[0],16#FF,Lamps,Lamp_Seq,6,0)\`, clocked by a self-resetting \`Step_Timer\` whose preset comes from \`Step_Times[Lamp_Seq.POS]\`.
- At power-up the drum is at home (position 0): show \`Lamp_Steps[0]\` (all red) for 2 s, then start at NS green.
- **No conflicting signals, ever.**`,
    objectives: [
      'Lamp_Steps holds the seven lamp patterns',
      'SQO steps Lamps through the drum',
      'Each step lasts Step_Times[POS]',
      'All red at power-up, then NS green',
      'Walk only with the side-street green; no conflicts',
    ],
    concepts: ['SQO', 'MOV', 'TON', 'EQU'],
    starter: {
      rungs: ['', '', '', '', '', ...LAMP_RUNGS],
      comments: [
        'Load the drum on the first scan (Lamp_Steps)',
        'Step timer (self-resetting)',
        'Preset of the current step from Step_Times',
        'The drum: SQO',
        'Home position (0): show Lamp_Steps[0]',
        ...LAMP_COMMENTS,
      ],
      tags: TRAFFIC_TAGS,
    },
    solution: { rungs: [LOAD_DRUM, STEP_TIMER, STEP_PRESET, DRUM_SQO, DRUM_HOME, ...LAMP_RUNGS] },
    hints: [
      'Write each pattern as 8 bits, bit 7 on the left: `Dont_Walk Walk EW_Green EW_Yellow EW_Red NS_Green NS_Yellow NS_Red`. ALL RED is `2#1000_1001`.',
      'SQO only writes `Lamps` when it steps (rising edge of its rung) — so clock it with `Step_Timer.DN`, and give the timer the preset of the current step with `MOV(Step_Times[Lamp_Seq.POS],Step_Timer.PRE)`. At home (POS = 0) nothing has been written yet: `EQU(Lamp_Seq.POS,0)MOV(Lamp_Steps[0],Lamps)`.',
      'Patterns 0…6: `2#1000_1001`, `2#1000_1100`, `2#1000_1010`, `2#1000_1001`, `2#0110_0001`, `2#1001_0001`, `2#1000_1001` (load them with `XIC(S:FS)[MOV(…,Lamp_Steps[0]),…]`). Then `XIO(Step_Timer.DN)TON(Step_Timer,2000,0);` `MOV(Step_Times[Lamp_Seq.POS],Step_Timer.PRE);` `XIC(Step_Timer.DN)SQO(Lamp_Steps[0],16#FF,Lamps,Lamp_Seq,6,0);` `EQU(Lamp_Seq.POS,0)MOV(Lamp_Steps[0],Lamps);`',
    ],
    tests: [
      {
        name: 'Power-up: all red, then NS green',
        steps: [
          wait(300),
          ...lampsAre(ALL_RED, 'Power-up (home step: ALL RED)'),
          expectObs('nsRed', true, 'The home step (ALL RED) must last about 2 s', { for: 1300 }),
          ...lampsAre(ALL_RED, 'Home step (ALL RED)'),
          expectObs('nsGreen', true, 'After the home step the drum must start with NS green', { within: 600 }),
        ],
      },
      {
        name: 'The full cycle, twice',
        description: 'Checks every lamp and the duration of every step for two full cycles.',
        steps: [
          wait(100),
          ...[1, 2].flatMap((n): TestStep[] => [
            ...phase('nsGreen', NS_GREEN, 10000, `Cycle ${n}: NS GREEN`, n === 1 ? 2500 : 500),
            ...phase('nsYellow', NS_YELLOW, 3000, `Cycle ${n}: NS YELLOW`),
            expectObs('ewRed', true, `Cycle ${n}: ALL RED after NS yellow`, { within: 100 }),
            expectObs('nsRed', true, `Cycle ${n}: ALL RED after NS yellow`, { within: 100 }),
            ...lampsAre(ALL_RED, `Cycle ${n}: ALL RED after NS yellow`),
            expectObs('nsRed', true, `Cycle ${n}: the all-red clearance must last about 1 s`, { for: 600 }),
            ...phase('ewGreen', EW_GREEN, 8000, `Cycle ${n}: EW GREEN with WALK`),
            ...phase('ewYellow', EW_YELLOW, 3000, `Cycle ${n}: EW YELLOW`),
            expectObs('ewRed', true, `Cycle ${n}: ALL RED after EW yellow`, { within: 100 }),
            ...lampsAre(ALL_RED, `Cycle ${n}: ALL RED after EW yellow`),
            expectObs('ewRed', true, `Cycle ${n}: the all-red clearance must last about 1 s`, { for: 600 }),
          ]),
          expectObs('nsGreen', true, 'After step 6 the drum must wrap back to NS green (step 1)', { within: 600 }),
        ],
      },
    ],
    invariants: NO_CONFLICT,
    parInstructions: 32,
    requiredInstructions: ['SQO'],
    debrief: `Your whole intersection is now **data**: seven patterns and seven times. Want a longer main-street
green at rush hour? Change \`Step_Times[1]\` — no rung changes, no re-verification of the logic.

That's the power of a **drum sequencer**, the software descendant of the motor-driven cam drums that ran
washing machines and early traffic signals. The mask (\`16#FF\`) lets several sequencers share one output word
without touching each other's bits.

**Field tip:** in a real controller the pattern table would be filled in the **tag editor** (or downloaded as
recipe data), and protected from accidental edits: a wrong bit in a traffic table is a crash. Real signal
controllers also run an independent **conflict monitor** (MMU) that forces the intersection into flash if two
conflicting greens ever appear — defence in depth.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '6-4',
    chapter: 'sequencing',
    order: 4,
    title: 'Night Shift',
    tagline: 'Boss: night flash on a key switch — and back to day through all red.',
    kind: 'boss',
    sceneId: 'traffic-light',
    difficulty: 5,
    xp: 380,
    briefing: `After midnight the side street is empty and drivers sit at red lights for nothing. The traffic department
wants **night flash**: flashing **yellow** for the main street (proceed with caution) and flashing **red** for the
side street (stop, then go). A technician turns the \`Night_Mode\` key in the signal cabinet in the evening
and back in the morning.

**The hardware**
- \`Night_Mode\` → \`Local:1:I.Pt02.Data\` — maintained key switch, 1 = night flash requested.
- The lamps and your drum from **Sequencer Traffic** are loaded (the drum patterns are now stored in \`Lamp_Steps\`, so the first-scan loading rung is optional). Extra tags: \`Night_Active\` (BOOL), \`Flash_Timer\` (TIMER).

**Specification**
1. **Day** (key off): the normal drum cycle, exactly as before.
2. **Entering night:** when the key is on, the cycle continues until the drum reaches an **ALL-RED** step
   (step 3 or 6) — a green or yellow is **never cut short**. From there the intersection flashes.
3. **Night flash:** \`NS_Yellow\` and \`EW_Red\` flash together at **1 Hz** (about 0.5 s on, 0.5 s off). Every other lamp is dark, pedestrian heads included.
4. **Back to day:** when the key is turned off, show **ALL RED (steady) for 2 s**, then restart the cycle with
   **NS green** — the drum's home step is exactly that.
5. **Never a conflict.**`,
    objectives: [
      'Day cycle unchanged',
      'Night mode starts only at an all-red step',
      'NS yellow + EW red flash at 1 Hz, everything else dark',
      'Back to day: 2 s all red, then NS green',
      'Never a conflicting signal',
    ],
    concepts: ['SQO', 'RES', 'TON', 'EQU', 'MOV'],
    starter: {
      rungs: [LOAD_DRUM, STEP_TIMER, STEP_PRESET, DRUM_SQO, DRUM_HOME, ...LAMP_RUNGS],
      comments: [
        'Load the drum (mission 6-3)',
        'Step timer',
        'Preset of the current step',
        'The drum',
        'Home position: all red',
        ...LAMP_COMMENTS,
      ],
      tags: NIGHT_TAGS,
    },
    solution: {
      rungs: [
        'XIC(Night_Mode)[EQU(Lamp_Seq.POS,3),EQU(Lamp_Seq.POS,6),XIC(Night_Active)]OTE(Night_Active);',
        'XIO(Night_Active)XIO(Step_Timer.DN)TON(Step_Timer,2000,0);',
        STEP_PRESET,
        DRUM_SQO,
        'XIC(Night_Active)RES(Lamp_Seq);',
        DRUM_HOME,
        'XIC(Night_Active)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);',
        'XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_1010,Lamps),GEQ(Flash_Timer.ACC,500)MOV(0,Lamps)];',
        ...LAMP_RUNGS,
      ],
    },
    hints: [
      'Make a `Night_Active` bit that can only switch ON while the drum sits in an all-red step (POS 3 or 6) and seals in while the key stays on. While it is on: freeze the step timer, send the drum home (RES), and write flash patterns into `Lamps`.',
      'Flasher: `XIC(Night_Active)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0)` and use `Flash_Timer.ACC` < 500 for the ON half. Flash pattern ON = NS yellow + EW red = `2#0000_1010`, OFF = 0. Your home-step rung already shows ALL RED when the drum is at POS 0 — which is exactly where RES leaves it when night ends. Rung order: home MOV before the flash MOVs.',
      '`XIC(Night_Mode)[EQU(Lamp_Seq.POS,3),EQU(Lamp_Seq.POS,6),XIC(Night_Active)]OTE(Night_Active);` `XIO(Night_Active)XIO(Step_Timer.DN)TON(Step_Timer,2000,0);` … SQO … `XIC(Night_Active)RES(Lamp_Seq);` `EQU(Lamp_Seq.POS,0)MOV(Lamp_Steps[0],Lamps);` `XIC(Night_Active)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);` `XIC(Night_Active)[LES(Flash_Timer.ACC,500)MOV(2#0000_1010,Lamps),GEQ(Flash_Timer.ACC,500)MOV(0,Lamps)];`',
    ],
    tests: [
      {
        name: 'Day cycle unchanged',
        steps: [
          wait(300),
          ...lampsAre(ALL_RED, 'Power-up (home step: ALL RED)'),
          ...phase('nsGreen', NS_GREEN, 10000, 'NS GREEN', 2500),
          ...phase('nsYellow', NS_YELLOW, 3000, 'NS YELLOW'),
          expectObs('ewRed', true, 'ALL RED after NS yellow', { within: 100 }),
          ...lampsAre(ALL_RED, 'ALL RED after NS yellow'),
          ...phase('ewGreen', EW_GREEN, 8000, 'EW GREEN with WALK', 1500),
          ...phase('ewYellow', EW_YELLOW, 3000, 'EW YELLOW'),
          expectObs('nsGreen', true, 'The cycle must continue with NS green', { within: 1600 }),
        ],
      },
      {
        name: 'Night mode waits for all red, then flashes',
        description: 'The key is turned during the main-street green.',
        steps: [
          expectObs('nsGreen', true, 'The day cycle must start with NS green', { within: 2500 }),
          wait(1000),
          set('night', true),
          expectObs('nsGreen', true, 'The NS green must not be cut short when night mode is requested', { for: 8000 }),
          expectObs('nsYellow', true, 'The main street must get its full yellow clearance first', { within: 1500 }),
          expectObs('nsYellow', true, 'The main street must get its full 3 s yellow first', { for: 2500 }),
          expectObs('nsRed', true, 'Night flash may only start from an ALL-RED step', { within: 800 }),
          expectObs('ewRed', true, 'Night flash may only start from an ALL-RED step'),
          ...flashing('Night flash'),
          wait(5000),
          ...flashing('Night flash, 5 s later'),
        ],
      },
      {
        name: 'Night mode from the side-street green',
        description: 'The key is turned during the EW green: the flash starts after the EW yellow and all red.',
        steps: [
          expectObs('ewGreen', true, 'The day cycle must reach the EW green', { within: 20000 }),
          wait(500),
          set('night', true),
          expectObs('ewGreen', true, 'The EW green must not be cut short', { for: 6000 }),
          expectObs('ewYellow', true, 'The side street must get its yellow clearance', { within: 2500 }),
          expectObs('ewYellow', true, 'The side street must get its full 3 s yellow', { for: 2500 }),
          ...flashing('Night flash', 2200),
        ],
      },
      {
        name: 'Back to day through all red',
        steps: [
          expectObs('nsGreen', true, 'The day cycle must start with NS green', { within: 2500 }),
          set('night', true),
          wait(16000),
          ...flashing('Night flash'),
          set('night', false),
          expectObs('nsRed', true, 'Leaving night mode: ALL RED first', { within: 600 }),
          expectObs('ewRed', true, 'Leaving night mode: ALL RED (steady EW red)', { within: 600 }),
          ...lampsAre(ALL_RED, 'Leaving night mode: steady ALL RED'),
          expectObs('nsRed', true, 'The all-red transition must be steady for about 2 s', { for: 700 }),
          expectObs('ewRed', true, 'The all-red transition must be steady for about 2 s (EW red)', { for: 600 }),
          ...lampsAre(ALL_RED, 'Still ALL RED'),
          ...phase('nsGreen', NS_GREEN, 10000, 'Day again: NS GREEN', 1400),
          ...phase('nsYellow', NS_YELLOW, 3000, 'Day again: NS YELLOW'),
        ],
      },
    ],
    invariants: NO_CONFLICT,
    parInstructions: 48,
    debrief: `The intersection now sleeps at night and wakes up safely: it enters flash only from all red, and it
comes back through a steady all-red so that no driver sees a green appear out of a flashing signal.

You combined a sequencer, a mode bit with an **entry condition** (only at all red) and a **seal** (while the key
is on), a RES to send the drum home, and a flasher driven by a timer's accumulator — a real traffic-signal
program in miniature.

**Field tip:** real controllers enter flash on faults too — the conflict monitor, a dead lamp (red-out) or a
controller watchdog drops the signal into a hardware **flasher** that works even if the CPU doesn't. And signal
standards such as the US MUTCD ask for exactly what you built — enter flash from a red interval, return to steady
operation through a red clearance — because drivers trust the sequence they expect.`,
  },
];
