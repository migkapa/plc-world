import type { Preview } from '../../../dev/gallery';
import { PedestrianPushButton } from './PedestrianPushButton';
import { PedestrianSignal } from './PedestrianSignal';
import { SignalPole } from './SignalPole';
import { TrafficSignalHead } from './TrafficSignalHead';

/** Demo clock (s). */
const now = () => performance.now() / 1000;
/** Demo cycle: green 4 s, yellow 1.5 s, red 4 s (offset shifts the phase). */
function phase(offset = 0): 'green' | 'yellow' | 'red' {
  const t = (now() + offset) % 9.5;
  return t < 4 ? 'green' : t < 5.5 ? 'yellow' : 'red';
}

function SignalHeadCycle() {
  return (
    <group>
      <TrafficSignalHead position={[-0.7, 1.3, 0]} getRed={() => phase() === 'red'} getYellow={() => phase() === 'yellow'} getGreen={() => phase() === 'green'} />
      <TrafficSignalHead position={[0, 1.3, 0]} getRed={() => true} getYellow={() => false} getGreen={() => false} />
      <TrafficSignalHead position={[0.7, 1.3, 0]} housingColor="#e6ad0c" getRed={() => false} getYellow={() => true} getGreen={() => false} />
      <TrafficSignalHead
        position={[0, 1.95, -0.6]}
        orientation="horizontal"
        getRed={() => false}
        getYellow={() => false}
        getGreen={() => true}
      />
    </group>
  );
}

/** Ped cycle: WALK 5 s, flashing DON'T WALK with countdown 8 s, steady DON'T WALK 5 s. */
function pedPhase(): { walk: boolean; hand: 'flash' | boolean; count: number | null } {
  const t = now() % 18;
  if (t < 5) return { walk: true, hand: false, count: null };
  if (t < 13) return { walk: false, hand: 'flash', count: 13 - t };
  return { walk: false, hand: true, count: null };
}

function PedDevices() {
  return (
    <group>
      <PedestrianSignal position={[-0.6, 1.2, 0]} mount="none" getWalk={() => true} getDontWalk={() => false} />
      <PedestrianSignal position={[0, 1.2, 0]} mount="none" getWalk={() => false} getDontWalk={() => 'flash'} getCountdown={() => 12 - (now() % 12)} />
      <PedestrianSignal position={[0.6, 1.2, 0]} mount="none" visor="crate" housingColor="#e6ad0c" getWalk={() => pedPhase().walk} getDontWalk={() => pedPhase().hand} getCountdown={() => pedPhase().count} />
      <PedestrianPushButton position={[0, 0, 0.6]} getPressed={() => now() % 2 < 0.3} getLit={() => now() % 4 > 0.1} />
      <PedestrianPushButton position={[0.7, 0, 0.6]} arrow="left" color="#e6ad0c" getPressed={() => false} />
    </group>
  );
}

function PoleDemo() {
  const red = () => phase() === 'red';
  const yellow = () => phase() === 'yellow';
  const green = () => phase() === 'green';
  return (
    <SignalPole
      rotation={[0, -Math.PI / 2, 0]}
      arms={[
        {
          length: 9,
          angle: Math.PI / 2,
          streetSign: { at: 6.5, text: 'LOGIX AVE' },
          attachments: [
            { at: 3.2, node: <TrafficSignalHead getRed={red} getYellow={yellow} getGreen={green} /> },
            { at: 7.9, node: <TrafficSignalHead getRed={red} getYellow={yellow} getGreen={green} /> },
          ],
        },
      ]}
      luminaire={{ angle: Math.PI / 2, getLit: () => true }}
      attachments={[
        { height: 3.0, angle: Math.PI, node: <PedestrianSignal getWalk={() => pedPhase().walk} getDontWalk={() => pedPhase().hand} getCountdown={() => pedPhase().count} /> },
        { height: 0.9, angle: -Math.PI / 2, bandSpan: 0.3, node: <PedestrianPushButton mount="none" getPressed={() => false} sign /> },
      ]}
    />
  );
}

export const previews: Record<string, Preview> = {
  TRAF_SignalHead_Cycle: {
    Component: SignalHeadCycle,
    description: '12" LED signal heads: cycling, red, yellow housing, horizontal',
    camera: { position: [0.9, 1.1, 3.6], target: [0, 1.0, 0] },
  },
  TRAF_PedDevices: {
    Component: PedDevices,
    description: 'Countdown pedestrian signals (walk / flashing hand + countdown / cycling crate-visor) and ADA push buttons',
    camera: { position: [0.9, 1.35, 3.0], target: [0.05, 0.95, 0.2] },
  },
  TRAF_SignalPole: {
    Component: PoleDemo,
    description: 'Galvanized mast-arm pole: 2 heads, street-name sign, LED luminaire, ped signal & push button on the pole',
    camera: { position: [7, 3.5, 11], target: [0, 3.5, -3.5] },
  },
};
