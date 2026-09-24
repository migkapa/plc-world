/**
 * Control cabinet shared by the `conveyor-sort` and `tank-process` views: a wall-mounted RAL 7035 enclosure
 * (door open, click the door to close/open it) with the scene's ControlLogix rack live-wired to the controller
 * (key switch works), 1489 breakers, a 1606 24 V supply, 1492 terminal strips, 100-C contactors / starters for
 * the loads, slotted wire ducts and control wiring. Door: control-power and PLC-run pilot lights and a rotary
 * main disconnect.
 *
 * Layout is derived from the backplate size so different cabinet sizes stay tidy.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  backplateSize,
  CONTACTOR_100C as CONTACTOR_DIMS,
  CircuitBreaker1489,
  Contactor100C,
  ControlLogixRack,
  controlLogixChassisLayout,
  DinRail,
  FieldCable,
  DIN_RAIL_DEPTH,
  Enclosure,
  MotorStarter,
  PilotLight800F,
  PowerSupply1606,
  TB_COLORS,
  TB1492_J3,
  TerminalBlocks1492,
  terminalX,
  WireBundle,
  WireDuct,
  Wires,
} from '../../../twin/devices';
import type { Vec3 } from '../../../twin/contracts';
import { rackLiveFromController } from '../../../twin/live';
import type { SimRuntime } from '../../types';
import { IoHotspot, playSfx } from './kit';

export interface CabinetLoad {
  kind: 'starter' | 'contactor';
  getEnergized: () => boolean;
  getTripped?: () => boolean;
  catalog?: string;
  /** I/O aliases shown on hover (e.g. ['Conveyor_Run']). */
  aliases?: string[];
  title?: string;
}

export interface ControlCabinetProps {
  runtime: SimRuntime;
  /** Enclosure outer size [w, h, d]. */
  size: Vec3;
  nameplate: string;
  position?: Vec3;
  rotationY?: number;
  loads: CabinetLoad[];
  /** Number of field terminals on rail 2. */
  fieldTerminals?: number;
  /** Extra door-mounted devices (door coordinates). */
  doorExtras?: ReactNode;
  initiallyOpen?: boolean;
}

const WIRE_BLUE = '#1f4fd1';
const WIRE_RED = '#c62828';
const WIRE_BLACK = '#111111';
const WIRE_WHITE = '#eeeeee';

/** Rotary main disconnect handle (red on yellow plate) — door coordinates, origin on the door surface. */
function MainDisconnect({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0, 0.002]}>
        <boxGeometry args={[0.075, 0.075, 0.004]} />
        <meshStandardMaterial color="#f5c400" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.022, 0.026, 0.016, 28]} />
        <meshStandardMaterial color="#b5121b" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.012, 0.024]}>
        <boxGeometry args={[0.016, 0.06, 0.014]} />
        <meshStandardMaterial color="#c4161f" roughness={0.35} />
      </mesh>
    </group>
  );
}

export function ControlCabinet({
  runtime,
  size,
  nameplate,
  position,
  rotationY = 0,
  loads,
  fieldTerminals = 24,
  doorExtras,
  initiallyOpen = true,
}: ControlCabinetProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const live = useMemo(() => rackLiveFromController(runtime.controller), [runtime.controller]);
  const hardware = runtime.scene.hardware;
  const [pw, ph] = backplateSize(size);

  const L = useMemo(() => {
    const topDuct = ph / 2 - 0.045;
    const rail1 = topDuct - 0.125;
    const midDuct = rail1 - 0.125;
    const botDuct = -ph / 2 + 0.045;
    const rail2 = botDuct + 0.163;
    const lowDuct = rail2 + 0.11;
    const rackY = lowDuct + 0.13;
    const sideX = pw / 2 - 0.035;
    const ductLen = pw - 0.11;
    // room between the rack top and the mid duct for an extra rail (tall cabinets)
    const gapTop = midDuct - 0.03;
    const gapBottom = rackY + 0.2;
    const extraRail = gapTop - gapBottom > 0.13 ? (gapTop + gapBottom) / 2 : null;
    return { topDuct, rail1, midDuct, botDuct, rail2, lowDuct, rackY, sideX, ductLen, extraRail };
  }, [pw, ph]);

  // rail 1: main breaker, branch breakers, PSU, distribution terminals
  const rail1 = useMemo(() => {
    const left = -L.ductLen / 2 + 0.04;
    const cb = [left + 0.0175, left + 0.035 + 0.0175 * 0.5 + 0.004];
    for (let i = 0; i < 3; i++) cb.push(cb[cb.length - 1]! + 0.0175 + 0.0005);
    const psuX = cb[cb.length - 1]! + 0.0175 / 2 + 0.045;
    const tbCount = 14;
    const tbX = psuX + 0.03 + 0.01 + (tbCount * TB1492_J3.pitch) / 2 + 0.02;
    return { cb, psuX, tbCount, tbX };
  }, [L.ductLen]);

  // rail 2: loads, then field terminals
  const rail2 = useMemo(() => {
    const left = -L.ductLen / 2 + 0.05;
    const xs = loads.map((_, i) => left + i * (CONTACTOR_DIMS.w + 0.012));
    const tbStart = (xs[xs.length - 1] ?? left) + CONTACTOR_DIMS.w / 2 + 0.03;
    const tbX = tbStart + (fieldTerminals * TB1492_J3.pitch) / 2 + 0.01;
    return { xs, tbX };
  }, [loads, fieldTerminals, L.ductLen]);

  const tbZ = DIN_RAIL_DEPTH + 0.0115;
  const wiring = useMemo(() => {
    const out: { points: Vec3[]; color: string; radius?: number }[] = [];
    const zIn = 0.03;
    // breakers down into the mid duct
    rail1.cb.forEach((x, i) =>
      out.push({
        color: i < 2 ? WIRE_BLACK : WIRE_RED,
        radius: 0.0011,
        points: [
          [x, L.rail1 - 0.045, DIN_RAIL_DEPTH + 0.02],
          [x, L.rail1 - 0.07, DIN_RAIL_DEPTH + 0.02],
          [x + 0.003, L.midDuct + 0.022, zIn],
          [x + 0.003, L.midDuct, zIn],
        ],
      }),
    );
    // distribution terminals: up & down
    for (let i = 0; i < rail1.tbCount; i++) {
      const x = rail1.tbX + terminalX(i, rail1.tbCount);
      const color = i < 3 ? WIRE_BLACK : i < 6 ? WIRE_WHITE : i < 11 ? WIRE_BLUE : '#3f9a3a';
      out.push({ color, radius: 0.0009, points: [[x, L.rail1 + TB1492_J3.length / 2, tbZ], [x, L.rail1 + TB1492_J3.length / 2 + 0.02, tbZ], [x, L.topDuct - 0.022, zIn], [x, L.topDuct, zIn]] });
      out.push({ color, radius: 0.0009, points: [[x, L.rail1 - TB1492_J3.length / 2, tbZ], [x, L.rail1 - TB1492_J3.length / 2 - 0.02, tbZ], [x, L.midDuct + 0.022, zIn], [x, L.midDuct, zIn]] });
    }
    // loads: power up, coil wires (red), load side down
    rail2.xs.forEach((sx, k) => {
      const starter = loads[k]!.kind === 'starter';
      for (const dx of [-0.012, 0, 0.012]) {
        out.push({ color: WIRE_BLACK, radius: 0.0013, points: [[sx + dx, L.rail2 + CONTACTOR_DIMS.h / 2, DIN_RAIL_DEPTH + 0.047], [sx + dx, L.rail2 + CONTACTOR_DIMS.h / 2 + 0.02, DIN_RAIL_DEPTH + 0.047], [sx + dx, L.lowDuct - 0.022, zIn], [sx + dx, L.lowDuct, zIn]] });
        const yb = L.rail2 - CONTACTOR_DIMS.h / 2 - (starter ? 0.068 : 0);
        out.push({ color: WIRE_BLACK, radius: 0.0013, points: [[sx + dx, yb, DIN_RAIL_DEPTH + 0.047], [sx + dx, yb - 0.015, DIN_RAIL_DEPTH + 0.047], [sx + dx, L.botDuct + 0.022, zIn], [sx + dx, L.botDuct, zIn]] });
      }
      for (const dx of [-0.0195, 0.0195])
        out.push({ color: WIRE_RED, radius: 0.0009, points: [[sx + dx, L.rail2 + CONTACTOR_DIMS.h / 2, DIN_RAIL_DEPTH + 0.047], [sx + dx, L.rail2 + CONTACTOR_DIMS.h / 2 + 0.018, DIN_RAIL_DEPTH + 0.047], [sx + dx * 0.6, L.lowDuct - 0.022, zIn], [sx + dx * 0.6, L.lowDuct, zIn]] });
    });
    // field terminals: up to the low duct (from the I/O modules), down to the bottom duct (field cables)
    for (let i = 0; i < fieldTerminals; i++) {
      const x = rail2.tbX + terminalX(i, fieldTerminals);
      const color = i % 4 === 3 ? WIRE_WHITE : WIRE_BLUE;
      out.push({ color, radius: 0.0009, points: [[x, L.rail2 + TB1492_J3.length / 2, tbZ], [x, L.rail2 + TB1492_J3.length / 2 + 0.02, tbZ], [x, L.lowDuct - 0.022, zIn], [x, L.lowDuct, zIn]] });
      out.push({ color: i % 2 ? '#e8b90f' : '#6f7479', radius: 0.0011, points: [[x, L.rail2 - TB1492_J3.length / 2, tbZ], [x, L.rail2 - TB1492_J3.length / 2 - 0.02, tbZ], [x, L.botDuct + 0.022, zIn], [x, L.botDuct, zIn]] });
    }
    return out;
  }, [L, rail1, rail2, loads, fieldTerminals, tbZ]);

  const tb1Colors = useMemo(
    () => Array.from({ length: rail1.tbCount }, (_, i) => (i < 6 ? TB_COLORS.gray : i < 11 ? TB_COLORS.blue : TB_COLORS.green)),
    [rail1.tbCount],
  );
  const tb2Colors = useMemo(() => Array.from({ length: fieldTerminals }, (_, i) => (i % 4 === 3 ? TB_COLORS.blue : TB_COLORS.gray)), [fieldTerminals]);
  const tb2Labels = useMemo(() => Array.from({ length: fieldTerminals }, (_, i) => String(i + 1)), [fieldTerminals]);
  const ductWires = [WIRE_BLUE, WIRE_BLUE, WIRE_RED, WIRE_BLACK, WIRE_WHITE, WIRE_BLUE, WIRE_RED, WIRE_BLUE];

  const analogCount = useMemo(() => runtime.scene.io.filter((p) => p.signal === 'analog').length, [runtime.scene]);
  // EN2T port position (for the patch cable)
  const enX = useMemo(() => {
    const en = hardware.modules.find((m) => m.catalog === '1756-EN2T' || m.catalog === '1756-EN4TR');
    if (!en || !hardware.chassis) return null;
    const lay = controlLogixChassisLayout(hardware.chassis);
    return lay.slotCenterX(en.slot) - lay.width / 2;
  }, [hardware]);

  const running = () => {
    try {
      return live.status().running;
    } catch {
      return false;
    }
  };

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Enclosure
        size={size}
        doorAngle={open ? 1.95 : 0}
        nameplate={nameplate}
        onDoorToggle={() => {
          setOpen((o) => !o);
          playSfx('click');
        }}
        doorChildren={
          <group>
            <PilotLight800F position={[-size[0] / 2 + 0.1, size[1] / 2 - 0.2, 0]} color="white" legend="CONTROL ON" getLit={() => true} panelThickness={0.0015} />
            <PilotLight800F position={[-size[0] / 2 + 0.16, size[1] / 2 - 0.2, 0]} color="green" legend="PLC RUN" getLit={running} panelThickness={0.0015} />
            <MainDisconnect position={[size[0] / 2 - 0.1, size[1] / 2 - 0.22, 0]} />
            {doorExtras}
          </group>
        }
      >
        {/* ducts */}
        <WireDuct length={L.ductLen} position={[0, L.topDuct, 0]} wires={ductWires} />
        <WireDuct length={L.ductLen} position={[0, L.midDuct, 0]} wires={ductWires} />
        <WireDuct length={L.ductLen} position={[0, L.lowDuct, 0]} wires={ductWires} />
        <WireDuct length={L.ductLen} position={[0, L.botDuct, 0]} wires={ductWires} />
        <WireDuct length={ph - 0.02} vertical position={[-L.sideX, 0, 0]} />
        <WireDuct length={ph - 0.02} vertical position={[L.sideX, 0, 0]} cover={false} wires={[WIRE_BLUE, WIRE_BLUE, WIRE_RED, WIRE_BLUE, WIRE_BLACK]} />

        {/* rail 1: protection & 24 V DC */}
        <DinRail length={L.ductLen - 0.02} position={[0, L.rail1, 0]}>
          <CircuitBreaker1489 poles={2} rating="C16" position={[rail1.cb[0]!, 0, 0]} />
          {rail1.cb.slice(1).map((x, i) => (
            <CircuitBreaker1489 key={x} poles={1} rating={['C6', 'C4', 'C2', 'C2'][i]} position={[x, 0, 0]} getOn={() => true} />
          ))}
          <PowerSupply1606 position={[rail1.psuX, 0, 0]} getOk={() => true} />
          <TerminalBlocks1492
            count={rail1.tbCount}
            colors={tb1Colors}
            labels={['L1', 'L1', 'L1', 'N', 'N', 'N', '+24', '+24', '+24', '+24', '0V', 'PE', 'PE', 'PE']}
            position={[rail1.tbX, 0, 0]}
          />
        </DinRail>

        {/* the PLC */}
        <ControlLogixRack hardware={hardware} live={live} wired position={[0, L.rackY, 0.002]} />

        {/* rail 2: load contactors / starters + field terminals */}
        <DinRail length={L.ductLen - 0.02} position={[0, L.rail2, 0]}>
          {loads.map((ld, i) =>
            ld.kind === 'starter' ? (
              <MotorStarter
                key={i}
                position={[rail2.xs[i]!, 0, 0]}
                getEnergized={ld.getEnergized}
                getTripped={ld.getTripped ?? (() => false)}
                contactorCatalog={ld.catalog ?? '100-C09'}
              />
            ) : (
              <Contactor100C key={i} position={[rail2.xs[i]!, 0, 0]} getEnergized={ld.getEnergized} catalog={ld.catalog ?? '100-C23'} />
            ),
          )}
          <TerminalBlocks1492 count={fieldTerminals} colors={tb2Colors} labels={tb2Labels} position={[rail2.tbX, 0, 0]} />
        </DinRail>
        {loads.map(
          (ld, i) =>
            ld.aliases && (
              <IoHotspot
                key={`hs${i}`}
                runtime={runtime}
                aliases={ld.aliases}
                title={ld.title}
                size={[0.05, ld.kind === 'starter' ? 0.16 : 0.09, 0.1]}
                position={[rail2.xs[i]!, L.rail2 - (ld.kind === 'starter' ? 0.035 : 0), 0.05]}
                anchor={[rail2.xs[i]!, L.rail2 + 0.07, 0.1]}
              />
            ),
        )}

        {/* managed Ethernet switch + patch cable to the EN2T */}
        <EthernetSwitch position={[L.ductLen / 2 - 0.06, L.rail1, DIN_RAIL_DEPTH]} />
        {enX !== null && (
          <FieldCable
            points={[
              [enX, L.rackY + 0.035, 0.145],
              [enX + 0.02, L.rackY - 0.015, 0.13],
              [enX + 0.08, L.rackY - 0.035, 0.07],
              [L.sideX - 0.035, L.rackY - 0.03, 0.05],
              [L.sideX - 0.035, L.rail1 - 0.08, 0.05],
              [L.ductLen / 2 - 0.06, L.rail1 - 0.075, DIN_RAIL_DEPTH + 0.05],
            ]}
            radius={0.0028}
            color="#2f8f4e"
          />
        )}
        {/* tall cabinets: signal isolators + fused terminals on an extra rail above the PLC */}
        {L.extraRail !== null && (
          <DinRail length={L.ductLen - 0.02} position={[0, L.extraRail, 0]}>
            <SlimModules count={analogCount + 2} position={[-L.ductLen / 2 + 0.06, 0, 0]} />
            <TerminalBlocks1492
              count={12}
              colors={Array.from({ length: 12 }, (_, i) => (i < 8 ? TB_COLORS.black : TB_COLORS.blue))}
              labels={Array.from({ length: 12 }, (_, i) => (i < 8 ? `F${i + 1}` : `0V`))}
              position={[-L.ductLen / 2 + 0.06 + (analogCount + 2) * 0.0125 + 0.06, 0, 0]}
            />
          </DinRail>
        )}

        {/* PSU output bundle into the mid duct */}
        <WireBundle
          colors={[WIRE_BLUE, WIRE_BLUE, WIRE_WHITE, WIRE_BLUE]}
          points={[
            [rail1.psuX, L.rail1 - 0.062, 0.09],
            [rail1.psuX, L.rail1 - 0.085, 0.07],
            [rail1.psuX, L.midDuct + 0.024, 0.035],
            [rail1.psuX, L.midDuct, 0.03],
          ]}
          tieSpacing={0.05}
        />
        <Wires wires={wiring} />
      </Enclosure>
      <CabinetLight size={size} />
    </group>
  );
}

/** Small LED strip light inside the cabinet top (lights the interior when the door is open). */
function CabinetLight({ size }: { size: Vec3 }) {
  return (
    <group position={[0, size[1] - 0.04, size[2] * 0.55]}>
      <mesh>
        <boxGeometry args={[size[0] * 0.5, 0.012, 0.025]} />
        <meshStandardMaterial color="#ffffff" emissive="#f1f6ff" emissiveIntensity={1.1} toneMapped={false} />
      </mesh>
      <pointLight intensity={0.22} distance={1.4} decay={2} color="#f2f6ff" position={[0, -0.05, 0.05]} />
    </group>
  );
}

/** 8-port DIN-rail managed Ethernet switch (Stratix-style), DIN clip plane origin. */
function EthernetSwitch({ position }: { position: Vec3 }) {
  const ports = [0, 1, 2, 3];
  return (
    <group position={position}>
      <mesh position={[0, 0, 0.05]} castShadow>
        <boxGeometry args={[0.05, 0.13, 0.1]} />
        <meshStandardMaterial color="#6b7075" roughness={0.45} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.0, 0.1005]}>
        <planeGeometry args={[0.044, 0.12]} />
        <meshStandardMaterial color="#2b2e31" roughness={0.5} />
      </mesh>
      {ports.map((i) => (
        <group key={i} position={[0, 0.035 - i * 0.022, 0.101]}>
          <mesh>
            <boxGeometry args={[0.016, 0.013, 0.004]} />
            <meshStandardMaterial color="#0d0e0f" roughness={0.6} />
          </mesh>
          <mesh position={[0.014, 0.004, 0.001]}>
            <boxGeometry args={[0.003, 0.003, 0.002]} />
            <meshStandardMaterial color="#22ff66" emissive="#22ff66" emissiveIntensity={i < 2 ? 2.5 : 0} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.057, 0.1012]}>
        <boxGeometry args={[0.03, 0.006, 0.001]} />
        <meshStandardMaterial color="#e8e8e0" roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Slim 12.5 mm DIN modules (4–20 mA signal isolators / interface relays) with a green status LED; instanced. */
function SlimModules({ count, position }: { count: number; position: Vec3 }) {
  const items = useMemo(() => Array.from({ length: count }, (_, i) => ({ x: i * 0.0125 })), [count]);
  return (
    <group position={position}>
      {items.map(({ x }, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 0, 0.045]} castShadow>
            <boxGeometry args={[0.012, 0.1, 0.09]} />
            <meshStandardMaterial color={i % 3 === 2 ? '#3d4c63' : '#b9bdc0'} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.03, 0.0905]}>
            <boxGeometry args={[0.004, 0.004, 0.002]} />
            <meshStandardMaterial color="#22ff66" emissive="#22ff66" emissiveIntensity={2.2} toneMapped={false} />
          </mesh>
          <mesh position={[0, -0.02, 0.0905]}>
            <boxGeometry args={[0.009, 0.03, 0.001]} />
            <meshStandardMaterial color="#e9e9e3" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
