/**
 * 2000 L stainless mixing tank: torispherical (Klöpper) heads, brushed shell with weld seams, four pipe legs
 * with ball feet, hinged manway with swing bolts, flanged nozzles, internal baffles, immersion heater,
 * top-mounted agitator (motor + inline gearbox + lantern + shaft + 4-blade 45° pitched-blade turbine).
 *
 * The liquid is visible through a front quarter CUT-AWAY (default) or a full-height sight WINDOW
 * (`cutaway={false}`). Its free surface sits at getLevel() with ripples and a vortex/swirl when agitated; the
 * product keeps its hue (thickness-based absorption + fresnel); temperature shows as steam over the surface and,
 * with `temperatureTint`, as a heat-map tint of the product (`getLiquidColor` drives any other live color).
 *
 * Origin: floor, on the vessel axis. `diameter` = shell diameter, `height` = straight-shell height
 * (tangent line to tangent line). Level 0 % = lowest point inside the bottom head, 100 % = top tangent line.
 * Use `tankLayout()` for nozzle positions (instrument mounting) and `<OnNozzle>` to mount devices on them.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { TankProps, Vec3 } from '../../contracts';
import { useDisposeOnUnmount } from '../../dispose';
import { MOTOR_BLUE, MotorBody } from './Motor';
import { box, canvasTex, type CableRoute, clickable, ConduitStub, DEVICE_ROOT, cylY, fm, geo, HexBolt, hexGeo, latheY, mat, Merge, rbox, RoutedCable, sphere, TAU, tex, torus } from './shared';

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
  /** Distance from the vessel's outer surface to the flange / socket face along the axis (m). */
  projection?: number;
  /** Threaded weld-in socket (no flange), e.g. for vibrating-fork level switches. */
  socket?: boolean;
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
  /** Outer vessel radius at height y (0 above/below the heads). */
  radiusAt: (y: number) => number;
  nozzles: Record<TankNozzleId, TankNozzle>;
}

const LEG_CLEAR = 0.55;
const WALL = 0.005;
/** Projection of the G1 weld-in sockets for the level switches (socket face to shell). */
const FORK_SOCKET = 0.032;

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
  const hp = headProfile(diameter, 0, 24);
  /** Outer radius at height y: straight shell, or the torispherical head profile (interpolated). */
  const radiusAt = (y: number) => {
    if (y >= yT1 && y <= yT2) return a;
    const dy = y < yT1 ? yT1 - y : y - yT2;
    if (dy >= hd) return 0;
    for (let i = 0; i < hp.length - 1; i++) {
      const [r0, y0] = hp[i]!;
      const [r1, y1] = hp[i + 1]!;
      if (dy >= y0 && dy <= y1) return r0 + ((dy - y0) / (y1 - y0 || 1)) * (r1 - r0);
    }
    return 0;
  };
  const top = (r: number, phiDeg: number, size: number, proj = 0.1): TankNozzle => {
    const phi = (phiDeg * Math.PI) / 180;
    const y = yT2 + headHeightAt(diameter, r) + proj;
    return { position: [r * Math.sin(phi), y, r * Math.cos(phi)], direction: [0, 1, 0], size, projection: proj };
  };
  const side = (y: number, phiDeg: number, size: number, proj = 0.12, socket = false): TankNozzle => {
    const phi = (phiDeg * Math.PI) / 180;
    const R = radiusAt(y) + proj;
    return { position: [R * Math.sin(phi), y, R * Math.cos(phi)], direction: [Math.sin(phi), 0, Math.cos(phi)], size, projection: proj, socket };
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
    radiusAt,
    nozzles: {
      agitator: { position: [0, yTop + 0.06, 0], direction: [0, 1, 0], size: 0.15 },
      inlet: top(a * 0.64, 250, 0.05),
      lt: top(a * 0.64, 105, 0.08),
      manway: top(a * 0.48, 180, 0.45, 0.12),
      vent: top(a * 0.64, 300, 0.05),
      tt: side(yT1 + 0.18, 55, 0.025, 0.1),
      // vibrating forks sit in short weld-in sockets so the tines reach ~40 mm into the product
      lsl: side(levelY(10), 85, 0.025, FORK_SOCKET, true),
      lsh: side(levelY(90), 80, 0.025, FORK_SOCKET, true),
      lshh: side(levelY(97), 100, 0.025, FORK_SOCKET, true),
      outlet: { position: [0, yBottom - 0.12, 0], direction: [0, -1, 0], size: 0.05 },
      heater: side(yT1 + 0.12, 140, 0.1, 0.1),
    },
  };
}

function nozzleQuat(nozzle: TankNozzle) {
  const d = new THREE.Vector3(...nozzle.direction).normalize();
  const pref = Math.abs(d.z) > 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const z = pref.clone().sub(d.clone().multiplyScalar(pref.dot(d))).normalize();
  const x = new THREE.Vector3().crossVectors(d, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, d, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** Places children at a nozzle flange: local +Y = nozzle outward direction, local +Z faces the front as well as possible. */
export function OnNozzle({ nozzle, children }: { nozzle: TankNozzle; children: ReactNode }) {
  const quat = useMemo(() => nozzleQuat(nozzle), [nozzle.direction]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group position={nozzle.position} quaternion={quat}>
      {children}
    </group>
  );
}

/**
 * Converts a point from TANK coordinates into the frame of `<OnNozzle nozzle>` — e.g. to give an instrument
 * mounted on a nozzle a `cableTo` end point defined in tank coordinates.
 */
export function nozzleLocal(nozzle: TankNozzle, p: Vec3): Vec3 {
  const q = nozzleQuat(nozzle).invert();
  const v = new THREE.Vector3(p[0] - nozzle.position[0], p[1] - nozzle.position[1], p[2] - nozzle.position[2]).applyQuaternion(q);
  return [v.x, v.y, v.z];
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
    type V3 = [number, number, number];
    const P = (r: number, phi: number, y: number): V3 => [r * Math.sin(phi), y, r * Math.cos(phi)];
    /** One triangle; `n` = one flat normal, or one normal per vertex. */
    const tri = (a: V3, b: V3, c: V3, n: V3 | [V3, V3, V3], t: number) => {
      for (const v of [a, b, c]) {
        pos.push(...v);
        top.push(t);
      }
      if (typeof n[0] === 'number') for (let i = 0; i < 3; i++) nor.push(...(n as V3));
      else for (const v of n as [V3, V3, V3]) nor.push(...v);
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
    // outward profile normals [nr, ny] (perpendicular to the profile tangent). The apex of the bottom head gets
    // (0, -1): a radial normal there would be zero-length -> normalize() = NaN in the shader (black bloom frames).
    const pn = prof.map((_, i): [number, number] => {
      if (i === 0) return [0, -1];
      const [r0, y0] = prof[Math.max(0, i - 1)]!;
      const [r1, y1] = prof[Math.min(prof.length - 1, i + 1)]!;
      const dr = r1 - r0;
      const dy = y1 - y0;
      const l = Math.hypot(dr, dy);
      return l > 1e-9 ? [dy / l, -dr / l] : [1, 0];
    });
    const N = (i: number, phi: number): V3 => [pn[i]![0] * Math.sin(phi), pn[i]![1], pn[i]![0] * Math.cos(phi)];
    for (let i = 0; i < prof.length - 1; i++) {
      const [ra, ya] = prof[i]!;
      const [rb, yb] = prof[i + 1]!;
      for (let j = 0; j < NP; j++) {
        const p0 = phiStart + (j / NP) * phiLength;
        const p1 = phiStart + ((j + 1) / NP) * phiLength;
        tri(P(ra, p0, ya), P(rb, p1, yb), P(rb, p0, yb), [N(i, p0), N(i + 1, p1), N(i + 1, p0)], 0);
        tri(P(ra, p0, ya), P(ra, p1, ya), P(rb, p1, yb), [N(i, p0), N(i, p1), N(i + 1, p1)], 0);
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
        const n: V3 = [sgn * Math.cos(phi), 0, -sgn * Math.sin(phi)];
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
    /** Camera position in tank (object) coordinates, for the analytic thickness through the liquid. */
    uCamObj: { value: new THREE.Vector3(0, 2, 5) },
    uYBot: { value: L.yBottom + WALL },
    uDeep: { value: new THREE.Color('#06121c') },
    /** Absorption per meter of liquid path. */
    uAbs: { value: 3.2 },
  };
  const m = new THREE.MeshStandardMaterial({
    color: '#2f86c4',
    roughness: 0.12,
    metalness: 0.0,
    transparent: true,
    opacity: 0.55,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const compile = (shader: THREE.WebGLProgramParametersWithUniforms, back: boolean) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uLevel; uniform float uTime; uniform float uSwirl; uniform float uRin; uniform float uT1; uniform float uHd;
attribute float aTop;
varying vec3 vObj;
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
// never feed a zero-length normal to normalize() (NaN -> black frames once Bloom spreads it)
if (dot(objectNormal, objectNormal) < 1e-12) objectNormal = vec3(0.0, -1.0, 0.0);
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
}
vObj = lpos;`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = lpos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObj;
uniform vec3 uCamObj; uniform float uRin; uniform float uYBot; uniform float uLevel; uniform vec3 uDeep; uniform float uAbs;
float liquidPath() {
  // ray from the camera through this fragment: length inside the liquid (vertical cylinder + surface + bottom)
  vec3 dv = vObj - uCamObj;
  vec3 rd = dv / max(length(dv), 1e-5);
  vec3 ro = vObj;
  float a = dot(rd.xz, rd.xz);
  float t = 4.0;
  if (a > 1e-6) {
    float b = dot(ro.xz, rd.xz);
    float c = dot(ro.xz, ro.xz) - uRin * uRin;
    float disc = b * b - a * c;
    if (disc > 0.0) t = max(0.0, (-b + sqrt(disc)) / a);
  }
  if (rd.y < -1e-4) t = min(t, max(0.0, (uYBot - ro.y) / rd.y));
  if (rd.y > 1e-4) t = min(t, max(0.0, (uLevel - ro.y) / rd.y));
  return t;
}`,
      )
      .replace(
        '#include <color_fragment>',
        back
          ? `#include <color_fragment>
diffuseColor.rgb = mix(uDeep, diffuseColor.rgb, 0.35);`
          : `#include <color_fragment>
float liqT = liquidPath();
float liqK = exp(-uAbs * liqT);
diffuseColor.rgb = mix(uDeep, diffuseColor.rgb, 0.25 + 0.75 * liqK);`,
      )
      .replace(
        '#include <opaque_fragment>',
        back
          ? `diffuseColor.a = 0.92;
#include <opaque_fragment>`
          : `{
  // clamp: |n·v| can exceed 1 by rounding and pow() of a negative base is NaN
  float nv = clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
  float fres = pow(1.0 - nv, 4.0);
  diffuseColor.a = clamp(mix(opacity, 0.97, 1.0 - liqK) + fres * 0.35, 0.0, 1.0);
}
#include <opaque_fragment>`,
      )
      // last line of defence: a non-finite pixel would be smeared over the whole frame by Bloom's mip chain
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
if (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(0.0);`,
      );
  };
  m.onBeforeCompile = (sh) => compile(sh, false);
  m.customProgramCacheKey = () => 'plcworld-liquid-v3';
  // back faces drawn first (inside of the liquid body), dark and nearly opaque
  const back = m.clone();
  back.side = THREE.BackSide;
  back.onBeforeCompile = (sh) => compile(sh, true);
  back.customProgramCacheKey = () => 'plcworld-liquid-v3b';
  return { material: m, back, uniforms };
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** Stainless visible from both sides (open nozzle necks seen through the cut-away). */
function stainless2() {
  return mat('f:ss2', () => {
    const m = fm.stainless().clone();
    m.side = THREE.DoubleSide;
    return m;
  });
}

/** Neck pipe from the flange face back to the vessel's inner surface (open ended), plus the flange. */
function NozzleNeck({ n, flangeR, neckR }: { n: TankNozzle; flangeR: number; neckR: number }) {
  const proj = n.projection ?? 0.1;
  const len = proj + WALL * 0.8 - 0.012 + neckR * neckR * 0.8;
  return (
    <OnNozzle nozzle={n}>
      <mesh geometry={cylY(neckR, len, 24, neckR, true)} material={stainless2()} position={[0, -0.012 - len / 2, 0]} castShadow />
      <mesh geometry={cylY(flangeR, 0.016, 32)} material={fm.stainless()} position={[0, -0.008, 0]} castShadow />
    </OnNozzle>
  );
}

/** Threaded weld-in socket (G1) flush with the socket face: round boss with a weld bead at the shell. */
function WeldSocket({ n }: { n: TankNozzle }) {
  const proj = n.projection ?? FORK_SOCKET;
  const len = proj + WALL * 0.8;
  return (
    <OnNozzle nozzle={n}>
      <mesh geometry={cylY(0.024, len, 28, 0.024, true)} material={stainless2()} position={[0, -len / 2, 0]} castShadow />
      <mesh geometry={torus(0.0235, 0.0015, TAU, 28)} material={fm.stainless(0.6)} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={torus(0.026, 0.003, TAU, 28)} material={fm.stainless(0.7)} position={[0, -proj + 0.002, 0]} rotation={[Math.PI / 2, 0, 0]} />
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
    ctx.fillStyle = '#8a9095';
    for (const [x, y] of [
      [26, 26],
      [w - 26, 26],
      [26, h - 26],
      [w - 26, h - 26],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, TAU);
      ctx.fill();
    }
  });
}

function dangerTex() {
  return canvasTex('heaterDanger', 256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4ef';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d0141c';
    ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DANGER', w / 2, 24);
    ctx.fillStyle = '#111';
    ctx.font = '800 36px Arial, sans-serif';
    ctx.fillText('480 V', w / 2, 72);
    ctx.font = '600 16px Arial, sans-serif';
    ctx.fillText('ISOLATE BEFORE OPENING', w / 2, 106);
  });
}

function steamTex() {
  return tex('f:steamPuff', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

const STEAM_N = 12;

/** Steam wisps rising from the free surface; density follows the liquid temperature (none below ~45 °C). */
function Steam({ L, getLevel, getTemperature, phiStart, phiLength }: { L: TankLayout; getLevel: () => number; getTemperature?: () => number; phiStart: number; phiLength: number }) {
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  const mats = useMemo(
    () => Array.from({ length: STEAM_N }, () => new THREE.SpriteMaterial({ map: steamTex(), color: '#e9eef2', transparent: true, depthWrite: false, opacity: 0 })),
    [],
  );
  useDisposeOnUnmount(mats);
  const seeds = useMemo(
    () =>
      Array.from({ length: STEAM_N }, (_, i) => {
        const r = (0.25 + 0.65 * ((i * 0.618) % 1)) * (L.radius - 0.05);
        const phi = phiStart + (((i * 0.382 + 0.1) % 1) * 0.9 + 0.05) * phiLength;
        return { x: r * Math.sin(phi), z: r * Math.cos(phi), off: (i * 0.73) % 1 };
      }),
    [L.radius, phiStart, phiLength],
  );
  useFrame(({ clock }) => {
    const T = getTemperature ? getTemperature() : 20;
    const k = THREE.MathUtils.smoothstep(T, 42, 85);
    const y0 = L.levelY(getLevel());
    const t = clock.elapsedTime;
    for (let i = 0; i < STEAM_N; i++) {
      const sp = refs.current[i];
      if (!sp) continue;
      sp.visible = k > 0.01;
      if (!sp.visible) continue;
      const sd = seeds[i]!;
      const age = (t / 3.2 + sd.off) % 1;
      sp.position.set(sd.x + Math.sin(t * 0.7 + i) * 0.03 * age, y0 + 0.02 + age * 0.4, sd.z + Math.cos(t * 0.6 + i) * 0.03 * age);
      const sz = 0.06 + age * 0.22;
      sp.scale.set(sz, sz * 1.2, 1);
      mats[i]!.opacity = k * 0.22 * Math.sin(Math.PI * age);
    }
  });
  return (
    <group userData={{ noMerge: true }}>
      {mats.map((m, i) => (
        <sprite
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          material={m}
          visible={false}
          renderOrder={3}
          raycast={() => {}}
        />
      ))}
    </group>
  );
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
  /**
   * Power cables of the agitator motor and the immersion heater (routes in the tank's PARENT coordinates, or
   * false to stop at the gland). Defaults: agitator cable cleated over the top head and down the back of the
   * shell into a floor conduit stub; heater cable straight down into a floor stub.
   */
  cables?: { agitator?: CableRoute; heater?: CableRoute };
  /** Live product color (overrides `liquidColor`; ignored while `temperatureTint` is on). Read every frame. */
  getLiquidColor?: () => THREE.ColorRepresentation;
  /**
   * Tint the product by `getTemperature()` instead of `liquidColor`: `true` = TANK_TEMPERATURE_RAMP (blue when
   * cold → amber at ~60 °C → red near boiling), or your own ramp of [°C, color] stops (ascending).
   */
  temperatureTint?: boolean | readonly TintStop[];
  /** Rolling boil: rough, agitated surface even without the agitator. */
  getBoiling?: () => boolean;
  onClick?: () => void;
}

/** Default product color (also the SightGlass default). */
export const TANK_LIQUID_COLOR = '#2f86c4';

/** A temperature → color stop for `temperatureTint`. */
export type TintStop = readonly [celsius: number, color: string];

/** Heat-map ramp for `temperatureTint` (starts at the default product color). */
export const TANK_TEMPERATURE_RAMP: readonly TintStop[] = [
  [15, TANK_LIQUID_COLOR],
  [35, '#2ba3b5'],
  [50, '#98ad5a'],
  [60, '#dfae33'],
  [75, '#e57b2a'],
  [100, '#d63f28'],
];

const _t0 = new THREE.Color();
const _t1 = new THREE.Color();
/** Color of the product at `celsius` on a ramp (clamped to the end stops). */
export function liquidTemperatureColor(celsius: number, out: THREE.Color, ramp: readonly TintStop[] = TANK_TEMPERATURE_RAMP): THREE.Color {
  const first = ramp[0];
  if (!first) return out;
  if (!(celsius > first[0])) return out.set(first[1]); // also NaN
  for (let i = 1; i < ramp.length; i++) {
    const [t1, c1] = ramp[i]!;
    if (celsius <= t1) {
      const [t0, c0] = ramp[i - 1]!;
      return out.lerpColors(_t0.set(c0), _t1.set(c1), (celsius - t0) / (t1 - t0 || 1));
    }
  }
  return out.set(ramp[ramp.length - 1]![1]);
}

const _cam = new THREE.Vector3();

export function Tank({
  getLevel,
  getTemperature,
  getAgitatorRpm,
  diameter = 1.3,
  height = 1.25,
  cutaway = true,
  liquidColor = TANK_LIQUID_COLOR,
  getHeaterOn,
  tag = 'T-101',
  agitator = true,
  cables,
  getLiquidColor,
  temperatureTint = false,
  getBoiling,
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
  useDisposeOnUnmount(liquid, (l) => {
    l.material.dispose();
    l.back.dispose();
  });
  const ramp = temperatureTint === true ? TANK_TEMPERATURE_RAMP : temperatureTint || null;
  /** Product color: static `liquidColor`, or per frame from getLiquidColor / the temperature ramp. */
  const tint = useRef({ color: new THREE.Color(), key: '' });
  const applyColor = (c: THREE.Color) => {
    liquid.material.color.copy(c);
    liquid.back.color.copy(c);
    liquid.uniforms.uDeep.value.copy(c).multiplyScalar(0.12);
  };
  useEffect(() => {
    tint.current.key = '';
    if (!ramp && !getLiquidColor) applyColor(tint.current.color.set(liquidColor));
  }, [liquid, liquidColor, ramp, getLiquidColor]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = useRef<THREE.Group>(null);
  const liquidMesh = useRef<THREE.Mesh>(null);
  const impeller = useRef<THREE.Group>(null);
  const motorAngle = useRef(0);
  const shaftAngle = useRef(0);
  const swirl = useRef(0);
  const heaterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8f8a84', metalness: 0.7, roughness: 0.45, emissive: '#ff3a08', emissiveIntensity: 0 }), []);
  useDisposeOnUnmount(heaterMat);
  const getMotorAngle = useMemo(() => () => motorAngle.current, []);
  const ratio = 14.6;

  useFrame(({ clock, camera }, dt) => {
    const u = liquid.uniforms;
    const lvl = getLevel();
    u.uLevel.value = L.levelY(lvl);
    u.uTime.value = clock.elapsedTime;
    const lm = liquidMesh.current;
    if (lm) u.uCamObj.value.copy(lm.worldToLocal(_cam.copy(camera.position)));
    const rpm = getAgitatorRpm ? getAgitatorRpm() : 0;
    const d = Math.min(dt, 0.1);
    shaftAngle.current += (rpm / 60) * TAU * d;
    motorAngle.current = shaftAngle.current * ratio;
    if (impeller.current) impeller.current.rotation.y = -shaftAngle.current;
    // swirl eases with agitator speed and only when the impeller is covered; a rolling boil roughens the surface
    let target = THREE.MathUtils.clamp(rpm / 90, 0, 1) * (lvl > 25 ? 1 : lvl / 25);
    if (getBoiling?.() && lvl > 0) target = Math.max(target, 0.75);
    swirl.current += (target - swirl.current) * Math.min(1, d * 1.5);
    u.uSwirl.value = swirl.current;
    // live product color (quantised so the material is only touched when the tint visibly changes)
    const tc = tint.current;
    if (ramp && getTemperature) {
      const T = getTemperature();
      const k = Number.isFinite(T) ? String(Math.round(T * 4)) : 'nan';
      if (k !== tc.key) {
        tc.key = k;
        applyColor(liquidTemperatureColor(T, tc.color, ramp));
      }
    } else if (getLiquidColor) {
      tc.color.set(getLiquidColor());
      const k = tc.color.getHexString();
      if (k !== tc.key) {
        tc.key = k;
        applyColor(tc.color);
      }
    }
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
  const baffleW = diameter / 12;
  const baffleGap = diameter / 72;
  const baffleR = a - WALL - baffleGap - baffleW / 2;
  const baffleH = height * 0.92;
  // baffles at 0/90/180/270°; the one at 0° lies inside the removed quarter of the cut-away
  const bafflePhis = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].filter((p) => !cut || Math.abs(Math.atan2(Math.sin(p), Math.cos(p))) > Math.PI / 4 + 0.05);
  // nameplate outside the cut, clear of legs and nozzles
  const plateCandidates = cut ? [-1.2, 1.25, 2.9] : [-0.75, -1.2];
  const platePhi = plateCandidates[0]!;
  const plateY = L.yT1 + 0.45;
  const plateR = a + 0.005;
  const plateW = 0.2;
  const plateArc = plateW / plateR;
  // heater gland toward world-down inside the OnNozzle frame
  const heaterQ = useMemo(() => nozzleQuat(n.heater).invert(), [n.heater]);
  const heaterDown = useMemo(() => new THREE.Vector3(0, -1, 0).applyQuaternion(heaterQ), [heaterQ]);
  const heaterRot = Math.atan2(-heaterDown.z, heaterDown.x);
  // agitator cable default: over the top head, cleated down the back of the shell into a floor stub
  const cablePhi = (200 * Math.PI) / 180;
  const cs = Math.sin(cablePhi);
  const cc = Math.cos(cablePhi);
  const hh = (r: number) => L.yT2 + headHeightAt(diameter, r) + 0.03;
  const agitatorRoute: CableRoute = useMemo(() => {
    if (cables?.agitator !== undefined) return cables.agitator;
    // default route is designed in tank coordinates; routes are read in the tank's PARENT coordinates
    const sc = typeof scale === 'number' ? [scale, scale, scale] : (scale ?? [1, 1, 1]);
    const toParent = new THREE.Matrix4().compose(
      new THREE.Vector3(...(position ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0]))),
      new THREE.Vector3(sc[0], sc[1], sc[2]),
    );
    const P = (r: number, y: number): Vec3 => [r * cs, y, r * cc];
    const T = (v: Vec3): Vec3 => new THREE.Vector3(...v).applyMatrix4(toParent).toArray() as Vec3;
    const via: Vec3[] = [
      [0.16, n.agitator.position[1] + 0.62, -0.06],
      [0.1 * cs + 0.12, hh(0.2) + 0.05, 0.2 * cc],
      P(a * 0.45, hh(a * 0.45)),
      P(a * 0.8, hh(a * 0.8)),
      P(a + 0.035, L.yT2 - 0.05),
      P(a + 0.03, L.yT1 + 0.3),
      P(a + 0.03, L.yT1),
      P(a + 0.12, 0.45),
    ];
    return { via: via.map(T), to: T(P(a + 0.22, 0.14)) };
  }, [cables?.agitator, cs, cc, a, L, n.agitator.position, position, rotation, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  const agitatorStubPos: Vec3 = [(a + 0.22) * cs, 0.14, (a + 0.22) * cc];
  const agitatorStub = cables?.agitator === undefined;

  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
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

        {/* radial baffles (T/12 wide, T/72 off the wall) on welded clips */}
        {bafflePhis.map((phi, i) => (
          <group key={i} rotation={[0, phi, 0]}>
            <mesh geometry={box(0.006, baffleH, baffleW)} material={fm.stainless(0.4)} position={[0, (L.yT1 + L.yT2) / 2, baffleR]} castShadow />
            {[-0.38, 0, 0.38].map((f) => (
              <mesh key={f} geometry={box(0.03, 0.04, baffleGap + 0.012)} material={fm.stainless(0.45)} position={[0, (L.yT1 + L.yT2) / 2 + f * baffleH, a - WALL - (baffleGap + 0.012) / 2 + 0.002]} />
            ))}
          </group>
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

        {/* nozzles: flanged necks ending at the vessel wall, weld-in sockets for the fork switches */}
        <NozzleNeck n={n.inlet} flangeR={0.08} neckR={0.03} />
        <NozzleNeck n={n.lt} flangeR={0.1} neckR={0.045} />
        <NozzleNeck n={n.vent} flangeR={0.07} neckR={0.028} />
        <NozzleNeck n={n.tt} flangeR={0.045} neckR={0.02} />
        <WeldSocket n={n.lsl} />
        <WeldSocket n={n.lsh} />
        <WeldSocket n={n.lshh} />
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
        {/* immersion heater: flange, terminal enclosure with domed cap, gland pointing down, warning label */}
        <OnNozzle nozzle={n.heater}>
          <group rotation={[0, heaterRot, 0]}>
            <mesh geometry={cylY(0.11, 0.02, 32)} material={fm.stainless()} position={[0, 0.01, 0]} />
            <mesh geometry={cylY(0.06, 0.03, 28)} material={fm.stainless()} position={[0, 0.035, 0]} />
            <mesh geometry={cylY(0.088, 0.13, 32)} material={fm.sheet('#7d858b', 0.45)} position={[0, 0.115, 0]} castShadow />
            <mesh geometry={torus(0.088, 0.004, TAU, 32)} material={fm.sheet('#6c7278', 0.5)} position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]} />
            <mesh
              geometry={latheY('heaterCap', [[0.09, 0], [0.09, 0.012], [0.084, 0.03], [0.066, 0.05], [0.036, 0.062], [0, 0.066]], 32)}
              material={fm.sheet('#7d858b', 0.45)}
              position={[0, 0.18, 0]}
              castShadow
            />
            {[0, 1, 2, 3].map((i) => {
              const ang = (i / 4) * TAU + TAU / 8;
              return <HexBolt key={i} d={0.006} position={[Math.cos(ang) * 0.095, 0.183, Math.sin(ang) * 0.095]} rotation={[-Math.PI / 2, 0, 0]} />;
            })}
            {/* cable gland (local +X = world down) */}
            <group position={[0.088, 0.1, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <mesh geometry={hexGeo(0.03, 0.008)} material={fm.nickel()} position={[0, 0.004, 0]} rotation={[Math.PI / 2, 0, 0]} />
              <mesh geometry={cylY(0.012, 0.018, 18, 0.009)} material={fm.plastic('#1d1e21', 0.5)} position={[0, 0.017, 0]} />
              <RoutedCable rootRef={root} route={cables?.heater} from={[0, 0.026, 0]} dir={[0, 1, 0]} radius={0.009} color="#1b1c1e" lead={0.05} />
            </group>
            {/* DANGER label on the enclosure (faces the front) */}
            <mesh position={[0, 0.115, 0.0885]} material={fm.plate(dangerTex())}>
              <planeGeometry args={[0.07, 0.035]} />
            </mesh>
          </group>
          {[-0.03, 0, 0.03].map((x, i) => (
            <mesh key={i} geometry={cylY(0.007, 0.5, 10)} material={heaterMat} position={[x, -0.1 - 0.25 - 0.12, (i - 1) * 0.02]} />
          ))}
        </OnNozzle>
        {/* manway with hinged lid & swing bolts */}
        <OnNozzle nozzle={n.manway}>
          <mesh geometry={cylY(0.225, 0.16, 48, 0.225, true)} material={stainless2()} position={[0, -0.08, 0]} castShadow />
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

        {/* agitator drive: nozzle flange, lantern, inline gearbox (the vertical motor has its own batch) */}
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
            </group>
            {/* cable cleats down the back of the shell (default route) */}
            {agitatorStub &&
              [L.yT2 - 0.1, (L.yT1 + L.yT2) / 2, L.yT1 + 0.25].map((y) => (
                <group key={y} position={[(a + 0.004) * cs, y, (a + 0.004) * cc]} rotation={[0, cablePhi, 0]}>
                  <mesh geometry={box(0.05, 0.03, 0.008)} material={fm.stainless(0.45)} position={[0, 0, 0.004]} />
                  <mesh geometry={torus(0.014, 0.003, Math.PI, 12)} material={fm.stainless(0.45)} position={[0, 0, 0.026]} rotation={[Math.PI / 2, 0, 0]} />
                </group>
              ))}
            {agitatorStub && <ConduitStub visible position={agitatorStubPos} />}
          </group>
        )}

        {/* nameplate: bent to the shell radius, on two standoff blocks, outside the cut-away */}
        <group rotation={[0, platePhi, 0]}>
          {[-1, 1].map((sx) => (
            <mesh key={sx} geometry={box(0.018, 0.05, 0.0095)} material={fm.stainless(0.4)} position={[sx * 0.075, plateY, a - 0.0013]} />
          ))}
          <mesh position={[0, plateY, 0]} material={fm.plate(tankPlateTex(tag, '2000 L'))}>
            <cylinderGeometry args={[plateR + 0.004, plateR + 0.004, 0.1, 12, 1, true, -plateArc / 2, plateArc]} />
          </mesh>
          <mesh position={[0, plateY, 0]} material={fm.stainless(0.4)}>
            <cylinderGeometry args={[plateR + 0.0035, plateR + 0.0035, 0.104, 12, 1, true, -plateArc / 2 - 0.004, plateArc + 0.008]} />
          </mesh>
        </group>
      </Merge>

      {/* agitator motor (own batch; spins via getAngle) */}
      {agitator && (
        <group position={[0, n.agitator.position[1] + 0.39, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <MotorBody frame="small" color={MOTOR_BLUE} getAngle={getMotorAngle} flange shaft={false} conduit="gland" cableTo={agitatorRoute} rootRef={root} liftingEye={false} nameplateAngle={Math.PI / 2} />
        </group>
      )}

      {/* sight window when not cut away */}
      {!cut && <SightWindow L={L} />}

      {/* liquid */}
      <mesh ref={liquidMesh} geometry={liquidGeo(diameter, height, phiStart, phiLength, cut)} material={liquid.back} frustumCulled={false} renderOrder={1} />
      <mesh geometry={liquidGeo(diameter, height, phiStart, phiLength, cut)} material={liquid.material} frustumCulled={false} renderOrder={2} />
      <Steam L={L} getLevel={getLevel} getTemperature={getTemperature} phiStart={phiStart} phiLength={phiLength} />

      {/* agitator shaft + pitched-blade turbine */}
      {agitator && (
        <group ref={impeller} userData={{ noMerge: true }}>
          <Merge>
            <mesh geometry={cylY(0.02, shaftTop - impY, 20)} material={fm.polished()} position={[0, (shaftTop + impY) / 2, 0]} castShadow />
            <mesh geometry={cylY(0.034, 0.08, 20)} material={fm.polished()} position={[0, impY, 0]} />
            <mesh geometry={cylY(0.03, 0.06, 20)} material={fm.cast('#3c4046', 0.4)} position={[0, n.agitator.position[1] + 0.07, 0]} />
            {[0, 1, 2, 3].map((i) => (
              <group key={i} rotation={[0, (i * Math.PI) / 2, 0]}>
                <mesh geometry={box(0.2, 0.07, 0.007)} material={fm.polished()} position={[0.13, impY, 0]} rotation={[Math.PI / 4, 0, 0]} castShadow />
              </group>
            ))}
          </Merge>
        </group>
      )}
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
  useDisposeOnUnmount(glassMat);
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
