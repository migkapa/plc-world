/**
 * Low-detail stand-in for a CompactLogix 5380 rack (used by <CompactLogixRack lod>): DIN rail with end anchors,
 * controller and 5069 module bodies (display window, catalog stripe), field-wire bundles and the slotted duct,
 * merged into ONE draw call (vertex colours). Same origin and outline as the live rack.
 */
import { F, boxGeo, partsGeo, uberMat } from '../../operator/shared';
import { CPX_CTRL } from './CompactLogix5380Controller';
import { END_CAP_5069_WIDTH } from './EndCap5069';
import { M5069 } from './m5069';
import { DUCT } from './parts';

export interface CompactRackImpostorSlot {
  x: number;
  width: number;
  cpu: boolean;
  wired: boolean;
}

export function CompactLogixRackImpostor({
  slots,
  totalWidth,
  railLength,
  railY,
  railDepth,
  stops,
  wireDuct,
}: {
  slots: CompactRackImpostorSlot[];
  totalWidth: number;
  railLength: number;
  railY: number;
  railDepth: number;
  stops: [number, number];
  wireDuct: boolean;
}) {
  const key = `cpx-impostor:${slots.map((s) => `${s.x.toFixed(4)}/${s.width}/${s.cpu ? 1 : 0}${s.wired ? 1 : 0}`).join(',')}:${railLength}:${wireDuct}`;
  const geo = partsGeo(key, (b) => {
    const steel = F.metal('#b9bec3', 0.4);
    const body = F.matte('#1d1f22', 0.55);
    const ctrl = F.matte('#232529', 0.5);
    const glass = F.matte('#08090a', 0.3);
    const stripe = F.matte('#1f5fbf', 0.5);
    const wire = F.matte('#2447a8', 0.6);
    const duct = F.matte(DUCT.color, 0.7);
    const anchor = F.matte('#8f9499', 0.5);
    // DIN rail + end anchors
    b.add(boxGeo(railLength, 0.035, railDepth), steel, [0, railY, railDepth / 2]);
    for (const x of stops) b.add(boxGeo(0.009, 0.05, 0.03), anchor, [x, railY, railDepth + 0.015]);
    if (wireDuct) {
      const len = railLength + 0.02;
      b.add(boxGeo(len, DUCT.height, DUCT.depth), duct, [0, -DUCT.gap - DUCT.height / 2, DUCT.depth / 2]);
    }
    for (const s of slots) {
      if (s.cpu) {
        const d = CPX_CTRL.depth;
        b.add(boxGeo(s.width - 0.0008, CPX_CTRL.height, d), ctrl, [s.x, CPX_CTRL.height / 2, railDepth + d / 2]);
        // status display, and the Ethernet patch cable into the duct
        b.add(boxGeo(s.width * 0.42, 0.016, 0.001), glass, [s.x - s.width * 0.14, CPX_CTRL.height - 0.03, railDepth + d + 0.0005]);
        if (wireDuct) b.add(boxGeo(0.008, DUCT.gap + 0.01, 0.008), stripe, [s.x - s.width * 0.25, -DUCT.gap / 2, railDepth + d * 0.55]);
      } else {
        const d = M5069.depth;
        b.add(boxGeo(s.width - 0.0006, M5069.height, d), body, [s.x, M5069.height / 2, railDepth + d / 2]);
        b.add(boxGeo(s.width - 0.004, 0.003, 0.001), stripe, [s.x, M5069.height - 0.011, railDepth + d + 0.0005]);
        if (s.wired) {
          // field wires: down the RTB front and into the duct
          const top = M5069.rtbTop - 0.01;
          const bottom = wireDuct ? -DUCT.gap + 0.004 : 0.004;
          for (const dx of [-0.25, 0.25]) b.add(boxGeo(s.width * 0.18, top - bottom, 0.003), wire, [s.x + dx * s.width, (top + bottom) / 2, railDepth + M5069.rtbFront + 0.004]);
        }
      }
    }
    // 5069-ECR end cap
    b.add(boxGeo(END_CAP_5069_WIDTH, M5069.height, M5069.depth), body, [totalWidth / 2 - END_CAP_5069_WIDTH / 2, M5069.height / 2, railDepth + M5069.depth / 2]);
  });
  return <mesh geometry={geo} material={uberMat()} castShadow receiveShadow />;
}
