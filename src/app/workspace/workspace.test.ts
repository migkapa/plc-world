import { describe, expect, it } from 'vitest';
import { getMission } from '../../game/missions';
import { buildMissionProject, missionTags } from '../../game/validation';
import { parseRung } from '../../plc/neutralText';
import { createController } from '../../plc/controller';
import { createProjectForScene } from '../../sim/project';
import { SCENE_LOGICS } from '../../sim/scenes';
import { compactComments, countChangedRungs, messagesToVerifyErrors, rungsToText, tagSignature, userTagsOf } from './program';
import { decodeShareCode, encodeShareCode, exportProgramText, importProgramText, ProgramTextError, slugify } from './programText';
import { backupWorkingCopy, deleteSlot, getSlot, hasProgramContent, listSlots, loadWorkingCopy, renameSlot, saveSlot, saveWorkingCopy, sameProgramSnapshot, type KeyValueStorage } from './slots';
import { controlsUsedByTests, describeFailure, describeStep, fmtSeconds, violatedInvariants } from './stepText';
import { createTestProgressStore, startTestRun } from './testRun';
import { defaultTwinShare } from './WorkspaceLayout';

function memStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/** Synchronous scheduler: runs queued callbacks in order until the queue is empty. */
function syncScheduler(): { schedule(fn: () => void, ms: number): void; flush(): void } {
  const q: Array<() => void> = [];
  return {
    schedule: (fn) => void q.push(fn),
    flush() {
      let guard = 0;
      while (q.length > 0 && guard++ < 1_000_000) q.shift()!();
    },
  };
}

describe('program helpers', () => {
  it('serializes editor rungs to neutral text + comments', () => {
    const rungs = [parseRung('XIC(A)OTE(B);', 'first'), parseRung(''), parseRung('XIO(C)OTE(D);')];
    const t = rungsToText(rungs);
    expect(t.rungs).toEqual(['XIC(A)OTE(B);', ';', 'XIO(C)OTE(D);']);
    expect(t.comments).toEqual(['first', undefined, undefined]);
    expect(compactComments(t.comments)).toEqual(['first']);
  });

  it('extracts only player-created or changed tags', () => {
    const mission = getMission('1-1')!;
    const base = buildMissionProject(mission, ['']).tags;
    const c = createController(buildMissionProject(mission, ['']));
    expect(userTagsOf(c.project, base)).toEqual([]);
    c.upsertTag({ name: 'My_Bit', dataType: 'BOOL', description: 'mine' });
    c.upsertTag({ name: 'Local_T', dataType: 'TIMER' }, 'MainProgram');
    const alias = base.find((t) => t.name === 'Switch_0')!;
    c.upsertTag({ ...alias, description: 'Guard door switch' });
    const user = userTagsOf(c.project, base);
    expect(user.map((t) => t.name).sort()).toEqual(['Local_T', 'My_Bit', 'Switch_0']);
    // round trip: a project rebuilt with the saved tags has the same user tags
    const again = buildMissionProject(mission, [''], [], user);
    expect(userTagsOf(again, base).map((t) => t.name).sort()).toEqual(['Local_T', 'My_Bit', 'Switch_0']);
    expect(tagSignature(again)).not.toEqual(tagSignature(buildMissionProject(mission, [''])));
  });

  it('keeps mission tags out of the saved tags', () => {
    const mission = getMission('3-1') ?? getMission('2-1')!;
    const base = buildMissionProject(mission, ['']).tags;
    expect(missionTags(mission).every((t) => base.some((b) => b.name === t.name))).toBe(true);
    const c = createController(buildMissionProject(mission, ['']));
    expect(userTagsOf(c.project, base)).toEqual([]);
  });

  it('counts changed rungs by id', () => {
    const a = parseRung('XIC(A)OTE(B);');
    const b = parseRung('XIC(C)OTE(D);');
    expect(countChangedRungs([a, b], [a, b])).toBe(0);
    expect(countChangedRungs([a, b], [a, { ...b, comment: 'x' }])).toBe(1);
    expect(countChangedRungs([a, b], [a])).toBe(1);
    expect(countChangedRungs([a], [a, b])).toBe(1);
    expect(countChangedRungs([a, b], [{ ...a, elements: parseRung('XIO(A)OTE(B);').elements }, b])).toBe(1);
  });

  it('turns palette messages into rung-located errors', () => {
    const errs = messagesToVerifyErrors([
      'Error: MainProgram - MainRoutine, Rung 3, TON: TON is not available in this mission (allowed: XIC, OTE).',
      'Error: This mission requires the ONS instruction — use it in your program.',
    ]);
    expect(errs[0]).toMatchObject({ program: 'MainProgram', routine: 'MainRoutine', rungIndex: 3, severity: 'error' });
    expect(errs[0]!.message).toMatch(/^TON: TON is not available/);
    expect(errs[1]).toMatchObject({ rungIndex: -1 });
    expect(errs[1]!.message).toMatch(/^This mission requires/);
  });
});

describe('program text export / import', () => {
  const doc = {
    sceneId: 'trainer',
    name: 'Blinker "v2"',
    rungs: ['[XIC(PB_Green),XIC(Motor_Run)]XIC(PB_Red)OTE(Motor_Run);', '', 'XIC(Motor_Run)OTE(Light_0);'],
    comments: ['Seal-in, with "quotes"\nand a newline', undefined, 'Lamp'],
    tags: [
      { name: 'Motor_Run', dataType: 'BOOL', description: 'Motor run command' },
      { name: 'Recipe', dataType: 'DINT', dims: 10 },
      { name: 'SP', dataType: 'REAL', initial: 55.5, constant: true },
    ],
  };

  it('round-trips a program', () => {
    const text = exportProgramText(doc, { sceneTitle: 'PLC Trainer Bench', date: new Date(0) });
    expect(text).toContain('SCENE trainer');
    expect(text).toContain('N: XIC(Motor_Run)OTE(Light_0);');
    expect(text).toContain('TAG Motor_Run BOOL "Motor run command"');
    const back = importProgramText(text);
    expect(back.sceneId).toBe('trainer');
    expect(back.name).toBe(doc.name);
    expect(back.rungs).toEqual(doc.rungs);
    expect(back.comments).toEqual(doc.comments);
    expect(back.tags).toEqual(doc.tags);
  });

  it('accepts plain pasted rungs and comment lines', () => {
    const back = importProgramText('# my stuff\nXIC(Switch_0)OTE(Light_0);\n\n// another\nXIO(Switch_1)OTE(Light_2);\n');
    expect(back.rungs).toEqual(['XIC(Switch_0)OTE(Light_0);', 'XIO(Switch_1)OTE(Light_2);']);
    expect(back.sceneId).toBeUndefined();
  });

  it('reports structural errors with line numbers', () => {
    expect(() => importProgramText('XIC(A)OTE(B)')).toThrow(ProgramTextError);
    expect(() => importProgramText('TAG {nope')).toThrow(/Line 1/);
    expect(() => importProgramText('; only comments')).toThrow(/no rungs/);
  });

  it('encodes and decodes share codes', async () => {
    const code = await encodeShareCode(doc);
    expect(code).toMatch(/^[zj]\.[A-Za-z0-9_-]+$/);
    const back = await decodeShareCode(code);
    expect(back).toEqual({ ...doc });
    await expect(decodeShareCode('garbage')).rejects.toThrow();
  });

  it('slugifies names', () => {
    expect(slugify('My  Program #1!')).toBe('my-program-1');
    expect(slugify('***')).toBe('program');
  });
});

describe('sandbox slots', () => {
  it('saves, overwrites by name, renames, lists newest first and deletes', () => {
    const st = memStorage();
    const a = saveSlot({ name: 'Blinker', sceneId: 'trainer', rungs: ['XIC(A)OTE(B);'], comments: [], tags: [] }, st, 1000)!;
    const b = saveSlot({ name: 'Seal-in', sceneId: 'motor-station', rungs: [';'], comments: [], tags: [] }, st, 2000)!;
    expect(listSlots(st).map((s) => s.id)).toEqual([b.id, a.id]);
    const a2 = saveSlot({ name: 'blinker', sceneId: 'trainer', rungs: ['XIO(A)OTE(B);'], comments: [], tags: [] }, st, 3000)!;
    expect(a2.id).toBe(a.id);
    expect(a2.createdAt).toBe(1000);
    expect(listSlots(st)).toHaveLength(2);
    expect(getSlot(a.id, st)!.rungs).toEqual(['XIO(A)OTE(B);']);
    expect(renameSlot(a.id, 'Flasher', st)).toBe(true);
    expect(getSlot(a.id, st)!.name).toBe('Flasher');
    expect(deleteSlot(a.id, st)).toBe(true);
    expect(deleteSlot(a.id, st)).toBe(false);
    expect(listSlots(st).map((s) => s.id)).toEqual([b.id]);
  });

  it('survives corrupt storage', () => {
    const st = memStorage();
    st.setItem('plc-world-sandbox-slots-v1', '{not json');
    expect(listSlots(st)).toEqual([]);
    st.setItem('plc-world-sandbox-slots-v1', JSON.stringify([{ id: 'x', sceneId: 'trainer', rungs: [1, 'XIC(A)OTE(B);'] }, 5]));
    expect(listSlots(st)).toHaveLength(1);
    expect(listSlots(st)[0]!.rungs).toEqual(['XIC(A)OTE(B);']);
  });

  it('keeps a working copy per scene', () => {
    const st = memStorage();
    expect(loadWorkingCopy('trainer', st)).toBeUndefined();
    saveWorkingCopy('trainer', { rungs: ['XIC(A)OTE(B);'], comments: ['c'], tags: [], name: 'Mine' }, st);
    expect(loadWorkingCopy('trainer', st)).toEqual({ rungs: ['XIC(A)OTE(B);'], comments: ['c'], tags: [], name: 'Mine' });
    expect(loadWorkingCopy('motor-station', st)).toBeUndefined();
  });

  it('backs up an unsaved working copy before a share link / slot replaces it', () => {
    const st = memStorage();
    const mine = { rungs: ['XIC(Switch_0)OTE(Light_0);', 'XIC(Switch_1)OTE(Light_1);'], comments: ['my unsaved work'], tags: [] };
    const shared = { rungs: ['XIC(Switch_0)OTE(Light_0);'], comments: [], tags: [] };
    // nothing to keep: no working copy / empty starter / identical to the incoming program
    expect(backupWorkingCopy('trainer', 'Trainer', shared, st)).toBeUndefined();
    saveWorkingCopy('trainer', { rungs: [';'], comments: ['Sandbox — build anything.'], tags: [], name: 'Untitled' }, st);
    expect(backupWorkingCopy('trainer', 'Trainer', shared, st)).toBeUndefined();
    saveWorkingCopy('trainer', { ...shared, name: 'X' }, st);
    expect(backupWorkingCopy('trainer', 'Trainer', shared, st)).toBeUndefined();
    // real unsaved work → recovery slot with its content
    saveWorkingCopy('trainer', { ...mine, name: 'My WIP' }, st);
    const slot = backupWorkingCopy('trainer', 'Trainer', shared, st, Date.UTC(2026, 8, 24, 10, 0))!;
    expect(slot).toBeDefined();
    expect(slot.sceneId).toBe('trainer');
    expect(slot.name).toMatch(/^My WIP \(recovered .+\) – Trainer$/);
    expect(slot.rungs).toEqual(mine.rungs);
    expect(slot.comments).toEqual(mine.comments);
    // already saved → no second copy
    expect(backupWorkingCopy('trainer', 'Trainer', shared, st)).toBeUndefined();
    expect(listSlots(st)).toHaveLength(1);
  });

  it('compares programs ignoring whitespace and trailing empty comments', () => {
    expect(sameProgramSnapshot({ rungs: ['XIC(A) OTE(B);'], comments: ['a', undefined], tags: [] }, { rungs: ['XIC(A)OTE(B);'], comments: ['a'], tags: [] })).toBe(true);
    expect(sameProgramSnapshot({ rungs: ['XIC(A)OTE(B);'], comments: [], tags: [] }, { rungs: ['XIO(A)OTE(B);'], comments: [], tags: [] })).toBe(false);
    expect(sameProgramSnapshot({ rungs: [';'], comments: [], tags: [{ name: 'T', dataType: 'TIMER' }] }, { rungs: [';'], comments: [], tags: [] })).toBe(false);
    expect(hasProgramContent({ rungs: [';', ' '], comments: ['x'], tags: [] })).toBe(false);
    expect(hasProgramContent({ rungs: [';'], comments: [], tags: [{ name: 'T', dataType: 'TIMER' }] })).toBe(true);
  });
});

describe('step text', () => {
  const scene = SCENE_LOGICS['motor-station']!;
  it('describes steps in plain language', () => {
    expect(describeStep({ do: 'wait', ms: 1500 }, scene)).toBe('Wait 1.5 s');
    expect(describeStep({ do: 'tap', id: 'start' }, scene)).toMatch(/^Press .+ for 200 ms$/);
    expect(describeStep({ do: 'control', id: 'hoa', value: 2 }, scene)).toMatch(/AUTO/i);
    expect(describeStep({ do: 'control', id: 'estop', value: true }, scene)).toMatch(/PUSHED/);
    expect(describeStep({ do: 'mode', mode: 'PROG' })).toMatch(/Program mode/);
    expect(describeStep({ do: 'expect', observe: 'contactor', equals: true, within: 100, message: 'Start must run the motor' }, scene)).toMatch(
      /^Check: Start must run the motor \(.+ ON, within 100 ms\)$/,
    );
    expect(fmtSeconds(12345)).toBe('12 s');
    expect(fmtSeconds(250)).toBe('0.25 s');
  });

  it('describes failures and matches invariants', () => {
    const mission = getMission('2-3') ?? getMission('2-1')!;
    const inv = mission.invariants?.[0];
    const f = describeFailure({ name: 't', passed: false, failure: 'Boom', failedAtMs: 1230, steps: [] });
    expect(f).toEqual({ message: 'Boom', at: 'after 1.2 s of simulated time' });
    if (inv) {
      const v = violatedInvariants(mission, [{ name: 't', passed: false, failure: `${inv.message} — x was ON`, steps: [] }]);
      expect(v.has(0)).toBe(true);
    }
  });

  it('finds controls used by tests (fault controls revealed in missions)', () => {
    const used = new Set<string>();
    for (const id of ['2-3', '2-4', '2-5']) {
      const m = getMission(id);
      if (m) for (const c of controlsUsedByTests(m)) used.add(c);
    }
    expect(used.has('overload_trip') || used.has('jam')).toBe(true);
  });
});

describe('chunked test run', () => {
  it('passes the reference solution and reports progress in order', async () => {
    const mission = getMission('1-1')!;
    const sched = syncScheduler();
    const events: string[] = [];
    const handle = startTestRun(mission, buildMissionProject(mission, mission.solution.rungs), {
      schedule: sched.schedule,
      onVerified: (c) => events.push(`verified:${c.verifyErrors.length}`),
      onTestStart: (i) => events.push(`start:${i}`),
      onTestDone: (i, r) => events.push(`done:${i}:${r.passed}`),
    });
    sched.flush();
    const result = await handle.done;
    expect(result.passed).toBe(true);
    expect(result.stars).toBe(3);
    expect(events).toEqual(['verified:0', ...mission.tests.flatMap((_, i) => [`start:${i}`, `done:${i}:true`])]);
  });

  it('stops at verification errors', async () => {
    const mission = getMission('1-1')!;
    const sched = syncScheduler();
    let started = 0;
    const handle = startTestRun(mission, buildMissionProject(mission, ['XIC(Nope)OTE(Light_0);']), { schedule: sched.schedule, onTestStart: () => started++ });
    sched.flush();
    const result = await handle.done;
    expect(result.passed).toBe(false);
    expect(result.verifyErrors.length).toBeGreaterThan(0);
    expect(started).toBe(0);
  });

  it('fails the starter program and can be cancelled', async () => {
    const mission = getMission('1-1')!;
    const sched = syncScheduler();
    const handle = startTestRun(mission, buildMissionProject(mission, ['XIC(Switch_1)OTE(Light_0);']), { schedule: sched.schedule });
    sched.flush();
    const result = await handle.done;
    expect(result.passed).toBe(false);
    expect(result.tests.some((t) => !t.passed && t.failure)).toBe(true);

    const s2 = syncScheduler();
    let done = 0;
    const h2 = startTestRun(mission, buildMissionProject(mission, mission.solution.rungs), { schedule: s2.schedule, onTestDone: () => done++ });
    h2.cancel();
    s2.flush();
    expect(done).toBe(0);
  });

  it('sandbox projects verify with the scene project builder', () => {
    const scene = SCENE_LOGICS.trainer!;
    const p = createProjectForScene(scene, ['XIC(Switch_0)OTE(Light_0);']);
    expect(createController(p).verify().filter((e) => e.severity === 'error')).toEqual([]);
  });
});

describe('chunked test run on every mission', () => {
  it('every mission solution passes with the same stars when run in chunks', async () => {
    const { MISSIONS } = await import('../../game/missions');
    for (const mission of MISSIONS) {
      const project = buildMissionProject(mission, mission.solution.rungs, [], mission.solution.tags);
      const sched = syncScheduler();
      const handle = startTestRun(mission, project, { schedule: sched.schedule, sliceSimMs: 730 });
      sched.flush();
      const chunked = await handle.done;
      // the generic mission suite proves every solution passes runMission with 3 stars
      expect({ id: mission.id, passed: chunked.passed, stars: chunked.stars, failures: chunked.tests.filter((t) => !t.passed).map((t) => t.failure) }).toEqual({
        id: mission.id,
        passed: true,
        stars: 3,
        failures: [],
      });
    }
  }, 120_000);
});

describe('test progress store', () => {
  it('quantizes values and only notifies on change', () => {
    const st = createTestProgressStore();
    let n = 0;
    const off = st.subscribe(() => n++);
    st.set(0, 0.101);
    st.set(0, 0.105); // same 2 % step → no notification
    expect(st.get(0)).toBeCloseTo(0.1);
    expect(n).toBe(1);
    st.set(1, 2);
    expect(st.get(1)).toBe(1);
    st.reset();
    expect(st.get(0)).toBe(0);
    expect(n).toBe(3);
    st.reset(); // already empty
    expect(n).toBe(3);
    off();
    st.set(0, 0.5);
    expect(n).toBe(3);
  });
});

describe('workspace layout', () => {
  it('gives the ladder more room on short screens', () => {
    expect(defaultTwinShare(768)).toBeLessThan(40);
    expect(defaultTwinShare(1000)).toBeLessThan(defaultTwinShare(1200));
    expect(defaultTwinShare(1200)).toBe(48);
  });
});
