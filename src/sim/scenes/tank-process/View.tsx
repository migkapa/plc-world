/**
 * `tank-process` digital twin — a mixing & heating skid in a process hall.
 *
 *   feed tank T-100 → pump P-100 (local pressure-switch control, not PLC I/O) → valve station (XV-101 on/off fast-fill
 *   branch ∥ FCV-101 control valve; cables down the column into floor conduits, instrument air from an FRL) → 2000 L
 *   stainless mixing tank T-101 (cut-away: live level, temperature-tinted product, agitator M-101, immersion heater
 *   with glow + HEATING lamp, inlet stream, bubbles / boiling / steam, overflow spill onto the deck) with LT-101 radar,
 *   TT-101, LSL/LSH/LSHH level switches (cordsets down the shell into JB-101 on a tank leg) → bottom outlet XV-102 →
 *   drain tundish. Access platform + ladder with the AH-101 beacon mast and the LI/TI-101 field display, pipe rack,
 *   deck trunking + riser ladder to the main tray, local operator panel OP-101 (Start / Stop / Discharge / E-stop,
 *   RUNNING & BATCH DONE lights) and the control cabinet with the ControlLogix 1756-A10 rack (L85E, IB16, OB16E,
 *   IF8, OF8) and a 440R safety relay.
 *
 * Everything animates from TankProcessState inside useFrame; the view never ticks the runtime.
 */
import { memo, useMemo } from 'react';
import {
  ConduitStub,
  FieldJunctionBox,
  FieldMerge,
  fieldJunctionBoxGlands,
  LevelSwitch,
  LevelTransmitter,
  nozzleLocal,
  OnNozzle,
  PipeRun,
  SolenoidValve,
  Tank,
  TempTransmitter,
  type FieldCableRoute,
  type TankNozzle,
} from '../../../twin/devices';
import type { Vec3 } from '../../../twin/contracts';
import type { SceneViewProps } from '../../types';
import { ControlCabinet } from '../conveyor-sort/cabinet';
import {
  Bollards,
  Cables,
  CableTray,
  FactoryHall,
  FireExtinguisher,
  FloorDrain,
  Instances,
  paint,
  PalletStack,
  steel,
  unitBox,
  unitCylY,
  WALKWAY,
  WallSign,
  YELLOW,
  type CableSpec,
  type FloorPainter,
} from '../conveyor-sort/hall';
import { IoHotspot, playSfx, ShadowBudget, TagLayer, useEdge, useSceneLoops } from '../conveyor-sort/kit';
import { ControlValve } from './ControlValve';
import { HeaterCue, LiquidGuard, LocalIndicator, TankFx } from './fx';
import type { TankProcessState } from './logic';
import {
  AlarmBeacon,
  FEED,
  FeedPump,
  FeedTank,
  IbcTote,
  OperatorPanel,
  PANEL,
  Platform,
  PipeRack,
  PLATFORM,
  PUMP,
  RACK,
  Skid,
  SKID_H,
  TANK_D,
  TANK_H,
  TL,
  Tundish,
  ZI,
} from './parts';

const N = TL.nozzles;
const WALL_Z = -3.2;
const CAB = { x: 3.05, y: 0.62, size: [1.0, 1.2, 0.3] as Vec3 };
const PIPE_D = 0.0603;
/** Valve station (world): lower branch FCV-101, upper branch XV-101. */
const VS = { xa: -2.45, xb: -1.3, xv: -1.87, yLow: 0.78, yHigh: 1.38, yTop: 2.78 } as const;
const OUTLET = { y: 0.28, xv: 0.8, xEnd: 1.45 } as const;
const TRAY = { y: 3.46, z: RACK.z } as const;
/** Pipe-support column of the valve station (world x / z); the valve cables go down it into floor conduits. */
const VCOL = { x: VS.xb + 0.12, z: ZI - 0.12 } as const;
/** Vertical cable ladder on the front face of the platform's front-right column (world x / z). */
const RISER = { x: PLATFORM.x1 - 0.05, z: PLATFORM.z1 + 0.04 } as const;

// ---------------------------------------------------------------------------
// Cable geometry helpers (tank coordinates = world − (0, SKID_H, 0))
// ---------------------------------------------------------------------------

const deg = (d: number) => (d * Math.PI) / 180;
/** Point at azimuth `az` (deg), radius `r`, height `y` (tank coordinates). */
const P = (az: number, r: number, y: number): Vec3 => [r * Math.sin(deg(az)), y, r * Math.cos(deg(az))];
/** Tank coordinates -> world. */
const W = (p: Vec3): Vec3 => [p[0], p[1] + SKID_H, p[2]];
/** A point `d` metres out along a nozzle axis (tank coordinates). */
const along = (n: TankNozzle, d: number): Vec3 => [n.position[0] + n.direction[0] * d, n.position[1] + n.direction[1] * d, n.position[2] + n.direction[2] * d];
/** Height of the outer top-head surface at radius r (bisection on TL.radiusAt). */
function headY(r: number): number {
  let lo = TL.yT2;
  let hi = TL.yTop;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (TL.radiusAt(m) > r) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** JB-101 on the leg at 125° (standoff bracket; instrument cables run down the leg face behind it, loop up into
 * the bottom glands; the multicore leaves a gland down the leg to the deck trunking). Tank coordinates. */
const LEG_AZ = 125;
const LEG_R = TL.radius + 0.04;
const JB1 = { y: 0.6, r: LEG_R + 0.07, size: [0.2, 0.16, 0.09] as Vec3, glands: 6 } as const;
/** Point on the leg's radial plane: radial distance r, height y, tangential offset t (+ = toward larger azimuth). */
const legPt = (r: number, y: number, t = 0): Vec3 => {
  const a = deg(LEG_AZ);
  return [r * Math.sin(a) + t * Math.cos(a), y, r * Math.cos(a) - t * Math.sin(a)];
};
const JB1_GLANDS = fieldJunctionBoxGlands(JB1.size, JB1.glands).map((g) => ({ t: g[0], y: JB1.y + g[1], r: JB1.r + JB1.size[2] * 0.36 }));
/** From a shell lane (azimuth, from height yTop) down the shell, over the leg top, down the leg face, into gland i. */
function intoJb(i: number, laneAz: number, yTop: number): Vec3[] {
  const g = JB1_GLANDS[i]!;
  const t = g.t * 0.55;
  const yl = g.y - 0.055 - 0.009 * i;
  return [
    P(laneAz, TL.radius + 0.022, yTop),
    P(laneAz, TL.radius + 0.022, 1.2),
    legPt(LEG_R + 0.055, 1.085, t),
    legPt(LEG_R + 0.045, 0.97, t),
    legPt(LEG_R + 0.04, yl + 0.04, t),
    legPt((LEG_R + 0.04 + g.r) / 2, yl, (t + g.t) / 2),
    legPt(g.r, yl + 0.015, g.t),
    legPt(g.r, g.y - 0.015, g.t),
    legPt(g.r, g.y + 0.003, g.t),
  ];
}
/** Route for an instrument mounted on nozzle `n` (its cableTo is read in the nozzle frame). */
function route(n: TankNozzle, pts: Vec3[]): FieldCableRoute {
  const loc = pts.map((p) => nozzleLocal(n, p));
  return { via: loc.slice(0, -1), to: loc[loc.length - 1]! };
}

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

function paintFloor(p: FloorPainter) {
  // walkway
  p.rect(-8, 2.35, 8, 3.6, WALKWAY);
  p.line([[-8, 2.35], [8, 2.35]], 0.08, YELLOW);
  p.line([[-8, 3.6], [8, 3.6]], 0.08, YELLOW);
  for (let x = -6; x <= 6; x += 4) p.arrow(x, 2.97, 0.9, Math.PI, '#e9eef0');
  p.text('WALKWAY', 0.6, 2.97, 0.2, '#e9eef0');
  // skid bund: hatched curb
  const bx0 = -1.5;
  const bx1 = 1.72;
  const bz0 = -1.9;
  const bz1 = 1.28;
  const c = 0.14;
  p.hatch(bx0, bz0, bx1, bz0 + c, 0.1);
  p.hatch(bx0, bz1 - c, bx1, bz1, 0.1);
  p.hatch(bx0, bz0, bx0 + c, bz1, 0.1);
  p.hatch(bx1 - c, bz0, bx1, bz1, 0.1);
  p.rect(bx0 + c, bz0 + c, bx1 - c, bz1 - c, '#6a7174');
  p.text('BUNDED AREA · T-101', 0.1, 1.6, 0.12, YELLOW);
  // valve station & feed area
  p.line([[-5.2, -1.05], [-1.62, -1.05], [-1.62, 0.95], [-5.2, 0.95], [-5.2, -1.05]], 0.07, YELLOW);
  p.text('FEED / VALVE STATION', -3.4, 1.18, 0.11, YELLOW);
  // keep-clear in front of the cabinet
  p.hatch(CAB.x - 0.62, WALL_Z + 0.02, CAB.x + 0.62, WALL_Z + 0.95, 0.12);
  p.text('KEEP CLEAR', CAB.x, WALL_Z + 1.15, 0.13, YELLOW);
  // operator panel standing area
  p.outline(PANEL.x - 0.45, PANEL.z + 0.05, PANEL.x + 0.55, PANEL.z + 0.85, 0.05, YELLOW);
  // eyewash station marking by the wall
  p.rect(-5.7, WALL_Z + 0.1, -4.9, WALL_Z + 0.9, '#1f8a4c');
  p.text('EYE WASH', -5.3, WALL_Z + 1.1, 0.1, '#1f8a4c');
  p.text('MIXING AREA 3', 0.2, WALL_Z + 1.35, 0.2, '#d8dde0');
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

function TankSounds({ state }: { state: TankProcessState }) {
  useSceneLoops(['motor', 'pump', 'horn'], (l) => {
    l.motor = (state.agitatorRpm / 90) * 0.55;
    l.pump = state.inflowRate > 0.01 ? 0.75 : 0;
    l.horn = state.alarmHorn ? 1 : 0;
  });
  useEdge(
    () => state.heaterOn,
    () => playSfx('contactor'),
  );
  useEdge(
    () => state.mixerEnergized,
    () => playSfx('contactor'),
  );
  useEdge(
    () => state.fillValve,
    () => playSfx('pneumatic'),
  );
  useEdge(
    () => state.drainValve,
    () => playSfx('pneumatic'),
  );
  return null;
}

// ---------------------------------------------------------------------------
// Hand valve (block / isolation valves around the control valve)
// ---------------------------------------------------------------------------

function HandValve({ position, open = true }: { position: Vec3; open?: boolean }) {
  return (
    <group position={position}>
      <mesh rotation={[0, 0, Math.PI / 2]} material={steel('#c7ccd0', 0.3)} castShadow>
        <cylinderGeometry args={[0.042, 0.042, 0.1, 20]} />
      </mesh>
      <mesh material={steel('#c7ccd0', 0.3)} position={[0, 0.045, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.04, 12]} />
      </mesh>
      <mesh material={paint('#c62828', 0.45)} position={[open ? 0.06 : 0, 0.07, open ? 0 : 0.06]} rotation={[0, open ? 0 : Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.16, 0.012, 0.022]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

/** Memoised (see the conveyor view): the static tree renders once, motion happens in useFrame. */
export const TankProcessView = memo(function TankProcessView({ state, runtime }: SceneViewProps<TankProcessState>) {
  const g = useMemo(
    () => ({
      level: () => state.level,
      temp: () => state.temperature,
      rpm: () => state.agitatorRpm,
      heater: () => state.heaterGlow > 0.35,
    }),
    [state],
  );
  const inlet = W(N.inlet.position);
  // main feed path: pump discharge -> FCV branch -> riser -> over to the inlet nozzle
  const feedPath: Vec3[] = [
    [PUMP.casingX - 0.02, PUMP.shaftY + 0.19, ZI],
    [PUMP.casingX - 0.02, VS.yLow, ZI],
    [VS.xb, VS.yLow, ZI],
    [VS.xb, VS.yTop, ZI],
    [inlet[0], VS.yTop, ZI],
    [inlet[0], inlet[1] + 0.005, ZI],
  ];
  const bypass: Vec3[] = [
    [VS.xa, VS.yLow, ZI],
    [VS.xa, VS.yHigh, ZI],
    [VS.xb, VS.yHigh, ZI],
  ];
  const outlet: Vec3[] = [
    [0, SKID_H + N.outlet.position[1] - 0.115, 0],
    [0, OUTLET.y, 0],
    [OUTLET.xEnd, OUTLET.y, 0],
    [OUTLET.xEnd, 0.22, 0],
  ];
  const ltTop = along(N.lt, 0.22);
  const ttHead = along(N.tt, 0.2);
  const heaterBox = along(N.heater, 0.2);
  const lshC = along(N.lsh, 0.1);
  const lshhC = along(N.lshh, 0.1);
  const lslC = along(N.lsl, 0.1);

  // ---- instrument cable routes (each device's own cordset, routed into JB-101; no second scene cable) ----
  const routes = useMemo(() => {
    const lane = (i: number) => 117.5 + i * 1.4;
    const lt = N.lt.position;
    const ltEdgeY = headY(TL.radius * 0.86);
    const lslR = TL.radiusAt(N.lsl.position[1]);
    return {
      lshh: route(N.lshh, [P(101, 0.83, 1.975), P(107, TL.radius + 0.07, 1.95), ...intoJb(0, lane(0), 1.94)]),
      lsh: route(N.lsh, [P(82, 0.83, 1.87), P(94, TL.radius + 0.06, 1.85), P(106, TL.radius + 0.025, 1.845), ...intoJb(1, lane(1), 1.84)]),
      lt: route(N.lt, [
        [lt[0] - 0.13, lt[1] + 0.14, lt[2] - 0.03],
        [lt[0] - 0.02, headY(0.5) + 0.04, lt[2] - 0.22],
        P(lane(2) - 2, TL.radius * 0.86, ltEdgeY + 0.025),
        P(lane(2), TL.radius + 0.02, TL.yT2 + 0.015),
        ...intoJb(2, lane(2), TL.yT2 - 0.05),
      ]),
      tt: route(N.tt, [P(57, 0.93, 1.1), P(63, TL.radius + 0.08, 1.2), P(78, TL.radius + 0.028, 1.215), P(95, TL.radius + 0.024, 1.215), P(108, TL.radius + 0.022, 1.21), ...intoJb(3, lane(3), 1.205)]),
      // LSL sits in the bottom head: hug the head surface round to the leg, join the leg lane below its top
      lsl: route(N.lsl, [P(90, lslR + 0.15, 0.69), P(100, TL.radiusAt(0.68) + 0.035, 0.68), P(112, TL.radiusAt(0.68) + 0.04, 0.675), ...intoJb(4, lane(4), 0.9).slice(4)]),
    };
  }, []);
  const tankCables = useMemo(
    () => ({
      // heater power: down from the gland to the deck, into the skid trunking
      heater: { via: [[0.56, 0.45, -0.66] as Vec3, [0.6, 0.05, -0.64] as Vec3], to: [0.7, 0.012, -0.62] as Vec3 },
      // agitator motor: over the top head to the platform front beam, tied along it into the riser ladder
      agitator: {
        via: [[0.16, 2.62, -0.2] as Vec3, [0.4, 2.12, -0.58] as Vec3, [0.62, 1.8, -0.72] as Vec3, [0.95, 1.79, -0.72] as Vec3],
        to: [RISER.x - 0.03, 1.78, RISER.z + 0.035] as Vec3,
      },
    }),
    [],
  );

  const cables = useMemo<CableSpec[]>(() => {
    const g5 = JB1_GLANDS[5]!;
    return [
      // JB-101 multicore: out of gland 5, down the leg to the deck trunking
      { points: [W(legPt(g5.r, g5.y + 0.003, g5.t)), W(legPt(g5.r, g5.y - 0.03, g5.t)), W(legPt(LEG_R + 0.045, 0.3, g5.t * 0.4)), W(legPt(LEG_R + 0.05, 0.04, 0)), [0.66, SKID_H + 0.02, -0.52], [0.7, SKID_H + 0.012, -0.6]], radius: 0.007, color: '#6f7479' },
      // FCV-101 positioner (4-20 mA) along the pipe to the column, down into its floor conduit
      { points: [[VS.xv + 0.085, VS.yLow + 0.175, ZI + 0.02], [VS.xv + 0.1, VS.yLow + 0.08, ZI + 0.045], [-1.5, VS.yLow + 0.045, ZI + 0.02], [VCOL.x - 0.08, 0.72, VCOL.z + 0.06], [VCOL.x + 0.045, 0.6, VCOL.z + 0.055], [VCOL.x + 0.045, 0.3, VCOL.z + 0.055], [VCOL.x + 0.06, 0.14, VCOL.z + 0.06]], radius: 0.0035, color: '#35383c' },
      // FCV-101 positioner air supply from the column FRL
      { points: [[VCOL.x + 0.06, 1.02, VCOL.z + 0.03], [VCOL.x + 0.05, 0.92, VCOL.z + 0.06], [VCOL.x - 0.06, VS.yLow + 0.06, ZI + 0.03], [-1.45, VS.yLow + 0.05, ZI + 0.035], [VS.xv + 0.16, VS.yLow + 0.05, ZI + 0.035], [VS.xv + 0.12, VS.yLow + 0.2, ZI - 0.03], [VS.xv + 0.085, VS.yLow + 0.29, ZI - 0.045]], radius: 0.003, color: '#1f5fd0' },
      // instrument-air drop: galvanized pipe from the rack header down the valve-station column to the FRL
      { points: [[VCOL.x, 3.22, RACK.z - 0.05], [VCOL.x, 2.86, RACK.z + 0.1], [VCOL.x, 2.84, -1.4], [VCOL.x, 2.84, VCOL.z - 0.04], [VCOL.x + 0.035, 2.74, VCOL.z], [VCOL.x + 0.035, 1.12, VCOL.z]], radius: 0.011, color: '#aab1b6' },
      // AH-101 beacon: along the left handrail to the rack column, up into the tray
      { points: [[PLATFORM.x0 + 0.01, PLATFORM.y + 1.13, PLATFORM.z1 - 0.02], [PLATFORM.x0 + 0.015, PLATFORM.y + 1.125, PLATFORM.z1 - 0.2], [PLATFORM.x0 + 0.015, PLATFORM.y + 1.125, PLATFORM.z0 + 0.1], [-1.4, 3.3, -1.95], [-1.5, TRAY.y + 0.02, TRAY.z + 0.05]], radius: 0.004, color: '#6f7479' },
    ];
  }, []);

  return (
    <TagLayer runtime={runtime}>
      <FactoryHall
        floor={[-7.5, 6.5, WALL_Z, 5]}
        backWallZ={WALL_Z}
        leftWallX={-6.4}
        wallHeight={8}
        columns={[
          { x: -3.2, z: WALL_Z + 0.16 },
          { x: 2.0, z: WALL_Z + 0.16 },
          { x: -6.24, z: 0.8, ry: Math.PI / 2 },
        ]}
        lights={[
          [-4, -1],
          [0, -1],
          [4, -1],
          [-4, 3],
          [0, 3],
          [4, 3],
        ]}
        paintFloor={paintFloor}
        seed={9}
      />

      {/* ------------------------------ process skid ------------------------------ */}
      <Skid />
      <group position={[0, SKID_H, 0]}>
        <Tank diameter={TANK_D} height={TANK_H} getLevel={g.level} getTemperature={g.temp} getAgitatorRpm={g.rpm} getHeaterOn={g.heater} cutaway tag="T-101" cables={tankCables} />
        <LiquidGuard state={state} />
        <OnNozzle nozzle={N.lt}>
          <LevelTransmitter getValue={() => state.ltReading} units="%" tagLabel="LT-101" antenna="lens" cableTo={routes.lt} />
        </OnNozzle>
        <OnNozzle nozzle={N.tt}>
          <TempTransmitter getValue={() => state.ttReading} units="°C" tagLabel="TT-101" range={[0, 150]} cableTo={routes.tt} />
        </OnNozzle>
        <OnNozzle nozzle={N.lsl}>
          <LevelSwitch getActive={() => state.lsl} cableTo={routes.lsl} />
        </OnNozzle>
        <OnNozzle nozzle={N.lsh}>
          <LevelSwitch getActive={() => state.lsh} cableTo={routes.lsh} />
        </OnNozzle>
        <OnNozzle nozzle={N.lshh}>
          <LevelSwitch getActive={() => state.lshh} cableTo={routes.lshh} />
        </OnNozzle>
        <HeaterCue state={state} />
        <TankFx state={state} />
        {/* JB-101 on its standoff bracket on the leg at 125° */}
        <Instances
          geometry={unitBox}
          material={steel('#c3c8cc', 0.42)}
          items={[-1, 1].map((sy) => ({ p: legPt((LEG_R + 0.03 + JB1.r) / 2, JB1.y + sy * 0.05, 0), r: [0, deg(LEG_AZ), 0] as Vec3, s: [0.05, 0.02, JB1.r - LEG_R - 0.03] as Vec3 }))}
        />
        <FieldJunctionBox size={JB1.size} glands={JB1.glands} label="JB-101" position={legPt(JB1.r, JB1.y, 0)} rotation={[0, deg(LEG_AZ), 0]} />
        {/* tag plates for the level switches (large enough to read in the tank preset) */}
        <WallSign lines={['LSL-101', '10 %']} position={P(85, TL.radiusAt(N.lsl.position[1] - 0.1) + 0.035, N.lsl.position[1] - 0.1)} rotation={[0, deg(85), 0]} size={[0.13, 0.055]} bg="#d5d9dc" />
        <WallSign lines={['LSH-101', '90 %']} position={P(80, TL.radius + 0.004, N.lsh.position[1] - 0.1)} rotation={[0, deg(80), 0]} size={[0.13, 0.055]} bg="#d5d9dc" />
        <WallSign lines={['LSHH-101', '97 % N.C.']} position={P(96, TL.radius + 0.004, N.lshh.position[1] - 0.11)} rotation={[0, deg(96), 0]} size={[0.13, 0.055]} bg="#f2d24a" />

        {/* -------- instrument hotspots (tank-local) -------- */}
        <IoHotspot runtime={runtime} device="lt-101" title="LT-101 · 80 GHz radar" size={[0.2, 0.3, 0.2]} position={[ltTop[0], ltTop[1] - 0.06, ltTop[2]]} anchor={[ltTop[0] + 0.14, ltTop[1] + 0.12, ltTop[2]]} />
        <IoHotspot runtime={runtime} device="tt-101" title="TT-101 · RTD transmitter" size={[0.2, 0.2, 0.2]} position={ttHead} anchor={[ttHead[0] + 0.14, ttHead[1] + 0.04, ttHead[2] + 0.06]} />
        <IoHotspot runtime={runtime} device="lsl-101" title="LSL-101 · 10 %" size={[0.14, 0.14, 0.14]} position={lslC} anchor={[lslC[0] + 0.14, lslC[1] - 0.03, lslC[2] + 0.1]} />
        <IoHotspot runtime={runtime} device="lsh-101" title="LSH-101 · 90 %" size={[0.14, 0.12, 0.14]} position={lshC} anchor={[lshC[0] + 0.14, lshC[1] - 0.02, lshC[2] + 0.12]} />
        <IoHotspot runtime={runtime} device="lshh-101" title="LSHH-101 · N.C. fail-safe: 0 = HIGH-HIGH" size={[0.14, 0.12, 0.14]} position={lshhC} anchor={[lshhC[0] + 0.14, lshhC[1] + 0.08, lshhC[2]]} />
        <IoHotspot runtime={runtime} device="mixer" title="M-101 agitator" size={[0.34, 0.8, 0.34]} position={[0, TL.yTop + 0.45, 0]} anchor={[0.24, TL.yTop + 0.75, 0.05]} />
        <IoHotspot runtime={runtime} device="heater" title="EH-101 immersion heater 18 kW" size={[0.26, 0.3, 0.26]} position={heaterBox} anchor={[heaterBox[0] + 0.16, heaterBox[1] + 0.12, heaterBox[2]]} />
        <IoHotspot
          runtime={runtime}
          title="JB-101 · skid junction box"
          info={['LT-101, TT-101 and the three level switches land here; one multicore runs via the deck trunking and the riser ladder to CP-301.']}
          size={[JB1.size[0], JB1.size[1], JB1.size[2]]}
          position={legPt(JB1.r + JB1.size[2] / 2, JB1.y, 0)}
          rotation={[0, deg(LEG_AZ), 0]}
          anchor={legPt(JB1.r + 0.1, JB1.y - 0.1, 0.12)}
        />
      </group>
      <Platform />
      <AlarmBeacon state={state} runtime={runtime} position={[PLATFORM.x0, PLATFORM.y + 1.12, PLATFORM.z1]} />
      <LocalIndicator state={state} position={[0.74, PLATFORM.y + 0.74, PLATFORM.z1 + 0.05]} rotationY={-0.12} />
      <IoHotspot
        runtime={runtime}
        title="LI/TI-101 · local field display"
        info={['Loop-powered display in the LT-101 / TT-101 4-20 mA loops: shows what the PLC reads on LT_101 and TT_101, plus heater and mixer status.']}
        size={[0.34, 0.24, 0.1]}
        position={[0.74, PLATFORM.y + 0.73, PLATFORM.z1 + 0.02]}
        anchor={[0.95, PLATFORM.y + 0.88, PLATFORM.z1 + 0.05]}
      />

      {/* ------------------------------ feed & valve station ------------------------------ */}
      <FeedTank state={state} />
      <FeedPump state={state} />
      <IoHotspot
        runtime={runtime}
        title="P-100 feed pump · local control"
        info={[
          'Not a PLC output: PS-100 starts the pump from its local starter when XV-101 / FCV-101 open and the line pressure drops, and stops it when they close.',
        ]}
        size={[0.9, 0.5, 0.45]}
        position={[(PUMP.casingX + PUMP.motorX) / 2, 0.35, ZI]}
        anchor={[PUMP.motorX + 0.3, 0.75, ZI + 0.15]}
      />
      <PipeRun points={[[FEED.x + FEED.r + 0.12, PUMP.shaftY, ZI], [PUMP.casingX - 0.14, PUMP.shaftY, ZI]]} diameter={0.0889} finish="stainless" flangesAt={[1]} />
      <PipeRun points={feedPath} diameter={PIPE_D} flangesAt={[0, 5]} />
      <PipeRun points={bypass} diameter={PIPE_D} />
      {/* tee bosses */}
      <Instances
        geometry={unitBox}
        material={steel('#d5dade', 0.28)}
        items={[
          { p: [VS.xa, VS.yLow, ZI], s: [0.075, 0.075, 0.075] },
          { p: [VS.xb, VS.yHigh, ZI], s: [0.075, 0.075, 0.075] },
        ]}
      />
      <SolenoidValve
        variant="process"
        position={[VS.xv, VS.yHigh, ZI]}
        getEnergized={() => state.fillValve}
        tag="XV-101"
        pipeStubs={0}
        cableTo={{ via: [[VS.xv + 0.06, VS.yHigh + 0.07, ZI + 0.09], [-1.5, VS.yHigh + 0.045, ZI + 0.03], [VCOL.x - 0.07, VS.yHigh - 0.05, VCOL.z + 0.09], [VCOL.x + 0.045, 1.15, VCOL.z + 0.03], [VCOL.x + 0.045, 0.35, VCOL.z + 0.02]], to: [VCOL.x + 0.06, 0.14, VCOL.z] }}
        tubeTo={{ via: [[VS.xv + 0.1, VS.yHigh + 0.06, ZI + 0.035], [-1.45, VS.yHigh + 0.05, ZI + 0.04], [VCOL.x - 0.07, VS.yHigh - 0.04, VCOL.z + 0.1], [VCOL.x + 0.05, 1.22, VCOL.z + 0.045]], to: [VCOL.x + 0.06, 1.1, VCOL.z + 0.03] }}
      />
      <ControlValve position={[VS.xv, VS.yLow, ZI]} getOpening={() => state.fcvStroke} getDisplay={() => state.fcvPosition} tag="FCV-101" />
      <FieldMerge>
        <HandValve position={[VS.xv - 0.32, VS.yLow, ZI]} />
        <HandValve position={[VS.xv + 0.32, VS.yLow, ZI]} />
        <ColumnFrl position={[VCOL.x + 0.035, 1.0, VCOL.z]} />
      </FieldMerge>
      {/* pipe supports, the valve-station column with FRL and floor conduits */}
      <Instances
        geometry={unitBox}
        material={paint('#35536f', 0.5, 0.4)}
        items={[
          { p: [VS.xa - 0.25, (VS.yLow - 0.04) / 2, ZI], s: [0.06, VS.yLow - 0.04, 0.06] },
          { p: [VS.xa - 0.25, VS.yLow - 0.05, ZI], s: [0.12, 0.02, 0.1] },
          { p: [VCOL.x, (VS.yTop - 0.04) / 2, VCOL.z], s: [0.06, VS.yTop - 0.04, 0.06] },
          { p: [VS.xb + 0.06, 1.8, ZI - 0.06], s: [0.14, 0.02, 0.1] },
          { p: [VS.xb + 0.06, VS.yTop - 0.05, ZI - 0.06], s: [0.14, 0.02, 0.1] },
        ]}
      />
      <ConduitStub visible position={[VCOL.x + 0.06, 0.14, VCOL.z]} />
      <ConduitStub visible position={[VCOL.x + 0.06, 0.14, VCOL.z + 0.06]} />
      <IoHotspot runtime={runtime} device="xv-101" title="XV-101 fill valve" size={[0.34, 0.36, 0.22]} position={[VS.xv, VS.yHigh + 0.1, ZI]} anchor={[VS.xv - 0.2, VS.yHigh + 0.3, ZI + 0.1]} />
      <IoHotspot runtime={runtime} device="fcv-101" title="FCV-101 control valve" size={[0.4, 0.55, 0.36]} position={[VS.xv, VS.yLow + 0.22, ZI]} anchor={[VS.xv - 0.24, VS.yLow + 0.12, ZI + 0.2]} />

      {/* ------------------------------ outlet ------------------------------ */}
      <PipeRun points={outlet} diameter={PIPE_D} flangesAt={[0]} />
      <SolenoidValve
        variant="process"
        position={[OUTLET.xv, OUTLET.y, 0]}
        getEnergized={() => state.drainValve}
        tag="XV-102"
        pipeStubs={0}
        cableTo={{ via: [[OUTLET.xv + 0.06, 0.31, 0.13], [OUTLET.xv + 0.08, SKID_H + 0.016, 0.1], [0.72, SKID_H + 0.016, -0.25]], to: [0.7, SKID_H + 0.014, -0.52] }}
        tubeTo={{ via: [[OUTLET.xv + 0.13, 0.33, 0.05], [OUTLET.xv + 0.12, SKID_H + 0.016, 0.02], [0.76, SKID_H + 0.016, -0.3]], to: [0.74, SKID_H + 0.014, -0.52] }}
      />
      <Tundish position={[OUTLET.xEnd, 0, 0]} state={state} />
      <IoHotspot runtime={runtime} device="xv-102" title="XV-102 drain valve" size={[0.34, 0.36, 0.22]} position={[OUTLET.xv, OUTLET.y + 0.1, 0]} anchor={[OUTLET.xv + 0.22, OUTLET.y + 0.3, 0.12]} />

      {/* ------------------------------ cable management ------------------------------ */}
      <PipeRack />
      <CableTray
        points={[
          [CAB.x, CAB.y + CAB.size[1] + 0.02, WALL_Z + 0.15],
          [CAB.x, TRAY.y, WALL_Z + 0.15],
          [CAB.x, TRAY.y, TRAY.z],
          [-4.8, TRAY.y, TRAY.z],
        ]}
        hangTo={7}
      />
      {/* skid deck trunking -> riser ladder on the platform column -> over the platform to the main tray */}
      <CableTray points={[[0.7, SKID_H + 0.004, -0.46], [0.7, SKID_H + 0.004, -0.62], [RISER.x, SKID_H + 0.004, -0.62]]} width={0.1} depth={0.04} cables={['#6f7479', '#1b1b1b', '#35383c']} />
      <CableTray points={[[RISER.x, SKID_H + 0.02, RISER.z], [RISER.x, TRAY.y, RISER.z], [RISER.x, TRAY.y, TRAY.z]]} width={0.15} depth={0.05} cables={['#6f7479', '#1b1b1b', '#1b1b1b', '#35383c']} />
      <Cables cables={cables} />

      {/* ------------------------------ operator & controls ------------------------------ */}
      <OperatorPanel state={state} runtime={runtime} />
      <ControlCabinet
        runtime={runtime}
        size={CAB.size}
        nameplate={'CP-301\nMIXING TANK T-101'}
        position={[CAB.x, CAB.y, WALL_Z]}
        fieldTerminals={28}
        loads={[
          { kind: 'starter', getEnergized: () => state.mixerEnergized, aliases: ['Mixer', 'Mixer_Running'], title: 'K1 · M-101 agitator starter' },
          { kind: 'contactor', getEnergized: () => state.heaterOn, catalog: '100-C23', aliases: ['Heater'], title: 'K2 · heater contactor' },
        ]}
        getSafetyOk={() => !state.controls.estop}
      />

      {/* ------------------------------ props & signage ------------------------------ */}
      <IbcTote position={[-4.6, 0, 1.9]} rotationY={0.1} />
      <PalletStack position={[4.9, 0, -1.6]} rotationY={Math.PI / 2} kind="tall" cols={4} rows={3} layers={2} wrapped />
      <Bollards at={[[-1.62, 1.4], [CAB.x - 0.75, WALL_Z + 1.0], [CAB.x + 0.75, WALL_Z + 1.0]]} />
      <FloorDrain position={[-1.32, 0, 1.12]} size={0.26} />
      <FloorDrain position={[1.55, 0, 1.12]} size={0.26} />
      {/* area sign hung on the front of the pipe rack (the back wall is hidden behind the rack from the aisle) */}
      <WallSign lines={['MIXING', 'AREA 3']} position={[-2.9, RACK.y + 0.66, RACK.z + 0.43]} size={[1.3, 0.55]} bg="#1d4f91" color="#ffffff" />
      <WallSign lines={['CAUTION', 'HOT SURFACES', 'HOT LIQUID']} kind="warning" position={[-2.3, 1.62, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <WallSign lines={['WEAR', 'EYE PROTECTION']} kind="mandatory" position={[-1.7, 1.62, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <WallSign lines={['EMERGENCY', 'EYE WASH']} kind="info" position={[-5.3, 1.9, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <EyeWash position={[-5.3, 0, WALL_Z + 0.02]} />
      <FireExtinguisher position={[1.4, 1.0, WALL_Z + 0.32]} />
      <WallSign lines={['PLC ACCESS', 'AUTHORIZED ONLY']} kind="warning" position={[CAB.x, CAB.y + CAB.size[1] + 0.45, WALL_Z + 0.02]} size={[0.5, 0.42]} />

      <TankSounds state={state} />
      <ShadowBudget minRadius={0.1} />
    </TagLayer>
  );
});

/** Instrument-air filter-regulator on the valve-station column (+X face). */
function ColumnFrl({ position }: { position: Vec3 }) {
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      <mesh material={paint('#2c3136', 0.45, 0.3)} position={[0, 0.07, 0.02]} castShadow>
        <boxGeometry args={[0.045, 0.05, 0.045]} />
      </mesh>
      <mesh material={paint('#aab3bb', 0.3, 0.2)} position={[0, 0.02, 0.02]}>
        <cylinderGeometry args={[0.018, 0.014, 0.06, 18]} />
      </mesh>
      <mesh position={[0, 0.07, 0.05]} rotation={[Math.PI / 2, 0, 0]} material={paint('#1b1c1e', 0.4, 0.1)}>
        <cylinderGeometry args={[0.018, 0.018, 0.012, 20]} />
      </mesh>
      <mesh position={[0, 0.07, 0.0565]} material={paint('#f4f4f0', 0.3, 0)}>
        <circleGeometry args={[0.015, 20]} />
      </mesh>
    </group>
  );
}

/** Plumbed emergency eye-wash (wall-mounted bowl with two spray heads). Origin: wall at the floor. */
function EyeWash({ position }: { position: Vec3 }) {
  const green = paint('#1f8a4c', 0.45, 0.2);
  return (
    <FieldMerge position={position}>
      <mesh geometry={unitCylY} material={steel('#c7ccd0', 0.3)} position={[0, 0.5, 0.06]} scale={[0.02, 1.0, 0.02]} castShadow />
      <mesh material={green} position={[0, 1.0, 0.2]} castShadow>
        <cylinderGeometry args={[0.16, 0.1, 0.1, 28, 1, true]} />
      </mesh>
      <mesh material={green} position={[0, 0.955, 0.2]}>
        <cylinderGeometry args={[0.1, 0.1, 0.01, 28]} />
      </mesh>
      {[-0.05, 0.05].map((x) => (
        <mesh key={x} material={paint('#e8b90f', 0.4)} position={[x, 1.02, 0.2]}>
          <cylinderGeometry args={[0.018, 0.018, 0.04, 14]} />
        </mesh>
      ))}
      <mesh material={green} position={[0.12, 1.05, 0.08]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.2, 0.03, 0.03]} />
      </mesh>
    </FieldMerge>
  );
}

export default TankProcessView;
