/**
 * Gallery previews for panel / cabinet components (demo getters keep things alive).
 */
import { useMemo, useRef, useState } from 'react';
import type { Preview } from '../../../dev/gallery';
import type { Vec3 } from '../../contracts';
import { Label } from '../../common';
import { EStop800FM } from '../operator/EStop800FM';
import { PilotLight800F } from '../operator/PilotLight800F';
import { PushButton800F } from '../operator/PushButton800F';
import { SelectorSwitch800F } from '../operator/SelectorSwitch800F';
import { StackLight856T } from '../operator/StackLight856T';
import { CircuitBreaker1489 } from './CircuitBreaker1489';
import { C100 } from './Contactor100C';
import { DIN, DinRail } from './DinRail';
import { DOOR_SHEET, Enclosure, backplateFinish } from './Enclosure';
import { MotorStarter } from './MotorStarter';
import { PSU, PowerSupply1606 } from './PowerSupply1606';
import { J3, TB_COLORS, TerminalBlocks1492, terminalX } from './TerminalBlocks1492';
import { WireBundle, Wires } from './Wire';
import { WireDuct } from './WireDuct';
import { F, boxGeo, partsGeo, uberMat } from '../operator/shared';
import { MCB } from './CircuitBreaker1489';

const now = () => performance.now() / 1000;

function useVal<T>(initial: T) {
  const r = useRef(initial);
  return useMemo(() => ({ get: () => r.current, set: (v: T) => void (r.current = v) }), []);
}

// ---------------------------------------------------------------------------
// Cabinet layout (backplate coordinates)
// ---------------------------------------------------------------------------

const RAIL1_Y = 0.3;
const RAIL2_Y = -0.262;
const DUCT_W = 0.04;
const DUCT_H = 0.06;
const TOP_DUCT_Y = 0.425;
const MID_DUCT_Y = 0.175;
const LOW_DUCT_Y = -0.152;
const BOT_DUCT_Y = -0.425;
const SIDE_DUCT_X = 0.345;
const PLC_ZONE = { x: 0, y: 0.012, w: 0.6, h: 0.23 };

/** Dashed rectangle + label marking the reserved PLC rack area (dashes + studs = one merged mesh). */
function PlcZone() {
  const { x, y, w, h } = PLC_ZONE;
  const geo = partsGeo(`plc-zone:${x}:${y}:${w}:${h}`, (b) => {
    const dash = 0.02;
    const gap = 0.012;
    const yellow = F.matte('#f5c400', 0.6);
    for (let t = -w / 2; t < w / 2; t += dash + gap) {
      const l = Math.min(dash, w / 2 - t);
      b.add(boxGeo(l, 0.003, 0.0006), yellow, [x + t + l / 2, y + h / 2, 0.0003]);
      b.add(boxGeo(l, 0.003, 0.0006), yellow, [x + t + l / 2, y - h / 2, 0.0003]);
    }
    for (let t = -h / 2; t < h / 2; t += dash + gap) {
      const l = Math.min(dash, h / 2 - t);
      b.add(boxGeo(0.003, l, 0.0006), yellow, [x - w / 2, y + t + l / 2, 0.0003]);
      b.add(boxGeo(0.003, l, 0.0006), yellow, [x + w / 2, y + t + l / 2, 0.0003]);
    }
    // chassis mounting studs
    for (const [sx, sy] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ] as [number, number][])
      b.add(boxGeo(0.008, 0.008, 0.006), F.metal('#c9cdd0', 0.35), [x + sx * 0.184, y + sy * 0.07, 0.003]);
  });
  return (
    <group>
      <mesh geometry={geo} material={uberMat()} receiveShadow />
      <Label
        lines={['RESERVED — PLC RACK', '1756-A7 chassis mounts here']}
        size={[0.26, 0.05]}
        width={1024}
        height={196}
        color="#b08a00"
        fontWeight={700}
        position={[x, y, 0.0008]}
      />
    </group>
  );
}

/** Comb busbar (insulated, pin type) across the line side of the 1-pole breakers. */
function Busbar({ x0, x1, y, z }: { x0: number; x1: number; y: number; z: number }) {
  const geo = partsGeo(`busbar:${x0}:${x1}:${y}:${z}`, (b) => {
    b.add(boxGeo(x1 - x0 + 0.008, 0.006, 0.004), F.matte('#6b6e70', 0.55), [(x0 + x1) / 2, y + 0.006, z]);
    for (let x = x0; x <= x1 + 1e-6; x += MCB.pole) b.add(boxGeo(0.003, 0.008, 0.0016), F.metal('#c28a4e', 0.35), [x, y, z - 0.002]);
  });
  return <mesh geometry={geo} material={uberMat()} castShadow />;
}

/** Door hinge axis in BACKPLATE coordinates (0.8 × 1.0 × 0.3 cabinet): x = −W/2 − 4 mm, z = Db − plate stack. */
const HINGE_X = -0.404;
const HINGE_Z = 0.3 - 0.021 - (0.012 + 0.0015 + 0.003);
/** The same axis in DOOR-local coordinates (x = −(W/2 + 4 mm), z = −DOOR_D). */
const DOOR_HINGE: [number, number] = [-0.404, -0.021];
const LOOP_Y = -0.25;

function CabinetInterior() {
  const k1 = () => now() % 5 < 3.2;
  // wire entry height of the MCB / contactor box clamps above the backplate
  const zEntry = DIN.height + 0.03;
  const cbx = [-0.27, -0.236, -0.2185, -0.201, -0.1835];
  const tb1 = { count: 14, x: 0.04 };
  const tb2 = { count: 22, x: 0.13 };
  const tb1Colors = Array.from({ length: tb1.count }, (_, i) => (i < 6 ? TB_COLORS.gray : i < 11 ? TB_COLORS.blue : TB_COLORS.green));
  const tb2Colors = Array.from({ length: tb2.count }, (_, i) => (i >= 18 ? TB_COLORS.blue : TB_COLORS.gray));
  const tb2Labels = Array.from({ length: tb2.count }, (_, i) => (i >= 20 ? 'PE' : String(i + 1)));
  const wireColors = ['#1f4fd1', '#1f4fd1', '#c62828', '#111111', '#eeeeee', '#1f4fd1', '#c62828', '#1f4fd1'];
  const psuX = -0.12;
  const psuTop = RAIL1_Y + PSU.h / 2 - PSU.recess / 2 + 0.002 + 0.0111; // output wire entries (top)
  const psuBot = RAIL1_Y - PSU.h / 2 + PSU.recess / 2 - 0.002 - 0.0111; // input wire entries (bottom)
  const psuZ = DIN.height + (PSU.d - PSU.frontDepth) + 0.0078;
  const wiring = useMemo(() => {
    const out: { points: Vec3[]; color: string; radius?: number }[] = [];
    const tbZ = DIN.height + 0.0115;
    // main 2-pole breaker: incoming L1 / N from the top duct into its line side
    for (const [dx, c] of [
      [-MCB.pole / 2, '#111111'],
      [MCB.pole / 2, '#eeeeee'],
    ] as [number, string][])
      out.push({ color: c, radius: 0.0013, points: [[cbx[0]! + dx, RAIL1_Y + MCB.height / 2, zEntry], [cbx[0]! + dx, RAIL1_Y + MCB.height / 2 + 0.02, zEntry], [cbx[0]! + dx, TOP_DUCT_Y - DUCT_W / 2 - 0.002, 0.03], [cbx[0]! + dx, TOP_DUCT_Y, 0.03]] });
    // branch breakers: line side fed by the comb busbar; busbar feed from the main breaker load side
    out.push({
      color: '#111111',
      radius: 0.0013,
      points: [
        [cbx[0]! - MCB.pole / 2, RAIL1_Y - MCB.height / 2, zEntry],
        [cbx[0]! - MCB.pole / 2, RAIL1_Y - MCB.height / 2 - 0.018, zEntry],
        [cbx[0]! - MCB.pole / 2 - 0.016, RAIL1_Y - MCB.height / 2 - 0.018, zEntry + 0.012],
        [cbx[0]! - MCB.pole / 2 - 0.016, RAIL1_Y + MCB.height / 2 + 0.016, zEntry + 0.012],
        [cbx[1]! - 0.004, RAIL1_Y + MCB.height / 2 + 0.016, zEntry + 0.012],
        [cbx[1]! - 0.004, RAIL1_Y + MCB.height / 2 + 0.009, DIN.height + MCB.shoulder + 0.004],
      ],
    });
    // branch breaker load side down into the middle duct
    cbx.slice(1).forEach((x, i) =>
      out.push({
        color: i < 2 ? '#111111' : '#c62828',
        points: [
          [x, RAIL1_Y - MCB.height / 2, zEntry],
          [x, RAIL1_Y - MCB.height / 2 - 0.025, zEntry],
          [x + 0.004, MID_DUCT_Y + DUCT_W / 2 + 0.002, 0.03],
          [x + 0.004, MID_DUCT_Y, 0.03],
        ],
      }),
    );
    // 1606 input (bottom terminals N / L / PE) from the middle duct
    [-0.0102, 0, 0.0102].forEach((dx, i) =>
      out.push({ color: ['#eeeeee', '#111111', '#3f9a3a'][i]!, radius: 0.0011, points: [[psuX + dx, psuBot, psuZ], [psuX + dx, psuBot - 0.015, psuZ], [psuX + dx, MID_DUCT_Y + DUCT_W / 2 + 0.002, 0.035], [psuX + dx, MID_DUCT_Y, 0.03]] }),
    );
    // distribution terminals: up into the top duct, down into the middle duct
    for (let i = 0; i < tb1.count; i++) {
      const x = tb1.x + terminalX(i, tb1.count);
      const color = i < 3 ? '#111111' : i < 6 ? '#eeeeee' : i < 11 ? '#1f4fd1' : '#3f9a3a';
      out.push({ color, radius: 0.0009, points: [[x, RAIL1_Y + J3.length / 2, tbZ], [x, RAIL1_Y + J3.length / 2 + 0.02, tbZ], [x, TOP_DUCT_Y - DUCT_W / 2 - 0.002, 0.03], [x, TOP_DUCT_Y, 0.03]] });
      out.push({ color, radius: 0.0009, points: [[x, RAIL1_Y - J3.length / 2, tbZ], [x, RAIL1_Y - J3.length / 2 - 0.02, tbZ], [x, MID_DUCT_Y + DUCT_W / 2 + 0.002, 0.03], [x, MID_DUCT_Y, 0.03]] });
    }
    // starters: line side up, load side down
    for (const sx of [-0.255, -0.195])
      for (const dx of [-0.012, 0, 0.012]) {
        out.push({ color: '#111111', radius: 0.0013, points: [[sx + dx, RAIL2_Y + C100.h / 2, DIN.height + 0.047], [sx + dx, RAIL2_Y + C100.h / 2 + 0.02, DIN.height + 0.047], [sx + dx, LOW_DUCT_Y - DUCT_W / 2 - 0.002, 0.03], [sx + dx, LOW_DUCT_Y, 0.03]] });
        out.push({ color: '#111111', radius: 0.0013, points: [[sx + dx, RAIL2_Y - C100.h / 2 - 0.068, DIN.height + 0.047], [sx + dx, RAIL2_Y - C100.h / 2 - 0.085, DIN.height + 0.047], [sx + dx, BOT_DUCT_Y + DUCT_W / 2 + 0.002, 0.03], [sx + dx, BOT_DUCT_Y, 0.03]] });
      }
    // coil A1 (top-left) and aux 13 (top-right) up; A2 (bottom-left) down (red = 120 VAC control)
    for (const sx of [-0.255, -0.195]) {
      for (const dx of [-0.0195, 0.0195])
        out.push({ color: '#c62828', radius: 0.0009, points: [[sx + dx, RAIL2_Y + C100.h / 2, DIN.height + 0.047], [sx + dx, RAIL2_Y + C100.h / 2 + 0.018, DIN.height + 0.047], [sx + dx * 0.6, LOW_DUCT_Y - DUCT_W / 2 - 0.002, 0.03], [sx + dx * 0.6, LOW_DUCT_Y, 0.03]] });
      out.push({ color: '#eeeeee', radius: 0.0009, points: [[sx - 0.0195, RAIL2_Y - C100.h / 2, DIN.height + 0.047], [sx - 0.0195, RAIL2_Y - C100.h / 2 - 0.012, DIN.height + 0.047], [sx - 0.03, RAIL2_Y - C100.h / 2 - 0.02, DIN.height + 0.04], [sx - 0.03, BOT_DUCT_Y + DUCT_W / 2 + 0.002, 0.03], [sx - 0.03, BOT_DUCT_Y, 0.03]] });
    }
    // field terminals
    for (let i = 0; i < tb2.count; i++) {
      const x = tb2.x + terminalX(i, tb2.count);
      const color = i >= 20 ? '#3f9a3a' : i >= 18 ? '#1f4fd1' : i % 3 === 0 ? '#eeeeee' : '#1f4fd1';
      out.push({ color, radius: 0.0009, points: [[x, RAIL2_Y + J3.length / 2, tbZ], [x, RAIL2_Y + J3.length / 2 + 0.02, tbZ], [x, LOW_DUCT_Y - DUCT_W / 2 - 0.002, 0.03], [x, LOW_DUCT_Y, 0.03]] });
      out.push({ color, radius: 0.0009, points: [[x, RAIL2_Y - J3.length / 2, tbZ], [x, RAIL2_Y - J3.length / 2 - 0.02, tbZ], [x, BOT_DUCT_Y + DUCT_W / 2 + 0.002, 0.03], [x, BOT_DUCT_Y, 0.03]] });
    }
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {/* ducts */}
      <WireDuct length={0.73} position={[0, TOP_DUCT_Y, 0]} width={DUCT_W} height={DUCT_H} wires={wireColors} />
      <WireDuct length={0.65} position={[0, MID_DUCT_Y, 0]} width={DUCT_W} height={DUCT_H} wires={wireColors} />
      <WireDuct length={0.65} position={[0, LOW_DUCT_Y, 0]} width={DUCT_W} height={DUCT_H} wires={wireColors} />
      <WireDuct length={0.73} position={[0, BOT_DUCT_Y, 0]} width={DUCT_W} height={DUCT_H} wires={wireColors} />
      <WireDuct length={0.81} vertical position={[-SIDE_DUCT_X, 0, 0]} width={DUCT_W} height={DUCT_H} />
      <WireDuct length={0.81} vertical position={[SIDE_DUCT_X, 0, 0]} width={DUCT_W} height={DUCT_H} cover={false} wires={['#1f4fd1', '#1f4fd1', '#c62828', '#1f4fd1', '#111111']} />

      {/* rail 1: breakers, 24 V supply, distribution terminals */}
      <DinRail length={0.64} position={[0, RAIL1_Y, 0]}>
        <CircuitBreaker1489 poles={2} rating="C16" position={[cbx[0]!, 0, 0]} />
        {cbx.slice(1).map((x, i) => (
          <CircuitBreaker1489 key={x} poles={1} rating={['C6', 'C4', 'C2', 'C2'][i]} position={[x, 0, 0]} getOn={() => i !== 3} />
        ))}
        <PowerSupply1606 position={[psuX, 0, 0]} getOk={() => true} />
        <TerminalBlocks1492 count={tb1.count} colors={tb1Colors} labels={['L1', 'L1', 'L1', 'N', 'N', 'N', '+24', '+24', '+24', '+24', '+24', 'PE', 'PE', 'PE']} position={[tb1.x, 0, 0]} />
      </DinRail>
      <Busbar x0={cbx[1]!} x1={cbx[4]!} y={RAIL1_Y + MCB.height / 2 - 0.0105} z={DIN.height + MCB.shoulder + 0.003} />

      {/* reserved PLC area */}
      <PlcZone />

      {/* rail 2: motor starters + field terminals */}
      <DinRail length={0.64} position={[0, RAIL2_Y, 0]}>
        <MotorStarter position={[-0.255, 0, 0]} getEnergized={k1} getTripped={() => false} contactorCatalog="100-C09" />
        <MotorStarter position={[-0.195, 0, 0]} getEnergized={() => false} getTripped={() => false} contactorCatalog="100-C09" />
        <TerminalBlocks1492 count={tb2.count} colors={tb2Colors} labels={tb2Labels} position={[tb2.x, 0, 0]} />
      </DinRail>

      {/* 1606 DC output (top terminals + + − −) up into the top duct */}
      <WireBundle
        colors={['#1f4fd1', '#1f4fd1', '#eeeeee', '#eeeeee']}
        points={[
          [psuX - 0.01, psuTop, psuZ],
          [psuX - 0.01, psuTop + 0.012, psuZ],
          [psuX - 0.01, TOP_DUCT_Y - DUCT_W / 2 - 0.004, 0.04],
          [psuX - 0.01, TOP_DUCT_Y, 0.03],
        ]}
        tieSpacing={0.03}
      />
      {/* door harness: cabinet side of the hinge loop (meets the door side ON the hinge axis) */}
      <WireBundle
        colors={['#c62828', '#c62828', '#1f4fd1', '#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1', '#c62828']}
        points={[
          [HINGE_X, LOOP_Y, HINGE_Z],
          [HINGE_X + 0.02, LOOP_Y - 0.03, HINGE_Z - 0.03],
          [-0.3, LOOP_Y - 0.06, 0.11],
          [-SIDE_DUCT_X + DUCT_W / 2 + 0.01, LOOP_Y - 0.08, 0.035],
          [-SIDE_DUCT_X, LOOP_Y - 0.08, 0.03],
        ]}
        bendRadius={0.03}
        tieSpacing={0.05}
      />
      {/* all single conductors in one draw call */}
      <Wires wires={wiring} />
    </group>
  );
}

/** Door devices + harness (door-local coordinates). */
function DoorDevices() {
  const run = () => now() % 5 < 3.2;
  const pt = DOOR_SHEET;
  // contact-block terminals: top clamp at y + 16 mm; wires run behind the block backs (z ≤ −0.050)
  const zBack = -0.052;
  const zClamp = -pt - 0.0115 - 0.0335 + 0.006;
  const trunkY = 0.155;
  const devs: { x: number; y: number; dx: number[]; color: string }[] = [
    { x: -0.15, y: 0.2, dx: [0], color: '#c62828' },
    { x: -0.09, y: 0.2, dx: [0], color: '#c62828' },
    { x: -0.03, y: 0.2, dx: [0], color: '#c62828' },
    { x: 0.03, y: 0.2, dx: [-0.0118, 0.0118], color: '#1f4fd1' },
    { x: -0.15, y: 0.11, dx: [0], color: '#1f4fd1' },
    { x: -0.09, y: 0.11, dx: [0], color: '#1f4fd1' },
    { x: -0.03, y: 0.11, dx: [0], color: '#1f4fd1' },
    { x: 0.1, y: 0.14, dx: [-0.0118, 0.0118], color: '#c62828' },
  ];
  const wires = devs.flatMap((d) =>
    d.dx.map((dx) => {
      const x = d.x + dx;
      const top = d.y + 0.016;
      const toTrunk: Vec3[] = d.y > trunkY ? [[x, top + 0.006, zBack], [x, trunkY + 0.012, zBack], [x, trunkY, zBack - 0.004]] : [[x, top + 0.006, zBack], [x, trunkY - 0.012, zBack], [x, trunkY, zBack - 0.004]];
      return { color: d.color, radius: 0.0008, points: [[x, top, zClamp], [x, top + 0.006, zClamp], ...toTrunk] as Vec3[] };
    }),
  );
  return (
    <group>
      <PilotLight800F position={[-0.15, 0.2, 0]} color="white" legend="POWER" getLit={() => true} panelThickness={pt} />
      <PilotLight800F position={[-0.09, 0.2, 0]} color="green" legend="RUN" getLit={run} panelThickness={pt} />
      <PilotLight800F position={[-0.03, 0.2, 0]} color="red" legend="FAULT" getLit={() => false} panelThickness={pt} />
      <SelectorSwitch800F position={[0.03, 0.2, 0]} positions={['HAND', 'OFF', 'AUTO']} getPosition={() => 2} panelThickness={pt} />
      <PushButton800F position={[-0.15, 0.11, 0]} color="green" legend="START" getPressed={() => false} panelThickness={pt} />
      <PushButton800F position={[-0.09, 0.11, 0]} color="red" style="extended" legend="STOP" contact="N.C." getPressed={() => false} panelThickness={pt} />
      <PushButton800F position={[-0.03, 0.11, 0]} color="black" legend="JOG" getPressed={() => false} panelThickness={pt} />
      <EStop800FM position={[0.1, 0.14, 0]} getEngaged={() => false} panelThickness={pt} />
      <Wires wires={wires} />
      {/* trunk along the door, down the hinge side, loop to the hinge axis */}
      <WireBundle
        colors={['#c62828', '#c62828', '#1f4fd1', '#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1', '#c62828']}
        points={[
          [0.12, trunkY, zBack - 0.004],
          [-0.33, trunkY, zBack - 0.004],
          [-0.33, LOOP_Y + 0.04, zBack - 0.004],
          [-0.37, LOOP_Y + 0.01, -0.035],
          [DOOR_HINGE[0], LOOP_Y, DOOR_HINGE[1]],
        ]}
        bendRadius={0.03}
        tieSpacing={0.07}
      />
    </group>
  );
}

function CabinetDoorOpen() {
  const [open, setOpen] = useState(true);
  return (
    <group>
      <Enclosure
        size={[0.8, 1.0, 0.3]}
        doorAngle={open ? 1.95 : 0}
        nameplate={'MCP-101\nMOTOR CONTROL PANEL'}
        doorChildren={<DoorDevices />}
        onDoorToggle={() => setOpen((o) => !o)}
      >
        <CabinetInterior />
      </Enclosure>
      <StackLight856T position={[0.26, 1.0, 0.1]} tiers={['red', 'amber', 'green']} getTier={(i) => i === 2 && now() % 5 < 3.2} mount="base" />
    </group>
  );
}

// ---------------------------------------------------------------------------

/** Plain galvanized mounting plate (no spangle), one merged mesh. */
function Plate({ w, h }: { w: number; h: number }) {
  return <mesh geometry={partsGeo(`bench-plate:${w}:${h}`, (b) => b.add(boxGeo(w, h, 0.003), backplateFinish('galvanized'), [0, 0, -0.0015]))} material={uberMat()} receiveShadow />;
}

function StarterBench({ tripped, energized }: { tripped: () => boolean; energized: () => boolean }) {
  const reset = useVal(false);
  return (
    <group>
      <Plate w={0.34} h={0.24} />
      <DinRail length={0.3} position={[0, 0.03, 0]}>
        <MotorStarter position={[-0.07, 0, 0]} getEnergized={energized} getTripped={() => tripped() && !reset.get()} onReset={() => reset.set(true)} />
        <MotorStarter position={[0.0, 0, 0]} getEnergized={() => false} getTripped={() => false} overloadVariant="E100-Advanced" />
        <CircuitBreaker1489 poles={3} rating="C10" position={[0.075, 0, 0]} />
      </DinRail>
    </group>
  );
}

function ContactorEnergized() {
  // energized most of the time, drops out briefly every 4 s to show the armature movement
  return <StarterBench energized={() => now() % 4 < 3.4} tripped={() => false} />;
}

function OverloadTripped() {
  return <StarterBench energized={() => false} tripped={() => true} />;
}

function DinComponents() {
  const on = useVal(true);
  return (
    <group>
      <Plate w={0.5} h={0.36} />
      <WireDuct length={0.48} position={[0, 0.15, 0]} wires={['#1f4fd1', '#c62828', '#111111']} />
      <DinRail length={0.46} position={[0, 0.03, 0]}>
        <CircuitBreaker1489 poles={1} rating="C2" position={[-0.2, 0, 0]} getOn={on.get} onToggle={() => on.set(!on.get())} />
        <CircuitBreaker1489 poles={2} rating="C10" position={[-0.17, 0, 0]} />
        <CircuitBreaker1489 poles={3} rating="C16" position={[-0.12, 0, 0]} />
        <PowerSupply1606 position={[-0.045, 0, 0]} getOverload={() => now() % 6 > 4.5} />
        <PowerSupply1606 position={[0.015, 0, 0]} width={0.04} catalog="1606-XLS120E" rating="24V DC 5A 120W" />
        <TerminalBlocks1492
          count={16}
          position={[0.13, 0, 0]}
          colors={Array.from({ length: 16 }, (_, i) => (i > 8 ? TB_COLORS.blue : TB_COLORS.gray))}
          labels={Array.from({ length: 16 }, (_, i) => (i > 12 ? 'PE' : String(i + 1)))}
        />
      </DinRail>
      <WireDuct length={0.48} position={[0, -0.12, 0]} cover={false} wires={['#1f4fd1', '#1f4fd1', '#c62828', '#111111', '#eeeeee']} />
    </group>
  );
}

export const previews: Record<string, Preview> = {
  PANEL_Cabinet_DoorOpen: {
    Component: CabinetDoorOpen,
    camera: { position: [0.55, 0.85, 1.75], target: [-0.05, 0.5, 0.12] },
    description: 'RAL 7035 cabinet (white subpanel), door open: 1489 breakers + busbar, 1606 PSU, 1492 terminals, 100-C + E100 starters, ducts, wiring, reserved PLC zone',
  },
  PANEL_Contactor_Energized: {
    Component: ContactorEnergized,
    camera: { position: [0.06, 0.06, 0.32], target: [-0.03, -0.02, 0.05] },
    description: '100-C09 + E100 (193-1EE / 193-1EF) starters: left energized (armature pulled in, "I"), right de-energized',
  },
  PANEL_Overload_Tripped: {
    Component: OverloadTripped,
    camera: { position: [0.02, -0.02, 0.26], target: [-0.035, -0.06, 0.06] },
    description: 'E100 overload tripped (orange flag, TRIP/RESET popped out; click it) next to a healthy E100 Advanced',
  },
  PANEL_DinRail_Components: {
    Component: DinComponents,
    camera: { position: [0.12, 0.12, 0.55], target: [0, 0.02, 0.04] },
    description: 'DIN rail: 1489-M 1/2/3-pole breakers, 1606-XLS supplies (output top), 1492-J3 terminals incl. PE, wire ducts',
  },
};
