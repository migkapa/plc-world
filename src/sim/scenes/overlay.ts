/**
 * Global learning-overlay settings shared by every scene view (and toggled by the page UI).
 *
 *   const showTags = useSceneOverlay((s) => s.showTags);      // inside a scene View
 *   useSceneOverlay.getState().setShowTags(true);             // from a toolbar button
 *
 * showTags = true pins the floating I/O tag chips (alias · address · live value) on every device;
 * when false, a chip appears only while its device is hovered.
 */
import { create } from 'zustand';

export interface SceneOverlayState {
  /** Always show the floating I/O tag chips (not just on hover). */
  showTags: boolean;
  setShowTags(on: boolean): void;
  toggleShowTags(): void;
}

export const useSceneOverlay = create<SceneOverlayState>((set) => ({
  showTags: false,
  setShowTags: (on) => set({ showTags: on }),
  toggleShowTags: () => set((s) => ({ showTags: !s.showTags })),
}));
