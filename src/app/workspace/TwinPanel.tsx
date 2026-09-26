/**
 * The 3D digital twin of a plant: SceneCanvas with the scene definition's cameras & environment, and a
 * DOM overlay (camera presets, "Show I/O tags", speed / pause / reset, instructor faults, operator
 * control pad). Falls back to a clean panel when the scene has no 3D view yet or WebGL fails — the
 * simulation keeps running either way (it is ticked by the page, not by the view).
 */
import { Box, Cctv, Loader2, Maximize2, Minimize2, Tag, Wrench } from 'lucide-react';
import { Component, memo, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { useGame } from '../../game/store';
import { useSceneOverlay } from '../../sim/scenes/overlay';
import type { ControlDef, SceneDefinition, SceneLogic, SimRuntime } from '../../sim/types';
import { SceneCanvas, useStageCamera } from '../../twin/Stage';
import { cn, hasWebGL } from '../../ui';
import { ControlPad, FaultList } from './ControlPad';
import { HudIconButton, HudMenu } from './OverlayMenu';
import { DeviceCamera, ShowDeviceButton } from './highlight/DeviceCamera';
import { TwinLayoutButton, useTwinLayout } from './TwinLayout';
import { useReducedMotion } from '../hud/prefs';
import { modalOpen, useControllerTick, useRuntimeValue } from './hooks';

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

// ---------------------------------------------------------------------------
// Overlay pieces
// ---------------------------------------------------------------------------

function CameraBar({ onPick }: { onPick?: ((id: string) => void) | undefined }) {
  const cam = useStageCamera();
  if (cam.presets.length < 2) return null;
  const current = cam.presets.find((p) => p.id === cam.current);
  return (
    <HudMenu
      icon={<Cctv size={13} className="text-slate-400" />}
      value={current?.label ?? 'Camera'}
      label="Camera view"
      header="Camera view"
      items={cam.presets.map((p) => ({ id: p.id, label: p.label }))}
      selected={cam.current}
      onPick={(id) => {
        cam.goTo(id);
        onPick?.(id);
      }}
    />
  );
}

/**
 * Fly to a camera preset while `id` is set (e.g. the device a replayed test checks — it may change as the test runs)
 * and back to the player's own view when it clears or the panel unmounts. `''` keeps the focus session open without
 * moving (the player took the camera over). Reduced motion: cuts instead of flights.
 */
function CameraFocus({ id }: { id?: string | undefined }) {
  const cam = useStageCamera();
  const camRef = useRef(cam);
  camRef.current = cam;
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  /** The player's view before the focus session started (undefined: no session). */
  const home = useRef<string | null | undefined>(undefined);
  const active = id !== undefined;
  useEffect(() => {
    const api = camRef.current;
    if (!id || !api.presets.some((p) => p.id === id)) return;
    if (home.current === undefined) home.current = api.current;
    if (api.current !== id) api.goTo(id, !reducedRef.current);
  }, [id]);
  useEffect(() => {
    if (!active) return;
    return () => {
      const prev = home.current;
      home.current = undefined;
      const api = camRef.current;
      if (prev && prev !== api.current) api.goTo(prev, !reducedRef.current);
    };
  }, [active]);
  return null;
}

function ShowTagsToggle() {
  const show = useSceneOverlay((s) => s.showTags);
  const toggle = useSceneOverlay((s) => s.toggleShowTags);
  return (
    <HudIconButton
      label={show ? 'Hide I/O tags (show them on hover only)' : 'Show I/O tags on every device (alias · address · live value)'}
      active={show}
      tone="emerald"
      onClick={toggle}
      testId="show-io-tags"
    >
      <Tag size={13} />
    </HudIconButton>
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
      <HudIconButton
        label={active > 0 ? `Instructor: ${active} field fault${active === 1 ? '' : 's'} injected` : 'Instructor: inject field faults (failed sensors, overloads…)'}
        active={open || active > 0}
        tone="amber"
        badge={active > 0 ? active : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Wrench size={13} />
      </HudIconButton>
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
        'pointer-events-auto flex h-7 items-center gap-1.5 rounded-lg border px-2 font-mono text-[10.5px] font-bold backdrop-blur',
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
  /** Further pad controls behind a "More" chip (plant controls the mission does not use). */
  moreControls?: ReadonlyArray<ControlDef>;
  /** Fault controls shown in the Instructor menu. */
  faults?: ReadonlyArray<ControlDef>;
  /** Top-right tools (speed control…). */
  tools?: ReactNode;
  /** Centered banner (e.g. "Watching test 2…"). */
  banner?: ReactNode;
  /** Disable the pad (replays). */
  padDisabled?: boolean;
  /**
   * Camera preset to show while set (a replay looks at the device its test checks, and follows the test as it runs);
   * `''` keeps the focus session without moving; cleared → back to the player's view.
   */
  focusCamera?: string | undefined;
  /** The player picked a camera preset (e.g. to stop a replay's automatic camera). */
  onCameraPick?(id: string): void;
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

function TwinPanelImpl({ scene, definition, runtime, viewKey, controls, moreControls, faults = [], tools, banner, padDisabled, focusCamera, onCameraPick, ioHint = 'the left panel', className }: TwinPanelProps) {
  const quality = useGame((s) => s.profile.settings.quality);
  const [webgl] = useState(() => hasWebGL());
  const rootRef = useRef<HTMLDivElement>(null);
  // pad size follows the panel height: full block, two compact rows, or one scrolling row (a disabled pad — during a
  // replay — shrinks to one row in a short panel: it only shows the control states, the 3D view needs the room)
  const [padMode, setPadMode] = useState<'full' | 'compact' | 'row'>('full');
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      setPadMode(h < 290 ? 'row' : h < 470 ? 'compact' : 'full');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Expanded view: the panel covers the whole window (same DOM node, so the 3D scene is not remounted).
  const [expanded, setExpanded] = useState(false);
  // picture-in-picture (desktop workspace layout): no HUD in the small view, no full view from it
  const pip = useTwinLayout()?.pip === true;
  const pipRef = useRef(pip);
  pipRef.current = pip;
  useEffect(() => {
    if (pip) setExpanded(false);
  }, [pip]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // an open dialog (hints, celebration, reset…) owns Escape, and F is not ours then either
      if (modalOpen()) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === 'Escape' && expanded) {
        e.stopPropagation();
        setExpanded(false);
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        const inTwin = !!t && !!rootRef.current?.contains(t);
        if ((inTwin || t === document.body) && !pipRef.current) setExpanded((v) => !v);
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
  // a fly-to the player asked for (alias chip, I/O row) during a replay: the replay's automatic camera stops following
  // the test, or it would take the view straight back at the next step
  const cameraPickRef = useRef(onCameraPick);
  cameraPickRef.current = onCameraPick;
  const focusRef = useRef(focusCamera);
  focusRef.current = focusCamera;
  useEffect(
    () =>
      useSceneOverlay.subscribe((s, prev) => {
        if (s.showSeq !== prev.showSeq && s.showAlias && focusRef.current) cameraPickRef.current?.(`device:${s.showAlias}`);
      }),
    [],
  );
  const expandButton = (
    <HudIconButton label={expanded ? 'Exit full view (Esc)' : 'Full view (F)'} active={expanded} onClick={() => setExpanded((v) => !v)}>
      {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
    </HudIconButton>
  );
  const overlay = (withCamera: boolean) => (
    <div className={cn('pointer-events-none absolute inset-0 flex flex-col justify-between gap-2 p-2', pip && 'hidden')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {withCamera && <CameraFocus id={focusCamera} />}
          {withCamera && <CameraBar onPick={onCameraPick} />}
          {withCamera && <ShowTagsToggle />}
        </div>
        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          <ControllerChip runtime={runtime} />
          {tools}
          <InstructorMenu runtime={runtime} controls={faults} />
          <TwinLayoutButton />
          {expandButton}
        </div>
      </div>
      {banner && <div className="pointer-events-auto mx-auto -mt-1 max-w-[92%]">{banner}</div>}
      {/* not during a replay: its banner covers the view's middle (the button would sit on the explanation card) and the
          replay's camera owns the view — alias chips still fly there (and turn the automatic camera off, below) */}
      {withCamera && !banner && <ShowDeviceButton sceneId={scene.id} focus={definition?.focus} />}
      <div className="flex-1" />
      <div className="flex items-end justify-start">
        <ControlPad runtime={runtime} controls={controls} {...(moreControls ? { moreControls } : {})} disabled={!!padDisabled} compact={padMode !== 'full'} singleRow={padMode === 'row' || (!!padDisabled && padMode === 'compact')} className="max-w-[min(100%,56rem)]" />
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
          <SceneCanvas cameras={definition.cameras} lighting={definition.environment ?? 'hall'} quality={quality} overlay={overlay(true)} hudFraming className="absolute inset-0">
            <Suspense fallback={null}>
              <View key={viewKey} state={runtime.state} runtime={runtime} />
            </Suspense>
            <DeviceCamera sceneId={scene.id} focus={definition.focus} />
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
