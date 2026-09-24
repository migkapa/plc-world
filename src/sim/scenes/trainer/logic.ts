/**
 * `trainer` — PLC Trainer Bench (ControlLogix). See docs/SCENES.md §1.
 *
 * Classroom bench: eight toggle switches, four 800F push buttons, eight pilot lights, a buzzer, two
 * potentiometers (1756-IF8) and two analog displays (1756-OF8: panel meter + LED bar graph).
 */
import type { ControlDef, IoAccess, IoPointDef, ObservableDef, SceneLogic } from '../../types';
import {
  clamp,
  controlTable,
  defaultControls,
  readControl,
  wrapAngle,
  writeControl,
} from '../../testing/sceneKit';

/** Operator control values (ids as in docs/SCENES.md). */
export interface TrainerControls {
  sw0: boolean;
  sw1: boolean;
  sw2: boolean;
  sw3: boolean;
  sw4: boolean;
  sw5: boolean;
  sw6: boolean;
  sw7: boolean;
  pb_green: boolean;
  /** Pressing the red (N.C.) button makes `PB_Red` read 0. */
  pb_red: boolean;
  pb_black1: boolean;
  pb_black2: boolean;
  /** Potentiometer positions, 0..100 %. */
  pot1: number;
  pot2: number;
}

/** Scene state (also read by the 3D view every frame). Plain JSON data. */
export interface TrainerState {
  /** Simulated time since reset (ms). */
  timeMs: number;
  controls: TrainerControls;
  /** Pilot lights as seen at the field (index 0..7: 0–1 green, 2–3 amber, 4–5 red, 6–7 blue). */
  lights: boolean[];
  /** Panel buzzer energised. */
  buzzer: boolean;
  /** Buzzer diaphragm phase (rad) for a vibration animation. */
  buzzerPhase: number;
  /** Total ms the buzzer has been on. */
  buzzerOnMs: number;
  /** Meter 1 reading as the scale can show it (output clamped 0..100 %). */
  meter1: number;
  /** Bar graph reading (output clamped 0..100 %). */
  meter2: number;
  /** Meter 1 needle position (0..100 %) with a damped moving-coil response (visual only). */
  needle1: number;
  /** Needle velocity (%/s) of the damped movement. */
  needle1Velocity: number;
  /** Lit segments of the 10-segment LED bar graph (0..10). */
  barSegments: number;
  /** Raw analog values driven by the 1756-OF8 (unclamped, for tooltips). */
  meter1Raw: number;
  meter2Raw: number;
}

const SCENE_ID = 'trainer';

const LIGHT_COLORS = ['green', 'green', 'amber', 'amber', 'red', 'red', 'blue', 'blue'] as const;

const io: IoPointDef[] = [
  ...Array.from({ length: 8 }, (_, i): IoPointDef => ({
    operand: `Local:1:I.Data.${i}`,
    alias: `Switch_${i}`,
    dir: 'input',
    signal: 'digital',
    device: `2-position maintained toggle switch ${i}`,
    description: 'Maintained contact: input is 1 while the switch is up (ON)',
    deviceId: `switch-${i}`,
  })),
  {
    operand: 'Local:1:I.Data.8',
    alias: 'PB_Green',
    dir: 'input',
    signal: 'digital',
    device: '800FP-F3PX10 green flush push button (N.O.)',
    description: 'Normally-open: input is 1 only while pressed',
    deviceId: 'pb-green',
  },
  {
    operand: 'Local:1:I.Data.9',
    alias: 'PB_Red',
    dir: 'input',
    signal: 'digital',
    device: '800FP-E4PX01 red extended push button (N.C.)',
    description: 'Normally-closed: input is 1 when NOT pressed, 0 while pressed',
    deviceId: 'pb-red',
  },
  {
    operand: 'Local:1:I.Data.10',
    alias: 'PB_Black_1',
    dir: 'input',
    signal: 'digital',
    device: '800FP-F2PX10 black flush push button (N.O.)',
    description: 'Normally-open: input is 1 only while pressed',
    deviceId: 'pb-black-1',
  },
  {
    operand: 'Local:1:I.Data.11',
    alias: 'PB_Black_2',
    dir: 'input',
    signal: 'digital',
    device: '800FP-F2PX10 black flush push button (N.O.)',
    description: 'Normally-open: input is 1 only while pressed',
    deviceId: 'pb-black-2',
  },
  ...LIGHT_COLORS.map(
    (color, i): IoPointDef => ({
      operand: `Local:2:O.Data.${i}`,
      alias: `Light_${i}`,
      dir: 'output',
      signal: 'digital',
      device: `800F ${color} LED pilot light`,
      description: `Pilot light ${i} (${color}): lit while the output is on`,
      deviceId: `light-${i}`,
    }),
  ),
  {
    operand: 'Local:2:O.Data.8',
    alias: 'Buzzer',
    dir: 'output',
    signal: 'digital',
    device: '24 V DC panel buzzer',
    description: 'Sounds while the output is on',
    deviceId: 'buzzer',
  },
  {
    operand: 'Local:3:I.Ch0Data',
    alias: 'Pot_1',
    dir: 'input',
    signal: 'analog',
    device: '10-turn potentiometer → 4–20 mA signal conditioner',
    description: 'Scaled by the 1756-IF8 channel to 0.0–100.0 % (REAL)',
    units: '%',
    range: [0, 100],
    deviceId: 'pot-1',
  },
  {
    operand: 'Local:3:I.Ch1Data',
    alias: 'Pot_2',
    dir: 'input',
    signal: 'analog',
    device: '10-turn potentiometer → 4–20 mA signal conditioner',
    description: 'Scaled by the 1756-IF8 channel to 0.0–100.0 % (REAL)',
    units: '%',
    range: [0, 100],
    deviceId: 'pot-2',
  },
  {
    operand: 'Local:4:O.Ch0Data',
    alias: 'Meter_1',
    dir: 'output',
    signal: 'analog',
    device: 'Analog panel meter, 4–20 mA movement',
    description: '0.0–100.0 % moves the needle across the scale (values outside peg at the stops)',
    units: '%',
    range: [0, 100],
    deviceId: 'meter-1',
  },
  {
    operand: 'Local:4:O.Ch1Data',
    alias: 'Meter_2',
    dir: 'output',
    signal: 'analog',
    device: '10-segment LED bar graph, 4–20 mA input',
    description: '0.0–100.0 % lights 0–10 segments',
    units: '%',
    range: [0, 100],
    deviceId: 'meter-2',
  },
];

const controls: ControlDef[] = [
  ...Array.from({ length: 8 }, (_, i): ControlDef => ({
    id: `sw${i}`,
    label: `Switch ${i}`,
    type: 'maintained',
    default: false,
    description: `Toggle switch wired to Local:1:I.Data.${i}`,
  })),
  { id: 'pb_green', label: 'Green PB', type: 'momentary', default: false, description: 'N.O. push button' },
  {
    id: 'pb_red',
    label: 'Red PB',
    type: 'momentary',
    default: false,
    description: 'N.C. push button: PB_Red reads 0 while pressed',
  },
  { id: 'pb_black1', label: 'Black PB 1', type: 'momentary', default: false, description: 'N.O. push button' },
  { id: 'pb_black2', label: 'Black PB 2', type: 'momentary', default: false, description: 'N.O. push button' },
  { id: 'pot1', label: 'Pot 1', type: 'analog', default: 0, range: [0, 100], units: '%' },
  { id: 'pot2', label: 'Pot 2', type: 'analog', default: 0, range: [0, 100], units: '%' },
];

const observables: ObservableDef[] = [
  ...LIGHT_COLORS.map(
    (color, i): ObservableDef => ({ id: `light${i}`, label: `Light ${i} (${color})`, type: 'boolean' }),
  ),
  { id: 'buzzer', label: 'Buzzer', type: 'boolean' },
  { id: 'meter1', label: 'Meter 1', type: 'number', units: '%', description: 'Needle reading, clamped 0–100' },
  { id: 'meter2', label: 'Bar graph', type: 'number', units: '%', description: 'Bar reading, clamped 0–100' },
  { id: 'buzzerOnMs', label: 'Buzzer on time', type: 'number', units: 'ms' },
];

const CONTROLS = controlTable(SCENE_ID, controls);
const SWITCH_IDS = ['sw0', 'sw1', 'sw2', 'sw3', 'sw4', 'sw5', 'sw6', 'sw7'] as const;
const SWITCH_OPERANDS = SWITCH_IDS.map((_, i) => `Local:1:I.Data.${i}`);
const LIGHT_OPERANDS = LIGHT_COLORS.map((_, i) => `Local:2:O.Data.${i}`);

/** Damped moving-coil needle: natural frequency (rad/s) and damping ratio (slightly under-damped). */
const NEEDLE_OMEGA = 14;
const NEEDLE_ZETA = 0.65;

export const trainerLogic: SceneLogic<TrainerState> = {
  id: SCENE_ID,
  title: 'PLC Trainer Bench',
  summary:
    'ControlLogix classroom bench: toggle switches, push buttons, pilot lights, a buzzer, potentiometers and analog meters.',
  hardware: {
    platform: 'ControlLogix',
    chassis: '1756-A7',
    powerSupply: '1756-PA72',
    modules: [
      { slot: 0, catalog: '1756-L85E' },
      { slot: 1, catalog: '1756-IB16', name: 'DI_Bench' },
      { slot: 2, catalog: '1756-OB16E', name: 'DO_Bench' },
      { slot: 3, catalog: '1756-IF8', name: 'AI_Bench' },
      { slot: 4, catalog: '1756-OF8', name: 'AO_Bench' },
      { slot: 5, catalog: '1756-EN2T', name: 'ENET_Bench' },
    ],
  },
  io,
  controls,
  observables,

  createState(): TrainerState {
    return {
      timeMs: 0,
      controls: defaultControls<TrainerControls>(CONTROLS),
      lights: [false, false, false, false, false, false, false, false],
      buzzer: false,
      buzzerPhase: 0,
      buzzerOnMs: 0,
      meter1: 0,
      meter2: 0,
      needle1: 0,
      needle1Velocity: 0,
      barSegments: 0,
      meter1Raw: 0,
      meter2Raw: 0,
    };
  },

  step(s: TrainerState, dtMs: number, io: IoAccess): void {
    const dt = dtMs / 1000;
    s.timeMs += dtMs;

    // --- outputs (field side) ---
    for (let i = 0; i < 8; i++) s.lights[i] = io.readBool(LIGHT_OPERANDS[i]!);
    s.buzzer = io.readBool('Local:2:O.Data.8');
    if (s.buzzer) {
      s.buzzerOnMs += dtMs;
      s.buzzerPhase = wrapAngle(s.buzzerPhase + 2 * Math.PI * 400 * dt);
    }
    s.meter1Raw = io.readNumber('Local:4:O.Ch0Data');
    s.meter2Raw = io.readNumber('Local:4:O.Ch1Data');
    s.meter1 = clamp(s.meter1Raw, 0, 100);
    s.meter2 = clamp(s.meter2Raw, 0, 100);
    s.barSegments = Math.round(s.meter2 / 10);

    // Needle: 2nd-order damped movement toward the reading, pegged at the mechanical stops.
    const acc =
      NEEDLE_OMEGA * NEEDLE_OMEGA * (s.meter1 - s.needle1) - 2 * NEEDLE_ZETA * NEEDLE_OMEGA * s.needle1Velocity;
    s.needle1Velocity += acc * dt;
    s.needle1 += s.needle1Velocity * dt;
    if (s.needle1 < 0 || s.needle1 > 100) {
      s.needle1 = clamp(s.needle1, 0, 100);
      s.needle1Velocity = 0;
    }

    // --- inputs (every point, every step) ---
    const c = s.controls;
    for (let i = 0; i < 8; i++) io.writeBool(SWITCH_OPERANDS[i]!, c[SWITCH_IDS[i]!]);
    io.writeBool('Local:1:I.Data.8', c.pb_green);
    io.writeBool('Local:1:I.Data.9', !c.pb_red); // N.C. contact
    io.writeBool('Local:1:I.Data.10', c.pb_black1);
    io.writeBool('Local:1:I.Data.11', c.pb_black2);
    io.writeNumber('Local:3:I.Ch0Data', c.pot1);
    io.writeNumber('Local:3:I.Ch1Data', c.pot2);
  },

  setControl(s, id, value) {
    writeControl(CONTROLS, s.controls, id, value);
  },

  getControl(s, id) {
    return readControl(CONTROLS, s.controls, id);
  },

  observe(s) {
    return {
      light0: s.lights[0]!,
      light1: s.lights[1]!,
      light2: s.lights[2]!,
      light3: s.lights[3]!,
      light4: s.lights[4]!,
      light5: s.lights[5]!,
      light6: s.lights[6]!,
      light7: s.lights[7]!,
      buzzer: s.buzzer,
      meter1: s.meter1,
      meter2: s.meter2,
      buzzerOnMs: s.buzzerOnMs,
    };
  },
};
