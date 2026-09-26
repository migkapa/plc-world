/**
 * Studio 5000 "Controller Tags" window: Monitor Tags / Edit Tags tabs.
 *
 * Monitor: expandable tree (structures → members, arrays → elements, integers → bits) with live values
 * (click a BOOL to toggle, click a number to edit), force mask, per-tag display style, data type and
 * description. Edit: create tags (name validation, type, dims, alias with autocomplete, description),
 * edit description / alias / type / constant, delete user tags — through controller.upsertTag/deleteTag.
 * Rows are virtualized (fixed row height), so hundreds of tags stay fast.
 */
import { ChevronRight, Lock, Plus, Search, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { isValidTagName } from '@/plc/tags';
import type { DataTypeName, PlcController, TagDef, TagInfo } from '@/plc/types';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { ContextMenu, type MenuEntry } from './EditorOverlays';
import { createLiveReader, forceInfo, formatValue, parseUserValue, suggestOperands, withAliasTarget, type DisplayStyle } from './tagTools';
import './ladder.css';

export interface TagMonitorProps {
  controller: PlcController;
  /** Program whose local tags are selectable (default: every program of the project). */
  program?: string;
  onTagsChanged?(): void;
  compact?: boolean;
  className?: string;
  initialTab?: 'monitor' | 'edit';
  /** Initial scope: 'controller' (default) or a program name. */
  initialScope?: string;
}

type Tab = 'monitor' | 'edit';

interface Row {
  key: string;
  path: string;
  label: string;
  depth: number;
  type: string;
  dims?: number;
  expandable: boolean;
  scalar: boolean;
  description?: string;
  top?: TagInfo;
}

const lower = (s: string): string => s.toLowerCase();
const INT_BITS: Record<string, number> = { SINT: 8, INT: 16, DINT: 32 };
const BASE_TYPES = ['BOOL', 'SINT', 'INT', 'DINT', 'REAL', 'TIMER', 'COUNTER', 'CONTROL'];
const STYLES_INT: DisplayStyle[] = ['Decimal', 'Binary', 'Octal', 'Hex', 'ASCII'];
const STYLES_REAL: DisplayStyle[] = ['Float', 'Exponential'];

function useTick(controller: PlcController, intervalMs = 150): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let last = controller.tags.version;
    const h = window.setInterval(() => {
      const v = controller.tags.version;
      if (v !== last) {
        last = v;
        setTick((t) => t + 1);
      }
    }, intervalMs);
    const unsub = controller.subscribe(() => setTick((t) => t + 1));
    return () => {
      window.clearInterval(h);
      unsub();
    };
  }, [controller, intervalMs]);
  return tick;
}

function EditableText({
  value,
  onCommit,
  mono,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onCommit(v: string): void;
  mono?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing || disabled) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
        className={cn('block h-full w-full truncate text-left', !disabled && 'cursor-text hover:bg-white/[0.04]', mono && 'font-mono', !value && 'text-slate-600 italic', className)}
        title={value || placeholder}
      >
        {value || placeholder || ''}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          setEditing(false);
        }
      }}
      className={cn('h-full w-full rounded-sm border border-sky-500/70 bg-black/40 px-1 text-slate-100 outline-none', mono && 'font-mono')}
    />
  );
}

/** Text input with tag autocomplete (alias targets). */
/**
 * Tag name input with autocomplete (alias targets…). Enter keeps what was typed unless a row was picked
 * with ↑/↓ (then it is taken, or drilled into for structures); Tab completes to the first suggestion.
 */
export function TagInput({
  controller,
  program,
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
}: {
  controller: PlcController;
  program?: string;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const items = useMemo(() => (open ? suggestOperands(controller, program, undefined, value, { limit: 12 }) : []), [open, controller, program, value]);
  const pick = (it: (typeof items)[number]): void => {
    onChange(it.expandable ? `${it.operand}.` : it.operand);
    setActive(-1);
  };
  return (
    <div className={cn('relative', className)}>
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={ariaLabel ?? placeholder}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === 'Tab' && !e.shiftKey && value.trim() !== '') {
            const q = value.trim().toLowerCase();
            const c = items.find((it) => it.operand.toLowerCase().startsWith(q) && it.operand.toLowerCase() !== q);
            if (c) {
              e.preventDefault();
              pick(c);
            }
          } else if (e.key === 'Escape') setOpen(false);
        }}
        className="h-7 w-full rounded-md border border-edge bg-black/30 px-2 font-mono text-[12px] text-slate-100 outline-none placeholder:font-sans placeholder:text-slate-600 focus:border-sky-500/70"
      />
      {open && items.length > 0 && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-edge bg-panel-2 py-0.5 shadow-2xl shadow-black/50">
          {items.map((it, i) => (
            <div
              key={it.operand}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(it);
              }}
              className={cn('flex cursor-pointer items-center gap-2 px-2 py-0.5 text-[11.5px] hover:bg-white/5', i === active && 'bg-sky-500/15 hover:bg-sky-500/15')}
            >
              <span className="truncate font-mono text-slate-100">{it.operand}</span>
              {it.expandable && <span className="text-slate-500">▸</span>}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">{it.dataType}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TagMonitor({ controller, program, onTagsChanged, compact, className, initialTab = 'monitor', initialScope }: TagMonitorProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const programs = useMemo(() => controller.project.programs.map((p) => p.name).filter((p) => !program || lower(p) === lower(program)), [controller, program]);
  const [scope, setScope] = useState<string>(initialScope ?? 'controller');
  const scopeProgram = scope === 'controller' ? undefined : scope;
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [styles, setStyles] = useState<Map<string, DisplayStyle>>(() => new Map());
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const tick = useTick(controller);
  const rowH = compact ? 22 : 24;

  const reader = useMemo(() => createLiveReader(controller, scopeProgram), [controller, scopeProgram]);
  const db = controller.tags;

  // ------------------------------------------------------------------ rows
  const tags = useMemo(() => {
    void tick;
    const all = db.listAll().filter((t) => (scopeProgram ? lower(t.scope) === lower(scopeProgram) : t.scope === 'Controller'));
    const q = lower(filter.trim());
    const list = q ? all.filter((t) => lower(t.name).includes(q) || lower(t.description ?? '').includes(q) || lower(t.aliasFor ?? '').includes(q)) : all;
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    // structure changes arrive through `tick` (project events)
  }, [db, scopeProgram, filter, tick]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const push = (path: string, label: string, depth: number, type: string, dims: number | undefined, description: string | undefined, top?: TagInfo): void => {
      const t = type.toUpperCase();
      const isArray = dims !== undefined && dims > 0;
      const st = isArray ? undefined : db.getDataType(type);
      const expandable = isArray || !!st || (INT_BITS[t] !== undefined && tab === 'monitor');
      const row: Row = { key: path, path, label, depth, type, expandable, scalar: !isArray && !st };
      if (isArray) row.dims = dims;
      if (description) row.description = description;
      if (top) row.top = top;
      out.push(row);
      if (!expandable || !expanded.has(path) || tab !== 'monitor') return;
      if (isArray) {
        for (let i = 0; i < Math.min(dims!, 1000); i++) push(`${path}[${i}]`, `[${i}]`, depth + 1, type, undefined, undefined);
      } else if (st) {
        for (const m of st.members) {
          if (m.hidden) continue;
          push(`${path}.${m.name}`, `.${m.name}`, depth + 1, m.dataType, m.dims && m.dims > 0 ? m.dims : undefined, m.description);
        }
      } else {
        for (let b = 0; b < INT_BITS[t]!; b++) push(`${path}.${b}`, `.${b}`, depth + 1, 'BOOL', undefined, undefined);
      }
    };
    for (const t of tags) push(t.name, t.name, 0, t.dataType, t.dims, t.description, t);
    return out;
  }, [tags, expanded, db, tab]);

  // ------------------------------------------------------------------ virtualization
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => setViewH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scrollTop / rowH) - 6);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / rowH) + 6);
  const visible = rows.slice(first, last);

  const toggleExpand = (path: string): void =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const changed = useCallback(() => onTagsChanged?.(), [onTagsChanged]);

  // ------------------------------------------------------------------ value editing
  const writeValue = (row: Row, text: string): void => {
    const t = row.type.toUpperCase();
    try {
      if (t === 'BOOL') {
        const v = text.trim() === '1' || lower(text.trim()) === 'true';
        db.writeBool(row.path, v, scopeProgram);
      } else {
        const n = parseUserValue(text);
        if (n === undefined) {
          toast({ tone: 'error', title: `Invalid value '${text}'`, body: 'Enter a number, e.g. 42, -1.5, 16#FF or 2#1010.' });
          return;
        }
        db.writeNumber(row.path, n, scopeProgram);
      }
    } catch (e) {
      toast({ tone: 'error', title: `Cannot write ${row.path}`, body: e instanceof Error ? e.message : String(e) });
    }
  };

  /**
   * Force the physical point a row resolves to in the monitored scope. The controller's setForce /
   * removeForce resolve names in controller scope first, so a program-scoped alias that shadows a
   * controller tag must be forced by its canonical path.
   */
  const force = (row: Row, value: boolean | null): void => {
    const path = forceInfo(controller, row.path, scopeProgram).path ?? row.path;
    try {
      if (value === null) controller.removeForce(path);
      else controller.setForce(path, value);
    } catch (e) {
      toast({ tone: 'error', title: value === null ? `Cannot remove the force on ${row.path}` : `Cannot force ${row.path}`, body: e instanceof Error ? e.message : String(e) });
    }
  };

  const valueMenu = (row: Row, x: number, y: number): void => {
    const fi = forceInfo(controller, row.path, scopeProgram);
    const isBool = row.type.toUpperCase() === 'BOOL';
    const entries: MenuEntry[] = [{ heading: row.path }];
    if (isBool) entries.push({ label: 'Toggle Bit', onSelect: () => writeValue(row, reader.read(row.path) ? '0' : '1') });
    if (fi.forceable) {
      if (isBool) {
        entries.push({ label: 'Force On', icon: <Zap size={12} className="text-amber-400" />, onSelect: () => force(row, true) });
        entries.push({ label: 'Force Off', icon: <Zap size={12} className="text-amber-400" />, onSelect: () => force(row, false) });
      }
      entries.push({ label: 'Remove Force', disabled: fi.forced === undefined, onSelect: () => force(row, null) });
    }
    if (entries.length > 1) setMenu({ x, y, entries });
  };

  // ------------------------------------------------------------------ edit tab helpers
  const defOf = (name: string): TagDef | undefined => {
    const list = scopeProgram ? controller.project.programs.find((p) => lower(p.name) === lower(scopeProgram))?.tags : controller.project.tags;
    return list?.find((t) => lower(t.name) === lower(name));
  };
  const upsert = (def: TagDef): void => {
    try {
      controller.upsertTag(def, scopeProgram);
      changed();
    } catch (e) {
      toast({ tone: 'error', title: `Cannot update ${def.name}`, body: e instanceof Error ? e.message : String(e) });
    }
  };
  const typeOptions = useMemo(() => [...BASE_TYPES, ...(controller.project.dataTypes ?? []).map((d) => d.name)], [controller]);
  const aliasEdit = (def: TagDef, text: string): TagDef => withAliasTarget(def, text, (op) => db.typeOf(op, scopeProgram));

  // ------------------------------------------------------------------ new tag form
  const [nName, setNName] = useState('');
  const [nType, setNType] = useState<DataTypeName>('BOOL');
  const [nDims, setNDims] = useState('');
  const [nAlias, setNAlias] = useState('');
  const [nDesc, setNDesc] = useState('');
  const nameError = useMemo(() => {
    const n = nName.trim();
    if (!n) return null;
    if (!isValidTagName(n)) return 'Invalid name: start with a letter or _, use letters, digits and single _ (no trailing _), max 40 characters.';
    if (db.list(scopeProgram).some((t) => lower(t.name) === lower(n))) return `A tag named '${n}' already exists in this scope.`;
    return null;
  }, [nName, db, scopeProgram, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const aliasError = useMemo(() => {
    const a = nAlias.trim();
    if (!a) return null;
    if (lower(a) === lower(nName.trim())) return 'A tag cannot alias itself.';
    try {
      return db.exists(a, scopeProgram) ? null : `'${a}' does not exist.`;
    } catch {
      return `'${a}' does not exist.`;
    }
  }, [nAlias, nName, db, scopeProgram]);
  const dimsError = nDims.trim() && !/^\d+$/.test(nDims.trim()) ? 'Dimension must be a whole number.' : nDims.trim() && (Number(nDims) < 1 || Number(nDims) > 10000) ? 'Dimension must be 1–10000.' : null;
  const canCreate = nName.trim() !== '' && !nameError && !aliasError && !dimsError;

  const create = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCreate) return;
    const alias = nAlias.trim();
    const def: TagDef = {
      name: nName.trim(),
      dataType: alias ? (db.typeOf(alias, scopeProgram) ?? 'BOOL') : nType,
      ...(alias ? { aliasFor: alias } : {}),
      ...(!alias && nDims.trim() ? { dims: Number(nDims) } : {}),
      ...(nDesc.trim() ? { description: nDesc.trim() } : {}),
    };
    try {
      controller.upsertTag(def, scopeProgram);
      toast({ tone: 'success', title: `Tag ${def.name} created`, body: `${alias ? `Alias for ${alias}` : `${def.dataType}${def.dims ? `[${def.dims}]` : ''}`} · ${scopeProgram ?? 'controller scope'}` });
      setNName('');
      setNAlias('');
      setNDesc('');
      setNDims('');
      changed();
    } catch (err) {
      toast({ tone: 'error', title: 'Cannot create tag', body: err instanceof Error ? err.message : String(err) });
    }
  };

  // ------------------------------------------------------------------ render
  const cols = tab === 'monitor' ? (compact ? '1.3fr 0.8fr 0.8fr 1.4fr' : 'minmax(180px,1.3fr) 118px 84px 96px 118px minmax(140px,2fr)') : 'minmax(170px,1.2fr) minmax(150px,1fr) 118px 60px minmax(180px,2fr) 64px 40px';
  const header: ReactNode[] =
    tab === 'monitor'
      ? compact
        ? ['Name', 'Value', 'Data Type', 'Description']
        : ['Name', 'Value', 'Force Mask', 'Style', 'Data Type', 'Description']
      : ['Name', 'Alias For', 'Data Type', 'Dims', 'Description', 'Constant', ''];

  const renderMonitorRow = (row: Row): ReactNode => {
    const t = row.type.toUpperCase();
    const isBool = t === 'BOOL';
    const isReal = t === 'REAL';
    const style = styles.get(row.path) ?? (isReal ? 'Float' : 'Decimal');
    const raw = row.scalar ? reader.read(row.path) : undefined;
    const text = !row.scalar ? '{...}' : formatValue(raw, row.type, style);
    const fi = row.scalar && (row.top?.system || row.top?.aliasFor || row.depth > 0) ? forceInfo(controller, row.path, scopeProgram) : undefined;
    const typeLabel = row.dims ? `${row.type}[${row.dims}]` : row.type;
    const cells: ReactNode[] = [];
    cells.push(
      <div key="n" className="flex min-w-0 items-center gap-1" style={{ paddingLeft: row.depth * 14 }}>
        <button
          type="button"
          aria-label={expanded.has(row.path) ? 'Collapse' : 'Expand'}
          className={cn('flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-slate-500 hover:text-slate-200', !row.expandable && 'invisible')}
          onClick={() => toggleExpand(row.path)}
        >
          <ChevronRight size={12} className={cn('transition-transform', expanded.has(row.path) && 'rotate-90')} />
        </button>
        <span className={cn('truncate font-mono', row.depth === 0 ? 'text-slate-100' : 'text-slate-300')} title={row.path}>
          {row.label}
        </span>
        {row.top?.system && <Lock size={10} className="shrink-0 text-slate-600" />}
        {row.top?.aliasFor && <span className="shrink-0 rounded bg-sky-500/10 px-1 text-[9.5px] text-sky-400">alias</span>}
      </div>,
    );
    cells.push(
      <div
        key="v"
        className="min-w-0"
        onContextMenu={(e) => {
          if (!row.scalar) return;
          e.preventDefault();
          valueMenu(row, e.clientX, e.clientY);
        }}
      >
        {editingValue === row.path ? (
          <input
            autoFocus
            defaultValue={isBool ? String(raw ? 1 : 0) : text}
            onBlur={(e) => {
              writeValue(row, e.target.value);
              setEditingValue(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditingValue(null);
            }}
            className="h-[20px] w-full rounded-sm border border-sky-500/70 bg-black/40 px-1 text-right font-mono text-slate-100 outline-none"
          />
        ) : (
          <button
            type="button"
            disabled={!row.scalar}
            onClick={() => {
              if (isBool) writeValue(row, raw ? '0' : '1');
              else setEditingValue(row.path);
            }}
            title={row.scalar ? (isBool ? 'Click to toggle' : 'Click to edit') : undefined}
            className={cn(
              'block w-full truncate rounded-sm px-1 text-right font-mono tabular-nums',
              row.scalar ? 'cursor-pointer hover:bg-white/[0.06]' : 'text-slate-500',
              isBool && raw === true && 'text-emerald-400',
              isBool && raw === false && 'text-slate-400',
              !isBool && row.scalar && 'text-cyan-200',
              fi?.forced !== undefined && 'text-amber-300',
            )}
          >
            {text}
          </button>
        )}
      </div>,
    );
    if (!compact) {
      cells.push(
        <div key="f" className="truncate text-center font-mono text-[11px]">
          {fi?.forced !== undefined ? (
            <span className="rounded bg-amber-400 px-1 font-bold text-black">{typeof fi.forced === 'boolean' ? (fi.forced ? '1' : '0') : fi.forced}</span>
          ) : fi?.forceable ? (
            <span className="text-slate-600">·</span>
          ) : null}
        </div>,
      );
      cells.push(
        <div key="s" className="min-w-0">
          {row.scalar && !isBool ? (
            <select
              value={style}
              aria-label={`Display style of ${row.path}`}
              onChange={(e) =>
                setStyles((m) => {
                  const next = new Map(m);
                  next.set(row.path, e.target.value as DisplayStyle);
                  return next;
                })
              }
              className="h-[20px] w-full cursor-pointer rounded-sm border border-transparent bg-transparent text-[11px] text-slate-400 outline-none hover:border-edge focus:border-sky-500/60"
            >
              {(isReal ? STYLES_REAL : STYLES_INT).map((s) => (
                <option key={s} value={s} className="bg-panel-2">
                  {s}
                </option>
              ))}
            </select>
          ) : row.scalar ? (
            <span className="pl-1 text-[11px] text-slate-500">Decimal</span>
          ) : null}
        </div>,
      );
    }
    cells.push(
      <div key="t" className="truncate font-mono text-[11px] text-slate-400" title={typeLabel}>
        {typeLabel}
      </div>,
    );
    cells.push(
      <div key="d" className="truncate text-slate-400" title={row.description}>
        {row.description}
        {row.top?.aliasFor && <span className="ml-1 font-mono text-[10.5px] text-slate-600">→ {row.top.aliasFor}</span>}
      </div>,
    );
    return cells;
  };

  const renderEditRow = (row: Row): ReactNode => {
    const info = row.top!;
    const def = defOf(info.name);
    const locked = info.system || !def;
    const cells: ReactNode[] = [
      <div key="n" className="flex min-w-0 items-center gap-1 font-mono text-slate-100">
        <span className="truncate">{info.name}</span>
        {locked && <Lock size={10} className="shrink-0 text-slate-600" />}
      </div>,
      <div key="a" className="min-w-0">
        <EditableText value={info.aliasFor ?? ''} mono disabled={locked} placeholder={locked ? '' : '—'} onCommit={(v) => def && upsert(aliasEdit(def, v))} />
      </div>,
      <div key="t" className="min-w-0">
        {locked || info.aliasFor ? (
          <span className="truncate font-mono text-[11px] text-slate-400">{info.dataType}</span>
        ) : (
          <select
            value={def.dataType}
            aria-label={`Data type of ${info.name}`}
            onChange={(e) => upsert({ ...def, dataType: e.target.value })}
            className="h-[20px] w-full cursor-pointer rounded-sm border border-transparent bg-transparent font-mono text-[11px] text-slate-300 outline-none hover:border-edge focus:border-sky-500/60"
          >
            {[...new Set([def.dataType, ...typeOptions])].map((ty) => (
              <option key={ty} value={ty} className="bg-panel-2">
                {ty}
              </option>
            ))}
          </select>
        )}
      </div>,
      <div key="dims" className="min-w-0 text-center font-mono text-[11px] text-slate-400">
        {info.dims ?? ''}
      </div>,
      <div key="d" className="min-w-0 text-slate-300">
        <EditableText value={info.description ?? ''} disabled={locked} placeholder={locked ? '' : 'Add a description…'} onCommit={(v) => def && upsert({ ...def, description: v.trim() || undefined })} />
      </div>,
      <div key="c" className="flex justify-center">
        <input
          type="checkbox"
          aria-label={`${info.name} constant`}
          disabled={locked || !!info.aliasFor}
          checked={!!info.constant}
          onChange={(e) => def && upsert({ ...def, constant: e.target.checked || undefined })}
          className="cursor-pointer accent-sky-500 disabled:cursor-default disabled:opacity-30"
        />
      </div>,
      <div key="x" className="flex justify-center">
        {!locked &&
          (confirmDelete === info.name ? (
            <button
              type="button"
              className="cursor-pointer rounded bg-red-600 px-1.5 text-[10.5px] font-semibold text-white"
              onClick={() => {
                try {
                  controller.deleteTag(info.name, scopeProgram);
                  changed();
                } catch (e) {
                  toast({ tone: 'error', title: 'Cannot delete tag', body: e instanceof Error ? e.message : String(e) });
                }
                setConfirmDelete(null);
              }}
              onBlur={() => setConfirmDelete(null)}
              autoFocus
            >
              Delete?
            </button>
          ) : (
            <button type="button" aria-label={`Delete ${info.name}`} title="Delete tag" className="cursor-pointer text-slate-500 hover:text-red-400" onClick={() => setConfirmDelete(info.name)}>
              <Trash2 size={13} />
            </button>
          ))}
      </div>,
    ];
    return cells;
  };

  const scopeLabel = scopeProgram ?? `${controller.project.controllerName} (controller)`;

  return (
    <div className={cn('flex min-h-0 flex-col bg-panel-2 text-[12px] text-slate-300', className)} style={{ colorScheme: 'dark' }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-panel-3/60 px-2 py-1">
        <div role="tablist" className="flex gap-0.5">
          {(['monitor', 'edit'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors',
                tab === t ? 'bg-ab-red/90 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
              )}
            >
              {t === 'monitor' ? 'Monitor Tags' : 'Edit Tags'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[11px] text-slate-500">
          Scope:
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setExpanded(new Set());
            }}
            className="h-6 cursor-pointer rounded-md border border-edge bg-black/30 px-1 text-[11.5px] text-slate-200 outline-none focus:border-sky-500/60"
          >
            <option value="controller" className="bg-panel-2">
              {controller.project.controllerName}
            </option>
            {programs.map((p) => (
              <option key={p} value={p} className="bg-panel-2">
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="relative ml-auto flex items-center">
          <Search size={12} className="pointer-events-none absolute left-2 text-slate-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Enter Name Filter…"
            aria-label="Filter tags"
            className="h-6 w-44 rounded-md border border-edge bg-black/30 pr-2 pl-6 text-[11.5px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-500/60"
          />
        </label>
        <span className="font-mono text-[10.5px] text-slate-500">{tags.length} tags</span>
      </div>
      {tab === 'edit' && (
        <form onSubmit={create} className="shrink-0 border-b border-edge bg-panel/60 px-2 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-400">
              <Plus size={12} /> New tag in {scopeLabel}
            </span>
            <input
              value={nName}
              onChange={(e) => setNName(e.target.value)}
              placeholder="Name"
              aria-label="New tag name"
              aria-invalid={!!nameError}
              spellCheck={false}
              className={cn('h-7 w-40 rounded-md border bg-black/30 px-2 font-mono text-[12px] text-slate-100 outline-none placeholder:font-sans placeholder:text-slate-600', nameError ? 'border-red-500/70' : 'border-edge focus:border-sky-500/70')}
            />
            <select
              value={nType}
              onChange={(e) => setNType(e.target.value)}
              disabled={nAlias.trim() !== ''}
              aria-label="New tag data type"
              className="h-7 cursor-pointer rounded-md border border-edge bg-black/30 px-1 font-mono text-[12px] text-slate-100 outline-none disabled:opacity-40"
            >
              {typeOptions.map((t) => (
                <option key={t} value={t} className="bg-panel-2">
                  {t}
                </option>
              ))}
            </select>
            <input
              value={nDims}
              onChange={(e) => setNDims(e.target.value)}
              placeholder="Dim"
              aria-label="Array dimension"
              disabled={nAlias.trim() !== ''}
              className={cn('h-7 w-14 rounded-md border bg-black/30 px-2 font-mono text-[12px] text-slate-100 outline-none placeholder:font-sans placeholder:text-slate-600 disabled:opacity-40', dimsError ? 'border-red-500/70' : 'border-edge')}
            />
            <TagInput controller={controller} {...(scopeProgram ? { program: scopeProgram } : {})} value={nAlias} onChange={setNAlias} placeholder="Alias for (optional)" className="w-48" />
            <input
              value={nDesc}
              onChange={(e) => setNDesc(e.target.value)}
              placeholder="Description"
              aria-label="Description"
              className="h-7 min-w-40 flex-1 rounded-md border border-edge bg-black/30 px-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/70"
            />
            <button
              type="submit"
              disabled={!canCreate}
              className="h-7 cursor-pointer rounded-md bg-ab-red px-3 text-[12px] font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create
            </button>
          </div>
          {(nameError || aliasError || dimsError) && <div className="mt-1 text-[11px] text-red-400">{nameError ?? aliasError ?? dimsError}</div>}
        </form>
      )}
      <div className="grid shrink-0 border-b border-edge bg-panel-3/40 px-2 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase" style={{ gridTemplateColumns: cols, height: rowH }}>
        {header.map((h, i) => (
          <div key={i} className={cn('flex items-center truncate px-1', tab === 'monitor' && i === 1 && 'justify-end')}>
            {h}
          </div>
        ))}
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * rowH, position: 'relative' }}>
          {visible.map((row, k) => (
            <div
              key={row.key}
              className={cn('absolute right-0 left-0 grid items-center border-b border-edge/40 px-2 hover:bg-white/[0.025]', (first + k) % 2 === 1 && 'bg-white/[0.012]')}
              style={{ top: (first + k) * rowH, height: rowH, gridTemplateColumns: cols }}
            >
              {(tab === 'monitor' ? renderMonitorRow(row) : renderEditRow(row)) as ReactNode[]}
            </div>
          ))}
        </div>
        {rows.length === 0 && <div className="p-4 text-center text-[12px] text-slate-500">{filter ? `No tag matches “${filter}”.` : 'No tags in this scope yet.'}</div>}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} themeClass="ld-theme-dark" onClose={() => setMenu(null)} />}
    </div>
  );
}
