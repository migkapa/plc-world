/**
 * Reference program for the `motor-station` (neutral text, headless — no React/three).
 *
 *  0  READY  = E-stop released AND overload healthy AND contactor open
 *  1  HAND run latch (Start / seal-in, Stop N.C. → XIC, jog cancels the latch). The scene has no internal
 *     BOOL tags, so the spare output bit Local:2:O.Data.15 serves as the run latch.
 *  2  Contactor: HAND latch, or HAND + JOG held (no seal), or AUTO + upstream Remote_Run; always gated by
 *     E-stop, overload and Stop (the coil is ALSO hardwired through E-stop + OL 95-96 in the panel).
 *  3  RUN light proves the contactor pulled in (aux contact feedback, not the output bit).
 *  4  FAULT light while the overload is tripped.
 *  5–6 Horn sounds on an overload trip until STOP acknowledges it (spare bit Local:2:O.Data.14).
 *
 * Try: H-O-A to HAND → START (runs, seals in) → STOP; JOG runs only while held; AUTO + upstream RUN.
 */
const LATCH = 'Local:2:O.Data.15';
const ACK = 'Local:2:O.Data.14';

export const MOTOR_STATION_DEMO_RUNGS: string[] = [
  'XIC(EStop_OK)XIC(OL_OK)XIO(Motor_Aux)OTE(Ready_Light);',
  `XIC(EStop_OK)XIC(OL_OK)XIC(Stop_PB)XIC(HOA_Hand)[XIC(Start_PB),XIC(${LATCH})]XIO(Jog_PB)OTE(${LATCH});`,
  `XIC(EStop_OK)XIC(OL_OK)XIC(Stop_PB)[XIC(${LATCH}),XIC(HOA_Hand)XIC(Jog_PB),XIC(HOA_Auto)XIC(Remote_Run)]OTE(Motor_Starter);`,
  'XIC(Motor_Aux)OTE(Run_Light);',
  'XIO(OL_OK)OTE(Fault_Light);',
  `XIO(OL_OK)[XIO(Stop_PB),XIC(${ACK})]OTE(${ACK});`,
  `XIO(OL_OK)XIO(${ACK})OTE(Horn);`,
];
