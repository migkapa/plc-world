/**
 * Editing layout of the 3D twin on desktop (see WorkspaceLayout): split view (twin above the ladder, draggable
 * splitter) or picture-in-picture (the twin shrinks into a corner of the ladder, still live; the ladder gets the whole
 * center column). The choice — and the "auto" option: PiP after the ladder has had the keyboard focus for 2 s,
 * split again when the focus leaves it — is remembered (layoutPrefs.ts).
 *
 *  - TwinLayoutContext: provided by the desktop WorkspaceLayout (null on phones / outside a workspace).
 *  - <TwinLayoutButton>: the twin toolbar's PiP toggle + small layout menu.
 *  - <PipChrome>: the picture-in-picture's frame: click (or Enter) restores the split view, drag moves it to another
 *    corner (arrow keys too), the inner-corner grip resizes it.
 */
import { Check, ChevronDown, MoveDiagonal2, PictureInPicture2, Rows2, Timer } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../../ui';
import { AUTO_PIP_DELAY_MS, clampPipWidth, cornerAfterKey, nearestCorner, type PipCorner } from './layoutPrefs';

export interface TwinLayoutApi {
  /** The twin is the picture-in-picture right now. */
  pip: boolean;
  /** The player's own choice (PiP pinned on). */
  manualPip: boolean;
  /** Shrink automatically while the ladder is being edited. */
  autoPip: boolean;
  /** Pin PiP on / go back to the split view (also ends an automatic PiP). */
  setPip(on: boolean): void;
  setAutoPip(on: boolean): void;
}

export const TwinLayoutContext = createContext<TwinLayoutApi | null>(null);

export function useTwinLayout(): TwinLayoutApi | null {
  return useContext(TwinLayoutContext);
}

// ---------------------------------------------------------------------------
// Toolbar toggle + menu
// ---------------------------------------------------------------------------

export function TwinLayoutButton() {
  const api = useTwinLayout();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  if (!api) return null;
  const close = (focusTrigger: boolean): void => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n]?.focus();
    } else if (e.key === 'Tab') close(false);
  };
  const item = 'flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-slate-200 outline-none hover:bg-white/10 focus-visible:bg-white/10';
  return (
    // z-20: the blurred backdrop makes this a stacking context; its menu must stay above the operator pad
    <div ref={rootRef} className="pointer-events-auto relative z-20 flex h-7 items-stretch rounded-lg border border-white/10 bg-black/50 backdrop-blur" data-testid="twin-layout">
      <button
        type="button"
        onClick={() => api.setPip(!api.pip)}
        aria-pressed={api.pip}
        aria-label="Picture-in-picture 3D view"
        title="Picture-in-picture: shrink the 3D view into a corner of the ladder (still live) so the rungs get the height — click the small view to bring it back"
        className="flex cursor-pointer items-center gap-1.5 rounded-l-lg px-2 text-xs font-medium text-slate-200 transition-colors hover:bg-black/70 hover:text-white"
        data-testid="twin-pip-toggle"
      >
        <PictureInPicture2 size={14} />
        <span className="hidden 2xl:inline">PiP</span>
      </button>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Layout options"
        title="Layout options (split view, picture-in-picture, auto)"
        className={cn('flex cursor-pointer items-center rounded-r-lg border-l border-white/10 px-1 text-slate-300 hover:bg-black/70 hover:text-white', api.autoPip && 'text-cyan-200')}
        data-testid="twin-layout-menu"
      >
        {api.autoPip && <Timer size={11} className="mr-0.5" />}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="3D view layout while editing"
          onKeyDown={onMenuKey}
          className="absolute top-8 right-0 z-30 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-edge bg-panel-2/95 p-1 shadow-2xl backdrop-blur"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!api.manualPip}
            className={item}
            onClick={() => {
              api.setPip(false);
              close(true);
            }}
          >
            <Rows2 size={14} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="flex-1">
              <span className="font-semibold">Split view</span>
              <span className="block text-[11px] text-slate-400">3D above the ladder (drag the splitter)</span>
            </span>
            {!api.manualPip && <Check size={13} className="mt-0.5 text-emerald-400" />}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={api.manualPip}
            className={item}
            onClick={() => {
              api.setPip(true);
              close(true);
            }}
          >
            <PictureInPicture2 size={14} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="flex-1">
              <span className="font-semibold">Picture-in-picture</span>
              <span className="block text-[11px] text-slate-400">Ladder gets the full height, live 3D in a corner</span>
            </span>
            {api.manualPip && <Check size={13} className="mt-0.5 text-emerald-400" />}
          </button>
          <div className="my-1 h-px bg-edge" />
          <button type="button" role="menuitemcheckbox" aria-checked={api.autoPip} className={item} onClick={() => api.setAutoPip(!api.autoPip)} data-testid="twin-auto-pip">
            <span className={cn('mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border', api.autoPip ? 'border-cyan-400 bg-cyan-500/30' : 'border-slate-500')}>
              {api.autoPip && <Check size={11} className="text-cyan-100" />}
            </span>
            <span className="flex-1">
              <span className="font-semibold">Auto</span>
              <span className="block text-[11px] text-slate-400">PiP after {AUTO_PIP_DELAY_MS / 1000} s in the ladder, split when you leave it</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Picture-in-picture frame
// ---------------------------------------------------------------------------

export interface PipChromeProps {
  corner: PipCorner;
  width: number;
  /** The area the picture-in-picture lives in (viewport px): corners snap to it. */
  area: { left: number; top: number; width: number; height: number };
  /** Live drag position (viewport px of the top-left corner) while moving; null otherwise. */
  onMove(pos: { left: number; top: number } | null): void;
  onCorner(c: PipCorner): void;
  onWidth(w: number, commit: boolean): void;
  onRestore(): void;
  auto: boolean;
}

/** Pointer travel (px) below which a press on the picture-in-picture is a click (restore), not a drag. */
const DRAG_SLOP = 5;

/**
 * Covers the picture-in-picture (the live 3D view underneath is look-only there): a click restores the split view,
 * a drag moves it (snapping to the nearest corner on release), the grip on the inner corner resizes it.
 */
export function PipChrome({ corner, width, area, onMove, onCorner, onWidth, onRestore, auto }: PipChromeProps) {
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean; id: number } | null>(null);
  const size = useRef<{ x: number; w: number; id: number } | null>(null);
  const shieldRef = useRef<HTMLDivElement>(null);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const r = shieldRef.current?.parentElement?.getBoundingClientRect();
    if (!r) return;
    drag.current = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    d.moved = true;
    onMove({ left: d.left + dx, top: d.top + dy });
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) {
      onRestore();
      return;
    }
    const r = shieldRef.current?.parentElement?.getBoundingClientRect();
    onMove(null);
    if (r) onCorner(nearestCorner(r.left + r.width / 2 - area.left, r.top + r.height / 2 - area.top, area.width, area.height));
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRestore();
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      onCorner(cornerAfterKey(corner, e.key));
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      onWidth(width + (e.key === '-' ? -40 : 40), true);
    }
  };

  // resize grip on the inner corner (towards the ladder's centre)
  const gripLeft = corner[1] === 'r';
  const gripTop = corner[0] === 'b';
  const sign = gripLeft ? -1 : 1;
  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    size.current = { x: e.clientX, w: width, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = size.current;
    if (!s || s.id !== e.pointerId) return;
    onWidth(clampPipWidth(s.w + sign * (e.clientX - s.x)), false);
  };
  const onGripUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = size.current;
    if (!s || s.id !== e.pointerId) return;
    size.current = null;
    e.stopPropagation();
    onWidth(clampPipWidth(s.w + sign * (e.clientX - s.x)), true);
  };

  return (
    <>
      <div
        ref={shieldRef}
        role="button"
        tabIndex={0}
        aria-label="3D view, picture-in-picture. Enter: back to the split view. Arrow keys: move to another corner. Plus / minus: resize."
        title="Click: back to the split view · drag: move to another corner"
        onPointerDown={onDown}
        onPointerMove={onPointerMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          onMove(null);
        }}
        onKeyDown={onKey}
        className="group/pip absolute inset-0 z-20 cursor-pointer touch-none rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        data-testid="twin-pip"
      >
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 flex items-center gap-1.5 from-black/70 to-transparent px-2 text-[10.5px] font-semibold text-slate-200',
            // the label sits on the edge away from the resize grip
            gripTop ? 'bottom-0 bg-gradient-to-t pt-3 pb-1' : 'top-0 bg-gradient-to-b pt-1 pb-3',
            gripLeft ? 'justify-end' : 'justify-start',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse" />
          3D view · live
          {auto && <span className="rounded bg-cyan-500/20 px-1 text-[9.5px] text-cyan-200">auto</span>}
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/0 opacity-0 transition-opacity group-hover/pip:bg-black/35 group-hover/pip:opacity-100 group-focus-visible/pip:bg-black/35 group-focus-visible/pip:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full border border-white/20 bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white">
            <Rows2 size={13} /> Back to split view
          </span>
        </div>
      </div>
      <div
        aria-hidden
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        className={cn(
          'absolute z-30 flex h-5 w-5 touch-none items-center justify-center rounded-md bg-black/60 text-slate-300 hover:bg-black/80 hover:text-white',
          gripLeft ? 'left-1' : 'right-1',
          gripTop ? 'top-1' : 'bottom-1',
          gripLeft === gripTop ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
        )}
        title="Drag to resize"
        data-testid="twin-pip-resize"
      >
        <MoveDiagonal2 size={12} className={gripLeft === gripTop ? '' : 'rotate-90'} />
      </div>
    </>
  );
}
