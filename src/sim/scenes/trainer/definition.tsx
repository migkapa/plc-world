/** `trainer` scene definition: logic + 3D view + camera presets + demo program. */
import type { SceneDefinition } from '../../types';
import { TRAINER_DEMO_RUNGS } from './demo';
import { trainerLogic, type TrainerState } from './logic';
import { TrainerView } from './View';

export const definition: SceneDefinition<TrainerState> = {
  logic: trainerLogic,
  View: TrainerView,
  cameras: [
    { id: 'overview', label: 'Lab', position: [0.75, 1.8, 2.8], target: [-0.3, 1.15, -0.35] },
    { id: 'station', label: 'Trainer', position: [0.02, 1.82, 1.5], target: [-0.1, 1.28, -0.3] },
    { id: 'console', label: 'Inputs', position: [-0.22, 1.52, 1.2], target: [-0.22, 1.14, -0.3] },
    { id: 'outputs', label: 'Outputs', position: [0.3, 1.52, 0.28], target: [0.28, 1.46, -0.58] },
    { id: 'rack', label: 'PLC rack', position: [-0.4, 1.52, 0.32], target: [-0.68, 1.44, -0.48] },
  ],
  accent: '#22c55e',
  environment: 'studio',
  demoRungs: TRAINER_DEMO_RUNGS,
};
