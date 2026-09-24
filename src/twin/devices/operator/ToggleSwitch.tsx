/**
 * Industrial trainer toggle switch: chrome bat lever (or sealed rubber boot) on a threaded
 * 15/32" bushing with hex nut and keyed washer, black anodized ON/OFF legend plate.
 * Click toggles; the lever animates from `getOn`.
 *
 * Origin: center of the mounting hole on the panel front surface, +Z out of the panel.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { ToggleSwitchProps } from '../../contracts';
import { LEGEND_FONT, canvasTexture, cylZ, damp, fitText, latheZ, mats, planeGeo, roundedBox, useClick } from './shared';

export interface ToggleSwitchExtProps extends ToggleSwitchProps {
  /** 'bat' = chrome bat-handle lever (default), 'boot' = with black rubber sealing boot. */
  variant?: 'bat' | 'boot';
  /** Position labels [up, down]. */
  labels?: [string, string];
  panelThickness?: number;
  rear?: boolean;
}

const LEVER_ANGLE = 0.36;
const PIVOT_Z = 0.0122;

function plateTexture(legend: string, up: string, down: string) {
  return canvasTexture(`toggle-plate:${legend}:${up}:${down}`, 256, 448, (ctx, w, h) => {
    ctx.fillStyle = '#18191b';
    ctx.fillRect(0, 0, w, h);
    // brushed look
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.012 + (i % 3) * 0.006})`;
      ctx.fillRect(0, (i / 90) * h, w, 1);
    }
    ctx.fillStyle = '#f0f0ea';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (legend) {
      const px = fitText(ctx, legend, w - 30, 58, 700);
      ctx.font = `700 ${px}px ${LEGEND_FONT}`;
      ctx.fillText(legend, w / 2, h * 0.1);
      ctx.fillRect(w * 0.18, h * 0.165, w * 0.64, 3);
    }
    ctx.font = `700 50px ${LEGEND_FONT}`;
    ctx.fillText(up, w / 2, h * 0.27);
    ctx.fillText(down, w / 2, h * 0.905);
  });
}

function bushingGeo() {
  // threaded bushing: zig-zag profile
  const pts: [number, number][] = [[0.0042, 0], [0.0061, 0]];
  const pitch = 0.0008;
  for (let z = 0.0004; z < 0.0092; z += pitch) {
    pts.push([0.0061, z]);
    pts.push([0.0056, z + pitch / 2]);
  }
  pts.push([0.0061, 0.0095], [0.0058, 0.0101], [0.0036, 0.0101], [0.0036, 0.009]);
  return latheZ('toggle-bushing', pts, 40);
}

function leverGeo() {
  return latheZ(
    'toggle-bat',
    [
      [0, -0.001],
      [0.0021, -0.001],
      [0.0019, 0.004],
      [0.0024, 0.016],
      [0.0029, 0.0205],
      [0.0031, 0.0215],
      [0.0027, 0.0228],
      [0.0015, 0.0234],
      [0, 0.0236],
    ],
    28,
  );
}

function bootGeo() {
  const pts: [number, number][] = [[0.0005, 0], [0.0078, 0]];
  // bellows
  for (let i = 0; i < 4; i++) {
    const z = 0.0012 + i * 0.0032;
    const r = 0.0074 - i * 0.00095;
    pts.push([r, z], [r - 0.0009, z + 0.0016]);
  }
  pts.push([0.0036, 0.0152], [0.0034, 0.022], [0.0036, 0.0232], ...([
    [0.003, 0.0246],
    [0.0016, 0.0253],
    [0, 0.0255],
  ] as [number, number][]));
  return latheZ('toggle-boot', pts, 32);
}

export function ToggleSwitch({
  getOn,
  onToggle,
  legend = '',
  variant = 'bat',
  labels = ['ON', 'OFF'],
  panelThickness = 0.002,
  rear = true,
  position,
  rotation,
  scale,
}: ToggleSwitchExtProps) {
  const frame = useRef<THREE.Group>(null);
  const lever = useRef<THREE.Group>(null);
  const { handlers } = useClick(onToggle ? () => onToggle() : undefined, frame);
  useFrame((_, dt) => {
    const l = lever.current;
    if (!l) return;
    l.rotation.x = damp(l.rotation.x, getOn() ? -LEVER_ANGLE : LEVER_ANGLE, 34, Math.min(dt, 0.05));
  });
  const tex = plateTexture(legend, labels[0], labels[1]);
  const plateW = 0.03;
  const plateH = 0.056;
  const plateCy = 0.0085;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={frame}>
        {/* legend plate */}
        <mesh geometry={roundedBox(plateW, plateH, 0.001, 0.0015, 2)} material={mats.metal('#1b1c1e', 0.45)} position={[0, plateCy, 0.0005]} receiveShadow />
        <mesh geometry={planeGeo(plateW - 0.0012, plateH - 0.0012)} material={mats.label(tex, false, 0.45)} position={[0, plateCy, 0.00102]} />
        <group {...handlers}>
          {/* keyed washer + hex nut */}
          <mesh geometry={cylZ(0.0086, 0.0086, 0.0008, 40)} material={mats.satinChrome()} position={[0, 0, 0.0014]} />
          <mesh geometry={cylZ(0.0074, 0.0074, 0.0028, 6)} material={mats.chrome()} position={[0, 0, 0.0032]} rotation={[0, 0, Math.PI / 6]} castShadow />
          <mesh geometry={bushingGeo()} material={mats.chrome()} position={[0, 0, 0.0018]} castShadow />
          <group ref={lever} position={[0, 0, PIVOT_Z]}>
            {variant === 'boot' ? (
              <mesh geometry={bootGeo()} material={mats.rubber()} position={[0, 0, -0.001]} castShadow />
            ) : (
              <mesh geometry={leverGeo()} material={mats.chrome()} castShadow />
            )}
          </group>
          {variant === 'boot' && <mesh geometry={cylZ(0.0079, 0.0079, 0.0018, 32)} material={mats.rubber()} position={[0, 0, PIVOT_Z - 0.0012]} />}
        </group>
      </group>
      {rear && (
        <group position={[0, 0, -panelThickness]}>
          <mesh geometry={cylZ(0.0074, 0.0074, 0.0028, 6)} material={mats.chrome()} position={[0, 0, -0.0014]} rotation={[0, 0, Math.PI / 6]} />
          <mesh geometry={roundedBox(0.0135, 0.0135, 0.02, 0.001, 2)} material={mats.blackPlastic()} position={[0, 0, -0.013]} />
          {[-0.0045, 0, 0.0045].map((x) => (
            <mesh key={x} geometry={roundedBox(0.0022, 0.0008, 0.008, 0.0002, 1)} material={mats.brass()} position={[x, 0, -0.027]} />
          ))}
        </group>
      )}
    </group>
  );
}
