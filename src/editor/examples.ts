/**
 * Neutral-text usage examples for the instruction help cards (headless).
 *
 * The single source of truth is the instruction's own teaching text (`details` in
 * src/plc/instructions): the example is the first rung of its code block that uses the instruction, so
 * the help card's Example block (and its mini ladder) always matches the explanation above it.
 */
import { INSTRUCTION_DEFS } from '@/plc/instructions';
import { instructionsOf, parseRung } from '@/plc/neutralText';

/** Rungs of the fenced code blocks in an instruction's details markdown. */
export function detailsRungs(details: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (details ?? '').matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    for (const line of m[1]!.split('\n')) {
      const t = line.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function usesInstruction(rung: string, op: string): boolean {
  try {
    return instructionsOf(parseRung(rung).elements).some((i) => i.op === op);
  } catch {
    return false;
  }
}

const cache = new Map<string, string>();

/** A neutral-text rung showing the instruction in context. */
export function exampleFor(mnemonic: string): string {
  const op = mnemonic.toUpperCase();
  const hit = cache.get(op);
  if (hit !== undefined) return hit;
  const def = INSTRUCTION_DEFS[op];
  let out: string;
  if (!def) out = `${op}();`;
  else {
    const fromDetails = detailsRungs(def.details).find((r) => usesInstruction(r, op));
    if (fromDetails) out = fromDetails;
    else {
      // no worked example in the metadata: a generic one from the operand names
      const operands = def.operands.map((o) => {
        if (o.kind === 'display' || o.kind === 'imm') return '0';
        if (o.kind === 'struct') return `My_${String(o.types[0] ?? 'Tag')}`;
        return o.name.replace(/\s+/g, '_');
      });
      const instr = `${op}(${operands.join(',')})`;
      out = def.kind === 'input' ? `${instr}OTE(Output);` : `XIC(Enable)${instr};`;
    }
  }
  cache.set(op, out);
  return out;
}
