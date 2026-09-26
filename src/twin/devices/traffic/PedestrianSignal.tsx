/**
 * 16" × 18" LED countdown pedestrian signal (ITE PTCSI / MUTCD 4E): overlaid UPRAISED HAND (Portland
 * orange) and WALKING PERSON (lunar white) on the left (≈ 11" symbols), 2-digit countdown (Portland
 * orange, ≈ 9" digits) on the right, in a one-section housing with a 3-sided hood or an "egg-crate"
 * louver visor, side-of-pole clamshell bracket.
 *
 * Draw calls: 2 — the housing, visor, bracket and hardware are one merged mesh; the module face is one
 * glossy plane whose emissive canvas is redrawn only when the displayed state changes.
 *
 * Origin: back face of the mounting bracket (the pole surface), at the vertical center of the housing;
 * the display faces +Z. With `mount="none"` the origin is the back-center of the housing.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedMode } from '../../common';
import type { Placement } from '../../contracts';
import { pedFaceLayers } from './ledTextures';
import {
  FINISH,
  INCH,
  TRAFFIC_COLORS,
  boxGeo,
  canvasTex,
  cylX,
  cylY,
  cylZ,
  ledOn,
  makeCanvas,
  mergeVc,
  planeGeo,
  roundedBox,
  roundedRectHole,
  roundedRectShape,
  sharedGeo,
  useDisposable,
  vc,
  vcMaterial,
  xf,
} from './shared';

export interface PedestrianSignalProps extends Placement {
  /** WALKING PERSON (white). */
  getWalk: () => LedMode;
  /** UPRAISED HAND (orange); flash it for the pedestrian change interval. */
  getDontWalk: () => LedMode;
  /** Countdown seconds (0..99); null / negative = blank. */
  getCountdown?: () => number | null;
  /** Show the countdown half (default true). Without it the symbol is centered. */
  countdown?: boolean;
  housingColor?: string;
  /** 3-sided hood (default), egg-crate louvers, or none. */
  visor?: 'hood' | 'crate' | 'none';
  /** Clamshell side-of-pole bracket (default) or none. */
  mount?: 'bracket' | 'none';
  intensity?: number;
}

export const PED_SIGNAL_DIMS = {
  width: 19 * INCH,
  height: 18.5 * INCH,
  depth: 8 * INCH,
  bracketStandoff: 0.11,
} as const;
const P = PED_SIGNAL_DIMS;

const FACE_W = 0.43;
const FACE_H = 0.4;
/** Symbol area (≈ 7.5" × 11.4") and digit size (≈ 4" × 10", lit segments ≈ 9.4"). */
const SYM_W = 0.19;
const SYM_H = 0.29;
const DIG_W = 0.1;
const DIG_H = 0.26;

function hoodGeometry(w: number, h: number, len: number): THREE.BufferGeometry {
  return sharedGeo(`ped:hood:${w}:${h}:${len}`, () => {
    const t = 0.003;
    const s = new THREE.Shape();
    s.moveTo(-w / 2, -h / 2);
    s.lineTo(-w / 2, h / 2);
    s.lineTo(w / 2, h / 2);
    s.lineTo(w / 2, -h / 2);
    s.lineTo(w / 2 - t, -h / 2);
    s.lineTo(w / 2 - t, h / 2 - t);
    s.lineTo(-w / 2 + t, h / 2 - t);
    s.lineTo(-w / 2 + t, -h / 2);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    const pos = g.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const yn = (pos.getY(i) + h / 2) / h; // 0 bottom .. 1 top
      pos.setZ(i, pos.getZ(i) * (0.25 + 0.75 * yn));
    }
    g.computeVertexNormals();
    return g;
  });
}

function crateParts(w: number, h: number, depth: number): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const t = 0.0025;
  const n = 10;
  for (let i = 1; i < n; i++) parts.push(xf(boxGeo(t, h, depth), [-w / 2 + (w * i) / n, 0, depth / 2]));
  for (let j = 1; j < 9; j++) parts.push(xf(boxGeo(w, t, depth), [0, -h / 2 + (h * j) / 9, depth / 2], [-0.35, 0, 0]));
  const frame = roundedRectShape(w + 0.02, h + 0.02, 0.01);
  frame.holes.push(roundedRectHole(w, h, 0.004));
  parts.push(new THREE.ExtrudeGeometry(frame, { depth, bevelEnabled: false }));
  return parts;
}

const pedCache = new Map<string, THREE.BufferGeometry>();

function staticGeometry(visor: 'hood' | 'crate' | 'none', mount: 'bracket' | 'none', housingColor: string): THREE.BufferGeometry {
  const key = `${visor}:${mount}:${housingColor}`;
  const hit = pedCache.get(key);
  if (hit) return hit;
  const z0 = mount === 'bracket' ? P.bracketStandoff : 0;
  const hF = { color: housingColor, roughness: 0.42, metalness: 0.05 };
  const mF = FINISH.hardware;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, f: typeof hF, pos?: [number, number, number], rot?: [number, number, number]) => parts.push(vc(xf(g, pos, rot), f));
  add(roundedBox(P.width, P.height, P.depth, 0.025, 3), hF, [0, 0, z0 + P.depth / 2]);
  // door frame around the module
  const door = roundedRectShape(P.width - 0.012, P.height - 0.012, 0.02);
  door.holes.push(roundedRectHole(FACE_W + 0.004, FACE_H + 0.004, 0.012));
  add(new THREE.ExtrudeGeometry(door, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 }), hF, [0, 0, z0 + P.depth + 0.003]);
  const zDoor = z0 + P.depth + 0.019;
  if (visor === 'hood') add(hoodGeometry(P.width - 0.02, P.height - 0.02, 0.2), hF, [0, 0, zDoor - 0.004]);
  if (visor === 'crate') for (const g of crateParts(FACE_W, FACE_H, 0.075)) add(g, hF, [0, 0, zDoor - 0.012]);
  // hinges + latch
  for (const dy of [-0.15, 0.15]) add(cylY(0.0065, 0.0065, 0.05, 10), mF, [-P.width / 2 + 0.004, dy, zDoor - 0.008]);
  add(cylX(0.009, 0.009, 0.014, 12), mF, [P.width / 2 - 0.002, 0, zDoor - 0.01]);
  add(roundedBox(0.006, 0.034, 0.012, 0.002, 1), mF, [P.width / 2 + 0.007, 0, zDoor - 0.01]);
  // top & bottom tri-stud fittings
  add(cylY(0.045, 0.05, 0.02, 20), mF, [0, P.height / 2 + 0.01, z0 + P.depth / 2]);
  add(cylY(0.045, 0.05, 0.02, 20), mF, [0, -P.height / 2 - 0.01, z0 + P.depth / 2]);
  if (mount === 'bracket') {
    // clamshell bracket: vertical hinge tube at the pole + upper/lower arms into the housing fittings
    const armY = P.height / 2 + 0.035;
    add(cylY(0.022, 0.022, P.height + 0.12, 16), mF, [0, 0, 0.03]);
    for (const y of [armY, -armY]) {
      add(roundedBox(0.05, 0.035, z0 + P.depth / 2 - 0.02, 0.008, 2), mF, [0, y, (z0 + P.depth / 2) / 2 + 0.01]);
      add(cylY(0.03, 0.03, 0.05, 16), mF, [0, y, z0 + P.depth / 2]);
      add(cylZ(0.035, 0.035, 0.02, 16), mF, [0, y, 0.01]);
    }
  }
  const res = mergeVc(parts);
  pedCache.set(key, res);
  return res;
}

export function PedestrianSignal({
  getWalk,
  getDontWalk,
  getCountdown,
  countdown = true,
  housingColor = TRAFFIC_COLORS.signalBlack,
  visor = 'hood',
  mount = 'bracket',
  intensity = 3,
  position,
  rotation,
  scale,
}: PedestrianSignalProps) {
  const geo = useMemo(() => staticGeometry(visor, mount, housingColor), [visor, mount, housingColor]);
  const symX = countdown ? -0.1 : 0;
  const layers = useMemo(() => pedFaceLayers([FACE_W, FACE_H], [symX, SYM_W, SYM_H], countdown ? [0.055, 0.16] : [], [DIG_W, DIG_H]), [symX, countdown]);
  // Per-instance emissive canvas: redrawn only when the displayed state changes.
  const face = useMemo(() => {
    const [canvas, ctx] = makeCanvas(layers.layout.W, layers.layout.H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tex = canvasTex(canvas);
    const mat = new THREE.MeshPhysicalMaterial({
      map: layers.base,
      emissive: '#ffffff',
      emissiveMap: tex,
      emissiveIntensity: intensity,
      roughness: 0.55,
      metalness: 0,
      clearcoat: 0.45,
      clearcoatRoughness: 0.12,
      toneMapped: false,
    });
    return { ctx, tex, mat };
  }, [layers, intensity]);
  useDisposable(useMemo(() => [face.tex, face.mat], [face]));
  const g = useRef({ getWalk, getDontWalk, getCountdown });
  g.current = { getWalk, getDontWalk, getCountdown };
  const last = useRef(-1);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const walk = ledOn(g.current.getWalk(), t);
    const hand = ledOn(g.current.getDontWalk(), t);
    let n = -1;
    if (countdown) {
      const v = g.current.getCountdown?.() ?? null;
      n = v === null || v < 0 || !Number.isFinite(v) ? -1 : Math.min(99, Math.ceil(v));
    }
    const state = (walk ? 1 : 0) + (hand ? 2 : 0) + (n + 1) * 4;
    if (state === last.current) return;
    last.current = state;
    const { ctx, tex } = face;
    const L = layers.layout;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, L.W, L.H);
    const [sx, sy] = L.symbol;
    if (hand) ctx.drawImage(layers.hand, sx, sy);
    if (walk) ctx.drawImage(layers.person, sx, sy);
    if (n >= 0 && L.digits.length === 2) {
      if (n >= 10) ctx.drawImage(layers.digits[Math.floor(n / 10)]!, L.digits[0]![0], L.digits[0]![1]);
      ctx.drawImage(layers.digits[n % 10]!, L.digits[1]![0], L.digits[1]![1]);
    }
    tex.needsUpdate = true;
  });

  const zFace = (mount === 'bracket' ? P.bracketStandoff : 0) + P.depth + 0.012;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={geo} material={vcMaterial()} castShadow receiveShadow />
      <mesh geometry={planeGeo(FACE_W, FACE_H)} material={face.mat} position={[0, 0, zFace]} />
    </group>
  );
}
