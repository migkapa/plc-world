/**
 * Reference program for the `tank-process` skid (neutral text, I/O aliases only — no scratch memory needed: the
 * latched states are real, visible outputs: the RUNNING and BATCH DONE lamps and the drain valve).
 *
 * An automatic batch that cycles until STOP, after an operator pressed START (nothing starts by itself after
 * power-up or an E-stop reset):
 *   fill (XV-101 fast fill below 60 %, then FCV-101 trims proportionally to the remaining level up to LSH),
 *   mix once the blades are covered, heat to 62–66 °C with hysteresis (never dry, never while draining),
 *   BATCH DONE when full & hot, discharge on the DISCHARGE push button or automatically at the hold temperature,
 *   drain to empty, repeat. LSHH (N.C. fail-safe) blocks filling and sounds the horn; the E-stop drops RUNNING
 *   (and, hardwired, the agitator) and closes the drain.
 */
export const TANK_DEMO_RUNGS: string[] = [
  // Running (amber pilot): START / seal-in, N.C. STOP, N.C. E-stop
  '[XIC(Start_PB),XIC(Running_Light)]XIC(Stop_PB)XIC(EStop_OK)OTE(Running_Light);',
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
  // high-high alarm (LSHH is N.C.: 0 = level too high or wire broken)
  'XIO(LSHH_101)OTE(Alarm_Horn);',
];

/** Controls a preview harness should tap after loading the demo (nothing starts by itself). */
export const TANK_DEMO_START = ['start'];
