/** `motor-station` scene definition: logic + 3D view + camera presets + demo program. */
import type { SceneDefinition } from '../../types';
import { MOTOR_STATION_DEMO_RUNGS } from './demo';
import { motorStationLogic, type MotorStationState } from './logic';
import { MotorStationView } from './View';

export const definition: SceneDefinition<MotorStationState> = {
  logic: motorStationLogic,
  View: MotorStationView,
  cameras: [
    { id: 'overview', label: 'Bay', position: [3.3, 2.45, 3.35], target: [-0.25, 0.85, -1.0] },
    { id: 'operator', label: 'Push buttons', position: [2.05, 1.52, 1.95], target: [1.78, 1.18, 0.98] },
    { id: 'drive', label: 'Motor & drive', position: [1.12, 1.22, 1.22], target: [0.72, 0.76, 0.0] },
    { id: 'panel', label: 'Control panel', position: [-1.72, 1.5, -1.55], target: [-2.2, 1.25, -2.62] },
    { id: 'line', label: 'Upstream', position: [1.9, 1.9, -0.6], target: [0.3, 1.1, -2.8] },
  ],
  accent: '#f5c400',
  environment: 'hall',
  demoRungs: MOTOR_STATION_DEMO_RUNGS,
};
