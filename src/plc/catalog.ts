/**
 * Module catalog + module-defined I/O data types.
 *
 * Creates the `Local:<slot>:I`, `Local:<slot>:O` and `Local:<slot>:C` tags exactly as Studio 5000
 * does for local-chassis (ControlLogix) and local-bus (CompactLogix 5380) modules, using the
 * authentic member names:
 *
 *   1756-IB16   Local:1:I.Data.0 … .15          (DINT word, one bit per point)
 *   1756-OB16E  Local:2:O.Data.0 … .15          (+ Local:2:I.Data echo, Fault, FuseBlown)
 *   1756-IF8    Local:3:I.Ch0Data … Ch7Data     (REAL, float mode scaled to engineering units)
 *   1756-OF8    Local:4:O.Ch0Data … Ch7Data
 *   5069-IB16   Local:1:I.Pt00.Data … Pt15.Data (BOOL per point structure)
 *   5069-OB16   Local:2:O.Pt00.Data …
 *   5069-IF8    Local:3:I.Ch00.Data …           (REAL)
 *   5069-OF4    Local:4:O.Ch00.Data …
 *
 * Controllers and communication modules create no Local tags.
 */
import type {
  DataTypeName,
  HardwareConfig,
  ModuleCatalog,
  ModuleCatalogInfo,
  ModuleConfig,
  StructMember,
  StructType,
  TagDef,
  TagValue,
} from './types';

/** Catalog entry with a few extra details used by the runtime and the showroom. */
export interface CatalogEntry extends ModuleCatalogInfo {
  /** Data type name for the module's configuration tag Local:<slot>:C (if any). */
  configType?: DataTypeName;
  /** Output → input echo members (e.g. 'O.Data.{n}' → 'I.Data.{n}') used to mirror field outputs. */
  echoPath?: string;
  /** Series letter / family text for info panels. */
  family: string;
}

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

const two = (n: number): string => String(n).padStart(2, '0');
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

function m(name: string, dataType: DataTypeName, extra?: Partial<StructMember>): StructMember {
  return { name, dataType, ...extra };
}

/** 1756 digital input (AB:1756_DI:I:0). */
const T_1756_DI_I: StructType = {
  name: 'AB:1756_DI:I:0',
  module: true,
  description: '1756 digital input data',
  members: [
    m('Fault', 'DINT', { description: 'Point fault bits (1 = communication lost / fault)' }),
    m('Data', 'DINT', { description: 'Input point data, bit n = point n' }),
    m('CSTTimestamp', 'DINT', { dims: 2, description: 'Coordinated System Time timestamp of the last change' }),
  ],
};

/** 1756 digital input configuration (AB:1756_DI:C:0). */
const T_1756_DI_C: StructType = {
  name: 'AB:1756_DI:C:0',
  module: true,
  description: '1756 digital input configuration',
  members: [
    m('FilterOffOn_0_7', 'SINT', { description: 'Off→On input filter time points 0-7 (ms)' }),
    m('FilterOnOff_0_7', 'SINT', { description: 'On→Off input filter time points 0-7 (ms)' }),
    m('FilterOffOn_8_15', 'SINT'),
    m('FilterOnOff_8_15', 'SINT'),
    m('FilterOffOn_16_23', 'SINT'),
    m('FilterOnOff_16_23', 'SINT'),
    m('FilterOffOn_24_31', 'SINT'),
    m('FilterOnOff_24_31', 'SINT'),
    m('COSOnOffEn', 'DINT', { description: 'Change-of-state reporting On→Off enable bits' }),
    m('COSOffOnEn', 'DINT', { description: 'Change-of-state reporting Off→On enable bits' }),
  ],
};

/** 1756 electronically fused digital output — input (echo) tag. */
const T_1756_DOF_I: StructType = {
  name: 'AB:1756_DO_Fused:I:0',
  module: true,
  description: '1756 fused digital output status',
  members: [
    m('Fault', 'DINT', { description: 'Point fault bits' }),
    m('Data', 'DINT', { description: 'Output echo: state the module is actually driving' }),
    m('CSTTimestamp', 'DINT', { dims: 2 }),
    m('FuseBlown', 'DINT', { description: 'Electronic fuse tripped, bit n = point n' }),
  ],
};

const T_1756_DOF_O: StructType = {
  name: 'AB:1756_DO_Fused:O:0',
  module: true,
  description: '1756 fused digital output data',
  members: [m('Data', 'DINT', { description: 'Output point data, bit n = point n' })],
};

const T_1756_DOF_C: StructType = {
  name: 'AB:1756_DO_Fused:C:0',
  module: true,
  description: '1756 fused digital output configuration',
  members: [
    m('ProgToFaultEn', 'BOOL', { description: 'Outputs go to fault state if communications fail in Program mode' }),
    m('FaultMode', 'DINT', { description: 'Fault mode: 0 = use FaultValue, 1 = hold last state' }),
    m('FaultValue', 'DINT'),
    m('ProgMode', 'DINT', { description: 'Program mode: 0 = use ProgValue, 1 = hold last state' }),
    m('ProgValue', 'DINT'),
  ],
};

const IF8_STATUS_BITS = ['RateAlarm', 'HHAlarm', 'HAlarm', 'LAlarm', 'LLAlarm', 'Overrange', 'Underrange', 'CalFault'];

/** 1756-IF8 in floating point mode (AB:1756_IF8_Float:I:0). */
const T_1756_IF8_I: StructType = {
  name: 'AB:1756_IF8_Float:I:0',
  module: true,
  description: '1756-IF8 analog input data (floating point)',
  members: [
    m('ChannelFaults', 'INT', { description: 'Channel fault bits, bit n = channel n' }),
    ...range(8).map((n) => m(`Ch${n}Fault`, 'BOOL', { bitOf: { member: 'ChannelFaults', bit: n } })),
    m('ModuleFaults', 'INT'),
    m('AnalogGroupFault', 'BOOL', { bitOf: { member: 'ModuleFaults', bit: 15 } }),
    m('InGroupFault', 'BOOL', { bitOf: { member: 'ModuleFaults', bit: 14 } }),
    m('Calibrating', 'BOOL', { bitOf: { member: 'ModuleFaults', bit: 12 } }),
    m('CalFault', 'BOOL', { bitOf: { member: 'ModuleFaults', bit: 11 } }),
    ...range(8).flatMap((n) => [
      m(`Ch${n}Status`, 'SINT'),
      ...IF8_STATUS_BITS.map((b, bit) => m(`Ch${n}${b}`, 'BOOL', { bitOf: { member: `Ch${n}Status`, bit } })),
    ]),
    ...range(8).map((n) => m(`Ch${n}Data`, 'REAL', { description: `Channel ${n} value in engineering units` })),
    m('CSTTimestamp', 'DINT', { dims: 2 }),
    m('RollingTimestamp', 'INT'),
  ],
};

const T_1756_IF8_C: StructType = {
  name: 'AB:1756_IF8_Float:C:0',
  module: true,
  description: '1756-IF8 configuration (scaling 4-20 mA to engineering units)',
  members: [
    m('RealTimeSample', 'INT', { description: 'RTS period (ms)' }),
    ...range(8).flatMap((n) => [
      m(`Ch${n}RangeType`, 'SINT', { description: '0 = ±10 V, 1 = 0-5 V, 2 = 0-10 V, 3 = 0-20 mA' }),
      m(`Ch${n}DigitalFilter`, 'INT'),
      m(`Ch${n}LowSignal`, 'REAL'),
      m(`Ch${n}HighSignal`, 'REAL'),
      m(`Ch${n}LowEngineering`, 'REAL'),
      m(`Ch${n}HighEngineering`, 'REAL'),
    ]),
  ],
};

const T_1756_OF8_O: StructType = {
  name: 'AB:1756_OF8_Float:O:0',
  module: true,
  description: '1756-OF8 analog output data (floating point)',
  members: range(8).map((n) => m(`Ch${n}Data`, 'REAL', { description: `Channel ${n} output in engineering units` })),
};

const T_1756_OF8_I: StructType = {
  name: 'AB:1756_OF8_Float:I:0',
  module: true,
  description: '1756-OF8 analog output status',
  members: [
    m('ChannelFaults', 'INT'),
    ...range(8).map((n) => m(`Ch${n}Fault`, 'BOOL', { bitOf: { member: 'ChannelFaults', bit: n } })),
    ...range(8).map((n) => m(`Ch${n}Data`, 'REAL', { description: `Channel ${n} output echo` })),
    m('CSTTimestamp', 'DINT', { dims: 2 }),
    m('RollingTimestamp', 'INT'),
  ],
};

const T_1756_OF8_C: StructType = {
  name: 'AB:1756_OF8_Float:C:0',
  module: true,
  description: '1756-OF8 configuration',
  members: range(8).flatMap((n) => [
    m(`Ch${n}LowSignal`, 'REAL'),
    m(`Ch${n}HighSignal`, 'REAL'),
    m(`Ch${n}LowEngineering`, 'REAL'),
    m(`Ch${n}HighEngineering`, 'REAL'),
    m(`Ch${n}ProgMode`, 'BOOL', { description: '1 = hold last state in Program mode' }),
    m(`Ch${n}ProgValue`, 'REAL'),
  ]),
};

const T_5000_DI_PT: StructType = {
  name: 'AB:5000_DI_Point:I:0',
  module: true,
  members: [m('Data', 'BOOL', { description: 'Input point state' }), m('Fault', 'BOOL', { description: 'Point fault' })],
};
const T_5000_DO_PT_O: StructType = {
  name: 'AB:5000_DO_Point:O:0',
  module: true,
  members: [m('Data', 'BOOL', { description: 'Output point state' })],
};
const T_5000_DO_PT_I: StructType = {
  name: 'AB:5000_DO_Point:I:0',
  module: true,
  members: [m('Data', 'BOOL', { description: 'Output echo' }), m('Fault', 'BOOL', { description: 'Point fault' })],
};
const T_5000_AI_CH: StructType = {
  name: 'AB:5000_AI_Channel:I:0',
  module: true,
  members: [
    m('Data', 'REAL', { description: 'Channel value in engineering units' }),
    m('Fault', 'BOOL', { description: 'Channel fault (data is not valid)' }),
    m('Uncertain', 'BOOL', { description: 'Data may be inaccurate (out of calibrated range)' }),
    m('Underrange', 'BOOL'),
    m('Overrange', 'BOOL'),
  ],
};
const T_5000_AO_CH_O: StructType = {
  name: 'AB:5000_AO_Channel:O:0',
  module: true,
  members: [m('Data', 'REAL', { description: 'Output value in engineering units' })],
};
const T_5000_AO_CH_I: StructType = {
  name: 'AB:5000_AO_Channel:I:0',
  module: true,
  members: [m('Data', 'REAL', { description: 'Output echo' }), m('Fault', 'BOOL'), m('Uncertain', 'BOOL')],
};

const HEADER_5000: StructMember[] = [
  m('RunMode', 'BOOL', { description: 'Module is in Run mode (owner controller running)' }),
  m('ConnectionFaulted', 'BOOL', { description: 'Connection to the module is lost' }),
  m('DiagnosticActive', 'BOOL'),
  m('DiagnosticSequenceCount', 'SINT'),
];

const T_5000_DI16_I: StructType = {
  name: 'AB:5000_DI16:I:1',
  module: true,
  description: '5069-IB16 input data',
  members: [...HEADER_5000, ...range(16).map((n) => m(`Pt${two(n)}`, T_5000_DI_PT.name))],
};
const T_5000_DO16_O: StructType = {
  name: 'AB:5000_DO16:O:0',
  module: true,
  description: '5069-OB16 output data',
  members: range(16).map((n) => m(`Pt${two(n)}`, T_5000_DO_PT_O.name)),
};
const T_5000_DO16_I: StructType = {
  name: 'AB:5000_DO16:I:1',
  module: true,
  description: '5069-OB16 status',
  members: [...HEADER_5000, ...range(16).map((n) => m(`Pt${two(n)}`, T_5000_DO_PT_I.name))],
};
const T_5000_AI8_I: StructType = {
  name: 'AB:5000_AI8:I:1',
  module: true,
  description: '5069-IF8 input data',
  members: [...HEADER_5000, ...range(8).map((n) => m(`Ch${two(n)}`, T_5000_AI_CH.name))],
};
const T_5000_AO4_O: StructType = {
  name: 'AB:5000_AO4:O:0',
  module: true,
  description: '5069-OF4 output data',
  members: range(4).map((n) => m(`Ch${two(n)}`, T_5000_AO_CH_O.name)),
};
const T_5000_AO4_I: StructType = {
  name: 'AB:5000_AO4:I:0',
  module: true,
  description: '5069-OF4 status',
  members: [...HEADER_5000, ...range(4).map((n) => m(`Ch${two(n)}`, T_5000_AO_CH_I.name))],
};

/** Every module-defined data type, sub-structures first. */
export const MODULE_DATA_TYPES: readonly StructType[] = [
  T_1756_DI_I,
  T_1756_DI_C,
  T_1756_DOF_I,
  T_1756_DOF_O,
  T_1756_DOF_C,
  T_1756_IF8_I,
  T_1756_IF8_C,
  T_1756_OF8_O,
  T_1756_OF8_I,
  T_1756_OF8_C,
  T_5000_DI_PT,
  T_5000_DO_PT_O,
  T_5000_DO_PT_I,
  T_5000_AI_CH,
  T_5000_AO_CH_O,
  T_5000_AO_CH_I,
  T_5000_DI16_I,
  T_5000_DO16_O,
  T_5000_DO16_I,
  T_5000_AI8_I,
  T_5000_AO4_O,
  T_5000_AO4_I,
];

const TYPE_BY_NAME = new Map(MODULE_DATA_TYPES.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** Static information about every module the simulator can emulate. */
export const MODULE_CATALOG: Record<ModuleCatalog, CatalogEntry> = {
  '1756-L85E': {
    catalog: '1756-L85E',
    platform: 'ControlLogix',
    kind: 'CPU',
    description: 'ControlLogix 5580 controller, 40 MB user memory, 1 Gb EtherNet/IP port',
    points: 0,
    family: 'ControlLogix 5580',
  },
  '1756-L83E': {
    catalog: '1756-L83E',
    platform: 'ControlLogix',
    kind: 'CPU',
    description: 'ControlLogix 5580 controller, 10 MB user memory, 1 Gb EtherNet/IP port',
    points: 0,
    family: 'ControlLogix 5580',
  },
  '1756-EN2T': {
    catalog: '1756-EN2T',
    platform: 'ControlLogix',
    kind: 'COMM',
    description: 'EtherNet/IP 10/100 Mbps bridge module',
    points: 0,
    family: 'ControlLogix communication',
  },
  '1756-EN4TR': {
    catalog: '1756-EN4TR',
    platform: 'ControlLogix',
    kind: 'COMM',
    description: 'EtherNet/IP 1 Gbps dual-port (DLR) bridge module',
    points: 0,
    family: 'ControlLogix communication',
  },
  '1756-IB16': {
    catalog: '1756-IB16',
    platform: 'ControlLogix',
    kind: 'DI',
    description: '16-point 10…31.2V DC sinking input module',
    points: 16,
    inputType: T_1756_DI_I.name,
    configType: T_1756_DI_C.name,
    pointPath: 'I.Data.{n}',
    family: 'ControlLogix digital I/O',
  },
  '1756-OB16E': {
    catalog: '1756-OB16E',
    platform: 'ControlLogix',
    kind: 'DO',
    description: '16-point 10…31.2V DC electronically fused sourcing output module',
    points: 16,
    inputType: T_1756_DOF_I.name,
    outputType: T_1756_DOF_O.name,
    configType: T_1756_DOF_C.name,
    pointPath: 'O.Data.{n}',
    echoPath: 'I.Data.{n}',
    family: 'ControlLogix digital I/O',
  },
  '1756-IF8': {
    catalog: '1756-IF8',
    platform: 'ControlLogix',
    kind: 'AI',
    description: '8-channel non-isolated voltage/current analog input module',
    points: 8,
    inputType: T_1756_IF8_I.name,
    configType: T_1756_IF8_C.name,
    pointPath: 'I.Ch{n}Data',
    family: 'ControlLogix analog I/O',
  },
  '1756-OF8': {
    catalog: '1756-OF8',
    platform: 'ControlLogix',
    kind: 'AO',
    description: '8-channel non-isolated voltage/current analog output module',
    points: 8,
    inputType: T_1756_OF8_I.name,
    outputType: T_1756_OF8_O.name,
    configType: T_1756_OF8_C.name,
    pointPath: 'O.Ch{n}Data',
    echoPath: 'I.Ch{n}Data',
    family: 'ControlLogix analog I/O',
  },
  '5069-L320ER': {
    catalog: '5069-L320ER',
    platform: 'CompactLogix',
    kind: 'CPU',
    description: 'CompactLogix 5380 controller, 2 MB user memory, dual 1 Gb EtherNet/IP ports, 16 local I/O modules',
    points: 0,
    family: 'CompactLogix 5380',
  },
  '5069-L330ERM': {
    catalog: '5069-L330ERM',
    platform: 'CompactLogix',
    kind: 'CPU',
    description: 'CompactLogix 5380 controller, 3 MB user memory, integrated motion, dual 1 Gb EtherNet/IP ports',
    points: 0,
    family: 'CompactLogix 5380',
  },
  '5069-IB16': {
    catalog: '5069-IB16',
    platform: 'CompactLogix',
    kind: 'DI',
    description: '16-point 10…32V DC sinking input module',
    points: 16,
    inputType: T_5000_DI16_I.name,
    pointPath: 'I.Pt{nn}.Data',
    family: 'Compact 5000 I/O digital',
  },
  '5069-OB16': {
    catalog: '5069-OB16',
    platform: 'CompactLogix',
    kind: 'DO',
    description: '16-point 10…32V DC sourcing output module',
    points: 16,
    inputType: T_5000_DO16_I.name,
    outputType: T_5000_DO16_O.name,
    pointPath: 'O.Pt{nn}.Data',
    echoPath: 'I.Pt{nn}.Data',
    family: 'Compact 5000 I/O digital',
  },
  '5069-IF8': {
    catalog: '5069-IF8',
    platform: 'CompactLogix',
    kind: 'AI',
    description: '8-channel voltage/current analog input module',
    points: 8,
    inputType: T_5000_AI8_I.name,
    pointPath: 'I.Ch{nn}.Data',
    family: 'Compact 5000 I/O analog',
  },
  '5069-OF4': {
    catalog: '5069-OF4',
    platform: 'CompactLogix',
    kind: 'AO',
    description: '4-channel voltage/current analog output module',
    points: 4,
    inputType: T_5000_AO4_I.name,
    outputType: T_5000_AO4_O.name,
    pointPath: 'O.Ch{nn}.Data',
    echoPath: 'I.Ch{nn}.Data',
    family: 'Compact 5000 I/O analog',
  },
};

/** Number of slots of each 1756 chassis. */
export const CHASSIS_SLOTS: Record<NonNullable<HardwareConfig['chassis']>, number> = {
  '1756-A4': 4,
  '1756-A7': 7,
  '1756-A10': 10,
  '1756-A13': 13,
  '1756-A17': 17,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillTemplate(template: string, n: number): string {
  return template.replace('{nn}', two(n)).replace('{n}', String(n));
}

/**
 * Fully qualified operand of point/channel `index` of the module in `slot`
 * (DI/AI: input data, DO/AO: output data). Undefined for CPU/COMM modules or out-of-range points.
 *
 *   pointOperand('1756-IB16', 1, 3)  -> 'Local:1:I.Data.3'
 *   pointOperand('5069-OB16', 2, 5)  -> 'Local:2:O.Pt05.Data'
 */
export function pointOperand(catalog: ModuleCatalog, slot: number, index: number): string | undefined {
  const info = MODULE_CATALOG[catalog];
  if (!info?.pointPath || index < 0 || index >= info.points || !Number.isInteger(index)) return undefined;
  return `Local:${slot}:${fillTemplate(info.pointPath, index)}`;
}

/** For output modules: the input-tag member that echoes point `index` (e.g. 'Local:2:I.Data.3'). */
export function pointEchoOperand(catalog: ModuleCatalog, slot: number, index: number): string | undefined {
  const info = MODULE_CATALOG[catalog];
  if (!info?.echoPath || index < 0 || index >= info.points) return undefined;
  return `Local:${slot}:${fillTemplate(info.echoPath, index)}`;
}

/** The module configured in `slot`, if any. */
export function moduleForSlot(hw: HardwareConfig, slot: number): ModuleConfig | undefined {
  return hw.modules.find((mod) => mod.slot === slot);
}

/** The controller (CPU) module of a hardware configuration. */
export function controllerModule(hw: HardwareConfig): ModuleConfig | undefined {
  return hw.modules.find((mod) => MODULE_CATALOG[mod.catalog]?.kind === 'CPU');
}

/** True when the hardware has at least one I/O module (drives the controller I/O LED). */
export function hasIoModules(hw: HardwareConfig): boolean {
  return hw.modules.some((mod) => {
    const k = MODULE_CATALOG[mod.catalog]?.kind;
    return k === 'DI' || k === 'DO' || k === 'AI' || k === 'AO';
  });
}

/** Collect a type and all structure types it references. */
function collectTypes(name: DataTypeName, out: Map<string, StructType>): void {
  const t = TYPE_BY_NAME.get(name);
  if (!t || out.has(t.name)) return;
  for (const mem of t.members) collectTypes(mem.dataType, out);
  out.set(t.name, t);
}

function configInitial(catalog: ModuleCatalog): TagValue | undefined {
  switch (catalog) {
    case '1756-IB16':
      return {
        FilterOffOn_0_7: 1,
        FilterOnOff_0_7: 1,
        FilterOffOn_8_15: 1,
        FilterOnOff_8_15: 1,
        FilterOffOn_16_23: 1,
        FilterOnOff_16_23: 1,
        FilterOffOn_24_31: 1,
        FilterOnOff_24_31: 1,
        COSOnOffEn: 0xffff,
        COSOffOnEn: 0xffff,
      };
    case '1756-IF8': {
      const v: Record<string, TagValue> = { RealTimeSample: 100 };
      for (const n of range(8)) {
        v[`Ch${n}RangeType`] = 3;
        v[`Ch${n}LowSignal`] = 4;
        v[`Ch${n}HighSignal`] = 20;
        v[`Ch${n}LowEngineering`] = 0;
        v[`Ch${n}HighEngineering`] = 100;
      }
      return v;
    }
    case '1756-OF8': {
      const v: Record<string, TagValue> = {};
      for (const n of range(8)) {
        v[`Ch${n}LowSignal`] = 4;
        v[`Ch${n}HighSignal`] = 20;
        v[`Ch${n}LowEngineering`] = 0;
        v[`Ch${n}HighEngineering`] = 100;
      }
      return v;
    }
    default:
      return undefined;
  }
}

/**
 * Module-defined data types and the Local:<slot>:I / :O / :C tags for a hardware configuration.
 * Types are returned dependency-ordered (register them before defining the tags).
 */
export function ioTagsForHardware(hw: HardwareConfig): { types: StructType[]; tags: TagDef[] } {
  const types = new Map<string, StructType>();
  const tags: TagDef[] = [];
  const modules = [...hw.modules].sort((a, b) => a.slot - b.slot);
  for (const mod of modules) {
    const info = MODULE_CATALOG[mod.catalog];
    if (!info) continue;
    const label = mod.name ? `${mod.catalog} ${mod.name}` : mod.catalog;
    const add = (suffix: 'C' | 'I' | 'O', type: DataTypeName | undefined, what: string, initial?: TagValue): void => {
      if (!type) return;
      collectTypes(type, types);
      tags.push({
        name: `Local:${mod.slot}:${suffix}`,
        dataType: type,
        description: `${label} — ${what}`,
        system: true,
        ...(initial !== undefined ? { initial } : {}),
      });
    };
    add('C', info.configType, 'configuration', configInitial(mod.catalog));
    add('I', info.inputType, info.kind === 'DO' || info.kind === 'AO' ? 'status / output echo' : 'input data');
    add('O', info.outputType, 'output data');
  }
  return { types: [...types.values()], tags };
}

/** Output → echo operand pairs for every output point of every output module. */
export function ioEchoPairs(hw: HardwareConfig): Array<{ output: string; echo: string }> {
  const out: Array<{ output: string; echo: string }> = [];
  for (const mod of hw.modules) {
    const info = MODULE_CATALOG[mod.catalog];
    if (!info?.echoPath) continue;
    for (const n of range(info.points)) {
      const output = pointOperand(mod.catalog, mod.slot, n);
      const echo = pointEchoOperand(mod.catalog, mod.slot, n);
      if (output && echo) out.push({ output, echo });
    }
  }
  return out;
}

/** `Local:<slot>:I.RunMode` operands of Compact 5000 I/O modules (set while the controller runs). */
export function runModeOperands(hw: HardwareConfig): string[] {
  return hw.modules
    .filter((mod) => mod.catalog.startsWith('5069-') && MODULE_CATALOG[mod.catalog]?.inputType)
    .map((mod) => `Local:${mod.slot}:I.RunMode`);
}

/** Classify an operand path as module input/output/config data (`Local:<slot>:I|O|C…`). */
export function ioKindOfPath(path: string): 'I' | 'O' | 'C' | undefined {
  const mm = /^Local:\d+:([IOC])(?:$|[.[])/i.exec(path);
  return mm ? (mm[1]!.toUpperCase() as 'I' | 'O' | 'C') : undefined;
}
