/**
 * Belt conveyor (slider-bed type) with aluminum-extrusion or powder-coated steel frame.
 *
 * Coordinates / origin: floor level; X runs along the belt from the TAIL (infeed, x = 0 = tail pulley axis)
 * to the HEAD (discharge, x = length = head pulley axis); Z is across the belt (centered, +Z = front /
 * operator side); the top of the belt is at y = height. The belt scrolls with getBeltPosition() (meters,
 * monotonic): top run moves +X, return run −X, and the belt texture wraps around both pulleys.
 *
 * Includes: side frames with T-slots & end caps, legs with leveling feet, cross ties & bracing, head/tail
 * pulleys in 4-bolt flange bearings, tail take-ups, instanced return rollers, side guide rails on rod
 * brackets (with optional gaps for pushers / chutes), yellow wire-mesh end guards, and a shaft-mounted
 * helical-bevel GearMotor at the head end.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ConveyorProps } from '../../contracts';
import { GEARMOTOR, GearMotor, gearMotorTorqueArmEnd, MOTOR_BLUE } from './Motor';
import { box, type CableRoute, canvasTex, CapScrew, clickable, cylZ, DEVICE_ROOT, fm, geo, HexBolt, Merge, mulberry32, rbox, sphere, TAU } from './shared';

export interface ConveyorExtraProps {
  /** 'extrusion' (clear anodized aluminum profiles, default) or 'powder' (painted formed steel). */
  frameStyle?: 'extrusion' | 'powder';
  /** Paint color for the powder-coated style. */
  frameColor?: string;
  /** Side of the drive (gear motor) at the head end. Default 'back' (−Z). */
  driveSide?: 'front' | 'back' | 'none';
  /** Draw side guide rails (default: follows `guards`, true). */
  guides?: boolean;
  /** Clear distance between the guide rails (default width − 0.05). */
  guideSpacing?: number;
  /** Openings in the guide rails, e.g. for a pusher and a reject chute. */
  guideGaps?: { from: number; to: number; side?: 'front' | 'back' | 'both' }[];
  /** Belt color. */
  beltColor?: string;
  /** Gear motor paint. */
  motorColor?: string;
  /** Show the leg/stand (false for a table-top section). */
  legs?: boolean;
  /** Gear-motor power cable (conveyor PARENT coordinates, false = stop at the gland); default: floor stub. */
  motorCableTo?: CableRoute;
  onClick?: () => void;
}

// Fixed conveyor dimensions (m)
export const CONVEYOR = {
  pulleyR: 0.057,
  beltT: 0.005,
  frameT: 0.04, // side frame thickness (Z)
  frameH: 0.16,
  /** Clearance between belt edge and side frame. */
  edgeGap: 0.022,
  /** Frame top below the belt surface. */
  frameDrop: 0.018,
  legProfile: 0.045,
};

/** Useful derived positions for mounting accessories (sensors, pushers, chutes). */
export function conveyorLayout(width = 0.6, height = 0.85) {
  const { pulleyR, beltT, frameT, frameH, edgeGap, frameDrop } = CONVEYOR;
  const frameZ = width / 2 + edgeGap + frameT / 2;
  return {
    /** Pulley axis height. */
    pulleyY: height - beltT - pulleyR,
    /** Z of the side frame centerlines (±). */
    frameZ,
    /** Z of the outer faces of the side frames (±). */
    frameOuterZ: frameZ + frameT / 2,
    frameTop: height - frameDrop,
    frameBottom: height - frameDrop - frameH,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function beltGeo(L: number, W: number) {
  return geo(`belt:${L.toFixed(3)}:${W.toFixed(3)}`, () => {
    const { pulleyR: rp, beltT: bt } = CONVEYOR;
    const segs = 28;
    // path of the outer & inner surface (clockwise viewed from +Z), starting at the tail top
    const pathAt = (r: number) => {
      const pts: { x: number; y: number; nx: number; ny: number }[] = [];
      pts.push({ x: 0, y: r, nx: 0, ny: 1 });
      pts.push({ x: L, y: r, nx: 0, ny: 1 });
      for (let i = 1; i <= segs; i++) {
        const a = Math.PI / 2 - (i / segs) * Math.PI;
        pts.push({ x: L + r * Math.cos(a), y: r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
      }
      pts.push({ x: 0, y: -r, nx: 0, ny: -1 });
      for (let i = 1; i <= segs; i++) {
        const a = -Math.PI / 2 - (i / segs) * Math.PI;
        pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
      }
      return pts;
    };
    const outer = pathAt(rp + bt);
    const inner = pathAt(rp);
    // arc length along the belt centerline (use the outer path; the texture is the top surface)
    const sAt: number[] = [0];
    for (let i = 1; i < outer.length; i++) sAt.push(sAt[i - 1]! + Math.hypot(outer[i]!.x - outer[i - 1]!.x, outer[i]!.y - outer[i - 1]!.y));
    const loop = sAt[sAt.length - 1]!;
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
      pos.push(x, y, z);
      nor.push(nx, ny, nz);
      uv.push(u, v);
    };
    const h = W / 2;
    for (let i = 0; i < outer.length - 1; i++) {
      const o0 = outer[i]!;
      const o1 = outer[i + 1]!;
      const i0 = inner[i]!;
      const i1 = inner[i + 1]!;
      const u0 = sAt[i]! / loop;
      const u1 = sAt[i + 1]! / loop;
      // outer surface (A,B,C) (B,D,C) with A=(o0,-h) B=(o0,+h) C=(o1,-h) D=(o1,+h)
      push(o0.x, o0.y, -h, o0.nx, o0.ny, 0, u0, 0);
      push(o0.x, o0.y, h, o0.nx, o0.ny, 0, u0, 1);
      push(o1.x, o1.y, -h, o1.nx, o1.ny, 0, u1, 0);
      push(o0.x, o0.y, h, o0.nx, o0.ny, 0, u0, 1);
      push(o1.x, o1.y, h, o1.nx, o1.ny, 0, u1, 1);
      push(o1.x, o1.y, -h, o1.nx, o1.ny, 0, u1, 0);
      // inner surface (reversed)
      push(i0.x, i0.y, -h, -i0.nx, -i0.ny, 0, u0, 0);
      push(i1.x, i1.y, -h, -i1.nx, -i1.ny, 0, u1, 0);
      push(i0.x, i0.y, h, -i0.nx, -i0.ny, 0, u0, 1);
      push(i0.x, i0.y, h, -i0.nx, -i0.ny, 0, u0, 1);
      push(i1.x, i1.y, -h, -i1.nx, -i1.ny, 0, u1, 0);
      push(i1.x, i1.y, h, -i1.nx, -i1.ny, 0, u1, 1);
      // edges
      for (const side of [1, -1]) {
        const z = side * h;
        const tri = (a: [number, number, number, number], b: [number, number, number, number], c: [number, number, number, number]) => {
          const list = side > 0 ? [a, b, c] : [a, c, b];
          for (const p of list) push(p[0], p[1], z, 0, 0, side, p[2], p[3]);
        };
        const O0: [number, number, number, number] = [o0.x, o0.y, u0, side > 0 ? 1 : 0];
        const O1: [number, number, number, number] = [o1.x, o1.y, u1, side > 0 ? 1 : 0];
        const I0: [number, number, number, number] = [i0.x, i0.y, u0, side > 0 ? 1 : 0];
        const I1: [number, number, number, number] = [i1.x, i1.y, u1, side > 0 ? 1 : 0];
        tri(O0, I0, O1);
        tri(I0, I1, O1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.userData.loop = loop;
    return g;
  });
}

function beltMapTex() {
  return canvasTex('beltMap', 2048, 128, (ctx, w, h) => {
    const rnd = mulberry32(21);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // lengthwise wear streaks
    for (let i = 0; i < 300; i++) {
      const y = rnd() * h;
      const v = 200 + Math.floor(rnd() * 55);
      ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
      ctx.fillRect(rnd() * w, y, 40 + rnd() * 400, 0.6 + rnd());
    }
    // finger splice (one per loop) – makes the motion visible
    const sx = w * 0.37;
    ctx.fillStyle = 'rgba(120,120,120,0.9)';
    ctx.beginPath();
    const fingers = 9;
    ctx.moveTo(sx, 0);
    for (let i = 0; i < fingers; i++) {
      const y0 = (i / fingers) * h;
      const y1 = ((i + 0.5) / fingers) * h;
      ctx.lineTo(sx + 10, y0 + 1);
      ctx.lineTo(sx + 10, y1 - 1);
      ctx.lineTo(sx, y1 + 1);
      ctx.lineTo(sx, ((i + 1) / fingers) * h);
    }
    ctx.lineTo(sx - 1.5, h);
    ctx.lineTo(sx - 1.5, 0);
    ctx.fill();
    // printed edge marking
    ctx.fillStyle = 'rgba(150,150,150,0.8)';
    ctx.font = '600 7px Arial, sans-serif';
    for (let x = 60; x < w; x += 512) ctx.fillText('PVC 2-PLY  FDA  →', x, 7);
  });
}

function beltBumpTex() {
  return canvasTex(
    'beltBump',
    256,
    256,
    (ctx, w, h) => {
      const rnd = mulberry32(33);
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2200; i++) {
        const v = rnd() > 0.5 ? 170 : 60;
        ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, 0.8 + rnd() * 1.6, 0, TAU);
        ctx.fill();
      }
    },
    { color: false, wrap: true },
  );
}

/** Wire-mesh alpha (white = wire). */
function meshAlphaTex() {
  return canvasTex(
    'guardMesh',
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(0, i * 32, w, 5);
        ctx.fillRect(i * 32, 0, 5, h);
      }
    },
    { color: false, wrap: true },
  );
}

/** T-slot profile section (w × h in the XY plane), extruded along Z over unit length (-0.5..0.5). */
function slotProfileGeo(key: string, w: number, h: number, slotsX: number[], slotsY: number[], rc = 0.003) {
  return geo(`slotProfile:${key}`, () => {
    const sw = 0.0082;
    const sd = 0.004;
    const pts: THREE.Vector2[] = [];
    const hw = w / 2;
    const hh = h / 2;
    // sides: right (+X, slots along Y), top (+Y, slots along X), left, bottom
    const sides: { n: [number, number]; t: [number, number]; half: number; along: number; slots: number[] }[] = [
      { n: [1, 0], t: [0, 1], half: hw, along: hh, slots: slotsY },
      { n: [0, 1], t: [-1, 0], half: hh, along: hw, slots: slotsX.map((s) => -s) },
      { n: [-1, 0], t: [0, -1], half: hw, along: hh, slots: slotsY.map((s) => -s) },
      { n: [0, -1], t: [1, 0], half: hh, along: hw, slots: slotsX },
    ];
    for (const sd0 of sides) {
      const P = (s: number, inset = 0) =>
        pts.push(new THREE.Vector2(sd0.n[0] * (sd0.half - inset) + sd0.t[0] * s, sd0.n[1] * (sd0.half - inset) + sd0.t[1] * s));
      P(-(sd0.along - rc));
      for (const c of [...sd0.slots].sort((a, b) => a - b)) {
        P(c - sw / 2 - 0.0008);
        P(c - sw / 2, 0.0006);
        P(c - sw / 2, sd);
        P(c + sw / 2, sd);
        P(c + sw / 2, 0.0006);
        P(c + sw / 2 + 0.0008);
      }
      P(sd0.along - rc);
      const cx = (sd0.n[0] * sd0.half + sd0.t[0] * sd0.along) - (sd0.n[0] + sd0.t[0]) * rc;
      const cy = (sd0.n[1] * sd0.half + sd0.t[1] * sd0.along) - (sd0.n[1] + sd0.t[1]) * rc;
      const a0 = Math.atan2(sd0.n[1], sd0.n[0]);
      for (let j = 1; j < 4; j++) {
        const a = a0 + (j / 4) * (Math.PI / 2);
        pts.push(new THREE.Vector2(cx + Math.cos(a) * rc, cy + Math.sin(a) * rc));
      }
    }
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 1, bevelEnabled: false, curveSegments: 3 });
    g.translate(0, 0, -0.5);
    return g;
  });
}

/** C-channel (formed steel) section: web along Y (height h), flanges pointing to +X (outward). */
function channelGeo(h: number) {
  return geo(`channel:${h}`, () => {
    const t = 0.004;
    const fl = 0.045;
    const lip = 0.012;
    const s = new THREE.Shape();
    s.moveTo(0, -h / 2);
    s.lineTo(fl, -h / 2);
    s.lineTo(fl, -h / 2 + lip);
    s.lineTo(fl - t, -h / 2 + lip);
    s.lineTo(fl - t, -h / 2 + t);
    s.lineTo(t, -h / 2 + t);
    s.lineTo(t, h / 2 - t);
    s.lineTo(fl - t, h / 2 - t);
    s.lineTo(fl - t, h / 2 - lip);
    s.lineTo(fl, h / 2 - lip);
    s.lineTo(fl, h / 2);
    s.lineTo(0, h / 2);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    g.translate(-fl / 2, 0, -0.5);
    return g;
  });
}

// ---------------------------------------------------------------------------
// Static instancing helper
// ---------------------------------------------------------------------------

export interface InstanceXf {
  p: [number, number, number];
  /** Euler rotation. */
  r?: [number, number, number];
  /** Alternative to `r`: rotate the geometry's +Z axis onto this direction. */
  dir?: [number, number, number];
  s?: [number, number, number];
}

const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _e4 = new THREE.Euler();
const _v4 = new THREE.Vector3();
const _s4 = new THREE.Vector3();
const _z4 = new THREE.Vector3(0, 0, 1);
const _d4 = new THREE.Vector3();

export function StaticInstances({ geometry, material, items, castShadow = true }: { geometry: THREE.BufferGeometry; material: THREE.Material; items: InstanceXf[]; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((it, i) => {
      if (it.dir) _q4.setFromUnitVectors(_z4, _d4.set(...it.dir).normalize());
      else {
        _e4.set(...(it.r ?? [0, 0, 0]));
        _q4.setFromEuler(_e4);
      }
      _m4.compose(_v4.set(...it.p), _q4, _s4.set(...(it.s ?? [1, 1, 1])));
      m.setMatrixAt(i, _m4);
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return <instancedMesh key={items.length} ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow />;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

/** 4-bolt square flange bearing, axis along Z, mounting face at z = 0, body toward +Z. */
function FlangeBearing({ position, flip = false }: { position: [number, number, number]; flip?: boolean }) {
  const body = fm.cast('#5d6369', 0.55);
  return (
    <group position={position} rotation={flip ? [0, Math.PI, 0] : undefined}>
      <mesh geometry={rbox(0.085, 0.085, 0.014, 0.012, 2)} material={body} position={[0, 0, 0.007]} castShadow />
      <mesh geometry={cylZ(0.03, 0.02, 32, 0.026)} material={body} position={[0, 0, 0.022]} castShadow />
      <mesh geometry={cylZ(0.019, 0.012, 24)} material={fm.steel()} position={[0, 0, 0.034]} />
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([a, b], i) => (
        <HexBolt key={i} d={0.008} position={[a! * 0.03, b! * 0.03, 0.014]} />
      ))}
      <mesh geometry={sphere(0.003, 8)} material={fm.brass()} position={[0, 0.033, 0.018]} />
    </group>
  );
}

function MeshPanel({ w, h, position, rotation }: { w: number; h: number; position: [number, number, number]; rotation?: [number, number, number] }) {
  const meshMat = useMemo(() => {
    const m = fm.sheet('#f1c40f', 0.5).clone();
    m.alphaMap = meshAlphaTex().clone();
    m.alphaMap.wrapS = m.alphaMap.wrapT = THREE.RepeatWrapping;
    m.alphaMap.repeat.set(w / 0.05, h / 0.05);
    m.alphaMap.needsUpdate = true;
    m.alphaTest = 0.5;
    m.side = THREE.DoubleSide;
    return m;
  }, [w, h]);
  useEffect(
    () => () => {
      meshMat.alphaMap?.dispose();
      meshMat.dispose();
    },
    [meshMat],
  );
  const bar = 0.018;
  const frameMat = fm.sheet('#f1c40f', 0.45);
  return (
    <group position={position} rotation={rotation}>
      <mesh material={meshMat}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh geometry={box(w + bar, bar, bar)} material={frameMat} position={[0, h / 2, 0]} castShadow />
      <mesh geometry={box(w + bar, bar, bar)} material={frameMat} position={[0, -h / 2, 0]} castShadow />
      <mesh geometry={box(bar, h, bar)} material={frameMat} position={[w / 2, 0, 0]} castShadow />
      <mesh geometry={box(bar, h, bar)} material={frameMat} position={[-w / 2, 0, 0]} castShadow />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Conveyor
// ---------------------------------------------------------------------------

export function Conveyor({
  length,
  width = 0.6,
  height = 0.85,
  getBeltPosition,
  guards = true,
  frameStyle = 'extrusion',
  frameColor = '#2f5f8f',
  driveSide = 'back',
  guides,
  guideSpacing,
  guideGaps = [],
  beltColor = '#2a2b2e',
  motorColor = MOTOR_BLUE,
  legs = true,
  motorCableTo,
  onClick,
  position,
  rotation,
  scale,
}: ConveyorProps & ConveyorExtraProps) {
  const L = length;
  const W = width;
  const { pulleyR: rp, beltT: bt, frameT, frameH, legProfile: lp } = CONVEYOR;
  const lay = conveyorLayout(W, height);
  const yc = lay.pulleyY;
  const frameCY = (lay.frameTop + lay.frameBottom) / 2;
  const x0 = -0.11;
  const x1 = L + 0.11;
  const frameLen = x1 - x0;
  const showGuides = guides ?? guards;
  const gSpacing = guideSpacing ?? W - 0.05;
  const rr = 0.024; // return roller radius
  const ratio = 25.3;

  const frameMat = frameStyle === 'extrusion' ? fm.anodized('#c2c7cc') : fm.sheet(frameColor, 0.5);
  const legGeo =
    frameStyle === 'extrusion'
      ? slotProfileGeo('leg45', lp, lp, [0], [0])
      : geo('tube50', () => {
          const g = new THREE.BoxGeometry(0.05, 0.05, 1);
          return g;
        });
  const sideGeo = frameStyle === 'extrusion' ? slotProfileGeo('side40x160', frameT, frameH, [0], [-0.05, 0, 0.05]) : channelGeo(frameH);

  // belt material with scrolling textures (per instance)
  const beltMat = useMemo(() => {
    const g = beltGeo(L, W);
    const loop = g.userData.loop as number;
    const map = beltMapTex().clone();
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.needsUpdate = true;
    const bump = beltBumpTex().clone();
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(loop / 0.12, W / 0.12);
    bump.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ color: beltColor, map, bumpMap: bump, bumpScale: 1.5, roughness: 0.78, metalness: 0 });
    m.userData.loop = loop;
    return m;
  }, [L, W, beltColor]);
  useEffect(
    () => () => {
      beltMat.map?.dispose();
      beltMat.bumpMap?.dispose();
      beltMat.dispose();
    },
    [beltMat],
  );

  const headPulley = useRef<THREE.Group>(null);
  const tailPulley = useRef<THREE.Group>(null);
  const rollersRef = useRef<THREE.InstancedMesh>(null);

  const rollerXs = useMemo(() => {
    const n = Math.max(1, Math.floor((L - 0.4) / 1.2));
    return Array.from({ length: n }, (_, i) => 0.3 + ((i + 0.5) * (L - 0.6)) / n);
  }, [L]);
  const rollerY = yc - rp - bt - rr;

  useFrame(() => {
    const pos = getBeltPosition();
    const loop = beltMat.userData.loop as number;
    if (beltMat.map) beltMat.map.offset.x = -((pos / loop) % 1);
    if (beltMat.bumpMap) beltMat.bumpMap.offset.x = -((pos / loop) * beltMat.bumpMap.repeat.x) % 1;
    const a = -pos / rp;
    if (headPulley.current) headPulley.current.rotation.z = a;
    if (tailPulley.current) tailPulley.current.rotation.z = a;
    const rm = rollersRef.current;
    if (rm) {
      const ra = pos / rr;
      _e4.set(0, 0, ra);
      _q4.setFromEuler(_e4);
      for (let i = 0; i < rollerXs.length; i++) {
        _m4.compose(_v4.set(rollerXs[i]!, rollerY, 0), _q4, _s4.set(1, 1, 1));
        rm.setMatrixAt(i, _m4);
      }
      rm.instanceMatrix.needsUpdate = true;
    }
  });

  // ---- static members (legs, ties, braces, guide brackets) ----
  const legXs = useMemo(() => {
    if (!legs) return [] as number[];
    const n = Math.max(2, Math.ceil((L - 0.6) / 1.6) + 1);
    return Array.from({ length: n }, (_, i) => 0.3 + (i * (L - 0.6)) / (n - 1));
  }, [L, legs]);

  const footH = 0.07;
  const legTop = lay.frameBottom;
  const legLen = legTop - footH;
  const profileItems = useMemo(() => {
    const items: InstanceXf[] = [];
    for (const x of legXs) {
      for (const sz of [-1, 1]) {
        items.push({ p: [x, footH + legLen / 2, sz * lay.frameZ], r: [Math.PI / 2, 0, 0], s: [1, 1, legLen] });
      }
      // cross ties (along Z): low and just below the frame
      const tieLen = 2 * lay.frameZ - lp;
      items.push({ p: [x, 0.22, 0], s: [1, 1, tieLen] });
      items.push({ p: [x, legTop - lp / 2, 0], s: [1, 1, tieLen] });
    }
    // lower longitudinal stretchers per side
    if (legXs.length > 1) {
      const a = legXs[0]!;
      const b = legXs[legXs.length - 1]!;
      for (const sz of [-1, 1]) items.push({ p: [(a + b) / 2, 0.22 + lp, sz * lay.frameZ], r: [0, Math.PI / 2, 0], s: [1, 1, b - a - lp] });
      // diagonal braces from the end legs up to the frame
      const braceRun = 0.45;
      const rise = legTop - 0.22 - lp;
      const blen = Math.hypot(braceRun, rise);
      const ang = Math.atan2(rise, braceRun);
      for (const sz of [-1, 1]) {
        items.push({ p: [a + lp / 2 + braceRun / 2, 0.22 + lp + rise / 2, sz * lay.frameZ], dir: [Math.cos(ang), Math.sin(ang), 0], s: [0.6, 0.6, blen] });
        items.push({ p: [b - lp / 2 - braceRun / 2, 0.22 + lp + rise / 2, sz * lay.frameZ], dir: [-Math.cos(ang), Math.sin(ang), 0], s: [0.6, 0.6, blen] });
      }
    }
    // spreaders between side frames under the slider bed (every ~1 m)
    const nS = Math.max(2, Math.round(L / 1.0));
    for (let i = 0; i <= nS; i++) {
      const x = 0.15 + (i * (L - 0.3)) / nS;
      items.push({ p: [x, lay.frameBottom + 0.012, 0], s: [0.5, 0.5, 2 * lay.frameZ - frameT] });
    }
    return items;
  }, [legXs, legTop, legLen, lay.frameZ, lay.frameBottom, lp, L, frameT]);

  const feetItems = useMemo(() => {
    const pads: InstanceXf[] = [];
    const studs: InstanceXf[] = [];
    const nuts: InstanceXf[] = [];
    for (const x of legXs)
      for (const sz of [-1, 1]) {
        pads.push({ p: [x, 0.008, sz * lay.frameZ] });
        studs.push({ p: [x, 0.04, sz * lay.frameZ] });
        nuts.push({ p: [x, footH - 0.006, sz * lay.frameZ] });
      }
    return { pads, studs, nuts };
  }, [legXs, lay.frameZ]);

  // guide rail segments & brackets
  const guideData = useMemo(() => {
    const segs: { side: number; a: number; b: number }[] = [];
    const brackets: { side: number; x: number }[] = [];
    if (!showGuides) return { segs, brackets };
    for (const side of [1, -1]) {
      const gaps = guideGaps
        .filter((g) => !g.side || g.side === 'both' || (g.side === 'front') === side > 0)
        .map((g) => [Math.min(g.from, g.to), Math.max(g.from, g.to)] as [number, number])
        .sort((p, q) => p[0] - q[0]);
      let start = -0.05;
      const end = L + 0.02;
      for (const [ga, gb] of gaps) {
        if (ga > start + 0.05) segs.push({ side, a: start, b: Math.min(ga, end) });
        start = Math.max(start, gb);
      }
      if (end > start + 0.05) segs.push({ side, a: start, b: end });
      for (const sgm of segs.filter((s) => s.side === side)) {
        const n = Math.max(1, Math.ceil((sgm.b - sgm.a) / 0.9));
        for (let i = 0; i <= n; i++) {
          const x = sgm.a + 0.06 + (i * (sgm.b - sgm.a - 0.12)) / n;
          brackets.push({ side, x });
        }
      }
    }
    return { segs, brackets };
  }, [showGuides, guideGaps, L]);

  const railY = height + 0.045;
  const railZ = gSpacing / 2 + 0.006;
  const railItems = useMemo<InstanceXf[]>(
    () => guideData.segs.map((s) => ({ p: [(s.a + s.b) / 2, railY, s.side * railZ], s: [s.b - s.a, 1, 1] })),
    [guideData, railY, railZ],
  );
  const bracketParts = useMemo(() => {
    const vRods: InstanceXf[] = [];
    const hRods: InstanceXf[] = [];
    const blocks: InstanceXf[] = [];
    const clamps: InstanceXf[] = [];
    const rodTop = railY + 0.012;
    const rodBase = lay.frameTop;
    const zRod = lay.frameZ;
    for (const b of guideData.brackets) {
      const s = b.side;
      blocks.push({ p: [b.x, rodBase + 0.01, s * zRod] });
      vRods.push({ p: [b.x, (rodBase + rodTop) / 2 + 0.01, s * zRod], s: [1, rodTop - rodBase, 1] });
      clamps.push({ p: [b.x, rodTop, s * zRod] });
      const hz0 = s * (railZ + 0.006);
      const hz1 = s * zRod;
      hRods.push({ p: [b.x, railY, (hz0 + hz1) / 2], r: [Math.PI / 2, 0, 0], s: [1, Math.abs(hz1 - hz0), 1] });
      clamps.push({ p: [b.x, railY, hz1] });
    }
    return { vRods, hRods, blocks, clamps };
  }, [guideData, railY, railZ, lay.frameTop, lay.frameZ]);

  // drive
  const driveZSign = driveSide === 'front' ? 1 : -1;
  const bearingZ = lay.frameOuterZ;
  const gmZ = bearingZ + 0.05;
  const getMotorAngle = useMemo(() => () => ((driveZSign > 0 ? 1 : -1) * getBeltPosition() * ratio) / rp, [getBeltPosition, driveZSign, rp]);
  // torque arm: horizontal toward the tail, pinned through a rubber buffer into a standoff on the side frame web
  const armDx = 0.2;
  const armDy = -0.03;
  const armLen = Math.hypot(armDx, armDy) - GEARMOTOR.armR0;
  const armAngle = driveZSign * Math.atan2(-armDx, -armDy);
  const armEnd = gearMotorTorqueArmEnd(armLen, armAngle);
  const armWorldX = L + (driveZSign > 0 ? armEnd[0] : -armEnd[0]);
  const armWorldY = yc + armEnd[1];
  const armPlaneZ = gmZ + GEARMOTOR.armZ; // |z| of the arm plane
  const standoff = armPlaneZ - 0.012 - lay.frameOuterZ;


  const guardY0 = lay.frameBottom - 0.13;

  return (
    <group position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
      {/* belt */}
      <mesh geometry={beltGeo(L, W)} material={beltMat} position={[0, yc, 0]} castShadow receiveShadow />
      {/* slider bed */}
      <mesh geometry={box(L - 0.12, 0.003, W - 0.01)} material={fm.zinc()} position={[L / 2, height - bt - 0.0016, 0]} receiveShadow />
      {/* side frames + end caps */}
      {[-1, 1].map((sz) => (
        <group key={sz}>
          <mesh
            geometry={sideGeo}
            material={frameMat}
            position={[(x0 + x1) / 2, frameCY, sz * lay.frameZ]}
            rotation={frameStyle === 'extrusion' ? [0, Math.PI / 2, 0] : [0, sz > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
            scale={[1, 1, frameLen]}
            castShadow
            receiveShadow
          />
          {frameStyle === 'extrusion' &&
            [x0 - 0.0025, x1 + 0.0025].map((x, i) => (
              <mesh key={i} geometry={rbox(0.005, frameH + 0.002, frameT + 0.002, 0.0015, 2)} material={fm.plastic('#1b1c1f', 0.6)} position={[x, frameCY, sz * lay.frameZ]} />
            ))}
        </group>
      ))}
      {/* pulleys (rotating drums with shafts) */}
      {[
        { ref: headPulley, x: L },
        { ref: tailPulley, x: 0 },
      ].map(({ ref, x }, i) => (
        <group key={i} ref={ref} position={[x, yc, 0]} userData={{ noMerge: true }}>
          <mesh geometry={cylZ(rp, W + 0.012, 40)} material={i === 0 ? fm.rubber('#2a2b2d') : fm.zinc()} castShadow />
          <mesh geometry={cylZ(0.0175, 2 * lay.frameOuterZ + 0.08, 20)} material={fm.steel()} />
        </group>
      ))}
      {/* flange bearings on both frames at both pulleys */}
      {[0, L].map((x) =>
        [-1, 1].map((sz) => <FlangeBearing key={`${x}:${sz}`} position={[x, yc, sz * bearingZ]} flip={sz < 0} />),
      )}
      {/* tail take-ups */}
      {[-1, 1].map((sz) => (
        <group key={sz} position={[0.06, yc, sz * (bearingZ + 0.004)]}>
          <mesh geometry={box(0.09, 0.02, 0.008)} material={fm.zinc()} position={[0, -0.05, 0]} />
          <mesh geometry={cylZ(0.006, 0.12, 12)} material={fm.zinc()} position={[0.02, -0.05, 0.012 * sz]} rotation={[0, Math.PI / 2, 0]} />
          <mesh geometry={box(0.012, 0.012, 0.012)} material={fm.zinc()} position={[0.085, -0.05, 0.012 * sz]} />
        </group>
      ))}
      {/* return rollers (instanced, rotating) */}
      <instancedMesh ref={rollersRef} args={[cylZ(rr, W + 0.02, 24), fm.zinc(), rollerXs.length]} castShadow frustumCulled={false} />
      <StaticInstances geometry={cylZ(0.008, 2 * lay.frameZ, 10)} material={fm.steel()} items={rollerXs.map((x) => ({ p: [x, rollerY, 0] }))} />

      {/* stand */}
      {legs && (
        <>
          <StaticInstances geometry={legGeo} material={frameMat} items={profileItems} />
          <StaticInstances geometry={cylY0(0.04, 0.012)} material={fm.rubber('#202020')} items={feetItems.pads} />
          <StaticInstances geometry={cylY0(0.008, 0.07)} material={fm.zinc()} items={feetItems.studs} />
          <StaticInstances geometry={hexY(0.024, 0.012)} material={fm.zinc()} items={feetItems.nuts} />
        </>
      )}

      {/* guide rails on rod brackets */}
      {showGuides && (
        <>
          <StaticInstances geometry={rbox(1, 0.032, 0.012, 0.003, 1)} material={fm.plastic('#e9eae4', 0.45)} items={railItems} />
          <StaticInstances geometry={cylY0(0.006, 1)} material={fm.stainless(0.25)} items={bracketParts.vRods} />
          <StaticInstances geometry={cylY0(0.006, 1)} material={fm.stainless(0.25)} items={bracketParts.hRods} />
          <StaticInstances geometry={rbox(0.03, 0.02, 0.03, 0.003, 1)} material={fm.plastic('#26282c', 0.5)} items={bracketParts.blocks} />
          <StaticInstances geometry={rbox(0.022, 0.022, 0.022, 0.004, 1)} material={fm.plastic('#26282c', 0.5)} items={bracketParts.clamps} />
        </>
      )}

      {/* yellow wire-mesh end guards below the belt at both pulleys */}
      {guards &&
        [
          { x: L, dir: 1 },
          { x: 0, dir: -1 },
        ].map(({ x, dir }) => (
          <group key={x}>
            <MeshPanel w={2 * lay.frameOuterZ} h={yc - 0.012 - guardY0} position={[x + dir * 0.13, (yc - 0.012 + guardY0) / 2, 0]} rotation={[0, Math.PI / 2, 0]} />
            <MeshPanel w={0.3} h={2 * lay.frameOuterZ} position={[x + dir * (0.13 - 0.15), guardY0, 0]} rotation={[-Math.PI / 2, 0, 0]} />
            {[-1, 1].map((sz) => (
              <MeshPanel key={sz} w={0.3} h={lay.frameBottom - guardY0} position={[x + dir * (0.13 - 0.15), (lay.frameBottom + guardY0) / 2, sz * lay.frameOuterZ]} />
            ))}
          </group>
        ))}
      {/* yellow shaft-end caps on the non-drive side / tail */}
      {[
        [L, driveSide === 'none' ? [-1, 1] : [-driveZSign]],
        [0, [-1, 1]],
      ].map(([x, sides]) =>
        (sides as number[]).map((sz) => (
          <mesh key={`${x}:${sz}`} geometry={cylZ(0.028, 0.04, 24)} material={fm.sheet('#f1c40f', 0.45)} position={[x as number, yc, sz * (bearingZ + 0.052)]} castShadow />
        )),
      )}
      {/* torque-arm standoff bracket on the side frame (drive side) */}
      {driveSide !== 'none' && (
        <group position={[armWorldX, armWorldY, driveZSign * lay.frameOuterZ]} rotation={driveZSign > 0 ? undefined : [0, Math.PI, 0]}>
          <mesh geometry={rbox(0.085, 0.07, 0.006, 0.004, 2)} material={fm.sheet('#2e3134', 0.5)} position={[0, 0, 0.003]} castShadow />
          <mesh geometry={rbox(0.045, 0.045, standoff - 0.006, 0.004, 2)} material={fm.sheet('#2e3134', 0.5)} position={[0, 0, 0.006 + (standoff - 0.006) / 2]} castShadow />
          {[-0.031, 0.031].map((dx) => (
            <HexBolt key={dx} d={0.008} position={[dx, 0, 0.006]} />
          ))}
        </group>
      )}
      </Merge>
      {/* drive */}
      {driveSide !== 'none' && (
        <group position={[L, yc, driveZSign * gmZ]} rotation={driveZSign > 0 ? undefined : [0, Math.PI, 0]}>
          <GearMotor ratio={ratio} hand={driveZSign > 0 ? 'left' : 'right'} color={motorColor} getMotorAngle={getMotorAngle} torqueArm={armLen} torqueArmAngle={armAngle} cableTo={motorCableTo} nestedIn />
        </group>
      )}
      {/* frame ID plate */}
      <mesh
        position={[L - 0.6, frameCY, lay.frameOuterZ + 0.0015]}
        material={fm.plate(
          canvasTex('convPlate', 256, 96, (ctx, w, h) => {
            ctx.fillStyle = '#e8e9e4';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 4;
            ctx.strokeRect(3, 3, w - 6, h - 6);
            ctx.fillStyle = '#16181b';
            ctx.font = '800 34px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('CV-101', w / 2, 34);
            ctx.font = '600 18px Arial, sans-serif';
            ctx.fillText('0.5 m/s  ·  1 HP  ·  460 V', w / 2, 70);
          }),
        )}
      >
        <planeGeometry args={[0.12, 0.04]} />
      </mesh>
      {[-0.055, 0.055].map((dx) => (
        <CapScrew key={dx} d={0.004} position={[L - 0.6 + dx, frameCY, lay.frameOuterZ + 0.0015]} />
      ))}
    </group>
  );
}

function cylY0(r: number, h: number) {
  return geo(`cylY0:${r}:${h}`, () => new THREE.CylinderGeometry(r, r, h, 16));
}

function hexY(af: number, t: number) {
  return geo(`hexY:${af}:${t}`, () => {
    const g = new THREE.CylinderGeometry(af / Math.sqrt(3), af / Math.sqrt(3), t, 6);
    return g.toNonIndexed();
  });
}

