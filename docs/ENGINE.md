# PLC World — Logix engine

Headless Logix 5000 controller runtime (`src/plc/**`) plus the simulation runtime that couples it with a
scene (`src/sim/runtime.ts`, `src/sim/project.ts`). No React/DOM/three imports: everything runs in vitest's
node environment and in the browser alike.

```
src/plc/
  types.ts, neutralText.ts   ★ shared contracts (not owned by the engine)
  catalog.ts        module catalog, module-defined I/O types, Local:x:I/O/C tags, point helpers
  convert.ts        Logix data conversions (round half to even, two's-complement wrap), literal parser
  tags.ts           TagDatabase: storage, types, operand resolution → cached accessors (OperandRef)
  expression.ts     CPT/CMP/subscript expression compiler
  instructions/     InstructionInfo metadata + executable definitions (one file per palette category)
  engine.ts         compiles routines to closure trees, runs them (power flow, JSR/RET/JMP/TND/MCR)
  verify.ts         static verification (Studio 5000 "Verify Controller")
  controller.ts     createController(): modes, key switch, scan, prescan, faults, forces, status, events
  errors.ts         TagError, PlcFault, fault code texts
  testUtils.ts      makeProject / runLogic / scanN helpers for tests
  index.ts          barrel
```

## Quick start

```ts
import { createController } from '@/plc/controller';
import { createProjectForScene } from '@/sim/project';
import { createSimRuntime } from '@/sim/runtime';

const plc = createController(createProjectForScene(scene, ['XIC(Start_PB)OTE(Motor_Starter);']));
if (!plc.requestMode('RUN')) console.log(plc.verify());   // key REM → REM_RUN (refused if it doesn't verify)
const rt = createSimRuntime(plc, scene);                    // 10 ms fixed step: scene.step → plc.scan
rt.step(1000);                                             // headless: exactly 1 s of simulated time
requestAnimationFrame(function loop(t) { rt.tick(16.7); requestAnimationFrame(loop); });
```

## Scan model

`scan(dtMs)` (never throws):

1. uptime += dt; recompile if the tag structure changed (tags defined/removed, constant flag changed).
2. Input forces (when enabled) are re-written into the input image (defence in depth: forces are masked into
   tag memory on every write anyway, see Forces).
3. If the controller is in RUN / REM_RUN:
   - on the first scan after entering Run: **prescan** (`status.firstScan` is true for this scan);
   - PERIODIC tasks whose period elapsed (by priority), then the CONTINUOUS task: every non-inhibited
     program in order, starting at its main routine.
   - **S:FS** is set while *each program* executes for the first time after entering Run (1756-RM003: "set
     during the first normal scan of the routines in the current program"). A program in a periodic task
     that first runs several continuous scans later still sees S:FS = 1 on its own first execution.
     Outside program execution, after leaving Run and after a major fault S:FS reads 0.
4. Output forces (when enabled) are re-written into the output tags (defence in depth).
5. Module status: output echo (`Local:2:I.Data`, `Local:4:I.Ch0Data`, `Local:2:I.Pt00.Data`…) mirrors what the
   module drives to the field; Compact 5000 `RunMode` follows the controller.

Timers accumulate from the simulated controller clock (`uptimeMs`), i.e. the sum of the `dtMs` passed to
`scan()`. Each TIMER has a hidden start timestamp, exactly like the free-running clock of a real controller.

### Power flow

- Every rung starts with rung-condition-in = true (false inside a disabled MCR zone).
- Series elements pass rung-condition-out to the next element; output instructions pass their
  rung-condition-in through, so inline outputs (`XIC(A)OTE(B)XIC(C)OTE(D)`) work as in Logix.
- A branch gives the same rung-condition-in to **every** leg and **executes every leg** (outputs on false
  legs are written false); its rung-condition-out is the OR of its legs. Nested branches are recursive.

### Prescan (entering Run)

Every scheduled program's main routine is prescanned; a JSR prescans its target once. Instructions apply
their manual-defined prescan behaviour, e.g. OTE cleared; OTL/OTU untouched; ONS/OSR storage bit set;
OSF storage cleared; TON reset (ACC = 0); TOF ACC = PRE; RTO EN/TT/DN cleared, ACC kept; CTU .CU / CTD .CD
set; BSL/BSR .EN .DN .ER cleared, .POS = 0; SQO/FFL .EN set; FFU .EU set. Faults are suppressed during
prescan. Routines not reachable through a JSR are not prescanned.

## Modes and key switch (1756-L8x / 5069-L3x)

| Action | Result |
|---|---|
| `createController(p)` | key REM, mode REM_PROG |
| `loadProject(p)` (download) | key REM → REM_PROG, key PROG → PROG; **key RUN → refused** (throws `Error('Cannot download to the controller: the key switch is in RUN…')`, nothing changes — the key is a physical switch and never moves by itself) |
| key → RUN / PROG | mode RUN / PROG (remote requests refused) |
| key RUN → REM / PROG → REM | REM_RUN / REM_PROG |
| `requestMode('RUN')` | only with key REM, not faulted, and **no verification errors** → REM_RUN |
| `requestMode('PROG')` | only with key REM → REM_PROG |
| major fault | FAULTED: logic stops, outputs off at the field, OK LED flashing red, display `Major Fault T04:C20`. The status is updated *before* the `fault` event (then a `mode` event), so a listener sees a consistent status and may call `clearMajorFault()` from it |
| `clearMajorFault()` | → REM_PROG (key REM) / PROG |
| key → PROG while faulted | clears the fault (as turning RUN→PROG does on the hardware) |

Tags keep their values in PROG; `readOutputForField()` returns false/0 unless the controller runs
(see forces below). Leaving Run de-energizes all live power-flow state.

## Tags and operands

- Names are case-insensitive (case preserved); program scope is searched before controller scope.
- Operand syntax: `Tag`, `Tag.Member`, `Arr[3]`, `Arr[Idx]`, `Arr[Idx+1]` (integer expression),
  `MyDint.5`, `MyDint.[Bit]` (indirect bit), `Local:1:I.Data.0`, `Local:3:I.Ch0Data`, `Local:1:I.Pt00.Data`, `S:FS`.
- Alias tags resolve recursively (cycle-safe, depth 16) with the rest of the path appended
  (`Status.3` where `Status` → `Local:1:I.Data` resolves to `Local:1:I.Data.3`).
- Bits: DINT .0–.31, INT .0–.15, SINT .0–.7; writing the sign bit yields a negative value.
- Structures: TIMER {PRE ACC EN TT DN}, COUNTER {PRE ACC CU CD DN OV UN}, CONTROL {LEN POS EN EU DN EM ER UL IN FD},
  module types (with `bitOf` members such as `Ch0Fault` = `ChannelFaults.0`) and UDTs from `project.dataTypes`.
- 1-D arrays only. A literal subscript out of range is a verification error; an indirect subscript out of
  range at run time raises **major fault T04:C20**.
- Conversions: REAL → integer rounds half to even (2.5 → 2, 3.5 → 4); too large for the destination →
  low-order bits kept (two's complement) + overflow (S:V, minor fault T04:C04). REAL is single precision.
- System operands (hidden from tag lists): `S:FS` (read-only), `S:N`, `S:Z`, `S:V`, `S:C`, `S:MINOR`.
- Performance: operands are compiled once into accessor closures that hold the storage containers directly
  (cache invalidated on define/remove). A 200-rung, ~1000-instruction program scans in ≈ 0.1 ms of real time.

## Instruction set

| Category | Instructions |
|---|---|
| Bit | XIC XIO OTE OTL OTU ONS OSR OSF |
| Timer/Counter | TON TOF RTO CTU CTD RES |
| Compare | EQU NEQ LES LEQ GRT GEQ LIM MEQ CMP |
| Compute/Math | ADD SUB MUL DIV MOD NEG ABS SQR CPT SCP |
| Move/Logical | MOV MVM CLR AND OR XOR NOT BTD COP FLL |
| Program Control | JSR SBR RET JMP LBL AFI NOP TND MCR |
| Special | BSL BSR SQO FFL FFU |

Semantics decisions (1756-RM003 based):

- **Timers**: the first enabled scan records the start time (ACC unchanged); later scans add the elapsed
  time (fractions carried). ACC stops at PRE. Negative PRE or ACC → major fault **T04:C34**. A
  self-resetting timer (`XIO(T.DN)TON(T,…)`) therefore has a period of PRE + 2 scans.
- **Instruction-box values** (TON/TOF/RTO/CTU/CTD Preset & Accum, BSL/BSR/SQO/FFL/FFU Length & Position)
  initialise the structure members: all of them on download (`loadProject`, `resetTagValues`). After that
  only PRE/LEN are written, and only for instructions that are **new to their tag**: a box literal that was
  edited online, a rung that compiles for the first time (e.g. TON typed before its TIMER tag existed) or a
  tag whose storage was re-created (deleted and created again). Unchanged instructions never overwrite a
  value written by logic or an HMI — creating/deleting unrelated tags or editing other rungs leaves `T.PRE`
  alone, as on a real controller. `?` keeps the tag value (L5X style `TON(T,?,?)`).
- **Counters**: count on false→true transitions (.CU/.CD edge memory). Overflow past 2,147,483,647 wraps to
  -2,147,483,648 and sets .OV — unless .UN was set, which is cleared instead (and symmetrically for CTD).
  .DN = ACC ≥ PRE, evaluated when the rung is true. RES clears ACC/OV/UN/DN (not CU/CD).
- **One-shots**: ONS is an input instruction (interrupts the rung); OSR/OSF are outputs with an output bit.
- **Compare/Math** "optimal data type": REAL math if any source *or the destination* is REAL, otherwise
  DINT math (SINT/INT sign-extended). Integer DIV truncates; results stored to an integer from REAL math
  round half to even. Divide by zero: minor fault T04:C04, integer Dest = Source A, REAL Dest = ±∞/NaN.
  S:N/S:Z/S:V are updated by math, move and logical instructions; overflow logs minor fault T04:C04.
- **CPT/CMP expressions**: `+ - * / MOD **`, `AND OR XOR NOT` (bitwise, `&` accepted), `= <> < <= > >=`,
  `ABS SQR/SQRT SIN COS TAN ASN ACS ATN LN LOG DEG RAD TRN FRD TOD`, literals `123 -4.5 1.5e3 16#FF 2#1010_1010 8#17`.
  Precedence (high→low, 1756-RM003 CPT/CMP order of operation): `**`, unary `- NOT`, `* / MOD`, `+ -`,
  relational `= <> < <= > >=` (one level), `AND`, `XOR`, `OR`. Operations of equal order are evaluated
  **left to right**, `**` included: `2**3**2` = 64. (Structured Text uses a different table where `= <>`
  sit below the other relational operators; ST is not emulated.)
- **COP** copies Length *destination* elements; same types copy element-wise (structures whole), different
  numeric types copy raw little-endian bytes (REAL 1.0 → DINT 1065353216). Stops at the end of either array.
  **FLL** converts the source value to the destination element type.
- **JSR/SBR/RET**: `JSR(Routine)`, `JSR(Routine,0)` and `JSR(Routine,n,in…,ret…)` with SBR/RET parameters.
  Nesting deeper than 32 → **T04:C84** (stack overflow); parameter mismatch → **T04:C31**. A routine that is
  not called keeps its outputs in their last state.
- **JMP/LBL**: the rung containing the JMP completes, then execution continues at the rung whose first
  instruction is the LBL. Skipped rungs are shown de-energized. Endless loops trip the task watchdog
  (**T06:C01**, 500 ms simulated or 200 000 rung executions per scan).
- **MCR**: instructions toggle the zone; while the zone-start rung is false every rung in the zone gets
  rung-condition-in false.
- **TND** acts as the end of the current routine (like RET without parameters): in a subroutine control
  returns to the calling JSR (the calling rung finishes, the caller continues); in a main routine the
  program's scan ends and the **next program** of the task runs.
- **Program-control signals are per routine**: a JMP/RET/TND earlier on a rung that also calls JSR stays
  pending for the caller; the subroutine runs normally (`JMP(Skip)JSR(Sub,0)` runs all of Sub, then jumps).
- **SQO**: on each false→true transition .POS + 1, wrapping from LEN back to **1** (position 0 is the
  post-RES home step); Dest = (Dest AND NOT Mask) OR (Array[POS] AND Mask); .DN when POS = LEN;
  LEN ≤ 0 or POS < 0 sets .ER. **BSL/BSR** shift LEN bits of a DINT array across word boundaries, unload
  to .UL, set .DN; LEN beyond the array → T04:C20, negative → T04:C21. **FFL/FFU** share a CONTROL
  (.EN / .EU edges); .DN = full, .EM = empty; unloading an empty FIFO leaves Dest unchanged.

## Faults

| Fault | Kind | Cause |
|---|---|---|
| T04:C04 | minor | arithmetic overflow / divide by zero (S:V, S:MINOR set; execution continues) |
| T04:C16 | major | internal simulator error (should never happen) |
| T04:C20 | major | array subscript / bit subscript out of range, CONTROL LEN beyond array |
| T04:C21 | major | CONTROL LEN or POS < 0 (BSL/BSR/FFL/FFU) |
| T04:C31 | major | JSR/SBR/RET parameter mismatch, JSR to a routine that does not exist |
| T04:C34 | major | timer with negative PRE or ACC |
| T04:C42 | major | JMP to a label that does not exist |
| T04:C84 | major | JSR nesting too deep (stack overflow) |
| T06:C01 | major | task watchdog expired (endless JMP loop) |

A `FaultRecord` carries program, routine, rung index and element id of the faulting instruction. Minor
faults are kept in `status.minorFaults` (16 newest, repeats of the same location refreshed). Major faults
and new minor faults are emitted as `{ type: 'fault' }` events.

## Forces

- Only fixed addresses of module I/O data (`Local:x:I…`, `Local:x:O…`) and aliases pointing to it can be
  forced; other operands and indirect addresses (`Local:1:I.Data.[Idx]`) throw an `Error`. Force keys are
  canonical paths (`getForces()` → `{'Local:1:I.Data.1': true}`); `getForce(operand, program?)` looks a force
  up by the operand text (alias or path) — an optional, additive contract method.
- **Forces act on tag memory**: while forces are enabled the tag database masks every write to a forced
  bit/value (by logic, the field or the UI), so every instruction sees the forced value whatever the rung
  order — e.g. `XIC(Local:2:O.Data.0)` after an `OTE` of that forced bit, or after `MOV(0,Local:2:O.Data)`.
  Other bits of the same word stay writable.
- Input forces: field values arriving while forced are remembered and restored when the force is
  removed/disabled. Output forces are also returned by `readOutputForField()` in every mode.
- FORCE LED: off (none), flashing amber (installed, disabled), amber (enabled).

## Verification (`verify()`)

Errors (Run is refused): unknown instruction · wrong operand count · `?` operand · undefined tag / member /
routine / label · out-of-range literal subscript or bit · "Invalid data type. Argument must match parameter
data type." · "Invalid kind of operand or argument i.e. tag, literal, or expression." (literal destination) ·
constant destination · "Rung must end with an output instruction." / "Every branch leg at the end of a rung
must end with an output instruction." · LBL not first on its rung · duplicate LBL · SBR not first in the
routine · invalid expression · project-level problems (bad tag definitions, broken aliases, missing main
routine, task referencing a missing program) with `rungIndex: -1`. Tag problems (invalid name, unknown data
type, duplicate name in a scope, `system: true` in the project, alias that does not resolve) are re-evaluated
on every `verify()` call, so fixing a tag online (create the alias target, delete the broken alias, redefine
the tag) clears the error and Run is allowed again. Changing a tag's `constant` flag online recompiles the
logic, so what verifies is what runs.

Warnings: duplicate destructive bit reference (two OTEs writing the same resolved bit of the same tag,
aliases included; same-named program-scoped tags of different programs are different tags) ·
shorted branch (empty branch leg).

Messages are prefixed `MNEMONIC, Operand n:`; `formatVerifyError()` renders
`Error: MainProgram - MainRoutine, Rung 3, TON, Operand 0: Invalid data type…`. Empty rungs are allowed.

## Status

`getStatus()`: mode, key, LEDs (OK green / flashing red, RUN green, FORCE, I/O green when any I/O module is
configured, off otherwise), `displayText` (`RUN`, `PROG`, `Major Fault T04:C20`), fault records, scan count,
simulated scan time = (0.15 ms + Σ instruction costs) × platform factor (5069-L3x ×1.6) + deterministic
jitter ≤ 8 µs, max scan, uptime, forces, `firstScan`.

## Live state (ladder animation)

`getLiveState(program, routine)` returns a persistent `RoutineLiveState` whose objects are mutated in place
every scan (no allocation). Per element: `in` (rung-condition-in), `out`, `active` (Studio 5000 highlight:
XIC bit = 1, XIO bit = 0, OTE/OTL bit = 1, OTU bit = 0, compares = result, box instructions = rung-condition-in;
branches = OR of legs). When the controller is not running the call refreshes `active` from tag data
(online monitoring in Program mode) with `in`/`out` false.

## Simulation runtime

`createSimRuntime(controller, scene, { stepMs = 10, maxCatchUpSteps = 25, notifyIntervalMs = 33, now })`:
each fixed step runs `scene.step(state, 10, io)` then `controller.scan(10)`. `step(ms)` advances exactly
(remainder carried), `tick(realMs)` scales by `speed`, honours `paused` and drops backlog beyond 25 steps.
`subscribe()` is throttled to ~30 Hz (user controls, controller events and changes of `paused`/`speed`
notify immediately; a paused or zero-speed `tick()` still flushes a throttled notification). Non-finite or
non-positive `step()`/`tick()` times are ignored; `speed` ignores non-finite or negative values.
`onControl((id, value) => …)` reports every `setControl()` (pad, hotkeys, 3D clicks, test steps) unthrottled,
after the plant has taken the value — the workspace uses it for the `controlUsed` game event.
**Momentary edge latch**: a momentary control released before any fixed step ran since its press stays pressed
for the next step (the PLC sees at least one scan of every tap, even when press and release land between two
slow animation frames); the release — and its `onControl` report — is applied right after that step.
`useSimLoop` advances at most 250 ms per frame (= the default catch-up), so the plant keeps real time down to ~4 fps.
`dispose()` stops forwarding controller events and drops listeners.
`resetScene({ resetTags })` recreates the plant state *in place* (views keep their reference).
`IoAccess` maps to `readOutputForField` / `writeInputFromField`.

`createProjectForScene(scene, rungs?, { comments, tags })`: controller `PLC_World`, the scene hardware, an alias
tag per I/O point (BOOL/REAL, description = device), `scene.extraTags`, MainTask (CONTINUOUS) › MainProgram ›
MainRoutine (one empty rung when no rungs are given). `cloneProject()`, `withRoutineRungs()`.

## Known deviations from real Logix

- Only RLL routines, 1-D arrays, no LINT/STRING, no Add-On Instructions, no SFC/ST/FBD, no event tasks.
- Rungs with verification errors are skipped when the controller is forced to Run with the key switch
  (a real controller could never have downloaded them). A JSR to a missing routine / JMP to a missing label
  fault at run time (T04:C31 / T04:C42).
- JMP completes the current rung before jumping (so does RET/TND).
- I/O is updated synchronously once per scan (no RPI / asynchronous I/O, no COS); module configuration
  tags (`Local:x:C`) are informational — program/fault mode output states are not emulated (outputs are off
  when not running).
- Forced outputs are driven in every mode (the real force table is also independent of the mode); a forced
  bit inside a word is not reflected in a whole-word `readOutputForField()` while in Program mode.
- `writeValue()` of a whole structure/array is re-masked right after the write, but COP/FLL/BSL/BSR/FFL/FFU
  copying structures or array elements in place are not masked mid-scan (module I/O data has no forceable
  arrays, and input/output forces are re-applied before and after logic).
- Forcing is restricted to local I/O data; produced/consumed tags do not exist.
- Divide-by-zero results, REAL→integer conversion of ±∞/NaN (0 + overflow) and FFU on an empty FIFO
  (Dest unchanged) follow the most common documented behaviour where the manual is ambiguous.
- REAL math uses JavaScript doubles rounded to single precision after each operation (results can differ
  from the controller's FPU in the last bit for chained expressions).
- S:C (carry) is never set. Minor faults are always logged (no "minor fault bits" configuration).
- Status display shows only the mode or the major fault id (no project name / IP / link messages).
- Simulated scan time is a model (base + per-instruction cost), not a measurement.
