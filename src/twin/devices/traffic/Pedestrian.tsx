/**
 * Stylized pedestrian (≈1.72 m) with a procedural walk cycle (hip/knee/shoulder/elbow swing, vertical
 * bob, torso counter-rotation), idle breathing, and a reach pose for pressing the crossing button.
 *
 * Conventions (match the traffic scene's `pedestrianPose`): the figure FACES +X, origin = ground
 * between the feet. Drive it with `getDistance` (meters walked → stride phase) and `getWalking`.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { sharedGeo, tmats } from './shared';

export interface PedestrianProps extends Placement {
  /** Clothing variant 0..5 (the traffic scene uses 0..5). */
  variant?: number;
  /** Meters walked (monotonic) — drives the stride phase. */
  getDistance?: () => number;
  /** Walking vs standing (blends the pose). Default: true when getDistance changes. */
  getWalking?: () => boolean;
  /** 0..1: raise the right arm forward (pressing a push button). */
  getReach?: () => number;
  /** Uniform height scale (1 = 1.72 m). */
  height?: number;
}

const OUTFITS = [
  { shirt: '#2f6fd6', pants: '#26303d', skin: '#e9b98f', hair: '#2b1b10', shoes: '#1b1b1b' },
  { shirt: '#d94841', pants: '#3a3a3a', skin: '#c68642', hair: '#121212', shoes: '#f2f2f2' },
  { shirt: '#2e8b57', pants: '#5a4632', skin: '#8d5524', hair: '#121212', shoes: '#3b2a1a' },
  { shirt: '#f2c14e', pants: '#1f3b5c', skin: '#f3cfb0', hair: '#c9a15b', shoes: '#2a2a2a' },
  { shirt: '#6b4fa3', pants: '#6b6b6b', skin: '#e0ac69', hair: '#3a2616', shoes: '#b0412e' },
  { shirt: '#e8e6e1', pants: '#2b2b2b', skin: '#a0673c', hair: '#6d6d6d', shoes: '#1b1b1b' },
];

/** Stride length (m per full cycle = two steps). */
const STRIDE = 1.45;

const cap = (r: number, len: number) => sharedGeo(`ped:cap:${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 12));
const sph = (r: number) => sharedGeo(`ped:sph:${r}`, () => new THREE.SphereGeometry(r, 16, 12));
const hairGeo = () => sharedGeo('ped:hair', () => new THREE.SphereGeometry(0.112, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55));
const shoeGeo = () =>
  sharedGeo('ped:shoe', () => {
    const g = new THREE.CapsuleGeometry(0.048, 0.16, 4, 10);
    g.rotateZ(Math.PI / 2);
    g.scale(1, 0.75, 1.05);
    return g;
  });

interface Joint {
  hipL: THREE.Group | null;
  hipR: THREE.Group | null;
  kneeL: THREE.Group | null;
  kneeR: THREE.Group | null;
  shL: THREE.Group | null;
  shR: THREE.Group | null;
  elL: THREE.Group | null;
  elR: THREE.Group | null;
  torso: THREE.Group | null;
  root: THREE.Group | null;
}

export function Pedestrian({ variant = 0, getDistance, getWalking, getReach, height = 1, position, rotation, scale }: PedestrianProps) {
  const o = OUTFITS[((Math.floor(variant) % OUTFITS.length) + OUTFITS.length) % OUTFITS.length]!;
  const j = useRef<Joint>({ hipL: null, hipR: null, kneeL: null, kneeR: null, shL: null, shR: null, elL: null, elR: null, torso: null, root: null });
  const g = useRef({ getDistance, getWalking, getReach });
  g.current = { getDistance, getWalking, getReach };
  const st = useRef({ lastD: 0, walkBlend: 0, reach: 0, moving: 0 });

  useFrame(({ clock }, dt) => {
    const J = j.current;
    const s = st.current;
    const d = g.current.getDistance?.() ?? 0;
    const moved = Math.abs(d - s.lastD) > 1e-4;
    s.lastD = d;
    s.moving = moved ? 0.25 : Math.max(0, s.moving - dt);
    const walking = g.current.getWalking ? g.current.getWalking() : s.moving > 0;
    s.walkBlend += ((walking ? 1 : 0) - s.walkBlend) * (1 - Math.exp(-dt * 6));
    s.reach += ((g.current.getReach?.() ?? 0) - s.reach) * (1 - Math.exp(-dt * 8));
    const w = s.walkBlend;
    const phi = (d / STRIDE) * Math.PI * 2;
    const sn = Math.sin(phi);
    const cs = Math.cos(phi);
    const t = clock.elapsedTime;
    const breathe = Math.sin(t * 1.6) * 0.01;
    if (J.hipL) J.hipL.rotation.z = w * 0.46 * sn;
    if (J.hipR) J.hipR.rotation.z = -w * 0.46 * sn;
    if (J.kneeL) J.kneeL.rotation.z = -w * (0.08 + 0.85 * Math.max(0, cs) ** 1.5);
    if (J.kneeR) J.kneeR.rotation.z = -w * (0.08 + 0.85 * Math.max(0, -cs) ** 1.5);
    const armL = -w * 0.38 * sn;
    const armR = w * 0.38 * sn;
    if (J.shL) {
      J.shL.rotation.z = armL;
      J.shL.rotation.x = -0.08;
    }
    if (J.shR) {
      J.shR.rotation.z = armR * (1 - s.reach) + 1.35 * s.reach;
      J.shR.rotation.x = 0.08 * (1 - s.reach);
    }
    if (J.elL) J.elL.rotation.z = 0.25 + w * 0.25 * Math.max(0, -sn);
    if (J.elR) J.elR.rotation.z = (0.25 + w * 0.25 * Math.max(0, sn)) * (1 - s.reach) + 0.15 * s.reach;
    if (J.torso) {
      J.torso.rotation.y = w * 0.1 * sn;
      J.torso.rotation.z = -w * 0.05 + breathe;
    }
    if (J.root) J.root.position.y = w * 0.028 * Math.abs(cs) - w * 0.02;
  });

  const cloth = (c: string) => tmats.plastic(c, 0.85);
  const skin = tmats.plastic(o.skin, 0.65);
  const set = (k: keyof Joint) => (el: THREE.Group | null) => {
    j.current[k] = el;
  };

  const leg = (side: 1 | -1) => (
    <group ref={set(side > 0 ? 'hipR' : 'hipL')} position={[0, 0.93, side * 0.095]}>
      <mesh geometry={cap(0.072, 0.3)} material={cloth(o.pants)} position={[0, -0.22, 0]} castShadow />
      <group ref={set(side > 0 ? 'kneeR' : 'kneeL')} position={[0, -0.44, 0]}>
        <mesh geometry={cap(0.058, 0.32)} material={cloth(o.pants)} position={[0, -0.2, 0]} castShadow />
        <mesh geometry={shoeGeo()} material={tmats.plastic(o.shoes, 0.6)} position={[0.045, -0.42, 0]} castShadow />
      </group>
    </group>
  );

  const arm = (side: 1 | -1) => (
    <group ref={set(side > 0 ? 'shR' : 'shL')} position={[0, 0.5, side * 0.205]}>
      <mesh geometry={cap(0.05, 0.2)} material={cloth(o.shirt)} position={[0, -0.14, 0]} castShadow />
      <group ref={set(side > 0 ? 'elR' : 'elL')} position={[0, -0.28, 0]}>
        <mesh geometry={cap(0.04, 0.18)} material={skin} position={[0, -0.12, 0]} castShadow />
        <mesh geometry={sph(0.045)} material={skin} position={[0, -0.25, 0]} castShadow />
      </group>
    </group>
  );

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group scale={height}>
        <group ref={set('root')}>
          {leg(-1)}
          {leg(1)}
          {/* pelvis */}
          <mesh geometry={cap(0.13, 0.12)} material={cloth(o.pants)} position={[0, 0.95, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.8, 1, 1]} castShadow />
          <group ref={set('torso')} position={[0, 0.95, 0]}>
            <mesh geometry={cap(0.15, 0.28)} material={cloth(o.shirt)} position={[0, 0.28, 0]} scale={[0.72, 1, 1.18]} castShadow />
            {arm(-1)}
            {arm(1)}
            <mesh geometry={cap(0.045, 0.05)} material={skin} position={[0, 0.58, 0]} />
            <group position={[0, 0.7, 0]}>
              <mesh geometry={sph(0.105)} material={skin} scale={[1, 1.12, 0.95]} castShadow />
              <mesh geometry={hairGeo()} material={tmats.plastic(o.hair, 0.9)} position={[-0.012, 0.012, 0]} rotation={[0, 0, 0.35]} scale={[1, 1.1, 0.98]} />
              <mesh geometry={sph(0.018)} material={skin} position={[0.1, -0.005, 0]} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
