/** `trainer` scene definition: logic + 3D view + camera presets + demo program. */
import type { SceneDefinition } from '../../types';
import { TRAINER_DEMO_RUNGS } from './demo';
import { trainerLogic, type TrainerState } from './logic';
import { TrainerView } from './View';

export const definition: SceneDefinition<TrainerState> = {
  logic: trainerLogic,
  View: TrainerView,
  cameras: [
    { id: 'overview', label: 'Lab', position: [2.3, 1.95, 2.85], target: [-0.1, 1.12, -0.3] },
    { id: 'station', label: 'Trainer', position: [-0.08, 1.72, 1.08], target: [-0.12, 1.2, -0.3] },
    { id: 'console', label: 'Inputs', position: [-0.28, 1.62, 0.9], target: [-0.28, 0.98, -0.12] },
    { id: 'outputs', label: 'Outputs', position: [0.3, 1.52, 0.28], target: [0.28, 1.46, -0.58] },
    { id: 'rack', label: 'PLC rack', position: [-0.4, 1.52, 0.32], target: [-0.68, 1.44, -0.48] },
  ],
  accent: '#22c55e',
  environment: 'studio',
  demoRungs: TRAINER_DEMO_RUNGS,
};
