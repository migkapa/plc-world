/**
 * Game-event plumbing for the workspace pages. Achievement toasts are shown by the app-wide
 * <GameListeners/> (it drains `useGame.recentUnlocks`); the celebration modal consumes the unlocks of a
 * successful test run itself so they are not toasted twice.
 */
import type { GameEvent } from '../../game/achievements';
import { useGame } from '../../game/store';

/** Record a game event (forces, toggle bit, rung edits, controls, sandbox time…). */
export function recordGameEvent(e: GameEvent): string[] {
  return useGame.getState().recordEvent(e);
}
