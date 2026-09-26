/**
 * <ControlLogixRack/> — composes a 1756 chassis, its power supply and the modules of a HardwareConfig,
 * live-wired to the controller through a RackLive (see `rackLiveFromController()` in src/twin/live.ts).
 *
 * Origin: back-bottom-center of the chassis body. Empty slots get 1756-N2 fillers.
 *
 * LED behaviour (per Rockwell 1756 I/O user manuals):
 *  - controller: RUN / FORCE / OK / display from ControllerStatus; key follows status.keySwitch.
 *  - input modules: OK steady green while the owner connection is open (RUN or PROG).
 *  - output modules: OK steady green in RUN; flashing green when not actively controlled (PROG / faulted).
 *  - ST point indicators: DI = input image, DO = what the module drives to the field.
 */
import { useMemo } from 'react';
import type { ModuleCatalog, ModuleConfig } from '../../../../plc/types';
import type { ControlLogixRackProps, RackLive } from '../../../contracts';
import { catalogKind, staticRackLive } from '../../../live';
import { ControlLogixChassis } from './Chassis';
import { Comm1756, type CommCatalog1756 } from './Comm';
import { Controller1756L8, type ControllerCatalog1756 } from './Controller';
import { MOD_Y0, MOD_Z0, chassisLayout } from './dims';
import { AnalogModule1756, DigitalModule1756, type AnalogCatalog1756, type DigitalCatalog1756 } from './IoModules';
import { PowerSupply1756 } from './PowerSupply';
import { ControlLogixRackImpostor } from './RackImpostor';
import { DistanceLod } from '../../../lod';
import type { StatusLedState } from './shared';
import { SlotFiller1756N2 } from './SlotFiller';

export interface ControlLogixRackExtraProps {
  /** Show field wiring hanging below the I/O modules (and the PS) even with doors closed. */
  wired?: boolean;
  /** Open the power-supply terminal cover. */
  psDoorOpen?: boolean;
  /** IP address shown by comm modules; default 192.168.1.<10 + slot>. */
  ipForSlot?: (slot: number) => string;
  /**
   * Built-in level of detail: while the rack is narrower than this many CSS pixels on screen, a one-draw-call
   * impostor (<ControlLogixRackImpostor>) replaces the ~100-draw-call live rack (which stays mounted and keeps
   * updating). Default 90 px; `false` = always live.
   */
  lod?: number | false;
}

export type ControlLogixRackComponentProps = ControlLogixRackProps & ControlLogixRackExtraProps;

const CLX_SUPPORTED: ReadonlySet<ModuleCatalog> = new Set<ModuleCatalog>([
  '1756-L85E',
  '1756-L83E',
  '1756-EN2T',
  '1756-EN4TR',
  '1756-IB16',
  '1756-OB16E',
  '1756-IF8',
  '1756-OF8',
]);

/** Rack LED state for an I/O module's OK indicator. */
function ioOk(live: RackLive, output: boolean): StatusLedState {
  const s = live.status();
  if (s.ok === 'off') return 'flashing-green';
  if (!output) return 'green';
  return s.running ? 'green' : 'flashing-green';
}

function SlotModule({
  module,
  live,
  doorOpen,
  wired,
  highlighted,
  onSelect,
  ip,
  sideLabel,
}: {
  module: ModuleConfig;
  live: RackLive;
  doorOpen: boolean;
  wired: boolean;
  highlighted: boolean;
  onSelect?: () => void;
  ip: string;
  /** Only the module in the last slot shows its side label (the others are hidden by their neighbours). */
  sideLabel: boolean;
}) {
  const { slot, catalog } = module;
  const kind = catalogKind(catalog);
  const getters = useMemo(
    () => ({
      status: () => live.status(),
      key: live.setKeySwitch ? (pos: Parameters<NonNullable<RackLive['setKeySwitch']>>[0]) => live.setKeySwitch?.(pos) : undefined,
      point: (i: number) => live.point(slot, i),
      okIn: () => ioOk(live, false),
      okOut: () => ioOk(live, true),
    }),
    [live, slot],
  );
  switch (kind) {
    case 'CPU':
      return (
        <Controller1756L8
          catalog={catalog as ControllerCatalog1756}
          getStatus={getters.status}
          onKeySwitch={getters.key}
          onSelect={onSelect}
          highlighted={highlighted}
          sideLabel={sideLabel}
        />
      );
    case 'COMM':
      return <Comm1756 catalog={catalog as CommCatalog1756} ipAddress={ip} onSelect={onSelect} highlighted={highlighted} sideLabel={sideLabel} />;
    case 'DI':
    case 'DO':
      return (
        <DigitalModule1756
          catalog={catalog as DigitalCatalog1756}
          getPoint={getters.point}
          getOk={kind === 'DI' ? getters.okIn : getters.okOut}
          doorOpen={doorOpen}
          wired={wired}
          onSelect={onSelect}
          highlighted={highlighted}
          sideLabel={sideLabel}
        />
      );
    case 'AI':
    case 'AO':
      return (
        <AnalogModule1756
          catalog={catalog as AnalogCatalog1756}
          getOk={kind === 'AI' ? getters.okIn : getters.okOut}
          doorOpen={doorOpen}
          wired={wired}
          onSelect={onSelect}
          highlighted={highlighted}
          sideLabel={sideLabel}
        />
      );
    default:
      return <SlotFiller1756N2 onSelect={onSelect} highlighted={highlighted} />;
  }
}

/** Default on-screen width (CSS px) below which racks switch to their impostor. */
export const RACK_LOD_PX = 90;

const IDLE_STATUS = {
  mode: 'PROG',
  keySwitch: 'PROG',
  running: false,
  ok: 'green',
  runLed: 'off',
  displayText: 'PROG',
} as const;

export function ControlLogixRack({
  hardware,
  live,
  doorsOpen = false,
  onSelectModule,
  highlightSlot,
  wired = false,
  psDoorOpen = false,
  ipForSlot,
  lod = RACK_LOD_PX,
  position,
  rotation,
  scale,
}: ControlLogixRackComponentProps) {
  const catalog = hardware.chassis ?? '1756-A7';
  const layout = chassisLayout(catalog);
  const idle = useMemo(() => staticRackLive({ status: { ...IDLE_STATUS } }), []);
  const rl = live ?? idle;

  const bySlot = useMemo(() => {
    const m = new Map<number, ModuleConfig>();
    for (const mod of hardware.modules) {
      if (mod.slot >= 0 && mod.slot < layout.slots && CLX_SUPPORTED.has(mod.catalog)) m.set(mod.slot, mod);
    }
    return m;
  }, [hardware.modules, layout.slots]);

  const selectFns = useMemo(
    () => Array.from({ length: layout.slots }, (_, slot) => (onSelectModule ? () => onSelectModule(slot) : undefined)),
    [layout.slots, onSelectModule],
  );

  const liveRack = (
    <group position={[-layout.width / 2, 0, 0]}>
      <ControlLogixChassis catalog={catalog} />
      <PowerSupply1756
        catalog={hardware.powerSupply ?? '1756-PA72'}
        position={[layout.psCenterX, MOD_Y0, MOD_Z0]}
        doorOpen={psDoorOpen}
        wired={wired}
      />
      {Array.from({ length: layout.slots }, (_, slot) => {
        const mod = bySlot.get(slot);
        const pos: [number, number, number] = [layout.slotCenterX(slot), MOD_Y0, MOD_Z0];
        return (
          <group key={`${slot}:${mod?.catalog ?? 'N2'}`} position={pos}>
            {mod ? (
              <SlotModule
                module={mod}
                live={rl}
                doorOpen={doorsOpen}
                wired={wired}
                highlighted={highlightSlot === slot}
                onSelect={selectFns[slot]}
                ip={ipForSlot ? ipForSlot(slot) : `192.168.1.${10 + slot}`}
                sideLabel={slot === layout.slots - 1}
              />
            ) : (
              <SlotFiller1756N2 onSelect={selectFns[slot]} highlighted={highlightSlot === slot} />
            )}
          </group>
        );
      })}
    </group>
  );
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {lod === false ? liveRack : <DistanceLod minPixels={lod} size={layout.width} near={liveRack} far={<ControlLogixRackImpostor hardware={hardware} />} />}
    </group>
  );
}
