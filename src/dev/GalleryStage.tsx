import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { ReactNode } from 'react';

/** Neutral studio lighting for inspecting device models (no network assets). */
export function GalleryStage({ children }: { children: ReactNode }) {
  return (
    <>
      <color attach="background" args={['#161b22']} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={2} position={[0, 3, 2]} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[-4, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[4, 1, 1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="ring" intensity={0.6} position={[0, 2, -4]} scale={3} />
      </Environment>
      {children}
      <ContactShadows position={[0, -0.001, 0]} opacity={0.5} scale={4} blur={2} far={1} />
      <EffectComposer>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={0.8} />
      </EffectComposer>
    </>
  );
}
