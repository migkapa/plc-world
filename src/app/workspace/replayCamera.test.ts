/**
 * "Watch this test" looks at the device under test (QA: the 1-1 replay stayed in the "Inputs" view while the
 * failing check was about Light_0 on the output panel).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MISSIONS, getMission } from '../../game/missions';
import { runMission } from '../../game/validation';
import { cameraForSignal, replayCamera, replaySignal } from './replayCamera';

/** Camera ids declared in a scene's definition.tsx (read as text: the definitions import the 3D views). */
function cameraIds(sceneId: string): string[] {
  const src = readFileSync(new URL(`../../sim/scenes/${sceneId}/definition.tsx`, import.meta.url), 'utf8');
  const block = /cameras:\s*\[([\s\S]*?)\n\s*\],/.exec(src)?.[1] ?? '';
  return [...block.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]!);
}

describe('replay camera', () => {
  it('1-1 wired to the wrong lamp: the failed replay shows the output panel', () => {
    const m = getMission('1-1')!;
    const r = runMission(m, ['XIC(Switch_0)OTE(Light_1);'], { enforcePalette: false });
    const i = m.tests.findIndex((t) => t.name === 'Lamp follows the switch');
    expect(r.tests[i]!.passed).toBe(false);
    expect(replaySignal(m, m.tests[i], r.tests[i])).toBe('light0');
    expect(replayCamera('trainer', m, i, r.tests[i])).toBe('outputs');
  });

  it('maps inputs and outputs of each plant', () => {
    expect(cameraForSignal('trainer', 'sw3')).toBe('console');
    expect(cameraForSignal('trainer', 'Meter_1')).toBe('outputs');
    expect(cameraForSignal('motor-station', 'runLight')).toBe('operator');
    expect(cameraForSignal('motor-station', 'Motor_Starter')).toBe('panel');
    expect(cameraForSignal('tank-process', 'fillValve')).toBe('valves');
    expect(cameraForSignal('traffic-light', 'walk')).toBe('pedestrian');
    expect(cameraForSignal('parking-garage', 'exitGatePos')).toBe('exit');
    expect(cameraForSignal('nope', 'x')).toBeUndefined();
  });

  it('every mission test resolves to a camera its scene really has', () => {
    const cams: Record<string, string[]> = {};
    for (const m of MISSIONS) {
      cams[m.sceneId] ??= cameraIds(m.sceneId);
      expect(cams[m.sceneId]!.length, m.sceneId).toBeGreaterThan(1);
      m.tests.forEach((t, i) => {
        const cam = replayCamera(m.sceneId, m, i, undefined);
        if (cam !== undefined) expect(cams[m.sceneId], `${m.id} '${t.name}' → ${cam}`).toContain(cam);
      });
      // every signal a mission checks has a camera (so a failing check is always shown)
      for (const t of m.tests)
        for (const s of t.steps)
          if (s.do === 'expect') expect(cameraForSignal(m.sceneId, s.observe ?? s.tag), `${m.id}: ${s.observe ?? s.tag}`).toBeDefined();
    }
  });
});
