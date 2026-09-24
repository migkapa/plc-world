/**
 * Headless scene registry (no React / three imports): the six training plants of docs/SCENES.md.
 * Views live in `./views.tsx`; this module is what the runtime, project builder and mission
 * validation import.
 */
import type { SceneLogic } from '../types';
import { conveyorSortLogic, type ConveyorSortState } from './conveyor-sort/logic';
import { motorStationLogic, type MotorStationState } from './motor-station/logic';
import { parkingGarageLogic, type ParkingGarageState } from './parking-garage/logic';
import { tankProcessLogic, type TankProcessState } from './tank-process/logic';
import { trafficLightLogic, type TrafficLightState } from './traffic-light/logic';
import { trainerLogic, type TrainerState } from './trainer/logic';

/** Scene ids in campaign / menu order. */
export const SCENE_IDS = [
  'trainer',
  'motor-station',
  'traffic-light',
  'conveyor-sort',
  'tank-process',
  'parking-garage',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];

/** State type of each scene, for typed access (e.g. `SceneStateMap['conveyor-sort']`). */
export interface SceneStateMap {
  trainer: TrainerState;
  'motor-station': MotorStationState;
  'traffic-light': TrafficLightState;
  'conveyor-sort': ConveyorSortState;
  'tank-process': TankProcessState;
  'parking-garage': ParkingGarageState;
}

/** Typed registry (each entry keeps its concrete state type). */
export const SCENE_LOGICS_TYPED: { readonly [K in SceneId]: SceneLogic<SceneStateMap[K]> } = {
  trainer: trainerLogic,
  'motor-station': motorStationLogic,
  'traffic-light': trafficLightLogic,
  'conveyor-sort': conveyorSortLogic,
  'tank-process': tankProcessLogic,
  'parking-garage': parkingGarageLogic,
};

/**
 * Registry keyed by scene id. `SceneLogic<any>` because `S` appears in both parameter and return
 * positions (a `SceneLogic<TrainerState>` is not a `SceneLogic<unknown>`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCENE_LOGICS: Record<string, SceneLogic<any>> = SCENE_LOGICS_TYPED;

/** Scene logic by id (undefined for unknown ids). */
export function getSceneLogic(id: string): SceneLogic<unknown> | undefined {
  return SCENE_LOGICS[id];
}

export { conveyorSortLogic, motorStationLogic, parkingGarageLogic, tankProcessLogic, trafficLightLogic, trainerLogic };
export type { ConveyorSortState, MotorStationState, ParkingGarageState, TankProcessState, TrafficLightState, TrainerState };
export type { ConveyorBox, ConveyorSensors, ConveyorSortControls } from './conveyor-sort/logic';
export { CONVEYOR_GEOMETRY } from './conveyor-sort/logic';
export type { MotorStationControls } from './motor-station/logic';
export { MOTOR_STATION } from './motor-station/logic';
export type {
  GarageCar,
  GarageGate,
  GaragePhase,
  GarageSensors,
  GarageSpace,
  ParkingGarageControls,
} from './parking-garage/logic';
export { GARAGE_LAYOUT, garageCarPose } from './parking-garage/logic';
export type { TankBatchTracker, TankProcessControls } from './tank-process/logic';
export { TANK_PROCESS } from './tank-process/logic';
export type {
  Approach,
  CrashFx,
  LampTrack,
  Pedestrian,
  Road,
  RoadSignal,
  SignalAspect,
  TrafficCar,
  TrafficControls,
  TrafficLamps,
} from './traffic-light/logic';
export { TRAFFIC_DRIVER, TRAFFIC_GEOMETRY, pedestrianPose, roadOf, trafficCarPose } from './traffic-light/logic';
export type { TrainerControls } from './trainer/logic';
