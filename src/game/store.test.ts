import { beforeEach, describe, expect, it } from 'vitest';
import { getMission, missionsByChapter } from './missions';
import {
  PROFILE_STORAGE_KEY,
  PROFILE_VERSION,
  chapterProgress,
  createDefaultProfile,
  gameClock,
  isChapterUnlockedFor,
  missionXpValue,
  normalizeProfile,
  totalStars,
  useGame,
} from './store';
import type { MissionRunResult } from './types';
import { runMission } from './validation';

const DAY = 24 * 3600 * 1000;
const T0 = new Date(2026, 8, 24, 10, 0, 0).getTime();
let now = T0;

function passed(id: string, stars: 1 | 2 | 3 = 3, instructionCount = 2): MissionRunResult {
  return { missionId: id, passed: true, tests: [], verifyErrors: [], instructionCount, stars };
}
function failed(id: string): MissionRunResult {
  return { missionId: id, passed: false, tests: [{ name: 't', passed: false, failure: 'x', steps: [] }], verifyErrors: [], instructionCount: 2, stars: 0 };
}
const g = () => useGame.getState();
const progress = (id: string) => g().profile.missions[id];

beforeEach(() => {
  now = T0;
  gameClock.now = () => now;
  useGame.setState({ profile: createDefaultProfile(), session: {}, recentUnlocks: [] });
});

describe('persistence', () => {
  it('uses the versioned localStorage key', () => {
    const opts = useGame.persist.getOptions();
    expect(opts.name).toBe(PROFILE_STORAGE_KEY);
    expect(PROFILE_STORAGE_KEY).toBe('plc-world-profile-v1');
    expect(opts.version).toBe(PROFILE_VERSION);
  });

  it('persists only the profile and migrates / repairs old data on rehydrate', async () => {
    g().setName('Alex');
    const storage = useGame.persist.getOptions().storage!;
    const saved = (await storage.getItem(PROFILE_STORAGE_KEY)) as { state: Record<string, unknown>; version: number };
    expect(Object.keys(saved.state)).toEqual(['profile']);
    expect((saved.state.profile as { name: string }).name).toBe('Alex');

    await storage.setItem(PROFILE_STORAGE_KEY, {
      version: 0,
      state: { profile: { name: 'Old', xp: '12', missions: { '1-1': { completed: true, stars: 9 }, junk: 3 }, settings: { quality: 'ultra' } } },
    });
    await useGame.persist.rehydrate();
    const p = g().profile;
    expect(p.name).toBe('Old');
    expect(p.xp).toBe(0);
    expect(p.missions['1-1']).toMatchObject({ completed: true, stars: 3, hintsUsed: 0, attempts: 0 });
    expect(p.missions.junk).toBeUndefined();
    expect(p.settings.quality).toBe('high');
  });

  it('normalizeProfile survives garbage', () => {
    expect(normalizeProfile(null)).toEqual(createDefaultProfile());
    expect(normalizeProfile('x').name).toBe(createDefaultProfile().name);
    const p = normalizeProfile({ missions: { a: { completed: false, stars: 3 } }, achievements: { x: 5, y: 'no' }, stats: { s: 2, t: 'bad' } });
    expect(p.missions.a!.stars).toBe(0);
    expect(p.achievements).toEqual({ x: 5 });
    expect(p.stats).toEqual({ s: 2 });
  });
});

describe('XP only for improvements', () => {
  it('first clear pays mission.xp (+25 % per extra star), replays pay nothing', () => {
    const m = getMission('1-2')!;
    const first = g().completeMission('1-2', passed('1-2', 1), 30_000);
    expect(first.firstClear).toBe(true);
    expect(first.improved).toBe(true);
    expect(first.missionXp).toBe(m.xp);
    const again = g().completeMission('1-2', passed('1-2', 1));
    expect(again.missionXp).toBe(0);
    expect(again.xpGained).toBe(0);
    expect(again.improved).toBe(false);
    const better = g().completeMission('1-2', passed('1-2', 3));
    expect(better.missionXp).toBe(missionXpValue(m, 3) - missionXpValue(m, 1));
    expect(better.missionXp).toBe(Math.round(m.xp * 0.5));
    expect(better.improved).toBe(true);
    expect(better.previousStars).toBe(1);
    const worse = g().completeMission('1-2', passed('1-2', 1));
    expect(worse.missionXp).toBe(0);
    expect(progress('1-2')!.stars).toBe(3);
    const achievementXp = first.achievementXp + again.achievementXp + better.achievementXp + worse.achievementXp;
    expect(g().profile.xp).toBe(missionXpValue(m, 3) + achievementXp);
  });

  it('a 3-star first clear pays 150 % at once', () => {
    const m = getMission('1-3')!;
    expect(g().completeMission('1-3', passed('1-3', 3)).missionXp).toBe(Math.round(m.xp * 1.5));
  });

  it('fewer instructions counts as an improvement but pays no XP', () => {
    g().completeMission('1-1', passed('1-1', 1, 5));
    const r = g().completeMission('1-1', passed('1-1', 1, 3));
    expect(r.improved).toBe(true);
    expect(r.missionXp).toBe(0);
    expect(progress('1-1')!.bestInstructionCount).toBe(3);
  });

  it('failed runs pay nothing and are counted', () => {
    const r = g().completeMission('1-1', failed('1-1'));
    expect(r.xpGained).toBe(0);
    expect(progress('1-1')?.completed ?? false).toBe(false);
    expect(g().session['1-1']!.failedRuns).toBe(1);
    expect(g().profile.stats?.testRunsFailed).toBe(1);
  });

  it('ignores a result for another mission', () => {
    expect(g().completeMission('1-1', passed('1-2')).xpGained).toBe(0);
    expect(progress('1-1')).toBeUndefined();
  });

  it('reports level changes and achievement XP', () => {
    const r = g().completeMission('1-1', passed('1-1', 3), 20_000);
    expect(r.newAchievements).toEqual(expect.arrayContaining(['first-light', 'hat-trick']));
    expect(r.achievementXp).toBeGreaterThan(0);
    expect(r.xpGained).toBe(r.missionXp + r.achievementXp);
    expect(r.previousLevel).toBe(1);
    expect(r.newLevel).toBeGreaterThanOrEqual(1);
    expect(g().profile.achievements['first-light']).toBe(T0);
    expect(g().consumeUnlocks()).toEqual(r.newAchievements);
    expect(g().consumeUnlocks()).toEqual([]);
  });
});

describe('hints', () => {
  it('reveals hints one by one and caps stars at 2', () => {
    const n = getMission('1-2')!.hints.length;
    for (let i = 0; i < n; i++) expect(g().useHint('1-2')).toBe(i);
    expect(g().useHint('1-2')).toBe(-1);
    expect(g().revealHint('1-2')).toBe(-1);
    expect(g().useHint('nope')).toBe(-1);
    expect(progress('1-2')!.hintsUsed).toBe(n);
    const r = g().completeMission('1-2', passed('1-2', 3));
    expect(r.stars).toBe(2);
    expect(progress('1-2')!.stars).toBe(2);
    expect(r.newAchievements).not.toContain('hat-trick');
  });

  it('runMission + store agree on hint-capped stars', () => {
    const m = getMission('1-1')!;
    g().useHint('1-1');
    const result = runMission(m, m.solution.rungs, { hintsUsed: progress('1-1')!.hintsUsed });
    expect(result.stars).toBe(2);
    expect(g().completeMission('1-1', result).stars).toBe(2);
  });
});

describe('attempts, streaks and first tries', () => {
  it('startMission counts attempts and keeps a daily streak', () => {
    g().startMission('1-1');
    g().startMission('1-1');
    expect(progress('1-1')!.attempts).toBe(2);
    expect(g().profile.streakDays).toBe(1);
    now = T0 + DAY;
    g().startMission('1-1');
    expect(g().profile.streakDays).toBe(2);
    now = T0 + 2 * DAY;
    const ids = g().startMission('1-2');
    expect(g().profile.streakDays).toBe(3);
    expect(ids).toContain('on-a-roll');
    now = T0 + 4 * DAY;
    g().startMission('1-2');
    expect(g().profile.streakDays).toBe(1);
    expect(g().startMission('nope')).toEqual([]);
  });

  it('one-and-done needs a first clear with no failed run', () => {
    g().startMission('2-3');
    expect(g().completeMission('2-3', passed('2-3', 3), 300_000).newAchievements).toContain('one-and-done');

    useGame.setState({ profile: createDefaultProfile(), session: {}, recentUnlocks: [] });
    g().startMission('2-3');
    g().completeMission('2-3', failed('2-3'));
    expect(g().completeMission('2-3', passed('2-3', 3), 300_000).newAchievements).not.toContain('one-and-done');
  });

  it('never-give-up after five failed runs; testRunFailed events count too', () => {
    g().startMission('1-4');
    for (let i = 0; i < 4; i++) g().completeMission('1-4', failed('1-4'));
    g().recordEvent({ type: 'testRunFailed', missionId: '1-4' });
    expect(g().session['1-4']!.failedRuns).toBe(5);
    expect(g().completeMission('1-4', passed('1-4', 2)).newAchievements).toContain('never-give-up');
    expect(g().session['1-4']!.failedRuns).toBe(0);
  });
});

describe('unlocking', () => {
  it('missions unlock in order inside a chapter', () => {
    expect(g().isUnlocked('1-1')).toBe(true);
    expect(g().isUnlocked('1-2')).toBe(false);
    g().completeMission('1-1', passed('1-1'));
    expect(g().isUnlocked('1-2')).toBe(true);
    expect(g().isUnlocked('1-3')).toBe(false);
    expect(g().isUnlocked('nope')).toBe(false);
  });

  it('chapter 2 opens at 70 % of chapter 1 (or its boss)', () => {
    const ch1 = missionsByChapter('power-up');
    expect(g().isChapterUnlocked('power-up')).toBe(true);
    expect(g().isChapterUnlocked('motor-control')).toBe(false);
    expect(g().isUnlocked('2-1')).toBe(false);
    const needed = Math.ceil(ch1.length * 0.7);
    for (const m of ch1.slice(0, needed - 1)) g().completeMission(m.id, passed(m.id));
    expect(g().isChapterUnlocked('motor-control')).toBe(false);
    g().completeMission(ch1[needed - 1]!.id, passed(ch1[needed - 1]!.id));
    expect(g().isChapterUnlocked('motor-control')).toBe(true);
    expect(g().isUnlocked('2-1')).toBe(true);
    expect(g().isUnlocked('2-2')).toBe(false);

    const bossOnly = createDefaultProfile();
    bossOnly.missions[ch1[ch1.length - 1]!.id] = { completed: true, stars: 1, hintsUsed: 0, attempts: 1 };
    expect(isChapterUnlockedFor(bossOnly, 'motor-control')).toBe(true);
  });

  it('chapter 3 needs chapter 2 progress; completed missions never re-lock', () => {
    const p = createDefaultProfile();
    for (const m of missionsByChapter('power-up')) p.missions[m.id] = { completed: true, stars: 3, hintsUsed: 0, attempts: 1 };
    expect(isChapterUnlockedFor(p, 'timing')).toBe(false);
    const ch2 = missionsByChapter('motor-control');
    for (const m of ch2.slice(0, Math.ceil(ch2.length * 0.7))) p.missions[m.id] = { completed: true, stars: 1, hintsUsed: 0, attempts: 1 };
    expect(isChapterUnlockedFor(p, 'timing')).toBe(true);

    useGame.setState({ profile: { ...createDefaultProfile(), missions: { '1-5': { completed: true, stars: 1, hintsUsed: 0, attempts: 1 } } } });
    expect(g().isUnlocked('1-5')).toBe(true);
    expect(g().isUnlocked('1-4')).toBe(false);
  });
});

describe('other actions & selectors', () => {
  it('saveProgram keeps copies of rungs, comments and tags', () => {
    const rungs = ['XIC(Switch_0)OTE(Light_0);'];
    const tags = [{ name: 'X', dataType: 'BOOL' as const }];
    g().saveProgram('1-1', rungs, ['c'], tags);
    rungs.push('mutated');
    tags[0]!.name = 'Y';
    expect(progress('1-1')).toMatchObject({ savedRungs: ['XIC(Switch_0)OTE(Light_0);'], savedComments: ['c'], savedTags: [{ name: 'X' }] });
    expect(progress('1-1')!.attempts).toBe(0);
  });

  it('setName (Name Tag), setSettings, resetProgress', () => {
    g().setName('  Sam  ');
    expect(g().profile.name).toBe('Sam');
    expect(g().profile.achievements['name-tag']).toBeDefined();
    g().setName('   ');
    expect(g().profile.name).toBe(createDefaultProfile().name);
    g().setSettings({ sound: false });
    expect(g().profile.settings).toEqual({ ...createDefaultProfile().settings, sound: false });
    g().setName('Sam');
    g().completeMission('1-1', passed('1-1'));
    g().resetProgress();
    expect(g().profile.xp).toBe(0);
    expect(g().profile.missions).toEqual({});
    expect(g().profile.achievements).toEqual({});
    expect(g().profile.name).toBe('Sam');
    expect(g().profile.settings.sound).toBe(false);
  });

  it('recordEvent updates stats and unlocks achievements', () => {
    expect(g().recordEvent({ type: 'forceUsed' })).toEqual(['force-of-habit']);
    expect(g().recordEvent({ type: 'forceUsed' })).toEqual([]);
    expect(g().profile.stats?.forcesUsed).toBe(2);
    expect(g().profile.xp).toBeGreaterThan(0);
    g().recordEvent({ type: 'sandboxTime', ms: 9 * 60_000 });
    expect(g().recordEvent({ type: 'sandboxTime', ms: 60_000 })).toContain('tinkerer');
  });

  it('totalStars and chapterProgress', () => {
    g().completeMission('1-1', passed('1-1', 3));
    g().completeMission('1-2', passed('1-2', 2));
    const p = g().profile;
    expect(totalStars(p)).toBe(5);
    const cp = chapterProgress(p, 'power-up');
    const n = missionsByChapter('power-up').length;
    expect(cp).toMatchObject({ total: n, completed: 2, stars: 5, maxStars: n * 3, bossCompleted: false });
    expect(cp.percent).toBe(Math.round((2 / n) * 100));
    expect(chapterProgress(p, 'nope')).toMatchObject({ total: 0, percent: 0 });
  });
});
