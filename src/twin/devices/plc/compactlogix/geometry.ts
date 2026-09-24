/**
 * Geometry helpers for the 5069 / PowerFlex twins (all units meters).
 * Geometries created here are module-level singletons or cached by key so that many instances share GPU buffers.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const geoCache = new Map<string, THREE.BufferGeometry>();

export function cachedGeometry<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/**
 * Extrude a SIDE PROFILE (points given as [z, y] in meters, i.e. depth from the back face and height)
 * across the device width (X). Result spans x ∈ [-width/2, width/2].
 */
export function profileGeometry(key: string, profile: Array<[number, number]>, width: number, bevel = 0.0005): THREE.BufferGeometry {
  return cachedGeometry(`profile:${key}:${width}:${bevel}`, () => {
    const shape = new THREE.Shape();
    profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
    shape.closePath();
    const depth = Math.max(0.0001, width - 2 * bevel);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 6,
    });
    geo.rotateY(-Math.PI / 2);
    geo.translate(depth / 2, 0, 0);
    // The bevel grows the outline by `bevel` on every side: remap to the exact profile bounds so that
    // outer dimensions (and decals placed on the faces) stay true.
    let zMin = Infinity, zMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const [z, y] of profile) {
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const sz = (zMax - zMin) / (bb.max.z - bb.min.z);
    const sy = (yMax - yMin) / (bb.max.y - bb.min.y);
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, zMin + (pos.getZ(i) - bb.min.z) * sz);
      pos.setY(i, yMin + (pos.getY(i) - bb.min.y) * sy);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  });
}

/** Rounded box, cached by size. */
export function roundedBox(w: number, h: number, d: number, r: number, segments = 2): THREE.BufferGeometry {
  return cachedGeometry(`rbox:${w}:${h}:${d}:${r}:${segments}`, () => new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2, h / 2, d / 2)));
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cachedGeometry(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
}

export function plane(w: number, h: number): THREE.BufferGeometry {
  return cachedGeometry(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h));
}

/** Cylinder whose axis points along +Z (e.g. screw heads, knobs, LEDs facing the viewer). */
export function cylinderZ(rTop: number, rBottom: number, len: number, seg = 20): THREE.BufferGeometry {
  return cachedGeometry(`cylZ:${rTop}:${rBottom}:${len}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

function colorize(g: THREE.BufferGeometry, color: THREE.ColorRepresentation | null): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const existing = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (color === null && existing && existing.itemSize === 3) return g;
  const c = new THREE.Color(color ?? '#ffffff');
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * Merge several geometries after giving each a flat vertex color (use with `vertexColors` materials).
 * Pass `null` as the color to keep a part's existing `color` attribute (e.g. a pre-colored screw head).
 * An optional matrix transforms the part first.
 */
export function mergeColored(parts: Array<[THREE.BufferGeometry, THREE.ColorRepresentation | null, THREE.Matrix4?]>): THREE.BufferGeometry {
  const prepared = parts.map(([g, c, m]) => {
    const ng = (g.index ? g.toNonIndexed() : g.clone()) as THREE.BufferGeometry;
    for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal' && !(c === null && name === 'color')) ng.deleteAttribute(name);
    if (!ng.getAttribute('normal')) ng.computeVertexNormals();
    if (m) ng.applyMatrix4(m);
    return colorize(ng, c);
  });
  const merged = mergeGeometries(prepared, false)!;
  merged.computeBoundingSphere();
  return merged;
}

/** Transform helper for mergeColored parts: translation + optional Euler rotation + optional scale. */
export function xf(position: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number]): THREE.Matrix4 {
  const q = new THREE.Quaternion();
  if (rotation) q.setFromEuler(new THREE.Euler(...rotation));
  return new THREE.Matrix4().compose(new THREE.Vector3(...position), q, new THREE.Vector3(...(scale ?? [1, 1, 1])));
}

/** Rounded rectangle path centered at (cx, cy). */
export function roundedRectPath<T extends THREE.Path>(p: T, cx: number, cy: number, w: number, h: number, r: number, clockwise = false): T {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  r = Math.min(r, w / 2, h / 2);
  if (!clockwise) {
    p.moveTo(x0 + r, y0);
    p.lineTo(x1 - r, y0);
    p.quadraticCurveTo(x1, y0, x1, y0 + r);
    p.lineTo(x1, y1 - r);
    p.quadraticCurveTo(x1, y1, x1 - r, y1);
    p.lineTo(x0 + r, y1);
    p.quadraticCurveTo(x0, y1, x0, y1 - r);
    p.lineTo(x0, y0 + r);
    p.quadraticCurveTo(x0, y0, x0 + r, y0);
  } else {
    p.moveTo(x0 + r, y0);
    p.quadraticCurveTo(x0, y0, x0, y0 + r);
    p.lineTo(x0, y1 - r);
    p.quadraticCurveTo(x0, y1, x0 + r, y1);
    p.lineTo(x1 - r, y1);
    p.quadraticCurveTo(x1, y1, x1, y1 - r);
    p.lineTo(x1, y0 + r);
    p.quadraticCurveTo(x1, y0, x1 - r, y0);
    p.lineTo(x0 + r, y0);
  }
  return p;
}

export type HoleSpec =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r?: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'keyhole'; x: number; y: number; r: number; slot: number; up?: boolean };

/**
 * A flat plate (XY outline, extruded along +Z from z = 0 to `depth`) with holes (screw wells, wire entries,
 * keyholes). Not cached — wrap in cachedGeometry.
 */
export function holedPlate(w: number, h: number, depth: number, radius: number, holes: HoleSpec[], cx = 0, cy = 0, curveSegments = 8): THREE.BufferGeometry {
  const s = roundedRectPath(new THREE.Shape(), cx, cy, w, h, radius);
  for (const hs of holes) {
    const p = new THREE.Path();
    if (hs.kind === 'rect') roundedRectPath(p, hs.x, hs.y, hs.w, hs.h, hs.r ?? 0.0002, true);
    else if (hs.kind === 'circle') p.absarc(hs.x, hs.y, hs.r, 0, Math.PI * 2, true);
    else {
      // keyhole: round head + narrower slot (up or down)
      const dir = hs.up === false ? -1 : 1;
      const sw = hs.r * 0.55;
      const a = Math.asin(sw / hs.r);
      const tail = hs.y + dir * hs.slot;
      if (dir > 0) {
        p.moveTo(hs.x + sw, hs.y + Math.cos(a) * hs.r);
        p.lineTo(hs.x + sw, tail);
        p.absarc(hs.x, tail, sw, 0, Math.PI, false);
        p.lineTo(hs.x - sw, hs.y + Math.cos(a) * hs.r);
        p.absarc(hs.x, hs.y, hs.r, Math.PI / 2 + a, Math.PI * 2 + Math.PI / 2 - a, false);
      } else {
        p.moveTo(hs.x - sw, hs.y - Math.cos(a) * hs.r);
        p.lineTo(hs.x - sw, tail);
        p.absarc(hs.x, tail, sw, Math.PI, Math.PI * 2, false);
        p.lineTo(hs.x + sw, hs.y - Math.cos(a) * hs.r);
        p.absarc(hs.x, hs.y, hs.r, -Math.PI / 2 + a, Math.PI * 2 - Math.PI / 2 - a, false);
      }
    }
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments });
  g.computeVertexNormals();
  return g;
}

/**
 * Slotted terminal screw head (axis +Z, head top at z = 0, sits in z ∈ [-len, 0]), vertex-colored:
 * zinc head + dark slot. Radius in meters.
 */
export function screwHeadGeometry(r = 0.0014, len = 0.0012, slot: 'slot' | 'combo' = 'slot'): THREE.BufferGeometry {
  return cachedGeometry(`screw:${r}:${len}:${slot}`, () => {
    const head = new THREE.CylinderGeometry(r, r * 1.02, len, 18);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, -len / 2);
    const s1 = new THREE.BoxGeometry(r * 1.7, r * 0.28, 0.0002);
    s1.translate(0, 0, 0.00005);
    const parts: Array<[THREE.BufferGeometry, THREE.ColorRepresentation]> = [
      [head, '#b9bec4'],
      [s1, '#2a2c2e'],
    ];
    if (slot === 'combo') {
      const s2 = new THREE.BoxGeometry(r * 0.28, r * 1.2, 0.0002);
      s2.translate(0, 0, 0.00005);
      parts.push([s2, '#2a2c2e']);
    }
    return mergeColored(parts);
  });
}

/** Build instance matrices from positions (optionally with a shared rotation). */
export function matricesFromPositions(positions: Array<[number, number, number]>, rotation?: THREE.Euler): THREE.Matrix4[] {
  const q = new THREE.Quaternion();
  if (rotation) q.setFromEuler(rotation);
  const one = new THREE.Vector3(1, 1, 1);
  return positions.map((p) => new THREE.Matrix4().compose(new THREE.Vector3(...p), q, one));
}
