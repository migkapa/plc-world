/**
 * <ControlLogixChassis/> — 1756-A4 / A7 / A10 / A13 / A17 zinc-plated steel chassis.
 *
 * Origin: back-bottom-LEFT of the chassis body (mounting tabs protrude 5.5 mm above/below).
 * The power-supply bay is on the left; slot 0 starts right of it (see `chassisLayout()`).
 */
import * as THREE from 'three';
import type { Placement } from '../../../contracts';
import {
  CHASSIS_H,
  SHEET,
  SHELF_BOTTOM_Y,
  SHELF_TOP_Y,
  SHELF_Z,
  SLOT_PITCH,
  TAB_H,
  chassisLayout,
  type ChassisCatalog,
  type ChassisLayout,
} from './dims';
import { Art, MAT, boxAt, cachedGeo, canvasTexture, merge, rboxAt, texMaterial } from './shared';

export interface ControlLogixChassisProps extends Placement {
  /** Chassis catalog number (default 1756-A7). */
  catalog?: ChassisCatalog;
}

// ---------------------------------------------------------------------------
// Geometry builders (cached per catalog)
// ---------------------------------------------------------------------------

function wallXs(l: ChassisLayout): { left: number; right: number } {
  // inner faces of the end walls
  return { left: l.psX0 - 0.0012, right: l.slot0X + l.slots * SLOT_PITCH + 0.0006 };
}

function tabCenters(l: ChassisLayout): number[] {
  const xs = [0.016, l.width - 0.016];
  if (l.slots >= 10) xs.splice(1, 0, l.slot0X + Math.floor(l.slots / 2) * SLOT_PITCH);
  return xs;
}

function keyhole(path: THREE.Path, cx: number, cy: number, dir: 1 | -1) {
  // round hole with a narrow slot extending into the body (dir: +1 up / -1 down)
  const r = 0.0024;
  const sw = 0.0011;
  const sl = 0.0045;
  const s = Math.sqrt(r * r - sw * sw);
  path.moveTo(cx + sw, cy + dir * s);
  path.lineTo(cx + sw, cy + dir * sl);
  path.lineTo(cx - sw, cy + dir * sl);
  path.lineTo(cx - sw, cy + dir * s);
  path.absarc(cx, cy, r, Math.atan2(dir * s, -sw), Math.atan2(dir * s, sw), dir < 0);
}

function backPlateGeometry(l: ChassisLayout): THREE.BufferGeometry {
  const W = l.width;
  const tabs = tabCenters(l);
  const tw = 0.019;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  // bottom edge with tabs (left to right)
  for (const cx of tabs) {
    s.lineTo(cx - tw / 2 - 0.002, 0);
    s.lineTo(cx - tw / 2, -TAB_H);
    s.lineTo(cx + tw / 2, -TAB_H);
    s.lineTo(cx + tw / 2 + 0.002, 0);
  }
  s.lineTo(W, 0);
  s.lineTo(W, CHASSIS_H);
  for (const cx of [...tabs].reverse()) {
    s.lineTo(cx + tw / 2 + 0.002, CHASSIS_H);
    s.lineTo(cx + tw / 2, CHASSIS_H + TAB_H);
    s.lineTo(cx - tw / 2, CHASSIS_H + TAB_H);
    s.lineTo(cx - tw / 2 - 0.002, CHASSIS_H);
  }
  s.lineTo(0, CHASSIS_H);
  s.closePath();
  for (const cx of tabs) {
    const hb = new THREE.Path();
    keyhole(hb, cx, -TAB_H + 0.0034, 1);
    s.holes.push(hb);
    const ht = new THREE.Path();
    keyhole(ht, cx, CHASSIS_H + TAB_H - 0.0034, -1);
    s.holes.push(ht);
  }
  return new THREE.ExtrudeGeometry(s, { depth: SHEET, bevelEnabled: false, curveSegments: 10 });
}

/** Horizontal shelf plate with vent slots. Returns geometry with its TOP surface at y = 0. */
function shelfGeometry(l: ChassisLayout): THREE.BufferGeometry {
  const { left, right } = wallXs(l);
  const s = new THREE.Shape();
  s.moveTo(left, SHEET);
  s.lineTo(right, SHEET);
  s.lineTo(right, SHELF_Z);
  s.lineTo(left, SHELF_Z);
  s.closePath();
  const slotW = 0.0032;
  const rows: Array<[number, number]> = [
    [0.018, 0.058],
    [0.066, 0.106],
  ];
  const addSlot = (cx: number, z0: number, z1: number) => {
    const p = new THREE.Path();
    const r = slotW / 2;
    p.moveTo(cx - r, z0 + r);
    p.lineTo(cx - r, z1 - r);
    p.absarc(cx, z1 - r, r, Math.PI, 0, true);
    p.lineTo(cx + r, z0 + r);
    p.absarc(cx, z0 + r, r, 0, Math.PI, true);
    s.holes.push(p);
  };
  for (let i = 0; i < l.slots; i++) {
    const c = l.slotCenterX(i);
    for (const dx of [-0.0105, 0, 0.0105]) for (const [z0, z1] of rows) addSlot(c + dx, z0, z1);
  }
  // power-supply bay: denser grille
  for (let k = 0; k < 9; k++) {
    const cx = l.psX0 + 0.012 + k * 0.011;
    for (const [z0, z1] of rows) addSlot(cx, z0, z1);
  }
  // shape (u=x, v=z) -> world; extrude downwards
  const g = new THREE.ExtrudeGeometry(s, { depth: SHEET, bevelEnabled: false, curveSegments: 4 });
  // rotateX(+90°): (x, y, z) -> (x, -z, y): shape v -> world z, extrusion depth -> world -y.
  g.rotateX(Math.PI / 2);
  return g;
}

function steelGeometry(l: ChassisLayout): THREE.BufferGeometry {
  return cachedGeo(`clx:chassis:steel:${l.catalog}`, () => {
    const { left, right } = wallXs(l);
    const bottom = shelfGeometry(l).translate(0, SHELF_BOTTOM_Y, 0);
    const top = shelfGeometry(l).translate(0, SHELF_TOP_Y + SHEET, 0);
    const lipH = 0.0078;
    const w = right - left;
    const parts: THREE.BufferGeometry[] = [
      backPlateGeometry(l),
      bottom,
      top,
      // front lips (bottom turned down, top turned up)
      rboxAt(w + 2 * SHEET, lipH, SHEET, (left + right) / 2, SHELF_BOTTOM_Y - lipH / 2 + 0.0002, SHELF_Z - SHEET / 2, 0.0004),
      rboxAt(w + 2 * SHEET, lipH, SHEET, (left + right) / 2, SHELF_TOP_Y + lipH / 2 - 0.0002, SHELF_Z - SHEET / 2, 0.0004),
      // end walls
      rboxAt(SHEET, CHASSIS_H - 0.0006, SHELF_Z, left - SHEET / 2, CHASSIS_H / 2, SHELF_Z / 2, 0.0005),
      rboxAt(SHEET, CHASSIS_H - 0.0006, SHELF_Z, right + SHEET / 2, CHASSIS_H / 2, SHELF_Z / 2, 0.0005),
      // folded front flanges of the end walls
      boxAt(0.006, CHASSIS_H - 0.0006, SHEET, left - 0.003 + SHEET, CHASSIS_H / 2, SHELF_Z - SHEET / 2),
      boxAt(0.006, CHASSIS_H - 0.0006, SHEET, right + 0.003 - SHEET, CHASSIS_H / 2, SHELF_Z - SHEET / 2),
    ];
    // side-wall louvers (pressed ribs) on the right wall
    for (let i = 0; i < 6; i++) parts.push(boxAt(0.0012, 0.0022, 0.05, right + SHEET + 0.0005, 0.045 + i * 0.013, 0.06));
    return merge(parts);
  });
}

function guideGeometry(l: ChassisLayout): THREE.BufferGeometry {
  return cachedGeo(`clx:chassis:guides:${l.catalog}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= l.slots; i++) {
      const x = l.slot0X + i * SLOT_PITCH;
      parts.push(boxAt(0.0014, 0.0026, 0.1, x, SHELF_BOTTOM_Y + 0.0013, 0.064));
      parts.push(boxAt(0.0014, 0.0026, 0.1, x, SHELF_TOP_Y - 0.0013, 0.064));
    }
    // PS bay guides
    parts.push(boxAt(0.0014, 0.0026, 0.1, l.psX0 + 0.0008, SHELF_BOTTOM_Y + 0.0013, 0.064));
    parts.push(boxAt(0.0014, 0.0026, 0.1, l.psX0 + 0.0008, SHELF_TOP_Y - 0.0013, 0.064));
    return merge(parts);
  });
}

function connectorGeometry(l: ChassisLayout): THREE.BufferGeometry {
  return cachedGeo(`clx:chassis:conn:${l.catalog}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < l.slots; i++) {
      const x = l.slotCenterX(i);
      // backplane connector body + pin field ridges
      parts.push(rboxAt(0.0072, 0.074, 0.0105, x, 0.079, SHEET + 0.00525, 0.0006));
      for (let k = 0; k < 2; k++) parts.push(boxAt(0.0012, 0.068, 0.0012, x - 0.0015 + k * 0.003, 0.079, SHEET + 0.011));
      // backplane board edge visible through the cut-out
      parts.push(boxAt(0.0105, 0.082, 0.0008, x, 0.079, SHEET + 0.0004));
    }
    // PS connector
    parts.push(rboxAt(0.016, 0.05, 0.012, l.psX0 + 0.08, 0.079, SHEET + 0.006, 0.0008));
    return merge(parts);
  });
}

function groundStudGeometry(l: ChassisLayout): THREE.BufferGeometry {
  return cachedGeo(`clx:chassis:gnd:${l.catalog}`, () => {
    const { right } = wallXs(l);
    const x = right + SHEET;
    const y = 0.128;
    const z = 0.09;
    const alongX = (g: THREE.BufferGeometry) => g.rotateZ(-Math.PI / 2);
    return merge([
      alongX(new THREE.CylinderGeometry(0.0052, 0.0052, 0.0008, 20)).translate(x + 0.0004, y, z), // star washer
      alongX(new THREE.CylinderGeometry(0.0043, 0.0043, 0.0034, 6)).translate(x + 0.0025, y, z), // hex nut
      alongX(new THREE.CylinderGeometry(0.0022, 0.0022, 0.011, 12)).translate(x + 0.0055, y, z), // threaded stud
    ]);
  });
}

// ---------------------------------------------------------------------------
// Printed art
// ---------------------------------------------------------------------------

function slotNumberTexture(l: ChassisLayout) {
  const { left, right } = wallXs(l);
  const pxPerM = Math.min(5600, 4096 / (right - left));
  const h = 0.0072;
  return canvasTexture(`clx:slotnums:${l.catalog}`, (right - left) * pxPerM, h * pxPerM, (ctx, w, hh) => {
    const a = new Art(ctx, left, right, 0, h, w, hh);
    for (let i = 0; i < l.slots; i++) a.text(String(i), l.slotCenterX(i), h / 2, 0.0046, { color: '#15171a', weight: 700 });
    a.text('POWER SUPPLY', l.psCenterX, h / 2, 0.0028, { color: '#2a2d31', weight: 700 });
  });
}

function chassisLabelTexture(l: ChassisLayout) {
  return canvasTexture(`clx:chassislabel:${l.catalog}`, 320, 200, (ctx, w, h) => {
    const a = new Art(ctx, 0, 0.048, 0, 0.03, w, h);
    ctx.fillStyle = '#efeee8';
    ctx.fillRect(0, 0, w, h);
    a.rect(0.024, 0.0265, 0.048, 0.007, '#1d1f22');
    a.text('ControlLogix  CHASSIS', 0.024, 0.0265, 0.0033, { color: '#f2f2ee', weight: 800 });
    a.text(`CAT ${l.catalog}`, 0.003, 0.019, 0.0034, { align: 'left', color: '#111', weight: 800 });
    a.text('SER C', 0.045, 0.019, 0.0028, { align: 'right', color: '#111', weight: 700 });
    a.text(`${l.slots} SLOT  ·  STANDARD`, 0.003, 0.0135, 0.0024, { align: 'left', color: '#333', weight: 600 });
    a.text('Backplane current: see 1756-TD006', 0.003, 0.009, 0.0019, { align: 'left', color: '#444', weight: 500 });
    a.text('IND. CONT. EQ.  ·  CLASS I DIV 2', 0.003, 0.0048, 0.0019, { align: 'left', color: '#444', weight: 500 });
  });
}

function groundSymbolTexture() {
  return canvasTexture('clx:gndsym', 64, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#17191c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w / 2, 8);
    ctx.lineTo(w / 2, 30);
    ctx.moveTo(12, 30);
    ctx.lineTo(w - 12, 30);
    ctx.moveTo(20, 41);
    ctx.lineTo(w - 20, 41);
    ctx.moveTo(28, 52);
    ctx.lineTo(w - 28, 52);
    ctx.stroke();
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ControlLogixChassis({ catalog = '1756-A7', position, rotation, scale }: ControlLogixChassisProps) {
  const l = chassisLayout(catalog);
  const { left, right } = wallXs(l);
  const numTex = slotNumberTexture(l);
  const labelTex = chassisLabelTexture(l);
  const gndTex = groundSymbolTexture();
  const numPlane = cachedGeo(`plane:nums:${l.catalog}`, () => new THREE.PlaneGeometry(right - left, 0.0072));
  const sidePlane = cachedGeo('plane:chassislabel', () => new THREE.PlaneGeometry(0.048, 0.03));
  const gndPlane = cachedGeo('plane:gndsym', () => new THREE.PlaneGeometry(0.009, 0.009));
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={steelGeometry(l)} material={MAT.steel()} castShadow />
      <mesh geometry={guideGeometry(l)} material={MAT.guide()} />
      <mesh geometry={connectorGeometry(l)} material={MAT.darkPlastic()} />
      <mesh geometry={groundStudGeometry(l)} material={MAT.brass()} />
      {/* slot numbers printed on the top lip */}
      <mesh
        geometry={numPlane}
        material={texMaterial(numTex, true)}
        position={[(left + right) / 2, SHELF_TOP_Y + 0.0036, SHELF_Z + 0.0002]}
      />
      {/* catalog label on the right end wall */}
      <mesh geometry={sidePlane} material={texMaterial(labelTex)} position={[right + SHEET + 0.0002, 0.075, 0.06]} rotation-y={Math.PI / 2} />
      <mesh geometry={gndPlane} material={texMaterial(gndTex, true)} position={[right + SHEET + 0.0002, 0.114, 0.09]} rotation-y={Math.PI / 2} />
    </group>
  );
}

/** Convenience: center X of a slot in chassis coordinates. */
export function slotX(catalog: ChassisCatalog, slot: number): number {
  return chassisLayout(catalog).slotCenterX(slot);
}

