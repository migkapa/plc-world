/**
 * Shared helpers for the process & machine field devices (motors, sensors, conveyors, tanks...).
 *
 * Everything here is cached at module level: geometries, materials and procedural (canvas) textures
 * are created once and shared by every instance. Never dispose them from components.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
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
      const m = new THREE.MeshStandardMaterial({ color: '#cdd2d7', metalness: 0.75, roughness: Math.max(roughness, 0.3) });
      m.roughnessMap = brushedTex();
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
  polished: () => mat('f:polished', () => new THREE.MeshStandardMaterial({ color: '#dde2e6', metalness: 0.8, roughness: 0.27 })),
  aluminum: (roughness = 0.38) =>
    mat(`f:alu:${roughness}`, () => new THREE.MeshStandardMaterial({ color: '#c8ccd0', metalness: 0.85, roughness })),
  anodized: (color = '#b9bec3') =>
    mat(`f:anod:${color}`, () => new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.48 })),
  chrome: () => mat('f:chrome', () => new THREE.MeshStandardMaterial({ color: '#e4e8eb', metalness: 0.8, roughness: 0.22 })),
  /** Nickel plated brass (sensor barrels, fittings). */
  nickel: () => mat('f:nickel', () => new THREE.MeshStandardMaterial({ color: '#d5d2ca', metalness: 0.85, roughness: 0.28 })),
  nickelThread: () =>
    mat('f:nickelThread', () => {
      const m = new THREE.MeshStandardMaterial({ color: '#d0cdc5', metalness: 0.85, roughness: 0.32 });
      m.bumpMap = repeated(threadTex(), 1, 14);
      m.bumpScale = 1.2;
      return m;
    }),
  knurled: () =>
    mat('f:knurled', () => {
      const m = new THREE.MeshStandardMaterial({ color: '#cfccc6', metalness: 0.85, roughness: 0.32 });
      m.bumpMap = repeated(knurlTex(), 6, 1);
      m.bumpScale = 3;
      return m;
    }),
  zinc: () => mat('f:zinc', () => new THREE.MeshStandardMaterial({ color: '#b1b8be', metalness: 0.7, roughness: 0.42 })),
  brass: () => mat('f:brass', () => new THREE.MeshStandardMaterial({ color: '#c9a55a', metalness: 1, roughness: 0.3 })),
  /** Black-oxide / dark steel fasteners. */
  blackSteel: () => mat('f:blackSteel', () => new THREE.MeshStandardMaterial({ color: '#2a2b2e', metalness: 0.8, roughness: 0.42 })),
  steel: () => mat('f:steel', () => new THREE.MeshStandardMaterial({ color: '#b3b8bd', metalness: 0.8, roughness: 0.3 })),
  plastic: (color: string, roughness = 0.5) =>
    mat(`f:plastic:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })),
  /** Flexible cable jacket (PVC / PUR). */
  cable: (color: string) => mat(`f:cable:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 })),
  rubber: (color = '#151515') => mat(`f:rubber:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 })),
  dark: () => mat('f:dark', () => new THREE.MeshStandardMaterial({ color: '#060708', roughness: 0.9, metalness: 0 })),
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

// ---------------------------------------------------------------------------
// Small hardware parts
// ---------------------------------------------------------------------------

type P = { position?: Vec3; rotation?: Vec3 };

/** Hex nut, axis along +Z. */
export function HexNut({ af, t, position, rotation, material }: P & { af: number; t: number; material?: THREE.Material }) {
  return <mesh geometry={hexGeo(af, t)} material={material ?? fm.zinc()} position={position} rotation={rotation} castShadow />;
}

/** Hex head bolt with washer; axis along +Z, origin at the seating face (head points +Z). */
export function HexBolt({ d, position, rotation, material }: P & { d: number; material?: THREE.Material }) {
  const af = d * 1.6;
  const th = d * 0.65;
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={cylZ(d * 1.05, d * 0.18, 20)} material={material ?? fm.zinc()} position={[0, 0, d * 0.09]} />
      <mesh geometry={hexGeo(af, th)} material={material ?? fm.zinc()} position={[0, 0, d * 0.18 + th / 2]} castShadow />
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
