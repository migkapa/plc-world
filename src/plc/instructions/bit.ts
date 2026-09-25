/**
 * Bit instructions: XIC XIO OTE OTL OTU ONS OSR OSF
 * (Logix 5000 Controllers General Instructions Reference Manual, 1756-RM003, "Bit Instructions").
 */
import type { OperandRef } from '../tags';
import type { InstructionDef, OperandSpec } from './types';

const bit = (name: string): OperandSpec => ({ name, types: ['BOOL'], kind: 'bit' });
const bitDest = (name: string): OperandSpec => ({ name, types: ['BOOL'], kind: 'bitDest', dest: true });

/** Read a bit for display without raising a fault (indirect subscript out of range → false). */
export function peekBool(r: OperandRef): boolean {
  if (!r.dynamic) return r.readB();
  try {
    return r.readB();
  } catch {
    return false;
  }
}

export const XIC: InstructionDef = {
  mnemonic: 'XIC',
  name: 'Examine If Closed',
  category: 'Bit',
  kind: 'input',
  display: 'contact',
  operands: [bit('Data Bit')],
  summary: 'Condition: true when the data bit is 1 (ON).',
  details: `**Examine If Closed** asks *"is this bit ON?"* — it is the normally-open contact of ladder logic.

- Rung-condition-in true **and** data bit = 1 → rung-condition-out true.
- Otherwise rung-condition-out false.
- Prescan: rung-condition-out is set to false.

Remember that XIC looks at the **bit in the controller**, not at the field device: a normally-closed
Stop button wired to an input is 1 while it is *not* pressed, so it is examined with XIC.

\`\`\`
XIC(Start_PB)XIC(Stop_PB)OTE(Motor);
\`\`\``,
  costUs: 0.05,
  compile(ops) {
    const b = ops.ref(0);
    return {
      exec(rci, live) {
        if (rci) {
          const v = b.readB();
          live.active = v;
          return v;
        }
        live.active = peekBool(b);
        return false;
      },
      monitor: () => peekBool(b),
    };
  },
};

export const XIO: InstructionDef = {
  mnemonic: 'XIO',
  name: 'Examine If Open',
  category: 'Bit',
  kind: 'input',
  display: 'contact',
  operands: [bit('Data Bit')],
  summary: 'Condition: true when the data bit is 0 (OFF).',
  details: `**Examine If Open** asks *"is this bit OFF?"* — the normally-closed contact of ladder logic.

- Rung-condition-in true **and** data bit = 0 → rung-condition-out true.
- Otherwise rung-condition-out false.
- Prescan: rung-condition-out is set to false.

\`\`\`
XIC(Pump_Request)XIO(Low_Level)OTE(Pump);
\`\`\``,
  costUs: 0.05,
  compile(ops) {
    const b = ops.ref(0);
    return {
      exec(rci, live) {
        if (rci) {
          const v = !b.readB();
          live.active = v;
          return v;
        }
        live.active = !peekBool(b);
        return false;
      },
      monitor: () => !peekBool(b),
    };
  },
};

export const OTE: InstructionDef = {
  mnemonic: 'OTE',
  name: 'Output Energize',
  category: 'Bit',
  kind: 'output',
  display: 'coil',
  operands: [bitDest('Data Bit')],
  summary: 'Output: writes the rung condition to the data bit (1 when true, 0 when false).',
  details: `**Output Energize** copies the rung condition into a bit every scan.

- Rung-condition-in true → data bit set to 1.
- Rung-condition-in false → data bit cleared to 0.
- Prescan: the data bit is cleared.

Because OTE writes the bit on **every** scan, using two OTEs on the same bit means the last one scanned
wins (Studio 5000 warns: *duplicate destructive bit reference*). Use OTL/OTU or a branch instead — e.g. a
seal-in, where the Motor contact in parallel with Start keeps the coil on until Stop opens:

\`\`\`
[XIC(Start_PB),XIC(Motor)]XIC(Stop_PB)OTE(Motor);
\`\`\``,
  costUs: 0.05,
  compile(ops) {
    const b = ops.ref(0);
    return {
      exec(rci, live) {
        b.writeB(rci);
        live.active = rci;
        return rci;
      },
      prescan: () => b.writeB(false),
      monitor: () => peekBool(b),
    };
  },
};

export const OTL: InstructionDef = {
  mnemonic: 'OTL',
  name: 'Output Latch',
  category: 'Bit',
  kind: 'output',
  display: 'coil',
  operands: [bitDest('Data Bit')],
  summary: 'Output: sets the data bit to 1 when the rung is true; the bit stays set (retentive).',
  details: `**Output Latch** sets a bit and leaves it set.

- Rung-condition-in true → data bit set to 1.
- Rung-condition-in false → data bit **not modified**.
- Prescan: the data bit is not modified (latched bits survive a PROG→RUN transition and a power cycle).

Always pair it with an **OTU** that clears the same bit.

\`\`\`
XIC(Alarm_Condition)OTL(Alarm_Latched);
XIC(Reset_PB)OTU(Alarm_Latched);
\`\`\``,
  costUs: 0.05,
  compile(ops) {
    const b = ops.ref(0);
    return {
      exec(rci, live) {
        if (rci) b.writeB(true);
        live.active = peekBool(b);
        return rci;
      },
      monitor: () => peekBool(b),
    };
  },
};

export const OTU: InstructionDef = {
  mnemonic: 'OTU',
  name: 'Output Unlatch',
  category: 'Bit',
  kind: 'output',
  display: 'coil',
  operands: [bitDest('Data Bit')],
  summary: 'Output: clears the data bit to 0 when the rung is true; otherwise leaves it alone.',
  details: `**Output Unlatch** clears a bit that was set with OTL.

- Rung-condition-in true → data bit cleared to 0.
- Rung-condition-in false → data bit **not modified**.
- Prescan: the data bit is not modified.

\`\`\`
XIC(Reset_PB)OTU(Alarm_Latched);
\`\`\``,
  costUs: 0.05,
  compile(ops) {
    const b = ops.ref(0);
    return {
      exec(rci, live) {
        if (rci) b.writeB(false);
        live.active = !peekBool(b);
        return rci;
      },
      monitor: () => !peekBool(b),
    };
  },
};

export const ONS: InstructionDef = {
  mnemonic: 'ONS',
  name: 'One Shot',
  category: 'Bit',
  kind: 'input',
  display: 'contact',
  operands: [bitDest('Storage Bit')],
  summary: 'Condition: true for exactly one scan when the rung goes from false to true.',
  details: `**One Shot** passes power for a single scan on a false→true transition of its rung-condition-in.
The storage bit remembers the previous rung state.

- Rung-condition-in false → storage bit cleared, rung-condition-out false.
- Rung-condition-in true and storage bit 0 → storage bit set, rung-condition-out **true** (one scan).
- Rung-condition-in true and storage bit 1 → rung-condition-out false.
- Prescan: the storage bit is **set** so a rung that is already true does not trigger on the first scan.

Use a unique storage bit for every ONS.

\`\`\`
XIC(Count_PB)ONS(Count_PB_ONS)ADD(Parts,1,Parts);
\`\`\``,
  costUs: 0.06,
  compile(ops) {
    const sb = ops.ref(0);
    return {
      exec(rci, live) {
        if (!rci) {
          sb.writeB(false);
          live.active = false;
          return false;
        }
        const fire = !sb.readB();
        if (fire) sb.writeB(true);
        live.active = fire;
        return fire;
      },
      prescan: () => sb.writeB(true),
    };
  },
};

export const OSR: InstructionDef = {
  mnemonic: 'OSR',
  name: 'One Shot Rising',
  category: 'Bit',
  kind: 'output',
  display: 'box',
  operands: [bitDest('Storage Bit'), bitDest('Output Bit')],
  summary: 'Output: sets the output bit for one scan when the rung goes false→true.',
  details: `**One Shot Rising** sets its **output bit** for one scan when the rung-condition-in goes from false to true.
Unlike ONS it does not interrupt the rung: rung-condition-out follows rung-condition-in.

- Rung-condition-in true, storage bit 0 → storage bit set, output bit **set**.
- Rung-condition-in true, storage bit 1 → output bit cleared.
- Rung-condition-in false → storage bit cleared, output bit cleared.
- Prescan: storage bit set (no trigger on the first scan), output bit cleared.

\`\`\`
XIC(Cycle_Start)OSR(Start_Storage,Start_Pulse);
XIC(Start_Pulse)ADD(Cycles,1,Cycles);
\`\`\``,
  costUs: 0.08,
  compile(ops) {
    const sb = ops.ref(0);
    const ob = ops.ref(1);
    return {
      exec(rci, live) {
        if (!rci) {
          sb.writeB(false);
          ob.writeB(false);
          live.active = false;
          return false;
        }
        const fire = !sb.readB();
        if (fire) sb.writeB(true);
        ob.writeB(fire);
        live.active = fire;
        return true;
      },
      prescan: () => {
        sb.writeB(true);
        ob.writeB(false);
      },
      monitor: () => peekBool(ob),
    };
  },
};

export const OSF: InstructionDef = {
  mnemonic: 'OSF',
  name: 'One Shot Falling',
  category: 'Bit',
  kind: 'output',
  display: 'box',
  operands: [bitDest('Storage Bit'), bitDest('Output Bit')],
  summary: 'Output: sets the output bit for one scan when the rung goes true→false.',
  details: `**One Shot Falling** sets its **output bit** for one scan when the rung-condition-in goes from true to false.

- Rung-condition-in true → storage bit set, output bit cleared.
- Rung-condition-in false, storage bit 1 → storage bit cleared, output bit **set**.
- Rung-condition-in false, storage bit 0 → output bit cleared.
- Prescan: storage bit and output bit cleared.

\`\`\`
XIC(Door_Closed)OSF(Door_Storage,Door_Opened_Pulse);
\`\`\``,
  costUs: 0.08,
  compile(ops) {
    const sb = ops.ref(0);
    const ob = ops.ref(1);
    return {
      exec(rci, live) {
        if (rci) {
          sb.writeB(true);
          ob.writeB(false);
          live.active = false;
          return true;
        }
        const fire = sb.readB();
        if (fire) sb.writeB(false);
        ob.writeB(fire);
        live.active = fire;
        return false;
      },
      prescan: () => {
        sb.writeB(false);
        ob.writeB(false);
      },
      monitor: () => peekBool(ob),
    };
  },
};

export const BIT_INSTRUCTIONS: readonly InstructionDef[] = [XIC, XIO, OTE, OTL, OTU, ONS, OSR, OSF];
