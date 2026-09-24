/**
 * Ephemeral "what to focus on the campaign map" hand-off (Home chapter carousel → Campaign page).
 * Not persisted: hash routing has no query string, so pages set this before navigating.
 */
import { create } from 'zustand';

interface CampaignFocus {
  /** Mission to select (and scroll to) when the map opens. */
  missionId?: string;
  /** Chapter to scroll to when the map opens. */
  chapterId?: string;
  focusMission(id: string): void;
  focusChapter(id: string): void;
  clear(): void;
}

export const useCampaignFocus = create<CampaignFocus>((set) => ({
  focusMission: (missionId) => set({ missionId, chapterId: undefined }),
  focusChapter: (chapterId) => set({ chapterId, missionId: undefined }),
  clear: () => set({ missionId: undefined, chapterId: undefined }),
}));
