import { useMemo } from 'react';
import type { Preview } from '../../../../dev/gallery';
import { materials } from '../../../common';
import { PanelView5310 } from './PanelView5310';
import { PowerFlex525, type PowerFlexFrame } from './PowerFlex525';
import { PreviewShadowTuning } from '../compactlogix/previewKit';

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
  return (
    <group>
      <PreviewShadowTuning />
      <PowerFlex525 frame={frame} getFrequency={hz} getRunning={() => hz() > 0} getReverse={() => reverse} />
    </group>
  );
}

function FaultedDrive() {
  return (
    <group>
      <PreviewShadowTuning />
      <PowerFlex525 frame="A" getFrequency={() => 0} getRunning={() => false} getFaulted={() => true} getFaultCode={() => 2} />
    </group>
  );
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

function HmiSizes() {
  const sizes = [7, 9, 10, 12, 15] as const;
  const xs = [-0.56, -0.28, 0.03, 0.38, 0.8];
  return (
    <group>
      <PreviewShadowTuning extent={1.2} />
      <mesh position={[0.13, 0.16, -0.0012]} material={materials.paint('#d6d8d6', 0.55)} receiveShadow>
        <boxGeometry args={[1.8, 0.42, 0.002]} />
      </mesh>
      {sizes.map((sz, i) => (
        <PanelView5310 key={sz} size={sz} position={[xs[i]!, 0, 0]} occlude={false} />
      ))}
    </group>
  );
}

/** Enclosure door (RAL 7035) with a PanelView mounted through it. */
function HmiOnDoor({ size = 7 }: { size?: 7 | 9 | 10 | 12 | 15 }) {
  return (
    <group>
      <PreviewShadowTuning />
      <mesh position={[0, 0.13, -0.0012]} material={materials.paint('#d6d8d6', 0.55)} receiveShadow>
        <boxGeometry args={[0.6, 0.5, 0.002]} />
      </mesh>
      <PanelView5310 size={size} position={[0, 0.02, 0]} />
    </group>
  );
}

function HmiCustom() {
  return (
    <group>
      <PreviewShadowTuning />
      <PanelView5310 size={10}>
        <div style={{ width: 800, height: 600, background: 'linear-gradient(135deg,#0f172a,#1e3a5f)', color: '#e2e8f0', display: 'grid', placeItems: 'center', fontFamily: 'Inter Variable, Arial', fontSize: 48, fontWeight: 800 }}>
          Custom children · 800×600
        </div>
      </PanelView5310>
    </group>
  );
}

/** 12.1" widescreen fed with 4:3 content → letterboxed inside the window, never over the bezel. */
function HmiLetterbox() {
  return (
    <group>
      <PreviewShadowTuning />
      <PanelView5310 size={12} resolution={[1024, 768]}>
        <div style={{ width: 1024, height: 768, background: 'repeating-linear-gradient(45deg,#1e293b 0 40px,#334155 40px 80px)', color: '#f8fafc', display: 'grid', placeItems: 'center', fontFamily: 'Inter Variable, Arial', fontSize: 60, fontWeight: 800, border: '6px solid #f59e0b', boxSizing: 'border-box' }}>
          1024×768 on 1280×800
        </div>
      </PanelView5310>
    </group>
  );
}

/** A cable-like bar crossing the left part of the screen: only the blocked cells of the DOM are clipped. */
function HmiOccluded() {
  return (
    <group>
      <HmiOnDoor />
      <mesh position={[-0.045, 0.1, 0.03]} rotation={[0, 0, 0.3]} material={materials.plastic('#f2c200', 0.5)} castShadow>
        <boxGeometry args={[0.02, 0.26, 0.01]} />
      </mesh>
    </group>
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
    camera: { position: [0.1, 0.15, 0.5], target: [0, 0.11, 0], fov: 35 },
    description: 'PanelView 5310 7" (800×480) on an enclosure door with the interactive sample screen.',
  },
  PV5310_12in: {
    Component: () => <HmiOnDoor size={12} />,
    camera: { position: [-0.2, 0.18, 0.62], target: [0, 0.14, 0], fov: 35 },
    description: 'PanelView 5310 12.1" (1280×800).',
  },
  PV5310_Sizes: {
    Component: HmiSizes,
    camera: { position: [0.13, 0.3, 1.95], target: [0.13, 0.15, 0], fov: 35 },
    description: 'All sizes: 7", 9", 10.4" (4:3), 12.1" PanelView 5310 and the 15" PanelView 5510.',
  },
  PV5310_Custom: {
    Component: HmiCustom,
    camera: { position: [0.05, 0.13, 0.6], target: [0, 0.125, 0], fov: 35 },
    description: 'PanelView 5310 10.4" (2713P-T10CD1, 800×600 4:3) with custom DOM children.',
  },
  PV5310_Letterbox: {
    Component: HmiLetterbox,
    camera: { position: [0.08, 0.14, 0.62], target: [0, 0.12, 0], fov: 35 },
    description: 'PanelView 5310 12.1" with 4:3 content: letterboxed inside the window.',
  },
  PV5310_Occluded: {
    Component: HmiOccluded,
    camera: { position: [0.1, 0.15, 0.5], target: [0, 0.11, 0], fov: 35 },
    description: 'A bar in front of the screen: the DOM is clipped cell-wise instead of being drawn over it.',
  },
  PF525_Back: {
    Component: () => <RunningDrive />,
    camera: { position: [-0.24, 0.14, -0.28], target: [0, 0.08, 0.06], fov: 35 },
    description: 'PowerFlex 525 rear: heat-sink fins with top/bottom caps, mounting tabs with keyholes.',
  },
  PV5310_Back: {
    Component: () => (
      <group>
        <PreviewShadowTuning />
        <PanelView5310 size={7} />
      </group>
    ),
    camera: { position: [0.18, 0.14, -0.3], target: [0, 0.08, -0.03], fov: 35 },
    description: 'Rear view: housing, ports, mounting levers, label.',
  },
  PF525_Frames: {
    Component: DriveLineup,
    camera: { position: [0.34, 0.22, 0.62], target: [0.12, 0.1, 0.1], fov: 35 },
    description: 'Frames A (running), B (reverse), C (stopped).',
  },
};
