/** Hotspot marker layout helper (headless). */

/**
 * Spreads projected marker positions so no two visible markers overlap (a few relaxation passes; each marker moves
 * at most ~half the minimum gap from its feature).
 */
export function spreadMarkers(xs: Float32Array, ys: Float32Array, active: ArrayLike<boolean>, minGap: number, passes = 4): void {
  const n = xs.length;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!active[j]) continue;
        let dx = xs[j]! - xs[i]!;
        let dy = ys[j]! - ys[i]!;
        let dist = Math.hypot(dx, dy);
        if (dist >= minGap) continue;
        if (dist < 0.01) {
          // coincident: separate along a fixed diagonal so the result is stable frame to frame
          dx = 0.7071;
          dy = 0.7071;
          dist = 1;
        }
        const push = (minGap - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        xs[i] = xs[i]! - ux * push;
        ys[i] = ys[i]! - uy * push;
        xs[j] = xs[j]! + ux * push;
        ys[j] = ys[j]! + uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}
