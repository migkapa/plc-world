// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { StrictMode, useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDisposeOnUnmount } from './dispose';

class Res {
  disposed = 0;
  dispose() {
    this.disposed++;
  }
}

function Owner({ k, made, used }: { k: number; made: Res[]; used: Res[] }) {
  const r = useMemo(() => {
    const x = new Res();
    made.push(x);
    return x;
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  used.push(r);
  useDisposeOnUnmount(r);
  return null;
}

afterEach(() => vi.useRealTimers());

describe('useDisposeOnUnmount', () => {
  it('survives StrictMode’s simulated unmount / remount, disposes on the real unmount', () => {
    vi.useFakeTimers();
    const made: Res[] = [];
    const used: Res[] = [];
    const view = render(
      <StrictMode>
        <Owner k={1} made={made} used={used} />
      </StrictMode>,
    );
    act(() => vi.runAllTimers());
    // StrictMode may build the memo twice; the instance the component renders with must still be alive
    const kept = used[used.length - 1]!;
    expect(kept.disposed).toBe(0);
    view.unmount();
    act(() => vi.runAllTimers());
    expect(kept.disposed).toBe(1);
  });

  it('disposes the previous value when the memo is rebuilt', () => {
    vi.useFakeTimers();
    const made: Res[] = [];
    const used: Res[] = [];
    const view = render(<Owner k={1} made={made} used={used} />);
    const first = made[0]!;
    view.rerender(<Owner k={2} made={made} used={used} />);
    act(() => vi.runAllTimers());
    expect(first.disposed).toBe(1);
    expect(made[made.length - 1]!.disposed).toBe(0);
    view.unmount();
    act(() => vi.runAllTimers());
    expect(made[made.length - 1]!.disposed).toBe(1);
  });
});
