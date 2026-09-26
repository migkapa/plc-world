/**
 * Guided first rung (headless): every step is judged from what the player did, never from the step order alone.
 */
import { describe, expect, it } from 'vitest';
import { getMission } from '../../../game/missions';
import { parseRung } from '../../../plc/neutralText';
import type { Rung } from '../../../plc/types';
import { changedRungTexts } from './TryItNow';
import { FIRST_RUNG_MISSION, FIRST_RUNG_STEPS, editorHasFirstRung, runningHasFirstRung, runningWritesLight0, tourStepView, type TourSince, type TourWorld } from './firstRungTour';
import { liveChipState } from './LiveChip';
import { shouldAutoStartTour } from './MissionAssist';
import { outcomeFor } from './liveObjectives';

const rung = (text: string, id = 'r0'): Rung => (text ? { ...parseRung(text), id } : { id, elements: [] });
const world = (over: Partial<TourWorld> = {}): TourWorld => ({
  rungs: [rung('')],
  selectedRungId: 'r0',
  running: [''],
  pendingReason: null,
  sw0: false,
  light0: false,
  testsRunning: false,
  ...over,
});
const since = (over: Partial<TourSince> = {}): TourSince => ({ sw0On: 0, sw0Off: 0, sw0AtStart: false, ...over });

describe('first rung tour', () => {
  it('walks plant → flip → rung → XIC → Switch_0 → OTE → Light_0 → apply → try → verify', () => {
    expect(FIRST_RUNG_STEPS.map((s) => s.id)).toEqual(['plant', 'flip', 'rung', 'xic', 'switch', 'ote', 'light', 'apply', 'try', 'verify']);
    expect(getMission(FIRST_RUNG_MISSION)?.sceneId).toBe('trainer');
    // every automatic step has a "Show me"; only the info step is manual
    for (const s of FIRST_RUNG_STEPS) if (s.id !== 'plant' && s.id !== 'apply') expect(s.showMe, s.id).toBeDefined();
    expect(FIRST_RUNG_STEPS.filter((s) => s.manual).map((s) => s.id)).toEqual(['plant']);
  });

  it('the info step never finishes by itself', () => {
    expect(tourStepView('plant', world({ sw0: true, light0: true }), since({ sw0On: 3 })).done).toBe(false);
  });

  it('flip: done when Switch 0 was switched on during the step — and says nothing happened when the lamp stays dark', () => {
    expect(tourStepView('flip', world(), since()).done).toBe(false);
    // already ON when the step started: a fresh OFF → ON is needed
    const on = tourStepView('flip', world({ sw0: true }), since({ sw0AtStart: true }));
    expect(on.done).toBe(false);
    expect(on.body).toMatch(/OFF and ON again/);
    const v = tourStepView('flip', world({ sw0: true }), since({ sw0On: 1 }));
    expect(v.done).toBe(true);
    expect(v.body).toMatch(/Nothing happens/);
    expect(tourStepView('flip', world({ sw0: true, light0: true }), since({ sw0On: 1 })).body).toMatch(/already drives it/);
  });

  it('flip with a kept program: the running rung decides the text, not the lamp one scan too early', () => {
    // the flip is counted at once, the lamp follows a sim step later: the first "done" view must already be right
    const kept = tourStepView('flip', world({ sw0: true, light0: false, running: ['XIC(Switch_0)OTE(Light_0);'] }), since({ sw0On: 1 }));
    expect(kept.done).toBe(true);
    expect(kept.body).toMatch(/already drives it/);
    expect(kept.body).not.toMatch(/Nothing happens/);
    // some other program that writes the lamp: never "no logic for Light_0"
    const other = tourStepView('flip', world({ sw0: true, running: ['XIO(Switch_0)OTE(Light_0);'] }), since({ sw0On: 1 }));
    expect(other.body).toMatch(/already writes `Light_0`/);
    expect(runningWritesLight0(['XIC(Switch_3)OTL(Local:2:O.Data.0);'])).toBe(true);
    expect(runningWritesLight0(['XIC(Light_0)OTE(Light_1);'])).toBe(false);
  });

  it('rung: the default selection does not count, the player’s click (or an instruction already there) does', () => {
    expect(tourStepView('rung', world(), since()).done).toBe(false);
    expect(tourStepView('rung', world(), since({ ladder: 1 })).done).toBe(true);
    expect(tourStepView('rung', world({ selectedRungId: null }), since({ ladder: 1 })).done).toBe(false);
    expect(tourStepView('rung', world({ rungs: [rung('XIC(Switch_0);')], selectedRungId: null }), since()).done).toBe(true);
  });

  it('XIC / Switch_0 / OTE / Light_0 follow the editor rungs, with a gentle correction for a wrong pick', () => {
    expect(tourStepView('xic', world(), since()).done).toBe(false);
    const xio = tourStepView('xic', world({ rungs: [rung('XIO(?);')] }), since());
    expect(xio.done).toBe(false);
    expect(xio.hint).toMatch(/XIO/);
    expect(tourStepView('xic', world({ rungs: [rung('XIC(?);')] }), since()).done).toBe(true);
    expect(tourStepView('switch', world({ rungs: [rung('XIC(?);')] }), since()).done).toBe(false);
    const wrong = tourStepView('switch', world({ rungs: [rung('XIC(Switch_1);')] }), since());
    expect(wrong.done).toBe(false);
    expect(wrong.hint).toMatch(/Switch_1/);
    expect(tourStepView('switch', world({ rungs: [rung('XIC(switch_0);')] }), since()).done).toBe(true);
    expect(tourStepView('switch', world({ rungs: [rung('XIC(Local:1:I.Data.0);')] }), since()).done).toBe(true);
    expect(tourStepView('ote', world({ rungs: [rung('XIC(Switch_0);')] }), since()).done).toBe(false);
    expect(tourStepView('ote', world({ rungs: [rung('XIC(Switch_0)OTE(?);')] }), since()).done).toBe(true);
    expect(tourStepView('light', world({ rungs: [rung('XIC(Switch_0)OTE(Light_1);')] }), since()).hint).toMatch(/Light_1/);
    expect(tourStepView('light', world({ rungs: [rung('XIC(Switch_0)OTE(Light_0);')] }), since()).done).toBe(true);
  });

  it('apply: done once the controller runs the rung (not while edits are pending)', () => {
    const rs = [rung('XIC(Switch_0)OTE(Light_0);')];
    const pending = tourStepView('apply', world({ rungs: rs, running: [''], pendingReason: 'errors' }), since());
    expect(pending.done).toBe(false);
    expect(pending.hint).toMatch(/verification error/);
    expect(tourStepView('apply', world({ rungs: rs, running: ['XIC(Switch_0)OTE(Light_0);'] }), since()).done).toBe(true);
    expect(runningHasFirstRung(['XIC(Local:1:I.Data.0)OTE(Local:2:O.Data.0);'])).toBe(true);
    expect(runningHasFirstRung(['XIC(Switch_1)OTE(Light_0);'])).toBe(false);
    expect(editorHasFirstRung(rs)).toBe(true);
  });

  it('apply with the rung already running when the step started: says so instead of "Applied online!"', () => {
    const rs = [rung('XIC(Switch_0)OTE(Light_0);')];
    const run = ['XIC(Switch_0)OTE(Light_0);'];
    const kept = tourStepView('apply', world({ rungs: rs, running: run }), since({ rungRunningAtStart: true }));
    expect(kept.done).toBe(true);
    expect(kept.body).toMatch(/Already running online/);
    expect(kept.body).not.toMatch(/Applied online!/);
    expect(tourStepView('apply', world({ rungs: rs, running: run }), since({ rungRunningAtStart: false })).body).toMatch(/Applied online!/);
  });

  it('try: needs a new flip ON with the lamp lit', () => {
    const run = ['XIC(Switch_0)OTE(Light_0);'];
    expect(tourStepView('try', world({ running: run, sw0: true, light0: true }), since({ sw0AtStart: true })).done).toBe(false);
    expect(tourStepView('try', world({ running: run, sw0: false }), since({ sw0Off: 1, sw0AtStart: true })).body).toMatch(/Flip \*\*Switch 0\*\* ON/);
    expect(tourStepView('try', world({ running: run, sw0: true, light0: true }), since({ sw0Off: 1, sw0On: 1 })).done).toBe(true);
    expect(tourStepView('try', world({ running: run, sw0: true, light0: false }), since({ sw0On: 1 })).hint).toMatch(/stays dark/);
  });

  it('verify: done when a test run starts', () => {
    expect(tourStepView('verify', world(), since()).done).toBe(false);
    expect(tourStepView('verify', world({ testsRunning: true }), since()).done).toBe(true);
  });

  it('starts by itself only on a first visit of 1-1', () => {
    expect(shouldAutoStartTour('1-1', undefined, false)).toBe(true);
    expect(shouldAutoStartTour('1-1', { 'first-rung': { status: 'skipped', at: 1 } }, false)).toBe(false);
    expect(shouldAutoStartTour('1-1', {}, true)).toBe(false);
    expect(shouldAutoStartTour('1-2', undefined, false)).toBe(false);
  });
});

describe('try it now: edited rungs', () => {
  it('reports new or changed rungs only', () => {
    expect(changedRungTexts(['', 'XIC(A)OTE(B);'], ['XIC(Switch_0)OTE(Light_0);', 'XIC(A)OTE(B);'])).toEqual(['XIC(Switch_0)OTE(Light_0);']);
    expect(changedRungTexts(['XIC(A)OTE(B);'], ['XIC(A)OTE(B);', ''])).toEqual([]);
  });
});

describe('live chip', () => {
  const m = getMission('1-1')!;
  const pass = [0, 1, 2].map((i) => ({ name: `t${i}`, passed: true, steps: [] }));
  const base = { enabled: true, fresh: true, checking: false };
  it('hidden before any check, while testing and for a graded program', () => {
    expect(liveChipState({ ...base, outcome: null }, false).kind).toBe('hidden');
    expect(liveChipState({ ...base, outcome: outcomeFor(m, 's', pass, [], false) }, true).kind).toBe('hidden');
    expect(liveChipState({ ...base, outcome: outcomeFor(m, 's', pass, [], true) }, false).kind).toBe('hidden');
    expect(liveChipState({ ...base, enabled: false, outcome: outcomeFor(m, 's', pass, [], false) }, false).kind).toBe('hidden');
  });
  it('nudges when every test passes live, counts otherwise, and never nudges on a stale check', () => {
    expect(liveChipState({ ...base, outcome: outcomeFor(m, 's', pass, [], false) }, false).kind).toBe('ready');
    expect(liveChipState({ ...base, fresh: false, outcome: outcomeFor(m, 's', pass, [], false) }, false)).toMatchObject({ kind: 'progress', met: 4, stale: true });
    const partial = [pass[0]!, { name: 't1', passed: false, failure: 'x', steps: [] }, pass[2]!];
    expect(liveChipState({ ...base, outcome: outcomeFor(m, 's', partial, [], false) }, false)).toMatchObject({ kind: 'progress', total: 4 });
    expect(liveChipState({ ...base, outcome: outcomeFor(m, 's', [], ['bad'], false) }, false).kind).toBe('blocked');
  });
});
