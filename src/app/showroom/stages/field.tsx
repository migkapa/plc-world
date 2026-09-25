/**
 * Showroom stages: field devices (motor, sensors, pneumatics, valves, conveyor, tank & instruments).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { materials } from '../../../twin/common';
import {
  Boxes,
  CardboardBox,
  Conveyor,
  LevelSwitch,
  LevelTransmitter,
  Motor,
  OnNozzle,
  PhotoEye42EF,
  PipeRun,
  PneumaticCylinder,
  ProxSensor872C,
  SolenoidValve,
  Tank,
  tankLayout,
  TempTransmitter,
  type BoxState,
} from '../../../twin/devices';
import { useDemoVersion, type DemoStore } from '../demo';
import { Slab, useRamp } from './common';
import type { StageDef } from './types';

/** Mirror a per-frame value into the demo store at ~8 Hz (for DOM readouts). */
function usePush(demo: DemoStore, key: string, get: () => number, digits = 1) {
  const last = useRef(0);
  useFrame(() => {
    const n = performance.now();
    if (n - last.current < 120) return;
    last.current = n;
    const f = 10 ** digits;
    const v = Math.round(get() * f) / f;
    if (demo.num(key) !== v) demo.set(key, v);
  });
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

function MotorScene({ demo }: { demo: DemoStore }) {
  const rpm = useRamp(() => (demo.bool('run') ? demo.num('speed') : 0), 1200, demo, 'rpm');
  return <Motor frame="medium" getRpm={rpm} getOverloaded={() => demo.bool('hot')} />;
}

const motor: StageDef = {
  defaults: { run: true, speed: 1750, hot: false, rpm: 0 },
  controls: [
    { kind: 'toggle', key: 'run', label: 'Contactor closed (power on)', tone: 'green' },
    { kind: 'slider', key: 'speed', label: 'Speed (with a VFD)', min: 0, max: 1780, step: 10, unit: 'rpm', hint: '60 Hz 4-pole: 1800 rpm synchronous, ≈ 1750 rpm with slip.' },
    { kind: 'readout', label: 'Shaft speed', value: (d) => `${Math.round(d.num('rpm'))} rpm`, tone: (d) => (d.num('rpm') > 50 ? 'green' : 'neutral') },
    { kind: 'toggle', key: 'hot', label: 'Overloaded (jammed load)', tone: 'red', hint: 'Hot frame — the overload relay should trip.' },
  ],
  Scene: MotorScene,
};

// ---------------------------------------------------------------------------
// Photo-eye
// ---------------------------------------------------------------------------

const BEAM = 0.6;

function PhotoEyeScene({ demo }: { demo: DemoStore }) {
  const boxZ = useRamp(() => (demo.bool('box') ? 0 : -0.34), 1.2);
  const boxRef = useRef<THREE.Group>(null);
  const blocked = () => Math.abs(boxZ()) < 0.17;
  useFrame(() => {
    if (boxRef.current) boxRef.current.position.z = boxZ();
  });
  const output = () => (demo.str('mode') === 'DO' ? blocked() : !blocked());
  return (
    <group>
      <PhotoEye42EF
        position={[0, 0.2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        getBlocked={blocked}
        getOutput={output}
        beamLength={BEAM}
        getBlockDistance={() => 0.3 - 0.12}
        postLength={0.19}
      />
      <group ref={boxRef} position={[0.3, 0, -0.34]} rotation={[0, Math.PI / 2, 0]}>
        <CardboardBox />
      </group>
    </group>
  );
}

const photoEye: StageDef = {
  defaults: { box: false, mode: 'DO' },
  controls: [
    { kind: 'toggle', key: 'box', label: 'Box in the beam', tone: 'amber' },
    {
      kind: 'select',
      key: 'mode',
      label: 'Output mode',
      options: [
        { value: 'LO', label: 'Light-operate' },
        { value: 'DO', label: 'Dark-operate' },
      ],
      hint: 'LO: ON when light returns. DO: ON when the beam is blocked.',
    },
    {
      kind: 'readout',
      label: 'PLC input (PE_Infeed)',
      value: (d) => {
        const on = d.str('mode') === 'DO' ? d.bool('box') : !d.bool('box');
        return `${on ? 1 : 0} — ${on ? 'output ON' : 'output OFF'}${d.bool('box') ? ' · beam blocked' : ' · beam clear'}`;
      },
      tone: (d) => ((d.str('mode') === 'DO' ? d.bool('box') : !d.bool('box')) ? 'amber' : 'neutral'),
    },
  ],
  Scene: PhotoEyeScene,
};

// ---------------------------------------------------------------------------
// Prox
// ---------------------------------------------------------------------------

/** Axis height of an 872C whose bracket foot stands on a surface at y = 0 (from the field preview). */
const proxAxis = (d: number) => 0.9 * d + 0.012 + 0.00125;
const PLATE_TOP = 0.02;
/** Rated sensing distance Sn (unshielded M18, mild steel) and a typical aluminium correction factor. */
const SN_MM = 8;
const ALU = 0.4;

const proxReach = (d: DemoStore) => SN_MM * (d.str('material') === 'alu' ? ALU : 1);
const proxActive = (d: DemoStore) => d.bool('target') && d.num('gap') <= proxReach(d);

function ProxScene({ demo }: { demo: DemoStore }) {
  useDemoVersion(demo);
  const alu = demo.str('material') === 'alu';
  const pos = useRamp(() => (demo.bool('target') ? demo.num('gap') / 1000 : 0.04), 0.12);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.position.z = 0.006 + pos();
  });
  const axis = PLATE_TOP + proxAxis(0.018);
  return (
    <group>
      <Slab w={0.24} d={0.14} t={PLATE_TOP} center={[0, PLATE_TOP / 2, -0.03]} />
      <ProxSensor872C position={[0, axis, 0]} getActive={() => proxActive(demo)} />
      <group ref={ref} position={[0, axis, 0.03]}>
        <mesh material={alu ? materials.metal('#d9dde0', 0.3) : materials.metal('#7d8388', 0.45)} castShadow>
          <boxGeometry args={[0.03, 0.03, 0.004]} />
        </mesh>
      </group>
    </group>
  );
}

const prox: StageDef = {
  defaults: { target: true, gap: 5, material: 'steel' },
  controls: [
    { kind: 'toggle', key: 'target', label: 'Target present', tone: 'amber' },
    { kind: 'slider', key: 'gap', label: 'Gap to the sensing face', min: 1, max: 12, step: 0.5, unit: 'mm', digits: 1 },
    {
      kind: 'select',
      key: 'material',
      label: 'Target material',
      options: [
        { value: 'steel', label: 'Mild steel' },
        { value: 'alu', label: 'Aluminium' },
      ],
    },
    {
      kind: 'readout',
      label: 'Output',
      value: (d) => `${proxActive(d) ? 'ON' : 'OFF'} · reach for this target ≈ ${proxReach(d).toFixed(1)} mm`,
      tone: (d) => (proxActive(d) ? 'amber' : 'neutral'),
    },
  ],
  Scene: ProxScene,
};

// ---------------------------------------------------------------------------
// Cylinder
// ---------------------------------------------------------------------------

function CylinderScene({ demo }: { demo: DemoStore }) {
  const ext = useRamp(() => (demo.bool('coil') ? 1 : 0), 3.2, demo, 'ext');
  return (
    <PneumaticCylinder
      position={[0, 0.2, 0.1]}
      bore={0.05}
      stroke={0.3}
      getExtension={ext}
      getRetractedSensor={() => ext() < 0.02}
      getExtendedSensor={() => ext() > 0.98}
      pusher={[0.26, 0.14]}
    />
  );
}

const cylinder: StageDef = {
  defaults: { coil: false, ext: 0 },
  controls: [
    {
      kind: 'toggle',
      key: 'coil',
      label: 'Valve solenoid (Pusher_Extend)',
      tone: 'green',
      hint: 'Spring-return 5/2 valve: coil off = retract.',
    },
    {
      kind: 'readout',
      label: 'Pusher_Retracted · Pusher_Extended',
      value: (d) => `${d.num('ext') < 0.02 ? 1 : 0} · ${d.num('ext') > 0.98 ? 1 : 0}  (stroke ${Math.round(d.num('ext') * 100)} %)`,
      tone: (d) => (d.num('ext') > 0.98 || d.num('ext') < 0.02 ? 'green' : 'amber'),
    },
  ],
  Scene: CylinderScene,
};

// ---------------------------------------------------------------------------
// Valves
// ---------------------------------------------------------------------------

function ValvesScene({ demo }: { demo: DemoStore }) {
  return (
    <group>
      <SolenoidValve variant="process" position={[-0.25, 0.25, 0]} getEnergized={() => demo.bool('xv')} tag="XV-101" />
      <mesh position={[0.62, 0.2, -0.006]} castShadow receiveShadow material={materials.paint('#e3e5e2', 0.6)}>
        <boxGeometry args={[0.24, 0.4, 0.012]} />
      </mesh>
      <SolenoidValve variant="pneumatic" position={[0.62, 0.13, 0]} getEnergized={() => demo.bool('station')} />
    </group>
  );
}

const valves: StageDef = {
  defaults: { xv: false, station: false },
  controls: [
    { kind: 'toggle', key: 'xv', label: 'XV-101 solenoid (Fill_Valve)', tone: 'green', hint: 'The actuator needs about a second to swing 90°.' },
    { kind: 'toggle', key: 'station', label: 'Manifold station 1', tone: 'green' },
  ],
  Scene: ValvesScene,
};

// ---------------------------------------------------------------------------
// Conveyor
// ---------------------------------------------------------------------------

const CV_LEN = 2;
const CV_H = 0.75;

function ConveyorScene({ demo }: { demo: DemoStore }) {
  const speed = useRamp(() => (demo.bool('run') ? demo.num('speed') : 0), 2.5);
  const pos = useRef(0);
  useFrame((_, dt) => {
    pos.current += speed() * Math.min(dt, 0.1);
  });
  const boxes = useMemo<BoxState[]>(() => [0, 1, 2].map((i) => ({ x: 0, tall: i === 1, id: i })), []);
  const getBoxes = () => {
    boxes.forEach((b, i) => {
      b.x = ((pos.current + i * 0.8) % 2.4) - 0.1;
      b.visible = b.x > 0.05 && b.x < CV_LEN - 0.05;
    });
    return boxes;
  };
  return (
    <group position={[0, 0, 0]}>
      <Conveyor length={CV_LEN} width={0.45} height={CV_H} getBeltPosition={() => pos.current} frameStyle="powder" frameColor="#2f5f8f" driveSide="front" />
      <Boxes position={[0, CV_H, 0]} getBoxes={getBoxes} />
    </group>
  );
}

const conveyor: StageDef = {
  defaults: { run: true, speed: 0.4 },
  controls: [
    { kind: 'toggle', key: 'run', label: 'Conveyor_Run', tone: 'green' },
    { kind: 'slider', key: 'speed', label: 'Belt speed', min: 0.1, max: 1, step: 0.05, unit: 'm/s', digits: 2 },
  ],
  Scene: ConveyorScene,
  liveShadow: true,
};

// ---------------------------------------------------------------------------
// Tank & instruments
// ---------------------------------------------------------------------------

const TL = tankLayout(1.3, 1.25);

function TankScene({ demo }: { demo: DemoStore }) {
  const st = useRef({ level: demo.num('level'), temp: demo.num('temp') });
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const s = st.current;
    const fill = demo.bool('fill') ? 4.5 : 0;
    const drain = demo.bool('drain') && s.level > 0 ? 5 : 0;
    s.level = Math.max(0, Math.min(100, s.level + (fill - drain) * dt));
    const heat = demo.bool('heater') && s.level >= 10 ? (1.2 * 50) / Math.max(s.level, 20) : 0;
    s.temp = Math.min(100, s.temp + (heat - 0.005 * (s.temp - 20) * 10) * dt);
  });
  usePush(demo, 'level', () => st.current.level);
  usePush(demo, 'temp', () => st.current.temp);
  const level = () => st.current.level;
  const temp = () => st.current.temp;
  const n = TL.nozzles;
  const inlet = n.inlet.position;
  return (
    <group>
      <Tank getLevel={level} getTemperature={temp} temperatureTint getBoiling={() => temp() >= 99.5 && level() > 0} getAgitatorRpm={() => (demo.bool('mixer') ? 70 : 0)} getHeaterOn={() => demo.bool('heater') && level() >= 10} />
      <OnNozzle nozzle={n.lt}>
        <LevelTransmitter getValue={level} units="%" tagLabel="LT-101" />
      </OnNozzle>
      <OnNozzle nozzle={n.tt}>
        <TempTransmitter getValue={temp} units="°C" tagLabel="TT-101" />
      </OnNozzle>
      <OnNozzle nozzle={n.lsl}>
        <LevelSwitch getActive={() => level() >= 10} />
      </OnNozzle>
      <OnNozzle nozzle={n.lsh}>
        <LevelSwitch getActive={() => level() >= 90} />
      </OnNozzle>
      <OnNozzle nozzle={n.lshh}>
        <LevelSwitch getActive={() => level() < 97} getWet={() => level() >= 97} />
      </OnNozzle>
      <PipeRun
        points={[inlet, [inlet[0], inlet[1] + 0.22, inlet[2]], [-1.05, inlet[1] + 0.22, inlet[2]], [-1.05, 0.02, inlet[2]]]}
        diameter={0.0483}
        flangesAt={[0]}
      />
      <SolenoidValve variant="process" position={[-0.78, inlet[1] + 0.22, inlet[2]]} getEnergized={() => demo.bool('fill')} tag="XV-101" pipeDiameter={0.0483} pipeStubs={0} />
    </group>
  );
}

const tank: StageDef = {
  defaults: { fill: false, drain: false, mixer: true, heater: false, level: 62, temp: 38 },
  controls: [
    { kind: 'toggle', key: 'fill', label: 'Fill_Valve (XV-101)', tone: 'blue' },
    { kind: 'toggle', key: 'drain', label: 'Drain_Valve (XV-102)', tone: 'neutral' },
    { kind: 'toggle', key: 'mixer', label: 'Mixer', tone: 'green' },
    { kind: 'toggle', key: 'heater', label: 'Heater', tone: 'red', hint: 'Only heats with level ≥ 10 % (dry-heat protection).' },
    { kind: 'readout', label: 'LT_101 · TT_101', value: (d) => `${d.num('level').toFixed(1)} % · ${d.num('temp').toFixed(1)} °C`, tone: () => 'green' },
    {
      kind: 'readout',
      label: 'LSL · LSH · LSHH (N.C. fail-safe)',
      value: (d) => {
        const l = d.num('level');
        return `${l >= 10 ? 1 : 0} · ${l >= 90 ? 1 : 0} · ${l < 97 ? 1 : 0}`;
      },
      tone: (d) => (d.num('level') >= 97 ? 'red' : d.num('level') >= 90 ? 'amber' : 'green'),
    },
  ],
  Scene: TankScene,
};

export const FIELD_STAGES: Record<string, StageDef> = {
  motor,
  'photo-eye-42ef': photoEye,
  'prox-872c': prox,
  cylinder,
  valves,
  conveyor,
  'tank-instruments': tank,
};
