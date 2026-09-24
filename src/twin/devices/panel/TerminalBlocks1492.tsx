/**
 * Bulletin 1492-J3 feed-through terminal blocks (5.1 mm pitch, 60 mm long, 39.5 mm high) on a DIN
 * rail: stepped profile with screw wells at both ends, wire entries, jumper channels, snap-in white
 * marker tags with numbers, 1492-EBJ3 end barrier and 1492-EAJ35 end anchors.
 * All blocks are instanced (per-instance colors).
 *
 * Origin: DIN clip plane on the rail centerline, at the CENTER of the strip (along X). The strip
 * runs along X, block length along Y (wires enter from ±Y).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { TerminalBlocksProps } from '../../contracts';
import { LEGEND_FONT, boxGeo, canvasTexture, mats, planeGeo, screwHeadGeo, sharedGeo, sharedMat, Screw } from '../operator/shared';

export const J3 = { pitch: 0.0051, length: 0.06, height: 0.0395, barrier: 0.0015, anchor: 0.0095 } as const;

export const TB_COLORS = {
  gray: '#a3a5a2',
  blue: '#2f64c8',
  green: '#3f9a3a',
  red: '#c8322d',
  black: '#262626',
  orange: '#e0782a',
} as const;

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

function profileShape(scale = 1): THREE.Shape {
  // side profile in (y, z) plane; y along block length
  const P: [number, number][] = [
    [-0.022, 0],
    [0.022, 0],
    [0.03, 0.005],
    [0.03, 0.0175],
    [0.0275, 0.0205],
    [0.0245, 0.0262],
    [0.0165, 0.0262],
    [0.0145, 0.0305],
    [0.0065, 0.0395],
    [-0.0065, 0.0395],
    [-0.0145, 0.0305],
    [-0.0165, 0.0262],
    [-0.0245, 0.0262],
    [-0.0275, 0.0205],
    [-0.03, 0.0175],
    [-0.03, 0.005],
  ];
  const s = new THREE.Shape();
  P.forEach(([y, z], i) => (i === 0 ? s.moveTo(y * scale, z * scale) : s.lineTo(y * scale, z * scale)));
  s.closePath();
  return s;
}

/** Block body geometry: profile extruded along X, mapped so Shape.x -> Y and Shape.y -> Z. */
function bodyGeo(thickness: number, scale = 1) {
  return sharedGeo(`j3-body:${thickness}:${scale}`, () => {
    const g = new THREE.ExtrudeGeometry(profileShape(scale), { depth: thickness, bevelEnabled: false });
    // shape (x=y_block, y=z_block), extrude along +Z -> rotate so extrude axis = X
    const m = new THREE.Matrix4().set(0, 0, 1, -thickness / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    g.applyMatrix4(m);
    g.computeVertexNormals();
    return g;
  });
}

function tagsTexture(labels: string[]) {
  return canvasTexture(`j3-tags:${labels.join('|')}`, Math.max(64, labels.length * 48), 96, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cw = w / labels.length;
    labels.forEach((l, i) => {
      ctx.fillStyle = '#f4f4ee';
      ctx.fillRect(i * cw + 3, 0, cw - 6, h);
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

export function TerminalBlocks1492({ count, colors, labels, ends = true, position, rotation, scale }: TerminalBlocks1492Props) {
  const body = useRef<THREE.InstancedMesh>(null);
  const screws = useRef<THREE.InstancedMesh>(null);
  const holes = useRef<THREE.InstancedMesh>(null);
  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0.02, shadowSide: THREE.BackSide }), []);
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);
  const L = terminalStripLength(count, ends);
  const x0 = -L / 2 + (ends ? J3.anchor : 0);

  useLayoutEffect(() => {
    const b = body.current;
    const s = screws.current;
    const h = holes.current;
    if (!b || !s || !h) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const x = x0 + (i + 0.5) * J3.pitch;
      m.makeTranslation(x, 0, 0);
      b.setMatrixAt(i, m);
      c.set(colors?.[i] ?? TB_COLORS.gray);
      b.setColorAt(i, c);
      for (let k = 0; k < 2; k++) {
        const y = k === 0 ? -0.0205 : 0.0205;
        m.makeTranslation(x, y, 0.0238);
        s.setMatrixAt(i * 2 + k, m);
        // screw well (top), wire entry (end face), 2 jumper holes
        m.compose(new THREE.Vector3(x, y, 0.02625), q, new THREE.Vector3(0.0034, 0.0046, 0.0004));
        h.setMatrixAt(i * 4 + k, m);
        m.compose(new THREE.Vector3(x, (k === 0 ? -1 : 1) * 0.03, 0.0115), q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), new THREE.Vector3(0.0032, 0.0034, 0.0004));
        q.identity();
        h.setMatrixAt(i * 4 + 2 + k, m);
      }
    }
    b.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    s.instanceMatrix.needsUpdate = true;
    h.instanceMatrix.needsUpdate = true;
  }, [count, colors, x0]);

  const tagLabels = useMemo(() => Array.from({ length: count }, (_, i) => labels?.[i] ?? String(i + 1)), [count, labels]);
  const tagTex = tagsTexture(tagLabels);
  const tagMat = sharedMat(`j3-tag-mat:${tagTex.uuid}`, () => new THREE.MeshStandardMaterial({ map: tagTex, transparent: true, roughness: 0.6, alphaTest: 0.5 }));
  const barrierMat = mats.matte(TB_COLORS.gray, 0.58);
  const anchorMat = mats.matte('#5d6063', 0.5);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <instancedMesh ref={body} args={[bodyGeo(J3.pitch - 0.00012), bodyMat, count]} castShadow receiveShadow />
      <instancedMesh ref={screws} args={[screwHeadGeo(0.0016, 0.0009), mats.screw(), count * 2]} />
      <instancedMesh ref={holes} args={[boxGeo(1, 1, 1), mats.dark(), count * 4]} />
      {/* marker tags on the center ridge */}
      <mesh geometry={planeGeo(count * J3.pitch, 0.0105)} material={tagMat} position={[x0 + (count * J3.pitch) / 2, 0, J3.height + 0.0004]} />
      <mesh geometry={boxGeo(count * J3.pitch - 0.0006, 0.0105, 0.0006)} material={mats.matte('#e9e9e3', 0.6)} position={[x0 + (count * J3.pitch) / 2, 0, J3.height + 0.0001]} />
      {ends && (
        <>
          {/* end barrier (open side of the last block) */}
          <mesh geometry={bodyGeo(J3.barrier, 1.04)} material={barrierMat} position={[x0 + count * J3.pitch + J3.barrier / 2, 0, 0]} castShadow />
          {/* end anchors */}
          {[x0 - J3.anchor / 2, x0 + count * J3.pitch + J3.barrier + J3.anchor / 2].map((x) => (
            <group key={x} position={[x, 0, 0]}>
              <mesh geometry={sharedGeo('j3-anchor', () => new THREE.BoxGeometry(J3.anchor - 0.0004, 0.036, 0.03).translate(0, 0, 0.015))} material={anchorMat} castShadow />
              <mesh geometry={sharedGeo('j3-anchor-top', () => new THREE.BoxGeometry(J3.anchor - 0.0004, 0.016, 0.006).translate(0, 0, 0.033))} material={anchorMat} />
              <Screw position={[0, 0, 0.036]} r={0.0026} h={0.0012} />
            </group>
          ))}
        </>
      )}
    </group>
  );
}
