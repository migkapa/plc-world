/**
 * Side docks of the workspace (left: briefing / plant info, right: tests / plant monitor) can be hidden to give the 3D
 * twin and the ladder the whole width. Remembered per workspace page. The header toggles and the layout both read
 * this store; dragging a dock shut or open updates it too.
 */
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { cn } from '../../ui';

export type DockSide = 'left' | 'right';

interface DocksState {
  /** page id → hidden docks */
  hidden: Readonly<Record<string, Partial<Record<DockSide, boolean>>>>;
  setHidden(page: string, side: DockSide, hidden: boolean): void;
}

export const useDocks = create<DocksState>()(
  persist(
    (set) => ({
      hidden: {},
      setHidden: (page, side, hidden) =>
        set((s) => (s.hidden[page]?.[side] === hidden ? s : { hidden: { ...s.hidden, [page]: { ...s.hidden[page], [side]: hidden } } })),
    }),
    {
      name: 'plcw-docks-v1',
      version: 1,
      storage: createJSONStorage(() => {
        try {
          const ls = globalThis.localStorage;
          ls.getItem('x');
          return ls;
        } catch {
          const mem = new Map<string, string>();
          return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
        }
      }),
    },
  ),
);

export function useDockHidden(page: string, side: DockSide): boolean {
  return useDocks((s) => s.hidden[page]?.[side] === true);
}

/** Header buttons that show / hide the side docks of a workspace page. */
export function DockToggles({ page, left, right, className }: { page: string; left: string; right?: string; className?: string }) {
  const leftHidden = useDockHidden(page, 'left');
  const rightHidden = useDockHidden(page, 'right');
  const set = useDocks((s) => s.setHidden);
  const btn = 'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/5 hover:text-white';
  return (
    <div className={cn('hidden items-center lg:flex', className)} role="group" aria-label="Side panels">
      <button
        type="button"
        className={btn}
        onClick={() => set(page, 'left', !leftHidden)}
        aria-pressed={!leftHidden}
        aria-label={leftHidden ? `Show ${left}` : `Hide ${left}`}
        title={leftHidden ? `Show ${left}` : `Hide ${left}`}
      >
        {leftHidden ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      {right && (
        <button
          type="button"
          className={btn}
          onClick={() => set(page, 'right', !rightHidden)}
          aria-pressed={!rightHidden}
          aria-label={rightHidden ? `Show ${right}` : `Hide ${right}`}
          title={rightHidden ? `Show ${right}` : `Hide ${right}`}
        >
          {rightHidden ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
      )}
    </div>
  );
}
