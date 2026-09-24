/**
 * Hot-dip galvanized traffic signal mast-arm pole (anchor-base type): tapered round shaft
 * (≈13" base, 0.14 in/ft taper), square base plate on a concrete foundation with 4 anchor bolts &
 * double nuts, handhole with cover, pole cap, ID tag; tapered mast arms bolted to a welded
 * arm-connection box (flange plate + gussets) with a gentle rise, rigid-mount clamps for signal heads,
 * optional street-name sign and LED "cobra head" luminaire on a davit arm.
 *
 * Draw calls: every galvanized part of the pole and its arms is ONE merged mesh (world-scaled spangle
 * UVs, slight weathering toward the base), all hardware (nuts, bolts, clamps, bands, sign blanks,
 * luminaire housing) is ONE per-vertex-finish mesh; plus foundation, tag, one per street sign and the
 * luminaire lens. Attached nodes (signal heads, ped signals…) add their own.
 *
 * Mounting height: the default arm connection height (6.4 m / 21 ft) puts the backplate bottom of a
 * 12" 3-section head hung from a rigid clamp ≈ 5.0 m (16.5 ft) above the pole base — above the MUTCD
 * 4D.15 minimum of 15 ft. Use `mastArmHeightForClearance()` to solve for a target clearance.
 *
 * Origin: ground level at the pole axis. Arms extend along local +X rotated by `angle` about +Y
 * (world arm direction = (cos a, 0, −sin a)); attachments under an arm face the arm's +Z side
 * (world (sin a, 0, cos a)) or −Z with `flip`. Pole attachments face +Z rotated by their `angle`.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { signalHeadClearanceDrop } from './TrafficSignalHead';
import {
  FINISH,
  FT,
  boxGeo,
  canvasTex,
  cylY,
  cylZ,
  galvPrep,
  makeCanvas,
  mergeAll,
  mergeGalv,
  mergeVc,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedMat,
  sharedTex,
  tmats,
  useDisposable,
  vc,
  vcMaterial,
  xf,
  type VcFinish,
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
  /** Height of the arm connection above the pole base (m). Default 6.4 m (21 ft). */
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
  /** Height above the pole base (m). */
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
  /** Arm connection height (21 ft) → ≈ 16.5 ft to the backplate bottom of a 3-section head. */
  armHeight: 6.4,
  armBaseDiameter: 0.25,
  /** Foundation collar height (the pole base plate sits on it). */
  foundationHeight: 0.08,
} as const;

/** Drop from the arm centerline to the clamp face under it (m). */
const CLAMP_DROP = 0.025;

/** Radius of a tapered shaft at height y above its base plate. */
function radiusAt(baseD: number, taper: number, y: number): number {
  return Math.max(0.04, baseD / 2 - (taper * y) / 2);
}

/** Pole shaft radius (m) at height `y` above the pole origin (ground), for fitting attachments. */
export function poleRadiusAt(y: number, baseDiameter: number = SIGNAL_POLE_DEFAULTS.baseDiameter, taper = TAPER, foundation = true): number {
  return radiusAt(baseDiameter, taper, y - (foundation ? SIGNAL_POLE_DEFAULTS.foundationHeight : 0));
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

/**
 * Arm connection height (above the pole origin) that puts the backplate bottom of a signal head hung
 * at `at` m along the arm exactly `clearance` m above the road. `baseElevation` = height of the pole
 * origin above the road (e.g. 0.15 on a curb). Default target 5.0 m (16.5 ft; MUTCD min 15 ft).
 */
export function mastArmHeightForClearance({
  clearance = 5.0,
  at,
  length,
  rise,
  baseDiameter = SIGNAL_POLE_DEFAULTS.armBaseDiameter,
  orientation = 'vertical',
  hanger,
  backplate = true,
  baseElevation = 0,
}: {
  clearance?: number;
  at: number;
  length: number;
  rise?: number;
  baseDiameter?: number;
  orientation?: 'vertical' | 'horizontal';
  hanger?: number;
  backplate?: boolean;
  baseElevation?: number;
}): number {
  const r = rise ?? length * 0.035;
  const drop = -mastArmY(at, length, r) + armRadiusAt(at, baseDiameter, TAPER, length) + CLAMP_DROP + signalHeadClearanceDrop(orientation, hanger, backplate);
  return clearance - baseElevation + drop;
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

function streetSignMat(text: string): THREE.MeshStandardMaterial {
  return sharedMat(`pole:streetmat:${text}`, () => new THREE.MeshStandardMaterial({ map: streetSignTexture(text), roughness: 0.4, metalness: 0.1 }));
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
// Geometry builders (galvanized parts → `galv`, hardware → `hw` with per-vertex finishes)
// ---------------------------------------------------------------------------

interface Bins {
  galv: THREE.BufferGeometry[];
  hw: THREE.BufferGeometry[];
  /** Street sign faces, keyed by text. */
  signs: Map<string, THREE.BufferGeometry[]>;
}

const M_IDENT = new THREE.Matrix4();

/** Tapered, gently rising mast arm along +X from x=0 (pole axis) with a tip cap. */
function armGeometry(len: number, baseD: number, rise: number, taper: number): THREE.BufferGeometry {
  const tipD = Math.max(0.09, baseD - taper * len);
  const g = new THREE.CylinderGeometry(tipD / 2, baseD / 2, len, 28, 16, true);
  g.rotateZ(-Math.PI / 2); // +Y -> +X (top = tip at +X)
  g.translate(len / 2, 0, 0);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setY(i, pos.getY(i) + mastArmY(x, len, rise));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Add one mast arm (connection box, gussets, arm, end cap, bolts, head clamps, sign) to the bins.
 * `m` = transform from arm-local (pole axis at the connection height, arm along +X) to pole-local.
 */
function addArm(bins: Bins, spec: MastArmSpec, poleRadius: number, m: THREE.Matrix4, yWorld: number, finish: 'galvanized' | VcFinish): void {
  const { length } = spec;
  const r = spec.rise ?? length * 0.035;
  const baseD = spec.baseDiameter ?? SIGNAL_POLE_DEFAULTS.armBaseDiameter;
  const put = (g: THREE.BufferGeometry, cyl?: { axis: 'x' | 'y'; radius: number }) => {
    if (finish === 'galvanized') bins.galv.push(galvPrep(g, { yOffset: yWorld, tone: 0.97, cyl }).applyMatrix4(m));
    else bins.hw.push(vc(g, finish).applyMatrix4(m));
  };
  const hw = (g: THREE.BufferGeometry, f: VcFinish = FINISH.hardware) => bins.hw.push(vc(g, f).applyMatrix4(m));

  const x0 = poleRadius * 0.85;
  // welded box on the pole + flange plates
  put(xf(boxGeo(0.12, 0.5, 0.36), [x0 + 0.04, 0, 0]));
  put(xf(boxGeo(0.03, 0.56, 0.42), [x0 + 0.115, 0, 0]));
  put(xf(boxGeo(0.028, 0.52, 0.38), [x0 + 0.146, 0, 0]));
  // gussets
  for (const z of [-0.15, 0.15]) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.16, 0);
    s.lineTo(0, 0.14);
    s.closePath();
    const gus = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
    put(xf(gus, [x0 + 0.16, 0.08, z - 0.006]));
    put(xf(gus, [x0 + 0.16, -0.08, z + 0.006], [Math.PI, 0, 0]));
  }
  // flange bolts
  const xb = x0 + 0.165;
  for (const y of [-0.22, 0.22])
    for (const z of [-0.15, 0, 0.15]) {
      const nut = new THREE.CylinderGeometry(0.02, 0.02, 0.022, 6);
      nut.rotateZ(Math.PI / 2);
      hw(xf(nut, [xb, y, z]));
    }
  // arm + end cap
  put(armGeometry(length, baseD, r, TAPER), { axis: 'x', radius: baseD / 2 });
  const tipR = armRadiusAt(length, baseD, TAPER, length) + 0.004;
  put(xf(cylY(tipR, tipR, 0.02, 24), [length + 0.005, r, 0], [0, 0, Math.PI / 2]));
  // rigid-mount clamps for attachments
  const boxLen = x0 + 0.16;
  for (const a of spec.attachments ?? []) {
    const x = clampAt(a.at, boxLen, length);
    const ar = armRadiusAt(x, baseD, TAPER, length);
    const y = mastArmY(x, length, r) - ar;
    hw(xf(roundedBox(0.12, 0.05, 0.1, 0.01, 2), [x, y, 0]), { color: '#8d9195', roughness: 0.45, metalness: 0.9 });
    for (const dx of [0, 0.04]) hw(xf(new THREE.TorusGeometry(ar + 0.002, 0.004, 6, 32), [x + dx, y + ar, 0], [0, Math.PI / 2, 0]), FINISH.stainless);
  }
  // street sign blank + brackets (faces go to the textured sign bin)
  const ss = spec.streetSign;
  if (ss) {
    const w = ss.width ?? 1.8;
    const h = 0.45;
    const sy = mastArmY(ss.at, length, r);
    const sr = armRadiusAt(ss.at, baseD, TAPER, length);
    const yc = sy + sr + 0.04 + h / 2;
    hw(xf(roundedBox(w, h, 0.012, 0.03, 2), [ss.at, yc, 0]), { color: '#9aa0a4', roughness: 0.4, metalness: 0.9 });
    for (const dx of [-w / 3, w / 3]) hw(xf(boxGeo(0.05, 0.1 + sr, 0.03), [ss.at + dx, yc - h / 2 - (0.05 + sr) / 2 + 0.01, 0]), { color: '#8d9195', roughness: 0.45, metalness: 0.9 });
    const faces = [xf(planeGeo(w - 0.01, h - 0.01), [ss.at, yc, 0.0065]), xf(planeGeo(w - 0.01, h - 0.01), [ss.at, yc, -0.0065], [0, Math.PI, 0])].map((g) => g.applyMatrix4(m));
    const list = bins.signs.get(ss.text) ?? [];
    list.push(...faces);
    bins.signs.set(ss.text, list);
  }
}

function clampAt(at: number, boxLen: number, length: number): number {
  return Math.min(Math.max(at, boxLen + 0.1), length - 0.05);
}

interface PoleGeoms {
  galv: THREE.BufferGeometry;
  hw: THREE.BufferGeometry;
  signs: [string, THREE.BufferGeometry][];
}

// ---------------------------------------------------------------------------
// MastArm (standalone)
// ---------------------------------------------------------------------------

export interface MastArmProps extends MastArmSpec {
  /** Pole radius at the connection height (the connection box sits on the pole surface). */
  poleRadius?: number;
  /** Paint finish instead of galvanized. */
  paintColor?: string;
}

/**
 * One mast arm with its pole connection box. Origin: pole axis at the arm connection height; the arm
 * extends along +X (apply `angle` with a parent rotation or use SignalPole's `arms`).
 */
export function MastArm({ poleRadius = 0.15, paintColor, ...spec }: MastArmProps) {
  const key = armKey(spec, poleRadius, paintColor);
  const geoms = sharedPole(`arm:${key}`, () => {
    const bins: Bins = { galv: [], hw: [], signs: new Map() };
    addArm(bins, spec, poleRadius, M_IDENT, 6, paintColor ? { color: paintColor, roughness: 0.45, metalness: 0.35 } : 'galvanized');
    return finishBins(bins);
  });
  return (
    <group>
      <PoleMeshes geoms={geoms} />
      <ArmNodes spec={spec} poleRadius={poleRadius} />
    </group>
  );
}

function armKey(a: MastArmSpec, poleRadius: number, paint?: string): string {
  return JSON.stringify([
    a.length,
    a.rise ?? null,
    a.baseDiameter ?? null,
    (a.attachments ?? []).map((t) => t.at),
    a.streetSign ? [a.streetSign.at, a.streetSign.text, a.streetSign.width ?? null] : null,
    +poleRadius.toFixed(4),
    paint ?? null,
  ]);
}

/** Attachment nodes under an arm (arm-local frame). */
function ArmNodes({ spec, poleRadius }: { spec: MastArmSpec; poleRadius: number }) {
  const r = spec.rise ?? spec.length * 0.035;
  const baseD = spec.baseDiameter ?? SIGNAL_POLE_DEFAULTS.armBaseDiameter;
  const boxLen = poleRadius * 0.85 + 0.16;
  return (
    <>
      {(spec.attachments ?? []).map((a, i) => {
        const x = clampAt(a.at, boxLen, spec.length);
        const y = mastArmY(x, spec.length, r) - armRadiusAt(x, baseD, TAPER, spec.length) - CLAMP_DROP;
        return (
          <group key={a.key ?? i} position={[x, y, 0]} rotation={[0, a.flip ? Math.PI : 0, 0]}>
            {a.node}
          </group>
        );
      })}
    </>
  );
}

const poleCache = new Map<string, PoleGeoms>();
function sharedPole(key: string, make: () => PoleGeoms): PoleGeoms {
  let g = poleCache.get(key);
  if (!g) {
    g = make();
    poleCache.set(key, g);
  }
  return g;
}

function finishBins(bins: Bins): PoleGeoms {
  return {
    galv: bins.galv.length ? mergeGalv(bins.galv) : new THREE.BufferGeometry(),
    hw: bins.hw.length ? mergeVc(bins.hw) : new THREE.BufferGeometry(),
    signs: [...bins.signs.entries()].map(([t, list]) => [t, mergeAll(list)]),
  };
}

function PoleMeshes({ geoms, finishMat }: { geoms: PoleGeoms; finishMat?: THREE.Material }) {
  return (
    <>
      {geoms.galv.attributes.position && <mesh geometry={geoms.galv} material={finishMat ?? tmats.galvanized()} castShadow receiveShadow />}
      {geoms.hw.attributes.position && <mesh geometry={geoms.hw} material={vcMaterial()} castShadow receiveShadow />}
      {geoms.signs.map(([text, g]) => (
        <mesh key={text} geometry={g} material={streetSignMat(text)} />
      ))}
    </>
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
  const baseY = foundation ? SIGNAL_POLE_DEFAULTS.foundationHeight : 0;
  const lum = luminaire ? { angle: luminaire.angle ?? 0, length: luminaire.length ?? 2.4 } : null;
  const key = JSON.stringify([
    height,
    baseDiameter,
    taper,
    finish,
    baseY,
    arms.map((a) => [armKey(a, 0, undefined), a.angle ?? 0, a.height ?? SIGNAL_POLE_DEFAULTS.armHeight]),
    attachments.map((a) => [a.height, a.angle ?? 0, a.bands !== false, a.bandSpan ?? 0.5]),
    lum,
  ]);
  const geoms = sharedPole(`pole:${key}`, () => {
    const bins: Bins = { galv: [], hw: [], signs: new Map() };
    const paint: VcFinish | null = finish === 'galvanized' ? null : { color: finish, roughness: 0.45, metalness: 0.35 };
    const galv = (g: THREE.BufferGeometry, cyl?: { axis: 'x' | 'y'; radius: number }) => {
      if (paint) bins.hw.push(vc(g, paint));
      else bins.galv.push(galvPrep(g, { yOffset: baseY, cyl }));
    };
    const hw = (g: THREE.BufferGeometry, f: VcFinish = FINISH.hardware) => bins.hw.push(vc(g, f));
    // shaft
    const shaft = new THREE.CylinderGeometry(radiusAt(baseDiameter, taper, height), baseDiameter / 2, height, 32, 8, true);
    shaft.translate(0, height / 2, 0);
    galv(shaft, { axis: 'y', radius: baseDiameter / 2 });
    const rTop = radiusAt(baseDiameter, taper, height);
    // base plate
    galv(xf(roundedBox(0.52, 0.045, 0.52, 0.01, 1), [0, 0.0225, 0]));
    // handhole frame + cover (on +Z side)
    const r05 = radiusAt(baseDiameter, taper, 0.55);
    galv(xf(roundedBox(0.14, 0.26, 0.03, 0.03, 2), [0, 0.55, r05 - 0.006]));
    galv(xf(roundedBox(0.11, 0.22, 0.012, 0.03, 2), [0, 0.55, r05 + 0.012]));
    for (const dy of [0.08, -0.08]) hw(xf(cylZ(0.006, 0.006, 0.006, 6), [0, 0.55 + dy, r05 + 0.02]));
    // pole cap
    galv(xf(new THREE.SphereGeometry(rTop + 0.01, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), [0, height, 0]));
    galv(xf(cylY(rTop + 0.012, rTop + 0.012, 0.04, 24), [0, height, 0]));
    // grounding lug
    hw(xf(boxGeo(0.03, 0.04, 0.02), [r05 * 0.7, 0.3, -r05 * 0.72]), { color: '#b87333', roughness: 0.4, metalness: 0.9 });
    // anchor bolts with leveling & top nuts and washers
    for (const [x, z] of [
      [0.19, 0.19],
      [-0.19, 0.19],
      [0.19, -0.19],
      [-0.19, -0.19],
    ] as const) {
      hw(xf(cylY(0.016, 0.016, 0.16, 10), [x, 0.03, z]));
      hw(xf(cylY(0.03, 0.03, 0.03, 6), [x, 0.06, z]));
      hw(xf(cylY(0.03, 0.03, 0.03, 6), [x, -0.015, z]));
      hw(xf(cylY(0.038, 0.038, 0.006, 16), [x, 0.047, z]));
    }
    // arms
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const a of arms) {
      const h = (a.height ?? SIGNAL_POLE_DEFAULTS.armHeight) - baseY;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.angle ?? 0);
      m.compose(new THREE.Vector3(0, h, 0), q, new THREE.Vector3(1, 1, 1));
      addArm(bins, a, radiusAt(baseDiameter, taper, h), m, h + baseY, paint ?? 'galvanized');
    }
    // band clamps for pole attachments
    for (const a of attachments) {
      if (a.bands === false) continue;
      const h = a.height - baseY;
      const span = a.bandSpan ?? 0.5;
      for (const dy of [-span / 2, span / 2]) hw(xf(new THREE.TorusGeometry(radiusAt(baseDiameter, taper, h + dy) + 0.002, 0.004, 6, 32), [0, h + dy, 0], [Math.PI / 2, 0, 0]), FINISH.stainless);
    }
    // luminaire davit arm + mount (galvanized), cobra-head housing (hardware bin, painted)
    if (lum) {
      const rT = radiusAt(baseDiameter, taper, height - 0.3);
      const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), lum.angle);
      const ml = new THREE.Matrix4().compose(new THREE.Vector3(0, height - 0.35, 0), q2, new THREE.Vector3(1, 1, 1));
      const put = (g: THREE.BufferGeometry, galvanized: boolean, f?: VcFinish) => {
        g.applyMatrix4(ml);
        if (galvanized && !paint) bins.galv.push(galvPrep(g, { yOffset: baseY, tone: 1.02 }));
        else bins.hw.push(vc(g, f ?? paint ?? FINISH.hardware));
      };
      put(xf(boxGeo(0.06, 0.2, 0.08), [rT + 0.02, 0, 0]), true);
      put(xf(davitGeometry(lum.length), [rT + 0.04, 0, 0]), true);
      put(xf(cobraGeometry(), [rT + 0.04 + lum.length - 0.05, 0.62, 0]), false, { color: '#7b8084', roughness: 0.5, metalness: 0.4 });
    }
    return finishBins(bins);
  });
  const r05 = radiusAt(baseDiameter, taper, 0.55);
  const tagY = 1.6;
  const rTag = radiusAt(baseDiameter, taper, tagY);
  const finishMat = finish === 'galvanized' ? undefined : vcMaterial();

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {foundation && <mesh geometry={cylY(0.42, 0.42, 0.3, 32)} position={[0, baseY - 0.15, 0]} material={foundationMat()} receiveShadow castShadow />}
      <group position={[0, baseY, 0]}>
        <PoleMeshes geoms={geoms} finishMat={finishMat} />
        {/* pole ID tag */}
        <mesh geometry={planeGeo(0.1, 0.05)} position={[0, tagY, rTag + 0.003]} material={tagMat(poleId)} />
        {arms.map((a, i) => {
          const h = (a.height ?? SIGNAL_POLE_DEFAULTS.armHeight) - baseY;
          return (
            <group key={i} position={[0, h, 0]} rotation={[0, a.angle ?? 0, 0]}>
              <ArmNodes spec={a} poleRadius={radiusAt(baseDiameter, taper, h)} />
            </group>
          );
        })}
        {attachments.map((a, i) => {
          const h = a.height - baseY;
          const pr = radiusAt(baseDiameter, taper, h);
          return (
            <group key={a.key ?? i} rotation={[0, a.angle ?? 0, 0]}>
              <group position={[0, h, pr]}>{a.node}</group>
            </group>
          );
        })}
        {luminaire && <LuminaireLens height={height} rTop={radiusAt(baseDiameter, taper, height - 0.3)} angle={luminaire.angle ?? 0} length={luminaire.length ?? 2.4} getLit={luminaire.getLit} />}
      </group>
      {/* handhole reference kept for scenes that look for it */}
      <group name="handhole" position={[0, baseY + 0.55, r05 + 0.018]} />
    </group>
  );
}

function foundationMat(): THREE.MeshStandardMaterial {
  return sharedMat('pole:foundation', () => new THREE.MeshStandardMaterial({ map: tmats.concrete().map, color: '#c9c6be', roughness: 0.9 }));
}

function tagMat(id: string): THREE.MeshStandardMaterial {
  return sharedMat(`pole:tagMat:${id}`, () => new THREE.MeshStandardMaterial({ map: poleTagTexture(id), roughness: 0.4, metalness: 0.4 }));
}

// ---------------------------------------------------------------------------
// LED cobra-head luminaire on a davit arm
// ---------------------------------------------------------------------------

function davitGeometry(length: number): THREE.BufferGeometry {
  return sharedGeo(`pole:davit:${length}`, () => {
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(length * 0.25, 0.1, 0),
      new THREE.Vector3(length * 0.6, 0.55, 0),
      new THREE.Vector3(length, 0.62, 0),
    );
    return new THREE.TubeGeometry(curve, 24, 0.03, 12, false);
  });
}

function cobraGeometry(): THREE.BufferGeometry {
  return sharedGeo('pole:cobra', () => {
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
}

function LuminaireLens({ height, rTop, angle, length, getLit }: { height: number; rTop: number; angle: number; length: number; getLit?: () => boolean }) {
  const lens = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfd3d6', emissive: '#fff1d6', emissiveIntensity: 0, roughness: 0.2, toneMapped: false }), []);
  useDisposable(useMemo(() => [lens], [lens]));
  const getter = useRef(getLit);
  getter.current = getLit;
  useFrame(() => {
    lens.emissiveIntensity = getter.current?.() ? 3 : 0;
  });
  return (
    <group position={[0, height - 0.35, 0]} rotation={[0, angle, 0]}>
      <mesh geometry={roundedBox(0.48, 0.012, 0.2, 0.004, 1)} material={lens} position={[rTop + 0.04 + length - 0.05 + 0.36, 0.62 - 0.035, 0]} />
    </group>
  );
}
