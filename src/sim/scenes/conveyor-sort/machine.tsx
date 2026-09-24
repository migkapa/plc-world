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
  PhotoEye42EF,
  PneumaticCylinder,
  PushButtonStation,
  SelectorSwitch800F,
  SolenoidValve,
  type BoxState,
} from '../../../twin/devices';
import type { Vec3 } from '../../../twin/contracts';
import { nextRandom, type RngState } from '../../testing/sceneKit';
import type { SimRuntime } from '../../types';
import { playSfx } from './kit';
import { CONVEYOR_GEOMETRY as G, type ConveyorSortState } from './logic';
import { Instances, paint, steel, unitBox, unitCylY, type CableSpec } from './hall';

export const BELT_H = 0.85;
export const LAY = conveyorLayout(G.beltWidth, BELT_H);
/** Photo-eye lens standoff from the belt centre (sensor on +Z, reflector on −Z). */
export const EYE_Z = LAY.frameZ - 0.03;

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
        {/* hinge shafts + gate cylinders (short-stroke) on the +Z side */}
        {[-1, 1].map((sx) => (
          <group key={sx}>
            <mesh geometry={unitCylY} material={steel()} position={[sx * MAG.ix, -0.006, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.006, 2 * MAG.iz + 0.08, 0.006]} />
            <PneumaticCylinder
              position={[sx * (MAG.ix + 0.06), 0.1, MAG.iz + 0.07]}
              rotation={[Math.PI / 2, 0, 0]}
              bore={0.032}
              stroke={0.04}
              getExtension={() => (state.sinceDropMs < 300 ? 1 : 0)}
              tubes={false}
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
      {/* instructor box on the front-left leg: box pattern selector */}
      <group position={[-MAG.legX, 1.22, MAG.legZ + 0.025]}>
        <PushButtonStation holes={1} position={[0, 0, 0]}>
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
      </group>
      {/* feeder nameplate */}
      <mesh position={[0, BELT_H + MAG.top + 0.09, MAG.iz + 0.04]} userData={{ noOcclude: true }}>
        <planeGeometry args={[0.3, 0.08]} />
        <meshStandardMaterial map={feederPlate()} roughness={0.5} />
      </mesh>
    </group>
  );
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
// Photo-eyes
// ---------------------------------------------------------------------------

type SensorKey = 'infeed' | 'tall' | 'divert' | 'exit';

function blockDistance(s: ConveyorSortState, x: number): number {
  for (const b of s.boxes) {
    if (Math.abs(b.x - x) < G.boxLength / 2 && (b.state === 'belt' || b.state === 'diverted')) {
      const lat = b.state === 'diverted' ? Math.min(b.lateral, 0.4) : 0;
      return Math.max(0.01, EYE_Z - lat - boxWidth(b.tall) / 2);
    }
  }
  return EYE_Z;
}

/** Straight-across photo-eye: sensor on the operator side (+Z) looking at a reflector on the −Z side. */
export function AcrossEye({ state, x, beamY, sensor }: { state: ConveyorSortState; x: number; beamY: number; sensor: SensorKey }) {
  const get = () => state.sensors[sensor];
  const out = sensor === 'infeed' ? () => state.sensors.infeedOutput : get;
  return (
    <PhotoEye42EF
      position={[x, BELT_H + beamY, EYE_Z]}
      rotation={[0, Math.PI, 0]}
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
  const from: Vec3 = [G.peDivertX + 0.3, BELT_H + 0.05, EYE_Z];
  const to: Vec3 = [G.peDivertX - 0.3, BELT_H + 0.05, -EYE_Z];
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

export function Pusher({ state }: { state: ConveyorSortState }) {
  const ext = () => state.pusherPosition;
  const alu = steel('#c3c8cc', 0.42);
  // tube ends at the valve (cylinder coordinates)
  const toCyl = (p: Vec3): Vec3 => [p[0] - G.pusherX, p[1] - CYL.y, p[2] - CYL.z];
  const rear = toCyl([VALVE_POS[0] - 0.012, VALVE_POS[1] + 0.13, VALVE_POS[2] + 0.06]);
  const front = toCyl([VALVE_POS[0] + 0.012, VALVE_POS[1] + 0.13, VALVE_POS[2] + 0.06]);
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
      {/* front bracket bolted to the conveyor side frame, rear support stand */}
      <Instances
        geometry={unitBox}
        material={alu}
        items={[
          { p: [G.pusherX, CYL.y - 0.05, CYL.z - 0.03], s: [0.22, 0.012, 0.09] },
          { p: [G.pusherX, (CYL.y - 0.05 + LAY.frameBottom) / 2, CYL.z + 0.012], s: [0.22, CYL.y - 0.05 - LAY.frameBottom, 0.012] },
          { p: [G.pusherX, (CYL.y - 0.06) / 2, CYL.rearZ + 0.05], s: [0.045, CYL.y - 0.06, 0.045] },
          { p: [G.pusherX, CYL.y - 0.055, CYL.rearZ + 0.05], s: [0.12, 0.012, 0.08] },
          { p: [G.pusherX, 0.006, CYL.rearZ + 0.05], s: [0.16, 0.012, 0.16] },
          { p: [G.pusherX + 0.07, VALVE_POS[1] + 0.06, CYL.rearZ + 0.075], s: [0.2, 0.2, 0.006] },
        ]}
      />
      {/* 5/2 single-solenoid valve (station 1 live) on its manifold */}
      <SolenoidValve variant="pneumatic" position={VALVE_POS} getEnergized={() => state.pusherValve} stations={2} />
      <FrlUnit position={[G.pusherX + 0.2, VALVE_POS[1] + 0.02, VALVE_POS[2] + 0.02]} />
    </group>
  );
}

/** Air supply drop (blue PU) and the valve coil cable (yellow) — machine frame, for <Cables>. */
export function pusherCables(trayY: number, trayZ: number): CableSpec[] {
  return [
    {
      points: [
        [G.pusherX + 0.2, VALVE_POS[1] + 0.2, VALVE_POS[2] + 0.04],
        [G.pusherX + 0.2, 1.6, VALVE_POS[2] + 0.04],
        [G.pusherX + 0.3, trayY - 0.35, VALVE_POS[2] - 0.1],
        [G.pusherX + 0.35, trayY - 0.03, trayZ],
      ],
      radius: 0.005,
      color: '#1f5fd0',
    },
    {
      points: [
        [VALVE_POS[0] - 0.03, VALVE_POS[1] + 0.08, VALVE_POS[2] + 0.08],
        [VALVE_POS[0] - 0.12, VALVE_POS[1] - 0.05, VALVE_POS[2] + 0.12],
        [VALVE_POS[0] - 0.3, 0.3, -LAY.frameZ - 0.2],
        [G.pusherX + 0.9, 0.62, -LAY.frameOuterZ - 0.03],
      ],
      radius: 0.0035,
      color: '#e8b90f',
    },
  ];
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

/** Field junction box on the back side frame (sensor M12 cables land here). */
export function JunctionBox({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh material={paint('#d4d6d1', 0.5, 0.15)} castShadow>
        <boxGeometry args={[0.2, 0.16, 0.08]} />
      </mesh>
      <mesh material={paint('#c4c6c1', 0.45, 0.15)} position={[0, 0, -0.042]}>
        <boxGeometry args={[0.19, 0.15, 0.006]} />
      </mesh>
      {[-0.06, -0.02, 0.02, 0.06].map((x) => (
        <mesh key={x} material={paint('#2a2b2d', 0.5)} position={[x, -0.085, 0]}>
          <cylinderGeometry args={[0.007, 0.008, 0.014, 12]} />
        </mesh>
      ))}
    </group>
  );
}

/** Yellow M12 sensor cable along the frame, from a sensor down to the junction box (for <Cables>). */
export function sensorCable(from: Vec3, to: Vec3, frameSide = -1): CableSpec {
  const zRun = frameSide * (LAY.frameOuterZ + 0.012);
  const yRun = LAY.frameBottom - 0.02;
  const dir = Math.sign(to[0] - from[0] || 1);
  return {
    points: [from, [from[0], yRun + 0.06, from[2]], [from[0] + 0.05 * dir, yRun, zRun], [to[0] - 0.08 * dir, yRun, zRun], to],
    radius: 0.003,
    color: '#e8b90f',
  };
}

