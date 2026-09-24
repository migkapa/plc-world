/**
 * Scene definition for `parking-garage` (auto-registered by ../views.tsx): logic + 3D view + camera
 * presets + the reference program (see ./demo.ts).
 */
import type { SceneDefinition } from '../../types';
import { PARKING_DEMO_RUNGS } from './demo';
import { parkingGarageLogic, type ParkingGarageState } from './logic';
import { ParkingGarageView } from './View';

export const definition: SceneDefinition<ParkingGarageState> = {
  logic: parkingGarageLogic,
  View: ParkingGarageView,
  cameras: [
    { id: 'overview', label: 'Entry plaza', position: [21, 14, 21], target: [-1, 0.5, -1.5] },
    { id: 'entry', label: "Driver's view (entry)", position: [-5.3, 2.0, 16.0], target: [-3.0, 0.9, 6.0] },
    { id: 'ticket', label: 'Ticket column & gate', position: [-3.75, 1.5, 11.4], target: [-5.0, 1.0, 8.1] },
    { id: 'booth', label: 'Gate control panel', position: [8.5, 1.62, 9.55], target: [9.6, 1.45, 9.25] },
    { id: 'deck', label: 'Parking deck', position: [15.5, 7.5, 2.5], target: [-2, 0.2, -9] },
  ],
  accent: '#3b82f6',
  environment: 'street',
  demoRungs: PARKING_DEMO_RUNGS,
};
