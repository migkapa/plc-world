/**
 * Per-device UI preferences that are not part of the persisted player profile (master volume), plus
 * the reduced-motion hook (player setting OR the OS "reduce motion" preference).
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useGame } from '../../game/store';

interface UiPrefs {
  /** Master volume 0..1 (sfx.setVolume). */
  volume: number;
  setVolume(v: number): void;
}

export const useUiPrefs = create<UiPrefs>()(
  persist(
    (set) => ({
      volume: 0.5,
      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5)) }),
    }),
    {
      name: 'plc-world-ui-prefs-v1',
      storage: createJSONStorage(() => {
        try {
          const ls = globalThis.localStorage;
          ls.getItem('x');
          return ls;
        } catch {
          const mem = new Map<string, string>();
          return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
        }
      }),
      partialize: (s) => ({ volume: s.volume }),
    },
  ),
);

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeMotion(cb: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

const systemReduced = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;

/** True when animations should be minimised (player setting or OS preference). */
export function useReducedMotion(): boolean {
  const setting = useGame((s) => s.profile.settings.reducedMotion);
  const system = useSyncExternalStore(subscribeMotion, systemReduced, () => false);
  return setting || system;
}
