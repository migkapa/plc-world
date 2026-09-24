/**
 * Neutral-text usage examples for the instruction help cards (headless).
 */
import { INSTRUCTION_DEFS } from '@/plc/instructions';

const EXAMPLES: Record<string, string> = {
  XIC: 'XIC(Start_PB)OTE(Motor);',
  XIO: 'XIC(Start_PB)XIO(Stop_PB)OTE(Motor);',
  OTE: 'XIC(Start_PB)OTE(Motor);',
  OTL: 'XIC(Start_PB)OTL(Motor);',
  OTU: 'XIC(Stop_PB)OTU(Motor);',
  ONS: 'XIC(Count_PB)ONS(Count_ONS)ADD(Parts,1,Parts);',
  OSR: 'XIC(Count_PB)OSR(Storage_Bit,Pulse);',
  OSF: 'XIC(Sensor)OSF(Storage_Bit,Falling_Pulse);',
  TON: 'XIC(Start_PB)TON(Delay_Timer,5000,0);',
  TOF: 'XIC(Motor)TOF(Fan_Timer,10000,0);',
  RTO: 'XIC(Motor)RTO(Run_Hours,3600000,0);',
  CTU: 'XIC(Part_Sensor)CTU(Part_Count,10,0);',
  CTD: 'XIC(Part_Removed)CTD(Part_Count,10,0);',
  RES: 'XIC(Reset_PB)RES(Part_Count);',
  EQU: 'EQU(Part_Count.ACC,10)OTE(Batch_Done);',
  NEQ: 'NEQ(Setpoint,Actual)OTE(Deviation);',
  LES: 'LES(Tank_Level,20.0)OTE(Fill_Valve);',
  LEQ: 'LEQ(Tank_Level,20.0)OTE(Low_Alarm);',
  GRT: 'GRT(Tank_Level,80.0)OTE(High_Alarm);',
  GEQ: 'GEQ(Part_Count.ACC,5)OTE(Half_Full);',
  LIM: 'LIM(20.0,Temperature,80.0)OTE(Temp_OK);',
  MEQ: 'MEQ(Input_Word,16#00FF,16#000F)OTE(Pattern_Match);',
  CMP: 'CMP(Level_A + Level_B > 150.0)OTE(Overflow_Risk);',
  ADD: 'XIC(Count_PB)ADD(Parts,1,Parts);',
  SUB: 'SUB(Setpoint,Actual,Error);',
  MUL: 'MUL(Speed,2,Speed_Ref);',
  DIV: 'DIV(Total,Count,Average);',
  MOD: 'MOD(Parts,12,Remainder);',
  NEG: 'NEG(Offset,Neg_Offset);',
  ABS: 'ABS(Error,Abs_Error);',
  SQR: 'SQR(Area,Side);',
  CPT: 'CPT(Result,(Level_A + Level_B) / 2.0);',
  SCP: 'SCP(Raw_Input,0,32767,0.0,100.0,Level_Pct);',
  MOV: 'XIC(Auto_Mode)MOV(Recipe_Speed,Speed_Ref);',
  MVM: 'MVM(Source_Word,16#000F,Output_Word);',
  CLR: 'XIC(Reset_PB)CLR(Total);',
  AND: 'AND(Input_Word,16#00FF,Masked);',
  OR: 'OR(Word_A,Word_B,Combined);',
  XOR: 'XOR(Word_A,Word_B,Changed_Bits);',
  NOT: 'NOT(Input_Word,Inverted);',
  BTD: 'BTD(Source_Word,4,Dest_Word,0,4);',
  COP: 'XIC(Load_PB)COP(Recipe_A[0],Active_Recipe[0],10);',
  FLL: 'XIC(Clear_PB)FLL(0,Buffer[0],10);',
  JSR: 'XIC(Auto_Mode)JSR(Auto_Sequence,0);',
  SBR: 'SBR();',
  RET: 'RET();',
  JMP: 'XIC(Skip_Section)JMP(Skip);',
  LBL: 'LBL(Skip)XIC(Start_PB)OTE(Motor);',
  AFI: 'AFI()OTE(Disabled_Output);',
  NOP: 'NOP();',
  TND: 'XIC(Debug_Stop)TND();',
  MCR: 'XIC(Zone_Enable)MCR();',
  BSL: 'XIC(Shift_PB)BSL(Track[0],Track_Ctl,Part_Present,16);',
  BSR: 'XIC(Shift_PB)BSR(Track[0],Track_Ctl,Part_Present,16);',
  SQO: 'XIC(Step_Timer.DN)SQO(Pattern[0],16#00FF,Lamps,Seq_Ctl,4,0);',
  FFL: 'XIC(Load_PB)FFL(Part_ID,Queue[0],Queue_Ctl,10,0);',
  FFU: 'XIC(Unload_PB)FFU(Queue[0],Next_Part,Queue_Ctl,10,0);',
};

/** A neutral-text rung showing the instruction in context. */
export function exampleFor(mnemonic: string): string {
  const op = mnemonic.toUpperCase();
  const known = EXAMPLES[op];
  if (known) return known;
  const def = INSTRUCTION_DEFS[op];
  if (!def) return `${op}();`;
  const operands = def.operands.map((o) => {
    if (o.kind === 'display' || o.kind === 'imm') return '0';
    if (o.kind === 'struct') return `My_${String(o.types[0] ?? 'Tag')}`;
    return o.name.replace(/\s+/g, '_');
  });
  const instr = `${op}(${operands.join(',')})`;
  return def.kind === 'input' ? `${instr}OTE(Output);` : `XIC(Enable)${instr};`;
}
