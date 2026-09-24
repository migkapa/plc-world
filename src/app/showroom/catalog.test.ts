import { describe, expect, it } from 'vitest';
import { getMission } from '../../game/missions';
import { SCENE_IDS } from '../../sim/scenes';
import { SHOWROOM_DEVICES, SHOWROOM_GROUPS, getShowroomDevice } from './catalog';

describe('showroom catalog', () => {
  it('has unique ids in known groups, every group populated', () => {
    const ids = SHOWROOM_DEVICES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(SHOWROOM_GROUPS.map((g) => g.id));
    for (const d of SHOWROOM_DEVICES) expect(groups.has(d.group), d.id).toBe(true);
    for (const g of SHOWROOM_GROUPS) expect(SHOWROOM_DEVICES.some((d) => d.group === g.id), g.id).toBe(true);
  });

  for (const d of SHOWROOM_DEVICES) {
    it(`${d.id}: content is complete and links resolve`, () => {
      expect(d.name && d.catalog && d.tagline && d.what && d.where).toBeTruthy();
      expect(d.specs.length).toBeGreaterThanOrEqual(3);
      expect(d.wiring.summary.length).toBeGreaterThan(10);
      expect(d.hotspots.length).toBeGreaterThanOrEqual(2);
      expect(d.hotspots.length).toBeLessThanOrEqual(8);
      for (const h of d.hotspots) {
        expect(h.at.every(Number.isFinite), h.label).toBe(true);
        expect(h.text.length, h.label).toBeGreaterThan(10);
      }
      expect([...d.camera.position, ...d.camera.target].every(Number.isFinite)).toBe(true);
      expect(d.size).toBeGreaterThan(0);
      for (const s of d.inWorld.scenes) expect(SCENE_IDS as readonly string[], s).toContain(s);
      for (const m of d.inWorld.missions) expect(getMission(m), m).toBeDefined();
      for (const r of d.related ?? []) expect(getShowroomDevice(r), r).toBeDefined();
      const names = d.indicators.map((i) => i.name);
      expect(new Set(names).size, 'indicator names are React keys').toBe(names.length);
    });
  }
});
