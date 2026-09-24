/**
 * Conveyor head drive of the motor station (world coordinates, see ./layout.ts):
 * fabricated drive platform with checker-plate deck, inline helical reducer, jaw couplings with
 * perforated safety-yellow guards, head-shaft coupling and a deck junction box for the motor conduit.
 * The 5 HP motor itself is the shared <Motor> twin (placed by the view).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { FONT, Instances, KBOX, KCYL, Slab, canvasTexture, kgeo, km, kmat } from '../trainer/kit';
import { AXIS_Y, DRIVE, FRAME_X, HEAD_Z, PULLEY_R } from './layout';

export const MACHINE_BLUE = '#2f5f8f';
const CAST = '#3b5875';
const YELLOW = '#f2c200';

/** Cylinder along X (unit, centered) scaled to radius r and length l. */
function cylX(r: number, l: number) {
  return { geometry: KCYL(), rotation: [0, 0, Math.PI / 2] as Vec3, scale: [r * 2, l, r * 2] as Vec3 };
}

function checkerPlateMaterial() {
  return kmat('ms:checker', () => {
    const t = canvasTexture(
      'checker-plate',
      128,
      128,
      (ctx, w, h) => {
        ctx.fillStyle = '#7d8388';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#a9afb4';
        const lug = (x: number, y: number, a: number) => {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.ellipse(0, 0, 16, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };
        lug(32, 32, Math.PI / 4);
        lug(96, 32, -Math.PI / 4);
        lug(32, 96, -Math.PI / 4);
        lug(96, 96, Math.PI / 4);
      },
      { repeat: true },
    ).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(0.97 / 0.06, 0.55 / 0.06);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.75 });
  });
}

/** Perforated sheet (round holes) — lets you glimpse the spinning coupling behind the guard. */
function perforatedYellow() {
  return kmat('ms:perf-yellow', () => {
    const t = canvasTexture(
      'perf-alpha',
      64,
      64,
      (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#000000';
        for (const [x, y] of [
          [16, 16],
          [48, 48],
        ]) {
          ctx.beginPath();
          ctx.arc(x!, y!, 10, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      { repeat: true, color: false },
    ).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color: YELLOW, roughness: 0.5, metalness: 0.2, alphaMap: t, alphaTest: 0.5, side: THREE.DoubleSide });
  });
}

function reducerPlateTexture() {
  return canvasTexture('ms-reducer-plate', 320, 160, (ctx, w, h) => {
    ctx.fillStyle = '#c9cdd0';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#1b1d20';
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText('HELICAL GEAR REDUCER', 16, 38);
    ctx.font = `600 21px ${FONT}`;
    ctx.fillText(`RATIO  ${DRIVE.ratio} : 1`, 16, 72);
    ctx.fillText('INPUT 5 HP @ 1750 RPM', 16, 102);
    ctx.fillText('OIL  ISO VG 220  ·  3.2 L', 16, 132);
  });
}

// ---------------------------------------------------------------------------

/** Fabricated platform under the motor and reducer, bolted to the floor and braced to the conveyor frame. */
export function DrivePlatform() {
  const d = DRIVE.deck;
  const paint = km.paint(MACHINE_BLUE, 0.5, 0.35);
  const legs = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (const x of [d.x0 + 0.04, d.x1 - 0.04]) for (const z of [d.z0 + 0.04, d.z1 - 0.04]) out.push({ p: [x, (d.top - d.t - 0.1) / 2, z], s: [0.06, d.top - d.t - 0.1, 0.06] });
    return out;
  }, [d]);
  const feet = useMemo(() => legs.map((l) => ({ p: [l.p[0], 0.006, l.p[2]] as Vec3, s: [0.14, 0.012, 0.14] as Vec3 })), [legs]);
  const bolts = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (const f of feet) for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push({ p: [f.p[0] + a! * 0.05, 0.02, f.p[2] + b! * 0.05], s: [0.014, 0.016, 0.014] });
    return out;
  }, [feet]);
  const yTop = d.top - d.t;
  const steel = useMemo(() => {
    const box = (min: Vec3, max: Vec3) => ({ p: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as Vec3, s: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as Vec3 });
    return [
      ...legs,
      ...feet,
      box([d.x0, yTop - 0.1, d.z0], [d.x1, yTop, d.z0 + 0.05]),
      box([d.x0, yTop - 0.1, d.z1 - 0.05], [d.x1, yTop, d.z1]),
      box([d.x0, yTop - 0.1, d.z0], [d.x0 + 0.05, yTop, d.z1]),
      box([d.x1 - 0.05, yTop - 0.1, d.z0], [d.x1, yTop, d.z1]),
      box([FRAME_X, yTop - 0.1, -0.2], [d.x0, yTop, -0.19]),
      box([FRAME_X, yTop - 0.1, 0.19], [d.x0, yTop, 0.2]),
    ];
  }, [legs, feet, d, yTop]);
  return (
    <group>
      {/* checker-plate deck */}
      <mesh geometry={KBOX()} material={checkerPlateMaterial()} position={[(d.x0 + d.x1) / 2, d.top - d.t / 2, (d.z0 + d.z1) / 2]} scale={[d.x1 - d.x0, d.t, d.z1 - d.z0]} castShadow receiveShadow />
      {/* perimeter channels, legs, base plates, tie brackets (one instanced mesh) + anchors */}
      <Instances geometry={KBOX()} material={paint} items={steel} />
      <Instances geometry={KCYL()} material={km.metal('#b9bdc1', 0.35)} items={bolts} castShadow={false} />
      {/* X bracing on the long sides */}
      {[d.z0 + 0.04, d.z1 - 0.04].map((z) => (
        <mesh key={z} geometry={KBOX()} material={paint} position={[(d.x0 + d.x1) / 2, (yTop - 0.1) / 2, z]} rotation={[0, 0, Math.atan2(yTop - 0.14, d.x1 - d.x0 - 0.1)]} scale={[Math.hypot(yTop - 0.14, d.x1 - d.x0 - 0.1), 0.04, 0.008]} castShadow />
      ))}
      {/* motor shim / slide base */}
      <Slab min={[DRIVE.shim.x0, d.top, DRIVE.shim.z0]} max={[DRIVE.shim.x1, DRIVE.motor[1], DRIVE.shim.z1]} material={km.paint('#3d4247', 0.45, 0.4)} castShadow />
      {/* safety-yellow edge stripe on the deck front */}
      <Slab min={[d.x0, yTop - 0.1, d.z1]} max={[d.x1, yTop, d.z1 + 0.002]} material={kmat('ms:deck-hazard', () => new THREE.MeshStandardMaterial({ color: YELLOW, roughness: 0.5 }))} />
    </group>
  );
}

/** Inline helical reducer, coaxial input/output along X (input toward +X). */
export function InlineReducer({ getInputAngle, getOutputAngle }: { getInputAngle: () => number; getOutputAngle: () => number }) {
  const r = DRIVE.reducer;
  const cast = km.paint(CAST, 0.55, 0.25);
  const cx = (r.x0 + r.x1) / 2;
  const inHub = useRef<THREE.Group>(null);
  const outHub = useRef<THREE.Group>(null);
  useFrame(() => {
    if (inHub.current) inHub.current.rotation.x = getInputAngle();
    if (outHub.current) outHub.current.rotation.x = getOutputAngle();
  });
  const ribs = useMemo(() => [-0.06, -0.03, 0, 0.03, 0.06].map((z) => ({ p: [cx, AXIS_Y + r.h / 2 + 0.006, HEAD_Z + z] as Vec3, s: [r.x1 - r.x0 - 0.03, 0.012, 0.006] as Vec3 })), [cx, r]);
  const housingGeo = kgeo('ms:reducer-housing', () => {
    const g = new THREE.CylinderGeometry(r.h / 2, r.h / 2, r.x1 - r.x0, 40);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 1, r.d / r.h);
    return g;
  });
  return (
    <group>
      {/* housing: elliptic barrel + square base with feet */}
      <mesh geometry={housingGeo} material={cast} position={[cx, AXIS_Y, HEAD_Z]} castShadow receiveShadow />
      <Slab min={[r.x0 + 0.01, DRIVE.deck.top + 0.012, HEAD_Z - r.d / 2 + 0.01]} max={[r.x1 - 0.01, AXIS_Y, HEAD_Z + r.d / 2 - 0.01]} material={cast} castShadow />
      <Slab min={[r.x0 + 0.02, DRIVE.deck.top, HEAD_Z - 0.13]} max={[r.x1 - 0.02, DRIVE.deck.top + 0.016, HEAD_Z + 0.13]} material={cast} castShadow />
      <Instances geometry={KBOX()} material={cast} items={ribs} />
      {/* output (−X) and input (+X) bearing bosses + seal caps */}
      <mesh {...cylX(0.078, 0.03)} material={cast} position={[r.x0 - 0.012, AXIS_Y, HEAD_Z]} castShadow />
      <mesh {...cylX(0.042, 0.016)} material={km.metal('#8f969c', 0.4)} position={[r.x0 - 0.034, AXIS_Y, HEAD_Z]} />
      <mesh {...cylX(0.058, 0.026)} material={cast} position={[r.x1 + 0.011, AXIS_Y, HEAD_Z]} castShadow />
      <mesh {...cylX(0.03, 0.012)} material={km.metal('#8f969c', 0.4)} position={[r.x1 + 0.03, AXIS_Y, HEAD_Z]} />
      {/* breather, drain & level plug, eye bolt */}
      <mesh geometry={KCYL()} material={km.plastic('#d8b400', 0.5)} scale={[0.018, 0.02, 0.018]} position={[cx + 0.05, AXIS_Y + r.h / 2 + 0.016, HEAD_Z + 0.04]} />
      <mesh geometry={KCYL()} material={km.metal('#9aa0a6', 0.4)} rotation={[Math.PI / 2, 0, 0]} scale={[0.02, 0.01, 0.02]} position={[cx - 0.05, AXIS_Y - 0.06, HEAD_Z + r.d / 2 + 0.002]} />
      <mesh geometry={KCYL()} material={kmat('ms:sightglass', () => new THREE.MeshStandardMaterial({ color: '#c88a22', roughness: 0.1, metalness: 0.1, emissive: '#3a2400' }))} rotation={[Math.PI / 2, 0, 0]} scale={[0.018, 0.008, 0.018]} position={[cx + 0.05, AXIS_Y - 0.02, HEAD_Z + r.d / 2 + 0.003]} />
      <mesh geometry={kgeo('ms:eye', () => new THREE.TorusGeometry(0.016, 0.005, 8, 20))} material={km.metal('#c2c6ca', 0.35)} position={[cx - 0.05, AXIS_Y + r.h / 2 + 0.035, HEAD_Z]} castShadow />
      {/* nameplate on the operator side */}
      <mesh geometry={KBOX()} material={km.label(reducerPlateTexture(), 0.4)} scale={[0.1, 0.05, 0.001]} position={[cx - 0.01, AXIS_Y + 0.035, HEAD_Z + r.d / 2 * 0.93 + 0.004]} />
      {/* input shaft + reducer-side jaw hub (spins with the motor) */}
      <group ref={inHub} position={[0, AXIS_Y, HEAD_Z]}>
        <mesh {...cylX(0.014, 0.05)} material={km.metal('#cfd3d6', 0.25)} position={[r.x1 + 0.06, 0, 0]} />
        <mesh {...cylX(0.0315, 0.034)} material={km.paint('#4b4f54', 0.4, 0.6)} position={[0.722, 0, 0]} castShadow />
        <mesh geometry={KBOX()} material={km.plastic('#f1f1ec', 0.5)} scale={[0.03, 0.002, 0.008]} position={[0.722, 0.032, 0]} />
      </group>
      {/* output shaft + couplings to the head pulley shaft (spin with the belt) */}
      <group ref={outHub} position={[0, AXIS_Y, HEAD_Z]}>
        <mesh {...cylX(0.022, 0.1)} material={km.metal('#cfd3d6', 0.25)} position={[(FRAME_X + r.x0) / 2, 0, 0]} />
        <mesh {...cylX(0.045, 0.028)} material={km.paint('#4b4f54', 0.4, 0.6)} position={[0.352, 0, 0]} castShadow />
        <mesh {...cylX(0.045, 0.028)} material={km.paint('#4b4f54', 0.4, 0.6)} position={[0.386, 0, 0]} castShadow />
        <mesh {...cylX(0.04, 0.008)} material={km.plastic('#e8741c', 0.5)} position={[0.369, 0, 0]} />
        <mesh geometry={KBOX()} material={km.plastic('#f1f1ec', 0.5)} scale={[0.06, 0.002, 0.01]} position={[0.369, 0.046, 0]} />
      </group>
    </group>
  );
}

/** Bolted U-shaped coupling guard (perforated yellow sheet) spanning [x0, x1] along the drive axis. 2 draw calls. */
export function CouplingGuard({ x0, x1, halfW, top }: { x0: number; x1: number; halfW: number; top: number }) {
  const mat = perforatedYellow();
  const solid = kmat('ms:guard-solid', () => new THREE.MeshStandardMaterial({ color: YELLOW, roughness: 0.5, metalness: 0.2 }));
  const y0 = DRIVE.deck.top;
  const cx = (x0 + x1) / 2;
  const L = x1 - x0;
  const yT = AXIS_Y + top;
  const parts = useMemo(() => {
    const sides = [-1, 1].map((sd) => ({ p: [cx, (y0 + yT) / 2, HEAD_Z + sd * halfW] as Vec3, s: [L, yT - y0, 0.002] as Vec3 }));
    const sheet: { p: Vec3; s: Vec3 }[] = [{ p: [cx, yT, HEAD_Z], s: [L, 0.003, halfW * 2 + 0.004] }];
    for (const sd of [-1, 1]) {
      sheet.push({ p: [cx, yT - 0.012, HEAD_Z + sd * halfW], s: [L, 0.024, 0.004] });
      sheet.push({ p: [cx, y0 + 0.012, HEAD_Z + sd * halfW], s: [L, 0.024, 0.004] });
      sheet.push({ p: [cx, y0 + 0.002, HEAD_Z + sd * (halfW + 0.015)], s: [L, 0.004, 0.03] });
    }
    return { sides, sheet };
  }, [cx, L, y0, yT, halfW]);
  return (
    <group>
      <Instances geometry={KBOX()} material={mat} items={parts.sides} />
      <Instances geometry={KBOX()} material={solid} items={parts.sheet} />
    </group>
  );
}

/** Junction box under the deck front edge where the motor conduit meets the field wiring. */
export function DeckJunctionBox({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh geometry={KBOX()} material={km.paint('#8d9296', 0.45, 0.4)} scale={[0.12, 0.1, 0.07]} castShadow />
      <mesh geometry={KBOX()} material={km.paint('#9aa0a4', 0.4, 0.4)} scale={[0.124, 0.104, 0.006]} position={[0, 0, 0.037]} />
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([a, b], i) => (
        <mesh key={i} geometry={KCYL()} material={km.metal('#c5c9cc', 0.3)} rotation={[Math.PI / 2, 0, 0]} scale={[0.008, 0.004, 0.008]} position={[a! * 0.05, b! * 0.04, 0.041]} />
      ))}
    </group>
  );
}

/** Head pulley angle (rad) from the belt travel. */
export function headAngle(beltPosition: number): number {
  return -(beltPosition / PULLEY_R) % (Math.PI * 2);
}
