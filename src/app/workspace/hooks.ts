/**
 * Small React hooks shared by the workspace components.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PlcController } from '../../plc/types';
import type { SimRuntime } from '../../sim/types';

/**
 * Re-render at most `hz` times per second while the runtime publishes changes (the runtime itself
 * notifies at ~30 Hz). Returns a counter that changes on every re-render trigger.
 */
export function useRuntimeTick(runtime: SimRuntime | null | undefined, hz = 10): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!runtime) return;
    const minGap = 1000 / Math.max(1, hz);
    let last = 0;
    let timer: number | undefined;
    const fire = (): void => {
      timer = undefined;
      last = performance.now();
      setTick((t) => (t + 1) % 1_000_000);
    };
    const unsub = runtime.subscribe(() => {
      const now = performance.now();
      if (now - last >= minGap) fire();
      else if (timer === undefined) timer = window.setTimeout(fire, minGap - (now - last));
    });
    return () => {
      unsub();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [runtime, hz]);
  return tick;
}

/**
 * A primitive value derived from the runtime (control position, tag value…): the component re-renders
 * only when the value changes (checked on every runtime notification, ~30 Hz). Round analog values in
 * `get` to limit re-renders.
 */
export function useRuntimeValue<T extends string | number | boolean | undefined>(runtime: SimRuntime | null | undefined, get: () => T): T {
  const getRef = useRef(get);
  getRef.current = get;
  const subscribe = useCallback((cb: () => void) => (runtime ? runtime.subscribe(cb) : () => undefined), [runtime]);
  return useSyncExternalStore(
    subscribe,
    () => getRef.current(),
    () => getRef.current(),
  );
}

/** Re-render on controller events (mode, faults, forces, project). */
export function useControllerTick(controller: PlcController | null | undefined): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!controller) return;
    return controller.subscribe(() => setTick((t) => (t + 1) % 1_000_000));
  }, [controller]);
  return tick;
}

/** CSS media query as state. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true),
    () => true,
  );
}

/** True when a keyboard event should not trigger page shortcuts (typing in a field / the ladder). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [data-no-hotkeys]')) return true;
  return false;
}

/** A modal dialog is open (plant hotkeys must not operate the page behind it). */
export function modalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null;
}

function subscribeFocus(cb: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('focusin', cb);
  document.addEventListener('focusout', cb);
  return () => {
    document.removeEventListener('focusin', cb);
    document.removeEventListener('focusout', cb);
  };
}

/**
 * True while keyboard focus is somewhere that swallows plant hotkeys (the ladder editor, a text
 * field, a dialog): the control pad dims its key chips and says how to get the keys back.
 */
export function useHotkeysPaused(): boolean {
  return useSyncExternalStore(
    subscribeFocus,
    () => typeof document !== 'undefined' && isTypingTarget(document.activeElement),
    () => false,
  );
}

/** Latest value in a ref (for stable callbacks). */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Persisted UI preference (localStorage, guarded). */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T): void => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // ignore quota / private mode
    }
  };
  return [value, set];
}

const obsCache = new WeakMap<SimRuntime, { version: number; values: Record<string, boolean | number> }>();

/** `runtime.observe()` memoized per fixed step (many small subscribers read it every notification). */
export function observeCached(runtime: SimRuntime): Record<string, boolean | number> {
  const c = obsCache.get(runtime);
  if (c && c.version === runtime.version) return c.values;
  const values = runtime.observe();
  obsCache.set(runtime, { version: runtime.version, values });
  return values;
}
