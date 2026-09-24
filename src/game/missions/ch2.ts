/**
 * Chapter 2 — Motor Control (scene 'motor-station'): 3-wire start/stop seal-in, pilot lights from
 * feedback, E-stop / overload interlocks without auto-restart, OTL/OTU and the prescan trap, jog,
 * Hand-Off-Auto and a commissioning boss.
 */
import type { MissionDef, MissionInvariant, TestStep } from '../types';
import { expectObs, expectTag, mode, press, release, set, tap, wait } from './authoring';

// --- rungs reused as starters / solutions -----------------------------------
const SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)OTE(Motor_Starter);';
const SAFE_SEAL = '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);';
const RUN_LIGHT = 'XIC(Motor_Aux)OTE(Run_Light);';
const READY_LIGHT = 'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);';
const FAULT_LIGHT = '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);';

const LIGHT_COMMENTS = ['RUN pilot light (green) — from contactor feedback', 'READY pilot light (white)', 'FAULT pilot light (red)'];

// --- invariants ---------------------------------------------------------------
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
  message: 'Motor_Starter must be OFF while the E-stop is pushed — the PLC must drop the command too, not only the hardwired contact',
};
const OVERLOAD_DROPS: MissionInvariant = {
  when: { observe: 'overloadTripped', equals: true },
  tag: 'Motor_Starter',
  equals: false,
  graceMs: 20,
  message: 'Motor_Starter must be OFF while the overload relay is tripped (OL_OK = 0)',
};
const OFF_MEANS_OFF: MissionInvariant = {
  when: { control: 'hoa', equals: 1 },
  tag: 'Motor_Starter',
  equals: false,
  graceMs: 20,
  message: 'Motor_Starter must be OFF while the Hand-Off-Auto selector is in OFF',
};

// --- step shorthands ------------------------------------------------------------
const HAND = 0;
const OFF = 1;
const AUTO = 2;

/** The contactor must pull in within 150 ms (and optionally stay in for `hold` ms). */
const runs = (message: string, hold?: number): TestStep =>
  expectObs('contactor', true, message, hold === undefined ? { within: 150 } : { within: 150, for: hold });
/** The contactor must drop out within 150 ms (and optionally stay out for `hold` ms). */
const stops = (message: string, hold?: number): TestStep =>
  expectObs('contactor', false, message, hold === undefined ? { within: 150 } : { within: 150, for: hold });
/** The contactor must stay out for `ms` (checked from now). */
const staysOff = (message: string, ms: number): TestStep => expectObs('contactor', false, message, { for: ms });
/** The PLC command itself must drop within 30 ms (same scan or the next). */
const commandDrops = (message: string): TestStep => expectTag('Motor_Starter', false, message, { within: 30 });
/** The PLC must not command the motor for `ms`. */
const noCommand = (message: string, ms: number): TestStep => expectTag('Motor_Starter', false, message, { for: ms });
/** A pilot light / horn must settle to `value` within 150 ms and hold it (a bare instant check could pass vacuously). */
const lightIs = (id: string, value: boolean, message: string, hold = 200): TestStep =>
  expectObs(id, value, message, { within: 150, for: hold });

const MOTOR_BITS = ['XIC', 'XIO', 'OTE'];

export const CH2_MISSIONS: MissionDef[] = [
  // -------------------------------------------------------------------------
  {
    id: '2-1',
    chapter: 'motor-control',
    order: 1,
    title: 'Start/Stop Station',
    tagline: 'The seal-in circuit: the most-written rung in the world.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 2,
    xp: 100,
    briefing: `Monday, 6:40 AM. The night shift taped a note to Line 3's motor control station:
*"Conveyor only runs while you HOLD Start. Operators are zip-tying the button down. Please fix!!"*

Line 3's 5 HP conveyor motor is switched by a **100-C09 contactor** (coil M) protected by a **193-E overload
relay**, and operated from an **800F push-button station**.

**The hardware**
- \`Start_PB\` → \`Local:1:I.Data.0\` — green flush button, **N.O.**: 1 only while pressed.
- \`Stop_PB\` → \`Local:1:I.Data.1\` — red extended button, **N.C.**: **1 when NOT pressed**, 0 while pressed.
- \`Motor_Starter\` → \`Local:2:O.Data.0\` — the contactor coil.

The E-stop and the overload's 95-96 contact are **hardwired in series with the coil**, so they cut the motor
even if the PLC misbehaves. (Making the PLC aware of them is mission 2-3.)

**Your task — a classic 3-wire start/stop**
- Pressing **Start** runs the motor, and it **keeps running** after Start is released.
- Pressing **Stop** stops it, and it stays stopped.
- If Start and Stop are pressed together, **Stop wins**.`,
    objectives: [
      'Start runs the motor and it keeps running after Start is released (seal-in)',
      'Stop (N.C.) stops the motor and it stays stopped',
      'Stop wins when both buttons are pressed',
    ],
    concepts: ['XIC', 'OTE'],
    starter: {
      rungs: ['XIC(Start_PB)OTE(Motor_Starter);'],
      comments: ['Conveyor motor — runs only while Start is held. Fix me!'],
    },
    solution: { rungs: [SEAL] },
    hints: [
      'The rung has to "remember" that Start was pressed. Which bit is already ON once the motor is running?',
      'Put a contact of the output itself — `XIC(Motor_Starter)` — in **parallel** with Start: that is the *seal-in* (holding) contact. Then put Stop in **series after** the branch so it breaks both paths.',
      '`[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)OTE(Motor_Starter);` — Stop is N.C., so `XIC(Stop_PB)` is true while Stop is NOT pressed.',
    ],
    tests: [
      {
        name: 'Motor stays off at power-up',
        steps: [wait(300), staysOff('The motor must not start by itself at power-up', 1000)],
      },
      {
        name: 'Start runs the motor — and it keeps running',
        steps: [
          wait(200),
          tap('start'),
          runs('Pressing Start must energize Motor_Starter (the contactor pulls in)'),
          expectObs('contactor', true, 'The motor must keep running after Start is released — add a seal-in contact', { for: 3000 }),
          expectObs('motorRunning', true, 'The conveyor motor should be up to speed', { within: 1000 }),
        ],
      },
      {
        name: 'Stop stops it — and it stays stopped',
        steps: [
          wait(200),
          tap('start'),
          runs('Pressing Start must run the motor'),
          wait(500),
          tap('stop'),
          stops('Pressing Stop must drop the motor'),
          staysOff('The motor must stay stopped after Stop is released', 1500),
          tap('start'),
          runs('Start must restart the motor after a stop', 500),
        ],
      },
      {
        name: 'Stop wins when both are pressed',
        steps: [
          wait(200),
          press('stop'),
          tap('start', 300),
          staysOff('With Stop held, Start must not run the motor', 300),
          release('stop'),
          staysOff('Releasing Stop must not start the motor', 1000),
          tap('start'),
          runs('Start must run the motor'),
          press('start'),
          wait(200),
          press('stop'),
          expectTag('Motor_Starter', false, 'With Start AND Stop both held, Stop must win', { within: 30, for: 500 }),
          release('start'),
          release('stop'),
          staysOff('After both buttons are released the motor must stay stopped', 1000),
        ],
      },
    ],
    invariants: [STOP_WINS],
    parInstructions: 4,
    allowedInstructions: MOTOR_BITS,
    debrief: `You just wrote the most common rung in industrial automation: **3-wire control** with a **seal-in**
(holding) contact. Stop sits in series *after* the branch, so it breaks both the Start path and the seal:
Stop always wins.

**Field tip:** 3-wire control also gives you *undervoltage protection*. After a power dip the contactor drops,
the seal opens, and the motor does **not** restart by itself when power returns — someone must press Start.
A 2-wire (maintained switch) circuit would restart on its own, which is why it's reserved for things like
pumps on float switches.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '2-2',
    chapter: 'motor-control',
    order: 2,
    title: 'Pilot Lights',
    tagline: 'RUN from real feedback, READY when healthy and stopped.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 2,
    xp: 110,
    briefing: `The operators love the new start/stop — but they can't tell from across the aisle whether the conveyor
is running or ready. Time for **pilot lights**.

Dana's rule: *"A RUN light must tell the truth. Don't light it because the PLC **asked** the motor to run —
light it because the contactor **proved** it pulled in."* That proof is the contactor's **auxiliary contact**.

**The hardware**
- \`Motor_Aux\` → \`Local:1:I.Data.5\` — contactor auxiliary contact 13-14, **N.O.**: 1 once the contactor has pulled in
  (about 40 ms after the coil is energized).
- \`EStop_OK\` → \`Local:1:I.Data.2\` — E-stop, **N.C.**: 1 = released (healthy), 0 = pushed.
- \`OL_OK\` → \`Local:1:I.Data.4\` — overload relay 95-96, **N.C.**: 1 = healthy, 0 = tripped.
- \`Run_Light\` → \`Local:2:O.Data.1\` — green pilot light.
- \`Ready_Light\` → \`Local:2:O.Data.4\` — white pilot light.

**Your task** (your start/stop rung from 2-1 is already there)
- \`Run_Light\` ON while the contactor is actually closed (\`Motor_Aux\`).
- \`Ready_Light\` ON while the station is **healthy** (E-stop released AND overload OK) **and** the motor is **stopped**.`,
    objectives: [
      '`Run_Light` is driven by the contactor feedback `Motor_Aux`',
      '`Ready_Light` = E-stop released AND overload OK AND motor stopped',
      'Start/Stop keeps working',
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: {
      rungs: [SEAL, '', ''],
      comments: ['Start/Stop seal-in (mission 2-1)', 'RUN pilot light (green)', 'READY pilot light (white)'],
    },
    solution: { rungs: [SEAL, RUN_LIGHT, READY_LIGHT] },
    hints: [
      'Each light gets its own rung. Which input proves the contactor is closed?',
      'RUN: one XIC of `Motor_Aux`. READY: both N.C. safety inputs read 1 when healthy, so use XIC for them — and XIO for "motor not running".',
      '`XIC(Motor_Aux)OTE(Run_Light);` and `XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);`',
    ],
    tests: [
      {
        name: 'Idle station: READY on, RUN off',
        steps: [
          wait(300),
          expectObs('readyLight', true, 'READY must be ON: E-stop released, overload OK, motor stopped', { within: 100, for: 500 }),
          expectObs('runLight', false, 'RUN must be OFF while the motor is stopped', { for: 300 }),
        ],
      },
      {
        name: 'Running: RUN on, READY off',
        steps: [
          wait(200),
          tap('start'),
          expectObs('runLight', true, 'RUN must light while the motor runs', { within: 150, for: 1000 }),
          expectObs('readyLight', false, 'READY must be OFF while the motor runs', { for: 300 }),
          tap('stop'),
          expectObs('runLight', false, 'RUN must go OFF when the motor stops', { within: 150, for: 500 }),
          lightIs('readyLight', true, 'READY must come back once the motor has stopped'),
        ],
      },
      {
        name: 'RUN is proof, not a promise',
        description: 'Run_Light must come from the auxiliary contact, not from the Motor_Starter command.',
        steps: [
          wait(200),
          press('start'),
          wait(30),
          expectTag(
            'Run_Light',
            false,
            'Run_Light came ON before the contactor had even pulled in — drive it from the auxiliary contact Motor_Aux (proof the contactor closed), not from the Motor_Starter command',
          ),
          lightIs('runLight', true, 'RUN must light once the contactor has pulled in'),
          release('start'),
          wait(500),
          set('estop', true),
          expectObs('runLight', false, 'The E-stop opened the contactor: RUN must go OFF even if your logic still commands the motor', {
            within: 150,
            for: 300,
          }),
          lightIs('readyLight', false, 'READY must be OFF while the E-stop is pushed'),
        ],
      },
      {
        name: 'READY means healthy',
        steps: [
          wait(200),
          lightIs('readyLight', true, 'READY must be ON when healthy and stopped'),
          set('estop', true),
          expectObs('readyLight', false, 'READY must go OFF while the E-stop is pushed', { within: 150, for: 300 }),
          set('estop', false),
          lightIs('readyLight', true, 'READY must return when the E-stop is released'),
          set('overload_trip', true),
          expectObs('readyLight', false, 'READY must go OFF while the overload relay is tripped', { within: 150, for: 300 }),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should have reset', { within: 100 }),
          lightIs('readyLight', true, 'READY must return after the overload is reset'),
        ],
      },
    ],
    invariants: [STOP_WINS],
    parInstructions: 10,
    allowedInstructions: MOTOR_BITS,
    debrief: `A pilot light driven by **feedback** tells the truth: if the contactor welds, burns a coil or loses its
supply, the RUN light and the PLC both know.

Did you try the E-stop while the motor was running — and then release it? **The motor restarted by
itself.** The hardwired E-stop dropped the contactor, but your seal-in never noticed. That is a genuinely
dangerous bug, and it's your next mission.

**Field tip:** the auxiliary contact is also how you detect a *failed* contactor: commanded ON but no
Motor_Aux after half a second = "motor failed to start" alarm (you'll need a timer — chapter 3).`,
  },

  // -------------------------------------------------------------------------
  {
    id: '2-3',
    chapter: 'motor-control',
    order: 3,
    title: 'Safety First',
    tagline: 'E-stop and overload must drop the seal — no surprise restarts.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 3,
    xp: 150,
    briefing: `Gus walks up, pale. *"I hit the E-stop to clear a jam, twisted it out... and the conveyor took off with my
hand still in it."* Nobody got hurt this time.

The hardwired circuit drops the contactor, but the PLC's seal-in stays ON — so the moment the E-stop is
released (or the overload is reset), the motor restarts **by itself**. Safety standards (ISO 13850,
NFPA 79) are clear: **resetting an E-stop must never restart a machine.** Only a deliberate new Start may.

**The hardware**
- \`EStop_OK\` → \`Local:1:I.Data.2\` — twist-to-release E-stop, **N.C.**: 1 = released, 0 = pushed.
- \`OL_OK\` → \`Local:1:I.Data.4\` — overload relay 95-96, **N.C.**: 1 = healthy, 0 = tripped
  (a jammed conveyor stalls the motor and trips it after about 3 s; the blue RESET on the relay resets it once it cools).
- \`Fault_Light\` → \`Local:2:O.Data.2\` — red pilot light.

**Your task**
- The E-stop and the overload must drop \`Motor_Starter\` **in the logic** (same scan) and break the seal.
- After the E-stop is released or the overload is reset, the motor stays **off** until Start is pressed.
- \`Fault_Light\` ON while the E-stop is pushed **or** the overload is tripped.
- Everything from 2-1 and 2-2 keeps working.`,
    objectives: [
      'E-stop pushed → `Motor_Starter` OFF, and no restart when it is released',
      'Overload tripped → `Motor_Starter` OFF, and no restart after the reset',
      'Start is refused while the E-stop is pushed or the overload is tripped',
      '`Fault_Light` = E-stop pushed OR overload tripped',
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: {
      rungs: [SEAL, RUN_LIGHT, READY_LIGHT, ''],
      comments: ['Motor start/stop — the E-stop is only hardwired so far!', ...LIGHT_COMMENTS],
    },
    solution: { rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT] },
    hints: [
      'Where must a contact sit so that it breaks BOTH the Start path and the seal-in path? (Same place as Stop.)',
      'Add `XIC(EStop_OK)` and `XIC(OL_OK)` in **series** with `XIC(Stop_PB)`, after the branch. Both are N.C. devices: XIC = healthy. For the fault light, "pushed" / "tripped" is a 0 → XIO, in parallel.',
      '`[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);` and `[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);`',
    ],
    tests: [
      {
        name: 'Normal start and stop',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must still run the motor', 1000),
          expectObs('faultLight', false, 'No fault: FAULT must be OFF', { for: 200 }),
          tap('stop'),
          stops('Stop must still stop the motor', 500),
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
          commandDrops('Pushing the E-stop must also drop Motor_Starter in the logic'),
          expectObs('faultLight', true, 'FAULT must light while the E-stop is pushed', { within: 150, for: 500 }),
          set('estop', false),
          lightIs('faultLight', false, 'FAULT must go OFF once the E-stop is released'),
          staysOff(
            'DANGER: the motor restarted by itself when the E-stop was released. The E-stop must break the seal-in so only a new Start restarts it',
            2000,
          ),
          tap('start'),
          runs('Start must work again after the E-stop is released'),
        ],
      },
      {
        name: 'Start is refused while the E-stop is pushed',
        steps: [
          wait(200),
          set('estop', true),
          tap('start'),
          noCommand('Start must be ignored while the E-stop is pushed', 500),
          set('estop', false),
          staysOff('Releasing the E-stop must not start the motor', 1000),
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
          commandDrops('An overload trip (OL_OK = 0) must drop Motor_Starter'),
          expectObs('faultLight', true, 'FAULT must light while the overload is tripped', { within: 150, for: 500 }),
          tap('start'),
          noCommand('Start must be refused while the overload is tripped', 300),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset', { within: 100 }),
          lightIs('faultLight', false, 'FAULT must go OFF after the overload is reset'),
          staysOff('DANGER: the motor restarted by itself after the overload reset', 2000),
          tap('start'),
          runs('Start must work again after the overload reset'),
        ],
      },
      {
        name: 'Jammed conveyor',
        description: 'A real jam: the motor stalls and the overload trips on its own.',
        steps: [
          wait(200),
          tap('start'),
          expectObs('motorRunning', true, 'The motor should be running', { within: 1000 }),
          set('jam', true),
          expectObs('overloadTripped', true, 'A stalled motor should trip the overload relay within about 3 s', { within: 4000 }),
          commandDrops('The tripped overload must drop Motor_Starter'),
          lightIs('faultLight', true, 'FAULT must light on the overload trip'),
          set('jam', false),
          wait(2500),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset once it has cooled', { within: 100 }),
          staysOff('The motor must not restart by itself after the overload reset', 1500),
          tap('start'),
          runs('Start must work after the jam is cleared'),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS],
    parInstructions: 15,
    allowedInstructions: MOTOR_BITS,
    debrief: `Safety interlocks go **in series with Stop, after the seal-in branch** — anything that must stop the
machine has to break the seal too, otherwise the machine "remembers" it was running.

**Field tip:** the E-stop stays **hardwired** in the coil circuit (or goes through a safety relay / safety
PLC). A standard PLC program is never trusted as the only thing between a person and a moving machine —
a stuck output transistor or a bad online edit can't be allowed to defeat an E-stop. The PLC input is
there so the *logic* knows what happened: to drop the seal, light the fault lamp, log the event.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '2-4',
    chapter: 'motor-control',
    order: 4,
    title: 'Latch & Unlatch',
    tagline: 'OTL/OTU — and the prescan trap that bites old-timers.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 3,
    xp: 150,
    briefing: `Riverside just bought a used packaging line, and its program is full of **OTL** (Output Latch) and
**OTU** (Output Unlatch) instead of seal-ins. Dana wants you to understand them — including their trap.

- **OTL** sets its bit to 1 when its rung is true, and **does nothing** when the rung is false.
- **OTU** clears its bit to 0 when its rung is true.
- The bit stays where it was left: it is **retentive**.

**The trap:** Logix tags keep their values through Program mode and power cycles. When the controller goes
to Run it performs a **prescan** that clears OTE outputs — but leaves OTL bits alone. A latched motor starter
restarts the instant the controller returns to Run after a mode change or a power failure (and even after a
download, if the project file was saved with the bit set — for example after an upload).
The first-scan flag **\`S:FS\`** is 1 during the first scan after entering Run.

**Your task**
- Rebuild the start/stop with **OTL** (Start) and **OTU** (Stop, E-stop, overload) on \`Motor_Starter\`.
- Stop must still **win** when both buttons are pressed (rung order matters!).
- After a **Program → Run** transition the motor must stay **off** until Start is pressed.
- The pilot-light rungs are already there.`,
    objectives: [
      'Start latches `Motor_Starter` with OTL',
      'Stop, E-stop and overload unlatch it with OTU — Stop wins',
      'No restart after a Program → Run transition (use `S:FS`)',
    ],
    concepts: ['OTL', 'OTU', 'XIC', 'XIO'],
    starter: {
      rungs: ['', '', RUN_LIGHT, READY_LIGHT, FAULT_LIGHT],
      comments: ['Latch the motor starter here (OTL)', 'Unlatch it here (OTU): Stop, E-stop, overload, first scan', ...LIGHT_COMMENTS],
    },
    solution: {
      rungs: [
        'XIC(Start_PB)OTL(Motor_Starter);',
        '[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK),XIC(S:FS)]OTU(Motor_Starter);',
        RUN_LIGHT,
        READY_LIGHT,
        FAULT_LIGHT,
      ],
    },
    hints: [
      'Within a scan, rungs execute top to bottom and the outputs go to the field at the end of the scan. If one rung latches and a later rung unlatches, which one wins?',
      'Rung 0: Start → OTL. Rung 1 (after it): any stop condition → OTU. The stop conditions are 0 when active (N.C. devices), so use XIO — and add a parallel leg for the first scan, `XIC(S:FS)`.',
      '`XIC(Start_PB)OTL(Motor_Starter);` then `[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK),XIC(S:FS)]OTU(Motor_Starter);`',
    ],
    tests: [
      {
        name: 'Start latches, Stop unlatches',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must latch the motor ON (OTL) and it must stay ON after the release', 1500),
          tap('stop'),
          stops('Stop must unlatch the motor (OTU)', 1000),
          tap('start'),
          runs('Start must latch it again'),
        ],
      },
      {
        name: 'Stop wins',
        steps: [
          wait(200),
          press('stop'),
          tap('start', 300),
          staysOff('With Stop held, Start must not run the motor', 300),
          release('stop'),
          staysOff('Releasing Stop must not start the motor', 1000),
          press('start'),
          wait(200),
          press('stop'),
          expectTag('Motor_Starter', false, 'With Start and Stop both held, Stop must win — put the OTU rung AFTER the OTL rung', {
            within: 30,
            for: 500,
          }),
          release('start'),
          release('stop'),
          staysOff('After both buttons are released the motor must stay stopped', 1000),
        ],
      },
      {
        name: 'E-stop and overload unlatch',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          set('estop', true),
          commandDrops('The E-stop must unlatch Motor_Starter'),
          set('estop', false),
          staysOff('No restart when the E-stop is released', 1500),
          tap('start'),
          runs('Start must work after the E-stop is released'),
          set('overload_trip', true),
          commandDrops('An overload trip must unlatch Motor_Starter'),
          set('overload_trip', false),
          tap('overload_reset'),
          staysOff('No restart after the overload reset', 1500),
          tap('start'),
          runs('Start must work after the overload reset'),
        ],
      },
      {
        name: 'Program → Run: no surprise restart',
        description: 'Switches the controller to Program mode and back to Run while the motor is latched.',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor', 500),
          mode('PROG'),
          expectObs('contactor', false, 'In Program mode the outputs are off, so the contactor drops', { within: 50 }),
          wait(1000),
          mode('RUN'),
          staysOff(
            'DANGER: the motor restarted by itself when the controller went back to Run. OTL bits survive Program mode — unlatch Motor_Starter on the first scan with XIC(S:FS)',
            2000,
          ),
          tap('start'),
          runs('Start must work after returning to Run'),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS],
    parInstructions: 16,
    allowedInstructions: ['XIC', 'XIO', 'OTE', 'OTL', 'OTU'],
    // Operand-aware: a dummy OTL/OTU on some unrelated output must not satisfy the lesson.
    requiredInstructions: ['OTL(Motor_Starter)', 'OTU(Motor_Starter)'],
    debrief: `OTL/OTU work, but they're **retentive**: the bit survives Program mode and power cycles — and an
upload/download round-trip carries it along too. The prescan clears OTE coils, so a seal-in circuit drops out naturally — a latched output does
not. That's why many plant standards ban OTL on anything that moves, or require a first-scan unlatch like
your \`XIC(S:FS)\` leg.

**Field tip:** latches shine where you *want* memory — alarm bits that must stay set until acknowledged,
"part present" flags that must survive a power dip. For motors, prefer the seal-in.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '2-5',
    chapter: 'motor-control',
    order: 5,
    title: 'Jog Mode',
    tagline: 'Run only while held — and never, ever seal in.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 3,
    xp: 160,
    briefing: `Maintenance is changing the belt lacing on Line 3 and needs to **inch** the belt a few centimeters at a
time. That's what the black **Jog** button is for: the motor runs **only while Jog is held**, and stops the
instant it is released.

**The hardware**
- \`Jog_PB\` → \`Local:1:I.Data.3\` — black flush push button, **N.O.**
- A spare internal tag \`Run_Latch\` (BOOL) is already created for you.

**The trap:** if Jog simply energizes \`Motor_Starter\`, your seal-in contact \`XIC(Motor_Starter)\` closes too —
and the motor keeps running after the jog. The seal must come from **Start only**.

**Your task** (your safe start/stop from 2-3 is loaded)
- Jog runs the motor only while held and **never seals in** — not even after a normal run.
- Start/Stop keep working exactly as before.
- **Stop, E-stop and the overload stop everything, jog included** — and, as in 2-3, nothing restarts by itself
  after the E-stop is released or the overload is reset.
- What Jog does while the motor is already running is up to you (we don't test it).`,
    objectives: [
      'Jog runs the motor only while held',
      'Jog never seals in',
      'Start still seals in, Stop still stops',
      'E-stop / overload cancel the run: no restart after the release or reset',
      'Stop, E-stop and overload also block jog',
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: {
      rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT],
      comments: ['Motor start/stop with safety interlocks (mission 2-3)', ...LIGHT_COMMENTS],
      tags: [{ name: 'Run_Latch', dataType: 'BOOL', description: 'Run request sealed by Start (never by Jog)' }],
    },
    solution: {
      rungs: [
        '[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);',
        '[XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        RUN_LIGHT,
        READY_LIGHT,
        FAULT_LIGHT,
      ],
    },
    hints: [
      'Separate "the operator asked for a continuous run" (a memory) from "the motor contactor is ON" (an output).',
      'Seal the internal bit `Run_Latch` with Start (same interlocks as before). Then energize `Motor_Starter` from `Run_Latch` OR `Jog_PB`, again through Stop, E-stop and overload.',
      '`[XIC(Start_PB),XIC(Run_Latch)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Run_Latch);` then `[XIC(Run_Latch),XIC(Jog_PB)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);`',
    ],
    tests: [
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
        name: 'Start and Stop still work',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor and seal in', 1500),
          tap('stop'),
          stops('Stop must stop the motor', 1000),
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
        name: 'E-stop and overload during a normal run',
        description: 'The run request must be dropped too, not only the output: no restart after the E-stop or the overload reset.',
        steps: [
          wait(200),
          tap('start'),
          runs('Start must run the motor'),
          wait(300),
          set('estop', true),
          commandDrops('Pushing the E-stop must drop Motor_Starter'),
          wait(200),
          set('estop', false),
          staysOff(
            'DANGER: the motor restarted by itself after the E-stop was released — the E-stop must also break the Run_Latch seal-in',
            1500,
          ),
          tap('start'),
          runs('Start must work again after the E-stop is released'),
          wait(300),
          set('overload_trip', true),
          commandDrops('An overload trip must drop Motor_Starter'),
          wait(200),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset', { within: 100 }),
          staysOff(
            'DANGER: the motor restarted by itself after the overload reset — the overload must also break the Run_Latch seal-in',
            1500,
          ),
          tap('start'),
          runs('Start must work again after the overload reset'),
        ],
      },
      {
        name: 'Safety applies to jog',
        description: 'Jog pressed while Stop is held, the E-stop is pushed or the overload is tripped.',
        steps: [
          wait(200),
          set('estop', true),
          wait(50),
          press('jog'),
          noCommand('Jog must not command the motor while the E-stop is pushed', 500),
          release('jog'),
          set('estop', false),
          wait(200),
          press('stop'),
          wait(50),
          press('jog'),
          noCommand('Stop must win over Jog', 500),
          release('jog'),
          release('stop'),
          wait(200),
          set('overload_trip', true),
          wait(50),
          press('jog'),
          noCommand('Jog must not command the motor while the overload is tripped', 500),
          release('jog'),
          set('overload_trip', false),
          tap('overload_reset'),
          staysOff('Nothing may start after the overload reset', 1000),
        ],
      },
      {
        name: 'E-stop while jogging',
        steps: [
          wait(200),
          press('jog'),
          runs('Jog must run the motor'),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter during a jog'),
          release('jog'),
          set('estop', false),
          staysOff('The motor must stay stopped after the E-stop is released', 1500),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS],
    parInstructions: 21,
    allowedInstructions: MOTOR_BITS,
    debrief: `Splitting the **run request** (\`Run_Latch\`) from the **output** (\`Motor_Starter\`) is a pattern you'll use
forever: the request remembers what the operator wanted, the output rung decides whether the motor may
actually run right now.

**Field tip:** in hardwired panels, jog is done with a *jog relay* or a special jog/run selector so the seal
circuit is physically opened while jogging. The bug you avoided — jog sealing in — has caused real
injuries on conveyors and presses. Many machines also sound a warning horn or limit jog speed through the
drive.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '2-6',
    chapter: 'motor-control',
    order: 6,
    title: 'Hand-Off-Auto',
    tagline: 'Local control, remote control, or nothing at all.',
    kind: 'build',
    sceneId: 'motor-station',
    difficulty: 4,
    xp: 175,
    briefing: `Line 3 is being tied into the new upstream filler. From now on the filler's controller sends a **run
request** when it wants the conveyor — but maintenance still needs local control. Enter the **Hand-Off-Auto**
(HOA) selector switch.

**The hardware**
- \`HOA_Hand\` → \`Local:1:I.Data.6\` — selector HAND contact: 1 in HAND.
- \`HOA_Auto\` → \`Local:1:I.Data.7\` — selector AUTO contact: 1 in AUTO. **OFF = both contacts 0.**
- \`Remote_Run\` → \`Local:1:I.Data.8\` — run request relay from the upstream filler (1 = run please).

**Your task**
- **OFF:** the motor never runs — not with Start, not with Remote_Run.
- **HAND:** local 3-wire control: Start runs and seals in, Stop stops. Remote_Run is ignored.
- **AUTO:** the motor runs **while** Remote_Run is ON (no seal — the filler is in charge). Start is ignored.
- Leaving HAND drops the seal: back in HAND the motor waits for Start.
- In **every** position: Stop, E-stop and overload stop the motor. Keep the lights working.
  (In AUTO there is no seal, so they only hold the motor off while they are active — more on that in the debrief.)`,
    objectives: [
      'OFF: the motor never runs',
      'HAND: Start/Stop seal-in; Remote_Run ignored',
      'AUTO: motor follows Remote_Run; Start ignored',
      'Switching out of HAND drops the seal',
      'Stop, E-stop and overload work in every position',
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: {
      rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT],
      comments: ['Motor start/stop with safety interlocks (mission 2-3)', ...LIGHT_COMMENTS],
    },
    solution: {
      rungs: [
        '[XIC(HOA_Hand)[XIC(Start_PB),XIC(Motor_Starter)],XIC(HOA_Auto)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        RUN_LIGHT,
        READY_LIGHT,
        FAULT_LIGHT,
      ],
    },
    hints: [
      'There are two ways to run: a HAND path and an AUTO path. Both must pass through the same Stop / E-stop / overload contacts.',
      'Two parallel legs before the interlocks: `XIC(HOA_Hand)` followed by the Start/seal branch, and `XIC(HOA_Auto)XIC(Remote_Run)`. Branches can be **nested**.',
      '`[XIC(HOA_Hand)[XIC(Start_PB),XIC(Motor_Starter)],XIC(HOA_Auto)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);`',
    ],
    tests: [
      {
        name: 'OFF means off',
        steps: [
          wait(200),
          tap('start'),
          noCommand('In OFF, Start must do nothing', 500),
          set('remote_run', true),
          noCommand('In OFF, Remote_Run must do nothing', 1000),
        ],
      },
      {
        name: 'HAND: local start and stop',
        steps: [
          set('hoa', HAND),
          wait(200),
          tap('start'),
          runs('In HAND, Start must run the motor and seal in', 1000),
          set('remote_run', true),
          wait(300),
          set('remote_run', false),
          expectObs('contactor', true, 'In HAND, Remote_Run must not matter', { for: 500 }),
          tap('stop'),
          stops('In HAND, Stop must stop the motor', 500),
          set('remote_run', true),
          staysOff('In HAND, Remote_Run must not start the motor', 1000),
        ],
      },
      {
        name: 'Leaving HAND drops the seal',
        steps: [
          set('hoa', HAND),
          wait(200),
          tap('start'),
          runs('In HAND, Start must run the motor'),
          wait(300),
          set('hoa', OFF),
          stops('Turning the selector to OFF must stop the motor'),
          wait(300),
          set('hoa', HAND),
          staysOff('Back in HAND the motor must wait for Start', 1500),
        ],
      },
      {
        name: 'AUTO follows Remote_Run',
        steps: [
          set('hoa', AUTO),
          wait(300),
          staysOff('In AUTO without a run request the motor must be off', 300),
          tap('start'),
          staysOff('In AUTO the local Start button is ignored', 500),
          set('remote_run', true),
          runs('In AUTO the motor must run while Remote_Run is ON', 1000),
          set('remote_run', false),
          stops('In AUTO the motor must stop when Remote_Run goes OFF (no seal-in in AUTO)', 1000),
          set('remote_run', true),
          runs('In AUTO the motor must restart with the next run request'),
          set('hoa', OFF),
          stops('Switching AUTO → OFF must stop the motor'),
        ],
      },
      {
        name: 'Safety in HAND',
        steps: [
          set('hoa', HAND),
          wait(200),
          tap('start'),
          runs('In HAND, Start must run the motor'),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter in HAND'),
          set('estop', false),
          staysOff('In HAND the motor must not restart by itself after the E-stop is released', 1500),
          tap('start'),
          runs('In HAND, Start must work again after the E-stop'),
          set('overload_trip', true),
          commandDrops('An overload trip must drop Motor_Starter in HAND'),
          set('overload_trip', false),
          tap('overload_reset'),
          staysOff('In HAND the motor must not restart by itself after the overload reset', 1500),
        ],
      },
      {
        name: 'Safety in AUTO',
        steps: [
          set('hoa', AUTO),
          set('remote_run', true),
          wait(200),
          runs('In AUTO the motor must run while Remote_Run is ON'),
          press('stop'),
          commandDrops('Stop must stop the motor in AUTO too'),
          release('stop'),
          wait(500),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter in AUTO'),
          lightIs('faultLight', true, 'FAULT must light while the E-stop is pushed'),
          wait(300),
          set('overload_trip', true),
          set('estop', false),
          noCommand('The overload must hold the motor off in AUTO', 500),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS, OFF_MEANS_OFF],
    parInstructions: 18,
    allowedInstructions: MOTOR_BITS,
    debrief: `One rung, two sources of command, one set of interlocks. Nested branches keep it readable: each leg
reads like a sentence ("in HAND, Start or already running" / "in AUTO, the filler asks").

Did you notice? In AUTO nothing is sealed in, so Stop and the E-stop only **hold** the motor off. Release
Stop, twist the E-stop out or reset the overload while Remote_Run is still ON, and the motor restarts by
itself — exactly what missions 2-1 and 2-3 taught you to prevent ("stays stopped"). The spec for this mission
accepts it; the real fix is an **arming** memory that a Stop or a fault clears, so only a deliberate Start
re-enables AUTO. That's your job on **Commissioning Day**.

**Field tip:** in a hardwired HOA the HAND position often bypasses the PLC completely, so a dead PLC can't
stop production. With a PLC-based HOA, make sure the interlocks (overload, E-stop) are still hardwired.`,
  },

  // -------------------------------------------------------------------------
  {
    id: '2-7',
    chapter: 'motor-control',
    order: 7,
    title: 'Commissioning Day',
    tagline: 'Boss: the full motor starter — modes, jog, lights, safety.',
    kind: 'boss',
    sceneId: 'motor-station',
    difficulty: 5,
    xp: 300,
    briefing: `Commissioning day. The customer's engineer is standing next to you with a clipboard and a **functional
specification**. Every line gets tested. Dana gives you a thumbs-up from across the floor.

**Functional specification — Line 3 conveyor starter**
1. **OFF:** the motor never runs (Start, Jog and Remote_Run do nothing).
2. **HAND:** Start runs and seals in, Stop stops. **Jog** runs only while held and never seals in.
3. **AUTO:** the operator **arms** AUTO by pressing Start; while armed, the motor runs whenever Remote_Run is
   ON. **Stop, the E-stop, an overload trip or leaving AUTO disarm it** — AUTO must be re-armed with Start.
   (This fixes the restart problem from 2-6.) Jog does nothing in AUTO.
4. **Everywhere:** Stop, E-stop and overload drop \`Motor_Starter\` at once; nothing ever restarts by itself.
5. **Lights:** \`Run_Light\` = contactor feedback (\`Motor_Aux\`); \`Ready_Light\` = healthy and stopped;
   \`Fault_Light\` = E-stop pushed or overload tripped.
6. **Horn:** \`Horn\` sounds while the **overload** is tripped (so maintenance comes running). Not for the E-stop.

Internal tags \`Hand_Run\` and \`Auto_Armed\` (BOOL) are created for you.`,
    objectives: [
      'OFF: nothing runs',
      'HAND: Start/Stop seal-in + Jog (never seals)',
      'AUTO: armed by Start, follows Remote_Run, disarmed by Stop / E-stop / overload / leaving AUTO',
      'No automatic restart, ever',
      'RUN / READY / FAULT lights and the overload horn',
    ],
    concepts: ['XIC', 'XIO', 'OTE'],
    starter: {
      rungs: [SAFE_SEAL, RUN_LIGHT, READY_LIGHT, FAULT_LIGHT],
      comments: ['Last week\'s program: safe start/stop', ...LIGHT_COMMENTS],
      tags: [
        { name: 'Hand_Run', dataType: 'BOOL', description: 'HAND mode run request (sealed by Start)' },
        { name: 'Auto_Armed', dataType: 'BOOL', description: 'AUTO mode armed by Start' },
      ],
    },
    solution: {
      rungs: [
        '[XIC(Start_PB),XIC(Hand_Run)]XIC(HOA_Hand)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Hand_Run);',
        '[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);',
        '[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
        RUN_LIGHT,
        READY_LIGHT,
        FAULT_LIGHT,
        'XIO(OL_OK)OTE(Horn);',
      ],
    },
    hints: [
      'Split it up: one rung per memory (`Hand_Run`, `Auto_Armed`), one rung for the output, one rung per light. Every memory needs the same interlocks as the motor so that a stop or fault clears it.',
      '`Hand_Run` is a seal-in through `HOA_Hand`; `Auto_Armed` is a seal-in through `HOA_Auto`. The motor rung ORs three legs: `Hand_Run`, HAND + Jog, and `Auto_Armed` + `Remote_Run` — then Stop / E-stop / overload in series.',
      'Motor: `[XIC(Hand_Run),XIC(HOA_Hand)XIC(Jog_PB),XIC(Auto_Armed)XIC(Remote_Run)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);` — Armed: `[XIC(Start_PB),XIC(Auto_Armed)]XIC(HOA_Auto)XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Auto_Armed);` — Hand_Run is the same with `HOA_Hand` — Horn: `XIO(OL_OK)OTE(Horn);`',
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
        name: 'OFF means off',
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
        name: 'HAND: start, lights, stop',
        steps: [
          set('hoa', HAND),
          wait(200),
          press('start'),
          wait(30),
          expectTag('Run_Light', false, 'Run_Light came ON before the contactor pulled in — drive it from Motor_Aux, not from the command'),
          release('start'),
          runs('HAND: Start must run the motor and seal in', 1000),
          lightIs('runLight', true, 'RUN must light while the motor runs'),
          lightIs('readyLight', false, 'READY must be OFF while the motor runs'),
          tap('stop'),
          stops('HAND: Stop must stop the motor', 500),
          lightIs('runLight', false, 'RUN must go OFF when the motor stops'),
          lightIs('readyLight', true, 'READY must return when the motor stops'),
          set('remote_run', true),
          staysOff('In HAND, Remote_Run must not start the motor — the filler only has a say in AUTO', 1000),
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
        name: 'HAND: Stop, E-stop and overload block Jog',
        steps: [
          set('hoa', HAND),
          wait(200),
          set('estop', true),
          wait(50),
          press('jog'),
          noCommand('Jog must not command the motor while the E-stop is pushed', 500),
          release('jog'),
          set('estop', false),
          wait(200),
          press('stop'),
          wait(50),
          press('jog'),
          noCommand('Stop must win over Jog', 500),
          release('jog'),
          release('stop'),
          wait(200),
          set('overload_trip', true),
          wait(50),
          press('jog'),
          noCommand('Jog must not command the motor while the overload is tripped', 500),
          release('jog'),
          set('overload_trip', false),
          tap('overload_reset'),
          staysOff('Nothing may start after the overload reset', 1000),
          press('jog'),
          runs('Jog must work again once everything is healthy'),
          release('jog'),
          stops('Releasing Jog must stop the motor'),
        ],
      },
      {
        name: 'HAND: E-stop, no restart',
        steps: [
          set('hoa', HAND),
          wait(200),
          tap('start'),
          runs('HAND: Start must run the motor'),
          wait(300),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter in HAND'),
          wait(200),
          set('estop', false),
          staysOff('DANGER: HAND restarted by itself after the E-stop was released — the E-stop must also clear Hand_Run', 1500),
          tap('start'),
          runs('HAND: Start must work again after the E-stop'),
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
        name: 'AUTO: Stop disarms',
        steps: [
          set('hoa', AUTO),
          wait(100),
          tap('start'),
          set('remote_run', true),
          runs('AUTO: armed + Remote_Run must run the motor'),
          wait(300),
          tap('stop'),
          stops('Stop must stop the motor in AUTO'),
          staysOff('After Stop the motor must stay off although Remote_Run is still ON — AUTO must be re-armed with Start', 2000),
          tap('start'),
          runs('Start must re-arm AUTO'),
        ],
      },
      {
        name: 'AUTO: E-stop disarms',
        steps: [
          set('hoa', AUTO),
          wait(100),
          tap('start'),
          set('remote_run', true),
          runs('AUTO: armed + Remote_Run must run the motor'),
          wait(300),
          set('estop', true),
          commandDrops('The E-stop must drop Motor_Starter'),
          lightIs('faultLight', true, 'FAULT must light while the E-stop is pushed'),
          lightIs('readyLight', false, 'READY must be OFF while the E-stop is pushed (not healthy)'),
          expectObs('horn', false, 'The horn is for overload trips only, not for the E-stop', { for: 300 }),
          set('estop', false),
          lightIs('faultLight', false, 'FAULT must go OFF when the E-stop is released'),
          staysOff('DANGER: the motor restarted by itself after the E-stop was released', 2000),
          tap('start'),
          runs('Start must re-arm AUTO after the E-stop'),
        ],
      },
      {
        name: 'AUTO: overload disarms',
        steps: [
          set('hoa', AUTO),
          wait(100),
          tap('start'),
          set('remote_run', true),
          runs('AUTO: armed + Remote_Run must run the motor'),
          wait(300),
          set('overload_trip', true),
          commandDrops('The overload trip must drop Motor_Starter in AUTO'),
          lightIs('horn', true, 'The horn must sound while the overload is tripped'),
          wait(200),
          set('overload_trip', false),
          tap('overload_reset'),
          expectObs('overloadTripped', false, 'The overload relay should reset', { within: 100 }),
          staysOff('DANGER: AUTO restarted by itself after the overload reset although Remote_Run is ON — the overload must disarm AUTO', 2000),
          tap('start'),
          runs('Start must re-arm AUTO after the overload reset'),
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
          press('jog'),
          noCommand('Jog works in HAND only', 500),
          release('jog'),
        ],
      },
    ],
    invariants: [STOP_WINS, ESTOP_DROPS, OVERLOAD_DROPS, OFF_MEANS_OFF],
    parInstructions: 34,
    allowedInstructions: MOTOR_BITS,
    debrief: `The customer's engineer signs the sheet. **Line 3 is commissioned** — and you wrote every rung.

You now know the building blocks of nearly every motor circuit in a plant: seal-in, interlocks in series
after the seal, feedback-driven indication, jog without sealing, mode selection, and the rule that nothing
restarts without a deliberate command.

**Field tip:** real commissioning follows a written **FAT/SAT** checklist (Factory / Site Acceptance Test),
exactly like the automated tests you just passed — every function, every fault, every mode, signed off
one line at a time.`,
  },
];
