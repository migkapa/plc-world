/**
 * Chapter 5 — Analog & Math (scenes 'tank-process' and 'trainer'): REAL tags and compares, MOV / CPT /
 * ADD / DIV, scaling with SCP and clamping, a GEQ bar graph with a LIM-style band alarm, and a thermostat
 * boss with level and temperature hysteresis.
 * Mission ids '5-1' … '5-5'. See docs/CURRICULUM.md for the authoring guide.
 */
import type { MissionDef, MissionInvariant, TestStep } from '../types';
import { expectObs, expectObsRange, expectTag, press, release, set, tap, wait } from './authoring';

// --- palettes -----------------------------------------------------------------
const BITS = ['XIC', 'XIO', 'OTE', 'OTL', 'OTU'];
const COMPARES = ['EQU', 'NEQ', 'LES', 'LEQ', 'GRT', 'GEQ', 'LIM'];
const MATH = ['MOV', 'ADD', 'SUB', 'MUL', 'DIV', 'CPT'];

// --- shared invariants ------------------------------------------------------------
const NO_SPILL: MissionInvariant = {
  observe: 'spills',
  max: 0,
  message: 'The tank overflowed — product all over the floor',
};
const NO_DRY_HEAT: MissionInvariant = {
  observe: 'dryHeatMs',
  max: 0,
  message: 'The heater was ON with its element uncovered (level below LSL-101) — that burns the element out',
};
const NO_DRY_RUN: MissionInvariant = {
  observe: 'dryRunMs',
  max: 0,
  message: 'The agitator ran in an (almost) empty tank — that wrecks the shaft seal',
};

// --- step helpers -------------------------------------------------------------------
/** Analog value (observable) settles within ±tol of `value` within 100 ms and holds it for `hold` ms. */
const reads = (id: string, value: number, message: string, tol = 0.01, hold = 200): TestStep =>
  expectObsRange(id, { min: value - tol, max: value + tol }, message, { within: 100, for: hold });

/** Set both trainer pots. */
const pots = (p1: number, p2: number): TestStep[] => [set('pot1', p1), set('pot2', p2)];

/** 5-4: the full bar-graph pattern for one pot position (n lamps lit from Light_0 up, buzzer state). */
function barAt(pot: number, lit: number, buzzer: boolean): TestStep[] {
  const steps: TestStep[] = [set('pot1', pot), wait(100)];
  for (let i = 0; i < 8; i++) {
    const on = i < lit;
    steps.push(
      expectObs(
        `light${i}`,
        on,
        `Pot_1 = ${pot} %: ${lit === 0 ? 'no lamp' : lit === 1 ? 'only Light_0' : `Light_0 … Light_${lit - 1}`} should be lit — Light_${i} must be ${on ? 'ON' : 'OFF'}`,
      ),
    );
  }
  steps.push(
    expectObs('buzzer', buzzer, `Pot_1 = ${pot} %: the Buzzer must be ${buzzer ? 'ON (outside the 10–90 % band)' : 'OFF (inside the 10–90 % band)'}`),
  );
  return steps;
}

export const CH5_MISSIONS: MissionDef[] = [
  // -------------------------------------------------------------------------
  {
    id: '5-1',
    chapter: 'analog',
    order: 1,
    title: 'Level Watch',
    tagline: 'Your first analog signal: fill the tank to 80 % and stop.',
    kind: 'build',
    sceneId: 'tank-process',
    difficulty: 2,
    xp: 110,
    briefing: `Welcome to the **process side** of Riverside Manufacturing. Tank **T-101** is a 2000 L stainless mixing
tank, and until now the operators filled it by hand — last Friday somebody went for coffee and 200 L of syrup
ended up on the floor. Dana: *"Switches only tell you yes or no. A level **transmitter** tells you how much.
Time you learned to read a number."*

**The hardware**
- \`LT_101\` → \`Local:3:I.Ch0Data\` — radar level transmitter, 4–20 mA into a **1756-IF8**. The channel is configured to scale the signal to **0.0–100.0 %** — a **REAL** tag (with a little noise, like any real transmitter).
- \`Fill_Valve\` → \`Local:2:O.Data.0\` — XV-101 inlet on/off valve (fills 4.5 % per second while open).
- \`Start_PB\` → \`Local:1:I.Data.0\` — **N.O.**: 1 only while pressed.
- \`Stop_PB\` → \`Local:1:I.Data.1\` — **N.C.**: **1 when NOT pressed**, 0 while pressed.

**Your task**
- **Start** opens \`Fill_Valve\`, and it stays open after Start is released.
- The valve closes by itself when \`LT_101\` reaches **80 %** — and stays closed.
- **Stop** closes it at any time; Stop wins over Start.
- Pressing Start on a tank that is already at 80 % does **nothing**.

Compare instructions (**LES**, **GEQ**, …) work like contacts: they are *true* when the comparison is true.`,
    objectives: [
      'Start opens Fill_Valve and it stays open (seal-in)',
      'Fill_Valve closes when LT_101 reaches 80 %',
      'Stop (N.C.) closes the valve; Stop wins',
      'Start does nothing on a tank that is already at 80 %',
      'The tank never overflows',
    ],
    objectiveTests: [
      [0, { test: 1, steps: [2, 3] }, { test: 2, steps: [2, 8] }],
      [{ test: 1, steps: [4, 5, 6, 7] }, { invariant: 1 }],
      [{ test: 2, steps: [5, 6] }, 3],
      [4],
      [{ invariant: 0 }],
    ],
    concepts: ['LES', 'GEQ', 'XIC', 'OTE'],
    starter: {
      rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)OTE(Fill_Valve);'],
      comments: ['Fill valve XV-101 — start/stop only. Nothing stops it when the tank is full!'],
    },
    solution: { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)LES(LT_101,80.0)OTE(Fill_Valve);'] },
    hints: [
      'You already have a seal-in. What extra condition must be true for the valve to stay open? Put it where it breaks BOTH the Start path and the seal path — like Stop.',
      'Add a compare instruction in **series after the branch**: the valve may be open only while the level is **less than** 80 %. `LES(LT_101,80.0)` is true while LT_101 < 80.0.',
      '`[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)LES(LT_101,80.0)OTE(Fill_Valve);`',
    ],
    tests: [
      {
        name: 'Valve stays closed at power-up',
        steps: [wait(300), expectObs('fillValve', false, 'Fill_Valve must stay closed until someone presses Start', { for: 1000 })],
      },
      {
        name: 'Start fills the tank to 80 %',
        steps: [
          wait(200),
          tap('start'),
          expectObs('fillValve', true, 'Pressing Start must open Fill_Valve', { within: 150 }),
          expectObs('fillValve', true, 'Fill_Valve must stay open after Start is released — add a seal-in', { for: 3000 }),
          expectObs('fillValve', false, 'Fill_Valve must close when LT_101 reaches 80 %', { within: 20000 }),
          expectObsRange('level', { min: 79.5, max: 80.5 }, 'The valve must close at 80 % — not earlier, not later'),
          expectObs('fillValve', false, 'Once the tank is at 80 % the valve must stay closed', { for: 3000 }),
          expectObsRange('level', { min: 79.5, max: 80.5 }, 'The level must stay at 80 %'),
        ],
      },
      {
        name: 'Stop closes the valve',
        steps: [
          wait(200),
          tap('start'),
          expectObs('fillValve', true, 'Start must open Fill_Valve', { within: 150 }),
          wait(1000),
          tap('stop'),
          expectObs('fillValve', false, 'Stop must close Fill_Valve', { within: 150 }),
          expectObs('fillValve', false, 'Fill_Valve must stay closed after Stop is released', { for: 1500 }),
          tap('start'),
          expectObs('fillValve', true, 'Start must re-open Fill_Valve after a stop (the tank is not full)', { within: 150, for: 500 }),
        ],
      },
      {
        name: 'Stop wins',
        steps: [
          wait(200),
          press('stop'),
          tap('start', 300),
          expectTag('Fill_Valve', false, 'With Stop held, Start must not open the valve', { for: 300 }),
          release('stop'),
          expectTag('Fill_Valve', false, 'Releasing Stop must not open the valve', { for: 1000 }),
          press('start'),
          wait(200),
          press('stop'),
          expectTag('Fill_Valve', false, 'With Start AND Stop both held, Stop must win', { within: 30, for: 500 }),
          release('start'),
          release('stop'),
          expectTag('Fill_Valve', false, 'After both buttons are released the valve must stay closed', { for: 1000 }),
        ],
      },
      {
        name: 'A full tank is not refilled',
        steps: [
          wait(200),
          tap('start'),
          expectObs('fillValve', false, 'Fill_Valve must close at 80 %', { within: 20000 }),
          wait(500),
          press('start'),
          wait(500),
          release('start'),
          expectObsRange('level', { max: 80.5 }, 'The tank is already at 80 %: Start must not fill it any further', { for: 1000 }),
          expectObs('fillValve', false, 'The valve must stay closed on a full tank', { within: 150, for: 1000 }),
        ],
      },
    ],
    invariants: [
      NO_SPILL,
      {
        when: { tag: 'LT_101', min: 80.5 },
        tag: 'Fill_Valve',
        equals: false,
        graceMs: 20,
        message: 'Fill_Valve must be closed whenever LT_101 is above 80 %',
      },
    ],
    parInstructions: 5,
    allowedInstructions: [...BITS, ...COMPARES],
    debrief: `Your first analog interlock! \`LT_101\` is a **REAL** — a floating-point number — and compare instructions turn
it into a true/false condition you can put on a rung like any contact.

Notice the valve closes at 80.0 % and the level ends a hair above it: the transmitter reading, the scan and
the valve are never perfectly in step. That's why real setpoints always leave **margin** to the physical limit.

**Field tip:** a transmitter can fail — an open 4–20 mA loop reads 0 % and would open the fill valve *forever*.
That's why tanks also get independent **high / high-high level switches**, wired so a broken wire means "full"
(N.C., fail-safe). You'll meet that in chapter 7.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '5-2',
    chapter: 'analog',
    order: 2,
    title: 'Meter Madness',
    tagline: 'MOV a value, then compute an average — the REAL way.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 2,
    xp: 110,
    briefing: `Back on the trainer bench. Its two potentiometers and two analog displays are wired to a **1756-IF8**
analog input card and a **1756-OF8** analog output card, both scaled to **0.0–100.0 %**. Dana wants a quick
display for the operators: one meter shows a sensor directly, the other shows the **average** of two sensors
(redundant temperature probes are averaged exactly like this).

**The hardware**
- \`Pot_1\` → \`Local:3:I.Ch0Data\`, \`Pot_2\` → \`Local:3:I.Ch1Data\` — potentiometers, **REAL** 0–100 %.
- \`Meter_1\` → \`Local:4:O.Ch0Data\` — analog panel meter, **REAL** 0–100 %.
- \`Meter_2\` → \`Local:4:O.Ch1Data\` — LED bar-graph display, **REAL** 0–100 %.
- \`Pot_Sum\` (REAL) — a spare internal tag, in case you want to ADD first and DIVide after.

**Your task**
- \`Meter_1\` always shows \`Pot_1\` (use **MOV**).
- \`Meter_2\` always shows the average **(Pot_1 + Pot_2) / 2** — with **CPT**, or with ADD and DIV.
- Both update continuously. Keep the decimals: 33.3 % and 40 % must average to **36.65 %**, not 36.5 %.

A box instruction on a rung by itself (no contacts) executes on every scan.`,
    objectives: [
      'Meter_1 follows Pot_1 (MOV)',
      'Meter_2 shows (Pot_1 + Pot_2) / 2',
      'No lost decimals: REAL math all the way',
      'Both meters update continuously',
    ],
    objectiveTests: [
      [0, { test: 2, observe: ['meter1'] }],
      [1, { test: 2, observe: ['meter2'] }],
      [{ test: 0, steps: [4, 6] }, { test: 1, steps: [6, 9] }],
      [2],
    ],
    concepts: ['MOV', 'CPT', 'ADD', 'DIV'],
    starter: {
      rungs: ['', ''],
      comments: ['Meter 1 = Pot 1', 'Meter 2 = average of Pot 1 and Pot 2'],
      tags: [{ name: 'Pot_Sum', dataType: 'REAL', description: 'Spare REAL for intermediate math' }],
    },
    solution: { rungs: ['MOV(Pot_1,Meter_1);', 'CPT(Meter_2,(Pot_1+Pot_2)/2.0);'] },
    hints: [
      'MOV copies Source into Dest on every scan its rung is true. For the average you need an addition and a division — CPT can do both in one expression.',
      'Watch the order of operations: `Pot_1+Pot_2/2` divides only Pot_2! Use parentheses. And keep every intermediate value in a **REAL** — a DINT would round the decimals away.',
      '`MOV(Pot_1,Meter_1);` and `CPT(Meter_2,(Pot_1+Pot_2)/2.0);` — or `ADD(Pot_1,Pot_2,Pot_Sum);` followed by `DIV(Pot_Sum,2.0,Meter_2);`',
    ],
    tests: [
      {
        name: 'Meter_1 follows Pot_1',
        steps: [
          wait(100),
          set('pot1', 25),
          reads('meter1', 25, 'Pot_1 = 25 %: Meter_1 must show 25 %'),
          set('pot1', 73.4),
          reads('meter1', 73.4, 'Pot_1 = 73.4 %: Meter_1 must show 73.4 % (keep the decimals)'),
          set('pot2', 60),
          reads('meter1', 73.4, 'Pot_2 must not change Meter_1', 0.01, 300),
          set('pot1', 100),
          reads('meter1', 100, 'Pot_1 = 100 %: Meter_1 must show 100 %'),
          set('pot1', 0),
          reads('meter1', 0, 'Pot_1 = 0 %: Meter_1 must show 0 %'),
        ],
      },
      {
        name: 'Meter_2 shows the average',
        steps: [
          wait(100),
          ...pots(20, 60),
          reads('meter2', 40, 'Pot_1 = 20 %, Pot_2 = 60 %: Meter_2 must show the average, 40 %'),
          ...pots(33.3, 40),
          reads('meter2', 36.65, 'Pot_1 = 33.3 %, Pot_2 = 40 %: Meter_2 must show 36.65 % — REAL math, no rounding'),
          ...pots(12.5, 0),
          reads('meter2', 6.25, 'Pot_1 = 12.5 %, Pot_2 = 0 %: Meter_2 must show 6.25 %'),
          ...pots(100, 0),
          reads('meter2', 50, 'Pot_1 = 100 %, Pot_2 = 0 %: Meter_2 must show 50 %'),
          ...pots(0, 100),
          reads('meter2', 50, 'Pot_1 = 0 %, Pot_2 = 100 %: Meter_2 must show 50 %'),
          ...pots(100, 100),
          reads('meter2', 100, 'Both pots at 100 %: Meter_2 must show 100 %'),
          ...pots(0, 0),
          reads('meter2', 0, 'Both pots at 0 %: Meter_2 must show 0 %'),
        ],
      },
      {
        name: 'Both meters track a moving pot',
        description: 'Pot_1 sweeps from 0 to 100 % while Pot_2 sits at 50 %.',
        steps: [
          wait(100),
          set('pot2', 50),
          ...[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].flatMap((p): TestStep[] => [
            set('pot1', p),
            reads('meter1', p, `Pot_1 = ${p} %: Meter_1 must follow`, 0.01, 50),
            reads('meter2', (p + 50) / 2, `Pot_1 = ${p} %, Pot_2 = 50 %: Meter_2 must show ${(p + 50) / 2} %`, 0.01, 50),
          ]),
        ],
      },
    ],
    parInstructions: 3,
    allowedInstructions: [...MATH, 'XIC', 'XIO', 'OTE'],
    debrief: `**MOV** and **CPT** are the workhorses of analog programming. Two traps you just avoided:

- **Order of operations** — \`Pot_1+Pot_2/2\` is *not* an average; CPT follows normal math precedence.
- **Data types** — Logix picks REAL math only if a source or the destination is REAL. Park the sum in a DINT and 73.3 silently becomes 73 (Logix rounds, half to even), and your average is off by 0.15 %.

**Field tip:** averaging two redundant transmitters is common, but a good program also *compares* them: if they
disagree by more than a few percent, one of them is lying — raise a deviation alarm instead of averaging
garbage.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '5-3',
    chapter: 'analog',
    order: 3,
    title: 'Scale It',
    tagline: 'SCP a worn pot onto a safe speed range — and clamp it.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 3,
    xp: 150,
    briefing: `The bottling line's conveyor runs on a **PowerFlex 525** drive, and the operator sets its speed with a
potentiometer. Two problems, says Gus: the pot is **worn at both ends** (below 10 % and above 90 % it jumps
around), and the conveyor must never run slower than **20 %** (the motor's shaft fan stops cooling it) or faster
than **80 %** (bottles fall over). You'll prototype the speed-reference logic on the trainer.

**The hardware**
- \`Pot_1\` → \`Local:3:I.Ch0Data\` — the speed pot, **REAL** 0–100 %.
- \`Meter_1\` → \`Local:4:O.Ch0Data\` — stands in for the drive's analog speed reference, **REAL** 0–100 %.
- \`Speed_Ref\` (REAL) — an internal tag for your calculation.

**Your task**
- Map the usable pot range **10 … 90 %** linearly onto the speed reference **20 … 80 %**: Pot_1 = 10 → 20 %, Pot_1 = 50 → 50 %, Pot_1 = 90 → 80 %.
- **Clamp** it: below 10 % the reference stays at **20 %**, above 90 % it stays at **80 %**.
- Use **SCP** (Scale with Parameters) for the scaling. SCP does **not** clamp — it happily extrapolates
  (Pot_1 = 0 would give 12.5 %), so the limits are up to you.`,
    objectives: [
      'Pot_1 10…90 % scales linearly to Meter_1 20…80 % (SCP)',
      'Below 10 % Meter_1 holds 20 %',
      'Above 90 % Meter_1 holds 80 %',
    ],
    objectiveTests: [
      [0, 3],
      [1],
      [2],
    ],
    concepts: ['SCP', 'LES', 'GRT', 'MOV'],
    starter: {
      rungs: ['', '', '', ''],
      comments: ['Scale the pot (SCP)', 'Minimum speed clamp', 'Maximum speed clamp', 'Speed reference to the drive'],
      tags: [{ name: 'Speed_Ref', dataType: 'REAL', description: 'Conveyor speed reference (%)' }],
    },
    solution: {
      rungs: [
        'SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref);',
        'LES(Speed_Ref,20.0)MOV(20.0,Speed_Ref);',
        'GRT(Speed_Ref,80.0)MOV(80.0,Speed_Ref);',
        'MOV(Speed_Ref,Meter_1);',
      ],
    },
    hints: [
      'SCP needs six operands: Input, Input Min, Input Max, Scaled Min, Scaled Max, Output. Which input range maps onto which output range?',
      '`SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref)` does the linear part. Then two compare-and-MOV rungs clamp it: if Speed_Ref is below 20, MOV 20 into it; if above 80, MOV 80. Finally MOV Speed_Ref to Meter_1. Rung order matters!',
      '`SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref);` `LES(Speed_Ref,20.0)MOV(20.0,Speed_Ref);` `GRT(Speed_Ref,80.0)MOV(80.0,Speed_Ref);` `MOV(Speed_Ref,Meter_1);`',
    ],
    tests: [
      {
        name: 'The usable range scales linearly',
        steps: [
          wait(100),
          set('pot1', 10),
          reads('meter1', 20, 'Pot_1 = 10 %: the speed reference must be 20 %'),
          set('pot1', 50),
          reads('meter1', 50, 'Pot_1 = 50 %: the speed reference must be 50 %'),
          set('pot1', 90),
          reads('meter1', 80, 'Pot_1 = 90 %: the speed reference must be 80 %'),
          set('pot1', 30),
          reads('meter1', 35, 'Pot_1 = 30 %: the speed reference must be 35 %'),
          set('pot1', 75),
          reads('meter1', 68.75, 'Pot_1 = 75 %: the speed reference must be 68.75 % (keep the decimals)'),
          set('pot1', 33.3),
          reads('meter1', 37.475, 'Pot_1 = 33.3 %: the speed reference must be 37.475 %'),
        ],
      },
      {
        name: 'Minimum speed clamp',
        steps: [
          wait(100),
          set('pot1', 9.9),
          reads('meter1', 20, 'Pot_1 = 9.9 %: below the usable range the reference must be clamped to 20 %'),
          set('pot1', 5),
          reads('meter1', 20, 'Pot_1 = 5 %: the reference must stay at 20 %'),
          set('pot1', 0),
          reads('meter1', 20, 'Pot_1 = 0 %: the reference must stay at 20 % — SCP alone would give 12.5 %', 0.01, 500),
        ],
      },
      {
        name: 'Maximum speed clamp',
        steps: [
          wait(100),
          set('pot1', 90.1),
          reads('meter1', 80, 'Pot_1 = 90.1 %: above the usable range the reference must be clamped to 80 %'),
          set('pot1', 95),
          reads('meter1', 80, 'Pot_1 = 95 %: the reference must stay at 80 %'),
          set('pot1', 100),
          reads('meter1', 80, 'Pot_1 = 100 %: the reference must stay at 80 % — SCP alone would give 87.5 %', 0.01, 500),
        ],
      },
      {
        name: 'Sweep down and up',
        description: 'The pot is turned from 100 % to 0 % and back: the reference must follow without sticking at a clamp.',
        steps: [
          wait(100),
          ...[100, 80, 60, 40, 20, 0, 20, 40, 60, 80, 100].flatMap((p): TestStep[] => {
            const ref = p <= 10 ? 20 : p >= 90 ? 80 : 20 + (p - 10) * 0.75;
            return [set('pot1', p), reads('meter1', ref, `Pot_1 = ${p} %: the speed reference must be ${ref} %`, 0.01, 50)];
          }),
        ],
      },
    ],
    parInstructions: 6,
    allowedInstructions: [...BITS, ...COMPARES, ...MATH, 'SCP'],
    requiredInstructions: ['SCP'],
    debrief: `**SCP** does \`Out = (In − InMin) × (ScaledMax − ScaledMin) / (InMax − InMin) + ScaledMin\` — the straight line
through two points. It never clamps, so an input outside its range produces an output outside yours.

You also computed into an **internal tag** and wrote the output **once**. That is not just tidy: a ControlLogix
sends output data to its I/O modules on the **RPI**, asynchronously to the program scan. If you write
\`Meter_1\` three times in one scan, the module could pick up the *unclamped* value in between.

**Field tip:** 4–20 mA has built-in diagnostics — below ~3.6 mA the wire is broken, above ~21 mA the device is
faulted. Scale *and* clamp every analog input, and alarm on the module's under/over-range bits instead of
feeding nonsense to a drive.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '5-4',
    chapter: 'analog',
    order: 4,
    title: 'Bar Graph',
    tagline: 'Eight pilot lights, one analog value, a band alarm.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 3,
    xp: 140,
    briefing: `The night-shift operators on the syrup line can't read the small HMI from the forklift. Gus has an idea:
a column of **eight pilot lights** as a giant level bar graph, plus a **buzzer** when the level leaves the
safe band. You prototype it on the trainer, with \`Pot_1\` playing the tank level.

**The hardware**
- \`Pot_1\` → \`Local:3:I.Ch0Data\` — **REAL** 0–100 %.
- \`Light_0\` … \`Light_7\` → \`Local:2:O.Data.0\` … \`.7\` — pilot lights (0–1 green, 2–3 amber, 4–5 red, 6–7 blue).
- \`Buzzer\` → \`Local:2:O.Data.8\`.

**Your task**
- Each lamp is worth **12.5 %**: \`Light_n\` is ON when \`Pot_1 ≥ 12.5 × (n + 1)\`. So 12.5 % lights \`Light_0\` only, 50 % lights \`Light_0\` … \`Light_3\`, and only a full 100 % lights all eight.
- The \`Buzzer\` sounds while the level is **outside the 10–90 % band** (below 10 % the pump could run dry, above 90 % the tank is about to overflow).
- Lamps go off again when the level drops.

**GEQ** is *Greater than or Equal*. **LIM** (*Limit Test*) is true when Low ≤ Test ≤ High — and when you give it a
Low Limit **greater** than its High Limit it tests *outside* the band instead.`,
    objectives: [
      'Light_n ON when Pot_1 ≥ 12.5 × (n + 1) %',
      'Exactly on a boundary (12.5 %, 62.5 %) the lamp is ON',
      'Buzzer ON below 10 % or above 90 %',
      'Lamps turn off again when the level falls',
    ],
    objectiveTests: [
      [{ test: 0, observe: ['light0', 'light1', 'light2', 'light3', 'light4', 'light5', 'light6', 'light7'] }, { test: 2, observe: ['light0', 'light1', 'light2', 'light3', 'light4', 'light5', 'light6', 'light7'] }],
      [{ test: 0, steps: [14, 37, 60, 72, 95, 118, 130, 164] }],
      [{ test: 0, observe: ['buzzer'] }, { test: 1, observe: ['buzzer'] }, { test: 2, observe: ['buzzer'] }],
      [{ test: 1, observe: ['light0', 'light1', 'light2', 'light3', 'light4', 'light5', 'light6', 'light7'] }],
    ],
    concepts: ['GEQ', 'LIM', 'LES', 'GRT'],
    starter: {
      rungs: ['GEQ(Pot_1,12.5)OTE(Light_0);', '', '', '', '', '', '', '', ''],
      comments: ['Bar graph: 12.5 % per lamp. Light_0 done, seven to go…', '', '', '', '', '', '', '', 'Level alarm: outside 10–90 %'],
    },
    solution: {
      rungs: [
        'GEQ(Pot_1,12.5)OTE(Light_0);',
        'GEQ(Pot_1,25.0)OTE(Light_1);',
        'GEQ(Pot_1,37.5)OTE(Light_2);',
        'GEQ(Pot_1,50.0)OTE(Light_3);',
        'GEQ(Pot_1,62.5)OTE(Light_4);',
        'GEQ(Pot_1,75.0)OTE(Light_5);',
        'GEQ(Pot_1,87.5)OTE(Light_6);',
        'GEQ(Pot_1,100.0)OTE(Light_7);',
        '[LES(Pot_1,10.0),GRT(Pot_1,90.0)]OTE(Buzzer);',
      ],
    },
    hints: [
      'One rung per lamp. Each rung compares Pot_1 against that lamp\'s threshold: 12.5, 25, 37.5 … 100.',
      '"At least" means **GEQ**, not GRT — at exactly 12.5 % the first lamp must be on. For the buzzer, two compares in **parallel** (OR): below 10 or above 90. Or one LIM with the limits swapped.',
      '`GEQ(Pot_1,25.0)OTE(Light_1);` … `GEQ(Pot_1,100.0)OTE(Light_7);` and `[LES(Pot_1,10.0),GRT(Pot_1,90.0)]OTE(Buzzer);` (or `LIM(90.0,Pot_1,10.0)OTE(Buzzer);`)',
    ],
    tests: [
      {
        name: 'Bar graph going up',
        steps: [
          wait(100),
          ...barAt(12.4, 0, false),
          ...barAt(12.5, 1, false),
          ...barAt(20, 1, false),
          ...barAt(25, 2, false),
          ...barAt(37.4, 2, false),
          ...barAt(37.5, 3, false),
          ...barAt(50, 4, false),
          ...barAt(62.4, 4, false),
          ...barAt(62.5, 5, false),
          ...barAt(74.9, 5, false),
          ...barAt(75, 6, false),
          ...barAt(87.5, 7, false),
          ...barAt(89.9, 7, false),
          ...barAt(99.9, 7, true),
          ...barAt(100, 8, true),
          expectObs('light7', true, 'At 100 % all eight lamps must stay lit', { for: 300 }),
        ],
      },
      {
        name: 'Bar graph going down',
        steps: [
          wait(100),
          ...barAt(100, 8, true),
          ...barAt(60, 4, false),
          ...barAt(30, 2, false),
          ...barAt(12.6, 1, false),
          ...barAt(0, 0, true),
          expectObs('light0', false, 'At 0 % every lamp must stay dark', { for: 300 }),
        ],
      },
      {
        name: 'Level alarm band',
        steps: [
          wait(100),
          ...barAt(0, 0, true),
          ...barAt(5, 0, true),
          ...barAt(9.9, 0, true),
          ...barAt(10.1, 0, false),
          ...barAt(50, 4, false),
          ...barAt(89.9, 7, false),
          ...barAt(90.1, 7, true),
          expectObs('buzzer', true, 'Above 90 % the buzzer must keep sounding', { for: 500 }),
          ...barAt(70, 5, false),
          expectObs('buzzer', false, 'Back inside the band the buzzer must stay quiet', { for: 500 }),
        ],
      },
    ],
    parInstructions: 19,
    allowedInstructions: [...BITS, ...COMPARES, ...MATH],
    debrief: `Eight compares, one analog value — the same trick drives stack lights, level columns and "zone" indicators
all over a plant. And you met **LIM**'s hidden talent: with Low > High it tests *outside* a band.

Did you notice the boundary tests? 12.5 % is exactly representable as a REAL, so GEQ and GRT really do
behave differently there. With values like 0.1 (not exact in binary floating point) **never** test REALs for
exact equality — use GEQ/LEQ or a small window with LIM.

**Field tip:** a buzzer that toggles every time a noisy level wobbles across 90.0 % drives operators mad —
real alarms get a **deadband** (on above 90, off below 88). That's the next lesson.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '5-5',
    chapter: 'analog',
    order: 5,
    title: 'Thermostat',
    tagline: 'Boss: fill, mix and hold 58–62 °C — without chatter and never dry.',
    kind: 'boss',
    sceneId: 'tank-process',
    difficulty: 5,
    xp: 350,
    briefing: `The CIP (clean-in-place) skid needs a **hot-water buffer**: tank T-101 must hold water at **60 °C ± 2** all
shift. The heater contactor is rated for a limited number of operations, so the plant engineer's spec is
explicit: **hysteresis**, not a single setpoint that chatters on and off every scan.

**The hardware** (tank T-101)
- \`Start_PB\` (**N.O.**), \`Stop_PB\` (**N.C.**: 1 when not pressed), \`EStop_OK\` (**N.C.**: 1 = released).
- \`LT_101\` — level, **REAL** 0–100 %. \`TT_101\` → \`Local:3:I.Ch1Data\` — temperature, **REAL** °C.
- \`LSL_101\` → \`Local:1:I.Data.2\` — low level switch, 1 when the level is ≥ 10 % (heater element covered).
- \`Fill_Valve\` (4.5 %/s of 15 °C water), \`Drain_Valve\` (5 %/s), \`Heater\` (full power), \`Mixer\` (agitator starter), \`Running_Light\` (amber).
- \`Mixer_Running\` → \`Local:1:I.Data.5\` — agitator starter auxiliary contact, **N.O.** (≈ 100 ms after \`Mixer\`). The E-stop's second contact is hardwired in the **agitator** circuit only — **not** in the heater or the valves.
- \`Discharge_PB\` (**N.O.**) — the CIP skid draws hot water while it is held.
- \`System_On\` (BOOL) — an internal tag for the running state.

**Functional specification**
1. **Start** / **Stop** / **E-stop** control \`System_On\` (seal-in, Stop wins, no restart after an E-stop). \`Running_Light\` = \`System_On\`.
2. **Level:** while running, \`Fill_Valve\` opens when \`LT_101\` < **50 %** and closes at **60 %** (hysteresis).
3. **Discharge:** \`Drain_Valve\` is open while \`Discharge_PB\` is held (running or not).
4. **Mixer:** runs while the system is on and \`LT_101\` ≥ **20 %** and \`LSL_101\` is made.
5. **Heater:** only while the \`Mixer\` is commanded **and** proven running (\`Mixer_Running\`). Then: **ON below 58 °C, OFF above 62 °C**, and in between it keeps doing what it was doing.
6. Stop and the E-stop drop the heater and the fill valve **immediately**. Never overflow, never heat or mix dry.`,
    objectives: [
      'Start / Stop / E-stop run the system; Running_Light',
      'Fill valve: open below 50 %, close at 60 % (level hysteresis)',
      'Drain valve while Discharge is held',
      'Mixer only with ≥ 20 % level',
      'Heater only while the mixer is proven running',
      'Heater ON below 58 °C, OFF above 62 °C (temperature hysteresis)',
    ],
    objectiveTests: [
      [{ test: 0, steps: [4] }, { test: 1, steps: [2, 7] }, 5, { invariant: 5 }, { invariant: 6 }, { invariant: 7 }],
      [{ test: 0, steps: [1] }, { test: 1, steps: [3, 4, 5, 6] }, { test: 2, steps: [2, 6, 7, 8, 11, 12, 13] }, { invariant: 0 }],
      [{ test: 2, steps: [5, 10] }],
      [{ test: 0, steps: [3] }, { test: 3, steps: [2, 4, 5] }, { invariant: 2 }],
      [{ test: 0, steps: [2] }, { test: 3, steps: [3, 6] }, { invariant: 1 }, { invariant: 4 }],
      [4, { invariant: 3 }],
    ],
    concepts: ['LES', 'GEQ', 'LEQ', 'XIC', 'OTE'],
    starter: {
      rungs: [
        '[XIC(Start_PB),XIC(System_On)]XIC(Stop_PB)XIC(EStop_OK)OTE(System_On);',
        'XIC(System_On)OTE(Running_Light);',
        'XIC(System_On)LES(LT_101,60.0)OTE(Fill_Valve);',
        'XIC(Discharge_PB)OTE(Drain_Valve);',
        '',
        '',
      ],
      comments: [
        'System on/off (seal-in)',
        'RUNNING pilot light',
        'Fill valve XV-101 — TODO: no hysteresis yet, it chatters at 60 %',
        'Drain valve XV-102 while Discharge is held',
        'Agitator M-101',
        'Heater — thermostat 58/62 °C',
      ],
      tags: [{ name: 'System_On', dataType: 'BOOL', description: 'Hot-water buffer in service' }],
    },
    solution: {
      rungs: [
        '[XIC(Start_PB),XIC(System_On)]XIC(Stop_PB)XIC(EStop_OK)OTE(System_On);',
        'XIC(System_On)OTE(Running_Light);',
        'XIC(System_On)[LES(LT_101,50.0),XIC(Fill_Valve)]LES(LT_101,60.0)OTE(Fill_Valve);',
        'XIC(Discharge_PB)OTE(Drain_Valve);',
        'XIC(System_On)GEQ(LT_101,20.0)XIC(LSL_101)OTE(Mixer);',
        'XIC(Mixer)XIC(Mixer_Running)[LES(TT_101,58.0),XIC(Heater)]LEQ(TT_101,62.0)OTE(Heater);',
      ],
    },
    hints: [
      'Hysteresis is a **seal-in on an analog condition**: one compare turns the output ON, the output\'s own contact holds it, and a second compare (in series after the branch) turns it OFF.',
      'Fill: `[LES(LT_101,50.0),XIC(Fill_Valve)]LES(LT_101,60.0)` after `XIC(System_On)`. Heater: the same shape with 58 and 62 °C, behind `XIC(Mixer)XIC(Mixer_Running)`. The mixer rung needs `GEQ(LT_101,20.0)` and `XIC(LSL_101)`.',
      '`XIC(System_On)[LES(LT_101,50.0),XIC(Fill_Valve)]LES(LT_101,60.0)OTE(Fill_Valve);` `XIC(System_On)GEQ(LT_101,20.0)XIC(LSL_101)OTE(Mixer);` `XIC(Mixer)XIC(Mixer_Running)[LES(TT_101,58.0),XIC(Heater)]LEQ(TT_101,62.0)OTE(Heater);`',
    ],
    tests: [
      {
        name: 'Power-up: everything off',
        steps: [
          wait(300),
          expectObs('fillValve', false, 'Nothing may open before Start is pressed', { for: 1000 }),
          expectObs('heaterOn', false, 'The heater must be off at power-up'),
          expectObs('mixerRunning', false, 'The mixer must be off at power-up'),
          expectObs('runningLight', false, 'RUNNING must be off at power-up'),
        ],
      },
      {
        name: 'Start fills to 60 % and holds',
        steps: [
          wait(200),
          tap('start'),
          expectObs('runningLight', true, 'Start must turn the system on (Running_Light)', { within: 150 }),
          expectObs('fillValve', true, 'The empty tank must start filling', { within: 150 }),
          expectObs('fillValve', false, 'Fill_Valve must close when the level reaches 60 %', { within: 16000 }),
          expectObsRange('level', { min: 59.5, max: 60.6 }, 'The fill must stop at 60 %'),
          expectObs('fillValve', false, 'The valve must stay closed at 60 %', { for: 3000 }),
          expectObs('runningLight', true, 'The system must keep running', { for: 200 }),
        ],
      },
      {
        name: 'Level hysteresis 50 / 60 %',
        description: 'The CIP skid draws water: the tank refills only below 50 %, and then all the way to 60 %.',
        steps: [
          wait(200),
          tap('start'),
          expectObs('fillValve', false, 'Fill_Valve must close at 60 %', { within: 16000 }),
          wait(500),
          press('discharge'),
          expectObs('drainValve', true, 'Holding Discharge_PB must open Drain_Valve', { within: 150 }),
          expectObs('fillValve', false, 'Between 50 and 60 % the fill valve must stay closed (hysteresis)', { for: 1500 }),
          expectObs('fillValve', true, 'Below 50 % the fill valve must open', { within: 1500 }),
          expectObsRange('level', { min: 49, max: 50.2 }, 'The refill must start at 50 %'),
          release('discharge'),
          expectObs('drainValve', false, 'Releasing Discharge_PB must close Drain_Valve', { within: 150 }),
          expectObs('fillValve', true, 'Once started, the refill must continue past 50 % (hysteresis)', { for: 1500 }),
          expectObs('fillValve', false, 'The refill must stop at 60 %', { within: 4000 }),
          expectObsRange('level', { min: 59.5, max: 60.6 }, 'The refill must stop at 60 %'),
        ],
      },
      {
        name: 'Mixer and heater wait for liquid',
        steps: [
          wait(200),
          tap('start'),
          expectObs('mixerRunning', false, 'The mixer must not run below 20 % level', { for: 4000 }),
          expectObs('heaterOn', false, 'The heater must not run below 20 % level'),
          expectObs('mixerRunning', true, 'The mixer must start once the level reaches 20 %', { within: 1500 }),
          expectObsRange('level', { min: 19.9, max: 21.5 }, 'The mixer must start at 20 % — not earlier, not much later'),
          expectObs('heaterOn', true, 'The heater must come on once the mixer is proven running (the water is cold)', { within: 300 }),
        ],
      },
      {
        name: 'Thermostat holds 58–62 °C',
        description: 'Warm-up, then two full heater cycles and a minute of steady state.',
        steps: [
          wait(200),
          tap('start'),
          expectObs('heaterOn', true, 'The heater must warm the water up', { within: 8000 }),
          expectObs('heaterOn', false, 'The heater must switch off above 62 °C', { within: 120000 }),
          expectObsRange('temperature', { min: 61.8, max: 62.3 }, 'The heater must switch off at 62 °C — not before'),
          expectObs('heaterOn', false, 'The heater must stay OFF while the water cools from 62 toward 58 °C (hysteresis)', { for: 12000 }),
          expectObs('heaterOn', true, 'The heater must come back ON when the water drops below 58 °C', { within: 15000 }),
          expectObsRange('temperature', { min: 57.7, max: 58.2 }, 'The heater must switch on at 58 °C — not before'),
          expectObs('heaterOn', true, 'The heater must stay ON until the water is back above 62 °C (hysteresis)', { for: 3000 }),
          expectObs('heaterOn', false, 'The heater must switch off again above 62 °C', { within: 5000 }),
          expectObsRange('temperature', { min: 61.8, max: 62.3 }, 'The heater must switch off at 62 °C'),
          expectObsRange('temperature', { min: 57.5, max: 62.5 }, 'The water must stay inside the 58–62 °C band', { for: 60000 }),
        ],
      },
      {
        name: 'Stop and E-stop shut everything down',
        steps: [
          wait(200),
          tap('start'),
          expectObs('heaterOn', true, 'The heater must be on once the mixer runs', { within: 8000 }),
          wait(500),
          tap('stop'),
          expectTag('Heater', false, 'Stop must drop the heater at once', { within: 30 }),
          expectObs('fillValve', false, 'Stop must close the fill valve', { within: 150 }),
          expectObs('mixerRunning', false, 'Stop must stop the mixer', { within: 300 }),
          expectObs('runningLight', false, 'RUNNING must go off after Stop', { within: 150 }),
          expectObs('fillValve', false, 'Nothing may restart by itself after Stop', { for: 2000 }),
          press('discharge'),
          expectObs('drainValve', true, 'Discharge must also work while the system is stopped (spec item 3: running or not)', { within: 150 }),
          release('discharge'),
          expectObs('drainValve', false, 'Releasing Discharge_PB must close Drain_Valve', { within: 150 }),
          tap('start'),
          expectObs('fillValve', true, 'Start must resume filling', { within: 150 }),
          expectObs('heaterOn', true, 'Start must resume heating', { within: 1000 }),
          set('estop', true),
          expectTag('Heater', false, 'The E-stop must drop the heater in the logic — it is not hardwired', { within: 30 }),
          expectTag('Fill_Valve', false, 'The E-stop must close the fill valve in the logic — it is not hardwired', { within: 30 }),
          set('estop', false),
          expectObs('fillValve', false, 'DANGER: the system restarted by itself after the E-stop was released', { within: 150, for: 2000 }),
          expectObs('heaterOn', false, 'The heater must stay off after the E-stop until Start is pressed', { for: 200 }),
        ],
      },
    ],
    invariants: [
      NO_SPILL,
      NO_DRY_HEAT,
      NO_DRY_RUN,
      { observe: 'temperature', max: 63, message: 'The water went above 63 °C — the heater must switch off at 62 °C' },
      {
        when: { observe: 'mixerRunning', equals: false },
        observe: 'heaterOn',
        equals: false,
        graceMs: 20,
        message: 'The heater was ON while the agitator was not proven running (Mixer_Running) — hot spots scorch the product',
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
    ],
    parInstructions: 26,
    debrief: `The hot-water buffer is in service, and the heater contactor clicks a few times a minute instead of a
hundred times a second.

**Hysteresis** (a *deadband*) is the same seal-in you wrote on day one, with analog conditions: one compare
switches ON, the output's own contact holds it, a second compare switches OFF. Between 58 and 62 °C the output
simply remembers. You used it twice — on the level and on the temperature.

You also interlocked the heater with the agitator's **proven** running feedback, not just its command: if the
starter trips, the heater stops before it scorches the product.

**Field tip:** an on/off thermostat is fine for a buffer tank. When a process needs ±0.2 °C, a **PID** loop
(the PIDE instruction in Logix) modulates a control valve or an SCR-fired heater instead — tuned, of course,
with the same care you just gave the deadband.`,
  },
];
