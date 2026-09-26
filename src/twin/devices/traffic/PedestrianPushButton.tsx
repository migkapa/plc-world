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
  FINISH,
  INCH,
  TRAFFIC_COLORS,
  boxGeo,
  canvasTex,
  circleGeo,
  cylY,
  cylZ,
  damp,
  galvPrep,
  hitMat,
  hoverMat,
  latheZ,
  makeCanvas,
  mergeAll,
  mergeGalv,
  mergeVc,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedMat,
  sharedTex,
  tmats,
  usePress,
  useDisposable,
  vc,
  vcMaterial,
  xf,
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
  /**
   * `mount="none"` on a round pole: pole radius (m) → draws a curved saddle adapter + band clamps and
   * moves the station out by the saddle depth (origin stays on the pole surface). 0 = flat surface.
   */
  poleRadius?: number;
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

/** Static parts of the station (body, bezels, screws, LED bezel, sign back & screws) in one mesh. */
function stationStatic(color: string, sign: boolean, onPost: boolean, poleRadius: number): THREE.BufferGeometry {
  return sharedGeo(`pb:static:${color}:${sign}:${onPost}:${poleRadius}`, () => {
    const body = { color, roughness: 0.55, metalness: 0.25 };
    const parts: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, f: { color: string; roughness?: number; metalness?: number }, pos?: [number, number, number], rot?: [number, number, number]) =>
      parts.push(vc(xf(g, pos, rot), f));
    const st = onPost ? B.postStationY : 0;
    const sz = stationZ(onPost, poleRadius);
    add(stationBodyGeometry(), body, [0, st, sz]);
    add(torusGeo(0.034), body, [0, st + SPK_Y, sz + B.bodyD]);
    // button bezel ring + black gasket ring
    add(cylZ(B.buttonR + 0.009, B.buttonR + 0.011, 0.008, 40), FINISH.stainless, [0, st + BTN_Y, sz + B.bodyD + 0.003]);
    add(cylZ(B.buttonR + 0.0015, B.buttonR + 0.0015, 0.006, 40), FINISH.blackPlastic, [0, st + BTN_Y, sz + B.bodyD + 0.005]);
    // LED bezel
    add(cylZ(0.0065, 0.0065, 0.002, 16), FINISH.darkMetal, [0, st + BTN_Y + 0.052, sz + B.bodyD + 0.0005]);
    // tamper-proof screws
    for (const [x, y] of [
      [-0.045, 0.02],
      [0.045, 0.02],
      [0, 0.325],
    ] as const)
      add(cylZ(0.004, 0.004, 0.003, 10), FINISH.hardware, [x, st + y, sz + B.bodyD + 0.001]);
    // saddle adapter: flat front for the station, concave back matching the pole; stainless bands
    const R = onPost ? POST_R : poleRadius;
    if (R > 0) {
      const axisZ = onPost ? 0 : -R;
      // the adapter is narrower than the pole/post so its concave back sits fully on the pole; the
      // station's back plate overhangs it
      add(saddleGeometry(R, Math.min(B.bodyW / 2 - 0.008, R * 0.85), SADDLE_T, B.bodyH - 0.05), body, [0, st + 0.025, axisZ]);
      for (const y of [0.07, B.bodyH - 0.07]) {
        add(new THREE.TorusGeometry(R + 0.0015, 0.0022, 6, 48), FINISH.stainless, [0, st + y, axisZ], [Math.PI / 2, 0, 0]);
        add(roundedBox(0.03, 0.016, 0.014, 0.003, 1), FINISH.stainless, [0, st + y, axisZ - R - 0.006]);
      }
    }
    if (sign) {
      const sy = onPost ? B.postHeight - 0.03 - B.signH / 2 : B.bodyH + 0.03 + B.signH / 2;
      const zz = signZ(onPost, poleRadius);
      add(roundedBox(B.signW, B.signH, 0.003, 0.012, 2), { color: '#b9bdc0', roughness: 0.4, metalness: 0.9 }, [0, sy, zz]);
      for (const y of [B.signH / 2 - 0.02, -B.signH / 2 + 0.02]) add(cylZ(0.004, 0.004, 0.004, 8), FINISH.hardware, [0, sy + y, zz + 0.003]);
      if (onPost) {
        // sign mounting bands around the post
        for (const y of [B.signH / 2 - 0.05, -B.signH / 2 + 0.05]) add(new THREE.TorusGeometry(POST_R + 0.0015, 0.002, 6, 40), FINISH.stainless, [0, sy + y, 0], [Math.PI / 2, 0, 0]);
      }
    }
    return mergeVc(parts);
  });
}

const POST_R = 0.05;
const SADDLE_T = 0.01;

/**
 * Saddle adapter (height h, extends +Y from 0): profile in the XZ plane with a flat front at
 * z = R + t and a back that follows the pole (radius R, axis at the origin).
 */
function saddleGeometry(R: number, halfW: number, t: number, h: number): THREE.BufferGeometry {
  return sharedGeo(`pb:saddle:${R}:${halfW}:${t}:${h}`, () => {
    const zFlat = R + t;
    const zb = (x: number) => Math.sqrt(Math.max(0, R * R - x * x));
    const s = new THREE.Shape();
    // shape (X, Y) -> world (x, z) after rotateX(+90°) flips: shape Y = world z
    s.moveTo(-halfW, zFlat);
    s.lineTo(halfW, zFlat);
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const x = halfW - (2 * halfW * i) / n;
      s.lineTo(x, zb(x));
    }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
    g.rotateX(Math.PI / 2); // (X, Y, d) -> (X, -d, Y)
    g.translate(0, h, 0);
    return g;
  });
}

/** Station back-face z relative to the component origin (post axis, or the pole surface). */
function stationZ(onPost: boolean, poleRadius: number): number {
  if (onPost) return POST_R + SADDLE_T;
  return poleRadius > 0 ? SADDLE_T : 0;
}

function signZ(onPost: boolean, poleRadius: number): number {
  return onPost ? POST_R + 0.004 : poleRadius > 0 ? 0.006 : 0.004;
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
  poleRadius = 0,
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
  const sz = stationZ(onPost, poleRadius);
  const signTex = signTexture(arrow);
  const signY = onPost ? B.postHeight - 0.03 - B.signH / 2 : B.bodyH + 0.03 + B.signH / 2;

  return (
    <group position={position} rotation={rotation} scale={scale}>
      {onPost && <PostParts />}
      <mesh geometry={stationStatic(color, sign, onPost, poleRadius)} material={vcMaterial()} castShadow receiveShadow />
      <group position={[0, stationY, sz]} {...handlers}>
        {/* speaker grille */}
        <mesh geometry={circleGeo(0.032, 32)} position={[0, SPK_Y, B.bodyD + 0.0006]} material={grilleMat()} />
        <group ref={btn}>
          <group position={[0, BTN_Y, B.bodyD + 0.004]} rotation={[0, 0, arrow === 'left' ? Math.PI : 0]}>
            <mesh geometry={buttonGeometry()} material={tmats.metal('#c9cdd0', 0.22)} />
          </group>
        </group>
        {/* call LED */}
        <mesh geometry={cylZ(0.0045, 0.0045, 0.004, 16)} material={led} position={[0, BTN_Y + 0.052, B.bodyD + 0.002]} />
        {/* enlarged invisible hit area (not rendered) */}
        <mesh geometry={boxGeo(0.2, 0.42, 0.14)} material={hitMat()} position={[0, B.bodyH / 2, B.bodyD / 2]} />
        {hovered && <mesh geometry={cylZ(B.buttonR + 0.016, B.buttonR + 0.016, 0.001, 40)} position={[0, BTN_Y, B.bodyD + 0.0005]} material={hoverMat()} />}
      </group>
      {sign && (
        <mesh geometry={planeGeo(B.signW - 0.004, B.signH - 0.004)} position={[0, signY, signZ(onPost, poleRadius) + 0.0016]} material={signMat(arrow, signTex)} />
      )}
    </group>
  );
}

function grilleMat(): THREE.MeshStandardMaterial {
  return sharedMat('pb:grilleMat', () => new THREE.MeshStandardMaterial({ map: speakerGrilleTexture(), roughness: 0.6, metalness: 0.3 }));
}

function signMat(arrow: string, map: THREE.Texture): THREE.MeshStandardMaterial {
  return sharedMat(`pb:signMat:${arrow}`, () => new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0 }));
}

function torusGeo(r: number): THREE.BufferGeometry {
  return sharedGeo(`pb:torus:${r}`, () => new THREE.TorusGeometry(r, 0.003, 8, 40));
}

/** Pedestal post: cast base on a flange with 4 anchor bolts, 4" galvanized post, cap, concrete pad. */
function PostParts() {
  const post = sharedGeo('pb:post2', () => {
    const H = B.postHeight;
    const shaft = new THREE.CylinderGeometry(POST_R, POST_R, H - 0.2, 24, 1, true);
    shaft.translate(0, 0.2 + (H - 0.2) / 2, 0);
    return mergeGalv([
      galvPrep(shaft, { cyl: { axis: 'y', radius: POST_R } }),
      galvPrep(xf(cylY(0.053, 0.053, 0.015, 24), [0, H + 0.0075, 0])),
      galvPrep(xf(sphereCap(), [0, H + 0.015, 0])),
    ]);
  });
  const base = sharedGeo('pb:postBase2', () => {
    // cast aluminum transformer-style base: square flange plate + flared square body + anchor bolts
    const paintF = { color: '#2f3133', roughness: 0.6, metalness: 0.3 };
    const parts: THREE.BufferGeometry[] = [];
    parts.push(vc(xf(roundedBox(0.27, 0.02, 0.27, 0.006, 1), [0, 0.01, 0]), paintF));
    const lathe = new THREE.LatheGeometry(
      [
        [0.12, 0.02],
        [0.115, 0.035],
        [0.09, 0.07],
        [0.072, 0.13],
        [0.064, 0.2],
        [0.0, 0.2],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      4,
    );
    lathe.rotateY(Math.PI / 4);
    lathe.computeVertexNormals();
    parts.push(vc(lathe, paintF));
    for (const [x, z] of [
      [0.105, 0.105],
      [-0.105, 0.105],
      [0.105, -0.105],
      [-0.105, -0.105],
    ] as const) {
      parts.push(vc(xf(cylY(0.008, 0.008, 0.05, 8), [x, 0.03, z]), FINISH.hardware)); // bolt stub
      parts.push(vc(xf(cylY(0.014, 0.014, 0.012, 6), [x, 0.026, z]), FINISH.hardware)); // nut
      parts.push(vc(xf(cylY(0.018, 0.018, 0.003, 16), [x, 0.0215, z]), FINISH.hardware)); // washer
    }
    return mergeVc(parts);
  });
  return (
    <group>
      <mesh geometry={post} material={tmats.galvanized()} castShadow receiveShadow />
      <mesh geometry={base} material={vcMaterial()} castShadow receiveShadow />
      <mesh geometry={cylY(0.22, 0.22, 0.04, 28)} position={[0, -0.018, 0]} material={tmats.concrete()} receiveShadow />
    </group>
  );
}

function sphereCap(): THREE.BufferGeometry {
  return sharedGeo('pb:sphereCap', () => new THREE.SphereGeometry(0.053, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2));
}

/** Default color of pole-mounted stations (for scenes). */
export const PUSH_BUTTON_YELLOW = TRAFFIC_COLORS.signalYellow;
