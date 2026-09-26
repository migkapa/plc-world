/**
 * Gallery-only helpers for the CompactLogix / PowerFlex / PanelView previews.
 *
 * The dev gallery's key light uses three's default shadow setup (±5 m frustum → ~5 mm shadow texels, no bias),
 * which produces acne stripes and blurry contact shadows on millimetre-scale devices. `PreviewShadowTuning`
 * tightens the frustum around the device and adds a small bias / normal bias (the app's <SceneCanvas> has its
 * own tuned lights, so this is not needed there).
 */
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';

export function PreviewShadowTuning({ extent = 0.5 }: { extent?: number }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (!l.isDirectionalLight || !l.castShadow) return;
      l.shadow.bias = -0.00008;
      l.shadow.normalBias = 0.0006;
      const c = l.shadow.camera;
      c.left = -extent;
      c.right = extent;
      c.top = extent;
      c.bottom = -extent;
      c.near = 1;
      c.far = 12;
      c.updateProjectionMatrix();
      l.shadow.needsUpdate = true;
    });
  }, [scene, extent]);
  return null;
}
