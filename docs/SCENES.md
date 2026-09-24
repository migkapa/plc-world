# Training plants (scenes) — specification

Each scene is a virtual machine wired to the simulated controller. Scene **logic** lives in
`src/sim/scenes/<id>/logic.ts` (pure TS, implements `SceneLogic<S>` from `src/sim/types.ts`) and the
3D **view** in `src/sim/scenes/<id>/View.tsx`. Registries:

- `src/sim/scenes/index.ts` → `SCENE_LOGICS: Record<string, SceneLogic<any>>` (headless, NO React/three imports)
- `src/sim/scenes/views.tsx` → `SCENES: Record<string, SceneDefinition<any>>` (logic + View + cameras)

The ids, aliases, operands, control ids and observable ids below are a **contract** used by the
missions (`src/game/missions/**`) and their automated tests. Do not rename them.

General rules

- Fixed step: `step(state, dtMs, io)` is called every 10 ms of simulated time *before* each PLC scan.
  Read outputs with `io.readBool/readNumber` (they read 0 when the controller is not running) and write
  every input every step with `io.writeBool/writeNumber`.
- Determinism: any randomness uses a seeded PRNG stored in the state (e.g. mulberry32). Same control
  sequence ⇒ same result.
- N.C. (normally-closed) devices produce **1 when NOT actuated**. This is intentional and a core
  teaching point (Stop buttons, E-stops, overload contacts).
- Photo-eyes are "dark operate" style: input = 1 while an object blocks the beam.
- Counter-type observables (e.g. `boxesGood`) only ever increase until `createState()`/reset.
- Physical interlocks that exist in real hardwired circuits are simulated (e.g. an E-stop drops out a
  contactor even if the PLC output is on).

---

## 1. `trainer` — PLC Trainer Bench (ControlLogix)

Classroom training bench: toggle switches, push buttons, pilot lights, two potentiometers and two
analog meters. Used by the first chapter and as the default sandbox.

Hardware: `ControlLogix`, chassis `1756-A7`, PS `1756-PA72`
slot 0 `1756-L85E`, slot 1 `1756-IB16` (DI_Bench), slot 2 `1756-OB16E` (DO_Bench),
slot 3 `1756-IF8` (AI_Bench), slot 4 `1756-OF8` (AO_Bench), slot 5 `1756-EN2T`.

| Operand | Alias | Dir | Device |
|---|---|---|---|
| Local:1:I.Data.0 … .7 | `Switch_0` … `Switch_7` | in | 2-position toggle switches (maintained, 1 = up/ON) |
| Local:1:I.Data.8 | `PB_Green` | in | green flush PB, N.O. |
| Local:1:I.Data.9 | `PB_Red` | in | red extended PB, **N.C.** (1 when not pressed) |
| Local:1:I.Data.10 | `PB_Black_1` | in | black flush PB, N.O. |
| Local:1:I.Data.11 | `PB_Black_2` | in | black flush PB, N.O. |
| Local:2:O.Data.0 … .7 | `Light_0` … `Light_7` | out | pilot lights: 0–1 green, 2–3 amber, 4–5 red, 6–7 blue |
| Local:2:O.Data.8 | `Buzzer` | out | panel buzzer |
| Local:3:I.Ch0Data | `Pot_1` | in (analog, REAL) | potentiometer 0–100 % |
| Local:3:I.Ch1Data | `Pot_2` | in (analog, REAL) | potentiometer 0–100 % |
| Local:4:O.Ch0Data | `Meter_1` | out (analog, REAL) | analog panel meter 0–100 % |
| Local:4:O.Ch1Data | `Meter_2` | out (analog, REAL) | LED bar-graph 0–100 % |

Controls: `sw0`…`sw7` (maintained, default false), `pb_green`, `pb_black1`, `pb_black2` (momentary),
`pb_red` (momentary; pressing it makes `PB_Red` read 0), `pot1`, `pot2` (analog 0–100, default 0).

Observables: `light0`…`light7` (bool), `buzzer` (bool), `meter1`, `meter2` (number, clamped 0–100 as the
meter would physically show), `buzzerOnMs` (number, total ms buzzer has been on).

---

## 2. `motor-station` — Motor Control Station (ControlLogix)

A 5 HP conveyor drive motor started through a `100-C09` contactor with a `193-E` overload relay,
operated from an 800F push-button station. Classic start/stop seal-in territory.

Hardware: `ControlLogix`, `1756-A7`, `1756-PA72`: slot 0 `1756-L85E`, slot 1 `1756-IB16`,
slot 2 `1756-OB16E`, slot 3 `1756-EN2T`.

| Operand | Alias | Dir | Device |
|---|---|---|---|
| Local:1:I.Data.0 | `Start_PB` | in | 800F green flush PB, N.O. |
| Local:1:I.Data.1 | `Stop_PB` | in | 800F red extended PB, **N.C.** |
| Local:1:I.Data.2 | `EStop_OK` | in | 800FM mushroom E-stop, **N.C.** (1 = released/healthy) |
| Local:1:I.Data.3 | `Jog_PB` | in | 800F black flush PB, N.O. |
| Local:1:I.Data.4 | `OL_OK` | in | overload relay 95-96 contact, **N.C.** (1 = healthy, 0 = tripped) |
| Local:1:I.Data.5 | `Motor_Aux` | in | contactor auxiliary contact N.O. (1 = contactor pulled in) |
| Local:1:I.Data.6 | `HOA_Hand` | in | 3-pos selector HAND position contact |
| Local:1:I.Data.7 | `HOA_Auto` | in | 3-pos selector AUTO position contact |
| Local:1:I.Data.8 | `Remote_Run` | in | run request from the upstream line (auto mode) |
| Local:2:O.Data.0 | `Motor_Starter` | out | contactor coil M |
| Local:2:O.Data.1 | `Run_Light` | out | green pilot light |
| Local:2:O.Data.2 | `Fault_Light` | out | red pilot light |
| Local:2:O.Data.3 | `Horn` | out | warning horn |
| Local:2:O.Data.4 | `Ready_Light` | out | white pilot light |

Physics
- Hardwired interlock: contactor coil energized = `Motor_Starter` output AND E-stop released AND
  overload not tripped. `Motor_Aux` follows the coil with a 40 ms pull-in / 25 ms drop-out delay.
- Motor speed: first-order ramp to 1750 rpm (τ ≈ 0.6 s) when the contactor is closed, coast-down τ ≈ 1.5 s.
- `jam` fault: the motor stalls (rpm → 150, current high); after 3 s of stalled running the overload
  trips (tripped until the `overload_reset` control is tapped).
- Overload trip also from the `overload_trip` fault control (while true the overload stays tripped).

Controls: `start` (momentary, key S), `stop` (momentary, key X), `jog` (momentary, key J),
`estop` (maintained; true = mushroom pushed), `hoa` (selector: 0 = HAND, 1 = OFF, 2 = AUTO; default 1),
`remote_run` (maintained; upstream run request; default false), `overload_trip` (fault; default false),
`overload_reset` (momentary: a press resets a tripped overload if the cause is gone — no `overload_trip`, no
`jam` — and its thermal memory has cooled below 25 %, ≈ 2.25 s after a jam trip; holding it cannot defeat a
trip), `jam` (fault; default false).

Observables: `contactor` (bool, coil energized), `motorRunning` (bool, rpm > 100), `motorRpm`,
`runLight`, `faultLight`, `horn`, `readyLight` (bool), `motorStarts` (count of contactor off→on),
`overloadTripped` (bool), `runTimeMs` (total ms with contactor closed).

---

## 3. `traffic-light` — Four-way Intersection (CompactLogix 5380)

Main street runs North–South (NS), side street East–West (EW). Cars and pedestrians animate.

Hardware: `CompactLogix`: slot 0 `5069-L320ER`, slot 1 `5069-IB16`, slot 2 `5069-OB16`.

| Operand | Alias | Dir | Device |
|---|---|---|---|
| Local:1:I.Pt00.Data | `Ped_PB` | in | pedestrian push button (N.O.) for crossing the main street |
| Local:1:I.Pt01.Data | `Car_Sensor_EW` | in | inductive loop detector, 1 while a car waits on the side street |
| Local:1:I.Pt02.Data | `Night_Mode` | in | maintained key switch, 1 = night flashing mode |
| Local:2:O.Pt00.Data | `NS_Red` | out | |
| Local:2:O.Pt01.Data | `NS_Yellow` | out | |
| Local:2:O.Pt02.Data | `NS_Green` | out | |
| Local:2:O.Pt03.Data | `EW_Red` | out | |
| Local:2:O.Pt04.Data | `EW_Yellow` | out | |
| Local:2:O.Pt05.Data | `EW_Green` | out | |
| Local:2:O.Pt06.Data | `Walk` | out | pedestrian WALK (white figure) crossing the main street |
| Local:2:O.Pt07.Data | `Dont_Walk` | out | pedestrian DON'T WALK (orange hand) |

Physics
- Cars spawn with a seeded PRNG when `auto_traffic` is on (NS every ~3–6 s, EW every ~6–12 s); the
  `spawn_ew` / `spawn_ns` controls add one car immediately. Cars stop at the stop line on red/yellow
  (yellow: stop only if they can), proceed on green, queue behind each other.
- `Car_Sensor_EW` = 1 while at least one EW car waits at the stop line.
- Drivers read each head like real drivers: a lamp relit within 3.2 s is flashing (≥ ~19 flashes/min;
  flickers < 150 ms ignored). Flashing yellow = proceed with caution, flashing red or a dark head = all-way
  stop, a steady yellow lasting > 8 s is treated as caution. Nobody pulls into a crossing car already in
  (or committed to) the intersection, so only conflicting signals cause crashes.
- `conflict` = (NS green or yellow) AND (EW green or yellow) at the same time, OR Walk on while NS
  green/yellow. When a conflict lasts ≥ 100 ms, `conflicts` increments once per occurrence (a car
  crash animation plays in the view).
- A pedestrian appears when `Ped_PB` is pressed and crosses while `Walk` is on.

Controls: `ped` (momentary, key P), `night` (maintained), `auto_traffic` (maintained, default true),
`spawn_ew` (momentary), `spawn_ns` (momentary).

Observables: `nsRed`, `nsYellow`, `nsGreen`, `ewRed`, `ewYellow`, `ewGreen`, `walk`, `dontWalk`
(bool, actual lamp states), `conflict` (bool), `conflicts` (count), `carsPassed` (count),
`carsWaitingEW` (number), `pedWaiting` (bool: a pedestrian is waiting to cross), `pedCrossed` (count).

---

## 4. `conveyor-sort` — Box Sorting Conveyor (ControlLogix)

A 6 m belt conveyor. A gravity feeder drops boxes on the infeed; a high photo-eye detects TALL boxes;
a pneumatic pusher diverts tall boxes into a reject chute; short boxes run off the end to the good lane.

Hardware: `ControlLogix`, `1756-A7`, `1756-PA72`: slot 0 `1756-L83E`, slot 1 `1756-IB16`,
slot 2 `1756-OB16E`, slot 3 `1756-EN2T`.

Geometry (meters along the belt from the infeed end): feeder drop at 0.3, `PE_Infeed` at 0.9,
`PE_Tall` at 2.5 (beam at 0.30 m above the belt, only tall boxes 0.35 m break it; short boxes are 0.20 m),
pusher & `PE_Divert` at 4.0, `PE_Exit` at 5.8, belt end 6.0. Box length 0.30 m. Belt speed 0.5 m/s
when running (accel/decel within 0.2 s).

| Operand | Alias | Dir | Device |
|---|---|---|---|
| Local:1:I.Data.0 | `Start_PB` | in | N.O. |
| Local:1:I.Data.1 | `Stop_PB` | in | **N.C.** |
| Local:1:I.Data.2 | `PE_Infeed` | in | 42EF photo-eye, 1 = box present |
| Local:1:I.Data.3 | `PE_Tall` | in | high photo-eye, 1 = tall box present |
| Local:1:I.Data.4 | `PE_Divert` | in | photo-eye in front of the pusher, 1 = box present |
| Local:1:I.Data.5 | `Pusher_Extended` | in | cylinder reed switch |
| Local:1:I.Data.6 | `Pusher_Retracted` | in | cylinder reed switch |
| Local:1:I.Data.7 | `PE_Exit` | in | photo-eye at the discharge end |
| Local:1:I.Data.8 | `EStop_OK` | in | **N.C.** |
| Local:2:O.Data.0 | `Conveyor_Run` | out | belt motor starter |
| Local:2:O.Data.1 | `Pusher_Extend` | out | 5/2 spring-return solenoid valve |
| Local:2:O.Data.2 | `Feeder_Release` | out | feeder gate: each rising edge releases one box (PLC feeder mode) |
| Local:2:O.Data.3 | `Light_Green` | out | 855T stack light green tier |
| Local:2:O.Data.4 | `Light_Amber` | out | amber tier |
| Local:2:O.Data.5 | `Light_Red` | out | red tier |

Physics
- The belt moves only while `Conveyor_Run` is on AND E-stop released (hardwired).
- Feeder: `feeder_mode` 0 = AUTO: while the belt is moving, drop the next box when the infeed zone
  (0–1.2 m) is clear and ≥ 1.2 s since the last drop. 1 = PLC: drop a box on each rising edge of
  `Feeder_Release` if the infeed zone is clear. Box sequence is from a seeded PRNG with ~35 % tall boxes;
  the `box_pattern` control can force: 0 = random, 1 = all short, 2 = all tall, 3 = alternate.
- Pusher: extends in 250 ms while `Pusher_Extend` is on, retracts in 300 ms when off. A box whose
  center is within ±0.2 m of 4.0 when the pusher reaches > 60 % extension is diverted to the reject
  chute (it leaves the belt). If the pusher is extended (> 30 %) and a box's leading edge reaches it, the
  box is blocked → `jams` increments once and the box stays until the pusher retracts.
- Boxes reaching the belt end leave to the good lane. Tall box to good lane or short box to the reject
  chute counts as `missorted`.
- Fault `pe_infeed_fail`: `PE_Infeed` always reads 0.

Controls: `start` (momentary, S), `stop` (momentary, X), `estop` (maintained), `feeder_mode`
(selector ['AUTO','PLC'], default 0), `box_pattern` (selector ['Random','All short','All tall','Alternate'],
default 0), `pe_infeed_fail` (fault).

Observables: `conveyorRunning` (bool, belt moving), `beltSpeed` (m/s), `boxesOnBelt` (number),
`boxesFed` (count), `boxesGood` (count of short boxes delivered to the good lane),
`boxesRejected` (count of tall boxes diverted), `missorted` (count), `jams` (count),
`pusherPosition` (0..1), `lightGreen`, `lightAmber`, `lightRed` (bool).

---

## 5. `tank-process` — Mixing & Heating Tank (ControlLogix with analog I/O)

A 2000 L stainless mixing tank: inlet valve, outlet valve, agitator, electric heater, level & temperature
transmitters, level switches.

Hardware: `ControlLogix`, `1756-A10`, `1756-PA75`: slot 0 `1756-L85E`, slot 1 `1756-IB16`,
slot 2 `1756-OB16E`, slot 3 `1756-IF8`, slot 4 `1756-OF8`, slot 5 `1756-EN2T`.
(The 1756-IF8 channels are configured to scale 4–20 mA to engineering units, so `ChxData` is a REAL.)

| Operand | Alias | Dir | Device |
|---|---|---|---|
| Local:1:I.Data.0 | `Start_PB` | in | N.O. |
| Local:1:I.Data.1 | `Stop_PB` | in | **N.C.** |
| Local:1:I.Data.2 | `LSL_101` | in | low level switch, 1 when level ≥ 10 % |
| Local:1:I.Data.3 | `LSH_101` | in | high level switch, 1 when level ≥ 90 % |
| Local:1:I.Data.4 | `LSHH_101` | in | high-high switch, **N.C. fail-safe**: 0 when level ≥ 97 % |
| Local:1:I.Data.5 | `Mixer_Running` | in | agitator starter aux contact |
| Local:1:I.Data.6 | `Discharge_PB` | in | N.O. "discharge batch" push button |
| Local:1:I.Data.7 | `EStop_OK` | in | **N.C.** |
| Local:3:I.Ch0Data | `LT_101` | in (analog) | level transmitter 0–100 % |
| Local:3:I.Ch1Data | `TT_101` | in (analog) | temperature transmitter 0–150 °C |
| Local:2:O.Data.0 | `Fill_Valve` | out | XV-101 inlet on/off valve |
| Local:2:O.Data.1 | `Drain_Valve` | out | XV-102 outlet on/off valve |
| Local:2:O.Data.2 | `Mixer` | out | agitator M-101 starter |
| Local:2:O.Data.3 | `Heater` | out | heater contactor (full power) |
| Local:2:O.Data.4 | `Alarm_Horn` | out | |
| Local:2:O.Data.5 | `Batch_Done_Light` | out | green pilot light |
| Local:2:O.Data.6 | `Running_Light` | out | amber pilot light |
| Local:4:O.Ch0Data | `FCV_101` | out (analog) | proportional inlet control valve position 0–100 % |

Physics
- Inflow (%/s) = 4.5 × max(Fill_Valve ? 1 : 0, clamp(FCV_101,0,100)/100). Outflow = 5 %/s while
  `Drain_Valve` open and level > 0. Level clamps at 0 and 100; at 100 with inflow the tank spills
  (`spills` increments once per overflow event, `overflow` true while spilling). An event lasts until the
  level drops below 99.5 % or nothing has spilled for 2 s, so a fill valve chattering at the rim is one spill.
- Temperature (°C): heater adds 1.2 °C/s × (50 / max(level, 20)) while `Heater` on and level ≥ 10 %;
  heater on with level < 10 % counts `dryHeatMs` (bad). Cooling toward 20 °C at 0.005 × (T − 20) per s
  (insulated tank, τ ≈ 200 s); inflow at 15 °C mixes in proportionally; the liquid is capped at 100 °C
  (boiling). Reference heat-up for mission time limits: 15 → 60 °C at 90 % level takes ≈ 79 s.
  (With 0.02 the heater equilibrium would be ≈ 53 °C at 90 % and the batch below could never complete.)
- Agitator: runs when `Mixer` output on and E-stop released; `Mixer_Running` follows with 100 ms.
  Running with level < 10 % counts `dryRunMs`.
- Transmitter noise: ±0.05 % deterministic (seeded).
- Batch accounting: a batch is complete when the tank was filled ≥ 85 %, heated to ≥ 60 °C while the
  mixer ran ≥ 5 s cumulative, then drained below 5 % → `batches` increments.
- Faults: `lt_fail` (open loop: LT_101 reads 0.0 and the 1756-IF8 sets `Local:3:I.Ch0Fault` and
  `Local:3:I.Ch0Underrange`), `lsh_fail` (LSH_101 stuck at 0).

Controls: `start` (momentary), `stop` (momentary), `estop` (maintained), `discharge` (momentary),
`lt_fail` (fault), `lsh_fail` (fault).

Observables: `level` (%), `temperature` (°C), `fillValve`, `drainValve`, `mixerRunning`, `heaterOn`,
`alarmHorn`, `batchDoneLight`, `runningLight` (bool), `fcvPosition` (%), `overflow` (bool), `spills`
(count), `dryRunMs`, `dryHeatMs` (number), `batches` (count).

---

## 6. `parking-garage` — Parking Garage Gates (CompactLogix 5380)

A 12-space garage with an entry gate and an exit gate. Cars queue at the entry, the driver presses the
ticket button, the gate rises, the car drives through, parks; parked cars leave later through the exit.

Hardware: `CompactLogix`: slot 0 `5069-L320ER`, slot 1 `5069-IB16`, slot 2 `5069-OB16`.

| Operand | Alias | Dir | Device |
|---|---|---|---|
| Local:1:I.Pt00.Data | `Entry_Loop` | in | vehicle detector loop in front of the entry gate |
| Local:1:I.Pt01.Data | `Entry_PE` | in | photo-eye under the entry gate (car passing) |
| Local:1:I.Pt02.Data | `Exit_Loop` | in | vehicle detector loop in front of the exit gate |
| Local:1:I.Pt03.Data | `Exit_PE` | in | photo-eye under the exit gate |
| Local:1:I.Pt04.Data | `Ticket_PB` | in | ticket dispenser button (N.O.), pressed by drivers |
| Local:1:I.Pt05.Data | `Reset_Key` | in | attendant key switch (momentary) |
| Local:2:O.Pt00.Data | `Entry_Gate_Up` | out | entry barrier motor: raise while on, lowers when off |
| Local:2:O.Pt01.Data | `Exit_Gate_Up` | out | exit barrier |
| Local:2:O.Pt02.Data | `Full_Sign` | out | red "FULL" sign |
| Local:2:O.Pt03.Data | `Open_Sign` | out | green "SPACES" sign |

Physics
- Barrier arms rise in 1.5 s, lower in 1.5 s. A car drives through only when its gate is ≥ 90 % up.
- Driver behavior at the entry: arrives on the loop, waits 0.8 s, presses `Ticket_PB` for 0.3 s
  (repeats every 4 s while waiting), drives through once the gate is up (the car occupies the PE for
  ~1.0 s), then parks. If the garage is physically full the car leaves by the exit lane after 5 s
  (`carsTurnedAway`). If the PLC opens the gate on a full garage anyway, one car without a space is let in
  at a time (it circles and queues for the exit; `carsInside` exceeds 12); the others are turned away.
- Parked cars leave after a random dwell (seeded PRNG) when `auto_traffic` is on; `spawn_exit` sends one
  parked car (if any) to the exit loop immediately. Exit gate: car waits on `Exit_Loop` until the gate is up.
- Lowering a gate while a car is under it (PE on) → `gateHits` increments (the arm bounces).
- The number of cars actually inside is `carsInside`; it starts at `initial_cars` (control, default 0).

Controls: `auto_traffic` (maintained, default true), `spawn_entry` (momentary: a car arrives at the
entry), `spawn_exit` (momentary: a parked car drives to the exit), `reset_key` (momentary),
`initial_cars` (analog 0–12, applied on reset).

Observables: `carsInside` (count), `capacity` (12), `entryGateUp`, `exitGateUp` (bool: ≥ 90 % open),
`entryGatePos`, `exitGatePos` (0..1), `fullSign`, `openSign` (bool), `gateHits` (count),
`carsTurnedAway` (count), `carsEntered` (count), `carsExited` (count), `carsWaitingEntry`,
`carsWaitingExit` (number).
