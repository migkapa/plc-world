/**
 * Wall-mount sheet-steel control cabinet (RAL 7035 powder coat, AE-style): rounded body edges,
 * front return flange, hinged door (left hinges) with folded edges, inner lips and black foamed-in
 * gasket, quarter-turn latches or a swing handle, engraved nameplate, hazard label, document
 * pocket, mounting backplate (galvanized with spangle, orange or white) on standoffs, wall-mount
 * lugs and bottom cable glands.
 *
 * Origin: center of the BACK face at the bottom edge. Size = outer [width, height, depth].
 *  - `children` are placed in BACKPLATE coords: origin = backplate center on its front surface, +Z out.
 *  - `doorChildren` are placed in DOOR coords: origin = door center on its front surface, +Z out
 *    (the door's inner sheet is at z ≈ −0.003; rear assemblies of 22.5 mm devices poke inside).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EnclosureProps } from '../../contracts';
import { LEGEND_FONT, boxGeo, canvasTexture, cylZ, latheZ, mats, planeGeo, roundedBox, sharedGeo, sharedMat, useHover } from '../operator/shared';

export interface EnclosureExtProps extends EnclosureProps {
  backplate?: 'galvanized' | 'orange' | 'white';
  /** Door closure hardware ('auto' = swing handle for tall doors, quarter-turn latches otherwise). */
  latch?: 'quarter-turn' | 'handle' | 'auto';
  /** Click on the handle/latches (or door) toggles the door. */
  onDoorToggle?: () => void;
  /** Smoothly animate doorAngle changes (default true). */
  animateDoor?: boolean;
  /** Yellow "DANGER hazardous voltage" label on the door (default true). */
  warningLabel?: boolean;
  /** Document pocket on the inside of the door (default true when the door is large enough). */
  docPocket?: boolean;
  /** Cable glands on the bottom (count, default 3). */
  glands?: number;
}

const T = 0.0015; // sheet thickness
const R = 0.005; // body edge radius
const DOOR_D = 0.021; // door depth (front sheet to gasket)
const FLANGE = 0.02; // body front return flange width
const PLATE_T = 0.003;
const STANDOFF = 0.012;

export const ENCLOSURE_RAL7035 = '#d4d6d1';

/** Backplate inset from the inner walls (m). */
export function backplateSize(size: [number, number, number]): [number, number] {
  return [size[0] - 0.06, size[1] - 0.06];
}

function spangleTexture() {
  return canvasTexture('galv-spangle', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#b7bcc0';
    ctx.fillRect(0, 0, w, h);
    let s = 987654321;
    const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    for (let i = 0; i < 520; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = 8 + rnd() * 26;
      const g = 160 + Math.floor(rnd() * 60);
      ctx.fillStyle = `rgba(${g},${g + 4},${g + 8},0.45)`;
      ctx.beginPath();
      const k = 5 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2 + rnd() * 0.6;
        const rr = r * (0.6 + rnd() * 0.5);
        if (j === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  });
}

function backplateMat(kind: 'galvanized' | 'orange' | 'white') {
  if (kind === 'orange') return mats.matte('#e2702b', 0.5);
  if (kind === 'white') return mats.matte('#eeeeea', 0.5);
  return sharedMat('galv-plate', () => {
    const t = spangleTexture().clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, color: '#f4f6f8', metalness: 0.45, roughness: 0.5, shadowSide: THREE.BackSide });
  });
}

function nameplateTexture(text: string) {
  return canvasTexture(`encl-nameplate:${text}`, 768, 128, (ctx, w, h) => {
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5a5a5a';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#f4f4f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const px = lines.length > 1 ? 44 : 64;
    ctx.font = `700 ${px}px ${LEGEND_FONT}`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * px * 1.15));
  });
}

function warningTexture() {
  return canvasTexture('encl-warning', 512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f7c600';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    // triangle with lightning bolt
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(110, 30);
    ctx.lineTo(200, 200);
    ctx.lineTo(20, 200);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f7c600';
    ctx.beginPath();
    ctx.moveTo(110, 62);
    ctx.lineTo(178, 188);
    ctx.lineTo(42, 188);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(118, 80);
    ctx.lineTo(92, 136);
    ctx.lineTo(112, 136);
    ctx.lineTo(100, 180);
    ctx.lineTo(134, 118);
    ctx.lineTo(114, 118);
    ctx.lineTo(126, 80);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `800 52px ${LEGEND_FONT}`;
    ctx.fillText('DANGER', 222, 78);
    ctx.font = `700 26px ${LEGEND_FONT}`;
    ctx.fillText('HAZARDOUS VOLTAGE', 222, 132);
    ctx.fillText('Lock out power', 222, 170);
    ctx.fillText('before servicing', 222, 202);
  });
}

function filletGeo(len: number) {
  return sharedGeo(`encl-fillet:${len.toFixed(4)}`, () => {
    const g = new THREE.CylinderGeometry(R, R, len, 8, 1, true, 0, Math.PI / 2);
    g.rotateX(Math.PI / 2); // axis -> Z
    return g;
  });
}

function glandGeo() {
  return latheZ(
    'encl-gland-dome',
    [
      [0.006, 0],
      [0.0142, 0],
      [0.0142, 0.004],
      [0.0132, 0.006],
      [0.0124, 0.011],
      [0.0098, 0.0145],
      [0.0072, 0.0155],
      [0.006, 0.0155],
      [0.006, 0.005],
    ],
    32,
  );
}

function QuarterTurn({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh geometry={cylZ(0.0095, 0.0098, 0.004, 32)} material={mats.matte('#1a1a1a', 0.45)} position={[0, 0, 0.002]} castShadow />
      <mesh geometry={boxGeo(0.0028, 0.012, 0.0014)} material={mats.dark()} position={[0, 0, 0.0036]} />
    </group>
  );
}

function SwingHandle({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh geometry={roundedBox(0.034, 0.14, 0.007, 0.004, 2)} material={mats.matte('#1c1c1c', 0.45)} position={[0, 0, 0.0035]} castShadow />
      <mesh geometry={roundedBox(0.022, 0.11, 0.012, 0.006, 3)} material={mats.gloss('#202020')} position={[0, -0.008, 0.012]} castShadow />
      <mesh geometry={cylZ(0.0065, 0.0065, 0.004, 24)} material={mats.chrome()} position={[0, 0.052, 0.009]} />
      <mesh geometry={boxGeo(0.0012, 0.006, 0.001)} material={mats.dark()} position={[0, 0.052, 0.0112]} />
    </group>
  );
}

export function Enclosure({
  size,
  doorAngle = 0,
  color = ENCLOSURE_RAL7035,
  children,
  doorChildren,
  nameplate,
  backplate = 'galvanized',
  latch = 'auto',
  onDoorToggle,
  animateDoor = true,
  warningLabel = true,
  docPocket,
  glands = 3,
  position,
  rotation,
  scale,
}: EnclosureExtProps) {
  const [W, H, D] = size;
  const Db = D - DOOR_D;
  const paint = mats.matte(color, 0.5);
  const paintDS = sharedMat(`encl-paint-ds:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }));
  const door = useRef<THREE.Group>(null);
  const initialAngle = useRef(doorAngle);
  const { bind } = useHover(!!onDoorToggle);
  useFrame((_, dt) => {
    const d = door.current;
    if (!d) return;
    const target = -doorAngle;
    d.rotation.y = animateDoor ? THREE.MathUtils.damp(d.rotation.y, target, 6, Math.min(dt, 0.05)) : target;
  });
  const [pw, ph] = backplateSize(size);
  const useHandle = latch === 'handle' || (latch === 'auto' && H >= 0.7);
  const pocket = docPocket ?? (W >= 0.4 && H >= 0.5);
  const npW = Math.min(0.3, W * 0.45);
  const npH = npW * (128 / 768) * (nameplate && nameplate.includes('\n') ? 1.4 : 1.1);
  const onToggle = onDoorToggle
    ? (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        onDoorToggle();
      }
    : undefined;
  const glandXs = useMemo(() => Array.from({ length: glands }, (_, i) => (i - (glands - 1) / 2) * Math.min(0.06, (W - 0.1) / Math.max(1, glands))), [glands, W]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* ---------------- body ---------------- */}
      <mesh geometry={boxGeo(W - 2 * R, H - 2 * R, T)} material={paint} position={[0, H / 2, T / 2]} receiveShadow />
      <mesh geometry={boxGeo(T, H - 2 * R, Db)} material={paint} position={[-W / 2 + T / 2, H / 2, Db / 2]} castShadow receiveShadow />
      <mesh geometry={boxGeo(T, H - 2 * R, Db)} material={paint} position={[W / 2 - T / 2, H / 2, Db / 2]} castShadow receiveShadow />
      <mesh geometry={boxGeo(W - 2 * R, T, Db)} material={paint} position={[0, H - T / 2, Db / 2]} castShadow receiveShadow />
      <mesh geometry={boxGeo(W - 2 * R, T, Db)} material={paint} position={[0, T / 2, Db / 2]} castShadow receiveShadow />
      {/* back panel edges (so the back corners look closed) */}
      <mesh geometry={boxGeo(W, H, T)} material={paint} position={[0, H / 2, T / 2]} />
      {/* rounded long edges */}
      {[
        [W / 2 - R, H - R, Math.PI / 2],
        [-W / 2 + R, H - R, Math.PI],
        [-W / 2 + R, R, -Math.PI / 2],
        [W / 2 - R, R, 0],
      ].map(([x, y, rz], i) => (
        <mesh key={i} geometry={filletGeo(Db)} material={paintDS} position={[x!, y!, Db / 2]} rotation={[0, 0, rz!]} castShadow />
      ))}
      {/* front return flange */}
      <mesh geometry={boxGeo(W - 2 * R, FLANGE, T)} material={paint} position={[0, H - T - FLANGE / 2, Db - T / 2]} />
      <mesh geometry={boxGeo(W - 2 * R, FLANGE, T)} material={paint} position={[0, T + FLANGE / 2, Db - T / 2]} />
      <mesh geometry={boxGeo(FLANGE, H - 2 * T - 2 * FLANGE, T)} material={paint} position={[-W / 2 + T + FLANGE / 2, H / 2, Db - T / 2]} />
      <mesh geometry={boxGeo(FLANGE, H - 2 * T - 2 * FLANGE, T)} material={paint} position={[W / 2 - T - FLANGE / 2, H / 2, Db - T / 2]} />
      {/* raised sealing edge on the flange */}
      <mesh geometry={boxGeo(W - 2 * T - 0.012, 0.0015, 0.004)} material={paint} position={[0, H - T - 0.006, Db + 0.002]} />
      <mesh geometry={boxGeo(W - 2 * T - 0.012, 0.0015, 0.004)} material={paint} position={[0, T + 0.006, Db + 0.002]} />
      <mesh geometry={boxGeo(0.0015, H - 2 * T - 0.012, 0.004)} material={paint} position={[-W / 2 + T + 0.006, H / 2, Db + 0.002]} />
      <mesh geometry={boxGeo(0.0015, H - 2 * T - 0.012, 0.004)} material={paint} position={[W / 2 - T - 0.006, H / 2, Db + 0.002]} />
      {/* wall-mount lugs */}
      {[
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ].map(([sx, sy], i) => (
        <group key={i} position={[sx! * (W / 2 - 0.03), sy! > 0 ? H + 0.012 : -0.012, 0.004]}>
          <mesh geometry={roundedBox(0.03, 0.028, 0.003, 0.004, 2)} material={mats.metal('#c9ccce', 0.4)} castShadow />
          <mesh geometry={cylZ(0.0035, 0.0035, 0.0034, 16)} material={mats.dark()} position={[0, sy! * 0.004, 0]} />
        </group>
      ))}
      {/* hinges */}
      {[0.12, 0.88].map((f) => (
        <group key={f} position={[-W / 2 - 0.004, H * f, Db + 0.004]}>
          <mesh geometry={sharedGeo('encl-hinge', () => new THREE.CylinderGeometry(0.0055, 0.0055, 0.05, 16))} material={mats.matte('#2a2a2a', 0.45)} castShadow />
          <mesh geometry={sharedGeo('encl-hinge-cap', () => new THREE.SphereGeometry(0.0055, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2))} material={mats.matte('#2a2a2a', 0.45)} position={[0, 0.025, 0]} />
        </group>
      ))}
      {/* bottom cable glands */}
      {glandXs.map((x) => (
        <group key={x} position={[x, 0, Db * 0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh geometry={sharedGeo('encl-gland-hex', () => new THREE.CylinderGeometry(0.0165, 0.0165, 0.006, 6).rotateX(Math.PI / 2))} material={mats.matte('#8d9093', 0.5)} position={[0, 0, 0.003]} />
          <mesh geometry={glandGeo()} material={mats.matte('#8d9093', 0.5)} position={[0, 0, 0.006]} castShadow />
          <mesh geometry={cylZ(0.0058, 0.0058, 0.08, 16)} material={mats.matte('#3b3d3f', 0.7)} position={[0, 0, 0.056]} />
        </group>
      ))}

      {/* ---------------- backplate ---------------- */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sy], i) => (
        <group key={i} position={[sx! * (pw / 2 - 0.012), H / 2 + sy! * (ph / 2 - 0.012), 0]}>
          <mesh geometry={cylZ(0.004, 0.004, STANDOFF, 12)} material={mats.metal('#b9bdc0', 0.4)} position={[0, 0, STANDOFF / 2 + T]} />
          <mesh geometry={cylZ(0.0065, 0.0065, 0.004, 6)} material={mats.metal('#c9cdd0', 0.35)} position={[0, 0, STANDOFF + T + PLATE_T + 0.002]} />
        </group>
      ))}
      <mesh geometry={boxGeo(pw, ph, PLATE_T)} material={backplateMat(backplate)} position={[0, H / 2, STANDOFF + T + PLATE_T / 2]} receiveShadow castShadow />
      <group position={[0, H / 2, STANDOFF + T + PLATE_T]}>{children}</group>

      {/* ---------------- door ---------------- */}
      <group position={[-W / 2 - 0.004, 0, Db]}>
        <group ref={door} rotation={[0, animateDoor ? -initialAngle.current : -doorAngle, 0]}>
          <group position={[W / 2 + 0.004, H / 2, DOOR_D]}>
            <group onPointerDown={onToggle} {...(onDoorToggle ? bind : {})}>
            {/* front sheet with rounded edge */}
            <mesh geometry={roundedBox(W, H, 0.006, 0.003, 3)} material={paint} position={[0, 0, -0.003]} castShadow receiveShadow />
            {/* folded edges */}
            <mesh geometry={boxGeo(W - 0.004, T, DOOR_D - 0.009)} material={paint} position={[0, H / 2 - T / 2, -0.0045 - (DOOR_D - 0.009) / 2]} />
            <mesh geometry={boxGeo(W - 0.004, T, DOOR_D - 0.009)} material={paint} position={[0, -H / 2 + T / 2, -0.0045 - (DOOR_D - 0.009) / 2]} />
            <mesh geometry={boxGeo(T, H - 0.004, DOOR_D - 0.009)} material={paint} position={[-W / 2 + T / 2, 0, -0.0045 - (DOOR_D - 0.009) / 2]} />
            <mesh geometry={boxGeo(T, H - 0.004, DOOR_D - 0.009)} material={paint} position={[W / 2 - T / 2, 0, -0.0045 - (DOOR_D - 0.009) / 2]} />
            {/* inner lips */}
            <mesh geometry={boxGeo(W - 0.004, 0.012, T)} material={paint} position={[0, H / 2 - 0.006, -DOOR_D + 0.0045]} />
            <mesh geometry={boxGeo(W - 0.004, 0.012, T)} material={paint} position={[0, -H / 2 + 0.006, -DOOR_D + 0.0045]} />
            <mesh geometry={boxGeo(0.012, H - 0.028, T)} material={paint} position={[-W / 2 + 0.006, 0, -DOOR_D + 0.0045]} />
            <mesh geometry={boxGeo(0.012, H - 0.028, T)} material={paint} position={[W / 2 - 0.006, 0, -DOOR_D + 0.0045]} />
            {/* foamed-in gasket */}
            <mesh geometry={boxGeo(W - 0.02, 0.008, 0.004)} material={mats.rubber()} position={[0, H / 2 - 0.009, -DOOR_D + 0.002]} />
            <mesh geometry={boxGeo(W - 0.02, 0.008, 0.004)} material={mats.rubber()} position={[0, -H / 2 + 0.009, -DOOR_D + 0.002]} />
            <mesh geometry={boxGeo(0.008, H - 0.026, 0.004)} material={mats.rubber()} position={[-W / 2 + 0.009, 0, -DOOR_D + 0.002]} />
            <mesh geometry={boxGeo(0.008, H - 0.026, 0.004)} material={mats.rubber()} position={[W / 2 - 0.009, 0, -DOOR_D + 0.002]} />
            {/* latches / handle */}
            {useHandle ? (
              <SwingHandle position={[W / 2 - 0.035, 0, 0]} />
            ) : (
              <>
                <QuarterTurn position={[W / 2 - 0.028, H * 0.3, 0]} />
                <QuarterTurn position={[W / 2 - 0.028, -H * 0.3, 0]} />
              </>
            )}
            {/* nameplate */}
            {nameplate && (
              <group position={[0, H / 2 - 0.02 - npH / 2, 0.0003]}>
                <mesh geometry={roundedBox(npW, npH, 0.0016, 0.0015, 2)} material={mats.gloss('#151515')} position={[0, 0, 0.0008]} />
                <mesh geometry={planeGeo(npW - 0.003, npH - 0.003)} material={mats.label(nameplateTexture(nameplate), false, 0.35)} position={[0, 0, 0.0017]} />
                {[-1, 1].map((s) => (
                  <mesh key={s} geometry={cylZ(0.0018, 0.0018, 0.001, 12)} material={mats.chrome()} position={[s * (npW / 2 - 0.005), 0, 0.0019]} />
                ))}
              </group>
            )}
            {warningLabel && (
              <mesh
                geometry={planeGeo(Math.min(0.1, W * 0.22), Math.min(0.05, W * 0.11))}
                material={mats.label(warningTexture(), false, 0.5)}
                position={[W / 2 - 0.04 - Math.min(0.1, W * 0.22) / 2, H / 2 - 0.02 - npH - 0.02 - Math.min(0.05, W * 0.11) / 2, 0.0003]}
              />
            )}
            {/* document pocket on the inside */}
            {pocket && (
              <group position={[0, -H * 0.18, -0.0065]}>
                <mesh geometry={roundedBox(Math.min(0.26, W * 0.45), Math.min(0.3, H * 0.32), 0.007, 0.003, 2)} material={mats.matte('#8e9295', 0.6)} castShadow />
                <mesh
                  geometry={boxGeo(Math.min(0.26, W * 0.45) * 0.86, 0.03, 0.003)}
                  material={mats.matte('#f3f1ea', 0.8)}
                  position={[0, Math.min(0.3, H * 0.32) / 2, 0.001]}
                />
              </group>
            )}
            </group>
            {/* door-mounted devices (their own pointer handlers; clicks don't toggle the door) */}
            <group>{doorChildren}</group>
          </group>
        </group>
      </group>

    </group>
  );
}
