/**
 * `parking-garage` — Parking Garage Gates (CompactLogix 5380). See docs/SCENES.md §6.
 *
 * A 12-space garage with an entry and an exit barrier gate. Cars queue on the entry lane, the driver
 * presses the ticket button, drives through when the arm is up, parks in a numbered space, and later
 * backs out and leaves through the exit gate. Turned-away drivers U-turn in front of the entry.
 *
 * Plan coordinates (three.js friendly): x = east (m), z = south (m, toward the street), y up. Car
 * positions are the CENTRE of the car; `yaw` is a rotation about +Y for a model whose front faces +X
 * (a car driving north, toward the parking deck, has yaw = +π/2). See `GARAGE_LAYOUT`.
 */
import type { ControlDef, IoAccess, IoPointDef, ObservableDef, SceneLogic } from '../../types';
import {
  clamp,
  controlTable,
  createRng,
  defaultControls,
  randomInt,
  randomRange,
  readControl,
  writeControl,
  type RngState,
} from '../../testing/sceneKit';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface GarageSpace {
  /** Stall centre (plan coordinates). */
  x: number;
  z: number;
  /** Yaw of a car parked nose-in. */
  yaw: number;
  /** 'N' = north row (nose north), 'S' = south row (nose south). */
  row: 'N' | 'S';
}

const NORTH_ROW_Z = -12.5;
const SOUTH_ROW_Z = -3.5;
const SPACES: GarageSpace[] = [
  ...[-6.25, -3.75, -1.25, 1.25, 3.75, 6.25].map((x): GarageSpace => ({ x, z: NORTH_ROW_Z, yaw: Math.PI / 2, row: 'N' })),
  ...[-11.25, -8.75, -6.25, 6.25, 8.75, 11.25].map((x): GarageSpace => ({ x, z: SOUTH_ROW_Z, yaw: -Math.PI / 2, row: 'S' })),
];

/** Garage geometry (metres). The view should build its deck, lanes and stalls from these numbers. */
export const GARAGE_LAYOUT = {
  capacity: 12,
  carLength: 4.4,
  carWidth: 1.8,
  /** Lane centre lines: entry lane (north-bound) and exit lane (south-bound); lanes are 3.5 m wide. */
  entryLaneX: -2.5,
  exitLaneX: 2.5,
  laneWidth: 3.5,
  /** Barrier arm / photo-eye line of both gates (the building front). */
  gateZ: 6,
  /** Cars appear on (and leave by) the street here. */
  streetZ: 22,
  /** The entry queue can back up along the approach lane as far as this. */
  queueEndZ: 45,
  /** Car-centre z of a car waiting at the entry gate (front bumper 0.8 m before the gate line). */
  entryWaitZ: 9,
  /** Car-centre z of a car waiting at the exit gate (inside). */
  exitWaitZ: 3,
  /** Vehicle loop rectangles: z range and half width around the lane centre. */
  entryLoop: { z0: 7.2, z1: 10.2 },
  exitLoop: { z0: 1.8, z1: 4.8 },
  loopHalfWidth: 1.5,
  /** Drive aisle between the two stall rows. */
  aisleZ: -8,
  /** 12 numbered spaces (index 0..11 = space numbers 1..12). Stalls are 2.5 m × 5 m. */
  spaces: SPACES,
  stallWidth: 2.5,
  stallDepth: 5,
  /** Barrier arm travel time (s). */
  gateTravelS: 1.5,
  /** The deck floor spans x = ±deckHalfWidth (room for the turn-around loop at the west end of the aisle). */
  deckHalfWidth: 17,
} as const;

const Y = GARAGE_LAYOUT;
const L = Y.carLength;
const ENTRY_GAP = 3.0;
const EXIT_GAP = 1.5;
const LANE_SPEED = 5;
const INTERIOR_SPEED = 5;
const REVERSE_SPEED = 2.5;
const ACCEL = 4;
const DECEL = 4;
/** Length of the exit-lane straight from the aisle to the exit wait point. */
const EXIT_STRAIGHT = Y.exitWaitZ - Y.aisleZ;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GaragePhase =
  | 'arriving' // driving up the entry lane / queued behind other cars
  | 'waiting' // stopped at the entry gate (ticket machine)
  | 'entering' // driving from the gate to its space
  | 'searching' // entered a physically full garage: circles and heads for the exit
  | 'parked'
  | 'backing-out'
  | 'to-exit' // driving to / queued on the exit lane
  | 'exit-waiting' // stopped at the exit gate
  | 'exiting' // driving through the exit gate to the street
  | 'turning-back' // turned away: reversing off the entry apron
  | 'turning-away'; // turned away: U-turn to the street

export interface GarageCar {
  id: number;
  /** Colour / body variant 0..7 (view). */
  variant: number;
  phase: GaragePhase;
  /** Current route polyline of the car centre, flattened [x0, z0, x1, z1, ...], and its length (m). */
  route: number[];
  routeLen: number;
  /** Distance travelled along the route (m). */
  s: number;
  /** m/s along the route. */
  speed: number;
  /** Driving backwards along the route (the nose points against the travel direction). */
  reverse: boolean;
  /** Pose of the car centre (updated every step). */
  x: number;
  z: number;
  yaw: number;
  /** Assigned space index 0..11 (space number = index + 1), −1 if none. */
  space: number;
  /** ms spent in the current phase. */
  phaseMs: number;
  /** The driver is pressing the ticket button right now. */
  pressing: boolean;
  /** Waiting at the entry for more than 8 s with no gate: honks (view/audio). */
  honking: boolean;
  /** Counted inside the garage (passed the entry gate line, not yet out of the exit). */
  inside: boolean;
  /** Parked-time budget before an automatic departure (ms). */
  dwellMs: number;
  /** Time the car parked (ms). */
  parkedAtMs: number;
  /** Wants to leave (dwell elapsed or `spawn_exit`) — order in `leaveSeq`. */
  leaveRequested: boolean;
  leaveSeq: number;
  /** Id of the car directly ahead through the same gate (spacing), 0 = none. */
  followId: number;
  /** Was hit by a barrier arm. */
  dinged: boolean;
  /**
   * Drove in although no space was free (the PLC opened the gate on a full garage): it circles the
   * deck and queues for the exit. Only one such car is let in at a time.
   */
  noSpace: boolean;
}

export interface GarageGate {
  /** Arm position 0 = down .. 1 = up. */
  pos: number;
  /** Output driving the barrier motor (raise while on). */
  command: boolean;
  /** Last car the arm hit (a hit is counted once per car). */
  hitCarId: number;
  /** ms since the last hit (arm bounce animation). */
  bounceMs: number;
}

export interface GarageSensors {
  entryLoop: boolean;
  entryPE: boolean;
  exitLoop: boolean;
  exitPE: boolean;
  ticket: boolean;
}

export interface ParkingGarageControls {
  auto_traffic: boolean;
  spawn_entry: boolean;
  spawn_exit: boolean;
  reset_key: boolean;
  /** Cars parked at start (0..12), applied while the garage is still untouched. */
  initial_cars: number;
}

/** Scene state (also read by the 3D view every frame). Plain JSON data. */
export interface ParkingGarageState {
  /** Simulated time since reset (ms). */
  timeMs: number;
  controls: ParkingGarageControls;
  /** Seeded PRNG (arrivals, dwell times, space choice, car variants). */
  rng: RngState;
  nextId: number;
  /** Every car in the scene: queued, driving, parked or leaving. Poses in `x / z / yaw`. */
  cars: GarageCar[];
  /** Occupant (or reserving) car id per space (0 = free). */
  spaces: number[];
  /** Car ids queued for the entry (front first) and for the exit (front first). */
  entryOrder: number[];
  exitOrder: number[];
  /** Most recent car through each gate (spacing of the next one). */
  lastEnteringId: number;
  lastExitingId: number;
  /** Departure request counter (first requested leaves first). */
  leaveSeq: number;
  /** Arrivals / departures requested but not yet started (lane occupied). */
  pendingEntry: number;
  pendingExit: number;
  /** Countdown to the next automatic arrival (ms). */
  entrySpawnInMs: number;
  entryGate: GarageGate;
  exitGate: GarageGate;
  /** Signs as driven by the PLC. */
  fullSign: boolean;
  openSign: boolean;
  /** Detector states written to the input module. */
  sensors: GarageSensors;
  /** Cars physically inside (between the gate lines), starts at `initial_cars`. */
  carsInside: number;
  gateHits: number;
  carsTurnedAway: number;
  carsEntered: number;
  carsExited: number;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Round the corners of a waypoint polyline with quadratic Bézier fillets (radius ≤ half each segment). */
function fillet(pts: number[], radius = 2.2, samples = 6): number[] {
  const n = pts.length / 2;
  if (n < 3) return pts.slice();
  const out = [pts[0]!, pts[1]!];
  for (let i = 1; i < n - 1; i++) {
    const ax = pts[2 * i - 2]!, az = pts[2 * i - 1]!;
    const px = pts[2 * i]!, pz = pts[2 * i + 1]!;
    const bx = pts[2 * i + 2]!, bz = pts[2 * i + 3]!;
    const l1 = Math.hypot(px - ax, pz - az);
    const l2 = Math.hypot(bx - px, bz - pz);
    const d = Math.min(radius, l1 / 2, l2 / 2);
    const sx = px - ((px - ax) / l1) * d, sz = pz - ((pz - az) / l1) * d;
    const ex = px + ((bx - px) / l2) * d, ez = pz + ((bz - pz) / l2) * d;
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      const u = 1 - t;
      out.push(u * u * sx + 2 * u * t * px + t * t * ex, u * u * sz + 2 * u * t * pz + t * t * ez);
    }
  }
  out.push(pts[2 * n - 2]!, pts[2 * n - 1]!);
  return out;
}

function polylineLength(route: number[]): number {
  let len = 0;
  for (let i = 2; i < route.length; i += 2) len += Math.hypot(route[i]! - route[i - 2]!, route[i + 1]! - route[i - 1]!);
  return len;
}

/** Scratch vectors for the per-step pose math (keeps `step()` allocation-free). */
const P0 = { x: 0, z: 0 };
const P1 = { x: 0, z: 0 };
const P2 = { x: 0, z: 0 };

/** Point at distance `s` along a route (clamped to its ends), written into `out`. */
function pointAt(route: number[], s: number, out: { x: number; z: number }): { x: number; z: number } {
  let rest = Math.max(0, s);
  for (let i = 2; i < route.length; i += 2) {
    const x0 = route[i - 2]!, z0 = route[i - 1]!;
    const dx = route[i]! - x0, dz = route[i + 1]! - z0;
    const seg = Math.hypot(dx, dz);
    if (rest <= seg || i === route.length - 2) {
      const t = seg > 0 ? Math.min(1, rest / seg) : 0;
      out.x = x0 + dx * t;
      out.z = z0 + dz * t;
      return out;
    }
    rest -= seg;
  }
  out.x = route[0]!;
  out.z = route[1]!;
  return out;
}

/**
 * Pose of a car centre computed from its route (yaw from a ±0.6 m chord so fillets turn smoothly);
 * parked cars sit in their stall. `step()` stores the same pose in `car.x / car.z / car.yaw`.
 */
export function garageCarPose(car: GarageCar): { x: number; z: number; yaw: number } {
  const out = { x: 0, z: 0, yaw: 0 };
  computePose(car, out);
  return out;
}

function computePose(car: GarageCar, out: { x: number; z: number; yaw: number }): void {
  if (car.phase === 'parked' && car.space >= 0) {
    const sp = SPACES[car.space]!;
    out.x = sp.x;
    out.z = sp.z;
    out.yaw = sp.yaw;
    return;
  }
  const p = pointAt(car.route, car.s, P0);
  const a = pointAt(car.route, Math.max(0, Math.min(car.s, car.routeLen - 1.2) - 0.6), P1);
  const b = pointAt(car.route, Math.min(car.routeLen, Math.max(car.s, 1.2) + 0.6), P2);
  out.x = p.x;
  out.z = p.z;
  out.yaw = Math.atan2(-(b.z - a.z), b.x - a.x) + (car.reverse ? Math.PI : 0);
}

function setRoute(car: GarageCar, waypoints: number[], reverse: boolean, s = 0): void {
  car.route = waypoints;
  car.routeLen = polylineLength(waypoints);
  car.s = s;
  car.reverse = reverse;
}

/** Entry approach lane from the far end of the queue to the entry gate; new cars appear at `SPAWN_S`. */
const approachRoute = (): number[] => [Y.entryLaneX, Y.queueEndZ, Y.entryLaneX, Y.entryWaitZ];
const SPAWN_S = Y.queueEndZ - Y.streetZ;
const exitRoute = (): number[] => [Y.exitLaneX, Y.exitWaitZ, Y.exitLaneX, Y.streetZ];

function entryRoute(space: number): number[] {
  const sp = SPACES[space]!;
  return fillet([Y.entryLaneX, Y.entryWaitZ, Y.entryLaneX, Y.aisleZ, sp.x, Y.aisleZ, sp.x, sp.z]);
}

/** Circuit of a car that found no space: west along the aisle, loop at the west end, back east (clear of parked noses) to the exit lane. */
function searchRoute(): number[] {
  const a = Y.aisleZ;
  return fillet([
    Y.entryLaneX, Y.entryWaitZ, Y.entryLaneX, a + 1, -13.5, a + 1, -15.5, a + 0.2, -13.5, a - 0.6,
    Y.exitLaneX, a - 0.6, Y.exitLaneX, Y.exitWaitZ,
  ]);
}

function backOutRoute(space: number): number[] {
  const sp = SPACES[space]!;
  const side = sp.x < Y.exitLaneX ? -1 : 1;
  return fillet([sp.x, sp.z, sp.x, Y.aisleZ, sp.x + side * 2.5, Y.aisleZ], 2);
}

function toExitRoute(fromX: number): number[] {
  return fillet([fromX, Y.aisleZ, Y.exitLaneX, Y.aisleZ, Y.exitLaneX, Y.exitWaitZ]);
}

const TURN_Z = Y.entryWaitZ + 2;
const turnBackRoute = (): number[] => [Y.entryLaneX, Y.entryWaitZ, Y.entryLaneX, TURN_Z];
const U_TURN_R = (Y.exitLaneX - Y.entryLaneX) / 2;

/** Half-circle U-turn in front of the gates (toward the building), then out along the exit lane. */
function turnAwayRoute(): number[] {
  const cx = (Y.exitLaneX + Y.entryLaneX) / 2;
  const out: number[] = [];
  for (let k = 0; k <= 12; k++) {
    const th = Math.PI - (Math.PI * k) / 12;
    out.push(cx + U_TURN_R * Math.cos(th), TURN_Z - U_TURN_R * Math.sin(th));
  }
  out.push(Y.exitLaneX, Y.streetZ);
  return out;
}

/** Route length of the U-turn arc (after it the car heads south on the exit lane). */
const U_TURN_ARC_LEN = polylineLength(turnAwayRoute().slice(0, 26));
/**
 * While a turned-away car is in its U-turn arc, southbound cars on the exit lane keep their centre
 * at or north of this (front bumper ~2 m short of the arc apex, i.e. just past the exit gate line).
 */
const U_TURN_HOLD_Z = TURN_Z - U_TURN_R - 2 - L / 2;

// Aisle right-of-way: cars driving in (entering / searching) and cars leaving (backing out, then
// along the aisle to the exit lane) never use the drive aisle at the same time.
/**
 * Entering / searching cars wait at this route distance while the aisle is busy: centre 4.8 m short
 * of the aisle centre line, clear of a car swinging out of the stalls next to the entry lane.
 */
const AISLE_HOLD_S = Y.entryWaitZ - (Y.aisleZ + 4.8);
/** A car on the exit lane with less than this left to the exit wait point is clear of the aisle. */
const EXIT_AISLE_CLEAR = Y.exitWaitZ - (Y.aisleZ + L / 2 + Y.carWidth / 2 + 0.5);

/** Axis-aligned half extent of a car body along x (`alongX`) or z at `yaw`. */
function halfExtent(yaw: number, alongX: boolean): number {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return alongX ? c * (L / 2) + s * (Y.carWidth / 2) : s * (L / 2) + c * (Y.carWidth / 2);
}

function overlapsRect(car: GarageCar, x0: number, x1: number, z0: number, z1: number): boolean {
  const hx = halfExtent(car.yaw, true);
  const hz = halfExtent(car.yaw, false);
  return car.x + hx > x0 && car.x - hx < x1 && car.z + hz > z0 && car.z - hz < z1;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const SCENE_ID = 'parking-garage';

const pt = (dir: 'I' | 'O', n: number): string => `Local:${dir === 'I' ? 1 : 2}:${dir}.Pt0${n}.Data`;

const io: IoPointDef[] = [
  { operand: pt('I', 0), alias: 'Entry_Loop', dir: 'input', signal: 'digital', device: 'Inductive vehicle loop detector, entry lane', description: '1 while a vehicle is on the loop in front of the entry gate', deviceId: 'loop-entry' },
  { operand: pt('I', 1), alias: 'Entry_PE', dir: 'input', signal: 'digital', device: 'Retroreflective photo-eye under the entry barrier', description: '1 while a vehicle is passing under the entry arm', deviceId: 'pe-entry' },
  { operand: pt('I', 2), alias: 'Exit_Loop', dir: 'input', signal: 'digital', device: 'Inductive vehicle loop detector, exit lane', description: '1 while a vehicle is on the loop in front of the exit gate', deviceId: 'loop-exit' },
  { operand: pt('I', 3), alias: 'Exit_PE', dir: 'input', signal: 'digital', device: 'Retroreflective photo-eye under the exit barrier', description: '1 while a vehicle is passing under the exit arm', deviceId: 'pe-exit' },
  { operand: pt('I', 4), alias: 'Ticket_PB', dir: 'input', signal: 'digital', device: 'Ticket dispenser push button (N.O.)', description: 'Pressed by drivers: 1 for 0.3 s, repeated every 4 s while waiting', deviceId: 'ticket' },
  { operand: pt('I', 5), alias: 'Reset_Key', dir: 'input', signal: 'digital', device: 'Attendant key switch, spring return (momentary)', description: '1 while the attendant turns the key', deviceId: 'reset-key' },
  { operand: pt('O', 0), alias: 'Entry_Gate_Up', dir: 'output', signal: 'digital', device: 'Entry barrier gate operator', description: 'Arm rises while on (1.5 s), lowers when off', deviceId: 'gate-entry' },
  { operand: pt('O', 1), alias: 'Exit_Gate_Up', dir: 'output', signal: 'digital', device: 'Exit barrier gate operator', description: 'Arm rises while on (1.5 s), lowers when off', deviceId: 'gate-exit' },
  { operand: pt('O', 2), alias: 'Full_Sign', dir: 'output', signal: 'digital', device: 'Red LED "FULL" sign', description: 'Garage full', deviceId: 'sign' },
  { operand: pt('O', 3), alias: 'Open_Sign', dir: 'output', signal: 'digital', device: 'Green LED "SPACES" sign', description: 'Spaces available', deviceId: 'sign' },
];

const controls: ControlDef[] = [
  {
    id: 'auto_traffic',
    label: 'Automatic traffic',
    type: 'maintained',
    default: true,
    description: 'Cars arrive every 6–10 s and leave after 40–90 s parked',
  },
  { id: 'spawn_entry', label: 'Car arrives', type: 'momentary', default: false, description: 'A car drives up to the entry gate' },
  { id: 'spawn_exit', label: 'Car leaves', type: 'momentary', default: false, description: 'The longest-parked car drives to the exit' },
  { id: 'reset_key', label: 'Attendant key', type: 'momentary', default: false },
  {
    id: 'initial_cars',
    label: 'Cars parked at start',
    type: 'analog',
    default: 0,
    range: [0, 12],
    units: 'cars',
    description: 'Applied on reset (immediately while the garage has had no traffic yet)',
  },
];

const observables: ObservableDef[] = [
  { id: 'carsInside', label: 'Cars inside', type: 'number' },
  { id: 'capacity', label: 'Capacity', type: 'number' },
  { id: 'entryGateUp', label: 'Entry gate up', type: 'boolean', description: 'Arm ≥ 90 % open' },
  { id: 'exitGateUp', label: 'Exit gate up', type: 'boolean', description: 'Arm ≥ 90 % open' },
  { id: 'entryGatePos', label: 'Entry arm', type: 'number', description: '0 = down, 1 = up' },
  { id: 'exitGatePos', label: 'Exit arm', type: 'number', description: '0 = down, 1 = up' },
  { id: 'fullSign', label: 'FULL sign', type: 'boolean' },
  { id: 'openSign', label: 'SPACES sign', type: 'boolean' },
  { id: 'gateHits', label: 'Gate hits', type: 'number', description: 'Arm lowered onto a car' },
  { id: 'carsTurnedAway', label: 'Cars turned away', type: 'number' },
  { id: 'carsEntered', label: 'Cars entered', type: 'number' },
  { id: 'carsExited', label: 'Cars exited', type: 'number' },
  { id: 'carsWaitingEntry', label: 'Cars waiting (entry)', type: 'number' },
  { id: 'carsWaitingExit', label: 'Cars waiting (exit)', type: 'number' },
];

const CONTROLS = controlTable(SCENE_ID, controls);

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

function byId(s: ParkingGarageState, id: number): GarageCar | undefined {
  for (const c of s.cars) if (c.id === id) return c;
  return undefined;
}

function newCar(s: ParkingGarageState, phase: GaragePhase): GarageCar {
  return {
    id: s.nextId++,
    variant: randomInt(s.rng, 0, 7),
    phase,
    route: [],
    routeLen: 0,
    s: 0,
    speed: 0,
    reverse: false,
    x: 0,
    z: 0,
    yaw: 0,
    space: -1,
    phaseMs: 0,
    pressing: false,
    honking: false,
    inside: false,
    dwellMs: 0,
    parkedAtMs: 0,
    leaveRequested: false,
    leaveSeq: 0,
    followId: 0,
    dinged: false,
    noSpace: false,
  };
}

function updatePose(car: GarageCar): void {
  computePose(car, car);
}

function park(s: ParkingGarageState, car: GarageCar, space: number): void {
  const sp = SPACES[space]!;
  car.phase = 'parked';
  car.space = space;
  s.spaces[space] = car.id;
  car.route = [];
  car.routeLen = 0;
  car.s = 0;
  car.speed = 0;
  car.reverse = false;
  car.x = sp.x;
  car.z = sp.z;
  car.yaw = sp.yaw;
  car.phaseMs = 0;
  car.parkedAtMs = s.timeMs;
  car.dwellMs = randomRange(s.rng, 40_000, 90_000);
}

/** Replace the parked cars by `n` cars in random spaces (only while the garage is untouched). */
function populate(s: ParkingGarageState, n: number): void {
  for (let i = s.cars.length - 1; i >= 0; i--) {
    const c = s.cars[i]!;
    if (c.phase === 'parked') {
      s.spaces[c.space] = 0;
      s.cars.splice(i, 1);
      s.carsInside--;
    }
  }
  const free: number[] = [];
  for (let i = 0; i < s.spaces.length; i++) if (s.spaces[i] === 0) free.push(i);
  for (let k = 0; k < n && free.length > 0; k++) {
    const pick = free.splice(randomInt(s.rng, 0, free.length - 1), 1)[0]!;
    const car = newCar(s, 'parked');
    car.inside = true;
    park(s, car, pick);
    s.cars.push(car);
    s.carsInside++;
  }
}

function pristine(s: ParkingGarageState): boolean {
  if (s.carsEntered + s.carsExited + s.carsTurnedAway > 0) return false;
  for (const c of s.cars) if (c.inside && c.phase !== 'parked') return false;
  return true;
}

/** Garage physically full: cars inside plus cars already driving in under the arm. */
function physicallyFull(s: ParkingGarageState): boolean {
  let n = s.carsInside;
  for (const c of s.cars) if (!c.inside && (c.phase === 'entering' || c.phase === 'searching')) n++;
  return n >= Y.capacity;
}

/** Move `car` along its route toward `limit` (route distance), accelerating/braking kinematically. */
function advance(car: GarageCar, dt: number, vmax: number, limit: number): void {
  const dist = limit - car.s;
  const vStop = dist > 0 ? Math.sqrt(2 * DECEL * dist) : 0;
  let v = Math.max(0, Math.min(car.speed + ACCEL * dt, vmax, vStop));
  let ns = car.s + v * dt;
  if (ns >= limit) {
    ns = Math.max(car.s, limit);
    v = 0;
  }
  car.s = ns;
  car.speed = v;
}

function startEntering(s: ParkingGarageState, car: GarageCar, s0: number): void {
  s.entryOrder.splice(s.entryOrder.indexOf(car.id), 1);
  const free: number[] = [];
  for (let i = 0; i < s.spaces.length; i++) if (s.spaces[i] === 0) free.push(i);
  const ahead = byId(s, s.lastEnteringId);
  car.followId = ahead && (ahead.phase === 'entering' || ahead.phase === 'searching') ? ahead.id : 0;
  s.lastEnteringId = car.id;
  car.pressing = false;
  car.honking = false;
  car.phaseMs = 0;
  if (free.length > 0) {
    const space = free[randomInt(s.rng, 0, free.length - 1)]!;
    s.spaces[space] = car.id;
    car.space = space;
    car.phase = 'entering';
    setRoute(car, entryRoute(space), false, s0);
  } else {
    car.phase = 'searching';
    car.noSpace = true;
    setRoute(car, searchRoute(), false, s0);
  }
}

function startExiting(s: ParkingGarageState, car: GarageCar, s0: number): void {
  s.exitOrder.splice(s.exitOrder.indexOf(car.id), 1);
  const ahead = byId(s, s.lastExitingId);
  car.followId = ahead && ahead.phase === 'exiting' ? ahead.id : 0;
  s.lastExitingId = car.id;
  car.phase = 'exiting';
  car.phaseMs = 0;
  setRoute(car, exitRoute(), false, s0);
}

function canStartLeaving(s: ParkingGarageState): boolean {
  if (s.exitOrder.length >= 2) return false;
  for (const c of s.cars) {
    if (c.phase === 'backing-out' || c.phase === 'searching') return false;
    if (c.phase === 'to-exit' && c.routeLen - c.s > EXIT_STRAIGHT) return false;
    // A car driving in has (or is about to take) the aisle.
    if (c.phase === 'entering' && c.s >= AISLE_HOLD_S - 3.5) return false;
  }
  return true;
}

/**
 * Highest centre z a southbound car on the exit lane, now at `z`, may drive to: it waits just past
 * the exit gate while a turned-away car U-turns across the lane, then follows it out.
 */
function exitLaneZMax(s: ParkingGarageState, z: number): number {
  let zMax = Infinity;
  for (const c of s.cars) {
    if (c.phase !== 'turning-away') continue;
    if (c.s < U_TURN_ARC_LEN) {
      if (z <= U_TURN_HOLD_Z + 0.01) zMax = Math.min(zMax, U_TURN_HOLD_Z);
    } else if (z < c.z) {
      zMax = Math.min(zMax, c.z - L - EXIT_GAP);
    }
  }
  return zMax;
}

/**
 * Limit (route distance) that keeps a car behind `ahead`, which drove off the start of the same gate
 * straight a moment earlier; `base` is where that straight starts on the follower's route.
 */
function spacingLimit(ahead: GarageCar | undefined, base: number, phase: GaragePhase, alt: GaragePhase = phase): number {
  if (!ahead || (ahead.phase !== phase && ahead.phase !== alt) || ahead.s > 15) return Infinity;
  return base + ahead.s - (L + 1.5);
}

function stepCars(s: ParkingGarageState, dtMs: number): void {
  const dt = dtMs / 1000;
  const entryUp = s.entryGate.pos >= 0.9;
  const exitUp = s.exitGate.pos >= 0.9;
  let turnaround = false;
  let aisleOut = false; // a leaving car is backing out or still driving along the aisle
  let exitBusy = false; // a leaving car is (about to be) where a U-turn would cross the exit lane
  for (const c of s.cars) {
    if (c.phase === 'turning-back' || (c.phase === 'turning-away' && c.s < 8)) turnaround = true;
    if (c.phase === 'backing-out' || (c.phase === 'to-exit' && c.routeLen - c.s > EXIT_AISLE_CLEAR)) aisleOut = true;
    if (c.phase === 'exiting' && c.z - L / 2 < TURN_Z + 1) exitBusy = true;
    if (exitUp && (c.phase === 'exit-waiting' || (c.phase === 'to-exit' && c.speed > 0 && s.exitOrder[0] === c.id))) {
      exitBusy = true;
    }
  }
  const full = physicallyFull(s);
  // A full garage lets in at most one car without a space at a time (it circles and leaves again);
  // every other driver keeps waiting at the gate and is turned away after 5 s.
  let noSpaceCars = 0;
  for (const c of s.cars) if (c.noSpace) noSpaceCars++;
  let canEnter = !full || noSpaceCars === 0;

  for (const car of s.cars) {
    car.phaseMs += dtMs;
    switch (car.phase) {
      case 'arriving': {
        const idx = s.entryOrder.indexOf(car.id);
        let limit = car.routeLen;
        if (idx > 0) {
          const leader = byId(s, s.entryOrder[idx - 1]!)!;
          limit = leader.s - (L + ENTRY_GAP);
        } else {
          // Hold back while a turned-away car reverses / U-turns on the apron (≈ 1 m bumper gap).
          if (turnaround) limit = car.routeLen - (TURN_Z - Y.entryWaitZ + L + 1);
          else if (entryUp && canEnter) {
            const ahead = byId(s, s.lastEnteringId);
            limit = Math.min(car.routeLen + 50, spacingLimit(ahead, car.routeLen, 'entering', 'searching'));
          }
        }
        advance(car, dt, LANE_SPEED, limit);
        if (idx === 0 && car.s >= car.routeLen - 1e-6) {
          if (entryUp && !turnaround && canEnter && car.speed > 0) {
            startEntering(s, car, car.s - car.routeLen);
            if (car.noSpace) canEnter = false;
          } else if (car.speed === 0) {
            car.phase = 'waiting';
            car.phaseMs = 0;
          }
        }
        break;
      }
      case 'waiting': {
        car.pressing = car.phaseMs >= 800 && (car.phaseMs - 800) % 4000 < 300;
        car.honking = car.phaseMs > 8000 && !full;
        if (entryUp && !turnaround && canEnter) {
          startEntering(s, car, 0);
          if (car.noSpace) canEnter = false;
        } else if (full && car.phaseMs >= 5000) {
          s.entryOrder.splice(s.entryOrder.indexOf(car.id), 1);
          s.carsTurnedAway++;
          car.phase = 'turning-back';
          car.phaseMs = 0;
          car.pressing = false;
          car.honking = false;
          setRoute(car, turnBackRoute(), true);
        }
        break;
      }
      case 'entering':
      case 'searching': {
        let limit = Math.min(car.routeLen, spacingLimit(byId(s, car.followId), 0, 'entering', 'searching'));
        // Wait short of the aisle while a leaving car uses it.
        if (aisleOut && car.s <= AISLE_HOLD_S + 0.01) limit = Math.min(limit, AISLE_HOLD_S);
        if (car.phase === 'searching' && s.exitOrder.length > 0) {
          // Both routes end at the exit wait point: stay behind the tail of the exit queue.
          const tail = byId(s, s.exitOrder[s.exitOrder.length - 1]!);
          if (tail) limit = Math.min(limit, car.routeLen - (tail.routeLen - tail.s + L + EXIT_GAP));
        }
        advance(car, dt, INTERIOR_SPEED, limit);
        if (car.phase === 'entering' && car.s >= car.routeLen - 1e-6) {
          park(s, car, car.space);
        } else if (car.phase === 'searching' && car.routeLen - car.s <= EXIT_STRAIGHT) {
          car.phase = 'to-exit';
          car.phaseMs = 0;
          s.exitOrder.push(car.id);
        }
        break;
      }
      case 'parked': {
        if (s.controls.auto_traffic && !car.leaveRequested) {
          car.dwellMs -= dtMs;
          if (car.dwellMs <= 0) {
            car.leaveRequested = true;
            car.leaveSeq = ++s.leaveSeq;
          }
        }
        break;
      }
      case 'backing-out': {
        advance(car, dt, REVERSE_SPEED, car.routeLen);
        if (car.s >= car.routeLen - 1e-6) {
          const end = car.route[car.route.length - 2]!;
          car.phase = 'to-exit';
          car.phaseMs = 0;
          setRoute(car, toExitRoute(end), false);
          s.exitOrder.push(car.id);
        }
        break;
      }
      case 'to-exit': {
        const idx = s.exitOrder.indexOf(car.id);
        let limit = car.routeLen;
        if (idx > 0) {
          const leader = byId(s, s.exitOrder[idx - 1]!)!;
          limit = car.routeLen - (leader.routeLen - leader.s + L + EXIT_GAP);
        } else if (exitUp) {
          limit = Math.min(car.routeLen + 50, spacingLimit(byId(s, s.lastExitingId), car.routeLen, 'exiting'));
          limit = Math.min(limit, car.routeLen + exitLaneZMax(s, car.z) - Y.exitWaitZ);
        }
        advance(car, dt, INTERIOR_SPEED, limit);
        if (idx === 0 && car.s >= car.routeLen - 1e-6) {
          if (exitUp && car.speed > 0) startExiting(s, car, car.s - car.routeLen);
          else if (car.speed === 0) {
            car.phase = 'exit-waiting';
            car.phaseMs = 0;
          }
        }
        break;
      }
      case 'exit-waiting': {
        if (exitUp) startExiting(s, car, 0);
        break;
      }
      case 'exiting': {
        let limit = Math.min(car.routeLen, spacingLimit(byId(s, car.followId), 0, 'exiting'));
        limit = Math.min(limit, exitLaneZMax(s, car.z) - Y.exitWaitZ);
        advance(car, dt, LANE_SPEED, limit);
        break;
      }
      case 'turning-back': {
        advance(car, dt, REVERSE_SPEED, car.routeLen);
        // Start the U-turn across the exit lane only when no leaving car is coming out.
        if (car.s >= car.routeLen - 1e-6 && !exitBusy) {
          car.phase = 'turning-away';
          car.phaseMs = 0;
          setRoute(car, turnAwayRoute(), false);
        }
        break;
      }
      case 'turning-away': {
        advance(car, dt, 3.5, car.routeLen);
        break;
      }
    }
  }
}

function stepGate(
  s: ParkingGarageState,
  g: GarageGate,
  command: boolean,
  dtMs: number,
  underId: number,
): void {
  g.command = command;
  g.bounceMs += dtMs;
  g.pos = clamp(g.pos + (command ? dtMs : -dtMs) / (Y.gateTravelS * 1000), 0, 1);
  if (underId !== 0 && !command) {
    if (g.pos < 1 && g.hitCarId !== underId) {
      // The arm came down on a car: count it once, the arm bounces up off the roof.
      g.hitCarId = underId;
      g.bounceMs = 0;
      g.pos = Math.min(1, g.pos + 0.3);
      s.gateHits++;
      const car = byId(s, underId);
      if (car) car.dinged = true;
    }
    g.pos = Math.max(g.pos, 0.55); // resting on the roof until the car is through
  }
}

// ---------------------------------------------------------------------------
// Scene logic
// ---------------------------------------------------------------------------

export const parkingGarageLogic: SceneLogic<ParkingGarageState> = {
  id: SCENE_ID,
  title: 'Parking Garage Gates',
  summary:
    'CompactLogix 5380 parking garage: 12 spaces, entry and exit barrier gates, loop detectors, photo-eyes, a ticket button and FULL / SPACES signs.',
  hardware: {
    platform: 'CompactLogix',
    modules: [
      { slot: 0, catalog: '5069-L320ER' },
      { slot: 1, catalog: '5069-IB16', name: 'DI_Gates' },
      { slot: 2, catalog: '5069-OB16', name: 'DO_Gates' },
    ],
  },
  io,
  controls,
  observables,

  createState(): ParkingGarageState {
    return {
      timeMs: 0,
      controls: defaultControls<ParkingGarageControls>(CONTROLS),
      rng: createRng(0x9a4a6e),
      nextId: 1,
      cars: [],
      spaces: SPACES.map(() => 0),
      entryOrder: [],
      exitOrder: [],
      lastEnteringId: 0,
      lastExitingId: 0,
      leaveSeq: 0,
      pendingEntry: 0,
      pendingExit: 0,
      entrySpawnInMs: 2000,
      entryGate: { pos: 0, command: false, hitCarId: 0, bounceMs: 1e9 },
      exitGate: { pos: 0, command: false, hitCarId: 0, bounceMs: 1e9 },
      fullSign: false,
      openSign: false,
      sensors: { entryLoop: false, entryPE: false, exitLoop: false, exitPE: false, ticket: false },
      carsInside: 0,
      gateHits: 0,
      carsTurnedAway: 0,
      carsEntered: 0,
      carsExited: 0,
    };
  },

  step(s: ParkingGarageState, dtMs: number, io: IoAccess): void {
    s.timeMs += dtMs;
    const c = s.controls;

    // --- outputs as seen at the field ---
    const entryCmd = io.readBool('Local:2:O.Pt00.Data');
    const exitCmd = io.readBool('Local:2:O.Pt01.Data');
    s.fullSign = io.readBool('Local:2:O.Pt02.Data');
    s.openSign = io.readBool('Local:2:O.Pt03.Data');

    // --- traffic generation ---
    if (c.auto_traffic) {
      s.entrySpawnInMs -= dtMs;
      if (s.entrySpawnInMs <= 0) {
        s.entrySpawnInMs += randomRange(s.rng, 6000, 10_000);
        if (s.entryOrder.length + s.pendingEntry < 4) s.pendingEntry++;
      }
    }
    if (s.pendingEntry > 0) {
      // A new car turns in from the street, or joins the back of a queue that has backed up past it.
      const tail = s.entryOrder.length > 0 ? byId(s, s.entryOrder[s.entryOrder.length - 1]!) : undefined;
      const at = tail ? Math.min(SPAWN_S, tail.s - (L + ENTRY_GAP)) : SPAWN_S;
      if (at >= 0) {
        const car = newCar(s, 'arriving');
        setRoute(car, approachRoute(), false, at);
        car.speed = tail && at < SPAWN_S ? 0 : LANE_SPEED;
        updatePose(car);
        s.cars.push(car);
        s.entryOrder.push(car.id);
        s.pendingEntry--;
      }
    }
    while (s.pendingExit > 0) {
      let pick: GarageCar | undefined;
      for (const car of s.cars) {
        if (car.phase === 'parked' && !car.leaveRequested && (!pick || car.parkedAtMs < pick.parkedAtMs)) pick = car;
      }
      if (!pick) {
        s.pendingExit = 0;
        break;
      }
      pick.leaveRequested = true;
      pick.leaveSeq = ++s.leaveSeq;
      s.pendingExit--;
    }
    if (canStartLeaving(s)) {
      let pick: GarageCar | undefined;
      for (const car of s.cars) {
        if (car.phase === 'parked' && car.leaveRequested && (!pick || car.leaveSeq < pick.leaveSeq)) pick = car;
      }
      if (pick) {
        s.spaces[pick.space] = 0;
        pick.phase = 'backing-out';
        pick.phaseMs = 0;
        setRoute(pick, backOutRoute(pick.space), true);
        pick.space = -1;
      }
    }

    stepCars(s, dtMs);

    // --- poses, detectors, gate-line counting ---
    const sn = s.sensors;
    sn.entryLoop = sn.entryPE = sn.exitLoop = sn.exitPE = sn.ticket = false;
    let entryUnder = 0;
    let exitUnder = 0;
    const ex = Y.entryLaneX;
    const xo = Y.exitLaneX;
    const lw = Y.laneWidth / 2;
    const lh = Y.loopHalfWidth;
    for (const car of s.cars) {
      if (car.phase === 'parked') continue;
      updatePose(car);
      if (car.pressing) sn.ticket = true;
      if (overlapsRect(car, ex - lh, ex + lh, Y.entryLoop.z0, Y.entryLoop.z1)) sn.entryLoop = true;
      if (overlapsRect(car, xo - lh, xo + lh, Y.exitLoop.z0, Y.exitLoop.z1)) sn.exitLoop = true;
      if (overlapsRect(car, ex - lw, ex + lw, Y.gateZ - 0.01, Y.gateZ + 0.01)) {
        sn.entryPE = true;
        entryUnder = car.id;
      }
      if (overlapsRect(car, xo - lw, xo + lw, Y.gateZ - 0.01, Y.gateZ + 0.01)) {
        sn.exitPE = true;
        exitUnder = car.id;
      }
      const hz = halfExtent(car.yaw, false);
      if (!car.inside && (car.phase === 'entering' || car.phase === 'searching' || car.phase === 'to-exit')) {
        if (car.z + hz < Y.gateZ) {
          car.inside = true;
          s.carsInside++;
          s.carsEntered++;
        }
      } else if (car.inside && car.phase === 'exiting' && car.z - hz > Y.gateZ) {
        car.inside = false;
        s.carsInside--;
        s.carsExited++;
      }
    }

    stepGate(s, s.entryGate, entryCmd, dtMs, entryUnder);
    stepGate(s, s.exitGate, exitCmd, dtMs, exitUnder);

    // --- cars that reached the street ---
    for (let i = s.cars.length - 1; i >= 0; i--) {
      const car = s.cars[i]!;
      if ((car.phase === 'exiting' || car.phase === 'turning-away') && car.s >= car.routeLen - 1e-6) {
        s.cars.splice(i, 1);
      }
    }

    // --- field inputs (every point, every step) ---
    io.writeBool('Local:1:I.Pt00.Data', sn.entryLoop);
    io.writeBool('Local:1:I.Pt01.Data', sn.entryPE);
    io.writeBool('Local:1:I.Pt02.Data', sn.exitLoop);
    io.writeBool('Local:1:I.Pt03.Data', sn.exitPE);
    io.writeBool('Local:1:I.Pt04.Data', sn.ticket);
    io.writeBool('Local:1:I.Pt05.Data', c.reset_key);
  },

  setControl(s, id, value) {
    const prev = writeControl(CONTROLS, s.controls, id, value);
    const now = readControl(CONTROLS, s.controls, id);
    if (id === 'initial_cars') {
      s.controls.initial_cars = Math.round(s.controls.initial_cars);
      if (pristine(s)) populate(s, s.controls.initial_cars);
    } else if (prev === false && now === true) {
      if (id === 'spawn_entry') s.pendingEntry = Math.min(6, s.pendingEntry + 1);
      else if (id === 'spawn_exit') s.pendingExit = Math.min(Y.capacity, s.pendingExit + 1);
    }
  },

  getControl(s, id) {
    return readControl(CONTROLS, s.controls, id);
  },

  observe(s) {
    return {
      carsInside: s.carsInside,
      capacity: Y.capacity,
      entryGateUp: s.entryGate.pos >= 0.9,
      exitGateUp: s.exitGate.pos >= 0.9,
      entryGatePos: s.entryGate.pos,
      exitGatePos: s.exitGate.pos,
      fullSign: s.fullSign,
      openSign: s.openSign,
      gateHits: s.gateHits,
      carsTurnedAway: s.carsTurnedAway,
      carsEntered: s.carsEntered,
      carsExited: s.carsExited,
      carsWaitingEntry: s.entryOrder.length,
      carsWaitingExit: s.exitOrder.length,
    };
  },
};
