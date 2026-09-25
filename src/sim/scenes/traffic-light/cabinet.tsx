/**
 * Roadside signal controller cabinet of the `traffic-light` scene: the traffic kit's NEMA-style
 * <SignalCabinet/> (door open, click the door to close/open it) with, in its controller zone, the live
 * CompactLogix 5380 rack (5069-L320ER + 5069-IB16 + 5069-OB16), a 1606 24 V DC supply and a terminal
 * strip on a DIN rail, ducts and the wiring between them (PSU → MOD / SA power, rack duct → terminals →
 * field / power panel).
 *
 *  - AUTO / FLASH key switch (Night_Mode, maintained) on the POLICE PANEL of the door, where real
 *    cabinets put the flash switch (accessible without opening the cabinet).
 *  - Detector card 1 on the shelf is the loop detector amplifier: its DET LED lights while the loop
 *    output (Car_Sensor_EW) is on — the loop itself is only a coil of wire in the pavement.
 *  - MMU (conflict monitor): POWER LED, CONFLICT LED while conflicting outputs are on.
 *  - The 12 load-switch indicators mirror the PLC outputs (LS2 = NS heads, LS4 = EW heads, LS6/LS8 = their
 *    other approaches, LS10 = the pedestrian head: red = DON'T WALK, green = WALK).
 *
 * Far away, the interior swaps to a 3-mesh impostor; walls, roof and the closed door block clicks.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import {
  CompactLogixRack,
  CPX_CTRL,
  DinRail,
  layoutCompactLogixRack,
  PowerSupply1606,
  SIGNAL_CABINET_DIMS,
  SignalCabinet,
  TB_COLORS,
  TerminalBlocks1492,
  Wire,
  WireBundle,
  WireDuct,
} from '../../../twin/devices';
import { rackLiveFromController } from '../../../twin/live';
import type { SimRuntime } from '../../types';
import { audioAllowed, IoTag, ioLine, kgeo, kmat, textLine, type TagGroup } from '../trainer/kit';
import { DistanceSwitch } from '../trainer/rackLod';
import { ClickBlocker, KeySwitch800F, useNoCastShadow } from './cityKit';
import type { TrafficLightState } from './logic';

/** Controller layout on the back panel (back-panel coordinates, see SIGNAL_CABINET_DIMS.controllerZone). */
const RACK = { x: -0.125, y: 0.02 };
const RAIL2 = { x: 0.085, y: 0.1, len: 0.17 };
const PSU_X = RAIL2.x - 0.05;
const TB_X = RAIL2.x + 0.047;
/** Top wire duct (horizontal) and right-hand riser duct. */
const TOP_DUCT = { y: 0.197, x0: -0.24, x1: 0.215 };
const RISER = { x: 0.232, y0: -0.075, y1: 0.215 };
/** Shelf equipment fronts (from SignalCabinet's interior layout). */
const SHELF_Y = SIGNAL_CABINET_DIMS.shelfY;
const MMU = { x: -0.34, y: SHELF_Y + 0.07, z: 0.2945 };
const DET_CARD = { x: 0.25, y: SHELF_Y + 0.08, z: 0.2765 };

const DOOR_OPEN = 1.95;
const C = SIGNAL_CABINET_DIMS;

const RED = '#c62828';
const BLUE = '#1f4fd1';
const WHT = '#e8e8e8';
const GRN_YEL = '#9bbf2a';

export function TrafficCabinet({
  state,
  runtime,
  position,
  rotationY,
  tagGroup,
}: {
  state: TrafficLightState;
  runtime: SimRuntime;
  position: [number, number, number];
  rotationY: number;
  tagGroup?: TagGroup;
}) {
  const live = useMemo(() => rackLiveFromController(runtime.controller), [runtime.controller]);
  const hardware = runtime.scene.hardware;
  const layout = useMemo(() => layoutCompactLogixRack(hardware.modules), [hardware.modules]);
  const door = useRef({ open: true, angle: DOOR_OPEN });
  useFrame((_, dt) => {
    const d = door.current;
    d.angle = THREE.MathUtils.damp(d.angle, d.open ? DOOR_OPEN : 0, 4, Math.min(dt, 0.05));
  });
  const L = state.lamps;
  const getLoadSwitchLed = useMemo(
    () =>
      (slot: number, lamp: 0 | 1 | 2): boolean => {
        if (slot === 1 || slot === 5) return lamp === 0 ? L.nsRed : lamp === 1 ? L.nsYellow : L.nsGreen;
        if (slot === 3 || slot === 7) return lamp === 0 ? L.ewRed : lamp === 1 ? L.ewYellow : L.ewGreen;
        if (slot === 9) return lamp === 0 ? L.dontWalk : lamp === 2 ? L.walk : false;
        return false;
      },
    [L],
  );
  const toggleNight = useMemo(
    () => () => {
      runtime.setControl('night', !runtime.getControl('night'));
      sfx.play('toggle');
      // flash-transfer relays drop in/out a moment later
      window.setTimeout(() => audioAllowed() && sfx.play('contactor'), 180);
    },
    [runtime],
  );
  const interior = useRef<THREE.Group>(null);
  useNoCastShadow(interior);
  const closed = useMemo(() => () => door.current.angle < 0.35, []);
  const W = C.width;
  const H = C.height;
  const D = C.depth;
  const B = C.base;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <SignalCabinet
        label="CAB 07 · MAIN / LOGIX"
        getDoorAngle={() => door.current.angle}
        onDoorClick={() => {
          door.current.open = !door.current.open;
          sfx.play('click');
        }}
        getLoadSwitchLed={getLoadSwitchLed}
        policePanel={
          <IoTag
            position={[0, -0.035, 0]}
            size={[0.07, 0.1, 0.07]}
            center={[0, 0.01, 0.025]}
            anchor={[0, 0.075, 0.03]}
            title="Police panel AUTO / FLASH key switch (maintained) — Night_Mode"
            lines={[ioLine(runtime, 'Night_Mode')]}
            group={tagGroup}
            facing
          >
            <KeySwitch800F legend={['SIGNALS']} positions={['AUTO', 'FLASH']} getOn={() => runtime.getControl('night') === true} onToggle={toggleNight} scale={1.25} />
          </IoTag>
        }
      >
        <group ref={interior}>
          <DistanceSwitch
            distance={7}
            near={<Interior state={state} runtime={runtime} live={live} layout={layout} tagGroup={tagGroup} />}
            far={<InteriorImpostor />}
          />
          <ShelfIndicators state={state} runtime={runtime} />
        </group>
      </SignalCabinet>
      {/* click blockers: side walls, back, roof (always) and the door opening while the door is closed */}
      <ClickBlocker position={[-W / 2, B + H / 2, 0]} size={[0.02, H, D]} />
      <ClickBlocker position={[W / 2, B + H / 2, 0]} size={[0.02, H, D]} />
      <ClickBlocker position={[0, B + H / 2, -D / 2]} size={[W, H, 0.02]} />
      <ClickBlocker position={[0, B + H + 0.06, 0]} size={[W + 0.1, 0.12, D + 0.1]} />
      <ClickBlocker position={[0, B + H / 2, D / 2 - 0.03]} size={[W - 0.03, H - 0.04, 0.02]} getEnabled={closed} />
    </group>
  );
}

type RackLayout = ReturnType<typeof layoutCompactLogixRack>;

/** Live rack, supply, terminals, ducts and wiring (back-panel coordinates). */
function Interior({
  state,
  runtime,
  live,
  layout,
  tagGroup,
}: {
  state: TrafficLightState;
  runtime: SimRuntime;
  live: ReturnType<typeof rackLiveFromController>;
  layout: RackLayout;
  tagGroup?: TagGroup;
}) {
  void state;
  void tagGroup;
  const hardware = runtime.scene.hardware;
  const tbLabels = ['+24', '+24', '0V', '0V', 'I0', 'I1', 'I2', 'O0', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'PE'];
  const tbColors = tbLabels.map((l) => (l === '0V' ? TB_COLORS.blue : l === '+24' ? TB_COLORS.red : TB_COLORS.gray));
  const wires = useMemo(() => buildWires(layout), [layout]);
  return (
    <group>
      <CompactLogixRack hardware={hardware} live={live} wiring={{ 1: [0, 1, 2], 2: [0, 1, 2, 3, 4, 5, 6, 7] }} position={[RACK.x, RACK.y, 0]} />
      {layout.slots.map((s) => (
        <IoTag
          key={s.slot}
          position={[RACK.x + s.x, RACK.y + 0.075, 0.07]}
          size={[s.width, 0.15, 0.12]}
          anchor={[0, 0.085, 0.04]}
          title={`Slot ${s.slot}`}
          lines={[textLine(s.catalog, s.slot === 0 ? 'CompactLogix 5380' : s.slot === 1 ? 'DI_Signal' : 'DO_Signal', `Local:${s.slot}`)]}
        />
      ))}
      <DinRail length={RAIL2.len} position={[RAIL2.x, RAIL2.y, 0]}>
        <PowerSupply1606 position={[PSU_X - RAIL2.x, 0, 0]} getOk={() => true} />
        <TerminalBlocks1492 count={tbLabels.length} labels={tbLabels} colors={tbColors} position={[TB_X - RAIL2.x, 0, 0]} />
      </DinRail>
      {/* ducts: top run over the rack + riser on the right (covers off, conductors visible) */}
      <WireDuct length={TOP_DUCT.x1 - TOP_DUCT.x0} position={[(TOP_DUCT.x0 + TOP_DUCT.x1) / 2, TOP_DUCT.y, 0]} width={0.034} height={0.05} wires={[RED, BLUE, RED, BLUE, WHT, WHT]} cover={false} />
      <WireDuct length={RISER.y1 - RISER.y0} vertical position={[RISER.x, (RISER.y0 + RISER.y1) / 2, 0]} width={0.034} height={0.05} wires={[WHT, WHT, BLUE, RED, WHT]} cover={false} />
      {wires.single.map((w, i) => (
        <Wire key={i} points={w.p} color={w.c} radius={0.0012} bendRadius={0.006} ferrules={w.f} />
      ))}
      {wires.bundles.map((b, i) => (
        <WireBundle key={`b${i}`} points={b.p} colors={b.c} radius={0.0011} bendRadius={0.018} tieSpacing={0.06} />
      ))}
    </group>
  );
}

/** Conductor routes (back-panel coordinates). */
function buildWires(layout: RackLayout) {
  const single: { p: Vec3[]; c: string; f: boolean }[] = [];
  const bundles: { p: Vec3[]; c: string[] }[] = [];
  const ctrl = layout.slots[0]!;
  // controller power column: MOD and SA RTBs (see CompactLogix5380Controller: power column, terminal rows)
  const xPwr = RACK.x + ctrl.x - CPX_CTRL.width / 2 + CPX_CTRL.powerColumn / 2;
  const zT = 0.0075 + 0.1038;
  const duckBottom = TOP_DUCT.y - 0.017;
  const top = RACK.y + CPX_CTRL.height + 0.008;
  const pwr: [number, number, string][] = [
    [-0.005, 0.0925, RED], // MOD+
    [0.005, 0.0805, BLUE], // MOD-
    [-0.005, 0.0555, RED], // SA+
    [0.005, 0.0435, BLUE], // SA-
  ];
  pwr.forEach(([u, v, c], i) => {
    const x = xPwr + u;
    const y = RACK.y + v - 0.00225;
    const zf = zT + 0.012 + i * 0.004;
    single.push({ p: [[x, duckBottom, 0.03], [x, top, 0.03 + i * 0.004], [x, top, zf], [x, y + 0.004, zf], [x, y, zT + 0.001]], c, f: true });
  });
  // PSU output (+ + − − on top) up into the top duct
  const psuTop = RAIL2.y + 0.124 / 2 - 0.015;
  [-0.02, -0.01, 0.0, 0.01].forEach((dx, i) => {
    const x = PSU_X + dx;
    const c = i < 2 ? RED : BLUE;
    single.push({ p: [[x, psuTop, 0.1], [x, psuTop + 0.012, 0.1], [x, duckBottom - 0.004, 0.06], [x, duckBottom, 0.03]], c, f: true });
  });
  // PSU input (N L PE at the bottom): down, then right to the riser
  const psuBot = RAIL2.y - 0.124 / 2 + 0.015;
  [-0.012, 0.0, 0.012].forEach((dx, i) => {
    const x = PSU_X + dx;
    const c = i === 0 ? BLUE : i === 1 ? '#6b4a2b' : GRN_YEL;
    const y = RAIL2.y - 0.085 - i * 0.004;
    single.push({ p: [[x, psuBot, 0.1], [x, psuBot - 0.012, 0.1], [x, y, 0.05], [RISER.x - 0.03, y, 0.035], [RISER.x - 0.017, y, 0.025]], c, f: false });
  });
  // terminal strip: +24 / 0V feeders up into the top duct, field side down into the riser
  const tbTop = RAIL2.y + 0.03;
  const tbBot = RAIL2.y - 0.03;
  for (let i = 0; i < 4; i++) {
    const x = TB_X - 0.038 + i * 0.0051;
    single.push({ p: [[x, tbTop, 0.045], [x, tbTop + 0.01, 0.045], [x, duckBottom, 0.03]], c: i < 2 ? RED : BLUE, f: true });
  }
  // rack duct (field wires of IB16 / OB16) → terminal strip bottom row
  const ductR = RACK.x + layout.railLength / 2 + 0.01;
  const rackDuctY = RACK.y - 0.045 - 0.02;
  bundles.push({
    p: [
      [ductR - 0.005, rackDuctY, 0.03],
      [ductR + 0.03, rackDuctY, 0.035],
      [TB_X - 0.012, rackDuctY + 0.004, 0.04],
      [TB_X - 0.012, tbBot - 0.006, 0.045],
    ],
    c: [WHT, WHT, WHT, '#1d4ed8', '#1d4ed8', WHT, WHT, WHT],
  });
  // terminal strip field side → riser → out to the load bay / field terminals
  bundles.push({
    p: [
      [TB_X + 0.02, tbBot - 0.006, 0.045],
      [TB_X + 0.02, tbBot - 0.03, 0.04],
      [RISER.x - 0.017, tbBot - 0.04, 0.03],
    ],
    c: [WHT, WHT, WHT, WHT, WHT, WHT],
  });
  // top duct → power panel (upper right), riser foot → load bay below the shelf
  bundles.push({
    p: [
      [TOP_DUCT.x1 + 0.004, TOP_DUCT.y, 0.03],
      [0.3, TOP_DUCT.y + 0.005, 0.035],
      [0.33, 0.24, 0.045],
    ],
    c: [RED, BLUE, '#6b4a2b', BLUE, GRN_YEL],
  });
  bundles.push({
    p: [
      [RISER.x, RISER.y0 - 0.002, 0.03],
      [RISER.x, SHELF_Y + 0.02, 0.012],
      [RISER.x - 0.04, SHELF_Y + 0.012, 0.012],
      [RISER.x - 0.07, SHELF_Y - 0.01, 0.01],
    ],
    c: [WHT, WHT, WHT, WHT, WHT, WHT, WHT],
  });
  return { single, bundles };
}

/** Far-away stand-in for the interior (rack + supply + strip silhouettes). */
function InteriorImpostor() {
  const dark = kmat('tl:impDark', () => new THREE.MeshStandardMaterial({ color: '#1d2023', roughness: 0.55 }));
  const light = kmat('tl:impLight', () => new THREE.MeshStandardMaterial({ color: '#c9ccce', roughness: 0.6 }));
  const box = kgeo('tl:impBox', () => new THREE.BoxGeometry(1, 1, 1));
  return (
    <group>
      <mesh geometry={box} material={dark} position={[RACK.x, RACK.y + 0.072, 0.075]} scale={[0.155, 0.145, 0.14]} />
      <mesh geometry={box} material={light} position={[PSU_X, RAIL2.y, 0.06]} scale={[0.06, 0.124, 0.11]} />
      <mesh geometry={box} material={light} position={[0, TOP_DUCT.y, 0.025]} scale={[0.46, 0.034, 0.05]} />
    </group>
  );
}

const LED_OFF = { red: new THREE.Color(0.25, 0.03, 0.02), green: new THREE.Color(0.02, 0.2, 0.06), amber: new THREE.Color(0.25, 0.15, 0.02) };
const LED_ON = { red: new THREE.Color(6, 0.25, 0.1), green: new THREE.Color(0.3, 5, 0.9), amber: new THREE.Color(6, 3, 0.2) };

/** MMU and detector-card indicators (live) with their tags. */
function ShelfIndicators({ state, runtime }: { state: TrafficLightState; runtime: SimRuntime }) {
  const mats = useMemo(
    () => ({
      mmuPwr: new THREE.MeshBasicMaterial({ color: LED_ON.green, toneMapped: false }),
      mmuConflict: new THREE.MeshBasicMaterial({ color: LED_OFF.red.clone(), toneMapped: false }),
      det: new THREE.MeshBasicMaterial({ color: LED_OFF.amber.clone(), toneMapped: false }),
      detPwr: new THREE.MeshBasicMaterial({ color: LED_ON.green, toneMapped: false }),
    }),
    [],
  );
  const loop = useMemo(() => ioLine(runtime, 'Car_Sensor_EW'), [runtime]);
  const last = useRef({ c: -1, d: -1 });
  useFrame(() => {
    const recent = state.lastConflictMs >= 0 && state.timeMs >= state.lastConflictMs && state.timeMs - state.lastConflictMs < 4000;
    const c = state.conflict || recent ? 1 : 0;
    if (c !== last.current.c) {
      last.current.c = c;
      mats.mmuConflict.color.copy(c ? LED_ON.red : LED_OFF.red);
    }
    const d = state.carSensorEw ? 1 : 0;
    if (d !== last.current.d) {
      last.current.d = d;
      mats.det.color.copy(d ? LED_ON.amber : LED_OFF.amber);
    }
  });
  const led = kgeo('tl:shelfLed', () => new THREE.CylinderGeometry(0.0032, 0.0032, 0.003, 12).rotateX(Math.PI / 2));
  const legend = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#111416';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '700 22px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('POWER', 34, 18);
    ctx.fillText('CONFLICT', 34, 46);
    ctx.fillText('DET 1', 178, 18);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  }, []);
  return (
    <group>
      {/* MMU front: POWER + CONFLICT */}
      <mesh geometry={led} material={mats.mmuPwr} position={[MMU.x - 0.09, MMU.y + 0.035, MMU.z]} />
      <mesh geometry={led} material={mats.mmuConflict} position={[MMU.x - 0.09, MMU.y + 0.015, MMU.z]} />
      <mesh position={[MMU.x - 0.055, MMU.y + 0.025, MMU.z - 0.001]} material={legend}>
        <planeGeometry args={[0.05, 0.03]} />
      </mesh>
      <IoTag
        position={[MMU.x, MMU.y, MMU.z]}
        size={[0.24, 0.12, 0.04]}
        anchor={[0, 0.08, 0.02]}
        title="MMU conflict monitor (watches the field outputs; not a PLC input)"
        lines={[textLine('CONFLICT', () => (state.conflict ? 'TRIPPED' : 'ok'))]}
        pin={false}
      />
      {/* detector card 1 = loop amplifier for the side-street loops */}
      <mesh geometry={led} material={mats.detPwr} position={[DET_CARD.x, DET_CARD.y + 0.052, DET_CARD.z]} />
      <mesh geometry={led} material={mats.det} position={[DET_CARD.x, DET_CARD.y + 0.038, DET_CARD.z]} />
      <IoTag
        position={[DET_CARD.x, DET_CARD.y, DET_CARD.z]}
        size={[0.045, 0.14, 0.03]}
        anchor={[0, 0.085, 0.01]}
        title="Loop detector amplifier, card 1 (loops EB + WB) → output to Local:1:I.Pt01"
        lines={[loop]}
        pin={false}
      />
    </group>
  );
}
