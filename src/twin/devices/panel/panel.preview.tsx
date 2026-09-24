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
import { StackLight855T } from '../operator/StackLight855T';
import { CircuitBreaker1489 } from './CircuitBreaker1489';
import { C100 } from './Contactor100C';
import { DIN, DinRail } from './DinRail';
import { Enclosure } from './Enclosure';
import { MotorStarter } from './MotorStarter';
import { PowerSupply1606 } from './PowerSupply1606';
import { J3, TB_COLORS, TerminalBlocks1492, terminalX } from './TerminalBlocks1492';
import { WireBundle, Wires } from './Wire';
import { WireDuct } from './WireDuct';
import { boxGeo, mats } from '../operator/shared';

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

/** Dashed rectangle + label marking the reserved PLC rack area. */
function PlcZone() {
  const { x, y, w, h } = PLC_ZONE;
  const dash = 0.02;
  const gap = 0.012;
  const segs: { p: Vec3; s: [number, number] }[] = [];
  for (let t = -w / 2; t < w / 2; t += dash + gap) {
    const l = Math.min(dash, w / 2 - t);
    segs.push({ p: [x + t + l / 2, y + h / 2, 0.0003], s: [l, 0.003] });
    segs.push({ p: [x + t + l / 2, y - h / 2, 0.0003], s: [l, 0.003] });
  }
  for (let t = -h / 2; t < h / 2; t += dash + gap) {
    const l = Math.min(dash, h / 2 - t);
    segs.push({ p: [x - w / 2, y + t + l / 2, 0.0003], s: [0.003, l] });
    segs.push({ p: [x + w / 2, y + t + l / 2, 0.0003], s: [0.003, l] });
  }
  const mat = mats.matte('#f5c400', 0.6);
  return (
    <group>
      {segs.map((sg, i) => (
        <mesh key={i} geometry={boxGeo(sg.s[0], sg.s[1], 0.0006)} material={mat} position={sg.p} />
      ))}
      <Label
        lines={['RESERVED — PLC RACK', '1756-A7 chassis mounts here']}
        size={[0.26, 0.05]}
        width={1024}
        height={196}
        color="#f5c400"
        fontWeight={700}
        position={[x, y, 0.0008]}
      />
      {/* chassis mounting studs */}
      {[
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ].map(([sx, sy], i) => (
        <mesh key={i} geometry={boxGeo(0.008, 0.008, 0.006)} material={mats.metal('#c9cdd0', 0.35)} position={[x + sx! * 0.184, y + sy! * 0.07, 0.003]} />
      ))}
    </group>
  );
}

function CabinetInterior() {
  const k1 = () => now() % 5 < 3.2;
  const zEntry = DIN.height + 0.022;
  const cbx = [-0.27, -0.236, -0.2185, -0.201, -0.1835];
  const tb1 = { count: 14, x: 0.04 };
  const tb2 = { count: 22, x: 0.13 };
  const tb1Colors = Array.from({ length: tb1.count }, (_, i) => (i < 6 ? TB_COLORS.gray : i < 11 ? TB_COLORS.blue : TB_COLORS.green));
  const tb2Colors = Array.from({ length: tb2.count }, (_, i) => (i >= 18 ? TB_COLORS.blue : TB_COLORS.gray));
  const wireColors = ['#1f4fd1', '#1f4fd1', '#c62828', '#111111', '#eeeeee', '#1f4fd1', '#c62828', '#1f4fd1'];
  const wiring = useMemo(() => {
    const out: { points: Vec3[]; color: string; radius?: number }[] = [];
    const tbZ = DIN.height + 0.0115;
    // breaker outputs down into the middle duct
    cbx.slice(1).forEach((x, i) =>
      out.push({
        color: i < 2 ? '#111111' : '#c62828',
        points: [
          [x, RAIL1_Y - 0.045, zEntry],
          [x, RAIL1_Y - 0.075, zEntry],
          [x + 0.004, MID_DUCT_Y + DUCT_W / 2 + 0.002, 0.03],
          [x + 0.004, MID_DUCT_Y, 0.03],
        ],
      }),
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
    // coil wires A1/A2 (red = 120 VAC control)
    for (const sx of [-0.255, -0.195])
      for (const dx of [-0.0195, 0.0195])
        out.push({ color: '#c62828', radius: 0.0009, points: [[sx + dx, RAIL2_Y + C100.h / 2, DIN.height + 0.047], [sx + dx, RAIL2_Y + C100.h / 2 + 0.018, DIN.height + 0.047], [sx + dx * 0.6, LOW_DUCT_Y - DUCT_W / 2 - 0.002, 0.03], [sx + dx * 0.6, LOW_DUCT_Y, 0.03]] });
    // field terminals
    for (let i = 0; i < tb2.count; i++) {
      const x = tb2.x + terminalX(i, tb2.count);
      const color = i >= 18 ? '#1f4fd1' : i % 3 === 0 ? '#eeeeee' : '#1f4fd1';
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
        <PowerSupply1606 position={[-0.12, 0, 0]} getOk={() => true} />
        <TerminalBlocks1492 count={tb1.count} colors={tb1Colors} labels={['L1', 'L1', 'L1', 'N', 'N', 'N', '+24', '+24', '+24', '+24', '+24', 'PE', 'PE', 'PE']} position={[tb1.x, 0, 0]} />
      </DinRail>

      {/* reserved PLC area */}
      <PlcZone />

      {/* rail 2: motor starters + field terminals */}
      <DinRail length={0.64} position={[0, RAIL2_Y, 0]}>
        <MotorStarter position={[-0.255, 0, 0]} getEnergized={k1} getTripped={() => false} contactorCatalog="100-C09" />
        <MotorStarter position={[-0.195, 0, 0]} getEnergized={() => false} getTripped={() => false} contactorCatalog="100-C09" />
        <TerminalBlocks1492 count={tb2.count} colors={tb2Colors} position={[tb2.x, 0, 0]} />
      </DinRail>

      {/* PSU output bundle */}
      <WireBundle
        colors={['#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1']}
        points={[
          [-0.12, RAIL1_Y - 0.062, 0.09],
          [-0.12, RAIL1_Y - 0.085, 0.07],
          [-0.12, MID_DUCT_Y + DUCT_W / 2 + 0.004, 0.035],
          [-0.12, MID_DUCT_Y, 0.03],
        ]}
        tieSpacing={0.05}
      />
      {/* all single conductors in one draw call */}
      <Wires wires={wiring} />
    </group>
  );
}

function DoorDevices() {
  const run = () => now() % 5 < 3.2;
  return (
    <group position={[0, 0.02, 0]}>
      <PilotLight800F position={[-0.15, 0.18, 0]} color="white" legend="POWER" getLit={() => true} panelThickness={0.0015} />
      <PilotLight800F position={[-0.09, 0.18, 0]} color="green" legend="RUN" getLit={run} panelThickness={0.0015} />
      <PilotLight800F position={[-0.03, 0.18, 0]} color="red" legend="FAULT" getLit={() => false} panelThickness={0.0015} />
      <SelectorSwitch800F position={[0.03, 0.18, 0]} positions={['HAND', 'OFF', 'AUTO']} getPosition={() => 2} panelThickness={0.0015} />
      <PushButton800F position={[-0.15, 0.09, 0]} color="green" legend="START" getPressed={() => false} panelThickness={0.0015} />
      <PushButton800F position={[-0.09, 0.09, 0]} color="red" style="extended" legend="STOP" contact="N.C." getPressed={() => false} panelThickness={0.0015} />
      <PushButton800F position={[-0.03, 0.09, 0]} color="black" legend="JOG" getPressed={() => false} panelThickness={0.0015} />
      <EStop800FM position={[0.1, 0.12, 0]} getEngaged={() => false} panelThickness={0.0015} />
      {/* door harness: each device's contact block wired to a trunk that runs to the hinge side */}
      <Wires
        wires={[
          ...[-0.15, -0.09, -0.03, 0.03].map((x, i) => ({ color: i === 3 ? '#1f4fd1' : '#c62828', radius: 0.0008, points: [[x, 0.165, -0.047], [x, 0.15, -0.047], [x, 0.135, -0.03]] as Vec3[] })),
          ...[-0.15, -0.09, -0.03].map((x) => ({ color: '#1f4fd1', radius: 0.0008, points: [[x, 0.075, -0.047], [x, 0.09, -0.047], [x, 0.135, -0.03]] as Vec3[] })),
          { color: '#c62828', radius: 0.0008, points: [[0.1, 0.105, -0.047], [0.1, 0.12, -0.047], [0.1, 0.135, -0.03]] as Vec3[] },
        ]}
      />
      <WireBundle
        colors={['#c62828', '#c62828', '#1f4fd1', '#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1', '#c62828']}
        points={[
          [0.1, 0.135, -0.03],
          [-0.35, 0.135, -0.03],
          [-0.35, -0.32, -0.03],
        ]}
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
      <StackLight855T position={[0.26, 1.0, 0.1]} tiers={['red', 'amber', 'green']} getTier={(i) => i === 2 && now() % 5 < 3.2} mount="base" />
    </group>
  );
}

// ---------------------------------------------------------------------------

function StarterBench({ tripped, energized }: { tripped: () => boolean; energized: () => boolean }) {
  const reset = useVal(false);
  return (
    <group>
      <mesh geometry={boxGeo(0.34, 0.24, 0.003)} material={mats.metal('#b9bdc1', 0.45)} position={[0, 0, -0.0015]} receiveShadow />
      <DinRail length={0.3} position={[0, 0.03, 0]}>
        <MotorStarter position={[-0.07, 0, 0]} getEnergized={energized} getTripped={() => tripped() && !reset.get()} onReset={() => reset.set(true)} />
        <MotorStarter position={[0.0, 0, 0]} getEnergized={() => false} getTripped={() => false} />
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
      <mesh geometry={boxGeo(0.5, 0.36, 0.003)} material={mats.metal('#b9bdc1', 0.45)} position={[0, 0, -0.0015]} receiveShadow />
      <WireDuct length={0.48} position={[0, 0.15, 0]} wires={['#1f4fd1', '#c62828', '#111111']} />
      <DinRail length={0.46} position={[0, 0.03, 0]}>
        <CircuitBreaker1489 poles={1} rating="C2" position={[-0.2, 0, 0]} getOn={on.get} onToggle={() => on.set(!on.get())} />
        <CircuitBreaker1489 poles={2} rating="C10" position={[-0.17, 0, 0]} />
        <CircuitBreaker1489 poles={3} rating="C16" position={[-0.12, 0, 0]} />
        <PowerSupply1606 position={[-0.045, 0, 0]} />
        <PowerSupply1606 position={[0.015, 0, 0]} width={0.04} catalog="1606-XLS120E" rating="24V DC 5A 120W" />
        <TerminalBlocks1492 count={16} position={[0.13, 0, 0]} colors={Array.from({ length: 16 }, (_, i) => (i > 12 ? TB_COLORS.green : i > 8 ? TB_COLORS.blue : TB_COLORS.gray))} />
      </DinRail>
      <WireDuct length={0.48} position={[0, -0.12, 0]} cover={false} wires={['#1f4fd1', '#1f4fd1', '#c62828', '#111111', '#eeeeee']} />
    </group>
  );
}

export const previews: Record<string, Preview> = {
  PANEL_Cabinet_DoorOpen: {
    Component: CabinetDoorOpen,
    camera: { position: [0.55, 0.85, 1.75], target: [-0.05, 0.5, 0.12] },
    description: 'RAL 7035 cabinet, door open: breakers, 1606 PSU, 1492 terminals, 100-C starters, ducts, wiring, reserved PLC zone',
  },
  PANEL_Contactor_Energized: {
    Component: ContactorEnergized,
    camera: { position: [0.06, 0.06, 0.32], target: [-0.03, -0.02, 0.05] },
    description: '100-C09 + 193-E starters: left energized (armature pulled in, "I"), right de-energized',
  },
  PANEL_Overload_Tripped: {
    Component: OverloadTripped,
    camera: { position: [0.02, -0.02, 0.26], target: [-0.035, -0.06, 0.06] },
    description: '193-E overload tripped (orange flag, RESET popped out; click RESET) next to a healthy one',
  },
  PANEL_DinRail_Components: {
    Component: DinComponents,
    camera: { position: [0.12, 0.12, 0.55], target: [0, 0.02, 0.04] },
    description: 'DIN rail: 1489-M 1/2/3-pole breakers, 1606-XLS supplies, 1492-J3 terminals, wire ducts',
  },
};
