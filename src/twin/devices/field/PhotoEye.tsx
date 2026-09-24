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
  canvasTex,
  cylY,
  fm,
  geo,
  hexGeo,
  latheZ,
  M12_CORDSET_LENGTH,
  M12Cordset,
  mat,
  PanScrew,
  rbox,
  TAU,
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
function SensorPost({ length, offset }: { length: number; offset: [number, number, number] }) {
  const [ox, oy, oz] = offset;
  return (
    <group position={[ox, oy, oz]}>
      {/* bracket plate */}
      <mesh geometry={box(0.03, 0.03, 0.0025)} material={fm.stainless(0.35)} position={[0, 0, 0.004]} castShadow />
      {/* cross clamp block */}
      <mesh geometry={rbox(0.024, 0.024, 0.018, 0.003)} material={fm.anodized('#9ea4aa')} position={[0, -0.012, -0.007]} castShadow />
      <mesh geometry={cylY(0.006, length, 18)} material={fm.stainless(0.25)} position={[0, -length / 2, -0.007]} castShadow />
      <PanScrew d={0.004} position={[0.012, -0.012, -0.007]} rotation={[0, Math.PI / 2, 0]} />
      {/* base clamp on the frame */}
      <mesh geometry={rbox(0.028, 0.02, 0.028, 0.003)} material={fm.anodized('#9ea4aa')} position={[0, -length + 0.01, -0.007]} castShadow />
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
  onClick,
  position,
  rotation,
  scale,
}: PhotoEyeProps & PhotoEyeExtraProps) {
  const housing = fm.plastic('#26282c', 0.5);
  const beam = useRef<THREE.Mesh>(null);
  const beamCore = useRef<THREE.Mesh>(null);
  const hit = useRef<THREE.Mesh>(null);
  const emitter = useRef<THREE.MeshStandardMaterial>(null);

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
    if (emitter.current) emitter.current.emissiveIntensity = 2.2 * flicker;
  });

  // Nose & pigtail
  const noseY = BODY_CY - H / 2;
  const noseZ = -D / 2;
  const qdY = noseY - NOSE_L - 0.11;

  return (
    <group
      position={position}
      rotation={rotation}
      scale={scale}
      {...clickable(onClick)}
    >
      {/* housing */}
      <mesh geometry={rbox(W, H, D, 0.0016, 2)} material={housing} position={[0, BODY_CY, -D / 2]} castShadow />
      {/* front lens bezel + lens */}
      <mesh geometry={rbox(W - 0.0014, 0.0155, 0.0012, 0.0006, 2)} material={fm.plastic('#111214', 0.25)} position={[0, -0.0005, 0.0001]} />
      <mesh position={[0, -0.0005, 0.0008]}>
        <planeGeometry args={[W - 0.0036, 0.0132]} />
        <meshPhysicalMaterial color="#3a0606" roughness={0.05} metalness={0} clearcoat={1} clearcoatRoughness={0.03} />
      </mesh>
      {/* emitter glow behind the (coaxial) lens */}
      <mesh position={[0, -0.0005, 0.00085]}>
        <circleGeometry args={[0.0014, 20]} />
        <meshStandardMaterial ref={emitter} color="#300000" emissive="#ff2010" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.0005, 0.00082]}>
        <ringGeometry args={[0.0016, 0.0042, 24]} />
        <meshStandardMaterial color="#5a0c08" roughness={0.1} transparent opacity={0.6} />
      </mesh>
      {/* printed lower front: marking strip */}
      <mesh geometry={box(W - 0.006, 0.0005, 0.0002)} material={fm.plastic('#7d8185', 0.5)} position={[0, -0.0142, 0.0001]} />

      {/* indicator LEDs on the top (rear): green = power/margin, amber = output */}
      <Led color="green" get={() => true} size={[0.0032, 0.0012, 0.0032]} position={[-0.0036, LENS_Y_TOP + 0.0004, -D + 0.0055]} intensity={2.5} />
      <Led color="amber" get={getOutput} size={[0.0032, 0.0012, 0.0032]} position={[0.0036, LENS_Y_TOP + 0.0004, -D + 0.0055]} intensity={3} />
      {/* rear light-pipe windows (visible from behind) */}
      <Led color="green" get={() => true} size={[0.003, 0.003, 0.0008]} position={[-0.0036, LENS_Y_TOP - 0.003, -D - 0.0002]} intensity={2.5} />
      <Led color="amber" get={getOutput} size={[0.003, 0.003, 0.0008]} position={[0.0036, LENS_Y_TOP - 0.003, -D - 0.0002]} intensity={3} />

      {/* side label (+X) */}
      <mesh position={[W / 2 + 0.0002, BODY_CY + 0.004, -D / 2 - 0.001]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.02, 0.01]} />
        <meshStandardMaterial map={labelTex(catalog)} roughness={0.6} />
      </mesh>
      {/* mounting holes (through) with screws */}
      {(
        [
          [0.0055, -0.0215],
          [-0.016, -0.0065],
        ] as const
      ).map(([y, z], i) => (
        <group key={i}>
          <PanScrew d={0.0026} position={[W / 2, y, z]} rotation={[0, Math.PI / 2, 0]} />
        </group>
      ))}

      {/* M18 threaded nose + jam nut */}
      <mesh geometry={cylY(0.009, NOSE_L, 28)} material={fm.plastic('#26282c', 0.45)} position={[0, noseY - NOSE_L / 2, noseZ]} />
      <mesh geometry={cylY(0.0093, 0.002, 28)} material={fm.plastic('#1d1e21', 0.45)} position={[0, noseY - 0.001, noseZ]} />
      {/* pigtail (152 mm) with M12 male QD, mated to a yellow DC-micro cordset */}
      <Cable
        radius={0.0024}
        color={CABLE_BLACK}
        points={[
          [0, noseY - NOSE_L, noseZ],
          [0, noseY - NOSE_L - 0.03, noseZ],
          [0, noseY - NOSE_L - 0.07, noseZ - 0.01],
          [0, qdY + 0.02, noseZ - 0.012],
          [0, qdY + 0.004, noseZ - 0.012],
        ]}
      />
      <group position={[0, qdY, noseZ - 0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh geometry={latheZ('pigQD', [[0.0026, -0.004], [0.0045, 0.0], [0.0055, 0.006], [0.0055, 0.014], [0.0, 0.014]], 20)} material={fm.plastic('#1b1c1e', 0.45)} position={[0, 0, -0.018]} rotation={[Math.PI, 0, 0]} />
        <M12Cordset position={[0, 0, 0.003]} rotation={[Math.PI, 0, 0]} color={CABLE_YELLOW} />
        <Cable
          radius={0.0026}
          color={CABLE_YELLOW}
          points={[
            [0, 0, 0.003 + M12_CORDSET_LENGTH],
            [0, 0, 0.003 + M12_CORDSET_LENGTH + 0.04],
            [0, -0.02, 0.003 + M12_CORDSET_LENGTH + 0.09],
            [0, -0.06, 0.003 + M12_CORDSET_LENGTH + 0.12],
          ]}
        />
      </group>

      {/* stainless bracket on the -X side */}
      {mount !== 'none' && (
        <group>
          <mesh geometry={box(0.0015, 0.03, 0.029)} material={fm.stainless(0.35)} position={[-W / 2 - 0.00075, BODY_CY - 0.001, -D / 2 - 0.001]} castShadow />
          <mesh geometry={box(0.022, 0.03, 0.0015)} material={fm.stainless(0.35)} position={[-W / 2 - 0.011, BODY_CY - 0.001, -D - 0.0015]} castShadow />
          {[
            [0.0055, -0.0215],
            [-0.016, -0.0065],
          ].map(([y, z], i) => (
            <mesh key={i} geometry={hexGeo(0.0055, 0.0025)} material={fm.zinc()} position={[-W / 2 - 0.0028, y!, z!]} rotation={[0, Math.PI / 2, 0]} />
          ))}
          {mount === 'post' && <SensorPost length={postLength} offset={[-W / 2 - 0.013, BODY_CY - 0.001, -D - 0.003]} />}
        </group>
      )}

      {/* beam */}
      <mesh ref={beam} geometry={beamGeo} material={beamMat} visible={false} />
      <mesh ref={beamCore} geometry={beamGeo} material={coreMat} visible={false} />
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
      {/* subtle outline ring on the nose thread */}
      <mesh geometry={torus(0.009, 0.0005, TAU, 24)} material={fm.plastic('#1d1e21', 0.45)} position={[0, noseY - NOSE_L + 0.001, noseZ]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
}
