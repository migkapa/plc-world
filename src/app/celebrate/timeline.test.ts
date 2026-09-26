import { describe, expect, it } from 'vitest';
import { celebrationTimeline, countUp, replayGoal, xpDuration } from './timeline';

describe('celebration timeline', () => {
  it('pops earned stars one by one, then XP, level-up and achievements', () => {
    const cues = celebrationTimeline({ stars: 3, xpGained: 90, previousLevel: 1, newLevel: 2, newAchievements: ['first-light', 'hat-trick'] });
    const kinds = cues.map((c) => c.kind);
    expect(kinds).toEqual(['star', 'star', 'star', 'xpStart', 'xpEnd', 'levelUp', 'achievement', 'achievement', 'done']);
    const times = cues.map((c) => c.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times.slice(0, 3)).size).toBe(3);
  });

  it('skips XP and level-up when nothing was gained', () => {
    const cues = celebrationTimeline({ stars: 1, xpGained: 0, previousLevel: 3, newLevel: 3, newAchievements: [] });
    expect(cues.map((c) => c.kind)).toEqual(['star', 'done']);
  });

  it('clamps stars', () => {
    expect(celebrationTimeline({ stars: 7, xpGained: 0, previousLevel: 1, newLevel: 1, newAchievements: [] }).filter((c) => c.kind === 'star')).toHaveLength(3);
  });

  it('counts up with easing and ends exactly on target', () => {
    expect(countUp(100, 0, 1000)).toBe(0);
    expect(countUp(100, 500, 1000)).toBeGreaterThan(50);
    expect(countUp(100, 1000, 1000)).toBe(100);
    expect(countUp(100, 50, 0)).toBe(100);
    expect(xpDuration(0)).toBe(0);
    expect(xpDuration(50)).toBeGreaterThanOrEqual(500);
    expect(xpDuration(1e9)).toBe(1600);
  });
});

describe('replay goal', () => {
  it('offers a replay only when a better rating is still possible', () => {
    const m = { parInstructions: 2 };
    expect(replayGoal(m, { instructionCount: 2 }, 0, 3)).toBeUndefined();
    expect(replayGoal(m, { instructionCount: 3 }, 0, 2)).toBe('Replay to beat par');
    // a hint caps the mission at 2 stars for good
    expect(replayGoal(m, { instructionCount: 2 }, 1, 2)).toBeUndefined();
    expect(replayGoal(m, { instructionCount: 3 }, 1, 1)).toBe('Replay to beat par');
    expect(replayGoal({}, { instructionCount: 9 }, 0, 2)).toBe('Replay for 3 stars');
  });
});
