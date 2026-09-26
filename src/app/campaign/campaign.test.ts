import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../../game/chapters';
import { MISSIONS, missionsByChapter } from '../../game/missions';
import { createDefaultProfile } from '../../game/store';
import type { MissionProgress, PlayerProfile } from '../../game/types';
import { streakInfo } from '../hud/player';
import { computeMapLayout } from './layout';
import { chapterUnlock, missionLockReason, missionState, nextPlayableMission } from './progress';

const done = (stars: 1 | 2 | 3 = 3): MissionProgress => ({ completed: true, stars, hintsUsed: 0, attempts: 1 });

function withDone(ids: string[]): PlayerProfile {
  const p = createDefaultProfile();
  for (const id of ids) p.missions[id] = done();
  return p;
}

describe('campaign map layout', () => {
  for (const width of [340, 390, 700, 760, 1000, 1120]) {
    it(`places every mission inside the map at ${width}px without overlaps`, () => {
      const L = computeMapLayout(width, CHAPTERS, missionsByChapter);
      const nodes = L.regions.flatMap((r) => r.nodes);
      expect(nodes).toHaveLength(MISSIONS.length);
      expect(L.mode).toBe(width >= 760 ? 'wide' : 'narrow');
      for (const n of nodes) {
        expect(n.x - n.r).toBeGreaterThanOrEqual(0);
        expect(n.x + n.r).toBeLessThanOrEqual(L.width);
        expect(n.y + n.r).toBeLessThan(L.height);
      }
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r + 8);
        }
      // one road segment between consecutive missions + start/finish
      const roads = L.segments.filter((s) => s.kind === 'road' || s.kind === 'bridge');
      expect(roads).toHaveLength(MISSIONS.length - 1);
      expect(L.segments.some((s) => s.kind === 'finish')).toBe(true);
    });
  }

  it('keeps nodes (and the bobbing NEXT marker above them) clear of chapter banners', () => {
    for (const width of [390, 1000, 1440]) {
      const L = computeMapLayout(width, CHAPTERS, missionsByChapter);
      for (const reg of L.regions) {
        const h = reg.header;
        // NEXT marker: 10 px (18 px for bosses) gap + ~20 px tall + 6 px bob
        for (const n of reg.nodes) expect(n.y - n.r).toBeGreaterThanOrEqual(h.y + h.h + (n.boss ? 44 : 36));
      }
    }
  });
});

describe('campaign progress helpers', () => {
  it('starts with 1-1 as the only playable mission', () => {
    const p = createDefaultProfile();
    expect(nextPlayableMission(p)?.id).toBe('1-1');
    expect(missionState(p, MISSIONS[0]!)).toBe('available');
    expect(missionState(p, MISSIONS[1]!)).toBe('locked');
    expect(missionLockReason(p, MISSIONS[1]!)).toMatch(/Complete 1-1/);
  });

  it('explains how to unlock the next chapter (boss or 70 %)', () => {
    const p = withDone(['1-1', '1-2']);
    const cu = chapterUnlock(p, 'motor-control');
    expect(cu.unlocked).toBe(false);
    expect(cu.needed).toBe(Math.ceil(missionsByChapter('power-up').length * 0.7));
    expect(cu.hint).toMatch(/boss of Chapter 1/);
    expect(chapterUnlock(p, 'timing').hint).toMatch(/Unlock Chapter 2/);
    const ch1 = missionsByChapter('power-up').map((m) => m.id);
    const opened = withDone(ch1.slice(0, cu.needed));
    expect(chapterUnlock(opened, 'motor-control').unlocked).toBe(true);
  });

  it('continues with the first unfinished unlocked mission', () => {
    const p = withDone(['1-1', '1-2', '1-3']);
    expect(nextPlayableMission(p)?.id).toBe('1-4');
    const all = withDone(MISSIONS.map((m) => m.id));
    expect(nextPlayableMission(all)).toBeUndefined();
  });

  it('shows a streak only while it is alive', () => {
    const now = new Date(2026, 8, 24, 12).getTime();
    const p = createDefaultProfile();
    p.streakDays = 5;
    p.lastActiveDay = '2026-09-24';
    expect(streakInfo(p, now)).toEqual({ days: 5, activeToday: true, atRisk: false });
    p.lastActiveDay = '2026-09-23';
    expect(streakInfo(p, now)).toEqual({ days: 5, activeToday: false, atRisk: true });
    p.lastActiveDay = '2026-09-20';
    expect(streakInfo(p, now).days).toBe(0);
  });
});
