/**
 * Bulletin 1492-J3 feed-through terminal blocks (5.1 mm pitch, 60 mm long, 39.5 mm high) on a DIN
 * rail: stepped profile with OPEN screw pockets at both ends (clamp screw ~0.5 mm below the rim,
 * one partition wall per block), wire entries, snap-in white marker tags (one per block) with
 * numbers, green/yellow PE blocks (1492-JG style, metal rail foot) for labels 'PE' or color TB_PE,
 * 1492-EBJ3 end barrier and 1492-EAJ35 end anchors.
 * Performance: the whole strip is one merged mesh (+1 for PE bodies, +1 for the tag print).
 *
 * Origin: DIN clip plane on the rail centerline, at the CENTER of the strip (along X). The strip
 * runs along X, block length along Y (wires enter from ±Y).
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerminalBlocksProps } from '../../contracts';
import { F, LEGEND_FONT, addClampScrew, addScrew, boxGeo, canvasTexture, cylZ, partsGeo, sharedGeo, sharedMat, uberMat } from '../operator/shared';

export const J3 = { pitch: 0.0051, length: 0.06, height: 0.0395, barrier: 0.0015, anchor: 0.0095 } as const;

export const TB_COLORS = {
  gray: '#a3a5a2',
  blue: '#2f64c8',
  green: '#3f9a3a',
  red: '#c8322d',
  black: '#262626',
  orange: '#e0782a',
} as const;

/** Color sentinel for a green/yellow protective-earth block (labels 'PE' are PE blocks automatically). */
export const TB_PE = 'pe';

const PE_LABELS = new Set(['PE', 'GND', '⏚', 'PE/GND']);

export interface TerminalBlocks1492Props extends TerminalBlocksProps {
  /** Draw end barrier + end anchors (default true). */
  ends?: boolean;
}

/** Overall strip length along X (m). */
export function terminalStripLength(count: number, ends = true) {
  return count * J3.pitch + (ends ? J3.barrier + 2 * J3.anchor : 0);
}

/** X coordinate of block `i` center relative to the strip origin. */
export function terminalX(i: number, count: number, ends = true) {
  const L = terminalStripLength(count, ends);
  return -L / 2 + (ends ? J3.anchor : 0) + (i + 0.5) * J3.pitch;
}

/** Side profile in the (y, z) plane (y along the block length). `pocket` cuts the open screw wells. */
function profileShape(scale = 1, pocket = true): THREE.Shape {
  const half: [number, number][] = [
    [0.022, 0],
    [0.03, 0.005],
    [0.03, 0.0175],
    [0.0275, 0.0205],
    [0.0245, 0.0262],
    ...(pocket
      ? ([
          [0.0228, 0.0262],
          [0.0228, POCKET_FLOOR],
          [0.0182, POCKET_FLOOR],
          [0.0182, 0.0262],
        ] as [number, number][])
      : []),
    [0.0165, 0.0262],
    [0.0145, 0.0305],
    [0.0065, 0.0395],
  ];
  const P: [number, number][] = [[-0.022, 0], ...half, ...half.slice(1).reverse().map(([y, z]) => [-y, z] as [number, number])];
  // P: bottom-left -> right side up -> across the top -> left side down
  const s = new THREE.Shape();
  P.forEach(([y, z], i) => (i === 0 ? s.moveTo(y * scale, z * scale) : s.lineTo(y * scale, z * scale)));
  s.closePath();
  return s;
}

const POCKET_FLOOR = 0.0205;
/** Clamp screw head base height (head top ≈ 0.5 mm below the 26.2 mm rim). */
const SCREW_Z = 0.0248;

/** Block body geometry: profile extruded along X, mapped so Shape.x -> Y and Shape.y -> Z. */
function bodyGeo(thickness: number, scale = 1, pocket = true) {
  return sharedGeo(`j3-body:${thickness}:${scale}:${pocket}`, () => {
    const g = new THREE.ExtrudeGeometry(profileShape(scale, pocket), { depth: thickness, bevelEnabled: false });
    const m = new THREE.Matrix4().set(0, 0, 1, -thickness / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    g.applyMatrix4(m);
    g.computeVertexNormals();
    return g;
  });
}

function tagsTexture(labels: string[]) {
  return canvasTexture(`j3-tags-v2:${labels.join('|')}`, Math.max(64, labels.length * 48), 96, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4ee';
    ctx.fillRect(0, 0, w, h);
    const cw = w / labels.length;
    labels.forEach((l, i) => {
      ctx.fillStyle = '#111';
      ctx.save();
      ctx.translate(i * cw + cw / 2, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.font = `700 ${Math.min(34, Math.floor(cw * 0.75))}px ${LEGEND_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l, 0, 0);
      ctx.restore();
    });
  });
}

/** Green/yellow PE stripes (UVs of the extruded profile are in meters -> repeat ≈ 1 stripe pair / 4 mm). */
function peMaterial() {
  return sharedMat('j3-pe-mat', () => {
    const t = canvasTexture(
      'j3-pe-stripes',
      64,
      64,
      (ctx, w, h) => {
        ctx.fillStyle = '#2f9a3c';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f0cf1a';
        for (let k = -2; k <= 2; k++) {
          ctx.beginPath();
          ctx.moveTo(k * w, 0);
          ctx.lineTo(k * w + w / 2, 0);
          ctx.lineTo(k * w + w / 2 + h, h);
          ctx.lineTo(k * w + h, h);
          ctx.closePath();
          ctx.fill();
        }
      },
      { repeat: true },
    ).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(250, 250);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.02, shadowSide: THREE.BackSide });
  });
}

export function TerminalBlocks1492({ count, colors, labels, ends = true, position, rotation, scale }: TerminalBlocks1492Props) {
  const L = terminalStripLength(count, ends);
  const x0 = -L / 2 + (ends ? J3.anchor : 0);
  const tagLabels = useMemo(() => Array.from({ length: count }, (_, i) => labels?.[i] ?? String(i + 1)), [count, labels]);
  const isPe = useMemo(() => Array.from({ length: count }, (_, i) => colors?.[i] === TB_PE || PE_LABELS.has(tagLabels[i] ?? '')), [count, colors, tagLabels]);
  const key = `${count}:${ends}:${(colors ?? []).join(',')}:${isPe.map((p) => (p ? 1 : 0)).join('')}`;

  // everything static in one merged mesh (bodies, partitions, pockets, screws, tags, ends)
  const stripGeo = partsGeo(`j3-strip:${key}`, (b) => {
    const pitchW = J3.pitch - 0.00012;
    const hole = F.hole;
    for (let i = 0; i < count; i++) {
      const x = x0 + (i + 0.5) * J3.pitch;
      const pe = isPe[i]!;
      const bodyF = F.matte(pe ? '#2f9a3c' : (colors?.[i] ?? TB_COLORS.gray), 0.58);
      if (!pe) b.add(bodyGeo(pitchW), bodyF, [x, 0, 0]);
      for (const sy of [-1, 1]) {
        const y = sy * 0.0205;
        // partition wall closing the pocket on this block's -X side
        b.add(boxGeo(0.0005, 0.0046, 0.0262 - POCKET_FLOOR), pe ? F.matte('#f0cf1a', 0.58) : bodyF, [x - pitchW / 2 + 0.00025, y, (0.0262 + POCKET_FLOOR) / 2]);
        // dark pocket floor + clamp body, screw shank and clamp screw head
        b.add(boxGeo(pitchW - 0.0006, 0.0044, 0.0003), hole, [x, y, POCKET_FLOOR + 0.00016]);
        b.add(boxGeo(0.0034, 0.0038, 0.0012), F.metal('#b9bec2', 0.4), [x + 0.0002, y, POCKET_FLOOR + 0.0009]);
        b.add(cylZ(0.0009, 0.0009, SCREW_Z - POCKET_FLOOR, 10), F.screw, [x + 0.0002, y, (SCREW_Z + POCKET_FLOOR) / 2]);
        addClampScrew(b, [x + 0.0002, y, SCREW_Z], 0.0016);
        // wire entry on the end face
        b.add(boxGeo(0.0032, 0.0004, 0.0034), hole, [x, sy * 0.03, 0.0115]);
      }
      // snap-in marker tag (separate per block, small gap)
      b.add(boxGeo(J3.pitch - 0.0006, 0.0105, 0.0008), F.matte('#ecece6', 0.6), [x, 0, J3.height + 0.0004]);
      // PE: metal rail-contact foot
      if (pe) b.add(boxGeo(pitchW - 0.0004, 0.05, 0.0016), F.metal('#c7cbce', 0.35), [x, 0, 0.0008]);
    }
    if (ends) {
      // end barrier (closes the open side of the last block) — flat plate, no pockets
      b.add(bodyGeo(J3.barrier, 1.04, false), F.matte(TB_COLORS.gray, 0.58), [x0 + count * J3.pitch + J3.barrier / 2, 0, 0]);
      const anchorF = F.matte('#5d6063', 0.5);
      for (const x of [x0 - J3.anchor / 2, x0 + count * J3.pitch + J3.barrier + J3.anchor / 2]) {
        b.add(sharedGeo('j3-anchor', () => new THREE.BoxGeometry(J3.anchor - 0.0004, 0.036, 0.03).translate(0, 0, 0.015)), anchorF, [x, 0, 0]);
        b.add(sharedGeo('j3-anchor-top', () => new THREE.BoxGeometry(J3.anchor - 0.0004, 0.016, 0.006).translate(0, 0, 0.033)), anchorF, [x, 0, 0]);
        addScrew(b, [x, 0, 0.036], 0.0026, 0.0012);
      }
    }
  });

  // PE bodies (striped texture) — only when present
  const peGeo = useMemo(() => {
    if (!isPe.some(Boolean)) return null;
    return sharedGeo(`j3-pe-bodies:${key}`, () => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < count; i++) if (isPe[i]) parts.push(bodyGeo(J3.pitch - 0.00012).clone().translate(x0 + (i + 0.5) * J3.pitch, 0, 0));
      const g = mergeGeometries(parts, false)!;
      parts.forEach((p) => p.dispose());
      return g;
    });
  }, [isPe, key, count, x0]);

  // tag print: one quad per tag, UV-mapped into a single label atlas
  const tagTex = tagsTexture(tagLabels);
  const tagMat = sharedMat(
    `j3-tag-mat:${tagTex.uuid}`,
    () => new THREE.MeshStandardMaterial({ map: tagTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  const printGeo = sharedGeo(`j3-tag-print:${count}:${ends}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const q = new THREE.PlaneGeometry(J3.pitch - 0.0009, 0.0098);
      const uv = q.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + 0.08 + uv.getX(k) * 0.84) / count);
      q.translate(x0 + (i + 0.5) * J3.pitch, 0, J3.height + 0.00085);
      parts.push(q);
    }
    const g = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    return g;
  });

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={stripGeo} material={uberMat()} castShadow receiveShadow />
      {peGeo && <mesh geometry={peGeo} material={peMaterial()} castShadow receiveShadow />}
      <mesh geometry={printGeo} material={tagMat} />
    </group>
  );
}
