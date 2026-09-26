/**
 * Bulletin 800F 22.5 mm selector switch: 2- or 3-position, standard knob or long lever,
 * legend plate with position labels (e.g. HAND OFF AUTO). Click the left/right half of the
 * knob to turn it one position left/right (2-position switches toggle).
 *
 * Origin: center of the mounting hole on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import type { SelectorSwitchProps } from '../../contracts';
import { F800, LegendPrint800F, addBezel, addLegendPlate, addRear800F, rearKey, type BezelKind, type RearItem } from './parts800F';
import { CAP_HEX, F, HoverRing, arcPts, boxGeo, damp, latheZ, partsGeo, roundedRectShape, sharedGeo, uberMat, useClick } from './shared';

export interface SelectorSwitch800FProps extends SelectorSwitchProps {
  bezel?: BezelKind;
  panelThickness?: number;
  rear?: boolean;
}

/** Knob angle (radians, CCW positive around +Z) for a position index. */
export function selectorAngle(index: number, count: number): number {
  if (count <= 1) return 0;
  const span = count <= 3 ? Math.PI / 2 : (Math.PI / 6) * (count - 1);
  return span / 2 - (index * span) / (count - 1);
}

const BASE_Z = 0.0078;

function knobBaseGeo() {
  const r = 0.0114;
  return latheZ('800f-knob-base', [[0, 0.0012], [r, 0.0012], [r, BASE_Z - 0.0009], ...arcPts(r - 0.0009, BASE_Z - 0.0009, 0.0009, 0, 90, 4), [0, BASE_Z]], 48);
}

function gripGeo(kind: 'standard' | 'long-lever') {
  return sharedGeo(`800f-grip:${kind}`, () => {
    let shape: THREE.Shape;
    if (kind === 'standard') {
      shape = roundedRectShape(0.0068, 0.0226, 0.0028);
    } else {
      // long lever: pointer tip up, rounded tail down
      shape = new THREE.Shape();
      const w = 0.0078;
      shape.moveTo(-w / 2, -0.0105);
      shape.lineTo(-w / 2, 0.018);
      shape.lineTo(-0.0012, 0.0262);
      shape.quadraticCurveTo(0, 0.0272, 0.0012, 0.0262);
      shape.lineTo(w / 2, 0.018);
      shape.lineTo(w / 2, -0.0105);
      shape.quadraticCurveTo(w / 2, -0.0142, 0, -0.0142);
      shape.quadraticCurveTo(-w / 2, -0.0142, -w / 2, -0.0105);
    }
    const depth = kind === 'standard' ? 0.0098 : 0.0088;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.0009,
      bevelSize: 0.0007,
      bevelSegments: 3,
      curveSegments: 10,
    });
    g.translate(0, 0, BASE_Z - 0.0002);
    return g;
  });
}

export function SelectorSwitch800F({
  positions,
  getPosition,
  onChange,
  legend,
  knob = 'standard',
  color = 'black',
  bezel = 'metal',
  panelThickness,
  rear = true,
  position,
  rotation,
  scale,
}: SelectorSwitch800FProps) {
  const frame = useRef<THREE.Group>(null);
  const knobRef = useRef<THREE.Group>(null);
  const n = Math.max(1, positions.length);

  const step = useCallback(
    (local: THREE.Vector3) => {
      if (!onChange) return;
      const cur = Math.round(getPosition());
      const next = n === 2 ? 1 - cur : THREE.MathUtils.clamp(cur + (local.x < 0 ? -1 : 1), 0, n - 1);
      if (next !== cur) onChange(next);
    },
    [getPosition, n, onChange],
  );
  const { hovered, handlers } = useClick(onChange ? step : undefined, frame);

  useFrame((_, dt) => {
    const k = knobRef.current;
    if (!k) return;
    const idx = THREE.MathUtils.clamp(getPosition(), 0, n - 1);
    k.rotation.z = damp(k.rotation.z, selectorAngle(idx, n), 26, Math.min(dt, 0.05));
  });

  const depth = knob === 'standard' ? 0.0098 : 0.0088;
  const frontZ = BASE_Z - 0.0002 + depth + 0.0009;
  const rearItems: [RearItem, RearItem, RearItem] = n >= 3 ? ['NO', null, 'NO'] : [null, 'NO', null];
  const pt = panelThickness ?? F800.panelT;
  const staticGeo = partsGeo(`sel800f:${bezel}:${rear ? rearKey(rearItems, pt) : '-'}`, (b) => {
    addLegendPlate(b);
    addBezel(b, bezel, false, 0.0114);
    if (rear) addRear800F(b, rearItems, pt);
  });
  const knobGeo = partsGeo(`sel800f-knob:${knob}:${color}`, (b) => {
    const body = color === 'black' ? { color: CAP_HEX.black, rough: 0.24, metal: 0.02 } : F.gloss(CAP_HEX[color]);
    const mark = color === 'white' || color === 'yellow' ? F.matte('#111111', 0.5) : F.matte('#f4f4f0', 0.5);
    b.add(knobBaseGeo(), body);
    b.add(gripGeo(knob), body);
    // white position indicator line on the grip
    if (knob === 'standard') b.add(boxGeo(0.0012, 0.0092, 0.0003), mark, [0, 0.0058, frontZ + 0.00005]);
    else b.add(boxGeo(0.0014, 0.017, 0.0003), mark, [0, 0.0135, frontZ + 0.00005]);
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={frame}>
        <mesh geometry={staticGeo} material={uberMat()} castShadow receiveShadow />
        <LegendPrint800F lines={legend ? legend.split('\n') : []} positions={positions} />
        <HoverRing show={hovered} r={F800.bezelR + 0.0006} />
        <group ref={knobRef} {...handlers}>
          <mesh geometry={knobGeo} material={uberMat()} castShadow />
        </group>
      </group>
    </group>
  );
}
