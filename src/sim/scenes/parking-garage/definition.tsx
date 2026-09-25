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
  // automatic camera moves (test replays): device → camera preset that shows it best
  focus: {
    spawn_entry: 'ticket', Entry_Loop: 'ticket', Entry_PE: 'ticket', Ticket_PB: 'ticket',
    entryGateUp: 'ticket', entryGatePos: 'ticket', Entry_Gate_Up: 'ticket', carsEntered: 'ticket', carsWaitingEntry: 'ticket',
    spawn_exit: 'exit', Exit_Loop: 'exit', Exit_PE: 'exit', exitGateUp: 'exit', exitGatePos: 'exit', Exit_Gate_Up: 'exit',
    carsExited: 'exit', carsWaitingExit: 'exit',
    reset_key: 'attendant', Reset_Key: 'attendant', initial_cars: 'attendant', carsInside: 'attendant', capacity: 'attendant',
    // FULL / SPACES signs: over the entry lane and at the plaza entrance
    fullSign: 'overview', openSign: 'overview', Full_Sign: 'overview', Open_Sign: 'overview', carsTurnedAway: 'overview',
    gateHits: 'overview', auto_traffic: 'overview',
  },
  accent: '#3b82f6',
  environment: 'street',
  demoRungs: PARKING_DEMO_RUNGS,
  demoTags: PARKING_DEMO_TAGS,
};
