/**
 * Reference demo program for the `trainer` bench (neutral text, headless — no React/three).
 * Used by the showroom / previews to make the bench come alive without any operator input:
 *
 *  - a free-running 0–100 % sweep kept in the spare AO channel `Local:4:O.Ch7Data` (the scene has no
 *    TIMER tags, so a spare output channel serves as scratch memory);
 *  - a light chaser driven by the sweep (one lamp per 12.5 % window); every switch also lights its lamp,
 *    and the green push button is a LAMP TEST;
 *  - Meter_1 follows the sweep (or Pot_1 when turned up), the bar graph shows the inverse sweep (or Pot_2);
 *  - the buzzer sounds while the red N.C. button is pressed (XIO!) or both black buttons are held.
 */
const SWEEP = 'Local:4:O.Ch7Data';

const lamp = (i: number) => `[XIC(Switch_${i}),XIC(PB_Green),LIM(${(i * 12.5).toFixed(1)},${SWEEP},${(i * 12.5 + 12.4).toFixed(1)})]OTE(Light_${i});`;

export const TRAINER_DEMO_RUNGS: string[] = [
  `ADD(${SWEEP},0.2,${SWEEP});`,
  `GEQ(${SWEEP},100.0)MOV(0.0,${SWEEP});`,
  ...Array.from({ length: 8 }, (_, i) => lamp(i)),
  '[XIO(PB_Red),XIC(PB_Black_1)XIC(PB_Black_2)]OTE(Buzzer);',
  `MOV(${SWEEP},Meter_1);`,
  'GRT(Pot_1,0.5)MOV(Pot_1,Meter_1);',
  `CPT(Meter_2,100.0-${SWEEP});`,
  'GRT(Pot_2,0.5)MOV(Pot_2,Meter_2);',
];
