/**
 * Bulletin 800F 22.5 mm push button (flush / extended / mushroom, optional extended guard),
 * chrome (800FM metal) or black (800FP plastic) bezel, optional illuminated lens, legend plate
 * above, mounting latch + contact block behind the panel.
 *
 * Origin: center of the mounting hole on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { PushButtonProps } from '../../contracts';
import { Bezel800F, F800, LegendPlate800F, Rear800F, type BezelKind, type RearItem } from './parts800F';
import { CAP_HEX, LENS_HEX, LIT_HEX, arcPts, damp, fresnelTexture, latheZ, mats, operatorToLed, useMomentary } from './shared';

export interface PushButton800FProps extends PushButtonProps {
  /** 'metal' = chrome 800FM bezel (default), 'plastic' = black 800FP bezel. */
  bezel?: BezelKind;
  /** Extended guard collar around a flush cap (800F-...G style). */
  guard?: boolean;
  /** Panel/door sheet thickness (m) for the rear assembly. */
  panelThickness?: number;
  /** Render the latch & contact blocks behind the panel (default true). */
  rear?: boolean;
}

const TRAVEL = { flush: 0.0035, extended: 0.0038, mushroom: 0.0045 } as const;

function capProfile(zf: number): [number, number][] {
  const r = F800.capR;
  const e = 0.0011;
  return [
    [0, 0.0012],
    [r, 0.0012],
    [r, zf - e],
    ...arcPts(r - e, zf - e, e, 0, 90, 6),
    [r * 0.55, zf - 0.00028],
    [0, zf - 0.00032],
  ];
}

const MUSHROOM_40: [number, number][] = [
  [0, 0.0012],
  [0.0104, 0.0012],
  [0.0104, 0.0112],
  [0.0132, 0.0118],
  [0.0168, 0.0131],
  [0.0189, 0.0146],
  [0.0199, 0.016],
  [0.02, 0.0172],
  [0.02, 0.0192],
  ...arcPts(0.0182, 0.0192, 0.0018, 0, 90, 6),
  [0.015, 0.0216],
  [0.01, 0.0223],
  [0.005, 0.0226],
  [0, 0.0227],
];

export function capGeometry(style: 'flush' | 'extended' | 'mushroom') {
  switch (style) {
    case 'mushroom':
      return latheZ('800f-cap-mushroom40', MUSHROOM_40, 64, 0.02);
    case 'extended':
      return latheZ('800f-cap-extended', capProfile(0.0124), 48, F800.capR);
    default:
      return latheZ('800f-cap-flush', capProfile(0.0069), 48, F800.capR);
  }
}

export function PushButton800F({
  color,
  style = 'flush',
  legend,
  getLit,
  getPressed,
  onPress,
  onRelease,
  contact = 'N.O.',
  bezel = 'metal',
  guard = false,
  panelThickness,
  rear = true,
  position,
  rotation,
  scale,
}: PushButton800FProps) {
  const capRef = useRef<THREE.Group>(null);
  const { handlers } = useMomentary(onPress, onRelease);
  const illuminated = !!getLit;
  const led = operatorToLed(color);

  const lensMat = useMemo(() => {
    if (!illuminated) return null;
    const fres = fresnelTexture();
    return new THREE.MeshStandardMaterial({
      color: LENS_HEX[led],
      map: fres,
      emissive: LIT_HEX[led],
      emissiveMap: fres,
      emissiveIntensity: 0,
      roughness: 0.22,
      metalness: 0,
      toneMapped: false,
    });
  }, [illuminated, led]);
  useEffect(() => () => lensMat?.dispose(), [lensMat]);
  const tints = useMemo(
    () => ({ lit: new THREE.Color(LIT_HEX[led]).multiplyScalar(0.75), unlit: new THREE.Color(LENS_HEX[led]).multiplyScalar(0.62) }),
    [led],
  );

  const travel = TRAVEL[style];
  useFrame((_, dt) => {
    const g = capRef.current;
    if (g) g.position.z = damp(g.position.z, getPressed() ? -travel : 0, 30, Math.min(dt, 0.05));
    if (lensMat && getLit) {
      const lit = getLit();
      if (lensMat.userData.lit !== lit) {
        lensMat.userData.lit = lit;
        lensMat.color.copy(lit ? tints.lit : tints.unlit);
        lensMat.emissiveIntensity = lit ? 2.6 : 0;
      }
    }
  });

  const contactItem: RearItem = contact === 'N.C.' ? 'NC' : 'NO';
  const rearItems: [RearItem, RearItem, RearItem] = illuminated ? [contactItem, 'LED', null] : [null, contactItem, null];
  const capMat = lensMat ?? mats.gloss(CAP_HEX[color]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {legend !== undefined && legend !== '' && <LegendPlate800F lines={legend.split('\n')} lift={style === 'mushroom' ? 0.0068 : 0} />}
      <group {...handlers}>
        <Bezel800F kind={bezel} guard={guard && style !== 'mushroom'} />
        <group ref={capRef}>
          <mesh geometry={capGeometry(style)} material={capMat} castShadow />
        </group>
      </group>
      {rear && <Rear800F items={rearItems} panelThickness={panelThickness} led={led} />}
    </group>
  );
}
