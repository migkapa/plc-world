/**
 * Studio 5000 "neutral text" (ASCII rung text) parser & serializer.
 *
 *   XIC(Start_PB)[XIC(Motor),XIC(Jog_PB)]XIO(Stop_PB)OTE(Motor);
 *   TON(Timer1,5000,0);
 *   [XIC(A) ,XIC(B) ]OTE(C);      <- the L5X export style (spaces before commas) is accepted too
 *
 * Grammar (whitespace-insensitive between tokens):
 *   rung     := series ';'?
 *   series   := element*
 *   element  := instr | branch
 *   instr    := MNEMONIC '(' operands? ')'   |  MNEMONIC      (no-operand instr, e.g. AFI, NOP)
 *   branch   := '[' series (',' series)* ']'
 *   operands := operand (',' operand)*      (operands may contain [..] indexes, (..) groups, dots, colons)
 */
import { nanoid } from 'nanoid';
import type { BranchNode, InstructionNode, Rung, RungElement } from './types';

export class NeutralTextError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(`${message} (at character ${position + 1})`);
    this.name = 'NeutralTextError';
    this.position = position;
  }
}

/** New unique element/rung id. */
export function newId(prefix = 'e'): string {
  return `${prefix}_${nanoid(8)}`;
}

class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  private skipWs() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  private peek(): string | undefined {
    this.skipWs();
    return this.src[this.pos];
  }

  parseRung(): RungElement[] {
    const elements = this.parseSeries();
    this.skipWs();
    if (this.src[this.pos] === ';') this.pos++;
    this.skipWs();
    if (this.pos < this.src.length) {
      throw new NeutralTextError(`Unexpected '${this.src[this.pos]}'`, this.pos);
    }
    return elements;
  }

  /** Parse rungs separated by ';'. */
  parseMany(): RungElement[][] {
    const rungs: RungElement[][] = [];
    for (;;) {
      this.skipWs();
      if (this.pos >= this.src.length) break;
      const elements = this.parseSeries();
      this.skipWs();
      if (this.src[this.pos] === ';') {
        this.pos++;
      } else if (this.pos < this.src.length) {
        throw new NeutralTextError(`Unexpected '${this.src[this.pos]}'`, this.pos);
      }
      rungs.push(elements);
    }
    return rungs;
  }

  private parseSeries(): RungElement[] {
    const out: RungElement[] = [];
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === ';' || c === ',' || c === ']') return out;
      if (c === '[') out.push(this.parseBranch());
      else out.push(this.parseInstr());
    }
  }

  private parseBranch(): BranchNode {
    const start = this.pos;
    this.pos++; // '['
    const legs: RungElement[][] = [this.parseSeries()];
    for (;;) {
      const c = this.peek();
      if (c === ',') {
        this.pos++;
        legs.push(this.parseSeries());
      } else if (c === ']') {
        this.pos++;
        break;
      } else {
        throw new NeutralTextError("Unterminated branch: expected ',' or ']'", c === undefined ? start : this.pos);
      }
    }
    return { kind: 'branch', id: newId('b'), legs };
  }

  private parseInstr(): InstructionNode {
    this.skipWs();
    const start = this.pos;
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.pos));
    if (!m) throw new NeutralTextError(`Expected an instruction mnemonic, found '${this.src[this.pos]}'`, this.pos);
    this.pos += m[0].length;
    const op = m[0].toUpperCase();
    const operands: string[] = [];
    this.skipWs();
    if (this.src[this.pos] === '(') {
      this.pos++;
      let depthParen = 0;
      let depthBracket = 0;
      let cur = '';
      for (;;) {
        if (this.pos >= this.src.length) throw new NeutralTextError(`Unterminated operand list for ${op}`, start);
        const ch = this.src[this.pos]!;
        if (ch === '(') depthParen++;
        else if (ch === '[') depthBracket++;
        else if (ch === ']') depthBracket--;
        else if (ch === ')') {
          if (depthParen === 0) {
            this.pos++;
            break;
          }
          depthParen--;
        } else if (ch === ',' && depthParen === 0 && depthBracket === 0) {
          operands.push(cur.trim());
          cur = '';
          this.pos++;
          continue;
        }
        cur += ch;
        this.pos++;
      }
      if (cur.trim() !== '' || operands.length > 0) operands.push(cur.trim());
    }
    return { kind: 'instr', id: newId('i'), op, operands };
  }
}

/** Parse the text of a single rung into its series element list. */
export function parseRungText(text: string): RungElement[] {
  return new Parser(text).parseRung();
}

/** Parse a single rung into a Rung object (new ids). */
export function parseRung(text: string, comment?: string): Rung {
  return { id: newId('r'), comment, elements: parseRungText(text) };
}

/** Parse several rungs separated by ';' (e.g. a pasted routine). */
export function parseRungs(text: string): Rung[] {
  return new Parser(text).parseMany().map((elements) => ({ id: newId('r'), elements }));
}

/** Serialize a series element list. */
export function serializeElements(elements: RungElement[]): string {
  return elements
    .map((el) =>
      el.kind === 'instr' ? `${el.op}(${el.operands.join(',')})` : `[${el.legs.map(serializeElements).join(',')}]`,
    )
    .join('');
}

/** Serialize a rung to neutral text, always terminated with ';'. */
export function serializeRung(rung: Pick<Rung, 'elements'>): string {
  return `${serializeElements(rung.elements)};`;
}

/** Instructions that take no operands (serialized as e.g. `AFI()`; the parser also accepts a bare `AFI`). */
export const NO_OPERAND_MNEMONICS = new Set(['AFI', 'NOP', 'RET', 'TND', 'MCR', 'EOT']);

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

/** Depth-first visit of every element (instructions and branches) in a series list. */
export function walkElements(
  elements: RungElement[],
  visit: (el: RungElement, parent: RungElement[], index: number) => void,
): void {
  elements.forEach((el, i) => {
    visit(el, elements, i);
    if (el.kind === 'branch') el.legs.forEach((leg) => walkElements(leg, visit));
  });
}

/** All instructions of a rung in left-to-right, top-to-bottom order. */
export function instructionsOf(elements: RungElement[]): InstructionNode[] {
  const out: InstructionNode[] = [];
  walkElements(elements, (el) => {
    if (el.kind === 'instr') out.push(el);
  });
  return out;
}

/** Find an element by id; returns the containing series list and index. */
export function findElement(
  elements: RungElement[],
  id: string,
): { element: RungElement; parent: RungElement[]; index: number } | undefined {
  let found: { element: RungElement; parent: RungElement[]; index: number } | undefined;
  walkElements(elements, (el, parent, index) => {
    if (!found && el.id === id) found = { element: el, parent, index };
  });
  return found;
}

/** Deep clone a series list assigning fresh ids (for copy/paste). */
export function cloneElements(elements: RungElement[]): RungElement[] {
  return elements.map((el) =>
    el.kind === 'instr'
      ? { kind: 'instr', id: newId('i'), op: el.op, operands: [...el.operands] }
      : { kind: 'branch', id: newId('b'), legs: el.legs.map(cloneElements) },
  );
}

/** Deep clone a rung with fresh ids. */
export function cloneRung(rung: Rung): Rung {
  return { id: newId('r'), comment: rung.comment, elements: cloneElements(rung.elements) };
}
