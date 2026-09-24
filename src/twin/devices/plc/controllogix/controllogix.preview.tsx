/**
 * Gallery previews for the ControlLogix 1756 twins (demo live getters so the devices look alive).
 *   gallery.html?p=CLX_Rack_A7_Trainer
 */
import { useMemo, useState } from 'react';
import type { Preview } from '../../../../dev/gallery';
import type { ControllerStatus, HardwareConfig } from '../../../../plc/types';
import { staticRackLive } from '../../../live';
import { ControlLogixChassis } from './Chassis';
import { Comm1756 } from './Comm';
import { Controller1756L8 } from './Controller';
import { chassisLayout } from './dims';
import { AnalogModule1756, DigitalModule1756 } from './IoModules';
import { PowerSupply1756 } from './PowerSupply';
import { ControlLogixRack } from './Rack';
import { SlotFiller1756N2 } from './SlotFiller';

const TRAINER: HardwareConfig = {
  platform: 'ControlLogix',
  chassis: '1756-A7',
  powerSupply: '1756-PA72',
  modules: [
    { slot: 0, catalog: '1756-L85E', name: 'PLC' },
    { slot: 1, catalog: '1756-IB16', name: 'DI_Bench' },
    { slot: 2, catalog: '1756-OB16E', name: 'DO_Bench' },
    { slot: 3, catalog: '1756-IF8', name: 'AI_Bench' },
    { slot: 4, catalog: '1756-OF8', name: 'AO_Bench' },
    { slot: 5, catalog: '1756-EN2T' },
  ],
};

const TANK: HardwareConfig = {
  platform: 'ControlLogix',
  chassis: '1756-A10',
  powerSupply: '1756-PA75',
  modules: [
    { slot: 0, catalog: '1756-L85E' },
    { slot: 1, catalog: '1756-IB16' },
    { slot: 2, catalog: '1756-OB16E' },
    { slot: 3, catalog: '1756-IF8' },
    { slot: 4, catalog: '1756-OF8' },
    { slot: 5, catalog: '1756-EN2T' },
  ],
};

const BIG: HardwareConfig = {
  platform: 'ControlLogix',
  chassis: '1756-A13',
  powerSupply: '1756-PB72',
  modules: [
    { slot: 0, catalog: '1756-L83E' },
    { slot: 1, catalog: '1756-EN4TR' },
    { slot: 2, catalog: '1756-IB16' },
    { slot: 3, catalog: '1756-IB16' },
    { slot: 4, catalog: '1756-OB16E' },
    { slot: 5, catalog: '1756-OB16E' },
    { slot: 6, catalog: '1756-IF8' },
    { slot: 8, catalog: '1756-OF8' },
  ],
};

const now = () => performance.now() / 1000;
/** Slowly toggling "switch" inputs. */
const demoInput = (i: number) => Math.floor(now() * 0.8 + i * 0.37 + (i % 3) * 0.5) % 3 === 0;
/** Running-light outputs. */
const demoOutput = (i: number) => {
  const t = now();
  return Math.floor(t * 5) % 16 === i || (i >= 12 && Math.floor(t * 1.5 + i) % 2 === 0);
};

function useDemoLive(hw: HardwareConfig, opts: { running?: boolean; status?: Partial<ControllerStatus> } = {}) {
  return useMemo(() => {
    const running = opts.running ?? true;
    const live = staticRackLive({
      status: {
        mode: running ? 'REM_RUN' : 'REM_PROG',
        keySwitch: 'REM',
        running,
        runLed: running ? 'green' : 'off',
        ok: 'green',
        displayText: running ? 'Rem Run' : 'Rem Prog',
        ...opts.status,
      },
      point: (slot, i) => {
        const cat = hw.modules.find((m) => m.slot === slot)?.catalog;
        if (cat === '1756-IB16') return demoInput((i + slot * 3) % 16);
        if (cat === '1756-OB16E') return live.status().running && demoOutput((i + slot * 5) % 16);
        return false;
      },
    });
    return live;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function RackTrainer({ doorsOpen = false, wired = false }: { doorsOpen?: boolean; wired?: boolean }) {
  const live = useDemoLive(TRAINER);
  const [sel, setSel] = useState<number | undefined>(undefined);
  return (
    <ControlLogixRack
      hardware={TRAINER}
      live={live}
      doorsOpen={doorsOpen}
      wired={wired}
      highlightSlot={sel}
      onSelectModule={(s) => setSel((cur) => (cur === s ? undefined : s))}
      position={[0, wired || doorsOpen ? 0.11 : 0.006, 0]}
    />
  );
}

function RackTank() {
  const live = useDemoLive(TANK);
  return <ControlLogixRack hardware={TANK} live={live} highlightSlot={3} position={[0, 0.006, 0]} />;
}

function RackBig() {
  const live = useDemoLive(BIG, { running: false });
  return <ControlLogixRack hardware={BIG} live={live} doorsOpen wired position={[0, 0.11, 0]} />;
}

function L85E({ faulted = false }: { faulted?: boolean }) {
  // A tiny stand-alone "controller": the key switch drives the mode, like the real L8x.
  const live = useMemo(
    () =>
      staticRackLive({
        status: faulted
          ? {
              mode: 'FAULTED',
              keySwitch: 'RUN',
              running: false,
              ok: 'flashing-red',
              runLed: 'off',
              displayText: 'Major Fault T04:C20',
            }
          : { forceLed: 'flashing-amber', forcesInstalled: true },
      }),
    [faulted],
  );
  return <Controller1756L8 catalog="1756-L85E" getStatus={live.status} onKeySwitch={live.setKeySwitch} />;
}

const MOD_CAM = { position: [0.11, 0.125, 0.38] as [number, number, number], target: [0, 0.07, 0.1] as [number, number, number] };

export const previews: Record<string, Preview> = {
  CLX_Rack_A7_Trainer: {
    Component: () => <RackTrainer />,
    camera: { position: [0.16, 0.17, 0.62], target: [0, 0.078, 0.07] },
    description: 'Trainer rack: 1756-A7 + PA72, L85E, IB16, OB16E, IF8, OF8, EN2T (click modules to highlight)',
  },
  CLX_Rack_A7_Trainer_DoorsOpen: {
    Component: () => <RackTrainer doorsOpen wired />,
    camera: { position: [0.2, 0.3, 0.6], target: [0, 0.14, 0.08] },
    description: 'Trainer rack with RTB doors open and field wiring',
  },
  CLX_Rack_A10_Tank: {
    Component: () => <RackTank />,
    camera: { position: [0.2, 0.2, 0.78], target: [0, 0.078, 0.07] },
    description: 'Tank-process rack: 1756-A10 + PA75 (IF8 highlighted)',
  },
  CLX_Rack_A13_Mixed: {
    Component: () => <RackBig />,
    camera: { position: [0.25, 0.32, 0.85], target: [0, 0.14, 0.07] },
    description: '1756-A13 + PB72, L83E, EN4TR, I/O in PROG (outputs off, OK flashing), doors open',
  },
  CLX_L85E: {
    Component: () => (
      <group position={[0, 0.1, 0]}>
        <L85E />
      </group>
    ),
    camera: { position: [0.085, 0.23, 0.34], target: [0, 0.172, 0.12] },
    description: '1756-L85E close-up: display, LEDs, key switch (click left/center/right of the key)',
  },
  CLX_L85E_Faulted: {
    Component: () => <L85E faulted />,
    camera: { position: [0.03, 0.135, 0.25], target: [0, 0.108, 0.12] },
    description: '1756-L85E with a major fault scrolling on the display',
  },
  CLX_IB16: {
    Component: () => <DigitalModule1756 catalog="1756-IB16" getPoint={demoInput} />,
    camera: MOD_CAM,
    description: '1756-IB16 16-pt 24V DC sink input',
  },
  CLX_OB16E_DoorOpen: {
    Component: () => <DigitalModule1756 catalog="1756-OB16E" getPoint={demoOutput} doorOpen position={[0, 0.11, 0]} />,
    camera: { position: [0.13, 0.31, 0.43], target: [0, 0.145, 0.12] },
    description: '1756-OB16E with the door open: 1756-TBNH RTB and wiring',
  },
  CLX_OB16E_FuseTripped: {
    Component: () => (
      <DigitalModule1756
        catalog="1756-OB16E"
        getPoint={(i) => i < 8 && demoOutput(i)}
        getFuse={(g) => g === 1}
        position={[0, 0.1, 0]}
      />
    ),
    camera: { position: [0.05, 0.25, 0.3], target: [0, 0.22, 0.13] },
    description: '1756-OB16E with the group 1 (outputs 8-15) electronic fuse tripped',
  },
  CLX_OF8_DoorOpen: {
    Component: () => <AnalogModule1756 catalog="1756-OF8" doorOpen position={[0, 0.11, 0]} />,
    camera: { position: [0.13, 0.31, 0.43], target: [0, 0.145, 0.12] },
    description: '1756-OF8 with the door open: VOUT/IOUT per channel, shared RTN, 4-20 mA loops on ch 0-3',
  },
  CLX_IF8: {
    Component: () => <AnalogModule1756 catalog="1756-IF8" />,
    camera: MOD_CAM,
    description: '1756-IF8 analog input',
  },
  CLX_IF8_DoorOpen: {
    Component: () => <AnalogModule1756 catalog="1756-IF8" doorOpen position={[0, 0.11, 0]} getCal={() => 'flashing-green'} />,
    camera: { position: [0.13, 0.31, 0.43], target: [0, 0.145, 0.12] },
    description: '1756-IF8 with the door open: 36-pin 1756-TBCH RTB',
  },
  CLX_OF8: {
    Component: () => <AnalogModule1756 catalog="1756-OF8" getOk={() => 'flashing-green'} />,
    camera: MOD_CAM,
    description: '1756-OF8 analog output (not actively controlled)',
  },
  CLX_EN2T: {
    Component: () => <Comm1756 catalog="1756-EN2T" ipAddress="192.168.1.10" position={[0, 0.1, 0]} />,
    camera: { position: [0.09, 0.24, 0.36], target: [0, 0.165, 0.11] },
    description: '1756-EN2T scrolling its IP address',
  },
  CLX_EN4TR: {
    Component: () => <Comm1756 catalog="1756-EN4TR" ipAddress="10.0.0.20" position={[0, 0.1, 0]} />,
    camera: { position: [0.09, 0.24, 0.36], target: [0, 0.165, 0.11] },
    description: '1756-EN4TR dual-port',
  },
  CLX_PA72: {
    Component: () => <PowerSupply1756 catalog="1756-PA72" />,
    camera: { position: [0.1, 0.11, 0.36], target: [0, 0.07, 0.1] },
    description: '1756-PA72 AC power supply',
  },
  CLX_PA72_DoorOpen: {
    Component: () => <PowerSupply1756 catalog="1756-PA72" doorOpen position={[0, 0.08, 0]} />,
    camera: { position: [0.13, 0.24, 0.4], target: [0, 0.12, 0.1] },
    description: '1756-PA72 with the terminal cover open',
  },
  CLX_PB72_DoorOpen: {
    Component: () => <PowerSupply1756 catalog="1756-PB72" doorOpen position={[0, 0.08, 0]} />,
    camera: { position: [0.13, 0.24, 0.4], target: [0, 0.12, 0.1] },
    description: '1756-PB72 with the terminal cover open (+ / - / GND)',
  },
  CLX_PB72: {
    Component: () => <PowerSupply1756 catalog="1756-PB72" />,
    camera: { position: [0.1, 0.11, 0.36], target: [0, 0.07, 0.1] },
    description: '1756-PB72 24V DC power supply',
  },
  CLX_Chassis_A17: {
    Component: () => <ControlLogixChassis catalog="1756-A17" position={[-chassisLayout('1756-A17').width / 2, 0.006, 0]} />,
    camera: { position: [0.3, 0.3, 0.95], target: [0, 0.08, 0.05] },
    description: 'Empty 1756-A17 chassis',
  },
  CLX_Chassis_A4_N2: {
    Component: () => {
      const l = chassisLayout('1756-A4');
      return (
        <group position={[-l.width / 2, 0.006, 0]}>
          <ControlLogixChassis catalog="1756-A4" />
          <group position={[l.slotCenterX(3), 0.009, 0.004]}>
            <SlotFiller1756N2 />
          </group>
        </group>
      );
    },
    camera: { position: [0.18, 0.2, 0.42], target: [0, 0.07, 0.05] },
    description: '1756-A4 chassis with one 1756-N2 filler',
  },
};
