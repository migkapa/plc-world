/**
 * Convenience factory for a running controller + plant (previews, showroom, sandbox defaults).
 * Headless (no React/DOM/three).
 */
import { createController, type LogixController } from '../plc/controller';
import type { Rung, TagDef } from '../plc/types';
import { createProjectForScene } from './project';
import { createSimRuntime, type SimRuntimeEx } from './runtime';
import type { SceneLogic } from './types';

export interface DemoRuntime {
  controller: LogixController;
  runtime: SimRuntimeEx;
}

/** Build a controller with `rungs` for `scene`, put it in REM_RUN (if it verifies) and couple it to the plant. */
export function createDemoRuntime(
  scene: SceneLogic<unknown>,
  rungs: ReadonlyArray<string> | ReadonlyArray<Rung> = [],
  opts: { tags?: TagDef[]; run?: boolean } = {},
): DemoRuntime {
  const controller = createController(createProjectForScene(scene, rungs, { tags: opts.tags }));
  if (opts.run !== false) controller.requestMode('RUN');
  const runtime = createSimRuntime(controller, scene) as SimRuntimeEx;
  return { controller, runtime };
}
