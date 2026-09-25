/**
 * Machine parts of the `conveyor-sort` twin, all driven from ConveyorSortState:
 * gravity box feeder (magazine with the NEXT boxes of the seeded sequence, escapement gate), photo-eyes with
 * reflectors and live beams, the pneumatic pusher (ISO cylinder, reed switches, 5/2 valve, FRL, air lines),
 * the reject chute + tote, the gravity-roller good lane and the finished-goods pallet.
 *
 * Coordinates: this module's components live in the MACHINE frame = world translated by (X0, 0, 0), i.e.
 * x = metres along the belt from the tail pulley, y = height above the floor, z = across (+Z = operator side,
 * where the reject chute is; the pusher sits on the −Z side).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  boxGeometry,
  boxMaterial,
  BOX_SIZES,
  conveyorLayout,
  FieldJunctionBox,
  fieldJunctionBoxGlands,
  PhotoEye42EF,
  PneumaticCylinder,
  PushButtonStation,
  pushButtonStationHoles,
  pushButtonStationLayout,
  SelectorSwitch800F,
  SolenoidValve,
  StackLight856T,
  type BoxState,
} from '../../../twin/devices';
import type { Vec3 } from '../../../twin/contracts';
import { nextRandom, type RngState } from '../../testing/sceneKit';
import type { SimRuntime } from '../../types';
import { Glow, playSfx } from './kit';
import { CONVEYOR_GEOMETRY as G, type ConveyorSortState } from './logic';
import { Instances, paint, steel, unitBox, unitCylY, type CableSpec } from './hall';

export const BELT_H = 0.85;
export const LAY = conveyorLayout(G.beltWidth, BELT_H);
/** Photo-eye lens standoff from the belt centre (sensor on −Z = junction-box side, reflector on +Z). */
export const EYE_Z = LAY.frameZ - 0.03;
/** Overhead cable tray (world y / z) and the spur that ends above the feeder (z). */
export const TRAY = { y: 2.65, z: -1.75, feederSpurZ: -0.62 } as const;

/** Pusher paddle: face position across the belt for an extension 0..1 (visual stroke 0.82 m). */
export const PADDLE = { z0: -0.29, stroke: 0.82, bottom: 0.075, height: 0.12, width: G.paddleWidth } as const;
export const paddleFace = (e: number) => PADDLE.z0 + PADDLE.stroke * e;
/** Reject chute: starts at the frame edge at belt height, slopes down toward +Z. */
export const CHUTE = { theta: 0.3, len: 0.98, z0: LAY.frameOuterZ, x0: G.pusherX - 0.25, x1: G.pusherX + 0.25 } as const;
const CHUTE_END_Z = CHUTE.z0 + CHUTE.len * Math.cos(CHUTE.theta);
const CHUTE_END_Y = BELT_H - CHUTE.len * Math.sin(CHUTE.theta);
/** Reject tote (blue euro crate) at the chute end. */
export const TOTE = { x: G.pusherX, z: CHUTE_END_Z + 0.26, w: 0.8, d: 0.6, h: 0.42 } as const;
/** Gravity roller good lane. */
export const RUNOUT = { x0: G.beltLength + 0.03, x1: G.beltLength + G.runoutLength + 0.2, top: BELT_H - 0.012 } as const;
/** Finished-goods pallet position (machine frame). */
export const PALLET = { x: G.beltLength + G.runoutLength + 1.05, z: 0.05 } as const;

const boxWidth = (tall: boolean) => (tall ? BOX_SIZES.tall.width : BOX_SIZES.short.width);

// ---------------------------------------------------------------------------
// Box display mapping (logic state → instanced cardboard boxes)
// ---------------------------------------------------------------------------

export function makeBoxPool(n = 48): BoxState[] {
  return Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, tall: false, id: 0, visible: false }));
}

/** Fill `pool` with display poses for the boxes in `s` (coordinates relative to the belt surface at the tail). */
export function mapBoxes(s: ConveyorSortState, pool: BoxState[]): BoxState[] {
  const face = paddleFace(s.pusherPosition);
  let n = 0;
  for (const b of s.boxes) {
    if (n >= pool.length) break;
    const d = pool[n++]!;
    const w2 = boxWidth(b.tall) / 2;
    d.tall = b.tall;
    d.id = b.id;
    d.visible = true;
    d.x = b.x;
    d.y = 0;
    d.z = 0;
    d.rotX = 0;
    d.rotZ = 0;
    d.rotY = ((b.id * 37) % 9) * 0.0035 - 0.014 + b.variant * 0.002;
    switch (b.state) {
      case 'belt':
        d.y = b.h;
        if (Math.abs(b.x - G.pusherX) <= G.divertWindow) d.z = Math.max(0, face + w2);
        if (b.blocked) {
          d.rotY += 0.12;
          d.z = Math.max(d.z, 0.02);
        }
        break;
      case 'diverted': {
        const pushed = face + w2;
        d.z = s.pusherValve ? Math.max(0, pushed) : Math.max(pushed, b.lateral);
        break;
      }
      case 'chute': {
        const sl = b.slide;
        const surfEnd = (CHUTE_END_Z - 0.45) / Math.cos(CHUTE.theta);
        if (sl <= surfEnd) {
          const zc = 0.45 + sl * Math.cos(CHUTE.theta);
          d.z = zc;
          d.y = -(zc - CHUTE.z0) * Math.tan(CHUTE.theta);
          d.rotX = CHUTE.theta;
        } else {
          // tipping over the chute lip into the tote
          const u = Math.min(1, (sl - surfEnd) / Math.max(0.05, G.chuteLength - surfEnd));
          const zc = CHUTE_END_Z + 0.02 + u * 0.22;
          d.z = zc;
          const lipY = CHUTE_END_Y - BELT_H;
          d.y = lipY - u * u * (lipY - (0.1 - BELT_H) - 0.05);
          d.rotX = CHUTE.theta + u * 1.25;
        }
        break;
      }
      case 'good':
        d.y = RUNOUT.top - BELT_H;
        break;
    }
  }
  for (let i = n; i < pool.length; i++) pool[i]!.visible = false;
  return pool;
}

// ---------------------------------------------------------------------------
// Upcoming boxes (peek at the seeded sequence without touching the state)
// ---------------------------------------------------------------------------

const peekRng: RngState = { seed: 0 };
/** Writes whether each of the next `out.length` boxes will be tall. */
export function peekNextBoxes(s: ConveyorSortState, out: boolean[]): boolean[] {
  peekRng.seed = s.rng.seed;
  let alt = s.alternateNextTall;
  for (let i = 0; i < out.length; i++) {
    switch (s.controls.box_pattern) {
      case 1:
        out[i] = false;
        break;
      case 2:
        out[i] = true;
        break;
      case 3:
        out[i] = alt;
        alt = !alt;
        break;
      default:
        out[i] = nextRandom(peekRng) < G.tallProbability;
    }
    nextRandom(peekRng); // variant
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gravity feeder
// ---------------------------------------------------------------------------

const MAG = { ix: 0.17, iz: 0.15, top: 1.12, legX: 0.3, legZ: 0.47, frameTop: 2.25 } as const;
/** Feeder gate valve (2-station 5/2 manifold) on the front-right leg, feeder-local coordinates. */
const GATE_VALVE: Vec3 = [MAG.legX, 1.36, MAG.legZ + 0.03];
/** A/B working-port fittings of manifold station `k` (feeder-local; the valve faces +Z, unrotated). */
function gateValvePort(k: number, port: 'a' | 'b'): Vec3 {
  const pitch = 0.016;
  const baseH = 0.024;
  const x0 = -pitch + pitch / 2;
  return [GATE_VALVE[0] + x0 + k * pitch, GATE_VALVE[1] + 0.012 - 0.004, GATE_VALVE[2] + baseH * (port === 'a' ? 0.3 : 0.72)];
}
/** Instructor box (feeder front-left leg), feeder-local. */
export const INSTRUCTOR_BOX: Vec3 = [-MAG.legX, 1.12, MAG.legZ + 0.025];
const INSTR_HOLES = pushButtonStationHoles(2);
/** Selector centre of instructor-box hole `i` (feeder-local). */
export const instructorHole = (i: number): Vec3 => [INSTRUCTOR_BOX[0] + INSTR_HOLES[i]![0], INSTRUCTOR_BOX[1] + INSTR_HOLES[i]![1], INSTRUCTOR_BOX[2] + INSTR_HOLES[i]![2]];
/** Feeder gate valve position (machine frame) for hotspots. */
export const FEEDER_VALVE: Vec3 = [G.feederX + GATE_VALVE[0], GATE_VALVE[1] + 0.06, GATE_VALVE[2] + 0.03];

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
/** Point `p` (parent coordinates) expressed in the frame of a child at `origin` with euler `rot`. */
function toLocal(p: Vec3, origin: Vec3, rot: Vec3): Vec3 {
  _m4.compose(new THREE.Vector3(...origin), _q.setFromEuler(_e.set(...rot)), new THREE.Vector3(1, 1, 1)).invert();
  return new THREE.Vector3(...p).applyMatrix4(_m4).toArray() as Vec3;
}

export function Feeder({ state, runtime }: { state: ConveyorSortState; runtime: SimRuntime }) {
  const x = G.feederX;
  const gateY = BELT_H + G.dropHeight;
  const flapL = useRef<THREE.Group>(null);
  const flapR = useRef<THREE.Group>(null);
  const stack = useRef<THREE.Group>(null);
  const boxes = useRef<(THREE.Mesh | null)[]>([]);
  const next = useMemo(() => [false, false, false], []);
  const lastFed = useRef(state.boxesFed);
  const droppedH = useRef(0.2);
  const gateOpen = useRef(0);

  useFrame((_, dt) => {
    const s = state;
    if (s.boxesFed !== lastFed.current) {
      lastFed.current = s.boxesFed;
      const nb = s.boxes.length ? s.boxes[s.boxes.length - 1] : undefined;
      droppedH.current = nb?.tall ? BOX_SIZES.tall.height : BOX_SIZES.short.height;
    }
    const since = s.sinceDropMs / 1000;
    // gate flaps: snap open at the drop, close after 0.3 s
    const target = since < 0.3 ? 1 : 0;
    gateOpen.current = THREE.MathUtils.damp(gateOpen.current, target, target ? 30 : 12, Math.min(dt, 0.05));
    const a = gateOpen.current * 1.35;
    if (flapL.current) flapL.current.rotation.z = -a;
    if (flapR.current) flapR.current.rotation.z = a;
    // stack: held up by the escapement while the gate is open, then drops by the height of the released box
    let off = 0;
    if (since < 0.3) off = droppedH.current;
    else if (since < 0.55) {
      const u = (since - 0.3) / 0.25;
      off = droppedH.current * (1 - u * u);
    }
    if (stack.current) stack.current.position.y = off;
    peekNextBoxes(s, next);
    let y = 0;
    for (let i = 0; i < next.length; i++) {
      const m = boxes.current[i];
      if (!m) continue;
      const kind = next[i] ? 'tall' : 'short';
      m.geometry = boxGeometry(kind);
      m.material = boxMaterial(kind);
      m.position.y = y;
      y += BOX_SIZES[kind].height + 0.002;
      m.visible = y < MAG.top - G.dropHeight + 0.1;
    }
  });

  const alu = steel('#c3c8cc', 0.42);
  const legH = MAG.frameTop;
  const guideH = MAG.top - G.dropHeight;
  // gate cylinders (magazine-group coordinates, the group sits at gateY)
  const cylPos = (sx: number): Vec3 => [sx * (MAG.ix + 0.06), 0.1, MAG.iz + 0.07];
  const CYL_ROT: Vec3 = [Math.PI / 2, 0, 0];
  const gateTubes = (sx: number, k: number) => {
    const inGroup = (p: Vec3): Vec3 => [p[0], p[1] - gateY, p[2]];
    return {
      rear: toLocal(inGroup(gateValvePort(k, 'a')), cylPos(sx), CYL_ROT),
      front: toLocal(inGroup(gateValvePort(k, 'b')), cylPos(sx), CYL_ROT),
    };
  };
  // valve multicore + air supply: up the front-right leg, along the top rail to the back, up into the tray spur
  const up = (dz: number): Vec3[] => [
    [MAG.legX + 0.035, GATE_VALVE[1] + 0.2, MAG.legZ + dz],
    [MAG.legX + 0.035, legH - 0.08, MAG.legZ + dz],
    [MAG.legX + 0.03, legH + 0.03, MAG.legZ - 0.1],
    [MAG.legX + 0.03, legH + 0.035, -MAG.legZ + 0.05],
  ];
  return (
    <group position={[x, 0, 0]}>
      {/* portal frame: 4 legs outside the conveyor, top rails */}
      <Instances
        geometry={unitBox}
        material={alu}
        items={[
          ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [sx * MAG.legX, legH / 2, sz * MAG.legZ] as Vec3, s: [0.045, legH, 0.045] as Vec3 }))),
          ...[-1, 1].map((sx) => ({ p: [sx * MAG.legX, legH - 0.0225, 0] as Vec3, s: [0.045, 0.045, 2 * MAG.legZ + 0.045] as Vec3 })),
          ...[-1, 1].map((sz) => ({ p: [0, legH - 0.0225, sz * MAG.legZ] as Vec3, s: [2 * MAG.legX - 0.045, 0.045, 0.045] as Vec3 })),
          ...[-1, 1].map((sx) => ({ p: [sx * MAG.legX, 0.25, 0] as Vec3, s: [0.045, 0.045, 2 * MAG.legZ - 0.045] as Vec3 })),
          // cross members carrying the magazine at gate level and at the top
          ...[gateY - 0.03, BELT_H + MAG.top].flatMap((yy) => [-1, 1].map((sz) => ({ p: [0, yy, sz * (MAG.iz + 0.03)] as Vec3, s: [2 * MAG.legX - 0.045, 0.03, 0.03] as Vec3 }))),
          ...[gateY - 0.03, BELT_H + MAG.top].flatMap((yy) => [-1, 1].map((sz) => ({ p: [0, yy, sz * ((MAG.iz + 0.03 + MAG.legZ) / 2)] as Vec3, s: [0.03, 0.03, MAG.legZ - MAG.iz - 0.03] as Vec3 }))),
          // valve mounting plate on the front-right leg
          { p: [GATE_VALVE[0], GATE_VALVE[1] + 0.05, MAG.legZ + 0.0255], s: [0.09, 0.14, 0.006] },
        ]}
      />
      {/* feet */}
      <Instances
        geometry={unitBox}
        material={paint('#2a2c2f', 0.6)}
        items={[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [sx * MAG.legX, 0.006, sz * MAG.legZ] as Vec3, s: [0.1, 0.012, 0.1] as Vec3 })))}
      />
      {/* magazine corner guides (stainless angles) */}
      <group position={[0, gateY, 0]}>
        <Instances
          geometry={unitBox}
          material={steel('#d3d7da', 0.3)}
          items={[-1, 1].flatMap((sx) =>
            [-1, 1].flatMap((sz) => [
              { p: [sx * (MAG.ix + 0.004), guideH / 2, sz * (MAG.iz - 0.02)] as Vec3, s: [0.004, guideH, 0.05] as Vec3 },
              { p: [sx * (MAG.ix - 0.02), guideH / 2, sz * (MAG.iz + 0.004)] as Vec3, s: [0.05, guideH, 0.004] as Vec3 },
            ]),
          )}
        />
        {/* clear polycarbonate side windows */}
        {[-1, 1].map((sz) => (
          <mesh key={sz} position={[0, guideH / 2 + 0.02, sz * (MAG.iz + 0.012)]} userData={{ noOcclude: true }}>
            <boxGeometry args={[2 * MAG.ix - 0.04, guideH - 0.06, 0.006]} />
            <meshPhysicalMaterial color="#dbe8f0" roughness={0.08} transparent opacity={0.16} depthWrite={false} />
          </mesh>
        ))}
        {/* escapement gate flaps (hinged at the sides) */}
        <group ref={flapL} position={[-MAG.ix, -0.006, 0]}>
          <mesh material={steel('#b9bfc4', 0.35)} position={[0.085, 0, 0]} castShadow>
            <boxGeometry args={[0.17, 0.008, 2 * MAG.iz - 0.01]} />
          </mesh>
        </group>
        <group ref={flapR} position={[MAG.ix, -0.006, 0]}>
          <mesh material={steel('#b9bfc4', 0.35)} position={[-0.085, 0, 0]} castShadow>
            <boxGeometry args={[0.17, 0.008, 2 * MAG.iz - 0.01]} />
          </mesh>
        </group>
        {/* hinge shafts + short-stroke gate cylinders on the +Z side, piped to the gate valve */}
        {[-1, 1].map((sx, k) => (
          <group key={sx}>
            <mesh geometry={unitCylY} material={steel()} position={[sx * MAG.ix, -0.006, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.006, 2 * MAG.iz + 0.08, 0.006]} />
            <PneumaticCylinder
              position={cylPos(sx)}
              rotation={CYL_ROT}
              bore={0.032}
              stroke={0.04}
              getExtension={() => (state.sinceDropMs < 300 ? 1 : 0)}
              tubes={gateTubes(sx, k)}
            />
          </group>
        ))}
        {/* upcoming boxes */}
        <group ref={stack}>
          {[0, 1, 2].map((i) => (
            <mesh
              key={i}
              ref={(m) => {
                boxes.current[i] = m;
              }}
              geometry={boxGeometry('short')}
              material={boxMaterial('short')}
              castShadow
              receiveShadow
              userData={{ noMerge: true }}
            />
          ))}
        </group>
      </group>
      {/* YV-102 gate valve: Feeder_Release (only used in PLC feeder mode) */}
      <SolenoidValve
        variant="pneumatic"
        position={GATE_VALVE}
        stations={2}
        getEnergized={() => state.feederRelease}
        getStation={() => state.feederRelease}
        portsTo={false}
        cableTo={{ via: up(0.03), to: [MAG.legX + 0.03, TRAY.y - 0.05, TRAY.feederSpurZ] }}
        tubeTo={{ via: up(0.05), to: [MAG.legX + 0.05, TRAY.y - 0.05, TRAY.feederSpurZ] }}
      />
      {/* instructor box on the front-left leg: feeder mode + box pattern (instructor controls, NOT PLC inputs) */}
      <PushButtonStation holes={2} position={INSTRUCTOR_BOX} gland={false}>
        <SelectorSwitch800F
          positions={['AUTO', 'PLC']}
          legend="FEEDER MODE"
          getPosition={() => Number(runtime.getControl('feeder_mode'))}
          onChange={(i) => {
            runtime.setControl('feeder_mode', i);
            playSfx('toggle');
          }}
        />
        <SelectorSwitch800F
          positions={['RND', 'SHORT', 'TALL', 'ALT']}
          legend="BOX PATTERN"
          getPosition={() => Number(runtime.getControl('box_pattern'))}
          onChange={(i) => {
            runtime.setControl('box_pattern', i);
            playSfx('toggle');
          }}
        />
      </PushButtonStation>
      <mesh position={[INSTRUCTOR_BOX[0], INSTRUCTOR_BOX[1] + pushButtonStationLayout(2).height + 0.032, INSTRUCTOR_BOX[2] + 0.002]} userData={{ noOcclude: true }}>
        <planeGeometry args={[0.1, 0.045]} />
        <meshStandardMaterial map={instructorPlate()} roughness={0.5} />
      </mesh>
      {/* feeder nameplate */}
      <mesh position={[0, BELT_H + MAG.top + 0.09, MAG.iz + 0.04]} userData={{ noOcclude: true }}>
        <planeGeometry args={[0.3, 0.08]} />
        <meshStandardMaterial map={feederPlate()} roughness={0.5} />
      </mesh>
    </group>
  );
}

let instructorTex: THREE.CanvasTexture | null = null;
function instructorPlate() {
  if (instructorTex) return instructorTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 116;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f5c400';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 30px Arial';
  ctx.fillText('INSTRUCTOR', 128, 34);
  ctx.font = '700 21px Arial';
  ctx.fillText('not wired to the PLC', 128, 78);
  instructorTex = new THREE.CanvasTexture(c);
  instructorTex.colorSpace = THREE.SRGBColorSpace;
  return instructorTex;
}

let feederPlateTex: THREE.CanvasTexture | null = null;
function feederPlate() {
  if (feederPlateTex) return feederPlateTex;
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 104;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1d4f91';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.font = '800 40px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BOX FEEDER', c.width / 2, 38);
  ctx.font = '600 22px Arial';
  ctx.fillText('FD-101 · GRAVITY MAGAZINE', c.width / 2, 78);
  feederPlateTex = new THREE.CanvasTexture(c);
  feederPlateTex.colorSpace = THREE.SRGBColorSpace;
  return feederPlateTex;
}

// ---------------------------------------------------------------------------
// Photo-eyes (sensors on the −Z / junction-box side, reflectors on the operator side)
// ---------------------------------------------------------------------------

type SensorKey = 'infeed' | 'tall' | 'divert' | 'exit';

/** Distance from a −Z sensor lens to the near face of the box blocking the beam at `x`. */
function blockDistance(s: ConveyorSortState, x: number): number {
  for (const b of s.boxes) {
    if (Math.abs(b.x - x) < G.boxLength / 2 && (b.state === 'belt' || b.state === 'diverted')) {
      const lat = b.state === 'diverted' ? Math.min(b.lateral, 0.4) : 0;
      return Math.max(0.01, EYE_Z + lat - boxWidth(b.tall) / 2);
    }
  }
  return EYE_Z;
}

/** Straight-across photo-eye: sensor on the −Z side looking at a reflector on the operator (+Z) side. */
export function AcrossEye({ state, x, beamY, sensor }: { state: ConveyorSortState; x: number; beamY: number; sensor: SensorKey }) {
  const get = () => state.sensors[sensor];
  const out = sensor === 'infeed' ? () => state.sensors.infeedOutput : get;
  return (
    <PhotoEye42EF
      position={[x, BELT_H + beamY, -EYE_Z]}
      getBlocked={get}
      getOutput={out}
      getBlockDistance={() => blockDistance(state, x)}
      beamLength={2 * EYE_Z}
      postLength={BELT_H + beamY - LAY.frameTop - 0.006}
    />
  );
}

/** PE_Divert: diagonal beam through the divert point (the pusher and the chute occupy both sides at x = 4.0). */
export const DIVERT_EYE = (() => {
  const from: Vec3 = [G.peDivertX - 0.3, BELT_H + 0.05, -EYE_Z];
  const to: Vec3 = [G.peDivertX + 0.3, BELT_H + 0.05, EYE_Z];
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  return { from, to, len: Math.hypot(dx, dz), rotY: Math.atan2(dx, dz) };
})();

export function DivertEye({ state }: { state: ConveyorSortState }) {
  const get = () => state.sensors.divert;
  return (
    <PhotoEye42EF
      position={DIVERT_EYE.from}
      rotation={[0, DIVERT_EYE.rotY, 0]}
      getBlocked={get}
      getOutput={get}
      getBlockDistance={() => DIVERT_EYE.len * 0.42}
      beamLength={DIVERT_EYE.len}
      postLength={0.05 - (LAY.frameTop - BELT_H) - 0.006}
    />
  );
}

// ---------------------------------------------------------------------------
// Pusher assembly (−Z side)
// ---------------------------------------------------------------------------

const CYL_BORE = 0.05;
/** Plate face offset from the cylinder origin when retracted (rod WH + MF1 flange + plate). */
const PLATE_OFFSET = 0.07;
export const CYL = {
  y: BELT_H + PADDLE.bottom + PADDLE.height / 2,
  z: PADDLE.z0 - PLATE_OFFSET,
  rearZ: PADDLE.z0 - PLATE_OFFSET - 0.93,
} as const;
/** 5/2 valve manifold on the rear support (machine frame). */
export const VALVE_POS: Vec3 = [G.pusherX + 0.13, 0.55, CYL.rearZ + 0.08];
/** Filter-regulator next to the valve (machine frame). */
export const FRL_POS: Vec3 = [G.pusherX + 0.31, VALVE_POS[1] + 0.02, VALVE_POS[2] + 0.02];
/** Compressed-air drop (ball valve outlet) on the fence post behind the pusher (machine frame). */
export const AIR_DROP: Vec3 = [3.6, 1.05, -1.41];
/** A/B port fitting of manifold station 1 (machine frame). */
function valvePort(port: 'a' | 'b'): Vec3 {
  return [VALVE_POS[0] - 0.008, VALVE_POS[1] + 0.008, VALVE_POS[2] + 0.024 * (port === 'a' ? 0.3 : 0.72)];
}

export function Pusher({ state }: { state: ConveyorSortState }) {
  const ext = () => state.pusherPosition;
  const alu = steel('#c3c8cc', 0.42);
  // tube ends at the valve A/B fittings (cylinder coordinates)
  const toCyl = (p: Vec3): Vec3 => [p[0] - G.pusherX, p[1] - CYL.y, p[2] - CYL.z];
  const rear = toCyl(valvePort('a'));
  const front = toCyl(valvePort('b'));
  // D-sub multicore: up the rear stand, tied along under the cylinder to the front bracket, down the bracket and
  // along the frame to JB-201
  const underCyl = CYL.y - 0.05;
  const dsub: Vec3[] = [
    [G.pusherX + 0.02, VALVE_POS[1] + 0.03, CYL.rearZ + 0.085],
    [G.pusherX + 0.025, underCyl - 0.03, CYL.rearZ + 0.1],
    [G.pusherX + 0.03, underCyl - 0.005, CYL.rearZ + 0.3],
    [G.pusherX + 0.03, underCyl - 0.005, CYL.z - 0.15],
    [G.pusherX + 0.12, underCyl - 0.02, CYL.z - 0.03],
    [G.pusherX + 0.13, LAY.frameBottom + 0.02, -LAY.frameOuterZ - 0.012],
    [G.pusherX + 0.2, LAY.frameBottom - 0.012, -LAY.frameOuterZ - 0.012],
    ...jbRun(G.pusherX + 0.2, 3),
  ];
  return (
    <group>
      <PneumaticCylinder
        position={[G.pusherX, CYL.y, CYL.z]}
        bore={CYL_BORE}
        stroke={PADDLE.stroke}
        getExtension={ext}
        getRetractedSensor={() => state.sensors.pusherRetracted}
        getExtendedSensor={() => state.sensors.pusherExtended}
        pusher={[PADDLE.width, PADDLE.height]}
        tubes={{ rear, front }}
      />
      {/* front bracket bolted to the conveyor side frame, rear support stand, valve plate */}
      <Instances
        geometry={unitBox}
        material={alu}
        items={[
          { p: [G.pusherX, CYL.y - 0.05, CYL.z - 0.03], s: [0.22, 0.012, 0.09] },
          { p: [G.pusherX, (CYL.y - 0.05 + LAY.frameBottom) / 2, CYL.z + 0.012], s: [0.22, CYL.y - 0.05 - LAY.frameBottom, 0.012] },
          { p: [G.pusherX, (CYL.y - 0.06) / 2, CYL.rearZ + 0.05], s: [0.045, CYL.y - 0.06, 0.045] },
          { p: [G.pusherX, CYL.y - 0.055, CYL.rearZ + 0.05], s: [0.12, 0.012, 0.08] },
          { p: [G.pusherX, 0.006, CYL.rearZ + 0.05], s: [0.16, 0.012, 0.16] },
          { p: [G.pusherX + 0.14, VALVE_POS[1] + 0.06, CYL.rearZ + 0.075], s: [0.34, 0.2, 0.006] },
        ]}
      />
      {/* YV-101 5/2 single-solenoid valve (station 1 live) on its manifold */}
      <SolenoidValve
        variant="pneumatic"
        position={VALVE_POS}
        getEnergized={() => state.pusherValve}
        stations={2}
        portsTo={false}
        cableTo={{ via: dsub.slice(0, -1), to: dsub[dsub.length - 1]! }}
        tubeTo={{ via: [[FRL_POS[0] - 0.05, VALVE_POS[1] + 0.065, VALVE_POS[2] + 0.03]], to: [FRL_POS[0] - 0.026, FRL_POS[1] + 0.07, FRL_POS[2]] }}
      />
      <FrlUnit position={FRL_POS} />
      {/* air drop on the fence post: galvanized pipe from the header + ball valve */}
      <mesh geometry={unitCylY} material={steel('#aab1b6', 0.45)} position={[AIR_DROP[0], (AIR_DROP[1] + 3.3) / 2, AIR_DROP[2]]} scale={[0.011, 3.3 - AIR_DROP[1], 0.011]} castShadow />
      <mesh material={paint('#c62828', 0.45)} position={[AIR_DROP[0] + 0.03, AIR_DROP[1] + 0.03, AIR_DROP[2]]}>
        <boxGeometry args={[0.06, 0.01, 0.018]} />
      </mesh>
      <mesh material={steel('#b8a36a', 0.35)} position={[AIR_DROP[0], AIR_DROP[1] + 0.02, AIR_DROP[2]]}>
        <boxGeometry args={[0.03, 0.04, 0.03]} />
      </mesh>
    </group>
  );
}

/** Air hose from the drop's ball valve to the FRL inlet (machine frame, for <Cables>). */
export function pusherAirHose(): CableSpec {
  return {
    points: [
      [AIR_DROP[0], AIR_DROP[1] - 0.02, AIR_DROP[2]],
      [AIR_DROP[0] + 0.02, AIR_DROP[1] - 0.2, AIR_DROP[2] + 0.02],
      [(AIR_DROP[0] + FRL_POS[0]) / 2, 0.42, (AIR_DROP[2] + FRL_POS[2]) / 2],
      [FRL_POS[0] + 0.05, FRL_POS[1] + 0.07, FRL_POS[2]],
      [FRL_POS[0] + 0.028, FRL_POS[1] + 0.07, FRL_POS[2]],
    ],
    radius: 0.005,
    color: '#1f5fd0',
  };
}

/** Filter-regulator with gauge & shut-off (machine frame). */
function FrlUnit({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh material={paint('#2c3136', 0.45, 0.3)} position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[0.045, 0.05, 0.045]} />
      </mesh>
      <mesh material={paint('#aab3bb', 0.3, 0.2)} position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.018, 0.014, 0.06, 18]} />
      </mesh>
      <mesh material={paint('#1f5fd0', 0.4)} position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.014, 0.014, 0.04, 18]} />
      </mesh>
      {/* gauge */}
      <mesh position={[0, 0.07, 0.032]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.012, 24]} />
        <meshStandardMaterial color="#1b1c1e" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.07, 0.0385]}>
        <circleGeometry args={[0.017, 24]} />
        <meshStandardMaterial color="#f4f4f0" roughness={0.3} />
      </mesh>
      <mesh position={[0.004, 0.073, 0.039]} rotation={[0, 0, -0.7]}>
        <boxGeometry args={[0.0015, 0.013, 0.001]} />
        <meshStandardMaterial color="#c00" />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Reject chute + tote
// ---------------------------------------------------------------------------

export function RejectChute() {
  const ss = steel('#c9ced2', 0.3);
  const cx = (CHUTE.x0 + CHUTE.x1) / 2;
  const w = CHUTE.x1 - CHUTE.x0;
  const midZ = CHUTE.z0 + (CHUTE.len / 2) * Math.cos(CHUTE.theta);
  const midY = BELT_H - (CHUTE.len / 2) * Math.sin(CHUTE.theta) - 0.004;
  return (
    <group>
      <mesh material={ss} position={[cx, midY, midZ]} rotation={[CHUTE.theta, 0, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.004, CHUTE.len]} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} material={ss} position={[cx + (sx * w) / 2, midY + 0.06, midZ]} rotation={[CHUTE.theta, 0, 0]} castShadow>
          <boxGeometry args={[0.004, 0.13, CHUTE.len]} />
        </mesh>
      ))}
      {/* legs + cross brace */}
      <Instances
        geometry={unitBox}
        material={ss}
        items={[
          ...[-1, 1].map((sx) => ({ p: [cx + sx * (w / 2 - 0.02), (CHUTE_END_Y - 0.03) / 2, CHUTE_END_Z - 0.08] as Vec3, s: [0.03, CHUTE_END_Y - 0.03, 0.03] as Vec3 })),
          { p: [cx, 0.2, CHUTE_END_Z - 0.08], s: [w - 0.04, 0.025, 0.025] },
        ]}
      />
      <Tote />
    </group>
  );
}

function Tote() {
  const blue = paint('#2f62b3', 0.55, 0.05);
  const { x, z, w, d, h } = TOTE;
  const t = 0.012;
  return (
    <group position={[x, 0, z]}>
      <Instances
        geometry={unitBox}
        material={blue}
        items={[
          { p: [0, 0.02, 0], s: [w, 0.012, d] },
          { p: [0, h / 2, -d / 2 + t / 2], s: [w, h, t] },
          { p: [0, h / 2, d / 2 - t / 2], s: [w, h, t] },
          { p: [-w / 2 + t / 2, h / 2, 0], s: [t, h, d] },
          { p: [w / 2 - t / 2, h / 2, 0], s: [t, h, d] },
          { p: [0, h - 0.012, d / 2 + 0.004], s: [w, 0.024, 0.01] },
          { p: [0, h - 0.012, -d / 2 - 0.004], s: [w, 0.024, 0.01] },
        ]}
      />
      {/* dolly */}
      <Instances
        geometry={unitCylY}
        material={paint('#1a1a1a', 0.7)}
        items={[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [sx * (w / 2 - 0.06), 0.012, sz * (d / 2 - 0.06)] as Vec3, s: [0.025, 0.02, 0.025] as Vec3 })))}
      />
      <mesh position={[0, h * 0.62, d / 2 + 0.002]} userData={{ noOcclude: true }}>
        <planeGeometry args={[0.24, 0.08]} />
        <meshStandardMaterial map={rejectLabel()} roughness={0.6} />
      </mesh>
    </group>
  );
}

let rejectTex: THREE.CanvasTexture | null = null;
function rejectLabel() {
  if (rejectTex) return rejectTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 86;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c62828';
  ctx.fillRect(0, 0, 256, 86);
  ctx.fillStyle = '#fff';
  ctx.font = '900 44px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('REJECT', 128, 46);
  rejectTex = new THREE.CanvasTexture(c);
  rejectTex.colorSpace = THREE.SRGBColorSpace;
  return rejectTex;
}

/** Rejected boxes lying in the tote (count = tall boxes diverted that already landed). */
export function TotePile({ state }: { state: ConveyorSortState }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const shown = useRef(-1);
  const slots = useMemo(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const out: THREE.Matrix4[] = [];
    const layout: [number, number, number, number][] = [
      [-0.19, 0.03, -0.02, 0.1],
      [0.18, 0.03, 0.03, -0.12],
      [-0.02, 0.28, -0.05, 0.5],
      [0.2, 0.28, 0.05, -0.3],
      [-0.2, 0.28, 0.02, 0.9],
      [0.02, 0.53, 0.0, 0.2],
    ];
    for (const [x, y, z, ry] of layout) {
      e.set(-Math.PI / 2 + 0.05, ry, 0.04);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(TOTE.x + x, y + BOX_SIZES.tall.width / 2, TOTE.z + z + 0.17), q, new THREE.Vector3(1, 1, 1));
      out.push(m.clone());
    }
    return out;
  }, []);
  useFrame(() => {
    const im = ref.current;
    if (!im) return;
    let inFlight = 0;
    for (const b of state.boxes) if (b.tall && (b.state === 'diverted' || b.state === 'chute')) inFlight++;
    const landed = Math.max(0, state.boxesRejected - inFlight);
    const n = landed === 0 ? 0 : Math.min(slots.length, landed);
    if (shown.current !== n) {
      shown.current = n;
      for (let i = 0; i < n; i++) im.setMatrixAt(i, slots[i]!);
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  });
  return <instancedMesh ref={ref} args={[boxGeometry('tall'), boxMaterial('tall'), slots.length]} castShadow receiveShadow frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Good lane: gravity rollers + finished-goods pallet
// ---------------------------------------------------------------------------

const ROLLER_R = 0.025;
const ROLLER_PITCH = 0.075;

export function GoodLane({ state }: { state: ConveyorSortState }) {
  const rollers = useRef<THREE.InstancedMesh>(null);
  const angle = useRef(0);
  const xs = useMemo(() => {
    const out: number[] = [];
    for (let x = RUNOUT.x0 + 0.04; x < RUNOUT.x1 - 0.03; x += ROLLER_PITCH) out.push(x);
    return out;
  }, []);
  const tmp = useMemo(() => ({ o: new THREE.Object3D() }), []);
  useFrame((_, dt) => {
    const im = rollers.current;
    if (!im) return;
    let moving = false;
    for (const b of state.boxes) if (b.state === 'good') moving = true;
    if (!moving && im.userData.init) return;
    im.userData.init = true;
    if (moving) angle.current -= (Math.max(state.beltSpeed, 0.4) * Math.min(dt, 0.05)) / ROLLER_R;
    const o = tmp.o;
    for (let i = 0; i < xs.length; i++) {
      o.position.set(xs[i]!, RUNOUT.top - ROLLER_R, 0);
      o.rotation.set(Math.PI / 2, angle.current, 0);
      o.scale.set(ROLLER_R, G.beltWidth + 0.02, ROLLER_R);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  const len = RUNOUT.x1 - RUNOUT.x0;
  const cx = (RUNOUT.x0 + RUNOUT.x1) / 2;
  const frameY = RUNOUT.top - ROLLER_R - 0.02;
  const zf = G.beltWidth / 2 + 0.035;
  const painted = paint('#2f5f8f', 0.45, 0.35);
  return (
    <group>
      <instancedMesh ref={rollers} args={[unitCylY, steel('#b8bec3', 0.3), xs.length]} castShadow receiveShadow frustumCulled={false} />
      <Instances
        geometry={unitBox}
        material={painted}
        items={[
          ...[-1, 1].map((sz) => ({ p: [cx, frameY, sz * zf] as Vec3, s: [len, 0.07, 0.012] as Vec3 })),
          ...[RUNOUT.x0 + 0.12, RUNOUT.x1 - 0.12].flatMap((x) => [-1, 1].map((sz) => ({ p: [x, (frameY - 0.035) / 2, sz * zf] as Vec3, s: [0.04, frameY - 0.035, 0.04] as Vec3 }))),
          ...[RUNOUT.x0 + 0.12, RUNOUT.x1 - 0.12].map((x) => ({ p: [x, 0.25, 0] as Vec3, s: [0.03, 0.03, 2 * zf] as Vec3 })),
          // end stop
          { p: [RUNOUT.x1 + 0.01, RUNOUT.top + 0.04, 0], s: [0.02, 0.1, 2 * zf + 0.02] },
          // side guides
          ...[-1, 1].map((sz) => ({ p: [cx, RUNOUT.top + 0.06, sz * (zf - 0.01)] as Vec3, s: [len, 0.025, 0.008] as Vec3 })),
        ]}
      />
    </group>
  );
}

/** Finished-goods pallet: short boxes delivered to the good lane stack up (a new pallet every 36). */
export function GoodPallet({ state }: { state: ConveyorSortState }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const shown = useRef(-1);
  const CAP = 36;
  const slots = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    const r = (i: number) => ((i * 2654435761) >>> 0) / 4294967296;
    for (let k = 0; k < 3; k++)
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < 4; i++) {
          const idx = out.length;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(PALLET.x + (i - 1.5) * 0.302 + (r(idx) - 0.5) * 0.008, 0.144 + k * 0.2, PALLET.z + (j - 1) * 0.212 + (r(idx + 99) - 0.5) * 0.008),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (r(idx + 7) - 0.5) * 0.03, 0)),
            new THREE.Vector3(1, 1, 1),
          );
          out.push(m);
        }
    return out;
  }, []);
  useFrame(() => {
    const im = ref.current;
    if (!im) return;
    let inFlight = 0;
    for (const b of state.boxes) if (!b.tall && b.state === 'good') inFlight++;
    const done = Math.max(0, state.boxesGood - inFlight);
    const n = done === 0 ? 0 : ((done - 1) % CAP) + 1;
    if (shown.current !== n) {
      shown.current = n;
      for (let i = 0; i < n; i++) im.setMatrixAt(i, slots[i]!);
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  });
  return <instancedMesh ref={ref} args={[boxGeometry('short'), boxMaterial('short'), CAP]} castShadow receiveShadow frustumCulled={false} />;
}

// ---------------------------------------------------------------------------
// Field junction box JB-201 + frame cable runs
// ---------------------------------------------------------------------------

/** JB-201 hangs on a bracket under the back (−Z) side frame near the discharge end; its front faces −Z. */
export const JB = { x: G.beltLength - 0.55, y: LAY.frameBottom - 0.1, z: -LAY.frameOuterZ - 0.012, size: [0.22, 0.16, 0.09] as Vec3, glands: 7 } as const;
const JB_GLANDS = fieldJunctionBoxGlands(JB.size, JB.glands);
/** Cable entry point of gland `i` (machine frame; the box is turned 180°, so gland 0 is the rightmost). */
export function jbGland(i: number): Vec3 {
  const g = JB_GLANDS[i]!;
  return [JB.x - g[0], JB.y + g[1] + 0.002, JB.z - JB.size[2] * 0.36];
}
/** z of cables tied along the outer face of the back side frame. */
export const FRAME_RUN_Z = -LAY.frameOuterZ - 0.012;
const FRAME_RUN_Y = LAY.frameBottom - 0.012;

/**
 * End of a cable run along the frame into JB-201 gland `i`: down beside the box, under it, up into the gland
 * (drip loop). Cables arriving from the left run deeper the further right their gland is, so loops never cross.
 */
export function jbRun(fromX: number, i: number): Vec3[] {
  const g = jbGland(i);
  const left = fromX < JB.x;
  const s = left ? -1 : 1;
  const side = JB.x + s * (JB.size[0] / 2 + 0.03);
  const yU = g[1] - (left ? 0.03 + 0.011 * (JB.glands - 1 - i) : 0.03 + 0.011 * i);
  return [
    [side + s * 0.12, FRAME_RUN_Y, FRAME_RUN_Z],
    [side + s * 0.02, FRAME_RUN_Y - 0.03, FRAME_RUN_Z - 0.006],
    [side, yU + 0.04, (FRAME_RUN_Z + g[2]) / 2],
    [side - s * 0.03, yU, g[2]],
    [g[0] + s * 0.03, yU, g[2]],
    [g[0], yU + 0.025, g[2]],
    [g[0], g[1] - 0.004, g[2]],
  ];
}

/** Yellow M12 cordset from a photo-eye post base, down the frame face and along it into JB-201 gland `i`. */
export function sensorCable(x: number, i: number): CableSpec {
  const from: Vec3 = [x + 0.004, LAY.frameTop - 0.004, -EYE_Z - 0.01];
  const dir = Math.sign(JB.x - x) || 1;
  return {
    points: [from, [x + 0.006, LAY.frameTop - 0.02, FRAME_RUN_Z + 0.004], [x + 0.03 * dir, FRAME_RUN_Y + 0.02, FRAME_RUN_Z], [x + 0.09 * dir, FRAME_RUN_Y, FRAME_RUN_Z], ...jbRun(x, i)],
    radius: 0.003,
    color: '#e8b90f',
  };
}

export function JunctionBox() {
  return (
    <group>
      {/* hanger bracket from the side frame */}
      <Instances
        geometry={unitBox}
        material={steel('#c3c8cc', 0.42)}
        items={[-1, 1].map((sx) => ({ p: [JB.x + sx * 0.08, (LAY.frameBottom + JB.y) / 2 + 0.02, JB.z + 0.004] as Vec3, s: [0.025, LAY.frameBottom - JB.y + 0.06, 0.006] as Vec3 }))}
      />
      <FieldJunctionBox size={JB.size} glands={JB.glands} label="JB-201" position={[JB.x, JB.y, JB.z]} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// 855T stack light on a pole at the discharge end (readable from the whole line)
// ---------------------------------------------------------------------------

export const STACK = { x: 5.18, z: -(LAY.frameOuterZ + 0.05), pole: 1.05 } as const;
const S855_DIMS = { moduleH: 0.0575, adapterH: 0.034, footH: 0.012 } as const;
const STACK_BASE = LAY.frameTop + 0.006;
/** Centre height of tier `i` (0 = top / red). */
export const stackTierY = (i: number) => STACK_BASE + S855_DIMS.footH + STACK.pole - 0.004 + S855_DIMS.adapterH + (2 - i) * S855_DIMS.moduleH + S855_DIMS.moduleH / 2;

export function LineStackLight({ state }: { state: ConveyorSortState }) {
  return (
    <group>
      {/* L-bracket bolted to the frame face */}
      <Instances
        geometry={unitBox}
        material={steel('#c3c8cc', 0.42)}
        items={[
          { p: [STACK.x, LAY.frameTop - 0.04, -LAY.frameOuterZ - 0.003], s: [0.1, 0.09, 0.006] },
          { p: [STACK.x, STACK_BASE - 0.003, (STACK.z - LAY.frameOuterZ) / 2 - 0.02], s: [0.1, 0.006, 0.11] },
        ]}
      />
      <StackLight856T
        series="855T"
        position={[STACK.x, STACK_BASE, STACK.z]}
        tiers={['red', 'amber', 'green']}
        getTier={(i) => (i === 0 ? state.lightRed : i === 1 ? state.lightAmber : state.lightGreen)}
        mount="pole"
        poleLength={STACK.pole}
      />
      <Glow get={() => state.lightRed} color="#ff2a14" position={[STACK.x, stackTierY(0), STACK.z]} size={0.26} grow={0.09} intensity={2} />
      <Glow get={() => state.lightAmber} color="#ffab1a" position={[STACK.x, stackTierY(1), STACK.z]} size={0.26} grow={0.09} intensity={2} />
      <Glow get={() => state.lightGreen} color="#2dff5a" position={[STACK.x, stackTierY(2), STACK.z]} size={0.26} grow={0.09} intensity={1.5} />
    </group>
  );
}

/** Stack light cable: from the pole foot down the frame into JB-201. */
export function stackLightCable(i: number): CableSpec {
  return {
    points: [[STACK.x - 0.02, STACK_BASE + 0.004, STACK.z + 0.02], [STACK.x - 0.03, STACK_BASE - 0.02, -LAY.frameOuterZ - 0.016], [STACK.x - 0.05, FRAME_RUN_Y + 0.02, FRAME_RUN_Z], ...jbRun(STACK.x - 0.08, i)],
    radius: 0.0035,
    color: '#6f7479',
  };
}
