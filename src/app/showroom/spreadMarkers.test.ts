import { describe, expect, it } from 'vitest';
import { spreadMarkers } from './spreadMarkers';

const minDist = (xs: Float32Array, ys: Float32Array, on: boolean[]) => {
  let m = Infinity;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) if (on[i] && on[j]) m = Math.min(m, Math.hypot(xs[i]! - xs[j]!, ys[i]! - ys[j]!));
  return m;
};

describe('spreadMarkers', () => {
  it('separates a crowded cluster to about the minimum gap and keeps markers near their features', () => {
    const xs = new Float32Array([100, 104, 98, 300]);
    const ys = new Float32Array([100, 102, 108, 50]);
    const on = [true, true, true, true];
    spreadMarkers(xs, ys, on, 24, 8);
    expect(minDist(xs, ys, on)).toBeGreaterThan(20);
    expect(Math.hypot(xs[0]! - 100, ys[0]! - 100)).toBeLessThan(30);
    expect(xs[3]).toBe(300);
  });
  it('ignores hidden markers and separates coincident ones deterministically', () => {
    const xs = new Float32Array([50, 50, 50]);
    const ys = new Float32Array([50, 50, 50]);
    spreadMarkers(xs, ys, [true, true, false], 20);
    expect(Math.hypot(xs[0]! - xs[1]!, ys[0]! - ys[1]!)).toBeCloseTo(20, 1);
    expect([xs[2], ys[2]]).toEqual([50, 50]);
  });
});
