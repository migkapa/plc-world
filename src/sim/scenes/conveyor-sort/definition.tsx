/**
 * Scene definition for `conveyor-sort` (auto-registered by ../views.tsx). The demo program lives in ./demo.ts:
 * it does NOT start by itself — press START (a preview harness taps CONVEYOR_DEMO_START after loading).
 */
import type { SceneDefinition } from '../../types';
import { CONVEYOR_DEMO_RUNGS, CONVEYOR_DEMO_TAGS } from './demo';
import { conveyorSortLogic, type ConveyorSortState } from './logic';
import { ConveyorSortView } from './View';

export { CONVEYOR_DEMO_RUNGS, CONVEYOR_DEMO_RUNGS_NO_TAGS, CONVEYOR_DEMO_START, CONVEYOR_DEMO_TAGS } from './demo';

export const definition: SceneDefinition<ConveyorSortState> = {
  logic: conveyorSortLogic,
  View: ConveyorSortView,
  cameras: [
    { id: 'overview', label: 'Overview', position: [6.4, 4.1, 7.6], target: [0.1, 0.7, -0.55] },
    { id: 'cabinet', label: 'Control cabinet', position: [-0.78, 1.36, -1.95], target: [-1.36, 1.2, -3.3] },
    { id: 'operator', label: 'Operator station', position: [-3.02, 1.52, 1.9], target: [-3.64, 1.14, 1.02] },
    { id: 'pusher', label: 'Pusher & divert', position: [2.15, 2.05, 1.4], target: [0.72, 0.8, -0.72] },
    { id: 'feeder', label: 'Box feeder', position: [-2.2, 1.95, 2.3], target: [-2.95, 1.25, 0.1] },
  ],
  accent: '#e8b90c',
  environment: 'hall',
  demoRungs: CONVEYOR_DEMO_RUNGS,
  demoTags: CONVEYOR_DEMO_TAGS,
};
