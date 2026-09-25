import { describe, expect, it } from 'vitest';
import { clampPipWidth, cornerAfterKey, nearestCorner, onSplitViewRequest, PIP_MAX_W, PIP_MIN_W, pipOf, requestSplitView, useLayoutPrefs } from './layoutPrefs';
import { pipChipVars, pipRect } from './WorkspaceLayout';

describe('editing layout prefs', () => {
  it('snaps a dragged picture-in-picture to the nearest corner', () => {
    expect(nearestCorner(10, 10, 800, 600)).toBe('tl');
    expect(nearestCorner(790, 10, 800, 600)).toBe('tr');
    expect(nearestCorner(10, 590, 800, 600)).toBe('bl');
    expect(nearestCorner(700, 400, 800, 600)).toBe('br');
  });

  it('moves between corners with the arrow keys', () => {
    expect(cornerAfterKey('br', 'ArrowUp')).toBe('tr');
    expect(cornerAfterKey('tr', 'ArrowLeft')).toBe('tl');
    expect(cornerAfterKey('tl', 'ArrowDown')).toBe('bl');
    expect(cornerAfterKey('bl', 'ArrowRight')).toBe('br');
    expect(cornerAfterKey('bl', 'Enter')).toBe('bl');
  });

  it('clamps the width and the stored values', () => {
    expect(clampPipWidth(10)).toBe(PIP_MIN_W);
    expect(clampPipWidth(5000)).toBe(PIP_MAX_W);
    expect(clampPipWidth(Number.NaN)).toBeGreaterThanOrEqual(PIP_MIN_W);
    useLayoutPrefs.getState().setPipWidth(9999);
    expect(useLayoutPrefs.getState().pipWidth).toBe(PIP_MAX_W);
    useLayoutPrefs.getState().setPipCorner('xx' as never);
    expect(useLayoutPrefs.getState().pipCorner).toBe('br');
  });

  it('places the picture-in-picture inside the ladder area', () => {
    const area = { left: 300, top: 200, width: 800, height: 600 };
    const br = pipRect(area, 'br', 340);
    expect(br.width).toBe(340);
    expect(br.left + br.width).toBeLessThanOrEqual(area.left + area.width);
    expect(br.top + br.height).toBeLessThanOrEqual(area.top + area.height);
    expect(br.top).toBeGreaterThan(area.top + area.height / 2);
    const tl = pipRect(area, 'tl', 340);
    expect(tl.left).toBeGreaterThanOrEqual(area.left);
    expect(tl.top).toBeGreaterThanOrEqual(area.top);
    // a narrow ladder shrinks it instead of overflowing
    const small = pipRect({ left: 0, top: 0, width: 300, height: 200 }, 'br', 600);
    expect(small.width).toBeLessThanOrEqual(300);
    expect(small.height).toBeLessThanOrEqual(200);
  });

  it('keeps the picture-in-picture choice per page (a mission PiP never hides the sandbox pad)', () => {
    const st = useLayoutPrefs.getState();
    st.setTwinPip(true, 'mission');
    st.setAutoPip(true, 'mission');
    expect(pipOf(useLayoutPrefs.getState(), 'mission')).toEqual({ twinPip: true, autoPip: true });
    expect(pipOf(useLayoutPrefs.getState(), 'sandbox')).toEqual({ twinPip: false, autoPip: false });
    st.setTwinPip(true, 'sandbox');
    st.setTwinPip(false, 'mission');
    expect(pipOf(useLayoutPrefs.getState(), 'sandbox').twinPip).toBe(true);
    expect(pipOf(useLayoutPrefs.getState(), 'mission')).toEqual({ twinPip: false, autoPip: true });
    // no page named: the mission page
    st.setAutoPip(false);
    expect(pipOf(useLayoutPrefs.getState()).autoPip).toBe(false);
  });

  it('migrates the old single choice to the mission page only', () => {
    const merge = useLayoutPrefs.persist.getOptions().merge!;
    const cur = useLayoutPrefs.getState();
    const old = merge({ twinPip: true, autoPip: true, pipCorner: 'tl', pipWidth: 300, compactLabels: true }, cur);
    expect(old.pages).toEqual({ mission: { twinPip: true, autoPip: true } });
    expect(old.pipCorner).toBe('tl');
    const now = merge({ pages: { sandbox: { twinPip: true }, bad: 3 }, pipCorner: 'zz' }, cur);
    expect(now.pages).toEqual({ sandbox: { twinPip: true, autoPip: false } });
    expect(now.pipCorner).toBe(cur.pipCorner);
  });

  it('answers split-view requests while subscribed', () => {
    let n = 0;
    const off = onSplitViewRequest(() => n++);
    requestSplitView();
    off();
    requestSplitView();
    expect(n).toBe(1);
  });

  it('moves the "Edits applied online" chip out from under a bottom-right PiP', () => {
    const area = { left: 300, top: 200, width: 800, height: 600 };
    const br = pipRect(area, 'br', 340);
    const vars = pipChipVars(br, 'br', area);
    // left of the PiP: its right offset clears the PiP's left edge
    const right = Number.parseFloat(vars['--pip-chip-right'] ?? 'NaN');
    expect(area.left + area.width - right).toBeLessThan(br.left);
    // other corners: default place
    expect(pipChipVars(pipRect(area, 'bl', 340), 'bl', area)).toEqual({});
    expect(pipChipVars(null, 'br', area)).toEqual({});
    // no room left of it: above it
    const narrow = { left: 0, top: 0, width: 420, height: 500 };
    expect(pipChipVars(pipRect(narrow, 'br', 340), 'br', narrow)['--pip-chip-bottom']).toMatch(/^calc\(2\.25rem \+ \d+px\)$/);
  });
});
