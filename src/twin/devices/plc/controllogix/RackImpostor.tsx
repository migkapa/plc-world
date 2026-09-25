/**
 * Low-detail stand-in for a 1756 rack (used by <ControlLogixRack lod>): chassis back + end walls, power supply,
 * module / filler bodies and the white label strips of the fitted modules, merged into ONE draw call (vertex
 * colours). Same origin and outline as the live rack (back-bottom-center of the chassis body).
 */
import type { HardwareConfig } from '../../../../plc/types';
import { F, boxGeo, partsGeo, uberMat } from '../../operator/shared';
import { CHASSIS_H, MOD_H, MOD_Y0, MOD_Z0, PS_FRONT_Z, PS_W, RTB_FRONT_Z, RTB_TOP_Y, SHEET, SHELF_BOTTOM_Y, SHELF_TOP_Y, SHELF_Z, SLOT_PITCH, chassisLayout, type ChassisCatalog } from './dims';

export function ControlLogixRackImpostor({ hardware }: { hardware: HardwareConfig }) {
  const catalog = (hardware.chassis ?? '1756-A7') as ChassisCatalog;
  const L = chassisLayout(catalog);
  const used = [...new Set(hardware.modules.filter((m) => m.slot >= 0 && m.slot < L.slots).map((m) => m.slot))].sort((a, b) => a - b);
  const geo = partsGeo(`clx-impostor:${catalog}:${used.join(',')}`, (b) => {
    const steel = F.metal('#9ea4aa', 0.45);
    const body = F.matte('#1f2124', 0.55);
    const psFace = F.matte('#2a2d31', 0.5);
    const label = F.matte('#cfd2d5', 0.6);
    const x0 = -L.width / 2;
    // chassis back plate + end walls + top / bottom shelves (the steel frame the live rack shows around the modules)
    b.add(boxGeo(L.width, CHASSIS_H, 0.004), steel, [0, CHASSIS_H / 2, 0.002]);
    for (const x of [x0 + SHEET, -x0 - SHEET]) b.add(boxGeo(0.003, CHASSIS_H, SHELF_Z), steel, [x, CHASSIS_H / 2, SHELF_Z / 2]);
    for (const y of [SHELF_BOTTOM_Y - 0.004, SHELF_TOP_Y + 0.004]) b.add(boxGeo(L.width - 0.004, 0.003, SHELF_Z), steel, [0, y, SHELF_Z / 2]);
    // power supply (left)
    const psD = PS_FRONT_Z - MOD_Z0;
    b.add(boxGeo(PS_W - 0.004, MOD_H, psD), body, [x0 + L.psCenterX, MOD_Y0 + MOD_H / 2, MOD_Z0 + psD / 2]);
    b.add(boxGeo(PS_W - 0.012, MOD_H * 0.42, 0.001), psFace, [x0 + L.psCenterX, MOD_Y0 + MOD_H * 0.7, MOD_Z0 + psD + 0.0005]);
    // slots: every slot has a module or a 1756-N2 filler; fitted modules show their white label strip
    for (let slot = 0; slot < L.slots; slot++) {
      const x = x0 + L.slotCenterX(slot);
      const fitted = used.includes(slot);
      const depth = (fitted ? RTB_FRONT_Z : 0.13) - MOD_Z0;
      b.add(boxGeo(SLOT_PITCH - 0.0016, MOD_H, depth), body, [x, MOD_Y0 + MOD_H / 2, MOD_Z0 + depth / 2]);
      if (fitted) b.add(boxGeo(SLOT_PITCH - 0.01, 0.018, 0.001), label, [x, MOD_Y0 + RTB_TOP_Y - 0.03, MOD_Z0 + depth + 0.0005]);
    }
  });
  return <mesh geometry={geo} material={uberMat()} castShadow receiveShadow />;
}
