/**
 * 42EF RightSight-style polarized retro-reflective photo-eye + 92-39-style round retro-reflector.
 *
 * <PhotoEye42EF> origin: center of the lens (beam origin). The beam travels along +Z; the reflector (when
 * `beamLength` > 0) sits at z = beamLength facing back at the sensor. The compact housing (16.5 x 34 x 27 mm)
 * with its M18 threaded nose is below/behind the lens; the stainless bracket bolts to the -X side.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Led } from '../../common';
import type { PhotoEyeProps, Placement } from '../../contracts';
import {
  box,
  Cable,
  CABLE_BLACK,
  CABLE_YELLOW,
  type CableRoute,
  CableTie,
  canvasTex,
  cylY,
  DEVICE_ROOT,
  fm,
  geo,
  hexGeo,
  latheZ,
  lBracketGeo,
  M12_CORDSET_LENGTH,
  M12Cordset,
  mat,
  Merge,
  PanScrew,
  rbox,
  repeated,
  RoutedCable,
  TAU,
  threadTex,
  torus,
  clickable,
} from './shared';

// Housing dimensions (m)
const W = 0.0165;
const H = 0.034;
const D = 0.027;
const LENS_Y_TOP = 0.012; // body top above the lens center
const BODY_CY = LENS_Y_TOP - H / 2;
const NOSE_L = 0.0127;

const BEAM_RED = new THREE.Color(4.0, 0.12, 0.08);

/** Housing through-holes (y, z) for the M3 mounting screws. */
const HOLES: [number, number][] = [
  [0.0055, -0.0215],
  [-0.016, -0.0065],
];
// bracket: 1.5 mm stainless, 2 mm inner bend; side leg against the housing's -X face, back leg toward -X
const BT = 0.0015;
const BR = 0.002;
const BX = -W / 2 - BT / 2;
const BY = BODY_CY - 0.001;
const BZ = -D - 0.0015 + BR + BT;
const POST_X = -W / 2 - 0.013;
const POST_Z = -D - 0.0035;
/** Cable offset from the post axis (post r 6 mm + cable r 2.6 mm). */
const CABLE_OFF = 0.0088;
/** Bracket geometry: lBracketGeo re-oriented (leg → +Z along the housing side, foot → -X behind it). */
function bracketGeo() {
  return geo('42efBracket', () => {
    const g = lBracketGeo('42ef', {
      w: 0.03,
      up: D + 0.0003 - BR,
      foot: 0.02,
      t: BT,
      r: BR,
      holes: HOLES.map(([y, z]): [number, number, number] => [y - BY, z - BZ, 0.0036]),
      slots: [[-0.007, 0.0095, 0.007, 0.0034]],
    }).clone();
    g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
    return g;
  });
}

function labelTex(text: string) {
  return canvasTex(`42efLabel:${text}`, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b8bcbf';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#16181a';
    ctx.font = '700 28px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, 30);
    ctx.font = '500 18px Arial, Helvetica, sans-serif';
    ctx.fillText('10-30V DC  PNP  IO-Link', 12, 66);
    ctx.fillText('IP67  LO/DO  8 m', 12, 96);
    ctx.fillStyle = '#16181a';
    for (let i = 0; i < 26; i++) if ((i * 7) % 3 !== 0) ctx.fillRect(200 + i * 2, 88, 1.5, 22);
  });
}

/** Lens face: dark red polarizing window with the coaxial emitter / receiver optics. */
function lensTex() {
  return canvasTex('42efLens', 128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#4a0b09');
    g.addColorStop(0.5, '#2a0403');
    g.addColorStop(1, '#3a0706');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    // receiver ring (Fresnel lens) around the emitter
    for (let r = 44; r > 14; r -= 5) {
      ctx.strokeStyle = `rgba(150,30,24,${0.25 + (44 - r) / 140})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    ctx.fillStyle = '#6a120d';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, TAU);
    ctx.fill();
  });
}
function lensEmissiveTex() {
  return canvasTex('42efLensEm', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 16);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#ffffff');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Thread bump on molded plastic (the 18 mm nose). */
function plasticThread() {
  return mat('f:42efNoseThread', () => {
    const m = new THREE.MeshStandardMaterial({ color: '#26282c', roughness: 0.45, metalness: 0.02 });
    m.bumpMap = repeated(threadTex(), 1, 8);
    m.bumpScale = 2;
    return m;
  });
}

function hexReflectorTex() {
  return canvasTex('hexReflector', 512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7a0a0a';
    ctx.fillRect(0, 0, w, h);
    const r = 11;
    const dx = r * Math.sqrt(3);
    const dy = r * 1.5;
    for (let row = -1; row * dy < h + r; row++) {
      for (let col = -1; col * dx < w + r; col++) {
        const cx = col * dx + (row % 2 ? dx / 2 : 0);
        const cy = row * dy;
        // three facets of each corner-cube cell with different shades
        for (let f = 0; f < 3; f++) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          for (let j = 0; j <= 2; j++) {
            const a = ((f * 2 + j) / 6) * TAU + Math.PI / 6;
            ctx.lineTo(cx + r * 0.94 * Math.cos(a), cy + r * 0.94 * Math.sin(a));
          }
          ctx.closePath();
          ctx.fillStyle = f === 0 ? '#e0231d' : f === 1 ? '#b3140f' : '#cf1d17';
          ctx.fill();
        }
      }
    }
  });
}

/** Round 76 mm red corner-cube retro-reflector (92-39 style). Origin at the reflector face center, facing +Z. */
export function Retroreflector({
  position,
  rotation,
  scale,
  post = 0,
  getLit,
}: Placement & { post?: number; getLit?: () => boolean }) {
  const faceMat = mat('f:reflectorFace', () => {
    const m = new THREE.MeshPhysicalMaterial({
      map: hexReflectorTex(),
      roughness: 0.25,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
    return m;
  });
  const spot = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (spot.current) spot.current.visible = getLit ? getLit() : false;
  });
  const R = 0.038;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* red acrylic body with rim */}
      <mesh
        geometry={latheZ('reflBody', [
          [0.004, -0.0075],
          [R * 0.95, -0.0075],
          [R, -0.006],
          [R, -0.001],
          [R - 0.0022, 0],
          [R - 0.0035, -0.0008],
        ], 48)}
        material={fm.plastic('#a3120d', 0.35)}
        castShadow
      />
      <mesh position={[0, 0, -0.0009]} material={faceMat}>
        <ringGeometry args={[0.0045, R - 0.0035, 48]} />
      </mesh>
      {/* center mounting screw */}
      <PanScrew d={0.0045} position={[0, 0, -0.0012]} />
      {/* bright return spot where the beam hits */}
      <mesh ref={spot} position={[0, 0.012, 0.0005]} visible={false}>
        <circleGeometry args={[0.005, 20]} />
        <meshBasicMaterial color={BEAM_RED} toneMapped={false} transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {post > 0 && <SensorPost length={post} offset={[0, -0.007, -0.012]} />}
    </group>
  );
}

/** Stainless angle bracket + clamp on a vertical Ø12 rod down `length` meters to a base clamp. */
function SensorPost({ length, offset, plate = true }: { length: number; offset: [number, number, number]; plate?: boolean }) {
  const [ox, oy, oz] = offset;
  return (
    <group position={[ox, oy, oz]}>
      {/* bracket plate */}
      {plate && <mesh geometry={box(0.03, 0.03, 0.0025)} material={fm.stainless(0.35)} position={[0, 0, 0.004]} castShadow />}
      {/* cross clamp block */}
      <mesh geometry={rbox(0.024, 0.024, 0.018, 0.003)} material={fm.plastic('#2c2f33', 0.55)} position={[0, -0.012, -0.007]} castShadow />
      <mesh geometry={cylY(0.006, length - 0.003, 18)} material={fm.stainless(0.25)} position={[0, -(length + 0.003) / 2, -0.007]} castShadow />
      <PanScrew d={0.004} position={[0.012, -0.012, -0.007]} rotation={[0, Math.PI / 2, 0]} />
      {/* base clamp on the frame */}
      <mesh geometry={rbox(0.028, 0.02, 0.028, 0.003)} material={fm.plastic('#2c2f33', 0.55)} position={[0, -length + 0.01, -0.007]} castShadow />
    </group>
  );
}

export interface PhotoEyeExtraProps {
  /** Distance (m) along the beam where a blocking object's surface is (default: mid-beam). */
  getBlockDistance?: () => number;
  /** 'post': bracket + vertical rod `postLength` down; 'bracket': bracket only; 'none'. */
  mount?: 'post' | 'bracket' | 'none';
  postLength?: number;
  /** Catalog text on the side label. */
  catalog?: string;
  /**
   * Where the yellow cordset goes (parent coordinates). Default: with mount='post' it is tied down the post
   * and enters the base clamp (the machine frame); otherwise it drops to a floor conduit stub.
   */
  cableTo?: CableRoute;
  onClick?: () => void;
}

export function PhotoEye42EF({
  getBlocked,
  getOutput,
  beamLength = 0,
  showBeam = true,
  getBlockDistance,
  mount = 'post',
  postLength = 0.12,
  catalog = '42EF-P2MPB-F4',
  cableTo,
  onClick,
  position,
  rotation,
  scale,
}: PhotoEyeProps & PhotoEyeExtraProps) {
  const housing = fm.plastic('#26282c', 0.5);
  const beam = useRef<THREE.Mesh>(null);
  const beamCore = useRef<THREE.Mesh>(null);
  const hit = useRef<THREE.Mesh>(null);
  const lensMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: lensTex(),
        emissiveMap: lensEmissiveTex(),
        emissive: new THREE.Color('#ff2010'),
        emissiveIntensity: 2,
        roughness: 0.08,
        metalness: 0,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );
  useEffect(() => () => lensMat.dispose(), [lensMat]);

  const beamGeo = geo('beamUnit', () => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.5);
    return g;
  });
  const beamMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.6, 0.05, 0.04),
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );
  const coreMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: BEAM_RED,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      beamMat.dispose();
      coreMat.dispose();
    },
    [beamMat, coreMat],
  );

  useFrame(({ clock }) => {
    const blocked = getBlocked();
    const len = blocked ? Math.max(0.01, getBlockDistance ? getBlockDistance() : beamLength * 0.5) : beamLength;
    const vis = showBeam && beamLength > 0;
    const flicker = 0.9 + 0.1 * Math.sin(clock.elapsedTime * 40);
    if (beam.current) {
      beam.current.visible = vis;
      beam.current.scale.set(0.0022, 0.0022, len);
    }
    if (beamCore.current) {
      beamCore.current.visible = vis;
      beamCore.current.scale.set(0.0006, 0.0006, len);
    }
    coreMat.opacity = blocked ? 0.75 * flicker : 0.9 * flicker;
    if (hit.current) {
      hit.current.visible = vis && blocked;
      hit.current.position.z = len - 0.002;
    }
    lensMat.emissiveIntensity = 2.2 * flicker;
  });

  // Nose & pigtail
  const noseY = BODY_CY - H / 2;
  const noseZ = -D / 2;
  const onPost = mount === 'post';
  // M12 QD: hanging below the nose, or (post mount) beside the post just below the cross clamp
  const qd: [number, number, number] = onPost ? [POST_X + CABLE_OFF, BY - 0.066, POST_Z - 0.007] : [0, noseY - NOSE_L - 0.11, noseZ - 0.012];
  const qdY = qd[1];
  const cordEnd = qdY - 0.003 - M12_CORDSET_LENGTH + 0.001;
  const baseTop = BY - postLength + 0.02;
  // short posts (conveyor side frames): no room for the QD beside the post -> the pigtail runs straight into the
  // base clamp and the QD / cordset sit inside the machine frame
  const shortPost = onPost && cordEnd < baseTop + 0.012;
  // default cordset path with the post mount: tied down along the post, into the base clamp (machine frame)
  const postPath: [number, number, number][] = [
    [qd[0], Math.min(cordEnd - 0.03, Math.max(baseTop + 0.01, (cordEnd + baseTop) / 2)), qd[2]],
    [qd[0], baseTop - 0.002, qd[2]],
    [POST_X + CABLE_OFF * 0.5, baseTop - 0.012, qd[2]],
  ];
  const pigtail: [number, number, number][] = shortPost
    ? [
        [0, noseY - NOSE_L, noseZ],
        [0, noseY - NOSE_L - 0.012, noseZ],
        [qd[0] * 0.5, noseY - NOSE_L - 0.03, (noseZ + qd[2]) / 2],
        [qd[0] * 0.8, BY - 0.034, qd[2] + 0.003],
        [qd[0], Math.min(BY - 0.045, (BY - 0.034 + baseTop) / 2), qd[2]],
        [qd[0], baseTop + 0.004, qd[2]],
        [qd[0] * 0.95, baseTop - 0.012, qd[2]],
      ]
    : onPost
    ? [
        [0, noseY - NOSE_L, noseZ],
        [0, noseY - NOSE_L - 0.02, noseZ],
        [qd[0] * 0.5, qdY + 0.042, (noseZ + qd[2]) / 2],
        [qd[0], qdY + 0.032, qd[2]],
        [qd[0], qdY + 0.022, qd[2]],
      ]
    : [
        [0, noseY - NOSE_L, noseZ],
        [0, noseY - NOSE_L - 0.03, noseZ],
        [0, noseY - NOSE_L - 0.07, noseZ - 0.01],
        [0, qdY + 0.03, noseZ - 0.012],
        [0, qdY + 0.022, noseZ - 0.012],
      ];

  return (
    <group position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
        {/* housing */}
        <mesh geometry={rbox(W, H, D, 0.0016, 2)} material={housing} position={[0, BODY_CY, -D / 2]} castShadow />
        {/* front lens bezel + single lens plane (emitter glow in the emissive map, no stacked layers) */}
        <mesh geometry={rbox(W - 0.0014, 0.0155, 0.0012, 0.0006, 2)} material={fm.plastic('#111214', 0.25)} position={[0, -0.0005, 0.0001]} />
        <mesh position={[0, -0.0005, 0.0011]} material={lensMat}>
          <planeGeometry args={[W - 0.0036, 0.0132]} />
        </mesh>

        {/* indicator LEDs on the top (rear): green = power/margin, amber = output */}
        <Led color="green" get={() => true} size={[0.0032, 0.0012, 0.0032]} position={[-0.0036, LENS_Y_TOP + 0.0004, -D + 0.0055]} intensity={2.5} />
        <Led color="amber" get={getOutput} size={[0.0032, 0.0012, 0.0032]} position={[0.0036, LENS_Y_TOP + 0.0004, -D + 0.0055]} intensity={3} />
        {/* rear light-pipe windows (visible from behind) */}
        <Led color="green" get={() => true} size={[0.003, 0.003, 0.0008]} position={[-0.0036, LENS_Y_TOP - 0.003, -D - 0.0002]} intensity={2.5} />
        <Led color="amber" get={getOutput} size={[0.003, 0.003, 0.0008]} position={[0.0036, LENS_Y_TOP - 0.003, -D - 0.0002]} intensity={3} />

        {/* side label (+X) */}
        <mesh position={[W / 2 + 0.0002, BODY_CY + 0.004, -D / 2 - 0.001]} rotation={[0, Math.PI / 2, 0]} material={fm.plate(labelTex(catalog))}>
          <planeGeometry args={[0.02, 0.01]} />
        </mesh>
        {/* mounting holes (through) with screws */}
        {HOLES.map(([y, z], i) => (
          <PanScrew key={i} d={0.0026} position={[W / 2, y, z]} rotation={[0, Math.PI / 2, 0]} />
        ))}

        {/* threaded 18 mm nose + 24 AF plastic jam nut */}
        <mesh geometry={cylY(0.009, NOSE_L, 28)} material={plasticThread()} position={[0, noseY - NOSE_L / 2, noseZ]} />
        <mesh geometry={hexGeo(0.024, 0.005)} material={fm.plastic('#1d1e21', 0.5)} position={[0, noseY - 0.003, noseZ]} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={torus(0.0089, 0.0006, TAU, 24)} material={fm.plastic('#1d1e21', 0.45)} position={[0, noseY - NOSE_L + 0.0006, noseZ]} rotation={[Math.PI / 2, 0, 0]} />
        {/* pigtail (152 mm) with M12 male QD, mated to a yellow DC-micro cordset */}
        <Cable radius={0.0024} color={CABLE_BLACK} points={pigtail} />
        {!shortPost && (
          <group position={qd} rotation={[Math.PI / 2, 0, 0]}>
            <mesh geometry={latheZ('pigQD', [[0.0026, -0.004], [0.0045, 0.0], [0.0055, 0.006], [0.0055, 0.014], [0.0, 0.014]], 20)} material={fm.plastic('#1b1c1e', 0.45)} position={[0, 0, -0.0045]} rotation={[Math.PI, 0, 0]} />
            <M12Cordset position={[0, 0, 0.003]} rotation={[Math.PI, 0, 0]} color={CABLE_YELLOW} />
          </group>
        )}
        <RoutedCable
          route={shortPost && cableTo === undefined ? false : cableTo}
          from={shortPost ? [qd[0] * 0.95, baseTop - 0.012, qd[2]] : [qd[0], cordEnd, qd[2]]}
          dir={[0, -1, 0]}
          radius={0.0026}
          color={CABLE_YELLOW}
          lead={0.02}
          path={onPost ? postPath : undefined}
        />

        {/* one-piece bent stainless bracket on the -X side, bolted to the post clamp */}
        {mount !== 'none' && (
          <group>
            <mesh geometry={bracketGeo()} material={fm.stainless(0.35)} position={[BX, BY, BZ]} castShadow />
            {HOLES.map(([y, z], i) => (
              <mesh key={i} geometry={hexGeo(0.0055, 0.0025)} material={fm.zinc()} position={[-W / 2 - BT - 0.00125, y, z]} rotation={[0, Math.PI / 2, 0]} />
            ))}
            {mount === 'post' && (
              <>
                <PanScrew d={0.003} position={[POST_X, BY - 0.007, BZ - BR - BT / 2 + BT / 2 + 0.0001]} />
                <SensorPost length={postLength} offset={[POST_X, BY, POST_Z]} plate={false} />
                {/* cordset tied to the post */}
                {!shortPost &&
                  [0.45, 0.8].map((f) => (
                    <CableTie key={f} r={0.0105} position={[POST_X + 0.0035, cordEnd - 0.01 - f * (cordEnd - baseTop - 0.01), POST_Z - 0.007]} rotation={[Math.PI / 2, 0, 0]} />
                  ))}
              </>
            )}
          </group>
        )}
      </Merge>

      {/* beam */}
      <mesh ref={beam} geometry={beamGeo} material={beamMat} visible={false} raycast={() => {}} />
      <mesh ref={beamCore} geometry={beamGeo} material={coreMat} visible={false} raycast={() => {}} />
      <mesh ref={hit} visible={false} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[0.006, 20]} />
        <meshBasicMaterial color={BEAM_RED} toneMapped={false} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {beamLength > 0 && (
        <Retroreflector
          position={[0, 0, beamLength]}
          rotation={[0, Math.PI, 0]}
          post={mount === 'post' ? postLength : 0}
          getLit={() => showBeam && !getBlocked()}
        />
      )}
    </group>
  );
}
