/**
 * Scene definition for `conveyor-sort` (auto-registered by ../views.tsx).
 *
 * Demo program (neutral text). The starter project only contains the I/O alias tags, so the tall-box
 * tracker keeps its state in spare OB16E output bits (Local:2:O.Data.8 … .14 — points 8-14 are not wired):
 *
 *   .8  PE_Infeed one-shot storage      .11 "tracking primed" (3rd box seen at the infeed → a box is always
 *   .9  1st box seen at the infeed           ahead of the next one reaching PE_Tall)
 *   .10 2nd box seen at the infeed      .12 tall box seen at PE_Tall, .13 its predecessor is at the divert eye,
 *                                       .14 reject armed: the next box arriving at PE_Divert is pushed off.
 *
 * With the AUTO feeder the boxes are ~1.2 m apart and PE_Tall → pusher is 1.5 m, so at most one box is between
 * the tall eye and the divert eye; the three-stage pipeline (.12 → .13 → .14) follows the tall box past that
 * predecessor. Verified headless: 0 missorts / 0 jams for all four box patterns, also across Stop / Start.
 */
import type { SceneDefinition } from '../../types';
import { conveyorSortLogic, type ConveyorSortState } from './logic';
import { ConveyorSortView } from './View';

const B = (n: number) => `Local:2:O.Data.${n}`;
const IN_OS = B(8);
const IN_1 = B(9);
const IN_2 = B(10);
const PRIMED = B(11);
const TALL_SEEN = B(12);
const TALL_NEXT = B(13);
const ARMED = B(14);

export const CONVEYOR_DEMO_RUNGS: string[] = [
  // power-up: clear the tracker, pusher home
  `XIC(S:FS)[OTU(${IN_1}),OTU(${IN_2}),OTU(${PRIMED}),OTU(${TALL_SEEN}),OTU(${TALL_NEXT}),OTU(${ARMED}),OTU(Pusher_Extend)];`,
  // belt: Start / seal-in (auto-start on power-up for the showroom), N.C. Stop and E-stop
  '[XIC(Start_PB),XIC(S:FS),XIC(Conveyor_Run)]XIC(Stop_PB)XIC(EStop_OK)OTE(Conveyor_Run);',
  // count the first three boxes at the infeed (until then the next tall box may have nobody ahead of it)
  `XIC(PE_Infeed)ONS(${IN_OS})[XIC(${IN_2})OTL(${PRIMED}),XIC(${IN_1})OTL(${IN_2}),OTL(${IN_1})];`,
  // tall box: queue it behind its predecessor, or arm the pusher directly when the belt ahead is empty
  `XIC(PE_Tall)[XIC(${PRIMED})OTL(${TALL_SEEN}),XIO(${PRIMED})OTL(${ARMED})];`,
  // armed + box at the divert eye -> extend the pusher
  `XIC(PE_Divert)XIC(${ARMED})XIC(EStop_OK)[OTL(Pusher_Extend),OTU(${ARMED})];`,
  // the box ahead of the tall one reaches the divert eye ...
  `XIC(PE_Divert)XIC(${TALL_SEEN})[OTL(${TALL_NEXT}),OTU(${TALL_SEEN})];`,
  // ... and leaves it: the tall box is next
  `XIO(PE_Divert)XIC(${TALL_NEXT})[OTL(${ARMED}),OTU(${TALL_NEXT})];`,
  // spring return as soon as the reed switch says "extended" (or on E-stop)
  '[XIC(Pusher_Extended),XIO(EStop_OK)]OTU(Pusher_Extend);',
  // 855T: green = running, amber = stopped / ready, red = E-stop
  'XIC(Conveyor_Run)OTE(Light_Green);',
  'XIO(Conveyor_Run)XIC(EStop_OK)OTE(Light_Amber);',
  'XIO(EStop_OK)OTE(Light_Red);',
];

export const definition: SceneDefinition<ConveyorSortState> = {
  logic: conveyorSortLogic,
  View: ConveyorSortView,
  cameras: [
    { id: 'overview', label: 'Overview', position: [6.4, 4.1, 7.6], target: [0.1, 0.7, -0.55] },
    { id: 'cabinet', label: 'Control cabinet', position: [-0.78, 1.36, -1.95], target: [-1.36, 1.2, -3.3] },
    { id: 'operator', label: 'Operator station', position: [-2.75, 1.75, 2.45], target: [-3.66, 1.25, 1.0] },
    { id: 'pusher', label: 'Pusher & divert', position: [2.15, 2.05, 1.4], target: [0.72, 0.8, -0.72] },
    { id: 'feeder', label: 'Box feeder', position: [-2.55, 2.25, 2.75], target: [-2.95, 1.3, 0] },
  ],
  accent: '#e8b90c',
  environment: 'hall',
  demoRungs: CONVEYOR_DEMO_RUNGS,
};
