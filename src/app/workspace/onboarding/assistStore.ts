/**
 * Workspace assistance preferences (per device, like the master volume) and the transient guided-tour state:
 *  - `liveObjectives`: run the acceptance tests quietly in the background and show live objective marks;
 *  - `tryIt`: "Try it now" callouts after online edits;
 *  - `tourRequest`: the '?' menu asked for a tour (the mission page that hosts it starts it and clears the request);
 *  - `tourActive`: a tour is showing (other callouts stay quiet).
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface AssistState {
  liveObjectives: boolean;
  tryIt: boolean;
  tourRequest: { id: string; nonce: number } | null;
  tourActive: string | null;
  setLiveObjectives(on: boolean): void;
  setTryIt(on: boolean): void;
  requestTour(id: string): void;
  clearTourRequest(): void;
  setTourActive(id: string | null): void;
}

function storage() {
  try {
    const ls = globalThis.localStorage;
    ls.getItem('x');
    return ls;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  }
}

let nonce = 0;

export const useAssist = create<AssistState>()(
  persist(
    (set) => ({
      liveObjectives: true,
      tryIt: true,
      tourRequest: null,
      tourActive: null,
      setLiveObjectives: (on) => set({ liveObjectives: on }),
      setTryIt: (on) => set({ tryIt: on }),
      requestTour: (id) => set({ tourRequest: { id, nonce: ++nonce } }),
      clearTourRequest: () => set({ tourRequest: null }),
      setTourActive: (id) => set({ tourActive: id }),
    }),
    {
      name: 'plc-world-assist-v1',
      storage: createJSONStorage(storage),
      partialize: (s) => ({ liveObjectives: s.liveObjectives, tryIt: s.tryIt }),
    },
  ),
);
