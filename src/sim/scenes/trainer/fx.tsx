/**
 * Small visual-state helpers shared by the `trainer` and `motor-station` views (scene-owned wrappers around
 * shared devices, so an I/O state reads clearly from every camera preset):
 *
 *  - <LampBoost>: wraps an 800F pilot light. Unlit, the lens is a dark, desaturated glass (so an "off" amber
 *    or blue lamp no longer reads as lit); lit, every color gets an HDR emissive level high enough to bloom
 *    (not only green) plus a soft additive halo disc in front of the lens.
 *  - <GlowDisc>: the additive halo on its own (status LEDs, beacons).
 *  - <SoundWaves>: expanding rings in a panel plane while a sounder is on (buzzer, horn).
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { canvasTexture, kgeo, kmat } from './kit';

export type LampColor = 'green' | 'red' | 'amber' | 'yellow' | 'blue' | 'white';

/** Lit LED colors (same hues as the 800F lens), linear-space luminance ~0.2–0.95. */
const LIT_HEX: Record<LampColor, string> = {
  green: '#18ff3c',
  amber: '#ff6a00',
  red: '#ff1f1f',
  yellow: '#ffd21a',
  blue: '#2a7dff',
  white: '#fff7ea',
};
const LENS_HEX: Record<LampColor, string> = {
  green: '#1c9a45',
  red: '#c01820',
  amber: '#e88a10',
  yellow: '#e9cf2a',
  blue: '#2458c4',
  white: '#e6e6e0',
};

/** Emissive intensity that puts the lit lens well above the bloom threshold (luminance ≈ 2.2). */
function litIntensity(c: LampColor): number {
  const col = new THREE.Color(LIT_HEX[c]);
  const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
  return THREE.MathUtils.clamp(2.2 / Math.max(0.05, lum), 2.6, 11);
}

/** Dark, desaturated "unlit glass" tint (~20 % value in sRGB). */
function offColor(c: LampColor): THREE.Color {
  const col = new THREE.Color(LENS_HEX[c]).multiplyScalar(c === 'white' ? 0.16 : 0.11);
  return col.lerp(new THREE.Color(0.03, 0.03, 0.03), 0.35);
}

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

function isLensMaterial(m: unknown): m is THREE.MeshStandardMaterial {
  if (!(m instanceof THREE.MeshStandardMaterial)) return false;
  if (!Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey')) return false;
  try {
    return String(m.customProgramCacheKey()).startsWith('lens-core');
  } catch {
    return false;
  }
}

/**
 * Wraps a <PilotLight800F> (origin = mounting hole, +Z out). Drives the lens material after the device's own
 * update each frame (dark glass when off, bloom-level emissive when on) and adds a halo disc.
 */
export function LampBoost({ color, getLit, flash = false, children, halo = 0.052 }: { color: LampColor; getLit: () => boolean; flash?: boolean; children: ReactNode; halo?: number }) {
  const group = useRef<THREE.Group>(null);
  const lensMesh = useRef<THREE.Mesh | null>(null);
  const lensMat = useRef<THREE.MeshStandardMaterial | null>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const off = useMemo(() => offColor(color), [color]);
  const litE = useMemo(() => litIntensity(color), [color]);
  const find = () => {
    lensMesh.current = null;
    lensMat.current = null;
    group.current?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!lensMat.current && mesh.isMesh && isLensMaterial(mesh.material)) {
        lensMesh.current = mesh;
        lensMat.current = mesh.material as THREE.MeshStandardMaterial;
      }
    });
  };
  useLayoutEffect(find, []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => {
    let lit = getLit();
    if (lit && flash) lit = Math.floor(clock.elapsedTime * 2) % 2 === 0;
    if (!lensMat.current || lensMesh.current?.material !== lensMat.current) find();
    const m = lensMat.current;
    if (m) {
      if (lit) {
        if (m.emissiveIntensity !== litE) m.emissiveIntensity = litE;
      } else {
        m.color.copy(off);
        if (m.emissiveIntensity !== 0) m.emissiveIntensity = 0;
      }
    }
    const h = haloRef.current;
    if (h && h.visible !== lit) h.visible = lit;
  });
  return (
    <group ref={group}>
      {children}
      <mesh ref={haloRef} geometry={PLANE()} material={glowMaterial(LIT_HEX[color], color === 'white' ? 1.1 : 1.7)} position={[0, 0, 0.0108]} scale={[halo, halo, 1]} visible={false} renderOrder={2} />
    </group>
  );
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
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
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
