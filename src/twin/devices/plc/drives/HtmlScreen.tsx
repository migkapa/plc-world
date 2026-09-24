/**
 * <HtmlScreen/>: projects interactive DOM onto a 3D rectangle (CSS3D, same math as drei <Html transform>).
 *
 * Why not drei <Html>? Under React 19 StrictMode drei re-creates its React root on the same container while
 * the previous root is being unmounted asynchronously, which wipes the content. This version creates a
 * fresh container per mount and defers the root unmount, so it is StrictMode-safe.
 *
 * The content box (widthPx × heightPx CSS pixels) is centered on the group origin, in the local XY plane,
 * facing +Z, scaled so that it spans `width` meters.
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
  /** Physical width of the content in meters. */
  width: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Max z-index of the overlay element (keep below app UI). */
  zIndex?: number;
  visible?: boolean;
  /**
   * Hide the DOM when other 3D objects are between the camera and the screen center (raycast, ~6 Hz).
   * Objects under `occludeIgnore` (e.g. the device itself) never occlude.
   */
  occlude?: boolean;
  occludeIgnore?: RefObject<THREE.Object3D | null>;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();

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

export function HtmlScreen({
  children,
  widthPx,
  heightPx,
  width,
  position,
  rotation,
  zIndex = 5,
  visible = true,
  occlude = false,
  occludeIgnore,
}: HtmlScreenProps) {
  const group = useRef<THREE.Group>(null);
  const { gl, camera, size, events, scene } = useThree();
  const occ = useMemo(() => ({ ray: new THREE.Raycaster(), next: 0, hidden: false }), []);
  const nodes = useRef<{ outer: HTMLDivElement; inner: HTMLDivElement; host: HTMLDivElement; root: Root } | null>(null);
  const last = useMemo(() => ({ cam: new THREE.Matrix4(), proj: new THREE.Matrix4(), obj: new THREE.Matrix4(), w: 0, h: 0, shown: true }), []);

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
    return () => {
      nodes.current = null;
      host.remove();
      setTimeout(() => root.unmount(), 0);
    };
  }, [gl, events.connected, last]);

  // render children into the DOM root every React render
  useLayoutEffect(() => {
    nodes.current?.root.render(
      <div
        style={{ width: widthPx, height: heightPx, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', overflow: 'hidden', position: 'relative' }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {children}
      </div>,
    );
  });

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
    if (occlude) {
      const now = performance.now();
      if (now >= occ.next) {
        occ.next = now + 160;
        const dist = toObj.length();
        occ.ray.set(camPos, v4.copy(toObj).normalize());
        occ.ray.far = dist - 0.002;
        const hits = occ.ray.intersectObjects(scene.children, true);
        occ.hidden = hits.some((h) => (h.object as THREE.Mesh).isMesh && h.object.visible && !isUnder(h.object, occludeIgnore?.current ?? g));
      }
    }
    const shown = visible && !behind && !backside && !(occlude && occ.hidden);
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
    if (last.cam.equals(camera.matrixWorldInverse) && last.obj.equals(g.matrixWorld) && last.proj.equals(camera.projectionMatrix)) return;
    last.cam.copy(camera.matrixWorldInverse);
    last.proj.copy(camera.projectionMatrix);
    last.obj.copy(g.matrixWorld);
    const fov = camera.projectionMatrix.elements[5]! * (size.height / 2);
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    n.host.style.perspective = ortho ? '' : `${fov}px`;
    const camT = ortho ? `scale(${fov})` : `translateZ(${fov}px)`;
    n.outer.style.transform = `${camT}${cameraCss(camera.matrixWorldInverse)}translate(${size.width / 2}px,${size.height / 2}px)`;
    n.inner.style.transform = objectCss(g.matrixWorld, width / widthPx);
    // nearer = higher (but bounded to keep app UI on top)
    const dist = v1.setFromMatrixPosition(g.matrixWorld).distanceTo(camPos);
    n.host.style.zIndex = String(Math.max(1, Math.round(zIndex - Math.min(zIndex - 1, dist))));
  });

  return <group ref={group} position={position} rotation={rotation} />;
}
