/**
 * Scene definition for `traffic-light` (auto-registered by ../views.tsx): logic + 3D view + camera
 * presets + the reference program (see ./demo.ts).
 */
import type { SceneDefinition } from '../../types';
import { TRAFFIC_DEMO_RUNGS } from './demo';
import { trafficLightLogic, type TrafficLightState } from './logic';
import { TrafficLightView } from './View';

export const definition: SceneDefinition<TrafficLightState> = {
  logic: trafficLightLogic,
  View: TrafficLightView,
  cameras: [
    { id: 'overview', label: 'Intersection', position: [23, 15.5, 24], target: [0, 1.2, -1.5] },
    { id: 'driver', label: "Driver's view (EB)", position: [-24, 1.75, 2.35], target: [0, 3.4, 0.9] },
    { id: 'pedestrian', label: 'Pedestrian corner', position: [8.6, 1.65, -3.8], target: [-5.5, 1.5, -6.0] },
    { id: 'cabinet', label: 'Controller cabinet', position: [-8.1, 1.16, -8.16], target: [-8.55, 1.03, -8.61] },
  ],
  accent: '#22c55e',
  environment: 'street',
  demoRungs: TRAFFIC_DEMO_RUNGS,
};
