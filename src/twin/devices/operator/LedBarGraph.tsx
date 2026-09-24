/**
 * Vertical 10-segment LED bar-graph indicator (panel mount): black bezel, dark red-tinted window,
 * 6 green / 2 amber / 2 red segments lit bottom-up from `getValue` (0..100 %), printed scale.
 * One instanced draw call for all segments.
 *
 * Origin: center of the panel cut-out on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LedColor } from '../../common';
import type { Placement } from '../../contracts';
import { LEGEND_FONT, LIT_HEX, boxGeo, canvasTexture, fitText, mats, planeGeo, roundedBox, sharedMat } from './shared';

export interface LedBarGraphProps extends Placement {
  /** 0..100 %. */
  getValue: () => number;
  legend?: string;
  /** Segment count (default 10). */
  segments?: number;
  panelThickness?: number;
  rear?: boolean;
}

const BODY = { w: 0.03, h: 0.118, d: 0.006 } as const;
const SEG = { w: 0.0118, h: 0.0072, pitch: 0.0093 } as const;
const SEG_X = -0.0045;

function segColor(i: number, n: number): LedColor {
  const f = (i + 1) / n;
  return f > 0.8 ? 'red' : f > 0.6 ? 'amber' : 'green';
}

function bezelTexture(legend: string, n: number) {
  return canvasTexture(`bargraph-bezel:${legend}:${n}`, 256, 1008, (ctx, w, h) => {
    ctx.fillStyle = '#161719';
    ctx.fillRect(0, 0, w, h);
    const pxPerM = w / BODY.w;
    ctx.fillStyle = '#e9e9e3';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `700 30px ${LEGEND_FONT}`;
    const y0 = h / 2 + ((n * SEG.pitch) / 2) * pxPerM;
    const xs = w / 2 + (SEG_X + SEG.w / 2 + 0.0026) * pxPerM;
    for (let i = 0; i <= n; i++) {
      const y = y0 - i * SEG.pitch * pxPerM;
      const major = i % 5 === 0;
      ctx.fillRect(xs, y - 1.5, major ? 26 : 14, 3);
      if (major) ctx.fillText(String((i * 100) / n), xs + 30, y);
    }
    if (legend) {
      const px = fitText(ctx, legend, w - 20, 40, 700);
      ctx.font = `700 ${px}px ${LEGEND_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(legend, w / 2, h - 0.0045 * pxPerM);
    }
    ctx.textAlign = 'center';
    ctx.font = `700 26px ${LEGEND_FONT}`;
    ctx.fillText('%', w / 2, 0.004 * pxPerM);
  });
}

export function LedBarGraph({ getValue, legend = '', segments = 10, panelThickness = 0.002, rear = true, position, rotation, scale }: LedBarGraphProps) {
  const inst = useRef<THREE.InstancedMesh>(null);
  const n = segments;
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const colors = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const c = LIT_HEX[segColor(i, n)];
        return { on: new THREE.Color(c).multiplyScalar(3.2), off: new THREE.Color(c).multiplyScalar(0.07) };
      }),
    [n],
  );
  const lastCount = useRef(-1);
  useLayoutEffect(() => {
    const m = inst.current;
    if (!m) return;
    const tmp = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      tmp.makeTranslation(0, (i - (n - 1) / 2) * SEG.pitch, 0);
      m.setMatrixAt(i, tmp);
      m.setColorAt(i, colors[i]!.off);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    lastCount.current = -1;
  }, [n, colors]);
  useFrame(() => {
    const m = inst.current;
    if (!m) return;
    const v = getValue();
    let count = 0;
    for (let i = 0; i < n; i++) if (v >= ((i + 0.5) * 100) / n) count = i + 1;
    if (count === lastCount.current) return;
    lastCount.current = count;
    for (let i = 0; i < n; i++) m.setColorAt(i, i < count ? colors[i]!.on : colors[i]!.off);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  const tex = bezelTexture(legend, n);
  const winH = n * SEG.pitch + 0.003;
  const filter = sharedMat('bargraph-filter', () => new THREE.MeshStandardMaterial({ color: '#2a0b0b', transparent: true, opacity: 0.35, roughness: 0.08, metalness: 0.1, depthWrite: false }));
  const segX = SEG_X;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={roundedBox(BODY.w, BODY.h, BODY.d, 0.0018, 2)} material={mats.blackPlastic()} position={[0, 0, BODY.d / 2]} castShadow />
      <mesh geometry={planeGeo(BODY.w - 0.001, BODY.h - 0.001)} material={mats.label(tex, false, 0.55)} position={[0, 0, BODY.d + 0.00002]} />
      {/* recessed window */}
      <mesh geometry={boxGeo(SEG.w + 0.003, winH, 0.0004)} material={mats.dark()} position={[segX, 0, BODY.d + 0.00005]} />
      <instancedMesh ref={inst} args={[boxGeo(SEG.w, SEG.h, 0.0006), mat, n]} position={[segX, 0, BODY.d + 0.0004]} />
      <mesh geometry={planeGeo(SEG.w + 0.003, winH)} material={filter} position={[segX, 0, BODY.d + 0.0009]} />
      {rear && <mesh geometry={roundedBox(BODY.w * 0.85, BODY.h * 0.9, 0.03, 0.002, 2)} material={mats.blackPlastic()} position={[0, 0, -panelThickness - 0.015]} />}
    </group>
  );
}
