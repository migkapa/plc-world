/**
 * Distance level-of-detail for the live ControlLogix rack inside the scene cabinets: from far away (the bay /
 * lab overviews, where the rack is a few dozen pixels wide) a 3-draw-call impostor with the same outline
 * replaces the ~80-100 draw-call live rack. The live rack stays mounted (its state keeps updating) and is
 * shown again as soon as the camera comes closer, with hysteresis so it never flickers.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { HardwareConfig } from '../../../plc/types';
import type { Vec3 } from '../../../twin/contracts';
import { controlLogixChassisLayout } from '../../../twin/devices';
import { KBOX, MergeStatic, km } from './kit';

const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Shows `near` within `distance` (m) of the camera, `far` beyond 1.15 × `distance`. */
export function DistanceSwitch({ distance, near, far }: { distance: number; near: ReactNode; far: ReactNode }) {
  const root = useRef<THREE.Group>(null);
  const n = useRef<THREE.Group>(null);
  const f = useRef<THREE.Group>(null);
  const isNear = useRef(true);
  useFrame(({ camera }) => {
    const g = root.current;
    if (!g || !n.current || !f.current) return;
    g.getWorldPosition(_p);
    camera.getWorldPosition(_c);
    const d = _p.distanceTo(_c);
    const want = isNear.current ? d < distance * 1.15 : d < distance;
    if (want !== isNear.current || n.current.visible !== want) {
      isNear.current = want;
      n.current.visible = want;
      f.current.visible = !want;
    }
  });
  return (
    <group ref={root}>
      <group ref={n}>{near}</group>
      <group ref={f} visible={false}>
        {far}
      </group>
    </group>
  );
}

/** Low-detail 1756 rack (chassis, power supply, module / filler fronts with their label doors). */
export function RackImpostor({ hardware, position }: { hardware: HardwareConfig; position?: Vec3 }) {
  const layout = controlLogixChassisLayout(hardware.chassis ?? '1756-A7');
  const parts = useMemo(() => {
    const H = 0.158;
    const x0 = -layout.width / 2;
    const used = new Set(hardware.modules.map((m) => m.slot));
    const dark: { p: Vec3; s: Vec3 }[] = [{ p: [x0 + layout.psCenterX, 0.075, 0.072], s: [0.108, 0.14, 0.134] }];
    const door: { p: Vec3; s: Vec3 }[] = [];
    for (let slot = 0; slot < layout.slots; slot++) {
      const x = x0 + layout.slotCenterX(slot);
      dark.push({ p: [x, 0.075, 0.07], s: [0.0332, 0.14, 0.13] });
      if (used.has(slot)) door.push({ p: [x, 0.058, 0.1352], s: [0.026, 0.05, 0.001] });
    }
    return { H, dark, door };
  }, [hardware, layout]);
  return (
    <group position={position}>
      <MergeStatic>
        <mesh geometry={KBOX()} material={km.metal('#9ea4aa', 0.45)} scale={[layout.width, parts.H, 0.012]} position={[0, parts.H / 2, 0.006]} />
        {parts.dark.map((b, i) => (
          <mesh key={i} geometry={KBOX()} material={km.plastic('#1c1e21', 0.55)} scale={b.s} position={b.p} />
        ))}
        {parts.door.map((b, i) => (
          <mesh key={`d${i}`} geometry={KBOX()} material={km.plastic('#d9dcdf', 0.6)} scale={b.s} position={b.p} />
        ))}
      </MergeStatic>
    </group>
  );
}
