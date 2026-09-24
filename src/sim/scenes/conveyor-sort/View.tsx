/**
 * `conveyor-sort` digital twin — a case-sorting line in a factory hall.
 *
 *   gravity box feeder → 6 m belt conveyor (CV-101) → PE_Infeed · PE_Tall (high) · PE_Divert (diagonal) · PE_Exit
 *   → pneumatic pusher (5/2 valve, reed switches) into the reject chute & tote, short boxes roll out onto the
 *   gravity good lane and are palletised. Operator pedestal (Start / Stop / Feeder mode / E-stop) with an 855T
 *   stack light, wall-mounted control cabinet with the ControlLogix 1756-L83E rack, overhead cable tray,
 *   machine guarding and floor markings.
 *
 * Everything animates from ConveyorSortState inside useFrame; the view never ticks the runtime.
 * Hover any device for its I/O tag chip (or turn on the global overlay: useSceneOverlay().showTags).
 */
import { memo, useMemo } from 'react';
import {
  Boxes,
  Conveyor,
  EStop800FM,
  FieldCable,
  PushButton800F,
  PushButtonStation,
  pushButtonStationHoles,
  SelectorSwitch800F,
  StackLight856T,
  stackLightHeight,
} from '../../../twin/devices';
import type { Vec3 } from '../../../twin/contracts';
import type { SceneViewProps, SimRuntime } from '../../types';
import { ControlCabinet } from './cabinet';
import {
  Bollards,
  Cables,
  CableTray,
  FactoryHall,
  FireExtinguisher,
  FloorDrain,
  Instances,
  PalletStack,
  paint,
  SafetyFence,
  steel,
  unitBox,
  WALKWAY,
  WallSign,
  YELLOW,
  type CableSpec,
  type FloorPainter,
} from './hall';
import { IoHotspot, playSfx, ShadowBudget, TagOcclusion, useEdge, useSceneLoops } from './kit';
import { CONVEYOR_GEOMETRY as G, type ConveyorSortState } from './logic';
import {
  AcrossEye,
  BELT_H,
  CYL,
  DIVERT_EYE,
  DivertEye,
  EYE_Z,
  Feeder,
  GoodLane,
  GoodPallet,
  JunctionBox,
  LAY,
  makeBoxPool,
  mapBoxes,
  PALLET,
  Pusher,
  pusherCables,
  RejectChute,
  sensorCable,
  TOTE,
  TotePile,
  VALVE_POS,
} from './machine';

/** World x of the tail pulley (belt x = 0). */
export const X0 = -3.2;
const wx = (bx: number) => X0 + bx;
/** Back wall and cabinet. */
const WALL_Z = -3.5;
const CAB = { x: -1.3, y: 0.72, size: [0.8, 1.0, 0.3] as Vec3 };
/** Operator pedestal. */
const STATION = { x: X0 - 0.45, z: 1.0, ry: 0.28 };
const TRAY_Y = 2.65;
const TRAY_Z = -1.75;
/** Field junction box on the back side frame (machine frame). */
const JB_POS: Vec3 = [G.beltLength - 0.55, LAY.frameBottom - 0.1, -LAY.frameOuterZ - 0.05];

// ---------------------------------------------------------------------------
// Floor markings
// ---------------------------------------------------------------------------

function paintFloor(p: FloorPainter) {
  // pedestrian walkway along the front
  p.rect(-9, 2.45, 9, 3.75, WALKWAY);
  p.line([[-9, 2.45], [9, 2.45]], 0.08, YELLOW);
  p.line([[-9, 3.75], [9, 3.75]], 0.08, YELLOW);
  for (let x = -7; x <= 7; x += 3.5) p.arrow(x, 3.1, 0.9, x < 0 ? 0 : Math.PI, '#e9eef0');
  p.text('WALKWAY', -1.2, 3.1, 0.22, '#e9eef0');
  // machine zone outline
  p.line([[wx(-1.25), -1.55], [wx(8.2), -1.55], [wx(8.2), 2.25], [wx(-1.25), 2.25], [wx(-1.25), -1.55]], 0.1, YELLOW);
  // keep-clear hatch in front of the cabinet (door swing)
  p.hatch(CAB.x - 0.95, WALL_Z + 0.02, CAB.x + 0.45, WALL_Z + 0.9, 0.12);
  p.text('KEEP CLEAR', CAB.x - 0.25, WALL_Z + 1.12, 0.14, YELLOW);
  // tote & pallet positions
  const tx = wx(TOTE.x);
  corners(p, tx - 0.5, TOTE.z - 0.4, tx + 0.5, TOTE.z + 0.4);
  const px = wx(PALLET.x);
  corners(p, px - 0.7, PALLET.z - 0.5, px + 0.7, PALLET.z + 0.5);
  p.text('FINISHED GOODS', px, PALLET.z + 0.72, 0.1, YELLOW);
  p.text('REJECTS', tx, TOTE.z + 0.55, 0.1, '#e05a4f');
  // hatched strip under the pusher cylinder (crush zone)
  p.hatch(wx(G.pusherX) - 0.25, CYL.rearZ - 0.1, wx(G.pusherX) + 0.25, -0.42, 0.08);
  // supply pallets area
  corners(p, -6.4, -1.25, -4.6, 1.65);
  p.text('EMPTY CASES', -5.5, 1.9, 0.12, YELLOW);
  p.text('LINE 2 · CASE SORTER', 1.2, -2.35, 0.2, '#d8dde0');
}

function corners(p: FloorPainter, x0: number, z0: number, x1: number, z1: number) {
  const l = 0.25;
  const w = 0.06;
  p.line([[x0, z0 + l], [x0, z0], [x0 + l, z0]], w, YELLOW);
  p.line([[x1 - l, z0], [x1, z0], [x1, z0 + l]], w, YELLOW);
  p.line([[x1, z1 - l], [x1, z1], [x1 - l, z1]], w, YELLOW);
  p.line([[x0 + l, z1], [x0, z1], [x0, z1 - l]], w, YELLOW);
}

// ---------------------------------------------------------------------------
// Operator pedestal
// ---------------------------------------------------------------------------

function momentary(runtime: SimRuntime, id: string) {
  return {
    getPressed: () => Boolean(runtime.getControl(id)),
    onPress: () => {
      runtime.setControl(id, true);
      playSfx('press');
    },
    onRelease: () => {
      runtime.setControl(id, false);
      playSfx('release');
    },
  };
}

const PB_HOLES = pushButtonStationHoles(3);
const PB_POS: Vec3 = [-0.05, 1.02, 0.035];
const ES_POS: Vec3 = [0.06, 1.02, 0.035];
const STACK_H = stackLightHeight(3, { mount: 'pole', series: '855T' });

function OperatorStation({ state, runtime }: { state: ConveyorSortState; runtime: SimRuntime }) {
  const hole = (i: number): Vec3 => [PB_POS[0] + PB_HOLES[i]![0], PB_POS[1] + PB_HOLES[i]![1], PB_POS[2] + PB_HOLES[i]![2]];
  const esHole: Vec3 = [ES_POS[0], ES_POS[1] + 0.05, ES_POS[2] + 0.07];
  const topY = PB_POS[1] + 0.21;
  return (
    <group position={[STATION.x, 0, STATION.z]} rotation={[0, STATION.ry, 0]}>
      {/* pedestal: base plate, post, mounting plate */}
      <Instances
        geometry={unitBox}
        material={paint('#3b4450', 0.45, 0.35)}
        items={[
          { p: [0, 0.008, 0], s: [0.36, 0.016, 0.36] },
          { p: [0, 0.51, 0], s: [0.08, 1.0, 0.08] },
          { p: [0.005, 1.0, 0.02], s: [0.24, 0.015, 0.12] },
          { p: [0.005, 1.12, -0.012], s: [0.24, 0.24, 0.01] },
        ]}
      />
      <Instances
        geometry={unitBox}
        material={steel('#8d9398', 0.5)}
        items={[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [sx * 0.14, 0.02, sz * 0.14] as Vec3, s: [0.02, 0.012, 0.02] as Vec3 })))}
      />
      <PushButtonStation holes={3} position={PB_POS}>
        <PushButton800F color="green" legend="START" contact="N.O." {...momentary(runtime, 'start')} />
        <PushButton800F color="red" style="extended" legend="STOP" contact="N.C." {...momentary(runtime, 'stop')} />
        <SelectorSwitch800F
          positions={['AUTO', 'PLC']}
          legend="FEEDER"
          getPosition={() => Number(runtime.getControl('feeder_mode'))}
          onChange={(i) => {
            runtime.setControl('feeder_mode', i);
            playSfx('toggle');
          }}
        />
      </PushButtonStation>
      <PushButtonStation holes={1} color="yellow" pitch={0.082} width={0.084} centered position={ES_POS}>
        <EStop800FM
          getEngaged={() => Boolean(runtime.getControl('estop'))}
          onToggle={() => {
            runtime.setControl('estop', !runtime.getControl('estop'));
            playSfx('toggle');
          }}
        />
      </PushButtonStation>
      {/* 855T tower on its pole above the station */}
      <StackLight856T
        series="855T"
        position={[-0.05, topY, 0.035]}
        tiers={['red', 'amber', 'green']}
        getTier={(i) => (i === 0 ? state.lightRed : i === 1 ? state.lightAmber : state.lightGreen)}
        mount="pole"
        poleLength={0.25}
      />
      <IoHotspot runtime={runtime} device="pb-start" size={[0.05, 0.06, 0.05]} position={[hole(0)[0], hole(0)[1], hole(0)[2] + 0.02]} anchor={[hole(0)[0] - 0.19, hole(0)[1] + 0.03, hole(0)[2]]} />
      <IoHotspot runtime={runtime} device="pb-stop" size={[0.05, 0.06, 0.05]} position={[hole(1)[0], hole(1)[1], hole(1)[2] + 0.02]} anchor={[hole(1)[0] - 0.19, hole(1)[1] + 0.02, hole(1)[2]]} />
      <IoHotspot runtime={runtime} device="estop" size={[0.085, 0.09, 0.07]} position={esHole} anchor={[esHole[0] + 0.07, esHole[1], esHole[2]]} />
      <IoHotspot
        runtime={runtime}
        device="stack-light"
        size={[0.09, STACK_H + 0.02, 0.09]}
        position={[-0.05, topY + STACK_H / 2, 0.035]}
        anchor={[0.02, topY + STACK_H - 0.02, 0.035]}
        title="855T stack light"
      />
      {/* conduit from the pedestal up to the tray */}
      <FieldCable points={[[0, 0.95, -0.045], [0, 0.4, -0.06], [0.0, 0.05, -0.1], [0, 0.02, -0.4]]} radius={0.008} color="#2b2b2b" />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sounds
// ---------------------------------------------------------------------------

function ConveyorSounds({ state }: { state: ConveyorSortState }) {
  useSceneLoops(['conveyor', 'motor'], (l) => {
    const k = state.beltSpeed / G.beltSpeed;
    l.conveyor = k * 0.9;
    l.motor = k * 0.5;
  });
  useEdge(
    () => state.conveyorRun && !state.controls.estop,
    () => playSfx('contactor'),
  );
  useEdge(
    () => state.pusherValve,
    () => playSfx('pneumatic'),
  );
  useEdge(
    () => state.boxesFed,
    () => playSfx('release'),
  );
  return null;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const HALL_COLUMNS = [
  { x: -6.5, z: WALL_Z + 0.16 },
  { x: -0.5, z: WALL_Z + 0.16 },
  { x: 5.5, z: WALL_Z + 0.16 },
];
const HALL_LIGHTS: [number, number][] = [
  [-5, -1.2],
  [-1, -1.2],
  [3, -1.2],
  [7, -1.2],
  [-5, 3.2],
  [-1, 3.2],
  [3, 3.2],
  [7, 3.2],
];

/**
 * The view is memoised: pages re-render it whenever the runtime notifies (~30 Hz) but `state` / `runtime` are
 * stable objects, so the heavy static tree renders once and all motion happens in useFrame.
 */
export const ConveyorSortView = memo(function ConveyorSortView({ state, runtime }: SceneViewProps<ConveyorSortState>) {
  const pool = useMemo(() => makeBoxPool(48), []);
  const getBoxes = useMemo(() => () => mapBoxes(state, pool), [state, pool]);
  const getBelt = useMemo(() => () => state.beltPosition, [state]);
  const machineCables = useMemo<CableSpec[]>(
    () => [
      ...[G.peInfeedX, G.peTallX, G.peExitX].map((x) => sensorCable([x - 0.02, LAY.frameTop - 0.02, EYE_Z], [JB_POS[0], JB_POS[1] - 0.09, JB_POS[2]], 1)),
      sensorCable([DIVERT_EYE.from[0] - 0.02, LAY.frameTop - 0.02, EYE_Z], [JB_POS[0] - 0.05, JB_POS[1] - 0.09, JB_POS[2]], 1),
      ...pusherCables(TRAY_Y, TRAY_Z),
      // multicore from the junction box up to the tray
      { points: [[JB_POS[0], JB_POS[1] + 0.08, JB_POS[2]], [JB_POS[0], 1.4, JB_POS[2] - 0.1], [JB_POS[0] + 0.1, 2.3, TRAY_Z + 0.3], [JB_POS[0] + 0.15, TRAY_Y + 0.02, TRAY_Z]], radius: 0.007, color: '#6f7479' },
      // motor supply from the tray to the gear motor terminal box
      { points: [[G.beltLength + 0.12, 0.98, -0.52], [G.beltLength + 0.15, 1.5, -0.8], [G.beltLength + 0.2, 2.3, TRAY_Z + 0.2], [G.beltLength + 0.25, TRAY_Y + 0.02, TRAY_Z]], radius: 0.009, color: '#2b2b2b' },
      // feeder cable
      { points: [[G.feederX + 0.3, 2.2, -0.47], [G.feederX + 0.3, 2.45, -0.8], [G.feederX + 0.35, TRAY_Y + 0.02, TRAY_Z]], radius: 0.006, color: '#e8b90f' },
      // drop to the operator pedestal (world → machine frame)
      { points: [[-4.4 - X0, TRAY_Y, 0.95], [-4.35 - X0, 2.2, 1.0], [STATION.x + 0.05 - X0, 1.6, STATION.z - 0.1], [STATION.x - X0, 1.25, STATION.z - 0.08]], radius: 0.008, color: '#2b2b2b' },
    ],
    [],
  );
  const jbPos = JB_POS;
  return (
    <group>
      <FactoryHall
        floor={[-8.5, 8.5, WALL_Z, 5]}
        backWallZ={WALL_Z}
        leftWallX={-8}
        wallHeight={8}
        columns={HALL_COLUMNS}
        lights={HALL_LIGHTS}
        paintFloor={paintFloor}
        seed={4}
      />

      {/* ------------------------------ the machine ------------------------------ */}
      <group position={[X0, 0, 0]}>
        <Conveyor
          length={G.beltLength}
          width={G.beltWidth}
          height={BELT_H}
          getBeltPosition={getBelt}
          guideGaps={[
            { from: G.pusherX - 0.22, to: G.pusherX + 0.22, side: 'back' },
            { from: G.pusherX - 0.28, to: G.pusherX + 0.28, side: 'front' },
          ]}
        />
        <Boxes position={[0, BELT_H, 0]} getBoxes={getBoxes} maxCount={32} />
        <Feeder state={state} runtime={runtime} />
        <AcrossEye state={state} x={G.peInfeedX} beamY={0.1} sensor="infeed" />
        <AcrossEye state={state} x={G.peTallX} beamY={G.tallBeamHeight} sensor="tall" />
        <AcrossEye state={state} x={G.peExitX} beamY={0.1} sensor="exit" />
        <DivertEye state={state} />
        <Pusher state={state} />
        <RejectChute />
        <TotePile state={state} />
        <GoodLane state={state} />
        <GoodPallet state={state} />
        <PalletStack position={[PALLET.x, 0, PALLET.z]} cols={0} rows={0} layers={0} />
        <JunctionBox position={jbPos} />
        <Cables cables={machineCables} />

        {/* -------- I/O hover hotspots -------- */}
        <IoHotspot runtime={runtime} device="pe-infeed" size={[0.12, 0.16, 0.12]} position={[G.peInfeedX, BELT_H + 0.08, EYE_Z]} anchor={[G.peInfeedX, BELT_H + 0.24, EYE_Z]} title="PE-101 · 42EF" />
        <IoHotspot runtime={runtime} device="pe-tall" size={[0.12, 0.42, 0.12]} position={[G.peTallX, BELT_H + 0.15, EYE_Z]} anchor={[G.peTallX, BELT_H + 0.44, EYE_Z]} title="PE-102 · 42EF (high)" />
        <IoHotspot runtime={runtime} device="pe-divert" size={[0.12, 0.12, 0.12]} position={[DIVERT_EYE.from[0], BELT_H + 0.03, EYE_Z]} anchor={[DIVERT_EYE.from[0] + 0.05, BELT_H + 0.2, EYE_Z + 0.02]} title="PE-103 · 42EF (diagonal)" />
        <IoHotspot runtime={runtime} device="pe-exit" size={[0.12, 0.16, 0.12]} position={[G.peExitX, BELT_H + 0.08, EYE_Z]} anchor={[G.peExitX, BELT_H + 0.24, EYE_Z]} title="PE-104 · 42EF" />
        <IoHotspot
          runtime={runtime}
          aliases={['Pusher_Extended', 'Pusher_Retracted']}
          size={[0.16, 0.14, 0.95]}
          position={[G.pusherX, CYL.y, (CYL.z + CYL.rearZ) / 2]}
          anchor={[G.pusherX + 0.1, CYL.y + 0.14, CYL.rearZ + 0.25]}
          title="CY-101 pusher · reed switches"
        />
        <IoHotspot
          runtime={runtime}
          aliases={['Pusher_Extend']}
          size={[0.2, 0.2, 0.12]}
          position={[VALVE_POS[0] + 0.03, VALVE_POS[1] + 0.07, VALVE_POS[2] + 0.04]}
          anchor={[VALVE_POS[0] + 0.1, VALVE_POS[1] + 0.22, VALVE_POS[2] + 0.05]}
          title="YV-101 · 5/2 valve"
        />
        <IoHotspot runtime={runtime} device="feeder" size={[0.7, 0.3, 0.3]} position={[G.feederX, BELT_H + G.dropHeight + 0.08, 0.32]} anchor={[G.feederX + 0.1, BELT_H + G.dropHeight + 0.1, 0.5]} title="FD-101 feeder gate" />
        <IoHotspot runtime={runtime} device="motor" size={[0.45, 0.32, 0.36]} position={[G.beltLength + 0.12, 0.72, -0.62]} anchor={[G.beltLength + 0.1, 1.0, -0.6]} title="M-101 belt gear motor" />
      </group>

      {/* ------------------------------ operator & controls ------------------------------ */}
      <OperatorStation state={state} runtime={runtime} />
      <ControlCabinet
        runtime={runtime}
        size={CAB.size}
        nameplate={'CP-201\nLINE 2 CASE SORTER'}
        position={[CAB.x, CAB.y, WALL_Z]}
        fieldTerminals={20}
        loads={[
          {
            kind: 'starter',
            getEnergized: () => state.conveyorRun && !state.controls.estop,
            aliases: ['Conveyor_Run'],
            title: 'K1 · M-101 belt starter',
          },
        ]}
      />

      {/* ------------------------------ building services ------------------------------ */}
      <CableTray points={[[-4.4, TRAY_Y, 0.95], [-4.4, TRAY_Y, TRAY_Z], [wx(G.beltLength) + 0.6, TRAY_Y, TRAY_Z]]} hangTo={6.5} />
      <CableTray points={[[CAB.x, CAB.y + CAB.size[1] + 0.02, WALL_Z + 0.15], [CAB.x, TRAY_Y - 0.1, WALL_Z + 0.15], [CAB.x, TRAY_Y - 0.1, TRAY_Z - 0.2]]} width={0.2} />
      {/* machine guarding behind the conveyor */}
      <SafetyFence
        runs={[
          [
            [wx(-0.6), -0.55],
            [wx(-0.6), -1.45],
            [wx(G.beltLength + 0.4), -1.45],
            [wx(G.beltLength + 0.4), -0.6],
          ],
        ]}
      />

      {/* ------------------------------ props & signage ------------------------------ */}
      <PalletStack position={[-5.5, 0, -0.55]} rotationY={0.05} kind="short" cols={4} rows={3} layers={4} wrapped />
      <PalletStack position={[-5.5, 0, 0.95]} rotationY={-0.04} kind="tall" cols={4} rows={3} layers={2} count={20} />
      <PalletStack position={[6.9, 0, -2.4]} rotationY={Math.PI / 2} kind="short" cols={4} rows={3} layers={3} wrapped />
      <Bollards at={[[wx(-1.1), 2.2], [wx(3.6), 2.2], [wx(8.0), 2.2], [CAB.x + 0.6, WALL_Z + 1.05], [CAB.x - 1.1, WALL_Z + 1.05]]} />
      <FloorDrain position={[wx(2.2), 0, 1.9]} />
      <WallSign lines={['LINE 2', 'CASE SORTER']} position={[1.4, 3.35, WALL_Z + 0.02]} size={[2.2, 0.8]} bg="#1d4f91" color="#ffffff" />
      <WallSign lines={['CAUTION', 'AUTOMATIC MACHINE', 'MAY START WITHOUT WARNING']} kind="warning" position={[-3.2, 2.1, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <WallSign lines={['HEARING', 'PROTECTION', 'REQUIRED']} kind="mandatory" position={[-2.55, 2.1, WALL_Z + 0.02]} size={[0.5, 0.7]} />
      <WallSign lines={['PLC ACCESS', 'AUTHORIZED ONLY']} kind="warning" position={[CAB.x, CAB.y + CAB.size[1] + 0.45, WALL_Z + 0.02]} size={[0.5, 0.42]} />
      <FireExtinguisher position={[-3.1, 1.0, WALL_Z + 0.02]} />

      <ConveyorSounds state={state} />
      <ShadowBudget />
      <TagOcclusion />
    </group>
  );
});

export default ConveyorSortView;

