/**
 * Bulletin 800F 22.5 mm LED pilot light with a faceted colored lens (realistic dim daylight look
 * when off, bright glow with bloom when on), legend plate, LED module behind the panel.
 *
 * Origin: center of the mounting hole on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { PilotLightProps } from '../../contracts';
import { Bezel800F, F800, LegendPlate800F, Rear800F, type BezelKind } from './parts800F';
import { LENS_HEX, LIT_HEX, facetTexture, latheZ } from './shared';

export interface PilotLight800FProps extends PilotLightProps {
  bezel?: BezelKind;
  panelThickness?: number;
  rear?: boolean;
  /** Blink (1 Hz) while lit. */
  flash?: boolean;
}

function lensGeo() {
  const r = 0.0114;
  const pts: [number, number][] = [
    [0, 0.0012],
    [r, 0.0012],
    [r, 0.0066],
  ];
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    pts.push([r * Math.cos(a), 0.0066 + 0.0026 * Math.sin(a)]);
  }
  return latheZ('800f-pilot-lens', pts, 56, r);
}

export function PilotLight800F({
  color,
  getLit,
  legend,
  bezel = 'metal',
  panelThickness,
  rear = true,
  flash = false,
  position,
  rotation,
  scale,
}: PilotLight800FProps) {
  const mat = useMemo(() => {
    const tex = facetTexture();
    return new THREE.MeshStandardMaterial({
      color: LENS_HEX[color],
      map: tex,
      emissive: LIT_HEX[color],
      emissiveMap: tex,
      bumpMap: tex,
      bumpScale: 0.6,
      emissiveIntensity: 0,
      roughness: 0.18,
      metalness: 0,
      toneMapped: false,
    });
  }, [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  const tints = useMemo(
    () => ({ lit: new THREE.Color(LIT_HEX[color]).multiplyScalar(0.8), unlit: new THREE.Color(LENS_HEX[color]).multiplyScalar(0.6) }),
    [color],
  );
  useFrame(({ clock }) => {
    let lit = getLit();
    if (lit && flash) lit = Math.floor(clock.elapsedTime * 2) % 2 === 0;
    if (mat.userData.lit === lit) return;
    mat.userData.lit = lit;
    mat.color.copy(lit ? tints.lit : tints.unlit);
    mat.emissiveIntensity = lit ? 3 : 0;
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {legend !== undefined && legend !== '' && <LegendPlate800F lines={legend.split('\n')} />}
      <Bezel800F kind={bezel} />
      <mesh geometry={lensGeo()} material={mat} castShadow />
      {rear && <Rear800F items={[null, 'LED', null]} panelThickness={panelThickness ?? F800.panelT} led={color} />}
    </group>
  );
}
