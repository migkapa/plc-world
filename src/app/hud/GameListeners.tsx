/**
 * Global game listeners, mounted once in <App/>:
 *  - toasts for newly unlocked achievements (tone 'achievement', sfx 'achievement') via useGame.consumeUnlocks()
 *  - level-up / promotion toasts (sfx 'levelUp') — held back while the mission celebration is open
 *    (`useUiStore.celebrating`): a level-up the celebration already announced is not repeated; a
 *    promotion is toasted (without a second fanfare) once the celebration has closed
 *  - applies settings: sfx.setEnabled(settings.sound), master volume, `html.reduce-motion` class
 */
import { useEffect } from 'react';
import { sfx } from '../../audio/sfx';
import { getAchievement } from '../../game/achievements';
import { levelForXp } from '../../game/ranks';
import { useGame } from '../../game/store';
import { toast } from '../../ui';
import { useUiPrefs } from './prefs';
import { useUiStore } from './uiStore';
import './hud.css';

const STAGGER_MS = 420;
/** Level-ups wait this long before being announced (a celebration opening right after can claim them). */
export const LEVEL_UP_DELAY_MS = 250;
/** A mission clear opens the celebration: wait at most this long for it before announcing anyway. */
export const CELEBRATION_WAIT_MS = 3000;
/** Pause between the celebration closing and the held-back toasts. */
export const AFTER_CELEBRATION_MS = 400;

type GameSnapshot = ReturnType<typeof useGame.getState>;

/** The update is completeMission() recording a pass: XP and a completed mission's progress change together. */
function isMissionClear(s: GameSnapshot, before: GameSnapshot): boolean {
  if (s.profile.xp === before.profile.xp || s.profile.missions === before.profile.missions) return false;
  return Object.keys(s.profile.missions).some((id) => {
    const now = s.profile.missions[id];
    return !!now?.completed && now !== before.profile.missions[id];
  });
}

interface LevelUpNote {
  level: number;
  promoted: boolean;
  rankTitle: string;
  xpToNext: number;
  /** Queued at (ms); a mission clear waits for its celebration until CELEBRATION_WAIT_MS later. */
  at: number;
  expectCelebration: boolean;
}

function announceAchievements(ids: string[]): void {
  ids.forEach((id, i) => {
    const a = getAchievement(id);
    if (!a) return;
    window.setTimeout(() => {
      toast({
        tone: 'achievement',
        title: `Achievement unlocked: ${a.title}`,
        body: `${a.description}  +${a.xp} XP`,
        duration: 5500,
      });
      sfx.play('achievement');
    }, i * STAGGER_MS);
  });
}

export function GameListeners() {
  const sound = useGame((s) => s.profile.settings.sound);
  const reducedMotion = useGame((s) => s.profile.settings.reducedMotion);
  const volume = useUiPrefs((s) => s.volume);

  useEffect(() => {
    sfx.setEnabled(sound);
  }, [sound]);

  useEffect(() => {
    sfx.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reducedMotion);
  }, [reducedMotion]);

  // Achievements: drain the store's queue now and whenever it fills up.
  useEffect(() => {
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      const ids = useGame.getState().consumeUnlocks();
      if (ids.length) announceAchievements(ids);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(flush);
    };
    if (useGame.getState().recentUnlocks.length) schedule();
    return useGame.subscribe((s, prev) => {
      if (s.recentUnlocks !== prev.recentUnlocks && s.recentUnlocks.length > 0) schedule();
    });
  }, []);

  // Level-ups and promotions. A passed mission (completeMission) opens the CelebrationModal, which
  // animates its own level-up with the fanfare — so no toast / second fanfare for that level. Anything
  // arriving while the celebration is open waits until it closes.
  useEffect(() => {
    let prev = levelForXp(useGame.getState().profile.xp);
    let queue: LevelUpNote[] = [];
    let sawCelebration = false;
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number): void => {
      const h = window.setTimeout(() => {
        timers.delete(h);
        fn();
      }, ms);
      timers.add(h);
    };

    /** Announce the queued level-ups; `covered` = level the celebration already announced. */
    const flush = (covered: number | null): void => {
      const notes = queue;
      queue = [];
      sawCelebration = false;
      const promo = [...notes].reverse().find((n) => n.promoted);
      const top = notes[notes.length - 1];
      if (!top) return;
      if (promo) {
        toast({ tone: 'achievement', title: `Promoted: ${promo.rankTitle}!`, body: `You reached level ${promo.level}. New insignia unlocked on your profile.`, duration: 6000 });
        // the celebration already played the level-up fanfare for it
        sfx.play(covered !== null && promo.level <= covered ? 'achievement' : 'levelUp');
        return;
      }
      if (covered !== null && top.level <= covered) return; // shown by the celebration
      toast({ tone: 'success', title: `Level up! Level ${top.level}`, body: `${top.rankTitle} · ${top.xpToNext.toLocaleString('en-US')} XP to level ${top.level + 1}`, duration: 5000 });
      sfx.play('levelUp');
    };

    const check = (): void => {
      if (queue.length === 0 || useUiStore.getState().celebrating) return; // flushed when it closes
      const waiting = queue.some((n) => n.expectCelebration && performance.now() - n.at < CELEBRATION_WAIT_MS);
      if (waiting && !sawCelebration) {
        later(check, LEVEL_UP_DELAY_MS);
        return;
      }
      flush(null);
    };

    const unsubGame = useGame.subscribe((s, before) => {
      const cur = levelForXp(s.profile.xp);
      const from = prev;
      prev = cur;
      if (cur.level <= from.level) return;
      queue.push({
        level: cur.level,
        promoted: cur.rank.title !== from.rank.title || queue.some((n) => n.promoted),
        rankTitle: cur.rank.title,
        xpToNext: cur.xpToNext,
        at: performance.now(),
        expectCelebration: isMissionClear(s, before),
      });
      later(check, LEVEL_UP_DELAY_MS);
    });

    const unsubUi = useUiStore.subscribe((ui, before) => {
      if (ui.celebrating && !before.celebrating) sawCelebration = true;
      if (!ui.celebrating && before.celebrating && queue.length > 0) {
        const covered = before.celebratedLevel;
        later(() => {
          if (useUiStore.getState().celebrating) return; // another one opened: wait for it
          flush(covered);
        }, AFTER_CELEBRATION_MS);
      }
    });

    return () => {
      unsubGame();
      unsubUi();
      timers.forEach((h) => window.clearTimeout(h));
    };
  }, []);

  return null;
}
