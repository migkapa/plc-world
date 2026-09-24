/**
 * Accessible (ADA / APS-style) pedestrian push-button station: cast-aluminum housing (≈5" × 14" ×
 * 2.6"), speaker grille, 2" stainless push button with a raised tactile arrow, red call-confirmation
 * LED, and a 9" × 12" R10-3b "PUSH BUTTON FOR [walking person]" sign with the crossing arrow. Mounted
 * on a pedestal post (button center ≈ 1.0 m, ADA max 42") or directly on a signal pole.
 *
 * Origin: `mount="post"` → ground at the post center; `mount="none"` → back-bottom-center of the
 * station housing (screw it to a pole surface). Faces +Z. Clicking anywhere on the station presses
 * the button (momentary).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { drawPedSymbol } from './ledTextures';
import {
  INCH,
  TRAFFIC_COLORS,
  boxGeo,
  canvasTex,
  circleGeo,
  cylY,
  cylZ,
  damp,
  hitMat,
  latheZ,
  makeCanvas,
  mergeAll,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedTex,
  tmats,
  usePress,
  xf,
  useDisposable,
} from './shared';

export interface PedestrianPushButtonProps extends Placement {
  getPressed: () => boolean;
  onPress?: () => void;
  onRelease?: () => void;
  /** Call-accepted LED (default: lit while pressed). */
  getLit?: () => boolean;
  /** Crossing direction shown by the sign arrow and the tactile arrow. */
  arrow?: 'left' | 'right';
  mount?: 'post' | 'none';
  /** Housing color (default black powder coat). */
  color?: string;
  /** Show the R10-3b sign (default true). */
  sign?: boolean;
}

export const PUSH_BUTTON_DIMS = {
  bodyW: 5.1 * INCH,
  bodyH: 14 * INCH,
  bodyD: 2.6 * INCH,
  buttonR: 1 * INCH,
  /** Height of the station bottom on a post. */
  postStationY: 0.84,
  postHeight: 1.62,
  signW: 9 * INCH,
  signH: 12 * INCH,
} as const;
const B = PUSH_BUTTON_DIMS;

/** Button center relative to the station's back-bottom origin. */
const BTN_Y = 0.105;
const SPK_Y = 0.25;

function stationBodyGeometry(): THREE.BufferGeometry {
  return sharedGeo('pb:body', () => {
    const w = B.bodyW;
    const h = B.bodyH;
    const s = new THREE.Shape();
    const r = 0.018;
    s.moveTo(-w / 2 + r, 0);
    s.lineTo(w / 2 - r, 0);
    s.quadraticCurveTo(w / 2, 0, w / 2, r);
    s.lineTo(w / 2, h - w / 2);
    s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); // arched top
    s.lineTo(-w / 2, r);
    s.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0);
    const bevel = 0.008;
    const g = new THREE.ExtrudeGeometry(s, { depth: B.bodyD - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 24 });
    g.translate(0, 0, bevel);
    return g;
  });
}

function arrowShape(): THREE.Shape {
  const s = new THREE.Shape();
  // arrow pointing +X, fits in ~0.036 × 0.018
  s.moveTo(-0.017, -0.004);
  s.lineTo(0.004, -0.004);
  s.lineTo(0.004, -0.0095);
  s.lineTo(0.018, 0);
  s.lineTo(0.004, 0.0095);
  s.lineTo(0.004, 0.004);
  s.lineTo(-0.017, 0.004);
  s.closePath();
  return s;
}

function buttonGeometry(): THREE.BufferGeometry {
  return sharedGeo('pb:button', () => {
    const r = B.buttonR;
    const cap = latheZ(
      'pb:cap',
      [
        [r, 0],
        [r, 0.004],
        [r - 0.0015, 0.0058],
        [r * 0.6, 0.0062],
        [0, 0.0064],
      ],
      40,
    );
    const arrow = new THREE.ExtrudeGeometry(arrowShape(), { depth: 0.0022, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1 });
    return mergeAll([cap, xf(arrow, [0, 0, 0.0062])]);
  });
}

function speakerGrilleTexture(): THREE.CanvasTexture {
  return sharedTex('pb:grille', () => {
    const [c, ctx] = makeCanvas(128, 128);
    ctx.fillStyle = '#2a2b2d';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#050505';
    for (let ring = 0; ring < 5; ring++) {
      const rr = 10 + ring * 11;
      const n = ring === 0 ? 1 : ring * 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(64 + Math.cos(a) * (ring === 0 ? 0 : rr), 64 + Math.sin(a) * (ring === 0 ? 0 : rr), 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvasTex(c);
  });
}

/** R10-3b style sign: PUSH BUTTON FOR + walking person + arrow. */
function signTexture(arrow: 'left' | 'right'): THREE.CanvasTexture {
  return sharedTex(`pb:sign:${arrow}`, () => {
    const W = 360;
    const H = 480;
    const [c, ctx] = makeCanvas(W, H);
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(12, 12, W - 24, H - 24, 22);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 58px "Arial Narrow", Arial, Helvetica, sans-serif';
    ctx.fillText('PUSH', W / 2, 72);
    ctx.fillText('BUTTON', W / 2, 136);
    ctx.fillText('FOR', W / 2, 200);
    // black panel with white walking person
    ctx.fillStyle = '#111';
    ctx.fillRect(W / 2 - 66, 238, 132, 124);
    drawPedSymbol(ctx, 'person', W / 2 - 56, 244, 112, 112, '#f4f4f0');
    // arrow
    ctx.save();
    ctx.translate(W / 2, 414);
    if (arrow === 'left') ctx.scale(-1, 1);
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.moveTo(-110, -12);
    ctx.lineTo(60, -12);
    ctx.lineTo(60, -34);
    ctx.lineTo(112, 0);
    ctx.lineTo(60, 34);
    ctx.lineTo(60, 12);
    ctx.lineTo(-110, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return canvasTex(c);
  });
}

export function PedestrianPushButton({
  getPressed,
  onPress,
  onRelease,
  getLit,
  arrow = 'right',
  mount = 'post',
  color = '#2a2c2f',
  sign = true,
  position,
  rotation,
  scale,
}: PedestrianPushButtonProps) {
  const { hovered, handlers } = usePress(onPress, onRelease);
  const btn = useRef<THREE.Group>(null);
  const led = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#3a0505', emissive: '#ff1a0a', emissiveIntensity: 0, roughness: 0.25, toneMapped: false }),
    [],
  );
  useDisposable(useMemo(() => [led], [led]));
  const g = useRef({ getPressed, getLit });
  g.current = { getPressed, getLit };
  useFrame((_, dt) => {
    const pressed = g.current.getPressed();
    if (btn.current) btn.current.position.z = damp(btn.current.position.z, pressed ? -0.0028 : 0, 30, dt);
    const lit = g.current.getLit ? g.current.getLit() : pressed;
    led.emissiveIntensity = damp(led.emissiveIntensity, lit ? 4 : 0, 30, dt);
  });

  const onPost = mount === 'post';
  const stationY = onPost ? B.postStationY : 0;
  const stationZ = onPost ? 0.052 : 0;
  const bodyMat = tmats.paint(color, 0.55, 0.25);
  const signTex = signTexture(arrow);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {onPost && <PostParts />}
      <group position={[0, stationY, stationZ]} {...handlers}>
        <mesh geometry={stationBodyGeometry()} material={bodyMat} castShadow receiveShadow />
        {/* speaker grille */}
        <mesh geometry={circleGeo(0.032, 32)} position={[0, SPK_Y, B.bodyD + 0.0006]}>
          <meshStandardMaterial map={speakerGrilleTexture()} roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh geometry={torusGeo(0.034)} material={bodyMat} position={[0, SPK_Y, B.bodyD]} />
        {/* button bezel ring */}
        <mesh geometry={cylZ(B.buttonR + 0.009, B.buttonR + 0.011, 0.008, 40)} material={tmats.metal('#aeb2b5', 0.28)} position={[0, BTN_Y, B.bodyD + 0.003]} />
        <mesh geometry={cylZ(B.buttonR + 0.0015, B.buttonR + 0.0015, 0.006, 40)} material={tmats.black()} position={[0, BTN_Y, B.bodyD + 0.005]} />
        <group ref={btn}>
          <group position={[0, BTN_Y, B.bodyD + 0.004]} rotation={[0, 0, arrow === 'left' ? Math.PI : 0]}>
            <mesh geometry={buttonGeometry()} material={tmats.metal('#c9cdd0', 0.22)} castShadow />
          </group>
        </group>
        {/* call LED */}
        <mesh geometry={cylZ(0.0045, 0.0045, 0.004, 16)} material={led} position={[0, BTN_Y + 0.052, B.bodyD + 0.002]} />
        <mesh geometry={cylZ(0.0065, 0.0065, 0.002, 16)} material={tmats.metal('#8b8f93', 0.35)} position={[0, BTN_Y + 0.052, B.bodyD + 0.0005]} />
        {/* tamper-proof screws */}
        {[
          [-0.045, 0.02],
          [0.045, 0.02],
          [0, 0.325],
        ].map(([x, y], i) => (
          <mesh key={i} geometry={cylZ(0.004, 0.004, 0.003, 10)} material={tmats.metal('#9aa0a4', 0.4)} position={[x!, y!, B.bodyD + 0.001]} />
        ))}
        {/* enlarged invisible hit area */}
        <mesh geometry={boxGeo(0.2, 0.42, 0.14)} material={hitMat()} position={[0, B.bodyH / 2, B.bodyD / 2]} />
        {hovered && (
          <mesh geometry={cylZ(B.buttonR + 0.016, B.buttonR + 0.016, 0.001, 40)} position={[0, BTN_Y, B.bodyD + 0.0005]}>
            <meshBasicMaterial color="#7dd3fc" transparent opacity={0.5} toneMapped={false} />
          </mesh>
        )}
      </group>
      {sign && (
        <group position={[0, onPost ? B.postHeight - 0.03 - B.signH / 2 : B.bodyH + 0.03 + B.signH / 2, onPost ? 0.06 : 0.004]}>
          <mesh geometry={roundedBox(B.signW, B.signH, 0.003, 0.012, 2)} material={tmats.metal('#b9bdc0', 0.4)} castShadow />
          <mesh geometry={planeGeo(B.signW - 0.004, B.signH - 0.004)} position={[0, 0, 0.0016]}>
            <meshStandardMaterial map={signTex} roughness={0.45} metalness={0} />
          </mesh>
          {[B.signH / 2 - 0.02, -B.signH / 2 + 0.02].map((y) => (
            <mesh key={y} geometry={cylZ(0.004, 0.004, 0.004, 8)} material={tmats.metal('#9aa0a4', 0.4)} position={[0, y, 0.003]} />
          ))}
        </group>
      )}
    </group>
  );
}

function torusGeo(r: number): THREE.BufferGeometry {
  return sharedGeo(`pb:torus:${r}`, () => new THREE.TorusGeometry(r, 0.003, 8, 40));
}

/** Pedestal post: cast base with anchor nuts, 4" galvanized post, cap. */
function PostParts() {
  const geo = sharedGeo('pb:post', () => {
    const parts: THREE.BufferGeometry[] = [];
    const H = B.postHeight;
    parts.push(xf(cylY(0.05, 0.05, H - 0.2, 24), [0, 0.2 + (H - 0.2) / 2, 0]));
    parts.push(xf(cylY(0.053, 0.053, 0.015, 24), [0, H + 0.0075, 0])); // cap
    parts.push(xf(sphereCap(), [0, H + 0.015, 0]));
    return mergeAll(parts);
  });
  const base = sharedGeo('pb:postBase', () => {
    // cast aluminum transformer-style base: flared square
    const parts: THREE.BufferGeometry[] = [];
    const lathe = new THREE.LatheGeometry(
      [
        [0.13, 0],
        [0.13, 0.02],
        [0.1, 0.05],
        [0.075, 0.12],
        [0.065, 0.2],
        [0.0, 0.2],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      4,
    );
    lathe.rotateY(Math.PI / 4);
    lathe.computeVertexNormals();
    parts.push(lathe);
    return mergeAll(parts);
  });
  const nuts = sharedGeo('pb:postNuts', () =>
    mergeAll(
      [
        [0.07, 0.07],
        [-0.07, 0.07],
        [0.07, -0.07],
        [-0.07, -0.07],
      ].map(([x, z]) => xf(cylY(0.012, 0.012, 0.014, 6), [x!, 0.027, z!])),
    ),
  );
  return (
    <group>
      <mesh geometry={geo} material={tmats.galvanized()} castShadow receiveShadow />
      <mesh geometry={base} material={tmats.paint('#2f3133', 0.6, 0.3)} castShadow receiveShadow />
      <mesh geometry={nuts} material={tmats.metal('#9ea3a6', 0.4)} />
      <mesh geometry={cylY(0.2, 0.2, 0.04, 28)} position={[0, -0.018, 0]} material={tmats.concrete()} receiveShadow />
    </group>
  );
}

function sphereCap(): THREE.BufferGeometry {
  return sharedGeo('pb:sphereCap', () => new THREE.SphereGeometry(0.053, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2));
}

/** Default color of pole-mounted stations (for scenes). */
export const PUSH_BUTTON_YELLOW = TRAFFIC_COLORS.signalYellow;
