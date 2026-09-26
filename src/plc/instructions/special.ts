/**
 * Special (array/file-shift/sequencer) instructions: BSL BSR SQO FFL FFU.
 * All use a CONTROL structure and act on the false→true transition of the rung (.EN/.EU edge memory).
 */
import { convertAtomic, isAtomic, takeOverflow } from '../convert';
import type { AtomicType, TagValue } from '../types';
import { OperandError, MSG } from './operands';
import type { ControlValue } from './timerCounter';
import type { InstructionDef, OperandSpec, Runtime } from './types';

const control = (): OperandSpec => ({ name: 'Control', types: ['CONTROL'], kind: 'struct', dest: true });
const length = (ctl: number): OperandSpec => ({
  name: 'Length',
  types: ['IMMEDIATE'],
  kind: 'display',
  init: { operand: ctl, member: 'LEN', onEdit: true },
});
const position = (ctl: number): OperandSpec => ({
  name: 'Position',
  types: ['IMMEDIATE'],
  kind: 'display',
  init: { operand: ctl, member: 'POS', onEdit: false },
});

function checkLenPos(c: ControlValue, rt: Runtime, mnemonic: string): void {
  if (c.LEN < 0 || c.POS < 0) {
    rt.majorFault(4, 21, `${mnemonic}: Control data type LEN or POS < 0 (LEN ${c.LEN}, POS ${c.POS}).`);
  }
}

/** Shift `len` bits of a DINT array (starting at `start`) by one position. Returns the unloaded bit. */
function shiftBits(arr: TagValue[], start: number, len: number, input: boolean, left: boolean): boolean {
  const full = Math.floor(len / 32);
  const rem = len % 32;
  let carry = input ? 1 : 0;
  if (left) {
    for (let w = 0; w < full; w++) {
      const v = (arr[start + w] as number) >>> 0;
      const out = v >>> 31;
      arr[start + w] = ((v << 1) | carry) | 0;
      carry = out;
    }
    if (rem > 0) {
      const v = (arr[start + full] as number) >>> 0;
      const mask = (1 << rem) - 1;
      const inside = v & mask;
      const out = (inside >>> (rem - 1)) & 1;
      arr[start + full] = ((v & ~mask) | (((inside << 1) | carry) & mask)) | 0;
      carry = out;
    }
  } else {
    if (rem > 0) {
      const v = (arr[start + full] as number) >>> 0;
      const mask = (1 << rem) - 1;
      const inside = v & mask;
      const out = inside & 1;
      arr[start + full] = ((v & ~mask) | ((inside >>> 1) | (carry << (rem - 1)))) | 0;
      carry = out;
    }
    for (let w = full - 1; w >= 0; w--) {
      const v = (arr[start + w] as number) >>> 0;
      const out = v & 1;
      arr[start + w] = ((v >>> 1) | (carry << 31)) | 0;
      carry = out;
    }
  }
  return carry === 1;
}

function bitShift(mnemonic: 'BSL' | 'BSR'): InstructionDef {
  const left = mnemonic === 'BSL';
  return {
    mnemonic,
    name: left ? 'Bit Shift Left' : 'Bit Shift Right',
    category: 'Special',
    kind: 'output',
    display: 'box',
    operands: [
      { name: 'Array', types: ['DINT'], kind: 'array', elem: ['DINT'], dest: true },
      control(),
      { name: 'Source Bit', types: ['BOOL'], kind: 'bit' },
      length(1),
    ],
    statusBits: ['EN', 'DN', 'ER'],
    summary: left
      ? 'Output: on each false→true transition shifts the bit array one position left (toward higher bits).'
      : 'Output: on each false→true transition shifts the bit array one position right (toward bit 0).',
    details: `**${left ? 'Bit Shift Left' : 'Bit Shift Right'}** — a bit shift register, ideal for tracking parts along a conveyor.

On each **false→true** transition of the rung the first **.LEN** bits of the DINT array move one position
${left ? 'up: bit n → bit n+1, the Source Bit enters bit 0 and the bit shifted out of bit .LEN−1' : 'down: bit n → bit n−1, the Source Bit enters bit .LEN−1 and the bit shifted out of bit 0'}
goes to **.UL** (unload). Then .DN is set.

- Rung-condition-in false: .EN, .DN, .ER cleared, .POS set to 0.
- .LEN larger than the array → major fault T04:C20; negative .LEN → T04:C21.

\`\`\`
XIC(Encoder_Pulse)${mnemonic}(Tracking[0],Track_Ctl,PE_Tall,32);
\`\`\``,
    costUs: 1.0,
    compile(ops, rt) {
      const arr = ops.ref(0);
      const ctl = ops.struct<ControlValue>(1);
      const src = ops.ref(2);
      return {
        exec(rci) {
          const c = ctl();
          if (!rci) {
            c.EN = false;
            c.DN = false;
            c.ER = false;
            c.POS = 0;
            return false;
          }
          if (c.EN) return true;
          c.EN = true;
          checkLenPos(c, rt, mnemonic);
          const loc = arr.arrayLoc();
          const words = loc.arr.length - loc.index;
          if (c.LEN > words * 32) {
            rt.majorFault(4, 20, `${mnemonic}: .LEN ${c.LEN} is larger than the array (${words * 32} bits).`);
          }
          if (c.LEN === 0) {
            c.ER = true;
            return true;
          }
          c.UL = shiftBits(loc.arr, loc.index, c.LEN, src.readB(), left);
          c.DN = true;
          c.ER = false;
          c.POS = c.LEN;
          return true;
        },
        prescan() {
          const c = ctl();
          c.EN = false;
          c.DN = false;
          c.ER = false;
          c.POS = 0;
        },
      };
    },
  };
}

export const BSL = bitShift('BSL');
export const BSR = bitShift('BSR');

export const SQO: InstructionDef = {
  mnemonic: 'SQO',
  name: 'Sequencer Output',
  category: 'Special',
  kind: 'output',
  display: 'box',
  operands: [
    { name: 'Array', types: ['SINT', 'INT', 'DINT'], kind: 'array', elem: ['SINT', 'INT', 'DINT'] },
    { name: 'Mask', types: ['ANY_INT', 'IMMEDIATE'], kind: 'int' },
    { name: 'Dest', types: ['SINT', 'INT', 'DINT'], kind: 'intDest', dest: true },
    control(),
    length(3),
    position(3),
  ],
  statusBits: ['EN', 'DN', 'ER'],
  summary: 'Output: steps through an array of output patterns on each false→true transition (e.g. traffic lights).',
  details: `**Sequencer Output** — a drum sequencer. Each element of the array is an output pattern (one bit per output).

On each **false→true** transition: **.POS** advances by 1 (after .LEN it wraps back to **1**), then
**Dest = (Dest AND NOT Mask) OR (Array[.POS] AND Mask)**. .DN is set when .POS reaches .LEN.

- Array[0] is used only after a RES (position 0) — the sequence runs 1 … .LEN.
- Only the bits set in **Mask** are written to Dest.
- .LEN ≤ 0 or .POS < 0 sets .ER; .POS beyond the array → major fault T04:C20.

Pair it with a self-resetting TON to step on time:

\`\`\`
XIO(Step_Timer.DN)TON(Step_Timer,5000,0);
XIC(Step_Timer.DN)SQO(Light_Steps[0],16#003F,Light_Word,Light_Seq,4,0);
\`\`\``,
  costUs: 1.0,
  compile(ops, rt) {
    const arr = ops.ref(0);
    const mask = ops.num(1);
    const dest = ops.ref(2);
    const ctl = ops.struct<ControlValue>(3);
    return {
      exec(rci) {
        const c = ctl();
        if (!rci) {
          c.EN = false;
          return false;
        }
        if (c.EN) return true;
        c.EN = true;
        if (c.LEN <= 0 || c.POS < 0) {
          c.ER = true;
          return true;
        }
        c.ER = false;
        let pos = c.POS + 1;
        if (pos > c.LEN) pos = 1;
        c.POS = pos;
        const loc = arr.arrayLoc();
        const idx = loc.index + pos;
        if (idx >= loc.arr.length) {
          rt.majorFault(4, 20, `SQO: position ${pos} is beyond the end of the array (${loc.arr.length - loc.index} elements).`);
        }
        const m = mask.readN();
        dest.writeN((dest.readN() & ~m) | ((loc.arr[idx] as number) & m));
        takeOverflow();
        c.DN = pos >= c.LEN;
        return true;
      },
      prescan() {
        ctl().EN = true;
      },
    };
  },
};

const FIFO_ELEM = ['SINT', 'INT', 'DINT', 'REAL'] as const;

export const FFL: InstructionDef = {
  mnemonic: 'FFL',
  name: 'FIFO Load',
  category: 'Special',
  kind: 'output',
  display: 'box',
  operands: [
    { name: 'Source', types: ['ANY_NUM', 'IMMEDIATE'], kind: 'num' },
    { name: 'FIFO', types: [...FIFO_ELEM], kind: 'array', elem: FIFO_ELEM, dest: true },
    control(),
    length(2),
    position(2),
  ],
  statusBits: ['EN', 'DN', 'EM'],
  summary: 'Output: on each false→true transition loads Source into the next free FIFO position.',
  details: `**FIFO Load** — first-in first-out queue (use with **FFU** on the same CONTROL).

On each **false→true** transition, if the FIFO is not full (.POS < .LEN): FIFO[.POS] = Source and .POS + 1.
.DN = full (.POS ≥ .LEN), .EM = empty (.POS = 0).

\`\`\`
XIC(Part_Arrived)FFL(Part_ID,Part_Queue[0],Queue_Ctl,10,0);
XIC(Part_Left)FFU(Part_Queue[0],Leaving_ID,Queue_Ctl,10,0);
\`\`\``,
  costUs: 0.8,
  compile(ops, rt) {
    const src = ops.num(0);
    const fifo = ops.ref(1);
    const ctl = ops.struct<ControlValue>(2);
    const t = fifo.array!.elemType;
    if (!isAtomic(t)) throw new OperandError(`FFL, Operand 1: ${MSG.type}`);
    const at: AtomicType = t;
    return {
      exec(rci) {
        const c = ctl();
        if (!rci) {
          c.EN = false;
          return false;
        }
        if (!c.EN) {
          c.EN = true;
          checkLenPos(c, rt, 'FFL');
          const loc = fifo.arrayLoc();
          if (c.LEN > loc.arr.length - loc.index) {
            rt.majorFault(4, 20, `FFL: .LEN ${c.LEN} is larger than the FIFO array (${loc.arr.length - loc.index} elements).`);
          }
          if (c.POS < c.LEN) {
            loc.arr[loc.index + c.POS] = convertAtomic(at, src.readN());
            takeOverflow();
            c.POS += 1;
          }
        }
        c.DN = c.POS >= c.LEN;
        c.EM = c.POS === 0;
        return true;
      },
      prescan() {
        const c = ctl();
        c.EN = true;
        c.DN = c.POS >= c.LEN;
        c.EM = c.POS === 0;
      },
    };
  },
};

export const FFU: InstructionDef = {
  mnemonic: 'FFU',
  name: 'FIFO Unload',
  category: 'Special',
  kind: 'output',
  display: 'box',
  operands: [
    { name: 'FIFO', types: [...FIFO_ELEM], kind: 'array', elem: FIFO_ELEM, dest: true },
    { name: 'Dest', types: ['SINT', 'INT', 'DINT', 'REAL'], kind: 'numDest', dest: true },
    control(),
    length(2),
    position(2),
  ],
  statusBits: ['EU', 'DN', 'EM'],
  summary: 'Output: on each false→true transition unloads FIFO[0] into Dest and shifts the queue.',
  details: `**FIFO Unload** removes the oldest entry of a FIFO loaded by **FFL** (same CONTROL).

On each **false→true** transition, if the FIFO is not empty: Dest = FIFO[0], every element moves down one
position, the last position is cleared and .POS − 1. .EM = empty, .DN = full. Unloading an empty FIFO leaves
Dest unchanged.

\`\`\`
XIC(Part_Left)FFU(Part_Queue[0],Leaving_ID,Queue_Ctl,10,0);
\`\`\``,
  costUs: 0.8,
  compile(ops, rt) {
    const fifo = ops.ref(0);
    const dest = ops.ref(1);
    const ctl = ops.struct<ControlValue>(2);
    return {
      exec(rci) {
        const c = ctl();
        if (!rci) {
          c.EU = false;
          return false;
        }
        if (!c.EU) {
          c.EU = true;
          checkLenPos(c, rt, 'FFU');
          const loc = fifo.arrayLoc();
          const avail = loc.arr.length - loc.index;
          if (c.LEN > avail) rt.majorFault(4, 20, `FFU: .LEN ${c.LEN} is larger than the FIFO array (${avail} elements).`);
          if (c.POS > 0) {
            const a = loc.arr;
            const s = loc.index;
            dest.writeN(a[s] as number);
            takeOverflow();
            const zero = typeof a[s] === 'boolean' ? false : 0;
            for (let i = 0; i < c.LEN - 1; i++) a[s + i] = a[s + i + 1]!;
            if (c.LEN > 0) a[s + c.LEN - 1] = zero;
            c.POS -= 1;
          }
        }
        c.DN = c.POS >= c.LEN;
        c.EM = c.POS === 0;
        return true;
      },
      prescan() {
        const c = ctl();
        c.EU = true;
        c.DN = c.POS >= c.LEN;
        c.EM = c.POS === 0;
      },
    };
  },
};

export const SPECIAL_INSTRUCTIONS: readonly InstructionDef[] = [BSL, BSR, SQO, FFL, FFU];
