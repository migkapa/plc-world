/**
 * `motor-station` — Motor Control Station (ControlLogix). See docs/SCENES.md §2.
 *
 * A 5 HP conveyor drive motor started through a 100-C09 contactor with a 193-E overload relay,
 * operated from an 800F push-button station. The contactor coil circuit is hardwired through the
 * E-stop's second N.C. contact and the overload's 95-96 contact, so the PLC output alone cannot
 * run the motor when either is open.
 */
import type { ControlDef, IoAccess, IoPointDef, ObservableDef, SceneLogic } from '../../types';
import {
  clamp,
  controlTable,
  createDelayedContact,
  defaultControls,
  firstOrder,
  readControl,
  stepDelayedContact,
  wrapAngle,
  writeControl,
  type DelayedContact,
} from '../../testing/sceneKit';

/** Operator / instructor control values. */
export interface MotorStationControls {
  start: boolean;
  stop: boolean;
  jog: boolean;
  /** True while the mushroom is pushed in (latched). */
  estop: boolean;
  /** Selector position: 0 = HAND, 1 = OFF, 2 = AUTO. */
  hoa: number;
  /** Upstream line run request (AUTO mode). */
  remote_run: boolean;
  /** Fault: overload tripped while true (stays tripped until reset). */
  overload_trip: boolean;
  /**
   * Momentary: reset a tripped overload. Only the press (rising edge) counts, and only once the cause
   * is gone (no `overload_trip` fault, no `jam`) and the thermal memory has cooled below the reset level.
   */
  overload_reset: boolean;
  /** Fault: conveyor jammed — the motor stalls. */
  jam: boolean;
}

/** Scene state (also read by the 3D view every frame). Plain JSON data. */
export interface MotorStationState {
  /** Simulated time since reset (ms). */
  timeMs: number;
  controls: MotorStationControls;
  /** A press (rising edge) of `overload_reset` not yet processed by `step()`. */
  resetRequest: boolean;
  /** `Motor_Starter` output as driven by the PLC. */
  starterOutput: boolean;
  /** Contactor coil energised (output AND E-stop released AND overload healthy). */
  coil: boolean;
  /** Contactor armature: main contacts + auxiliary 13-14 (40 ms pull-in / 25 ms drop-out). */
  contacts: DelayedContact;
  /** Motor shaft speed (rpm). */
  motorRpm: number;
  /** Shaft angle for the fan/shaft animation (rad, wrapped to [0, 2π)). */
  shaftAngle: number;
  /** Line current (A): ~7.6 A running at full load, up to ~45 A locked rotor. */
  motorCurrentA: number;
  /** Driven conveyor belt travel (m, monotonic; 0.5 m/s at 1750 rpm). */
  beltPosition: number;
  /** Overload relay tripped (95-96 open). */
  overloadTripped: boolean;
  /**
   * Overload thermal memory (ms of stalled running; cools at the same rate once the stall ends). Trips
   * at 3000; a reset is refused until it has cooled below 25 % (750).
   */
  stallMs: number;
  /** Thermal capacity used 0..1 (glow / overload relay display); 1 while tripped by the fault control. */
  overloadHeat: number;
  /** A tripped overload would accept a reset right now (cause gone, cooled) — the relay's "reset ready" indication. */
  overloadResetReady: boolean;
  /** Pilot lights / horn as seen at the field. */
  runLight: boolean;
  faultLight: boolean;
  horn: boolean;
  readyLight: boolean;
  /** Count of contactor coil off→on transitions. */
  motorStarts: number;
  /** Total ms with the main contacts closed. */
  runTimeMs: number;
}

const SCENE_ID = 'motor-station';

/** Motor & overload model constants (exported for the view / HUD). */
export const MOTOR_STATION = {
  ratedRpm: 1750,
  stallRpm: 150,
  runningThresholdRpm: 100,
  accelTauS: 0.6,
  coastTauS: 1.5,
  stallTauS: 0.25,
  /** Full-load and locked-rotor current of a 5 HP, 460 V motor (NEC table values). */
  fullLoadAmps: 7.6,
  lockedRotorAmps: 45,
  /** Stalled running time before the overload trips. */
  stallTripMs: 3000,
  /** Thermal memory (fraction of the trip level) below which a tripped overload can be reset. */
  resetLevel: 0.25,
  pullInMs: 40,
  dropOutMs: 25,
  /** Belt speed at rated rpm (m/s). */
  beltSpeed: 0.5,
} as const;

const io: IoPointDef[] = [
  {
    operand: 'Local:1:I.Data.0',
    alias: 'Start_PB',
    dir: 'input',
    signal: 'digital',
    device: '800FP-F3PX10 green flush push button (N.O.)',
    description: 'Normally-open: input is 1 only while pressed',
    deviceId: 'pb-start',
  },
  {
    operand: 'Local:1:I.Data.1',
    alias: 'Stop_PB',
    dir: 'input',
    signal: 'digital',
    device: '800FP-E4PX01 red extended push button (N.C.)',
    description: 'Normally-closed: input is 1 when NOT pressed, 0 while pressed (wire-break safe)',
    deviceId: 'pb-stop',
  },
  {
    operand: 'Local:1:I.Data.2',
    alias: 'EStop_OK',
    dir: 'input',
    signal: 'digital',
    device: '800FP-MT44PX02 40 mm twist-to-release E-stop (2 N.C.)',
    description:
      '1 = released/healthy, 0 = pushed. Its 2nd N.C. contact is hardwired in series with the contactor coil',
    deviceId: 'estop',
  },
  {
    operand: 'Local:1:I.Data.3',
    alias: 'Jog_PB',
    dir: 'input',
    signal: 'digital',
    device: '800FP-F2PX10 black flush push button (N.O.)',
    description: 'Normally-open: input is 1 only while pressed',
    deviceId: 'pb-jog',
  },
  {
    operand: 'Local:1:I.Data.4',
    alias: 'OL_OK',
    dir: 'input',
    signal: 'digital',
    device: '193-E electronic overload relay, 95-96 contact (N.C.)',
    description: '1 = healthy, 0 = tripped. 95-96 is also hardwired in series with the contactor coil',
    deviceId: 'overload',
  },
  {
    operand: 'Local:1:I.Data.5',
    alias: 'Motor_Aux',
    dir: 'input',
    signal: 'digital',
    device: '100-C09 contactor auxiliary contact 13-14 (N.O.)',
    description: '1 while the contactor is pulled in (40 ms pull-in, 25 ms drop-out after the coil)',
    deviceId: 'contactor',
  },
  {
    operand: 'Local:1:I.Data.6',
    alias: 'HOA_Hand',
    dir: 'input',
    signal: 'digital',
    device: '800F 3-position selector switch HAND–OFF–AUTO, HAND contact',
    description: '1 while the selector is in HAND',
    deviceId: 'hoa',
  },
  {
    operand: 'Local:1:I.Data.7',
    alias: 'HOA_Auto',
    dir: 'input',
    signal: 'digital',
    device: '800F 3-position selector switch HAND–OFF–AUTO, AUTO contact',
    description: '1 while the selector is in AUTO (both contacts 0 = OFF)',
    deviceId: 'hoa',
  },
  {
    operand: 'Local:1:I.Data.8',
    alias: 'Remote_Run',
    dir: 'input',
    signal: 'digital',
    device: 'Run request relay contact from the upstream line',
    description: '1 while the upstream line requests this conveyor to run (used in AUTO)',
    deviceId: 'remote-run',
  },
  {
    operand: 'Local:2:O.Data.0',
    alias: 'Motor_Starter',
    dir: 'output',
    signal: 'digital',
    device: '100-C09 contactor coil M (24 V DC)',
    description: 'Energises the contactor coil through the hardwired E-stop and overload contacts',
    deviceId: 'contactor',
  },
  {
    operand: 'Local:2:O.Data.1',
    alias: 'Run_Light',
    dir: 'output',
    signal: 'digital',
    device: '800F green LED pilot light',
    description: 'RUNNING indication',
    deviceId: 'light-run',
  },
  {
    operand: 'Local:2:O.Data.2',
    alias: 'Fault_Light',
    dir: 'output',
    signal: 'digital',
    device: '800F red LED pilot light',
    description: 'FAULT indication',
    deviceId: 'light-fault',
  },
  {
    operand: 'Local:2:O.Data.3',
    alias: 'Horn',
    dir: 'output',
    signal: 'digital',
    device: '24 V DC warning horn',
    description: 'Start-up warning / alarm horn',
    deviceId: 'horn',
  },
  {
    operand: 'Local:2:O.Data.4',
    alias: 'Ready_Light',
    dir: 'output',
    signal: 'digital',
    device: '800F white LED pilot light',
    description: 'READY indication',
    deviceId: 'light-ready',
  },
];

const controls: ControlDef[] = [
  { id: 'start', label: 'Start', type: 'momentary', default: false, key: 'S', description: 'Green START push button' },
  { id: 'stop', label: 'Stop', type: 'momentary', default: false, key: 'X', description: 'Red STOP push button (N.C.)' },
  { id: 'jog', label: 'Jog', type: 'momentary', default: false, key: 'J', description: 'Black JOG push button' },
  {
    id: 'estop',
    label: 'E-Stop',
    type: 'maintained',
    default: false,
    description: 'Mushroom E-stop: true = pushed (latched until twisted out)',
  },
  {
    id: 'hoa',
    label: 'Hand-Off-Auto',
    type: 'selector',
    default: 1,
    positions: ['HAND', 'OFF', 'AUTO'],
    description: '3-position selector switch',
  },
  {
    id: 'remote_run',
    label: 'Remote run request',
    type: 'maintained',
    default: false,
    description: 'Run request from the upstream line (AUTO mode)',
  },
  {
    id: 'overload_trip',
    label: 'Overload trip',
    type: 'fault',
    default: false,
    description: 'Trips the overload relay (stays tripped until reset)',
  },
  {
    id: 'overload_reset',
    label: 'Overload reset',
    type: 'momentary',
    default: false,
    description: 'Blue RESET button on the overload relay (works once the cause is gone and it has cooled)',
  },
  {
    id: 'jam',
    label: 'Conveyor jam',
    type: 'fault',
    default: false,
    description: 'Mechanical jam: the motor stalls and the overload trips after 3 s',
  },
];

const observables: ObservableDef[] = [
  { id: 'contactor', label: 'Contactor coil', type: 'boolean', description: 'Coil energised' },
  { id: 'motorRunning', label: 'Motor running', type: 'boolean', description: 'Speed > 100 rpm' },
  { id: 'motorRpm', label: 'Motor speed', type: 'number', units: 'rpm' },
  { id: 'runLight', label: 'Run light', type: 'boolean' },
  { id: 'faultLight', label: 'Fault light', type: 'boolean' },
  { id: 'horn', label: 'Horn', type: 'boolean' },
  { id: 'readyLight', label: 'Ready light', type: 'boolean' },
  { id: 'motorStarts', label: 'Motor starts', type: 'number', description: 'Contactor off→on count' },
  { id: 'overloadTripped', label: 'Overload tripped', type: 'boolean' },
  { id: 'runTimeMs', label: 'Run time', type: 'number', units: 'ms', description: 'Time with the contactor closed' },
];

const CONTROLS = controlTable(SCENE_ID, controls);

/** A tripped overload accepts a reset: the cause is gone (no trip fault, no jam) and the thermal memory has cooled. */
function overloadResettable(s: MotorStationState): boolean {
  const c = s.controls;
  return (
    s.overloadTripped &&
    !c.overload_trip &&
    !c.jam &&
    s.stallMs < MOTOR_STATION.resetLevel * MOTOR_STATION.stallTripMs
  );
}

export const motorStationLogic: SceneLogic<MotorStationState> = {
  id: SCENE_ID,
  title: 'Motor Control Station',
  summary:
    'A 5 HP conveyor motor on a 100-C09 contactor with a 193-E overload, run from an 800F push-button station with Hand-Off-Auto.',
  hardware: {
    platform: 'ControlLogix',
    chassis: '1756-A7',
    powerSupply: '1756-PA72',
    modules: [
      { slot: 0, catalog: '1756-L85E' },
      { slot: 1, catalog: '1756-IB16', name: 'DI_Station' },
      { slot: 2, catalog: '1756-OB16E', name: 'DO_Station' },
      { slot: 3, catalog: '1756-EN2T', name: 'ENET_Station' },
    ],
  },
  io,
  controls,
  observables,

  createState(): MotorStationState {
    return {
      timeMs: 0,
      controls: defaultControls<MotorStationControls>(CONTROLS),
      resetRequest: false,
      starterOutput: false,
      coil: false,
      contacts: createDelayedContact(false),
      motorRpm: 0,
      shaftAngle: 0,
      motorCurrentA: 0,
      beltPosition: 0,
      overloadTripped: false,
      stallMs: 0,
      overloadHeat: 0,
      overloadResetReady: false,
      runLight: false,
      faultLight: false,
      horn: false,
      readyLight: false,
      motorStarts: 0,
      runTimeMs: 0,
    };
  },

  step(s: MotorStationState, dtMs: number, io: IoAccess): void {
    const dt = dtMs / 1000;
    const c = s.controls;
    const M = MOTOR_STATION;
    s.timeMs += dtMs;

    // --- PLC outputs as seen at the field ---
    s.starterOutput = io.readBool('Local:2:O.Data.0');
    s.runLight = io.readBool('Local:2:O.Data.1');
    s.faultLight = io.readBool('Local:2:O.Data.2');
    s.horn = io.readBool('Local:2:O.Data.3');
    s.readyLight = io.readBool('Local:2:O.Data.4');

    // --- overload relay: fault injection & reset (trip-free: holding RESET cannot defeat a trip) ---
    if (c.overload_trip) s.overloadTripped = true;
    if (s.resetRequest && overloadResettable(s)) s.overloadTripped = false;
    s.resetRequest = false;

    // --- hardwired coil circuit: output -> E-stop N.C. -> OL 95-96 -> coil ---
    const coil = s.starterOutput && !c.estop && !s.overloadTripped;
    if (coil && !s.coil) s.motorStarts++;
    s.coil = coil;
    const closed = stepDelayedContact(s.contacts, coil, dtMs, M.pullInMs, M.dropOutMs);
    if (closed) s.runTimeMs += dtMs;

    // --- motor mechanics ---
    const stalled = closed && c.jam;
    let target = 0;
    let tau: number = c.jam ? M.stallTauS : M.coastTauS;
    if (closed) {
      target = c.jam ? M.stallRpm : M.ratedRpm;
      tau = c.jam ? M.stallTauS : M.accelTauS;
    }
    s.motorRpm = firstOrder(s.motorRpm, target, dt, tau);
    if (!closed && s.motorRpm < 0.5) s.motorRpm = 0;
    s.shaftAngle = wrapAngle(s.shaftAngle + (s.motorRpm / 60) * 2 * Math.PI * dt);
    s.beltPosition += (s.motorRpm / M.ratedRpm) * M.beltSpeed * dt;
    s.motorCurrentA = closed
      ? M.fullLoadAmps + (M.lockedRotorAmps - M.fullLoadAmps) * clamp(1 - s.motorRpm / M.ratedRpm, 0, 1)
      : 0;

    // --- overload thermal memory: trips after 3 s of stalled running ---
    s.stallMs = stalled ? s.stallMs + dtMs : Math.max(0, s.stallMs - dtMs);
    if (s.stallMs >= M.stallTripMs - 1e-9) s.overloadTripped = true;
    s.overloadHeat = c.overload_trip ? 1 : clamp(s.stallMs / M.stallTripMs, 0, 1);
    s.overloadResetReady = overloadResettable(s);

    // --- field inputs (every point, every step) ---
    io.writeBool('Local:1:I.Data.0', c.start);
    io.writeBool('Local:1:I.Data.1', !c.stop); // N.C.
    io.writeBool('Local:1:I.Data.2', !c.estop); // N.C.
    io.writeBool('Local:1:I.Data.3', c.jog);
    io.writeBool('Local:1:I.Data.4', !s.overloadTripped); // N.C. 95-96
    io.writeBool('Local:1:I.Data.5', closed);
    io.writeBool('Local:1:I.Data.6', c.hoa === 0);
    io.writeBool('Local:1:I.Data.7', c.hoa === 2);
    io.writeBool('Local:1:I.Data.8', c.remote_run);
  },

  setControl(s, id, value) {
    const prev = writeControl(CONTROLS, s.controls, id, value);
    if (id === 'overload_reset' && s.controls.overload_reset && !prev) s.resetRequest = true;
  },

  getControl(s, id) {
    return readControl(CONTROLS, s.controls, id);
  },

  observe(s) {
    return {
      contactor: s.coil,
      motorRunning: s.motorRpm > MOTOR_STATION.runningThresholdRpm,
      motorRpm: s.motorRpm,
      runLight: s.runLight,
      faultLight: s.faultLight,
      horn: s.horn,
      readyLight: s.readyLight,
      motorStarts: s.motorStarts,
      overloadTripped: s.overloadTripped,
      runTimeMs: s.runTimeMs,
    };
  },
};
