import { describe, expect, it } from 'vitest';
import { distanceForPixels } from './lod';

describe('distanceForPixels', () => {
  it('is the camera distance at which an object covers the given pixel height', () => {
    // 1 m object, 90° fov (tan 45° = 1), 1000 px canvas: 100 px at d = 1 * 1000 / (2 * 1 * 100) = 5 m
    expect(distanceForPixels(1, 100, 90, 1000)).toBeCloseTo(5, 6);
    // a 1756-A7 rack (0.3676 m) at 90 px in a 900 px tall canvas with the Stage's 40° fov
    const d = distanceForPixels(0.3676, 90, 40, 900);
    expect(d).toBeGreaterThan(4.9);
    expect(d).toBeLessThan(5.1);
  });

  it('scales with the canvas size (a thumbnail switches much closer)', () => {
    expect(distanceForPixels(0.3676, 90, 40, 300)).toBeCloseTo(distanceForPixels(0.3676, 90, 40, 900) / 3, 6);
  });
});
