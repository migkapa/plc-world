/**
 * Test-only: plausible WRONG programs for chapter 5 (each must verify and fail at least one test) and
 * alternative CORRECT programs (`CH5_RIGHT`, must pass). Enforced by src/game/missions.test.ts.
 * Never imported by the app.
 */
import type { WrongAnswerSet } from './authoring';

const BAR = (thresholds: number[], cmp = 'GEQ'): string[] =>
  thresholds.map((t, i) => `${cmp}(Pot_1,${t.toFixed(1)})OTE(Light_${i});`);
const BAR_OK = BAR([12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100]);
const BUZZER_OK = '[LES(Pot_1,10.0),GRT(Pot_1,90.0)]OTE(Buzzer);';

// 5-5 building blocks
const SYS = '[XIC(Start_PB),XIC(System_On)]XIC(Stop_PB)XIC(EStop_OK)OTE(System_On);';
const RUNL = 'XIC(System_On)OTE(Running_Light);';
const FILL = 'XIC(System_On)[LES(LT_101,50.0),XIC(Fill_Valve)]LES(LT_101,60.0)OTE(Fill_Valve);';
const DRAIN = 'XIC(Discharge_PB)OTE(Drain_Valve);';
const MIXER = 'XIC(System_On)GEQ(LT_101,20.0)XIC(LSL_101)OTE(Mixer);';
const HEATER = 'XIC(Mixer)XIC(Mixer_Running)[LES(TT_101,58.0),XIC(Heater)]LEQ(TT_101,62.0)OTE(Heater);';

export const CH5_WRONG: WrongAnswerSet = {
  '5-1': [
    { rungs: ['XIC(Start_PB)XIC(Stop_PB)LES(LT_101,80.0)OTE(Fill_Valve);'], why: 'no seal-in: fills only while Start is held' },
    { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIO(Stop_PB)LES(LT_101,80.0)OTE(Fill_Valve);'], why: 'XIO on the N.C. stop: never opens' },
    { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)GRT(LT_101,80.0)OTE(Fill_Valve);'], why: 'compare inverted: never opens on an empty tank' },
    { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)LES(LT_101,0.8)OTE(Fill_Valve);'], why: 'fraction instead of percent: closes at 0.8 %' },
    { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)LES(LT_101,90.0)OTE(Fill_Valve);'], why: 'wrong setpoint (90 %)' },
    { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(LSH_101)OTE(Fill_Valve);'], why: 'uses the 90 % high level switch instead of the transmitter' },
    {
      rungs: ['[XIC(Start_PB)LES(LT_101,80.0),XIC(Fill_Valve)]XIC(Stop_PB)OTE(Fill_Valve);'],
      why: 'level check only on the Start leg: the seal keeps filling past 80 %',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(Fill_Valve)LES(LT_101,80.0)]XIC(Stop_PB)OTE(Fill_Valve);'],
      why: 'level check only on the seal leg: Start refills a full tank',
    },
    {
      rungs: ['XIC(Start_PB)OTL(Fill_Valve);', 'GEQ(LT_101,80.0)OTU(Fill_Valve);'],
      why: 'latch without Stop',
    },
    { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]LES(LT_101,80.0)OTE(Fill_Valve);'], why: 'Stop not wired in' },
  ],
  '5-2': [
    { rungs: ['MOV(Pot_1,Meter_1);', 'CPT(Meter_2,Pot_1+Pot_2/2);'], why: 'precedence: divides only Pot_2' },
    { rungs: ['MOV(Pot_1,Meter_1);', 'ADD(Pot_1,Pot_2,Meter_2);'], why: 'sum instead of average' },
    {
      rungs: ['MOV(Pot_1,Meter_1);', 'ADD(Pot_1,Pot_2,Sum_Int);', 'DIV(Sum_Int,2,Meter_2);'],
      tags: [{ name: 'Sum_Int', dataType: 'DINT' }],
      why: 'DINT intermediate rounds the decimals away',
    },
    {
      rungs: ['MOV(Pot_1,Pot_Int);', 'MOV(Pot_Int,Meter_1);', 'CPT(Meter_2,(Pot_1+Pot_2)/2);'],
      tags: [{ name: 'Pot_Int', dataType: 'DINT' }],
      why: 'Meter_1 through a DINT: 73.4 shows as 73',
    },
    { rungs: ['MOV(Pot_2,Meter_1);', 'CPT(Meter_2,(Pot_1+Pot_2)/2);'], why: 'Meter_1 shows the wrong pot' },
    { rungs: ['MOV(Pot_1,Meter_2);', 'CPT(Meter_1,(Pot_1+Pot_2)/2);'], why: 'meters swapped' },
    { rungs: ['MOV(Pot_1,Meter_1);', 'DIV(Pot_1,2.0,Meter_2);'], why: 'half of Pot_1 only' },
    { rungs: ['MOV(Pot_1,Meter_1);', 'CPT(Meter_2,(Pot_1+Pot_2)/3);'], why: 'divides by 3' },
    {
      rungs: ['XIC(Switch_0)MOV(Pot_1,Meter_1);', 'CPT(Meter_2,(Pot_1+Pot_2)/2);'],
      why: 'Meter_1 only updates while a switch is on',
    },
  ],
  '5-3': [
    { rungs: ['SCP(Pot_1,0.0,100.0,20.0,80.0,Meter_1);'], why: 'scales the full pot range (no worn-end dead zone)' },
    { rungs: ['SCP(Pot_1,10.0,90.0,20.0,80.0,Meter_1);'], why: 'no clamps: SCP extrapolates' },
    {
      rungs: ['SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref);', 'LES(Speed_Ref,20.0)MOV(20.0,Speed_Ref);', 'MOV(Speed_Ref,Meter_1);'],
      why: 'only the minimum clamp',
    },
    {
      rungs: ['SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref);', 'GRT(Speed_Ref,80.0)MOV(80.0,Speed_Ref);', 'MOV(Speed_Ref,Meter_1);'],
      why: 'only the maximum clamp',
    },
    {
      rungs: [
        'SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref);',
        'LES(Speed_Ref,20.0)MOV(80.0,Speed_Ref);',
        'GRT(Speed_Ref,80.0)MOV(20.0,Speed_Ref);',
        'MOV(Speed_Ref,Meter_1);',
      ],
      why: 'clamp values swapped',
    },
    {
      rungs: [
        'LES(Pot_1,10.0)MOV(20.0,Meter_1);',
        'GRT(Pot_1,90.0)MOV(80.0,Meter_1);',
        'SCP(Pot_1,10.0,90.0,20.0,80.0,Meter_1);',
      ],
      why: 'clamps before the SCP: the SCP rung overwrites them',
    },
    {
      rungs: [
        'SCP(Pot_1,10.0,90.0,80.0,20.0,Speed_Ref);',
        'LES(Speed_Ref,20.0)MOV(20.0,Speed_Ref);',
        'GRT(Speed_Ref,80.0)MOV(80.0,Speed_Ref);',
        'MOV(Speed_Ref,Meter_1);',
      ],
      why: 'scaled min/max swapped: reversed direction',
    },
    {
      rungs: [
        'SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Int);',
        'LES(Speed_Int,20)MOV(20,Speed_Int);',
        'GRT(Speed_Int,80)MOV(80,Speed_Int);',
        'MOV(Speed_Int,Meter_1);',
      ],
      tags: [{ name: 'Speed_Int', dataType: 'DINT' }],
      why: 'DINT speed reference loses the decimals',
    },
    {
      rungs: [
        'SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref);',
        'LES(Pot_1,10.0)MOV(10.0,Speed_Ref);',
        'GRT(Pot_1,90.0)MOV(90.0,Speed_Ref);',
        'MOV(Speed_Ref,Meter_1);',
      ],
      why: 'clamps to the input limits instead of the speed limits',
    },
    { rungs: ['CPT(Meter_1,Pot_1*0.75+20.0);', 'SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref);'], why: 'formula without the 10 % offset' },
    {
      rungs: [
        'SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref)[LES(Speed_Ref,20.0)MOV(20.0,Speed_Ref),GRT(Speed_Ref,80.0)MOV(80.0,Speed_Ref)]MOV(Speed_Ref,Meter_1);',
      ],
      why: 'MOV after a branch of compares only runs while a clamp is active',
    },
  ],
  '5-4': [
    { rungs: [...BAR([12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100], 'GRT'), BUZZER_OK], why: 'GRT instead of GEQ: boundaries wrong' },
    { rungs: [...BAR([0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5]), BUZZER_OK], why: 'off by one lamp (starts at 0 %)' },
    { rungs: [...BAR([12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100], 'LES'), BUZZER_OK], why: 'inverted bar graph' },
    { rungs: [...BAR([10, 20, 30, 40, 50, 60, 70, 80]), BUZZER_OK], why: '10 % steps instead of 12.5 %' },
    {
      rungs: [...BAR_OK.map((r) => r.replace('OTE', 'OTL')), BUZZER_OK],
      why: 'OTL: lamps never go off when the level falls',
    },
    { rungs: [...BAR_OK, 'GRT(Pot_1,90.0)OTE(Buzzer);'], why: 'buzzer only on the high side' },
    { rungs: [...BAR_OK, 'LIM(10.0,Pot_1,90.0)OTE(Buzzer);'], why: 'buzzer inside the band instead of outside' },
    { rungs: [...BAR_OK], why: 'no buzzer' },
    {
      rungs: ['MOV(Pot_1,Pot_Int);', ...BAR([12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100]).map((r) => r.replace('Pot_1', 'Pot_Int')), BUZZER_OK],
      tags: [{ name: 'Pot_Int', dataType: 'DINT' }],
      why: 'compares a rounded DINT copy: 99.9 % rounds up to 100',
    },
    { rungs: [...BAR([12.5, 25, 37.5, 50, 62.5, 75, 87.5, 99]), BUZZER_OK], why: 'last lamp before full scale' },
  ],
  '5-5': [
    {
      rungs: [SYS, RUNL, FILL, DRAIN, MIXER, 'XIC(Mixer)XIC(Mixer_Running)LES(TT_101,60.0)OTE(Heater);'],
      why: 'single setpoint, no hysteresis: chatters at 60 °C',
    },
    {
      rungs: [SYS, RUNL, FILL, DRAIN, MIXER, 'XIC(Mixer)XIC(Mixer_Running)[LES(TT_101,62.0),XIC(Heater)]LEQ(TT_101,58.0)OTE(Heater);'],
      why: 'hysteresis limits swapped',
    },
    {
      rungs: [SYS, RUNL, FILL, DRAIN, MIXER, 'XIC(Mixer)XIC(Mixer_Running)[LES(TT_101,58.0),XIC(Heater)]OTE(Heater);'],
      why: 'heater seal without an upper limit: overheats',
    },
    {
      rungs: [SYS, RUNL, FILL, DRAIN, MIXER, 'XIC(Mixer)XIC(Mixer_Running)[LES(TT_101,58.0),XIC(Heater)]LEQ(TT_101,60.0)OTE(Heater);'],
      why: 'switches off at 60 instead of 62 °C',
    },
    {
      rungs: [SYS, RUNL, FILL, DRAIN, MIXER, 'XIC(System_On)[LES(TT_101,58.0),XIC(Heater)]LEQ(TT_101,62.0)OTE(Heater);'],
      why: 'heater not interlocked with the level / mixer: heats dry',
    },
    {
      rungs: [SYS, RUNL, FILL, DRAIN, MIXER, 'XIC(Mixer)[LES(TT_101,58.0),XIC(Heater)]LEQ(TT_101,62.0)OTE(Heater);'],
      why: 'heater on the mixer command, not the proven feedback',
    },
    {
      rungs: [SYS, RUNL, FILL, DRAIN, 'XIC(System_On)XIC(LSL_101)OTE(Mixer);', HEATER],
      why: 'mixer starts at the 10 % switch instead of 20 %',
    },
    {
      rungs: [SYS, RUNL, 'XIC(System_On)LES(LT_101,60.0)OTE(Fill_Valve);', DRAIN, MIXER, HEATER],
      why: 'fill without hysteresis: refills at once when drawn below 60 %',
    },
    {
      rungs: [SYS, RUNL, 'XIC(System_On)[LES(LT_101,50.0),XIC(Fill_Valve)]LES(LT_101,50.0)OTE(Fill_Valve);', DRAIN, MIXER, HEATER],
      why: 'fill stops at 50 %',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(System_On)]XIC(Stop_PB)OTE(System_On);', RUNL, FILL, DRAIN, MIXER, HEATER],
      why: 'E-stop not in the logic: fill valve and heater keep going',
    },
    {
      rungs: [SYS, RUNL, 'XIC(System_On)[LES(LT_101,50.0),XIC(Fill_Valve)]LES(LT_101,60.0)OTE(Fill_Valve);', MIXER, HEATER],
      why: 'no drain valve',
    },
    {
      rungs: [SYS, RUNL, FILL, DRAIN, MIXER, 'XIC(Mixer)XIC(Mixer_Running)LES(TT_101,58.0)OTL(Heater);', 'GRT(TT_101,62.0)OTU(Heater);'],
      why: 'latched heater that Stop / E-stop never unlatch',
    },
    {
      rungs: ['[XIC(Start_PB),XIC(System_On)]XIC(EStop_OK)OTE(System_On);', 'XIC(Stop_PB)OTE(Running_Light);', FILL, DRAIN, MIXER, HEATER],
      why: 'Stop does not stop the system',
    },
  ],
};

export const CH5_RIGHT: WrongAnswerSet = {
  '5-1': [
    {
      rungs: ['GEQ(LT_101,80.0)OTE(Tank_Full);', '[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)XIO(Tank_Full)OTE(Fill_Valve);'],
      tags: [{ name: 'Tank_Full', dataType: 'BOOL' }],
      why: 'compare into an internal bit',
    },
    {
      rungs: ['XIC(Start_PB)LES(LT_101,80.0)OTL(Fill_Valve);', '[XIO(Stop_PB),GEQ(LT_101,80.0)]OTU(Fill_Valve);'],
      why: 'OTL / OTU',
    },
    { rungs: ['[XIC(Start_PB),XIC(Fill_Valve)]XIC(Stop_PB)LEQ(LT_101,80.0)OTE(Fill_Valve);'], why: 'LEQ instead of LES' },
  ],
  '5-2': [
    { rungs: ['MOV(Pot_1,Meter_1);', 'ADD(Pot_1,Pot_2,Pot_Sum);', 'DIV(Pot_Sum,2.0,Meter_2);'], why: 'ADD then DIV' },
    { rungs: ['MOV(Pot_1,Meter_1)ADD(Pot_1,Pot_2,Pot_Sum)MUL(Pot_Sum,0.5,Meter_2);'], why: 'one rung, inline outputs, MUL by 0.5' },
    { rungs: ['CPT(Meter_2,(Pot_2+Pot_1)*0.5);', 'MOV(Pot_1,Meter_1);'], why: 'CPT with * 0.5, rungs swapped' },
  ],
  '5-3': [
    {
      rungs: ['LIM(10.0,Pot_1,90.0)SCP(Pot_1,10.0,90.0,20.0,80.0,Meter_1);', 'LES(Pot_1,10.0)MOV(20.0,Meter_1);', 'GRT(Pot_1,90.0)MOV(80.0,Meter_1);'],
      why: 'clamp on the input with LIM',
    },
    {
      rungs: ['SCP(Pot_1,10.0,90.0,20.0,80.0,Meter_1);', 'LES(Meter_1,20.0)MOV(20.0,Meter_1);', 'GRT(Meter_1,80.0)MOV(80.0,Meter_1);'],
      why: 'clamp directly on the output',
    },
    {
      rungs: [
        'SCP(Pot_1,10.0,90.0,20.0,80.0,Speed_Ref)[LES(Speed_Ref,20.0)MOV(20.0,Speed_Ref),GRT(Speed_Ref,80.0)MOV(80.0,Speed_Ref),MOV(Speed_Ref,Meter_1)];',
      ],
      why: 'one rung: clamps and the final MOV as parallel legs (legs run top to bottom)',
    },
  ],
  '5-4': [
    {
      rungs: [
        'LIM(12.5,Pot_1,100.0)OTE(Light_0);',
        'LIM(25.0,Pot_1,100.0)OTE(Light_1);',
        'LIM(37.5,Pot_1,100.0)OTE(Light_2);',
        'LIM(50.0,Pot_1,100.0)OTE(Light_3);',
        'LIM(62.5,Pot_1,100.0)OTE(Light_4);',
        'LIM(75.0,Pot_1,100.0)OTE(Light_5);',
        'LIM(87.5,Pot_1,100.0)OTE(Light_6);',
        'GEQ(Pot_1,100.0)OTE(Light_7);',
        'LIM(90.0,Pot_1,10.0)OTE(Buzzer);',
      ],
      why: 'LIM, and a reversed LIM for the band alarm (boundary 10 / 90 exactly not tested)',
    },
    {
      rungs: [
        '[GEQ(Pot_1,12.5)OTE(Light_0),GEQ(Pot_1,25.0)OTE(Light_1),GEQ(Pot_1,37.5)OTE(Light_2),GEQ(Pot_1,50.0)OTE(Light_3)];',
        '[GEQ(Pot_1,62.5)OTE(Light_4),GEQ(Pot_1,75.0)OTE(Light_5),GEQ(Pot_1,87.5)OTE(Light_6),GEQ(Pot_1,100.0)OTE(Light_7)];',
        'LIM(10.0,Pot_1,90.0)OTE(In_Band);',
        'XIO(In_Band)OTE(Buzzer);',
      ],
      tags: [{ name: 'In_Band', dataType: 'BOOL' }],
      why: 'branches, and an in-band bit inverted',
    },
  ],
  '5-5': [
    {
      rungs: [
        SYS,
        RUNL,
        FILL,
        DRAIN,
        MIXER,
        'XIC(Mixer)XIC(Mixer_Running)OTE(Heat_Permit);',
        'XIC(Heat_Permit)LES(TT_101,58.0)OTL(Heater);',
        '[XIO(Heat_Permit),GRT(TT_101,62.0)]OTU(Heater);',
      ],
      tags: [{ name: 'Heat_Permit', dataType: 'BOOL' }],
      why: 'OTL / OTU thermostat with a permissive bit',
    },
    {
      rungs: [
        SYS,
        RUNL,
        'XIC(System_On)GEQ(LT_101,20.0)XIC(LSL_101)OTE(Level_OK);',
        'LES(LT_101,50.0)OTE(Level_Low);',
        'XIC(System_On)[XIC(Level_Low),XIC(Fill_Valve)]LES(LT_101,60.0)OTE(Fill_Valve);',
        'XIC(Level_OK)OTE(Mixer);',
        'XIC(Level_OK)XIC(Mixer)XIC(Mixer_Running)[LES(TT_101,58.0),XIC(Heater)]LES(TT_101,62.0)OTE(Heater);',
        DRAIN,
      ],
      tags: [
        { name: 'Level_OK', dataType: 'BOOL' },
        { name: 'Level_Low', dataType: 'BOOL' },
      ],
      why: 'internal permissive bits, LES 62 instead of LEQ',
    },
  ],
};
