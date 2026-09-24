/**
 * `tank-process` digital twin — a mixing & heating skid in a process hall.
 *
 *   feed tank T-100 → pump P-100 → valve station (XV-101 on/off fast-fill branch ∥ FCV-101 control valve)
 *   → 2000 L stainless mixing tank T-101 (cut-away: live level, temperature tint, agitator M-101, immersion
 *   heater, inlet stream, bubbles / boiling / steam, overflow spill) with LT-101 radar, TT-101, LSL/LSH/LSHH
 *   level switches → bottom outlet XV-102 → drain tundish. Access platform + ladder, pipe rack with cable
 *   tray, local operator panel (Start / Stop / Discharge / E-stop, RUNNING & BATCH DONE lights, alarm
 *   beacon-sounder) and the control cabinet with the ControlLogix 1756-A10 rack (L85E, IB16, OB16E, IF8, OF8).
 *
 * Everything animates from TankProcessState inside useFrame; the view never ticks the runtime.
 */
import { memo, useMemo } from 'react';
import {
  LevelSwitch,
  LevelTransmitter,
  OnNozzle,
  PipeRun,
  SolenoidValve,
  Tank,
  TempTransmitter,
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
  WALKWAY,
  WallSign,
  YELLOW,
  type CableSpec,
  type FloorPainter,
} from '../conveyor-sort/hall';
import { IoHotspot, playSfx, ShadowBudget, TagOcclusion, useEdge, useSceneLoops } from '../conveyor-sort/kit';
import { ControlValve } from './ControlValve';
import type { TankProcessState } from './logic';
import {
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
  TankFx,
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
const OUTLET = { y: 0.28, xv: 0.85, xEnd: 1.75 } as const;
const TRAY = { y: 3.46, z: RACK.z } as const;

/** Instrument cable: head → down the shell at the instrument's azimuth → across to the junction box (world). */
function shellRun(from: Vec3, phiDeg: number, jb: Vec3, k: number): CableSpec {
  const phi = (phiDeg * Math.PI) / 180;
  const r = TL.radius + 0.07;
  const x = Math.sin(phi) * r;
  const z = Math.cos(phi) * r;
  const low = jb[1] - 0.12 - k * 0.02;
  return {
    points: [from, [x, Math.min(from[1] - 0.05, from[1]), z], [x, low + 0.12, z], [(x + jb[0]) / 2, low, (z + jb[2]) / 2 + 0.05], [jb[0] - 0.06 + k * 0.025, jb[1] - 0.11, jb[2]]],
    radius: 0.0035,
    color: '#e8b90f',
  };
}

function instrumentCables(jb: Vec3): CableSpec[] {
  const w = (p: Vec3): Vec3 => [p[0], p[1] + SKID_H, p[2]];
  const ltHead = w(along(N.lt, 0.16));
  const lsh = w(along(N.lsh, 0.13));
  const lshh = w(along(N.lshh, 0.13));
  const lsl = w(along(N.lsl, 0.13));
  const tt = w(along(N.tt, 0.15));
  return [
    (() => {
      const run = shellRun([0, TL.yT2 + SKID_H, 0], 95, jb, 0);
      const edge = run.points[1]!;
      return { ...run, points: [ltHead, [ltHead[0] + 0.1, ltHead[1] - 0.08, ltHead[2]], [edge[0] * 0.97, TL.yT2 + SKID_H + 0.05, edge[2] * 0.97], ...run.points.slice(1)] };
    })(),
    shellRun(lsh, 80, jb, 1),
    shellRun(lshh, 100, jb, 2),
    shellRun(lsl, 85, jb, 3),
    shellRun(tt, 55, jb, 4),
  ];
}

/** Nozzle flange face in world coordinates. */
const nzw = (n: TankNozzle): Vec3 => [n.position[0], n.position[1] + SKID_H, n.position[2]];
/** A point `d` metres out along a nozzle axis (tank-local). */
const along = (n: TankNozzle, d: number): Vec3 => [n.position[0] + n.direction[0] * d, n.position[1] + n.direction[1] * d, n.position[2] + n.direction[2] * d];

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
  p.text('BUNDED AREA · T-101', 0.1, 1.55, 0.12, YELLOW);
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
  const inlet = nzw(N.inlet);
  // main feed path: pump discharge → FCV branch → riser → over to the inlet nozzle
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
  // instrument junction box on the platform's front-right column, facing the operator side
  const jb: Vec3 = [PLATFORM.x1 - 0.05, 1.05, PLATFORM.z1 + 0.07];
  const ltTop = along(N.lt, 0.22);
  const ttHead = along(N.tt, 0.2);
  const heaterBox = along(N.heater, 0.2);
  const lshC = along(N.lsh, 0.1);
  const lshhC = along(N.lshh, 0.1);
  const lslC = along(N.lsl, 0.1);
  const cables = useMemo<CableSpec[]>(
    () => [
      // JB multicore up the platform column to the rack tray
      { points: [[jb[0], jb[1] + 0.1, jb[2] - 0.03], [jb[0] + 0.02, 1.6, PLATFORM.z1 - 0.02], [jb[0] + 0.02, PLATFORM.y + 0.4, PLATFORM.z1 - 0.3], [jb[0] + 0.05, TRAY.y - 0.25, TRAY.z + 0.35], [jb[0] + 0.08, TRAY.y + 0.02, TRAY.z]], radius: 0.008, color: '#6f7479' },
      // instrument cables: out of the instrument, down along the shell (each at its own angle), then to the JB
      ...instrumentCables(jb),
      // heater power, agitator motor, valve and pump cables
      { points: [[heaterBox[0], heaterBox[1] + SKID_H + 0.08, heaterBox[2]], [heaterBox[0] + 0.1, 1.6, heaterBox[2] - 0.5], [1.0, 2.6, -1.9], [1.1, TRAY.y + 0.02, TRAY.z]], radius: 0.012, color: '#1b1b1b' },
      { points: [[0.12, TL.yTop + SKID_H + 0.55, -0.1], [0.3, TL.yTop + SKID_H + 0.5, -0.8], [0.35, 3.0, -1.9], [0.4, TRAY.y + 0.02, TRAY.z]], radius: 0.009, color: '#1b1b1b' },
      { points: [[VS.xv, VS.yHigh + 0.3, ZI - 0.05], [VS.xv + 0.1, 2.2, ZI - 0.5], [VS.xv + 0.15, 3.1, -2.0], [VS.xv + 0.2, TRAY.y + 0.02, TRAY.z]], radius: 0.004, color: '#e8b90f' },
      { points: [[VS.xv + 0.09, VS.yLow + 0.3, ZI - 0.04], [VS.xv + 0.3, 1.2, ZI - 0.4], [VS.xv + 0.35, 3.0, -2.0], [VS.xv + 0.4, TRAY.y + 0.02, TRAY.z]], radius: 0.004, color: '#6f7479' },
      { points: [[OUTLET.xv, OUTLET.y + 0.3, -0.05], [OUTLET.xv + 0.3, 0.9, -0.9], [1.25, 2.2, -1.8], [1.3, TRAY.y + 0.02, TRAY.z]], radius: 0.004, color: '#e8b90f' },
      { points: [[PUMP.motorX + 0.05, 0.42, ZI - 0.1], [PUMP.motorX + 0.1, 1.0, ZI - 0.6], [PUMP.motorX + 0.1, 3.0, -2.0], [PUMP.motorX + 0.15, TRAY.y + 0.02, TRAY.z]], radius: 0.009, color: '#1b1b1b' },
      // operator panel cable along the floor to the skid
      { points: [[PANEL.x, 0.05, PANEL.z - 0.05], [PANEL.x - 0.2, 0.02, PANEL.z - 0.8], [1.75, 0.02, 1.35], [1.7, 0.05, 1.25]], radius: 0.01, color: '#2b2b2b' },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <group>
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
        <Tank diameter={TANK_D} height={TANK_H} getLevel={g.level} getTemperature={g.temp} getAgitatorRpm={g.rpm} getHeaterOn={g.heater} cutaway tag="T-101" />
        <OnNozzle nozzle={N.lt}>
          <LevelTransmitter getValue={() => state.ltReading} units="%" tagLabel="LT-101" antenna="lens" />
        </OnNozzle>
        <OnNozzle nozzle={N.tt}>
          <TempTransmitter getValue={() => state.ttReading} units="°C" tagLabel="TT-101" range={[0, 150]} />
        </OnNozzle>
        <OnNozzle nozzle={N.lsl}>
          <LevelSwitch getActive={() => state.lsl} />
        </OnNozzle>
        <OnNozzle nozzle={N.lsh}>
          <LevelSwitch getActive={() => state.lsh} />
        </OnNozzle>
        <OnNozzle nozzle={N.lshh}>
          <LevelSwitch getActive={() => state.lshh} />
        </OnNozzle>
        <TankFx state={state} />
        {/* tag plates for the level switches */}
        <WallSign lines={['LSL-101']} position={[lslC[0] + 0.02, lslC[1] - 0.07, lslC[2] + 0.06]} rotation={[0, 1.4, 0]} size={[0.08, 0.025]} bg="#d5d9dc" />
        <WallSign lines={['LSH-101']} position={[lshC[0] + 0.02, lshC[1] - 0.07, lshC[2] + 0.06]} rotation={[0, 1.4, 0]} size={[0.08, 0.025]} bg="#d5d9dc" />
        <WallSign lines={['LSHH-101']} position={[lshhC[0] + 0.02, lshhC[1] - 0.07, lshhC[2] + 0.02]} rotation={[0, 1.75, 0]} size={[0.08, 0.025]} bg="#d5d9dc" />

        {/* -------- instrument hotspots (tank-local) -------- */}
        <IoHotspot runtime={runtime} device="lt-101" size={[0.2, 0.3, 0.2]} position={[ltTop[0], ltTop[1] - 0.06, ltTop[2]]} anchor={[ltTop[0] + 0.08, ltTop[1] + 0.16, ltTop[2]]} title="LT-101 · 80 GHz radar" />
        <IoHotspot runtime={runtime} device="tt-101" size={[0.2, 0.2, 0.2]} position={ttHead} anchor={[ttHead[0] + 0.06, ttHead[1] + 0.15, ttHead[2] + 0.06]} title="TT-101 · RTD transmitter" />
        <IoHotspot runtime={runtime} device="lsl-101" size={[0.14, 0.14, 0.14]} position={lslC} anchor={[lslC[0] + 0.12, lslC[1], lslC[2] + 0.1]} title="LSL-101 · 10 %" />
        <IoHotspot runtime={runtime} device="lsh-101" size={[0.14, 0.12, 0.14]} position={lshC} anchor={[lshC[0] + 0.12, lshC[1] + 0.02, lshC[2] + 0.12]} title="LSH-101 · 90 %" />
        <IoHotspot runtime={runtime} device="lshh-101" size={[0.14, 0.12, 0.14]} position={lshhC} anchor={[lshhC[0] + 0.14, lshhC[1] + 0.1, lshhC[2]]} title="LSHH-101 · 97 % (N.C.)" />
        <IoHotspot runtime={runtime} device="mixer" size={[0.34, 0.8, 0.34]} position={[0, TL.yTop + 0.45, 0]} anchor={[0.22, TL.yTop + 0.85, 0.05]} title="M-101 agitator" />
        <IoHotspot runtime={runtime} device="heater" size={[0.26, 0.3, 0.26]} position={heaterBox} anchor={[heaterBox[0] + 0.12, heaterBox[1] + 0.2, heaterBox[2]]} title="EH-101 immersion heater 18 kW" />
      </group>
      <Platform />

      {/* ------------------------------ feed & valve station ------------------------------ */}
      <FeedTank />
      <FeedPump state={state} />
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
      <SolenoidValve variant="process" position={[VS.xv, VS.yHigh, ZI]} getEnergized={() => state.fillValve} tag="XV-101" pipeStubs={0} />
      <ControlValve position={[VS.xv, VS.yLow, ZI]} getOpening={() => state.fcvStroke} getDisplay={() => state.fcvPosition} tag="FCV-101" />
      <HandValve position={[VS.xv - 0.32, VS.yLow, ZI]} />
      <HandValve position={[VS.xv + 0.32, VS.yLow, ZI]} />
      {/* pipe supports */}
      <Instances
        geometry={unitBox}
        material={paint('#35536f', 0.5, 0.4)}
        items={[
          { p: [VS.xa - 0.25, (VS.yLow - 0.04) / 2, ZI], s: [0.06, VS.yLow - 0.04, 0.06] },
          { p: [VS.xa - 0.25, VS.yLow - 0.05, ZI], s: [0.12, 0.02, 0.1] },
          { p: [VS.xb + 0.12, (VS.yTop - 0.04) / 2, ZI - 0.12], s: [0.06, VS.yTop - 0.04, 0.06] },
          { p: [VS.xb + 0.06, 1.8, ZI - 0.06], s: [0.14, 0.02, 0.1] },
          { p: [VS.xb + 0.06, VS.yTop - 0.05, ZI - 0.06], s: [0.14, 0.02, 0.1] },
        ]}
      />
      <IoHotspot runtime={runtime} device="xv-101" size={[0.34, 0.36, 0.22]} position={[VS.xv, VS.yHigh + 0.1, ZI]} anchor={[VS.xv - 0.05, VS.yHigh + 0.33, ZI + 0.1]} title="XV-101 fill valve" />
      <IoHotspot runtime={runtime} device="fcv-101" size={[0.4, 0.55, 0.36]} position={[VS.xv, VS.yLow + 0.22, ZI]} anchor={[VS.xv + 0.1, VS.yLow + 0.12, ZI + 0.3]} title="FCV-101 control valve" />

      {/* ------------------------------ outlet ------------------------------ */}
      <PipeRun points={outlet} diameter={PIPE_D} flangesAt={[0]} />
      <SolenoidValve variant="process" position={[OUTLET.xv, OUTLET.y, 0]} getEnergized={() => state.drainValve} tag="XV-102" pipeStubs={0} />
      <Tundish position={[OUTLET.xEnd, 0, 0]} state={state} />
      <IoHotspot runtime={runtime} device="xv-102" size={[0.34, 0.36, 0.22]} position={[OUTLET.xv, OUTLET.y + 0.1, 0]} anchor={[OUTLET.xv + 0.05, OUTLET.y + 0.33, 0.12]} title="XV-102 drain valve" />

      {/* ------------------------------ building services ------------------------------ */}
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
      {/* skid instrument junction box + cables */}
      <group position={jb}>
        <mesh material={paint('#d4d6d1', 0.5, 0.15)} castShadow>
          <boxGeometry args={[0.24, 0.2, 0.09]} />
        </mesh>
        <WallSign lines={['JB-101']} position={[0, 0.03, 0.046]} size={[0.1, 0.03]} bg="#f4f4f0" />
      </group>
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
      />

      {/* ------------------------------ props & signage ------------------------------ */}
      <IbcTote position={[-4.6, 0, 1.9]} rotationY={0.1} />
      <PalletStack position={[4.9, 0, -1.6]} rotationY={Math.PI / 2} kind="tall" cols={4} rows={3} layers={2} wrapped />
      <Bollards at={[[-1.62, 1.4], [CAB.x - 0.75, WALL_Z + 1.0], [CAB.x + 0.75, WALL_Z + 1.0]]} />
      <FloorDrain position={[-0.6, 0, 1.5]} size={0.3} />
      <FloorDrain position={[0.8, 0, 1.5]} size={0.3} />
      <WallSign lines={['MIXING', 'AREA 3']} position={[-0.6, 3.9, WALL_Z + 0.02]} size={[2.0, 0.85]} bg="#1d4f91" color="#ffffff" />
      <WallSign lines={['CAUTION', 'HOT SURFACES', 'HOT LIQUID']} kind="warning" position={[-2.3, 2.1, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <WallSign lines={['WEAR', 'EYE PROTECTION']} kind="mandatory" position={[-1.7, 2.1, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <WallSign lines={['EMERGENCY', 'EYE WASH']} kind="info" position={[-5.3, 1.9, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <EyeWash position={[-5.3, 0, WALL_Z + 0.02]} />
      <FireExtinguisher position={[1.4, 1.0, WALL_Z + 0.32]} />
      <WallSign lines={['PLC ACCESS', 'AUTHORIZED ONLY']} kind="warning" position={[CAB.x, CAB.y + CAB.size[1] + 0.45, WALL_Z + 0.02]} size={[0.5, 0.42]} />

      <TankSounds state={state} />
      <ShadowBudget />
      <TagOcclusion />
    </group>
  );
});

/** Plumbed emergency eye-wash (wall-mounted bowl with two spray heads). Origin: wall at the floor. */
function EyeWash({ position }: { position: Vec3 }) {
  const green = paint('#1f8a4c', 0.45, 0.2);
  return (
    <group position={position}>
      <mesh material={steel('#c7ccd0', 0.3)} position={[0, 0.5, 0.06]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.0, 14]} />
      </mesh>
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
    </group>
  );
}

export default TankProcessView;

