/**
 * `traffic-light` 3D view — a four-way city intersection (Main St NS × Logix Ave EW): galvanized
 * mast-arm poles with 12" LED heads (far-side, two per approach), countdown pedestrian heads and APS push
 * buttons on the north crosswalk (click them = `ped`), inductive loops on both side-street approaches
 * (they glow while a car is detected), cars (instanced fleet) and pedestrians animated from the scene
 * state, crash effects on signal conflicts, the roadside controller cabinet with the live CompactLogix
 * rack + the AUTO/FLASH key on its police panel (`night`), and a city block around it.
 *
 * The view never ticks the runtime: it reads `state` in useFrame and writes controls via runtime.setControl.
 */
import { useFrame } from '@react-three/fiber';
import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  SIGNAL_HEAD_DIMS,
  SignalPole,
  TrafficSignalHead,
  type CarInstance,
  type MastArmSpec,
} from '../../../twin/devices';
import type { SceneViewProps, SimRuntime } from '../../types';
import { audioAllowed, canvasTexture, fitFont, IoTag, ioLine, kgeo, kmat, TagLayer, useSfxLoops, type TagGroup } from '../trainer/kit';
import { TrafficCabinet } from './cabinet';
import { useQuietPaint } from './cityKit';
import { CABINET, OCCLUDERS, PARKED_CARS, ROAD, TrafficEnvironment } from './environment';
import { glowTexture, PointSprites, smokeTexture, type SpriteBuffers } from './fx';
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
/** Lens centres below a head's mounting point (default hanger), and a point just inside the visor. */
const HANGER = SIGNAL_HEAD_DIMS.defaultHanger;
const SECTION = SIGNAL_HEAD_DIMS.sectionHeight;
const LENS_Z = SIGNAL_HEAD_DIMS.housingDepth / 2 + 0.05;

/** An EW car waiting on its approach's loop (same test as the logic's detector). */
function loopOccupied(state: TrafficLightState, approach: Approach): boolean {
  for (const c of state.cars) {
    if (c.approach !== approach || c.state === 'crashed' || c.speed >= 1) continue;
    if (c.s <= STOP_S + 0.5 && c.s >= STOP_S - G.loopLength) return true;
  }
  return false;
}

/** Pinned-overlay groups: far away, each collapses into one summary chip. */
const TG: Record<string, TagGroup> = {
  ns: { id: 'ns', label: 'Main-street heads (NS)', mode: 'rows', collapseBelow: 34 },
  ew: { id: 'ew', label: 'Side-street heads (EW)', mode: 'rows', collapseBelow: 34 },
  ped: { id: 'ped', label: 'North crosswalk: ped signal + button', mode: 'rows', collapseBelow: 40 },
  cab: { id: 'cab', label: 'Controller cabinet CAB 07', mode: 'rows', collapseBelow: 16 },
};

// ---------------------------------------------------------------------------
// Lamp halos: one Points draw call for every signal lens (readable lamp states from far away)
// ---------------------------------------------------------------------------

interface HaloSrc {
  obj: THREE.Object3D;
  rgb: [number, number, number];
  size: number;
  get: () => boolean;
  level: number;
}

const HaloContext = createContext<HaloSrc[] | null>(null);

const HALO_RGB: Record<'red' | 'yellow' | 'green' | 'walk' | 'hand', [number, number, number]> = {
  red: [1.0, 0.12, 0.04],
  yellow: [1.0, 0.55, 0.05],
  green: [0.05, 1.0, 0.62],
  walk: [0.9, 0.95, 1.0],
  hand: [1.0, 0.42, 0.05],
};

function HaloAnchor({ position, color, get, size = 2.3 }: { position: Vec3; color: keyof typeof HALO_RGB; get: () => boolean; size?: number }) {
  const list = useContext(HaloContext);
  const ref = useRef<THREE.Group>(null);
  const getRef = useRef(get);
  getRef.current = get;
  useLayoutEffect(() => {
    if (!list || !ref.current) return;
    const src: HaloSrc = { obj: ref.current, rgb: HALO_RGB[color], size, get: () => getRef.current(), level: 0 };
    list.push(src);
    return () => {
      const i = list.indexOf(src);
      if (i >= 0) list.splice(i, 1);
    };
  }, [list, color, size]);
  return <group ref={ref} position={position} />;
}

function LampHalos({ children }: { children: ReactNode }) {
  const list = useMemo<HaloSrc[]>(() => [], []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const update = useMemo(
    () => (b: SpriteBuffers, dt: number) => {
      const k = 1 - Math.exp(-dt * 30);
      let n = 0;
      for (const h of list) {
        h.level += ((h.get() ? 1 : 0) - h.level) * k;
        if (h.level < 0.02) continue;
        h.obj.getWorldPosition(v);
        b.pos[n * 3] = v.x;
        b.pos[n * 3 + 1] = v.y;
        b.pos[n * 3 + 2] = v.z;
        b.col[n * 3] = h.rgb[0] * 0.75;
        b.col[n * 3 + 1] = h.rgb[1] * 0.75;
        b.col[n * 3 + 2] = h.rgb[2] * 0.75;
        b.size[n] = h.size;
        b.alpha[n] = h.level;
        b.rot[n] = 0;
        n++;
      }
      return n;
    },
    [list, v],
  );
  return (
    <HaloContext.Provider value={list}>
      {children}
      <PointSprites capacity={48} map={glowTexture()} additive update={update} />
    </HaloContext.Provider>
  );
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
 * DON'T WALK interval of the previous cycle and counts it down (blank on the first cycle). A plant
 * reset (time running backwards) forgets what it learned.
 */
function usePedCountdown(state: TrafficLightState) {
  const s = useRef({ prevWalk: false, prevDw: false, t0: -1, lastRise: 0, steadySince: 0, learned: 0, counting: false, prevNow: 0 });
  return useMemo(
    () => () => {
      const k = s.current;
      const now = state.timeMs;
      if (now < k.prevNow) {
        k.prevWalk = k.prevDw = k.counting = false;
        k.t0 = -1;
        k.lastRise = k.steadySince = k.learned = 0;
      }
      k.prevNow = now;
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

type Road = 'ns' | 'ew';

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
  const head = (road: Road) => {
    const [r, y, gr] = road === 'ns' ? [g.nsR, g.nsY, g.nsG] : [g.ewR, g.ewY, g.ewG];
    return (
      <group>
        <TrafficSignalHead getRed={r} getYellow={y} getGreen={gr} />
        <HaloAnchor position={[0, -HANGER - SECTION * 0.5, LENS_Z]} color="red" get={r} />
        <HaloAnchor position={[0, -HANGER - SECTION * 1.5, LENS_Z]} color="yellow" get={y} />
        <HaloAnchor position={[0, -HANGER - SECTION * 2.5, LENS_Z]} color="green" get={gr} />
      </group>
    );
  };
  const arm = (angle: number, road: Road): MastArmSpec => ({
    length: ARM.length,
    angle,
    height: ARM_H,
    streetSign: { at: 6.4, text: road === 'ns' ? 'LOGIX AVE' : 'MAIN ST', width: 1.6 },
    attachments: ARM.heads.map((at) => ({ at, node: head(road), flip: true })),
  });
  const pedHead = (
    <group>
      <PedestrianSignal getWalk={g.walk} getDontWalk={g.dw} getCountdown={countdown} />
      <HaloAnchor position={[-0.1, 0, 0.36]} color="walk" get={g.walk} size={1.5} />
      <HaloAnchor position={[-0.1, 0, 0.36]} color="hand" get={g.dw} size={1.5} />
    </group>
  );
  const button = (arrow: 'left' | 'right') => (
    <PedestrianPushButton mount="none" poleRadius={poleRadiusAt(1.1)} arrow={arrow} getPressed={pedPressed} getLit={pedLit} onPress={press.onPress} onRelease={press.onRelease} />
  );
  const L = (a: string) => ioLine(runtime, a);
  const nsLines = [L('NS_Red'), L('NS_Yellow'), L('NS_Green')];
  const ewLines = [L('EW_Red'), L('EW_Yellow'), L('EW_Green')];
  const pedLines = [L('Walk'), L('Dont_Walk')];
  /**
   * Tag box around the two heads of an arm (arm heading `a` from a pole at x, z). Both arms of a road carry
   * the same outputs: one arm per road takes part in the pinned overlay (no duplicate rows), both hover.
   */
  const headTag = (x: number, z: number, a: number, lines: typeof nsLines, title: string, group?: TagGroup) => {
    const mid = (ARM.heads[0] + ARM.heads[1]) / 2;
    return (
      <IoTag
        position={[x + Math.cos(a) * mid, HEAD_Y, z - Math.sin(a) * mid]}
        rotation={[0, a, 0]}
        size={[ARM.heads[1] - ARM.heads[0] + 0.8, 1.45, 0.7]}
        anchor={[0, 0.95, 0]}
        title={title}
        lines={lines}
        pin={!!group}
        group={group}
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
        luminaire={{ angle: Math.PI }}
        attachments={[
          { height: 3.0, angle: -Math.PI / 2, node: pedHead },
          { height: 0.95, angle: 0, bands: false, node: button('left') },
        ]}
      />
      {/* SW: SB heads (arm east) */}
      <SignalPole position={[-POLE, ROAD.curb, POLE]} poleId="SW-3" arms={[arm(0, 'ns')]} luminaire={{ angle: 0 }} />
      {/* SE: EB heads (arm north) */}
      <SignalPole position={[POLE, ROAD.curb, POLE]} poleId="SE-2" arms={[arm(Math.PI / 2, 'ew')]} />
      {/* NW: WB heads (arm south) + ped head facing the NE corner + push button */}
      <SignalPole
        position={[-POLE, ROAD.curb, -POLE]}
        poleId="NW-4"
        arms={[arm(-Math.PI / 2, 'ew')]}
        attachments={[
          {
            height: 3.0,
            angle: Math.PI / 2,
            node: (
              <group>
                <PedestrianSignal getWalk={g.walk} getDontWalk={g.dw} getCountdown={countdown} />
                <HaloAnchor position={[-0.1, 0, 0.36]} color="walk" get={g.walk} size={1.5} />
                <HaloAnchor position={[-0.1, 0, 0.36]} color="hand" get={g.dw} size={1.5} />
              </group>
            ),
          },
          { height: 0.95, angle: 0, bands: false, node: button('right') },
        ]}
      />
      {headTag(POLE, -POLE, Math.PI, nsLines, 'Main street heads, northbound (NB)', TG.ns)}
      {headTag(-POLE, POLE, 0, nsLines, 'Main street heads, southbound (SB) — same outputs as NB')}
      {headTag(POLE, POLE, Math.PI / 2, ewLines, 'Side street heads, eastbound (EB)', TG.ew)}
      {headTag(-POLE, -POLE, -Math.PI / 2, ewLines, 'Side street heads, westbound (WB) — same outputs as EB')}
      {/* ped heads (3.0 m on the pole, facing across the crosswalk) */}
      <IoTag position={[POLE - 0.45, ROAD.curb + 3.0, -POLE]} size={[0.35, 0.55, 0.55]} anchor={[0, 0.4, 0]} title="Pedestrian signal (NE pole)" lines={pedLines} pin={false} />
      <IoTag position={[-POLE + 0.45, ROAD.curb + 3.0, -POLE]} size={[0.35, 0.55, 0.55]} anchor={[0, 0.4, 0]} title="Pedestrian signal (NW pole)" lines={pedLines} group={TG.ped} />
      {/* push buttons (0.95 m, south face of the NE / NW poles), wired in parallel */}
      {[POLE, -POLE].map((x) => (
        <IoTag
          key={x}
          position={[x, ROAD.curb + 1.1, -POLE + 0.3]}
          size={[0.2, 0.45, 0.2]}
          anchor={[0, 0.35, 0]}
          title="Pedestrian push button (N.O., both corners in parallel)"
          lines={[L('Ped_PB')]}
          pin={x < 0}
          group={x < 0 ? TG.ped : undefined}
        />
      ))}
    </group>
  );
}

function Loops({ state, runtime }: P) {
  const eb = useMemo(() => () => loopOccupied(state, 'EB'), [state]);
  const wb = useMemo(() => () => loopOccupied(state, 'WB'), [state]);
  const line = [ioLine(runtime, 'Car_Sensor_EW')];
  const title = (dir: string) => `Loop (${dir}) → detector amplifier ch 1 in the cabinet → Local:1:I.Pt01`;
  return (
    <group>
      <InductiveLoopMarking position={[-LOOP_CENTER, 0, G.laneOffset]} length={G.loopLength} width={1.8} leadIn={0.85} getActive={eb} hint="strong" />
      <InductiveLoopMarking position={[LOOP_CENTER, 0, -G.laneOffset]} rotation={[0, Math.PI, 0]} length={G.loopLength} width={1.8} leadIn={0.85} getActive={wb} hint="strong" />
      {/* both loops feed the same detector channel: each gets its own pill (a large, flat device) */}
      <IoTag position={[-LOOP_CENTER, 0.1, G.laneOffset]} size={[G.loopLength, 0.25, 1.9]} anchor={[0, 0.4, 0]} title={title('eastbound')} lines={line} />
      <IoTag position={[LOOP_CENTER, 0.1, -G.laneOffset]} size={[G.loopLength, 0.25, 1.9]} anchor={[0, 0.4, 0]} title={title('westbound')} lines={line} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

const MAX_CARS = 44;

function Traffic({ state }: P) {
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
      // daytime: headlights off (the signal controller has nothing to do with them)
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
    [state],
  );
  return <CarFleet capacity={MAX_CARS} getCar={getCar} />;
}

// ---------------------------------------------------------------------------
// Pedestrians
// ---------------------------------------------------------------------------

/** Keep React in sync with the pedestrian list (re-render only when somebody appears / leaves; remount all on a plant reset). */
function usePedIds(state: TrafficLightState) {
  const [ids, setIds] = useState<{ key: string; id: number; variant: number }[]>([]);
  const last = useRef('');
  const acc = useRef(0);
  const gen = useRef({ n: 0, t: 0 });
  useFrame((_, dt) => {
    if (state.timeMs < gen.current.t) gen.current.n++;
    gen.current.t = state.timeMs;
    acc.current += dt;
    if (acc.current < 0.05) return;
    acc.current = 0;
    let key = `${gen.current.n}:`;
    for (const p of state.pedestrians) key += `${p.id},`;
    if (key === last.current) return;
    last.current = key;
    const n = gen.current.n;
    setIds(state.pedestrians.map((p) => ({ key: `${n}:${p.id}`, id: p.id, variant: p.variant })));
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
        <PedSlot key={p.key} state={state} id={p.id} variant={p.variant} />
      ))}
      <AmbientWalker variant={2} from={[5.4, -12]} to={[5.4, -34]} speed={1.3} phase={3} />
      <AmbientWalker variant={4} from={[-12, 5.3]} to={[-36, 5.3]} speed={1.2} phase={11} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Crash effects & conflict warning
// ---------------------------------------------------------------------------

const PUFFS = 9;
const SPARKS = 16;
const SHARDS = 14;
const MAX_FX = 4;

/** Conflict banner, one texture per cause (the monitor tells which outputs were on together). */
function conflictSignTexture(kind: 'streets' | 'walk') {
  const sub = kind === 'streets' ? 'NS and EW both released (green/yellow)' : 'WALK lit during main-street green/yellow';
  return canvasTexture(`tl:conflictSign:${kind}`, 640, 180, (ctx, w, h) => {
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 26);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.stroke();
    // warning triangle
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(66, 30);
    ctx.lineTo(114, 116);
    ctx.lineTo(18, 116);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(62, 56, 8, 36);
    ctx.fillRect(62, 98, 8, 8);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, 'SIGNAL CONFLICT', w - 170, 58, 800);
    ctx.fillText('SIGNAL CONFLICT', w / 2 + 55, h * 0.34);
    fitFont(ctx, sub, w - 170, 30, 600);
    ctx.fillText(sub, w / 2 + 55, h * 0.72);
  });
}

function CrashEffects({ state }: P) {
  const shards = useRef<THREE.InstancedMesh>(null);
  const sign = useRef<THREE.Sprite>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  const shardGeo = kgeo('tl:shard', () => new THREE.BoxGeometry(0.12, 0.012, 0.07));
  const shardMat = kmat('tl:shardMat', () => new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.4, metalness: 0.3 }));
  const signMats = useMemo(
    () => ({
      streets: new THREE.SpriteMaterial({ map: conflictSignTexture('streets'), toneMapped: false, depthTest: false, transparent: true }),
      walk: new THREE.SpriteMaterial({ map: conflictSignTexture('walk'), toneMapped: false, depthTest: false, transparent: true }),
    }),
    [],
  );
  useEffect(
    () => () => {
      signMats.streets.dispose();
      signMats.walk.dispose();
    },
    [signMats],
  );
  const cause = useRef<'streets' | 'walk'>('streets');
  const seed = (x: number, z: number) => (Math.round(x * 13.7 + z * 7.3) & 0xff) + 1;
  /** Billboard smoke: grey puffs that billow up and thin out over ~4 s. */
  const smoke = useMemo(
    () => (b: SpriteBuffers) => {
      let n = 0;
      const fxs = state.crashFx;
      for (let f = 0; f < fxs.length && f < MAX_FX; f++) {
        const fx = fxs[f]!;
        const t = fx.ageMs / 1000;
        const sd = seed(fx.x, fx.z);
        for (let i = 0; i < PUFFS; i++) {
          const delay = i * 0.08;
          const tt = t - delay;
          if (tt <= 0) continue;
          const a = sd * 1.7 + i * 2.39;
          const r = 0.5 + 0.6 * Math.min(1, tt) + 0.14 * i;
          b.pos[n * 3] = fx.x + Math.cos(a) * r;
          // start above the crumpled hoods, billow up and drift
          b.pos[n * 3 + 1] = 1.25 + tt * (0.5 + 0.08 * i);
          b.pos[n * 3 + 2] = fx.z + Math.sin(a) * r;
          const shade = 0.42 + 0.05 * (i % 3);
          b.col[n * 3] = shade;
          b.col[n * 3 + 1] = shade;
          b.col[n * 3 + 2] = shade * 1.02;
          b.size[n] = 1.2 + 1.4 * Math.min(1, tt * 0.8) + 0.12 * i;
          b.alpha[n] = Math.min(1, tt * 3) * Math.max(0, 1 - tt / 4.2) * 0.9;
          b.rot[n] = a + tt * 0.3;
          n++;
        }
      }
      return n;
    },
    [state],
  );
  /** Impact flash + sparks (additive, first ~0.8 s). */
  const flash = useMemo(
    () => (b: SpriteBuffers) => {
      let n = 0;
      const fxs = state.crashFx;
      for (let f = 0; f < fxs.length && f < MAX_FX; f++) {
        const fx = fxs[f]!;
        const t = fx.ageMs / 1000;
        if (t > 0.9) continue;
        const sd = seed(fx.x, fx.z);
        if (t < 0.25) {
          b.pos[n * 3] = fx.x;
          b.pos[n * 3 + 1] = 0.7;
          b.pos[n * 3 + 2] = fx.z;
          b.col[n * 3] = 1.6;
          b.col[n * 3 + 1] = 1.3;
          b.col[n * 3 + 2] = 0.9;
          b.size[n] = 3.2 + t * 6;
          b.alpha[n] = 1 - t / 0.25;
          b.rot[n] = 0;
          n++;
        }
        for (let i = 0; i < SPARKS; i++) {
          const a = sd * 0.7 + i * 2.399;
          const up = 2.2 + ((i * 53) % 7) * 0.4;
          const sp = 3 + ((i * 29) % 5) * 0.8;
          const y = 0.6 + up * t - 4.9 * t * t;
          if (y < 0.02) continue;
          b.pos[n * 3] = fx.x + Math.cos(a) * sp * t;
          b.pos[n * 3 + 1] = y;
          b.pos[n * 3 + 2] = fx.z + Math.sin(a) * sp * t;
          b.col[n * 3] = 1.8;
          b.col[n * 3 + 1] = 1.0;
          b.col[n * 3 + 2] = 0.35;
          b.size[n] = 0.16;
          b.alpha[n] = Math.max(0, 1 - t / 0.9);
          b.rot[n] = 0;
          n++;
        }
      }
      return n;
    },
    [state],
  );
  useFrame(({ clock }) => {
    const sh = shards.current;
    let ns = 0;
    const fxs = state.crashFx;
    if (sh) {
      for (let f = 0; f < fxs.length && f < MAX_FX; f++) {
        const fx = fxs[f]!;
        const t = fx.ageMs / 1000;
        const sd = seed(fx.x, fx.z);
        for (let i = 0; i < SHARDS; i++) {
          const a = sd * 0.9 + i * 0.449 * Math.PI;
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
      sh.count = ns;
      sh.instanceMatrix.needsUpdate = true;
    }
    const sg = sign.current;
    if (sg) {
      const L = state.lamps;
      if (state.conflict) {
        const nsGo = L.nsGreen || L.nsYellow;
        const ewGo = L.ewGreen || L.ewYellow;
        cause.current = nsGo && ewGo ? 'streets' : 'walk';
      }
      const recent = state.lastConflictMs >= 0 && state.timeMs - state.lastConflictMs < 4000 && state.timeMs >= state.lastConflictMs;
      sg.visible = state.conflict || recent;
      const mat = signMats[cause.current];
      if (sg.material !== mat) sg.material = mat;
      // pulse instead of blinking, so it is always readable
      mat.opacity = 0.65 + 0.35 * Math.abs(Math.sin(clock.elapsedTime * 4));
    }
  });
  return (
    <group>
      <PointSprites capacity={PUFFS * MAX_FX} map={smokeTexture()} additive={false} update={smoke} renderOrder={12} />
      <PointSprites capacity={(SPARKS + 1) * MAX_FX} map={glowTexture()} additive update={flash} renderOrder={13} />
      <instancedMesh ref={shards} args={[shardGeo, shardMat, SHARDS * MAX_FX]} frustumCulled={false} />
      <sprite ref={sign} material={signMats.streets} position={[0, 8.6, 0]} scale={[5.8, 1.63, 1]} visible={false} renderOrder={20} />
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
  useTrafficSound(state, runtime);
  useQuietPaint();
  const cabOcc: [Vec3, Vec3] = [
    [CABINET.x - 0.75, 0, CABINET.z - 0.75],
    [CABINET.x + 0.75, 1.6, CABINET.z + 0.75],
  ];
  return (
    <group>
      <TrafficEnvironment />
      <TagLayer occluders={[...OCCLUDERS, cabOcc]} pinStyle="pill">
        <LampHalos>
          <Signals state={state} runtime={runtime} />
        </LampHalos>
        <Loops state={state} runtime={runtime} />
        <TrafficCabinet state={state} runtime={runtime} position={[CABINET.x, CABINET.y, CABINET.z]} rotationY={CABINET.rotY} tagGroup={TG.cab} />
      </TagLayer>
      <Traffic state={state} runtime={runtime} />
      <Pedestrians state={state} runtime={runtime} />
      <CrashEffects state={state} runtime={runtime} />
    </group>
  );
});

export default TrafficLightView;
