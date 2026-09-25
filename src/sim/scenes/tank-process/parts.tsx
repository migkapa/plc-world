/**
 * Parts of the `tank-process` twin: skid, feed tank T-100 + centrifugal feed pump P-100 (local pressure-switch
 * control), access platform with ladder and handrails, pipe rack, IBC tote, drain tundish, the local operator panel
 * (Start / Stop / Discharge / E-stop, pilot lights) and the AH-101 alarm beacon-sounder on its mast. The liquid
 * effects live in ./fx.tsx.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  EStop800FM,
  Enclosure,
  FieldMerge,
  Motor,
  motorBodyLength,
  PilotLight800F,
  PushButton800F,
  StackLight856T,
} from '../../../twin/devices';
import type { Vec3 } from '../../../twin/contracts';
import type { SimRuntime } from '../../types';
import { Instances, paint, steel, stripeMaterial, unitBox, unitCylY, WallSign, YELLOW } from '../conveyor-sort/hall';
import { Glow, IoHotspot, momentaryControl, toggleControl } from '../conveyor-sort/kit';
import { SKID, SKID_H, TANK_D, TANK_H, TL, ZI } from './layout';
import type { TankProcessState } from './logic';

export { SKID_H, TANK_D, TANK_H, TL, ZI };

// ---------------------------------------------------------------------------
// Skid & platform
// ---------------------------------------------------------------------------

export function Skid() {
  const { w, d } = SKID;
  const ch = paint('#35536f', 0.5, 0.4);
  // channel tops stay 8 mm below the deck top: no coplanar faces with the 6 mm checker plate (no z-fighting)
  const chH = SKID_H - 0.008;
  return (
    <group>
      <Instances
        geometry={unitBox}
        material={ch}
        items={[
          ...[-1, 1].map((sz) => ({ p: [0, chH / 2, (sz * d) / 2] as Vec3, s: [w, chH, 0.1] as Vec3 })),
          ...[-1, 0, 1].map((sx) => ({ p: [(sx * w) / 2 - sx * 0.05, chH / 2, 0] as Vec3, s: [0.1, chH, d] as Vec3 })),
          ...[-1, 1].map((sz) => ({ p: [0, (chH * 0.8) / 2, sz * 0.5] as Vec3, s: [w - 0.1, chH * 0.8, 0.08] as Vec3 })),
        ]}
      />
      {/* checker plate deck (top = SKID_H) */}
      <mesh position={[0, SKID_H - 0.003, 0]} receiveShadow material={checkerMat()}>
        <boxGeometry args={[w - 0.02, 0.006, d - 0.02]} />
      </mesh>
      {/* lifting lugs */}
      <Instances
        geometry={unitBox}
        material={paint(YELLOW, 0.45, 0.3)}
        items={[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [(sx * w) / 2, SKID_H + 0.04, sz * (d / 2 + 0.03)] as Vec3, s: [0.08, 0.08, 0.012] as Vec3 })))}
      />
    </group>
  );
}

let checker: THREE.MeshStandardMaterial | null = null;
function checkerMat() {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7a7f83';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#a4a9ad';
  for (let y = 0; y < 128; y += 32)
    for (let x = 0; x < 128; x += 32) {
      ctx.save();
      ctx.translate(x + 8, y + 8);
      ctx.rotate(0.7);
      ctx.fillRect(-7, -1.6, 14, 3.2);
      ctx.restore();
      ctx.save();
      ctx.translate(x + 24, y + 24);
      ctx.rotate(-0.7);
      ctx.fillRect(-7, -1.6, 14, 3.2);
      ctx.restore();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(18, 16);
  checker = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, metalness: 0.7 });
  return checker;
}

let grating: THREE.MeshStandardMaterial | null = null;
function gratingMat() {
  if (grating) return grating;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#fff';
  for (let x = 0; x < 64; x += 8) ctx.fillRect(x, 0, 2, 64);
  for (let y = 0; y < 64; y += 32) ctx.fillRect(0, y, 64, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 8);
  grating = new THREE.MeshStandardMaterial({ color: '#8c9296', metalness: 0.7, roughness: 0.45, alphaMap: t, alphaTest: 0.5, side: THREE.DoubleSide });
  return grating;
}

export const PLATFORM = { x0: -1.15, x1: 1.15, z0: -1.62, z1: -0.74, y: 2.08 } as const;

/** Access platform behind the tank (grating deck, handrails with mid rails & toe boards, ladder). */
export function Platform() {
  const { x0, x1, z0, z1, y } = PLATFORM;
  const galv = steel('#9ea6ac', 0.45);
  const rail = paint(YELLOW, 0.45, 0.3);
  const data = useMemo(() => {
    const posts: { p: Vec3; s: Vec3 }[] = [];
    const beams: { p: Vec3; s: Vec3 }[] = [];
    const rails: { p: Vec3; s: Vec3 }[] = [];
    const toes: { p: Vec3; s: Vec3 }[] = [];
    // structure columns
    for (const x of [x0 + 0.05, x1 - 0.05]) for (const z of [z0 + 0.05, z1 - 0.05]) posts.push({ p: [x, y / 2, z], s: [0.08, y, 0.08] });
    // deck frame
    for (const z of [z0 + 0.03, z1 - 0.03]) beams.push({ p: [(x0 + x1) / 2, y - 0.07, z], s: [x1 - x0, 0.14, 0.06] });
    for (const x of [x0 + 0.03, x1 - 0.03, 0]) beams.push({ p: [x, y - 0.07, (z0 + z1) / 2], s: [0.06, 0.14, z1 - z0] });
    // knee braces
    for (const x of [x0 + 0.05, x1 - 0.05]) beams.push({ p: [x, 0.6, (z0 + z1) / 2], s: [0.05, 0.05, z1 - z0 - 0.1] });
    // handrail runs: back, left, right (ladder gap on the right), front (toward the tank)
    const runs: [number, number, number, number][] = [
      [x0, z0, x1, z0],
      [x0, z0, x0, z1],
      [x1, z0, x1, z0 + 0.22],
      [x1, z1 - 0.12, x1, z1],
      [x0, z1, -0.42, z1],
      [0.42, z1, x1, z1],
    ];
    for (const [ax, az, bx, bz] of runs) {
      const len = Math.hypot(bx - ax, bz - az);
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      for (const h of [1.1, 0.55]) rails.push({ p: [cx, y + h, cz], s: alongX ? [len, 0.04, 0.04] : [0.04, 0.04, len] });
      toes.push({ p: [cx, y + 0.05, cz], s: alongX ? [len, 0.1, 0.008] : [0.008, 0.1, len] });
      const n = Math.max(1, Math.ceil(len / 1.0));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        rails.push({ p: [ax + (bx - ax) * f, y + 0.55, az + (bz - az) * f], s: [0.04, 1.1, 0.04] });
      }
    }
    return { posts, beams, rails, toes };
  }, [x0, x1, z0, z1, y]);
  // ladder on the right side (climbs along +X face)
  const lx = x1 + 0.2;
  const lz0 = z0 + 0.3;
  const lz1 = z1 - 0.18;
  const rungs = useMemo(() => {
    const out: { p: Vec3; r: Vec3; s: Vec3 }[] = [];
    for (let h = 0.3; h < y; h += 0.3) out.push({ p: [lx, h, (lz0 + lz1) / 2], r: [Math.PI / 2, 0, 0], s: [0.013, lz1 - lz0, 0.013] });
    return out;
  }, [lx, lz0, lz1, y]);
  return (
    <group>
      <Instances geometry={unitBox} material={paint('#35536f', 0.5, 0.4)} items={[...data.posts, ...data.beams]} />
      <mesh position={[(x0 + x1) / 2, y - 0.015, (z0 + z1) / 2]} material={gratingMat()} castShadow receiveShadow userData={{ noOcclude: true }}>
        <boxGeometry args={[x1 - x0, 0.03, z1 - z0]} />
      </mesh>
      <Instances geometry={unitBox} material={rail} items={data.rails} />
      <Instances geometry={unitBox} material={rail} items={data.toes} />
      {/* ladder */}
      <Instances
        geometry={unitBox}
        material={galv}
        items={[
          { p: [lx, (y + 1.1) / 2, lz0], s: [0.06, y + 1.1, 0.012] },
          { p: [lx, (y + 1.1) / 2, lz1], s: [0.06, y + 1.1, 0.012] },
          { p: [(x1 + lx) / 2, y - 0.2, lz0], s: [lx - x1, 0.04, 0.012] },
          { p: [(x1 + lx) / 2, y - 0.2, lz1], s: [lx - x1, 0.04, 0.012] },
        ]}
      />
      <Instances geometry={unitCylY} material={galv} items={rungs} />
      {/* self-closing gate at the ladder */}
      <Instances
        geometry={unitBox}
        material={rail}
        items={[
          { p: [x1 + 0.02, y + 0.95, (lz0 + lz1) / 2], s: [0.03, 0.03, lz1 - lz0 - 0.04] },
          { p: [x1 + 0.02, y + 0.5, (lz0 + lz1) / 2], s: [0.03, 0.03, lz1 - lz0 - 0.04] },
        ]}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Feed tank + pump
// ---------------------------------------------------------------------------

export const FEED = { x: -4.25, z: ZI, r: 0.55, h: 1.75, base: 0.25, level: 0.68 } as const;
const MOTOR_L = motorBodyLength('small');
export const PUMP = { casingX: -3.3, shaftY: 0.33, motorX: -3.3 + 0.2 + MOTOR_L / 2 + 0.06, starterX: -2.62, starterZ: 0.36 } as const;

/**
 * T-100 raw-water tank. Its level drops while P-100 pumps and recovers slowly (make-up float valve), so a learner can
 * see where the feed comes from.
 */
export function FeedTank({ state }: { state: TankProcessState }) {
  const waterRef = useRef<THREE.Mesh>(null);
  const lvl = useRef<number>(FEED.level);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1);
    lvl.current = THREE.MathUtils.clamp(lvl.current + (state.inflowRate > 0.01 ? -0.005 * (state.inflowRate / 4.5) : 0.003) * d, 0.35, 0.78);
    const m = waterRef.current;
    if (m) {
      const h = FEED.h * lvl.current;
      m.scale.y = h;
      m.position.y = FEED.base + h / 2;
    }
  });
  const hdpe = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: '#e9e3cf', roughness: 0.55, metalness: 0, transmission: 0, transparent: true, opacity: 0.78 }),
    [],
  );
  const water = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5e8fae', roughness: 0.3, transparent: true, opacity: 0.55 }), []);
  useEffect(
    () => () => {
      hdpe.dispose();
      water.dispose();
    },
    [hdpe, water],
  );
  const { x, z, r, h, base } = FEED;
  return (
    <group position={[x, 0, z]}>
      {/* stand */}
      <Instances
        geometry={unitBox}
        material={paint('#35536f', 0.5, 0.4)}
        items={[
          { p: [0, base - 0.02, 0], s: [2 * r + 0.1, 0.04, 2 * r + 0.1] },
          ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [sx * r * 0.8, (base - 0.04) / 2, sz * r * 0.8] as Vec3, s: [0.06, base - 0.04, 0.06] as Vec3 }))),
        ]}
      />
      <mesh ref={waterRef} position={[0, base + h * FEED.level * 0.5, 0]} scale={[1, h * FEED.level, 1]} material={water} userData={{ noOcclude: true }}>
        <cylinderGeometry args={[r - 0.02, r - 0.02, 1, 40]} />
      </mesh>
      <mesh position={[0, base + h / 2, 0]} material={hdpe} castShadow userData={{ noOcclude: true }}>
        <cylinderGeometry args={[r, r, h, 48, 1, true]} />
      </mesh>
      <mesh position={[0, base + h + 0.06, 0]} material={hdpe} castShadow userData={{ noOcclude: true }}>
        <sphereGeometry args={[r, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* molded ribs */}
      <Instances
        geometry={unitCylY}
        material={paint('#dcd5bd', 0.6, 0)}
        items={[0.35, 0.8, 1.25].map((yy) => ({ p: [0, base + yy, 0] as Vec3, s: [r + 0.012, 0.035, r + 0.012] as Vec3 }))}
      />
      {/* lid */}
      <mesh position={[0, base + h + 0.06 + r * 0.98, 0]} material={paint('#1f3f7a', 0.5)}>
        <cylinderGeometry args={[0.16, 0.16, 0.05, 28]} />
      </mesh>
      <WallSign lines={['T-100', 'RAW WATER', '2500 L']} position={[0.12, base + 1.05, r + 0.004]} size={[0.34, 0.3]} bg="#1f3f7a" color="#fff" />
      {/* outlet nozzle toward the pump */}
      <mesh position={[r + 0.06, PUMP.shaftY, 0]} rotation={[0, 0, Math.PI / 2]} material={paint('#8a8f93', 0.4, 0.6)}>
        <cylinderGeometry args={[0.035, 0.035, 0.14, 20]} />
      </mesh>
    </group>
  );
}

export function FeedPump({ state }: { state: TankProcessState }) {
  const rpm = useRef(0);
  useFrame((_, dt) => {
    const on = state.inflowRate > 0.01;
    rpm.current = THREE.MathUtils.damp(rpm.current, on ? 2900 : 0, on ? 3 : 1.2, Math.min(dt, 0.05));
  });
  const { casingX, shaftY, motorX } = PUMP;
  const cast = paint('#2f5f8f', 0.5, 0.35);
  return (
    <group position={[0, 0, ZI]}>
      {/* baseplate */}
      <Instances
        geometry={unitBox}
        material={paint('#3a3f44', 0.5, 0.4)}
        items={[
          { p: [(casingX + motorX) / 2 + 0.05, 0.06, 0], s: [motorX - casingX + 0.5, 0.12, 0.34] },
          { p: [casingX + 0.02, 0.17, 0], s: [0.16, 0.1, 0.16] },
        ]}
      />
      <Motor frame="small" position={[motorX, 0.12 + shaftY - 0.12 - 0.0889, 0]} rotation={[0, -Math.PI / 2, 0]} getRpm={() => rpm.current} />
      {/* coupling guard */}
      <mesh position={[casingX + 0.16, shaftY, 0]} material={paint(YELLOW, 0.45, 0.3)} castShadow>
        <boxGeometry args={[0.14, 0.12, 0.13]} />
      </mesh>
      {/* bearing frame + volute casing (end suction toward −X, discharge up) */}
      <mesh position={[casingX + 0.06, shaftY, 0]} rotation={[0, 0, Math.PI / 2]} material={cast} castShadow>
        <cylinderGeometry args={[0.055, 0.065, 0.1, 24]} />
      </mesh>
      <mesh position={[casingX - 0.02, shaftY + 0.01, 0]} rotation={[0, 0, Math.PI / 2]} material={cast} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 0.08, 32]} />
      </mesh>
      <mesh position={[casingX - 0.02, shaftY + 0.14, 0]} material={cast} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.1, 20]} />
      </mesh>
      <mesh position={[casingX - 0.1, shaftY, 0]} rotation={[0, 0, Math.PI / 2]} material={cast}>
        <cylinderGeometry args={[0.045, 0.05, 0.08, 20]} />
      </mesh>
      <WallSign lines={['P-100']} position={[casingX - 0.02, shaftY + 0.01, 0.042]} size={[0.07, 0.03]} bg="#e8e8e0" />
      {/* discharge pressure gauge */}
      <group position={[casingX - 0.02, 0.63, 0.075]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={paint('#cfd3d6', 0.3, 0.7)}>
          <cylinderGeometry args={[0.04, 0.04, 0.025, 28]} />
        </mesh>
        <mesh position={[0, 0, 0.0126]}>
          <circleGeometry args={[0.035, 28]} />
          <meshStandardMaterial color="#f7f7f2" roughness={0.3} />
        </mesh>
        <GaugeNeedle getValue={() => rpm.current / 2900} />
      </group>
      {/* PS-100 pressure switch on the discharge (starts the pump when the line pressure drops) */}
      <group position={[casingX - 0.02, 0.76, 0.06]}>
        <mesh geometry={unitCylY} material={steel('#b8bec3', 0.35)} position={[0, 0, -0.03]} rotation={[Math.PI / 2, 0, 0]} scale={[0.008, 0.06, 0.008]} />
        <mesh material={paint('#c9ccc8', 0.5, 0.1)} castShadow>
          <boxGeometry args={[0.06, 0.08, 0.05]} />
        </mesh>
        <WallSign lines={['PS-100']} position={[0, 0.012, 0.0255]} size={[0.05, 0.018]} bg="#f4f4f0" />
      </group>
      {/* local DOL starter (HOA) on a post beside the pump */}
      <group position={[PUMP.starterX, 0, PUMP.starterZ]}>
        <Instances
          geometry={unitBox}
          material={paint('#3a3f44', 0.5, 0.4)}
          items={[
            { p: [0, 0.55, -0.04], s: [0.05, 1.1, 0.05] },
            { p: [0, 0.006, -0.04], s: [0.16, 0.012, 0.16] },
          ]}
        />
        <mesh material={paint('#c9ccc8', 0.5, 0.1)} position={[0, 1.0, 0.03]} castShadow>
          <boxGeometry args={[0.18, 0.24, 0.12]} />
        </mesh>
        <WallSign lines={['P-100', 'LOCAL STARTER']} position={[0, 1.08, 0.0905]} size={[0.12, 0.04]} bg="#f4f4f0" />
        {/* run lamp + H-O-A */}
        <mesh position={[-0.04, 0.99, 0.093]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.013, 0.013, 0.008, 18]} />
          <meshStandardMaterial color="#2a6a35" roughness={0.35} />
        </mesh>
        <mesh position={[0.04, 0.99, 0.093]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.016, 0.016, 0.01, 18]} />
          <meshStandardMaterial color="#1b1c1e" roughness={0.4} />
        </mesh>
        <mesh position={[0.04, 0.99, 0.1]}>
          <boxGeometry args={[0.028, 0.006, 0.006]} />
          <meshStandardMaterial color="#e8e8e0" roughness={0.4} />
        </mesh>
        <Glow get={() => rpm.current > 200} color="#2dff5a" position={[-0.04, 0.99, 0.1]} size={0.06} intensity={1.4} />
      </group>
    </group>
  );
}

function GaugeNeedle({ getValue }: { getValue: () => number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.z = 2.2 - getValue() * 2.6;
  });
  return (
    <mesh ref={ref} position={[0, 0, 0.0135]}>
      <boxGeometry args={[0.003, 0.058, 0.001]} />
      <meshStandardMaterial color="#b50f0f" />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Pipe rack
// ---------------------------------------------------------------------------

export const RACK = { z: -2.35, x0: -5.0, x1: 1.9, y: 3.05, bents: [-4.6, -1.5, 1.6] } as const;

export function PipeRack() {
  const { z, x0, x1, y, bents } = RACK;
  const col = paint('#4a5d70', 0.5, 0.35);
  const items = useMemo(() => {
    const out: { p: Vec3; s: Vec3; r?: Vec3 }[] = [];
    for (const x of bents) {
      for (const dz of [-0.35, 0.35]) out.push({ p: [x, (y + 0.35) / 2, z + dz], s: [0.14, y + 0.35, 0.14] });
      for (const yy of [y, y + 0.35]) out.push({ p: [x, yy, z], s: [0.14, 0.12, 0.84] });
      out.push({ p: [x, 0.01, z], s: [0.3, 0.02, 0.9] });
    }
    for (const yy of [y + 0.06, y + 0.41]) for (const dz of [-0.35, 0.35]) out.push({ p: [(x0 + x1) / 2, yy, z + dz], s: [x1 - x0, 0.1, 0.07] });
    return out;
  }, [z, x0, x1, y, bents]);
  const pipes: { d: number; dz: number; color: string; clad?: boolean }[] = [
    { d: 0.114, dz: -0.22, color: '#2e7d4f' },
    { d: 0.089, dz: -0.05, color: '#6b7176' },
    { d: 0.17, dz: 0.16, color: '#c9ced3', clad: true },
  ];
  return (
    <FieldMerge>
      <Instances geometry={unitBox} material={col} items={items} />
      {pipes.map((p, i) => (
        <group key={i}>
          <mesh position={[(x0 + x1) / 2, y + 0.12 + p.d / 2, z + p.dz]} rotation={[0, 0, Math.PI / 2]} material={p.clad ? steel('#c3c8cc', 0.5) : paint(p.color, 0.45, 0.3)} castShadow>
            <cylinderGeometry args={[p.d / 2, p.d / 2, x1 - x0 + 0.3, 20]} />
          </mesh>
          {/* flow direction band / label */}
          {!p.clad && (
            <mesh position={[-2.6 + i * 0.4, y + 0.12 + p.d / 2, z + p.dz]} rotation={[0, 0, Math.PI / 2]} material={stripeMaterial()}>
              <cylinderGeometry args={[p.d / 2 + 0.002, p.d / 2 + 0.002, 0.12, 20]} />
            </mesh>
          )}
          {p.clad &&
            Array.from({ length: 7 }, (_, k) => (
              <mesh key={k} position={[x0 + 0.4 + k * 1.0, y + 0.12 + p.d / 2, z + p.dz]} rotation={[0, 0, Math.PI / 2]} material={steel('#9aa0a5', 0.4)}>
                <cylinderGeometry args={[p.d / 2 + 0.004, p.d / 2 + 0.004, 0.02, 20]} />
              </mesh>
            ))}
        </group>
      ))}
    </FieldMerge>
  );
}

// ---------------------------------------------------------------------------
// IBC tote & drain tundish
// ---------------------------------------------------------------------------

export function IbcTote({ position, rotationY = 0 }: { position: Vec3; rotationY?: number }) {
  const w = 1.2;
  const d = 1.0;
  const h = 1.16;
  const bars = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (let i = 0; i <= 8; i++) {
      const x = -w / 2 + (i * w) / 8;
      for (const z of [-d / 2, d / 2]) out.push({ p: [x, 0.15 + (h - 0.15) / 2, z], s: [0.02, h - 0.15, 0.02] });
    }
    for (let i = 0; i <= 6; i++) {
      const z = -d / 2 + (i * d) / 6;
      for (const x of [-w / 2, w / 2]) out.push({ p: [x, 0.15 + (h - 0.15) / 2, z], s: [0.02, h - 0.15, 0.02] });
    }
    for (const y of [0.16, 0.55, 0.9, h]) {
      out.push({ p: [0, y, -d / 2], s: [w, 0.02, 0.02] }, { p: [0, y, d / 2], s: [w, 0.02, 0.02] });
      out.push({ p: [-w / 2, y, 0], s: [0.02, 0.02, d] }, { p: [w / 2, y, 0], s: [0.02, 0.02, d] });
    }
    out.push({ p: [0, h, 0], s: [0.02, 0.02, d] }, { p: [0, h, 0], s: [w, 0.02, 0.02] });
    return out;
  }, []);
  const bottle = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#f1efe6', roughness: 0.5, transparent: true, opacity: 0.85 }), []);
  useEffect(() => () => bottle.dispose(), [bottle]);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.075, 0]} material={paint('#23272b', 0.6, 0.3)} castShadow receiveShadow>
        <boxGeometry args={[w, 0.15, d]} />
      </mesh>
      <mesh position={[0, 0.16 + (h - 0.2) / 2, 0]} material={bottle} castShadow>
        <boxGeometry args={[w - 0.06, h - 0.2, d - 0.06]} />
      </mesh>
      <Instances geometry={unitBox} material={steel('#b5bbc0', 0.4)} items={bars} />
      <mesh position={[0, h + 0.04, 0]} material={paint('#1d4f91', 0.5)}>
        <cylinderGeometry args={[0.1, 0.1, 0.06, 24]} />
      </mesh>
      <WallSign lines={['IBC', 'ADDITIVE A', '1000 L']} position={[0.2, 0.7, d / 2 + 0.02]} size={[0.3, 0.26]} bg="#f4f4f0" />
    </group>
  );
}

/** Drain tundish (funnel) over a floor drain, with swirl while draining. */
export function Tundish({ position, state }: { position: Vec3; state: TankProcessState }) {
  const swirl = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const m = swirl.current;
    if (!m) return;
    const on = state.outflowRate > 0.05;
    m.visible = on;
    if (on) m.rotation.y += dt * 6;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.14, 0]} material={steel('#c7ccd0', 0.35)} castShadow>
        <cylinderGeometry args={[0.16, 0.05, 0.2, 32, 1, true]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} material={steel('#9aa0a5', 0.4)}>
        <cylinderGeometry args={[0.05, 0.05, 0.05, 20]} />
      </mesh>
      <mesh ref={swirl} position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.03, 0.14, 24]} />
        <meshStandardMaterial color="#86b3d1" roughness={0.1} transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Operator panel (Start / Stop / Discharge / E-stop, pilots, beacon-sounder)
// ---------------------------------------------------------------------------

export const PANEL = { x: 2.78, z: 1.3, ry: 0.35, y: 0.95, size: [0.46, 0.4, 0.16] as Vec3 } as const;

export function OperatorPanel({ state, runtime }: { state: TankProcessState; runtime: SimRuntime }) {
  const [w, h, d] = PANEL.size;
  // door coordinates -> panel-group coordinates (door centre sits at (0, y + h/2, d))
  const doorToLocal = (p: Vec3): Vec3 => [p[0], PANEL.y + h / 2 + p[1], d + p[2]];
  const DEV = {
    running: [-0.14, 0.02, 0] as Vec3,
    done: [-0.06, 0.02, 0] as Vec3,
    start: [-0.14, -0.1, 0] as Vec3,
    stop: [-0.06, -0.1, 0] as Vec3,
    discharge: [0.02, -0.1, 0] as Vec3,
    estop: [0.14, -0.05, 0] as Vec3,
  };
  const start = momentaryControl(runtime, 'start');
  const stop = momentaryControl(runtime, 'stop');
  const discharge = momentaryControl(runtime, 'discharge');
  const estop = toggleControl(runtime, 'estop');
  // chips sit in two columns beside the door (left: lights + START / STOP, right: DISCHARGE / E-stop)
  const hs = (k: keyof typeof DEV, side: -1 | 1, dy = 0) => {
    const p = doorToLocal(DEV[k]);
    return { position: [p[0], p[1] + 0.012, p[2] + 0.02] as Vec3, anchor: [side * (w / 2 + 0.05), p[1] + 0.012 + dy, p[2]] as Vec3 };
  };
  const lamp = (k: keyof typeof DEV): Vec3 => {
    const p = doorToLocal(DEV[k]);
    return [p[0], p[1] + 0.012, p[2] + 0.02];
  };
  return (
    <group position={[PANEL.x, 0, PANEL.z]} rotation={[0, PANEL.ry, 0]}>
      {/* pedestal */}
      <Instances
        geometry={unitBox}
        material={paint('#3b4450', 0.45, 0.35)}
        items={[
          { p: [0, 0.008, 0.05], s: [0.4, 0.016, 0.4] },
          { p: [0, PANEL.y / 2, 0.05], s: [0.09, PANEL.y, 0.09] },
          { p: [0, PANEL.y - 0.008, 0.08], s: [0.3, 0.016, 0.16] },
        ]}
      />
      <Enclosure
        size={PANEL.size}
        position={[0, PANEL.y, 0]}
        nameplate={'OP-101\nMIXING T-101'}
        warningLabel={false}
        docPocket={false}
        glands={2}
        doorChildren={
          <group>
            <PilotLight800F position={DEV.running} color="amber" legend="RUNNING" getLit={() => state.runningLight} panelThickness={0.0015} />
            <PilotLight800F position={DEV.done} color="green" legend="BATCH DONE" getLit={() => state.batchDoneLight} panelThickness={0.0015} />
            <PushButton800F position={DEV.start} color="green" legend="START" contact="N.O." panelThickness={0.0015} {...start} />
            <PushButton800F position={DEV.stop} color="red" style="extended" legend="STOP" contact="N.C." panelThickness={0.0015} {...stop} />
            <PushButton800F position={DEV.discharge} color="black" legend="DISCHARGE" contact="N.O." panelThickness={0.0015} {...discharge} />
            <EStop800FM position={DEV.estop} panelThickness={0.0015} getEngaged={() => Boolean(runtime.getControl('estop'))} onToggle={estop} />
          </group>
        }
      />
      {/* lit lamps stay readable from the overview */}
      <Glow get={() => state.runningLight} color="#ffab1a" position={lamp('running')} size={0.09} />
      <Glow get={() => state.batchDoneLight} color="#2dff5a" position={lamp('done')} size={0.09} intensity={1.2} />
      <IoHotspot runtime={runtime} device="light-running" group="OP-101" size={[0.05, 0.06, 0.05]} {...hs('running', -1, 0.01)} />
      <IoHotspot runtime={runtime} device="light-done" group="OP-101" size={[0.05, 0.06, 0.05]} {...hs('done', -1, -0.03)} />
      <IoHotspot runtime={runtime} device="pb-start" group="OP-101" size={[0.06, 0.07, 0.06]} {...hs('start', -1, 0.012)} press={start} />
      <IoHotspot runtime={runtime} device="pb-stop" group="OP-101" size={[0.06, 0.07, 0.06]} {...hs('stop', -1, -0.03)} press={stop} />
      <IoHotspot runtime={runtime} device="pb-discharge" group="OP-101" size={[0.06, 0.07, 0.06]} {...hs('discharge', 1, -0.05)} press={discharge} />
      <IoHotspot
        runtime={runtime}
        device="estop"
        group="OP-101"
        title="E-stop · 2nd N.C. contact hardwired to the safety relay"
        size={[0.08, 0.09, 0.07]}
        {...hs('estop', 1, 0.03)}
        onClick={estop}
      />
    </group>
  );
}

/** AH-101 alarm beacon + sounder on a short mast (world position of the mast foot). */
export function AlarmBeacon({ state, runtime, position }: { state: TankProcessState; runtime: SimRuntime; position: Vec3 }) {
  const pole = 0.32;
  const topY = 0.012 + pole - 0.004 + 0.03 + 0.056 / 2;
  return (
    <group position={position}>
      <StackLight856T tiers={['red']} mount="pole" poleLength={pole} getTier={() => state.alarmHorn} getFlashing={() => true} getHorn={() => state.alarmHorn} showSoundFx />
      <Glow get={() => state.alarmHorn} color="#ff2a14" position={[0, topY, 0]} size={0.3} flash />
      <IoHotspot runtime={runtime} device="horn" title="AH-101 beacon / horn" size={[0.1, 0.5, 0.1]} position={[0, 0.25, 0]} anchor={[0.08, 0.46, 0]} />
    </group>
  );
}
