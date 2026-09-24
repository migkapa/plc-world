/**
 * Studio 5000 "New Tag" dialog, opened from the ladder for an undefined operand (right-click ▸ New Tag…,
 * Ctrl/Alt+W, or the "New tag" row of the operand autocomplete). Name and data type are pre-filled
 * from the operand and the instruction (BOOL for XIC/OTE, TIMER for TON, COUNTER for CTU…).
 */
import { Tag } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { isValidTagName } from '@/plc/tags';
import type { PlcController, TagDef } from '@/plc/types';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { TagInput } from './TagMonitor';

const BASE_TYPES = ['BOOL', 'SINT', 'INT', 'DINT', 'REAL', 'TIMER', 'COUNTER', 'CONTROL'];
const lower = (s: string): string => s.toLowerCase();

export interface NewTagRequest {
  name: string;
  dataType: string;
  dims?: number;
  /** Where the operand is used, e.g. "XIC on rung 3" (shown as context). */
  usedBy?: string;
}

export interface NewTagDialogProps {
  controller: PlcController;
  /** Program of the routine being edited (offered as the program scope). */
  program: string;
  request: NewTagRequest | null;
  onClose(): void;
  /** Called after the tag was created (`program` undefined = controller scope). */
  onCreated?(def: TagDef, program: string | undefined): void;
}

export function NewTagDialog({ controller, program, request, onClose, onCreated }: NewTagDialogProps) {
  return (
    <Modal
      open={request !== null}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <Tag size={17} className="text-sky-400" /> New Tag
        </span>
      }
    >
      {request && <NewTagForm key={`${request.name}:${request.dataType}`} controller={controller} program={program} request={request} onClose={onClose} {...(onCreated ? { onCreated } : {})} />}
    </Modal>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[96px_1fr] items-start gap-x-3 gap-y-1">
      <span className="pt-1.5 text-[12px] font-medium text-slate-400">{label}</span>
      <span className="min-w-0">
        {children}
        {hint && <span className="mt-1 block text-[11px] leading-snug">{hint}</span>}
      </span>
    </label>
  );
}

const INPUT = 'h-8 w-full rounded-md border bg-black/30 px-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500/70';

function NewTagForm({ controller, program, request, onClose, onCreated }: { controller: PlcController; program: string; request: NewTagRequest; onClose(): void; onCreated?: NewTagDialogProps['onCreated'] }) {
  const db = controller.tags;
  const [name, setName] = useState(request.name);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'base' | 'alias'>('base');
  const [dataType, setDataType] = useState(request.dataType);
  const [dims, setDims] = useState(request.dims ? String(request.dims) : '');
  const [alias, setAlias] = useState('');
  const [scope, setScope] = useState<'controller' | 'program'>('controller');
  const scopeProgram = scope === 'program' ? program : undefined;
  const typeOptions = useMemo(
    () => [...new Set([request.dataType, ...BASE_TYPES, ...(controller.project.dataTypes ?? []).map((d) => String(d.name))])],
    [controller, request.dataType],
  );

  const nameError = useMemo(() => {
    const n = name.trim();
    if (!n) return 'Enter a tag name.';
    if (!isValidTagName(n)) return 'Invalid name: start with a letter or _, use letters, digits and single _ (no trailing _), max 40 characters.';
    if (db.list(scopeProgram).some((t) => lower(t.name) === lower(n))) return `A tag named '${n}' already exists in this scope.`;
    return null;
  }, [name, db, scopeProgram]);
  const aliasType = useMemo(() => {
    const a = alias.trim();
    if (kind !== 'alias' || !a) return undefined;
    try {
      return db.exists(a, scopeProgram) ? db.typeOf(a, scopeProgram) : undefined;
    } catch {
      return undefined;
    }
  }, [alias, kind, db, scopeProgram]);
  const aliasError =
    kind !== 'alias' ? null : !alias.trim() ? 'Enter the tag or I/O point this alias points to.' : lower(alias.trim()) === lower(name.trim()) ? 'A tag cannot alias itself.' : aliasType ? null : `'${alias.trim()}' does not exist.`;
  const dimsError = kind === 'base' && dims.trim() && (!/^\d+$/.test(dims.trim()) || Number(dims) < 1 || Number(dims) > 10000) ? 'Array size must be a whole number from 1 to 10000.' : null;
  const error = nameError ?? aliasError ?? dimsError;

  const submit = (e?: FormEvent): void => {
    e?.preventDefault();
    if (error) return;
    const def: TagDef = {
      name: name.trim(),
      dataType: kind === 'alias' ? (aliasType ?? 'BOOL') : dataType,
      ...(kind === 'alias' ? { aliasFor: alias.trim() } : {}),
      ...(kind === 'base' && dims.trim() ? { dims: Number(dims) } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    try {
      controller.upsertTag(def, scopeProgram);
    } catch (err) {
      toast({ tone: 'error', title: 'Cannot create tag', body: err instanceof Error ? err.message : String(err) });
      return;
    }
    toast({
      tone: 'success',
      title: `Tag ${def.name} created`,
      body: `${def.aliasFor ? `Alias for ${def.aliasFor}` : `${def.dataType}${def.dims ? `[${def.dims}]` : ''}`} · ${scopeProgram ? `${scopeProgram} (program)` : 'controller'} scope`,
    });
    onCreated?.(def, scopeProgram);
    onClose();
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="New tag">
      {request.usedBy && (
        <div className="rounded-md border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[12px] text-slate-300">
          <span className="font-mono font-semibold text-sky-300">{request.name}</span> is used by {request.usedBy} but is not defined yet.
        </div>
      )}
      <Field label="Name" hint={nameError && name.trim() ? <span className="text-red-400">{nameError}</span> : undefined}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          autoFocus
          aria-label="Tag name"
          aria-invalid={!!nameError}
          className={cn(INPUT, 'font-mono font-semibold', nameError && name.trim() ? 'border-red-500/70' : 'border-edge')}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          aria-label="Description"
          placeholder="What this tag means on the machine, e.g. “Start push button (green)”"
          className={cn(INPUT, 'h-auto resize-none border-edge py-1.5 leading-snug')}
        />
      </Field>
      <Field label="Type">
        <span className="inline-flex rounded-md border border-edge bg-black/20 p-0.5" role="radiogroup" aria-label="Tag type">
          {(['base', 'alias'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn('cursor-pointer rounded px-3 py-1 text-[12px] font-medium', kind === k ? 'bg-sky-500/20 text-sky-200' : 'text-slate-400 hover:text-slate-200')}
            >
              {k === 'base' ? 'Base' : 'Alias'}
            </button>
          ))}
        </span>
      </Field>
      {kind === 'alias' ? (
        <Field
          label="Alias For"
          hint={alias.trim() ? aliasError ? <span className="text-red-400">{aliasError}</span> : <span className="text-slate-500">Data type {aliasType}</span> : <span className="text-slate-500">e.g. Local:1:I.Data.0 — an input or output point of a module</span>}
        >
          <TagInput controller={controller} {...(scopeProgram ? { program: scopeProgram } : {})} value={alias} onChange={setAlias} placeholder="Local:1:I.Data.0" ariaLabel="Alias for" />
        </Field>
      ) : (
        <Field label="Data Type" hint={dimsError ? <span className="text-red-400">{dimsError}</span> : undefined}>
          <span className="flex gap-2">
            <select value={dataType} onChange={(e) => setDataType(e.target.value)} aria-label="Data type" className={cn(INPUT, 'cursor-pointer border-edge font-mono')}>
              {typeOptions.map((t) => (
                <option key={t} value={t} className="bg-panel-2">
                  {t}
                </option>
              ))}
            </select>
            <input value={dims} onChange={(e) => setDims(e.target.value)} placeholder="Array size" aria-label="Array size" className={cn(INPUT, 'w-28 font-mono', dimsError ? 'border-red-500/70' : 'border-edge')} />
          </span>
        </Field>
      )}
      <Field label="Scope">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'controller' | 'program')} aria-label="Scope" className={cn(INPUT, 'cursor-pointer border-edge')}>
          <option value="controller" className="bg-panel-2">
            {controller.project.controllerName} (controller)
          </option>
          <option value="program" className="bg-panel-2">
            {program} (program)
          </option>
        </select>
      </Field>
      <div className="flex items-center justify-end gap-2 border-t border-edge pt-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={!!error}>
          Create
        </Button>
      </div>
    </form>
  );
}
