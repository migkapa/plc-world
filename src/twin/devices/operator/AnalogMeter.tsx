/**
 * 72 × 72 mm DIN switchboard analog panel meter (moving-coil style, 90° scale): black bezel,
 * printed white scale with ticks & numbers, units, glass window, black needle with a damped
 * spring-mass response (slight overshoot), zero-adjust screw, rear housing with terminal studs.
 *
 * Origin: center of the panel cut-out on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { AnalogMeterProps } from '../../contracts';
import { LEGEND_FONT, NARROW_FONT, boxGeo, canvasTexture, cylZ, fitText, mats, planeGeo, roundedBox, roundedRectShape, sharedGeo, sharedMat, Screw } from './shared';

export interface AnalogMeterExtProps extends AnalogMeterProps {
  /** Front frame size (m): 0.072 (default) or 0.096. */
  size?: number;
  panelThickness?: number;
  rear?: boolean;
  /** Red band from this % to 100 % (optional). */
  redFrom?: number;
}

const SWEEP = Math.PI / 2; // 90° scale
const FRAME_D = 0.0062;

function frameGeo(size: number) {
  return sharedGeo(`meter-frame:${size}`, () => {
    const s = roundedRectShape(size, size, 0.0025);
    const win = roundedRectShape(size * 0.89, size * 0.8, 0.0015);
    const hole = new THREE.Path(win.getPoints(8).map((p) => new THREE.Vector2(p.x, p.y + size * 0.04)));
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: FRAME_D - 0.0012, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 2, curveSegments: 6 });
    g.translate(0, 0, 0.0006);
    return g;
  });
}

function scaleTexture(labels: [string, string], units: string, legend: string, redFrom: number | undefined) {
  return canvasTexture(`meter-scale:${labels.join(',')}:${units}:${legend}:${redFrom ?? ''}`, 640, 576, (ctx, w, h) => {
    ctx.fillStyle = '#f6f5ef';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.93; // pivot
    const R = h * 0.6;
    const toCanvas = (v: number) => -Math.PI / 2 + (-SWEEP / 2 + SWEEP * v); // v 0..1 -> canvas angle
    // red band
    if (redFrom !== undefined) {
      ctx.strokeStyle = '#d42020';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 12, toCanvas(redFrom / 100), toCanvas(1));
      ctx.stroke();
    }
    // arc line
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R, toCanvas(0), toCanvas(1));
    ctx.stroke();
    const lo = Number(labels[0]);
    const hi = Number(labels[1]);
    const numeric = Number.isFinite(lo) && Number.isFinite(hi);
    for (let i = 0; i <= 50; i++) {
      const v = i / 50;
      const a = toCanvas(v);
      const major = i % 10 === 0;
      const mid = i % 5 === 0;
      const len = major ? 30 : mid ? 21 : 12;
      ctx.lineWidth = major ? 4 : 2.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * (R + len), cy + Math.sin(a) * (R + len));
      ctx.stroke();
      if (major) {
        const text = numeric ? String(Math.round((lo + (hi - lo) * v) * 100) / 100) : i === 0 ? labels[0] : i === 50 ? labels[1] : '';
        if (!text) continue;
        ctx.fillStyle = '#111';
        ctx.font = `700 34px ${NARROW_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const rn = R + 48;
        ctx.fillText(text, cx + Math.cos(a) * rn, cy + Math.sin(a) * rn);
      }
    }
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (units) {
      const px = fitText(ctx, units, w * 0.5, 60, 700);
      ctx.font = `700 ${px}px ${LEGEND_FONT}`;
      ctx.fillText(units, cx, h * 0.64);
    }
    if (legend) {
      const px = fitText(ctx, legend, w * 0.6, 34, 600);
      ctx.font = `600 ${px}px ${LEGEND_FONT}`;
      ctx.fillText(legend, cx, h * 0.745);
    }
    // accuracy class & moving-coil symbol
    ctx.font = `600 26px ${LEGEND_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('1.5', 26, h - 34);
    ctx.lineWidth = 2.5;
    ctx.strokeRect(w - 92, h - 52, 30, 30);
    ctx.beginPath();
    ctx.arc(w - 44, h - 37, 13, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function needleGeo() {
  return sharedGeo('meter-needle', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.0007, -0.0045);
    s.lineTo(0.0007, -0.0045);
    s.lineTo(0.00035, 0.0342);
    s.lineTo(0, 0.0362);
    s.lineTo(-0.00035, 0.0342);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.0003, bevelEnabled: false });
    return g;
  });
}

export function AnalogMeter({
  getValue,
  legend = '',
  scaleLabels = ['0', '100'],
  units = '%',
  size = 0.072,
  panelThickness = 0.002,
  rear = true,
  redFrom,
  position,
  rotation,
  scale,
}: AnalogMeterExtProps) {
  const needle = useRef<THREE.Group>(null);
  const state = useRef({ x: 0, v: 0 });
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = state.current;
    const target = THREE.MathUtils.clamp(getValue(), -2, 102) / 100;
    // damped spring (ω ≈ 11 rad/s, ζ ≈ 0.45) -> realistic needle overshoot
    const w = 11;
    const z = 0.45;
    const steps = 4;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = w * w * (target - s.x) - 2 * z * w * s.v;
      s.v += acc * h;
      s.x += s.v * h;
    }
    const n = needle.current;
    if (n) n.rotation.z = SWEEP / 2 - SWEEP * s.x;
  });

  const k = size / 0.072;
  const tex = scaleTexture(scaleLabels, units, legend, redFrom);
  const winW = size * 0.89;
  const winH = size * 0.8;
  const winCy = size * 0.04;
  const pivotY = winCy - winH / 2 + winH * 0.07;
  const glassMat = sharedMat(
    'meter-glass',
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0.1, depthWrite: false }),
  );
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* bezel frame */}
      <mesh geometry={frameGeo(size)} material={mats.blackPlastic()} castShadow receiveShadow />
      {/* inner black back + scale plate */}
      <mesh geometry={planeGeo(winW, winH)} material={mats.label(tex, false, 0.65)} position={[0, winCy, 0.0012]} />
      {/* needle */}
      <group ref={needle} position={[0, pivotY, 0.0022]} scale={[k, k, 1]}>
        <mesh geometry={needleGeo()} material={mats.matte('#101010', 0.4)} castShadow />
        <mesh geometry={boxGeo(0.004, 0.0022, 0.0012)} material={mats.matte('#101010', 0.4)} position={[0, -0.006, 0.0002]} />
      </group>
      <mesh geometry={cylZ(0.0032 * k, 0.0036 * k, 0.0024, 24)} material={mats.blackPlastic()} position={[0, pivotY, 0.0024]} />
      {/* glass */}
      <mesh geometry={planeGeo(winW, winH)} material={glassMat} position={[0, winCy, FRAME_D - 0.0012]} />
      {/* zero adjust screw */}
      <group position={[0, -size / 2 + size * 0.045, FRAME_D + 0.0001]}>
        <mesh geometry={cylZ(0.0024, 0.0024, 0.0006, 20)} material={mats.blackPlastic()} />
        <mesh geometry={boxGeo(0.0036, 0.0005, 0.0003)} material={mats.dark()} position={[0, 0, 0.00035]} rotation={[0, 0, 0.4]} />
      </group>
      {rear && (
        <group position={[0, 0, -panelThickness]}>
          <mesh geometry={roundedBox(size * 0.92, size * 0.92, 0.052, 0.003, 2)} material={mats.blackPlastic()} position={[0, 0, -0.026]} castShadow />
          {[-0.014, 0.014].map((x) => (
            <group key={x} position={[x * k, 0, -0.052]}>
              <mesh geometry={cylZ(0.0024, 0.0024, 0.009, 16)} material={mats.brass()} position={[0, 0, -0.0045]} />
              <mesh geometry={cylZ(0.0045, 0.0045, 0.0022, 6)} material={mats.brass()} position={[0, 0, -0.004]} />
            </group>
          ))}
          <Screw position={[0, size * 0.36, -0.0521]} rotation={[0, Math.PI, 0]} r={0.002} />
        </group>
      )}
    </group>
  );
}
