/**
 * Bulletin 1606-XLS DIN-rail 24 V DC power supply (1606-XLS240E: 60 × 124 × 117 mm): natural
 * aluminum housing with ventilation slots, raised front label panel, quick-connect SPRING-CLAMP
 * terminals (two per pole: wire opening + screwdriver release slot, no screws) — OUTPUT on TOP
 * (+ + − − and the DC-OK relay contact 13/14), INPUT at the BOTTOM (N L PE) — green DC OK LED,
 * red OVERLOAD LED and the 24–28 V adjustment potentiometer at the output end of the label.
 *
 * Origin: DIN clip plane on the rail centerline at the center of the unit.
 * Performance: housing + terminals = one merged mesh, + label quad + 2 LEDs.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { F, LEGEND_FONT, LIT_HEX, NARROW_FONT, boxGeo, canvasTexture, cylZ, fitText, mats, partsGeo, planeGeo, roundedBox, sharedMat, uberMat, type Parts } from '../operator/shared';

export interface PowerSupply1606Props extends Placement {
  /** DC OK LED state (default: always on). */
  getOk?: () => boolean;
  /** Red OVERLOAD LED state (default: off). */
  getOverload?: () => boolean;
  catalog?: string;
  /** Output rating text. */
  rating?: string;
  /** Housing width (m): 0.06 for 240 W (default), 0.04 for 120 W, 0.032 for 80 W. */
  width?: number;
}

export const PSU = { h: 0.124, d: 0.117, recess: 0.03, frontDepth: 0.02 } as const;

/** Label layout (fractions of the label height from the top / of the width from the left). */
const LBL = { ledRow: 0.1, ledLabel: 0.175, ok: 0.2, ovl: 0.5, pot: 0.82 } as const;

function labelTexture(catalog: string, rating: string, w: number) {
  const px = Math.round(w * 6000);
  return canvasTexture(`1606-label-v3:${catalog}:${rating}:${px}`, px, 380, (ctx, cw, ch) => {
    ctx.fillStyle = '#dcdedd';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // LED / pot legends (output end = top)
    // one common size so the three legends never collide on narrow (40 / 32 mm) housings
    const small = Math.min(...['DC OK', 'OVERLOAD', '24-28V'].map((t) => fitText(ctx, t, cw * 0.27, 18, 700, NARROW_FONT)));
    ctx.font = `700 ${small}px ${NARROW_FONT}`;
    ctx.fillText('DC OK', cw * LBL.ok, ch * LBL.ledLabel);
    ctx.fillText('OVERLOAD', cw * LBL.ovl, ch * LBL.ledLabel);
    ctx.fillText('24-28V', cw * LBL.pot, ch * LBL.ledLabel);
    ctx.fillText('DC OUTPUT', cw / 2, ch * 0.03 + 6);
    // catalog band
    ctx.fillStyle = '#2b2e31';
    ctx.fillRect(0, ch * 0.24, cw, 46);
    ctx.fillStyle = '#f2f2ee';
    const cpx = fitText(ctx, catalog, cw - 16, 26, 700);
    ctx.font = `700 ${cpx}px ${LEGEND_FONT}`;
    ctx.fillText(catalog, cw / 2, ch * 0.24 + 24);
    ctx.fillStyle = '#1a1a1a';
    const parts = rating.split(' ');
    const r1 = parts.slice(0, 2).join(' ');
    const rpx = fitText(ctx, r1, cw - 16, 40, 700);
    ctx.font = `700 ${rpx}px ${LEGEND_FONT}`;
    ctx.fillText(r1, cw / 2, ch * 0.46);
    ctx.font = `600 24px ${NARROW_FONT}`;
    ctx.fillText(parts.slice(2).join(' '), cw / 2, ch * 0.555);
    ctx.fillStyle = '#6f7478';
    ctx.fillRect(12, ch * 0.66, cw - 24, 3);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `600 ${Math.min(20, Math.floor(cw / 9))}px ${NARROW_FONT}`;
    ctx.fillText('INPUT 100-240V AC', cw / 2, ch * 0.78);
    ctx.fillText('50-60Hz', cw / 2, ch * 0.85);
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

/**
 * Row of quick-connect spring-clamp terminals in a recessed zone. `up` = row at the top end
 * (wire openings face up/out). Each pole: black body, square wire opening on the front near the
 * outer end, narrow release slot next to it, orange release lever tip.
 */
function addTerminalRow(b: Parts, n: number, y: number, z: number, up: boolean, width: number) {
  const pitch = Math.min(0.0102, (width - 0.004) / n);
  const x0 = -((n - 1) * pitch) / 2;
  const s = up ? 1 : -1;
  for (let i = 0; i < n; i++) {
    b.at([x0 + i * pitch, y, z], undefined, (t) => {
      t.add(roundedBox(pitch - 0.0006, 0.022, 0.014, 0.0008, 1), F.matte('#1c1d1f', 0.55), [0, 0, 0.007]);
      // wire opening (toward the outer end) and screwdriver release slot (toward the label)
      t.add(boxGeo(Math.min(0.0036, pitch * 0.45), 0.0036, 0.0006), F.hole, [0, s * 0.0052, 0.0139]);
      t.add(boxGeo(Math.min(0.0016, pitch * 0.2), 0.0042, 0.0006), F.hole, [0, -s * 0.0012, 0.0139]);
      t.add(boxGeo(Math.min(0.0024, pitch * 0.28), 0.0014, 0.0008), F.matte('#e0782a', 0.5), [0, -s * 0.0048, 0.0141]);
      // wire entry on the outer end face
      t.add(boxGeo(pitch - 0.004, 0.0004, 0.0062), F.hole, [0, s * 0.0111, 0.0078]);
    });
  }
}

function ventGeoAdd(b: Parts, width: number, y: number) {
  const cols = Math.max(2, Math.floor((width - 0.01) / 0.0065));
  const rows = 9;
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) b.add(boxGeo(0.0036, 0.0004, 0.0062), F.hole, [-((cols - 1) * 0.0065) / 2 + c * 0.0065, y, 0.012 + r * 0.0088]);
}

export function PowerSupply1606({ getOk, getOverload, catalog = '1606-XLS240E', rating = '24V DC 10A 240W', width = 0.06, position, rotation, scale }: PowerSupply1606Props) {
  const W = width;
  const H = PSU.h;
  const D = PSU.d;
  const bodyD = D - PSU.frontDepth;
  const leds = useMemo(
    () => ({
      ok: new THREE.MeshStandardMaterial({ color: '#0b3a14', emissive: LIT_HEX.green, emissiveIntensity: 0, toneMapped: false, roughness: 0.3 }),
      ovl: new THREE.MeshStandardMaterial({ color: '#3a0b0b', emissive: LIT_HEX.red, emissiveIntensity: 0, toneMapped: false, roughness: 0.3 }),
    }),
    [],
  );
  useEffect(() => () => {
    leds.ok.dispose();
    leds.ovl.dispose();
  }, [leds]);
  useFrame(() => {
    const ok = getOk ? getOk() : true;
    if (leds.ok.userData.on !== ok) {
      leds.ok.userData.on = ok;
      leds.ok.emissiveIntensity = ok ? 3.2 : 0.03;
      leds.ok.color.set(ok ? '#3cff6a' : '#1d6a2c');
    }
    const ov = getOverload ? getOverload() : false;
    if (leds.ovl.userData.on !== ov) {
      leds.ovl.userData.on = ov;
      leds.ovl.emissiveIntensity = ov ? 3.2 : 0.03;
      leds.ovl.color.set(ov ? '#ff4a4a' : '#6a1d1d');
    }
  });
  const frontH = H - 2 * PSU.recess;
  const lblTex = labelTexture(catalog, rating, W);
  const labelH = frontH - 0.004;
  const lblW = W - 0.006;
  const at = (fx: number, fy: number): [number, number] => [-lblW / 2 + lblW * fx, labelH / 2 - labelH * fy];
  const outLabels = W >= 0.05 ? ['+', '+', '−', '−', '13', '14'] : ['+', '+', '−', '−'];
  const inLabels = ['N', 'L', 'PE'];
  const staticGeo = partsGeo(`1606:${W}`, (b) => {
    const alu = { color: '#c9cdd1', rough: 0.48, metal: 0.62 };
    b.add(roundedBox(W, H, bodyD, 0.0025, 2), alu, [0, 0, bodyD / 2]);
    // side grooves (extruded profile look)
    for (const sx of [-1, 1]) for (const f of [0.3, 0.5, 0.7]) b.add(boxGeo(0.0004, H - 0.01, 0.0016), F.metal('#9ea3a8', 0.5), [sx * (W / 2 + 0.0001), 0, bodyD * f]);
    // vents top & bottom
    ventGeoAdd(b, W, H / 2 + 0.0001);
    ventGeoAdd(b, W, -H / 2 - 0.0001);
    // raised front panel
    b.add(roundedBox(W - 0.002, frontH, PSU.frontDepth + 0.004, 0.002, 2), F.matte('#4a4e53', 0.5), [0, 0, bodyD + PSU.frontDepth / 2 - 0.002]);
    // 24-28 V adjustment pot
    const [px, py] = at(LBL.pot, LBL.ledRow);
    b.add(cylZ(0.0026, 0.0026, 0.002, 20), F.matte('#2b2d30', 0.5), [px, py, D + 0.001]);
    b.add(boxGeo(0.0036, 0.0006, 0.0006), F.hole, [px, py, D + 0.0021], [0, 0, 0.6]);
    // LED bezels
    for (const f of [LBL.ok, LBL.ovl]) {
      const [lx, ly] = at(f, LBL.ledRow);
      b.add(cylZ(0.0024, 0.0024, 0.0008, 16), F.matte('#2a2c2e', 0.5), [lx, ly, D + 0.0004]);
    }
    // terminals: output on top, input at the bottom
    addTerminalRow(b, outLabels.length, H / 2 - PSU.recess / 2 + 0.002, bodyD, true, W);
    addTerminalRow(b, inLabels.length, -H / 2 + PSU.recess / 2 - 0.002, bodyD, false, W);
  });
  const [okx, oky] = at(LBL.ok, LBL.ledRow);
  const [ovx, ovy] = at(LBL.ovl, LBL.ledRow);
  const outPitch = Math.min(0.0102, (W - 0.004) / outLabels.length);
  const inPitch = Math.min(0.0102, (W - 0.004) / inLabels.length);
  const tlMat = (labels: string[]) => sharedMat(`1606-tl:${labels.join('|')}`, () => {
    const m = mats.label(terminalLabelTexture(labels), true).clone();
    return m;
  });
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={staticGeo} material={uberMat()} castShadow receiveShadow />
      <mesh geometry={planeGeo(lblW, labelH)} material={mats.label(lblTex, false, 0.55)} position={[0, 0, D + 0.0001]} />
      <mesh geometry={cylZ(0.0017, 0.0017, 0.0012, 16)} material={leds.ok} position={[okx, oky, D + 0.0008]} />
      <mesh geometry={cylZ(0.0017, 0.0017, 0.0012, 16)} material={leds.ovl} position={[ovx, ovy, D + 0.0008]} />
      {/* terminal markings printed on the terminal bodies, toward the label */}
      <mesh geometry={planeGeo(outLabels.length * outPitch, 0.0042)} material={tlMat(outLabels)} position={[0, H / 2 - PSU.recess / 2 + 0.002 - 0.0078, bodyD + 0.0142]} />
      <mesh geometry={planeGeo(inLabels.length * inPitch, 0.0042)} material={tlMat(inLabels)} position={[0, -H / 2 + PSU.recess / 2 - 0.002 + 0.0078, bodyD + 0.0142]} />
    </group>
  );
}
