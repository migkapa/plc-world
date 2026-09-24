import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, STAT, applyEventToStats, evaluateAchievements, getAchievement, type GameEvent } from './achievements';
import { missionsByChapter } from './missions';
import { createDefaultProfile } from './store';
import type { PlayerProfile } from './types';

const NOON = new Date(2026, 8, 24, 12, 0, 0);
const NIGHT = new Date(2026, 8, 24, 2, 30, 0);
const ping: GameEvent = { type: 'toggleBitUsed' };

function withMissions(ids: string[], stars: 0 | 1 | 2 | 3 = 3, hintsUsed = 0): PlayerProfile {
  const p = createDefaultProfile();
  for (const id of ids) p.missions[id] = { completed: true, stars, hintsUsed, attempts: 1, bestInstructionCount: 1 };
  return p;
}

const done = (id: string, extra: Partial<Extract<GameEvent, { type: 'missionCompleted' }>> = {}): GameEvent => ({
  type: 'missionCompleted',
  missionId: id,
  stars: 3,
  hintsUsed: 0,
  instructionCount: 2,
  durationMs: 600_000,
  firstAttempt: false,
  ...extra,
});

describe('achievement catalogue', () => {
  it('has at least 24 achievements with unique ids, icons, xp and some secrets', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) {
      expect(a.title.trim()).not.toBe('');
      expect(a.description.trim()).not.toBe('');
      expect(a.icon).toMatch(/^[A-Z][A-Za-z]+$/);
      expect(a.xp).toBeGreaterThan(0);
    }
    expect(ACHIEVEMENTS.filter((a) => a.secret).length).toBeGreaterThanOrEqual(3);
    for (const id of ['first-light', 'sealed-the-deal', 'safety-first', 'clockwork', 'hat-trick', 'no-training-wheels', 'speed-runner', 'force-of-habit', 'fault-finder', 'night-owl', 'perfectionist', 'pedant']) {
      expect(getAchievement(id), id).toBeDefined();
    }
  });
});

describe('evaluateAchievements', () => {
  it('nothing for a fresh profile', () => {
    expect(evaluateAchievements(createDefaultProfile(), ping, NOON)).toEqual([]);
  });

  it('story milestones follow completed missions', () => {
    expect(evaluateAchievements(withMissions(['1-1'], 1), ping, NOON)).toEqual(['first-light']);
    const ids = evaluateAchievements(withMissions(['1-1', '2-1', '2-3'], 2), ping, NOON);
    expect(ids).toEqual(expect.arrayContaining(['first-light', 'sealed-the-deal', 'safety-first']));
    expect(ids).not.toContain('hat-trick');
    expect(evaluateAchievements(withMissions(['1-2'], 3), ping, NOON)).toContain('hat-trick');
  });

  it('already unlocked achievements are not returned again', () => {
    const p = withMissions(['1-1'], 1);
    p.achievements['first-light'] = 1;
    expect(evaluateAchievements(p, ping, NOON)).toEqual([]);
  });

  it('chapter trophies, no hints and perfect chapters', () => {
    const ch1 = missionsByChapter('power-up').map((m) => m.id);
    const perfect = evaluateAchievements(withMissions(ch1, 3, 0), ping, NOON);
    expect(perfect).toEqual(expect.arrayContaining(['chapter-power-up', 'no-training-wheels', 'perfectionist']));
    const hinted = evaluateAchievements(withMissions(ch1, 2, 1), ping, NOON);
    expect(hinted).toContain('chapter-power-up');
    expect(hinted).not.toContain('no-training-wheels');
    expect(hinted).not.toContain('perfectionist');
    const partial = evaluateAchievements(withMissions(ch1.slice(0, -1), 3, 0), ping, NOON);
    expect(partial).not.toContain('chapter-power-up');
    // An empty chapter can never be "complete".
    expect(evaluateAchievements(withMissions(ch1), ping, NOON)).not.toContain('chapter-troubleshooting');
  });

  it('event-driven: speed runner, one-and-done, never give up, night owl', () => {
    const p = withMissions(['2-3'], 1);
    p.achievements['sealed-the-deal'] = 1;
    p.achievements['safety-first'] = 1;
    expect(evaluateAchievements(p, done('2-3', { durationMs: 90_000 }), NOON)).toContain('speed-runner');
    expect(evaluateAchievements(p, done('2-3', { durationMs: 200_000 }), NOON)).not.toContain('speed-runner');
    expect(evaluateAchievements(p, done('1-1', { durationMs: 5_000 }), NOON)).not.toContain('speed-runner'); // difficulty 1
    expect(evaluateAchievements(p, done('2-3', { firstAttempt: true }), NOON)).toContain('one-and-done');
    expect(evaluateAchievements(p, done('2-3', { failedRuns: 5 }), NOON)).toContain('never-give-up');
    expect(evaluateAchievements(p, done('2-3', { failedRuns: 4 }), NOON)).not.toContain('never-give-up');
    expect(evaluateAchievements(p, done('2-3'), NIGHT)).toContain('night-owl');
    expect(evaluateAchievements(p, done('2-3'), NOON)).not.toContain('night-owl');
    expect(evaluateAchievements(p, ping, NIGHT)).not.toContain('night-owl');
  });

  it('pedant: 10 missions at or under par', () => {
    const ids = [...missionsByChapter('power-up'), ...missionsByChapter('motor-control')].filter((m) => m.parInstructions !== undefined).map((m) => m.id);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(evaluateAchievements(withMissions(ids.slice(0, 10)), ping, NOON)).toContain('pedant');
    expect(evaluateAchievements(withMissions(ids.slice(0, 9)), ping, NOON)).not.toContain('pedant');
  });

  it('stats-driven achievements', () => {
    const p = createDefaultProfile();
    p.stats = { [STAT.forcesUsed]: 1, [STAT.majorFaultsCleared]: 1, [STAT.sandboxMs]: 600_000, [STAT.estopPresses]: 10, [STAT.renamed]: 1 };
    expect(evaluateAchievements(p, ping, NOON)).toEqual(
      expect.arrayContaining(['force-of-habit', 'fault-finder', 'tinkerer', 'big-red-button', 'name-tag']),
    );
    p.stats[STAT.sandboxMs] = 599_999;
    expect(evaluateAchievements(p, ping, NOON)).not.toContain('tinkerer');
  });

  it('streaks and levels', () => {
    const p = createDefaultProfile();
    p.streakDays = 7;
    p.xp = 5000;
    expect(evaluateAchievements(p, ping, NOON)).toEqual(expect.arrayContaining(['on-a-roll', 'dedicated', 'moving-up', 'career-path']));
  });
});

describe('applyEventToStats', () => {
  it('counts events without mutating the input', () => {
    const before = { [STAT.rungEdits]: 2 };
    let s = applyEventToStats(before, { type: 'rungEdited', count: 3 });
    s = applyEventToStats(s, { type: 'sandboxTime', ms: 1500 });
    s = applyEventToStats(s, { type: 'sandboxTime', ms: -5 });
    s = applyEventToStats(s, { type: 'controlUsed', sceneId: 'motor-station', controlId: 'estop' });
    s = applyEventToStats(s, { type: 'controlUsed', sceneId: 'motor-station', controlId: 'start' });
    s = applyEventToStats(s, { type: 'forceUsed' });
    expect(before).toEqual({ [STAT.rungEdits]: 2 });
    expect(s).toMatchObject({ rungEdits: 5, sandboxMs: 1500, estopPresses: 1, controlsUsed: 2, forcesUsed: 1 });
  });
});
