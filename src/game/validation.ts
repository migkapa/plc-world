/**
 * Headless mission validation: runs a mission's automated acceptance tests against a player's program
 * on the real controller runtime + scene model (exactly what the 3D view runs, without rendering).
 *
 * For every test: fresh controller (download) + fresh plant state + SimRuntime, key REM ->
 * requestMode('RUN'), then the test steps execute in 10 ms fixed steps (scene.step -> scan). The
 * mission invariants and "controller must not fault" are checked after every fixed step.
 *
 *   const result = runMission(mission, ['XIC(Switch_0)OTE(Light_0);'], { hintsUsed: 0 });
 *   result.passed, result.stars, result.tests[0].failure
 *
 * No React / DOM / three imports (runs in vitest's node environment).
 */
import { createController, type LogixController } from '../plc/controller';
import { instructionsOf, parseRung } from '../plc/neutralText';
import type { Project, Rung, TagDef, VerifyError } from '../plc/types';
import { formatVerifyError } from '../plc/verify';
import { faultId } from '../plc/errors';
import { createProjectForScene, MAIN_PROGRAM, MAIN_ROUTINE } from '../sim/project';
import { createSimRuntime, type SimRuntimeEx } from '../sim/runtime';
import { SCENE_LOGICS } from '../sim/scenes';
import type { SceneLogic } from '../sim/types';
import type {
  MissionCondition,
  MissionDef,
  MissionInvariant,
  MissionProgress,
  MissionRunResult,
  MissionTest,
  TestResult,
  TestStep,
  TestStepResult,
} from './types';

/** Fixed simulation step (ms) used by validation (same as the live runtime). */
export const VALIDATION_STEP_MS = 10;
/** Default press duration of a `tap` step. */
export const DEFAULT_TAP_MS = 200;
/** Safety net: a single test never simulates more than this (ms). */
export const MAX_TEST_SIM_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Program input & project building
// ---------------------------------------------------------------------------

/** Rungs as neutral text or rung objects. */
export type RungsInput = ReadonlyArray<string> | ReadonlyArray<Rung>;

/** What can be validated: rungs, rungs + comments/tags, or a complete project (e.g. from the editor). */
export type MissionProgramInput =
  | RungsInput
  | Project
  | { rungs: RungsInput; comments?: ReadonlyArray<string | undefined>; tags?: TagDef[] };

export interface RunMissionOptions {
  /** Hints revealed so far (3 stars need 0). */
  hintsUsed?: number;
  /**
   * Enforce `allowedInstructions` / `requiredInstructions` as verification errors (default true).
   * The wrong-answer suite turns this off to prove the *tests* catch a mistake.
   */
  enforcePalette?: boolean;
}

const lower = (s: string): string => s.toLowerCase();

function mergeTagLists(...lists: ReadonlyArray<ReadonlyArray<TagDef> | undefined>): TagDef[] {
  const out: TagDef[] = [];
  for (const list of lists) {
    for (const t of list ?? []) {
      const i = out.findIndex((x) => lower(x.name) === lower(t.name));
      if (i >= 0) out[i] = t;
      else out.push(t);
    }
  }
  return out;
}

/** Scene logic of a mission (throws for an unknown scene id — an authoring error). */
export function missionScene(mission: MissionDef): SceneLogic<unknown> {
  const scene = SCENE_LOGICS[mission.sceneId] as SceneLogic<unknown> | undefined;
  if (!scene) throw new Error(`Mission ${mission.id}: unknown scene '${mission.sceneId}'`);
  return scene;
}

/** Tags every project of this mission gets: the mission's starter tags, then its solution tags. */
export function missionTags(mission: MissionDef): TagDef[] {
  return mergeTagLists(mission.starter.tags, mission.solution.tags);
}

/**
 * Project for a mission: the scene's hardware, I/O alias tags and extra tags, the mission's starter and
 * solution tags (so the names used in the briefing always exist), then `tags` (player-created tags,
 * same names replace), MainTask > MainProgram > MainRoutine with `rungs`.
 * Throws NeutralTextError for unparsable neutral text.
 */
export function buildMissionProject(
  mission: MissionDef,
  rungs: RungsInput,
  comments?: ReadonlyArray<string | undefined>,
  tags?: TagDef[],
): Project {
  const opts: { comments?: ReadonlyArray<string | undefined>; tags: TagDef[] } = {
    tags: mergeTagLists(missionTags(mission), tags),
  };
  if (comments) opts.comments = comments;
  return createProjectForScene(missionScene(mission), rungs, opts);
}

/**
 * The program a mission opens with: the player's saved program when there is one, else the starter.
 * `tags` are the player's own tags (mission starter/solution tags are added by buildMissionProject).
 */
export function missionStartProgram(
  mission: MissionDef,
  progress?: Pick<MissionProgress, 'savedRungs' | 'savedComments' | 'savedTags'>,
): { rungs: string[]; comments: (string | undefined)[]; tags: TagDef[]; fromSave: boolean } {
  if (progress?.savedRungs && progress.savedRungs.length > 0) {
    return {
      rungs: [...progress.savedRungs],
      comments: [...(progress.savedComments ?? [])],
      tags: structuredClone(progress.savedTags ?? []),
      fromSave: true,
    };
  }
  const rungs = mission.starter.rungs.length > 0 ? [...mission.starter.rungs] : [''];
  return { rungs, comments: [...(mission.starter.comments ?? [])], tags: [], fromSave: false };
}

/** Project of the mission's starter program (with the starter's rung comments). */
export function starterProject(mission: MissionDef): Project {
  return buildMissionProject(mission, mission.starter.rungs, mission.starter.comments);
}

/** Project of the mission's reference solution. */
export function solutionProject(mission: MissionDef): Project {
  return buildMissionProject(mission, mission.solution.rungs);
}

function isProject(x: MissionProgramInput): x is Project {
  return !Array.isArray(x) && typeof x === 'object' && x !== null && 'programs' in x && 'hardware' in x;
}

/** Parse errors of neutral-text rungs, formatted like verification errors. */
function parseErrors(rungs: RungsInput): string[] {
  const errors: string[] = [];
  (rungs as ReadonlyArray<string | Rung>).forEach((r, i) => {
    if (typeof r !== 'string') return;
    try {
      parseRung(r);
    } catch (e) {
      errors.push(`Error: ${MAIN_PROGRAM} - ${MAIN_ROUTINE}, Rung ${i}, ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return errors;
}

/** Resolve any program input to a project, or report parse errors. */
export function resolveMissionProgram(
  mission: MissionDef,
  input: MissionProgramInput,
): { project: Project; errors: [] } | { project: undefined; errors: string[] } {
  if (isProject(input)) return { project: input, errors: [] };
  const spec = Array.isArray(input)
    ? { rungs: input as RungsInput }
    : (input as { rungs: RungsInput; comments?: ReadonlyArray<string | undefined>; tags?: TagDef[] });
  const errors = parseErrors(spec.rungs);
  if (errors.length > 0) return { project: undefined, errors };
  try {
    return { project: buildMissionProject(mission, spec.rungs, spec.comments, spec.tags), errors: [] };
  } catch (e) {
    return { project: undefined, errors: [`Error: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

// ---------------------------------------------------------------------------
// Static checks: verification, palette, instruction count
// ---------------------------------------------------------------------------

/** The rungs of MainProgram › MainRoutine (or the first program's main routine). */
function mainRoutineRungs(project: Project): Rung[] {
  const prog =
    project.programs.find((p) => lower(p.name) === lower(MAIN_PROGRAM)) ?? project.programs[0];
  if (!prog) return [];
  const routine = prog.routines.find((r) => lower(r.name) === lower(prog.mainRoutine)) ?? prog.routines[0];
  return routine?.rungs ?? [];
}

/** Number of instructions in MainRoutine (branches are not instructions). */
export function countInstructions(project: Project): number {
  let n = 0;
  for (const rung of mainRoutineRungs(project)) n += instructionsOf(rung.elements).length;
  return n;
}

/** Mnemonics used anywhere in the project, with their operands and location. */
function usedInstructions(
  project: Project,
): Array<{ op: string; operands: readonly string[]; program: string; routine: string; rung: number }> {
  const out: Array<{ op: string; operands: readonly string[]; program: string; routine: string; rung: number }> = [];
  for (const p of project.programs) {
    for (const r of p.routines) {
      r.rungs.forEach((rung, i) => {
        for (const ins of instructionsOf(rung.elements)) {
          out.push({ op: ins.op.toUpperCase(), operands: ins.operands, program: p.name, routine: r.name, rung: i });
        }
      });
    }
  }
  return out;
}

/**
 * Canonical form of operands for comparisons: case-insensitive, whitespace-free, controller-scoped alias
 * tags followed to their base (`Motor_Starter` and `Local:2:O.Data.0` compare equal).
 */
function operandCanonicalizer(project: Project): (operand: string) => string {
  const aliases = new Map<string, string>();
  for (const t of project.tags) if (t.aliasFor) aliases.set(lower(t.name), t.aliasFor);
  return (operand) => {
    let cur = operand.replace(/\s+/g, '');
    for (let depth = 0; depth < 8; depth++) {
      const m = /^([^.[]+)(.*)$/.exec(cur);
      const target = m ? aliases.get(lower(m[1]!)) : undefined;
      if (!m || target === undefined) break;
      cur = target.replace(/\s+/g, '') + m[2]!;
    }
    return lower(cur);
  };
}

/** `'OTL'` or `'OTL(Motor_Starter)'` -> mnemonic + optional operand. */
function parseRequirement(req: string): { op: string; operand?: string } {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*([^()]*?)\s*\))?\s*$/.exec(req);
  if (!m) return { op: req.trim().toUpperCase() };
  return m[2] ? { op: m[1]!.toUpperCase(), operand: m[2] } : { op: m[1]!.toUpperCase() };
}

/** Mission palette rules as verification-style error messages. */
export function paletteErrors(mission: MissionDef, project: Project): string[] {
  const errors: string[] = [];
  const used = usedInstructions(project);
  if (mission.allowedInstructions) {
    const allowed = new Set(mission.allowedInstructions.map((m) => m.toUpperCase()));
    const reported = new Set<string>();
    for (const u of used) {
      if (allowed.has(u.op) || reported.has(u.op)) continue;
      reported.add(u.op);
      errors.push(
        `Error: ${u.program} - ${u.routine}, Rung ${u.rung}, ${u.op}: ${u.op} is not available in this mission ` +
          `(allowed: ${[...allowed].join(', ')}).`,
      );
    }
  }
  for (const req of mission.requiredInstructions ?? []) {
    const { op, operand } = parseRequirement(req);
    if (operand === undefined) {
      if (!used.some((u) => u.op === op)) errors.push(`Error: This mission requires the ${op} instruction — use it in your program.`);
      continue;
    }
    const canonical = operandCanonicalizer(project);
    const want = canonical(operand);
    if (!used.some((u) => u.op === op && u.operands.some((o) => canonical(o) === want))) {
      errors.push(`Error: This mission requires the ${op} instruction on ${operand} — use ${op}(${operand}) in your program.`);
    }
  }
  return errors;
}

export interface ProgramCheck {
  verifyErrors: string[];
  /** Verification warnings (shown, but Run is allowed). */
  warnings: string[];
  instructionCount: number;
}

/** Verify a mission program (controller verification + mission palette rules) and count its instructions. */
export function checkMissionProgram(mission: MissionDef, project: Project, opts: RunMissionOptions = {}): ProgramCheck {
  let errs: VerifyError[];
  try {
    errs = createController(project).verify();
  } catch (e) {
    errs = [{ program: '', routine: '', rungIndex: -1, message: e instanceof Error ? e.message : String(e), severity: 'error' }];
  }
  const verifyErrors = errs.filter((e) => e.severity === 'error').map(formatVerifyError);
  const warnings = errs.filter((e) => e.severity === 'warning').map(formatVerifyError);
  if (opts.enforcePalette !== false) verifyErrors.push(...paletteErrors(mission, project));
  return { verifyErrors, warnings, instructionCount: countInstructions(project) };
}

// ---------------------------------------------------------------------------
// Probing values & conditions
// ---------------------------------------------------------------------------

type Probe = { value: boolean | number; label: string } | { error: string };

interface Condition {
  equals?: boolean | number;
  min?: number;
  max?: number;
}

const toNum = (v: boolean | number): number => (typeof v === 'boolean' ? (v ? 1 : 0) : v);
const toBool = (v: boolean | number): boolean => (typeof v === 'boolean' ? v : v !== 0);

function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
}

/** True when the value satisfies every given bound (equals / min / max). */
export function conditionHolds(value: boolean | number, c: Condition): boolean {
  if (c.equals !== undefined) {
    if (typeof c.equals === 'boolean') {
      if (toBool(value) !== c.equals) return false;
    } else if (!approxEqual(toNum(value), c.equals)) return false;
  }
  const n = toNum(value);
  if (c.min !== undefined && !(n >= c.min)) return false;
  if (c.max !== undefined && !(n <= c.max)) return false;
  return true;
}

function hasCondition(c: Condition): boolean {
  return c.equals !== undefined || c.min !== undefined || c.max !== undefined;
}

function fmtValue(v: boolean | number): string {
  if (typeof v === 'boolean') return v ? 'ON (1)' : 'OFF (0)';
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
}

function fmtCondition(c: Condition): string {
  const parts: string[] = [];
  if (c.equals !== undefined) parts.push(typeof c.equals === 'boolean' ? (c.equals ? 'ON' : 'OFF') : `= ${c.equals}`);
  if (c.min !== undefined && c.max !== undefined) parts.push(`between ${c.min} and ${c.max}`);
  else if (c.min !== undefined) parts.push(`>= ${c.min}`);
  else if (c.max !== undefined) parts.push(`<= ${c.max}`);
  return parts.join(' and ');
}

function fmtTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

// ---------------------------------------------------------------------------
// Test runner (step-wise, so the UI can also "watch" a test in real time)
// ---------------------------------------------------------------------------

export interface MissionTestRunner {
  readonly mission: MissionDef;
  readonly test: MissionTest;
  readonly controller: LogixController;
  readonly runtime: SimRuntimeEx;
  /** Index of the step being executed (steps.length when finished). */
  readonly stepIndex: number;
  readonly done: boolean;
  /** Result so far (final once `done`). */
  readonly result: TestResult;
  /** Simulate up to `ms` more (e.g. real frame time × speed, for a watched run); returns `done`. */
  advance(ms: number): boolean;
  /** Run to completion and return the result. */
  finish(): TestResult;
  /** Stop forwarding runtime notifications. */
  dispose(): void;
}

interface InvariantTrack {
  inv: MissionInvariant;
  violatingSteps: number;
}

class TestRunnerImpl implements MissionTestRunner {
  readonly controller: LogixController;
  readonly runtime: SimRuntimeEx;
  private readonly scene: SceneLogic<unknown>;
  private readonly invariants: InvariantTrack[];
  private readonly steps: TestStepResult[] = [];
  private failure: { message: string; timeMs: number } | undefined;
  private idx = 0;
  private finished = false;
  private readonly gen: Generator<undefined, void, undefined>;
  private obsCache: { version: number; values: Record<string, boolean | number> } | undefined;
  /** Program whose scope is searched first when reading tags (then controller scope). */
  private readonly program: string;

  constructor(
    readonly mission: MissionDef,
    readonly test: MissionTest,
    project: Project,
  ) {
    this.scene = missionScene(mission);
    this.program = (project.programs.find((p) => lower(p.name) === lower(MAIN_PROGRAM)) ?? project.programs[0])?.name ?? MAIN_PROGRAM;
    this.controller = createController(project);
    this.runtime = createSimRuntime(this.controller, this.scene, { notifyIntervalMs: 0 });
    this.invariants = (mission.invariants ?? []).map((inv) => ({ inv, violatingSteps: 0 }));
    this.gen = this.execute();
  }

  get stepIndex(): number {
    return this.idx;
  }

  get done(): boolean {
    return this.finished;
  }

  get result(): TestResult {
    const r: TestResult = { name: this.test.name, passed: this.finished && !this.failure, steps: [...this.steps] };
    if (this.failure) {
      r.failure = this.failure.message;
      r.failedAtMs = this.failure.timeMs;
    }
    return r;
  }

  advance(ms: number): boolean {
    let n = Math.max(0, Math.round(ms / VALIDATION_STEP_MS));
    while (!this.finished && n > 0) {
      const before = this.runtime.timeMs;
      this.pump();
      if (this.runtime.timeMs > before) n--;
    }
    return this.finished;
  }

  finish(): TestResult {
    while (!this.finished) this.pump();
    return this.result;
  }

  dispose(): void {
    this.runtime.dispose();
  }

  /** Resume the step generator until its next fixed step (or the end). */
  private pump(): void {
    const r = this.gen.next();
    if (r.done) this.finished = true;
  }

  private get time(): number {
    return this.runtime.timeMs;
  }

  private fail(message: string): void {
    if (!this.failure) this.failure = { message, timeMs: this.time };
  }

  private observe(): Record<string, boolean | number> {
    const v = this.runtime.version;
    if (!this.obsCache || this.obsCache.version !== v) this.obsCache = { version: v, values: this.runtime.observe() };
    return this.obsCache.values;
  }

  private probe(src: { observe?: string; tag?: string; control?: string }): Probe {
    if (src.observe !== undefined) {
      const values = this.observe();
      if (!(src.observe in values)) return { error: `Unknown observable '${src.observe}' in scene '${this.scene.id}'` };
      return { value: values[src.observe]!, label: src.observe };
    }
    if (src.tag !== undefined) {
      const tags = this.controller.tags;
      try {
        const prog = this.program;
        if (!tags.exists(src.tag, prog)) return { error: `Tag '${src.tag}' does not exist in your project` };
        const type = String(tags.typeOf(src.tag, prog) ?? '');
        if (type === 'BOOL') return { value: tags.readBool(src.tag, prog), label: src.tag };
        if (type === 'SINT' || type === 'INT' || type === 'DINT' || type === 'REAL') {
          return { value: tags.readNumber(src.tag, prog), label: src.tag };
        }
        return { error: `Tag '${src.tag}' is a ${type || 'structure'}: test a member such as '${src.tag}.ACC' or '${src.tag}.DN'` };
      } catch (e) {
        return { error: `Tag '${src.tag}': ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    if (src.control !== undefined) {
      if (!this.scene.controls.some((c) => c.id === src.control)) {
        return { error: `Unknown control '${src.control}' in scene '${this.scene.id}'` };
      }
      return { value: this.runtime.getControl(src.control), label: src.control };
    }
    return { error: 'Invalid condition: needs observe, tag or control' };
  }

  /** One fixed step + fault and invariant checks. Returns false when the test failed. */
  private tick(): boolean {
    this.runtime.step(VALIDATION_STEP_MS);
    const st = this.controller.getStatus();
    if (st.mode === 'FAULTED') {
      const f = st.majorFault;
      const where = f?.rungIndex !== undefined && f.rungIndex >= 0 ? ` (${f.routine ?? MAIN_ROUTINE}, rung ${f.rungIndex})` : '';
      this.fail(
        f
          ? `The controller faulted: Major Fault ${faultId(f.type, f.code)} — ${f.message}${where}`
          : 'The controller faulted (major fault).',
      );
      return false;
    }
    for (const track of this.invariants) {
      const inv = track.inv;
      if (inv.when) {
        const w = this.probe(inv.when);
        if ('error' in w) {
          this.fail(`Invalid invariant condition: ${w.error}`);
          return false;
        }
        if (!conditionHolds(w.value, inv.when)) {
          track.violatingSteps = 0;
          continue;
        }
      }
      const p = this.probe(inv);
      if ('error' in p) {
        this.fail(`${inv.message} — ${p.error}`);
        return false;
      }
      if (conditionHolds(p.value, inv)) {
        track.violatingSteps = 0;
        continue;
      }
      track.violatingSteps++;
      if (track.violatingSteps * VALIDATION_STEP_MS > (inv.graceMs ?? 0)) {
        this.fail(`${inv.message} — ${p.label} was ${fmtValue(p.value)} at ${fmtTime(this.time)}`);
        return false;
      }
    }
    if (this.time > MAX_TEST_SIM_MS) {
      this.fail(`Test exceeded the maximum simulated time (${MAX_TEST_SIM_MS / 1000} s)`);
      return false;
    }
    return true;
  }

  private stepResult(ok: boolean, message?: string): void {
    const r: TestStepResult = { ok, timeMs: this.time };
    if (message !== undefined) r.message = message;
    this.steps.push(r);
  }

  /** Simulate `ms` (rounded to fixed steps); yields after every fixed step. */
  private *run(ms: number): Generator<undefined, boolean, undefined> {
    const n = Math.max(0, Math.round(ms / VALIDATION_STEP_MS));
    for (let i = 0; i < n; i++) {
      if (!this.tick()) return false;
      yield;
    }
    return true;
  }

  private setControl(id: string, value: boolean | number): string | undefined {
    if (!this.scene.controls.some((c) => c.id === id)) return `Unknown control '${id}' in scene '${this.scene.id}'`;
    try {
      this.runtime.setControl(id, value);
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  private *execute(): Generator<undefined, void, undefined> {
    if (!this.controller.requestMode('RUN')) {
      const errs = this.controller.verify().filter((e) => e.severity === 'error').map(formatVerifyError);
      this.fail(`The controller refused to go to Run mode${errs.length ? `: ${errs[0]}` : ''}`);
      return;
    }
    const steps = this.test.steps;
    for (this.idx = 0; this.idx < steps.length; this.idx++) {
      const ok = yield* this.executeStep(steps[this.idx]!);
      if (!ok) {
        this.stepResult(false, this.failure?.message);
        return;
      }
      this.stepResult(true);
    }
  }

  private *executeStep(step: TestStep): Generator<undefined, boolean, undefined> {
    switch (step.do) {
      case 'wait':
        return yield* this.run(step.ms);
      case 'control': {
        const err = this.setControl(step.id, step.value);
        if (err) {
          this.fail(err);
          return false;
        }
        return true;
      }
      case 'tap': {
        const err = this.setControl(step.id, true);
        if (err) {
          this.fail(err);
          return false;
        }
        const ok = yield* this.run(step.ms ?? DEFAULT_TAP_MS);
        this.setControl(step.id, false);
        return ok;
      }
      case 'mode': {
        if (step.mode === 'PROG') {
          this.controller.requestMode('PROG');
          return true;
        }
        if (!this.controller.requestMode('RUN')) {
          this.fail('The controller refused to return to Run mode');
          return false;
        }
        // Prescan + first scan happen at the transition, before the field sees the output image (as on a
        // real controller, where outputs leave their Program-mode state only after the first scan).
        // Works around readOutputForField() exposing the stale output image between the mode change and
        // the first scan (reported engine issue); harmless once that is fixed.
        this.controller.scan(0);
        return true;
      }
      case 'expect':
        return yield* this.expect(step);
      default: {
        const unknown = step as { do?: unknown };
        this.fail(`Invalid test step '${String(unknown.do)}'`);
        return false;
      }
    }
  }

  private *expect(step: Extract<TestStep, { do: 'expect' }>): Generator<undefined, boolean, undefined> {
    if (!hasCondition(step)) {
      this.fail(`Invalid test step (needs equals, min or max): ${step.message}`);
      return false;
    }
    const expected = fmtCondition(step);
    const t0 = this.time;
    // Phase 1: wait (up to `within`) for the condition.
    for (;;) {
      const p = this.probe(step);
      if ('error' in p) {
        this.fail(`${step.message} — ${p.error}`);
        return false;
      }
      if (conditionHolds(p.value, step)) break;
      const waited = this.time - t0;
      if (step.within === undefined || waited >= step.within) {
        this.fail(
          `${step.message} — expected ${p.label} ${expected}, but it was ${fmtValue(p.value)}` +
            (step.within !== undefined ? ` for the whole ${step.within} ms` : ''),
        );
        return false;
      }
      if (!this.tick()) return false;
      yield;
    }
    // Phase 2: hold for `for`.
    if (step.for !== undefined && step.for > 0) {
      const start = this.time;
      const n = Math.max(1, Math.round(step.for / VALIDATION_STEP_MS));
      for (let i = 0; i < n; i++) {
        if (!this.tick()) return false;
        const p = this.probe(step);
        if ('error' in p) {
          this.fail(`${step.message} — ${p.error}`);
          return false;
        }
        if (!conditionHolds(p.value, step)) {
          this.fail(
            `${step.message} — ${p.label} should stay ${expected} for ${step.for} ms, ` +
              `but became ${fmtValue(p.value)} after ${this.time - start} ms`,
          );
          return false;
        }
        yield;
      }
    }
    return true;
  }
}

/**
 * Step-wise runner of one mission test on a fresh controller + plant (does not check the palette).
 * Use `finish()` for headless validation, or `advance(ms)` from an animation loop to watch it run.
 */
export function createMissionTestRunner(mission: MissionDef, project: Project, testIndex: number): MissionTestRunner {
  const test = mission.tests[testIndex];
  if (!test) throw new Error(`Mission ${mission.id} has no test #${testIndex}`);
  return new TestRunnerImpl(mission, test, project);
}

function notRun(test: MissionTest, reason: string): TestResult {
  return { name: test.name, passed: false, failure: reason, failedAtMs: 0, steps: [] };
}

const NOT_RUN = 'Not run: fix the verification errors first.';

/**
 * Run one test of a mission (fresh controller + plant). A program with verification errors fails
 * the test without running it. Deterministic.
 */
export function runMissionTest(
  mission: MissionDef,
  program: MissionProgramInput,
  testIndex: number,
  opts: RunMissionOptions = {},
): TestResult {
  const test = mission.tests[testIndex];
  if (!test) throw new Error(`Mission ${mission.id} has no test #${testIndex}`);
  const resolved = resolveMissionProgram(mission, program);
  if (!resolved.project) return notRun(test, `${NOT_RUN} ${resolved.errors[0] ?? ''}`.trim());
  const check = checkMissionProgram(mission, resolved.project, opts);
  if (check.verifyErrors.length > 0) return notRun(test, `${NOT_RUN} ${check.verifyErrors[0]}`);
  const runner = createMissionTestRunner(mission, resolved.project, testIndex);
  try {
    return runner.finish();
  } finally {
    runner.dispose();
  }
}

// ---------------------------------------------------------------------------
// Stars & whole-mission runs
// ---------------------------------------------------------------------------

export interface StarCriteria {
  /** 1st star: every test passes. */
  passed: boolean;
  /** 2nd star: at or under par (always true when the mission has no par). */
  underPar: boolean;
  /** 3rd star: no hints used. */
  noHints: boolean;
}

/** Star rating: 1 = all tests pass; 2 = and instructionCount <= par (or no par); 3 = and no hints. */
export function computeStars(mission: MissionDef, passed: boolean, instructionCount: number, hintsUsed = 0): 0 | 1 | 2 | 3 {
  if (!passed) return 0;
  if (mission.parInstructions !== undefined && instructionCount > mission.parInstructions) return 1;
  return hintsUsed > 0 ? 2 : 3;
}

/** Which star criteria a result meets (for the results panel). */
export function starCriteria(mission: MissionDef, result: Pick<MissionRunResult, 'passed' | 'instructionCount'>, hintsUsed = 0): StarCriteria {
  return {
    passed: result.passed,
    underPar: mission.parInstructions === undefined || result.instructionCount <= mission.parInstructions,
    noHints: hintsUsed === 0,
  };
}

/** Assemble a MissionRunResult from individual test results (e.g. after running them one by one). */
export function scoreMission(
  mission: MissionDef,
  parts: { tests: TestResult[]; verifyErrors: string[]; instructionCount: number },
  hintsUsed = 0,
): MissionRunResult {
  const passed =
    parts.verifyErrors.length === 0 &&
    mission.tests.length > 0 &&
    parts.tests.length === mission.tests.length &&
    parts.tests.every((t) => t.passed);
  return {
    missionId: mission.id,
    passed,
    tests: parts.tests,
    verifyErrors: parts.verifyErrors,
    instructionCount: parts.instructionCount,
    stars: computeStars(mission, passed, parts.instructionCount, hintsUsed),
  };
}

/**
 * Run every acceptance test of a mission against a program and rate it.
 * Verification errors (including palette rules) mean no test runs and 0 stars.
 */
export function runMission(mission: MissionDef, program: MissionProgramInput, opts: RunMissionOptions = {}): MissionRunResult {
  const hints = opts.hintsUsed ?? 0;
  const resolved = resolveMissionProgram(mission, program);
  if (!resolved.project) {
    return scoreMission(
      mission,
      { tests: mission.tests.map((t) => notRun(t, NOT_RUN)), verifyErrors: resolved.errors, instructionCount: 0 },
      hints,
    );
  }
  const project = resolved.project;
  const check = checkMissionProgram(mission, project, opts);
  if (check.verifyErrors.length > 0) {
    return scoreMission(
      mission,
      { tests: mission.tests.map((t) => notRun(t, NOT_RUN)), verifyErrors: check.verifyErrors, instructionCount: check.instructionCount },
      hints,
    );
  }
  const tests = mission.tests.map((_, i) => {
    const runner = createMissionTestRunner(mission, project, i);
    try {
      return runner.finish();
    } finally {
      runner.dispose();
    }
  });
  return scoreMission(mission, { tests, verifyErrors: [], instructionCount: check.instructionCount }, hints);
}

// ---------------------------------------------------------------------------
// Authoring lint
// ---------------------------------------------------------------------------

/** Upper bound of the simulated duration of a test (waits, taps, within + for). */
export function maxTestDurationMs(test: MissionTest): number {
  let ms = 0;
  for (const s of test.steps) {
    if (s.do === 'wait') ms += s.ms;
    else if (s.do === 'tap') ms += s.ms ?? DEFAULT_TAP_MS;
    else if (s.do === 'expect') ms += (s.within ?? 0) + (s.for ?? 0);
  }
  return ms;
}

/**
 * Static problems of a mission definition (unknown scene / controls / observables / tags, malformed
 * steps). Tags are checked against the mission's solution project. Empty = OK.
 */
export function lintMission(mission: MissionDef): string[] {
  const problems: string[] = [];
  const scene = SCENE_LOGICS[mission.sceneId] as SceneLogic<unknown> | undefined;
  if (!scene) return [`unknown scene '${mission.sceneId}'`];
  const controls = new Map(scene.controls.map((c) => [c.id, c] as const));
  const observables = new Set(Object.keys(scene.observe(scene.createState())));
  for (const o of scene.observables) observables.add(o.id);
  let tagDb: LogixController['tags'] | undefined;
  try {
    tagDb = createController(solutionProject(mission)).tags;
  } catch (e) {
    problems.push(`solution project cannot be built: ${e instanceof Error ? e.message : String(e)}`);
  }
  const checkRef = (where: string, src: { observe?: string; tag?: string; control?: string }): void => {
    const n = Number(src.observe !== undefined) + Number(src.tag !== undefined) + Number(src.control !== undefined);
    if (n !== 1) problems.push(`${where}: needs exactly one value source (observe, tag or control)`);
    if (src.observe !== undefined && !observables.has(src.observe)) problems.push(`${where}: unknown observable '${src.observe}'`);
    if (src.control !== undefined && !controls.has(src.control)) problems.push(`${where}: unknown control '${src.control}'`);
    if (src.tag !== undefined && tagDb && !tagDb.exists(src.tag, MAIN_PROGRAM)) problems.push(`${where}: unknown tag '${src.tag}'`);
  };
  const checkCond = (where: string, c: Condition): void => {
    if (!hasCondition(c)) problems.push(`${where}: needs equals, min or max`);
  };
  mission.tests.forEach((t, ti) => {
    if (t.steps.length === 0) problems.push(`test '${t.name}': no steps`);
    if (!t.steps.some((s) => s.do === 'expect')) problems.push(`test '${t.name}': no expect step`);
    t.steps.forEach((s, si) => {
      const where = `test ${ti} '${t.name}' step ${si}`;
      switch (s.do) {
        case 'wait':
          if (!(s.ms > 0)) problems.push(`${where}: wait needs ms > 0`);
          break;
        case 'tap':
        case 'control': {
          const def = controls.get(s.id);
          if (!def) {
            problems.push(`${where}: unknown control '${s.id}'`);
            break;
          }
          if (s.do === 'tap' && s.ms !== undefined && !(s.ms > 0)) problems.push(`${where}: tap needs ms > 0`);
          if (s.do === 'control') {
            if (def.type === 'selector') {
              const max = (def.positions?.length ?? 1) - 1;
              if (typeof s.value !== 'number' || !Number.isInteger(s.value) || s.value < 0 || s.value > max) {
                problems.push(`${where}: selector '${s.id}' needs a position index 0..${max}`);
              }
            } else if (def.type === 'analog') {
              if (typeof s.value !== 'number') problems.push(`${where}: analog control '${s.id}' needs a number`);
            } else if (typeof s.value !== 'boolean') problems.push(`${where}: control '${s.id}' needs true/false`);
          }
          break;
        }
        case 'mode':
          if (s.mode !== 'PROG' && s.mode !== 'RUN') problems.push(`${where}: mode must be PROG or RUN`);
          break;
        case 'expect':
          checkRef(where, s);
          checkCond(where, s);
          if (!s.message) problems.push(`${where}: expect needs a message`);
          if (s.within !== undefined && !(s.within >= 0)) problems.push(`${where}: within must be >= 0`);
          if (s.for !== undefined && !(s.for > 0)) problems.push(`${where}: for must be > 0`);
          break;
        default:
          problems.push(`${where}: unknown step '${String((s as { do?: unknown }).do)}'`);
      }
    });
  });
  (mission.invariants ?? []).forEach((inv, i) => {
    const where = `invariant ${i} '${inv.message}'`;
    checkRef(where, { ...(inv.observe !== undefined ? { observe: inv.observe } : {}), ...(inv.tag !== undefined ? { tag: inv.tag } : {}) });
    checkCond(where, inv);
    if (inv.when) {
      checkRef(`${where} when`, inv.when);
      checkCond(`${where} when`, inv.when);
    }
    if (inv.graceMs !== undefined && !(inv.graceMs >= 0)) problems.push(`${where}: graceMs must be >= 0`);
  });
  return problems;
}

/** Condition helper exported for UIs that evaluate objectives live. */
export type { MissionCondition };
