import type { Preview } from '../../../dev/gallery';
import { Car, CarFleet, type CarInstance } from './Car';
import { PedestrianPushButton } from './PedestrianPushButton';
import { PedestrianSignal } from './PedestrianSignal';
import { SignalCabinet } from './SignalCabinet';
import { SignalPole, poleRadiusAt } from './SignalPole';
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
      arms={[
        {
          length: 9,
          angle: 0,
          streetSign: { at: 6.5, text: 'LOGIX AVE' },
          attachments: [
            { at: 3.2, node: <TrafficSignalHead getRed={red} getYellow={yellow} getGreen={green} /> },
            { at: 7.9, node: <TrafficSignalHead getRed={red} getYellow={yellow} getGreen={green} /> },
          ],
        },
      ]}
      luminaire={{ angle: 0, getLit: () => true }}
      attachments={[
        { height: 3.0, angle: Math.PI / 2, node: <PedestrianSignal getWalk={() => pedPhase().walk} getDontWalk={() => pedPhase().hand} getCountdown={() => pedPhase().count} /> },
        { height: 0.9, angle: 0, bands: false, node: <PedestrianPushButton mount="none" poleRadius={poleRadiusAt(1.05)} getPressed={() => false} sign /> },
      ]}
    />
  );
}

function CarsDemo() {
  const d = () => now() * 3;
  return (
    <group>
      {[0, 1, 2, 3].map((v, i) => (
        <Car key={v} variant={v} position={[(i - 1.5) * 5.2, 0, 1.6]} getDistance={d} getHeadlights={() => i % 2 === 0} getBraking={() => now() % 2 < 1} getBlinker={() => (i === 1 ? 'left' : null)} />
      ))}
      <CarFleet
        capacity={8}
        getCar={(i: number, o: CarInstance) => {
          if (i >= 4) return false;
          o.variant = 4 + i;
          o.x = (i - 1.5) * 5.2;
          o.z = -1.6;
          o.yaw = Math.PI;
          o.distance = d();
          o.braking = now() % 2 >= 1;
          o.headlights = true;
          o.steer = i === 3 ? 0.3 : 0;
          return true;
        }}
      />
    </group>
  );
}

/** CarFleet LOD check: the same four styles at full detail (front row) and forced low-poly (back row). */
function CarsLodDemo() {
  const d = () => now() * 3;
  const row = (z: number) => (i: number, o: CarInstance) => {
    if (i >= 4) return false;
    o.variant = i;
    o.x = (i - 1.5) * 5.2;
    o.z = z;
    o.yaw = 0.35;
    o.distance = d();
    o.braking = now() % 2 >= 1;
    return true;
  };
  return (
    <group>
      <CarFleet capacity={4} getCar={row(2.4)} lodDistance={false} />
      <CarFleet capacity={4} getCar={row(-2.4)} lodDistance={0} />
    </group>
  );
}

function CabinetDemo() {
  return (
    <group>
      <SignalCabinet position={[-0.7, 0, 0]} getDoorAngle={() => 1.9 * (0.5 - 0.5 * Math.cos(Math.min(now() * 0.8, Math.PI)))}>
        <mesh position={[0, 0.1, 0.06]}>
          <boxGeometry args={[0.4, 0.14, 0.12]} />
          <meshStandardMaterial color="#1b1c1e" />
        </mesh>
      </SignalCabinet>
      <SignalCabinet position={[0.8, 0, 0]} label="CAB 07" />
    </group>
  );
}

export const previews: Record<string, Preview> = {
  TRAF_SignalHead_Cycle: {
    Component: SignalHeadCycle,
    description: '12" LED signal heads: cycling, red, yellow housing, horizontal',
    camera: { position: [0.9, 1.1, 3.6], target: [0, 1.0, 0] },
  },
  TRAF_Cars: {
    Component: CarsDemo,
    description: 'Car variants 0..7: sedan, hatchback, SUV, taxi — <Car/> (front row) and instanced <CarFleet/> (back row); wheels spin, brake lights blink',
    camera: { position: [4, 5.5, 14], target: [0, 0.5, 0] },
  },
  TRAF_Cars_LOD: {
    Component: CarsLodDemo,
    description: 'CarFleet built-in LOD: full-detail cars (front row) vs the low-poly body + wheels used beyond lodDistance (back row)',
    camera: { position: [3, 4.5, 13], target: [0, 0.6, 0] },
  },
  TRAF_SignalCabinet: {
    Component: CabinetDemo,
    description: 'NEMA-style signal controller cabinet (door opening, interior back panel) + closed cabinet',
    camera: { position: [1.4, 1.9, 3.6], target: [0, 0.8, 0] },
  },
  TRAF_PedDevices: {
    Component: PedDevices,
    description: 'Countdown pedestrian signals (walk / flashing hand + countdown / cycling crate-visor) and ADA push buttons',
    camera: { position: [0.9, 1.35, 3.0], target: [0.05, 0.95, 0.2] },
  },
  TRAF_SignalPole: {
    Component: PoleDemo,
    description: 'Galvanized mast-arm pole: 2 heads, street-name sign, LED luminaire, ped signal & push button on the pole',
    camera: { position: [3.5, 2.6, 12.5], target: [3.6, 3.6, 0] },
  },
};
