/**
 * Campaign chapters. Mission ids are `<chapter order>-<mission order>` (e.g. '2-3') and each mission's
 * `chapter` field is the chapter `id` below. Headless (no React / DOM).
 */
import type { ChapterDef } from './types';

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'power-up',
    order: 1,
    title: 'Power Up',
    subtitle: 'Bits, contacts & coils',
    icon: 'Zap',
    color: '#f5c400',
    description:
      'Your first day at Riverside Manufacturing. On the ControlLogix trainer bench you learn how a PLC reads ' +
      'field devices and drives outputs: XIC, XIO and OTE, series (AND) and parallel (OR) logic, and the ' +
      'normally-closed button trap every new tech falls into once.',
  },
  {
    id: 'motor-control',
    order: 2,
    title: 'Motor Control',
    subtitle: 'Seal-in, interlocks, latches, jog & HOA',
    icon: 'Cog',
    color: '#22c55e',
    description:
      'Line 3 has a 5 HP conveyor motor on a contactor and overload relay. Build the classic start/stop ' +
      'seal-in, wire up pilot lights from real feedback, make the E-stop and overload drop the motor for ' +
      'good, then add latches, jog and a Hand-Off-Auto selector.',
  },
  {
    id: 'timing',
    order: 3,
    title: 'Timing Is Everything',
    subtitle: 'TON, TOF, RTO, flashers & sequences',
    icon: 'Timer',
    color: '#38bdf8',
    description:
      'Delays, flashers and timed sequences: on-delay and off-delay timers, the retentive timer, ' +
      'self-resetting pulse generators and the timing of a real traffic intersection.',
  },
  {
    id: 'counting',
    order: 4,
    title: 'Counting & Tracking',
    subtitle: 'CTU, CTD, RES & one-shots',
    icon: 'Hash',
    color: '#a78bfa',
    description:
      'Count boxes, cars and cycles: up/down counters, resets, one-shots (ONS/OSR) and why an edge ' +
      'matters when a scan takes only a few milliseconds.',
  },
  {
    id: 'analog',
    order: 5,
    title: 'Analog & Math',
    subtitle: 'Compare, math, SCP, CPT & hysteresis',
    icon: 'Gauge',
    color: '#f97316',
    description:
      'Real numbers from real transmitters: comparisons, math and scaling (SCP, CPT), deadbands and ' +
      'hysteresis so valves and heaters do not chatter — on the mixing & heating tank.',
  },
  {
    id: 'sequencing',
    order: 6,
    title: 'Sequencing',
    subtitle: 'Step logic, state machines, SQO & BSL',
    icon: 'Workflow',
    color: '#14b8a6',
    description:
      'Machines run in steps. Build state machines with a step number, drive outputs from a sequencer ' +
      '(SQO) and track parts down a conveyor with a bit shift register (BSL).',
  },
  {
    id: 'troubleshooting',
    order: 7,
    title: 'Troubleshooting',
    subtitle: 'Fix broken programs & failed sensors',
    icon: 'Wrench',
    color: '#e0252b',
    description:
      'The night shift calls: the line is down. Read the logic, watch the I/O, think about forces and ' +
      'failed sensors, and fix programs that someone else broke.',
  },
];

/** Chapter by id (undefined for unknown ids). */
export function getChapter(id: string): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

/** Chapter by its 1-based order. */
export function chapterByOrder(order: number): ChapterDef | undefined {
  return CHAPTERS.find((c) => c.order === order);
}
