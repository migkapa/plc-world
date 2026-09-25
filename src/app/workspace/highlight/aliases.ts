/**
 * Which plant I/O points a piece of mission text talks about (headless): code spans in briefings / objectives such as
 * `Switch_0`, `Local:2:O.Data.0` or `XIC Start_PB OTE Motor` name the physical devices the 3D view can highlight.
 */
import type { IoPointDef } from '../../../sim/types';

/** A tag-name-like token (aliases, module operands such as Local:1:I.Data.0, members / bits). */
const TOKEN = /[A-Za-z_][A-Za-z0-9_:.[\]]*/g;

/** The I/O alias `name` refers to in this plant: the alias itself or its module operand (case-insensitive). */
export function ioAliasOf(name: string, io: ReadonlyArray<IoPointDef>): string | undefined {
  const l = name.trim().replace(/\.+$/, '').toLowerCase();
  if (!l) return undefined;
  for (const p of io) if (p.alias.toLowerCase() === l || p.operand.toLowerCase() === l) return p.alias;
  return undefined;
}

export interface CodePart {
  text: string;
  /** Set when this part names an I/O point (its alias). */
  alias?: string;
}

/** Split a code span into plain text and I/O tag parts ("XIC Start_PB" → "XIC ", Start_PB). */
export function splitCode(code: string, io: ReadonlyArray<IoPointDef>): CodePart[] {
  const out: CodePart[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    let tok = m[0];
    // a sentence dot right after a tag is not part of it
    while (tok.endsWith('.')) tok = tok.slice(0, -1);
    const alias = ioAliasOf(tok, io);
    if (!alias) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ text: code.slice(last, at) });
    out.push({ text: tok, alias });
    last = at + tok.length;
  }
  if (last < code.length) out.push({ text: code.slice(last) });
  return out;
}

/** Distinct I/O aliases named in the `code` spans of a Markdown text, in order of appearance. */
export function aliasesInText(md: string, io: ReadonlyArray<IoPointDef>): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/`([^`]+)`/g)) {
    for (const part of splitCode(m[1]!, io)) if (part.alias && !out.includes(part.alias)) out.push(part.alias);
  }
  return out;
}
