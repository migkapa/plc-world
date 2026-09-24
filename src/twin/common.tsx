/**
 * Shared building blocks for the 3D digital twins.
 *
 * CONVENTIONS (all device components must follow them):
 *  - Units are METERS. Y is up. The device FRONT faces +Z.
 *  - A device's local origin is the center of its BACK mounting face at the bottom edge, unless the
 *    component documents otherwise (e.g. chassis origin = back-bottom-left). This makes placing parts
 *    on a backplate / DIN rail / wall straightforward.
 *  - Live values are passed as GETTER FUNCTIONS (e.g. `getLit: () => boolean`) and read inside
 *    `useFrame` to mutate materials/transforms. Never put per-frame values in React state.
 *  - Text/labels use canvas textures (no runtime network fetches, no external fonts).
 *  - Emissive LEDs use `toneMapped={false}` materials with emissiveIntensity > 1 so the Bloom pass
 *    makes them glow when lit.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const COLORS = {
  /** 1756 / 5069 module housings (very dark charcoal plastic). */
  moduleBlack: '#1b1c1e',
  moduleCharcoal: '#2a2c30',
  /** ControlLogix chassis / DIN hardware zinc-plated steel. */
  chassisSteel: '#9aa1a8',
  rockwellGray: '#c9ccd0',
  labelWhite: '#f2f2ee',
  enclosureGray: '#d6d8d6', // RAL 7035
  stainless: '#c6cbd0',
  copper: '#b87333',
  wireBlue: '#1f4fd1',
  wireRed: '#c62828',
  wireBlack: '#111111',
  wireWhite: '#eeeeee',
  safetyYellow: '#f5c400',
  ledGreen: '#22ff66',
  ledRed: '#ff2a2a',
  ledAmber: '#ffb000',
  ledBlue: '#3aa0ff',
  ledWhite: '#ffffff',
} as const;

export type LedColor = 'green' | 'red' | 'amber' | 'blue' | 'white' | 'yellow';

export const LED_HEX: Record<LedColor, string> = {
  green: COLORS.ledGreen,
  red: COLORS.ledRed,
  amber: COLORS.ledAmber,
  yellow: '#ffe14a',
  blue: COLORS.ledBlue,
  white: COLORS.ledWhite,
};

// ---------------------------------------------------------------------------
// Shared materials (created once, reused everywhere)
// ---------------------------------------------------------------------------

const materialCache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = materialCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    materialCache.set(key, m);
  }
  return m;
}

export const materials = {
  plastic: (color: string = COLORS.moduleBlack, roughness = 0.55) =>
    cached(`plastic:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 })),
  metal: (color: string = COLORS.chassisSteel, roughness = 0.35) =>
    cached(`metal:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.9 })),
  paint: (color: string = COLORS.enclosureGray, roughness = 0.6) =>
    cached(`paint:${color}:${roughness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.15 })),
  rubber: (color = '#111111') =>
    cached(`rubber:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 })),
  glass: (color = '#ffffff', opacity = 0.25) =>
    cached(
      `glass:${color}:${opacity}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.05,
          metalness: 0,
          transmission: 0.9,
          transparent: true,
          opacity,
          thickness: 0.002,
        }),
    ),
};

// ---------------------------------------------------------------------------
// Canvas text textures
// ---------------------------------------------------------------------------

export interface TextTextureOptions {
  /** Lines of text. */
  lines: string[];
  /** Canvas size in pixels (keep power-of-two-ish for mipmaps). */
  width?: number;
  height?: number;
  background?: string | null;
  color?: string;
  /** CSS font weight + family; size is computed from `fontPx`. */
  fontFamily?: string;
  fontWeight?: number | string;
  fontPx?: number;
  align?: CanvasTextAlign;
  /** Vertical padding between lines as a multiple of fontPx. */
  lineHeight?: number;
  padding?: number;
  /** Draw a thin border. */
  border?: string;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

/** Create (or reuse) a crisp canvas texture with text. Safe to call during render (cached by options). */
export function makeTextTexture(opts: TextTextureOptions): THREE.CanvasTexture {
  const key = JSON.stringify(opts);
  const hit = textureCache.get(key);
  if (hit) return hit;
  const {
    lines,
    width = 256,
    height = 64,
    background = null,
    color = '#ffffff',
    fontFamily = 'Inter Variable, Inter, Arial, Helvetica, sans-serif',
    fontWeight = 600,
    fontPx = Math.floor(height / Math.max(1, lines.length) / 1.35),
    align = 'center',
    lineHeight = 1.2,
    padding = 6,
    border,
  } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
  }
  ctx.fillStyle = color;
  ctx.font = `${fontWeight} ${fontPx}px ${fontFamily}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const total = lines.length * fontPx * lineHeight;
  const x = align === 'left' ? padding : align === 'right' ? width - padding : width / 2;
  lines.forEach((line, i) => {
    const y = height / 2 - total / 2 + fontPx * lineHeight * (i + 0.5);
    ctx.fillText(line, x, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  textureCache.set(key, tex);
  return tex;
}

/** A flat label (plane) facing +Z with a canvas text texture. Size in meters. */
export function Label({
  size,
  position,
  rotation,
  ...opts
}: TextTextureOptions & {
  size: [number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
}) {
  const tex = useMemo(() => makeTextTexture(opts), [JSON.stringify(opts)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={tex} transparent={!opts.background} roughness={0.8} metalness={0} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// LEDs
// ---------------------------------------------------------------------------

export type LedMode = boolean | 'off' | 'on' | 'flash' | 'flash-fast';

export interface LedProps {
  color: LedColor;
  /** Live getter: true/'on' = lit, 'flash' = 1 Hz blink, 'flash-fast' = 4 Hz blink. */
  get: () => LedMode;
  /** Optional per-frame color override (e.g. bi-color LEDs that go red/green). */
  getColor?: () => LedColor;
  size?: [number, number, number];
  position?: [number, number, number];
  /** Lens shape. */
  shape?: 'box' | 'round';
  /** Emissive strength when lit (Bloom threshold is ~1). */
  intensity?: number;
}

/** Status LED with an unlit "dark lens" look and a glowing lit state. */
export function Led({ color, get, getColor, size = [0.003, 0.002, 0.001], position, shape = 'box', intensity = 3 }: LedProps) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const baseColor = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const m = mat.current;
    if (!m) return;
    const mode = get();
    const t = clock.elapsedTime;
    const lit =
      mode === true || mode === 'on'
        ? true
        : mode === 'flash'
          ? Math.floor(t * 2) % 2 === 0
          : mode === 'flash-fast'
            ? Math.floor(t * 8) % 2 === 0
            : false;
    const c = LED_HEX[getColor ? getColor() : color];
    baseColor.set(c);
    m.color.copy(baseColor).multiplyScalar(lit ? 1 : 0.18);
    m.emissive.copy(baseColor);
    m.emissiveIntensity = lit ? intensity : 0;
  });
  return (
    <mesh position={position} rotation={shape === 'round' ? [Math.PI / 2, 0, 0] : undefined}>
      {shape === 'box' ? <boxGeometry args={size} /> : <cylinderGeometry args={[size[0] / 2, size[0] / 2, size[2], 20]} />}
      <meshStandardMaterial ref={mat} toneMapped={false} roughness={0.3} metalness={0} />
    </mesh>
  );
}
