/**
 * Sandbox save slots and per-scene working copies, persisted to localStorage (headless; the storage
 * is injectable for tests and falls back to memory when localStorage is unavailable).
 */
import type { TagDef } from '../../plc/types';
import type { ProgramSnapshot } from './program';

export const SLOTS_STORAGE_KEY = 'plc-world-sandbox-slots-v1';
export const WORKING_COPY_PREFIX = 'plc-world-sandbox-current-v1:';
export const MAX_SLOTS = 50;

export interface SandboxSlot extends ProgramSnapshot {
  id: string;
  name: string;
  sceneId: string;
  createdAt: number;
  updatedAt: number;
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

let fallback: KeyValueStorage | undefined;

/** localStorage when usable, else a process-wide memory store. */
export function defaultStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      const probe = '__plc_world_slots_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    // ignore
  }
  fallback ??= memory();
  return fallback;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function normalizeSnapshot(o: Record<string, unknown>): ProgramSnapshot {
  return {
    rungs: Array.isArray(o.rungs) ? o.rungs.filter((r): r is string => typeof r === 'string') : [],
    comments: Array.isArray(o.comments) ? o.comments.map((c) => (typeof c === 'string' ? c : undefined)) : [],
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is TagDef => isObj(t) && typeof t.name === 'string' && typeof t.dataType === 'string') : [],
  };
}

function normalizeSlot(x: unknown): SandboxSlot | undefined {
  if (!isObj(x) || typeof x.id !== 'string' || typeof x.sceneId !== 'string') return undefined;
  const now = Date.now();
  return {
    id: x.id,
    name: typeof x.name === 'string' && x.name.trim() ? x.name.trim().slice(0, 80) : 'Untitled',
    sceneId: x.sceneId,
    createdAt: typeof x.createdAt === 'number' ? x.createdAt : now,
    updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : now,
    ...normalizeSnapshot(x),
  };
}

function write(storage: KeyValueStorage, key: string, value: unknown): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function newSlotId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** All save slots, newest first. */
export function listSlots(storage: KeyValueStorage = defaultStorage()): SandboxSlot[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(SLOTS_STORAGE_KEY) ?? '[]');
  } catch {
    raw = [];
  }
  const list = Array.isArray(raw) ? raw.map(normalizeSlot).filter((s): s is SandboxSlot => !!s) : [];
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveList(list: SandboxSlot[], storage: KeyValueStorage): boolean {
  return write(storage, SLOTS_STORAGE_KEY, list.slice(0, MAX_SLOTS));
}

/**
 * Save a program into a slot: `id` overwrites that slot, otherwise a slot with the same name and scene
 * is overwritten, otherwise a new slot is created. Returns the stored slot (undefined when storage failed).
 */
export function saveSlot(
  input: { id?: string; name: string; sceneId: string } & ProgramSnapshot,
  storage: KeyValueStorage = defaultStorage(),
  now = Date.now(),
): SandboxSlot | undefined {
  const list = listSlots(storage);
  const name = input.name.trim().slice(0, 80) || 'Untitled';
  const idx = input.id
    ? list.findIndex((s) => s.id === input.id)
    : list.findIndex((s) => s.sceneId === input.sceneId && s.name.toLowerCase() === name.toLowerCase());
  const prev = idx >= 0 ? list[idx] : undefined;
  const slot: SandboxSlot = {
    id: prev?.id ?? input.id ?? newSlotId(),
    name,
    sceneId: input.sceneId,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    rungs: [...input.rungs],
    comments: [...input.comments],
    tags: structuredClone(input.tags),
  };
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(slot);
  return saveList(list, storage) ? slot : undefined;
}

export function renameSlot(id: string, name: string, storage: KeyValueStorage = defaultStorage()): boolean {
  const list = listSlots(storage);
  const s = list.find((x) => x.id === id);
  if (!s) return false;
  s.name = name.trim().slice(0, 80) || s.name;
  return saveList(list, storage);
}

export function deleteSlot(id: string, storage: KeyValueStorage = defaultStorage()): boolean {
  const list = listSlots(storage);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  return saveList(next, storage);
}

export function getSlot(id: string, storage: KeyValueStorage = defaultStorage()): SandboxSlot | undefined {
  return listSlots(storage).find((s) => s.id === id);
}

/** The sandbox's autosaved working copy of a scene (so leaving the page never loses work). */
export function loadWorkingCopy(sceneId: string, storage: KeyValueStorage = defaultStorage()): (ProgramSnapshot & { name?: string; slotId?: string }) | undefined {
  try {
    const raw = storage.getItem(WORKING_COPY_PREFIX + sceneId);
    if (!raw) return undefined;
    const o = JSON.parse(raw) as unknown;
    if (!isObj(o)) return undefined;
    const snap = normalizeSnapshot(o);
    if (snap.rungs.length === 0) return undefined;
    const out: ProgramSnapshot & { name?: string; slotId?: string } = snap;
    if (typeof o.name === 'string') out.name = o.name;
    if (typeof o.slotId === 'string') out.slotId = o.slotId;
    return out;
  } catch {
    return undefined;
  }
}

export function saveWorkingCopy(
  sceneId: string,
  snap: ProgramSnapshot & { name?: string; slotId?: string },
  storage: KeyValueStorage = defaultStorage(),
): boolean {
  return write(storage, WORKING_COPY_PREFIX + sceneId, snap);
}

export function clearWorkingCopy(sceneId: string, storage: KeyValueStorage = defaultStorage()): void {
  try {
    storage.removeItem(WORKING_COPY_PREFIX + sceneId);
  } catch {
    // ignore
  }
}

/** The same program (rungs, comments, tags), ignoring whitespace and trailing empty comments. */
export function sameProgramSnapshot(a: ProgramSnapshot, b: ProgramSnapshot): boolean {
  const rungs = (s: ProgramSnapshot): string => JSON.stringify(s.rungs.map((r) => r.replace(/\s+/g, '')));
  const comments = (s: ProgramSnapshot): string => {
    const c = s.comments.map((x) => (x === undefined || x === '' ? null : x));
    while (c.length > 0 && c[c.length - 1] === null) c.pop();
    return JSON.stringify(c);
  };
  const tags = (s: ProgramSnapshot): string => JSON.stringify([...s.tags].sort((x, y) => x.name.localeCompare(y.name)));
  return rungs(a) === rungs(b) && comments(a) === comments(b) && tags(a) === tags(b);
}

/** A program with at least one instruction or player tag (not just the empty starter rung). */
export function hasProgramContent(s: ProgramSnapshot): boolean {
  return s.tags.length > 0 || s.rungs.some((r) => r.replace(/[;\s]/g, '') !== '');
}

/**
 * Before a share link / slot replaces a plant's working copy: keep the working copy in a recovery
 * slot, unless it is empty, identical to the incoming program or already saved in a slot. Returns the
 * recovery slot when one was written.
 */
export function backupWorkingCopy(
  sceneId: string,
  sceneTitle: string,
  incoming: ProgramSnapshot | undefined,
  storage: KeyValueStorage = defaultStorage(),
  now = Date.now(),
): SandboxSlot | undefined {
  const wip = loadWorkingCopy(sceneId, storage);
  if (!wip || !hasProgramContent(wip)) return undefined;
  if (incoming && sameProgramSnapshot(wip, incoming)) return undefined;
  if (listSlots(storage).some((s) => s.sceneId === sceneId && sameProgramSnapshot(s, wip))) return undefined;
  let stamp = '';
  try {
    stamp = new Date(now).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
  }
  const base = wip.name && wip.name !== 'Untitled' ? wip.name : 'Unsaved work';
  return saveSlot({ name: `${base} (recovered ${stamp}) – ${sceneTitle}`, sceneId, rungs: wip.rungs, comments: wip.comments, tags: wip.tags }, storage, now);
}
