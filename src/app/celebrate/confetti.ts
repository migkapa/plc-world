/**
 * Confetti bursts for celebrations (canvas-confetti), above modals, off when reduced motion is on.
 */
import confetti from 'canvas-confetti';

const COLORS = ['#f5c400', '#22c55e', '#38bdf8', '#e0252b', '#ffffff', '#a78bfa'];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** A celebratory burst from both lower corners (level up / 3 stars). */
export function celebrateBurst(opts: { reducedMotion?: boolean; big?: boolean } = {}): void {
  if (opts.reducedMotion || prefersReducedMotion()) return;
  const base = { zIndex: 120, colors: COLORS, disableForReducedMotion: true, ticks: 220 } as const;
  const n = opts.big ? 140 : 80;
  try {
    void confetti({ ...base, particleCount: n, angle: 60, spread: 70, startVelocity: 55, origin: { x: 0.05, y: 0.85 } });
    void confetti({ ...base, particleCount: n, angle: 120, spread: 70, startVelocity: 55, origin: { x: 0.95, y: 0.85 } });
    if (opts.big) {
      window.setTimeout(() => void confetti({ ...base, particleCount: 120, spread: 120, startVelocity: 40, origin: { x: 0.5, y: 0.35 } }), 250);
    }
  } catch {
    // canvas unavailable
  }
}

/** Small star-coloured puff (star pop). */
export function starPuff(x: number, y: number, reducedMotion?: boolean): void {
  if (reducedMotion || prefersReducedMotion()) return;
  try {
    void confetti({ zIndex: 120, particleCount: 18, spread: 50, startVelocity: 18, scalar: 0.7, ticks: 90, colors: ['#facc15', '#fde68a'], origin: { x, y }, disableForReducedMotion: true });
  } catch {
    // ignore
  }
}
