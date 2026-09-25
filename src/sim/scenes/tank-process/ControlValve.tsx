/**
 * FCV-101 — pneumatic globe control valve with a spring-diaphragm actuator (air-to-open), yoke, stem travel
 * indicator on a 0–100 % scale and a digital positioner with a live display. The library only has on/off
 * process valves, so this local twin covers the proportional valve of the tank scene.
 *
 * Origin: pipe centreline at the valve centre; the pipe runs along X, the actuator stands up (+Y); the
 * travel scale and the positioner display face +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { FieldCable, FieldMerge } from '../../../twin/devices';
import { cylX, cylY, fm, latheY, rbox, roundRect, TAU, useDisplayTexture } from '../../../twin/devices/field/shared';

export interface ControlValveProps {
  /** Valve opening 0..1 (stem travel; smoothed by the caller or the model). */
  getOpening: () => number;
  /** Value shown on the positioner display (%). */
  getDisplay?: () => number;
  tag?: string;
  pipeDiameter?: number;
  position?: Vec3;
  rotation?: Vec3;
}

const TRAVEL = 0.028;
const BODY_BLUE = '#3f5f86';

function scaleTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9ebe6';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#111';
  ctx.font = '700 18px Arial';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 10; i++) {
    const y = 236 - i * 21.6;
    ctx.fillRect(0, y - 1, i % 5 === 0 ? 26 : 16, 2);
    if (i % 5 === 0) ctx.fillText(String(i * 10), 30, y);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let scaleTex: THREE.CanvasTexture | null = null;

export function ControlValve({ getOpening, getDisplay, tag = 'FCV-101', pipeDiameter = 0.0603, position, rotation }: ControlValveProps) {
  const stem = useRef<THREE.Group>(null);
  const body = fm.cast(BODY_BLUE, 0.5);
  const ss = fm.stainless(0.35);
  const R = pipeDiameter / 2;
  const flangeR = R * 1.35 + 0.02;
  const display = useDisplayTexture(
    256,
    128,
    () => (getDisplay ? getDisplay() : getOpening() * 100),
    (ctx, w, h, v) => {
      ctx.fillStyle = '#9fb49a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#18251a';
      ctx.font = '600 22px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(tag, 12, 10);
      ctx.fillText('AO', w - 50, 10);
      ctx.font = '700 54px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.max(0, Math.min(100, v)).toFixed(1)}`, w - 48, 44);
      ctx.font = '600 26px "JetBrains Mono", monospace';
      ctx.fillText('%', w - 14, 66);
      ctx.fillStyle = 'rgba(24,37,26,0.25)';
      roundRect(ctx, 12, h - 20, w - 24, 10, 3);
      ctx.fill();
      ctx.fillStyle = '#18251a';
      roundRect(ctx, 12, h - 20, ((w - 24) * Math.max(0, Math.min(100, v))) / 100, 10, 3);
      ctx.fill();
    },
    0.1,
    8,
  );
  if (!scaleTex) scaleTex = scaleTexture();

  useFrame(() => {
    const o = THREE.MathUtils.clamp(getOpening(), 0, 1);
    if (stem.current) stem.current.position.y = o * TRAVEL;
  });

  const bolts = useMemo(() => Array.from({ length: 12 }, (_, i) => (i / 12) * TAU), []);
  const yA = 0.36; // diaphragm casing parting line
  return (
    <group position={position} rotation={rotation}>
      {/* static parts are batched per material (bolts, flanges, yoke …); the stem group moves and is excluded */}
      <FieldMerge>
      {/* globe body with flanged ends */}
      <mesh geometry={latheY('cvGlobe', [[0, -0.07], [0.05, -0.066], [0.075, -0.035], [0.08, 0], [0.075, 0.035], [0.05, 0.062], [0.042, 0.075], [0, 0.075]], 40)} material={body} castShadow />
      <mesh geometry={cylX(R + 0.004, 0.2, 28)} material={body} castShadow />
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 0.11, 0, 0]}>
          <mesh geometry={cylX(flangeR, 0.02, 32)} material={body} castShadow />
          {[0, 1, 2, 3].map((i) => {
            const a = (i / 4) * TAU + TAU / 8;
            return <mesh key={i} geometry={cylX(0.007, 0.05, 10)} material={fm.zinc()} position={[0, Math.cos(a) * (flangeR - 0.016), Math.sin(a) * (flangeR - 0.016)]} />;
          })}
        </group>
      ))}
      {/* bonnet + packing flange */}
      <mesh geometry={cylY(0.042, 0.07, 28)} material={body} position={[0, 0.105, 0]} castShadow />
      <mesh geometry={cylY(0.058, 0.014, 28)} material={body} position={[0, 0.145, 0]} />
      <mesh geometry={cylY(0.022, 0.03, 20)} material={ss} position={[0, 0.167, 0]} />
      {/* yoke: two legs + top boss */}
      {[-1, 1].map((sz) => (
        <mesh key={sz} geometry={rbox(0.02, 0.17, 0.018, 0.004, 2)} material={body} position={[0, 0.235, sz * 0.045]} castShadow />
      ))}
      <mesh geometry={cylY(0.06, 0.03, 32)} material={body} position={[0, 0.33, 0]} castShadow />
      {/* travel scale on the front yoke leg */}
      <mesh position={[0.018, 0.235, 0.056]}>
        <planeGeometry args={[0.02, 0.08]} />
        <meshStandardMaterial map={scaleTex} roughness={0.5} />
      </mesh>
      {/* moving stem + indicator pointer + stem connector */}
      <group ref={stem} userData={{ noMerge: true }}>
        <mesh geometry={cylY(0.006, 0.2, 14)} material={fm.chrome()} position={[0, 0.25, 0]} />
        <mesh geometry={rbox(0.03, 0.022, 0.03, 0.004, 2)} material={fm.zinc()} position={[0, 0.215, 0]} />
        <mesh geometry={rbox(0.03, 0.004, 0.012, 0.001, 1)} material={fm.plastic('#d8261c', 0.4)} position={[0.012, 0.2, 0.052]} />
      </group>
      {/* spring-diaphragm actuator (two pressed dishes + flange ring + bolts) */}
      <mesh geometry={latheY('cvLowerCase', [[0.03, 0.345], [0.1, 0.35], [0.14, yA - 0.005], [0.155, yA], [0, yA]], 48)} material={fm.sheet(BODY_BLUE, 0.4)} castShadow />
      <mesh geometry={latheY('cvUpperCase', [[0, yA], [0.155, yA], [0.14, yA + 0.012], [0.1, yA + 0.07], [0.04, yA + 0.085], [0, yA + 0.086]], 48)} material={fm.sheet(BODY_BLUE, 0.4)} castShadow />
      <mesh geometry={cylY(0.16, 0.012, 48)} material={fm.sheet(BODY_BLUE, 0.4)} position={[0, yA, 0]} />
      {bolts.map((a, i) => (
        <mesh key={i} geometry={cylY(0.005, 0.03, 8)} material={fm.zinc()} position={[Math.cos(a) * 0.148, yA, Math.sin(a) * 0.148]} />
      ))}
      <mesh geometry={cylY(0.012, 0.02, 12)} material={fm.nickel()} position={[0, yA + 0.095, 0]} />
      {/* positioner on the yoke (+X side) */}
      <group position={[0.085, 0.24, 0.0]}>
        <mesh geometry={rbox(0.09, 0.12, 0.085, 0.008, 2)} material={fm.cast('#2e3339', 0.45)} castShadow />
        <mesh position={[0, 0.02, 0.0431]}>
          <planeGeometry args={[0.064, 0.032]} />
          <meshStandardMaterial map={display} emissive="#8fa48b" emissiveIntensity={0.25} emissiveMap={display} roughness={0.4} />
        </mesh>
        {/* feedback arm to the stem connector */}
        <mesh geometry={rbox(0.06, 0.006, 0.006, 0.001, 1)} material={fm.zinc()} position={[-0.04, -0.02, 0.01]} />
        {/* gauges */}
        {[-0.02, 0.02].map((x) => (
          <mesh key={x} geometry={cylY(0.011, 0.01, 18)} material={fm.nickel()} position={[x, -0.035, 0.047]} rotation={[Math.PI / 2, 0, 0]} />
        ))}
      </group>
      {/* air tubing positioner -> actuator */}
      <FieldCable
        points={[
          [0.085, 0.3, 0.02],
          [0.1, 0.4, 0.02],
          [0.06, yA + 0.12, 0.0],
          [0.0, yA + 0.105, 0.0],
        ]}
        radius={0.003}
        color="#9aa0a6"
      />
      {/* tag plate */}
      <mesh position={[0, -0.055, 0.0805]}>
        <planeGeometry args={[0.07, 0.022]} />
        <meshStandardMaterial map={tagPlate(tag)} metalness={0.5} roughness={0.35} />
      </mesh>
      </FieldMerge>
    </group>
  );
}

const tagCache = new Map<string, THREE.CanvasTexture>();
function tagPlate(tag: string) {
  let t = tagCache.get(tag);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 80;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d5d9dc';
  ctx.fillRect(0, 0, 256, 80);
  ctx.fillStyle = '#1d2226';
  ctx.font = '700 48px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, 128, 42);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  tagCache.set(tag, t);
  return t;
}
