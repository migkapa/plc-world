import { useMemo, useState } from 'react';
import type { Preview } from '../../../../dev/gallery';
import type { HardwareConfig } from '../../../../plc/types';
import { materials } from '../../../common';
import { CompactLogix5380Controller } from './CompactLogix5380Controller';
import { CompactLogixRack } from './CompactLogixRack';
import { createCompactDemoLive } from './demoLive';
import { Module5069, type Module5069Catalog } from './Module5069';
import { DUCT, WireDuct } from './parts';
import { PreviewShadowTuning } from './previewKit';

const TRAFFIC_HW: HardwareConfig = {
  platform: 'CompactLogix',
  modules: [
    { slot: 0, catalog: '5069-L320ER', name: 'Traffic_PLC' },
    { slot: 1, catalog: '5069-IB16', name: 'DI_Street' },
    { slot: 2, catalog: '5069-OB16', name: 'DO_Lamps' },
  ],
};
/** Points used by the traffic-light scene (docs/SCENES.md): Ped_PB, Car_Sensor_EW, Night_Mode; 8 lamp outputs. */
const TRAFFIC_WIRING = { 1: [0, 1, 2], 2: [0, 1, 2, 3, 4, 5, 6, 7] };

const FULL_HW: HardwareConfig = {
  platform: 'CompactLogix',
  modules: [
    { slot: 0, catalog: '5069-L330ERM' },
    { slot: 1, catalog: '5069-IB16' },
    { slot: 2, catalog: '5069-IB16' },
    { slot: 3, catalog: '5069-OB16' },
    { slot: 4, catalog: '5069-OB16' },
    { slot: 5, catalog: '5069-IF8' },
    { slot: 6, catalog: '5069-OF4' },
  ],
};

/** Galvanised backplate behind the DIN rail for context. */
function Backplate({ w, h, y = 0.04 }: { w: number; h: number; y?: number }) {
  return (
    <mesh position={[0, y, -0.001]} material={materials.metal('#c9cdd1', 0.55)} receiveShadow>
      <boxGeometry args={[w, h, 0.002]} />
    </mesh>
  );
}

function TrafficRack() {
  const live = useMemo(() => createCompactDemoLive({ hardware: TRAFFIC_HW, pattern: 'traffic', initialKey: 'REM' }), []);
  const [sel, setSel] = useState<number | undefined>(undefined);
  return (
    <group>
      <PreviewShadowTuning />
      <Backplate w={0.36} h={0.32} />
      <CompactLogixRack hardware={TRAFFIC_HW} live={live} wiring={TRAFFIC_WIRING} onSelectModule={setSel} highlightSlot={sel} />
    </group>
  );
}

function FullRack() {
  const live = useMemo(() => createCompactDemoLive({ hardware: FULL_HW, pattern: 'chase', forces: 'enabled' }), []);
  return (
    <group>
      <PreviewShadowTuning />
      <Backplate w={0.46} h={0.34} />
      <CompactLogixRack hardware={FULL_HW} live={live} highlightSlot={3} />
    </group>
  );
}

function FaultedRack() {
  const live = useMemo(() => createCompactDemoLive({ hardware: TRAFFIC_HW, pattern: 'traffic', faulted: true }), []);
  return (
    <group>
      <PreviewShadowTuning />
      <Backplate w={0.36} h={0.32} />
      <CompactLogixRack hardware={TRAFFIC_HW} live={live} wiring={TRAFFIC_WIRING} />
    </group>
  );
}

function Controller({ catalog = '5069-L320ER' as const }: { catalog?: '5069-L320ER' | '5069-L330ERM' }) {
  const live = useMemo(() => createCompactDemoLive({ hardware: TRAFFIC_HW, initialKey: 'REM' }), []);
  return (
    <group>
      <PreviewShadowTuning />
      <CompactLogix5380Controller catalog={catalog} live={live} cables={[true, true]} />
    </group>
  );
}

/** One module on a backplate with its own wire duct segment. */
function SingleModule({ catalog, wired = false, faultPoint }: { catalog: Module5069Catalog; wired?: boolean; faultPoint?: number }) {
  const live = useMemo(() => createCompactDemoLive({ hardware: { platform: 'CompactLogix', modules: [{ slot: 1, catalog }] }, pattern: 'chase' }), [catalog]);
  return (
    <group>
      <PreviewShadowTuning />
      {wired && (
        <>
          <Backplate w={0.12} h={0.3} y={0.02} />
          <WireDuct length={0.1} position={[0, -DUCT.gap, 0]} />
        </>
      )}
      <Module5069
        catalog={catalog}
        position={wired ? [0, 0, 0.0075] : undefined}
        getPoint={(i) => live.point(1, i)}
        getPointFault={faultPoint === undefined ? undefined : (i) => i === faultPoint}
        getChannel={(c) => (catalog === '5069-IF8' && c === 3 ? NaN : live.channel(1, c))}
        wired={wired}
      />
    </group>
  );
}

const rackCam = { position: [0.22, 0.17, 0.44] as [number, number, number], target: [0, 0.05, 0.07] as [number, number, number], fov: 35 };
const modCam = { position: [0.13, 0.15, 0.33] as [number, number, number], target: [0, 0.072, 0.07] as [number, number, number], fov: 35 };
const wiredModCam = { position: [0.16, 0.12, 0.36] as [number, number, number], target: [0, 0.03, 0.07] as [number, number, number], fov: 35 };

export const previews: Record<string, Preview> = {
  CPX_Rack_Traffic: {
    Component: TrafficRack,
    camera: rackCam,
    description: 'Traffic-light scene rack: 5069-L320ER + IB16 + OB16 + ECR on DIN rail, scene I/O wired into the duct (demo I/O).',
  },
  CPX_Rack_Full: {
    Component: FullRack,
    camera: { position: [0.28, 0.18, 0.52], target: [0, 0.04, 0.07], fov: 35 },
    description: '5069-L330ERM + 6 I/O modules fully wired (DC + shielded analog pairs) into the wire duct, forces enabled, slot 3 highlighted.',
  },
  CPX_Rack_Faulted: {
    Component: FaultedRack,
    camera: rackCam,
    description: 'Major fault: OK flashing red, scrolling fault text, outputs off.',
  },
  CPX_Wiring: {
    Component: FullRack,
    camera: { position: [0.1, 0.02, 0.3], target: [0.05, 0.02, 0.1], fov: 35 },
    description: 'Close-up of the RTB field wiring: ferrules, marker sleeves, commons, analog shielded pairs, wire duct.',
  },
  CPX_L320ER: {
    Component: () => <Controller />,
    camera: { position: [0.13, 0.13, 0.4], target: [0, 0.06, 0.1], fov: 35 },
    description: '5069-L320ER close-up (REM RUN, both Ethernet ports cabled). Click RUN/REM/PROG on the mode switch.',
  },
  CPX_L320ER_Under: {
    Component: () => <Controller />,
    camera: { position: [0.1, -0.2, 0.3], target: [0, 0.02, 0.1], fov: 35 },
    description: '5069-L320ER from below: RJ45 A1/A2 on the flat underside, vents, DIN latch.',
  },
  CPX_L330ERM: {
    Component: () => <Controller catalog="5069-L330ERM" />,
    camera: { position: [-0.22, 0.11, 0.36], target: [0, 0.06, 0.07], fov: 35 },
    description: '5069-L330ERM from the left (power column MOD/SA RTBs, product label).',
  },
  CPX_IB16: { Component: () => <SingleModule catalog="5069-IB16" />, camera: modCam, description: '5069-IB16 24V DC sink input module.' },
  CPX_OB16: {
    Component: () => <SingleModule catalog="5069-OB16" wired faultPoint={15} />,
    camera: wiredModCam,
    description: '5069-OB16 source output module, wired into a duct; point 15 shows the red fault state.',
  },
  CPX_IF8: {
    Component: () => <SingleModule catalog="5069-IF8" wired />,
    camera: wiredModCam,
    description: '5069-IF8 analog input with shielded pairs (ch 3 faulted).',
  },
  CPX_OF4: { Component: () => <SingleModule catalog="5069-OF4" />, camera: modCam, description: '5069-OF4 analog output.' },
};
