/**
 * <CompactLogixRack/>: CompactLogix 5380 controller + Compact 5000 local I/O modules + 5069-ECR end cap on a
 * 35 mm DIN rail, laid out from a HardwareConfig (controller = slot 0 at the left, modules to the right in
 * slot order).
 *
 * Origin: back-bottom-center (z = 0 is the panel surface behind the DIN rail, y = 0 is the module bottom).
 */
import { useMemo } from 'react';
import type { LedColor, LedMode } from '../../../common';
import type { CompactLogixRackProps, RackLive } from '../../../contracts';
import type { ModuleCatalog, ModuleConfig } from '../../../../plc/types';
import { CompactLogix5380Controller, CPX_CTRL, type CompactLogix5380Catalog } from './CompactLogix5380Controller';
import { END_CAP_5069_WIDTH, EndCap5069 } from './EndCap5069';
import { M5069, Module5069, type Module5069Catalog } from './Module5069';
import { DinRail } from './parts';

const IO_CATALOGS: ReadonlySet<ModuleCatalog> = new Set(['5069-IB16', '5069-OB16', '5069-IF8', '5069-OF4']);
const CPU_CATALOGS: ReadonlySet<ModuleCatalog> = new Set(['5069-L320ER', '5069-L330ERM']);

/** DIN rail flange height: modules sit on the rail front (z = 7.5 mm). */
export const RAIL_DEPTH = 0.0075;
/** Height of the DIN rail center line above the module bottom. */
export const RAIL_Y = 0.071;

export interface CompactRackSlotLayout {
  slot: number;
  catalog: ModuleCatalog;
  /** Center x of the module in rack coordinates. */
  x: number;
  width: number;
}

/** Compute the left-to-right layout (useful for cameras / labels / wiring in scenes). */
export function layoutCompactLogixRack(modules: ModuleConfig[]): { slots: CompactRackSlotLayout[]; totalWidth: number; railLength: number } {
  const sorted = [...modules].filter((m) => CPU_CATALOGS.has(m.catalog) || IO_CATALOGS.has(m.catalog)).sort((a, b) => a.slot - b.slot);
  const widths = sorted.map((m) => (CPU_CATALOGS.has(m.catalog) ? CPX_CTRL.width : M5069.width));
  const totalWidth = widths.reduce((a, b) => a + b, 0) + END_CAP_5069_WIDTH;
  let x = -totalWidth / 2;
  const slots = sorted.map((m, i) => {
    const w = widths[i]!;
    const s = { slot: m.slot, catalog: m.catalog, x: x + w / 2, width: w };
    x += w;
    return s;
  });
  return { slots, totalWidth, railLength: totalWidth + 0.07 };
}

export function CompactLogixRack({ hardware, live, doorsOpen = false, onSelectModule, highlightSlot, position, rotation, scale }: CompactLogixRackProps) {
  const layout = useMemo(() => layoutCompactLogixRack(hardware.modules), [hardware.modules]);
  const moduleStatus = useMemo(() => moduleStatusGetters(live), [live]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <DinRail length={layout.railLength} position={[0, RAIL_Y, 0]} />
      {layout.slots.map((s) => {
        const select = onSelectModule ? () => onSelectModule(s.slot) : undefined;
        const pos: [number, number, number] = [s.x, 0, RAIL_DEPTH];
        if (CPU_CATALOGS.has(s.catalog)) {
          return (
            <CompactLogix5380Controller
              key={s.slot}
              catalog={s.catalog as CompactLogix5380Catalog}
              live={live}
              position={pos}
              highlighted={highlightSlot === s.slot}
              onSelect={select}
            />
          );
        }
        return (
          <Module5069
            key={s.slot}
            catalog={s.catalog as Module5069Catalog}
            position={pos}
            getPoint={live ? (i) => live.point(s.slot, i) : undefined}
            getChannel={live ? (ch) => live.channel(s.slot, ch) : undefined}
            getModuleStatus={moduleStatus.get}
            getModuleStatusColor={moduleStatus.color}
            wired={doorsOpen}
            sideLabel={false}
            highlighted={highlightSlot === s.slot}
            onSelect={select}
          />
        );
      })}
      <EndCap5069 position={[layout.totalWidth / 2 - END_CAP_5069_WIDTH / 2, 0, RAIL_DEPTH]} />
    </group>
  );
}

/** Module status indicator: flashing green without a connection, steady green when owned, flashing red on I/O fault. */
function moduleStatusGetters(live?: RackLive): { get: () => LedMode; color: () => LedColor } {
  if (!live) return { get: () => 'flash', color: () => 'green' };
  return {
    get: () => (live.status().ioLed === 'flashing-red' ? 'flash' : 'on'),
    color: () => (live.status().ioLed === 'flashing-red' ? 'red' : 'green'),
  };
}
