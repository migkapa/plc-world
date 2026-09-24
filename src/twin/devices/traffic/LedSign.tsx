/**
 * LED dot-matrix message signs for parking guidance: black extruded-aluminum cabinet with a sun
 * shade, 5×7-font LED matrix behind a polycarbonate front, mounting options (wall, ceiling rods,
 * post). `ParkingStatusSign` combines a static blue "P" header panel with FULL (red) / SPACES (green)
 * LED lines — the classic garage entrance sign.
 *
 * Origins: `mount="wall"` → back-bottom-center of the cabinet; `"ceiling"` → the ceiling point above
 * the sign (sign hangs below on two rods); `"post"` → ground at the post. Faces +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedColor, LedMode } from '../../common';
import type { Placement } from '../../contracts';
import { dotMatrixTextures } from './ledTextures';
import { boxGeo, canvasTex, cylY, ledOn, makeCanvas, planeGeo, roundedBox, sharedMat, sharedTex, tmats } from './shared';

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
  /** Ceiling rod length / post height (m). */
  mountLength?: number;
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
  if (kind === 'post') {
    return (
      <>
        <mesh geometry={cylY(0.045, 0.045, length, 20)} material={tmats.galvanized()} position={[0, -length / 2, -0.05]} castShadow />
        <mesh geometry={boxGeo(0.12, 0.1, 0.06)} material={m} position={[0, h / 2, -0.02]} />
        <mesh geometry={roundedBox(0.25, 0.02, 0.25, 0.004, 1)} material={m} position={[0, -length + 0.01, -0.05]} />
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

export function LedSign({ text, color = 'red', getLit, pitch = 0.02, minCols = 0, mount = 'wall', mountLength, intensity = 3.2, position, rotation, scale }: LedSignProps) {
  const [w, h] = ledFaceSize(text, pitch, minCols);
  const depth = 0.09;
  const len = mountLength ?? (mount === 'post' ? 2.2 : 0.4);
  // Normalize the origin per mount type.
  const yOff = mount === 'ceiling' ? -(len + h + 0.06) : mount === 'post' ? len : 0;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position={[0, yOff, mount === 'post' ? 0.05 : 0]}>
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
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group position={[0, yOff, mount === 'post' ? 0.05 : 0]}>
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
