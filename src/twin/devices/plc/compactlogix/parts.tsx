/**
 * Small reusable 3D parts for the CompactLogix / PowerFlex / PanelView twins (folder-local, not exported
 * from the device barrel): instanced status LEDs, dot-matrix display, RJ45 jack, DIN rail, pick handling,
 * highlight frame.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { LED_HEX, materials, type LedColor, type LedMode } from '../../../common';
import { canvasTexture, dotColumns } from './canvas';
import { box, cachedGeometry, mergeColored, plane, roundedBox, screwHeadGeometry, xf } from './geometry';

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------

const matCache = new Map<string, THREE.Material>();
export function cachedMaterial<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/** Decal material (texture printed on a face). Place decal planes ≥ 0.1 mm in front of the face they sit on. */
export function decalMaterial(tex: THREE.Texture, roughness = 0.6, metalness = 0.05, transparent = false): THREE.MeshStandardMaterial {
  return cachedMaterial(`decal:${tex.uuid}:${roughness}:${metalness}:${transparent}`, () => {
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness, metalness, transparent });
    if (transparent) m.depthWrite = false;
    return m;
  });
}

export const vertexColorMetal = () =>
  cachedMaterial('vcol-metal', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.35 }));
export const vertexColorPlastic = () =>
  cachedMaterial('vcol-plastic', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.55 }));
export const glossyBlack = () =>
  cachedMaterial(
    'glossy-black',
    () => new THREE.MeshPhysicalMaterial({ color: '#0d0e10', roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 }),
  );

// ---------------------------------------------------------------------------
// LED helpers
// ---------------------------------------------------------------------------

export function ledLit(mode: LedMode, t: number): boolean {
  return mode === true || mode === 'on'
    ? true
    : mode === 'flash'
      ? Math.floor(t * 2) % 2 === 0
      : mode === 'flash-fast'
        ? Math.floor(t * 8) % 2 === 0
        : false;
}

/** Irregular "traffic" flicker for Ethernet LINK/ACT LEDs. */
export function activityFlicker(seed = 0): boolean {
  const t = performance.now() / 1000 + seed * 1.37;
  return Math.sin(t * 23.1) + Math.sin(t * 57.7 + seed) + Math.sin(t * 9.3) > -0.4;
}

/**
 * LED lens material: a dark, glossy smoked lens (so unlit indicators read as dark windows with reflections)
 * whose EMISSIVE color comes from the per-instance color → lit instances glow (HDR, Bloom) regardless of lighting.
 */
export const ledLensMaterial = () =>
  cachedMaterial('led-lens', () => {
    const m = new THREE.MeshStandardMaterial({ color: '#0a0a0b', roughness: 0.18, metalness: 0 });
    m.toneMapped = false;
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', '')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance = vColor.rgb;\n#endif');
    };
    m.customProgramCacheKey = () => 'led-lens-v1';
    return m;
  });

/** Lens emission colors: like LED_HEX but with a purer (less cyan) green so lit indicators don't read as mint under bloom. */
const LENS_HEX: Record<LedColor, string> = { ...LED_HEX, green: '#2cff2a' };

export interface PointLedsProps {
  /** LED centers in the parent's local space. */
  positions: Array<[number, number, number]>;
  /** Lens size (w, h, d). */
  size: [number, number, number];
  get: (index: number) => LedMode;
  color: LedColor | ((index: number) => LedColor);
  /** Emissive strength when lit (tiny indicators: ~1.6–2). */
  intensity?: number;
  /** Faint tint of an unlit lens (0..1 of the LED color). */
  dim?: number;
  /** Optional per-instance rotation (e.g. LEDs on a back face). */
  rotations?: Array<[number, number, number] | undefined>;
}

/**
 * Many status LEDs in ONE draw call (InstancedMesh with rounded lenses + per-instance emissive color).
 * Colors are only re-uploaded when an LED actually changes.
 */
export function PointLeds({ positions, size, get, color, intensity = 1.8, dim = 0.02, rotations }: PointLedsProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = roundedBox(size[0], size[1], size[2], Math.min(size[0], size[1]) * 0.32, 2);
  const mat = ledLensMaterial();
  const count = positions.length;
  const last = useMemo(() => new Int16Array(count).fill(-1), [count]);
  const tmp = useMemo(() => new THREE.Color(), []);
  const colorKeys = useMemo(() => Object.keys(LENS_HEX) as LedColor[], []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const v = new THREE.Vector3();
    positions.forEach((p, i) => {
      const r = rotations?.[i];
      q.setFromEuler(r ? e.set(...r) : e.set(0, 0, 0));
      m.compose(v.set(p[0], p[1], p[2]), q, one);
      mesh.setMatrixAt(i, m);
      tmp.set(LENS_HEX[typeof color === 'function' ? color(i) : color]).multiplyScalar(dim);
      mesh.setColorAt(i, tmp);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    last.fill(-1);
  }, [positions, rotations, color, dim, last, tmp]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    let dirty = false;
    for (let i = 0; i < count; i++) {
      const c = typeof color === 'function' ? color(i) : color;
      const lit = ledLit(get(i), t);
      const code = (lit ? 1 : 0) + colorKeys.indexOf(c) * 2;
      if (code === last[i]) continue;
      last[i] = code;
      tmp.set(LENS_HEX[c]).multiplyScalar(lit ? intensity : dim);
      mesh.setColorAt(i, tmp);
      dirty = true;
    }
    if (dirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} receiveShadow />;
}

/** Instanced static parts (screws, fins, contacts...) — one draw call. */
export function StaticInstances({
  geometry,
  material,
  positions,
  rotation,
  castShadow,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  positions: Array<[number, number, number]>;
  rotation?: [number, number, number];
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const q = new THREE.Quaternion();
    if (rotation) q.setFromEuler(new THREE.Euler(...rotation));
    const s = new THREE.Vector3(1, 1, 1);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    positions.forEach((p, i) => {
      m.compose(v.set(p[0], p[1], p[2]), q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [positions, rotation]);
  return <instancedMesh ref={ref} args={[geometry, material, positions.length]} castShadow={castShadow} receiveShadow />;
}

// ---------------------------------------------------------------------------
// Dot-matrix 4-character scrolling display (Logix controller status display)
// ---------------------------------------------------------------------------

export interface DotMatrixDisplayProps {
  getText: () => string;
  /** Plane size (m). */
  width: number;
  height: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  cells?: number;
  onColor?: string;
  offColor?: string;
  /** Columns per second when scrolling. */
  speed?: number;
}

const DOT = 8; // px pitch
const CELL_GAP = 12; // px between character cells

export function DotMatrixDisplay({
  getText,
  width,
  height,
  position,
  rotation,
  cells = 4,
  onColor = '#ff4a22',
  offColor = '#2a0c07',
  speed = 14,
}: DotMatrixDisplayProps) {
  const st = useMemo(() => {
    const w = cells * 5 * DOT + (cells - 1) * CELL_GAP + 12;
    const h = 7 * DOT + 10;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(2.3, 2.3, 2.3) });
    return { canvas, ctx: canvas.getContext('2d')!, tex, mat, raw: '\u0000', text: '', cols: [] as number[], t0: 0, scroll: -9999 };
  }, [cells]);
  useEffect(() => () => {
    st.tex.dispose();
    st.mat.dispose();
  }, [st]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const raw = getText();
    if (raw !== st.raw) {
      st.raw = raw;
      st.text = raw.length > 80 ? raw.slice(0, 80) : raw;
      st.cols = dotColumns(st.text);
      st.t0 = t;
      st.scroll = -9999;
    }
    const windowCols = cells * 6;
    let scroll: number;
    if (st.cols.length <= windowCols) scroll = -6 * Math.floor((cells - st.text.length) / 2);
    else {
      const period = st.cols.length + windowCols;
      scroll = (Math.floor((t - st.t0) * speed) % period) - windowCols + 2;
    }
    if (scroll === st.scroll) return;
    st.scroll = scroll;
    const { ctx, canvas } = st;
    ctx.fillStyle = '#050201';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let k = 0; k < cells; k++) {
      for (let c = 0; c < 5; c++) {
        const idx = scroll + k * 6 + c;
        const bits = idx >= 0 && idx < st.cols.length ? st.cols[idx]! : 0;
        const x = 6 + k * (5 * DOT + CELL_GAP) + c * DOT + DOT / 2;
        for (let r = 0; r < 7; r++) {
          const lit = (bits >> r) & 1;
          ctx.fillStyle = lit ? onColor : offColor;
          ctx.beginPath();
          ctx.arc(x, 5 + r * DOT + DOT / 2, lit ? DOT * 0.44 : DOT * 0.36, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    st.tex.needsUpdate = true;
  });

  return <mesh geometry={plane(width, height)} material={st.mat} position={position} rotation={rotation} />;
}

// ---------------------------------------------------------------------------
// RJ45 jack face (8P8C) — textured face on a shallow dark body
// ---------------------------------------------------------------------------

/** Draw an 8P8C jack face (16 × 14 mm) into a w × h px area (for atlases). `leds` adds the two corner LEDs windows. */
export function drawRj45Face(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sx = w / 128;
  const sy = h / 128;
  ctx.save();
  ctx.scale(sx, sy);
  ctx.fillStyle = '#1a1b1d';
  ctx.fillRect(0, 0, 128, 128);
  // metal shield rim
  ctx.strokeStyle = '#8e949a';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, 118, 118);
  const g = ctx.createLinearGradient(0, 20, 0, 108);
  g.addColorStop(0, '#000000');
  g.addColorStop(1, '#101114');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(16, 22);
  ctx.lineTo(112, 22);
  ctx.lineTo(112, 88);
  ctx.lineTo(84, 88);
  ctx.lineTo(84, 106);
  ctx.lineTo(44, 106);
  ctx.lineTo(44, 88);
  ctx.lineTo(16, 88);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    const x = 26 + i * 10.7;
    const cg = ctx.createLinearGradient(x, 0, x + 5, 0);
    cg.addColorStop(0, '#8a6a1c');
    cg.addColorStop(0.5, '#f3d47a');
    cg.addColorStop(1, '#8a6a1c');
    ctx.fillStyle = cg;
    ctx.fillRect(x, 24, 5, 26);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 35 × 7.5 mm top-hat DIN rail (EN 60715) with slotted web + end anchors
// ---------------------------------------------------------------------------

function slotTexture() {
  const t = canvasTexture('din-slots', 128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000000';
    // one 15 × 5.3 mm slot per 25 mm pitch (texture covers 25 × 27 mm)
    const sx = w / 25;
    const sy = h / 27;
    ctx.beginPath();
    ctx.roundRect(5 * sx, (13.5 - 2.65) * sy, 15 * sx, 5.3 * sy, 2.65 * sy);
    ctx.fill();
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const RAIL_METAL = '#b7bcc1';

export function DinRail({
  length,
  position,
  endStops = true,
  stops,
}: {
  length: number;
  position?: [number, number, number];
  endStops?: boolean;
  /** x positions (rail-local) of the two end anchors' centers; default: the rail ends. */
  stops?: [number, number];
}) {
  const hat = cachedGeometry(`din-hat:${length}`, () => {
    // cross-section in (y, z): walls + flanges, 1 mm steel
    const s = new THREE.Shape();
    const t = 0.001;
    s.moveTo(-0.0175, 0.0075);
    s.lineTo(-0.0135, 0.0075);
    s.lineTo(-0.0135, 0);
    s.lineTo(-0.0135 + t, 0);
    s.lineTo(-0.0135 + t, 0.0075 - t);
    s.lineTo(-0.0175, 0.0075 - t);
    s.closePath();
    const s2 = new THREE.Shape();
    s2.moveTo(0.0175, 0.0075);
    s2.lineTo(0.0175, 0.0075 - t);
    s2.lineTo(0.0135 - t, 0.0075 - t);
    s2.lineTo(0.0135 - t, 0);
    s2.lineTo(0.0135, 0);
    s2.lineTo(0.0135, 0.0075);
    s2.closePath();
    const g = new THREE.ExtrudeGeometry([s, s2], { depth: length, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.rotateX(Math.PI / 2);
    g.translate(-length / 2, 0, 0);
    g.computeVertexNormals();
    return g;
  });
  const web = cachedGeometry(`din-web:${length}`, () => {
    const g = new THREE.PlaneGeometry(length, 0.027 - 0.002);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (length / 0.025));
    return g;
  });
  const webMat = cachedMaterial(
    'din-web-mat',
    () =>
      new THREE.MeshStandardMaterial({
        color: RAIL_METAL,
        metalness: 0.85,
        roughness: 0.38,
        alphaMap: slotTexture(),
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      }),
  );
  const metal = materials.metal(RAIL_METAL, 0.38);
  const sx = stops ?? [-length / 2 + 0.0055, length / 2 - 0.0055];
  const stopGeo = cachedGeometry(`din-stops:${sx[0].toFixed(5)}:${sx[1].toFixed(5)}`, () =>
    mergeColored([
      [endStopGeometry(), '#8d9196', xf([sx[0], 0, 0])],
      [endStopGeometry(), '#8d9196', xf([sx[1], 0, 0])],
      [screwHeadGeometry(0.0022, 0.0012, 'slot'), null, xf([sx[0], 0, 0.0311])],
      [screwHeadGeometry(0.0022, 0.0012, 'slot'), null, xf([sx[1], 0, 0.0311])],
    ]),
  );
  return (
    <group position={position}>
      <mesh geometry={hat} material={metal} castShadow receiveShadow />
      <mesh geometry={web} material={webMat} position={[0, 0, 0.0005]} receiveShadow />
      {endStops && <mesh geometry={stopGeo} material={vertexColorPlastic()} castShadow receiveShadow />}
    </group>
  );
}

/** 1492-EAJ35-style end anchor (gray), origin at the rail center line on the panel surface. */
function endStopGeometry() {
  return cachedGeometry('din-endstop', () => {
    const s = new THREE.Shape();
    // side profile (z, y) — tall block with a sloped front
    s.moveTo(0, -0.022);
    s.lineTo(0.022, -0.022);
    s.lineTo(0.03, -0.012);
    s.lineTo(0.03, 0.012);
    s.lineTo(0.022, 0.022);
    s.lineTo(0, 0.022);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.009, bevelEnabled: true, bevelSize: 0.0006, bevelThickness: 0.0006, bevelSegments: 2 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.0045, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}

// ---------------------------------------------------------------------------
// Slotted wire duct (Panduit-style, light gray) — horizontal, fingers on both walls, snap-on cover
// ---------------------------------------------------------------------------

export const DUCT = {
  /** Gap between the module bottoms and the duct top wall. */
  gap: 0.045,
  /** Duct width (y) and depth from the panel (z). */
  height: 0.04,
  depth: 0.075,
  /** Finger pitch and slot width. */
  pitch: 0.01,
  slot: 0.0042,
  wall: 0.0015,
  color: '#b3b7b9',
} as const;

/** Slot centers: x = -length/2 + k * pitch (k = 1..n-1), duct-local. */
export function ductSlotPhase(length: number): number {
  return -length / 2;
}

/**
 * Duct geometry: origin = back (panel side) of the TOP wall at the duct's horizontal center; the duct extends
 * down to y = -height and out to z = depth (+ cover).
 */
function ductGeometry(length: number, height: number, depth: number) {
  return cachedGeometry(`duct:${length.toFixed(4)}:${height}:${depth}`, () => {
    const t = DUCT.wall;
    const c = DUCT.color;
    const root = 0.012; // slots stop 12 mm above the base
    const parts: Array<[THREE.BufferGeometry, string, THREE.Matrix4]> = [
      [new THREE.BoxGeometry(length, height, t), c, xf([0, -height / 2, t / 2])],
      [new THREE.BoxGeometry(length, t, root), c, xf([0, -t / 2, root / 2])],
      [new THREE.BoxGeometry(length, t, root), c, xf([0, -height + t / 2, root / 2])],
      // cover + lips
      [new THREE.BoxGeometry(length, height + 0.003, 0.002), '#babebf', xf([0, -height / 2, depth + 0.001])],
      [new THREE.BoxGeometry(length, 0.0012, 0.005), '#babebf', xf([0, 0.0006 + 0.0003, depth - 0.0025])],
      [new THREE.BoxGeometry(length, 0.0012, 0.005), '#babebf', xf([0, -height - 0.0006 - 0.0003, depth - 0.0025])],
    ];
    const n = Math.max(2, Math.round(length / DUCT.pitch));
    const fw = DUCT.pitch - DUCT.slot;
    const fd = depth - root;
    const finger = new THREE.BoxGeometry(fw, t, fd);
    for (let k = 0; k < n; k++) {
      const x = -length / 2 + DUCT.pitch * (k + 0.5);
      if (x + fw / 2 > length / 2) break;
      parts.push([finger, c, xf([x, -t / 2, root + fd / 2])]);
      parts.push([finger, c, xf([x, -height + t / 2, root + fd / 2])]);
    }
    return mergeColored(parts);
  });
}

export function WireDuct({
  length,
  position,
  height = DUCT.height,
  depth = DUCT.depth,
}: {
  length: number;
  position?: [number, number, number];
  height?: number;
  depth?: number;
}) {
  return <mesh geometry={ductGeometry(length, height, depth)} material={vertexColorPlastic()} position={position} castShadow receiveShadow />;
}

// ---------------------------------------------------------------------------
// Ethernet patch cables (RJ45 plug + boot + cable, capped end)
// ---------------------------------------------------------------------------

export interface DownCable {
  /** Center of the jack face (the jack faces -Y: plug goes straight down). */
  jack: [number, number, number];
  /** Cable path after the boot (absolute points in the same space). The last point is the capped end. */
  path: Array<[number, number, number]>;
}

const CABLE_R = 0.0028;

/** Merged boot + cable + end cap for several cables plugged into downward-facing jacks (one material). */
export function downCablesGeometry(key: string, cables: DownCable[]) {
  return cachedGeometry(`cables:${key}`, () => {
    const parts: Array<[THREE.BufferGeometry, string, THREE.Matrix4?]> = [];
    for (const c of cables) {
      const [x, y, z] = c.jack;
      parts.push([roundedBox(0.0122, 0.012, 0.0098, 0.0026, 2), '#ffffff', xf([x, y - 0.0125, z])]);
      const pts = [new THREE.Vector3(x, y - 0.017, z), ...c.path.map((p) => new THREE.Vector3(...p))];
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      parts.push([new THREE.TubeGeometry(curve, Math.max(16, Math.round(curve.getLength() / 0.004)), CABLE_R, 10, false), '#ffffff']);
      // end cap
      const end = pts[pts.length - 1]!;
      const tan = curve.getTangentAt(1);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
      parts.push([new THREE.CircleGeometry(CABLE_R, 10), '#ffffff', new THREE.Matrix4().compose(end, q, new THREE.Vector3(1, 1, 1))]);
    }
    return mergeColored(parts);
  });
}

/** Merged clear RJ45 plug bodies for the same cables. */
export function downPlugsGeometry(key: string, cables: DownCable[]) {
  return cachedGeometry(`plugs:${key}`, () =>
    mergeColored(cables.map((c) => [box(0.0114, 0.0075, 0.0078), '#ffffff', xf([c.jack[0], c.jack[1] - 0.0035, c.jack[2]])] as [THREE.BufferGeometry, string, THREE.Matrix4])),
  );
}

export const cableBootMaterial = () => materials.plastic('#2f7fd8', 0.5);
export const plugClearMaterial = () =>
  cachedMaterial('rj45-plug-clear', () => new THREE.MeshStandardMaterial({ color: '#9fb3c4', roughness: 0.12, metalness: 0, transparent: true, opacity: 0.5 }));

// ---------------------------------------------------------------------------
// Picking & highlight
// ---------------------------------------------------------------------------

/** Hover cursor + click (pointerdown→pointerup without drag) handlers. */
export function usePick(onSelect?: () => void) {
  const [hovered, setHovered] = useState(false);
  useCursor(hovered && !!onSelect);
  const down = useRef<{ x: number; y: number } | null>(null);
  const handlers = onSelect
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
        },
        onPointerOut: () => setHovered(false),
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
        },
        onPointerUp: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const d = down.current;
          down.current = null;
          if (d && Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) < 6) onSelect();
        },
      }
    : {};
  return { hovered, handlers };
}

/** Glowing selection frame around a box region (center + size). */
export function HighlightFrame({
  center,
  size,
  strength = 1,
}: {
  center: [number, number, number];
  size: [number, number, number];
  /** 1 = selected, ~0.4 = hover. */
  strength?: number;
}) {
  const edges = cachedGeometry(`hl-edges:${size.join(':')}`, () => new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)));
  const lineMat = cachedMaterial(
    `hl-line:${strength}`,
    () => new THREE.LineBasicMaterial({ color: new THREE.Color('#38bdf8').multiplyScalar(1 + 2 * strength), toneMapped: false }),
  );
  const fillMat = cachedMaterial(
    `hl-fill:${strength}`,
    () => new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.1 * strength, depthWrite: false }),
  );
  return (
    <group position={center}>
      <lineSegments geometry={edges} material={lineMat} />
      <mesh geometry={box(...size)} material={fillMat} />
    </group>
  );
}

