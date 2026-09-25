/**
 * Attendant booth of the `parking-garage` scene: a small prefab kiosk (insulated panels, ribbon windows,
 * flat roof with a lit fascia, door ajar) on the island between the exit lane and the plaza. Inside:
 * the attendant's desk with the COUNT RESET key switch (Reset_Key, spring return — hold the key) and,
 * on the east wall, the gate control panel GCP-1 (wall-mount enclosure, door open — click it to close) with
 * the live CompactLogix 5380 rack, breakers, a 24 V supply, terminal strips, open wire ducts and the wiring
 * between them (feeder → breakers → PSU → MOD / SA power, rack duct → riser → I/O terminals → gland plate →
 * conduit into the floor toward the gates, loops and photo-eyes).
 *
 * Far away the panel interior swaps to an impostor (the rack to its own built-in one); roof, walls, glass and the closed panel door block
 * clicks, so hidden devices can only be operated from where they can be seen.
 */
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { sfx } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import {
  CircuitBreaker1489,
  CompactLogixRack,
  CPX_CTRL,
  DinRail,
  Enclosure,
  layoutCompactLogixRack,
  Pedestrian,
  PowerSupply1606,
  TB_COLORS,
  TerminalBlocks1492,
  Wire,
  WireBundle,
  WireDuct,
} from '../../../twin/devices';
import { rackLiveFromController } from '../../../twin/live';
import type { SimRuntime } from '../../types';
import { canvasTexture, Conduit, FONT, IoTag, ioLine, kgeo, kmat, textLine, type TagGroup } from '../trainer/kit';
import { DistanceLod } from '../../../twin/lod';
import { ClickBlocker, KeySwitch800F, StaticInstances, useDisposeOnUnmount, useNoCastShadow, type InstXf } from '../traffic-light/cityKit';
import { CURB, SITE } from './site';

const B = SITE.booth;
const FLOOR = CURB + 0.01;
const SILL = FLOOR + 1.0;
const HEAD = FLOOR + 2.3;
const TOP = FLOOR + 2.72;
const DOOR = { x0: 7.25, x1: 8.1 };

/** Booth shell as thin occluder slabs for the tag chips (walls + roof; devices inside are hidden from outside). */
export const BOOTH_OCCLUDERS: Array<[Vec3, Vec3]> = [
  [[B.x0, CURB, B.z0], [B.x0 + 0.08, CURB + 2.72, B.z1]],
  [[B.x1 - 0.08, CURB, B.z0], [B.x1, CURB + 2.72, B.z1]],
  [[B.x0, CURB, B.z0], [B.x1, CURB + 2.72, B.z0 + 0.08]],
  [[B.x0, CURB, B.z1 - 0.08], [B.x1, CURB + 2.72, B.z1]],
  [[B.x0 - 0.35, CURB + 2.72, B.z0 - 0.35], [B.x1 + 0.35, CURB + 2.95, B.z1 + 0.35]],
];

/** Enclosure placement (back face on the east wall, facing west). */
export const BOOTH_PANEL = { x: B.x1 - 0.09, y: FLOOR + 0.95, z: 9.25, size: [0.6, 0.76, 0.25] as Vec3 };
/** Desk console with the key switch. */
export const BOOTH_KEY = { x: 7.52, y: FLOOR + 0.76, z: 8.55 };

const panelMat = () => kmat('pg:boothPanel', () => new THREE.MeshStandardMaterial({ color: '#e4e7e8', roughness: 0.45, metalness: 0.2 }));
const frameMat = () => kmat('pg:boothFrame', () => new THREE.MeshStandardMaterial({ color: '#2a3036', roughness: 0.4, metalness: 0.6 }));
const glassMat = () =>
  kmat('pg:boothGlass', () => new THREE.MeshStandardMaterial({ color: '#a9c7d6', roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
const deskMat = () => kmat('pg:desk', () => new THREE.MeshStandardMaterial({ color: '#8b6b4d', roughness: 0.6 }));
const floorMat = () => kmat('pg:boothFloor', () => new THREE.MeshStandardMaterial({ color: '#5b6166', roughness: 0.8 }));
const unitBox = () => kgeo('pg:unitBox', () => new THREE.BoxGeometry(1, 1, 1));

function bx(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): InstXf {
  return { p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], s: [x1 - x0, y1 - y0, z1 - z0] };
}

function BoothShell() {
  const t = 0.08;
  const panels: InstXf[] = [
    // lower bands (W, N, S with the door gap), full east wall, header band all round
    bx(B.x0, FLOOR, B.z0, B.x0 + t, SILL, B.z1),
    bx(B.x0, FLOOR, B.z0, B.x1, SILL, B.z0 + t),
    bx(DOOR.x1, FLOOR, B.z1 - t, B.x1, SILL, B.z1),
    bx(B.x0, FLOOR, B.z1 - t, DOOR.x0, HEAD, B.z1),
    bx(B.x1 - t, FLOOR, B.z0, B.x1, TOP, B.z1),
    bx(B.x0, HEAD, B.z0, B.x1, TOP, B.z0 + t),
    bx(B.x0, HEAD, B.z1 - t, B.x1, TOP, B.z1),
    bx(B.x0, HEAD, B.z0, B.x0 + t, TOP, B.z1),
  ];
  const frames: InstXf[] = [
    ...[
      [B.x0, B.z0],
      [B.x0, B.z1],
      [B.x1, B.z0],
      [B.x1, B.z1],
    ].map(([x, z]) => bx(x! - 0.05, FLOOR, z! - 0.05, x! + 0.05, TOP, z! + 0.05)),
    // window mullions
    bx(B.x0 - 0.01, SILL, 9.2 - 0.025, B.x0 + t + 0.01, HEAD, 9.2 + 0.025),
    bx(8.45 - 0.025, SILL, B.z0 - 0.01, 8.45 + 0.025, HEAD, B.z0 + t + 0.01),
    // sills
    bx(B.x0 - 0.06, SILL - 0.03, B.z0, B.x0 + 0.1, SILL, B.z1),
    bx(B.x0, SILL - 0.03, B.z0 - 0.06, B.x1, SILL, B.z0 + 0.1),
    bx(DOOR.x1, SILL - 0.03, B.z1 - 0.1, B.x1, SILL, B.z1 + 0.06),
    // door frame
    bx(DOOR.x0 - 0.04, FLOOR, B.z1 - 0.1, DOOR.x0, HEAD, B.z1 + 0.02),
    bx(DOOR.x1, FLOOR, B.z1 - 0.1, DOOR.x1 + 0.04, HEAD, B.z1 + 0.02),
  ];
  const glass: InstXf[] = [bx(B.x0 + 0.03, SILL, B.z0, B.x0 + 0.05, HEAD, B.z1), bx(B.x0, SILL, B.z0 + 0.03, B.x1, HEAD, B.z0 + 0.05), bx(DOOR.x1, SILL, B.z1 - 0.05, B.x1, HEAD, B.z1 - 0.03)];
  const fascia = useMemo(() => {
    const tex = canvasTexture('pg:boothFascia', 1024, 96, (ctx, w, h) => {
      ctx.fillStyle = '#1f3f7a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 56px ${FONT}`;
      ctx.fillText('P  PARKING OFFICE', w / 2, h / 2 + 2);
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.15 });
  }, []);
  useDisposeOnUnmount(useMemo(() => [fascia], [fascia]));
  return (
    <group>
      <mesh position={[(B.x0 + B.x1) / 2, FLOOR - 0.005, (B.z0 + B.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={floorMat()} receiveShadow>
        <planeGeometry args={[B.x1 - B.x0, B.z1 - B.z0]} />
      </mesh>
      <StaticInstances geometry={unitBox()} material={panelMat()} items={panels} />
      <StaticInstances geometry={unitBox()} material={frameMat()} items={frames} />
      <StaticInstances geometry={unitBox()} material={glassMat()} items={glass} castShadow={false} receiveShadow={false} />
      {/* roof slab with overhang + fascia sign (south and west) */}
      <mesh position={[(B.x0 + B.x1) / 2, TOP + 0.1, (B.z0 + B.z1) / 2]} material={frameMat()} castShadow receiveShadow>
        <boxGeometry args={[B.x1 - B.x0 + 0.7, 0.2, B.z1 - B.z0 + 0.7]} />
      </mesh>
      <mesh position={[(B.x0 + B.x1) / 2, TOP + 0.1, B.z1 + 0.36]} material={fascia}>
        <boxGeometry args={[B.x1 - B.x0 + 0.6, 0.18, 0.02]} />
      </mesh>
      <mesh position={[B.x0 - 0.36, TOP + 0.1, (B.z0 + B.z1) / 2]} rotation={[0, -Math.PI / 2, 0]} material={fascia}>
        <boxGeometry args={[B.z1 - B.z0 + 0.6, 0.18, 0.02]} />
      </mesh>
      {/* door leaf, ajar (hinged on its east jamb, opens outward) */}
      <group position={[DOOR.x1, FLOOR, B.z1 - 0.02]} rotation={[0, 1.25, 0]}>
        <mesh position={[-(DOOR.x1 - DOOR.x0) / 2, 0.5, 0]} material={panelMat()} castShadow>
          <boxGeometry args={[DOOR.x1 - DOOR.x0 - 0.02, 1.0, 0.04]} />
        </mesh>
        <mesh position={[-(DOOR.x1 - DOOR.x0) / 2, 1.62, 0]} material={glassMat()}>
          <boxGeometry args={[DOOR.x1 - DOOR.x0 - 0.12, 1.2, 0.02]} />
        </mesh>
        <mesh position={[-(DOOR.x1 - DOOR.x0) / 2, 1.62, 0]} material={frameMat()}>
          <boxGeometry args={[DOOR.x1 - DOOR.x0 - 0.02, 1.26, 0.025]} />
        </mesh>
        <mesh position={[-(DOOR.x1 - DOOR.x0) + 0.1, 1.05, 0.05]} material={frameMat()}>
          <boxGeometry args={[0.03, 0.03, 0.12]} />
        </mesh>
      </group>
      {/* desk along the west window, stool */}
      <StaticInstances
        geometry={unitBox()}
        material={deskMat()}
        items={[bx(B.x0 + 0.08, FLOOR + 0.72, B.z0 + 0.12, B.x0 + 0.72, FLOOR + 0.76, B.z1 - 0.12), bx(B.x0 + 0.08, FLOOR, B.z0 + 0.12, B.x0 + 0.12, FLOOR + 0.72, B.z1 - 0.12)]}
      />
      <StaticInstances
        geometry={kgeo('pg:stool', () => new THREE.CylinderGeometry(0.19, 0.22, 0.06, 16).translate(0, 0.62, 0).toNonIndexed())}
        material={frameMat()}
        items={[{ p: [8.0, FLOOR, 9.75] }]}
      />
      <StaticInstances geometry={kgeo('pg:stoolLeg', () => new THREE.CylinderGeometry(0.03, 0.03, 0.62, 8).translate(0, 0.31, 0))} material={frameMat()} items={[{ p: [8.0, FLOOR, 9.75] }]} />
      {/* monitor on the desk */}
      <mesh position={[B.x0 + 0.34, FLOOR + 0.98, 9.6]} rotation={[0, Math.PI / 2 + 0.25, 0]} material={frameMat()} castShadow>
        <boxGeometry args={[0.5, 0.3, 0.03]} />
      </mesh>
      <mesh position={[B.x0 + 0.35 + 0.018, FLOOR + 0.98, 9.6 - 0.0045]} rotation={[0, Math.PI / 2 + 0.25, 0]} material={kmat('pg:screen', () => new THREE.MeshStandardMaterial({ color: '#0d2438', emissive: '#1d5a8a', emissiveIntensity: 0.6, roughness: 0.2 }))}>
        <planeGeometry args={[0.46, 0.26]} />
      </mesh>
    </group>
  );
}

/** Gate control panel inside the booth: live rack + power + terminals + ducts + wiring (backplate coordinates). */
function ControlPanel({ runtime }: { runtime: SimRuntime }) {
  const live = useMemo(() => rackLiveFromController(runtime.controller), [runtime.controller]);
  const hardware = runtime.scene.hardware;
  const layout = useMemo(() => layoutCompactLogixRack(hardware.modules), [hardware.modules]);
  const [open, setOpen] = useState(true);
  const openRef = useRef(open);
  openRef.current = open;
  const closed = useMemo(() => () => !openRef.current, []);
  const P = BOOTH_PANEL;
  return (
    <group>
      <Enclosure
        size={P.size}
        position={[P.x, P.y, P.z]}
        rotation={[0, -Math.PI / 2, 0]}
        // opened flat against the wall (158°): the leaf stays out of the attendant's view of the panel
      doorAngle={open ? 2.75 : 0}
        onDoorToggle={() => {
          setOpen((o) => !o);
          sfx.play('click');
        }}
        nameplate={'GATE CONTROL\nGCP-1'}
        backplate="white"
      >
        <PanelRack runtime={runtime} live={live} />
        <DistanceLod distance={6} near={<PanelInterior layout={layout} />} far={<PanelImpostor />} />
      </Enclosure>
      {/* the closed door blocks clicks on the devices behind it */}
      <ClickBlocker position={[P.x - P.size[2] + 0.01, P.y + P.size[1] / 2, P.z]} size={[0.01, P.size[1] - 0.02, P.size[0] - 0.02]} getEnabled={closed} />
    </group>
  );
}

const RACK = { x: -0.08, y: -0.07 };
const TOP_DUCT_Y = 0.3;
const RISER_X = 0.225;
const PSU_X = -0.105;
const RAIL1_Y = 0.2;
const IO_RAIL_Y = -0.27;
const RED = '#c62828';
const BLUE = '#1f4fd1';
const WHT = '#e8e8e8';
const BRN = '#6b4a2b';
const GY = '#9bbf2a';

type RackLayout = ReturnType<typeof layoutCompactLogixRack>;

function PanelInterior({ layout }: { layout: RackLayout }) {
  const ioLabels = ['I0', 'I1', 'I2', 'I3', 'I4', 'I5', '0V', '0V', 'O0', 'O1', 'O2', 'O3', '0V', '0V', 'PE', 'PE'];
  const ioColors = ioLabels.map((l) => (l === '0V' ? TB_COLORS.blue : TB_COLORS.gray));
  const pwrLabels = ['L1', 'L1', 'N', 'N', '+24', '+24', '0V', '0V', 'PE'];
  const pwrColors = pwrLabels.map((l) => (l === 'N' || l === '0V' ? TB_COLORS.blue : l === '+24' ? TB_COLORS.red : TB_COLORS.gray));
  const ductWires = [BLUE, BLUE, RED, '#111111', WHT, BLUE];
  const wires = useMemo(() => buildPanelWires(layout), [layout]);
  const g = useRef<THREE.Group>(null);
  useNoCastShadow(g);
  return (
    <group ref={g}>
      {/* open ducts (covers off) so the conductors inside read */}
      <WireDuct length={0.5} position={[-0.01, TOP_DUCT_Y, 0]} width={0.04} height={0.06} wires={ductWires} cover={false} />
      <DinRail length={0.5} position={[0, RAIL1_Y, 0]}>
        <CircuitBreaker1489 poles={2} rating="C6" position={[-0.205, 0, 0]} getOn={() => true} />
        <CircuitBreaker1489 poles={1} rating="C2" position={[-0.17, 0, 0]} getOn={() => true} />
        <PowerSupply1606 position={[PSU_X, 0, 0]} width={0.04} rating="24V DC 5A 120W" catalog="1606-XLS120E" getOk={() => true} />
        <TerminalBlocks1492 count={pwrLabels.length} labels={pwrLabels} colors={pwrColors} position={[0.02, 0, 0]} />
      </DinRail>
      {layout.slots.map((s) => (
        <IoTag
          key={s.slot}
          position={[RACK.x + s.x, RACK.y + 0.075, 0.07]}
          size={[s.width, 0.15, 0.12]}
          anchor={[0, 0.085, 0.04]}
          title={`Slot ${s.slot}`}
          lines={[textLine(s.catalog, s.slot === 0 ? 'CompactLogix 5380' : s.slot === 1 ? 'DI_Gates' : 'DO_Gates', `Local:${s.slot}`)]}
        />
      ))}
      <WireDuct length={0.66} vertical position={[RISER_X, -0.01, 0]} width={0.04} height={0.06} wires={ductWires} cover={false} />
      <DinRail length={0.42} position={[-0.03, IO_RAIL_Y, 0]}>
        <TerminalBlocks1492 count={ioLabels.length} labels={ioLabels} colors={ioColors} position={[0.02, 0, 0]} />
      </DinRail>
      {wires.single.map((w, i) => (
        <Wire key={i} points={w.p} color={w.c} radius={0.0012} bendRadius={0.006} ferrules={w.f} />
      ))}
      {wires.bundles.map((b, i) => (
        <WireBundle key={`b${i}`} points={b.p} colors={b.c} radius={0.0011} bendRadius={0.02} tieSpacing={0.06} />
      ))}
    </group>
  );
}

/** Conductor routes on the backplate. */
function buildPanelWires(layout: RackLayout) {
  const single: { p: Vec3[]; c: string; f: boolean }[] = [];
  const bundles: { p: Vec3[]; c: string[] }[] = [];
  const ductBottom = TOP_DUCT_Y - 0.02;
  // PSU output (+ + − − on top) up into the top duct
  const psuTop = RAIL1_Y + 0.124 / 2 - 0.015;
  [-0.013, -0.004, 0.005, 0.014].forEach((dx, i) => {
    const x = PSU_X + dx;
    single.push({ p: [[x, psuTop, 0.1], [x, psuTop + 0.01, 0.1], [x, ductBottom - 0.004, 0.06], [x, ductBottom, 0.035]], c: i < 2 ? RED : BLUE, f: true });
  });
  // breaker outputs (top) → PSU input is at the PSU bottom: short jumpers under the rail
  const psuBot = RAIL1_Y - 0.124 / 2 + 0.015;
  const brkBot = RAIL1_Y - 0.045;
  [
    [-0.175, BRN],
    [-0.162, BLUE],
  ].forEach(([bx, c], i) => {
    const x = PSU_X - 0.008 + i * 0.01;
    single.push({ p: [[bx as number, brkBot, 0.07], [bx as number, psuBot - 0.03 - i * 0.004, 0.07], [x, psuBot - 0.03 - i * 0.004, 0.09], [x, psuBot, 0.1]], c: c as string, f: true });
  });
  // controller MOD / SA power from the top duct (5069-L320ER power column)
  const ctrl = layout.slots[0]!;
  const xPwr = RACK.x + ctrl.x - CPX_CTRL.width / 2 + CPX_CTRL.powerColumn / 2;
  const zT = 0.0075 + 0.1038;
  const top = RACK.y + CPX_CTRL.height + 0.008;
  (
    [
      [-0.005, 0.0925, RED],
      [0.005, 0.0805, BLUE],
      [-0.005, 0.0555, RED],
      [0.005, 0.0435, BLUE],
    ] as const
  ).forEach(([u, v, c], i) => {
    const x = xPwr + u;
    const y = RACK.y + v - 0.00225;
    const zf = zT + 0.012 + i * 0.004;
    single.push({ p: [[x, ductBottom, 0.035], [x, top, 0.035 + i * 0.004], [x, top, zf], [x, y + 0.004, zf], [x, y, zT + 0.001]], c, f: true });
  });
  // power terminal strip (+24 / 0V) up into the duct
  for (let i = 0; i < 4; i++) {
    const x = 0.02 - 0.02 + i * 0.0051 + 0.001;
    single.push({ p: [[x, RAIL1_Y + 0.03, 0.045], [x, RAIL1_Y + 0.04, 0.045], [x, ductBottom, 0.035]], c: i < 2 ? RED : BLUE, f: true });
  }
  // rack duct (IB16 / OB16 field wires) → riser
  const ductR = RACK.x + layout.railLength / 2 + 0.01;
  const rackDuctY = RACK.y - 0.045 - 0.02;
  bundles.push({ p: [[ductR - 0.005, rackDuctY, 0.035], [ductR + 0.04, rackDuctY, 0.04], [RISER_X - 0.022, rackDuctY, 0.035]], c: [WHT, WHT, WHT, WHT, WHT, WHT, BLUE, BLUE] });
  // riser → I/O terminal strip (top row)
  bundles.push({ p: [[RISER_X - 0.022, IO_RAIL_Y + 0.06, 0.035], [0.12, IO_RAIL_Y + 0.06, 0.04], [0.08, IO_RAIL_Y + 0.035, 0.045]], c: [WHT, WHT, WHT, WHT, WHT, WHT] });
  // I/O strip field side (bottom row) → gland plate → conduits to the gates, loops and eyes
  bundles.push({ p: [[-0.05, IO_RAIL_Y - 0.035, 0.045], [-0.05, -0.33, 0.05], [-0.05, -0.345, 0.09], [-0.05, -0.36, 0.12]], c: [WHT, WHT, WHT, WHT, BLUE, BLUE] });
  bundles.push({ p: [[0.12, IO_RAIL_Y - 0.035, 0.045], [0.12, -0.33, 0.05], [0.12, -0.345, 0.09], [0.12, -0.36, 0.12]], c: [WHT, WHT, WHT, WHT] });
  // incoming 120 V feeder: from the gland up the riser to the breaker tops
  bundles.push({ p: [[RISER_X + 0.004, -0.36, 0.12], [RISER_X + 0.004, -0.34, 0.03], [RISER_X, 0.31, 0.03], [RISER_X - 0.03, 0.335, 0.035], [-0.19, 0.335, 0.05], [-0.19, RAIL1_Y + 0.045, 0.07]], c: [BRN, BLUE, GY] });
  return { single, bundles };
}

/** The CompactLogix rack (outside the interior LOD: it has its own built-in impostor). */
function PanelRack({ runtime, live }: { runtime: SimRuntime; live: ReturnType<typeof rackLiveFromController> }) {
  const g = useRef<THREE.Group>(null);
  useNoCastShadow(g);
  return (
    <group ref={g}>
      <CompactLogixRack hardware={runtime.scene.hardware} live={live} wiring={RACK_WIRING} position={[RACK.x, RACK.y, 0]} />
    </group>
  );
}

const RACK_WIRING = { 1: [0, 1, 2, 3, 4, 5], 2: [0, 1, 2, 3] };

function PanelImpostor() {
  const light = kmat('pg:impLight', () => new THREE.MeshStandardMaterial({ color: '#c9ccce', roughness: 0.6 }));
  return (
    <group>
      <mesh geometry={unitBox()} material={light} position={[-0.12, RAIL1_Y, 0.05]} scale={[0.2, 0.12, 0.1]} />
      <mesh geometry={unitBox()} material={light} position={[0, TOP_DUCT_Y, 0.03]} scale={[0.5, 0.04, 0.06]} />
      <mesh geometry={unitBox()} material={light} position={[RISER_X, -0.01, 0.03]} scale={[0.04, 0.66, 0.06]} />
    </group>
  );
}

export function Booth({ runtime, tagGroup }: { runtime: SimRuntime; tagGroup?: TagGroup }) {
  const key = useMemo(
    () => ({
      get: () => runtime.getControl('reset_key') === true,
      press: () => {
        runtime.setControl('reset_key', true);
        sfx.play('toggle');
      },
      release: () => {
        runtime.setControl('reset_key', false);
        sfx.play('release');
      },
      momentary: {
        onPress: () => {
          runtime.setControl('reset_key', true);
          sfx.play('toggle');
        },
        onRelease: () => {
          runtime.setControl('reset_key', false);
          sfx.play('release');
        },
      },
    }),
    [runtime],
  );
  const P = BOOTH_PANEL;
  const inside = useRef<THREE.Group>(null);
  useNoCastShadow(inside);
  const t = 0.1;
  return (
    <group>
      <BoothShell />
      <group ref={inside}>
        <ControlPanel runtime={runtime} />
        {/* conduit from the panel's bottom glands down into the floor (to the gates, loops and eyes) */}
        <Conduit points={[[P.x - 0.12, P.y - 0.005, P.z - 0.12], [P.x - 0.12, FLOOR + 0.02, P.z - 0.12]]} radius={0.014} />
        <Conduit points={[[P.x - 0.12, P.y - 0.005, P.z + 0.02], [P.x - 0.12, FLOOR + 0.02, P.z + 0.02]]} radius={0.014} />
        {/* desk console with the key switch, face tilted up toward the attendant */}
        <group position={[BOOTH_KEY.x, BOOTH_KEY.y, BOOTH_KEY.z]} rotation={[0, Math.PI / 2, 0]}>
          <mesh position={[0, 0.04, -0.01]} material={frameMat()}>
            <boxGeometry args={[0.16, 0.08, 0.12]} />
          </mesh>
          <group position={[0, 0.085, 0]} rotation={[-0.9, 0, 0]}>
            <mesh position={[0, 0, -0.004]} material={kmat('pg:consoleFace', () => new THREE.MeshStandardMaterial({ color: '#3b4148', roughness: 0.6, metalness: 0.3 }))}>
              <boxGeometry args={[0.15, 0.13, 0.008]} />
            </mesh>
            <IoTag
              position={[0, -0.01, 0]}
              size={[0.06, 0.08, 0.06]}
              center={[0, 0.008, 0.02]}
              anchor={[0, 0.06, 0.05]}
              title="Attendant COUNT RESET key (spring return) — loads Count_Adjust in the reference program"
              lines={[ioLine(runtime, 'Reset_Key')]}
              group={tagGroup}
              momentary={key.momentary}
            >
              <KeySwitch800F legend={['COUNT RESET']} positions={['RUN', 'RESET']} getOn={key.get} scale={1.3} />
            </IoTag>
          </group>
        </group>
      </group>
      {/* the attendant, turning to the key when it is used */}
      <Pedestrian variant={5} position={[8.1, FLOOR, 8.75]} rotation={[0, Math.PI - 0.2, 0]} getWalking={() => false} getReach={() => (key.get() ? 1 : 0)} />
      {/* click blockers: roof, east / west / north walls (incl. their glass), the solid parts of the south wall.
          Only the open door and the south service window (the attendant's pass-through) let a click in. */}
      <ClickBlocker position={[(B.x0 + B.x1) / 2, TOP + 0.1, (B.z0 + B.z1) / 2]} size={[B.x1 - B.x0 + 0.7, 0.24, B.z1 - B.z0 + 0.7]} />
      <ClickBlocker position={[B.x1 - t / 2, (FLOOR + TOP) / 2, (B.z0 + B.z1) / 2]} size={[t, TOP - FLOOR, B.z1 - B.z0]} />
      <ClickBlocker position={[B.x0 + t / 2, (FLOOR + TOP) / 2, (B.z0 + B.z1) / 2]} size={[t, TOP - FLOOR, B.z1 - B.z0]} />
      <ClickBlocker position={[(B.x0 + B.x1) / 2, (FLOOR + TOP) / 2, B.z0 + t / 2]} size={[B.x1 - B.x0, TOP - FLOOR, t]} />
      <ClickBlocker position={[(DOOR.x1 + B.x1) / 2, (FLOOR + SILL) / 2, B.z1 - t / 2]} size={[B.x1 - DOOR.x1, SILL - FLOOR, t]} />
      <ClickBlocker position={[(DOOR.x0 + B.x1) / 2, (HEAD + TOP) / 2, B.z1 - t / 2]} size={[B.x1 - DOOR.x0, TOP - HEAD, t]} />
      <ClickBlocker position={[(B.x0 + DOOR.x0) / 2, (FLOOR + TOP) / 2, B.z1 - t / 2]} size={[DOOR.x0 - B.x0, TOP - FLOOR, t]} />
    </group>
  );
}
