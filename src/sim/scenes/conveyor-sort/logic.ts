/**
 * `conveyor-sort` — Box Sorting Conveyor (ControlLogix). See docs/SCENES.md §4.
 *
 * A 6 m belt conveyor: a gravity feeder drops boxes at the infeed, a high photo-eye spots TALL boxes,
 * a pneumatic pusher (5/2 spring-return valve) diverts them into a reject chute, short boxes run off
 * the discharge end onto the good-lane runout. Positions are metres along the belt from the infeed end
 * (`x`), lateral offset toward the reject chute (`lateral`) and height above the belt (`h`).
 */
import type { ControlDef, IoAccess, IoPointDef, ObservableDef, SceneLogic } from '../../types';
import {
  approach,
  controlTable,
  createRng,
  defaultControls,
  nextRandom,
  randomInt,
  readControl,
  writeControl,
  type RngState,
} from '../../testing/sceneKit';

export interface ConveyorSortControls {
  start: boolean;
  stop: boolean;
  estop: boolean;
  /** 0 = AUTO feeder, 1 = PLC feeder (Feeder_Release rising edges). */
  feeder_mode: number;
  /** 0 = random (~35 % tall), 1 = all short, 2 = all tall, 3 = alternate (short first). */
  box_pattern: number;
  /** Fault: PE_Infeed always reads 0. */
  pe_infeed_fail: boolean;
}

export interface ConveyorBox {
  id: number;
  tall: boolean;
  /** Centre position along the belt (m). Beyond the belt end (6.0) the box is on the good-lane runout. */
  x: number;
  /** Lateral offset from the belt centre toward the reject chute (m) while being pushed. */
  lateral: number;
  /** Height of the box bottom above the belt (m) while it drops from the feeder. */
  h: number;
  /** Fall speed (m/s). */
  vy: number;
  /**
   * belt = riding / queued on the belt; diverted = being pushed off by the paddle;
   * chute = sliding down the reject chute; good = rolling out on the good lane.
   */
  state: 'belt' | 'diverted' | 'chute' | 'good';
  /** Held against the extended pusher paddle (a jam). */
  blocked: boolean;
  /** Distance travelled down the reject chute (m). */
  slide: number;
  /** Label / tape variant 0..3 (view). */
  variant: number;
}

/** Photo-eye beam states (true = beam blocked) plus reed switches. */
export interface ConveyorSensors {
  infeed: boolean;
  tall: boolean;
  divert: boolean;
  exit: boolean;
  /** What PE_Infeed actually reports (0 while the `pe_infeed_fail` fault is active). */
  infeedOutput: boolean;
  pusherExtended: boolean;
  pusherRetracted: boolean;
}

/** Scene state (also read by the 3D view every frame). Plain JSON data. */
export interface ConveyorSortState {
  timeMs: number;
  controls: ConveyorSortControls;
  rng: RngState;
  nextBoxId: number;
  /** Conveyor_Run output (motor starter) as driven. */
  conveyorRun: boolean;
  /** Belt surface speed (m/s). */
  beltSpeed: number;
  /** Monotonic belt travel (m) — scroll the belt texture / rollers with it. */
  beltPosition: number;
  /** Drive motor speed (rpm) for the view. */
  motorRpm: number;
  /** Pusher_Extend valve solenoid energised. */
  pusherValve: boolean;
  /** Cylinder extension 0 (retracted) .. 1 (fully extended). */
  pusherPosition: number;
  /** Feeder_Release output as driven. */
  feederRelease: boolean;
  /** ms since the feeder last dropped a box (large before the first drop). */
  sinceDropMs: number;
  /** Next box of the Alternate pattern is tall. */
  alternateNextTall: boolean;
  boxes: ConveyorBox[];
  sensors: ConveyorSensors;
  lightGreen: boolean;
  lightAmber: boolean;
  lightRed: boolean;
  boxesFed: number;
  boxesGood: number;
  boxesRejected: number;
  missorted: number;
  jams: number;
}

/** Conveyor geometry & timing (m, m/s, ms). */
export const CONVEYOR_GEOMETRY = {
  beltLength: 6.0,
  beltWidth: 0.6,
  feederX: 0.3,
  infeedZoneEnd: 1.2,
  peInfeedX: 0.9,
  peTallX: 2.5,
  /** Height of the high photo-eye beam above the belt. */
  tallBeamHeight: 0.3,
  pusherX: 4.0,
  peDivertX: 4.0,
  peExitX: 5.8,
  boxLength: 0.3,
  boxWidth: 0.3,
  shortHeight: 0.2,
  tallHeight: 0.35,
  /** Paddle face width along the belt. */
  paddleWidth: 0.35,
  pusherStroke: 0.6,
  /** A box centre within ±this of the pusher when it passes 60 % is diverted. */
  divertWindow: 0.2,
  beltSpeed: 0.5,
  beltAccel: 2.5,
  extendMs: 250,
  retractMs: 300,
  autoDropIntervalMs: 1200,
  dropHeight: 0.35,
  chuteLength: 1.2,
  runoutLength: 1.2,
  tallProbability: 0.35,
} as const;

const G = CONVEYOR_GEOMETRY;
const HALF_BOX = G.boxLength / 2;
const PADDLE_FACE = G.pusherX - G.paddleWidth / 2;
/** Lateral offset at which a pushed box has left the belt surface. */
const OFF_BELT = G.beltWidth / 2 + G.boxWidth / 2;

const SCENE_ID = 'conveyor-sort';

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
  di(2, 'PE_Infeed', '42EF RightSight photo-eye, retroreflective, dark-operate', '1 = box at the infeed (0.9 m)', 'pe-infeed'),
  di(3, 'PE_Tall', '42EF photo-eye, beam 0.30 m above the belt', '1 = TALL box (0.35 m) at 2.5 m; short boxes pass under', 'pe-tall'),
  di(4, 'PE_Divert', '42EF photo-eye in front of the pusher', '1 = box in front of the pusher (4.0 m)', 'pe-divert'),
  di(5, 'Pusher_Extended', 'Cylinder reed switch, rod end', '1 = cylinder fully extended', 'pusher'),
  di(6, 'Pusher_Retracted', 'Cylinder reed switch, cap end', '1 = cylinder fully retracted', 'pusher'),
  di(7, 'PE_Exit', '42EF photo-eye at the discharge end', '1 = box at the discharge end (5.8 m)', 'pe-exit'),
  di(8, 'EStop_OK', '800FP-MT44PX02 40 mm twist-to-release E-stop (2 N.C.)', '1 = released; 2nd N.C. contact hardwired in the belt starter circuit', 'estop'),
  dout(0, 'Conveyor_Run', 'Belt motor starter (hardwired through the E-stop)', 'Runs the belt at 0.5 m/s', 'motor'),
  dout(1, 'Pusher_Extend', '5/2 single-solenoid spring-return valve', 'On = extend (250 ms), off = spring return (300 ms)', 'pusher'),
  dout(2, 'Feeder_Release', 'Feeder gate solenoid', 'PLC feeder mode: each rising edge releases one box', 'feeder'),
  dout(3, 'Light_Green', '855T stack light — green tier', 'Running', 'stack-light'),
  dout(4, 'Light_Amber', '855T stack light — amber tier', 'Warning / idle', 'stack-light'),
  dout(5, 'Light_Red', '855T stack light — red tier', 'Fault / E-stop', 'stack-light'),
];

const controls: ControlDef[] = [
  { id: 'start', label: 'Start', type: 'momentary', default: false, key: 'S' },
  { id: 'stop', label: 'Stop', type: 'momentary', default: false, key: 'X' },
  { id: 'estop', label: 'E-Stop', type: 'maintained', default: false, description: 'true = mushroom pushed' },
  {
    id: 'feeder_mode',
    label: 'Feeder mode',
    type: 'selector',
    default: 0,
    positions: ['AUTO', 'PLC'],
    description: 'AUTO: feeder drops boxes by itself; PLC: one box per Feeder_Release rising edge',
  },
  {
    id: 'box_pattern',
    label: 'Box pattern',
    type: 'selector',
    default: 0,
    positions: ['Random', 'All short', 'All tall', 'Alternate'],
  },
  { id: 'pe_infeed_fail', label: 'PE_Infeed failed', type: 'fault', default: false, description: 'PE_Infeed always reads 0' },
];

const observables: ObservableDef[] = [
  { id: 'conveyorRunning', label: 'Belt moving', type: 'boolean' },
  { id: 'beltSpeed', label: 'Belt speed', type: 'number', units: 'm/s' },
  { id: 'boxesOnBelt', label: 'Boxes on belt', type: 'number' },
  { id: 'boxesFed', label: 'Boxes fed', type: 'number' },
  { id: 'boxesGood', label: 'Good boxes', type: 'number', description: 'Short boxes delivered to the good lane' },
  { id: 'boxesRejected', label: 'Rejected boxes', type: 'number', description: 'Tall boxes diverted to the chute' },
  { id: 'missorted', label: 'Missorted', type: 'number', description: 'Tall box to good lane or short box rejected' },
  { id: 'jams', label: 'Jams', type: 'number' },
  { id: 'pusherPosition', label: 'Pusher position', type: 'number', description: '0 = retracted, 1 = extended' },
  { id: 'lightGreen', label: 'Green light', type: 'boolean' },
  { id: 'lightAmber', label: 'Amber light', type: 'boolean' },
  { id: 'lightRed', label: 'Red light', type: 'boolean' },
];

const CONTROLS = controlTable(SCENE_ID, controls);

/** A box body (on the belt surface) blocks a photo-eye at `peX`. */
function onBeltAt(b: ConveyorBox, peX: number): boolean {
  const onSurface = b.state === 'belt' || (b.state === 'diverted' && b.lateral < OFF_BELT);
  return onSurface && Math.abs(b.x - peX) < HALF_BOX;
}

function infeedZoneClear(s: ConveyorSortState): boolean {
  for (const b of s.boxes) if (b.state === 'belt' && b.x - HALF_BOX < G.infeedZoneEnd) return false;
  return true;
}

function nextBoxIsTall(s: ConveyorSortState): boolean {
  switch (s.controls.box_pattern) {
    case 1:
      return false;
    case 2:
      return true;
    case 3: {
      const tall = s.alternateNextTall;
      s.alternateNextTall = !tall;
      return tall;
    }
    default:
      return nextRandom(s.rng) < G.tallProbability;
  }
}

function dropBox(s: ConveyorSortState): void {
  s.boxes.push({
    id: s.nextBoxId++,
    tall: nextBoxIsTall(s),
    x: G.feederX,
    lateral: 0,
    h: G.dropHeight,
    vy: 0,
    state: 'belt',
    blocked: false,
    slide: 0,
    variant: randomInt(s.rng, 0, 3),
  });
  s.boxesFed++;
  s.sinceDropMs = 0;
}

export const conveyorSortLogic: SceneLogic<ConveyorSortState> = {
  id: SCENE_ID,
  title: 'Box Sorting Conveyor',
  summary:
    'A 6 m belt conveyor with a gravity feeder, a tall-box photo-eye and a pneumatic pusher that diverts tall boxes to a reject chute.',
  hardware: {
    platform: 'ControlLogix',
    chassis: '1756-A7',
    powerSupply: '1756-PA72',
    modules: [
      { slot: 0, catalog: '1756-L83E' },
      { slot: 1, catalog: '1756-IB16', name: 'DI_Conveyor' },
      { slot: 2, catalog: '1756-OB16E', name: 'DO_Conveyor' },
      { slot: 3, catalog: '1756-EN2T', name: 'ENET_Conveyor' },
    ],
  },
  io,
  controls,
  observables,

  createState(): ConveyorSortState {
    return {
      timeMs: 0,
      controls: defaultControls<ConveyorSortControls>(CONTROLS),
      rng: createRng(0xc0ffee),
      nextBoxId: 1,
      conveyorRun: false,
      beltSpeed: 0,
      beltPosition: 0,
      motorRpm: 0,
      pusherValve: false,
      pusherPosition: 0,
      feederRelease: false,
      sinceDropMs: 1e9,
      alternateNextTall: false,
      boxes: [],
      sensors: {
        infeed: false,
        tall: false,
        divert: false,
        exit: false,
        infeedOutput: false,
        pusherExtended: false,
        pusherRetracted: true,
      },
      lightGreen: false,
      lightAmber: false,
      lightRed: false,
      boxesFed: 0,
      boxesGood: 0,
      boxesRejected: 0,
      missorted: 0,
      jams: 0,
    };
  },

  step(s: ConveyorSortState, dtMs: number, io: IoAccess): void {
    const dt = dtMs / 1000;
    const c = s.controls;
    s.timeMs += dtMs;
    s.sinceDropMs = Math.min(s.sinceDropMs + dtMs, 1e9);

    // --- outputs as seen at the field ---
    s.conveyorRun = io.readBool('Local:2:O.Data.0');
    s.pusherValve = io.readBool('Local:2:O.Data.1');
    const release = io.readBool('Local:2:O.Data.2');
    const releaseEdge = release && !s.feederRelease;
    s.feederRelease = release;
    s.lightGreen = io.readBool('Local:2:O.Data.3');
    s.lightAmber = io.readBool('Local:2:O.Data.4');
    s.lightRed = io.readBool('Local:2:O.Data.5');

    // --- belt drive (hardwired: starter AND E-stop released) ---
    const drive = s.conveyorRun && !c.estop;
    s.beltSpeed = approach(s.beltSpeed, drive ? G.beltSpeed : 0, G.beltAccel * dt);
    s.beltPosition += s.beltSpeed * dt;
    s.motorRpm = (s.beltSpeed / G.beltSpeed) * 1750;

    // --- pusher cylinder ---
    const prevPusher = s.pusherPosition;
    let pos = s.pusherValve ? prevPusher + dtMs / G.extendMs : prevPusher - dtMs / G.retractMs;
    if (pos < 1e-9) pos = 0;
    if (pos > 1 - 1e-9) pos = 1;
    s.pusherPosition = pos;
    const pusher = s.pusherPosition;
    const paddleOut = pusher > 0.3;
    if (prevPusher <= 0.6 && pusher > 0.6) {
      for (const b of s.boxes) {
        if (b.state !== 'belt') continue;
        const off = b.x - G.pusherX;
        if (Math.abs(off) <= G.divertWindow) {
          // Diverted into the reject chute.
          b.state = 'diverted';
          b.blocked = false;
          if (b.tall) s.boxesRejected++;
          else s.missorted++;
        } else if (off < 0 && off > -(HALF_BOX + G.paddleWidth / 2) && !b.blocked) {
          // Paddle caught the box's leading corner: pinned against the belt guide.
          b.blocked = true;
          s.jams++;
        }
      }
    }

    // --- feeder ---
    if (c.feeder_mode === 0) {
      if (s.beltSpeed > 0.01 && s.sinceDropMs >= G.autoDropIntervalMs && infeedZoneClear(s)) dropBox(s);
    } else if (releaseEdge && infeedZoneClear(s)) {
      dropBox(s);
    }

    // --- boxes (array order = drop order = downstream first) ---
    let leaderX = Infinity;
    for (let i = 0; i < s.boxes.length; i++) {
      const b = s.boxes[i]!;
      if (b.state === 'belt') {
        if (b.h > 0) {
          b.vy += 9.81 * dt;
          b.h = Math.max(0, b.h - b.vy * dt);
          if (b.h === 0) b.vy = 0;
        } else if (b.blocked && paddleOut) {
          // Held by the paddle until it retracts.
        } else {
          b.blocked = false;
          let nx = b.x + s.beltSpeed * dt;
          if (paddleOut && b.x + HALF_BOX <= PADDLE_FACE + 1e-9 && nx + HALF_BOX > PADDLE_FACE) {
            nx = PADDLE_FACE - HALF_BOX;
            b.blocked = true;
            s.jams++;
          }
          b.x = Math.min(nx, leaderX - G.boxLength);
        }
        leaderX = b.x;
        if (b.x >= G.beltLength) {
          b.state = 'good';
          if (b.tall) s.missorted++;
          else s.boxesGood++;
        }
      } else if (b.state === 'diverted') {
        b.lateral = Math.max(b.lateral + (s.pusherValve ? 0 : 0.8 * dt), pusher * G.pusherStroke);
        if (b.lateral >= OFF_BELT) {
          b.state = 'chute';
          b.slide = 0;
        }
      } else if (b.state === 'chute') {
        b.slide += 1.2 * dt;
      } else {
        b.x += Math.max(s.beltSpeed, 0.4) * dt;
      }
    }
    for (let i = s.boxes.length - 1; i >= 0; i--) {
      const b = s.boxes[i]!;
      if ((b.state === 'chute' && b.slide >= G.chuteLength) || (b.state === 'good' && b.x >= G.beltLength + G.runoutLength)) {
        s.boxes.splice(i, 1);
      }
    }

    // --- sensors ---
    const sn = s.sensors;
    sn.infeed = sn.tall = sn.divert = sn.exit = false;
    for (const b of s.boxes) {
      if (onBeltAt(b, G.peInfeedX)) sn.infeed = true;
      if (b.tall && b.h < G.tallHeight - G.tallBeamHeight && onBeltAt(b, G.peTallX)) sn.tall = true;
      if (onBeltAt(b, G.peDivertX)) sn.divert = true;
      if (b.state === 'belt' && onBeltAt(b, G.peExitX)) sn.exit = true;
    }
    sn.infeedOutput = sn.infeed && !c.pe_infeed_fail;
    sn.pusherExtended = pusher >= 0.97;
    sn.pusherRetracted = pusher <= 0.03;

    // --- field inputs (every point, every step) ---
    io.writeBool('Local:1:I.Data.0', c.start);
    io.writeBool('Local:1:I.Data.1', !c.stop); // N.C.
    io.writeBool('Local:1:I.Data.2', sn.infeedOutput);
    io.writeBool('Local:1:I.Data.3', sn.tall);
    io.writeBool('Local:1:I.Data.4', sn.divert);
    io.writeBool('Local:1:I.Data.5', sn.pusherExtended);
    io.writeBool('Local:1:I.Data.6', sn.pusherRetracted);
    io.writeBool('Local:1:I.Data.7', sn.exit);
    io.writeBool('Local:1:I.Data.8', !c.estop); // N.C.
  },

  setControl(s, id, value) {
    writeControl(CONTROLS, s.controls, id, value);
  },

  getControl(s, id) {
    return readControl(CONTROLS, s.controls, id);
  },

  observe(s) {
    let onBelt = 0;
    for (const b of s.boxes) if (b.state === 'belt') onBelt++;
    return {
      conveyorRunning: s.beltSpeed > 0.001,
      beltSpeed: s.beltSpeed,
      boxesOnBelt: onBelt,
      boxesFed: s.boxesFed,
      boxesGood: s.boxesGood,
      boxesRejected: s.boxesRejected,
      missorted: s.missorted,
      jams: s.jams,
      pusherPosition: s.pusherPosition,
      lightGreen: s.lightGreen,
      lightAmber: s.lightAmber,
      lightRed: s.lightRed,
    };
  },
};
