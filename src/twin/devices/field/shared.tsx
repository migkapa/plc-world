/**
 * Shared helpers for the process & machine field devices (motors, sensors, conveyors, tanks...).
 *
 * Everything here is cached at module level: geometries, materials and procedural (canvas) textures
 * are created once and shared by every instance. Never dispose them from components.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from '../../contracts';

export const TAU = Math.PI * 2;

/** Small deterministic PRNG (textures & demo data must look the same on every load). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
export function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map<string, THREE.Material>();
export function mat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

const texCache = new Map<string, THREE.Texture>();
export function tex<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = texCache.get(key) as T | undefined;
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

export interface CanvasTexOptions {
  /** sRGB color texture (true) or linear data texture such as bump/roughness/alpha (false). */
  color?: boolean;
  repeat?: [number, number];
  wrap?: boolean;
}

/** Cached canvas-drawn texture. */
export function canvasTex(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  o: CanvasTexOptions = {},
): THREE.CanvasTexture {
  return tex(`canvas:${key}`, () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = o.color === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (o.wrap || o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
    t.needsUpdate = true;
    return t;
  });
}

/** Cached clone of a texture with its own repeat (shares the image). */
export function repeated<T extends THREE.Texture>(base: T, rx: number, ry: number): T {
  return tex(`rep:${base.uuid}:${rx.toFixed(3)}:${ry.toFixed(3)}`, () => {
    const t = base.clone() as T;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  });
}

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------

/** Fine grayscale speckle — cast iron / sand-cast surface bump. */
export function castNoiseTex(): THREE.CanvasTexture {
  return canvasTex(
    'castNoise',
    256,
    256,
    (ctx, w, h) => {
      const rnd = mulberry32(7);
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const v = Math.floor(90 + rnd() * 80);
        ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + rnd() * 0.4})`;
        const r = 0.6 + rnd() * 1.8;
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, r, 0, TAU);
        ctx.fill();
      }
    },
    { color: false, repeat: [3, 3] },
  );
}

/** Brushed-metal streaks (used as roughness map; lines run along U). */
export function brushedTex(): THREE.CanvasTexture {
  return canvasTex(
    'brushed',
    512,
    512,
    (ctx, w, h) => {
      const rnd = mulberry32(11);
      ctx.fillStyle = '#a0a0a0';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const y = rnd() * h;
        const x = rnd() * w;
        const len = 40 + rnd() * 260;
        const v = Math.floor(120 + rnd() * 110);
        ctx.strokeStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.3})`;
        ctx.lineWidth = 0.5 + rnd();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y + (rnd() - 0.5) * 0.8);
        ctx.stroke();
        if (x + len > w) {
          ctx.beginPath();
          ctx.moveTo(x - w, y);
          ctx.lineTo(x - w + len, y);
          ctx.stroke();
        }
      }
    },
    { color: false, repeat: [2, 2] },
  );
}

/** Horizontal line pattern used as a bump map for screw threads. */
export function threadTex(): THREE.CanvasTexture {
  return canvasTex(
    'thread',
    16,
    64,
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const v = Math.floor(128 + 127 * Math.sin((y / h) * TAU * 4));
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    { color: false, wrap: true },
  );
}

/** Diamond knurl pattern (bump). */
export function knurlTex(): THREE.CanvasTexture {
  return canvasTex(
    'knurl',
    64,
    64,
    (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const a = Math.abs(Math.sin(((x + y) / w) * TAU * 4));
          const b = Math.abs(Math.sin(((x - y) / w) * TAU * 4));
          const v = Math.floor(255 * Math.min(a, b));
          const i = (y * w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
      ctx.putImageData(img, 0, 0);
    },
    { color: false, wrap: true },
  );
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * Bright metals mirror the studio Lightformers; above luminance 1 the Bloom pass turns a highlight into a neon
 * tube. Small polished parts therefore get roughness >= 0.3 and a reduced environment intensity.
 */
const SMALL_METAL_ENV = 0.65;

function metal(key: string, color: string, metalness: number, roughness: number, env = SMALL_METAL_ENV) {
  return mat(key, () => {
    const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    m.envMapIntensity = env;
    return m;
  });
}

export const fm = {
  /** Painted cast iron / cast aluminum (motor frames, gearboxes). */
  cast: (color: string, roughness = 0.5) =>
    mat(`f:cast:${color}:${roughness}`, () => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.35 });
      m.bumpMap = castNoiseTex();
      m.bumpScale = 1.2;
      return m;
    }),
  /** Smooth painted sheet steel. */
  sheet: (color: string, roughness = 0.42) =>
    mat(`f:sheet:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.3 })),
  /** Stainless sheet / bar (fine brushed via roughness map, no anisotropy). */
  stainless: (roughness = 0.34) =>
    mat(`f:ss:${roughness}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: '#cdd2d7', metalness: 0.75, roughness: Math.max(roughness, 0.32) });
      m.roughnessMap = brushedTex();
      m.envMapIntensity = 0.75;
      return m;
    }),
  /** Brushed stainless for large vessel shells (anisotropic highlights). */
  brushed: () =>
    mat('f:brushed', () => {
      const m = new THREE.MeshPhysicalMaterial({ color: '#cfd4d9', metalness: 0.8, roughness: 0.5, anisotropy: 0 });
      m.roughnessMap = brushedTex();
      // large convex vessel shells mirror whole light panels; keep them below the bloom threshold
      m.envMapIntensity = 0.6;
      return m;
    }),
  /** Polished / electropolished stainless (fittings, pipes). */
  polished: () => metal('f:polished', '#d8dde1', 0.8, 0.32),
  aluminum: (roughness = 0.38) => metal(`f:alu:${roughness}`, '#c8ccd0', 0.85, Math.max(0.34, roughness), 0.75),
  anodized: (color = '#b9bec3') =>
    mat(`f:anod:${color}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.48 })),
  /** Hard-chrome (piston rods, guide rods). */
  chrome: () => metal('f:chrome', '#dfe3e6', 0.8, 0.3, 0.6),
  /** Nickel plated brass (sensor barrels, fittings). */
  nickel: () => metal('f:nickel', '#d0cdc5', 0.8, 0.32),
  nickelThread: () =>
    mat('f:nickelThread', () => {
      const m = new THREE.MeshStandardMaterial({ color: '#cbc8c0', metalness: 0.8, roughness: 0.36 });
      m.bumpMap = repeated(threadTex(), 1, 14);
      m.bumpScale = 1.2;
      m.envMapIntensity = SMALL_METAL_ENV;
      return m;
    }),
  knurled: () =>
    mat('f:knurled', () => {
      const m = new THREE.MeshStandardMaterial({ color: '#cac7c1', metalness: 0.8, roughness: 0.36 });
      m.bumpMap = repeated(knurlTex(), 6, 1);
      m.bumpScale = 3;
      m.envMapIntensity = SMALL_METAL_ENV;
      return m;
    }),
  zinc: () => metal('f:zinc', '#b1b8be', 0.7, 0.42),
  brass: () => metal('f:brass', '#c9a55a', 0.9, 0.34),
  /** Black-oxide / dark steel fasteners. */
  blackSteel: () => mat('f:blackSteel', () => new THREE.MeshStandardMaterial({ color: '#2a2b2e', metalness: 0.8, roughness: 0.42 })),
  steel: () => metal('f:steel', '#b3b8bd', 0.8, 0.32, 0.7),
  plastic: (color: string, roughness = 0.5) =>
    mat(`f:plastic:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })),
  /** Flexible cable jacket (PVC / PUR). */
  cable: (color: string) => mat(`f:cable:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 })),
  rubber: (color = '#151515') => mat(`f:rubber:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 })),
  dark: () => mat('f:dark', () => new THREE.MeshStandardMaterial({ color: '#060708', roughness: 0.9, metalness: 0 })),
  /**
   * Printed / etched nameplate: mostly dielectric (the print must stay readable instead of mirroring the
   * light panels). Use a thin metallic border mesh for the metal look.
   */
  plate: (map: THREE.Texture) =>
    mat(`f:plate:${map.uuid}`, () => new THREE.MeshStandardMaterial({ map, metalness: 0.25, roughness: 0.55 })),
};

// ---------------------------------------------------------------------------
// Geometry helpers (all return cached, shared geometries)
// ---------------------------------------------------------------------------

const k = (n: number) => n.toFixed(5);

/** Cylinder with its axis along +Z, centered on the origin. */
export function cylZ(r: number, h: number, seg = 24, rFront = r, open = false): THREE.BufferGeometry {
  return geo(`cylZ:${k(r)}:${k(h)}:${seg}:${k(rFront)}:${open}`, () => {
    const g = new THREE.CylinderGeometry(rFront, r, h, seg, 1, open);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** Cylinder with its axis along +Y, centered on the origin. */
export function cylY(r: number, h: number, seg = 24, rTop = r, open = false): THREE.BufferGeometry {
  return geo(`cylY:${k(r)}:${k(h)}:${seg}:${k(rTop)}:${open}`, () => new THREE.CylinderGeometry(rTop, r, h, seg, 1, open));
}

/** Cylinder with its axis along +X, centered on the origin. */
export function cylX(r: number, h: number, seg = 24): THREE.BufferGeometry {
  return geo(`cylX:${k(r)}:${k(h)}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return geo(`box:${k(w)}:${k(h)}:${k(d)}`, () => new THREE.BoxGeometry(w, h, d));
}

export function rbox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  return geo(`rbox:${k(w)}:${k(h)}:${k(d)}:${k(r)}:${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r));
}

export function sphere(r: number, seg = 16): THREE.BufferGeometry {
  return geo(`sph:${k(r)}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, seg / 2)));
}

export function torus(r: number, tube: number, arc = TAU, seg = 32): THREE.BufferGeometry {
  return geo(`torus:${k(r)}:${k(tube)}:${k(arc)}:${seg}`, () => new THREE.TorusGeometry(r, tube, 10, seg, arc));
}

/** Lathe around the Z axis. Profile points are [radius, z]. */
export function latheZ(key: string, profile: [number, number][], seg = 40, phiStart = 0, phiLength = TAU): THREE.BufferGeometry {
  return geo(`latheZ:${key}:${seg}:${k(phiStart)}:${k(phiLength)}`, () => {
    const g = new THREE.LatheGeometry(
      profile.map(([r, z]) => new THREE.Vector2(r, z)),
      seg,
      phiStart,
      phiLength,
    );
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** Lathe around the Y axis. Profile points are [radius, y]. */
export function latheY(key: string, profile: [number, number][], seg = 40, phiStart = 0, phiLength = TAU): THREE.BufferGeometry {
  return geo(`latheY:${key}:${seg}:${k(phiStart)}:${k(phiLength)}`, () =>
    new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      seg,
      phiStart,
      phiLength,
    ),
  );
}

/** Hex prism (nut / bolt head) with chamfered edges, axis along +Z, centered. `af` = across flats. */
export function hexGeo(af: number, t: number): THREE.BufferGeometry {
  return geo(`hex:${k(af)}:${k(t)}`, () => {
    const r = af / Math.sqrt(3);
    const s = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a));
      else s.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    s.closePath();
    const b = Math.min(t * 0.15, af * 0.06);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(t - 2 * b, 0.0001), bevelEnabled: true, bevelThickness: b, bevelSize: b * 0.6, bevelSegments: 1 });
    g.translate(0, 0, -(t - 2 * b) / 2);
    return g;
  });
}

/** Knurled cylinder (coupling nuts). Axis along +Z, centered. */
export function knurlGeo(r: number, h: number, teeth = 36): THREE.BufferGeometry {
  return geo(`knurl:${k(r)}:${k(h)}:${teeth}`, () => {
    const s = new THREE.Shape();
    const n = teeth * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = i % 2 === 0 ? r : r * 0.95;
      if (i === 0) s.moveTo(rr * Math.cos(a), rr * Math.sin(a));
      else s.lineTo(rr * Math.cos(a), rr * Math.sin(a));
    }
    s.closePath();
    const b = r * 0.06;
    const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1 });
    g.translate(0, 0, -(h - 2 * b) / 2);
    return g;
  });
}

/** Merge several (already transformed) geometries into one cached geometry. */
export function merged(key: string, make: () => THREE.BufferGeometry[]): THREE.BufferGeometry {
  return geo(`merged:${key}`, () => {
    const parts = make().map((g) => (g.index ? g.toNonIndexed() : g));
    for (const p of parts) {
      for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') p.deleteAttribute(name);
      if (!p.attributes.uv) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((p.attributes.position!.count) * 2), 2));
    }
    const g = mergeGeometries(parts, false);
    if (!g) throw new Error(`merge failed: ${key}`);
    return g;
  });
}

export interface LBracketSpec {
  /** Width along X. */
  w: number;
  /** Vertical leg height above the bend tangent (y = 0). */
  up: number;
  /** Foot length (toward -Z) beyond the bend. */
  foot: number;
  /** Sheet thickness. */
  t: number;
  /** Inner bend radius. */
  r: number;
  /** Round hole in the vertical leg: [x, y, diameter]. */
  holes?: [number, number, number][];
  /** Slots in the foot: [x, distance from the bend tangent, slot length along X, width]. */
  slots?: [number, number, number, number][];
}

/**
 * One-piece bent sheet-metal L bracket. Vertical leg in the XY plane (thickness centered on z = 0) from the bend
 * tangent y = 0 up to `up`; a bend of inner radius `r` toward -Z; a horizontal foot (top face at y = -r)
 * running toward -Z. Cached per key.
 */
export function lBracketGeo(key: string, b: LBracketSpec): THREE.BufferGeometry {
  return merged(`lbracket:${key}`, () => {
    const { w, up, foot, t, r } = b;
    const parts: THREE.BufferGeometry[] = [];
    // vertical leg (rounded top corners) with holes
    const rc = Math.min(w, up) * 0.12;
    const s1 = new THREE.Shape();
    s1.moveTo(-w / 2, 0);
    s1.lineTo(w / 2, 0);
    s1.lineTo(w / 2, up - rc);
    s1.quadraticCurveTo(w / 2, up, w / 2 - rc, up);
    s1.lineTo(-w / 2 + rc, up);
    s1.quadraticCurveTo(-w / 2, up, -w / 2, up - rc);
    s1.closePath();
    for (const [hx, hy, hd] of b.holes ?? []) {
      const h = new THREE.Path();
      h.absarc(hx, hy, hd / 2, 0, TAU, true);
      s1.holes.push(h);
    }
    const g1 = new THREE.ExtrudeGeometry(s1, { depth: t, bevelEnabled: false, curveSegments: 16 });
    g1.translate(0, 0, -t / 2);
    parts.push(g1);
    // bend: quarter annulus in the (z, y) plane, extruded along X
    const sb = new THREE.Shape();
    const cz = -t / 2 - r;
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const a = (-i / n) * (Math.PI / 2);
      const x = cz + (r + t) * Math.cos(a);
      const y = (r + t) * Math.sin(a);
      if (i === 0) sb.moveTo(x, y);
      else sb.lineTo(x, y);
    }
    for (let i = n; i >= 0; i--) {
      const a = (-i / n) * (Math.PI / 2);
      sb.lineTo(cz + r * Math.cos(a), r * Math.sin(a));
    }
    sb.closePath();
    const gb = new THREE.ExtrudeGeometry(sb, { depth: w, bevelEnabled: false });
    gb.translate(0, 0, -w / 2);
    gb.rotateY(-Math.PI / 2);
    parts.push(gb);
    // foot with slots (shape in XY with y = world z, extruded along -Y)
    const z0 = -(t / 2 + r);
    const z1 = z0 - foot;
    const s2 = new THREE.Shape();
    const rf = Math.min(w, foot) * 0.12;
    s2.moveTo(-w / 2, z0);
    s2.lineTo(-w / 2, z1 + rf);
    s2.quadraticCurveTo(-w / 2, z1, -w / 2 + rf, z1);
    s2.lineTo(w / 2 - rf, z1);
    s2.quadraticCurveTo(w / 2, z1, w / 2, z1 + rf);
    s2.lineTo(w / 2, z0);
    s2.closePath();
    for (const [sx, sd, sl, sw] of b.slots ?? []) {
      const h = new THREE.Path();
      const zc = z0 - sd;
      const hl = Math.max(0, sl - sw) / 2;
      h.absarc(sx + hl, zc, sw / 2, -Math.PI / 2, Math.PI / 2, false);
      h.absarc(sx - hl, zc, sw / 2, Math.PI / 2, (3 * Math.PI) / 2, false);
      h.closePath();
      s2.holes.push(h);
    }
    const g2 = new THREE.ExtrudeGeometry(s2, { depth: t, bevelEnabled: false, curveSegments: 10 });
    g2.rotateX(Math.PI / 2);
    g2.translate(0, -r, 0);
    parts.push(g2);
    return parts;
  });
}

// ---------------------------------------------------------------------------
// Small hardware parts
// ---------------------------------------------------------------------------

type P = { position?: Vec3; rotation?: Vec3 };

/** Hex nut, axis along +Z. */
export function HexNut({ af, t, position, rotation, material }: P & { af: number; t: number; material?: THREE.Material }) {
  return <mesh geometry={hexGeo(af, t)} material={material ?? fm.zinc()} position={position} rotation={rotation} />;
}

/** Hex head bolt with washer; axis along +Z, origin at the seating face (head points +Z). */
export function HexBolt({ d, position, rotation, material }: P & { d: number; material?: THREE.Material }) {
  const af = d * 1.6;
  const th = d * 0.65;
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={cylZ(d * 1.05, d * 0.18, 20)} material={material ?? fm.zinc()} position={[0, 0, d * 0.09]} />
      <mesh geometry={hexGeo(af, th)} material={material ?? fm.zinc()} position={[0, 0, d * 0.18 + th / 2]} />
    </group>
  );
}

/** Socket head cap screw; axis +Z, origin at the seating face. */
export function CapScrew({ d, position, rotation, material }: P & { d: number; material?: THREE.Material }) {
  const hr = d * 0.75;
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={cylZ(hr, d, 18)} material={material ?? fm.blackSteel()} position={[0, 0, d / 2]} />
      <mesh geometry={hexGeo(d * 0.5, d * 0.1)} material={fm.dark()} position={[0, 0, d * 0.98]} />
    </group>
  );
}

/** Pan-head / button screw (sheet metal covers, nameplates). Axis +Z, origin at the seating face. */
export function PanScrew({ d, position, rotation, material }: P & { d: number; material?: THREE.Material }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={latheZ(`pan${k(d)}`, [[d, 0.0], [d * 0.9, d * 0.25], [d * 0.6, d * 0.42], [0, d * 0.5]], 16)} material={material ?? fm.zinc()} />
      <mesh geometry={box(d * 1.2, d * 0.18, d * 0.2)} material={fm.dark()} position={[0, 0, d * 0.45]} />
      <mesh geometry={box(d * 0.18, d * 1.2, d * 0.2)} material={fm.dark()} position={[0, 0, d * 0.45]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cables, tubing and connectors
// ---------------------------------------------------------------------------

export const CABLE_YELLOW = '#e8b90f';
export const CABLE_GRAY = '#6f7479';
export const CABLE_BLACK = '#1a1a1a';

/** A flexible cable / hose along a smooth curve through `points` (parent coordinates). */
export function Cable({
  points,
  radius = 0.0025,
  color = CABLE_YELLOW,
  segments,
  material,
}: {
  points: Vec3[];
  radius?: number;
  color?: string;
  segments?: number;
  material?: THREE.Material;
}) {
  const key = JSON.stringify(points);
  const g = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      false,
      'centripetal',
    );
    return new THREE.TubeGeometry(curve, segments ?? Math.max(12, points.length * 14), radius, 10, false);
  }, [key, radius, segments]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => g.dispose(), [g]);
  return <mesh geometry={g} material={material ?? fm.cable(color)} castShadow />;
}

/**
 * Straight female M12 (DC Micro) cordset connector, like an 889D-F4AC: nickel-plated zinc knurled coupling
 * nut + molded yellow body. Origin = coupling face (mates with the device's male receptacle), axis +Z points
 * toward the device; the cable leaves at z = -M12_CORDSET_LENGTH.
 */
export const M12_CORDSET_LENGTH = 0.046;
export function M12Cordset({ position, rotation, color = CABLE_YELLOW }: P & { color?: string }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={knurlGeo(0.0074, 0.012, 30)} material={fm.knurled()} position={[0, 0, -0.006]} castShadow />
      <mesh
        geometry={latheZ('m12body', [
          [0.0025, -0.046],
          [0.0034, -0.046],
          [0.0042, -0.04],
          [0.0052, -0.03],
          [0.0062, -0.018],
          [0.0066, -0.0125],
          [0.0066, -0.011],
          [0.0, -0.011],
        ])}
        material={fm.plastic(color, 0.45)}
        castShadow
      />
      {/* grip ribs */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} geometry={torus(0.0058 - i * 0.0005, 0.0006, TAU, 24)} material={fm.plastic(color, 0.45)} position={[0, 0, -0.02 - i * 0.004]} />
      ))}
    </group>
  );
}

/** Male M12 receptacle thread (device side), axis +Z pointing out of the device, origin at the device face. */
export function M12Receptacle({ position, rotation }: P) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={cylZ(0.006, 0.009, 20)} material={fm.nickelThread()} position={[0, 0, 0.0045]} />
    </group>
  );
}

/** Push-in pneumatic fitting (straight), axis +Z, origin at the port face. Tube OD in meters. */
export function PushInFitting({ od = 0.008, position, rotation, collar = '#2a64c8' }: P & { od?: number; collar?: string }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={hexGeo(od * 1.9, od * 0.6)} material={fm.nickel()} position={[0, 0, od * 0.3]} />
      <mesh geometry={cylZ(od * 0.85, od * 1.3, 18)} material={fm.nickel()} position={[0, 0, od * 1.2]} />
      <mesh geometry={cylZ(od * 0.82, od * 0.35, 18)} material={fm.plastic(collar, 0.4)} position={[0, 0, od * 2.0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Live helpers
// ---------------------------------------------------------------------------

/**
 * Pointer handlers for a clickable device group (click + pointer cursor on hover). Returns an empty object
 * when `onClick` is undefined so non-interactive devices do not capture pointer events.
 */
export function clickable(onClick?: () => void) {
  if (!onClick) return {};
  return {
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onClick();
    },
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      document.body.style.cursor = '';
    },
  };
}

/** Integrates an RPM getter into an angle (radians) each frame and applies it to `ref.rotation[axis]`. */
export function useSpin(
  ref: RefObject<THREE.Object3D | null>,
  getRpm: (() => number) | undefined,
  axis: 'x' | 'y' | 'z' = 'z',
  factor = 1,
  getAngle?: () => number,
) {
  const angle = useRef(0);
  useFrame((_, dt) => {
    const o = ref.current;
    if (!o) return;
    if (getAngle) angle.current = getAngle() * factor;
    else if (getRpm) angle.current = (angle.current + ((getRpm() * factor) / 60) * TAU * Math.min(dt, 0.1)) % (TAU * 1000);
    o.rotation[axis] = angle.current;
  });
}

export interface LiveDisplay {
  texture: THREE.CanvasTexture;
}

/**
 * A per-instance canvas texture for a local instrument display. `draw` is called at most `hz` times per
 * second and only when the (quantized) value changes.
 */
export function useDisplayTexture(
  w: number,
  h: number,
  getValue: () => number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, value: number) => void,
  step = 0.1,
  hz = 6,
): THREE.CanvasTexture {
  const d = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return { ctx, t };
  }, [w, h]);
  const last = useRef({ v: Number.NaN, time: -1 });
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => () => d.t.dispose(), [d]);
  useFrame(({ clock }) => {
    const raw = getValue();
    const v = Number.isFinite(raw) ? Math.round(raw / step) * step : raw;
    const l = last.current;
    if (v === l.v || (l.time >= 0 && clock.elapsedTime - l.time < 1 / hz)) return;
    drawRef.current(d.ctx, w, h, v);
    d.t.needsUpdate = true;
    l.v = v;
    l.time = clock.elapsedTime;
  });
  return d.t;
}

/** Draw a rounded rectangle path. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Simple 1D barcode drawing (deterministic from a seed). */
export function drawBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  const rnd = mulberry32(seed);
  let cx = x;
  ctx.fillStyle = '#111';
  while (cx < x + w) {
    const bw = 1 + Math.floor(rnd() * 3.5);
    if (rnd() > 0.45) ctx.fillRect(cx, y, bw * (w / 120), h);
    cx += bw * (w / 120) + (w / 120) * (1 + Math.floor(rnd() * 2));
  }
}

// ---------------------------------------------------------------------------
// Static geometry batching
// ---------------------------------------------------------------------------

const MERGE_ATTRS = new Set(['position', 'normal', 'uv']);
const _mInv = new THREE.Matrix4();
const _mRel = new THREE.Matrix4();

function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return false;
  if (m.renderOrder !== 0 || Array.isArray(m.material)) return false;
  const mt = m.material as THREE.Material;
  if (!mt || mt.transparent) return false;
  const g = m.geometry;
  if (!g || !g.attributes.position || !g.attributes.normal) return false;
  if (Object.keys(g.morphAttributes).length) return false;
  for (const name of Object.keys(g.attributes)) if (!MERGE_ATTRS.has(name)) return false;
  return true;
}

function collectMergeable(o: THREE.Object3D, out: THREE.Mesh[]) {
  for (const c of o.children) {
    if (!c.visible || c.userData.noMerge || c.userData.__merged || c.userData.__mergeRoot) continue;
    if (mergeable(c)) out.push(c);
    collectMergeable(c, out);
  }
}

function bakeGeometry(meshes: THREE.Mesh[], inv: THREE.Matrix4): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!MERGE_ATTRS.has(name)) g.deleteAttribute(name);
    const n = g.attributes.position!.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.index) {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    _mRel.multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(_mRel);
    if (_mRel.determinant() < 0) {
      // mirrored instance (e.g. scale -1): restore the triangle winding
      const ix = g.index!;
      for (let i = 0; i + 2 < ix.count; i += 3) {
        const b = ix.getX(i + 1);
        ix.setX(i + 1, ix.getX(i + 2));
        ix.setX(i + 2, b);
      }
    }
    g.clearGroups();
    // uniform attribute types (some generators use Uint16 indices, others none)
    parts.push(g);
  }
  const out = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (out) out.computeBoundingSphere();
  return out;
}

/**
 * Batches the STATIC meshes below it into one draw call per material (and shadow flag). Children render as
 * usual (so raycasting / clicks keep hitting the originals); after mount the originals are hidden and replaced
 * by merged copies. Rebuilt only when the set of meshes or their transforms change.
 *
 * Rules: mark animated subtrees (refs whose transform / visibility changes per frame) with
 * `userData={{ noMerge: true }}`. Transparent materials, instanced meshes and custom-attribute geometries are
 * never merged. Material changes per frame (LED glow, overload tint) are fine because materials are shared.
 */
export function Merge({ children, position, rotation, scale }: { children: ReactNode; position?: Vec3; rotation?: Vec3; scale?: Vec3 | number }) {
  const root = useRef<THREE.Group>(null);
  const built = useRef<{ sig: string; merged: THREE.Mesh[]; hidden: THREE.Mesh[] }>({ sig: '', merged: [], hidden: [] });

  const teardown = () => {
    const b = built.current;
    for (const m of b.merged) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const h of b.hidden) h.visible = true;
    built.current = { sig: '', merged: [], hidden: [] };
  };

  useLayoutEffect(() => {
    const g = root.current;
    if (!g) return;
    // restore first so the collection sees every original
    const prevHidden = built.current.hidden;
    for (const h of prevHidden) h.visible = true;
    g.updateWorldMatrix(true, true);
    const meshes: THREE.Mesh[] = [];
    collectMergeable(g, meshes);
    _mInv.copy(g.matrixWorld).invert();
    let sig = '';
    for (const m of meshes) {
      _mRel.multiplyMatrices(_mInv, m.matrixWorld);
      const e = _mRel.elements;
      sig += `${m.geometry.uuid}${(m.material as THREE.Material).uuid}${m.castShadow ? 1 : 0}`;
      for (let i = 0; i < 16; i += 1) if (i !== 3 && i !== 7 && i !== 11 && i !== 15) sig += (Math.round(e[i]! * 1e5) | 0).toString(36);
      sig += ';';
    }
    if (sig === built.current.sig) {
      for (const h of prevHidden) h.visible = false;
      return;
    }
    teardown();
    const groups = new Map<string, THREE.Mesh[]>();
    for (const m of meshes) {
      const key = `${(m.material as THREE.Material).uuid}:${m.castShadow ? 1 : 0}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(m);
    }
    const merged: THREE.Mesh[] = [];
    const hidden: THREE.Mesh[] = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geom = bakeGeometry(list, _mInv);
      if (!geom) continue;
      const mm = new THREE.Mesh(geom, list[0]!.material);
      mm.castShadow = list[0]!.castShadow;
      mm.receiveShadow = list.some((x) => x.receiveShadow);
      mm.userData.__merged = true;
      mm.raycast = () => {};
      g.add(mm);
      merged.push(mm);
      for (const x of list) {
        x.visible = false;
        hidden.push(x);
      }
    }
    built.current = { sig, merged, hidden };
  });
  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} userData={{ __mergeRoot: true }}>
      {children}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cable routing
// ---------------------------------------------------------------------------

/**
 * Where a device's cable / hose goes.
 *  - `{ to, via? }`: end point (and optional intermediate points) in the device's PARENT coordinates — the same
 *    space as its `position` prop (e.g. a junction-box gland in the machine frame).
 *  - `false`: the cable stops at the device connector (the scene routes its own cable from there).
 *  - `undefined` (default): the cable drops to the floor (world y = 0) into a conduit stub-up.
 */
export type CableRoute = false | { to: Vec3; via?: Vec3[] };

const _w0 = new THREE.Vector3();
const _w1 = new THREE.Vector3();
const _wd = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _ws = new THREE.Vector3();

/** Floor conduit stub-up (zinc EMT + liquid-tight connector + floor flange); origin at the top, axis +Y. */
export const STUB_TOP = 0.14;
export function ConduitStub({ stubRef, position, visible = false }: { stubRef?: RefObject<THREE.Group | null>; position?: Vec3; visible?: boolean }) {
  return (
    <group ref={stubRef} visible={visible} position={position}>
      <mesh geometry={cylY(0.011, STUB_TOP - 0.02, 16)} material={fm.zinc()} position={[0, -(STUB_TOP - 0.02) / 2 - 0.02, 0]} castShadow />
      <mesh geometry={hexGeo(0.028, 0.01)} material={fm.zinc()} position={[0, -0.018, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={cylY(0.0105, 0.016, 16, 0.008)} material={fm.plastic('#1e1f22', 0.6)} position={[0, -0.004, 0]} />
      <mesh geometry={cylY(0.03, 0.004, 20)} material={fm.zinc()} position={[0, -STUB_TOP + 0.002, 0]} />
    </group>
  );
}

/**
 * A cable leaving a device connector at `from` (local coordinates) heading along `dir`, routed per `route`.
 * `rootRef` = the device's outermost group (its parent defines "parent coordinates").
 * Geometry is computed once after mount from the real world transforms (static devices).
 */
export function RoutedCable({
  from,
  dir,
  route,
  rootRef,
  radius = 0.0026,
  color = CABLE_YELLOW,
  lead = 0.04,
  sag = 0,
}: {
  from: Vec3;
  dir: Vec3;
  route: CableRoute | undefined;
  rootRef: RefObject<THREE.Object3D | null>;
  radius?: number;
  color?: string;
  /** Straight length leaving the connector before the cable may bend. */
  lead?: number;
  /** Extra droop of the default route (m). */
  sag?: number;
}) {
  const wrap = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const stub = useRef<THREE.Group>(null);
  const key = JSON.stringify([from, dir, route, radius, lead, sag]);
  useLayoutEffect(() => {
    const w = wrap.current;
    const m = mesh.current;
    if (!w || !m || route === false) return;
    w.updateWorldMatrix(true, false);
    const toLocal = w.matrixWorld.clone().invert();
    const toWorld = w.matrixWorld;
    const s = _w0.set(...from).applyMatrix4(toWorld).clone();
    const d = _wd.set(...dir).transformDirection(toWorld).clone();
    const pts: THREE.Vector3[] = [s, s.clone().addScaledVector(d, lead)];
    if (route) {
      const r = rootRef.current;
      const parentWorld = r?.parent ? (r.parent.updateWorldMatrix(true, false), r.parent.matrixWorld) : new THREE.Matrix4();
      for (const v of [...(route.via ?? []), route.to]) pts.push(new THREE.Vector3(...v).applyMatrix4(parentWorld));
      if (stub.current) stub.current.visible = false;
    } else {
      // default: drop to the floor into a conduit stub-up
      const h = _w1.set(d.x, 0, d.z);
      if (h.lengthSq() < 0.09) {
        // cable leaves (nearly) vertically: step out toward the device's local -Z (behind it)
        h.set(0, 0, -1).transformDirection(toWorld).setY(0);
        if (h.lengthSq() < 1e-4) h.set(1, 0, 0);
      }
      h.normalize();
      const p1 = pts[1]!;
      const sx = p1.x + h.x * 0.11;
      const sz = p1.z + h.z * 0.11;
      let top = THREE.MathUtils.clamp(p1.y - 0.12, 0.03, STUB_TOP);
      if (p1.y - top < 0.06) top = Math.max(0.012, p1.y - 0.06);
      const drop = p1.y - top;
      const up = d.y > 0.7 ? 0.04 : 0;
      const mid = new THREE.Vector3(p1.x + h.x * 0.05, p1.y + up - Math.min(0.03, drop * 0.25), p1.z + h.z * 0.05);
      pts.push(mid);
      if (drop > 0.3) pts.push(new THREE.Vector3(sx, (mid.y + top) / 2 - sag, sz));
      pts.push(new THREE.Vector3(sx, top + Math.min(0.04, drop * 0.35), sz), new THREE.Vector3(sx, top - 0.004, sz));
      const st = stub.current;
      if (st) {
        const pos = new THREE.Vector3(sx, top, sz).applyMatrix4(toLocal);
        st.position.copy(pos);
        w.matrixWorld.decompose(_w0, _wq, _ws);
        st.quaternion.copy(_wq).invert();
        st.scale.set(1 / _ws.x, (top / STUB_TOP) / _ws.y, 1 / _ws.z);
        st.visible = true;
      }
    }
    const local = pts.map((p) => p.applyMatrix4(toLocal));
    const curve = new THREE.CatmullRomCurve3(local, false, 'centripetal');
    const len = curve.getLength();
    const g = new THREE.TubeGeometry(curve, Math.max(16, Math.round(len * 90)), radius, 10, false);
    const old = m.geometry;
    m.geometry = g;
    old.dispose();
    return () => {
      m.geometry = new THREE.BufferGeometry();
      g.dispose();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (route === false) return null;
  return (
    <group ref={wrap}>
      <mesh ref={mesh} material={fm.cable(color)} castShadow />
      <ConduitStub stubRef={stub} />
    </group>
  );
}

/** Black nylon cable tie around a cable / tube bundle (axis along Z). */
export function CableTie({ r, position, rotation }: P & { r: number }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={torus(r + 0.0008, 0.0009, TAU, 16)} material={fm.plastic('#141414', 0.5)} />
      <mesh geometry={box(0.003, 0.0026, 0.004)} material={fm.plastic('#141414', 0.5)} position={[0, r + 0.0018, 0]} />
    </group>
  );
}

/**
 * Generic gray polyester field junction box (lid screws, cable glands on the bottom face).
 * Origin: center of the back (mounting) face; front faces +Z. `junctionBoxGlands()` gives the gland entry
 * points (bottom face, local coordinates) for cable routes.
 */
export function junctionBoxGlands(size: Vec3 = [0.16, 0.16, 0.09], glands = 4): Vec3[] {
  const [w, h, d] = size;
  return Array.from({ length: glands }, (_, i): Vec3 => [(-0.5 + (i + 0.5) / glands) * w * 0.8, -h / 2 - 0.018, d * 0.5]);
}
export function JunctionBox({ size = [0.16, 0.16, 0.09], glands = 4, label = 'JB-01', position, rotation }: P & { size?: Vec3; glands?: number; label?: string }) {
  const [w, h, d] = size;
  const body = fm.plastic('#c9ccc8', 0.55);
  return (
    <Merge position={position} rotation={rotation}>
      <mesh geometry={rbox(w, h, d * 0.72, 0.008, 3)} material={body} position={[0, 0, d * 0.36]} castShadow receiveShadow />
      <mesh geometry={rbox(w + 0.004, h + 0.004, d * 0.3, 0.01, 3)} material={fm.plastic('#bfc3bf', 0.5)} position={[0, 0, d * 0.72 + d * 0.13]} castShadow />
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([a, b], i) => (
        <PanScrew key={i} d={0.004} position={[a! * (w / 2 - 0.012), b! * (h / 2 - 0.012), d * 0.87 + 0.0005]} />
      ))}
      {junctionBoxGlands(size, glands).map((g, i) => (
        <group key={i} position={[g[0], -h / 2, d * 0.36]}>
          <mesh geometry={hexGeo(0.022, 0.006)} material={fm.plastic('#2a2b2e', 0.5)} position={[0, -0.003, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={cylY(0.0085, 0.012, 16, 0.006)} material={fm.plastic('#2a2b2e', 0.5)} position={[0, -0.012, 0]} />
        </group>
      ))}
      <mesh position={[0, h * 0.22, d * 1.0 + 0.0006]}>
        <planeGeometry args={[w * 0.5, h * 0.16]} />
        <meshStandardMaterial
          map={canvasTex(`jbLabel:${label}`, 256, 80, (ctx, cw, ch) => {
            ctx.fillStyle = '#f2f2ee';
            ctx.fillRect(0, 0, cw, ch);
            ctx.fillStyle = '#16181b';
            ctx.font = '800 46px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, cw / 2, ch / 2 + 2);
          })}
          roughness={0.6}
        />
      </mesh>
    </Merge>
  );
}
