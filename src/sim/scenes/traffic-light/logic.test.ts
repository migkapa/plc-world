import { describe, expect, it } from 'vitest';
import { createHarness, sceneContractSuite, type FakePlc, type SceneHarness } from '../../testing';
import {
  TRAFFIC_GEOMETRY as G,
  pedestrianPose,
  roadOf,
  trafficCarPose,
  trafficLightLogic,
  type Approach,
  type TrafficCar,
  type TrafficLightState,
} from './logic';

const STOP_S = G.approachDist - G.stopLineDist;
const BOX_OUT_S = G.approachDist + G.roadHalfWidth;

sceneContractSuite(trafficLightLogic, {
  id: 'traffic-light',
  controls: ['ped', 'night', 'auto_traffic', 'spawn_ew', 'spawn_ns'],
  observables: [
    'nsRed', 'nsYellow', 'nsGreen', 'ewRed', 'ewYellow', 'ewGreen', 'walk', 'dontWalk',
    'conflict', 'conflicts', 'carsPassed', 'carsWaitingEW', 'pedWaiting', 'pedCrossed',
  ],
  fuzzMs: 40_000,
});

type Lamp = 'NS_Red' | 'NS_Yellow' | 'NS_Green' | 'EW_Red' | 'EW_Yellow' | 'EW_Green' | 'Walk' | 'Dont_Walk';
const LAMPS: Lamp[] = ['NS_Red', 'NS_Yellow', 'NS_Green', 'EW_Red', 'EW_Yellow', 'EW_Green', 'Walk', 'Dont_Walk'];

/** Set exactly the given lamps on (others off). */
function lamps(h: SceneHarness<TrafficLightState>, ...on: Lamp[]): void {
  for (const l of LAMPS) h.out(l, on.includes(l));
}

function manual(): SceneHarness<TrafficLightState> {
  const h = createHarness(trafficLightLogic);
  h.set('auto_traffic', false);
  return h;
}

function carsOf(h: SceneHarness<TrafficLightState>, road: 'NS' | 'EW'): TrafficCar[] {
  return h.state.cars.filter((c) => roadOf(c.approach) === road);
}

/** A textbook fixed-time controller: 20 s NS green, 3 s yellow, 1 s all-red, 10 s EW green (+WALK), 3 s yellow, 1 s all-red. */
const fixedTime: FakePlc = (io, t) => {
  const T = t % 38_000;
  const set = (alias: Lamp, v: boolean) => io.setOutput(alias, v);
  set('NS_Green', T < 20_000);
  set('NS_Yellow', T >= 20_000 && T < 23_000);
  set('NS_Red', T >= 23_000);
  set('EW_Green', T >= 24_000 && T < 34_000);
  set('EW_Yellow', T >= 34_000 && T < 37_000);
  set('EW_Red', T < 24_000 || T >= 37_000);
  set('Walk', T >= 24_000 && T < 30_000);
  set('Dont_Walk', !(T >= 24_000 && T < 30_000));
};

describe('traffic-light: wiring', () => {
  it('uses the CompactLogix 5380 hardware and exact point operands', () => {
    expect(trafficLightLogic.hardware.platform).toBe('CompactLogix');
    expect(trafficLightLogic.hardware.modules.map((m) => m.catalog)).toEqual(['5069-L320ER', '5069-IB16', '5069-OB16']);
    const map = Object.fromEntries(trafficLightLogic.io.map((p) => [p.alias, p.operand]));
    expect(map).toEqual({
      Ped_PB: 'Local:1:I.Pt00.Data',
      Car_Sensor_EW: 'Local:1:I.Pt01.Data',
      Night_Mode: 'Local:1:I.Pt02.Data',
      NS_Red: 'Local:2:O.Pt00.Data',
      NS_Yellow: 'Local:2:O.Pt01.Data',
      NS_Green: 'Local:2:O.Pt02.Data',
      EW_Red: 'Local:2:O.Pt03.Data',
      EW_Yellow: 'Local:2:O.Pt04.Data',
      EW_Green: 'Local:2:O.Pt05.Data',
      Walk: 'Local:2:O.Pt06.Data',
      Dont_Walk: 'Local:2:O.Pt07.Data',
    });
    expect(trafficLightLogic.controls.find((c) => c.id === 'auto_traffic')?.default).toBe(true);
    expect(trafficLightLogic.controls.find((c) => c.id === 'ped')?.key).toBe('P');
  });

  it('Ped_PB is N.O. (1 only while held); Night_Mode follows the key switch', () => {
    const h = manual();
    h.step();
    expect(h.inBool('Ped_PB')).toBe(false);
    expect(h.inBool('Night_Mode')).toBe(false);
    expect(h.inBool('Car_Sensor_EW')).toBe(false);
    h.set('ped', true);
    h.set('night', true);
    h.step();
    expect(h.inBool('Ped_PB')).toBe(true);
    expect(h.inBool('Night_Mode')).toBe(true);
    h.set('ped', false);
    h.run(1000);
    expect(h.inBool('Ped_PB')).toBe(false);
    expect(h.inBool('Night_Mode')).toBe(true);
  });

  it('observes the lamp states as driven (all dark when the controller is not running)', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red', 'Dont_Walk');
    h.step();
    expect(h.observe()).toMatchObject({ nsGreen: true, nsRed: false, ewRed: true, dontWalk: true, walk: false });
    h.io.running = false;
    h.step();
    expect(h.observe()).toMatchObject({ nsGreen: false, ewRed: false, dontWalk: false });
  });
});

describe('traffic-light: conflict monitor', () => {
  it('counts a green/green conflict only once it lasts ≥ 100 ms, once per occurrence', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Green');
    h.run(90);
    expect(h.obs('conflict')).toBe(true);
    expect(h.obs('conflicts')).toBe(0);
    lamps(h, 'NS_Green', 'EW_Red');
    h.step();
    expect(h.obs('conflict')).toBe(false);
    lamps(h, 'NS_Yellow', 'EW_Green');
    h.run(100);
    expect(h.obs('conflicts')).toBe(1);
    expect(h.state.lastConflictMs).toBe(h.timeMs);
    h.run(2000);
    expect(h.obs('conflicts')).toBe(1);
    lamps(h, 'NS_Red', 'EW_Green');
    h.run(50);
    lamps(h, 'NS_Green', 'EW_Yellow');
    h.run(150);
    expect(h.obs('conflicts')).toBe(2);
  });

  it('WALK with the main street green or yellow is a conflict; with NS red it is not', () => {
    const h = manual();
    lamps(h, 'NS_Red', 'EW_Green', 'Walk');
    h.run(500);
    expect(h.obs('conflict')).toBe(false);
    lamps(h, 'NS_Yellow', 'EW_Red', 'Walk');
    h.run(100);
    expect(h.obs('conflict')).toBe(true);
    expect(h.obs('conflicts')).toBe(1);
  });

  it('red + red, yellow + red, green + red are all safe', () => {
    const h = manual();
    for (const pair of [['NS_Red', 'EW_Red'], ['NS_Yellow', 'EW_Red'], ['NS_Red', 'EW_Yellow'], ['NS_Green', 'EW_Red']] as const) {
      lamps(h, ...pair, 'Dont_Walk');
      h.run(300);
      expect(h.obs('conflict')).toBe(false);
    }
    expect(h.obs('conflicts')).toBe(0);
  });
});

describe('traffic-light: cars', () => {
  it('a main-street car stops at the stop line on red and leaves on green', () => {
    const h = manual();
    lamps(h, 'NS_Red', 'EW_Red');
    h.tap('spawn_ns', 50);
    h.run(9000);
    const car = carsOf(h, 'NS')[0]!;
    expect(car.speed).toBe(0);
    expect(car.s).toBeLessThanOrEqual(STOP_S);
    expect(car.s).toBeGreaterThan(STOP_S - 1);
    expect(car.braking).toBe(true);
    expect(h.obs('carsPassed')).toBe(0);
    lamps(h, 'NS_Green', 'EW_Red');
    h.runUntil(() => h.obs('carsPassed') === 1, 6000);
  });

  it('on green a car drives through without stopping', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red');
    h.tap('spawn_ns', 20);
    let minSpeed = Infinity;
    h.run(6000, () => {
      const c = h.state.cars[0];
      if (c) minSpeed = Math.min(minSpeed, c.speed);
    });
    expect(h.obs('carsPassed')).toBe(1);
    expect(minSpeed).toBeGreaterThan(10);
  });

  it('Car_Sensor_EW turns on when a side-street car waits at the line; cars queue with visible gaps', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red');
    h.tap('spawn_ew', 20);
    const ms = h.runUntil(() => h.inBool('Car_Sensor_EW'), 8000);
    expect(ms).toBeGreaterThan(3000);
    expect(h.obs('carsWaitingEW')).toBe(1);
    h.tap('spawn_ew', 20);
    h.run(1500);
    h.tap('spawn_ew', 20);
    h.run(10_000);
    expect(h.obs('carsWaitingEW')).toBe(3);
    // Queue gaps per lane: bumper-to-bumper 1.5 .. 3.5 m.
    for (const ap of ['EB', 'WB'] as Approach[]) {
      const lane = h.state.cars.filter((c) => c.approach === ap);
      for (let i = 1; i < lane.length; i++) {
        const gap = lane[i - 1]!.s - lane[i - 1]!.length - lane[i]!.s;
        expect(gap).toBeGreaterThan(1.5);
        expect(gap).toBeLessThan(3.5);
      }
    }
    lamps(h, 'NS_Red', 'EW_Green');
    h.runUntil(() => !h.inBool('Car_Sensor_EW'), 1500);
    h.run(10_000);
    expect(h.inBool('Car_Sensor_EW')).toBe(false);
    expect(h.obs('carsPassed')).toBe(3);
    expect(h.obs('carsWaitingEW')).toBe(0);
  });

  it('yellow: a car close to the line goes through, a far one stops', () => {
    const near = manual();
    lamps(near, 'NS_Green', 'EW_Red');
    near.tap('spawn_ns', 20);
    near.runUntil(() => near.state.cars[0]!.s >= STOP_S - 10, 6000);
    lamps(near, 'NS_Yellow', 'EW_Red');
    near.run(4000);
    expect(near.obs('carsPassed')).toBe(1);

    const far = manual();
    lamps(far, 'NS_Green', 'EW_Red');
    far.tap('spawn_ns', 20);
    far.runUntil(() => far.state.cars[0]!.s >= STOP_S - 30, 6000);
    lamps(far, 'NS_Yellow', 'EW_Red');
    far.run(3000);
    lamps(far, 'NS_Red', 'EW_Red');
    far.run(4000);
    expect(far.obs('carsPassed')).toBe(0);
    expect(far.state.cars[0]!.speed).toBe(0);
  });

  it('green straight to red with no yellow: a car that cannot stop runs the red', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red');
    h.tap('spawn_ns', 20);
    h.runUntil(() => h.state.cars[0]!.s >= STOP_S - 4, 6000);
    lamps(h, 'NS_Red', 'EW_Red');
    h.run(3000);
    expect(h.obs('carsPassed')).toBe(1);
  });

  it('conflicting greens make crossing cars collide; wrecks are towed after 4 s', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Green');
    const mk = (id: number, approach: Approach): TrafficCar => ({
      id, approach, s: 20, speed: 12, accel: 0, length: 4.4, variant: 0, decision: 'none', waitMs: 0,
      passed: false, state: 'driving', braking: false, crashMs: 0, spin: 0,
    });
    h.state.cars.push(mk(100, 'NB'), mk(101, 'EB'));
    h.run(3000);
    expect(h.state.collisions).toBe(1);
    expect(h.state.cars.every((c) => c.state === 'crashed')).toBe(true);
    expect(h.state.crashFx).toHaveLength(1);
    expect(h.obs('conflicts')).toBe(1);
    h.run(4500);
    expect(h.state.cars).toHaveLength(0);
    expect(h.state.crashFx).toHaveLength(0);
  });

  it('dark signal (controller stopped) = all-way stop: everyone stops, then proceeds in turn without crashing', () => {
    const h = manual();
    h.io.running = false;
    h.tap('spawn_ns', 20);
    h.tap('spawn_ew', 20);
    let nsStopped = false;
    let ewStopped = false;
    h.run(25_000, () => {
      for (const c of h.state.cars) {
        if (c.speed < 0.05 && Math.abs(c.s - STOP_S) < 1) {
          if (roadOf(c.approach) === 'NS') nsStopped = true;
          else ewStopped = true;
        }
      }
    });
    expect(nsStopped && ewStopped).toBe(true);
    expect(h.obs('carsPassed')).toBe(2);
    expect(h.state.collisions).toBe(0);
  });

  it('night flash: main street (flashing yellow) keeps rolling, side street (flashing red) stops then goes', () => {
    const h = manual();
    const nightPlc: FakePlc = (io, t) => {
      const on = t % 1000 < 500;
      for (const l of LAMPS) io.setOutput(l, false);
      io.setOutput('NS_Yellow', on);
      io.setOutput('EW_Red', on);
    };
    h.plc = nightPlc;
    h.run(3000);
    expect(h.state.signals.ns.aspect).toBe('caution');
    expect(h.state.signals.ew.aspect).toBe('stop-sign');
    h.tap('spawn_ns', 20);
    h.tap('spawn_ew', 20);
    let nsMin = Infinity;
    let ewMin = Infinity;
    h.run(20_000, () => {
      for (const c of h.state.cars) {
        if (c.s > STOP_S - 20 && c.s < BOX_OUT_S) {
          if (roadOf(c.approach) === 'NS') nsMin = Math.min(nsMin, c.speed);
          else ewMin = Math.min(ewMin, c.speed);
        }
      }
    });
    expect(nsMin).toBeGreaterThan(4);
    expect(ewMin).toBeLessThan(0.3);
    expect(h.obs('carsPassed')).toBe(2);
    expect(h.state.collisions).toBe(0);
  });
});

describe('traffic-light: drivers only crash when the signals tell them to', () => {
  /** NS head cycles green 10 s / yellow 3 s / red 13 s; the EW head is not programmed yet (dark). */
  const nsOnly: FakePlc = (io, t) => {
    const T = t % 26_000;
    io.setOutput('NS_Green', T < 10_000);
    io.setOutput('NS_Yellow', T >= 10_000 && T < 13_000);
    io.setOutput('NS_Red', T >= 13_000);
  };

  it('dark signals (controller not running) for 10 min: all-way stop, no crashes, traffic flows', () => {
    const h = createHarness(trafficLightLogic);
    h.io.running = false;
    h.run(600_000);
    expect(h.state.collisions).toBe(0);
    expect(h.state.crashFx).toHaveLength(0);
    expect(h.obsNum('carsPassed')).toBeGreaterThan(170);
    expect(h.obs('conflicts')).toBe(0);
  }, 30_000);

  it('a partial program (EW head still dark) for 10 min: no crashes the student did not cause', () => {
    const h = createHarness(trafficLightLogic, { plc: nsOnly });
    h.run(600_000);
    expect(h.state.collisions).toBe(0);
    expect(h.obs('conflicts')).toBe(0);
    expect(h.obsNum('carsPassed')).toBeGreaterThan(170);
  }, 30_000);

  it('on green a driver does not pull into a crossing car that has just left its stop line', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red', 'Dont_Walk');
    h.step();
    const mk = (id: number, approach: Approach, s: number, speed: number): TrafficCar => ({
      id, approach, s, speed, accel: 0, length: 4.4, variant: 0, decision: 'none', waitMs: 0,
      passed: false, state: 'driving', braking: false, crashMs: 0, spin: 0,
    });
    // A slow side-street car just past its line (e.g. it crept over on red) and a main-street car on green.
    h.state.cars.push(mk(100, 'EB', STOP_S + 0.2, 0.8), mk(101, 'NB', STOP_S - 25, 12));
    let nbMin = Infinity;
    h.run(12_000, () => {
      const nb = h.state.cars.find((c) => c.id === 101);
      if (nb && nb.s < STOP_S + 1) nbMin = Math.min(nbMin, nb.speed);
    });
    expect(h.state.collisions).toBe(0);
    expect(nbMin).toBeLessThan(4); // it braked for the crossing car…
    expect(h.obs('carsPassed')).toBe(2); // …and both got through
  });

  it('a 1 s on / 1 s off flash (TON 1000 toggle) reads as flashing: night mode keeps traffic moving', () => {
    const h = createHarness(trafficLightLogic, {
      plc: (io, t) => {
        const on = t % 2000 < 1000;
        io.setOutput('NS_Yellow', on);
        io.setOutput('EW_Red', on);
        io.setOutput('Dont_Walk', true);
      },
    });
    h.run(5000);
    expect(h.state.signals.ns.aspect).toBe('caution');
    expect(h.state.signals.ew.aspect).toBe('stop-sign');
    h.run(55_000);
    expect(h.state.signals.ns.aspect).toBe('caution');
    expect(h.obsNum('carsPassed')).toBeGreaterThan(12);
    expect(h.state.collisions).toBe(0);
    expect(h.state.cars.filter((c) => c.decision === 'stop' && roadOf(c.approach) === 'NS')).toHaveLength(0);
  });

  it('a one-scan flicker of a steady red is not a flash', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red');
    h.run(3000);
    for (let k = 0; k < 3; k++) {
      h.out('EW_Red', false);
      h.step();
      h.out('EW_Red', true);
      h.run(1000);
      expect(h.state.signals.ew.aspect).toBe('stop');
    }
  });

  it('a yellow stuck on for more than 8 s is eventually treated as caution (no endless gridlock)', () => {
    const h = manual();
    lamps(h, 'NS_Yellow', 'EW_Red', 'Dont_Walk');
    h.tap('spawn_ns', 20);
    h.run(7000);
    expect(h.state.signals.ns.aspect).toBe('yellow');
    expect(h.obs('carsPassed')).toBe(0);
    h.run(1500);
    expect(h.state.signals.ns.aspect).toBe('caution');
    h.runUntil(() => h.obs('carsPassed') === 1, 8000);
    // A normal clearance yellow stays a yellow.
    lamps(h, 'NS_Red', 'EW_Red');
    h.run(1000);
    lamps(h, 'NS_Yellow', 'EW_Red');
    h.run(4000);
    expect(h.state.signals.ns.aspect).toBe('yellow');
  });
});

describe('traffic-light: pedestrians', () => {
  it('a pedestrian appears on the button press, waits, and crosses while WALK is lit', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red', 'Dont_Walk');
    h.tap('ped');
    expect(h.obs('pedWaiting')).toBe(true);
    h.run(5000);
    expect(h.obs('pedWaiting')).toBe(true);
    expect(h.state.pedestrians[0]!.state).toBe('waiting');
    lamps(h, 'NS_Red', 'EW_Green', 'Walk');
    h.step();
    expect(h.obs('pedWaiting')).toBe(false);
    const ms = h.runUntil(() => h.obs('pedCrossed') === 1, 10_000);
    // 10 m kerb to kerb at 1.4 m/s
    expect(ms).toBeGreaterThan(6500);
    expect(ms).toBeLessThan(7500);
    const pose = pedestrianPose(h.state.pedestrians[0]!);
    expect(pose.x).toBeCloseTo(G.crosswalkHalfSpan);
    h.run(3500);
    expect(h.state.pedestrians).toHaveLength(0);
  });

  it('pedestrians hurry when DON’T WALK comes on mid-crossing; alternate kerbs', () => {
    const h = manual();
    lamps(h, 'NS_Red', 'EW_Green', 'Walk');
    h.tap('ped', 20);
    h.tap('ped', 20);
    h.run(2000);
    const [a, b] = h.state.pedestrians;
    expect(a!.dir).toBe(1);
    expect(b!.dir).toBe(-1);
    lamps(h, 'NS_Red', 'EW_Green', 'Dont_Walk');
    h.step();
    expect(a!.speed).toBe(2.0);
    h.run(4000);
    expect(h.obs('pedCrossed')).toBe(2);
  });

  it('main-street cars wait at the line while a pedestrian is on the road', () => {
    const h = manual();
    lamps(h, 'NS_Green', 'EW_Red', 'Walk'); // (a conflict, but drivers still yield)
    h.tap('spawn_ns', 20);
    h.runUntil(() => h.state.cars[0]!.s >= STOP_S - 25, 5000);
    h.tap('ped', 20);
    h.run(4000);
    expect(h.state.pedestrians[0]!.state).toBe('crossing');
    expect(h.state.cars[0]!.speed).toBe(0);
    expect(h.state.cars[0]!.s).toBeGreaterThan(STOP_S - 1);
    expect(h.obs('carsPassed')).toBe(0);
    h.runUntil(() => h.obs('carsPassed') === 1, 8000);
    expect(h.obs('pedCrossed')).toBe(1);
  });
});

describe('traffic-light: automatic traffic with a correct fixed-time program', () => {
  it('spawns ~every 3–6 s (NS) and 6–12 s (EW), cars flow, no conflicts, no crashes', () => {
    const h = createHarness(trafficLightLogic, { plc: fixedTime });
    const seen = new Set<number>();
    let ns = 0;
    let ew = 0;
    let maxCars = 0;
    h.run(300_000, () => {
      for (const c of h.state.cars) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          if (roadOf(c.approach) === 'NS') ns++;
          else ew++;
        }
      }
      maxCars = Math.max(maxCars, h.state.cars.length);
    });
    expect(ns).toBeGreaterThan(300 / 6 - 5);
    expect(ns).toBeLessThan(300 / 3 + 5);
    expect(ew).toBeGreaterThan(300 / 12 - 4);
    expect(ew).toBeLessThan(300 / 6 + 4);
    expect(h.obs('conflicts')).toBe(0);
    expect(h.state.collisions).toBe(0);
    expect(h.obsNum('carsPassed')).toBeGreaterThan(ns + ew - 15);
    expect(maxCars).toBeLessThan(30);
  });

  it('car poses follow the right-hand lanes', () => {
    const car: TrafficCar = {
      id: 1, approach: 'NB', s: G.approachDist + 2.2, speed: 0, accel: 0, length: 4.4, variant: 0,
      decision: 'none', waitMs: 0, passed: false, state: 'stopped', braking: true, crashMs: 0, spin: 0,
    };
    const nb = trafficCarPose(car);
    expect(nb.x).toBeCloseTo(G.laneOffset);
    expect(nb.z).toBeCloseTo(0);
    expect(nb.yaw).toBeCloseTo(Math.PI / 2);
    const eb = trafficCarPose({ ...car, approach: 'EB', s: 0 });
    expect(eb.x).toBeCloseTo(-G.approachDist - 2.2);
    expect(eb.z).toBeCloseTo(G.laneOffset);
    expect(eb.yaw).toBe(0);
  });
});
