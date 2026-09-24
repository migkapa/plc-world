/**
 * <SlotFiller1756N2/> — 1756-N2 slot filler: black molded plate covering an empty chassis slot.
 * Origin: back-bottom-center of the slot (backplane face, module coordinates), front = +Z.
 */
import type { Placement } from '../../../contracts';
import { MOD_H, MOD_W } from './dims';
import { MAT, Selectable, boxAt, cachedGeo, merge, rboxAt } from './shared';

export interface SlotFiller1756N2Props extends Placement {
  onSelect?: () => void;
  highlighted?: boolean;
}

const FRONT_Z = 0.1215;

function fillerGeometry() {
  return cachedGeo('clx:n2', () => {
    const w = MOD_W - 0.0006;
    const h = MOD_H - 0.0012;
    const parts = [
      rboxAt(w, h, 0.0022, 0, MOD_H / 2, FRONT_Z - 0.0011, 0.0007),
      // side flanges engaging the chassis guides
      boxAt(0.0009, h - 0.004, 0.024, -w / 2 + 0.00045, MOD_H / 2, FRONT_Z - 0.012),
      boxAt(0.0009, h - 0.004, 0.024, w / 2 - 0.00045, MOD_H / 2, FRONT_Z - 0.012),
      // raised molded frame
      boxAt(w - 0.004, 0.0012, 0.0008, 0, MOD_H - 0.0165, FRONT_Z + 0.0004),
      boxAt(w - 0.004, 0.0012, 0.0008, 0, 0.0165, FRONT_Z + 0.0004),
      boxAt(0.0012, MOD_H - 0.034, 0.0008, -w / 2 + 0.0026, MOD_H / 2, FRONT_Z + 0.0004),
      boxAt(0.0012, MOD_H - 0.034, 0.0008, w / 2 - 0.0026, MOD_H / 2, FRONT_Z + 0.0004),
    ];
    // finger grips (top & bottom)
    for (let i = 0; i < 4; i++) {
      parts.push(rboxAt(0.016, 0.0009, 0.0012, 0, MOD_H - 0.005 - i * 0.0022, FRONT_Z + 0.0005, 0.0003));
      parts.push(rboxAt(0.016, 0.0009, 0.0012, 0, 0.005 + i * 0.0022, FRONT_Z + 0.0005, 0.0003));
    }
    return merge(parts);
  });
}

export function SlotFiller1756N2({ onSelect, highlighted, position, rotation, scale }: SlotFiller1756N2Props) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={[MOD_W + 0.0018, MOD_H + 0.0018, 0.008]} center={[0, MOD_H / 2, FRONT_Z - 0.003]} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={fillerGeometry()} material={MAT.body()} />
      </Selectable>
    </group>
  );
}
