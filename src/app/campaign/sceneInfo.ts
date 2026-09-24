/** Display info about a mission's training plant (headless scene registry; no three.js). */
import { getSceneLogic } from '../../sim/scenes';

export interface SceneInfo {
  title: string;
  summary: string;
  platform: 'ControlLogix' | 'CompactLogix' | string;
  /** e.g. '1756-L85E' */
  cpu?: string;
  /** e.g. '1756-A7' */
  chassis?: string;
  /** Short hardware line, e.g. 'ControlLogix 1756-L85E'. */
  hardware: string;
}

const CACHE = new Map<string, SceneInfo>();

export function sceneInfo(sceneId: string): SceneInfo {
  const hit = CACHE.get(sceneId);
  if (hit) return hit;
  const logic = getSceneLogic(sceneId);
  let info: SceneInfo;
  if (!logic) {
    info = { title: sceneId, summary: '', platform: 'ControlLogix', hardware: 'ControlLogix' };
  } else {
    const hw = logic.hardware;
    const cpu = hw.modules.find((m) => m.slot === 0)?.catalog;
    info = {
      title: logic.title,
      summary: logic.summary,
      platform: hw.platform,
      hardware: cpu ? `${hw.platform} ${cpu}` : hw.platform,
    };
    if (cpu) info.cpu = cpu;
    if (hw.chassis) info.chassis = hw.chassis;
  }
  CACHE.set(sceneId, info);
  return info;
}
