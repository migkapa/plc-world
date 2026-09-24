/**
 * Bulletin 1606-XLS DIN-rail 24 V DC power supply (1606-XLS240E: 60 × 124 × 117 mm): natural
 * aluminum housing with ventilation slots, raised front label panel, black screw terminal rows
 * (input N / L / PE on top, output + + − − and DC-OK relay 13/14 at the bottom), green DC OK LED
 * and 24–28 V adjustment potentiometer.
 *
 * Origin: DIN clip plane on the rail centerline at the center of the unit.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { LEGEND_FONT, LIT_HEX, NARROW_FONT, Screw, boxGeo, canvasTexture, cylZ, mats, mergedCopies, planeGeo, roundedBox, sharedMat } from '../operator/shared';

export interface PowerSupply1606Props extends Placement {
  /** DC OK LED state (default: always on). */
  getOk?: () => boolean;
  catalog?: string;
  /** Output rating text. */
  rating?: string;
  /** Housing width (m): 0.06 for 240 W (default), 0.04 for 120 W, 0.032 for 80 W. */
  width?: number;
}

export const PSU = { h: 0.124, d: 0.117, recess: 0.03, frontDepth: 0.02 } as const;

function labelTexture(catalog: string, rating: string, w: number) {
  const px = Math.round(w * 6000);
  return canvasTexture(`1606-label:${catalog}:${rating}:${px}`, px, 380, (ctx, cw, ch) => {
    ctx.fillStyle = '#dcdedd';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#2b2e31';
    ctx.fillRect(0, 0, cw, 46);
    ctx.fillStyle = '#f2f2ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 26px ${LEGEND_FONT}`;
    ctx.fillText(catalog, cw / 2, 24);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `700 40px ${LEGEND_FONT}`;
    ctx.fillText(rating.split(' ').slice(0, 2).join(' '), cw / 2, 96);
    ctx.font = `600 24px ${NARROW_FONT}`;
    ctx.fillText(rating.split(' ').slice(2).join(' '), cw / 2, 134);
    ctx.fillText('DC OK', cw * 0.3, 196);
    ctx.fillText('24-28V', cw * 0.72, 196);
    ctx.font = `600 20px ${NARROW_FONT}`;
    ctx.fillText('INPUT 100-240V AC', cw / 2, 290);
    ctx.fillText('50-60Hz', cw / 2, 316);
    ctx.fillStyle = '#6f7478';
    ctx.fillRect(12, 344, cw - 24, 3);
  });
}

function terminalLabelTexture(labels: string[]) {
  return canvasTexture(`1606-tlabels:${labels.join('|')}`, labels.length * 64, 48, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.font = `700 30px ${LEGEND_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    labels.forEach((l, i) => ctx.fillText(l, (i + 0.5) * (w / labels.length), h / 2));
  });
}

function ventGeo(width: number) {
  return mergedCopies(
    `1606-vents:${width}`,
    () => boxGeo(1, 1, 1).clone(),
    () => {
      const out: THREE.Matrix4[] = [];
      const cols = Math.max(2, Math.floor((width - 0.01) / 0.0065));
      const rows = 9;
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
          out.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(-((cols - 1) * 0.0065) / 2 + c * 0.0065, 0, 0.012 + r * 0.0088),
              new THREE.Quaternion(),
              new THREE.Vector3(0.0036, 0.0004, 0.0062),
            ),
          );
      return out;
    },
  );
}

function TerminalRow({ labels, y, z, up, width }: { labels: string[]; y: number; z: number; up: boolean; width: number }) {
  const n = labels.length;
  const pitch = Math.min(0.0102, (width - 0.004) / n);
  const x0 = -((n - 1) * pitch) / 2;
  const s = up ? 1 : -1;
  return (
    <group position={[0, y, z]}>
      {labels.map((_, i) => (
        <group key={i} position={[x0 + i * pitch, 0, 0]}>
          <mesh geometry={roundedBox(pitch - 0.0006, 0.022, 0.014, 0.0008, 1)} material={mats.matte('#1c1d1f', 0.55)} position={[0, 0, 0.007]} castShadow />
          <mesh geometry={boxGeo(pitch - 0.0035, 0.0065, 0.0004)} material={mats.dark()} position={[0, -s * 0.0035, 0.0141]} />
          <Screw position={[0, -s * 0.0035, 0.0128]} r={Math.min(0.0028, pitch * 0.3)} h={0.0013} />
          {/* wire entry on the outer end face */}
          <mesh geometry={boxGeo(pitch - 0.004, 0.0004, 0.0062)} material={mats.dark()} position={[0, s * 0.0111, 0.0078]} />
        </group>
      ))}
      <mesh geometry={planeGeo(n * pitch, 0.0042)} material={mats.label(terminalLabelTexture(labels), true)} position={[0, s * 0.0068, 0.0142]} />
    </group>
  );
}

export function PowerSupply1606({ getOk, catalog = '1606-XLS240E', rating = '24V DC 10A 240W', width = 0.06, position, rotation, scale }: PowerSupply1606Props) {
  const W = width;
  const H = PSU.h;
  const D = PSU.d;
  const bodyD = D - PSU.frontDepth;
  const alu = sharedMat('1606-alu', () => new THREE.MeshStandardMaterial({ color: '#c9cdd1', metalness: 0.62, roughness: 0.48, shadowSide: THREE.BackSide }));
  const led = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0b3a14', emissive: LIT_HEX.green, emissiveIntensity: 0, toneMapped: false, roughness: 0.3 }), []);
  useEffect(() => () => led.dispose(), [led]);
  useFrame(() => {
    const ok = getOk ? getOk() : true;
    if (led.userData.ok === ok) return;
    led.userData.ok = ok;
    led.emissiveIntensity = ok ? 3.2 : 0;
    led.color.set(ok ? '#3cff6a' : '#0b3a14');
  });
  const frontH = H - 2 * PSU.recess;
  const lblTex = labelTexture(catalog, rating, W);
  const labelH = frontH - 0.004;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* aluminum housing */}
      <mesh geometry={roundedBox(W, H, bodyD, 0.0025, 2)} material={alu} position={[0, 0, bodyD / 2]} castShadow receiveShadow />
      {/* side grooves (extruded profile look) */}
      {[-1, 1].map((s) =>
        [0.3, 0.5, 0.7].map((f) => (
          <mesh key={`${s}${f}`} geometry={boxGeo(0.0004, H - 0.01, 0.0016)} material={mats.metal('#9ea3a8', 0.5)} position={[s * (W / 2 + 0.0001), 0, bodyD * f]} />
        )),
      )}
      {/* vents top & bottom */}
      <mesh geometry={ventGeo(W)} material={mats.dark()} position={[0, H / 2 + 0.0001, 0]} />
      <mesh geometry={ventGeo(W)} material={mats.dark()} position={[0, -H / 2 - 0.0001, 0]} />
      {/* raised front panel with label */}
      <mesh geometry={roundedBox(W - 0.002, frontH, PSU.frontDepth + 0.004, 0.002, 2)} material={mats.matte('#4a4e53', 0.5)} position={[0, 0, bodyD + PSU.frontDepth / 2 - 0.002]} castShadow />
      <mesh geometry={planeGeo(W - 0.006, labelH)} material={mats.label(lblTex, false, 0.55)} position={[0, 0, D + 0.0001]} />
      {/* DC OK LED + adjust pot (positions match the label print) */}
      <mesh geometry={cylZ(0.0022, 0.0022, 0.0016, 16)} material={led} position={[-W / 2 + 0.003 + (W - 0.006) * 0.3, labelH / 2 - labelH * (160 / 380), D + 0.0008]} />
      <group position={[-W / 2 + 0.003 + (W - 0.006) * 0.72, labelH / 2 - labelH * (160 / 380), D]}>
        <mesh geometry={cylZ(0.0032, 0.0032, 0.002, 20)} material={mats.matte('#2b2d30', 0.5)} position={[0, 0, 0.001]} />
        <mesh geometry={boxGeo(0.0044, 0.0007, 0.0006)} material={mats.dark()} position={[0, 0, 0.0021]} rotation={[0, 0, 0.6]} />
      </group>
      {/* terminal rows in the recessed zones */}
      <TerminalRow labels={['N', 'L', 'PE']} y={H / 2 - PSU.recess / 2 + 0.002} z={bodyD} up width={W} />
      <TerminalRow labels={W >= 0.05 ? ['+', '+', '−', '−', '13', '14'] : ['+', '+', '−', '−']} y={-H / 2 + PSU.recess / 2 - 0.002} z={bodyD} up={false} width={W} />
    </group>
  );
}
