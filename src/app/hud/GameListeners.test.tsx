// @vitest-environment jsdom
/**
 * Level-up / promotion announcements vs. the mission celebration (jsdom): while the CelebrationModal
 * is open (useUiStore.celebrating) GameListeners holds its toasts and sounds back; afterwards it skips
 * what the celebration already announced and toasts the rest.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/sfx', () => ({
  sfx: { play: vi.fn(), setEnabled: vi.fn(), setVolume: vi.fn(), setLoop: vi.fn() },
}));

import { sfx } from '../../audio/sfx';
import { xpForLevel } from '../../game/ranks';
import { createDefaultProfile, useGame } from '../../game/store';
import { useToasts } from '../../ui';
import { AFTER_CELEBRATION_MS, CELEBRATION_WAIT_MS, GameListeners, LEVEL_UP_DELAY_MS } from './GameListeners';
import { useUiStore } from './uiStore';

const play = sfx.play as unknown as ReturnType<typeof vi.fn>;
const titles = (): string[] => useToasts.getState().toasts.map((t) => t.title);
const sounds = (): string[] => play.mock.calls.map((c) => String(c[0]));

function setXp(xp: number): void {
  act(() => useGame.setState((s) => ({ profile: { ...s.profile, xp } })));
}

/** What completeMission() does to the store: XP and a newly completed mission together. */
function clearMission(xp: number): void {
  act(() =>
    useGame.setState((s) => ({
      profile: { ...s.profile, xp, missions: { ...s.profile.missions, '1-1': { completed: true, stars: 3, hintsUsed: 0, attempts: 1 } } },
    })),
  );
}

const advance = (ms: number): void => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  useGame.setState({ profile: createDefaultProfile(), session: {}, recentUnlocks: [] });
  useToasts.setState({ toasts: [] });
  useUiStore.setState({ celebrating: false, celebratedLevel: null });
  play.mockClear();
  render(<GameListeners />);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GameListeners level-ups', () => {
  it('toasts a level-up with the fanfare when no celebration is open', () => {
    setXp(xpForLevel(2) + 5);
    expect(titles()).toEqual([]);
    advance(LEVEL_UP_DELAY_MS + 10);
    expect(titles()).toEqual(['Level up! Level 2']);
    expect(sounds()).toEqual(['levelUp']);
  });

  it('holds everything back while celebrating and skips the level-up the celebration showed', () => {
    act(() => useUiStore.getState().beginCelebration(2));
    setXp(xpForLevel(2) + 5);
    advance(5000);
    expect(titles()).toEqual([]);
    expect(sounds()).toEqual([]);
    act(() => useUiStore.getState().endCelebration());
    advance(AFTER_CELEBRATION_MS + 10);
    expect(titles()).toEqual([]);
    expect(sounds()).toEqual([]);
  });

  it('a promotion shown by the celebration is toasted after it closes, without a second fanfare', () => {
    setXp(xpForLevel(2));
    advance(LEVEL_UP_DELAY_MS + 10);
    useToasts.setState({ toasts: [] });
    play.mockClear();
    // mission clear → level 3 (Junior Technician): the celebration opens right after the store update
    clearMission(xpForLevel(3) + 1);
    act(() => useUiStore.getState().beginCelebration(3));
    advance(4000);
    expect(titles()).toEqual([]);
    act(() => useUiStore.getState().endCelebration());
    expect(titles()).toEqual([]);
    advance(AFTER_CELEBRATION_MS + 10);
    expect(titles()).toEqual(['Promoted: Junior Technician!']);
    expect(sounds()).toEqual(['achievement']);
  });

  it('a mission clear waits for its celebration to open (store update comes first)', () => {
    clearMission(xpForLevel(2) + 5);
    advance(LEVEL_UP_DELAY_MS + 10);
    expect(titles()).toEqual([]); // not yet: the celebration is about to open
    act(() => useUiStore.getState().beginCelebration(2));
    advance(10_000);
    act(() => useUiStore.getState().endCelebration());
    advance(AFTER_CELEBRATION_MS + 10);
    expect(titles()).toEqual([]);
    expect(sounds()).toEqual([]);
  });

  it('announces a mission-clear level-up anyway when no celebration opens', () => {
    clearMission(xpForLevel(2) + 5);
    advance(CELEBRATION_WAIT_MS + LEVEL_UP_DELAY_MS * 2);
    expect(titles()).toEqual(['Level up! Level 2']);
    expect(sounds()).toEqual(['levelUp']);
  });

  it('a level-up beyond what the celebration showed is toasted after it closes', () => {
    act(() => useUiStore.getState().beginCelebration(null)); // the run itself did not level up
    setXp(xpForLevel(2) + 5); // e.g. achievement XP while the modal is open
    advance(2000);
    expect(titles()).toEqual([]);
    act(() => useUiStore.getState().endCelebration());
    advance(AFTER_CELEBRATION_MS + 10);
    expect(titles()).toEqual(['Level up! Level 2']);
    expect(sounds()).toEqual(['levelUp']);
  });
});
