/**
 * Bulletin 800F 22.5 mm LED pilot light with a faceted colored lens (realistic dim daylight look
 * when off, bright glow with bloom when on), legend plate, LED module behind the panel.
 *
 * Origin: center of the mounting hole on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { PilotLightProps } from '../../contracts';
import { F800, LegendPrint800F, addBezel, addLegendPlate, addRear800F, rearKey, type BezelKind } from './parts800F';
import { facetTexture, latheZ, lensTints, makeLensMaterial, partsGeo, uberMat } from './shared';

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
    return makeLensMaterial(color, { map: tex, bumpMap: tex, bumpScale: 0.6, edge: 0.4 });
  }, [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  const tints = useMemo(() => lensTints(color, 3), [color]);
  useFrame(({ clock }) => {
    let lit = getLit();
    if (lit && flash) lit = Math.floor(clock.elapsedTime * 2) % 2 === 0;
    if (mat.userData.lit === lit) return;
    mat.userData.lit = lit;
    mat.color.copy(lit ? tints.lit : tints.unlit);
    mat.emissiveIntensity = lit ? tints.litE : tints.unlitE;
  });
  const hasLegend = legend !== undefined && legend !== '';
  const pt = panelThickness ?? F800.panelT;
  const staticGeo = partsGeo(`pilot800f:${hasLegend}:${bezel}:${rear ? rearKey([null, 'LED', null], pt, color) : '-'}`, (b) => {
    if (hasLegend) addLegendPlate(b);
    addBezel(b, bezel, false, 0.0114);
    if (rear) addRear800F(b, [null, 'LED', null], pt, color);
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {hasLegend && <LegendPrint800F lines={legend.split('\n')} />}
      <mesh geometry={staticGeo} material={uberMat()} castShadow receiveShadow />
      <mesh geometry={lensGeo()} material={mat} castShadow />
    </group>
  );
}
