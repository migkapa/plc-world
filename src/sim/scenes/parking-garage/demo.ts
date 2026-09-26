/**
 * Reference program for the `parking-garage` gates (neutral text, headless — no React/three).
 *
 *  - Car counter: one COUNTER counts up (CTU) when a car has passed under the ENTRY arm (Entry_PE falling
 *    edge, OSF) and down (CTD) at the EXIT arm. FULL (red) at 12 cars, SPACES (green) below. A COUNTER is
 *    retentive: the count survives a power cycle.
 *  - Attendant key (Reset_Key): loads Count_Adjust into the count — 0 by default (empty garage). Cars that
 *    were parked without passing a gate ("Cars parked at start") are invisible to the PLC: set Count_Adjust
 *    to that number in the tag monitor and turn the key, like an attendant correcting the count on the HMI.
 *  - Entry: a driver on Entry_Loop presses Ticket_PB → the arm rises (not while FULL). It stays up while the
 *    photo-eye sees the car and closes as soon as the car is through (one ticket = one car).
 *  - Exit: a car on Exit_Loop opens the arm; it closes when the car has passed the exit photo-eye.
 *  - Safety: an arm never comes down on a car — while a photo-eye is blocked its gate is held up.
 *
 * The program needs the internal tags PARKING_DEMO_TAGS (loaded with it: SceneDefinition.demoTags).
 */
import type { TagDef } from '../../../plc/types';

/** Capacity used by the program (the 12 numbered stalls). */
export const PARKING_DEMO_CAPACITY = 12;
/** Name of the count tag (the view shows it next to the real number of cars inside). */
export const PARKING_DEMO_COUNT_TAG = 'Cars';

export const PARKING_DEMO_TAGS: TagDef[] = [
  { name: 'Cars', dataType: 'COUNTER', description: 'Cars inside: CTU at the entry arm, CTD at the exit arm' },
  { name: 'Count_Adjust', dataType: 'DINT', description: 'Count the attendant key loads (0 = empty garage)' },
  { name: 'Entry_OSF', dataType: 'BOOL', description: 'OSF storage bit for Entry_PE' },
  { name: 'Entry_Passed', dataType: 'BOOL', description: 'One scan: a car has just cleared the entry photo-eye' },
  { name: 'Exit_OSF', dataType: 'BOOL', description: 'OSF storage bit for Exit_PE' },
  { name: 'Exit_Passed', dataType: 'BOOL', description: 'One scan: a car has just cleared the exit photo-eye' },
];

export const PARKING_DEMO_RUNGS: string[] = [
  // power-up: both arms down (the count is kept: a COUNTER is retentive)
  'XIC(S:FS)[OTU(Entry_Gate_Up),OTU(Exit_Gate_Up)];',
  // a car has passed under an arm = its photo-eye goes dark → light (falling edge)
  'XIC(Entry_PE)OSF(Entry_OSF,Entry_Passed);',
  'XIC(Exit_PE)OSF(Exit_OSF,Exit_Passed);',
  // count in / out (never below zero)
  `XIC(Entry_Passed)CTU(Cars,${PARKING_DEMO_CAPACITY},0);`,
  'XIC(Exit_Passed)GRT(Cars.ACC,0)CTD(Cars,' + PARKING_DEMO_CAPACITY + ',0);',
  // attendant key: load the corrected count (0 = empty garage)
  'XIC(Reset_Key)MOV(Count_Adjust,Cars.ACC);',
  // signs
  `GEQ(Cars.ACC,${PARKING_DEMO_CAPACITY})OTE(Full_Sign);`,
  `LES(Cars.ACC,${PARKING_DEMO_CAPACITY})OTE(Open_Sign);`,
  // entry gate: a ticket taken on the loop opens it (not when full), the passed car closes it
  'XIC(Entry_Loop)XIC(Ticket_PB)XIO(Full_Sign)OTL(Entry_Gate_Up);',
  'XIC(Entry_Passed)OTU(Entry_Gate_Up);',
  // exit gate: a car on the exit loop opens it, the passed car closes it (unless the next one is waiting)
  'XIC(Exit_Loop)OTL(Exit_Gate_Up);',
  'XIC(Exit_Passed)XIO(Exit_Loop)OTU(Exit_Gate_Up);',
  // anti-crush: hold an arm up while its photo-eye is blocked
  'XIC(Entry_PE)OTL(Entry_Gate_Up);',
  'XIC(Exit_PE)OTL(Exit_Gate_Up);',
];
