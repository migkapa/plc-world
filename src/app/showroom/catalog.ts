/**
 * Hardware Showroom content: every device's catalog data, specs, indicator meanings, wiring notes, links
 * into the campaign, 3D framing and numbered hotspots. Pure data (no React / three imports).
 *
 * Accuracy policy: specs come from Rockwell Automation publications and distributor data sheets
 * (1756-UM543, 1756-TD002, 1756-UM004, 5069-UM001, 520-UM001, 2713P-TD001, 193-TD013, 1489-TD001 …).
 * Values we could not confirm against a primary source are flagged `approx: true` and shown with a
 * "check the data sheet" marker in the UI. Indicator tables are condensed: always use the module's own
 * user manual on real equipment. Not affiliated with Rockwell Automation.
 *
 * Coordinates: hotspot `at` and `camera` are in the device stage's world space (meters, Y up, device
 * front facing +Z) — see `stages/*.tsx` for how each device is placed.
 */

export type Vec3 = [number, number, number];

export type ShowroomGroupId = 'controllers' | 'io' | 'compact' | 'drives' | 'operator' | 'panel' | 'field' | 'traffic';

export interface ShowroomGroup {
  id: ShowroomGroupId;
  title: string;
  /** lucide-react icon name. */
  icon: 'Cpu' | 'Cable' | 'Server' | 'Gauge' | 'CircleDot' | 'PanelsTopLeft' | 'Factory' | 'TrafficCone';
  accent: string;
}

export const SHOWROOM_GROUPS: ShowroomGroup[] = [
  { id: 'controllers', title: 'Controllers & Chassis', icon: 'Cpu', accent: '#e0252b' },
  { id: 'io', title: 'I/O & Comms', icon: 'Cable', accent: '#f59e0b' },
  { id: 'compact', title: 'CompactLogix 5380', icon: 'Server', accent: '#38bdf8' },
  { id: 'drives', title: 'Drives & HMI', icon: 'Gauge', accent: '#a78bfa' },
  { id: 'operator', title: 'Operator devices', icon: 'CircleDot', accent: '#22c55e' },
  { id: 'panel', title: 'Panel', icon: 'PanelsTopLeft', accent: '#94a3b8' },
  { id: 'field', title: 'Field', icon: 'Factory', accent: '#f97316' },
  { id: 'traffic', title: 'Traffic & parking', icon: 'TrafficCone', accent: '#facc15' },
];

export interface SpecRow {
  label: string;
  value: string;
  /** Not confirmed against a primary source — show a "check the data sheet" marker. */
  approx?: boolean;
}

export type IndicatorColor = 'green' | 'red' | 'amber' | 'yellow' | 'orange' | 'blue' | 'white' | 'off' | 'redgreen';

export interface IndicatorState {
  color: IndicatorColor;
  blink?: boolean;
  /** Short state name, e.g. 'Steady green'. */
  state: string;
  meaning: string;
}

export interface IndicatorDef {
  name: string;
  states: IndicatorState[];
}

export interface Hotspot {
  label: string;
  /** Stage world position of the feature. */
  at: Vec3;
  /** Markdown explanation. */
  text: string;
  /** Outward normal: the marker fades when the feature faces away from the camera (default +Z). */
  normal?: Vec3;
}

export interface CameraFrame {
  position: Vec3;
  target: Vec3;
}

export interface ShowroomDevice {
  id: string;
  group: ShowroomGroupId;
  /** Display name. */
  name: string;
  /** Catalog number(s) as printed on the product (or a family name for generic field devices). */
  catalog: string;
  /** Product family line, e.g. 'ControlLogix 5580'. */
  family: string;
  /** One-liner shown under the name. */
  tagline: string;
  /** Markdown: what it is. */
  what: string;
  /** Markdown: where it is used. */
  where: string;
  specs: SpecRow[];
  indicators: IndicatorDef[];
  /** 'How it is wired': markdown summary + bullet notes (N.O./N.C., commons, fail-safe…). */
  wiring: { summary: string; notes: string[] };
  /** 'In PLC World': scenes / missions that use it. */
  inWorld: { scenes: string[]; missions: string[]; note: string };
  hotspots: Hotspot[];
  camera: CameraFrame;
  /** Characteristic size (m): floor shadow extent, zoom limits. */
  size: number;
  /** Accuracy / simplification note shown at the bottom of the card. */
  note?: string;
  /** Related device ids. */
  related?: string[];
  /** Search nicknames (e.g. 'vfd', 'photo eye', 'hmi'); filled from DEVICE_KEYWORDS below. */
  keywords?: string[];
}

// ---------------------------------------------------------------------------
// Shared indicator tables
// ---------------------------------------------------------------------------

/** Bi-colour OK indicator of 1756 digital / analog I/O modules (1756-UM058 / -UM009 family). */
const IO_OK_1756 = (outputs: boolean): IndicatorDef => ({
  name: 'OK',
  states: [
    { color: 'off', state: 'Off', meaning: 'No power to the module.' },
    {
      color: 'green',
      state: 'Steady green',
      meaning: outputs
        ? 'The outputs are actively controlled by the owner-controller (controller in Run).'
        : 'The inputs are being multicast to the owner-controller — normal operation.',
    },
    {
      color: 'green',
      blink: true,
      state: 'Flashing green',
      meaning: outputs
        ? 'Module passed its diagnostics but is not actively controlled (no connection, or the controller is in Program mode).'
        : 'Module passed its diagnostics but no connection is established (not owned / inhibited).',
    },
    { color: 'red', blink: true, state: 'Flashing red', meaning: 'A previously established connection has timed out.' },
    { color: 'red', state: 'Steady red', meaning: 'Module fault — the module must be replaced (or is still powering up).' },
  ],
});

const ANALOG_CAL: IndicatorDef = {
  name: 'CAL',
  states: [
    { color: 'off', state: 'Off', meaning: 'Normal operation.' },
    { color: 'green', blink: true, state: 'Flashing green', meaning: 'The module is being calibrated.' },
  ],
};

const RUN_1756: IndicatorDef = {
  name: 'RUN',
  states: [
    { color: 'off', state: 'Off', meaning: 'Program or Test mode — user tasks are not executing.' },
    { color: 'green', state: 'Steady green', meaning: 'Run mode — the controller is scanning its tasks.' },
  ],
};

const FORCE_LOGIX: IndicatorDef = {
  name: 'FORCE',
  states: [
    { color: 'off', state: 'Off', meaning: 'No tags contain I/O force values (forces disabled).' },
    { color: 'amber', state: 'Steady amber', meaning: 'I/O forces are ENABLED — forced values override field and logic.' },
    { color: 'amber', blink: true, state: 'Flashing amber', meaning: 'Force values are installed but forces are not enabled.' },
  ],
};

const SD_LOGIX: IndicatorDef = {
  name: 'SD',
  states: [
    { color: 'off', state: 'Off', meaning: 'No activity with the SD card.' },
    { color: 'green', blink: true, state: 'Flashing green', meaning: 'Reading from or writing to the card — do not remove it.' },
    { color: 'red', blink: true, state: 'Flashing red', meaning: 'The SD card does not have a valid file system.' },
    { color: 'red', state: 'Steady red', meaning: 'The controller does not recognise the SD card.' },
  ],
};

const OK_LOGIX: IndicatorDef = {
  name: 'OK',
  states: [
    { color: 'off', state: 'Off', meaning: 'No power applied.' },
    { color: 'green', state: 'Steady green', meaning: 'Controller is operating normally.' },
    { color: 'green', blink: true, state: 'Flashing green', meaning: 'Storing or loading a project to/from nonvolatile memory (SD card).' },
    { color: 'red', blink: true, state: 'Flashing red', meaning: 'Recoverable major fault (clear it: Clear Majors, or key PROG→RUN→PROG), or a firmware update is required.' },
    { color: 'red', state: 'Steady red', meaning: 'Completing power-up, or a non-recoverable major fault.' },
  ],
};

const NET_ENIP: IndicatorDef = {
  name: 'NET',
  states: [
    { color: 'off', state: 'Off', meaning: 'Not powered, or no IP address.' },
    { color: 'green', blink: true, state: 'Flashing green', meaning: 'Has an IP address but no CIP connections.' },
    { color: 'green', state: 'Steady green', meaning: 'Has an IP address and at least one CIP connection.' },
    { color: 'red', blink: true, state: 'Flashing red', meaning: 'One or more connections to this device timed out.' },
    { color: 'red', state: 'Steady red', meaning: 'Duplicate IP address detected on the network.' },
  ],
};

const LINK_ENIP: IndicatorDef = {
  name: 'LINK',
  states: [
    { color: 'off', state: 'Off', meaning: 'No link (cable unplugged / far end off) or port disabled.' },
    { color: 'green', state: 'Steady green', meaning: 'Link established, no traffic right now.' },
    { color: 'green', blink: true, state: 'Flashing green', meaning: 'Link established and frames are being transmitted/received.' },
  ],
};

/** Module status indicator of Compact 5000 I/O (5069-UM004 / -UM005). */
const MOD_STATUS_5069: IndicatorDef = {
  name: 'Module status',
  states: [
    { color: 'off', state: 'Off', meaning: 'No MOD power to the module.' },
    { color: 'green', state: 'Steady green', meaning: 'The module has an I/O connection and operates normally.' },
    { color: 'green', blink: true, state: 'Flashing green', meaning: 'Module is OK but no connection is established (not yet owned).' },
    { color: 'red', blink: true, state: 'Flashing red', meaning: 'Recoverable fault, e.g. the connection timed out.' },
    { color: 'red', state: 'Steady red', meaning: 'Non-recoverable fault — replace the module.' },
    { color: 'redgreen', blink: true, state: 'Flashing red/green', meaning: 'Self-test or firmware update in progress.' },
  ],
};

const IEC_LAMP_COLORS: IndicatorDef = {
  name: 'Colour (IEC 60204-1 / NFPA 79)',
  states: [
    { color: 'red', state: 'Red', meaning: 'Emergency — hazardous condition, act immediately (e.g. fault, E-stop).' },
    { color: 'yellow', state: 'Yellow / amber', meaning: 'Abnormal — impending critical condition (warning, low level).' },
    { color: 'green', state: 'Green', meaning: 'Normal — machine running / ready.' },
    { color: 'blue', state: 'Blue', meaning: 'Mandatory — operator action required (e.g. reset).' },
    { color: 'white', state: 'White / clear', meaning: 'Neutral — general information (power on).' },
  ],
};

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/** Rack stage: chassis origin at y = RACK_Y, backplane at z = 0. */
const RACK_Y = 0.05;
/** Slot-centre X of the 1756-A7 trainer rack (rack origin = chassis centre). */
const SLOT_X = (s: number) => -0.0493 + 0.035 * s;
/** Single ControlLogix modules are shown raised on a backplate. */
const MOD_Y = 0.11;
/** CompactLogix controller / modules raised on a backplate. */
const CPX_Y = 0.1;

export const SHOWROOM_DEVICES: ShowroomDevice[] = [
  // ------------------------------------------------------------------ Controllers & chassis
  {
    id: 'controllogix-rack',
    group: 'controllers',
    name: 'ControlLogix rack',
    catalog: '1756-A7 + PA72',
    family: 'ControlLogix 1756',
    tagline: 'The trainer bench rack: power supply, controller, I/O and Ethernet in one 7-slot chassis.',
    what:
      'A **ControlLogix system** is modular: a steel **chassis** with a passive backplane, a **power supply** on ' +
      'the left end, and plug-in modules in numbered slots (slot 0 is the leftmost). The controller can sit in ' +
      'any slot and talks to every module over the backplane. Modules can be removed and inserted under power ' +
      '(RIUP) when the application allows it.',
    where:
      'Machines, process skids and whole plant areas that need lots of I/O, several networks or redundancy. ' +
      'The same chassis holds controllers, I/O, communication bridges and motion modules.',
    specs: [
      { label: 'Chassis', value: '1756-A7: 7 slots (0–6), 1756-A4/A10/A13/A17 also available' },
      { label: 'Power supply', value: '1756-PA72 (85–265 V AC) on the left end' },
      { label: 'Slot 0', value: '1756-L85E ControlLogix 5580 controller' },
      { label: 'Slots 1–4', value: 'IB16 · OB16E · IF8 · OF8' },
      { label: 'Slot 5', value: '1756-EN2T EtherNet/IP bridge' },
      { label: 'Slot 6', value: 'Empty → 1756-N2 slot filler (keeps dust out, required in empty slots)' },
      { label: 'Module pitch', value: '≈ 35 mm per slot' },
    ],
    indicators: [RUN_1756, FORCE_LOGIX, OK_LOGIX, { ...IO_OK_1756(false), name: 'OK (I/O modules)' }],
    wiring: {
      summary:
        'Mains feeds only the power supply; it generates the backplane voltages for every module. Field devices ' +
        'land on each I/O module’s **removable terminal block (RTB)** behind its door, so a module can be swapped ' +
        'without disturbing the wiring.',
      notes: [
        'The I/O address follows the slot: a switch on slot 1 point 3 is `Local:1:I.Data.3`.',
        'Give each point an **alias tag** (e.g. `Start_PB` → `Local:1:I.Data.0`) so logic reads like the machine.',
        'Ground the chassis to the panel ground bar (functional earth) as the installation instructions require.',
        'Empty slots get a 1756-N2 filler.',
      ],
    },
    inWorld: {
      scenes: ['trainer', 'motor-station', 'conveyor-sort', 'tank-process'],
      missions: ['1-1', '1-5', '2-1', '7-6'],
      note: 'The trainer bench, motor station, sorting conveyor and tank all run on a 1756 rack like this one.',
    },
    hotspots: [
      { label: 'Power supply', at: [-0.1228, RACK_Y + 0.1, 0.139], text: '**1756-PA72** — converts 85–265 V AC into the backplane voltages. Always installed on the **left** end of the chassis.' },
      { label: 'Controller (slot 0)', at: [SLOT_X(0), RACK_Y + 0.1245, 0.141], text: '**1756-L85E** — runs your ladder logic. Its 4-character display scrolls the mode (`Rem Run`) and fault codes.' },
      { label: 'Digital input (slot 1)', at: [SLOT_X(1), RACK_Y + 0.125, 0.136], text: '**1756-IB16** — 16 × 24 V DC inputs. Each yellow **ST** LED shows the terminal voltage: `Local:1:I.Data.n`.' },
      { label: 'Digital output (slot 2)', at: [SLOT_X(2), RACK_Y + 0.125, 0.136], text: '**1756-OB16E** — 16 × 24 V DC sourcing outputs with electronic fuses: `Local:2:O.Data.n`. Outputs are off unless the controller is in Run.' },
      { label: 'Analog I/O (slots 3–4)', at: [(SLOT_X(3) + SLOT_X(4)) / 2, RACK_Y + 0.125, 0.136], text: '**1756-IF8 / OF8** — 8 analog inputs (pots, transmitters) and 8 analog outputs (meters, valves): `Local:3:I.Ch0Data`, `Local:4:O.Ch0Data`.' },
      { label: 'EtherNet/IP (slot 5)', at: [SLOT_X(5), RACK_Y + 0.1245, 0.141], text: '**1756-EN2T** — bridges the backplane to an Ethernet network (HMIs, drives, remote I/O). Its display scrolls the IP address.' },
      { label: 'Slot filler', at: [SLOT_X(6), RACK_Y + 0.075, 0.13], text: 'Unused slot 6 is covered by a **1756-N2** filler module.' },
    ],
    camera: { position: [0.13, 0.22, 0.56], target: [0, RACK_Y + 0.078, 0.07] },
    size: 0.45,
    related: ['1756-l85e', '1756-pa72', '1756-ib16', '1756-ob16e'],
  },
  {
    id: '1756-l85e',
    group: 'controllers',
    name: 'ControlLogix 5580 controller',
    catalog: '1756-L85E',
    family: 'ControlLogix 5580',
    tagline: 'The brain: runs tasks, programs and routines of Logix 5000 ladder logic.',
    what:
      'A single-slot **ControlLogix 5580** controller with 40 MB of user memory, a 4-character status display, ' +
      'a **RUN/REM/PROG key switch**, an SD card slot, a USB programming port and an embedded **1 Gb EtherNet/IP** ' +
      'port. It scans the continuous task (and periodic/event tasks), executes the ladder rungs and exchanges ' +
      'I/O data with its modules at their RPI.',
    where: 'Large machines, process units and plant-wide control; motion and multi-network systems.',
    specs: [
      { label: 'User memory', value: '40 MB' },
      { label: 'EtherNet/IP nodes', value: 'up to 300' },
      { label: 'Embedded port', value: '1 × RJ45 10/100/1000 Mbps EtherNet/IP (sloped lower front)' },
      { label: 'USB', value: 'USB 2.0 device port (programming / firmware)' },
      { label: 'Nonvolatile storage', value: 'SD card slot; ships with a 1784-SD2 card', approx: true },
      { label: 'Tasks', value: 'up to 32 tasks, 1000 programs per task' },
      { label: 'Battery', value: 'None — an internal energy-storage circuit saves the project on power loss' },
      { label: 'Key switch', value: 'RUN · REM · PROG' },
    ],
    indicators: [
      RUN_1756,
      FORCE_LOGIX,
      SD_LOGIX,
      OK_LOGIX,
      NET_ENIP,
      LINK_ENIP,
    ],
    wiring: {
      summary:
        'No field wiring: the controller gets power and I/O data through the backplane. Connect a laptop over ' +
        'Ethernet (or USB) to go online with Studio 5000 Logix Designer.',
      notes: [
        '**Key RUN**: runs; online mode changes are not allowed. **PROG**: stops logic, outputs go to their Program-mode state (off).',
        '**REM**: the software may switch between Remote Run and Remote Program — the usual position.',
        'The display scrolls `Rem Run`, IP address, and faults such as `Major Fault T04:C20` (array subscript out of range).',
        'Major faults stop the logic and turn outputs off until cleared.',
      ],
    },
    inWorld: {
      scenes: ['trainer', 'motor-station', 'tank-process'],
      missions: ['1-1', '2-4', '7-3', '7-6'],
      note: 'Every ControlLogix scene uses an L8x controller; missions teach modes, forces, prescan and fault codes.',
    },
    hotspots: [
      { label: 'Status display', at: [-0.0068, MOD_Y + 0.1219, 0.1385], text: 'Scrolling **4-character display** under the clear cap: mode (`Rem Run`, `Prog`), the IP address, and major fault codes like `Major Fault T04:C20`.' },
      { label: 'RUN · FORCE · SD · OK', at: [-0.003, MOD_Y + 0.1121, 0.1385], text: '**RUN** green = scanning logic. **FORCE** amber = forces enabled (flashing = installed, not enabled). **SD** = card activity. **OK** green = healthy, flashing red = major fault.' },
      { label: 'NET · LINK', at: [0.0056, MOD_Y + 0.1253, 0.1385], text: 'Status of the embedded **EtherNet/IP** port: NET = IP/CIP connections, LINK = cable link and traffic.' },
      { label: 'Key switch', at: [-0.0023, MOD_Y + 0.0872, 0.1395], text: '**RUN / REM / PROG** key lock. In REM the programming software can change the mode remotely. Try it in the demo panel!' },
      { label: 'SD card', at: [0.0122, MOD_Y + 0.0912, 0.1375], text: 'The key door hides the **SD card** slot, for storing the project and firmware (load on power-up / on corrupt memory).' },
      { label: 'USB port', at: [0.005, MOD_Y + 0.0617, 0.1385], text: '**USB 2.0** type-B device port for local programming and firmware updates — not for permanent HMI connections.' },
      { label: 'Ethernet port', at: [0, MOD_Y + 0.0305, 0.1325], normal: [0, -0.32, 0.95], text: 'The **1 Gb RJ45** jack sits in the sloped lower front, angled down so the patch cable drops into the wire duct.' },
    ],
    camera: { position: [0.15, MOD_Y + 0.14, 0.36], target: [0, MOD_Y + 0.068, 0.08] },
    size: 0.2,
    related: ['controllogix-rack', '5069-l320er'],
  },
  {
    id: '1756-pa72',
    group: 'controllers',
    name: 'ControlLogix power supply',
    catalog: '1756-PA72',
    family: 'ControlLogix 1756',
    tagline: 'Turns mains AC into the 1.2 V, 3.3 V, 5.1 V and 24 V DC the backplane needs.',
    what:
      'The **standard ControlLogix AC power supply**. It plugs into the left end of the chassis and powers every ' +
      'module through the backplane. It does not power field devices — those get their own 24 V DC supply (e.g. a 1606-XLS).',
    where: 'Every ControlLogix chassis needs one (or a redundant pair with the special redundant chassis).',
    specs: [
      { label: 'Input', value: '85–265 V AC, 47–63 Hz' },
      { label: 'Backplane outputs', value: '1.2 V · 3.3 V · 5.1 V · 24 V DC' },
      { label: 'Rail currents', value: '5.1 V: 10 A · 3.3 V: 4 A · 24 V: 2.8 A' },
      { label: '1.2 V rail', value: '1.5 A', approx: true },
      { label: 'Output power', value: '75 W max — all four rails combined (up to 60 °C)' },
      { label: 'Sibling', value: '1756-PB72: 18–32 V DC input version' },
      { label: 'Size', value: '≈ 140 × 112 × 145 mm (H × W × D)' },
    ],
    indicators: [
      {
        name: 'POWER',
        states: [
          { color: 'off', state: 'Off', meaning: 'No input power, or the supply has shut down (fault / overload).' },
          { color: 'green', state: 'Steady green', meaning: 'Supply is on and delivering backplane power.' },
        ],
      },
    ],
    wiring: {
      summary: 'Three screw terminals behind the hinged cover: **L1**, **L2/N** and **GND** (protective earth).',
      notes: [
        'Feed it from a branch circuit breaker (e.g. a 1489-M) or fuse.',
        'Size the supply by adding the backplane current of every module (use the Integrated Architecture Builder / module data).',
        'Keep 24 V field power separate: the chassis supply is for module electronics only.',
      ],
    },
    inWorld: {
      scenes: ['trainer', 'motor-station', 'conveyor-sort'],
      missions: [],
      note: 'Powers the ControlLogix racks of the trainer bench, motor station and conveyor.',
    },
    hotspots: [
      { label: 'POWER indicator', at: [0.0405, MOD_Y + 0.1036, 0.1395], text: 'Green **POWER** LED: the supply is delivering backplane power. Toggle the mains in the demo panel.' },
      { label: 'Vent grille', at: [0, MOD_Y + 0.128, 0.139], text: 'Convection cooling: keep the clearance above and below the chassis the installation manual asks for.' },
      { label: 'Nameplate', at: [-0.02, MOD_Y + 0.09, 0.139], text: 'Catalog number, input rating and backplane output currents.' },
      { label: 'Terminal cover', at: [0, MOD_Y + 0.035, 0.141], text: 'Hinged cover over **L1 · L2/N · GND**. Open it with the demo panel to see the terminals.' },
    ],
    camera: { position: [0.13, MOD_Y + 0.16, 0.4], target: [0, MOD_Y + 0.07, 0.1] },
    size: 0.2,
    related: ['controllogix-rack', '1606-xls'],
  },

  // ------------------------------------------------------------------ I/O & comms
  {
    id: '1756-ib16',
    group: 'io',
    name: 'Digital input module',
    catalog: '1756-IB16',
    family: 'ControlLogix 1756 I/O',
    tagline: '16 sinking 24 V DC inputs: push buttons, switches, sensors → bits.',
    what:
      'A **16-point DC input module** (current sinking). When a field device applies +24 V to an input terminal, ' +
      'current flows through the module to the group common and the point turns **ON** — its yellow **ST** ' +
      'indicator lights and the bit `Local:1:I.Data.n` becomes 1.',
    where: 'Push buttons, selector switches, limit switches, sourcing (PNP) sensors, relay contacts.',
    specs: [
      { label: 'Inputs', value: '16, current sinking, 2 groups of 8' },
      { label: 'Voltage', value: '10–31.2 V DC (24 V nominal)' },
      { label: 'ON-state', value: '≥ 10 V DC, 2 mA min' },
      { label: 'OFF-state', value: '≤ 5 V DC, ≤ 1.5 mA' },
      { label: 'Input filter', value: 'OFF→ON 0/1/2 ms, ON→OFF 0/1/2/9/18 ms (configurable)' },
      { label: 'RTB', value: '20-pin 1756-TBNH (screw) / 1756-TBSH (spring)' },
      { label: 'Tag', value: '`Local:<slot>:I.Data.0 … .15`' },
    ],
    indicators: [
      {
        name: 'ST 0–15 (yellow)',
        states: [
          { color: 'yellow', state: 'On', meaning: 'Voltage is present on the input terminal — the point is ON.' },
          { color: 'off', state: 'Off', meaning: 'The input is OFF.' },
        ],
      },
      IO_OK_1756(false),
    ],
    wiring: {
      summary:
        'Sinking input: **+24 V → field contact → IN-n terminal**, and the group common (GND) to **0 V**. ' +
        'Use sourcing (PNP) 3-wire sensors.',
      notes: [
        '**N.O. contact** (start button): input is 1 only while pressed → use **XIC**.',
        '**N.C. contact** (stop button, E-stop, overload 95-96): input is 1 at rest, 0 when operated or when the wire breaks → still use **XIC** for “healthy” — that is the classic N.C. trap.',
        'The ST LED shows the **terminal voltage**, not the tag: a forced input does not light it.',
        'Inputs 0–7 and 8–15 have separate commons.',
      ],
    },
    inWorld: {
      scenes: ['trainer', 'motor-station', 'conveyor-sort', 'tank-process'],
      missions: ['1-1', '1-5', '2-1', '2-3'],
      note: 'Switches and buttons of every ControlLogix scene land on slot 1.',
    },
    hotspots: [
      { label: 'ST indicators', at: [-0.002, MOD_Y + 0.1284, 0.1352], text: 'Yellow **ST 0–15**: one per input — lit when voltage is on the terminal. Toggle points in the demo panel.' },
      { label: 'OK indicator', at: [0.0105, MOD_Y + 0.1154, 0.1352], text: 'Bi-colour **OK**: steady green = inputs multicast to the owner, flashing green = no connection, red = fault.' },
      { label: 'RTB door', at: [0, MOD_Y + 0.055, 0.1395], text: 'Door over the **removable terminal block**. The inside of the door carries the wiring diagram label.' },
      { label: 'Removable terminal block', at: [0, MOD_Y + 0.02, 0.13], text: '20-pin **1756-TBNH**: swap a module without unscrewing field wires. Open the door in the demo panel.' },
    ],
    camera: { position: [0.12, MOD_Y + 0.13, 0.38], target: [0, MOD_Y + 0.07, 0.1] },
    size: 0.2,
    related: ['1756-ob16e', 'push-buttons-800f', 'photo-eye-42ef'],
  },
  {
    id: '1756-ob16e',
    group: 'io',
    name: 'Digital output module',
    catalog: '1756-OB16E',
    family: 'ControlLogix 1756 I/O',
    tagline: '16 sourcing 24 V DC outputs with electronic fuses.',
    what:
      'A **16-point DC output module** (current sourcing, electronically fused). When the output bit ' +
      '`Local:2:O.Data.n` is 1 **and the controller is in Run**, the module switches +24 V to the load. ' +
      'A short circuit trips the **electronic fuse** of that group instead of blowing a glass fuse.',
    where: 'Pilot lights, relay and contactor coils (24 V DC), solenoid valves, horns, stack lights.',
    specs: [
      { label: 'Outputs', value: '16, current sourcing, 2 groups of 8' },
      { label: 'Voltage', value: '10–31.2 V DC (24 V nominal)' },
      { label: 'Current', value: '1 A per point; 8 A per module max at 60 °C', approx: true },
      { label: 'Protection', value: 'Electronic fuse per group, resettable' },
      { label: 'RTB', value: '20-pin 1756-TBNH / 1756-TBSH' },
      { label: 'Tag', value: '`Local:<slot>:O.Data.0 … .15`' },
    ],
    indicators: [
      {
        name: 'ST 0–15 (yellow)',
        states: [
          { color: 'yellow', state: 'On', meaning: 'The output is switched ON (driving the load).' },
          { color: 'off', state: 'Off', meaning: 'The output is OFF.' },
        ],
      },
      {
        name: 'FUSE (per group)',
        states: [
          { color: 'off', state: 'Off', meaning: 'Group healthy.' },
          { color: 'red', state: 'Red', meaning: 'The electronic fuse of that group tripped (short circuit / overload). Fix the cause, then reset.' },
        ],
      },
      IO_OK_1756(true),
    ],
    wiring: {
      summary:
        'Sourcing output: the group supply terminal gets **+24 V**, each output drives **OUT-n → load → 0 V**. ' +
        'The module’s outputs go OFF in Program mode and on a major fault (configurable fault/program states).',
      notes: [
        'Contactor coils: drive a **24 V DC coil** directly, or an AC coil through an interposing relay.',
        'Use surge suppression on inductive loads as the user manual recommends.',
        'Never drive the same bit with two OTE instructions — the last rung wins (duplicate destructive bit).',
      ],
    },
    inWorld: {
      scenes: ['trainer', 'motor-station', 'conveyor-sort', 'tank-process'],
      missions: ['1-1', '2-2', '3-3', '6-2'],
      note: 'Every lamp, horn, contactor coil and valve in the ControlLogix scenes is driven from slot 2.',
    },
    hotspots: [
      { label: 'ST indicators', at: [-0.002, MOD_Y + 0.1284, 0.1352], text: 'Yellow **ST 0–15**: lit while the output is switched on.' },
      { label: 'FUSE indicators', at: [-0.0035, MOD_Y + 0.1154, 0.1352], text: 'One red **FUSE** LED per group (0–7, 8–15): the electronic fuse tripped. Try “Short circuit” in the demo panel.' },
      { label: 'OK indicator', at: [0.0105, MOD_Y + 0.1154, 0.1352], text: '**OK** steady green = outputs controlled by the controller in Run; **flashing green = Program mode** (outputs off).' },
      { label: 'RTB door', at: [0, MOD_Y + 0.055, 0.1395], text: 'Door over the removable terminal block with the wiring label.' },
    ],
    camera: { position: [0.12, MOD_Y + 0.13, 0.38], target: [0, MOD_Y + 0.07, 0.1] },
    size: 0.2,
    related: ['1756-ib16', 'contactor-100c', 'pilot-lights-800f'],
  },
  {
    id: '1756-if8',
    group: 'io',
    name: 'Analog input module',
    catalog: '1756-IF8',
    family: 'ControlLogix 1756 I/O',
    tagline: '8 voltage / current inputs: transmitters and potentiometers → REAL values.',
    what:
      'An **8-channel analog input module** (non-isolated). It converts ±10 V, 0–10 V, 0–5 V or 0–20 mA signals ' +
      'into numbers. Each channel can be scaled in the module configuration, e.g. **4–20 mA → 0.0–100.0 %**, so ' +
      '`Local:3:I.Ch0Data` is already in engineering units (a REAL).',
    where: 'Level, pressure, flow and temperature transmitters; potentiometers; speed feedback.',
    specs: [
      { label: 'Channels', value: '8 single-ended, 4 differential or 2 high-speed differential' },
      { label: 'Ranges', value: '±10 V · 0–10 V · 0–5 V · 0–20 mA' },
      { label: 'Resolution', value: 'up to 16 bits (depends on range)', approx: true },
      { label: 'RTB', value: '36-pin 1756-TBCH / 1756-TBS6H' },
      { label: 'Tags', value: '`Local:<slot>:I.Ch0Data` … `Ch7Data`, plus per-channel fault bits' },
    ],
    indicators: [ANALOG_CAL, IO_OK_1756(false)],
    wiring: {
      summary:
        'A **2-wire 4–20 mA transmitter** loop: +24 V → transmitter → module current input → return. For current ' +
        'inputs the channel’s IN and i terminals are jumpered to use the internal precision resistor (see the wiring ' +
        'diagram in the module manual).',
      notes: [
        'Use **shielded twisted pair**, shield grounded at one end only.',
        'A broken 4–20 mA loop reads **0 mA** — well below the live zero of 4 mA — so it can be detected (under-range bit).',
        'Scaling in the module saves an SCP instruction; otherwise scale raw counts in logic.',
      ],
    },
    inWorld: {
      scenes: ['trainer', 'tank-process'],
      missions: ['5-1', '5-3', '5-5', '7-5'],
      note: 'The trainer pots and the tank’s level (LT-101) and temperature (TT-101) transmitters feed an IF8.',
    },
    hotspots: [
      { label: 'CAL indicator', at: [-0.004, MOD_Y + 0.1284, 0.1352], text: '**CAL** flashes green while the module is being calibrated.' },
      { label: 'OK indicator', at: [0.0105, MOD_Y + 0.1154, 0.1352], text: '**OK**: green = inputs multicast to the owner, flashing green = no connection.' },
      { label: '36-pin RTB', at: [0, MOD_Y + 0.02, 0.13], text: 'Analog modules use the 36-pin **1756-TBCH**: IN+/IN−/i terminals per channel plus RTN and shield.' },
    ],
    camera: { position: [0.12, MOD_Y + 0.13, 0.38], target: [0, MOD_Y + 0.07, 0.1] },
    size: 0.2,
    related: ['1756-of8', 'tank-instruments'],
  },
  {
    id: '1756-of8',
    group: 'io',
    name: 'Analog output module',
    catalog: '1756-OF8',
    family: 'ControlLogix 1756 I/O',
    tagline: '8 voltage / current outputs: drive meters, control valves and speed references.',
    what:
      'An **8-channel analog output module**. Each channel drives either a voltage (±10 V) or a current ' +
      '(0–21 mA) signal proportional to `Local:4:O.Ch0Data`. Like digital outputs, analog outputs only follow ' +
      'the logic while the controller is in Run.',
    where: 'Control valve positioners, VFD speed references, panel meters, chart recorders.',
    specs: [
      { label: 'Channels', value: '8, voltage or current per channel' },
      { label: 'Ranges', value: '±10.4 V · 0–21 mA' },
      { label: 'Resolution', value: '15 bits across 21 mA (≈ 650 nA/bit) · 15 bits across 10.4 V (≈ 320 µV/bit)', approx: true },
      { label: 'Current drive', value: '0–750 Ω load', approx: true },
      { label: 'RTB', value: '20-pin 1756-TBNH / 1756-TBSH' },
    ],
    indicators: [ANALOG_CAL, IO_OK_1756(true)],
    wiring: {
      summary: 'Wire the load between the channel’s **VOUT-n** (voltage) or **IOUT-n** (current) terminal and **RTN**.',
      notes: [
        'Use either VOUT or IOUT on a channel — never both.',
        'Current outputs tolerate long cable runs and noise better than voltage outputs.',
        'Configure the program/fault mode value (hold last, go to a safe value) in the module properties.',
      ],
    },
    inWorld: {
      scenes: ['trainer', 'tank-process'],
      missions: ['5-2', '5-4'],
      note: 'Drives the trainer’s panel meter and LED bar graph, and the tank’s FCV-101 control valve.',
    },
    hotspots: [
      { label: 'CAL indicator', at: [-0.004, MOD_Y + 0.1284, 0.1352], text: '**CAL** flashes green during calibration.' },
      { label: 'OK indicator', at: [0.0105, MOD_Y + 0.1154, 0.1352], text: '**OK** flashing green = not actively controlled (controller in Program) — outputs hold their program-mode value.' },
      { label: 'RTB', at: [0, MOD_Y + 0.02, 0.13], text: 'VOUT / IOUT per channel with a shared RTN.' },
    ],
    camera: { position: [0.12, MOD_Y + 0.13, 0.38], target: [0, MOD_Y + 0.07, 0.1] },
    size: 0.2,
    related: ['1756-if8'],
  },
  {
    id: '1756-en2t',
    group: 'io',
    name: 'EtherNet/IP communication module',
    catalog: '1756-EN2T',
    family: 'ControlLogix 1756 comms',
    tagline: 'Bridges the ControlLogix backplane to an Ethernet network.',
    what:
      'An **EtherNet/IP bridge module**. HMIs, drives, remote I/O and other controllers connect to the chassis ' +
      'through it; it also lets a laptop reach any module in the rack. Its display scrolls the IP address and status.',
    where: 'Every networked ControlLogix system: HMI traffic, produced/consumed tags, drives, remote I/O adapters.',
    specs: [
      { label: 'Port', value: '1 × RJ45, 10/100 Mbps' },
      { label: 'Connections', value: '256 CIP connections, 128 TCP/IP connections' },
      { label: 'Configuration', value: 'IP by rotary switches, BOOTP/DHCP or software; USB port for setup', approx: true },
      { label: 'Related', value: '1756-EN2TR (2 ports, DLR ring) · 1756-EN4TR (current high-capacity module)' },
    ],
    indicators: [
      {
        name: 'Display',
        states: [
          { color: 'red', state: 'Scrolling text', meaning: 'IP address, module status (`OK`), duplicate-IP and error messages.' },
        ],
      },
      LINK_ENIP,
      NET_ENIP,
      {
        name: 'OK',
        states: [
          { color: 'off', state: 'Off', meaning: 'No power.' },
          { color: 'green', blink: true, state: 'Flashing green', meaning: 'Module not configured.' },
          { color: 'green', state: 'Steady green', meaning: 'Operating correctly.' },
          { color: 'red', blink: true, state: 'Flashing red', meaning: 'Recoverable fault (e.g. firmware update needed).' },
          { color: 'red', state: 'Steady red', meaning: 'Non-recoverable fault.' },
        ],
      },
    ],
    wiring: {
      summary: 'Shielded Cat5e/Cat6 patch cable from the RJ45 on the underside to a managed industrial switch.',
      notes: ['Plan an IP address per device and keep control networks separate from the office network.', 'NET steady red = someone else has your IP address.'],
    },
    inWorld: {
      scenes: ['trainer', 'motor-station', 'conveyor-sort', 'tank-process'],
      missions: [],
      note: 'Present in every ControlLogix rack of PLC World (slot 3 or 5).',
    },
    hotspots: [
      { label: 'Display', at: [0, MOD_Y + 0.1245, 0.1405], text: 'Scrolls `IP=192.168.1.10` and `OK`. First thing to read when a network device “disappears”.' },
      { label: 'LINK · NET · OK', at: [-0.0118, MOD_Y + 0.105, 0.1405], text: 'LINK = cable/traffic, NET = IP & CIP connections, OK = module health.' },
      { label: 'RJ45 port', at: [0, MOD_Y - 0.002, 0.129], normal: [0, -1, 0.3], text: 'The Ethernet jack faces down (cable exits into the wire duct).' },
    ],
    camera: { position: [0.1, MOD_Y + 0.14, 0.36], target: [0, MOD_Y + 0.065, 0.11] },
    size: 0.2,
    related: ['1756-l85e', 'panelview-5310', 'powerflex-525'],
  },

  // ------------------------------------------------------------------ CompactLogix 5380
  {
    id: '5069-l320er',
    group: 'compact',
    name: 'CompactLogix 5380 controller',
    catalog: '5069-L320ER',
    family: 'CompactLogix 5380',
    tagline: 'A DIN-rail controller with dual Gigabit Ethernet and local Compact 5000 I/O.',
    what:
      'A **CompactLogix 5380** controller: same Logix 5000 firmware and instruction set as ControlLogix, in a ' +
      'DIN-rail package. Compact 5000 I/O modules snap on to its right; a **mode switch** (RUN/REM/PROG) replaces ' +
      'the key. Two **1 Gb EtherNet/IP** ports can be used as a linear/DLR ring or as two separate networks (dual-IP).',
    where: 'Small and mid-size machines, packaging lines, OEM skids, infrastructure (traffic, parking, water).',
    specs: [
      { label: 'User memory', value: '2 MB' },
      { label: 'Local I/O modules', value: 'up to 16' },
      { label: 'EtherNet/IP nodes', value: 'up to 40' },
      { label: 'Ethernet', value: '2 × RJ45 10/100/1000 Mbps (A1, A2)' },
      { label: 'USB', value: '1 × USB (12 Mbps), programming only' },
      { label: 'Storage', value: 'SD card, ships with 1784-SD2 (2 GB)' },
      { label: 'Tasks', value: '32 tasks, 1000 programs per task' },
      { label: 'Power', value: 'MOD power 18–32 V DC (backplane) + SA power (field side)', approx: true },
    ],
    indicators: [
      { name: 'SA PWR / MOD PWR', states: [{ color: 'green', state: 'Steady green', meaning: 'Sensor/actuator (field) power / module (backplane) power present.' }, { color: 'off', state: 'Off', meaning: 'That supply is missing.' }] },
      RUN_1756,
      FORCE_LOGIX,
      SD_LOGIX,
      OK_LOGIX,
      { ...NET_ENIP, name: 'NET A1 / A2' },
      { ...LINK_ENIP, name: 'LINK A1 / A2' },
    ],
    wiring: {
      summary:
        'Two 24 V DC feeds on the power column: **MOD power** runs the controller and the module electronics over ' +
        'the backplane; **SA power** is passed along the modules to supply input modules and field sensors. ' +
        'Some output modules (e.g. the 5069-OB16) take their own **LA** (local actuator) power on their RTB instead.',
      notes: [
        'Keeping MOD and SA on separate supplies lets you kill field power (e.g. from a safety relay) while the controller stays online.',
        'SA power only reaches modules that draw it: a 5069-OB16 passes SA straight through to its neighbour and switches its outputs from LA+ / LA−.',
        'The Ethernet jacks are on the underside — cables drop straight into the duct.',
        'The last local module needs a **5069-ECR** end cap.',
      ],
    },
    inWorld: {
      scenes: ['traffic-light', 'parking-garage'],
      missions: ['3-6', '3-7', '4-4', '6-3'],
      note: 'The traffic intersection and the parking garage are controlled by a 5069-L320ER.',
    },
    hotspots: [
      { label: 'Status display', at: [-0.003, CPX_Y + 0.121, 0.1375], text: '4-character display: mode, IP addresses and fault codes — just like the ControlLogix 5580.' },
      { label: 'Status indicators', at: [-0.001, CPX_Y + 0.1005, 0.1375], text: 'SA PWR, MOD PWR, RUN, FORCE, SD, OK and NET/LINK for ports A1 and A2.' },
      { label: 'Mode switch', at: [-0.016, CPX_Y + 0.0715, 0.1375], text: '3-position **RUN / REM / PROG** switch (a lever, not a key). Click it or use the demo panel.' },
      { label: 'SD card', at: [0.022, CPX_Y + 0.0775, 0.1375], text: 'SD card slot: project backup, firmware and load-on-power-up.' },
      { label: 'USB port', at: [0.022, CPX_Y + 0.057, 0.1375], text: 'USB for local programming and firmware updates.' },
      { label: 'Ethernet A1 / A2', at: [0.011, CPX_Y - 0.001, 0.126], normal: [0, -1, 0.3], text: 'Two Gigabit ports on the underside: linear/DLR ring or two separate subnets (dual-IP mode).' },
      { label: 'Power column', at: [-0.038, CPX_Y + 0.07, 0.125], text: 'Removable connectors for **MOD** (backplane) and **SA** (field) 24 V DC power.' },
    ],
    camera: { position: [0.14, CPX_Y + 0.14, 0.42], target: [0, CPX_Y + 0.065, 0.1] },
    size: 0.22,
    related: ['5069-ib16', '5069-ob16', '1756-l85e'],
  },
  {
    id: '5069-ib16',
    group: 'compact',
    name: 'Compact 5000 digital input',
    catalog: '5069-IB16',
    family: 'Compact 5000 I/O',
    tagline: '16 sinking 24 V DC inputs on a 22 mm-wide module.',
    what:
      'A **16-point sinking DC input module** for CompactLogix 5380 local I/O. Each point has a numbered status ' +
      'indicator. Tags use a per-point structure: `Local:1:I.Pt00.Data`.',
    where: 'Buttons, switches, loop detectors and PNP sensors of compact machines.',
    specs: [
      { label: 'Inputs', value: '16, sinking' },
      { label: 'Voltage', value: '24 V DC nominal', approx: false },
      { label: 'Filter', value: 'Configurable OFF→ON / ON→OFF filter times per point', approx: true },
      { label: 'RTB', value: '18-pin removable terminal block (screw or spring)' },
      { label: 'Width', value: '22 mm' },
      { label: 'Tags', value: '`Local:<slot>:I.Pt00.Data` … `Pt15.Data`' },
    ],
    indicators: [
      MOD_STATUS_5069,
      { name: 'Point status (0–15)', states: [{ color: 'yellow', state: 'Yellow', meaning: 'Input is ON.' }, { color: 'off', state: 'Off', meaning: 'Input is OFF.' }] },
    ],
    wiring: {
      summary: 'Field power comes from the **SA bus**; wire each sensor/contact between +24 V and its input terminal, commons to 0 V.',
      notes: ['Same N.O./N.C. rules as any sinking input: an N.C. stop reads 1 at rest.', 'Point addressing uses two digits: Pt00 … Pt15.'],
    },
    inWorld: { scenes: ['traffic-light', 'parking-garage'], missions: ['3-7', '4-4'], note: 'Reads the pedestrian button, loop detectors, photo-eyes and ticket button.' },
    hotspots: [
      { label: 'Module status', at: [-0.006, CPX_Y + 0.1365, 0.107], text: 'Bi-colour module status: green = connected, flashing green = no connection yet, red = fault.' },
      { label: 'Point indicators', at: [0, CPX_Y + 0.12, 0.107], text: 'Numbered yellow point indicators, one per input.' },
      { label: 'RTB', at: [0, CPX_Y + 0.05, 0.106], text: '18-pin removable terminal block: pull it off with the release latch under the indicator head.' },
    ],
    camera: { position: [0.12, CPX_Y + 0.12, 0.3], target: [0, CPX_Y + 0.07, 0.07] },
    size: 0.18,
    related: ['5069-ob16', '5069-l320er'],
  },
  {
    id: '5069-ob16',
    group: 'compact',
    name: 'Compact 5000 digital output',
    catalog: '5069-OB16',
    family: 'Compact 5000 I/O',
    tagline: '16 sourcing 24 V DC outputs, point-level status.',
    what:
      'A **16-point sourcing DC output module**. Its outputs are powered from an external 24 V DC supply wired to ' +
      'the **LA+ / LA−** (local actuator) terminals on its own RTB and switch that voltage to their loads — it does ' +
      '**not** draw SA power (it just passes the SA bus on to the next module). Point indicators are bi-colour: ' +
      'yellow = on, red = point fault (when the diagnostics are enabled).',
    where: 'Lamps, signal heads, solenoids, relays, barrier gate motor contactors.',
    specs: [
      { label: 'Outputs', value: '16, sourcing' },
      { label: 'Voltage', value: '10–32 V DC via LA+ / LA− (local actuator power)' },
      { label: 'Current', value: '0.5 A per point, 8 A per module' },
      { label: 'SA power', value: 'Not used — passed through to the next module' },
      { label: 'Diagnostics', value: 'Per-point fault reporting, e.g. no-load (enable in configuration)', approx: true },
      { label: 'Tags', value: '`Local:<slot>:O.Pt00.Data` …' },
    ],
    indicators: [
      MOD_STATUS_5069,
      {
        name: 'Point status (0–15)',
        states: [
          { color: 'yellow', state: 'Yellow', meaning: 'Output is ON.' },
          { color: 'red', blink: true, state: 'Red (flashing)', meaning: 'Point fault, e.g. no load connected with no-load diagnostics enabled.' },
          { color: 'off', state: 'Off', meaning: 'Output is OFF.' },
        ],
      },
    ],
    wiring: {
      summary: 'Wire an external 24 V DC supply to **LA+ / LA−** on the RTB. Current path: **LA+ → module → OUT-n → load → LA− (0 V)**.',
      notes: [
        'No LA power = no outputs, even with the controller in Run and the point indicators requested on. SA power does **not** feed this module.',
        'Switching LA+ through a safety relay or contactor group-disables every output of the module at once.',
        'Outputs turn off in Program mode and on a major fault.',
        'A load that is too small (LED lamp) can trigger a no-load diagnostic.',
      ],
    },
    inWorld: { scenes: ['traffic-light', 'parking-garage'], missions: ['3-6', '6-3', '4-5'], note: 'Drives every traffic lamp, WALK/DON’T WALK and the garage gates and signs.' },
    hotspots: [
      { label: 'Module status', at: [-0.006, CPX_Y + 0.1365, 0.107], text: 'Module status indicator (see table).' },
      { label: 'Point indicators', at: [0, CPX_Y + 0.12, 0.107], text: 'Yellow = on, red = point fault. Use “Point fault” in the demo panel.' },
      { label: 'RTB', at: [0, CPX_Y + 0.05, 0.106], text: '18-pin removable terminal block with the outputs and the **LA+ / LA−** local-actuator power terminals.' },
    ],
    camera: { position: [0.12, CPX_Y + 0.12, 0.3], target: [0, CPX_Y + 0.07, 0.07] },
    size: 0.18,
    related: ['5069-ib16', 'signal-head'],
  },
  {
    id: '5069-if8',
    group: 'compact',
    name: 'Compact 5000 analog input',
    catalog: '5069-IF8',
    family: 'Compact 5000 I/O',
    tagline: '8 current / voltage inputs with per-channel status.',
    what: 'An **8-channel analog input module** (current or voltage per channel) with a status indicator per channel that turns red on a channel fault such as an open 4–20 mA loop.',
    where: 'Transmitters on compact machines and skids.',
    specs: [
      { label: 'Channels', value: '8, current or voltage' },
      { label: 'Ranges', value: '4–20 mA, 0–20 mA, ±10 V, 0–10 V, 0–5 V, 1–5 V', approx: true },
      { label: 'Resolution', value: '16 bits', approx: true },
      { label: 'Tags', value: '`Local:<slot>:I.Ch00.Data` (+ Fault, Underrange, Overrange)' },
    ],
    indicators: [
      MOD_STATUS_5069,
      { name: 'Channel status', states: [{ color: 'green', state: 'Green', meaning: 'Channel operating normally.' }, { color: 'red', state: 'Red', meaning: 'Channel fault (open wire, under/over-range…).' }, { color: 'off', state: 'Off', meaning: 'Channel disabled / no connection.' }] },
    ],
    wiring: { summary: 'Shielded twisted pairs from the transmitters; shield drains to the module’s shield terminal or the panel ground.', notes: ['A 2-wire transmitter is powered through its own loop (24 V → Tx → input).'] },
    inWorld: { scenes: [], missions: [], note: 'Not used by a scene yet — the tank uses the ControlLogix 1756-IF8.' },
    hotspots: [
      { label: 'Module status', at: [-0.006, CPX_Y + 0.1365, 0.107], text: 'Module status indicator.' },
      { label: 'Channel indicators', at: [0, CPX_Y + 0.12, 0.107], text: 'Green = OK, red = channel fault. Try “Open loop” in the demo panel.' },
      { label: 'RTB', at: [0, CPX_Y + 0.05, 0.106], text: '18-pin RTB with shield terminals.' },
    ],
    camera: { position: [0.12, CPX_Y + 0.12, 0.3], target: [0, CPX_Y + 0.07, 0.07] },
    size: 0.18,
    related: ['5069-of4', '1756-if8'],
  },
  {
    id: '5069-of4',
    group: 'compact',
    name: 'Compact 5000 analog output',
    catalog: '5069-OF4',
    family: 'Compact 5000 I/O',
    tagline: '4 current / voltage outputs.',
    what: 'A **4-channel analog output module** (current or voltage per channel) for speed references and valve positioners.',
    where: 'VFD speed references, control valves, panel meters.',
    specs: [
      { label: 'Channels', value: '4, current or voltage' },
      { label: 'Ranges', value: '0–20 mA, 4–20 mA, ±10 V, 0–10 V, 0–5 V, 1–5 V', approx: true },
      { label: 'Resolution', value: '16 bits', approx: true },
      { label: 'Tags', value: '`Local:<slot>:O.Ch00.Data`' },
    ],
    indicators: [MOD_STATUS_5069, { name: 'Channel status', states: [{ color: 'green', state: 'Green', meaning: 'Channel operating normally.' }, { color: 'red', state: 'Red', meaning: 'Channel fault.' }] }],
    wiring: { summary: 'Load between the channel output and its return; shielded cable.', notes: ['Configure the Program/Fault mode output value for a safe state.'] },
    inWorld: { scenes: [], missions: [], note: 'Showroom only for now.' },
    hotspots: [
      { label: 'Module status', at: [-0.006, CPX_Y + 0.1365, 0.107], text: 'Module status indicator.' },
      { label: 'Channel indicators', at: [0, CPX_Y + 0.12, 0.107], text: 'One status indicator per channel.' },
      { label: 'RTB', at: [0, CPX_Y + 0.05, 0.106], text: '18-pin removable terminal block.' },
    ],
    camera: { position: [0.12, CPX_Y + 0.12, 0.3], target: [0, CPX_Y + 0.07, 0.07] },
    size: 0.18,
    related: ['5069-if8', '1756-of8'],
  },

  // ------------------------------------------------------------------ Drives & HMI
  {
    id: 'powerflex-525',
    group: 'drives',
    name: 'PowerFlex 525 AC drive',
    catalog: '25B-D4P0N104',
    family: 'PowerFlex 520-series',
    tagline: 'A compact VFD: variable speed for 3-phase motors, embedded EtherNet/IP.',
    what:
      'A **variable frequency drive (VFD)**: it rectifies the mains to a DC bus, then an IGBT inverter synthesises ' +
      'a variable-frequency, variable-voltage 3-phase output — so the motor speed follows the frequency. The ' +
      'removable **control module** carries the LCD, keypad and control terminals; the power module carries the ' +
      'power terminals and heat sink.',
    where: 'Conveyors, fans, pumps, mixers — anywhere a motor needs soft starting or variable speed.',
    specs: [
      { label: 'This unit', value: 'Frame A, 380–480 V 3-phase, 1.5 kW / 2 HP, 4.0 A' },
      { label: 'Range', value: '0.4–22 kW (0.5–30 HP), 100–600 V classes' },
      { label: 'Output', value: '0–500 Hz' },
      { label: 'Motor control', value: 'V/Hz, sensorless vector, closed-loop velocity vector (with encoder card), PM motors' },
      { label: 'Network', value: 'Embedded EtherNet/IP port' },
      { label: 'Control I/O', value: '7 digital in, 2 analog in, 1 analog out, 2 opto out, 2 relay out', approx: true },
      { label: 'Safety', value: 'Safe Torque Off (STO) input' },
    ],
    indicators: [
      {
        name: 'FAULT',
        states: [
          { color: 'red', blink: true, state: 'Flashing red', meaning: 'Drive is faulted — the display shows `F xxx` (e.g. F002 Auxiliary In, F007 Motor Overload).' },
          { color: 'off', state: 'Off', meaning: 'No fault.' },
        ],
      },
      {
        name: 'ENET',
        states: [
          { color: 'off', state: 'Off', meaning: 'Not connected to the network.' },
          { color: 'green', state: 'Steady', meaning: 'Connected and the drive is controlled through Ethernet.' },
          { color: 'green', blink: true, state: 'Flashing', meaning: 'Connected, but not controlled through Ethernet (e.g. no I/O connection).' },
        ],
      },
      {
        name: 'LINK',
        states: [
          { color: 'off', state: 'Off', meaning: 'No network link.' },
          { color: 'green', state: 'Steady', meaning: 'Linked, not transmitting.' },
          { color: 'green', blink: true, state: 'Flashing', meaning: 'Linked and transmitting.' },
        ],
      },
    ],
    wiring: {
      summary:
        'Mains **R/L1 S/L2 T/L3** through branch protection; motor on **U/T1 V/T2 W/T3**; PE to both. Control ' +
        'from the PLC over EtherNet/IP (Logic Command word + speed reference) or hard-wired to the control terminals.',
      notes: [
        'Terminal **01 = Stop** input: it must be closed to run (factory jumper to +24 V). Wire an N.C. stop there.',
        '3-wire control: 02 = Start (N.O. momentary), 01 = Stop (N.C.).',
        'Never switch a contactor between the drive and a running motor.',
        'STO terminals come jumpered; a safety relay can open them to remove torque.',
      ],
    },
    inWorld: { scenes: [], missions: [], note: 'Showroom only — the motor station uses a contactor starter. Drives are a great next step after Chapter 2.' },
    hotspots: [
      { label: 'LCD display', at: [0, 0.1 + 0.128, 0.173], text: '5-digit display with annunciators: output frequency, parameters, fault codes (`F 002`).' },
      { label: 'Keypad', at: [0.012, 0.1 + 0.103, 0.173], text: 'Membrane keypad: Esc, Sel, ▲▼, Enter, Reverse, green **Start**, red **Stop** and the speed potentiometer.' },
      { label: 'Status LEDs', at: [-0.028, 0.1 + 0.132, 0.173], text: '**ENET**, **LINK** and **FAULT** indicators.' },
      { label: 'Power terminals', at: [0, 0.1 + 0.03, 0.13], text: 'Finger-safe guard over **R S T** (line) and **U V W** (motor), DC bus and brake terminals.' },
      { label: 'Heat sink & fan', at: [0, 0.1 + 0.155, 0.03], normal: [0, 1, 0], text: 'Aluminium heat sink with a cooling fan: mount vertically with clearance above and below.' },
      { label: 'Ethernet port', at: [-0.02, 0.1 + 0.02, 0.12], text: 'Embedded **EtherNet/IP** RJ45 — the PLC sends start/stop and speed over the network.' },
    ],
    camera: { position: [0.17, 0.28, 0.45], target: [0, 0.18, 0.1] },
    size: 0.24,
    related: ['motor', 'contactor-100c', 'panelview-5310'],
  },
  {
    id: 'panelview-5310',
    group: 'drives',
    name: 'PanelView 5310 HMI',
    catalog: '2713P-T7WD1',
    family: 'PanelView 5310',
    tagline: 'A 7" touchscreen operator terminal for Logix 5000 controllers.',
    what:
      'A **graphic terminal (HMI)** mounted in the panel door. Screens are built in **Studio 5000 View Designer** ' +
      'and reference controller tags directly (no separate HMI tag database). This one is interactive — tap it!',
    where: 'Machine operator panels: start/stop, recipes, alarms, trends, manual modes.',
    specs: [
      { label: 'Display', value: '7" widescreen, 800 × 480, touch' },
      { label: 'Other sizes', value: '9" (800 × 480), 10.4" (800 × 600), 12.1" (1280 × 800)' },
      { label: 'Touch', value: 'Analog resistive, 1 million actuations' },
      { label: 'Power', value: '18–30 V DC (24 V DC nominal, SELV/PELV)' },
      { label: 'Network', value: '1 × EtherNet/IP 10/100' },
      { label: 'Controllers', value: 'One Logix controller (5570/5580, 5370/5380/5480)' },
      { label: 'Software', value: 'Studio 5000 View Designer' },
    ],
    indicators: [
      { name: 'Status (rear)', states: [{ color: 'green', state: 'Green', meaning: 'Terminal running.', }, { color: 'red', state: 'Red / flashing', meaning: 'Start-up or error condition — see the 2713P user manual.' }] },
    ],
    wiring: { summary: '24 V DC to the 3-pin terminal block on the back (+, −, functional earth); Ethernet to the same network as the controller.', notes: ['The panel cutout gasket keeps the NEMA/IP rating — tighten the mounting levers evenly.'] },
    inWorld: { scenes: [], missions: [], note: 'Showroom only for now.' },
    hotspots: [
      { label: 'Touchscreen', at: [0, 0.02 + 0.095, 0.007], text: 'Analog-resistive touch display showing View Designer screens — try the START / STOP buttons.' },
      { label: 'Bezel', at: [-0.105, 0.02 + 0.02, 0.006], text: 'Front bezel sealed against the enclosure door by a gasket.' },
      { label: 'Rear connectors', at: [0.06, 0.02 + 0.06, -0.07], normal: [0, 0, -1], text: 'Ethernet RJ45, USB-A (host), USB-B (device), SD card and the 24 V DC terminal block — orbit behind the door to see them.' },
    ],
    camera: { position: [0.12, 0.2, 0.52], target: [0, 0.12, 0] },
    size: 0.32,
    related: ['5069-l320er', 'powerflex-525'],
  },

  // ------------------------------------------------------------------ Operator devices
  {
    id: 'push-buttons-800f',
    group: 'operator',
    name: '22 mm push buttons',
    catalog: '800F',
    family: 'Bulletin 800F',
    tagline: 'Flush, extended, guarded, illuminated and mushroom operators — and the contact blocks behind them.',
    what:
      'A **push button** is an operator (the part you press) clipped through a 22.5 mm panel hole to a latch ' +
      'with **contact blocks** behind the panel. The contact block decides the logic: an **N.O.** block (800F-X10) ' +
      'closes while pressed; an **N.C.** block (800F-X01) opens while pressed.',
    where: 'Start/stop stations, jog and reset buttons, operator panels.',
    specs: [
      { label: 'Mounting', value: '22.5 mm (22 mm) hole' },
      { label: 'Operators', value: 'Flush, extended, guarded, mushroom, illuminated' },
      { label: 'Contact blocks', value: '800F-X10 = 1 N.O. · 800F-X01 = 1 N.C.' },
      { label: 'Terminal numbers', value: 'N.O. x3-x4 (e.g. 13-14), N.C. x1-x2 (e.g. 11-12)' },
      { label: 'Enclosure rating', value: 'Metal 800FM: Type 4/13, IP66 · plastic 800FP: Type 4/4X/13, IP66/69K', approx: true },
    ],
    indicators: [
      {
        name: 'Actuator colours (IEC 60204-1)',
        states: [
          { color: 'white', state: 'White · grey · black · green', meaning: 'START / ON (white preferred). Never red.' },
          { color: 'off', state: 'Black · grey · white', meaning: 'STOP / OFF (black preferred). Never green; red is allowed but not near an E-stop.' },
          { color: 'red', state: 'Red on yellow', meaning: 'Emergency stop only.' },
          { color: 'yellow', state: 'Yellow', meaning: 'Intervention in an abnormal condition.' },
          { color: 'blue', state: 'Blue', meaning: 'Mandatory action, e.g. RESET.' },
        ],
      },
    ],
    wiring: {
      summary: '**+24 V → contact block → PLC input**. The block type — not the button colour — decides N.O. or N.C.',
      notes: [
        '**Start = N.O.**: input 1 only while pressed → `XIC(Start_PB)`.',
        '**Stop = N.C.**: input 1 at rest, 0 when pressed *or when the wire breaks* — fail-safe → `XIC(Stop_PB)` in the run rung.',
        'Green START / red STOP is common North-American practice (NFPA 79 permits red for stop); IEC 60204-1 prefers white START and black STOP.',
      ],
    },
    inWorld: { scenes: ['trainer', 'motor-station', 'conveyor-sort', 'tank-process'], missions: ['1-1', '1-5', '2-1', '2-5'], note: 'START/STOP/JOG stations everywhere; the red trainer button is an N.C. trap.' },
    hotspots: [
      { label: 'Flush operator', at: [-0.15, -0.01, 0.012], text: 'Green **flush** START: hard to press accidentally.' },
      { label: 'Extended operator', at: [-0.1, -0.01, 0.015], text: 'Red **extended** STOP: easy to hit quickly. Wired **N.C.**' },
      { label: 'Guard', at: [-0.05, -0.01, 0.016], text: 'A **guard** collar prevents accidental jogging.' },
      { label: 'Illuminated', at: [0, -0.01, 0.013], text: '**Illuminated** RESET: LED lamp inside the lens (separate output).' },
      { label: 'Mushroom head', at: [0.155, -0.012, 0.022], text: '**Mushroom** STOP: large palm operator. (An E-stop also latches and needs a twist to release.)' },
      { label: 'Legend plate', at: [-0.15, 0.025, 0.004], text: 'Legend plate with the function text.' },
      { label: 'Contact blocks', at: [-0.1, -0.01, -0.035], normal: [0, 0, -1], text: 'Behind the panel: latch + **contact blocks** (N.O. green-marked, N.C. red-marked). Orbit behind to see them.' },
    ],
    camera: { position: [0.05, 0.07, 0.5], target: [0, -0.005, 0] },
    size: 0.36,
    related: ['estop-800fm', 'selector-800f', '1756-ib16'],
  },
  {
    id: 'estop-800fm',
    group: 'operator',
    name: 'Emergency stop',
    catalog: '800FM-MT44',
    family: 'Bulletin 800F',
    tagline: '40 mm twist-to-release mushroom with positive-opening N.C. contacts.',
    what:
      'An **emergency stop**: pushing the red mushroom **latches** it in and forcibly opens its N.C. contacts ' +
      '(positive opening, IEC 60947-5-5). It stays pushed until someone **twists it to release** — and even then ' +
      'the machine must not restart on its own.',
    where: 'Every machine with a hazard, at every operator station.',
    specs: [
      { label: 'Head', value: '40 mm red mushroom, twist-to-release', approx: false },
      { label: 'Contacts', value: 'N.C., direct (positive) opening action' },
      { label: 'Contact block', value: '800F-X01S: 1 N.C. self-monitoring (the usual E-stop choice)' },
      { label: 'Legend', value: 'Yellow background ring (60 mm)' },
      { label: 'Standards', value: 'IEC 60947-5-5, ISO 13850' },
    ],
    indicators: [{ name: 'Visual state', states: [{ color: 'red', state: 'Pushed in', meaning: 'Latched — the N.C. contacts are open.' }, { color: 'off', state: 'Pulled out', meaning: 'Released — contacts closed (healthy).' }] }],
    wiring: {
      summary: 'The N.C. contacts go to a **safety relay or safety controller** that removes power from the hazard. A standard PLC input may also *monitor* the E-stop.',
      notes: [
        '**N.C. = fail-safe**: a broken wire looks like a pressed E-stop.',
        'Use a **self-monitoring N.C. block (800F-X01S)**: if the block falls off the back of the operator, its contact opens — it reads as a pressed E-stop instead of silently staying closed.',
        'In logic: `XIC(EStop_OK)` in series with the run rung, and **no automatic restart** after release — require a new START press.',
        'A standard PLC alone is not a safety system; PLC World’s scenes also hardwire the E-stop into the contactor coil.',
      ],
    },
    inWorld: { scenes: ['motor-station', 'conveyor-sort', 'tank-process'], missions: ['2-3', '2-7', '7-6'], note: '“Safety First” teaches the E-stop and overload interlocks.' },
    hotspots: [
      { label: 'Mushroom head', at: [0, 0.05, 0.1], text: 'Push to stop — it **latches**. Twist clockwise to release (click it in 3D or use the demo panel).' },
      { label: 'Yellow legend', at: [0.028, 0.05, 0.072], text: 'Red-on-yellow is reserved for emergency stops.' },
      { label: 'Enclosure', at: [0.03, 0.01, 0.06], text: 'Yellow single-hole enclosure: an E-stop that can be seen from anywhere.' },
    ],
    camera: { position: [0.08, 0.13, 0.33], target: [0, 0.05, 0.06] },
    size: 0.14,
    related: ['push-buttons-800f', 'contactor-100c'],
  },
  {
    id: 'selector-800f',
    group: 'operator',
    name: 'Selector switch',
    catalog: '800F (3-position)',
    family: 'Bulletin 800F',
    tagline: 'HAND – OFF – AUTO: two contacts, three positions.',
    what:
      'A **selector switch** turns a cam that operates contact blocks. The classic 3-position maintained ' +
      '**Hand-Off-Auto** selector has two N.O. contacts: one closes in HAND, the other in AUTO, none in OFF.',
    where: 'Mode selection (HOA), local/remote, on/off, recipe selection.',
    specs: [
      { label: 'Positions', value: '2 or 3, maintained or spring-return' },
      { label: 'Knob', value: 'Standard or long lever' },
      { label: 'Contacts', value: 'Per cam truth table (the “target table”)' },
    ],
    indicators: [
      {
        name: 'Contact truth table (HOA)',
        states: [
          { color: 'green', state: 'HAND', meaning: 'Contact A closed → `HOA_Hand` = 1, `HOA_Auto` = 0.' },
          { color: 'off', state: 'OFF', meaning: 'Both open → both inputs 0.' },
          { color: 'blue', state: 'AUTO', meaning: 'Contact B closed → `HOA_Auto` = 1.' },
        ],
      },
    ],
    wiring: { summary: '+24 V to both contact blocks; each block to its own PLC input.', notes: ['OFF is simply “neither input”: `XIO(HOA_Hand) XIO(HOA_Auto)`.', 'In HAND the motor runs without the upstream request — still honour the stop and safety interlocks.'] },
    inWorld: { scenes: ['motor-station', 'conveyor-sort'], missions: ['2-6'], note: '“Hand-Off-Auto” builds the HOA logic for the conveyor motor.' },
    hotspots: [
      { label: 'Knob', at: [-0.06, 0, 0.02], text: 'Turn the **knob** (click it, or use the demo panel). 90° span over three positions.' },
      { label: 'Legend', at: [-0.06, 0.028, 0.004], text: 'Position legend HAND / OFF / AUTO.' },
      { label: 'Long lever', at: [0, 0, 0.02], text: 'Long-lever knob: easier with gloves.' },
    ],
    camera: { position: [0.03, 0.06, 0.27], target: [0, 0.006, 0] },
    size: 0.2,
    related: ['push-buttons-800f'],
  },
  {
    id: 'pilot-lights-800f',
    group: 'operator',
    name: 'Pilot lights',
    catalog: '800F-P',
    family: 'Bulletin 800F',
    tagline: 'Integral-LED indicator lamps in IEC colours.',
    what: '**Pilot lights** show machine state to the operator. The 800F uses an integral LED module behind a coloured lens, driven by a PLC output.',
    where: 'RUN / FAULT / POWER / READY indication on operator stations and panel doors.',
    specs: [
      { label: 'Lamp', value: 'Integral LED' },
      { label: 'Voltages', value: '24 V AC/DC, 120 V AC, 240 V AC versions' },
      { label: 'Lens colours', value: 'Red, green, amber, blue, white/clear' },
    ],
    indicators: [IEC_LAMP_COLORS],
    wiring: { summary: 'PLC output → lamp terminal X1, lamp X2 → 0 V.', notes: ['Drive RUN from the **contactor auxiliary contact** (feedback), not from the command bit: the lamp then tells the truth.', 'Add a lamp-test input to catch dead LEDs.'] },
    inWorld: { scenes: ['trainer', 'motor-station', 'conveyor-sort', 'tank-process'], missions: ['1-1', '1-7', '2-2', '3-3'], note: 'Your very first mission lights a trainer pilot light.' },
    hotspots: [
      { label: 'Lens', at: [-0.1, 0, 0.012], text: 'Coloured lens with the LED module behind it. Toggle lamps or run a lamp test in the demo panel.' },
      { label: 'Legend plate', at: [-0.1, 0.028, 0.004], text: 'Function text: RUN, FAULT, POWER…' },
    ],
    camera: { position: [0.02, 0.05, 0.42], target: [0, 0.006, 0] },
    size: 0.3,
    related: ['push-buttons-800f', 'stack-light-855t'],
  },
  {
    id: 'stack-light-855t',
    group: 'operator',
    name: 'Stack light',
    catalog: '855T',
    family: 'Bulletin 855T / 856T',
    tagline: 'A 70 mm signal tower: machine status visible across the floor.',
    what:
      'A **stack light** (signal tower): modular light and sound modules stacked on a base. Each tier is wired ' +
      'to its own output. The 855T line has been superseded by the **856T Control Tower** — switch series in the demo panel.',
    where: 'On top of machines and cabinets: green = running, amber = warning/starved, red = fault, blue = help needed.',
    specs: [
      { label: 'Diameter', value: '70 mm' },
      { label: 'Modules', value: 'Steady, flashing, strobe light modules; audible module' },
      { label: 'Voltage', value: '24 V AC/DC and 120/240 V AC versions' },
      { label: 'Mounting', value: 'Pole (with base) or surface base' },
    ],
    indicators: [IEC_LAMP_COLORS],
    wiring: { summary: 'One common + one conductor per tier (and the horn) from the PLC outputs.', notes: ['Flash in logic with a timer pair, or buy flashing modules — do not do both.'] },
    inWorld: { scenes: ['conveyor-sort', 'motor-station', 'tank-process'], missions: ['4-2', '6-2'], note: 'The sorting conveyor has green/amber/red tiers driven by `Light_Green`, `Light_Amber`, `Light_Red`.' },
    hotspots: [
      { label: 'Red tier', at: [0, 0.29, 0.04], text: 'Top tier (red): fault / emergency.' },
      { label: 'Amber tier', at: [0, 0.228, 0.04], text: 'Warning or abnormal condition.' },
      { label: 'Green tier', at: [0, 0.172, 0.04], text: 'Running normally.' },
      { label: 'Pole & base', at: [0, 0.03, 0.04], text: 'Base with the wiring terminals and a 10 cm aluminium pole.' },
    ],
    camera: { position: [0.3, 0.33, 0.7], target: [0, 0.19, 0] },
    size: 0.35,
    related: ['pilot-lights-800f', '1756-ob16e'],
  },

  // ------------------------------------------------------------------ Panel
  {
    id: 'contactor-100c',
    group: 'panel',
    name: 'IEC contactor',
    catalog: '100-C09',
    family: 'Bulletin 100-C',
    tagline: 'A heavy-duty relay that switches the motor’s 3-phase power.',
    what:
      'A **contactor** is an electromagnetically operated switch: energising the coil (A1–A2) pulls in the ' +
      'armature and closes the three main poles, connecting the motor to the line. A built-in **13-14 N.O.** ' +
      'auxiliary contact tells the PLC that it really pulled in.',
    where: 'Direct-on-line motor starters, heaters, lighting contactors.',
    specs: [
      { label: 'Rating', value: '9 A AC-3 (5 HP @ 460 V, 2 HP @ 230 V, 3-phase)' },
      { label: 'Poles', value: '3 main poles (1/L1-2/T1, 3/L2-4/T2, 5/L3-6/T3)' },
      { label: 'Auxiliary', value: '1 N.O. (13-14) built in; add-on blocks available' },
      { label: 'Coil', value: 'e.g. 100-C09D10: 120 V 60 Hz / 110 V 50 Hz; DC coils (24 V) available' },
      { label: 'Mounting', value: '35 mm DIN rail or screws' },
    ],
    indicators: [{ name: 'Contact-carrier window', states: [{ color: 'off', state: '“O”', meaning: 'De-energised: main contacts open.' }, { color: 'white', state: '“I”', meaning: 'Pulled in: main contacts closed.' }] }],
    wiring: {
      summary: 'PLC output → **A1**, **A2** → common. Line on top (L1 L2 L3), motor via the overload on the bottom (T1 T2 T3). **13-14 → PLC input** as feedback.',
      notes: [
        'Command (output bit) ≠ feedback (aux contact): compare them to catch a failed contactor.',
        'Hardwire the E-stop / overload 95-96 in series with the coil so they work even if the PLC does not.',
      ],
    },
    inWorld: { scenes: ['motor-station', 'conveyor-sort'], missions: ['2-1', '2-2', '7-1'], note: '`Motor_Starter` drives the coil; `Motor_Aux` is the 13-14 feedback.' },
    hotspots: [
      { label: 'Coil terminal A1', at: [-0.018, 0.034, 0.069], text: '**A1** (top) and **A2** (bottom): the coil. Energise it in the demo panel.' },
      { label: 'Line terminals', at: [-0.002, 0.034, 0.069], text: '**1/L1 3/L2 5/L3**: incoming 3-phase line.' },
      { label: 'Aux contact 13-14', at: [0.018, 0.034, 0.069], text: 'Integral **N.O. auxiliary** 13 (top) / 14 (bottom): closed when pulled in → `Motor_Aux`.' },
      { label: 'Armature indicator', at: [0, -0.009, 0.0935], text: 'Contact-carrier window: shows **I** when pulled in, **O** when open.' },
      { label: 'Load terminals', at: [0, -0.034, 0.069], text: '**2/T1 4/T2 6/T3** to the overload relay and motor.' },
    ],
    camera: { position: [0.07, 0.08, 0.3], target: [0, 0, 0.05] },
    size: 0.2,
    related: ['overload-193e', 'motor', '1756-ob16e'],
  },
  {
    id: 'overload-193e',
    group: 'panel',
    name: 'Electronic overload relay',
    catalog: '193-1EEDB (E100)',
    family: 'Bulletin 193 E100',
    tagline: 'Protects the motor from overheating; plugs under the contactor.',
    what:
      'An **overload relay** measures motor current and trips (opens **95-96**) when the motor draws more than the ' +
      'set full-load amps for too long — the time follows the **trip class** (class 10 trips at 7.2 × FLA within 10 s). ' +
      'It does not interrupt the power itself: its contact drops the contactor coil.',
    where: 'Every motor starter (contactor + overload = starter).',
    specs: [
      { label: 'FLA range', value: '3.2–16 A (dial)' },
      { label: 'Trip class', value: '10 or 20 (selectable)' },
      { label: 'Trip rating', value: '120 % of the FLA dial setting' },
      { label: 'Contacts', value: '95-96 N.C. (trip), 97-98 N.O. (alarm)' },
      { label: 'Reset', value: 'Manual (blue TRIP/RESET button), TEST button', approx: false },
      { label: 'Fits', value: '100-C09 … C23 contactors (direct mount)' },
    ],
    indicators: [{ name: 'Trip indication', states: [{ color: 'orange', state: 'Tripped', meaning: 'Trip flag visible, TRIP/RESET button out: 95-96 open, 97-98 closed.' }, { color: 'off', state: 'Normal', meaning: 'Not tripped.' }] }],
    wiring: {
      summary: '**95-96 (N.C.)** in series with the contactor coil and/or to a PLC input (`OL_OK`, 1 = healthy). **97-98 (N.O.)** to an alarm.',
      notes: ['Set the dial to the motor nameplate FLA.', 'After a trip the motor must cool down before the relay resets; a reset must never restart the motor by itself.'],
    },
    inWorld: { scenes: ['motor-station'], missions: ['2-3', '7-6'], note: 'A jammed conveyor trips the overload in the motor station (`OL_OK` goes 0).' },
    hotspots: [
      { label: 'FLA dial', at: [-0.011, -0.022, 0.094], text: 'Set the motor **full-load amps** here.' },
      { label: 'Trip class', at: [0.011, -0.015, 0.094], text: 'Selects **class 10 or 20** (how long an overload may last).' },
      { label: 'TRIP/RESET', at: [0.011, -0.03, 0.094], text: 'Blue **TRIP/RESET**: pops out when tripped — click it to reset (after cooling).' },
      { label: 'Aux contacts', at: [0, -0.005, 0.075], text: '**95-96 N.C.** (opens on trip) and **97-98 N.O.** (closes on trip).' },
      { label: 'Motor terminals', at: [0, -0.058, 0.076], text: '**2/T1 4/T2 6/T3** out to the motor.' },
    ],
    camera: { position: [0.06, 0.03, 0.3], target: [0, -0.02, 0.05] },
    size: 0.22,
    related: ['contactor-100c', 'motor'],
  },
  {
    id: 'breaker-1489',
    group: 'panel',
    name: 'Miniature circuit breakers',
    catalog: '1489-M',
    family: 'Bulletin 1489',
    tagline: 'UL 489 branch-circuit protection on the DIN rail.',
    what:
      'A **miniature circuit breaker (MCB)** opens on overcurrent (thermal) and short circuit (magnetic). The ' +
      'letter is the **trip curve** (C = magnetic trip at 5–10 × In), the number the rated current: **C10** = 10 A.',
    where: 'Branch protection for control power, PLC supplies, 24 V supplies, lighting, heaters.',
    specs: [
      { label: 'Standard', value: 'UL 489 (branch-circuit protection), CSA' },
      { label: 'Poles', value: '1, 2 or 3 (17.5 mm per pole)' },
      { label: 'Ratings', value: '0.5–63 A; curves B, C, D' },
      { label: 'Interrupting', value: '10 kA @ 480Y/277 V AC', approx: true },
    ],
    indicators: [{ name: 'Contact position window', states: [{ color: 'red', state: 'Red', meaning: 'Contacts closed (ON).' }, { color: 'green', state: 'Green', meaning: 'Contacts open (OFF / tripped).' }] }],
    wiring: { summary: 'Line on top, load on the bottom; comb busbars feed rows of breakers.', notes: ['A tripped breaker is reset by switching OFF then ON — find the fault first.', '“480Y/277 V” is a slash rating: only for grounded-wye systems.'] },
    inWorld: { scenes: ['trainer', 'motor-station', 'conveyor-sort'], missions: [], note: 'Every scene cabinet has a row of 1489 breakers.' },
    hotspots: [
      { label: 'Handle', at: [-0.045, -0.004, 0.084], text: 'Toggle handle (up = ON). Click it or use the demo panel.' },
      { label: 'Rating', at: [-0.017, 0.017, 0.083], text: 'Trip curve and current, e.g. **C10**.' },
      { label: 'Contact window', at: [-0.047, 0.009, 0.083], text: 'Red = closed, green = open.' },
      { label: 'Terminals', at: [0.031, 0.034, 0.052], text: 'Box-lug terminals: line on top, load at the bottom.' },
    ],
    camera: { position: [0.05, 0.06, 0.28], target: [0, 0, 0.04] },
    size: 0.18,
    related: ['1606-xls', 'terminal-1492'],
  },
  {
    id: '1606-xls',
    group: 'panel',
    name: '24 V DC power supply',
    catalog: '1606-XLS240E',
    family: 'Bulletin 1606-XLS',
    tagline: 'The 24 V DC that powers sensors, I/O and pilot lights.',
    what: 'A switch-mode **DIN-rail power supply** that turns mains AC into regulated **24 V DC** for field devices, I/O and control circuits.',
    where: 'Every control panel: sensors, I/O field power, HMIs, relays.',
    specs: [
      { label: 'Output', value: '24 V DC, 10 A, 240 W (adjustable 24–28 V)' },
      { label: 'Input', value: '100–240 V AC', approx: true },
      { label: 'Terminals', value: 'Spring clamps: output + + − − on top, input N L PE at the bottom' },
      { label: 'Signals', value: 'DC-OK LED + relay contact (13-14), OVERLOAD LED' },
    ],
    indicators: [
      { name: 'DC OK', states: [{ color: 'green', state: 'Green', meaning: 'Output voltage is within range.' }, { color: 'off', state: 'Off', meaning: 'Output low or off.' }] },
      { name: 'OVERLOAD', states: [{ color: 'red', state: 'Red', meaning: 'Overload / short circuit / over-temperature condition.' }, { color: 'off', state: 'Off', meaning: 'Normal.' }] },
    ],
    wiring: { summary: 'Mains from a breaker to **L N PE**; 24 V out to distribution terminals. Wire the **DC-OK contact** to a PLC input for diagnostics.', notes: ['Ground (PE-bond) the 0 V side at one point if your standard requires a grounded DC system.'] },
    inWorld: { scenes: ['trainer', 'motor-station', 'conveyor-sort'], missions: [], note: 'Powers the field devices in every cabinet.' },
    hotspots: [
      { label: 'DC OK LED', at: [-0.017, 0.026, 0.125], text: 'Green: output in range.' },
      { label: 'OVERLOAD LED', at: [-0.002, 0.026, 0.125], text: 'Red: overload or short. Try it in the demo panel.' },
      { label: 'Voltage adjust', at: [0.016, 0.026, 0.125], text: 'Potentiometer: 24–28 V.' },
      { label: 'Output terminals', at: [-0.01, 0.052, 0.1], text: 'Output **+ + − −** and DC-OK 13-14 on top.' },
      { label: 'Input terminals', at: [0, -0.056, 0.1], text: 'Input **N L PE** at the bottom.' },
    ],
    camera: { position: [0.1, 0.07, 0.36], target: [0, 0, 0.05] },
    size: 0.2,
    related: ['breaker-1489', '1756-pa72'],
  },
  {
    id: 'terminal-1492',
    group: 'panel',
    name: 'Terminal blocks',
    catalog: '1492-J3',
    family: 'Bulletin 1492',
    tagline: 'Where panel wiring meets field wiring.',
    what: 'Feed-through **screw terminal blocks** on a DIN rail. Each block connects the wire on one end to the wire on the other; green/yellow **PE** blocks bond to the rail.',
    where: 'The boundary between the cabinet and the field: every sensor, lamp and motor cable lands here.',
    specs: [
      { label: 'Width', value: '5.1 mm' },
      { label: 'Wire', value: '#22–12 AWG (UL) · rated cross-section 2.5 mm² (IEC)', approx: true },
      { label: 'Accessories', value: 'End barrier, end anchors, jumpers, marker tags' },
      { label: 'PE block', value: 'Green/yellow, clamps to the rail (grounding)' },
    ],
    indicators: [],
    wiring: { summary: 'Panel side on one end, field cable on the other; number every block to match the drawings.', notes: ['Blue blocks are often used for DC 0 V / neutral, gray for signals — follow your plant standard.'] },
    inWorld: { scenes: ['trainer', 'motor-station', 'conveyor-sort'], missions: [], note: 'Terminal strips in every cabinet.' },
    hotspots: [
      { label: 'Marker tags', at: [-0.01, 0.0, 0.0405], text: 'Snap-in **marker tags** carry the terminal numbers.' },
      { label: 'Screw clamp', at: [-0.01, 0.024, 0.036], text: 'Screw clamps at both ends.' },
      { label: 'PE block', at: [0.03, 0.0, 0.0405], text: 'Green/yellow **PE** block: metal foot bonds the wire to the DIN rail.' },
      { label: 'End anchor', at: [0.041, 0.0, 0.03], text: 'End barrier and **end anchor** keep the strip in place.' },
    ],
    camera: { position: [0.05, 0.1, 0.2], target: [0, 0, 0.02] },
    size: 0.14,
    related: ['breaker-1489', '1606-xls'],
  },

  // ------------------------------------------------------------------ Field
  {
    id: 'motor',
    group: 'field',
    name: 'Induction motor',
    catalog: 'TEFC 3-phase',
    family: 'Field — motion',
    tagline: 'A 5 HP totally-enclosed fan-cooled motor, the workhorse of industry.',
    what: 'A **3-phase squirrel-cage induction motor**: the rotating magnetic field of the stator drags the rotor around slightly slower than synchronous speed (a 4-pole 60 Hz motor ≈ 1750 rpm).',
    where: 'Conveyors, pumps, fans, mixers — started by a contactor (fixed speed) or a VFD (variable speed).',
    specs: [
      { label: 'Example', value: '5 HP, 460 V, 1750 rpm, NEMA 184T frame', approx: true },
      { label: 'Full-load current', value: '≈ 7.6 A @ 460 V (NEC table value)', approx: true },
      { label: 'Enclosure', value: 'TEFC — totally enclosed, fan cooled' },
      { label: 'Service factor', value: '1.15 typical', approx: true },
    ],
    indicators: [],
    wiring: { summary: 'Three phases **T1 T2 T3** from the starter or VFD, plus PE. Wye or delta per the nameplate.', notes: ['Swap any two phases to reverse the direction.', 'The overload relay is set to the nameplate FLA.'] },
    inWorld: { scenes: ['motor-station', 'tank-process'], missions: ['2-1', '2-3', '3-4', '3-5'], note: 'The motor station’s conveyor motor (and the tank’s agitator motor).' },
    hotspots: [
      { label: 'Fan cover', at: [0, 0.114, -0.2], normal: [0, 0, -1], text: 'Shaft-mounted fan blows air over the finned frame (TEFC).' },
      { label: 'Conduit box', at: [0.105, 0.1, 0.0], normal: [1, 0, 0], text: 'Terminal (conduit) box: T1–T3 and PE.' },
      { label: 'Shaft & coupling', at: [0, 0.114, 0.2], text: 'Drive-end shaft with a jaw coupling.' },
      { label: 'Nameplate', at: [0.03, 0.205, -0.07], normal: [0.4, 1, 0], text: 'Nameplate: HP/kW, voltage, full-load amps (set the overload to this), rpm, frame, service factor.' },
      { label: 'Frame & feet', at: [0.08, 0.02, 0.05], text: 'Cast frame with cooling fins and mounting feet (NEMA T-frame).' },
    ],
    camera: { position: [0.55, 0.38, 0.62], target: [0, 0.11, 0] },
    size: 0.6,
    related: ['contactor-100c', 'overload-193e', 'powerflex-525'],
  },
  {
    id: 'photo-eye-42ef',
    group: 'field',
    name: 'Photoelectric sensor',
    catalog: '42EF RightSight',
    family: 'Bulletin 42EF',
    tagline: 'A retro-reflective photo-eye: sees boxes by breaking a light beam.',
    what:
      'A **polarised retro-reflective photo-eye** sends a red light beam to a reflector and back. An object ' +
      'breaking the beam changes the output. **Light-operate** (LO): output ON when light is received; ' +
      '**dark-operate** (DO): output ON when the beam is blocked.',
    where: 'Box detection on conveyors, vehicle presence under gates, jam detection.',
    specs: [
      { label: 'Supply', value: '10.8–30 V DC', approx: true },
      { label: 'Output', value: 'PNP or NPN, LO/DO selectable', approx: true },
      { label: 'Modes', value: 'Diffuse, background suppression, retro-reflective, transmitted beam' },
      { label: 'Connection', value: 'M12 quick-disconnect or cable' },
    ],
    indicators: [
      {
        name: 'LEDs (series D)',
        states: [
          { color: 'orange', state: 'Orange', meaning: 'Output energised.' },
          { color: 'green', state: 'Green', meaning: 'Power on; also used as an alignment/margin aid (see the instruction sheet).' },
        ],
      },
    ],
    wiring: { summary: '3-wire PNP: **brown +24 V, blue 0 V, black output** → sinking PLC input.', notes: ['Choose LO or DO so that “1 = box present” is natural for your logic (PLC World: `PE_Infeed` = 1 when a box is there).', 'A dirty lens looks like a permanently blocked beam — watch the margin indicator.'] },
    inWorld: { scenes: ['conveyor-sort', 'parking-garage'], missions: ['4-1', '6-2', '7-4'], note: '`PE_Infeed`, `PE_Tall`, `PE_Divert`, `PE_Exit` on the sorting conveyor; `Entry_PE` under the garage gates.' },
    hotspots: [
      { label: 'Lens', at: [0.012, 0.2, 0], normal: [1, 0, 0], text: 'Emitter and receiver behind one lens (with polarising filters).' },
      { label: 'Status LEDs', at: [-0.012, 0.216, 0], normal: [0, 1, 0], text: 'Output (orange) and power/margin (green) indicators.' },
      { label: 'Reflector', at: [0.6, 0.2, 0], normal: [-1, 0, 0.3], text: 'Corner-cube **retro-reflector**: returns the beam to the sensor.' },
      { label: 'Bracket & post', at: [-0.01, 0.1, 0.012], text: 'Stainless bracket on a post; M12 cable to the junction box.' },
    ],
    camera: { position: [0.3, 0.42, 0.95], target: [0.3, 0.14, 0] },
    size: 0.8,
    related: ['prox-872c', 'conveyor', '1756-ib16'],
  },
  {
    id: 'prox-872c',
    group: 'field',
    name: 'Inductive proximity sensor',
    catalog: '872C',
    family: 'Bulletin 872C',
    tagline: 'Detects metal without touching it.',
    what: 'An **inductive prox** creates a high-frequency magnetic field at its face; a metal target nearby absorbs energy and the output switches. Nothing moves, so it lasts practically forever.',
    where: 'Cylinder end positions, cam and gear tooth detection, metal part presence.',
    specs: [
      { label: 'Sizes', value: 'M8 … M30 barrels' },
      { label: 'Sensing distance', value: 'M18 ≈ 5 mm shielded / 8 mm unshielded (mild steel)', approx: true },
      { label: 'Supply', value: '10–30 V DC, 3-wire PNP/NPN (2-wire and AC types exist)' },
      { label: 'Correction', value: 'Aluminium/brass targets need a much smaller gap (≈ 0.3–0.5 × Sn)', approx: true },
    ],
    indicators: [{ name: 'LED ring', states: [{ color: 'amber', state: 'Amber', meaning: 'Output ON — target detected.' }, { color: 'off', state: 'Off', meaning: 'No target.' }] }],
    wiring: { summary: '3-wire: brown +V, blue 0 V, black output (PNP → sinking input).', notes: ['Shielded (flush) types can be buried in metal; unshielded ones sense farther but need a metal-free zone.'] },
    inWorld: { scenes: [], missions: [], note: 'Showroom only for now.' },
    hotspots: [
      { label: 'Sensing face', at: [0, 0.049, 0.004], text: 'The field comes out of this face. Move the target in the demo panel.' },
      { label: 'LED ring', at: [0, 0.058, -0.069], normal: [0.3, 1, 0], text: '360° amber LED ring: output state.' },
      { label: 'Jam nuts', at: [0.01, 0.058, -0.02], normal: [1, 0.5, 0], text: 'Threaded barrel with jam nuts: set the sensing gap, then lock.' },
      { label: 'M12 cordset', at: [0.006, 0.049, -0.1], normal: [1, 0.5, 0], text: 'Yellow M12 quick-disconnect cordset.' },
    ],
    camera: { position: [0.2, 0.11, 0.07], target: [0, 0.045, -0.035] },
    size: 0.3,
    related: ['photo-eye-42ef', 'cylinder'],
  },
  {
    id: 'cylinder',
    group: 'field',
    name: 'Pneumatic cylinder',
    catalog: 'ISO 15552',
    family: 'Field — pneumatics',
    tagline: 'Compressed air → straight-line motion, with reed switches for position.',
    what: 'A **double-acting cylinder**: air into the rear port extends the rod, air into the front port retracts it. A **5/2 single-solenoid valve** switches the air; a magnet in the piston operates **reed switches** in the barrel slots.',
    where: 'Pushers, diverters, clamps, gates.',
    specs: [
      { label: 'Standard', value: 'ISO 15552 profile barrel' },
      { label: 'This unit', value: 'Ø50 bore × 300 mm stroke, guided pusher' },
      { label: 'Sensors', value: 'Reed switches (extended / retracted)' },
      { label: 'Valve', value: '5/2 single solenoid, spring return' },
    ],
    indicators: [{ name: 'Reed switch LED', states: [{ color: 'red', state: 'Lit', meaning: 'Piston magnet at the switch → input ON.' }, { color: 'off', state: 'Off', meaning: 'Piston elsewhere.' }] }],
    wiring: { summary: 'PLC output → valve coil (`Pusher_Extend`); reed switches → PLC inputs (`Pusher_Extended`, `Pusher_Retracted`).', notes: ['Spring return: coil off = retract, also on power loss.', 'Check the “retracted” switch before the next push, or time out with an alarm.'] },
    inWorld: { scenes: ['conveyor-sort'], missions: ['6-2'], note: 'Diverts tall boxes into the reject chute.' },
    hotspots: [
      { label: 'Rod & pusher', at: [0, 0.2, 0.14], text: 'Chrome rod with a guided pusher plate.' },
      { label: 'Extended switch', at: [0.028, 0.225, 0.06], text: 'Reed switch near the rod end: ON when extended.' },
      { label: 'Retracted switch', at: [0.028, 0.225, -0.22], text: 'Reed switch near the cap end: ON when retracted.' },
      { label: 'Air ports', at: [0, 0.235, -0.25], normal: [0, 1, 0], text: 'Rear port (blue tube) extends, front port (black) retracts.' },
    ],
    camera: { position: [0.7, 0.5, 0.6], target: [0, 0.18, -0.12] },
    size: 0.7,
    related: ['valves', 'prox-872c'],
  },
  {
    id: 'valves',
    group: 'field',
    name: 'Solenoid valves',
    catalog: 'XV / 5-2 manifold',
    family: 'Field — valves',
    tagline: 'On/off process valves and a pneumatic valve manifold.',
    what: 'A **process on/off valve**: a ball valve turned by a pneumatic rack-and-pinion actuator, piloted by a small **solenoid** valve. Next to it: a **5/2 valve manifold** that drives cylinders.',
    where: 'Tank fill/drain, cooling water, air to cylinders.',
    specs: [
      { label: 'Process valve', value: '3-piece ball valve, spring-return actuator (fail closed)' },
      { label: 'Pilot', value: 'NAMUR solenoid, 24 V DC coil with LED' },
      { label: 'Manifold', value: '5/2 single-solenoid valves with manual override' },
    ],
    indicators: [{ name: 'Coil LED / position indicator', states: [{ color: 'amber', state: 'LED lit', meaning: 'Coil energised.' }, { color: 'green', state: 'OPEN', meaning: 'Valve open (indicator rotated).' }, { color: 'red', state: 'SHUT', meaning: 'Valve closed.' }] }],
    wiring: { summary: 'PLC output → solenoid coil. Limit switch boxes (open/closed feedback) are common on real process valves.', notes: ['Fail-closed: loss of air or power shuts the valve — choose the fail state for safety.'] },
    inWorld: { scenes: ['tank-process', 'conveyor-sort'], missions: ['5-1', '5-5', '6-1', '7-5'], note: 'XV-101 fill and XV-102 drain on the tank; the pusher valve on the conveyor.' },
    hotspots: [
      { label: 'Actuator', at: [-0.25, 0.4, 0.03], text: 'Rack-and-pinion **pneumatic actuator** (spring return).' },
      { label: 'Solenoid pilot', at: [-0.2, 0.37, 0.05], text: 'NAMUR **solenoid** with LED — the part the PLC drives.' },
      { label: 'Position indicator', at: [-0.25, 0.47, 0.0], normal: [0, 1, 0], text: 'Rotating **OPEN / SHUT** indicator on top.' },
      { label: 'Valve manifold', at: [0.62, 0.17, 0.05], text: '5/2 valves on a sub-base: each station drives one cylinder.' },
    ],
    camera: { position: [0.38, 0.55, 1.05], target: [0.18, 0.25, 0] },
    size: 1.2,
    related: ['cylinder', 'tank-instruments'],
  },
  {
    id: 'conveyor',
    group: 'field',
    name: 'Belt conveyor',
    catalog: 'Slider-bed conveyor',
    family: 'Field — material handling',
    tagline: 'Moves boxes past sensors, pushers and people.',
    what: 'A **slider-bed belt conveyor**: a gear motor turns the head pulley; the belt slides over a bed and returns under it. Guide rails keep boxes centred.',
    where: 'Packaging, sorting, palletising — the classic PLC training machine.',
    specs: [
      { label: 'Length', value: '2 m section' },
      { label: 'Drive', value: 'Helical-bevel gear motor at the head end' },
      { label: 'Frame', value: 'Powder-coated steel or aluminium extrusion' },
    ],
    indicators: [],
    wiring: { summary: 'Motor via a starter or VFD; photo-eyes and prox sensors to inputs; E-stop pull cords on long conveyors.', notes: ['Starting a conveyor with people nearby: sound a pre-start warning horn first.'] },
    inWorld: { scenes: ['conveyor-sort', 'motor-station'], missions: ['4-1', '4-2', '6-2', '3-4'], note: 'The 6 m sorting conveyor and the motor-station conveyor.' },
    hotspots: [
      { label: 'Gear motor', at: [1.95, 0.6, 0.45], text: 'Gear motor on the **head** pulley (discharge end).' },
      { label: 'Belt', at: [0.8, 0.76, 0.1], normal: [0, 1, 0], text: 'The belt: position integrates the speed — try the speed slider.' },
      { label: 'Tail pulley', at: [0.0, 0.7, 0.26], text: 'Tail pulley with the belt take-up (tension).' },
      { label: 'Guide rails', at: [1.2, 0.86, 0.24], text: 'Side guide rails keep boxes on the belt.' },
    ],
    camera: { position: [2.4, 1.5, 2.3], target: [1.0, 0.55, 0] },
    size: 2.4,
    related: ['motor', 'photo-eye-42ef', 'cylinder'],
  },
  {
    id: 'tank-instruments',
    group: 'field',
    name: 'Mixing tank & instruments',
    catalog: 'LT / TT / LS',
    family: 'Field — process',
    tagline: 'A 2000 L tank with radar level, RTD temperature, fork and float level switches.',
    what:
      'A **process vessel** with its instruments: a radar **level transmitter** (LT-101, 4–20 mA), an RTD ' +
      '**temperature transmitter** (TT-101), **level switches** (vibrating-fork LSL and LSH, a float switch for the ' +
      'high-high trip LSHH), an agitator and an immersion heater.',
    where: 'Batch processes: food, chemicals, water treatment.',
    specs: [
      { label: 'Level', value: '80 GHz radar, 4–20 mA → 0–100 %' },
      { label: 'Temperature', value: 'RTD (Pt100) + head transmitter, 4–20 mA → 0–150 °C' },
      { label: 'Level switches', value: 'LSL / LSH: vibrating fork · LSHH: float switch (N.C., fail-safe)' },
    ],
    indicators: [{ name: 'Transmitter LCDs', states: [{ color: 'white', state: 'Display', meaning: 'Local reading of the measured value.' }] }],
    wiring: {
      summary: '2-wire transmitters: the loop powers the instrument and carries the signal to the analog input. Level switches to digital inputs.',
      notes: [
        '**LSHH is fail-safe (N.C.)**: it reads 0 at high-high level *and* when a wire breaks.',
        'Never rely on one sensor: a failed LT must not overflow the tank (see “Overflowing Tank”).',
      ],
    },
    inWorld: { scenes: ['tank-process'], missions: ['5-1', '5-5', '6-1', '7-5'], note: 'The Mixing & Heating Tank plant.' },
    hotspots: [
      { label: 'Level transmitter', at: [0.402, 2.46, -0.108], normal: [0.3, 1, 0.3], text: '**LT-101** radar: measures distance to the surface → 0–100 %.' },
      { label: 'Temperature transmitter', at: [0.69, 0.99, 0.49], normal: [0.8, 0, 0.6], text: '**TT-101** RTD in a thermowell with a head transmitter.' },
      { label: 'Level switches', at: [0.72, 1.9, 0.12], normal: [1, 0, 0.2], text: '**LSL / LSH** vibrating-fork switches and the **LSHH** float switch at fixed heights.' },
      { label: 'Agitator', at: [0, 2.62, 0], normal: [0, 1, 0.3], text: 'Top-mounted agitator motor and gearbox.' },
      { label: 'Fill valve', at: [-0.78, 2.62, -0.142], text: '**XV-101** inlet valve.' },
    ],
    camera: { position: [3.0, 3.1, 4.6], target: [0, 1.45, 0] },
    size: 2.6,
    related: ['valves', '1756-if8'],
  },

  // ------------------------------------------------------------------ Traffic & parking
  {
    id: 'signal-head',
    group: 'traffic',
    name: 'Traffic signal head',
    catalog: '12" LED, 3-section',
    family: 'Traffic',
    tagline: 'Red, yellow, green — the most-watched outputs in the world.',
    what: 'A **3-section 12-inch LED vehicle signal head** with visors and a backplate with a retro-reflective yellow border. Each lamp is one output.',
    where: 'Intersections. (Real intersections use dedicated traffic controllers with a conflict monitor; a PLC is a teaching stand-in.)',
    specs: [
      { label: 'Lenses', value: '12" (300 mm) LED modules' },
      { label: 'Yellow change', value: '≈ 3–6 s (by approach speed, ITE)', approx: true },
      { label: 'All-red clearance', value: '≈ 1–2 s', approx: true },
    ],
    indicators: [
      {
        name: 'Aspects (MUTCD)',
        states: [
          { color: 'red', state: 'Steady red', meaning: 'Stop.' },
          { color: 'yellow', state: 'Steady yellow', meaning: 'Red is coming — stop if you safely can.' },
          { color: 'green', state: 'Steady green', meaning: 'Proceed.' },
          { color: 'yellow', blink: true, state: 'Flashing yellow', meaning: 'Proceed with caution (night mode on the main street).' },
          { color: 'red', blink: true, state: 'Flashing red', meaning: 'Stop, then proceed (like a stop sign).' },
        ],
      },
    ],
    wiring: { summary: 'One output per lamp (`NS_Red`, `NS_Yellow`, `NS_Green`…).', notes: ['**Never** allow conflicting greens — interlock in logic and verify with the conflict counter.', 'A dark head is treated as an all-way stop.'] },
    inWorld: { scenes: ['traffic-light'], missions: ['3-6', '6-3', '6-4'], note: 'Four approaches driven by the CompactLogix 5380.' },
    hotspots: [
      { label: 'Red lens', at: [0, 0.99, 0.22], text: 'Red section on top (always).' },
      { label: 'Yellow lens', at: [0, 0.636, 0.22], text: 'Yellow: the change interval.' },
      { label: 'Green lens', at: [0, 0.28, 0.22], text: 'Green at the bottom.' },
      { label: 'Backplate', at: [0.25, 0.64, 0.0], text: 'Backplate with a **retro-reflective** border: visible even when the power is out.' },
    ],
    camera: { position: [0.9, 0.95, 3.0], target: [0, 0.64, 0] },
    size: 1.4,
    related: ['ped-signal', '5069-ob16'],
  },
  {
    id: 'ped-signal',
    group: 'traffic',
    name: 'Pedestrian signal & push button',
    catalog: '16" countdown',
    family: 'Traffic',
    tagline: 'WALK, flashing DON’T WALK with countdown, and the call button.',
    what: 'A **countdown pedestrian signal** (walking person / upraised hand + 2-digit countdown) and an accessible **pedestrian push button** that places a call.',
    where: 'Crosswalks at signalised intersections.',
    specs: [
      { label: 'Walk interval', value: '≥ 7 s typical (MUTCD minimum 4 s in some cases)', approx: true },
      { label: 'Clearance', value: 'Flashing hand, timed at ≈ 3.5 ft/s walking speed', approx: true },
      { label: 'Button', value: 'N.O. momentary' },
    ],
    indicators: [
      {
        name: 'Aspects',
        states: [
          { color: 'white', state: 'Walking person', meaning: 'Start crossing.' },
          { color: 'orange', blink: true, state: 'Flashing hand + countdown', meaning: 'Do not start; finish crossing.' },
          { color: 'orange', state: 'Steady hand', meaning: 'Don’t walk.' },
        ],
      },
    ],
    wiring: { summary: '`Walk` and `Dont_Walk` outputs; the push button to `Ped_PB` (N.O.).', notes: ['Latch the pedestrian call — the button press is short, the wait is long.', 'Walk must never be on while the crossing street has green.'] },
    inWorld: { scenes: ['traffic-light'], missions: ['3-7'], note: '“Walk Signal” adds the pedestrian phase.' },
    hotspots: [
      { label: 'Hand / person', at: [-0.1, 1.2, 0.12], text: 'Overlaid upraised hand (orange) and walking person (white).' },
      { label: 'Countdown', at: [0.1, 1.2, 0.12], text: 'Counts down the pedestrian clearance.' },
      { label: 'Push button', at: [0, 1.0, 0.65], text: 'Accessible push button: places the pedestrian call. Press it in the demo panel.' },
    ],
    camera: { position: [0.7, 1.35, 2.6], target: [0, 1.05, 0.2] },
    size: 1.2,
    related: ['signal-head'],
  },
  {
    id: 'barrier-gate',
    group: 'traffic',
    name: 'Parking barrier gate',
    catalog: 'Barrier gate',
    family: 'Parking',
    tagline: 'Raise on request, never lower onto a car.',
    what: 'A **barrier gate**: a motorised cabinet swinging an aluminium boom. The PLC commands “raise”; the gate’s own drive handles the motion; loops and photo-eyes tell the PLC where the car is.',
    where: 'Parking garages, toll lanes, factory gates.',
    specs: [
      { label: 'Boom', value: '≈ 3.6 m aluminium, chevrons + LED strip' },
      { label: 'Travel', value: '≈ 1.5 s up / down (this model)' },
      { label: 'Safety', value: 'Vehicle loop + photo-eye under the arm' },
    ],
    indicators: [{ name: 'Status light', states: [{ color: 'red', state: 'Red', meaning: 'Arm down.' }, { color: 'green', state: 'Green', meaning: 'Arm up.' }, { color: 'amber', blink: true, state: 'Flashing amber', meaning: 'Arm moving.' }] }],
    wiring: { summary: '`Entry_Gate_Up` output raises the arm while on; loop detector and photo-eye inputs.', notes: ['Keep the gate up while the photo-eye sees a car (`Entry_PE`), or the arm hits it (`gateHits`).'] },
    inWorld: { scenes: ['parking-garage'], missions: ['4-4', '4-5'], note: 'Entry and exit gates of the 12-space garage.' },
    hotspots: [
      { label: 'Boom', at: [1.8, 1.0, 0.25], text: 'Aluminium boom with yellow/black chevrons and red LEDs.' },
      { label: 'Status light', at: [0, 1.12, 0.1], text: 'LED status bar: red down, green up, flashing amber moving.' },
      { label: 'Cabinet', at: [0, 0.55, 0.2], text: 'Motor, gearbox and controller inside the cabinet.' },
      { label: 'Rest post', at: [3.6, 0.5, 0.25], text: 'Fork rest post supports the arm tip.' },
    ],
    camera: { position: [2.6, 2.0, 6.0], target: [1.5, 0.9, 0] },
    size: 4,
    related: ['ticket-kiosk', 'photo-eye-42ef'],
  },
  {
    id: 'ticket-kiosk',
    group: 'traffic',
    name: 'Ticket dispenser',
    catalog: 'Entry station',
    family: 'Parking',
    tagline: 'PRESS BUTTON FOR TICKET.',
    what: 'A **parking entry station**: the driver presses the big button, a ticket is printed, and the kiosk tells the PLC to open the gate.',
    where: 'Parking garage entries.',
    specs: [
      { label: 'Button', value: 'Illuminated N.O. push button' },
      { label: 'Display', value: 'Backlit 2-line message display' },
      { label: 'Extras', value: 'Intercom HELP button, card reader' },
    ],
    indicators: [{ name: 'Button ring', states: [{ color: 'green', state: 'Lit', meaning: 'Ready — press for a ticket.' }] }],
    wiring: { summary: 'Button contact → `Ticket_PB` (N.O.).', notes: ['Use a one-shot: a driver holding the button must not get two gate cycles.'] },
    inWorld: { scenes: ['parking-garage'], missions: ['4-4'], note: 'Drivers press it automatically in the garage scene.' },
    hotspots: [
      { label: 'PRESS button', at: [0, 1.03, 0.2], text: 'Big illuminated button — try it in the demo panel.' },
      { label: 'Ticket mouth', at: [0.07, 0.93, 0.2], text: 'Ticket slot with a blinking LED surround.' },
      { label: 'Display', at: [0, 1.25, 0.18], text: 'Message display: “PRESS BUTTON FOR TICKET”.' },
    ],
    camera: { position: [0.9, 1.5, 1.95], target: [0, 1.05, 0] },
    size: 1.4,
    related: ['barrier-gate'],
  },
];

/** What people actually type when looking for a device. */
const DEVICE_KEYWORDS: Record<string, string[]> = {
  'controllogix-rack': ['chassis', 'backplane', 'plc rack', 'slots'],
  '1756-l85e': ['plc', 'cpu', 'processor', 'controller', 'key switch'],
  '1756-pa72': ['power supply', 'psu', 'chassis power'],
  '1756-ib16': ['input card', 'di', 'digital input', '24v input'],
  '1756-ob16e': ['output card', 'do', 'digital output', 'fused'],
  '1756-if8': ['analog input', 'ai', '4-20 ma', 'transmitter input'],
  '1756-of8': ['analog output', 'ao', '4-20 ma', 'setpoint'],
  '1756-en2t': ['ethernet', 'network', 'comms', 'bridge', 'ip address'],
  '5069-l320er': ['plc', 'cpu', 'compactlogix', 'controller', 'l320'],
  '5069-ib16': ['input card', 'di', 'digital input', 'compact i/o'],
  '5069-ob16': ['output card', 'do', 'digital output', 'la power', 'compact i/o'],
  '5069-if8': ['analog input', 'ai', '4-20 ma', 'compact i/o'],
  '5069-of4': ['analog output', 'ao', '4-20 ma', 'compact i/o'],
  'powerflex-525': ['vfd', 'drive', 'inverter', 'variable frequency', 'motor speed'],
  'panelview-5310': ['hmi', 'touchscreen', 'operator interface', 'screen', 'terminal'],
  'push-buttons-800f': ['pb', 'button', 'start', 'stop', 'pushbutton', 'contact block'],
  'estop-800fm': ['e-stop', 'estop', 'emergency', 'mushroom', 'safety'],
  'selector-800f': ['hoa', 'hand off auto', 'switch', 'selector'],
  'pilot-lights-800f': ['indicator', 'lamp', 'light', 'led'],
  'stack-light-855t': ['beacon', 'tower light', 'andon', 'signal tower', 'horn', '856t'],
  'contactor-100c': ['starter', 'relay', 'coil', 'motor starter'],
  'overload-193e': ['ol', 'overload', 'thermal', 'motor protection', 'e100'],
  'breaker-1489': ['cb', 'mcb', 'circuit breaker', 'fuse'],
  '1606-xls': ['power supply', 'psu', '24v', '24 v dc', 'dc supply'],
  'terminal-1492': ['tb', 'terminals', 'terminal block', 'din rail'],
  motor: ['induction', 'tefc', '3 phase', 'three phase', 'ac motor'],
  'photo-eye-42ef': ['photo eye', 'pe', 'photoelectric', 'sensor', 'light curtain'],
  'prox-872c': ['proximity', 'inductive', 'prox', 'sensor', 'pnp'],
  cylinder: ['pneumatic', 'air', 'actuator', 'reed switch'],
  valves: ['solenoid', 'valve', 'pneumatic', 'process valve'],
  conveyor: ['belt', 'material handling'],
  'tank-instruments': ['level', 'temperature', 'transmitter', 'lt', 'tt', 'level switch', 'process'],
  'signal-head': ['traffic light', 'stoplight', 'red amber green'],
  'ped-signal': ['walk', 'pedestrian', 'crosswalk', "don't walk"],
  'barrier-gate': ['gate', 'boom', 'parking', 'arm'],
  'ticket-kiosk': ['ticket', 'parking', 'dispenser', 'kiosk'],
};
for (const d of SHOWROOM_DEVICES) d.keywords ??= DEVICE_KEYWORDS[d.id];

const BY_ID = new Map(SHOWROOM_DEVICES.map((d) => [d.id, d] as const));

/** Device by id (case-insensitive), undefined for unknown ids. */
export function getShowroomDevice(id: string | undefined): ShowroomDevice | undefined {
  if (!id) return undefined;
  return BY_ID.get(id) ?? BY_ID.get(id.toLowerCase());
}

/** Devices of a group in catalog order. */
export function devicesInGroup(group: ShowroomGroupId): ShowroomDevice[] {
  return SHOWROOM_DEVICES.filter((d) => d.group === group);
}

export const DEFAULT_SHOWROOM_DEVICE = '1756-l85e';
