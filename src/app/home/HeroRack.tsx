/**
 * Home hero 3D: a real Logix controller (trainer bench program: light chaser + switch lamps) driving a
 * 1756-A7 ControlLogix rack, slowly orbiting in a studio-lit SceneCanvas. A "ghost operator" flips the
 * bench switches now and then so the input module LEDs come alive too.
 *
 * Lazy-loaded by the Home page (three.js stays out of the first paint). Memoised: the page's live overlay
 * updates several times a second and must not re-render the R3F tree. Rendered at most at 'medium'
 * quality — it is a decorative, always-moving canvas that every first-time visitor lands on.
 */
import { ContactShadows } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { CameraControls } from '@react-three/drei';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ControllerStatus } from '../../plc/types';
import { createDemoRuntime, type DemoRuntime } from '../../sim/demo';
import { trainerLogic } from '../../sim/scenes';
import { TRAINER_DEMO_RUNGS } from '../../sim/scenes/trainer/demo';
import { useSimLoop } from '../../sim/useSimLoop';
import { rackLiveFromController } from '../../twin/live';
import { ControlLogixRack } from '../../twin/devices/plc/controllogix';
import { SceneCanvas, type CameraPreset, type StageQuality } from '../../twin/Stage';

const TARGET: [number, number, number] = [0, 0.085, 0.06];
const CAMERAS: CameraPreset[] = [{ id: 'hero', label: 'Hero', position: [0.2, 0.2, 0.74], target: TARGET }];
const BASE_AZIMUTH = Math.atan2(CAMERAS[0]!.position[0] - TARGET[0], CAMERAS[0]!.position[2] - TARGET[2]);

/** Slow sway around the front of the rack; pauses while the user drags, eases back afterwards. */
function AutoOrbit({ enabled }: { enabled: boolean }) {
  const controls = useThree((s) => s.controls) as CameraControls | null;
  const idleSince = useRef(0);
  const dragging = useRef(false);
  const t = useRef(0);
  useEffect(() => {
    if (!controls) return;
    const start = () => {
      dragging.current = true;
    };
    const end = () => {
      dragging.current = false;
      idleSince.current = performance.now();
    };
    controls.addEventListener('controlstart', start);
    controls.addEventListener('controlend', end);
    return () => {
      controls.removeEventListener('controlstart', start);
      controls.removeEventListener('controlend', end);
    };
  }, [controls]);
  useFrame((_, dt) => {
    if (!controls || !enabled || dragging.current) return;
    if (performance.now() - idleSince.current < 3500) return;
    t.current += Math.min(dt, 0.05);
    const az = BASE_AZIMUTH + 0.62 * Math.sin(t.current * 0.16) - 0.12;
    const polar = 1.28 + 0.07 * Math.sin(t.current * 0.11 + 1);
    void controls.rotateTo(az, polar, true);
  });
  return null;
}

/** Keep the whole rack in frame whatever the canvas aspect ratio (narrow canvases pull the camera back). */
function FitDistance() {
  const controls = useThree((s) => s.controls) as CameraControls | null;
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useEffect(() => {
    if (!controls) return;
    const d = Math.min(1.35, Math.max(0.72, 0.9 / aspect));
    void controls.dollyTo(d, false);
  }, [controls, aspect]);
  return null;
}

/** Stop rendering while the hero is scrolled out of view (saves the GPU while reading the page). */
function FrameloopControl({ active }: { active: boolean }) {
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => {
    setFrameloop(active ? 'always' : 'never');
  }, [active, setFrameloop]);
  return null;
}

/** Accent turntable under the rack. */
function Pedestal() {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ring.current?.material as THREE.MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = 2.2 + 0.6 * Math.sin(clock.elapsedTime * 1.4);
  });
  return (
    <group position={[0, -0.001, 0.06]}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[0.36, 96]} />
        <meshStandardMaterial color="#10151b" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.0005, 0]}>
        <ringGeometry args={[0.355, 0.362, 128]} />
        <meshStandardMaterial color="#e0252b" emissive="#e0252b" emissiveIntensity={2.4} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.0004, 0]}>
        <ringGeometry args={[0.25, 0.252, 128]} />
        <meshStandardMaterial color="#334155" emissive="#64748b" emissiveIntensity={0.4} />
      </mesh>
    </group>
  );
}

/** Don't hijack page scrolling: no wheel / touch dolly, one-finger touch scrolls the page. */
function lockControls(c: CameraControls | null): void {
  if (!c) return;
  c.mouseButtons.wheel = 0;
  c.mouseButtons.middle = 0;
  c.mouseButtons.right = 0;
  c.touches.one = 0;
  c.touches.two = 0;
  c.touches.three = 0;
}

export interface HeroRackProps {
  quality: StageQuality;
  reducedMotion: boolean;
  /** False while the hero is off-screen: rendering and simulation pause. */
  active?: boolean;
  /** Called ~4×/s with the controller status (for the DOM overlay). */
  onStatus?: (s: ControllerStatus, outputs: boolean[], inputs: boolean[]) => void;
}

function HeroRack({ quality, reducedMotion, active = true, onStatus }: HeroRackProps) {
  const [demo] = useState<DemoRuntime>(() => createDemoRuntime(trainerLogic, TRAINER_DEMO_RUNGS));
  const live = useMemo(() => rackLiveFromController(demo.controller), [demo]);
  useSimLoop(demo.runtime, active);

  // Ghost operator: flip a bench switch every couple of seconds.
  useEffect(() => {
    if (!active) return;
    let i = 0;
    const h = window.setInterval(() => {
      i++;
      const sw = (i * 5 + (i >> 1)) % 8;
      const id = `sw${sw}`;
      demo.runtime.setControl(id, !demo.runtime.getControl(id));
    }, 1300);
    return () => window.clearInterval(h);
  }, [demo, active]);

  // Status for the overlay.
  useEffect(() => {
    if (!onStatus || !active) return;
    const h = window.setInterval(() => {
      const outs = Array.from({ length: 8 }, (_, k) => live.point(2, k));
      const ins = Array.from({ length: 8 }, (_, k) => live.point(1, k));
      onStatus(live.status(), outs, ins);
    }, 200);
    return () => window.clearInterval(h);
  }, [live, onStatus, active]);

  return (
    <SceneCanvas
      lighting="studio"
      quality={quality === 'high' ? 'medium' : quality}
      background="#0b0f14"
      cameras={CAMERAS}
      minDistance={0.38}
      maxDistance={1.4}
      className="absolute inset-0"
      onControls={lockControls}
    >
      {/* hero close-up: always the live rack (lod off); the trainer demo runs on its own (no START needed) */}
      <ControlLogixRack hardware={trainerLogic.hardware} live={live} position={[0, 0.006, 0]} lod={false} />
      <Pedestal />
      {/* the rack and pedestal never move: bake the contact shadow once */}
      <ContactShadows position={[0, 0.0015, 0.06]} opacity={0.7} scale={0.9} blur={2.2} far={0.3} resolution={512} frames={1} />
      <AutoOrbit enabled={!reducedMotion} />
      <FitDistance />
      <FrameloopControl active={active} />
    </SceneCanvas>
  );
}

export default memo(HeroRack);
