/**
 * 3D scene registry: every `src/sim/scenes/<id>/definition.tsx` exporting `definition: SceneDefinition`
 * is registered automatically. (The headless registry is `./index.ts`.)
 */
import type { SceneDefinition } from '../types';
import { SCENE_IDS } from './index';

const modules = import.meta.glob<{ definition: SceneDefinition<any> }>('./*/definition.tsx', { eager: true }); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Scene definitions keyed by scene id, in SCENE_IDS order. */
export const SCENES: Record<string, SceneDefinition<any>> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
const found = Object.values(modules)
  .map((m) => m.definition)
  .filter(Boolean);
for (const id of SCENE_IDS) {
  const def = found.find((d) => d.logic.id === id);
  if (def) SCENES[id] = def;
}

export function getSceneDefinition(id: string): SceneDefinition<any> | undefined { // eslint-disable-line @typescript-eslint/no-explicit-any
  return SCENES[id];
}
