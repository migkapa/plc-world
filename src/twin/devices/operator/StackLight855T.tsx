/**
 * Bulletin 855T 70 mm Control Tower stack light: mounting base (surface base or 100 mm pole mount),
 * modular steady-light modules with vertical-prism lenses, optional sounder (horn) module that
 * vibrates and emits sound rings while on, and the top cap.
 *
 * Origin: center of the mounting surface under the base, +Y up (lenses are round; "front" = +Z).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { LedColor } from '../../common';
import type { StackLightProps } from '../../contracts';
import { LENS_HEX, LIT_HEX, arcPts, canvasTexture, cylY, mats, sharedGeo, Screw } from './shared';

export interface StackLight855TProps extends StackLightProps {
  /** Housing (base, rings, cap) color. Series B 855T is black; older units are light gray. */
  housing?: 'black' | 'gray';
  /** Pole length for the pole mount (m), default 0.1 (855T-BPM10). */
  poleLength?: number;
  /** Per-tier flashing (1.5 Hz) while lit. */
  getFlashing?: (index: number) => boolean;
}

export const S855 = {
  R: 0.035,
  moduleH: 0.0575,
  ringH: 0.0068,
  capH: 0.021,
  baseH: 0.036,
  footH: 0.012,
  adapterH: 0.034,
} as const;

const HOUSING_HEX = { black: '#1b1c1e', gray: '#b9bcbd' } as const;

/** Vertical prism ribs (one rib per texture repeat). */
function prismTexture() {
  const t = canvasTexture(
    '855t-prism',
    64,
    8,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#8a8a8a');
      g.addColorStop(0.2, '#ffffff');
      g.addColorStop(0.5, '#d4d4d4');
      g.addColorStop(0.85, '#a9a9a9');
      g.addColorStop(1, '#8a8a8a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { repeat: true, color: false },
  );
  return t;
}

function prismTextureRepeat() {
  const key = '855t-prism-rep';
  return sharedGeoTex(key, () => {
    const t = prismTexture().clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(44, 1);
    t.needsUpdate = true;
    return t;
  });
}

const texStore = new Map<string, THREE.Texture>();
function sharedGeoTex(key: string, make: () => THREE.Texture) {
  let t = texStore.get(key);
  if (!t) {
    t = make();
    texStore.set(key, t);
  }
  return t;
}

/** Sound module grille: rows of slots (invert = white slots on black, for alpha maps). */
function grilleTexture(invert = false) {
  return sharedGeoTex(`855t-grille:${invert}`, () => {
    const base = canvasTexture(
      `855t-grille-src:${invert}`,
      256,
      128,
      (ctx, w, h) => {
        ctx.fillStyle = invert ? '#000000' : '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = invert ? '#ffffff' : '#000000';
        const cols = 8;
        for (let c = 0; c < cols; c++) {
          const x = (c + 0.5) * (w / cols);
          for (let r = 0; r < 5; r++) {
            const y = h * 0.2 + r * (h * 0.15);
            ctx.beginPath();
            ctx.roundRect(x - 11, y - 3.5, 22, 7, 3.5);
            ctx.fill();
          }
        }
      },
      { color: false },
    );
    const t = base.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    t.needsUpdate = true;
    return t;
  });
}

function capGeo() {
  const R = S855.R - 0.0002;
  const H = S855.capH;
  // lathe around Y: build with latheZ-like helper but around Y -> use LatheGeometry directly
  return sharedGeo('855t-cap', () => {
    const pts = [
      [0, 0],
      [R, 0],
      [R, H * 0.45],
      ...arcPts(R - 0.006, H * 0.45, 0.006, 0, 60, 6),
      [R * 0.62, H - 0.0006],
      [R * 0.55, H],
      [0, H],
    ].map(([r, y]) => new THREE.Vector2(r!, y!));
    const g = new THREE.LatheGeometry(pts, 64);
    g.computeVertexNormals();
    return g;
  });
}

function adapterGeo() {
  return sharedGeo('855t-pole-adapter', () => {
    const H = S855.adapterH;
    const pts = [
      [0.0135, 0],
      [0.0165, 0.001],
      [0.0305, 0.012],
      [S855.R - 0.0002, 0.016],
      [S855.R - 0.0002, H],
      [0, H],
    ].map(([r, y]) => new THREE.Vector2(r!, y!));
    const g = new THREE.LatheGeometry(pts, 64);
    g.computeVertexNormals();
    return g;
  });
}

function footGeo() {
  return sharedGeo('855t-pole-foot', () => {
    const H = S855.footH;
    const pts = [
      [0, 0],
      [0.043, 0],
      [0.043, 0.003],
      ...arcPts(0.038, 0.003, 0.005, 0, 70, 5),
      [0.02, H - 0.001],
      [0.0165, H],
      [0.0165, H + 0.012],
      [0.0136, H + 0.0135],
      [0, H + 0.0135],
    ].map(([r, y]) => new THREE.Vector2(r!, y!));
    const g = new THREE.LatheGeometry(pts, 64);
    g.computeVertexNormals();
    return g;
  });
}

function surfaceBaseGeo() {
  return sharedGeo('855t-surface-base', () => {
    const H = S855.baseH;
    const R = S855.R - 0.0002;
    const pts = [
      [0, 0],
      [0.038, 0],
      [0.038, 0.004],
      [R, 0.006],
      [R, H],
      [0, H],
    ].map(([r, y]) => new THREE.Vector2(r!, y!));
    const g = new THREE.LatheGeometry(pts, 64);
    g.computeVertexNormals();
    return g;
  });
}

function LightModule({ color, index, getTier, getFlashing, housingMat }: { color: LedColor; index: number; getTier: (i: number) => boolean; getFlashing?: (i: number) => boolean; housingMat: THREE.Material }) {
  const mat = useMemo(() => {
    const tex = prismTextureRepeat();
    return new THREE.MeshStandardMaterial({
      color: LENS_HEX[color],
      map: tex,
      emissive: LIT_HEX[color],
      emissiveMap: tex,
      bumpMap: tex,
      bumpScale: 1.2,
      emissiveIntensity: 0,
      roughness: 0.2,
      metalness: 0,
      toneMapped: false,
    });
  }, [color]);
  useEffect(() => () => mat.dispose(), [mat]);
  const tints = useMemo(
    () => ({
      lit: new THREE.Color(LIT_HEX[color]).multiplyScalar(color === 'white' ? 0.5 : 0.85),
      unlit: new THREE.Color(LENS_HEX[color]).multiplyScalar(color === 'white' ? 0.55 : 0.5),
      litI: color === 'white' ? 1.3 : color === 'yellow' ? 1.6 : 2.4,
    }),
    [color],
  );
  useFrame(({ clock }) => {
    let lit = getTier(index);
    if (lit && getFlashing?.(index)) lit = Math.floor(clock.elapsedTime * 3) % 2 === 0;
    if (mat.userData.lit === lit) return;
    mat.userData.lit = lit;
    mat.color.copy(lit ? tints.lit : tints.unlit);
    mat.emissiveIntensity = lit ? tints.litI : 0;
  });
  const H = S855.moduleH;
  const ring = S855.ringH;
  const lensH = H - ring;
  return (
    <group>
      {/* bayonet coupling ring */}
      <mesh geometry={cylY(S855.R - 0.0003, S855.R - 0.0003, ring, 64)} material={housingMat} position={[0, ring / 2, 0]} castShadow />
      <mesh geometry={cylY(S855.R + 0.0001, S855.R + 0.0001, 0.0009, 64)} material={housingMat} position={[0, ring - 0.0005, 0]} />
      {/* lens */}
      <mesh geometry={cylY(S855.R - 0.0008, S855.R - 0.0008, lensH, 64, true)} material={mat} position={[0, ring + lensH / 2, 0]} castShadow />
    </group>
  );
}

function SoundModule({ getHorn, housingMat }: { getHorn: () => boolean; housingMat: THREE.Material }) {
  const body = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const ringMats = useMemo(
    () => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: '#ffe7a6', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })),
    [],
  );
  useEffect(() => () => ringMats.forEach((m) => m.dispose()), [ringMats]);
  const grille = useMemo(() => {
    const t = grilleTexture();
    return new THREE.MeshStandardMaterial({
      color: (housingMat as THREE.MeshStandardMaterial).color.clone().multiplyScalar(1.05),
      roughness: 0.6,
      metalness: 0.05,
      bumpMap: t,
      bumpScale: 3,
    });
  }, [housingMat]);
  useEffect(() => () => grille.dispose(), [grille]);
  const slotMat = useMemo(() => {
    const t = grilleTexture(true);
    return new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: t, transparent: true, depthWrite: false, opacity: 0.85 });
  }, []);
  useEffect(() => () => slotMat.dispose(), [slotMat]);

  useFrame(({ clock }) => {
    const on = getHorn();
    const t = clock.elapsedTime;
    const b = body.current;
    if (b) {
      b.position.x = on ? Math.sin(t * 190) * 0.00035 : 0;
      b.position.z = on ? Math.cos(t * 170) * 0.00025 : 0;
    }
    for (let i = 0; i < 3; i++) {
      const r = rings.current[i];
      if (!r) continue;
      const m = ringMats[i]!;
      if (!on) {
        r.visible = false;
        continue;
      }
      r.visible = true;
      const ph = (t * 1.6 + i / 3) % 1;
      const s = 1.04 + ph * 1.3;
      r.scale.set(s, 1 - ph * 0.5, s);
      m.opacity = (1 - ph) * (1 - ph) * 0.09;
    }
  });
  const H = S855.moduleH;
  const ring = S855.ringH;
  return (
    <group>
      <group ref={body}>
        <mesh geometry={cylY(S855.R - 0.0003, S855.R - 0.0003, ring, 64)} material={housingMat} position={[0, ring / 2, 0]} castShadow />
        <mesh geometry={cylY(S855.R - 0.0006, S855.R - 0.0006, H - ring, 64)} material={grille} position={[0, ring + (H - ring) / 2, 0]} castShadow />
        {/* slots (alpha-mapped dark openings slightly outside the grille surface) */}
        <mesh geometry={cylY(S855.R - 0.0004, S855.R - 0.0004, H - ring, 64, true)} material={slotMat} position={[0, ring + (H - ring) / 2, 0]} />
        {/* volume adjust dial */}
        <mesh geometry={cylY(0.004, 0.004, 0.002, 20)} material={mats.darkPlastic()} position={[0, ring + 0.006, S855.R - 0.0002]} rotation={[Math.PI / 2, 0, 0]} />
      </group>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
          geometry={sharedGeo('855t-sound-shell', () => new THREE.CylinderGeometry(S855.R, S855.R, S855.moduleH * 0.4, 48, 1, true))}
          material={ringMats[i]}
          position={[0, ring + (H - ring) / 2, 0]}
          visible={false}
        />
      ))}
    </group>
  );
}

export function StackLight855T({
  tiers,
  getTier,
  getHorn,
  getFlashing,
  mount = 'pole',
  housing = 'black',
  poleLength = 0.1,
  position,
  rotation,
  scale,
}: StackLight855TProps) {
  const housingMat = mats.matte(HOUSING_HEX[housing], 0.5);
  const poleMat = mats.metal('#d3d7db', 0.45);
  let y = 0;
  const parts: ReactNode[] = [];
  if (mount === 'pole') {
    parts.push(
      <group key="foot">
        <mesh geometry={footGeo()} material={housingMat} castShadow receiveShadow />
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
          return <Screw key={i} position={[Math.cos(a) * 0.033, 0.0035, Math.sin(a) * 0.033]} rotation={[-Math.PI / 2, 0, 0]} r={0.0028} h={0.0014} />;
        })}
        <mesh geometry={cylY(0.0125, 0.0125, poleLength, 32)} material={poleMat} position={[0, S855.footH + poleLength / 2, 0]} castShadow />
      </group>,
    );
    y = S855.footH + poleLength - 0.004;
    parts.push(<mesh key="adapter" geometry={adapterGeo()} material={housingMat} position={[0, y, 0]} castShadow />);
    y += S855.adapterH;
  } else {
    parts.push(<mesh key="base" geometry={surfaceBaseGeo()} material={housingMat} castShadow receiveShadow />);
    y = S855.baseH;
  }
  // modules bottom -> top (tiers are listed top -> bottom)
  for (let i = tiers.length - 1; i >= 0; i--) {
    parts.push(
      <group key={`t${i}`} position={[0, y, 0]}>
        <LightModule color={tiers[i]!} index={i} getTier={getTier} getFlashing={getFlashing} housingMat={housingMat} />
      </group>,
    );
    y += S855.moduleH;
  }
  if (getHorn) {
    parts.push(
      <group key="horn" position={[0, y, 0]}>
        <SoundModule getHorn={getHorn} housingMat={housingMat} />
      </group>,
    );
    y += S855.moduleH;
  }
  parts.push(<mesh key="cap" geometry={capGeo()} material={housingMat} position={[0, y, 0]} castShadow />);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {parts}
    </group>
  );
}

/** Total height of an 855T column (for placement). */
export function stackLightHeight(tierCount: number, opts: { horn?: boolean; mount?: 'pole' | 'base'; poleLength?: number } = {}): number {
  const base = opts.mount === 'base' ? S855.baseH : S855.footH + (opts.poleLength ?? 0.1) - 0.004 + S855.adapterH;
  return base + (tierCount + (opts.horn ? 1 : 0)) * S855.moduleH + S855.capH;
}

