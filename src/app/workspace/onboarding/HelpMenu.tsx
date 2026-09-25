/**
 * The workspace '?' menu (mission bar): replay the guided first-rung tour, switch the live objective checks and the
 * "Try it now" tips on or off, open the instruction reference. A keyboard-friendly menu button (arrows, Home/End,
 * Escape returns focus to the button).
 */
import { BookOpen, Check, CircleHelp, GraduationCap } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { cn, Kbd } from '../../../ui';
import { routes } from '../../routes';
import { useAssist } from './assistStore';
import { FIRST_RUNG_MISSION, FIRST_RUNG_TOUR } from './firstRungTour';

function Item({ children, onSelect, checked, icon, testId }: { children: ReactNode; onSelect(): void; checked?: boolean; icon?: ReactNode; testId?: string }) {
  const checkable = checked !== undefined;
  return (
    <button
      type="button"
      role={checkable ? 'menuitemcheckbox' : 'menuitem'}
      {...(checkable ? { 'aria-checked': checked } : {})}
      tabIndex={-1}
      onClick={onSelect}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-slate-200 hover:bg-white/[0.07] focus-visible:bg-white/[0.09] focus-visible:outline-none"
      data-testid={testId}
    >
      <span className="flex w-4 shrink-0 justify-center text-slate-400">{checkable ? checked ? <Check size={14} className="text-emerald-400" /> : null : icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export function HelpMenu({ missionId }: { missionId: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [, navigate] = useLocation();
  const live = useAssist((s) => s.liveObjectives);
  const tryIt = useAssist((s) => s.tryIt);

  const items = (): HTMLElement[] => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onMenuKey = (e: ReactKeyboardEvent): void => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + d + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const startTour = (): void => {
    close(false);
    useAssist.getState().requestTour(FIRST_RUNG_TOUR);
    if (missionId !== FIRST_RUNG_MISSION) navigate(routes.mission(FIRST_RUNG_MISSION));
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Help: guided tour and learning aids"
        title="Help: guided tour and learning aids"
        className={cn(
          'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-300 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
          open && 'bg-white/10 text-white',
        )}
        data-testid="help-menu-button"
      >
        <CircleHelp size={17} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Help"
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 z-40 mt-1.5 w-64 rounded-lg border border-edge bg-panel-2 p-1 shadow-2xl shadow-black/60"
          data-testid="help-menu"
        >
          <Item icon={<GraduationCap size={14} />} onSelect={startTour} testId="help-tour">
            Guided tour: your first rung
            <span className="block text-[11px] text-slate-500">Mission 1-1, step by step</span>
          </Item>
          <div className="my-1 h-px bg-edge" role="separator" />
          <Item checked={live} onSelect={() => useAssist.getState().setLiveObjectives(!live)} testId="help-live">
            Live objective checks
            <span className="block text-[11px] text-slate-500">Quiet background tests while you edit</span>
          </Item>
          <Item checked={tryIt} onSelect={() => useAssist.getState().setTryIt(!tryIt)} testId="help-tryit">
            “Try it now” tips
            <span className="block text-[11px] text-slate-500">Which control to operate after an edit</span>
          </Item>
          <div className="my-1 h-px bg-edge" role="separator" />
          <Item
            icon={<BookOpen size={14} />}
            onSelect={() => {
              close(false);
              navigate(routes.reference());
            }}
          >
            Instruction reference
          </Item>
          <div className="px-2 pt-1 pb-0.5 text-[11px] text-slate-500">
            <Kbd>Ctrl ↵</Kbd> Verify &amp; Test
          </div>
        </div>
      )}
    </div>
  );
}
