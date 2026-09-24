import { useSyncExternalStore } from 'react';

/** matchMedia hook (SSR-safe): true while `query` matches. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  );
}
