import { Led, materials } from '../twin/common';
import type { Preview } from './gallery';

function SampleBox() {
  return (
    <group>
      <mesh material={materials.plastic()} position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[0.035, 0.14, 0.14]} />
      </mesh>
      <Led color="green" get={() => 'flash'} position={[0, 0.12, 0.0705]} />
    </group>
  );
}

export const previews: Record<string, Preview> = {
  _sample: { Component: SampleBox, description: 'Sanity check preview' },
};
