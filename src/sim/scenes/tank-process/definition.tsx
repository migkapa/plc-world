/**
 * Scene definition for `tank-process` (auto-registered by ../views.tsx).
 *
 * Demo program (neutral text, I/O aliases only): an automatic batch that cycles forever —
 *   fill (XV-101 fast fill below 60 %, then FCV-101 trims proportionally to the remaining level up to LSH),
 *   mix once the blades are covered, heat to 62–66 °C with hysteresis (never dry), BATCH DONE when full & hot,
 *   discharge on the push button or automatically at the hold temperature, drain to empty, repeat.
 *   LSHH (N.C.) blocks filling and sounds the horn; E-stop drops everything and closes the drain.
 * Verified headless: a batch every ~110 s, 0 spills, 0 dry heating, no agitator dry run.
 */
import type { SceneDefinition } from '../../types';
import { tankProcessLogic, type TankProcessState } from './logic';
import { TankProcessView } from './View';

export const TANK_DEMO_RUNGS: string[] = [
  // Running (amber pilot): auto-start on power-up for the showroom, Start / N.C. Stop / N.C. E-stop
  '[XIC(Start_PB),XIC(S:FS),XIC(Running_Light)]XIC(Stop_PB)XIC(EStop_OK)OTE(Running_Light);',
  // fast fill through XV-101 while below 60 %
  'XIC(Running_Light)XIO(Drain_Valve)XIO(Batch_Done_Light)XIC(LSHH_101)LES(LT_101,60.0)OTE(Fill_Valve);',
  // FCV-101 trims the rest: opening proportional to the remaining level, closed at LSH
  'XIC(Running_Light)XIO(Drain_Valve)XIO(Batch_Done_Light)XIC(LSHH_101)XIO(LSH_101)CPT(FCV_101,(92.0-LT_101)*4.0);',
  '[XIO(Running_Light),XIC(Drain_Valve),XIC(Batch_Done_Light),XIO(LSHH_101),XIC(LSH_101)]MOV(0.0,FCV_101);',
  // agitator only with the blades covered
  'XIC(Running_Light)XIC(LSL_101)GEQ(LT_101,12.0)OTE(Mixer);',
  // heater 62..66 C (seal-in hysteresis), never below LSL, off while discharging
  'XIC(Running_Light)XIC(LSL_101)XIO(Drain_Valve)[LES(TT_101,62.0),XIC(Heater)LES(TT_101,66.0)]OTE(Heater);',
  // batch done: full and hot
  'XIC(LSH_101)GEQ(TT_101,60.0)OTL(Batch_Done_Light);',
  // discharge: push button, or automatically at the hold temperature
  'XIC(Batch_Done_Light)[XIC(Discharge_PB),GEQ(TT_101,65.0)]OTL(Drain_Valve);',
  'LES(LT_101,1.0)[OTU(Drain_Valve),OTU(Batch_Done_Light)];',
  'XIO(EStop_OK)OTU(Drain_Valve);',
  // high-high alarm
  'XIO(LSHH_101)OTE(Alarm_Horn);',
];

export const definition: SceneDefinition<TankProcessState> = {
  logic: tankProcessLogic,
  View: TankProcessView,
  cameras: [
    { id: 'overview', label: 'Overview', position: [4.7, 3.7, 5.9], target: [-0.7, 1.15, -0.45] },
    { id: 'cabinet', label: 'Control cabinet', position: [3.55, 1.42, -1.55], target: [2.98, 1.2, -2.95] },
    { id: 'operator', label: 'Operator panel', position: [2.35, 1.5, 2.1], target: [1.9, 1.15, 1.35] },
    { id: 'tank', label: 'Tank cut-away', position: [1.55, 2.25, 2.45], target: [0, 1.35, 0] },
    { id: 'valves', label: 'Valve station', position: [-0.85, 1.55, 1.75], target: [-1.9, 1.0, -0.14] },
  ],
  accent: '#38bdf8',
  environment: 'hall',
  demoRungs: TANK_DEMO_RUNGS,
};
