# PLC World — curriculum & mission authoring guide

The campaign turns a newcomer into someone who can read, write and troubleshoot real Logix 5000 ladder
logic. The player is **the new controls tech at Riverside Manufacturing**; Dana (senior controls tech) is the
mentor, Gus runs maintenance, customers and night-shift operators show up with problems. Every mission is a
small, believable job on one of the six training plants (docs/SCENES.md).

Code map (all headless, no React except `store.ts`):

| File | What |
|---|---|
| `src/game/types.ts` | ★ contracts: `MissionDef`, `TestStep`, `MissionInvariant`, `PlayerProfile`… |
| `src/game/chapters.ts` | `CHAPTERS` (ids, colours, lucide icons) |
| `src/game/missions/chN.ts` | `CHN_MISSIONS: MissionDef[]` — one file per chapter |
| `src/game/missions/chN.wrong.ts` | test-only wrong answers (`CHN_WRONG`) and alternative right answers (`CHN_RIGHT`) |
| `src/game/missions/authoring.ts` | step builders (`wait`, `set`, `tap`, `press`, `release`, `mode`, `expectObs`, `expectTag`…) |
| `src/game/missions/index.ts` | `MISSIONS`, `getMission`, `missionsByChapter`, `nextMission`, `chapterBoss` |
| `src/game/validation.ts` | `runMission`, `runMissionTest`, `createMissionTestRunner`, `buildMissionProject`, `lintMission`… |
| `src/game/ranks.ts`, `achievements.ts`, `store.ts` | levels, achievements, persisted player progress (`useGame`) |
| `src/game/missions.test.ts` | the generic suite every mission must pass |

---

## 1. Campaign overview

| # | Chapter id | Title | Plant(s) | Learning goals |
|---|---|---|---|---|
| 1 | `power-up` | Power Up | `trainer` | Scan cycle, alias tags & I/O addresses, XIC / XIO / OTE, series = AND, parallel = OR, one OTE per output (duplicate destructive bit), **N.C. devices read 1 at rest**, XOR from contacts, lamp test |
| 2 | `motor-control` | Motor Control | `motor-station` | 3-wire seal-in, Stop wins, feedback vs command (aux contact), E-stop / overload interlocks that break the seal, **no automatic restart**, OTL/OTU and the prescan/`S:FS` trap, jog without sealing, Hand-Off-Auto, commissioning against a spec |
| 3 | `timing` | Timing Is Everything | `trainer`, `motor-station`, `traffic-light` | TON / TOF / RTO, `.EN .TT .DN .ACC .PRE`, RES on RTO, self-resetting pulse timers (period = PRE + 2 scans), flashers, start-up warning horn, fail-to-start alarm, timed sequences, a full intersection with pedestrian call (no conflicts!) |
| 4 | `counting` | Counting & Tracking | `conveyor-sort`, `parking-garage` | CTU / CTD / RES, `.DN .ACC .PRE .OV`, one-shots (ONS / OSR / OSF) and why an edge matters at a 10 ms scan, batch counting, up/down occupancy (garage full sign), counter-based sorting |
| 5 | `analog` | Analog & Math | `trainer` (pots/meters), `tank-process` | REAL tags, compares (GRT/LES/LIM/…), MOV / ADD / SUB / MUL / DIV / CPT, scaling with SCP (0–100 % ↔ engineering units), deadband & **hysteresis** so valves/heaters don't chatter, alarm limits, transmitter failure (`lt_fail`) |
| 6 | `sequencing` | Sequencing | `tank-process`, `traffic-light`, `conveyor-sort` | Step numbers & state machines (EQU on a step DINT), transitions with conditions & timers, SQO output sequencer, BSL shift register for part tracking (reject the tall box at the pusher) |
| 7 | `troubleshooting` | Troubleshooting | all | Read someone else's program, find the bug (N.C. confusion, duplicate OTE, missing seal break, wrong timer type, counter without one-shot, bad compare), forces thinking (what a force hides), failed sensors (`pe_infeed_fail`, `lsh_fail`, `lt_fail`), fault codes (T04:C20…) |

Each chapter has ~5–8 missions; the **last one is the boss** (`kind: 'boss'`, difficulty 4–5), which
combines everything in the chapter into a realistic spec. Chapter 7 missions use `kind: 'troubleshoot'`
(the starter program is the broken plant program; the player fixes it).

Mission ids are `<chapter order>-<order>` (`'3-1'`, `'3-2'`, …) and `chapter` is the chapter **id**
(`'timing'`). Orders are contiguous from 1. The generic suite enforces all of this.

### Progress rules (store)

- **Stars**: 1 = all tests pass · 2 = and `instructionCount <= parInstructions` (or no par) · 3 = and no
  hint revealed. Instructions are counted in MainRoutine; branches don't count.
- **XP**: first clear = `mission.xp`; each star above the first = +25 % of `mission.xp` (max 150 %). Only
  improvements pay, so replaying can't farm XP. Achievements add their own XP.
- **Unlocks**: missions unlock in order inside a chapter (or via `requires`). Chapter N+1 opens when
  chapter N's boss is beaten **or ≥ 70 %** of its missions are done. Completed missions never re-lock.
- Suggested XP: difficulty 1 → 50–70, 2 → 80–110, 3 → 120–160, 4 → 170–220, boss → 250–400 (later
  chapters a bit more). Ranks: level n needs `round(120·(n−1)^1.6)` XP; the whole campaign at three stars
  should land around level 20 (Master of Automation).

---

## 2. Writing a mission

```ts
// src/game/missions/ch3.ts
import type { MissionDef } from '../types';
import { expectObs, expectTag, press, release, set, tap, wait } from './authoring';

export const CH3_MISSIONS: MissionDef[] = [
  {
    id: '3-1', chapter: 'timing', order: 1,
    title: 'Warning Horn', tagline: 'Sound the horn before the conveyor moves.',
    kind: 'build', sceneId: 'motor-station', difficulty: 2, xp: 110,
    briefing: `…story… **The hardware** … **Your task** …`,
    objectives: ['…', '…'],
    objectiveTests: [[0, 1], [{ test: 2, observe: ['horn'] }, { invariant: 0 }]], // what proves each objective
    concepts: ['TON'],
    starter: { rungs: ['…'], comments: ['…'], tags: [{ name: 'Horn_Timer', dataType: 'TIMER' }] },
    solution: { rungs: ['…'] },
    hints: ['nudge', 'approach', 'nearly the answer'],
    tests: [ /* see below */ ],
    invariants: [ /* safety */ ],
    parInstructions: 9,
    debrief: `…what they learned… **Field tip:** …`,
  },
];
```

### Content checklist

- **Briefing** (markdown): 1–2 lines of story, then **The hardware** — every device the mission uses with
  its alias, address and **N.O. / N.C.** wiring spelled out ("**N.C.**: 1 when NOT pressed") — then **Your
  task** as a short spec. Say explicitly what is *not* tested when behaviour could be ambiguous
  ("What Jog does while running is up to you").
- **Objectives**: the checklist shown in the HUD; one line per tested behaviour.
- **objectiveTests**: one proof list per objective (`src/game/objectives.ts`): a test index (the whole test),
  `{ test, steps?, from?, to?, observe? }` (only those expect steps — for a test that checks several
  objectives) or `{ invariant }`. The checklist ticks an objective when all its proofs hold, crosses it when
  one is broken and leaves it open when the test stopped before reaching its steps; an invariant trip is
  charged to the objectives that list the invariant. `lintObjectives()` requires every expect step and every
  invariant to prove some objective; the suite checks that the solution ticks all objectives and every wrong
  answer crosses at least one. Objectives are never paired with tests by position.
- **Concepts**: instruction mnemonics (they link to the reference page).
- **Hints**: ≥ 3, progressive — a nudge, then the approach, then (last) essentially the rungs.
- **Debrief**: what they just learned + a **Field tip** from real plants (why Stop buttons are N.C., why
  E-stops stay hardwired, scan-cycle effects, one-shots, retentive data, FAT/SAT…). Correct Rockwell
  terminology: *rung*, *XIC/XIO*, *seal-in*, *prescan*, *major fault T04:C20*, *1756-IB16*, *Studio 5000*.
- **Solution**: idiomatic ladder a real tech would write (seal-ins, interlocks after the branch, one OTE per
  output). It must pass all tests and meet par.
- **Starter**: something that runs but fails (a naive rung, last mission's program, empty commented rungs, or
  — for troubleshoot missions — the broken program). It must fail at least one test.
- **Tags**: tags listed in `starter.tags` **and** `solution.tags` are created in the player's project
  (`buildMissionProject` merges scene aliases + scene extra tags + starter tags + solution tags + player
  tags). Name internal tags in the briefing so the player can use them. Box literals initialise the tag on
  download: `TON(T,5000,0)` sets `T.PRE = 5000` — use `?` to keep the tag's own value.
- **Palette**: `allowedInstructions` restricts what may be used (violations are verification errors);
  `requiredInstructions` forces the lesson's instruction (e.g. `['OTL','OTU']`, `['ONS']`).

---

## 3. Tests: how validation runs

For every test: a **fresh controller** (download of the player's project) and a **fresh plant**, key in REM,
`requestMode('RUN')` (refused → the test fails; verification errors mean no test runs and 0 stars), then the
steps run in **10 ms fixed steps**: `scene.step()` (field ↔ I/O image) then one controller scan. After every
step the runner checks the **invariants** and that the controller has **not major-faulted**.

| Step | Meaning |
|---|---|
| `{ do: 'wait', ms }` | simulate `ms` (rounded to 10 ms) |
| `{ do: 'control', id, value }` | set a scene control (switch, selector index, analog value, fault) — holds until changed |
| `{ do: 'tap', id, ms? }` | press a momentary control for `ms` (default **200**) and release it |
| `{ do: 'mode', mode: 'PROG' \| 'RUN' }` | remote mode change. PROG: logic stops, outputs off, tags keep values. RUN: prescan + first scan (S:FS) |
| `{ do: 'expect', observe \| tag, equals \| min \| max, within?, for?, message }` | check a value (below) |

`expect`:
- `observe` reads a scene observable (what the plant *physically* does); `tag` reads a controller tag, member
  or bit (`Motor_Starter`, `T1.ACC`, `N.3`, `Count.DN`). A missing tag fails the test with "Tag 'X' does not
  exist in your project"; a structure (TIMER) must be tested through a member.
- `equals` (booleans accept 0/1; numbers compared with a 1e-6 relative tolerance), `min` / `max` inclusive.
- no timing: instant check · `within: N`: poll every 10 ms for up to N ms · `for: N`: then the condition must
  hold continuously for N ms · both: settle, then hold.
- The `message` is shown to the player, followed by the actual value: write it as the requirement ("Stop
  must drop the motor"), optionally with a hint ("— add a seal-in contact").

### Timing model (important!)

- A control set between steps reaches the **input image at the next step**, and that same step's scan
  reacts: tags change **10 ms** after a control.
- The plant reads outputs **before** the scan, so **observables lag tags by one more step** (20 ms after a
  control). Use `within` (≥ 50 ms is plenty for logic, more for physics) instead of exact timing.
- A tap of 200 ms means the next step starts 200 ms later with the button released.
- Counters don't count on the first scan after entering Run (prescan sets `.CU/.CD`): wait ≥ 50 ms before
  the first count edge. A self-resetting `XIO(T.DN)TON(T,100,0)` fires every PRE + 2 scans (120 ms).
- Scene physics has its own delays — read the scene's `logic.ts`. Motor station: `Motor_Aux` pulls in 40 ms
  after the coil and drops 25 ms after; the motor coasts down for > 4 s, so check stops with `contactor`,
  not `motorRunning`. Overload resets need the cause gone and ≈ 2.25 s of cooling after a jam.

### Invariants

`invariants: [{ observe | tag, equals | min | max, message, when?, graceMs? }]` are checked after **every**
step of **every** test — ideal for safety properties that must hold whatever the test does:

```ts
{ observe: 'conflict', equals: false, message: 'Conflicting greens: somebody just crashed' }
{ observe: 'spills', max: 0, message: 'The tank overflowed' }
{ when: { control: 'estop', equals: true }, tag: 'Motor_Starter', equals: false, graceMs: 20,
  message: 'Motor_Starter must be OFF while the E-stop is pushed' }
```

- `when` (observe / tag / **control**) makes it conditional.
- `graceMs` tolerates short violations: the invariant fails only if violated for **longer** than `graceMs`
  (each step counts 10 ms). Use `graceMs: 20` for "the PLC must react" rules so a correct program that
  reacts one scan later through an internal bit still passes. An **observable** gated by a **control**
  always lags one step: give it `graceMs: 10` or check the tag instead.
- Tag invariants also run while the controller is in PROG (tags keep their values there).

### Making tests airtight (pass every reasonable correct program, fail plausible wrong ones)

1. **One test per objective**, named like the objective. Walk truth tables completely; toggle back and forth
   (catches OTL instead of OTE, missing drop-out).
2. **Negative checks need a hold**: `expectObs('readyLight', false, …, { within: 150, for: 200 })`. An instant
   "is OFF" right after an event can pass just because the plant hasn't reacted *yet*.
3. After a release / reset, check it **stays** off for a while (`for: 1500`) — that's what catches missing seal
   breaks and automatic restarts.
4. Test both orders of simultaneous inputs (Start+Stop → Stop wins) and the "unrelated input" case (other
   switches must not affect the output).
5. Put safety rules in **invariants** so every test enforces them.
6. Distinguish *command* from *feedback* when it matters (e.g. `Run_Light` must come from `Motor_Aux`: check
   the tag 30 ms after Start, before the contactor could have pulled in).
7. Don't over-constrain: accept one-scan delays (`within`), don't test unspecified behaviour, allow any rung
   order/branch arrangement that behaves correctly. Prove it with `*_RIGHT` alternatives (below).
8. Keep each test short (a few simulated seconds; the suite caps a test at 240 s; a whole mission should
   validate in well under a second of real time).

### Wrong answers & alternative right answers (test-only)

Next to `chN.ts`, create `chN.wrong.ts` (never imported by the app):

```ts
import type { WrongAnswerSet } from './authoring';

export const CH3_WRONG: WrongAnswerSet = {
  '3-1': [
    { rungs: ['XIC(Start_PB)TOF(Horn_Timer,3000,0);', '…'], why: 'TOF instead of TON' },
    ['XIC(Start_PB)OTE(Horn);'],                    // plain rung arrays are fine too
  ],
};

export const CH3_RIGHT: WrongAnswerSet = {
  '3-1': [{ rungs: ['…another correct program…'], tags: [{ name: 'X', dataType: 'BOOL' }], why: 'rungs reordered' }],
};
```

The generic suite discovers every `*.wrong.ts` automatically. Exports whose name ends in **`RIGHT`** must
**pass** every test (palette enforced); every other exported set holds **wrong** programs that must
**verify** and **fail at least one test** (palette not enforced, so the *tests* must catch the mistake).
Write several per mission: missing seal-in, XIO on an N.C. stop, wrong timer type, off-by-one counts,
missing one-shot, duplicate OTE, conflicts, interlock on the wrong branch…

### Running

```
npx vitest run src/game                       # everything
npx vitest run src/game/missions.test.ts -t "3-2"   # one mission
npx tsc --noEmit -p tsconfig.json
```

The generic suite checks: unique ids / orders / one boss last · scene exists · content complete (briefing,
objectives, ≥ 3 hints, debrief) · `lintMission()` (every control, observable and tag referenced exists;
selector indexes and value types; expects have conditions) · solution verifies, respects the palette,
meets par, passes all tests with 3 stars, deterministically · starter fails · wrong answers fail · right
answers pass · `lintObjectives()` (objective → test map complete; solution ticks all, each wrong answer
crosses one).

---

## 4. API for the UI

```ts
import { runMission, runMissionTest, createMissionTestRunner, buildMissionProject, starCriteria } from '@/game/validation';

const project = buildMissionProject(mission, rungs, comments, savedTags);   // or pass rungs / a Project
const result = runMission(mission, project, { hintsUsed });                 // MissionRunResult
const t = runMissionTest(mission, project, i);                              // one test (incremental progress)
const runner = createMissionTestRunner(mission, project, i);                // "watch the test" mode:
//   runner.runtime / runner.runtime.state → render the scene view;  each frame: runner.advance(dtMs * speed)
//   runner.stepIndex, runner.done, runner.result;  runner.dispose()
```

Store (`useGame`): `startMission(id)` when a mission opens · `useHint(id)` / `revealHint(id)` → index of the
revealed hint (−1 when none left) · `saveProgram(id, rungs, comments, tags)` · `completeMission(id, result,
durationMs)` after every full test run (failed runs are counted, passed runs return `{ xpGained,
previousLevel, newLevel, newAchievements, improved, stars, … }`) · `recordEvent(e)` for game events
(`forceUsed`, `majorFaultCleared`, `sandboxTime {ms}`, `toggleBitUsed`, `rungEdited`, `neutralTextUsed`,
`controlUsed {sceneId, controlId}`, `showroomVisited`, `referenceViewed`, `testRunFailed`…) ·
`isUnlocked(id)`, `isChapterUnlocked(id)` · `setSettings`, `setName`, `resetProgress` · `consumeUnlocks()`
for achievement toasts. Pure selectors: `totalStars(profile)`, `chapterProgress(profile, chapterId)`,
`levelForXp(xp)` (ranks.ts), `ACHIEVEMENTS` (achievements.ts).
