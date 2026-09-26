/**
 * Gallery previews for operator devices. Demo getters animate lamps / presses so screenshots show
 * the devices alive; everything is also clickable in the gallery.
 */
import { useMemo, useRef } from 'react';
import type { Preview } from '../../../dev/gallery';
import type { LedColor } from '../../common';
import { AnalogMeter } from './AnalogMeter';
import { EStop800FM } from './EStop800FM';
import { LedBarGraph } from './LedBarGraph';
import { PilotLight800F } from './PilotLight800F';
import { Potentiometer } from './Potentiometer';
import { PushButton800F } from './PushButton800F';
import { PushButtonStation } from './PushButtonStation';
import { SelectorSwitch800F } from './SelectorSwitch800F';
import { StackLight856T } from './StackLight856T';
import { ToggleSwitch } from './ToggleSwitch';

const now = () => performance.now() / 1000;

/** Tiny ref-backed demo state (no React re-renders). */
function useVal<T>(initial: T) {
  const r = useRef(initial);
  return useMemo(() => ({ get: () => r.current, set: (v: T) => void (r.current = v) }), []);
}

function PanelPlate({ w, h, y = 0, color = '#d6d8d6' }: { w: number; h: number; y?: number; color?: string }) {
  return (
    <mesh position={[0, y, -0.001]} receiveShadow>
      <boxGeometry args={[w, h, 0.002]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.15} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------

function StartStopStation() {
  const running = useVal(true);
  const startP = useVal(false);
  const stopP = useVal(false);
  // demo: auto-press START briefly every 4 s so screenshots can catch the press travel
  const autoStart = () => startP.get() || now() % 4 < 0.35;
  return (
    <PushButtonStation holes={3} position={[0, 0, 0]}>
      <PushButton800F
        color="green"
        legend="START"
        getPressed={autoStart}
        onPress={() => {
          startP.set(true);
          running.set(true);
        }}
        onRelease={() => startP.set(false)}
      />
      <PushButton800F
        color="red"
        style="extended"
        legend="STOP"
        contact="N.C."
        getPressed={stopP.get}
        onPress={() => {
          stopP.set(true);
          running.set(false);
        }}
        onRelease={() => stopP.set(false)}
      />
      <PilotLight800F color="green" legend="RUNNING" getLit={running.get} />
    </PushButtonStation>
  );
}

function EStopStation() {
  const engaged = useVal(false);
  return (
    <group>
      <PushButtonStation holes={1} color="yellow" pitch={0.082} width={0.084} centered position={[-0.06, 0, 0]}>
        <EStop800FM getEngaged={engaged.get} onToggle={() => engaged.set(!engaged.get())} />
      </PushButtonStation>
      {/* second one latched in to show the pushed state */}
      <PushButtonStation holes={1} color="yellow" pitch={0.082} width={0.084} centered position={[0.06, 0, 0]}>
        <EStop800FM getEngaged={() => true} />
      </PushButtonStation>
    </group>
  );
}

function HoaSelector() {
  const pos = useVal(2);
  const touched = useVal(false);
  const two = useVal(0);
  const get = () => (touched.get() ? pos.get() : [0, 1, 2, 1][Math.floor(now() / 1.5) % 4]!);
  return (
    <group>
      <PanelPlate w={0.2} h={0.1} y={0.008} />
      <SelectorSwitch800F
        position={[-0.06, 0, 0]}
        positions={['HAND', 'OFF', 'AUTO']}
        getPosition={get}
        onChange={(i) => {
          touched.set(true);
          pos.set(i);
        }}
      />
      <SelectorSwitch800F
        position={[0, 0, 0]}
        positions={['HAND', 'OFF', 'AUTO']}
        knob="long-lever"
        legend="MODE"
        getPosition={() => 2}
        onChange={() => undefined}
      />
      <SelectorSwitch800F position={[0.06, 0, 0]} positions={['OFF', 'ON']} bezel="plastic" color="black" getPosition={two.get} onChange={two.set} />
    </group>
  );
}

function StackLights() {
  const tiers: LedColor[] = ['red', 'amber', 'green'];
  const phase = () => Math.floor(now() / 2) % 3;
  return (
    <group>
      <StackLight856T
        position={[0, 0, 0]}
        tiers={tiers}
        getTier={(i) => (i === 2 ? true : i === 1 ? phase() >= 1 : phase() === 2)}
        getFlashing={(i) => i === 1}
        getHorn={() => true}
      />
      <StackLight856T position={[0.12, 0, 0]} tiers={['red', 'yellow', 'green', 'blue', 'white']} getTier={(i) => i === 2 || i === 4} mount="base" />
      <mesh position={[0.06, -0.002, 0]} receiveShadow>
        <boxGeometry args={[0.3, 0.004, 0.14]} />
        <meshStandardMaterial color="#d6d8d6" roughness={0.6} metalness={0.15} />
      </mesh>
    </group>
  );
}

/** Gamified sounder cue (showSoundFx) next to the legacy 855T look (series="855T", gray housing). */
function StackLightVariants() {
  const hornOn = () => now() % 3 < 2;
  return (
    <group>
      <StackLight856T position={[0, 0, 0]} tiers={['red', 'green']} getTier={(i) => i === 0 && hornOn()} getHorn={hornOn} showSoundFx />
      <StackLight856T position={[0.12, 0, 0]} series="855T" housing="gray" tiers={['red', 'amber', 'green']} getTier={(i) => i === 2} getHorn={() => false} mount="base" />
      <mesh position={[0.06, -0.002, 0]} receiveShadow>
        <boxGeometry args={[0.3, 0.004, 0.14]} />
        <meshStandardMaterial color="#d6d8d6" roughness={0.6} metalness={0.15} />
      </mesh>
    </group>
  );
}

function TrainerDevices() {
  const sw = useMemo(() => [true, false, true, true].map((v) => ({ v })), []);
  const pot1 = useVal<number | null>(null);
  const pot2 = useVal<number | null>(null);
  const p1 = () => pot1.get() ?? 50 + 40 * Math.sin(now() * 0.8);
  const p2 = () => pot2.get() ?? 50 + 45 * Math.sin(now() * 0.5 + 1);
  return (
    <group>
      <PanelPlate w={0.44} h={0.2} y={0.0} color="#2e3a4a" />
      {sw.map((s, i) => (
        <ToggleSwitch
          key={i}
          position={[-0.19 + i * 0.038, 0.05, 0]}
          legend={`SW ${i}`}
          variant={i === 3 ? 'boot' : 'bat'}
          getOn={() => s.v}
          onToggle={() => (s.v = !s.v)}
        />
      ))}
      {(['green', 'amber', 'red', 'blue'] as LedColor[]).map((c, i) => (
        <PilotLight800F key={c} position={[-0.19 + i * 0.038, -0.04, 0]} color={c} legend={`L${i}`} getLit={() => (i + Math.floor(now() * 2)) % 2 === 0} />
      ))}
      <Potentiometer position={[0.0, 0.045, 0]} legend="POT 1" getValue={p1} onChange={pot1.set} />
      <Potentiometer position={[0.0, -0.045, 0]} legend="POT 2" getValue={p2} onChange={pot2.set} />
      <AnalogMeter position={[0.095, 0.0, 0]} legend="METER 1" units="%" scaleLabels={['0', '100']} getValue={p1} redFrom={90} />
      <LedBarGraph position={[0.18, 0.0, 0]} legend="METER 2" getValue={p2} />
    </group>
  );
}

function Lineup() {
  return (
    <group>
      <PanelPlate w={0.36} h={0.12} />
      <PushButton800F position={[-0.15, -0.01, 0]} color="green" legend="START" getPressed={() => now() % 2 < 1} />
      <PushButton800F position={[-0.1, -0.01, 0]} color="red" style="extended" legend="STOP" contact="N.C." getPressed={() => false} bezel="plastic" />
      <PushButton800F position={[-0.05, -0.01, 0]} color="black" legend="JOG" getPressed={() => false} guard />
      <PushButton800F position={[0, -0.01, 0]} color="amber" legend="RESET" getPressed={() => false} getLit={() => true} />
      <PilotLight800F position={[0.05, -0.01, 0]} color="green" legend="RUN" getLit={() => true} />
      <PilotLight800F position={[0.1, -0.01, 0]} color="red" legend="FAULT" getLit={() => false} />
      <PushButton800F position={[0.155, -0.012, 0]} color="red" style="mushroom" legend="STOP" getPressed={() => false} contact="N.C." />
    </group>
  );
}

export const previews: Record<string, Preview> = {
  OP_StartStopStation: {
    Component: StartStopStation,
    camera: { position: [0.22, 0.22, 0.5], target: [0, 0.1, 0.04] },
    description: '800F 3-hole station: START / STOP / RUNNING (click the buttons)',
  },
  OP_EStop: {
    Component: EStopStation,
    camera: { position: [0.06, 0.12, 0.34], target: [0, 0.045, 0.06] },
    description: '800FM-MT44 40 mm twist-to-release E-stop in yellow stations (left clickable, right latched)',
  },
  OP_HOA_Selector: {
    Component: HoaSelector,
    camera: { position: [0.03, 0.05, 0.22], target: [0, 0.01, 0] },
    description: '800F selector switches: HOA standard knob, long lever, 2-position',
  },
  OP_StackLight3_Horn: {
    Component: StackLights,
    camera: { position: [0.42, 0.36, 0.78], target: [0.06, 0.19, 0] },
    description: '856T 70 mm Control Tower: pole mount R/A/G + top sounder, surface base 5-tier',
  },
  OP_StackLight_Variants: {
    Component: StackLightVariants,
    camera: { position: [0.3, 0.3, 0.6], target: [0.06, 0.16, 0] },
    description: '856T with top sounder + showSoundFx cue (grille pulse, faint ring) and a legacy 855T (gray) for comparison',
  },
  OP_TrainerDevices: {
    Component: TrainerDevices,
    camera: { position: [0.0, 0.03, 0.5], target: [0, 0, 0] },
    description: 'Trainer panel devices: toggles, pilot lights, potentiometers, 72 mm meter, LED bar graph',
  },
  OP_800F_Lineup: {
    Component: Lineup,
    camera: { position: [0.05, 0.08, 0.32], target: [0, 0, 0] },
    description: '800F push buttons (flush/extended/guard/illuminated/mushroom) and pilot lights',
  },
};
