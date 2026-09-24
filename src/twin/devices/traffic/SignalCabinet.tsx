/**
 * Base-mounted traffic signal controller cabinet (NEMA TS-2 "P"-size style, ≈ 55" H × 44" W × 26" D):
 * mill-finish aluminum body with a sloped overhanging roof, rain drip over the door, louvered filtered
 * intake vents, 3-point latch handle with padlock hasp, piano hinges, a small POLICE PANEL door (for
 * flash / manual switches), a rear door, anchor pad on a concrete base.
 *
 * Interior (static, one merged mesh + one instanced LED mesh): 12-position load bay with plug-in load
 * switches (R/Y/G indicator LEDs — drive them with `getLoadSwitchLed`), flash-transfer relays, power
 * panel with breakers & GFCI outlet, DIN rail with terminal blocks between slotted wire ducts, MMU
 * (malfunction management unit) and a detector card rack on the shelf, roof fan + thermostat, LED
 * cabinet light, door switch, and a print pocket on the inside of the front door.
 *
 * Controller clear zone: `SIGNAL_CABINET_DIMS.controllerZone` — a 0.5 × 0.3 m area on the back panel
 * (back-panel coordinates, directly above the shelf) kept free for the controller (e.g. a
 * CompactLogix rack passed as `children`).
 *
 * Origin: ground at the cabinet center; the door faces +Z. Interior children use back-panel
 * coordinates (origin = center of the back panel's front surface, +Z toward the door).
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import {
  FINISH,
  INCH,
  boxGeo,
  canvasTex,
  cylY,
  cylZ,
  hoverMat,
  makeCanvas,
  mergeAll,
  mergeVc,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedMat,
  sharedTex,
  tmats,
  useClickable,
  useDisposable,
  vc,
  vcMaterial,
  xf,
  type VcFinish,
} from './shared';

export interface SignalCabinetProps extends Placement {
  /** Main door open angle (rad, 0 = closed). Ignored when `getDoorAngle` is given. */
  doorAngle?: number;
  getDoorAngle?: () => number;
  /** Door click (pointer cursor + highlight on hover). */
  onDoorClick?: () => void;
  /** Interior equipment (back-panel coordinates). Keep the controller inside `controllerZone`. */
  children?: ReactNode;
  /** Items on the police panel (panel-local coords: origin = panel center, +Z out). */
  policePanel?: ReactNode;
  /** Body finish color (default mill-finish aluminum). */
  color?: string;
  /** Cabinet ID stenciled on the door. */
  label?: string;
  /**
   * Load-switch indicator LEDs: slot 0..11, lamp 0 = red, 1 = yellow, 2 = green. Called every frame
   * (must not allocate). Default: all dark.
   */
  getLoadSwitchLed?: (slot: number, lamp: 0 | 1 | 2) => boolean;
}

export const SIGNAL_CABINET_DIMS = {
  width: 44 * INCH,
  height: 55 * INCH,
  depth: 26 * INCH,
  base: 0.12,
  /** Clear zone for the controller on the back panel (back-panel coords): x, y ranges (m). */
  controllerZone: { x: [-0.25, 0.25], y: [-0.08, 0.22] } as { x: [number, number]; y: [number, number] },
  /** Shelf top surface (back-panel y) and depth (m). */
  shelfY: -0.12,
  shelfDepth: 0.42,
  loadSwitches: 12,
} as const;
const C = SIGNAL_CABINET_DIMS;

function stencilTexture(text: string): THREE.CanvasTexture {
  return sharedTex(`cab:stencil:${text}`, () => {
    const [c, ctx] = makeCanvas(512, 160);
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px "Arial Narrow", Arial, Helvetica, sans-serif';
    ctx.fillText(text, 256, 52);
    ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
    ctx.fillText('DANGER — 120 VAC', 256, 118);
    return canvasTex(c);
  });
}

function policeTexture(): THREE.CanvasTexture {
  return sharedTex('cab:police', () => {
    const [c, ctx] = makeCanvas(256, 64);
    ctx.fillStyle = '#e8e8e2';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 34px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLICE', 128, 33);
    return canvasTex(c);
  });
}

/** Equipment legends (MMU, detector rack, load bay, power panel) in one atlas. */
function legendTexture(): THREE.CanvasTexture {
  return sharedTex('cab:legends', () => {
    const [c, ctx] = makeCanvas(512, 256);
    ctx.fillStyle = '#e9ebe6';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
    ctx.fillText('MMU-16', 128, 32);
    ctx.fillText('DETECTORS', 384, 32);
    ctx.fillText('LOAD BAY  1 – 12', 128, 96);
    ctx.fillText('POWER PANEL', 384, 96);
    ctx.font = 'bold 22px Arial, Helvetica, sans-serif';
    ctx.fillText('FLASH XFER', 128, 160);
    ctx.fillText('FIELD TERMINALS', 384, 160);
    ctx.fillText('CONTROLLER', 256, 224);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    for (let x = 0; x < 2; x++) for (let y = 0; y < 4; y++) ctx.strokeRect(x * 256 + 4, y * 64 + 4, 248, 56);
    return canvasTex(c);
  });
}

/** Plane with UVs cropped to one cell of the 2 × 4 legend atlas. */
function legendPlane(w: number, h: number, col: number, row: number, span2 = false): THREE.BufferGeometry {
  return sharedGeo(`cab:legend:${w}:${h}:${col}:${row}:${span2}`, () => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv!;
    const u0 = span2 ? 0 : col / 2;
    const u1 = span2 ? 1 : (col + 1) / 2;
    const v0 = 1 - (row + 1) / 4;
    const v1 = 1 - row / 4;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    return g;
  });
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const W = C.width;
const H = C.height;
const D = C.depth;
const B = C.base;
const DOOR_W = W - 0.02;
const DOOR_H = H - 0.06;

/** Load-switch slot centers (back-panel coords): x positions, LED y, LED front z. */
const LS = {
  pitch: 0.062,
  y: -0.36,
  ledZ: 0.18,
  x: (i: number) => (i - (C.loadSwitches - 1) / 2) * 0.062 - 0.08,
};

function shellGeometry(color: string): THREE.BufferGeometry {
  return sharedGeo(`cab:shell2:${color}`, () => {
    const body: VcFinish = { color, roughness: 0.38, metalness: 0.7 };
    const t = 0.004;
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, f: VcFinish, pos?: [number, number, number], rot?: [number, number, number]) => parts.push(vc(xf(g, pos, rot), f));
    add(boxGeo(W, H, t), body, [0, B + H / 2, -D / 2 + t / 2]); // back (rear door frame)
    for (const s of [-1, 1]) add(boxGeo(t, H, D), body, [s * (W / 2 - t / 2), B + H / 2, 0]); // sides
    add(boxGeo(W, t, D), body, [0, B + t / 2, 0]); // floor
    // sloped roof with overhang + drip edge
    const roof = new THREE.Shape();
    roof.moveTo(-D / 2 - 0.04, 0);
    roof.lineTo(D / 2 + 0.06, 0);
    roof.lineTo(D / 2 + 0.06, 0.02);
    roof.lineTo(-D / 2 - 0.04, 0.06);
    roof.closePath();
    const rg = new THREE.ExtrudeGeometry(roof, { depth: W + 0.06, bevelEnabled: false });
    rg.translate(0, 0, -(W + 0.06) / 2);
    rg.rotateY(-Math.PI / 2);
    add(rg, body, [0, B + H, 0]);
    // rain drip over the door
    add(boxGeo(W - 0.04, 0.012, 0.03), body, [0, B + H - 0.03, D / 2 + 0.015]);
    // front door frame lip
    for (const s of [-1, 1]) add(boxGeo(0.03, H - 0.02, 0.012), body, [s * (W / 2 - 0.015), B + H / 2, D / 2 - 0.006]);
    // REAR DOOR (−Z): panel seam, piano hinge, latch handle + lock, louvers
    const zr = -D / 2 - 0.002;
    add(roundedBox(W - 0.04, H - 0.07, 0.003, 0.004, 1), FINISH.blackPlastic, [0, B + H / 2 - 0.01, zr + 0.0005]);
    add(roundedBox(W - 0.05, H - 0.08, 0.006, 0.004, 1), body, [0, B + H / 2 - 0.01, zr - 0.002]);
    add(cylY(0.008, 0.008, H - 0.12, 10), FINISH.stainless, [W / 2 - 0.03, B + H / 2 - 0.01, zr - 0.006]);
    add(roundedBox(0.04, 0.2, 0.02, 0.008, 2), FINISH.stainless, [-W / 2 + 0.09, B + H / 2, zr - 0.012]);
    add(roundedBox(0.03, 0.14, 0.03, 0.01, 2), FINISH.stainless, [-W / 2 + 0.09, B + H / 2 - 0.02, zr - 0.024]);
    for (let i = 0; i < 6; i++) add(boxGeo(W * 0.5, 0.012, 0.02), { color: '#8f9498', roughness: 0.5, metalness: 0.8 }, [0, B + 0.12 + i * 0.03, zr - 0.012], [-0.6, 0, 0]);
    return mergeVc(parts);
  });
}

function interiorGeometry(): THREE.BufferGeometry {
  return sharedGeo('cab:interior2', () => {
    const parts: THREE.BufferGeometry[] = [];
    // back-panel coordinates → cabinet coordinates
    const Y0 = B + H / 2;
    const Z0 = -D / 2 + 0.008;
    const add = (g: THREE.BufferGeometry, f: VcFinish, pos: [number, number, number], rot?: [number, number, number]) =>
      parts.push(vc(xf(g, [pos[0], pos[1] + Y0, pos[2] + Z0], rot), f));
    const white: VcFinish = { color: '#eeeeea', roughness: 0.7, metalness: 0 };
    const grayDuct: VcFinish = { color: '#8e9296', roughness: 0.6, metalness: 0 };
    const blackBox: VcFinish = { color: '#1d1f22', roughness: 0.5, metalness: 0.1 };
    const beige: VcFinish = { color: '#cfc8b4', roughness: 0.6, metalness: 0 };
    const din = { color: '#b9bec2', roughness: 0.3, metalness: 0.9 };
    const iw = W - 0.06;
    // back panel (white, 3 mm) + side rails
    add(boxGeo(iw, H - 0.1, 0.003), white, [0, 0, -0.0015]);
    for (const s of [-1, 1]) add(boxGeo(0.03, H - 0.1, 0.03), din, [s * (iw / 2 - 0.02), 0, 0.015]);
    // wire ducts (slotted gray) + DIN rail with terminal blocks between them
    for (const y of [0.55, 0.3]) {
      add(boxGeo(iw - 0.08, 0.06, 0.07), grayDuct, [0, y, 0.035]);
      for (let x = -iw / 2 + 0.07; x < iw / 2 - 0.06; x += 0.03) add(boxGeo(0.004, 0.061, 0.071), { color: '#6d7175', roughness: 0.6, metalness: 0 }, [x, y, 0.035]);
    }
    add(boxGeo(iw - 0.1, 0.035, 0.008), din, [0, 0.425, 0.004]);
    for (let x = -iw / 2 + 0.08; x < iw / 2 - 0.08; x += 0.0082) add(boxGeo(0.0062, 0.07, 0.045), x > 0.25 ? { color: '#2f64b8', roughness: 0.5, metalness: 0 } : beige, [x, 0.425, 0.03]);
    // flash-transfer relays (left of the controller zone) on a DIN rail
    add(boxGeo(0.2, 0.035, 0.008), din, [-0.39, 0.12, 0.004]);
    for (let i = 0; i < 4; i++) {
      const x = -0.46 + i * 0.047;
      add(roundedBox(0.04, 0.06, 0.05, 0.004, 1), { color: '#d9c38a', roughness: 0.35, metalness: 0 }, [x, 0.12, 0.033]); // clear-ish cube relay
      add(boxGeo(0.042, 0.03, 0.03), blackBox, [x, 0.075, 0.015]); // socket
    }
    // 24 V power supply below the relays
    add(roundedBox(0.09, 0.12, 0.1, 0.006, 1), { color: '#9aa1a8', roughness: 0.4, metalness: 0.7 }, [-0.4, -0.02, 0.05]);
    // power panel (right of the zone): breakers, GFCI outlet
    add(roundedBox(0.2, 0.3, 0.06, 0.006, 1), { color: '#c9ccc9', roughness: 0.5, metalness: 0.3 }, [0.39, 0.07, 0.03]);
    for (let i = 0; i < 4; i++) add(roundedBox(0.026, 0.07, 0.03, 0.003, 1), blackBox, [0.33 + i * 0.034, 0.14, 0.07]);
    add(roundedBox(0.07, 0.11, 0.02, 0.006, 1), { color: '#f1efe8', roughness: 0.4, metalness: 0 }, [0.39, -0.02, 0.07]); // GFCI duplex
    for (const y of [0.0, -0.04]) add(boxGeo(0.03, 0.02, 0.004), blackBox, [0.39, y, 0.081]);
    // shelf
    add(boxGeo(iw, 0.02, C.shelfDepth), { color: '#d9d9d4', roughness: 0.7, metalness: 0.2 }, [0, C.shelfY - 0.01, C.shelfDepth / 2]);
    add(boxGeo(iw, 0.04, 0.02), { color: '#d9d9d4', roughness: 0.7, metalness: 0.2 }, [0, C.shelfY - 0.03, C.shelfDepth - 0.01]);
    // MMU on the shelf (left)
    add(roundedBox(0.26, 0.14, 0.26, 0.008, 1), { color: '#3a4652', roughness: 0.45, metalness: 0.5 }, [-0.34, C.shelfY + 0.07, 0.16]);
    add(boxGeo(0.24, 0.12, 0.004), blackBox, [-0.34, C.shelfY + 0.07, 0.292]);
    // detector card rack on the shelf (right): frame + 5 cards
    add(roundedBox(0.26, 0.16, 0.24, 0.006, 1), { color: '#9aa1a8', roughness: 0.4, metalness: 0.7 }, [0.34, C.shelfY + 0.08, 0.15]);
    for (let i = 0; i < 5; i++) add(boxGeo(0.04, 0.14, 0.006), blackBox, [0.25 + i * 0.045, C.shelfY + 0.08, 0.273]);
    // load bay (below the shelf): back frame + 12 plug-in load switches
    add(roundedBox(LS.pitch * C.loadSwitches + 0.05, 0.2, 0.05, 0.006, 1), { color: '#9aa1a8', roughness: 0.4, metalness: 0.7 }, [LS.x(5.5), LS.y, 0.025]);
    for (let i = 0; i < C.loadSwitches; i++) add(roundedBox(0.055, 0.13, LS.ledZ - 0.05, 0.004, 1), blackBox, [LS.x(i), LS.y, 0.05 + (LS.ledZ - 0.05) / 2]);
    // field terminal strip at the bottom
    add(boxGeo(iw - 0.12, 0.05, 0.03), blackBox, [0, -0.54, 0.015]);
    for (let x = -iw / 2 + 0.09; x < iw / 2 - 0.08; x += 0.024) add(cylZ(0.006, 0.006, 0.01, 6), FINISH.stainless, [x, -0.54, 0.034]);
    // roof fan + thermostat, LED cabinet light, door switch
    add(cylY(0.07, 0.07, 0.05, 24), blackBox, [0.3, H / 2 - 0.08, 0.3]);
    add(boxGeo(0.06, 0.09, 0.04), { color: '#e8e6df', roughness: 0.5, metalness: 0 }, [-iw / 2 + 0.05, H / 2 - 0.2, 0.3]);
    add(roundedBox(0.5, 0.02, 0.04, 0.008, 1), { color: '#f4f4ee', roughness: 0.3, metalness: 0 }, [0, H / 2 - 0.07, D - 0.14]);
    add(boxGeo(0.04, 0.06, 0.04), blackBox, [-iw / 2 + 0.03, 0.2, D - 0.1]);
    return mergeVc(parts);
  });
}

/** Front door (hinged on its left edge, door-local frame): panel, stiffeners, police panel door,
 * vents, hardware, and the print pocket on the inside. */
function doorGeometry(color: string): THREE.BufferGeometry {
  return sharedGeo(`cab:door2:${color}`, () => {
    const body: VcFinish = { color, roughness: 0.38, metalness: 0.7 };
    const hw: VcFinish = { color: '#d3d7da', roughness: 0.25, metalness: 0.9 };
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, f: VcFinish, pos: [number, number, number], rot?: [number, number, number]) => parts.push(vc(xf(g, pos, rot), f));
    add(roundedBox(DOOR_W, DOOR_H, 0.02, 0.006, 1), body, [DOOR_W / 2, 0, 0.01]);
    add(boxGeo(DOOR_W - 0.04, 0.02, 0.03), body, [DOOR_W / 2, DOOR_H / 2 - 0.03, -0.015]);
    add(boxGeo(DOOR_W - 0.04, 0.02, 0.03), body, [DOOR_W / 2, -DOOR_H / 2 + 0.03, -0.015]);
    add(roundedBox(0.22, 0.28, 0.012, 0.004, 1), body, [DOOR_W - 0.2, DOOR_H / 2 - 0.3, 0.026]);
    for (let i = 0; i < 7; i++) add(boxGeo(DOOR_W * 0.6, 0.012, 0.02), { color: '#8f9498', roughness: 0.5, metalness: 0.8 }, [DOOR_W / 2, -DOOR_H / 2 + 0.08 + i * 0.03, 0.028], [0.6, 0, 0]);
    // filter frame behind the vents (inside)
    add(boxGeo(DOOR_W * 0.62, 0.24, 0.02), { color: '#5a5f63', roughness: 0.8, metalness: 0.1 }, [DOOR_W / 2, -DOOR_H / 2 + 0.17, -0.012]);
    // hardware: piano hinge, 3-point latch handle + hasp, lock, police panel hinge + keyhole
    add(cylY(0.008, 0.008, DOOR_H - 0.08, 10), hw, [-0.004, 0, 0.02]);
    add(roundedBox(0.04, 0.2, 0.02, 0.008, 2), hw, [DOOR_W - 0.07, 0, 0.03]);
    add(roundedBox(0.03, 0.14, 0.03, 0.01, 2), hw, [DOOR_W - 0.07, -0.02, 0.05]);
    add(boxGeo(0.05, 0.015, 0.03), hw, [DOOR_W - 0.07, 0.13, 0.035]);
    add(cylY(0.012, 0.012, 0.02, 14), hw, [DOOR_W - 0.07, 0.17, 0.03], [Math.PI / 2, 0, 0]);
    add(cylY(0.006, 0.006, 0.26, 8), hw, [DOOR_W - 0.31, DOOR_H / 2 - 0.3, 0.03]);
    add(cylY(0.01, 0.01, 0.015, 12), hw, [DOOR_W - 0.12, DOOR_H / 2 - 0.3, 0.035], [Math.PI / 2, 0, 0]);
    // print pocket (inside of the door) with a folded drawing set
    add(roundedBox(0.34, 0.3, 0.025, 0.006, 1), { color: '#2b2e31', roughness: 0.8, metalness: 0.05 }, [DOOR_W / 2 + 0.05, 0.12, -0.03]);
    add(boxGeo(0.3, 0.06, 0.012), { color: '#e8e4d6', roughness: 0.9, metalness: 0 }, [DOOR_W / 2 + 0.05, 0.28, -0.03]);
    return mergeVc(parts);
  });
}

const baseGeometry = () => sharedGeo('cab:base2', () => mergeAll([xf(roundedBox(W + 0.3, 0.2, D + 0.3, 0.02, 1), [0, 0.02, 0]), xf(boxGeo(W + 0.02, B - 0.12, D + 0.02), [0, 0.12 + (B - 0.12) / 2, 0])]));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const LED_ON = [new THREE.Color(6, 0.25, 0.1), new THREE.Color(6, 3.2, 0.1), new THREE.Color(0.2, 5, 2.4)];
const LED_OFF = [new THREE.Color(0.28, 0.03, 0.02), new THREE.Color(0.28, 0.17, 0.02), new THREE.Color(0.02, 0.22, 0.1)];

export function SignalCabinet({
  doorAngle = 0,
  getDoorAngle,
  onDoorClick,
  children,
  policePanel,
  color = '#b9bec2',
  label = 'SIGNAL CONTROLLER',
  getLoadSwitchLed,
  position,
  rotation,
  scale,
}: SignalCabinetProps) {
  const door = useRef<THREE.Group>(null);
  const leds = useRef<THREE.InstancedMesh>(null);
  const g = useRef({ getDoorAngle, getLoadSwitchLed });
  g.current = { getDoorAngle, getLoadSwitchLed };
  const n = C.loadSwitches * 3;
  const ledMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  useDisposable(useMemo(() => [ledMat], [ledMat]));
  useLayoutEffect(() => {
    const m = leds.current;
    if (!m) return;
    const mx = new THREE.Matrix4();
    for (let i = 0; i < C.loadSwitches; i++)
      for (let k = 0; k < 3; k++) {
        mx.makeTranslation(LS.x(i), B + H / 2 + LS.y + 0.035 - k * 0.022, -D / 2 + 0.008 + LS.ledZ + 0.002);
        m.setMatrixAt(i * 3 + k, mx);
        m.setColorAt(i * 3 + k, LED_OFF[k]!);
      }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  const lastLed = useRef(new Uint8Array(n).fill(2));
  useFrame(() => {
    if (door.current) door.current.rotation.y = -(g.current.getDoorAngle ? g.current.getDoorAngle() : doorAngle);
    const m = leds.current;
    const get = g.current.getLoadSwitchLed;
    if (!m) return;
    let dirty = false;
    for (let i = 0; i < C.loadSwitches; i++)
      for (let k = 0; k < 3; k++) {
        const on = get ? (get(i, k as 0 | 1 | 2) ? 1 : 0) : 0;
        const j = i * 3 + k;
        if (lastLed.current[j] === on) continue;
        lastLed.current[j] = on;
        m.setColorAt(j, on ? LED_ON[k]! : LED_OFF[k]!);
        dirty = true;
      }
    if (dirty && m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  const { hovered, handlers } = useClickable(onDoorClick);
  const doorGeo = doorGeometry(color);
  const Y0 = B + H / 2;
  const Z0 = -D / 2 + 0.008;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={baseGeometry()} material={tmats.concrete()} receiveShadow castShadow />
      <mesh geometry={shellGeometry(color)} material={vcMaterial()} castShadow receiveShadow />
      <mesh geometry={interiorGeometry()} material={vcMaterial()} castShadow receiveShadow />
      <instancedMesh ref={leds} args={[cylZ(0.005, 0.005, 0.004, 10), ledMat, n]} frustumCulled={false} />
      {/* equipment legends */}
      <group position={[0, Y0, Z0]}>
        <mesh geometry={legendPlane(0.2, 0.05, 0, 0)} position={[-0.34, C.shelfY + 0.115, 0.2951]} material={legendMat()} />
        <mesh geometry={legendPlane(0.2, 0.035, 1, 0)} position={[0.34, C.shelfY - 0.03, C.shelfDepth + 0.0005]} material={legendMat()} />
        <mesh geometry={legendPlane(0.3, 0.035, 0, 1)} position={[LS.x(5.5), LS.y + 0.12, 0.051]} material={legendMat()} />
        <mesh geometry={legendPlane(0.16, 0.035, 1, 1)} position={[0.39, 0.24, 0.061]} material={legendMat()} />
        <mesh geometry={legendPlane(0.16, 0.03, 0, 2)} position={[-0.39, 0.175, 0.001]} material={legendMat()} />
        <mesh geometry={legendPlane(0.3, 0.03, 1, 2)} position={[0, -0.495, 0.001]} material={legendMat()} />
      </group>
      <group position={[0, Y0, Z0]}>{children}</group>
      {/* main door (hinged on the left edge) */}
      <group ref={door} position={[-DOOR_W / 2, B + H / 2 - 0.01, D / 2]} {...handlers}>
        <mesh geometry={doorGeo} material={vcMaterial()} castShadow receiveShadow />
        {hovered && <mesh geometry={doorGeo} material={hoverMat()} />}
        <mesh geometry={planeGeo(0.5, 0.156)} position={[DOOR_W / 2 - 0.05, 0.12, 0.0205]} material={stencilMat(label)} />
        <mesh geometry={planeGeo(0.12, 0.03)} position={[DOOR_W - 0.2, DOOR_H / 2 - 0.19, 0.0325]} material={policeMat()} />
        <group position={[DOOR_W - 0.2, DOOR_H / 2 - 0.3, 0.033]}>{policePanel}</group>
      </group>
    </group>
  );
}

function legendMat(): THREE.MeshStandardMaterial {
  return sharedMat('cab:legendMat', () => new THREE.MeshStandardMaterial({ map: legendTexture(), roughness: 0.6 }));
}
function stencilMat(label: string): THREE.MeshStandardMaterial {
  return sharedMat(`cab:stencilMat:${label}`, () => new THREE.MeshStandardMaterial({ map: stencilTexture(label), transparent: true, roughness: 0.6 }));
}
function policeMat(): THREE.MeshStandardMaterial {
  return sharedMat('cab:policeMat', () => new THREE.MeshStandardMaterial({ map: policeTexture(), roughness: 0.5 }));
}
