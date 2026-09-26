/**
 * Generic suite over ALL missions (every chapter file): content authors get these checks for free.
 *
 * - catalogue: unique ids '<chapter order>-<order>', known chapter & scene, orders contiguous, one boss last
 * - content: briefing, objectives, >= 3 hints, debrief, sane xp/difficulty, palette covers the solution
 * - lint: every control / observable / tag referenced by tests & invariants exists; steps well formed
 * - the reference solution verifies, passes ALL tests (deterministically) and meets par (>= 2 stars)
 * - the starter program fails (verification error or at least one failing test)
 * - wrong answers (src/game/missions/chN.wrong.ts): each verifies and FAILS at least one test
 * - alternative correct answers (exports named *RIGHT in the same files): each PASSES every test
 * - objectives: an explicit objective → test map (objectiveTests); the solution ticks every objective and
 *   every wrong answer crosses at least one (the checklist never shows all ticks on a failing program)
 *
 * Run one mission: npx vitest run src/game/missions.test.ts -t "2-3"
 */
import { describe, expect, it } from 'vitest';
import { CHAPTERS, getChapter } from './chapters';
import { MISSIONS, getMission, missionsByChapter, nextMission } from './missions';
import { normalizeWrongAnswer, type WrongAnswerSet } from './missions/authoring';
import { lintObjectives, objectiveStates } from './objectives';
import type { MissionDef, MissionRunResult } from './types';
import { SCENE_LOGICS } from '../sim/scenes';
import {
  checkMissionProgram,
  lintMission,
  maxTestDurationMs,
  runMission,
  solutionProject,
  starterProject,
} from './validation';

/**
 * src/game/missions/*.wrong.ts: every exported WrongAnswerSet whose name ends in `RIGHT` holds alternative
 * CORRECT programs (must pass); every other exported set holds WRONG programs (must fail).
 */
const answerModules = import.meta.glob<Record<string, unknown>>('./missions/*.wrong.ts', { eager: true });
type Answer = { file: string; entry: ReturnType<typeof normalizeWrongAnswer> };
const WRONG: Record<string, Answer[]> = {};
const RIGHT: Record<string, Answer[]> = {};
for (const [file, mod] of Object.entries(answerModules)) {
  for (const [exportName, value] of Object.entries(mod)) {
    if (!value || typeof value !== 'object') continue;
    const target = /RIGHT$/i.test(exportName) ? RIGHT : WRONG;
    for (const [id, list] of Object.entries(value as WrongAnswerSet)) {
      if (!Array.isArray(list)) continue;
      for (const w of list) (target[id] ??= []).push({ file, entry: normalizeWrongAnswer(w) });
    }
  }
}

function describeFailures(r: MissionRunResult): string {
  if (r.verifyErrors.length) return r.verifyErrors.join('\n');
  return r.tests
    .filter((t) => !t.passed)
    .map((t) => `✗ ${t.name}: ${t.failure} (at ${t.failedAtMs} ms)`)
    .join('\n');
}

describe('mission catalogue', () => {
  it('has missions', () => {
    expect(MISSIONS.length).toBeGreaterThan(0);
  });

  it('mission ids are unique and follow <chapter order>-<order>', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MISSIONS) {
      const ch = getChapter(m.chapter);
      expect(ch, `${m.id}: unknown chapter '${m.chapter}'`).toBeDefined();
      expect(m.id, `${m.id}: id must be '${ch?.order}-${m.order}'`).toBe(`${ch?.order}-${m.order}`);
    }
  });

  it('missions are ordered by chapter, orders are contiguous from 1, one boss at the end', () => {
    for (const ch of CHAPTERS) {
      const list = missionsByChapter(ch.id);
      list.forEach((m, i) => expect(m.order, `${m.id} order`).toBe(i + 1));
      const bosses = list.filter((m) => m.kind === 'boss');
      expect(bosses.length, `${ch.id}: at most one boss`).toBeLessThanOrEqual(1);
      if (bosses.length === 1) expect(list[list.length - 1]!.kind, `${ch.id}: the boss is the last mission`).toBe('boss');
    }
    const orders = MISSIONS.map((m) => getChapter(m.chapter)!.order * 1000 + m.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('registry helpers', () => {
    const first = MISSIONS[0]!;
    expect(getMission(first.id)).toBe(first);
    expect(getMission('nope')).toBeUndefined();
    if (MISSIONS.length > 1) expect(nextMission(first.id)).toBe(MISSIONS[1]);
    expect(nextMission(MISSIONS[MISSIONS.length - 1]!.id)).toBeUndefined();
  });

  it('requires only reference existing, earlier missions', () => {
    MISSIONS.forEach((m, i) => {
      for (const r of m.requires ?? []) {
        const j = MISSIONS.findIndex((x) => x.id === r);
        expect(j, `${m.id} requires unknown mission ${r}`).toBeGreaterThanOrEqual(0);
        expect(j, `${m.id} requires a later mission ${r}`).toBeLessThan(i);
      }
    });
  });

  it('wrong/right answer files only reference existing missions', () => {
    for (const id of [...Object.keys(WRONG), ...Object.keys(RIGHT)]) {
      expect(getMission(id), `answers for unknown mission ${id}`).toBeDefined();
    }
  });
});

describe.each(MISSIONS.map((m) => [m.id, m] as [string, MissionDef]))('mission %s', (_id, m) => {
  it('content is complete', () => {
    expect(SCENE_LOGICS[m.sceneId], `unknown scene ${m.sceneId}`).toBeDefined();
    expect(m.title.trim()).not.toBe('');
    expect(m.tagline.trim()).not.toBe('');
    expect(m.briefing.trim().length).toBeGreaterThan(80);
    expect(m.objectives.length).toBeGreaterThan(0);
    for (const o of m.objectives) expect(o.trim()).not.toBe('');
    expect(m.hints.length).toBeGreaterThanOrEqual(3);
    for (const h of m.hints) expect(h.trim()).not.toBe('');
    expect(m.debrief?.trim() ?? '', 'debrief with a real-world tip').not.toBe('');
    expect(m.concepts.length).toBeGreaterThan(0);
    expect(m.tests.length).toBeGreaterThan(0);
    expect(m.xp).toBeGreaterThan(0);
    expect([1, 2, 3, 4, 5]).toContain(m.difficulty);
    const names = m.tests.map((t) => t.name);
    expect(new Set(names).size, 'test names are unique').toBe(names.length);
  });

  it('tests reference existing controls, observables and tags', () => {
    expect(lintMission(m)).toEqual([]);
  });

  it('maps every objective to the tests / invariants that prove it', () => {
    expect(lintObjectives(m)).toEqual([]);
  });

  it('tests stay within a sane simulated duration', () => {
    for (const t of m.tests) expect(maxTestDurationMs(t), `test '${t.name}'`).toBeLessThanOrEqual(240_000);
  });

  it('the solution verifies, respects the palette and meets par', () => {
    const check = checkMissionProgram(m, solutionProject(m));
    expect(check.verifyErrors).toEqual([]);
    if (m.parInstructions !== undefined) expect(check.instructionCount).toBeLessThanOrEqual(m.parInstructions);
  });

  it('the solution passes every test (3 stars without hints) — deterministically', () => {
    const t0 = performance.now();
    const r = runMission(m, solutionProject(m));
    const ms = performance.now() - t0;
    expect(r.passed, describeFailures(r)).toBe(true);
    expect(objectiveStates(m, r.tests, false)).toEqual(m.objectives.map(() => 'passed'));
    expect(r.stars).toBe(3);
    expect(runMission(m, solutionProject(m), { hintsUsed: 1 }).stars).toBe(2);
    const again = runMission(m, m.solution.rungs);
    expect(again.tests.map((t) => t.steps.map((s) => s.timeMs))).toEqual(r.tests.map((t) => t.steps.map((s) => s.timeMs)));
    expect(ms, 'a whole mission should validate quickly').toBeLessThan(5000);
  });

  it('the starter program does not pass', () => {
    const r = runMission(m, starterProject(m));
    expect(r.passed, 'starter must fail at least one test (or not verify)').toBe(false);
  });

  const wrongs = WRONG[m.id] ?? [];
  if (wrongs.length > 0) {
    it.each(wrongs.map((w, i) => [i, w.entry.why ?? w.entry.rungs.join(' '), w] as const))(
      'wrong answer #%i (%s) is rejected by the tests',
      (_i, _why, w) => {
        const r = runMission(m, { rungs: w.entry.rungs, ...(w.entry.tags ? { tags: w.entry.tags } : {}) }, { enforcePalette: false });
        expect(r.verifyErrors, `wrong answer in ${w.file} must verify so the TESTS are what reject it`).toEqual([]);
        expect(r.passed, `wrong answer in ${w.file} passed every test: ${w.entry.rungs.join(' ')}`).toBe(false);
        const states = objectiveStates(m, r.tests, false);
        expect(states, `the objectives checklist must cross at least one objective:\n${describeFailures(r)}`).toContain('failed');
      },
    );
  }

  const rights = RIGHT[m.id] ?? [];
  if (rights.length > 0) {
    it.each(rights.map((w, i) => [i, w.entry.why ?? w.entry.rungs.join(' '), w] as const))(
      'alternative correct answer #%i (%s) passes',
      (_i, _why, w) => {
        const r = runMission(m, { rungs: w.entry.rungs, ...(w.entry.tags ? { tags: w.entry.tags } : {}) });
        expect(r.passed, `alternative in ${w.file} should pass:\n${describeFailures(r)}`).toBe(true);
        expect(objectiveStates(m, r.tests, false)).toEqual(m.objectives.map(() => 'passed'));
      },
    );
  }
});

describe('operand-aware requiredInstructions', () => {
  const LIGHTS = [
    'XIC(Motor_Aux)OTE(Run_Light);',
    'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);',
    '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);',
  ];

  it('2-4: a dummy OTL/OTU on an unrelated output does not satisfy the latch lesson', () => {
    const m = getMission('2-4')!;
    const dummy = [
      '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
      'XIO(Start_PB)XIC(Start_PB)OTL(Horn);',
      'XIC(S:FS)OTU(Horn);',
      ...LIGHTS,
    ];
    const r = runMission(m, dummy);
    expect(r.passed).toBe(false);
    expect(r.verifyErrors.join('\n')).toMatch(/requires the OTL instruction on Motor_Starter/);
    expect(r.verifyErrors.join('\n')).toMatch(/requires the OTU instruction on Motor_Starter/);
    // Behaviourally it is a (correct) seal-in: only the static rule can reject it.
    expect(runMission(m, dummy, { enforcePalette: false }).passed).toBe(true);
  });

  it('2-4: the operand match is case-insensitive and resolves aliases', () => {
    const m = getMission('2-4')!;
    const r = runMission(m, [
      'XIC(Start_PB)OTL(motor_starter);',
      '[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK),XIC(S:FS)]OTU(Local:2:O.Data.0);',
      ...LIGHTS,
    ]);
    expect(r.verifyErrors).toEqual([]);
    expect(r.passed, describeFailures(r)).toBe(true);
  });
});
