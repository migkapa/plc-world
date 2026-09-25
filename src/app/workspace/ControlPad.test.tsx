// @vitest-environment jsdom
/**
 * Mission-aware operator pad: the controls a mission uses come first, the plant's others wait behind a visible
 * "More (N)" chip (QA: Black PB 1/2 of mission 1-4 hid in a clipped third row; HOA sat at OFF in 2-1).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getMission } from '../../game/missions';
import { createController } from '../../plc/controller';
import { createProjectForScene } from '../../sim/project';
import { createSimRuntime } from '../../sim/runtime';
import { SCENE_LOGICS } from '../../sim/scenes';
import { ControlPad, splitPadControls } from './ControlPad';
import { controlsUsedByTests } from './stepText';

afterEach(cleanup);

const padOf = (sceneId: string) => SCENE_LOGICS[sceneId]!.controls.filter((c) => c.type !== 'fault');
const split = (missionId: string) => {
  const m = getMission(missionId)!;
  return splitPadControls(padOf(m.sceneId), m.controls ?? controlsUsedByTests(m));
};

describe('splitPadControls', () => {
  it('1-4 and 1-7: the black push buttons are primary, never behind a clipped row', () => {
    expect(split('1-4').primary.map((c) => c.id)).toEqual(['pb_black1', 'pb_black2']);
    const p17 = split('1-7').primary.map((c) => c.id);
    expect(p17).toEqual(expect.arrayContaining(['sw0', 'sw1', 'pb_green', 'pb_red', 'pb_black1', 'pb_black2']));
    expect(p17.length).toBeLessThanOrEqual(8);
  });

  it('2-1: Start and Stop only; Hand-Off-Auto, Jog and Remote run wait under More', () => {
    const s = split('2-1');
    expect(s.primary.map((c) => c.id)).toEqual(['start', 'stop']);
    expect(s.more.map((c) => c.id)).toEqual(expect.arrayContaining(['hoa', 'jog', 'remote_run']));
    // 2-6 teaches the selector: it is primary there
    expect(split('2-6').primary.map((c) => c.id)).toContain('hoa');
  });

  it('keeps the plant order and falls back to everything without a list', () => {
    const all = padOf('trainer');
    expect(splitPadControls(all, undefined)).toEqual({ primary: all, more: [] });
    expect(splitPadControls(all, new Set(['nope']))).toEqual({ primary: all, more: [] });
    expect(splitPadControls(all, ['pb_red', 'sw3']).primary.map((c) => c.id)).toEqual(['sw3', 'pb_red']);
  });

  it('every mission shows at most 10 primary controls', () => {
    for (const id of ['1-1', '1-4', '1-7', '2-1', '2-7', '3-4', '4-5', '5-5', '6-2', '7-6']) expect(split(id).primary.length, id).toBeLessThanOrEqual(10);
  });
});

describe('ControlPad More chip', () => {
  it('reveals the other controls on demand, in both pad layouts', () => {
    const scene = SCENE_LOGICS.trainer!;
    const runtime = createSimRuntime(createController(createProjectForScene(scene, [''])), scene);
    const { primary, more } = split('1-4');
    for (const compact of [false, true]) {
      const view = render(<ControlPad runtime={runtime} controls={primary} moreControls={more} compact={compact} />);
      expect(view.container.querySelector('[data-control="pb_black1"]')).not.toBeNull();
      expect(view.container.querySelector('[data-control="sw0"]')).toBeNull();
      const chip = screen.getByTestId('pad-more');
      expect(chip.textContent).toContain(`More (${more.length})`);
      fireEvent.click(chip);
      expect(view.container.querySelector('[data-control="sw0"]')).not.toBeNull();
      expect(screen.getByTestId('pad-more').textContent).toContain('Less');
      view.unmount();
    }
  });
});
