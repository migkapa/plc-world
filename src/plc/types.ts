/**
 * Core contracts for the Logix 5000-style PLC runtime.
 *
 * Everything in the app (ladder editor, scenes, missions, 3D twins) talks to the
 * controller through the types declared here. Keep this file dependency-free.
 */

// ---------------------------------------------------------------------------
// Data types & tags
// ---------------------------------------------------------------------------

/** Logix atomic data types supported by the simulator. */
export type AtomicType = 'BOOL' | 'SINT' | 'INT' | 'DINT' | 'REAL';

/**
 * A data type name: an atomic type, a built-in structure (TIMER, COUNTER) or a
 * module-defined / user-defined structure registered in the data type registry
 * (e.g. 'AB:1756_DI:I:0').
 */
export type DataTypeName = AtomicType | 'TIMER' | 'COUNTER' | (string & {});

/** Member of a structured data type. */
export interface StructMember {
  name: string;
  dataType: DataTypeName;
  /** For array members (e.g. module data words). */
  dims?: number;
  /** Hidden members are not shown in the tag editor (e.g. internal bits). */
  hidden?: boolean;
  /** When set, this BOOL member is an alias of bit `bitOf.bit` of member `bitOf.member`. */
  bitOf?: { member: string; bit: number };
  description?: string;
}

export interface StructType {
  name: DataTypeName;
  members: StructMember[];
  description?: string;
  /** True for module-defined I/O types (read-only in the tag editor for structure edits). */
  module?: boolean;
}

/** Runtime value of a tag or member. Structures are plain objects, arrays are JS arrays. */
export type TagValue = boolean | number | TagValue[] | { [member: string]: TagValue };

export interface TimerValue {
  PRE: number;
  ACC: number;
  EN: boolean;
  TT: boolean;
  DN: boolean;
}

export interface CounterValue {
  PRE: number;
  ACC: number;
  CU: boolean;
  CD: boolean;
  DN: boolean;
  OV: boolean;
  UN: boolean;
}

export type TagUsage = 'Local' | 'Input' | 'Output' | 'InOut' | 'Public';

export interface TagDef {
  /** Tag name, e.g. 'Start_PB', 'Local:1:I'. Names are case-insensitive in Logix; we preserve case but match insensitively. */
  name: string;
  dataType: DataTypeName;
  /** One-dimensional array length (Logix supports up to 3 dims; we support 1). */
  dims?: number;
  description?: string;
  /** Alias tag: fully qualified operand this tag points to, e.g. 'Local:1:I.Data.0'. */
  aliasFor?: string;
  /** Initial value (defaults to zero / false / zeroed structure). */
  initial?: TagValue;
  /** Constant tags can't be written by logic. */
  constant?: boolean;
  /** I/O and system tags are created by the controller and cannot be deleted by the user. */
  system?: boolean;
}

/** Scope for a tag: controller-scoped or program-scoped. */
export type TagScope = { kind: 'controller' } | { kind: 'program'; program: string };

/** Info row for tag browsers/monitors. */
export interface TagInfo {
  name: string;
  scope: string; // 'Controller' or program name
  dataType: DataTypeName;
  dims?: number;
  description?: string;
  aliasFor?: string;
  system?: boolean;
  constant?: boolean;
}

// ---------------------------------------------------------------------------
// Ladder logic program model (RLL)
// ---------------------------------------------------------------------------

/** One ladder instruction, e.g. XIC(Start_PB) or TON(Timer1,5000,0). */
export interface InstructionNode {
  kind: 'instr';
  /** Stable element id (unique within a routine). */
  id: string;
  /** Mnemonic in upper case, e.g. 'XIC', 'TON'. */
  op: string;
  /** Operand texts exactly as typed ('?' = not yet specified). */
  operands: string[];
}

/** Parallel branch: each leg is a series list of elements. Must have >= 2 legs to be meaningful. */
export interface BranchNode {
  kind: 'branch';
  id: string;
  legs: RungElement[][];
}

export type RungElement = InstructionNode | BranchNode;

export interface Rung {
  id: string;
  comment?: string;
  /** Series list of elements from the left rail to the right rail. */
  elements: RungElement[];
}

export interface Routine {
  name: string;
  type: 'RLL';
  description?: string;
  rungs: Rung[];
}

export interface Program {
  name: string;
  description?: string;
  mainRoutine: string;
  routines: Routine[];
  /** Program-scoped tags. */
  tags: TagDef[];
  /** Inhibited programs are not scanned. */
  inhibited?: boolean;
}

export interface Task {
  name: string;
  type: 'CONTINUOUS' | 'PERIODIC';
  /** For PERIODIC tasks. */
  periodMs?: number;
  priority?: number;
  /** Names of programs scheduled in this task, in execution order. */
  programs: string[];
}

// ---------------------------------------------------------------------------
// Hardware / I/O configuration
// ---------------------------------------------------------------------------

export type Platform = 'ControlLogix' | 'CompactLogix';

/** Catalog numbers the simulator knows how to emulate & render. */
export type ModuleCatalog =
  // ControlLogix 1756
  | '1756-L85E'
  | '1756-L83E'
  | '1756-EN2T'
  | '1756-EN4TR'
  | '1756-IB16'
  | '1756-OB16E'
  | '1756-IF8'
  | '1756-OF8'
  // CompactLogix 5380 / 5069
  | '5069-L320ER'
  | '5069-L330ERM'
  | '5069-IB16'
  | '5069-OB16'
  | '5069-IF8'
  | '5069-OF4';

export type ModuleKind = 'CPU' | 'COMM' | 'DI' | 'DO' | 'AI' | 'AO';

export interface ModuleConfig {
  /** Slot number: ControlLogix chassis slot 0..n-1; CompactLogix 5380 local bus slot (controller is slot 0). */
  slot: number;
  catalog: ModuleCatalog;
  /** Optional module name shown in the I/O tree (e.g. 'DI_Panel'). */
  name?: string;
}

export interface HardwareConfig {
  platform: Platform;
  /** ControlLogix chassis, e.g. '1756-A7' (7 slots). Ignored for CompactLogix. */
  chassis?: '1756-A4' | '1756-A7' | '1756-A10' | '1756-A13' | '1756-A17';
  /** ControlLogix power supply, e.g. '1756-PA72'. */
  powerSupply?: '1756-PA72' | '1756-PB72' | '1756-PA75';
  modules: ModuleConfig[];
}

/** Static information about a module catalog number. */
export interface ModuleCatalogInfo {
  catalog: ModuleCatalog;
  platform: Platform;
  kind: ModuleKind;
  description: string;
  /** Number of I/O points or channels (0 for CPU/COMM). */
  points: number;
  /** Data type name for the module's input tag Local:<slot>:I (if any). */
  inputType?: DataTypeName;
  /** Data type name for the module's output tag Local:<slot>:O (if any). */
  outputType?: DataTypeName;
  /** Operand path template for a digital/analog point relative to the module tag, e.g. 'I.Data.{n}' or 'I.Pt{nn}.Data'. */
  pointPath?: string;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  /** Controller name as shown in the Controller Organizer. */
  controllerName: string;
  description?: string;
  hardware: HardwareConfig;
  /** Controller-scoped user tags (I/O module tags are generated from hardware and must NOT be listed here). */
  tags: TagDef[];
  tasks: Task[];
  programs: Program[];
  /** Optional user-defined structures (UDTs). */
  dataTypes?: StructType[];
}

// ---------------------------------------------------------------------------
// Controller runtime state
// ---------------------------------------------------------------------------

/** Physical key switch on the controller front. */
export type KeySwitch = 'RUN' | 'REM' | 'PROG';

/**
 * Controller operating mode. Remote modes are reachable only with the key in REM.
 * FAULTED = major fault; logic is not executing and outputs are in fault state (off).
 */
export type ControllerMode = 'RUN' | 'PROG' | 'REM_RUN' | 'REM_PROG' | 'FAULTED';

export interface FaultRecord {
  /** Logix fault type/code, e.g. type 4 code 20 (array subscript out of range). */
  type: number;
  code: number;
  message: string;
  /** Where the fault happened. */
  program?: string;
  routine?: string;
  rungIndex?: number;
  elementId?: string;
  /** Simulation time the fault was logged. */
  timeMs: number;
}

/** Per-element live state for online animation of the ladder. */
export interface ElementLiveState {
  /** Rung-condition-in to this element. */
  in: boolean;
  /** Rung-condition-out from this element. */
  out: boolean;
  /**
   * Instruction "true" state used for highlighting (Studio 5000 highlights XIC when
   * the bit is 1, XIO when the bit is 0, OTE when the bit is 1, etc.).
   */
  active: boolean;
}

/** Live state of one routine after the latest scan. Keys are element ids. */
export interface RoutineLiveState {
  elements: Record<string, ElementLiveState>;
  /** Rung condition at the right rail for each rung (index-aligned with routine.rungs). */
  rungs: boolean[];
}

/** Rung verification error (Studio 5000 shows these with an 'e' marker in the rung margin). */
export interface VerifyError {
  program: string;
  routine: string;
  rungIndex: number;
  elementId?: string;
  operandIndex?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface ControllerStatus {
  mode: ControllerMode;
  keySwitch: KeySwitch;
  /** True while logic is executing (RUN or REM_RUN and not faulted). */
  running: boolean;
  /** Controller OK LED state. */
  ok: 'green' | 'red' | 'flashing-red' | 'off';
  /** RUN LED. */
  runLed: 'green' | 'off';
  /** FORCE LED: off = none installed, flashing amber = installed but disabled, solid amber = installed & enabled. */
  forceLed: 'off' | 'amber' | 'flashing-amber';
  /** I/O LED: green = all modules connected, flashing-green = some not connected / none configured. */
  ioLed: 'green' | 'flashing-green' | 'flashing-red' | 'off';
  /** Four-character scrolling display text on 1756-L8x / 5069-L3x controllers, e.g. 'RUN', 'PROG', 'Major Fault T04:C20'. */
  displayText: string;
  majorFault?: FaultRecord;
  minorFaults: FaultRecord[];
  scanCount: number;
  /** Simulated last scan time in ms (for the Task properties display). */
  lastScanMs: number;
  maxScanMs: number;
  /** Total simulated time since power up. */
  uptimeMs: number;
  forcesInstalled: boolean;
  forcesEnabled: boolean;
  /** True during the first scan after entering run (S:FS). */
  firstScan: boolean;
}

/** Listener signature for controller events. */
export type ControllerEvent =
  | { type: 'mode'; mode: ControllerMode }
  | { type: 'fault'; fault: FaultRecord }
  | { type: 'project' }
  | { type: 'forces' };

/**
 * The simulated Logix controller. Implemented by `createController()` in `src/plc/controller.ts`.
 *
 * Scan model (per call to `scan(dtMs)`):
 *   1. apply input forces to input image
 *   2. if running: execute every non-inhibited program of the continuous task (MainRoutine; JSR for subroutines)
 *      - on the first scan after entering run, a prescan runs first and S:FS is true for this scan
 *   3. apply output forces; outputs are exposed to the field via `readOutputForField()` (off when not running)
 */
export interface PlcController {
  readonly project: Project;
  readonly tags: TagDatabase;

  // --- lifecycle / mode ---
  getStatus(): ControllerStatus;
  setKeySwitch(pos: KeySwitch): void;
  /** Remote mode change requested from the software (only honoured when key is in REM). Returns false if refused. */
  requestMode(mode: 'RUN' | 'PROG'): boolean;
  /** Clear a major fault (Studio 5000 "Clear Majors"); controller returns to PROG / REM_PROG. */
  clearMajorFault(): void;

  // --- program ---
  /** Replace the whole project (download). Controller goes to PROG (or REM_PROG) mode; tag values reset to initial values. */
  loadProject(project: Project): void;
  /** Online edit: replace the rungs of one routine without stopping; tag values are kept. */
  updateRoutine(program: string, routine: string, rungs: Rung[]): void;
  /** Add or update a user tag (controller scope when program is omitted). */
  upsertTag(def: TagDef, program?: string): void;
  deleteTag(name: string, program?: string): void;
  /** Static verification of the whole project (unknown tags, wrong operand types, missing operands...). */
  verify(): VerifyError[];

  // --- execution ---
  /** Execute one scan cycle using `dtMs` of simulated elapsed time (used by timers). */
  scan(dtMs: number): void;
  /** Live state of a routine from the latest scan (for ladder animation). */
  getLiveState(program: string, routine: string): RoutineLiveState | undefined;

  // --- forces ---
  setForce(operand: string, value: boolean | number): void;
  removeForce(operand: string): void;
  removeAllForces(): void;
  enableForces(enabled: boolean): void;
  getForces(): Record<string, boolean | number>;

  // --- field I/O (used by the simulation runtime / scenes) ---
  /** Write a value coming from field wiring into an input image operand (e.g. 'Local:1:I.Data.0'). Forces take precedence. */
  writeInputFromField(operand: string, value: boolean | number): void;
  /** Read what the output module drives to the field. Returns false/0 when the controller is not running (PROG/FAULTED). */
  readOutputForField(operand: string): boolean | number;

  // --- events ---
  subscribe(listener: (e: ControllerEvent) => void): () => void;
}

/**
 * Tag database with Logix operand path resolution.
 *
 * Operand syntax examples:
 *   Start_PB                 BOOL tag (may be an alias)
 *   Timer1.DN                structure member
 *   Recipe[3]                array element
 *   Recipe[Index]            indirect array index
 *   MyDint.5                 bit of an integer
 *   Local:1:I.Data.0         module I/O tag member bit
 *   Local:3:I.Ch0Data        analog channel
 *   MainProgram's program tags are resolved before controller tags when `program` is given.
 */
export interface TagDatabase {
  /** Registered structure types, including TIMER, COUNTER and module types. */
  getDataType(name: DataTypeName): StructType | undefined;
  registerDataType(type: StructType): void;

  define(def: TagDef, program?: string): void;
  remove(name: string, program?: string): void;
  list(program?: string): TagInfo[];
  /** All tags in all scopes. */
  listAll(): TagInfo[];
  getDef(name: string, program?: string): TagDef | undefined;

  /** True if the operand resolves to an existing tag/member/bit. */
  exists(operand: string, program?: string): boolean;
  /** Data type of the resolved operand (e.g. 'BOOL' for 'MyDint.3', 'TIMER' for 'Timer1'). */
  typeOf(operand: string, program?: string): DataTypeName | undefined;

  readBool(operand: string, program?: string): boolean;
  writeBool(operand: string, value: boolean, program?: string): void;
  /** Reads BOOL as 0/1, integers as JS numbers, REAL as float32-rounded number. */
  readNumber(operand: string, program?: string): number;
  /** Writes with Logix conversion rules: to integer types -> round half to even & wrap to width; to REAL -> Math.fround. */
  writeNumber(operand: string, value: number, program?: string): void;
  /** Direct reference to a structured value (TIMER/COUNTER/UDT); mutations are live. */
  getStruct<T extends object = Record<string, TagValue>>(operand: string, program?: string): T | undefined;
  /** Deep-cloned value for display. */
  readValue(operand: string, program?: string): TagValue | undefined;
  /** Monotonic counter incremented on every write (cheap change detection for UIs). */
  readonly version: number;
}

/** Instruction metadata used by the editor palette, verification and docs. */
export interface InstructionInfo {
  mnemonic: string;
  name: string;
  category:
    | 'Bit'
    | 'Timer/Counter'
    | 'Compare'
    | 'Compute/Math'
    | 'Move/Logical'
    | 'Program Control'
    | 'Special';
  /** Input instructions are conditions (XIC, EQU...). Output instructions end a rung or leg (OTE, TON...). */
  kind: 'input' | 'output';
  /** Rendered as a coil/contact glyph or as a box with operand rows. */
  display: 'contact' | 'coil' | 'box';
  operands: Array<{
    name: string;
    /** Allowed data types; 'ANY_NUM' = SINT/INT/DINT/REAL/immediate; 'IMMEDIATE' literal numbers allowed. */
    types: Array<DataTypeName | 'ANY_NUM' | 'ANY_INT' | 'IMMEDIATE' | 'ROUTINE' | 'EXPRESSION'>;
    /** Destination operands are written by the instruction. */
    dest?: boolean;
  }>;
  /** Short description for tooltips. */
  summary: string;
  /** Longer teaching description (markdown). */
  details?: string;
  /** For box instructions: status bits displayed on the right side of the box, e.g. ['EN','DN'] for TON. */
  statusBits?: string[];
}
