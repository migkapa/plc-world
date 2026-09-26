/**
 * Transient app-wide UI state (not persisted): what is on screen right now, so global listeners can
 * avoid talking over it.
 *
 *  - `celebrating`: the mission-complete CelebrationModal is open. It announces its own level-up (banner
 *    + fanfare), so <GameListeners/> holds level-up / promotion toasts and sounds back until it closes.
 *  - `celebratedLevel`: the level the open celebration announced with its level-up banner (null: none);
 *    level-ups up to that level are not toasted again afterwards.
 */
import { create } from 'zustand';

export interface UiState {
  celebrating: boolean;
  celebratedLevel: number | null;
  /** The celebration opened; `announcedLevel` is the level its banner shows (null when no level-up). */
  beginCelebration(announcedLevel: number | null): void;
  endCelebration(): void;
}

export const useUiStore = create<UiState>((set) => ({
  celebrating: false,
  celebratedLevel: null,
  beginCelebration: (announcedLevel) => set({ celebrating: true, celebratedLevel: announcedLevel }),
  endCelebration: () => set({ celebrating: false, celebratedLevel: null }),
}));
