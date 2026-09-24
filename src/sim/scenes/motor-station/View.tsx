/**
 * `motor-station` 3D view — a factory bay with conveyor CV-101 driven by a 5 HP TEFC motor (M-101) through a
 * jaw coupling and an inline reducer on a drive platform; wall-mounted control panel MCP-101 (door open)
 * with the live 1756-A7 rack, breakers, 24 V supply, 100-C09 contactor + 193-E overload (clickable RESET),
 * terminals and ducts; overhead ladder tray and EMT conduit to the motor (via a local disconnect), to the
 * 800F pedestal station (START / STOP / JOG / E-stop / H-O-A / READY-RUN-FAULT) and to the upstream
 * "remote run" interface station; a horn/beacon on the panel roof. Boxes ride the belt into a gaylord.
 *
 * The view never ticks the runtime: it reads `state` in useFrame and writes controls via runtime.setControl.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import {
  Boxes,
  type BoxState,
  CircuitBreaker1489,
  CONTACTOR_100C,
  controlLogixChassisLayout,
  ControlLogixRack,
  Conveyor,
  DIN_RAIL,
  DinRail,
  Enclosure,
  EStop800FM,
  Motor,
  MotorStarter,
  OVERLOAD_193E,
  PilotLight800F,
  PowerSupply1606,
  PushButton800F,
  PushButtonStation,
  pushButtonStationHoles,
  SelectorSwitch800F,
  StackLight856T,
  TB_COLORS,
  TB1492_J3,
  TerminalBlocks1492,
  terminalX,
  WireDuct,
  Wires,
} from '../../../twin/devices';
import { rackLiveFromController } from '../../../twin/live';
import type { SceneViewProps } from '../../types';
import { Conduit, FONT, IoTag, KBOX, KCYL, SignPlate, Slab, TagLayer, infoLine, ioLine, km, kmat, momentaryClick, textLine, useControls, useEdgeSfx, useSfxLoops } from '../trainer/kit';
import { BAY_OCCLUDERS, MotorBay } from './Bay';
import { CouplingGuard, DeckJunctionBox, DrivePlatform, InlineReducer, MACHINE_BLUE, headAngle } from './Drive';
import { AXIS_Y, CABINET, CONV, DRIVE, HEAD_Z, PEDESTAL, REMOTE, STANCHION, TRAY } from './layout';
import { MOTOR_STATION, type MotorStationState } from './logic';

type P = SceneViewProps<MotorStationState>;

// ---------------------------------------------------------------------------
// Conveyor boxes (view-side animation driven by the simulated belt travel)
// ---------------------------------------------------------------------------

const N_BOXES = 5;
const HIDDEN_RUN = 1.1; // belt length hidden behind the wall (upstream)
const PERIOD = CONV.length + HIDDEN_RUN + 0.2;
const DISCHARGE = CONV.length - 0.1;

interface Slot {
  s: number;
  fall: number;
  done: boolean;
}

function useConveyorBoxes(state: MotorStationState) {
  const boxes = useMemo<BoxState[]>(
    () => Array.from({ length: N_BOXES }, (_, i) => ({ x: 0, y: CONV.height, z: ((i * 37) % 7) * 0.012 - 0.036, tall: i % 3 === 1, id: i + 1, visible: false })),
    [],
  );
  const slots = useMemo<Slot[]>(() => Array.from({ length: N_BOXES }, () => ({ s: -99, fall: -1, done: false })), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const pos = state.beltPosition;
    for (let i = 0; i < N_BOXES; i++) {
      const sl = slots[i]!;
      const b = boxes[i]!;
      let s = (pos + (i * PERIOD) / N_BOXES) % PERIOD;
      s -= HIDDEN_RUN;
      if (s < sl.s - 0.5) {
        sl.fall = -1;
        sl.done = false;
      }
      sl.s = s;
      if (!sl.done && sl.fall < 0 && s >= DISCHARGE) sl.fall = 0;
      if (sl.fall >= 0) {
        sl.fall += dt / 0.6;
        if (sl.fall >= 1) {
          sl.fall = -1;
          sl.done = true;
        }
      }
      b.rotZ = 0;
      if (sl.done) b.visible = false;
      else if (sl.fall >= 0) {
        const u = sl.fall;
        b.visible = true;
        b.x = DISCHARGE + 0.78 * u;
        b.y = CONV.height + 0.12 * u - 0.95 * u * u;
        b.rotZ = -1.5 * u;
      } else {
        b.visible = s > -0.35;
        b.x = s;
        b.y = CONV.height;
      }
    }
  });
  return () => boxes;
}

const JAM_BOX: BoxState[] = [{ x: CONV.length - 0.5, y: CONV.height + 0.01, z: 0.05, rotY: 0.55, rotX: 0.12, tall: true, id: 99 }];

// ---------------------------------------------------------------------------
// Control panel interior (backplate coords)
// ---------------------------------------------------------------------------

const R1_Y = 0.3;
const R2_Y = -0.27;
const D_TOP = 0.425;
const D_MID = 0.175;
const D_LOW = -0.155;
const D_BOT = -0.425;
const RACK_X = -0.1;
const RACK_Y = -0.075;
const STARTER_X = -0.24;

function PanelInterior({ state, runtime }: P) {
  const live = useMemo(() => rackLiveFromController(runtime.controller), [runtime.controller]);
  const hardware = runtime.scene.hardware;
  const layout = controlLogixChassisLayout(hardware.chassis ?? '1756-A7');
  const onReset = useMemo(() => momentaryClick(runtime, 'overload_reset'), [runtime]);
  const tbPwr = { count: 10, x: 0.06 };
  const tbMot = { count: 4, x: -0.14 };
  const tbCtl = { count: 22, x: 0.1 };
  const zE = DIN_RAIL.height + 0.0115;
  const wiring = useMemo(() => {
    const out: { points: Vec3[]; color: string; radius?: number }[] = [];
    const tb = (x: number, rail: number, up: number, down: number | null, color: string, r = 0.0009) => {
      out.push({ color, radius: r, points: [[x, rail + TB1492_J3.length / 2, zE], [x, rail + TB1492_J3.length / 2 + 0.015, zE], [x, up - 0.024, 0.03], [x, up, 0.03]] });
      if (down !== null) out.push({ color, radius: r, points: [[x, rail - TB1492_J3.length / 2, zE], [x, rail - TB1492_J3.length / 2 - 0.015, zE], [x, down + 0.024, 0.03], [x, down, 0.03]] });
    };
    for (let i = 0; i < tbPwr.count; i++) tb(tbPwr.x + terminalX(i, tbPwr.count), R1_Y, D_TOP, D_MID, i < 2 ? '#111111' : i < 4 ? '#eeeeee' : i < 8 ? '#1f4fd1' : '#3f9a3a');
    for (let i = 0; i < tbMot.count; i++) tb(tbMot.x + terminalX(i, tbMot.count), R2_Y, D_LOW, D_BOT, i < 3 ? '#111111' : '#3f9a3a', 0.0014);
    for (let i = 0; i < tbCtl.count; i++) tb(tbCtl.x + terminalX(i, tbCtl.count), R2_Y, D_LOW, D_BOT, i % 5 === 4 ? '#eeeeee' : '#1f4fd1');
    // breakers
    for (const [x, c] of [
      [-0.2875, '#111111'],
      [-0.27, '#111111'],
      [-0.2525, '#111111'],
      [-0.2225, '#c62828'],
      [-0.205, '#1f4fd1'],
    ] as const) {
      out.push({ color: c, radius: c === '#111111' ? 0.0014 : 0.0009, points: [[x, R1_Y + 0.045, zE + 0.03], [x, R1_Y + 0.07, zE + 0.03], [x, D_TOP - 0.024, 0.03], [x, D_TOP, 0.03]] });
      out.push({ color: c, radius: c === '#111111' ? 0.0014 : 0.0009, points: [[x, R1_Y - 0.045, zE + 0.03], [x, R1_Y - 0.07, zE + 0.03], [x, D_MID + 0.024, 0.03], [x, D_MID, 0.03]] });
    }
    // starter: line side up (L1-L3), load side (T1-T3) down, coil A1/A2 + aux 13/14
    for (const dx of [-0.012, 0, 0.012]) {
      out.push({ color: '#111111', radius: 0.0014, points: [[STARTER_X + dx, R2_Y + CONTACTOR_100C.h / 2, DIN_RAIL.height + 0.047], [STARTER_X + dx, R2_Y + CONTACTOR_100C.h / 2 + 0.02, DIN_RAIL.height + 0.047], [STARTER_X + dx, D_LOW - 0.024, 0.03], [STARTER_X + dx, D_LOW, 0.03]] });
      out.push({ color: '#111111', radius: 0.0014, points: [[STARTER_X + dx, R2_Y - CONTACTOR_100C.h / 2 - OVERLOAD_193E.h, DIN_RAIL.height + 0.04], [STARTER_X + dx, R2_Y - CONTACTOR_100C.h / 2 - OVERLOAD_193E.h - 0.015, DIN_RAIL.height + 0.04], [STARTER_X + dx, D_BOT + 0.024, 0.03], [STARTER_X + dx, D_BOT, 0.03]] });
    }
    for (const dx of [-0.0195, 0.0195]) out.push({ color: '#1f4fd1', points: [[STARTER_X + dx, R2_Y + CONTACTOR_100C.h / 2, DIN_RAIL.height + 0.047], [STARTER_X + dx, R2_Y + CONTACTOR_100C.h / 2 + 0.018, DIN_RAIL.height + 0.047], [STARTER_X + dx * 0.6, D_LOW - 0.024, 0.03], [STARTER_X + dx * 0.6, D_LOW, 0.03]] });
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ductWires = ['#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1', '#111111', '#c62828', '#111111'];
  const L = (a: string) => ioLine(runtime, a);
  return (
    <group>
      <WireDuct length={0.66} position={[0, D_TOP, 0]} width={0.04} height={0.06} wires={ductWires} />
      <WireDuct length={0.6} position={[0, D_MID, 0]} width={0.04} height={0.06} wires={ductWires} />
      <WireDuct length={0.6} position={[0, D_LOW, 0]} width={0.04} height={0.06} wires={ductWires} />
      <WireDuct length={0.66} position={[0, D_BOT, 0]} width={0.04} height={0.06} wires={ductWires} />
      <WireDuct length={0.81} vertical position={[-0.345, 0, 0]} width={0.04} height={0.06} />
      <WireDuct length={0.81} vertical position={[0.345, 0, 0]} width={0.04} height={0.06} cover={false} wires={['#111111', '#111111', '#111111', '#1f4fd1', '#1f4fd1', '#3f9a3a']} />
      <DinRail length={0.64} position={[0, R1_Y, 0]}>
        <CircuitBreaker1489 poles={3} rating="C16" position={[-0.27, 0, 0]} getOn={() => true} catalog="1489-M3C160" />
        <CircuitBreaker1489 poles={1} rating="C4" position={[-0.2225, 0, 0]} getOn={() => true} />
        <CircuitBreaker1489 poles={1} rating="C2" position={[-0.205, 0, 0]} getOn={() => true} />
        <PowerSupply1606 position={[-0.13, 0, 0]} getOk={() => true} />
        <TerminalBlocks1492 count={tbPwr.count} colors={Array.from({ length: tbPwr.count }, (_, i) => (i < 4 ? TB_COLORS.gray : i < 8 ? TB_COLORS.blue : TB_COLORS.green))} labels={['L1', 'L1', 'N', 'N', '+24', '+24', '0V', '0V', 'PE', 'PE']} position={[tbPwr.x, 0, 0]} />
      </DinRail>
      <ControlLogixRack hardware={hardware} live={live} wired position={[RACK_X, RACK_Y, 0]} />
      {hardware.modules.map((mod) => (
        <IoTag
          key={mod.slot}
          position={[RACK_X - layout.width / 2 + layout.slotCenterX(mod.slot), RACK_Y + 0.075, 0.075]}
          size={[0.033, 0.145, 0.14]}
          anchor={[0, 0.082, 0.05]}
          title={`Slot ${mod.slot}`}
          lines={[textLine(mod.catalog, mod.name ?? (mod.slot === 0 ? 'Controller' : ''), `Local:${mod.slot}`)]}
        />
      ))}
      <DinRail length={0.64} position={[0, R2_Y, 0]}>
        <MotorStarter
          position={[STARTER_X, 0, 0]}
          getEnergized={() => state.contacts.on}
          getTripped={() => state.overloadTripped}
          onReset={onReset}
          contactorCatalog="100-C09"
          overloadVariant="E1Plus"
        />
        <TerminalBlocks1492 count={tbMot.count} colors={[TB_COLORS.gray, TB_COLORS.gray, TB_COLORS.gray, TB_COLORS.green]} labels={['T1', 'T2', 'T3', 'PE']} position={[tbMot.x, 0, 0]} />
        <TerminalBlocks1492 count={tbCtl.count} colors={Array.from({ length: tbCtl.count }, (_, i) => (i % 5 === 4 ? TB_COLORS.blue : TB_COLORS.gray))} position={[tbCtl.x, 0, 0]} />
      </DinRail>
      <IoTag
        position={[STARTER_X, R2_Y, 0]}
        size={[0.05, CONTACTOR_100C.h, 0.1]}
        center={[0, 0, 0.05]}
        anchor={[-0.07, 0.03, 0.09]}
        title="K1 · 100-C09 contactor (coil via E-stop + OL 95-96)"
        lines={[L('Motor_Starter'), L('Motor_Aux')]}
      />
      <IoTag
        position={[STARTER_X, R2_Y - CONTACTOR_100C.h / 2 - OVERLOAD_193E.h / 2, 0]}
        size={[0.05, OVERLOAD_193E.h, 0.1]}
        center={[0, 0, 0.05]}
        anchor={[-0.075, -0.01, 0.09]}
        title="193-E overload · click RESET"
        lines={[L('OL_OK'), infoLine('Thermal', () => state.overloadHeat * 100, '%', 0)]}
      />
      <Wires wires={wiring} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Operator pedestal (post-local coordinates, origin = post center on the floor)
// ---------------------------------------------------------------------------

const ST_A = { x: -0.05, holes: 4 };
const ST_B = { x: 0.05, holes: 3 };
const ST_Y = PEDESTAL.plateY0 + 0.02;
const ST_Z = 0.05;
const E_OPTS = { pitch: 0.082, width: 0.084, centered: true } as const;
const E_Y = ST_Y + ST_B.holes * 0.064 + 0.018 + 0.008;

function Pedestal({ state, runtime }: P) {
  const ctl = useControls(runtime);
  const holesA = pushButtonStationHoles(ST_A.holes);
  const holesB = pushButtonStationHoles(ST_B.holes);
  const holesE = pushButtonStationHoles(1, E_OPTS);
  const L = (a: string) => ioLine(runtime, a);
  const paint = km.paint('#3d4247', 0.45, 0.45);
  const pz = ST_Z;
  const hole = (st: { x: number }, h: Vec3, y0 = ST_Y): Vec3 => [st.x + h[0], y0 + h[1], pz + h[2]];
  const PBTAG = { size: [0.036, 0.058, 0.05] as Vec3, center: [0, 0.008, 0.025] as Vec3, anchor: [0, 0.045, 0.03] as Vec3 };
  return (
    <group position={[PEDESTAL.x, 0, PEDESTAL.z]}>
      {/* base plate + anchors, post, mounting plate, top junction box */}
      <Slab min={[-0.15, 0, -0.15]} max={[0.15, 0.012, 0.15]} material={paint} castShadow />
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([a, b], i) => (
        <mesh key={i} geometry={KCYL()} material={km.metal('#b9bdc1', 0.35)} scale={[0.018, 0.02, 0.018]} position={[a! * 0.11, 0.02, b! * 0.11]} />
      ))}
      <Slab min={[-0.04, 0.012, -0.04]} max={[0.04, PEDESTAL.plateY1, 0.04]} material={kmat('ms:ped-yellow', () => new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.45, metalness: 0.3 }))} castShadow />
      <Slab min={[-0.105, PEDESTAL.plateY0, 0.04]} max={[0.105, PEDESTAL.plateY1, 0.048]} material={paint} castShadow />
      <Slab min={[-0.06, PEDESTAL.plateY1, -0.04]} max={[0.06, PEDESTAL.plateY1 + 0.08, 0.05]} material={km.paint('#8d9296', 0.45, 0.4)} castShadow />
      <SignPlate
        id="m101-plate"
        size={[0.075, 0.22]}
        position={[0, 0.72, 0.041]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#141414';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#f0f0ea';
          ctx.textAlign = 'center';
          ctx.font = `800 ${w * 0.2}px ${FONT}`;
          ctx.fillText('M-101', w / 2, h * 0.14);
          ctx.font = `600 ${w * 0.12}px ${FONT}`;
          ['CV-101', 'DRIVE', '5 HP', '460 V', 'LOTO', 'MCP-101', 'CB-3'].forEach((t, i) => ctx.fillText(t, w / 2, h * (0.27 + i * 0.1)));
        }}
      />
      {/* stations */}
      <PushButtonStation holes={ST_A.holes} position={[ST_A.x, ST_Y, pz]} autoPlace={false} />
      <PushButtonStation holes={ST_B.holes} position={[ST_B.x, ST_Y, pz]} autoPlace={false} />
      <PushButtonStation holes={1} color="yellow" {...E_OPTS} position={[ST_B.x, E_Y, pz]} autoPlace={false} />
      {/* column A: READY / RUN / FAULT / H-O-A */}
      <IoTag position={hole(ST_A, holesA[0]!, ST_Y)} {...PBTAG} title="800F white LED pilot light" lines={[L('Ready_Light')]}>
        <PilotLight800F color="white" legend="READY" getLit={() => state.readyLight} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_A, holesA[1]!, ST_Y)} {...PBTAG} title="800F green LED pilot light" lines={[L('Run_Light')]}>
        <PilotLight800F color="green" legend="RUN" getLit={() => state.runLight} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_A, holesA[2]!, ST_Y)} {...PBTAG} title="800F red LED pilot light" lines={[L('Fault_Light')]}>
        <PilotLight800F color="red" legend="FAULT" getLit={() => state.faultLight} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_A, holesA[3]!, ST_Y)} {...PBTAG} title="800F 3-pos selector · click left/right half" lines={[L('HOA_Hand'), L('HOA_Auto')]}>
        <SelectorSwitch800F positions={['HAND', 'OFF', 'AUTO']} legend="H-O-A" getPosition={() => state.controls.hoa} onChange={ctl.select('hoa')} rear={false} />
      </IoTag>
      {/* column B: START / STOP / JOG, E-stop on top */}
      <IoTag position={hole(ST_B, holesB[0]!, ST_Y)} {...PBTAG} title="800F green flush PB (N.O.) · key S" lines={[L('Start_PB')]}>
        <PushButton800F color="green" legend="START" contact="N.O." getPressed={() => state.controls.start} {...ctl.momentary('start')} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_B, holesB[1]!, ST_Y)} {...PBTAG} title="800F red extended PB (N.C.) · key X" lines={[L('Stop_PB')]}>
        <PushButton800F color="red" style="extended" legend="STOP" contact="N.C." getPressed={() => state.controls.stop} {...ctl.momentary('stop')} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_B, holesB[2]!, ST_Y)} {...PBTAG} title="800F black flush PB (N.O.) · key J" lines={[L('Jog_PB')]}>
        <PushButton800F color="black" legend="JOG" contact="N.O." getPressed={() => state.controls.jog} {...ctl.momentary('jog')} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_B, holesE[0]!, E_Y)} size={[0.064, 0.064, 0.05]} center={[0, 0, 0.025]} anchor={[0, 0.045, 0.03]} title="800FM E-stop, 2 × N.C. · click: push / twist-release" lines={[L('EStop_OK')]}>
        <EStop800FM getEngaged={() => state.controls.estop} onToggle={ctl.toggle('estop', 'press')} rear={false} />
      </IoTag>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Upstream remote-run interface station (wall)
// ---------------------------------------------------------------------------

function RemoteRunStation({ state, runtime }: P) {
  const holes = pushButtonStationHoles(2);
  const z = CABINET.pos[2];
  const L = ioLine(runtime, 'Remote_Run');
  const set = useMemo(
    () => (i: number) => {
      runtime.setControl('remote_run', i === 1);
    },
    [runtime],
  );
  return (
    <group position={[REMOTE.x, REMOTE.y, z]}>
      <PushButtonStation holes={2} autoPlace={false} />
      <IoTag position={holes[0]!} size={[0.036, 0.058, 0.05]} center={[0, 0.008, 0.025]} anchor={[0, 0.045, 0.03]} title="Upstream line run request (relay contact)" lines={[L]}>
        <PilotLight800F color="blue" legend="REMOTE" getLit={() => state.controls.remote_run} rear={false} />
      </IoTag>
      <IoTag position={holes[1]!} size={[0.036, 0.058, 0.05]} center={[0, 0.008, 0.025]} anchor={[0, 0.045, 0.03]} title="Simulate upstream request · click" lines={[L]}>
        <SelectorSwitch800F positions={['OFF', 'RUN']} legend="LINE 2" getPosition={() => (state.controls.remote_run ? 1 : 0)} onChange={set} rear={false} />
      </IoTag>
      <SignPlate
        id="remote-sign"
        size={[0.26, 0.1]}
        position={[0, 0.2, 0.002]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#1f4f9c';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.font = `800 ${h * 0.28}px ${FONT}`;
          ctx.fillText('UPSTREAM LINE 2', w / 2, h * 0.38);
          ctx.font = `600 ${h * 0.2}px ${FONT}`;
          ctx.fillText('RUN REQUEST → CV-101', w / 2, h * 0.72);
        }}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Local disconnect on its strut stanchion
// ---------------------------------------------------------------------------

function Disconnect() {
  const y = 1.4;
  const z = STANCHION.z + 0.021 + 0.06;
  return (
    <group>
      <Slab min={[STANCHION.x - 0.021, 0, STANCHION.z - 0.021]} max={[STANCHION.x + 0.021, TRAY.y, STANCHION.z + 0.021]} material={km.paint('#c9ccce', 0.5, 0.6)} castShadow />
      <Slab min={[STANCHION.x - 0.08, 0, STANCHION.z - 0.08]} max={[STANCHION.x + 0.08, 0.01, STANCHION.z + 0.08]} material={km.paint('#c9ccce', 0.5, 0.6)} />
      <group position={[STANCHION.x, y, z]}>
        <mesh geometry={KBOX()} material={km.paint('#9aa0a4', 0.45, 0.35)} scale={[0.16, 0.22, 0.12]} castShadow />
        <mesh geometry={KCYL()} material={km.plastic('#f2c200', 0.45)} rotation={[Math.PI / 2, 0, 0]} scale={[0.09, 0.004, 0.09]} position={[0, 0.02, 0.062]} />
        <group position={[0, 0.02, 0.07]} rotation={[0, 0, 0]}>
          <mesh geometry={KCYL()} material={km.plastic('#c8102e', 0.4)} rotation={[Math.PI / 2, 0, 0]} scale={[0.04, 0.02, 0.04]} />
          <mesh geometry={KBOX()} material={km.plastic('#c8102e', 0.4)} scale={[0.02, 0.075, 0.018]} position={[0, 0.02, 0.008]} castShadow />
        </group>
        <SignPlate
          id="disc-label"
          size={[0.12, 0.035]}
          position={[0, -0.075, 0.061]}
          draw={(ctx, w, h) => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#111';
            ctx.font = `800 ${h * 0.42}px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('M-101 DISC.  ON / OFF', w / 2, h / 2);
          }}
        />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const OCCLUDERS: Array<[Vec3, Vec3]> = [
  ...BAY_OCCLUDERS,
  // conveyor frame body (below the belt)
  [
    [-0.34, 0.45, CONV.z0 + 0.4],
    [0.34, CONV.height - 0.02, HEAD_Z + 0.1],
  ],
  // panel sides + top (the door side is open)
  [
    [CABINET.pos[0] - CABINET.size[0] / 2, CABINET.pos[1], CABINET.pos[2]],
    [CABINET.pos[0] - CABINET.size[0] / 2 + 0.01, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + CABINET.size[2] - 0.02],
  ],
  [
    [CABINET.pos[0] + CABINET.size[0] / 2 - 0.01, CABINET.pos[1], CABINET.pos[2]],
    [CABINET.pos[0] + CABINET.size[0] / 2, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + CABINET.size[2] - 0.02],
  ],
  // pedestal post + plate
  [
    [PEDESTAL.x - 0.105, 0, PEDESTAL.z - 0.04],
    [PEDESTAL.x + 0.105, PEDESTAL.plateY1, PEDESTAL.z + 0.046],
  ],
  // drive deck
  [
    [DRIVE.deck.x0, DRIVE.deck.top - 0.11, DRIVE.deck.z0],
    [DRIVE.deck.x1, DRIVE.deck.top, DRIVE.deck.z1],
  ],
];

export function MotorStationView({ state, runtime }: P) {
  const getBoxes = useConveyorBoxes(state);
  const lines = useMemo(() => {
    const L = (a: string) => ioLine(runtime, a);
    return {
      horn: [L('Horn')],
      motor: [infoLine('Speed', () => state.motorRpm, 'rpm'), infoLine('Current', () => state.motorCurrentA, 'A', 1), textLine('Contacts', () => (state.contacts.on ? 'CLOSED' : 'OPEN'))],
      jam: [textLine('Fault', 'jam · click the box to clear')],
    };
  }, [runtime, state]);

  // --- sound ---
  useSfxLoops(['motor', 'conveyor', 'horn'], (l) => {
    const k = Math.min(1, state.motorRpm / MOTOR_STATION.ratedRpm);
    const stall = state.contacts.on && state.controls.jam ? 0.6 : 0;
    l.motor = Math.max(k, stall);
    l.conveyor = k * 0.9;
    l.horn = state.horn ? 1 : 0;
  });
  useEdgeSfx(() => state.contacts.on, 'contactor', 'contactor');
  useEdgeSfx(() => state.overloadTripped, 'fault');

  const jamVisible = useRef<THREE.Group>(null);
  useFrame(() => {
    if (jamVisible.current) jamVisible.current.visible = state.controls.jam;
  });
  const clearJam = useMemo(() => () => runtime.setControl('jam', false), [runtime]);

  const motorAngle = () => state.shaftAngle;
  const outAngle = () => headAngle(state.beltPosition);

  return (
    <TagLayer occluders={OCCLUDERS}>
      <MotorBay />

      {/* ---- conveyor CV-101 (local X runs toward +Z) ---- */}
      <group position={[CONV.x, 0, CONV.z0]} rotation={[0, -Math.PI / 2, 0]}>
        <Conveyor length={CONV.length} width={CONV.width} height={CONV.height} getBeltPosition={() => state.beltPosition} driveSide="none" frameStyle="powder" frameColor={MACHINE_BLUE} />
        <Boxes getBoxes={getBoxes} maxCount={8} />
        <group ref={jamVisible} visible={false}>
          <IoTag position={[CONV.length - 0.5, CONV.height + 0.18, 0.05]} size={[0.36, 0.38, 0.3]} title="Conveyor jam (instructor fault)" lines={lines.jam} onPress={clearJam}>
            <Boxes getBoxes={() => JAM_BOX} maxCount={1} position={[0, -0.18, -0.05]} />
          </IoTag>
        </group>
      </group>

      {/* ---- drive: platform, reducer, couplings, guards, motor ---- */}
      <DrivePlatform />
      <InlineReducer getInputAngle={motorAngle} getOutputAngle={outAngle} />
      <CouplingGuard x0={0.692} x1={0.8} halfW={0.062} top={0.07} />
      <CouplingGuard x0={0.325} x1={0.41} halfW={0.07} top={0.075} />
      <IoTag position={[DRIVE.motor[0] + 0.03, AXIS_Y, HEAD_Z]} size={[0.5, 0.26, 0.3]} anchor={[0, 0.2, 0]} title="M-101 · 5 HP TEFC motor, 184T, 460 V, 7.6 A FLA" lines={lines.motor}>
        <group position={[-0.03, DRIVE.motor[1] - AXIS_Y, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <Motor frame="medium" getRpm={() => state.motorRpm} getShaftAngle={motorAngle} getOverloaded={() => state.stallMs > 600} />
        </group>
      </IoTag>
      <DeckJunctionBox position={[0.93, DRIVE.deck.top - 0.07, DRIVE.deck.z1 + 0.036]} />

      {/* ---- control panel MCP-101 ---- */}
      <Enclosure size={CABINET.size} position={CABINET.pos} doorAngle={2.0} nameplate={'MCP-101\nCONVEYOR CV-101'} glands={0}>
        <PanelInterior state={state} runtime={runtime} />
      </Enclosure>
      <IoTag position={[CABINET.pos[0] + 0.26, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + 0.17]} size={[0.09, 0.2, 0.09]} center={[0, 0.1, 0]} anchor={[0, 0.22, 0]} title="Warning horn / amber beacon" lines={lines.horn}>
        <StackLight856T tiers={['amber']} getTier={() => state.horn} getHorn={() => state.horn} getFlashing={() => true} mount="base" />
      </IoTag>

      {/* ---- conduit & field wiring ---- */}
      {[-0.13, -0.02].map((dx) => (
        <Conduit key={dx} points={[[CABINET.pos[0] + dx, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + 0.12], [CABINET.pos[0] + dx, TRAY.y, CABINET.pos[2] + 0.12]]} />
      ))}
      <Conduit points={[[CABINET.pos[0] - 0.3, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + 0.12], [CABINET.pos[0] - 0.3, TRAY.y - 0.1, CABINET.pos[2] + 0.12], [CABINET.pos[0] - 0.3, TRAY.y, CABINET.pos[2] + 0.2]]} radius={0.016} />
      <Conduit points={[[REMOTE.x, TRAY.y, CABINET.pos[2] + 0.035], [REMOTE.x, REMOTE.y + 0.146, CABINET.pos[2] + 0.035]]} radius={0.0095} />
      <Conduit points={[[TRAY.runX, TRAY.y, STANCHION.z + 0.081], [TRAY.runX, 1.51, STANCHION.z + 0.081]]} radius={0.016} />
      <Conduit
        points={[
          [TRAY.runX, 1.29, STANCHION.z + 0.081],
          [TRAY.runX, 0.59, STANCHION.z + 0.081],
          [1.06, 0.59, DRIVE.deck.z1 + 0.036],
          [0.99, 0.59, DRIVE.deck.z1 + 0.036],
        ]}
        radius={0.016}
      />
      <Conduit
        points={[
          [TRAY.runX + 0.1, TRAY.y, PEDESTAL.z],
          [TRAY.runX + 0.1, 2.15, PEDESTAL.z],
          [PEDESTAL.x, 1.9, PEDESTAL.z],
          [PEDESTAL.x, PEDESTAL.plateY1 + 0.08, PEDESTAL.z],
        ]}
        radius={0.0115}
      />
      <Disconnect />
      <Pedestal state={state} runtime={runtime} />
      <RemoteRunStation state={state} runtime={runtime} />
    </TagLayer>
  );
}

export default MotorStationView;
