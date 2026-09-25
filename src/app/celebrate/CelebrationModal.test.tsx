// @vitest-environment jsdom
/**
 * CelebrationModal as a dialog (jsdom): focus goes to "Next mission", Tab stays inside, Escape closes,
 * focus returns to the opener, and the UI store's `celebrating` flag is set while it is open.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/sfx', () => ({
  sfx: { play: vi.fn(), setEnabled: vi.fn(), setVolume: vi.fn(), setLoop: vi.fn() },
}));
vi.mock('./confetti', () => ({ celebrateBurst: vi.fn(), starPuff: vi.fn() }));

import { getMission, nextMission } from '../../game/missions';
import { createDefaultProfile, useGame, type CompletionOutcome } from '../../game/store';
import type { MissionRunResult } from '../../game/types';
import { useUiStore } from '../hud/uiStore';
import { CelebrationModal } from './CelebrationModal';

const mission = getMission('1-1')!;
const next = nextMission('1-1')!;
const outcome: CompletionOutcome = {
  xpGained: 150,
  missionXp: 100,
  achievementXp: 50,
  previousLevel: 1,
  newLevel: 2,
  newAchievements: [],
  improved: true,
  firstClear: true,
  stars: 3,
  previousStars: 0,
};
const result: MissionRunResult = { missionId: '1-1', passed: true, tests: [], verifyErrors: [], instructionCount: 2, stars: 3 };

beforeEach(() => {
  useGame.setState({ profile: { ...createDefaultProfile(), xp: 150, settings: { sound: false, reducedMotion: true, quality: 'high' } } });
  useUiStore.setState({ celebrating: false, celebratedLevel: null });
});
afterEach(() => cleanup());

function Page({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <div>
      <button type="button">Run tests</button>
      {open && (
        <CelebrationModal
          open
          mission={mission}
          outcome={outcome}
          result={result}
          hintsUsed={0}
          next={next}
          nextUnlocked
          onNext={() => undefined}
          onReplay={() => undefined}
          onMap={() => undefined}
          onClose={onClose}
        />
      )}
    </div>
  );
}

describe('CelebrationModal focus management', () => {
  it('autofocuses Next mission, traps Tab, closes on Escape and restores focus', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Page open={false} onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Run tests' });
    opener.focus();
    rerender(<Page open onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Mission complete' });
    const nextBtn = screen.getByTestId('celebrate-next');
    expect(document.activeElement).toBe(nextBtn);
    expect(useUiStore.getState()).toMatchObject({ celebrating: true, celebratedLevel: 2 });

    // Tab from the last button wraps to the first one inside the dialog (never to the page)
    // (jsdom has no layout: give the buttons client rects so the trap sees them as visible)
    for (const b of dialog.querySelectorAll('button')) b.getClientRects = () => [{}] as unknown as DOMRectList;
    const buttons = [...dialog.querySelectorAll('button')];
    buttons[buttons.length - 1]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => rerender(<Page open={false} onClose={onClose} />));
    expect(document.activeElement).toBe(opener);
    expect(useUiStore.getState().celebrating).toBe(false);
  });

  it('announces no level with the flag when the run did not level up', () => {
    render(
      <CelebrationModal
        open
        mission={mission}
        outcome={{ ...outcome, newLevel: 1 }}
        result={result}
        hintsUsed={0}
        onNext={() => undefined}
        onReplay={() => undefined}
        onMap={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(useUiStore.getState()).toMatchObject({ celebrating: true, celebratedLevel: null });
    // campaign end: the primary action is focused
    expect(document.activeElement?.textContent).toMatch(/Campaign complete/);
  });
});
