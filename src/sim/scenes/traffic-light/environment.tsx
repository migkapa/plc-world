/**
 * Static surroundings of the `traffic-light` intersection: the road network (from the traffic kit's
 * <Intersection/>, downtown corners paved to the building faces), a city block around it (low-poly shops,
 * offices, a brick corner building), street trees in tree pits and a small pocket park, photocell street
 * lights (dark in daylight — not powered by the signal controller), pull boxes over the underground signal
 * conduits, R9-3 "no pedestrian crossing / use crosswalk" signs on the three unmarked legs, a bus stop and
 * small street furniture. Everything here is static.
 */
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { Intersection, ParkingSpace, roadMats } from '../../../twin/devices';
import { canvasTexture, Conduit, FONT, fitFont, kgeo, kmat } from '../trainer/kit';
import { Bollards, Buildings, grassTexture, GroundPlane, PostSign, PullBoxes, SkyDome, StaticInstances, StreetLights, Trees, type BuildingSpec, type InstXf, type StreetLightSpec, type TreeSpec } from './cityKit';
import { useDisposeOnUnmount } from '../../../twin/dispose';

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
export const CABINET = { x: -8.35, z: -8.35, y: ROAD.curb, rotY: Math.PI / 4 } as const;

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

const T = (x: number, z: number, s = 1): TreeSpec => ({ x, z, y: ROAD.curb, s });

const TREES: TreeSpec[] = [
  // lawn strips along the main street (x = ±7.6) and side street (z = ±7.6), clear of the corners
  ...[-16, -26, -36, -48].flatMap((z) => [T(7.7, z, 0.95), T(-7.7, z, 1.05)]),
  ...[14, 24, 34, 46].flatMap((z) => (z < 20 ? [T(-7.7, z + 2, 0.9)] : [T(7.7, z, 1), T(-7.7, z + 2, 0.9)])),
  ...[16, 26, 36, 48].flatMap((x) => (x < 20 ? [T(x + 3, -7.7, 1)] : [T(x, 7.7, 0.95), T(x + 3, -7.7, 1)])),
  ...[-18, -30, -40, -52].flatMap((x) => [T(x, -7.7, 1.05), T(x + 2, 7.7, 0.9)]),
  // little park on the SW corner
  T(-11.5, 9.2, 1.15),
  T(-8.8, 11.4, 0.85),
];

const LIGHTS: StreetLightSpec[] = [
  { x: 7.3, z: -30, y: ROAD.curb, angle: Math.PI },
  { x: -7.3, z: -20, y: ROAD.curb, angle: 0 },
  { x: -7.3, z: -48, y: ROAD.curb, angle: 0 },
  { x: 7.3, z: 22, y: ROAD.curb, angle: Math.PI },
  { x: -7.3, z: 32, y: ROAD.curb, angle: 0 },
  { x: 22, z: -7.3, y: ROAD.curb, angle: -Math.PI / 2 },
  { x: 40, z: 7.3, y: ROAD.curb, angle: Math.PI / 2 },
  { x: -24, z: 7.3, y: ROAD.curb, angle: Math.PI / 2 },
  { x: -44, z: -7.3, y: ROAD.curb, angle: -Math.PI / 2 },
];

/** Pull boxes: one next to every signal pole, at the loop lead-ins and in front of the cabinet. */
const PULL_BOXES = [
  { x: 4.6, z: -6.9, y: ROAD.curb, angle: 0 },
  { x: -6.9, z: 4.6, y: ROAD.curb, angle: Math.PI / 2 },
  { x: 6.9, z: 4.6, y: ROAD.curb, angle: Math.PI / 2 },
  { x: -4.6, z: -6.9, y: ROAD.curb, angle: 0 },
  { x: -11.45, z: 4.4, y: ROAD.curb, angle: Math.PI / 2 },
  { x: 11.45, z: -4.4, y: ROAD.curb, angle: Math.PI / 2 },
  { x: -7.35, z: -9.6, y: ROAD.curb, angle: Math.PI / 4 },
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
  const mat = kmat(`tl:shop:${id}`, () => {
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
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.15 });
  });
  return (
    <mesh position={position} rotation={[0, rotY, 0]} material={mat}>
      <boxGeometry args={[size[0], size[1], 0.08]} />
    </mesh>
  );
}

/** Customer lot in front of the SE strip mall: stall centres of the parked cars (nose south). */
const LOT = { x0: 10.5, x1: 38, z0: 9.8, z1: 22.6, stallZ: 17.5, driveX: 21 };
export const PARKED_CARS: { x: number; y: number; z: number; yaw: number; variant: number }[] = [
  { x: 16.75, z: LOT.stallZ, yaw: -Math.PI / 2, variant: 7 },
  { x: 29.25, z: LOT.stallZ + 0.1, yaw: -Math.PI / 2 + 0.03, variant: 5 },
].map((c) => ({ ...c, y: ROAD.curb + 0.01 }));

function ParkingLot() {
  const stalls: number[] = [];
  for (let x = 13; x <= 36.8; x += 2.5) stalls.push(x + 1.25);
  const asphalt = kmat('tl:lotMat', () => {
    const m = roadMats.asphalt().clone();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    return m;
  });
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
      <mesh geometry={geo} position={[(LOT.x0 + LOT.x1) / 2, ROAD.curb + 0.003, (LOT.z0 + LOT.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={asphalt} receiveShadow />
      {stalls.map((x, i) => (
        <ParkingSpace key={x} position={[x, ROAD.curb + 0.006, LOT.stallZ]} rotation={[0, -Math.PI / 2, 0]} sides={i === 0 ? 'both' : 'right'} wheelStop={false} />
      ))}
    </group>
  );
}

/** Utility service pedestal (meter + main disconnect) feeding the signal cabinet through a short conduit run. */
function ServicePedestal() {
  const x = CABINET.x - 1.05;
  const z = CABINET.z - 1.05;
  const y = ROAD.curb;
  const body = kmat('tl:pedestal', () => new THREE.MeshStandardMaterial({ color: '#8c9296', roughness: 0.5, metalness: 0.6 }));
  const glass = kmat('tl:meterGlass', () => new THREE.MeshStandardMaterial({ color: '#dfe8ec', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55 }));
  return (
    <group>
      <group position={[x, y, z]} rotation={[0, Math.PI / 4, 0]}>
        <mesh position={[0, 0.6, 0]} material={body} castShadow receiveShadow>
          <boxGeometry args={[0.36, 1.2, 0.24]} />
        </mesh>
        <mesh position={[0, 1.24, 0]} material={body} castShadow>
          <boxGeometry args={[0.42, 0.06, 0.3]} />
        </mesh>
        <mesh position={[0, 0.92, 0.15]} rotation={[Math.PI / 2, 0, 0]} material={glass}>
          <cylinderGeometry args={[0.085, 0.085, 0.08, 20]} />
        </mesh>
        <mesh position={[0.1, 0.55, 0.13]} material={kmat('tl:handle', () => new THREE.MeshStandardMaterial({ color: '#b21e1e', roughness: 0.5 }))}>
          <boxGeometry args={[0.03, 0.14, 0.03]} />
        </mesh>
      </group>
      <Conduit
        points={[
          [x + 0.1, y + 0.3, z + 0.1],
          [x + 0.1, y + 0.05, z + 0.1],
          [CABINET.x - 0.42, y + 0.05, CABINET.z - 0.42],
          [CABINET.x - 0.42, y + 0.12, CABINET.z - 0.42],
        ]}
        radius={0.021}
        bend={0.08}
      />
    </group>
  );
}

/** Tree pits (mulch + steel edge) under the street trees, and a small planted square on the SW corner. */
function Planting() {
  const pits = useMemo<InstXf[]>(() => TREES.filter((t) => !(t.x < -8 && t.z > 8 && t.z < 12)).map((t) => ({ p: [t.x, (t.y ?? 0) + 0.004, t.z] })), []);
  const mulch = kmat('tl:mulch', () => new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 1 }));
  const edge = kmat('tl:pitEdge', () => new THREE.MeshStandardMaterial({ color: '#3b3f42', roughness: 0.6, metalness: 0.6 }));
  const pitGeo = kgeo('tl:pit', () => new THREE.BoxGeometry(1.5, 0.008, 1.5));
  const edgeGeo = kgeo('tl:pitEdgeGeo', () => {
    const parts = [
      new THREE.BoxGeometry(1.6, 0.012, 0.05).translate(0, 0, 0.775),
      new THREE.BoxGeometry(1.6, 0.012, 0.05).translate(0, 0, -0.775),
      new THREE.BoxGeometry(0.05, 0.012, 1.5).translate(0.775, 0, 0),
      new THREE.BoxGeometry(0.05, 0.012, 1.5).translate(-0.775, 0, 0),
    ];
    return mergeNonIndexed(parts);
  });
  const lawn = useMemo(() => {
    const t = grassTexture().clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.6, 1.3);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }, []);
  useDisposeOnUnmount(lawn, () => {
    lawn.map?.dispose();
    lawn.dispose();
  });
  return (
    <group>
      <StaticInstances geometry={pitGeo} material={mulch} items={pits} castShadow={false} />
      <StaticInstances geometry={edgeGeo} material={edge} items={pits} castShadow={false} />
      {/* pocket park on the SW corner: lawn behind a low granite curb */}
      <mesh position={[-10.6, ROAD.curb + 0.006, 10.5]} rotation={[-Math.PI / 2, 0, 0]} material={lawn} receiveShadow>
        <planeGeometry args={[5.6, 4.6]} />
      </mesh>
      <StaticInstances
        geometry={kgeo('tl:parkCurb', () => new THREE.BoxGeometry(1, 1, 1))}
        material={roadMats.curb()}
        items={[
          { p: [-10.6, ROAD.curb + 0.05, 8.2], s: [5.7, 0.1, 0.12] },
          { p: [-7.8, ROAD.curb + 0.05, 10.5], s: [0.12, 0.1, 4.7] },
        ]}
        castShadow={false}
      />
    </group>
  );
}

/** R9-3 "no pedestrian crossing" symbol sign + "USE CROSSWALK" plaque on its own post (both faces printed). */
function noPedTexture() {
  return canvasTexture('tl:r93', 256, 420, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // R9-3 (18" square): white, black border, pedestrian in a red circle with slash
    ctx.fillStyle = '#f4f4ef';
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, w - 20, w - 20);
    ctx.fillStyle = '#111';
    const cx = w / 2;
    ctx.beginPath();
    ctx.arc(cx, 70, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(cx, 92);
    ctx.lineTo(cx - 4, 140);
    ctx.moveTo(cx - 4, 140);
    ctx.lineTo(cx - 24, 190);
    ctx.moveTo(cx - 4, 140);
    ctx.lineTo(cx + 18, 188);
    ctx.moveTo(cx + 1, 100);
    ctx.lineTo(cx - 26, 132);
    ctx.moveTo(cx + 1, 100);
    ctx.lineTo(cx + 24, 128);
    ctx.stroke();
    ctx.strokeStyle = '#c8102e';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(cx, w / 2, 94, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 66, w / 2 - 66);
    ctx.lineTo(cx + 66, w / 2 + 66);
    ctx.stroke();
    // R9-3bP plaque
    const y0 = w + 24;
    ctx.fillStyle = '#f4f4ef';
    ctx.fillRect(20, y0, w - 40, h - y0 - 4);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    ctx.strokeRect(26, y0 + 6, w - 52, h - y0 - 16);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, 'USE', w - 80, 34, 800);
    ctx.fillText('USE', cx, y0 + 38);
    fitFont(ctx, 'CROSSWALK', w - 80, 34, 800);
    ctx.fillText('CROSSWALK', cx, y0 + 78);
    fitFont(ctx, 'NORTH SIDE', w - 90, 22, 700);
    ctx.fillText('NORTH SIDE', cx, y0 + 112);
  });
}

const NO_PED = [
  // S leg (both corners), E leg (NE, SE), W leg (NW, SW): the face looks at a pedestrian about to cross there
  { x: 4.9, z: 6.95, r: Math.PI / 2 },
  { x: -4.9, z: 6.95, r: -Math.PI / 2 },
  { x: 6.95, z: -4.9, r: Math.PI },
  { x: 6.95, z: 4.9, r: 0 },
  { x: -6.95, z: -4.9, r: Math.PI },
  { x: -6.95, z: 4.9, r: 0 },
];

function NoPedCrossingSigns() {
  const face = kmat('tl:r93Mat', () => new THREE.MeshStandardMaterial({ map: noPedTexture(), alphaTest: 0.5, roughness: 0.5, metalness: 0.05 }));
  const back = kmat('tl:r93Back', () => new THREE.MeshStandardMaterial({ color: '#9da3a7', roughness: 0.5, metalness: 0.6 }));
  const faceGeo = kgeo('tl:r93Geo', () => new THREE.PlaneGeometry(0.46, 0.755).translate(0, 2.2 + 0.3775, 0.03));
  const backGeo = kgeo('tl:r93BackGeo', () => new THREE.BoxGeometry(0.46, 0.755, 0.004).translate(0, 2.2 + 0.3775, 0.026));
  const postGeo = kgeo('tl:r93Post', () => new THREE.BoxGeometry(0.05, 2.95, 0.05).translate(0, 1.475, 0));
  const items = useMemo<InstXf[]>(() => NO_PED.map((n) => ({ p: [n.x, ROAD.curb, n.z], r: [0, n.r, 0] })), []);
  return (
    <group>
      <StaticInstances geometry={faceGeo} material={face} items={items} castShadow={false} />
      <StaticInstances geometry={backGeo} material={back} items={items} />
      <StaticInstances geometry={postGeo} material={kmat('tl:r93PostMat', () => new THREE.MeshStandardMaterial({ color: '#8f9598', roughness: 0.45, metalness: 0.7 }))} items={items} />
    </group>
  );
}

/**
 * Everything static around the intersection. Street lights are photocell-controlled luminaires (dark in
 * daylight): nothing here is powered by the signal controller.
 */
export const TrafficEnvironment = memo(function TrafficEnvironment() {
  return (
    <group>
      <SkyDome />
      <GroundPlane />
      {/* downtown corners: sidewalks run to the building faces (street trees in tree pits) */}
      <Intersection armLength={ROAD.armLength} crosswalks={['N']} grass={false} />
      <Buildings specs={BUILDINGS} />
      <Trees items={TREES} />
      <Planting />
      <StreetLights items={LIGHTS} />
      <PullBoxes items={PULL_BOXES} />
      <Bollards at={[[-9.7, -7.2], [-7.2, -9.7]]} y={ROAD.curb} height={0.9} color="#f2c200" />
      <NoPedCrossingSigns />
      <StreetFurniture />
      <ParkingLot />
      <ServicePedestal />
    </group>
  );
});
