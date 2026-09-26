/**
 * <Controller1756L8/> — ControlLogix 5580 controller (1756-L85E / 1756-L83E), single-slot module, modelled after the
 * product photograph (front, top -> bottom):
 *
 *  - clear smoked cap over a black face: white product label ("Logix5585E"), 4-character dot-matrix status display,
 *    NET / LINK indicators at the right, RUN / FORCE / SD / OK indicators in a row below;
 *  - light-gray door with the round black RUN-REM-PROG key lock (no key left in it; the keyway shows the position)
 *    and the SD logo — the SD card slot is behind it;
 *  - USB type-B port with an orange contact tongue, embossed warning triangle and USB trident;
 *  - the lower front slopes back with the 1 Gb EtherNet/IP RJ45 port set into the slope, "EtherNet/IP" on the foot;
 *  - black anodised heat-sink body with vertical fins; "CAUTION ! HOT !" embossed on the side of the bezel.
 *
 * Clicking left of the lock turns the key to RUN, the lock itself REM, right of it PROG (resolved in lock-local
 * coordinates, so it works from any camera angle; fires on pointer-up without dragging).
 *
 * Origin: back-bottom-center of the module (backplane face), front = +Z.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { materials } from '../../../common';
import type { ControllerStatus, KeySwitch } from '../../../../plc/types';
import type { Placement } from '../../../contracts';
import { MOD_FRONT_Z, MOD_H, MOD_W } from './dims';
import {
  Art,
  ArtPlane,
  DotMatrixDisplay,
  FONT,
  FONT_COND,
  MAT,
  Rj45Jack,
  Selectable,
  SideLabel,
  StatusLed,
  cachedGeo,
  canvasTexture,
  cylZ,
  lockingTabParts,
  merge,
  rboxAt,
  texMaterial,
  type StatusLedState,
} from './shared';

export type ControllerCatalog1756 = '1756-L85E' | '1756-L83E';

export interface Controller1756L8Props extends Placement {
  catalog?: ControllerCatalog1756;
  /** Live controller status (display text, LEDs, key position). Omit for an unpowered controller. */
  getStatus?: () => ControllerStatus;
  /** Called when the user clicks the key switch zones (left = RUN, center = REM, right = PROG). */
  onKeySwitch?: (pos: KeySwitch) => void;
  /** Embedded Ethernet port indicators (default: NET steady green, LINK flickering activity when powered). */
  getNet?: () => StatusLedState;
  getLink?: () => StatusLedState;
  /** Show a patch cable plugged into the embedded Ethernet port (default true). */
  cable?: boolean;
  onSelect?: () => void;
  highlighted?: boolean;
  /** Show the catalog label on the right side of the housing (default true; the rack shows it only where visible). */
  sideLabel?: boolean;
}

// ---------------------------------------------------------------------------
// Geometry (module-local meters; measured off the product photo, scaled to the 140 mm module height)
// ---------------------------------------------------------------------------

export const CPU_FRONT_Z = MOD_FRONT_Z + 0.0025;
const FACE = CPU_FRONT_Z;
const W = MOD_W;
const HW = W / 2;
/** Depth of the light-gray front bezel; the black finned heat sink is behind it. */
const BEZEL_D = 0.013;
const BEZEL_Z0 = FACE - BEZEL_D;

/** Section boundaries (y, meters from the module bottom). */
const Y_CAP = 0.1048; // clear display cap: Y_CAP .. MOD_H
const Y_DOOR = 0.0703; // key / SD door: Y_DOOR .. Y_CAP
const Y_SLOPE = 0.0445; // USB zone: Y_SLOPE .. Y_DOOR; the front slopes back below
const Y_FOOT = 0.009; // foot with the EtherNet/IP legend: 0 .. Y_FOOT
/** How far the sloped lower front and the foot are set back from the face. */
const SLOPE_BACK = 0.012;
const SLOPE_ANGLE = Math.atan2(SLOPE_BACK, Y_SLOPE - Y_FOOT);

/** Clear cap: black face behind it, cap front proud of the gray face. */
const CAP_FACE_Z = FACE - 0.0022;
const CAP_FRONT_Z = FACE + 0.0006;

const DISPLAY = { x: -0.0068, y: 0.1219, w: 0.0177, h: 0.0062 } as const;
const LABEL = { y: 0.1328, h: 0.0052, x0: -HW + 0.0014, x1: HW - 0.0012 } as const;
const STATUS_ROW_Y = 0.1121;
const STATUS_LABEL_Y = 0.1088;
const STATUS_X = [-0.0113, -0.006, -0.0003, 0.0052] as const;
const NET_LED = { x: 0.0092, y: 0.1278 } as const;
const LINK_LED = { x: 0.0092, y: 0.1228 } as const;
const LED_SIZE: [number, number, number] = [0.0024, 0.0013, 0.0004];

const KEY = { x: -0.0023, y: 0.0872, plugR: 0.0081, ringR: 0.0099 } as const;
const USB = { x: 0.005, y: 0.0617, w: 0.0102, h: 0.0124 } as const;
/** RJ45 jack center on the sloped face (y) — z follows the slope. */
const JACK_Y = 0.0305;
const slopeZ = (y: number): number => FACE - SLOPE_BACK + ((y - Y_FOOT) / (Y_SLOPE - Y_FOOT)) * SLOPE_BACK;

const KEY_ANGLE: Record<KeySwitch, number> = { RUN: Math.PI / 4, REM: 0, PROG: -Math.PI / 4 };
/** Half-width of the center (REM) zone of the key-switch hit plate, lock-local. */
const REM_HALF = 0.0045;

// colors of the photo
const GRAY = '#b6b9b9';
const GRAY_TXT = '#6e7273';
const EMBOSS_DARK = 'rgba(70,74,76,0.55)';
const EMBOSS_LIGHT = 'rgba(255,255,255,0.45)';

const MAT_GRAY = () => materials.plastic(GRAY, 0.55);
const MAT_SINK = () => materials.plastic('#191a1c', 0.5);
const MAT_KEY = () => materials.plastic('#0f1011', 0.35);
const capMat = new THREE.MeshPhysicalMaterial({
  color: '#9aa3a8',
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.07,
  depthWrite: false,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
});
const ghostMat = new THREE.MeshBasicMaterial({ color: '#9fdcff', transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
const _v = new THREE.Vector3();

/** Groove molded into the gray plastic: a dark line with a light line under it (reads as a recess from above). */
function groove(a: Art, x0: number, x1: number, y: number) {
  a.line(x0, y, x1, y, EMBOSS_DARK, 0.00028);
  a.line(x0, y - 0.0003, x1, y - 0.0003, EMBOSS_LIGHT, 0.0002);
}

/** Embossed (molded-in) text: light offset under a dark stroke, like the photo's raised lettering. */
function emboss(a: Art, s: string, x: number, y: number, size: number, opts: { align?: CanvasTextAlign; rotate?: number; weight?: number } = {}) {
  a.text(s, x + 0.00012, y - 0.00016, size, { ...opts, color: EMBOSS_LIGHT, font: FONT });
  a.text(s, x, y, size, { ...opts, color: GRAY_TXT, font: FONT });
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

/** Black face under the clear cap: product label, display pocket, indicator windows and legends. */
function capFaceTexture(catalog: ControllerCatalog1756) {
  const x0 = -HW;
  const x1 = HW;
  return canvasTexture(`clx:l8:cap:${catalog}`, 320, Math.round((320 * (MOD_H - Y_CAP)) / W), (ctx, w, h) => {
    const a = new Art(ctx, x0, x1, Y_CAP, MOD_H, w, h);
    a.plastic('#0b0c0d', 4);
    // product label strip
    a.rect((LABEL.x0 + LABEL.x1) / 2, LABEL.y, LABEL.x1 - LABEL.x0, LABEL.h, '#dfe2e3', undefined, 0, 0.0003);
    const model = catalog === '1756-L85E' ? 'Logix5585E' : 'Logix5583E';
    a.text(model, LABEL.x0 + 0.001, LABEL.y - 0.0001, 0.0047, { weight: 800, color: '#111214', align: 'left', font: FONT, maxWidth: 0.0272 });
    a.text('™', LABEL.x1 - 0.0012, LABEL.y + 0.0009, 0.0022, { weight: 800, color: '#111214', align: 'right', font: FONT });
    // display pocket
    a.rect(DISPLAY.x, DISPLAY.y, DISPLAY.w + 0.0012, DISPLAY.h + 0.0012, '#050505', undefined, 0, 0.0004);
    // indicator windows + legends
    const lab = { weight: 700, color: '#e3e5e6', font: FONT_COND } as const;
    for (const [x, name] of STATUS_X.map((x, i) => [x, ['RUN', 'FORCE', 'SD', 'OK'][i]!] as const)) {
      a.rect(x, STATUS_ROW_Y, LED_SIZE[0] + 0.0006, LED_SIZE[1] + 0.0006, '#030303');
      a.text(name, x, STATUS_LABEL_Y, 0.0021, lab);
    }
    for (const [p, name] of [
      [NET_LED, 'NET'],
      [LINK_LED, 'LINK'],
    ] as const) {
      a.rect(p.x - 0.0036, p.y + 0.0006, LED_SIZE[0] + 0.0006, LED_SIZE[1] + 0.0006, '#030303');
      a.text(name, HW - 0.0014, p.y - 0.0002, 0.0021, { ...lab, align: 'right' });
    }
  });
}

/** Gray door (key lock, SD logo) and the USB zone below it. */
function doorTexture() {
  return canvasTexture('clx:l8:door', 320, Math.round((320 * (Y_CAP - Y_SLOPE)) / W), (ctx, w, h) => {
    const a = new Art(ctx, -HW, HW, Y_SLOPE, Y_CAP, w, h);
    a.plastic(GRAY, 5);
    // door parting line + molded grooves
    a.line(-HW, Y_DOOR, HW, Y_DOOR, 'rgba(40,43,45,0.8)', 0.0004);
    a.line(-HW, Y_DOOR - 0.0004, HW, Y_DOOR - 0.0004, EMBOSS_LIGHT, 0.00025);
    groove(a, -HW + 0.0004, -0.0128, 0.0926);
    groove(a, 0.0045, HW - 0.0004, 0.0947);
    groove(a, 0.0045, HW - 0.0004, 0.0871);
    groove(a, -HW + 0.0004, -0.0128, 0.0772);
    groove(a, -HW + 0.0004, HW - 0.0004, 0.0513);
    groove(a, -HW + 0.0004, -0.0006, 0.0594);
    // dished recess around the lock
    const cx = a.px(KEY.x);
    const cy = a.py(KEY.y);
    const r = a.m(KEY.ringR);
    const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.35, r * 0.2, cx, cy, r);
    g.addColorStop(0, '#c9cbcb');
    g.addColorStop(0.75, '#b0b3b3');
    g.addColorStop(1, '#8f9393');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // key positions
    emboss(a, 'RUN', -0.0128, 0.0955, 0.0022);
    emboss(a, 'REM', -0.0027, 0.0997, 0.0022);
    emboss(a, 'PROG', 0.0087, 0.0974, 0.0022);
    // SD logo (the card slot is behind the door)
    emboss(a, 'SD', 0.0122, 0.0912, 0.0026, { weight: 900 });
    // USB zone: warning triangle + USB trident, embossed
    const tri = (x: number, y: number, s: number, color: string, lw: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, a.m(lw));
      ctx.beginPath();
      ctx.moveTo(a.px(x), a.py(y + s * 0.55));
      ctx.lineTo(a.px(x + s * 0.6), a.py(y - s * 0.45));
      ctx.lineTo(a.px(x - s * 0.6), a.py(y - s * 0.45));
      ctx.closePath();
      ctx.stroke();
      a.text('!', x, y - s * 0.08, s * 0.55, { weight: 800, color, font: FONT });
    };
    tri(-0.0089, 0.064 - 0.00016, 0.0078, EMBOSS_LIGHT, 0.0003);
    tri(-0.0091, 0.064, 0.0078, GRAY_TXT, 0.0003);
    const trident = (dx: number, dy: number, color: string) => {
      const x = -0.0086 + dx;
      const y = 0.0558 + dy;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(1, a.m(0.0003));
      ctx.beginPath();
      ctx.moveTo(a.px(x - 0.006), a.py(y));
      ctx.lineTo(a.px(x + 0.0058), a.py(y));
      ctx.stroke();
      ctx.beginPath(); // arrow head
      ctx.moveTo(a.px(x + 0.0066), a.py(y));
      ctx.lineTo(a.px(x + 0.0054), a.py(y + 0.0009));
      ctx.lineTo(a.px(x + 0.0054), a.py(y - 0.0009));
      ctx.closePath();
      ctx.fill();
      ctx.beginPath(); // upper branch (circle end)
      ctx.moveTo(a.px(x - 0.0035), a.py(y));
      ctx.lineTo(a.px(x - 0.0012), a.py(y + 0.0026));
      ctx.lineTo(a.px(x + 0.0018), a.py(y + 0.0026));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.px(x + 0.0024), a.py(y + 0.0026), a.m(0.0007), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath(); // lower branch (square end)
      ctx.moveTo(a.px(x - 0.0022), a.py(y));
      ctx.lineTo(a.px(x - 0.0002), a.py(y - 0.0024));
      ctx.lineTo(a.px(x + 0.0026), a.py(y - 0.0024));
      ctx.stroke();
      ctx.strokeRect(a.px(x + 0.0026), a.py(y - 0.0017), a.m(0.0013), a.m(0.0013));
    };
    trident(0.00012, -0.00016, EMBOSS_LIGHT);
    trident(0, 0, GRAY_TXT);
    // dark frame around the USB receptacle
    a.rect(USB.x, USB.y, USB.w + 0.0016, USB.h + 0.0016, '#2b2d2e', undefined, 0, 0.0005);
    a.rect(USB.x, USB.y, USB.w, USB.h, '#8d8f8e', undefined, 0, 0.0003);
  });
}

/** Sloped lower front: grooves and the RJ45 pocket. Drawn in slope-local coordinates (v = distance along the slope). */
const SLOPE_LEN = Math.hypot(Y_SLOPE - Y_FOOT, SLOPE_BACK);
function slopeTexture() {
  return canvasTexture('clx:l8:slope', 320, Math.round((320 * SLOPE_LEN) / W), (ctx, w, h) => {
    const a = new Art(ctx, -HW, HW, 0, SLOPE_LEN, w, h);
    a.plastic(GRAY, 5);
    const v = (y: number) => ((y - Y_FOOT) / (Y_SLOPE - Y_FOOT)) * SLOPE_LEN;
    groove(a, -HW + 0.0004, HW - 0.0004, v(0.0418));
    groove(a, -HW + 0.0004, HW - 0.0004, v(0.0178));
    groove(a, -HW + 0.0004, HW - 0.0004, v(0.0122));
    // pocket around the jack
    a.rect(0, v(JACK_Y), 0.0206, 0.0174, '#1b1c1d', undefined, 0, 0.0008);
    a.rect(0, v(JACK_Y), 0.0206, 0.0174, undefined, 'rgba(255,255,255,0.25)', 0.0003, 0.0008);
  });
}

function footTexture() {
  return canvasTexture('clx:l8:foot', 320, Math.round((320 * Y_FOOT) / W), (ctx, w, h) => {
    const a = new Art(ctx, -HW, HW, 0, Y_FOOT, w, h);
    a.plastic(GRAY, 5);
    emboss(a, 'EtherNet/IP', -0.0012, 0.0046, 0.0034, { weight: 700 });
    a.text('™', 0.0118, 0.0059, 0.0016, { weight: 700, color: GRAY_TXT, font: FONT });
  });
}

/** Left side of the gray bezel: "CAUTION ! HOT !" with hot-surface symbols, reading bottom to top. */
function sideTexture() {
  const L = MOD_H;
  return canvasTexture('clx:l8:side', 96, Math.round((96 * L) / BEZEL_D), (ctx, w, h) => {
    const a = new Art(ctx, 0, BEZEL_D, 0, L, w, h);
    a.plastic(GRAY, 5);
    const x = BEZEL_D * 0.62;
    emboss(a, 'CAUTION ! HOT !', x, 0.056, 0.0042, { rotate: -Math.PI / 2, weight: 800 });
    for (const y of [0.017, 0.098]) {
      // hot-surface symbol: triangle with heat waves
      ctx.strokeStyle = GRAY_TXT;
      ctx.lineWidth = Math.max(1, a.m(0.0003));
      ctx.beginPath();
      ctx.moveTo(a.px(x - 0.0024), a.py(y - 0.0032));
      ctx.lineTo(a.px(x + 0.0026), a.py(y));
      ctx.lineTo(a.px(x - 0.0024), a.py(y + 0.0032));
      ctx.closePath();
      ctx.stroke();
      for (const dy of [-0.0011, 0, 0.0011]) a.line(x - 0.0014, y + dy, x + 0.0008, y + dy, GRAY_TXT, 0.00025);
    }
  });
}

// ---------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------

/** Black anodised heat-sink body with vertical fins on both sides (one merged mesh). */
function sinkGeometry() {
  return cachedGeo('clx:l8:sink', () => {
    const z0 = 0.004;
    const z1 = BEZEL_Z0;
    const core = 0.0012; // fins stand this far out of the core on each side
    const parts: THREE.BufferGeometry[] = [rboxAt(W - 2 * core, MOD_H - 0.002, z1 - z0, 0, MOD_H / 2, (z0 + z1) / 2, 0.0008)];
    const pitch = 0.0021;
    const n = Math.floor((z1 - z0 - 0.002) / pitch);
    for (let i = 0; i < n; i++) {
      const z = z0 + 0.0015 + i * pitch;
      for (const s of [-1, 1]) parts.push(new THREE.BoxGeometry(core, MOD_H - 0.004, 0.0008).translate(s * (HW - core / 2), MOD_H / 2, z));
    }
    // top & bottom rails the fins tie into
    parts.push(rboxAt(W, 0.0022, z1 - z0, 0, MOD_H - 0.0011, (z0 + z1) / 2, 0.0006));
    parts.push(rboxAt(W, 0.0022, z1 - z0, 0, 0.0011, (z0 + z1) / 2, 0.0006));
    parts.push(...lockingTabParts(MOD_H));
    return merge(parts);
  });
}

/** Side profile (z, y) of the gray bezel below the cap. */
function bezelProfile(top: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(BEZEL_Z0, 0);
  s.lineTo(FACE - SLOPE_BACK, 0);
  s.lineTo(FACE - SLOPE_BACK, Y_FOOT);
  s.lineTo(FACE, Y_SLOPE);
  s.lineTo(FACE, top);
  s.lineTo(BEZEL_Z0, top);
  s.closePath();
  return s;
}

/** Left-side decal shaped like the bezel profile (full height), facing -X; UVs span BEZEL_D x MOD_H. */
function sideDecalGeometry() {
  return cachedGeo('clx:l8:sideDecal', () => {
    const g = new THREE.ShapeGeometry(bezelProfile(MOD_H));
    const pos = g.attributes.position!;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - BEZEL_Z0) / BEZEL_D;
      uv[i * 2 + 1] = pos.getY(i) / MOD_H;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // shape (z, y) in its XY plane, facing +Z -> x = -HW plane facing -X, shape x -> world z
    return g.rotateY(-Math.PI / 2).translate(-HW - 0.0001, 0, 0);
  });
}

/** Light-gray bezel: cap frame, door, USB zone, sloped lower front and foot. */
function bezelGeometry() {
  return cachedGeo('clx:l8:bezel', () => {
    // side profile (z, y) of the bezel, extruded across the module width
    const s = bezelProfile(Y_CAP);
    const body = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false, curveSegments: 1 }).rotateY(-Math.PI / 2).translate(HW, 0, 0);
    // gray walls around the cap's black face (top section)
    const capBack = rboxAt(W, MOD_H - Y_CAP, CAP_FACE_Z - BEZEL_Z0, 0, (MOD_H + Y_CAP) / 2, (BEZEL_Z0 + CAP_FACE_Z) / 2, 0.0006);
    return merge([body, capBack]);
  });
}

/** Clear smoked cap over the display block (wraps the front and the top). */
function capGeometry() {
  return cachedGeo('clx:l8:cap', () =>
    merge([
      rboxAt(W + 0.0003, MOD_H - Y_CAP + 0.0003, CAP_FRONT_Z - CAP_FACE_Z + 0.0004, 0, (MOD_H + Y_CAP) / 2, (CAP_FRONT_Z + CAP_FACE_Z) / 2 - 0.0002, 0.0012),
    ]),
  );
}

/** Round black lock plug with the keyway slot (rotates with the key position). */
function plugGeometry() {
  return cachedGeo('clx:l8:plug', () => merge([cylZ(KEY.plugR, 0.0016, 0, 0, 0.0008, 40), cylZ(KEY.plugR - 0.0008, 0.0008, 0, 0, 0.002, 40)]));
}
const keywayGeo = new THREE.BoxGeometry(0.0013, 0.0074, 0.0004);

/** Portrait USB-B receptacle: metal shell, dark cavity, orange contact tongue. Origin = face center. */
function UsbPortrait() {
  const shell = cachedGeo('clx:l8:usbShell', () => {
    const outer = new THREE.Shape();
    const w = 0.0078;
    const h = 0.0092;
    const c = 0.0016;
    outer.moveTo(-w / 2, -h / 2);
    outer.lineTo(w / 2, -h / 2);
    outer.lineTo(w / 2, h / 2);
    outer.lineTo(-w / 2 + c, h / 2);
    outer.lineTo(-w / 2, h / 2 - c);
    outer.closePath();
    const inner = new THREE.Path();
    const i = 0.0006;
    inner.moveTo(-w / 2 + i, -h / 2 + i);
    inner.lineTo(-w / 2 + i, h / 2 - c);
    inner.lineTo(-w / 2 + c, h / 2 - i);
    inner.lineTo(w / 2 - i, h / 2 - i);
    inner.lineTo(w / 2 - i, -h / 2 + i);
    inner.closePath();
    outer.holes.push(inner);
    return new THREE.ExtrudeGeometry(outer, { depth: 0.0014, bevelEnabled: false, curveSegments: 1 });
  });
  const cavity = cachedGeo('clx:l8:usbCavity', () => new THREE.PlaneGeometry(0.0068, 0.0082));
  const tongue = cachedGeo('clx:l8:usbTongue', () => rboxAt(0.0034, 0.0056, 0.001, 0.0005, -0.0002, 0.0007, 0.0002));
  return (
    <group position={[USB.x, USB.y, FACE]}>
      <mesh geometry={cavity} material={MAT.hole()} position={[0, 0, 0.00018]} />
      <mesh geometry={tongue} material={materials.plastic('#d8641f', 0.45)} />
      <mesh geometry={shell} material={MAT.nickel()} />
    </group>
  );
}

/** RJ45 patch cable coming out of the sloped port and hanging down. Origin = jack face center, jack facing +Z. */
function SlopeCable({ color }: { color: string }) {
  const geo = cachedGeo(`clx:l8:cable:${color}`, () => {
    const boot = merge([rboxAt(0.0112, 0.0132, 0.012, 0, 0, 0.006, 0.0015), cylZ(0.0052, 0.012, 0, 0, 0.017, 16, 0.0034)]);
    // the cable leaves along +Z and bends down (-Y, i.e. along -Y in jack-local space rotated back to world below)
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0.022),
      new THREE.Vector3(0, -0.004, 0.034),
      new THREE.Vector3(0, -0.02, 0.043),
      new THREE.Vector3(0, -0.06, 0.05),
      new THREE.Vector3(0, -0.1, 0.052),
    ]);
    const cable = new THREE.TubeGeometry(curve, 24, 0.0029, 10, false);
    return merge([boot, cable]);
  });
  const plug = cachedGeo('clx:l8:plug8p8c', () => new THREE.BoxGeometry(0.0116, 0.0081, 0.006).translate(0, 0, -0.001));
  return (
    <group>
      <mesh geometry={plug} material={MAT.clearPlastic()} />
      <mesh geometry={geo} material={materials.plastic(color, 0.5)} castShadow />
    </group>
  );
}

/** Default activity flicker for LINK indicators. */
export function linkActivity(seed = 0): () => StatusLedState {
  return () => {
    const t = performance.now() * 0.001 + seed;
    return Math.sin(t * 23.1) + Math.sin(t * 7.3 + seed) > 0.4 ? 'off' : 'green';
  };
}

const NET_GREEN = (): StatusLedState => 'green';

const SIDE_LINES: Record<ControllerCatalog1756, string[]> = {
  '1756-L85E': ['40 MB user memory', '1 Gbps EtherNet/IP port', 'USB 2.0 · SD card'],
  '1756-L83E': ['10 MB user memory', '1 Gbps EtherNet/IP port', 'USB 2.0 · SD card'],
};

export function Controller1756L8({
  catalog = '1756-L85E',
  getStatus,
  onKeySwitch,
  getNet,
  getLink,
  cable = true,
  onSelect,
  highlighted,
  sideLabel = true,
  position,
  rotation,
  scale,
}: Controller1756L8Props) {
  const capFace = capFaceTexture(catalog);
  const door = doorTexture();
  const slope = slopeTexture();
  const foot = footTexture();
  const side = sideTexture();
  const slopePlane = cachedGeo('clx:l8:slopePlane', () => new THREE.PlaneGeometry(W, SLOPE_LEN));

  const powered = !!getStatus;
  const linkDefault = useMemo(() => linkActivity(0.7), []);

  const getText = useCallback(() => (getStatus ? getStatus().displayText : ''), [getStatus]);
  const runLed = useCallback((): StatusLedState => (getStatus?.().runLed === 'green' ? 'green' : 'off'), [getStatus]);
  const forceLed = useCallback((): StatusLedState => {
    const f = getStatus?.().forceLed;
    return f === 'amber' ? 'amber' : f === 'flashing-amber' ? 'flashing-amber' : 'off';
  }, [getStatus]);
  const sdLed = useCallback((): StatusLedState => 'off', []);
  const okLed = useCallback((): StatusLedState => {
    const o = getStatus?.().ok;
    return o === 'green' ? 'green' : o === 'red' ? 'red' : o === 'flashing-red' ? 'flashing-red' : 'off';
  }, [getStatus]);
  const netLed = useCallback((): StatusLedState => (powered ? (getNet ?? NET_GREEN)() : 'off'), [powered, getNet]);
  const linkLed = useCallback((): StatusLedState => (powered ? (getLink ?? linkDefault)() : 'off'), [powered, getLink, linkDefault]);

  // --- key position animation (the keyway turns) ---
  const plugRef = useRef<THREE.Group>(null);
  const ghostRef = useRef<THREE.Mesh>(null);
  const keyAngle = useRef(KEY_ANGLE[getStatus?.().keySwitch ?? 'REM']);
  const hoverRef = useRef<KeySwitch | null>(null);
  useFrame((_, dt) => {
    const g = plugRef.current;
    if (!g) return;
    const current = getStatus?.().keySwitch ?? 'REM';
    const ghost = ghostRef.current;
    if (ghost) {
      const hz = hoverRef.current;
      ghost.visible = hz !== null && hz !== current;
      if (hz) ghost.rotation.z = KEY_ANGLE[hz];
    }
    const target = KEY_ANGLE[current];
    const a = keyAngle.current;
    if (Math.abs(target - a) < 1e-4) {
      if (g.rotation.z !== target) g.rotation.z = target;
      return;
    }
    keyAngle.current = a + (target - a) * Math.min(1, dt * 12);
    g.rotation.z = keyAngle.current;
  });

  // --- key switch interaction: left of the lock = RUN, the lock = REM, right = PROG (lock-local x) ---
  const lockRef = useRef<THREE.Group>(null);
  const hitRef = useRef<THREE.Mesh>(null);
  const keyDown = useRef(false);
  const [hoverZone, setHoverZone] = useState<KeySwitch | null>(null);
  useCursor(hoverZone !== null && !!onKeySwitch);
  const zoneOf = useCallback((e: ThreeEvent<PointerEvent>): KeySwitch => {
    const lock = lockRef.current;
    if (!lock || e.object !== hitRef.current) return 'REM';
    lock.worldToLocal(_v.copy(e.point));
    return _v.x < -REM_HALF ? 'RUN' : _v.x > REM_HALF ? 'PROG' : 'REM';
  }, []);
  const keyHandlers = onKeySwitch
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const z = zoneOf(e);
          hoverRef.current = z;
          setHoverZone(z);
        },
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const z = zoneOf(e);
          hoverRef.current = z;
          setHoverZone(z);
        },
        onPointerOut: () => {
          hoverRef.current = null;
          setHoverZone(null);
          keyDown.current = false;
        },
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          keyDown.current = true;
        },
        onPointerUp: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (keyDown.current && e.delta < 8) onKeySwitch(zoneOf(e));
          keyDown.current = false;
        },
      }
    : {};
  // hit plate: the door's width, from the door's parting line to the cap
  const hitH = Y_CAP - Y_DOOR - 0.002;
  const hitGeo = cachedGeo('clx:l8:keyhit', () => new THREE.BoxGeometry(W - 0.001, hitH, 0.0008));

  const jackZ = slopeZ(JACK_Y) - 0.0012;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={[W + 0.0018, MOD_H + 0.0018, 0.018]} center={[0, MOD_H / 2, FACE - 0.0075]} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={sinkGeometry()} material={MAT_SINK()} castShadow />
        <mesh geometry={bezelGeometry()} material={MAT_GRAY()} castShadow />

        {/* display block under the clear cap */}
        <ArtPlane tex={capFace} x0={-HW + 0.0004} x1={HW - 0.0004} y0={Y_CAP + 0.0004} y1={MOD_H - 0.0004} z={CAP_FACE_Z + 0.0001} />
        <DotMatrixDisplay getText={getText} width={DISPLAY.w} height={DISPLAY.h} position={[DISPLAY.x, DISPLAY.y, CAP_FACE_Z + 0.0002]} />
        {STATUS_X.map((x, i) => (
          <StatusLed key={x} get={[runLed, forceLed, sdLed, okLed][i]!} offColor={i === 1 ? 'amber' : 'green'} size={LED_SIZE} position={[x, STATUS_ROW_Y, CAP_FACE_Z + 0.0002]} />
        ))}
        <StatusLed get={netLed} size={LED_SIZE} position={[NET_LED.x - 0.0036, NET_LED.y + 0.0006, CAP_FACE_Z + 0.0002]} />
        <StatusLed get={linkLed} size={LED_SIZE} position={[LINK_LED.x - 0.0036, LINK_LED.y + 0.0006, CAP_FACE_Z + 0.0002]} />
        <mesh geometry={capGeometry()} material={capMat} raycast={() => null} renderOrder={2} />

        {/* door + USB zone */}
        <ArtPlane tex={door} x0={-HW} x1={HW} y0={Y_SLOPE} y1={Y_CAP} z={FACE + 0.0001} />
        <group ref={lockRef} position={[KEY.x, KEY.y, FACE]} {...keyHandlers}>
          <group ref={plugRef} rotation-z={keyAngle.current}>
            <mesh geometry={plugGeometry()} material={MAT_KEY()} castShadow />
            <mesh geometry={keywayGeo} material={MAT.hole()} position={[0, 0, 0.0025]} />
          </group>
          <mesh ref={ghostRef} geometry={keywayGeo} material={ghostMat} visible={false} raycast={() => null} position={[0, 0, 0.0027]} />
          <mesh ref={hitRef} geometry={hitGeo} material={MAT.invisible()} position={[-KEY.x, (Y_DOOR + Y_CAP) / 2 - KEY.y, 0.0005]} visible={!!onKeySwitch} />
        </group>
        <UsbPortrait />

        {/* sloped lower front with the EtherNet/IP port, and the foot */}
        <mesh
          geometry={slopePlane}
          material={texMaterial(slope)}
          position={[0, (Y_FOOT + Y_SLOPE) / 2, FACE - SLOPE_BACK / 2 + 0.0001]}
          rotation={[SLOPE_ANGLE, 0, 0]}
        />
        <ArtPlane tex={foot} x0={-HW} x1={HW} y0={0} y1={Y_FOOT} z={FACE - SLOPE_BACK + 0.0001} />
        <group position={[0, JACK_Y, jackZ]} rotation={[SLOPE_ANGLE, 0, 0]}>
          <Rj45Jack />
          {cable && <SlopeCable color="#2f9d62" />}
        </group>

        {/* embossed caution legend on the left side of the bezel */}
        <mesh geometry={sideDecalGeometry()} material={texMaterial(side)} />
        {sideLabel && <SideLabel catalog={catalog} title="ControlLogix 5580 Controller" lines={SIDE_LINES[catalog]} height={MOD_H} />}
      </Selectable>
    </group>
  );
}
