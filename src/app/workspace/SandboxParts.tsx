/**
 * Sandbox building blocks: scene picker cards, save-slot manager, import / share dialogs and the
 * live plant monitor (observables + fault injection).
 */
import {
  Activity,
  ArrowRight,
  Box,
  Car,
  ClipboardPaste,
  Cog,
  Copy,
  Cpu,
  FileUp,
  FlaskConical,
  FolderOpen,
  Link2,
  Package,
  Pencil,
  Siren,
  ToggleLeft,
  Trash2,
  TrafficCone,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { SCENE_IDS, SCENE_LOGICS } from '../../sim/scenes';
import { SCENES } from '../../sim/scenes/views';
import type { ControlDef, SceneLogic, SimRuntime } from '../../sim/types';
import { Badge, Button, Modal, cn, toast } from '../../ui';
import { routes } from '../routes';
import { FaultList } from './ControlPad';
import { observeCached, useRuntimeValue } from './hooks';
import { importProgramText, type ProgramDocument } from './programText';
import { deleteSlot, getSlot, listSlots, loadWorkingCopy, renameSlot, type SandboxSlot } from './slots';

const SCENE_ICONS: Record<string, ReactNode> = {
  trainer: <ToggleLeft size={22} />,
  'motor-station': <Cog size={22} />,
  'traffic-light': <TrafficCone size={22} />,
  'conveyor-sort': <Package size={22} />,
  'tank-process': <FlaskConical size={22} />,
  'parking-garage': <Car size={22} />,
};

const FALLBACK_ACCENTS: Record<string, string> = {
  trainer: '#22c55e',
  'motor-station': '#f5c400',
  'traffic-light': '#38bdf8',
  'conveyor-sort': '#a78bfa',
  'tank-process': '#f97316',
  'parking-garage': '#14b8a6',
};

export function sceneAccent(id: string): string {
  return SCENES[id]?.accent ?? FALLBACK_ACCENTS[id] ?? '#94a3b8';
}

export function sceneIcon(id: string, size = 22): ReactNode {
  const el = SCENE_ICONS[id];
  if (!el) return <Box size={size} />;
  return el;
}

function SceneCard({ scene, slots }: { scene: SceneLogic<unknown>; slots: number }) {
  const accent = sceneAccent(scene.id);
  const has3d = !!SCENES[scene.id];
  const inputs = scene.io.filter((p) => p.dir === 'input').length;
  const outputs = scene.io.length - inputs;
  const faults = scene.controls.filter((c) => c.type === 'fault').length;
  const wip = useMemo(() => loadWorkingCopy(scene.id), [scene.id]);
  const cpu = scene.hardware.modules.find((m) => /^(1756-L|5069-L)/.test(m.catalog));
  return (
    <Link
      href={routes.sandbox(scene.id)}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-edge bg-panel-2 transition-all hover:-translate-y-0.5 hover:border-white/20 hover:shadow-2xl"
      data-testid={`scene-card-${scene.id}`}
      style={{ boxShadow: `inset 0 1px 0 ${accent}33` }}
    >
      <div className="relative h-28 overflow-hidden" style={{ background: `radial-gradient(ellipse at 20% 0%, ${accent}55 0%, transparent 60%), linear-gradient(135deg, #1c242d 0%, #0f1419 100%)` }}>
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        <span className="absolute top-4 left-4 flex h-12 w-12 items-center justify-center rounded-xl text-black shadow-lg" style={{ background: accent }}>
          {sceneIcon(scene.id)}
        </span>
        <div className="absolute top-3 right-3 flex gap-1">
          {has3d ? <Badge tone="green">3D twin</Badge> : <Badge tone="neutral">3D soon</Badge>}
        </div>
        <div className="absolute right-4 bottom-3 font-mono text-[11px] text-slate-400">{cpu?.catalog}</div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-white">{scene.title}</h3>
          <ArrowRight size={16} className="shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
        </div>
        <p className="line-clamp-3 text-[12.5px] leading-relaxed text-slate-400">{scene.summary}</p>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <Badge tone="neutral">
            <Cpu size={11} /> {scene.hardware.platform === 'ControlLogix' ? 'ControlLogix' : 'CompactLogix 5380'}
          </Badge>
          <Badge tone="blue">
            {inputs} in · {outputs} out
          </Badge>
          {faults > 0 && (
            <Badge tone="amber">
              <Siren size={11} /> {faults} fault{faults === 1 ? '' : 's'}
            </Badge>
          )}
          {slots > 0 && <Badge tone="violet">{slots} saved</Badge>}
          {wip && <Badge tone="green">work in progress</Badge>}
        </div>
      </div>
    </Link>
  );
}

export function ScenePicker({ onOpenSlots }: { onOpenSlots(): void }) {
  const slots = useMemo(() => listSlots(), []);
  return (
    <div className="h-full overflow-y-auto" data-testid="scene-picker">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.2em] text-sky-300 uppercase">Sandbox</div>
            <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Pick a plant and program anything</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              No tests, no rules: every control and fault injection is available. Your work is kept per plant; save programs to slots, export them as neutral text or share a link.
            </p>
          </div>
          <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={onOpenSlots} disabled={slots.length === 0}>
            Saved programs ({slots.length})
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCENE_IDS.map((id) => {
            const s = SCENE_LOGICS[id];
            return s ? <SceneCard key={id} scene={s} slots={slots.filter((x) => x.sceneId === id).length} /> : null;
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save slots
// ---------------------------------------------------------------------------

function fmtDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function SlotsModal({
  open,
  onClose,
  currentScene,
  currentSlotId,
  onLoad,
  onSaveAs,
  onRenamed,
  onDeleted,
}: {
  open: boolean;
  onClose(): void;
  currentScene?: string;
  currentSlotId?: string;
  onLoad(slot: SandboxSlot): void;
  /** Save the current program as a new slot (only inside a workspace). */
  onSaveAs?(name: string): void;
  /** A slot was renamed (the workspace keeps the open slot's name in sync). */
  onRenamed?(id: string, name: string): void;
  onDeleted?(id: string): void;
}) {
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const slots = useMemo(() => {
    void version;
    const all = open ? listSlots() : [];
    return currentScene ? [...all.filter((s) => s.sceneId === currentScene), ...all.filter((s) => s.sceneId !== currentScene)] : all;
  }, [open, version, currentScene]);
  return (
    <Modal open={open} onClose={onClose} title="Saved programs" size="lg">
      <div className="space-y-3" data-testid="slots-modal">
        {onSaveAs && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              onSaveAs(newName.trim());
              setNewName('');
              setVersion((v) => v + 1);
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Save current program as…"
              className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-panel px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
              aria-label="New slot name"
              maxLength={80}
            />
            <Button type="submit" size="sm" variant="primary" disabled={!newName.trim()}>
              Save as new
            </Button>
          </form>
        )}
        {slots.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No saved programs yet.</p>}
        <ul className="divide-y divide-edge overflow-hidden rounded-xl border border-edge">
          {slots.map((s) => {
            const scene = SCENE_LOGICS[s.sceneId];
            return (
              <li key={s.id} className={cn('flex items-center gap-3 bg-panel px-3 py-2', s.id === currentSlotId && 'bg-sky-500/[0.07]')} data-slot={s.name}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-black" style={{ background: sceneAccent(s.sceneId) }}>
                  {sceneIcon(s.sceneId, 16)}
                </span>
                <div className="min-w-0 flex-1">
                  {editing === s.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (renameSlot(s.id, text)) {
                          const stored = getSlot(s.id);
                          if (stored) onRenamed?.(s.id, stored.name);
                        }
                        setEditing(null);
                        setVersion((v) => v + 1);
                      }}
                    >
                      <input
                        autoFocus
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onBlur={() => setEditing(null)}
                        className="h-7 w-full rounded border border-sky-500 bg-panel-2 px-2 text-sm text-white outline-none"
                        aria-label="Slot name"
                        maxLength={80}
                      />
                    </form>
                  ) : (
                    <div className="truncate text-sm font-semibold text-slate-100">
                      {s.name} {s.id === currentSlotId && <span className="text-[11px] font-normal text-sky-300">(open)</span>}
                    </div>
                  )}
                  <div className="truncate text-[11px] text-slate-500">
                    {scene?.title ?? s.sceneId} · {s.rungs.length} rung{s.rungs.length === 1 ? '' : 's'} · {fmtDate(s.updatedAt)}
                  </div>
                </div>
                {confirmDelete === s.id ? (
                  <>
                    <span className="text-[12px] text-red-300">Delete?</span>
                    <Button
                      size="xs"
                      variant="danger"
                      onClick={() => {
                        if (deleteSlot(s.id)) onDeleted?.(s.id);
                        setConfirmDelete(null);
                        setVersion((v) => v + 1);
                      }}
                    >
                      Delete
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="xs" variant="primary" onClick={() => onLoad(s)}>
                      Load
                    </Button>
                    <button
                      type="button"
                      className="cursor-pointer rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white"
                      title="Rename"
                      aria-label={`Rename ${s.name}`}
                      onClick={() => {
                        setEditing(s.id);
                        setText(s.name);
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer rounded p-1 text-slate-400 hover:bg-red-500/10 hover:text-red-300"
                      title="Delete"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => setConfirmDelete(s.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Import / share
// ---------------------------------------------------------------------------

export function ImportModal({ open, onClose, onImport }: { open: boolean; onClose(): void; onImport(doc: ProgramDocument): void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tryImport = (src: string): void => {
    try {
      const doc = importProgramText(src);
      setError(null);
      setText('');
      onImport(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title="Import a program"
      size="lg"
      footer={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.l5k,.nt,text/plain"
            className="hidden"
            data-testid="import-file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > 2_000_000) {
                setError('That file is too large for a ladder program.');
                return;
              }
              tryImport(await f.text());
            }}
          />
          <Button variant="secondary" size="sm" icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
            Open .txt file…
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" icon={<ClipboardPaste size={14} />} disabled={!text.trim()} onClick={() => tryImport(text)} data-testid="import-paste">
            Import pasted text
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <p className="text-[13px] text-slate-400">
          Paste an exported program or plain neutral-text rungs (one per line, ending in <code className="font-mono text-emerald-300">;</code>). It replaces the current program.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={'N: XIC(Start_PB)[XIC(Motor_Starter),]XIC(Stop_PB)OTE(Motor_Starter);\nN: XIC(Motor_Aux)OTE(Run_Light);'}
          className="h-56 w-full resize-y rounded-lg border border-edge bg-black/40 p-3 font-mono text-[12px] text-emerald-200 outline-none focus:border-sky-500"
          aria-label="Program text"
        />
        {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-200">{error}</div>}
      </div>
    </Modal>
  );
}

export function ShareModal({ open, url, onClose }: { open: boolean; url: string | null; onClose(): void }) {
  return (
    <Modal open={open} onClose={onClose} title="Share this program" size="md">
      <div className="space-y-3">
        <p className="text-[13px] text-slate-400">Anyone opening this link gets a copy of your program on the same plant (the program travels compressed inside the link — nothing is uploaded).</p>
        <div className="flex gap-2">
          <input readOnly value={url ?? 'Encoding…'} onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-panel px-3 font-mono text-[11.5px] text-slate-200" aria-label="Share link" data-testid="share-url" />
          <Button
            size="sm"
            variant="primary"
            icon={<Copy size={14} />}
            disabled={!url}
            onClick={() => {
              if (!url) return;
              navigator.clipboard?.writeText(url).then(
                () => toast({ tone: 'success', title: 'Link copied' }),
                () => toast({ tone: 'warning', title: 'Copy failed', body: 'Select the link and copy it manually.' }),
              );
            }}
          >
            Copy
          </Button>
        </div>
        {url && url.length > 8000 && <p className="text-[11.5px] text-amber-300">This link is long — some chat apps may cut it. Export a .txt file instead.</p>}
        <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
          <Link2 size={12} /> {url ? `${url.length.toLocaleString()} characters` : ''}
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Plant monitor
// ---------------------------------------------------------------------------

function ObservableRow({ runtime, id, label, units, type }: { runtime: SimRuntime; id: string; label: string; units?: string | undefined; type: 'boolean' | 'number' }) {
  const v = useRuntimeValue(runtime, () => {
    const x = observeCached(runtime)[id];
    if (x === undefined) return '—';
    if (typeof x === 'boolean') return x ? '1' : '0';
    if (Number.isInteger(x)) return String(x);
    return Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
  });
  const isBool = type === 'boolean';
  return (
    <li className="flex items-center justify-between gap-2 px-2 py-1 text-[12px] odd:bg-white/[0.02]" data-observable={id}>
      <span className="min-w-0 truncate text-slate-300" title={id}>
        {label}
      </span>
      {isBool ? (
        <span className={cn('rounded px-1.5 font-mono text-[11px] font-bold', v === '1' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500')}>{v === '1' ? 'ON' : 'OFF'}</span>
      ) : (
        <span className="font-mono text-[11.5px] text-sky-200">
          {v}
          {units ? <span className="text-slate-500"> {units}</span> : null}
        </span>
      )}
    </li>
  );
}

export function PlantMonitor({ scene, runtime, faults }: { scene: SceneLogic<unknown>; runtime: SimRuntime; faults: ReadonlyArray<ControlDef> }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid="plant-monitor">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <Activity size={15} className="text-emerald-300" />
        <div className="text-[13px] font-semibold text-slate-100">Plant monitor</div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">What the machine does</div>
          <ul className="overflow-hidden rounded-lg border border-edge">
            {scene.observables.map((o) => (
              <ObservableRow key={o.id} runtime={runtime} id={o.id} label={o.label} units={o.units} type={o.type} />
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-amber-300/80 uppercase">
            <Siren size={12} /> Fault injection
          </div>
          <FaultList runtime={runtime} controls={faults} />
        </div>
      </div>
    </div>
  );
}
