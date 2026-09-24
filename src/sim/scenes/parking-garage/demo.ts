/**
 * Reference program for the `parking-garage` gates (neutral text, headless — no React/three).
 *
 *  - Car counter: +1 when a car has passed under the ENTRY arm (Entry_PE falling edge), −1 at the EXIT
 *    arm; the attendant's Reset_Key sets it back to 0. FULL (red) at 12 cars, SPACES (green) below.
 *  - Entry: a driver on Entry_Loop presses Ticket_PB → the arm rises (not while FULL). It stays up while
 *    the photo-eye sees the car and closes as soon as the car is through (one ticket = one car).
 *  - Exit: a car on Exit_Loop opens the arm; it closes when the car has passed the exit photo-eye.
 *  - Safety: an arm never comes down on a car — while a photo-eye is blocked its gate is held up.
 *
 * Memory: the starter project has only the I/O alias tags (no COUNTER / DINT tags), so the demo keeps
 * the count in an unused module word and its one-shot bits in spare output points (a teaching
 * shortcut — the chapter 4 missions build the same logic with a real COUNTER tag):
 *   CNT  Local:1:I.DiagnosticSequenceCount   SINT, cars inside
 *   Local:2:O.Pt04 / Pt05  OSF storage (entry / exit photo-eye), Pt06 / Pt07 "car passed" pulses
 */
const CNT = 'Local:1:I.DiagnosticSequenceCount';
const ENT_ST = 'Local:2:O.Pt04.Data';
const EXIT_ST = 'Local:2:O.Pt05.Data';
const ENT_PASSED = 'Local:2:O.Pt06.Data';
const EXIT_PASSED = 'Local:2:O.Pt07.Data';

export const PARKING_DEMO_RUNGS: string[] = [
  // power-up: empty garage
  `XIC(S:FS)[MOV(0,${CNT}),OTU(Entry_Gate_Up),OTU(Exit_Gate_Up)];`,
  // car passed under an arm = photo-eye goes dark → light (falling edge)
  `XIC(Entry_PE)OSF(${ENT_ST},${ENT_PASSED});`,
  `XIC(Exit_PE)OSF(${EXIT_ST},${EXIT_PASSED});`,
  // count
  `XIC(${ENT_PASSED})LES(${CNT},99)ADD(${CNT},1,${CNT});`,
  `XIC(${EXIT_PASSED})GRT(${CNT},0)SUB(${CNT},1,${CNT});`,
  'XIC(Reset_Key)MOV(0,' + CNT + ');',
  // signs
  `GEQ(${CNT},12)OTE(Full_Sign);`,
  `LES(${CNT},12)OTE(Open_Sign);`,
  // entry gate: ticket on the loop opens it (not when full), the passed car closes it
  'XIC(Entry_Loop)XIC(Ticket_PB)XIO(Full_Sign)OTL(Entry_Gate_Up);',
  `XIC(${ENT_PASSED})OTU(Entry_Gate_Up);`,
  // exit gate: a car on the exit loop opens it, the passed car closes it
  'XIC(Exit_Loop)OTL(Exit_Gate_Up);',
  `XIC(${EXIT_PASSED})XIO(Exit_Loop)OTU(Exit_Gate_Up);`,
  // anti-crush: hold an arm up while its photo-eye is blocked
  'XIC(Entry_PE)OTL(Entry_Gate_Up);',
  'XIC(Exit_PE)OTL(Exit_Gate_Up);',
];
