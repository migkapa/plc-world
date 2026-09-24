/**
 * Reference program for the `traffic-light` intersection (neutral text, headless — no React/three).
 *
 * A semi-actuated two-phase controller like the ones in real roadside cabinets:
 *
 *   P1  NS green   — rests here (main street) for at least 10 s, then serves a call from the side-street
 *                     loop (Car_Sensor_EW) or the pedestrian button
 *   P2  NS yellow  3.5 s
 *   P3  all red    1.5 s (red clearance)            ─┐ both "all red" phases light the same lamps; the
 *   P4  EW green   7 s (9 s when a WALK is served)   │ spare bit TO_EW tells them apart
 *   P5  EW yellow  3.5 s                             │
 *   P6  all red    1.5 s  → P1                      ─┘
 *
 * The pedestrian crossing (over the MAIN street) runs with EW green: WALK for 4 s, then a flashing
 * DON'T WALK clearance until the phase ends — so WALK can never overlap NS green/yellow. Night_Mode
 * switches to flashing operation (NS flashing yellow, EW flashing red, pedestrian heads dark); leaving
 * it restarts through an all-red clearance. Power-up also starts in all red.
 *
 * Memory: the starter project contains only the I/O alias tags (no TIMER / DINT tags), so this demo
 * keeps its scratch data in unused module words and points (a teaching shortcut — in your own program
 * create proper tags):
 *   PRE  Local:1:I.DiagnosticSequenceCount   SINT, counts 10 ms scans → 0.1 s ticks
 *   TMR  Local:2:I.DiagnosticSequenceCount   SINT, tenths of a second in the current phase (≤ 12 s)
 *   Local:2:O.Pt08/09/10/11                  TO_EW, PED_CALL, PED_SERVE, NIGHT (spare output points)
 */
const PRE = 'Local:1:I.DiagnosticSequenceCount';
const TMR = 'Local:2:I.DiagnosticSequenceCount';
const TO_EW = 'Local:2:O.Pt08.Data';
const PED_CALL = 'Local:2:O.Pt09.Data';
const PED_SERVE = 'Local:2:O.Pt10.Data';
const NIGHT = 'Local:2:O.Pt11.Data';

/** Restart the sequence in P6 (all red, then NS green). */
const ALL_RED = `MOV(0,${TMR}),OTU(NS_Green),OTU(NS_Yellow),OTL(NS_Red),OTU(EW_Green),OTU(EW_Yellow),OTL(EW_Red),OTU(${TO_EW}),OTU(${PED_SERVE})`;

export const TRAFFIC_DEMO_RUNGS: string[] = [
  // power-up: clear the scratch memory, start in all red
  `XIC(S:FS)[MOV(0,${PRE}),OTU(${PED_CALL}),OTU(${NIGHT}),${ALL_RED}];`,
  // time base: 10 × 10 ms scans = one 0.1 s tick of the phase timer (saturates at 12.0 s)
  `ADD(${PRE},1,${PRE});`,
  `GEQ(${PRE},10)[MOV(0,${PRE}),LES(${TMR},120)ADD(${TMR},1,${TMR})];`,
  // pedestrian request memory (served in the next EW green)
  `XIC(Ped_PB)OTL(${PED_CALL});`,
  // ---- night flash --------------------------------------------------------------------------------
  `XIC(Night_Mode)XIO(${NIGHT})[OTL(${NIGHT}),MOV(0,${TMR}),OTU(NS_Green),OTU(NS_Red),OTU(EW_Green),OTU(EW_Yellow),OTU(${TO_EW}),OTU(${PED_SERVE})];`,
  `XIC(Night_Mode)GEQ(${TMR},10)MOV(0,${TMR});`,
  `XIC(Night_Mode)LES(${TMR},5)[OTL(NS_Yellow),OTL(EW_Red)];`,
  `XIC(Night_Mode)GEQ(${TMR},5)[OTU(NS_Yellow),OTU(EW_Red)];`,
  `XIO(Night_Mode)XIC(${NIGHT})[OTU(${NIGHT}),${ALL_RED}];`,
  // ---- day sequence -------------------------------------------------------------------------------
  // P1 → P2: minimum green done and somebody is waiting on the side street / at the crosswalk
  `XIO(Night_Mode)XIC(NS_Green)GEQ(${TMR},100)[XIC(Car_Sensor_EW),XIC(${PED_CALL})][OTU(NS_Green),OTL(NS_Yellow),MOV(0,${TMR})];`,
  // P2 → P3
  `XIO(Night_Mode)XIC(NS_Yellow)GEQ(${TMR},35)[OTU(NS_Yellow),OTL(NS_Red),OTL(${TO_EW}),MOV(0,${TMR})];`,
  // P3 → P4 (take the pedestrian call into this phase)
  `XIO(Night_Mode)XIC(NS_Red)XIC(EW_Red)XIC(${TO_EW})GEQ(${TMR},15)[OTU(EW_Red),OTL(EW_Green),OTU(${TO_EW}),MOV(0,${TMR}),XIC(${PED_CALL})OTL(${PED_SERVE}),OTU(${PED_CALL})];`,
  // P4 → P5 (7 s, or 9 s with a pedestrian crossing)
  `XIO(Night_Mode)XIC(EW_Green)[GEQ(${TMR},90),XIO(${PED_SERVE})GEQ(${TMR},70)][OTU(EW_Green),OTL(EW_Yellow),MOV(0,${TMR})];`,
  // P5 → P6
  `XIO(Night_Mode)XIC(EW_Yellow)GEQ(${TMR},35)[OTU(EW_Yellow),OTL(EW_Red),OTU(${PED_SERVE}),MOV(0,${TMR})];`,
  // P6 → P1
  `XIO(Night_Mode)XIC(NS_Red)XIC(EW_Red)XIO(${TO_EW})GEQ(${TMR},15)[OTU(NS_Red),OTL(NS_Green),MOV(0,${TMR})];`,
  // ---- pedestrian heads ---------------------------------------------------------------------------
  `XIO(Night_Mode)XIC(${PED_SERVE})XIC(EW_Green)LES(${TMR},40)OTE(Walk);`,
  // steady DON'T WALK, flashing (bit 2 of the tenths counter ≈ 75 flashes/min) during the clearance
  `XIO(Night_Mode)XIO(Walk)[XIO(${PED_SERVE}),XIC(${TMR}.2)]OTE(Dont_Walk);`,
];
