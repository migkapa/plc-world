import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, RANKS, levelForXp, rankForLevel, xpForLevel } from './ranks';

describe('level curve', () => {
  it('cumulative XP: level 1 = 0, level n = round(120 * (n-1)^1.6)', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(120);
    expect(xpForLevel(3)).toBe(Math.round(120 * 2 ** 1.6));
    expect(xpForLevel(10)).toBe(Math.round(120 * 9 ** 1.6));
    for (let n = 2; n <= 40; n++) expect(xpForLevel(n)).toBeGreaterThan(xpForLevel(n - 1));
  });

  it('levelForXp boundaries and progress', () => {
    expect(levelForXp(0)).toMatchObject({ level: 1, title: 'Apprentice', currentAt: 0, nextAt: 120, progress: 0, xpToNext: 120 });
    expect(levelForXp(119).level).toBe(1);
    expect(levelForXp(120).level).toBe(2);
    expect(levelForXp(60).progress).toBeCloseTo(0.5);
    const l = levelForXp(xpForLevel(7) + 1);
    expect(l.level).toBe(7);
    expect(l.title).toBe('Controls Technician');
    expect(l.nextRank?.title).toBe('Senior Controls Tech');
    expect(levelForXp(-50).level).toBe(1);
    expect(levelForXp(Number.NaN).level).toBe(1);
    const top = levelForXp(1e12);
    expect(top.level).toBe(MAX_LEVEL);
    expect(top.progress).toBe(1);
    expect(top.nextRank).toBeUndefined();
  });

  it('ten ranks in career order with colours', () => {
    expect(RANKS.map((r) => r.title)).toEqual([
      'Apprentice',
      'Junior Technician',
      'Maintenance Tech',
      'Controls Technician',
      'Senior Controls Tech',
      'Controls Engineer',
      'Automation Engineer',
      'Lead Integrator',
      'Principal Engineer',
      'Master of Automation',
    ]);
    for (const r of RANKS) expect(r.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(rankForLevel(1).title).toBe('Apprentice');
    expect(rankForLevel(20).title).toBe('Master of Automation');
    expect(rankForLevel(99).title).toBe('Master of Automation');
  });
});
