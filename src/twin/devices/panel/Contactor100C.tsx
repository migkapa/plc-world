/**
 * Bulletin 100-C09 IEC contactor (45 × 81 × 85 mm): stepped gray housing, box-clamp terminals with
 * captive screws top (A1, 1/L1, 3/L2, 5/L3, A2) and bottom (13, 2/T1, 4/T2, 6/T3, 14), printed
 * terminal markings, front nameplate and a visible ARMATURE / contact-carrier indicator that pulls
 * in (moves ≈ 3.5 mm toward the backplate and turns from "O" to "I") when the coil is energized,
 * with a small "clack" shake at pull-in.
 *
 * Origin: DIN clip plane on the rail centerline at the center of the contactor.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { ContactorProps } from '../../contracts';
import { LEGEND_FONT, NARROW_FONT, Screw, boxGeo, canvasTexture, damp, mats, planeGeo, roundedRectPath, roundedRectShape, sharedGeo } from '../operator/shared';

export const C100 = { w: 0.045, h: 0.081, d: 0.085, shoulder: 0.058, body: 0.079 } as const;
export const CONTACTOR_GRAY = '#80848a';

function bodyGeo() {
  return sharedGeo('100c-body', () => {
    const H = C100.h / 2;
    const P: [number, number][] = [
      [-H, 0],
      [H, 0],
      [H, C100.shoulder - 0.002],
      [H - 0.002, C100.shoulder],
      [0.0285, C100.shoulder],
      [0.0265, C100.shoulder + 0.004],
      [0.0265, C100.body - 0.002],
      [0.0245, C100.body],
      [-0.0245, C100.body],
      [-0.0265, C100.body - 0.002],
      [-0.0265, C100.shoulder + 0.004],
      [-0.0285, C100.shoulder],
      [-H + 0.002, C100.shoulder],
      [-H, C100.shoulder - 0.002],
    ];
    const s = new THREE.Shape();
    P.forEach(([y, z], i) => (i === 0 ? s.moveTo(y, z) : s.lineTo(y, z)));
    s.closePath();
    const w = C100.w - 0.0008;
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelOffset: -0.0004, bevelSegments: 1 });
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -w / 2, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    g.computeVertexNormals();
    return g;
  });
}

const PAD_D = 0.006;
const WIN_Y = -0.0078;

function padGeo() {
  return sharedGeo('100c-pad', () => {
    const s = roundedRectShape(0.031, 0.031, 0.002);
    const hole = new THREE.Path();
    roundedRectPath(hole, -0.0056, WIN_Y - 0.0041, 0.0112, 0.0082, 0.0008);
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: PAD_D - 0.0006, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelOffset: -0.0006, bevelSegments: 2, curveSegments: 4 });
    return g;
  });
}

function markingsTexture() {
  return canvasTexture('100c-markings', 512, 560, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2ee';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cols = [0.07, 0.245, 0.5, 0.755, 0.93];
    const top = ['A1', '1/L1', '3/L2', '5/L3', 'A2'];
    const bot = ['13', '2/T1', '4/T2', '6/T3', '14'];
    ctx.font = `700 34px ${NARROW_FONT}`;
    cols.forEach((c, i) => {
      ctx.fillText(top[i]!, c * w, 26);
      ctx.fillText(bot[i]!, c * w, h - 26);
    });
    ctx.font = `600 22px ${NARROW_FONT}`;
    ctx.fillText('NO', 0.07 * w, h - 58);
    ctx.fillText('NO', 0.93 * w, h - 58);
  });
}

function nameplateTexture(catalog: string) {
  return canvasTexture(`100c-nameplate:${catalog}`, 320, 160, (ctx, w, h) => {
    ctx.fillStyle = '#e9e9e4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#161616';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 46px ${LEGEND_FONT}`;
    ctx.fillText(catalog, w / 2, 38);
    ctx.font = `600 24px ${NARROW_FONT}`;
    ctx.fillText('Ie 9A AC-3  ·  Ith 20A', w / 2, 86);
    ctx.fillText('Uc 120V 60Hz  ·  IEC/UL', w / 2, 122);
  });
}

function carrierTexture(on: boolean) {
  return canvasTexture(`100c-carrier:${on}`, 64, 48, (ctx, w, h) => {
    ctx.fillStyle = on ? '#2a2c2e' : '#ededea';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = on ? '#2cd46a' : '#1a1a1a';
    ctx.font = `800 36px ${LEGEND_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(on ? 'I' : 'O', w / 2, h / 2 + 2);
  });
}

export function Contactor100C({ getEnergized, catalog = '100-C09', position, rotation, scale }: ContactorProps) {
  const root = useRef<THREE.Group>(null);
  const carrier = useRef<THREE.Group>(null);
  const face = useRef<THREE.Mesh>(null);
  const st = useRef({ prev: false, shake: 0 });
  const faceOn = carrierMats.on();
  const faceOff = carrierMats.off();
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const on = getEnergized();
    const s = st.current;
    if (on !== s.prev) {
      s.prev = on;
      s.shake = 0.09;
    }
    const c = carrier.current;
    if (c) c.position.z = damp(c.position.z, on ? -0.0034 : 0, on ? 60 : 35, dt);
    const f = face.current;
    if (f) {
      const want = on ? faceOn : faceOff;
      if (f.material !== want) f.material = want;
    }
    const r = root.current;
    if (r) {
      if (s.shake > 0) {
        s.shake -= dt;
        r.position.set(Math.sin(s.shake * 900) * 0.00025, Math.cos(s.shake * 700) * 0.0002, 0);
      } else if (r.position.x !== 0) r.position.set(0, 0, 0);
    }
  });
  const housing = mats.matte(CONTACTOR_GRAY, 0.55);
  const dark = mats.dark();
  const powerX = [-0.012, 0, 0.012];
  const smallX = [-0.0195, 0.0195];
  const ty = C100.h / 2 - 0.0068;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <group ref={root}>
        <mesh geometry={bodyGeo()} material={housing} castShadow receiveShadow />
        {/* terminals: top & bottom rows */}
        {[-1, 1].map((sy) => (
          <group key={sy}>
            {powerX.map((x) => (
              <group key={x} position={[x, sy * ty, C100.shoulder]}>
                <mesh geometry={boxGeo(0.0078, 0.0078, 0.0002)} material={mats.matte('#3a3c3f', 0.7)} position={[0, 0, 0.0001]} />
                <Screw position={[0, 0, 0.0001]} r={0.0031} h={0.0014} />
                {/* box clamp wire opening on the end face */}
                <mesh geometry={boxGeo(0.0072, 0.0004, 0.0065)} material={dark} position={[0, sy * 0.0069, -0.012]} />
              </group>
            ))}
            {smallX.map((x) => (
              <group key={x} position={[x, sy * (ty + 0.0012), C100.shoulder]}>
                <mesh geometry={boxGeo(0.0056, 0.0056, 0.0002)} material={mats.matte('#3a3c3f', 0.7)} position={[0, 0, 0.0001]} />
                <Screw position={[0, 0, 0.0001]} r={0.0022} h={0.0011} />
                <mesh geometry={boxGeo(0.005, 0.0004, 0.005)} material={dark} position={[0, sy * 0.0057, -0.011]} />
              </group>
            ))}
          </group>
        ))}
        {/* terminal markings on the front body, printed white */}
        <mesh geometry={planeGeo(C100.w - 0.002, 0.049)} material={mats.label(markingsTexture(), true)} position={[0, 0, C100.body + 0.0003]} />
        {/* front raised pad (with a real window opening) carrying the nameplate */}
        <mesh geometry={padGeo()} material={mats.matte('#6e7277', 0.5)} position={[0, 0, C100.body]} castShadow />
        <mesh geometry={planeGeo(0.027, 0.0135)} material={mats.label(nameplateTexture(catalog), false, 0.6)} position={[0, 0.0062, C100.body + PAD_D + 0.0001]} />
        {/* cavity behind the window */}
        <mesh geometry={boxGeo(0.0112, 0.0082, 0.0004)} material={dark} position={[0, WIN_Y, C100.body + 0.0002]} />
        {/* armature / contact carrier: flush with the pad when open, pulled in when energized */}
        <group ref={carrier} position={[0, WIN_Y, 0]}>
          <mesh geometry={boxGeo(0.0096, 0.0068, 0.004)} material={mats.matte('#2c2e31', 0.6)} position={[0, 0, C100.body + PAD_D - 0.0026]} />
          <mesh ref={face} geometry={planeGeo(0.0094, 0.0066)} material={carrierMats.off()} position={[0, 0, C100.body + PAD_D - 0.0005]} />
        </group>
      </group>
    </group>
  );
}

const carrierMats = {
  on: () => mats.label(carrierTexture(true), false, 0.5),
  off: () => mats.label(carrierTexture(false), false, 0.5),
};
