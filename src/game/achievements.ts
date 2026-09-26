/**
 * Achievements: definitions, game events, stat bookkeeping and evaluation. Headless (no React / DOM).
 *
 * Flow (the store does this for you):
 *   1. `applyEventToStats(profile.stats, event)`  — cumulative counters (sandbox time, forces used…)
 *   2. update mission progress for `missionCompleted`
 *   3. `evaluateAchievements(updatedProfile, event)` — ids newly unlocked (not yet in profile.achievements)
 */
import { CHAPTERS } from './chapters';
import { MISSIONS, getMission, missionsByChapter } from './missions';
import { levelForXp } from './ranks';
import type { AchievementDef, PlayerProfile } from './types';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Things that happen in the game; the UI reports them with `useGame.getState().recordEvent(e)`. */
export type GameEvent =
  | {
      type: 'missionCompleted';
      missionId: string;
      stars: 0 | 1 | 2 | 3;
      hintsUsed: number;
      instructionCount: number;
      durationMs: number;
      /** Passed on the first test run of this attempt. */
      firstAttempt: boolean;
      /** Failed test runs in this attempt before passing. */
      failedRuns?: number;
    }
  | { type: 'testRunFailed'; missionId: string; failedTests?: number }
  | { type: 'hintUsed'; missionId: string; index: number }
  | { type: 'forceUsed' }
  | { type: 'majorFaultCleared' }
  | { type: 'sandboxTime'; ms: number }
  | { type: 'toggleBitUsed' }
  | { type: 'rungEdited'; count?: number }
  | { type: 'neutralTextUsed' }
  | { type: 'controlUsed'; sceneId: string; controlId: string }
  | { type: 'showroomVisited'; device?: string }
  | { type: 'referenceViewed'; mnemonic?: string }
  | { type: 'profileRenamed' }
  | { type: 'streakUpdated'; days: number }
  /** A guided tour ended (`skipped`: the player closed it before the last step). */
  | { type: 'tutorialFinished'; tutorialId: string; skipped: boolean };

export type GameEventType = GameEvent['type'];

/** Stat counter keys kept in `PlayerProfile.stats`. */
export const STAT = {
  forcesUsed: 'forcesUsed',
  majorFaultsCleared: 'majorFaultsCleared',
  sandboxMs: 'sandboxMs',
  toggleBitUses: 'toggleBitUses',
  rungEdits: 'rungEdits',
  neutralTextUses: 'neutralTextUses',
  estopPresses: 'estopPresses',
  controlsUsed: 'controlsUsed',
  showroomVisits: 'showroomVisits',
  referenceViews: 'referenceViews',
  hintsRevealed: 'hintsRevealed',
  testRunsFailed: 'testRunsFailed',
  missionClears: 'missionClears',
  renamed: 'renamed',
  tutorialsCompleted: 'tutorialsCompleted',
} as const;

/** New stats object with the event's counters applied (pure). */
export function applyEventToStats(stats: Readonly<Record<string, number>> | undefined, event: GameEvent): Record<string, number> {
  const out: Record<string, number> = { ...(stats ?? {}) };
  const inc = (k: string, n = 1): void => {
    out[k] = (out[k] ?? 0) + n;
  };
  switch (event.type) {
    case 'forceUsed':
      inc(STAT.forcesUsed);
      break;
    case 'majorFaultCleared':
      inc(STAT.majorFaultsCleared);
      break;
    case 'sandboxTime':
      if (Number.isFinite(event.ms) && event.ms > 0) inc(STAT.sandboxMs, event.ms);
      break;
    case 'toggleBitUsed':
      inc(STAT.toggleBitUses);
      break;
    case 'rungEdited':
      inc(STAT.rungEdits, Math.max(1, Math.floor(event.count ?? 1)));
      break;
    case 'neutralTextUsed':
      inc(STAT.neutralTextUses);
      break;
    case 'controlUsed':
      inc(STAT.controlsUsed);
      if (event.controlId === 'estop') inc(STAT.estopPresses);
      break;
    case 'showroomVisited':
      inc(STAT.showroomVisits);
      break;
    case 'referenceViewed':
      inc(STAT.referenceViews);
      break;
    case 'hintUsed':
      inc(STAT.hintsRevealed);
      break;
    case 'testRunFailed':
      inc(STAT.testRunsFailed);
      break;
    case 'missionCompleted':
      inc(STAT.missionClears);
      break;
    case 'profileRenamed':
      inc(STAT.renamed);
      break;
    case 'streakUpdated':
      break;
    case 'tutorialFinished':
      if (!event.skipped) inc(STAT.tutorialsCompleted);
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

interface EvalContext {
  profile: PlayerProfile;
  event: GameEvent;
  now: Date;
  stat(key: string): number;
}

interface AchievementRule extends AchievementDef {
  /** True when the achievement should be unlocked (checked on every event). */
  check(ctx: EvalContext): boolean;
}

const completed = (p: PlayerProfile, id: string): boolean => p.missions[id]?.completed === true;

function chapterDone(p: PlayerProfile, chapterId: string, extra?: (id: string) => boolean): boolean {
  const list = missionsByChapter(chapterId);
  return list.length > 0 && list.every((m) => completed(p, m.id) && (extra ? extra(m.id) : true));
}

function totalStarsOf(p: PlayerProfile): number {
  let n = 0;
  for (const m of MISSIONS) n += p.missions[m.id]?.stars ?? 0;
  return n;
}

function parMissions(p: PlayerProfile): number {
  let n = 0;
  for (const m of MISSIONS) {
    const pr = p.missions[m.id];
    if (!pr?.completed || m.parInstructions === undefined || pr.bestInstructionCount === undefined) continue;
    if (pr.bestInstructionCount <= m.parInstructions) n++;
  }
  return n;
}

const completedEvent = (e: GameEvent): Extract<GameEvent, { type: 'missionCompleted' }> | undefined =>
  e.type === 'missionCompleted' && e.stars > 0 ? e : undefined;

const CHAPTER_TROPHIES: Record<string, { title: string; description: string }> = {
  'power-up': { title: 'Powered Up', description: 'Complete chapter 1 — Power Up.' },
  'motor-control': { title: 'Commissioned', description: 'Complete chapter 2 — Motor Control.' },
  timing: { title: 'Right on Time', description: 'Complete chapter 3 — Timing Is Everything.' },
  counting: { title: 'Bean Counter', description: 'Complete chapter 4 — Counting & Tracking.' },
  analog: { title: 'Analog Soul', description: 'Complete chapter 5 — Analog & Math.' },
  sequencing: { title: 'Step by Step', description: 'Complete chapter 6 — Sequencing.' },
  troubleshooting: { title: 'Troubleshooter', description: 'Complete chapter 7 — Troubleshooting.' },
};

const RULES: AchievementRule[] = [
  // --- story milestones ---
  {
    id: 'first-light',
    title: 'First Light',
    description: 'Light your very first pilot lamp ("Hello, Lamp").',
    icon: 'Lightbulb',
    xp: 25,
    check: ({ profile }) => completed(profile, '1-1'),
  },
  {
    id: 'sealed-the-deal',
    title: 'Sealed the Deal',
    description: 'Write your first seal-in circuit ("Start/Stop Station").',
    icon: 'Link',
    xp: 50,
    check: ({ profile }) => completed(profile, '2-1'),
  },
  {
    id: 'safety-first',
    title: 'Safety First',
    description: 'Make the E-stop and the overload drop the motor for good ("Safety First").',
    icon: 'ShieldCheck',
    xp: 50,
    check: ({ profile }) => completed(profile, '2-3'),
  },
  {
    id: 'clockwork',
    title: 'Clockwork',
    description: 'Complete your first timer mission.',
    icon: 'Clock',
    xp: 50,
    check: ({ profile }) => missionsByChapter('timing').some((m) => completed(profile, m.id)),
  },
  {
    id: 'counting-sheep',
    title: 'Counting Sheep',
    description: 'Complete your first counter mission.',
    icon: 'Hash',
    xp: 50,
    check: ({ profile }) => missionsByChapter('counting').some((m) => completed(profile, m.id)),
  },
  // --- chapter trophies ---
  ...CHAPTERS.map(
    (ch): AchievementRule => ({
      id: `chapter-${ch.id}`,
      title: CHAPTER_TROPHIES[ch.id]?.title ?? `${ch.title} Complete`,
      description: CHAPTER_TROPHIES[ch.id]?.description ?? `Complete chapter ${ch.order} — ${ch.title}.`,
      icon: ch.icon,
      xp: 100 + 25 * (ch.order - 1),
      check: ({ profile }) => chapterDone(profile, ch.id),
    }),
  ),
  {
    id: 'campaign-complete',
    title: 'The Whole Plant',
    description: 'Complete every mission of the campaign.',
    icon: 'Crown',
    xp: 500,
    check: ({ profile }) => MISSIONS.length > 0 && MISSIONS.every((m) => completed(profile, m.id)),
  },
  // --- mastery ---
  {
    id: 'hat-trick',
    title: 'Hat Trick',
    description: 'Earn three stars on a mission.',
    icon: 'Star',
    xp: 25,
    check: ({ profile }) => MISSIONS.some((m) => profile.missions[m.id]?.stars === 3),
  },
  {
    id: 'no-training-wheels',
    title: 'No Training Wheels',
    description: 'Complete every mission of a chapter without revealing a single hint.',
    icon: 'Bike',
    xp: 100,
    check: ({ profile }) => CHAPTERS.some((ch) => chapterDone(profile, ch.id, (id) => (profile.missions[id]?.hintsUsed ?? 0) === 0)),
  },
  {
    id: 'perfectionist',
    title: 'Perfectionist',
    description: 'Earn three stars on every mission of a chapter.',
    icon: 'Sparkles',
    xp: 150,
    check: ({ profile }) => CHAPTERS.some((ch) => chapterDone(profile, ch.id, (id) => profile.missions[id]?.stars === 3)),
  },
  {
    id: 'pedant',
    title: 'Pedant',
    description: 'Solve 10 different missions at or under the par instruction count.',
    icon: 'Ruler',
    xp: 75,
    check: ({ profile }) => parMissions(profile) >= 10,
  },
  {
    id: 'star-collector',
    title: 'Star Collector',
    description: 'Earn 25 stars.',
    icon: 'Medal',
    xp: 50,
    check: ({ profile }) => totalStarsOf(profile) >= 25,
  },
  {
    id: 'constellation',
    title: 'Constellation',
    description: 'Earn 75 stars.',
    icon: 'Sparkles',
    xp: 150,
    check: ({ profile }) => totalStarsOf(profile) >= 75,
  },
  {
    id: 'speed-runner',
    title: 'Speed Runner',
    description: 'Clear a difficulty 3+ mission in under 2 minutes.',
    icon: 'Rocket',
    xp: 50,
    check: ({ event }) => {
      const e = completedEvent(event);
      return !!e && (getMission(e.missionId)?.difficulty ?? 0) >= 3 && e.durationMs > 0 && e.durationMs < 120_000;
    },
  },
  {
    id: 'one-and-done',
    title: 'One and Done',
    description: 'Pass a difficulty 3+ mission on your first test run.',
    icon: 'Target',
    xp: 50,
    check: ({ event }) => {
      const e = completedEvent(event);
      return !!e && e.firstAttempt && (getMission(e.missionId)?.difficulty ?? 0) >= 3;
    },
  },
  {
    id: 'never-give-up',
    title: 'Never Give Up',
    description: 'Clear a mission after five or more failed test runs.',
    icon: 'Mountain',
    xp: 40,
    check: ({ event }) => {
      const e = completedEvent(event);
      return !!e && (e.failedRuns ?? 0) >= 5;
    },
  },
  {
    id: 'moving-up',
    title: 'Moving Up',
    description: 'Reach level 5.',
    icon: 'TrendingUp',
    xp: 50,
    check: ({ profile }) => levelForXp(profile.xp).level >= 5,
  },
  {
    id: 'career-path',
    title: 'Career Path',
    description: 'Reach level 10.',
    icon: 'Briefcase',
    xp: 100,
    check: ({ profile }) => levelForXp(profile.xp).level >= 10,
  },
  // --- habits ---
  {
    id: 'on-a-roll',
    title: 'On a Roll',
    description: 'Train three days in a row.',
    icon: 'Flame',
    xp: 30,
    check: ({ profile }) => profile.streakDays >= 3,
  },
  {
    id: 'dedicated',
    title: 'Dedicated',
    description: 'Train seven days in a row.',
    icon: 'Flame',
    xp: 100,
    check: ({ profile }) => profile.streakDays >= 7,
  },
  {
    id: 'force-of-habit',
    title: 'Force of Habit',
    description: 'Install your first I/O force. (In a real plant: remove it again, and tell the next shift!)',
    icon: 'Magnet',
    xp: 25,
    check: ({ stat }) => stat(STAT.forcesUsed) >= 1,
  },
  {
    id: 'fault-finder',
    title: 'Fault Finder',
    description: 'Clear a major fault on the controller.',
    icon: 'Siren',
    xp: 50,
    check: ({ stat }) => stat(STAT.majorFaultsCleared) >= 1,
  },
  {
    id: 'toggle-tactician',
    title: 'Toggle Tactician',
    description: 'Flip a bit online with Toggle Bit.',
    icon: 'ToggleRight',
    xp: 15,
    check: ({ stat }) => stat(STAT.toggleBitUses) >= 1,
  },
  {
    id: 'tinkerer',
    title: 'Tinkerer',
    description: 'Spend 10 minutes experimenting in the sandbox.',
    icon: 'Hammer',
    xp: 30,
    check: ({ stat }) => stat(STAT.sandboxMs) >= 10 * 60_000,
  },
  {
    id: 'rung-wrangler',
    title: 'Rung Wrangler',
    description: 'Edit 100 rungs.',
    icon: 'Pencil',
    xp: 40,
    check: ({ stat }) => stat(STAT.rungEdits) >= 100,
  },
  {
    id: 'window-shopper',
    title: 'Window Shopper',
    description: 'Visit the hardware showroom.',
    icon: 'Store',
    xp: 10,
    check: ({ stat }) => stat(STAT.showroomVisits) >= 1,
  },
  {
    id: 'read-the-manual',
    title: 'Read the Manual',
    description: 'Open 10 instruction reference pages.',
    icon: 'BookOpen',
    xp: 25,
    check: ({ stat }) => stat(STAT.referenceViews) >= 10,
  },
  // --- secrets ---
  {
    id: 'night-owl',
    title: 'Night Owl',
    description: 'Complete a mission between midnight and 5 AM. The night shift salutes you.',
    icon: 'Moon',
    secret: true,
    xp: 25,
    check: ({ event, now }) => !!completedEvent(event) && now.getHours() < 5,
  },
  {
    id: 'big-red-button',
    title: 'Big Red Button',
    description: 'Push an E-stop 10 times. It is very satisfying, we know.',
    icon: 'OctagonX',
    secret: true,
    xp: 20,
    check: ({ stat }) => stat(STAT.estopPresses) >= 10,
  },
  {
    id: 'plain-text-hero',
    title: 'Plain Text Hero',
    description: 'Edit a rung in neutral text, like the pros do in L5X files.',
    icon: 'Keyboard',
    secret: true,
    xp: 15,
    check: ({ stat }) => stat(STAT.neutralTextUses) >= 1,
  },
  {
    id: 'name-tag',
    title: 'Name Tag',
    description: 'Put your name on your hard hat.',
    icon: 'IdCard',
    secret: true,
    xp: 10,
    check: ({ stat }) => stat(STAT.renamed) >= 1,
  },
];

/** Every achievement (the UI shows secret ones as '???' until unlocked). */
export const ACHIEVEMENTS: readonly AchievementDef[] = RULES.map(({ id, title, description, icon, secret, xp }) =>
  secret ? { id, title, description, icon, secret, xp } : { id, title, description, icon, xp },
);

const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r] as const));

/** Achievement by id. */
export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/**
 * Ids of achievements that `event` (already applied to `profile`: mission progress and stats updated)
 * unlocks now — excluding the ones already in `profile.achievements`.
 */
export function evaluateAchievements(profile: PlayerProfile, event: GameEvent, now: Date = new Date()): string[] {
  const stats = profile.stats ?? {};
  const ctx: EvalContext = { profile, event, now, stat: (k) => stats[k] ?? 0 };
  const out: string[] = [];
  for (const rule of RULES) {
    if (profile.achievements[rule.id] !== undefined) continue;
    let ok = false;
    try {
      ok = rule.check(ctx);
    } catch {
      ok = false;
    }
    if (ok) out.push(rule.id);
  }
  return out;
}

/** XP value of an achievement (0 for unknown ids). */
export function achievementXp(id: string): number {
  return RULE_BY_ID.get(id)?.xp ?? 0;
}
