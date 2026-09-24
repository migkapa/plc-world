/**
 * 5069-ECR right end cap: thin cover that terminates the Compact 5000 bus on the right of the last module.
 * Origin: center of the back mounting face at the bottom edge (front = +Z).
 */
import { COLORS, materials } from '../../../common';
import type { Placement } from '../../../contracts';
import { canvasTexture, CONDENSED, mmCtx } from './canvas';
import { plane, profileGeometry } from './geometry';
import { M5069 } from './Module5069';
import { decalMaterial } from './parts';

export const END_CAP_5069_WIDTH = 0.0072;

const PROFILE: Array<[number, number]> = [
  [0, 0.002],
  [0.002, 0],
  [0.0845, 0],
  [0.0875, 0.004],
  [0.0875, M5069.height - 0.012],
  [0.078, M5069.height],
  [0.004, M5069.height],
  [0, M5069.height - 0.003],
];

function capLabel() {
  return canvasTexture('5069-ecr-label', 64, 512, (ctx, w, h) => {
    ctx.fillStyle = '#202225';
    ctx.fillRect(0, 0, w, h);
    const m = mmCtx(ctx, 64 / 6, 48);
    m.text('5069-ECR', 3, 24, 2.2, { color: '#cfd2d5', weight: 700, align: 'center', rotate: Math.PI / 2, font: CONDENSED });
  });
}

export type EndCap5069Props = Placement;

export function EndCap5069({ position, rotation, scale }: EndCap5069Props) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={profileGeometry('5069-ecr', PROFILE, END_CAP_5069_WIDTH, 0.0006)} material={materials.plastic(COLORS.moduleCharcoal, 0.6)} castShadow receiveShadow />
      <mesh geometry={plane(0.0045, 0.048)} material={decalMaterial(capLabel(), 0.6)} position={[0, 0.075, 0.0877]} receiveShadow />
    </group>
  );
}
