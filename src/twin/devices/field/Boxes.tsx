/**
 * Corrugated cardboard shipping boxes (RSC style): kraft board, flap seams, glossy packing tape running over
 * the top/bottom and down the ends, printed handling marks, a box-maker's certificate stamp and a shipping
 * label with barcode.
 *
 * Sizes (length along X × height × width along Z): short 0.30 × 0.20 × 0.20 m, tall 0.30 × 0.35 × 0.25 m.
 * Origin of a box: center of its BOTTOM face. <Boxes> renders many boxes with two InstancedMeshes.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Placement } from '../../contracts';
import { drawBarcode, geo, mat, mulberry32, tex, TAU } from './shared';

export type BoxKind = 'short' | 'tall';

export const BOX_SIZES: Record<BoxKind, { length: number; height: number; width: number }> = {
  short: { length: 0.3, height: 0.2, width: 0.2 },
  tall: { length: 0.3, height: 0.35, width: 0.25 },
};

const KRAFT = '#b98c5d';
const TAPE_W = 0.048;

// Atlas layout: 3 columns x 2 rows. face index (RoundedBoxGeometry order: +X,-X,+Y,-Y,+Z,-Z) -> cell
const CELLS: [number, number][] = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [2, 1],
];
const AW = 2048;
const AH = 1024;
const CW = AW / 3;
const CH = AH / 2;

/** Face size in meters (u extent, v extent) for each face. */
function faceSize(kind: BoxKind, face: number): [number, number] {
  const { length: L, height: H, width: W } = BOX_SIZES[kind];
  if (face <= 1) return [W, H];
  if (face <= 3) return [L, W];
  return [L, H];
}

function drawAtlas(ctx: CanvasRenderingContext2D, kind: BoxKind, mode: 'color' | 'rough') {
  const color = mode === 'color';
  const rnd = mulberry32(kind === 'short' ? 3 : 5);
  ctx.fillStyle = color ? KRAFT : '#e0e0e0';
  ctx.fillRect(0, 0, AW, AH);
  for (let face = 0; face < 6; face++) {
    const [col, row] = CELLS[face]!;
    const [fw, fh] = faceSize(kind, face);
    ctx.save();
    ctx.beginPath();
    ctx.rect(col * CW, row * CH, CW, CH);
    ctx.clip();
    // map millimeters on the face -> pixels in the cell (u right, v up => canvas y down)
    const sx = CW / (fw * 1000);
    const sy = CH / (fh * 1000);
    ctx.setTransform(sx, 0, 0, sy, col * CW, row * CH);
    const W = fw * 1000;
    const H = fh * 1000;
    if (color) {
      // board fibers & mottling
      for (let i = 0; i < 260; i++) {
        const v = rnd();
        ctx.fillStyle = v > 0.5 ? 'rgba(90,60,30,0.05)' : 'rgba(255,230,190,0.05)';
        ctx.beginPath();
        ctx.ellipse(rnd() * W, rnd() * H, 4 + rnd() * 30, 2 + rnd() * 8, rnd() * TAU, 0, TAU);
        ctx.fill();
      }
      // grimy edges
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(60,40,20,0.10)');
      g.addColorStop(0.08, 'rgba(60,40,20,0)');
      g.addColorStop(0.92, 'rgba(60,40,20,0)');
      g.addColorStop(1, 'rgba(60,40,20,0.14)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const tape = (x: number, y: number, w: number, h: number) => {
      if (color) {
        ctx.fillStyle = 'rgba(214,176,112,0.85)';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,240,210,0.25)';
        ctx.fillRect(x, y + h * 0.1, w, h * 0.12);
        ctx.fillStyle = 'rgba(120,85,40,0.35)';
        ctx.fillRect(x, y, w, 1.2);
        ctx.fillRect(x, y + h - 1.2, w, 1.2);
      } else {
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(x, y, w, h);
      }
    };
    const tapeV = (x: number, y: number, w: number, h: number) => {
      if (color) {
        ctx.fillStyle = 'rgba(214,176,112,0.85)';
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(120,85,40,0.35)';
        ctx.fillRect(x, y, 1.2, h);
        ctx.fillRect(x + w - 1.2, y, 1.2, h);
        ctx.fillRect(x, y + h - 1.5, w, 1.5);
      } else {
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(x, y, w, h);
      }
    };
    const T = TAPE_W * 1000;
    if (face === 2 || face === 3) {
      // top / bottom: flap seam along the length + tape over it
      if (color) {
        ctx.fillStyle = 'rgba(40,25,10,0.55)';
        ctx.fillRect(0, H / 2 - 0.8, W, 1.6);
        ctx.fillStyle = 'rgba(40,25,10,0.18)';
        ctx.fillRect(0, 2, W, 1.2);
        ctx.fillRect(0, H - 3, W, 1.2);
      }
      tape(0, H / 2 - T / 2, W, T);
    } else if (face <= 1) {
      // ends: tape legs down from top and up from bottom, "this side up" arrows
      tapeV(W / 2 - T / 2, 0, T, 55);
      tapeV(W / 2 - T / 2, H - 55, T, 55);
      if (color) {
        ctx.fillStyle = 'rgba(30,30,30,0.85)';
        for (const dx of [-16, 16]) {
          const cx = W * 0.25 + dx;
          ctx.fillRect(cx - 3, 80, 6, 30);
          ctx.beginPath();
          ctx.moveTo(cx - 10, 82);
          ctx.lineTo(cx, 66);
          ctx.lineTo(cx + 10, 82);
          ctx.fill();
        }
        ctx.fillRect(W * 0.25 - 30, 116, 60, 4);
      }
    } else if (face === 4) {
      if (color) {
        // flap score lines
        ctx.fillStyle = 'rgba(40,25,10,0.22)';
        ctx.fillRect(0, 3, W, 1.2);
        ctx.fillRect(0, H - 4, W, 1.2);
        // shipping label
        const lw = 100;
        const lh = 70;
        const lx = W - lw - 22;
        const ly = H * 0.42 - lh / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(lx + 1.5, ly + 1.5, lw, lh);
        ctx.fillStyle = '#f6f5f0';
        ctx.fillRect(lx, ly, lw, lh);
        ctx.fillStyle = '#111';
        ctx.font = '700 9px Arial, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText('SHIP TO:', lx + 5, ly + 4);
        ctx.font = '500 7px Arial, sans-serif';
        ctx.fillText('PLC WORLD DISTRIBUTION', lx + 5, ly + 15);
        ctx.fillText('DOCK 4 - LANE ' + (kind === 'short' ? 'A' : 'B'), lx + 5, ly + 24);
        drawBarcode(ctx, lx + 6, ly + 36, lw - 12, 20, kind === 'short' ? 42 : 77);
        ctx.font = '600 6px "JetBrains Mono", monospace';
        ctx.fillText(kind === 'short' ? '0 48213 55120 3' : '0 48213 88731 9', lx + 18, ly + 59);
        // printed handling arrows
        ctx.fillStyle = 'rgba(25,25,25,0.85)';
        for (const dx of [0, 26]) {
          const cx = 34 + dx;
          ctx.fillRect(cx - 3.5, 30, 7, 34);
          ctx.beginPath();
          ctx.moveTo(cx - 12, 32);
          ctx.lineTo(cx, 14);
          ctx.lineTo(cx + 12, 32);
          ctx.fill();
        }
        ctx.fillRect(18, 70, 58, 5);
        ctx.font = '800 11px Arial, sans-serif';
        ctx.fillText('THIS SIDE UP', 18, 82);
        if (kind === 'tall') {
          ctx.strokeStyle = 'rgba(180,20,20,0.9)';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(18, H - 70, 92, 30);
          ctx.fillStyle = 'rgba(180,20,20,0.9)';
          ctx.font = '900 20px Arial, sans-serif';
          ctx.fillText('FRAGILE', 24, H - 64);
        }
      }
    } else if (face === 5) {
      if (color) {
        ctx.fillStyle = 'rgba(40,25,10,0.22)';
        ctx.fillRect(0, 3, W, 1.2);
        ctx.fillRect(0, H - 4, W, 1.2);
        // box maker's certificate (round stamp)
        const cx = W * 0.72;
        const cy = H * 0.62;
        ctx.strokeStyle = 'rgba(30,30,30,0.8)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, 28, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = 'rgba(30,30,30,0.85)';
        ctx.font = '700 5px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('BOX MAKER CERT.', cx, cy - 22);
        ctx.fillText('32 ECT  SINGLEWALL', cx, cy + 23);
        ctx.font = '800 8px Arial, sans-serif';
        ctx.fillText('B-FLUTE', cx, cy);
        // recycle mark
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(40, H * 0.35, 14, 0.3, TAU - 0.3);
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.font = '600 7px Arial, sans-serif';
        ctx.fillText('RECYCLABLE', 22, H * 0.35 + 24);
        ctx.font = '800 16px Arial, sans-serif';
        ctx.fillText(kind === 'short' ? 'PKG-S' : 'PKG-T', 20, 26);
      }
    }
    ctx.restore();
  }
}

function atlasTex(kind: BoxKind, mode: 'color' | 'rough') {
  return tex(`boxAtlas:${kind}:${mode}`, () => {
    const c = document.createElement('canvas');
    c.width = AW;
    c.height = AH;
    drawAtlas(c.getContext('2d')!, kind, mode);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = mode === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  });
}

export function boxGeometry(kind: BoxKind) {
  return geo(`cardboard:${kind}`, () => {
    const { length: L, height: H, width: W } = BOX_SIZES[kind];
    const g = new RoundedBoxGeometry(L, H, W, 2, 0.006);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const perFace = uv.count / 6;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / perFace);
      const [col, row] = CELLS[face]!;
      const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1);
      const v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
      uv.setXY(i, (col + 0.003 + u * 0.994) / 3, 1 - (row + 1) / 2 + (0.003 + v * 0.994) / 2);
    }
    uv.needsUpdate = true;
    g.translate(0, H / 2, 0);
    return g;
  });
}

export function boxMaterial(kind: BoxKind) {
  return mat(`cardboard:${kind}`, () => {
    const m = new THREE.MeshStandardMaterial({
      map: atlasTex(kind, 'color'),
      roughnessMap: atlasTex(kind, 'rough'),
      roughness: 0.95,
      metalness: 0,
    });
    return m;
  });
}

/** One cardboard box (origin at the bottom center). */
export function CardboardBox({ tall = false, position, rotation, scale }: Placement & { tall?: boolean }) {
  const kind: BoxKind = tall ? 'tall' : 'short';
  return <mesh geometry={boxGeometry(kind)} material={boxMaterial(kind)} position={position} rotation={rotation} scale={scale} castShadow receiveShadow />;
}

export interface BoxState {
  /** Position of the box's bottom-center in the <Boxes> group frame. */
  x: number;
  y?: number;
  z?: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  tall: boolean;
  /** Stable id (used for a subtle per-box color variation). */
  id?: number;
  visible?: boolean;
}

export interface BoxesProps extends Placement {
  /** Live list of boxes (read every frame; may return the same mutated array). */
  getBoxes: () => readonly BoxState[];
  /** Max instances per size (default 48). */
  maxCount?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

/** Instanced boxes (two draw calls regardless of count). */
export function Boxes({ getBoxes, maxCount = 48, position, rotation, scale }: BoxesProps) {
  const shortRef = useRef<THREE.InstancedMesh>(null);
  const tallRef = useRef<THREE.InstancedMesh>(null);
  const args = useMemo(
    () => ({
      short: [boxGeometry('short'), boxMaterial('short'), maxCount] as const,
      tall: [boxGeometry('tall'), boxMaterial('tall'), maxCount] as const,
    }),
    [maxCount],
  );
  useLayoutEffect(() => {
    for (const r of [shortRef.current, tallRef.current]) {
      if (!r) continue;
      r.count = 0;
      r.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < maxCount; i++) r.setColorAt(i, _c.setRGB(1, 1, 1));
      r.frustumCulled = false;
    }
  }, [maxCount]);
  useFrame(() => {
    const sm = shortRef.current;
    const tm = tallRef.current;
    if (!sm || !tm) return;
    const boxes = getBoxes();
    let ns = 0;
    let nt = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      if (b.visible === false) continue;
      const target = b.tall ? tm : sm;
      const idx = b.tall ? nt : ns;
      if (idx >= maxCount) continue;
      _p.set(b.x, b.y ?? 0, b.z ?? 0);
      _e.set(b.rotX ?? 0, b.rotY ?? 0, b.rotZ ?? 0);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      target.setMatrixAt(idx, _m);
      const id = b.id ?? i;
      const h = ((id * 2654435761) >>> 0) / 4294967296;
      _c.setRGB(0.9 + h * 0.14, 0.9 + h * 0.1, 0.88 + h * 0.08);
      target.setColorAt(idx, _c);
      if (b.tall) nt++;
      else ns++;
    }
    sm.count = ns;
    tm.count = nt;
    sm.instanceMatrix.needsUpdate = true;
    tm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
  });
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <instancedMesh ref={shortRef} args={args.short as unknown as [THREE.BufferGeometry, THREE.Material, number]} castShadow receiveShadow />
      <instancedMesh ref={tallRef} args={args.tall as unknown as [THREE.BufferGeometry, THREE.Material, number]} castShadow receiveShadow />
    </group>
  );
}
