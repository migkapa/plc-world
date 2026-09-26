/**
 * Campaign progress helpers for the map, the Home page and the mission card (pure, no React).
 * Unlock rules come from the game store (isChapterUnlockedFor / isMissionUnlockedFor).
 */
import { CHAPTERS, getChapter } from '../../game/chapters';
import { chapterBoss, getMission, MISSIONS, missionsByChapter } from '../../game/missions';
import { CHAPTER_UNLOCK_SHARE, chapterProgress, isChapterUnlockedFor, isMissionUnlockedFor } from '../../game/store';
import type { ChapterDef, MissionDef, PlayerProfile } from '../../game/types';

export type MissionState = 'locked' | 'available' | 'completed';

export function missionState(p: PlayerProfile, m: MissionDef): MissionState {
  if (p.missions[m.id]?.completed) return 'completed';
  return isMissionUnlockedFor(p, m.id) ? 'available' : 'locked';
}

/** The mission the player should play next: first unlocked, not completed mission in campaign order. */
export function nextPlayableMission(p: PlayerProfile): MissionDef | undefined {
  return MISSIONS.find((m) => !p.missions[m.id]?.completed && isMissionUnlockedFor(p, m.id));
}

/** True when every mission is completed. */
export function campaignComplete(p: PlayerProfile): boolean {
  return MISSIONS.every((m) => p.missions[m.id]?.completed);
}

export interface ChapterUnlock {
  unlocked: boolean;
  /** Chapter whose progress opens this one. */
  prev?: ChapterDef;
  /** Missions of `prev` done / needed (70 %) / total. */
  done: number;
  needed: number;
  total: number;
  boss?: MissionDef;
  /** One-line explanation for a locked chapter. */
  hint?: string;
}

export function chapterUnlock(p: PlayerProfile, chapterId: string): ChapterUnlock {
  const ch = getChapter(chapterId);
  const unlocked = isChapterUnlockedFor(p, chapterId);
  const prev = ch ? CHAPTERS.find((c) => c.order === ch.order - 1) : undefined;
  if (!prev) return { unlocked, done: 0, needed: 0, total: 0 };
  const pr = chapterProgress(p, prev.id);
  const needed = Math.ceil(pr.total * CHAPTER_UNLOCK_SHARE - 1e-9);
  const boss = chapterBoss(prev.id);
  const out: ChapterUnlock = { unlocked, prev, done: pr.completed, needed, total: pr.total };
  if (boss) out.boss = boss;
  if (!unlocked) {
    const prevOpen = isChapterUnlockedFor(p, prev.id);
    out.hint = prevOpen
      ? `Beat the boss of Chapter ${prev.order}${boss ? ` (${boss.id} “${boss.title}”)` : ''} or clear ${needed} of its ${pr.total} missions (${pr.completed}/${needed}).`
      : `Unlock Chapter ${prev.order} — ${prev.title} first.`;
  }
  return out;
}

/** Why a mission can't be played yet (undefined when playable). */
export function missionLockReason(p: PlayerProfile, m: MissionDef): string | undefined {
  if (missionState(p, m) !== 'locked') return undefined;
  const cu = chapterUnlock(p, m.chapter);
  if (!cu.unlocked) return `Chapter locked. ${cu.hint ?? ''}`.trim();
  if (m.requires && m.requires.length > 0) {
    const missing = m.requires.filter((id) => !p.missions[id]?.completed);
    return `Complete ${missing.map((id) => `${id} “${getMission(id)?.title ?? id}”`).join(', ')} first.`;
  }
  const prev = missionsByChapter(m.chapter).filter((x) => x.order < m.order).pop();
  return prev ? `Complete ${prev.id} “${prev.title}” first.` : undefined;
}

export const KIND_LABEL: Record<MissionDef['kind'], string> = {
  build: 'Build',
  troubleshoot: 'Troubleshoot',
  boss: 'Boss',
};

export const DIFFICULTY_LABEL = ['', 'Easy', 'Moderate', 'Challenging', 'Hard', 'Expert'] as const;
