/**
 * Reference program for the `conveyor-sort` line (neutral text, headless — no React / three).
 *
 *  - Belt: START seals in Conveyor_Run; the N.C. STOP and the E-stop (EStop_OK) drop it. Nothing starts by itself
 *    after power-up or after an E-stop reset — an operator must press START (EN 60204-1 / NFPA 79).
 *  - Tall-box tracking: PE_Tall (beam 0.30 m above the belt) sees only tall boxes. The divert eye is 1.5 m further
 *    on and the boxes are ~1.1–1.3 m apart, so exactly one box can be between the two eyes. A tall box seen at
 *    PE_Tall is queued behind that predecessor (Tall_Seen -> Tall_Next -> Reject_Armed) and the pusher fires when
 *    the tall box itself reaches PE_Divert; Pusher_Extended (reed switch) or the E-stop retracts it. The first three
 *    boxes after power-up prime the tracker (until then the belt ahead of PE_Tall may be empty).
 *  - Feeder: in PLC feeder mode (instructor selector) the feeder drops one box per rising edge of Feeder_Release.
 *    The program pulses it once PE_Infeed has been clear for 0.8 s (the infeed zone is then free) and retries after
 *    2.5 s if no box arrived. In AUTO mode the feeder ignores the output (the pulse is harmless).
 *  - 855T: green = running, amber = stopped / ready to start, red = E-stop.
 *
 * Memory: the program uses its own BOOL / TIMER tags (CONVEYOR_DEMO_TAGS, loaded with it via
 * SceneDefinition.demoTags) — never spare outputs. CONVEYOR_DEMO_RUNGS_NO_TAGS is the same program for a bare
 * starter project (only the I/O aliases): it keeps its flags in bits 16–31 of the OB16E output word (the module has
 * 16 points, those bits have no terminal and no LED) and the feed-gap scan counter in the IB16's unused
 * CSTTimestamp[0] word — a fallback, not a pattern to copy.
 */
import type { TagDef } from '../../../plc/types';

interface TrackerMemory {
  /** PE_Infeed one-shot storage. */
  inOs: string;
  /** 1st / 2nd box seen at the infeed, tracker primed (3rd box). */
  in1: string;
  in2: string;
  primed: string;
  /** Tall box seen at PE_Tall, its predecessor is at the divert eye, reject armed for the next box at PE_Divert. */
  tallSeen: string;
  tallNext: string;
  armed: string;
}

function tracker(m: TrackerMemory, init: string[], feeder: string[]): string[] {
  return [
    // power-up: clear the tracker, pusher home (no automatic start)
    `XIC(S:FS)[OTU(${m.in1}),OTU(${m.in2}),OTU(${m.primed}),OTU(${m.tallSeen}),OTU(${m.tallNext}),OTU(${m.armed}),OTU(Pusher_Extend)${init.map((r) => `,${r}`).join('')}];`,
    // belt: START / seal-in, N.C. STOP and E-stop
    '[XIC(Start_PB),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);',
    // count the first three boxes at the infeed (until then the next tall box may have nobody ahead of it)
    `XIC(PE_Infeed)ONS(${m.inOs})[XIC(${m.in2})OTL(${m.primed}),XIC(${m.in1})OTL(${m.in2}),OTL(${m.in1})];`,
    // tall box: queue it behind its predecessor, or arm the pusher directly when the belt ahead is empty
    `XIC(PE_Tall)[XIC(${m.primed})OTL(${m.tallSeen}),XIO(${m.primed})OTL(${m.armed})];`,
    // armed + box at the divert eye -> extend the pusher
    `XIC(PE_Divert)XIC(${m.armed})XIC(EStop_OK)[OTL(Pusher_Extend),OTU(${m.armed})];`,
    // the box ahead of the tall one reaches the divert eye ...
    `XIC(PE_Divert)XIC(${m.tallSeen})[OTL(${m.tallNext}),OTU(${m.tallSeen})];`,
    // ... and leaves it: the tall box is next
    `XIO(PE_Divert)XIC(${m.tallNext})[OTL(${m.armed}),OTU(${m.tallNext})];`,
    // spring return as soon as the reed switch says "extended" (or on E-stop)
    '[XIC(Pusher_Extended),XIO(EStop_OK)]OTU(Pusher_Extend);',
    ...feeder,
    // 855T: green = running, amber = stopped / ready, red = E-stop
    'XIC(Conveyor_Run)OTE(Light_Green);',
    'XIO(Conveyor_Run)XIC(EStop_OK)OTE(Light_Amber);',
    'XIO(EStop_OK)OTE(Light_Red);',
  ];
}

// ---- fallback: works with the bare starter project (no extra tags) ----
const SCRATCH = (bit: number) => `Local:2:O.Data.${16 + bit}`;
/** Feed-gap scan counter (10 ms scans). */
const GAP_CNT = 'Local:1:I.CSTTimestamp[0]';

export const CONVEYOR_DEMO_RUNGS_NO_TAGS: string[] = tracker(
  { inOs: SCRATCH(0), in1: SCRATCH(1), in2: SCRATCH(2), primed: SCRATCH(3), tallSeen: SCRATCH(4), tallNext: SCRATCH(5), armed: SCRATCH(6) },
  [`MOV(0,${GAP_CNT})`],
  [
    // PLC feeder mode: count 10 ms scans while the belt runs and the infeed eye is clear ...
    `XIC(Conveyor_Run)XIO(PE_Infeed)ADD(${GAP_CNT},1,${GAP_CNT});`,
    // ... restart when a box arrives, or retry after 2.5 s when none came
    `[XIC(PE_Infeed),GEQ(${GAP_CNT},250)]MOV(0,${GAP_CNT});`,
    // ... release the next box after 0.8 s of clear infeed (rising edge = one box)
    `GEQ(${GAP_CNT},80)OTE(Feeder_Release);`,
  ],
);

// ---- the reference program: real tags ----
export const CONVEYOR_DEMO_TAGS: TagDef[] = [
  { name: 'Infeed_ONS', dataType: 'BOOL', description: 'One-shot storage for PE_Infeed' },
  { name: 'Infeed_Count_1', dataType: 'BOOL', description: '1st box seen at the infeed since power-up' },
  { name: 'Infeed_Count_2', dataType: 'BOOL', description: '2nd box seen at the infeed since power-up' },
  { name: 'Tracking_Primed', dataType: 'BOOL', description: 'A box is always ahead of the next tall box' },
  { name: 'Tall_Seen', dataType: 'BOOL', description: 'Tall box seen at PE_Tall, behind its predecessor' },
  { name: 'Tall_Next', dataType: 'BOOL', description: "The tall box's predecessor is at the divert eye" },
  { name: 'Reject_Armed', dataType: 'BOOL', description: 'Push the next box that reaches PE_Divert' },
  { name: 'Feed_Gap', dataType: 'TIMER', description: 'Infeed clear time (PLC feeder mode)' },
];

export const CONVEYOR_DEMO_RUNGS: string[] = tracker(
  { inOs: 'Infeed_ONS', in1: 'Infeed_Count_1', in2: 'Infeed_Count_2', primed: 'Tracking_Primed', tallSeen: 'Tall_Seen', tallNext: 'Tall_Next', armed: 'Reject_Armed' },
  ['RES(Feed_Gap)'],
  ['XIC(Conveyor_Run)XIO(PE_Infeed)TON(Feed_Gap,2500,0);', 'XIC(Feed_Gap.DN)RES(Feed_Gap);', 'GEQ(Feed_Gap.ACC,800)OTE(Feeder_Release);'],
);

/** Controls a preview harness should tap after loading the demo (nothing starts by itself). */
export const CONVEYOR_DEMO_START = ['start'];
