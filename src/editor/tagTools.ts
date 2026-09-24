/**
 * Controller-facing helpers for the editor UIs (headless — no React/DOM):
 * tag descriptions/aliases for the ladder layout, cached live readers, value formatting, force
 * lookups, operand autocomplete and instruction search.
 */
import { INSTRUCTION_DEFS, type OperandSpec } from '@/plc/instructions';
import { ioKindOfPath } from '@/plc/catalog';
import { parseOperandPath, type LogixTagDatabase, type OperandRef } from '@/plc/tags';
import type { DataTypeName, InstructionInfo, PlcController, TagDatabase, TagInfo } from '@/plc/types';
import type { TagMeta, TagMetaLookup } from './layout';

const lower = (s: string): string => s.toLowerCase();
const NUMERIC = new Set(['SINT', 'INT', 'DINT', 'REAL']);
const INTEGER = new Set(['SINT', 'INT', 'DINT']);
const BITS: Record<string, number> = { SINT: 8, INT: 16, DINT: 32 };

type MaybeLogixDb = TagDatabase & Partial<Pick<LogixTagDatabase, 'tryRef' | 'structureVersion'>>;

/** Tag database of a controller with the optional Logix extensions exposed as optional members. */
export function dbOf(controller: PlcController): MaybeLogixDb {
  return controller.tags as MaybeLogixDb;
}

/** Structure version of the controller tag database (changes when tags are created/deleted). */
export function structureVersionOf(controller: PlcController | undefined): number {
  if (!controller) return 0;
  return dbOf(controller).structureVersion ?? 0;
}

/**
 * Description / alias lookup for operands (base tag description; alias target with the member path
 * appended, e.g. `Status.3` → `<Local:1:I.Data.3>`). Results are cached; build a new lookup after the
 * tag structure changes.
 */
export function makeTagMeta(controller: PlcController | undefined, program?: string): TagMetaLookup | undefined {
  if (!controller) return undefined;
  const cache = new Map<string, TagMeta | undefined>();
  return (operand) => {
    if (cache.has(operand)) return cache.get(operand);
    let meta: TagMeta | undefined;
    try {
      const p = parseOperandPath(operand);
      const def = controller.tags.getDef(p.base, program);
      if (def) {
        meta = {};
        if (def.description) meta.description = def.description;
        if (def.aliasFor) meta.aliasFor = def.aliasFor + p.rest;
        const t = controller.tags.typeOf(operand, program);
        if (t) meta.dataType = t;
      }
    } catch {
      meta = undefined;
    }
    cache.set(operand, meta);
    return meta;
  };
}

// ---------------------------------------------------------------------------
// Live values
// ---------------------------------------------------------------------------

export type DisplayStyle = 'Decimal' | 'Binary' | 'Octal' | 'Hex' | 'Float' | 'Exponential' | 'ASCII';

/** Logix-like REAL display: 62.5, 0.0, 3.1415927, 1.0e+10. */
export function formatReal(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '1.#QNAN' : v > 0 ? '1.$' : '-1.$';
  if (v === 0) return '0.0';
  const a = Math.abs(v);
  if (a >= 1e7 || a < 1e-4) return v.toExponential(7).replace(/\.?0+e/, 'e').replace(/e\+?(-?)(\d)$/, 'e$10$2');
  const s = Number(v.toPrecision(8)).toString();
  return s.includes('.') ? s : `${s}.0`;
}

function groupDigits(s: string, n: number): string {
  const out: string[] = [];
  for (let i = s.length; i > 0; i -= n) out.unshift(s.slice(Math.max(0, i - n), i));
  return out.join('_');
}

/** Format a value with a Studio 5000 display style (`2#0000_0101`, `16#00FF`, `8#17`). */
export function formatValue(v: boolean | number | undefined, type: DataTypeName | undefined, style: DisplayStyle = 'Decimal'): string {
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  const t = (type ?? 'DINT').toUpperCase();
  if (t === 'BOOL') return v ? '1' : '0';
  if (t === 'REAL') return style === 'Exponential' ? v.toExponential(8) : formatReal(v);
  const width = BITS[t] ?? 32;
  const u = width === 32 ? v >>> 0 : v & ((1 << width) - 1);
  switch (style) {
    case 'Binary':
      return `2#${groupDigits(u.toString(2).padStart(width, '0'), 4)}`;
    case 'Hex':
      return `16#${groupDigits(u.toString(16).toUpperCase().padStart(width / 4, '0'), 4)}`;
    case 'Octal':
      return `8#${u.toString(8)}`;
    case 'ASCII': {
      let s = '';
      for (let i = width / 8 - 1; i >= 0; i--) {
        const c = (u >>> (i * 8)) & 0xff;
        s += c >= 32 && c < 127 ? String.fromCharCode(c) : `$${c.toString(16).toUpperCase().padStart(2, '0')}`;
      }
      return `'${s}'`;
    }
    default:
      return String(v);
  }
}

/** Parse a user-typed value (decimal, 16#FF, 2#1010, 8#17, 1.5e3). */
export function parseUserValue(text: string): number | undefined {
  const t = text.trim().replace(/_/g, '');
  const m = /^([-+]?)(2|8|16)#([0-9a-fA-F]+)$/.exec(t);
  if (m) {
    const n = parseInt(m[3]!, Number(m[2]));
    if (Number.isNaN(n)) return undefined;
    return m[1] === '-' ? -n : n;
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export interface LiveReader {
  /** Scalar value of an operand (BOOL → boolean, numbers → number); undefined when not readable. */
  read(operand: string): boolean | number | undefined;
  /** Data type of an operand (cached). */
  type(operand: string): DataTypeName | undefined;
  /** Formatted value (Decimal style), '' when not readable. */
  format(operand: string): string;
}

interface CachedReader {
  type: DataTypeName | undefined;
  read: () => boolean | number | undefined;
}

/** Cached operand readers (re-resolved when the tag structure changes). */
export function createLiveReader(controller: PlcController, program?: string): LiveReader {
  const db = dbOf(controller);
  const cache = new Map<string, CachedReader>();
  let structure = db.structureVersion;
  const none: CachedReader = { type: undefined, read: () => undefined };

  const build = (op: string): CachedReader => {
    if (db.tryRef) {
      const r: OperandRef | undefined = db.tryRef(op, program);
      if (!r || r.dims !== undefined) return r ? { type: r.type, read: () => undefined } : none;
      if (r.type === 'BOOL') {
        return {
          type: 'BOOL',
          read: () => {
            try {
              return r.readB();
            } catch {
              return undefined;
            }
          },
        };
      }
      if (NUMERIC.has(r.type.toUpperCase())) {
        return {
          type: r.type,
          read: () => {
            try {
              return r.readN();
            } catch {
              return undefined;
            }
          },
        };
      }
      return { type: r.type, read: () => undefined };
    }
    let t: DataTypeName | undefined;
    try {
      t = db.typeOf(op, program);
    } catch {
      t = undefined;
    }
    if (!t) return none;
    if (t === 'BOOL') return { type: t, read: () => safe(() => db.readBool(op, program)) };
    if (NUMERIC.has(t.toUpperCase())) return { type: t, read: () => safe(() => db.readNumber(op, program)) };
    return { type: t, read: () => undefined };
  };

  const get = (op: string): CachedReader => {
    if (db.structureVersion !== structure) {
      cache.clear();
      structure = db.structureVersion;
    }
    let c = cache.get(op);
    if (!c) {
      c = build(op);
      cache.set(op, c);
    }
    return c;
  };

  return {
    read: (op) => get(op).read(),
    type: (op) => get(op).type,
    format: (op) => {
      const c = get(op);
      return formatValue(c.read(), c.type);
    },
  };
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Forces
// ---------------------------------------------------------------------------

export interface ForceInfo {
  /** The operand resolves to a fixed module I/O address (or an alias of one). */
  forceable: boolean;
  /** Installed force value. */
  forced?: boolean | number;
  path?: string;
  bool?: boolean;
}

/** Can this operand be forced, and is it forced? */
export function forceInfo(controller: PlcController | undefined, operand: string, program?: string): ForceInfo {
  if (!controller || !operand || operand === '?') return { forceable: false };
  const db = dbOf(controller);
  let path: string | undefined;
  let bool = false;
  let fixed = true;
  let scalar = true;
  if (db.tryRef) {
    const r = db.tryRef(operand, program);
    if (!r) return { forceable: false };
    path = r.path;
    bool = r.type === 'BOOL';
    fixed = !r.dynamic;
    scalar = r.dims === undefined && (bool || NUMERIC.has(r.type.toUpperCase()));
  } else {
    const t = safe(() => db.typeOf(operand, program));
    if (!t) return { forceable: false };
    bool = t === 'BOOL';
    const def = safe(() => db.getDef(parseOperandPath(operand).base, program));
    path = def?.aliasFor ? def.aliasFor + parseOperandPath(operand).rest : operand;
  }
  const kind = path ? ioKindOfPath(path) : undefined;
  const forceable = fixed && scalar && (kind === 'I' || kind === 'O');
  let forced: boolean | number | undefined;
  if (controller.getForce) forced = safe(() => controller.getForce!(operand, program));
  else if (path) forced = controller.getForces()[path];
  const out: ForceInfo = { forceable, bool };
  if (path) out.path = path;
  if (forced !== undefined) out.forced = forced;
  return out;
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export interface OperandSuggestion {
  /** Text inserted into the operand. */
  operand: string;
  dataType: string;
  description?: string;
  /** 'Controller' or program name. */
  scope?: string;
  aliasFor?: string;
  /** Has members/bits/elements that match better (typing '.' drills down). */
  expandable?: boolean;
  kind: 'tag' | 'member' | 'bit' | 'element' | 'routine' | 'label' | 'system';
}

export interface SuggestExtras {
  routines?: readonly string[];
  labels?: readonly string[];
  limit?: number;
}

type Compat = 'direct' | 'expand' | false;

function typeCompat(spec: OperandSpec | undefined, type: string, dims: number | undefined, db: TagDatabase): Compat {
  const t = type.toUpperCase();
  const isArray = dims !== undefined && dims > 0;
  const st = db.getDataType(type);
  const memberTypes = st ? st.members.filter((m) => !m.hidden).map((m) => m.dataType.toUpperCase()) : [];
  if (!spec) return 'direct';
  switch (spec.kind) {
    case 'bit':
    case 'bitDest':
      if (isArray) return 'expand';
      if (t === 'BOOL') return 'direct';
      if (INTEGER.has(t) || memberTypes.some((m) => m === 'BOOL' || INTEGER.has(m))) return 'expand';
      return false;
    case 'num':
    case 'numDest':
    case 'scalar':
    case 'scalarDest':
    case 'expr':
      if (isArray) return 'expand';
      if (NUMERIC.has(t) || ((spec.kind === 'scalar' || spec.kind === 'scalarDest' || spec.kind === 'expr') && t === 'BOOL')) return 'direct';
      if (memberTypes.some((m) => NUMERIC.has(m))) return 'expand';
      return false;
    case 'int':
    case 'intDest':
      if (isArray) return 'expand';
      if (INTEGER.has(t)) return 'direct';
      if (memberTypes.some((m) => INTEGER.has(m))) return 'expand';
      return false;
    case 'struct':
      return !isArray && spec.types.some((x) => x.toUpperCase() === t) ? 'direct' : false;
    case 'array':
      if (!isArray) return false;
      return !spec.elem || spec.elem.some((e) => e.toUpperCase() === t) ? 'direct' : false;
    case 'any':
      return 'direct';
    default:
      return false;
  }
}

function rank(name: string, q: string): number {
  if (!q) return 1;
  const n = lower(name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[_.:[\]]/).some((part) => part.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  return -1;
}

/** Operand spec for an instruction operand (position-dependent specs included). */
export function specOf(op: string, index: number, operands: readonly string[] = []): OperandSpec | undefined {
  const def = INSTRUCTION_DEFS[op.toUpperCase()];
  if (!def) return undefined;
  return def.specFor?.(index, operands) ?? def.operands[index] ?? def.variadic;
}

/** Suggestions for an operand being typed, filtered by the operand's data type. */
export function suggestOperands(
  controller: PlcController | undefined,
  program: string | undefined,
  spec: OperandSpec | undefined,
  query: string,
  extras: SuggestExtras = {},
): OperandSuggestion[] {
  const limit = extras.limit ?? 60;
  const q = lower(query.trim());
  if (spec?.kind === 'routine') {
    return (extras.routines ?? [])
      .map((r) => ({ r, k: rank(r, q) }))
      .filter((x) => x.k >= 0)
      .sort((a, b) => a.k - b.k)
      .slice(0, limit)
      .map(({ r }) => ({ operand: r, dataType: 'ROUTINE', kind: 'routine' as const }));
  }
  if (spec?.kind === 'label') {
    return (extras.labels ?? [])
      .filter((l) => rank(l, q) >= 0)
      .slice(0, limit)
      .map((l) => ({ operand: l, dataType: 'LABEL', kind: 'label' as const }));
  }
  if (!controller || spec?.kind === 'display' || spec?.kind === 'imm') return [];
  const db = controller.tags;

  // Drill-down: 'Timer1.' → members, 'MyDint.' → bits, 'Arr[' → elements
  const dot = query.lastIndexOf('.');
  const bracket = query.lastIndexOf('[');
  if (dot > 0 && dot > bracket) {
    const base = query.slice(0, dot);
    const part = lower(query.slice(dot + 1));
    const t = safe(() => db.typeOf(base, program));
    if (!t) return [];
    const out: OperandSuggestion[] = [];
    const st = db.getDataType(t);
    if (st) {
      for (const m of st.members) {
        if (m.hidden) continue;
        if (!lower(m.name).startsWith(part)) continue;
        const c = typeCompat(spec, m.dataType, m.dims, db);
        if (!c) continue;
        out.push({
          operand: `${base}.${m.name}`,
          dataType: m.dims ? `${m.dataType}[${m.dims}]` : m.dataType,
          ...(m.description ? { description: m.description } : {}),
          ...(c === 'expand' ? { expandable: true } : {}),
          kind: 'member',
        });
      }
      out.sort((a, b) => Number(a.expandable === true) - Number(b.expandable === true));
    } else if (BITS[t.toUpperCase()] && (spec?.kind === 'bit' || spec?.kind === 'bitDest' || !spec)) {
      for (let b = 0; b < BITS[t.toUpperCase()]!; b++) {
        if (!String(b).startsWith(part)) continue;
        out.push({ operand: `${base}.${b}`, dataType: 'BOOL', description: `Bit ${b}`, kind: 'bit' });
      }
    }
    return out.slice(0, limit);
  }
  if (bracket > 0 && !query.includes(']')) {
    const base = query.slice(0, bracket);
    const def = safe(() => db.getDef(base, program));
    if (def?.dims) {
      const part = query.slice(bracket + 1);
      const out: OperandSuggestion[] = [];
      for (let i = 0; i < Math.min(def.dims, 200); i++) {
        if (part && !String(i).startsWith(part)) continue;
        out.push({ operand: `${base}[${i}]`, dataType: def.dataType, kind: 'element' });
      }
      return out.slice(0, limit);
    }
  }

  const tags: TagInfo[] = db.listAll().filter((t) => t.scope === 'Controller' || (program !== undefined && lower(t.scope) === lower(program)));
  const scored: Array<{ s: OperandSuggestion; k: number }> = [];
  for (const t of tags) {
    const k = rank(t.name, q);
    if (k < 0) continue;
    const c = typeCompat(spec, t.dataType, t.dims, db);
    if (!c) continue;
    const isArr = t.dims !== undefined && t.dims > 0;
    const arrayElem = spec?.kind === 'array';
    scored.push({
      k: k * 2 + (c === 'expand' ? 1 : 0) + (t.system ? 0.5 : 0),
      s: {
        operand: arrayElem && isArr ? `${t.name}[0]` : t.name,
        dataType: isArr ? `${t.dataType}[${t.dims}]` : t.dataType,
        ...(t.description ? { description: t.description } : {}),
        scope: t.scope,
        ...(t.aliasFor ? { aliasFor: t.aliasFor } : {}),
        ...(c === 'expand' ? { expandable: true } : {}),
        kind: 'tag',
      },
    });
  }
  if ((spec?.kind === 'bit' || !spec) && rank('S:FS', q) >= 0 && q.startsWith('s')) {
    scored.push({ k: 5, s: { operand: 'S:FS', dataType: 'BOOL', description: 'First scan after entering Run', kind: 'system' } });
  }
  scored.sort((a, b) => a.k - b.k || a.s.operand.localeCompare(b.s.operand));
  return scored.slice(0, limit).map((x) => x.s);
}

/** Instruction search for quick entry / mnemonic change. */
export function suggestMnemonics(query: string, allowed?: readonly string[], limit = 12): InstructionInfo[] {
  const q = query.trim().toUpperCase();
  const allow = allowed ? new Set(allowed.map((a) => a.toUpperCase())) : undefined;
  const all = Object.values(INSTRUCTION_DEFS) as InstructionInfo[];
  const scored = all
    .map((d) => {
      let k = -1;
      if (!q) k = 2;
      else if (d.mnemonic === q) k = 0;
      else if (d.mnemonic.startsWith(q)) k = 1;
      else if (d.name.toUpperCase().split(/\s+/).some((w) => w.startsWith(q))) k = 3;
      else if (d.name.toUpperCase().includes(q)) k = 4;
      return { d, k: allow && !allow.has(d.mnemonic) ? (k < 0 ? -1 : k + 10) : k };
    })
    .filter((x) => x.k >= 0);
  scored.sort((a, b) => a.k - b.k);
  return scored.slice(0, limit).map((x) => x.d);
}

/** Routine names of a program and LBL names used in a set of rungs (for JSR / JMP autocomplete). */
export function routinesOf(controller: PlcController | undefined, program: string): string[] {
  const p = controller?.project.programs.find((x) => lower(x.name) === lower(program));
  return p ? p.routines.map((r) => r.name) : [];
}
