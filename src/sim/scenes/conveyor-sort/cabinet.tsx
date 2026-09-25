/**
 * Control cabinet shared by the `conveyor-sort` and `tank-process` views: a wall-mounted RAL 7035 enclosure
 * (door open, click the door to close/open it) with the scene's ControlLogix rack live-wired to the controller
 * (key switch works), 1489 breakers, a 1606 24 V supply, 1492 terminal strips, 100-C contactors / starters for
 * the loads, a 440R-style safety relay (K0) for the hardwired E-stop circuit, a rotary main disconnect (switch body on
 * rail 1, handle on the door), slotted wire ducts and control wiring. Door: control-power and PLC-run pilot lights.
 *
 * Layout is derived from the backplate size so different cabinet sizes stay tidy.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
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
import { Instances, paint } from './hall';
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
  /** Safety relay outputs closed (E-stop released & reset): drives the K0 LEDs. */
  getSafetyOk?: () => boolean;
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
  getSafetyOk = () => true,
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
    const safetyX = tbX + (tbCount * TB1492_J3.pitch) / 2 + 0.035;
    /** Main disconnect switch body at the right end of rail 1 (the door handle sits right in front of it). */
    const discX = L.ductLen / 2 - 0.045;
    return { cb, psuX, tbCount, tbX, safetyX, discX };
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
    // safety relay K0: supply + E-stop channels up into the top duct, safety outputs down to the starter coils
    for (const dx of [-0.007, 0, 0.007]) {
      out.push({ color: dx === 0 ? WIRE_BLUE : '#c9b51f', radius: 0.0009, points: [[rail1.safetyX + dx, L.rail1 + 0.05, DIN_RAIL_DEPTH + 0.05], [rail1.safetyX + dx, L.rail1 + 0.07, DIN_RAIL_DEPTH + 0.05], [rail1.safetyX + dx, L.topDuct - 0.022, zIn], [rail1.safetyX + dx, L.topDuct, zIn]] });
      out.push({ color: dx === 0 ? WIRE_BLUE : '#c9b51f', radius: 0.0009, points: [[rail1.safetyX + dx, L.rail1 - 0.05, DIN_RAIL_DEPTH + 0.05], [rail1.safetyX + dx, L.rail1 - 0.07, DIN_RAIL_DEPTH + 0.05], [rail1.safetyX + dx, L.midDuct + 0.022, zIn], [rail1.safetyX + dx, L.midDuct, zIn]] });
    }
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
            <MainDisconnect position={[rail1.discX, L.rail1, 0]} />
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
        <SafetyRelay position={[rail1.safetyX, L.rail1, DIN_RAIL_DEPTH]} getOk={getSafetyOk} />
        <DisconnectBody position={[rail1.discX, L.rail1, DIN_RAIL_DEPTH]} />
        <IoHotspot
          runtime={runtime}
          title="K0 · 440R safety relay (hardwired E-stop)"
          info={[
            "The E-stop's 2nd N.C. contact opens this relay: its safety outputs drop the starter coil directly, even if the PLC keeps its output on.",
            'The PLC input EStop_OK only tells the program what happened (to reset latches and show the fault).',
          ]}
          size={[0.03, 0.11, 0.12]}
          position={[rail1.safetyX, L.rail1, 0.06]}
          anchor={[rail1.safetyX + 0.03, L.rail1 + 0.07, 0.12]}
        />

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
        <EthernetSwitch position={[L.ductLen / 2 - 0.06, L.rail2, DIN_RAIL_DEPTH]} />
        {enX !== null && (
          <FieldCable
            points={[
              [enX, L.rackY + 0.035, 0.145],
              [enX + 0.02, L.rackY - 0.015, 0.13],
              [enX + 0.08, L.lowDuct + 0.035, 0.085],
              [L.ductLen / 2 - 0.08, L.lowDuct + 0.03, 0.085],
              [L.ductLen / 2 - 0.06, L.rail2 + 0.075, DIN_RAIL_DEPTH + 0.06],
              [L.ductLen / 2 - 0.06, L.rail2 + 0.045, DIN_RAIL_DEPTH + 0.1],
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
        <NoShadowCasters />
      </Enclosure>
      <CabinetLight size={size} />
    </group>
  );
}

/**
 * LED strip inside the cabinet top, hidden behind a folded diffuser lip (a camera in front of the open door sees the
 * lit interior, not a blown-out tube). The point light fills the interior.
 */
function CabinetLight({ size }: { size: Vec3 }) {
  return (
    <group position={[0, size[1] - 0.045, size[2] * 0.55]}>
      <mesh material={ledStripMat()}>
        <boxGeometry args={[size[0] * 0.5, 0.01, 0.022]} />
      </mesh>
      {/* sheet-metal lip in front of / below the strip */}
      <mesh material={paint('#d9dcd6', 0.55, 0.1)} position={[0, -0.012, 0.018]} castShadow={false}>
        <boxGeometry args={[size[0] * 0.54, 0.032, 0.0015]} />
      </mesh>
      <mesh material={paint('#d9dcd6', 0.55, 0.1)} position={[0, 0.006, 0.005]}>
        <boxGeometry args={[size[0] * 0.54, 0.0015, 0.028]} />
      </mesh>
      {/* soft interior fill from the front half of the cabinet (no hotspot on the white backplate) */}
      <pointLight intensity={0.09} distance={1.8} decay={2} color="#f2f6ff" position={[0, -size[1] * 0.45, size[2] * 0.75]} />
    </group>
  );
}

/**
 * Nothing inside a wall cabinet casts a useful shadow from the hall's main light (the enclosure body does): turn
 * shadow casting off for every mesh on the backplate (devices mount lazily, so re-check a few times). Saves one
 * shadow-pass draw per interior mesh.
 */
function NoShadowCasters() {
  const ref = useRef<THREE.Group>(null);
  const passes = useRef(0);
  const next = useRef(0);
  useFrame(({ clock }) => {
    if (passes.current >= 5 || clock.elapsedTime < next.current) return;
    passes.current++;
    next.current = clock.elapsedTime + 1.2;
    ref.current?.parent?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.castShadow) m.castShadow = false;
    });
  });
  return <group ref={ref} />;
}

const lmats = new Map<string, THREE.Material>();
function lmat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = lmats.get(key) as T | undefined;
  if (!m) {
    m = make();
    lmats.set(key, m);
  }
  return m;
}
const ledStripMat = () => lmat('cab:ledStrip', () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#eef3ff', emissiveIntensity: 0.35, roughness: 0.4 }));
const ledMat = (hex: string, on: number) =>
  lmat(`cab:led:${hex}:${on}`, () => new THREE.MeshStandardMaterial({ color: on ? hex : '#1d2a22', emissive: hex, emissiveIntensity: on, toneMapped: on === 0 }));

/** 22.5 mm safety relay (440R-style, yellow front): PWR, K1 / K2 output LEDs follow `getOk`. DIN clip plane origin. */
function SafetyRelay({ position, getOk }: { position: Vec3; getOk: () => boolean }) {
  const k1 = useRef<THREE.Mesh>(null);
  const k2 = useRef<THREE.Mesh>(null);
  const last = useRef<boolean | null>(null);
  useFrame(() => {
    const ok = getOk();
    if (ok === last.current) return;
    last.current = ok;
    const m = ok ? ledMat('#22ff66', 2.4) : ledMat('#22ff66', 0);
    if (k1.current) k1.current.material = m;
    if (k2.current) k2.current.material = m;
  });
  return (
    <group position={position}>
      <mesh material={paint('#4a4d50', 0.5, 0.1)} position={[0, 0, 0.055]} castShadow>
        <boxGeometry args={[0.0225, 0.1, 0.11]} />
      </mesh>
      <mesh material={paint('#f2c200', 0.45, 0.05)} position={[0, 0.0, 0.1105]}>
        <boxGeometry args={[0.0215, 0.07, 0.002]} />
      </mesh>
      {/* terminal rows top / bottom */}
      <Instances
        geometry={unitBoxGeo}
        material={paint('#8c9196', 0.4, 0.6)}
        items={[-1, 1].flatMap((sy) => [-0.007, 0, 0.007].map((x) => ({ p: [x, sy * 0.043, 0.1] as Vec3, s: [0.004, 0.008, 0.012] as Vec3 })))}
        castShadow={false}
      />
      <mesh material={ledMat('#22ff66', 2.4)} position={[0, 0.025, 0.1122]}>
        <boxGeometry args={[0.004, 0.004, 0.0015]} />
      </mesh>
      <mesh ref={k1} material={ledMat('#22ff66', 2.4)} position={[0, 0.015, 0.1122]}>
        <boxGeometry args={[0.004, 0.004, 0.0015]} />
      </mesh>
      <mesh ref={k2} material={ledMat('#22ff66', 2.4)} position={[0, 0.005, 0.1122]}>
        <boxGeometry args={[0.004, 0.004, 0.0015]} />
      </mesh>
      <mesh material={paint('#e9e9e3', 0.6, 0)} position={[0, -0.018, 0.1122]}>
        <boxGeometry args={[0.016, 0.012, 0.001]} />
      </mesh>
    </group>
  );
}

/** Rotary main disconnect switch body (194E-style) with the coupling shaft toward the door handle. */
function DisconnectBody({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh material={paint('#34373a', 0.5, 0.1)} position={[0, 0, 0.04]} castShadow>
        <boxGeometry args={[0.05, 0.085, 0.08]} />
      </mesh>
      <mesh material={paint('#232527', 0.45, 0.1)} position={[0, 0, 0.085]}>
        <boxGeometry args={[0.03, 0.03, 0.01]} />
      </mesh>
      <mesh material={paint('#8e959b', 0.35, 0.7)} position={[0, 0, 0.13]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.0035, 0.0035, 0.08, 10]} />
      </mesh>
      <mesh material={paint('#e9e9e3', 0.6, 0)} position={[0, 0.03, 0.0805]}>
        <boxGeometry args={[0.03, 0.012, 0.001]} />
      </mesh>
    </group>
  );
}

const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);

/** 8-port DIN-rail managed Ethernet switch (Stratix-style), DIN clip plane origin. Ports & LEDs are instanced. */
function EthernetSwitch({ position }: { position: Vec3 }) {
  const ports = useMemo(() => [0, 1, 2, 3].map((i) => ({ p: [0, 0.035 - i * 0.022, 0.101] as Vec3, s: [0.016, 0.013, 0.004] as Vec3 })), []);
  const leds = useMemo(() => [0, 1].map((i) => ({ p: [0.014, 0.039 - i * 0.022, 0.102] as Vec3, s: [0.003, 0.003, 0.002] as Vec3 })), []);
  return (
    <group position={position}>
      <mesh position={[0, 0, 0.05]} material={paint('#6b7075', 0.45, 0.5)} castShadow>
        <boxGeometry args={[0.05, 0.13, 0.1]} />
      </mesh>
      <mesh position={[0, 0.0, 0.1005]} material={paint('#2b2e31', 0.5, 0.1)}>
        <planeGeometry args={[0.044, 0.12]} />
      </mesh>
      <Instances geometry={unitBoxGeo} material={paint('#0d0e0f', 0.6, 0.1)} items={ports} castShadow={false} />
      <Instances geometry={unitBoxGeo} material={ledMat('#22ff66', 2.5)} items={leds} castShadow={false} receiveShadow={false} />
      <mesh position={[0, 0.057, 0.1012]} material={paint('#e8e8e0', 0.6, 0)}>
        <boxGeometry args={[0.03, 0.006, 0.001]} />
      </mesh>
    </group>
  );
}

/** Slim 12.5 mm DIN modules (4–20 mA signal isolators / interface relays) with a green status LED; instanced. */
function SlimModules({ count, position }: { count: number; position: Vec3 }) {
  const bodies = useMemo(() => Array.from({ length: count }, (_, i) => ({ p: [i * 0.0125, 0, 0.045] as Vec3, s: [0.012, 0.1, 0.09] as Vec3, c: i % 3 === 2 ? '#3d4c63' : '#b9bdc0' })), [count]);
  const leds = useMemo(() => Array.from({ length: count }, (_, i) => ({ p: [i * 0.0125, 0.03, 0.0905] as Vec3, s: [0.004, 0.004, 0.002] as Vec3 })), [count]);
  const labels = useMemo(() => Array.from({ length: count }, (_, i) => ({ p: [i * 0.0125, -0.02, 0.0905] as Vec3, s: [0.009, 0.03, 0.001] as Vec3 })), [count]);
  return (
    <group position={position}>
      <Instances geometry={unitBoxGeo} material={paint('#ffffff', 0.55, 0)} items={bodies} />
      <Instances geometry={unitBoxGeo} material={ledMat('#22ff66', 2.2)} items={leds} castShadow={false} receiveShadow={false} />
      <Instances geometry={unitBoxGeo} material={paint('#e9e9e3', 0.6, 0)} items={labels} castShadow={false} />
    </group>
  );
}
