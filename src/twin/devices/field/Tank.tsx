/**
 * 2000 L stainless mixing tank: torispherical (Klöpper) heads, brushed shell with weld seams, four pipe legs
 * with ball feet, hinged manway with swing bolts, flanged nozzles, internal baffles, immersion heater,
 * top-mounted agitator (motor + inline gearbox + lantern + shaft + 4-blade 45° pitched-blade turbine).
 *
 * The liquid is visible through a front quarter CUT-AWAY (default) or a full-height sight WINDOW
 * (`cutaway={false}`). Its free surface sits at getLevel() with ripples, a vortex/swirl when agitated and a
 * color that shifts with temperature.
 *
 * Origin: floor, on the vessel axis. `diameter` = shell diameter, `height` = straight-shell height
 * (tangent line to tangent line). Level 0 % = lowest point inside the bottom head, 100 % = top tangent line.
 * Use `tankLayout()` for nozzle positions (instrument mounting) and `<OnNozzle>` to mount devices on them.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { TankProps, Vec3 } from '../../contracts';
import { MOTOR_BLUE, MotorBody } from './Motor';
import { box, canvasTex, clickable, cylY, fm, geo, hexGeo, latheY, rbox, sphere, TAU, torus } from './shared';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface TankNozzle {
  /** Flange face center (tank coordinates). */
  position: Vec3;
  /** Outward unit direction of the nozzle axis. */
  direction: Vec3;
  /** Nominal bore (m). */
  size: number;
}

export type TankNozzleId = 'agitator' | 'inlet' | 'lt' | 'manway' | 'vent' | 'tt' | 'lsl' | 'lsh' | 'lshh' | 'outlet' | 'heater';

export interface TankLayout {
  radius: number;
  headDepth: number;
  /** Lowest outer point of the bottom head. */
  yBottom: number;
  /** Bottom / top tangent lines. */
  yT1: number;
  yT2: number;
  /** Top outer apex. */
  yTop: number;
  wall: number;
  /** y of the liquid surface for a level in %. */
  levelY: (pct: number) => number;
  nozzles: Record<TankNozzleId, TankNozzle>;
}

const LEG_CLEAR = 0.55;
const WALL = 0.005;

function headParams(D: number) {
  const a = D / 2;
  const Rc = D; // crown radius
  const rk = 0.1 * D; // knuckle radius
  const yC = -Math.sqrt((Rc - rk) ** 2 - (a - rk) ** 2);
  const hd = yC + Rc;
  const alpha = Math.atan2(a - rk, -yC);
  return { a, Rc, rk, yC, hd, alpha };
}

/** Top-head profile points [r, dy] from the tangent line (r = a) to the apex (r = 0), offset inward by `off`. */
function headProfile(D: number, off = 0, n = 10): [number, number][] {
  const { a, Rc, rk, yC, alpha } = headParams(D);
  const pts: [number, number][] = [];
  const kEnd = Math.PI / 2 - alpha;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * kEnd;
    pts.push([a - rk + (rk - off) * Math.cos(th), (rk - off) * Math.sin(th)]);
  }
  for (let i = 1; i <= n; i++) {
    const b = alpha * (1 - i / n);
    pts.push([(Rc - off) * Math.sin(b), yC + (Rc - off) * Math.cos(b)]);
  }
  return pts;
}

/** Height of the outer top-head surface above the tangent line at radius r. */
function headHeightAt(D: number, r: number) {
  const p = headProfile(D, 0, 24);
  for (let i = 0; i < p.length - 1; i++) {
    const [r0, y0] = p[i]!;
    const [r1, y1] = p[i + 1]!;
    if (r <= r0 && r >= r1) return y0 + ((r0 - r) / (r0 - r1 || 1)) * (y1 - y0);
  }
  return p[p.length - 1]![1];
}

export function tankLayout(diameter = 1.3, height = 1.25): TankLayout {
  const { a, hd } = headParams(diameter);
  const yBottom = LEG_CLEAR;
  const yT1 = yBottom + hd;
  const yT2 = yT1 + height;
  const yTop = yT2 + hd;
  const yIn0 = yBottom + WALL;
  const levelY = (pct: number) => yIn0 + (yT2 - yIn0) * THREE.MathUtils.clamp(pct, 0, 100) / 100;
  const top = (r: number, phiDeg: number, size: number, proj = 0.1): TankNozzle => {
    const phi = (phiDeg * Math.PI) / 180;
    const y = yT2 + headHeightAt(diameter, r) + proj;
    return { position: [r * Math.sin(phi), y, r * Math.cos(phi)], direction: [0, 1, 0], size };
  };
  const side = (y: number, phiDeg: number, size: number, proj = 0.12): TankNozzle => {
    const phi = (phiDeg * Math.PI) / 180;
    // radius of the vessel at height y (knuckle region approximated by an ellipse)
    let r = a;
    if (y < yT1) r = a * Math.sqrt(Math.max(0, 1 - ((yT1 - y) / hd) ** 2));
    const R = r + proj;
    return { position: [R * Math.sin(phi), y, R * Math.cos(phi)], direction: [Math.sin(phi), 0, Math.cos(phi)], size };
  };
  return {
    radius: a,
    headDepth: hd,
    yBottom,
    yT1,
    yT2,
    yTop,
    wall: WALL,
    levelY,
    nozzles: {
      agitator: { position: [0, yTop + 0.06, 0], direction: [0, 1, 0], size: 0.15 },
      inlet: top(a * 0.64, 250, 0.05),
      lt: top(a * 0.64, 105, 0.08),
      manway: top(a * 0.48, 180, 0.45, 0.12),
      vent: top(a * 0.64, 300, 0.05),
      tt: side(yT1 + 0.18, 55, 0.025, 0.1),
      lsl: side(levelY(10), 85, 0.025, 0.1),
      lsh: side(levelY(90), 80, 0.025, 0.1),
      lshh: side(levelY(97), 100, 0.025, 0.1),
      outlet: { position: [0, yBottom - 0.12, 0], direction: [0, -1, 0], size: 0.05 },
      heater: side(yT1 + 0.12, 140, 0.1, 0.1),
    },
  };
}

const _up = new THREE.Vector3(0, 1, 0);

/** Places children at a nozzle flange: local +Y = nozzle outward direction, local +Z faces the front as well as possible. */
export function OnNozzle({ nozzle, children }: { nozzle: TankNozzle; children: ReactNode }) {
  const quat = useMemo(() => {
    const d = new THREE.Vector3(...nozzle.direction).normalize();
    const pref = Math.abs(d.z) > 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const z = pref.clone().sub(d.clone().multiplyScalar(pref.dot(d))).normalize();
    const x = new THREE.Vector3().crossVectors(d, z).normalize();
    const m = new THREE.Matrix4().makeBasis(x, d, z);
    void _up;
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [nozzle.direction]);
  return (
    <group position={nozzle.position} quaternion={quat}>
      {children}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function vesselProfiles(D: number, H: number) {
  const L = tankLayout(D, H);
  const outer: [number, number][] = [];
  const hp = headProfile(D, 0, 14);
  // bottom head (apex -> tangent), shell, top head (tangent -> apex)
  for (let i = hp.length - 1; i >= 0; i--) outer.push([hp[i]![0], L.yT1 - hp[i]![1]]);
  outer.push([L.radius, L.yT2]);
  for (let i = 1; i < hp.length; i++) outer.push([hp[i]![0], L.yT2 + hp[i]![1]]);
  const hpi = headProfile(D, WALL, 14);
  const inner: [number, number][] = [];
  for (let i = hpi.length - 1; i >= 0; i--) inner.push([hpi[i]![0], L.yT1 - hpi[i]![1]]);
  inner.push([L.radius - WALL, L.yT2]);
  for (let i = 1; i < hpi.length; i++) inner.push([hpi[i]![0], L.yT2 + hpi[i]![1]]);
  return { outer, inner, L };
}

/** Sight window angular width (rad) for the non-cutaway variant. */
const WINDOW_W = 0.13;

function shellGeos(D: number, H: number, mode: 'cut' | 'window') {
  const key = `${D}:${H}:${mode}`;
  const { outer, inner, L } = vesselProfiles(D, H);
  const pieces: THREE.BufferGeometry[] = [];
  const innerPieces: THREE.BufferGeometry[] = [];
  if (mode === 'cut') {
    pieces.push(latheY(`tankOuter:${key}`, outer, 72, Math.PI / 4, (3 * Math.PI) / 2));
    innerPieces.push(latheY(`tankInner:${key}`, [...inner].reverse(), 72, Math.PI / 4, (3 * Math.PI) / 2));
  } else {
    pieces.push(latheY(`tankOuter:${key}`, outer, 72, WINDOW_W / 2, TAU - WINDOW_W));
    innerPieces.push(latheY(`tankInner:${key}`, [...inner].reverse(), 72, WINDOW_W / 2, TAU - WINDOW_W));
    // head sectors above / below the window opening
    const lowO = outer.filter(([, y]) => y <= L.yT1 + 1e-6);
    const highO = outer.filter(([, y]) => y >= L.yT2 - 1e-6);
    const lowI = inner.filter(([, y]) => y <= L.yT1 + 1e-6);
    const highI = inner.filter(([, y]) => y >= L.yT2 - 1e-6);
    pieces.push(latheY(`tankOuterLo:${key}`, lowO, 4, -WINDOW_W / 2, WINDOW_W));
    pieces.push(latheY(`tankOuterHi:${key}`, highO, 4, -WINDOW_W / 2, WINDOW_W));
    innerPieces.push(latheY(`tankInnerLo:${key}`, [...lowI].reverse(), 4, -WINDOW_W / 2, WINDOW_W));
    innerPieces.push(latheY(`tankInnerHi:${key}`, [...highI].reverse(), 4, -WINDOW_W / 2, WINDOW_W));
  }
  const capG = geo(`tankCap:${D}:${H}`, () => {
    const pts = [...outer.map(([r, y]) => new THREE.Vector2(r, y)), ...[...inner].reverse().map(([r, y]) => new THREE.Vector2(r, y))];
    return new THREE.ShapeGeometry(new THREE.Shape(pts));
  });
  return { pieces, innerPieces, capG };
}

/** Liquid body: free surface + wall + (optional) cut faces, displaced in the vertex shader. */
function liquidGeo(D: number, H: number, phiStart: number, phiLength: number, cutFaces: boolean) {
  return geo(`liquid:${D}:${H}:${phiStart.toFixed(3)}:${phiLength.toFixed(3)}:${cutFaces}`, () => {
    const L = tankLayout(D, H);
    const Rin = L.radius - WALL;
    const yTopSurf = L.yT2 + 0.001;
    const pos: number[] = [];
    const nor: number[] = [];
    const top: number[] = [];
    const NR = 20;
    const NP = Math.max(24, Math.round((phiLength / TAU) * 96));
    const P = (r: number, phi: number, y: number): [number, number, number] => [r * Math.sin(phi), y, r * Math.cos(phi)];
    const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], n: [number, number, number] | null, t: number) => {
      for (const v of [a, b, c]) {
        pos.push(...v);
        top.push(t);
      }
      if (n) for (let i = 0; i < 3; i++) nor.push(...n);
      else {
        // radial outward normals for the wall
        for (const v of [a, b, c]) {
          const l = Math.hypot(v[0], v[2]) || 1;
          nor.push(v[0] / l, 0, v[2] / l);
        }
      }
    };
    // free surface (polar grid)
    for (let i = 0; i < NR; i++) {
      const r0 = (i / NR) * Rin;
      const r1 = ((i + 1) / NR) * Rin;
      for (let j = 0; j < NP; j++) {
        const p0 = phiStart + (j / NP) * phiLength;
        const p1 = phiStart + ((j + 1) / NP) * phiLength;
        tri(P(r0, p0, yTopSurf), P(r1, p0, yTopSurf), P(r1, p1, yTopSurf), [0, 1, 0], 1);
        if (i > 0) tri(P(r0, p0, yTopSurf), P(r1, p1, yTopSurf), P(r0, p1, yTopSurf), [0, 1, 0], 1);
      }
    }
    // wall: inner bottom head + straight shell (vertices above the level get clamped in the shader)
    const hpi = headProfile(D, WALL, 12);
    const prof: [number, number][] = [];
    for (let i = hpi.length - 1; i >= 0; i--) prof.push([hpi[i]![0], L.yT1 - hpi[i]![1]]);
    for (let k = 1; k <= 4; k++) prof.push([Rin, L.yT1 + (k / 4) * (L.yT2 - L.yT1)]);
    prof.push([Rin, yTopSurf]);
    for (let i = 0; i < prof.length - 1; i++) {
      const [ra, ya] = prof[i]!;
      const [rb, yb] = prof[i + 1]!;
      for (let j = 0; j < NP; j++) {
        const p0 = phiStart + (j / NP) * phiLength;
        const p1 = phiStart + ((j + 1) / NP) * phiLength;
        tri(P(ra, p0, ya), P(rb, p1, yb), P(rb, p0, yb), null, 0);
        tri(P(ra, p0, ya), P(ra, p1, ya), P(rb, p1, yb), null, 0);
      }
    }
    // cut faces
    if (cutFaces) {
      const yb = (r: number) => {
        // inner bottom surface height at radius r
        for (let i = 0; i < prof.length - 1; i++) {
          const [r0, y0] = prof[i]!;
          const [r1, y1] = prof[i + 1]!;
          if (r >= r0 && r <= r1 && r1 > r0) return y0 + ((r - r0) / (r1 - r0)) * (y1 - y0);
        }
        return L.yT1;
      };
      const NY = 12;
      for (const phi of [phiStart, phiStart + phiLength]) {
        const sgn = phi === phiStart ? -1 : 1;
        const n: [number, number, number] = [sgn * Math.cos(phi), 0, -sgn * Math.sin(phi)];
        for (let i = 0; i < NR; i++) {
          const r0 = (i / NR) * Rin;
          const r1 = ((i + 1) / NR) * Rin;
          for (let k = 0; k < NY; k++) {
            const y00 = yb(r0) + (k / NY) * (yTopSurf - yb(r0));
            const y01 = yb(r0) + ((k + 1) / NY) * (yTopSurf - yb(r0));
            const y10 = yb(r1) + (k / NY) * (yTopSurf - yb(r1));
            const y11 = yb(r1) + ((k + 1) / NY) * (yTopSurf - yb(r1));
            const a = P(r0, phi, y00);
            const b = P(r1, phi, y10);
            const c = P(r1, phi, y11);
            const d = P(r0, phi, y01);
            if (sgn < 0) {
              tri(a, b, c, n, 0);
              tri(a, c, d, n, 0);
            } else {
              tri(a, c, b, n, 0);
              tri(a, d, c, n, 0);
            }
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
    g.computeBoundingSphere();
    return g;
  });
}

function makeLiquidMaterial(L: TankLayout) {
  const uniforms = {
    uLevel: { value: L.levelY(50) },
    uTime: { value: 0 },
    uSwirl: { value: 0 },
    uRin: { value: L.radius - WALL },
    uT1: { value: L.yT1 },
    uHd: { value: L.headDepth },
  };
  const m = new THREE.MeshStandardMaterial({
    color: '#2f86c4',
    roughness: 0.14,
    metalness: 0.05,
    transparent: true,
    opacity: 0.82,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uLevel; uniform float uTime; uniform float uSwirl; uniform float uRin; uniform float uT1; uniform float uHd;
attribute float aTop;
float liqH(vec2 p) {
  float r = clamp(length(p) / uRin, 0.0, 1.0);
  float a = atan(p.y, p.x);
  float h = 0.0022 * sin(p.x * 23.0 + uTime * 1.7) * cos(p.y * 19.0 - uTime * 1.3)
          + 0.0012 * sin((p.x + p.y) * 41.0 + uTime * 2.9);
  h += uSwirl * (0.007 * r * sin(a * 5.0 - uTime * 6.0 + r * 10.0) + 0.028 * (r * r - 0.5));
  return h;
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 lpos = position;
vec3 objectNormal = vec3( normal );
float rAt = uRin;
if (uLevel < uT1) { float q = clamp((uT1 - uLevel) / uHd, 0.0, 1.0); rAt = uRin * sqrt(max(1.0 - q * q, 0.0)); }
if (lpos.y >= uLevel) {
  float rr = length(lpos.xz);
  if (rr > rAt && rr > 1e-5) lpos.xz *= rAt / rr;
  float h = liqH(lpos.xz);
  lpos.y = uLevel + h;
  if (aTop > 0.5) {
    float e = 0.01;
    float hx = liqH(lpos.xz + vec2(e, 0.0)) - h;
    float hz = liqH(lpos.xz + vec2(0.0, e)) - h;
    objectNormal = normalize(vec3(-hx / e, 1.0, -hz / e));
  }
}`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = lpos;');
  };
  m.customProgramCacheKey = () => 'plcworld-liquid-v1';
  // back faces drawn first (inside of the liquid body), darker
  const back = m.clone();
  back.side = THREE.BackSide;
  back.onBeforeCompile = m.onBeforeCompile;
  back.customProgramCacheKey = () => 'plcworld-liquid-v1b';
  return { material: m, back, uniforms };
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function NozzleNeck({ n, flangeR, neckR }: { n: TankNozzle; flangeR: number; neckR: number }) {
  // neck pipe from the vessel surface to the flange along -direction
  const len = 0.14;
  return (
    <OnNozzle nozzle={n}>
      <mesh geometry={cylY(neckR, len, 24)} material={fm.stainless()} position={[0, -len / 2 - 0.012, 0]} castShadow />
      <mesh geometry={cylY(flangeR, 0.016, 32)} material={fm.stainless()} position={[0, -0.008, 0]} castShadow />
    </OnNozzle>
  );
}

function tankPlateTex(tag: string, volume: string) {
  return canvasTex(`tankPlate:${tag}:${volume}`, 512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d9dde0');
    g.addColorStop(1, '#b9bec2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a3f44';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#1e2226';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 64px Arial, sans-serif';
    ctx.fillText(tag, w / 2, 70);
    ctx.font = '600 28px "JetBrains Mono", monospace';
    ctx.fillText(`CAP ${volume}  MAWP ATM`, w / 2, 140);
    ctx.fillText('SS316L  2B/BRUSHED  2024', w / 2, 188);
  });
}

// ---------------------------------------------------------------------------
// Tank
// ---------------------------------------------------------------------------

export interface TankExtraProps {
  /** Heater contactor state (immersion heater elements glow). */
  getHeaterOn?: () => boolean;
  /** Tank tag on the nameplate. */
  tag?: string;
  /** Show the agitator drive & impeller (default true). */
  agitator?: boolean;
  onClick?: () => void;
}

const WARM = new THREE.Color('#d8782c');
const MID = new THREE.Color('#a7b3b1');
const _col = new THREE.Color();

export function Tank({
  getLevel,
  getTemperature,
  getAgitatorRpm,
  diameter = 1.3,
  height = 1.25,
  cutaway = true,
  liquidColor = '#2f86c4',
  getHeaterOn,
  tag = 'T-101',
  agitator = true,
  onClick,
  position,
  rotation,
  scale,
}: TankProps & TankExtraProps) {
  const L = useMemo(() => tankLayout(diameter, height), [diameter, height]);
  const a = L.radius;
  const cut = cutaway;
  const phiStart = cut ? Math.PI / 4 : 0;
  const phiLength = cut ? (3 * Math.PI) / 2 : TAU;
  const shell = shellGeos(diameter, height, cut ? 'cut' : 'window');
  const liquid = useMemo(() => makeLiquidMaterial(L), [L]);
  useEffect(
    () => () => {
      liquid.material.dispose();
      liquid.back.dispose();
    },
    [liquid],
  );
  const baseColor = useMemo(() => new THREE.Color(liquidColor), [liquidColor]);
  const impeller = useRef<THREE.Group>(null);
  const motorAngle = useRef(0);
  const shaftAngle = useRef(0);
  const swirl = useRef(0);
  const heaterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8f8a84', metalness: 0.7, roughness: 0.45, emissive: '#ff3a08', emissiveIntensity: 0 }), []);
  useEffect(() => () => heaterMat.dispose(), [heaterMat]);
  const getMotorAngle = useMemo(() => () => motorAngle.current, []);
  const ratio = 14.6;

  useFrame(({ clock }, dt) => {
    const u = liquid.uniforms;
    const lvl = getLevel();
    u.uLevel.value = L.levelY(lvl);
    u.uTime.value = clock.elapsedTime;
    const rpm = getAgitatorRpm ? getAgitatorRpm() : 0;
    const d = Math.min(dt, 0.1);
    shaftAngle.current += (rpm / 60) * TAU * d;
    motorAngle.current = shaftAngle.current * ratio;
    if (impeller.current) impeller.current.rotation.y = -shaftAngle.current;
    // swirl eases with agitator speed and only when the impeller is covered
    const target = THREE.MathUtils.clamp(rpm / 90, 0, 1) * (lvl > 25 ? 1 : lvl / 25);
    swirl.current += (target - swirl.current) * Math.min(1, d * 1.5);
    u.uSwirl.value = swirl.current;
    const T = getTemperature ? getTemperature() : 20;
    // thermal tint (cool-warm diverging map): liquidColor at <= 25 °C, milky mid tone ~55 °C, amber at >= 90 °C
    const tt = THREE.MathUtils.smoothstep(T, 25, 90);
    if (tt < 0.5) _col.copy(baseColor).lerp(MID, tt * 2);
    else _col.copy(MID).lerp(WARM, tt * 2 - 1);
    liquid.material.color.copy(_col);
    liquid.back.color.copy(_col).multiplyScalar(0.6);
    const heat = getHeaterOn?.() ?? false;
    heaterMat.emissiveIntensity += ((heat ? 0.9 : 0) - heaterMat.emissiveIntensity) * Math.min(1, d * 0.8);
  });

  const legPhis = [55, 125, 235, 305].map((d) => (d * Math.PI) / 180);
  const legR = a + 0.04;
  const legTop = L.yT1 + 0.22;
  const shellMat = fm.brushed();
  const n = L.nozzles;
  const impY = L.yBottom + 0.3 * diameter;
  const shaftTop = L.yTop + 0.18;

  return (
    <group
      position={position}
      rotation={rotation}
      scale={scale}
      {...clickable(onClick)}
    >
      {/* vessel shell (outer + inner surfaces, section caps at the cut) */}
      {shell.pieces.map((g, i) => (
        <mesh key={i} geometry={g} material={shellMat} castShadow receiveShadow />
      ))}
      {shell.innerPieces.map((g, i) => (
        <mesh key={i} geometry={g} material={fm.stainless(0.4)} receiveShadow />
      ))}
      {cut &&
        [phiStart, phiStart + phiLength].map((phi, i) => (
          <mesh key={i} geometry={shell.capG} material={fm.plastic('#8e959b', 0.6)} rotation={[0, phi - Math.PI / 2, 0]} />
        ))}
      {/* weld seams at the tangent lines + longitudinal seam */}
      {[L.yT1, L.yT2].map((y, i) => (
        <mesh key={i} geometry={torus(a + 0.0005, 0.0025, cut ? phiLength : TAU, 96)} material={fm.stainless(0.6)} position={[0, y, 0]} rotation={[Math.PI / 2, 0, cut ? -phiStart - phiLength + Math.PI / 2 : 0]} />
      ))}
      <mesh geometry={box(0.005, height, 0.003)} material={fm.stainless(0.6)} position={[Math.sin(-2.2) * (a + 0.001), (L.yT1 + L.yT2) / 2, Math.cos(-2.2) * (a + 0.001)]} rotation={[0, -2.2, 0]} />

      {/* sight window when not cut away */}
      {!cut && <SightWindow L={L} />}

      {/* liquid */}
      <mesh geometry={liquidGeo(diameter, height, phiStart, phiLength, cut)} material={liquid.back} frustumCulled={false} renderOrder={1} />
      <mesh geometry={liquidGeo(diameter, height, phiStart, phiLength, cut)} material={liquid.material} frustumCulled={false} renderOrder={2} />

      {/* baffles */}
      {[Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((phi, i) => (
        <mesh
          key={i}
          geometry={box(0.006, height * 0.92, diameter / 12)}
          material={fm.stainless(0.4)}
          position={[Math.sin(phi) * (a - 0.02 - diameter / 24), (L.yT1 + L.yT2) / 2, Math.cos(phi) * (a - 0.02 - diameter / 24)]}
          rotation={[0, phi + Math.PI / 2, 0]}
        />
      ))}

      {/* legs with gusset pads and ball feet */}
      {legPhis.map((phi, i) => {
        const x = Math.sin(phi) * legR;
        const z = Math.cos(phi) * legR;
        return (
          <group key={i}>
            <mesh geometry={cylY(0.03, legTop - 0.06, 20)} material={fm.stainless(0.35)} position={[x, 0.06 + (legTop - 0.06) / 2, z]} castShadow />
            <mesh geometry={box(0.09, 0.28, 0.006)} material={fm.stainless(0.4)} position={[Math.sin(phi) * (a + 0.006), legTop - 0.12, Math.cos(phi) * (a + 0.006)]} rotation={[0, phi, 0]} />
            <mesh geometry={sphere(0.032, 16)} material={fm.stainless(0.3)} position={[x, legTop, z]} />
            <mesh geometry={cylY(0.012, 0.05, 12)} material={fm.stainless(0.3)} position={[x, 0.045, z]} />
            <mesh geometry={latheY('ballFoot', [[0, 0], [0.045, 0], [0.045, 0.008], [0.03, 0.022], [0, 0.028]], 24)} material={fm.stainless(0.35)} position={[x, 0, z]} castShadow />
          </group>
        );
      })}

      {/* nozzles */}
      <NozzleNeck n={n.inlet} flangeR={0.08} neckR={0.03} />
      <NozzleNeck n={n.lt} flangeR={0.1} neckR={0.045} />
      <NozzleNeck n={n.vent} flangeR={0.07} neckR={0.028} />
      <NozzleNeck n={n.tt} flangeR={0.045} neckR={0.02} />
      <NozzleNeck n={n.lsl} flangeR={0.045} neckR={0.02} />
      <NozzleNeck n={n.lsh} flangeR={0.045} neckR={0.02} />
      <NozzleNeck n={n.lshh} flangeR={0.045} neckR={0.02} />
      <NozzleNeck n={n.heater} flangeR={0.11} neckR={0.07} />
      {/* vent gooseneck */}
      <OnNozzle nozzle={n.vent}>
        <mesh geometry={cylY(0.028, 0.08, 20)} material={fm.stainless()} position={[0, 0.04, 0]} />
        <mesh geometry={torus(0.06, 0.028, Math.PI, 20)} material={fm.stainless()} position={[0.06, 0.08, 0]} />
        <mesh geometry={cylY(0.028, 0.04, 20)} material={fm.stainless()} position={[0.12, 0.06, 0]} />
        <mesh geometry={cylY(0.034, 0.012, 20)} material={fm.stainless()} position={[0.12, 0.04, 0]} />
      </OnNozzle>
      {/* bottom outlet */}
      <OnNozzle nozzle={n.outlet}>
        <mesh geometry={cylY(0.03, 0.12, 24)} material={fm.stainless()} position={[0, -0.06, 0]} castShadow />
        <mesh geometry={cylY(0.08, 0.016, 32)} material={fm.stainless()} position={[0, -0.008, 0]} />
      </OnNozzle>
      {/* immersion heater terminal housing (outside) + elements (inside) */}
      <OnNozzle nozzle={n.heater}>
        <mesh geometry={cylY(0.11, 0.02, 32)} material={fm.stainless()} position={[0, 0.01, 0]} />
        <mesh geometry={cylY(0.085, 0.16, 32)} material={fm.sheet('#7c8288', 0.5)} position={[0, 0.1, 0]} castShadow />
        <mesh geometry={cylY(0.088, 0.02, 32)} material={fm.sheet('#6c7278', 0.5)} position={[0, 0.19, 0]} />
        <mesh geometry={hexGeo(0.03, 0.012)} material={fm.plastic('#222', 0.5)} position={[0.086, 0.1, 0]} rotation={[0, Math.PI / 2, 0]} />
        {[-0.03, 0, 0.03].map((x, i) => (
          <mesh key={i} geometry={cylY(0.007, 0.5, 10)} material={heaterMat} position={[x, -0.1 - 0.25 - 0.12, (i - 1) * 0.02]} />
        ))}
      </OnNozzle>
      {/* manway with hinged lid & swing bolts */}
      <OnNozzle nozzle={n.manway}>
        <mesh geometry={cylY(0.225, 0.16, 48, 0.225, true)} material={fm.stainless()} position={[0, -0.08, 0]} castShadow />
        <mesh geometry={cylY(0.245, 0.018, 48)} material={fm.stainless()} position={[0, -0.009, 0]} />
        <mesh geometry={latheY('manwayLid', [[0.245, 0], [0.245, 0.012], [0.2, 0.03], [0.0, 0.035]], 48)} material={fm.stainless()} position={[0, 0.001, 0]} castShadow />
        <mesh geometry={torus(0.05, 0.008, Math.PI, 16)} material={fm.stainless()} position={[0, 0.036, 0]} />
        {[0, 1, 2, 3, 4].map((i) => {
          const ang = (i / 5) * TAU + 0.6;
          return (
            <group key={i} position={[Math.cos(ang) * 0.262, 0, Math.sin(ang) * 0.262]}>
              <mesh geometry={cylY(0.007, 0.06, 10)} material={fm.stainless()} position={[0, 0, 0]} />
              <mesh geometry={latheY('starKnob', [[0.0, 0], [0.024, 0], [0.026, 0.012], [0.016, 0.022], [0, 0.024]], 8)} material={fm.plastic('#1c1d20', 0.5)} position={[0, 0.03, 0]} />
            </group>
          );
        })}
        <mesh geometry={box(0.08, 0.03, 0.03)} material={fm.stainless()} position={[0, 0.0, -0.26]} />
      </OnNozzle>

      {/* agitator drive: nozzle flange, lantern, inline gearbox, vertical motor */}
      {agitator && (
        <group>
          <mesh geometry={cylY(0.09, L.nozzles.agitator.position[1] - L.yTop + 0.02, 32)} material={fm.stainless()} position={[0, (L.nozzles.agitator.position[1] + L.yTop) / 2 - 0.01, 0]} />
          <mesh geometry={cylY(0.16, 0.02, 40)} material={fm.stainless()} position={[0, n.agitator.position[1] - 0.01, 0]} castShadow />
          <group position={[0, n.agitator.position[1], 0]}>
            {/* lantern with two windows */}
            {[0, 1].map((i) => (
              <mesh key={i} geometry={box(0.03, 0.14, 0.2)} material={fm.cast(MOTOR_BLUE)} position={[i === 0 ? 0.085 : -0.085, 0.07, 0]} castShadow />
            ))}
            <mesh geometry={cylY(0.12, 0.018, 40)} material={fm.cast(MOTOR_BLUE)} position={[0, 0.149, 0]} castShadow />
            <mesh geometry={cylY(0.12, 0.018, 40)} material={fm.cast(MOTOR_BLUE)} position={[0, 0.009, 0]} />
            {/* inline helical gearbox */}
            <mesh geometry={rbox(0.2, 0.2, 0.2, 0.035, 3)} material={fm.cast(MOTOR_BLUE)} position={[0, 0.26, 0]} castShadow />
            <mesh geometry={cylY(0.09, 0.03, 32)} material={fm.cast(MOTOR_BLUE)} position={[0, 0.375, 0]} />
            <mesh geometry={sphere(0.008, 10)} material={fm.brass()} position={[0.06, 0.365, 0.06]} />
            {/* vertical motor (fan up) */}
            <group position={[0, 0.39, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <MotorBody frame="small" color={MOTOR_BLUE} getAngle={getMotorAngle} flange shaft={false} conduit="gland" conduitDrop={0.2} liftingEye={false} nameplateAngle={Math.PI / 2} />
            </group>
          </group>
        </group>
      )}
      {/* agitator shaft + pitched-blade turbine */}
      {agitator && (
        <group ref={impeller}>
          <mesh geometry={cylY(0.02, shaftTop - impY, 20)} material={fm.polished()} position={[0, (shaftTop + impY) / 2, 0]} castShadow />
          <mesh geometry={cylY(0.034, 0.08, 20)} material={fm.polished()} position={[0, impY, 0]} />
          <mesh geometry={cylY(0.03, 0.06, 20)} material={fm.cast('#3c4046', 0.4)} position={[0, n.agitator.position[1] + 0.07, 0]} />
          {[0, 1, 2, 3].map((i) => (
            <group key={i} rotation={[0, (i * Math.PI) / 2, 0]}>
              <mesh geometry={box(0.2, 0.07, 0.007)} material={fm.polished()} position={[0.13, impY, 0]} rotation={[Math.PI / 4, 0, 0]} castShadow />
            </group>
          ))}
        </group>
      )}

      {/* nameplate */}
      <mesh position={[Math.sin(-0.75) * (a + 0.004), L.yT1 + 0.35, Math.cos(-0.75) * (a + 0.004)]} rotation={[0, -0.75, 0]}>
        <planeGeometry args={[0.2, 0.1]} />
        <meshStandardMaterial map={tankPlateTex(tag, '2000 L')} metalness={0.6} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** Full-height sight window (non-cutaway variant): curved glass in the shell opening + bolted frame. */
function SightWindow({ L }: { L: TankLayout }) {
  const h = L.yT2 - L.yT1;
  const y = (L.yT1 + L.yT2) / 2;
  const R = L.radius;
  const glassMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#dff2ff', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    [],
  );
  useEffect(() => () => glassMat.dispose(), [glassMat]);
  const frameW = 0.03;
  const bolts = Math.floor(h / 0.1);
  return (
    <group>
      <mesh position={[0, y, 0]} material={glassMat} renderOrder={3}>
        <cylinderGeometry args={[R - WALL / 2, R - WALL / 2, h, 8, 1, true, -WINDOW_W / 2, WINDOW_W]} />
      </mesh>
      {[-1, 1].map((sx) => (
        <group key={sx} rotation={[0, (sx * WINDOW_W) / 2, 0]}>
          <mesh geometry={box(frameW, h + 0.04, 0.012)} material={fm.stainless(0.35)} position={[sx * 0.004, y, R + 0.006]} castShadow />
          {Array.from({ length: bolts }, (_, i) => (
            <mesh key={i} geometry={hexGeo(0.012, 0.006)} material={fm.zinc()} position={[sx * 0.004, L.yT1 + 0.05 + i * 0.1, R + 0.015]} />
          ))}
        </group>
      ))}
      {[L.yT1 - 0.005, L.yT2 + 0.005].map((yy, i) => (
        <mesh key={i} geometry={box(2 * R * Math.sin(WINDOW_W / 2) + frameW * 2, 0.02, 0.012)} material={fm.stainless(0.35)} position={[0, yy, R * Math.cos(WINDOW_W / 2) + 0.006]} />
      ))}
    </group>
  );
}
