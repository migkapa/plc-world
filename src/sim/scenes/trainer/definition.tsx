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
    // Framed for the workspace twin panel (≈ 760x340 px at 1440x900) with the operator pad expanded: the bench
    // console stays above the pad (the panel also centres the target in the band the HUD leaves free).
    { id: 'station', label: 'Trainer', position: [0.0, 1.9, 2.6], target: [-0.12, 1.28, -0.3] },
    { id: 'console', label: 'Inputs', position: [-0.26, 1.7, 1.05], target: [-0.27, 0.98, -0.12] },
    { id: 'outputs', label: 'Outputs', position: [0.3, 1.52, 0.72], target: [0.28, 1.45, -0.58] },
    { id: 'rack', label: 'PLC rack', position: [-0.4, 1.52, 0.32], target: [-0.68, 1.44, -0.48] },
  ],
  accent: '#22c55e',
  environment: 'studio',
  demoRungs: TRAINER_DEMO_RUNGS,
};
