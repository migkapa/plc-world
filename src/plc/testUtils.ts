/**
 * Helpers for building small projects in tests (engine tests, mission tests, sandbox experiments).
 */
import { createController, type ControllerOptions, type LogixController } from './controller';
import { parseRung } from './neutralText';
import type { HardwareConfig, Project, TagDef, Task } from './types';
import { formatVerifyError } from './verify';

/** ControlLogix bench: L85E, IB16 (slot 1), OB16E (2), IF8 (3), OF8 (4), EN2T (5). */
export const TEST_HARDWARE: HardwareConfig = {
  platform: 'ControlLogix',
  chassis: '1756-A7',
  powerSupply: '1756-PA72',
  modules: [
    { slot: 0, catalog: '1756-L85E' },
    { slot: 1, catalog: '1756-IB16', name: 'DI' },
    { slot: 2, catalog: '1756-OB16E', name: 'DO' },
    { slot: 3, catalog: '1756-IF8', name: 'AI' },
    { slot: 4, catalog: '1756-OF8', name: 'AO' },
    { slot: 5, catalog: '1756-EN2T' },
  ],
};

/** CompactLogix 5380: L320ER, 5069-IB16 (1), OB16 (2), IF8 (3), OF4 (4). */
export const TEST_HARDWARE_5380: HardwareConfig = {
  platform: 'CompactLogix',
  modules: [
    { slot: 0, catalog: '5069-L320ER' },
    { slot: 1, catalog: '5069-IB16' },
    { slot: 2, catalog: '5069-OB16' },
    { slot: 3, catalog: '5069-IF8' },
    { slot: 4, catalog: '5069-OF4' },
  ],
};

export interface TestProjectOptions {
  hardware?: HardwareConfig;
  /** Additional routines of MainProgram (neutral text rungs). */
  routines?: Record<string, string[]>;
  /** MainProgram-scoped tags. */
  programTags?: TagDef[];
  /** Extra tasks (e.g. PERIODIC) — MainTask/MainProgram always exist. */
  tasks?: Task[];
  extraPrograms?: Project['programs'];
}

/** Build a one-program project from neutral text rungs. */
export function makeProject(rungs: string[], tags: TagDef[] = [], opts: TestProjectOptions = {}): Project {
  return {
    controllerName: 'Test_PLC',
    hardware: opts.hardware ?? TEST_HARDWARE,
    tags,
    tasks: [{ name: 'MainTask', type: 'CONTINUOUS', programs: ['MainProgram'] }, ...(opts.tasks ?? [])],
    programs: [
      {
        name: 'MainProgram',
        mainRoutine: 'MainRoutine',
        tags: opts.programTags ?? [],
        routines: [
          { name: 'MainRoutine', type: 'RLL', rungs: rungs.map((r) => parseRung(r)) },
          ...Object.entries(opts.routines ?? {}).map(([name, rs]) => ({
            name,
            type: 'RLL' as const,
            rungs: rs.map((r) => parseRung(r)),
          })),
        ],
      },
      ...(opts.extraPrograms ?? []),
    ],
  };
}

/** Create a controller for the rungs and put it in REM_RUN (throws with the verify errors if refused). */
export function runLogic(
  rungs: string[],
  tags: TagDef[] = [],
  opts: TestProjectOptions & ControllerOptions = {},
): LogixController {
  const plc = createController(makeProject(rungs, tags, opts), opts);
  if (!plc.requestMode('RUN')) {
    const errs = plc.verify().filter((e) => e.severity === 'error');
    throw new Error(`Controller refused to run:\n${errs.map(formatVerifyError).join('\n')}`);
  }
  return plc;
}

/** Scan `n` times with a fixed dt. */
export function scanN(plc: LogixController, n: number, dtMs = 10): void {
  for (let i = 0; i < n; i++) plc.scan(dtMs);
}

/** Shorthand tag definitions. */
export const bool = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'BOOL', ...extra });
export const dint = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'DINT', ...extra });
export const int = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'INT', ...extra });
export const sint = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'SINT', ...extra });
export const real = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'REAL', ...extra });
export const timer = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'TIMER', ...extra });
export const counter = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'COUNTER', ...extra });
export const control = (name: string, extra: Partial<TagDef> = {}): TagDef => ({ name, dataType: 'CONTROL', ...extra });
