/**
 * Convenience factory for a running controller + plant (previews, showroom, sandbox defaults).
 * Headless (no React/DOM/three).
 */
import { createController, type LogixController } from '../plc/controller';
import type { Rung, TagDef } from '../plc/types';
import { createProjectForScene } from './project';
import { createSimRuntime, type SimRuntimeEx } from './runtime';
import type { DemoStartStep, SceneLogic, SimRuntime } from './types';

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

/**
 * Put a scene's demo in motion (`SceneDefinition.demoStart`): `[id, value]` steps set a control, string steps press
 * a momentary control for `pressMs` of SIMULATED time (the runtime is stepped synchronously, so the PLC sees the
 * press) and release it. Safe to call with `undefined` / an empty list.
 */
export function applyDemoStart(runtime: Pick<SimRuntime, 'setControl' | 'step'>, steps: readonly DemoStartStep[] | undefined, pressMs = 200): void {
  for (const s of steps ?? []) {
    if (typeof s === 'string') {
      runtime.setControl(s, true);
      runtime.step(pressMs);
      runtime.setControl(s, false);
    } else runtime.setControl(s[0], s[1]);
  }
}

/**
 * Operator instructions for `demoStart` (e.g. "Turn Hand-Off-Auto to HAND, then press Start."), for places that load
 * a demo but leave starting it to the user (sandbox "Load example"). Null when the demo runs on its own.
 */
export function describeDemoStart(scene: Pick<SceneLogic<unknown>, 'controls'>, steps: readonly DemoStartStep[] | undefined): string | null {
  if (!steps?.length) return null;
  const label = (id: string) => scene.controls.find((c) => c.id === id);
  const parts = steps.map((s) => {
    if (typeof s === 'string') return `press ${label(s)?.label ?? s}`;
    const c = label(s[0]);
    const v = s[1];
    const pos = typeof v === 'number' ? c?.positions?.[v] : undefined;
    return `set ${c?.label ?? s[0]} to ${pos ?? String(v).toUpperCase()}`;
  });
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}` : parts[0]!;
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}
