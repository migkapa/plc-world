/**
 * `tank-process` — Mixing & Heating Tank (ControlLogix with analog I/O). See docs/SCENES.md §5.
 *
 * A 2000 L stainless mixing tank with an on/off inlet valve (XV-101), a proportional inlet control
 * valve (FCV-101), an outlet valve (XV-102), an agitator (M-101), an electric heater, level and
 * temperature transmitters on a 1756-IF8 (scaled to engineering units, REAL) and three level switches.
 * Levels are in % of tank height, temperatures in °C.
 */
import type { ControlDef, IoAccess, IoPointDef, ObservableDef, SceneLogic } from '../../types';
import {
  approach,
  clamp,
  controlTable,
  createDelayedContact,
  createRng,
  defaultControls,
  firstOrder,
  randomRange,
  readControl,
  stepDelayedContact,
  wrapAngle,
  writeControl,
  type DelayedContact,
  type RngState,
} from '../../testing/sceneKit';

export interface TankProcessControls {
  start: boolean;
  stop: boolean;
  /** True while the mushroom is pushed (latched). */
  estop: boolean;
  discharge: boolean;
  /** Fault: LT-101 loop open — LT_101 reads 0.0, 1756-IF8 Ch0Fault + Ch0Underrange set. */
  lt_fail: boolean;
  /** Fault: LSH_101 stuck at 0. */
  lsh_fail: boolean;
}

/** Progress of the batch currently in the tank (see docs: fill ≥ 85 %, heat ≥ 60 °C, mix ≥ 5 s, drain < 5 %). */
export interface TankBatchTracker {
  /** Level reached ≥ 85 % in this cycle. */
  filled: boolean;
  /** Reached ≥ 60 °C after being filled. */
  heated: boolean;
  /** Agitator run time with liquid (level ≥ 10 %) in this cycle (ms). */
  mixMs: number;
  /** Outcome of the last drained cycle. */
  lastResult: 'none' | 'complete' | 'incomplete';
}

/** Scene state (also read by the 3D view every frame). Plain JSON data. */
export interface TankProcessState {
  timeMs: number;
  controls: TankProcessControls;
  rng: RngState;
  /** True liquid level (% of height; 100 % = 2000 L). */
  level: number;
  /** True liquid temperature (°C). */
  temperature: number;
  /** Outputs as driven by the PLC. */
  fillValve: boolean;
  drainValve: boolean;
  mixerCommand: boolean;
  heaterOn: boolean;
  alarmHorn: boolean;
  batchDoneLight: boolean;
  runningLight: boolean;
  /** Raw FCV_101 command (%), and the valve position it produces (clamped 0..100 %). */
  fcvCommand: number;
  fcvPosition: number;
  /** Flows in %/s (the view scales streams / particles with these). */
  inflowRate: number;
  outflowRate: number;
  /** Rate spilling over the rim (%/s) while overflowing. */
  spillRate: number;
  /** Valve stems for animation, 0 = closed .. 1 = open (actuator stroke ~0.4 s; visual only). */
  fillValveStroke: number;
  drainValveStroke: number;
  fcvStroke: number;
  /** Agitator motor energised (Mixer output AND E-stop released — hardwired). */
  mixerEnergized: boolean;
  /** Starter auxiliary contact (follows with 100 ms). */
  mixerAux: DelayedContact;
  /** Agitator shaft speed (rpm) and blade angle (rad). */
  agitatorRpm: number;
  agitatorAngle: number;
  /** Heater element glow 0..1 (view); `heaterDry` = heating with the element uncovered. */
  heaterGlow: number;
  heaterDry: boolean;
  /** Liquid at its boiling point (steam effect). */
  boiling: boolean;
  /** Level switch inputs as wired (LSHH is fail-safe N.C.). */
  lsl: boolean;
  lsh: boolean;
  lshh: boolean;
  /** Transmitter values delivered to the PLC (with noise / faults). */
  ltReading: number;
  ttReading: number;
  /** LT-101 channel fault (open loop): `Local:3:I.Ch0Fault` and `Ch0Underrange` are set; the view shows the fault LED. */
  ltChannelFault: boolean;
  /**
   * An overflow event is in progress: set when the tank starts spilling, held through valve chatter at
   * the rim; ends once the level is below 99.5 % or nothing has spilled for 2 s (see `spillRate`).
   */
  overflow: boolean;
  /** ms since liquid last went over the rim during the current overflow event. */
  overflowQuietMs: number;
  /** Overflow events (not spilling scans). */
  spills: number;
  dryRunMs: number;
  dryHeatMs: number;
  batches: number;
  batch: TankBatchTracker;
}

/** Process constants. */
export const TANK_PROCESS = {
  capacityL: 2000,
  maxInflow: 4.5,
  outflow: 5,
  inflowTempC: 15,
  ambientC: 20,
  heaterRate: 1.2,
  /**
   * Newton cooling toward ambient, per second. docs/SCENES.md says 0.02, but then the heater's
   * equilibrium is 20 + 3000/level °C (≈ 53 °C at 90 %) and the spec's own batch (fill ≥ 85 %, heat
   * ≥ 60 °C) could never complete. 0.005 (τ ≈ 200 s, an insulated tank) keeps the batch reachable:
   * 15 → 60 °C at 90 % level takes ≈ 79 s.
   */
  coolingCoeff: 0.005,
  boilingC: 100,
  lowLevel: 10,
  lsl: 10,
  lsh: 90,
  lshh: 97,
  mixerAuxDelayMs: 100,
  agitatorRpm: 90,
  /** Transmitter noise: ±0.05 % of span. */
  ltNoise: 0.05,
  ttNoise: 0.075,
  /** An overflow event ends when the level falls below this (%) or nothing has spilled for `overflowQuietMs`. */
  overflowEndLevel: 99.5,
  overflowQuietMs: 2000,
  batch: { fill: 85, temp: 60, mixMs: 5000, drained: 5 },
} as const;
const P = TANK_PROCESS;

const SCENE_ID = 'tank-process';

const di = (bit: number, alias: string, device: string, description: string, deviceId: string): IoPointDef => ({
  operand: `Local:1:I.Data.${bit}`,
  alias,
  dir: 'input',
  signal: 'digital',
  device,
  description,
  deviceId,
});
const dout = (bit: number, alias: string, device: string, description: string, deviceId: string): IoPointDef => ({
  operand: `Local:2:O.Data.${bit}`,
  alias,
  dir: 'output',
  signal: 'digital',
  device,
  description,
  deviceId,
});

const io: IoPointDef[] = [
  di(0, 'Start_PB', '800FP-F3PX10 green flush push button (N.O.)', 'Normally-open: 1 only while pressed', 'pb-start'),
  di(1, 'Stop_PB', '800FP-E4PX01 red extended push button (N.C.)', 'Normally-closed: 1 when NOT pressed', 'pb-stop'),
  di(2, 'LSL_101', 'Vibrating-fork level switch LSL-101 (low)', '1 when the level is ≥ 10 %', 'lsl-101'),
  di(3, 'LSH_101', 'Vibrating-fork level switch LSH-101 (high)', '1 when the level is ≥ 90 %', 'lsh-101'),
  di(
    4,
    'LSHH_101',
    'Float switch LSHH-101 (high-high), N.C. fail-safe',
    '1 = healthy; 0 when the level is ≥ 97 % (or the wire is broken)',
    'lshh-101',
  ),
  di(5, 'Mixer_Running', 'Agitator M-101 starter auxiliary contact (N.O.)', '1 while the agitator starter is pulled in', 'mixer'),
  di(6, 'Discharge_PB', '800FP-F2PX10 black flush push button (N.O.)', '"Discharge batch": 1 only while pressed', 'pb-discharge'),
  di(7, 'EStop_OK', '800FP-MT44PX02 40 mm twist-to-release E-stop (2 N.C.)', '1 = released; 2nd contact hardwired in the agitator starter circuit', 'estop'),
  {
    operand: 'Local:3:I.Ch0Data',
    alias: 'LT_101',
    dir: 'input',
    signal: 'analog',
    device: 'LT-101 radar level transmitter, 4–20 mA',
    description: '1756-IF8 channel scaled 4–20 mA → 0.0–100.0 % (REAL)',
    units: '%',
    range: [0, 100],
    deviceId: 'lt-101',
  },
  {
    operand: 'Local:3:I.Ch1Data',
    alias: 'TT_101',
    dir: 'input',
    signal: 'analog',
    device: 'TT-101 RTD temperature transmitter, 4–20 mA',
    description: '1756-IF8 channel scaled 4–20 mA → 0.0–150.0 °C (REAL)',
    units: '°C',
    range: [0, 150],
    deviceId: 'tt-101',
  },
  dout(0, 'Fill_Valve', 'XV-101 inlet on/off valve (fail-closed)', 'Open while on: 4.5 %/s inflow', 'xv-101'),
  dout(1, 'Drain_Valve', 'XV-102 outlet on/off valve (fail-closed)', 'Open while on: 5 %/s outflow', 'xv-102'),
  dout(2, 'Mixer', 'Agitator M-101 starter (hardwired through the E-stop)', 'Runs the agitator', 'mixer'),
  dout(3, 'Heater', 'Heater contactor (full power)', 'Heats 1.2 °C/s at 50 % level; never heat below 10 %', 'heater'),
  dout(4, 'Alarm_Horn', '24 V DC alarm horn', 'Audible alarm', 'horn'),
  dout(5, 'Batch_Done_Light', '800F green LED pilot light', 'BATCH DONE', 'light-done'),
  dout(6, 'Running_Light', '800F amber LED pilot light', 'RUNNING', 'light-running'),
  {
    operand: 'Local:4:O.Ch0Data',
    alias: 'FCV_101',
    dir: 'output',
    signal: 'analog',
    device: 'FCV-101 proportional inlet control valve, 4–20 mA positioner',
    description: '0.0–100.0 % opening → up to 4.5 %/s inflow (in parallel with XV-101)',
    units: '%',
    range: [0, 100],
    deviceId: 'fcv-101',
  },
];

const controls: ControlDef[] = [
  { id: 'start', label: 'Start', type: 'momentary', default: false, key: 'S' },
  { id: 'stop', label: 'Stop', type: 'momentary', default: false, key: 'X' },
  { id: 'estop', label: 'E-Stop', type: 'maintained', default: false, description: 'true = mushroom pushed' },
  { id: 'discharge', label: 'Discharge', type: 'momentary', default: false, key: 'D' },
  {
    id: 'lt_fail',
    label: 'LT-101 failed',
    type: 'fault',
    default: false,
    description: 'Open loop: LT_101 reads 0.0, Local:3:I.Ch0Fault and Ch0Underrange turn on',
  },
  { id: 'lsh_fail', label: 'LSH-101 stuck', type: 'fault', default: false, description: 'LSH_101 stuck at 0' },
];

const observables: ObservableDef[] = [
  { id: 'level', label: 'Level', type: 'number', units: '%' },
  { id: 'temperature', label: 'Temperature', type: 'number', units: '°C' },
  { id: 'fillValve', label: 'Fill valve', type: 'boolean' },
  { id: 'drainValve', label: 'Drain valve', type: 'boolean' },
  { id: 'mixerRunning', label: 'Mixer running', type: 'boolean' },
  { id: 'heaterOn', label: 'Heater', type: 'boolean' },
  { id: 'alarmHorn', label: 'Alarm horn', type: 'boolean' },
  { id: 'batchDoneLight', label: 'Batch done light', type: 'boolean' },
  { id: 'runningLight', label: 'Running light', type: 'boolean' },
  { id: 'fcvPosition', label: 'FCV-101 position', type: 'number', units: '%' },
  { id: 'overflow', label: 'Overflowing', type: 'boolean' },
  { id: 'spills', label: 'Spills', type: 'number' },
  { id: 'dryRunMs', label: 'Agitator dry run', type: 'number', units: 'ms' },
  { id: 'dryHeatMs', label: 'Heater dry', type: 'number', units: 'ms' },
  { id: 'batches', label: 'Batches', type: 'number' },
];

const CONTROLS = controlTable(SCENE_ID, controls);

export const tankProcessLogic: SceneLogic<TankProcessState> = {
  id: SCENE_ID,
  title: 'Mixing & Heating Tank',
  summary:
    'A 2000 L mixing tank with inlet, control and outlet valves, an agitator, a heater, level & temperature transmitters and level switches.',
  hardware: {
    platform: 'ControlLogix',
    chassis: '1756-A10',
    powerSupply: '1756-PA75',
    modules: [
      { slot: 0, catalog: '1756-L85E' },
      { slot: 1, catalog: '1756-IB16', name: 'DI_Tank' },
      { slot: 2, catalog: '1756-OB16E', name: 'DO_Tank' },
      { slot: 3, catalog: '1756-IF8', name: 'AI_Tank' },
      { slot: 4, catalog: '1756-OF8', name: 'AO_Tank' },
      { slot: 5, catalog: '1756-EN2T', name: 'ENET_Tank' },
    ],
  },
  io,
  controls,
  observables,

  createState(): TankProcessState {
    return {
      timeMs: 0,
      controls: defaultControls<TankProcessControls>(CONTROLS),
      rng: createRng(0x7a2c),
      level: 0,
      temperature: P.ambientC,
      fillValve: false,
      drainValve: false,
      mixerCommand: false,
      heaterOn: false,
      alarmHorn: false,
      batchDoneLight: false,
      runningLight: false,
      fcvCommand: 0,
      fcvPosition: 0,
      inflowRate: 0,
      outflowRate: 0,
      spillRate: 0,
      fillValveStroke: 0,
      drainValveStroke: 0,
      fcvStroke: 0,
      mixerEnergized: false,
      mixerAux: createDelayedContact(false),
      agitatorRpm: 0,
      agitatorAngle: 0,
      heaterGlow: 0,
      heaterDry: false,
      boiling: false,
      lsl: false,
      lsh: false,
      lshh: true,
      ltReading: 0,
      ttReading: P.ambientC,
      ltChannelFault: false,
      overflow: false,
      overflowQuietMs: 0,
      spills: 0,
      dryRunMs: 0,
      dryHeatMs: 0,
      batches: 0,
      batch: { filled: false, heated: false, mixMs: 0, lastResult: 'none' },
    };
  },

  step(s: TankProcessState, dtMs: number, io: IoAccess): void {
    const dt = dtMs / 1000;
    const c = s.controls;
    s.timeMs += dtMs;

    // --- outputs as seen at the field ---
    s.fillValve = io.readBool('Local:2:O.Data.0');
    s.drainValve = io.readBool('Local:2:O.Data.1');
    s.mixerCommand = io.readBool('Local:2:O.Data.2');
    s.heaterOn = io.readBool('Local:2:O.Data.3');
    s.alarmHorn = io.readBool('Local:2:O.Data.4');
    s.batchDoneLight = io.readBool('Local:2:O.Data.5');
    s.runningLight = io.readBool('Local:2:O.Data.6');
    s.fcvCommand = io.readNumber('Local:4:O.Ch0Data');
    s.fcvPosition = clamp(s.fcvCommand, 0, 100);

    // --- hydraulics ---
    const inflow = P.maxInflow * Math.max(s.fillValve ? 1 : 0, s.fcvPosition / 100);
    const outflow = s.drainValve && s.level > 0 ? Math.min(P.outflow, s.level / dt + inflow) : 0;
    const inAmount = inflow * dt;
    // Incoming water at 15 °C mixes in proportionally.
    if (inAmount > 0 && s.level + inAmount > 0) {
      s.temperature = (s.temperature * s.level + P.inflowTempC * inAmount) / (s.level + inAmount);
    }
    let level = s.level + (inflow - outflow) * dt;
    s.spillRate = 0;
    if (level >= 100 && inflow > outflow) {
      s.spillRate = inflow - outflow;
      level = 100;
    }
    s.level = clamp(level, 0, 100);
    s.inflowRate = inflow;
    s.outflowRate = outflow;
    // One overflow event per episode: a fill valve chattering at the rim (e.g. a rung without
    // hysteresis on a noisy LT) keeps the same event going instead of counting a spill per scan.
    if (s.spillRate > 0) {
      if (!s.overflow) s.spills++;
      s.overflow = true;
      s.overflowQuietMs = 0;
    } else if (s.overflow) {
      s.overflowQuietMs += dtMs;
      if (s.level < P.overflowEndLevel || s.overflowQuietMs >= P.overflowQuietMs) s.overflow = false;
    }

    // --- heater & heat balance ---
    const covered = s.level >= P.lowLevel;
    if (s.heaterOn && covered) s.temperature += P.heaterRate * (50 / Math.max(s.level, 20)) * dt;
    if (s.heaterOn && !covered) s.dryHeatMs += dtMs;
    s.temperature -= P.coolingCoeff * (s.temperature - P.ambientC) * dt;
    s.temperature = Math.min(s.temperature, P.boilingC);
    s.boiling = s.temperature >= P.boilingC - 0.05 && s.level > 0;
    s.heaterDry = s.heaterOn && !covered;
    s.heaterGlow = firstOrder(s.heaterGlow, s.heaterOn ? 1 : 0, dt, 1.5);

    // --- agitator (hardwired: Mixer output AND E-stop released) ---
    s.mixerEnergized = s.mixerCommand && !c.estop;
    stepDelayedContact(s.mixerAux, s.mixerEnergized, dtMs, P.mixerAuxDelayMs, P.mixerAuxDelayMs);
    if (s.mixerEnergized && !covered) s.dryRunMs += dtMs;
    s.agitatorRpm = firstOrder(s.agitatorRpm, s.mixerEnergized ? P.agitatorRpm : 0, dt, s.mixerEnergized ? 0.5 : 0.8);
    if (!s.mixerEnergized && s.agitatorRpm < 0.2) s.agitatorRpm = 0;
    s.agitatorAngle = wrapAngle(s.agitatorAngle + (s.agitatorRpm / 60) * 2 * Math.PI * dt);

    // --- valve stems (visual) ---
    s.fillValveStroke = approach(s.fillValveStroke, s.fillValve ? 1 : 0, dt / 0.4);
    s.drainValveStroke = approach(s.drainValveStroke, s.drainValve ? 1 : 0, dt / 0.4);
    s.fcvStroke = approach(s.fcvStroke, s.fcvPosition / 100, dt / 0.4);

    // --- batch accounting ---
    const b = s.batch;
    if (s.level >= P.batch.fill) b.filled = true;
    if (b.filled && s.temperature >= P.batch.temp) b.heated = true;
    if (s.mixerEnergized && covered) b.mixMs += dtMs;
    if (s.level < P.batch.drained) {
      if (b.filled) {
        const ok = b.heated && b.mixMs >= P.batch.mixMs;
        if (ok) s.batches++;
        b.lastResult = ok ? 'complete' : 'incomplete';
      }
      b.filled = false;
      b.heated = false;
      b.mixMs = 0;
    }

    // --- instruments (noise drawn every step so faults don't disturb the sequence) ---
    const ltNoise = randomRange(s.rng, -P.ltNoise, P.ltNoise);
    const ttNoise = randomRange(s.rng, -P.ttNoise, P.ttNoise);
    s.ltChannelFault = c.lt_fail;
    s.ltReading = c.lt_fail ? 0 : clamp(s.level + ltNoise, 0, 100);
    s.ttReading = clamp(s.temperature + ttNoise, 0, 150);
    s.lsl = s.level >= P.lsl;
    s.lsh = !c.lsh_fail && s.level >= P.lsh;
    s.lshh = s.level < P.lshh; // N.C. fail-safe

    // --- field inputs (every point, every step) ---
    io.writeBool('Local:1:I.Data.0', c.start);
    io.writeBool('Local:1:I.Data.1', !c.stop); // N.C.
    io.writeBool('Local:1:I.Data.2', s.lsl);
    io.writeBool('Local:1:I.Data.3', s.lsh);
    io.writeBool('Local:1:I.Data.4', s.lshh);
    io.writeBool('Local:1:I.Data.5', s.mixerAux.on);
    io.writeBool('Local:1:I.Data.6', c.discharge);
    io.writeBool('Local:1:I.Data.7', !c.estop); // N.C.
    io.writeNumber('Local:3:I.Ch0Data', s.ltReading);
    io.writeNumber('Local:3:I.Ch1Data', s.ttReading);
    // 1756-IF8 channel status: an open 4–20 mA loop (0 mA) is an underrange and a channel fault.
    io.writeBool('Local:3:I.Ch0Fault', s.ltChannelFault);
    io.writeBool('Local:3:I.Ch0Underrange', s.ltChannelFault);
  },

  setControl(s, id, value) {
    writeControl(CONTROLS, s.controls, id, value);
  },

  getControl(s, id) {
    return readControl(CONTROLS, s.controls, id);
  },

  observe(s) {
    return {
      level: s.level,
      temperature: s.temperature,
      fillValve: s.fillValve,
      drainValve: s.drainValve,
      mixerRunning: s.mixerAux.on,
      heaterOn: s.heaterOn,
      alarmHorn: s.alarmHorn,
      batchDoneLight: s.batchDoneLight,
      runningLight: s.runningLight,
      fcvPosition: s.fcvPosition,
      overflow: s.overflow,
      spills: s.spills,
      dryRunMs: s.dryRunMs,
      dryHeatMs: s.dryHeatMs,
      batches: s.batches,
    };
  },
};
