/**
 * Chapter 4 — Counting & Tracking (CTU / CTD / RES, one-shots, batch counting, gate control on edges and
 * an up/down occupancy counter for the parking garage).
 * Mission ids '4-1', '4-2', ... See docs/CURRICULUM.md for the authoring guide.
 */
import type { MissionDef, MissionInvariant, TestStep } from '../types';
import { expectObs, expectObsRange, expectTag, press, release, set, tap, wait } from './authoring';

/** Bits, timers, counters and one-shots (chapters 1–4). */
const COUNT_PALETTE = ['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'OSF', 'TON', 'TOF', 'RTO', 'CTU', 'CTD', 'RES'];
/**
 * 4-4's palette: no timers. The lesson is that an edge *proves* the car is through while a timer only
 * guesses — and a lucky TOF on the exit loop would pass, because every simulated car drives off at full speed.
 */
const GATE_PALETTE = COUNT_PALETTE.filter((i) => !['TON', 'TOF', 'RTO'].includes(i));

// ---------------------------------------------------------------------------
// Conveyor (4-1, 4-2)
// ---------------------------------------------------------------------------

/** Box pattern selector: 1 = all short boxes (they all run off the end to the good lane). */
const ALL_SHORT = 1;

const BELT_SEAL = '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);';

const BELT_STOP_WINS: MissionInvariant = {
  when: { control: 'stop', equals: true },
  tag: 'Conveyor_Run',
  equals: false,
  graceMs: 20,
  message: 'Conveyor_Run must be OFF while Stop is pressed — Stop always wins',
};
const BELT_ESTOP: MissionInvariant = {
  when: { control: 'estop', equals: true },
  tag: 'Conveyor_Run',
  equals: false,
  graceMs: 20,
  message: 'Conveyor_Run must be OFF while the E-stop is pushed — drop the seal in the logic too',
};

const beltRuns = (message: string, hold = 1000): TestStep => expectObs('conveyorRunning', true, message, { within: 400, for: hold });
const beltStops = (message: string, hold = 1000): TestStep => expectObs('conveyorRunning', false, message, { within: 400, for: hold });

/**
 * Stop the belt and check the count against the boxes physically delivered to the good lane. The stop
 * moments are chosen so no box is near the exit eye (whichever edge a program counts, it agrees with
 * the plant), and `boxesGood` is asserted first to prove the scenario itself.
 */
function stopAndCompare(expected: number, what: string): TestStep[] {
  return [
    tap('stop'),
    beltStops('Stop must stop the belt', 300),
    expectObs('boxesGood', expected, `Scenario check: ${expected} boxes should have reached the good lane by now`),
    expectTag('Box_Count.ACC', expected, `${what}: Box_Count.ACC must equal the ${expected} boxes that went past the exit eye`, {
      within: 50,
    }),
    expectTag('Box_Count.ACC', expected, 'The count must not change while the belt is stopped', { for: 1500 }),
  ];
}

// ---------------------------------------------------------------------------
// Parking garage (4-4, 4-5)
// ---------------------------------------------------------------------------

const NO_GATE_HITS: MissionInvariant = {
  observe: 'gateHits',
  max: 0,
  message: 'A barrier arm came down on a car — never lower a gate while a car is under it',
};

/** Manual traffic for a repeatable test: automatic arrivals/departures off, `cars` parked at the start. */
const manualGarage = (cars = 0): TestStep[] => [set('auto_traffic', false), set('initial_cars', cars), wait(100)];

/** Send `n` cars (momentary control pulses). */
const send = (id: 'spawn_entry' | 'spawn_exit', n: number): TestStep[] =>
  Array.from({ length: n }, () => [tap(id, 20), wait(20)]).flat();

/** The entry gate must come down promptly once the car is through (and stay fully down). */
const entryGateCloses = (message: string): TestStep[] => [
  expectObs('entryGateUp', false, message, { within: 400 }),
  expectObsRange('entryGatePos', { max: 0 }, 'The entry arm must go all the way down', { within: 2000 }),
];
const exitGateCloses = (message: string): TestStep[] => [
  expectObs('exitGateUp', false, message, { within: 400 }),
  expectObsRange('exitGatePos', { max: 0 }, 'The exit arm must go all the way down', { within: 2000 }),
];

const GATE_TAGS = [
  { name: 'Entry_OSF', dataType: 'BOOL' as const, description: 'OSF storage bit: Entry_PE' },
  { name: 'Entry_Passed', dataType: 'BOOL' as const, description: 'One-scan pulse: a car has cleared the entry eye' },
  { name: 'Exit_OSF', dataType: 'BOOL' as const, description: 'OSF storage bit: Exit_PE' },
  { name: 'Exit_Passed', dataType: 'BOOL' as const, description: 'One-scan pulse: a car has cleared the exit eye' },
];

const GATE_RUNGS = [
  'XIC(Entry_PE)OSF(Entry_OSF,Entry_Passed);',
  '[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIO(Entry_Passed)OTE(Entry_Gate_Up);',
  'XIC(Exit_PE)OSF(Exit_OSF,Exit_Passed);',
  '[XIC(Exit_Loop),XIC(Exit_Gate_Up)]XIO(Exit_Passed)OTE(Exit_Gate_Up);',
];

export const CH4_MISSIONS: MissionDef[] = [
  // -------------------------------------------------------------------------
  {
    id: '4-1',
    chapter: 'counting',
    order: 1,
    title: 'Box Counter',
    tagline: 'CTU: count every box that leaves the line.',
    kind: 'build',
    sceneId: 'conveyor-sort',
    difficulty: 2,
    xp: 100,
    briefing: `Shipping swears Line 5 sends out 20 boxes fewer per shift than production claims it made. Nobody trusts
anybody's clipboard. The plant manager's answer: *"Make the PLC count them."*

**The hardware** (a 6 m belt conveyor; the feeder drops boxes on the belt by itself while it runs)
- \`Start_PB\` → \`Local:1:I.Data.0\` — **N.O.**; \`Stop_PB\` → \`Local:1:I.Data.1\` — **N.C.** (1 when not pressed).
- \`EStop_OK\` → \`Local:1:I.Data.8\` — E-stop, **N.C.** (1 = released). Its second contact is also hardwired into
  the belt starter.
- \`PE_Exit\` → \`Local:1:I.Data.7\` — photo-eye at the discharge end: **1 while a box blocks the beam**.
- \`Conveyor_Run\` → \`Local:2:O.Data.0\` — belt motor starter.
- A counter tag \`Box_Count\` (COUNTER) is created for you.

**Meet the CTU** (*Count Up*): each time its rung goes from false to **true**, \`.ACC\` goes up by one. A box
blocks the eye for 0.6 s — dozens of scans — but the CTU only counts the **edge**. The count is retentive
(it survives stops and mode changes); \`.DN\` comes on when \`.ACC\` ≥ \`.PRE\`.

**Your task**
- Start / Stop / E-stop control the belt like the motor in chapter 2 (seal-in, Stop wins, the E-stop drops the
  seal: no restart when it's released).
- \`Box_Count.ACC\` counts every box that leaves the belt at the exit eye — and keeps counting across stops
  and E-stops. Use a preset of 1000 (the shift target).`,
    objectives: [
      'Start / Stop / E-stop seal-in for `Conveyor_Run`',
      '`Box_Count.ACC` = boxes delivered past `PE_Exit` (a box that stops on the eye is still one box)',
      'The count survives stops, E-stops and restarts',
    ],
    concepts: ['CTU', 'XIC', 'OTE'],
    starter: {
      rungs: ['', ''],
      comments: ['Belt start/stop (seal-in)', 'Count the boxes at the exit eye'],
      tags: [{ name: 'Box_Count', dataType: 'COUNTER', description: 'Boxes delivered this shift' }],
    },
    solution: { rungs: [BELT_SEAL, 'XIC(PE_Exit)CTU(Box_Count,1000,0);'] },
    hints: [
      'Two rungs: the belt seal-in you know from chapter 2, and a counter driven by the exit photo-eye.',
      'Seal-in: Start in parallel with `Conveyor_Run`, then Stop and E-stop in series (both N.C. → XIC). Counter: `XIC(PE_Exit)` in front of a **CTU** on `Box_Count`.',
      '`[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);` and `XIC(PE_Exit)CTU(Box_Count,1000,0);`',
    ],
    tests: [
      {
        name: 'Start, Stop and the E-stop',
        steps: [
          wait(200),
          expectObs('conveyorRunning', false, 'The belt must not start by itself', { for: 500 }),
          tap('start'),
          beltRuns('Start must run the belt, and it must keep running after Start is released (seal-in)', 2000),
          tap('stop'),
          beltStops('Stop must stop the belt, and it must stay stopped', 1500),
          tap('start'),
          beltRuns('Start must restart the belt'),
          set('estop', true),
          beltStops('The E-stop must stop the belt'),
          set('estop', false),
          expectObs('conveyorRunning', false, 'DANGER: the belt restarted by itself when the E-stop was released', { for: 2000 }),
          tap('start'),
          beltRuns('Start must work again after the E-stop'),
        ],
      },
      {
        name: 'Every delivered box is counted',
        description: 'Short boxes only, so every box runs off the end. The belt is stopped twice with no box near the exit eye.',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectTag('Box_Count.ACC', 0, 'No box has reached the exit yet: the count must still be 0', { for: 10_000 }),
          wait(2600),
          ...stopAndCompare(1, 'First box out'),
          tap('start'),
          beltRuns('Start must restart the belt', 500),
          wait(8700),
          ...stopAndCompare(5, 'After the restart'),
        ],
      },
      {
        name: 'A long run',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          wait(35_700),
          ...stopAndCompare(11, 'After 36 s of running'),
        ],
      },
      {
        name: 'A box stopped on the eye is still one box',
        description: 'Stop is pressed while the first box is right on the exit eye; the belt is restarted after 1 s.',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectTag('PE_Exit', true, 'Scenario check: the first box should reach the exit eye', { within: 15_000 }),
          wait(100),
          tap('stop'),
          beltStops('Stop must stop the belt', 300),
          expectTag('PE_Exit', true, 'Scenario check: the box should be standing on the exit eye'),
          wait(700),
          tap('start'),
          beltRuns('Start must restart the belt', 300),
          expectObs('boxesGood', 1, 'Scenario check: the first box should run off the end after the restart', { within: 2000 }),
          wait(500),
          ...stopAndCompare(
            1,
            'A box that stopped on the eye and moved on is still ONE box — count the eye itself, not "eye AND belt running"',
          ),
        ],
      },
      {
        name: 'The count survives an E-stop',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectObs('boxesGood', 2, 'Scenario check: two boxes should reach the good lane', { within: 20_000 }),
          wait(500),
          set('estop', true),
          beltStops('The E-stop must stop the belt', 300),
          expectTag('Box_Count.ACC', 2, 'The E-stop must not clear the shift count (2 boxes so far)', { within: 50, for: 500 }),
          set('estop', false),
          expectTag('Box_Count.ACC', 2, 'Releasing the E-stop must not change the shift count', { for: 1000 }),
          tap('start'),
          beltRuns('Start must restart the belt after the E-stop', 500),
          expectObs('boxesGood', 3, 'Scenario check: the next box should reach the good lane', { within: 4000 }),
          wait(500),
          ...stopAndCompare(3, 'Counting must carry on after the E-stop'),
        ],
      },
    ],
    invariants: [BELT_STOP_WINS, BELT_ESTOP],
    parInstructions: 7,
    allowedInstructions: COUNT_PALETTE,
    requiredInstructions: ['CTU'],
    debrief: `The CTU counted each box **once**, although every box kept the eye blocked for about 60 scans. The counter
keeps its own edge memory — the \`.CU\` bit — so only a false→true transition adds one.

**Field tip:** put the counting eye where the product *leaves* your responsibility, and count on the edge. A
dirty lens or a box that stops *on* the eye is still one box, but a box that wobbles and flickers the beam can
be counted twice — real installations add a short TON (debounce) or use the eye's built-in off-delay. And the
count lives in a COUNTER tag that survives power cycles: great for shift totals, but remember to reset it at
shift change.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '4-2',
    chapter: 'counting',
    order: 2,
    title: 'Batch of Ten',
    tagline: 'Stop the belt at exactly ten — then start the next batch.',
    kind: 'build',
    sceneId: 'conveyor-sort',
    difficulty: 3,
    xp: 140,
    briefing: `A new customer buys Line 5's boxes by the **case of ten**. The packer at the end of the belt wants the line to
stop by itself when a case is full, with the amber light on, and to start the next case when she presses Start.

**The hardware**
- \`Start_PB\` (**N.O.**), \`Stop_PB\` (**N.C.**), \`EStop_OK\` (**N.C.**), \`PE_Exit\` (1 = box at the exit) and
  \`Conveyor_Run\` as in 4-1.
- \`Light_Amber\` → \`Local:2:O.Data.4\` — amber tier of the 855T stack light: **CASE FULL**.
- A counter tag \`Batch_Count\` (COUNTER) is created for you. Use a preset of **10**.

**Your task**
- Count boxes at the exit eye with a CTU on \`Batch_Count\` (preset 10).
- When the 10th box reaches the exit the belt **stops** and \`Light_Amber\` lights.
- **Start** after a complete batch **resets** the counter (RES), turns the amber light off and runs the belt.
- **Stop** (or the E-stop) in the middle of a batch only *pauses* it: Start resumes and the count carries on —
  a paused case must still end at ten boxes.

What Start does while the belt is already running is up to you.`,
    objectives: [
      'The belt stops by itself when `Batch_Count` reaches 10',
      '`Light_Amber` = batch complete',
      'Start after a complete batch resets the counter (RES) and starts a new batch',
      'Stop / E-stop mid-batch pause it without losing the count',
    ],
    concepts: ['CTU', 'RES', 'XIC', 'XIO'],
    starter: {
      rungs: [BELT_SEAL, 'XIC(PE_Exit)CTU(Batch_Count,10,0);', '', ''],
      comments: ['Belt start/stop (4-1)', 'Count the boxes of the batch', 'New batch: reset the counter', 'CASE FULL light (amber)'],
      tags: [{ name: 'Batch_Count', dataType: 'COUNTER', description: 'Boxes in the current case (10 per case)' }],
    },
    solution: {
      rungs: [
        'XIC(Start_PB)XIC(Batch_Count.DN)RES(Batch_Count);',
        '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)XIO(Batch_Count.DN)OTE(Conveyor_Run);',
        'XIC(PE_Exit)CTU(Batch_Count,10,0);',
        'XIC(Batch_Count.DN)OTE(Light_Amber);',
      ],
    },
    hints: [
      'The counter\'s done bit `Batch_Count.DN` is your "case full" signal. Where must it go to stop the belt — and what must happen to it before the belt may run again?',
      'Put `XIO(Batch_Count.DN)` in series in the belt seal-in, drive `Light_Amber` from `Batch_Count.DN`, and add a rung that RESets the counter on Start — but only when the batch is complete, or a pause would lose the count.',
      '`XIC(Start_PB)XIC(Batch_Count.DN)RES(Batch_Count);` — `[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)XIO(Batch_Count.DN)OTE(Conveyor_Run);` — `XIC(PE_Exit)CTU(Batch_Count,10,0);` — `XIC(Batch_Count.DN)OTE(Light_Amber);`',
    ],
    tests: [
      {
        name: 'A case of ten',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          beltRuns('Start must run the belt'),
          expectObs('lightAmber', false, 'CASE FULL must be OFF while the batch is running', { for: 500 }),
          expectObs('conveyorRunning', false, 'The belt must stop by itself when the 10th box reaches the exit', { within: 40_000 }),
          expectTag('Batch_Count.ACC', 10, 'The belt stopped with Batch_Count.ACC not at 10 — stop exactly at the preset'),
          expectObsRange('boxesGood', { min: 9, max: 10 }, 'The belt must stop when the 10th box reaches the exit — not earlier, not later'),
          expectObs('lightAmber', true, 'CASE FULL (Light_Amber) must light when the batch is complete', { within: 150, for: 2000 }),
          expectObs('conveyorRunning', false, 'The belt must stay stopped until the packer presses Start — it must never start the next case by itself', {
            for: 20_000,
          }),
          expectObs('lightAmber', true, 'CASE FULL must stay lit until the packer presses Start'),
          expectTag('Batch_Count.ACC', 10, 'The full case must stay counted (10) until the packer presses Start — only Start resets it'),
        ],
      },
      {
        name: 'Start begins the next case',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectObs('lightAmber', true, 'CASE FULL must light when the batch is complete', { within: 40_000 }),
          wait(1000),
          tap('start'),
          expectTag('Batch_Count.ACC', 0, 'Start after a complete batch must reset Batch_Count (RES)', { within: 50 }),
          expectObs('lightAmber', false, 'CASE FULL must go OFF when the next batch starts', { within: 150 }),
          beltRuns('Start after a complete batch must run the belt again'),
          expectObs('conveyorRunning', false, 'The belt must stop again after the next 10 boxes', { within: 30_000 }),
          expectTag('Batch_Count.ACC', 10, 'Second case: Batch_Count.ACC must be 10 when the belt stops'),
          expectObsRange('boxesGood', { min: 19, max: 20 }, 'Second case: the belt must stop after 10 more boxes (20 in total) — the box still on the eye must not be counted twice'),
          expectObs('lightAmber', true, 'CASE FULL must light again', { within: 150, for: 1000 }),
        ],
      },
      {
        name: 'A pause keeps the count',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          wait(23_600),
          tap('stop'),
          beltStops('Stop must stop the belt', 300),
          expectObs('boxesGood', 6, 'Scenario check: 6 boxes should have reached the good lane'),
          expectTag('Batch_Count.ACC', 6, 'After 6 boxes, Batch_Count.ACC must be 6', { within: 50, for: 1500 }),
          expectObs('lightAmber', false, 'The batch is not complete: CASE FULL must be OFF', { for: 100 }),
          tap('start'),
          beltRuns('Start must resume the paused batch', 500),
          expectTag('Batch_Count.ACC', 6, 'Start in the middle of a batch must NOT reset the count — only a complete batch is reset'),
          expectObs('conveyorRunning', false, 'The resumed batch must stop at 10 boxes', { within: 20_000 }),
          expectObsRange('boxesGood', { min: 9, max: 10 }, 'A paused-and-resumed case must still hold exactly 10 boxes'),
          expectTag('Batch_Count.ACC', 10, 'Batch_Count.ACC must be 10 at the end of the batch'),
        ],
      },
      {
        name: 'E-stop in the middle of a batch',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          wait(12_600),
          set('estop', true),
          beltStops('The E-stop must stop the belt', 300),
          set('estop', false),
          expectObs('conveyorRunning', false, 'DANGER: the belt restarted by itself when the E-stop was released', { for: 2000 }),
          expectTag('Batch_Count.ACC', 1, 'The E-stop must not reset the batch count (1 box so far)'),
          tap('start'),
          beltRuns('Start must resume the batch after the E-stop', 500),
          expectObs('conveyorRunning', false, 'The resumed batch must stop at 10 boxes', { within: 30_000 }),
          expectObsRange('boxesGood', { min: 9, max: 10 }, 'The case must still hold exactly 10 boxes'),
        ],
      },
    ],
    invariants: [
      BELT_STOP_WINS,
      BELT_ESTOP,
      {
        when: { tag: 'Batch_Count.DN', equals: true },
        tag: 'Conveyor_Run',
        equals: false,
        graceMs: 20,
        message: 'The belt must not run while the case is full (Batch_Count.DN) — Start must reset the counter first',
      },
    ],
    parInstructions: 13,
    allowedInstructions: COUNT_PALETTE,
    requiredInstructions: ['CTU', 'RES'],
    debrief: `The counter's **.DN** bit became a permissive in the belt rung, and a conditioned **RES** turned "Start" into
"Start a new case" only when a case was complete. Notice the 10th box was still sitting on the eye when the
belt restarted — and wasn't counted again: the CTU's \`.CU\` bit remembered the rung was already true.

**Field tip:** where you put the RES matters. Resetting on *every* Start press looks fine on the bench and
ships short cases the first time an operator pauses the line. Many machines show the running count on the
HMI and give the supervisor a separate "reset count" button.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '4-3',
    chapter: 'counting',
    order: 3,
    title: 'One-Shot Wonder',
    tagline: 'ONS: one press, one count — not one count per scan.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 3,
    xp: 130,
    briefing: `The quality lab wants a tally counter on the bench: every press of the green button adds **one** to a count,
and the analog meter shows it. Easy? Try \`XIC(PB_Green)ADD(Press_Count,1,Press_Count)\` first and watch
what happens to the number…

The controller scans your rungs every few milliseconds. A human press lasts 100–300 ms, so an ADD on a
plain contact runs on **every** scan of the press — dozens of times. You need a **one-shot**: an instruction
that passes power for **one scan only**, on the false→true transition of its rung.
- **ONS** (*One Shot*) — an input instruction with a storage bit: \`XIC(PB_Green)ONS(Green_ONS)…\`
- **OSR** / **OSF** — output one-shots (rising / falling edge) that set an output bit for one scan.

**A sneak peek at chapter 5's math** (you only need three boxes here)
- \`ADD(Source A, Source B, Dest)\` — Dest = A + B, e.g. \`ADD(Press_Count,1,Press_Count)\` adds one.
- \`MUL(Source A, Source B, Dest)\` — Dest = A × B. \`MUL(Press_Count,10,Meter_1)\` multiplies the DINT count by 10
  and stores it in the REAL \`Meter_1\` (the controller converts the integer for you).
- \`CLR(Dest)\` — Dest = 0.

**The hardware**
- \`PB_Green\` → \`Local:1:I.Data.8\` — green push button, **N.O.**
- \`PB_Red\` → \`Local:1:I.Data.9\` — red push button, **N.C.**: **1 when NOT pressed**.
- \`Meter_1\` → \`Local:4:O.Ch0Data\` — analog panel meter, 0–100 % (a REAL).
- Tags created for you: \`Press_Count\` (DINT) and \`Green_ONS\` (BOOL, a storage bit).

**Your task**
- Each press of \`PB_Green\` adds exactly **1** to \`Press_Count\` — counted the moment it's pressed, however long it is held.
- \`Meter_1\` shows \`Press_Count × 10\` % (3 presses = 30 %).
- Pressing \`PB_Red\` clears the count to 0.`,
    objectives: [
      'Each press adds exactly 1 to `Press_Count` (on the press)',
      'Holding the button counts once',
      '`Meter_1` = `Press_Count` × 10',
      'The red (N.C.) button clears the count',
    ],
    concepts: ['ONS', 'OSR', 'ADD', 'MUL', 'CLR'],
    starter: {
      rungs: ['XIC(PB_Green)ADD(Press_Count,1,Press_Count);', '', ''],
      comments: ['Tally: add 1 per press… or per scan?', 'Red button: clear the count', 'Meter: count x 10 %'],
      tags: [
        { name: 'Press_Count', dataType: 'DINT', description: 'Number of presses' },
        { name: 'Green_ONS', dataType: 'BOOL', description: 'One-shot storage bit for PB_Green' },
      ],
    },
    solution: {
      rungs: ['XIC(PB_Green)ONS(Green_ONS)ADD(Press_Count,1,Press_Count);', 'XIO(PB_Red)CLR(Press_Count);', 'MUL(Press_Count,10,Meter_1);'],
    },
    hints: [
      'Watch `Press_Count` in the tag monitor while you press once. The ADD runs on every scan the rung is true — you want it on the first scan only.',
      'Insert an **ONS** with the storage bit `Green_ONS` between the button and the ADD. For the red button remember it is N.C.: pressed = 0 → XIO. For the meter a **MUL** by 10 into `Meter_1` on an unconditional rung.',
      '`XIC(PB_Green)ONS(Green_ONS)ADD(Press_Count,1,Press_Count);` — `XIO(PB_Red)CLR(Press_Count);` — `MUL(Press_Count,10,Meter_1);`',
    ],
    tests: [
      {
        name: 'Starts at zero',
        steps: [
          wait(200),
          expectTag('Press_Count', 0, 'Press_Count must be 0 before anyone presses', { for: 500 }),
          expectObs('meter1', 0, 'The meter must read 0 %', { for: 300 }),
        ],
      },
      {
        name: 'One press, one count',
        steps: [
          wait(200),
          tap('pb_green'),
          expectTag('Press_Count', 1, 'One press must add exactly 1 — without a one-shot the ADD runs on every scan of the press', {
            within: 50,
            for: 300,
          }),
          expectObs('meter1', 10, 'The meter must show 1 × 10 = 10 %', { within: 100 }),
          wait(300),
          tap('pb_green'),
          wait(300),
          tap('pb_green'),
          expectTag('Press_Count', 3, 'Three presses must count 3', { within: 50, for: 300 }),
          expectObs('meter1', 30, 'The meter must show 3 × 10 = 30 %', { within: 100, for: 300 }),
        ],
      },
      {
        name: 'Holding the button counts once — on the press',
        steps: [
          wait(200),
          press('pb_green'),
          expectTag('Press_Count', 1, 'The count must go up the moment the button is pressed (rising edge)', { within: 50 }),
          expectTag('Press_Count', 1, 'Holding the button must not keep counting', { for: 2000 }),
          release('pb_green'),
          expectTag('Press_Count', 1, 'Releasing the button must not count again', { for: 500 }),
        ],
      },
      {
        name: 'Fast fingers',
        description: 'Five quick 30 ms jabs, 40 ms apart.',
        steps: [
          wait(200),
          ...Array.from({ length: 5 }, () => [tap('pb_green', 30), wait(40)]).flat(),
          expectTag('Press_Count', 5, 'Five quick presses must count exactly 5', { within: 50, for: 300 }),
          expectObs('meter1', 50, 'The meter must show 50 %', { within: 100 }),
        ],
      },
      {
        name: 'Red button clears',
        steps: [
          wait(200),
          tap('pb_green'),
          wait(200),
          tap('pb_green'),
          expectTag('Press_Count', 2, 'Two presses must count 2', { within: 50 }),
          expectTag('Press_Count', 2, 'The count must not clear by itself (PB_Red is N.C.: 1 when NOT pressed)', { for: 500 }),
          tap('pb_red'),
          expectTag('Press_Count', 0, 'Pressing the red button must clear the count', { within: 50, for: 500 }),
          expectObs('meter1', 0, 'The meter must return to 0 %', { within: 100 }),
          tap('pb_green'),
          expectTag('Press_Count', 1, 'Counting must start again from 0', { within: 50, for: 300 }),
        ],
      },
    ],
    parInstructions: 6,
    allowedInstructions: ['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'OSF', 'ADD', 'SUB', 'MUL', 'MOV', 'CLR', 'CPT'],
    // No requiredInstructions: ADD or CPT both do the math, and the counting tests already enforce the one-shot.
    debrief: `Without the one-shot, a single press added 20 or 30 — one per scan. The ONS stores the rung state in its
storage bit and passes power only on the scan where the rung goes from false to true. (A CTU does the same
thing internally with its \`.CU\` bit — that's why counters "just work".)

**Field tip:** every storage bit must be **unique** — reuse \`Green_ONS\` on another rung and both one-shots
break in confusing ways. And never put a one-shot in front of a **TON**: it is enabled for a single scan,
resets on the next one and never times out — a classic "the machine just sits there" call.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '4-4',
    chapter: 'counting',
    order: 4,
    title: 'Garage Gates',
    tagline: 'Raise on a ticket, lower on the falling edge — never on a car.',
    kind: 'build',
    sceneId: 'parking-garage',
    difficulty: 3,
    xp: 150,
    briefing: `Riverside's employee garage just got new barrier gates, and the installer left without programming them. Gus
has a dented company truck to prove it: the old timer-based program dropped the arm on his roof.

**The hardware** (CompactLogix 5380, 5069-IB16 / 5069-OB16)
- \`Entry_Loop\` → \`Local:1:I.Pt00.Data\` — vehicle loop in front of the entry gate (1 = car on it).
- \`Ticket_PB\` → \`Local:1:I.Pt04.Data\` — ticket button, **N.O.**, pressed by the driver for about 0.3 s.
- \`Entry_PE\` → \`Local:1:I.Pt01.Data\` — photo-eye **under** the entry arm: 1 while a car is passing under it.
- \`Exit_Loop\`, \`Exit_PE\` → \`Local:1:I.Pt02 / Pt03.Data\` — the same at the exit gate.
- \`Entry_Gate_Up\` / \`Exit_Gate_Up\` → \`Local:2:O.Pt00 / Pt01.Data\` — the arm rises while ON (1.5 s), lowers when OFF.
- Tags created for you: \`Entry_OSF\`, \`Entry_Passed\`, \`Exit_OSF\`, \`Exit_Passed\` (BOOL).

**Your task**
- **Entry:** \`Ticket_PB\` raises the entry gate; it stays up until the car has **completely passed** the eye —
  the **falling edge** of \`Entry_PE\` — then it comes down. One ticket, one car.
- **Exit:** a car on \`Exit_Loop\` raises the exit gate; it comes down on the falling edge of \`Exit_PE\`.
- **Never** lower an arm onto a car. Gates stay down when nobody is there, and don't open before the ticket.
- The timer instructions are locked out of the palette for this job: after Gus's truck, nobody wants a gate
  that *guesses*.

**Meet the OSF** (*One Shot Falling*): \`XIC(Entry_PE)OSF(Entry_OSF,Entry_Passed)\` sets \`Entry_Passed\` for exactly one
scan when \`Entry_PE\` goes from 1 to 0.`,
    objectives: [
      'The ticket raises the entry gate; it lowers after the car has passed the eye',
      'A car on the exit loop raises the exit gate; it lowers after the car has passed',
      'Each car gets its own gate cycle',
      'An arm never comes down on a car',
    ],
    concepts: ['OSF', 'ONS', 'XIC', 'XIO', 'OTE'],
    starter: {
      rungs: ['', '', '', ''],
      comments: ['Entry: detect the car leaving the eye (falling edge)', 'Entry gate', 'Exit: detect the car leaving the eye', 'Exit gate'],
      tags: GATE_TAGS,
    },
    solution: { rungs: GATE_RUNGS },
    hints: [
      'Each gate is a seal-in: something starts it (ticket / exit loop) and something breaks it (the car has passed). Which instruction turns "the eye was blocked and now it is clear" into a single pulse?',
      '`XIC(Entry_PE)OSF(Entry_OSF,Entry_Passed)` gives a one-scan pulse when the car clears the eye. Seal the gate with `XIC(Entry_Gate_Up)` in parallel with the ticket, and break it with `XIO(Entry_Passed)`. Same pattern for the exit.',
      '`XIC(Entry_PE)OSF(Entry_OSF,Entry_Passed);` — `[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIO(Entry_Passed)OTE(Entry_Gate_Up);` — `XIC(Exit_PE)OSF(Exit_OSF,Exit_Passed);` — `[XIC(Exit_Loop),XIC(Exit_Gate_Up)]XIO(Exit_Passed)OTE(Exit_Gate_Up);`',
    ],
    tests: [
      {
        name: 'Gates stay down when nobody is there',
        steps: [
          ...manualGarage(2),
          expectObsRange('entryGatePos', { max: 0 }, 'The entry gate must stay down with no car', { for: 3000 }),
          expectObsRange('exitGatePos', { max: 0 }, 'The exit gate must stay down with no car', { for: 100 }),
        ],
      },
      {
        name: 'Ticket, gate, car, gate down',
        steps: [
          ...manualGarage(),
          ...send('spawn_entry', 1),
          expectTag('Entry_Loop', true, 'A car should arrive on the entry loop', { within: 10_000 }),
          expectObsRange('entryGatePos', { max: 0 }, 'The driver has not taken a ticket yet: the entry gate must stay down', { for: 1000 }),
          expectObs('entryGateUp', true, 'The ticket button must raise the entry gate', { within: 4000 }),
          expectObs('carsEntered', 1, 'The car must be able to drive in', { within: 5000 }),
          ...entryGateCloses('The entry gate must come down as soon as the car has passed the eye'),
          expectObsRange('entryGatePos', { max: 0 }, 'The entry gate must stay down after the car', { for: 2000 }),
        ],
      },
      {
        name: 'Two cars, two tickets',
        steps: [
          ...manualGarage(),
          ...send('spawn_entry', 2),
          expectObs('carsEntered', 1, 'The first car must drive in', { within: 15_000 }),
          ...entryGateCloses('One ticket, one car: the gate must come down after the first car — the second driver needs a ticket'),
          expectObs('carsEntered', 2, 'The second car must get in with its own ticket', { within: 10_000 }),
          ...entryGateCloses('The entry gate must come down after the second car'),
        ],
      },
      {
        name: 'Exit gate',
        steps: [
          ...manualGarage(2),
          ...send('spawn_exit', 1),
          expectTag('Exit_Loop', true, 'A parked car should drive to the exit loop', { within: 15_000 }),
          expectObs('exitGateUp', true, 'A car on the exit loop must raise the exit gate', { within: 2000 }),
          expectObs('carsExited', 1, 'The car must be able to leave', { within: 5000 }),
          ...exitGateCloses('The exit gate must come down as soon as the car has passed the eye'),
          expectObsRange('exitGatePos', { max: 0 }, 'The exit gate must stay down after the car', { for: 2000 }),
        ],
      },
      {
        name: 'Rush hour',
        description: 'Three cars arrive while two parked cars leave.',
        steps: [
          ...manualGarage(3),
          ...send('spawn_entry', 3),
          ...send('spawn_exit', 2),
          expectObs('carsEntered', 3, 'All three arriving cars must get in', { within: 40_000 }),
          expectObs('carsExited', 2, 'Both leaving cars must get out', { within: 20_000 }),
          expectObsRange('entryGatePos', { max: 0 }, 'The entry gate must be down when the rush is over', { within: 2500, for: 1000 }),
          expectObsRange('exitGatePos', { max: 0 }, 'The exit gate must be down when the rush is over', { within: 2500, for: 1000 }),
        ],
      },
    ],
    invariants: [NO_GATE_HITS],
    parInstructions: 12,
    allowedInstructions: GATE_PALETTE,
    debrief: `A gate is a seal-in with a smart "stop" condition: not a timer that *guesses* how long a car takes, but the
**falling edge** of the eye that *proves* the car is through. The OSF turned a level (the eye is clear) into an
event (the eye just became clear) — the difference between "no car" and "the car has gone".

**Field tip:** real barrier gates add a second safety layer: the photo-eye (and often the loop under the arm)
is wired directly into the gate operator so the arm can't come down on a car even if the PLC tells it to —
the same philosophy as a hardwired E-stop. Your logic is the first line of defense, not the last.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '4-5',
    chapter: 'counting',
    order: 5,
    title: 'Full House',
    tagline: 'Boss: count cars in and out, and turn them away when full.',
    kind: 'boss',
    sceneId: 'parking-garage',
    difficulty: 5,
    xp: 320,
    briefing: `Monday, 7:02 AM. The garage filled up, drivers kept taking tickets, and three of them circled the deck for
twenty minutes looking for a space that didn't exist. The plant manager wants the **FULL** sign working
**today**. Your gate program from 4-4 is loaded.

**The hardware** (as in 4-4, plus)
- \`Full_Sign\` → \`Local:2:O.Pt02.Data\` — red **FULL** sign.
- \`Open_Sign\` → \`Local:2:O.Pt03.Data\` — green **SPACES** sign.
- \`Reset_Key\` → \`Local:1:I.Pt05.Data\` — attendant's key switch, spring return (1 while turned).
- A counter tag \`Car_Count\` (COUNTER) is created for you. The garage has **12** spaces.

**Specification**
1. \`Car_Count\` counts the cars inside: **CTU** when a car has passed the entry eye, **CTD** when a car has
   passed the exit eye — the **same** COUNTER, preset **12**.
2. \`Full_Sign\` ON when 12 or more cars are inside; \`Open_Sign\` ON otherwise — never both, never neither.
3. When the garage is **full**, a ticket must **not** raise the entry gate (the driver turns around). A car
   that is already under the arm still gets through, of course.
4. The exit gate always works.
5. The attendant's \`Reset_Key\` sets the count back to **0**. It's for when the count has drifted — e.g. it was
   zeroed on Friday night with two cars still parked, and when they leave on Monday the count reads −2.
6. Never lower an arm onto a car; never let a 13th car in.`,
    objectives: [
      '`Car_Count`: CTU on entry passes, CTD on exit passes (same counter, preset 12)',
      '`Full_Sign` at 12 cars, `Open_Sign` otherwise',
      'No entry when full; the exit always works',
      '`Reset_Key` clears the count',
      'No gate hits, never more than 12 cars inside',
    ],
    concepts: ['CTU', 'CTD', 'RES', 'OSF'],
    starter: {
      rungs: [...GATE_RUNGS, '', '', '', '', ''],
      comments: [
        'Entry eye: car has passed (4-4)',
        'Entry gate (4-4)',
        'Exit eye: car has passed (4-4)',
        'Exit gate (4-4)',
        'Count a car in',
        'Count a car out',
        'Attendant: reset the count',
        'FULL sign',
        'SPACES sign',
      ],
      tags: [...GATE_TAGS, { name: 'Car_Count', dataType: 'COUNTER', description: 'Cars inside the garage (12 spaces)' }],
    },
    solution: {
      rungs: [
        'XIC(Entry_PE)OSF(Entry_OSF,Entry_Passed);',
        '[XIC(Ticket_PB)XIO(Car_Count.DN),XIC(Entry_Gate_Up)]XIO(Entry_Passed)OTE(Entry_Gate_Up);',
        'XIC(Exit_PE)OSF(Exit_OSF,Exit_Passed);',
        '[XIC(Exit_Loop),XIC(Exit_Gate_Up)]XIO(Exit_Passed)OTE(Exit_Gate_Up);',
        'XIC(Entry_Passed)CTU(Car_Count,12,0);',
        'XIC(Exit_Passed)CTD(Car_Count,12,0);',
        'XIC(Reset_Key)RES(Car_Count);',
        'XIC(Car_Count.DN)OTE(Full_Sign);',
        'XIO(Car_Count.DN)OTE(Open_Sign);',
      ],
    },
    hints: [
      'The pulses you built in 4-4 (`Entry_Passed`, `Exit_Passed`) are exactly "a car went in" and "a car went out". One COUNTER can be counted up by a CTU and down by a CTD.',
      'CTU on `Entry_Passed`, CTD on `Exit_Passed`, both on `Car_Count` with preset 12; `Car_Count.DN` (ACC ≥ PRE) is "full". Block only the **ticket** leg of the entry gate with `XIO(Car_Count.DN)` — never the seal, or the arm could drop on a car.',
      '`XIC(Entry_Passed)CTU(Car_Count,12,0);` — `XIC(Exit_Passed)CTD(Car_Count,12,0);` — `XIC(Reset_Key)RES(Car_Count);` — `XIC(Car_Count.DN)OTE(Full_Sign);` — `XIO(Car_Count.DN)OTE(Open_Sign);` — entry gate: `[XIC(Ticket_PB)XIO(Car_Count.DN),XIC(Entry_Gate_Up)]XIO(Entry_Passed)OTE(Entry_Gate_Up);`',
    ],
    tests: [
      {
        name: 'Opening time',
        steps: [
          ...manualGarage(),
          expectObs('openSign', true, 'SPACES must be lit when the garage is empty', { within: 100, for: 2000 }),
          expectObs('fullSign', false, 'FULL must be off when the garage is empty', { for: 100 }),
          expectTag('Car_Count.ACC', 0, 'Car_Count must start at 0'),
        ],
      },
      {
        name: 'Counting in and out',
        steps: [
          ...manualGarage(),
          ...send('spawn_entry', 3),
          expectTag('Entry_Loop', true, 'A car should arrive on the entry loop', { within: 10_000 }),
          expectObs('entryGateUp', true, 'The ticket must raise the entry gate', { within: 4000 }),
          expectTag('Car_Count.ACC', 0, 'The gate is up but the car has not passed the entry eye yet: count cars that have passed the eye, not tickets or gate openings'),
          expectObs('carsEntered', 1, 'The first car must get in', { within: 15_000 }),
          expectTag('Car_Count.ACC', 1, 'One car in: Car_Count.ACC must be 1', { within: 100, for: 500 }),
          expectObs('carsEntered', 3, 'All three cars must get in', { within: 15_000 }),
          expectTag('Car_Count.ACC', 3, 'Three cars in: Car_Count.ACC must be 3', { within: 100, for: 500 }),
          wait(8000),
          ...send('spawn_exit', 2),
          expectTag('Exit_Loop', true, 'A leaving car should drive onto the exit loop', { within: 20_000 }),
          wait(200),
          expectTag('Car_Count.ACC', 3, 'The leaving car is still inside, waiting for the exit gate: count it out when it has passed the exit eye, not on the loop'),
          expectObs('carsExited', 2, 'Both leaving cars must get out', { within: 25_000 }),
          expectTag('Car_Count.ACC', 1, 'Three in, two out: Car_Count.ACC must be 1', { within: 100, for: 1000 }),
          expectObs('openSign', true, 'SPACES must be lit with 1 car inside', { for: 100 }),
        ],
      },
      {
        name: 'Full house',
        description: 'Fills all 12 spaces, sends a 13th car, lets one car out and one more in.',
        steps: [
          ...manualGarage(),
          ...send('spawn_entry', 6),
          expectObs('carsEntered', 4, 'Cars must be getting in', { within: 30_000 }),
          ...send('spawn_entry', 6),
          expectObs('carsEntered', 11, 'Eleven cars must get in', { within: 60_000 }),
          expectObs('openSign', true, 'With 11 cars inside there is still a space: SPACES must be lit', { within: 150, for: 200 }),
          expectObs('fullSign', false, 'With 11 cars inside the garage is not full yet', { for: 100 }),
          expectObs('carsEntered', 12, 'The twelfth car must get in', { within: 15_000 }),
          expectObs('fullSign', true, 'Twelve cars inside: FULL must light', { within: 150, for: 500 }),
          expectObs('openSign', false, 'Twelve cars inside: SPACES must go off', { for: 100 }),
          expectTag('Car_Count.ACC', 12, 'Car_Count.ACC must be 12'),
          expectObsRange('entryGatePos', { max: 0 }, 'The entry arm must go all the way down after the twelfth car', { within: 2000 }),
          ...send('spawn_entry', 1),
          expectObsRange('entryGatePos', { max: 0 }, 'FULL: a ticket must not raise the entry gate — the 13th driver has to turn around', { for: 12_000 }),
          expectObs('carsTurnedAway', 1, 'The 13th car should have turned away', { within: 3000 }),
          ...send('spawn_exit', 1),
          expectObs('carsExited', 1, 'The exit gate must work when the garage is full', { within: 20_000 }),
          expectObs('openSign', true, 'A car left: SPACES must light again', { within: 150, for: 300 }),
          expectObs('fullSign', false, 'A car left: FULL must go off', { for: 100 }),
          ...send('spawn_entry', 1),
          expectObs('carsEntered', 13, 'There is a free space again: the next car must get in', { within: 15_000 }),
          expectObs('fullSign', true, 'Full again: FULL must light', { within: 150, for: 300 }),
        ],
      },
      {
        name: 'Attendant reset',
        description: 'The count was zeroed with two cars still parked: they leave, the count drifts below zero, the attendant fixes it.',
        steps: [
          ...manualGarage(2),
          ...send('spawn_exit', 2),
          expectObs('carsExited', 2, 'Both overnight cars must be able to leave', { within: 30_000 }),
          expectObs('openSign', true, 'SPACES must be lit (the garage is empty)', { within: 150 }),
          tap('reset_key', 300),
          expectTag('Car_Count.ACC', 0, 'The attendant key must reset Car_Count to 0', { within: 50, for: 500 }),
          ...send('spawn_entry', 1),
          expectObs('carsEntered', 1, 'A new car must get in', { within: 15_000 }),
          expectTag('Car_Count.ACC', 1, 'One car in after the reset: Car_Count.ACC must be 1', { within: 100, for: 500 }),
          tap('reset_key', 300),
          expectTag('Car_Count.ACC', 0, 'The attendant key must reset Car_Count to 0', { within: 50, for: 500 }),
        ],
      },
    ],
    invariants: [
      NO_GATE_HITS,
      { observe: 'carsInside', max: 12, message: 'A 13th car got in: never raise the entry gate when the garage is full' },
      {
        when: { observe: 'fullSign', equals: true },
        observe: 'openSign',
        equals: false,
        graceMs: 10,
        message: 'FULL and SPACES must never be lit together',
      },
      {
        when: { observe: 'fullSign', equals: false },
        observe: 'openSign',
        equals: true,
        graceMs: 20,
        message: 'One of the signs must always be lit: SPACES whenever the garage is not full',
      },
    ],
    parInstructions: 23,
    allowedInstructions: COUNT_PALETTE,
    requiredInstructions: ['CTU', 'CTD'],
    debrief: `One COUNTER, two instructions: the CTU counts cars in, the CTD counts them out, and \`.DN\` (ACC ≥ PRE) is the
FULL sign. And the full interlock went on the **ticket** leg only — put it in series with the seal and, with
an up-count on the rising edge of the eye, the 12th car's own count would drop the arm on its roof.

**Field tip:** occupancy counters always drift — a car tailgates, a loop fails, someone drives out the
entrance. That's why real systems have an attendant correction (like your reset key, or +1 / −1 buttons on the
HMI) and why the count is often re-synchronised at night when the garage is known to be empty.`,
  },
];
