/**
 * <HtmlScreen/>: projects interactive DOM onto a 3D rectangle (CSS3D, same math as drei <Html transform>).
 *
 * Why not drei <Html>? Under React 19 StrictMode drei re-creates its React root on the same container while
 * the previous root is being unmounted asynchronously, which wipes the content. This version creates a
 * fresh container per mount and defers the root unmount, so it is StrictMode-safe.
 *
 * The physical screen area (`width` × `height` meters) is centered on the group origin in the local XY plane,
 * facing +Z. The content (`widthPx` × `heightPx` CSS pixels) is scaled uniformly to FIT that area
 * (scale = min(width / widthPx, height / heightPx)) and centered; any letterbox is filled with `background`.
 *
 * Occlusion (`occlude`): ~6×/s a 4×3 grid of rays is cast from the camera to the screen. Only opaque, visible
 * meshes count as occluders (invisible hit zones, transparent glass / highlight boxes / contact shadows, lines
 * and points are ignored). Blocked cells are clipped away with a CSS clip-path; when every cell is blocked the
 * DOM is hidden.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';

export interface HtmlScreenProps {
  children: ReactNode;
  /** Content size in CSS pixels (e.g. the HMI resolution). */
  widthPx: number;
  heightPx: number;
  /** Physical width of the screen area in meters. */
  width: number;
  /** Physical height of the screen area (default: width × heightPx / widthPx). */
  height?: number;
  /** Letterbox color when the content aspect differs from the screen area. */
  background?: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Max z-index of the overlay element (keep below app UI). */
  zIndex?: number;
  visible?: boolean;
  /** Clip / hide the DOM where other opaque 3D objects are in front of it. */
  occlude?: boolean;
  /** Objects under this root (e.g. the device itself) never occlude. */
  occludeIgnore?: RefObject<THREE.Object3D | null>;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();

const COLS = 4;
const ROWS = 3;

const eps = (v: number) => (Math.abs(v) < 1e-10 ? 0 : v);

function cameraCss(m: THREE.Matrix4): string {
  const e = m.elements;
  let s = 'matrix3d(';
  for (let i = 0; i < 16; i++) s += eps(i % 4 === 1 ? -e[i]! : e[i]!) + (i !== 15 ? ',' : ')');
  return s;
}

function objectCss(m: THREE.Matrix4, k: number): string {
  const e = m.elements;
  const mul = [k, k, k, 1, -k, -k, -k, -1, k, k, k, 1, 1, 1, 1, 1];
  let s = 'translate(-50%,-50%) matrix3d(';
  for (let i = 0; i < 16; i++) s += eps(mul[i]! * e[i]!) + (i !== 15 ? ',' : ')');
  return s;
}

function isUnder(o: THREE.Object3D | null, root: THREE.Object3D | null | undefined): boolean {
  if (!root) return false;
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
}

function isOccluder(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const mat = mesh.material;
  const mats = Array.isArray(mat) ? mat : [mat];
  return mats.some((m) => m && m.visible && m.colorWrite !== false && (!m.transparent || m.opacity >= 0.9));
}

export function HtmlScreen({
  children,
  widthPx,
  heightPx,
  width,
  height,
  background = '#000',
  position,
  rotation,
  zIndex = 5,
  visible = true,
  occlude = false,
  occludeIgnore,
}: HtmlScreenProps) {
  const group = useRef<THREE.Group>(null);
  const { gl, camera, size, events, scene } = useThree();
  const physH = height ?? (width * heightPx) / widthPx;
  const k = Math.min(width / widthPx, physH / heightPx);
  const boxW = width / k;
  const boxH = physH / k;
  const occ = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      next: 0,
      cells: new Uint8Array(COLS * ROWS),
      clip: '',
      allHidden: false,
      candidates: [] as THREE.Mesh[],
      hits: [] as THREE.Intersection[],
    }),
    [],
  );
  const nodes = useRef<{ outer: HTMLDivElement; inner: HTMLDivElement; host: HTMLDivElement; root: Root } | null>(null);
  const last = useMemo(() => ({ cam: new THREE.Matrix4(), proj: new THREE.Matrix4(), obj: new THREE.Matrix4(), w: 0, h: 0, shown: true, k: 0 }), []);

  // mount: fresh host + root per mount (StrictMode-safe)
  useLayoutEffect(() => {
    const target = (events.connected as HTMLElement | undefined) ?? (gl.domElement.parentNode as HTMLElement);
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;';
    const outer = document.createElement('div');
    outer.style.cssText = 'position:absolute;top:0;left:0;transform-style:preserve-3d;pointer-events:none;';
    const inner = document.createElement('div');
    inner.style.cssText = 'position:absolute;pointer-events:auto;backface-visibility:hidden;-webkit-backface-visibility:hidden;';
    outer.appendChild(inner);
    host.appendChild(outer);
    target.appendChild(host);
    const root = createRoot(inner);
    nodes.current = { outer, inner, host, root };
    last.w = 0;
    last.shown = true;
    last.cam.elements[0] = NaN; // force the first transform update
    occ.clip = '';
    return () => {
      nodes.current = null;
      host.remove();
      setTimeout(() => root.unmount(), 0);
    };
  }, [gl, events.connected, last, occ]);

  // render children into the DOM root every React render
  useLayoutEffect(() => {
    nodes.current?.root.render(
      <div
        style={{
          width: boxW,
          height: boxH,
          background,
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div style={{ width: widthPx, height: heightPx, flex: 'none', position: 'relative', overflow: 'hidden' }}>{children}</div>
      </div>,
    );
  });

  /** Cast the 4×3 ray grid; returns true when at least one cell is visible. Updates the clip-path. */
  const testOcclusion = (g: THREE.Group, camPos: THREE.Vector3, n: { inner: HTMLDivElement }) => {
    const ignore = occludeIgnore?.current ?? g;
    const cands = occ.candidates;
    cands.length = 0;
    scene.traverseVisible((o) => {
      if (isOccluder(o) && !isUnder(o, ignore)) cands.push(o);
    });
    let blocked = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const p = v4.set(((c + 0.5) / COLS - 0.5) * width, (0.5 - (r + 0.5) / ROWS) * physH, 0).applyMatrix4(g.matrixWorld);
        const dir = v3.copy(p).sub(camPos);
        const dist = dir.length();
        occ.ray.set(camPos, dir.normalize());
        occ.ray.near = 0;
        occ.ray.far = dist - 0.0015;
        let hit = 0;
        for (const m of cands) {
          occ.hits.length = 0;
          m.raycast(occ.ray, occ.hits);
          if (occ.hits.length) {
            hit = 1;
            break;
          }
        }
        occ.cells[i] = hit;
        blocked += hit;
      }
    }
    occ.allHidden = blocked === COLS * ROWS;
    let clip = '';
    if (blocked > 0 && !occ.allHidden) {
      const cw = boxW / COLS;
      const ch = boxH / ROWS;
      let d = '';
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (!occ.cells[r * COLS + c]) d += `M${(c * cw).toFixed(1)} ${(r * ch).toFixed(1)}h${cw.toFixed(1)}v${ch.toFixed(1)}h${(-cw).toFixed(1)}Z`;
      clip = `path('${d}')`;
    }
    if (clip !== occ.clip) {
      occ.clip = clip;
      n.inner.style.clipPath = clip;
    }
  };

  useFrame(() => {
    const n = nodes.current;
    const g = group.current;
    if (!n || !g) return;
    camera.updateMatrixWorld();
    g.updateWorldMatrix(true, false);
    // hide when behind the camera or explicitly hidden
    const objPos = v1.setFromMatrixPosition(g.matrixWorld);
    const camPos = v2.setFromMatrixPosition(camera.matrixWorld);
    const toObj = objPos.sub(camPos);
    const behind = toObj.angleTo(camera.getWorldDirection(v3)) > Math.PI / 2;
    // back side of the screen: hide (CSS backface culling is unreliable across browsers)
    const normal = v3.set(0, 0, 1).transformDirection(g.matrixWorld);
    const backside = normal.dot(toObj) > 0;
    if (occlude && visible && !behind && !backside) {
      const now = performance.now();
      if (now >= occ.next) {
        occ.next = now + 160;
        testOcclusion(g, camPos, n);
      }
    }
    const shown = visible && !behind && !backside && !(occlude && occ.allHidden);
    if (shown !== last.shown) {
      last.shown = shown;
      n.host.style.display = shown ? 'block' : 'none';
    }
    if (!shown) return;
    if (last.w !== size.width || last.h !== size.height) {
      last.w = size.width;
      last.h = size.height;
      n.host.style.width = `${size.width}px`;
      n.host.style.height = `${size.height}px`;
      // transform-origin of the camera layer must be the viewport center (as in drei <Html transform>)
      n.outer.style.width = `${size.width}px`;
      n.outer.style.height = `${size.height}px`;
      last.cam.elements[0] = NaN;
    }
    if (last.k === k && last.cam.equals(camera.matrixWorldInverse) && last.obj.equals(g.matrixWorld) && last.proj.equals(camera.projectionMatrix)) return;
    last.k = k;
    last.cam.copy(camera.matrixWorldInverse);
    last.proj.copy(camera.projectionMatrix);
    last.obj.copy(g.matrixWorld);
    const fov = camera.projectionMatrix.elements[5]! * (size.height / 2);
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    n.host.style.perspective = ortho ? '' : `${fov}px`;
    const camT = ortho ? `scale(${fov})` : `translateZ(${fov}px)`;
    n.outer.style.transform = `${camT}${cameraCss(camera.matrixWorldInverse)}translate(${size.width / 2}px,${size.height / 2}px)`;
    n.inner.style.transform = objectCss(g.matrixWorld, k);
    // nearer = higher (but bounded to keep app UI on top)
    const dist = v1.setFromMatrixPosition(g.matrixWorld).distanceTo(camPos);
    n.host.style.zIndex = String(Math.max(1, Math.round(zIndex - Math.min(zIndex - 1, dist))));
  });

  return <group ref={group} position={position} rotation={rotation} />;
}
