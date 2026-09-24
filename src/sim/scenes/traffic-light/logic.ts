/**
 * `traffic-light` — Four-way Intersection (CompactLogix 5380). See docs/SCENES.md §3.
 *
 * Main street North–South (NS), side street East–West (EW), one lane per direction (right-hand
 * traffic, no turns). Cars follow the Intelligent Driver Model (realistic queues and braking), read
 * the signal heads like real drivers (steady / flashing / dark), and physically collide when crossing
 * streams both get a green. Pedestrians cross the main street on the north crosswalk while WALK is lit.
 *
 * Plan coordinates used by the state and the pose helpers (three.js friendly): x = east (m),
 * z = south (m), y up; the intersection centre is the origin. `yaw` is a rotation about +Y for a
 * model whose front faces +X (north-bound cars have yaw = +π/2).
 */
import type { ControlDef, IoAccess, IoPointDef, ObservableDef, SceneLogic } from '../../types';
import {
  clamp,
  controlTable,
  createRng,
  defaultControls,
  nextRandom,
  randomInt,
  randomRange,
  readControl,
  writeControl,
  type RngState,
} from '../../testing/sceneKit';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Direction of travel: north-bound, south-bound (main street), east-bound, west-bound (side street). */
export type Approach = 'NB' | 'SB' | 'EB' | 'WB';
export type Road = 'NS' | 'EW';

/**
 * How drivers interpret a signal head:
 * go = green; yellow = steady yellow (stop if you can); stop = steady red;
 * caution = flashing yellow (proceed, slow); stop-sign = flashing red or dark signal (stop, then go when clear).
 */
export type SignalAspect = 'go' | 'yellow' | 'stop' | 'caution' | 'stop-sign';

export interface TrafficControls {
  ped: boolean;
  night: boolean;
  auto_traffic: boolean;
  spawn_ew: boolean;
  spawn_ns: boolean;
}

export interface TrafficCar {
  id: number;
  approach: Approach;
  /** Distance of the FRONT bumper along the approach path from the spawn point (m). */
  s: number;
  /** m/s */
  speed: number;
  /** Last acceleration (m/s²). */
  accel: number;
  /** Body length (m). */
  length: number;
  /** Colour / body style variant 0..7 (view). */
  variant: number;
  /** Decision at a yellow, red or stop sign (latched until the car passes the stop line or sees green). */
  decision: 'none' | 'go' | 'stop';
  /** ms stopped at the stop line (all-way-stop priority). */
  waitMs: number;
  /** Front bumper has cleared the intersection (counted in carsPassed). */
  passed: boolean;
  /** Visual state; `crashed` cars stand still (spun by `spin`) and are towed after 4 s. */
  state: 'driving' | 'braking' | 'stopped' | 'crashed';
  /** Brake lights lit. */
  braking: boolean;
  /** ms since the crash. */
  crashMs: number;
  /** Extra yaw (rad) from a crash spin. */
  spin: number;
}

export interface Pedestrian {
  id: number;
  /** Plan position (m). */
  x: number;
  z: number;
  /** Walking direction across the main street: +1 = west → east, −1 = east → west. */
  dir: 1 | -1;
  state: 'waiting' | 'crossing' | 'done';
  /** ms in the current state. */
  stateMs: number;
  /** Walking speed (m/s) — faster when hurrying on DON'T WALK. */
  speed: number;
  /** Clothing variant 0..5 (view). */
  variant: number;
}

/** Lamp states as seen at the field. */
export interface TrafficLamps {
  nsRed: boolean;
  nsYellow: boolean;
  nsGreen: boolean;
  ewRed: boolean;
  ewYellow: boolean;
  ewGreen: boolean;
  walk: boolean;
  dontWalk: boolean;
}

/** Edge history of one lamp (used to tell flashing from steady). */
export interface LampTrack {
  on: boolean;
  /** Last two rising edges (ms); a relight after a flicker shorter than 150 ms is not an edge. */
  lastOnEdgeMs: number;
  prevOnEdgeMs: number;
  /** Last falling edge (ms). */
  lastOffMs: number;
}

export interface RoadSignal {
  red: LampTrack;
  yellow: LampTrack;
  green: LampTrack;
  lastLit: 'none' | 'red' | 'yellow' | 'green';
  /** Since when the head has read as a steady yellow (ms), −1 when it does not. */
  yellowSinceMs: number;
  /** How approaching drivers currently read this road's signal head. */
  aspect: SignalAspect;
}

/** Short-lived crash effect (smoke / debris) for the view. */
export interface CrashFx {
  x: number;
  z: number;
  ageMs: number;
}

/** Scene state (also read by the 3D view every frame). Plain JSON data. */
export interface TrafficLightState {
  /** Simulated time since reset (ms). */
  timeMs: number;
  controls: TrafficControls;
  /** Seeded PRNG (spawn times, lanes, car/pedestrian variants). */
  rng: RngState;
  /** Next id for cars and pedestrians. */
  nextId: number;
  /** Lamps as seen at the field (all dark while the controller is not running). */
  lamps: TrafficLamps;
  /** Per-road lamp history and the aspect drivers currently read. */
  signals: { ns: RoadSignal; ew: RoadSignal };
  /** Cars in spawn order (per approach this is also lane order: the leader comes first). */
  cars: TrafficCar[];
  /** Pedestrians waiting at / crossing the north crosswalk, or walking away. */
  pedestrians: Pedestrian[];
  /** Countdown to the next automatic NS / EW car (ms). */
  spawnNsInMs: number;
  spawnEwInMs: number;
  /** Cars requested (auto or spawn_* controls) but not yet placed because the lane entry is occupied. */
  pendingNs: number;
  pendingEw: number;
  /** Ped button presses not yet turned into a pedestrian. */
  pendingPeds: number;
  /** Side of the next pedestrian (+1 = starts on the west kerb). */
  nextPedDir: 1 | -1;
  /** Conflicting lamp combination right now (see `conflicts`). */
  conflict: boolean;
  /** How long the current conflict has lasted (ms). */
  conflictMs: number;
  /** The current conflict has been counted already. */
  conflictCounted: boolean;
  /** Time of the last counted conflict (ms), −1 if none — the view plays the crash animation. */
  lastConflictMs: number;
  conflicts: number;
  /** Physical car-car collisions (conflicting greens, red-light runners without all-red clearance). */
  collisions: number;
  crashFx: CrashFx[];
  /** Cars that cleared the intersection. */
  carsPassed: number;
  /** Side-street cars stopped at / queued behind their stop lines. */
  carsWaitingEW: number;
  /** Loop detector state written to `Car_Sensor_EW`. */
  carSensorEw: boolean;
  /** Pedestrians who reached the far kerb. */
  pedCrossed: number;
}

// ---------------------------------------------------------------------------
// Geometry & driver model
// ---------------------------------------------------------------------------

/** Intersection geometry (plan coordinates, metres). */
export const TRAFFIC_GEOMETRY = {
  /** Each road is 7 m wide: one 3.5 m lane per direction. */
  roadHalfWidth: 3.5,
  laneOffset: 1.75,
  /** Distance from the centre to each stop line. */
  stopLineDist: 8,
  /** North crosswalk across the main street: centre line z, width, kerb-to-kerb walking span ±halfSpan. */
  crosswalkZ: -5.5,
  crosswalkWidth: 3,
  crosswalkHalfSpan: 5,
  /** Cars spawn `approachDist` before the centre and are removed `exitDist` after it. */
  approachDist: 45,
  exitDist: 40,
  /** Loop detector length in front of the EW stop lines. */
  loopLength: 6,
  carWidth: 1.8,
} as const;

const G = TRAFFIC_GEOMETRY;
/** Path coordinate (front bumper) of the stop line / box entry / box exit. */
const STOP_S = G.approachDist - G.stopLineDist;
const BOX_IN_S = G.approachDist - G.roadHalfWidth;
const BOX_OUT_S = G.approachDist + G.roadHalfWidth;
const REMOVE_S = G.approachDist + G.exitDist;

/** Driver model (IDM) parameters. */
export const TRAFFIC_DRIVER = {
  desiredSpeed: 12,
  cautionSpeed: 7,
  maxAccel: 2.0,
  comfortDecel: 3.0,
  maxDecel: 9.0,
  timeHeadway: 1.2,
  minGap: 2.0,
  stopLineGap: 0.3,
  /** Drivers start braking for a stop line / stopped car when the required deceleration reaches this (m/s²). */
  brakeOnsetDecel: 2.5,
  /** Yellow: stop if the required deceleration is at most this (m/s²). */
  yellowStopDecel: 3.5,
  /** Red: a car that would need more than this cannot stop and runs the light. */
  redStopDecel: 7.5,
  /** Minimum stop at a stop sign / dark signal before proceeding (ms). */
  stopSignWaitMs: 1000,
  pedSpeed: 1.4,
  pedHurrySpeed: 2.0,
} as const;
const D = TRAFFIC_DRIVER;

/**
 * Two rising edges of a lamp at most this far apart (and the last one this recent) read as FLASHING.
 * Covers flash rates down to ~19/min, so a 1 s or 1.5 s on/off TON toggle reads as flashing too
 * (MUTCD flashing operation is 50–60 flashes/min).
 */
const FLASH_WINDOW_MS = 3200;
/** A lamp dark for less than this before relighting is a flicker (e.g. one scan), not a flash. */
const FLICKER_MS = 150;
/** A steady lamp that went dark is still read for this long (phase changes, first dark phase of a flash). */
const DARK_HOLD_MS = 1600;
/**
 * A head reading steady yellow for longer than this (stuck yellow, or a flash too slow to recognise)
 * is read as caution (flashing yellow): drivers do not wait at a yellow forever.
 */
const STUCK_YELLOW_MS = 8000;
/** A crossing car past its stop line that needs longer than this to clear the box counts as committed to it. */
const COMMITTED_CLEAR_S = 2.5;
const TOW_MS = 4000;
const MAX_WAITING_PEDS = 6;
const MAX_PENDING = 6;

interface ApproachGeom {
  road: Road;
  dx: number;
  dz: number;
  ox: number;
  oz: number;
  yaw: number;
}

const APPROACHES: Record<Approach, ApproachGeom> = {
  NB: { road: 'NS', dx: 0, dz: -1, ox: G.laneOffset, oz: 0, yaw: Math.PI / 2 },
  SB: { road: 'NS', dx: 0, dz: 1, ox: -G.laneOffset, oz: 0, yaw: -Math.PI / 2 },
  EB: { road: 'EW', dx: 1, dz: 0, ox: 0, oz: G.laneOffset, yaw: 0 },
  WB: { road: 'EW', dx: -1, dz: 0, ox: 0, oz: -G.laneOffset, yaw: Math.PI },
};

/** Road of an approach. */
export function roadOf(approach: Approach): Road {
  return APPROACHES[approach].road;
}

/** Pose of a car's centre in plan coordinates. */
export function trafficCarPose(car: TrafficCar): { x: number; z: number; yaw: number } {
  const a = APPROACHES[car.approach];
  const p = car.s - G.approachDist - car.length / 2;
  return { x: a.ox + a.dx * p, z: a.oz + a.dz * p, yaw: a.yaw + car.spin };
}

/** Pose of a pedestrian (yaw faces the walking direction; waiting pedestrians face the road). */
export function pedestrianPose(p: Pedestrian): { x: number; z: number; yaw: number } {
  const yaw = p.state === 'done' ? Math.PI / 2 : p.dir > 0 ? 0 : Math.PI;
  return { x: p.x, z: p.z, yaw };
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const SCENE_ID = 'traffic-light';

const lampOut = (pt: number, alias: string, device: string, description: string, deviceId: string): IoPointDef => ({
  operand: `Local:2:O.Pt0${pt}.Data`,
  alias,
  dir: 'output',
  signal: 'digital',
  device,
  description,
  deviceId,
});

const io: IoPointDef[] = [
  {
    operand: 'Local:1:I.Pt00.Data',
    alias: 'Ped_PB',
    dir: 'input',
    signal: 'digital',
    device: 'Pedestrian push button (N.O.), north crosswalk',
    description: 'Normally-open: 1 only while a pedestrian presses it — latch the request in logic',
    deviceId: 'ped-button',
  },
  {
    operand: 'Local:1:I.Pt01.Data',
    alias: 'Car_Sensor_EW',
    dir: 'input',
    signal: 'digital',
    device: 'Inductive loop detector, side-street stop lines (EB + WB)',
    description: '1 while at least one EW car is waiting at a stop line',
    deviceId: 'loop-ew',
  },
  {
    operand: 'Local:1:I.Pt02.Data',
    alias: 'Night_Mode',
    dir: 'input',
    signal: 'digital',
    device: 'Maintained key switch in the signal cabinet',
    description: '1 = night flashing mode requested',
    deviceId: 'night-key',
  },
  lampOut(0, 'NS_Red', 'Main street signal head — red LED ball', 'North/south red', 'head-ns'),
  lampOut(1, 'NS_Yellow', 'Main street signal head — yellow LED ball', 'North/south yellow', 'head-ns'),
  lampOut(2, 'NS_Green', 'Main street signal head — green LED ball', 'North/south green', 'head-ns'),
  lampOut(3, 'EW_Red', 'Side street signal head — red LED ball', 'East/west red', 'head-ew'),
  lampOut(4, 'EW_Yellow', 'Side street signal head — yellow LED ball', 'East/west yellow', 'head-ew'),
  lampOut(5, 'EW_Green', 'Side street signal head — green LED ball', 'East/west green', 'head-ew'),
  lampOut(6, 'Walk', 'Pedestrian signal — WALK (white figure)', 'Pedestrians may cross the main street', 'ped-head'),
  lampOut(7, 'Dont_Walk', "Pedestrian signal — DON'T WALK (orange hand)", 'Steady = do not start; flash = clearance', 'ped-head'),
];

const controls: ControlDef[] = [
  { id: 'ped', label: 'Pedestrian button', type: 'momentary', default: false, key: 'P' },
  { id: 'night', label: 'Night mode key', type: 'maintained', default: false },
  {
    id: 'auto_traffic',
    label: 'Automatic traffic',
    type: 'maintained',
    default: true,
    description: 'Random cars: main street every 3–6 s, side street every 6–12 s',
  },
  { id: 'spawn_ew', label: 'Send side-street car', type: 'momentary', default: false },
  { id: 'spawn_ns', label: 'Send main-street car', type: 'momentary', default: false },
];

const observables: ObservableDef[] = [
  { id: 'nsRed', label: 'NS red', type: 'boolean' },
  { id: 'nsYellow', label: 'NS yellow', type: 'boolean' },
  { id: 'nsGreen', label: 'NS green', type: 'boolean' },
  { id: 'ewRed', label: 'EW red', type: 'boolean' },
  { id: 'ewYellow', label: 'EW yellow', type: 'boolean' },
  { id: 'ewGreen', label: 'EW green', type: 'boolean' },
  { id: 'walk', label: 'Walk', type: 'boolean' },
  { id: 'dontWalk', label: "Don't walk", type: 'boolean' },
  {
    id: 'conflict',
    label: 'Signal conflict',
    type: 'boolean',
    description: 'NS and EW both green/yellow, or WALK with NS green/yellow',
  },
  { id: 'conflicts', label: 'Conflicts', type: 'number', description: 'Conflicts lasting ≥ 100 ms' },
  { id: 'carsPassed', label: 'Cars passed', type: 'number' },
  { id: 'carsWaitingEW', label: 'Cars waiting (EW)', type: 'number' },
  { id: 'pedWaiting', label: 'Pedestrian waiting', type: 'boolean' },
  { id: 'pedCrossed', label: 'Pedestrians crossed', type: 'number' },
];

const CONTROLS = controlTable(SCENE_ID, controls);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newLampTrack(): LampTrack {
  return { on: false, lastOnEdgeMs: -1e9, prevOnEdgeMs: -1e9, lastOffMs: -1e9 };
}

function newRoadSignal(): RoadSignal {
  return {
    red: newLampTrack(),
    yellow: newLampTrack(),
    green: newLampTrack(),
    lastLit: 'none',
    yellowSinceMs: -1,
    aspect: 'stop-sign',
  };
}

function trackLamp(t: LampTrack, on: boolean, now: number): void {
  if (on && !t.on) {
    if (now - t.lastOffMs >= FLICKER_MS) {
      t.prevOnEdgeMs = t.lastOnEdgeMs;
      t.lastOnEdgeMs = now;
    }
  } else if (!on && t.on) {
    t.lastOffMs = now;
  }
  t.on = on;
}

function isFlashing(t: LampTrack, now: number): boolean {
  return now - t.lastOnEdgeMs <= FLASH_WINDOW_MS && t.lastOnEdgeMs - t.prevOnEdgeMs <= FLASH_WINDOW_MS;
}

/** Update a road's lamp history and derive the aspect drivers read from it. */
function updateSignal(sig: RoadSignal, red: boolean, yellow: boolean, green: boolean, now: number): void {
  trackLamp(sig.red, red, now);
  trackLamp(sig.yellow, yellow, now);
  trackLamp(sig.green, green, now);
  let lit: RoadSignal['lastLit'] = green ? 'green' : red ? 'red' : yellow ? 'yellow' : 'none';
  if (lit !== 'none') {
    sig.lastLit = lit;
  } else if (
    sig.lastLit !== 'none' &&
    now - sig[sig.lastLit].lastOffMs <= (isFlashing(sig[sig.lastLit], now) ? FLASH_WINDOW_MS : DARK_HOLD_MS)
  ) {
    lit = sig.lastLit; // dark phase of a flashing lamp (or a momentary gap)
  } else {
    sig.lastLit = 'none';
  }
  let aspect: SignalAspect =
    lit === 'green'
      ? 'go'
      : lit === 'yellow'
        ? isFlashing(sig.yellow, now)
          ? 'caution'
          : 'yellow'
        : lit === 'red'
          ? isFlashing(sig.red, now)
            ? 'stop-sign'
            : 'stop'
          : 'stop-sign'; // dark signal = all-way stop
  if (aspect === 'yellow') {
    if (sig.yellowSinceMs < 0) sig.yellowSinceMs = now;
    if (now - sig.yellowSinceMs > STUCK_YELLOW_MS) aspect = 'caution';
  } else {
    sig.yellowSinceMs = -1;
  }
  sig.aspect = aspect;
}

/** IDM interaction term (s_star / gap)^2 for an obstacle `gap` ahead, approached at closing speed `dv`. */
function idmTerm(v: number, gap: number, dv: number, s0: number): number {
  if (gap <= 0.05) return 1e6;
  const sStar = s0 + Math.max(0, v * D.timeHeadway + (v * dv) / (2 * Math.sqrt(D.maxAccel * D.comfortDecel)));
  const r = sStar / gap;
  return r * r;
}

/**
 * Acceleration to stop `s0` short of a stationary obstacle `gap` ahead: none until the required
 * deceleration reaches the brake-onset level, then exactly the constant deceleration that stops there.
 */
function stopAccel(v: number, gap: number, s0: number): number {
  const d = gap - s0;
  if (d <= 0.01) return v > 0.01 ? -D.maxDecel : 0;
  const b = (v * v) / (2 * d);
  return b >= D.brakeOnsetDecel ? -b : Infinity;
}

/** Car centre x or z (plan) without allocating. */
function carCenterX(car: TrafficCar): number {
  const a = APPROACHES[car.approach];
  return a.ox + a.dx * (car.s - G.approachDist - car.length / 2);
}

function carCenterZ(car: TrafficCar): number {
  const a = APPROACHES[car.approach];
  return a.oz + a.dz * (car.s - G.approachDist - car.length / 2);
}

/** Car body overlaps the intersection box. */
function inBox(car: TrafficCar): boolean {
  return car.s > BOX_IN_S && car.s - car.length < BOX_OUT_S;
}

function pedOnRoad(s: TrafficLightState): boolean {
  for (const p of s.pedestrians) {
    if (p.state === 'crossing' && Math.abs(p.x) < G.roadHalfWidth + 0.5) return true;
  }
  return false;
}

function crashedInBox(s: TrafficLightState): boolean {
  for (const c of s.cars) if (c.state === 'crashed' && inBox(c)) return true;
  return false;
}

/**
 * A car beyond its stop line but not yet in the box that is slow enough to still be around when a
 * car starting now would arrive (it needs more than `COMMITTED_CLEAR_S` to clear the box), e.g. a
 * car that has just pulled away from an all-way stop. Fast cars are simply passing through.
 */
function committedToBox(o: TrafficCar): boolean {
  return o.s > STOP_S + 0.05 && o.s <= BOX_IN_S && (BOX_OUT_S + o.length - o.s) / Math.max(o.speed, 0.5) > COMMITTED_CLEAR_S;
}

/** A crossing-street car is in the box or committed to it: drivers do not pull into its path, whatever their signal. */
function crossingOccupied(s: TrafficLightState, car: TrafficCar): boolean {
  const road = roadOf(car.approach);
  for (const o of s.cars) {
    if (o === car || o.state === 'crashed' || roadOf(o.approach) === road) continue;
    if (inBox(o) || committedToBox(o)) return true;
  }
  return false;
}

/**
 * Is the intersection clear of crossing traffic for `car`? `allWayStop` adds stop-sign priority
 * (the crossing car that has waited longer at its line goes first; ties go to the main street).
 */
function crossingClear(s: TrafficLightState, car: TrafficCar, allWayStop: boolean): boolean {
  const road = roadOf(car.approach);
  for (const o of s.cars) {
    if (o === car || roadOf(o.approach) === road || o.state === 'crashed') continue;
    if (inBox(o)) return false;
    if (o.s > STOP_S + 0.05) {
      // Beyond its stop line: committed if still slow (just pulled away), otherwise passing through.
      if (committedToBox(o)) return false;
      continue;
    }
    const dist = BOX_IN_S - o.s;
    if (o.decision === 'go' && dist < 15) return false;
    const sig = road === 'NS' ? s.signals.ew : s.signals.ns;
    if ((sig.aspect === 'go' || sig.aspect === 'caution') && o.speed > 1 && dist / o.speed < 4) return false;
    if (allWayStop && o.waitMs > 0 && (o.waitMs > car.waitMs || (o.waitMs === car.waitMs && road === 'EW'))) {
      return false;
    }
  }
  return true;
}

function spawnCar(s: TrafficLightState, approach: Approach): boolean {
  let tail: TrafficCar | undefined;
  for (const c of s.cars) if (c.approach === approach) tail = c;
  let speed: number = D.desiredSpeed;
  if (tail) {
    const gap = tail.s - tail.length;
    if (gap < 8) return false; // lane entry occupied: keep the car pending
    speed = clamp(Math.min(tail.speed + (gap - 8) * 0.5, D.desiredSpeed), 0, D.desiredSpeed);
  }
  const length = 4.2 + 0.1 * randomInt(s.rng, 0, 6);
  s.cars.push({
    id: s.nextId++,
    approach,
    s: 0,
    speed,
    accel: 0,
    length,
    variant: randomInt(s.rng, 0, 7),
    decision: 'none',
    waitMs: 0,
    passed: false,
    state: 'driving',
    braking: false,
    crashMs: 0,
    spin: 0,
  });
  return true;
}

function trySpawn(s: TrafficLightState, road: Road): boolean {
  const pair: [Approach, Approach] = road === 'NS' ? ['NB', 'SB'] : ['EB', 'WB'];
  const first = nextRandom(s.rng) < 0.5 ? 0 : 1;
  return spawnCar(s, pair[first]!) || spawnCar(s, pair[1 - first]!);
}

function stepCars(s: TrafficLightState, dtMs: number): void {
  const dt = dtMs / 1000;
  const lastByApproach: Record<Approach, TrafficCar | undefined> = { NB: undefined, SB: undefined, EB: undefined, WB: undefined };
  const pedBlocking = pedOnRoad(s);
  const wreckInBox = crashedInBox(s);

  for (const car of s.cars) {
    const leader = lastByApproach[car.approach];
    lastByApproach[car.approach] = car;
    if (car.state === 'crashed') {
      car.crashMs += dtMs;
      car.speed = 0;
      car.accel = 0;
      continue;
    }
    const road = roadOf(car.approach);
    const sig = road === 'NS' ? s.signals.ns : s.signals.ew;
    const v = car.speed;
    let v0: number = D.desiredSpeed;
    let mustStop = false;

    if (car.s <= STOP_S + 0.05) {
      const dist = Math.max(0.01, STOP_S - car.s);
      const need = (v * v) / (2 * dist);
      switch (sig.aspect) {
        case 'go':
          car.decision = 'none';
          break;
        case 'caution':
          car.decision = 'none';
          if (dist < 35) v0 = D.cautionSpeed;
          if (!crossingClear(s, car, false) && need < D.redStopDecel) mustStop = true;
          break;
        case 'yellow':
          if (car.decision === 'none') car.decision = need > D.yellowStopDecel ? 'go' : 'stop';
          mustStop = car.decision === 'stop';
          break;
        case 'stop':
          if (car.decision === 'none') car.decision = need > D.redStopDecel ? 'go' : 'stop';
          mustStop = car.decision === 'stop';
          break;
        case 'stop-sign':
          if (car.decision !== 'go') {
            car.decision = 'stop';
            mustStop = true;
            if (dist < 1.5 && v < 0.3) {
              car.waitMs += dtMs;
              if (car.waitMs >= D.stopSignWaitMs && crossingClear(s, car, true)) {
                car.decision = 'go';
                mustStop = false;
              }
            }
          }
          break;
      }
      // Yield to pedestrians on the crosswalk (main street); never drive into a wreck or into a
      // crossing car already in (or committed to) the box — even on green.
      if (
        !mustStop &&
        ((road === 'NS' && pedBlocking) || wreckInBox || crossingOccupied(s, car)) &&
        need < D.redStopDecel
      ) {
        mustStop = true;
      }
    }

    // Acceleration toward the most restrictive obstacle: IDM behind a moving leader, a
    // constant-deceleration stop (like a real driver) for the stop line or a stopped queue tail.
    const free = Math.max(1 - Math.pow(v / v0, 4), -D.comfortDecel / D.maxAccel);
    let a = D.maxAccel * free;
    if (leader) {
      const gap = leader.s - leader.length - car.s;
      if (leader.speed < 0.5 && leader.accel <= 0.1) a = Math.min(a, stopAccel(v, gap, D.minGap));
      else a = Math.min(a, D.maxAccel * (free - idmTerm(v, gap, v - leader.speed, D.minGap)));
    }
    if (mustStop) a = Math.min(a, stopAccel(v, STOP_S - car.s, D.stopLineGap));
    a = clamp(a, -D.maxDecel, D.maxAccel);
    let vNew = Math.max(0, v + a * dt);
    // Brake hold: a (nearly) stopped driver does not creep up on an obstacle already close ahead.
    const leaderSlack = leader ? leader.s - leader.length - car.s - D.minGap : Infinity;
    const lineSlack = mustStop ? STOP_S - car.s - D.stopLineGap : Infinity;
    if (v < 0.3 && Math.min(leaderSlack, lineSlack) < 0.5) vNew = 0;
    let sNew = car.s + vNew * dt;
    if (leader) {
      const limit = leader.s - leader.length - 0.3;
      if (sNew > limit) {
        sNew = Math.max(car.s, limit);
        vNew = Math.min(vNew, leader.speed);
      }
    }
    if (mustStop && car.s <= STOP_S && sNew > STOP_S) {
      sNew = STOP_S;
      vNew = 0;
    }
    car.accel = (vNew - v) / dt;
    car.speed = vNew;
    car.s = sNew;
    if (vNew > 0.5) car.waitMs = 0;
    if (car.s > STOP_S + 0.05 && car.decision !== 'none') car.decision = 'none';
    car.braking = car.accel < -0.5 || vNew < 0.1;
    car.state = vNew < 0.1 ? 'stopped' : car.accel < -0.5 ? 'braking' : 'driving';
    if (!car.passed && car.s >= BOX_OUT_S) {
      car.passed = true;
      s.carsPassed++;
    }
  }

  // Collisions between crossing streams (bodies are axis-aligned on orthogonal roads).
  const half = G.carWidth / 2;
  for (const a of s.cars) {
    if (roadOf(a.approach) !== 'NS' || a.state === 'crashed' || !inBox(a)) continue;
    const ax = carCenterX(a);
    const az = carCenterZ(a);
    for (const b of s.cars) {
      if (roadOf(b.approach) !== 'EW' || b.state === 'crashed' || !inBox(b)) continue;
      const bx = carCenterX(b);
      const bz = carCenterZ(b);
      if (Math.abs(ax - bx) < half + b.length / 2 && Math.abs(az - bz) < a.length / 2 + half) {
        for (const c of [a, b]) {
          c.state = 'crashed';
          c.speed = 0;
          c.braking = false;
          c.crashMs = 0;
          c.spin = randomRange(s.rng, -0.9, 0.9);
        }
        s.collisions++;
        s.crashFx.push({ x: (ax + bx) / 2, z: (az + bz) / 2, ageMs: 0 });
        break;
      }
    }
  }

  // Remove cars that left the scene or were towed.
  for (let i = s.cars.length - 1; i >= 0; i--) {
    const c = s.cars[i]!;
    if (c.s - c.length > REMOVE_S || (c.state === 'crashed' && c.crashMs >= TOW_MS)) s.cars.splice(i, 1);
  }
}

function stepPedestrians(s: TrafficLightState, dtMs: number): void {
  const dt = dtMs / 1000;
  let waiting = 0;
  for (const p of s.pedestrians) if (p.state === 'waiting') waiting++;
  while (s.pendingPeds > 0) {
    s.pendingPeds--;
    if (waiting >= MAX_WAITING_PEDS) continue;
    const dir = s.nextPedDir;
    s.nextPedDir = dir > 0 ? -1 : 1;
    s.pedestrians.push({
      id: s.nextId++,
      x: -dir * G.crosswalkHalfSpan,
      z: G.crosswalkZ + randomRange(s.rng, -1, 1),
      dir,
      state: 'waiting',
      stateMs: 0,
      speed: 0,
      variant: randomInt(s.rng, 0, 5),
    });
    waiting++;
  }
  for (let i = s.pedestrians.length - 1; i >= 0; i--) {
    const p = s.pedestrians[i]!;
    p.stateMs += dtMs;
    if (p.state === 'waiting') {
      if (s.lamps.walk) {
        p.state = 'crossing';
        p.stateMs = 0;
      }
    } else if (p.state === 'crossing') {
      p.speed = s.lamps.walk ? D.pedSpeed : D.pedHurrySpeed;
      p.x += p.dir * p.speed * dt;
      if (p.dir * p.x >= G.crosswalkHalfSpan) {
        p.x = p.dir * G.crosswalkHalfSpan;
        p.state = 'done';
        p.stateMs = 0;
        s.pedCrossed++;
      }
    } else {
      p.speed = D.pedSpeed;
      p.z -= p.speed * dt; // walk away up the sidewalk
      if (p.stateMs >= 3000) s.pedestrians.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Scene logic
// ---------------------------------------------------------------------------

export const trafficLightLogic: SceneLogic<TrafficLightState> = {
  id: SCENE_ID,
  title: 'Four-way Intersection',
  summary:
    'CompactLogix 5380 traffic signal: main and side street heads, a pedestrian crossing with push button, a side-street loop detector and night flashing mode.',
  hardware: {
    platform: 'CompactLogix',
    modules: [
      { slot: 0, catalog: '5069-L320ER' },
      { slot: 1, catalog: '5069-IB16', name: 'DI_Signal' },
      { slot: 2, catalog: '5069-OB16', name: 'DO_Signal' },
    ],
  },
  io,
  controls,
  observables,

  createState(): TrafficLightState {
    return {
      timeMs: 0,
      controls: defaultControls<TrafficControls>(CONTROLS),
      rng: createRng(0x7ea1f1c),
      nextId: 1,
      lamps: {
        nsRed: false,
        nsYellow: false,
        nsGreen: false,
        ewRed: false,
        ewYellow: false,
        ewGreen: false,
        walk: false,
        dontWalk: false,
      },
      signals: { ns: newRoadSignal(), ew: newRoadSignal() },
      cars: [],
      pedestrians: [],
      spawnNsInMs: 1000,
      spawnEwInMs: 3000,
      pendingNs: 0,
      pendingEw: 0,
      pendingPeds: 0,
      nextPedDir: 1,
      conflict: false,
      conflictMs: 0,
      conflictCounted: false,
      lastConflictMs: -1,
      conflicts: 0,
      collisions: 0,
      crashFx: [],
      carsPassed: 0,
      carsWaitingEW: 0,
      carSensorEw: false,
      pedCrossed: 0,
    };
  },

  step(s: TrafficLightState, dtMs: number, io: IoAccess): void {
    s.timeMs += dtMs;
    const now = s.timeMs;
    const c = s.controls;

    // --- lamps as seen at the field ---
    const L = s.lamps;
    L.nsRed = io.readBool('Local:2:O.Pt00.Data');
    L.nsYellow = io.readBool('Local:2:O.Pt01.Data');
    L.nsGreen = io.readBool('Local:2:O.Pt02.Data');
    L.ewRed = io.readBool('Local:2:O.Pt03.Data');
    L.ewYellow = io.readBool('Local:2:O.Pt04.Data');
    L.ewGreen = io.readBool('Local:2:O.Pt05.Data');
    L.walk = io.readBool('Local:2:O.Pt06.Data');
    L.dontWalk = io.readBool('Local:2:O.Pt07.Data');
    updateSignal(s.signals.ns, L.nsRed, L.nsYellow, L.nsGreen, now);
    updateSignal(s.signals.ew, L.ewRed, L.ewYellow, L.ewGreen, now);

    // --- conflict monitor (like a real conflict monitor unit, 100 ms persistence) ---
    const nsGo = L.nsGreen || L.nsYellow;
    const ewGo = L.ewGreen || L.ewYellow;
    s.conflict = (nsGo && ewGo) || (L.walk && nsGo);
    if (s.conflict) {
      s.conflictMs += dtMs;
      if (!s.conflictCounted && s.conflictMs >= 100 - 1e-9) {
        s.conflictCounted = true;
        s.conflicts++;
        s.lastConflictMs = now;
      }
    } else {
      s.conflictMs = 0;
      s.conflictCounted = false;
    }

    // --- traffic generation ---
    if (c.auto_traffic) {
      s.spawnNsInMs -= dtMs;
      s.spawnEwInMs -= dtMs;
      if (s.spawnNsInMs <= 0) {
        s.pendingNs = Math.min(MAX_PENDING, s.pendingNs + 1);
        s.spawnNsInMs += randomRange(s.rng, 3000, 6000);
      }
      if (s.spawnEwInMs <= 0) {
        s.pendingEw = Math.min(MAX_PENDING, s.pendingEw + 1);
        s.spawnEwInMs += randomRange(s.rng, 6000, 12000);
      }
    }
    if (s.pendingNs > 0 && trySpawn(s, 'NS')) s.pendingNs--;
    if (s.pendingEw > 0 && trySpawn(s, 'EW')) s.pendingEw--;

    stepPedestrians(s, dtMs);
    stepCars(s, dtMs);

    for (let i = s.crashFx.length - 1; i >= 0; i--) {
      const fx = s.crashFx[i]!;
      fx.ageMs += dtMs;
      if (fx.ageMs > TOW_MS) s.crashFx.splice(i, 1);
    }

    // --- detectors ---
    let waitingEw = 0;
    let sensor = false;
    for (const car of s.cars) {
      if (roadOf(car.approach) !== 'EW' || car.state === 'crashed' || car.speed >= 1) continue;
      if (car.s <= STOP_S + 0.5) {
        waitingEw++;
        if (car.s >= STOP_S - G.loopLength) sensor = true;
      }
    }
    s.carsWaitingEW = waitingEw;
    s.carSensorEw = sensor;

    // --- field inputs (every point, every step) ---
    io.writeBool('Local:1:I.Pt00.Data', c.ped);
    io.writeBool('Local:1:I.Pt01.Data', sensor);
    io.writeBool('Local:1:I.Pt02.Data', c.night);
  },

  setControl(s, id, value) {
    const prev = writeControl(CONTROLS, s.controls, id, value);
    const rising = prev === false && readControl(CONTROLS, s.controls, id) === true;
    if (!rising) return;
    if (id === 'ped') s.pendingPeds++;
    else if (id === 'spawn_ns') s.pendingNs = Math.min(MAX_PENDING, s.pendingNs + 1);
    else if (id === 'spawn_ew') s.pendingEw = Math.min(MAX_PENDING, s.pendingEw + 1);
  },

  getControl(s, id) {
    return readControl(CONTROLS, s.controls, id);
  },

  observe(s) {
    const L = s.lamps;
    let pedWaiting = false;
    for (const p of s.pedestrians) if (p.state === 'waiting') pedWaiting = true;
    return {
      nsRed: L.nsRed,
      nsYellow: L.nsYellow,
      nsGreen: L.nsGreen,
      ewRed: L.ewRed,
      ewYellow: L.ewYellow,
      ewGreen: L.ewGreen,
      walk: L.walk,
      dontWalk: L.dontWalk,
      conflict: s.conflict,
      conflicts: s.conflicts,
      carsPassed: s.carsPassed,
      carsWaitingEW: s.carsWaitingEW,
      pedWaiting,
      pedCrossed: s.pedCrossed,
    };
  },
};
