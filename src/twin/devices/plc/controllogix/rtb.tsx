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
import { Art, ArtPlane, FONT_COND, MAT, Screws, StaticInstances, boxAt, cachedGeo, canvasTexture, merge, paint, rboxAt, texMaterial } from './shared';

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

export function ioHousingGeometry(): THREE.BufferGeometry {
  return cachedGeo('clx:ioHousing', () => {
    const rtbD = RTB_FRONT_Z - DOOR_T - MOD_BODY_D;
    const rtbMidZ = MOD_BODY_D + rtbD / 2;
    const rtbH = RTB_TOP_Y - RTB_BOTTOM_Y;
    const rtbMidY = (RTB_TOP_Y + RTB_BOTTOM_Y) / 2;
    return merge([
      rboxAt(MOD_W, MOD_H, MOD_BODY_D, 0, MOD_H / 2, MOD_BODY_D / 2, 0.0012),
      rboxAt(MOD_W, MOD_H - RTB_TOP_Y, MOD_FRONT_Z - MOD_BODY_D + 0.002, 0, (RTB_TOP_Y + MOD_H) / 2, (MOD_BODY_D - 0.002 + MOD_FRONT_Z) / 2, 0.0012),
      // RTB housing: side walls, top wall and the terminal body
      rboxAt(0.0017, rtbH, rtbD, -(MOD_W / 2 - 0.00085), rtbMidY, rtbMidZ, 0.0006),
      rboxAt(0.0017, rtbH, rtbD, MOD_W / 2 - 0.00085, rtbMidY, rtbMidZ, 0.0006),
      rboxAt(MOD_W, 0.0024, rtbD, 0, RTB_TOP_Y - 0.0012, rtbMidZ, 0.0006),
      boxAt(RTB_INNER_W, rtbH - 0.0024, 0.012, 0, rtbMidY - 0.0012, MOD_BODY_D + 0.006),
      // locking tab at the top of the RTB housing
      rboxAt(0.012, 0.003, 0.004, 0, RTB_TOP_Y + 0.0012, RTB_FRONT_Z - 0.004, 0.0008),
    ]);
  });
}

// ---------------------------------------------------------------------------
// Terminal block face (numbers, barriers) and hardware
// ---------------------------------------------------------------------------

function rtbFaceTexture(pins: RtbPins) {
  const x0 = -RTB_INNER_W / 2;
  const x1 = RTB_INNER_W / 2;
  const y0 = RTB_BOTTOM_Y;
  const y1 = RTB_TOP_Y - 0.0024;
  return canvasTexture(`clx:rtbface:${pins}`, 256, Math.round((256 * (y1 - y0)) / (x1 - x0)), (ctx, w, h) => {
    const a = new Art(ctx, x0, x1, y0, y1, w, h);
    a.plastic('#1a1b1d', 5);
    const pos = rtbPinPositions(pins);
    const pitch = pins === 20 ? 0.0087 : 0.0049;
    // central barrier rib
    a.rect(0, (y0 + y1) / 2, 0.0012, y1 - y0, '#26282b');
    // wells around each terminal
    for (const p of pos) {
      a.rect(p.x, p.y, pins === 20 ? 0.0078 : 0.0068, pitch * 0.86, '#0f1011', '#2c2e31', 0.0002, 0.0005);
      const nx = p.x < 0 ? x0 + 0.0014 : x1 - 0.0014;
      a.text(String(p.pin), nx, p.y + pitch * 0.18, pins === 20 ? 0.0024 : 0.0019, { color: '#d9d9d2', weight: 700, font: FONT_COND });
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

function wiringGeometry(key: string, pins: PinInfo[], rtbPins: RtbPins): THREE.BufferGeometry {
  return cachedGeo(`clx:wires:${key}`, () => {
    const wired = pins.filter((p) => p.wire);
    const parts: THREE.BufferGeometry[] = [];
    const r = rtbPins === 20 ? 0.00082 : 0.0007;
    const bundleZ = RTB_FACE_Z + 0.001;
    const bundleR = 0.0048;
    const rankL: Record<string, number> = { L: 0, R: 0 };
    const sorted = [...wired].sort((a, b) => b.y - a.y);
    sorted.forEach((p, idx) => {
      const side = p.x < 0 ? 'L' : 'R';
      const s = p.x < 0 ? -1 : 1;
      const rank = rankL[side]!++;
      const zRun = RTB_FACE_Z + 0.0036 + (rank % 3) * 0.0015;
      const xRun = p.x + s * ((rank % 4) * 0.0009 - 0.0012);
      const a = idx * GOLDEN;
      const br = bundleR * 0.55 * Math.sqrt((idx + 0.5) / wired.length);
      const bx = Math.cos(a) * br;
      const bz = bundleZ + Math.sin(a) * br;
      const clampY = p.y - (rtbPins === 20 ? 0.0026 : 0.0019);
      const pts = [
        new THREE.Vector3(p.x, clampY, RTB_FACE_Z + 0.0012),
        new THREE.Vector3(p.x + s * 0.0003, clampY - 0.003, zRun - 0.0006),
        new THREE.Vector3(xRun, clampY - 0.009, zRun),
        new THREE.Vector3(xRun, RTB_BOTTOM_Y + 0.004, zRun),
        new THREE.Vector3(xRun * 0.55, -0.011, zRun - 0.0015),
        new THREE.Vector3(bx, -0.028, bz),
        new THREE.Vector3(bx, -0.05, bz),
        new THREE.Vector3(bx * 0.9, -0.105, bz),
      ];
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      parts.push(paint(new THREE.TubeGeometry(curve, 56, r, 6, false), p.wire!));
      // insulation stripped end / ferrule at the clamp
      parts.push(paint(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.0032, 8).translate(p.x, clampY - 0.0004, RTB_FACE_Z + 0.0012), '#c9ccd0'));
    });
    // spiral-wrapped bundle sleeve & nylon cable ties
    if (wired.length) {
      parts.push(paint(new THREE.CylinderGeometry(bundleR, bundleR, 0.07, 16, 1, true).translate(0, -0.066, bundleZ), '#16171a'));
      for (const y of [-0.034, -0.074]) {
        parts.push(paint(new THREE.TorusGeometry(bundleR + 0.0006, 0.0008, 6, 20).rotateX(Math.PI / 2).translate(0, y, bundleZ), '#e8e6dc'));
        parts.push(paint(boxAt(0.0036, 0.003, 0.0026, bundleR + 0.0016, y, bundleZ), '#e8e6dc'));
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

function doorGeometry() {
  return cachedGeo('clx:door', () =>
    merge([
      rboxAt(DOOR_W, DOOR_H, DOOR_T, 0, DOOR_H / 2, 0, 0.0006),
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
    // grip ribs at the bottom
    for (let i = 0; i < 5; i++) a.rect(0, 0.0055 + i * 0.0022, DOOR_W - 0.01, 0.0007, 'rgba(0,0,0,0.45)');
  });
}

function doorInnerTexture(key: string, catalog: string, pins: PinInfo[]) {
  const x0 = -DOOR_W / 2;
  const x1 = DOOR_W / 2;
  return canvasTexture(`clx:doorInner:${key}`, 320, Math.round((320 * DOOR_H) / DOOR_W), (ctx, w, h) => {
    const a = new Art(ctx, x0, x1, 0, DOOR_H, w, h);
    a.plastic('#1c1d20', 4);
    // paper wiring label insert
    const top = DOOR_H - 0.004;
    const bottom = 0.006;
    a.rect(0, (top + bottom) / 2, DOOR_W - 0.004, top - bottom, '#f1efe6', '#cfccc0', 0.0002, 0.0005);
    a.text(catalog, 0, top - 0.0035, 0.0027, { weight: 800, color: '#1b1b1b' });
    a.line(x0 + 0.003, top - 0.006, x1 - 0.003, top - 0.006, '#1b1b1b', 0.00025);
    const rows = pins.length / 2;
    const rowH = (top - 0.0075 - bottom - 0.002) / rows;
    const fs = Math.min(0.0023, rowH * 0.62);
    for (let r = 0; r < rows; r++) {
      const even = pins.find((p) => p.pin === 2 * r + 2);
      const odd = pins.find((p) => p.pin === 2 * r + 1);
      const y = top - 0.0085 - r * rowH - rowH / 2;
      if (r % 2 === 0) a.rect(0, y, DOOR_W - 0.0055, rowH, '#e3e0d4');
      if (even) {
        a.text(even.label, x0 + 0.0028, y, fs, { align: 'left', color: '#222', weight: 600, font: FONT_COND });
        a.text(String(even.pin), -0.0025, y, fs, { color: '#222', weight: 800, font: FONT_COND });
      }
      if (odd) {
        a.text(String(odd.pin), 0.0025, y, fs, { color: '#222', weight: 800, font: FONT_COND });
        a.text(odd.label, x1 - 0.0028, y, fs, { align: 'right', color: '#222', weight: 600, font: FONT_COND });
      }
    }
    a.line(0, top - 0.0075, 0, bottom + 0.002, '#555', 0.0002);
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
