/**
 * Mission registry: every chapter's missions, ordered by chapter order then mission order.
 * Headless (no React / DOM). Test-only wrong-answer files (`chN.wrong.ts`) are NOT imported here.
 */
import { CHAPTERS, getChapter } from '../chapters';
import type { MissionDef } from '../types';
import { CH1_MISSIONS } from './ch1';
import { CH2_MISSIONS } from './ch2';
import { CH3_MISSIONS } from './ch3';
import { CH4_MISSIONS } from './ch4';
import { CH5_MISSIONS } from './ch5';
import { CH6_MISSIONS } from './ch6';
import { CH7_MISSIONS } from './ch7';

const chapterOrder = (m: MissionDef): number => getChapter(m.chapter)?.order ?? Number.MAX_SAFE_INTEGER;

/** All missions, ordered by chapter order, then mission order. */
export const MISSIONS: readonly MissionDef[] = [
  ...CH1_MISSIONS,
  ...CH2_MISSIONS,
  ...CH3_MISSIONS,
  ...CH4_MISSIONS,
  ...CH5_MISSIONS,
  ...CH6_MISSIONS,
  ...CH7_MISSIONS,
].sort((a, b) => chapterOrder(a) - chapterOrder(b) || a.order - b.order);

const BY_ID = new Map(MISSIONS.map((m) => [m.id, m] as const));

/** Mission by id (undefined for unknown ids). */
export function getMission(id: string): MissionDef | undefined {
  return BY_ID.get(id);
}

/** Missions of one chapter, in order. */
export function missionsByChapter(chapterId: string): MissionDef[] {
  return MISSIONS.filter((m) => m.chapter === chapterId);
}

/**
 * The mission after `id` in campaign order (next in the chapter, else the first mission of the next
 * chapter that has missions); undefined at the end of the campaign or for unknown ids.
 */
export function nextMission(id: string): MissionDef | undefined {
  const i = MISSIONS.findIndex((m) => m.id === id);
  return i >= 0 ? MISSIONS[i + 1] : undefined;
}

/** The mission before `id` in campaign order. */
export function previousMission(id: string): MissionDef | undefined {
  const i = MISSIONS.findIndex((m) => m.id === id);
  return i > 0 ? MISSIONS[i - 1] : undefined;
}

/** The boss mission of a chapter (kind 'boss'), if any. */
export function chapterBoss(chapterId: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.chapter === chapterId && m.kind === 'boss');
}

export { CHAPTERS };
export { CH1_MISSIONS, CH2_MISSIONS, CH3_MISSIONS, CH4_MISSIONS, CH5_MISSIONS, CH6_MISSIONS, CH7_MISSIONS };
export type { WrongAnswer, WrongAnswerSet } from './authoring';
