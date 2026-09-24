/**
 * Composite demos: a small 4-way intersection (TRAF_Intersection_Demo) and a garage entry lane
 * (PARK_Entry_Lane) built only from the traffic kit, with demo getters so everything is alive.
 */
import type { Preview } from '../../../dev/gallery';
import { BarrierGate } from './BarrierGate';
import { CarFleet, type CarInstance } from './Car';
import { InductiveLoopMarking } from './InductiveLoopMarking';
import { ParkingStatusSign } from './LedSign';
import { Pedestrian } from './Pedestrian';
import { PedestrianPushButton } from './PedestrianPushButton';
import { PedestrianSignal } from './PedestrianSignal';
import { GroundSlab, Intersection, ParkingSpace } from './Road';
import { SignalPole, type MastArmSpec } from './SignalPole';
import { TicketDispenser } from './TicketDispenser';
import { TrafficSignalHead } from './TrafficSignalHead';

const now = () => performance.now() / 1000;

/** Demo controller: NS green 6 s, yellow 2 s, all-red 1 s, EW green 5 s, yellow 2 s, all-red 1 s. */
function lamps() {
  const t = now() % 17;
  const ns = t < 6 ? 'g' : t < 8 ? 'y' : 'r';
  const ew = t >= 9 && t < 14 ? 'g' : t >= 14 && t < 16 ? 'y' : 'r';
  return { ns, ew, walk: t < 4, flashHand: t >= 4 && t < 6, count: t >= 4 && t < 6 ? Math.ceil(6 - t) + 5 : null };
}

function head(road: 'ns' | 'ew') {
  return (
    <TrafficSignalHead
      getRed={() => lamps()[road] === 'r'}
      getYellow={() => lamps()[road] === 'y'}
      getGreen={() => lamps()[road] === 'g'}
    />
  );
}

/** Far-side mast arm over the approach lanes; `angle` = arm heading. */
function arm(angle: number, road: 'ns' | 'ew', street: string): MastArmSpec {
  return {
    length: 7.2,
    angle,
    height: 5.6,
    streetSign: { at: 5.9, text: street, width: 1.6 },
    attachments: [
      { at: 3.5, node: head(road), flip: true },
      { at: 5.3, node: head(road), flip: true },
    ],
  };
}

const PED = {
  walk: () => lamps().walk,
  hand: () => (lamps().flashHand ? ('flash' as const) : !lamps().walk),
  count: () => lamps().count,
};

function IntersectionDemo() {
  const P = 5.3;
  return (
    <group>
      <hemisphereLight args={['#dbe9ff', '#5b5147', 0.9]} />
      <directionalLight
        position={[18, 30, 12]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-far={80}
        shadow-bias={-0.0004}
      />
      <Intersection armLength={30} />
      {/* NE pole: NB heads (arm west) + ped signal/button for the north crosswalk */}
      <SignalPole
        position={[P, 0.15, -P]}
        poleId="NE-1"
        arms={[arm(Math.PI, 'ns', 'MAIN ST')]}
        luminaire={{ angle: Math.PI, getLit: () => false }}
        attachments={[
          { height: 3.0, angle: -Math.PI / 2, node: <PedestrianSignal getWalk={PED.walk} getDontWalk={PED.hand} getCountdown={PED.count} /> },
          { height: 1.0, angle: 0, bandSpan: 0.3, node: <PedestrianPushButton mount="none" arrow="left" getPressed={() => now() % 5 < 0.4} getLit={() => now() % 17 > 9} /> },
        ]}
      />
      {/* SW pole: SB heads (arm east) */}
      <SignalPole position={[-P, 0.15, P]} poleId="SW-3" arms={[arm(0, 'ns', 'MAIN ST')]} luminaire={{ angle: 0 }} />
      {/* SE pole: EB heads (arm north) */}
      <SignalPole position={[P, 0.15, P]} poleId="SE-2" arms={[arm(Math.PI / 2, 'ew', 'LOGIX AVE')]} />
      {/* NW pole: WB heads (arm south) + ped signal/button */}
      <SignalPole
        position={[-P, 0.15, -P]}
        poleId="NW-4"
        arms={[arm(-Math.PI / 2, 'ew', 'LOGIX AVE')]}
        attachments={[
          { height: 3.0, angle: Math.PI / 2, node: <PedestrianSignal getWalk={PED.walk} getDontWalk={PED.hand} getCountdown={PED.count} /> },
          { height: 1.0, angle: 0, bandSpan: 0.3, node: <PedestrianPushButton mount="none" arrow="right" getPressed={() => false} /> },
        ]}
      />
      {/* EW detector loops in front of the stop bars */}
      <InductiveLoopMarking position={[-11.5, 0, 1.75]} length={6} width={1.8} leadIn={0.85} getActive={() => true} />
      <InductiveLoopMarking position={[11.5, 0, -1.75]} rotation={[0, Math.PI, 0]} length={6} width={1.8} leadIn={0.85} getActive={() => now() % 4 < 2} />
      <CarFleet capacity={8} getCar={demoCars} />
      <Pedestrian variant={1} position={[1.2, 0, -5.2]} rotation={[0, Math.PI, 0]} getDistance={() => now() * 1.4} getWalking={() => true} />
      <Pedestrian variant={3} position={[4.3, 0.15, -3.9]} rotation={[0, Math.PI / 2, 0]} getReach={() => (now() % 5 < 1.2 ? 1 : 0)} />
      <Pedestrian variant={4} position={[-4.6, 0.15, -6.4]} rotation={[0, -0.3, 0]} />
    </group>
  );
}

function demoCars(i: number, o: CarInstance): boolean {
  const t = now();
  switch (i) {
    case 0: // NB waiting at the stop bar
      o.variant = 0;
      o.x = 1.75;
      o.z = 10.9;
      o.yaw = Math.PI / 2;
      o.braking = true;
      return true;
    case 1: // NB queued
      o.variant = 2;
      o.x = 1.75;
      o.z = 17.6;
      o.yaw = Math.PI / 2;
      o.braking = true;
      return true;
    case 2: {
      // SB driving through
      const s = (t * 8) % 60;
      o.variant = 1;
      o.x = -1.75;
      o.z = -30 + s;
      o.yaw = -Math.PI / 2;
      o.distance = t * 8;
      o.headlights = true;
      return true;
    }
    case 3: // EB waiting on the loop
      o.variant = 6;
      o.x = -10.9;
      o.z = 1.75;
      o.yaw = 0;
      o.braking = true;
      o.headlights = true;
      return true;
    case 4: // WB
      o.variant = 4;
      o.x = 11;
      o.z = -1.75;
      o.yaw = Math.PI;
      o.braking = t % 4 < 2;
      o.blinker = 'left';
      return true;
    case 5:
      o.variant = 5;
      o.x = -17.4;
      o.z = 1.75;
      o.yaw = 0;
      o.braking = true;
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Parking entry lane
// ---------------------------------------------------------------------------

function gatePos(): number {
  const t = now() % 9;
  if (t < 2) return 0;
  if (t < 3.5) return (t - 2) / 1.5;
  if (t < 7) return 1;
  if (t < 8.5) return 1 - (t - 7) / 1.5;
  return 0;
}

function EntryLane() {
  const pressed = () => now() % 9 > 1.0 && now() % 9 < 1.4;
  return (
    <group>
      <hemisphereLight args={['#dbe9ff', '#5b5147', 0.8]} />
      <directionalLight position={[8, 14, 10]} intensity={2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      <GroundSlab size={[16, 26]} kind="asphalt" position={[0, 0, 2]} />
      {/* island with the kiosk and gate */}
      <mesh position={[-2.55, 0.075, 1.2]} receiveShadow castShadow>
        <boxGeometry args={[1.1, 0.15, 5.5]} />
        <meshStandardMaterial color="#bdb9b0" roughness={0.9} />
      </mesh>
      <BarrierGate position={[-2.55, 0.15, 0]} armLength={4.3} getPosition={gatePos} rest={false} getArmLights={() => (gatePos() < 0.05 ? true : gatePos() < 0.95 ? 'flash' : false)} />
      <TicketDispenser position={[-2.6, 0.15, 2.4]} rotation={[0, Math.PI / 2, 0]} getPressed={pressed} getTicketOut={() => now() % 9 > 1.4 && now() % 9 < 3} getMessage={() => (now() % 9 > 1.4 && now() % 9 < 3.5 ? 'PLEASE TAKE\nYOUR TICKET' : now() % 9 >= 3.5 && now() % 9 < 7 ? 'WELCOME' : 'PRESS BUTTON\nFOR TICKET')} />
      <ParkingStatusSign position={[-3.4, 0, 5.6]} rotation={[0, 0.35, 0]} getOpen={() => true} getFull={() => false} />
      <InductiveLoopMarking position={[0, 0, 3.0]} rotation={[0, Math.PI / 2, 0]} length={3} width={3} leadIn={0.9} getActive={() => true} />
      <InductiveLoopMarking position={[0, 0, -2.2]} rotation={[0, Math.PI / 2, 0]} length={2.2} width={2.4} leadIn={0.8} getActive={() => gatePos() > 0.5} />
      <CarFleet
        capacity={3}
        getCar={(i, o) => {
          if (i === 0) {
            const p = gatePos();
            const t = now() % 9;
            const drive = t > 3.5 && t < 7 ? (t - 3.5) * 2.2 : 0;
            o.variant = 3;
            o.x = 0;
            o.z = 3.3 - (p >= 0.95 || (t > 3.5 && t < 7) ? drive : 0);
            o.yaw = Math.PI / 2;
            o.braking = drive === 0;
            o.headlights = true;
            o.distance = drive;
            return true;
          }
          if (i === 1) {
            o.variant = 7;
            o.x = 0;
            o.z = 10.2;
            o.yaw = Math.PI / 2;
            o.braking = true;
            return true;
          }
          return false;
        }}
      />
      {[0, 1, 2].map((k) => (
        <ParkingSpace key={k} number={k + 1} position={[3.2 + k * 2.5, 0, -6]} rotation={[0, Math.PI / 2, 0]} sides={k === 0 ? 'both' : 'right'} />
      ))}
    </group>
  );
}

export const previews: Record<string, Preview> = {
  TRAF_Intersection_Demo: {
    Component: IntersectionDemo,
    description: '4-way intersection: mast-arm poles with 12" heads, street signs, luminaires, countdown ped signals & APS buttons, loops, cars, pedestrians',
    camera: { position: [19, 13, 24], target: [0, 1.5, 0] },
  },
  PARK_Entry_Lane: {
    Component: EntryLane,
    description: 'Garage entry: barrier gate cycling, ticket dispenser, SPACES/FULL sign, detector loops, car waiting',
    camera: { position: [6.5, 3.4, 10.5], target: [-1.2, 0.8, 1.2] },
  },
};
