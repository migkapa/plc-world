/**
 * `parking-garage` 3D view — the entry / exit plaza of an open-air parking deck: entry and exit barrier
 * gates (arms follow the scene state), photo-eyes across both lanes under the arms (red beams, blocked by
 * the cars), detector loops (glow while occupied), the ticket column pressed by the drivers (Ticket_PB),
 * FULL / SPACES signs, 12 numbered stalls, cars (instanced fleet: wheels, steering, brake lights,
 * blinkers), the attendant booth with the live CompactLogix gate control panel and the COUNT RESET key
 * (reset_key), and an instructor "SIM DISPATCH" console that sends cars in / out (spawn_entry / spawn_exit).
 *
 * The view never ticks the runtime: it reads `state` in useFrame and writes controls via runtime.setControl.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { memo, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import {
  BarrierGate,
  BARRIER_COLORS,
  CarFleet,
  ClearanceBar,
  InductiveLoopMarking,
  ParkingStatusSign,
  PhotoEye42EF,
  TicketDispenser,
  type Blinker,
  type CarInstance,
} from '../../../twin/devices';
import type { SceneViewProps, SimRuntime } from '../../types';
import { audioAllowed, canvasTexture, FONT, hazardTexture, infoLine, IoTag, ioLine, kgeo, kmat, TagLayer, useSfxLoops } from '../trainer/kit';
import { useDisposeOnUnmount, useHoverCursor } from '../traffic-light/cityKit';
import { Booth } from './booth';
import { GARAGE_LAYOUT as Y, type GarageCar, type ParkingGarageState } from './logic';
import { CURB, GarageSite, SITE, SITE_OCCLUDERS } from './site';

type P = SceneViewProps<ParkingGarageState>;

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** Barrier cabinets: the arm plane is BARRIER_DIMS.armZ (0.2 m) in front of the cabinet → on the gate line. */
const ENTRY_GATE: Vec3 = [-5.15, CURB, Y.gateZ - 0.2];
const EXIT_GATE: Vec3 = [5.15, CURB, Y.gateZ + 0.2];
const ARM_LEN = 4.25;
/** Photo-eye lens height above the road and lane-side bollards. */
const PE_Y = 0.55;
const PE_ENTRY_X = SITE.westIsland.x1 - 0.12;
const PE_EXIT_X = SITE.eastIsland.x0 + 0.12;
const PE_BEAM = PE_ENTRY_X * -1 - (SITE.centerIsland.x1 - 0.12);
const TICKET: Vec3 = [-5.12, CURB, Y.entryWaitZ - 0.35];
const DISPATCH: Vec3 = [-13.7, CURB, 13.35];

// ---------------------------------------------------------------------------
// Gates, eyes, loops, ticket column, signs
// ---------------------------------------------------------------------------

const eyeBollardMat = () => kmat('pg:eyeBollard', () => new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.45, metalness: 0.2 }));
const eyeWindowMat = () => kmat('pg:eyeWindow', () => new THREE.MeshStandardMaterial({ color: '#111418', roughness: 0.1, metalness: 0.4 }));

/** Steel bollard that carries a photo-eye (or its reflector) at PE_Y; the window faces local +Z. */
function EyeBollard({ position, rotationY }: { position: Vec3; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.4, -0.05]} material={eyeBollardMat()} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.8, 0.12]} />
      </mesh>
      <mesh position={[0, PE_Y - CURB, 0.011]} material={eyeWindowMat()}>
        <boxGeometry args={[0.1, 0.1, 0.004]} />
      </mesh>
      <mesh position={[0, 0.82, -0.05]} material={eyeBollardMat()}>
        <boxGeometry args={[0.18, 0.04, 0.14]} />
      </mesh>
    </group>
  );
}

function GatesAndSensors({ state, runtime }: P) {
  const g = useMemo(
    () => ({
      entryPos: () => state.entryGate.pos,
      exitPos: () => state.exitGate.pos,
      entryArm: () => armLights(state.entryGate.pos),
      exitArm: () => armLights(state.exitGate.pos),
      entryPE: () => state.sensors.entryPE,
      exitPE: () => state.sensors.exitPE,
      entryLoop: () => state.sensors.entryLoop,
      exitLoop: () => state.sensors.exitLoop,
      full: () => state.fullSign,
      open: () => state.openSign,
      swing: () => {
        const b = state.entryGate.bounceMs / 1000;
        return b < 2 ? Math.sin(b * 9) * 0.12 * Math.exp(-b * 2) : 0;
      },
    }),
    [state],
  );
  const L = (a: string) => ioLine(runtime, a);
  return (
    <group>
      {/* barrier gates */}
      <BarrierGate position={ENTRY_GATE} armLength={ARM_LEN} side="right" housingColor={BARRIER_COLORS.orange} getPosition={g.entryPos} getArmLights={g.entryArm} />
      <BarrierGate position={EXIT_GATE} rotation={[0, Math.PI, 0]} armLength={ARM_LEN} side="right" housingColor={BARRIER_COLORS.orange} getPosition={g.exitPos} getArmLights={g.exitArm} />
      <IoTag position={[ENTRY_GATE[0], CURB + 0.6, ENTRY_GATE[2]]} size={[0.6, 1.25, 0.5]} anchor={[0, 0.95, 0]} title="Entry barrier gate operator" lines={[L('Entry_Gate_Up')]} />
      <IoTag position={[EXIT_GATE[0], CURB + 0.6, EXIT_GATE[2]]} size={[0.6, 1.25, 0.5]} anchor={[0, 0.95, 0]} title="Exit barrier gate operator" lines={[L('Exit_Gate_Up')]} />
      {/* photo-eyes under the arms: sensor in a bollard on the gate island, reflector on the centre island */}
      <EyeBollard position={[PE_ENTRY_X, CURB, Y.gateZ]} rotationY={Math.PI / 2} />
      <EyeBollard position={[SITE.centerIsland.x0 + 0.12, CURB, Y.gateZ]} rotationY={-Math.PI / 2} />
      <EyeBollard position={[PE_EXIT_X, CURB, Y.gateZ]} rotationY={-Math.PI / 2} />
      <EyeBollard position={[SITE.centerIsland.x1 - 0.12, CURB, Y.gateZ]} rotationY={Math.PI / 2} />
      <PhotoEye42EF position={[PE_ENTRY_X + 0.03, PE_Y, Y.gateZ]} rotation={[0, Math.PI / 2, 0]} mount="none" beamLength={PE_BEAM - 0.06} getBlocked={g.entryPE} getOutput={g.entryPE} getBlockDistance={() => 1.05} />
      <PhotoEye42EF position={[PE_EXIT_X - 0.03, PE_Y, Y.gateZ]} rotation={[0, -Math.PI / 2, 0]} mount="none" beamLength={PE_BEAM - 0.06} getBlocked={g.exitPE} getOutput={g.exitPE} getBlockDistance={() => 1.05} />
      <IoTag position={[PE_ENTRY_X, CURB + 0.4, Y.gateZ]} size={[0.25, 0.85, 0.25]} anchor={[0, 0.55, 0]} title="Entry photo-eye (retro-reflective)" lines={[L('Entry_PE')]} />
      <IoTag position={[PE_EXIT_X, CURB + 0.4, Y.gateZ]} size={[0.25, 0.85, 0.25]} anchor={[0, 0.55, 0]} title="Exit photo-eye (retro-reflective)" lines={[L('Exit_PE')]} />
      {/* detector loops (lead-ins run to the islands) */}
      <InductiveLoopMarking position={[Y.entryLaneX, 0, (Y.entryLoop.z0 + Y.entryLoop.z1) / 2]} rotation={[0, -Math.PI / 2, 0]} length={Y.entryLoop.z1 - Y.entryLoop.z0} width={2 * Y.loopHalfWidth} leadIn={0.5} getActive={g.entryLoop} hint="strong" />
      <InductiveLoopMarking position={[Y.exitLaneX, 0, (Y.exitLoop.z0 + Y.exitLoop.z1) / 2]} rotation={[0, Math.PI / 2, 0]} length={Y.exitLoop.z1 - Y.exitLoop.z0} width={2 * Y.loopHalfWidth} leadIn={0.5} getActive={g.exitLoop} hint="strong" />
      <IoTag position={[Y.entryLaneX, 0.1, (Y.entryLoop.z0 + Y.entryLoop.z1) / 2]} size={[3, 0.25, 3]} anchor={[0, 0.35, 0]} title="Entry detector loop" lines={[L('Entry_Loop')]} />
      <IoTag position={[Y.exitLaneX, 0.1, (Y.exitLoop.z0 + Y.exitLoop.z1) / 2]} size={[3, 0.25, 3]} anchor={[0, 0.35, 0]} title="Exit detector loop" lines={[L('Exit_Loop')]} />
      <TicketColumn state={state} runtime={runtime} />
      {/* FULL / SPACES: under the canopy over the entry lane and on a post at the plaza entrance */}
      <ParkingStatusSign position={[Y.entryLaneX, SITE.canopy.y, SITE.canopy.z1 - 0.2]} mount="ceiling" mountLength={0.2} getFull={g.full} getOpen={g.open} />
      <ParkingStatusSign position={[-7.7, CURB, SITE.portal.z0 - 2.2]} mount="post" mountLength={2.0} getFull={g.full} getOpen={g.open} />
      <IoTag position={[Y.entryLaneX, SITE.canopy.y - 0.55, SITE.canopy.z1 - 0.12]} size={[1.0, 0.7, 0.2]} anchor={[0, 0.45, 0.1]} title="FULL / SPACES sign" lines={[L('Full_Sign'), L('Open_Sign')]} />
      <IoTag position={[-7.7, CURB + 2.4, SITE.portal.z0 - 2.1]} size={[1.0, 0.8, 0.25]} anchor={[0, 0.5, 0]} title="FULL / SPACES sign (plaza)" lines={[L('Full_Sign'), L('Open_Sign')]} />
      <ClearanceBar position={[Y.entryLaneX, 0, SITE.canopy.z1 - 0.9]} width={Y.laneWidth - 0.2} mountHeight={SITE.canopy.y} getSwing={g.swing} />
    </group>
  );
}

function armLights(pos: number): boolean | 'flash' {
  if (pos < 0.03) return true;
  return pos < 0.97 ? 'flash' : false;
}

function TicketColumn({ state, runtime }: P) {
  const t = useRef({ lastPressEndMs: -1e9, prev: false });
  useFrame(() => {
    const k = t.current;
    const p = state.sensors.ticket;
    if (k.prev && !p) k.lastPressEndMs = state.timeMs;
    k.prev = p;
  });
  const g = useMemo(
    () => ({
      pressed: () => state.sensors.ticket,
      ticketOut: () => state.timeMs - t.current.lastPressEndMs < 2600 && state.entryGate.pos < 0.9,
      message: () =>
        state.fullSign
          ? 'SORRY\nGARAGE FULL'
          : state.entryGate.pos > 0.4
            ? 'WELCOME\nPLEASE DRIVE ON'
            : state.timeMs - t.current.lastPressEndMs < 2600
              ? 'PLEASE TAKE\nYOUR TICKET'
              : 'PRESS BUTTON\nFOR TICKET',
      lit: () => !state.fullSign,
    }),
    [state],
  );
  return (
    <IoTag position={TICKET} rotation={[0, Math.PI / 2, 0]} size={[0.5, 1.5, 0.45]} center={[0, 0.75, 0]} anchor={[0, 1.62, 0]} title="Ticket dispenser push button (N.O.) — pressed by drivers" lines={[ioLine(runtime, 'Ticket_PB')]}>
      <TicketDispenser getPressed={g.pressed} getTicketOut={g.ticketOut} getMessage={g.message} getButtonLit={g.lit} />
    </IoTag>
  );
}

// ---------------------------------------------------------------------------
// Instructor dispatch console (spawn_entry / spawn_exit)
// ---------------------------------------------------------------------------

function dispatchSignTexture() {
  return canvasTexture('pg:dispatchSign', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2b1b4a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c4b5fd';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#ede9fe';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 58px ${FONT}`;
    ctx.fillText('SIM DISPATCH', w / 2, h * 0.3);
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = '#c4b5fd';
    ctx.fillText('instructor console · not wired to the PLC', w / 2, h * 0.55);
    ctx.fillStyle = '#86efac';
    ctx.fillText('▲ car arrives', w * 0.28, h * 0.8);
    ctx.fillStyle = '#93c5fd';
    ctx.fillText('▼ car leaves', w * 0.72, h * 0.8);
  });
}

function DispatchButton({ runtime, id, color, position }: { runtime: SimRuntime; id: string; color: string; position: Vec3 }) {
  const cap = useRef<THREE.Mesh>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3, toneMapped: false }), [color]);
  useDisposeOnUnmount(useMemo(() => [mat], [mat]));
  const { hovered, handlers } = useHoverCursor(true);
  useFrame(() => {
    const on = runtime.getControl(id) === true;
    if (cap.current) cap.current.position.y = on ? 0.012 : 0.03;
    mat.emissiveIntensity = on ? 2.4 : hovered ? 1.2 : 0.6;
  });
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    runtime.setControl(id, true);
    sfx.play('press');
    const up = () => {
      window.removeEventListener('pointerup', up);
      runtime.setControl(id, false);
      sfx.play('release');
    };
    window.addEventListener('pointerup', up);
  };
  return (
    <group position={position}>
      <mesh geometry={kgeo('pg:dispRing', () => new THREE.CylinderGeometry(0.075, 0.075, 0.02, 24))} material={kmat('pg:dispRingMat', () => new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 0.9, roughness: 0.3 }))} position={[0, 0.01, 0]} />
      <mesh ref={cap} geometry={kgeo('pg:dispCap', () => new THREE.CylinderGeometry(0.06, 0.062, 0.04, 24))} material={mat} position={[0, 0.03, 0]} {...handlers} onPointerDown={down} />
    </group>
  );
}

function DispatchConsole({ state, runtime }: P) {
  const signMat = kmat('pg:dispatchSignMat', () => new THREE.MeshStandardMaterial({ map: dispatchSignTexture(), roughness: 0.5, emissive: '#ffffff', emissiveMap: dispatchSignTexture(), emissiveIntensity: 0.25 }));
  const hazard = useMemo(() => {
    const t = hazardTexture().clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 4);
    t.rotation = Math.PI / 2;
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  }, []);
  useDisposeOnUnmount(useMemo(() => [hazard.map, hazard], [hazard]));
  const lines = useMemo(
    () => [
      infoLine('Cars inside', () => state.carsInside, ` / ${Y.capacity}`),
      infoLine('Waiting at entry', () => state.entryOrder.length),
      infoLine('Waiting at exit', () => state.exitOrder.length),
      infoLine('Turned away', () => state.carsTurnedAway),
    ],
    [state],
  );
  return (
    <group position={DISPATCH} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, 0.45, 0]} material={hazard} castShadow receiveShadow>
        <boxGeometry args={[0.36, 0.9, 0.26]} />
      </mesh>
      <group position={[0, 0.93, 0.02]} rotation={[-0.55, 0, 0]}>
        <mesh material={kmat('pg:dispPanel', () => new THREE.MeshStandardMaterial({ color: '#1f2328', roughness: 0.5, metalness: 0.3 }))} castShadow>
          <boxGeometry args={[0.5, 0.04, 0.34]} />
        </mesh>
        <DispatchButton runtime={runtime} id="spawn_entry" color="#22c55e" position={[-0.12, 0.02, 0]} />
        <DispatchButton runtime={runtime} id="spawn_exit" color="#3b82f6" position={[0.12, 0.02, 0]} />
      </group>
      {/* sign board on two posts behind the console */}
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 1.05, -0.2]} material={kmat('pg:dispPost', () => new THREE.MeshStandardMaterial({ color: '#5b6167', metalness: 0.7, roughness: 0.4 }))} castShadow>
          <boxGeometry args={[0.05, 2.1, 0.05]} />
        </mesh>
      ))}
      <mesh position={[0, 1.78, -0.17]} material={signMat} castShadow>
        <boxGeometry args={[0.96, 0.48, 0.03]} />
      </mesh>
      <IoTag position={[0, 1.0, 0]} size={[0.9, 2.0, 0.5]} anchor={[0, 1.15, 0]} title="Simulation dispatcher (instructor tool, not wired to the PLC)" lines={lines} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

interface Kin {
  d: number;
  x: number;
  z: number;
  yaw: number;
  v: number;
  steer: number;
  brake: boolean;
  seen: number;
}

const WHEELBASE = 2.75;
const MAX_CARS = 30;

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function blinkerOf(c: GarageCar): Blinker {
  if (c.dinged) return 'hazard';
  if (c.phase === 'entering' && c.space >= 0) {
    const sp = Y.spaces[c.space]!;
    return c.z < Y.aisleZ + 5.5 ? (sp.x < c.x ? 'left' : 'right') : null;
  }
  if (c.phase === 'turning-away' || c.phase === 'turning-back') return 'right';
  if (c.phase === 'backing-out') return c.x < Y.exitLaneX ? 'right' : 'left';
  return null;
}

/** Per-car odometer, steering and brake state (runs before the fleet in the frame). */
function CarKinematics({ state, kin }: { state: ParkingGarageState; kin: Map<number, Kin> }) {
  const sweep = useRef(0);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    sweep.current += dt;
    for (const c of state.cars) {
      let k = kin.get(c.id);
      if (!k) {
        k = { d: 0, x: c.x, z: c.z, yaw: c.yaw, v: c.speed, steer: 0, brake: false, seen: 0 };
        kin.set(c.id, k);
      }
      k.seen = 0;
      const dx = c.x - k.x;
      const dz = c.z - k.z;
      const dist = Math.hypot(dx, dz);
      const dir = c.reverse ? -1 : 1;
      k.d += dir * dist;
      let target = 0;
      if (dist > 0.002) {
        const dyaw = wrapAngle(c.yaw - k.yaw);
        target = THREE.MathUtils.clamp(Math.atan((WHEELBASE * dyaw) / dist) * dir, -0.6, 0.6);
      } else target = k.steer;
      k.steer += (target - k.steer) * Math.min(1, dt * 6);
      k.brake = c.phase !== 'parked' && (c.speed < 0.05 || c.speed < k.v - 0.04 * Math.max(dt * 60, 1) * 0.5);
      k.v = c.speed;
      k.x = c.x;
      k.z = c.z;
      k.yaw = c.yaw;
    }
    if (sweep.current > 2) {
      sweep.current = 0;
      for (const [id, k] of kin) {
        k.seen++;
        if (k.seen > 2) kin.delete(id);
      }
    }
  });
  return null;
}

function Cars({ state }: { state: ParkingGarageState }) {
  const kin = useMemo(() => new Map<number, Kin>(), []);
  const getCar = useMemo(
    () => (i: number, o: CarInstance) => {
      const c = state.cars[i];
      if (!c) return false;
      const k = kin.get(c.id);
      o.x = c.x;
      o.z = c.z;
      o.yaw = c.yaw;
      o.variant = c.variant;
      if (k) {
        o.distance = k.d;
        o.steer = k.steer;
        o.braking = k.brake;
      }
      o.blinker = blinkerOf(c);
      // a driver who has waited for ages honks and flashes the headlights
      o.headlights = c.honking && Math.floor(state.timeMs / 350) % 2 === 0;
      return true;
    },
    [state, kin],
  );
  return (
    <group>
      <CarKinematics state={state} kin={kin} />
      <CarFleet capacity={MAX_CARS} getCar={getCar} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

function useGarageSound(state: ParkingGarageState) {
  const k = useRef({ entry: 0, exit: 0, moving: 0, hits: -1, ticket: false, full: false, init: false });
  useSfxLoops(['motor', 'horn'], (lv) => {
    lv.motor = k.current.moving > 0 ? 0.45 : 0;
    let honk = false;
    for (const c of state.cars) if (c.honking) honk = true;
    lv.horn = honk && Math.floor(state.timeMs / 450) % 3 === 0 ? 0.8 : 0;
  });
  useFrame((_, dt) => {
    const s = k.current;
    const e = state.entryGate.pos;
    const x = state.exitGate.pos;
    const moving = Math.abs(e - s.entry) > 1e-4 || Math.abs(x - s.exit) > 1e-4;
    s.moving = moving ? 0.25 : Math.max(0, s.moving - dt);
    s.entry = e;
    s.exit = x;
    const ok = audioAllowed();
    if (!s.init) {
      s.init = true;
      s.hits = state.gateHits;
      s.ticket = state.sensors.ticket;
      return;
    }
    if (state.gateHits > s.hits && ok) {
      sfx.play('contactor');
      sfx.play('fail');
    }
    s.hits = state.gateHits;
    if (state.sensors.ticket && !s.ticket && ok) sfx.play('beep');
    s.ticket = state.sensors.ticket;
  });
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export const ParkingGarageView = memo(function ParkingGarageView({ state, runtime }: P) {
  useGarageSound(state);
  const B = SITE.booth;
  const occluders: Array<[Vec3, Vec3]> = [
    ...SITE_OCCLUDERS,
    [
      [B.x0, CURB, B.z0],
      [B.x1, CURB + 2.9, B.z1],
    ],
  ];
  return (
    <group>
      <GarageSite />
      <TagLayer occluders={occluders}>
        <GatesAndSensors state={state} runtime={runtime} />
        <Booth runtime={runtime} />
        <DispatchConsole state={state} runtime={runtime} />
      </TagLayer>
      <Cars state={state} />
    </group>
  );
});

export default ParkingGarageView;
