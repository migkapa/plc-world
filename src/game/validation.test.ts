/**
 * Unit tests for the headless mission validator: project building, verification & palette rules,
 * step semantics (wait / control / tap / mode / expect within & for), invariants (when, graceMs),
 * controller faults, stars and determinism.
 */
import { describe, expect, it } from 'vitest';
import type { MissionDef, MissionTest, TestStep } from './types';
import { getMission } from './missions';
import {
  buildMissionProject,
  checkMissionProgram,
  computeStars,
  countInstructions,
  createMissionTestRunner,
  lintMission,
  maxTestDurationMs,
  missionStartProgram,
  runMission,
  runMissionTest,
  scoreMission,
  solutionProject,
  starCriteria,
} from './validation';

/** Minimal trainer mission for semantics tests. */
function mission(over: Partial<MissionDef> = {}): MissionDef {
  return {
    id: '9-1',
    chapter: 'power-up',
    order: 1,
    title: 'Test',
    tagline: 'test',
    kind: 'build',
    sceneId: 'trainer',
    difficulty: 1,
    xp: 10,
    briefing: 'test',
    objectives: ['o'],
    concepts: ['XIC'],
    starter: { rungs: [] },
    solution: { rungs: ['XIC(Switch_0)OTE(Light_0);'] },
    hints: ['a', 'b', 'c'],
    tests: [],
    ...over,
  };
}

const oneTest = (steps: TestStep[], extra: Partial<MissionDef> = {}): MissionDef =>
  mission({ tests: [{ name: 't', steps }], ...extra });

const FOLLOW = ['XIC(Switch_0)OTE(Light_0);'];

describe('project building', () => {
  it('includes scene aliases, starter + solution tags and player tags (player wins)', () => {
    const m = mission({
      starter: { rungs: [], tags: [{ name: 'A', dataType: 'BOOL' }, { name: 'T1', dataType: 'TIMER' }] },
      solution: { rungs: [], tags: [{ name: 'B', dataType: 'DINT' }] },
    });
    const p = buildMissionProject(m, FOLLOW, ['my comment'], [{ name: 'B', dataType: 'REAL' }, { name: 'C', dataType: 'BOOL' }]);
    const tag = (n: string) => p.tags.find((t) => t.name === n);
    expect(tag('Switch_0')?.aliasFor).toBe('Local:1:I.Data.0');
    expect(tag('A')?.dataType).toBe('BOOL');
    expect(tag('T1')?.dataType).toBe('TIMER');
    expect(tag('B')?.dataType).toBe('REAL');
    expect(tag('C')).toBeDefined();
    expect(p.programs[0]!.routines[0]!.rungs[0]!.comment).toBe('my comment');
  });

  it('missionStartProgram: saved program first, else the starter', () => {
    const m = mission({ starter: { rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: ['c0'] } });
    expect(missionStartProgram(m)).toEqual({ rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: ['c0'], tags: [], fromSave: false });
    expect(missionStartProgram(mission()).rungs).toEqual(['']);
    const saved = missionStartProgram(m, { savedRungs: ['OTE(Light_1);'], savedTags: [{ name: 'X', dataType: 'BOOL' }] });
    expect(saved).toEqual({ rungs: ['OTE(Light_1);'], comments: [], tags: [{ name: 'X', dataType: 'BOOL' }], fromSave: true });
  });

  it('counts instructions in MainRoutine (branches are not instructions)', () => {
    const p = buildMissionProject(mission(), ['[XIC(Switch_0),XIC(Switch_1)XIO(Switch_2)]OTE(Light_0);', '', 'XIC(Switch_3)[OTE(Light_1),OTE(Light_2)];']);
    expect(countInstructions(p)).toBe(7);
  });
});

describe('verification', () => {
  it('verification errors: no test runs, 0 stars, formatted messages', () => {
    const m = oneTest([{ do: 'expect', observe: 'light0', equals: false, message: 'm' }]);
    const r = runMission(m, ['XIC(Nope)OTE(Light_0);']);
    expect(r.passed).toBe(false);
    expect(r.stars).toBe(0);
    expect(r.verifyErrors.length).toBeGreaterThan(0);
    expect(r.verifyErrors[0]).toMatch(/^Error: MainProgram - MainRoutine, Rung 0/);
    expect(r.tests).toHaveLength(1);
    expect(r.tests[0]!.passed).toBe(false);
    expect(r.tests[0]!.steps).toEqual([]);
    expect(r.tests[0]!.failure).toMatch(/Not run/);
  });

  it('neutral-text parse errors are reported with the rung number', () => {
    const m = oneTest([{ do: 'wait', ms: 10 }]);
    const r = runMission(m, ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_0 OTE(Light_1);']);
    expect(r.passed).toBe(false);
    expect(r.verifyErrors[0]).toMatch(/Rung 1/);
  });

  it('a rung that does not end with an output is a verification error', () => {
    const r = runMission(oneTest([{ do: 'wait', ms: 10 }]), ['XIC(Switch_0);']);
    expect(r.verifyErrors.join('\n')).toMatch(/output instruction/);
  });

  it('palette: disallowed instructions are errors unless enforcePalette is false', () => {
    const m = oneTest([{ do: 'expect', observe: 'light0', equals: false, message: 'm' }], { allowedInstructions: ['XIC', 'XIO', 'OTE'] });
    const r = runMission(m, ['XIC(Switch_0)OTL(Light_0);']);
    expect(r.verifyErrors.join('\n')).toMatch(/OTL is not available in this mission/);
    expect(runMission(m, ['XIC(Switch_0)OTL(Light_0);'], { enforcePalette: false }).passed).toBe(true);
  });

  it('requiredInstructions: the latch lesson rejects a plain seal-in', () => {
    const m = getMission('2-4')!;
    const sealIn = [
      '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
      'XIC(Motor_Aux)OTE(Run_Light);',
      'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);',
      '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);',
    ];
    const r = runMission(m, sealIn);
    expect(r.passed).toBe(false);
    expect(r.verifyErrors.join('\n')).toMatch(/requires the OTL instruction/);
    // ...but behaviourally it is correct (the prescan drops an OTE seal).
    expect(runMission(m, sealIn, { enforcePalette: false }).passed).toBe(true);
  });

  it('checkMissionProgram reports warnings separately (duplicate destructive bit)', () => {
    const c = checkMissionProgram(mission(), buildMissionProject(mission(), ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_1)OTE(Light_0);']));
    expect(c.verifyErrors).toEqual([]);
    expect(c.warnings.join('\n')).toMatch(/[Dd]uplicate/);
  });
});

describe('step semantics', () => {
  it('passes a simple follow test and records one result per step with sim time', () => {
    const m = oneTest([
      { do: 'wait', ms: 100 },
      { do: 'control', id: 'sw0', value: true },
      { do: 'expect', observe: 'light0', equals: true, within: 50, message: 'on' },
      { do: 'tap', id: 'pb_green' },
      { do: 'expect', tag: 'Light_0', equals: true, message: 'tag on' },
    ]);
    const r = runMission(m, FOLLOW);
    expect(r.passed).toBe(true);
    const steps = r.tests[0]!.steps;
    expect(steps).toHaveLength(5);
    expect(steps.every((s) => s.ok)).toBe(true);
    expect(steps[0]!.timeMs).toBe(100);
    expect(steps[2]!.timeMs).toBe(120); // input written at 110, output seen by the field at 120
    expect(steps[3]!.timeMs).toBe(320); // tap defaults to 200 ms
  });

  it('expect without within checks instantly and reports the actual value', () => {
    const m = oneTest([
      { do: 'control', id: 'sw0', value: true },
      { do: 'expect', observe: 'light0', equals: true, message: 'Lamp must be on' },
    ]);
    const t = runMission(m, FOLLOW).tests[0]!;
    expect(t.passed).toBe(false);
    expect(t.failure).toMatch(/^Lamp must be on — expected light0 ON, but it was OFF/);
    expect(t.failedAtMs).toBe(0);
    expect(t.steps.map((s) => s.ok)).toEqual([true, false]);
  });

  it('within: polls every 10 ms up to the limit', () => {
    // Light_0 = done bit of a 300 ms on-delay started by Switch_0.
    const prog = ['XIC(Switch_0)TON(T1,300,0);', 'XIC(T1.DN)OTE(Light_0);'];
    const tags = { tags: [{ name: 'T1', dataType: 'TIMER' as const }] };
    const steps = (within: number): TestStep[] => [
      { do: 'control', id: 'sw0', value: true },
      { do: 'expect', observe: 'light0', equals: true, within, message: 'late lamp' },
    ];
    const short = runMission(oneTest(steps(200), { solution: { rungs: [], ...tags } }), prog);
    expect(short.passed).toBe(false);
    expect(short.tests[0]!.failure).toMatch(/for the whole 200 ms/);
    expect(short.tests[0]!.failedAtMs).toBe(200);
    const long = runMission(oneTest(steps(400), { solution: { rungs: [], ...tags } }), prog);
    expect(long.passed).toBe(true);
    const t = long.tests[0]!.steps[1]!.timeMs;
    expect(t).toBeGreaterThanOrEqual(300);
    expect(t).toBeLessThanOrEqual(340);
  });

  it('for: the condition must hold continuously', () => {
    // Lamp on while Switch_0, but only for the first 500 ms (a TON cuts it).
    const prog = ['XIC(Switch_0)TON(T1,500,0);', 'XIC(Switch_0)XIO(T1.DN)OTE(Light_0);'];
    const m = oneTest(
      [
        { do: 'control', id: 'sw0', value: true },
        { do: 'expect', observe: 'light0', equals: true, within: 50, for: 1000, message: 'hold' },
      ],
      { solution: { rungs: [], tags: [{ name: 'T1', dataType: 'TIMER' }] } },
    );
    const t = runMission(m, prog).tests[0]!;
    expect(t.passed).toBe(false);
    expect(t.failure).toMatch(/should stay ON for 1000 ms, but became OFF \(0\) after \d+ ms/);
    expect(t.failedAtMs).toBeGreaterThanOrEqual(500);
    expect(t.failedAtMs).toBeLessThanOrEqual(540);
  });

  it('min / max ranges on analog observables and REAL tags', () => {
    const m = oneTest([
      { do: 'control', id: 'pot1', value: 42 },
      { do: 'expect', observe: 'meter1', min: 41.9, max: 42.1, within: 100, message: 'meter follows pot' },
      { do: 'expect', tag: 'Pot_1', min: 42, max: 42, message: 'REAL tag' },
      { do: 'expect', observe: 'meter1', max: 10, message: 'too high' },
    ]);
    const t = runMission(m, ['MOV(Pot_1,Meter_1);']).tests[0]!;
    expect(t.steps.map((s) => s.ok)).toEqual([true, true, true, false]);
    expect(t.failure).toMatch(/expected meter1 <= 10, but it was 42/);
  });

  it('numeric equals on integer tags; boolean equals accepts 0/1', () => {
    const m = oneTest(
      [
        { do: 'wait', ms: 50 },
        { do: 'expect', tag: 'N', equals: 7, message: 'dint' },
        { do: 'expect', tag: 'N.0', equals: true, message: 'bit 0' },
        { do: 'expect', tag: 'N.3', equals: 0, message: 'bit 3 as number' },
      ],
      { solution: { rungs: [], tags: [{ name: 'N', dataType: 'DINT' }] } },
    );
    expect(runMission(m, ['MOV(7,N);']).passed).toBe(true);
  });

  it('missing tags, structures, unknown observables and controls fail with clear messages', () => {
    const cases: Array<[TestStep, RegExp]> = [
      [{ do: 'expect', tag: 'Ghost', equals: true, message: 'm' }, /Tag 'Ghost' does not exist/],
      [{ do: 'expect', tag: 'T1', equals: 1, message: 'm' }, /is a TIMER: test a member/],
      [{ do: 'expect', observe: 'warpDrive', equals: true, message: 'm' }, /Unknown observable 'warpDrive'/],
      [{ do: 'control', id: 'flux', value: true }, /Unknown control 'flux'/],
      [{ do: 'tap', id: 'flux' }, /Unknown control 'flux'/],
      [{ do: 'expect', observe: 'light0', message: 'no condition' }, /needs equals, min or max/],
    ];
    for (const [step, re] of cases) {
      const m = oneTest([step], { solution: { rungs: [], tags: [{ name: 'T1', dataType: 'TIMER' }] } });
      const t = runMission(m, FOLLOW).tests[0]!;
      expect(t.passed, String(re)).toBe(false);
      expect(t.failure).toMatch(re);
    }
  });

  it('mode steps: PROG turns the outputs off, RUN prescans and resumes', () => {
    const m = oneTest([
      { do: 'control', id: 'sw0', value: true },
      { do: 'expect', observe: 'light0', equals: true, within: 50, message: 'on' },
      { do: 'mode', mode: 'PROG' },
      { do: 'expect', observe: 'light0', equals: false, within: 20, message: 'outputs off in PROG' },
      { do: 'wait', ms: 200 },
      { do: 'expect', observe: 'light0', equals: false, message: 'still off' },
      { do: 'mode', mode: 'RUN' },
      { do: 'expect', observe: 'light0', equals: true, within: 30, message: 'back on in RUN' },
    ]);
    expect(runMission(m, FOLLOW).passed).toBe(true);
  });

  it('mode RUN: a latched output does not flash before the first-scan unlatch runs', () => {
    const m = oneTest([
      { do: 'tap', id: 'pb_green', ms: 50 },
      { do: 'expect', tag: 'Light_0', equals: true, message: 'latched' },
      { do: 'mode', mode: 'PROG' },
      { do: 'wait', ms: 50 },
      { do: 'mode', mode: 'RUN' },
      { do: 'expect', observe: 'light0', equals: false, for: 200, message: 'no flash' },
    ]);
    expect(runMission(m, ['XIC(PB_Green)OTL(Light_0);', 'XIC(S:FS)OTU(Light_0);']).passed).toBe(true);
    expect(runMission(m, ['XIC(PB_Green)OTL(Light_0);']).passed).toBe(false);
  });

  it('a controller major fault fails the test with the fault code', () => {
    const m = oneTest(
      [
        { do: 'wait', ms: 100 },
        { do: 'expect', observe: 'light0', equals: false, message: 'never reached' },
      ],
      { solution: { rungs: [], tags: [{ name: 'Idx', dataType: 'DINT' }, { name: 'Arr', dataType: 'DINT', dims: 5 }] } },
    );
    const t = runMission(m, ['MOV(10,Idx);', 'MOV(1,Arr[Idx]);']).tests[0]!;
    expect(t.passed).toBe(false);
    expect(t.failure).toMatch(/The controller faulted: Major Fault T04:C20/);
    expect(t.failedAtMs).toBe(10);
  });
});

describe('invariants', () => {
  // A 10 ms output pulse every 120 ms (self-resetting TON: PRE + 2 scans).
  const PULSE = ['XIO(T1.DN)TON(T1,100,0);', 'XIC(T1.DN)OTE(Light_0);'];
  const pulseMission = (graceMs?: number): MissionDef =>
    oneTest([{ do: 'wait', ms: 1000 }, { do: 'expect', observe: 'light1', equals: false, message: 'm' }], {
      solution: { rungs: [], tags: [{ name: 'T1', dataType: 'TIMER' }] },
      invariants: [{ observe: 'light0', equals: false, message: 'Light_0 must never light', ...(graceMs !== undefined ? { graceMs } : {}) }],
    });

  it('are checked every step and report the sim time', () => {
    const t = runMission(pulseMission(), PULSE).tests[0]!;
    expect(t.passed).toBe(false);
    expect(t.failure).toMatch(/^Light_0 must never light — light0 was ON \(1\) at 0\.\d\d s/);
    expect(t.failedAtMs).toBeGreaterThan(100);
    expect(t.failedAtMs).toBeLessThan(150);
  });

  it('graceMs tolerates short violations only', () => {
    expect(runMission(pulseMission(10), PULSE).passed).toBe(true);
    expect(runMission(pulseMission(10), ['XIC(Switch_0)OTE(Light_0);', 'OTE(Light_0);']).passed).toBe(false);
  });

  it('when: only enforced while the condition holds', () => {
    const m = oneTest(
      [
        { do: 'control', id: 'sw0', value: true },
        { do: 'wait', ms: 200 },
        { do: 'control', id: 'sw1', value: true },
        { do: 'wait', ms: 200 },
        { do: 'expect', observe: 'light0', equals: true, message: 'm' },
      ],
      // The field sees outputs one step after the scan: an observable lags a control by 10 ms.
      { invariants: [{ when: { control: 'sw1', equals: true }, observe: 'light0', equals: false, graceMs: 10, message: 'no lamp while sw1' }] },
    );
    const bad = runMission(m, FOLLOW).tests[0]!;
    expect(bad.passed).toBe(false);
    expect(bad.failure).toMatch(/no lamp while sw1/);
    expect(bad.failedAtMs).toBe(220);
    const ok = runMission(m, ['XIC(Switch_0)XIO(Switch_1)OTE(Light_0);']).tests[0]!;
    expect(ok.failure).toBe('m — expected light0 ON, but it was OFF (0)'); // only the final expect fails
  });

  it('when + tag: the command is checked in the same step (no lag)', () => {
    const m = oneTest(
      [
        { do: 'control', id: 'sw0', value: true },
        { do: 'wait', ms: 100 },
        { do: 'control', id: 'sw1', value: true },
        { do: 'wait', ms: 100 },
        { do: 'expect', tag: 'Light_0', equals: false, message: 'off' },
      ],
      { invariants: [{ when: { control: 'sw1', equals: true }, tag: 'Light_0', equals: false, message: 'no lamp while sw1' }] },
    );
    expect(runMission(m, ['XIC(Switch_0)XIO(Switch_1)OTE(Light_0);']).passed).toBe(true);
    expect(runMission(m, FOLLOW).tests[0]!.failedAtMs).toBe(110);
  });
});

describe('stars & scoring', () => {
  const m = oneTest([
    { do: 'control', id: 'sw0', value: true },
    { do: 'expect', observe: 'light0', equals: true, within: 50, message: 'on' },
  ], { parInstructions: 2 });

  it('1 = pass, 2 = pass at par, 3 = and no hints', () => {
    expect(runMission(m, FOLLOW).stars).toBe(3);
    expect(runMission(m, FOLLOW, { hintsUsed: 2 }).stars).toBe(2);
    const over = runMission(m, ['[XIC(Switch_0),XIC(Switch_0)]OTE(Light_0);']);
    expect(over.passed).toBe(true);
    expect(over.instructionCount).toBe(3);
    expect(over.stars).toBe(1);
    expect(computeStars(mission(), true, 999, 0)).toBe(3); // no par
    expect(computeStars(m, false, 1, 0)).toBe(0);
    expect(starCriteria(m, over, 0)).toEqual({ passed: true, underPar: false, noHints: true });
  });

  it('scoreMission needs every test to have passed', () => {
    const two = mission({ tests: [m.tests[0]!, { ...m.tests[0]!, name: 'second' }] });
    const first = runMissionTest(two, FOLLOW, 0);
    expect(first.passed).toBe(true);
    expect(scoreMission(two, { tests: [first], verifyErrors: [], instructionCount: 2 }).passed).toBe(false);
    expect(scoreMission(two, { tests: [first, first], verifyErrors: [], instructionCount: 2 }).passed).toBe(true);
  });
});

describe('runners', () => {
  const boss = getMission('2-7')!;

  it('runMissionTest(i) equals runMission().tests[i] and results are deterministic', () => {
    const all = runMission(boss, boss.solution.rungs);
    expect(all.passed).toBe(true);
    for (let i = 0; i < boss.tests.length; i++) expect(runMissionTest(boss, boss.solution.rungs, i)).toEqual(all.tests[i]);
    expect(runMission(boss, boss.solution.rungs)).toEqual(all);
  });

  it('runMissionTest fails without running on verification errors', () => {
    const r = runMissionTest(boss, ['XIC(Start_PB);'], 0);
    expect(r.passed).toBe(false);
    expect(r.failure).toMatch(/Not run/);
  });

  it('a step-wise runner (watch mode) ends with the same result as finish()', () => {
    const project = solutionProject(boss);
    const idx = boss.tests.findIndex((t: MissionTest) => t.name.startsWith('AUTO: E-stop'));
    const reference = createMissionTestRunner(boss, project, idx).finish();
    const runner = createMissionTestRunner(boss, project, idx);
    let frames = 0;
    while (!runner.advance(33)) frames++;
    expect(frames).toBeGreaterThan(10);
    expect(runner.done).toBe(true);
    expect(runner.result).toEqual(reference);
    expect(runner.runtime.timeMs).toBe(reference.steps[reference.steps.length - 1]!.timeMs);
    runner.dispose();
  });

  it('validates a whole boss mission quickly', () => {
    const t0 = performance.now();
    runMission(boss, boss.solution.rungs);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe('lintMission', () => {
  it('reports unknown references and malformed steps', () => {
    const m = mission({
      tests: [
        {
          name: 'bad',
          steps: [
            { do: 'control', id: 'nope', value: true },
            { do: 'control', id: 'pot1', value: true },
            { do: 'control', id: 'sw0', value: 3 },
            { do: 'expect', observe: 'nothing', equals: true, message: 'x' },
            { do: 'expect', tag: 'NoTag', equals: true, message: 'x' },
            { do: 'expect', observe: 'light0', message: 'x' },
          ],
        },
      ],
      invariants: [{ observe: 'light0', equals: false, message: 'i', when: { control: 'ghost', equals: true } }],
    });
    const p = lintMission(m).join('\n');
    expect(p).toMatch(/unknown control 'nope'/);
    expect(p).toMatch(/analog control 'pot1' needs a number/);
    expect(p).toMatch(/control 'sw0' needs true\/false/);
    expect(p).toMatch(/unknown observable 'nothing'/);
    expect(p).toMatch(/unknown tag 'NoTag'/);
    expect(p).toMatch(/needs equals, min or max/);
    expect(p).toMatch(/when: unknown control 'ghost'/);
    const sel = mission({ sceneId: 'motor-station', tests: [{ name: 's', steps: [{ do: 'control', id: 'hoa', value: 5 }, { do: 'expect', observe: 'contactor', equals: false, message: 'm' }] }] });
    expect(lintMission(sel).join('\n')).toMatch(/selector 'hoa' needs a position index 0..2/);
  });

  it('maxTestDurationMs adds waits, taps, within and for', () => {
    expect(
      maxTestDurationMs({
        name: 'd',
        steps: [
          { do: 'wait', ms: 100 },
          { do: 'tap', id: 'x' },
          { do: 'tap', id: 'x', ms: 50 },
          { do: 'expect', observe: 'a', equals: true, within: 30, for: 70, message: 'm' },
        ],
      }),
    ).toBe(450);
  });
});
