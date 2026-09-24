/**
 * Showroom stages: ControlLogix, CompactLogix 5380, PowerFlex 525 and PanelView 5310.
 */
import { useMemo } from 'react';
import { sfx } from '../../../audio/sfx';
import type { LedColor, LedMode } from '../../../twin/common';
import type { RackLive } from '../../../twin/contracts';
import {
  AnalogModule1756,
  Comm1756,
  CompactLogix5380Controller,
  Controller1756L8,
  ControlLogixRack,
  DigitalModule1756,
  Module5069,
  PanelView5310,
  PowerFlex525,
  PowerSupply1756,
  type StatusLedState1756,
} from '../../../twin/devices';
import { staticRackLive } from '../../../twin/live';
import type { ControllerStatus, HardwareConfig, KeySwitch } from '../../../plc/types';
import { useDemoVersion, type DemoControl, type DemoStore } from '../demo';
import { Backplate, DisplayStand, useRamp } from './common';
import { clearMajors, isRunning, simulateMajorFault, turnKey } from './controllerMode';
import type { StageDef } from './types';

const RACK_Y = 0.05;
const MOD_Y = 0.11;
const CPX_Y = 0.1;

// ---------------------------------------------------------------------------
// Controller status driven by the demo panel
// ---------------------------------------------------------------------------

function statusOf(d: DemoStore): Partial<ControllerStatus> {
  const key = (d.str('key') || 'REM') as KeySwitch;
  const faulted = d.bool('faulted');
  const running = isRunning(d);
  const forces = d.str('forces');
  return {
    mode: faulted ? 'FAULTED' : key === 'REM' ? (running ? 'REM_RUN' : 'REM_PROG') : running ? 'RUN' : 'PROG',
    keySwitch: key,
    running,
    ok: faulted ? 'flashing-red' : 'green',
    runLed: running ? 'green' : 'off',
    forceLed: forces === 'enabled' ? 'amber' : forces === 'installed' ? 'flashing-amber' : 'off',
    forcesInstalled: forces !== 'none',
    forcesEnabled: forces === 'enabled',
    ioLed: 'green',
    displayText: faulted ? 'Major Fault T04:C20' : key === 'REM' ? (running ? 'Rem Run' : 'Rem Prog') : running ? 'Run' : 'Prog',
  };
}

/** A staticRackLive rebuilt whenever the mode-related demo values change (points are read live). */
function useDemoLive(d: DemoStore, point?: (slot: number, i: number) => boolean): RackLive {
  useDemoVersion(d);
  const key = d.str('key');
  const faulted = d.bool('faulted');
  const forces = d.str('forces');
  const remote = d.bool('remoteRun');
  return useMemo(
    () => staticRackLive({ status: statusOf(d), point, onKeySwitch: (pos) => turnKey(d, pos) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, faulted, forces, remote],
  );
}

const CONTROLLER_DEFAULTS = { key: 'REM', remoteRun: true, faulted: false, faultTrail: '', forces: 'none' };

const controllerControls = (keyLabel: string): DemoControl[] => [
  {
    kind: 'select',
    key: 'key',
    label: keyLabel,
    options: [
      { value: 'RUN', label: 'RUN' },
      { value: 'REM', label: 'REM' },
      { value: 'PROG', label: 'PROG' },
    ],
    onSet: turnKey,
    hint: 'Click the key in 3D too. REM keeps the current mode. Faulted? PROG → RUN → PROG clears it.',
  },
  {
    kind: 'select',
    key: 'remoteRun',
    label: 'Remote mode (software)',
    options: [
      { value: 'run', label: 'Rem Run' },
      { value: 'prog', label: 'Rem Prog' },
    ],
    value: (d) => (d.str('key') !== 'REM' ? '' : d.bool('remoteRun') ? 'run' : 'prog'),
    onSet: (d, v) => {
      if (d.str('key') !== 'REM' || d.bool('faulted')) return;
      d.set('remoteRun', v === 'run');
      sfx.play('click');
    },
    disabled: (d) => d.str('key') !== 'REM' || d.bool('faulted'),
    hint: 'Only works with the key in REM — like changing mode online from Studio 5000.',
  },
  {
    kind: 'select',
    key: 'forces',
    label: 'I/O forces',
    options: [
      { value: 'none', label: 'None' },
      { value: 'installed', label: 'Installed' },
      { value: 'enabled', label: 'Enabled' },
    ],
    hint: 'Watch the FORCE indicator: flashing = installed, steady = enabled.',
  },
  {
    kind: 'action',
    label: 'Simulate major fault',
    tone: 'red',
    run: simulateMajorFault,
    disabled: (d) => d.bool('faulted') || !isRunning(d),
    hint: 'T04:C20 — array subscript out of range. Only running logic can fault, so put the controller in Run first.',
  },
  {
    kind: 'action',
    label: 'Clear Majors',
    tone: 'green',
    run: (d) => {
      clearMajors(d);
      sfx.play('click');
    },
    disabled: (d) => !d.bool('faulted'),
    hint: 'Key in REM → Remote Program. Key in RUN → it runs again straight away (fix the cause first!).',
  },
];

// ---------------------------------------------------------------------------
// ControlLogix rack
// ---------------------------------------------------------------------------

const TRAINER_HW: HardwareConfig = {
  platform: 'ControlLogix',
  chassis: '1756-A7',
  powerSupply: '1756-PA72',
  modules: [
    { slot: 0, catalog: '1756-L85E', name: 'PLC' },
    { slot: 1, catalog: '1756-IB16', name: 'DI_Bench' },
    { slot: 2, catalog: '1756-OB16E', name: 'DO_Bench' },
    { slot: 3, catalog: '1756-IF8', name: 'AI_Bench' },
    { slot: 4, catalog: '1756-OF8', name: 'AO_Bench' },
    { slot: 5, catalog: '1756-EN2T', name: 'ENET' },
  ],
};

function RackScene({ demo }: { demo: DemoStore }) {
  const live = useDemoLive(demo, (slot, i) => {
    if (slot === 1) return demo.bit('inputs', i);
    if (slot === 2) return isRunning(demo) && demo.bit('inputs', i);
    return false;
  });
  return (
    <group>
      <DisplayStand w={0.5} top={RACK_Y + 0.2} />
      <ControlLogixRack hardware={TRAINER_HW} live={live} doorsOpen={demo.bool('doors')} wired={demo.bool('doors')} position={[0, RACK_Y, 0]} />
    </group>
  );
}

const bits = (on: number[], n = 16) => Array.from({ length: n }, (_, i) => on.includes(i));

const rack: StageDef = {
  defaults: { ...CONTROLLER_DEFAULTS, inputs: bits([0, 3, 8]), doors: false },
  controls: [
    ...controllerControls('Key switch (slot 0)'),
    { kind: 'points', key: 'inputs', label: 'Slot 1 inputs · Local:1:I.Data', count: 16, hint: 'Demo program: slot 2 outputs copy the inputs while the controller runs.' },
    { kind: 'toggle', key: 'doors', label: 'RTB doors open' },
  ],
  Scene: RackScene,
};

// ---------------------------------------------------------------------------
// 1756-L85E
// ---------------------------------------------------------------------------

function L85EScene({ demo }: { demo: DemoStore }) {
  const live = useDemoLive(demo);
  const cable = demo.bool('cable');
  return (
    <group>
      <DisplayStand w={0.1} top={MOD_Y + 0.165} />
      <Controller1756L8
        catalog="1756-L85E"
        position={[0, MOD_Y, 0]}
        getStatus={live.status}
        onKeySwitch={live.setKeySwitch}
        cable={cable}
        getLink={cable ? undefined : () => 'off'}
      />
    </group>
  );
}

const l85e: StageDef = {
  defaults: { ...CONTROLLER_DEFAULTS, cable: true },
  controls: [...controllerControls('Key switch'), { kind: 'toggle', key: 'cable', label: 'Ethernet cable plugged in', hint: 'Unplug it: LINK goes dark.' }],
  Scene: L85EScene,
};

// ---------------------------------------------------------------------------
// 1756-PA72
// ---------------------------------------------------------------------------

function PA72Scene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  return (
    <group>
      <DisplayStand w={0.16} top={MOD_Y + 0.165} />
      <PowerSupply1756 catalog="1756-PA72" position={[0, MOD_Y, 0]} getPowered={() => demo.bool('mains')} doorOpen={demo.bool('door')} wired={demo.bool('door')} />
    </group>
  );
}

const pa72: StageDef = {
  defaults: { mains: true, door: false },
  controls: [
    { kind: 'toggle', key: 'mains', label: 'Mains 120 V AC', tone: 'green', hint: 'The POWER indicator follows the supply.' },
    { kind: 'toggle', key: 'door', label: 'Terminal cover open' },
  ],
  Scene: PA72Scene,
};

// ---------------------------------------------------------------------------
// 1756 I/O modules
// ---------------------------------------------------------------------------

const INPUT_CONN = [
  { value: 'ok', label: 'Connected' },
  { value: 'noconn', label: 'No connection' },
  { value: 'timeout', label: 'Timed out' },
  { value: 'fault', label: 'HW fault' },
];
const OUTPUT_CONN = [
  { value: 'run', label: 'Controller Run' },
  { value: 'prog', label: 'Controller Prog' },
  { value: 'timeout', label: 'Timed out' },
  { value: 'fault', label: 'HW fault' },
];

function okState(conn: string): StatusLedState1756 {
  switch (conn) {
    case 'ok':
    case 'run':
      return 'green';
    case 'noconn':
    case 'prog':
      return 'flashing-green';
    case 'timeout':
      return 'flashing-red';
    default:
      return 'red';
  }
}

function IB16Scene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  const conn = demo.str('conn');
  return (
    <group>
      <DisplayStand w={0.1} top={MOD_Y + 0.165} />
      <DigitalModule1756
        catalog="1756-IB16"
        position={[0, MOD_Y, 0]}
        getPoint={(i) => demo.bit('points', i)}
        getOk={() => okState(conn)}
        doorOpen={demo.bool('door')}
        wired={demo.bool('door')}
      />
    </group>
  );
}

const ib16: StageDef = {
  defaults: { points: bits([0, 2, 9]), conn: 'ok', door: false },
  controls: [
    { kind: 'points', key: 'points', label: 'Field inputs · Local:1:I.Data', count: 16, hint: 'Apply 24 V to a terminal: its ST indicator lights.' },
    { kind: 'select', key: 'conn', label: 'Connection (OK LED)', options: INPUT_CONN },
    { kind: 'toggle', key: 'door', label: 'RTB door open' },
  ],
  Scene: IB16Scene,
};

function OB16EScene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  const conn = demo.str('conn');
  const active = conn === 'run';
  return (
    <group>
      <DisplayStand w={0.1} top={MOD_Y + 0.165} />
      <DigitalModule1756
        catalog="1756-OB16E"
        position={[0, MOD_Y, 0]}
        getPoint={(i) => active && demo.bit('points', i) && !demo.bool(i < 8 ? 'fuse0' : 'fuse1')}
        getFuse={(g) => demo.bool(g === 0 ? 'fuse0' : 'fuse1')}
        getOk={() => okState(conn)}
        doorOpen={demo.bool('door')}
        wired={demo.bool('door')}
      />
    </group>
  );
}

const ob16e: StageDef = {
  defaults: { points: bits([1, 4, 5, 12]), conn: 'run', fuse0: false, fuse1: false, door: false },
  controls: [
    { kind: 'points', key: 'points', label: 'Output bits · Local:2:O.Data', count: 16, hint: 'Outputs only switch while the controller is in Run.' },
    { kind: 'select', key: 'conn', label: 'Owner / mode (OK LED)', options: OUTPUT_CONN },
    {
      kind: 'action',
      label: 'Short circuit on output 3',
      tone: 'red',
      run: (d) => {
        d.set('fuse0', true);
        sfx.play('fault');
      },
      disabled: (d) => d.bool('fuse0'),
      hint: 'Trips the electronic fuse of group 0–7.',
    },
    {
      kind: 'action',
      label: 'Reset fuses',
      tone: 'green',
      run: (d) => {
        d.patch({ fuse0: false, fuse1: false });
        sfx.play('click');
      },
      disabled: (d) => !d.bool('fuse0') && !d.bool('fuse1'),
      hint: 'From the module properties (or a MSG) after fixing the short.',
    },
    { kind: 'toggle', key: 'door', label: 'RTB door open' },
  ],
  Scene: OB16EScene,
};

function AnalogScene({ demo, catalog }: { demo: DemoStore; catalog: '1756-IF8' | '1756-OF8' }) {
  useDemoVersion(demo);
  const conn = demo.str('conn');
  return (
    <group>
      <DisplayStand w={0.1} top={MOD_Y + 0.165} />
      <AnalogModule1756
        catalog={catalog}
        position={[0, MOD_Y, 0]}
        getOk={() => okState(conn)}
        getCal={() => (demo.bool('cal') ? 'flashing-green' : 'off')}
        doorOpen={demo.bool('door')}
        wired={demo.bool('door')}
      />
    </group>
  );
}

const if8: StageDef = {
  defaults: { conn: 'ok', cal: false, door: false, ma: 12 },
  controls: [
    { kind: 'slider', key: 'ma', label: 'Loop current, channel 0', min: 0, max: 21, step: 0.1, unit: 'mA', digits: 1, hint: 'Scaled 4–20 mA → 0–100 %.' },
    {
      kind: 'readout',
      label: 'Local:3:I.Ch0Data',
      value: (d) => {
        const ma = d.num('ma');
        if (ma < 3.6) return 'Under-range → wire break? (Ch0Fault = 1)';
        return `${(((ma - 4) / 16) * 100).toFixed(1)} %`;
      },
      tone: (d) => (d.num('ma') < 3.6 ? 'red' : 'green'),
    },
    { kind: 'select', key: 'conn', label: 'Connection (OK LED)', options: INPUT_CONN },
    { kind: 'toggle', key: 'cal', label: 'Calibrating (CAL)' },
    { kind: 'toggle', key: 'door', label: 'RTB door open' },
  ],
  Scene: ({ demo }) => <AnalogScene demo={demo} catalog="1756-IF8" />,
};

const of8: StageDef = {
  defaults: { conn: 'run', cal: false, door: false, pct: 40 },
  controls: [
    { kind: 'slider', key: 'pct', label: 'Local:4:O.Ch0Data', min: 0, max: 100, step: 1, unit: '%' },
    {
      kind: 'readout',
      label: 'Channel 0 current (4–20 mA)',
      value: (d) => (d.str('conn') === 'run' ? `${(4 + (d.num('pct') / 100) * 16).toFixed(2)} mA` : 'Program mode → holds / goes to the configured value'),
      tone: (d) => (d.str('conn') === 'run' ? 'green' : 'amber'),
    },
    { kind: 'select', key: 'conn', label: 'Owner / mode (OK LED)', options: OUTPUT_CONN },
    { kind: 'toggle', key: 'cal', label: 'Calibrating (CAL)' },
    { kind: 'toggle', key: 'door', label: 'RTB door open' },
  ],
  Scene: ({ demo }) => <AnalogScene demo={demo} catalog="1756-OF8" />,
};

// ---------------------------------------------------------------------------
// 1756-EN2T
// ---------------------------------------------------------------------------

function EN2TScene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  const net = demo.str('net');
  const cable = demo.bool('cable');
  const netState: StatusLedState1756 = !cable ? 'flashing-green' : net === 'connected' ? 'green' : net === 'noconn' ? 'flashing-green' : net === 'timeout' ? 'flashing-red' : 'red';
  return (
    <group>
      <DisplayStand w={0.1} top={MOD_Y + 0.165} />
      <Comm1756
        catalog="1756-EN2T"
        position={[0, MOD_Y, 0]}
        ipAddress={demo.str('ip')}
        powered={demo.bool('power')}
        cable={cable}
        getNet={() => netState}
        getLink={cable ? undefined : () => 'off'}
        getDisplayText={net === 'dup' ? () => 'Duplicate IP' : undefined}
      />
    </group>
  );
}

const en2t: StageDef = {
  defaults: { power: true, cable: true, net: 'connected', ip: '192.168.1.10' },
  controls: [
    {
      kind: 'select',
      key: 'net',
      label: 'Network state (NET)',
      options: [
        { value: 'connected', label: 'CIP connected' },
        { value: 'noconn', label: 'No connections' },
        { value: 'timeout', label: 'Timed out' },
        { value: 'dup', label: 'Duplicate IP' },
      ],
    },
    {
      kind: 'select',
      key: 'ip',
      label: 'IP address',
      options: [
        { value: '192.168.1.10', label: '192.168.1.10' },
        { value: '10.10.0.21', label: '10.10.0.21' },
      ],
    },
    { kind: 'toggle', key: 'cable', label: 'Cable plugged in' },
    { kind: 'toggle', key: 'power', label: 'Backplane power', tone: 'green' },
  ],
  Scene: EN2TScene,
};

// ---------------------------------------------------------------------------
// CompactLogix 5380
// ---------------------------------------------------------------------------

function L320Scene({ demo }: { demo: DemoStore }) {
  const live = useDemoLive(demo);
  return (
    <group>
      <DisplayStand w={0.15} top={CPX_Y + 0.17} />
      <CompactLogix5380Controller catalog="5069-L320ER" position={[0, CPX_Y, 0]} live={live} cables={[demo.bool('a1'), demo.bool('a2')]} />
    </group>
  );
}

const l320er: StageDef = {
  defaults: { ...CONTROLLER_DEFAULTS, a1: true, a2: false },
  controls: [
    ...controllerControls('Mode switch'),
    { kind: 'toggle', key: 'a1', label: 'Cable in port A1' },
    { kind: 'toggle', key: 'a2', label: 'Cable in port A2' },
  ],
  Scene: L320Scene,
};

type M5069 = '5069-IB16' | '5069-OB16' | '5069-IF8' | '5069-OF4';

const MODULE_CONN = [
  { value: 'ok', label: 'Connected' },
  { value: 'noconn', label: 'No connection' },
  { value: 'timeout', label: 'Timed out' },
  { value: 'fault', label: 'HW fault' },
];

function Module5069Scene({ demo, catalog }: { demo: DemoStore; catalog: M5069 }) {
  useDemoVersion(demo);
  const conn = demo.str('conn');
  const digital = catalog === '5069-IB16' || catalog === '5069-OB16';
  const mode: LedMode = conn === 'ok' || conn === 'fault' ? 'on' : 'flash';
  const color: LedColor = conn === 'ok' || conn === 'noconn' ? 'green' : 'red';
  return (
    <group>
      <DisplayStand w={0.08} top={CPX_Y + 0.17} />
      <Module5069
        catalog={catalog}
        position={[0, CPX_Y, 0]}
        getPoint={digital ? (i) => demo.bit('points', i) : undefined}
        getPointFault={catalog === '5069-OB16' ? (i) => i === 15 && demo.bool('noload') : undefined}
        getChannel={digital ? undefined : (c) => (c === 3 && demo.bool('openLoop') ? NaN : 20 + c * 10)}
        getModuleStatus={() => mode}
        getModuleStatusColor={() => color}
      />
    </group>
  );
}

const moduleConn: DemoControl = { kind: 'select', key: 'conn', label: 'Module status', options: MODULE_CONN };

const m5069ib16: StageDef = {
  defaults: { points: bits([0, 1, 5]), conn: 'ok' },
  controls: [{ kind: 'points', key: 'points', label: 'Inputs · Local:1:I.Pt00.Data …', count: 16 }, moduleConn],
  Scene: ({ demo }) => <Module5069Scene demo={demo} catalog="5069-IB16" />,
};
const m5069ob16: StageDef = {
  defaults: { points: bits([0, 2, 5, 7]), conn: 'ok', noload: false, la: true },
  controls: [
    { kind: 'points', key: 'points', label: 'Outputs · Local:2:O.Pt00.Data …', count: 16 },
    {
      kind: 'toggle',
      key: 'la',
      label: 'LA+ / LA− field power (24 V DC)',
      hint: 'This module switches its own LA power, not SA power. Turn it off: Pt00.Data can still be 1, but the load gets 0 V.',
    },
    {
      kind: 'readout',
      label: 'Lamp on OUT-0',
      value: (d) => (!d.bit('points', 0) ? 'Pt00.Data = 0 → 0 V, lamp off' : d.bool('la') ? 'Pt00.Data = 1 → 24 V, lamp ON' : 'Pt00.Data = 1 → 0 V: no LA power!'),
      tone: (d) => (!d.bit('points', 0) ? 'neutral' : d.bool('la') ? 'amber' : 'red'),
    },
    { kind: 'toggle', key: 'noload', label: 'Point 15: no load (diagnostic)', tone: 'red', hint: 'Point indicator turns red.' },
    moduleConn,
  ],
  Scene: ({ demo }) => <Module5069Scene demo={demo} catalog="5069-OB16" />,
};
const m5069if8: StageDef = {
  defaults: { conn: 'ok', openLoop: false },
  controls: [{ kind: 'toggle', key: 'openLoop', label: 'Open loop on channel 3', tone: 'red', hint: 'The channel indicator turns red.' }, moduleConn],
  Scene: ({ demo }) => <Module5069Scene demo={demo} catalog="5069-IF8" />,
};
const m5069of4: StageDef = {
  defaults: { conn: 'ok', openLoop: false },
  controls: [{ kind: 'toggle', key: 'openLoop', label: 'Fault on channel 3', tone: 'red' }, moduleConn],
  Scene: ({ demo }) => <Module5069Scene demo={demo} catalog="5069-OF4" />,
};

// ---------------------------------------------------------------------------
// PowerFlex 525
// ---------------------------------------------------------------------------

/** Default accel/decel: 10 s for 0 → 60 Hz (P041/P042 defaults, approx.). */
const PF_RATE = 6;

function PF525Scene({ demo }: { demo: DemoStore }) {
  const hz = useRamp(() => (demo.bool('run') && !demo.bool('faulted') ? demo.num('ref') : 0), PF_RATE, demo, 'hz');
  return (
    <group>
      <DisplayStand w={0.14} top={0.1 + 0.18} />
      <PowerFlex525
        frame="A"
        position={[0, 0.1, 0]}
        getFrequency={hz}
        getRunning={() => hz() > 0.01 || (demo.bool('run') && !demo.bool('faulted'))}
        getFaulted={() => demo.bool('faulted')}
        getFaultCode={() => 7}
        getReverse={() => demo.bool('reverse')}
        onKey={(k) => {
          if (k === 'start' && !demo.bool('faulted')) demo.set('run', true);
          else if (k === 'stop') {
            if (demo.bool('faulted')) demo.set('faulted', false);
            else demo.set('run', false);
          } else if (k === 'reverse') demo.toggle('reverse');
          else if (k === 'up') demo.set('ref', Math.min(60, demo.num('ref') + 1));
          else if (k === 'down') demo.set('ref', Math.max(0, demo.num('ref') - 1));
        }}
      />
    </group>
  );
}

const pf525: StageDef = {
  defaults: { run: false, ref: 45, reverse: false, faulted: false, hz: 0 },
  controls: [
    { kind: 'action', label: 'Start', tone: 'green', run: (d) => d.set('run', true), disabled: (d) => d.bool('faulted') || d.bool('run') },
    { kind: 'action', label: 'Stop', tone: 'red', run: (d) => d.set('run', false), disabled: (d) => !d.bool('run') },
    { kind: 'slider', key: 'ref', label: 'Speed reference', min: 0, max: 60, step: 0.5, unit: 'Hz', digits: 1 },
    { kind: 'toggle', key: 'reverse', label: 'Reverse' },
    {
      kind: 'readout',
      label: 'Output frequency · motor speed (4-pole)',
      value: (d) => `${d.num('hz').toFixed(2)} Hz · ${Math.round(d.num('hz') * 30 * 0.97)} rpm`,
      tone: (d) => (d.num('hz') > 0 ? 'green' : 'neutral'),
    },
    {
      kind: 'action',
      label: 'Trip F007 Motor Overload',
      tone: 'red',
      run: (d) => {
        d.patch({ faulted: true, run: false });
        sfx.play('fault');
      },
      disabled: (d) => d.bool('faulted'),
    },
    { kind: 'action', label: 'Reset fault (Stop key)', run: (d) => d.set('faulted', false), disabled: (d) => !d.bool('faulted') },
  ],
  Scene: PF525Scene,
};

// ---------------------------------------------------------------------------
// PanelView 5310
// ---------------------------------------------------------------------------

function PV5310Scene({ demo }: { demo: DemoStore }) {
  return (
    <group>
      {/* enclosure door (RAL 7035) */}
      <Backplate w={0.6} h={0.46} center={[0, 0.13, -0.0012]} color="#d6d8d6" metal={false} />
      <PanelView5310 size={7} position={[0, 0.02, 0]} getScreenOn={() => demo.bool('screen')} />
    </group>
  );
}

const pv5310: StageDef = {
  defaults: { screen: true },
  controls: [{ kind: 'toggle', key: 'screen', label: 'Backlight / 24 V DC', tone: 'green', hint: 'The screen content is live HTML: tap it in 3D.' }],
  Scene: PV5310Scene,
};

export const PLC_STAGES: Record<string, StageDef> = {
  'controllogix-rack': rack,
  '1756-l85e': l85e,
  '1756-pa72': pa72,
  '1756-ib16': ib16,
  '1756-ob16e': ob16e,
  '1756-if8': if8,
  '1756-of8': of8,
  '1756-en2t': en2t,
  '5069-l320er': l320er,
  '5069-ib16': m5069ib16,
  '5069-ob16': m5069ob16,
  '5069-if8': m5069if8,
  '5069-of4': m5069of4,
  'powerflex-525': pf525,
  'panelview-5310': pv5310,
};
