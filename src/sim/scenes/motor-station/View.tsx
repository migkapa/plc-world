/**
 * `motor-station` 3D view — a factory bay with conveyor CV-101 driven by a 5 HP TEFC motor (M-101) through a
 * jaw coupling and an inline gearbox on a drive platform; wall-mounted 460 V control panel MCP-101 (door
 * open): flange-operated main disconnect, 1497 control power transformer with fuses, 24 V supply, the live
 * 1756-A7 rack, a 140M motor protection breaker and the 100-C09 contactor + 193-E overload (the whole relay
 * is the momentary RESET; the armature window glows while the contacts are closed, the trip window glows red
 * when tripped, the RESET glows blue once a reset would be accepted), terminals and ducts; overhead ladder
 * tray and EMT conduit to the motor (via a local disconnect), to the 800F pedestal station (START / STOP /
 * JOG / E-stop / H-O-A / READY-RUN-FAULT, with a warning horn + amber beacon on top) and to the upstream
 * "remote run" station; a second horn/beacon on the panel roof. Boxes ride the belt into a gaylord.
 *
 * The view never ticks the runtime: it reads `state` in useFrame and writes controls via runtime.setControl.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import {
  Boxes,
  type BoxState,
  CircuitBreaker1489,
  Contactor100C,
  CONTACTOR_100C,
  controlLogixChassisLayout,
  ControlLogixRack,
  Conveyor,
  DIN_RAIL,
  DinRail,
  Enclosure,
  EStop800FM,
  Motor,
  OVERLOAD_193E,
  OverloadRelay193,
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
import { GlowDisc, LampBoost } from '../trainer/fx';
import { Conduit, FONT, IoTag, fitFont, KBOX, KCYL, SignPlate, Slab, TagLayer, infoLine, ioLine, km, kmat, textLine, useControls, useEdgeSfx, useSfxLoops, type TagGroup } from '../trainer/kit';
import { rackCableRuns } from '../trainer/rackRuns';
import { BAY_OCCLUDERS, BIN_OCCLUDER, MotorBay } from './Bay';
import { CouplingGuard, DeckJunctionBox, DrivePlatform, InlineReducer, MACHINE_BLUE, headAngle } from './Drive';
import { AXIS_Y, BIN, CABINET, CONV, DRIVE, HEAD_Z, PEDESTAL, REMOTE, STANCHION, TRAY } from './layout';
import { MOTOR_STATION, type MotorStationState } from './logic';
import { ControlTransformer1497, Disconnect1494, FlangeHandle, FuseHolder1492, Mpcb140M, ROD_Z } from './PanelParts';

type P = SceneViewProps<MotorStationState>;

/** Panel-mounted device tag: hidden when seen from behind its panel. */
const PANEL = { facing: true } as const;
const G: Record<string, TagGroup> = {
  station: { id: 'station', label: 'M-101 push-button station', mode: 'rows' },
  starter: { id: 'starter', label: 'K1 / OL1 starter', mode: 'rows' },
  remote: { id: 'remote', label: 'LINE 2 remote run', mode: 'rows' },
};

// ---------------------------------------------------------------------------
// Conveyor boxes (view-side animation driven by the simulated belt travel)
// ---------------------------------------------------------------------------

const N_BOXES = 5;
const HIDDEN_RUN = 1.1; // belt length hidden behind the wall (upstream)
const PERIOD = CONV.length + HIDDEN_RUN + 0.2;
const DISCHARGE = CONV.length - 0.1;
/** Conveyor-local X of the jammed box (instructor fault). */
const JAM_X = CONV.length - 0.55;
/** Falling boxes disappear into the gaylord at its rim. */
const RIM_Y = BIN.pallet + BIN.h + 0.02;

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
  // visual belt travel: follows the belt, but freezes while a box is jammed (the belt slips under the load)
  const travel = useRef({ v: 0, last: Number.NaN });
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const pos = state.beltPosition;
    const tr = travel.current;
    if (Number.isNaN(tr.last) || pos < tr.last - 1e-6) tr.v = pos;
    else if (!state.controls.jam) tr.v += pos - tr.last;
    tr.last = pos;
    const jam = state.controls.jam;
    for (let i = 0; i < N_BOXES; i++) {
      const sl = slots[i]!;
      const b = boxes[i]!;
      let s = (tr.v + (i * PERIOD) / N_BOXES) % PERIOD;
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
        b.x = DISCHARGE + 0.78 * u;
        b.y = CONV.height + 0.12 * u - 0.95 * u * u;
        b.rotZ = -1.5 * u;
        // into the gaylord: gone once it drops below the rim
        b.visible = b.y > RIM_Y;
        if (!b.visible) sl.done = true;
      } else {
        // the jammed box takes this spot: no box may overlap it
        b.visible = s > -0.35 && !(jam && Math.abs(s - JAM_X) < 0.38);
        b.x = s;
        b.y = CONV.height;
      }
    }
  });
  return () => boxes;
}

const JAM_BOX: BoxState[] = [{ x: 0, y: 0, z: 0, rotY: 0.5, rotX: 0.2, rotZ: 0.42, tall: true, id: 99 }];

/** Jammed box wedged against the side rail, with a pulsing red alarm shell (click = clear the jam). */
function JamMarker({ state }: { state: MotorStationState }) {
  const shell = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const m = shell.current;
    if (!m) return;
    m.opacity = state.controls.jam ? 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 9)) : 0;
  });
  return (
    <group>
      <Boxes getBoxes={() => JAM_BOX} maxCount={1} />
      <mesh geometry={KBOX()} position={[0.02, 0.2, 0]} rotation={[0.2, 0.5, 0.42]} scale={[0.36, 0.42, 0.3]} renderOrder={2}>
        <meshBasicMaterial ref={shell} color={new THREE.Color('#ff2a1a').multiplyScalar(1.6)} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Control panel interior (backplate coords: origin = backplate center, +Z out)
// ---------------------------------------------------------------------------

const R1_Y = 0.3;
const R1_X = -0.05;
const R2_Y = -0.27;
const D_W = 0.04;
const D_TOP = 0.425;
const D_MID = 0.175;
/** Under the rack: RTB harnesses, patch cables and the PS cord drop into it. */
const D_LOW = -0.2;
const D_BOT = -0.425;
const RACK_X = -0.1;
const RACK_Y = -0.05;
const MPCB_X = -0.295;
const STARTER_X = -0.24;
const CPT = { x: -0.265, y: 0.3 } as const;
const DS = { x: 0.235, y: 0.29 } as const;
/** Inner face of the enclosure's right side wall (backplate coords) and its outer face (world). */
const WALL_IN_X = CABINET.size[0] / 2 - 0.0015;
/** Backplate surface above the enclosure back (Enclosure: standoff + sheet + plate). */
const BP_Z = 0.0165;

const C_WIN: Vec3 = [0, -0.0078, 0.079 + 0.006 + 0.002];
const OL_Y = -CONTACTOR_100C.h / 2 - 0.0005;
const OL_FLAG: Vec3 = [0.012, OL_Y - 0.0199, 0.0886];
const OL_RESET: Vec3 = [0.012, OL_Y - 0.0372, 0.0905];

function PanelInterior({ state, runtime }: P) {
  const live = useMemo(() => rackLiveFromController(runtime.controller), [runtime.controller]);
  const hardware = runtime.scene.hardware;
  const layout = controlLogixChassisLayout(hardware.chassis ?? '1756-A7');
  const ctl = useControls(runtime);
  const tbPwr = { count: 10, x: 0.0 };
  const tbMot = { count: 4, x: -0.14 };
  const tbCtl = { count: 22, x: 0.1 };
  const zE = DIN_RAIL.height + 0.0115;
  const wiring = useMemo(() => {
    const out: { points: Vec3[]; color: string; radius?: number }[] = [];
    /** Conductor from a terminal at (x, y, z) straight up (dir 1) / down (dir -1) into a duct at `duct`. */
    const run = (x: number, y: number, z: number, dir: 1 | -1, duct: number, color: string, r = 0.0009) => {
      const edge = duct - (dir * D_W) / 2;
      out.push({ color, radius: r, points: [[x, y, z], [x, y + dir * 0.012, z], [x, edge - dir * 0.008, 0.03], [x, edge + dir * 0.008, 0.03]] });
    };
    const tb = (x: number, rail: number, up: number, down: number | null, color: string, r = 0.0009) => {
      run(x, rail + TB1492_J3.length / 2, zE, 1, up, color, r);
      if (down !== null) run(x, rail - TB1492_J3.length / 2, zE, -1, down, color, r);
    };
    // R1: power terminals X1/X2 (120 V control), +24 / 0V, PE
    for (let i = 0; i < tbPwr.count; i++) tb(tbPwr.x + terminalX(i, tbPwr.count), R1_Y, D_TOP, D_MID, i < 2 ? '#c62828' : i < 4 ? '#eeeeee' : i < 6 ? '#1f4fd1' : i < 8 ? '#8fb3ff' : '#3f9a3a');
    // main disconnect: 480 V line (top) / load (bottom)
    for (const dx of [-0.026, 0, 0.026]) {
      run(DS.x + dx, DS.y + 0.062, 0.05, 1, D_TOP, '#111111', 0.0016);
      run(DS.x + dx, DS.y - 0.062, 0.05, -1, D_MID, '#111111', 0.0016);
    }
    // control power transformer: primary H1/H4 (through the fuse block), secondary X1 (red) / X2 (white)
    for (const dx of [-0.033, 0.033]) run(CPT.x + dx, CPT.y + 0.042, 0.046, 1, D_TOP, '#111111', 0.0011);
    run(CPT.x - 0.012, CPT.y - 0.042, 0.046, -1, D_MID, '#c62828');
    run(CPT.x + 0.012, CPT.y - 0.042, 0.046, -1, D_MID, '#eeeeee');
    // FU3, CB1 (PSU feed), CB2 (24 V distribution)
    for (const [x, c] of [
      [-0.18, '#c62828'],
      [-0.1575, '#c62828'],
      [-0.14, '#1f4fd1'],
    ] as const) {
      run(x, R1_Y + 0.043, zE + 0.03, 1, D_TOP, c);
      run(x, R1_Y - 0.043, zE + 0.03, -1, D_MID, c);
    }
    // 24 V supply: 120 V in (top), 24 V DC out (bottom)
    for (const [dx, c] of [
      [-0.018, '#c62828'],
      [0, '#eeeeee'],
      [0.018, '#3f9a3a'],
    ] as const)
      run(-0.085 + dx, R1_Y + 0.058, 0.09, 1, D_TOP, c);
    for (const [dx, c] of [
      [-0.018, '#1f4fd1'],
      [-0.006, '#1f4fd1'],
      [0.006, '#8fb3ff'],
      [0.018, '#8fb3ff'],
    ] as const)
      run(-0.085 + dx, R1_Y - 0.058, 0.09, -1, D_MID, c);
    // R2: motor protection breaker (line up / load down), starter, motor + control terminals
    for (const dx of [-0.0135, 0, 0.0135]) {
      run(MPCB_X + dx, R2_Y + 0.039, 0.045, 1, D_LOW, '#111111', 0.0014);
      run(MPCB_X + dx, R2_Y - 0.039, 0.045, -1, D_BOT, '#111111', 0.0014);
      run(STARTER_X + dx * 0.89, R2_Y + CONTACTOR_100C.h / 2, DIN_RAIL.height + 0.047, 1, D_LOW, '#111111', 0.0014);
      run(STARTER_X + dx * 0.89, R2_Y - CONTACTOR_100C.h / 2 - OVERLOAD_193E.h, DIN_RAIL.height + 0.04, -1, D_BOT, '#111111', 0.0014);
    }
    for (const dx of [-0.0195, 0.0195]) run(STARTER_X + dx, R2_Y + CONTACTOR_100C.h / 2, DIN_RAIL.height + 0.047, 1, D_LOW, '#1f4fd1');
    for (let i = 0; i < tbMot.count; i++) tb(tbMot.x + terminalX(i, tbMot.count), R2_Y, D_LOW, D_BOT, i < 3 ? '#111111' : '#3f9a3a', 0.0014);
    for (let i = 0; i < tbCtl.count; i++) tb(tbCtl.x + terminalX(i, tbCtl.count), R2_Y, D_LOW, D_BOT, i % 5 === 4 ? '#8fb3ff' : '#1f4fd1');
    // rack: RTB harnesses, patch cables and the PS cord into the duct under the rack
    out.push(...rackCableRuns({ hardware, layout, rackX: RACK_X, rackY: RACK_Y, ductTop: D_LOW + D_W / 2 }));
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ductWires = ['#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1', '#111111', '#c62828', '#111111'];
  const L = (a: string) => ioLine(runtime, a);
  const blink = useMemo(() => {
    let t0 = 0;
    return () => {
      t0 = performance.now();
      return state.overloadTripped && Math.floor(t0 / 350) % 2 === 0;
    };
  }, [state]);
  return (
    <group>
      <WireDuct length={0.66} position={[0, D_TOP, 0]} width={D_W} height={0.06} wires={ductWires} />
      <WireDuct length={0.6} position={[0, D_MID, 0]} width={D_W} height={0.06} wires={ductWires} />
      <WireDuct length={0.64} position={[0, D_LOW, 0]} width={D_W} height={0.06} wires={ductWires} />
      <WireDuct length={0.66} position={[0, D_BOT, 0]} width={D_W} height={0.06} wires={ductWires} />
      <WireDuct length={0.81} vertical position={[-0.345, 0, 0]} width={D_W} height={0.06} />
      <WireDuct length={0.81} vertical position={[0.345, 0, 0]} width={D_W} height={0.06} cover={false} wires={['#111111', '#111111', '#111111', '#1f4fd1', '#1f4fd1', '#3f9a3a']} />
      {/* upper row: CPT (bolted), fuse + breakers + 24 V supply + power terminals on a short rail, main disconnect (bolted) */}
      <ControlTransformer1497 position={[CPT.x, CPT.y, 0]} />
      <DinRail length={0.3} position={[R1_X, R1_Y, 0]}>
        <FuseHolder1492 position={[-0.18 - R1_X, 0, 0]} text="FU3 · 2 A" />
        <CircuitBreaker1489 poles={1} rating="C2" position={[-0.1575 - R1_X, 0, 0]} getOn={() => true} />
        <CircuitBreaker1489 poles={1} rating="C4" position={[-0.14 - R1_X, 0, 0]} getOn={() => true} />
        <PowerSupply1606 position={[-0.085 - R1_X, 0, 0]} getOk={() => true} />
        <TerminalBlocks1492 count={tbPwr.count} colors={Array.from({ length: tbPwr.count }, (_, i) => (i < 4 ? TB_COLORS.gray : i < 8 ? TB_COLORS.blue : TB_COLORS.green))} labels={['X1', 'X1', 'X2', 'X2', '+24', '+24', '0V', '0V', 'PE', 'PE']} position={[tbPwr.x - R1_X, 0, 0]} />
      </DinRail>
      <Disconnect1494 position={[DS.x, DS.y, 0]} rodTo={WALL_IN_X} />
      {/* rack */}
      <ControlLogixRack hardware={hardware} live={live} wired position={[RACK_X, RACK_Y, 0]} />
      {hardware.modules.map((mod) => (
        <IoTag
          key={mod.slot}
          {...PANEL}
          pin={false}
          position={[RACK_X - layout.width / 2 + layout.slotCenterX(mod.slot), RACK_Y + 0.075, 0.075]}
          size={[0.033, 0.145, 0.14]}
          anchor={[0, 0.082, 0.05]}
          title={`Slot ${mod.slot}`}
          lines={[textLine(mod.catalog, mod.name ?? (mod.slot === 0 ? 'Controller' : ''), `Local:${mod.slot}`)]}
        />
      ))}
      {/* lower row: 140M MPCB -> K1 contactor + OL1 overload -> motor terminals; control terminals */}
      <DinRail length={0.64} position={[0, R2_Y, 0]}>
        <Mpcb140M position={[MPCB_X, 0, 0]} />
        <group position={[STARTER_X, 0, 0]}>
          <Contactor100C getEnergized={() => state.contacts.on} catalog="100-C09" />
          <OverloadRelay193 position={[0, OL_Y, 0]} getTripped={() => state.overloadTripped} catalog="193-EEDB" variant="E1Plus" fla={6.6} range={[3.2, 16]} />
          {/* state cues: armature window (contacts closed), trip window (tripped), RESET (a reset would be accepted) */}
          <GlowDisc color="#39ff6a" getOn={() => state.contacts.on} size={0.034} position={C_WIN} gain={1.5} />
          <GlowDisc color="#ff3b1a" getOn={blink} size={0.036} position={OL_FLAG} gain={1.8} />
          <GlowDisc color="#3d8bff" getOn={() => state.overloadTripped && state.overloadResetReady} size={0.03} position={OL_RESET} gain={1.6} />
        </group>
        <TerminalBlocks1492 count={tbMot.count} colors={[TB_COLORS.gray, TB_COLORS.gray, TB_COLORS.gray, TB_COLORS.green]} labels={['T1', 'T2', 'T3', 'PE']} position={[tbMot.x, 0, 0]} />
        <TerminalBlocks1492 count={tbCtl.count} colors={Array.from({ length: tbCtl.count }, (_, i) => (i % 5 === 4 ? TB_COLORS.blue : TB_COLORS.gray))} position={[tbCtl.x, 0, 0]} />
      </DinRail>
      <IoTag
        {...PANEL}
        group={G.starter}
        position={[STARTER_X, R2_Y, DIN_RAIL.height]}
        size={[0.05, CONTACTOR_100C.h, 0.1]}
        center={[0, 0, 0.05]}
        anchor={[0, CONTACTOR_100C.h / 2 + 0.004, 0.09]}
        title="K1 · 100-C09 contactor (coil via E-stop + OL 95-96)"
        lines={[L('Motor_Starter'), L('Motor_Aux')]}
      />
      <IoTag
        {...PANEL}
        group={G.starter}
        position={[STARTER_X, R2_Y + OL_Y - OVERLOAD_193E.h / 2, DIN_RAIL.height]}
        size={[0.05, OVERLOAD_193E.h, 0.1]}
        center={[0, 0, 0.05]}
        anchor={[0.06, 0.0, 0.09]}
        title="OL1 · 193-E overload, FLA 6.6 A · click = blue RESET"
        lines={[L('OL_OK'), infoLine('Thermal', () => state.overloadHeat * 100, '%', 0)]}
        momentary={ctl.momentary('overload_reset')}
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
const JB_TOP = PEDESTAL.plateY1 + 0.08;

function Pedestal({ state, runtime }: P) {
  const ctl = useControls(runtime);
  const holesA = pushButtonStationHoles(ST_A.holes);
  const holesB = pushButtonStationHoles(ST_B.holes);
  const holesE = pushButtonStationHoles(1, E_OPTS);
  const L = (a: string) => ioLine(runtime, a);
  const paint = km.paint('#3d4247', 0.45, 0.45);
  const pz = ST_Z;
  const hole = (st: { x: number }, h: Vec3, y0 = ST_Y): Vec3 => [st.x + h[0], y0 + h[1], pz + h[2]];
  const PBTAG = { ...PANEL, group: G.station, size: [0.04, 0.06, 0.05] as Vec3, center: [0, 0.008, 0.025] as Vec3, anchor: [0, 0.045, 0.03] as Vec3 };
  // H-O-A: the whole selector cell is the click target: left half = one step toward HAND, right = toward AUTO
  const hoa = useMemo(
    () => (local: THREE.Vector3) => {
      const cur = Number(runtime.getControl('hoa'));
      const next = Math.max(0, Math.min(2, cur + (local.x < 0 ? -1 : 1)));
      if (next !== cur) {
        runtime.setControl('hoa', next);
        sfx.play('click');
      }
    },
    [runtime],
  );
  const lit = useMemo(() => ({ ready: () => state.readyLight, run: () => state.runLight, fault: () => state.faultLight, horn: () => state.horn }), [state]);
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
      <Slab min={[-0.06, PEDESTAL.plateY1, -0.04]} max={[0.06, JB_TOP, 0.05]} material={km.paint('#8d9296', 0.45, 0.4)} castShadow />
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
          ['CV-101', 'DRIVE', '5 HP', '460 V', 'LOTO', 'MCP-101', 'DS1'].forEach((t, i) => ctx.fillText(t, w / 2, h * (0.27 + i * 0.1)));
        }}
      />
      {/* warning horn + amber beacon on the junction box (sounds with the Horn output) */}
      <IoTag position={[0.028, JB_TOP, 0.012]} size={[0.075, 0.1, 0.075]} center={[0, 0.05, 0]} anchor={[0, 0.115, 0]} group={G.station} title="Warning horn + amber beacon (856T)" lines={[L('Horn')]}>
        <StackLight856T tiers={['amber']} getTier={lit.horn} getHorn={lit.horn} getFlashing={() => true} mount="base" showSoundFx />
      </IoTag>
      {/* stations (cabling enters from the back through the mounting plate: no bottom glands) */}
      <PushButtonStation holes={ST_A.holes} position={[ST_A.x, ST_Y, pz]} autoPlace={false} gland={false} />
      <PushButtonStation holes={ST_B.holes} position={[ST_B.x, ST_Y, pz]} autoPlace={false} gland={false} />
      <PushButtonStation holes={1} color="yellow" {...E_OPTS} position={[ST_B.x, E_Y, pz]} autoPlace={false} gland={false} />
      {/* column A: READY / RUN / FAULT / H-O-A */}
      <IoTag position={hole(ST_A, holesA[0]!, ST_Y)} {...PBTAG} title="800F white LED pilot light" lines={[L('Ready_Light')]}>
        <LampBoost color="white" getLit={lit.ready}>
          <PilotLight800F color="white" legend="READY" getLit={lit.ready} rear={false} />
        </LampBoost>
      </IoTag>
      <IoTag position={hole(ST_A, holesA[1]!, ST_Y)} {...PBTAG} title="800F green LED pilot light" lines={[L('Run_Light')]}>
        <LampBoost color="green" getLit={lit.run}>
          <PilotLight800F color="green" legend="RUN" getLit={lit.run} rear={false} />
        </LampBoost>
      </IoTag>
      <IoTag position={hole(ST_A, holesA[2]!, ST_Y)} {...PBTAG} title="800F red LED pilot light" lines={[L('Fault_Light')]}>
        <LampBoost color="red" getLit={lit.fault}>
          <PilotLight800F color="red" legend="FAULT" getLit={lit.fault} rear={false} />
        </LampBoost>
      </IoTag>
      <IoTag position={hole(ST_A, holesA[3]!, ST_Y)} {...PBTAG} title="800F 3-pos selector · click left/right half" lines={[L('HOA_Hand'), L('HOA_Auto')]} onPress={hoa}>
        <SelectorSwitch800F positions={['HAND', 'OFF', 'AUTO']} legend="H-O-A" getPosition={() => state.controls.hoa} rear={false} />
      </IoTag>
      {/* column B: START / STOP / JOG, E-stop on top */}
      <IoTag position={hole(ST_B, holesB[0]!, ST_Y)} {...PBTAG} title="800F green flush PB (N.O.) · key S" lines={[L('Start_PB')]} momentary={ctl.momentary('start')}>
        <PushButton800F color="green" legend="START" contact="N.O." getPressed={() => state.controls.start} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_B, holesB[1]!, ST_Y)} {...PBTAG} title="800F red extended PB (N.C.) · key X" lines={[L('Stop_PB')]} momentary={ctl.momentary('stop')}>
        <PushButton800F color="red" style="extended" legend="STOP" contact="N.C." getPressed={() => state.controls.stop} rear={false} />
      </IoTag>
      <IoTag position={hole(ST_B, holesB[2]!, ST_Y)} {...PBTAG} title="800F black flush PB (N.O.) · key J" lines={[L('Jog_PB')]} momentary={ctl.momentary('jog')}>
        <PushButton800F color="black" legend="JOG" contact="N.O." getPressed={() => state.controls.jog} rear={false} />
      </IoTag>
      <IoTag
        position={hole(ST_B, holesE[0]!, E_Y)}
        {...PANEL}
        group={G.station}
        size={[0.07, 0.07, 0.055]}
        center={[0, 0, 0.0275]}
        anchor={[0, 0.045, 0.03]}
        title="800FM E-stop, 2 × N.C. · click: push / twist-release"
        lines={[L('EStop_OK')]}
        onPress={ctl.toggle('estop', 'press')}
      >
        <EStop800FM getEngaged={() => state.controls.estop} rear={false} />
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
  const toggle = useMemo(
    () => () => {
      runtime.setControl('remote_run', !runtime.getControl('remote_run'));
      sfx.play('click');
    },
    [runtime],
  );
  const on = useMemo(() => () => state.controls.remote_run, [state]);
  const tag = { ...PANEL, group: G.remote, size: [0.04, 0.06, 0.05] as Vec3, center: [0, 0.008, 0.025] as Vec3, anchor: [0, 0.045, 0.03] as Vec3 };
  return (
    <group position={[REMOTE.x, REMOTE.y, z]}>
      <PushButtonStation holes={2} autoPlace={false} gland={false} />
      <IoTag position={holes[0]!} {...tag} title="Upstream line run request (relay contact)" lines={[L]}>
        <LampBoost color="blue" getLit={on}>
          <PilotLight800F color="blue" legend="REMOTE" getLit={on} rear={false} />
        </LampBoost>
      </IoTag>
      <IoTag position={holes[1]!} {...tag} title="Upstream request test switch · click" lines={[textLine('LINE 2 switch', () => (state.controls.remote_run ? 'RUN' : 'OFF'))]} onPress={toggle}>
        <SelectorSwitch800F positions={['OFF', 'RUN']} legend="LINE 2" getPosition={() => (state.controls.remote_run ? 1 : 0)} rear={false} />
      </IoTag>
      <SignPlate
        id="remote-sign"
        size={[0.2, 0.09]}
        position={[-0.16, 0.1, 0.002]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#1f4f9c';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          fitFont(ctx, 'UPSTREAM LINE 2', w * 0.9, h * 0.3);
          ctx.fillText('UPSTREAM LINE 2', w / 2, h * 0.4);
          fitFont(ctx, 'RUN REQUEST → CV-101', w * 0.9, h * 0.2, 600);
          ctx.fillText('RUN REQUEST → CV-101', w / 2, h * 0.74);
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
          id="disc-label-v2"
          size={[0.12, 0.035]}
          position={[0, -0.075, 0.061]}
          draw={(ctx, w, h) => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#111';
            fitFont(ctx, 'M-101 DISC.', w * 0.86, h * 0.56, 800);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('M-101 DISC.', w / 2, h / 2 + 1);
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
  BIN_OCCLUDER,
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
  // pedestal post + plate, top junction box, stations
  [
    [PEDESTAL.x - 0.105, 0, PEDESTAL.z - 0.04],
    [PEDESTAL.x + 0.105, PEDESTAL.plateY1, PEDESTAL.z + 0.046],
  ],
  [
    [PEDESTAL.x - 0.06, PEDESTAL.plateY1, PEDESTAL.z - 0.04],
    [PEDESTAL.x + 0.06, JB_TOP, PEDESTAL.z + 0.05],
  ],
  [
    [PEDESTAL.x - 0.09, ST_Y, PEDESTAL.z + 0.05],
    [PEDESTAL.x + 0.092, E_Y + 0.1, PEDESTAL.z + 0.05 + 0.07],
  ],
  // local disconnect + stanchion
  [
    [STANCHION.x - 0.08, 1.29, STANCHION.z + 0.021],
    [STANCHION.x + 0.08, 1.51, STANCHION.z + 0.141],
  ],
  [
    [STANCHION.x - 0.021, 0, STANCHION.z - 0.021],
    [STANCHION.x + 0.021, TRAY.y, STANCHION.z + 0.021],
  ],
  // drive deck, gearbox, motor
  [
    [DRIVE.deck.x0, DRIVE.deck.top - 0.11, DRIVE.deck.z0],
    [DRIVE.deck.x1, DRIVE.deck.top, DRIVE.deck.z1],
  ],
  [
    [0.47, DRIVE.deck.top, HEAD_Z - 0.082],
    [0.65, AXIS_Y + 0.1, HEAD_Z + 0.082],
  ],
  [
    [0.76, DRIVE.deck.top + 0.02, HEAD_Z - 0.1],
    [1.22, AXIS_Y + 0.1, HEAD_Z + 0.1],
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
  const clearJam = useMemo(
    () => () => {
      runtime.setControl('jam', false);
      sfx.play('click');
    },
    [runtime],
  );
  const jamActive = useMemo(() => () => state.controls.jam, [state]);
  const horn = useMemo(() => () => state.horn, [state]);

  const motorAngle = () => state.shaftAngle;
  const outAngle = () => headAngle(state.beltPosition);
  const wallOutX = CABINET.pos[0] + CABINET.size[0] / 2;

  return (
    <TagLayer occluders={OCCLUDERS} pinStyle="pill">
      <MotorBay />

      {/* ---- conveyor CV-101 (local X runs toward +Z) ---- */}
      <group position={[CONV.x, 0, CONV.z0]} rotation={[0, -Math.PI / 2, 0]}>
        <Conveyor length={CONV.length} width={CONV.width} height={CONV.height} getBeltPosition={() => state.beltPosition} driveSide="none" frameStyle="powder" frameColor={MACHINE_BLUE} />
        <Boxes getBoxes={getBoxes} maxCount={8} />
        <group ref={jamVisible} visible={false}>
          {/* wedged against the far side rail, nose up */}
          <IoTag position={[JAM_X, CONV.height + 0.03, CONV.width / 2 - 0.14]} size={[0.4, 0.44, 0.32]} center={[0, 0.2, 0]} anchor={[0, 0.48, 0]} title="Conveyor jam (instructor fault)" lines={lines.jam} onPress={clearJam} active={jamActive}>
            <JamMarker state={state} />
          </IoTag>
        </group>
      </group>

      {/* ---- drive: platform, gearbox, couplings, guards, motor ---- */}
      <DrivePlatform />
      <InlineReducer getInputAngle={motorAngle} getOutputAngle={outAngle} />
      <CouplingGuard x0={0.692} x1={0.8} halfW={0.062} top={0.07} />
      <CouplingGuard x0={0.325} x1={0.41} halfW={0.07} top={0.075} />
      <IoTag position={[DRIVE.motor[0] + 0.03, AXIS_Y, HEAD_Z]} size={[0.5, 0.26, 0.3]} anchor={[0, 0.2, 0]} title="M-101 · 5 HP TEFC motor, 184T, 460 V, 6.6 A FLA" lines={lines.motor}>
        <group position={[-0.03, DRIVE.motor[1] - AXIS_Y, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <Motor frame="medium" getRpm={() => state.motorRpm} getShaftAngle={motorAngle} getOverloaded={() => state.stallMs > 600} />
        </group>
      </IoTag>
      <DeckJunctionBox position={[0.93, DRIVE.deck.top - 0.07, DRIVE.deck.z1 + 0.036]} />

      {/* ---- control panel MCP-101 (460 V) ---- */}
      <Enclosure size={CABINET.size} position={CABINET.pos} doorAngle={2.0} nameplate={'MCP-101\nCONVEYOR CV-101\n460 V 3 PH 60 HZ'} glands={0}>
        <PanelInterior state={state} runtime={runtime} />
      </Enclosure>
      <FlangeHandle position={[wallOutX, CABINET.pos[1] + CABINET.size[1] / 2 + DS.y + 0.02, CABINET.pos[2] + BP_Z + ROD_Z]} />
      <IoTag position={[CABINET.pos[0] + 0.26, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + 0.17]} size={[0.09, 0.2, 0.09]} center={[0, 0.1, 0]} anchor={[0, 0.22, 0]} title="Warning horn / amber beacon (panel)" lines={lines.horn} pin={false}>
        <StackLight856T tiers={['amber']} getTier={horn} getHorn={horn} getFlashing={() => true} mount="base" />
      </IoTag>

      {/* ---- conduit & field wiring ---- */}
      {[-0.13, -0.02].map((dx) => (
        <Conduit key={dx} points={[[CABINET.pos[0] + dx, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + 0.12], [CABINET.pos[0] + dx, TRAY.y, CABINET.pos[2] + 0.12]]} />
      ))}
      {/* 480 V feeder into the top of the panel, straight above the main disconnect */}
      <Conduit points={[[CABINET.pos[0] + DS.x, CABINET.pos[1] + CABINET.size[1], CABINET.pos[2] + 0.1], [CABINET.pos[0] + DS.x, TRAY.y - 0.1, CABINET.pos[2] + 0.1], [CABINET.pos[0] + DS.x, TRAY.y, CABINET.pos[2] + 0.2]]} radius={0.016} />
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
          [TRAY.runX + 0.1, TRAY.y, PEDESTAL.z - 0.012],
          [TRAY.runX + 0.1, 2.15, PEDESTAL.z - 0.012],
          [PEDESTAL.x - 0.03, 1.9, PEDESTAL.z - 0.012],
          [PEDESTAL.x - 0.03, JB_TOP, PEDESTAL.z - 0.012],
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
