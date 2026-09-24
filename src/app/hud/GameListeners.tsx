/**
 * Global game listeners, mounted once in <App/>:
 *  - toasts for newly unlocked achievements (tone 'achievement', sfx 'achievement') via useGame.consumeUnlocks()
 *  - level-up / promotion toasts (sfx 'levelUp') — held back while the mission celebration shows its own
 *    level-up; a promotion earned there is toasted after the celebration closes
 *  - applies settings: sfx.setEnabled(settings.sound), master volume, `html.reduce-motion` class
 */
import { useEffect } from 'react';
import { sfx } from '../../audio/sfx';
import { getAchievement } from '../../game/achievements';
import { levelForXp } from '../../game/ranks';
import { useGame } from '../../game/store';
import { toast } from '../../ui';
import { useUiPrefs } from './prefs';
import './hud.css';

const STAGGER_MS = 420;

type GameSnapshot = ReturnType<typeof useGame.getState>;

/** The update is completeMission() recording a pass: XP and a completed mission's progress change together. */
function isMissionClear(s: GameSnapshot, before: GameSnapshot): boolean {
  if (s.profile.xp === before.profile.xp || s.profile.missions === before.profile.missions) return false;
  return Object.keys(s.profile.missions).some((id) => {
    const now = s.profile.missions[id];
    return !!now?.completed && now !== before.profile.missions[id];
  });
}

/** The mission-complete celebration overlay is on screen (it announces level-ups itself). */
function celebrationShowing(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[data-testid="celebration"]');
}

/** Run `fn` once the celebration (if it opens) has closed: first give it time to open, then poll. */
function afterCelebration(later: (fn: () => void, ms: number) => void, fn: () => void): void {
  let polls = 0;
  let seen = false;
  const check = (): void => {
    polls++;
    if (celebrationShowing()) seen = true;
    else if (seen || polls >= 4) return void later(fn, 400);
    if (polls < 2400) later(check, 500); // give up after ~20 min
  };
  later(check, 500);
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
  // animates its own level-up with the fanfare — so no toast / second fanfare then. A promotion earned
  // that way is announced once the celebration has been closed.
  useEffect(() => {
    let prev = levelForXp(useGame.getState().profile.xp);
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number): void => {
      const h = window.setTimeout(() => {
        timers.delete(h);
        fn();
      }, ms);
      timers.add(h);
    };
    const unsub = useGame.subscribe((s, before) => {
      const cur = levelForXp(s.profile.xp);
      const from = prev;
      prev = cur;
      if (cur.level <= from.level) return;
      const promoted = cur.rank.title !== from.rank.title;
      const promotion = (): void => {
        toast({ tone: 'achievement', title: `Promoted: ${cur.rank.title}!`, body: `You reached level ${cur.level}. New insignia unlocked on your profile.`, duration: 6000 });
      };
      if (isMissionClear(s, before) || celebrationShowing()) {
        if (promoted) afterCelebration(later, () => {
          promotion();
          sfx.play('achievement');
        });
        return;
      }
      later(() => {
        if (celebrationShowing()) {
          if (promoted) afterCelebration(later, promotion);
          return;
        }
        if (promoted) promotion();
        else toast({ tone: 'success', title: `Level up! Level ${cur.level}`, body: `${cur.rank.title} · ${cur.xpToNext.toLocaleString('en-US')} XP to level ${cur.level + 1}`, duration: 5000 });
        sfx.play('levelUp');
      }, 250);
    });
    return () => {
      unsub();
      timers.forEach((h) => window.clearTimeout(h));
    };
  }, []);

  return null;
}
