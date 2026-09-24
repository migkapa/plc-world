/**
 * `traffic-light` 3D view — a four-way city intersection (Main St NS × Logix Ave EW): galvanized
 * mast-arm poles with 12" LED heads (far-side, two per approach), countdown pedestrian heads and APS push
 * buttons on the north crosswalk (click them = `ped`), inductive loops on both side-street approaches
 * (they glow while a car is detected), cars (instanced fleet) and pedestrians animated from the scene
 * state, crash effects on signal conflicts, the roadside controller cabinet with the live CompactLogix
 * rack + NIGHT FLASH key switch (`night`), and a city block around it.
 *
 * The view never ticks the runtime: it reads `state` in useFrame and writes controls via runtime.setControl.
 */
import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { sfx } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import {
  CarFleet,
  InductiveLoopMarking,
  mastArmHeightForClearance,
  Pedestrian,
  PedestrianPushButton,
  PedestrianSignal,
  poleRadiusAt,
  SignalPole,
  TrafficSignalHead,
  type CarInstance,
  type MastArmSpec,
} from '../../../twin/devices';
import type { SceneViewProps, SimRuntime } from '../../types';
import { audioAllowed, canvasTexture, IoTag, ioLine, kgeo, kmat, TagLayer, useSfxLoops } from '../trainer/kit';
import { TrafficCabinet } from './cabinet';
import { useLatest } from './cityKit';
import { CABINET, OCCLUDERS, PARKED_CARS, ROAD, TrafficEnvironment } from './environment';
import { TRAFFIC_GEOMETRY as G, type Approach, type Pedestrian as PedState, type TrafficLightState } from './logic';

type P = SceneViewProps<TrafficLightState>;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Front-bumper path coordinate of the stop line (same as the logic). */
const STOP_S = G.approachDist - G.stopLineDist;
const LOOP_CENTER = G.stopLineDist + 0.45 + G.loopLength / 2;

/** Approach geometry (mirrors the logic's pose helper without allocating). */
const APP: Record<Approach, { dx: number; dz: number; ox: number; oz: number; yaw: number }> = {
  NB: { dx: 0, dz: -1, ox: G.laneOffset, oz: 0, yaw: Math.PI / 2 },
  SB: { dx: 0, dz: 1, ox: -G.laneOffset, oz: 0, yaw: -Math.PI / 2 },
  EB: { dx: 1, dz: 0, ox: 0, oz: G.laneOffset, yaw: 0 },
  WB: { dx: -1, dz: 0, ox: 0, oz: -G.laneOffset, yaw: Math.PI },
};

const POLE = ROAD.pole;
const ARM = { length: 7.4, heads: [3.2, 5.1] as const };
const ARM_H = mastArmHeightForClearance({ clearance: 5.03, at: ARM.heads[0], length: ARM.length, baseElevation: ROAD.curb });
/** Approximate head centre height above the road (for tag boxes). */
const HEAD_Y = 5.03 + 0.62;

/** An EW car waiting on its approach's loop (same test as the logic's detector). */
function loopOccupied(state: TrafficLightState, approach: Approach): boolean {
  for (const c of state.cars) {
    if (c.approach !== approach || c.state === 'crashed' || c.speed >= 1) continue;
    if (c.s <= STOP_S + 0.5 && c.s >= STOP_S - G.loopLength) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Signal poles, heads and pedestrian devices
// ---------------------------------------------------------------------------

function useLampGetters(state: TrafficLightState) {
  return useMemo(() => {
    const L = state.lamps;
    return {
      nsR: () => L.nsRed,
      nsY: () => L.nsYellow,
      nsG: () => L.nsGreen,
      ewR: () => L.ewRed,
      ewY: () => L.ewYellow,
      ewG: () => L.ewGreen,
      walk: () => L.walk,
      dw: () => L.dontWalk,
    };
  }, [state]);
}

/**
 * Countdown display: like real countdown pedestrian modules, it learns the length of the flashing
 * DON'T WALK interval of the previous cycle and counts it down (blank on the first cycle).
 */
function usePedCountdown(state: TrafficLightState) {
  const s = useRef({ prevWalk: false, prevDw: false, t0: -1, lastRise: 0, steadySince: 0, learned: 0, counting: false });
  return useMemo(
    () => () => {
      const k = s.current;
      const now = state.timeMs;
      const walk = state.lamps.walk;
      const dw = state.lamps.dontWalk;
      if (k.prevWalk && !walk) {
        k.t0 = now;
        k.counting = true;
      }
      if (walk) k.counting = false;
      if (dw && !k.prevDw) {
        k.lastRise = now;
        k.steadySince = now;
      }
      if (k.counting && dw && now - k.steadySince > 1300) {
        // DON'T WALK went steady: the clearance interval ended at its last rising edge
        k.learned = (k.lastRise - k.t0) / 1000;
        k.counting = false;
      }
      k.prevWalk = walk;
      k.prevDw = dw;
      if (!k.counting || k.learned <= 0) return null;
      const left = Math.ceil(k.learned - (now - k.t0) / 1000);
      return left > 0 ? left : null;
    },
    [state],
  );
}

function Signals({ state, runtime }: P) {
  const g = useLampGetters(state);
  const countdown = usePedCountdown(state);
  const pedPressed = useMemo(() => () => runtime.getControl('ped') === true, [runtime]);
  const pedLit = useMemo(
    () => () => {
      for (const p of state.pedestrians) if (p.state === 'waiting') return true;
      return runtime.getControl('ped') === true;
    },
    [state, runtime],
  );
  const press = useMemo(
    () => ({
      onPress: () => {
        runtime.setControl('ped', true);
        sfx.play('press');
      },
      onRelease: () => {
        runtime.setControl('ped', false);
        sfx.play('beep');
      },
    }),
    [runtime],
  );
  const night = () => runtime.getControl('night') === true;
  const head = (road: 'ns' | 'ew') =>
    road === 'ns' ? <TrafficSignalHead getRed={g.nsR} getYellow={g.nsY} getGreen={g.nsG} /> : <TrafficSignalHead getRed={g.ewR} getYellow={g.ewY} getGreen={g.ewG} />;
  const arm = (angle: number, road: 'ns' | 'ew'): MastArmSpec => ({
    length: ARM.length,
    angle,
    height: ARM_H,
    streetSign: { at: 6.4, text: road === 'ns' ? 'LOGIX AVE' : 'MAIN ST', width: 1.6 },
    attachments: ARM.heads.map((at) => ({ at, node: head(road), flip: true })),
  });
  const pedHead = <PedestrianSignal getWalk={g.walk} getDontWalk={g.dw} getCountdown={countdown} />;
  const button = (arrow: 'left' | 'right') => (
    <PedestrianPushButton mount="none" poleRadius={poleRadiusAt(1.1)} arrow={arrow} getPressed={pedPressed} getLit={pedLit} onPress={press.onPress} onRelease={press.onRelease} />
  );
  const L = (a: string) => ioLine(runtime, a);
  const nsLines = [L('NS_Red'), L('NS_Yellow'), L('NS_Green')];
  const ewLines = [L('EW_Red'), L('EW_Yellow'), L('EW_Green')];
  const pedLines = [L('Walk'), L('Dont_Walk')];
  /** Tag box around the two heads of an arm (arm heading `a` from a pole at x, z). */
  const headTag = (x: number, z: number, a: number, lines: typeof nsLines, title: string) => {
    const mid = (ARM.heads[0] + ARM.heads[1]) / 2;
    return (
      <IoTag
        position={[x + Math.cos(a) * mid, HEAD_Y, z - Math.sin(a) * mid]}
        rotation={[0, a, 0]}
        size={[ARM.heads[1] - ARM.heads[0] + 0.8, 1.45, 0.7]}
        anchor={[0, 0.95, 0]}
        title={title}
        lines={lines}
      />
    );
  };
  return (
    <group>
      {/* NE: NB heads (arm west) + ped head facing the NW corner + push button */}
      <SignalPole
        position={[POLE, ROAD.curb, -POLE]}
        poleId="NE-1"
        arms={[arm(Math.PI, 'ns')]}
        luminaire={{ angle: Math.PI, getLit: night }}
        attachments={[
          { height: 3.0, angle: -Math.PI / 2, node: pedHead },
          { height: 0.95, angle: 0, bands: false, node: button('left') },
        ]}
      />
      {/* SW: SB heads (arm east) */}
      <SignalPole position={[-POLE, ROAD.curb, POLE]} poleId="SW-3" arms={[arm(0, 'ns')]} luminaire={{ angle: 0, getLit: night }} />
      {/* SE: EB heads (arm north) */}
      <SignalPole position={[POLE, ROAD.curb, POLE]} poleId="SE-2" arms={[arm(Math.PI / 2, 'ew')]} />
      {/* NW: WB heads (arm south) + ped head facing the NE corner + push button */}
      <SignalPole
        position={[-POLE, ROAD.curb, -POLE]}
        poleId="NW-4"
        arms={[arm(-Math.PI / 2, 'ew')]}
        attachments={[
          { height: 3.0, angle: Math.PI / 2, node: <PedestrianSignal getWalk={g.walk} getDontWalk={g.dw} getCountdown={countdown} /> },
          { height: 0.95, angle: 0, bands: false, node: button('right') },
        ]}
      />
      {headTag(POLE, -POLE, Math.PI, nsLines, 'Main street heads (northbound)')}
      {headTag(-POLE, POLE, 0, nsLines, 'Main street heads (southbound)')}
      {headTag(POLE, POLE, Math.PI / 2, ewLines, 'Side street heads (eastbound)')}
      {headTag(-POLE, -POLE, -Math.PI / 2, ewLines, 'Side street heads (westbound)')}
      {/* ped heads (3.0 m on the pole, facing across the crosswalk) */}
      <IoTag position={[POLE - 0.45, ROAD.curb + 3.0, -POLE]} size={[0.35, 0.55, 0.55]} anchor={[0, 0.4, 0]} title="Pedestrian signal (NE pole)" lines={pedLines} />
      <IoTag position={[-POLE + 0.45, ROAD.curb + 3.0, -POLE]} size={[0.35, 0.55, 0.55]} anchor={[0, 0.4, 0]} title="Pedestrian signal (NW pole)" lines={pedLines} />
      {/* push buttons (0.95 m, south face of the NE / NW poles) */}
      {[POLE, -POLE].map((x) => (
        <IoTag key={x} position={[x, ROAD.curb + 1.1, -POLE + 0.3]} size={[0.2, 0.45, 0.2]} anchor={[0, 0.35, 0]} title="Pedestrian push button (N.O.)" lines={[L('Ped_PB')]} />
      ))}
    </group>
  );
}

function Loops({ state, runtime }: P) {
  const eb = useMemo(() => () => loopOccupied(state, 'EB'), [state]);
  const wb = useMemo(() => () => loopOccupied(state, 'WB'), [state]);
  const line = [ioLine(runtime, 'Car_Sensor_EW')];
  return (
    <group>
      <InductiveLoopMarking position={[-LOOP_CENTER, 0, G.laneOffset]} length={G.loopLength} width={1.8} leadIn={0.85} getActive={eb} hint="strong" />
      <InductiveLoopMarking position={[LOOP_CENTER, 0, -G.laneOffset]} rotation={[0, Math.PI, 0]} length={G.loopLength} width={1.8} leadIn={0.85} getActive={wb} hint="strong" />
      <IoTag position={[-LOOP_CENTER, 0.1, G.laneOffset]} size={[G.loopLength, 0.25, 1.9]} anchor={[0, 0.4, 0]} title="Loop detector, eastbound stop line" lines={line} />
      <IoTag position={[LOOP_CENTER, 0.1, -G.laneOffset]} size={[G.loopLength, 0.25, 1.9]} anchor={[0, 0.4, 0]} title="Loop detector, westbound stop line" lines={line} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

const MAX_CARS = 48;

function Traffic({ state, runtime }: P) {
  const getCar = useMemo(
    () => (i: number, o: CarInstance) => {
      const cars = state.cars;
      if (i >= cars.length) {
        const pk = PARKED_CARS[i - cars.length];
        if (!pk) return false;
        o.x = pk.x;
        o.y = pk.y;
        o.z = pk.z;
        o.yaw = pk.yaw;
        o.variant = pk.variant;
        return true;
      }
      const c = cars[i]!;
      const a = APP[c.approach];
      const p = c.s - G.approachDist - c.length / 2;
      o.x = a.ox + a.dx * p;
      o.z = a.oz + a.dz * p;
      o.yaw = a.yaw + c.spin;
      o.variant = c.variant;
      o.length = c.length;
      o.distance = c.s;
      o.braking = c.braking;
      o.headlights = runtime.getControl('night') === true;
      if (c.state === 'crashed') {
        const t = c.crashMs / 1000;
        o.blinker = 'hazard';
        o.braking = false;
        // a short rocking settle after the impact
        const k = Math.exp(-t * 3.5);
        o.roll = 0.06 * k * Math.sin(t * 22);
        o.pitch = 0.04 * k * Math.cos(t * 18);
      }
      return true;
    },
    [state, runtime],
  );
  return <CarFleet capacity={MAX_CARS} getCar={getCar} />;
}

// ---------------------------------------------------------------------------
// Pedestrians
// ---------------------------------------------------------------------------

/** Keep React in sync with the pedestrian list (re-render only when somebody appears / leaves). */
function usePedIds(state: TrafficLightState) {
  const [ids, setIds] = useState<{ id: number; variant: number }[]>([]);
  const last = useRef('');
  const acc = useRef(0);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.05) return;
    acc.current = 0;
    let key = '';
    for (const p of state.pedestrians) key += `${p.id},`;
    if (key === last.current) return;
    last.current = key;
    setIds(state.pedestrians.map((p) => ({ id: p.id, variant: p.variant })));
  });
  return ids;
}

function findPed(state: TrafficLightState, id: number): PedState | undefined {
  for (const p of state.pedestrians) if (p.id === id) return p;
  return undefined;
}

/** Walking surface height: sidewalk (curb) beyond the gutter line, road inside. */
function surfaceY(x: number): number {
  const ax = Math.abs(x);
  if (ax >= ROAD.half + 0.25) return ROAD.curb;
  if (ax <= ROAD.half - 0.1) return 0;
  return ((ax - (ROAD.half - 0.1)) / 0.35) * ROAD.curb;
}

function PedSlot({ state, id, variant }: { state: TrafficLightState; id: number; variant: number }) {
  const ref = useRef<THREE.Group>(null);
  const k = useRef({ dist: 0, lx: NaN, lz: 0, age: 0, walking: false, reach: 0 });
  useFrame((_, dt) => {
    const g = ref.current;
    const p = findPed(state, id);
    if (!g || !p) return;
    const s = k.current;
    s.age += Math.min(dt, 0.1);
    if (!Number.isNaN(s.lx)) s.dist += Math.hypot(p.x - s.lx, p.z - s.lz);
    s.lx = p.x;
    s.lz = p.z;
    s.walking = p.state !== 'waiting';
    // just pushed the button: turn to the pole and reach for the button for a moment
    const pushing = p.state === 'waiting' && s.age < 1.1;
    s.reach = pushing ? 1 : 0;
    let yaw = p.state === 'done' ? Math.PI / 2 : p.dir > 0 ? 0 : Math.PI;
    if (pushing) {
      const bx = p.x > 0 ? POLE : -POLE;
      const bz = -POLE + 0.35;
      yaw = Math.atan2(-(bz - p.z), bx - p.x);
    }
    g.position.set(p.x, surfaceY(p.x), p.z);
    g.rotation.y = yaw;
  });
  const getters = useMemo(
    () => ({
      dist: () => k.current.dist,
      walking: () => k.current.walking,
      reach: () => k.current.reach,
    }),
    [],
  );
  return (
    <group ref={ref}>
      <Pedestrian variant={variant} getDistance={getters.dist} getWalking={getters.walking} getReach={getters.reach} />
    </group>
  );
}

/** Two townspeople strolling up and down sidewalks away from the crossing (pure decoration). */
function AmbientWalker({ variant, from, to, speed, phase }: { variant: number; from: [number, number]; to: [number, number]; speed: number; phase: number }) {
  const ref = useRef<THREE.Group>(null);
  const d = useRef(phase);
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    d.current += speed * Math.min(dt, 0.1);
    const cyc = d.current % (2 * len);
    const fwd = cyc < len;
    const u = fwd ? cyc / len : 2 - cyc / len;
    const x = from[0] + (to[0] - from[0]) * u;
    const z = from[1] + (to[1] - from[1]) * u;
    const dx = (to[0] - from[0]) * (fwd ? 1 : -1);
    const dz = (to[1] - from[1]) * (fwd ? 1 : -1);
    g.position.set(x, ROAD.curb, z);
    g.rotation.y = Math.atan2(-dz, dx);
  });
  return (
    <group ref={ref}>
      <Pedestrian variant={variant} getDistance={() => d.current} getWalking={() => true} />
    </group>
  );
}

function Pedestrians({ state }: P) {
  const ids = usePedIds(state);
  return (
    <group>
      {ids.map((p) => (
        <PedSlot key={p.id} state={state} id={p.id} variant={p.variant} />
      ))}
      <AmbientWalker variant={2} from={[5.4, -12]} to={[5.4, -34]} speed={1.3} phase={3} />
      <AmbientWalker variant={4} from={[-12, 5.3]} to={[-36, 5.3]} speed={1.2} phase={11} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Crash effects & conflict warning
// ---------------------------------------------------------------------------

const PUFFS = 7;
const SHARDS = 14;
const MAX_FX = 4;

function CrashEffects({ state }: P) {
  const smoke = useRef<THREE.InstancedMesh>(null);
  const shards = useRef<THREE.InstancedMesh>(null);
  const sign = useRef<THREE.Sprite>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  const smokeGeo = kgeo('tl:puff', () => new THREE.IcosahedronGeometry(1, 1));
  const smokeMat = kmat('tl:puffMat', () => new THREE.MeshStandardMaterial({ color: '#8d8f91', roughness: 1, transparent: true, opacity: 0.5, depthWrite: false }));
  const shardGeo = kgeo('tl:shard', () => new THREE.BoxGeometry(0.12, 0.012, 0.07));
  const shardMat = kmat('tl:shardMat', () => new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.4, metalness: 0.3 }));
  const signMat = useMemo(() => {
    const tex = canvasTexture('tl:conflictSign', 512, 160, (ctx, w, h) => {
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, h - 8, 26);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 58px Inter, Arial, sans-serif';
      ctx.fillText('⚠ SIGNAL CONFLICT', w / 2, h * 0.4);
      ctx.font = '600 30px Inter, Arial, sans-serif';
      ctx.fillText('crossing streams both released', w / 2, h * 0.75);
    });
    return new THREE.SpriteMaterial({ map: tex, toneMapped: false, depthTest: false, transparent: true });
  }, []);
  useEffect(() => () => signMat.dispose(), [signMat]);
  useFrame(({ clock }) => {
    const sm = smoke.current;
    const sh = shards.current;
    let np = 0;
    let ns = 0;
    const fxs = state.crashFx;
    for (let f = 0; f < fxs.length && f < MAX_FX; f++) {
      const fx = fxs[f]!;
      const t = fx.ageMs / 1000;
      const seed = (Math.round(fx.x * 13.7 + fx.z * 7.3) & 0xff) + 1;
      if (sm) {
        for (let i = 0; i < PUFFS; i++) {
          const a = seed * 1.7 + i * 2.39;
          const r = 0.4 + 0.25 * i * Math.min(1, t);
          const grow = Math.min(1, t * 1.6) * (1 - Math.max(0, (t - 3) / 1));
          const sc = (0.5 + 0.18 * i) * Math.max(0.01, grow);
          tmp.p.set(fx.x + Math.cos(a) * r, 0.4 + t * (0.35 + 0.08 * i), fx.z + Math.sin(a) * r);
          tmp.s.setScalar(sc);
          tmp.q.identity();
          tmp.m.compose(tmp.p, tmp.q, tmp.s);
          sm.setMatrixAt(np++, tmp.m);
        }
      }
      if (sh) {
        for (let i = 0; i < SHARDS; i++) {
          const a = seed * 0.9 + i * 0.449 * Math.PI;
          const fly = Math.min(1, t * 3);
          const r = (0.8 + ((i * 37) % 11) * 0.22) * fly;
          tmp.e.set(0, a * 3, 0);
          tmp.q.setFromEuler(tmp.e);
          tmp.p.set(fx.x + Math.cos(a) * r, 0.01 + Math.max(0, Math.sin(fly * Math.PI) * 0.5), fx.z + Math.sin(a) * r);
          tmp.s.set(1 + (i % 3) * 0.5, 1, 1);
          tmp.m.compose(tmp.p, tmp.q, tmp.s);
          sh.setMatrixAt(ns++, tmp.m);
        }
      }
    }
    if (sm) {
      sm.count = np;
      sm.instanceMatrix.needsUpdate = true;
    }
    if (sh) {
      sh.count = ns;
      sh.instanceMatrix.needsUpdate = true;
    }
    const sg = sign.current;
    if (sg) {
      const recent = state.lastConflictMs >= 0 && state.timeMs - state.lastConflictMs < 4000;
      sg.visible = (state.conflict || recent) && Math.floor(clock.elapsedTime * 3) % 2 === 0;
    }
  });
  return (
    <group>
      <instancedMesh ref={smoke} args={[smokeGeo, smokeMat, PUFFS * MAX_FX]} frustumCulled={false} />
      <instancedMesh ref={shards} args={[shardGeo, shardMat, SHARDS * MAX_FX]} frustumCulled={false} castShadow />
      <sprite ref={sign} material={signMat} position={[0, 8.6, 0]} scale={[5.2, 1.625, 1]} visible={false} renderOrder={20} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

function useTrafficSound(state: TrafficLightState, runtime: SimRuntime) {
  const prev = useRef({ fx: 0, walk: false, horn: 0, tick: 0, init: false });
  useSfxLoops(['conveyor', 'horn'], (lv) => {
    // road rumble from the moving cars near the intersection
    let moving = 0;
    for (const c of state.cars) {
      if (c.speed < 1) continue;
      const d = Math.abs(c.s - G.approachDist);
      if (d < 30) moving += (1 - d / 30) * Math.min(1, c.speed / 10);
    }
    lv.conveyor = Math.min(0.9, moving * 0.35);
    lv.horn = prev.current.horn > 0 ? 1 : 0;
  });
  useFrame((_, dt) => {
    const p = prev.current;
    const nFx = state.crashFx.length;
    if (!p.init) {
      p.init = true;
      p.fx = nFx;
      p.walk = state.lamps.walk;
      return;
    }
    const ok = audioAllowed();
    if (nFx > p.fx && ok) {
      sfx.play('contactor');
      sfx.play('fail');
      p.horn = 1.1;
    }
    p.fx = nFx;
    if (p.horn > 0) p.horn -= dt;
    // accessible pedestrian signal: a chirp when WALK comes on, then a soft tick while it lasts
    const walk = state.lamps.walk;
    if (walk && !p.walk && ok) sfx.play('beep');
    p.walk = walk;
    if (walk) {
      p.tick += dt;
      if (p.tick > 0.5) {
        p.tick = 0;
        if (ok) sfx.play('click');
      }
    } else p.tick = 0;
    void runtime;
  });
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export const TrafficLightView = memo(function TrafficLightView({ state, runtime }: P) {
  const nightRef = useLatest(runtime);
  const getNight = useMemo(() => () => nightRef.current.getControl('night') === true, [nightRef]);
  useTrafficSound(state, runtime);
  const cabOcc: [Vec3, Vec3] = [
    [CABINET.x - 0.75, 0, CABINET.z - 0.75],
    [CABINET.x + 0.75, 1.6, CABINET.z + 0.75],
  ];
  return (
    <group>
      <TrafficEnvironment getNight={getNight} />
      <TagLayer occluders={[...OCCLUDERS, cabOcc]}>
        <Signals state={state} runtime={runtime} />
        <Loops state={state} runtime={runtime} />
        <TrafficCabinet state={state} runtime={runtime} position={[CABINET.x, CABINET.y, CABINET.z]} rotationY={CABINET.rotY} />
      </TagLayer>
      <Traffic state={state} runtime={runtime} />
      <Pedestrians state={state} runtime={runtime} />
      <CrashEffects state={state} runtime={runtime} />
    </group>
  );
});

export default TrafficLightView;

