import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HIGHLIGHT_LINGER_MS, matchesHighlight, SHOW_HIGHLIGHT_MS, useSceneOverlay } from './overlay';

const st = () => useSceneOverlay.getState();

describe('scene overlay: device highlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    st().clearHighlight();
  });
  afterEach(() => {
    st().clearHighlight();
    vi.useRealTimers();
  });

  it('the most recent source wins; clearing it falls back to the one underneath', () => {
    st().setHighlight(['Light_0', 'Switch_0'], 'objective');
    expect(st().highlight).toEqual(['Light_0', 'Switch_0']);
    expect(st().highlightAlias).toBe('Light_0');
    st().setHighlight('Switch_0', 'chip');
    expect(st().highlight).toEqual(['Switch_0']);
    st().clearHighlight('chip');
    expect(st().highlight).toEqual(['Light_0', 'Switch_0']);
    expect(st().highlightLingering).toBe(false);
  });

  it('dedupes aliases case-insensitively and ignores blanks', () => {
    st().setHighlight(['Light_0', 'light_0', ' ', 'Switch_0'], 'x');
    expect(st().highlight).toEqual(['Light_0', 'Switch_0']);
    st().setHighlight(null, 'x');
    expect(st().highlightLingering).toBe(true);
  });

  it('lingers after the last source lets go, then clears (the target too)', () => {
    st().setHighlight('Light_0', 'row');
    st().reportTarget({ alias: 'Light_0', position: [0, 1, 0], radius: 0.02, onScreen: false, side: 'left' });
    st().clearHighlight('row');
    expect(st().highlight).toEqual(['Light_0']);
    expect(st().highlightLingering).toBe(true);
    vi.advanceTimersByTime(HIGHLIGHT_LINGER_MS - 10);
    expect(st().highlight).toEqual(['Light_0']);
    vi.advanceTimersByTime(20);
    expect(st().highlight).toEqual([]);
    expect(st().target).toBeNull();
  });

  it('a new hover during the linger takes over at once', () => {
    st().setHighlight('Light_0', 'row');
    st().clearHighlight('row');
    st().setHighlight('Light_1', 'row');
    expect(st().highlight).toEqual(['Light_1']);
    expect(st().highlightLingering).toBe(false);
    vi.advanceTimersByTime(HIGHLIGHT_LINGER_MS * 2);
    expect(st().highlight).toEqual(['Light_1']);
  });

  it('holdHighlight keeps a lingering highlight (pointer on the Show button)', () => {
    st().setHighlight('Light_0', 'row');
    st().clearHighlight('row');
    st().holdHighlight(true);
    vi.advanceTimersByTime(HIGHLIGHT_LINGER_MS * 3);
    expect(st().highlight).toEqual(['Light_0']);
    st().holdHighlight(false);
    vi.advanceTimersByTime(300);
    expect(st().highlight).toEqual([]);
  });

  it('showDevice highlights for a while and asks the view to fly there', () => {
    const seq = st().showSeq;
    st().showDevice('Start_PB');
    expect(st().showSeq).toBe(seq + 1);
    expect(st().showAlias).toBe('Start_PB');
    expect(st().highlight).toEqual(['Start_PB']);
    vi.advanceTimersByTime(SHOW_HIGHLIGHT_MS + HIGHLIGHT_LINGER_MS + 10);
    expect(st().highlight).toEqual([]);
  });

  it('reportTarget ignores reports that change nothing', () => {
    const t = { alias: 'Light_0', position: [0, 1, 0] as [number, number, number], radius: 0.02, onScreen: true };
    st().reportTarget(t);
    const first = st().target;
    st().reportTarget({ ...t, position: [0.001, 1, 0] });
    expect(st().target).toBe(first);
    st().reportTarget({ ...t, onScreen: false, side: 'hidden' });
    expect(st().target?.onScreen).toBe(false);
  });

  it('matchesHighlight compares names case-insensitively', () => {
    expect(matchesHighlight(['switch_0', 'local:1:i.data.0'], ['Switch_0'])).toBe(true);
    expect(matchesHighlight(['Switch_0'], ['LOCAL:1:I.DATA.0'])).toBe(false);
    expect(matchesHighlight(['local:1:i.data.0'], ['Local:1:I.Data.0'])).toBe(true);
    expect(matchesHighlight(['x'], [])).toBe(false);
  });
});
