/**
 * Factory floor bay around the motor station: sealed concrete floor with painted aisle / machine-guard
 * lines and hatched keep-clear zones, painted block walls with the upstream conveyor opening (strip
 * curtain), steel columns, roof purlins, LED high-bays, overhead ladder cable tray on wall brackets and
 * trapeze hangers, a pallet rack, discharge gaylord, safety signage and small props. Static.
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { Boxes, type BoxState } from '../../../twin/devices';
import {
  FONT,
  Instances,
  KBOX,
  KCYL,
  KPLANE,
  LadderTray,
  SignPlate,
  Slab,
  TexturedFloor,
  TexturedWall,
  blockWallTexture,
  canvasTexture,
  concreteTexture,
  drawSafetySign,
  fitFont,
  hazardTexture,
  kmat,
  km,
  repeatedTexture,
} from '../trainer/kit';
import { BAY, BIN, CABINET, CONV, OPENING, TRAY } from './layout';

const WALL_LOW = '#6f7f8c';
const WALL_HIGH = '#d7d8d3';
const YELLOW = '#f2c200';

function Walls() {
  const tex = blockWallTexture();
  const { wallZ, leftX, rightX, frontZ, height } = BAY;
  const dado = 1.2;
  const w = rightX - leftX;
  const pieces = useMemo(() => {
    // back wall split around the opening (lower band + upper band)
    const out: { x0: number; x1: number; y0: number; y1: number; color: string }[] = [];
    const bands: [number, number, string][] = [
      [0, dado, WALL_LOW],
      [dado, height, WALL_HIGH],
    ];
    for (const [y0, y1, color] of bands) {
      if (y0 < OPENING.y1) {
        out.push({ x0: leftX, x1: OPENING.x0, y0, y1, color });
        out.push({ x0: OPENING.x1, x1: rightX, y0, y1, color });
        const top = Math.min(y1, OPENING.y1);
        if (y1 > OPENING.y1) out.push({ x0: OPENING.x0, x1: OPENING.x1, y0: top, y1, color });
      } else out.push({ x0: leftX, x1: rightX, y0, y1, color });
    }
    return out;
  }, [dado, height, leftX, rightX]);
  return (
    <group>
      {pieces.map((p, i) => (
        <TexturedWall key={i} position={[(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, wallZ]} size={[p.x1 - p.x0, p.y1 - p.y0]} texture={tex} tile={[4, 2]} color={p.color} />
      ))}
      {/* yellow dado line */}
      <Slab min={[leftX, dado - 0.03, wallZ]} max={[OPENING.x0, dado + 0.03, wallZ + 0.004]} material={km.paint(YELLOW, 0.6)} receiveShadow={false} />
      <Slab min={[OPENING.x1, dado - 0.03, wallZ]} max={[rightX, dado + 0.03, wallZ + 0.004]} material={km.paint(YELLOW, 0.6)} receiveShadow={false} />
      {/* opening reveal + steel angle frame, dark void behind, strip curtain */}
      <Slab min={[OPENING.x0 - 0.05, OPENING.y1, wallZ - BAY.wallT]} max={[OPENING.x1 + 0.05, OPENING.y1 + 0.05, wallZ + 0.01]} material={km.paint('#3b3f44', 0.5, 0.5)} castShadow />
      <Slab min={[OPENING.x0 - 0.05, 0, wallZ - BAY.wallT]} max={[OPENING.x0, OPENING.y1, wallZ + 0.01]} material={km.paint('#3b3f44', 0.5, 0.5)} />
      <Slab min={[OPENING.x1, 0, wallZ - BAY.wallT]} max={[OPENING.x1 + 0.05, OPENING.y1, wallZ + 0.01]} material={km.paint('#3b3f44', 0.5, 0.5)} />
      <mesh geometry={KPLANE()} material={km.basic('#07090b')} position={[0, OPENING.y1 / 2, wallZ - BAY.wallT - 0.02]} scale={[OPENING.x1 - OPENING.x0 + 0.1, OPENING.y1 + 0.05, 1]} />
      <StripCurtain />
      {/* left wall */}
      <TexturedWall position={[leftX, dado / 2, (wallZ + frontZ) / 2]} rotation={[0, Math.PI / 2, 0]} size={[frontZ - wallZ, dado]} texture={tex} tile={[4, 2]} color={WALL_LOW} />
      <TexturedWall position={[leftX, (dado + height) / 2, (wallZ + frontZ) / 2]} rotation={[0, Math.PI / 2, 0]} size={[frontZ - wallZ, height - dado]} texture={tex} tile={[4, 2]} color={WALL_HIGH} />
      {/* floor */}
      <TexturedFloor center={[(leftX + rightX) / 2, (wallZ + frontZ) / 2]} size={[w, frontZ - wallZ]} texture={concreteTexture()} tile={4} roughness={0.72} color="#d8d6d0" />
    </group>
  );
}

function StripCurtain() {
  const items = useMemo(() => {
    const out: { p: Vec3; s: Vec3; r: Vec3 }[] = [];
    const n = 9;
    const w = (OPENING.x1 - OPENING.x0) / n;
    for (let i = 0; i < n; i++) out.push({ p: [OPENING.x0 + w * (i + 0.5), OPENING.y1 - 0.3, BAY.wallZ - 0.03], s: [w * 1.12, 0.6, 0.003], r: [0, (i % 2 ? 1 : -1) * 0.03, 0] });
    return out;
  }, []);
  const mat = kmat('ms:strip', () => new THREE.MeshStandardMaterial({ color: '#a9c4d6', roughness: 0.2, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
  return (
    <group>
      <Instances geometry={KBOX()} material={mat} items={items} castShadow={false} receiveShadow={false} />
      <Slab min={[OPENING.x0, OPENING.y1 - 0.02, BAY.wallZ - 0.04]} max={[OPENING.x1, OPENING.y1, BAY.wallZ - 0.02]} material={km.metal('#b9bec2', 0.4)} />
    </group>
  );
}

/** Painted floor lines and hatched zones (decals slightly above the floor). */
function FloorMarkings() {
  const yellow = kmat('ms:floor-yellow', () => new THREE.MeshStandardMaterial({ color: '#e8b800', roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 }));
  const line = (x0: number, z0: number, x1: number, z1: number, w = 0.08) => ({
    p: [(x0 + x1) / 2, 0.002, (z0 + z1) / 2] as Vec3,
    s: [Math.max(Math.abs(x1 - x0), w), 0.001, Math.max(Math.abs(z1 - z0), w)] as Vec3,
  });
  const lines = useMemo(
    () => [
      // machine guard boundary around conveyor, drive and bin
      line(-0.8, -2.86, -0.8, 1.1),
      line(-0.8, 1.1, 1.3, 1.1),
      line(1.3, -2.86, 1.3, 1.1),
      // aisle
      line(BAY.leftX + 0.3, 1.8, BAY.rightX - 1.8, 1.8, 0.1),
      line(BAY.leftX + 0.3, 3.4, BAY.rightX - 1.8, 3.4, 0.1),
    ],
    [],
  );
  const hatch = (key: string, x0: number, z0: number, x1: number, z1: number) => {
    const t = repeatedTexture(hazardTexture(), (x1 - x0) / 0.4, 1);
    const m = kmat(`ms:hatch:${key}`, () => new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1 }));
    return <mesh geometry={KPLANE()} material={m} rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, 0.0025, (z0 + z1) / 2]} scale={[x1 - x0, z1 - z0, 1]} receiveShadow />;
  };
  return (
    <group>
      <Instances geometry={KBOX()} material={yellow} items={lines} castShadow={false} />
      {/* NEC working clearance in front of the control panel */}
      {hatch('panel-front', CABINET.pos[0] - 0.5, BAY.wallZ + 0.01, CABINET.pos[0] - 0.5 + 0.12, BAY.wallZ + 0.95)}
      {hatch('panel-front-b', CABINET.pos[0] + 0.38, BAY.wallZ + 0.01, CABINET.pos[0] + 0.5, BAY.wallZ + 0.95)}
      {hatch('panel-front-c', CABINET.pos[0] - 0.5, BAY.wallZ + 0.83, CABINET.pos[0] + 0.5, BAY.wallZ + 0.95)}
      <SignPlate
        id="keep-clear"
        size={[0.7, 0.16]}
        position={[CABINET.pos[0], 0.004, BAY.wallZ + 0.62]}
        rotation={[-Math.PI / 2, 0, 0]}
        thickness={0.0005}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#e8b800';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#111';
          ctx.font = `900 ${h * 0.6}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('KEEP CLEAR 36"', w / 2, h / 2 + 2);
        }}
      />
    </group>
  );
}

/** Painted steel I-columns with yellow column guards (instanced: 3 draw calls for all columns). */
function IColumns({ xs }: { xs: number[] }) {
  const z = BAY.wallZ + 0.16;
  const H = BAY.height;
  const box = (min: Vec3, max: Vec3) => ({ p: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as Vec3, s: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as Vec3 });
  const parts = useMemo(() => {
    const steel: { p: Vec3; s: Vec3 }[] = [];
    const guard: { p: Vec3; s: Vec3 }[] = [];
    const bands: { p: Vec3; s: Vec3 }[] = [];
    for (const x of xs) {
      steel.push(box([x - 0.15, 0, z - 0.14], [x + 0.15, H, z - 0.12]), box([x - 0.15, 0, z + 0.12], [x + 0.15, H, z + 0.14]), box([x - 0.008, 0, z - 0.12], [x + 0.008, H, z + 0.12]));
      guard.push(box([x - 0.19, 0, z - 0.18], [x + 0.19, 1.1, z + 0.18]));
      bands.push(box([x - 0.2, 0.2, z - 0.19], [x + 0.2, 0.3, z + 0.19]), box([x - 0.2, 0.7, z - 0.19], [x + 0.2, 0.8, z + 0.19]));
    }
    return { steel, guard, bands };
  }, [xs.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <Instances geometry={KBOX()} material={km.paint('#4d6a86', 0.5, 0.4)} items={parts.steel} />
      <Instances geometry={KBOX()} material={kmat('ms:colguard', () => new THREE.MeshStandardMaterial({ color: YELLOW, roughness: 0.45, metalness: 0.3 }))} items={parts.guard} />
      <Instances geometry={KBOX()} material={km.paint('#161616', 0.5)} items={parts.bands} castShadow={false} />
    </group>
  );
}

const LIGHTS: [number, number][] = [
  [-1.6, 0.2],
  [1.2, 0.2],
  [-1.6, 2.6],
  [1.2, 2.6],
];

function RoofAndLights() {
  const purlins = useMemo(() => [-1.6, 0.2, 2.0, 3.8].map((z) => ({ p: [(BAY.leftX + BAY.rightX) / 2, BAY.height - 0.15, z] as Vec3, s: [BAY.rightX - BAY.leftX, 0.3, 0.12] as Vec3 })), []);
  return (
    <group>
      <Instances geometry={KBOX()} material={km.paint('#5a6570', 0.6, 0.4)} items={purlins} castShadow={false} />
      <mesh geometry={KPLANE()} material={km.paint('#3e464e', 0.9)} rotation={[Math.PI / 2, 0, 0]} position={[(BAY.leftX + BAY.rightX) / 2, BAY.height, (BAY.wallZ + BAY.frontZ) / 2]} scale={[BAY.rightX - BAY.leftX, BAY.frontZ - BAY.wallZ, 1]} />
      <Instances geometry={KCYL()} material={km.metal('#9aa0a6', 0.4)} items={LIGHTS.map(([x, z]) => ({ p: [x, BAY.height - 0.5, z] as Vec3, s: [0.01, 0.7, 0.01] as Vec3 }))} castShadow={false} />
      <Instances geometry={KCYL()} material={km.paint('#2b2f33', 0.5, 0.6)} items={LIGHTS.map(([x, z]) => ({ p: [x, BAY.height - 1.0, z] as Vec3, s: [0.42, 0.08, 0.42] as Vec3 }))} castShadow={false} />
      <Instances geometry={KCYL()} material={km.emissive('#f6f8ff', 2.2)} items={LIGHTS.map(([x, z]) => ({ p: [x, BAY.height - 1.042, z] as Vec3, s: [0.36, 0.01, 0.36] as Vec3 }))} castShadow={false} receiveShadow={false} />
    </group>
  );
}

/** Wall brackets + trapeze hangers for the ladder tray, plus the trays themselves. */
function CableTrays() {
  const strut = km.paint('#c9ccce', 0.5, 0.6);
  const brackets = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (let x = TRAY.x0 + 0.3; x < TRAY.x1; x += 1.2) out.push({ p: [x, TRAY.y - 0.022, BAY.wallZ + 0.18], s: [0.042, 0.042, 0.36] });
    return out;
  }, []);
  const rods = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (const z of [-1.6, -0.2, 1.0]) for (const s of [-1, 1]) out.push({ p: [TRAY.runX + s * 0.2, (TRAY.y + BAY.height) / 2, z], s: [0.012, BAY.height - TRAY.y, 0.012] });
    return out;
  }, []);
  const trapeze = useMemo(() => [-1.6, -0.2, 1.0].map((z) => ({ p: [TRAY.runX, TRAY.y - 0.022, z] as Vec3, s: [0.46, 0.042, 0.042] as Vec3 })), []);
  return (
    <group>
      <LadderTray start={[TRAY.x0, TRAY.y, TRAY.wallZ]} length={TRAY.x1 - TRAY.x0} axis="x" width={TRAY.width} cables={['#1b1c1e', '#44484d', '#1b1c1e', '#8a8f94']} />
      <LadderTray start={[TRAY.runX, TRAY.y, TRAY.wallZ + TRAY.width / 2]} length={TRAY.z1 - TRAY.wallZ - TRAY.width / 2} axis="z" width={TRAY.width} cables={['#1b1c1e', '#44484d']} />
      <Instances geometry={KBOX()} material={strut} items={brackets} />
      <Instances geometry={KCYL()} material={km.metal('#b0b5b9', 0.4)} items={rods} castShadow={false} />
      <Instances geometry={KBOX()} material={strut} items={trapeze} />
    </group>
  );
}

/** Selective pallet rack along the right side (context). */
function PalletRack() {
  const x0 = 3.6;
  const x1 = 4.7;
  const zs = [-2.7, -0.5];
  const levels = [0.12, 1.45, 2.8];
  const uprights = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (const x of [x0, x1]) for (const z of zs) out.push({ p: [x, 1.8, z], s: [0.08, 3.6, 0.08] });
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const beams = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (const x of [x0, x1]) for (const y of levels) for (let i = 0; i < zs.length - 1; i++) out.push({ p: [x, y + 0.06, (zs[i]! + zs[i + 1]!) / 2], s: [0.05, 0.12, zs[i + 1]! - zs[i]!] });
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pallets = useMemo(() => {
    const out: { p: Vec3; s: Vec3 }[] = [];
    for (const y of levels) for (let i = 0; i < zs.length - 1; i++) for (const k of [0.25, 0.75]) out.push({ p: [(x0 + x1) / 2, y + 0.19, zs[i]! + (zs[i + 1]! - zs[i]!) * k], s: [1.0, 0.13, 0.95] });
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const boxes = useMemo<BoxState[]>(() => {
    const out: BoxState[] = [];
    let id = 100;
    for (const p of pallets) {
      const tall = (id & 1) === 0;
      const h = tall ? 0.35 : 0.2;
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++)
          for (let c = 0; c < (tall ? 2 : 3); c++) out.push({ x: p.p[0] - 0.32 + a * 0.32, y: p.p[1] + 0.065 + c * h, z: p.p[2] - 0.3 + b * 0.3, rotY: Math.PI / 2, tall, id: id++ });
    }
    return out;
  }, [pallets]);
  return (
    <group>
      <Instances geometry={KBOX()} material={km.paint('#1f4f9c', 0.45, 0.4)} items={uprights} />
      <Instances geometry={KBOX()} material={km.paint('#e35d12', 0.45, 0.4)} items={beams} />
      <Instances geometry={KBOX()} material={km.paint('#a4865e', 0.85)} items={pallets} />
      <Boxes getBoxes={() => boxes} maxCount={260} />
    </group>
  );
}

/** Gaylord (bulk box) on a pallet catching the boxes from the head end. */
function DischargeBin() {
  const { x, z, w, d, h, pallet } = BIN;
  const kraft = km.paint('#b48a5a', 0.9);
  const inner = kmat('ms:kraft-in', () => new THREE.MeshStandardMaterial({ color: '#8f6c45', roughness: 0.95, side: THREE.DoubleSide }));
  const y0 = pallet;
  const piled = useMemo<BoxState[]>(
    () => [
      { x: x - 0.15, y: y0 + h - 0.31, z: z - 0.1, rotY: 0.4, tall: false, id: 1 },
      { x: x + 0.18, y: y0 + h - 0.34, z: z + 0.12, rotY: -0.3, rotZ: 0.2, tall: false, id: 2 },
      { x: x + 0.05, y: y0 + h - 0.38, z: z - 0.18, rotY: 1.2, tall: true, id: 3 },
    ],
    [x, y0, h, z],
  );
  return (
    <group>
      <Slab min={[x - w / 2, 0, z - d / 2]} max={[x + w / 2, pallet, z + d / 2]} material={km.paint('#a4865e', 0.85)} castShadow />
      {[
        [x, y0 + h / 2, z - d / 2, w, 0.008],
        [x, y0 + h / 2, z + d / 2, w, 0.008],
      ].map(([px, py, pz, sx, sz], i) => (
        <mesh key={i} geometry={KBOX()} material={kraft} position={[px!, py!, pz!]} scale={[sx!, h, sz!]} castShadow receiveShadow />
      ))}
      {[x - w / 2, x + w / 2].map((px) => (
        <mesh key={px} geometry={KBOX()} material={kraft} position={[px, y0 + h / 2, z]} scale={[0.008, h, d]} castShadow receiveShadow />
      ))}
      <mesh geometry={KPLANE()} material={inner} rotation={[-Math.PI / 2, 0, 0]} position={[x, y0 + h - 0.36, z]} scale={[w - 0.02, d - 0.02, 1]} />
      <Boxes getBoxes={() => piled} maxCount={4} />
      <SignPlate
        id="bin-label"
        size={[0.22, 0.12]}
        position={[x + 0.2, y0 + h * 0.6, z + d / 2 + 0.005]}
        draw={(ctx, ww, hh) => {
          ctx.fillStyle = '#fbfaf5';
          ctx.fillRect(0, 0, ww, hh);
          ctx.fillStyle = '#111';
          ctx.font = `800 ${hh * 0.3}px ${FONT}`;
          ctx.fillText('LINE 2  ·  OUTFEED', 12, hh * 0.38);
          ctx.font = `600 ${hh * 0.22}px ${FONT}`;
          ctx.fillText('BIN 07 · 1 of 3', 12, hh * 0.75);
        }}
      />
    </group>
  );
}

function FireExtinguisher({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh geometry={KCYL()} material={km.paint('#c8102e', 0.35, 0.3)} scale={[0.15, 0.45, 0.15]} position={[0, 0.225, 0]} castShadow />
      <mesh geometry={KCYL()} material={km.metal('#222', 0.4)} scale={[0.05, 0.08, 0.05]} position={[0, 0.49, 0]} />
      <mesh geometry={KBOX()} material={km.label(extinguisherLabel(), 0.5)} scale={[0.1, 0.14, 0.002]} position={[0, 0.25, 0.076]} />
    </group>
  );
}

function extinguisherLabel() {
  return canvasTexture('ms-ext-label', 128, 180, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    ctx.font = `800 22px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('ABC', w / 2, 40);
    ctx.font = `600 14px ${FONT}`;
    ctx.fillText('DRY CHEMICAL', w / 2, 70);
    ctx.fillText('10 LB', w / 2, 95);
  });
}

export function MotorBay() {
  return (
    <group>
      <Walls />
      <FloorMarkings />
      <IColumns xs={[-3.45, 2.75]} />
      <RoofAndLights />
      <CableTrays />
      <PalletRack />
      <DischargeBin />
      <group position={[-3.45, 0.9, BAY.wallZ + 0.36]}>
        <mesh geometry={KBOX()} material={km.paint('#c8102e', 0.5)} scale={[0.26, 0.3, 0.01]} position={[0, 0.72, -0.05]} />
        <SignPlate id="fe-sign" size={[0.2, 0.08]} position={[0, 0.96, -0.04]} draw={(ctx, w, h) => {
          ctx.fillStyle = '#c8102e';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#fff';
          ctx.font = `800 ${h * 0.5}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('FIRE EXT.', w / 2, h / 2);
        }} />
      </group>
      <FireExtinguisher position={[-3.45, 0.62, BAY.wallZ + 0.36]} />
      {/* safety signage */}
      <SignPlate id="auto-start" size={[0.42, 0.3]} position={[-1.05, 1.85, BAY.wallZ + 0.002]} draw={drawSafetySign('danger', ['EQUIPMENT STARTS', 'AUTOMATICALLY', 'KEEP HANDS CLEAR'])} />
      <SignPlate id="hearing" size={[0.36, 0.26]} position={[2.75, 1.75, BAY.wallZ + 0.33]} draw={drawSafetySign('notice', ['HEARING', 'PROTECTION', 'REQUIRED'])} />
      <SignPlate id="line2" size={[0.9, 0.22]} position={[0, OPENING.y1 + 0.28, BAY.wallZ + 0.002]} draw={(ctx, w, h) => {
        ctx.fillStyle = '#1f4f9c';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        fitFont(ctx, 'LINE 2  →  CONVEYOR CV-101', w * 0.92, h * 0.46);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('LINE 2  →  CONVEYOR CV-101', w / 2, h / 2 + 2);
      }} />
      {/* a trash can and a broom by the wall (scale) */}
      <mesh geometry={KCYL()} material={km.paint('#35506b', 0.5, 0.3)} scale={[0.5, 0.8, 0.5]} position={[-3.0, 0.4, BAY.wallZ + 0.8]} castShadow />
      <mesh geometry={KCYL()} material={km.paint('#2a2d30', 0.6)} scale={[0.52, 0.03, 0.52]} position={[-3.0, 0.8, BAY.wallZ + 0.8]} />
      <mesh geometry={KCYL()} material={km.paint('#c8a26e', 0.8)} scale={[0.025, 1.4, 0.025]} position={[-2.7, 0.72, BAY.wallZ + 0.1]} rotation={[0.1, 0, 0.05]} castShadow />
      <mesh geometry={KBOX()} material={km.paint('#1f2225', 0.8)} scale={[0.35, 0.06, 0.06]} position={[-2.73, 0.05, BAY.wallZ + 0.03]} castShadow />
      {/* spare: conveyor ID plate on the tail end */}
      <SignPlate id="cv-plate" size={[0.2, 0.08]} position={[-0.335, 0.72, CONV.z0 + 1.1]} rotation={[0, -Math.PI / 2, 0]} draw={(ctx, w, h) => {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#eee';
        ctx.font = `800 ${h * 0.5}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CV-101', w / 2, h / 2);
      }} />
    </group>
  );
}

/** Coarse occluders (for the tag chips). */
export const BAY_OCCLUDERS: Array<[Vec3, Vec3]> = [
  [
    [BAY.leftX, OPENING.y1, BAY.wallZ - BAY.wallT],
    [BAY.rightX, BAY.height, BAY.wallZ],
  ],
  [
    [BAY.leftX, 0, BAY.wallZ - BAY.wallT],
    [OPENING.x0, OPENING.y1, BAY.wallZ],
  ],
  [
    [OPENING.x1, 0, BAY.wallZ - BAY.wallT],
    [BAY.rightX, OPENING.y1, BAY.wallZ],
  ],
  [
    [BAY.leftX - 0.2, 0, BAY.wallZ],
    [BAY.leftX, BAY.height, BAY.frontZ],
  ],
];
