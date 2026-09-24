/**
 * Starter projects for scenes: controller 'PLC_World', the scene's hardware, one alias tag per wired
 * I/O point (description = field device), the scene's extra tags and
 * MainTask (CONTINUOUS) > MainProgram > MainRoutine.
 * Headless (no React / DOM / three imports).
 */
import { parseRung } from '../plc/neutralText';
import type { DataTypeName, Project, Routine, Rung, TagDef } from '../plc/types';
import type { SceneLogic } from './types';

/** The parts of a scene needed to build its project. */
export type SceneProjectSource = Pick<SceneLogic<unknown>, 'hardware' | 'io'> & Partial<Pick<SceneLogic<unknown>, 'id' | 'title' | 'extraTags'>>;

export interface SceneProjectOptions {
  /** Rung comments (index-aligned with `rungs` when given as text). */
  comments?: ReadonlyArray<string | undefined>;
  /** Additional controller-scoped tags (e.g. a mission's starter tags); replace same-named tags. */
  tags?: TagDef[];
  controllerName?: string;
  description?: string;
}

export const DEFAULT_CONTROLLER_NAME = 'PLC_World';
export const MAIN_TASK = 'MainTask';
export const MAIN_PROGRAM = 'MainProgram';
export const MAIN_ROUTINE = 'MainRoutine';

const lower = (s: string): string => s.toLowerCase();

/** Convert neutral text (or clone rung objects) into rungs; an empty list yields one empty rung. */
export function toRungs(rungs: ReadonlyArray<string> | ReadonlyArray<Rung> | undefined, comments?: ReadonlyArray<string | undefined>): Rung[] {
  const list = (rungs ?? []) as ReadonlyArray<string | Rung>;
  const out = list.map((r, i) => {
    if (typeof r === 'string') {
      const comment = comments?.[i];
      return comment !== undefined ? parseRung(r, comment) : parseRung(r);
    }
    return structuredClone(r);
  });
  return out.length > 0 ? out : [parseRung('')];
}

function mergeTags(base: TagDef[], extra: ReadonlyArray<TagDef> | undefined): TagDef[] {
  if (!extra) return base;
  const out = [...base];
  for (const t of extra) {
    const i = out.findIndex((x) => lower(x.name) === lower(t.name));
    const copy = structuredClone(t);
    if (i >= 0) out[i] = copy;
    else out.push(copy);
  }
  return out;
}

/** Alias tags for the scene's wired I/O points. */
export function aliasTagsForScene(scene: SceneProjectSource): TagDef[] {
  return scene.io.map((p) => {
    const dataType: DataTypeName = p.signal === 'analog' ? 'REAL' : 'BOOL';
    return { name: p.alias, dataType, aliasFor: p.operand, description: p.device };
  });
}

/** Build the starter project of a scene with the given rungs (neutral text or Rung objects). */
export function createProjectForScene(
  scene: SceneProjectSource,
  rungs?: ReadonlyArray<string> | ReadonlyArray<Rung>,
  opts: SceneProjectOptions = {},
): Project {
  const tags = mergeTags(mergeTags(aliasTagsForScene(scene), scene.extraTags), opts.tags);
  const description = opts.description ?? scene.title;
  return {
    controllerName: opts.controllerName ?? DEFAULT_CONTROLLER_NAME,
    ...(description !== undefined ? { description } : {}),
    hardware: structuredClone(scene.hardware),
    tags,
    tasks: [{ name: MAIN_TASK, type: 'CONTINUOUS', programs: [MAIN_PROGRAM] }],
    programs: [
      {
        name: MAIN_PROGRAM,
        mainRoutine: MAIN_ROUTINE,
        tags: [],
        routines: [{ name: MAIN_ROUTINE, type: 'RLL', rungs: toRungs(rungs, opts.comments) }],
      },
    ],
  };
}

/** Deep copy of a project. */
export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

/**
 * Copy of `project` with the rungs of one routine replaced (the routine is created when missing).
 * Throws when the program does not exist.
 */
export function withRoutineRungs(
  project: Project,
  program: string,
  routine: string,
  rungs: ReadonlyArray<string> | ReadonlyArray<Rung>,
  comments?: ReadonlyArray<string | undefined>,
): Project {
  const copy = cloneProject(project);
  const p = copy.programs.find((x) => lower(x.name) === lower(program));
  if (!p) throw new Error(`Program '${program}' does not exist.`);
  const newRungs = toRungs(rungs, comments);
  const r = p.routines.find((x) => lower(x.name) === lower(routine));
  if (r) r.rungs = newRungs;
  else p.routines.push({ name: routine, type: 'RLL', rungs: newRungs } satisfies Routine);
  return copy;
}
