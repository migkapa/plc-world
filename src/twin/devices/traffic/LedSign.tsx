/**
 * LED dot-matrix message signs for parking guidance: black extruded-aluminum cabinet with a sun
 * shade, 5×7-font LED matrix behind a polycarbonate front, mounting options (wall, ceiling rods,
 * post). `ParkingStatusSign` combines a static blue "P" header panel with FULL (red) / SPACES (green)
 * LED lines — the classic garage entrance sign.
 *
 * Origins: `mount="wall"` → back-bottom-center of the cabinet; `"ceiling"` → the ceiling point above
 * the sign (sign hangs below on two rods); `"post"` → ground at the post axis (or midway between two
 * posts); the post runs up behind the cabinet to ~80 % of its height with two U-bolt clamp brackets.
 * Faces +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedColor, LedMode } from '../../common';
import type { Placement } from '../../contracts';
import { dotMatrixTextures } from './ledTextures';
import {
  FINISH,
  boxGeo,
  canvasTex,
  cylY,
  cylZ,
  galvPrep,
  ledOn,
  makeCanvas,
  mergeGalv,
  mergeVc,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedMat,
  sharedTex,
  tmats,
  useDisposable,
  vc,
  vcMaterial,
  xf,
  type VcFinish,
} from './shared';

const SIGN_RGB: Record<LedColor, string> = {
  red: '#ff1a0f',
  green: '#12ff4c',
  amber: '#ff8c00',
  yellow: '#ffd000',
  blue: '#2a7dff',
  white: '#ffffff',
};

export interface LedSignProps extends Placement {
  text: string;
  color?: LedColor;
  getLit: () => LedMode;
  /** LED pitch (m). Default 0.02. */
  pitch?: number;
  /** Minimum matrix columns (to size several signs identically). */
  minCols?: number;
  mount?: 'wall' | 'ceiling' | 'post' | 'none';
  /** Ceiling rod length / height of the cabinet bottom on a post (m). */
  mountLength?: number;
  /** Number of posts for `mount="post"` (default: 2 when the cabinet is wider than 1 m). */
  posts?: 1 | 2;
  intensity?: number;
}

interface FaceProps {
  text: string;
  color: LedColor;
  getLit: () => LedMode;
  pitch: number;
  minCols: number;
  intensity: number;
}

/** The LED face only (matrix + lens), centered at its origin, facing +Z. Returns its size via `ledFaceSize`. */
function LedFace({ text, color, getLit, pitch, minCols, intensity }: FaceProps) {
  const tex = dotMatrixTextures(text, minCols);
  const w = tex.cols * pitch;
  const h = tex.rows * pitch;
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: tex.base,
        emissiveMap: tex.emissive,
        emissive: SIGN_RGB[color],
        emissiveIntensity: 0,
        roughness: 0.5,
        toneMapped: false,
      }),
    [tex.base, tex.emissive, color],
  );
  useDisposable(useMemo(() => [mat], [mat]));
  const g = useRef(getLit);
  g.current = getLit;
  useFrame(({ clock }, dt) => {
    const on = ledOn(g.current(), clock.elapsedTime);
    mat.emissiveIntensity += ((on ? intensity : 0) - mat.emissiveIntensity) * (1 - Math.exp(-dt * 40));
  });
  return (
    <group>
      <mesh geometry={planeGeo(w, h)} material={mat} />
      <mesh geometry={planeGeo(w, h)} position={[0, 0, 0.004]} material={lensMat()} renderOrder={2} />
    </group>
  );
}

function lensMat() {
  return sharedMat('sign:lens', () => new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.2, depthWrite: false }));
}

export function ledFaceSize(text: string, pitch = 0.02, minCols = 0): [number, number] {
  const t = dotMatrixTextures(text, minCols);
  return [t.cols * pitch, t.rows * pitch];
}

/** Cabinet around a face of size w × h (origin = back-bottom-center). */
function Cabinet({ w, h, depth = 0.09 }: { w: number; h: number; depth?: number }) {
  const bw = w + 0.06;
  const bh = h + 0.06;
  return (
    <group>
      <mesh geometry={roundedBox(bw, bh, depth, 0.012, 2)} material={tmats.paint('#16181a', 0.5, 0.35)} position={[0, bh / 2, depth / 2]} castShadow receiveShadow />
      {/* sun shade */}
      <mesh geometry={boxGeo(bw, 0.004, 0.07)} material={tmats.paint('#16181a', 0.5, 0.35)} position={[0, bh - 0.004, depth + 0.035]} castShadow />
      {/* side end caps */}
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={roundedBox(0.012, bh + 0.008, depth + 0.006, 0.004, 1)} material={tmats.plastic('#0b0b0b', 0.6)} position={[s * (bw / 2), bh / 2, depth / 2]} />
      ))}
    </group>
  );
}

const POST_R = 0.045;
/** Gap between the post surface and the cabinet back (clamp bracket depth). */
const BRACKET = 0.03;

/** Galvanized post(s) running up behind the cabinet to ~80 % of its height. */
function postGeometry(length: number, bh: number, xs: number[]): THREE.BufferGeometry {
  return sharedGeo(`sign:posts:${length}:${bh}:${xs.join(',')}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const top = length + bh * 0.8;
    for (const x of xs) {
      const shaft = new THREE.CylinderGeometry(POST_R, POST_R, top, 20, 1, false);
      shaft.translate(x, top / 2, 0);
      parts.push(galvPrep(shaft, { cyl: { axis: 'y', radius: POST_R } }));
    }
    return mergeGalv(parts);
  });
}

/** U-bolt clamp brackets (2 per post) + base plates with anchor nuts. */
function postHardware(length: number, bh: number, xs: number[]): THREE.BufferGeometry {
  return sharedGeo(`sign:postHw:${length}:${bh}:${xs.join(',')}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const steel: VcFinish = { color: '#6f7478', roughness: 0.45, metalness: 0.85 };
    for (const x of xs) {
      for (const f of [0.2, 0.72]) {
        const y = length + bh * f;
        // channel bracket bolted to the cabinet back, U-bolt around the post, nuts
        // channel bracket on the cabinet back, U-bolt around the post (half ring behind the post +
        // straight legs through the bracket), nuts on the post side
        parts.push(vc(xf(boxGeo(0.16, 0.05, BRACKET - 0.012), [x, y, POST_R + 0.012 + (BRACKET - 0.012) / 2]), steel));
        const ru = POST_R + 0.006;
        const u = new THREE.TorusGeometry(ru, 0.005, 6, 24, Math.PI);
        u.rotateX(Math.PI / 2);
        u.rotateY(Math.PI);
        parts.push(vc(xf(u, [x, y, 0]), FINISH.stainless));
        for (const s of [-1, 1]) {
          parts.push(vc(xf(cylZ(0.005, 0.005, POST_R + BRACKET, 6), [x + s * ru, y, (POST_R + BRACKET) / 2]), FINISH.stainless));
          parts.push(vc(xf(cylZ(0.009, 0.009, 0.008, 6), [x + s * ru, y, POST_R + 0.008]), FINISH.stainless));
        }
      }
      parts.push(vc(xf(roundedBox(0.22, 0.02, 0.22, 0.004, 1), [x, 0.01, 0]), steel));
      for (const [dx, dz] of [
        [0.08, 0.08],
        [-0.08, 0.08],
        [0.08, -0.08],
        [-0.08, -0.08],
      ] as const)
        parts.push(vc(xf(cylY(0.012, 0.012, 0.016, 6), [x + dx, 0.028, dz]), FINISH.hardware));
    }
    return mergeVc(parts);
  });
}

/** Mount hardware. Frame: cabinet back-bottom-center at the origin (post: see `PostMount`). */
function Mount({ kind, w, h, depth, length }: { kind: 'wall' | 'ceiling' | 'post' | 'none'; w: number; h: number; depth: number; length: number }) {
  const m = tmats.metal('#6f7478', 0.4);
  if (kind === 'ceiling') {
    return (
      <>
        {[-w / 3, w / 3].map((x) => (
          <group key={x}>
            <mesh geometry={cylY(0.008, 0.008, length, 10)} material={m} position={[x, h + 0.06 + length / 2, depth / 2]} />
            <mesh geometry={cylY(0.04, 0.04, 0.01, 16)} material={m} position={[x, h + 0.06 + length, depth / 2]} />
          </group>
        ))}
      </>
    );
  }
  if (kind === 'wall') {
    return (
      <>
        {[-w / 3, w / 3].map((x) => (
          <mesh key={x} geometry={boxGeo(0.04, h + 0.02, 0.012)} material={m} position={[x, (h + 0.06) / 2, -0.004]} />
        ))}
      </>
    );
  }
  return null;
}

/** Post mount in the ground frame (origin = ground at the post axis / between two posts). */
function PostMount({ bw, bh, length, posts }: { bw: number; bh: number; length: number; posts: 1 | 2 }) {
  const xs = posts === 2 ? [-bw / 3, bw / 3] : [0];
  return (
    <>
      <mesh geometry={postGeometry(length, bh, xs)} material={tmats.galvanized()} castShadow receiveShadow />
      <mesh geometry={postHardware(length, bh, xs)} material={vcMaterial()} castShadow />
    </>
  );
}

/** Cabinet z offset for a post mount (cabinet back sits on the clamp brackets in front of the post). */
const POST_Z = POST_R + BRACKET;

export function LedSign({ text, color = 'red', getLit, pitch = 0.02, minCols = 0, mount = 'wall', mountLength, posts, intensity = 3.2, position, rotation, scale }: LedSignProps) {
  const [w, h] = ledFaceSize(text, pitch, minCols);
  const depth = 0.09;
  const len = mountLength ?? (mount === 'post' ? 2.2 : 0.4);
  // Normalize the origin per mount type.
  const yOff = mount === 'ceiling' ? -(len + h + 0.06) : mount === 'post' ? len : 0;
  const bw = w + 0.06;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {mount === 'post' && <PostMount bw={bw} bh={h + 0.06} length={len} posts={posts ?? (bw > 1 ? 2 : 1)} />}
      <group position={[0, yOff, mount === 'post' ? POST_Z : 0]}>
        <Cabinet w={w} h={h} depth={depth} />
        <group position={[0, (h + 0.06) / 2, depth + 0.001]}>
          <LedFace text={text} color={color} getLit={getLit} pitch={pitch} minCols={minCols} intensity={intensity} />
        </group>
        <Mount kind={mount} w={w} h={h} depth={depth} length={len} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Garage entrance status sign
// ---------------------------------------------------------------------------

function headerTexture(title: string): THREE.CanvasTexture {
  return sharedTex(`sign:header:${title}`, () => {
    const [c, ctx] = makeCanvas(768, 192);
    ctx.fillStyle = '#1554b3';
    ctx.fillRect(0, 0, 768, 192);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(10, 10, 748, 172, 18);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(34, 30, 132, 132, 16);
    ctx.fill();
    ctx.fillStyle = '#1554b3';
    ctx.font = 'bold 118px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', 100, 100);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 84px Arial, Helvetica, sans-serif';
    ctx.fillText(title, 460, 100);
    return canvasTex(c);
  });
}

export interface ParkingStatusSignProps extends Placement {
  /** Red FULL line. */
  getFull: () => LedMode;
  /** Green SPACES line. */
  getOpen: () => LedMode;
  title?: string;
  openText?: string;
  fullText?: string;
  mount?: 'wall' | 'ceiling' | 'post';
  mountLength?: number;
  /** Number of posts for `mount="post"` (default: 2 when the cabinet is wider than 1 m). */
  posts?: 1 | 2;
}

/** Blue "P PARKING" header + SPACES (green) and FULL (red) LED lines in one cabinet. */
export function ParkingStatusSign({
  getFull,
  getOpen,
  title = 'PARKING',
  openText = 'SPACES',
  fullText = 'FULL',
  mount = 'post',
  mountLength,
  posts,
  position,
  rotation,
  scale,
}: ParkingStatusSignProps) {
  const pitch = 0.02;
  const cols = Math.max(ledFaceSize(openText, pitch)[0], ledFaceSize(fullText, pitch)[0]) / pitch;
  const [w, lh] = ledFaceSize(openText, pitch, cols);
  const headerH = w * 0.25;
  const h = headerH + 2 * lh + 0.02;
  const depth = 0.1;
  const len = mountLength ?? (mount === 'post' ? 2.1 : 0.4);
  const yOff = mount === 'ceiling' ? -(len + h + 0.06) : mount === 'post' ? len : 0;
  const header = sharedMat(`sign:headerMat:${title}`, () => new THREE.MeshStandardMaterial({ map: headerTexture(title), roughness: 0.4, emissive: '#ffffff', emissiveMap: headerTexture(title), emissiveIntensity: 0.25 }));
  const top = h + 0.03;
  const bw = w + 0.06;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {mount === 'post' && <PostMount bw={bw} bh={h + 0.06} length={len} posts={posts ?? (bw > 1 ? 2 : 1)} />}
      <group position={[0, yOff, mount === 'post' ? POST_Z : 0]}>
        <Cabinet w={w} h={h} depth={depth} />
        <mesh geometry={planeGeo(w, headerH)} material={header} position={[0, top - headerH / 2, depth + 0.002]} />
        <group position={[0, top - headerH - 0.01 - lh / 2, depth + 0.001]}>
          <LedFace text={openText} color="green" getLit={getOpen} pitch={pitch} minCols={cols} intensity={3.2} />
        </group>
        <group position={[0, top - headerH - 0.02 - lh * 1.5, depth + 0.001]}>
          <LedFace text={fullText} color="red" getLit={getFull} pitch={pitch} minCols={cols} intensity={3.2} />
        </group>
        <Mount kind={mount} w={w} h={h} depth={depth} length={len} />
      </group>
    </group>
  );
}
