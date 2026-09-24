/**
 * Logix tag database: tag storage, data types and operand resolution.
 *
 * Operands are compiled once into cached accessor objects (`OperandRef`) holding direct references
 * to the storage containers, so the scan executes with no string parsing and no allocation.
 * The cache is invalidated (and `structureVersion` bumped) whenever tags or types are
 * defined/removed — consumers holding refs (the controller's compiled routines) re-resolve then.
 *
 * Invariant: structure and array containers are never replaced once created (writes to
 * structured operands copy members in place), which is what makes cached refs safe.
 */
import { ExpressionError, compileExpression, type NumSource } from './expression';
import {
  convertAtomic,
  intWidth,
  isAtomic,
  isIntegerType,
  isNumericType,
  parseNumericLiteral,
  takeOverflow,
} from './convert';
import { PlcFault, TagError } from './errors';
import type {
  AtomicType,
  DataTypeName,
  StructMember,
  StructType,
  TagDatabase,
  TagDef,
  TagInfo,
  TagValue,
} from './types';

// ---------------------------------------------------------------------------
// Built-in structures
// ---------------------------------------------------------------------------

export const TIMER_TYPE: StructType = {
  name: 'TIMER',
  description: 'Timer (TON, TOF, RTO)',
  members: [
    { name: 'PRE', dataType: 'DINT', description: 'Preset (ms)' },
    { name: 'ACC', dataType: 'DINT', description: 'Accumulated time (ms)' },
    { name: 'EN', dataType: 'BOOL', description: 'Enable: rung-condition-in of the timer instruction' },
    { name: 'TT', dataType: 'BOOL', description: 'Timer timing' },
    { name: 'DN', dataType: 'BOOL', description: 'Done' },
  ],
};

export const COUNTER_TYPE: StructType = {
  name: 'COUNTER',
  description: 'Counter (CTU, CTD)',
  members: [
    { name: 'PRE', dataType: 'DINT', description: 'Preset' },
    { name: 'ACC', dataType: 'DINT', description: 'Accumulated count' },
    { name: 'CU', dataType: 'BOOL', description: 'Count up enable' },
    { name: 'CD', dataType: 'BOOL', description: 'Count down enable' },
    { name: 'DN', dataType: 'BOOL', description: 'Done: ACC >= PRE' },
    { name: 'OV', dataType: 'BOOL', description: 'Overflow: counted past 2,147,483,647' },
    { name: 'UN', dataType: 'BOOL', description: 'Underflow: counted past -2,147,483,648' },
  ],
};

export const CONTROL_TYPE: StructType = {
  name: 'CONTROL',
  description: 'Control structure for array/file instructions (BSL, BSR, SQO, FFL, FFU)',
  members: [
    { name: 'LEN', dataType: 'DINT', description: 'Length (elements or bits)' },
    { name: 'POS', dataType: 'DINT', description: 'Position' },
    { name: 'EN', dataType: 'BOOL', description: 'Enable' },
    { name: 'EU', dataType: 'BOOL', description: 'Enable unload (FFU)' },
    { name: 'DN', dataType: 'BOOL', description: 'Done' },
    { name: 'EM', dataType: 'BOOL', description: 'Empty' },
    { name: 'ER', dataType: 'BOOL', description: 'Error' },
    { name: 'UL', dataType: 'BOOL', description: 'Unload bit (BSL/BSR)' },
    { name: 'IN', dataType: 'BOOL', description: 'Inhibit' },
    { name: 'FD', dataType: 'BOOL', description: 'Found' },
  ],
};

export const BUILTIN_TYPES: readonly StructType[] = [TIMER_TYPE, COUNTER_TYPE, CONTROL_TYPE];

// ---------------------------------------------------------------------------
// Operand accessors
// ---------------------------------------------------------------------------

/** A compiled operand accessor. Also usable as a numeric `NumSource` (e.g. in expressions). */
export interface OperandRef extends NumSource {
  /** Canonical, alias-resolved path, e.g. 'Local:1:I.Data.0' for alias 'Start_PB'. */
  readonly path: string;
  /** Data type of the addressed element ('BOOL' for bits; element type for whole arrays). */
  readonly type: DataTypeName;
  /** Set when the operand addresses a whole array (its length). */
  readonly dims: number | undefined;
  /** Array element or whole array: length and element type of the array. */
  readonly array: { readonly length: number; readonly elemType: DataTypeName } | undefined;
  /** Target tag is a constant (logic must not write it). */
  readonly constant: boolean;
  /**
   * Scope of the tag that finally holds the data (after alias resolution): '' = controller scope,
   * a program name for program-scoped tags, '#sys' for system operands such as S:FS.
   */
  readonly scope: string;
  /** Evaluating the operand may raise a runtime fault (indirect subscript / bit). */
  readonly dynamic: boolean;
  /** True when the operand is a bit of an integer (e.g. MyDint.5, Local:1:I.Data.0). */
  readonly isBit: boolean;
  readB(): boolean;
  writeB(v: boolean): void;
  readN(): number;
  /** Writes with Logix conversion; overflow is reported through `takeOverflow()` (convert.ts). */
  writeN(v: number): void;
  /** Live value (structure objects and arrays are returned by reference). */
  value(): TagValue;
  /**
   * Assign a whole value in place with Logix conversions: atomics are converted to the target type,
   * structures member-wise (unknown members ignored), arrays element-wise.
   */
  assign(v: TagValue): void;
  /** For array operands: the backing array and start index (object is reused between calls). */
  arrayLoc(): { arr: TagValue[]; index: number };
}

type Bag = Record<string | number, TagValue>;
type KeyFn = () => string | number;

/** A storage location: static (container/key fixed at compile time) or dynamic (indirect subscript). */
interface Loc {
  sc: Bag | null;
  sk: string | number;
  cont: (() => Bag) | null;
  key: KeyFn | null;
}

interface Slot {
  def: TagDef;
  value: TagValue;
  /** '' for controller scope, program name for program scope, '#sys' for system operands. */
  scope: string;
}

interface TypeEntry {
  type: StructType;
  members: Map<string, StructMember>;
}

type Seg = { k: 'm'; name: string } | { k: 'i'; text: string } | { k: 'b'; n: number } | { k: 'bx'; text: string };

interface ParsedOperand {
  base: string;
  rest: string;
  segs: Seg[];
}

const RE_BASE = /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z0-9_]+)*/;

function readBracket(t: string, open: number): number {
  let depth = 0;
  for (let j = open; j < t.length; j++) {
    if (t[j] === '[') depth++;
    else if (t[j] === ']' && --depth === 0) return j;
  }
  throw new TagError(`Missing ']' in operand '${t}'.`);
}

/** Split an operand into base tag name and member/index/bit segments (syntax only). */
export function parseOperandPath(text: string): ParsedOperand {
  const t = text.trim();
  const m = RE_BASE.exec(t);
  if (!m) throw new TagError(t === '' ? 'Missing operand.' : `Invalid tag name '${t}'.`);
  const base = m[0];
  const segs: Seg[] = [];
  let i = base.length;
  while (i < t.length) {
    const c = t[i];
    if (c === '.') {
      i++;
      if (t[i] === '[') {
        const end = readBracket(t, i);
        segs.push({ k: 'bx', text: t.slice(i + 1, end).trim() });
        i = end + 1;
        continue;
      }
      const d = /^\d+/.exec(t.slice(i));
      if (d) {
        segs.push({ k: 'b', n: Number(d[0]) });
        i += d[0].length;
        continue;
      }
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(t.slice(i));
      if (!id) throw new TagError(`Invalid member in operand '${t}'.`);
      segs.push({ k: 'm', name: id[0] });
      i += id[0].length;
    } else if (c === '[') {
      const end = readBracket(t, i);
      const inner = t.slice(i + 1, end).trim();
      let depth = 0;
      for (const ch of inner) {
        if (ch === '[' || ch === '(') depth++;
        else if (ch === ']' || ch === ')') depth--;
        else if (ch === ',' && depth === 0) throw new TagError(`Multi-dimensional arrays are not supported ('${t}').`);
      }
      if (inner === '') throw new TagError(`Missing array subscript in '${t}'.`);
      segs.push({ k: 'i', text: inner });
      i = end + 1;
    } else {
      throw new TagError(`Invalid character '${c}' in operand '${t}'.`);
    }
  }
  return { base, rest: t.slice(base.length), segs };
}

/** Logix tag naming rules: letter/underscore first, letters/digits/underscores, ≤ 40 chars, no '__', no trailing '_'. */
export function isValidTagName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name.length <= 40 && !name.includes('__') && !name.endsWith('_');
}

function notScalar(path: string): never {
  throw new TagError(`'${path}' is not a BOOL or numeric operand.`);
}

function wrapWidth(x: number, width: number): number {
  return width === 32 ? x | 0 : width === 16 ? (x << 16) >> 16 : (x << 24) >> 24;
}

/** Copy `src` into `target` in place (structures member-wise, arrays element-wise). */
export function deepAssign(target: TagValue, src: TagValue): void {
  if (Array.isArray(target) && Array.isArray(src)) {
    const n = Math.min(target.length, src.length);
    for (let i = 0; i < n; i++) {
      const t = target[i]!;
      if (typeof t === 'object') deepAssign(t, src[i]!);
      else target[i] = src[i]!;
    }
    return;
  }
  if (typeof target === 'object' && typeof src === 'object' && !Array.isArray(target) && !Array.isArray(src)) {
    for (const k of Object.keys(target)) {
      if (!(k in src)) continue;
      const t = target[k]!;
      if (typeof t === 'object') deepAssign(t, src[k]!);
      else target[k] = src[k]!;
    }
  }
}

// ---------------------------------------------------------------------------
// Forces
// ---------------------------------------------------------------------------

/** Force applied to one storage cell (a container + key). */
interface CellForce {
  /** Whole-value force (BOOL, REAL or a whole integer). */
  whole: boolean | number | undefined;
  /** Integer bits forced on / off. */
  set: number;
  clr: number;
  /** Integer width (8/16/32) or 0 for BOOL / REAL cells. */
  width: number;
}

/** Storage cell of a statically addressed scalar operand (what a force masks). */
interface Cell {
  o: Bag;
  k: string | number;
  bit: number | undefined;
  width: number;
  type: DataTypeName;
}

/**
 * Force overlay: while installed, every write to a forced cell is re-masked with the forced value,
 * so logic can never change a forced bit/value (Logix forces act on tag memory).
 */
class ForceOverlay {
  /** Number of forced cells (0 = fast path, no lookups on writes). */
  n = 0;
  readonly cells = new Map<Bag, Map<string | number, CellForce>>();

  apply(o: Bag, k: string | number, v: TagValue): TagValue {
    const f = this.cells.get(o)?.get(k);
    if (!f) return v;
    let x: TagValue = f.whole !== undefined ? f.whole : v;
    if (f.width > 0 && typeof x === 'number') x = wrapWidth((x | f.set) & ~f.clr, f.width);
    return x;
  }

  /** Re-apply every force to memory (after writes that bypass the accessors). */
  reapply(): void {
    for (const [o, m] of this.cells) for (const k of m.keys()) o[k] = this.apply(o, k, o[k]!);
  }

  clear(): void {
    this.cells.clear();
    this.n = 0;
  }
}

/** Storage cells of static scalar refs (registered by makeRef). */
const CELLS = new WeakMap<OperandRef, Cell>();

/** Shared mutable state handed to every accessor. */
interface RefShared {
  /** Value-change counter (TagDatabase.version). */
  n: number;
  readonly fo: ForceOverlay;
}

interface RefSpec {
  path: string;
  scope: string;
  type: DataTypeName;
  dims: number | undefined;
  array: { length: number; elemType: DataTypeName } | undefined;
  /** 'element' when the last segment was an array subscript, 'whole' for an entire array. */
  arrayMode: 'element' | 'whole' | undefined;
  constant: boolean;
  dynamic: boolean;
  bit?: { n: number } | { fn: () => number };
  bitWidth?: number;
  /** Type-directed in-place assignment for structures / arrays (Logix conversions per member). */
  assignDeep?: (target: TagValue, v: TagValue) => void;
}

function makeRef(loc: Loc, spec: RefSpec, ctr: RefShared): OperandRef {
  const { path, type } = spec;
  const fo = ctr.fo;
  let getRaw: () => TagValue;
  let setRaw: (v: TagValue) => void;
  if (loc.sc) {
    const o = loc.sc;
    const k = loc.sk;
    getRaw = () => o[k]!;
    setRaw = (v) => {
      o[k] = fo.n === 0 ? v : fo.apply(o, k, v);
      ctr.n++;
    };
  } else {
    const c = loc.cont!;
    const kf = loc.key!;
    getRaw = () => c()[kf()]!;
    setRaw = (v) => {
      const o = c();
      const k = kf();
      o[k] = fo.n === 0 ? v : fo.apply(o, k, v);
      ctr.n++;
    };
  }

  let readB: () => boolean;
  let writeB: (v: boolean) => void;
  let readN: () => number;
  let writeN: (v: number) => void;

  if (spec.bit) {
    const width = spec.bitWidth ?? 32;
    const b = spec.bit;
    if ('n' in b) {
      const mask = 1 << b.n;
      readB = () => ((getRaw() as number) & mask) !== 0;
      writeB = (v) => {
        const x = getRaw() as number;
        setRaw(wrapWidth(v ? x | mask : x & ~mask, width));
      };
    } else {
      const fn = b.fn;
      readB = () => ((getRaw() as number) & (1 << fn())) !== 0;
      writeB = (v) => {
        const mask = 1 << fn();
        const x = getRaw() as number;
        setRaw(wrapWidth(v ? x | mask : x & ~mask, width));
      };
    }
    readN = () => (readB() ? 1 : 0);
    writeN = (v) => writeB(v !== 0);
  } else if (spec.dims === undefined && isAtomic(type)) {
    const t: AtomicType = type;
    if (t === 'BOOL') {
      readB = () => getRaw() as boolean;
      writeB = (v) => setRaw(v);
      readN = () => (getRaw() ? 1 : 0);
      writeN = (v) => setRaw(v !== 0);
    } else {
      readB = () => (getRaw() as number) !== 0;
      writeB = (v) => setRaw(v ? 1 : 0);
      readN = () => getRaw() as number;
      writeN = (v) => setRaw(convertAtomic(t, v));
    }
  } else {
    readB = () => notScalar(path);
    writeB = () => notScalar(path);
    readN = () => notScalar(path);
    writeN = () => notScalar(path);
  }

  const scratch: { arr: TagValue[]; index: number } = { arr: [], index: 0 };
  let arrayLoc: () => { arr: TagValue[]; index: number };
  if (spec.arrayMode === 'element') {
    if (loc.sc) {
      const arr = loc.sc as unknown as TagValue[];
      const idx = loc.sk as number;
      arrayLoc = () => {
        scratch.arr = arr;
        scratch.index = idx;
        return scratch;
      };
    } else {
      const c = loc.cont!;
      const kf = loc.key!;
      arrayLoc = () => {
        scratch.arr = c() as unknown as TagValue[];
        scratch.index = kf() as number;
        return scratch;
      };
    }
  } else if (spec.arrayMode === 'whole') {
    arrayLoc = () => {
      scratch.arr = getRaw() as TagValue[];
      scratch.index = 0;
      return scratch;
    };
  } else {
    arrayLoc = () => {
      throw new TagError(`'${path}' is not an array operand.`);
    };
  }

  const atomicScalar = spec.bit !== undefined || (spec.dims === undefined && isAtomic(type));
  const assignDeep = spec.assignDeep ?? deepAssign;
  const ref: OperandRef = {
    path,
    type: spec.bit ? 'BOOL' : type,
    dims: spec.dims,
    array: spec.array,
    constant: spec.constant,
    scope: spec.scope,
    dynamic: spec.dynamic,
    isBit: spec.bit !== undefined,
    real: !spec.bit && type === 'REAL' && spec.dims === undefined,
    readB,
    writeB,
    readN,
    writeN,
    value: spec.bit ? readB : getRaw,
    assign: (v) => {
      if (atomicScalar) {
        if (typeof v === 'boolean') writeB(v);
        else if (typeof v === 'number') writeN(v);
        takeOverflow();
      } else {
        assignDeep(getRaw(), v);
        if (fo.n !== 0) fo.reapply();
        ctr.n++;
      }
    },
    arrayLoc,
  };
  if (loc.sc && atomicScalar && (spec.bit === undefined || 'n' in spec.bit)) {
    CELLS.set(ref, {
      o: loc.sc,
      k: loc.sk,
      bit: spec.bit && 'n' in spec.bit ? spec.bit.n : undefined,
      width: spec.bit ? (spec.bitWidth ?? 32) : intWidth(type),
      type: spec.bit ? 'BOOL' : type,
    });
  }
  return ref;
}

function valueGetter(loc: Loc): () => TagValue {
  if (loc.sc) {
    const o = loc.sc;
    const k = loc.sk;
    return () => o[k]!;
  }
  const c = loc.cont!;
  const kf = loc.key!;
  return () => c()[kf()]!;
}

function childLoc(loc: Loc, key: string | number): Loc {
  if (loc.sc) {
    const v = loc.sc[loc.sk];
    return { sc: v as Bag, sk: key, cont: null, key: null };
  }
  const get = valueGetter(loc) as () => Bag;
  return { sc: null, sk: key, cont: get, key: () => key };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** Tag database with the runtime extensions used by the controller. */
export interface LogixTagDatabase extends TagDatabase {
  /** Bumped whenever tags/types are defined or removed (cached refs must be re-resolved). */
  readonly structureVersion: number;
  /** Compile (cached) an operand accessor. Throws `TagError` when the operand does not resolve. */
  ref(operand: string, program?: string): OperandRef;
  /** Like `ref` but returns undefined instead of throwing. */
  tryRef(operand: string, program?: string): OperandRef | undefined;
  /** Define a hidden system operand such as S:FS (not listed by list()/listAll()). */
  defineSystem(def: TagDef): void;
  /** Tag definition in exactly the given scope (no controller fallback). */
  getDefExact(name: string, program?: string): TagDef | undefined;
  /**
   * Replace the stored definition metadata (description, constant, initial) without touching the value.
   * Changing `constant` bumps `structureVersion` (compiled refs carry the flag).
   */
  updateDefMetadata(def: TagDef, program?: string): boolean;
  /**
   * Problem that would make `define(def)` fail (invalid name, unknown or recursive data type, bad
   * dimension), or undefined when the definition is valid. Nothing is defined.
   */
  checkDef(def: TagDef): string | undefined;
  /**
   * Assign a whole value (structure / array / atomic) to an operand with Logix conversions
   * (e.g. 1.5 → 2 in a DINT, 1 → true in a BOOL member); unknown members are ignored.
   */
  writeValue(operand: string, value: TagValue, program?: string): void;
  /**
   * Install the force table: while installed, the forced values are written to memory and every later
   * write to a forced BOOL / bit / numeric cell (by logic, the field or the UI) keeps the forced value.
   * Only static scalar refs can be forced (indirect refs are ignored). Pass [] to remove all forces.
   * Cleared by `clear()` and `resetValues()` (their storage is replaced).
   */
  setForceOverlay(forces: ReadonlyArray<{ ref: OperandRef; value: boolean | number }>): void;
  /** Initial (zeroed + `initial`) value for a definition. */
  initialValue(def: TagDef): TagValue;
  /** Remove every tag and user/module type (built-in TIMER/COUNTER/CONTROL remain). */
  clear(): void;
  /** Reset every tag to its initial value. */
  resetValues(): void;
  /** Names of program scopes that currently hold tags. */
  programNames(): string[];
  /** Bump `version` after values were mutated directly through structure references (e.g. by a scan). */
  markChanged(): void;
}

const lower = (s: string): string => s.toLowerCase();
const SYS_SCOPE = '#sys';
const MAX_ALIAS_DEPTH = 16;

class TagDb implements LogixTagDatabase {
  private readonly types = new Map<string, TypeEntry>();
  private readonly ctrl = new Map<string, Slot>();
  private readonly programs = new Map<string, { name: string; tags: Map<string, Slot> }>();
  private readonly sys = new Map<string, Slot>();
  private readonly cache = new Map<string, OperandRef | TagError>();
  private readonly counter: RefShared = { n: 0, fo: new ForceOverlay() };
  private structure = 0;

  constructor() {
    for (const t of BUILTIN_TYPES) this.putType(t);
  }

  get version(): number {
    return this.counter.n;
  }

  get structureVersion(): number {
    return this.structure;
  }

  private bump(): void {
    this.structure++;
    this.counter.n++;
    this.cache.clear();
  }

  private putType(type: StructType): void {
    const members = new Map<string, StructMember>();
    for (const mem of type.members) members.set(lower(mem.name), mem);
    this.types.set(lower(type.name), { type, members });
  }

  private typeEntry(name: DataTypeName): TypeEntry | undefined {
    return this.types.get(lower(name));
  }

  // --- types ---------------------------------------------------------------

  getDataType(name: DataTypeName): StructType | undefined {
    return this.typeEntry(name)?.type;
  }

  registerDataType(type: StructType): void {
    this.putType(type);
    this.bump();
  }

  // --- definitions ---------------------------------------------------------

  private scopeMap(program: string | undefined, create: boolean): Map<string, Slot> | undefined {
    if (program === undefined) return this.ctrl;
    const key = lower(program);
    let p = this.programs.get(key);
    if (!p && create) {
      p = { name: program, tags: new Map() };
      this.programs.set(key, p);
    }
    return p?.tags;
  }

  private zero(type: DataTypeName, dims: number | undefined, depth = 0): TagValue {
    if (depth > 32) throw new TagError(`Data type '${type}' is recursive.`);
    if (dims !== undefined && dims > 0) {
      return Array.from({ length: dims }, () => this.zero(type, undefined, depth + 1));
    }
    if (type === 'BOOL') return false;
    if (isNumericType(type)) return 0;
    const te = this.typeEntry(type);
    if (!te) throw new TagError(`Unknown data type '${type}'.`);
    const out: Bag = {};
    for (const mem of te.type.members) {
      if (mem.bitOf) continue;
      out[mem.name] = this.zero(mem.dataType, mem.dims, depth + 1);
    }
    return out;
  }

  private coerce(type: DataTypeName, dims: number | undefined, init: unknown, current: TagValue): TagValue {
    if (init === undefined || init === null) return current;
    if (dims !== undefined && dims > 0) {
      if (!Array.isArray(init) || !Array.isArray(current)) return current;
      const n = Math.min(init.length, current.length);
      for (let i = 0; i < n; i++) current[i] = this.coerce(type, undefined, init[i], current[i]!);
      return current;
    }
    if (isAtomic(type)) {
      if (typeof init === 'number' || typeof init === 'boolean') {
        const v = convertAtomic(type, Number(init));
        takeOverflow();
        return v;
      }
      return current;
    }
    const te = this.typeEntry(type);
    if (!te || typeof init !== 'object' || Array.isArray(init) || typeof current !== 'object' || Array.isArray(current)) {
      return current;
    }
    for (const [k, v] of Object.entries(init as Record<string, unknown>)) {
      const mem = te.members.get(lower(k));
      if (!mem) continue;
      if (mem.bitOf) {
        const baseMem = te.members.get(lower(mem.bitOf.member));
        const base = current[mem.bitOf.member];
        if (baseMem && typeof base === 'number') {
          const mask = 1 << mem.bitOf.bit;
          current[mem.bitOf.member] = wrapWidth(v ? base | mask : base & ~mask, intWidth(baseMem.dataType) || 32);
        }
        continue;
      }
      current[mem.name] = this.coerce(mem.dataType, mem.dims, v, current[mem.name]!);
    }
    return current;
  }

  initialValue(def: TagDef): TagValue {
    const dims = def.dims && def.dims > 0 ? def.dims : undefined;
    return this.coerce(def.dataType, dims, def.initial, this.zero(def.dataType, dims));
  }

  private validate(def: TagDef): void {
    if (!def.system && !isValidTagName(def.name)) throw new TagError(`Invalid tag name '${def.name}'.`);
    if (def.dims !== undefined && (!Number.isInteger(def.dims) || def.dims < 0)) {
      throw new TagError(`Invalid array dimension for '${def.name}'.`);
    }
    if (!def.aliasFor && !isAtomic(def.dataType) && !this.typeEntry(def.dataType)) {
      throw new TagError(`Unknown data type '${def.dataType}' for tag '${def.name}'.`);
    }
  }

  define(def: TagDef, program?: string): void {
    this.validate(def);
    const map = this.scopeMap(program, true)!;
    const stored: TagDef = { ...def };
    const value = def.aliasFor ? false : this.initialValue(stored);
    map.set(lower(def.name), { def: stored, value, scope: program ?? '' });
    this.bump();
  }

  defineSystem(def: TagDef): void {
    const stored: TagDef = { ...def, system: true };
    this.sys.set(lower(def.name), { def: stored, value: this.initialValue(stored), scope: SYS_SCOPE });
    this.bump();
  }

  updateDefMetadata(def: TagDef, program?: string): boolean {
    const slot = this.scopeMap(program, false)?.get(lower(def.name));
    if (!slot) return false;
    const constantChanged = (slot.def.constant === true) !== (def.constant === true);
    slot.def = { ...def, name: slot.def.name };
    // Compiled refs carry the `constant` flag: consumers must recompile when it changes.
    if (constantChanged) this.bump();
    else this.counter.n++;
    return true;
  }

  checkDef(def: TagDef): string | undefined {
    try {
      this.validate(def);
      if (!def.aliasFor) this.initialValue({ ...def });
      return undefined;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  setForceOverlay(forces: ReadonlyArray<{ ref: OperandRef; value: boolean | number }>): void {
    const fo = this.counter.fo;
    fo.clear();
    let n = 0;
    for (const { ref, value } of forces) {
      const cell = CELLS.get(ref);
      if (!cell) continue;
      let m = fo.cells.get(cell.o);
      if (!m) {
        m = new Map();
        fo.cells.set(cell.o, m);
      }
      let f = m.get(cell.k);
      if (!f) {
        f = { whole: undefined, set: 0, clr: 0, width: cell.width };
        m.set(cell.k, f);
        n++;
      }
      const on = typeof value === 'boolean' ? value : value !== 0;
      if (cell.bit !== undefined) {
        const mask = 1 << cell.bit;
        if (on) {
          f.set |= mask;
          f.clr &= ~mask;
        } else {
          f.clr |= mask;
          f.set &= ~mask;
        }
      } else if (isAtomic(cell.type)) {
        f.whole = cell.type === 'BOOL' ? on : (convertAtomic(cell.type, Number(value)) as number);
        takeOverflow();
      }
    }
    fo.n = n;
    fo.reapply();
    this.counter.n++;
  }

  remove(name: string, program?: string): void {
    const map = this.scopeMap(program, false);
    if (map?.delete(lower(name))) this.bump();
  }

  clear(): void {
    this.counter.fo.clear();
    this.ctrl.clear();
    this.programs.clear();
    this.sys.clear();
    this.types.clear();
    for (const t of BUILTIN_TYPES) this.putType(t);
    this.bump();
  }

  resetValues(): void {
    this.counter.fo.clear(); // storage is replaced: forces must be re-installed
    const all = [...this.ctrl.values(), ...this.sys.values(), ...[...this.programs.values()].flatMap((p) => [...p.tags.values()])];
    for (const slot of all) slot.value = slot.def.aliasFor ? false : this.initialValue(slot.def);
    this.bump();
  }

  programNames(): string[] {
    return [...this.programs.values()].map((p) => p.name);
  }

  markChanged(): void {
    this.counter.n++;
  }

  private info(slot: Slot): TagInfo {
    const d = slot.def;
    return {
      name: d.name,
      scope: slot.scope === '' ? 'Controller' : slot.scope,
      dataType: d.aliasFor ? (this.tryRef(d.name, slot.scope || undefined)?.type ?? d.dataType) : d.dataType,
      ...(d.dims ? { dims: d.dims } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.aliasFor !== undefined ? { aliasFor: d.aliasFor } : {}),
      ...(d.system ? { system: true } : {}),
      ...(d.constant ? { constant: true } : {}),
    };
  }

  list(program?: string): TagInfo[] {
    const map = this.scopeMap(program, false);
    return map ? [...map.values()].map((s) => this.info(s)) : [];
  }

  listAll(): TagInfo[] {
    const out = this.list();
    for (const p of this.programs.values()) for (const s of p.tags.values()) out.push(this.info(s));
    return out;
  }

  private lookup(name: string, program: string | undefined): Slot | undefined {
    const key = lower(name);
    if (program !== undefined) {
      const s = this.programs.get(lower(program))?.tags.get(key);
      if (s) return s;
    }
    return this.ctrl.get(key) ?? this.sys.get(key);
  }

  getDef(name: string, program?: string): TagDef | undefined {
    return this.lookup(name, program)?.def;
  }

  getDefExact(name: string, program?: string): TagDef | undefined {
    return this.scopeMap(program, false)?.get(lower(name))?.def;
  }

  // --- operand resolution ----------------------------------------------------

  ref(operand: string, program?: string): OperandRef {
    const key = `${program === undefined ? '' : lower(program)}\u0000${operand}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      if (hit instanceof TagError) throw hit;
      return hit;
    }
    try {
      const r = this.build(operand, program, 0, program);
      this.cache.set(key, r);
      return r;
    } catch (e) {
      const err = e instanceof TagError ? e : new TagError(e instanceof Error ? e.message : String(e));
      this.cache.set(key, err);
      throw err;
    }
  }

  tryRef(operand: string, program?: string): OperandRef | undefined {
    try {
      return this.ref(operand, program);
    } catch {
      return undefined;
    }
  }

  /** Numeric source for an array subscript / indirect bit number: literal, integer tag or integer expression. */
  private indexSource(text: string, program: string | undefined, depth: number): NumSource {
    let isOperand = false;
    try {
      parseOperandPath(text);
      isOperand = RE_BASE.exec(text)?.[0] !== undefined && !/[\s+\-*/()]/.test(text);
    } catch {
      isOperand = false;
    }
    if (isOperand) {
      const r = this.build(text, program, depth + 1, program);
      if (r.dims !== undefined || !isIntegerType(r.type)) {
        throw new TagError(`Array subscript '${text}' must be a SINT, INT or DINT tag or an integer expression.`);
      }
      return r;
    }
    try {
      const expr = compileExpression(text, (op) => this.build(op, program, depth + 1, program));
      if (expr.real) throw new TagError(`Array subscript '${text}' must be an integer expression.`);
      return { readN: expr.readN, real: false, dynamic: true };
    } catch (e) {
      if (e instanceof ExpressionError) throw new TagError(`Invalid array subscript '${text}': ${e.message}.`);
      throw e;
    }
  }

  private build(text: string, program: string | undefined, depth: number, indexProgram: string | undefined): OperandRef {
    const p = parseOperandPath(text);
    const slot = this.lookup(p.base, program);
    if (!slot) throw new TagError(`Undefined tag '${p.base}'.`);
    if (slot.def.aliasFor) {
      if (depth >= MAX_ALIAS_DEPTH) throw new TagError(`Alias '${slot.def.name}' is circular or nested too deeply.`);
      const aliasProgram = slot.scope === '' || slot.scope === SYS_SCOPE ? undefined : slot.scope;
      try {
        return this.build(slot.def.aliasFor + p.rest, aliasProgram, depth + 1, indexProgram);
      } catch (e) {
        if (e instanceof TagError && depth === 0 && !e.message.startsWith('Alias')) {
          throw new TagError(`Alias '${slot.def.name}' -> '${slot.def.aliasFor}': ${e.message}`);
        }
        throw e;
      }
    }

    let type: DataTypeName = slot.def.dataType;
    let dims: number | undefined = slot.def.dims && slot.def.dims > 0 ? slot.def.dims : undefined;
    let path = slot.def.name;
    let loc: Loc = { sc: slot as unknown as Bag, sk: 'value', cont: null, key: null };
    let array: RefSpec['array'];
    let arrayMode: RefSpec['arrayMode'];
    let dynamic = false;
    const constant = slot.def.constant === true;
    const scope = slot.scope;
    const segs = p.segs;

    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s]!;
      const last = s === segs.length - 1;
      if (seg.k === 'm') {
        if (dims !== undefined) throw new TagError(`'${path}' is an array; a subscript is required before '.${seg.name}'.`);
        const te = this.typeEntry(type);
        const mem = te?.members.get(lower(seg.name));
        if (!te || !mem) throw new TagError(`'${seg.name}' is not a member of ${type} ('${path}').`);
        if (mem.bitOf) {
          if (!last) throw new TagError(`'${path}.${mem.name}' is a BOOL; it has no members.`);
          const baseMem = te.members.get(lower(mem.bitOf.member));
          const width = baseMem ? intWidth(baseMem.dataType) : 0;
          if (!width) throw new TagError(`Invalid bit alias '${mem.name}' in ${type}.`);
          return makeRef(
            childLoc(loc, mem.bitOf.member),
            {
              path: `${path}.${mem.name}`,
              scope,
              type: 'BOOL',
              dims: undefined,
              array: undefined,
              arrayMode: undefined,
              constant,
              dynamic,
              bit: { n: mem.bitOf.bit },
              bitWidth: width,
            },
            this.counter,
          );
        }
        loc = childLoc(loc, mem.name);
        type = mem.dataType;
        dims = mem.dims && mem.dims > 0 ? mem.dims : undefined;
        path += `.${mem.name}`;
        array = undefined;
        arrayMode = undefined;
      } else if (seg.k === 'i') {
        if (dims === undefined) throw new TagError(`'${path}' is not an array.`);
        const len = dims;
        const lit = parseNumericLiteral(seg.text);
        if (lit && !lit.real) {
          if (lit.value < 0 || lit.value >= len) {
            throw new TagError(`Array subscript out of range: '${path}[${lit.value}]' (array size ${len}).`);
          }
          loc = childLoc(loc, lit.value);
          path += `[${lit.value}]`;
        } else {
          if (lit) throw new TagError(`Array subscript '${seg.text}' must be an integer.`);
          const idx = this.indexSource(seg.text, indexProgram, depth);
          const shown = `${path}[${seg.text}]`;
          const parent: () => Bag = loc.sc ? ((arr) => () => arr)(loc.sc[loc.sk] as Bag) : (valueGetter(loc) as () => Bag);
          const key: KeyFn = () => {
            const i = idx.readN();
            if (i >= 0 && i < len) return i;
            throw new PlcFault(4, 20, `Array subscript out of range: ${shown} evaluated to index ${i} (array size ${len}).`);
          };
          loc = { sc: null, sk: 0, cont: parent, key };
          dynamic = true;
          path = shown;
        }
        array = { length: len, elemType: type };
        arrayMode = 'element';
        dims = undefined;
      } else {
        if (dims !== undefined) throw new TagError(`'${path}' is an array; a subscript is required.`);
        const width = intWidth(type);
        if (!width) throw new TagError(`Bit addressing is only allowed on SINT, INT or DINT ('${path}' is ${type}).`);
        if (!last) throw new TagError(`'${text}': a bit has no members.`);
        if (seg.k === 'b') {
          if (seg.n >= width) throw new TagError(`Bit number ${seg.n} is out of range for ${type} (0-${width - 1}).`);
          return makeRef(
            loc,
            { path: `${path}.${seg.n}`, scope, type: 'BOOL', dims: undefined, array: undefined, arrayMode: undefined, constant, dynamic, bit: { n: seg.n }, bitWidth: width },
            this.counter,
          );
        }
        const lit = parseNumericLiteral(seg.text);
        if (lit && !lit.real) {
          if (lit.value < 0 || lit.value >= width) {
            throw new TagError(`Bit number ${lit.value} is out of range for ${type} (0-${width - 1}).`);
          }
          return makeRef(
            loc,
            { path: `${path}.${lit.value}`, scope, type: 'BOOL', dims: undefined, array: undefined, arrayMode: undefined, constant, dynamic, bit: { n: lit.value }, bitWidth: width },
            this.counter,
          );
        }
        const idx = this.indexSource(seg.text, indexProgram, depth);
        const shown = `${path}.[${seg.text}]`;
        const fn = (): number => {
          const b = idx.readN();
          if (b >= 0 && b < width) return b;
          throw new PlcFault(4, 20, `Bit subscript out of range: ${shown} evaluated to bit ${b} (${type} has ${width} bits).`);
        };
        return makeRef(
          loc,
          { path: shown, scope, type: 'BOOL', dims: undefined, array: undefined, arrayMode: undefined, constant, dynamic: true, bit: { fn }, bitWidth: width },
          this.counter,
        );
      }
    }
    if (dims !== undefined) {
      array = { length: dims, elemType: type };
      arrayMode = 'whole';
    }
    const finalType = type;
    const finalDims = dims;
    const assignDeep = (target: TagValue, v: TagValue): void => {
      this.coerce(finalType, finalDims, v, target);
    };
    return makeRef(loc, { path, scope, type, dims, array, arrayMode, constant, dynamic, assignDeep }, this.counter);
  }

  // --- value access ------------------------------------------------------------

  exists(operand: string, program?: string): boolean {
    return this.tryRef(operand, program) !== undefined;
  }

  typeOf(operand: string, program?: string): DataTypeName | undefined {
    return this.tryRef(operand, program)?.type;
  }

  readBool(operand: string, program?: string): boolean {
    return this.ref(operand, program).readB();
  }

  writeBool(operand: string, value: boolean, program?: string): void {
    this.ref(operand, program).writeB(value);
  }

  readNumber(operand: string, program?: string): number {
    return this.ref(operand, program).readN();
  }

  writeNumber(operand: string, value: number, program?: string): void {
    this.ref(operand, program).writeN(value);
    takeOverflow();
  }

  writeValue(operand: string, value: TagValue, program?: string): void {
    this.ref(operand, program).assign(value);
  }

  getStruct<T extends object = Record<string, TagValue>>(operand: string, program?: string): T | undefined {
    const r = this.tryRef(operand, program);
    if (!r || r.dims !== undefined || r.isBit) return undefined;
    try {
      const v = r.value();
      return typeof v === 'object' && !Array.isArray(v) ? (v as unknown as T) : undefined;
    } catch {
      return undefined;
    }
  }

  private cloneTyped(v: TagValue, type: DataTypeName, dims: number | undefined): TagValue {
    if (dims !== undefined && Array.isArray(v)) return v.map((e) => this.cloneTyped(e, type, undefined));
    if (typeof v !== 'object' || v === null) return v;
    const te = this.typeEntry(type);
    if (!te || Array.isArray(v)) return structuredClone(v);
    const out: Bag = {};
    for (const mem of te.type.members) {
      if (mem.bitOf) {
        const base = v[mem.bitOf.member];
        out[mem.name] = typeof base === 'number' && ((base >> mem.bitOf.bit) & 1) === 1;
      } else if (mem.name in v) {
        out[mem.name] = this.cloneTyped(v[mem.name]!, mem.dataType, mem.dims && mem.dims > 0 ? mem.dims : undefined);
      }
    }
    return out;
  }

  readValue(operand: string, program?: string): TagValue | undefined {
    const r = this.tryRef(operand, program);
    if (!r) return undefined;
    try {
      return this.cloneTyped(r.value(), r.type, r.dims);
    } catch {
      return undefined;
    }
  }
}

/** Create an empty tag database (TIMER, COUNTER and CONTROL are pre-registered). */
export function createTagDatabase(): LogixTagDatabase {
  return new TagDb();
}
