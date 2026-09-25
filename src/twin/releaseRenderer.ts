/**
 * Full release of a WebGLRenderer once its React Three Fiber root has been torn down.
 *
 * Why: R3F's unmount only calls `forceContextLoss()`, never `gl.dispose()`, and a dead renderer stays reachable
 * afterwards. Every three.js resource that outlives the page keeps the renderer's `'dispose'` listeners, whose
 * closures hold the renderer internals (programs, shader sources, GPU object wrappers), its WebGL context and so
 * the <canvas>; and the canvas pinned its detached parent, i.e. the whole unmounted page DOM and its React fibers.
 * Such long-lived resources are three's module-level `DFG_LUT` DataTexture, the module-level full-screen
 * triangles of n8ao and postprocessing, and our own module caches of shared geometries / materials / textures.
 *
 * How:
 *  - `watchRenderer(gl)` (right after creation, before the first frame) learns the renderer's own dispose
 *    listeners by letting it initialise throw-away probe objects; from then on every resource the renderer
 *    registers one of those listeners on is tracked (weakly, via a small `EventDispatcher` hook);
 *  - `releaseRendererAfterUnmount(gl)` waits for R3F's teardown, then removes the dead renderer's listeners from
 *    every tracked resource that is still alive, calls `gl.dispose()`, and detaches the canvas (shrunk to 1x1)
 *    from the dead page, so nothing is left to retain the renderer or the page.
 * Shared resources are not disposed, so a renderer that is still alive keeps its GPU copies (no re-upload).
 */
import { _roots } from '@react-three/fiber';
import * as THREE from 'three';

type Listener = (event: { type: string; target: unknown }) => void;
interface Dispatcher {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}
interface ListenerHolder {
  _listeners?: Record<string, Listener[] | undefined>;
}

/** Resources one renderer has registered its dispose listeners on (weak: never keeps a resource alive). */
interface Tracked {
  listeners: Listener[];
  refs: Set<WeakRef<Dispatcher>>;
  byTarget: WeakMap<Dispatcher, WeakRef<Dispatcher>>;
}

interface Registry {
  /** Renderer dispose-listener function -> its renderer's tracking record. */
  byListener: WeakMap<Listener, Tracked>;
  byRenderer: WeakMap<THREE.WebGLRenderer, Tracked>;
}
// kept on globalThis so a hot-reloaded copy of this module shares it with the (hooked-once) EventDispatcher
const REGISTRY = Symbol.for('plcw.releaseRenderer');
const HOOKED = Symbol.for('plcw.disposeListenerTracking');
const holder = globalThis as unknown as { [REGISTRY]?: Registry };
const { byListener, byRenderer } = (holder[REGISTRY] ??= { byListener: new WeakMap(), byRenderer: new WeakMap() });

/** Wrap EventDispatcher add/removeEventListener once: 'dispose' listeners of watched renderers are tracked. */
function hookEventDispatcher(): void {
  const proto = THREE.EventDispatcher.prototype as unknown as Dispatcher & { [HOOKED]?: true };
  if (proto[HOOKED]) return;
  proto[HOOKED] = true;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: Dispatcher, type: string, listener: Listener) {
    if (type === 'dispose') {
      const t = byListener.get(listener);
      if (t && !t.byTarget.has(this)) {
        const ref = new WeakRef(this);
        t.byTarget.set(this, ref);
        t.refs.add(ref);
      }
    }
    add.call(this, type, listener);
  };
  proto.removeEventListener = function (this: Dispatcher, type: string, listener: Listener) {
    if (type === 'dispose') {
      const t = byListener.get(listener);
      const ref = t?.byTarget.get(this);
      if (t && ref) {
        t.byTarget.delete(this);
        t.refs.delete(ref);
      }
    }
    remove.call(this, type, listener);
  };
}
hookEventDispatcher();

function disposeListenersOf(obj: unknown): Listener[] {
  return [...((obj as ListenerHolder)._listeners?.dispose ?? [])];
}

/**
 * Learn `gl`'s dispose listeners from probe objects it initialises — material (renderer and shadow map: the probe
 * material needs its own shadow depth variant), geometry, instanced mesh, texture and render target — with one
 * render of a degenerate (zero-area) triangle into a 1x1 target, and start tracking the resources it registers them
 * on. Call right after creation, before the first frame.
 */
export function watchRenderer(gl: THREE.WebGLRenderer): void {
  if (byRenderer.has(gl)) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  texture.needsUpdate = true;
  // map + alphaTest: the shadow map keeps a per-material depth variant (and a dispose listener) for it
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const light = new THREE.DirectionalLight();
  light.castShadow = true;
  light.shadow.mapSize.set(1, 1);
  const scene = new THREE.Scene();
  scene.add(mesh, light);
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const found = new Set<Listener>();
  const prevTarget = gl.getRenderTarget();
  const prevAutoClear = gl.autoClear;
  const prevShadows = gl.shadowMap.enabled;
  try {
    gl.shadowMap.enabled = true;
    gl.setRenderTarget(target);
    gl.autoClear = false;
    gl.render(scene, camera);
    for (const o of [material, geometry, mesh, target, texture]) for (const fn of disposeListenersOf(o)) found.add(fn);
  } catch {
    /* best effort: without the listeners the release still disposes the renderer and detaches its canvas */
  } finally {
    gl.autoClear = prevAutoClear;
    gl.shadowMap.enabled = prevShadows;
    gl.setRenderTarget(prevTarget);
    mesh.dispose();
    geometry.dispose();
    material.dispose();
    target.dispose();
    texture.dispose();
    light.dispose();
  }
  const tracked: Tracked = { listeners: [...found], refs: new Set(), byTarget: new WeakMap() };
  for (const fn of tracked.listeners) byListener.set(fn, tracked);
  byRenderer.set(gl, tracked);
}

/** Resources `gl` currently holds a dispose listener on (for tests / diagnostics). */
export function trackedResourceCount(gl: THREE.WebGLRenderer): number {
  return byRenderer.get(gl)?.refs.size ?? 0;
}

function releaseNow(gl: THREE.WebGLRenderer): void {
  const tracked = byRenderer.get(gl);
  byRenderer.delete(gl);
  if (tracked) {
    for (const ref of [...tracked.refs]) {
      const target = ref.deref();
      if (target) for (const fn of tracked.listeners) target.removeEventListener('dispose', fn);
    }
    tracked.refs.clear();
  }
  try {
    gl.dispose();
  } catch {
    /* context already gone: nothing left to free */
  }
  // the canvas sits in the unmounted page's detached DOM: cut it loose so a leftover reference to the dead
  // context cannot pin that page, and free its drawing buffer
  const canvas = gl.domElement;
  if (!canvas.isConnected) {
    canvas.remove();
    canvas.width = 1;
    canvas.height = 1;
  }
}

/**
 * Call when the canvas unmounts. Waits for R3F's teardown (it forces the context loss and deletes the root a
 * couple of React commits later), then releases `gl`. A root that comes back (React StrictMode's simulated
 * unmount + remount keeps the same canvas) is left alone.
 */
export function releaseRendererAfterUnmount(gl: THREE.WebGLRenderer, timeoutMs = 15000): void {
  const canvas = gl.domElement;
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const poll = (): void => {
    if (!_roots.has(canvas)) releaseNow(gl);
    else if (now() - t0 < timeoutMs) setTimeout(poll, 50);
  };
  setTimeout(poll, 0);
}
