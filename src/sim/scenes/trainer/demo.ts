/**
 * Reference demo program for the `trainer` bench (neutral text, headless — no React/three).
 * Used by the showroom / previews to make the bench come alive without any operator input.
 *
 * It uses ONLY the bench's own I/O tags (no scratch memory in unused output points):
 *
 *  - Meter_1 (the analog panel meter on 1756-OF8 ch 0) is a ramp generator: +0.2 % per scan, back to 0 at
 *    100 %. Turning Pot_1 up hands the meter over to the pot instead.
 *  - Light chaser: each lamp lights while Meter_1 is inside its 12.5 % window (so the lamps follow the meter
 *    needle, and follow Pot_1 when it is turned up); every switch also lights its lamp, and the green push
 *    button is a LAMP TEST.
 *  - Meter_2 (bar graph) shows 100 % − Meter_1, or Pot_2 when it is turned up.
 *  - Buzzer: sounds while the red N.C. button is pressed (XIO: the input goes to 0 when pressed!) or while
 *    both black buttons are held.
 */
const lamp = (i: number) => `[XIC(Switch_${i}),XIC(PB_Green),LIM(${(i * 12.5).toFixed(1)},Meter_1,${(i * 12.5 + 12.4).toFixed(1)})]OTE(Light_${i});`;

export const TRAINER_DEMO_RUNGS: string[] = [
  'LES(Pot_1,0.5)ADD(Meter_1,0.2,Meter_1);',
  'GEQ(Meter_1,100.0)MOV(0.0,Meter_1);',
  'GRT(Pot_1,0.5)MOV(Pot_1,Meter_1);',
  ...Array.from({ length: 8 }, (_, i) => lamp(i)),
  '[XIO(PB_Red),XIC(PB_Black_1)XIC(PB_Black_2)]OTE(Buzzer);',
  'CPT(Meter_2,100.0-Meter_1);',
  'GRT(Pot_2,0.5)MOV(Pot_2,Meter_2);',
];
