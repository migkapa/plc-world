import { useEffect } from 'react';
import type { SimRuntime } from './types';

/**
 * Drive a SimRuntime from requestAnimationFrame (real time × runtime.speed, honouring runtime.paused).
 * Exactly ONE place should tick a runtime: the page that owns it (not the 3D view), so the plant keeps
 * running even when the 3D panel is hidden. Tab-hidden frames are skipped by the browser; the runtime
 * caps catch-up work. One frame advances at most 250 ms (the runtime's default catch-up), so the plant keeps
 * real time down to ~4 fps; momentary taps between two slow frames are latched by the runtime.
 */
export function useSimLoop(runtime: SimRuntime | null | undefined, enabled = true): void {
  useEffect(() => {
    if (!runtime || !enabled) return;
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(250, t - last);
      last = t;
      runtime.tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime, enabled]);
}
