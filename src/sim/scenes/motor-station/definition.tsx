/** `motor-station` scene definition: logic + 3D view + camera presets + demo program. */
import type { SceneDefinition } from '../../types';
import { MOTOR_STATION_DEMO_RUNGS } from './demo';
import { motorStationLogic, type MotorStationState } from './logic';
import { MotorStationView } from './View';

export const definition: SceneDefinition<MotorStationState> = {
  logic: motorStationLogic,
  View: MotorStationView,
  cameras: [
    { id: 'overview', label: 'Bay', position: [3.9, 2.4, 1.5], target: [0.2, 0.85, -0.9] },
    { id: 'operator', label: 'Push buttons', position: [2.1, 1.62, 2.05], target: [1.76, 1.3, 0.98] },
    { id: 'drive', label: 'Motor & drive', position: [1.1, 1.5, 1.2], target: [0.68, 0.78, -0.02] },
    { id: 'panel', label: 'Control panel', position: [-2.1, 1.3, -1.62], target: [-2.2, 1.24, -2.88] },
    { id: 'line', label: 'Upstream', position: [1.2, 1.45, -1.3], target: [0.45, 1.1, -2.85] },
  ],
  accent: '#f5c400',
  environment: 'hall',
  demoRungs: MOTOR_STATION_DEMO_RUNGS,
  // the run command is operator-started: H-O-A to HAND, then START (seals in)
  demoStart: [['hoa', 0], 'start'],
};
