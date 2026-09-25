/**
 * The 3D digital twin of a plant: SceneCanvas with the scene definition's cameras & environment, and a
 * DOM overlay (camera presets, "Show I/O tags", speed / pause / reset, instructor faults, operator
 * control pad). Falls back to a clean panel when the scene has no 3D view yet or WebGL fails — the
 * simulation keeps running either way (it is ticked by the page, not by the view).
 */
import { Box, Cctv, Eye, EyeOff, Loader2, Maximize2, Minimize2, Wrench } from 'lucide-react';
import { Component, memo, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useGame } from '../../game/store';
import { useSceneOverlay } from '../../sim/scenes/overlay';
import type { ControlDef, SceneDefinition, SceneLogic, SimRuntime } from '../../sim/types';
import { SceneCanvas, useStageCamera } from '../../twin/Stage';
import { cn } from '../../ui';
import { ControlPad, FaultList } from './ControlPad';
import { useControllerTick, useRuntimeValue } from './hooks';

// ---------------------------------------------------------------------------
// Error boundary & WebGL probe
// ---------------------------------------------------------------------------

class ViewBoundary extends Component<{ fallback: (error: Error) => ReactNode; children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[twin] 3D view failed', error, info.componentStack);
  }
  override componentDidUpdate(prev: { resetKey?: unknown }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

let webglOk: boolean | undefined;
function hasWebGL(): boolean {
  if (webglOk !== undefined) return webglOk;
  try {
    const c = document.createElement('canvas');
    webglOk = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

// ---------------------------------------------------------------------------
// Overlay pieces
// ---------------------------------------------------------------------------

function CameraBar() {
  const cam = useStageCamera();
  if (cam.presets.length < 2) return null;
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-black/50 p-0.5 backdrop-blur" role="group" aria-label="Camera presets">
      <Cctv size={13} className="mx-1 text-slate-400" />
      {cam.presets.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => cam.goTo(p.id)}
          className={cn(
            'h-6 cursor-pointer rounded-md px-2 text-[11px] font-semibold whitespace-nowrap',
            cam.current === p.id ? 'bg-white/90 text-slate-900' : 'text-slate-200 hover:bg-white/10',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function ShowTagsToggle() {
  const show = useSceneOverlay((s) => s.showTags);
  const toggle = useSceneOverlay((s) => s.toggleShowTags);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={show}
      title="Pin the I/O tag chips (alias · address · live value) on every device"
      className={cn(
        'pointer-events-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold backdrop-blur',
        show ? 'border-emerald-400/50 bg-emerald-500/25 text-emerald-100' : 'border-white/10 bg-black/50 text-slate-200 hover:bg-white/10',
      )}
    >
      {show ? <Eye size={13} /> : <EyeOff size={13} />}
      I/O tags
    </button>
  );
}

function InstructorMenu({ runtime, controls }: { runtime: SimRuntime; controls: ReadonlyArray<ControlDef> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  const active = useRuntimeValue(runtime, () => controls.filter((c) => runtime.getControl(c.id) === true).length);
  if (controls.length === 0) return null;
  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Instructor: inject field faults (failed sensors, overloads…)"
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[11px] font-semibold backdrop-blur',
          active > 0 ? 'border-amber-400/60 bg-amber-500/25 text-amber-100' : 'border-white/10 bg-black/50 text-slate-200 hover:bg-white/10',
        )}
      >
        <Wrench size={13} /> Instructor{active > 0 ? ` · ${active} fault${active === 1 ? '' : 's'}` : ''}
      </button>
      {open && (
        <div className="absolute top-8 right-0 z-20 w-72 rounded-xl border border-edge bg-panel-2/95 p-3 shadow-2xl backdrop-blur">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Fault injection</div>
          <FaultList runtime={runtime} controls={controls} />
        </div>
      )}
    </div>
  );
}

function ControllerChip({ runtime }: { runtime: SimRuntime }) {
  useControllerTick(runtime.controller);
  const st = runtime.controller.getStatus();
  const faulted = st.mode === 'FAULTED';
  const text = { RUN: 'RUN', REM_RUN: 'REM RUN', PROG: 'PROG', REM_PROG: 'REM PROG', FAULTED: 'FAULTED' }[st.mode];
  return (
    <span
      className={cn(
        'pointer-events-auto flex h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[10.5px] font-bold backdrop-blur',
        faulted ? 'border-red-400/60 bg-red-600/40 text-red-100' : st.running ? 'border-emerald-400/40 bg-emerald-600/25 text-emerald-100' : 'border-sky-400/40 bg-sky-700/30 text-sky-100',
      )}
      title={st.displayText}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', faulted ? 'animate-pulse bg-red-400' : st.running ? 'bg-emerald-400' : 'bg-sky-300')} />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Twin panel
// ---------------------------------------------------------------------------

export interface TwinPanelProps {
  scene: SceneLogic<unknown>;
  definition: SceneDefinition<unknown> | undefined;
  /** Runtime whose state is rendered (the live plant, or a test replay). */
  runtime: SimRuntime;
  /** Changing it remounts the 3D view (e.g. switching to a test replay). */
  viewKey?: string;
  /** Operator controls shown on the pad. */
  controls: ReadonlyArray<ControlDef>;
  /** Fault controls shown in the Instructor menu. */
  faults?: ReadonlyArray<ControlDef>;
  /** Top-right tools (speed control…). */
  tools?: ReactNode;
  /** Centered banner (e.g. "Watching test 2…"). */
  banner?: ReactNode;
  /** Disable the pad (replays). */
  padDisabled?: boolean;
  /** Where the live I/O table is shown, for the fallback text (e.g. "the Briefing tab"). */
  ioHint?: string;
  className?: string;
}

function Fallback({ scene, reason, ioHint }: { scene: SceneLogic<unknown>; reason: 'missing' | 'error' | 'webgl'; ioHint: string }) {
  return (
    <div className="absolute inset-0 flex items-start justify-center bg-[radial-gradient(ellipse_at_50%_30%,#1f2833_0%,#0d1117_70%)] pt-[12%]">
      <div className="max-w-sm px-6 text-center" data-testid="twin-fallback">
        <Box size={38} className="mx-auto mb-3 text-slate-600" />
        <div className="text-sm font-semibold text-slate-200">
          {reason === 'missing' ? '3D view of this plant is still being built' : reason === 'webgl' ? '3D view unavailable (WebGL is disabled)' : 'The 3D view could not start'}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          <span className="text-slate-300">{scene.title}</span> is fully simulated anyway: operate it with the panel below and watch the live I/O in {ioHint} and
          on the ladder.
        </p>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-slate-400">
      <Loader2 size={22} className="animate-spin" />
    </div>
  );
}

function TwinPanelImpl({ scene, definition, runtime, viewKey, controls, faults = [], tools, banner, padDisabled, ioHint = 'the left panel', className }: TwinPanelProps) {
  const quality = useGame((s) => s.profile.settings.quality);
  const [webgl] = useState(() => hasWebGL());
  const rootRef = useRef<HTMLDivElement>(null);
  // pad size follows the panel height: full block, two compact rows, or one scrolling row
  const [padMode, setPadMode] = useState<'full' | 'compact' | 'row'>('full');
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      setPadMode(h < 330 ? 'row' : h < 470 ? 'compact' : 'full');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Expanded view: the panel covers the whole window (same DOM node, so the 3D scene is not remounted).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === 'Escape' && expanded) {
        e.stopPropagation();
        setExpanded(false);
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        const inTwin = !!t && !!rootRef.current?.contains(t);
        if (inTwin || t === document.body) setExpanded((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);
  const expandButton = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-pressed={expanded}
      aria-label={expanded ? 'Exit full view (Esc)' : 'Full view (F)'}
      title={expanded ? 'Exit full view (Esc)' : 'Full view (F)'}
      className="pointer-events-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-2 text-xs font-medium text-slate-200 backdrop-blur transition-colors hover:bg-black/70 hover:text-white"
    >
      {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      <span className="hidden sm:inline">{expanded ? 'Exit' : 'Full view'}</span>
    </button>
  );
  const overlay = (withCamera: boolean) => (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-2 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {withCamera && <CameraBar />}
          {withCamera && <ShowTagsToggle />}
        </div>
        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <ControllerChip runtime={runtime} />
          {tools}
          <InstructorMenu runtime={runtime} controls={faults} />
          {expandButton}
        </div>
      </div>
      {banner && <div className="pointer-events-auto mx-auto -mt-1 max-w-[92%]">{banner}</div>}
      <div className="flex-1" />
      <div className="flex items-end justify-start">
        <ControlPad runtime={runtime} controls={controls} disabled={!!padDisabled} compact={padMode !== 'full'} singleRow={padMode === 'row'} className="max-w-[min(100%,56rem)]" />
      </div>
    </div>
  );

  const content = (() => {
    if (!definition) return { node: <Fallback scene={scene} reason="missing" ioHint={ioHint} />, camera: false };
    if (!webgl) return { node: <Fallback scene={scene} reason="webgl" ioHint={ioHint} />, camera: false };
    const View = definition.View;
    return {
      node: (
        <ViewBoundary
          fallback={() => (
            <>
              <Fallback scene={scene} reason="error" ioHint={ioHint} />
              {overlay(false)}
            </>
          )}
          resetKey={viewKey}
        >
          <SceneCanvas cameras={definition.cameras} lighting={definition.environment ?? 'hall'} quality={quality} overlay={overlay(true)} className="absolute inset-0">
            <Suspense fallback={null}>
              <View key={viewKey} state={runtime.state} runtime={runtime} />
            </Suspense>
          </SceneCanvas>
        </ViewBoundary>
      ),
      camera: true,
    };
  })();

  return (
    <div
      ref={rootRef}
      className={cn(expanded ? 'fixed inset-0 z-40 h-dvh w-screen' : 'relative h-full w-full', 'overflow-hidden bg-[#0d1117]', !expanded && className)}
      data-testid="twin-panel"
      data-expanded={expanded || undefined}
    >
      <Suspense fallback={<Loading />}>{content.node}</Suspense>
      {!content.camera && overlay(false)}
    </div>
  );
}

export const TwinPanel = memo(TwinPanelImpl);
