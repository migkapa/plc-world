/**
 * Piping helpers (all in parent coordinates, meters):
 *
 *  <Pipe from to diameter finish>                  straight pipe between two points
 *  <PipeElbow position rotation diameter radius angle>  elbow in the local XY plane: starts at the origin
 *                                                  heading +Y, bends toward +X by `angle` (default 90°)
 *  <Flange position dir diameter>                  weld-neck style flange pair with bolts, axis = `dir`
 *  <PipeRun points diameter finish flanges>        polyline with automatic bends (1.5 D radius)
 *  <SightGlass position height getLevel>           tubular level gauge between two valves (optional)
 *
 * `finish`: 'stainless' (polished), 'painted' (with `color`), 'pvc' (gray Sch.80).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Placement, Vec3 } from '../../contracts';
import { cylY, fm, geo, hexGeo, Merge, TAU } from './shared';
import { useDisposeOnUnmount } from '../../dispose';

export type PipeFinish = 'stainless' | 'painted' | 'pvc';

function pipeMat(finish: PipeFinish, color = '#2f6f3a') {
  return finish === 'stainless' ? fm.polished() : finish === 'pvc' ? fm.plastic('#6f767d', 0.45) : fm.sheet(color, 0.45);
}

const _y = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function quatFromY(dir: Vec3) {
  return new THREE.Quaternion().setFromUnitVectors(_y, _a.set(...dir).normalize());
}

export interface PipeProps {
  from: Vec3;
  to: Vec3;
  diameter?: number;
  finish?: PipeFinish;
  color?: string;
}

export function Pipe({ from, to, diameter = 0.0603, finish = 'stainless', color }: PipeProps) {
  const { pos, quat, len } = useMemo(() => {
    _a.set(...from);
    _b.set(...to);
    const len = _a.distanceTo(_b);
    const mid = _a.clone().add(_b).multiplyScalar(0.5);
    const dir = _b.clone().sub(_a).normalize();
    return { pos: mid.toArray() as Vec3, quat: new THREE.Quaternion().setFromUnitVectors(_y, dir), len };
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <mesh position={pos} quaternion={quat} scale={[1, len, 1]} geometry={cylY(diameter / 2, 1, 28, diameter / 2, true)} material={pipeMat(finish, color)} castShadow receiveShadow />
  );
}

export interface PipeElbowProps extends Placement {
  diameter?: number;
  /** Bend (centerline) radius; default 1.5 × diameter. */
  radius?: number;
  /** Bend angle in radians (default π/2). */
  angle?: number;
  finish?: PipeFinish;
  color?: string;
}

function elbowGeo(d: number, R: number, angle: number) {
  return geo(`elbow:${d.toFixed(4)}:${R.toFixed(4)}:${angle.toFixed(4)}`, () => {
    // torus in XY around (R, 0): starts at the origin heading +Y and bends toward +X
    // centerline circle centered at (R, 0); the arc θ ∈ [π − angle, π] starts at the origin heading +Y
    const g = new THREE.TorusGeometry(R, d / 2, 16, Math.max(8, Math.round(angle * 12)), angle);
    g.rotateZ(Math.PI - angle);
    g.translate(R, 0, 0);
    return g;
  });
}

export function PipeElbow({ diameter = 0.0603, radius, angle = Math.PI / 2, finish = 'stainless', color, position, rotation, scale }: PipeElbowProps) {
  const R = radius ?? diameter * 1.5;
  return <mesh geometry={elbowGeo(diameter, R, angle)} material={pipeMat(finish, color)} position={position} rotation={rotation} scale={scale} castShadow />;
}

export interface FlangeProps {
  position: Vec3;
  /** Flange axis direction. */
  dir?: Vec3;
  diameter?: number;
  bolts?: number;
  finish?: PipeFinish;
  color?: string;
}

/** A bolted flange pair (two flanges + gasket + bolts/nuts), centered on the joint. */
export function Flange({ position, dir = [0, 1, 0], diameter = 0.0603, bolts, finish = 'stainless', color }: FlangeProps) {
  const quat = useMemo(() => quatFromY(dir), [dir[0], dir[1], dir[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = diameter * 1.35 + 0.02;
  const t = 0.014 + diameter * 0.08;
  const n = bolts ?? (diameter > 0.07 ? 8 : 4);
  const boltR = (R + diameter / 2) / 2 + 0.004;
  const m = pipeMat(finish, color);
  return (
    <group position={position} quaternion={quat}>
      <Merge>
      <mesh geometry={cylY(R, t, 40)} material={m} position={[0, t / 2 + 0.0015, 0]} castShadow />
      <mesh geometry={cylY(R, t, 40)} material={m} position={[0, -t / 2 - 0.0015, 0]} castShadow />
      <mesh geometry={cylY(R * 0.8, 0.003, 32)} material={fm.plastic('#2b2b2b', 0.8)} />
      {/* weld-neck hubs */}
      <mesh geometry={cylY(diameter * 0.58, t * 1.2, 24, diameter / 2)} material={m} position={[0, t + 0.0015 + t * 0.6, 0]} />
      <mesh geometry={cylY(diameter / 2, t * 1.2, 24, diameter * 0.58)} material={m} position={[0, -t - 0.0015 - t * 0.6, 0]} />
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * TAU + TAU / (2 * n);
        const x = Math.cos(a) * boltR;
        const z = Math.sin(a) * boltR;
        const af = 0.013 + diameter * 0.12;
        return (
          <group key={i} position={[x, 0, z]}>
            <mesh geometry={cylY(af * 0.3, 2 * t + 0.02, 10)} material={fm.zinc()} />
            <mesh geometry={hexGeo(af, af * 0.55)} material={fm.zinc()} position={[0, t + 0.0015 + af * 0.28, 0]} rotation={[Math.PI / 2, 0, 0]} />
            <mesh geometry={hexGeo(af, af * 0.55)} material={fm.zinc()} position={[0, -t - 0.0015 - af * 0.28, 0]} rotation={[Math.PI / 2, 0, 0]} />
          </group>
        );
      })}
      </Merge>
    </group>
  );
}

export interface PipeRunProps {
  points: Vec3[];
  diameter?: number;
  finish?: PipeFinish;
  color?: string;
  /** Bend radius (default 1.5 D). */
  bendRadius?: number;
  /** Put flange pairs at these point indices (e.g. [0] at the start). */
  flangesAt?: number[];
}

/** A pipe along a polyline with smooth bends at the interior points. */
export function PipeRun({ points, diameter = 0.0603, finish = 'stainless', color, bendRadius, flangesAt = [] }: PipeRunProps) {
  const R = bendRadius ?? diameter * 1.5;
  const g = useMemo(() => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    const P = points.map((p) => new THREE.Vector3(...p));
    let cur = P[0]!.clone();
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1]!;
      const b = P[i]!;
      const next = P[i + 1];
      if (!next) {
        path.add(new THREE.LineCurve3(cur, b.clone()));
        break;
      }
      const d1 = b.clone().sub(a).normalize();
      const d2 = next.clone().sub(b).normalize();
      const theta = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
      const cut = theta < 1e-3 ? 0 : Math.min(R * Math.tan(theta / 2), a.distanceTo(b) * 0.49, b.distanceTo(next) * 0.49);
      const p1 = b.clone().addScaledVector(d1, -cut);
      const p2 = b.clone().addScaledVector(d2, cut);
      path.add(new THREE.LineCurve3(cur, p1));
      if (cut > 0) path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
      cur = p2;
    }
    const len = path.getLength();
    return new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, Math.max(16, Math.round(len * 40) + points.length * 12), diameter / 2, 20, false);
  }, [JSON.stringify(points), diameter, R]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <mesh geometry={g} material={pipeMat(finish, color)} castShadow receiveShadow />
      {flangesAt.map((i) => {
        const p = points[i]!;
        const q = points[i === points.length - 1 ? i - 1 : i + 1]!;
        const dir: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
        return <Flange key={i} position={p} dir={dir} diameter={diameter} finish={finish} color={color} />;
      })}
    </group>
  );
}

/**
 * Tubular sight-glass level gauge between two isolation valves. Origin: lower connection on the vessel.
 * `liquidColor` defaults to the Tank's default product color; pass `getColor` to follow a live color.
 */
export function SightGlass({
  height = 1.0,
  getLevel,
  standoff = 0.12,
  position,
  rotation,
  scale,
  liquidColor = '#2f86c4',
  getColor,
}: Placement & { height?: number; getLevel: () => number; standoff?: number; liquidColor?: string; getColor?: () => THREE.ColorRepresentation }) {
  const col = useRef<THREE.Mesh>(null);
  const liqMat = useMemo(() => new THREE.MeshStandardMaterial({ color: liquidColor, roughness: 0.15, transparent: true, opacity: 0.85 }), [liquidColor]);
  useDisposeOnUnmount(liqMat);
  useFrame(() => {
    const c = col.current;
    if (!c) return;
    const f = THREE.MathUtils.clamp(getLevel() / 100, 0, 1);
    c.scale.y = Math.max(0.001, f * (height - 0.1));
    c.position.y = 0.05 + (f * (height - 0.1)) / 2;
    if (getColor) liqMat.color.set(getColor());
  });
  const ss = fm.polished();
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {[0, height].map((y, i) => (
        <group key={i} position={[0, y, 0]}>
          <mesh geometry={cylY(0.012, standoff, 16)} material={ss} position={[0, 0, standoff / 2]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={hexGeo(0.03, 0.03)} material={ss} position={[0, 0, standoff]} />
          <mesh geometry={cylY(0.004, 0.04, 8)} material={ss} position={[0, 0, standoff + 0.03]} rotation={[Math.PI / 2, 0, 0]} />
        </group>
      ))}
      <mesh position={[0, height / 2, standoff]} geometry={cylY(0.011, height - 0.05, 20, 0.011, true)}>
        <meshStandardMaterial color="#e8f6ff" roughness={0.05} transparent opacity={0.25} depthWrite={false} />
      </mesh>
      <mesh ref={col} position={[0, 0.05, standoff]} geometry={cylY(0.008, 1, 16)} material={liqMat} />
      {[0.06, height - 0.06].map((y, i) => (
        <mesh key={i} position={[0.016, y, standoff]} geometry={cylY(0.004, 0.02, 8)} material={ss} />
      ))}
    </group>
  );
}
