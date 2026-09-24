/**
 * Showroom stages: 800F operators (push buttons, E-stop, selector, pilot lights) and the stack light.
 */
import { sfx } from '../../../audio/sfx';
import type { LedColor } from '../../../twin/common';
import { EStop800FM, PilotLight800F, PushButton800F, PushButtonStation, SelectorSwitch800F, StackLight856T } from '../../../twin/devices';
import { useDemoVersion, type DemoControl, type DemoStore } from '../demo';
import { Backplate } from './common';
import type { StageDef } from './types';

const PANEL = '#d6d8d6';

const press = (d: DemoStore, key: string) => () => {
  d.set(key, true);
  sfx.play('press');
};
const release = (d: DemoStore, key: string) => () => {
  d.set(key, false);
  sfx.play('release');
};

// ---------------------------------------------------------------------------
// Push buttons
// ---------------------------------------------------------------------------

function PushButtonsScene({ demo }: { demo: DemoStore }) {
  return (
    <group>
      <Backplate w={0.36} h={0.12} center={[0, 0, 0]} color={PANEL} metal={false} />
      <PushButton800F position={[-0.15, -0.01, 0]} color="green" legend="START" contact="N.O." getPressed={() => demo.bool('start')} onPress={press(demo, 'start')} onRelease={release(demo, 'start')} />
      <PushButton800F position={[-0.1, -0.01, 0]} color="red" style="extended" legend="STOP" contact="N.C." getPressed={() => demo.bool('stop')} onPress={press(demo, 'stop')} onRelease={release(demo, 'stop')} />
      <PushButton800F position={[-0.05, -0.01, 0]} color="black" legend="JOG" guard getPressed={() => demo.bool('jog')} onPress={press(demo, 'jog')} onRelease={release(demo, 'jog')} />
      <PushButton800F position={[0, -0.01, 0]} color="amber" legend="RESET" getPressed={() => demo.bool('reset')} getLit={() => demo.bool('resetLamp')} onPress={press(demo, 'reset')} onRelease={release(demo, 'reset')} />
      <PushButton800F position={[0.155, -0.012, 0]} color="red" style="mushroom" legend="STOP" contact="N.C." getPressed={() => demo.bool('mushroom')} onPress={press(demo, 'mushroom')} onRelease={release(demo, 'mushroom')} />
    </group>
  );
}

const input = (label: string, key: string, nc: boolean): DemoControl => ({
  kind: 'readout',
  label,
  value: (d) => {
    const pressed = d.bool(key);
    const bit = nc ? !pressed : pressed;
    return `${nc ? 'N.C.' : 'N.O.'} contact ${bit ? 'closed' : 'open'} → input = ${bit ? 1 : 0}`;
  },
  tone: (d) => ((nc ? !d.bool(key) : d.bool(key)) ? 'green' : 'neutral'),
});

const pushButtons: StageDef = {
  defaults: { start: false, stop: false, jog: false, reset: false, mushroom: false, resetLamp: true },
  controls: [
    { kind: 'momentary', key: 'start', label: 'START', tone: 'green', hint: 'Hold to keep it pressed (or press it in 3D).' },
    { kind: 'momentary', key: 'stop', label: 'STOP', tone: 'red' },
    { kind: 'momentary', key: 'jog', label: 'JOG', tone: 'neutral' },
    { kind: 'momentary', key: 'reset', label: 'RESET', tone: 'amber' },
    input('Start_PB (800F-X10)', 'start', false),
    input('Stop_PB (800F-X01)', 'stop', true),
    { kind: 'toggle', key: 'resetLamp', label: 'RESET lamp (output)', tone: 'amber' },
  ],
  Scene: PushButtonsScene,
  floor: -0.06,
};

// ---------------------------------------------------------------------------
// E-stop
// ---------------------------------------------------------------------------

function EStopScene({ demo }: { demo: DemoStore }) {
  return (
    <PushButtonStation holes={1} color="yellow" pitch={0.082} width={0.084} centered>
      <EStop800FM
        getEngaged={() => demo.bool('engaged')}
        onToggle={() => {
          demo.toggle('engaged');
          sfx.play(demo.bool('engaged') ? 'press' : 'release');
        }}
      />
    </PushButtonStation>
  );
}

const estop: StageDef = {
  defaults: { engaged: false },
  controls: [
    {
      kind: 'action',
      label: 'Push E-stop',
      tone: 'red',
      run: (d) => {
        d.set('engaged', true);
        sfx.play('press');
      },
      disabled: (d) => d.bool('engaged'),
    },
    {
      kind: 'action',
      label: 'Twist to release',
      tone: 'neutral',
      run: (d) => {
        d.set('engaged', false);
        sfx.play('release');
      },
      disabled: (d) => !d.bool('engaged'),
    },
    {
      kind: 'readout',
      label: 'EStop_OK (N.C. contacts)',
      value: (d) => (d.bool('engaged') ? 'contacts open → 0 · machine stopped' : 'contacts closed → 1 · healthy'),
      tone: (d) => (d.bool('engaged') ? 'red' : 'green'),
    },
    {
      kind: 'readout',
      label: 'After release',
      value: (d) => (d.bool('engaged') ? 'Latched until twisted out' : 'Still stopped — a new START press is required'),
      tone: () => 'amber',
    },
  ],
  Scene: EStopScene,
};

// ---------------------------------------------------------------------------
// Selector switch
// ---------------------------------------------------------------------------

const HOA = ['HAND', 'OFF', 'AUTO'];

function SelectorScene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  const turn = (key: string) => (i: number) => {
    demo.set(key, String(i));
    sfx.play('toggle');
  };
  return (
    <group>
      <Backplate w={0.2} h={0.1} center={[0, 0.008, 0]} color={PANEL} metal={false} />
      <SelectorSwitch800F position={[-0.06, 0, 0]} positions={HOA} getPosition={() => Number(demo.str('hoa'))} onChange={turn('hoa')} />
      <SelectorSwitch800F position={[0, 0, 0]} positions={HOA} knob="long-lever" legend="MODE" getPosition={() => Number(demo.str('lever'))} onChange={turn('lever')} />
      <SelectorSwitch800F position={[0.06, 0, 0]} positions={['OFF', 'ON']} bezel="plastic" color="black" getPosition={() => Number(demo.str('two'))} onChange={turn('two')} />
    </group>
  );
}

const selector: StageDef = {
  defaults: { hoa: '1', lever: '2', two: '0' },
  controls: [
    { kind: 'select', key: 'hoa', label: 'HOA selector', options: HOA.map((p, i) => ({ value: String(i), label: p })) },
    {
      kind: 'readout',
      label: 'HOA_Hand · HOA_Auto',
      value: (d) => `${d.str('hoa') === '0' ? 1 : 0} · ${d.str('hoa') === '2' ? 1 : 0}`,
      tone: (d) => (d.str('hoa') === '1' ? 'neutral' : 'green'),
    },
    { kind: 'select', key: 'lever', label: 'Long lever', options: HOA.map((p, i) => ({ value: String(i), label: p })) },
    {
      kind: 'select',
      key: 'two',
      label: '2-position',
      options: [
        { value: '0', label: 'OFF' },
        { value: '1', label: 'ON' },
      ],
    },
  ],
  Scene: SelectorScene,
  floor: -0.042,
};

// ---------------------------------------------------------------------------
// Pilot lights
// ---------------------------------------------------------------------------

const LAMPS: Array<{ key: string; color: LedColor; legend: string }> = [
  { key: 'run', color: 'green', legend: 'RUN' },
  { key: 'fault', color: 'red', legend: 'FAULT' },
  { key: 'warn', color: 'amber', legend: 'WARNING' },
  { key: 'reset', color: 'blue', legend: 'RESET' },
  { key: 'power', color: 'white', legend: 'POWER' },
];

function PilotScene({ demo }: { demo: DemoStore }) {
  return (
    <group>
      <Backplate w={0.3} h={0.1} center={[0, 0.008, 0]} color={PANEL} metal={false} />
      {LAMPS.map((l, i) => (
        <PilotLight800F key={l.key} position={[-0.1 + i * 0.05, 0, 0]} color={l.color} legend={l.legend} getLit={() => demo.bool('test') || demo.bool(l.key)} />
      ))}
    </group>
  );
}

const pilots: StageDef = {
  defaults: { run: true, fault: false, warn: false, reset: false, power: true, test: false },
  controls: [
    { kind: 'toggle', key: 'run', label: 'RUN (green)', tone: 'green' },
    { kind: 'toggle', key: 'fault', label: 'FAULT (red)', tone: 'red' },
    { kind: 'toggle', key: 'warn', label: 'WARNING (amber)', tone: 'amber' },
    { kind: 'toggle', key: 'reset', label: 'RESET (blue)', tone: 'blue' },
    { kind: 'toggle', key: 'power', label: 'POWER (white)', tone: 'neutral' },
    { kind: 'momentary', key: 'test', label: 'Lamp test', tone: 'neutral', hint: 'All lamps on while held — finds dead LEDs.' },
  ],
  Scene: PilotScene,
  floor: -0.042,
};

// ---------------------------------------------------------------------------
// Stack light
// ---------------------------------------------------------------------------

const TIERS: LedColor[] = ['red', 'amber', 'green'];

function StackScene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  const series = demo.str('series') === '856T' ? '856T' : '855T';
  return (
    <group>
      <StackLight856T
        key={series}
        series={series}
        tiers={TIERS}
        getTier={(i) => demo.bit('tiers', i)}
        getFlashing={(i) => i === 1 && demo.bool('flash')}
        getHorn={() => demo.bool('horn')}
        showSoundFx
      />
    </group>
  );
}

const stack: StageDef = {
  defaults: { series: '855T', tiers: [false, false, true], flash: true, horn: false },
  controls: [
    { kind: 'points', key: 'tiers', label: 'Tiers (top → bottom): red · amber · green', count: 3, prefix: 'T' },
    { kind: 'toggle', key: 'flash', label: 'Amber flashing', tone: 'amber' },
    { kind: 'toggle', key: 'horn', label: 'Sounder', tone: 'red' },
    {
      kind: 'select',
      key: 'series',
      label: 'Series',
      options: [
        { value: '855T', label: '855T (legacy)' },
        { value: '856T', label: '856T (current)' },
      ],
    },
  ],
  Scene: StackScene,
};

export const OPERATOR_STAGES: Record<string, StageDef> = {
  'push-buttons-800f': pushButtons,
  'estop-800fm': estop,
  'selector-800f': selector,
  'pilot-lights-800f': pilots,
  'stack-light-855t': stack,
};
