/**
 * Headless rung layout for the ladder editor (Studio 5000 Logix Designer look).
 *
 *   margin │ left rail                                                   right rail
 *    (0)   ├──] [──────]/[──────┬──] [──┬───────────────────────────────( )──┤
 *          │                    └──] [──┘                                    │
 *
 * - Rung numbers (and verify markers) live in the left margin; the rails bound the logic.
 * - Elements are placed left to right with a minimum wire gap; the trailing group of output
 *   instructions of every series is right-justified against the right rail (or the right connector of
 *   the branch it sits in), exactly like Logix Designer draws coils against the right rail.
 * - Contacts/coils are narrow cells with the operand (tag) text above the glyph, preceded by the tag
 *   description and followed by the alias base tag `<Local:1:I.Data.0>`.
 * - Box instructions draw a box with the mnemonic + name header at the rung wire, one row per operand
 *   ("Timer  T1", "Preset  5000", "Accum  0") and status outputs (EN/DN/…) on the right edge.
 * - Branch legs stack vertically; each leg's wire y is below the previous leg's lowest extent.
 * - Operand (tag) texts are never truncated (Logix names are up to 40 characters plus member paths);
 *   cells grow to fit them. Only descriptions wrap / get an ellipsis.
 * - With `wrap`, a main series wider than the available width continues on further lines (Studio 5000
 *   wraps long rungs the same way): the line ends in a wrap marker ─▸ and the next one starts with ▸─,
 *   so rails and right-justified outputs stay within the viewport.
 *
 * Every wire segment carries a `PowerRef` telling the renderer which live value energizes it
 * (element rung-condition-in/out), so online animation only toggles classes.
 *
 * Pure TypeScript (no DOM): text widths use font metrics estimates matching the renderer's fonts.
 */
import { INSTRUCTION_DEFS, type InstructionDef, type OperandSpec } from '@/plc/instructions';
import type { BranchNode, InstructionNode, Rung, RungElement } from '@/plc/types';
import { trailingOutputStart, type LegPath } from './ops';

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Geometry constants (px at zoom 1). */
export const LD = {
  /** Left margin holding rung numbers & markers (x of the left rail). */
  margin: 58,
  /** Space right of the right rail. */
  rightPad: 14,
  /** Minimum wire between elements. */
  gap: 16,
  /** Width of an empty branch leg (a short). */
  emptyLeg: 46,
  /** Vertical gap between branch legs. */
  legGap: 10,
  padTop: 12,
  padBottom: 12,
  /** Contact / coil cell. */
  cellMin: 66,
  cellMax: 124,
  glyphW: 22,
  glyphH: 9,
  /** Box instruction. */
  boxMin: 128,
  boxRow: 15,
  boxValueRow: 12,
  boxHeader: 32,
  statusW: 44,
  statusPitch: 24,
  /** Comment box. */
  commentLine: 15,
  commentPad: 7,
  commentMaxLines: 10,
  descLine: 11.5,
  descMaxLines: 3,
  minHeight: 46,
  endHeight: 38,
  /** Room for a wrap / continuation marker at the end / start of a wrapped rung line. */
  wrapMark: 18,
  /** Vertical gap between the lines of a wrapped rung. */
  wrapGap: 14,
} as const;

/** Fonts used by the renderer; the layout measures with the same sizes. */
export const LD_FONT = {
  tag: { family: 'mono', size: 11, weight: 600 },
  alias: { family: 'mono', size: 9.5, weight: 400 },
  desc: { family: 'sans', size: 10, weight: 400 },
  mnemonic: { family: 'mono', size: 11.5, weight: 700 },
  name: { family: 'sans', size: 10, weight: 400 },
  label: { family: 'sans', size: 10.5, weight: 400 },
  operand: { family: 'mono', size: 11, weight: 600 },
  value: { family: 'mono', size: 10.5, weight: 400 },
  glyphText: { family: 'mono', size: 10, weight: 700 },
  status: { family: 'mono', size: 9.5, weight: 700 },
  comment: { family: 'sans', size: 11.5, weight: 400 },
  number: { family: 'mono', size: 11, weight: 600 },
} as const;

export type FontFamily = 'mono' | 'sans';

/** Estimated advance of a character in em (Inter-like proportional font). */
function sansEm(ch: string): number {
  if (/[ilj!|.,:;'`]/.test(ch)) return 0.27;
  if (ch === ' ') return 0.28;
  if (/[ftrI()[\]{}\-/\\]/.test(ch)) return 0.36;
  if (/[mwMW@%]/.test(ch)) return 0.86;
  if (/[A-Z]/.test(ch)) return 0.67;
  if (/[0-9]/.test(ch)) return 0.58;
  if (/[a-z]/.test(ch)) return 0.54;
  return 0.58;
}

/** Estimated text width in px (monospace: 0.6 em advance, JetBrains Mono). */
export function textWidth(text: string, family: FontFamily, size: number): number {
  if (family === 'mono') return text.length * size * 0.6;
  let em = 0;
  for (const ch of text) em += sansEm(ch);
  return em * size;
}

/** Truncate to `max` characters with an ellipsis. */
export function ellipsize(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

/** Greedy word wrap (long words are broken); the last line gets an ellipsis when truncated. */
export function wrapText(text: string, maxW: number, family: FontFamily, size: number, maxLines = Infinity): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n/g, '\n').split('\n')) {
    const words = para.split(/\s+/).filter((w) => w !== '');
    let line = '';
    const push = (l: string): void => {
      out.push(l);
    };
    if (words.length === 0) {
      push('');
      continue;
    }
    for (let word of words) {
      const cand = line ? `${line} ${word}` : word;
      if (textWidth(cand, family, size) <= maxW) {
        line = cand;
        continue;
      }
      if (line) push(line);
      line = '';
      while (textWidth(word, family, size) > maxW && word.length > 1) {
        let n = word.length - 1;
        while (n > 1 && textWidth(word.slice(0, n), family, size) > maxW) n--;
        push(word.slice(0, n));
        word = word.slice(n);
      }
      line = word;
    }
    if (line) push(line);
  }
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 1 && textWidth(`${last}…`, family, size) > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.replace(/\s+$/, '')}…`;
    return kept;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which live value energizes a wire. */
export type PowerRef =
  | { t: 'rail' }
  | { t: 'in'; id: string }
  | { t: 'out'; id: string }
  | { t: 'any'; refs: PowerRef[] };

export function powerKey(p: PowerRef): string {
  switch (p.t) {
    case 'rail':
      return 'rail';
    case 'in':
    case 'out':
      return `${p.t}:${p.id}`;
    case 'any':
      return `any(${p.refs.map(powerKey).join('|')})`;
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WireSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  power: PowerRef;
  /** Horizontal series segments: the insertion point a click on this wire selects. */
  gap?: { legPath?: LegPath; index: number };
}

export type TextClass = 'tag' | 'alias' | 'desc' | 'mnemonic' | 'name' | 'label' | 'operand' | 'value' | 'glyph' | 'status';

export interface TextSpan {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  cls: TextClass;
}

export interface OperandLayout {
  index: number;
  /** Operand text as stored. */
  text: string;
  /** Text as drawn (possibly truncated). */
  shown: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  cls: 'tag' | 'operand';
  /** Box row label (operand name). */
  label?: string;
  /** Hit / highlight rectangle. */
  hit: Rect;
  /** Operand spec (undefined for unknown instructions or extra operands). */
  spec?: OperandSpec;
  /**
   * Live value drawn in place of the operand text when online (TON Preset/Accum show T.PRE / T.ACC).
   */
  inlineValue?: string;
}

/** A live value drawn under an operand (online). */
export interface ValueSpot {
  operand: string;
  operandIndex: number;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  /** BOOL values draw as 0/1 chips under contacts/coils. */
  style: 'chip' | 'plain';
}

export interface StatusLayout {
  bit: string;
  /** Operand to read (e.g. 'Timer1.DN'); undefined while the structure operand is '?'. */
  operand?: string;
  /** Stub line from the box edge x1 to x2 at y; label centred at lx. */
  x1: number;
  x2: number;
  y: number;
  lx: number;
}

export type GlyphKind = 'xic' | 'xio' | 'ote' | 'otl' | 'otu' | 'contact' | 'coil' | 'box';

export interface InstrLayout {
  kind: 'instr';
  id: string;
  op: string;
  known: boolean;
  info?: InstructionDef;
  display: 'contact' | 'coil' | 'box';
  glyph: GlyphKind;
  /** Text inside a contact/coil glyph (ONS, JMP, L, U…). */
  glyphText?: string;
  /** Cell left x, width, wire y. */
  x: number;
  w: number;
  y: number;
  /** Absolute vertical bounds of the cell. */
  top: number;
  bottom: number;
  legPath?: LegPath;
  index: number;
  /** Glyph bounds (contact/coil) or the box rectangle. */
  sym: Rect;
  /** Box header band height (box instructions). */
  header?: number;
  operands: OperandLayout[];
  texts: TextSpan[];
  values: ValueSpot[];
  status: StatusLayout[];
}

export interface BranchLayout {
  kind: 'branch';
  id: string;
  /** Left and right connector x. */
  x: number;
  x2: number;
  y: number;
  /** Wire y of every leg. */
  legYs: number[];
  /** Indexes of the legs without any element (shorts: power always passes). */
  emptyLegs: number[];
  top: number;
  bottom: number;
  legPath?: LegPath;
  index: number;
}

export type NodeLayout = InstrLayout | BranchLayout;

export interface GapLayout {
  legPath?: LegPath;
  index: number;
  /** Insertion marker position. */
  x: number;
  y: number;
  /** Extent of the wire segment of this gap. */
  x0: number;
  x1: number;
}

/** Wrap marker of a rung continued on the next line ('out' ends a line, 'in' starts the next one). */
export interface WrapMark {
  side: 'out' | 'in';
  /** Marker left x (the marker is LD.wrapMark wide) and wire y. */
  x: number;
  y: number;
  /** 1-based number of the continuation (line k → line k+1 is continuation k). */
  n: number;
}

export interface RungLayout {
  width: number;
  height: number;
  railL: number;
  railR: number;
  /** Main wire y. */
  y: number;
  /** Top of the logic (below the comment box). */
  bodyTop: number;
  comment?: { x: number; y: number; w: number; h: number; lines: string[] };
  nodes: NodeLayout[];
  byId: Record<string, NodeLayout>;
  wires: WireSeg[];
  gaps: GapLayout[];
  /** Wrap markers (empty unless the rung was wrapped onto several lines). */
  wraps: WrapMark[];
  /** Wire y of every line of a wrapped rung ([y] when not wrapped). */
  lines: number[];
}

export interface TagMeta {
  description?: string;
  /** Alias target as displayed under the tag (`<…>`). */
  aliasFor?: string;
  dataType?: string;
}

export type TagMetaLookup = (operand: string) => TagMeta | undefined;

export interface LayoutOptions {
  /** Minimum total width (typically the viewport width at zoom 1). */
  width?: number;
  tagMeta?: TagMetaLookup;
  /** Reserve room for live values (online). */
  showValues?: boolean;
  /** Tag descriptions above contacts/coils (default true). */
  showDescriptions?: boolean;
  /** Rung comment box (default true). */
  showComment?: boolean;
  /** Left margin (default LD.margin). */
  margin?: number;
  /**
   * Wrap the main series onto continuation lines when it is wider than `width` (the editor does; static
   * renderings don't). Default false: the rung widens instead.
   */
  wrap?: boolean;
}

// ---------------------------------------------------------------------------
// Instruction appearance
// ---------------------------------------------------------------------------

/** Glyph / display of a mnemonic (RES is drawn as a coil like in Logix Designer). */
export function glyphOf(op: string): { display: 'contact' | 'coil' | 'box'; glyph: GlyphKind; text?: string; known: boolean } {
  const u = op.toUpperCase();
  switch (u) {
    case 'XIC':
      return { display: 'contact', glyph: 'xic', known: true };
    case 'XIO':
      return { display: 'contact', glyph: 'xio', known: true };
    case 'OTE':
      return { display: 'coil', glyph: 'ote', known: true };
    case 'OTL':
      return { display: 'coil', glyph: 'otl', text: 'L', known: true };
    case 'OTU':
      return { display: 'coil', glyph: 'otu', text: 'U', known: true };
    case 'RES':
      return { display: 'coil', glyph: 'coil', text: 'RES', known: true };
    default:
      break;
  }
  const def = INSTRUCTION_DEFS[u];
  if (!def) return { display: 'box', glyph: 'box', known: false };
  if (def.display === 'contact') return { display: 'contact', glyph: 'contact', text: u, known: true };
  if (def.display === 'coil') return { display: 'coil', glyph: 'coil', text: u, known: true };
  return { display: 'box', glyph: 'box', known: true };
}

/** Operand spec of operand `i` (position-dependent specs and variadic parameters included). */
export function operandSpec(def: InstructionDef | undefined, i: number, texts: readonly string[]): OperandSpec | undefined {
  if (!def) return undefined;
  return def.specFor?.(i, texts) ?? def.operands[i] ?? def.variadic;
}

const RE_LITERAL = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|(2|8|16)#[0-9A-Fa-f_]+)$/;

/** True for numeric literals ('5000', '1.5', '16#FF'). */
export function isLiteral(text: string): boolean {
  return RE_LITERAL.test(text.trim());
}

/** True when an operand text names a tag that can be read live. */
export function isTagOperand(text: string): boolean {
  const t = text.trim();
  return t !== '' && t !== '?' && !isLiteral(t) && /^[A-Za-z_]/.test(t);
}

const VALUE_KINDS = new Set(['bit', 'bitDest', 'num', 'numDest', 'int', 'intDest', 'scalar', 'scalarDest', 'array']);

/** Operand used for a box's status bits (the TIMER / COUNTER / CONTROL operand). */
function structOperand(def: InstructionDef | undefined, operands: readonly string[]): string | undefined {
  if (!def) return undefined;
  const i = def.operands.findIndex((s) => s.kind === 'struct');
  const t = i >= 0 ? operands[i] : undefined;
  return t && isTagOperand(t) ? t : undefined;
}

// ---------------------------------------------------------------------------
// Measure pass
// ---------------------------------------------------------------------------

interface MInstr {
  kind: 'instr';
  el: InstructionNode;
  w: number;
  top: number;
  bottom: number;
  place(x: number, y: number, legPath: LegPath | undefined, index: number): InstrLayout;
}

interface MBranch {
  kind: 'branch';
  el: BranchNode;
  w: number;
  top: number;
  bottom: number;
  legs: MSeries[];
  offsets: number[];
}

interface MSeries {
  items: Array<MInstr | MBranch>;
  els: RungElement[];
  w: number;
  top: number;
  bottom: number;
}

const f = LD_FONT;
const tw = (text: string, font: { family: string; size: number }): number => textWidth(text, font.family as FontFamily, font.size);

function measureContactCoil(el: InstructionNode, look: ReturnType<typeof glyphOf>, opts: LayoutOptions): MInstr {
  const def = INSTRUCTION_DEFS[el.op];
  const operand = el.operands[0];
  // the full operand is always drawn (Zone01 / Zone02 variants must stay distinguishable)
  const shown = operand;
  const meta = operand && isTagOperand(operand) ? opts.tagMeta?.(operand) : undefined;
  const alias = meta?.aliasFor ? `<${meta.aliasFor}>` : undefined;
  const coil = look.display === 'coil';
  const multi = look.text !== undefined && look.text.length > 1;
  // half width of the glyph = where the lead wires attach (contact bars / coil arcs)
  const hw = multi ? Math.ceil(tw(look.text!, f.glyphText) / 2) + (coil ? 8 : 6) : coil ? 8 : 7;
  const glyphW = hw * 2;
  let w = Math.max(LD.cellMin, glyphW + 24, shown ? tw(shown, f.tag) + 12 : 0, alias ? tw(alias, f.alias) + 10 : 0);
  const showDesc = opts.showDescriptions !== false && meta?.description;
  if (showDesc) w = Math.max(w, Math.min(LD.cellMax, tw(meta!.description!, f.desc) + 10));
  w = Math.ceil(w / 2) * 2;
  const desc = showDesc ? wrapText(meta!.description!, w - 6, 'sans', f.desc.size, LD.descMaxLines) : [];
  const tagBase = alias ? 26 : 15;
  const top = shown !== undefined ? tagBase + 10 + desc.length * LD.descLine + 3 : LD.glyphH + 8;
  const showValue = opts.showValues === true && operand !== undefined && isTagOperand(operand);
  const bottom = LD.glyphH + (showValue ? 17 : 5);

  return {
    kind: 'instr',
    el,
    w,
    top,
    bottom,
    place(x, y, legPath, index) {
      const cx = x + w / 2;
      const texts: TextSpan[] = [];
      desc.forEach((line, i) => {
        texts.push({ text: line, x: cx, y: y - tagBase - 13 - (desc.length - 1 - i) * LD.descLine, anchor: 'middle', cls: 'desc' });
      });
      if (alias) texts.push({ text: alias, x: cx, y: y - 14, anchor: 'middle', cls: 'alias' });
      if (look.text) texts.push({ text: look.text, x: cx, y: y + 3.5, anchor: 'middle', cls: 'glyph' });
      const operands: OperandLayout[] = [];
      if (operand !== undefined && shown !== undefined) {
        const ow = tw(shown, f.tag);
        const spec = operandSpec(def, 0, el.operands);
        operands.push({
          index: 0,
          text: operand,
          shown,
          x: cx,
          y: y - tagBase,
          anchor: 'middle',
          cls: 'tag',
          hit: { x: cx - ow / 2 - 3, y: y - tagBase - 11, w: ow + 6, h: 15 },
          ...(spec ? { spec } : {}),
        });
      }
      const values: ValueSpot[] = showValue ? [{ operand: operand!, operandIndex: 0, x: cx, y: y + 22, anchor: 'middle', style: 'chip' }] : [];
      const gw = glyphW;
      return {
        kind: 'instr',
        id: el.id,
        op: el.op,
        known: look.known,
        ...(def ? { info: def } : {}),
        display: look.display,
        glyph: look.glyph,
        ...(look.text ? { glyphText: look.text } : {}),
        x,
        w,
        y,
        top: y - top,
        bottom: y + bottom,
        ...(legPath ? { legPath } : {}),
        index,
        sym: { x: cx - gw / 2, y: y - LD.glyphH, w: gw, h: LD.glyphH * 2 },
        operands,
        texts,
        values,
        status: [],
      };
    },
  };
}

function measureBox(el: InstructionNode, look: ReturnType<typeof glyphOf>, opts: LayoutOptions): MInstr {
  const def = INSTRUCTION_DEFS[el.op];
  const name = def ? def.name : 'Unknown instruction';
  const count = def ? Math.max(el.operands.length, def.minOperands ?? def.operands.length) : el.operands.length;
  interface Row {
    index: number;
    label: string;
    text: string;
    shown: string;
    spec?: OperandSpec;
    valueLine: boolean;
    inline?: string;
  }
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const spec = operandSpec(def, i, el.operands);
    const text = el.operands[i] ?? '?';
    const kind = spec?.kind;
    let inline: string | undefined;
    if (kind === 'display' && spec?.init && def) {
      const base = el.operands[spec.init.operand];
      if (base && isTagOperand(base)) inline = `${base}.${spec.init.member}`;
    }
    const valueLine = opts.showValues === true && kind !== undefined && VALUE_KINDS.has(kind) && isTagOperand(text);
    rows.push({
      index: i,
      label: spec?.name ?? `Operand ${i}`,
      text,
      shown: text,
      ...(spec ? { spec } : {}),
      valueLine,
      ...(inline ? { inline } : {}),
    });
  }
  const labelW = Math.max(0, ...rows.map((r) => tw(r.label, f.label)));
  const valW = Math.max(0, ...rows.map((r) => Math.max(tw(r.shown, f.operand), r.inline ? tw('-2147483648', f.value) : 0)));
  const headW = Math.max(tw(el.op, f.mnemonic), tw(name, f.name)) + 20;
  let boxW = Math.max(LD.boxMin, rows.length > 0 ? 10 + labelW + 16 + valW + 10 : 0, headW);
  boxW = Math.ceil(boxW / 2) * 2;
  const statusBits = def?.statusBits ?? [];
  const statusW = statusBits.length > 0 ? LD.statusW : 0;
  const w = boxW + statusW;
  const header = rows.length > 0 ? LD.boxHeader : 30;
  let rowY = header + 4; // first row baseline offset from the box top… computed below
  const rowPos: number[] = [];
  for (const r of rows) {
    rowY += LD.boxRow;
    rowPos.push(rowY - 4);
    if (r.valueLine) rowY += LD.boxValueRow;
  }
  const boxTopOff = 11; // box top above the wire
  const boxH = rows.length > 0 ? rowY + 7 : header;
  const statusBottom = statusBits.length > 0 ? (statusBits.length - 1) * LD.statusPitch + 10 : 0;
  const top = boxTopOff + 3;
  const bottom = Math.max(boxH - boxTopOff, statusBottom) + 4;
  const sop = structOperand(def, el.operands);

  return {
    kind: 'instr',
    el,
    w,
    top,
    bottom,
    place(x, y, legPath, index) {
      const bx = x;
      const by = y - boxTopOff;
      const texts: TextSpan[] = [
        { text: el.op, x: bx + 8, y: y + 4, anchor: 'start', cls: 'mnemonic' },
        { text: name, x: bx + 8, y: y + 15.5, anchor: 'start', cls: 'name' },
      ];
      const operands: OperandLayout[] = [];
      const values: ValueSpot[] = [];
      rows.forEach((r, k) => {
        const ry = by + rowPos[k]!;
        texts.push({ text: r.label, x: bx + 8, y: ry, anchor: 'start', cls: 'label' });
        const ow = tw(r.shown, f.operand);
        const vx = bx + boxW - 8;
        operands.push({
          index: r.index,
          text: r.text,
          shown: r.shown,
          x: vx,
          y: ry,
          anchor: 'end',
          cls: 'operand',
          label: r.label,
          hit: { x: vx - Math.max(ow, 18) - 3, y: ry - 11, w: Math.max(ow, 18) + 6, h: 15 },
          ...(r.spec ? { spec: r.spec } : {}),
          ...(r.inline ? { inlineValue: r.inline } : {}),
        });
        if (r.valueLine) values.push({ operand: r.text, operandIndex: r.index, x: vx, y: ry + LD.boxValueRow, anchor: 'end', style: 'plain' });
      });
      const status: StatusLayout[] = statusBits.map((bit, k) => ({
        bit,
        ...(sop ? { operand: `${sop}.${bit}` } : {}),
        x1: bx + boxW,
        x2: x + w,
        y: y + k * LD.statusPitch,
        lx: bx + boxW + statusW / 2,
      }));
      return {
        kind: 'instr',
        id: el.id,
        op: el.op,
        known: look.known,
        ...(def ? { info: def } : {}),
        display: 'box',
        glyph: 'box',
        x,
        w,
        y,
        top: y - top,
        bottom: y + bottom,
        ...(legPath ? { legPath } : {}),
        index,
        sym: { x: bx, y: by, w: boxW, h: boxH },
        header: rows.length > 0 ? 32 : boxH,
        operands,
        texts,
        values,
        status,
      };
    },
  };
}

function measureInstr(el: InstructionNode, opts: LayoutOptions): MInstr {
  const look = glyphOf(el.op);
  return look.display === 'box' ? measureBox(el, look, opts) : measureContactCoil(el, look, opts);
}

function measureSeries(els: RungElement[], opts: LayoutOptions): MSeries {
  const items = els.map((el) => (el.kind === 'instr' ? measureInstr(el, opts) : measureBranch(el, opts)));
  if (items.length === 0) return { items, els, w: LD.emptyLeg, top: 8, bottom: 6 };
  const w = LD.gap + items.reduce((s, it) => s + it.w + LD.gap, 0);
  return {
    items,
    els,
    w,
    top: Math.max(...items.map((i) => i.top)),
    bottom: Math.max(...items.map((i) => i.bottom)),
  };
}

function measureBranch(el: BranchNode, opts: LayoutOptions): MBranch {
  const legs = el.legs.map((leg) => measureSeries(leg, opts));
  if (legs.length === 0) legs.push(measureSeries([], opts));
  const offsets: number[] = [0];
  for (let k = 1; k < legs.length; k++) offsets.push(offsets[k - 1]! + legs[k - 1]!.bottom + LD.legGap + legs[k]!.top);
  const last = legs.length - 1;
  return {
    kind: 'branch',
    el,
    w: Math.max(...legs.map((l) => l.w)),
    top: legs[0]!.top,
    bottom: offsets[last]! + legs[last]!.bottom,
    legs,
    offsets,
  };
}

// ---------------------------------------------------------------------------
// Place pass
// ---------------------------------------------------------------------------

interface Out {
  nodes: NodeLayout[];
  byId: Record<string, NodeLayout>;
  wires: WireSeg[];
  gaps: GapLayout[];
}

function withLeg<T extends object>(o: T, legPath: LegPath | undefined): T & { legPath?: LegPath } {
  return legPath ? { ...o, legPath } : o;
}

function lastOut(ms: MSeries, branchId: string): PowerRef {
  const last = ms.items[ms.items.length - 1];
  return last ? { t: 'out', id: last.el.id } : { t: 'in', id: branchId };
}

function placeSeries(ms: MSeries, x0: number, x1: number, y: number, legPath: LegPath | undefined, inPower: PowerRef, out: Out): void {
  const n = ms.items.length;
  if (n === 0) {
    out.wires.push({ x1: x0, y1: y, x2: x1, y2: y, power: inPower, gap: withLeg({ index: 0 }, legPath) });
    out.gaps.push(withLeg({ index: 0, x: (x0 + x1) / 2, y, x0, x1 }, legPath));
    return;
  }
  placeRange(ms, 0, n, x0, x1, y, legPath, out, true);
}

/**
 * Place items [from, to) of a series between x0 and x1 on wire y (one line of a wrapped rung, or the
 * whole series). With `justify`, the series' trailing output group is right-justified against x1.
 */
function placeRange(ms: MSeries, from: number, to: number, x0: number, x1: number, y: number, legPath: LegPath | undefined, out: Out, justify: boolean): void {
  const t = justify ? Math.max(from, trailingOutputStart(ms.els)) : to;
  const xs: number[] = [];
  let x = x0 + LD.gap;
  for (let i = from; i < t; i++) {
    xs.push(x);
    x += ms.items[i]!.w + LD.gap;
  }
  if (t < to) {
    let groupW = 0;
    for (let i = t; i < to; i++) groupW += ms.items[i]!.w + (i > t ? LD.gap : 0);
    x = Math.max(x, x1 - LD.gap - groupW);
    for (let i = t; i < to; i++) {
      xs.push(x);
      x += ms.items[i]!.w + LD.gap;
    }
  }
  let prev = x0;
  for (let i = from; i < to; i++) {
    const it = ms.items[i]!;
    const ix = xs[i - from]!;
    out.wires.push({ x1: prev, y1: y, x2: ix, y2: y, power: { t: 'in', id: it.el.id }, gap: withLeg({ index: i }, legPath) });
    out.gaps.push(withLeg({ index: i, x: (prev + ix) / 2, y, x0: prev, x1: ix }, legPath));
    if (it.kind === 'instr') placeInstr(it, ix, y, legPath, i, out);
    else placeBranch(it, ix, y, legPath, i, out);
    prev = ix + it.w;
  }
  const last = ms.items[to - 1]!;
  out.wires.push({ x1: prev, y1: y, x2: x1, y2: y, power: { t: 'out', id: last.el.id }, gap: withLeg({ index: to }, legPath) });
  out.gaps.push(withLeg({ index: to, x: (prev + x1) / 2, y, x0: prev, x1 }, legPath));
}

/** Width a line of items [from, to) needs (wires included, wrap markers excluded). */
function rangeWidth(ms: MSeries, from: number, to: number): number {
  let w = LD.gap;
  for (let i = from; i < to; i++) w += ms.items[i]!.w + LD.gap;
  return w;
}

/**
 * Split a main series into lines fitting `span` (rail to rail). Every line but the first starts with a
 * continuation marker and every line but the last ends with a wrap marker; a line holds at least one item.
 */
function splitLines(ms: MSeries, span: number): Array<[number, number]> {
  const n = ms.items.length;
  const lines: Array<[number, number]> = [];
  let a = 0;
  while (a < n) {
    let used = (a > 0 ? LD.wrapMark : 0) + LD.gap;
    let b = a;
    while (b < n) {
      const add = ms.items[b]!.w + LD.gap;
      const trail = b === n - 1 ? 0 : LD.wrapMark;
      if (b > a && used + add + trail > span) break;
      used += add;
      b++;
    }
    lines.push([a, b]);
    a = b;
  }
  return lines;
}

function placeInstr(m: MInstr, x: number, y: number, legPath: LegPath | undefined, index: number, out: Out): void {
  const node = m.place(x, y, legPath, index);
  out.nodes.push(node);
  out.byId[node.id] = node;
  const inP: PowerRef = { t: 'in', id: node.id };
  const outP: PowerRef = { t: 'out', id: node.id };
  if (node.display === 'box') {
    const bx2 = node.sym.x + node.sym.w;
    // box instructions with status bits: the rung continues from the first status output (EN)
    if (node.status.length > 0) out.wires.push({ x1: bx2, y1: y, x2: x + node.w, y2: y, power: outP });
  } else {
    out.wires.push({ x1: x, y1: y, x2: node.sym.x, y2: y, power: inP });
    out.wires.push({ x1: node.sym.x + node.sym.w, y1: y, x2: x + node.w, y2: y, power: outP });
  }
}

function placeBranch(m: MBranch, x: number, y: number, legPath: LegPath | undefined, index: number, out: Out): void {
  const id = m.el.id;
  const x2 = x + m.w;
  const legYs = m.offsets.map((o) => y + o);
  const node: BranchLayout = withLeg(
    { kind: 'branch' as const, id, x, x2, y, legYs, emptyLegs: m.el.legs.flatMap((leg, k) => (leg.length === 0 ? [k] : [])), top: y - m.top, bottom: y + m.bottom, index },
    legPath,
  );
  out.nodes.push(node);
  out.byId[id] = node;
  const last = legYs.length - 1;
  if (last > 0) {
    out.wires.push({ x1: x, y1: y, x2: x, y2: legYs[last]!, power: { t: 'in', id } });
    for (let k = 0; k < last; k++) {
      const refs = m.legs.slice(k + 1).map((leg) => lastOut(leg, id));
      out.wires.push({ x1: x2, y1: legYs[k]!, x2: x2, y2: legYs[k + 1]!, power: refs.length === 1 ? refs[0]! : { t: 'any', refs } });
    }
  }
  m.legs.forEach((leg, k) => placeSeries(leg, x, x2, legYs[k]!, { branchId: id, leg: k }, { t: 'in', id }, out));
}

// ---------------------------------------------------------------------------
// Rung
// ---------------------------------------------------------------------------

/** Lay out one rung. */
export function layoutRung(rung: Pick<Rung, 'elements' | 'comment'>, opts: LayoutOptions = {}): RungLayout {
  const margin = opts.margin ?? LD.margin;
  const main = measureSeries(rung.elements, opts);
  let natural = margin + Math.max(main.w, 120) + LD.rightPad;
  const avail = opts.width ?? 0;
  const split = opts.wrap === true && avail > 0 && natural > avail && main.items.length > 1 ? splitLines(main, avail - margin - LD.rightPad) : undefined;
  const lineRanges = split && split.length > 1 ? split : undefined;
  if (lineRanges) {
    const need = Math.max(
      ...lineRanges.map(([a, b], k) => rangeWidth(main, a, b) + (k > 0 ? LD.wrapMark : 0) + (k < lineRanges.length - 1 ? LD.wrapMark : 0)),
    );
    natural = margin + need + LD.rightPad;
  }
  const width = Math.ceil(Math.max(avail, natural));
  const railL = margin;
  const railR = width - LD.rightPad;

  let cursor = 0;
  let comment: RungLayout['comment'];
  if (opts.showComment !== false && rung.comment && rung.comment.trim() !== '') {
    const cw = railR - railL - 20;
    const lines = wrapText(rung.comment, cw - 2 * LD.commentPad - 4, 'sans', f.comment.size, LD.commentMaxLines);
    const h = lines.length * LD.commentLine + 2 * LD.commentPad - 2;
    comment = { x: railL + 10, y: 8, w: cw, h, lines };
    cursor = comment.y + h;
  }
  const bodyTop = cursor;
  const out: Out = { nodes: [], byId: {}, wires: [], gaps: [] };
  if (lineRanges) {
    const wraps: WrapMark[] = [];
    const ys: number[] = [];
    const last = lineRanges.length - 1;
    let prevBottom = 0;
    lineRanges.forEach(([a, b], k) => {
      const items = main.items.slice(a, b);
      const top = Math.max(16, ...items.map((i) => i.top));
      const ly = k === 0 ? Math.round(bodyTop + LD.padTop + top) : Math.round(ys[k - 1]! + prevBottom + LD.wrapGap + top);
      ys.push(ly);
      prevBottom = Math.max(12, ...items.map((i) => i.bottom));
      const x0 = k === 0 ? railL : railL + LD.wrapMark;
      const x1 = k === last ? railR : railR - LD.wrapMark;
      if (k > 0) {
        wraps.push({ side: 'in', x: railL, y: ly, n: k });
        // stub from the continuation marker to the line's first wire (lit like that wire)
        out.wires.push({ x1: railL + 10, y1: ly, x2: x0, y2: ly, power: { t: 'in', id: main.items[a]!.el.id } });
      }
      placeRange(main, a, b, x0, x1, ly, undefined, out, k === last);
      if (k < last) {
        wraps.push({ side: 'out', x: x1, y: ly, n: k + 1 });
        out.wires.push({ x1, y1: ly, x2: x1 + 6, y2: ly, power: { t: 'out', id: main.items[b - 1]!.el.id } });
      }
    });
    const height = Math.max(LD.minHeight, Math.ceil(ys[last]! + prevBottom + LD.padBottom));
    return { width, height, railL, railR, y: ys[0]!, bodyTop, ...(comment ? { comment } : {}), ...out, wraps, lines: ys };
  }
  const top = Math.max(main.top, 16);
  const y = Math.round(bodyTop + LD.padTop + top);
  const height = Math.max(LD.minHeight, Math.ceil(y + Math.max(main.bottom, 12) + LD.padBottom));
  placeSeries(main, railL, railR, y, undefined, { t: 'rail' }, out);
  return { width, height, railL, railR, y, bodyTop, ...(comment ? { comment } : {}), ...out, wraps: [], lines: [y] };
}

/** Insertion point nearest to (x, y) — for drag & drop and wire clicks. */
export function nearestGap(layout: RungLayout, x: number, y: number): GapLayout | undefined {
  let best: GapLayout | undefined;
  let bestD = Infinity;
  for (const g of layout.gaps) {
    const dx = x < g.x0 ? g.x0 - x : x > g.x1 ? x - g.x1 : 0;
    const d = dx + Math.abs(y - g.y) * 2.2;
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/** Evaluate a power reference against live element state. */
export function evalPower(p: PowerRef, elements: Record<string, { in: boolean; out: boolean }> | undefined, running: boolean): boolean {
  switch (p.t) {
    case 'rail':
      return running;
    case 'in':
      return elements?.[p.id]?.in === true;
    case 'out':
      return elements?.[p.id]?.out === true;
    case 'any':
      return p.refs.some((r) => evalPower(r, elements, running));
  }
}
