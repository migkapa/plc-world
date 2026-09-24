import { useMemo } from 'react';
import type { Preview } from '../../../../dev/gallery';
import { materials } from '../../../common';
import { PanelView5310 } from './PanelView5310';
import { PowerFlex525, type PowerFlexFrame } from './PowerFlex525';

/** Demo drive: ramps to 45.3 Hz, holds, ramps down, repeats. */
function RunningDrive({ frame = 'A', reverse = false }: { frame?: PowerFlexFrame; reverse?: boolean }) {
  const t0 = useMemo(() => performance.now() / 1000, []);
  const hz = () => {
    const t = (performance.now() / 1000 - t0 + 3) % 40;
    if (t < 3) return (45.3 * t) / 3;
    if (t < 36) return 45.3;
    if (t < 38) return 45.3 * (1 - (t - 36) / 2);
    return 0;
  };
  return <PowerFlex525 frame={frame} getFrequency={hz} getRunning={() => hz() > 0} getReverse={() => reverse} />;
}

function FaultedDrive() {
  return <PowerFlex525 frame="A" getFrequency={() => 0} getRunning={() => false} getFaulted={() => true} getFaultCode={() => 2} />;
}

function DriveLineup() {
  return (
    <group>
      <RunningDrive frame="A" />
      <group position={[0.11, 0, 0]}>
        <RunningDrive frame="B" reverse />
      </group>
      <group position={[0.24, 0, 0]}>
        <PowerFlex525 frame="C" getFrequency={() => 0} getRunning={() => false} ethernet={false} />
      </group>
    </group>
  );
}

/** Enclosure door (RAL 7035) with a PanelView mounted through it. */
function HmiOnDoor({ size = 7 }: { size?: 7 | 9 | 10 | 12 | 15 }) {
  return (
    <group>
      <mesh position={[0, 0.1, -0.0012]} material={materials.paint('#d6d8d6', 0.55)} receiveShadow>
        <boxGeometry args={[0.6, 0.45, 0.002]} />
      </mesh>
      <PanelView5310 size={size} position={[0, 0.02, 0]} />
    </group>
  );
}

function HmiCustom() {
  return (
    <PanelView5310 size={10}>
      <div style={{ width: 1280, height: 800, background: 'linear-gradient(135deg,#0f172a,#1e3a5f)', color: '#e2e8f0', display: 'grid', placeItems: 'center', fontFamily: 'Inter Variable, Arial', fontSize: 64, fontWeight: 800 }}>
        Custom children · 1280×800
      </div>
    </PanelView5310>
  );
}

const pfCam = { position: [0.16, 0.16, 0.42] as [number, number, number], target: [0, 0.08, 0.1] as [number, number, number], fov: 35 };

export const previews: Record<string, Preview> = {
  PF525_Running: { Component: () => <RunningDrive />, camera: pfCam, description: 'PowerFlex 525 frame A running at 45.30 Hz FWD (demo ramp).' },
  PF525_Faulted: { Component: FaultedDrive, camera: pfCam, description: 'PowerFlex 525 faulted: F 002 Auxiliary In, FAULT LED flashing.' },
  PF525_Keypad: {
    Component: () => <RunningDrive />,
    camera: { position: [0.03, 0.13, 0.3], target: [0, 0.115, 0.17], fov: 30 },
    description: 'Close-up of the integral LCD + keypad.',
  },
  PV5310_Demo: {
    Component: () => <HmiOnDoor />,
    camera: { position: [0.1, 0.12, 0.42], target: [0, 0.09, 0], fov: 35 },
    description: 'PanelView 5310 7" (800×480) on an enclosure door with the interactive sample screen.',
  },
  PV5310_12in: {
    Component: () => <HmiOnDoor size={12} />,
    camera: { position: [-0.2, 0.16, 0.55], target: [0, 0.13, 0], fov: 35 },
    description: 'PanelView 5310 12.1" (1280×800).',
  },
  PV5310_Custom: {
    Component: HmiCustom,
    camera: { position: [0.05, 0.1, 0.5], target: [0, 0.1, 0], fov: 35 },
    description: 'PanelView 5310 10" with custom DOM children.',
  },
  PV5310_Back: {
    Component: () => <PanelView5310 size={7} />,
    camera: { position: [0.18, 0.14, -0.3], target: [0, 0.08, -0.03], fov: 35 },
    description: 'Rear view: housing, ports, mounting levers, label.',
  },
  PF525_Frames: {
    Component: DriveLineup,
    camera: { position: [0.34, 0.22, 0.62], target: [0.12, 0.1, 0.1], fov: 35 },
    description: 'Frames A (running), B (reverse), C (stopped).',
  },
};
