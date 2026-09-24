/**
 * 1756 I/O module housing + removable terminal block (1756-TBNH 20-pin / 1756-TBCH 36-pin) + front door
 * with the wiring-label insert, and the field wiring running down to a wrapped wire bundle.
 *
 * Module-local coordinates: origin back-bottom-center, front = +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { COLORS } from '../../../common';
import { DOOR_T, MOD_BODY_D, MOD_FRONT_Z, MOD_H, MOD_W, RTB_BOTTOM_Y, RTB_FRONT_Z, RTB_TOP_Y } from './dims';
import {
  Art,
  ArtPlane,
  FONT_COND,
  MAT,
  Screws,
  StaticInstances,
  boxAt,
  cachedGeo,
  canvasTexture,
  frameParts,
  lockingTabParts,
  merge,
  paint,
  rboxAt,
  texMaterial,
} from './shared';

export type RtbPins = 20 | 36;

/** Z of the terminal block face (screws sit on it). */
export const RTB_FACE_Z = MOD_BODY_D + 0.012;
const RTB_INNER_W = MOD_W - 0.0032;
const DOOR_OPEN_ANGLE = 1.72;

export interface PinInfo {
  /** Terminal number (1-based). */
  pin: number;
  x: number;
  y: number;
  /** Function label (e.g. 'IN-0', 'GND-0'). */
  label: string;
  /** Wire color when wired. */
  wire?: string;
}

/** Terminal positions for a 1756 RTB: even pins in the left column, odd pins in the (staggered) right column. */
export function rtbPinPositions(pins: RtbPins): Array<{ pin: number; x: number; y: number }> {
  const perCol = pins / 2;
  const top = pins === 20 ? 0.0975 : 0.0985;
  const pitch = pins === 20 ? 0.0087 : 0.0049;
  const xOff = pins === 20 ? 0.0068 : 0.0062;
  const out: Array<{ pin: number; x: number; y: number }> = [];
  for (let k = 0; k < perCol; k++) {
    out.push({ pin: 2 * k + 2, x: -xOff, y: top - k * pitch });
    out.push({ pin: 2 * k + 1, x: xOff, y: top - pitch / 2 - k * pitch });
  }
  return out.sort((a, b) => a.pin - b.pin);
}

// ---------------------------------------------------------------------------
// Housing (body + indicator head + RTB housing) — one merged geometry
// ---------------------------------------------------------------------------

/** Indicator windows on the module head (molded rim), per head layout. */
export const HEAD_WINDOW = {
  digital: { cy: 0.1223, w: 0.0312, h: 0.024 },
  analog: { cy: 0.1265, w: 0.0312, h: 0.0132 },
} as const;
export const HEAD_RIM = 0.0011;
/** Height of the indicator-window rim above the head face. */
export const HEAD_RIM_H = 0.0006;

export function ioHousingGeometry(kind: 'digital' | 'analog' = 'digital'): THREE.BufferGeometry {
  return cachedGeo(`clx:ioHousing:${kind}`, () => {
    const rtbD = RTB_FRONT_Z - DOOR_T - MOD_BODY_D;
    const rtbMidZ = MOD_BODY_D + rtbD / 2;
    const rtbH = RTB_TOP_Y - RTB_BOTTOM_Y;
    const rtbMidY = (RTB_TOP_Y + RTB_BOTTOM_Y) / 2;
    const win = HEAD_WINDOW[kind];
    return merge([
      rboxAt(MOD_W, MOD_H, MOD_BODY_D, 0, MOD_H / 2, MOD_BODY_D / 2, 0.0012),
      rboxAt(MOD_W, MOD_H - RTB_TOP_Y, MOD_FRONT_Z - MOD_BODY_D + 0.002, 0, (RTB_TOP_Y + MOD_H) / 2, (MOD_BODY_D - 0.002 + MOD_FRONT_Z) / 2, 0.0012),
      // molded rim around the indicator window
      ...frameParts(0, win.cy, win.w, win.h, HEAD_RIM, HEAD_RIM_H, MOD_FRONT_Z),
      // RTB housing: side walls, top wall and the terminal body
      rboxAt(0.0017, rtbH, rtbD, -(MOD_W / 2 - 0.00085), rtbMidY, rtbMidZ, 0.0006),
      rboxAt(0.0017, rtbH, rtbD, MOD_W / 2 - 0.00085, rtbMidY, rtbMidZ, 0.0006),
      rboxAt(MOD_W, 0.0024, rtbD, 0, RTB_TOP_Y - 0.0012, rtbMidZ, 0.0006),
      boxAt(RTB_INNER_W, rtbH - 0.0024, 0.012, 0, rtbMidY - 0.0012, MOD_BODY_D + 0.006),
      // locking tab at the top of the RTB housing
      rboxAt(0.012, 0.003, 0.004, 0, RTB_TOP_Y + 0.0012, RTB_FRONT_Z - 0.004, 0.0008),
      // module locking tabs (top & bottom front, over the chassis shelf lips)
      ...lockingTabParts(MOD_H),
    ]);
  });
}

// ---------------------------------------------------------------------------
// Terminal block face (numbers, barriers) and hardware
// ---------------------------------------------------------------------------

/** Terminal well width (x) per RTB. */
const WELL_W: Record<RtbPins, number> = { 20: 0.0072, 36: 0.0062 };

function rtbFaceTexture(pins: RtbPins) {
  const x0 = -RTB_INNER_W / 2;
  const x1 = RTB_INNER_W / 2;
  const y0 = RTB_BOTTOM_Y;
  const y1 = RTB_TOP_Y - 0.0024;
  return canvasTexture(`clx:rtbface:${pins}:v2`, 256, Math.round((256 * (y1 - y0)) / (x1 - x0)), (ctx, w, h) => {
    const a = new Art(ctx, x0, x1, y0, y1, w, h);
    a.plastic('#1a1b1d', 5);
    const pos = rtbPinPositions(pins);
    const pitch = pins === 20 ? 0.0087 : 0.0049;
    const wellW = WELL_W[pins];
    // central barrier rib
    a.rect(0, (y0 + y1) / 2, 0.0012, y1 - y0, '#26282b');
    // side wire channels (slightly darker)
    a.rect(x0 + 0.0022, (y0 + y1) / 2, 0.0044, y1 - y0, 'rgba(0,0,0,0.25)');
    a.rect(x1 - 0.0022, (y0 + y1) / 2, 0.0044, y1 - y0, 'rgba(0,0,0,0.25)');
    for (const p of pos) {
      a.rect(p.x, p.y, wellW, pitch * 0.86, '#0f1011', '#2c2e31', 0.0002, 0.0005);
      // terminal number INBOARD of its terminal (between the two columns), never hidden by the housing walls
      const s = p.x < 0 ? 1 : -1;
      const nx = p.x + s * (wellW / 2 + 0.00125);
      a.text(String(p.pin), nx, p.y, pins === 20 ? 0.0021 : 0.0016, {
        color: '#d9d9d2',
        weight: 700,
        font: FONT_COND,
        maxWidth: 0.0021,
      });
    }
  });
}

function terminalHardwareGeo(pins: RtbPins) {
  return cachedGeo(`clx:rtbhw:${pins}`, () => {
    const s = pins === 20 ? 1 : 0.72;
    // square pressure plate + wire-clamp saddle, sitting on the face
    return merge([
      boxAt(0.0052 * s, 0.0046 * s, 0.0009, 0, 0, 0.00045),
      boxAt(0.0058 * s, 0.0012 * s, 0.0024, 0, -0.0026 * s, 0.0012),
    ]);
  });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const GOLDEN = 2.39996;
/** Wire bundle (spiral wrap) below the module, module-local. */
const BUNDLE_Z = 0.1305;
const BUNDLE_R = 0.0048;
const SLEEVE_TOP = -0.03;
const SLEEVE_LEN = 0.07;

/**
 * Field wiring as dressed on a real 1756 RTB: every conductor leaves its clamp, bends OUTWARD to the wire
 * channel along its side wall (left column -> -X wall, right column -> +X wall), runs down the channel,
 * exits at the bottom and enters a capped spiral-wrap bundle. Screws and terminal numbers stay visible.
 */
function wiringGeometry(key: string, pins: PinInfo[], rtbPins: RtbPins): THREE.BufferGeometry {
  return cachedGeo(`clx:wires:v2:${key}`, () => {
    const wired = pins.filter((p) => p.wire);
    const parts: THREE.BufferGeometry[] = [];
    const r = rtbPins === 20 ? 0.00082 : 0.0007;
    const pitch = rtbPins === 20 ? 0.0087 : 0.0049;
    const wallIn = MOD_W / 2 - 0.0017; // inner face of the RTB housing side walls
    const xOuter = wallIn - r - 0.00025;
    const xInnerMin = WELL_W[rtbPins] / 2 + (rtbPins === 20 ? 0.0068 : 0.0062) + r - 0.0006;
    const zStep = 2 * r + 0.0001;
    const zFace = RTB_FACE_Z + 0.0012; // wire centre height at the clamp
    const yExit = RTB_BOTTOM_Y + 0.0045;

    // bundle slots: golden-angle packing in a disk, left half for left-column wires, right half for right
    const n = wired.length;
    const slots = Array.from({ length: n }, (_, i) => {
      const a = i * GOLDEN;
      const br = BUNDLE_R * 0.58 * Math.sqrt((i + 0.5) / Math.max(1, n));
      return { x: Math.cos(a) * br, z: BUNDLE_Z + Math.sin(a) * br };
    }).sort((p, q) => p.x - q.x);
    const left = wired.filter((p) => p.x < 0).sort((a, b) => b.y - a.y);
    const right = wired.filter((p) => p.x >= 0).sort((a, b) => b.y - a.y);
    // leftmost slots -> top-left wires (outer lanes) ... rightmost slots -> top-right wires
    const slotOf = new Map<PinInfo, { x: number; z: number }>();
    left.forEach((p, i) => slotOf.set(p, slots[i]!));
    right.forEach((p, i) => slotOf.set(p, slots[n - 1 - i]!));

    for (const [side, list] of [
      [-1, left],
      [1, right],
    ] as const) {
      const N = list.length;
      if (!N) continue;
      const dx = N > 1 ? Math.min(0.00045, (xOuter - xInnerMin) / (N - 1)) : 0;
      const layers = Math.max(1, Math.ceil((2 * r * 1.02) / Math.max(dx, 1e-6)));
      list.forEach((p, rank) => {
        const laneX = side * (xOuter - rank * dx);
        const laneZ = zFace + 0.0005 + (rank % layers) * zStep;
        const yc = p.y - (rtbPins === 20 ? 0.0026 : 0.0019); // clamp saddle
        const turn = pitch * 0.45;
        const s0 = new THREE.Vector3(p.x, yc + 0.0012, zFace);
        const s1 = new THREE.Vector3(p.x, yc - 0.0008, zFace);
        const s2 = new THREE.Vector3(laneX, yc - 0.0008 - turn, laneZ);
        const s3 = new THREE.Vector3(laneX, Math.min(yExit, s2.y - 0.0005), laneZ);
        const slot = slotOf.get(p)!;
        const s4 = new THREE.Vector3(slot.x, SLEEVE_TOP + 0.004, slot.z);
        const s5 = new THREE.Vector3(slot.x, SLEEVE_TOP - 0.006, slot.z); // ends inside the sleeve
        const path = new THREE.CurvePath<THREE.Vector3>();
        path.add(new THREE.LineCurve3(s0, s1));
        path.add(
          new THREE.CubicBezierCurve3(
            s1,
            new THREE.Vector3(s1.x, s1.y - turn * 0.55, s1.z),
            new THREE.Vector3(s2.x, s2.y + turn * 0.55, s2.z),
            s2,
          ),
        );
        path.add(new THREE.LineCurve3(s2, s3));
        const drop = s3.y - s4.y;
        path.add(
          new THREE.CubicBezierCurve3(
            s3,
            new THREE.Vector3(s3.x, s3.y - drop * 0.45, s3.z),
            new THREE.Vector3(s4.x, s4.y + drop * 0.45, s4.z),
            s4,
          ),
        );
        path.add(new THREE.LineCurve3(s4, s5));
        const len = path.getLength();
        parts.push(paint(new THREE.TubeGeometry(path, Math.max(20, Math.round(len / 0.006)), r, 5, false), p.wire!));
        // stripped end / ferrule in the clamp
        parts.push(paint(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.0032, 8).translate(p.x, yc + 0.0004, zFace), '#c9ccd0'));
      });
    }
    // capped, slightly tapered spiral-wrap sleeve & nylon cable ties
    if (n) {
      parts.push(paint(new THREE.CylinderGeometry(BUNDLE_R, BUNDLE_R * 0.9, SLEEVE_LEN, 16, 1, false).translate(0, SLEEVE_TOP - SLEEVE_LEN / 2, BUNDLE_Z), '#16171a'));
      for (const y of [SLEEVE_TOP - 0.008, SLEEVE_TOP - 0.048]) {
        parts.push(paint(new THREE.TorusGeometry(BUNDLE_R + 0.0005, 0.0008, 6, 20).rotateX(Math.PI / 2).translate(0, y, BUNDLE_Z), '#e8e6dc'));
        parts.push(paint(boxAt(0.0036, 0.003, 0.0026, BUNDLE_R + 0.0016, y, BUNDLE_Z), '#e8e6dc'));
      }
    }
    return merge(parts, true);
  });
}

// ---------------------------------------------------------------------------
// Door
// ---------------------------------------------------------------------------

const DOOR_W = MOD_W - 0.0012;
const DOOR_H = RTB_TOP_Y - RTB_BOTTOM_Y - 0.0016;

/** Molded grip ribs at the lower front of the door (door-local y). */
const DOOR_RIB_YS = Array.from({ length: 5 }, (_, i) => 0.0055 + i * 0.0022);

function doorGeometry() {
  return cachedGeo('clx:door:v2', () =>
    merge([
      rboxAt(DOOR_W, DOOR_H, DOOR_T, 0, DOOR_H / 2, 0, 0.0006),
      ...DOOR_RIB_YS.map((y) => rboxAt(DOOR_W - 0.01, 0.0008, 0.0007, 0, y, DOOR_T / 2 + 0.00025, 0.00025)),
      // finger pull at the top
      rboxAt(0.011, 0.0026, 0.0022, 0, DOOR_H - 0.0006, DOOR_T / 2 + 0.0006, 0.0006),
      // hinge knuckles
      new THREE.CylinderGeometry(0.0011, 0.0011, 0.007, 10).rotateZ(Math.PI / 2).translate(-DOOR_W / 2 + 0.0045, 0, -0.0002),
      new THREE.CylinderGeometry(0.0011, 0.0011, 0.007, 10).rotateZ(Math.PI / 2).translate(DOOR_W / 2 - 0.0045, 0, -0.0002),
    ]),
  );
}

export interface DoorArt {
  catalog: string;
  /** Short description printed under the catalog number, e.g. 'DC INPUT'. */
  title: string;
  subtitle?: string;
  /** Color band at the top of the label (Rockwell uses color coding per I/O type). */
  band?: string;
}

function doorOuterTexture(art: DoorArt) {
  const x0 = -DOOR_W / 2;
  const x1 = DOOR_W / 2;
  return canvasTexture(`clx:doorOuter:${JSON.stringify(art)}`, 256, Math.round((256 * DOOR_H) / DOOR_W), (ctx, w, h) => {
    const a = new Art(ctx, x0, x1, 0, DOOR_H, w, h);
    a.plastic(COLORS.moduleBlack, 7);
    // molded border
    a.rect(0, DOOR_H / 2, DOOR_W - 0.0012, DOOR_H - 0.0012, undefined, 'rgba(255,255,255,0.06)', 0.0003, 0.0008);
    // catalog & title
    a.text(art.catalog, 0, DOOR_H - 0.0068, 0.0036, { weight: 700, color: '#f0f0ea' });
    a.text(art.title, 0, DOOR_H - 0.0112, 0.0024, { weight: 600, color: '#cfd0cb', font: FONT_COND });
    if (art.subtitle) a.text(art.subtitle, 0, DOOR_H - 0.0145, 0.0019, { weight: 500, color: '#a9aaa5', font: FONT_COND });
    // colour band + small write-on marker tag
    if (art.band) a.rect(0, DOOR_H - 0.0178, DOOR_W - 0.009, 0.0014, art.band, undefined, 0, 0.0003);
    a.rect(0, DOOR_H - 0.0258, DOOR_W - 0.009, 0.0105, '#e6e5de', '#9d9e98', 0.0002, 0.0005);
    a.line(-DOOR_W / 2 + 0.0065, DOOR_H - 0.0282, DOOR_W / 2 - 0.0065, DOOR_H - 0.0282, '#b4b5ae', 0.00018);
    // shallow recessed panel (molded) over the wiring area
    a.rect(0, 0.042, DOOR_W - 0.0055, 0.052, 'rgba(0,0,0,0.18)', 'rgba(255,255,255,0.05)', 0.00025, 0.0012);
    a.text('WARNING', 0, 0.0625, 0.0018, { weight: 800, color: '#8d8e89', font: FONT_COND });
    a.text('Remove power before', 0, 0.0598, 0.0015, { weight: 500, color: '#7c7d78', font: FONT_COND });
    a.text('removing the RTB', 0, 0.0577, 0.0015, { weight: 500, color: '#7c7d78', font: FONT_COND });
    // soft shadow lines under the molded grip ribs (the ribs are geometry)
    for (const y of DOOR_RIB_YS) a.rect(0, y - 0.00055, DOOR_W - 0.01, 0.0004, 'rgba(0,0,0,0.35)');
  });
}

function doorInnerTexture(key: string, catalog: string, pins: PinInfo[]) {
  const x0 = -DOOR_W / 2;
  const x1 = DOOR_W / 2;
  return canvasTexture(`clx:doorInner:v2:${key}`, 320, Math.round((320 * DOOR_H) / DOOR_W), (ctx, w, h) => {
    const a = new Art(ctx, x0, x1, 0, DOOR_H, w, h);
    a.plastic('#1c1d20', 4);
    // paper wiring label insert (Rockwell layout: terminal numbers in the centre, functions outside)
    const top = DOOR_H - 0.004;
    const bottom = 0.006;
    a.rect(0, (top + bottom) / 2, DOOR_W - 0.004, top - bottom, '#f1efe6', '#cfccc0', 0.0002, 0.0005);
    a.text(catalog, 0, top - 0.0035, 0.0027, { weight: 800, color: '#1b1b1b' });
    a.line(x0 + 0.003, top - 0.006, x1 - 0.003, top - 0.006, '#1b1b1b', 0.00025);
    const rows = pins.length / 2;
    const rowH = (top - 0.0075 - bottom - 0.002) / rows;
    const fs = Math.min(0.0023, rowH * 0.62);
    const numX = 0.0024; // number column centres (±)
    const numHalf = 0.0014;
    // function text runs from the insert edge (x0 + 2.8 mm) to just before the number column
    const avail = Math.max(0.004, -numX - numHalf - 0.0006 - (x0 + 0.0028));
    for (let r = 0; r < rows; r++) {
      const even = pins.find((p) => p.pin === 2 * r + 2);
      const odd = pins.find((p) => p.pin === 2 * r + 1);
      const y = top - 0.0085 - r * rowH - rowH / 2;
      if (r % 2 === 0) a.rect(0, y, DOOR_W - 0.0055, rowH, '#e3e0d4');
      const lab = { color: '#222', weight: 600, font: FONT_COND, maxWidth: avail } as const;
      const num = { color: '#222', weight: 800, font: FONT_COND, maxWidth: numHalf * 2 } as const;
      if (even) {
        a.text(even.label, x0 + 0.0028, y, fs, { ...lab, align: 'left' });
        a.text(String(even.pin), -numX, y, fs, num);
      }
      if (odd) {
        a.text(String(odd.pin), numX, y, fs, num);
        a.text(odd.label, x1 - 0.0028, y, fs, { ...lab, align: 'right' });
      }
    }
    // number column rules
    for (const x of [-numX - numHalf - 0.0003, 0, numX + numHalf + 0.0003]) a.line(x, top - 0.0075, x, bottom + 0.002, '#8a887e', 0.00015);
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface RtbAssemblyProps {
  /** Cache key for textures/wiring (usually the catalog number). */
  catalog: string;
  pins: RtbPins;
  pinInfo: PinInfo[];
  door: DoorArt;
  doorOpen?: boolean;
  /** Show field wiring (always shown when the door is open). */
  wired?: boolean;
}

/**
 * RTB + door + wiring for a 1756 I/O module. The housing itself is part of `ioHousingGeometry()`.
 * Interior parts mount the first time the door opens (or when `wired`) and stay mounted so the door can
 * animate closed over them.
 */
export function RtbAssembly({ catalog, pins, pinInfo, door, doorOpen = false, wired = false }: RtbAssemblyProps) {
  const [interior, setInterior] = useState(doorOpen || wired);
  useEffect(() => {
    if (doorOpen || wired) setInterior(true);
  }, [doorOpen, wired]);

  const doorRef = useRef<THREE.Group>(null);
  const angle = useRef(doorOpen ? DOOR_OPEN_ANGLE : 0);
  useFrame((_, dt) => {
    const g = doorRef.current;
    if (!g) return;
    const target = doorOpen ? DOOR_OPEN_ANGLE : 0;
    const a = angle.current;
    if (Math.abs(target - a) < 1e-4) return;
    angle.current = a + (target - a) * Math.min(1, dt * 7);
    g.rotation.x = angle.current;
  });

  const faceTex = rtbFaceTexture(pins);
  const outerTex = doorOuterTexture(door);
  const innerTex = doorInnerTexture(`${catalog}:${pins}`, catalog, pinInfo);
  const plane = cachedGeo(`plane:door`, () => new THREE.PlaneGeometry(DOOR_W - 0.0003, DOOR_H - 0.0003));
  const hw = terminalHardwareGeo(pins);
  const { screwPts, hwPts } = useMemo(() => {
    const pos = rtbPinPositions(pins);
    return {
      screwPts: pos.map((p) => [p.x, p.y, RTB_FACE_Z + 0.0009] as [number, number, number]),
      hwPts: pos.map((p) => [p.x, p.y, RTB_FACE_Z] as [number, number, number]),
    };
  }, [pins]);

  return (
    <group>
      {interior && (
        <group>
          <ArtPlane tex={faceTex} x0={-RTB_INNER_W / 2} x1={RTB_INNER_W / 2} y0={RTB_BOTTOM_Y} y1={RTB_TOP_Y - 0.0024} z={RTB_FACE_Z + 0.0001} />
          <StaticInstances geometry={hw} material={MAT.nickel()} points={hwPts} />
          <Screws points={screwPts} radius={pins === 20 ? 0.0021 : 0.0015} />
          <mesh geometry={wiringGeometry(`${catalog}:${pins}`, pinInfo, pins)} material={MAT.vertexColoredGloss()} />
        </group>
      )}
      <group ref={doorRef} position={[0, RTB_BOTTOM_Y + 0.0008, RTB_FRONT_Z - DOOR_T / 2]} rotation-x={angle.current}>
        <mesh geometry={doorGeometry()} material={MAT.body()} castShadow />
        <mesh geometry={plane} material={texMaterial(outerTex)} position={[0, DOOR_H / 2, DOOR_T / 2 + 0.0001]} />
        <mesh geometry={plane} material={texMaterial(innerTex)} position={[0, DOOR_H / 2, -DOOR_T / 2 - 0.0001]} rotation-x={Math.PI} />
      </group>
    </group>
  );
}
