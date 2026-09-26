/**
 * Reference program for the `motor-station` (neutral text, headless — no React/three).
 *
 * The starter project has no internal BOOL / TIMER tags, so the only memory this program uses is a real,
 * meaningful output: the green RUN lamp is the latched run command (a seal-in you can see). No unused
 * output point is used as scratch memory.
 *
 *  0  READY  = E-stop released AND overload healthy AND no run command AND contactor proven open (Motor_Aux)
 *  1  RUN lamp = run command: HAND → START seals it in (Stop is N.C. → XIC, JOG cancels it);
 *     AUTO → on while the upstream line requests (Remote_Run). Always gated by E-stop, overload and Stop.
 *  2  Contactor: the run command, or HAND + JOG held (inching, no seal). The coil is ALSO hardwired through
 *     E-stop + OL 95-96 in the panel.
 *  3  FAULT lamp while the overload is tripped or the E-stop is pushed.
 *  4  Alarm horn on an overload trip until the operator turns the selector to OFF (acknowledge).
 *
 * Try: H-O-A to HAND → START (runs, seals in) → STOP; JOG runs only while held; AUTO + upstream RUN.
 * (With a TON and a BOOL in the project — extraTags — you would add a 3 s pre-start horn in AUTO.)
 */
export const MOTOR_STATION_DEMO_RUNGS: string[] = [
  'XIC(EStop_OK)XIC(OL_OK)XIO(Run_Light)XIO(Motor_Aux)OTE(Ready_Light);',
  'XIC(EStop_OK)XIC(OL_OK)XIC(Stop_PB)[XIC(HOA_Hand)XIO(Jog_PB)[XIC(Start_PB),XIC(Run_Light)],XIC(HOA_Auto)XIC(Remote_Run)]OTE(Run_Light);',
  'XIC(EStop_OK)XIC(OL_OK)XIC(Stop_PB)[XIC(Run_Light),XIC(HOA_Hand)XIC(Jog_PB)]OTE(Motor_Starter);',
  '[XIO(OL_OK),XIO(EStop_OK)]OTE(Fault_Light);',
  'XIO(OL_OK)[XIC(HOA_Hand),XIC(HOA_Auto)]OTE(Horn);',
];
