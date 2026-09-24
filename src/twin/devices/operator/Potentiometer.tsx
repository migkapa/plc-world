/**
 * Panel potentiometer with a fluted collet knob (satin aluminum cap, white pointer) over a black
 * anodized dial plate printed 0–10 across 270°. Drag up/down (or left/right) or use the mouse
 * wheel to change the value (0..100 %).
 *
 * Origin: center of the mounting hole on the panel front surface, +Z out of the panel.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PotentiometerProps } from '../../contracts';
import { LEGEND_FONT, arcPts, boxGeo, canvasTexture, cylZ, damp, fitText, latheZ, mats, planeGeo, roundedBox, sharedGeo, useControlsLock, useHover } from './shared';

export interface PotentiometerExtProps extends PotentiometerProps {
  panelThickness?: number;
  rear?: boolean;
  /** Knob color (default black). */
  knobColor?: string;
}

const SWEEP = (Math.PI * 3) / 2; // 270°

/** Knob rotation (rad, CCW positive) for a 0..100 value. */
export function potAngle(v: number) {
  return SWEEP / 2 - (SWEEP * THREE.MathUtils.clamp(v, 0, 100)) / 100;
}

const PLATE = { w: 0.048, h: 0.058, top: 0.026 } as const;

function dialTexture(legend: string) {
  return canvasTexture(`pot-dial:${legend}`, 512, 620, (ctx, w, h) => {
    ctx.fillStyle = '#17181a';
    ctx.fillRect(0, 0, w, h);
    const pxPerM = w / PLATE.w;
    const cx = w / 2;
    const cy = PLATE.top * pxPerM;
    ctx.strokeStyle = '#f2f2ec';
    ctx.fillStyle = '#f2f2ec';
    ctx.lineCap = 'butt';
    const r0 = 0.0142 * pxPerM;
    for (let i = 0; i <= 50; i++) {
      const v = i / 50;
      // angle from +Y, CCW positive -> canvas angle
      const a = SWEEP / 2 - SWEEP * v;
      const ca = -Math.PI / 2 - a; // canvas: 0 = +x, clockwise positive
      const major = i % 5 === 0;
      const len = (major ? 0.0028 : 0.0015) * pxPerM;
      ctx.lineWidth = major ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ca) * r0, cy + Math.sin(ca) * r0);
      ctx.lineTo(cx + Math.cos(ca) * (r0 + len), cy + Math.sin(ca) * (r0 + len));
      ctx.stroke();
      if (major) {
        const rn = r0 + 0.0052 * pxPerM;
        ctx.font = `700 34px ${LEGEND_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i / 5), cx + Math.cos(ca) * rn, cy + Math.sin(ca) * rn);
      }
    }
    if (legend) {
      const px = fitText(ctx, legend, w - 40, 54, 700);
      ctx.font = `700 ${px}px ${LEGEND_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(legend, cx, h - 0.0052 * pxPerM);
    }
  });
}

function flutedGeo() {
  return sharedGeo('pot-knob-fluted', () => {
    const n = 22;
    const shape = new THREE.Shape();
    const rO = 0.0106;
    const rI = 0.0099;
    for (let i = 0; i <= n * 4; i++) {
      const a = (i / (n * 4)) * Math.PI * 2;
      const phase = i % 4;
      const r = phase === 0 || phase === 1 ? rO : rI;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0112, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 1 });
    g.translate(0, 0, 0.0036);
    return g;
  });
}

function skirtGeo() {
  return latheZ('pot-skirt', [[0, 0.0006], [0.0128, 0.0006], [0.0129, 0.0022], ...arcPts(0.0122, 0.0022, 0.0007, 0, 90, 3), [0.0105, 0.0038], [0, 0.0038]], 56);
}

export function Potentiometer({
  getValue,
  onChange,
  legend = '',
  panelThickness = 0.002,
  rear = true,
  knobColor = '#161616',
  position,
  rotation,
  scale,
}: PotentiometerExtProps) {
  const knob = useRef<THREE.Group>(null);
  const { bind } = useHover(!!onChange);
  const lock = useControlsLock();
  const drag = useRef<{ x: number; y: number; v: number } | null>(null);
  const cb = useRef({ onChange, getValue });
  useEffect(() => {
    cb.current = { onChange, getValue };
  }, [onChange, getValue]);

  const onMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dv = (d.y - e.clientY) * 0.45 + (e.clientX - d.x) * 0.45;
    cb.current.onChange?.(THREE.MathUtils.clamp(d.v + dv, 0, 100));
  }, []);
  const onUp = useCallback(() => {
    drag.current = null;
    lock(false);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }, [lock, onMove]);
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    },
    [onMove, onUp],
  );
  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!onChange) return;
      e.stopPropagation();
      drag.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, v: getValue() };
      lock(true);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [getValue, lock, onChange, onMove, onUp],
  );
  const onWheel = useCallback(
    (e: ThreeEvent<WheelEvent>) => {
      if (!onChange) return;
      e.stopPropagation();
      onChange(THREE.MathUtils.clamp(getValue() - Math.sign(e.nativeEvent.deltaY) * 2, 0, 100));
    },
    [getValue, onChange],
  );

  useFrame((_, dt) => {
    const k = knob.current;
    if (k) k.rotation.z = damp(k.rotation.z, potAngle(getValue()), 30, Math.min(dt, 0.05));
  });

  const tex = dialTexture(legend);
  const plateCy = PLATE.top - PLATE.h / 2;
  const knobMat = mats.gloss(knobColor);
  const white = mats.matte('#f4f4ef', 0.5);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={roundedBox(PLATE.w, PLATE.h, 0.001, 0.0016, 2)} material={mats.metal('#1b1c1e', 0.5)} position={[0, plateCy, 0.0005]} receiveShadow />
      <mesh geometry={planeGeo(PLATE.w - 0.001, PLATE.h - 0.001)} material={mats.label(tex, false, 0.5)} position={[0, plateCy, 0.00102]} />
      <group ref={knob} {...bind} onPointerDown={onPointerDown} onWheel={onWheel}>
        <mesh geometry={skirtGeo()} material={knobMat} castShadow />
        <mesh geometry={flutedGeo()} material={knobMat} castShadow />
        {/* satin aluminum cap */}
        <mesh geometry={cylZ(0.0082, 0.0082, 0.0006, 40)} material={mats.metal('#c4c8cb', 0.42)} position={[0, 0, 0.0156]} />
        {/* pointer lines */}
        <mesh geometry={boxGeo(0.0011, 0.0068, 0.0003)} material={white} position={[0, 0.0043, 0.0161]} />
        <mesh geometry={boxGeo(0.0012, 0.0024, 0.0006)} material={white} position={[0, 0.0117, 0.0036]} />
      </group>
      {rear && (
        <group position={[0, 0, -panelThickness]}>
          <mesh geometry={cylZ(0.006, 0.006, 0.002, 6)} material={mats.metal('#b9bcbf', 0.35)} position={[0, 0, -0.001]} />
          <mesh geometry={cylZ(0.012, 0.012, 0.01, 32)} material={mats.metal('#8d9296', 0.4)} position={[0, 0, -0.007]} />
          {[-0.005, 0, 0.005].map((x) => (
            <mesh key={x} geometry={boxGeo(0.0018, 0.008, 0.0004)} material={mats.brass()} position={[x, -0.014, -0.009]} />
          ))}
        </group>
      )}
    </group>
  );
}
