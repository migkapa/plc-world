/** `motor-station` scene definition: logic + 3D view + camera presets + demo program. */
import type { SceneDefinition } from '../../types';
import { MOTOR_STATION_DEMO_RUNGS } from './demo';
import { motorStationLogic, type MotorStationState } from './logic';
import { MotorStationView } from './View';

export const definition: SceneDefinition<MotorStationState> = {
  logic: motorStationLogic,
  View: MotorStationView,
  cameras: [
    { id: 'overview', label: 'Bay', position: [3.6, 2.2, 2.2], target: [0.3, 0.8, -0.6] },
    { id: 'operator', label: 'Push buttons', position: [2.05, 1.56, 1.95], target: [1.78, 1.25, 0.98] },
    { id: 'drive', label: 'Motor & drive', position: [1.6, 1.15, 1.1], target: [0.62, 0.74, 0.0] },
    { id: 'panel', label: 'Control panel', position: [-2.1, 1.3, -1.62], target: [-2.2, 1.24, -2.88] },
    { id: 'line', label: 'Upstream', position: [1.75, 1.6, -0.95], target: [0.7, 1.15, -2.85] },
  ],
  accent: '#f5c400',
  environment: 'hall',
  demoRungs: MOTOR_STATION_DEMO_RUNGS,
};
