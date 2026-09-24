/**
 * The Studio 5000 Controller Organizer: Controller <name> (Controller Tags, Controller Fault Handler,
 * Power-Up Handler), Tasks › MainTask › MainProgram (Parameters and Local Tags, routines), Motion
 * Groups, Alarm Manager, Assets (Add-On Instructions, Data Types, Trends, Logical Model) and
 * I/O Configuration (backplane with slot-numbered modules, Ethernet).
 */
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MODULE_CATALOG } from '@/plc/catalog';
import type { Project } from '@/plc/types';
import { cn } from '@/ui/cn';
import {
  BackplaneIcon,
  ControllerIcon,
  DataTypeIcon,
  FolderIcon,
  GenericIcon,
  HandlerIcon,
  ModuleIcon,
  NetworkIcon,
  ProgramIcon,
  RoutineIcon,
  TagsIcon,
  TaskIcon,
} from './glyphs';

export type OrganizerKind =
  | 'controller'
  | 'controllerTags'
  | 'faultHandler'
  | 'powerUpHandler'
  | 'tasks'
  | 'task'
  | 'program'
  | 'programTags'
  | 'routine'
  | 'unscheduled'
  | 'motionGroups'
  | 'ungroupedAxes'
  | 'alarmManager'
  | 'assets'
  | 'aoi'
  | 'dataTypes'
  | 'dataTypeFolder'
  | 'dataType'
  | 'trends'
  | 'logicalModel'
  | 'ioConfig'
  | 'backplane'
  | 'module'
  | 'ethernet';

export interface OrganizerNode {
  id: string;
  kind: OrganizerKind;
  label: string;
  task?: string;
  program?: string;
  routine?: string;
  slot?: number;
  catalog?: string;
  dataType?: string;
  /** Main routine of its program. */
  main?: boolean;
  children?: OrganizerNode[];
}

/** What is selected: matched by kind + program/routine/slot/dataType. */
export type OrganizerSelection = Partial<Pick<OrganizerNode, 'kind' | 'program' | 'routine' | 'slot' | 'dataType' | 'task' | 'id'>>;

export interface ControllerOrganizerProps {
  project: Project;
  selected?: OrganizerSelection | null;
  onSelect(node: OrganizerNode): void;
  className?: string;
  /** Rung counts with verification errors per `program/routine` (shows a red marker). */
  errorRoutines?: ReadonlySet<string>;
}

const lower = (s: string): string => s.toLowerCase();
const PREDEFINED = ['BOOL', 'SINT', 'INT', 'DINT', 'REAL', 'TIMER', 'COUNTER', 'CONTROL'];

/** Build the organizer tree for a project. */
export function buildOrganizerTree(project: Project): OrganizerNode[] {
  const scheduled = new Set(project.tasks.flatMap((t) => t.programs.map(lower)));
  const programNode = (name: string, task?: string): OrganizerNode => {
    const p = project.programs.find((x) => lower(x.name) === lower(name));
    const routines = p ? [...p.routines].sort((a, b) => (a.name === p.mainRoutine ? -1 : b.name === p.mainRoutine ? 1 : a.name.localeCompare(b.name))) : [];
    return {
      id: `prog:${name}`,
      kind: 'program',
      label: p?.name ?? name,
      program: p?.name ?? name,
      ...(task ? { task } : {}),
      children: [
        { id: `ptags:${name}`, kind: 'programTags', label: 'Parameters and Local Tags', program: p?.name ?? name },
        ...routines.map(
          (r): OrganizerNode => ({
            id: `rtn:${name}/${r.name}`,
            kind: 'routine',
            label: r.name,
            program: p?.name ?? name,
            routine: r.name,
            main: lower(r.name) === lower(p?.mainRoutine ?? ''),
          }),
        ),
      ],
    };
  };
  const hw = project.hardware;
  const mods = [...hw.modules].sort((a, b) => a.slot - b.slot);
  const cpu = mods.find((m) => MODULE_CATALOG[m.catalog]?.kind === 'CPU');
  const moduleNode = (m: (typeof mods)[number]): OrganizerNode => {
    const info = MODULE_CATALOG[m.catalog];
    const isCpu = info?.kind === 'CPU';
    const name = isCpu ? project.controllerName : m.name ?? '';
    return {
      id: `mod:${m.slot}`,
      kind: 'module',
      label: `[${m.slot}] ${m.catalog}${name ? ` ${name}` : ''}`,
      slot: m.slot,
      catalog: m.catalog,
      ...(info?.kind === 'COMM' ? { children: [{ id: `eth:${m.slot}`, kind: 'ethernet' as const, label: 'Ethernet', slot: m.slot }] } : {}),
    };
  };
  const io: OrganizerNode[] =
    hw.platform === 'ControlLogix'
      ? [
          { id: 'backplane', kind: 'backplane', label: `1756 Backplane, ${hw.chassis ?? '1756-A7'}`, children: mods.map(moduleNode) },
          { id: 'eth:cpu', kind: 'ethernet', label: 'Ethernet', ...(cpu ? { slot: cpu.slot } : {}) },
        ]
      : [
          {
            ...moduleNode(cpu ?? { slot: 0, catalog: '5069-L320ER' }),
            children: [
              { id: 'eth:a1', kind: 'ethernet', label: 'A1/A2, Ethernet', slot: 0 },
              { id: 'bus', kind: 'backplane', label: '5069 Local Bus', children: mods.filter((m) => m !== cpu).map(moduleNode) },
            ],
          },
        ];
  const moduleTypes = [...new Set(mods.flatMap((m) => [MODULE_CATALOG[m.catalog]?.inputType, MODULE_CATALOG[m.catalog]?.outputType].filter((t): t is string => !!t)))];
  const unscheduled = project.programs.filter((p) => !scheduled.has(lower(p.name)));
  return [
    {
      id: 'controller',
      kind: 'controller',
      label: `Controller ${project.controllerName}`,
      children: [
        { id: 'ctags', kind: 'controllerTags', label: 'Controller Tags' },
        { id: 'fault', kind: 'faultHandler', label: 'Controller Fault Handler' },
        { id: 'powerup', kind: 'powerUpHandler', label: 'Power-Up Handler' },
      ],
    },
    {
      id: 'tasks',
      kind: 'tasks',
      label: 'Tasks',
      children: [
        ...project.tasks.map(
          (t): OrganizerNode => ({
            id: `task:${t.name}`,
            kind: 'task',
            label: t.name,
            task: t.name,
            children: t.programs.map((p) => programNode(p, t.name)),
          }),
        ),
        ...(unscheduled.length > 0 ? [{ id: 'unsched', kind: 'unscheduled' as const, label: 'Unscheduled', children: unscheduled.map((p) => programNode(p.name)) }] : []),
      ],
    },
    { id: 'motion', kind: 'motionGroups', label: 'Motion Groups', children: [{ id: 'axes', kind: 'ungroupedAxes', label: 'Ungrouped Axes' }] },
    { id: 'alarms', kind: 'alarmManager', label: 'Alarm Manager' },
    {
      id: 'assets',
      kind: 'assets',
      label: 'Assets',
      children: [
        { id: 'aoi', kind: 'aoi', label: 'Add-On Instructions' },
        {
          id: 'dt',
          kind: 'dataTypes',
          label: 'Data Types',
          children: [
            { id: 'dt:udt', kind: 'dataTypeFolder', label: 'User-Defined', children: (project.dataTypes ?? []).map((d) => ({ id: `dt:u:${d.name}`, kind: 'dataType' as const, label: d.name, dataType: d.name })) },
            { id: 'dt:str', kind: 'dataTypeFolder', label: 'Strings', children: [] },
            { id: 'dt:aoi', kind: 'dataTypeFolder', label: 'Add-On-Defined', children: [] },
            { id: 'dt:pre', kind: 'dataTypeFolder', label: 'Predefined', children: PREDEFINED.map((d) => ({ id: `dt:p:${d}`, kind: 'dataType' as const, label: d, dataType: d })) },
            { id: 'dt:mod', kind: 'dataTypeFolder', label: 'Module-Defined', children: moduleTypes.map((d) => ({ id: `dt:m:${d}`, kind: 'dataType' as const, label: d, dataType: d })) },
          ],
        },
        { id: 'trends', kind: 'trends', label: 'Trends' },
        { id: 'logical', kind: 'logicalModel', label: 'Logical Model' },
      ],
    },
    { id: 'io', kind: 'ioConfig', label: 'I/O Configuration', children: io },
  ];
}

function iconFor(n: OrganizerNode, open: boolean): ReactNode {
  switch (n.kind) {
    case 'controller':
      return <ControllerIcon />;
    case 'controllerTags':
    case 'programTags':
      return <TagsIcon />;
    case 'faultHandler':
    case 'powerUpHandler':
      return <HandlerIcon />;
    case 'task':
      return <TaskIcon />;
    case 'program':
      return <ProgramIcon />;
    case 'routine':
      return <RoutineIcon main={n.main === true} />;
    case 'dataType':
      return <DataTypeIcon />;
    case 'module':
      return <ModuleIcon kind={MODULE_CATALOG[n.catalog as keyof typeof MODULE_CATALOG]?.kind ?? 'DI'} />;
    case 'backplane':
      return <BackplaneIcon />;
    case 'ethernet':
      return <NetworkIcon />;
    case 'alarmManager':
    case 'logicalModel':
    case 'aoi':
      return <GenericIcon color={n.kind === 'alarmManager' ? '#ef4444' : '#64748b'} />;
    default:
      return <FolderIcon open={open} />;
  }
}

function matches(n: OrganizerNode, sel: OrganizerSelection | null | undefined): boolean {
  if (!sel) return false;
  if (sel.id !== undefined) return sel.id === n.id;
  if (sel.kind !== n.kind) return false;
  if (sel.program !== undefined && lower(sel.program) !== lower(n.program ?? '')) return false;
  if (sel.routine !== undefined && lower(sel.routine) !== lower(n.routine ?? '')) return false;
  if (sel.slot !== undefined && sel.slot !== n.slot) return false;
  if (sel.dataType !== undefined && sel.dataType !== n.dataType) return false;
  if (sel.task !== undefined && sel.task !== n.task) return false;
  return true;
}

const DEFAULT_COLLAPSED = new Set(['motion', 'dt', 'dt:udt', 'dt:str', 'dt:aoi', 'dt:pre', 'dt:mod']);

export function ControllerOrganizer({ project, selected, onSelect, className, errorRoutines }: ControllerOrganizerProps) {
  const tree = useMemo(() => buildOrganizerTree(project), [project]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(DEFAULT_COLLAPSED));
  const [focusId, setFocusId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const flat = useMemo(() => {
    const out: Array<{ n: OrganizerNode; depth: number; parent?: string }> = [];
    const walk = (nodes: OrganizerNode[], depth: number, parent?: string): void => {
      for (const n of nodes) {
        out.push(parent ? { n, depth, parent } : { n, depth });
        if (n.children && n.children.length > 0 && !collapsed.has(n.id)) walk(n.children, depth + 1, n.id);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, collapsed]);

  const selectedId = flat.find((f) => matches(f.n, selected))?.n.id;
  const current = focusId ?? selectedId ?? flat[0]?.n.id;

  useEffect(() => {
    if (!focusId) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusId]);

  const toggle = useCallback((id: string) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const i = flat.findIndex((f) => f.n.id === current);
    if (i < 0) return;
    const f = flat[i]!;
    const hasKids = !!f.n.children && f.n.children.length > 0;
    if (e.key === 'ArrowDown') setFocusId(flat[Math.min(flat.length - 1, i + 1)]!.n.id);
    else if (e.key === 'ArrowUp') setFocusId(flat[Math.max(0, i - 1)]!.n.id);
    else if (e.key === 'ArrowRight') {
      if (hasKids && collapsed.has(f.n.id)) toggle(f.n.id);
      else if (hasKids) setFocusId(f.n.children![0]!.id);
    } else if (e.key === 'ArrowLeft') {
      if (hasKids && !collapsed.has(f.n.id)) toggle(f.n.id);
      else if (f.parent) setFocusId(f.parent);
    } else if (e.key === 'Enter' || e.key === ' ') onSelect(f.n);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={rootRef}
      role="tree"
      aria-label="Controller Organizer"
      tabIndex={0}
      onKeyDown={onKey}
      className={cn('min-h-0 overflow-auto py-1 text-[12.5px] text-slate-300 outline-none select-none focus-visible:ring-1 focus-visible:ring-sky-500/50', className)}
    >
      {flat.map(({ n, depth }) => {
        const hasKids = !!n.children && n.children.length > 0;
        const open = hasKids && !collapsed.has(n.id);
        const isSel = n.id === selectedId;
        const isFocus = n.id === current && focusId !== null;
        const err = n.kind === 'routine' && errorRoutines?.has(`${n.program}/${n.routine}`);
        return (
          <div
            key={n.id}
            role="treeitem"
            aria-expanded={hasKids ? open : undefined}
            aria-selected={isSel}
            aria-level={depth + 1}
            data-node={n.id}
            onClick={() => {
              setFocusId(n.id);
              onSelect(n);
            }}
            onDoubleClick={() => hasKids && toggle(n.id)}
            className={cn(
              'group flex h-[22px] cursor-pointer items-center gap-1 pr-2 whitespace-nowrap',
              isSel ? 'bg-sky-500/20 text-white' : 'hover:bg-white/[0.04]',
              isFocus && !isSel && 'outline outline-1 -outline-offset-1 outline-sky-500/40',
            )}
            style={{ paddingLeft: 4 + depth * 14 }}
            title={n.kind === 'module' && n.catalog ? MODULE_CATALOG[n.catalog as keyof typeof MODULE_CATALOG]?.description : undefined}
          >
            <span
              className={cn('flex h-4 w-4 shrink-0 items-center justify-center text-slate-500', hasKids ? 'hover:text-slate-200' : 'invisible')}
              onClick={(e) => {
                e.stopPropagation();
                if (hasKids) toggle(n.id);
              }}
            >
              <ChevronRight size={12} className={cn('transition-transform duration-150', open && 'rotate-90')} />
            </span>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">{iconFor(n, open)}</span>
            <span className={cn('truncate', n.kind === 'controller' && 'font-semibold', (n.kind === 'dataTypeFolder' || n.kind === 'aoi') && !hasKids && 'text-slate-500')}>{n.label}</span>
            {err && <span className="ml-1 rounded bg-red-600 px-1 text-[9.5px] font-bold text-white">e</span>}
          </div>
        );
      })}
    </div>
  );
}
