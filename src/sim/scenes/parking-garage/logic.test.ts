import { describe, expect, it } from 'vitest';
import { createHarness, sceneContractSuite, type FakePlc, type SceneHarness } from '../../testing';
import { GARAGE_LAYOUT as Y, garageCarPose, parkingGarageLogic, type GarageCar, type ParkingGarageState } from './logic';

sceneContractSuite(parkingGarageLogic, {
  id: 'parking-garage',
  controls: ['auto_traffic', 'spawn_entry', 'spawn_exit', 'reset_key', 'initial_cars'],
  observables: [
    'carsInside', 'capacity', 'entryGateUp', 'exitGateUp', 'entryGatePos', 'exitGatePos', 'fullSign',
    'openSign', 'gateHits', 'carsTurnedAway', 'carsEntered', 'carsExited', 'carsWaitingEntry', 'carsWaitingExit',
  ],
  fuzzMs: 60_000,
});

type H = SceneHarness<ParkingGarageState>;

/** A correct gate program: open on ticket (unless full), close when the car has cleared the eye; count in/out. */
function goodPlc(initialCount = 0): FakePlc & { count: () => number } {
  let count = initialCount;
  let entryOpen = false;
  let exitOpen = false;
  let prevEntry = false;
  let prevExit = false;
  const scan: FakePlc = (io) => {
    const full = count >= Y.capacity;
    if (io.inputBool('Ticket_PB') && io.inputBool('Entry_Loop') && !full) entryOpen = true;
    const pe = io.inputBool('Entry_PE');
    if (prevEntry && !pe) {
      entryOpen = false;
      count++;
    }
    prevEntry = pe;
    if (io.inputBool('Exit_Loop')) exitOpen = true;
    const px = io.inputBool('Exit_PE');
    if (prevExit && !px) {
      exitOpen = false;
      count--;
    }
    prevExit = px;
    io.setOutput('Entry_Gate_Up', entryOpen);
    io.setOutput('Exit_Gate_Up', exitOpen);
    io.setOutput('Full_Sign', count >= Y.capacity);
    io.setOutput('Open_Sign', count < Y.capacity);
  };
  return Object.assign(scan, { count: () => count });
}

/** Corners of a car body (plan x/z) from its stored pose. */
function corners(c: GarageCar, out: number[]): number[] {
  const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw); // forward (model faces +X, yaw about +Y)
  const rx = -fz, rz = fx;
  const hl = Y.carLength / 2, hw = Y.carWidth / 2;
  let k = 0;
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const) {
    out[k++] = c.x + fx * hl * a + rx * hw * b;
    out[k++] = c.z + fz * hl * a + rz * hw * b;
  }
  return out;
}

/** Oriented car bodies overlap by more than `tol` metres (separating-axis test). */
function bodiesOverlap(a: GarageCar, b: GarageCar, tol = 0.05): boolean {
  const A = corners(a, []), B = corners(b, []);
  for (const P of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const nx = P[2 * i + 1]! - P[2 * j + 1]!, nz = P[2 * j]! - P[2 * i]!;
      const n = Math.hypot(nx, nz);
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (let k = 0; k < 4; k++) {
        const pa = (A[2 * k]! * nx + A[2 * k + 1]! * nz) / n;
        const pb = (B[2 * k]! * nx + B[2 * k + 1]! * nz) / n;
        aMin = Math.min(aMin, pa); aMax = Math.max(aMax, pa);
        bMin = Math.min(bMin, pb); bMax = Math.max(bMax, pb);
      }
      if (aMax - tol <= bMin || bMax - tol <= aMin) return false;
    }
  }
  return true;
}

/** Every pair of overlapping car bodies right now, as 'phaseA/phaseB'. */
function overlaps(h: H): string[] {
  const cs = h.state.cars;
  const out: string[] = [];
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      if (bodiesOverlap(cs[i]!, cs[j]!)) out.push(`${cs[i]!.phase}/${cs[j]!.phase}@${h.timeMs}`);
    }
  }
  return out;
}

function manual(plc?: FakePlc): H {
  const h = createHarness(parkingGarageLogic, plc ? { plc } : {});
  h.set('auto_traffic', false);
  return h;
}

describe('parking-garage: wiring', () => {
  it('uses the CompactLogix 5380 hardware and exact point operands', () => {
    expect(parkingGarageLogic.hardware.modules.map((m) => m.catalog)).toEqual(['5069-L320ER', '5069-IB16', '5069-OB16']);
    const map = Object.fromEntries(parkingGarageLogic.io.map((p) => [p.alias, p.operand]));
    expect(map).toEqual({
      Entry_Loop: 'Local:1:I.Pt00.Data',
      Entry_PE: 'Local:1:I.Pt01.Data',
      Exit_Loop: 'Local:1:I.Pt02.Data',
      Exit_PE: 'Local:1:I.Pt03.Data',
      Ticket_PB: 'Local:1:I.Pt04.Data',
      Reset_Key: 'Local:1:I.Pt05.Data',
      Entry_Gate_Up: 'Local:2:O.Pt00.Data',
      Exit_Gate_Up: 'Local:2:O.Pt01.Data',
      Full_Sign: 'Local:2:O.Pt02.Data',
      Open_Sign: 'Local:2:O.Pt03.Data',
    });
    expect(Y.spaces).toHaveLength(12);
  });

  it('idle: every input 0; Reset_Key follows the attendant key; capacity 12', () => {
    const h = manual();
    h.step();
    for (const a of ['Entry_Loop', 'Entry_PE', 'Exit_Loop', 'Exit_PE', 'Ticket_PB', 'Reset_Key']) {
      expect(h.inBool(a)).toBe(false);
    }
    h.set('reset_key', true);
    h.step();
    expect(h.inBool('Reset_Key')).toBe(true);
    expect(h.obs('capacity')).toBe(12);
    expect(h.get('auto_traffic')).toBe(false);
    expect(createHarness(parkingGarageLogic).get('auto_traffic')).toBe(true);
  });

  it('signs follow the outputs', () => {
    const h = manual();
    h.out('Full_Sign', true);
    h.step();
    expect(h.observe()).toMatchObject({ fullSign: true, openSign: false });
  });
});

describe('parking-garage: gates', () => {
  it('arms rise in 1.5 s and lower in 1.5 s; "up" means ≥ 90 %', () => {
    const h = manual();
    h.out('Entry_Gate_Up', true);
    h.out('Exit_Gate_Up', true);
    h.run(1340);
    expect(h.obs('entryGateUp')).toBe(false);
    h.run(10);
    expect(h.obs('entryGateUp')).toBe(true);
    h.run(150);
    expect(h.obsNum('entryGatePos')).toBeCloseTo(1, 9);
    expect(h.obsNum('exitGatePos')).toBeCloseTo(1, 9);
    h.out('Entry_Gate_Up', false);
    h.run(750);
    expect(h.obsNum('entryGatePos')).toBeCloseTo(0.5, 9);
    h.run(750);
    expect(h.obsNum('entryGatePos')).toBeCloseTo(0, 9);
    expect(h.obs('exitGateUp')).toBe(true);
  });

  it('gates stay down while the controller is not running', () => {
    const h = manual();
    h.out('Entry_Gate_Up', true);
    h.io.running = false;
    h.run(2000);
    expect(h.obsNum('entryGatePos')).toBe(0);
  });
});

describe('parking-garage: entry', () => {
  it('a car arrives on the loop, waits 0.8 s, presses the ticket button 0.3 s every 4 s', () => {
    const h = manual();
    h.tap('spawn_entry', 20);
    expect(h.obs('carsWaitingEntry')).toBe(1);
    const loopMs = h.runUntil(() => h.inBool('Entry_Loop'), 5000);
    expect(loopMs).toBeLessThan(2500);
    h.runUntil(() => h.state.cars[0]!.phase === 'waiting', 3000);
    const stopAt = h.timeMs;
    const presses: Array<[number, number]> = [];
    let prev = false;
    h.run(9000, () => {
      const p = h.inBool('Ticket_PB');
      if (p && !prev) presses.push([h.timeMs - stopAt, 0]);
      if (!p && prev) presses[presses.length - 1]![1] = h.timeMs - stopAt;
      prev = p;
    });
    expect(presses).toHaveLength(3);
    expect(presses[0]![0]).toBeCloseTo(800, -1);
    expect(presses[0]![1] - presses[0]![0]).toBeCloseTo(300, -1);
    expect(presses[1]![0] - presses[0]![0]).toBeCloseTo(4000, -1);
    expect(h.inBool('Entry_Loop')).toBe(true);
    expect(h.obs('carsEntered')).toBe(0);
  });

  it('drives through only once the arm is ≥ 90 % up; occupies the eye ~1 s; counted when clear; parks', () => {
    const h = manual();
    h.tap('spawn_entry', 20);
    h.runUntil(() => h.state.cars[0]!.phase === 'waiting', 5000);
    h.out('Entry_Gate_Up', true);
    h.run(1200); // 80 %
    h.out('Entry_Gate_Up', false);
    h.run(3000);
    expect(h.state.cars[0]!.phase).toBe('waiting');
    h.out('Entry_Gate_Up', true);
    h.runUntil(() => h.inBool('Entry_PE'), 5000);
    expect(h.obsNum('entryGatePos')).toBeGreaterThanOrEqual(0.9);
    const peMs = h.runUntil(() => !h.inBool('Entry_PE'), 3000);
    expect(peMs).toBeGreaterThan(800);
    expect(peMs).toBeLessThan(1300);
    expect(h.obs('carsInside')).toBe(1);
    expect(h.obs('carsEntered')).toBe(1);
    expect(h.obs('carsWaitingEntry')).toBe(0);
    h.out('Entry_Gate_Up', false);
    h.runUntil(() => h.state.cars[0]!.phase === 'parked', 10_000);
    const car = h.state.cars[0]!;
    const space = Y.spaces[car.space]!;
    expect(h.state.spaces[car.space]).toBe(car.id);
    expect([car.x, car.z, car.yaw]).toEqual([space.x, space.z, space.yaw]);
    expect(garageCarPose(car)).toEqual({ x: space.x, z: space.z, yaw: space.yaw });
    expect(h.obs('gateHits')).toBe(0);
  });

  it('queues cars with a visible gap; a gate held open lets them roll through without stopping', () => {
    const h = manual();
    h.tap('spawn_entry', 20);
    h.run(1500);
    h.tap('spawn_entry', 20);
    h.run(1500);
    h.tap('spawn_entry', 20);
    h.run(6000);
    expect(h.obs('carsWaitingEntry')).toBe(3);
    const q = h.state.entryOrder.map((id) => h.state.cars.find((c) => c.id === id)!);
    for (let i = 1; i < q.length; i++) {
      const gap = q[i]!.z - q[i - 1]!.z - Y.carLength;
      expect(gap).toBeGreaterThan(2.9);
      expect(gap).toBeLessThan(3.2);
    }
    h.out('Entry_Gate_Up', true);
    h.run(20_000);
    expect(h.obs('carsEntered')).toBe(3);
    expect(h.obs('carsInside')).toBe(3);
    const spaces = h.state.cars.map((c) => c.space);
    expect(new Set(spaces).size).toBe(3);
  });

  it('lowering the arm onto a car counts one gate hit and the arm bounces', () => {
    const h = manual();
    h.tap('spawn_entry', 20);
    h.runUntil(() => h.state.cars[0]!.phase === 'waiting', 5000);
    h.out('Entry_Gate_Up', true);
    h.runUntil(() => h.inBool('Entry_PE'), 5000);
    h.out('Entry_Gate_Up', false); // too early!
    h.step();
    h.step();
    expect(h.obs('gateHits')).toBe(1);
    expect(h.state.entryGate.bounceMs).toBeLessThan(50);
    expect(h.state.cars[0]!.dinged).toBe(true);
    h.run(3000);
    expect(h.obs('gateHits')).toBe(1);
    expect(h.obs('carsInside')).toBe(1);
    expect(h.obsNum('entryGatePos')).toBeLessThan(0.5);
  });
});

describe('parking-garage: exit', () => {
  it('spawn_exit sends the longest-parked car to the exit loop; it waits for the gate and leaves', () => {
    const h = manual();
    h.set('initial_cars', 3);
    expect(h.obs('carsInside')).toBe(3);
    const oldest = h.state.cars[0]!;
    h.tap('spawn_exit', 20);
    const ms = h.runUntil(() => h.inBool('Exit_Loop'), 12_000);
    expect(ms).toBeLessThan(9000);
    expect(oldest.phase === 'to-exit' || oldest.phase === 'exit-waiting').toBe(true);
    expect(h.obs('carsWaitingExit')).toBe(1);
    h.run(3000);
    expect(oldest.phase).toBe('exit-waiting');
    expect(h.obs('carsExited')).toBe(0);
    h.out('Exit_Gate_Up', true);
    h.runUntil(() => h.inBool('Exit_PE'), 3000);
    h.runUntil(() => !h.inBool('Exit_PE'), 3000);
    expect(h.obs('carsExited')).toBe(1);
    expect(h.obs('carsInside')).toBe(2);
    expect(h.obs('carsWaitingExit')).toBe(0);
    h.out('Exit_Gate_Up', false);
    h.run(4000);
    expect(h.state.cars).toHaveLength(2);
    expect(h.state.spaces.filter((id) => id !== 0)).toHaveLength(2);
  });

  it('spawn_exit with an empty garage does nothing', () => {
    const h = manual();
    h.tap('spawn_exit', 20);
    h.run(5000);
    expect(h.state.cars).toHaveLength(0);
    expect(h.state.pendingExit).toBe(0);
  });
});

describe('parking-garage: capacity', () => {
  it('initial_cars (0..12, rounded) is applied while the garage is untouched', () => {
    const h = manual();
    h.set('initial_cars', 7.6);
    expect(h.get('initial_cars')).toBe(8);
    expect(h.obs('carsInside')).toBe(8);
    h.set('initial_cars', 5);
    expect(h.obs('carsInside')).toBe(5);
    expect(h.state.spaces.filter((id) => id !== 0)).toHaveLength(5);
    h.set('initial_cars', 40);
    expect(h.obs('carsInside')).toBe(12);
    // Once traffic has passed a gate, changes only take effect on the next reset.
    const g = manual(goodPlc());
    g.tap('spawn_entry', 20);
    g.run(10_000);
    expect(g.obs('carsEntered')).toBe(1);
    g.set('initial_cars', 6);
    expect(g.obs('carsInside')).toBe(1);
    expect(g.get('initial_cars')).toBe(6);
  });

  it('full garage + correct program: the driver presses, waits 5 s, then turns away (U-turn)', () => {
    const plc = goodPlc(12);
    const h = manual(plc);
    h.set('initial_cars', 12);
    h.tap('spawn_entry', 20);
    h.runUntil(() => h.state.cars.some((c) => c.phase === 'waiting'), 5000);
    const t0 = h.timeMs;
    h.runUntil(() => h.obs('carsTurnedAway') === 1, 7000);
    expect(h.timeMs - t0).toBeGreaterThan(4900);
    expect(h.timeMs - t0).toBeLessThan(5100);
    expect(h.obs('entryGatePos')).toBe(0);
    expect(h.obs('carsWaitingEntry')).toBe(0);
    h.run(15_000);
    expect(h.state.cars.filter((c) => c.phase !== 'parked')).toHaveLength(0);
    expect(h.obs('carsInside')).toBe(12);
    expect(h.obs('fullSign')).toBe(true);
  });

  it('full garage + gate opened anyway: the car gets in (13 inside!), finds no space and leaves by the exit', () => {
    const h = manual();
    h.set('initial_cars', 12);
    h.tap('spawn_entry', 20);
    h.out('Entry_Gate_Up', true);
    h.runUntil(() => h.obsNum('carsInside') === 13, 10_000);
    expect(h.state.cars.find((c) => c.phase !== 'parked')?.phase).toBe('searching');
    h.out('Entry_Gate_Up', false);
    h.runUntil(() => h.inBool('Exit_Loop'), 30_000);
    h.out('Exit_Gate_Up', true);
    h.runUntil(() => h.obsNum('carsInside') === 12, 10_000);
    expect(h.obs('carsExited')).toBe(1);
  });

  it('an entry gate held open on a full garage lets in one car without a space at a time; the rest are turned away', () => {
    // A latched-output bug: Entry_Gate_Up stays on, the exit gate is not programmed yet.
    const h = createHarness(parkingGarageLogic);
    h.set('initial_cars', 12);
    h.out('Entry_Gate_Up', true);
    let maxInside = 0;
    let maxCars = 0;
    const bumps: string[] = [];
    h.run(600_000, () => {
      maxInside = Math.max(maxInside, h.obsNum('carsInside'));
      maxCars = Math.max(maxCars, h.state.cars.length);
      if (h.timeMs % 500 === 0) bumps.push(...overlaps(h));
    });
    expect(maxInside).toBe(13);
    expect(h.state.cars.filter((c) => c.noSpace)).toHaveLength(1);
    expect(maxCars).toBeLessThan(25);
    expect(h.obsNum('carsTurnedAway')).toBeGreaterThan(30);
    expect(h.obs('carsWaitingExit')).toBeLessThanOrEqual(3);
    expect(bumps).toEqual([]);
  }, 30_000);

  it('starting empty with the entry gate held open: capacity + exit queue + one searcher, never a pile-up', () => {
    const h = createHarness(parkingGarageLogic);
    h.out('Entry_Gate_Up', true);
    let maxInside = 0;
    const bumps: string[] = [];
    h.run(600_000, () => {
      maxInside = Math.max(maxInside, h.obsNum('carsInside'));
      if (h.timeMs % 500 === 0) bumps.push(...overlaps(h));
    });
    expect(maxInside).toBeLessThanOrEqual(Y.capacity + 3);
    expect(h.state.cars.length).toBeLessThan(25);
    expect(bumps).toEqual([]);
  }, 30_000);

  it('the next car waits while a turned-away car U-turns, then moves up', () => {
    const h = manual(goodPlc(12));
    h.set('initial_cars', 12);
    h.tap('spawn_entry', 20);
    h.run(1500);
    h.tap('spawn_entry', 20);
    h.runUntil(() => h.obs('carsTurnedAway') === 1, 12_000);
    const second = h.state.cars.find((c) => c.phase === 'arriving')!;
    expect(second).toBeDefined();
    h.runUntil(() => second.phase === 'waiting', 10_000);
    h.runUntil(() => h.obs('carsTurnedAway') === 2, 7000);
    h.run(15_000);
    expect(h.state.cars.filter((c) => c.phase !== 'parked')).toHaveLength(0);
  });
});

describe('parking-garage: automatic traffic with a correct program', () => {
  it('runs for 15 minutes: no gate hits, count matches, capacity never exceeded, cars come and go', () => {
    const plc = goodPlc();
    const h = createHarness(parkingGarageLogic, { plc });
    let maxInside = 0;
    let maxQueue = 0;
    h.run(15 * 60_000, () => {
      maxInside = Math.max(maxInside, h.obsNum('carsInside'));
      maxQueue = Math.max(maxQueue, h.obsNum('carsWaitingEntry'));
    });
    const o = h.observe();
    expect(o.gateHits).toBe(0);
    expect(maxInside).toBeLessThanOrEqual(12);
    expect(o.carsEntered).toBeGreaterThan(40);
    expect(o.carsExited).toBeGreaterThan(30);
    expect(o.carsInside).toBe(Number(o.carsEntered) - Number(o.carsExited));
    expect(Math.abs(plc.count() - Number(o.carsInside))).toBeLessThanOrEqual(1);
    expect(maxQueue).toBeLessThanOrEqual(5);
    // every parked car sits in its own numbered space
    const parked = h.state.cars.filter((c) => c.phase === 'parked');
    expect(new Set(parked.map((c) => c.space)).size).toBe(parked.length);
  });

  const noBumps: Array<[string, number, boolean]> = [
    ['empty start', 0, false],
    ['full start (turn-aways, U-turns)', 12, false],
    ['exit gate held open', 0, true],
  ];
  it.each(noBumps)('cars never drive through each other: %s (aisle right-of-way, U-turns yield)', (_name, initial, exitHeld) => {
    const plc = goodPlc(initial);
    const h = createHarness(parkingGarageLogic, {
      plc: (io, t) => {
        plc(io, t);
        if (exitHeld) io.setOutput('Exit_Gate_Up', true);
      },
    });
    h.set('initial_cars', initial);
    const bumps: string[] = [];
    h.run(15 * 60_000, () => {
      if (h.timeMs % 100 === 0) bumps.push(...overlaps(h));
    });
    expect(bumps).toEqual([]);
    expect(h.obs('gateHits')).toBe(0);
    expect(h.obsNum('carsExited')).toBeGreaterThan(60);
    if (initial === 12) expect(h.obsNum('carsTurnedAway')).toBeGreaterThan(0);
  }, 30_000);
});
