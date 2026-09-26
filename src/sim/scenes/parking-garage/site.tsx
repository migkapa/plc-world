/**
 * Static site of the `parking-garage` scene (plan frame of GARAGE_LAYOUT: x = east, z = south):
 *
 *  - the open-air parking deck (concrete slab, precast perimeter parapets, 12 numbered stalls with wheel
 *    stops, aisle markings, a stair / elevator tower, light poles) with a precast upper level on columns
 *    over the north stall row,
 *  - the entrance canopy over the gate lanes (steel columns, roof, fascia signs on both faces), a small
 *    canopy over the ticket island, the over-height ("headache") bar on its own gantry upstream of the
 *    ticket column, and the lane islands (entry island with the ticket column + entry gate, centre island
 *    with the photo-eye reflectors, exit island with the exit gate) and the pad of the attendant booth,
 *  - the entry / exit plaza (asphalt, matte painted lane arrows, stop bars, hatched median) and the
 *    mixed-use building in front of it whose vehicle passage leads to the street (cars appear / leave there),
 *  - the street beyond, neighbouring buildings, trees and street lights (kept out of the camera sight lines).
 */
import { memo, useMemo } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { ClearanceBar, GroundSlab, ParkingSpace, RoadSegment, roadMats } from '../../../twin/devices';
import { canvasTexture, FONT, kgeo, kmat } from '../trainer/kit';
import { Bollards, Buildings, GroundPlane, PullBoxes, SkyDome, StaticInstances, StreetLights, Trees, useDisposeOnUnmount, type BuildingSpec, type InstXf } from '../traffic-light/cityKit';
import { GARAGE_LAYOUT as Y } from './logic';

export const CURB = 0.15;

/** Site plan (m). */
export const SITE = {
  deck: { x0: -17.6, x1: 17.6, z0: -17.2, z1: 6.2 },
  plaza: { x0: -13, x1: 13, z0: 6.2, z1: 19.5 },
  westIsland: { x0: -6.4, x1: -4.45, z0: 3.4, z1: 11.4 },
  centerIsland: { x0: -0.7, x1: 0.7, z0: 1.2, z1: 7.25 },
  eastIsland: { x0: 4.45, x1: 6.4, z0: 0.6, z1: 7.8 },
  boothPad: { x0: 6.4, x1: 10.6, z0: 6.8, z1: 12.4 },
  /** Attendant booth shell. */
  booth: { x0: 7.0, x1: 9.8, z0: 7.7, z1: 10.7, h: 2.7 },
  /** Entrance canopy (inside the gate line so a raised arm never touches it). */
  canopy: { x0: -7.2, x1: 7.2, z0: 0.3, z1: 5.7, y: 3.5 },
  /** Small canopy over the ticket island (shelters the dispenser and the driver's window). */
  ticketCanopy: { x0: -6.55, x1: -3.95, z0: 7.45, z1: 9.95, y: 2.9 },
  /** Over-height detector ("headache bar") gantry on the approach, upstream of the ticket column. */
  gantryZ: 13.6,
  /** Upper deck (precast slab on columns) over the north stall row. */
  upperDeck: { x0: -9.4, x1: 9.4, z0: -17.2, z1: -9.9, y: 3.05 },
  /** Vehicle passage through the building in front of the plaza. */
  portal: { z0: 19.5, z1: 31, half: 5.2, h: 4.4 },
  streetZ: 38,
} as const;

/** Coarse occluders (tag chips hide behind them). */
export const SITE_OCCLUDERS: Array<[Vec3, Vec3]> = [
  [
    [-16, 4.4, SITE.portal.z0],
    [16, 14.6, SITE.portal.z1],
  ],
  [
    [-16, 0, SITE.portal.z0],
    [-SITE.portal.half, 4.4, SITE.portal.z1],
  ],
  [
    [SITE.portal.half, 0, SITE.portal.z0],
    [16, 4.4, SITE.portal.z1],
  ],
  [
    [13.6, 0, -16.8],
    [17.2, 7.4, -13.2],
  ],
];

const BUILDINGS: BuildingSpec[] = [
  // mixed-use building with the vehicle passage (wings + upper floors bridging the passage)
  { x0: -16, x1: -SITE.portal.half - 0.3, z0: SITE.portal.z0, z1: SITE.portal.z1, floors: 0, facade: 'brick', ground: 'store', hvac: 0, skip: 'E' },
  { x0: SITE.portal.half + 0.3, x1: 16, z0: SITE.portal.z0, z1: SITE.portal.z1, floors: 0, facade: 'brick', ground: 'store', hvac: 0, skip: 'W' },
  { x0: -SITE.portal.half - 0.3, x1: -SITE.portal.half, z0: SITE.portal.z0, z1: SITE.portal.z1, floors: 0, facade: 'blank', ground: 'blank', groundH: 4.4, skip: 'WNS' },
  { x0: SITE.portal.half, x1: SITE.portal.half + 0.3, z0: SITE.portal.z0, z1: SITE.portal.z1, floors: 0, facade: 'blank', ground: 'blank', groundH: 4.4, skip: 'ENS' },
  { x0: -16, x1: 16, z0: SITE.portal.z0, z1: SITE.portal.z1, y: 4.4, floors: 2, facade: 'brick', ground: 'brick', groundH: 3.4, hvac: 3 },
  // neighbours
  { x0: -34, x1: -20, z0: -26, z1: 4, floors: 4, facade: 'office', hvac: 2 },
  { x0: -34, x1: -18, z0: 8, z1: 30, floors: 2, facade: 'brickDark', hvac: 2 },
  { x0: 20, x1: 36, z0: -28, z1: -4, floors: 2, facade: 'precast', ground: 'precast', groundH: 3.2, hvac: 1 },
  { x0: 21, x1: 34, z0: -1, z1: 13, floors: 2, facade: 'stucco', hvac: 2 },
  { x0: -18, x1: 18, z0: -44, z1: -26, floors: 3, facade: 'brickDark', ground: 'brickDark', groundH: 3.3, hvac: 3 },
  // across the street
  { x0: -30, x1: -8, z0: 45, z1: 58, floors: 2, facade: 'stucco', hvac: 2 },
  { x0: -5, x1: 20, z0: 45, z1: 60, floors: 3, facade: 'office', hvac: 2 },
  // stair / elevator tower on the deck
  { x0: 13.6, x1: 17.2, z0: -16.8, z1: -13.2, floors: 1, facade: 'office', ground: 'office', groundH: 3.7 },
];

// ---------------------------------------------------------------------------
// Paint (lane arrows, legends) — one canvas atlas, one mesh per decal
// ---------------------------------------------------------------------------

type DecalKind = 'arrowUp' | 'enter' | 'exit' | 'stop' | 'arrowTurnL' | 'slow';

function decalTexture(kind: DecalKind) {
  return canvasTexture(`pg:decal:${kind}`, 256, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = kind === 'slow' ? '#f0b00e' : '#ecebe4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const arrow = (cx: number, top: number, len: number, headW: number, shaftW: number) => {
      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx + headW / 2, top + headW * 0.9);
      ctx.lineTo(cx + shaftW / 2, top + headW * 0.9);
      ctx.lineTo(cx + shaftW / 2, top + len);
      ctx.lineTo(cx - shaftW / 2, top + len);
      ctx.lineTo(cx - shaftW / 2, top + headW * 0.9);
      ctx.lineTo(cx - headW / 2, top + headW * 0.9);
      ctx.closePath();
      ctx.fill();
    };
    if (kind === 'arrowUp') arrow(w / 2, 20, h - 40, 170, 60);
    else if (kind === 'enter' || kind === 'exit' || kind === 'slow' || kind === 'stop') {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(1, 2.2); // elongated road legend (read from a low driver's eye)
      ctx.font = `800 ${kind === 'enter' ? 58 : 66}px ${FONT}`;
      ctx.fillText(kind === 'enter' ? 'ENTER' : kind === 'exit' ? 'EXIT' : kind === 'slow' ? 'SLOW' : 'STOP', 0, 0);
      ctx.restore();
    } else {
      // turn arrow (left)
      ctx.beginPath();
      ctx.moveTo(150, h - 20);
      ctx.lineTo(150, 220);
      ctx.quadraticCurveTo(150, 160, 90, 160);
      ctx.lineTo(90, 100);
      ctx.lineTo(10, 190);
      ctx.lineTo(90, 280);
      ctx.lineTo(90, 220);
      ctx.quadraticCurveTo(100, 220, 100, 240);
      ctx.lineTo(100, h - 20);
      ctx.closePath();
      ctx.fill();
    }
  });
}

function Decal({ kind, x, z, rotY = 0, size = [1.2, 2.4] }: { kind: DecalKind; x: number; z: number; rotY?: number; size?: [number, number] }) {
  const mat = kmat(
    `pg:decalMat:${kind}`,
    () =>
      new THREE.MeshStandardMaterial({
        map: decalTexture(kind),
        color: '#adaca5',
        transparent: true,
        depthWrite: false,
        roughness: 1,
        envMapIntensity: 0.35,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
  );
  return (
    <mesh position={[x, 0.004, z]} rotation={[-Math.PI / 2, 0, rotY]} material={mat}>
      <planeGeometry args={size} />
    </mesh>
  );
}

/** Painted stripes (thermoplastic) merged into one mesh per colour. */
function Stripes({ rects, color }: { rects: [number, number, number, number][]; color: string }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const [x0, z0, x1, z1] of rects) {
      const b = pos.length / 3;
      pos.push(x0, 0.003, z0, x0, 0.003, z1, x1, 0.003, z1, x1, 0.003, z0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [JSON.stringify(rects)]); // eslint-disable-line react-hooks/exhaustive-deps
  useDisposeOnUnmount(useMemo(() => [geo], [geo]));
  const mat = color === 'yellow' ? roadMats.yellow() : roadMats.white();
  return <mesh geometry={geo} material={mat} receiveShadow />;
}

// ---------------------------------------------------------------------------
// Deck, islands, walls
// ---------------------------------------------------------------------------

const concreteMat = () => kmat('pg:precast', () => new THREE.MeshStandardMaterial({ map: roadMats.curb().map, color: '#d6d1c6', roughness: 0.85 }));
const yellowCurbMat = () => kmat('pg:yellowCurb', () => new THREE.MeshStandardMaterial({ color: '#e7b416', roughness: 0.6 }));
const steelMat = () => kmat('pg:steel', () => new THREE.MeshStandardMaterial({ color: '#40505e', roughness: 0.45, metalness: 0.6 }));
const roofSteelMat = () => kmat('pg:roofSteel', () => new THREE.MeshStandardMaterial({ color: '#7d858c', roughness: 0.55, metalness: 0.45 }));

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): InstXf {
  return { p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], s: [x1 - x0, y1 - y0, z1 - z0] };
}

const unitBox = () => kgeo('pg:unitBox', () => new THREE.BoxGeometry(1, 1, 1));

function Islands() {
  const W = SITE.westIsland;
  const C = SITE.centerIsland;
  const E = SITE.eastIsland;
  const B = SITE.boothPad;
  const tops = [box(W.x0, 0, W.z0, W.x1, CURB, W.z1), box(C.x0, 0, C.z0, C.x1, CURB, C.z1), box(E.x0, 0, E.z0, E.x1, CURB, E.z1), box(B.x0, 0, B.z0, B.x1, CURB, B.z1)];
  // yellow painted curb noses (the ends facing traffic)
  const noses = [
    box(W.x0 - 0.01, 0, W.z1 - 0.3, W.x1 + 0.01, CURB + 0.004, W.z1 + 0.01),
    box(C.x0 - 0.01, 0, C.z1 - 0.3, C.x1 + 0.01, CURB + 0.004, C.z1 + 0.01),
    box(C.x0 - 0.01, 0, C.z0 - 0.01, C.x1 + 0.01, CURB + 0.004, C.z0 + 0.3),
    box(E.x0 - 0.01, 0, E.z0 - 0.01, E.x1 + 0.01, CURB + 0.004, E.z0 + 0.3),
  ];
  return (
    <group>
      <StaticInstances geometry={unitBox()} material={roadMats.curb()} items={tops} />
      <StaticInstances geometry={unitBox()} material={yellowCurbMat()} items={noses} castShadow={false} />
      <Bollards at={[[W.x1 - 0.35, W.z1 - 0.55], [C.x0 + 0.7, C.z1 - 0.55], [E.x1 - 0.35, E.z0 + 0.5], [B.x0 + 0.45, B.z1 - 0.45], [B.x1 - 0.45, B.z1 - 0.45]]} y={CURB} height={0.95} />
    </group>
  );
}

function DeckWalls() {
  const D = SITE.deck;
  const h = 1.1;
  const t = 0.3;
  const walls = [
    box(D.x0, 0, D.z0, D.x1, h, D.z0 + t), // north
    box(D.x0, 0, D.z0, D.x0 + t, h, D.z1 + t), // west
    box(D.x1 - t, 0, D.z0, D.x1, h, D.z1 + t), // east
    box(D.x0, 0, D.z1, SITE.westIsland.x0 - 0.3, h, D.z1 + t), // front, west part
    box(SITE.boothPad.x0 + 0.2, 0, D.z1, D.x1, h, D.z1 + t), // front, east part
  ];
  const caps = walls.map((w) => ({ p: [w.p[0], h + 0.03, w.p[2]] as Vec3, s: [w.s![0] + 0.06, 0.06, w.s![2] + 0.06] as Vec3 }));
  return (
    <group>
      <StaticInstances geometry={unitBox()} material={concreteMat()} items={walls} />
      <StaticInstances geometry={unitBox()} material={kmat('pg:cap', () => new THREE.MeshStandardMaterial({ color: '#b8b3a8', roughness: 0.7 }))} items={caps} castShadow={false} />
    </group>
  );
}

function Canopy() {
  const c = SITE.canopy;
  const cols: InstXf[] = [
    [-6.75, 0.8],
    [-6.75, 5.3],
    [0, 1.6],
    [0, 5.1],
    [6.75, 0.8],
    [6.75, 5.3],
  ].map(([x, z]) => ({ p: [x!, c.y / 2, z!], s: [0.2, c.y, 0.2] }));
  const beams: InstXf[] = [
    box(c.x0, c.y - 0.25, 0.7, c.x1, c.y, 0.9),
    box(c.x0, c.y - 0.25, 5.2, c.x1, c.y, 5.4),
    ...[-6.75, 0, 6.75].map((x) => box(x - 0.1, c.y - 0.25, c.z0, x + 0.1, c.y, c.z1)),
  ];
  const fascia = useMemo(() => {
    const tex = canvasTexture('pg:fascia', 2048, 128, (ctx, w, h) => {
      ctx.fillStyle = '#1f3f7a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, h - 10, w, 4);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = `800 78px ${FONT}`;
      ctx.fillText('ENTER ▲', w * 0.27, h / 2);
      ctx.fillText('▼ EXIT', w * 0.73, h / 2);
      // blue P discs
      for (const x of [w * 0.07, w * 0.93]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, h / 2, 48, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1f3f7a';
        ctx.font = `900 72px ${FONT}`;
        ctx.fillText('P', x, h / 2 + 3);
      }
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 });
  }, []);
  /** North face (read by drivers leaving the deck): the exit lane is on their left, the entry lane is wrong-way. */
  const fasciaN = useMemo(() => {
    const tex = canvasTexture('pg:fasciaN', 2048, 128, (ctx, w, h) => {
      ctx.fillStyle = '#1f3f7a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, h - 10, w, 4);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.font = `800 78px ${FONT}`;
      ctx.fillText('EXIT ▲  PAY ON FOOT', w * 0.3, h / 2);
      // do-not-enter disc over the entry lane
      const x = w * 0.72;
      ctx.fillStyle = '#c8102e';
      ctx.beginPath();
      ctx.arc(x, h / 2, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 34, h / 2 - 9, 68, 18);
      ctx.font = `800 64px ${FONT}`;
      ctx.fillText('NO ENTRY', w * 0.86, h / 2);
    });
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 });
  }, []);
  useDisposeOnUnmount(useMemo(() => [fascia, fasciaN], [fascia, fasciaN]));
  const fw = c.x1 - c.x0;
  return (
    <group>
      <StaticInstances geometry={unitBox()} material={steelMat()} items={[...cols, ...beams]} />
      <mesh position={[0, c.y + 0.12, (c.z0 + c.z1) / 2]} material={roofSteelMat()} castShadow receiveShadow>
        <boxGeometry args={[fw + 0.4, 0.22, c.z1 - c.z0 + 0.3]} />
      </mesh>
      <mesh position={[0, c.y + 0.12, c.z1 + 0.16]} material={fascia}>
        <planeGeometry args={[fw + 0.4, 0.46]} />
      </mesh>
      <mesh position={[0, c.y + 0.12, c.z0 - 0.16]} rotation={[0, Math.PI, 0]} material={fasciaN}>
        <planeGeometry args={[fw + 0.4, 0.46]} />
      </mesh>
      {[c.z1 + 0.15, c.z0 - 0.15].map((z) => (
        <mesh key={z} position={[0, c.y + 0.12, z]} material={roofSteelMat()}>
          <boxGeometry args={[fw + 0.4, 0.46, 0.012]} />
        </mesh>
      ))}
      {/* LED downlights under the canopy */}
      <StaticInstances
        geometry={kgeo('pg:downlight', () => new THREE.CylinderGeometry(0.12, 0.12, 0.03, 16))}
        material={kmat('pg:downlightMat', () => new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff4dc', emissiveIntensity: 1.2, toneMapped: false }))}
        items={[-4.5, -2.5, 2.5, 4.5].flatMap((x) => [1.9, 4.0].map((z) => ({ p: [x, c.y - 0.02, z] as Vec3 })))}
        castShadow={false}
      />
    </group>
  );
}

function Markings() {
  const aisle = Y.aisleZ;
  const white: [number, number, number, number][] = [
    // stop bars: entry (before the gate) and exit (inside, before the exit gate)
    [Y.entryLaneX - 1.65, Y.entryWaitZ - 2.2 - 0.05, Y.entryLaneX + 1.65, Y.entryWaitZ - 2.2 + 0.4],
    [Y.exitLaneX - 1.65, Y.exitWaitZ + 2.2 - 0.4, Y.exitLaneX + 1.65, Y.exitWaitZ + 2.2 + 0.05],
    // lane edge lines on the approach
    [-4.35, 11.6, -4.25, SITE.portal.z0 - 1.6],
    [4.25, 8.0, 4.35, SITE.portal.z0 - 1.6],
    // crosswalk bars in front of the passage
    ...Array.from({ length: 7 }, (_, i): [number, number, number, number] => {
      const x = -4.2 + i * 1.4;
      return [x, SITE.portal.z0 - 1.5, x + 0.6, SITE.portal.z0 - 0.2];
    }),
  ];
  const yellow: [number, number, number, number][] = [
    // median hatch between the lanes on the approach
    [-0.72, 12.4, -0.62, SITE.portal.z0 - 1.6],
    [0.62, 12.4, 0.72, SITE.portal.z0 - 1.6],
    ...Array.from({ length: 5 }, (_, i): [number, number, number, number] => [-0.62, 12.9 + i * 0.9, 0.62, 13.05 + i * 0.9]),
    // dashed centre line of the drive aisle
    ...Array.from({ length: 10 }, (_, i): [number, number, number, number] => {
      const x = -15 + i * 3.2;
      return [x, aisle - 0.05, x + 1.6, aisle + 0.05];
    }),
  ];
  return (
    <group>
      <Stripes rects={white} color="white" />
      <Stripes rects={yellow} color="yellow" />
      <Decal kind="enter" x={Y.entryLaneX} z={14.2} size={[1.6, 2.6]} />
      <Decal kind="arrowUp" x={Y.entryLaneX} z={16.8} size={[1.0, 2.2]} />
      <Decal kind="exit" x={Y.exitLaneX} z={13.4} rotY={Math.PI} size={[1.6, 2.6]} />
      <Decal kind="arrowUp" x={Y.exitLaneX} z={10.4} rotY={Math.PI} size={[1.0, 2.2]} />
      <Decal kind="arrowUp" x={Y.exitLaneX} z={-3.2} rotY={Math.PI} size={[1.0, 2.2]} />
      <Decal kind="arrowUp" x={Y.entryLaneX} z={-2.6} size={[1.0, 2.2]} />
      <Decal kind="slow" x={-10} z={aisle + 0.9} rotY={Math.PI / 2} size={[1.2, 2.2]} />
      <Decal kind="arrowTurnL" x={-14.8} z={aisle + 1.0} rotY={Math.PI / 2} size={[1.2, 2.4]} />
    </group>
  );
}

function Stalls() {
  // (the kit's stall lines + numbers are matte road paint at the source)
  return (
    <group>
      {Y.spaces.map((sp, i) => {
        const row = sp.row;
        const neighbourLeft = Y.spaces.some((o) => o.row === row && Math.abs(o.x - (sp.x - Y.stallWidth)) < 0.01);
        return (
          <ParkingSpace
            key={i}
            number={i + 1}
            position={[sp.x, 0, sp.z]}
            rotation={[0, sp.yaw, 0]}
            width={Y.stallWidth}
            depth={Y.stallDepth}
            // paint both side lines at row ends, otherwise share the neighbour's line
            sides={neighbourLeft ? (row === 'N' ? 'right' : 'left') : 'both'}
            lineColor="white"
          />
        );
      })}
    </group>
  );
}

/** Soffit, walls and lights of the vehicle passage (the part of the building above the lanes). */
function Passage() {
  const P = SITE.portal;
  const len = P.z1 - P.z0;
  const soffit = kmat('pg:soffit', () => new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.9 }));
  return (
    <group>
      <mesh position={[0, P.h - 0.01, (P.z0 + P.z1) / 2]} rotation={[Math.PI / 2, 0, 0]} material={soffit}>
        <planeGeometry args={[2 * P.half + 0.6, len]} />
      </mesh>
      <StaticInstances
        geometry={kgeo('pg:passLight', () => new THREE.BoxGeometry(1.2, 0.06, 0.25))}
        material={kmat('pg:passLightMat', () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1d6', emissiveIntensity: 1.6, toneMapped: false }))}
        items={[-2.5, 2.5].flatMap((x) => [22, 25.5, 29].map((z) => ({ p: [x, P.h - 0.05, z] as Vec3 })))}
        castShadow={false}
      />
      {/* building sidewalk in front of the passage */}
      <GroundSlab size={[2 * 16, 1.5]} kind="sidewalk" thickness={CURB} position={[0, 0, P.z0 - 0.76]} />
    </group>
  );
}

/** Small canopy over the ticket island: two steel posts, a flat roof with a downlight over the dispenser. */
function TicketCanopy() {
  const t = SITE.ticketCanopy;
  const posts: InstXf[] = [
    [-6.2, 7.7],
    [-6.2, 9.7],
  ].map(([x, z]) => ({ p: [x!, (CURB + t.y) / 2, z!], s: [0.14, t.y - CURB, 0.14] }));
  return (
    <group>
      <StaticInstances geometry={unitBox()} material={steelMat()} items={posts} />
      <mesh position={[(t.x0 + t.x1) / 2, t.y + 0.08, (t.z0 + t.z1) / 2]} material={roofSteelMat()} castShadow receiveShadow>
        <boxGeometry args={[t.x1 - t.x0, 0.16, t.z1 - t.z0]} />
      </mesh>
      <mesh position={[t.x1 + 0.005, t.y + 0.08, (t.z0 + t.z1) / 2]} rotation={[0, Math.PI / 2, 0]} material={kmat('pg:ticketFascia', () => new THREE.MeshStandardMaterial({ color: '#1f3f7a', roughness: 0.5 }))}>
        <planeGeometry args={[t.z1 - t.z0, 0.16]} />
      </mesh>
      <mesh position={[-5.1, t.y - 0.005, 8.7]} rotation={[Math.PI / 2, 0, 0]} material={kmat('pg:downlightMat', () => new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff4dc', emissiveIntensity: 1.2, toneMapped: false }))}>
        <circleGeometry args={[0.14, 20]} />
      </mesh>
    </group>
  );
}

/** Over-height gantry on the approach: posts on the lane edges, crossbeam and the swinging clearance bar. */
function HeadacheGantry() {
  const z = SITE.gantryZ;
  const x0 = Y.entryLaneX - Y.laneWidth / 2 - 0.35;
  const x1 = Y.entryLaneX + Y.laneWidth / 2 + 0.35;
  const h = 3.0;
  const items: InstXf[] = [
    { p: [x0, h / 2, z], s: [0.12, h, 0.12] },
    { p: [x1, h / 2, z], s: [0.12, h, 0.12] },
    { p: [(x0 + x1) / 2, h + 0.07, z], s: [x1 - x0 + 0.2, 0.14, 0.12] },
  ];
  // galvanized/dark steel frame; only the hanging bar is striped (it is what drivers must see)
  const bands: InstXf[] = [0.4, 0.9, 1.4].flatMap((y) => [x0, x1].map((x) => ({ p: [x, y, z] as Vec3, s: [0.125, 0.18, 0.125] as Vec3 })));
  return (
    <group>
      <StaticInstances geometry={unitBox()} material={steelMat()} items={items} />
      <StaticInstances geometry={unitBox()} material={kmat('pg:gantryBand', () => new THREE.MeshStandardMaterial({ color: '#e7b416', roughness: 0.55 }))} items={bands} castShadow={false} />
      <ClearanceBar position={[Y.entryLaneX, 0, z]} width={Y.laneWidth - 0.1} mountHeight={h} />
    </group>
  );
}

/**
 * Upper parking level over the north stall row: precast slab (hollow-core look from below) on round
 * columns, a spandrel beam with the level-2 parapet, and LED fixtures under the slab.
 */
function UpperDeck() {
  const u = SITE.upperDeck;
  const t = 0.35;
  const cols: InstXf[] = [
    [u.x0 + 0.3, u.z1 - 0.35],
    [u.x1 - 0.3, u.z1 - 0.35],
    [u.x0 + 0.3, u.z0 + 0.6],
    [0, u.z0 + 0.6],
    [u.x1 - 0.3, u.z0 + 0.6],
  ].map(([x, z]) => ({ p: [x!, u.y / 2, z!], s: [1, u.y, 1] }));
  const beams: InstXf[] = [
    // spandrel beam along the front edge + level-2 parapet above it
    box(u.x0, u.y - 0.55, u.z1 - 0.4, u.x1, u.y, u.z1),
    box(u.x0, u.y + t, u.z1 - 0.25, u.x1, u.y + t + 1.0, u.z1),
    box(u.x0, u.y + t, u.z0, u.x0 + 0.25, u.y + t + 1.0, u.z1),
    box(u.x1 - 0.25, u.y + t, u.z0, u.x1, u.y + t + 1.0, u.z1),
  ];
  const slab = box(u.x0, u.y, u.z0, u.x1, u.y + t, u.z1);
  return (
    <group>
      <StaticInstances geometry={kgeo('pg:column', () => new THREE.CylinderGeometry(0.24, 0.24, 1, 20).translate(0, 0, 0))} material={concreteMat()} items={cols} />
      <StaticInstances geometry={unitBox()} material={concreteMat()} items={[slab, ...beams]} />
      {/* soffit joints (double-tee stems) */}
      <StaticInstances
        geometry={unitBox()}
        material={kmat('pg:soffitStem', () => new THREE.MeshStandardMaterial({ color: '#a9a498', roughness: 0.85 }))}
        items={[-6.2, -3.1, 0, 3.1, 6.2].map((x) => box(x - 0.1, u.y - 0.32, u.z0 + 0.3, x + 0.1, u.y, u.z1 - 0.4))}
        castShadow={false}
      />
      <StaticInstances
        geometry={kgeo('pg:deckLight', () => new THREE.BoxGeometry(1.2, 0.05, 0.16))}
        material={kmat('pg:passLightMat', () => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1d6', emissiveIntensity: 1.6, toneMapped: false }))}
        items={[-4.65, -1.55, 1.55, 4.65].flatMap((x) => [-12.2, -15.2].map((z) => ({ p: [x, u.y - 0.03, z] as Vec3 })))}
        castShadow={false}
      />
      {/* level-2 edge sign */}
      <mesh position={[0, u.y - 0.28, u.z1 + 0.003]} material={kmat('pg:levelSign', () => new THREE.MeshStandardMaterial({ map: levelTexture(), roughness: 0.55 }))}>
        <planeGeometry args={[2.4, 0.4]} />
      </mesh>
    </group>
  );
}

function levelTexture() {
  return canvasTexture('pg:level', 512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#1f3f7a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 52px ${FONT}`;
    ctx.fillText('LEVEL 1 · CLEARANCE 2.4 m', w / 2, h / 2 + 2);
  });
}

const TREES = [
  ...[8.4, 14.6].map((z) => ({ x: -14.9, z, y: CURB, s: 0.9 })),
  ...[9.2, 15.8].map((z) => ({ x: 14.9, z, y: CURB, s: 0.85 })),
  ...[-12, -4, 4, 12].map((x) => ({ x, z: -19.6, s: 1.1 })),
  { x: 19, z: -1, s: 1 },
  { x: -19, z: 5.5, s: 1 },
  ...[-26, -14, 14, 26].map((x) => ({ x, z: 43.2, y: CURB, s: 0.9 })),
];

/** Everything static on the site. */
export const GarageSite = memo(function GarageSite() {
  const D = SITE.deck;
  const Pz = SITE.plaza;
  return (
    <group>
      <SkyDome />
      <GroundPlane />
      {/* deck slab and plaza */}
      <GroundSlab size={[D.x1 - D.x0, D.z1 - D.z0]} kind="concrete" position={[(D.x0 + D.x1) / 2, 0.001, (D.z0 + D.z1) / 2]} />
      <GroundSlab size={[Pz.x1 - Pz.x0 + 6, SITE.streetZ - 6.5 - Pz.z0]} kind="asphalt" position={[0, 0.001, (Pz.z0 + SITE.streetZ - 6.5) / 2]} />
      {/* planting strips and walks on both sides of the plaza */}
      <GroundSlab size={[3.2, SITE.portal.z0 - Pz.z0 - 1.5]} kind="sidewalk" thickness={CURB} position={[-14.6, 0, (Pz.z0 + SITE.portal.z0 - 1.5) / 2]} />
      <GroundSlab size={[3.2, SITE.portal.z0 - Pz.z0 - 1.5]} kind="sidewalk" thickness={CURB} position={[14.6, 0, (Pz.z0 + SITE.portal.z0 - 1.5) / 2]} />
      <RoadSegment length={140} position={[0, 0, SITE.streetZ]} sidewalkWidth={3} />
      <DeckWalls />
      <Islands />
      <Canopy />
      <TicketCanopy />
      <HeadacheGantry />
      <UpperDeck />
      <Markings />
      <Stalls />
      <Passage />
      <Buildings specs={BUILDINGS} />
      <Trees items={TREES} />
      <StreetLights
        items={[
          { x: -17.3, z: -8, angle: 0, height: 7 },
          { x: 17.3, z: -8, angle: Math.PI, height: 7 },
          { x: 0, z: -17.0, angle: -Math.PI / 2, height: 7 },
          { x: -14.4, z: 17.6, y: CURB, angle: 0, height: 7 },
          { x: 15.0, z: 7.4, y: CURB, angle: Math.PI, height: 7 },
        ]}
      />
      <PullBoxes
        text={'PARKING\nCONTROLS'}
        items={[
          { x: -5.45, z: 10.9, y: CURB, angle: 0 },
          { x: 5.45, z: 1.2, y: CURB, angle: 0 },
          { x: 9.9, z: 11.9, y: CURB, angle: Math.PI / 2 },
        ]}
      />
    </group>
  );
});
