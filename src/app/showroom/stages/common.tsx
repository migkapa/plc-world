/**
 * Shared bits for showroom stages: mounting plates and small demo helpers.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { materials } from '../../../twin/common';
import type { Vec3 } from '../../../twin/contracts';
import type { DemoStore } from '../demo';

/** Vertical mounting plate (subpanel) behind wall-mounted devices. Center at `center`, thickness 3 mm. */
export function Backplate({ w, h, center, color = '#c9cdd1', metal = true }: { w: number; h: number; center: Vec3; color?: string; metal?: boolean }) {
  const mat = metal ? materials.metal(color, 0.55) : materials.paint(color, 0.6);
  return (
    <mesh position={[center[0], center[1], center[2] - 0.0015]} material={mat} receiveShadow castShadow>
      <boxGeometry args={[w, h, 0.003]} />
    </mesh>
  );
}

/**
 * Graphite display stand: a vertical slab from the floor up to `top`, behind z = 0 (devices mount on its front
 * face), with a thin red accent along the top edge.
 */
export function DisplayStand({ w, top, x = 0 }: { w: number; top: number; x?: number }) {
  const t = 0.014;
  return (
    <group position={[x, 0, -t / 2 - 0.0005]}>
      <mesh position={[0, top / 2, 0]} material={materials.metal('#2b3139', 0.62)} castShadow receiveShadow>
        <boxGeometry args={[w, top, t]} />
      </mesh>
      <mesh position={[0, top - 0.0012, t / 2 + 0.0002]}>
        <boxGeometry args={[w, 0.0024, 0.0004]} />
        <meshBasicMaterial color="#e0252b" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.004, 0.02]} material={materials.metal('#20252c', 0.7)} receiveShadow castShadow>
        <boxGeometry args={[w + 0.02, 0.008, t + 0.05]} />
      </mesh>
    </group>
  );
}

/** Horizontal mounting plate (e.g. under a sensor bench). */
export function Slab({ w, d, t = 0.02, center, color = '#aeb4b9' }: { w: number; d: number; t?: number; center: Vec3; color?: string }) {
  return (
    <mesh position={center} material={materials.metal(color, 0.45)} receiveShadow castShadow>
      <boxGeometry args={[w, t, d]} />
    </mesh>
  );
}

/** Seconds since page load (demo animations). */
export const now = (): number => performance.now() / 1000;

/**
 * Integrates a 0..1 position toward `target()` at `rate` per second inside the render loop and exposes it as a
 * getter (gates, valves, cylinders). Also mirrors the value into the demo store under `key` (throttled).
 */
export function useRamp(target: () => number, rate: number, demo?: DemoStore, key?: string): () => number {
  const v = useRef(target());
  const lastPush = useRef(0);
  useFrame((_, dt) => {
    const t = target();
    const step = rate * Math.min(dt, 0.1);
    v.current = v.current < t ? Math.min(t, v.current + step) : Math.max(t, v.current - step);
    if (demo && key) {
      const n = performance.now();
      if (n - lastPush.current > 120 || v.current === t) {
        lastPush.current = n;
        const rounded = Math.round(v.current * 100) / 100;
        if (demo.num(key) !== rounded) demo.set(key, rounded);
      }
    }
  });
  return useMemo(() => () => v.current, []);
}
