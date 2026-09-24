import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { Preview } from '../../../dev/gallery';
import { Boxes, BOX_SIZES, CardboardBox, type BoxState } from './Boxes';
import { Conveyor, conveyorLayout } from './Conveyor';
import { PneumaticCylinder } from './Cylinder';
import { Cable as FieldCable, CABLE_GRAY, ConduitStub, fm, geo, JunctionBox, junctionBoxGlands, Merge, STUB_TOP, type CableRoute } from './shared';
import type { Vec3 } from '../../contracts';
import { LevelSwitch, LevelTransmitter, TempTransmitter } from './Instruments';
import { Flange, PipeRun, SightGlass } from './Piping';
import { nozzleLocal, OnNozzle, Tank, TANK_LIQUID_COLOR, tankLayout, type TankNozzle } from './Tank';
import { SolenoidValve } from './Valves';
import { GearMotor, gearMotorTorqueArmEnd, Motor } from './Motor';
import { PhotoEye42EF } from './PhotoEye';
import { ProxSensor872C } from './Prox';

const now = () => performance.now() / 1000;

/** Slotted PVC wiring duct (gray) on a panel: origin = back-bottom-left corner, runs along +X. */
function WiringDuct({ position, length, h = 0.04, d = 0.04 }: { position: Vec3; length: number; h?: number; d?: number }) {
  const body = fm.plastic('#9aa0a4', 0.6);
  const slots = Math.floor(length / 0.012);
  return (
    <Merge position={position}>
      <mesh material={body} position={[length / 2, h / 2, d / 2]} castShadow>
        <boxGeometry args={[length, h, d]} />
      </mesh>
      <mesh material={fm.plastic('#8c9296', 0.55)} position={[length / 2, h + 0.002, d / 2]}>
        <boxGeometry args={[length + 0.002, 0.004, d + 0.004]} />
      </mesh>
      {Array.from({ length: slots }, (_, i) => (
        <mesh key={i} material={fm.dark()} position={[0.006 + i * 0.012, h * 0.62, d + 0.0005]}>
          <boxGeometry args={[0.004, h * 0.7, 0.001]} />
        </mesh>
      ))}
    </Merge>
  );
}

/** Manifold (SolenoidValve variant 'pneumatic', no rotation) at `m`: tube ends (world) of station i's A / B fittings. */
function manifoldPorts(m: Vec3, stations: number, i: number): { a: Vec3; b: Vec3 } {
  const pitch = 0.016;
  const x = m[0] - (stations * pitch) / 2 + pitch / 2 + i * pitch;
  return { a: [x, m[1] + 0.012 - 0.016, m[2] + 0.024 - 0.024 * 0.7], b: [x, m[1] + 0.012 - 0.016, m[2] + 0.024 - 0.024 * 0.28] };
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function MotorRunning() {
  return <Motor frame="medium" getRpm={() => 180} />;
}

function MotorFrames() {
  return (
    <group>
      <Motor frame="small" position={[-0.45, 0, 0]} getRpm={() => 120} />
      <Motor frame="medium" position={[0, 0, 0]} getRpm={() => 120} />
      <Motor frame="large" position={[0.55, 0, 0]} getRpm={() => 120} getOverloaded={() => Math.floor(now() / 3) % 2 === 1} />
    </group>
  );
}

function GearMotorDemo() {
  const y = 0.3;
  const arm = gearMotorTorqueArmEnd(0.14);
  const steel = fm.sheet('#3d4247', 0.5);
  return (
    <group>
      {/* base plate, pillow-block pedestal carrying the driven shaft through the hollow output */}
      <mesh material={steel} position={[-0.05, 0.0075, -0.02]} receiveShadow castShadow>
        <boxGeometry args={[0.42, 0.015, 0.32]} />
      </mesh>
      <mesh material={steel} position={[0, (y - 0.03) / 2 + 0.015, -0.13]} castShadow>
        <boxGeometry args={[0.12, y - 0.03, 0.02]} />
      </mesh>
      <mesh material={fm.cast('#5d6369', 0.55)} position={[0, y, -0.13]} castShadow>
        <boxGeometry args={[0.1, 0.07, 0.04]} />
      </mesh>
      <mesh material={fm.steel()} position={[0, y, -0.03]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.0195, 0.0195, 0.26, 24]} />
      </mesh>
      {/* torque-arm standoff up from the base plate */}
      <mesh material={steel} position={[arm[0], (arm[1] + y + 0.03) / 2 + 0.0075, arm[2] - 0.012 - 0.008]} castShadow>
        <boxGeometry args={[0.045, arm[1] + y + 0.03 - 0.015, 0.016]} />
      </mesh>
      <GearMotor position={[0, y, 0]} getRpm={() => 240} torqueArm={0.14} />
    </group>
  );
}

/** 0..1 triangle-ish extension cycle with dwell at both ends (period 3 s). */
function cycle(t: number) {
  const u = t % 3;
  if (u < 0.8) return 0;
  if (u < 1.1) return (u - 0.8) / 0.3;
  if (u < 2.2) return 1;
  if (u < 2.5) return 1 - (u - 2.2) / 0.3;
  return 0;
}

function PhotoEyeBeam() {
  // a box passes through the beam every 3 s
  const blocked = () => {
    const u = now() % 3;
    return u > 1.5 && u < 2.4;
  };
  return (
    <group>
      {/* beams run along +X: sensors at x = 0, reflectors at x = 0.6 */}
      {/* beam at 0.1 m = mid-height of the short box, so the blocked state is unambiguous */}
      <PhotoEye42EF position={[0, 0.1, 0]} rotation={[0, Math.PI / 2, 0]} getBlocked={() => false} getOutput={() => false} beamLength={0.6} postLength={0.088} />
      <PhotoEye42EF position={[0, 0.1, -0.55]} rotation={[0, Math.PI / 2, 0]} getBlocked={blocked} getOutput={blocked} beamLength={0.6} getBlockDistance={() => 0.2} postLength={0.088} />
      <MovingBox blocked={blocked} />
    </group>
  );
}

function MovingBox({ blocked }: { blocked: () => boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const u = now() % 3;
    // travels along Z through the rear beam (z = -0.55) while blocked() is true
    ref.current.position.z = -0.55 + (u - 1.95) * 0.35;
    ref.current.visible = u > 1.3 && u < 2.6;
    void blocked;
  });
  return (
    <group ref={ref} position={[0.3, 0, -0.55]} rotation={[0, Math.PI / 2, 0]}>
      <CardboardBox />
    </group>
  );
}

function MotorOverload() {
  return <Motor frame="medium" getRpm={() => 150} getOverloaded={() => true} />;
}

function ConveyorPowder() {
  const pos = () => now() * 0.4;
  return (
    <group position={[-1, 0, 0]}>
      <Conveyor length={2} width={0.45} height={0.75} getBeltPosition={pos} frameStyle="powder" frameColor="#2f5f8f" driveSide="front" />
      {/* boxes ride from the tail to 0.15 m before the head pulley, then start over */}
      <Boxes position={[0, 0.75, 0]} getBoxes={() => [{ x: 0.2 + (pos() % 1.5), tall: false, id: 1 }, { x: 0.2 + ((pos() + 0.75) % 1.5), tall: true, id: 2 }]} />
    </group>
  );
}

function PhotoEyeCloseup() {
  return <PhotoEye42EF position={[0, 0.2, 0]} getBlocked={() => false} getOutput={() => true} beamLength={0} postLength={0.19} />;
}

/** Axis height of an 872C whose bracket foot stands on a surface at y = 0. */
const proxAxis = (d: number) => 0.9 * d + 0.012 + 0.00125;

function ProxTarget({ x, z, get }: { x: number; z: number; get: () => boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const target = get() ? 0 : 0.035;
    g.position.x += (target - g.position.x) * Math.min(1, dt * 10);
  });
  return (
    <group position={[x, 0, z]}>
      <group ref={ref}>
        <mesh material={fm.steel()} position={[0, 0.03, 0]} castShadow>
          <boxGeometry args={[0.025, 0.035, 0.004]} />
        </mesh>
      </group>
    </group>
  );
}

const PROX_JB: Vec3 = [0, 0.19, -0.08];
const PROX_GLANDS = junctionBoxGlands([0.16, 0.1, 0.07], 3);
/** Cordset route from a sensor at x into gland i of the junction box (parent = preview coordinates). */
function proxRoute(i: number, x: number): CableRoute {
  const g = PROX_GLANDS[i]!;
  const to: Vec3 = [PROX_JB[0] + g[0], PROX_JB[1] + g[1], PROX_JB[2] + g[2]];
  return { to, via: [[x * 0.6 + to[0] * 0.4, to[1] - 0.075, to[2] + 0.02], [to[0], to[1] - 0.025, to[2]]] };
}

function ProxDemo() {
  const active = () => Math.floor(now() / 1.5) % 2 === 0;
  const plateTop = 0.02;
  return (
    <group>
      {/* aluminum machine plate */}
      <mesh material={fm.anodized('#aeb4b9')} position={[0, plateTop / 2, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.3, plateTop, 0.12]} />
      </mesh>
      <ProxSensor872C position={[0, plateTop + proxAxis(0.018), 0]} getActive={active} cableTo={proxRoute(1, 0)} />
      <ProxSensor872C position={[0.075, plateTop + proxAxis(0.012), 0]} getActive={() => !active()} diameter={0.012} cableTo={proxRoute(2, 0.075)} />
      <ProxSensor872C position={[-0.085, plateTop + proxAxis(0.03), 0]} getActive={() => true} diameter={0.03} cableTo={proxRoute(0, -0.085)} />
      {/* upright with the sensor junction box */}
      <mesh material={fm.anodized('#aeb4b9')} position={[0, 0.14, -0.085]} castShadow receiveShadow>
        <boxGeometry args={[0.3, 0.24, 0.01]} />
      </mesh>
      <JunctionBox position={PROX_JB} size={[0.16, 0.1, 0.07]} glands={3} label="JB-PX" />
      <ProxTarget x={0} z={0.006} get={active} />
      <ProxTarget x={0.075} z={0.004} get={() => !active()} />
      <mesh material={fm.steel()} position={[-0.085, plateTop + proxAxis(0.03), 0.012]} castShadow>
        <boxGeometry args={[0.045, 0.045, 0.004]} />
      </mesh>
    </group>
  );
}

const CYL_TABLE_TOP = 0.1525;
const CYL_MANIFOLD: Vec3 = [0.36, 0.25, -0.435];

/** MS1-style foot block under an end cap. */
function CylFoot({ x, z, width, bottom, depth }: { x: number; z: number; width: number; bottom: number; depth: number }) {
  return (
    <mesh material={fm.aluminum(0.45)} position={[x, (bottom + CYL_TABLE_TOP) / 2, z]} castShadow>
      <boxGeometry args={[width, bottom - CYL_TABLE_TOP, depth]} />
    </mesh>
  );
}

function CylinderExtending() {
  const ext = () => cycle(now());
  const ext2 = () => cycle(now() + 1.2);
  const c1: Vec3 = [0, 0.2, 0.1];
  const c2: Vec3 = [0.3, 0.19, 0.05];
  const p0 = manifoldPorts(CYL_MANIFOLD, 2, 0);
  const p1 = manifoldPorts(CYL_MANIFOLD, 2, 1);
  const table = fm.anodized('#aab0b5');
  return (
    <group>
      {/* machine table on four legs, upright panel with the valve manifold and a wiring duct */}
      <mesh material={table} position={[0.15, CYL_TABLE_TOP - 0.01, -0.185]} castShadow receiveShadow>
        <boxGeometry args={[0.56, 0.02, 0.55]} />
      </mesh>
      {[[-0.1, 0.06], [0.4, 0.06], [-0.1, -0.43], [0.4, -0.43]].map(([x, z]) => (
        <mesh key={`${x}:${z}`} material={table} position={[x!, (CYL_TABLE_TOP - 0.02) / 2, z!]} castShadow>
          <boxGeometry args={[0.03, CYL_TABLE_TOP - 0.02, 0.03]} />
        </mesh>
      ))}
      <mesh material={fm.plastic('#d9dbd8', 0.6)} position={[0.15, CYL_TABLE_TOP + 0.16, -0.445]} castShadow receiveShadow>
        <boxGeometry args={[0.56, 0.32, 0.01]} />
      </mesh>
      <WiringDuct position={[-0.1, CYL_TABLE_TOP + 0.24, -0.44]} length={0.52} />
      <SolenoidValve
        variant="pneumatic"
        position={CYL_MANIFOLD}
        stations={2}
        getEnergized={() => ext() > 0}
        getStation={(i) => i === 1 && ext2() > 0}
        portsTo={false}
        cableTo={{ to: [0.27, CYL_TABLE_TOP + 0.26, -0.425], via: [[0.28, CYL_MANIFOLD[1] + 0.09, -0.42]] }}
        tubeTo={{ to: [0.4, CYL_TABLE_TOP + 0.26, -0.425], via: [[0.43, CYL_MANIFOLD[1] + 0.09, -0.42]] }}
      />
      {/* Ø50 guided pusher and plain Ø32 on foot blocks; tubes to the manifold, reed leads tied to the blue tube */}
      <CylFoot x={c1[0]} z={c1[2] - 0.014} width={0.075} bottom={c1[1] - 0.0325} depth={0.028} />
      <CylFoot x={c1[0]} z={c1[2] - 0.392} width={0.075} bottom={c1[1] - 0.0325} depth={0.028} />
      <CylFoot x={c2[0]} z={c2[2] - 0.011} width={0.055} bottom={c2[1] - 0.0225} depth={0.022} />
      <CylFoot x={c2[0]} z={c2[2] - 0.233} width={0.055} bottom={c2[1] - 0.0225} depth={0.022} />
      <PneumaticCylinder
        position={c1}
        bore={0.05}
        stroke={0.3}
        getExtension={ext}
        getRetractedSensor={() => ext() < 0.02}
        getExtendedSensor={() => ext() > 0.98}
        pusher={[0.26, 0.14]}
        tubes={{ rear: sub(p0.a, c1), front: sub(p0.b, c1) }}
      />
      <PneumaticCylinder
        position={c2}
        bore={0.032}
        stroke={0.15}
        getExtension={ext2}
        getRetractedSensor={() => ext2() < 0.02}
        getExtendedSensor={() => ext2() > 0.98}
        tubes={{ rear: sub(p1.a, c2), front: sub(p1.b, c2) }}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Conveyor demo line (pure function of time — mirrors the conveyor-sort scene geometry)
// ---------------------------------------------------------------------------

const CV_LEN = 6;
const CV_W = 0.6;
const CV_H = 0.85;
const SPEED = 0.5;
const SPAWN = 1.6;
const DIVERT_X = 4.0;
const PUSH_T = 0.28;
const CHUTE_SLOPE_DEMO = Math.atan2(0.3, 0.42);

interface DemoState {
  t: number;
  boxes: BoxState[];
  pusher: number;
}
const demo: DemoState = { t: -1, boxes: Array.from({ length: 40 }, () => ({ x: 0, tall: false, visible: false })), pusher: 0 };
const isTall = (i: number) => i % 3 === 1;

function demoAt(t: number): DemoState {
  if (demo.t === t) return demo;
  demo.t = t;
  let n = 0;
  let pusher = 0;
  const first = Math.max(0, Math.floor((t - 16) / SPAWN));
  const last = Math.floor(t / SPAWN);
  for (let i = first; i <= last && n < demo.boxes.length; i++) {
    const age = t - i * SPAWN;
    const tall = isTall(i);
    const b = demo.boxes[n]!;
    b.tall = tall;
    b.id = i;
    b.visible = true;
    b.y = 0;
    b.z = 0;
    b.rotX = 0;
    b.rotY = ((i * 37) % 7) * 0.004 - 0.012;
    let x = 0.3 + age * SPEED;
    if (tall && x >= DIVERT_X) {
      const ta = (DIVERT_X - 0.3) / SPEED;
      const u = age - ta;
      x = DIVERT_X;
      // pusher stroke profile: extend 0.28 s, dwell 0.15 s, retract 0.3 s
      const p = u < PUSH_T ? u / PUSH_T : u < PUSH_T + 0.15 ? 1 : Math.max(0, 1 - (u - PUSH_T - 0.15) / 0.3);
      pusher = Math.max(pusher, p);
      const pushZ = Math.min(u / PUSH_T, 1) * 0.36;
      b.z = pushZ;
      if (u > PUSH_T) {
        // slide down the reject chute
        const v = Math.min((u - PUSH_T) / 0.9, 1);
        b.z = 0.36 + v * 0.42;
        b.y = -v * 0.3 - 0.004;
        b.rotX = Math.min(1, v * 4) * CHUTE_SLOPE_DEMO;
      }
      if (u > PUSH_T + 1.6) b.visible = false;
    } else if (x > CV_LEN + 0.2) {
      b.visible = false;
    }
    b.x = x;
    if (b.visible) n++;
  }
  for (let k = n; k < demo.boxes.length; k++) demo.boxes[k]!.visible = false;
  demo.pusher = pusher;
  return demo;
}

const lay = conveyorLayout(CV_W, CV_H);
function eyeBlocked(x: number, tallOnly: boolean) {
  const d = demoAt(now());
  for (const b of d.boxes) {
    if (!b.visible || (tallOnly && !b.tall)) continue;
    if (Math.abs((b.z ?? 0)) > 0.2 || (b.y ?? 0) < -0.01) continue;
    if (Math.abs(b.x - x) < BOX_SIZES.short.length / 2) return true;
  }
  return false;
}
function eyeBlockDist(x: number) {
  const d = demoAt(now());
  for (const b of d.boxes) {
    if (b.visible && Math.abs(b.x - x) < 0.15) return lay.frameZ - 0.03 - BOX_SIZES[b.tall ? 'tall' : 'short'].width / 2;
  }
  return 0.2;
}

function DemoEye({ x, beamY }: { x: number; beamY: number }) {
  const zEye = lay.frameZ - 0.03;
  const tallOnly = beamY > 0.25;
  const get = () => eyeBlocked(x, tallOnly);
  return (
    <PhotoEye42EF
      position={[x, CV_H + beamY, zEye]}
      rotation={[0, Math.PI, 0]}
      getBlocked={get}
      getOutput={get}
      getBlockDistance={() => eyeBlockDist(x)}
      beamLength={2 * zEye}
      postLength={CV_H + beamY - lay.frameTop - 0.006}
    />
  );
}

const REAR_POST_Z = -(lay.frameOuterZ + 0.045) - 0.63;
const PV_POS: Vec3 = [DIVERT_X - 0.16, 0.45, REAR_POST_Z + 0.029];

const CHUTE_SLOPE = Math.atan2(0.3, 0.42);
const CHUTE_LEN = 0.62;
const CHUTE_HALF = 0.24;

function chuteWallGeo() {
  return geo('chuteWall', () => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(CHUTE_LEN, 0);
    sh.lineTo(CHUTE_LEN, 0.12);
    sh.lineTo(0.02, 0.004);
    sh.lineTo(0, 0.004);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.003, bevelEnabled: false });
    g.rotateY(-Math.PI / 2);
    return g;
  });
}

/** Folded stainless reject chute: sloped tray, tapered side walls, end lip; +Z away from the belt. */
function RejectChute() {
  const ss = fm.stainless(0.35);
  const top: Vec3 = [DIVERT_X, CV_H - 0.006, lay.frameOuterZ + 0.004];
  const endY = top[1] - CHUTE_LEN * Math.sin(CHUTE_SLOPE);
  const endZ = top[2] + CHUTE_LEN * Math.cos(CHUTE_SLOPE);
  return (
    <Merge>
      <group position={top} rotation={[CHUTE_SLOPE, 0, 0]}>
        {/* tray: local +Z runs down the slope, +Y is the tray normal */}
        <mesh material={ss} position={[0, -0.0015, CHUTE_LEN / 2]} castShadow receiveShadow>
          <boxGeometry args={[2 * CHUTE_HALF, 0.003, CHUTE_LEN]} />
        </mesh>
        {[-1, 1].map((sx) => (
          <mesh key={sx} geometry={chuteWallGeo()} material={ss} position={[sx * CHUTE_HALF + (sx > 0 ? 0.003 : 0), 0, 0]} castShadow />
        ))}
        {/* lip at the lower end */}
        <mesh material={ss} position={[0, 0.02, CHUTE_LEN + 0.0015]} castShadow>
          <boxGeometry args={[2 * CHUTE_HALF + 0.006, 0.04, 0.003]} />
        </mesh>
        {/* hanger plate bolted to the side-frame T-slot */}
        <mesh material={ss} position={[0, -0.03, -0.002]} rotation={[-CHUTE_SLOPE, 0, 0]}>
          <boxGeometry args={[0.3, 0.06, 0.004]} />
        </mesh>
      </group>
      {[-0.12, 0.12].map((dx) => (
        <CapScrewLite key={dx} position={[DIVERT_X + dx, top[1] - 0.035, top[2] + 0.002]} />
      ))}
      {[-1, 1].map((sx) => (
        <mesh key={sx} material={ss} position={[DIVERT_X + sx * (CHUTE_HALF - 0.03), (endY - 0.02) / 2, endZ - 0.06]} castShadow>
          <boxGeometry args={[0.03, endY - 0.02, 0.03]} />
        </mesh>
      ))}
    </Merge>
  );
}

function CapScrewLite({ position }: { position: Vec3 }) {
  return (
    <mesh material={fm.blackSteel()} position={position} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.005, 0.005, 0.005, 12]} />
    </mesh>
  );
}

function ConveyorWithBoxes() {
  const beltPos = () => now() * SPEED;
  const pusherExt = () => demoAt(now()).pusher;
  const cylZ = -(lay.frameOuterZ + 0.045);
  const cylPos: Vec3 = [DIVERT_X, CV_H + 0.1, cylZ];
  const pv = manifoldPorts(PV_POS, 2, 0);
  return (
    <group position={[-CV_LEN / 2, 0, 0]}>
      <Conveyor
        length={CV_LEN}
        width={CV_W}
        height={CV_H}
        getBeltPosition={beltPos}
        guideGaps={[
          { from: DIVERT_X - 0.2, to: DIVERT_X + 0.2, side: 'back' },
          { from: DIVERT_X - 0.26, to: DIVERT_X + 0.26, side: 'front' },
        ]}
      />
      <Boxes position={[0, CV_H, 0]} getBoxes={() => demoAt(now()).boxes} />
      <DemoEye x={0.9} beamY={0.1} />
      <DemoEye x={2.5} beamY={0.3} />
      <DemoEye x={DIVERT_X - 0.36} beamY={0.1} />
      <DemoEye x={5.8} beamY={0.1} />
      {/* pusher on the back side: front support on the frame, rear post carrying the valve manifold */}
      <PneumaticCylinder
        position={[DIVERT_X, CV_H + 0.1, cylZ]}
        bore={0.05}
        stroke={0.55}
        getExtension={pusherExt}
        getRetractedSensor={() => pusherExt() < 0.02}
        getExtendedSensor={() => pusherExt() > 0.98}
        pusher={[0.3, 0.15]}
        tubes={{ rear: sub(pv.a, cylPos), front: sub(pv.b, cylPos) }}
      />
      <mesh material={fm.anodized('#c2c7cc')} position={[DIVERT_X, (CV_H + 0.1 - 0.075) / 2, cylZ - 0.06]} castShadow>
        <boxGeometry args={[0.045, CV_H + 0.1 - 0.075, 0.045]} />
      </mesh>
      <mesh material={fm.anodized('#c2c7cc')} position={[DIVERT_X, CV_H + 0.1 - 0.0725 - 0.0025, cylZ - 0.03]} castShadow>
        <boxGeometry args={[0.2, 0.01, 0.12]} />
      </mesh>
      <mesh material={fm.anodized('#c2c7cc')} position={[DIVERT_X, (CV_H + 0.1 - 0.0325) / 2, REAR_POST_Z]} castShadow>
        <boxGeometry args={[0.045, CV_H + 0.1 - 0.0325, 0.045]} />
      </mesh>
      <mesh material={fm.aluminum(0.45)} position={[DIVERT_X, CV_H + 0.1 - 0.0325 - 0.006, REAR_POST_Z + 0.012]} castShadow>
        <boxGeometry args={[0.08, 0.012, 0.07]} />
      </mesh>
      <mesh material={fm.plastic('#d9dbd8', 0.6)} position={[DIVERT_X - 0.14, 0.52, REAR_POST_Z + 0.026]} castShadow>
        <boxGeometry args={[0.26, 0.3, 0.006]} />
      </mesh>
      <SolenoidValve
        variant="pneumatic"
        position={PV_POS}
        stations={2}
        getEnergized={() => pusherExt() > 0 && pusherExt() < 1}
        portsTo={false}
      />
      {/* reject chute on the front side: folded tray (walls stay below the belt line) with a lip, bolted to the
          side frame and standing on two legs */}
      <RejectChute />
    </group>
  );
}

function BoxesDemo() {
  return (
    <group>
      <CardboardBox position={[-0.2, 0, 0]} />
      <CardboardBox tall position={[0.2, 0, 0]} rotation={[0, -0.4, 0]} />
      <CardboardBox position={[-0.2, 0.2, 0]} rotation={[0, 0.3, 0]} />
    </group>
  );
}

/** Pipe support: square post from the floor with a saddle and a U-bolt around the pipe (pipe along X). */
function PipeSupport({ x, y, pr }: { x: number; y: number; pr: number }) {
  const h = y - pr - 0.006;
  return (
    <Merge>
      <mesh material={fm.sheet('#4a5056', 0.5)} position={[x, h / 2, 0]} castShadow>
        <boxGeometry args={[0.03, h, 0.03]} />
      </mesh>
      <mesh material={fm.sheet('#4a5056', 0.5)} position={[x, 0.003, 0]} receiveShadow>
        <boxGeometry args={[0.1, 0.006, 0.1]} />
      </mesh>
      <mesh material={fm.sheet('#4a5056', 0.5)} position={[x, h + 0.003, 0]}>
        <boxGeometry args={[0.04, 0.006, 0.1]} />
      </mesh>
      <mesh material={fm.zinc()} position={[x, y, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[pr + 0.004, 0.003, 8, 20, Math.PI]} />
      </mesh>
    </Merge>
  );
}

const VM_POS: Vec3 = [0.62, 0.13, 0];

function ValvesDemo() {
  const on = () => Math.floor(now() / 2.5) % 2 === 0;
  const ports = manifoldPorts(VM_POS, 4, 0);
  const duct = (x: number): Vec3 => [x, 0.055, 0.018];
  return (
    <group>
      <SolenoidValve variant="process" position={[-0.25, 0.25, 0]} getEnergized={on} tag="XV-101" />
      <SolenoidValve variant="process" position={[0.25, 0.25, 0]} getEnergized={() => !on()} tag="XV-102" pipeDiameter={0.0483} />
      {[-0.45, -0.05].map((x) => (
        <PipeSupport key={x} x={x} y={0.25} pr={0.0603 / 2} />
      ))}
      {[0.05, 0.45].map((x) => (
        <PipeSupport key={x} x={x} y={0.25} pr={0.0483 / 2} />
      ))}
      {/* valve panel: manifold, wiring duct taking the multicore, supply and A/B tubes */}
      <mesh position={[0.62, 0.2, -0.006]} castShadow receiveShadow>
        <boxGeometry args={[0.24, 0.4, 0.012]} />
        <meshStandardMaterial color="#e3e5e2" roughness={0.6} />
      </mesh>
      <WiringDuct position={[0.51, 0.03, 0]} length={0.22} />
      <SolenoidValve
        variant="pneumatic"
        position={VM_POS}
        getEnergized={on}
        getStation={(i) => i === 2 && !on()}
        getManualOverride={() => Math.floor(now() / 1.3) % 4 === 3}
        cableTo={{ to: duct(0.535), via: [[0.53, 0.15, 0.016]] }}
        tubeTo={{ to: duct(0.705), via: [[0.712, 0.15, 0.018]] }}
        portsTo={{ a: { to: [ports.a[0] - 0.004, 0.055, 0.012] }, b: { to: [ports.b[0] + 0.004, 0.055, 0.022] } }}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Tank
// ---------------------------------------------------------------------------

const tankLevel = () => 65 + 3 * Math.sin(now() / 5);
const tankTemp = () => 48 + 22 * Math.sin(now() / 9);
const TL = tankLayout(1.3, 1.25);

// instrument junction box on a unistrut stand beside the tank (+X side)
const TJB_POS: Vec3 = [1.02, 1.12, 0.32];
const TJB_SIZE: Vec3 = [0.26, 0.2, 0.1];
const TJB_GLANDS = junctionBoxGlands(TJB_SIZE, 6).map((g): Vec3 => [TJB_POS[0] + g[0], TJB_POS[1] + g[1], TJB_POS[2] + g[2]]);
/** Route (in the nozzle frame) from an instrument into JB gland `i`, through tank-coordinate via points. */
function jbRoute(n: TankNozzle, i: number, via: Vec3[]): CableRoute {
  const g = TJB_GLANDS[i]!;
  const pts = [...via, [g[0], g[1] - 0.09, g[2] + 0.01] as Vec3, [g[0], g[1] - 0.03, g[2]] as Vec3];
  return { to: nozzleLocal(n, g), via: pts.map((p) => nozzleLocal(n, p)) };
}

function TankMixing({ cutaway = true }: { cutaway?: boolean }) {
  const n = TL.nozzles;
  const inlet = n.inlet.position;
  const out = n.outlet.position;
  const riserX = -1.05;
  const xv1: Vec3 = [-0.78, inlet[1] + 0.22, inlet[2]];
  const gx = TJB_POS[0];
  return (
    <group>
      <Tank getLevel={tankLevel} getTemperature={tankTemp} getAgitatorRpm={() => 70} getHeaterOn={() => tankTemp() < 60} cutaway={cutaway} />
      <OnNozzle nozzle={n.lt}>
        <LevelTransmitter
          getValue={tankLevel}
          units="%"
          tagLabel="LT-101"
          getBeamLength={() => n.lt.position[1] - TL.levelY(tankLevel())}
          cableTo={jbRoute(n.lt, 0, [
            [0.52, n.lt.position[1] + 0.12, -0.2],
            [TL.radius + 0.1, TL.yT2 + 0.05, 0.05],
            [TL.radius + 0.12, TL.yT2 - 0.3, 0.2],
            [gx - 0.16, TJB_POS[1] + 0.1, 0.34],
            [gx - 0.16, TJB_POS[1] - 0.14, 0.36],
          ])}
        />
      </OnNozzle>
      <OnNozzle nozzle={n.tt}>
        <TempTransmitter getValue={tankTemp} units="°C" tagLabel="TT-101" cableTo={jbRoute(n.tt, 4, [[0.66, n.tt.position[1] - 0.12, 0.62], [gx + 0.04, TJB_POS[1] - 0.2, 0.4]])} />
      </OnNozzle>
      <OnNozzle nozzle={n.lsl}>
        <LevelSwitch getActive={() => tankLevel() >= 10} cableTo={jbRoute(n.lsl, 3, [[0.86, n.lsl.position[1] + 0.05, 0.12], [gx - 0.02, TJB_POS[1] - 0.26, 0.3]])} />
      </OnNozzle>
      <OnNozzle nozzle={n.lsh}>
        <LevelSwitch
          getActive={() => tankLevel() >= 90}
          cableTo={jbRoute(n.lsh, 1, [
            [0.84, n.lsh.position[1] - 0.02, 0.14],
            [gx - 0.17, TJB_POS[1] + 0.2, 0.3],
            [gx - 0.17, TJB_POS[1] - 0.12, 0.34],
          ])}
        />
      </OnNozzle>
      <OnNozzle nozzle={n.lshh}>
        <LevelSwitch
          getActive={() => tankLevel() < 97}
          cableTo={jbRoute(n.lshh, 2, [
            [0.84, n.lshh.position[1] - 0.02, 0.06],
            [gx - 0.185, TJB_POS[1] + 0.25, 0.28],
            [gx - 0.185, TJB_POS[1] - 0.12, 0.33],
          ])}
        />
      </OnNozzle>
      {/* junction box on a unistrut post with a base plate; multicore down into a floor stub */}
      <mesh material={fm.zinc()} position={[gx, 0.7, TJB_POS[2] - 0.022]} castShadow>
        <boxGeometry args={[0.041, 1.4, 0.041]} />
      </mesh>
      <mesh material={fm.zinc()} position={[gx, 0.005, TJB_POS[2] - 0.022]} receiveShadow>
        <boxGeometry args={[0.16, 0.01, 0.16]} />
      </mesh>
      <JunctionBox position={TJB_POS} size={TJB_SIZE} glands={6} label="JB-101" />
      <FieldCable radius={0.007} color={CABLE_GRAY} points={[TJB_GLANDS[5]!, [TJB_GLANDS[5]![0], TJB_GLANDS[5]![1] - 0.12, TJB_GLANDS[5]![2]], [gx + 0.16, 0.4, TJB_POS[2] + 0.12], [gx + 0.18, STUB_TOP + 0.05, TJB_POS[2] + 0.14], [gx + 0.18, STUB_TOP - 0.004, TJB_POS[2] + 0.14]]} />
      <ConduitStub visible position={[gx + 0.18, STUB_TOP, TJB_POS[2] + 0.14]} />
      {/* inlet line with fill valve XV-101 */}
      <PipeRun
        points={[
          inlet,
          [inlet[0], inlet[1] + 0.22, inlet[2]],
          [riserX, inlet[1] + 0.22, inlet[2]],
          [riserX, 0.02, inlet[2]],
        ]}
        diameter={0.0483}
        flangesAt={[0]}
      />
      <SolenoidValve
        variant="process"
        position={xv1}
        getEnergized={() => Math.floor(now() / 4) % 2 === 0}
        tag="XV-101"
        pipeDiameter={0.0483}
        pipeStubs={0}
        cableTo={{ to: [riserX + 0.06, STUB_TOP - 0.004, inlet[2] + 0.07], via: [[xv1[0] - 0.08, xv1[1] - 0.12, inlet[2] + 0.07], [riserX + 0.06, xv1[1] - 0.3, inlet[2] + 0.07], [riserX + 0.06, 0.6, inlet[2] + 0.07], [riserX + 0.06, STUB_TOP + 0.06, inlet[2] + 0.07]] }}
        tubeTo={{ to: [riserX + 0.06, STUB_TOP - 0.004, inlet[2] - 0.07], via: [[xv1[0] + 0.05, xv1[1] - 0.1, inlet[2] + 0.02], [riserX + 0.06, xv1[1] - 0.32, inlet[2] - 0.07], [riserX + 0.06, 0.6, inlet[2] - 0.07], [riserX + 0.06, STUB_TOP + 0.06, inlet[2] - 0.07]] }}
      />
      <ConduitStub visible position={[riserX + 0.06, STUB_TOP, inlet[2] + 0.07]} />
      <ConduitStub visible position={[riserX + 0.06, STUB_TOP, inlet[2] - 0.07]} />
      {/* riser clamps holding the cable & tube */}
      {[1.0, 1.8].map((y) => (
        <mesh key={y} material={fm.plastic('#1c1d20', 0.5)} position={[riserX + 0.03, y, inlet[2]]} castShadow>
          <boxGeometry args={[0.09, 0.025, 0.18]} />
        </mesh>
      ))}
      {/* bottom outlet with drain valve XV-102 */}
      <PipeRun
        points={[
          out,
          [out[0], 0.24, out[2]],
          [1.05, 0.24, out[2]],
          [1.05, 0.02, out[2]],
        ]}
        diameter={0.0603}
        flangesAt={[0]}
      />
      <SolenoidValve variant="process" position={[0.5, 0.24, 0]} getEnergized={() => false} tag="XV-102" pipeStubs={0} />
      <Flange position={[1.05, 0.02, 0]} diameter={0.0603} />
      {!cutaway && <SightGlass position={[Math.sin(-0.5) * 0.66, TL.yT1 + 0.05, Math.cos(-0.5) * 0.66]} rotation={[0, -0.5, 0]} height={1.1} getLevel={tankLevel} liquidColor={TANK_LIQUID_COLOR} />}
    </group>
  );
}

const IJB_POS: Vec3 = [0.08, 0.3, -0.22];
const IJB_SIZE: Vec3 = [0.26, 0.16, 0.09];
const IJB_GLANDS = junctionBoxGlands(IJB_SIZE, 4).map((g): Vec3 => [IJB_POS[0] + g[0], IJB_POS[1] + g[1], IJB_POS[2] + g[2]]);
function ijbRoute(i: number, via: Vec3[]): CableRoute {
  const g = IJB_GLANDS[i]!;
  return { to: g, via: [...via, [g[0], g[1] - 0.07, g[2] + 0.02], [g[0], g[1] - 0.025, g[2]]] };
}

function InstrumentsDemo() {
  const lvl = () => 50 + 40 * Math.sin(now() / 3);
  return (
    <group>
      <LevelTransmitter position={[-0.25, 0.25, 0]} getValue={lvl} units="%" tagLabel="LT-101" getBeamLength={() => 0.35 + 0.15 * Math.sin(now() / 3)} cableTo={ijbRoute(0, [[-0.37, 0.3, -0.06], [-0.2, 0.12, -0.14]])} />
      <LevelTransmitter position={[0.0, 0.25, 0]} getValue={() => 1.234 + 0.2 * Math.sin(now())} units="m" tagLabel="LT-102" antenna="horn" decimals={3} range={[0, 2]} getBeamLength={() => 0.42} cableTo={ijbRoute(1, [[-0.12, 0.3, -0.06], [0.0, 0.12, -0.13]])} />
      <TempTransmitter position={[0.22, 0.25, 0]} getValue={() => 72.4 + Math.sin(now() / 2)} units="°C" tagLabel="TT-101" cableTo={ijbRoute(2, [[0.13, 0.36, -0.05], [0.14, 0.13, -0.13]])} />
      <LevelSwitch position={[0.4, 0.12, 0]} getActive={() => Math.floor(now() / 2) % 2 === 0} cableTo={ijbRoute(3, [[0.4, 0.33, -0.06], [0.24, 0.12, -0.13]])} />
      {/* junction box on a post */}
      <mesh material={fm.zinc()} position={[IJB_POS[0], (IJB_POS[1] + 0.08) / 2, IJB_POS[2] - 0.02]} castShadow>
        <boxGeometry args={[0.041, IJB_POS[1] + 0.08, 0.041]} />
      </mesh>
      <mesh material={fm.zinc()} position={[IJB_POS[0], 0.005, IJB_POS[2] - 0.02]} receiveShadow>
        <boxGeometry args={[0.14, 0.01, 0.14]} />
      </mesh>
      <JunctionBox position={IJB_POS} size={IJB_SIZE} glands={4} label="JB-102" />
    </group>
  );
}

export const previews: Record<string, Preview> = {
  FIELD_Motor_Running: {
    Component: MotorRunning,
    description: '5 HP 184T TEFC motor, shaft & fan turning',
    camera: { position: [0.55, 0.38, 0.62], target: [0, 0.11, 0] },
  },
  FIELD_Motor_Overload: {
    Component: MotorOverload,
    description: 'Overloaded motor: hot glow + vibration',
    camera: { position: [0.55, 0.38, 0.62], target: [0, 0.11, 0] },
  },
  FIELD_Conveyor_Powder: {
    Component: ConveyorPowder,
    description: '2 m powder-coated conveyor, drive on the front side',
    camera: { position: [1.4, 1.5, 2.2], target: [0, 0.55, 0] },
  },
  FIELD_Motor_Frames: {
    Component: MotorFrames,
    description: 'small / medium / large frames (large overload glow every 3 s)',
    camera: { position: [0.9, 0.7, 1.4], target: [0.05, 0.12, 0] },
  },
  FIELD_PhotoEye_Beam: {
    Component: PhotoEyeBeam,
    description: '42EF photo-eyes with retro-reflectors; rear beam blocked by a passing box every 3 s',
    camera: { position: [0.75, 0.55, 0.95], target: [0.28, 0.08, -0.28] },
  },
  FIELD_PhotoEye_Closeup: {
    Component: PhotoEyeCloseup,
    description: '42EF RightSight close-up (output LED on)',
    camera: { position: [0.07, 0.24, 0.1], target: [0, 0.19, -0.01] },
  },
  FIELD_Prox: {
    Component: ProxDemo,
    description: '872C M18 / M12 / M30 inductive proximity sensors with LED ring',
    camera: { position: [0.16, 0.14, 0.2], target: [0, 0.055, -0.03] },
  },
  FIELD_Cylinder_Extending: {
    Component: CylinderExtending,
    description: 'ISO 15552 cylinders: guided pusher (Ø50 x 300) and plain Ø32',
    camera: { position: [0.85, 0.6, 0.9], target: [0.1, 0.15, -0.12] },
  },
  FIELD_Conveyor_WithBoxes: {
    Component: ConveyorWithBoxes,
    description: '6 m belt conveyor: boxes, 42EF photo-eyes, pusher & reject chute, gear motor drive',
    camera: { position: [1.2, 2.7, 6.2], target: [0.2, 0.55, 0] },
  },
  FIELD_Boxes: {
    Component: BoxesDemo,
    description: 'Short and tall cardboard boxes',
    camera: { position: [0.55, 0.5, 0.8], target: [0, 0.15, 0] },
  },
  FIELD_Valves: {
    Component: ValvesDemo,
    description: 'Actuated ball valves (XV-101 open / XV-102 shut, toggling) + 5/2 valve manifold',
    camera: { position: [0.55, 0.6, 1.25], target: [0.15, 0.2, 0] },
  },
  FIELD_Tank_Mixing: {
    Component: () => <TankMixing />,
    description: '2000 L mixing tank, quarter cut-away, level ~65 %, agitator running, instruments on nozzles',
    camera: { position: [3.2, 3.1, 5.0], target: [0, 1.5, 0] },
  },
  FIELD_Tank_Window: {
    Component: () => <TankMixing cutaway={false} />,
    description: 'Tank variant with a full-height sight window and tubular sight glass',
    camera: { position: [2.0, 2.6, 4.4], target: [0, 1.35, 0] },
  },
  FIELD_Instruments: {
    Component: InstrumentsDemo,
    description: 'Radar LT (lens / horn), RTD temperature transmitter, vibrating fork level switch',
    camera: { position: [0.3, 0.5, 1.15], target: [0.06, 0.22, 0] },
  },
  FIELD_GearMotor: {
    Component: GearMotorDemo,
    description: 'Right-angle helical-bevel gear motor',
    camera: { position: [0.3, 0.55, 0.75], target: [-0.12, 0.3, 0.08] },
  },
};
