/**
 * Timer and counter instructions: TON TOF RTO CTU CTD RES.
 *
 * Timers accumulate simulated milliseconds using a per-timer start timestamp (the hidden part of
 * a Logix TIMER), exactly like the controller's free-running clock: the first enabled scan only
 * records the time, each later scan adds the time elapsed since the previous execution. A timer
 * in a routine that is not scanned for a while therefore "jumps" when it is scanned again — the
 * same gotcha as on a real controller.
 */
import { DINT_MAX, DINT_MIN } from '../convert';
import type { CounterValue, TimerValue } from '../types';
import type { InstructionDef, OperandSpec, Runtime } from './types';

type ControlValue = {
  LEN: number;
  POS: number;
  EN: boolean;
  EU: boolean;
  DN: boolean;
  EM: boolean;
  ER: boolean;
  UL: boolean;
  IN: boolean;
  FD: boolean;
};

const timerOp: OperandSpec = { name: 'Timer', types: ['TIMER'], kind: 'struct', dest: true };
const counterOp: OperandSpec = { name: 'Counter', types: ['COUNTER'], kind: 'struct', dest: true };
const presetOp = (target: number): OperandSpec => ({
  name: 'Preset',
  types: ['IMMEDIATE'],
  kind: 'display',
  init: { operand: target, member: 'PRE', onEdit: true },
});
const accumOp = (target: number): OperandSpec => ({
  name: 'Accum',
  types: ['IMMEDIATE'],
  kind: 'display',
  init: { operand: target, member: 'ACC', onEdit: false },
});

function checkTimer(t: TimerValue, rt: Runtime): void {
  if (t.PRE < 0 || t.ACC < 0) {
    rt.majorFault(4, 34, `A timer instruction has a negative preset or accumulated value (PRE ${t.PRE}, ACC ${t.ACC}).`);
  }
}

/** Advance a timer's ACC by the time elapsed since its last execution (first execution only stamps). */
function accumulate(t: TimerValue, rt: Runtime, first: boolean): void {
  const stamps = rt.timerStamps;
  const now = rt.now;
  const last = stamps.get(t);
  if (first || last === undefined) {
    stamps.set(t, now);
    return;
  }
  // Whole milliseconds are accumulated; the fractional remainder stays in the timestamp.
  const whole = Math.floor(now - last);
  const acc = t.ACC + whole;
  t.ACC = acc > DINT_MAX ? DINT_MAX : acc;
  stamps.set(t, last + whole);
}

const TIMER_DETAILS_BITS = `Timer bits: **.EN** = rung-condition-in, **.TT** = timing, **.DN** = done. **.PRE** and **.ACC** are in milliseconds.
A negative .PRE or .ACC causes major fault **T04:C34**.`;

export const TON: InstructionDef = {
  mnemonic: 'TON',
  name: 'Timer On Delay',
  category: 'Timer/Counter',
  kind: 'output',
  display: 'box',
  operands: [timerOp, presetOp(0), accumOp(0)],
  statusBits: ['EN', 'DN'],
  summary: 'Output: times while the rung is true; .DN turns on when .ACC reaches .PRE. Resets when the rung goes false.',
  details: `**Timer On Delay** — "on after a delay".

- Rung-condition-in true: .EN set; the timer accumulates while .ACC < .PRE (.TT on). When .ACC reaches .PRE,
  .DN is set, .TT is cleared and .ACC stops at .PRE.
- Rung-condition-in false: .EN, .TT and .DN cleared, **.ACC reset to 0**.
- Prescan: .EN, .TT, .DN cleared and .ACC set to 0.

${TIMER_DETAILS_BITS}

\`\`\`
XIC(Start_PB)TON(Start_Delay,3000,0);
XIC(Start_Delay.DN)OTE(Motor);
\`\`\``,
  costUs: 0.2,
  compile(ops, rt) {
    const tm = ops.struct<TimerValue>(0);
    return {
      exec(rci) {
        const t = tm();
        if (!rci) {
          t.EN = false;
          t.TT = false;
          t.DN = false;
          t.ACC = 0;
          return false;
        }
        checkTimer(t, rt);
        if (!t.DN) {
          const first = !t.EN;
          t.EN = true;
          accumulate(t, rt, first);
          if (t.ACC >= t.PRE) {
            t.ACC = t.PRE;
            t.DN = true;
            t.TT = false;
          } else t.TT = true;
        } else {
          t.EN = true;
          t.TT = false;
        }
        return true;
      },
      prescan() {
        const t = tm();
        t.EN = false;
        t.TT = false;
        t.DN = false;
        t.ACC = 0;
      },
    };
  },
};

export const TOF: InstructionDef = {
  mnemonic: 'TOF',
  name: 'Timer Off Delay',
  category: 'Timer/Counter',
  kind: 'output',
  display: 'box',
  operands: [timerOp, presetOp(0), accumOp(0)],
  statusBits: ['EN', 'DN'],
  summary: 'Output: .DN is on while the rung is true and stays on for .PRE ms after the rung goes false.',
  details: `**Timer Off Delay** — "off after a delay" (e.g. run a cooling fan for 30 s after the heater stops).

- Rung-condition-in true: .EN and .DN set, .TT cleared, .ACC reset to 0.
- Rung-condition-in false: .EN cleared; if .DN is set the timer runs (.TT on) until .ACC reaches .PRE,
  then .DN and .TT are cleared.
- Prescan: .EN, .TT, .DN cleared and **.ACC set to .PRE** (so the output stays off after a mode change).

${TIMER_DETAILS_BITS}

\`\`\`
XIC(Heater)TOF(Fan_Overrun,30000,0);
XIC(Fan_Overrun.DN)OTE(Cooling_Fan);
\`\`\``,
  costUs: 0.2,
  compile(ops, rt) {
    const tm = ops.struct<TimerValue>(0);
    return {
      exec(rci) {
        const t = tm();
        if (rci) {
          t.EN = true;
          t.TT = false;
          t.DN = true;
          t.ACC = 0;
          return true;
        }
        t.EN = false;
        if (!t.DN) {
          t.TT = false;
          return false;
        }
        checkTimer(t, rt);
        const first = !t.TT;
        t.TT = true;
        accumulate(t, rt, first);
        if (t.ACC >= t.PRE) {
          t.ACC = t.PRE;
          t.DN = false;
          t.TT = false;
        }
        return false;
      },
      prescan() {
        const t = tm();
        t.EN = false;
        t.TT = false;
        t.DN = false;
        t.ACC = t.PRE;
      },
    };
  },
};

export const RTO: InstructionDef = {
  mnemonic: 'RTO',
  name: 'Retentive Timer On',
  category: 'Timer/Counter',
  kind: 'output',
  display: 'box',
  operands: [timerOp, presetOp(0), accumOp(0)],
  statusBits: ['EN', 'DN'],
  summary: 'Output: like TON but keeps .ACC when the rung goes false. Reset it with RES.',
  details: `**Retentive Timer On** accumulates time across interruptions — e.g. total run hours before maintenance.

- Rung-condition-in true: .EN set, accumulates while .ACC < .PRE (.TT on); at .PRE, .DN set.
- Rung-condition-in false: .EN and .TT cleared, **.ACC and .DN retained**.
- Prescan: .EN, .TT and .DN cleared; .ACC is not modified.
- Only a **RES** instruction (or writing .ACC) clears the accumulated value.

${TIMER_DETAILS_BITS}

\`\`\`
XIC(Pump_Running)RTO(Pump_Hours,3600000,0);
XIC(Maint_Reset)RES(Pump_Hours);
\`\`\``,
  costUs: 0.2,
  compile(ops, rt) {
    const tm = ops.struct<TimerValue>(0);
    return {
      exec(rci) {
        const t = tm();
        if (!rci) {
          t.EN = false;
          t.TT = false;
          return false;
        }
        checkTimer(t, rt);
        if (!t.DN) {
          const first = !t.EN;
          t.EN = true;
          accumulate(t, rt, first);
          if (t.ACC >= t.PRE) {
            t.ACC = t.PRE;
            t.DN = true;
            t.TT = false;
          } else t.TT = true;
        } else {
          t.EN = true;
          t.TT = false;
        }
        return true;
      },
      prescan() {
        const t = tm();
        t.EN = false;
        t.TT = false;
        t.DN = false;
      },
    };
  },
};

const COUNTER_BITS = `Counter bits: **.CU**/**.CD** = count enable (edge memory), **.DN** = .ACC ≥ .PRE,
**.OV** = counted up past 2,147,483,647 (wraps to -2,147,483,648), **.UN** = counted down past -2,147,483,648.`;

export const CTU: InstructionDef = {
  mnemonic: 'CTU',
  name: 'Count Up',
  category: 'Timer/Counter',
  kind: 'output',
  display: 'box',
  operands: [counterOp, presetOp(0), accumOp(0)],
  statusBits: ['CU', 'DN'],
  summary: 'Output: adds 1 to .ACC on each false→true transition of the rung.',
  details: `**Count Up** counts rising edges of its rung-condition-in.

- Rung-condition-in true and .CU = 0 (a new transition): .ACC + 1. If .ACC wraps past 2,147,483,647:
  .UN is cleared if it was set, otherwise .OV is set.
- Rung-condition-in true: .CU set; .DN = (.ACC ≥ .PRE).
- Rung-condition-in false: .CU cleared.
- Prescan: **.CU set** so a rung that is already true is not counted on the first scan.

The count is retentive; use **RES** to clear it.

${COUNTER_BITS}

\`\`\`
XIC(PE_Exit)CTU(Box_Count,12,0);
XIC(Box_Count.DN)OTE(Case_Full);
\`\`\``,
  costUs: 0.2,
  compile(ops) {
    const cn = ops.struct<CounterValue>(0);
    return {
      exec(rci) {
        const c = cn();
        if (!rci) {
          c.CU = false;
          return false;
        }
        if (!c.CU) {
          if (c.ACC >= DINT_MAX) {
            c.ACC = DINT_MIN;
            if (c.UN) c.UN = false;
            else c.OV = true;
          } else c.ACC += 1;
        }
        c.CU = true;
        c.DN = c.ACC >= c.PRE;
        return true;
      },
      prescan() {
        cn().CU = true;
      },
    };
  },
};

export const CTD: InstructionDef = {
  mnemonic: 'CTD',
  name: 'Count Down',
  category: 'Timer/Counter',
  kind: 'output',
  display: 'box',
  operands: [counterOp, presetOp(0), accumOp(0)],
  statusBits: ['CD', 'DN'],
  summary: 'Output: subtracts 1 from .ACC on each false→true transition of the rung.',
  details: `**Count Down** — usually paired with a CTU on the **same COUNTER** (e.g. cars in / cars out).

- Rung-condition-in true and .CD = 0: .ACC − 1. If .ACC wraps past -2,147,483,648:
  .OV is cleared if it was set, otherwise .UN is set.
- Rung-condition-in true: .CD set; .DN = (.ACC ≥ .PRE).
- Rung-condition-in false: .CD cleared.
- Prescan: **.CD set**.

${COUNTER_BITS}

\`\`\`
XIC(Entry_PE)ONS(Entry_ONS)CTU(Cars,12,0);
XIC(Exit_PE)ONS(Exit_ONS)CTD(Cars,12,0);
XIC(Cars.DN)OTE(Full_Sign);
\`\`\``,
  costUs: 0.2,
  compile(ops) {
    const cn = ops.struct<CounterValue>(0);
    return {
      exec(rci) {
        const c = cn();
        if (!rci) {
          c.CD = false;
          return false;
        }
        if (!c.CD) {
          if (c.ACC <= DINT_MIN) {
            c.ACC = DINT_MAX;
            if (c.OV) c.OV = false;
            else c.UN = true;
          } else c.ACC -= 1;
        }
        c.CD = true;
        c.DN = c.ACC >= c.PRE;
        return true;
      },
      prescan() {
        cn().CD = true;
      },
    };
  },
};

export const RES: InstructionDef = {
  mnemonic: 'RES',
  name: 'Reset',
  category: 'Timer/Counter',
  kind: 'output',
  display: 'box',
  operands: [{ name: 'Structure', types: ['TIMER', 'COUNTER', 'CONTROL'], kind: 'struct', dest: true }],
  summary: 'Output: resets a TIMER, COUNTER or CONTROL structure when the rung is true.',
  details: `**Reset** clears a structure while its rung is true:

- TIMER: .ACC = 0, .EN .TT .DN cleared.
- COUNTER: .ACC = 0, .OV .UN .DN cleared (.CU/.CD keep their edge memory).
- CONTROL: .POS = 0, .EN .EU .DN .EM .ER .UL .IN .FD cleared.

Do not RES a TON that is still enabled — it restarts timing on the next scan.

\`\`\`
XIC(Reset_PB)RES(Box_Count);
\`\`\``,
  costUs: 0.12,
  compile(ops, rt) {
    const r = ops.ref(0);
    const kind = r.type.toUpperCase();
    if (kind === 'TIMER') {
      const tm = ops.struct<TimerValue>(0);
      return {
        exec(rci) {
          if (rci) {
            const t = tm();
            t.ACC = 0;
            t.EN = false;
            t.TT = false;
            t.DN = false;
            rt.timerStamps.delete(t);
          }
          return rci;
        },
      };
    }
    if (kind === 'COUNTER') {
      const cn = ops.struct<CounterValue>(0);
      return {
        exec(rci) {
          if (rci) {
            const c = cn();
            c.ACC = 0;
            c.OV = false;
            c.UN = false;
            c.DN = false;
          }
          return rci;
        },
      };
    }
    const ct = ops.struct<ControlValue>(0);
    return {
      exec(rci) {
        if (rci) {
          const c = ct();
          c.POS = 0;
          c.EN = c.EU = c.DN = c.EM = c.ER = c.UL = c.IN = c.FD = false;
        }
        return rci;
      },
    };
  },
};

export type { ControlValue };
export const TIMER_COUNTER_INSTRUCTIONS: readonly InstructionDef[] = [TON, TOF, RTO, CTU, CTD, RES];
