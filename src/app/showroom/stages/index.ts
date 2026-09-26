import { FIELD_STAGES } from './field';
import { OPERATOR_STAGES } from './operator';
import { PANEL_STAGES } from './panel';
import { PLC_STAGES } from './plc';
import { TRAFFIC_STAGES } from './traffic';
import type { StageDef } from './types';

/** 3D stage + demo controls per showroom device id. */
export const STAGES: Record<string, StageDef> = {
  ...PLC_STAGES,
  ...OPERATOR_STAGES,
  ...PANEL_STAGES,
  ...FIELD_STAGES,
  ...TRAFFIC_STAGES,
};

export type { StageDef } from './types';
