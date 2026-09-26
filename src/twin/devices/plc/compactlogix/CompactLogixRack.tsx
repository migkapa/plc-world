/**
 * <CompactLogixRack/>: CompactLogix 5380 controller + Compact 5000 local I/O modules + 5069-ECR end cap on a
 * 35 mm DIN rail, laid out from a HardwareConfig (controller = slot 0 at the left, modules to the right in
 * slot order). End anchors clamp the stack; field wiring runs from every RTB down into a slotted wire duct
 * below the rack (the controller's Ethernet patch cable goes into the duct too).
 *
 * Origin: back-bottom-center (z = 0 is the panel surface behind the DIN rail, y = 0 is the module bottom).
 * With `wireDuct` (default) the assembly extends DUCT.gap + DUCT.height (≈ 85 mm) below y = 0.
 */
import { useMemo } from 'react';
import type { LedColor, LedMode } from '../../../common';
import type { CompactLogixRackProps, RackLive } from '../../../contracts';
import type { ModuleCatalog, ModuleConfig } from '../../../../plc/types';
import { CompactLogix5380Controller, CPX_CTRL, type CompactLogix5380Catalog } from './CompactLogix5380Controller';
import { END_CAP_5069_WIDTH, EndCap5069 } from './EndCap5069';
import { M5069, Module5069, type DuctTarget, type Module5069Catalog } from './Module5069';
import { DinRail, DUCT, WireDuct } from './parts';
import { CompactLogixRackImpostor, type CompactRackImpostorSlot } from './RackImpostor';
import { DistanceLod } from '../../../lod';

/** Default on-screen width (CSS px) below which the rack switches to its impostor (same as ControlLogixRack). */
const CPX_LOD_PX = 90;

const IO_CATALOGS: ReadonlySet<ModuleCatalog> = new Set(['5069-IB16', '5069-OB16', '5069-IF8', '5069-OF4']);
const CPU_CATALOGS: ReadonlySet<ModuleCatalog> = new Set(['5069-L320ER', '5069-L330ERM']);

/** DIN rail flange height: modules sit on the rail front (z = 7.5 mm). */
export const RAIL_DEPTH = 0.0075;
/** Height of the DIN rail center line above the module bottom. */
export const RAIL_Y = 0.071;
/** End anchor (1492-EAJ35) half width incl. bevel. */
const ANCHOR_HALF = 0.0052;

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

export interface CompactLogixRackTwinProps extends CompactLogixRackProps {
  /**
   * Field wiring on the RTBs (5069 modules have no doors, so wiring is always visible):
   * 'all' (default) wires every point/channel, 'none' leaves the RTBs empty, or a per-slot list of the
   * points (digital) / channels (analog) in use — commons, shield and SA power are added automatically.
   * `doorsOpen` additionally wires the spare terminals (full harness).
   */
  wiring?: 'all' | 'none' | Record<number, number[]>;
  /** Draw the slotted wire duct below the rack (default true). Without it wires bend back into the panel. */
  wireDuct?: boolean;
  /**
   * Built-in level of detail: while the rack is narrower than this many CSS pixels on screen, a one-draw-call
   * impostor (<CompactLogixRackImpostor>) replaces the live rack (which stays mounted and keeps updating).
   * Default 90 px; `false` = always live.
   */
  lod?: number | false;
}

export function CompactLogixRack({
  hardware,
  live,
  doorsOpen = false,
  onSelectModule,
  highlightSlot,
  wiring = 'all',
  wireDuct = true,
  lod = CPX_LOD_PX,
  position,
  rotation,
  scale,
}: CompactLogixRackTwinProps) {
  const layout = useMemo(() => layoutCompactLogixRack(hardware.modules), [hardware.modules]);
  const moduleStatus = useMemo(() => moduleStatusGetters(live), [live]);
  const first = layout.slots[0];
  const stops = useMemo<[number, number]>(
    () => [first ? first.x - first.width / 2 - ANCHOR_HALF : -layout.totalWidth / 2 - ANCHOR_HALF, layout.totalWidth / 2 + ANCHOR_HALF],
    [first, layout.totalWidth],
  );
  const ductLength = layout.railLength + 0.02;
  // controller cable end: inside the duct (controller-local coordinates)
  const cableTo = useMemo<[number, number] | undefined>(() => (wireDuct ? [-DUCT.gap, DUCT.depth * 0.55 - RAIL_DEPTH] : undefined), [wireDuct]);

  const impostorSlots = useMemo<CompactRackImpostorSlot[]>(
    () =>
      layout.slots.map((s) => {
        const cpu = CPU_CATALOGS.has(s.catalog);
        const points = wiring === 'all' || wiring === 'none' || doorsOpen ? undefined : wiring[s.slot];
        const wired = !cpu && (doorsOpen || (wiring === 'all' ? true : wiring === 'none' ? false : !!points?.length));
        return { x: s.x, width: s.width, cpu, wired };
      }),
    [layout, wiring, doorsOpen],
  );

  const liveRack = (
    <group>
      <DinRail length={layout.railLength} position={[0, RAIL_Y, 0]} stops={stops} />
      {wireDuct && <WireDuct length={ductLength} position={[0, -DUCT.gap, 0]} />}
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
              cableTo={cableTo}
              highlighted={highlightSlot === s.slot}
              onSelect={select}
            />
          );
        }
        const points = wiring === 'all' || wiring === 'none' || doorsOpen ? undefined : wiring[s.slot];
        const wired = doorsOpen || (wiring === 'all' ? true : wiring === 'none' ? false : !!points?.length);
        const duct: DuctTarget | null = wireDuct
          ? { top: -DUCT.gap, zMin: DUCT.wall - RAIL_DEPTH, zMax: DUCT.depth - RAIL_DEPTH, pitch: DUCT.pitch, phase: -ductLength / 2 - s.x }
          : null;
        return (
          <Module5069
            key={s.slot}
            catalog={s.catalog as Module5069Catalog}
            position={pos}
            getPoint={live ? (i) => live.point(s.slot, i) : undefined}
            getChannel={live ? (ch) => live.channel(s.slot, ch) : undefined}
            getModuleStatus={moduleStatus.get}
            getModuleStatusColor={moduleStatus.color}
            wired={wired}
            wiredPoints={points}
            duct={duct}
            sideLabel={false}
            highlighted={highlightSlot === s.slot}
            onSelect={select}
          />
        );
      })}
      <EndCap5069 position={[layout.totalWidth / 2 - END_CAP_5069_WIDTH / 2, 0, RAIL_DEPTH]} />
    </group>
  );
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {lod === false ? (
        liveRack
      ) : (
        <DistanceLod
          minPixels={lod}
          size={layout.railLength}
          near={liveRack}
          far={
            <CompactLogixRackImpostor
              slots={impostorSlots}
              totalWidth={layout.totalWidth}
              railLength={layout.railLength}
              railY={RAIL_Y}
              railDepth={RAIL_DEPTH}
              stops={stops}
              wireDuct={wireDuct}
            />
          }
        />
      )}
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
