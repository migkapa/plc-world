/**
 * Chapter 7 — Troubleshooting: every mission starts from a realistic BROKEN program (kind 'troubleshoot')
 * and an operator's trouble ticket. The player reads the logic, finds the bug(s) and fixes them.
 * 7-1 seal-in around the wrong contact · 7-2 duplicate OTE · 7-3 stuck timer / DN pulse · 7-4 counting on
 * every scan & a shared counter · 7-5 a failed level switch (defence in depth) · 7-6 boss: many faults at once.
 * Mission ids '7-1' … '7-6'. See docs/CURRICULUM.md for the authoring guide.
 */
import type { MissionDef, MissionInvariant, TestStep } from '../types';
import { expectObs, expectObsRange, expectTag, press, release, set, tap, wait } from './authoring';

// ---------------------------------------------------------------------------
// Motor station (7-1, 7-2, 7-6)
// ---------------------------------------------------------------------------

const SAFE_SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const RUN_LIGHT = 'XIC(Motor_Aux)OTE(Run_Light);';
const READY_LIGHT = 'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);';
const FAULT_LIGHT = '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);';
const LIGHTS = [RUN_LIGHT, READY_LIGHT, FAULT_LIGHT];
const LIGHT_COMMENTS = ['RUN pilot light (green)', 'READY pilot light (white)', 'FAULT pilot light (red)'];
const MOTOR_BITS = ['XIC', 'XIO', 'OTE'];

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
  message: 'Motor_Starter must be OFF while the overload relay is tripped',
};
const OFF_MEANS_OFF: MissionInvariant = {
  when: { control: 'hoa', equals: 1 },
  tag: 'Motor_Starter',
  equals: false,
  graceMs: 20,
  message: 'Motor_Starter must be OFF while the Hand-Off-Auto selector is in OFF',
};

const HAND = 0;
const OFF = 1;
const AUTO = 2;

const runs = (message: string, hold?: number): TestStep =>
  expectObs('contactor', true, message, hold === undefined ? { within: 150 } : { within: 150, for: hold });
const stops = (message: string, hold?: number): TestStep =>
  expectObs('contactor', false, message, hold === undefined ? { within: 150 } : { within: 150, for: hold });
const staysOff = (message: string, ms: number): TestStep => expectObs('contactor', false, message, { for: ms });
const commandDrops = (message: string): TestStep => expectTag('Motor_Starter', false, message, { within: 30 });
const noCommand = (message: string, ms: number): TestStep => expectTag('Motor_Starter', false, message, { for: ms });
const lightIs = (id: string, value: boolean, message: string, hold = 200): TestStep =>
  expectObs(id, value, message, { within: 150, for: hold });

// 7-6: the commissioned Line 3 program (mission 2-7) …
const HAND_RUN = '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);';
const AUTO_ARMED = '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);';
const MOTOR = '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const HORN = 'XIO(OL_OK)OTE(Horn);';
// … and the same program after a night of "quick fixes"
const BROKEN_HAND_RUN = '[XIC(Start_PB)XIC(EStop_OK),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(OL_OK)OTE(Hand_Run);';
const BROKEN_MOTOR = '[XIC(Hand_Run),XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const BROKEN_RUN_LIGHT = 'XIC(Motor_Starter)OTE(Run_Light);';
const BROKEN_READY_LIGHT = 'XIO(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);';
const BROKEN_HORN = 'XIC(Start_PB)OTE(Horn);';

// ---------------------------------------------------------------------------
// Conveyor (7-4)
// ---------------------------------------------------------------------------

const PALLET_BELT = '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)XIO(Pallet_Count.DN)OTE(Conveyor_Run);';
const ALL_SHORT = 1;

// ---------------------------------------------------------------------------
// Tank (7-5)
// ---------------------------------------------------------------------------

const NO_SPILL: MissionInvariant = { observe: 'spills', max: 0, message: 'The tank overflowed — syrup all over the floor again' };

export const CH7_MISSIONS: MissionDef[] = [
  // -------------------------------------------------------------------------
  {
    id: '7-1',
    chapter: 'troubleshooting',
    order: 1,
    title: "Won't Stay Running",
    tagline: 'Somebody "cleaned up" the seal-in. Find the branch in the wrong place.',
    kind: 'troubleshoot',
    sceneId: 'motor-station',
    difficulty: 2,
    xp: 120,
    briefing: `**TROUBLE TICKET #4471 — Line 3 conveyor — Priority: HIGH**
> *Night shift, 02:10.* Conveyor only runs while you **hold** the green Start button. Let go → it stops.
> Also weird: while Start is held, the **Stop button does nothing**. Electrician checked both buttons with a meter:
> wiring OK, input LEDs on the 1756-IB16 light up correctly. Contractor was in on Saturday "tidying up the
> program". — *M. Okafor, shift lead*

Welcome to troubleshooting, the job you'll do most in your career. Dana's method: *"Don't rewrite — **read**.
Go online, press the buttons, and watch which contacts go green. The logic always does exactly what it says;
find where it says something different from what you meant."*

**The hardware** (you know it from chapter 2)
- \`Start_PB\` **N.O.**, \`Stop_PB\` **N.C.** (1 when not pressed), \`EStop_OK\` **N.C.** (1 = released), \`OL_OK\` overload 95-96 **N.C.** (1 = healthy), \`Motor_Aux\` contactor feedback.
- \`Motor_Starter\` contactor coil, \`Run_Light\`, \`Ready_Light\`, \`Fault_Light\`.

**Your job:** the program is loaded as found. Make it behave like a proper 3-wire start/stop again: Start seals
in, Stop always wins, E-stop and overload drop the motor with no automatic restart, lights unchanged.`,
    objectives: [
      'Start runs the motor and it keeps running (seal-in)',
      'Stop stops it — also while Start is held',
      'E-stop and overload drop the motor, no automatic restart',
      'Pilot lights keep working',
    ],
    objectiveTests: [
      [{ test: 0, steps: [2, 3] }, { test: 1, steps: [2, 9] }, { test: 2, steps: [2] }, { test: 3, steps: [2, 10] }, { test: 4, steps: [2, 13] }],
      [{ test: 1, steps: [5, 6] }, { test: 2, steps: [5, 8, 11, 13] }, { invariant: 0 }],
      [{ test: 3, steps: [5, 8] }, { test: 4, steps: [5, 7, 10, 11] }, { invariant: 1 }, { invariant: 2 }],
      [{ test: 0, steps: [4, 5] }, { test: 1, steps: [7] }, { test: 3, steps: [6] }],
    ],
    concepts: ['XIC', 'OTE'],
    starter: {
      rungs: ['XIC(Start_PB)[XIC(Stop_PB),XIC(Motor_Starter)]XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);', ...LIGHTS],
      comments: ['Motor start/stop — "tidied up" Saturday', ...LIGHT_COMMENTS],
    },
    solution: { rungs: [SAFE_SEAL, ...LIGHTS] },
    hints: [
      'Read rung 0 as a sentence: "Start AND (Stop OR Motor_Starter) AND E-stop AND overload". Which contact must the seal-in contact bypass — and which one must it never bypass?',
      'A seal-in contact goes in **parallel with Start** (it replaces Start once the motor runs). Stop must be in **series after** the branch so it breaks the seal too. Here the branch is around Stop instead.',
      '`[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);`',
    ],
    tests: [
      {
        name: 'Start runs the motor — and it keeps running',
        steps: [
          wait(200),
          tap('start'),
          runs('Pressing Start must pull in the contactor'),
          expectObs('contactor', true, 'The motor must keep running after Start is released — the seal-in is not working', { for: 3000 }),
          lightIs('runLight', true, 'RUN must light while the motor runs'),
          lightIs('readyLight', false, 'READY must be off while the motor runs'),
        ],
      },
      {
        name: 'Stop stops it — and it stays stopped',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          wait(500),
          tap('stop'),
          stops('Stop must drop the motor'),
          staysOff('The motor must stay stopped after Stop is released', 1500),
          lightIs('readyLight', true, 'READY must come back once the motor has stopped'),
          tap('start'),
          runs('Start must restart the motor', 500),
        ],
      },
      {
        name: 'Stop wins — even while Start is held',
        steps: [
          wait(200),
          press('start'),
          runs('Start must run the motor'),
          wait(200),
          press('stop'),
          expectTag('Motor_Starter', false, 'With Start AND Stop both held, Stop must win', { within: 30, for: 500 }),
          release('start'),
          release('stop'),
          staysOff('After both buttons are released the motor must stay stopped', 1000),
          press('stop'),
          tap('start', 300),
          staysOff('With Stop held, Start must not run the motor', 300),
          release('stop'),
          staysOff('Releasing Stop must not start the motor', 1000),
        ],
      },
      {
        name: 'E-stop: stop, and stay stopped',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          wait(500),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter in the logic'),
          lightIs('faultLight', true, 'FAULT must light while the E-stop is pushed'),
          set('estop', false),
          staysOff('DANGER: the motor restarted by itself after the E-stop was released', 2000),
          tap('start'),
          runs('Start must work again after the E-stop'),
        ],
      },
      {
        name: 'Overload trip: stop, and stay stopped',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          wait(500),
          set('overload_trip', true),
          commandDrops('An overload trip must drop Motor_Starter'),
          tap('start'),
          noCommand('Start must be refused while the overload is tripped', 300),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset', { within: 100 }),
          staysOff('The motor must not restart by itself after the overload reset', 1500),
          tap('start'),
          runs('Start must work after the overload reset'),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS],
    parInstructions: 15,
    allowedInstructions: MOTOR_BITS,
    debrief: `Found it: the seal-in branch was drawn around **Stop** instead of **Start**. So the rung needed Start to be
held (no seal), and while Start was held, the motor's own contact bypassed Stop. Same contacts, different
places — completely different machine.

**Field tip:** when a ticket says *"the wiring checks out"*, believe the input LEDs and go **online**. In Studio
5000, watch the rung while someone presses the buttons: the highlighted (true) path shows you exactly where the
power flow stops. And before you blame the program: **compare it** with the last known-good backup
(*Tools › Compare*) — the fastest way to find a weekend "tidy-up".`,
  },

  // -------------------------------------------------------------------------
  {
    id: '7-2',
    chapter: 'troubleshooting',
    order: 2,
    title: 'The Phantom Stop',
    tagline: 'The Start rung lights up green — and the contactor never pulls in.',
    kind: 'troubleshoot',
    sceneId: 'motor-station',
    difficulty: 3,
    xp: 160,
    briefing: `**TROUBLE TICKET #4502 — Line 3 conveyor — Priority: HIGH**
> Since the new **Jog** button was installed, the **Start button is dead**. The contactor never even clicks.
> Jog works perfectly. I went online: when I press Start, **rung 0 goes green all the way to the coil** — and still
> nothing! Something stops the motor the instant it is started. A phantom? — *L. Brandt, maintenance*

**The hardware**
- \`Start_PB\` **N.O.**, \`Stop_PB\` **N.C.**, \`Jog_PB\` **N.O.** (the new black button), \`EStop_OK\` **N.C.**, \`OL_OK\` **N.C.**, \`Motor_Aux\` contactor feedback.
- \`Run_Latch\` (BOOL) — a spare internal bit the contractor created and never used.

**Your job:** make both work:
- **Start** runs the motor and seals in, **Stop** stops it.
- **Jog** runs the motor only while held and **never** seals in — not even after a normal run.
- Stop, E-stop and overload stop everything, jog included — and nothing restarts by itself afterwards. What Jog does while the motor is already running is up to you.

Tip: *Verify* the controller and read the **warnings** too, not only the errors.`,
    objectives: [
      'Start runs the motor and seals in; Stop stops it',
      'Jog runs the motor only while held, never seals in',
      'Stop, E-stop and overload stop everything (jog too), no automatic restart',
      'Only one rung writes Motor_Starter',
    ],
    objectiveTests: [
      [0, { test: 3, steps: [2, 5] }],
      [1, 2, { test: 3, steps: [8, 10] }],
      [4, 5, 6, { invariant: 0 }, { invariant: 1 }, { invariant: 2 }],
      [],
    ],
    concepts: ['OTE', 'XIC', 'XIO'],
    starter: {
      rungs: [SAFE_SEAL, ...LIGHTS, 'XIC(Jog_PB)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);'],
      comments: ['Motor start/stop', ...LIGHT_COMMENTS, 'JOG — added by contractor'],
      tags: [{ name: 'Run_Latch', dataType: 'BOOL', description: 'Run request sealed by Start (never by Jog)' }],
    },
    solution: {
      rungs: [
        '[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);',
        '[XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        ...LIGHTS,
      ],
    },
    hints: [
      'How many rungs write `Motor_Starter` with an OTE? Remember the scan: rungs run top to bottom, and only the value at the **end** of the scan goes to the output card.',
      'The jog rung is false whenever Jog is not pressed, so it writes 0 **after** rung 0 wrote 1 — last OTE wins. Merge both into one output rung — but don\'t put Jog in the seal-in branch (it would seal in). Seal a separate `Run_Latch` bit with Start instead.',
      '`[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);` then `[XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);` — and delete the contractor\'s jog rung.',
    ],
    tests: [
      {
        name: 'Start and Stop work again',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor — something overwrites Motor_Starter later in the scan', 1500),
          tap('stop'),
          stops('Stop must stop the motor', 1000),
          tap('start'),
          runs('Start must restart the motor'),
        ],
      },
      {
        name: 'Jog runs only while held',
        steps: [
          wait(200),
          press('jog'),
          runs('Holding Jog must run the motor', 1000),
          release('jog'),
          stops('Releasing Jog must stop the motor at once — jog must never seal in', 2000),
        ],
      },
      {
        name: 'Inching: three short jogs',
        steps: [
          wait(200),
          tap('jog', 150),
          stops('After a short jog the motor must stop', 400),
          tap('jog', 150),
          stops('After a short jog the motor must stop', 400),
          tap('jog', 150),
          stops('After a short jog the motor must stop', 400),
          expectObs('motorStarts', 3, 'Each jog press must pull the contactor in exactly once'),
        ],
      },
      {
        name: 'Jog after a normal run',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          wait(500),
          tap('stop'),
          stops('Stop must stop the motor'),
          wait(300),
          press('jog'),
          runs('Jog must run the motor after a normal stop'),
          release('jog'),
          stops('After a normal stop, jogging must not re-seal the motor', 1500),
        ],
      },
      {
        name: 'Safety applies to jog',
        steps: [
          wait(200),
          set('estop', true),
          press('jog'),
          noCommand('Jog must not command the motor while the E-stop is pushed', 500),
          release('jog'),
          set('estop', false),
          wait(200),
          press('stop'),
          press('jog'),
          noCommand('Stop must win over Jog', 500),
          release('jog'),
          release('stop'),
          wait(200),
          set('overload_trip', true),
          press('jog'),
          noCommand('Jog must not command the motor while the overload is tripped', 500),
          release('jog'),
          set('overload_trip', false),
          tap('overload_reset'),
          staysOff('Nothing may start after the overload reset', 1000),
        ],
      },
      {
        name: 'E-stop: stop, and stay stopped',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter'),
          set('estop', false),
          staysOff('The motor must not restart by itself after the E-stop', 1500),
        ],
      },
      {
        name: 'Overload while running: stop, and stay stopped',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          wait(500),
          set('overload_trip', true),
          commandDrops('An overload trip must drop Motor_Starter'),
          tap('start'),
          noCommand('Start must be refused while the overload is tripped', 300),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset', { within: 100 }),
          staysOff(
            'DANGER: the motor restarted by itself after the overload reset — the overload must also drop the sealed run request (Run_Latch), not just the coil',
            1500,
          ),
          tap('start'),
          runs('Start must work after the overload reset'),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS],
    parInstructions: 21,
    allowedInstructions: MOTOR_BITS,
    debrief: `The phantom was a **duplicate destructive bit**: two rungs with an OTE on \`Motor_Starter\`. Rung 0 really
did turn it on — you saw it green online — and a few microseconds later the jog rung turned it off again. Only
the last write of the scan reaches the output module, so the contactor never saw the 1.

Studio 5000 flags this when you verify: *"Duplicate destructive bit reference"*. It's a **warning**, not an
error, so the program downloads and runs — and that's why it survives in so many plants.

**Field tip:** one OTE per output, full stop. If several conditions can run something, OR them in **one** rung
(or in internal bits that feed one rung). Use *Cross Reference* (Ctrl+E on a tag) to see every place a tag is
written before you touch it.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '7-3',
    chapter: 'troubleshooting',
    order: 3,
    title: 'Stuck Timer',
    tagline: 'The alarm beacon should flash. It just sits there, lit.',
    kind: 'troubleshoot',
    sceneId: 'trainer',
    difficulty: 3,
    xp: 150,
    briefing: `**TROUBLE TICKET #4519 — Boiler room alarm panel (mock-up on the trainer bench)**
> The red alarm beacon is supposed to **flash** when the alarm is active. It comes on after half a second and then
> stays on **steady** — operators think it's a pilot light and ignore it. Online, \`Flash_Timer.ACC\` sits at 500 and
> never moves. **The timer is stuck!** Buzzer and silence switch work fine. — *R. Dubois, utilities*

**The hardware** (trainer bench)
- \`Switch_0\` → \`Local:1:I.Data.0\` — the alarm contact (1 = alarm active).
- \`Switch_1\` → \`Local:1:I.Data.1\` — "silence buzzer" switch (1 = silenced).
- \`Light_4\` → \`Local:2:O.Data.4\` — red alarm beacon. \`Buzzer\` → \`Local:2:O.Data.8\`.
- \`Flash_Timer\` (TIMER).

**Your job:** while the alarm is active, \`Light_4\` must flash at **1 Hz — about 0.5 s on, 0.5 s off** — for as
long as the alarm lasts, and be **off** when there is no alarm. The buzzer logic must keep working (on with the
alarm unless silenced).`,
    objectives: [
      'Light_4 flashes at 1 Hz (≈ 0.5 s on / 0.5 s off) while the alarm is active',
      'It keeps flashing for as long as the alarm lasts',
      'Light_4 is off without an alarm',
      'Buzzer still sounds with the alarm unless silenced',
    ],
    objectiveTests: [
      [0, { test: 2, steps: [7] }, { test: 3, steps: [5] }],
      [1],
      [{ test: 2, steps: [1, 5] }, { invariant: 0 }],
      [{ test: 3, observe: ['buzzer'] }],
    ],
    concepts: ['TON', 'LES', 'XIO'],
    starter: {
      rungs: ['XIC(Switch_0)TON(Flash_Timer,500,0);', 'XIC(Switch_0)XIC(Flash_Timer.DN)OTE(Light_4);', 'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);'],
      comments: ['Flasher timer', 'Alarm beacon — should flash', 'Alarm buzzer (Switch_1 silences)'],
      tags: [{ name: 'Flash_Timer', dataType: 'TIMER', description: 'Alarm beacon flasher' }],
    },
    solution: {
      rungs: [
        'XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);',
        'XIC(Switch_0)LES(Flash_Timer.ACC,500)OTE(Light_4);',
        'XIC(Switch_0)XIO(Switch_1)OTE(Buzzer);',
      ],
    },
    hints: [
      'A TON times once: when ACC reaches PRE it sets DN and stops. Nothing ever resets it while Switch_0 stays on — that is the "stuck" timer. How do you make a timer restart itself?',
      'A self-resetting timer has `XIO(Flash_Timer.DN)` in front of its own TON. But careful: its DN is then true for **one scan** only, far too short to see. Use the accumulator instead — ON for the first half of each period, OFF for the second.',
      '`XIC(Switch_0)XIO(Flash_Timer.DN)TON(Flash_Timer,1000,0);` and `XIC(Switch_0)LES(Flash_Timer.ACC,500)OTE(Light_4);`',
    ],
    tests: [
      {
        name: 'The beacon flashes at 1 Hz',
        steps: [
          wait(200),
          set('sw0', true),
          expectObs('light4', true, 'The beacon must light when the alarm comes on', { within: 700 }),
          // The first ON phase may be partial (a free-running flasher shared by several beacons is fine), so
          // full ON / OFF halves are timed from the first OFF edge on.
          expectObs('light4', false, 'The beacon must go OFF after about 0.5 s — it must flash, not stay on', { within: 700 }),
          ...[1, 2, 3].flatMap((n): TestStep[] => [
            expectObs('light4', false, `Flash ${n}: the beacon must stay OFF for about 0.5 s`, { for: 440 }),
            expectObs('light4', true, `Flash ${n}: the beacon must come back ON after about 0.5 s`, { within: 200 }),
            expectObs('light4', true, `Flash ${n}: the beacon must stay ON for about 0.5 s`, { for: 440 }),
            expectObs('light4', false, `Flash ${n}: the beacon must go OFF after about 0.5 s — it must flash, not stay on`, { within: 200 }),
          ]),
        ],
      },
      {
        name: 'It keeps flashing',
        description: 'Ten seconds into the alarm the beacon must still flash.',
        steps: [
          wait(200),
          set('sw0', true),
          wait(10000),
          expectObs('light4', false, 'After 10 s of alarm the beacon must still be flashing (off phase)', { within: 700 }),
          expectObs('light4', true, 'After 10 s of alarm the beacon must still be flashing (on phase)', { within: 700 }),
          expectObs('light4', true, 'The beacon must stay ON for about 0.5 s', { for: 440 }),
          expectObs('light4', false, 'The beacon must go OFF after about 0.5 s', { within: 200 }),
          expectObs('light4', false, 'The beacon must stay OFF for about 0.5 s', { for: 440 }),
        ],
      },
      {
        name: 'Dark without an alarm',
        steps: [
          wait(200),
          expectObs('light4', false, 'No alarm: the beacon must be off', { for: 1500 }),
          set('sw0', true),
          wait(1700),
          set('sw0', false),
          expectObs('light4', false, 'When the alarm clears the beacon must go off and stay off', { within: 100, for: 2000 }),
          set('sw0', true),
          expectObs('light4', true, 'A new alarm must flash the beacon again', { within: 1100 }),
        ],
      },
      {
        name: 'Buzzer and silence',
        steps: [
          wait(200),
          set('sw0', true),
          expectObs('buzzer', true, 'The buzzer must sound with the alarm', { within: 100, for: 500 }),
          set('sw1', true),
          expectObs('buzzer', false, 'Switch_1 must silence the buzzer', { within: 100, for: 1000 }),
          expectObs('light4', true, 'Silencing the buzzer must not stop the beacon', { within: 1100 }),
          set('sw0', false),
          set('sw1', false),
          expectObs('buzzer', false, 'No alarm: no buzzer', { within: 100, for: 1000 }),
        ],
      },
    ],
    invariants: [
      {
        when: { control: 'sw0', equals: false },
        tag: 'Light_4',
        equals: false,
        graceMs: 20,
        message: 'Light_4 must be OFF while there is no alarm (Switch_0 off)',
      },
    ],
    parInstructions: 10,
    allowedInstructions: ['XIC', 'XIO', 'OTE', 'OTL', 'OTU', 'ONS', 'OSR', 'TON', 'TOF', 'RTO', 'RES', 'EQU', 'NEQ', 'LES', 'LEQ', 'GRT', 'GEQ', 'LIM', 'MOV'],
    debrief: `The timer wasn't broken — it did exactly what a TON does: time **once**, set DN, and wait until its rung goes
false. Nothing ever made the rung false while the alarm stayed on.

The first fix most people try, \`XIO(Flash_Timer.DN)\` in front of the TON, turns it into a pulse generator: DN is
now true for **one scan** (a few milliseconds) per period — invisible on a lamp. The accumulator is the real
flasher: \`ACC < 500\` for half the period, \`ACC ≥ 500\` for the other half.

**Field tip:** annunciator sequences (ISA-18.1) use a **flashing light for a new alarm and a steady light after
acknowledge** — so a beacon that is steady from the start tells the operator "someone already knows". That's
exactly why this bug made people ignore the alarm.
If a "timer is stuck" online, look at what's (not) resetting it. And many plants build **one** free-running
1 Hz flasher bit near the top of the program and use it for every beacon on the panel, so they all flash in sync.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '7-4',
    chapter: 'troubleshooting',
    order: 4,
    title: 'Counting Twice',
    tagline: 'A "pallet full" after one box and a shift total in the thousands.',
    kind: 'troubleshoot',
    sceneId: 'conveyor-sort',
    difficulty: 4,
    xp: 190,
    briefing: `**TROUBLE TICKET #4533 — Box conveyor / palletizer — Priority: MEDIUM**
> Pallet-full logic is nuts: the belt stops with the **amber "pallet full"** light on before the **first box** even
> reaches the pallet — a pallet holds ten. We pressed Start about forty times to get through the shift, one box at a
> time, and the HMI's **shift total** (\`Box_Total\`) now says **2,316 boxes**. We're only running short boxes this
> week (the pusher is out for repair). — *K. Sato, packing*

**The hardware** (belt 0.5 m/s, a box passes a photo-eye in about 0.6 s)
- \`Start_PB\` (**N.O.**), \`Stop_PB\` (**N.C.**), \`EStop_OK\` (**N.C.**).
- \`PE_Divert\` (4.0 m), \`PE_Exit\` (5.8 m) — photo-eyes, 1 while a box blocks the beam.
- \`Conveyor_Run\`, \`Light_Green\` (running), \`Light_Amber\` (pallet full).
- \`Pallet_Count\` (COUNTER), \`Box_Total\` (DINT, read by the HMI), \`Exit_OS\` (BOOL, spare).

**How it should work**
- Every box passing \`PE_Exit\` counts **once** in \`Pallet_Count\` and **once** in \`Box_Total\` (as it reaches the
  eye, as now, or as it clears it — both are fine).
- At **10** counted boxes the pallet is full: the conveyor stops and \`Light_Amber\` comes on. (Counting as the
  box reaches the eye, the 10th box waits right at the discharge end until the belt restarts.)
- Pressing **Start** with a full pallet begins a new one (count back to 0) and restarts the belt. Start/Stop in the middle of a pallet must **not** lose the count.
- \`Box_Total\` is the shift total: it keeps counting and is never reset by Start.`,
    objectives: [
      'Every box counts exactly once in Pallet_Count and Box_Total',
      'At 10 boxes: conveyor stops, amber light on',
      'Start with a full pallet begins a new pallet',
      'A mid-pallet stop keeps the count; Box_Total is never reset',
    ],
    objectiveTests: [
      [2, { test: 0, steps: [13, 14] }, { test: 1, steps: [9, 10] }],
      [{ test: 0, steps: [5, 11, 12, 15, 16] }, { test: 1, steps: [3] }],
      [{ test: 1, steps: [6, 7, 8] }],
      [{ test: 0, steps: [3, 4, 7, 10] }, { test: 1, steps: [10] }, 3, { invariant: 0 }, { invariant: 1 }],
    ],
    concepts: ['CTU', 'ONS', 'ADD', 'RES'],
    starter: {
      rungs: [
        PALLET_BELT,
        'XIC(Conveyor_Run)OTE(Light_Green);',
        'XIC(PE_Exit)CTU(Pallet_Count,10,0);',
        'XIC(Pallet_Count.DN)OTE(Light_Amber);',
        'XIC(Pallet_Count.DN)XIC(Start_PB)RES(Pallet_Count);',
        'XIC(PE_Exit)ADD(Box_Total,1,Box_Total);',
        'XIC(PE_Divert)CTU(Pallet_Count,10,0);',
      ],
      comments: [
        'Belt: runs until the pallet is full',
        'Green = running',
        'Pallet counter: boxes leaving at the exit eye',
        'Amber = pallet full',
        'Start with a full pallet = new pallet',
        'Shift total for the HMI',
        'Extra count point at the pusher eye (added last month)',
      ],
      tags: [
        { name: 'Pallet_Count', dataType: 'COUNTER', description: 'Boxes on the current pallet' },
        { name: 'Box_Total', dataType: 'DINT', description: 'Shift total (HMI)' },
        { name: 'Exit_OS', dataType: 'BOOL', description: 'Spare one-shot storage bit' },
      ],
    },
    solution: {
      rungs: [
        PALLET_BELT,
        'XIC(Conveyor_Run)OTE(Light_Green);',
        'XIC(PE_Exit)CTU(Pallet_Count,10,0);',
        'XIC(Pallet_Count.DN)OTE(Light_Amber);',
        'XIC(Pallet_Count.DN)XIC(Start_PB)RES(Pallet_Count);',
        'XIC(PE_Exit)ONS(Exit_OS)ADD(Box_Total,1,Box_Total);',
      ],
    },
    hints: [
      'Two separate bugs. How long is `PE_Exit` on for one box — one scan, or hundreds of scans? And how many instructions use `Pallet_Count`?',
      'ADD executes on **every scan** its rung is true, so it adds 1 about 60 times per box: put a one-shot (ONS) in front of it. A CTU counts rising edges using the counter\'s own `.CU` bit — two CTUs on one counter fight over that bit and count on every scan. Delete the extra count point.',
      'Change rung 5 to `XIC(PE_Exit)ONS(Exit_OS)ADD(Box_Total,1,Box_Total);` and delete rung 6 (`XIC(PE_Divert)CTU(Pallet_Count,10,0);`).',
    ],
    tests: [
      {
        name: 'A pallet is exactly 10 boxes',
        description: 'Includes a stop / restart in the middle of the pallet.',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectObs('conveyorRunning', true, 'Start must run the belt', { within: 500 }),
          expectObsRange('boxesGood', { min: 4 }, 'Boxes should be leaving the belt — did the pallet-full logic stop it early?', { within: 25000 }),
          expectObs('lightAmber', false, 'After 4 boxes the pallet is not full yet', { for: 100 }),
          tap('stop'),
          expectObs('conveyorRunning', false, 'Stop must stop the belt', { within: 500 }),
          wait(1500),
          tap('start'),
          expectObs('conveyorRunning', true, 'Start must restart the belt mid-pallet', { within: 500 }),
          expectObs('lightAmber', true, 'After 10 boxes the pallet is full: amber light', { within: 25000 }),
          expectObs('conveyorRunning', false, 'A full pallet must stop the belt', { within: 500 }),
          expectObsRange(
            'boxesGood',
            { min: 9, max: 10 },
            'The pallet must be full at the 10th box at the exit eye — not earlier, not later (a mid-pallet stop must not reset the count)',
          ),
          expectTag('Box_Total', 10, 'The pallet must be full after exactly 10 boxes (Box_Total must say 10)'),
          expectObs('lightAmber', true, 'The pallet stays full until someone presses Start', { for: 2000 }),
          expectObs('conveyorRunning', false, 'The belt must stay stopped on a full pallet', { for: 200 }),
        ],
      },
      {
        name: 'Start begins a new pallet',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectObs('lightAmber', true, 'The first pallet must fill up', { within: 45000 }),
          wait(1000),
          tap('start'),
          expectObs('lightAmber', false, 'Start must begin a new pallet (amber off)', { within: 150 }),
          expectObs('conveyorRunning', true, 'Start must restart the belt', { within: 500 }),
          expectObs('lightAmber', true, 'The second pallet must also hold 10 boxes', { within: 40000 }),
          expectObsRange('boxesGood', { min: 19, max: 20 }, 'The second pallet must be full after exactly 10 more boxes'),
          expectTag('Box_Total', 20, 'The second pallet must be full after exactly 10 more boxes — and Box_Total is the shift total: 20, never reset by Start'),
        ],
      },
      {
        name: 'Box_Total counts every box once',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectObs('boxesGood', 3, 'Three boxes should leave the belt', { within: 20000 }),
          wait(600),
          expectTag('Box_Total', 3, 'Box_Total must count each box once — not once per scan'),
        ],
      },
      {
        name: 'Stop and E-stop',
        steps: [
          set('box_pattern', ALL_SHORT),
          wait(200),
          tap('start'),
          expectObs('conveyorRunning', true, 'Start must run the belt', { within: 500 }),
          lightIs('lightGreen', true, 'Green must light while the belt runs'),
          tap('stop'),
          expectObs('conveyorRunning', false, 'Stop must stop the belt', { within: 500, for: 1000 }),
          tap('start'),
          expectObs('conveyorRunning', true, 'Start must restart the belt', { within: 500 }),
          set('estop', true),
          expectTag('Conveyor_Run', false, 'The E-stop must drop Conveyor_Run', { within: 30 }),
          set('estop', false),
          expectObs('conveyorRunning', false, 'No restart after the E-stop', { within: 500, for: 1500 }),
        ],
      },
    ],
    invariants: [
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
    debrief: `Two classic counting bugs in one program:

1. **ADD is not a counter.** It executes on every scan its rung is true — about 60 times while a box passes a photo-eye at a 10 ms scan. A one-shot (**ONS**) turns "is blocked" into "just got blocked".
2. **Two CTUs on one COUNTER.** A CTU remembers the previous rung state in the counter's \`.CU\` bit. With two instructions writing the same \`.CU\`, each one sees the other's "false" and counts a new edge on every scan.

**Field tip:** counters are like outputs — **one instruction per counter**. If you need to count at two places,
use two counters and add them. And when the numbers on an HMI look "way too big", suspect a missing one-shot
first: the ratio (2,316 ÷ 40 boxes ≈ 58) is the number of scans per box.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '7-5',
    chapter: 'troubleshooting',
    order: 5,
    title: 'Overflowing Tank',
    tagline: 'One stuck level switch, 300 L on the floor. Defence in depth.',
    kind: 'troubleshoot',
    sceneId: 'tank-process',
    difficulty: 4,
    xp: 200,
    briefing: `**INCIDENT REPORT #IR-0917 — Tank T-101 overflow**
> 03:40, T-101 overflowed during a fill; ~300 L of syrup on the floor. The high level switch **LSH-101** was found
> coated with dried product and **stuck** — it never signalled "full". The fill logic relies on that one switch
> only. Action: make the fill logic **tolerate any single instrument failure**. — *Safety committee*

**The hardware** (tank T-101)
- \`LSH_101\` → \`Local:1:I.Data.3\` — high level switch, 1 when the level is ≥ **90 %** (the primary cutoff).
- \`LT_101\` → \`Local:3:I.Ch0Data\` — level transmitter, REAL 0–100 %. When its 4–20 mA loop is broken it reads 0.0 and the 1756-IF8 sets the channel fault bit \`Local:3:I.Ch0Fault\`.
- \`LSHH_101\` → \`Local:1:I.Data.4\` — high-high float switch at **97 %**, **N.C. fail-safe**: **0** when the level is ≥ 97 % (or its wire is broken), 1 when healthy.
- \`Start_PB\` (**N.O.**), \`Stop_PB\` (**N.C.**), \`Fill_Valve\`, \`Running_Light\`, \`Alarm_Horn\`, \`Drain_Valve\`, \`Discharge_PB\`.

**The safety committee's spec — three independent layers**

\`Fill_Valve\` (Start / Stop seal-in, as now) closes — and Start is refused — when **any** layer says full:
- layer 1: \`LSH_101\` = 1 (90 %);
- layer 2: \`LT_101\` ≥ **92 %**;
- layer 3: \`LSHH_101\` = 0 (97 %).

\`Alarm_Horn\` sounds while **any** of these is true:
- the high-high switch has tripped (\`LSHH_101\` = 0) — as now;
- the level transmitter is faulted (\`Local:3:I.Ch0Fault\`);
- the instruments **disagree**: \`LT_101\` ≥ **91 %** but \`LSH_101\` still says not full (a stuck switch!).

Everything else stays as it is.`,
    objectives: [
      'Fill stops at LSH-101 (90 %) in normal operation',
      'LSH-101 stuck: LT-101 stops the fill at 92 %',
      'LSH-101 stuck and LT-101 failed: LSHH-101 stops it at 97 %',
      'Horn on high-high, on LT-101 channel fault, and on LT/LSH disagreement — and only then',
      'The tank never overflows',
    ],
    objectiveTests: [
      [{ test: 0, observe: ['fillValve', 'level', 'Fill_Valve'] }, { test: 3, steps: [4, 5, 6] }, { test: 4, observe: ['fillValve', 'runningLight', 'drainValve', 'level'] }],
      [{ test: 1, observe: ['fillValve', 'level'] }],
      [{ test: 2, observe: ['fillValve', 'level', 'Fill_Valve'] }, { invariant: 1 }],
      [{ test: 0, observe: ['alarmHorn'] }, { test: 1, observe: ['alarmHorn'] }, { test: 2, observe: ['alarmHorn'] }, { test: 3, steps: [2] }, { test: 4, observe: ['alarmHorn'] }],
      [{ invariant: 0 }],
    ],
    concepts: ['XIO', 'LES', 'GEQ', 'XIC', 'OTE'],
    starter: {
      rungs: [
        '[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)OTE(Fill_Valve);',
        'XIC(Fill_Valve)OTE(Running_Light);',
        'XIO(LSHH_101)OTE(Alarm_Horn);',
        'XIC(Discharge_PB)OTE(Drain_Valve);',
      ],
      comments: ['Fill valve XV-101 — stops on LSH-101 ONLY', 'RUNNING light while filling', 'High-high alarm (LSHH-101 is N.C. fail-safe)', 'Drain valve while Discharge is held'],
    },
    solution: {
      rungs: [
        '[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)LES(LT_101,92.0)XIC(LSHH_101)OTE(Fill_Valve);',
        'XIC(Fill_Valve)OTE(Running_Light);',
        '[XIO(LSHH_101),XIC(Local:3:I.Ch0Fault),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);',
        'XIC(Discharge_PB)OTE(Drain_Valve);',
      ],
    },
    hints: [
      'Every layer that can say "full" must be able to break the fill valve rung on its own — so they all go in **series** after the seal-in branch. Mind the wiring: LSH is 1 when full, LSHH is 0 when full.',
      'Fill rung: add `LES(LT_101,92.0)` and `XIC(LSHH_101)` after `XIO(LSH_101)`. Horn rung: three parallel legs — `XIO(LSHH_101)`, `XIC(Local:3:I.Ch0Fault)`, and `GEQ(LT_101,91.0)XIO(LSH_101)`.',
      '`[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)LES(LT_101,92.0)XIC(LSHH_101)OTE(Fill_Valve);` and `[XIO(LSHH_101),XIC(Local:3:I.Ch0Fault),GEQ(LT_101,91.0)XIO(LSH_101)]OTE(Alarm_Horn);`',
    ],
    tests: [
      {
        name: 'Normal fill stops at LSH-101',
        steps: [
          wait(200),
          expectObs(
            'alarmHorn',
            false,
            'Healthy instruments, empty tank: no alarm — a transmitter reading 0.0 % is not a fault by itself (use its channel fault bit)',
            { for: 1000 },
          ),
          tap('start'),
          expectObs('fillValve', true, 'Start must open the fill valve', { within: 150 }),
          expectObs('fillValve', true, 'The fill valve must stay open (seal-in)', { for: 2000 }),
          expectObs('fillValve', false, 'The fill must stop at the high level switch (90 %)', { within: 25000 }),
          expectObsRange('level', { min: 89.5, max: 90.6 }, 'In normal operation LSH-101 stops the fill at 90 %'),
          expectObs('alarmHorn', false, 'Normal operation: no alarm', { for: 1000 }),
          press('start'),
          expectTag('Fill_Valve', false, 'Start must be refused on a full tank', { for: 500 }),
          release('start'),
        ],
      },
      {
        name: 'LSH-101 stuck: the transmitter takes over',
        steps: [
          set('lsh_fail', true),
          wait(200),
          tap('start'),
          expectObs('fillValve', true, 'Start must open the fill valve', { within: 150 }),
          expectObs('alarmHorn', true, 'LT-101 ≥ 91 % while LSH-101 says "not full": the instruments disagree — sound the horn', {
            within: 25000,
          }),
          expectObs('fillValve', false, 'With LSH-101 stuck, LT-101 must stop the fill at 92 %', { within: 3000 }),
          expectObsRange('level', { min: 91.5, max: 92.6 }, 'The backup cutoff must stop the fill at 92 %'),
          expectObs('alarmHorn', true, 'The disagreement alarm must keep sounding', { for: 2000 }),
          expectObs('fillValve', false, 'The fill valve must stay closed', { for: 1000 }),
        ],
      },
      {
        name: 'LSH-101 stuck AND LT-101 failed: the high-high switch',
        steps: [
          set('lsh_fail', true),
          set('lt_fail', true),
          wait(200),
          expectObs('alarmHorn', true, 'A faulted level transmitter (Local:3:I.Ch0Fault) must sound the horn', { within: 150 }),
          tap('start'),
          expectObs('fillValve', true, 'Start must still open the fill valve (LSHH-101 is healthy)', { within: 150 }),
          expectObs('fillValve', false, 'With two instruments failed, LSHH-101 must stop the fill at 97 %', { within: 25000 }),
          expectObsRange('level', { min: 96.5, max: 97.6 }, 'The last layer must stop the fill at 97 %'),
          expectObs('alarmHorn', true, 'High-high must sound the horn', { for: 1000 }),
          press('start'),
          expectTag('Fill_Valve', false, 'Start must be refused while LSHH-101 has tripped', { for: 500 }),
          release('start'),
        ],
      },
      {
        name: 'LT-101 failed alone',
        steps: [
          set('lt_fail', true),
          wait(200),
          expectObs('alarmHorn', true, 'A faulted level transmitter must sound the horn', { within: 150, for: 500 }),
          tap('start'),
          expectObs('fillValve', true, 'The healthy switches still protect the tank: Start must open the fill valve', { within: 150 }),
          expectObs('fillValve', false, 'LSH-101 must stop the fill at 90 %', { within: 25000 }),
          expectObsRange('level', { min: 89.5, max: 90.6 }, 'LSH-101 stops the fill at 90 %'),
        ],
      },
      {
        name: 'Stop and discharge still work',
        steps: [
          wait(200),
          tap('start'),
          expectObs('fillValve', true, 'Start must open the fill valve', { within: 150 }),
          wait(2000),
          tap('stop'),
          expectObs('fillValve', false, 'Stop must close the fill valve', { within: 150, for: 1500 }),
          expectObs('runningLight', false, 'RUNNING must be off when not filling'),
          press('discharge'),
          expectObs('drainValve', true, 'Discharge must open the drain valve', { within: 150, for: 500 }),
          expectObsRange('level', { max: 0.01 }, 'Holding Discharge must empty the tank', { within: 5000 }),
          wait(300),
          release('discharge'),
          expectObs('drainValve', false, 'Releasing Discharge must close the drain valve', { within: 150 }),
          expectObs('alarmHorn', false, 'Healthy instruments, empty tank: no alarm — a 0.0 % reading is not a fault by itself', { for: 1000 }),
          tap('start'),
          expectObs('fillValve', true, 'Start must open the fill valve again', { within: 150, for: 500 }),
          expectObs('runningLight', true, 'RUNNING must light while filling'),
        ],
      },
    ],
    invariants: [NO_SPILL, { observe: 'level', max: 97.6, message: 'The level went above the high-high switch (97 %)' }],
    parInstructions: 18,
    debrief: `The tank now survives **any single failure** — and even a double one — and it **tells** someone when an
instrument lies. That's *defence in depth*: independent layers, each able to stop the process alone, plus
diagnostics that catch a failed layer before you need it.

Note the details that make it work: the high-high switch is **N.C. fail-safe** (a broken wire reads as "full"),
the transmitter's **channel fault bit** is used instead of trusting a 0.0 %, and **cross-checking** two
instruments turns a silent stuck switch into an alarm.

**Field tip:** in a real plant the high-high switch would trip the inlet valve through an independent **safety
instrumented function** (IEC 61511) — a separate safety PLC or a hardwired relay — so that not even a bug in
this program can defeat the last layer.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '7-6',
    chapter: 'troubleshooting',
    order: 6,
    title: 'Night of Many Faults',
    tagline: 'Boss: five complaints, one program, one night to fix it all.',
    kind: 'boss',
    sceneId: 'motor-station',
    difficulty: 5,
    xp: 400,
    briefing: `**NIGHT SHIFT LOG — Line 3 — handed to you at 22:00 with a coffee**
1. The white **READY** light is dark when everything is fine — and it lights up when someone hits the E-stop.
2. **HAND mode:** after an E-stop, the conveyor **started by itself** when the mushroom was twisted out!!!
3. The selector was locked in **OFF** for belt maintenance — and the belt moved when someone pressed **Jog**.
4. The overload tripped at 02:00 and there was **no horn**. But the horn honks every time we press Start.
5. QA audit: the **RUN** light must prove the contactor pulled in (spec item 5) — please verify.

> *Night shift. P.S. the contractor "improved" the program on Friday.*

This is **your** Line 3 program from **Commissioning Day** (mission 2-7) — after the contractor's Friday visit.

**The specification** (unchanged)
1. **OFF:** the motor never runs (Start, Jog and Remote_Run do nothing).
2. **HAND:** Start runs and seals in (\`Hand_Run\`), Stop stops. **Jog** runs only while held and never seals in.
3. **AUTO:** Start **arms** AUTO (\`Auto_Armed\`); while armed the motor runs whenever \`Remote_Run\` is ON. Stop, E-stop, an overload trip or leaving AUTO disarm it. Jog does nothing in AUTO.
4. **Everywhere:** Stop, E-stop and overload drop \`Motor_Starter\` at once; **nothing restarts by itself**.
5. **Lights:** \`Run_Light\` = contactor feedback \`Motor_Aux\`; \`Ready_Light\` = healthy (E-stop released, overload OK) and stopped; \`Fault_Light\` = E-stop pushed or overload tripped.
6. **Horn:** \`Horn\` sounds while the **overload** is tripped — and for nothing else.

Selector: \`HOA_Hand\` = 1 in HAND, \`HOA_Auto\` = 1 in AUTO, both 0 in OFF. \`Stop_PB\`, \`EStop_OK\` and \`OL_OK\` are **N.C.**`,
    objectives: [
      'READY light correct again',
      'No restart after an E-stop in HAND',
      'Jog only in HAND',
      'Horn only for the overload',
      'RUN light from the contactor feedback',
      'The whole Commissioning Day spec passes',
    ],
    objectiveTests: [
      [{ test: 0, steps: [1] }, { test: 2, steps: [9, 13] }, { test: 4, steps: [8] }, { test: 8, steps: [9] }],
      [{ test: 4, steps: [3, 6, 11, 13] }, { invariant: 1 }],
      [1, 3, { test: 10, steps: [12] }],
      [{ test: 0, steps: [4] }, { test: 2, steps: [5] }, { test: 4, steps: [9] }, { test: 8, steps: [7, 13] }, { test: 9, steps: [8] }],
      [{ test: 0, steps: [2] }, { test: 2, steps: [4, 8, 12] }],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, { invariant: 0 }, { invariant: 1 }, { invariant: 2 }, { invariant: 3 }],
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: {
      rungs: [BROKEN_HAND_RUN, AUTO_ARMED, BROKEN_MOTOR, BROKEN_RUN_LIGHT, BROKEN_READY_LIGHT, FAULT_LIGHT, HORN, BROKEN_HORN],
      comments: [
        'HAND run request (sealed by Start)',
        'AUTO armed by Start',
        'Motor contactor: HAND run, jog, AUTO',
        'RUN pilot light',
        'READY pilot light',
        'FAULT pilot light',
        'Overload horn',
        'Start-up warning beep — added Friday',
      ],
      tags: [
        { name: 'Hand_Run', dataType: 'BOOL', description: 'HAND mode run request (sealed by Start)' },
        { name: 'Auto_Armed', dataType: 'BOOL', description: 'AUTO mode armed by Start' },
      ],
    },
    solution: { rungs: [HAND_RUN, AUTO_ARMED, MOTOR, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT, HORN] },
    hints: [
      'Take the log one line at a time and find the rung behind each symptom: READY → rung 4, E-stop restart → the `Hand_Run` seal, Jog in OFF → the motor rung, horn → who writes `Horn`?, RUN → rung 3.',
      'Five fixes: `Ready_Light` needs `XIC(EStop_OK)` (N.C. = 1 when healthy). The E-stop contact of `Hand_Run` must be **after** the branch so it breaks the seal. The jog leg needs `XIC(HOA_Hand)`. Delete the Friday horn rung (duplicate OTE, last one wins). `Run_Light` from `Motor_Aux`.',
      '`[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);` · `[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);` · `XIC(Motor_Aux)OTE(Run_Light);` · `XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);` · keep `XIO(OL_OK)OTE(Horn);` and delete `XIC(Start_PB)OTE(Horn);`',
    ],
    tests: [
      {
        name: 'Power-up state',
        steps: [
          wait(300),
          expectObs('readyLight', true, 'READY must be ON at power-up (healthy and stopped)', { within: 100, for: 300 }),
          expectObs('runLight', false, 'RUN must be OFF at power-up', { for: 200 }),
          expectObs('faultLight', false, 'FAULT must be OFF at power-up', { for: 200 }),
          expectObs('horn', false, 'The horn must be quiet at power-up', { for: 200 }),
          staysOff('The motor must not start at power-up', 200),
        ],
      },
      {
        name: 'OFF means off — Jog too',
        steps: [
          set('hoa', OFF),
          wait(200),
          tap('start'),
          press('jog'),
          noCommand('In OFF neither Start nor Jog may run the motor', 500),
          release('jog'),
          set('remote_run', true),
          noCommand('In OFF, Remote_Run must do nothing', 500),
        ],
      },
      {
        name: 'HAND: start, lights, stop — no horn',
        steps: [
          set('hoa', HAND),
          wait(200),
          press('start'),
          wait(30),
          expectTag('Run_Light', false, 'Run_Light came ON before the contactor pulled in — drive it from Motor_Aux, not from the command'),
          expectObs('horn', false, 'The horn must not sound when Start is pressed — it is for overload trips only', { for: 150 }),
          release('start'),
          runs('HAND: Start must run the motor and seal in', 1000),
          lightIs('runLight', true, 'RUN must light while the motor runs'),
          lightIs('readyLight', false, 'READY must be OFF while the motor runs'),
          tap('stop'),
          stops('HAND: Stop must stop the motor', 500),
          lightIs('runLight', false, 'RUN must go OFF when the motor stops'),
          lightIs('readyLight', true, 'READY must return when the motor stops'),
        ],
      },
      {
        name: 'HAND: jog never seals',
        steps: [
          set('hoa', HAND),
          wait(200),
          press('jog'),
          runs('HAND: holding Jog must run the motor', 500),
          release('jog'),
          stops('Releasing Jog must stop the motor — jog never seals in', 1500),
        ],
      },
      {
        name: 'HAND: E-stop — no restart',
        steps: [
          set('hoa', HAND),
          wait(200),
          tap('start'),
          runs('HAND: Start must run the motor'),
          wait(500),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter'),
          lightIs('faultLight', true, 'FAULT must light while the E-stop is pushed'),
          lightIs('readyLight', false, 'READY must be OFF while the E-stop is pushed'),
          expectObs('horn', false, 'The horn is for overload trips only, not for the E-stop', { for: 300 }),
          set('estop', false),
          staysOff('DANGER: in HAND the motor restarted by itself after the E-stop was released', 2000),
          tap('start'),
          runs('Start must work again after the E-stop'),
        ],
      },
      {
        name: 'HAND → OFF → HAND',
        steps: [
          set('hoa', HAND),
          wait(200),
          tap('start'),
          runs('HAND: Start must run the motor'),
          set('hoa', OFF),
          stops('Switching to OFF must stop the motor'),
          wait(300),
          set('hoa', HAND),
          staysOff('Back in HAND the motor must wait for Start', 1500),
        ],
      },
      {
        name: 'AUTO must be armed',
        steps: [
          set('hoa', AUTO),
          set('remote_run', true),
          wait(200),
          staysOff('AUTO: the motor must not run until an operator arms AUTO with Start', 1000),
          tap('start'),
          runs('AUTO: once armed with Start, the motor must follow Remote_Run', 500),
          set('remote_run', false),
          stops('AUTO: Remote_Run OFF must stop the motor', 500),
          set('remote_run', true),
          runs('AUTO: still armed — the next run request must restart the motor'),
        ],
      },
      {
        name: 'AUTO: Stop and E-stop disarm',
        steps: [
          set('hoa', AUTO),
          wait(100),
          tap('start'),
          set('remote_run', true),
          runs('AUTO: armed + Remote_Run must run the motor'),
          wait(300),
          tap('stop'),
          stops('Stop must stop the motor in AUTO'),
          staysOff('After Stop the motor must stay off although Remote_Run is still ON — AUTO must be re-armed', 1500),
          tap('start'),
          runs('Start must re-arm AUTO'),
          wait(300),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter'),
          set('estop', false),
          staysOff('DANGER: the motor restarted by itself after the E-stop was released', 2000),
          tap('start'),
          runs('Start must re-arm AUTO after the E-stop'),
        ],
      },
      {
        name: 'Overload: horn, fault, no restart',
        steps: [
          set('hoa', HAND),
          wait(100),
          tap('start'),
          runs('HAND: Start must run the motor'),
          wait(300),
          set('overload_trip', true),
          commandDrops('The overload trip must drop Motor_Starter'),
          lightIs('horn', true, 'The horn must sound while the overload is tripped'),
          lightIs('faultLight', true, 'FAULT must light while the overload is tripped'),
          lightIs('readyLight', false, 'READY must be OFF while the overload is tripped'),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset', { within: 100 }),
          lightIs('horn', false, 'The horn must stop after the overload reset'),
          lightIs('faultLight', false, 'FAULT must go OFF after the overload reset'),
          staysOff('The motor must not restart by itself after the overload reset', 1500),
          tap('start'),
          runs('Start must work after the overload reset'),
        ],
      },
      {
        name: 'AUTO: an overload disarms',
        steps: [
          set('hoa', AUTO),
          wait(100),
          tap('start'),
          set('remote_run', true),
          runs('AUTO: armed + Remote_Run must run the motor'),
          wait(300),
          set('overload_trip', true),
          commandDrops('The overload trip must drop Motor_Starter'),
          lightIs('horn', true, 'The horn must sound while the overload is tripped'),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset', { within: 100 }),
          staysOff(
            'DANGER: AUTO restarted the motor by itself after the overload reset (Remote_Run is still ON) — an overload trip must disarm AUTO',
            1500,
          ),
          tap('start'),
          runs('Start must re-arm AUTO after the overload reset'),
        ],
      },
      {
        name: 'Leaving AUTO disarms; Jog is HAND-only',
        steps: [
          set('hoa', AUTO),
          wait(100),
          tap('start'),
          set('remote_run', true),
          runs('AUTO: armed + Remote_Run must run the motor'),
          set('hoa', OFF),
          stops('Switching AUTO → OFF must stop the motor'),
          wait(200),
          set('hoa', AUTO),
          staysOff('Back in AUTO the motor must wait to be re-armed with Start', 1500),
          set('remote_run', false),
          press('jog'),
          noCommand('Jog works in HAND only', 500),
          release('jog'),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS, OFF_MEANS_OFF],
    parInstructions: 34,
    allowedInstructions: MOTOR_BITS,
    debrief: `Five faults, five different kinds of mistake — and every one of them is found in real plants every week:

1. **N.C. confusion** (\`XIO\` on a normally-closed E-stop contact) — READY upside down.
2. **An interlock on the wrong branch** — the E-stop only blocked the Start leg, so the seal survived and the motor restarted. The most dangerous one of the night.
3. **A missing permissive** — Jog without \`HOA_Hand\` defeated the OFF position that maintenance relied on.
4. **A duplicate destructive bit** — the "warning beep" rung overwrote the overload horn.
5. **Command instead of feedback** — a RUN light that only promises.

**Field tip:** after any program change, re-run the **whole** acceptance test (the SAT sheet from commissioning
day), not just the part you touched — and never "lock out" a machine with a PLC selector. Real lockout/tagout
means an isolating switch with **your** padlock on it.`,
  },
];
