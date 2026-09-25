/**
 * Bulletin 856T 70 mm Control Tower stack light (current Rockwell line; the 855T it replaces is
 * available as `series="855T"`): black housing, 10 cm aluminum pole on a base adaptor
 * (856T-BMAP10 style) or a surface base, modular LED light modules with a smooth polycarbonate
 * lens over an inner vertical-prism diffuser, black top cap, and an optional top-mount piezo sound
 * module (856T-BP1 style) that replaces the cap.
 *
 * Lenses look like translucent colored polycarbonate when off (saturated color + faint internal
 * scatter) and show a hot LED core when lit (emission strongest facing the viewer, brighter at
 * mid-height). The sounder vibrates slightly when on; `showSoundFx` adds a subtle gamified cue.
 *
 * Origin: center of the mounting surface under the base, +Y up (lenses are round; "front" = +Z).
 * Performance: all housing parts are ONE merged mesh; one mesh per light module lens; the sounder
 * is one mesh (it vibrates).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedColor } from '../../common';
import type { StackLightProps } from '../../contracts';
import { useDisposeOnUnmount } from '../../dispose';
import { F, arcPts, canvasTexture, cylY, lensTints, makeLensMaterial, partsGeo, setLensLit, sharedGeo, uberMat, addScrew, boxGeo, type Parts } from './shared';

export type StackLightSeries = '856T' | '855T';

export interface StackLight856TProps extends StackLightProps {
  /** Product generation: '856T' (current, default) or legacy '855T'. */
  series?: StackLightSeries;
  /** Housing (base, rings, cap) color. 856T is black; legacy 855T was also sold in light gray. */
  housing?: 'black' | 'gray';
  /** Pole length for the pole mount (m), default 0.1 (10 cm pole). */
  poleLength?: number;
  /** Per-tier flashing (1.5 Hz) while lit. */
  getFlashing?: (index: number) => boolean;
  /** Gamified cue while the sounder is on: glowing grille pulse + faint expanding ring (default false). */
  showSoundFx?: boolean;
}

/** Dimensions (m). */
export const S856 = {
  R: 0.035,
  moduleH: 0.056,
  ringH: 0.0045,
  capH: 0.016,
  soundH: 0.04,
  baseH: 0.036,
  footH: 0.012,
  adapterH: 0.03,
} as const;

/** Legacy 855T dimensions (taller modules, stacked sounder module + dome cap). */
export const S855 = {
  R: 0.035,
  moduleH: 0.0575,
  ringH: 0.0068,
  capH: 0.021,
  soundH: 0.0575,
  baseH: 0.036,
  footH: 0.012,
  adapterH: 0.034,
} as const;

const HOUSING_HEX = { black: '#1a1b1d', gray: '#b9bcbd' } as const;

const dims = (series: StackLightSeries) => (series === '855T' ? S855 : S856);

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const texStore = new Map<string, THREE.Texture>();
function repTex(key: string, make: () => THREE.Texture) {
  let t = texStore.get(key);
  if (!t) {
    t = make();
    texStore.set(key, t);
  }
  return t;
}

/** Inner prism diffuser ribs (grayscale, floor ≈ 0.85 so the lens color stays saturated). */
function prismTexture() {
  return repTex('856t-prism', () => {
    const base = canvasTexture(
      '856t-prism-src',
      64,
      8,
      (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#d6d6d6');
        g.addColorStop(0.25, '#ffffff');
        g.addColorStop(0.55, '#ececec');
        g.addColorStop(0.85, '#dcdcdc');
        g.addColorStop(1, '#d6d6d6');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      },
      { color: false },
    );
    const t = base.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(48, 1);
    t.needsUpdate = true;
    return t;
  });
}

/** Emission map: prism ribs × vertical hot-core profile (bright at mid-height, dim at the rims). */
function coreTexture() {
  return repTex('856t-core', () => {
    const base = canvasTexture(
      '856t-core-src',
      64,
      128,
      (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#9a9a9a');
        g.addColorStop(0.25, '#ffffff');
        g.addColorStop(0.55, '#e0e0e0');
        g.addColorStop(0.85, '#b4b4b4');
        g.addColorStop(1, '#9a9a9a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'multiply';
        const v = ctx.createLinearGradient(0, 0, 0, h);
        v.addColorStop(0, '#3a3a3a');
        v.addColorStop(0.18, '#b0b0b0');
        v.addColorStop(0.5, '#ffffff');
        v.addColorStop(0.82, '#b0b0b0');
        v.addColorStop(1, '#3a3a3a');
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      },
      { color: false },
    );
    const t = base.clone();
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(48, 1);
    t.needsUpdate = true;
    return t;
  });
}

/** Soft ring for the optional sound cue: radial alpha that fades at BOTH edges. */
function softRingTexture() {
  return canvasTexture('856t-soft-ring', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------------------
// Geometry (lathes around +Y; seam turned to the back)
// ---------------------------------------------------------------------------

function latheY(key: string, pts: [number, number][], seg = 64) {
  return sharedGeo(`856t-lathe:${key}:${seg}`, () => {
    // drop zero-length segments (they would give undefined profile normals)
    const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1]![0], p[1] - pts[i - 1]![1]) > 1e-7);
    return new THREE.LatheGeometry(clean.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg, Math.PI);
  });
}

/** Lens: 856T = slight barrel (smooth outer shell), 855T = straight cylinder. */
function lensGeo(series: StackLightSeries) {
  const d = dims(series);
  const h = d.moduleH - d.ringH;
  const R = d.R - 0.0007;
  if (series === '855T') return sharedGeo('855t-lens', () => new THREE.CylinderGeometry(R, R, h, 64, 1, true).translate(0, h / 2, 0).rotateY(Math.PI));
  const pts: [number, number][] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([R - 0.0004 + 0.0007 * Math.sin(Math.PI * t), h * t]);
  }
  // lathe with u around / v along height (same as a cylinder) -> the prism texture wraps correctly
  return latheY('856t-lens', pts, 64);
}

function ringGeo(series: StackLightSeries) {
  const d = dims(series);
  const R = d.R;
  if (series === '855T')
    return latheY('855t-ring', [
      [R - 0.003, 0],
      [R - 0.0003, 0],
      [R - 0.0003, d.ringH - 0.0014],
      [R + 0.0002, d.ringH - 0.0012],
      [R + 0.0002, d.ringH - 0.0004],
      [R - 0.0012, d.ringH],
      [R - 0.003, d.ringH],
    ]);
  // 856T: slim black coupling band with a fine groove
  return latheY('856t-ring', [
    [R - 0.003, 0],
    [R - 0.0004, 0],
    ...arcPts(R - 0.0009, 0.0005, 0.0005, -90, 0, 3),
    [R - 0.0004, d.ringH * 0.45],
    [R - 0.0009, d.ringH * 0.5],
    [R - 0.0004, d.ringH * 0.55],
    [R - 0.0004, d.ringH - 0.0003],
    [R - 0.0012, d.ringH],
    [R - 0.003, d.ringH],
  ]);
}

function capGeo(series: StackLightSeries) {
  const d = dims(series);
  const R = d.R - 0.0003;
  const H = d.capH;
  if (series === '855T')
    return latheY('855t-cap', [
      [0, 0],
      [R, 0],
      [R, H * 0.45],
      ...arcPts(R - 0.006, H * 0.45, 0.006, 0, 60, 6),
      [R * 0.62, H - 0.0006],
      [R * 0.55, H],
      [0, H],
    ]);
  // 856T: low cap, soft shoulder, flat top with a shallow center dish
  return latheY('856t-cap', [
    [0, H - 0.0008],
    [R * 0.45, H - 0.0006],
    [R * 0.5, H],
    [R - 0.0045, H],
    ...arcPts(R - 0.0045, H - 0.0045, 0.0045, 90, 0, 7),
    [R, 0],
    [0, 0],
  ].reverse() as [number, number][]);
}

/** Pole-mount foot: flat flange + conical boss + pole socket. */
function footGeo() {
  const H = S856.footH;
  return latheY('856t-foot', [
    [0, H + 0.0135],
    [0.0136, H + 0.0135],
    [0.0165, H + 0.012],
    [0.0165, H],
    [0.02, H - 0.001],
    [0.031, 0.0045],
    [0.0425, 0.004],
    ...arcPts(0.0425, 0.002, 0.002, 90, 0, 3),
    [0.0445, 0],
    [0, 0],
  ].reverse() as [number, number][]);
}

function adapterGeo(series: StackLightSeries) {
  const d = dims(series);
  const H = d.adapterH;
  const R = d.R - 0.0003;
  return latheY(`${series}-adapter`, [
    [0, H],
    [R, H],
    [R, 0.016],
    [0.0305, 0.011],
    [0.0165, 0.001],
    [0.0135, 0],
  ].reverse() as [number, number][]);
}

function surfaceBaseGeo(series: StackLightSeries) {
  const d = dims(series);
  const H = d.baseH;
  const R = d.R - 0.0003;
  return latheY(`${series}-surface-base`, [
    [0, H],
    [R, H],
    [R, 0.007],
    [0.0385, 0.005],
    ...arcPts(0.0385, 0.0035, 0.0015, 90, 0, 2),
    [0.04, 0],
    [0, 0],
  ].reverse() as [number, number][]);
}

/** 856T-BP1 style top sounder: body + top grille of radial slots + side sound slots + tone dial. */
function addSounder856(b: Parts, housing: THREE.ColorRepresentation) {
  const d = S856;
  const R = d.R - 0.0003;
  const H = d.soundH;
  const hf = F.matte(String(housing), 0.5);
  b.add(
    latheY('856t-sounder', [
      [0, H - 0.0015],
      [0.012, H - 0.0012],
      [0.013, H],
      [R - 0.005, H],
      ...arcPts(R - 0.005, H - 0.005, 0.005, 90, 0, 7),
      [R, 0],
      [0, 0],
    ].reverse() as [number, number][]),
    hf,
  );
  // radial top grille slots
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.add(boxGeo(0.0016, 0.0005, 0.0085), F.hole, [Math.sin(a) * 0.0195, H + 0.00005, Math.cos(a) * 0.0195], [0, a, 0]);
  }
  // side sound slots near the top shoulder
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    b.add(boxGeo(0.0016, 0.012, 0.0006), F.hole, [Math.sin(a) * (R + 0.00005), H * 0.52, Math.cos(a) * (R + 0.00005)], [0, a, 0]);
  }
  // tone / volume dial on the front
  b.add(cylY(0.0042, 0.0042, 0.0018, 20), F.darkPlastic, [0, H * 0.2, R + 0.0002], [Math.PI / 2, 0, 0]);
  b.add(boxGeo(0.0006, 0.0055, 0.0006), F.matte('#e8e8e2', 0.5), [0, H * 0.2, R + 0.0012]);
}

/** Legacy 855T stacked sounder module with a slotted grille band. */
function addSounder855(b: Parts, housing: THREE.ColorRepresentation) {
  const d = S855;
  const hf = F.matte(String(housing), 0.5);
  b.add(ringGeo('855T'), hf);
  b.add(cylY(d.R - 0.0006, d.R - 0.0006, d.moduleH - d.ringH, 64), hf, [0, d.ringH + (d.moduleH - d.ringH) / 2, 0]);
  for (let r = 0; r < 5; r++)
    for (let i = 0; i < 24; i++) {
      const a = ((i + (r % 2) * 0.5) / 24) * Math.PI * 2;
      b.add(boxGeo(0.0055, 0.0018, 0.0006), F.hole, [Math.sin(a) * (d.R - 0.0004), d.ringH + 0.012 + r * 0.0075, Math.cos(a) * (d.R - 0.0004)], [0, a, 0]);
    }
  b.add(cylY(0.004, 0.004, 0.002, 20), F.darkPlastic, [0, d.ringH + 0.006, d.R - 0.0002], [Math.PI / 2, 0, 0]);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function LightModule({
  color,
  index,
  series,
  getTier,
  getFlashing,
}: {
  color: LedColor;
  index: number;
  series: StackLightSeries;
  getTier: (i: number) => boolean;
  getFlashing?: (i: number) => boolean;
}) {
  const mat = useMemo(() => {
    const m = makeLensMaterial(color, { map: prismTexture(), emissiveMap: coreTexture(), bumpMap: prismTexture(), bumpScale: 0.8, edge: 0.3 });
    m.roughness = 0.2;
    return m;
  }, [color]);
  useDisposeOnUnmount(mat);
  // a beacon tier is a large diffuser: a slightly hotter core than the 22 mm pilot lights so it reads from afar
  const tints = useMemo(() => lensTints(color, color === 'white' ? 2 : color === 'yellow' ? 2.5 : 3.4), [color]);
  useFrame(({ clock }) => {
    let lit = getTier(index);
    if (lit && getFlashing?.(index)) lit = Math.floor(clock.elapsedTime * 3) % 2 === 0;
    setLensLit(mat, tints, lit);
  });
  return <mesh geometry={lensGeo(series)} material={mat} position={[0, dims(series).ringH, 0]} castShadow />;
}

function Sounder({ series, housing, getHorn, showSoundFx }: { series: StackLightSeries; housing: 'black' | 'gray'; getHorn: () => boolean; showSoundFx: boolean }) {
  const body = useRef<THREE.Group>(null);
  const fx = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const geo = partsGeo(`sounder:${series}:${housing}`, (b) => (series === '855T' ? addSounder855(b, HOUSING_HEX[housing]) : addSounder856(b, HOUSING_HEX[housing])));
  const d = dims(series);
  const fxMats = useMemo(() => {
    if (!showSoundFx) return null;
    return {
      glow: new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      ring: new THREE.MeshBasicMaterial({ color: '#ffffff', map: softRingTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    };
  }, [showSoundFx]);
  useDisposeOnUnmount(fxMats, () => {
    fxMats?.glow.dispose();
    fxMats?.ring.dispose();
  });
  const slotGlowGeo = useMemo(
    () =>
      showSoundFx
        ? partsGeo(`sounder-glow:${series}`, (b) => {
            if (series === '855T') {
              for (let i = 0; i < 24; i++) {
                const a = (i / 24) * Math.PI * 2;
                b.add(boxGeo(0.0055, 0.03, 0.0004), F.hole, [Math.sin(a) * (d.R - 0.0001), d.ringH + 0.027, Math.cos(a) * (d.R - 0.0001)], [0, a, 0]);
              }
            } else
              for (let i = 0; i < 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                b.add(boxGeo(0.0014, 0.0003, 0.008), F.hole, [Math.sin(a) * 0.0195, d.soundH + 0.0003, Math.cos(a) * 0.0195], [0, a, 0]);
              }
          })
        : null,
    [showSoundFx, series, d],
  );
  useFrame(({ clock }) => {
    const on = getHorn();
    const t = clock.elapsedTime;
    const b = body.current;
    if (b) {
      // barely perceptible buzz (±0.15 mm)
      b.position.x = on ? Math.sin(t * 190) * 0.00015 : 0;
      b.position.z = on ? Math.cos(t * 170) * 0.00012 : 0;
    }
    if (fxMats && fx.current) {
      fx.current.visible = on;
      if (on) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 18);
        fxMats.glow.opacity = 0.35 + 0.45 * pulse;
        const ph = (t * 1.2) % 1;
        const r = ring.current;
        if (r) r.scale.setScalar(1 + ph * 0.3);
        fxMats.ring.opacity = 0.05 * Math.sin(Math.PI * ph);
      }
    }
  });
  const ringY = series === '855T' ? d.ringH + (d.moduleH - d.ringH) / 2 : d.soundH + 0.004;
  return (
    <group>
      <group ref={body}>
        <mesh geometry={geo} material={uberMat()} castShadow receiveShadow />
      </group>
      {fxMats && slotGlowGeo && (
        <group ref={fx} visible={false}>
          <mesh geometry={slotGlowGeo} material={fxMats.glow} />
          <mesh ref={ring} geometry={sharedGeo('856t-fx-ring', () => new THREE.PlaneGeometry(2.1 * S856.R, 2.1 * S856.R).rotateX(-Math.PI / 2))} material={fxMats.ring} position={[0, ringY, 0]} />
        </group>
      )}
    </group>
  );
}

export function StackLight856T({
  tiers,
  getTier,
  getHorn,
  getFlashing,
  mount = 'pole',
  series = '856T',
  housing = 'black',
  poleLength = 0.1,
  showSoundFx = false,
  position,
  rotation,
  scale,
}: StackLight856TProps) {
  const d = dims(series);
  const hasHorn = !!getHorn;
  const n = tiers.length;
  const stackBase = mount === 'pole' ? S856.footH + poleLength - 0.004 + d.adapterH : d.baseH;
  // one merged mesh: foot + pole + adapter (or surface base) + coupling rings + cap
  const housingGeo = partsGeo(`stack:${series}:${housing}:${mount}:${poleLength}:${n}:${hasHorn}`, (b) => {
    const hf = F.matte(HOUSING_HEX[housing], 0.5);
    if (mount === 'pole') {
      b.add(footGeo(), hf);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
        addScrew(b, [Math.sin(a) * 0.037, 0.004, Math.cos(a) * 0.037], 0.0028, 0.0014, [-Math.PI / 2, 0, 0]);
      }
      b.add(cylY(0.0125, 0.0125, poleLength, 32), F.metal('#d3d7db', 0.45), [0, S856.footH + poleLength / 2, 0]);
      b.add(adapterGeo(series), hf, [0, S856.footH + poleLength - 0.004, 0]);
    } else {
      b.add(surfaceBaseGeo(series), hf);
    }
    for (let i = 0; i < n; i++) b.add(ringGeo(series), hf, [0, stackBase + i * d.moduleH, 0]);
    const top = stackBase + n * d.moduleH;
    if (series === '855T') {
      b.add(capGeo(series), hf, [0, top + (hasHorn ? d.soundH : 0), 0]);
    } else if (!hasHorn) {
      b.add(capGeo(series), hf, [0, top, 0]);
    }
  });
  const top = stackBase + n * d.moduleH;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={housingGeo} material={uberMat()} castShadow receiveShadow />
      {tiers.map((c, i) => (
        // modules bottom -> top (tiers are listed top -> bottom)
        <group key={i} position={[0, stackBase + (n - 1 - i) * d.moduleH, 0]}>
          <LightModule color={c} index={i} series={series} getTier={getTier} getFlashing={getFlashing} />
        </group>
      ))}
      {getHorn && (
        <group position={[0, top, 0]}>
          <Sounder series={series} housing={housing} getHorn={getHorn} showSoundFx={showSoundFx} />
        </group>
      )}
    </group>
  );
}

/** Total height of a stack light column (for placement). */
export function stackLightHeight(
  tierCount: number,
  opts: { horn?: boolean; mount?: 'pole' | 'base'; poleLength?: number; series?: StackLightSeries } = {},
): number {
  const series = opts.series ?? '856T';
  const d = dims(series);
  const base = opts.mount === 'base' ? d.baseH : S856.footH + (opts.poleLength ?? 0.1) - 0.004 + d.adapterH;
  const top = series === '855T' ? (opts.horn ? d.soundH : 0) + d.capH : opts.horn ? d.soundH : d.capH;
  return base + tierCount * d.moduleH + top;
}
