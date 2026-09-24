/**
 * Derived player numbers shared by the HUD, Home and Profile pages (pure helpers + a memoised hook).
 */
import { useMemo } from 'react';
import { ACHIEVEMENTS } from '../../game/achievements';
import { MISSIONS } from '../../game/missions';
import { levelForXp, RANKS, type LevelInfo, type RankDef } from '../../game/ranks';
import { localDay, totalStars, useGame } from '../../game/store';
import type { PlayerProfile } from '../../game/types';

export interface StreakInfo {
  /** Streak shown to the player (0 once a day was missed). */
  days: number;
  /** Trained today: the flame is lit. */
  activeToday: boolean;
  /** Streak alive but not yet extended today (play today to keep it). */
  atRisk: boolean;
}

/** The streak as the player sees it today (the store only updates it when a mission starts). */
export function streakInfo(p: PlayerProfile, now: number = Date.now()): StreakInfo {
  const today = localDay(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = localDay(y.getTime());
  if (p.lastActiveDay === today) return { days: p.streakDays, activeToday: true, atRisk: false };
  if (p.lastActiveDay === yesterday && p.streakDays > 0) return { days: p.streakDays, activeToday: false, atRisk: true };
  return { days: 0, activeToday: false, atRisk: false };
}

/** Index of a rank in RANKS (0 = Apprentice). */
export function rankTier(rank: RankDef): number {
  const i = RANKS.findIndex((r) => r.title === rank.title);
  return i < 0 ? 0 : i;
}

export interface PlayerSummary {
  name: string;
  xp: number;
  level: LevelInfo;
  tier: number;
  stars: number;
  maxStars: number;
  missionsDone: number;
  missionsTotal: number;
  threeStars: number;
  hintsUsed: number;
  attempts: number;
  achievements: number;
  achievementsTotal: number;
  streak: StreakInfo;
}

export function playerSummary(p: PlayerProfile, now: number = Date.now()): PlayerSummary {
  let missionsDone = 0;
  let threeStars = 0;
  let hintsUsed = 0;
  let attempts = 0;
  for (const m of MISSIONS) {
    const pr = p.missions[m.id];
    if (!pr) continue;
    if (pr.completed) missionsDone++;
    if (pr.stars === 3) threeStars++;
    hintsUsed += pr.hintsUsed;
    attempts += pr.attempts;
  }
  const level = levelForXp(p.xp);
  return {
    name: p.name,
    xp: p.xp,
    level,
    tier: rankTier(level.rank),
    stars: totalStars(p),
    maxStars: MISSIONS.length * 3,
    missionsDone,
    missionsTotal: MISSIONS.length,
    threeStars,
    hintsUsed,
    attempts,
    achievements: ACHIEVEMENTS.filter((a) => p.achievements[a.id] !== undefined).length,
    achievementsTotal: ACHIEVEMENTS.length,
    streak: streakInfo(p, now),
  };
}

/** Reactive player summary (recomputed when the profile changes). */
export function usePlayerSummary(): PlayerSummary {
  const profile = useGame((s) => s.profile);
  return useMemo(() => playerSummary(profile), [profile]);
}

/** 1 234 567 → "1,234,567". */
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
