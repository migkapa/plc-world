/**
 * Scene definition for `tank-process` (auto-registered by ../views.tsx). The demo program lives in ./demo.ts:
 * it does NOT start by itself — press START (previews apply `demoStart` = TANK_DEMO_START after loading).
 */
import type { SceneDefinition } from '../../types';
import { TANK_DEMO_RUNGS, TANK_DEMO_START } from './demo';
import { tankProcessLogic, type TankProcessState } from './logic';
import { TankProcessView } from './View';

export { TANK_DEMO_RUNGS, TANK_DEMO_START } from './demo';

export const definition: SceneDefinition<TankProcessState> = {
  logic: tankProcessLogic,
  View: TankProcessView,
  cameras: [
    { id: 'overview', label: 'Overview', position: [5.3, 3.6, 6.3], target: [-0.35, 1.25, -0.5] },
    { id: 'cabinet', label: 'Control cabinet', position: [3.62, 1.45, -1.3], target: [3.0, 1.2, -2.95] },
    { id: 'operator', label: 'Operator panel', position: [3.35, 1.55, 2.5], target: [2.78, 1.13, 1.35] },
    { id: 'tank', label: 'Tank cut-away', position: [2.2, 2.75, 3.3], target: [0.05, 1.55, -0.1] },
    { id: 'valves', label: 'Valve station', position: [-0.85, 1.55, 1.75], target: [-1.9, 1.0, -0.14] },
  ],
  // automatic camera moves (test replays): device → camera preset that shows it best
  focus: {
    start: 'operator', stop: 'operator', estop: 'operator', discharge: 'operator',
    Start_PB: 'operator', Stop_PB: 'operator', EStop_OK: 'operator', Discharge_PB: 'operator',
    runningLight: 'operator', batchDoneLight: 'operator', alarmHorn: 'operator',
    Running_Light: 'operator', Batch_Done_Light: 'operator', Alarm_Horn: 'operator',
    fillValve: 'valves', drainValve: 'valves', fcvPosition: 'valves', Fill_Valve: 'valves', Drain_Valve: 'valves', FCV_101: 'valves',
    level: 'tank', overflow: 'tank', spills: 'tank', lt_fail: 'tank', lsh_fail: 'tank',
    LT_101: 'tank', LSL_101: 'tank', LSH_101: 'tank', LSHH_101: 'tank',
    temperature: 'tank', heaterOn: 'tank', dryHeatMs: 'tank', TT_101: 'tank', Heater: 'tank',
    mixerRunning: 'tank', dryRunMs: 'tank', Mixer: 'tank', Mixer_Running: 'tank',
    batches: 'overview',
  },
  accent: '#38bdf8',
  environment: 'hall',
  demoRungs: TANK_DEMO_RUNGS,
  demoStart: TANK_DEMO_START,
};
