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
  // automatic camera moves (test replays): device → camera preset that shows it best
  focus: {
    nsRed: 'overview', nsYellow: 'overview', nsGreen: 'overview', NS_Red: 'overview', NS_Yellow: 'overview', NS_Green: 'overview',
    ewRed: 'driver', ewYellow: 'driver', ewGreen: 'driver', EW_Red: 'driver', EW_Yellow: 'driver', EW_Green: 'driver',
    conflict: 'overview', conflicts: 'overview', carsPassed: 'overview', spawn_ns: 'overview', auto_traffic: 'overview',
    spawn_ew: 'driver', carsWaitingEW: 'driver', Car_Sensor_EW: 'driver',
    ped: 'pedestrian', Ped_PB: 'pedestrian', walk: 'pedestrian', dontWalk: 'pedestrian', Walk: 'pedestrian', Dont_Walk: 'pedestrian',
    pedWaiting: 'pedestrian', pedCrossed: 'pedestrian',
    night: 'police', Night_Mode: 'police',
  },
  accent: '#22c55e',
  environment: 'street',
  demoRungs: TRAFFIC_DEMO_RUNGS,
  demoTags: TRAFFIC_DEMO_TAGS,
};
