/**
 * Static surroundings of the `traffic-light` intersection: the road network (from the traffic kit's
 * <Intersection/>), a city block around it (low-poly shops, offices, a brick corner building), street
 * trees, street lights, pull boxes over the underground signal conduits, a bus stop and small street
 * furniture. Everything here is static (no per-frame work except the street-light lenses).
 */
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { Intersection, ParkingSpace, roadMats } from '../../../twin/devices';
import { FONT, fitFont, kgeo, kmat } from '../trainer/kit';
import { Bollards, Buildings, GroundPlane, PostSign, PullBoxes, SkyDome, StaticInstances, StreetLights, Trees, type BuildingSpec, type InstXf, type StreetLightSpec, type TreeSpec } from './cityKit';

/** Road geometry used by the view (plan frame of TRAFFIC_GEOMETRY). */
export const ROAD = {
  half: 3.5,
  walk: 3,
  curb: 0.15,
  lawn: 0.12,
  armLength: 62,
  /** Signal pole offset from the centre (corner walks). */
  pole: 5.6,
} as const;

/** Signal cabinet pad on the NW corner (behind the walk), door facing the intersection. */
export const CABINET = { x: -8.35, z: -8.35, y: ROAD.lawn, rotY: Math.PI / 4 } as const;

/** Buildings (also used as coarse occluders for the tag chips). */
export const BUILDINGS: BuildingSpec[] = [
  // NE: brick corner block with shops
  { x0: 9.5, x1: 27, z0: -23, z1: -9.5, floors: 2, facade: 'brick', hvac: 3 },
  { x0: 9.5, x1: 22, z0: -42, z1: -25, floors: 4, facade: 'office', hvac: 2 },
  { x0: 29, x1: 44, z0: -22, z1: -9.5, floors: 1, facade: 'stucco', hvac: 2 },
  // NW: stucco shops (cabinet on the corner lawn)
  { x0: -27, x1: -12, z0: -22, z1: -10.5, floors: 1, facade: 'stucco', hvac: 2 },
  { x0: -24, x1: -9.5, z0: -44, z1: -26, floors: 3, facade: 'brickDark', hvac: 2 },
  { x0: -45, x1: -29, z0: -24, z1: -9.5, floors: 2, facade: 'brick', hvac: 2 },
  // SE: strip mall behind its parking lot, offices further east
  { x0: 12, x1: 38, z0: 23, z1: 33, floors: 0, facade: 'stucco', ground: 'store', hvac: 3 },
  { x0: 42, x1: 56, z0: 9.5, z1: 24, floors: 4, facade: 'office', hvac: 2 },
  { x0: 9.5, x1: 22, z0: 36, z1: 50, floors: 2, facade: 'brickDark', hvac: 1 },
  // SW: brick walk-ups
  { x0: -25, x1: -9.5, z0: 12, z1: 24, floors: 3, facade: 'brickDark', hvac: 2 },
  { x0: -44, x1: -28, z0: 9.5, z1: 22, floors: 1, facade: 'stucco', hvac: 2 },
  { x0: -22, x1: -9.5, z0: 28, z1: 45, floors: 2, facade: 'brick', hvac: 2 },
];

/** Coarse occluder boxes for the tag chips: buildings + the signal cabinet. */
export const OCCLUDERS: Array<[Vec3, Vec3]> = BUILDINGS.map((b) => [
  [b.x0, 0, b.z0],
  [b.x1, 4.4 + b.floors * 3.5, b.z1],
]);

const T = (x: number, z: number, s = 1): TreeSpec => ({ x, z, y: ROAD.lawn, s });

const TREES: TreeSpec[] = [
  // lawn strips along the main street (x = ±7.6) and side street (z = ±7.6), clear of the corners
  ...[-16, -26, -36, -48].flatMap((z) => [T(7.7, z, 0.95), T(-7.7, z, 1.05)]),
  ...[14, 24, 34, 46].flatMap((z) => [T(7.7, z, 1), T(-7.7, z + 2, 0.9)]),
  ...[16, 26, 36, 48].flatMap((x) => [T(x, 7.7, 0.95), T(x + 3, -7.7, 1)]),
  ...[-18, -30, -40, -52].flatMap((x) => [T(x, -7.7, 1.05), T(x + 2, 7.7, 0.9)]),
  // little park on the SW corner
  T(-11.5, 9.2, 1.15),
  T(-8.8, 11.4, 0.85),
];

const LIGHTS: StreetLightSpec[] = [
  { x: 7.3, z: -30, y: ROAD.lawn, angle: Math.PI },
  { x: -7.3, z: -20, y: ROAD.lawn, angle: 0 },
  { x: -7.3, z: -48, y: ROAD.lawn, angle: 0 },
  { x: 7.3, z: 22, y: ROAD.lawn, angle: Math.PI },
  { x: -7.3, z: 32, y: ROAD.lawn, angle: 0 },
  { x: 22, z: -7.3, y: ROAD.lawn, angle: -Math.PI / 2 },
  { x: 40, z: 7.3, y: ROAD.lawn, angle: Math.PI / 2 },
  { x: -24, z: 7.3, y: ROAD.lawn, angle: Math.PI / 2 },
  { x: -44, z: -7.3, y: ROAD.lawn, angle: -Math.PI / 2 },
];

/** Pull boxes: one next to every signal pole, at the loop lead-ins and in front of the cabinet. */
const PULL_BOXES = [
  { x: 4.6, z: -6.9, y: ROAD.curb, angle: 0 },
  { x: -6.9, z: 4.6, y: ROAD.curb, angle: Math.PI / 2 },
  { x: 6.9, z: 4.6, y: ROAD.curb, angle: Math.PI / 2 },
  { x: -4.6, z: -6.9, y: ROAD.curb, angle: 0 },
  { x: -11.45, z: 4.4, y: ROAD.curb, angle: Math.PI / 2 },
  { x: 11.45, z: -4.4, y: ROAD.curb, angle: Math.PI / 2 },
  { x: -7.35, z: -9.6, y: ROAD.lawn + 0.01, angle: Math.PI / 4 },
];

// ---------------------------------------------------------------------------
// Street furniture (a few merged meshes)
// ---------------------------------------------------------------------------

function StreetFurniture() {
  const hydrantGeo = kgeo('tl:hydrant', () => {
    const body = new THREE.CylinderGeometry(0.11, 0.13, 0.62, 14).translate(0, 0.31, 0);
    const cap = new THREE.SphereGeometry(0.12, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0);
    const nozzle = new THREE.CylinderGeometry(0.05, 0.05, 0.36, 10).rotateZ(Math.PI / 2).translate(0, 0.44, 0);
    const base = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 14).translate(0, 0.03, 0);
    return mergeNonIndexed([body, cap, nozzle, base]);
  });
  const canGeo = kgeo('tl:trashcan', () => {
    const body = new THREE.CylinderGeometry(0.28, 0.26, 0.9, 16, 1, true).translate(0, 0.45, 0);
    const lid = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16).translate(0, 0.93, 0);
    return mergeNonIndexed([body, lid]);
  });
  const benchGeo = kgeo('tl:bench', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) parts.push(new THREE.BoxGeometry(1.8, 0.035, 0.1).translate(0, 0.45, -0.12 + i * 0.12));
    for (let i = 0; i < 2; i++) parts.push(new THREE.BoxGeometry(1.8, 0.1, 0.03).translate(0, 0.62 + i * 0.13, -0.22));
    for (const x of [-0.75, 0.75]) parts.push(new THREE.BoxGeometry(0.05, 0.45, 0.4).translate(x, 0.225, -0.05));
    return mergeNonIndexed(parts);
  });
  const shelterGeo = kgeo('tl:shelter', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-1.6, 1.6]) for (const z of [-0.6, 0.6]) parts.push(new THREE.BoxGeometry(0.06, 2.4, 0.06).translate(x, 1.2, z));
    parts.push(new THREE.BoxGeometry(3.5, 0.08, 1.5).translate(0, 2.44, 0));
    return mergeNonIndexed(parts);
  });
  const glassGeo = kgeo('tl:shelterGlass', () => new THREE.BoxGeometry(3.2, 1.9, 0.015).translate(0, 1.2, -0.62));
  const red = kmat('tl:hydrantMat', () => new THREE.MeshStandardMaterial({ color: '#c7261e', roughness: 0.5, metalness: 0.2 }));
  const green = kmat('tl:canMat', () => new THREE.MeshStandardMaterial({ color: '#2d4a39', roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }));
  const wood = kmat('tl:benchMat', () => new THREE.MeshStandardMaterial({ color: '#7a5a3c', roughness: 0.8 }));
  const alu = kmat('tl:shelterMat', () => new THREE.MeshStandardMaterial({ color: '#5d656c', roughness: 0.4, metalness: 0.7 }));
  const glass = kmat('tl:shelterGlassMat', () => new THREE.MeshStandardMaterial({ color: '#b9d2de', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false }));
  const y = ROAD.curb;
  const hydrants: InstXf[] = [{ p: [6.1, y, 9.6] }, { p: [-9.4, y, -6.1] }, { p: [20, y, 6.1] }];
  const cans: InstXf[] = [{ p: [6.0, y, -12.5] }, { p: [-6.0, y, 13] }, { p: [14, y, -6.0] }];
  const benches: InstXf[] = [{ p: [5.55, y, 17.2], r: [0, -Math.PI / 2, 0] }];
  const shelter: InstXf[] = [{ p: [5.6, y, 17.2], r: [0, -Math.PI / 2, 0] }];
  return (
    <group>
      <StaticInstances geometry={hydrantGeo} material={red} items={hydrants} />
      <StaticInstances geometry={canGeo} material={green} items={cans} />
      <StaticInstances geometry={benchGeo} material={wood} items={benches} />
      <StaticInstances geometry={shelterGeo} material={alu} items={shelter} />
      <StaticInstances geometry={glassGeo} material={glass} items={shelter} castShadow={false} />
      <PostSign
        id="bus"
        size={[0.45, 0.6]}
        position={[4.2, y, 19.4]}
        rotationY={-Math.PI / 2}
        postHeight={2.1}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#1f5aa6';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          fitFont(ctx, 'BUS', w * 0.8, h * 0.3);
          ctx.fillText('BUS', w / 2, h * 0.3);
          fitFont(ctx, 'STOP', w * 0.8, h * 0.18);
          ctx.fillText('STOP', w / 2, h * 0.55);
          ctx.font = `600 ${Math.round(h * 0.09)}px ${FONT}`;
          ctx.fillText('ROUTES 4 · 11', w / 2, h * 0.8);
        }}
      />
      {/* shop signs on the corner buildings */}
      <ShopSign id="cafe" text="CORNER CAFÉ" bg="#2f4a3a" fg="#f3e7c6" position={[18.2, 3.75, -9.37]} size={[6, 0.7]} />
      <ShopSign id="hw" text="HARDWARE & SUPPLY" bg="#7a1f1f" fg="#fff4e6" position={[9.37, 3.75, -16]} size={[7, 0.7]} rotY={-Math.PI / 2} />
      <ShopSign id="bakery" text="BAKERY" bg="#f1e3c8" fg="#6b3d1f" position={[-19, 3.75, -10.37]} size={[4.5, 0.7]} />
      <ShopSign id="pharm" text="PHARMACY" bg="#1d6b52" fg="#ffffff" position={[17.5, 3.75, 22.87]} size={[5, 0.7]} rotY={Math.PI} />
      <ShopSign id="grocery" text="FRESH MARKET" bg="#b4432b" fg="#fff7e8" position={[28.5, 3.75, 22.87]} size={[7, 0.7]} rotY={Math.PI} />
      <ShopSign id="books" text="BOOKS" bg="#23324a" fg="#e8d9a8" position={[-17, 3.75, 11.87]} size={[4, 0.7]} rotY={Math.PI} />
    </group>
  );
}

function mergeNonIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of list) g.deleteAttribute('uv');
  let count = 0;
  for (const g of list) count += g.attributes.position!.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function ShopSign({ id, text, bg, fg, position, size, rotY = 0 }: { id: string; text: string; bg: string; fg: string; position: Vec3; size: [number, number]; rotY?: number }) {
  const mat = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = Math.round(size[0] * 120);
    c.height = Math.round(size[1] * 120);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, text, c.width * 0.9, c.height * 0.62, 800);
    ctx.fillText(text, c.width / 2, c.height / 2 + 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return kmat(`tl:shop:${id}`, () => new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.15 }));
  }, [id, text, bg, fg, size]);
  return (
    <mesh position={position} rotation={[0, rotY, 0]} material={mat}>
      <boxGeometry args={[size[0], size[1], 0.08]} />
    </mesh>
  );
}

/** Customer lot in front of the SE strip mall: stall centres of the parked cars (nose south). */
const LOT = { x0: 10.5, x1: 38, z0: 9.8, z1: 22.6, stallZ: 17.5, driveX: 21 };
export const PARKED_CARS: { x: number; y: number; z: number; yaw: number; variant: number }[] = [
  { x: 14.25, z: LOT.stallZ, yaw: -Math.PI / 2, variant: 3 },
  { x: 16.75, z: LOT.stallZ, yaw: -Math.PI / 2, variant: 7 },
  { x: 24.25, z: LOT.stallZ, yaw: -Math.PI / 2, variant: 1 },
  { x: 29.25, z: LOT.stallZ, yaw: -Math.PI / 2, variant: 5 },
  { x: 34.25, z: LOT.stallZ + 0.1, yaw: -Math.PI / 2 + 0.03, variant: 0 },
].map((c) => ({ ...c, y: ROAD.lawn + 0.01 }));

function ParkingLot() {
  const stalls: number[] = [];
  for (let x = 13; x <= 36.8; x += 2.5) stalls.push(x + 1.25);
  const asphalt = kmat('tl:lotMat', () => {
    const m = roadMats.asphalt().clone();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    return m;
  });
  const concrete = roadMats.curb();
  const w = LOT.x1 - LOT.x0;
  const d = LOT.z1 - LOT.z0;
  const geo = kgeo(`tl:lot:${w}:${d}`, () => {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv!;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 4, (uv.getY(i) * d) / 4);
    return g;
  });
  return (
    <group>
      <mesh geometry={geo} position={[(LOT.x0 + LOT.x1) / 2, ROAD.lawn + 0.003, (LOT.z0 + LOT.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={asphalt} receiveShadow />
      {/* driveway apron across the walk (curb cut) */}
      <mesh position={[LOT.driveX, ROAD.curb / 2 + 0.004, (ROAD.half + LOT.z0) / 2]} material={concrete} receiveShadow>
        <boxGeometry args={[6, ROAD.curb, LOT.z0 - ROAD.half]} />
      </mesh>
      {stalls.map((x, i) => (
        <ParkingSpace key={x} position={[x, ROAD.lawn + 0.006, LOT.stallZ]} rotation={[0, -Math.PI / 2, 0]} sides={i === 0 ? 'both' : 'right'} wheelStop={false} />
      ))}
    </group>
  );
}

/** Everything static around the intersection. `getNight` lights the street lights. */
export const TrafficEnvironment = memo(function TrafficEnvironment({ getNight }: { getNight: () => boolean }) {
  return (
    <group>
      <SkyDome />
      <GroundPlane />
      <Intersection armLength={ROAD.armLength} crosswalks={['N']} />
      <Buildings specs={BUILDINGS} />
      <Trees items={TREES} />
      <StreetLights items={LIGHTS} getLit={getNight} />
      <PullBoxes items={PULL_BOXES} />
      <Bollards at={[[-9.7, -7.2], [-7.2, -9.7]]} y={ROAD.lawn} height={0.9} color="#f2c200" />
      <StreetFurniture />
      <ParkingLot />
    </group>
  );
});
