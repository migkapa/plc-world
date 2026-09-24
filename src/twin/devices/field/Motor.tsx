/**
 * TEFC 3-phase induction motor (NEMA T-frame proportions) and a right-angle helical-bevel gear motor.
 *
 *  <Motor>      origin: floor plane, centered under the feet (foot mount) — shaft axis along +Z (drive end
 *               faces +Z) at height `MOTOR_FRAMES[frame].shaftHeight`.
 *               With `mount="flange"` the origin is the flange (drive-end) face center on the shaft axis.
 *  <GearMotor>  origin: output shaft axis at the gearbox mounting face (machine side); output axis along Z,
 *               the gearbox body extends toward +Z, motor axis parallel to X (see `hand`).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { MotorProps, Placement, Vec3 } from '../../contracts';
import {
  box,
  canvasTex,
  Cable,
  type CableRoute,
  CapScrew,
  cylY,
  cylZ,
  fm,
  geo,
  HexBolt,
  hexGeo,
  latheZ,
  mat,
  merged,
  Merge,
  PanScrew,
  rbox,
  RoutedCable,
  sphere,
  TAU,
  tex,
  torus,
  useSpin,
  clickable,
} from './shared';

export type MotorFrame = 'small' | 'medium' | 'large';

export interface MotorFrameSpec {
  /** NEMA "D": shaft centerline height above the foot plane. */
  shaftHeight: number;
  /** Frame core radius (fin roots). */
  bodyR: number;
  finH: number;
  finCount: number;
  bodyLen: number;
  deLen: number;
  ndeLen: number;
  fanLen: number;
  shaftR: number;
  shaftLen: number;
  /** NEMA 2E (foot hole spacing across) and 2F (along the shaft). */
  e2: number;
  f2: number;
  nameplate: string[];
}

export const MOTOR_FRAMES: Record<MotorFrame, MotorFrameSpec> = {
  small: {
    shaftHeight: 0.0889,
    bodyR: 0.066,
    finH: 0.009,
    finCount: 36,
    bodyLen: 0.165,
    deLen: 0.028,
    ndeLen: 0.02,
    fanLen: 0.068,
    shaftR: 0.0111,
    shaftLen: 0.057,
    e2: 0.1397,
    f2: 0.127,
    nameplate: ['3~ INDUCTION MOTOR   TEFC', 'HP 1   kW 0.75   FR 143T', 'V 230/460   A 3.0/1.5   Hz 60', 'RPM 1755   SF 1.15   INS F', 'NEMA DES B   EFF 85.5%   IP55'],
  },
  medium: {
    shaftHeight: 0.1143,
    bodyR: 0.09,
    finH: 0.013,
    finCount: 42,
    bodyLen: 0.25,
    deLen: 0.035,
    ndeLen: 0.025,
    fanLen: 0.095,
    shaftR: 0.0143,
    shaftLen: 0.07,
    e2: 0.1905,
    f2: 0.1397,
    nameplate: ['3~ INDUCTION MOTOR   TEFC', 'HP 5   kW 3.7   FR 184T', 'V 230/460   A 13.2/6.6   Hz 60', 'RPM 1750   SF 1.15   INS F', 'NEMA DES B   EFF 89.5%   IP55'],
  },
  large: {
    shaftHeight: 0.1588,
    bodyR: 0.125,
    finH: 0.018,
    finCount: 48,
    bodyLen: 0.36,
    deLen: 0.045,
    ndeLen: 0.03,
    fanLen: 0.13,
    shaftR: 0.0206,
    shaftLen: 0.095,
    e2: 0.254,
    f2: 0.254,
    nameplate: ['3~ INDUCTION MOTOR   TEFC', 'HP 20   kW 15   FR 256T', 'V 230/460   A 48/24   Hz 60', 'RPM 1765   SF 1.15   INS F', 'NEMA DES B   EFF 93.0%   IP55'],
  },
};

/** Default motor paint (industrial blue-gray). */
export const MOTOR_BLUE = '#3b5875';

/** Overall length from the fan-cover end to the drive-end face (excluding the shaft). */
export function motorBodyLength(frame: MotorFrame = 'medium') {
  const s = MOTOR_FRAMES[frame];
  return s.deLen + s.bodyLen + s.ndeLen + s.fanLen;
}

/**
 * Fin tip radius at angle `a` (0 = +X, CCW toward +Y). Cast-iron TEFC frames have fins whose tips form a
 * rounded-square envelope (tallest at the diagonals) rather than a circle.
 */
export function motorFinTip(frame: MotorFrame, a: number) {
  const s = MOTOR_FRAMES[frame];
  const sq = s.bodyR + s.finH * 0.8;
  const c = Math.abs(Math.cos(a));
  const n = Math.abs(Math.sin(a));
  return Math.min(sq / Math.pow(c ** 4 + n ** 4, 0.25), s.bodyR + s.finH * 2.1);
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

function finAngles(frame: MotorFrame, feet: boolean) {
  const s = MOTOR_FRAMES[frame];
  const gaps: [number, number][] = [[-0.3, 0.3]]; // conduit box pad (+X)
  if (feet) gaps.push([TAU * 0.62, TAU * 0.88]); // feet (bottom)
  const inGap = (a: number) =>
    gaps.some(([a0, a1]) => {
      const x = ((a % TAU) + TAU) % TAU;
      const lo = ((a0 % TAU) + TAU) % TAU;
      const hi = ((a1 % TAU) + TAU) % TAU;
      return lo < hi ? x >= lo && x <= hi : x >= lo || x <= hi;
    });
  const fins: number[] = [];
  for (let i = 0; i < s.finCount; i++) {
    const a = (i / s.finCount) * TAU + Math.PI / s.finCount;
    if (!inGap(a)) fins.push(a);
  }
  return fins;
}

/** Bevel that rounds the fin ends; plate pads must sit outside tip + FIN_BEVEL. */
const FIN_BEVEL = 0.0015;

function finnedFrameGeo(frame: MotorFrame, feet: boolean) {
  return geo(`motorFrame2:${frame}:${feet}`, () => {
    const s = MOTOR_FRAMES[frame];
    const R = s.bodyR;
    const fins = finAngles(frame, feet);
    const baseHalf = (R * 0.08) / 2 / R;
    const pts: THREE.Vector2[] = [];
    const P = (r: number, a: number) => pts.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
    let prev = fins[fins.length - 1]! - TAU + baseHalf;
    for (const a of fins) {
      const tip = motorFinTip(frame, a);
      const h = tip - R;
      const tipHalf = (R * 0.036) / 2 / tip;
      const start = a - baseHalf;
      const span = start - prev;
      const steps = Math.max(1, Math.ceil(span / 0.07));
      for (let j = 1; j < steps; j++) P(R, prev + (span * j) / steps);
      P(R, start);
      // thick root fillet, tapering fin, rounded tip
      P(R + h * 0.1, a - baseHalf * 0.7);
      P(R + h * 0.3, a - baseHalf * 0.5);
      P(tip - h * 0.1, a - tipHalf);
      P(tip, a - tipHalf * 0.4);
      P(tip, a + tipHalf * 0.4);
      P(tip - h * 0.1, a + tipHalf);
      P(R + h * 0.3, a + baseHalf * 0.5);
      P(R + h * 0.1, a + baseHalf * 0.7);
      P(R, a + baseHalf);
      prev = a + baseHalf;
    }
    const shape = new THREE.Shape(pts);
    const bt = 0.003;
    const g = new THREE.ExtrudeGeometry(shape, { depth: s.bodyLen - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: FIN_BEVEL, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -s.deLen - s.bodyLen + bt);
    g.computeVertexNormals();
    return g;
  });
}

/** Distance from the axis of a flat plate (normal at angle `a`, half-width `hw`) resting on the fin tips. */
function plateSeat(frame: MotorFrame, feet: boolean, a: number, hw: number) {
  let d = MOTOR_FRAMES[frame].bodyR;
  for (const f of finAngles(frame, feet)) {
    let da = f - a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const tip = motorFinTip(frame, f) + FIN_BEVEL;
    if (Math.abs(tip * Math.sin(da)) <= hw + 0.004) d = Math.max(d, tip * Math.cos(da));
  }
  return d;
}

// ---------------------------------------------------------------------------
// Overload heat: per-instance cast material with an axial hot spot (world space)
// ---------------------------------------------------------------------------

interface HeatUniforms {
  uHeat: { value: number };
  uHeatC: { value: THREE.Vector3 };
  uHeatAx: { value: THREE.Vector3 };
  uHeatHalf: { value: number };
}

/** Clone of the cast paint whose emissive glows (weakly, <= 0.12) around the frame middle when `uHeat` > 0. */
function hotCastMaterial(color: string) {
  const m = fm.cast(color).clone();
  const u: HeatUniforms = {
    uHeat: { value: 0 },
    uHeatC: { value: new THREE.Vector3() },
    uHeatAx: { value: new THREE.Vector3(0, 0, 1) },
    uHeatHalf: { value: 0.15 },
  };
  m.userData.heat = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeatW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeatW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeatW;\nuniform float uHeat; uniform vec3 uHeatC; uniform vec3 uHeatAx; uniform float uHeatHalf;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 dv = vHeatW - uHeatC;
          float ax = abs(dot(dv, uHeatAx)) / uHeatHalf;
          float rad = length(dv - dot(dv, uHeatAx) * uHeatAx) / uHeatHalf;
          float hm = (1.0 - smoothstep(0.1, 1.05, ax)) * (1.0 - smoothstep(0.55, 1.1, rad));
          totalEmissiveRadiance += vec3(1.0, 0.24, 0.035) * (uHeat * hm);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'plcworld-hotcast-v1';
  return m;
}

function smokeTex() {
  return tex('f:smokePuff', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

const SMOKE_N = 7;
const SMOKE_LIFE = 2.6;

/** Thin wisps of smoke curling up from the frame / conduit box while overloaded (world-up = local +Y). */
function OverheatSmoke({ get, position, spread }: { get: () => boolean; position: Vec3; spread: number }) {
  const sprites = useRef<(THREE.Sprite | null)[]>([]);
  const mats = useMemo(
    () =>
      Array.from(
        { length: SMOKE_N },
        () => new THREE.SpriteMaterial({ map: smokeTex(), color: '#8d9093', transparent: true, depthWrite: false, opacity: 0 }),
      ),
    [],
  );
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  const level = useRef(0);
  useFrame(({ clock }, dt) => {
    level.current += ((get() ? 1 : 0) - level.current) * Math.min(1, dt * 0.8);
    const lv = level.current;
    const t = clock.elapsedTime;
    for (let i = 0; i < SMOKE_N; i++) {
      const sp = sprites.current[i];
      if (!sp) continue;
      sp.visible = lv > 0.02;
      if (!sp.visible) continue;
      const age = ((t + (i * SMOKE_LIFE) / SMOKE_N) % SMOKE_LIFE) / SMOKE_LIFE;
      const seed = i * 1.7;
      sp.position.set(
        Math.sin(seed * 3.1) * spread + Math.sin(t * 0.9 + seed) * 0.02 * age,
        age * 0.32,
        Math.cos(seed * 2.3) * spread * 1.6 + age * 0.04,
      );
      const sz = 0.03 + age * 0.13;
      sp.scale.set(sz, sz, 1);
      mats[i]!.opacity = lv * 0.3 * Math.sin(Math.PI * Math.min(1, age * 1.15)) * (1 - age * 0.5);
    }
  });
  return (
    <group position={position} userData={{ noMerge: true }}>
      {mats.map((m, i) => (
        <sprite
          key={i}
          ref={(el) => {
            sprites.current[i] = el;
          }}
          material={m}
          visible={false}
          raycast={() => {}}
        />
      ))}
    </group>
  );
}

function fanGeo(frame: MotorFrame) {
  return merged(`motorFan:${frame}`, () => {
    const s = MOTOR_FRAMES[frame];
    const Rf = (s.bodyR + s.finH) * 0.93;
    const parts: THREE.BufferGeometry[] = [];
    const hub = new THREE.CylinderGeometry(Rf * 0.28, Rf * 0.3, s.fanLen * 0.45, 20);
    hub.rotateX(Math.PI / 2);
    parts.push(hub);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const b = new THREE.BoxGeometry(Rf * 0.66, 0.0025, s.fanLen * 0.42);
      b.translate(Rf * 0.28 + Rf * 0.33, 0, 0);
      b.rotateZ((i / n) * TAU);
      parts.push(b);
    }
    const ring = new THREE.TorusGeometry(Rf * 0.93, 0.0022, 6, 40);
    ring.translate(0, 0, s.fanLen * 0.2);
    parts.push(ring);
    return parts;
  });
}

function grilleAlphaTex() {
  return canvasTex(
    'fanGrille',
    512,
    512,
    (ctx, w) => {
      const c = w / 2;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, w);
      ctx.fillStyle = '#000000';
      // concentric rings of radial slots (stamped fan cover)
      const bands: [number, number, number][] = [
        [0.3, 0.48, 18],
        [0.53, 0.72, 30],
        [0.77, 0.95, 42],
      ];
      for (const [r0, r1, n] of bands) {
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * TAU + 0.02;
          const a1 = ((i + 1) / n) * TAU - (TAU / n) * 0.42;
          ctx.beginPath();
          ctx.arc(c, c, r1 * c, a0, a1);
          ctx.arc(c, c, r0 * c, a1, a0, true);
          ctx.closePath();
          ctx.fill();
        }
      }
    },
    { color: false },
  );
}

function nameplateTex(lines: string[]) {
  return canvasTex(
    `motorNameplate:${lines.join('|')}`,
    512,
    300,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#d9dcde');
      g.addColorStop(0.5, '#c3c7ca');
      g.addColorStop(1, '#d4d7d9');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2b2f33';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = '#23282d';
      ctx.fillRect(14, 14, w - 28, 50);
      ctx.fillStyle = '#e8eaec';
      ctx.font = '700 32px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lines[0] ?? '', w / 2, 40);
      ctx.fillStyle = '#1e2226';
      ctx.font = '600 30px "JetBrains Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      lines.slice(1).forEach((l, i) => ctx.fillText(l, 30, 96 + i * 50));
    },
  );
}

function arrowDecalTex() {
  return canvasTex('motorArrow', 256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f2f2ee';
    ctx.beginPath();
    ctx.moveTo(8, h / 2 - 22);
    ctx.lineTo(w - 90, h / 2 - 22);
    ctx.lineTo(w - 90, h / 2 - 50);
    ctx.lineTo(w - 8, h / 2);
    ctx.lineTo(w - 90, h / 2 + 50);
    ctx.lineTo(w - 90, h / 2 + 22);
    ctx.lineTo(8, h / 2 + 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#23272b';
    ctx.font = '800 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ROTATION', (w - 90) / 2 + 6, h / 2 + 1);
  });
}

// ---------------------------------------------------------------------------
// Motor body (axis coordinates)
// ---------------------------------------------------------------------------

export interface MotorBodyProps {
  frame: MotorFrame;
  color: string;
  getRpm?: () => number;
  getAngle?: () => number;
  getOverloaded?: () => boolean;
  /** Per-instance cast material (from `Motor`, so the feet share the heat glow). Created here when omitted. */
  castMaterial?: THREE.MeshStandardMaterial;
  /** Cast feet below the frame (leaves the un-finned foot band). Default false (footless C-face / B5). */
  feet?: boolean;
  /** Draw a B5/C-face flange at the drive end. */
  flange?: boolean;
  /** Draw the shaft extension (false when it disappears into a gearbox adapter). */
  shaft?: boolean;
  coupling?: 'none' | 'hub';
  /** Conduit stub: 'floor' routes flexible conduit down by `conduitDrop`, 'short' ends right below the box,
   *  'gland' = cable gland on the box end with a black power cable (routed per `cableTo`). */
  conduit?: 'none' | 'short' | 'floor' | 'gland';
  conduitDrop?: number;
  /** Route of the power cable ('gland' / 'short'), see CableRoute. */
  cableTo?: CableRoute;
  /** Device root (its parent defines the coordinates of `cableTo`). */
  rootRef?: RefObject<THREE.Object3D | null>;
  nameplate?: string[];
  /** Angle (rad, around the axis from +X toward +Y) of the nameplate. */
  nameplateAngle?: number;
  /** Rotate the nameplate 180° in its plane (for mounts where the motor is rolled). */
  nameplateFlip?: boolean;
  liftingEye?: boolean;
}

const _hc = new THREE.Vector3();

function nameplateMat(lines: string[]) {
  return fm.plate(nameplateTex(lines));
}

/** Elastomer jaw coupling (L-type): hub A on the motor shaft, 6-lobe spider between interleaved jaws, hub B. */
function jawSegmentGeo(frame: MotorFrame, rOut: number, rIn: number, len: number, span: number) {
  return geo(`jawSeg:${frame}:${span.toFixed(3)}:${len.toFixed(4)}`, () => {
    const sh = new THREE.Shape();
    sh.absarc(0, 0, rOut, -span / 2, span / 2, false);
    sh.absarc(0, 0, rIn, span / 2, -span / 2, true);
    const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 8 });
    return g;
  });
}

/**
 * The motor in "axis coordinates": shaft axis = Z axis, drive-end face at z = 0, body toward -Z.
 * Reusable by gear motors and the tank agitator.
 */
export function MotorBody({
  frame,
  color,
  getRpm,
  getAngle,
  getOverloaded,
  castMaterial,
  feet = false,
  flange = false,
  shaft = true,
  coupling = 'none',
  conduit = 'short',
  conduitDrop = 0.1,
  cableTo,
  rootRef,
  nameplate,
  nameplateAngle = 0.95,
  nameplateFlip = false,
  liftingEye = true,
}: MotorBodyProps) {
  const s = MOTOR_FRAMES[frame];
  const R = s.bodyR;
  const Rt = R + s.finH;
  const z0 = -(s.deLen + s.bodyLen); // frame back face
  const zb = z0 - s.ndeLen; // NDE bell back
  const Rf = Rt * 0.97; // fan cover radius
  const zf = zb - s.fanLen + s.ndeLen * 0.5; // fan cover end
  const sc = R / 0.09; // scale relative to the medium frame
  const ownRoot = useRef<THREE.Group>(null);

  // Per-instance cast material (overload glow) unless the Motor passes its own.
  const ownMat = useMemo(() => (castMaterial ? null : hotCastMaterial(color)), [castMaterial, color]);
  useEffect(() => () => ownMat?.dispose(), [ownMat]);
  const castMat = (castMaterial ?? ownMat)!;
  const coverMat = mat(`f:motorCover:${color}`, () => {
    const m = fm.sheet(color, 0.38).clone();
    m.side = THREE.DoubleSide;
    return m;
  });
  const grilleMat = mat(`f:motorGrille:${color}`, () => {
    const m = fm.sheet(color, 0.4).clone();
    m.alphaMap = grilleAlphaTex();
    m.alphaTest = 0.5;
    m.side = THREE.DoubleSide;
    return m;
  });

  const rotor = useRef<THREE.Group>(null);
  useSpin(rotor, getRpm, 'z', 1, getAngle);

  const axisGrp = useRef<THREE.Group>(null);
  const heat = useRef(0);
  useFrame(({ clock }, dt) => {
    const u = castMat.userData.heat as HeatUniforms | undefined;
    if (!u) return;
    const ov = getOverloaded?.() ?? false;
    heat.current += ((ov ? 1 : 0) - heat.current) * Math.min(1, dt * 0.7);
    // weak glow (<= 0.12) hottest at the frame middle; slow pulse
    u.uHeat.value = heat.current * (0.09 + 0.03 * Math.sin(clock.elapsedTime * 3.2));
    const g = axisGrp.current;
    if (!g || heat.current < 0.001) return;
    _hc.set(0, 0, -s.deLen - s.bodyLen * 0.5);
    u.uHeatC.value.copy(g.localToWorld(_hc));
    u.uHeatAx.value.set(0, 0, 1).transformDirection(g.matrixWorld);
    u.uHeatHalf.value = s.bodyLen * 0.62 * g.matrixWorld.getMaxScaleOnAxis();
  });

  const deProfile: [number, number][] = [
    [R * 1.0, -s.deLen],
    [R * 1.01, -s.deLen * 0.78],
    [R * 0.97, -s.deLen * 0.55],
    [R * 0.84, -s.deLen * 0.3],
    [R * 0.62, -s.deLen * 0.13],
    [R * 0.44, -s.deLen * 0.08],
    [R * 0.4, -s.deLen * 0.05],
    [R * 0.38, 0],
    [s.shaftR * 1.35, 0],
  ];
  const ndeProfile: [number, number][] = [
    [R * 0.25, zb],
    [R * 0.8, zb],
    [R * 0.92, zb + s.ndeLen * 0.35],
    [R * 1.0, zb + s.ndeLen * 0.75],
    [R * 1.0, z0 + 0.001],
  ];
  const coverProfile: [number, number][] = [
    [Rf * 0.86, zf],
    [Rf - 0.012 * sc, zf],
    [Rf - 0.0035 * sc, zf + 0.0035 * sc],
    [Rf, zf + 0.012 * sc],
    [Rf, zb + s.ndeLen * 0.55],
    [R * 0.99, zb + s.ndeLen * 0.62],
  ];

  const boxW = 0.058 * sc;
  const boxH = 0.1 * sc;
  const boxD = 0.12 * sc;
  const boxX = R + boxW / 2 - 0.004 * sc;
  const boxZ = -s.deLen - s.bodyLen * 0.38;
  const plate = nameplate ?? s.nameplate;
  const hubR = s.shaftR * 2.2;
  const hubL = s.shaftLen * 0.5;
  const jawL = hubL * 0.42;
  // nameplate on a raised pad riveted across the fin tips
  const npW = 0.105 * sc;
  const npH = 0.062 * sc;
  const padT = 0.0025 * sc;
  const seat = plateSeat(frame, feet, nameplateAngle, npW / 2 + 0.006 * sc);
  const npZ = -s.deLen - s.bodyLen * 0.55;
  const eyeY = motorFinTip(frame, Math.PI / 2);

  const conduitEnd: Vec3 = [boxX, 0.004 * sc - boxH / 2 - 0.026 * sc - 0.006 * sc, boxZ + boxD * 0.1];
  const root = rootRef ?? ownRoot;

  return (
    <group ref={axisGrp}>
      <Merge>
        {/* finned frame */}
        <mesh geometry={finnedFrameGeo(frame, feet)} material={castMat} castShadow receiveShadow />
        {/* conduit box pad */}
        <mesh geometry={box(0.01 * sc, boxH * 0.9, boxD * 0.95)} material={castMat} position={[R - 0.001, 0.002, boxZ]} />
        {/* drive-end bracket */}
        <mesh geometry={latheZ(`de:${frame}`, deProfile, 48)} material={castMat} castShadow />
        {[0, 1, 2, 3].map((i) => {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          return (
            <group key={i} position={[Math.cos(a) * R * 0.93, Math.sin(a) * R * 0.93, -s.deLen * 0.62]}>
              <mesh geometry={cylZ(0.009 * sc, s.deLen * 0.5, 14)} material={castMat} position={[0, 0, -s.deLen * 0.2]} />
              <mesh geometry={hexGeo(0.013 * sc, 0.007 * sc)} material={fm.zinc()} position={[0, 0, 0.0055 * sc]} />
            </group>
          );
        })}
        {/* bearing cap bolts */}
        {[0, 1, 2, 3].map((i) => {
          const a = (i * Math.PI) / 2;
          return <CapScrew key={i} d={0.0045 * sc} position={[Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, 0]} />;
        })}
        {/* grease fitting */}
        <group position={[0, R * 0.72, -s.deLen * 0.32]} rotation={[-0.5, 0, 0]}>
          <mesh geometry={hexGeo(0.007 * sc, 0.005 * sc)} material={fm.brass()} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={cylY(0.0022 * sc, 0.008 * sc)} material={fm.brass()} position={[0, 0.006 * sc, 0]} />
          <mesh geometry={sphere(0.003 * sc, 10)} material={fm.brass()} position={[0, 0.011 * sc, 0]} />
        </group>

        {/* non-drive-end bracket + fan cover + grille */}
        <mesh geometry={latheZ(`nde:${frame}`, ndeProfile, 40)} material={castMat} castShadow />
        <mesh geometry={latheZ(`cover:${frame}`, coverProfile, 48)} material={coverMat} castShadow />
        <mesh geometry={torus(Rf, 0.0016 * sc, TAU, 48)} material={coverMat} position={[0, 0, (zf + zb) / 2 - 0.004 * sc]} />
        <mesh position={[0, 0, zf + 0.0006]} material={grilleMat}>
          <circleGeometry args={[Rf * 0.87, 48]} />
        </mesh>
        {/* dark cavity behind the fan so the grille reads deep */}
        <mesh geometry={cylZ(Rf * 0.96, s.fanLen * 0.5, 32, Rf * 0.96, true)} material={fm.dark()} position={[0, 0, zb - s.fanLen * 0.12]} />
        <mesh position={[0, 0, zb + 0.0005]} rotation={[0, Math.PI, 0]} material={fm.dark()}>
          <circleGeometry args={[Rf * 0.96, 32]} />
        </mesh>
        {/* rotation-direction arrow decal on the fan cover */}
        <group rotation={[0, 0, 0.35]}>
          <mesh position={[Rf + 0.0006, 0, (zf + zb) / 2 + 0.012 * sc]} rotation={[0, Math.PI / 2, 0]} material={mat('f:motorArrowMat', () => new THREE.MeshStandardMaterial({ map: arrowDecalTex(), alphaTest: 0.5, roughness: 0.5 }))}>
            <planeGeometry args={[0.045 * sc, 0.022 * sc]} />
          </mesh>
        </group>
        {[0, 1, 2].map((i) => {
          const a = Math.PI / 2 + (i * TAU) / 3;
          return <PanScrew key={i} d={0.004 * sc} position={[Math.cos(a) * Rf, Math.sin(a) * Rf, zb + s.ndeLen * 0.25]} rotation={[0, 0, 0]} />;
        })}

        {/* conduit (terminal) box on the +X side */}
        <group position={[boxX, 0.004 * sc, boxZ]}>
          <mesh geometry={rbox(boxW, boxH, boxD, 0.008 * sc)} material={castMat} castShadow />
          <mesh geometry={rbox(0.008 * sc, boxH * 1.04, boxD * 1.04, 0.003 * sc)} material={castMat} position={[boxW / 2 + 0.002 * sc, 0, 0]} />
          {[
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ].map(([a, b], i) => (
            <PanScrew key={i} d={0.0045 * sc} position={[boxW / 2 + 0.006 * sc, a! * boxH * 0.4, b! * boxD * 0.42]} rotation={[0, Math.PI / 2, 0]} />
          ))}
          {/* cable gland on the box end, power cable routed per cableTo */}
          {conduit === 'gland' && (
            <group position={[0, -boxH * 0.15, -boxD / 2]}>
              <mesh geometry={hexGeo(0.02 * sc, 0.006 * sc)} material={fm.plastic('#2b2d30', 0.5)} position={[0, 0, -0.003 * sc]} />
              <mesh geometry={cylZ(0.0085 * sc, 0.014 * sc, 18, 0.006 * sc)} material={fm.plastic('#2b2d30', 0.5)} position={[0, 0, -0.012 * sc]} />
              <RoutedCable rootRef={root} route={cableTo} from={[0, 0, -0.016 * sc]} dir={[0, 0, -1]} radius={0.005 * sc} color="#1b1c1e" lead={0.03} />
            </group>
          )}
          {(conduit === 'short' || conduit === 'floor') && (
            <group position={[0, -boxH / 2, boxD * 0.1]}>
              <mesh geometry={cylY(0.012 * sc, 0.012 * sc, 20)} material={castMat} position={[0, -0.006 * sc, 0]} />
              <mesh geometry={hexGeo(0.024 * sc, 0.008 * sc)} material={fm.zinc()} position={[0, -0.016 * sc, 0]} rotation={[Math.PI / 2, 0, 0]} />
              <mesh geometry={cylY(0.0105 * sc, 0.012 * sc, 20, 0.009 * sc)} material={fm.zinc()} position={[0, -0.026 * sc, 0]} />
              {conduit === 'floor' && (
                <>
                  <Cable
                    radius={0.0085 * sc}
                    color="#5d6166"
                    points={[
                      [0, -0.03 * sc, 0],
                      [0, -conduitDrop * 0.35, 0],
                      [0.012 * sc, -conduitDrop * 0.7, 0],
                      [0.035 * sc, -conduitDrop + 0.03 * sc, 0],
                      [0.04 * sc, -conduitDrop + 0.012 * sc, 0],
                    ]}
                  />
                  <group position={[0.04 * sc, -conduitDrop + 0.006 * sc, 0]}>
                    <mesh geometry={cylY(0.011 * sc, 0.012 * sc, 18)} material={fm.zinc()} />
                    <mesh geometry={cylY(0.022 * sc, 0.003, 24)} material={fm.zinc()} position={[0, -0.0045 * sc, 0]} />
                  </group>
                </>
              )}
            </group>
          )}
        </group>
        {conduit === 'short' && <RoutedCable rootRef={root} route={cableTo} from={conduitEnd} dir={[0, -1, 0]} radius={0.0085 * sc} color="#5d6166" lead={0.02} />}

        {/* nameplate on a raised pad riveted across the fin tips (keeps it clear of the fins) */}
        <group rotation={[0, 0, nameplateAngle]}>
          <group position={[seat, 0, npZ]} rotation={[nameplateFlip ? Math.PI : 0, Math.PI / 2, 0]}>
            <mesh geometry={rbox(npW + 0.008 * sc, npH + 0.008 * sc, padT, padT * 0.4, 1)} material={castMat} position={[0, 0, padT / 2]} />
            <mesh geometry={box(npW, npH, 0.0006)} material={fm.stainless(0.4)} position={[0, 0, padT + 0.0003]} />
            <mesh position={[0, 0, padT + 0.00065]} material={nameplateMat(plate)}>
              <planeGeometry args={[npW * 0.985, npH * 0.975]} />
            </mesh>
            {[
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1],
            ].map(([a, b], i) => (
              <mesh key={i} geometry={latheZ('rivetHead', [[0.0024, 0], [0.0021, 0.0008], [0.0012, 0.0014], [0, 0.0016]], 12)} material={fm.stainless(0.4)} position={[a! * (npW / 2 - 0.005 * sc), b! * (npH / 2 - 0.005 * sc), padT + 0.0006]} scale={sc} />
            ))}
          </group>
        </group>

        {/* lifting eye bolt */}
        {liftingEye && (
          <group position={[0, eyeY, -s.deLen - s.bodyLen * 0.45]}>
            <mesh geometry={cylY(0.012 * sc, 0.014 * sc, 16)} material={castMat} position={[0, -0.005 * sc, 0]} />
            <mesh geometry={cylY(0.009 * sc, 0.006 * sc, 16)} material={fm.zinc()} position={[0, 0.005 * sc, 0]} />
            <mesh geometry={torus(0.014 * sc, 0.0042 * sc, TAU, 24)} material={fm.zinc()} position={[0, 0.024 * sc, 0]} rotation={[0, Math.PI / 2, 0]} castShadow />
          </group>
        )}

        {/* B5 / C-face flange */}
        {flange && (
          <group>
            <mesh geometry={cylZ(R * 1.08, 0.012 * sc, 48)} material={castMat} position={[0, 0, -0.006 * sc]} castShadow />
            {[0, 1, 2, 3].map((i) => {
              const a = Math.PI / 4 + (i * Math.PI) / 2;
              return <HexBolt key={i} d={0.008 * sc} position={[Math.cos(a) * R * 0.96, Math.sin(a) * R * 0.96, 0]} rotation={[Math.PI, 0, 0]} />;
            })}
          </group>
        )}
      </Merge>

      {/* rotor parts: shaft, key, coupling, fan */}
      <group ref={rotor} userData={{ noMerge: true }}>
        <Merge>
          <mesh geometry={fanGeo(frame)} material={fm.plastic('#3a3d41', 0.55)} position={[0, 0, zf + s.fanLen * 0.35]} />
          <mesh geometry={cylZ(s.shaftR * 1.6, s.fanLen * 0.3, 16)} material={fm.dark()} position={[0, 0, zf + s.fanLen * 0.6]} />
          {shaft && (
            <>
              <mesh geometry={cylZ(s.shaftR, s.shaftLen + 0.004, 28)} material={fm.steel()} position={[0, 0, (s.shaftLen - 0.004) / 2]} castShadow />
              <mesh geometry={cylZ(s.shaftR * 0.93, 0.002, 28)} material={fm.steel()} position={[0, 0, s.shaftLen + 0.0008]} />
              <mesh geometry={box(s.shaftR * 0.5, s.shaftR * 0.3, s.shaftLen * 0.78)} material={fm.blackSteel()} position={[0, s.shaftR * 0.93, s.shaftLen * 0.52]} />
            </>
          )}
          {shaft && coupling === 'hub' && (
            <group position={[0, 0, s.shaftLen - hubL]}>
              {/* hub A (on the motor shaft) */}
              <mesh geometry={latheZ(`jawHubA:${frame}`, [[s.shaftR, 0], [hubR * 0.94, 0], [hubR, hubR * 0.06], [hubR, hubL], [s.shaftR, hubL]], 36)} material={fm.cast('#4b4f54', 0.4)} castShadow />
              {/* interleaved jaws (3 per hub) with the orange 6-lobe spider between them */}
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <mesh key={`j${i}`} geometry={jawSegmentGeo(frame, hubR * 0.99, hubR * 0.45, jawL, TAU / 6 - 0.34)} material={fm.cast('#4b4f54', 0.4)} position={[0, 0, hubL]} rotation={[0, 0, (i * TAU) / 6]} />
              ))}
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <mesh key={`s${i}`} geometry={jawSegmentGeo(frame, hubR * 0.93, hubR * 0.45, jawL, 0.32)} material={fm.plastic('#e8801a', 0.6)} position={[0, 0, hubL]} rotation={[0, 0, (i * TAU) / 6 + TAU / 12]} />
              ))}
              {/* hub B (driven side) with an empty keyed bore */}
              <mesh geometry={latheZ(`jawHubB:${frame}`, [[s.shaftR, 0], [hubR, 0], [hubR, hubL - hubR * 0.06], [hubR * 0.94, hubL], [s.shaftR, hubL]], 36)} material={fm.cast('#4b4f54', 0.4)} position={[0, 0, hubL + jawL]} castShadow />
              <mesh position={[0, 0, hubL * 2 + jawL + 0.0003]} material={fm.dark()}>
                <circleGeometry args={[s.shaftR * 1.01, 24]} />
              </mesh>
              <mesh geometry={box(s.shaftR * 0.5, s.shaftR * 0.3, 0.001)} material={fm.dark()} position={[0, s.shaftR * 1.1, hubL * 2 + jawL + 0.0004]} />
              {/* paint stripes to see rotation + set screws */}
              <mesh geometry={box(hubR * 0.25, 0.001, hubL * 0.9)} material={fm.plastic('#f1f1ec', 0.5)} position={[0, hubR + 0.0003, hubL / 2]} />
              <mesh geometry={box(hubR * 0.25, 0.001, hubL * 0.9)} material={fm.plastic('#f1f1ec', 0.5)} position={[0, hubR + 0.0003, hubL * 1.5 + jawL]} />
              <CapScrew d={0.005 * sc} position={[0, -hubR, hubL * 0.5]} rotation={[Math.PI / 2, 0, 0]} />
              <CapScrew d={0.005 * sc} position={[0, -hubR, hubL * 1.5 + jawL]} rotation={[Math.PI / 2, 0, 0]} />
            </group>
          )}
        </Merge>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Motor (public)
// ---------------------------------------------------------------------------

export interface MotorExtraProps {
  /** 'foot' (default, origin on the floor) or 'flange' (origin at the drive-end flange face). */
  mount?: 'foot' | 'flange';
  /** Jaw coupling on the shaft (default true for foot mount). */
  coupling?: boolean;
  /** Draw a painted steel sub-base under the feet. */
  baseplate?: boolean;
  /** Override the shaft angle (radians) instead of integrating getRpm. */
  getShaftAngle?: () => number;
  /** Flange mount: route of the conduit / power cable (default: floor stub). Foot mount uses a floor conduit. */
  cableTo?: CableRoute;
  /** Smoke wisps while overloaded (default true). */
  overloadSmoke?: boolean;
  onClick?: () => void;
}

export function Motor({
  getRpm,
  frame = 'medium',
  color = MOTOR_BLUE,
  getOverloaded,
  mount = 'foot',
  coupling,
  baseplate = false,
  getShaftAngle,
  cableTo,
  overloadSmoke = true,
  onClick,
  position,
  rotation,
  scale,
}: MotorProps & MotorExtraProps) {
  const s = MOTOR_FRAMES[frame];
  const sc = s.bodyR / 0.09;
  const root = useRef<THREE.Group>(null);
  const vib = useRef<THREE.Group>(null);
  // one per-instance cast material for frame, bells, box AND feet (overload glow must cover all of them)
  const castMat = useMemo(() => hotCastMaterial(color), [color]);
  useEffect(() => () => castMat.dispose(), [castMat]);
  const baseH = baseplate ? 0.02 * sc : 0;

  useFrame(({ clock }) => {
    const g = vib.current;
    if (!g) return;
    if (getOverloaded?.()) {
      const t = clock.elapsedTime;
      g.position.set(Math.sin(t * 113) * 0.0006, Math.sin(t * 97 + 1) * 0.0005, Math.sin(t * 71) * 0.0003);
      g.rotation.z = Math.sin(t * 89) * 0.002;
    } else if (g.position.x !== 0 || g.position.y !== 0) {
      g.position.set(0, 0, 0);
      g.rotation.z = 0;
    }
  });

  const zc = s.deLen + s.bodyLen / 2; // axis-coord offset that centers the frame on the feet
  const footT = 0.013 * sc;
  const padW = 0.04 * sc;
  const footLen = s.f2 + 0.055 * sc;

  const footGeo = geo(`motorFoot:${frame}`, () => {
    const R = s.bodyR;
    const D = s.shaftHeight;
    const xo = s.e2 / 2 + padW / 2;
    const xi = s.e2 / 2 - padW / 2;
    const a1 = (285 / 360) * TAU;
    const a2 = (332 / 360) * TAU;
    const sh = new THREE.Shape();
    sh.moveTo(xi, 0);
    sh.lineTo(xo, 0);
    sh.lineTo(xo, footT);
    sh.lineTo(xo - 0.006 * sc, footT + 0.004 * sc);
    sh.lineTo(Math.cos(a2) * R * 0.98, D + Math.sin(a2) * R * 0.98);
    for (let i = 1; i <= 8; i++) {
      const a = a2 + ((a1 - a2) * i) / 8;
      sh.lineTo(Math.cos(a) * R * 0.98, D + Math.sin(a) * R * 0.98);
    }
    sh.lineTo(xi, footT + 0.003 * sc);
    sh.lineTo(xi, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: footLen - 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 1 });
    g.translate(0, 0, -(footLen - 0.004) / 2);
    return g;
  });

  const body = (
    <MotorBody
      frame={frame}
      color={color}
      castMaterial={castMat}
      feet={mount === 'foot'}
      getRpm={getRpm}
      getAngle={getShaftAngle}
      getOverloaded={getOverloaded}
      flange={mount === 'flange'}
      coupling={(coupling ?? mount === 'foot') ? 'hub' : 'none'}
      conduit={mount === 'foot' ? 'floor' : 'short'}
      conduitDrop={s.shaftHeight + baseH}
      cableTo={cableTo}
      rootRef={root}
    />
  );

  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} {...clickable(onClick)}>
      <group ref={vib}>
        {mount === 'foot' ? (
          <group position={[0, baseH, 0]}>
            <group position={[0, s.shaftHeight, zc]}>{body}</group>
            <Merge>
              {[1, -1].map((side) => (
                <mesh key={side} geometry={footGeo} material={castMat} scale={[side, 1, 1]} castShadow receiveShadow />
              ))}
              {[
                [1, 1],
                [1, -1],
                [-1, 1],
                [-1, -1],
              ].map(([a, b], i) => (
                <HexBolt key={i} d={0.01 * sc} position={[(a! * s.e2) / 2, footT, (b! * s.f2) / 2]} rotation={[-Math.PI / 2, 0, 0]} />
              ))}
            </Merge>
          </group>
        ) : (
          body
        )}
      </group>
      {getOverloaded && overloadSmoke && (
        <OverheatSmoke
          get={getOverloaded}
          position={mount === 'foot' ? [s.bodyR * 0.6, s.shaftHeight + baseH + s.bodyR + s.finH, zc - s.deLen - s.bodyLen * 0.45] : [s.bodyR * 0.6, s.bodyR + s.finH, -s.deLen - s.bodyLen * 0.45]}
          spread={s.bodyR * 0.25}
        />
      )}
      {baseplate && mount === 'foot' && (
        <mesh geometry={rbox(s.e2 + 0.1 * sc, baseH, footLen + 0.16 * sc, 0.003)} material={fm.sheet('#3d4247', 0.5)} position={[0, baseH / 2, 0.02 * sc]} receiveShadow castShadow />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Gear motor (right-angle helical-bevel, shaft-mounted)
// ---------------------------------------------------------------------------

export interface GearMotorProps extends Placement {
  /** Motor speed in RPM (fan & rotor). */
  getRpm?: () => number;
  /** Motor shaft angle in radians (overrides getRpm; e.g. derived from a belt position). */
  getMotorAngle?: () => number;
  /** Gear ratio (output turns = motor turns / ratio). */
  ratio?: number;
  /** Motor on the left (-X, default) or right (+X) of the gearbox. */
  hand?: 'left' | 'right';
  color?: string;
  motorFrame?: MotorFrame;
  getOverloaded?: () => boolean;
  /** Torque arm length (m) from the housing boss to the rubber-bushed pin; 0 = none. */
  torqueArm?: number;
  /** Torque arm direction: angle (rad) around the output axis from straight down (-Y) toward +X. */
  torqueArmAngle?: number;
  /** Route of the motor power cable (default: floor stub). */
  cableTo?: CableRoute;
}

/** Key dimensions of the gear motor (for mounting). */
export const GEARMOTOR = {
  /** Output hollow shaft radius. */
  boreR: 0.02,
  /** Gearbox depth along the output axis. */
  depth: 0.15,
  /** Motor axis offset from the output axis along the output direction (+Z). */
  inputZ: 0.095,
  /** Distance from the output axis to the motor flange along X. */
  flangeX: 0.1,
  /** Torque-arm boss radius (arm starts here) and arm plane (z, machine side). */
  armR0: 0.05,
  armZ: -0.007,
};

/** Center of the torque-arm pin (gear-motor coordinates) for a given arm length & angle. */
export function gearMotorTorqueArmEnd(length: number, angle = 0): Vec3 {
  const r = GEARMOTOR.armR0 + length;
  return [Math.sin(angle) * r, -Math.cos(angle) * r, GEARMOTOR.armZ];
}

function gearNameplateTex(ratio: number) {
  return canvasTex(`gearNP:${ratio}`, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#cdd1d4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#1d2125';
    ctx.font = '700 19px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HELICAL-BEVEL', 12, 24);
    ctx.font = '600 20px "JetBrains Mono", monospace';
    ctx.fillText(`i = ${ratio.toFixed(2)}`, 14, 56);
    ctx.fillText(`n2 = ${Math.round(1750 / ratio)} rpm`, 14, 82);
    ctx.fillText('M4  CLP 220', 14, 106);
  });
}

export function GearMotor({
  getRpm,
  getMotorAngle,
  ratio = 25.3,
  hand = 'left',
  color = MOTOR_BLUE,
  motorFrame = 'small',
  getOverloaded,
  torqueArm = 0.14,
  torqueArmAngle = 0,
  cableTo,
  position,
  rotation,
  scale,
}: GearMotorProps) {
  const cast = fm.cast(color);
  const sgn = hand === 'left' ? -1 : 1;
  const { depth, inputZ, flangeX, boreR, armR0, armZ } = GEARMOTOR;
  const root = useRef<THREE.Group>(null);
  const out = useRef<THREE.Group>(null);
  const motorAngle = useRef(0);
  // integrate once here so the motor and the output stay in sync
  useFrame((_, dt) => {
    if (getMotorAngle) motorAngle.current = getMotorAngle();
    else if (getRpm) motorAngle.current += (getRpm() / 60) * TAU * Math.min(dt, 0.1);
    if (out.current) out.current.rotation.z = -motorAngle.current / ratio;
  });
  const getAngle = useMemo(() => () => motorAngle.current, []);
  const armLen = armR0 + torqueArm;

  return (
    <group ref={root} position={position} rotation={rotation} scale={scale}>
      <Merge>
        {/* main housing: rounded lower part around the output, block above for the helical stages */}
        <mesh geometry={rbox(0.15, 0.15, depth - 0.012, 0.024, 3)} material={cast} position={[sgn * 0.004, 0.036, depth / 2 + 0.006]} castShadow receiveShadow />
        <mesh geometry={cylZ(0.075, depth - 0.02, 48)} material={cast} position={[sgn * 0.004, 0, depth / 2 + 0.006]} castShadow />
        {/* housing split flange */}
        <mesh geometry={rbox(0.156, 0.007, depth - 0.006, 0.003, 2)} material={cast} position={[sgn * 0.004, 0.07, depth / 2 + 0.006]} />
        {/* output hub bosses */}
        <mesh geometry={cylZ(0.052, depth + 0.012, 40)} material={cast} position={[0, 0, depth / 2]} castShadow />
        <mesh geometry={cylZ(0.042, 0.012, 40)} material={fm.aluminum(0.45)} position={[0, 0, depth + 0.012]} />
        {/* shaft cover cap (far side) */}
        <mesh geometry={latheZ('gmCap', [[0.036, 0], [0.036, 0.012], [0.03, 0.02], [0.0, 0.022]], 32)} material={fm.plastic('#26282b', 0.5)} position={[0, 0, depth + 0.018]} />
        {/* cast ribs on the outer face */}
        {[-2.3, 2.3, Math.PI].map((a, i) => (
          <mesh key={i} geometry={box(0.006, 0.02, 0.006)} material={cast} position={[Math.sin(a) * 0.062 + sgn * 0.004, Math.cos(a) * 0.062, depth + 0.003]} rotation={[0, 0, -a]} />
        ))}
        {/* housing bolts along the split line */}
        {[-0.055, 0.055].map((x, i) => (
          <HexBolt key={i} d={0.007} position={[x + sgn * 0.004, 0.085, depth + 0.001]} />
        ))}
        {/* input (bevel stage) section + motor adapter */}
        <group position={[sgn * 0.074, 0, inputZ]}>
          <mesh
            geometry={geo('gmAdapter', () => {
              const g = new THREE.CylinderGeometry(0.058, 0.062, 0.03, 40);
              g.rotateZ(Math.PI / 2);
              return g;
            })}
            material={cast}
            position={[sgn * 0.012, 0, 0]}
            castShadow
          />
          <mesh
            geometry={geo('gmFlange', () => {
              const g = new THREE.CylinderGeometry(0.074, 0.074, 0.012, 40);
              g.rotateZ(Math.PI / 2);
              return g;
            })}
            material={cast}
            position={[sgn * (flangeX - 0.074 - 0.006), 0, 0]}
          />
        </group>
        {/* oil plugs & breather */}
        <group position={[sgn * 0.02, 0.11, depth * 0.55]}>
          <mesh geometry={hexGeo(0.014, 0.006)} material={fm.brass()} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={cylY(0.004, 0.012, 12)} material={fm.brass()} position={[0, 0.009, 0]} />
          <mesh geometry={sphere(0.0065, 12)} material={fm.brass()} position={[0, 0.017, 0]} />
        </group>
        <mesh geometry={hexGeo(0.012, 0.006)} material={fm.zinc()} position={[sgn * -0.05, 0.03, depth + 0.003]} />
        <mesh geometry={hexGeo(0.012, 0.006)} material={fm.zinc()} position={[sgn * -0.05, -0.06, depth + 0.003]} />
        {/* nameplate (printed, dielectric) */}
        <mesh position={[sgn * 0.004, 0.095, depth + 0.0003]} material={fm.plate(gearNameplateTex(ratio))}>
          <planeGeometry args={[0.06, 0.026]} />
        </mesh>
        {/* torque arm: flat bar bolted to the machine-side housing face, rubber-bushed pin at the end */}
        {torqueArm > 0 && (
          <group rotation={[0, 0, torqueArmAngle]}>
            <mesh
              geometry={geo(`gmArm:${torqueArm.toFixed(3)}`, () => {
                const sh = new THREE.Shape();
                const w0 = 0.036;
                const w1 = 0.03;
                sh.moveTo(-w0 / 2, -armR0 + 0.03);
                sh.lineTo(-w1 / 2, -armLen);
                sh.absarc(0, -armLen, w1 / 2, Math.PI, TAU, false);
                sh.lineTo(w0 / 2, -armR0 + 0.03);
                sh.absarc(0, -armR0 + 0.03, w0 / 2, 0, Math.PI, false);
                const h = new THREE.Path();
                h.absarc(0, -armLen, 0.009, 0, TAU, true);
                sh.holes.push(h);
                const g = new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 16 });
                g.translate(0, 0, -0.005);
                return g;
              })}
              material={fm.sheet('#2e3134', 0.5)}
              position={[0, 0, armZ]}
              castShadow
            />
            {[-0.011, 0.011].map((x) => (
              <HexBolt key={x} d={0.007} position={[x, -armR0 + 0.018, armZ - 0.006]} rotation={[Math.PI, 0, 0]} />
            ))}
            {/* rubber buffer bushing + through bolt */}
            <mesh geometry={cylZ(0.014, 0.024, 20)} material={fm.rubber('#1a1a1a')} position={[0, -armLen, armZ]} />
            <mesh geometry={cylZ(0.0045, 0.075, 12)} material={fm.zinc()} position={[0, -armLen, armZ - 0.02]} />
            <HexBolt d={0.008} position={[0, -armLen, armZ + 0.012]} />
          </group>
        )}
      </Merge>
      {/* rotating output collar (machine side) */}
      <group ref={out} position={[0, 0, -0.006]} userData={{ noMerge: true }}>
        <mesh geometry={cylZ(boreR * 1.6, 0.012, 28)} material={fm.steel()} />
        <mesh geometry={box(0.006, 0.004, 0.0125)} material={fm.plastic('#f1f1ec', 0.5)} position={[0, boreR * 1.6, 0]} />
        <CapScrew d={0.005} position={[boreR * 1.6, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
      </group>
      {/* motor (footless: fins all the way round) */}
      <group position={[sgn * flangeX, 0, inputZ]} rotation={[0, hand === 'left' ? Math.PI / 2 : -Math.PI / 2, Math.PI / 2]}>
        <MotorBody
          frame={motorFrame}
          color={color}
          getAngle={getAngle}
          getOverloaded={getOverloaded}
          flange
          shaft={false}
          conduit="gland"
          cableTo={cableTo}
          rootRef={root}
          liftingEye={false}
          nameplateAngle={hand === 'left' ? Math.PI / 2 : -Math.PI / 2}
          nameplateFlip={hand === 'left'}
        />
      </group>
    </group>
  );
}
