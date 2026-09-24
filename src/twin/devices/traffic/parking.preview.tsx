import type { Preview } from '../../../dev/gallery';
import { BarrierGate } from './BarrierGate';
import { InductiveLoopMarking } from './InductiveLoopMarking';
import { LedSign, ParkingStatusSign } from './LedSign';
import { TicketDispenser } from './TicketDispenser';

const now = () => performance.now() / 1000;
/** 0..1..0 raise/lower cycle with dwell: up 1.5 s, hold 2 s, down 1.5 s, hold 2 s. */
function gateCycle(offset = 0): number {
  const t = (now() + offset) % 7;
  if (t < 1.5) return t / 1.5;
  if (t < 3.5) return 1;
  if (t < 5) return 1 - (t - 3.5) / 1.5;
  return 0;
}

function GateRaising() {
  return (
    <group>
      <BarrierGate getPosition={() => gateCycle()} rest getArmLights={() => (gateCycle() > 0 && gateCycle() < 1 ? 'flash' : gateCycle() === 0)} />
      <BarrierGate position={[0, 0, -1.6]} side="left" housingColor="#d8d9d6" getPosition={() => 0.45} />
    </group>
  );
}

function KioskDemo() {
  const pressed = () => now() % 3 < 0.4;
  return (
    <group>
      <TicketDispenser getPressed={pressed} getTicketOut={() => now() % 3 > 0.6 && now() % 3 < 2.6} getMessage={() => (now() % 3 > 0.6 ? 'PLEASE TAKE\nYOUR TICKET' : 'PRESS BUTTON\nFOR TICKET')} />
    </group>
  );
}

function SignsDemo() {
  return (
    <group>
      <LedSign text="SPACES" color="green" getLit={() => true} mount="none" position={[-0.45, 0.3, 0]} />
      <LedSign text="FULL" color="red" getLit={() => 'flash'} minCols={37} mount="none" position={[0.45, 0.3, 0]} />
      <ParkingStatusSign position={[0, 0, -0.8]} getFull={() => false} getOpen={() => true} mount="post" mountLength={0.1} />
      <InductiveLoopMarking position={[0, 0.001, 1.2]} length={2.4} width={1.6} getActive={() => now() % 2 < 1} />
    </group>
  );
}

export const previews: Record<string, Preview> = {
  PARK_Gate_Raising: {
    Component: GateRaising,
    description: 'Barrier gate cycling up/down (arm lights, rest post) + a second gate half open',
    camera: { position: [2.6, 1.9, 4.6], target: [1.4, 0.9, -0.4] },
  },
  PARK_TicketDispenser: {
    Component: KioskDemo,
    description: 'Entry ticket dispenser: button press, ticket ejects, message changes',
    camera: { position: [0.7, 1.35, 1.4], target: [0, 1.0, 0] },
  },
  PARK_Signs: {
    Component: SignsDemo,
    description: 'LED dot-matrix signs SPACES / FULL, garage status sign, detector loop',
    camera: { position: [0.3, 1.2, 3.4], target: [0, 0.5, 0] },
  },
};
