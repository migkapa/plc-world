/**
 * Player progress store (zustand + persist to localStorage key 'plc-world-profile-v1').
 *
 *   const xp = useGame((s) => s.profile.xp);
 *   const { startMission, completeMission } = useGame.getState();
 *
 * XP is only awarded for improvements (first clear = mission.xp, each additional star +25 % of
 * mission.xp), so replaying can never farm XP. Achievements unlock through `recordEvent` (and are
 * also evaluated by the other actions); their XP is added to the profile.
 *
 * Headless apart from zustand: no React / DOM imports; storage falls back to memory when
 * localStorage is unavailable (node tests, private mode, quota errors).
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { achievementXp, applyEventToStats, evaluateAchievements, type GameEvent } from './achievements';
import { CHAPTERS, getChapter } from './chapters';
import { MISSIONS, getMission, missionsByChapter } from './missions';
import { levelForXp } from './ranks';
import type { TagDef } from '../plc/types';
import type { MissionDef, MissionProgress, MissionRunResult, PlayerProfile, TutorialRecord } from './types';

export const PROFILE_STORAGE_KEY = 'plc-world-profile-v1';
export const PROFILE_VERSION = 1;
/** Share of a chapter's missions that unlocks the next chapter (unless its boss is beaten first). */
export const CHAPTER_UNLOCK_SHARE = 0.7;
/** Extra XP per star above the first, as a share of the mission's XP. */
export const STAR_BONUS = 0.25;

/** Injectable clock (tests override `gameClock.now`). */
export const gameClock = { now: (): number => Date.now() };

// ---------------------------------------------------------------------------
// Profile helpers (pure)
// ---------------------------------------------------------------------------

export const DEFAULT_PLAYER_NAME = 'New Tech';

export function createDefaultProfile(): PlayerProfile {
  return {
    name: DEFAULT_PLAYER_NAME,
    xp: 0,
    missions: {},
    achievements: {},
    streakDays: 0,
    settings: { sound: true, reducedMotion: false, quality: 'high' },
    stats: {},
  };
}

function emptyProgress(): MissionProgress {
  return { completed: false, stars: 0, hintsUsed: 0, attempts: 0 };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const clampStars = (x: unknown): 0 | 1 | 2 | 3 => Math.max(0, Math.min(3, Math.round(num(x, 0)))) as 0 | 1 | 2 | 3;

/** Repair / complete a profile read from storage (unknown fields dropped, types checked). */
export function normalizeProfile(raw: unknown): PlayerProfile {
  const base = createDefaultProfile();
  if (!isObj(raw)) return base;
  const p: PlayerProfile = { ...base };
  if (typeof raw.name === 'string' && raw.name.trim()) p.name = raw.name.trim().slice(0, 32);
  p.xp = Math.max(0, Math.round(num(raw.xp, 0)));
  p.streakDays = Math.max(0, Math.round(num(raw.streakDays, 0)));
  if (typeof raw.lastActiveDay === 'string') p.lastActiveDay = raw.lastActiveDay;
  if (isObj(raw.missions)) {
    for (const [id, v] of Object.entries(raw.missions)) {
      if (!isObj(v)) continue;
      const mp: MissionProgress = {
        completed: v.completed === true,
        stars: clampStars(v.stars),
        hintsUsed: Math.max(0, Math.round(num(v.hintsUsed, 0))),
        attempts: Math.max(0, Math.round(num(v.attempts, 0))),
      };
      if (typeof v.bestInstructionCount === 'number') mp.bestInstructionCount = v.bestInstructionCount;
      if (Array.isArray(v.savedRungs)) mp.savedRungs = v.savedRungs.filter((r): r is string => typeof r === 'string');
      if (Array.isArray(v.savedComments)) {
        mp.savedComments = v.savedComments.map((c) => (typeof c === 'string' ? c : undefined));
      }
      if (Array.isArray(v.savedTags)) mp.savedTags = v.savedTags.filter((t): t is TagDef => isObj(t) && typeof t.name === 'string' && typeof t.dataType === 'string');
      if (typeof v.completedAt === 'number') mp.completedAt = v.completedAt;
      if (!mp.completed) mp.stars = 0;
      p.missions[id] = mp;
    }
  }
  if (isObj(raw.achievements)) {
    for (const [id, t] of Object.entries(raw.achievements)) if (typeof t === 'number') p.achievements[id] = t;
  }
  if (isObj(raw.settings)) {
    const s = raw.settings;
    p.settings = {
      sound: typeof s.sound === 'boolean' ? s.sound : base.settings.sound,
      reducedMotion: typeof s.reducedMotion === 'boolean' ? s.reducedMotion : base.settings.reducedMotion,
      quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : base.settings.quality,
    };
  }
  if (isObj(raw.stats)) {
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.stats)) if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v;
    p.stats = stats;
  }
  if (isObj(raw.tutorials)) {
    const tutorials: Record<string, TutorialRecord> = {};
    for (const [k, v] of Object.entries(raw.tutorials)) {
      if (isObj(v) && (v.status === 'completed' || v.status === 'skipped')) tutorials[k] = { status: v.status, at: num(v.at, 0) };
    }
    p.tutorials = tutorials;
  }
  return p;
}

/** Total XP a mission is worth at a star level (0 stars = 0). */
export function missionXpValue(mission: Pick<MissionDef, 'xp'>, stars: number): number {
  if (stars <= 0) return 0;
  return Math.round(mission.xp * (1 + STAR_BONUS * (Math.min(3, stars) - 1)));
}

/** Local calendar day 'YYYY-MM-DD'. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function previousDay(ms: number): string {
  const d = new Date(ms);
  d.setDate(d.getDate() - 1);
  return localDay(d.getTime());
}

/** Sum of stars over the campaign's missions. */
export function totalStars(profile: PlayerProfile): number {
  let n = 0;
  for (const m of MISSIONS) n += profile.missions[m.id]?.stars ?? 0;
  return n;
}

export interface ChapterProgress {
  chapterId: string;
  total: number;
  completed: number;
  stars: number;
  maxStars: number;
  /** completed / total (0..1; 0 for an empty chapter). */
  share: number;
  /** Rounded percentage 0..100. */
  percent: number;
  bossCompleted: boolean;
}

export function chapterProgress(profile: PlayerProfile, chapterId: string): ChapterProgress {
  const list = missionsByChapter(chapterId);
  let completed = 0;
  let stars = 0;
  let bossCompleted = false;
  for (const m of list) {
    const pr = profile.missions[m.id];
    if (pr?.completed) {
      completed++;
      if (m.kind === 'boss') bossCompleted = true;
    }
    stars += pr?.stars ?? 0;
  }
  const share = list.length ? completed / list.length : 0;
  return {
    chapterId,
    total: list.length,
    completed,
    stars,
    maxStars: list.length * 3,
    share,
    percent: Math.round(share * 100),
    bossCompleted,
  };
}

/**
 * Chapter 1 is always open. Chapter N+1 opens when chapter N is open and its boss is beaten or
 * >= 70 % of its missions are done (an empty chapter never blocks). A chapter with any completed
 * mission never re-locks.
 */
export function isChapterUnlockedFor(profile: PlayerProfile, chapterId: string): boolean {
  const ch = getChapter(chapterId);
  if (!ch) return false;
  if (ch.order <= 1) return true;
  if (missionsByChapter(ch.id).some((m) => profile.missions[m.id]?.completed)) return true;
  const prev = CHAPTERS.find((c) => c.order === ch.order - 1);
  if (!prev) return true;
  if (!isChapterUnlockedFor(profile, prev.id)) return false;
  const pr = chapterProgress(profile, prev.id);
  return pr.total === 0 || pr.bossCompleted || pr.share >= CHAPTER_UNLOCK_SHARE - 1e-9;
}

/**
 * A mission is playable when its chapter is open and either its `requires` are all completed, or (by
 * default) the previous mission of its chapter is completed. Completed missions stay open.
 */
export function isMissionUnlockedFor(profile: PlayerProfile, missionId: string): boolean {
  const m = getMission(missionId);
  if (!m) return false;
  if (profile.missions[m.id]?.completed) return true;
  if (!isChapterUnlockedFor(profile, m.chapter)) return false;
  if (m.requires && m.requires.length > 0) return m.requires.every((id) => profile.missions[id]?.completed === true);
  const prev = missionsByChapter(m.chapter).filter((x) => x.order < m.order).pop();
  return !prev || profile.missions[prev.id]?.completed === true;
}

// ---------------------------------------------------------------------------
// Storage (guarded)
// ---------------------------------------------------------------------------

function memoryStorage(): StateStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

/** localStorage when usable, else an in-memory fallback (writes that throw are swallowed). */
function safeStorage(): StateStorage {
  let ls: Storage | undefined;
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    if (candidate) {
      const probe = '__plc_world_probe__';
      candidate.setItem(probe, '1');
      candidate.removeItem(probe);
      ls = candidate;
    }
  } catch {
    ls = undefined;
  }
  if (!ls) return memoryStorage();
  const store = ls;
  const fallback = memoryStorage();
  return {
    getItem: (k) => {
      try {
        return store.getItem(k);
      } catch {
        return fallback.getItem(k) as string | null;
      }
    },
    setItem: (k, v) => {
      try {
        store.setItem(k, v);
      } catch {
        void fallback.setItem(k, v);
      }
    },
    removeItem: (k) => {
      try {
        store.removeItem(k);
      } catch {
        void fallback.removeItem(k);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Transient per-mission session info (not persisted). */
export interface MissionSession {
  startedAt: number;
  /** Failed full test runs since the mission was started. */
  failedRuns: number;
}

export interface CompletionOutcome {
  /** Mission XP + achievement XP gained by this completion. */
  xpGained: number;
  missionXp: number;
  achievementXp: number;
  previousLevel: number;
  newLevel: number;
  newAchievements: string[];
  /** First clear, more stars or fewer instructions than before. */
  improved: boolean;
  firstClear: boolean;
  /** Stars earned by this run (capped at 2 when hints were revealed). */
  stars: 0 | 1 | 2 | 3;
  /** Best stars before this run. */
  previousStars: 0 | 1 | 2 | 3;
}

export interface GameState {
  profile: PlayerProfile;
  session: Record<string, MissionSession>;
  /** Achievements unlocked since the UI last called `consumeUnlocks()` (for toasts). */
  recentUnlocks: string[];

  /** Opening a mission: attempts + 1, daily streak update. Returns newly unlocked achievements. */
  startMission(id: string): string[];
  /** Reveal the next hint; returns its index, or -1 when there is none left. */
  useHint(id: string): number;
  /** Same as useHint (lint-friendly name for event handlers). */
  revealHint(id: string): number;
  saveProgram(id: string, rungs: string[], comments?: ReadonlyArray<string | undefined>, tags?: TagDef[]): void;
  /**
   * Report a full test run. A failed result is counted (first-try / never-give-up) and gives nothing.
   * A passed result records stars and awards XP for improvements only.
   */
  completeMission(id: string, result: MissionRunResult, durationMs?: number): CompletionOutcome;
  /** Record a game event; returns newly unlocked achievement ids. */
  recordEvent(event: GameEvent): string[];
  /**
   * A guided tour ended: remember it (so it does not start by itself again) and record a `tutorialFinished` event.
   * A completed tour stays completed when a replay is skipped. Returns newly unlocked achievement ids.
   */
  finishTutorial(tutorialId: string, status: TutorialRecord['status']): string[];
  isUnlocked(missionId: string): boolean;
  isChapterUnlocked(chapterId: string): boolean;
  setSettings(settings: Partial<PlayerProfile['settings']>): void;
  setName(name: string): void;
  /** Wipe progress (missions, XP, achievements, streak, stats); keeps name and settings. */
  resetProgress(): void;
  /** Return and clear `recentUnlocks`. */
  consumeUnlocks(): string[];
}

/** Unlock achievements for `event` on a profile copy (repeats for chained ones, e.g. level-based). */
function unlockAchievements(profile: PlayerProfile, event: GameEvent, now: number): { profile: PlayerProfile; ids: string[]; xp: number } {
  let p = profile;
  const ids: string[] = [];
  let xp = 0;
  for (let round = 0; round < 5; round++) {
    const found = evaluateAchievements(p, event, new Date(now));
    if (found.length === 0) break;
    const achievements = { ...p.achievements };
    let gained = 0;
    for (const id of found) {
      achievements[id] = now;
      gained += achievementXp(id);
    }
    ids.push(...found);
    xp += gained;
    p = { ...p, achievements, xp: p.xp + gained };
  }
  return { profile: p, ids, xp };
}

function withEvent(profile: PlayerProfile, event: GameEvent, now: number): { profile: PlayerProfile; ids: string[]; xp: number } {
  const stats = applyEventToStats(profile.stats, event);
  return unlockAchievements({ ...profile, stats }, event, now);
}

export const useGame = create<GameState>()(
  persist(
    (set, get) => {
      const progressOf = (id: string): MissionProgress => get().profile.missions[id] ?? emptyProgress();
      const pushUnlocks = (ids: string[]): void => {
        if (ids.length) set((s) => ({ recentUnlocks: [...s.recentUnlocks, ...ids] }));
      };

      const recordEvent = (event: GameEvent): string[] => {
        const now = gameClock.now();
        if (event.type === 'testRunFailed') {
          const sess = get().session[event.missionId] ?? { startedAt: now, failedRuns: 0 };
          set((s) => ({ session: { ...s.session, [event.missionId]: { ...sess, failedRuns: sess.failedRuns + 1 } } }));
        }
        const r = withEvent(get().profile, event, now);
        set({ profile: r.profile });
        pushUnlocks(r.ids);
        return r.ids;
      };

      const useHint = (id: string): number => {
        const m = getMission(id);
        if (!m) return -1;
        const pr = progressOf(id);
        if (pr.hintsUsed >= m.hints.length) return -1;
        const index = pr.hintsUsed;
        set((s) => ({ profile: { ...s.profile, missions: { ...s.profile.missions, [id]: { ...pr, hintsUsed: index + 1 } } } }));
        recordEvent({ type: 'hintUsed', missionId: id, index });
        return index;
      };

      return {
        profile: createDefaultProfile(),
        session: {},
        recentUnlocks: [],

        startMission(id) {
          if (!getMission(id)) return [];
          const now = gameClock.now();
          const s = get();
          const pr = progressOf(id);
          const today = localDay(now);
          let streak = s.profile.streakDays;
          if (s.profile.lastActiveDay !== today) streak = s.profile.lastActiveDay === previousDay(now) ? streak + 1 : 1;
          const streakChanged = streak !== s.profile.streakDays;
          set({
            profile: {
              ...s.profile,
              streakDays: streak,
              lastActiveDay: today,
              missions: { ...s.profile.missions, [id]: { ...pr, attempts: pr.attempts + 1 } },
            },
            session: { ...s.session, [id]: { startedAt: now, failedRuns: 0 } },
          });
          return streakChanged ? recordEvent({ type: 'streakUpdated', days: streak }) : [];
        },

        useHint,
        revealHint: useHint,

        saveProgram(id, rungs, comments, tags) {
          const pr = progressOf(id);
          const next: MissionProgress = { ...pr, savedRungs: [...rungs] };
          if (comments) next.savedComments = [...comments];
          else delete next.savedComments;
          if (tags) next.savedTags = structuredClone(tags);
          else delete next.savedTags;
          set((s) => ({ profile: { ...s.profile, missions: { ...s.profile.missions, [id]: next } } }));
        },

        completeMission(id, result, durationMs = 0) {
          const now = gameClock.now();
          const s = get();
          const m = getMission(id);
          const pr = progressOf(id);
          const level0 = levelForXp(s.profile.xp).level;
          const nothing: CompletionOutcome = {
            xpGained: 0,
            missionXp: 0,
            achievementXp: 0,
            previousLevel: level0,
            newLevel: level0,
            newAchievements: [],
            improved: false,
            firstClear: false,
            stars: 0,
            previousStars: pr.stars,
          };
          if (!m || result.missionId !== id) return nothing;
          if (!result.passed || result.stars <= 0) {
            const ids = recordEvent({
              type: 'testRunFailed',
              missionId: id,
              failedTests: result.tests.filter((t) => !t.passed).length,
            });
            return { ...nothing, newAchievements: ids, newLevel: levelForXp(get().profile.xp).level };
          }
          const stars = Math.min(result.stars, pr.hintsUsed > 0 ? 2 : 3) as 1 | 2 | 3;
          const firstClear = !pr.completed;
          const best = Math.max(pr.stars, stars) as 0 | 1 | 2 | 3;
          const missionXp = missionXpValue(m, best) - missionXpValue(m, pr.stars);
          const betterCount = pr.bestInstructionCount === undefined || result.instructionCount < pr.bestInstructionCount;
          const improved = firstClear || stars > pr.stars || (pr.completed && betterCount);
          const next: MissionProgress = {
            ...pr,
            completed: true,
            stars: best,
            bestInstructionCount: betterCount ? result.instructionCount : pr.bestInstructionCount!,
            completedAt: pr.completedAt ?? now,
          };
          const sess = s.session[id];
          const failedRuns = sess?.failedRuns ?? 0;
          let profile: PlayerProfile = {
            ...s.profile,
            xp: s.profile.xp + missionXp,
            missions: { ...s.profile.missions, [id]: next },
          };
          const r = withEvent(
            profile,
            {
              type: 'missionCompleted',
              missionId: id,
              stars,
              hintsUsed: pr.hintsUsed,
              instructionCount: result.instructionCount,
              durationMs,
              firstAttempt: firstClear && failedRuns === 0 && pr.attempts <= 1,
              failedRuns,
            },
            now,
          );
          profile = r.profile;
          set({
            profile,
            session: { ...s.session, [id]: { startedAt: sess?.startedAt ?? now, failedRuns: 0 } },
          });
          pushUnlocks(r.ids);
          return {
            xpGained: missionXp + r.xp,
            missionXp,
            achievementXp: r.xp,
            previousLevel: level0,
            newLevel: levelForXp(profile.xp).level,
            newAchievements: r.ids,
            improved,
            firstClear,
            stars,
            previousStars: pr.stars,
          };
        },

        recordEvent,

        finishTutorial(tutorialId, status) {
          const now = gameClock.now();
          const prev = get().profile.tutorials?.[tutorialId];
          const kept: TutorialRecord['status'] = prev?.status === 'completed' ? 'completed' : status;
          set((s) => ({ profile: { ...s.profile, tutorials: { ...(s.profile.tutorials ?? {}), [tutorialId]: { status: kept, at: now } } } }));
          return recordEvent({ type: 'tutorialFinished', tutorialId, skipped: status === 'skipped' });
        },

        isUnlocked(missionId) {
          return isMissionUnlockedFor(get().profile, missionId);
        },

        isChapterUnlocked(chapterId) {
          return isChapterUnlockedFor(get().profile, chapterId);
        },

        setSettings(settings) {
          set((s) => ({ profile: { ...s.profile, settings: { ...s.profile.settings, ...settings } } }));
        },

        setName(name) {
          const clean = name.trim().slice(0, 32) || DEFAULT_PLAYER_NAME;
          if (clean === get().profile.name) return;
          set((s) => ({ profile: { ...s.profile, name: clean } }));
          recordEvent({ type: 'profileRenamed' });
        },

        resetProgress() {
          const { name, settings } = get().profile;
          set({ profile: { ...createDefaultProfile(), name, settings }, session: {}, recentUnlocks: [] });
        },

        consumeUnlocks() {
          const ids = get().recentUnlocks;
          if (ids.length) set({ recentUnlocks: [] });
          return ids;
        },
      };
    },
    {
      name: PROFILE_STORAGE_KEY,
      version: PROFILE_VERSION,
      storage: createJSONStorage(safeStorage),
      partialize: (s) => ({ profile: s.profile }),
      migrate: (persisted) => ({ profile: normalizeProfile(isObj(persisted) ? persisted.profile : undefined) }),
      merge: (persisted, current) =>
        isObj(persisted) && isObj(persisted.profile) ? { ...current, profile: normalizeProfile(persisted.profile) } : current,
    },
  ),
);

/** Current profile (non-reactive). */
export const getProfile = (): PlayerProfile => useGame.getState().profile;
