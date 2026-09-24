/**
 * Stylized pedestrian (≈1.72 m) with a procedural walk cycle (hip/knee/shoulder/elbow swing, vertical
 * bob, torso counter-rotation), idle breathing, and a reach pose for pressing the crossing button.
 *
 * Conventions (match the traffic scene's `pedestrianPose`): the figure FACES +X, origin = ground
 * between the feet. Drive it with `getDistance` (meters walked → stride phase) and `getWalking`.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { mergeVc, sharedGeo, useDisposable, vc, vcMaterial, xf } from './shared';

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

/** Leg rig (figure units): hip height, hip→knee, knee→shoe centre offset, shoe half length/height. */
const LEG = { hip: 0.93, thigh: 0.44, shoeX: 0.045, shoeY: 0.42, halfLen: 0.128, halfH: 0.036 } as const;

/** Lowest point of a shoe (figure units, root frame) for the given hip & knee angles (about +Z). */
function soleY(hip: number, knee: number): number {
  // knee position
  const ky = LEG.hip - LEG.thigh * Math.cos(hip);
  const a = hip + knee;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  // shoe centre = knee + R(a) · (shoeX, −shoeY)
  const cy = ky + LEG.shoeX * sn - LEG.shoeY * c;
  return cy - (LEG.halfLen * Math.abs(sn) + LEG.halfH * Math.abs(c));
}

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
  hipL: THREE.Object3D | null;
  hipR: THREE.Object3D | null;
  kneeL: THREE.Object3D | null;
  kneeR: THREE.Object3D | null;
  shL: THREE.Object3D | null;
  shR: THREE.Object3D | null;
  elL: THREE.Object3D | null;
  elR: THREE.Object3D | null;
  torso: THREE.Object3D | null;
  root: THREE.Object3D | null;
}

type BoneName = keyof Joint;

/** Rig: bone → [parent, rest position relative to the parent] (figure units, faces +X). */
const RIG: [BoneName, BoneName | null, [number, number, number]][] = [
  ['root', null, [0, 0, 0]],
  ['hipL', 'root', [0, LEG.hip, -0.095]],
  ['kneeL', 'hipL', [0, -LEG.thigh, 0]],
  ['hipR', 'root', [0, LEG.hip, 0.095]],
  ['kneeR', 'hipR', [0, -LEG.thigh, 0]],
  ['torso', 'root', [0, 0.95, 0]],
  ['shL', 'torso', [0, 0.46, -0.185]],
  ['elL', 'shL', [0, -0.28, 0]],
  ['shR', 'torso', [0, 0.46, 0.185]],
  ['elR', 'shR', [0, -0.28, 0]],
];
const BONE_INDEX = Object.fromEntries(RIG.map(([n], i) => [n, i])) as Record<BoneName, number>;

/** Model-space rest position of a bone. */
function restPos(name: BoneName): THREE.Vector3 {
  const v = new THREE.Vector3();
  let cur: BoneName | null = name;
  while (cur) {
    const entry = RIG.find((r) => r[0] === cur)!;
    v.add(new THREE.Vector3(...entry[2]));
    cur = entry[1];
  }
  return v;
}

const pedGeoCache = new Map<number, THREE.BufferGeometry>();

/**
 * All body parts of one outfit in ONE rigidly skinned geometry (per-vertex finishes + skinIndex):
 * the whole figure is a single draw call (plus shadow passes).
 */
function bodyGeometry(v: number): THREE.BufferGeometry {
  const hit = pedGeoCache.get(v);
  if (hit) return hit;
  const o = OUTFITS[v]!;
  const cloth = (c: string) => ({ color: c, roughness: 0.85, metalness: 0 });
  const skin = { color: o.skin, roughness: 0.65, metalness: 0 };
  const parts: THREE.BufferGeometry[] = [];
  /** Add a part given in its bone's local frame. */
  const P = (bone: BoneName, g: THREE.BufferGeometry, f: { color: string; roughness: number; metalness: number }, pos: [number, number, number] = [0, 0, 0], rot?: [number, number, number], sc?: [number, number, number]) => {
    const rp = restPos(bone);
    const part = vc(xf(g, [pos[0] + rp.x, pos[1] + rp.y, pos[2] + rp.z], rot, sc), f);
    const n = part.attributes.position!.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = BONE_INDEX[bone];
      sw[i * 4] = 1;
    }
    part.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    part.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    parts.push(part);
  };
  P('root', cap(0.13, 0.12), cloth(o.pants), [0, 0.95, 0], [Math.PI / 2, 0, 0], [0.8, 1, 1]); // pelvis
  P('torso', cap(0.15, 0.28), cloth(o.shirt), [0, 0.28, 0], [0, 0, 0], [0.72, 1, 1.18]);
  P('torso', cap(0.07, 0.22), cloth(o.shirt), [0, 0.455, 0], [Math.PI / 2, 0, 0], [0.85, 1, 1]); // shoulder yoke
  P('torso', cap(0.045, 0.05), skin, [0, 0.58, 0]);
  P('torso', sph(0.105), skin, [0, 0.7, 0], [0, 0, 0], [1, 1.12, 0.95]);
  P('torso', hairGeo(), { color: o.hair, roughness: 0.9, metalness: 0 }, [-0.012, 0.712, 0], [0, 0, 0.35], [1, 1.1, 0.98]);
  P('torso', sph(0.018), skin, [0.1, 0.695, 0]);
  for (const [hip, knee] of [
    ['hipL', 'kneeL'],
    ['hipR', 'kneeR'],
  ] as const) {
    P(hip, cap(0.072, 0.3), cloth(o.pants), [0, -0.22, 0]);
    P(knee, cap(0.058, 0.32), cloth(o.pants), [0, -0.2, 0]);
    P(knee, shoeGeo(), { color: o.shoes, roughness: 0.6, metalness: 0 }, [LEG.shoeX, -LEG.shoeY, 0]);
  }
  for (const [sh, el] of [
    ['shL', 'elL'],
    ['shR', 'elR'],
  ] as const) {
    P(sh, sph(0.062), cloth(o.shirt));
    P(sh, cap(0.05, 0.2), cloth(o.shirt), [0, -0.14, 0]);
    P(el, cap(0.04, 0.18), skin, [0, -0.12, 0]);
    P(el, sph(0.045), skin, [0, -0.25, 0]);
  }
  const g = mergeVc(parts);
  pedGeoCache.set(v, g);
  return g;
}

/** A skinned figure instance (own bones & skeleton, shared geometry & material). */
function makeRig(v: number): { mesh: THREE.SkinnedMesh; bones: Record<BoneName, THREE.Bone>; skeleton: THREE.Skeleton } {
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const [name, parent, pos] of RIG) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(...pos);
    bones[name] = b;
    if (parent) bones[parent].add(b);
  }
  const mesh = new THREE.SkinnedMesh(bodyGeometry(v), vcMaterial());
  mesh.castShadow = true;
  mesh.add(bones.root);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(RIG.map(([n]) => bones[n]));
  mesh.bind(skeleton);
  return { mesh, bones, skeleton };
}

export function Pedestrian({ variant = 0, getDistance, getWalking, getReach, height = 1, position, rotation, scale }: PedestrianProps) {
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
    const hipL = w * 0.46 * sn;
    const hipR = -w * 0.46 * sn;
    const kneeL = -w * (0.08 + 0.85 * Math.max(0, cs) ** 1.5);
    const kneeR = -w * (0.08 + 0.85 * Math.max(0, -cs) ** 1.5);
    if (J.hipL) J.hipL.rotation.z = hipL;
    if (J.hipR) J.hipR.rotation.z = hipR;
    if (J.kneeL) J.kneeL.rotation.z = kneeL;
    if (J.kneeR) J.kneeR.rotation.z = kneeR;
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
    // Ground contact: put the lowest shoe sole exactly on y = 0 (the planted foot stays on the
    // ground and the body bobs naturally over the stride).
    if (J.root) J.root.position.y = -Math.min(soleY(hipL, kneeL), soleY(hipR, kneeR));
  });

  const rig = useMemo(() => makeRig(((Math.floor(variant) % OUTFITS.length) + OUTFITS.length) % OUTFITS.length), [variant]);
  useDisposable(useMemo(() => [rig.skeleton], [rig]));
  useLayoutEffect(() => {
    const J = j.current;
    for (const k of Object.keys(rig.bones) as BoneName[]) J[k] = rig.bones[k];
  }, [rig]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group scale={height}>
        <primitive object={rig.mesh} />
      </group>
    </group>
  );
}
