/**
 * Guided-tour bookkeeping in the player store (`profile.tutorials`, `finishTutorial`, `tutorialFinished` events).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STAT, applyEventToStats } from './achievements';
import { createDefaultProfile, gameClock, normalizeProfile, useGame } from './store';

const g = () => useGame.getState();
let now = 1_000;

beforeEach(() => {
  now = 1_000;
  gameClock.now = () => now;
  useGame.setState({ profile: createDefaultProfile(), session: {}, recentUnlocks: [] });
});

describe('tutorials', () => {
  it('a fresh profile has no tour record', () => {
    expect(createDefaultProfile().tutorials).toBeUndefined();
    expect(g().profile.tutorials?.['first-rung']).toBeUndefined();
  });

  it('finishTutorial remembers completion and counts it as a stat', () => {
    g().finishTutorial('first-rung', 'completed');
    expect(g().profile.tutorials?.['first-rung']).toEqual({ status: 'completed', at: 1_000 });
    expect(g().profile.stats?.[STAT.tutorialsCompleted]).toBe(1);
  });

  it('a skip is remembered but not counted; a completed tour is never downgraded by a skipped replay', () => {
    g().finishTutorial('first-rung', 'skipped');
    expect(g().profile.tutorials?.['first-rung']?.status).toBe('skipped');
    expect(g().profile.stats?.[STAT.tutorialsCompleted] ?? 0).toBe(0);
    now = 2_000;
    g().finishTutorial('first-rung', 'completed');
    now = 3_000;
    g().finishTutorial('first-rung', 'skipped');
    expect(g().profile.tutorials?.['first-rung']).toEqual({ status: 'completed', at: 3_000 });
    expect(g().profile.stats?.[STAT.tutorialsCompleted]).toBe(1);
  });

  it('never touches XP, missions or achievements by itself', () => {
    g().finishTutorial('first-rung', 'completed');
    expect(g().profile.xp).toBe(0);
    expect(g().profile.missions).toEqual({});
  });

  it('normalizeProfile keeps valid records and drops junk', () => {
    const p = normalizeProfile({ tutorials: { a: { status: 'completed', at: 5 }, b: { status: 'nope', at: 1 }, c: 3, d: { status: 'skipped' } } });
    expect(p.tutorials).toEqual({ a: { status: 'completed', at: 5 }, d: { status: 'skipped', at: 0 } });
    expect(normalizeProfile({}).tutorials).toBeUndefined();
  });

  it('resetProgress forgets tours (a fresh start offers the tour again)', () => {
    g().finishTutorial('first-rung', 'completed');
    g().resetProgress();
    expect(g().profile.tutorials).toBeUndefined();
  });

  it('applyEventToStats counts only finished (not skipped) tours', () => {
    let s = applyEventToStats({}, { type: 'tutorialFinished', tutorialId: 'x', skipped: true });
    expect(s[STAT.tutorialsCompleted]).toBeUndefined();
    s = applyEventToStats(s, { type: 'tutorialFinished', tutorialId: 'x', skipped: false });
    expect(s[STAT.tutorialsCompleted]).toBe(1);
  });
});
