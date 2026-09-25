/**
 * StrictMode-safe disposal of three.js resources owned by a component.
 *
 * The tempting pattern
 *
 *   const mat = useMemo(() => new THREE.MeshStandardMaterial(), []);
 *   useEffect(() => () => mat.dispose(), [mat]);
 *
 * breaks under React 19 StrictMode in dev: React runs mount → cleanup → mount on the SAME component instance and
 * keeps the memoised value, so the first (simulated) cleanup disposes a resource the remounted component keeps
 * rendering with. three.js mostly re-uploads a disposed object on next use, but not always (geometry whose arrays
 * were released after upload, closed ImageBitmaps, render targets captured by other passes…), which shows up as an
 * invisible mesh or a black texture only in development.
 *
 * `useDisposeOnUnmount(value, dispose)` defers the disposal by a macrotask and only runs it when the value is no
 * longer the one the component has mounted — i.e. on a real unmount, or when `value` was replaced by a new one
 * (deps of the useMemo changed). StrictMode's synchronous unmount/remount cycle keeps it alive.
 */
import { useEffect, useRef } from 'react';

export interface Disposable {
  dispose(): void;
}

type DisposableLike = Disposable | null | undefined | false;

/** Dispose a disposable or a list of disposables (null / undefined / false entries are skipped). */
export function disposeAll(value: DisposableLike | readonly DisposableLike[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const v of value as readonly DisposableLike[]) if (v) v.dispose();
    return;
  }
  (value as Disposable).dispose();
}

/**
 * Disposes `value` (with `dispose`, default: `value.dispose()` / every item of an array) after the owning component
 * really unmounts or after `value` changes identity. Pass the memoised resource or an array of them (anything else
 * needs a `dispose` callback).
 */
export function useDisposeOnUnmount<T>(value: T, dispose?: (value: T) => void): void {
  const mounted = useRef<T | null>(null);
  useEffect(() => {
    mounted.current = value;
    // the dispose callback of the render that introduced `value` (it may close over that render's resources)
    const run = dispose;
    return () => {
      mounted.current = null;
      setTimeout(() => {
        // re-mounted with the same value (StrictMode) → still in use
        if (mounted.current === value) return;
        if (run) run(value);
        else disposeAll(value as unknown as DisposableLike | readonly DisposableLike[]);
      }, 0);
    };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
}
