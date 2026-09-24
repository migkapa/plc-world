/**
 * Decal atlases: every printed face of a device (labels, legends, vents, LED windows, jack faces...) is drawn
 * into ONE canvas texture and rendered by ONE merged mesh → a device's print costs a single draw call.
 *
 * A second canvas carries per-region roughness (G) and metalness (B) so glossy windows, matte labels and
 * metal plates can live in the same material (roughnessMap = metalnessMap = orm).
 * Regions may punch transparent holes (ctx.clearRect / destination-out) — the material uses alphaTest.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mmCtx, type MmCtx } from './canvas';
import { cachedGeometry } from './geometry';

export interface AtlasRegionDef {
  id: string;
  /** Printed size in millimetres. */
  wMm: number;
  hMm: number;
  /** Pixels per millimetre. */
  ppm: number;
  /** Uniform roughness / metalness of the region (0..1). */
  roughness?: number;
  metalness?: number;
  /** Background (also bleeds into the padding so mipmaps don't pick up neighbours). */
  bg?: string;
  draw?: (m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Optional per-pixel roughness/metalness painting (fill with `rgb(0, rough*255, metal*255)`). */
  drawOrm?: (m: MmCtx, ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

export interface Atlas {
  key: string;
  map: THREE.CanvasTexture;
  orm: THREE.CanvasTexture;
  /** uv rect per region: [u0, v0, u1, v1] (v up). */
  rects: Record<string, [number, number, number, number]>;
  material: THREE.MeshStandardMaterial;
}

const PAD = 6;
const cache = new Map<string, Atlas>();

export function ormColor(roughness: number, metalness = 0.05): string {
  return `rgb(0,${Math.round(roughness * 255)},${Math.round(metalness * 255)})`;
}

/** Build (or reuse) an atlas. `key` must uniquely identify the artwork. */
export function buildAtlas(key: string, regions: AtlasRegionDef[], opts: { maxWidth?: number; alphaTest?: number } = {}): Atlas {
  const hit = cache.get(key);
  if (hit) return hit;
  const sized = regions.map((r) => ({ r, w: Math.ceil(r.wMm * r.ppm), h: Math.ceil(r.hMm * r.ppm) }));
  const widest = Math.max(...sized.map((s) => s.w)) + 2 * PAD;
  const W = Math.max(opts.maxWidth ?? 2048, widest);
  const order = [...sized].sort((a, b) => b.h - a.h);
  const place = new Map<string, { x: number; y: number; w: number; h: number }>();
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const s of order) {
    if (x + s.w + 2 * PAD > W) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    place.set(s.r.id, { x: x + PAD, y: y + PAD, w: s.w, h: s.h });
    x += s.w + 2 * PAD;
    rowH = Math.max(rowH, s.h + 2 * PAD);
  }
  const H = Math.ceil((y + rowH) / 4) * 4;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const ormCanvas = document.createElement('canvas');
  ormCanvas.width = W;
  ormCanvas.height = H;
  const octx = ormCanvas.getContext('2d')!;
  octx.fillStyle = ormColor(0.6);
  octx.fillRect(0, 0, W, H);

  const rects: Atlas['rects'] = {};
  for (const s of sized) {
    const p = place.get(s.r.id)!;
    const r = s.r;
    ctx.fillStyle = r.bg ?? '#1c1d20';
    ctx.fillRect(p.x - PAD, p.y - PAD, p.w + 2 * PAD, p.h + 2 * PAD);
    if (r.draw) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      ctx.rect(0, 0, p.w, p.h);
      ctx.clip();
      r.draw(mmCtx(ctx, p.w / r.wMm, r.hMm), ctx, p.w, p.h);
      ctx.restore();
    }
    octx.fillStyle = ormColor(r.roughness ?? 0.6, r.metalness ?? 0.05);
    octx.fillRect(p.x - PAD, p.y - PAD, p.w + 2 * PAD, p.h + 2 * PAD);
    if (r.drawOrm) {
      octx.save();
      octx.translate(p.x, p.y);
      octx.beginPath();
      octx.rect(0, 0, p.w, p.h);
      octx.clip();
      r.drawOrm(mmCtx(octx, p.w / r.wMm, r.hMm), octx, p.w, p.h);
      octx.restore();
    }
    rects[r.id] = [p.x / W, 1 - (p.y + p.h) / H, (p.x + p.w) / W, 1 - p.y / H];
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const orm = new THREE.CanvasTexture(ormCanvas);
  orm.colorSpace = THREE.NoColorSpace;
  orm.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map,
    roughnessMap: orm,
    metalnessMap: orm,
    roughness: 1,
    metalness: 1,
    alphaTest: opts.alphaTest ?? 0.5,
  });
  const atlas: Atlas = { key, map, orm, rects, material };
  cache.set(key, atlas);
  return atlas;
}

export interface DecalPlacement {
  /** Region id. */
  id: string;
  /** Plane center (parent space, meters). */
  center: [number, number, number];
  /** Plane size (meters). */
  size: [number, number];
  /** Euler rotation of the plane (default: facing +Z). */
  rotation?: [number, number, number];
  /** Sub-rectangle of the region to show, in region fractions [u0, v0, u1, v1] (default whole region). */
  sub?: [number, number, number, number];
}

const tmpEuler = new THREE.Euler();
const tmpMat = new THREE.Matrix4();

/** Remap a geometry's 0..1 uvs into an atlas rect (in place). */
export function remapUv(g: THREE.BufferGeometry, rect: [number, number, number, number], sub: [number, number, number, number] = [0, 0, 1, 1]) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect;
  const su0 = u0 + (u1 - u0) * sub[0];
  const su1 = u0 + (u1 - u0) * sub[2];
  const sv0 = v0 + (v1 - v0) * sub[1];
  const sv1 = v0 + (v1 - v0) * sub[3];
  for (let i = 0; i < uv.count; i++) uv.setXY(i, su0 + (su1 - su0) * uv.getX(i), sv0 + (sv1 - sv0) * uv.getY(i));
  uv.needsUpdate = true;
  return g;
}

/**
 * One merged geometry holding all decal planes of a device. Cached by `cacheKey` (include everything that
 * changes the placements). Extra pre-built geometries with atlas uvs (position/normal/uv, indexed) can be merged in.
 */
export function decalGeometry(cacheKey: string, atlas: Atlas, placements: DecalPlacement[], extra: THREE.BufferGeometry[] = []): THREE.BufferGeometry {
  return cachedGeometry(`decals:${atlas.key}:${cacheKey}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    for (const p of placements) {
      const rect = atlas.rects[p.id];
      if (!rect) throw new Error(`atlas ${atlas.key}: unknown region ${p.id}`);
      const g = new THREE.PlaneGeometry(p.size[0], p.size[1]);
      remapUv(g, rect, p.sub);
      if (p.rotation) g.applyMatrix4(tmpMat.makeRotationFromEuler(tmpEuler.set(...p.rotation)));
      g.translate(...p.center);
      parts.push(g);
    }
    for (const e of extra) {
      const g = e.index ? e : e.toNonIndexed();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      parts.push(g);
    }
    const all = parts.every((p) => p.index) ? parts : parts.map((p) => (p.index ? p.toNonIndexed() : p));
    const merged = mergeGeometries(all, false)!;
    merged.computeBoundingSphere();
    return merged;
  });
}
