/**
 * Showroom 3D viewer: studio SceneCanvas framed per device, floor + contact shadow, the device stage and
 * numbered hotspot markers. Markers are plain DOM in the overlay, positioned every frame by a projector inside the
 * canvas (StrictMode-safe, unlike drei <Html>); they fade when their feature faces away from the camera.
 */
import { ContactShadows } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Eye, EyeOff, Move3d, RotateCcw, X } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { SceneCanvas, useStageCamera, type StageQuality } from '../../twin/Stage';
import { IconButton, Markdown, cn } from '../../ui';
import type { Hotspot, ShowroomDevice } from './catalog';
import type { DemoStore } from './demo';
import type { StageDef } from './stages';

export interface DeviceViewerProps {
  device: ShowroomDevice;
  stage: StageDef;
  demo: DemoStore;
  active: number | null;
  onActive(index: number | null): void;
  /** Hotspots already opened (dimmed check style). */
  seen: ReadonlySet<number>;
  showHotspots: boolean;
  onToggleHotspots(): void;
  quality: StageQuality;
  reducedMotion: boolean;
  /** Increment to fly back to the device's home view. */
  homeSignal: number;
  onHome(): void;
  className?: string;
}

export function DeviceViewer(props: DeviceViewerProps) {
  const { device, stage, demo, active, onActive, seen, showHotspots, quality, reducedMotion, homeSignal } = props;
  const cameras = useMemo(() => [{ id: device.id, label: device.name, ...device.camera }], [device]);
  const floorY = stage.floor === false ? null : (stage.floor ?? 0);
  const spot = active !== null ? device.hotspots[active] : undefined;
  const markers = useRef(new Map<number, HTMLDivElement>());

  const overlay = (
    <>
      {showHotspots && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-label="Hotspots">
          {device.hotspots.map((h, i) => (
            <HotspotMarker
              key={`${device.id}:${i}`}
              index={i}
              spot={h}
              active={active === i}
              seen={seen.has(i)}
              reducedMotion={reducedMotion}
              onClick={() => onActive(active === i ? null : i)}
              register={(el) => {
                if (el) markers.current.set(i, el);
                else markers.current.delete(i);
              }}
            />
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-2 p-2.5">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-medium text-slate-300 backdrop-blur">
          <Move3d size={13} className="text-slate-400" />
          <span className="hidden sm:inline">Drag to orbit · scroll to zoom · tap the numbers</span>
          <span className="sm:hidden">Drag · pinch · tap numbers</span>
          {device.hotspots.length > 0 && (
            <span
              className={cn(
                'ml-1 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold',
                seen.size >= device.hotspots.length ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-slate-300',
              )}
              title="Hotspots explored"
            >
              {seen.size >= device.hotspots.length ? '✓ ' : ''}
              {seen.size}/{device.hotspots.length}
            </span>
          )}
        </div>
        <div className="pointer-events-auto flex gap-1 rounded-lg border border-white/10 bg-black/45 p-0.5 backdrop-blur">
          <IconButton label={showHotspots ? 'Hide hotspots' : 'Show hotspots'} size="sm" onClick={props.onToggleHotspots} active={showHotspots}>
            {showHotspots ? <Eye size={15} /> : <EyeOff size={15} />}
          </IconButton>
          <IconButton label="Reset view" size="sm" onClick={props.onHome}>
            <RotateCcw size={15} />
          </IconButton>
        </div>
      </div>
      {spot && active !== null && (
        <HotspotCallout
          key={`${device.id}:${active}`}
          index={active}
          count={device.hotspots.length}
          spot={spot}
          reducedMotion={reducedMotion}
          onClose={() => onActive(null)}
          onStep={(d) => onActive((active + d + device.hotspots.length) % device.hotspots.length)}
        />
      )}
    </>
  );

  return (
    <SceneCanvas
      lighting="studio"
      quality={quality}
      cameras={cameras}
      minDistance={Math.max(0.02, device.size * 0.12)}
      maxDistance={device.size * 7}
      overlay={overlay}
      className={cn('relative h-full w-full overflow-hidden', props.className)}
    >
      <CameraDirector device={device} active={active} homeSignal={homeSignal} reducedMotion={reducedMotion} />
      {floorY !== null && <Floor y={floorY} size={device.size} />}
      <Suspense fallback={null}>
        <stage.Scene key={device.id} demo={demo} />
      </Suspense>
      {showHotspots && <HotspotProjector spots={device.hotspots} markers={markers.current} />}
    </SceneCanvas>
  );
}

// ---------------------------------------------------------------------------
// Camera framing
// ---------------------------------------------------------------------------

/** Frames were authored for a ≈ 4:3 viewer; narrower (portrait) viewers back the camera off so the width fits. */
const REF_ASPECT = 1.35;

function fitDistance(position: THREE.Vector3, target: THREE.Vector3, aspect: number): THREE.Vector3 {
  const k = Math.min(2.4, Math.max(1, REF_ASPECT / Math.max(0.3, aspect)));
  return target.clone().add(position.clone().sub(target).multiplyScalar(k));
}

function CameraDirector({ device, active, homeSignal, reducedMotion }: { device: ShowroomDevice; active: number | null; homeSignal: number; reducedMotion: boolean }) {
  const cam = useStageCamera();
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  const first = useRef(true);
  // device change / reset / resize: fly to the device's home frame
  useEffect(() => {
    const animate = !reducedMotion && !first.current;
    first.current = false;
    const t = new THREE.Vector3(...device.camera.target);
    const p = fitDistance(new THREE.Vector3(...device.camera.position), t, aspect);
    // next frame: runs after <SceneCanvas>'s own initial-camera effect
    const raf = requestAnimationFrame(() => cam.lookAt(p.toArray() as [number, number, number], device.camera.target, animate));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, homeSignal, Math.round(aspect * 10)]);
  // hotspot: move closer to the feature, keeping the general viewing direction
  useEffect(() => {
    if (active === null) return;
    const h = device.hotspots[active];
    if (!h) return;
    const home = new THREE.Vector3(...device.camera.position);
    const homeT = new THREE.Vector3(...device.camera.target);
    const at = new THREE.Vector3(...h.at);
    const n = new THREE.Vector3(...(h.normal ?? [0, 0, 1])).normalize();
    const dir = home.clone().sub(homeT).normalize().lerp(n, 0.35).normalize();
    const dist = home.distanceTo(homeT) * 0.6;
    const target = homeT.clone().lerp(at, 0.75);
    const pos = fitDistance(target.clone().add(dir.multiplyScalar(dist)), target, aspect);
    cam.lookAt(pos.toArray() as [number, number, number], target.toArray() as [number, number, number], !reducedMotion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return null;
}

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

function Floor({ y, size }: { y: number; size: number }) {
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#e0252b', transparent: true, opacity: 0.35, toneMapped: false }), []);
  useEffect(() => () => ringMat.dispose(), [ringMat]);
  const r = size * 0.95;
  return (
    <group position={[0, y, 0]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.0005, 0]} receiveShadow>
        <circleGeometry args={[size * 12, 64]} />
        <meshStandardMaterial color="#0f141a" roughness={0.95} metalness={0} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[r, 96]} />
        <meshStandardMaterial color="#1a2129" roughness={0.7} metalness={0.2} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.0002, 0]} material={ringMat}>
        <ringGeometry args={[r * 0.995, r, 128]} />
      </mesh>
      <ContactShadows position={[0, 0.0006, 0]} opacity={0.55} scale={size * 3} blur={2.2} far={size * 1.2} resolution={512} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Hotspots
// ---------------------------------------------------------------------------

/** Projects hotspot world positions to overlay pixels every frame and fades back-facing ones. */
function HotspotProjector({ spots, markers }: { spots: Hotspot[]; markers: Map<number, HTMLDivElement> }) {
  const data = useMemo(
    () => spots.map((s) => ({ at: new THREE.Vector3(...s.at), n: new THREE.Vector3(...(s.normal ?? [0, 0, 1])).normalize() })),
    [spots],
  );
  const v = useMemo(() => new THREE.Vector3(), []);
  const d = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (let i = 0; i < data.length; i++) {
      const el = markers.get(i);
      if (!el) continue;
      const { at, n } = data[i]!;
      v.copy(at).project(camera);
      const inFront = v.z < 1 && v.z > -1;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      const facing = d.copy(camera.position).sub(at).normalize().dot(n);
      const visible = inFront && facing > -0.08;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const o = !inFront ? '0' : visible ? '1' : '0.15';
      if (el.style.opacity !== o) el.style.opacity = o;
      const pe = visible ? 'auto' : 'none';
      if (el.style.pointerEvents !== pe) el.style.pointerEvents = pe;
    }
  });
  return null;
}

function HotspotMarker({
  index,
  spot,
  active,
  seen,
  reducedMotion,
  onClick,
  register,
}: {
  index: number;
  spot: Hotspot;
  active: boolean;
  seen: boolean;
  reducedMotion: boolean;
  onClick(): void;
  register(el: HTMLDivElement | null): void;
}) {
  return (
    <div
      ref={register}
      className={cn('group absolute top-0 left-0 transition-opacity duration-200', active ? 'z-20' : 'z-10')}
      style={{ opacity: 0, transform: 'translate3d(-100px,-100px,0)' }}
      data-hotspot={index + 1}
    >
      <div className="-translate-x-1/2 -translate-y-1/2">
        <button
          type="button"
          onClick={onClick}
          aria-label={`Hotspot ${index + 1}: ${spot.label}`}
          className={cn(
            'relative flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full border text-[11px] font-bold tabular-nums shadow-lg shadow-black/50 transition-transform',
            'focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none',
            active
              ? 'scale-110 border-white bg-ab-red text-white'
              : seen
                ? 'border-white/40 bg-slate-900/85 text-slate-300 hover:scale-110 hover:border-white'
                : 'border-white/80 bg-slate-950/85 text-white hover:scale-110 hover:bg-ab-red',
          )}
        >
          {!active && !seen && !reducedMotion && <span className="sr-pulse pointer-events-none absolute inset-[-4px] rounded-full border border-ab-red/80" />}
          {index + 1}
        </button>
        <span
          className={cn(
            'pointer-events-none absolute top-1/2 left-[28px] -translate-y-1/2 rounded-md border border-white/10 bg-black/75 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-slate-100 opacity-0 shadow-lg backdrop-blur transition-opacity',
            'group-hover:opacity-100',
            active && 'opacity-100',
          )}
        >
          {spot.label}
        </span>
      </div>
    </div>
  );
}

function HotspotCallout({
  index,
  count,
  spot,
  reducedMotion,
  onClose,
  onStep,
}: {
  index: number;
  count: number;
  spot: Hotspot;
  reducedMotion: boolean;
  onClose(): void;
  onStep(delta: number): void;
}) {
  return (
    <div
      className={cn(
        'absolute right-2.5 bottom-2.5 left-2.5 z-30 max-w-[26rem] rounded-xl border border-white/10 bg-slate-950/85 p-3 shadow-2xl shadow-black/60 backdrop-blur-md sm:right-auto',
        !reducedMotion && 'sr-rise',
      )}
      role="dialog"
      aria-label={spot.label}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ab-red text-[11px] font-bold text-white">{index + 1}</span>
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{spot.label}</div>
        <span className="font-mono text-[10px] text-slate-500">
          {index + 1}/{count}
        </span>
        <StepButton label="Previous hotspot" onClick={() => onStep(-1)}>
          ‹
        </StepButton>
        <StepButton label="Next hotspot" onClick={() => onStep(1)}>
          ›
        </StepButton>
        <IconButton label="Close" size="xs" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>
      <Markdown source={spot.text} className="mt-1.5 text-[13px] leading-snug" />
    </div>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-base leading-none text-slate-300 hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}
