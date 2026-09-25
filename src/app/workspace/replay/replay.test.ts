/**
 * Failed-test replays as a debugging lesson (headless): the recorded expected-vs-actual trace, step / seek
 * navigation, the failure explanation ("Light_0 is driven by rung 0 — its rung condition is false because
 * Switch_0 (XIO) is 1"), the camera plan and the ladder highlight matcher.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { operandHighlighted } from '../../../editor/RungSvg';
import { getMission, MISSIONS } from '../../../game/missions';
import { normalizeWrongAnswer, type WrongAnswerSet } from '../../../game/missions/authoring';
import { buildMissionProject, runMission } from '../../../game/validation';
import { SCENE_LOGICS } from '../../../sim/scenes';
import { stepCameras } from '../replayCamera';
import { hintText, type FailureExplanation } from './explain';
import { ReplaySession } from './session';
import { controlAliases, drivingTags } from './signals';

/** Replay the first failing test of `rungs` on mission `id`. */
function replayFirstFailure(id: string, rungs: string[], tags?: Parameters<typeof buildMissionProject>[3]) {
  const m = getMission(id)!;
  const project = buildMissionProject(m, rungs, undefined, tags);
  const r = runMission(m, project, { enforcePalette: false });
  const i = r.tests.findIndex((t) => !t.passed);
  expect(i, `${id}: ${rungs.join(' ')} should fail a test`).toBeGreaterThanOrEqual(0);
  return { m, project, i, result: r.tests[i]!, session: new ReplaySession(m, project, i, r.tests[i]) };
}

const hints = (e: FailureExplanation | undefined): string => (e?.hint ?? []).map(hintText).join('\n');

describe('failure explanation', () => {
  it('XIO instead of XIC: names the rung, the blocking contact and its value', () => {
    const { session } = replayFirstFailure('1-1', ['XIO(Switch_0)OTE(Light_0);']);
    const e = session.explanation!;
    expect(e.kind).toBe('check');
    expect(e.expected).toMatch(/Light 0.* should be OFF/);
    expect(e.saw).toMatch(/ON \(1\)/);
    expect(hints(e)).toContain('Light_0 is driven by rung 0 — its rung condition is true: Switch_0 (XIO) is 0');
    expect(e.tags).toEqual(['Light_0']);
    expect(e.rungs).toEqual([0]);
    expect(e.elements).toHaveLength(1);
    session.dispose();
  });

  it('expected ON: "its rung condition is false because Switch_0 (XIO) is 1" + the XIO tip', () => {
    const m = getMission('1-1')!;
    const project = buildMissionProject(m, ['XIO(Switch_0)OTE(Light_0);']);
    const i = m.tests.findIndex((t) => t.name === 'Lamp follows the switch');
    const s = new ReplaySession(m, project, i);
    const e = s.explanation!;
    expect(e.expected).toBe('Light 0 (green) should be ON within 100 ms, then stay ON for 500 ms');
    expect(hints(e)).toContain('its rung condition is false because Switch_0 (XIO) is 1. XIO is true only while its bit is 0.');
    expect(e.did.map((d) => d.text)).toEqual(['Wait 100 ms', 'Set Switch 0 to ON']);
    s.dispose();
  });

  it('wrong input tag: points out the operated switch the program never reads', () => {
    const m = getMission('1-1')!;
    const i = m.tests.findIndex((t) => t.name === 'Lamp follows the switch');
    const s = new ReplaySession(m, buildMissionProject(m, ['XIC(Switch_1)OTE(Light_0);']), i);
    const h = hints(s.explanation);
    expect(h).toContain('its rung condition is false because Switch_1 (XIC) is 0');
    expect(h).toContain('The test operated Switch_0, but your program never looks at it');
    s.dispose();
  });

  it('nothing writes the output', () => {
    const m = getMission('1-1')!;
    const i = m.tests.findIndex((t) => t.name === 'Lamp follows the switch');
    const s = new ReplaySession(m, buildMissionProject(m, ['XIC(Switch_0)OTE(Light_1);']), i);
    expect(hints(s.explanation)).toContain('Nothing in your program writes Light_0');
    s.dispose();
  });

  it('duplicate OTE: the last rung wins', () => {
    const { session } = replayFirstFailure('1-4', ['XIC(PB_Black_1)OTE(Buzzer);', 'XIC(PB_Black_2)OTE(Buzzer);']);
    expect(hints(session.explanation)).toMatch(/Buzzer is written by OTE on rung 0 and rung 1 .* the last one \(rung 1\) always wins/);
    expect(session.explanation!.rungs[0]).toBe(1);
    session.dispose();
  });

  it('N.C. stop button: explains the wiring once', () => {
    const { session } = replayFirstFailure('1-5', ['XIC(PB_Red)[OTE(Light_5),OTE(Buzzer)];', 'XIO(PB_Red)OTE(Light_1);']);
    const h = hints(session.explanation);
    expect(h).toContain('PB_Red (XIO) is 1 (wired N.C.:');
    session.dispose();
  });

  it('latched output with no working unlatch', () => {
    const { session } = replayFirstFailure('2-4', [
      'XIC(Start_PB)OTL(Motor_Starter);',
      '[XIO(Stop_PB),XIO(EStop_OK),XIO(OL_OK)]OTU(Motor_Starter);',
      'XIC(Motor_Aux)OTE(Run_Light);',
      'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);',
      '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);',
    ]);
    const h = hints(session.explanation);
    expect(h).toContain('Motor_Starter is latched by OTL (rung 0)');
    expect(h).toContain('every branch is blocked');
    session.dispose();
  });

  it('safety rule (invariant): kind, rule text and the output behind it', () => {
    const { session } = replayFirstFailure('2-3', [
      '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)OTE(Motor_Starter);',
      'XIC(Motor_Aux)OTE(Run_Light);',
      'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);',
      '[XIO(EStop_OK),XIO(OL_OK)]OTE(Fault_Light);',
    ]);
    const e = session.explanation!;
    expect(e.kind).toBe('invariant');
    expect(e.expected).toMatch(/^Safety rule, checked all the time: Motor_Starter must be OFF while the E-stop is pushed/);
    expect(e.saw).toMatch(/Motor_Starter was ON \(1\) at/);
    expect(hints(e)).toContain('Motor_Starter is driven by rung 0 — its rung condition is true');
    // the rule's band is on the Motor_Starter row, only while the E-stop was pushed
    const row = session.trace.rows.find((r) => r.signal.id === 'Motor_Starter')!;
    expect(row.failing).toBe(true);
    expect(row.bands.some((b) => b.step === -1 && b.failed)).toBe(true);
    session.dispose();
  });

  it('timer: the TON and why it is not timing', () => {
    const { session } = replayFirstFailure('3-5', [
      '[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)XIC(EStop_OK)XIC(OL_OK)OTE(Motor_Starter);',
      'XIC(Motor_Aux)TON(Run_Timer,30000,0);',
      'XIC(Jog_PB)XIO(Motor_Aux)TON(Reset_Hold,2000,0);',
      'XIC(Reset_Hold.DN)RES(Run_Timer);',
      'XIC(Motor_Aux)OTE(Run_Light);',
      'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);',
      '[XIO(EStop_OK),XIO(OL_OK),XIC(Run_Timer.DN)]OTE(Fault_Light);',
    ]);
    const h = hints(session.explanation);
    expect(h).toContain('Run_Timer is a TON on rung 1');
    expect(h).toContain('A TON clears .ACC every time its rung goes false.');
    session.dispose();
  });

  it('every wrong answer of the campaign replays and explains its first failure', () => {
    const modules = import.meta.glob<Record<string, unknown>>('../../../game/missions/*.wrong.ts', { eager: true });
    let n = 0;
    for (const mod of Object.values(modules)) {
      for (const [name, set] of Object.entries(mod)) {
        if (/RIGHT$/i.test(name) || !set || typeof set !== 'object') continue;
        for (const [id, list] of Object.entries(set as WrongAnswerSet)) {
          const m = getMission(id);
          if (!m || !Array.isArray(list)) continue;
          const w = normalizeWrongAnswer(list[0]!);
          const project = buildMissionProject(m, w.rungs, undefined, w.tags);
          const r = runMission(m, project, { enforcePalette: false });
          const i = r.tests.findIndex((t) => !t.passed);
          if (i < 0) continue;
          const s = new ReplaySession(m, project, i, r.tests[i]);
          const e = s.explanation;
          expect(e, `${id}`).toBeDefined();
          expect(e!.expected.length, `${id} expected`).toBeGreaterThan(0);
          expect(e!.saw.length, `${id} saw`).toBeGreaterThan(0);
          if (e!.kind === 'check' || e!.kind === 'invariant') expect(e!.hint.length, `${id}: no hint for ${r.tests[i]!.failure}`).toBeGreaterThan(0);
          // the replay ends exactly like the recorded run
          s.runner.finish();
          expect(s.runner.result.failure).toBe(r.tests[i]!.failure);
          expect(s.trace.failAtMs).toBe(r.tests[i]!.failedAtMs);
          expect(s.trace.rows.some((row) => row.failing) || e!.kind === 'fault' || e!.kind === 'other').toBe(true);
          s.dispose();
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(30);
  }, 60_000);
});

describe('replay session', () => {
  it('records a trace of the test: rows, bands, steps, failure', () => {
    const m = getMission('1-1')!;
    const i = m.tests.findIndex((t) => t.name === 'Lamp follows the switch');
    const s = new ReplaySession(m, buildMissionProject(m, ['XIO(Switch_0)OTE(Light_0);']), i);
    const labels = s.trace.rows.map((r) => `${r.signal.kind}:${r.signal.id}:${r.role}`);
    expect(labels).toEqual(['control:sw0:input', 'observe:light0:check', 'tag:Light_0:output']);
    const lamp = s.trace.rows[1]!;
    expect(lamp.failing).toBe(true);
    expect(lamp.bands).toHaveLength(1);
    expect(lamp.bands[0]).toMatchObject({ from: 100, to: 120, step: 2, failed: true, deadline: 200, cond: { equals: true } });
    expect(s.trace.stepStarts.slice(0, 3)).toEqual([0, 100, 100]);
    expect(s.trace.failAtMs).toBe(120);
    expect(s.trace.times[s.trace.count - 1]).toBe(120);
    // the switch goes to 1 at 100 ms (+ one step), the lamp was ON (XIO) and goes OFF
    const at = (t: number, k: number) => s.trace.values[k]![s.trace.times.indexOf(t)]!;
    expect(at(50, 0)).toBe(0);
    expect(at(120, 0)).toBe(1);
    expect(at(50, 1)).toBe(1);
    expect(at(120, 1)).toBe(0);
    s.dispose();
  });

  it('plays, steps, seeks and jumps to the failure deterministically', () => {
    const m = getMission('2-1')!;
    const project = buildMissionProject(m, ['XIC(Start_PB)XIC(Stop_PB)OTE(Motor_Starter);']);
    const i = m.tests.findIndex((t) => /keeps running/.test(t.name));
    const s = new ReplaySession(m, project, i);
    const events: number[] = [];
    s.subscribe(() => events.push(s.stepIndex));
    expect(s.stepIndex).toBe(0);
    s.advance(55); // fractions carry over: 5 steps now, the rest later
    expect(s.timeMs).toBe(50);
    s.advance(5);
    expect(s.timeMs).toBe(60);
    s.stepForward();
    expect(s.stepIndex).toBe(1); // the Start tap
    expect(s.timeMs).toBe(210);
    s.stepForward();
    expect(s.stepIndex).toBe(s.failingStep); // the instant "runs" check passes on the way: the hold check that fails
    expect(s.failingStep).toBe(3);
    s.stepBack();
    expect(s.stepIndex).toBe(1);
    const gen = s.generation;
    s.seekStep(0);
    expect(s.generation).toBe(gen + 1);
    expect(s.stepIndex).toBe(0);
    s.jumpToFailure();
    expect(s.stepIndex).toBe(s.failingStep);
    expect(s.done).toBe(false);
    s.advance(10_000);
    expect(s.done && s.failed).toBe(true);
    expect(s.timeMs).toBe(s.trace.failAtMs);
    expect(s.runner.result.failure).toBe(s.final.failure);
    s.stepBack(); // from the end: back to the failing step's start
    expect(s.failed).toBe(false);
    expect(s.stepIndex).toBe(s.failingStep);
    expect(events.length).toBeGreaterThan(3);
    s.restart();
    expect(s.timeMs).toBe(0);
    s.dispose();
  });

  it('a passing test has no failure / explanation', () => {
    const m = getMission('1-1')!;
    const s = new ReplaySession(m, buildMissionProject(m, m.solution.rungs), 1);
    expect(s.final.passed).toBe(true);
    expect(s.explanation).toBeUndefined();
    expect(s.failure).toBeUndefined();
    expect(s.trace.failAtMs).toBeUndefined();
    s.dispose();
  });
});

describe('replay camera follows the steps', () => {
  /** A scene definition's `focus` map, read as text (the definitions import the 3D views). */
  function focusOf(sceneId: string): { cams: string[]; focus: Record<string, string> } {
    const src = readFileSync(new URL(`../../../sim/scenes/${sceneId}/definition.tsx`, import.meta.url), 'utf8');
    const camBlock = /cameras:\s*\[([\s\S]*?)\n\s*\],/.exec(src)?.[1] ?? '';
    const cams = [...camBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]!);
    const focusBlock = /focus:\s*\{([\s\S]*?)\n\s*\},/.exec(src)?.[1] ?? '';
    const focus = Object.fromEntries([...focusBlock.matchAll(/([A-Za-z_][\w]*):\s*'([^']+)'/g)].map((m) => [m[1]!, m[2]!]));
    return { cams, focus };
  }

  it('every scene maps its devices to cameras it really has', () => {
    for (const scene of Object.values(SCENE_LOGICS)) {
      const { cams, focus } = focusOf(scene.id);
      expect(Object.keys(focus).length, scene.id).toBeGreaterThan(8);
      const ids = new Set([...scene.controls.map((c) => c.id), ...scene.observables.map((o) => o.id), ...scene.io.map((p) => p.alias)]);
      for (const [k, cam] of Object.entries(focus)) {
        expect(cams, `${scene.id}: ${k} → ${cam}`).toContain(cam);
        expect(ids.has(k), `${scene.id}: focus key '${k}' is no control / observable / alias`).toBe(true);
      }
      // every control and observable a mission uses has a device camera
      for (const m of MISSIONS.filter((x) => x.sceneId === scene.id))
        for (const t of m.tests)
          for (const st of t.steps) {
            const id = st.do === 'control' || st.do === 'tap' ? st.id : st.do === 'expect' ? st.observe : undefined;
            if (id) expect(focus[id], `${m.id}: ${id}`).toBeDefined();
          }
    }
  });

  it('2-1: the buttons for the Start tap, then the contactor in the panel', () => {
    const { focus } = focusOf('motor-station');
    const m = getMission('2-1')!;
    const t = m.tests.find((x) => /keeps running/.test(x.name))!;
    const plan = stepCameras('motor-station', t, focus);
    expect(plan.slice(0, 3)).toEqual(['operator', 'operator', 'panel']);
    expect(plan).toHaveLength(t.steps.length + 1);
  });

  it('1-1: a failing lamp check ends on the outputs', () => {
    const { focus } = focusOf('trainer');
    const m = getMission('1-1')!;
    const t = m.tests.find((x) => x.name === 'Lamp follows the switch')!;
    const plan = stepCameras('trainer', t, focus, { step: 2, signal: 'light0' });
    expect(plan[0]).toBe('console'); // the wait leads up to flipping Switch 0
    expect(plan[2]).toBe('outputs');
    expect(plan[plan.length - 1]).toBe('outputs');
  });
});

describe('signals', () => {
  it('plant observables map to the PLC outputs that drive them', () => {
    const trainer = SCENE_LOGICS.trainer!;
    const motor = SCENE_LOGICS['motor-station']!;
    expect(drivingTags(trainer, 'light3')).toEqual(['Light_3']);
    expect(drivingTags(motor, 'runLight')).toEqual(['Run_Light']);
    expect(drivingTags(motor, 'motorRunning')).toEqual(['Motor_Starter']);
    expect(drivingTags(SCENE_LOGICS['traffic-light']!, 'nsGreen')).toEqual(['NS_Green']);
    // every name in the table is an output alias of its scene
    for (const scene of Object.values(SCENE_LOGICS))
      for (const o of scene.observables)
        for (const t of drivingTags(scene, o.id)) expect(scene.io.some((p) => p.alias === t && p.dir === 'output'), `${scene.id}.${o.id} → ${t}`).toBe(true);
  });

  it('controls map to the inputs they operate', () => {
    expect(controlAliases(SCENE_LOGICS.trainer!, 'sw0')).toEqual(['Switch_0']);
    expect(controlAliases(SCENE_LOGICS.trainer!, 'pb_black1')).toEqual(['PB_Black_1']);
    expect(controlAliases(SCENE_LOGICS['motor-station']!, 'start')).toEqual(['Start_PB']);
    expect(controlAliases(SCENE_LOGICS['motor-station']!, 'hoa')).toEqual(['HOA_Hand', 'HOA_Auto']);
    expect(controlAliases(SCENE_LOGICS['traffic-light']!, 'ped')).toEqual(['Ped_PB']);
  });
});

describe('ladder highlight', () => {
  it('matches the tag, its members and bits, case-insensitively', () => {
    const hl = new Set(['run_timer', 'light_0', 'local:2:o.data.0']);
    expect(operandHighlighted('Run_Timer', hl)).toBe(true);
    expect(operandHighlighted('Run_Timer.DN', hl)).toBe(true);
    expect(operandHighlighted('LIGHT_0', hl)).toBe(true);
    expect(operandHighlighted('Local:2:O.Data.0', hl)).toBe(true);
    expect(operandHighlighted('Light_01', hl)).toBe(false);
    expect(operandHighlighted('?', hl)).toBe(false);
    expect(operandHighlighted('Light_0', undefined)).toBe(false);
  });
});
