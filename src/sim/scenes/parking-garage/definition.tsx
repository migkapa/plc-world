/**
 * Scene definition for `parking-garage` (auto-registered by ../views.tsx): logic + 3D view + camera
 * presets + the reference program (see ./demo.ts).
 */
import type { SceneDefinition } from '../../types';
import { PARKING_DEMO_RUNGS, PARKING_DEMO_TAGS } from './demo';
import { parkingGarageLogic, type ParkingGarageState } from './logic';
import { ParkingGarageView } from './View';

export const definition: SceneDefinition<ParkingGarageState> = {
  logic: parkingGarageLogic,
  View: ParkingGarageView,
  cameras: [
    { id: 'overview', label: 'Entry plaza', position: [13.5, 10, 19.2], target: [0.8, 0.3, 3.7] },
    { id: 'ticket', label: 'Ticket column (driver)', position: [-3.5, 1.42, 8.15], target: [-5.1, 1.12, 8.7] },
    { id: 'attendant', label: 'Attendant desk (COUNT RESET)', position: [9.0, 1.85, 12.3], target: [8.55, 1.1, 8.6] },
    { id: 'booth', label: 'Gate control panel', position: [8.5, 1.62, 9.55], target: [9.6, 1.45, 9.25] },
    { id: 'exit', label: 'Exit lane & deck', position: [7.8, 4.6, -8.5], target: [2.2, 0.6, 5] },
  ],
  accent: '#3b82f6',
  environment: 'street',
  demoRungs: PARKING_DEMO_RUNGS,
  demoTags: PARKING_DEMO_TAGS,
};
