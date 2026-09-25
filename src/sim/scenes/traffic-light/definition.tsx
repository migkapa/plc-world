/**
 * Scene definition for `traffic-light` (auto-registered by ../views.tsx): logic + 3D view + camera
 * presets + the reference program (see ./demo.ts).
 */
import type { SceneDefinition } from '../../types';
import { TRAFFIC_DEMO_RUNGS, TRAFFIC_DEMO_TAGS } from './demo';
import { trafficLightLogic, type TrafficLightState } from './logic';
import { TrafficLightView } from './View';

export const definition: SceneDefinition<TrafficLightState> = {
  logic: trafficLightLogic,
  View: TrafficLightView,
  cameras: [
    { id: 'overview', label: 'Intersection', position: [2.5, 14.5, 23.5], target: [-1.5, 1.2, -3] },
    { id: 'driver', label: "Driver's view (EB)", position: [-24, 1.75, 2.35], target: [0, 3.4, 0.9] },
    { id: 'pedestrian', label: 'Pedestrian corner', position: [7.6, 1.65, -8.2], target: [-5.5, 2.9, -4.2] },
    { id: 'cabinet', label: 'Controller cabinet', position: [-8.1, 1.19, -8.16], target: [-8.55, 1.06, -8.61] },
    { id: 'police', label: 'Police panel (AUTO/FLASH)', position: [-8.85, 1.5, -6.58], target: [-8.16, 1.3, -6.9] },
  ],
  accent: '#22c55e',
  environment: 'street',
  demoRungs: TRAFFIC_DEMO_RUNGS,
  demoTags: TRAFFIC_DEMO_TAGS,
};
