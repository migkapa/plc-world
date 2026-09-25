/**
 * Live objectives checker (headless): debounce, dedupe, pause while a graded run is active, stale runs cancelled,
 * graded results adopted, and the objective states it reports for right / partial / broken programs.
 */
import { describe, expect, it } from 'vitest';
import { getMission } from '../../../game/missions';
import { buildMissionProject } from '../../../game/validation';
import { createLiveChecker, outcomeFor, programSig, type LiveOutcome, type LiveRequest } from './liveObjectives';

const m11 = getMission('1-1')!;

/** Manual clock: timers and slices only run when the test says so. */
function harness(debounceMs = 800) {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const outcomes: LiveOutcome[] = [];
  const busy: boolean[] = [];
  let builds = 0;
  const checker = createLiveChecker(m11, {
    debounceMs,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    schedule: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: t + Math.max(1, ms), fn }); // each slice takes 1 ms of the manual clock
      return id;
    },
    now: () => 0, // every slice runs to its budget check once (advance 1 s of simulated time)
    onBusy: (b) => busy.push(b),
    onResult: (o) => outcomes.push(o),
  });
  const req = (rungs: string[]): LiveRequest => ({
    sig: programSig({ rungs, tags: [] }),
    build: () => {
      builds++;
      return buildMissionProject(m11, rungs);
    },
  });
  /** Advance the manual clock by `ms`, running due timers in order (and the promise jobs they queue). */
  const advance = async (ms: number): Promise<void> => {
    const end = t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
      if (!next) break;
      timers.delete(next[0]);
      t = Math.max(t, next[1].at);
      next[1].fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    t = end;
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { checker, req, advance, outcomes, busy, builds: () => builds };
}

const RIGHT = ['XIC(Switch_0)OTE(Light_0);'];
const WRONG = ['XIC(Switch_1)OTE(Light_0);'];

describe('createLiveChecker', () => {
  it('waits for the debounce, then reports the objectives the program satisfies (not graded)', async () => {
    const h = harness();
    h.checker.request(h.req(RIGHT));
    await h.advance(799);
    expect(h.outcomes).toHaveLength(0);
    expect(h.builds()).toBe(0);
    await h.advance(60_000);
    expect(h.outcomes).toHaveLength(1);
    const o = h.outcomes[0]!;
    expect(o.graded).toBe(false);
    expect(o.allPassed).toBe(true);
    expect(o.states).toEqual(['passed', 'passed', 'passed', 'passed']);
    expect(h.busy).toEqual([true, false]);
  });

  it('a partial program ticks only what it proves', async () => {
    const h = harness();
    h.checker.request(h.req(WRONG));
    await h.advance(60_000);
    const o = h.outcomes[0]!;
    expect(o.allPassed).toBe(false);
    // dark while Switch_0 is OFF: satisfied by any program that leaves the lamp alone
    expect(o.states[0]).toBe('passed');
    expect(o.states[1]).not.toBe('passed');
  });

  it('only the last of several quick edits runs, and an unchanged program is not re-run', async () => {
    const h = harness();
    h.checker.request(h.req(WRONG));
    await h.advance(300);
    h.checker.request(h.req(['XIC(Switch_0)OTE(Light_1);']));
    await h.advance(300);
    h.checker.request(h.req(RIGHT));
    await h.advance(60_000);
    expect(h.builds()).toBe(1);
    expect(h.outcomes.map((o) => o.allPassed)).toEqual([true]);
    h.checker.request(h.req(RIGHT));
    await h.advance(60_000);
    expect(h.builds()).toBe(1);
    expect(h.outcomes).toHaveLength(1);
  });

  it('pauses while a graded run is active and resumes (re-queuing a cancelled live run) afterwards', async () => {
    const h = harness();
    h.checker.request(h.req(RIGHT));
    await h.advance(803); // the live run has started (verified, first slices done)
    expect(h.checker.busy).toBe(true);
    h.checker.setPaused(true);
    expect(h.checker.busy).toBe(false);
    await h.advance(60_000);
    expect(h.outcomes).toHaveLength(0);
    h.checker.setPaused(false);
    await h.advance(60_000);
    expect(h.outcomes).toHaveLength(1);
    expect(h.outcomes[0]!.allPassed).toBe(true);
  });

  it('adopts graded results (seed) so the same program is not re-run', async () => {
    const h = harness();
    const sig = programSig({ rungs: RIGHT, tags: [] });
    const graded = outcomeFor(m11, sig, [], ['x'], true);
    expect(graded.allPassed).toBe(false);
    h.checker.seed(sig, [{ name: 'a', passed: true, steps: [] }, { name: 'b', passed: true, steps: [] }, { name: 'c', passed: true, steps: [] }]);
    expect(h.outcomes[0]).toMatchObject({ graded: true, allPassed: true });
    h.checker.request(h.req(RIGHT));
    await h.advance(60_000);
    expect(h.builds()).toBe(0);
  });

  it('going back to the program already reported cancels a run of a newer one', async () => {
    const h = harness();
    h.checker.request(h.req(RIGHT));
    await h.advance(60_000);
    h.checker.request(h.req(WRONG));
    await h.advance(803); // WRONG is running
    expect(h.checker.busy).toBe(true);
    h.checker.request(h.req(RIGHT));
    await h.advance(60_000);
    expect(h.checker.busy).toBe(false);
    expect(h.outcomes.map((o) => o.allPassed)).toEqual([true]);
  });

  it('verification errors produce no ticks', async () => {
    const h = harness();
    h.checker.request(h.req(['XIC(Nope_Tag)OTE(Light_0);']));
    await h.advance(60_000);
    expect(h.outcomes[0]!.verifyErrors.length).toBeGreaterThan(0);
    expect(h.outcomes[0]!.states.every((s) => s === 'pending')).toBe(true);
  });

  it('dispose stops everything', async () => {
    const h = harness();
    h.checker.request(h.req(RIGHT));
    h.checker.dispose();
    await h.advance(60_000);
    expect(h.outcomes).toHaveLength(0);
  });
});
