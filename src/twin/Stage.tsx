/**
 * Shared 3D stage for every scene view, the showroom and thumbnails:
 * canvas setup, lighting & environment presets, post-processing, camera controls with animated presets.
 *
 *   <SceneCanvas lighting="hall" cameras={def.cameras} quality="high">
 *     <MyScene />
 *   </SceneCanvas>
 *
 * Inside the canvas, `useStageCamera().goTo('panel')` flies the camera to a preset.
 */
import { CameraControls, ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { hudInsets, hudRects } from './hud';
import { releaseRendererAfterUnmount, watchRenderer } from './releaseRenderer';

export type StageLighting = 'hall' | 'street' | 'studio';
export type StageQuality = 'low' | 'medium' | 'high';

export interface CameraPreset {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

interface StageCameraApi {
  presets: CameraPreset[];
  current: string | null;
  goTo(id: string, animate?: boolean): void;
  /** Fly to an arbitrary pose. */
  lookAt(position: [number, number, number], target: [number, number, number], animate?: boolean): void;
}

const StageCameraContext = createContext<StageCameraApi | null>(null);

/** Camera preset API (available to DOM overlays rendered as children of <SceneCanvas overlay> and to 3D children). */
export function useStageCamera(): StageCameraApi {
  const api = useContext(StageCameraContext);
  if (!api) throw new Error('useStageCamera must be used inside <SceneCanvas>');
  return api;
}

export interface SceneCanvasProps {
  children: ReactNode;
  cameras?: CameraPreset[];
  lighting?: StageLighting;
  quality?: StageQuality;
  /**
   * DOM overlay rendered above the canvas (has access to useStageCamera). Everything the canvas layers itself
   * (I/O tag chips, projected screens) stays below it; its interactive boxes (`pointer-events: auto`) are the HUD
   * that tag chips keep out of (see hud.ts).
   */
  overlay?: ReactNode;
  /**
   * Frame the view around the overlay HUD: the projection centre moves into the band between the HUD at the top
   * and at the bottom (e.g. an expanded operator pad), so camera presets show their target unobstructed.
   */
  hudFraming?: boolean;
  className?: string;
  /** Limit how far users can orbit (meters). */
  maxDistance?: number;
  minDistance?: number;
  /** Background color override. */
  background?: string;
  /** Show soft contact shadows on the floor plane (y=0). */
  contactShadows?: boolean;
  /** Called with the camera controls instance (advanced). */
  onControls?: (controls: CameraControls | null) => void;
}

const BACKGROUNDS: Record<StageLighting, string> = { hall: '#1a1f26', street: '#9fb7cc', studio: '#161b22' };

export function SceneCanvas({
  children,
  cameras = [],
  lighting = 'hall',
  quality = 'high',
  overlay,
  className,
  maxDistance = 40,
  minDistance = 0.15,
  background,
  contactShadows = false,
  onControls,
  hudFraming = false,
}: SceneCanvasProps) {
  const controlsRef = useRef<CameraControls | null>(null);
  // R3F only forces a context loss on unmount: release the renderer fully (see releaseRenderer.ts)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(
    () => () => {
      if (rendererRef.current) releaseRendererAfterUnmount(rendererRef.current);
    },
    [],
  );
  const [current, setCurrent] = useState<string | null>(cameras[0]?.id ?? null);
  const [degraded, setDegraded] = useState(false);
  const effectiveQuality: StageQuality = degraded && quality === 'high' ? 'medium' : quality;
  const first = cameras[0];

  const lookAt = useCallback((p: [number, number, number], t: [number, number, number], animate = true) => {
    void controlsRef.current?.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], animate);
  }, []);

  const goTo = useCallback(
    (id: string, animate = true) => {
      const preset = cameras.find((c) => c.id === id);
      if (!preset) return;
      setCurrent(id);
      lookAt(preset.position, preset.target, animate);
    },
    [cameras, lookAt],
  );

  const api = useMemo<StageCameraApi>(() => ({ presets: cameras, current, goTo, lookAt }), [cameras, current, goTo, lookAt]);
  const dpr: [number, number] = effectiveQuality === 'low' ? [1, 1] : effectiveQuality === 'medium' ? [1, 1.5] : [1, 2];

  return (
    <StageCameraContext.Provider value={api}>
      <div className={className ?? 'relative h-full w-full'} data-stage-root="">
        <Canvas
          // own stacking context: DOM layers the scene attaches next to the canvas stay below the overlay HUD
          style={{ zIndex: 0 }}
          shadows={effectiveQuality === 'low' ? false : 'percentage'}
          dpr={dpr}
          gl={{ antialias: effectiveQuality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: false }}
          camera={{ position: first?.position ?? [3, 2.5, 4], fov: 40, near: 0.02, far: 400 }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.AgXToneMapping;
            gl.toneMappingExposure = lighting === 'street' ? 1.05 : 1.15;
            rendererRef.current = gl;
            watchRenderer(gl);
          }}
        >
          <StageCameraContext.Provider value={api}>
            <PerformanceMonitor onDecline={() => setDegraded(true)} />
            <color attach="background" args={[background ?? BACKGROUNDS[lighting]]} />
            {lighting === 'street' && <fog attach="fog" args={['#b8cadb', 40, 160]} />}
            {lighting === 'hall' && <fog attach="fog" args={[background ?? BACKGROUNDS.hall, 25, 70]} />}
            <StageLights lighting={lighting} quality={effectiveQuality} />
            {children}
            {contactShadows && <ContactShadows position={[0, 0.001, 0]} opacity={0.45} scale={20} blur={2.4} far={4} resolution={512} />}
            <CameraControls
              ref={(c) => {
                controlsRef.current = c;
                onControls?.(c);
              }}
              makeDefault
              maxDistance={maxDistance}
              minDistance={minDistance}
              maxPolarAngle={Math.PI * 0.495}
              dollySpeed={0.6}
              smoothTime={0.35}
            />
            <InitialCamera preset={first} controlsRef={controlsRef} />
            <PostFx quality={effectiveQuality} />
            {hudFraming && <HudFraming />}
          </StageCameraContext.Provider>
        </Canvas>
        {overlay && (
          <div className="contents" data-stage-overlay="">
            {overlay}
          </div>
        )}
      </div>
    </StageCameraContext.Provider>
  );
}

function InitialCamera({ preset, controlsRef }: { preset?: CameraPreset; controlsRef: React.RefObject<CameraControls | null> }) {
  useEffect(() => {
    if (!preset) return;
    const c = controlsRef.current;
    if (c) void c.setLookAt(...preset.position, ...preset.target, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Moves the projection centre (a view offset: rendering, picking and tag projection stay consistent) to the middle
 * of the band the overlay HUD leaves free, easing when the HUD changes (e.g. the pad collapses).
 */
function HudFraming() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const shift = useRef(0);
  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    const { width: W, height: H } = state.size;
    if (W < 2 || H < 2) return;
    const { top, bottom } = hudInsets(hudRects(gl.domElement), H);
    // content moves down by `want` px (up when the bottom HUD is taller): the target sits mid-way between the bands
    const want = Math.max(-0.2 * H, Math.min(0.2 * H, (top - bottom) / 2));
    const cur = shift.current;
    const next = Math.abs(want - cur) < 0.5 ? want : cur + (want - cur) * Math.min(1, dt * 6);
    shift.current = next;
    const v = cam.view;
    if (Math.abs(next) < 0.25) {
      if (v?.enabled) cam.clearViewOffset();
    } else if (!v?.enabled || v.fullWidth !== W || v.fullHeight !== H || v.width !== W || v.height !== H || Math.abs(v.offsetY + next) > 0.1 || v.offsetX !== 0) {
      cam.setViewOffset(W, H, 0, -next, W, H);
    }
  });
  useEffect(
    () => () => {
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera && cam.view?.enabled) cam.clearViewOffset();
    },
    [camera],
  );
  return null;
}

/** Lights + reflection environment built from Lightformers (no network HDRIs). */
export function StageLights({ lighting, quality = 'high' }: { lighting: StageLighting; quality?: StageQuality }) {
  const shadowSize = quality === 'high' ? 2048 : 1024;
  if (lighting === 'street') {
    return (
      <>
        <hemisphereLight args={['#dbe9ff', '#5b5147', 0.9]} />
        <directionalLight
          position={[18, 30, 12]}
          intensity={2.6}
          color="#fff4e0"
          castShadow={quality !== 'low'}
          shadow-mapSize={[shadowSize, shadowSize]}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
          shadow-camera-far={90}
          shadow-bias={-0.0004}
        />
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={2.5} color="#cfe3ff" position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
          <Lightformer form="rect" intensity={0.8} color="#ffe8c8" position={[20, 6, 10]} rotation-y={-Math.PI / 3} scale={[20, 8, 1]} />
          <Lightformer form="rect" intensity={0.4} color="#9aa7b4" position={[0, -2, 0]} rotation-x={-Math.PI / 2} scale={[40, 40, 1]} />
        </Environment>
      </>
    );
  }
  if (lighting === 'studio') {
    return (
      <>
        <ambientLight intensity={0.25} />
        <directionalLight position={[2, 4, 3]} intensity={1.8} castShadow={quality !== 'low'} shadow-mapSize={[shadowSize, shadowSize]} shadow-bias={-0.0003} />
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.2} position={[0, 3, 2]} scale={[6, 2, 1]} />
          <Lightformer form="rect" intensity={1} position={[-4, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
          <Lightformer form="rect" intensity={1} position={[4, 1, 1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
          <Lightformer form="ring" intensity={0.6} position={[0, 2, -4]} scale={3} />
        </Environment>
      </>
    );
  }
  // Factory hall: cool overhead LED high-bays + warm fill.
  return (
    <>
      <hemisphereLight args={['#cfd8e3', '#3a3530', 0.55]} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.9}
        color="#f4f7ff"
        castShadow={quality !== 'low'}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-far={40}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <pointLight position={[-6, 5, -4]} intensity={18} distance={20} color="#ffd9a8" />
      <Environment resolution={256} frames={1}>
        {[-6, -2, 2, 6].map((x) => (
          <Lightformer key={x} form="rect" intensity={3} color="#eef4ff" position={[x, 8, 0]} rotation-x={Math.PI / 2} scale={[1.2, 12, 1]} />
        ))}
        <Lightformer form="rect" intensity={0.8} color="#ffe2bd" position={[-10, 3, 0]} rotation-y={Math.PI / 2} scale={[20, 5, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#bcd4ff" position={[10, 3, 0]} rotation-y={-Math.PI / 2} scale={[20, 5, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#ffffff" position={[0, 3, 10]} scale={[20, 5, 1]} />
      </Environment>
    </>
  );
}

function PostFx({ quality }: { quality: StageQuality }) {
  if (quality === 'low') return null;
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
      {quality === 'high' ? <N8AO aoRadius={0.4} intensity={1.6} distanceFalloff={1} halfRes /> : <></>}
      <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.9} radius={0.6} />
      <Vignette eskil={false} offset={0.2} darkness={0.55} />
    </EffectComposer>
  );
}
