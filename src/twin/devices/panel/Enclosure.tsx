/**
 * Wall-mount sheet-steel control cabinet (RAL 7035 powder coat, AE-style): rounded body edges,
 * front return flange, hinged door (left hinges) with folded edges, inner lips and black foamed-in
 * gasket, quarter-turn latches or a swing handle, engraved nameplate, hazard label, document
 * pocket, mounting backplate (white powder-coat like a standard Hoffman subpanel by default, or plain
 * matte galvanized / orange) on standoffs, wall-mount lugs and bottom cable glands.
 *
 * Origin: center of the BACK face at the bottom edge. Size = outer [width, height, depth].
 *  - `children` are placed in BACKPLATE coords: origin = backplate center on its front surface, +Z out.
 *  - `doorChildren` are placed in DOOR coords: origin = door center on its front surface, +Z out.
 *    The door front sheet is DOOR_SHEET = 2 mm thick (inner face at z = −0.002), which is the
 *    default `panelThickness` of the 22.5 mm devices, so their rear assemblies start at the inner face.
 *  - Performance: body + backplate = one merged mesh, door = one merged mesh + 2 printed labels.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EnclosureProps } from '../../contracts';
import { CLICK_SLOP_PX, F, LEGEND_FONT, boxGeo, canvasTexture, cylZ, latheZ, mats, partsGeo, planeGeo, roundedBox, roundedRectShape, sharedGeo, uberMat, useHover, type Finish, type Parts } from '../operator/shared';

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
/** Door front sheet thickness (m) — use as `panelThickness` for door-mounted 22.5 mm devices. */
export const DOOR_SHEET = 0.002;

export const ENCLOSURE_RAL7035 = '#d4d6d1';

/** Backplate inset from the inner walls (m). */
export function backplateSize(size: [number, number, number]): [number, number] {
  return [size[0] - 0.06, size[1] - 0.06];
}

/** Backplate finishes: plain surfaces (no spangle pattern) so mounted devices read clearly. */
export function backplateFinish(kind: 'galvanized' | 'orange' | 'white'): Finish {
  if (kind === 'orange') return { color: '#e2702b', rough: 0.5, metal: 0.05 };
  if (kind === 'white') return { color: '#efefeb', rough: 0.55, metal: 0.03 };
  // sendzimir galvanized: uniform matte silver-gray
  return { color: '#b8bdc1', rough: 0.45, metal: 0.5 };
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

/** Extruded rounded-rectangle ring (outer w×h radius r, wall t) from z = 0 to `depth`. */
function ringPrism(key: string, w: number, h: number, r: number, t: number, depth: number) {
  return sharedGeo(`encl-ring:${key}:${w}:${h}:${r}:${t}:${depth}`, () => {
    const s = roundedRectShape(w, h, r);
    s.holes.push(roundedRectShape(w - 2 * t, h - 2 * t, Math.max(0.0005, r - t)));
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
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

function addQuarterTurn(b: Parts, p: [number, number, number]) {
  b.at(p, undefined, (q) => {
    q.add(cylZ(0.0095, 0.0098, 0.004, 32), F.matte('#1a1a1a', 0.45), [0, 0, 0.002]);
    q.add(boxGeo(0.0028, 0.012, 0.0014), F.hole, [0, 0, 0.0036]);
  });
}

function addSwingHandle(b: Parts, p: [number, number, number]) {
  b.at(p, undefined, (h) => {
    h.add(roundedBox(0.034, 0.14, 0.007, 0.004, 2), F.matte('#1c1c1c', 0.45), [0, 0, 0.0035]);
    h.add(roundedBox(0.022, 0.11, 0.012, 0.006, 3), F.gloss('#202020'), [0, -0.008, 0.012]);
    h.add(cylZ(0.0065, 0.0065, 0.004, 24), F.chrome, [0, 0.052, 0.009]);
    h.add(boxGeo(0.0012, 0.006, 0.001), F.hole, [0, 0.052, 0.0112]);
  });
}

export function Enclosure({
  size,
  doorAngle = 0,
  color = ENCLOSURE_RAL7035,
  children,
  doorChildren,
  nameplate,
  backplate = 'white',
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
  // door toggles on a CLICK (primary button, < CLICK_SLOP_PX travel) so camera drags never slam it
  const onDoorClick = onDoorToggle
    ? (e: ThreeEvent<MouseEvent>) => {
        if (e.button !== 0 || e.delta > CLICK_SLOP_PX) return;
        e.stopPropagation();
        onDoorToggle();
      }
    : undefined;
  const glandXs = useMemo(() => Array.from({ length: glands }, (_, i) => (i - (glands - 1) / 2) * Math.min(0.06, (W - 0.1) / Math.max(1, glands))), [glands, W]);
  const paintF = F.matte(color, 0.5);

  // ---------------- body + backplate: one merged mesh ----------------
  const bodyGeo = partsGeo(`encl-body:${W}:${H}:${D}:${color}:${backplate}:${glandXs.join(',')}`, (b) => {
    // back panel + side walls with rounded long edges
    b.add(sharedGeo(`encl-back:${W}:${H}`, () => new THREE.ExtrudeGeometry(roundedRectShape(W, H, R), { depth: T, bevelEnabled: false, curveSegments: 6 })), paintF, [0, H / 2, 0]);
    b.add(ringPrism('shell', W, H, R, T, Db), paintF, [0, H / 2, 0]);
    // front return flange
    b.add(ringPrism('flange', W - 2 * T, H - 2 * T, 0.001, FLANGE, T), paintF, [0, H / 2, Db - T]);
    // raised sealing edge on the flange
    b.add(ringPrism('seal', W - 2 * T - 0.012, H - 2 * T - 0.012, 0.001, 0.0015, 0.004), paintF, [0, H / 2, Db]);
    // wall-mount lugs
    for (const [sx, sy] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ] as [number, number][]) {
      b.at([sx * (W / 2 - 0.03), sy > 0 ? H + 0.012 : -0.012, 0.004], undefined, (l) => {
        l.add(roundedBox(0.03, 0.028, 0.003, 0.004, 2), F.metal('#c9ccce', 0.4));
        l.add(cylZ(0.0035, 0.0035, 0.0034, 16), F.hole, [0, sy * 0.004, 0]);
      });
    }
    // hinges
    for (const f of [0.12, 0.88]) {
      b.at([-W / 2 - 0.004, H * f, Db + 0.004], undefined, (h) => {
        h.add(sharedGeo('encl-hinge', () => new THREE.CylinderGeometry(0.0055, 0.0055, 0.05, 16)), F.matte('#2a2a2a', 0.45));
        h.add(sharedGeo('encl-hinge-cap', () => new THREE.SphereGeometry(0.0055, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), F.matte('#2a2a2a', 0.45), [0, 0.025, 0]);
      });
    }
    // bottom cable glands with cable stubs
    for (const x of glandXs) {
      b.at([x, 0, Db * 0.5], [Math.PI / 2, 0, 0], (g) => {
        g.add(sharedGeo('encl-gland-hex', () => new THREE.CylinderGeometry(0.0165, 0.0165, 0.006, 6).rotateX(Math.PI / 2)), F.matte('#8d9093', 0.5), [0, 0, 0.003]);
        g.add(glandGeo(), F.matte('#8d9093', 0.5), [0, 0, 0.006]);
        g.add(cylZ(0.0058, 0.0058, 0.08, 16), F.matte('#3b3d3f', 0.7), [0, 0, 0.056]);
      });
    }
    // backplate on standoffs
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as [number, number][]) {
      b.at([sx * (pw / 2 - 0.012), H / 2 + sy * (ph / 2 - 0.012), 0], undefined, (so) => {
        so.add(cylZ(0.004, 0.004, STANDOFF, 12), F.metal('#b9bdc0', 0.4), [0, 0, STANDOFF / 2 + T]);
        so.add(cylZ(0.0065, 0.0065, 0.004, 6), F.metal('#c9cdd0', 0.35), [0, 0, STANDOFF + T + PLATE_T + 0.002]);
      });
    }
    b.add(boxGeo(pw, ph, PLATE_T), backplateFinish(backplate), [0, H / 2, STANDOFF + T + PLATE_T / 2]);
  });

  // ---------------- door: one merged mesh ----------------
  const doorGeo = partsGeo(`encl-door:${W}:${H}:${color}:${useHandle}:${pocket}:${nameplate ? `${npW}:${npH}` : '-'}`, (b) => {
    const foldD = DOOR_D - 0.006;
    const foldZ = -DOOR_SHEET - foldD / 2;
    // 2 mm front sheet with rounded edge
    b.add(roundedBox(W, H, DOOR_SHEET, 0.001, 2), paintF, [0, 0, -DOOR_SHEET / 2]);
    // folded edges (carry the door depth) + inner lips
    b.add(ringPrism('door-fold', W, H, 0.001, T, foldD), paintF, [0, 0, foldZ - foldD / 2]);
    b.add(ringPrism('door-lip', W - 2 * T, H - 2 * T, 0.001, 0.012, T), paintF, [0, 0, -DOOR_D + 0.004]);
    // foamed-in gasket
    b.add(ringPrism('door-gasket', W - 0.012, H - 0.012, 0.004, 0.008, 0.004), F.rubber, [0, 0, -DOOR_D]);
    // latches / handle
    if (useHandle) addSwingHandle(b, [W / 2 - 0.035, 0, 0]);
    else {
      addQuarterTurn(b, [W / 2 - 0.028, H * 0.3, 0]);
      addQuarterTurn(b, [W / 2 - 0.028, -H * 0.3, 0]);
    }
    // nameplate body + chrome rivets
    if (nameplate)
      b.at([0, H / 2 - 0.02 - npH / 2, 0.0003], undefined, (n) => {
        n.add(roundedBox(npW, npH, 0.0016, 0.0015, 2), F.gloss('#151515'), [0, 0, 0.0008]);
        for (const sx of [-1, 1]) n.add(cylZ(0.0018, 0.0018, 0.001, 12), F.chrome, [sx * (npW / 2 - 0.005), 0, 0.0019]);
      });
    // document pocket on the inside
    if (pocket)
      b.at([0, -H * 0.18, -DOOR_SHEET - 0.0035], undefined, (p) => {
        const pw2 = Math.min(0.26, W * 0.45);
        const ph2 = Math.min(0.3, H * 0.32);
        p.add(roundedBox(pw2, ph2, 0.007, 0.003, 2), F.matte('#8e9295', 0.6), [0, 0, -0.0035], [0, Math.PI, 0]);
        p.add(boxGeo(pw2 * 0.86, 0.03, 0.003), F.matte('#f3f1ea', 0.8), [0, ph2 / 2, -0.004]);
      });
  });
  const warnW = Math.min(0.1, W * 0.22);
  const warnH = Math.min(0.05, W * 0.11);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={bodyGeo} material={uberMat()} castShadow receiveShadow />
      <group position={[0, H / 2, STANDOFF + T + PLATE_T]}>{children}</group>

      {/* ---------------- door (hinges on the left) ---------------- */}
      <group position={[-W / 2 - 0.004, 0, Db]}>
        <group ref={door} rotation={[0, animateDoor ? -initialAngle.current : -doorAngle, 0]}>
          <group position={[W / 2 + 0.004, H / 2, DOOR_D]}>
            <group onClick={onDoorClick} {...(onDoorToggle ? bind : {})}>
              <mesh geometry={doorGeo} material={uberMat()} castShadow receiveShadow />
              {nameplate && (
                <mesh
                  geometry={planeGeo(npW - 0.003, npH - 0.003)}
                  material={mats.label(nameplateTexture(nameplate), false, 0.35)}
                  position={[0, H / 2 - 0.02 - npH / 2, 0.002]}
                />
              )}
              {warningLabel && (
                <mesh
                  geometry={planeGeo(warnW, warnH)}
                  material={mats.label(warningTexture(), false, 0.5)}
                  position={[W / 2 - 0.04 - warnW / 2, H / 2 - 0.02 - npH - 0.02 - warnH / 2, 0.0003]}
                />
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
