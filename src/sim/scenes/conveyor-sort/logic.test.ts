import { describe, expect, it } from 'vitest';
import { createHarness, sceneContractSuite, type FakeIo, type FakePlc, type SceneHarness } from '../../testing';
import { CONVEYOR_GEOMETRY as G, conveyorSortLogic, type ConveyorSortState } from './logic';

sceneContractSuite(conveyorSortLogic, {
  id: 'conveyor-sort',
  controls: ['start', 'stop', 'estop', 'feeder_mode', 'box_pattern', 'pe_infeed_fail'],
  observables: [
    'conveyorRunning', 'beltSpeed', 'boxesOnBelt', 'boxesFed', 'boxesGood', 'boxesRejected',
    'missorted', 'jams', 'pusherPosition', 'lightGreen', 'lightAmber', 'lightRed',
  ],
  fuzzMs: 40_000,
});

type H = SceneHarness<ConveyorSortState>;

function running(pattern = 0): H {
  const h = createHarness(conveyorSortLogic);
  h.set('box_pattern', pattern);
  h.out('Conveyor_Run', true);
  return h;
}

/**
 * Correct sorter: FIFO tracking. Every box entering at PE_Infeed is loaded into the FIFO; PE_Tall marks
 * the box that is at the high eye; PE_Divert unloads the FIFO and fires the pusher for tall boxes.
 */
function sortingPlc(): FakePlc {
  const fifo: Array<{ t: number; tall: boolean }> = [];
  let prev = { infeed: false, tall: false, divert: false };
  return (io: FakeIo, t: number) => {
    const infeed = io.inputBool('PE_Infeed');
    const tall = io.inputBool('PE_Tall');
    const divert = io.inputBool('PE_Divert');
    if (infeed && !prev.infeed) fifo.push({ t, tall: false });
    if (tall && !prev.tall) {
      // The box at the high eye entered PE_Infeed ~3.2 s ago (1.6 m at 0.5 m/s).
      let best = fifo[0];
      for (const e of fifo) if (Math.abs(t - e.t - 3200) < Math.abs(t - (best?.t ?? 0) - 3200)) best = e;
      if (best) best.tall = true;
    }
    if (divert && !prev.divert) {
      const box = fifo.shift();
      if (box?.tall) io.setOutput('Pusher_Extend', true);
    }
    if (io.inputBool('Pusher_Extended')) io.setOutput('Pusher_Extend', false);
    prev = { infeed, tall, divert };
  };
}

describe('conveyor-sort: wiring', () => {
  it('uses the specified hardware and operands', () => {
    expect(conveyorSortLogic.hardware.modules.map((m) => m.catalog)).toEqual([
      '1756-L83E', '1756-IB16', '1756-OB16E', '1756-EN2T',
    ]);
    expect(conveyorSortLogic.hardware.chassis).toBe('1756-A7');
    const map = Object.fromEntries(conveyorSortLogic.io.map((p) => [p.alias, p.operand]));
    expect(map).toEqual({
      Start_PB: 'Local:1:I.Data.0',
      Stop_PB: 'Local:1:I.Data.1',
      PE_Infeed: 'Local:1:I.Data.2',
      PE_Tall: 'Local:1:I.Data.3',
      PE_Divert: 'Local:1:I.Data.4',
      Pusher_Extended: 'Local:1:I.Data.5',
      Pusher_Retracted: 'Local:1:I.Data.6',
      PE_Exit: 'Local:1:I.Data.7',
      EStop_OK: 'Local:1:I.Data.8',
      Conveyor_Run: 'Local:2:O.Data.0',
      Pusher_Extend: 'Local:2:O.Data.1',
      Feeder_Release: 'Local:2:O.Data.2',
      Light_Green: 'Local:2:O.Data.3',
      Light_Amber: 'Local:2:O.Data.4',
      Light_Red: 'Local:2:O.Data.5',
    });
    const sel = Object.fromEntries(conveyorSortLogic.controls.map((c) => [c.id, c.positions]));
    expect(sel.feeder_mode).toEqual(['AUTO', 'PLC']);
    expect(sel.box_pattern).toEqual(['Random', 'All short', 'All tall', 'Alternate']);
  });

  it('idle polarity: Stop & E-stop N.C. read 1, pusher retracted switch made', () => {
    const h = createHarness(conveyorSortLogic);
    h.step();
    expect(h.inBool('Start_PB')).toBe(false);
    expect(h.inBool('Stop_PB')).toBe(true);
    expect(h.inBool('EStop_OK')).toBe(true);
    expect(h.inBool('Pusher_Retracted')).toBe(true);
    expect(h.inBool('Pusher_Extended')).toBe(false);
    for (const pe of ['PE_Infeed', 'PE_Tall', 'PE_Divert', 'PE_Exit']) expect(h.inBool(pe)).toBe(false);
    h.set('start', true);
    h.set('stop', true);
    h.set('estop', true);
    h.step();
    expect(h.inBool('Start_PB')).toBe(true);
    expect(h.inBool('Stop_PB')).toBe(false);
    expect(h.inBool('EStop_OK')).toBe(false);
  });
});

describe('conveyor-sort: belt', () => {
  it('accelerates to 0.5 m/s within 0.2 s and stops within 0.2 s', () => {
    const h = createHarness(conveyorSortLogic);
    h.set('feeder_mode', 1);
    h.out('Conveyor_Run', true);
    h.run(100);
    expect(h.obsNum('beltSpeed')).toBeCloseTo(0.25, 5);
    h.run(100);
    expect(h.obsNum('beltSpeed')).toBeCloseTo(0.5, 5);
    expect(h.obs('conveyorRunning')).toBe(true);
    const p0 = h.state.beltPosition;
    h.run(2000);
    expect(h.state.beltPosition - p0).toBeCloseTo(1.0, 5);
    h.out('Conveyor_Run', false);
    h.run(200);
    expect(h.obsNum('beltSpeed')).toBe(0);
    expect(h.obs('conveyorRunning')).toBe(false);
  });

  it('E-stop stops the belt even with Conveyor_Run on (hardwired); PROG mode stops it too', () => {
    const h = running();
    h.run(1000);
    h.set('estop', true);
    h.run(200);
    expect(h.obsNum('beltSpeed')).toBe(0);
    h.set('estop', false);
    h.run(200);
    expect(h.obsNum('beltSpeed')).toBeCloseTo(0.5);
    h.io.running = false;
    h.run(200);
    expect(h.obsNum('beltSpeed')).toBe(0);
  });

  it('stack lights follow the outputs', () => {
    const h = createHarness(conveyorSortLogic);
    h.out('Light_Green', true);
    h.out('Light_Red', true);
    h.step();
    expect(h.observe()).toMatchObject({ lightGreen: true, lightAmber: false, lightRed: true });
  });
});

describe('conveyor-sort: feeder & photo-eyes', () => {
  it('AUTO feeder: drops only while the belt moves, keeps the infeed zone clear (visible spacing)', () => {
    const h = createHarness(conveyorSortLogic);
    h.run(2000);
    expect(h.obs('boxesFed')).toBe(0);
    h.out('Conveyor_Run', true);
    h.run(20);
    expect(h.obs('boxesFed')).toBe(1);
    expect(h.state.boxes[0]!.x).toBe(G.feederX);
    h.run(20_000);
    const fed = h.obsNum('boxesFed');
    expect(fed).toBeGreaterThanOrEqual(9);
    expect(fed).toBeLessThanOrEqual(11);
    const onBelt = h.state.boxes.filter((b) => b.state === 'belt');
    for (let i = 1; i < onBelt.length; i++) {
      expect(onBelt[i - 1]!.x - onBelt[i]!.x).toBeGreaterThan(1.0); // ≥ 0.7 m clear gap between boxes
    }
    h.out('Conveyor_Run', false);
    h.run(5000);
    expect(h.obsNum('boxesFed')).toBe(fed);
  });

  it('PE_Infeed sees the box ~1.2 s after the drop; the pe_infeed_fail fault forces 0', () => {
    const h = running(1);
    h.step();
    const ms = h.runUntil(() => h.inBool('PE_Infeed'), 3000);
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1400);
    h.set('pe_infeed_fail', true);
    h.step();
    expect(h.state.sensors.infeed).toBe(true);
    expect(h.inBool('PE_Infeed')).toBe(false);
    h.set('pe_infeed_fail', false);
    h.step();
    expect(h.inBool('PE_Infeed')).toBe(true);
  });

  it('PE_Tall is broken only by tall boxes', () => {
    for (const [pattern, expected] of [[1, false], [2, true]] as const) {
      const h = running(pattern);
      let seen = false;
      h.run(8000, () => {
        if (h.inBool('PE_Tall')) seen = true;
      });
      expect(seen).toBe(expected);
      expect(h.state.boxes.every((b) => b.tall === expected)).toBe(true);
    }
  });

  it('box patterns: alternate starts short; random is ~35 % tall', () => {
    const alt = running(3);
    alt.run(10_000);
    expect(alt.state.boxes.slice(0, 4).map((b) => b.tall)).toEqual([false, true, false, true]);

    const rnd = running(0);
    const seen = new Map<number, boolean>();
    rnd.run(400_000, () => {
      for (const b of rnd.state.boxes) seen.set(b.id, b.tall);
    });
    const tall = [...seen.values()].filter(Boolean).length;
    expect(seen.size).toBeGreaterThan(150);
    expect(tall / seen.size).toBeGreaterThan(0.27);
    expect(tall / seen.size).toBeLessThan(0.43);
  });

  it('PLC feeder mode: one box per Feeder_Release rising edge, only if the infeed zone is clear', () => {
    const h = createHarness(conveyorSortLogic);
    h.set('feeder_mode', 1);
    h.run(1000);
    expect(h.obs('boxesFed')).toBe(0);
    h.out('Feeder_Release', true);
    h.run(3000); // holding it does not release more
    expect(h.obs('boxesFed')).toBe(1);
    h.out('Feeder_Release', false);
    h.step();
    h.out('Feeder_Release', true); // belt stopped: zone still occupied -> ignored
    h.step();
    expect(h.obs('boxesFed')).toBe(1);
    h.out('Feeder_Release', false);
    h.out('Conveyor_Run', true);
    h.run(2500);
    h.out('Feeder_Release', true);
    h.step();
    expect(h.obs('boxesFed')).toBe(2);
  });
});

describe('conveyor-sort: pusher & sorting', () => {
  it('pusher extends in 250 ms and retracts in 300 ms; reed switches at the ends', () => {
    const h = createHarness(conveyorSortLogic);
    h.out('Pusher_Extend', true);
    h.run(240);
    expect(h.inBool('Pusher_Extended')).toBe(false);
    expect(h.inBool('Pusher_Retracted')).toBe(false);
    h.run(10);
    expect(h.obsNum('pusherPosition')).toBe(1);
    expect(h.inBool('Pusher_Extended')).toBe(true);
    h.out('Pusher_Extend', false);
    h.run(150);
    expect(h.obsNum('pusherPosition')).toBeCloseTo(0.5, 5);
    h.run(150);
    expect(h.obsNum('pusherPosition')).toBe(0);
    expect(h.inBool('Pusher_Retracted')).toBe(true);
  });

  it('a correct tracking program sorts every box: no missorts, no jams', () => {
    const h = running(0);
    h.plc = sortingPlc();
    h.run(120_000);
    const o = h.observe();
    expect(o.missorted).toBe(0);
    expect(o.jams).toBe(0);
    expect(o.boxesRejected).toBeGreaterThan(5);
    expect(o.boxesGood).toBeGreaterThan(20);
    expect(h.obsNum('boxesGood') + h.obsNum('boxesRejected') + h.obsNum('boxesOnBelt')).toBeGreaterThanOrEqual(
      h.obsNum('boxesFed') - 2,
    );
  });

  it('without a pusher every tall box is missorted to the good lane; short boxes are good', () => {
    const h = running(3);
    h.run(30_000);
    const o = h.observe();
    expect(o.boxesGood).toBeGreaterThan(3);
    expect(o.missorted).toBeGreaterThan(3);
    expect(Math.abs(Number(o.boxesGood) - Number(o.missorted))).toBeLessThanOrEqual(1);
    expect(o.boxesRejected).toBe(0);
  });

  it('extending on PE_Divert diverts the box; a short box in the chute is missorted', () => {
    const h = running(1);
    h.plc = (io) => {
      if (io.inputBool('PE_Divert')) io.setOutput('Pusher_Extend', true);
      if (io.inputBool('Pusher_Extended')) io.setOutput('Pusher_Extend', false);
    };
    h.runUntil(() => h.obsNum('missorted') === 1, 10_000);
    expect(h.obs('boxesRejected')).toBe(0);
    const pushed = h.state.boxes.find((b) => b.state !== 'belt')!;
    expect(pushed.lateral).toBeGreaterThan(0);
    h.run(3000);
    expect(h.state.boxes.find((b) => b.id === pushed.id)).toBeUndefined(); // slid into the bin
  });

  it('fires too late (box centre past +0.2 m at 60 %) → not diverted', () => {
    const h = running(2);
    h.runUntil(() => (h.state.boxes[0]?.x ?? 0) >= 4.26 - 0.075, 12_000);
    h.out('Pusher_Extend', true);
    h.run(400);
    h.out('Pusher_Extend', false);
    h.run(4000);
    expect(h.obs('boxesRejected')).toBe(0);
    expect(h.obs('missorted')).toBe(1);
    expect(h.obs('jams')).toBe(0);
  });

  it('a box reaching the extended paddle jams once and stays until the pusher retracts; others queue', () => {
    const h = running(1);
    h.out('Pusher_Extend', true);
    h.run(12_000);
    expect(h.obs('jams')).toBe(1);
    const first = h.state.boxes[0]!;
    expect(first.blocked).toBe(true);
    expect(first.x).toBeCloseTo(G.pusherX - G.paddleWidth / 2 - G.boxLength / 2, 5);
    // Boxes queue back-to-back behind the jam (the belt slides underneath).
    const second = h.state.boxes[1]!;
    expect(first.x - second.x).toBeCloseTo(G.boxLength, 5);
    h.run(5000);
    expect(h.obs('jams')).toBe(1);
    h.out('Pusher_Extend', false);
    h.run(300);
    h.run(500);
    expect(first.blocked).toBe(false);
    expect(first.x).toBeGreaterThan(3.8);
    h.run(6000);
    expect(h.obsNum('boxesGood')).toBeGreaterThanOrEqual(2);
  });

  it('PE_Exit sees boxes at the discharge end', () => {
    const h = running(1);
    const ms = h.runUntil(() => h.inBool('PE_Exit'), 15_000);
    // drop fall ~0.27 s + (5.65 - 0.3) m at 0.5 m/s
    expect(ms).toBeGreaterThan(10_600);
    expect(ms).toBeLessThan(11_200);
  });
});
