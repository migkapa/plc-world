/**
 * Showroom contact shadow: a soft, top-down "ambient occlusion" blob under the device, like drei's
 * <ContactShadows> but built for a viewer that swaps devices in place:
 *  - the two render targets, materials and cameras are allocated ONCE and disposed on unmount (drei re-creates
 *    them whenever `scale` changes and never disposes them, which leaked GPU memory on every device switch);
 *  - the shadow is re-rendered only when something can have moved: for a few seconds after a device change or a
 *    demo-store change, every 90 frames as a safety net, and every other frame for `live` stages (moving loads).
 *    drei's default re-renders the whole scene with a depth material plus four blur passes every frame.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

const RES = 512;

/** Number of shadow renders so far (QA hook: `window.__showroomShadowRenders()`). */
let shadowRenders = 0;
if (typeof window !== 'undefined') (window as unknown as { __showroomShadowRenders?: () => number }).__showroomShadowRenders = () => shadowRenders;
/** Per-frame shadow updates after a device / demo change: at least this long AND this many frames. */
const SETTLE_S = 2.5;
const SETTLE_FRAMES = 30;
/** Safety-net refresh (late-loading content) every N frames. */
const REFRESH_FRAMES = 90;

export interface ContactShadowProps {
  /** Side length of the square shadow plane (m). */
  size: number;
  /** Height above the plane that still casts (m). */
  far: number;
  opacity?: number;
  blur?: number;
  /** Changes when the device changes (re-render while its content mounts). */
  resetKey: string;
  /** Demo-store version getter: a change re-renders the shadow for a few seconds. */
  version?: () => number;
  /** Re-render continuously (every other frame): for stages whose silhouette moves by itself. */
  live?: boolean;
  y?: number;
}

export function ContactShadow({ size, far, opacity = 0.55, blur = 2.2, resetKey, version, live = false, y = 0.0006 }: ContactShadowProps) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const group = useRef<THREE.Group>(null);

  const r = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(RES, RES);
    const targetBlur = new THREE.WebGLRenderTarget(RES, RES);
    target.texture.generateMipmaps = targetBlur.texture.generateMipmaps = false;
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
    const depth = new THREE.MeshDepthMaterial();
    depth.depthTest = depth.depthWrite = false;
    depth.onBeforeCompile = (shader) => {
      shader.uniforms = { ...shader.uniforms, ucolor: { value: new THREE.Color('#000000') } };
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform vec3 ucolor;\nvoid main() {');
      shader.fragmentShader = shader.fragmentShader.replace('vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );');
    };
    const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    const vBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    hBlur.depthTest = vBlur.depthTest = false;
    // blur passes: a unit quad seen by its own camera (independent of where the shadow sits in the world)
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    const quad = new THREE.Mesh(quadGeo, hBlur);
    const quadCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);
    const shadowCam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    const shadowMat = new THREE.MeshBasicMaterial({ transparent: true, map: target.texture, depthWrite: false, opacity: 0.55 });
    return { target, targetBlur, plane, depth, hBlur, vBlur, quadGeo, quad, quadCam, shadowCam, shadowMat };
  }, []);

  // Dispose on real unmount only. React StrictMode runs mount → cleanup → mount on the same instance; disposing
  // in that first cleanup would free resources the remounted instance still uses, so the check is deferred.
  const generation = useRef(0);
  useEffect(() => {
    const gen = ++generation.current;
    return () => {
      setTimeout(() => {
        if (generation.current !== gen) return;
        r.target.dispose();
        r.targetBlur.dispose();
        r.plane.dispose();
        r.depth.dispose();
        r.hBlur.dispose();
        r.vBlur.dispose();
        r.quadGeo.dispose();
        r.shadowMat.dispose();
      }, 0);
    };
  }, [r]);

  // frustum follows the device size without reallocating anything
  const state = useRef({ until: 0, untilFrame: 0, pending: true, lastVersion: Number.NaN, lastRenderFrame: -Infinity, frame: 0 });
  useEffect(() => {
    const c = r.shadowCam;
    c.left = -size / 2;
    c.right = size / 2;
    c.top = size / 2;
    c.bottom = -size / 2;
    c.near = 0;
    c.far = far;
    c.updateProjectionMatrix();
    state.current.pending = true;
  }, [r, size, far]);
  useEffect(() => {
    state.current.pending = true;
  }, [resetKey]);
  useEffect(() => {
    r.shadowMat.opacity = opacity;
  }, [r, opacity]);

  const clear = useMemo(() => new THREE.Color(), []);
  const blurPass = (amount: number) => {
    r.quad.material = r.hBlur;
    r.hBlur.uniforms.tDiffuse!.value = r.target.texture;
    r.hBlur.uniforms.h!.value = amount / 256;
    gl.setRenderTarget(r.targetBlur);
    gl.render(r.quad, r.quadCam);
    r.quad.material = r.vBlur;
    r.vBlur.uniforms.tDiffuse!.value = r.targetBlur.texture;
    r.vBlur.uniforms.v!.value = amount / 256;
    gl.setRenderTarget(r.target);
    gl.render(r.quad, r.quadCam);
  };

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const s = state.current;
    const t = clock.elapsedTime;
    s.frame++;
    const v = version?.();
    if (s.pending || (v !== undefined && v !== s.lastVersion)) {
      s.pending = false;
      s.lastVersion = v ?? s.lastVersion;
      s.until = t + SETTLE_S;
      s.untilFrame = s.frame + SETTLE_FRAMES;
    }
    const due = t < s.until || s.frame < s.untilFrame || s.frame - s.lastRenderFrame >= REFRESH_FRAMES || (live && s.frame % 2 === 0);
    if (!due) return;
    s.lastRenderFrame = s.frame;

    const prevTarget = gl.getRenderTarget();
    const prevBg = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevAlpha = gl.getClearAlpha();
    gl.getClearColor(clear);
    const prevShadowAuto = gl.shadowMap.autoUpdate;
    g.visible = false;
    scene.background = null;
    scene.overrideMaterial = r.depth;
    gl.shadowMap.autoUpdate = false;
    gl.setClearColor(0x000000, 0);
    shadowRenders++;
    gl.setRenderTarget(r.target);
    gl.clear();
    gl.render(scene, r.shadowCam);
    blurPass(blur);
    blurPass(blur * 0.4);
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(clear, prevAlpha);
    gl.shadowMap.autoUpdate = prevShadowAuto;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    g.visible = true;
  });

  // Same transform stack as drei's ContactShadows (camera looks up from the floor; the plane is flipped to match).
  return (
    <group ref={group} position={[0, y, 0]} rotation-x={Math.PI / 2}>
      <mesh geometry={r.plane} material={r.shadowMat} scale={[size, -1, size]} rotation={[-Math.PI / 2, 0, 0]} />
      <primitive object={r.shadowCam} />
    </group>
  );
}
