// @vitest-environment jsdom
import { _roots } from '@react-three/fiber';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { releaseRendererAfterUnmount, trackedResourceCount, watchRenderer } from './releaseRenderer';

type Fn = () => void;

/** Registers dispose listeners the way three's WebGLRenderer does (one closure per renderer and resource kind). */
class FakeRenderer {
  readonly domElement = document.createElement('canvas');
  readonly onMaterial: Fn = () => {};
  readonly onGeometry: Fn = () => {};
  readonly onInstanced: Fn = () => {};
  readonly onTexture: Fn = () => {};
  readonly onTarget: Fn = () => {};
  autoClear = true;
  readonly shadowMap = { enabled: false };
  disposed = 0;
  private target: THREE.WebGLRenderTarget | null = null;
  getRenderTarget() {
    return this.target;
  }
  setRenderTarget(t: THREE.WebGLRenderTarget | null) {
    this.target = t;
    t?.addEventListener('dispose', this.onTarget);
  }
  compile(scene: THREE.Object3D) {
    scene.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.addEventListener('dispose', this.onMaterial));
  }
  render(scene: THREE.Object3D) {
    this.compile(scene);
    scene.traverse((o) => {
      (o as THREE.Mesh).geometry?.addEventListener('dispose', this.onGeometry);
      if ((o as THREE.InstancedMesh).isInstancedMesh) o.addEventListener('dispose', this.onInstanced);
      const map = ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map;
      if (map) this.initTexture(map);
    });
  }
  initTexture(t: THREE.Texture) {
    t.addEventListener('dispose', this.onTexture);
  }
  /** Draw a scene: listeners on everything it uses. */
  draw(scene: THREE.Scene) {
    this.render(scene);
  }
  dispose() {
    this.disposed++;
  }
}

const listeners = (o: object): unknown[] => [...((o as { _listeners?: Record<string, unknown[]> })._listeners?.dispose ?? [])];
const flush = () => new Promise((r) => setTimeout(r, 120));
const asGl = (r: FakeRenderer) => r as unknown as THREE.WebGLRenderer;

/** Module-level style resources: shared by every page, never disposed. */
function sharedScene() {
  const geometry = new THREE.BoxGeometry();
  const map = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  return { geometry, map, material, scene };
}

afterEach(() => {
  _roots.clear();
});

describe('releaseRendererAfterUnmount', () => {
  it('drops only the dead renderer from shared resources (also ones no longer in its scene), disposes it and detaches its canvas', async () => {
    const shared = sharedScene();
    const earlier = sharedScene(); // drawn once, then gone from the scene (e.g. an LOD level)
    const dead = new FakeRenderer();
    const live = new FakeRenderer();
    watchRenderer(asGl(dead));
    watchRenderer(asGl(live));
    dead.draw(earlier.scene);
    dead.draw(shared.scene);
    live.draw(shared.scene);
    expect(trackedResourceCount(asGl(dead))).toBe(6);
    // a per-page resource the renderer drops by itself when it is disposed
    const own = new THREE.BufferGeometry();
    own.addEventListener('dispose', dead.onGeometry);
    own.dispose();
    own.removeEventListener('dispose', dead.onGeometry);
    expect(trackedResourceCount(asGl(dead))).toBe(6);

    const page = document.createElement('div');
    page.append(dead.domElement);
    dead.domElement.width = 800;
    releaseRendererAfterUnmount(asGl(dead));
    await flush();

    const deadFns: unknown[] = [dead.onGeometry, dead.onMaterial, dead.onTexture];
    const liveFns: unknown[] = [live.onGeometry, live.onMaterial, live.onTexture];
    for (const r of [shared.geometry, shared.material, shared.map, earlier.geometry, earlier.material, earlier.map]) {
      expect(listeners(r).some((f) => deadFns.includes(f))).toBe(false);
    }
    for (const r of [shared.geometry, shared.material, shared.map]) expect(listeners(r).some((f) => liveFns.includes(f))).toBe(true);
    expect(dead.disposed).toBe(1);
    expect(live.disposed).toBe(0);
    expect(trackedResourceCount(asGl(live))).toBe(3);
    expect(dead.domElement.parentNode).toBeNull();
    expect(dead.domElement.width).toBe(1);
  });

  it('leaves a renderer alone while its R3F root still exists (StrictMode remount)', async () => {
    const shared = sharedScene();
    const gl = new FakeRenderer();
    watchRenderer(asGl(gl));
    gl.draw(shared.scene);
    _roots.set(gl.domElement, {} as never);
    releaseRendererAfterUnmount(asGl(gl), 200);
    await flush();
    expect(gl.disposed).toBe(0);
    expect(listeners(shared.geometry)).toContain(gl.onGeometry);
  });
});
