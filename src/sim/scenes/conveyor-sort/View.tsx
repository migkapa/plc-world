/**
 * `conveyor-sort` digital twin — a case-sorting line in a factory hall.
 *
 *   gravity box feeder (gate valve YV-102, instructor box: FEEDER MODE + BOX PATTERN, not PLC I/O) → 6 m belt
 *   conveyor (CV-101) → PE_Infeed · PE_Tall (high) · PE_Divert (diagonal) · PE_Exit (sensors on the junction-box
 *   side, reflectors on the operator side) → pneumatic pusher (5/2 valve YV-101, reed switches, FRL fed from an air
 *   drop) into the reject chute & tote; short boxes roll out onto the gravity good lane and are palletised. 855T stack
 *   light on a pole at the discharge end, JB-201 under the back frame (every field cable lands in a gland), service
 *   pole with a cable ladder up to the overhead tray, operator pedestal (START / STOP + E-stop, fed through the post
 *   from a floor box), wall cabinet with the ControlLogix 1756-L83E rack and a 440R safety relay.
 *
 * Everything animates from ConveyorSortState inside useFrame; the view never ticks the runtime.
 * Hover any device for its I/O chip (or turn on the global overlay: useSceneOverlay().showTags).
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
  unitCylY,
  WALKWAY,
  WallSign,
  YELLOW,
  type CableSpec,
  type FloorPainter,
} from './hall';
import { IoHotspot, momentaryControl, playSfx, ShadowBudget, TagLayer, toggleControl, useEdge, useSceneLoops } from './kit';
import { CONVEYOR_GEOMETRY as G, type ConveyorSortState } from './logic';
import {
  AcrossEye,
  AIR_DROP,
  BELT_H,
  CYL,
  DIVERT_EYE,
  DivertEye,
  EYE_Z,
  Feeder,
  FEEDER_VALVE,
  GoodLane,
  GoodPallet,
  instructorHole,
  jbGland,
  JB,
  JunctionBox,
  LineStackLight,
  makeBoxPool,
  mapBoxes,
  PALLET,
  Pusher,
  pusherAirHose,
  RejectChute,
  sensorCable,
  STACK,
  stackLightCable,
  stackTierY,
  TOTE,
  TotePile,
  TRAY,
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
const TRAY_Y = TRAY.y;
const TRAY_Z = TRAY.z;
/** Service pole with a vertical cable ladder behind the discharge end (machine frame x / z). */
const POLE = { x: 5.62, z: -0.98 } as const;

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
// Operator pedestal (START / STOP + E-stop; fed from a floor box, the cable runs inside the post)
// ---------------------------------------------------------------------------

const PB_HOLES = pushButtonStationHoles(2);
const PB_POS: Vec3 = [-0.045, 1.02, 0.035];
const ES_POS: Vec3 = [0.06, 1.02, 0.035];

function OperatorStation({ runtime }: { runtime: SimRuntime }) {
  const hole = (i: number): Vec3 => [PB_POS[0] + PB_HOLES[i]![0], PB_POS[1] + PB_HOLES[i]![1], PB_POS[2] + PB_HOLES[i]![2]];
  const esHole: Vec3 = [ES_POS[0], ES_POS[1] + 0.05, ES_POS[2] + 0.07];
  const start = momentaryControl(runtime, 'start');
  const stop = momentaryControl(runtime, 'stop');
  const estop = toggleControl(runtime, 'estop');
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
          { p: [0.005, 1.07, -0.012], s: [0.24, 0.13, 0.01] },
        ]}
      />
      <Instances
        geometry={unitBox}
        material={steel('#8d9398', 0.5)}
        items={[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ p: [sx * 0.14, 0.02, sz * 0.14] as Vec3, s: [0.02, 0.012, 0.02] as Vec3 })))}
      />
      {/* cast floor box behind the base: the station cable comes up through the floor and runs inside the post */}
      <Instances
        geometry={unitBox}
        material={steel('#9aa0a5', 0.45)}
        items={[
          { p: [0, 0.006, -0.3], s: [0.2, 0.012, 0.2] },
          { p: [0, 0.014, -0.3], s: [0.16, 0.004, 0.16] },
          { p: [0, 0.03, -0.215], s: [0.05, 0.036, 0.03] },
        ]}
      />
      <FieldCable points={[[0, 0.03, -0.2], [0, 0.03, -0.1], [0, 0.03, -0.042]]} radius={0.009} color="#2b2b2b" />
      <PushButtonStation holes={2} position={PB_POS}>
        <PushButton800F color="green" legend="START" contact="N.O." {...start} />
        <PushButton800F color="red" style="extended" legend="STOP" contact="N.C." {...stop} />
      </PushButtonStation>
      <PushButtonStation holes={1} color="yellow" pitch={0.082} width={0.084} centered position={ES_POS}>
        <EStop800FM getEngaged={() => Boolean(runtime.getControl('estop'))} onToggle={estop} />
      </PushButtonStation>
      <IoHotspot
        runtime={runtime}
        device="pb-start"
        group="OP-201"
        size={[0.06, 0.06, 0.06]}
        position={[hole(0)[0], hole(0)[1], hole(0)[2] + 0.02]}
        anchor={[hole(0)[0] - 0.07, hole(0)[1] + 0.02, hole(0)[2]]}
        press={start}
      />
      <IoHotspot
        runtime={runtime}
        device="pb-stop"
        group="OP-201"
        size={[0.06, 0.06, 0.06]}
        position={[hole(1)[0], hole(1)[1], hole(1)[2] + 0.02]}
        anchor={[hole(1)[0] - 0.07, hole(1)[1] - 0.01, hole(1)[2]]}
        press={stop}
      />
      <IoHotspot
        runtime={runtime}
        device="estop"
        group="OP-201"
        title="E-stop · 2nd N.C. contact hardwired to the safety relay"
        size={[0.09, 0.1, 0.08]}
        position={esHole}
        anchor={[esHole[0] + 0.07, esHole[1] - 0.01, esHole[2]]}
        onClick={estop}
      />
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

/** Ladder entry point on the service pole (machine frame). */
const poleEntry = (y: number, k = 0): Vec3 => [POLE.x - 0.05 + k * 0.03, y, POLE.z + 0.04];

/**
 * The view is memoised: pages re-render it whenever the runtime notifies (~30 Hz) but `state` / `runtime` are
 * stable objects, so the heavy static tree renders once and all motion happens in useFrame.
 */
export const ConveyorSortView = memo(function ConveyorSortView({ state, runtime }: SceneViewProps<ConveyorSortState>) {
  const pool = useMemo(() => makeBoxPool(48), []);
  const getBoxes = useMemo(() => () => mapBoxes(state, pool), [state, pool]);
  const getBelt = useMemo(() => () => state.beltPosition, [state]);
  const machineCables = useMemo<CableSpec[]>(() => {
    const g1 = jbGland(1);
    return [
      // photo-eye cordsets along the back frame into JB-201 (gland 6 = leftmost … 0 = rightmost)
      sensorCable(G.peInfeedX, 6),
      sensorCable(G.peTallX, 5),
      sensorCable(DIVERT_EYE.from[0], 4),
      sensorCable(G.peExitX, 0),
      stackLightCable(2),
      // JB-201 multicore: down out of gland 1, across under the frame to the service-pole ladder
      { points: [[g1[0], g1[1] - 0.004, g1[2]], [g1[0], g1[1] - 0.05, g1[2]], [g1[0] + 0.03, 0.4, g1[2] - 0.14], [POLE.x - 0.05, 0.42, POLE.z + 0.16], poleEntry(0.5)], radius: 0.006, color: '#6f7479' },
      // compressed air: drop on the fence post -> FRL
      pusherAirHose(),
    ];
  }, []);
  const motorRoute = useMemo(
    () => ({ via: [[G.beltLength + 0.02, 0.62, -0.62] as Vec3, [POLE.x + 0.1, 0.64, POLE.z + 0.14] as Vec3], to: poleEntry(0.68, 1) }),
    [],
  );
  const eyeZ = -EYE_Z;
  return (
    <TagLayer runtime={runtime}>
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
          motorCableTo={motorRoute}
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
        <JunctionBox />
        <LineStackLight state={state} />
        <Cables cables={machineCables} />
        {/* service pole with a vertical cable ladder up to the overhead tray, compressed-air main along the fence */}
        <Instances
          geometry={unitBox}
          material={paint('#4a5d70', 0.5, 0.35)}
          items={[
            { p: [POLE.x, (TRAY_Y + 0.1) / 2, POLE.z - 0.07], s: [0.06, TRAY_Y + 0.1, 0.06] },
            { p: [POLE.x, 0.006, POLE.z - 0.07], s: [0.18, 0.012, 0.18] },
          ]}
        />
        <CableTray points={[[POLE.x, 0.3, POLE.z], [POLE.x, TRAY_Y, POLE.z], [POLE.x, TRAY_Y, TRAY_Z]]} width={0.15} depth={0.05} cables={['#6f7479', '#2b2b2b']} />
        <mesh geometry={unitCylY} material={steel('#aab1b6', 0.45)} position={[2.9, 3.3, AIR_DROP[2]]} rotation={[0, 0, Math.PI / 2]} scale={[0.016, 7.0, 0.016]} />

        {/* -------- I/O hover hotspots -------- */}
        <IoHotspot runtime={runtime} device="pe-infeed" title="PE-101 · 42EF" size={[0.12, 0.16, 0.12]} position={[G.peInfeedX, BELT_H + 0.08, eyeZ]} anchor={[G.peInfeedX + 0.08, BELT_H + 0.2, eyeZ]} />
        <IoHotspot runtime={runtime} device="pe-tall" title="PE-102 · 42EF (high beam)" size={[0.12, 0.42, 0.12]} position={[G.peTallX, BELT_H + 0.15, eyeZ]} anchor={[G.peTallX + 0.08, BELT_H + 0.36, eyeZ]} />
        <IoHotspot runtime={runtime} device="pe-divert" title="PE-103 · 42EF (diagonal)" size={[0.12, 0.12, 0.12]} position={[DIVERT_EYE.from[0], BELT_H + 0.03, eyeZ]} anchor={[DIVERT_EYE.from[0] - 0.1, BELT_H + 0.16, eyeZ]} />
        <IoHotspot runtime={runtime} device="pe-exit" title="PE-104 · 42EF" size={[0.12, 0.16, 0.12]} position={[G.peExitX, BELT_H + 0.08, eyeZ]} anchor={[G.peExitX + 0.08, BELT_H + 0.2, eyeZ]} />
        <IoHotspot
          runtime={runtime}
          aliases={['Pusher_Extended', 'Pusher_Retracted']}
          title="CY-101 pusher · reed switches"
          size={[0.16, 0.14, 0.95]}
          position={[G.pusherX, CYL.y, (CYL.z + CYL.rearZ) / 2]}
          anchor={[G.pusherX + 0.12, CYL.y + 0.1, CYL.rearZ + 0.3]}
        />
        <IoHotspot
          runtime={runtime}
          aliases={['Pusher_Extend']}
          title="YV-101 · 5/2 valve"
          size={[0.2, 0.2, 0.12]}
          position={[VALVE_POS[0] + 0.03, VALVE_POS[1] + 0.07, VALVE_POS[2] + 0.04]}
          anchor={[VALVE_POS[0] + 0.14, VALVE_POS[1] + 0.2, VALVE_POS[2] + 0.05]}
        />
        <IoHotspot
          runtime={runtime}
          device="feeder"
          title="YV-102 · feeder gate valve"
          info={['Only used in PLC feeder mode (instructor box): each rising edge of Feeder_Release drops one box.']}
          size={[0.12, 0.16, 0.1]}
          position={FEEDER_VALVE}
          anchor={[FEEDER_VALVE[0] + 0.08, FEEDER_VALVE[1] + 0.06, FEEDER_VALVE[2]]}
        />
        <IoHotspot
          runtime={runtime}
          title="FEEDER MODE · instructor control"
          info={[
            'Not wired to the PLC (no I/O address).',
            'AUTO: the feeder drops a box by itself every 1.2 s while the belt runs.',
            'PLC: one box per rising edge of Feeder_Release (Local:2:O.Data.2).',
          ]}
          size={[0.06, 0.06, 0.05]}
          position={[G.feederX + instructorHole(0)[0], instructorHole(0)[1], instructorHole(0)[2] + 0.02]}
          anchor={[G.feederX + instructorHole(0)[0] - 0.07, instructorHole(0)[1] + 0.02, instructorHole(0)[2]]}
        />
        <IoHotspot
          runtime={runtime}
          title="BOX PATTERN · instructor control"
          info={['Not wired to the PLC.', 'Chooses the boxes the feeder releases: random (~35 % tall), all short, all tall or alternating.']}
          size={[0.06, 0.06, 0.05]}
          position={[G.feederX + instructorHole(1)[0], instructorHole(1)[1], instructorHole(1)[2] + 0.02]}
          anchor={[G.feederX + instructorHole(1)[0] - 0.07, instructorHole(1)[1] - 0.01, instructorHole(1)[2]]}
        />
        <IoHotspot
          runtime={runtime}
          device="stack-light"
          title="855T stack light"
          size={[0.1, 0.24, 0.1]}
          position={[STACK.x, stackTierY(1), STACK.z]}
          anchor={[STACK.x + 0.08, stackTierY(0) + 0.02, STACK.z]}
        />
        <IoHotspot runtime={runtime} device="motor" title="M-101 belt gear motor" size={[0.45, 0.32, 0.36]} position={[G.beltLength + 0.12, 0.72, -0.62]} anchor={[G.beltLength + 0.36, 0.86, -0.6]} />
        <IoHotspot
          runtime={runtime}
          title="JB-201 · field junction box"
          info={['Photo-eyes, pusher valve and stack light land here; one multicore runs up the service pole to the cabinet.']}
          size={[JB.size[0], JB.size[1], JB.size[2]]}
          position={[JB.x, JB.y, JB.z - JB.size[2] / 2]}
          anchor={[JB.x + 0.15, JB.y - 0.05, JB.z - JB.size[2]]}
        />
      </group>

      {/* ------------------------------ operator & controls ------------------------------ */}
      <OperatorStation runtime={runtime} />
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
        getSafetyOk={() => !state.controls.estop}
      />

      {/* ------------------------------ building services ------------------------------ */}
      <CableTray points={[[-3.3, TRAY_Y, TRAY_Z], [wx(G.beltLength) + 0.6, TRAY_Y, TRAY_Z]]} hangTo={6.5} />
      {/* spur over the feeder */}
      <CableTray points={[[wx(G.feederX) + 0.33, TRAY_Y, TRAY_Z], [wx(G.feederX) + 0.33, TRAY_Y, TRAY.feederSpurZ]]} width={0.15} depth={0.05} cables={['#6f7479', '#1f5fd0']} hangTo={6.5} />
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
      <ShadowBudget minRadius={0.1} />
    </TagLayer>
  );
});

export default ConveyorSortView;
