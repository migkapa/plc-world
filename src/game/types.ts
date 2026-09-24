/**
 * Gamification contracts: missions (levels), automated acceptance tests, progress & achievements.
 */
import type { TagDef } from '../plc/types';

/** One step of an automated acceptance test, run headless against scene logic + controller. */
export type TestStep =
  /** Let simulated time pass. */
  | { do: 'wait'; ms: number }
  /** Operate a scene control (push button, switch, fault injection...). */
  | { do: 'control'; id: string; value: boolean | number }
  /** Press a momentary control for `ms` (default 200 ms) and release it. */
  | { do: 'tap'; id: string; ms?: number }
  /**
   * Remote mode change of the controller (key switch stays in REM), e.g. to prove that a latched
   * output does not restart the machine after a PROG -> RUN transition (prescan / S:FS lessons).
   * `RUN` fails the step if the controller refuses (faulted / verification errors).
   */
  | { do: 'mode'; mode: 'PROG' | 'RUN' }
  /**
   * Check an observable (scene) or a tag (controller) value.
   * - `equals`: exact match (booleans, integers)
   * - `min`/`max`: numeric range (inclusive)
   * - `within`: keep simulating up to `within` ms until the condition holds (fails if it never does)
   * - `for`: the condition must hold continuously for `for` ms
   */
  | {
      do: 'expect';
      observe?: string;
      tag?: string;
      equals?: boolean | number;
      min?: number;
      max?: number;
      within?: number;
      for?: number;
      message: string;
    };

export interface MissionTest {
  name: string;
  /** Shown in the results panel when the test fails. */
  description?: string;
  steps: TestStep[];
}

/** A value probe + condition (used by `MissionInvariant.when`). */
export interface MissionCondition {
  observe?: string;
  tag?: string;
  /** Scene control value (e.g. `{ control: 'estop', equals: true }` = while the E-stop is pushed). */
  control?: string;
  equals?: boolean | number;
  min?: number;
  max?: number;
}

/** Condition that must hold at every simulation step of every test (e.g. "never both directions green"). */
export interface MissionInvariant {
  observe?: string;
  tag?: string;
  equals?: boolean | number;
  min?: number;
  max?: number;
  message: string;
  /** Only enforce the invariant while this condition holds (e.g. only while the E-stop is pushed). */
  when?: MissionCondition;
  /**
   * Tolerated violation time in ms (default 0): the invariant fails only when it is violated for
   * longer than this, e.g. 20 ms = two scans for logic that reacts through an internal bit.
   */
  graceMs?: number;
}

export type MissionKind = 'build' | 'troubleshoot' | 'boss';

export interface MissionDef {
  id: string;
  /** Chapter id (see ChapterDef). */
  chapter: string;
  /** Order within the chapter (1-based). */
  order: number;
  title: string;
  /** One-liner shown on the campaign map card. */
  tagline: string;
  kind: MissionKind;
  /** Scene id from the scene registry, e.g. 'motor-station'. */
  sceneId: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  xp: number;
  /** Markdown briefing (story + what to build). Use **bold**, `code`, lists. */
  briefing: string;
  /** Checklist shown in the mission HUD. */
  objectives: string[];
  /** Instruction mnemonics this mission introduces or practices (shown as chips). */
  concepts: string[];
  /** Starting program (neutral text rungs). Empty array = empty routine with one blank rung. */
  starter: { rungs: string[]; tags?: TagDef[]; comments?: string[] };
  /** Reference solution; must pass all tests (enforced by a unit test). */
  solution: { rungs: string[]; tags?: TagDef[] };
  /** Progressive hints; using hints lowers the star rating. */
  hints: string[];
  tests: MissionTest[];
  invariants?: MissionInvariant[];
  /** Instruction count considered "par" for the efficiency star. */
  parInstructions?: number;
  /** Restrict the palette (undefined = everything). */
  allowedInstructions?: string[];
  /**
   * Instructions the program must use (e.g. ['OTL','OTU'] in a latch lesson); checked like a verify error.
   * An entry may name the operand too, e.g. 'OTL(Motor_Starter)' (case-insensitive, aliases resolved), so a
   * dummy instruction on an unrelated tag does not satisfy the lesson.
   */
  requiredInstructions?: string[];
  /** Mission ids that must be completed first (defaults to the previous mission in the chapter). */
  requires?: string[];
  /** Short text shown on success. */
  debrief?: string;
}

export interface ChapterDef {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  /** Emoji-free icon name from lucide-react, e.g. 'Zap', 'Timer'. */
  icon: string;
  /** Accent color (hex). */
  color: string;
  description: string;
}

export interface TestStepResult {
  ok: boolean;
  message?: string;
  timeMs: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  /** First failure message, if any. */
  failure?: string;
  failedAtMs?: number;
  steps: TestStepResult[];
}

export interface MissionRunResult {
  missionId: string;
  passed: boolean;
  tests: TestResult[];
  /** Verification (compile) errors prevent running tests. */
  verifyErrors: string[];
  instructionCount: number;
  stars: 0 | 1 | 2 | 3;
}

export interface MissionProgress {
  completed: boolean;
  stars: 0 | 1 | 2 | 3;
  bestInstructionCount?: number;
  hintsUsed: number;
  attempts: number;
  /** Saved player program (neutral text rungs + comments) so work is never lost. */
  savedRungs?: string[];
  savedComments?: (string | undefined)[];
  savedTags?: TagDef[];
  completedAt?: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Hidden achievements show '???' until unlocked. */
  secret?: boolean;
  xp: number;
}

export interface PlayerProfile {
  name: string;
  xp: number;
  missions: Record<string, MissionProgress>;
  achievements: Record<string, number>; // id -> unlocked timestamp
  /** Consecutive days with at least one mission attempt. */
  streakDays: number;
  lastActiveDay?: string;
  settings: { sound: boolean; reducedMotion: boolean; quality: 'low' | 'medium' | 'high' };
  /** Cumulative counters for achievements (e.g. sandboxMs, forcesUsed, rungEdits). */
  stats?: Record<string, number>;
}
