/**
 * Cheap particle / glow helpers for the street scenes (one draw call each):
 *
 *  - <PointSprites>: a THREE.Points cloud with per-point world size, colour, alpha and rotation (custom shader,
 *    size in metres with perspective), additive (glows, sparks, impact flash) or normal blending (smoke).
 *    The caller fills the attribute arrays every frame through `update(buf)` and returns the point count.
 *  - glow / smoke sprite textures (canvas, shared).
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { canvasTexture, mulberry } from '../trainer/kit';
import { useDisposeOnUnmount } from '../../../twin/dispose';

export interface SpriteBuffers {
  /** xyz per point (world units of the parent frame). */
  pos: Float32Array;
  /** rgb per point (linear, may exceed 1 for additive glows). */
  col: Float32Array;
  /** Diameter in metres. */
  size: Float32Array;
  alpha: Float32Array;
  rot: Float32Array;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aRot;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying float vRot;
varying vec3 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uScale / max(0.05, -mvPosition.z);
  vAlpha = aAlpha;
  vRot = aRot;
  vColor = aColor;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying float vRot;
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot);
  float k = cos(vRot);
  vec2 uv = vec2(k * c.x - s * c.y, s * c.x + k * c.y) + 0.5;
  vec4 t = texture2D(uMap, uv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
  #include <fog_fragment>
}
`;

export function glowTexture(): THREE.Texture {
  return canvasTexture('fx:glow', 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function smokeTexture(): THREE.Texture {
  return canvasTexture('fx:smoke', 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const rnd = mulberry(17);
    // a few overlapping soft blobs = a billowy puff
    for (let i = 0; i < 14; i++) {
      const r = w * (0.16 + rnd() * 0.16);
      const x = w / 2 + (rnd() - 0.5) * w * 0.36;
      const y = h / 2 + (rnd() - 0.5) * h * 0.36;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const v = 200 + Math.round(rnd() * 55);
      g.addColorStop(0, `rgba(${v},${v},${v},0.34)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

/** Points cloud with per-point size / colour / alpha / rotation. */
export function PointSprites({
  capacity,
  map,
  additive,
  update,
  renderOrder = 10,
}: {
  capacity: number;
  map: THREE.Texture;
  additive: boolean;
  /** Fill the buffers, return the number of live points. Must not allocate. */
  update: (buf: SpriteBuffers, dt: number) => number;
  renderOrder?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const { geo, buf } = useMemo(() => {
    const buf: SpriteBuffers = {
      pos: new Float32Array(capacity * 3),
      col: new Float32Array(capacity * 3),
      size: new Float32Array(capacity),
      alpha: new Float32Array(capacity),
      rot: new Float32Array(capacity),
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buf.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(buf.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(buf.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(buf.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(buf.rot, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    return { geo: g, buf };
  }, [capacity]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: map }, uScale: { value: 500 } }]),
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        fog: !additive,
      }),
    [map, additive],
  );
  useDisposeOnUnmount(geo);
  useDisposeOnUnmount(mat);
  const gl = useThree((s) => s.gl);
  const tmp = useMemo(() => new THREE.Vector2(), []);
  const upd = useRef(update);
  upd.current = update;
  useFrame(({ camera }, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    gl.getDrawingBufferSize(tmp);
    const focal = cam.isPerspectiveCamera ? tmp.y / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) : tmp.y / 2;
    mat.uniforms.uScale!.value = focal;
    const n = upd.current(buf, Math.min(dt, 0.1));
    geo.setDrawRange(0, n);
    const p = ref.current;
    if (p) p.visible = n > 0;
    if (n > 0) {
      for (const name of ['position', 'aColor', 'aSize', 'aAlpha', 'aRot']) {
        const a = geo.attributes[name] as THREE.BufferAttribute;
        a.needsUpdate = true;
      }
    }
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={renderOrder} />;
}
