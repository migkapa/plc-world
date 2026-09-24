/**
 * Showroom stages: traffic signal head, pedestrian signal, parking barrier gate and ticket dispenser.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { sfx } from '../../../audio/sfx';
import type { LedMode } from '../../../twin/common';
import { BarrierGate, PedestrianPushButton, PedestrianSignal, TicketDispenser, TrafficSignalHead } from '../../../twin/devices';
import type { DemoStore } from '../demo';
import { now, useRamp } from './common';
import type { StageDef } from './types';

// ---------------------------------------------------------------------------
// Signal head
// ---------------------------------------------------------------------------

/** Demo cycle: green 5 s, yellow 3.5 s, red 5 s. */
function cycleAspect(): 'red' | 'yellow' | 'green' {
  const t = now() % 13.5;
  return t < 5 ? 'green' : t < 8.5 ? 'yellow' : 'red';
}

function lamp(demo: DemoStore, which: 'red' | 'yellow' | 'green'): LedMode {
  const a = demo.str('aspect');
  if (a === 'cycle') return cycleAspect() === which;
  if (a === 'flash-yellow') return which === 'yellow' ? 'flash' : false;
  if (a === 'flash-red') return which === 'red' ? 'flash' : false;
  return a === which;
}

function SignalHeadScene({ demo }: { demo: DemoStore }) {
  return <TrafficSignalHead position={[0, 1.3, 0]} getRed={() => lamp(demo, 'red')} getYellow={() => lamp(demo, 'yellow')} getGreen={() => lamp(demo, 'green')} />;
}

const signalHead: StageDef = {
  defaults: { aspect: 'cycle' },
  controls: [
    {
      kind: 'select',
      key: 'aspect',
      label: 'Aspect',
      options: [
        { value: 'cycle', label: 'Auto cycle' },
        { value: 'red', label: 'Red' },
        { value: 'yellow', label: 'Yellow' },
        { value: 'green', label: 'Green' },
        { value: 'flash-yellow', label: 'Flash yellow' },
        { value: 'flash-red', label: 'Flash red' },
        { value: 'dark', label: 'Dark' },
      ],
      hint: 'A dark head means all-way stop for the drivers.',
    },
  ],
  Scene: SignalHeadScene,
};

// ---------------------------------------------------------------------------
// Pedestrian signal
// ---------------------------------------------------------------------------

/** WALK 7 s, flashing hand + countdown 10 s, steady hand 8 s. */
function pedCycle(): { walk: boolean; hand: LedMode; count: number | null } {
  const t = now() % 25;
  if (t < 7) return { walk: true, hand: false, count: null };
  if (t < 17) return { walk: false, hand: 'flash', count: Math.ceil(17 - t) };
  return { walk: false, hand: true, count: null };
}

function pedState(demo: DemoStore): { walk: boolean; hand: LedMode; count: number | null } {
  switch (demo.str('phase')) {
    case 'walk':
      return { walk: true, hand: false, count: null };
    case 'clear':
      return { walk: false, hand: 'flash', count: 9 };
    case 'dontwalk':
      return { walk: false, hand: true, count: null };
    default:
      return pedCycle();
  }
}

function PedScene({ demo }: { demo: DemoStore }) {
  return (
    <group>
      <PedestrianSignal
        position={[0, 1.2, 0]}
        mount="none"
        getWalk={() => pedState(demo).walk}
        getDontWalk={() => pedState(demo).hand}
        getCountdown={() => pedState(demo).count}
      />
      <PedestrianPushButton
        position={[0, 0, 0.6]}
        getPressed={() => demo.bool('button')}
        getLit={() => demo.bool('call')}
        onPress={() => {
          demo.patch({ button: true, call: true });
          sfx.play('beep');
        }}
        onRelease={() => demo.set('button', false)}
      />
    </group>
  );
}

const ped: StageDef = {
  defaults: { phase: 'cycle', button: false, call: false },
  controls: [
    {
      kind: 'select',
      key: 'phase',
      label: 'Phase',
      options: [
        { value: 'cycle', label: 'Auto cycle' },
        { value: 'walk', label: 'WALK' },
        { value: 'clear', label: 'Flashing hand' },
        { value: 'dontwalk', label: 'DON’T WALK' },
      ],
    },
    { kind: 'momentary', key: 'button', label: 'Push button (Ped_PB)', tone: 'neutral' },
    { kind: 'readout', label: 'Pedestrian call (latched in logic)', value: (d) => (d.bool('call') ? 'CALL waiting → serve at the next cycle' : 'no call'), tone: (d) => (d.bool('call') ? 'amber' : 'neutral') },
    { kind: 'action', label: 'Clear call', run: (d) => d.set('call', false), disabled: (d) => !d.bool('call') },
  ],
  Scene: PedScene,
};

// ---------------------------------------------------------------------------
// Barrier gate
// ---------------------------------------------------------------------------

function GateScene({ demo }: { demo: DemoStore }) {
  const pos = useRamp(() => (demo.bool('up') ? 1 : 0), 1 / 1.5, demo, 'pos');
  return (
    <BarrierGate
      getPosition={pos}
      rest
      getArmLights={() => {
        const p = pos();
        return p > 0.001 && p < 0.999 ? 'flash' : p <= 0.001;
      }}
    />
  );
}

const gate: StageDef = {
  defaults: { up: false, pos: 0 },
  controls: [
    { kind: 'toggle', key: 'up', label: 'Entry_Gate_Up (output)', tone: 'green', hint: 'Raises while on, lowers when off.' },
    { kind: 'readout', label: 'Arm position', value: (d) => `${Math.round(d.num('pos') * 100)} % ${d.num('pos') >= 0.9 ? '· car may pass' : ''}`, tone: (d) => (d.num('pos') >= 0.9 ? 'green' : d.num('pos') > 0 ? 'amber' : 'red') },
  ],
  Scene: GateScene,
};

// ---------------------------------------------------------------------------
// Ticket dispenser
// ---------------------------------------------------------------------------

function KioskScene({ demo }: { demo: DemoStore }) {
  const ticketUntil = useRef(0);
  useFrame(() => {
    const out = now() < ticketUntil.current;
    if (demo.bool('ticket') !== out) demo.set('ticket', out);
  });
  return (
    <TicketDispenser
      getPressed={() => demo.bool('press')}
      onPress={() => {
        demo.set('press', true);
        sfx.play('press');
      }}
      onRelease={() => {
        demo.set('press', false);
        if (now() > ticketUntil.current) ticketUntil.current = now() + 2.5;
      }}
      getTicketOut={() => demo.bool('ticket')}
      getMessage={() => (demo.bool('ticket') ? 'PLEASE TAKE\nYOUR TICKET' : 'PRESS BUTTON\nFOR TICKET')}
    />
  );
}

const kiosk: StageDef = {
  defaults: { press: false, ticket: false },
  controls: [
    { kind: 'momentary', key: 'press', label: 'PRESS', tone: 'green', hint: 'Press it in 3D too.' },
    { kind: 'readout', label: 'Ticket_PB (N.O.)', value: (d) => (d.bool('press') ? '1' : '0'), tone: (d) => (d.bool('press') ? 'green' : 'neutral') },
    { kind: 'readout', label: 'Ticket', value: (d) => (d.bool('ticket') ? 'presented — the PLC may raise the gate' : '—'), tone: (d) => (d.bool('ticket') ? 'green' : 'neutral') },
  ],
  Scene: KioskScene,
};

export const TRAFFIC_STAGES: Record<string, StageDef> = {
  'signal-head': signalHead,
  'ped-signal': ped,
  'barrier-gate': gate,
  'ticket-kiosk': kiosk,
};
