/** `trainer` scene definition: logic + 3D view + camera presets + demo program. */
import type { SceneDefinition } from '../../types';
import { TRAINER_DEMO_RUNGS } from './demo';
import { trainerLogic, type TrainerState } from './logic';
import { TrainerView } from './View';

export const definition: SceneDefinition<TrainerState> = {
  logic: trainerLogic,
  View: TrainerView,
  cameras: [
    // Framed for the workspace twin panel (≈ 760x340 px at 1440x900) with the operator pad expanded: the bench
    // console stays above the pad (the panel also centres the target in the band the HUD leaves free).
    { id: 'station', label: 'Trainer', position: [0.0, 1.9, 2.6], target: [-0.12, 1.28, -0.3] },
    { id: 'console', label: 'Inputs', position: [-0.26, 1.7, 1.05], target: [-0.27, 0.98, -0.12] },
    { id: 'outputs', label: 'Outputs', position: [0.3, 1.52, 0.72], target: [0.28, 1.45, -0.58] },
    { id: 'rack', label: 'PLC rack', position: [-0.4, 1.52, 0.32], target: [-0.68, 1.44, -0.48] },
  ],
  // automatic camera moves (test replays): device → camera preset that shows it best
  focus: {
    sw0: 'console', sw1: 'console', sw2: 'console', sw3: 'console', sw4: 'console', sw5: 'console', sw6: 'console', sw7: 'console',
    Switch_0: 'console', Switch_1: 'console', Switch_2: 'console', Switch_3: 'console', Switch_4: 'console', Switch_5: 'console', Switch_6: 'console', Switch_7: 'console',
    light0: 'outputs', light1: 'outputs', light2: 'outputs', light3: 'outputs', light4: 'outputs', light5: 'outputs', light6: 'outputs', light7: 'outputs',
    Light_0: 'outputs', Light_1: 'outputs', Light_2: 'outputs', Light_3: 'outputs', Light_4: 'outputs', Light_5: 'outputs', Light_6: 'outputs', Light_7: 'outputs',
    pb_green: 'console', pb_red: 'console', pb_black1: 'console', pb_black2: 'console',
    PB_Green: 'console', PB_Red: 'console', PB_Black_1: 'console', PB_Black_2: 'console',
    pot1: 'console', pot2: 'console', Pot_1: 'console', Pot_2: 'console',
    buzzer: 'outputs', buzzerOnMs: 'outputs', Buzzer: 'outputs',
    meter1: 'outputs', meter2: 'outputs', Meter_1: 'outputs', Meter_2: 'outputs',
  },
  accent: '#22c55e',
  environment: 'studio',
  demoRungs: TRAINER_DEMO_RUNGS,
};
