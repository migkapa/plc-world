/**
 * Move/Logical instructions: MOV MVM CLR AND OR XOR NOT BTD COP FLL.
 */
import { byteSize, convertAtomic, intWidth, isAtomic, isNumericType, takeOverflow } from '../convert';
import { deepAssign } from '../tags';
import type { OperandRef } from '../tags';
import type { AtomicType, DataTypeName, TagValue } from '../types';
import { OperandError, MSG } from './operands';
import type { InstructionDef, OperandSpec } from './types';

const num = (name: string): OperandSpec => ({ name, types: ['ANY_NUM', 'IMMEDIATE'], kind: 'num' });
const int = (name: string): OperandSpec => ({ name, types: ['ANY_INT', 'IMMEDIATE'], kind: 'int' });
const numDest = (name = 'Dest'): OperandSpec => ({ name, types: ['SINT', 'INT', 'DINT', 'REAL'], kind: 'numDest', dest: true });
const intDest = (name = 'Dest'): OperandSpec => ({ name, types: ['SINT', 'INT', 'DINT'], kind: 'intDest', dest: true });
const imm = (name: string): OperandSpec => ({ name, types: ['IMMEDIATE'], kind: 'imm' });

export const MOV: InstructionDef = {
  mnemonic: 'MOV',
  name: 'Move',
  category: 'Move/Logical',
  kind: 'output',
  display: 'box',
  operands: [num('Source'), numDest()],
  summary: 'Output: copies Source to Dest (with data type conversion).',
  details: `**Move** copies the Source value into Dest every scan the rung is true.

- REAL → integer rounds to the nearest integer (x.5 rounds to even); a value too large for Dest is
  truncated and sets S:V (minor fault T04:C04).
- S:N and S:Z reflect the value moved.

\`\`\`
XIC(Recipe_Select)MOV(750,Fill_Setpoint);
\`\`\``,
  costUs: 0.1,
  compile(ops, rt) {
    const s = ops.num(0);
    const d = ops.ref(1);
    return {
      exec(rci) {
        if (rci) {
          takeOverflow();
          d.writeN(s.readN());
          rt.arith(d.readN(), takeOverflow());
        }
        return rci;
      },
    };
  },
};

export const MVM: InstructionDef = {
  mnemonic: 'MVM',
  name: 'Masked Move',
  category: 'Move/Logical',
  kind: 'output',
  display: 'box',
  operands: [int('Source'), int('Mask'), intDest()],
  summary: 'Output: copies only the Source bits selected by Mask into Dest.',
  details: `**Masked Move**: **Dest = (Source AND Mask) OR (Dest AND NOT Mask)** — bits where the mask is 0 keep their value.

\`\`\`
MVM(Pattern,16#00FF,Local:2:O.Data);
\`\`\``,
  costUs: 0.12,
  compile(ops, rt) {
    const s = ops.num(0);
    const m = ops.num(1);
    const d = ops.ref(2);
    return {
      exec(rci) {
        if (rci) {
          const mask = m.readN();
          takeOverflow();
          d.writeN((s.readN() & mask) | (d.readN() & ~mask));
          rt.arith(d.readN(), takeOverflow());
        }
        return rci;
      },
    };
  },
};

export const CLR: InstructionDef = {
  mnemonic: 'CLR',
  name: 'Clear',
  category: 'Move/Logical',
  kind: 'output',
  display: 'box',
  operands: [numDest()],
  summary: 'Output: sets Dest to 0.',
  details: `**Clear** writes zero to the destination while the rung is true (S:Z set).

\`\`\`
XIC(Reset_PB)CLR(Batch_Total);
\`\`\``,
  costUs: 0.08,
  compile(ops, rt) {
    const d = ops.ref(0);
    return {
      exec(rci) {
        if (rci) {
          d.writeN(0);
          rt.arith(0, false);
        }
        return rci;
      },
    };
  },
};

function logic2(mnemonic: string, name: string, symbol: string, fn: (a: number, b: number) => number, example: string): InstructionDef {
  return {
    mnemonic,
    name,
    category: 'Move/Logical',
    kind: 'output',
    display: 'box',
    operands: [int('Source A'), int('Source B'), intDest()],
    summary: `Output: Dest = Source A ${symbol} Source B (bit by bit).`,
    details: `**${name}** performs a bitwise ${symbol} of two integers: each bit of Dest = bit of Source A ${symbol} bit of Source B.

\`\`\`
${example}
\`\`\``,
    costUs: 0.1,
    compile(ops, rt) {
      const a = ops.num(0);
      const b = ops.num(1);
      const d = ops.ref(2);
      return {
        exec(rci) {
          if (rci) {
            takeOverflow();
            d.writeN(fn(a.readN(), b.readN()));
            rt.arith(d.readN(), takeOverflow());
          }
          return rci;
        },
      };
    },
  };
}

export const AND = logic2('AND', 'Bitwise AND', 'AND', (a, b) => a & b, 'AND(Local:1:I.Data,16#00FF,Low_Byte);');
export const OR = logic2('OR', 'Bitwise OR', 'OR', (a, b) => a | b, 'OR(Status_Word,2#0100,Status_Word);');
export const XOR = logic2('XOR', 'Bitwise Exclusive OR', 'XOR', (a, b) => a ^ b, 'XOR(Inputs_Now,Inputs_Last,Changed_Bits);');

export const NOT: InstructionDef = {
  mnemonic: 'NOT',
  name: 'Bitwise NOT',
  category: 'Move/Logical',
  kind: 'output',
  display: 'box',
  operands: [int('Source'), intDest()],
  summary: 'Output: Dest = bitwise complement of Source.',
  details: `**Bitwise NOT** inverts every bit: 0 → 1, 1 → 0 (for a DINT, NOT 0 = -1).

\`\`\`
NOT(Local:1:I.Data,Inverted_Inputs);
\`\`\``,
  costUs: 0.1,
  compile(ops, rt) {
    const s = ops.num(0);
    const d = ops.ref(1);
    return {
      exec(rci) {
        if (rci) {
          takeOverflow();
          d.writeN(~s.readN());
          rt.arith(d.readN(), takeOverflow());
        }
        return rci;
      },
    };
  },
};

function wrapTo(width: number, x: number): number {
  return width === 32 ? x | 0 : width === 16 ? (x << 16) >> 16 : (x << 24) >> 24;
}

export const BTD: InstructionDef = {
  mnemonic: 'BTD',
  name: 'Bit Field Distribute',
  category: 'Move/Logical',
  kind: 'output',
  display: 'box',
  operands: [int('Source'), imm('Source Bit'), intDest('Destination'), imm('Destination Bit'), imm('Length')],
  summary: 'Output: copies a group of bits from Source into Dest at another bit position.',
  details: `**Bit Field Distribute** copies **Length** bits starting at **Source Bit** of Source into Destination starting
at **Destination Bit**. Other destination bits are unchanged; bits beyond the destination size are lost.

\`\`\`
BTD(Local:1:I.Data,4,Selector_Value,0,4);
\`\`\``,
  costUs: 0.15,
  compile(ops) {
    const s = ops.num(0);
    const sBit = ops.literal(1)!;
    const d = ops.ref(2);
    const dBit = ops.literal(3)!;
    const len = ops.literal(4)!;
    if (sBit < 0 || sBit > 31) throw new OperandError(`BTD, Operand 1: Source bit ${sBit} is out of range (0-31).`);
    if (dBit < 0 || dBit > 31) throw new OperandError(`BTD, Operand 3: Destination bit ${dBit} is out of range (0-31).`);
    if (len < 1 || len > 32) throw new OperandError(`BTD, Operand 4: Length ${len} is out of range (1-32).`);
    const fieldMask = len === 32 ? 0xffffffff : (1 << len) - 1;
    const destMask = (fieldMask << dBit) | 0;
    const width = intWidth(d.type) || 32;
    return {
      exec(rci) {
        if (rci) {
          const bits = (s.readN() >>> sBit) & fieldMask;
          const x = d.readN();
          d.writeN(wrapTo(width, (x & ~destMask) | ((bits << dBit) & destMask)));
          takeOverflow();
        }
        return rci;
      },
    };
  },
};

// ---------------------------------------------------------------------------
// COP / FLL
// ---------------------------------------------------------------------------

interface Span {
  arr: TagValue[] | null;
  start: number;
  avail: number;
}

function span(r: OperandRef, out: Span): Span {
  if (r.array) {
    const loc = r.arrayLoc();
    out.arr = loc.arr;
    out.start = loc.index;
    out.avail = loc.arr.length - loc.index;
  } else {
    out.arr = null;
    out.start = 0;
    out.avail = 1;
  }
  return out;
}

function elemType(r: OperandRef): DataTypeName {
  return r.array ? r.array.elemType : r.type;
}

function writeBytes(view: DataView, offset: number, type: DataTypeName, v: number): void {
  switch (type) {
    case 'SINT':
      view.setInt8(offset, v);
      break;
    case 'INT':
      view.setInt16(offset, v, true);
      break;
    case 'DINT':
      view.setInt32(offset, v, true);
      break;
    default:
      view.setFloat32(offset, v, true);
  }
}

function readBytes(view: DataView, offset: number, type: DataTypeName): number {
  switch (type) {
    case 'SINT':
      return view.getInt8(offset);
    case 'INT':
      return view.getInt16(offset, true);
    case 'DINT':
      return view.getInt32(offset, true);
    default:
      return view.getFloat32(offset, true);
  }
}

export const COP: InstructionDef = {
  mnemonic: 'COP',
  name: 'Copy File',
  category: 'Move/Logical',
  kind: 'output',
  display: 'box',
  operands: [
    { name: 'Source', types: ['ANY'], kind: 'any' },
    { name: 'Dest', types: ['ANY'], kind: 'any', dest: true },
    { name: 'Length', types: ['DINT', 'IMMEDIATE'], kind: 'int' },
  ],
  summary: 'Output: copies Length elements from Source to Dest (a raw memory copy, no conversion).',
  details: `**Copy File** copies a block of data, e.g. a recipe from an array into the working tags.

- **Length** is the number of **Dest** elements to copy. The copy stops at the end of either array.
- Same data types: element by element (structures such as TIMER or UDTs are copied whole).
- Different numeric types: the **bytes** are copied without conversion — COP of the REAL 1.0 into a DINT
  gives 1065353216 (the IEEE-754 bit pattern). Use MOV when you want conversion.

\`\`\`
XIC(Load_Recipe)COP(Recipes[Recipe_No],Active_Recipe,1);
\`\`\``,
  costUs: 0.6,
  compile(ops) {
    const s = ops.ref(0);
    const d = ops.ref(1);
    const n = ops.num(2);
    const sType = elemType(s);
    const dType = elemType(d);
    const same = sType.toUpperCase() === dType.toUpperCase();
    const bytes = !same && isNumericType(sType) && isNumericType(dType);
    if (!same && !bytes) throw new OperandError(`COP, Operand 1: ${MSG.type}`);
    const sSize = byteSize(sType);
    const dSize = byteSize(dType);
    const ss: Span = { arr: null, start: 0, avail: 0 };
    const ds: Span = { arr: null, start: 0, avail: 0 };
    return {
      exec(rci) {
        if (!rci) return false;
        const len = n.readN();
        if (len <= 0) return true;
        span(s, ss);
        span(d, ds);
        if (same) {
          const count = Math.min(len, ss.avail, ds.avail);
          if (ss.arr === ds.arr && ss.start < ds.start) {
            for (let i = count - 1; i >= 0; i--) copyElem(ss, ds, i, s, d);
          } else {
            for (let i = 0; i < count; i++) copyElem(ss, ds, i, s, d);
          }
          return true;
        }
        const count = Math.min(len, ds.avail);
        const srcCount = Math.min(ss.avail, Math.ceil((count * dSize) / sSize));
        const buf = new DataView(new ArrayBuffer(Math.max(count * dSize, srcCount * sSize)));
        for (let i = 0; i < srcCount; i++) {
          const v = ss.arr ? (ss.arr[ss.start + i] as number) : s.readN();
          writeBytes(buf, i * sSize, sType, v);
        }
        for (let i = 0; i < count; i++) {
          const v = readBytes(buf, i * dSize, dType);
          if (ds.arr) ds.arr[ds.start + i] = v;
          else d.writeN(v);
        }
        takeOverflow();
        return true;
      },
    };
  },
};

function copyElem(ss: Span, ds: Span, i: number, s: OperandRef, d: OperandRef): void {
  const v = ss.arr ? ss.arr[ss.start + i]! : s.value();
  if (ds.arr) {
    const cur = ds.arr[ds.start + i]!;
    if (typeof cur === 'object') deepAssign(cur, v);
    else ds.arr[ds.start + i] = v;
  } else {
    // Same-type structure copy: raw member-wise copy (no per-member conversion needed).
    const cur = d.value();
    if (typeof cur === 'object') deepAssign(cur, v);
    else d.assign(v);
  }
}

export const FLL: InstructionDef = {
  mnemonic: 'FLL',
  name: 'File Fill',
  category: 'Move/Logical',
  kind: 'output',
  display: 'box',
  operands: [
    num('Source'),
    { name: 'Dest', types: ['SINT', 'INT', 'DINT', 'REAL', 'BOOL'], kind: 'array', dest: true, elem: ['SINT', 'INT', 'DINT', 'REAL', 'BOOL'] },
    { name: 'Length', types: ['DINT', 'IMMEDIATE'], kind: 'int' },
  ],
  summary: 'Output: fills Length array elements with the Source value.',
  details: `**File Fill** writes the same value into a block of array elements — typically to clear an array.

The fill starts at the Dest element and stops at the end of the array.

\`\`\`
XIC(Clear_Log)FLL(0,Reject_Log[0],50);
\`\`\``,
  costUs: 0.5,
  compile(ops) {
    const s = ops.num(0);
    const d = ops.ref(1);
    const n = ops.num(2);
    const t = elemType(d);
    if (!isAtomic(t)) throw new OperandError(`FLL, Operand 1: ${MSG.type}`);
    const at: AtomicType = t;
    const ds: Span = { arr: null, start: 0, avail: 0 };
    return {
      exec(rci) {
        if (!rci) return false;
        const len = n.readN();
        span(d, ds);
        const v = convertAtomic(at, s.readN());
        takeOverflow();
        const count = Math.min(len, ds.avail);
        for (let i = 0; i < count; i++) ds.arr![ds.start + i] = v;
        return true;
      },
    };
  },
};

export const MOVE_INSTRUCTIONS: readonly InstructionDef[] = [MOV, MVM, CLR, AND, OR, XOR, NOT, BTD, COP, FLL];
