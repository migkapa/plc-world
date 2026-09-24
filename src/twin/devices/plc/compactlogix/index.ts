// Barrel for src/twin/devices/plc/compactlogix — CompactLogix 5380 controller, Compact 5000 I/O, rack.
export { CompactLogix5380Controller, CPX_CTRL } from './CompactLogix5380Controller';
export type { CompactLogix5380ControllerProps, CompactLogix5380Catalog } from './CompactLogix5380Controller';
export { Module5069, M5069, catalogInfo5069 } from './Module5069';
export type { Module5069Props, Module5069Catalog, DuctTarget } from './Module5069';
export { EndCap5069, END_CAP_5069_WIDTH } from './EndCap5069';
export type { EndCap5069Props } from './EndCap5069';
export { CompactLogixRack, layoutCompactLogixRack, RAIL_Y as COMPACT_RACK_RAIL_Y } from './CompactLogixRack';
export type { CompactRackSlotLayout, CompactLogixRackTwinProps } from './CompactLogixRack';
export { DUCT as COMPACT_RACK_DUCT } from './parts';
export { createCompactDemoLive } from './demoLive';
export type { CompactDemoLiveOptions } from './demoLive';
