/**
 * 3-section 12-inch (300 mm) LED vehicle traffic signal head (ITE VTCSH style, polycarbonate):
 * 14.5" × 14" sections ≈ 1.07 m tall, hinged doors with wing-nut latches, 10" tunnel visors with an
 * angled cut, LED modules with visible LED array behind a Fresnel cover, aluminum backplate with a
 * 2" fluorescent-yellow retroreflective border (FHWA proven safety countermeasure), rigid hanger.
 *
 * Origin: the mounting point at the TOP of the hanger pipe (the head hangs below, −Y); lenses face +Z.
 * With `hanger={0}` the origin is the top-center of the housing.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedMode } from '../../common';
import type { Placement } from '../../contracts';
import { lensBaseTexture, lensEmissiveTexture } from './ledTextures';
import {
  INCH,
  SIGNAL_LIT,
  SIGNAL_UNLIT,
  TRAFFIC_COLORS,
  cylX,
  cylY,
  cylZ,
  latheZ,
  ledOn,
  mergeAll,
  roundedBox,
  roundedRectHole,
  roundedRectShape,
  sharedGeo,
  tmats,
  useDisposable,
  xf,
} from './shared';

export interface TrafficSignalHeadProps extends Placement {
  getRed: () => LedMode;
  getYellow: () => LedMode;
  getGreen: () => LedMode;
  /** Vertical (default) or horizontal (red left, green right). */
  orientation?: 'vertical' | 'horizontal';
  /** Housing color (default black polycarbonate). */
  housingColor?: string;
  /** Aluminum backplate (default true). */
  backplate?: boolean;
  /** Yellow retroreflective backplate border (default true). */
  retroBorder?: boolean;
  /** Visor style: tunnel (default), cap (open at the bottom half) or none. */
  visor?: 'tunnel' | 'cap' | 'none';
  /** Hanger pipe length above the housing (m); 0 = origin at the housing top. */
  hanger?: number;
  /** Emissive strength of lit lenses (bloom threshold ≈ 1). */
  intensity?: number;
}

/** Real-world dimensions (m). */
export const SIGNAL_HEAD_DIMS = {
  sectionWidth: 14.5 * INCH,
  sectionHeight: 14 * INCH,
  housingDepth: 8.5 * INCH,
  doorThickness: 0.022,
  lensRadius: 0.15,
  visorRadius: 0.166,
  visorLength: 10 * INCH,
  backplateBorder: 5 * INCH,
  retroWidth: 2 * INCH,
  defaultHanger: 0.13,
} as const;

const D = SIGNAL_HEAD_DIMS;

type Orientation = 'vertical' | 'horizontal';
type VisorKind = 'tunnel' | 'cap' | 'none';

/** Section centers in head-local coordinates (origin at housing top-center). */
function sectionCenters(o: Orientation): [number, number][] {
  return [0, 1, 2].map((i) => (o === 'vertical' ? [0, -D.sectionHeight * (i + 0.5)] : [(i - 1) * D.sectionWidth, -D.sectionHeight / 2]));
}

function headSize(o: Orientation): [number, number] {
  return o === 'vertical' ? [D.sectionWidth, D.sectionHeight * 3] : [D.sectionWidth * 3, D.sectionHeight];
}

/** Partial tube (visor): annulus sector extruded along +Z, front edge cut at an angle. */
export function visorGeometry(r: number, len: number, kind: 'tunnel' | 'cap', thickness = 0.003): THREE.BufferGeometry {
  return sharedGeo(`sig:visor:${r}:${len}:${kind}:${thickness}`, () => {
    const gap = kind === 'tunnel' ? THREE.MathUtils.degToRad(64) : Math.PI * 0.9;
    const a0 = -Math.PI / 2 + gap / 2;
    const a1 = -Math.PI / 2 - gap / 2 + Math.PI * 2;
    const s = new THREE.Shape();
    s.absarc(0, 0, r, a0, a1, false);
    s.absarc(0, 0, r - thickness, a1, a0, true);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 40 });
    const pos = g.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const yn = THREE.MathUtils.clamp(pos.getY(i) / r, -1, 1);
      const f = 0.42 + 0.58 * ((yn + 1) / 2); // full length on top, short at the bottom
      pos.setZ(i, pos.getZ(i) * f);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** Slightly domed lens (planar UVs over the lens diameter). */
export function lensGeometry(r: number): THREE.BufferGeometry {
  const dome = r * 0.08;
  return latheZ(
    `sig:lens:${r}`,
    [
      [r, 0],
      [r * 0.93, dome * 0.25],
      [r * 0.75, dome * 0.62],
      [r * 0.45, dome * 0.9],
      [0, dome],
    ],
    48,
    r,
  );
}

/** Door frame: rounded rectangle with a circular lens opening. */
function doorGeometry(w: number, h: number, holeR: number, t: number): THREE.BufferGeometry {
  return sharedGeo(`sig:door:${w}:${h}:${holeR}:${t}`, () => {
    const s = roundedRectShape(w, h, 0.02);
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth: t - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 40 });
  });
}

interface HeadGeoms {
  housing: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  backplate: THREE.BufferGeometry | null;
  retro: THREE.BufferGeometry | null;
}

function buildHeadGeoms(o: Orientation, visor: VisorKind, backplate: boolean, retro: boolean, hanger: number): HeadGeoms {
  const key = `sig:head:${o}:${visor}:${backplate}:${retro}:${hanger}`;
  const cached = headCache.get(key);
  if (cached) return cached;

  const centers = sectionCenters(o);
  const zFront = D.housingDepth / 2;
  const housing: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const body = roundedBox(D.sectionWidth - 0.004, D.sectionHeight - 0.004, D.housingDepth, 0.02, 3);
  const door = doorGeometry(D.sectionWidth - 0.016, D.sectionHeight - 0.016, D.lensRadius + 0.004, D.doorThickness);
  const hinge = cylY(0.0065, 0.0065, 0.045, 10);
  const screw = cylZ(0.0055, 0.0055, 0.006, 6);
  for (const [cx, cy] of centers) {
    housing.push(xf(body, [cx, cy, 0]));
    // rear ribs (molded stiffeners)
    for (const dx of [-0.09, 0.09]) housing.push(xf(roundedBox(0.012, D.sectionHeight - 0.05, 0.02, 0.004, 1), [cx + dx, cy, -zFront - 0.006]));
    housing.push(xf(door, [cx, cy, zFront + 0.003]));
    if (visor !== 'none') {
      housing.push(xf(visorGeometry(D.visorRadius, D.visorLength, visor), [cx, cy, zFront + D.doorThickness - 0.002]));
      // visor mounting ring
      housing.push(
        xf(
          sharedGeo(`sig:visorRing:${D.visorRadius}`, () => {
            const s = new THREE.Shape();
            s.absarc(0, 0, D.visorRadius + 0.012, 0, Math.PI * 2, false);
            const h = new THREE.Path();
            h.absarc(0, 0, D.lensRadius + 0.002, 0, Math.PI * 2, true);
            s.holes.push(h);
            return new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false, curveSegments: 40 });
          }),
          [cx, cy, zFront + D.doorThickness - 0.004],
        ),
      );
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        metal.push(xf(screw, [cx + Math.cos(a) * (D.visorRadius + 0.006), cy + Math.sin(a) * (D.visorRadius + 0.006), zFront + D.doorThickness + 0.004]));
      }
    }
    // hinges (left) and wing-nut latch (right)
    const hx = cx - D.sectionWidth / 2 + 0.004;
    for (const dy of [-0.11, 0.11]) metal.push(xf(hinge, [hx, cy + dy, zFront + 0.012]));
    const lx = cx + D.sectionWidth / 2 - 0.002;
    metal.push(xf(cylX(0.009, 0.009, 0.014, 12), [lx, cy, zFront + 0.01]));
    metal.push(xf(roundedBox(0.006, 0.034, 0.012, 0.002, 1), [lx + 0.009, cy, zFront + 0.01]));
  }

  // hanger: tri-stud top fitting + 1.5" pipe to the mounting point, bottom plug
  const [w, h] = headSize(o);
  const topY = 0;
  metal.push(xf(cylY(0.05, 0.055, 0.026, 24), [0, topY + 0.013, 0]));
  metal.push(xf(cylY(0.03, 0.03, 0.012, 6), [0, topY + 0.032, 0]));
  if (hanger > 0) {
    metal.push(xf(cylY(0.024, 0.024, hanger, 16), [0, topY + hanger / 2, 0]));
    metal.push(xf(cylY(0.034, 0.034, 0.04, 6), [0, topY + hanger - 0.03, 0])); // lock nut
  }
  metal.push(xf(cylY(0.045, 0.05, 0.02, 24), [0, -h - 0.01, 0]));

  let bp: THREE.BufferGeometry | null = null;
  let rt: THREE.BufferGeometry | null = null;
  if (backplate) {
    const bw = w + 2 * D.backplateBorder;
    const bh = h + 2 * D.backplateBorder;
    const cy = -h / 2;
    const z = zFront - 0.035;
    const plate = new THREE.ExtrudeGeometry(roundedRectShape(bw, bh, 0.035), { depth: 0.004, bevelEnabled: false, curveSegments: 6 });
    const parts = [xf(plate, [0, cy, z])];
    // formed stiffening flange around the edge (backplates are bent sheet)
    const flange = roundedRectShape(bw, bh, 0.035);
    flange.holes.push(roundedRectHole(bw - 0.016, bh - 0.016, 0.03));
    parts.push(xf(new THREE.ExtrudeGeometry(flange, { depth: 0.02, bevelEnabled: false, curveSegments: 6 }), [0, cy, z - 0.02]));
    // backplate screws
    const sx = w / 2 + D.backplateBorder * 0.25;
    for (const [x, y] of [
      [-sx, cy + h / 2 - 0.05],
      [sx, cy + h / 2 - 0.05],
      [-sx, cy - h / 2 + 0.05],
      [sx, cy - h / 2 + 0.05],
    ] as const)
      metal.push(xf(cylZ(0.006, 0.006, 0.006, 6), [x, y, z + 0.008]));
    bp = mergeAll(parts);
    if (retro) {
      const ring = roundedRectShape(bw - 0.004, bh - 0.004, 0.033);
      ring.holes.push(roundedRectHole(bw - 2 * D.retroWidth, bh - 2 * D.retroWidth, 0.02));
      rt = xf(new THREE.ExtrudeGeometry(ring, { depth: 0.0012, bevelEnabled: false, curveSegments: 6 }), [0, cy, z + 0.004]);
    }
  }
  const res: HeadGeoms = { housing: mergeAll(housing), metal: mergeAll(metal), backplate: bp, retro: rt };
  headCache.set(key, res);
  return res;
}
const headCache = new Map<string, HeadGeoms>();

type LampColor = 'red' | 'yellow' | 'green';

/** Per-instance LED lens material (unlit tint + dot-grid emission). */
export function makeLensMaterial(color: LampColor | 'orange' | 'white'): THREE.MeshStandardMaterial {
  const unlit = color === 'red' || color === 'yellow' || color === 'green' ? SIGNAL_UNLIT[color] : '#2a2a2a';
  return new THREE.MeshStandardMaterial({
    color: unlit,
    map: lensBaseTexture(),
    emissive: SIGNAL_LIT[color],
    emissiveMap: lensEmissiveTexture(),
    emissiveIntensity: 0,
    roughness: 0.16,
    metalness: 0,
    toneMapped: false,
  });
}

/** Animate a lens material toward lit/unlit (LEDs switch fast: ~40 ms). */
export function driveLens(m: THREE.MeshStandardMaterial, lit: boolean, unlit: THREE.Color, litTint: THREE.Color, intensity: number, dt: number): void {
  const target = lit ? intensity : 0;
  const k = 1 - Math.exp(-dt * 60);
  m.emissiveIntensity += (target - m.emissiveIntensity) * k;
  const f = m.emissiveIntensity / Math.max(intensity, 1e-3);
  m.color.copy(unlit).lerp(litTint, f * 0.6);
}

export function TrafficSignalHead({
  getRed,
  getYellow,
  getGreen,
  orientation = 'vertical',
  housingColor = TRAFFIC_COLORS.signalBlack,
  backplate = true,
  retroBorder = true,
  visor = 'tunnel',
  hanger = D.defaultHanger,
  intensity = 4,
  position,
  rotation,
  scale,
}: TrafficSignalHeadProps) {
  const geoms = useMemo(() => buildHeadGeoms(orientation, visor, backplate, retroBorder, hanger), [orientation, visor, backplate, retroBorder, hanger]);
  const centers = useMemo(() => sectionCenters(orientation), [orientation]);
  const lensMats = useMemo(() => (['red', 'yellow', 'green'] as const).map((c) => makeLensMaterial(c)), []);
  useDisposable(lensMats);
  const tints = useMemo(
    () =>
      (['red', 'yellow', 'green'] as const).map((c) => ({
        unlit: new THREE.Color(SIGNAL_UNLIT[c]),
        lit: new THREE.Color(SIGNAL_LIT[c]),
      })),
    [],
  );
  const getters = useRef([getRed, getYellow, getGreen]);
  getters.current = [getRed, getYellow, getGreen];

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < 3; i++) {
      const lit = ledOn(getters.current[i]!(), t);
      driveLens(lensMats[i]!, lit, tints[i]!.unlit, tints[i]!.lit, intensity, Math.min(dt, 0.1));
    }
  });

  const lensGeo = lensGeometry(D.lensRadius);
  const lensZ = D.housingDepth / 2 + D.doorThickness - 0.012;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position={[0, -hanger, 0]}>
        <mesh geometry={geoms.housing} material={tmats.housing(housingColor)} castShadow receiveShadow />
        <mesh geometry={geoms.metal} material={tmats.metal('#8d9195', 0.45)} castShadow />
        {geoms.backplate && <mesh geometry={geoms.backplate} material={tmats.plastic('#121314', 0.7)} castShadow receiveShadow />}
        {geoms.retro && <mesh geometry={geoms.retro} material={tmats.retro()} />}
        {centers.map(([cx, cy], i) => (
          <mesh key={i} geometry={lensGeo} material={lensMats[i]} position={[cx, cy, lensZ]} />
        ))}
      </group>
    </group>
  );
}

/** Total height of a head below its origin (m), for placing heads under a mast arm. */
export function signalHeadDrop(orientation: Orientation = 'vertical', hanger: number = D.defaultHanger): number {
  return hanger + headSize(orientation)[1];
}
