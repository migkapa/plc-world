/**
 * Control wiring: <Wire> is a single insulated conductor (TubeGeometry along a polyline with small
 * filleted bends, optional bootlace ferrules at both ends); <WireBundle> is several conductors
 * following the same route, packed together and held by cable ties.
 *
 * Points are in the parent's coordinates (meters).
 */
import { useEffect, useMemo } from 'react';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import type { Vec3 } from '../../contracts';
import { F, Parts, cylZ, sharedMat, uberMat } from '../operator/shared';

export interface WireProps {
  points: Vec3[];
  color?: string;
  /** Conductor + insulation radius (m), default 0.0011 (≈ 16 AWG / 1.5 mm²). */
  radius?: number;
  /** Bend radius at polyline corners (m), default 0.008. */
  bendRadius?: number;
  /** Bootlace ferrules at both ends (default false). */
  ferrules?: boolean;
  /** Ferrule collar color (default follows DIN color by size: gray). */
  ferruleColor?: string;
}

export interface WireBundleProps {
  points: Vec3[];
  colors: string[];
  radius?: number;
  bendRadius?: number;
  /** Cable tie spacing (m), 0 = none. Default 0.08. */
  tieSpacing?: number;
}

/** Polyline with filleted corners as a CurvePath. */
export function filletedPath(points: Vec3[], bend: number): THREE.CurvePath<THREE.Vector3> {
  const pts = points.map((p) => new THREE.Vector3(...p));
  const path = new THREE.CurvePath<THREE.Vector3>();
  if (pts.length < 2) {
    path.add(new THREE.LineCurve3(pts[0] ?? new THREE.Vector3(), (pts[0] ?? new THREE.Vector3()).clone().add(new THREE.Vector3(0, 0, 0.001))));
    return path;
  }
  let cur = pts[0]!.clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const a = pts[i - 1]!;
    const b = pts[i + 1]!;
    const la = p.distanceTo(a);
    const lb = p.distanceTo(b);
    const r = Math.min(bend, la / 2, lb / 2);
    const inP = p.clone().add(a.clone().sub(p).normalize().multiplyScalar(r));
    const outP = p.clone().add(b.clone().sub(p).normalize().multiplyScalar(r));
    if (cur.distanceToSquared(inP) > 1e-10) path.add(new THREE.LineCurve3(cur.clone(), inP));
    path.add(new THREE.QuadraticBezierCurve3(inP, p.clone(), outP));
    cur = outP;
  }
  const last = pts[pts.length - 1]!;
  if (cur.distanceToSquared(last) > 1e-10) path.add(new THREE.LineCurve3(cur.clone(), last.clone()));
  return path;
}

function tubeFor(path: THREE.Curve<THREE.Vector3>, radius: number) {
  const len = path.getLength();
  const segs = Math.min(600, Math.max(8, Math.round(len / 0.004)));
  return new THREE.TubeGeometry(path, segs, radius, 8, false);
}

const Z = new THREE.Vector3(0, 0, 1);

/** Colors a tube geometry (vertex colors, linear) for the shared vertex-color wire material. */
function colorize(g: THREE.BufferGeometry, color: string) {
  const c = new THREE.Color(color); // sRGB -> linear working space
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function Wire({ points, color = '#1f4fd1', radius = 0.0011, bendRadius = 0.008, ferrules = false, ferruleColor = '#d0d0d0' }: WireProps) {
  const key = JSON.stringify(points);
  const { geo, ferruleGeo } = useMemo(() => {
    const path = filletedPath(points, bendRadius);
    const g = colorize(tubeFor(path, radius), color);
    let fg: THREE.BufferGeometry | null = null;
    if (ferrules) {
      const b = new Parts();
      for (const [u, flip] of [
        [0, true],
        [1, false],
      ] as [number, boolean][]) {
        const at = path.getPointAt(u);
        const dir = path.getTangentAt(u).clone();
        if (flip) dir.negate();
        const q = new THREE.Quaternion().setFromUnitVectors(Z, dir.normalize());
        const e = new THREE.Euler().setFromQuaternion(q);
        b.at([at.x, at.y, at.z], [e.x, e.y, e.z], (f) => {
          f.add(cylZ(radius * 1.25, radius * 1.35, 0.006, 12), F.gloss(ferruleColor), [0, 0, -0.003]);
          f.add(cylZ(radius * 0.8, radius * 0.8, 0.008, 10), F.metal('#d7d9db', 0.3), [0, 0, 0.004]);
        });
      }
      fg = b.build();
    }
    return { geo: g, ferruleGeo: fg };
  }, [key, radius, bendRadius, color, ferrules, ferruleColor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      geo.dispose();
      ferruleGeo?.dispose();
    },
    [geo, ferruleGeo],
  );
  return (
    <group>
      <mesh geometry={geo} material={wiresMat()} castShadow />
      {ferruleGeo && <mesh geometry={ferruleGeo} material={uberMat()} />}
    </group>
  );
}

export function WireBundle({ points, colors, radius = 0.0011, bendRadius = 0.02, tieSpacing = 0.08 }: WireBundleProps) {
  const key = JSON.stringify(points) + colors.join(',');
  const built = useMemo(() => {
    const path = filletedPath(points, bendRadius);
    const len = path.getLength();
    const samples = Math.max(8, Math.round(len / 0.01));
    const n = colors.length;
    // offsets in a packed circle
    const offs: [number, number][] = [];
    const pitch = radius * 2.05;
    let ring = 0;
    while (offs.length < n) {
      if (ring === 0) offs.push([0, 0]);
      else {
        const count = Math.round((2 * Math.PI * ring * pitch) / pitch);
        for (let k = 0; k < count && offs.length < n; k++) {
          const a = (k / count) * Math.PI * 2 + ring * 0.4;
          offs.push([Math.cos(a) * ring * pitch, Math.sin(a) * ring * pitch]);
        }
      }
      ring++;
    }
    const bundleR = (ring - 0.5) * pitch + radius;
    const frames: { p: THREE.Vector3; n: THREE.Vector3; b: THREE.Vector3; t: THREE.Vector3 }[] = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const p = path.getPointAt(u);
      const t = path.getTangentAt(u).normalize();
      let ref = new THREE.Vector3(0, 0, 1);
      if (Math.abs(t.dot(ref)) > 0.9) ref = new THREE.Vector3(0, 1, 0);
      const nn = new THREE.Vector3().crossVectors(t, ref).normalize();
      const bb = new THREE.Vector3().crossVectors(t, nn).normalize();
      frames.push({ p, n: nn, b: bb, t });
    }
    const geos = offs.map(([a, b], i) => {
      const pts = frames.map((f) => f.p.clone().addScaledVector(f.n, a).addScaledVector(f.b, b));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      return colorize(tubeFor(curve, radius), colors[i] ?? '#1f4fd1');
    });
    const wiresGeo = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    let tiesGeo: THREE.BufferGeometry | null = null;
    if (tieSpacing > 0) {
      const tb = new Parts();
      for (let d = tieSpacing / 2; d < len; d += tieSpacing) {
        const u = d / len;
        const p = path.getPointAt(u);
        const t = path.getTangentAt(u).normalize();
        const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(Z, t));
        tb.add(cylZ(bundleR + 0.0007, bundleR + 0.0007, 0.0026, 16), F.matte('#141414', 0.7), [p.x, p.y, p.z], [e.x, e.y, e.z]);
      }
      if (!tb.empty) tiesGeo = tb.build();
    }
    return { wiresGeo, tiesGeo };
  }, [key, radius, bendRadius, tieSpacing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      built.wiresGeo?.dispose();
      built.tiesGeo?.dispose();
    },
    [built],
  );
  return (
    <group>
      {built.wiresGeo && <mesh geometry={built.wiresGeo} material={wiresMat()} castShadow />}
      {built.tiesGeo && <mesh geometry={built.tiesGeo} material={uberMat()} />}
    </group>
  );
}

export interface WiresProps {
  /** Many conductors merged into ONE mesh (vertex colors) — use for dense panel wiring. */
  wires: { points: Vec3[]; color?: string; radius?: number }[];
  bendRadius?: number;
}

const wiresMat = () =>
  sharedMat('wires-vertex-colors', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.02, shadowSide: THREE.BackSide }));

/** Batch of wires rendered with a single draw call. */
export function Wires({ wires, bendRadius = 0.008 }: WiresProps) {
  const key = JSON.stringify(wires);
  const geo = useMemo(() => {
    const parts = wires.map((w) => colorize(tubeFor(filletedPath(w.points, bendRadius), w.radius ?? 0.0011), w.color ?? '#1f4fd1'));
    const merged = parts.length ? mergeGeometries(parts, false) : null;
    parts.forEach((p) => p.dispose());
    return merged;
  }, [key, bendRadius]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return <mesh geometry={geo} material={wiresMat()} castShadow />;
}
