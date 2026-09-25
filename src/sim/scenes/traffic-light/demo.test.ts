import { describe, expect, it } from 'vitest';
import { createDemoRuntime } from '../../demo';
import { TRAFFIC_DEMO_RUNGS, TRAFFIC_DEMO_TAGS } from './demo';
import { trafficLightLogic, type TrafficLightState } from './logic';

const setup = () => createDemoRuntime(trafficLightLogic, TRAFFIC_DEMO_RUNGS, { tags: TRAFFIC_DEMO_TAGS });

describe('traffic-light demo program', () => {
  it('verifies and cycles without a single conflict; cars and pedestrians get through', () => {
    const { controller, runtime } = setup();
    expect(controller.verify()).toEqual([]);
    expect(controller.getStatus().running).toBe(true);
    let sawEwGreen = false;
    let sawWalk = false;
    let sawFlashingHand = false;
    let lastDw = false;
    let dwEdges = 0;
    for (let t = 0; t < 120_000; t += 100) {
      if (t % 20_000 === 5_000) {
        runtime.setControl('ped', true);
        runtime.step(100);
        runtime.setControl('ped', false);
      } else runtime.step(100);
      const o = runtime.observe();
      expect(o.conflict).toBe(false);
      if (o.ewGreen) sawEwGreen = true;
      if (o.walk) sawWalk = true;
      if (!o.walk && o.ewGreen && o.dontWalk !== lastDw) {
        dwEdges++;
        if (dwEdges > 2) sawFlashingHand = true;
      }
      lastDw = Boolean(o.dontWalk);
    }
    const o = runtime.observe();
    expect(sawEwGreen).toBe(true);
    expect(sawWalk).toBe(true);
    expect(sawFlashingHand).toBe(true);
    expect(o.conflicts).toBe(0);
    expect(Number(o.carsPassed)).toBeGreaterThan(20);
    expect(Number(o.pedCrossed)).toBeGreaterThanOrEqual(4);
    expect((runtime.state as TrafficLightState).collisions).toBe(0);
  });

  it('rests in NS green without calls and serves a side-street car', () => {
    const { runtime } = setup();
    runtime.setControl('auto_traffic', false);
    runtime.step(20_000);
    expect(runtime.observe().nsGreen).toBe(true);
    runtime.setControl('spawn_ew', true);
    runtime.step(50);
    runtime.setControl('spawn_ew', false);
    let served = false;
    for (let i = 0; i < 300 && !served; i++) {
      runtime.step(100);
      served = Boolean(runtime.observe().ewGreen);
    }
    expect(served).toBe(true);
    runtime.step(15_000);
    expect(Number(runtime.observe().carsPassed)).toBe(1);
    expect(runtime.observe().nsGreen).toBe(true);
  });

  it('night mode flashes NS yellow / EW red, and recovers through all red', () => {
    const { runtime } = setup();
    runtime.step(5_000);
    runtime.setControl('night', true);
    let yOn = 0;
    let yOff = 0;
    for (let i = 0; i < 60; i++) {
      runtime.step(100);
      const o = runtime.observe();
      expect(o.nsGreen || o.ewGreen || o.ewYellow || o.walk || o.dontWalk || o.nsRed).toBe(false);
      if (o.nsYellow) yOn++;
      else yOff++;
      expect(o.ewRed).toBe(o.nsYellow);
    }
    expect(yOn).toBeGreaterThan(20);
    expect(yOff).toBeGreaterThan(20);
    runtime.step(20_000);
    expect(runtime.observe().conflicts).toBe(0);
    runtime.setControl('night', false);
    runtime.step(200);
    let o = runtime.observe();
    expect(o.nsRed && o.ewRed).toBe(true);
    runtime.step(2_000);
    o = runtime.observe();
    expect(o.nsGreen).toBe(true);
    runtime.step(60_000);
    expect(runtime.observe().conflicts).toBe(0);
  });

  it('gives pedestrians a 5 s WALK and a 7 s flashing clearance, never overlapping the main street', () => {
    const { runtime } = setup();
    runtime.setControl('auto_traffic', false);
    runtime.step(12_000);
    runtime.setControl('ped', true);
    runtime.step(200);
    runtime.setControl('ped', false);
    let walkMs = 0;
    let clearMs = 0;
    for (let t = 0; t < 40_000; t += 50) {
      runtime.step(50);
      const o = runtime.observe();
      if (o.walk) {
        walkMs += 50;
        expect(o.nsGreen || o.nsYellow).toBe(false);
      }
      if (walkMs > 0 && !o.walk && o.ewGreen) clearMs += 50;
    }
    expect(walkMs).toBeGreaterThanOrEqual(4900);
    expect(walkMs).toBeLessThanOrEqual(5100);
    expect(clearMs).toBeGreaterThanOrEqual(6900);
    expect(Number(runtime.observe().pedCrossed)).toBe(1);
    expect(runtime.observe().conflicts).toBe(0);
  });

  it('keeps its memory in internal tags, not in the I/O image', () => {
    const { runtime } = setup();
    let spareToggles = 0;
    let prev = false;
    for (let t = 0; t < 60_000; t += 100) {
      runtime.step(100);
      const v = runtime.controller.tags.readBool('Local:2:O.Pt08.Data');
      if (v !== prev) spareToggles++;
      prev = v;
    }
    expect(spareToggles).toBe(0);
    expect(runtime.controller.tags.readNumber('Local:1:I.DiagnosticSequenceCount')).toBe(0);
  });
});
