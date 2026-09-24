/**
 * Program exchange formats (headless):
 *
 * 1. Neutral-text export (a .txt file people can read, diff, mail and paste back):
 *
 *      ; PLC World program export (Logix 5000 neutral text)
 *      SCENE trainer
 *      TAG Motor_Run BOOL "Motor run command"
 *      TAG {"name":"Recipe","dataType":"DINT","dims":10}
 *      RC: "Start/stop station with seal-in"
 *      N: [XIC(PB_Green),XIC(Motor_Run)]XIC(PB_Red)OTE(Motor_Run);
 *      N: XIC(Motor_Run)OTE(Light_0);
 *
 *    `RC:` (rung comment, JSON string) applies to the next `N:` rung. The importer is lenient: bare
 *    rungs ending in `;` are accepted too, and `;` / `#` / `//` lines are comments.
 *
 * 2. Share codes for URLs: JSON → deflate-raw (CompressionStream when available) → base64url,
 *    prefixed `z.` (compressed) or `j.` (plain).
 */
import type { TagDef } from '../../plc/types';
import type { ProgramSnapshot } from './program';

export interface ProgramDocument extends ProgramSnapshot {
  sceneId?: string;
  name?: string;
}

const SIMPLE_TAG_TYPES = /^[A-Za-z_][A-Za-z0-9_]*$/;

function simpleTag(t: TagDef): boolean {
  return (
    !t.dims &&
    !t.aliasFor &&
    t.initial === undefined &&
    !t.constant &&
    !t.system &&
    SIMPLE_TAG_TYPES.test(t.name) &&
    SIMPLE_TAG_TYPES.test(String(t.dataType))
  );
}

/** Serialize a program as neutral text (see module doc). */
export function exportProgramText(doc: ProgramDocument, opts: { sceneTitle?: string; date?: Date } = {}): string {
  const lines: string[] = ['; PLC World program export (Logix 5000 neutral text)'];
  if (doc.name) lines.push(`; Name: ${doc.name.replace(/[\r\n]+/g, ' ')}`);
  if (opts.sceneTitle) lines.push(`; Plant: ${opts.sceneTitle}`);
  lines.push(`; Exported: ${(opts.date ?? new Date()).toISOString()}`);
  if (doc.name) lines.push(`NAME ${JSON.stringify(doc.name)}`);
  if (doc.sceneId) lines.push(`SCENE ${doc.sceneId}`);
  for (const t of doc.tags) {
    if (simpleTag(t)) lines.push(`TAG ${t.name} ${String(t.dataType)}${t.description ? ` ${JSON.stringify(t.description)}` : ''}`);
    else lines.push(`TAG ${JSON.stringify(t)}`);
  }
  doc.rungs.forEach((r, i) => {
    const c = doc.comments[i];
    if (c) lines.push(`RC: ${JSON.stringify(c)}`);
    const text = r.trim() === '' ? ';' : r.trim().endsWith(';') ? r.trim() : `${r.trim()};`;
    lines.push(`N: ${text}`);
  });
  return `${lines.join('\n')}\n`;
}

export class ProgramTextError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'ProgramTextError';
  }
}

function parseTagLine(rest: string, line: number): TagDef {
  const s = rest.trim();
  if (s.startsWith('{')) {
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      throw new ProgramTextError('invalid TAG JSON', line);
    }
    if (typeof obj !== 'object' || obj === null) throw new ProgramTextError('invalid TAG JSON', line);
    const o = obj as Record<string, unknown>;
    if (typeof o.name !== 'string' || typeof o.dataType !== 'string') throw new ProgramTextError('TAG needs a name and a dataType', line);
    const t: TagDef = { name: o.name, dataType: o.dataType };
    if (typeof o.dims === 'number' && o.dims > 0) t.dims = Math.floor(o.dims);
    if (typeof o.description === 'string') t.description = o.description;
    if (typeof o.aliasFor === 'string') t.aliasFor = o.aliasFor;
    if (o.initial !== undefined) t.initial = o.initial as TagDef['initial'];
    if (o.constant === true) t.constant = true;
    return t;
  }
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?(?:\s+("(?:[^"\\]|\\.)*"))?\s*$/.exec(s);
  if (!m) throw new ProgramTextError(`cannot read TAG '${s}' (expected: TAG Name TYPE "description")`, line);
  const t: TagDef = { name: m[1]!, dataType: m[2]!.toUpperCase() };
  if (m[3]) t.dims = Number(m[3]);
  if (m[4]) t.description = JSON.parse(m[4]) as string;
  return t;
}

function parseQuoted(rest: string, line: number): string {
  const s = rest.trim();
  if (s.startsWith('"')) {
    try {
      const v = JSON.parse(s) as unknown;
      if (typeof v === 'string') return v;
    } catch {
      // L5K style "" escapes
      if (s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
    }
    throw new ProgramTextError('invalid quoted text', line);
  }
  return s;
}

/**
 * Parse neutral-text program exports (and plain pasted rungs). Rungs are NOT syntax-checked here
 * (the editor / controller does that); structure errors throw ProgramTextError.
 */
export function importProgramText(text: string): ProgramDocument {
  const doc: ProgramDocument = { rungs: [], comments: [], tags: [] };
  let pendingComment: string | undefined;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) return;
    if (line.startsWith(';')) {
      if (line === ';') {
        doc.rungs.push('');
        doc.comments.push(pendingComment);
        pendingComment = undefined;
      }
      return;
    }
    const kw = /^([A-Za-z]+)(:?)\s*(.*)$/.exec(line);
    const word = kw?.[1]?.toUpperCase();
    if (kw && word === 'SCENE' && kw[2] === '') {
      doc.sceneId = kw[3]!.trim();
      return;
    }
    if (kw && word === 'NAME' && kw[2] === '') {
      doc.name = parseQuoted(kw[3]!, lineNo);
      return;
    }
    if (kw && word === 'TAG' && kw[2] === '') {
      const t = parseTagLine(kw[3]!, lineNo);
      const i = doc.tags.findIndex((x) => x.name.toLowerCase() === t.name.toLowerCase());
      if (i >= 0) doc.tags[i] = t;
      else doc.tags.push(t);
      return;
    }
    if (kw && word === 'RC' && kw[2] === ':') {
      pendingComment = parseQuoted(kw[3]!, lineNo);
      return;
    }
    let rung = line;
    if (kw && word === 'N' && kw[2] === ':') rung = kw[3]!.trim();
    if (!rung.endsWith(';')) throw new ProgramTextError(`a rung must end with ';' (got '${rung.slice(0, 40)}')`, lineNo);
    doc.rungs.push(rung === ';' ? '' : rung);
    doc.comments.push(pendingComment);
    pendingComment = undefined;
  });
  if (doc.rungs.length === 0) throw new ProgramTextError('no rungs found (rungs look like N: XIC(Start)OTE(Motor);)', lines.length);
  return doc;
}

// ---------------------------------------------------------------------------
// Share codes
// ---------------------------------------------------------------------------

interface SharePayload {
  v: 1;
  s?: string;
  n?: string;
  r: string[];
  c?: (string | null)[];
  t?: TagDef[];
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const hasCompression = (): boolean => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Encode a program into a URL-safe share code. */
export async function encodeShareCode(doc: ProgramDocument): Promise<string> {
  const payload: SharePayload = { v: 1, r: doc.rungs };
  if (doc.sceneId) payload.s = doc.sceneId;
  if (doc.name) payload.n = doc.name;
  if (doc.comments.some((c) => c !== undefined)) payload.c = doc.comments.map((c) => c ?? null);
  if (doc.tags.length) payload.t = doc.tags;
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (hasCompression()) {
    try {
      return `z.${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
    } catch {
      // fall through to plain
    }
  }
  return `j.${toBase64Url(bytes)}`;
}

/** Decode a share code (throws on malformed input). */
export async function decodeShareCode(code: string): Promise<ProgramDocument> {
  const m = /^([zj])\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) throw new Error('Not a PLC World share code.');
  let bytes = fromBase64Url(m[2]!);
  if (m[1] === 'z') {
    if (!hasCompression()) throw new Error('This browser cannot decompress share codes.');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  const obj = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SharePayload>;
  if (obj.v !== 1 || !Array.isArray(obj.r)) throw new Error('Unsupported share code version.');
  const doc: ProgramDocument = {
    rungs: obj.r.filter((r): r is string => typeof r === 'string'),
    comments: Array.isArray(obj.c) ? obj.c.map((c) => (typeof c === 'string' ? c : undefined)) : [],
    tags: Array.isArray(obj.t) ? obj.t.filter((t): t is TagDef => typeof t === 'object' && t !== null && typeof t.name === 'string' && typeof t.dataType === 'string') : [],
  };
  if (typeof obj.s === 'string') doc.sceneId = obj.s;
  if (typeof obj.n === 'string') doc.name = obj.n;
  return doc;
}

/** File-name friendly slug. */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'program'
  );
}
