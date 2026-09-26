/**
 * Reference program for the `traffic-light` intersection (neutral text, headless — no React/three).
 *
 * A semi-actuated two-phase controller like the ones in real roadside cabinets, written as a
 * step sequencer: the DINT `Phase` holds the current interval and one TON times each interval.
 *
 *   Phase 1  NS green    rests here (main street); after the 10 s minimum green a call from the
 *                        side-street loop (Car_Sensor_EW) or the pedestrian button ends it
 *   Phase 2  NS yellow   3.5 s
 *   Phase 3  all red     1.5 s red clearance, then the side street
 *   Phase 4  EW green    7 s — or, with a pedestrian call, WALK 5 s + flashing DON'T WALK 7 s = 12 s
 *   Phase 5  EW yellow   3.5 s
 *   Phase 6  all red     1.5 s red clearance, then back to phase 1 (power-up and night recovery start here)
 *
 * The crosswalk (over the MAIN street, 7 m) runs with EW green, so WALK can never overlap NS green or
 * yellow. Pedestrian clearance: 7 m ÷ 1.07 m/s ≈ 6.5 s → 7 s flashing DON'T WALK, then the 3.5 s yellow +
 * 1.5 s all red as the buffer interval. Night_Mode puts the intersection into flashing operation
 * (NS flashing yellow, EW flashing red, 60 flashes/min, pedestrian heads dark); leaving it restarts the
 * sequence through phase 6 (all red).
 *
 * The program needs the internal tags TRAFFIC_DEMO_TAGS (loaded with it: SceneDefinition.demoTags).
 */
import type { TagDef } from '../../../plc/types';

export const TRAFFIC_DEMO_TAGS: TagDef[] = [
  { name: 'Phase', dataType: 'DINT', description: 'Signal phase: 1 NS green, 2 NS yellow, 3 all red, 4 EW green, 5 EW yellow, 6 all red' },
  { name: 'NS_Min_Green', dataType: 'TIMER', description: 'Main-street minimum green (10 s)' },
  { name: 'NS_Yellow_Tmr', dataType: 'TIMER', description: 'Main-street yellow change interval (3.5 s)' },
  { name: 'All_Red_Tmr', dataType: 'TIMER', description: 'Red clearance interval, phases 3 and 6 (1.5 s)' },
  { name: 'EW_Green_Tmr', dataType: 'TIMER', description: 'Side-street green (7 s)' },
  { name: 'Walk_Tmr', dataType: 'TIMER', description: 'WALK interval (5 s)' },
  { name: 'Ped_Clear_Tmr', dataType: 'TIMER', description: "Pedestrian clearance, flashing DON'T WALK (7 s)" },
  { name: 'EW_Yellow_Tmr', dataType: 'TIMER', description: 'Side-street yellow change interval (3.5 s)' },
  { name: 'Flash_Tmr', dataType: 'TIMER', description: 'Free-running 1 s flasher (60 flashes/min)' },
  { name: 'Flash_On', dataType: 'BOOL', description: 'Flasher output: on for the first half of every second' },
  { name: 'Ped_Call', dataType: 'BOOL', description: 'Pedestrian request memory (the button is only 1 while pressed)' },
  { name: 'Ped_Served', dataType: 'BOOL', description: 'The current side-street green serves a WALK' },
];

export const TRAFFIC_DEMO_RUNGS: string[] = [
  // power-up: start in all red (phase 6), forget old requests
  'XIC(S:FS)[MOV(6,Phase),OTU(Ped_Call),OTU(Ped_Served)];',
  // flasher: the timer restarts itself when done → 1 s period, lamp on for the first 500 ms
  'XIO(Flash_Tmr.DN)TON(Flash_Tmr,1000,0);',
  'LES(Flash_Tmr.ACC,500)OTE(Flash_On);',
  // remember a pedestrian request until it is served
  'XIC(Ped_PB)OTL(Ped_Call);',
  // night flash: hold the sequence in phase 6, so it restarts through all red when the key is turned back
  'XIC(Night_Mode)[MOV(6,Phase),OTU(Ped_Served)];',
  // ---- phase 1: NS green (minimum 10 s, then serve a call) ----
  'XIO(Night_Mode)EQU(Phase,1)TON(NS_Min_Green,10000,0);',
  'EQU(Phase,1)XIC(NS_Min_Green.DN)[XIC(Car_Sensor_EW),XIC(Ped_Call)]MOV(2,Phase);',
  // ---- phase 2: NS yellow ----
  'XIO(Night_Mode)EQU(Phase,2)TON(NS_Yellow_Tmr,3500,0);',
  'EQU(Phase,2)XIC(NS_Yellow_Tmr.DN)MOV(3,Phase);',
  // ---- phases 3 and 6: all red ----
  'XIO(Night_Mode)[EQU(Phase,3),EQU(Phase,6)]TON(All_Red_Tmr,1500,0);',
  'EQU(Phase,3)XIC(All_Red_Tmr.DN)[MOV(4,Phase),XIC(Ped_Call)OTL(Ped_Served),OTU(Ped_Call)];',
  'EQU(Phase,6)XIC(All_Red_Tmr.DN)MOV(1,Phase);',
  // ---- phase 4: EW green (WALK + clearance when a pedestrian is served) ----
  'XIO(Night_Mode)EQU(Phase,4)TON(EW_Green_Tmr,7000,0);',
  'XIO(Night_Mode)EQU(Phase,4)XIC(Ped_Served)TON(Walk_Tmr,5000,0);',
  'XIO(Night_Mode)EQU(Phase,4)XIC(Walk_Tmr.DN)TON(Ped_Clear_Tmr,7000,0);',
  'EQU(Phase,4)XIC(EW_Green_Tmr.DN)[XIO(Ped_Served),XIC(Ped_Clear_Tmr.DN)]MOV(5,Phase);',
  // ---- phase 5: EW yellow ----
  'XIO(Night_Mode)EQU(Phase,5)TON(EW_Yellow_Tmr,3500,0);',
  'EQU(Phase,5)XIC(EW_Yellow_Tmr.DN)[MOV(6,Phase),OTU(Ped_Served)];',
  // ---- lamps (one rung per output) ----
  'XIO(Night_Mode)EQU(Phase,1)OTE(NS_Green);',
  '[XIO(Night_Mode)EQU(Phase,2),XIC(Night_Mode)XIC(Flash_On)]OTE(NS_Yellow);',
  'XIO(Night_Mode)GEQ(Phase,3)OTE(NS_Red);',
  'XIO(Night_Mode)EQU(Phase,4)OTE(EW_Green);',
  'XIO(Night_Mode)EQU(Phase,5)OTE(EW_Yellow);',
  '[XIO(Night_Mode)[LEQ(Phase,3),EQU(Phase,6)],XIC(Night_Mode)XIC(Flash_On)]OTE(EW_Red);',
  // pedestrian head: WALK, then flashing DON'T WALK until the end of the green, otherwise steady
  'XIO(Night_Mode)EQU(Phase,4)XIC(Ped_Served)XIO(Walk_Tmr.DN)OTE(Walk);',
  'XIO(Night_Mode)XIO(Walk)[XIO(Ped_Served),XIO(Walk_Tmr.DN),XIC(Flash_On)]OTE(Dont_Walk);',
];
