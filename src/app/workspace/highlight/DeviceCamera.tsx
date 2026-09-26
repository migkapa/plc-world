/**
 * "Where is this device?" in the 3D twin — the view side of the device highlight (src/sim/scenes/overlay.ts):
 *
 *  - <DeviceCamera> (inside the <SceneCanvas>, next to the scene View): when the page asks to show a device
 *    (`useSceneOverlay().showDevice(alias)`, e.g. a click on an alias chip or the "Show" button), it flies the camera
 *    to a view of it: the scene's own camera preset for that device when it really shows it (scene `focus` map, then
 *    the scene rules), else the preset that shows it biggest, else a close-up computed around the device — every
 *    candidate is checked (device inside the frame, line of sight not blocked by the plant). Reduced motion: cuts.
 *  - <ShowDeviceButton> (DOM overlay): while a highlighted device is off-screen (outside the view, behind a wall or
 *    under the operator pad), offers "Show <alias>".
 */
import { useFrame, useThree } from '@react-three/fiber';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair } from 'lucide-react';
import { useEffect, useRef, type CSSProperties } from 'react';
import * as THREE from 'three';
import { collectSolids, sightBlocked } from '../../../sim/scenes/highlight';
import { useSceneOverlay } from '../../../sim/scenes/overlay';
import { hudInsets, hudRects } from '../../../twin/hud';
import { useStageCamera } from '../../../twin/Stage';
import { cn } from '../../../ui';
import { useReducedMotion } from '../../hud/prefs';
import { cameraForSignal, type FocusMap } from '../replayCamera';

type V3 = [number, number, number];

/** How long to wait for the scene kit to report where the requested device is (ms). */
const TARGET_WAIT_MS = 400;
/** An on-screen device smaller than this (projected radius, px) is worth a closer preset when shown. */
const MIN_VISIBLE_PX = 12;

const _tmpCam = new THREE.PerspectiveCamera();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * The part of the view the DOM HUD leaves free, in NDC y, and the vertical shift HudFraming applies to the picture
 * (Stage.tsx moves the projection centre into the middle of the free band).
 */
interface Band {
  yMin: number;
  yMax: number;
  shift: number;
}

/** How well a camera at `pos` looking at `look` shows the device (null: outside the free part of the frame or hidden). */
function viewScore(solids: THREE.Mesh[], fov: number, aspect: number, pos: V3, look: V3, device: THREE.Vector3, radius: number, band: Band): number | null {
  _tmpCam.fov = fov;
  _tmpCam.aspect = aspect;
  _tmpCam.near = 0.02;
  _tmpCam.far = 400;
  _tmpCam.position.set(...pos);
  _tmpCam.lookAt(look[0], look[1], look[2]);
  _tmpCam.updateProjectionMatrix();
  _tmpCam.updateMatrixWorld(true);
  _v.copy(device).project(_tmpCam);
  const y = _v.y - band.shift;
  if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 0.8 || y < band.yMin || y > band.yMax) return null;
  _p.set(...pos);
  const dist = _p.distanceTo(device);
  if (sightBlocked(solids, _p, device, radius, _tmpCam)) return null;
  const mid = (band.yMin + band.yMax) / 2;
  const half = Math.max(0.1, (band.yMax - band.yMin) / 2);
  return (Math.max(radius, 0.02) / Math.max(dist, 0.05)) * (1 - 0.45 * Math.max(Math.abs(_v.x), Math.abs(y - mid) / half));
}

export interface DeviceCameraProps {
  sceneId: string;
  /** The scene definition's device → camera preset map. */
  focus?: FocusMap | undefined;
}

/** Flies the stage camera to the device `showDevice` asked for. Render inside <SceneCanvas>. */
export function DeviceCamera({ sceneId, focus }: DeviceCameraProps) {
  const cam = useStageCamera();
  const camRef = useRef(cam);
  camRef.current = cam;
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const pending = useRef<{ alias: string; since: number } | null>(null);
  const lastSeq = useRef(useSceneOverlay.getState().showSeq);

  useEffect(
    () =>
      useSceneOverlay.subscribe((s) => {
        if (s.showSeq === lastSeq.current || !s.showAlias) return;
        lastSeq.current = s.showSeq;
        pending.current = { alias: s.showAlias, since: performance.now() };
      }),
    [],
  );

  useFrame((state) => {
    const req = pending.current;
    if (!req) return;
    const ov = useSceneOverlay.getState();
    const t = ov.target && ov.target.alias.toLowerCase() === req.alias.toLowerCase() ? ov.target : null;
    const waited = performance.now() - req.since;
    if (!t && waited < TARGET_WAIT_MS) return; // the kit reports the device within a frame or two
    pending.current = null;
    const api = camRef.current;
    const animate = !reducedRef.current;
    const preferred = cameraForSignal(sceneId, req.alias, focus);
    if (!t) {
      // no device of that name in this view (or no tag layer): the scene's own preset, if it names one
      if (preferred && api.presets.some((p) => p.id === preferred)) api.goTo(preferred, animate);
      return;
    }
    const camera = state.camera as THREE.PerspectiveCamera;
    const fov = camera.isPerspectiveCamera ? camera.fov : 40;
    const H = Math.max(1, state.size.height);
    const aspect = state.size.width / H;
    const device = new THREE.Vector3(...t.position);
    const solids = collectSolids(scene);
    // the operator pad / camera bar cover part of the view: a device must land in the free band (see HudFraming)
    const ins = hudInsets(hudRects(gl.domElement), H);
    const shift = Math.max(-0.4, Math.min(0.4, (ins.top - ins.bottom) / H));
    const band: Band = { yMin: -1 + (2 * ins.bottom) / H + 0.12, yMax: 1 - (2 * ins.top) / H - 0.12, shift };
    if (band.yMax - band.yMin < 0.2) {
      const m = (band.yMin + band.yMax) / 2;
      band.yMin = m - 0.1;
      band.yMax = m + 0.1;
    }
    // already in view: stay, unless it is only a few pixels big and a preset shows it much better
    const focal = state.size.height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    const pxNow = (t.radius * focal) / Math.max(0.05, camera.position.distanceTo(device));
    if (t.onScreen && pxNow >= MIN_VISIBLE_PX) return;
    // 1. the scene's preset for this device, 2. the preset that shows it best
    let best: { id: string; score: number } | null = null;
    for (const p of api.presets) {
      const score = viewScore(solids, fov, aspect, p.position, p.target, device, t.radius, band);
      if (score === null) continue;
      if (p.id === preferred) {
        best = { id: p.id, score: Infinity };
        break;
      }
      if (!best || score > best.score) best = { id: p.id, score };
    }
    if (t.onScreen) {
      // tiny on screen: a closer preset only (no computed close-up for something the player can already see)
      if (best && best.id !== api.current && best.score * focal > pxNow * 1.8) api.goTo(best.id, animate);
      return;
    }
    if (best && best.id !== api.current) {
      api.goTo(best.id, animate);
      return;
    }
    // 3. a close-up around the device, from the side the camera looks from (then turning around it)
    const controls = state.controls as unknown as { getTarget?: (out: THREE.Vector3) => THREE.Vector3 } | null;
    const look = controls?.getTarget ? controls.getTarget(new THREE.Vector3()) : device.clone();
    const dir = camera.position.clone().sub(look);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const dist = THREE.MathUtils.clamp(t.radius * 7, 0.6, 16);
    const target: V3 = [device.x, device.y, device.z];
    for (const yaw of [0, 0.6, -0.6, 1.2, -1.2, Math.PI / 2 + 0.9, -(Math.PI / 2 + 0.9), Math.PI]) {
      const d = dir.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      const pos: V3 = [device.x + d.x * dist, device.y + dist * 0.45, device.z + d.z * dist];
      if (viewScore(solids, fov, aspect, pos, target, device, t.radius, band) !== null) {
        api.lookAt(pos, target, animate);
        return;
      }
    }
    // everything around it is blocked: look from above
    api.lookAt([device.x + dir.x * dist * 0.4, device.y + dist * 1.2, device.z + dir.z * dist * 0.4], target, animate);
  });
  return null;
}

/** The scene's focus map names this device explicitly (not just a fallback rule). */
function focusNames(focus: FocusMap | undefined, alias: string): boolean {
  if (!focus) return false;
  const l = alias.toLowerCase();
  return Object.keys(focus).some((k) => k.toLowerCase() === l);
}

/** Placement of the "Show" button by where the device is (it stays out of the top / bottom HUD bands). */
const SIDE_POS: Record<string, { cls: string; icon: 'left' | 'right' | 'up' | 'down' | 'aim' }> = {
  left: { cls: 'left-2 top-[42%]', icon: 'left' },
  right: { cls: 'right-2 top-[42%]', icon: 'right' },
  above: { cls: 'left-1/2 top-[33%] -translate-x-1/2', icon: 'up' },
  below: { cls: 'left-1/2 top-[48%] -translate-x-1/2', icon: 'down' },
  behind: { cls: 'left-1/2 top-[42%] -translate-x-1/2', icon: 'aim' },
  hidden: { cls: 'left-1/2 top-[42%] -translate-x-1/2', icon: 'aim' },
};

/**
 * "Show <alias>" while a highlighted device is off-screen (DOM overlay of the twin), at the edge the device is beyond
 * (or centred when it is behind the camera / hidden). The pointer over the button keeps the highlight alive (it
 * lingers only briefly after the row / chip that started it is left).
 */
export function ShowDeviceButton({ focus, sceneId }: { focus?: FocusMap | undefined; sceneId: string }) {
  const alias = useSceneOverlay((s) => s.highlightAlias);
  const target = useSceneOverlay((s) => s.target);
  const lingering = useSceneOverlay((s) => s.highlightLingering);
  const hold = useSceneOverlay((s) => s.holdHighlight);
  const showDevice = useSceneOverlay((s) => s.showDevice);
  useEffect(() => () => hold(false), [hold]);
  if (!alias) return null;
  const known = target !== null && target.alias.toLowerCase() === alias.toLowerCase();
  // a device the view does not know (no tag in this scene) can still be shown by a preset the scene names for it
  const off = known ? !target.onScreen : focusNames(focus, alias) && cameraForSignal(sceneId, alias, focus) !== undefined;
  if (!off) return null;
  const pos = SIDE_POS[(known && target.side) || 'hidden']!;
  // hidden inside the view (behind a wall, under the pad): next to its outline, in the middle band of the view
  const scr = known && target.side === 'hidden' ? target.screen : undefined;
  const style: CSSProperties | undefined = scr
    ? { left: `clamp(90px, ${scr.x + scr.w / 2}px, calc(100% - 90px))`, top: `clamp(30%, ${scr.y + scr.h + 10}px, 58%)`, transform: 'translateX(-50%)' }
    : undefined;
  const Icon = pos.icon === 'left' ? ChevronLeft : pos.icon === 'right' ? ChevronRight : pos.icon === 'up' ? ChevronUp : pos.icon === 'down' ? ChevronDown : Crosshair;
  const where = !known ? 'not in view' : target.side === 'hidden' ? 'hidden from this view' : target.side === 'behind' ? 'behind the camera' : 'out of view';
  return (
    <div className={cn('pointer-events-none absolute z-10', !style && pos.cls)} style={style}>
      <button
        type="button"
        onPointerEnter={() => hold(true)}
        onPointerLeave={() => hold(false)}
        onFocus={() => hold(true)}
        onBlur={() => hold(false)}
        onClick={() => showDevice(alias)}
        className={cn(
          'pointer-events-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-cyan-300/60 bg-slate-950/85 px-2.5 text-[11.5px] font-semibold whitespace-nowrap text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.35)] backdrop-blur transition-opacity hover:border-cyan-200 hover:bg-cyan-900/80',
          pos.icon === 'right' && 'flex-row-reverse',
        )}
        style={{ opacity: lingering ? 0.8 : 1 }}
        title={`${alias} is ${where} — fly the camera to it`}
        aria-label={`Show ${alias} in the 3D view (${where})`}
        data-testid="show-device"
        data-alias={alias}
        data-side={known ? (target.side ?? '') : ''}
      >
        <Icon size={14} className="shrink-0 text-cyan-300" />
        <span>
          Show <span className="font-mono">{alias}</span>
        </span>
      </button>
    </div>
  );
}
