/**
 * 3-section 12-inch (300 mm) LED vehicle traffic signal head (ITE VTCSH style, polycarbonate):
 * 14.5" × 14" sections ≈ 1.07 m tall, hinged doors with wing-nut latches, 10" tunnel visors with an
 * angled cut, LED modules with visible LED array behind a Fresnel cover, aluminum backplate with a
 * rolled edge and a 2" fluorescent-yellow retroreflective border (FHWA proven safety countermeasure),
 * rigid hanger.
 *
 * Draw calls: 2 per head — every static part (housing, doors, visors, backplate, retro border,
 * hardware) is one merged mesh with per-vertex finishes, and the three lenses are one mesh whose lamp
 * levels are shader uniforms.
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
  FINISH,
  INCH,
  SIGNAL_LIT,
  SIGNAL_UNLIT,
  TRAFFIC_COLORS,
  cylX,
  cylY,
  cylZ,
  latheZ,
  ledOn,
  mergeVc,
  roundedBox,
  roundedRectHole,
  roundedRectShape,
  sharedGeo,
  useDisposable,
  vc,
  vcMaterial,
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

/** Rolled (hemmed) edge along a closed outline: a thin tube following the path. */
function rolledEdge(shape: THREE.Shape, r: number): THREE.BufferGeometry {
  const pts = shape.getSpacedPoints(160).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.2);
  return new THREE.TubeGeometry(curve, 240, r, 6, true);
}

const headCache = new Map<string, { stat: THREE.BufferGeometry; lenses: THREE.BufferGeometry }>();

/** Static merged geometry (per-vertex finishes) + merged lens geometry for one head configuration. */
function buildHead(o: Orientation, visor: VisorKind, backplate: boolean, retro: boolean, hanger: number, housingColor: string) {
  const key = `${o}:${visor}:${backplate}:${retro}:${hanger}:${housingColor}`;
  const hit = headCache.get(key);
  if (hit) return hit;

  const housingF = { color: housingColor, roughness: 0.42, metalness: 0.05 };
  const hwF = FINISH.hardware;
  const plateF = { color: '#121314', roughness: 0.7, metalness: 0.1 };
  const retroF = { color: TRAFFIC_COLORS.retroYellow, roughness: 0.3, metalness: 0.05 };

  const centers = sectionCenters(o);
  const zFront = D.housingDepth / 2;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, f: { color: string; roughness?: number; metalness?: number }, pos?: [number, number, number], rot?: [number, number, number]) =>
    parts.push(vc(xf(g, pos, rot), f));

  const body = roundedBox(D.sectionWidth - 0.004, D.sectionHeight - 0.004, D.housingDepth, 0.02, 3);
  const door = doorGeometry(D.sectionWidth - 0.016, D.sectionHeight - 0.016, D.lensRadius + 0.004, D.doorThickness);
  const hinge = cylY(0.0065, 0.0065, 0.045, 10);
  const screw = cylZ(0.0055, 0.0055, 0.006, 6);
  const ring = sharedGeo(`sig:visorRing:${D.visorRadius}`, () => {
    const s = new THREE.Shape();
    s.absarc(0, 0, D.visorRadius + 0.012, 0, Math.PI * 2, false);
    const h = new THREE.Path();
    h.absarc(0, 0, D.lensRadius + 0.002, 0, Math.PI * 2, true);
    s.holes.push(h);
    return new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false, curveSegments: 40 });
  });
  for (const [cx, cy] of centers) {
    add(body, housingF, [cx, cy, 0]);
    // rear ribs (molded stiffeners)
    for (const dx of [-0.09, 0.09]) add(roundedBox(0.012, D.sectionHeight - 0.05, 0.02, 0.004, 1), housingF, [cx + dx, cy, -zFront - 0.006]);
    add(door, housingF, [cx, cy, zFront + 0.003]);
    if (visor !== 'none') {
      add(visorGeometry(D.visorRadius, D.visorLength, visor), housingF, [cx, cy, zFront + D.doorThickness - 0.002]);
      add(ring, housingF, [cx, cy, zFront + D.doorThickness - 0.004]);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        add(screw, hwF, [cx + Math.cos(a) * (D.visorRadius + 0.006), cy + Math.sin(a) * (D.visorRadius + 0.006), zFront + D.doorThickness + 0.004]);
      }
    }
    // hinges (left) and wing-nut latch (right)
    const hx = cx - D.sectionWidth / 2 + 0.004;
    for (const dy of [-0.11, 0.11]) add(hinge, hwF, [hx, cy + dy, zFront + 0.012]);
    const lx = cx + D.sectionWidth / 2 - 0.002;
    add(cylX(0.009, 0.009, 0.014, 12), hwF, [lx, cy, zFront + 0.01]);
    add(roundedBox(0.006, 0.034, 0.012, 0.002, 1), hwF, [lx + 0.009, cy, zFront + 0.01]);
  }

  // hanger: tri-stud top fitting + 1.5" pipe to the mounting point, bottom plug
  const [w, h] = headSize(o);
  add(cylY(0.05, 0.055, 0.026, 24), hwF, [0, 0.013, 0]);
  add(cylY(0.03, 0.03, 0.012, 6), hwF, [0, 0.032, 0]);
  if (hanger > 0) {
    add(cylY(0.024, 0.024, hanger, 16), hwF, [0, hanger / 2, 0]);
    add(cylY(0.034, 0.034, 0.04, 6), hwF, [0, hanger - 0.03, 0]); // lock nut
  }
  add(cylY(0.045, 0.05, 0.02, 24), hwF, [0, -h - 0.01, 0]);

  if (backplate) {
    const bw = w + 2 * D.backplateBorder;
    const bh = h + 2 * D.backplateBorder;
    const cy = -h / 2;
    const z = zFront - 0.035;
    const t = 0.004;
    const outline = roundedRectShape(bw, bh, 0.035);
    // The plate is two solids that share an edge: the border ring and the inner panel. The ring's
    // FRONT cap carries the yellow sheeting, so the border is flush with the plate (no z-fighting,
    // invisible from behind).
    const inner = roundedRectShape(bw - 2 * D.retroWidth, bh - 2 * D.retroWidth, 0.02);
    const ringShape = roundedRectShape(bw, bh, 0.035);
    ringShape.holes.push(roundedRectHole(bw - 2 * D.retroWidth, bh - 2 * D.retroWidth, 0.02));
    add(new THREE.ExtrudeGeometry(inner, { depth: t, bevelEnabled: false, curveSegments: 6 }), plateF, [0, cy, z]);
    const ringG = new THREE.ExtrudeGeometry(ringShape, { depth: t, bevelEnabled: false, curveSegments: 6 });
    const ringTagged = vc(xf(ringG, [0, cy, z]), plateF);
    if (retro) {
      // recolor the front cap (normal +Z) yellow
      const nor = ringTagged.attributes.normal!;
      const col = ringTagged.attributes.color!;
      const rm = ringTagged.attributes.aRM!;
      const cY = new THREE.Color(retroF.color);
      for (let i = 0; i < nor.count; i++) {
        if (nor.getZ(i) > 0.9) {
          col.setXYZ(i, cY.r, cY.g, cY.b);
          rm.setXY(i, retroF.roughness, retroF.metalness);
        }
      }
    }
    parts.push(ringTagged);
    // rolled edge (hem) so the silhouette isn't a razor line
    add(rolledEdge(outline, 0.004), plateF, [0, cy, z + t / 2]);
    // formed stiffening flange behind the edge (backplates are bent sheet)
    const flange = roundedRectShape(bw - 0.004, bh - 0.004, 0.034);
    flange.holes.push(roundedRectHole(bw - 0.02, bh - 0.02, 0.03));
    add(new THREE.ExtrudeGeometry(flange, { depth: 0.018, bevelEnabled: false, curveSegments: 6 }), plateF, [0, cy, z - 0.018]);
    // backplate screws
    const sx = w / 2 + D.backplateBorder * 0.25;
    for (const [x, y] of [
      [-sx, cy + h / 2 - 0.05],
      [sx, cy + h / 2 - 0.05],
      [-sx, cy - h / 2 + 0.05],
      [sx, cy - h / 2 + 0.05],
    ] as const)
      add(cylZ(0.006, 0.006, 0.006, 6), hwF, [x, y, z + t + 0.002]);
  }

  // lenses: three domed lenses in one geometry, attribute aLamp = 0 red, 1 yellow, 2 green
  const lensZ = zFront + D.doorThickness - 0.012;
  const lensParts = centers.map(([cx, cy], i) => {
    const g = xf(lensGeometry(D.lensRadius), [cx, cy, lensZ]);
    const n = g.index ? g.toNonIndexed() : g;
    n.setAttribute('aLamp', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position!.count).fill(i), 1));
    return n;
  });
  const lenses = mergeLenses(lensParts);
  const res = { stat: mergeVc(parts), lenses };
  headCache.set(key, res);
  return res;
}

function mergeLenses(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.attributes.position!.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const lamp = new Float32Array(count);
  let o = 0;
  for (const p of parts) {
    const n = p.attributes.position!.count;
    pos.set(p.attributes.position!.array as Float32Array, o * 3);
    nor.set(p.attributes.normal!.array as Float32Array, o * 3);
    uv.set(p.attributes.uv!.array as Float32Array, o * 2);
    lamp.set(p.attributes.aLamp!.array as Float32Array, o);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 1));
  return g;
}

type LampColor = 'red' | 'yellow' | 'green';

/**
 * Material for a merged 3-lens geometry (attribute aLamp 0/1/2): `uniforms.uLevel.value` (Vector3)
 * holds each lamp's emissive level; unlit tint → lit tint is blended in the shader. Per head.
 */
export function makeSignalLensMaterial(colors: [LampColor, LampColor, LampColor] = ['red', 'yellow', 'green'], intensity = 4): THREE.MeshStandardMaterial & { userData: { uLevel: { value: THREE.Vector3 } } } {
  const uLevel = { value: new THREE.Vector3() };
  const uUnlit = { value: colors.map((c) => new THREE.Color(SIGNAL_UNLIT[c])) };
  const uLit = { value: colors.map((c) => new THREE.Color(SIGNAL_LIT[c])) };
  const uMax = { value: intensity };
  const m = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: lensBaseTexture(),
    emissive: '#ffffff',
    emissiveMap: lensEmissiveTexture(),
    roughness: 0.16,
    metalness: 0,
    toneMapped: false,
  });
  m.onBeforeCompile = (s) => {
    s.uniforms.uLevel = uLevel;
    s.uniforms.uUnlit = uUnlit;
    s.uniforms.uLit = uLit;
    s.uniforms.uMax = uMax;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLamp;\nvarying float vLamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvLamp = aLamp;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLamp;\nuniform vec3 uLevel;\nuniform vec3 uUnlit[3];\nuniform vec3 uLit[3];\nuniform float uMax;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
	int lampI = vLamp < 0.5 ? 0 : (vLamp < 1.5 ? 1 : 2);
	float lampLv = lampI == 0 ? uLevel.x : (lampI == 1 ? uLevel.y : uLevel.z);
	vec3 lampLit = lampI == 0 ? uLit[0] : (lampI == 1 ? uLit[1] : uLit[2]);
	vec3 lampUnlit = lampI == 0 ? uUnlit[0] : (lampI == 1 ? uUnlit[1] : uUnlit[2]);
	diffuseColor.rgb *= mix(lampUnlit, lampLit, clamp(lampLv / uMax, 0.0, 1.0) * 0.6);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= lampLit * lampLv;');
  };
  m.customProgramCacheKey = () => 'tr-siglens';
  m.userData.uLevel = uLevel;
  return m as THREE.MeshStandardMaterial & { userData: { uLevel: { value: THREE.Vector3 } } };
}

/** Per-instance LED lens material (unlit tint + dot-grid emission) for a single lens. */
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

/** Animate a single-lens material toward lit/unlit (LEDs switch fast: ~40 ms). */
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
  const geoms = useMemo(() => buildHead(orientation, visor, backplate, retroBorder, hanger, housingColor), [orientation, visor, backplate, retroBorder, hanger, housingColor]);
  const lensMat = useMemo(() => makeSignalLensMaterial(['red', 'yellow', 'green'], intensity), [intensity]);
  useDisposable(useMemo(() => [lensMat], [lensMat]));
  const getters = useRef([getRed, getYellow, getGreen]);
  getters.current = [getRed, getYellow, getGreen];

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 60);
    const lv = lensMat.userData.uLevel.value;
    for (let i = 0; i < 3; i++) {
      const target = ledOn(getters.current[i]!(), t) ? intensity : 0;
      const cur = lv.getComponent(i);
      lv.setComponent(i, cur + (target - cur) * k);
    }
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position={[0, -hanger, 0]}>
        <mesh geometry={geoms.stat} material={vcMaterial()} castShadow receiveShadow />
        <mesh geometry={geoms.lenses} material={lensMat} />
      </group>
    </group>
  );
}

/** Total height of a head below its origin (m), for placing heads under a mast arm. */
export function signalHeadDrop(orientation: Orientation = 'vertical', hanger: number = D.defaultHanger): number {
  return hanger + headSize(orientation)[1];
}

/** Height of the backplate's bottom edge below the head origin (m) — the MUTCD clearance point. */
export function signalHeadClearanceDrop(orientation: Orientation = 'vertical', hanger: number = D.defaultHanger, backplate = true): number {
  return hanger + headSize(orientation)[1] + (backplate ? D.backplateBorder : 0);
}
