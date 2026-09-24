/**
 * Chapter 3 — Timing Is Everything (TON / TOF / RTO, flashers, a start-up warning horn, an hour meter,
 * a fixed-time traffic signal and a pedestrian-call boss).
 * Mission ids '3-1', '3-2', ... See docs/CURRICULUM.md for the authoring guide.
 */
import type { MissionDef, MissionInvariant, TestStep } from '../types';
import { expectObs, expectObsRange, expectTag, expectTagRange, mode, press, release, set, tap, wait } from './authoring';

/** Bit + timer palette of this chapter (chapter 2's instructions plus the timers). */
const TIMER_PALETTE = ['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'TON', 'TOF', 'RTO', 'RES'];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Switch a trainer toggle switch. */
const sw = (n: number, on: boolean): TestStep => set(`sw${n}`, on);

/** Trainer lamp: settle to `value` within 100 ms, then hold it for `hold` ms. */
const lamp = (id: string, value: boolean, message: string, hold = 300): TestStep =>
  expectObs(id, value, message, { within: 100, for: hold });

/**
 * A lamp flashing about `onMs` ON / `offMs` OFF: the lamp must light within `startWithin` ms; the check
 * then synchronises on a rising edge that follows a complete dark phase (the first phase may be partial,
 * e.g. a free-running flasher) and checks `cycles` periods. Each phase must last between phase − 90 ms and
 * phase + 160 ms, so any reasonable timer arrangement (period = PRE + a scan or two) passes.
 */
function flashes(id: string, label: string, cycles: number, startWithin = 1100, onMs = 500, offMs = 500): TestStep[] {
  const steps: TestStep[] = [
    expectObs(id, true, `${label} must be flashing (it stayed dark)`, { within: startWithin }),
    expectObs(id, false, `${label} must be flashing (it stayed lit)`, { within: onMs + 600 }),
    expectObs(id, true, `${label} must be flashing (it stayed dark)`, { within: offMs + 600 }),
  ];
  for (let i = 0; i < cycles; i++) {
    steps.push(
      expectObs(id, true, `${label}: each flash must stay lit for about ${onMs / 1000} s`, { for: onMs - 90 }),
      expectObs(id, false, `${label}: the lamp must go dark after about ${onMs / 1000} s`, { within: 250 }),
      expectObs(id, false, `${label}: the dark phase must last about ${offMs / 1000} s`, { for: offMs - 90 }),
      expectObs(id, true, `${label}: the lamp must light again after about ${offMs / 1000} s`, { within: 250 }),
    );
  }
  return steps;
}

// --- motor station (3-4, 3-5) --------------------------------------------------

const SAFE_SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const RUN_LIGHT = 'XIC(Motor_Aux)OTE(Run_Light);';
const READY_LIGHT = 'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);';
const FAULT_LIGHT = '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);';

const STOP_WINS: MissionInvariant = {
  when: { control: 'stop', equals: true },
  tag: 'Motor_Starter',
  equals: false,
  graceMs: 20,
  message: 'Motor_Starter must be OFF while Stop is pressed — Stop always wins',
};
const ESTOP_DROPS: MissionInvariant = {
  when: { control: 'estop', equals: true },
  tag: 'Motor_Starter',
  equals: false,
  graceMs: 20,
  message: 'Motor_Starter must be OFF while the E-stop is pushed',
};
const OVERLOAD_DROPS: MissionInvariant = {
  when: { observe: 'overloadTripped', equals: true },
  tag: 'Motor_Starter',
  equals: false,
  graceMs: 20,
  message: 'Motor_Starter must be OFF while the overload relay is tripped (OL_OK = 0)',
};
const MOTOR_SAFETY = [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS];

const runs = (message: string, hold?: number): TestStep =>
  expectObs('contactor', true, message, hold === undefined ? { within: 150 } : { within: 150, for: hold });
const stops = (message: string, hold?: number): TestStep =>
  expectObs('contactor', false, message, hold === undefined ? { within: 150 } : { within: 150, for: hold });
const staysOff = (message: string, ms: number): TestStep => expectObs('contactor', false, message, { for: ms });

// --- traffic light (3-6, 3-7) ---------------------------------------------------

/** Fixed-time cycle with cascaded TONs (the 3-6 reference solution; the 3-7 starter). */
const CYCLE_TIMERS = [
  'XIO(T_All_Red_2.DN)TON(T_NS_Green,10000,0);',
  'XIC(T_NS_Green.DN)TON(T_NS_Yellow,3000,0);',
  'XIC(T_NS_Yellow.DN)TON(T_All_Red_1,1000,0);',
  'XIC(T_All_Red_1.DN)TON(T_EW_Green,8000,0);',
  'XIC(T_EW_Green.DN)TON(T_EW_Yellow,3000,0);',
  'XIC(T_EW_Yellow.DN)TON(T_All_Red_2,1000,0);',
];
const CYCLE_LAMPS = [
  'XIO(T_NS_Green.DN)OTE(NS_Green);',
  'XIC(T_NS_Green.DN)XIO(T_NS_Yellow.DN)OTE(NS_Yellow);',
  'XIC(T_NS_Yellow.DN)OTE(NS_Red);',
  'XIC(T_All_Red_1.DN)XIO(T_EW_Green.DN)OTE(EW_Green);',
  'XIC(T_EW_Green.DN)XIO(T_EW_Yellow.DN)OTE(EW_Yellow);',
  '[XIO(T_All_Red_1.DN),XIC(T_EW_Yellow.DN)]OTE(EW_Red);',
];
const CYCLE_COMMENTS = [
  'Phase 1: NS green 10 s',
  'Phase 2: NS yellow 3 s',
  'Phase 3: all red 1 s',
  'Phase 4: EW green 8 s',
  'Phase 5: EW yellow 3 s',
  'Phase 6: all red 1 s — its .DN restarts the cycle',
  'NS green lamp',
  'NS yellow lamp',
  'NS red lamp',
  'EW green lamp',
  'EW yellow lamp',
  'EW red lamp',
];

const CYCLE_TIMER_TAGS = ['T_NS_Green', 'T_NS_Yellow', 'T_All_Red_1', 'T_EW_Green', 'T_EW_Yellow', 'T_All_Red_2'].map(
  (name, i) => ({
    name,
    dataType: 'TIMER' as const,
    description: ['NS green 10 s', 'NS yellow 3 s', 'All red 1 s (after NS)', 'EW green 8 s', 'EW yellow 3 s', 'All red 1 s (after EW)'][i],
  }),
);

const NO_CONFLICT: MissionInvariant = {
  observe: 'conflict',
  equals: false,
  message: 'CONFLICT: NS and EW both had green/yellow (or WALK was lit with NS green/yellow) — somebody just crashed',
};

/** Instant lamp check (used right after a synchronising edge). */
const lampNow = (id: string, value: boolean, message: string): TestStep => expectObs(id, value, message);

/**
 * One full fixed-time cycle starting at the rising edge of NS green (already synchronised). Every
 * phase is checked with a tolerance of −0.4 s / +0.6 s; transitions must follow within 50 ms.
 */
function cycleSteps(): TestStep[] {
  return [
    lampNow('nsYellow', false, 'NS green phase: NS yellow must be OFF'),
    lampNow('nsRed', false, 'NS green phase: NS red must be OFF'),
    lampNow('ewRed', true, 'NS green phase: EW must show red'),
    lampNow('ewGreen', false, 'NS green phase: EW green must be OFF'),
    lampNow('ewYellow', false, 'NS green phase: EW yellow must be OFF'),
    expectObs('nsGreen', true, 'NS green must last 10 s', { for: 9600 }),
    expectObs('nsGreen', false, 'NS green must end after 10 s', { within: 600 }),
    expectObs('nsYellow', true, 'NS yellow must follow NS green immediately', { within: 50 }),
    lampNow('nsRed', false, 'NS yellow phase: NS red must be OFF (one lamp per head)'),
    lampNow('ewRed', true, 'NS yellow phase: EW must still show red'),
    expectObs('nsYellow', true, 'NS yellow must last 3 s', { for: 2700 }),
    expectObs('nsYellow', false, 'NS yellow must end after 3 s', { within: 600 }),
    expectObs('nsRed', true, 'NS red must follow NS yellow immediately', { within: 50 }),
    lampNow('ewRed', true, 'All-red clearance: EW must still show red'),
    expectObs('ewGreen', false, 'All-red clearance: EW must wait 1 s with every head red before turning green', { for: 800 }),
    expectObs('ewGreen', true, 'EW green must start after the 1 s all-red', { within: 600 }),
    expectObs('ewRed', false, 'EW red must go OFF when EW turns green', { within: 50 }),
    lampNow('nsRed', true, 'EW green phase: NS must show red'),
    expectObs('ewGreen', true, 'EW green must last 8 s', { for: 7600 }),
    expectObs('ewGreen', false, 'EW green must end after 8 s', { within: 600 }),
    expectObs('ewYellow', true, 'EW yellow must follow EW green immediately', { within: 50 }),
    lampNow('ewRed', false, 'EW yellow phase: EW red must be OFF (one lamp per head)'),
    lampNow('nsRed', true, 'EW yellow phase: NS must still show red'),
    expectObs('ewYellow', true, 'EW yellow must last 3 s', { for: 2700 }),
    expectObs('ewYellow', false, 'EW yellow must end after 3 s', { within: 600 }),
    expectObs('ewRed', true, 'EW red must follow EW yellow immediately', { within: 50 }),
    lampNow('nsRed', true, 'All-red clearance: NS must still show red'),
    expectObs('nsGreen', false, 'All-red clearance: NS must wait 1 s with every head red before turning green', { for: 800 }),
    expectObs('nsGreen', true, 'The cycle must repeat: NS green again after the second all-red', { within: 600 }),
    expectObs('nsRed', false, 'NS red must go OFF when NS turns green', { within: 50 }),
  ];
}

/** Wait for the end of the next NS yellow, i.e. the start of the NS red interval (first all-red). */
const untilNsRedInterval = (within = 27_000): TestStep[] => [
  expectObs('nsYellow', true, 'The cycle must reach NS yellow', { within }),
  expectObs('nsYellow', false, 'NS yellow must end after 3 s', { within: 3600 }),
];

export const CH3_MISSIONS: MissionDef[] = [
  // -------------------------------------------------------------------------
  {
    id: '3-1',
    chapter: 'timing',
    order: 1,
    title: 'Delayed Start',
    tagline: 'TON: purge the booth for 3 s before READY.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 2,
    xp: 90,
    briefing: `Riverside's new paint line has a spray booth, and the fire marshal has one rule: the exhaust fan must
**purge the booth for 3 seconds** before anyone may spray. Dana wants you to prototype the interlock on the
trainer bench before it goes into the real panel.

**The hardware**
- \`Switch_0\` → \`Local:1:I.Data.0\` — booth ON switch (maintained): 1 = booth switched on, fan running.
- \`Light_0\` → \`Local:2:O.Data.0\` — green pilot light **READY TO SPRAY**.
- A timer tag \`Purge_Timer\` (TIMER) is already created for you.

**Meet the TON** (*Timer On Delay*): while its rung is true it counts milliseconds in \`.ACC\`; when \`.ACC\`
reaches the preset \`.PRE\` it sets its **done bit** \`.DN\`. The moment the rung goes false it **resets**
(\`.ACC = 0\`, \`.DN = 0\`). Logix timers count in **milliseconds**: 3 s = \`3000\`.

**Your task**
- \`Light_0\` lights **3 s after** \`Switch_0\` turns ON (and stays ON while the switch stays ON).
- It goes OFF **immediately** when the switch goes OFF.
- If the booth is switched off during the purge, the purge **starts over** next time.`,
    objectives: [
      '`Light_0` stays OFF for the first 3 s after `Switch_0` turns ON',
      '`Light_0` turns ON after 3 s',
      '`Light_0` goes OFF at once when `Switch_0` goes OFF',
      'An interrupted purge starts over from zero',
    ],
    concepts: ['TON', 'XIC', 'OTE'],
    starter: {
      rungs: ['', ''],
      comments: ['Purge timer: runs while the booth is ON', 'READY TO SPRAY lamp'],
      tags: [{ name: 'Purge_Timer', dataType: 'TIMER', description: 'Booth purge delay (3 s)' }],
    },
    solution: { rungs: ['XIC(Switch_0)TON(Purge_Timer,3000,0);', 'XIC(Purge_Timer.DN)OTE(Light_0);'] },
    hints: [
      'Two rungs: one that runs the timer while the switch is ON, one that lights the lamp when the timer is done.',
      'Rung 0: `XIC(Switch_0)` in front of a **TON** on `Purge_Timer` with a preset of **3000** (ms). Rung 1: the timer\'s done bit `Purge_Timer.DN` drives `Light_0`.',
      '`XIC(Switch_0)TON(Purge_Timer,3000,0);` and `XIC(Purge_Timer.DN)OTE(Light_0);`',
    ],
    tests: [
      {
        name: 'Dark at power-up',
        steps: [wait(200), expectObs('light0', false, 'READY must be OFF while the booth is off', { for: 1000 })],
      },
      {
        name: 'READY only after a 3 s purge',
        steps: [
          wait(100),
          sw(0, true),
          expectObs('light0', false, 'READY lit before the 3 s purge was over — use a TON with a preset of 3000 ms', { for: 2800 }),
          expectObs('light0', true, 'READY must light 3 s after the booth is switched on', { within: 400 }),
          expectObs('light0', true, 'READY must stay ON while the booth stays on', { for: 2000 }),
        ],
      },
      {
        name: 'OFF means OFF — at once',
        steps: [
          wait(100),
          sw(0, true),
          expectObs('light0', true, 'READY must light 3 s after the booth is switched on', { within: 3400 }),
          wait(500),
          sw(0, false),
          expectObs('light0', false, 'READY must go OFF immediately when the booth is switched off', { within: 50, for: 2000 }),
        ],
      },
      {
        name: 'An interrupted purge starts over',
        steps: [
          wait(100),
          sw(0, true),
          wait(2000),
          sw(0, false),
          wait(500),
          sw(0, true),
          expectObs('light0', false, 'The purge was interrupted: it must start over and take the full 3 s again (a TON resets when its rung goes false)', {
            for: 2800,
          }),
          expectObs('light0', true, 'READY must light 3 s after the booth is switched back on', { within: 400 }),
        ],
      },
      {
        name: 'Other switches do not matter',
        steps: [
          wait(100),
          ...[1, 2, 3, 4, 5, 6, 7].map((n) => sw(n, true)),
          expectObs('light0', false, 'Only Switch_0 may start the purge', { for: 3500 }),
        ],
      },
    ],
    invariants: [
      {
        when: { control: 'sw0', equals: false },
        tag: 'Light_0',
        equals: false,
        graceMs: 20,
        message: 'Light_0 (READY) must be OFF whenever the booth switch is OFF',
      },
    ],
    parInstructions: 4,
    allowedInstructions: TIMER_PALETTE,
    requiredInstructions: ['TON'],
    debrief: `The TON is the most-used timer in any plant: *do this only after that has been true for a while*.
\`.EN\` follows the rung, \`.TT\` is on while it's timing, \`.DN\` comes on at the preset — and **everything
resets** the instant the rung goes false. That reset is why an interrupted purge starts over.

**Field tip:** the same "on-delay" pattern is everywhere: debouncing a chattering limit switch, making sure a
level switch stays made for 2 s before trusting it, waiting for a drive to report ready. And always write
presets in milliseconds — \`TON(T,3,0)\` is a 3 **ms** timer, a classic first-week bug.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '3-2',
    chapter: 'timing',
    order: 2,
    title: 'Cool-Down Fan',
    tagline: 'TOF: keep the fan running after the heater stops.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 2,
    xp: 90,
    briefing: `Maintenance keeps replacing burnt heater elements in the curing oven. Gus found why: the circulation fan
stops the instant the heater does, and the elements cook in their own residual heat. The fix: an
**overrun** — the fan keeps running for a while after the heater turns off.

**The hardware** (simulated on the trainer bench)
- \`Switch_1\` → \`Local:1:I.Data.1\` — heater ON command (maintained): 1 = heater on.
- \`Light_6\` → \`Local:2:O.Data.6\` — blue pilot light = the circulation fan.
- A timer tag \`Fan_Overrun\` (TIMER) is ready for you.

**Meet the TOF** (*Timer Off Delay*): while its rung is true, \`.DN\` is ON and nothing is timing. When the rung
goes **false**, it starts timing and \`.DN\` stays ON until \`.ACC\` reaches \`.PRE\` — then \`.DN\` drops.

**Your task**
- The fan runs **while** the heater is on…
- …and keeps running for **5 s after** the heater turns off, then stops.
- If the heater comes back on during the overrun, the 5 s start over when it next turns off.
- The fan must **not** run at power-up (heater off).`,
    objectives: [
      'The fan runs while the heater is ON',
      'The fan keeps running 5 s after the heater turns OFF, then stops',
      'The overrun restarts if the heater comes back on',
      'No fan at power-up with the heater OFF',
    ],
    concepts: ['TOF', 'XIC', 'OTE'],
    starter: {
      rungs: ['XIC(Switch_1)OTE(Light_6);'],
      comments: ['Fan follows the heater — and stops with it. Add a 5 s overrun!'],
      tags: [{ name: 'Fan_Overrun', dataType: 'TIMER', description: 'Fan overrun after the heater stops (5 s)' }],
    },
    solution: { rungs: ['XIC(Switch_1)TOF(Fan_Overrun,5000,0);', 'XIC(Fan_Overrun.DN)OTE(Light_6);'] },
    hints: [
      'You need an output that turns ON immediately but turns OFF late. Which timer has a delay on the way *off*?',
      'Put a **TOF** on `Fan_Overrun` (preset 5000) on the heater rung, and drive the fan from the timer\'s done bit.',
      '`XIC(Switch_1)TOF(Fan_Overrun,5000,0);` and `XIC(Fan_Overrun.DN)OTE(Light_6);`',
    ],
    tests: [
      {
        name: 'No fan at power-up',
        steps: [wait(100), expectObs('light6', false, 'The fan must not run at power-up while the heater is off', { for: 6000 })],
      },
      {
        name: 'Fan runs with the heater',
        steps: [
          wait(100),
          sw(1, true),
          lamp('light6', true, 'The fan must start as soon as the heater turns on', 2000),
        ],
      },
      {
        name: '5 s overrun after the heater stops',
        steps: [
          wait(100),
          sw(1, true),
          wait(1000),
          sw(1, false),
          expectObs('light6', true, 'The fan must keep running for 5 s after the heater turns off', { for: 4800 }),
          expectObs('light6', false, 'The fan must stop 5 s after the heater turned off', { within: 400 }),
          expectObs('light6', false, 'The fan must stay off once the overrun is over', { for: 2000 }),
        ],
      },
      {
        name: 'Heater back on during the overrun',
        steps: [
          wait(100),
          sw(1, true),
          wait(500),
          sw(1, false),
          wait(3000),
          sw(1, true),
          expectObs('light6', true, 'The fan must keep running while the heater is back on', { for: 2000 }),
          sw(1, false),
          expectObs('light6', true, 'The overrun must start over: another full 5 s after the heater turns off again', { for: 4800 }),
          expectObs('light6', false, 'The fan must stop 5 s after the heater turned off', { within: 400 }),
        ],
      },
      {
        name: 'A short heater blip still gets the full overrun',
        steps: [
          wait(100),
          sw(1, true),
          wait(100),
          sw(1, false),
          expectObs('light6', true, 'Even after a short heater pulse the fan must run on for 5 s', { within: 60, for: 4700 }),
          expectObs('light6', false, 'The fan must stop 5 s after the heater turned off', { within: 400 }),
        ],
      },
    ],
    invariants: [
      {
        when: { control: 'sw1', equals: true },
        tag: 'Light_6',
        equals: true,
        graceMs: 20,
        message: 'The fan (Light_6) must run whenever the heater is ON',
      },
    ],
    parInstructions: 4,
    allowedInstructions: TIMER_PALETTE,
    requiredInstructions: ['TOF'],
    debrief: `TON delays the **ON**, TOF delays the **OFF**. The TOF's \`.DN\` bit is the output you want: ON with the rung,
OFF a preset later.

Notice the fan stayed off at power-up? On the **prescan** a TOF sets \`.ACC = .PRE\` and clears \`.DN\`, so it
doesn't run an overrun just because the controller went to Run. A home-made off-delay built from a TON on
\`XIO(Switch_1)\` would have run the fan for 5 s at every start-up.

**Field tip:** overrun timers protect heaters, lamp ballasts, VFD braking resistors and big bearings (run the
lube pump after the shaft stops). Pumps and conveyors often get the opposite: a TON *start* delay so they
don't all start at once and trip the main breaker.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '3-3',
    chapter: 'timing',
    order: 3,
    title: 'Blinker',
    tagline: 'Two timers that reset each other: a 1 Hz flasher.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 3,
    xp: 120,
    briefing: `A steady red lamp on a control panel gets ignored after a week. A **flashing** one gets noticed. Dana wants
the new alarm beacon to flash at 1 Hz: **0.5 s ON, 0.5 s OFF**, for as long as the alarm is active.

**The hardware**
- \`Switch_2\` → \`Local:1:I.Data.2\` — "alarm active" (maintained): 1 = alarm.
- \`Light_4\` → \`Local:2:O.Data.4\` — red pilot light (the beacon).
- Two timer tags, \`Flash_On\` and \`Flash_Off\` (TIMER), are created for you.

**The trick:** a timer that switches **itself** off. Timer A times the lit phase; when it's done it starts
timer B for the dark phase; when B is done it resets A — which resets B — and the whole thing starts again.

**Your task**
- While \`Switch_2\` is ON, \`Light_4\` flashes **0.5 s ON / 0.5 s OFF** (it may start with either phase).
- While \`Switch_2\` is OFF, \`Light_4\` is dark.`,
    objectives: [
      '`Light_4` flashes 0.5 s ON / 0.5 s OFF while `Switch_2` is ON',
      '`Light_4` is dark while `Switch_2` is OFF',
      'Flashing restarts when the alarm comes back',
    ],
    concepts: ['TON', 'XIC', 'XIO', 'OTE'],
    starter: {
      rungs: ['', '', ''],
      comments: ['Lit-phase timer (0.5 s)', 'Dark-phase timer (0.5 s)', 'Alarm beacon'],
      tags: [
        { name: 'Flash_On', dataType: 'TIMER', description: 'Flasher: lit phase 0.5 s' },
        { name: 'Flash_Off', dataType: 'TIMER', description: 'Flasher: dark phase 0.5 s' },
      ],
    },
    solution: {
      rungs: [
        'XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,500,0);',
        'XIC(Flash_On.DN)TON(Flash_Off,500,0);',
        'XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);',
      ],
    },
    hints: [
      'The lamp is ON while the first timer is timing and OFF while the second one is timing. What makes the first timer start over?',
      '`Flash_On` runs while the alarm is on and `Flash_Off` is **not** done; `Flash_Off` runs once `Flash_On` is done. When `Flash_Off` finishes, its `.DN` drops the rung of `Flash_On` — both reset. The lamp: alarm ON and `Flash_On` not done.',
      '`XIC(Switch_2)XIO(Flash_Off.DN)TON(Flash_On,500,0);` then `XIC(Flash_On.DN)TON(Flash_Off,500,0);` then `XIC(Switch_2)XIO(Flash_On.DN)OTE(Light_4);`',
    ],
    tests: [
      {
        name: 'Dark without an alarm',
        steps: [wait(100), expectObs('light4', false, 'The beacon must be dark while Switch_2 is OFF', { for: 2500 })],
      },
      {
        name: 'Flashes 0.5 s ON / 0.5 s OFF',
        steps: [wait(100), sw(2, true), ...flashes('light4', 'The beacon', 4)],
      },
      {
        name: 'Dark when the alarm clears — and flashing again next time',
        steps: [
          wait(100),
          sw(2, true),
          wait(2300),
          sw(2, false),
          expectObs('light4', false, 'The beacon must go dark as soon as the alarm clears', { within: 60, for: 2000 }),
          sw(2, true),
          ...flashes('light4', 'The beacon', 2),
          sw(2, false),
          expectObs('light4', false, 'The beacon must go dark as soon as the alarm clears', { within: 60, for: 1500 }),
        ],
      },
      {
        name: 'Still flashing after a while',
        description: 'Lets the flasher run for 10 s, then checks it is still keeping time.',
        steps: [wait(100), sw(2, true), wait(10_000), ...flashes('light4', 'The beacon', 2)],
      },
    ],
    invariants: [
      {
        when: { control: 'sw2', equals: false },
        tag: 'Light_4',
        equals: false,
        graceMs: 20,
        message: 'The beacon (Light_4) must be dark whenever the alarm switch is OFF',
      },
    ],
    parInstructions: 8,
    allowedInstructions: TIMER_PALETTE,
    debrief: `Two timers that reset each other make a **free-running oscillator**. Notice the period is a hair over 1 s:
a self-resetting timer loses a scan or two every cycle (it needs one scan to see \`.DN\` and reset, one more to
start timing again). That's fine for a beacon — not for a clock.

**Field tip:** for a plain flasher many techs don't build timers at all: they borrow a bit of a free-running
clock, e.g. a bit of the wall-clock value read with **GSV**, or a single timer compared against half its preset.
Whatever you use, use **one** flasher for the whole panel so every alarm lamp flashes in step — operators
notice a lamp that's out of sync.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '3-4',
    chapter: 'timing',
    order: 4,
    title: 'Pre-Start Warning',
    tagline: 'Sound the horn for 3 s before the conveyor moves.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 3,
    xp: 150,
    briefing: `Line 3's conveyor is 40 m long and runs past two blind corners. After a near miss, the safety committee
adds a rule straight out of the standards: **a conveyor that can't be seen end to end must sound a warning
before it starts.**

**The hardware** (the start/stop from chapter 2 is loaded)
- \`Start_PB\` → \`Local:1:I.Data.0\` — N.O.; \`Stop_PB\` → \`Local:1:I.Data.1\` — **N.C.** (1 when not pressed).
- \`EStop_OK\` (**N.C.**, 1 = released) and \`OL_OK\` (**N.C.**, 1 = healthy) as before.
- \`Horn\` → \`Local:2:O.Data.3\` — the warning horn.
- Tags created for you: \`Start_Warning\` (BOOL) and \`Warn_Timer\` (TIMER).

**Your task**
- Pressing **Start** (motor stopped) sounds the **Horn for 3 s**; only **then** does the motor start — and it
  seals in as before. The horn goes quiet when the motor starts.
- **Stop** (or the E-stop / overload) during the warning **cancels** the start: horn off, no motor.
- Stop, E-stop and overload stop a running motor as before; nothing restarts by itself.
- Pressing Start while the motor is already running does **not** sound the horn.

Tip: a TON's **\`.TT\`** (timer timing) bit is ON exactly while it is counting.`,
    objectives: [
      'Start sounds the horn for 3 s, then the motor starts and seals in',
      'The horn stops when the motor starts',
      'Stop / E-stop during the warning cancel the start',
      'No horn when Start is pressed on a running motor',
    ],
    concepts: ['TON', '.TT', '.DN', 'XIC', 'XIO', 'OTE'],
    starter: {
      rungs: [SAFE_SEAL],
      comments: ['Line 3 start/stop (chapter 2) — starts instantly, no warning!'],
      tags: [
        { name: 'Start_Warning', dataType: 'BOOL', description: 'Start requested: warning horn phase' },
        { name: 'Warn_Timer', dataType: 'TIMER', description: 'Pre-start warning (3 s)' },
      ],
    },
    solution: {
      rungs: [
        '[XIC(Start_PB),XIC(Start_Warning)]XIO(Motor_Starter)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Start_Warning);',
        'XIC(Start_Warning)TON(Warn_Timer,3000,0);',
        'XIC(Warn_Timer.TT)OTE(Horn);',
        '[XIC(Warn_Timer.DN),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
      ],
    },
    hints: [
      'Split the start into two memories: "a start was requested, we are warning" (`Start_Warning`) and "the motor runs" (`Motor_Starter`). Start seals the first; the timer\'s done bit starts the second.',
      '`Start_Warning` is a seal-in through Stop / E-stop / overload and `XIO(Motor_Starter)` (so it ends when the motor starts). A TON on `Start_Warning` times 3 s; `Warn_Timer.TT` drives the horn; in the motor seal-in, replace `Start_PB` with `Warn_Timer.DN`.',
      '`[XIC(Start_PB),XIC(Start_Warning)]XIO(Motor_Starter)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Start_Warning);` — `XIC(Start_Warning)TON(Warn_Timer,3000,0);` — `XIC(Warn_Timer.TT)OTE(Horn);` — `[XIC(Warn_Timer.DN),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);`',
    ],
    tests: [
      {
        name: 'Quiet at power-up',
        steps: [
          wait(200),
          expectObs('horn', false, 'The horn must be quiet at power-up', { for: 1000 }),
          staysOff('The motor must not start at power-up', 500),
        ],
      },
      {
        name: 'Horn first, then the motor',
        steps: [
          wait(200),
          tap('start'),
          expectObs('horn', true, 'Pressing Start must sound the warning horn at once', { within: 100 }),
          expectObs('horn', true, 'The horn must sound for the whole 3 s warning', { for: 2500 }),
          expectObs('contactor', false, 'The motor started before the 3 s warning was over', { for: 50 }),
          expectObs('contactor', true, 'After the 3 s warning the motor must start', { within: 600 }),
          expectObs('horn', false, 'The horn must stop once the motor starts', { within: 150, for: 2000 }),
          expectObs('contactor', true, 'The motor must keep running after the warning (seal-in)', { for: 1000 }),
          expectObs('motorStarts', 1, 'The contactor must pull in exactly once'),
        ],
      },
      {
        name: 'Stop cancels the warning',
        steps: [
          wait(200),
          tap('start'),
          expectObs('horn', true, 'Pressing Start must sound the warning horn', { within: 100 }),
          wait(1000),
          tap('stop'),
          expectObs('horn', false, 'Stop during the warning must silence the horn', { within: 100, for: 500 }),
          staysOff('Stop during the warning must cancel the start — the motor must not start', 4000),
          tap('start'),
          expectObs('horn', true, 'A new Start must give a new warning', { within: 100 }),
          expectObs('contactor', false, 'The new start must wait for the full 3 s warning again', { for: 2500 }),
          expectObs('contactor', true, 'After the warning the motor must start', { within: 700 }),
        ],
      },
      {
        name: 'E-stop cancels the warning',
        steps: [
          wait(200),
          tap('start'),
          wait(1500),
          set('estop', true),
          expectObs('horn', false, 'The E-stop must cancel the warning (horn off)', { within: 150, for: 500 }),
          wait(1500),
          set('estop', false),
          staysOff('DANGER: the motor started after the E-stop was released — the E-stop must cancel the start request', 4000),
          expectObs('horn', false, 'Releasing the E-stop must not sound the horn', { for: 100 }),
        ],
      },
      {
        name: 'Stop a running motor — no restart, no horn',
        steps: [
          wait(200),
          tap('start'),
          expectObs('contactor', true, 'The motor must start after the 3 s warning', { within: 3500, for: 500 }),
          tap('stop'),
          stops('Stop must stop the motor'),
          staysOff('The motor must stay stopped', 3500),
          expectObs('horn', false, 'Stopping must not sound the horn', { for: 100 }),
        ],
      },
      {
        name: 'Start on a running motor: no horn',
        steps: [
          wait(200),
          tap('start'),
          expectObs('contactor', true, 'The motor must start after the 3 s warning', { within: 3500, for: 300 }),
          expectObs('horn', false, 'The horn must be quiet while running', { within: 150 }),
          tap('start'),
          expectObs('horn', false, 'Pressing Start on a running motor must not sound the horn', { for: 1500 }),
          expectObs('contactor', true, 'The motor must keep running', { for: 500 }),
        ],
      },
    ],
    invariants: MOTOR_SAFETY,
    parInstructions: 17,
    allowedInstructions: TIMER_PALETTE,
    requiredInstructions: ['TON'],
    debrief: `You separated the **request** (\`Start_Warning\`) from the **action** (\`Motor_Starter\`) and let a timer bridge
the two — the heart of every sequence you'll write. The \`.TT\` bit gave you "during the delay" for free.

**Field tip:** start-up warnings are required on conveyors that can't be seen end to end, and many plants use
a *warning → short pause → start* pattern, or a horn plus a rotating beacon. And a stop pressed during the
warning must always cancel the start — never "remember" it.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '3-5',
    chapter: 'timing',
    order: 5,
    title: 'Hour Meter',
    tagline: 'RTO: run time that survives stops — and a service reminder.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 3,
    xp: 150,
    briefing: `Gus wants to grease Line 3's gearbox by **run hours**, not by the calendar. That needs an hour meter
that adds up run time across every start and stop — a job for the **RTO** (*Retentive Timer On*): like a TON,
but when its rung goes false it **keeps** \`.ACC\` (and \`.DN\`). Only a **RES** instruction clears it.

For the demo, Dana sets the service interval to **30 s** (\`30000\`); on the real line it'll be 8 hours.

**The hardware** (the safe start/stop and the three pilot lights from chapter 2 are loaded)
- \`Motor_Aux\` → \`Local:1:I.Data.5\` — contactor auxiliary contact, **N.O.**: 1 while the motor is really running.
- \`Jog_PB\` → \`Local:1:I.Data.3\` — black push button, **N.O.** Not used for jogging here: it's the **service reset**.
- \`Fault_Light\` → \`Local:2:O.Data.2\` — red lamp: E-stop or overload… and from now on also **SERVICE DUE**.
- Tags created for you: \`Run_Timer\` and \`Reset_Hold\` (TIMER).

**Your task**
- \`Run_Timer\` accumulates the motor's **actual run time** (preset 30000 ms), across stops, and even through a
  Program → Run mode change.
- When it reaches the preset, \`Fault_Light\` comes on (**SERVICE DUE**) and stays on, running or not.
- **Reset:** holding \`Jog_PB\` for **2 s** while the motor is **stopped** clears the hour meter.
  A short press does nothing, and it never resets while the motor runs.
- \`Fault_Light\` still lights for the E-stop or a tripped overload. Start/Stop keep working.`,
    objectives: [
      '`Run_Timer` (RTO) accumulates run time across stops',
      'The hour meter survives a Program → Run transition',
      '`Fault_Light` = SERVICE DUE at 30 s of run time (and E-stop / overload as before)',
      'Holding Jog 2 s while stopped resets the meter; a short press or a running motor does not',
    ],
    concepts: ['RTO', 'RES', 'TON', '.DN', '.ACC'],
    starter: {
      rungs: [SAFE_SEAL, '', '', '', RUN_LIGHT, READY_LIGHT, FAULT_LIGHT],
      comments: [
        'Line 3 start/stop (chapter 2)',
        'Hour meter: accumulate run time (RTO)',
        'Service reset: Jog held 2 s while stopped',
        'Reset the hour meter',
        'RUN pilot light (green)',
        'READY pilot light (white)',
        'FAULT pilot light (red) — add SERVICE DUE',
      ],
      tags: [
        { name: 'Run_Timer', dataType: 'TIMER', description: 'Hour meter (demo: service every 30 s of run time)' },
        { name: 'Reset_Hold', dataType: 'TIMER', description: 'Service reset button held 2 s' },
      ],
    },
    solution: {
      rungs: [
        SAFE_SEAL,
        'XIC(Motor_Aux)RTO(Run_Timer,30000,0);',
        'XIC(Jog_PB)XIO(Motor_Aux)TON(Reset_Hold,2000,0);',
        'XIC(Reset_Hold.DN)RES(Run_Timer);',
        RUN_LIGHT,
        READY_LIGHT,
        '[XIO(EStop_OK),XIO(OL_OK),XIC(Run_Timer.DN)]OTE(Fault_Light);',
      ],
    },
    hints: [
      'Three small jobs: an RTO that runs while the motor really runs, a TON that proves Jog has been held for 2 s, and a RES that clears the RTO when that TON is done.',
      'RTO: `XIC(Motor_Aux)RTO(Run_Timer,30000,0)`. Long press: `XIC(Jog_PB)XIO(Motor_Aux)TON(Reset_Hold,2000,0)`, then `XIC(Reset_Hold.DN)RES(Run_Timer)`. Add a third leg `XIC(Run_Timer.DN)` to the fault-light branch.',
      '`XIC(Motor_Aux)RTO(Run_Timer,30000,0);` — `XIC(Jog_PB)XIO(Motor_Aux)TON(Reset_Hold,2000,0);` — `XIC(Reset_Hold.DN)RES(Run_Timer);` — `[XIO(EStop_OK),XIO(OL_OK),XIC(Run_Timer.DN)]OTE(Fault_Light);`',
    ],
    tests: [
      {
        name: 'Run time adds up across stops',
        steps: [
          wait(200),
          tap('start'),
          wait(5000),
          tap('stop'),
          stops('Stop must stop the motor'),
          expectTagRange('Run_Timer.ACC', { min: 4900, max: 5400 }, 'After about 5 s of running, Run_Timer.ACC must hold about 5000 ms', {
            within: 100,
          }),
          expectTagRange('Run_Timer.ACC', { min: 4900, max: 5400 }, 'The hour meter must KEEP its value while the motor is stopped — use an RTO, not a TON', {
            for: 2000,
          }),
          tap('start'),
          wait(5000),
          tap('stop'),
          expectTagRange('Run_Timer.ACC', { min: 9900, max: 10_700 }, 'After a second 5 s run, Run_Timer.ACC must hold about 10000 ms (5 s + 5 s)', {
            within: 100,
            for: 1000,
          }),
          expectObs('faultLight', false, 'No service due yet: the red lamp must be OFF', { for: 100 }),
        ],
      },
      {
        name: 'Counts only while the motor runs',
        steps: [
          wait(200),
          tap('start', 1500),
          wait(1500),
          tap('stop'),
          wait(3000),
          expectTagRange('Run_Timer.ACC', { min: 2800, max: 3200 }, 'The hour meter must count the motor\'s run time only (about 3 s here) — not while Start is held, not while stopped', {
            within: 100,
          }),
        ],
      },
      {
        name: 'Survives Program → Run',
        steps: [
          wait(200),
          tap('start'),
          wait(4000),
          tap('stop'),
          wait(300),
          mode('PROG'),
          wait(1000),
          mode('RUN'),
          expectTagRange('Run_Timer.ACC', { min: 3900, max: 4400 }, 'The hour meter must survive a Program → Run transition (an RTO keeps .ACC on the prescan; a TON clears it)', {
            within: 50,
            for: 1000,
          }),
        ],
      },
      {
        name: 'SERVICE DUE at 30 s — then the long-press reset',
        steps: [
          wait(200),
          tap('start'),
          wait(28_000),
          expectObs('faultLight', false, 'SERVICE DUE came on too early — the service interval is 30 s of run time', { for: 300 }),
          expectObs('faultLight', true, 'SERVICE DUE (Fault_Light) must come on after 30 s of run time', { within: 2500 }),
          expectObs('contactor', true, 'The motor keeps running when service is due (it is a reminder, not a trip)'),
          tap('stop'),
          stops('Stop must stop the motor'),
          expectObs('faultLight', true, 'SERVICE DUE must stay on after the motor stops (an RTO keeps .DN)', { for: 2000 }),
          tap('jog', 500),
          expectObs('faultLight', true, 'A short press of the reset button must not clear the hour meter', { for: 1000 }),
          expectTag('Run_Timer.DN', true, 'A short press must not reset Run_Timer'),
          press('jog'),
          wait(1500),
          expectObs('faultLight', true, 'The reset needs the button held for the full 2 s', { for: 300 }),
          expectObs('faultLight', false, 'Holding the reset button 2 s must clear SERVICE DUE', { within: 500 }),
          release('jog'),
          expectTag('Run_Timer.ACC', 0, 'Holding the reset button 2 s must reset Run_Timer.ACC to 0', { within: 50 }),
          expectObs('faultLight', false, 'SERVICE DUE must stay off after the reset', { for: 1000 }),
        ],
      },
      {
        name: 'No reset while running',
        steps: [
          wait(200),
          tap('start'),
          wait(2000),
          press('jog'),
          wait(3000),
          release('jog'),
          expectTagRange('Run_Timer.ACC', { min: 4500 }, 'The hour meter must not reset while the motor is running', { for: 500 }),
          expectObs('contactor', true, 'The motor must keep running', { for: 100 }),
        ],
      },
      {
        name: 'FAULT lamp still reports the E-stop and the overload',
        steps: [
          wait(200),
          expectObs('faultLight', false, 'FAULT must be OFF when healthy', { for: 300 }),
          set('estop', true),
          expectObs('faultLight', true, 'FAULT must light while the E-stop is pushed', { within: 150, for: 300 }),
          set('estop', false),
          expectObs('faultLight', false, 'FAULT must go OFF when the E-stop is released', { within: 150, for: 300 }),
          set('overload_trip', true),
          expectObs('faultLight', true, 'FAULT must light while the overload is tripped', { within: 150, for: 300 }),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('faultLight', false, 'FAULT must go OFF after the overload reset', { within: 150, for: 300 }),
          tap('start'),
          runs('Start must still run the motor', 500),
        ],
      },
    ],
    invariants: MOTOR_SAFETY,
    parInstructions: 23,
    allowedInstructions: TIMER_PALETTE,
    requiredInstructions: ['RTO', 'RES'],
    debrief: `The RTO is the timer with a memory: it pauses instead of resetting, keeps \`.ACC\` through the prescan, and
only a **RES** brings it back to zero. And you used a TON for something new: a **long press**, so nobody
zeroes the hour meter by brushing a button.

**Field tip:** counting from the **auxiliary contact** logs what the motor *really* did, not what the PLC asked
for. Real hour meters count in hours or minutes (a DINT of milliseconds overflows after 24.8 days!) — the usual
trick is an RTO of one hour whose \`.DN\` pulses a counter, then RES. And put the preset where maintenance can
change it from the HMI, not buried in a rung.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '3-6',
    chapter: 'timing',
    order: 6,
    title: 'Traffic Cycle',
    tagline: 'Six timers, one intersection, zero crashes.',
    kind: 'build',
    sceneId: 'traffic-light',
    difficulty: 4,
    xp: 180,
    briefing: `The city signal shop is swamped, and the intersection outside Riverside's gate has been flashing red for a
week. The city engineer hands Dana a timing sheet and a spare **CompactLogix 5380**. Dana hands them to you.

**The hardware** (5069-OB16, all outputs)
- \`NS_Red\`, \`NS_Yellow\`, \`NS_Green\` → \`Local:2:O.Pt00…02.Data\` — the main street (north–south) heads.
- \`EW_Red\`, \`EW_Yellow\`, \`EW_Green\` → \`Local:2:O.Pt03…05.Data\` — the side street (east–west) heads.
- \`Walk\` / \`Dont_Walk\` → \`Local:2:O.Pt06/07.Data\` — the pedestrian head (next mission).
- Six timer tags are created for you: \`T_NS_Green\`, \`T_NS_Yellow\`, \`T_All_Red_1\`, \`T_EW_Green\`, \`T_EW_Yellow\`,
  \`T_All_Red_2\`.

**Timing sheet** (repeat forever, starting with phase 1 at power-up)

| Phase | NS | EW | Time |
|---|---|---|---|
| 1 | green | red | 10 s |
| 2 | yellow | red | 3 s |
| 3 | red | red | 1 s (all-red clearance) |
| 4 | red | green | 8 s |
| 5 | red | yellow | 3 s |
| 6 | red | red | 1 s (all-red clearance) |

Each head shows **exactly one** lamp at a time. \`Dont_Walk\` is lit steadily; \`Walk\` stays off.
**Never** give NS and EW a green or yellow at the same time — the conflict monitor is watching.`,
    objectives: [
      'Phase 1 NS green 10 s → NS yellow 3 s → all red 1 s',
      'EW green 8 s → EW yellow 3 s → all red 1 s → repeat',
      'One lamp per head; `Dont_Walk` steady, `Walk` off',
      'Never a conflict',
    ],
    concepts: ['TON', '.DN', 'XIC', 'XIO', 'OTE'],
    starter: {
      rungs: ['', '', '', '', '', '', '', '', '', '', '', ''],
      comments: CYCLE_COMMENTS,
      tags: CYCLE_TIMER_TAGS,
    },
    solution: { rungs: [...CYCLE_TIMERS, ...CYCLE_LAMPS, 'OTE(Dont_Walk);'] },
    hints: [
      'Chain the timers: each phase timer starts when the previous one is **done**. The last one\'s done bit must restart the first one — and when the first timer resets, the whole chain resets behind it.',
      'Timers: `XIO(T_All_Red_2.DN)TON(T_NS_Green,10000,0)`, then `XIC(T_NS_Green.DN)TON(T_NS_Yellow,3000,0)` and so on. Lamps read the done bits: NS green = NOT `T_NS_Green.DN`; NS yellow = `T_NS_Green.DN` AND NOT `T_NS_Yellow.DN`; NS red = `T_NS_Yellow.DN`.',
      'Lamps: `XIO(T_NS_Green.DN)OTE(NS_Green);` `XIC(T_NS_Green.DN)XIO(T_NS_Yellow.DN)OTE(NS_Yellow);` `XIC(T_NS_Yellow.DN)OTE(NS_Red);` `XIC(T_All_Red_1.DN)XIO(T_EW_Green.DN)OTE(EW_Green);` `XIC(T_EW_Green.DN)XIO(T_EW_Yellow.DN)OTE(EW_Yellow);` `[XIO(T_All_Red_1.DN),XIC(T_EW_Yellow.DN)]OTE(EW_Red);` and an unconditional `OTE(Dont_Walk);`',
    ],
    tests: [
      {
        name: 'Power-up: NS green',
        steps: [
          expectObs('nsGreen', true, 'At power-up the cycle must start with NS green', { within: 200 }),
          expectObs('ewRed', true, 'At power-up EW must show red', { within: 50 }),
          lampNow('nsRed', false, 'NS red must be OFF while NS is green'),
          lampNow('nsYellow', false, 'NS yellow must be OFF while NS is green'),
          lampNow('ewGreen', false, 'EW green must be OFF while NS is green'),
          lampNow('ewYellow', false, 'EW yellow must be OFF while NS is green'),
          expectObs('dontWalk', true, "DON'T WALK must be lit steadily", { for: 2000 }),
        ],
      },
      {
        name: 'One full cycle, on time',
        description: 'Follows the timing sheet phase by phase (tolerance −0.4 / +0.6 s per phase) and into the next cycle.',
        steps: [
          expectObs('nsGreen', true, 'At power-up the cycle must start with NS green', { within: 200 }),
          ...cycleSteps(),
          expectObs('nsGreen', true, 'Second cycle: NS green must last 10 s again', { for: 9600 }),
          expectObs('nsGreen', false, 'Second cycle: NS green must end after 10 s', { within: 600 }),
          expectObs('nsYellow', true, 'Second cycle: NS yellow must follow NS green', { within: 50 }),
        ],
      },
      {
        name: 'Traffic flows both ways',
        steps: [
          wait(28_000),
          expectObsRange('carsPassed', { min: 4 }, 'Cars on both streets must get through the intersection'),
          expectObs('conflicts', 0, 'The conflict monitor must not have tripped'),
        ],
      },
    ],
    invariants: [
      NO_CONFLICT,
      { tag: 'Walk', equals: false, message: 'WALK must stay off in this mission' },
      { tag: 'Dont_Walk', equals: true, graceMs: 10, message: "DON'T WALK must be lit steadily" },
    ],
    parInstructions: 29,
    allowedInstructions: TIMER_PALETTE,
    debrief: `A chain of on-delay timers is the simplest sequencer there is: each **.DN** starts the next phase, and the
last one resets the first — the whole chain collapses in a single scan and starts over. The lamps are pure
logic on the done bits, so a head can never show two colors.

**Field tip:** real signal controllers add a hardware **conflict monitor** (MMU) that watches the lamp voltages
and throws the intersection into flashing red if two conflicting greens ever appear — independent of the
program, exactly like a hardwired E-stop. The **all-red clearance** is there for the driver who ran the
yellow. In chapter 6 you'll rebuild this with a step number and a state machine — much easier to change.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '3-7',
    chapter: 'timing',
    order: 7,
    title: 'Walk Signal',
    tagline: 'Boss: a pedestrian call button — without a single conflict.',
    kind: 'boss',
    sceneId: 'traffic-light',
    difficulty: 5,
    xp: 320,
    briefing: `The signal works — and the neighborhood noticed. A school opens next to the intersection in September, and
the city wants the **pedestrian crossing** of the main street working by then. Your fixed-time cycle from
mission 3-6 is loaded.

**The hardware**
- \`Ped_PB\` → \`Local:1:I.Pt00.Data\` — pedestrian push button, **N.O.**: 1 only while pressed (a quick jab!).
- \`Walk\` → \`Local:2:O.Pt06.Data\` — WALK (white figure), for crossing the **main street**.
- \`Dont_Walk\` → \`Local:2:O.Pt07.Data\` — DON'T WALK (orange hand).
- Tags created for you: \`Ped_Request\`, \`Walk_Active\` (BOOL) and \`T_Walk\`, \`T_Flash_On\`, \`T_Flash_Off\` (TIMER).

**Specification**
1. The vehicle cycle stays exactly as in 3-6.
2. A press of \`Ped_PB\` is **remembered** (\`Ped_Request\`) until it is served.
3. A request is served at the **start of the next NS red interval** — the moment NS yellow ends. WALK is then
   lit for **6 s**. (A request that comes in later than that waits for the next cycle.)
4. After WALK, DON'T WALK **flashes** (0.5 s / 0.5 s, pedestrian clearance) until NS turns green again; then
   it is steady.
5. Without a request: DON'T WALK steady, no WALK. One press = one WALK: the request is cleared once served.
6. **Never** WALK while NS is green or yellow, and never WALK and DON'T WALK together.

What a press *during* WALK does is up to you (we don't test it).`,
    objectives: [
      'The vehicle cycle is unchanged',
      '`Ped_PB` latches a request that is served at the next NS red interval',
      'WALK 6 s, then flashing DON\'T WALK until NS green',
      'One press = one WALK; no WALK without a request',
      'Never WALK with NS green/yellow, never WALK + DON\'T WALK together',
    ],
    concepts: ['TON', 'XIC', 'XIO', 'OTE', 'OTL', 'OTU'],
    starter: {
      rungs: [...CYCLE_TIMERS, '', '', '', '', '', ...CYCLE_LAMPS, 'OTE(Dont_Walk);', ''],
      comments: [
        ...CYCLE_COMMENTS.slice(0, 6),
        'Pedestrian request (remember the button press)',
        'WALK phase active: starts when NS yellow ends, lasts until NS green',
        'WALK timer (6 s)',
        'Clearance flasher: lit phase',
        'Clearance flasher: dark phase',
        ...CYCLE_COMMENTS.slice(6),
        "DON'T WALK — steady for now",
        'WALK lamp',
      ],
      tags: [
        ...CYCLE_TIMER_TAGS,
        { name: 'Ped_Request', dataType: 'BOOL', description: 'Pedestrian call waiting to be served' },
        { name: 'Walk_Active', dataType: 'BOOL', description: 'Pedestrian phase: WALK + clearance, until NS green' },
        { name: 'T_Walk', dataType: 'TIMER', description: 'WALK time (6 s)' },
        { name: 'T_Flash_On', dataType: 'TIMER', description: "Flashing DON'T WALK: lit phase" },
        { name: 'T_Flash_Off', dataType: 'TIMER', description: "Flashing DON'T WALK: dark phase" },
      ],
    },
    solution: {
      rungs: [
        ...CYCLE_TIMERS,
        '[XIC(Ped_PB),XIC(Ped_Request)]XIO(Walk)OTE(Ped_Request);',
        '[XIC(Ped_Request)XIC(T_NS_Yellow.DN)XIO(T_All_Red_1.DN),XIC(Walk_Active)]XIC(T_NS_Yellow.DN)OTE(Walk_Active);',
        'XIC(Walk_Active)TON(T_Walk,6000,0);',
        'XIC(T_Walk.DN)XIO(T_Flash_Off.DN)TON(T_Flash_On,500,0);',
        'XIC(T_Flash_On.DN)TON(T_Flash_Off,500,0);',
        ...CYCLE_LAMPS,
        '[XIO(Walk_Active),XIC(T_Walk.DN)XIO(T_Flash_On.DN)]OTE(Dont_Walk);',
        'XIC(Walk_Active)XIO(T_Walk.DN)OTE(Walk);',
      ],
    },
    hints: [
      'Break it into small memories: "someone pressed" (`Ped_Request`), "the pedestrian phase is running" (`Walk_Active`, from the end of NS yellow until NS green), and timers for WALK and the flasher you built in 3-3.',
      '`Ped_Request`: seal-in on `Ped_PB`, cleared by `Walk`. `Walk_Active` starts when a request is waiting during the first all-red (`T_NS_Yellow.DN` AND NOT `T_All_Red_1.DN`) and seals while `T_NS_Yellow.DN` stays on. `T_Walk` (6 s) runs on `Walk_Active`; WALK = `Walk_Active` AND NOT `T_Walk.DN`; the flasher runs on `T_Walk.DN`.',
      '`[XIC(Ped_PB),XIC(Ped_Request)]XIO(Walk)OTE(Ped_Request);` — `[XIC(Ped_Request)XIC(T_NS_Yellow.DN)XIO(T_All_Red_1.DN),XIC(Walk_Active)]XIC(T_NS_Yellow.DN)OTE(Walk_Active);` — `XIC(Walk_Active)TON(T_Walk,6000,0);` — `XIC(T_Walk.DN)XIO(T_Flash_Off.DN)TON(T_Flash_On,500,0);` — `XIC(T_Flash_On.DN)TON(T_Flash_Off,500,0);` — `XIC(Walk_Active)XIO(T_Walk.DN)OTE(Walk);` — `[XIO(Walk_Active),XIC(T_Walk.DN)XIO(T_Flash_On.DN)]OTE(Dont_Walk);`',
    ],
    tests: [
      {
        name: 'No button, no WALK',
        steps: [
          expectObs('nsGreen', true, 'At power-up the cycle must start with NS green', { within: 200 }),
          expectObs('dontWalk', true, "Without a request DON'T WALK must stay lit steadily (and WALK off) for the whole cycle", {
            within: 50,
            for: 27_000,
          }),
        ],
      },
      {
        name: 'Request during NS green: WALK at the next NS red',
        steps: [
          wait(2000),
          tap('ped', 150),
          expectObs('pedWaiting', true, 'A pedestrian should be waiting at the kerb', { within: 50 }),
          expectObs('walk', false, 'WALK must wait for the NS red interval', { for: 7000 }),
          ...untilNsRedInterval(),
          expectObs('walk', true, 'WALK must light at the start of the NS red interval (when NS yellow ends)', { within: 300 }),
          expectObs('dontWalk', false, "DON'T WALK must be off during WALK", { within: 50 }),
          expectObs('walk', true, 'WALK must stay lit for 6 s', { for: 5600 }),
          expectObs('walk', false, 'WALK must end after 6 s', { within: 700 }),
          ...flashes('dontWalk', "Pedestrian clearance: DON'T WALK", 2),
          expectObs('nsGreen', true, 'The vehicle cycle must continue to NS green', { within: 6000 }),
          expectObsRange('pedCrossed', { min: 1 }, 'The pedestrian must have made it across', {}),
          expectObs('dontWalk', true, "Once NS is green, DON'T WALK must be steady again", { within: 100, for: 3000 }),
          expectObs('walk', false, 'One press = one WALK: the request must be cleared once it has been served', { for: 24_000 }),
        ],
      },
      {
        name: 'Late request waits for the next cycle',
        description: 'The button is pressed during EW green, after the NS red interval has started.',
        steps: [
          expectObs('ewGreen', true, 'The cycle must reach EW green', { within: 16_000 }),
          wait(1000),
          tap('ped', 150),
          expectObs('walk', false, 'A request made during EW green must wait for the NEXT NS red interval', { for: 11_500 }),
          ...untilNsRedInterval(),
          expectObs('walk', true, 'WALK must light at the start of the next NS red interval', { within: 300 }),
          expectObs('walk', true, 'WALK must stay lit for 6 s', { for: 5600 }),
          expectObs('walk', false, 'WALK must end after 6 s', { within: 700 }),
        ],
      },
      {
        name: 'Request during the clearance is served next cycle',
        steps: [
          wait(2000),
          tap('ped', 150),
          ...untilNsRedInterval(),
          expectObs('walk', true, 'WALK must light at the start of the NS red interval', { within: 300 }),
          expectObs('walk', false, 'WALK must end after 6 s', { within: 6700 }),
          wait(1500),
          tap('ped', 150),
          expectObs('nsGreen', true, 'The vehicle cycle must continue to NS green', { within: 6000 }),
          expectObs('walk', false, 'WALK must wait for the next NS red interval', { for: 9000 }),
          ...untilNsRedInterval(6000),
          expectObs('walk', true, 'The button was pressed during the clearance: that request must be served in the next cycle', {
            within: 300,
          }),
        ],
      },
      {
        name: 'The cycle keeps its timing with pedestrians',
        steps: [
          tap('ped', 150),
          expectObs('nsGreen', true, 'At power-up the cycle must start with NS green', { within: 200 }),
          ...cycleSteps(),
        ],
      },
    ],
    invariants: [
      NO_CONFLICT,
      {
        when: { observe: 'walk', equals: true },
        observe: 'dontWalk',
        equals: false,
        graceMs: 10,
        message: "WALK and DON'T WALK must never be lit together",
      },
    ],
    parInstructions: 52,
    allowedInstructions: TIMER_PALETTE,
    debrief: `The intersection passes the city's acceptance test: a latched request, a phase window, a timed WALK and a
flashing clearance, woven into a cycle that never lets two conflicting movements go at once.

**Field tip:** starting WALK a second before the parallel green — as you just did during the all-red — is a
real safety feature called a **Leading Pedestrian Interval** (LPI): pedestrians step out before turning
cars start moving and are much more visible. Real controllers also hold the clearance time from the
crossing width (about 1.1 m/s walking speed) and count it down on the pedestrian head.`,
  },
];
