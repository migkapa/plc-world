/**
 * Showroom stages: control-panel components on a galvanised subpanel with a DIN rail.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { sfx } from '../../../audio/sfx';
import { CircuitBreaker1489, CONTACTOR_100C, Contactor100C, DinRail, MotorStarter, PowerSupply1606, TB_COLORS, TerminalBlocks1492 } from '../../../twin/devices';
import { useDemoVersion, type DemoStore } from '../demo';
import { Backplate } from './common';
import type { StageDef } from './types';

/** Play the contactor "clack" whenever a boolean demo value changes. */
function useClack(demo: DemoStore, get: () => boolean) {
  const prev = useRef(get());
  useDemoVersion(demo);
  const v = get();
  useEffect(() => {
    if (prev.current !== v) sfx.play('contactor');
    prev.current = v;
  }, [v]);
}

// ---------------------------------------------------------------------------
// Contactor
// ---------------------------------------------------------------------------

function ContactorScene({ demo }: { demo: DemoStore }) {
  useClack(demo, () => demo.bool('coil'));
  return (
    <group>
      <Backplate w={0.22} h={0.2} center={[0, 0, 0]} />
      <DinRail length={0.18} position={[0, 0, 0]}>
        <Contactor100C catalog="100-C09" getEnergized={() => demo.bool('coil')} />
      </DinRail>
    </group>
  );
}

const contactor: StageDef = {
  defaults: { coil: false },
  controls: [
    { kind: 'toggle', key: 'coil', label: 'Coil A1–A2 (Motor_Starter)', tone: 'green', hint: 'The armature pulls in and the window shows “I”.' },
    { kind: 'readout', label: 'Main poles L1-T1 · L2-T2 · L3-T3', value: (d) => (d.bool('coil') ? 'CLOSED — motor connected' : 'OPEN'), tone: (d) => (d.bool('coil') ? 'green' : 'neutral') },
    { kind: 'readout', label: 'Aux 13-14 (N.O.) → Motor_Aux', value: (d) => (d.bool('coil') ? 'closed → 1' : 'open → 0'), tone: (d) => (d.bool('coil') ? 'green' : 'neutral') },
  ],
  Scene: ContactorScene,
  floor: false,
};

// ---------------------------------------------------------------------------
// Overload relay (motor starter)
// ---------------------------------------------------------------------------

/** E100 trip rating: the relay eventually trips at 120 % of its FLA dial setting, never below it. */
const TRIP_RATING = 1.2;

/** Thermal model: heats with (I/FLA)² − 1.2² while current flows (cools below the trip rating); sped-up demo time. */
function OverloadScene({ demo }: { demo: DemoStore }) {
  useClack(demo, () => demo.bool('coil') && !demo.bool('tripped'));
  const heat = useRef(0);
  const last = useRef(0);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const flowing = demo.bool('coil') && !demo.bool('tripped');
    const i = flowing ? demo.num('load') / 100 : 0;
    heat.current = Math.max(0, heat.current + (flowing ? Math.max(i * i - TRIP_RATING * TRIP_RATING, -0.2) / 12 : -0.12) * dt);
    if (heat.current >= 1 && !demo.bool('tripped')) {
      demo.set('tripped', true);
      sfx.play('fault');
    }
    const n = performance.now();
    if (n - last.current > 150) {
      last.current = n;
      const pct = Math.round(Math.min(1, heat.current) * 100);
      if (demo.num('heat') !== pct) demo.set('heat', pct);
    }
  });
  return (
    <group>
      <Backplate w={0.22} h={0.26} center={[0, -0.02, 0]} />
      <DinRail length={0.18} position={[0, CONTACTOR_100C.h / 2 + 0.0005, 0]}>
        <MotorStarter
          getEnergized={() => demo.bool('coil') && !demo.bool('tripped')}
          getTripped={() => demo.bool('tripped')}
          onReset={() => {
            if (demo.bool('tripped') && heat.current < 0.25) {
              demo.set('tripped', false);
              sfx.play('click');
            } else sfx.play('fail');
          }}
        />
      </DinRail>
    </group>
  );
}

const overload: StageDef = {
  defaults: { coil: true, load: 100, tripped: false, heat: 0 },
  controls: [
    { kind: 'toggle', key: 'coil', label: 'Contactor coil (run)', tone: 'green' },
    { kind: 'slider', key: 'load', label: 'Motor current', min: 50, max: 250, step: 5, unit: '% FLA', hint: 'The E100 trips at ≈ 120 % of its FLA setting — more current, faster trip (demo time is sped up).' },
    { kind: 'readout', label: 'Thermal memory', value: (d) => `${d.num('heat')} %`, tone: (d) => (d.num('heat') > 70 ? 'red' : d.num('heat') > 30 ? 'amber' : 'green') },
    { kind: 'readout', label: '95-96 (N.C.) → OL_OK', value: (d) => (d.bool('tripped') ? 'OPEN → 0 · TRIPPED' : 'closed → 1'), tone: (d) => (d.bool('tripped') ? 'red' : 'green') },
    {
      kind: 'action',
      label: 'Press TEST (trip)',
      tone: 'red',
      run: (d) => {
        d.set('tripped', true);
        sfx.play('fault');
      },
      disabled: (d) => d.bool('tripped'),
    },
    {
      kind: 'action',
      label: 'TRIP/RESET',
      tone: 'blue',
      run: (d) => {
        if (d.num('heat') < 25) d.set('tripped', false);
        else sfx.play('fail');
      },
      disabled: (d) => !d.bool('tripped'),
      hint: 'Only resets once the thermal memory has cooled (< 25 %).',
    },
  ],
  Scene: OverloadScene,
  floor: false,
};

// ---------------------------------------------------------------------------
// Circuit breakers
// ---------------------------------------------------------------------------

function BreakerScene({ demo }: { demo: DemoStore }) {
  const flip = (key: string) => () => {
    demo.toggle(key);
    sfx.play('toggle');
  };
  return (
    <group>
      <Backplate w={0.2} h={0.16} center={[0, 0, 0]} />
      <DinRail length={0.16} position={[0, 0, 0]}>
        <CircuitBreaker1489 poles={1} rating="C2" position={[-0.045, 0, 0]} getOn={() => demo.bool('b1')} onToggle={flip('b1')} />
        <CircuitBreaker1489 poles={2} rating="C10" position={[-0.017, 0, 0]} getOn={() => demo.bool('b2')} onToggle={flip('b2')} />
        <CircuitBreaker1489 poles={3} rating="C16" position={[0.031, 0, 0]} getOn={() => demo.bool('b3')} onToggle={flip('b3')} />
      </DinRail>
    </group>
  );
}

const breakers: StageDef = {
  defaults: { b1: true, b2: true, b3: true },
  controls: [
    { kind: 'toggle', key: 'b1', label: '1-pole C2 (control power)', tone: 'green' },
    { kind: 'toggle', key: 'b2', label: '2-pole C10 (24 V PSU feed)', tone: 'green' },
    { kind: 'toggle', key: 'b3', label: '3-pole C16 (motor branch)', tone: 'green' },
    {
      kind: 'action',
      label: 'Short circuit on the 3-pole branch',
      tone: 'red',
      run: (d) => {
        d.set('b3', false);
        sfx.play('fault');
      },
      disabled: (d) => !d.bool('b3'),
      hint: 'All three poles trip together (common trip).',
    },
  ],
  Scene: BreakerScene,
  floor: false,
};

// ---------------------------------------------------------------------------
// 1606 power supply
// ---------------------------------------------------------------------------

function PsuScene({ demo }: { demo: DemoStore }) {
  return (
    <group>
      <Backplate w={0.2} h={0.2} center={[0, 0, 0]} />
      <DinRail length={0.16} position={[0, 0, 0]}>
        <PowerSupply1606 getOk={() => demo.bool('mains') && !demo.bool('short')} getOverload={() => demo.bool('mains') && demo.bool('short')} />
      </DinRail>
    </group>
  );
}

const psu: StageDef = {
  defaults: { mains: true, short: false },
  controls: [
    { kind: 'toggle', key: 'mains', label: 'Mains input (L/N)', tone: 'green' },
    { kind: 'toggle', key: 'short', label: 'Short circuit on 24 V', tone: 'red' },
    {
      kind: 'readout',
      label: 'Output · DC-OK contact 13-14',
      value: (d) => (!d.bool('mains') ? '0 V · open' : d.bool('short') ? 'current limited, voltage collapses · open' : '24.0 V DC · closed'),
      tone: (d) => (d.bool('mains') && !d.bool('short') ? 'green' : 'red'),
    },
  ],
  Scene: PsuScene,
  floor: false,
};

// ---------------------------------------------------------------------------
// 1492 terminal blocks
// ---------------------------------------------------------------------------

const TB_COUNT = 12;

function TerminalScene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  const power = demo.str('scheme') === 'power';
  const colors = Array.from({ length: TB_COUNT }, (_, i) => (i >= TB_COUNT - 2 ? TB_COLORS.green : power && i >= 5 ? TB_COLORS.blue : TB_COLORS.gray));
  const labels = Array.from({ length: TB_COUNT }, (_, i) => (i >= TB_COUNT - 2 ? 'PE' : power ? (i < 5 ? '+24' : '0V') : String(i + 1)));
  return (
    <group>
      <Backplate w={0.14} h={0.12} center={[0, 0, 0]} />
      <DinRail length={0.12} position={[0, 0, 0]}>
        <TerminalBlocks1492 key={demo.str('scheme')} count={TB_COUNT} colors={colors} labels={labels} />
      </DinRail>
    </group>
  );
}

const terminals: StageDef = {
  defaults: { scheme: 'signals' },
  controls: [
    {
      kind: 'select',
      key: 'scheme',
      label: 'Strip layout',
      options: [
        { value: 'signals', label: 'Signals 1–10 + PE' },
        { value: 'power', label: '+24 V / 0 V + PE' },
      ],
    },
  ],
  Scene: TerminalScene,
  floor: false,
};

export const PANEL_STAGES: Record<string, StageDef> = {
  'contactor-100c': contactor,
  'overload-193e': overload,
  'breaker-1489': breakers,
  '1606-xls': psu,
  'terminal-1492': terminals,
};
