/**
 * Hot-dip galvanized traffic signal mast-arm pole (anchor-base type): tapered round shaft
 * (≈13" base, 0.14 in/ft taper), square base plate on a concrete foundation with 4 anchor bolts &
 * double nuts, handhole with cover, pole cap, ID tag; tapered mast arms bolted to a welded
 * arm-connection box (flange plate + gussets) with a gentle rise, rigid-mount clamps for signal heads,
 * optional street-name sign and LED "cobra head" luminaire on a davit arm.
 *
 * Origin: ground level at the pole axis. Arms extend along local +X rotated by `angle` about +Y
 * (world arm direction = (cos a, 0, −sin a)); attachments under an arm face the arm's +Z side
 * (world (sin a, 0, cos a)) or −Z with `flip`. Pole attachments face +Z rotated by their `angle`.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import {
  FT,
  boxGeo,
  canvasTex,
  cylY,
  cylZ,
  makeCanvas,
  mergeAll,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedMat,
  sharedTex,
  tmats,
  xf,
} from './shared';

export interface MastArmAttachment {
  /** Distance from the pole axis along the arm (m). */
  at: number;
  /** Mounted object: its origin is placed at the clamp under the arm (e.g. a TrafficSignalHead). */
  node: ReactNode;
  /** Turn the node 180° so it faces the arm's −Z side (e.g. far-side heads facing approaching traffic). */
  flip?: boolean;
  key?: string | number;
}

export interface MastArmSpec {
  /** Arm length from the pole axis (m). */
  length: number;
  /** Heading about +Y (rad); 0 = arm along +X. */
  angle?: number;
  /** Height of the arm connection above ground (m). Default 5.6 m. */
  height?: number;
  /** Tip rise above a straight arm (m). Default 3.5 % of the length. */
  rise?: number;
  /** Arm base (pole end) diameter (m). Default 0.25. */
  baseDiameter?: number;
  attachments?: MastArmAttachment[];
  /** Street-name sign on the arm (both faces). */
  streetSign?: { at: number; text: string; width?: number };
}

export interface PoleAttachment {
  /** Height above ground (m). */
  height: number;
  /** Facing angle about +Y (rad); 0 = faces +Z. */
  angle?: number;
  /** Mounted object; its origin is placed on the pole surface. */
  node: ReactNode;
  /** Draw stainless band clamps (default true). */
  bands?: boolean;
  /** Vertical extent covered by the bands (m). */
  bandSpan?: number;
  key?: string | number;
}

export interface SignalPoleProps extends Placement {
  /** Shaft height (m). Default 7.6 m (25 ft). */
  height?: number;
  baseDiameter?: number;
  /** Taper in m per m (default 0.14 in/ft). */
  taper?: number;
  /** 'galvanized' (default) or a paint color. */
  finish?: 'galvanized' | string;
  arms?: MastArmSpec[];
  attachments?: PoleAttachment[];
  /** LED roadway luminaire on a davit arm at the top. */
  luminaire?: { angle?: number; length?: number; getLit?: () => boolean } | false;
  /** Concrete foundation collar (default true). */
  foundation?: boolean;
  /** Pole ID shown on the aluminum tag. */
  poleId?: string;
}

const TAPER = (0.14 * 0.0254) / FT; // m per m

export const SIGNAL_POLE_DEFAULTS = {
  height: 7.6,
  baseDiameter: 0.33,
  armHeight: 5.6,
  armBaseDiameter: 0.25,
} as const;

/** Radius of a tapered shaft at height y. */
function radiusAt(baseD: number, taper: number, y: number): number {
  return Math.max(0.04, baseD / 2 - (taper * y) / 2);
}

/** Tapered, gently rising mast arm along +X from x=0 (pole axis) with a tip cap. */
function armGeometry(len: number, baseD: number, rise: number, taper: number): THREE.BufferGeometry {
  return sharedGeo(`pole:arm:${len}:${baseD}:${rise}:${taper}`, () => {
    const tipD = Math.max(0.09, baseD - taper * len);
    const g = new THREE.CylinderGeometry(tipD / 2, baseD / 2, len, 28, 16, false);
    g.rotateZ(-Math.PI / 2); // +Y -> +X (top = tip at +X)
    g.translate(len / 2, 0, 0);
    const pos = g.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const f = x / len;
      pos.setY(i, pos.getY(i) + rise * f * f);
    }
    g.computeVertexNormals();
    return g;
  });
}

/** Arm centerline height at distance x (relative to the connection height). */
export function mastArmY(x: number, length: number, rise: number): number {
  const f = x / length;
  return rise * f * f;
}

function armRadiusAt(x: number, baseD: number, taper: number, len: number): number {
  const tipD = Math.max(0.09, baseD - taper * len);
  return (baseD + (tipD - baseD) * (x / len)) / 2;
}

function streetSignTexture(text: string): THREE.CanvasTexture {
  return sharedTex(`pole:street:${text}`, () => {
    const W = 1024;
    const H = 256;
    const [c, ctx] = makeCanvas(W, H);
    ctx.fillStyle = '#006a4e';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#f2f2ec';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(14, 14, W - 28, H - 28, 26);
    ctx.stroke();
    ctx.fillStyle = '#f2f2ec';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let px = 150;
    ctx.font = `bold ${px}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    while (ctx.measureText(text).width > W - 90 && px > 40) {
      px -= 6;
      ctx.font = `bold ${px}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    }
    ctx.fillText(text, W / 2, H / 2 + 6);
    return canvasTex(c);
  });
}

function poleTagTexture(id: string): THREE.CanvasTexture {
  return sharedTex(`pole:tag:${id}`, () => {
    const [c, ctx] = makeCanvas(128, 64);
    ctx.fillStyle = '#d9dcdd';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(id, 64, 34);
    return canvasTex(c);
  });
}

// ---------------------------------------------------------------------------
// MastArm
// ---------------------------------------------------------------------------

export interface MastArmProps extends MastArmSpec {
  /** Pole radius at the connection height (the connection box sits on the pole surface). */
  poleRadius?: number;
  finishMaterial?: THREE.Material;
}

/**
 * One mast arm with its pole connection box. Origin: pole axis at the arm connection height; the arm
 * extends along +X (apply `angle` with a parent rotation or use SignalPole's `arms`).
 */
export function MastArm({ length, rise, baseDiameter = SIGNAL_POLE_DEFAULTS.armBaseDiameter, attachments = [], streetSign, poleRadius = 0.15, finishMaterial }: MastArmProps) {
  const r = rise ?? length * 0.035;
  const mat = finishMaterial ?? tmats.galvanized();
  const geo = armGeometry(length, baseDiameter, r, TAPER);
  const box = sharedGeo(`pole:armbox:${poleRadius}:${baseDiameter}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const x0 = poleRadius * 0.85;
    // welded box on the pole + flange plates
    parts.push(xf(boxGeo(0.12, 0.5, 0.36), [x0 + 0.04, 0, 0]));
    parts.push(xf(boxGeo(0.03, 0.56, 0.42), [x0 + 0.115, 0, 0]));
    parts.push(xf(boxGeo(0.028, 0.52, 0.38), [x0 + 0.146, 0, 0]));
    // gussets
    for (const z of [-0.15, 0.15]) {
      const s = new THREE.Shape();
      s.moveTo(0, 0);
      s.lineTo(0.16, 0);
      s.lineTo(0, 0.14);
      s.closePath();
      const gus = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
      parts.push(xf(gus, [x0 + 0.16, 0.08, z - 0.006], [0, 0, 0], [1, 1, 1]));
      parts.push(xf(gus, [x0 + 0.16, -0.08, z + 0.006], [Math.PI, 0, 0], [1, 1, 1]));
    }
    return mergeAll(parts);
  });
  const bolts = sharedGeo(`pole:armbolts:${poleRadius}`, () => {
    const x0 = poleRadius * 0.85 + 0.165;
    const parts: THREE.BufferGeometry[] = [];
    for (const y of [-0.22, 0.22])
      for (const z of [-0.15, 0, 0.15]) {
        const nut = new THREE.CylinderGeometry(0.02, 0.02, 0.022, 6);
        nut.rotateZ(Math.PI / 2);
        parts.push(xf(nut, [x0, y, z]));
      }
    return mergeAll(parts);
  });
  const boxLen = poleRadius * 0.85 + 0.16;
  return (
    <group>
      <mesh geometry={box} material={mat} castShadow receiveShadow />
      <mesh geometry={bolts} material={tmats.metal('#8f9498', 0.4)} castShadow />
      <mesh geometry={geo} material={mat} position={[0, 0, 0]} castShadow receiveShadow />
      {/* end cap */}
      <mesh
        geometry={cylY(armRadiusAt(length, baseDiameter, TAPER, length) + 0.004, armRadiusAt(length, baseDiameter, TAPER, length) + 0.004, 0.02, 24)}
        material={mat}
        position={[length + 0.005, r, 0]}
        rotation={[0, 0, Math.PI / 2]}
      />
      {attachments.map((a, i) => {
        const x = Math.min(Math.max(a.at, boxLen + 0.1), length - 0.05);
        const y = mastArmY(x, length, r) - armRadiusAt(x, baseDiameter, TAPER, length);
        const ar = armRadiusAt(x, baseDiameter, TAPER, length);
        return (
          <group key={a.key ?? i} position={[x, y, 0]}>
            {/* rigid-mount clamp: saddle + band around the arm */}
            <mesh geometry={roundedBox(0.12, 0.05, 0.1, 0.01, 2)} material={tmats.metal('#8d9195', 0.45)} position={[0, 0.0, 0]} castShadow />
            <mesh geometry={bandGeo(ar)} material={tmats.metal('#b4b8bb', 0.3)} position={[0, ar, 0]} rotation={[0, Math.PI / 2, 0]} />
            <mesh geometry={bandGeo(ar)} material={tmats.metal('#b4b8bb', 0.3)} position={[0.04, ar, 0]} rotation={[0, Math.PI / 2, 0]} />
            <group position={[0, -0.025, 0]} rotation={[0, a.flip ? Math.PI : 0, 0]}>
              {a.node}
            </group>
          </group>
        );
      })}
      {streetSign && <StreetSign {...streetSign} y={mastArmY(streetSign.at, length, r)} r={armRadiusAt(streetSign.at, baseDiameter, TAPER, length)} />}
    </group>
  );
}

function bandGeo(r: number): THREE.BufferGeometry {
  return sharedGeo(`pole:band:${r.toFixed(3)}`, () => new THREE.TorusGeometry(r + 0.002, 0.004, 6, 32));
}

function StreetSign({ at, text, width = 1.8, y, r }: { at: number; text: string; width?: number; y: number; r: number }) {
  const h = 0.45;
  const tex = streetSignTexture(text);
  const mat = sharedMat(`pole:streetmat:${text}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.1 }));
  const yc = y + r + 0.04 + h / 2;
  return (
    <group position={[at, yc, 0]}>
      <mesh geometry={roundedBox(width, h, 0.012, 0.03, 2)} material={tmats.metal('#9aa0a4', 0.4)} castShadow />
      <mesh geometry={planeGeo(width - 0.01, h - 0.01)} material={mat} position={[0, 0, 0.009]} />
      <mesh geometry={planeGeo(width - 0.01, h - 0.01)} material={mat} position={[0, 0, -0.009]} rotation={[0, Math.PI, 0]} />
      {/* sign brackets clamped to the arm */}
      {[-width / 3, width / 3].map((dx) => (
        <mesh key={dx} geometry={boxGeo(0.05, 0.1 + r, 0.03)} material={tmats.metal('#8d9195', 0.45)} position={[dx, -h / 2 - (0.05 + r) / 2 + 0.01, 0]} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// SignalPole
// ---------------------------------------------------------------------------

export function SignalPole({
  height = SIGNAL_POLE_DEFAULTS.height,
  baseDiameter = SIGNAL_POLE_DEFAULTS.baseDiameter,
  taper = TAPER,
  finish = 'galvanized',
  arms = [],
  attachments = [],
  luminaire = false,
  foundation = true,
  poleId = 'S-104',
  position,
  rotation,
  scale,
}: SignalPoleProps) {
  const mat = finish === 'galvanized' ? tmats.galvanized() : tmats.paint(finish, 0.45, 0.35);
  const baseY = foundation ? 0.08 : 0;
  const shaft = sharedGeo(`pole:shaft:${height}:${baseDiameter}:${taper}`, () => {
    const g = new THREE.CylinderGeometry(radiusAt(baseDiameter, taper, height), baseDiameter / 2, height, 32, 1, true);
    g.translate(0, height / 2, 0);
    return g;
  });
  const hardware = sharedGeo(`pole:hw:${height}:${baseDiameter}:${taper}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const rTop = radiusAt(baseDiameter, taper, height);
    // base plate + anchor bolts with leveling & top nuts
    parts.push(xf(roundedBox(0.52, 0.045, 0.52, 0.01, 1), [0, 0.0225, 0]));
    // handhole frame (on +Z side)
    const r05 = radiusAt(baseDiameter, taper, 0.55);
    parts.push(xf(roundedBox(0.14, 0.26, 0.03, 0.03, 2), [0, 0.55, r05 - 0.006]));
    // pole cap
    parts.push(xf(new THREE.SphereGeometry(rTop + 0.01, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), [0, height, 0]));
    parts.push(xf(cylY(rTop + 0.012, rTop + 0.012, 0.04, 24), [0, height, 0]));
    // grounding lug
    parts.push(xf(boxGeo(0.03, 0.04, 0.02), [r05 * 0.7, 0.3, -r05 * 0.72]));
    return mergeAll(parts);
  });
  const nuts = sharedGeo('pole:anchors', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, z] of [
      [0.19, 0.19],
      [-0.19, 0.19],
      [0.19, -0.19],
      [-0.19, -0.19],
    ] as const) {
      parts.push(xf(cylY(0.016, 0.016, 0.16, 10), [x, 0.03, z]));
      parts.push(xf(cylY(0.03, 0.03, 0.03, 6), [x, 0.06, z]));
      parts.push(xf(cylY(0.03, 0.03, 0.03, 6), [x, -0.015, z]));
      parts.push(xf(cylY(0.038, 0.038, 0.006, 16), [x, 0.047, z]));
    }
    return mergeAll(parts);
  });
  const r05 = radiusAt(baseDiameter, taper, 0.55);
  const tagY = 1.6;
  const rTag = radiusAt(baseDiameter, taper, tagY);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {foundation && (
        <mesh geometry={cylY(0.42, 0.42, 0.3, 32)} position={[0, baseY - 0.15, 0]} receiveShadow castShadow>
          <meshStandardMaterial map={tmats.concrete().map} color="#c9c6be" roughness={0.9} />
        </mesh>
      )}
      <group position={[0, baseY, 0]}>
        <mesh geometry={shaft} material={mat} castShadow receiveShadow />
        <mesh geometry={hardware} material={mat} castShadow receiveShadow />
        <mesh geometry={nuts} material={tmats.metal('#9ea3a6', 0.4)} castShadow />
        {/* handhole cover + screws */}
        <mesh geometry={roundedBox(0.11, 0.22, 0.012, 0.03, 2)} material={mat} position={[0, 0.55, r05 + 0.012]} />
        {[0.08, -0.08].map((dy) => (
          <mesh key={dy} geometry={cylZ(0.006, 0.006, 0.006, 6)} material={tmats.metal('#8f9498', 0.4)} position={[0, 0.55 + dy, r05 + 0.02]} />
        ))}
        {/* pole ID tag */}
        <mesh geometry={planeGeo(0.1, 0.05)} position={[0, tagY, rTag + 0.003]}>
          <meshStandardMaterial map={poleTagTexture(poleId)} roughness={0.4} metalness={0.4} />
        </mesh>
        {arms.map((a, i) => {
          const h = (a.height ?? SIGNAL_POLE_DEFAULTS.armHeight) - baseY;
          return (
            <group key={i} position={[0, h, 0]} rotation={[0, a.angle ?? 0, 0]}>
              <MastArm {...a} poleRadius={radiusAt(baseDiameter, taper, h)} finishMaterial={mat} />
            </group>
          );
        })}
        {attachments.map((a, i) => {
          const h = a.height - baseY;
          const pr = radiusAt(baseDiameter, taper, h);
          const span = a.bandSpan ?? 0.5;
          return (
            <group key={a.key ?? i} rotation={[0, a.angle ?? 0, 0]}>
              {a.bands !== false &&
                [-span / 2, span / 2].map((dy) => (
                  <mesh key={dy} geometry={bandGeo(radiusAt(baseDiameter, taper, h + dy))} material={tmats.metal('#c0c4c7', 0.3)} position={[0, h + dy, 0]} rotation={[Math.PI / 2, 0, 0]} />
                ))}
              <group position={[0, h, pr]}>{a.node}</group>
            </group>
          );
        })}
        {luminaire && <Luminaire height={height} rTop={radiusAt(baseDiameter, taper, height - 0.3)} {...luminaire} />}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// LED cobra-head luminaire on a davit arm
// ---------------------------------------------------------------------------

function Luminaire({ height, rTop, angle = 0, length = 2.4, getLit }: { height: number; rTop: number; angle?: number; length?: number; getLit?: () => boolean }) {
  const arm = sharedGeo(`pole:davit:${length}`, () => {
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(length * 0.25, 0.1, 0),
      new THREE.Vector3(length * 0.6, 0.55, 0),
      new THREE.Vector3(length, 0.62, 0),
    );
    return new THREE.TubeGeometry(curve, 24, 0.03, 12, false);
  });
  const head = sharedGeo('pole:cobra', () => {
    // flattened teardrop housing, long axis along +X
    const s = new THREE.Shape();
    s.moveTo(0, -0.14);
    s.bezierCurveTo(0.35, -0.2, 0.72, -0.12, 0.74, 0);
    s.bezierCurveTo(0.72, 0.12, 0.35, 0.2, 0, 0.14);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.02, bevelSegments: 4, curveSegments: 16 });
    g.rotateX(Math.PI / 2); // shape XY -> XZ, extrude along -Y
    g.translate(0, 0.04, 0);
    return g;
  });
  const lens = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#cfd3d6', emissive: '#fff1d6', emissiveIntensity: 0, roughness: 0.2, toneMapped: false }),
    [],
  );
  const getter = useRef(getLit);
  getter.current = getLit;
  useFrame(() => {
    lens.emissiveIntensity = getter.current?.() ? 3 : 0;
  });
  return (
    <group position={[0, height - 0.35, 0]} rotation={[0, angle, 0]}>
      <mesh geometry={boxGeo(0.06, 0.2, 0.08)} material={tmats.galvanized()} position={[rTop + 0.02, 0, 0]} />
      <group position={[rTop + 0.04, 0, 0]}>
        <mesh geometry={arm} material={tmats.galvanized()} castShadow />
        <group position={[length - 0.05, 0.62, 0]}>
          <mesh geometry={head} material={tmats.paint('#7b8084', 0.5, 0.4)} castShadow />
          <mesh geometry={roundedBox(0.48, 0.012, 0.2, 0.004, 1)} material={lens} position={[0.36, -0.035, 0]} />
        </group>
      </group>
    </group>
  );
}
