/**
 * Headless helpers for the workspace program lifecycle: snapshots (neutral text + comments + player
 * tags), player-tag extraction from a live project, rung change counting and mission palette errors
 * as editor-friendly VerifyErrors. No React / DOM.
 */
import { serializeRung } from '../../plc/neutralText';
import type { Project, Rung, TagDef, VerifyError } from '../../plc/types';
import { MAIN_PROGRAM, MAIN_ROUTINE } from '../../sim/project';

/** A program as it is saved / exported / validated: neutral-text rungs, rung comments, player tags. */
export interface ProgramSnapshot {
  rungs: string[];
  comments: (string | undefined)[];
  tags: TagDef[];
}

const lower = (s: string): string => s.toLowerCase();

/** Neutral text + comments of editor rungs. */
export function rungsToText(rungs: ReadonlyArray<Rung>): { rungs: string[]; comments: (string | undefined)[] } {
  return {
    rungs: rungs.map((r) => serializeRung(r)),
    comments: rungs.map((r) => (r.comment !== undefined && r.comment !== '' ? r.comment : undefined)),
  };
}

/** Comments list trimmed of trailing `undefined`s (compact storage). */
export function compactComments(comments: ReadonlyArray<string | undefined>): (string | undefined)[] {
  const out = [...comments];
  while (out.length > 0 && out[out.length - 1] === undefined) out.pop();
  return out;
}

function sameTag(a: TagDef, b: TagDef): boolean {
  return JSON.stringify(normTag(a)) === JSON.stringify(normTag(b));
}

function normTag(t: TagDef): Record<string, unknown> {
  // stable key order + drop undefined fields
  const out: Record<string, unknown> = { name: t.name, dataType: String(t.dataType).toUpperCase() };
  if (t.dims) out.dims = t.dims;
  if (t.description) out.description = t.description;
  if (t.aliasFor) out.aliasFor = t.aliasFor;
  if (t.initial !== undefined) out.initial = t.initial;
  if (t.constant) out.constant = true;
  return out;
}

/**
 * Tags the player created or changed: every controller-scoped tag (and MainProgram tag, saved at
 * controller scope) of `project` that is not identical to a tag of `baseTags` (the tags a fresh
 * project would have anyway: scene aliases, scene extra tags, mission tags). System tags are skipped.
 */
export function userTagsOf(project: Project, baseTags: ReadonlyArray<TagDef>): TagDef[] {
  const base = new Map(baseTags.map((t) => [lower(t.name), t] as const));
  const out: TagDef[] = [];
  const seen = new Set<string>();
  const main = project.programs.find((p) => lower(p.name) === lower(MAIN_PROGRAM));
  const all = [...project.tags, ...(main?.tags ?? [])];
  for (const t of all) {
    if (t.system || t.name.includes(':')) continue;
    const key = lower(t.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const b = base.get(key);
    if (b && sameTag(b, t)) continue;
    out.push(structuredClone(t));
  }
  return out;
}

/** Stable signature of the tag definitions of a project (to detect tag edits). */
export function tagSignature(project: Project): string {
  const parts: string[] = [];
  for (const t of project.tags) parts.push(JSON.stringify(normTag(t)));
  for (const p of project.programs) for (const t of p.tags) parts.push(`${p.name}/${JSON.stringify(normTag(t))}`);
  return parts.join('|');
}

/** The rungs of MainProgram › MainRoutine of a project. */
export function mainRungs(project: Project): Rung[] {
  const p = project.programs.find((x) => lower(x.name) === lower(MAIN_PROGRAM)) ?? project.programs[0];
  const r = p?.routines.find((x) => lower(x.name) === lower(p.mainRoutine || MAIN_ROUTINE)) ?? p?.routines[0];
  return r?.rungs ?? [];
}

/**
 * Number of rungs that differ between two versions of a routine (added, removed or changed text /
 * comment), matched by rung id. Used for the `rungEdited` game event.
 */
export function countChangedRungs(prev: ReadonlyArray<Rung>, next: ReadonlyArray<Rung>): number {
  const before = new Map(prev.map((r) => [r.id, `${serializeRung(r)}\u0000${r.comment ?? ''}`] as const));
  let n = 0;
  const ids = new Set<string>();
  for (const r of next) {
    ids.add(r.id);
    const sig = `${serializeRung(r)}\u0000${r.comment ?? ''}`;
    if (before.get(r.id) !== sig) n++;
  }
  for (const id of before.keys()) if (!ids.has(id)) n++;
  return n;
}

/**
 * Mission palette messages (from `paletteErrors`) as VerifyErrors so the ladder editor can mark the
 * rung. `Error: MainProgram - MainRoutine, Rung 3, TON: TON is not available…` → rung 3.
 */
export function messagesToVerifyErrors(messages: ReadonlyArray<string>, severity: 'error' | 'warning' = 'error'): VerifyError[] {
  return messages.map((m) => {
    const loc = /^(?:Error|Warning):\s*([^,-]+?)\s*-\s*([^,]+?),\s*Rung\s+(\d+),\s*(.*)$/.exec(m);
    if (loc) {
      return { program: loc[1]!, routine: loc[2]!, rungIndex: Number(loc[3]), message: loc[4]!, severity };
    }
    return { program: MAIN_PROGRAM, routine: MAIN_ROUTINE, rungIndex: -1, message: m.replace(/^(?:Error|Warning):\s*/, ''), severity };
  });
}

/** Verification problems split by severity. */
export function splitErrors(errors: ReadonlyArray<VerifyError>): { errors: VerifyError[]; warnings: VerifyError[] } {
  return {
    errors: errors.filter((e) => e.severity === 'error'),
    warnings: errors.filter((e) => e.severity === 'warning'),
  };
}

/** Short, friendly one-liner of a verification problem for lists (no "Error:" prefix). */
export function friendlyVerifyError(e: VerifyError): string {
  const where = e.rungIndex >= 0 ? `Rung ${e.rungIndex}: ` : '';
  return `${where}${e.message}`;
}
