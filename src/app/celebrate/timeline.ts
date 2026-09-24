/**
 * The mission-complete celebration as a timeline of cues (headless, unit tested): stars pop one by
 * one, then the XP counter runs, then a level-up banner, then new achievements.
 */
export type CelebrationCue =
  | { at: number; kind: 'star'; index: number }
  | { at: number; kind: 'xpStart'; durationMs: number }
  | { at: number; kind: 'xpEnd' }
  | { at: number; kind: 'levelUp'; level: number }
  | { at: number; kind: 'achievement'; id: string; index: number }
  | { at: number; kind: 'done' };

export interface CelebrationInput {
  stars: number;
  xpGained: number;
  previousLevel: number;
  newLevel: number;
  newAchievements: readonly string[];
}

export const STAR_START_MS = 350;
export const STAR_GAP_MS = 420;

/** XP counter duration: longer for bigger amounts, 0.5–1.6 s. */
export function xpDuration(xp: number): number {
  if (xp <= 0) return 0;
  return Math.round(Math.min(1600, 500 + Math.sqrt(xp) * 45));
}

export function celebrationTimeline(input: CelebrationInput): CelebrationCue[] {
  const cues: CelebrationCue[] = [];
  let t = STAR_START_MS;
  const stars = Math.max(0, Math.min(3, Math.floor(input.stars)));
  for (let i = 0; i < stars; i++) {
    cues.push({ at: t, kind: 'star', index: i });
    t += STAR_GAP_MS;
  }
  t += 150;
  const d = xpDuration(input.xpGained);
  if (d > 0) {
    cues.push({ at: t, kind: 'xpStart', durationMs: d });
    t += d;
    cues.push({ at: t, kind: 'xpEnd' });
    t += 250;
  }
  if (input.newLevel > input.previousLevel) {
    cues.push({ at: t, kind: 'levelUp', level: input.newLevel });
    t += 700;
  }
  input.newAchievements.forEach((id, index) => {
    cues.push({ at: t, kind: 'achievement', id, index });
    t += 450;
  });
  cues.push({ at: t, kind: 'done' });
  return cues;
}

/** Eased counter value (ease-out cubic) at `elapsed` of `duration`. */
export function countUp(target: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return target;
  if (elapsed <= 0) return 0;
  const p = elapsed / duration;
  return Math.round(target * (1 - (1 - p) ** 3));
}

/**
 * What a replay can still earn: the best possible rating is 3 stars, or 2 once a hint was revealed
 * (hints are permanent). Undefined when nothing better is possible (no replay button).
 */
export function replayGoal(mission: { parInstructions?: number | undefined }, result: { instructionCount: number }, hintsUsed: number, stars: number): string | undefined {
  const max = hintsUsed > 0 ? 2 : 3;
  if (stars >= max) return undefined;
  const par = mission.parInstructions;
  if (par !== undefined && result.instructionCount > par) return 'Replay to beat par';
  return `Replay for ${max} stars`;
}
