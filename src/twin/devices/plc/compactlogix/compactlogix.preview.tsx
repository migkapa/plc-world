import { useMemo, useState } from 'react';
import type { Preview } from '../../../../dev/gallery';
import type { HardwareConfig } from '../../../../plc/types';
import { materials } from '../../../common';
import { CompactLogix5380Controller } from './CompactLogix5380Controller';
import { CompactLogixRack } from './CompactLogixRack';
import { createCompactDemoLive } from './demoLive';
import { Module5069, type Module5069Catalog } from './Module5069';

const TRAFFIC_HW: HardwareConfig = {
  platform: 'CompactLogix',
  modules: [
    { slot: 0, catalog: '5069-L320ER', name: 'Traffic_PLC' },
    { slot: 1, catalog: '5069-IB16', name: 'DI_Street' },
    { slot: 2, catalog: '5069-OB16', name: 'DO_Lamps' },
  ],
};

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
function Backplate({ w, h, y = 0.07 }: { w: number; h: number; y?: number }) {
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
      <Backplate w={0.36} h={0.26} />
      <CompactLogixRack hardware={TRAFFIC_HW} live={live} onSelectModule={setSel} highlightSlot={sel} />
    </group>
  );
}

function FullRack() {
  const live = useMemo(() => createCompactDemoLive({ hardware: FULL_HW, pattern: 'chase', forces: 'enabled' }), []);
  return (
    <group>
      <Backplate w={0.46} h={0.3} />
      <CompactLogixRack hardware={FULL_HW} live={live} doorsOpen highlightSlot={3} />
    </group>
  );
}

function FaultedRack() {
  const live = useMemo(() => createCompactDemoLive({ hardware: TRAFFIC_HW, pattern: 'traffic', faulted: true }), []);
  return (
    <group>
      <Backplate w={0.36} h={0.26} />
      <CompactLogixRack hardware={TRAFFIC_HW} live={live} />
    </group>
  );
}

function Controller({ catalog = '5069-L320ER' as const }: { catalog?: '5069-L320ER' | '5069-L330ERM' }) {
  const live = useMemo(() => createCompactDemoLive({ hardware: TRAFFIC_HW, initialKey: 'REM' }), []);
  return <CompactLogix5380Controller catalog={catalog} live={live} cables={[true, true]} />;
}

function SingleModule({ catalog, wired = false }: { catalog: Module5069Catalog; wired?: boolean }) {
  const live = useMemo(() => createCompactDemoLive({ hardware: { platform: 'CompactLogix', modules: [{ slot: 1, catalog }] }, pattern: 'chase' }), [catalog]);
  return (
    <Module5069
      catalog={catalog}
      getPoint={(i) => live.point(1, i)}
      getChannel={(c) => (c === 3 ? NaN : live.channel(1, c))}
      wired={wired}
    />
  );
}

const rackCam = { position: [0.2, 0.19, 0.4] as [number, number, number], target: [0, 0.07, 0.07] as [number, number, number], fov: 35 };
const modCam = { position: [0.13, 0.15, 0.33] as [number, number, number], target: [0, 0.072, 0.07] as [number, number, number], fov: 35 };

export const previews: Record<string, Preview> = {
  CPX_Rack_Traffic: {
    Component: TrafficRack,
    camera: rackCam,
    description: 'CompactLogix 5380 rack of the traffic-light scene: 5069-L320ER + IB16 + OB16 + ECR on DIN rail (demo I/O).',
  },
  CPX_Rack_Full: {
    Component: FullRack,
    camera: { position: [0.26, 0.2, 0.5], target: [0, 0.07, 0.07], fov: 35 },
    description: '5069-L330ERM + 6 I/O modules, RTBs wired, forces enabled, slot 3 highlighted.',
  },
  CPX_Rack_Faulted: {
    Component: FaultedRack,
    camera: rackCam,
    description: 'Major fault: OK flashing red, scrolling fault text, outputs off.',
  },
  CPX_L320ER: {
    Component: () => <Controller />,
    camera: { position: [0.13, 0.13, 0.4], target: [0, 0.07, 0.1], fov: 35 },
    description: '5069-L320ER close-up (REM RUN, both Ethernet ports cabled). Click RUN/REM/PROG on the mode switch.',
  },
  CPX_L330ERM: {
    Component: () => <Controller catalog="5069-L330ERM" />,
    camera: { position: [-0.14, 0.09, 0.3], target: [0, 0.07, 0.09], fov: 35 },
    description: '5069-L330ERM from the left (power column MOD/SA RTBs).',
  },
  CPX_IB16: { Component: () => <SingleModule catalog="5069-IB16" />, camera: modCam, description: '5069-IB16 24V DC sink input module.' },
  CPX_OB16: { Component: () => <SingleModule catalog="5069-OB16" wired />, camera: modCam, description: '5069-OB16 source output module, wired RTB.' },
  CPX_IF8: { Component: () => <SingleModule catalog="5069-IF8" />, camera: modCam, description: '5069-IF8 analog input (ch 3 faulted).' },
  CPX_OF4: { Component: () => <SingleModule catalog="5069-OF4" />, camera: modCam, description: '5069-OF4 analog output.' },
};
