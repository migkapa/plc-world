import { describe, expect, it } from 'vitest';
import { tickLabel, tickStep } from './TimingDiagram';

describe('timing diagram axis', () => {
  it('labels ticks with the decimals the step needs', () => {
    expect(tickLabel(0, 500)).toBe('now');
    expect(tickLabel(2000, 500)).toBe('−2 s');
    expect(tickLabel(1500, 500)).toBe('−1.5 s');
    expect(tickLabel(250, 250)).toBe('−0.25 s');
    expect(tickLabel(8000, 2000)).toBe('−8 s');
  });
  it('never repeats a label in any window/width', () => {
    for (const windowMs of [10_000, 2_000, 500]) {
      for (const plotW of [200, 230, 480, 700, 1100]) {
        const step = tickStep(windowMs, plotW);
        const labels: string[] = [];
        for (let ago = windowMs; ago >= 0; ago -= step) labels.push(tickLabel(ago, step));
        expect(new Set(labels).size).toBe(labels.length);
        expect(windowMs % step).toBe(0);
      }
    }
  });
  it('keeps the 2 s window at 0.5 s steps on desktop', () => {
    expect(tickStep(2_000, 480)).toBe(500);
    expect(tickStep(10_000, 480)).toBe(2000);
  });
});
