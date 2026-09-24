/**
 * Chapter 1 — Power Up (scene 'trainer'): XIC / XIO / OTE, series (AND) and parallel (OR) logic,
 * the N.C. push-button trap, exclusive OR and a lamp-test boss.
 */
import type { MissionDef, TestStep } from '../types';
import { expectObs, press, release, set, wait } from './authoring';

const BITS = ['XIC', 'XIO', 'OTE'];

/** Switch a bench toggle switch. */
const sw = (n: number, on: boolean): TestStep => set(`sw${n}`, on);

/** Lamp / buzzer must reach `value` within 100 ms and then hold it for `hold` ms. */
const lamp = (id: string, value: boolean, message: string, hold = 300): TestStep =>
  expectObs(id, value, message, { within: 100, for: hold });

export const CH1_MISSIONS: MissionDef[] = [
  // -------------------------------------------------------------------------
  {
    id: '1-1',
    chapter: 'power-up',
    order: 1,
    title: 'Hello, Lamp',
    tagline: 'Make a pilot light follow a switch.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 1,
    xp: 50,
    briefing: `Welcome to **Riverside Manufacturing**! I'm Dana, senior controls tech — you're shadowing me this week.
Before anyone lets you near a production line, every new tech proves themselves on the **trainer bench**:
a ControlLogix **1756-L85E** with a 16-point DC input card (slot 1), a 16-point output card (slot 2), toggle
switches, push buttons and pilot lights.

**The hardware**
- \`Switch_0\` → \`Local:1:I.Data.0\` — a maintained toggle switch. Up = ON = input bit **1**.
- \`Light_0\` → \`Local:2:O.Data.0\` — a green pilot light on output point 0.

Those friendly names are **alias tags**: they point at the real I/O addresses, so your logic reads like the
wiring diagram.

**Your task**
Make \`Light_0\` light while \`Switch_0\` is ON, and go dark when it is OFF.

Use **XIC** (*Examine If Closed*) — it is *true* while its bit is 1 — in front of an **OTE**
(*Output Energize*), which writes the rung result to its bit on every scan.`,
    objectives: [
      '`Light_0` is OFF while `Switch_0` is OFF',
      '`Light_0` turns ON when `Switch_0` is switched ON',
      '`Light_0` goes OFF again when `Switch_0` goes OFF',
      'No other switch affects `Light_0`',
    ],
    concepts: ['XIC', 'OTE'],
    starter: { rungs: [''], comments: ['Rung 0: make Light_0 follow Switch_0'] },
    solution: { rungs: ['XIC(Switch_0)OTE(Light_0);'] },
    hints: [
      'A rung reads left to right like a circuit: conditions (contacts) on the left, the output (coil) on the right rail.',
      'You need an input instruction that is true when `Switch_0` is 1 — that is **XIC** — followed by an **OTE** on `Light_0`.',
      'The whole rung is `XIC(Switch_0)OTE(Light_0);` — drag an XIC and an OTE onto rung 0, or type it in the neutral-text box.',
    ],
    tests: [
      {
        name: 'Lamp is dark while the switch is OFF',
        steps: [wait(200), expectObs('light0', false, 'Light_0 must stay OFF while Switch_0 is OFF', { for: 500 })],
      },
      {
        name: 'Lamp follows the switch',
        steps: [
          wait(100),
          sw(0, true),
          lamp('light0', true, 'Light_0 should turn ON when Switch_0 is ON', 500),
          sw(0, false),
          lamp('light0', false, 'Light_0 should turn OFF when Switch_0 goes OFF (an OTE follows its rung every scan)', 500),
          sw(0, true),
          lamp('light0', true, 'Light_0 should turn ON again when Switch_0 is switched back ON'),
        ],
      },
      {
        name: 'Only Switch_0 controls the lamp',
        description: 'Flips every other switch: Light_0 must not care.',
        steps: [
          wait(100),
          ...[1, 2, 3, 4, 5, 6, 7].map((n) => sw(n, true)),
          lamp('light0', false, 'Light_0 must ignore Switch_1…Switch_7 — only Switch_0 controls it'),
          sw(0, true),
          lamp('light0', true, 'Light_0 should turn ON with Switch_0 ON'),
          ...[1, 2, 3, 4, 5, 6, 7].map((n) => sw(n, false)),
          lamp('light0', true, 'Light_0 must stay ON with only Switch_0 ON'),
        ],
      },
    ],
    parInstructions: 2,
    allowedInstructions: BITS,
    debrief: `That's the heart of every PLC: **read inputs → solve the logic → write outputs**, over and over. It's
called the **scan cycle**, and a ControlLogix scans a rung like this in microseconds, so the lamp seems to
follow the switch instantly.

**Field tip:** when you're online in Studio 5000, true contacts and energized coils are highlighted in green.
Watching the highlighting is the fastest way to find out *why* an output is — or isn't — on.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '1-2',
    chapter: 'power-up',
    order: 2,
    title: 'Opposite Day',
    tagline: 'Light a warning when a switch is OFF.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 1,
    xp: 60,
    briefing: `Gus from maintenance has a job for you. The stamping press guard door has a position switch,
simulated on the bench by \`Switch_1\`: **guard closed = switch ON (1)**. The amber lamp \`Light_2\`
must warn **GUARD OPEN** whenever that switch is **OFF**.

**The hardware**
- \`Switch_1\` → \`Local:1:I.Data.1\` — ON (1) when the guard is closed.
- \`Light_2\` → \`Local:2:O.Data.2\` — amber pilot light "GUARD OPEN".

**Your task**
Light \`Light_2\` while \`Switch_1\` is OFF. That's the job of **XIO** (*Examine If Open*): it is *true*
while its bit is **0**.`,
    objectives: [
      '`Light_2` is ON while `Switch_1` is OFF (guard open)',
      '`Light_2` is OFF while `Switch_1` is ON (guard closed)',
      'Other switches do not affect the warning',
    ],
    concepts: ['XIO', 'OTE'],
    starter: { rungs: [''], comments: ['GUARD OPEN warning lamp'] },
    solution: { rungs: ['XIO(Switch_1)OTE(Light_2);'] },
    hints: [
      'You want the rung to be TRUE when the bit is 0. Which instruction is true for a 0?',
      '**XIO** passes power while its bit is 0 (think "examine if open"). Drive `Light_2` with an OTE.',
      'The rung is `XIO(Switch_1)OTE(Light_2);`',
    ],
    tests: [
      {
        name: 'Warning ON while the guard is open',
        steps: [wait(100), lamp('light2', true, 'Light_2 (GUARD OPEN) must be ON while Switch_1 is OFF', 500)],
      },
      {
        name: 'Warning OFF when the guard closes',
        steps: [
          wait(100),
          sw(1, true),
          lamp('light2', false, 'Light_2 must turn OFF when Switch_1 is ON (guard closed)', 500),
          sw(1, false),
          lamp('light2', true, 'Light_2 must turn ON again when the guard opens (Switch_1 OFF)'),
        ],
      },
      {
        name: 'Other switches do not matter',
        steps: [
          wait(100),
          ...[0, 2, 3, 4, 5, 6, 7].map((n) => sw(n, true)),
          lamp('light2', true, 'Light_2 must stay ON — only Switch_1 tells us whether the guard is closed'),
          sw(1, true),
          lamp('light2', false, 'Light_2 must turn OFF when Switch_1 is ON'),
        ],
      },
    ],
    parInstructions: 2,
    allowedInstructions: BITS,
    debrief: `XIO doesn't mean "normally-closed device". The instruction only examines the **bit**: XIC asks
"is it 1?", XIO asks "is it 0?". Whether a device is N.O. or N.C. is about **wiring**; which instruction
you pick is about **what you want to detect**. Keep those two ideas apart and you'll dodge the most common
beginner bug (coming up in mission 1-5).

**Field tip:** on a real press, guard monitoring is done by a safety relay or a GuardLogix safety
controller. A standard PLC lamp like this one is only an *indication*.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '1-3',
    chapter: 'power-up',
    order: 3,
    title: 'Two-Key Launch',
    tagline: 'Series contacts: both conditions must be true.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 1,
    xp: 70,
    briefing: `R&D built a compressed-air test rig and the safety committee insists on a **two-person rule**:
the rig's red **ARMED** lamp may light only when **both** the operator's key AND the supervisor's key are ON.

**The hardware**
- \`Switch_2\` → \`Local:1:I.Data.2\` — operator key switch (ON = 1).
- \`Switch_3\` → \`Local:1:I.Data.3\` — supervisor key switch (ON = 1).
- \`Light_4\` → \`Local:2:O.Data.4\` — red pilot light "ARMED".

**Your task**
\`Light_4\` must be ON only while **both** keys are ON. Contacts placed one after another **in series**
form a logical **AND**: power only reaches the coil if every contact passes it.`,
    objectives: [
      '`Light_4` is OFF with no key or only one key ON',
      '`Light_4` is ON while both `Switch_2` AND `Switch_3` are ON',
      '`Light_4` drops out as soon as either key is turned OFF',
    ],
    concepts: ['XIC', 'OTE'],
    starter: { rungs: [''], comments: ['ARMED lamp: operator key AND supervisor key'] },
    solution: { rungs: ['XIC(Switch_2)XIC(Switch_3)OTE(Light_4);'] },
    hints: [
      'Think of the rung as a wire: current must pass through BOTH key contacts to reach the lamp.',
      'Put two XIC instructions in series (one after the other) on the same rung, then the OTE.',
      'The rung is `XIC(Switch_2)XIC(Switch_3)OTE(Light_4);`',
    ],
    tests: [
      {
        name: 'No keys: not armed',
        steps: [wait(200), expectObs('light4', false, 'Light_4 must be OFF with both keys OFF', { for: 300 })],
      },
      {
        name: 'One key is not enough',
        steps: [
          wait(100),
          sw(2, true),
          lamp('light4', false, 'Light_4 must stay OFF with only the operator key (Switch_2) ON', 500),
          sw(2, false),
          sw(3, true),
          lamp('light4', false, 'Light_4 must stay OFF with only the supervisor key (Switch_3) ON', 500),
        ],
      },
      {
        name: 'Both keys arm the rig',
        steps: [
          wait(100),
          sw(2, true),
          sw(3, true),
          lamp('light4', true, 'Light_4 must turn ON when both keys are ON', 500),
          sw(2, false),
          lamp('light4', false, 'Light_4 must turn OFF as soon as the operator key goes OFF'),
          sw(2, true),
          lamp('light4', true, 'Light_4 must turn ON again with both keys ON'),
          sw(3, false),
          lamp('light4', false, 'Light_4 must turn OFF as soon as the supervisor key goes OFF'),
        ],
      },
    ],
    parInstructions: 3,
    allowedInstructions: BITS,
    debrief: `Series contacts = **AND**. Every condition on the path must be true for power to flow to the coil.

**Field tip:** real two-hand controls (on presses, for example) go much further: a safety relay demands
that both buttons are pressed within about 0.5 s of each other and released between cycles, so nobody can
tape one button down. "Anti-tie-down" is the term to search for.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '1-4',
    chapter: 'power-up',
    order: 4,
    title: 'Either Way',
    tagline: 'Parallel branches: either condition will do.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 2,
    xp: 80,
    briefing: `Assembly line 2 is 40 meters long. Before anyone reaches into the conveyor, the operator sounds the
**warning buzzer** — and there must be a button at **each end** of the line.

**The hardware**
- \`PB_Black_1\` → \`Local:1:I.Data.10\` — black flush push button at station A, **N.O.** (1 while pressed).
- \`PB_Black_2\` → \`Local:1:I.Data.11\` — black flush push button at station B, **N.O.** (1 while pressed).
- \`Buzzer\` → \`Local:2:O.Data.8\` — the panel buzzer.

**Your task**
The \`Buzzer\` sounds while **either** button (or both) is held. Contacts **in parallel** — a **branch** —
form a logical **OR**: power can take either path to the coil.

**Careful** — tempting shortcut: two separate rungs that both write \`OTE(Buzzer)\`. Try it and see what happens…`,
    objectives: [
      'The buzzer is quiet when no button is pressed',
      'Holding `PB_Black_1` sounds the buzzer',
      'Holding `PB_Black_2` sounds the buzzer',
      'The buzzer stops when the buttons are released',
    ],
    concepts: ['XIC', 'OTE'],
    starter: { rungs: [''], comments: ['Warning buzzer: station A OR station B'] },
    solution: { rungs: ['[XIC(PB_Black_1),XIC(PB_Black_2)]OTE(Buzzer);'] },
    hints: [
      'You need two paths to the same coil: one through station A\'s button, one through station B\'s.',
      'Add a **branch** around the first contact and put the second button\'s XIC on the lower leg. One rung, one OTE.',
      'The rung is `[XIC(PB_Black_1),XIC(PB_Black_2)]OTE(Buzzer);` — two separate OTE rungs fight each other and the last one wins.',
    ],
    tests: [
      {
        name: 'Quiet when nobody presses',
        steps: [wait(200), expectObs('buzzer', false, 'The buzzer must be quiet when no button is pressed', { for: 300 })],
      },
      {
        name: 'Station A sounds the buzzer',
        steps: [
          wait(100),
          press('pb_black1'),
          lamp('buzzer', true, 'Holding PB_Black_1 (station A) must sound the buzzer', 500),
          release('pb_black1'),
          lamp('buzzer', false, 'The buzzer must stop when PB_Black_1 is released'),
        ],
      },
      {
        name: 'Station B sounds the buzzer',
        steps: [
          wait(100),
          press('pb_black2'),
          lamp('buzzer', true, 'Holding PB_Black_2 (station B) must sound the buzzer', 500),
          release('pb_black2'),
          lamp('buzzer', false, 'The buzzer must stop when PB_Black_2 is released'),
        ],
      },
      {
        name: 'Both stations at once',
        steps: [
          wait(100),
          press('pb_black1'),
          press('pb_black2'),
          lamp('buzzer', true, 'The buzzer must sound with both buttons held'),
          release('pb_black1'),
          lamp('buzzer', true, 'The buzzer must keep sounding while PB_Black_2 is still held'),
          release('pb_black2'),
          lamp('buzzer', false, 'The buzzer must stop when both buttons are released'),
        ],
      },
    ],
    parInstructions: 3,
    allowedInstructions: BITS,
    debrief: `Parallel branch = **OR**.

And the shortcut? With two rungs \`XIC(PB_Black_1)OTE(Buzzer)\` and \`XIC(PB_Black_2)OTE(Buzzer)\`, the
first rung turns the bit ON and the second immediately turns it OFF again in the same scan — an OTE
writes its bit **every** scan, true *or* false. Only the last rung "wins", so station A never works.
Studio 5000 warns about it at verify time: *Duplicate destructive bit reference*.

**Field tip:** one output, one OTE. When several conditions drive an output, gather them in branches on a
single rung — the next tech will thank you.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '1-5',
    chapter: 'power-up',
    order: 5,
    title: 'The N.C. Trap',
    tagline: 'A normally-closed button reads 1 when NOT pressed.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 2,
    xp: 90,
    briefing: `Dana leans over: *"Every new tech falls for this one exactly once."*

The red button on the bench is wired like a real **Stop** button: its contact is **normally closed (N.C.)**.
At rest the contact is closed, so the input reads **1**. Pressing the button **opens** the contact and the
input drops to **0**.

**The hardware**
- \`PB_Red\` → \`Local:1:I.Data.9\` — red extended push button, **N.C.**: **1 when NOT pressed, 0 while pressed**.
- \`Light_5\` → \`Local:2:O.Data.5\` — red pilot light "STOP PRESSED".
- \`Buzzer\` → \`Local:2:O.Data.8\` — panel buzzer.
- \`Light_1\` → \`Local:2:O.Data.1\` — green pilot light "READY".

**Your task**
- While the red button is **pressed**: \`Light_5\` ON **and** the \`Buzzer\` sounds.
- While it is **not pressed**: \`Light_1\` (READY) is ON.

Tip: one rung can drive two outputs — put a branch around the coils.`,
    objectives: [
      '`Light_1` (READY) is ON while the red button is not pressed',
      '`Light_5` and the `Buzzer` are ON while the red button is pressed',
      'Everything returns to normal when the button is released',
    ],
    concepts: ['XIO', 'XIC', 'OTE'],
    starter: {
      rungs: ['XIC(PB_Red)OTE(Light_5);', ''],
      comments: ['Red lamp while the red button is pressed... is it?', 'READY lamp while the red button is NOT pressed'],
    },
    solution: { rungs: ['XIO(PB_Red)[OTE(Light_5),OTE(Buzzer)];', 'XIC(PB_Red)OTE(Light_1);'] },
    hints: [
      'Watch the `PB_Red` bit in the tag monitor while you press the button. Which value means "pressed"?',
      'Pressed = bit **0** → use **XIO** for "pressed" and **XIC** for "not pressed". Output branch: `[OTE(A),OTE(B)]`.',
      'Rung 0: `XIO(PB_Red)[OTE(Light_5),OTE(Buzzer)];` — Rung 1: `XIC(PB_Red)OTE(Light_1);`',
    ],
    tests: [
      {
        name: 'Button released: READY, no alarm',
        steps: [
          wait(200),
          lamp('light1', true, 'Light_1 (READY) must be ON while the red button is NOT pressed'),
          expectObs('light5', false, 'Light_5 must be OFF while the red button is not pressed', { for: 300 }),
          expectObs('buzzer', false, 'The buzzer must be quiet while the red button is not pressed', { for: 300 }),
        ],
      },
      {
        name: 'Button pressed: alarm lamp and buzzer',
        steps: [
          wait(200),
          press('pb_red'),
          lamp('light5', true, 'Light_5 must turn ON while the red (N.C.) button is pressed — its input reads 0 then'),
          lamp('buzzer', true, 'The buzzer must sound while the red button is pressed'),
          lamp('light1', false, 'Light_1 (READY) must be OFF while the red button is pressed'),
          release('pb_red'),
          lamp('light5', false, 'Light_5 must turn OFF when the red button is released'),
          lamp('buzzer', false, 'The buzzer must stop when the red button is released'),
          lamp('light1', true, 'Light_1 (READY) must come back when the red button is released'),
        ],
      },
      {
        name: 'Quick jab',
        steps: [
          wait(200),
          press('pb_red'),
          wait(80),
          expectObs('light5', true, 'Even a short press must light Light_5', { within: 100 }),
          release('pb_red'),
          lamp('light5', false, 'Light_5 must go OFF right after the release'),
          lamp('light1', true, 'READY must be back ON after the release'),
        ],
      },
    ],
    parInstructions: 5,
    allowedInstructions: BITS,
    debrief: `**Why are Stop buttons normally closed?** Wires break, terminals loosen, connectors get kicked out.
With an N.O. stop button, a broken wire would *silently* disable Stop — you'd press it in an emergency and
nothing would happen. With an **N.C.** contact, a broken wire looks exactly like a pressed button: the
machine stops. That's **fail-safe** design.

So in almost every motor rung you'll see \`XIC(Stop_PB)\` — "examine if closed" = "the stop button is NOT
pressed". The instruction describes the **bit**, never the device.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '1-6',
    chapter: 'power-up',
    order: 6,
    title: 'Stairwell Switch',
    tagline: 'Either switch toggles the light: exclusive OR.',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 3,
    xp: 100,
    briefing: `The warehouse mezzanine stairs have a light switch at the **bottom** and another at the **top**.
Flipping **either** switch must toggle the stair light — whatever position the other one is in.
Electricians call it a *three-way switch circuit*; in logic it's an **exclusive OR (XOR)**.

**The hardware**
- \`Switch_4\` → \`Local:1:I.Data.4\` — bottom-of-stairs switch.
- \`Switch_5\` → \`Local:1:I.Data.5\` — top-of-stairs switch.
- \`Light_6\` → \`Local:2:O.Data.6\` — blue pilot light (the stair light).

**Your task**
\`Light_6\` is ON when **exactly one** of the two switches is ON. Both OFF or both ON = dark.`,
    objectives: [
      'Both switches OFF: light OFF',
      'Flipping either switch toggles the light',
      'Both switches ON: light OFF',
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: { rungs: [''], comments: ['Stair light: bottom switch XOR top switch'] },
    solution: { rungs: ['[XIC(Switch_4)XIO(Switch_5),XIO(Switch_4)XIC(Switch_5)]OTE(Light_6);'] },
    hints: [
      'Write the truth table: 00 → OFF, 10 → ON, 01 → ON, 11 → OFF. When exactly is the light ON?',
      'Two cases light the lamp: "bottom ON and top OFF" or "bottom OFF and top ON". Each case is a series pair; the two cases are parallel.',
      'The rung is `[XIC(Switch_4)XIO(Switch_5),XIO(Switch_4)XIC(Switch_5)]OTE(Light_6);`',
    ],
    tests: [
      {
        name: 'Walk up and down the stairs',
        description: 'Flips the switches like people using the stairs and checks every combination.',
        steps: [
          wait(200),
          expectObs('light6', false, 'Both switches OFF: the stair light must be OFF', { for: 300 }),
          sw(4, true),
          lamp('light6', true, 'Flipping the bottom switch (Switch_4 ON) must turn the light ON'),
          sw(5, true),
          lamp('light6', false, 'Flipping the top switch (both ON now) must turn the light OFF'),
          sw(4, false),
          lamp('light6', true, 'Flipping the bottom switch (only Switch_5 ON) must turn the light ON'),
          sw(5, false),
          lamp('light6', false, 'Flipping the top switch (both OFF) must turn the light OFF'),
          sw(5, true),
          lamp('light6', true, 'Only the top switch ON: the light must be ON'),
          sw(4, true),
          lamp('light6', false, 'Both switches ON: the light must be OFF'),
        ],
      },
      {
        name: 'Other switches do not matter',
        steps: [
          wait(100),
          ...[0, 1, 2, 3, 6, 7].map((n) => sw(n, true)),
          lamp('light6', false, 'Other switches must not light the stairs'),
          sw(4, true),
          lamp('light6', true, 'Only Switch_4 of the stair switches ON: light ON'),
        ],
      },
    ],
    parInstructions: 5,
    allowedInstructions: BITS,
    debrief: `Exclusive OR from plain contacts: two legs, each one "this switch but not that one".

**Field tip:** the same pattern detects **disagreement**, which is gold for diagnostics: a valve commanded
open whose limit switch still says closed, a motor commanded on without its auxiliary contact... Logix also
has an **XOR** instruction, but it works on whole integers bit by bit — handy for comparing 32 inputs at once.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '1-7',
    chapter: 'power-up',
    order: 7,
    title: 'Control Panel Check',
    tagline: 'Boss: a real operator panel — with a lamp test.',
    kind: 'boss',
    sceneId: 'trainer',
    difficulty: 3,
    xp: 150,
    briefing: `Final exam of the week. Riverside is shipping a new operator panel and you are programming it on the
bench before it goes out. Dana hands you the spec sheet:

**Inputs**
- \`Switch_0\` — main power key (ON = 1).
- \`Switch_1\` — guard door closed (ON = 1).
- \`PB_Red\` — STOP push button, **N.C.** (1 when NOT pressed).
- \`PB_Black_1\`, \`PB_Black_2\` — call buttons at the two operator stations, N.O.
- \`PB_Green\` — **LAMP TEST** push button, N.O.

**Outputs & function**
1. \`Light_0\` (green) **READY** — key ON **and** guard closed **and** STOP not pressed.
2. \`Light_2\` (amber) **CALL** — while either call button is held.
3. \`Light_4\` (red) **STOP** — while the STOP button is pressed.
4. \`Buzzer\` — the guard is open **while** the power key is ON.
5. **LAMP TEST** — while \`PB_Green\` is held, \`Light_0\`, \`Light_2\` and \`Light_4\` all light
   (so operators can spot a burnt-out lamp). The lamp test must **not** sound the buzzer.`,
    objectives: [
      'READY = key ON AND guard closed AND STOP not pressed',
      'CALL lamp from either station',
      'STOP lamp while the N.C. STOP button is pressed',
      'Buzzer when the guard opens with the key ON',
      'LAMP TEST lights READY, CALL and STOP — but not the buzzer',
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: {
      rungs: ['', '', '', ''],
      comments: ['READY lamp (green)', 'CALL lamp (amber)', 'STOP lamp (red)', 'Guard-open buzzer'],
    },
    solution: {
      rungs: [
        '[XIC(Switch_0)XIC(Switch_1)XIC(PB_Red),XIC(PB_Green)]OTE(Light_0);',
        '[XIC(PB_Black_1),XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);',
        '[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
    },
    hints: [
      'Build it one output at a time, one rung per output. Test each rung with the bench controls before moving on.',
      'The lamp test is just one more **parallel** leg (`XIC(PB_Green)`) on each lamp rung. Remember: STOP is N.C., so "pressed" is `XIO(PB_Red)` and "not pressed" is `XIC(PB_Red)`.',
      'READY: `[XIC(Switch_0)XIC(Switch_1)XIC(PB_Red),XIC(PB_Green)]OTE(Light_0);` — CALL: `[XIC(PB_Black_1),XIC(PB_Black_2),XIC(PB_Green)]OTE(Light_2);` — STOP: `[XIO(PB_Red),XIC(PB_Green)]OTE(Light_4);` — Buzzer: `XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);`',
    ],
    tests: [
      {
        name: 'Idle panel',
        description: 'Key OFF, guard open, nothing pressed.',
        steps: [
          wait(200),
          expectObs('light0', false, 'READY must be OFF with the power key OFF', { for: 200 }),
          expectObs('light2', false, 'CALL must be OFF with no call button pressed', { for: 200 }),
          expectObs('light4', false, 'STOP must be OFF with the STOP button released', { for: 200 }),
          expectObs('buzzer', false, 'The buzzer must be quiet with the power key OFF (even with the guard open)', { for: 200 }),
        ],
      },
      {
        name: 'READY and the guard buzzer',
        steps: [
          wait(100),
          sw(0, true),
          lamp('buzzer', true, 'Key ON with the guard open (Switch_1 OFF) must sound the buzzer'),
          lamp('light0', false, 'READY must stay OFF while the guard is open'),
          sw(1, true),
          lamp('light0', true, 'Key ON + guard closed + STOP released: READY must be ON'),
          lamp('buzzer', false, 'The buzzer must stop when the guard is closed'),
          press('pb_red'),
          lamp('light0', false, 'READY must go OFF while STOP is pressed (PB_Red is N.C. — pressed reads 0)'),
          lamp('light4', true, 'The STOP lamp must light while STOP is pressed'),
          release('pb_red'),
          lamp('light0', true, 'READY must return when STOP is released'),
          lamp('light4', false, 'The STOP lamp must go OFF when STOP is released'),
          sw(0, false),
          lamp('light0', false, 'READY must go OFF when the power key is turned OFF'),
          sw(1, false),
          lamp('buzzer', false, 'Guard open with the key OFF: no buzzer'),
        ],
      },
      {
        name: 'CALL from either station',
        steps: [
          wait(100),
          press('pb_black1'),
          lamp('light2', true, 'CALL must light while PB_Black_1 is held'),
          release('pb_black1'),
          lamp('light2', false, 'CALL must go OFF when PB_Black_1 is released'),
          press('pb_black2'),
          lamp('light2', true, 'CALL must light while PB_Black_2 is held'),
          release('pb_black2'),
          lamp('light2', false, 'CALL must go OFF when PB_Black_2 is released'),
        ],
      },
      {
        name: 'Lamp test',
        steps: [
          wait(100),
          press('pb_green'),
          lamp('light0', true, 'LAMP TEST must light READY (Light_0)'),
          lamp('light2', true, 'LAMP TEST must light CALL (Light_2)'),
          lamp('light4', true, 'LAMP TEST must light STOP (Light_4)'),
          expectObs('buzzer', false, 'LAMP TEST must NOT sound the buzzer', { for: 300 }),
          release('pb_green'),
          lamp('light0', false, 'READY must go OFF after the lamp test (key is OFF)'),
          lamp('light2', false, 'CALL must go OFF after the lamp test'),
          lamp('light4', false, 'STOP must go OFF after the lamp test'),
        ],
      },
      {
        name: 'Lamp test on a running panel',
        steps: [
          wait(100),
          sw(0, true),
          sw(1, true),
          lamp('light0', true, 'READY must be ON (key ON, guard closed)'),
          press('pb_green'),
          lamp('light0', true, 'READY must stay ON during the lamp test'),
          press('pb_red'),
          lamp('light0', true, 'During the lamp test READY stays lit even with STOP pressed'),
          release('pb_green'),
          lamp('light0', false, 'After the lamp test, STOP (still pressed) must drop READY'),
          lamp('light4', true, 'STOP pressed: the STOP lamp stays ON after the lamp test'),
          release('pb_red'),
          lamp('light0', true, 'READY must come back when STOP is released'),
          lamp('light2', false, 'CALL must be OFF when nobody calls'),
          lamp('buzzer', false, 'No buzzer with the guard closed'),
        ],
      },
    ],
    parInstructions: 15,
    allowedInstructions: BITS,
    debrief: `Chapter 1 complete — you can read and write the three instructions that make up most of the ladder
logic in any plant: XIC, XIO and OTE, in series and in parallel.

**Field tip:** the lamp test is real. Operators trust indicator lamps, and a burnt-out lamp lies to them
("no fault lamp, so there's no fault"). A lamp-test button — or a lamp test at every start-up — catches
dead lamps before they matter. Modern LED pilot lights fail far less often, but the habit stays.`,
  },
];
