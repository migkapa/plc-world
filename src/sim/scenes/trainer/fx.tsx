/**
 * Small visual-state helpers shared by the `trainer` and `motor-station` views (scene-owned, so an I/O state reads
 * clearly from every camera preset). Lamp lenses need no helper: the 800F / 855T / 856T devices render their own
 * dark unlit lens and a bloom-level lit core.
 *
 *  - <GlowDisc>: an additive halo disc for non-lamp state cues (contactor window, overload flag, reset button).
 *  - <SoundWaves>: expanding rings in a panel plane while a sounder is on (buzzer, horn).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { useDisposeOnUnmount } from '../../../twin/dispose';
import { canvasTexture, kgeo, kmat } from './kit';

export type LampColor = 'green' | 'red' | 'amber' | 'yellow' | 'blue' | 'white';

/** Lit LED colors (same hues as the 800F lens). */
const LIT_HEX: Record<LampColor, string> = {
  green: '#18ff3c',
  amber: '#ff6a00',
  red: '#ff1f1f',
  yellow: '#ffd21a',
  blue: '#2a7dff',
  white: '#fff7ea',
};

export function glowTexture(): THREE.Texture {
  return canvasTexture(
    'fx-glow',
    128,
    128,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.28)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.07)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { color: false },
  );
}

/** Additive glow material (cached per color × gain). */
export function glowMaterial(hex: string, gain = 1.6): THREE.MeshBasicMaterial {
  return kmat(
    `fx:glow:${hex}:${gain}`,
    () =>
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: new THREE.Color(hex).multiplyScalar(gain),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
  );
}

const PLANE = () => kgeo('fx:plane', () => new THREE.PlaneGeometry(1, 1));

/** Additive glow disc facing +Z (visible while `getOn()`), e.g. in front of a lamp lens. */
export function GlowDisc({ color, getOn, size, position, gain = 1.6 }: { color: LampColor | string; getOn: () => boolean; size: number; position?: Vec3; gain?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const hex = color in LIT_HEX ? LIT_HEX[color as LampColor] : color;
  useFrame(() => {
    const m = ref.current;
    if (m) m.visible = getOn();
  });
  return <mesh ref={ref} geometry={PLANE()} material={glowMaterial(hex, gain)} position={position} scale={[size, size, 1]} visible={false} renderOrder={2} />;
}

function ringTexture(): THREE.Texture {
  return canvasTexture(
    'fx-ring',
    128,
    128,
    (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.36, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.55, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { color: false },
  );
}

/**
 * Expanding "sound wave" rings in the local XY plane while `getOn()` (3 rings, additive). `r0`..`r1` is the
 * ring radius range (m), `period` the time for one ring to travel it (s).
 */
export function SoundWaves({ getOn, r0, r1, color = '#ffb020', period = 0.9, position }: { getOn: () => boolean; r0: number; r1: number; color?: string; period?: number; position?: Vec3 }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useMemo(
    () =>
      [0, 1, 2].map(
        () =>
          new THREE.MeshBasicMaterial({
            map: ringTexture(),
            color: new THREE.Color(color).multiplyScalar(1.4),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
      ),
    [color],
  );
  useDisposeOnUnmount(mats);
  useFrame(({ clock }) => {
    const on = getOn();
    for (let i = 0; i < 3; i++) {
      const m = refs.current[i];
      if (!m) continue;
      if (m.visible !== on) m.visible = on;
      if (!on) continue;
      const u = (clock.elapsedTime / period + i / 3) % 1;
      const r = r0 + (r1 - r0) * u;
      m.scale.set(2 * r, 2 * r, 1);
      mats[i]!.opacity = (1 - u) * (1 - u) * 0.9;
    }
  });
  return (
    <group position={position}>
      {mats.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          geometry={PLANE()}
          material={m}
          visible={false}
          renderOrder={2}
        />
      ))}
    </group>
  );
}
