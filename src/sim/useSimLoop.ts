import { useEffect } from 'react';
import type { SimRuntime } from './types';

/**
 * Drive a SimRuntime from requestAnimationFrame (real time × runtime.speed, honouring runtime.paused).
 * Exactly ONE place should tick a runtime: the page that owns it (not the 3D view), so the plant keeps
 * running even when the 3D panel is hidden. Tab-hidden frames are skipped by the browser; the runtime
 * caps catch-up work.
 */
export function useSimLoop(runtime: SimRuntime | null | undefined, enabled = true): void {
  useEffect(() => {
    if (!runtime || !enabled) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      runtime.tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime, enabled]);
}
