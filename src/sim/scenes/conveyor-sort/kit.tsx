/**
 * Scene kit shared by the `conveyor-sort` and `tank-process` views (the tank view imports it from here):
 *
 *  <IoHotspot>      invisible hover box around a physical device + a floating I/O tag chip
 *                   ("Start_PB · Local:1:I.Data.0 · 1") shown while hovered or when the global
 *                   learning overlay (`useSceneOverlay().showTags`) is on.
 *  <TagOcclusion>   one per scene: dims chips hidden behind big geometry (cheap, round-robin raycasts
 *                   against a cached list of large opaque meshes — never the whole scene per frame).
 *  <ShadowBudget>   turns off shadow casting for tiny meshes (screws, LEDs, labels) to keep the shadow pass lean.
 *  useThrottledFrame / audio helpers for scene sound loops & one-shots (no AudioContext before a user gesture).
 *
 * Values in the chips are read from the controller's I/O image (what the PLC program sees), throttled to ~8 Hz
 * and written straight into the DOM (no React re-renders per frame).
 */
import { Html } from '@react-three/drei';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { sfx, type LoopName, type SfxName } from '../../../audio/sfx';
import type { Vec3 } from '../../../twin/contracts';
import type { IoPointDef, SimRuntime } from '../../types';
import { useSceneOverlay } from '../overlay';

// ---------------------------------------------------------------------------
// Invisible hit material (raycastable, never drawn, never occludes chips)
// ---------------------------------------------------------------------------

let hitMat: THREE.MeshBasicMaterial | null = null;
/** Shared invisible material for hover proxies. */
export function hitMaterial(): THREE.MeshBasicMaterial {
  if (!hitMat) {
    hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    hitMat.name = 'io-hit';
  }
  return hitMat;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------------------
// I/O value formatting
// ---------------------------------------------------------------------------

function readPoint(runtime: SimRuntime, p: IoPointDef): number | boolean {
  try {
    const tags = runtime.controller.tags;
    return p.signal === 'analog' ? tags.readNumber(p.operand) : tags.readBool(p.operand);
  } catch {
    return p.signal === 'analog' ? 0 : false;
  }
}

function formatValue(p: IoPointDef, v: number | boolean): string {
  if (typeof v === 'boolean') return v ? '1' : '0';
  const units = p.units ? ` ${p.units}` : '';
  return `${v.toFixed(1)}${units}`;
}

// ---------------------------------------------------------------------------
// Occlusion registry
// ---------------------------------------------------------------------------

interface ChipEntry {
  anchor: THREE.Object3D;
  /** drei <Html> renders into its own React root: the element appears asynchronously. */
  el: React.RefObject<HTMLDivElement | null>;
  occluded: boolean;
}

const chips = new Set<ChipEntry>();

const _ray = new THREE.Raycaster();
const _cam = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hits: THREE.Intersection[] = [];

function collectOccluders(scene: THREE.Scene): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const scale = new THREE.Vector3();
  // Visible graph only (device-level batched copies are per-device sized, cheap enough to raycast).
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    for (const c of o.children) visit(c);
    const m = o as THREE.Mesh;
    if (!m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (m.userData.noOcclude) return;
    const mat = m.material as THREE.Material | THREE.Material[];
    const first = Array.isArray(mat) ? mat[0] : mat;
    if (!first || first.transparent || first.name === 'io-hit' || !first.depthWrite) return;
    const g = m.geometry as THREE.BufferGeometry | undefined;
    if (!g || !g.attributes.position) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    m.getWorldScale(scale);
    const r = (g.boundingSphere?.radius ?? 0) * Math.max(scale.x, scale.y, scale.z);
    if (r >= 0.12) out.push(m);
  };
  visit(scene);
  return out;
}

/**
 * Dims I/O chips whose anchor is hidden behind large opaque geometry. Mount once per scene (inside the Canvas).
 * Work per frame: 2 rays against a cached occluder list (refreshed every 2.5 s).
 */
export function TagOcclusion() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    // dev-only hook for QA scripts (draw calls, mesh counts, world → screen projection for click tests)
    if (!import.meta.env.DEV) return;
    const project = (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    (window as unknown as { __sceneDebug?: unknown }).__sceneDebug = { scene, gl, camera, project, THREE };
  }, [scene, gl, camera]);
  const occluders = useRef<THREE.Mesh[]>([]);
  const lastScan = useRef(-1e9);
  const cursor = useRef(0);
  useFrame(({ camera, clock }) => {
    if (chips.size === 0) return;
    const t = clock.elapsedTime;
    if (t - lastScan.current > 2.5) {
      occluders.current = collectOccluders(scene);
      lastScan.current = t;
    }
    const list = occluders.current;
    camera.getWorldPosition(_cam);
    let i = 0;
    const start = cursor.current % chips.size;
    let checked = 0;
    for (const c of chips) {
      if (i++ < start) continue;
      if (checked >= 2) break;
      checked++;
      c.anchor.getWorldPosition(_pt);
      _dir.subVectors(_pt, _cam);
      const dist = _dir.length();
      _dir.divideScalar(dist || 1);
      _ray.set(_cam, _dir);
      _ray.far = Math.max(0, dist - 0.06);
      _hits.length = 0;
      _ray.intersectObjects(list, false, _hits);
      const occ = _hits.length > 0;
      const el = c.el.current;
      if (occ !== c.occluded || (el && el.dataset.occ !== String(occ))) {
        c.occluded = occ;
        if (el) {
          el.dataset.occ = String(occ);
          el.style.opacity = occ ? '0.16' : '1';
        }
      }
    }
    cursor.current = start + checked;
  });
  return null;
}

// ---------------------------------------------------------------------------
// Tag chip
// ---------------------------------------------------------------------------

const CHIP_STYLE: React.CSSProperties = {
  pointerEvents: 'none',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  background: 'rgba(9, 13, 20, 0.88)',
  border: '1px solid rgba(148, 163, 184, 0.35)',
  borderRadius: 6,
  padding: '3px 7px 4px',
  font: '500 11px/1.35 "Inter Variable", Inter, system-ui, sans-serif',
  color: '#e2e8f0',
  boxShadow: '0 2px 10px rgba(0,0,0,0.45)',
  transition: 'opacity 160ms linear',
  transform: 'translateY(-50%)',
};

/** Beyond this camera distance a pinned (not hovered) chip collapses to "alias · value". */
const COMPACT_DISTANCE = 4.2;
const _camPos = new THREE.Vector3();
const _chipPos = new THREE.Vector3();

function TagChip({ runtime, points, title, full }: { runtime: SimRuntime; points: IoPointDef[]; title?: string; full: boolean }) {
  const anchor = useRef<THREE.Group>(null);
  const box = useRef<HTMLDivElement>(null);
  const valueEls = useRef<(HTMLSpanElement | null)[]>([]);
  const detailEls = useRef<(HTMLElement | null)[]>([]);
  const compact = useRef<boolean | null>(null);
  const last = useRef<string[]>([]);
  const nextAt = useRef(0);

  useEffect(() => {
    const a = anchor.current;
    if (!a) return;
    const entry: ChipEntry = { anchor: a, el: box, occluded: false };
    chips.add(entry);
    return () => {
      chips.delete(entry);
    };
  }, []);

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    if (t < nextAt.current) return;
    nextAt.current = t + 0.12;
    // level of detail: pinned chips far from the camera only show alias + value
    let c = false;
    if (!full && anchor.current) {
      camera.getWorldPosition(_camPos);
      anchor.current.getWorldPosition(_chipPos);
      c = _camPos.distanceTo(_chipPos) > COMPACT_DISTANCE;
    }
    if (c !== compact.current) {
      compact.current = c;
      detailEls.current.forEach((el, i) => {
        if (el) el.style.display = c ? 'none' : i === 0 ? '' : 'contents';
      });
    }
    for (let i = 0; i < points.length; i++) {
      const el = valueEls.current[i];
      if (!el) continue;
      const p = points[i]!;
      const v = readPoint(runtime, p);
      const text = formatValue(p, v);
      if (last.current[i] !== text) {
        last.current[i] = text;
        el.textContent = text;
        if (p.signal === 'digital') {
          const on = v === true;
          el.style.background = on ? '#16a34a' : '#334155';
          el.style.color = on ? '#f0fdf4' : '#cbd5e1';
        }
      }
    }
  });

  return (
    <group ref={anchor}>
      <Html zIndexRange={[30, 10]} style={{ pointerEvents: 'none' }}>
        <div ref={box} style={CHIP_STYLE}>
          {title && (
            <div
              ref={(el) => {
                detailEls.current[0] = el;
              }}
              style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600, letterSpacing: 0.3, marginBottom: 1 }}
            >
              {title}
            </div>
          )}
          {points.map((p, i) => (
            <div key={p.alias} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, color: p.dir === 'input' ? '#7dd3fc' : '#fcd34d' }}>{p.alias}</span>
              <span
                ref={(el) => {
                  detailEls.current[1 + i] = el;
                }}
                style={{ display: 'contents' }}
              >
                <span style={{ color: '#64748b' }}>·</span>
                <span style={{ font: '500 10.5px/1.35 "JetBrains Mono", ui-monospace, monospace', color: '#cbd5e1' }}>{p.operand}</span>
              </span>
              <span style={{ color: '#64748b' }}>·</span>
              <span
                ref={(el) => {
                  valueEls.current[i] = el;
                }}
                style={{
                  font: '700 10.5px/1.35 "JetBrains Mono", ui-monospace, monospace',
                  padding: '0 5px',
                  borderRadius: 4,
                  background: '#334155',
                  minWidth: 12,
                  textAlign: 'center',
                }}
              >
                –
              </span>
            </div>
          ))}
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Hotspot
// ---------------------------------------------------------------------------

export interface IoHotspotProps {
  runtime: SimRuntime;
  /** IoPointDef.deviceId to show (all points of that device), or explicit aliases (in this order). */
  device?: string;
  aliases?: string[];
  /** Hover box size (m) and its center (parent coordinates). */
  size: Vec3;
  position?: Vec3;
  rotation?: Vec3;
  /** Chip anchor (parent coordinates); default: just above the hover box. */
  anchor?: Vec3;
  /** Optional small header line, e.g. the instrument tag 'LT-101'. */
  title?: string;
  children?: ReactNode;
}

/** Points of `runtime.scene.io` for a device id / alias list (stable per runtime). */
export function useIoPoints(runtime: SimRuntime, device?: string, aliases?: string[]): IoPointDef[] {
  const key = aliases?.join(',') ?? '';
  return useMemo(() => {
    const io = runtime.scene.io;
    if (aliases && aliases.length) return aliases.map((a) => io.find((p) => p.alias === a)).filter((p): p is IoPointDef => !!p);
    return io.filter((p) => p.deviceId === device);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.scene, device, key]);
}

/**
 * Hover area around a device + its floating I/O tag chip. The box is invisible and does NOT stop event
 * propagation, so clicks still reach the device underneath (push buttons, selectors...).
 */
export function IoHotspot({ runtime, device, aliases, size, position = [0, 0, 0], rotation, anchor, title, children }: IoHotspotProps) {
  const points = useIoPoints(runtime, device, aliases);
  const showAll = useSceneOverlay((s) => s.showTags);
  const [hover, setHover] = useState(false);
  const a: Vec3 = anchor ?? [position[0], position[1] + size[1] / 2 + 0.03, position[2]];
  if (points.length === 0) return <>{children}</>;
  return (
    <>
      <mesh
        geometry={unitBox}
        material={hitMaterial()}
        position={position}
        rotation={rotation}
        scale={size}
        userData={{ noOcclude: true }}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
      />
      {(hover || showAll) && (
        <group position={a}>
          <TagChip runtime={runtime} points={points} title={title} full={hover} />
        </group>
      )}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Frame helpers & audio
// ---------------------------------------------------------------------------

/** useFrame callback throttled to `hz` (default 15 Hz). */
export function useThrottledFrame(fn: (state: RootState, dt: number) => void, hz = 15) {
  const acc = useRef(0);
  useFrame((state, dt) => {
    acc.current += dt;
    if (acc.current < 1 / hz) return;
    const d = acc.current;
    acc.current = 0;
    fn(state, d);
  });
}

/** Sound is only produced after the user interacted with the page (browser autoplay policy, no console noise). */
export function audioAllowed(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

/** Play a one-shot effect if audio is allowed. */
export function playSfx(name: SfxName) {
  if (audioAllowed()) sfx.play(name);
}

/**
 * Drive continuous loops from scene state (~15 Hz). `getLevels` returns the intensity per loop (0 = off).
 * Loops are silenced on unmount.
 */
export function useSceneLoops(names: LoopName[], getLevels: (out: Record<string, number>) => void) {
  const levels = useRef<Record<string, number>>({});
  const key = names.join(',');
  useThrottledFrame(() => {
    if (!audioAllowed()) return;
    const l = levels.current;
    for (const n of names) l[n] = 0;
    getLevels(l);
    for (const n of names) sfx.setLoop(n, l[n] ?? 0);
  }, 12);
  useEffect(
    () => () => {
      for (const n of key.split(',')) sfx.setLoop(n as LoopName, 0);
    },
    [key],
  );
}

/** Edge detector for one-shot sounds: calls `onChange(value)` when `get()` changes (checked ~30 Hz). */
export function useEdge<T>(get: () => T, onChange: (value: T, prev: T) => void) {
  const prev = useRef<T | undefined>(undefined);
  useThrottledFrame(() => {
    const v = get();
    if (prev.current === undefined) {
      prev.current = v;
      return;
    }
    if (v !== prev.current) {
      const p = prev.current;
      prev.current = v;
      onChange(v, p);
    }
  }, 30);
}

// ---------------------------------------------------------------------------
// Shadow budget
// ---------------------------------------------------------------------------

/**
 * Turns off `castShadow` on small meshes (screws, LEDs, terminals, labels...) under `root` so the shadow pass
 * only draws parts whose shadow is actually visible. Runs a few times after mount (devices mount lazily).
 */
export function ShadowBudget({ minRadius = 0.07 }: { minRadius?: number }) {
  const scene = useThree((s) => s.scene);
  const passes = useRef(0);
  const next = useRef(0.5);
  useFrame(({ clock }) => {
    if (passes.current >= 4 || clock.elapsedTime < next.current) return;
    passes.current++;
    next.current = clock.elapsedTime + 1.5;
    const s = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.castShadow) return;
      const g = m.geometry as THREE.BufferGeometry | undefined;
      if (!g || !g.attributes.position) return;
      if ((o as THREE.InstancedMesh).isInstancedMesh) {
        // instanced parts: keep unless every instance is tiny (geometry radius × max instance scale)
        return;
      }
      if (!g.boundingSphere) g.computeBoundingSphere();
      m.getWorldScale(s);
      const r = (g.boundingSphere?.radius ?? 0) * Math.max(s.x, s.y, s.z);
      if (r < minRadius) m.castShadow = false;
    });
  });
  return null;
}
