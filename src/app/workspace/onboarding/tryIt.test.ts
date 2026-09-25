/**
 * "Try it now" suggestions: plant probing (control → input alias) and the control picked for an edited rung.
 */
import { describe, expect, it } from 'vitest';
import { getMission, MISSIONS } from '../../../game/missions';
import { SCENE_LOGICS } from '../../../sim/scenes';
import { activeValue, controlInputs, operandNames, suggestTryIt, testControlsInOrder, verbFor } from './tryIt';

const trainer = SCENE_LOGICS.trainer!;
const motor = SCENE_LOGICS['motor-station']!;

describe('controlInputs', () => {
  it('finds the input alias every operator control drives', () => {
    const m = controlInputs(trainer);
    expect(m.get('sw0')).toEqual(['Switch_0']);
    expect(m.get('sw7')).toEqual(['Switch_7']);
    expect(m.get('pb_red')).toEqual(['PB_Red']); // N.C.: reads 1 at rest, 0 pressed — still a change
    expect(m.get('pot1')).toEqual(['Pot_1']);
    const ms = controlInputs(motor);
    expect(ms.get('start')).toEqual(['Start_PB']);
    expect(ms.get('estop')).toEqual(['EStop_OK']);
  });

  it('is cached per scene and skips fault injections', () => {
    expect(controlInputs(trainer)).toBe(controlInputs(trainer));
    for (const c of motor.controls.filter((c) => c.type === 'fault')) expect(controlInputs(motor).has(c.id)).toBe(false);
  });
});

describe('suggestTryIt', () => {
  const m11 = getMission('1-1')!;
  it('suggests the switch the edited rung reads', () => {
    expect(suggestTryIt(m11, trainer, ['XIC(Switch_0)OTE(Light_0);'])).toMatchObject({ controlId: 'sw0', text: 'Flip Switch 0 to try your rung', matched: true });
    // a rung on another switch: that switch, if the mission's tests operate it
    expect(suggestTryIt(m11, trainer, ['XIC(Switch_3)OTE(Light_0);'])?.controlId).toBe('sw3');
  });

  it('falls back to the first control the tests operate when the rung reads no operator input', () => {
    const s = suggestTryIt(m11, trainer, ['XIC(Light_1)OTE(Light_0);']);
    expect(s).toMatchObject({ controlId: 'sw0', matched: false, text: 'Flip Switch 0 and watch your rung' });
  });

  it('an AND of operator inputs names every one of them (operating one alone shows nothing)', () => {
    const m13 = getMission('1-3')!;
    const s = suggestTryIt(m13, trainer, ['XIC(Switch_2)XIC(Switch_3)OTE(Light_4);']);
    expect(s).toMatchObject({ controlId: 'sw2', controlIds: ['sw2', 'sw3'], text: 'Flip Switch 2 and Switch 3 to try your rung', matched: true });
    // a switch already ON is not asked for again
    const on = suggestTryIt(m13, trainer, ['XIC(Switch_2)XIC(Switch_3)OTE(Light_4);'], (id) => id === 'sw2');
    expect(on).toMatchObject({ controlId: 'sw3', controlIds: ['sw3'], text: 'Flip Switch 3 to try your rung' });
    // both already ON: still a suggestion (the first one), the rung is lit — flipping shows it go dark
    expect(suggestTryIt(m13, trainer, ['XIC(Switch_2)XIC(Switch_3)OTE(Light_4);'], () => true)?.controlIds).toEqual(['sw2']);
    // two push buttons in series: held together
    expect(suggestTryIt(getMission('1-4')!, trainer, ['XIC(PB_Black_1)XIC(PB_Black_2)OTE(Buzzer);'])).toMatchObject({
      controlIds: ['pb_black1', 'pb_black2'],
      text: 'Hold Black PB 1 and Black PB 2 together to try your rung — one alone does nothing (series = AND)',
    });
  });

  it('a series contact that is already true at rest is not asked for (N.C. Stop, XIO on an N.O. input)', () => {
    const m21 = getMission('2-1')!;
    expect(suggestTryIt(m21, motor, ['XIC(Start_PB)XIC(Stop_PB)OTE(Motor_Starter);'])).toMatchObject({ controlId: 'start', controlIds: ['start'], text: 'Press Start to try your rung', key: 'S' });
    // N.C. red button read with XIO: pressing it makes the rung true
    expect(suggestTryIt(getMission('1-5')!, trainer, ['XIO(PB_Red)OTE(Light_1);'])).toMatchObject({ controlId: 'pb_red', controlIds: ['pb_red'] });
    // branches (OR / seal-in) are not required conditions: back to test order
    expect(suggestTryIt(m21, motor, ['BST XIC(Start_PB) NXB XIC(Motor_Starter) BND XIC(Stop_PB) OTE(Motor_Starter);'])?.controlId).toBe('start');
  });

  it('nothing for an empty rung', () => {
    expect(suggestTryIt(m11, trainer, [''])).toBeNull();
    expect(suggestTryIt(m11, trainer, [])).toBeNull();
  });

  it('uses the right verb per control type', () => {
    expect(verbFor({ type: 'momentary', id: 'start', label: 'Start' })).toBe('Press');
    expect(verbFor({ type: 'maintained', id: 'estop', label: 'E-stop' })).toBe('Push');
    expect(verbFor({ type: 'selector', id: 'hoa', label: 'H-O-A' })).toBe('Turn');
    expect(verbFor({ type: 'analog', id: 'pot1', label: 'Pot 1' })).toBe('Move');
    expect(activeValue({ id: 'x', label: 'x', type: 'selector', default: 2, positions: ['a', 'b', 'c'] })).toBe(0);
    expect(activeValue({ id: 'x', label: 'x', type: 'analog', default: 0, range: [0, 100] })).toBe(100);
  });

  it('every mission whose tests operate a control gets a suggestion for its solution', () => {
    for (const m of MISSIONS) {
      const scene = SCENE_LOGICS[m.sceneId]!;
      const s = suggestTryIt(m, scene, m.solution.rungs);
      if (testControlsInOrder(m).some((id) => scene.controls.some((c) => c.id === id && c.type !== 'fault'))) expect(s, m.id).not.toBeNull();
    }
  });

  it('operandNames reads base tag names', () => {
    expect([...operandNames(['XIC(T1.DN)MOV(Arr[2],Dest)TON(Timer_1,5000,0);'])]).toEqual(['t1', 'arr', 'dest', 'timer_1']);
  });
});
