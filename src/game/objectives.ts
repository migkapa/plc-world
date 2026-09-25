/**
 * Mission objective checklist from test results (headless): which objectives the latest "Verify & Test" run
 * proved, broke or could not judge, using the mission's explicit `objectiveTests` map.
 */
import type { MissionDef, MissionTest, ObjectiveProof, TestResult } from './types';

export type ObjectiveState = 'pending' | 'passed' | 'failed';

type Verdict = 'ok' | 'broken' | 'unknown';
type Failure = { kind: 'check' | 'invariant' | 'other'; step: number; invariant: number };

type MissionLike = Pick<MissionDef, 'objectives' | 'tests' | 'objectiveTests' | 'invariants'>;

/** Why a failed test failed: an expect step (`check`), an invariant, or anything else (fault, Run refused…). */
export function classifyFailure(m: Pick<MissionDef, 'invariants'>, test: MissionTest | undefined, r: TestResult): Failure {
  const step = r.steps.length - 1;
  const invariant = (m.invariants ?? []).findIndex((inv) => r.failure !== undefined && r.failure.startsWith(`${inv.message} — `));
  if (invariant >= 0) return { kind: 'invariant', step, invariant };
  const s = step >= 0 ? test?.steps[step] : undefined;
  if (s?.do === 'expect' && r.failure !== undefined && r.failure.startsWith(s.message)) return { kind: 'check', step, invariant: -1 };
  return { kind: 'other', step, invariant: -1 };
}

/** Step indices a test proof covers (undefined = the whole test): its expect steps matching every given filter. */
export function proofSteps(m: Pick<MissionDef, 'tests'>, p: Exclude<ObjectiveProof, { invariant: number }>): number[] | undefined {
  if (typeof p === 'number') return undefined;
  if (p.steps === undefined && p.from === undefined && p.to === undefined && p.observe === undefined) return undefined;
  const ids = p.observe ? new Set(p.observe) : undefined;
  const out: number[] = [];
  m.tests[p.test]?.steps.forEach((s, i) => {
    if (s.do !== 'expect') return;
    if (p.steps && !p.steps.includes(i)) return;
    if (p.from !== undefined && i < p.from) return;
    if (p.to !== undefined && i > p.to) return;
    if (ids && !((s.observe !== undefined && ids.has(s.observe)) || (s.tag !== undefined && ids.has(s.tag)))) return;
    out.push(i);
  });
  return out;
}

function verdict(m: MissionLike, p: ObjectiveProof, results: ReadonlyArray<TestResult>): Verdict {
  if (typeof p === 'object' && 'invariant' in p) {
    const tripped = results.some((r, i) => !r.passed && classifyFailure(m, m.tests[i], r).invariant === p.invariant);
    if (tripped) return 'broken';
    return results.every((r) => r.passed) ? 'ok' : 'unknown';
  }
  const t = typeof p === 'number' ? p : p.test;
  const r = results[t];
  if (!r) return 'unknown';
  if (r.passed) return 'ok';
  const f = classifyFailure(m, m.tests[t], r);
  const steps = proofSteps(m, p);
  if (steps !== undefined && steps.length > 0 && f.step > Math.max(...steps)) return 'ok'; // every step of this proof ran and passed
  if (f.kind === 'other') return 'broken'; // controller fault, Run refused…: nothing after it was checked
  if (steps === undefined) return f.kind === 'check' ? 'broken' : 'unknown'; // an invariant trip is charged to its own objective
  return f.kind === 'check' && steps.includes(f.step) ? 'broken' : 'unknown';
}

/**
 * Objective states from the latest test results. With `objectiveTests`, each objective follows its own proofs;
 * without it, every objective is ticked when all tests passed and left open otherwise (never a positional guess).
 * Before any run, objectives are open — or all ticked for a completed mission.
 */
export function objectiveStates(mission: MissionLike, results: ReadonlyArray<TestResult | undefined>, completed: boolean): ObjectiveState[] {
  const n = mission.objectives.length;
  const ran = results.length > 0 && results.length === mission.tests.length && results.every((r) => r !== undefined);
  if (!ran) return new Array<ObjectiveState>(n).fill(completed ? 'passed' : 'pending');
  const rs = results as ReadonlyArray<TestResult>;
  const map = mission.objectiveTests;
  if (!map || map.length !== n) {
    const all = rs.every((r) => r.passed);
    return new Array<ObjectiveState>(n).fill(all ? 'passed' : 'pending');
  }
  return map.map((proofs) => {
    if (proofs.length === 0) return rs.every((r) => r.passed) ? 'passed' : 'pending';
    const v = proofs.map((p) => verdict(mission, p, rs));
    if (v.includes('broken')) return 'failed';
    return v.every((x) => x === 'ok') ? 'passed' : 'pending';
  });
}

/**
 * Authoring checks for `objectiveTests` (enforced for every mission by missions.test.ts): one proof list per
 * objective, valid test / step / invariant references, every expect step of every test and every invariant
 * proves at least one objective (so a failing check always crosses an objective).
 */
export function lintObjectives(m: MissionLike & Pick<MissionDef, 'id'>): string[] {
  const errs: string[] = [];
  const map = m.objectiveTests;
  if (!map) return [`${m.id}: no objectiveTests map`];
  if (map.length !== m.objectives.length) errs.push(`${m.id}: objectiveTests has ${map.length} entries for ${m.objectives.length} objectives`);
  const covered = m.tests.map(() => new Set<number>());
  const invs = new Set<number>();
  map.forEach((proofs, oi) => {
    for (const p of proofs) {
      if (typeof p === 'object' && 'invariant' in p) {
        if (!m.invariants?.[p.invariant]) errs.push(`${m.id} objective ${oi}: no invariant ${p.invariant}`);
        invs.add(p.invariant);
        continue;
      }
      const t = typeof p === 'number' ? p : p.test;
      const test = m.tests[t];
      if (!test) {
        errs.push(`${m.id} objective ${oi}: no test ${t}`);
        continue;
      }
      if (typeof p === 'object') {
        for (const i of p.steps ?? []) if (test.steps[i]?.do !== 'expect') errs.push(`${m.id} objective ${oi}: step ${i} of test ${t} is not an expect step`);
      }
      const steps = proofSteps(m, p);
      if (steps !== undefined && steps.length === 0) errs.push(`${m.id} objective ${oi}: the proof on test ${t} selects no expect step`);
      test.steps.forEach((s, i) => {
        if (s.do === 'expect' && (steps === undefined || steps.includes(i))) covered[t]!.add(i);
      });
    }
  });
  m.tests.forEach((test, t) =>
    test.steps.forEach((s, i) => {
      if (s.do === 'expect' && !covered[t]!.has(i)) errs.push(`${m.id}: step ${i} of test ${t} ('${test.name}') proves no objective`);
    }),
  );
  (m.invariants ?? []).forEach((inv, i) => {
    if (!invs.has(i) && !map.some((ps) => ps.length === 0)) errs.push(`${m.id}: invariant ${i} ('${inv.message}') proves no objective`);
  });
  return errs;
}
