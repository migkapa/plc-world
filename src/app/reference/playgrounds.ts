/**
 * "Try it" playgrounds for the instruction reference: one small program per instruction, the inputs the
 * learner can drive, the tags/bits drawn in the timing diagram and a few things to try. Headless (no React).
 *
 * Every program runs on a real simulated controller (trainer bench hardware) — see Playground.tsx.
 * `playgrounds.test.ts` checks that each one verifies cleanly.
 */
import type { TagDef } from '../../plc/types';

export interface PlaygroundInput {
  tag: string;
  /** bool: toggle + tap buttons; number: slider/field; bits: 8 bit toggles of an integer. */
  kind: 'bool' | 'number' | 'bits';
  label?: string;
  /** For bool inputs: show a hold-to-press button instead of a toggle. */
  momentary?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface PlaygroundTrace {
  tag: string;
  kind: 'bool' | 'number';
  label?: string;
  /** Number traces: fixed vertical range (default: auto from the visible window). */
  min?: number;
  max?: number;
  /** Value display: decimal (default), binary (8 low bits) or REAL with 1 decimal. */
  format?: 'dec' | 'bin' | 'real';
}

export interface PlaygroundDef {
  rungs: string[];
  comments?: Array<string | undefined>;
  tags: TagDef[];
  /** Extra routines of MainProgram (subroutines for JSR/SBR/RET), shown read-only. */
  routines?: Array<{ name: string; rungs: string[] }>;
  inputs: PlaygroundInput[];
  traces: PlaygroundTrace[];
  /** Suggestions shown next to the playground (markdown inline). */
  tryIt: string[];
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

const bool = (name: string, initial = false, description?: string): TagDef => ({ name, dataType: 'BOOL', initial, ...(description ? { description } : {}) });
const dint = (name: string, initial = 0, description?: string): TagDef => ({ name, dataType: 'DINT', initial, ...(description ? { description } : {}) });
const real = (name: string, initial = 0, description?: string): TagDef => ({ name, dataType: 'REAL', initial, ...(description ? { description } : {}) });
const timer = (name: string, description?: string): TagDef => ({ name, dataType: 'TIMER', ...(description ? { description } : {}) });
const counter = (name: string, description?: string): TagDef => ({ name, dataType: 'COUNTER', ...(description ? { description } : {}) });
const control = (name: string): TagDef => ({ name, dataType: 'CONTROL' });
const dintArr = (name: string, values: number[]): TagDef => ({ name, dataType: 'DINT', dims: values.length, initial: values });

const bin = (tag: string, label?: string): PlaygroundInput => ({ tag, kind: 'bool', ...(label ? { label } : {}) });
const tap = (tag: string, label?: string): PlaygroundInput => ({ tag, kind: 'bool', momentary: true, ...(label ? { label } : {}) });
const num = (tag: string, min: number, max: number, step = 1, label?: string): PlaygroundInput => ({ tag, kind: 'number', min, max, step, ...(label ? { label } : {}) });
const bits = (tag: string, label?: string): PlaygroundInput => ({ tag, kind: 'bits', ...(label ? { label } : {}) });

const tb = (tag: string, label?: string): PlaygroundTrace => ({ tag, kind: 'bool', ...(label ? { label } : {}) });
const tn = (tag: string, min?: number, max?: number, format?: PlaygroundTrace['format'], label?: string): PlaygroundTrace => ({
  tag,
  kind: 'number',
  ...(min !== undefined ? { min } : {}),
  ...(max !== undefined ? { max } : {}),
  ...(format ? { format } : {}),
  ...(label ? { label } : {}),
});

// ---------------------------------------------------------------------------
// Shared programs
// ---------------------------------------------------------------------------

const LATCH: PlaygroundDef = {
  rungs: ['XIC(Start_PB)OTL(Motor);', 'XIC(Stop_PB)OTU(Motor);'],
  comments: ['Latch the motor on with a momentary START.', 'Unlatch it with STOP.'],
  tags: [bool('Start_PB', false, 'Start push button'), bool('Stop_PB', false, 'Stop push button'), bool('Motor', false, 'Motor run command')],
  inputs: [tap('Start_PB', 'START'), tap('Stop_PB', 'STOP')],
  traces: [tb('Start_PB'), tb('Stop_PB'), tb('Motor')],
  tryIt: [
    'Tap **START**: `Motor` stays on after you let go — OTL is *retentive*.',
    'Hold START and STOP together: the **last rung wins** (OTU is below OTL).',
    'In Logix an OTL bit keeps its value through a PROG → RUN cycle — that is the prescan trap of Chapter 2.',
  ],
};

const TON_DEF: PlaygroundDef = {
  rungs: ['XIC(Start_PB)TON(Delay_Timer,3000,0);', 'XIC(Delay_Timer.DN)OTE(Motor);'],
  comments: ['On-delay: time while Start_PB is on.', 'Run the motor when the delay is done.'],
  tags: [bool('Start_PB'), timer('Delay_Timer', '3 s start delay'), bool('Motor')],
  inputs: [bin('Start_PB')],
  traces: [tb('Start_PB'), tb('Delay_Timer.EN', '.EN'), tb('Delay_Timer.TT', '.TT'), tb('Delay_Timer.DN', '.DN'), tn('Delay_Timer.ACC', 0, 3000, 'dec', '.ACC')],
  tryIt: [
    'Turn **Start_PB** on and watch `.ACC` ramp to 3000 ms; `.DN` turns on exactly then.',
    'Turn it off before 3 s: the TON **resets** `.ACC` to 0 — nothing is remembered (compare RTO).',
    '`.TT` (timer timing) is on only while `.EN` is on and `.DN` is still off.',
  ],
};

const COUNTER_DEF: PlaygroundDef = {
  rungs: ['XIC(Part_Sensor)CTU(Part_Count,5,0);', 'XIC(Reset_PB)RES(Part_Count);', 'XIC(Part_Count.DN)OTE(Batch_Done);'],
  comments: ['Count parts on each false → true transition.', 'Reset the counter.', 'Batch of 5 done.'],
  tags: [bool('Part_Sensor'), bool('Reset_PB'), counter('Part_Count', 'Batch of 5'), bool('Batch_Done')],
  inputs: [tap('Part_Sensor', 'Part'), tap('Reset_PB', 'Reset')],
  traces: [tb('Part_Sensor'), tb('Part_Count.CU', '.CU'), tb('Part_Count.DN', '.DN'), tn('Part_Count.ACC', 0, 7, 'dec', '.ACC'), tb('Reset_PB')],
  tryIt: [
    'Tap **Part** five times: `.DN` turns on at `.ACC` = 5 — and counting continues past the preset.',
    'Holding the sensor on counts **once**: the counter looks at the rung *transition* (it stores it in `.CU`).',
    'Tap **Reset** (RES) to clear `.ACC` and the status bits.',
  ],
};

const FIFO_DEF: PlaygroundDef = {
  rungs: ['XIC(Load_PB)FFL(Part_ID,Queue[0],Queue_Ctl,5,0);', 'XIC(Unload_PB)FFU(Queue[0],Next_Part,Queue_Ctl,5,0);'],
  comments: ['Load the current part id into the queue.', 'Unload the oldest part id.'],
  tags: [bool('Load_PB'), bool('Unload_PB'), dint('Part_ID', 101), dintArr('Queue', [0, 0, 0, 0, 0]), control('Queue_Ctl'), dint('Next_Part')],
  inputs: [num('Part_ID', 100, 199, 1, 'Part_ID'), tap('Load_PB', 'Load'), tap('Unload_PB', 'Unload')],
  traces: [tb('Load_PB'), tb('Unload_PB'), tn('Queue_Ctl.POS', 0, 5, 'dec', 'Queue_Ctl.POS'), tb('Queue_Ctl.DN', '.DN (full)'), tb('Queue_Ctl.EM', '.EM (empty)'), tn('Next_Part', undefined, undefined, 'dec')],
  tryIt: [
    'Change **Part_ID**, then tap **Load** a few times: `.POS` counts the entries.',
    'Tap **Unload**: `Next_Part` gets the **oldest** entry (first in, first out) and the queue shifts.',
    'Load 5 times: `.DN` = full. Unload everything: `.EM` = empty.',
  ],
};

const SUB_DEF: PlaygroundDef = {
  rungs: ['JSR(Scale_Sub,1,Raw_Value,Scaled_Value);'],
  comments: ['Call the subroutine with one input and one return parameter.'],
  routines: [{ name: 'Scale_Sub', rungs: ['SBR(In_Value);', 'MUL(In_Value,2.5,Out_Value);', 'RET(Out_Value);'] }],
  tags: [real('Raw_Value', 10), real('Scaled_Value'), real('In_Value'), real('Out_Value')],
  inputs: [num('Raw_Value', 0, 40, 0.5)],
  traces: [tn('Raw_Value', 0, 40, 'real'), tn('Scaled_Value', 0, 100, 'real')],
  tryIt: [
    'JSR passes `Raw_Value` → SBR receives it in `In_Value`.',
    'The subroutine multiplies by 2.5; RET hands `Out_Value` back into `Scaled_Value`.',
    'Parameters make one routine reusable for many inputs.',
  ],
};

const JMP_DEF: PlaygroundDef = {
  rungs: ['XIC(Skip_Section)JMP(Skip);', 'XIC(Start_PB)OTE(Motor);', 'LBL(Skip)XIC(Start_PB)OTE(Lamp);'],
  comments: ['Jump over the next rung while Skip_Section is on.', 'Skipped rung: not scanned while jumping.', 'Execution continues at the label.'],
  tags: [bool('Skip_Section'), bool('Start_PB'), bool('Motor'), bool('Lamp')],
  inputs: [bin('Skip_Section'), bin('Start_PB')],
  traces: [tb('Skip_Section'), tb('Start_PB'), tb('Motor'), tb('Lamp')],
  tryIt: [
    'Turn **Start_PB** on, then **Skip_Section** on, then Start_PB off: `Motor` stays **frozen on** — the skipped OTE is not executed.',
    '`Lamp` after the label keeps following the button.',
    'Skipping outputs is dangerous: they hold their last state.',
  ],
};

const BIT_SHIFT = (op: 'BSL' | 'BSR'): PlaygroundDef => ({
  rungs: [`XIC(Shift_PB)${op}(Track[0],Track_Ctl,Part_Present,8);`],
  comments: [`Shift ${op === 'BSL' ? 'left (toward bit 7)' : 'right (toward bit 0)'} on each Shift_PB press; Part_Present enters the register.`],
  tags: [bool('Shift_PB'), bool('Part_Present'), dintArr('Track', [op === 'BSL' ? 0 : 0]), control('Track_Ctl')],
  inputs: [bin('Part_Present', 'Part_Present (source bit)'), tap('Shift_PB', 'Shift')],
  traces: [tb('Shift_PB'), tb('Part_Present'), tn('Track[0]', 0, 255, 'bin', 'Track[0]'), tb('Track_Ctl.UL', '.UL (unloaded bit)')],
  tryIt: [
    `Set **Part_Present**, tap **Shift**: the bit enters at ${op === 'BSL' ? 'bit 0' : 'bit 7'}; clear it and keep shifting to move the "part" along.`,
    `After 8 shifts the bit falls out into \`.UL\`.`,
    'Shift registers track parts on a conveyor: one bit per position (Chapter 6, “Sort It Out”).',
  ],
});

const CMP_LEVEL = (rung: string, out: string, what: string): PlaygroundDef => ({
  rungs: [rung],
  tags: [real('Tank_Level', 50, 'Level transmitter, %'), bool(out)],
  inputs: [num('Tank_Level', 0, 100, 0.5, 'Tank_Level (%)')],
  traces: [tn('Tank_Level', 0, 100, 'real'), tb(out)],
  tryIt: [`Drag **Tank_Level**: \`${out}\` turns on ${what}.`, 'Compares are *input* instructions: they sit where a contact would, and can be in series with other conditions.'],
});

const MATH2 = (rung: string, a: [string, number, number, number, number], b: [string, number, number, number, number] | null, dest: string, kind: 'real' | 'dint', tip: string[]): PlaygroundDef => {
  const mk = kind === 'real' ? real : dint;
  const tags: TagDef[] = [mk(a[0], a[1]), ...(b ? [mk(b[0], b[1])] : []), mk(dest)];
  return {
    rungs: [rung],
    tags,
    inputs: [num(a[0], a[2], a[3], a[4]), ...(b ? [num(b[0], b[2], b[3], b[4])] : [])],
    traces: [tn(a[0], a[2], a[3], kind === 'real' ? 'real' : 'dec'), ...(b ? [tn(b[0], b[2], b[3], kind === 'real' ? 'real' : 'dec')] : []), tn(dest, undefined, undefined, kind === 'real' ? 'real' : 'dec')],
    tryIt: tip,
  };
};

const LOGIC2 = (op: 'AND' | 'OR' | 'XOR'): PlaygroundDef => ({
  rungs: [`${op}(Word_A,Word_B,Result);`],
  tags: [dint('Word_A', 0b1100_1010), dint('Word_B', 0b1010_0110), dint('Result')],
  inputs: [bits('Word_A'), bits('Word_B')],
  traces: [tn('Word_A', 0, 255, 'bin'), tn('Word_B', 0, 255, 'bin'), tn('Result', 0, 255, 'bin')],
  tryIt: [
    op === 'AND' ? 'A result bit is 1 only where **both** words have a 1 — use it to *mask* bits.' : op === 'OR' ? 'A result bit is 1 where **either** word has a 1 — use it to *set* bits.' : 'A result bit is 1 where the words **differ** — use it to find changed bits.',
    'Click the bit toggles and watch the binary values in the diagram legend.',
  ],
});

// ---------------------------------------------------------------------------
// Playgrounds
// ---------------------------------------------------------------------------

export const PLAYGROUNDS: Record<string, PlaygroundDef> = {
  // Bit ------------------------------------------------------------------
  XIC: {
    rungs: ['XIC(Start_PB)OTE(Motor);'],
    comments: ['Examine if closed: true while Start_PB = 1.'],
    tags: [bool('Start_PB', false, 'Start push button (N.O.)'), bool('Motor', false, 'Motor run command')],
    inputs: [bin('Start_PB')],
    traces: [tb('Start_PB'), tb('Motor')],
    tryIt: ['Toggle **Start_PB**: the XIC highlights green and passes power while the bit is 1.', 'XIC asks “is the bit 1?” — not “is the button pressed?”. For an N.C. stop button the bit is 1 at rest.'],
  },
  XIO: {
    rungs: ['XIO(Door_Closed)OTE(Door_Alarm);'],
    comments: ['Examine if open: true while Door_Closed = 0.'],
    tags: [bool('Door_Closed', true, 'Door switch'), bool('Door_Alarm')],
    inputs: [bin('Door_Closed')],
    traces: [tb('Door_Closed'), tb('Door_Alarm')],
    tryIt: ['Turn **Door_Closed** off: the XIO becomes true and `Door_Alarm` turns on.', 'XIO = “bit is 0”. It has nothing to do with whether the field device is N.O. or N.C.'],
  },
  OTE: {
    rungs: ['XIC(Switch_A)XIC(Switch_B)OTE(Lamp);'],
    comments: ['Series contacts = AND.'],
    tags: [bool('Switch_A'), bool('Switch_B'), bool('Lamp')],
    inputs: [bin('Switch_A'), bin('Switch_B')],
    traces: [tb('Switch_A'), tb('Switch_B'), tb('Lamp')],
    tryIt: ['`Lamp` follows the rung: 1 when A **and** B are on, and written back to **0** as soon as the rung is false.', 'Use one OTE per bit — a second OTE on the same bit later in the program overwrites the first.'],
  },
  OTL: LATCH,
  OTU: LATCH,
  ONS: {
    rungs: ['XIC(Count_PB)ONS(Count_ONS)ADD(Parts,1,Parts);', 'XIC(Count_PB)ADD(Parts_No_ONS,1,Parts_No_ONS);'],
    comments: ['With a one-shot: +1 per press.', 'Without: +1 per SCAN (every 10 ms) while held!'],
    tags: [bool('Count_PB'), bool('Count_ONS', false, 'ONS storage bit'), dint('Parts'), dint('Parts_No_ONS')],
    inputs: [tap('Count_PB', 'Count')],
    traces: [tb('Count_PB'), tn('Parts', undefined, undefined, 'dec'), tn('Parts_No_ONS', undefined, undefined, 'dec')],
    tryIt: ['Hold **Count** for a second: `Parts` goes up by **1**, `Parts_No_ONS` by ≈ 100 (one per scan).', 'The storage bit remembers the rung state of the previous scan — give every ONS its own bit.'],
  },
  OSR: {
    rungs: ['XIC(Count_PB)OSR(Storage_Bit,Pulse);', 'XIC(Pulse)ADD(Pulses,1,Pulses);'],
    comments: ['One-shot rising: Pulse is on for one scan.', 'Count the pulses.'],
    tags: [bool('Count_PB'), bool('Storage_Bit'), bool('Pulse'), dint('Pulses')],
    inputs: [tap('Count_PB', 'Press')],
    traces: [tb('Count_PB'), tb('Pulse', 'Pulse (1 scan)'), tn('Pulses', undefined, undefined, 'dec')],
    tryIt: ['Press: `Pulse` is a one-scan spike (10 ms) at the **rising** edge — look closely at the diagram.', 'OSR is an *output* instruction: it ends the rung and writes its output bit.'],
  },
  OSF: {
    rungs: ['XIC(Sensor)OSF(Storage_Bit,Falling_Pulse);', 'XIC(Falling_Pulse)ADD(Pulses,1,Pulses);'],
    comments: ['One-shot falling: Falling_Pulse is on for one scan when Sensor turns off.', 'Count the pulses.'],
    tags: [bool('Sensor'), bool('Storage_Bit'), bool('Falling_Pulse'), dint('Pulses')],
    inputs: [bin('Sensor')],
    traces: [tb('Sensor'), tb('Falling_Pulse', 'Falling_Pulse (1 scan)'), tn('Pulses', undefined, undefined, 'dec')],
    tryIt: ['Turn **Sensor** on: nothing. Turn it off: one-scan pulse on the **falling** edge.', 'Typical use: “box has left the photo-eye”.'],
  },

  // Timer / counter ----------------------------------------------------------
  TON: TON_DEF,
  TOF: {
    rungs: ['XIC(Motor_Run)TOF(Fan_Timer,4000,0);', 'XIC(Fan_Timer.DN)OTE(Cooling_Fan);'],
    comments: ['Off-delay: .DN on while Motor_Run is on and for 4 s after.', 'Keep the cooling fan running after the motor stops.'],
    tags: [bool('Motor_Run'), timer('Fan_Timer', '4 s run-on'), bool('Cooling_Fan')],
    inputs: [bin('Motor_Run')],
    traces: [tb('Motor_Run'), tb('Fan_Timer.EN', '.EN'), tb('Fan_Timer.TT', '.TT'), tb('Fan_Timer.DN', '.DN'), tn('Fan_Timer.ACC', 0, 4000, 'dec', '.ACC')],
    tryIt: ['Turn **Motor_Run** on: `.DN` turns on **immediately**.', 'Turn it off: the TOF times; `.DN` drops 4 s later.', 'Turn it back on while timing: `.ACC` resets and `.DN` stays on.'],
  },
  RTO: {
    rungs: ['XIC(Motor_Run)RTO(Run_Hours,5000,0);', 'XIC(Reset_PB)RES(Run_Hours);'],
    comments: ['Retentive timer: keeps .ACC when the rung goes false.', 'RES clears it.'],
    tags: [bool('Motor_Run'), bool('Reset_PB'), timer('Run_Hours', 'Run time (5 s service interval)')],
    inputs: [bin('Motor_Run'), tap('Reset_PB', 'Reset')],
    traces: [tb('Motor_Run'), tb('Run_Hours.EN', '.EN'), tb('Run_Hours.TT', '.TT'), tb('Run_Hours.DN', '.DN'), tn('Run_Hours.ACC', 0, 5000, 'dec', '.ACC'), tb('Reset_PB')],
    tryIt: ['Run the motor in a few short bursts: `.ACC` **adds up** instead of resetting.', 'After 5 s total `.DN` stays on — only **RES** clears an RTO.'],
  },
  CTU: COUNTER_DEF,
  CTD: {
    rungs: ['XIC(Car_In)CTU(Cars_Inside,5,0);', 'XIC(Car_Out)CTD(Cars_Inside,5,0);', 'XIC(Reset_PB)RES(Cars_Inside);'],
    comments: ['Count cars in…', '…and out, on the SAME counter.', 'Reset.'],
    tags: [bool('Car_In'), bool('Car_Out'), bool('Reset_PB'), counter('Cars_Inside', 'Garage occupancy, 5 spaces')],
    inputs: [tap('Car_In', 'Car in'), tap('Car_Out', 'Car out'), tap('Reset_PB', 'Reset')],
    traces: [tb('Car_In'), tb('Car_Out'), tn('Cars_Inside.ACC', -2, 7, 'dec', '.ACC'), tb('Cars_Inside.DN', '.DN (full)'), tb('Cars_Inside.UN', '.UN')],
    tryIt: ['CTU and CTD share one COUNTER: `.ACC` is the occupancy (Chapter 4, “Full House”).', '`.DN` = ACC ≥ PRE: the garage is full.', 'CTD below zero goes negative — it does not stop at 0.'],
  },
  RES: {
    rungs: ['XIC(Run)RTO(Run_Timer,3000,0);', 'XIC(Reset_PB)RES(Run_Timer);'],
    comments: ['A retentive timer only RES can clear.', 'Reset when Reset_PB is on.'],
    tags: [bool('Run'), bool('Reset_PB'), timer('Run_Timer')],
    inputs: [bin('Run'), tap('Reset_PB', 'Reset')],
    traces: [tb('Run'), tb('Reset_PB'), tn('Run_Timer.ACC', 0, 3000, 'dec', '.ACC'), tb('Run_Timer.DN', '.DN')],
    tryIt: ['Let the RTO finish, then tap **Reset**: `.ACC` and `.DN` clear.', 'While Reset is held, the timer cannot time — RES wins every scan.'],
  },

  // Compare -------------------------------------------------------------------
  EQU: {
    rungs: ['EQU(Part_Count,10)OTE(Batch_Done);'],
    tags: [dint('Part_Count', 7), bool('Batch_Done')],
    inputs: [num('Part_Count', 0, 15)],
    traces: [tn('Part_Count', 0, 15), tb('Batch_Done')],
    tryIt: ['Set **Part_Count** to 10: `Batch_Done` is on only at exactly 10.', 'Avoid EQU on REAL values (e.g. levels) — they are rarely *exactly* equal. Use GEQ/LEQ or LIM.'],
  },
  NEQ: {
    rungs: ['NEQ(Setpoint,Actual)OTE(Deviation);'],
    tags: [dint('Setpoint', 50), dint('Actual', 50), bool('Deviation')],
    inputs: [num('Setpoint', 0, 100), num('Actual', 0, 100)],
    traces: [tn('Setpoint', 0, 100), tn('Actual', 0, 100), tb('Deviation')],
    tryIt: ['`Deviation` is on whenever the two values differ.'],
  },
  LES: CMP_LEVEL('LES(Tank_Level,20.0)OTE(Fill_Valve);', 'Fill_Valve', 'below 20 % (strictly less)'),
  LEQ: CMP_LEVEL('LEQ(Tank_Level,20.0)OTE(Low_Alarm);', 'Low_Alarm', 'at or below 20 %'),
  GRT: CMP_LEVEL('GRT(Tank_Level,80.0)OTE(High_Alarm);', 'High_Alarm', 'above 80 % (strictly greater)'),
  GEQ: CMP_LEVEL('GEQ(Tank_Level,80.0)OTE(High_Alarm);', 'High_Alarm', 'at or above 80 %'),
  LIM: {
    rungs: ['LIM(20.0,Temperature,80.0)OTE(Temp_OK);'],
    tags: [real('Temperature', 50), bool('Temp_OK')],
    inputs: [num('Temperature', 0, 100, 0.5)],
    traces: [tn('Temperature', 0, 100, 'real'), tb('Temp_OK')],
    tryIt: ['`Temp_OK` is on between 20.0 and 80.0 (limits included).', 'Swap the limits (80.0, …, 20.0) in edit mode: LIM then tests *outside* the band.'],
  },
  MEQ: {
    rungs: ['MEQ(Input_Word,16#000F,16#0005)OTE(Pattern_Match);'],
    comments: ['Compare only the low 4 bits (mask 16#000F) with 0101.'],
    tags: [dint('Input_Word', 0b1111_0101), bool('Pattern_Match')],
    inputs: [bits('Input_Word')],
    traces: [tn('Input_Word', 0, 255, 'bin'), tb('Pattern_Match')],
    tryIt: ['Only bits 0–3 matter (the mask): change bits 4–7 freely, the match stays.', 'Low nibble must be 0101 for a match.'],
  },
  CMP: {
    rungs: ['CMP(Level_A + Level_B > 150.0)OTE(Overflow_Risk);'],
    tags: [real('Level_A', 60), real('Level_B', 60), bool('Overflow_Risk')],
    inputs: [num('Level_A', 0, 100, 0.5), num('Level_B', 0, 100, 0.5)],
    traces: [tn('Level_A', 0, 100, 'real'), tn('Level_B', 0, 100, 'real'), tb('Overflow_Risk')],
    tryIt: ['CMP evaluates a whole expression: here A + B > 150.', 'Handy, but slower and harder to read online than a simple GRT.'],
  },

  // Math -----------------------------------------------------------------------
  ADD: MATH2('ADD(Value_A,Value_B,Sum);', ['Value_A', 20, -50, 100, 1], ['Value_B', 5, -50, 100, 1], 'Sum', 'dint', ['Dest = A + B, recalculated every scan while the rung is true.', 'Counting with ADD needs a one-shot — see ONS.']),
  SUB: MATH2('SUB(Setpoint,Actual,Error);', ['Setpoint', 60, 0, 100, 0.5], ['Actual', 45, 0, 100, 0.5], 'Error', 'real', ['Error = Setpoint − Actual; negative when the process overshoots.']),
  MUL: MATH2('MUL(Speed_Pct,0.6,Speed_Hz);', ['Speed_Pct', 50, 0, 100, 1], null, 'Speed_Hz', 'real', ['100 % × 0.6 = 60 Hz: scale a percentage to a drive frequency.']),
  DIV: MATH2('DIV(Total,Count,Average);', ['Total', 250, 0, 1000, 1], ['Count', 4, 0, 10, 1], 'Average', 'real', ['Average = Total ÷ Count.', 'Guard against Count = 0 in real programs (division by zero is a minor fault).']),
  MOD: MATH2('MOD(Parts,12,Remainder);', ['Parts', 30, 0, 100, 1], null, 'Remainder', 'dint', ['30 parts in boxes of 12 → remainder 6 in the open box.']),
  NEG: MATH2('NEG(Offset,Neg_Offset);', ['Offset', 12, -50, 50, 1], null, 'Neg_Offset', 'dint', ['Dest = 0 − Source.']),
  ABS: MATH2('ABS(Error,Abs_Error);', ['Error', -15, -50, 50, 1], null, 'Abs_Error', 'dint', ['Magnitude without sign — e.g. “deviation larger than 5 either way”.']),
  SQR: MATH2('SQR(Area,Side);', ['Area', 49, 0, 400, 1], null, 'Side', 'real', ['Square root: side of a square with that area.', 'Flow from a differential-pressure transmitter is proportional to √ΔP.']),
  CPT: {
    rungs: ['CPT(Result,(Level_A + Level_B) / 2.0);'],
    tags: [real('Level_A', 40), real('Level_B', 70), real('Result')],
    inputs: [num('Level_A', 0, 100, 0.5), num('Level_B', 0, 100, 0.5)],
    traces: [tn('Level_A', 0, 100, 'real'), tn('Level_B', 0, 100, 'real'), tn('Result', 0, 100, 'real')],
    tryIt: ['CPT writes the result of a full expression: the average of two levels.'],
  },
  SCP: {
    rungs: ['SCP(Raw_Input,0,32767,0.0,100.0,Level_Pct);'],
    comments: ['Scale raw ADC counts 0…32767 to 0.0…100.0 %.'],
    tags: [dint('Raw_Input', 16384), real('Level_Pct')],
    inputs: [num('Raw_Input', 0, 32767, 1)],
    traces: [tn('Raw_Input', 0, 32767), tn('Level_Pct', 0, 100, 'real')],
    tryIt: ['Output = (In − InMin) × (OutMax − OutMin) / (InMax − InMin) + OutMin.', 'SCP does not clamp: inputs outside the range extrapolate.'],
  },

  // Move / logical ---------------------------------------------------------------
  MOV: {
    rungs: ['XIC(Auto_Mode)MOV(Recipe_Speed,Speed_Ref);', 'XIO(Auto_Mode)MOV(Manual_Speed,Speed_Ref);'],
    comments: ['Auto: take the recipe speed.', 'Manual: take the operator speed.'],
    tags: [bool('Auto_Mode', true), dint('Recipe_Speed', 1200), dint('Manual_Speed', 300), dint('Speed_Ref')],
    inputs: [bin('Auto_Mode'), num('Recipe_Speed', 0, 1800, 10), num('Manual_Speed', 0, 1800, 10)],
    traces: [tb('Auto_Mode'), tn('Speed_Ref', 0, 1800)],
    tryIt: ['Flip **Auto_Mode**: `Speed_Ref` is copied from a different source.', 'MOV converts data types (e.g. REAL → DINT rounds).'],
  },
  MVM: {
    rungs: ['MVM(Source_Word,16#000F,Output_Word);'],
    comments: ['Copy only the bits selected by the mask (low 4 bits).'],
    tags: [dint('Source_Word', 0b1010_0110), dint('Output_Word', 0b1111_0000)],
    inputs: [bits('Source_Word')],
    traces: [tn('Source_Word', 0, 255, 'bin'), tn('Output_Word', 0, 255, 'bin')],
    tryIt: ['Bits 0–3 of `Output_Word` follow the source; bits 4–7 keep their own value (1111).'],
  },
  CLR: {
    rungs: ['XIC(Add_PB)ONS(Add_ONS)ADD(Total,10,Total);', 'XIC(Reset_PB)CLR(Total);'],
    tags: [bool('Add_PB'), bool('Add_ONS'), bool('Reset_PB'), dint('Total', 30)],
    inputs: [tap('Add_PB', 'Add 10'), tap('Reset_PB', 'Clear')],
    traces: [tb('Add_PB'), tb('Reset_PB'), tn('Total', 0, 100)],
    tryIt: ['Add a few times, then **Clear**: CLR writes 0 to the destination.'],
  },
  AND: LOGIC2('AND'),
  OR: LOGIC2('OR'),
  XOR: LOGIC2('XOR'),
  NOT: {
    rungs: ['NOT(Word_A,Result);'],
    tags: [dint('Word_A', 0b0000_1111), dint('Result')],
    inputs: [bits('Word_A')],
    traces: [tn('Word_A', 0, 255, 'bin'), tn('Result', undefined, undefined, 'bin')],
    tryIt: ['Every bit is inverted — all 32 of the DINT, so the decimal value is negative (two’s complement).'],
  },
  BTD: {
    rungs: ['BTD(Source_Word,0,Dest_Word,4,4);'],
    comments: ['Copy 4 bits starting at source bit 0 into destination bits 4…7.'],
    tags: [dint('Source_Word', 0b0000_1001), dint('Dest_Word')],
    inputs: [bits('Source_Word')],
    traces: [tn('Source_Word', 0, 255, 'bin'), tn('Dest_Word', 0, 255, 'bin')],
    tryIt: ['Toggle source bits 0–3: they appear shifted into bits 4–7 of `Dest_Word`.'],
  },
  COP: {
    rungs: ['XIC(Load_PB)COP(Recipe_A[0],Active_Recipe[0],3);', 'XIC(Clear_PB)FLL(0,Active_Recipe[0],3);'],
    comments: ['Copy the 3-element recipe.', 'Clear the active recipe.'],
    tags: [bool('Load_PB'), bool('Clear_PB'), dintArr('Recipe_A', [120, 45, 7]), dintArr('Active_Recipe', [0, 0, 0])],
    inputs: [tap('Load_PB', 'Load recipe'), tap('Clear_PB', 'Clear')],
    traces: [tb('Load_PB'), tn('Active_Recipe[0]', 0, 150), tn('Active_Recipe[1]', 0, 150), tn('Active_Recipe[2]', 0, 150)],
    tryIt: ['**Load** copies all 3 elements in one instruction (a raw memory copy — types must match).'],
  },
  FLL: {
    rungs: ['XIC(Fill_PB)FLL(Fill_Value,Buffer[0],4);'],
    tags: [bool('Fill_PB'), dint('Fill_Value', 42), dintArr('Buffer', [0, 0, 0, 0])],
    inputs: [num('Fill_Value', 0, 100), tap('Fill_PB', 'Fill')],
    traces: [tb('Fill_PB'), tn('Buffer[0]', 0, 100), tn('Buffer[3]', 0, 100)],
    tryIt: ['Tap **Fill**: all 4 elements get `Fill_Value`.'],
  },

  // Program control --------------------------------------------------------------
  JSR: {
    rungs: ['XIC(Auto_Mode)JSR(Auto_Sequence,0);'],
    comments: ['Scan the Auto_Sequence routine only in auto.'],
    routines: [{ name: 'Auto_Sequence', rungs: ['XIC(Start_PB)OTE(Motor);'] }],
    tags: [bool('Auto_Mode', true), bool('Start_PB'), bool('Motor')],
    inputs: [bin('Auto_Mode'), bin('Start_PB')],
    traces: [tb('Auto_Mode'), tb('Start_PB'), tb('Motor')],
    tryIt: ['With Auto_Mode on, `Motor` follows Start_PB (the subroutine runs).', 'Turn Start_PB on, then Auto_Mode **off**, then Start_PB off: `Motor` stays on — a routine that is not called is not scanned, its outputs **freeze**.'],
  },
  SBR: SUB_DEF,
  RET: SUB_DEF,
  JMP: JMP_DEF,
  LBL: JMP_DEF,
  AFI: {
    rungs: ['XIC(Start_PB)AFI()OTE(Motor);', 'XIC(Start_PB)OTE(Lamp);'],
    comments: ['Rung disabled with AFI (always false).', 'Normal rung.'],
    tags: [bool('Start_PB'), bool('Motor'), bool('Lamp')],
    inputs: [bin('Start_PB')],
    traces: [tb('Start_PB'), tb('Motor'), tb('Lamp')],
    tryIt: ['`Motor` never turns on: AFI is always false.', 'In edit mode, delete the AFI to put the rung back in service.'],
  },
  NOP: {
    rungs: ['XIC(Start_PB)NOP();', 'XIC(Start_PB)OTE(Lamp);'],
    comments: ['Placeholder: NOP does nothing.', 'Normal rung.'],
    tags: [bool('Start_PB'), bool('Lamp')],
    inputs: [bin('Start_PB')],
    traces: [tb('Start_PB'), tb('Lamp')],
    tryIt: ['NOP passes power and does nothing — a placeholder while developing.'],
  },
  TND: {
    rungs: ['XIC(Debug_Stop)TND();', 'XIC(Start_PB)OTE(Motor);'],
    comments: ['Temporary end: the rest of the routine is skipped while Debug_Stop is on.', 'Skipped rung.'],
    tags: [bool('Debug_Stop'), bool('Start_PB'), bool('Motor')],
    inputs: [bin('Debug_Stop'), bin('Start_PB')],
    traces: [tb('Debug_Stop'), tb('Start_PB'), tb('Motor')],
    tryIt: ['Turn **Debug_Stop** on: rungs below it stop executing, so `Motor` freezes.'],
  },
  MCR: {
    rungs: ['XIC(Zone_Enable)MCR();', 'XIC(Start_PB)OTE(Motor);', 'MCR();'],
    comments: ['Start of the MCR zone.', 'Inside the zone.', 'End of the zone.'],
    tags: [bool('Zone_Enable', true), bool('Start_PB'), bool('Motor')],
    inputs: [bin('Zone_Enable'), bin('Start_PB')],
    traces: [tb('Zone_Enable'), tb('Start_PB'), tb('Motor')],
    tryIt: ['Turn **Zone_Enable** off: every rung in the zone is scanned as **false**, so OTE outputs drop (unlike JMP, which freezes them).', 'An MCR is not a safety device — use hardwired safety circuits.'],
  },

  // Special -------------------------------------------------------------------------
  BSL: BIT_SHIFT('BSL'),
  BSR: BIT_SHIFT('BSR'),
  SQO: {
    rungs: ['XIC(Run)XIO(Step_Timer.DN)TON(Step_Timer,800,0);', 'XIC(Step_Timer.DN)SQO(Pattern[0],16#000F,Lamps,Seq_Ctl,4,0);'],
    comments: ['Self-resetting step timer.', 'Advance the sequencer on each timer pulse: Pattern[POS] → Lamps (masked).'],
    tags: [bool('Run', true), timer('Step_Timer'), dintArr('Pattern', [0, 1, 2, 4, 8]), dint('Lamps'), control('Seq_Ctl')],
    inputs: [bin('Run')],
    traces: [tb('Step_Timer.DN', 'Step pulse'), tn('Seq_Ctl.POS', 0, 4, 'dec', 'Seq_Ctl.POS'), tb('Lamps.0', 'Lamps.0'), tb('Lamps.1', 'Lamps.1'), tb('Lamps.2', 'Lamps.2'), tb('Lamps.3', 'Lamps.3')],
    tryIt: ['A running light: each step copies the next pattern word into `Lamps`.', 'After the last step `.POS` wraps back to 1 (position 0 is the start/idle state).', 'Traffic lights are a classic SQO job (Chapter 6).'],
  },
  FFL: FIFO_DEF,
  FFU: FIFO_DEF,
};

/** Playground for a mnemonic (undefined when none is defined). */
export function playgroundFor(mnemonic: string): PlaygroundDef | undefined {
  return PLAYGROUNDS[mnemonic.toUpperCase()];
}
