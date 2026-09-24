/**
 * Roadside signal controller cabinet of the `traffic-light` scene: the traffic kit's NEMA-style
 * <SignalCabinet/> (door open, click the door to close/open it) with, in its controller zone, the live
 * CompactLogix 5380 rack (5069-L320ER + 5069-IB16 + 5069-OB16), a 1606 24 V DC supply and a terminal
 * strip on a DIN rail, and the NIGHT FLASH key switch (Night_Mode, maintained). The 12 load-switch
 * indicators mirror the PLC outputs (LS2 = NS heads, LS4 = EW heads, LS6/LS8 = their other
 * approaches, LS10 = the pedestrian head: red = DON'T WALK, green = WALK).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { sfx } from '../../../audio/sfx';
import { CompactLogixRack, DinRail, layoutCompactLogixRack, PowerSupply1606, SignalCabinet, TB_COLORS, TerminalBlocks1492 } from '../../../twin/devices';
import { rackLiveFromController } from '../../../twin/live';
import type { SimRuntime } from '../../types';
import { IoTag, ioLine, textLine, audioAllowed } from '../trainer/kit';
import { KeySwitch800F } from './cityKit';
import type { TrafficLightState } from './logic';

/** Controller layout on the back panel (back-panel coordinates, see SIGNAL_CABINET_DIMS.controllerZone). */
const RACK = { x: -0.125, y: 0.02 };
const RAIL2 = { x: 0.085, y: 0.1, len: 0.17 };
const KEY = { x: 0.212, y: 0.092 };

const DOOR_OPEN = 1.95;

export function TrafficCabinet({
  state,
  runtime,
  position,
  rotationY,
}: {
  state: TrafficLightState;
  runtime: SimRuntime;
  position: [number, number, number];
  rotationY: number;
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
  const tbLabels = ['+24', '+24', '0V', '0V', 'I0', 'I1', 'I2', 'O0', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'PE'];
  const tbColors = tbLabels.map((l) => (l === '0V' ? TB_COLORS.blue : l === '+24' ? TB_COLORS.red : TB_COLORS.gray));
  return (
    <SignalCabinet
      position={position}
      rotation={[0, rotationY, 0]}
      label="CAB 07 · MAIN / LOGIX"
      getDoorAngle={() => door.current.angle}
      onDoorClick={() => {
        door.current.open = !door.current.open;
        sfx.play('click');
      }}
      getLoadSwitchLed={getLoadSwitchLed}
    >
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
        <PowerSupply1606 position={[-0.05, 0, 0]} getOk={() => true} />
        <TerminalBlocks1492 count={tbLabels.length} labels={tbLabels} colors={tbColors} position={[0.047, 0, 0]} />
      </DinRail>
      {/* key switch on a small aluminum switch plate */}
      <mesh position={[KEY.x, KEY.y + 0.01, 0.003]} castShadow receiveShadow>
        <boxGeometry args={[0.052, 0.085, 0.006]} />
        <meshStandardMaterial color="#c9cdd0" roughness={0.35} metalness={0.8} />
      </mesh>
      <IoTag
        position={[KEY.x, KEY.y, 0.0065]}
        size={[0.05, 0.075, 0.06]}
        center={[0, 0.008, 0.02]}
        title="Night flash key switch (maintained)"
        lines={[ioLine(runtime, 'Night_Mode')]}
      >
        <KeySwitch800F legend={['NIGHT FLASH']} positions={['OFF', 'ON']} getOn={() => runtime.getControl('night') === true} onToggle={toggleNight} />
      </IoTag>
    </SignalCabinet>
  );
}
