/**
 * Test-only: plausible WRONG programs for chapter 4 (each must verify and fail at least one test) and
 * alternative CORRECT programs (`CH4_RIGHT`, each must pass). Enforced by src/game/missions.test.ts.
 * Never imported by the app.
 */
import type { TagDef } from '../../plc/types';
import type { WrongAnswerSet } from './authoring';

const bool = (...names: string[]): TagDef[] => names.map((name) => ({ name, dataType: 'BOOL' }));

// --- conveyor ---------------------------------------------------------------------
const SEAL = '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);';
const BOX_CTU = 'XIC(PE_Exit)CTU(Box_Count,1000,0);';

const B_RES = 'XIC(Start_PB)XIC(Batch_Count.DN)RES(Batch_Count);';
const B_SEAL = '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)XIO(Batch_Count.DN)OTE(Conveyor_Run);';
const B_CTU = 'XIC(PE_Exit)CTU(Batch_Count,10,0);';
const B_AMBER = 'XIC(Batch_Count.DN)OTE(Light_Amber);';

// --- trainer tally ------------------------------------------------------------------
const T_CLR = 'XIO(PB_Red)CLR(Press_Count);';
const T_MUL = 'MUL(Press_Count,10,Meter_1);';

// --- garage -------------------------------------------------------------------------
const E_OSF = 'XIC(Entry_PE)OSF(Entry_OSF,Entry_Passed);';
const E_GATE = '[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIO(Entry_Passed)OTE(Entry_Gate_Up);';
const X_OSF = 'XIC(Exit_PE)OSF(Exit_OSF,Exit_Passed);';
const X_GATE = '[XIC(Exit_Loop),XIC(Exit_Gate_Up)]XIO(Exit_Passed)OTE(Exit_Gate_Up);';
const EXIT = [X_OSF, X_GATE];
const ENTRY = [E_OSF, E_GATE];

const FULL_GATE = '[XIC(Ticket_PB)XIO(Car_Count.DN),XIC(Entry_Gate_Up)]XIO(Entry_Passed)OTE(Entry_Gate_Up);';
const C_UP = 'XIC(Entry_Passed)CTU(Car_Count,12,0);';
const C_DOWN = 'XIC(Exit_Passed)CTD(Car_Count,12,0);';
const C_RES = 'XIC(Reset_Key)RES(Car_Count);';
const SIGNS = ['XIC(Car_Count.DN)OTE(Full_Sign);', 'XIO(Car_Count.DN)OTE(Open_Sign);'];
/** Full 4-5 program with some rungs replaced. */
const house = (o: Partial<Record<'gate' | 'up' | 'down' | 'res' | 'exitGate', string>> & { signs?: string[] } = {}): string[] => [
  E_OSF,
  o.gate ?? FULL_GATE,
  X_OSF,
  o.exitGate ?? X_GATE,
  o.up ?? C_UP,
  o.down ?? C_DOWN,
  o.res ?? C_RES,
  ...(o.signs ?? SIGNS),
];

export const CH4_WRONG: WrongAnswerSet = {
  '4-1': [
    { rungs: [SEAL, 'XIC(PE_Exit)ADD(Box_Count.ACC,1,Box_Count.ACC);'], why: 'ADD on a plain contact: counts every scan' },
    { rungs: [SEAL, 'XIC(PE_Infeed)CTU(Box_Count,1000,0);'], why: 'counts at the infeed: boxes still on the belt are counted' },
    { rungs: [SEAL, 'XIC(PE_Divert)CTU(Box_Count,1000,0);'], why: 'counts at the pusher eye, not at the exit' },
    { rungs: [SEAL, BOX_CTU, 'XIC(Start_PB)RES(Box_Count);'], why: 'Start resets the shift count' },
    { rungs: [SEAL, 'XIC(PE_Exit)CTD(Box_Count,1000,0);'], why: 'CTD instead of CTU' },
    { rungs: [SEAL, 'XIC(Conveyor_Run)CTU(Box_Count,1000,0);'], why: 'counts belt starts' },
    { rungs: ['XIC(Start_PB)XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);', BOX_CTU], why: 'no seal-in' },
    { rungs: ['[XIC(Start_PB),XIC(Conveyor_Run)]XIO(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);', BOX_CTU], why: 'XIO on the N.C. stop' },
    { rungs: ['[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)OTE(Conveyor_Run);', BOX_CTU], why: 'E-stop only hardwired: restarts when released' },
    { rungs: [SEAL, 'XIC(PE_Exit)CTU(Box_Count,1000,0);', 'XIO(Conveyor_Run)RES(Box_Count);'], why: 'count cleared whenever the belt stops' },
    {
      rungs: [SEAL, 'XIC(PE_Exit)XIC(Conveyor_Run)CTU(Box_Count,1000,0);'],
      why: 'counter gated by the belt: a box that stops on the eye is counted again at the restart',
    },
    { rungs: [SEAL, BOX_CTU, 'XIO(EStop_OK)RES(Box_Count);'], why: 'the E-stop clears the shift count' },
  ],
  '4-2': [
    { rungs: [B_RES, SEAL, B_CTU, B_AMBER], why: 'belt never stops at the end of a batch' },
    { rungs: ['XIC(Start_PB)RES(Batch_Count);', B_SEAL, B_CTU, B_AMBER], why: 'every Start resets: a paused case ends up with too many boxes' },
    { rungs: [B_SEAL, B_CTU, B_AMBER], why: 'no RES: the next case can never start' },
    { rungs: [B_RES, B_SEAL, 'XIC(PE_Exit)CTU(Batch_Count,9,0);', B_AMBER], why: 'preset 9' },
    { rungs: [B_RES, B_SEAL, 'XIC(PE_Exit)CTU(Batch_Count,11,0);', B_AMBER], why: 'preset 11' },
    { rungs: [B_RES, B_SEAL, B_CTU, 'XIO(Batch_Count.DN)OTE(Light_Amber);'], why: 'amber light inverted' },
    { rungs: [B_RES, B_SEAL, B_CTU], why: 'no CASE FULL light' },
    { rungs: [B_RES, B_SEAL, 'XIC(PE_Infeed)CTU(Batch_Count,10,0);', B_AMBER], why: 'counts at the infeed: stops too early' },
    {
      rungs: [B_RES, '[XIC(Start_PB)XIO(Batch_Count.DN),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);', B_CTU, B_AMBER],
      why: 'full interlock only on the Start leg: the seal keeps the belt running',
    },
    { rungs: ['XIC(Start_PB)XIO(Batch_Count.DN)RES(Batch_Count);', B_SEAL, B_CTU, B_AMBER], why: 'RES conditioned the wrong way round' },
    {
      rungs: [B_RES, '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIO(Batch_Count.DN)OTE(Conveyor_Run);', B_CTU, B_AMBER],
      why: 'E-stop not in the seal: the belt restarts when it is released',
    },
    {
      rungs: [B_RES, B_SEAL, 'XIC(PE_Exit)XIC(Conveyor_Run)CTU(Batch_Count,10,0);', B_AMBER],
      why: 'counter gated by the belt: the box left on the eye is counted again in the next case',
    },
    { rungs: [B_RES, B_SEAL, 'XIC(PE_Exit)ADD(Batch_Count.ACC,1,Batch_Count.ACC);', 'GEQ(Batch_Count.ACC,10)OTE(Batch_Count.DN);', B_AMBER], why: 'home-made counter without an edge' },
    {
      rungs: [
        B_RES,
        'XIC(Batch_Count.DN)TON(Next_Case,6000,0);',
        'XIC(Next_Case.DN)OTE(Auto_Start);',
        'XIC(Auto_Start)RES(Batch_Count);',
        '[XIC(Start_PB),XIC(Auto_Start),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)XIO(Batch_Count.DN)OTE(Conveyor_Run);',
        B_CTU,
        B_AMBER,
      ],
      tags: [{ name: 'Next_Case', dataType: 'TIMER' }, ...bool('Auto_Start')],
      why: 'the belt starts the next case by itself 6 s after a full case: the packer never pressed Start',
    },
    {
      rungs: [B_RES, 'XIC(Batch_Count.DN)TON(Next_Case,6000,0);', 'XIC(Next_Case.DN)RES(Batch_Count);', B_SEAL, B_CTU, B_AMBER],
      tags: [{ name: 'Next_Case', dataType: 'TIMER' }],
      why: 'the full case clears itself after 6 s: CASE FULL goes out before the packer pressed Start',
    },
  ],
  '4-3': [
    {
      rungs: ['XIC(PB_Green)OSF(Green_ONS,Green_Pulse);', 'XIC(Green_Pulse)ADD(Press_Count,1,Press_Count);', T_CLR, T_MUL],
      tags: bool('Green_Pulse'),
      why: 'OSF counts on the release, not on the press',
    },
    { rungs: ['XIC(PB_Green)ONS(Green_ONS)ADD(Press_Count,1,Press_Count);', 'XIC(PB_Red)CLR(Press_Count);', T_MUL], why: 'N.C. trap: clears all the time' },
    { rungs: ['XIC(PB_Green)ONS(Green_ONS)ADD(Press_Count,1,Press_Count);', T_CLR, 'MOV(Press_Count,Meter_1);'], why: 'meter not scaled x10' },
    { rungs: ['XIC(PB_Green)ADD(Press_Count,1,Press_Count)ONS(Green_ONS)OTE(Light_0);', T_CLR, T_MUL], why: 'one-shot after the ADD: still counts every scan' },
    { rungs: ['XIC(PB_Green)ONS(Green_ONS)ADD(Press_Count,10,Press_Count);', T_CLR, 'MOV(Press_Count,Meter_1);'], why: 'adds 10 per press' },
    {
      rungs: ['XIC(PB_Green)CTU(Presses,1000,0);', 'XIO(PB_Red)RES(Presses);', 'MUL(Presses.ACC,10,Meter_1);'],
      tags: [{ name: 'Presses', dataType: 'COUNTER' }],
      why: 'counter instead of the specified Press_Count DINT',
    },
    {
      rungs: ['XIC(PB_Green)OSR(Green_ONS,Green_Pulse);', 'XIC(Green_ONS)ADD(Press_Count,1,Press_Count);', T_CLR, T_MUL],
      tags: bool('Green_Pulse'),
      why: 'ADD on the OSR storage bit instead of the output bit',
    },
    { rungs: ['XIC(PB_Green)ONS(Green_ONS)ADD(Press_Count,1,Press_Count);', T_MUL], why: 'no reset' },
    { rungs: ['XIC(PB_Green)ONS(Green_ONS)ADD(Press_Count,1,Press_Count);', 'XIO(PB_Red)MOV(1,Press_Count);', T_MUL], why: 'reset to 1' },
  ],
  '4-4': [
    { rungs: ['XIC(Ticket_PB)OTE(Entry_Gate_Up);', ...EXIT], why: 'gate only while the ticket button is held' },
    { rungs: [E_OSF, '[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIC(Entry_Loop)OTE(Entry_Gate_Up);', ...EXIT], why: 'closes when the car leaves the loop: arm on the car' },
    { rungs: ['XIC(Entry_PE)OSR(Entry_OSF,Entry_Passed);', E_GATE, ...EXIT], why: 'rising edge: closes as the car arrives under the arm' },
    { rungs: ['[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIO(Entry_PE)OTE(Entry_Gate_Up);', ...EXIT], why: 'eye in series: drops the arm on the car' },
    {
      rungs: ['[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIO(Gate_Timer.DN)OTE(Entry_Gate_Up);', 'XIC(Entry_Gate_Up)TON(Gate_Timer,6000,0);', ...EXIT],
      tags: [{ name: 'Gate_Timer', dataType: 'TIMER' }],
      why: 'timer-based close (6 s): stays up long after the car',
    },
    {
      rungs: ['[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIO(Gate_Timer.DN)OTE(Entry_Gate_Up);', 'XIC(Entry_Gate_Up)TON(Gate_Timer,2500,0);', ...EXIT],
      tags: [{ name: 'Gate_Timer', dataType: 'TIMER' }],
      why: 'timer-based close (2.5 s): comes down on the car',
    },
    { rungs: [E_OSF, '[XIC(Entry_Loop),XIC(Entry_Gate_Up)]XIO(Entry_Passed)OTE(Entry_Gate_Up);', ...EXIT], why: 'opens on the loop without a ticket' },
    { rungs: [...ENTRY, 'XIC(Exit_Loop)OTE(Exit_Gate_Up);'], why: 'exit gate follows the loop: arm on the car' },
    { rungs: [...ENTRY, 'XIC(Exit_Loop)OTL(Exit_Gate_Up);'], why: 'exit gate latched, never lowered' },
    { rungs: ['XIC(Ticket_PB)OTL(Entry_Gate_Up);', 'XIC(Entry_PE)OTU(Entry_Gate_Up);', ...EXIT], why: 'unlatched while the car is under the arm' },
    { rungs: ['[XIC(Ticket_PB),XIC(Entry_Gate_Up)]OTE(Entry_Gate_Up);', ...EXIT], why: 'entry gate never comes down' },
    { rungs: [...ENTRY], why: 'no exit gate' },
    // Not listable here: a "lucky" timer exit gate (XIC(Exit_Loop)TOF(Exit_TOF,300,0) -> Exit_Gate_Up) passes
    // every test because simulated cars always drive off the loop at full speed. 4-4 keeps the timers out of
    // its palette instead (this suite runs wrong answers with the palette disabled).
  ],
  '4-5': [
    {
      rungs: [
        E_OSF,
        '[XIC(Ticket_PB),XIC(Entry_Gate_Up)]XIO(Entry_Passed)XIO(Car_Count.DN)OTE(Entry_Gate_Up);',
        ...EXIT,
        'XIC(Entry_PE)ONS(Count_ONS)CTU(Car_Count,12,0);',
        C_DOWN,
        C_RES,
        ...SIGNS,
      ],
      tags: bool('Count_ONS'),
      why: 'full interlock in series with the seal + counting on the rising edge: the arm drops on the 12th car',
    },
    { rungs: house({ gate: E_GATE }), why: 'no full interlock: a 13th car gets in' },
    { rungs: house({ down: '' }), why: 'no CTD: the count never goes down' },
    {
      rungs: house({ down: 'XIC(Exit_Passed)CTD(Cars_Out,12,0);' }),
      tags: [{ name: 'Cars_Out', dataType: 'COUNTER' }],
      why: 'CTD on a different counter',
    },
    { rungs: house({ signs: ['XIC(Car_Count.DN)OTE(Full_Sign);'] }), why: 'SPACES sign never lit' },
    { rungs: house({ signs: ['XIO(Car_Count.DN)OTE(Full_Sign);', 'XIC(Car_Count.DN)OTE(Open_Sign);'] }), why: 'signs swapped' },
    { rungs: house({ up: 'XIC(Entry_Passed)CTU(Car_Count,11,0);', down: 'XIC(Exit_Passed)CTD(Car_Count,11,0);' }), why: 'full at 11 cars' },
    { rungs: house({ res: '' }), why: 'no attendant reset' },
    { rungs: house({ res: 'XIO(Reset_Key)RES(Car_Count);' }), why: 'reset key inverted: count cleared all the time' },
    { rungs: house({ up: 'XIC(Ticket_PB)CTU(Car_Count,12,0);' }), why: 'counts tickets instead of cars' },
    {
      rungs: house({ exitGate: '[XIC(Exit_Loop)XIO(Car_Count.DN),XIC(Exit_Gate_Up)]XIO(Exit_Passed)OTE(Exit_Gate_Up);' }),
      why: 'exit gate also blocked when full: nobody can leave',
    },
    { rungs: house({ up: 'XIC(Entry_PE)CTU(Car_Count,12,0);', down: 'XIC(Exit_PE)CTU(Car_Count,12,0);' }), why: 'exits counted up' },
    { rungs: house({ up: 'XIC(Entry_Loop)CTU(Car_Count,12,0);' }), why: 'counts arrivals on the loop' },
    { rungs: house({ up: 'XIC(Entry_Gate_Up)CTU(Car_Count,12,0);' }), why: 'counts gate openings: the car is counted before it is in' },
    { rungs: house({ up: 'XIC(Ticket_PB)XIO(Car_Count.DN)CTU(Car_Count,12,0);' }), why: 'counts accepted tickets: the car is counted before it is in' },
    { rungs: house({ down: 'XIC(Exit_Loop)CTD(Car_Count,12,0);' }), why: 'counts out on the exit loop: the leaving car is still inside' },
    { rungs: house({ down: 'XIC(Exit_Gate_Up)CTD(Car_Count,12,0);' }), why: 'counts out on the exit gate opening: the leaving car is still inside' },
  ],
};

export const CH4_RIGHT: WrongAnswerSet = {
  '4-1': [
    { rungs: [SEAL, 'XIO(PE_Exit)CTU(Box_Count,1000,0);'], why: 'counts when a box leaves the eye (falling edge)' },
    {
      rungs: ['XIC(Stop_PB)XIC(EStop_OK)[XIC(Start_PB),XIC(Conveyor_Run)]OTE(Conveyor_Run);', 'XIC(PE_Exit)ONS(Exit_ONS)CTU(Box_Count,1000,0);'],
      tags: bool('Exit_ONS'),
      why: 'interlocks before the branch; redundant one-shot',
    },
    {
      rungs: [SEAL, 'XIC(PE_Exit)TON(Exit_Deb,50,0);', 'XIC(Exit_Deb.DN)CTU(Box_Count,1000,0);'],
      tags: [{ name: 'Exit_Deb', dataType: 'TIMER' }],
      why: 'debounced eye (50 ms on-delay) drives the counter',
    },
  ],
  '4-2': [
    { rungs: [B_RES, B_SEAL, 'XIO(PE_Exit)CTU(Batch_Count,10,0);', B_AMBER], why: 'counts when a box leaves the eye' },
    { rungs: [B_SEAL, B_CTU, B_RES, B_AMBER], why: 'RES rung after the seal-in' },
    {
      rungs: [
        'XIC(Start_PB)XIC(Batch_Count.DN)RES(Batch_Count);',
        'XIO(Batch_Count.DN)XIC(Stop_PB)XIC(EStop_OK)[XIC(Start_PB),XIC(Conveyor_Run)]OTE(Conveyor_Run);',
        B_CTU,
        'XIO(Batch_Count.DN)OTE(Batch_Busy);',
        'XIO(Batch_Busy)OTE(Light_Amber);',
      ],
      tags: bool('Batch_Busy'),
      why: 'permissives before the branch; amber light through an internal bit',
    },
  ],
  '4-3': [
    {
      rungs: ['XIC(PB_Green)OSR(Green_ONS,Green_Pulse);', 'XIC(Green_Pulse)ADD(Press_Count,1,Press_Count);', T_CLR, T_MUL],
      tags: bool('Green_Pulse'),
      why: 'OSR output bit drives the ADD',
    },
    {
      rungs: ['XIC(PB_Green)XIO(Green_ONS)ADD(Press_Count,1,Press_Count);', 'XIC(PB_Green)OTE(Green_ONS);', 'XIO(PB_Red)MOV(0,Press_Count);', 'CPT(Meter_1,Press_Count*10);'],
      why: 'home-made one-shot, MOV 0 and CPT',
    },
    {
      rungs: ['XIC(PB_Green)ONS(Green_ONS)CPT(Press_Count,Press_Count+1);', T_CLR, T_MUL],
      why: 'CPT instead of ADD for the tally',
    },
  ],
  '4-4': [
    {
      rungs: [E_OSF, 'XIC(Ticket_PB)OTL(Entry_Gate_Up);', 'XIC(Entry_Passed)OTU(Entry_Gate_Up);', X_OSF, 'XIC(Exit_Loop)OTL(Exit_Gate_Up);', 'XIC(Exit_Passed)OTU(Exit_Gate_Up);'],
      why: 'OTL on the request, OTU on the falling edge',
    },
    {
      rungs: [E_OSF, '[XIC(Ticket_PB),XIC(Entry_Gate_Up),XIC(Entry_PE)]XIO(Entry_Passed)OTE(Entry_Gate_Up);', ...EXIT],
      why: 'the eye also holds the arm up',
    },
    {
      rungs: [
        'XIC(Entry_Gate_Up)[XIC(Entry_PE),XIC(Entry_OSF)]OTE(Entry_OSF);',
        '[XIC(Ticket_PB),XIC(Entry_Gate_Up)][XIO(Entry_OSF),XIC(Entry_PE)]OTE(Entry_Gate_Up);',
        'XIC(Exit_Gate_Up)[XIC(Exit_PE),XIC(Exit_OSF)]OTE(Exit_OSF);',
        '[XIC(Exit_Loop),XIC(Exit_Gate_Up)][XIO(Exit_OSF),XIC(Exit_PE)]OTE(Exit_Gate_Up);',
      ],
      why: '"car seen" memory instead of a one-shot',
    },
    {
      rungs: ['XIO(Entry_PE)ONS(Entry_OSF)OTE(Entry_Passed);', E_GATE, 'XIO(Exit_PE)ONS(Exit_OSF)OTE(Exit_Passed);', X_GATE],
      why: 'ONS on XIO of the eye as a falling-edge detector',
    },
  ],
  '4-5': [
    { rungs: house({ up: 'XIO(Entry_PE)CTU(Car_Count,12,0);', down: 'XIO(Exit_PE)CTD(Car_Count,12,0);' }), why: 'counters on XIO of the eyes (falling edge)' },
    {
      rungs: house({ up: 'XIC(Entry_PE)ONS(Count_ONS)CTU(Car_Count,12,0);' }),
      tags: bool('Count_ONS'),
      why: 'counts on the rising edge; full interlock only on the ticket leg',
    },
    { rungs: house({ signs: ['XIC(Car_Count.DN)OTE(Full_Sign);', 'XIO(Full_Sign)OTE(Open_Sign);'] }), why: 'SPACES from the FULL bit' },
    {
      rungs: house({ up: 'XIO(Entry_PE)ONS(Up_ONS)CTU(Car_Count,12,0);', down: 'XIO(Exit_PE)ONS(Down_ONS)CTD(Car_Count,12,0);' }),
      tags: bool('Up_ONS', 'Down_ONS'),
      why: 'ONS on XIO of the eyes (falling edge) for both counts',
    },
    {
      rungs: house({ down: 'XIC(Exit_PE)ONS(Down_ONS)CTD(Car_Count,12,0);' }),
      tags: bool('Down_ONS'),
      why: 'counts out on the rising edge of the exit eye (the car is under the arm, on its way out)',
    },
  ],
};
