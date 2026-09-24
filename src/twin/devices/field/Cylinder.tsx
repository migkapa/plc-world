/**
 * ISO 15552 profile-barrel pneumatic cylinder (clear-anodized aluminum profile with sensor slots, die-cast
 * end caps, chrome rod, push-in fittings with blue/black PU tubing, reed switches with LEDs).
 *
 * Origin: center of the FRONT (rod-end) cap face. The rod extends along +Z; the body lies toward -Z.
 * Optional front flange (MF1) and a guided pusher plate for box diverters.
 */
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { CylinderProps, Vec3 } from '../../contracts';
import {
  box,
  Cable,
  type CableRoute,
  canvasTex,
  CapScrew,
  cylZ,
  DEVICE_ROOT,
  fm,
  geo,
  hexGeo,
  latheZ,
  mat,
  Merge,
  PushInFitting,
  rbox,
  RoutedCable,
  clickable,
} from './shared';

interface IsoSize {
  profile: number;
  rod: number;
  cap: number;
  /** Base length (both caps + piston) without stroke. */
  base: number;
  /** Rod extension at full retraction (WH). */
  wh: number;
  screw: number;
  port: number;
}

const ISO: [number, IsoSize][] = [
  [0.032, { profile: 0.045, rod: 0.012, cap: 0.022, base: 0.094, wh: 0.026, screw: 0.005, port: 0.006 }],
  [0.04, { profile: 0.054, rod: 0.016, cap: 0.025, base: 0.105, wh: 0.03, screw: 0.006, port: 0.006 }],
  [0.05, { profile: 0.065, rod: 0.02, cap: 0.028, base: 0.106, wh: 0.037, screw: 0.008, port: 0.008 }],
  [0.063, { profile: 0.075, rod: 0.02, cap: 0.031, base: 0.121, wh: 0.037, screw: 0.008, port: 0.008 }],
  [0.08, { profile: 0.094, rod: 0.025, cap: 0.036, base: 0.128, wh: 0.046, screw: 0.01, port: 0.01 }],
];

export function isoCylinderSize(bore: number): IsoSize {
  let best = ISO[0]![1];
  let d = Infinity;
  for (const [b, s] of ISO) {
    if (Math.abs(b - bore) < d) {
      d = Math.abs(b - bore);
      best = s;
    }
  }
  return best;
}

function profileGeo(size: IsoSize, length: number) {
  return geo(`isoProfile:${size.profile}:${length.toFixed(4)}`, () => {
    const h = size.profile / 2;
    const rc = size.profile * 0.1;
    const sw = 0.0052; // sensor slot mouth
    const sd = 0.0024; // visible slot depth
    const pts: THREE.Vector2[] = [];
    for (let side = 0; side < 4; side++) {
      const an = (side * Math.PI) / 2; // outward normal angle: +X, +Y, -X, -Y
      const nx = Math.cos(an);
      const ny = Math.sin(an);
      const tx = -ny; // CCW tangent
      const ty = nx;
      const P = (sAlong: number, inset = 0) => pts.push(new THREE.Vector2(nx * (h - inset) + tx * sAlong, ny * (h - inset) + ty * sAlong));
      P(-(h - rc));
      P(-sw / 2 - 0.0009);
      P(-sw / 2 - 0.0002, 0.0004);
      P(-sw / 2, sd);
      P(sw / 2, sd);
      P(sw / 2 + 0.0002, 0.0004);
      P(sw / 2 + 0.0009);
      P(h - rc);
      // corner arc to the next side
      const cx = (nx + tx) * (h - rc);
      const cy = (ny + ty) * (h - rc);
      for (let j = 1; j < 5; j++) {
        const a = an + (j / 5) * (Math.PI / 2);
        pts.push(new THREE.Vector2(cx + Math.cos(a) * rc, cy + Math.sin(a) * rc));
      }
    }
    const shape = new THREE.Shape(pts);
    const g = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -length);
    return g;
  });
}

function EndCap({ size, z, front }: { size: IsoSize; z: number; front: boolean }) {
  const p = size.profile;
  const c = size.cap;
  const capMat = fm.aluminum(0.42);
  const inset = p * 0.37;
  return (
    <group position={[0, 0, z]}>
      <mesh geometry={rbox(p + 0.001, p + 0.001, c, p * 0.08, 2)} material={capMat} castShadow receiveShadow />
      {/* corner screws (face side) */}
      {[
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ].map(([a, b], i) => (
        <CapScrew key={i} d={size.screw} position={[a! * inset, b! * inset, front ? c / 2 : -c / 2]} rotation={front ? [0, 0, 0] : [Math.PI, 0, 0]} />
      ))}
      {/* cushioning adjustment screw on the side */}
      <mesh geometry={cylZ(0.0022, 0.002, 12)} material={fm.brass()} position={[p / 2 + 0.0008, -p * 0.2, 0]} rotation={[0, Math.PI / 2, 0]} />
      <mesh geometry={box(0.0004, 0.0035, 0.0006)} material={fm.dark()} position={[p / 2 + 0.0019, -p * 0.2, 0]} />
      {/* rod bearing spigot on the front */}
      {front && (
        <>
          <mesh geometry={cylZ(size.rod * 1.1, 0.004, 32)} material={capMat} position={[0, 0, c / 2 + 0.002]} />
          <mesh geometry={cylZ(size.rod * 0.62, 0.0015, 32)} material={fm.rubber('#222')} position={[0, 0, c / 2 + 0.0045]} />
        </>
      )}
    </group>
  );
}

/** Reed switch (D-M9 style) clipped into a sensor slot; +Z along the slot. The lead is drawn by the cylinder. */
function ReedSwitch({ position, get }: { position: Vec3; get?: () => boolean }) {
  const matOn = mat('f:reedLedOn', () => new THREE.MeshStandardMaterial({ color: '#ff5a2a', emissive: '#ff3a10', emissiveIntensity: 3.5, toneMapped: false }));
  const matOff = mat('f:reedLedOff', () => new THREE.MeshStandardMaterial({ color: '#4a1208', roughness: 0.3 }));
  const led = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (led.current) led.current.material = get?.() ? matOn : matOff;
  });
  return (
    <group position={position}>
      <mesh geometry={rbox(0.0042, 0.0042, 0.022, 0.0012, 2)} material={fm.plastic('#1c1d20', 0.5)} castShadow />
      <mesh ref={led} geometry={box(0.0026, 0.0012, 0.0036)} material={matOff} position={[0, 0.0021, -0.007]} userData={{ noMerge: true }} />
      <mesh geometry={cylZ(0.0012, 0.0015, 10)} material={fm.zinc()} position={[0, 0.0016, 0.006]} />
    </group>
  );
}

function isoLabelTex(bore: number, stroke: number) {
  return canvasTex(`isoLabel:${bore}:${stroke}`, 512, 96, (ctx, w, h) => {
    ctx.fillStyle = '#f0f1ee';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b1d20';
    ctx.fillRect(0, 0, 14, h);
    ctx.font = '700 34px Arial, Helvetica, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`ISO 15552   Ø${Math.round(bore * 1000)} × ${Math.round(stroke * 1000)}`, 30, 34);
    ctx.font = '600 24px Arial, Helvetica, sans-serif';
    ctx.fillText('pmax 10 bar   PPV   -20…+80 °C', 30, 72);
  });
}

export interface CylinderExtraProps {
  /** Rod-end pusher plate [width, height] in meters (plate lies in the XY plane). */
  pusher?: [number, number];
  /** Two guide rods through linear bushings on the flange (anti-rotation), default true with a pusher. */
  guided?: boolean;
  /** Front MF1 flange plate. Default true with a pusher. */
  flange?: boolean;
  /**
   * Tubing ends in CYLINDER coordinates for the rear (extend, blue) and front (retract, black) ports (e.g. the
   * valve's A/B fittings); default: both tubes, with the reed-switch leads tied to them, drop into a floor
   * conduit stub; `false` hides the tubes (the leads then end at the rear cap).
   */
  tubes?: { rear: Vec3; front: Vec3 } | false;
  onClick?: () => void;
}

export function PneumaticCylinder({
  getExtension,
  stroke = 0.2,
  bore = 0.04,
  getRetractedSensor,
  getExtendedSensor,
  pusher,
  guided,
  flange,
  tubes,
  onClick,
  position,
  rotation,
  scale,
}: CylinderProps & CylinderExtraProps) {
  const size = isoCylinderSize(bore);
  const p = size.profile;
  const profileLen = size.base - 2 * size.cap + stroke;
  const zRearCap = -size.cap - profileLen - size.cap / 2;
  const zFrontCap = -size.cap / 2;
  const useGuides = guided ?? !!pusher;
  const useFlange = flange ?? !!pusher;
  const flangeT = 0.01;
  const flangeW = pusher ? Math.max(p * 1.7, pusher[0] * 0.8) : p * 1.8;
  const guideX = flangeW / 2 - 0.018;
  const moving = useRef<THREE.Group>(null);
  const plateOffset = useFlange ? flangeT : 0;

  useFrame(() => {
    const e = Math.min(1, Math.max(0, getExtension()));
    if (moving.current) moving.current.position.z = e * stroke;
  });

  const rodLen = stroke + size.wh + plateOffset + 0.004;
  const rodGeo = cylZ(size.rod / 2, rodLen, 28);
  const guideLen = stroke + 0.08;

  const rearPort: Vec3 = [0, p / 2, zRearCap];
  const frontPort: Vec3 = [0, p / 2, zFrontCap];
  const tubeEnds = tubes ? tubes : null;

  const pusherMat = fm.plastic('#e9ebe6', 0.55);

  // reed-switch leads: along the slot, out behind the rear cap, then cable-tied to the blue tube
  const reedX = p / 2 - 0.0008;
  const reedZ = [-size.cap - 0.02, -size.cap - profileLen + 0.02];
  const behind = zRearCap - size.cap / 2 - 0.012;
  const leads = reedZ.map((z, i): Vec3[] => [
    [reedX, 0, z - 0.011],
    [reedX + 0.0006, 0.0004, (z - 0.011 + behind) / 2],
    [reedX + 0.002, -0.001 * i, behind + 0.004],
    [reedX * 0.6, p / 2 * 0.5, behind - 0.006],
  ]);
  const rearTube = (tubeEnds ? [
    [rearPort[0], rearPort[1] + 0.05, rearPort[2] - 0.01],
    [tubeEnds.rear[0], tubeEnds.rear[1] - 0.03, (rearPort[2] + tubeEnds.rear[2]) / 2],
    tubeEnds.rear,
  ] : undefined) as Vec3[] | undefined;
  const frontTube = (tubeEnds ? [
    [frontPort[0], frontPort[1] + 0.05, frontPort[2] - 0.02],
    [tubeEnds.front[0], tubeEnds.front[1] - 0.02, (frontPort[2] + tubeEnds.front[2]) / 2],
    tubeEnds.front,
  ] : undefined) as Vec3[] | undefined;
  const route: CableRoute | undefined = tubes === false ? false : undefined;

  return (
    <group position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
      {/* barrel profile */}
      <mesh geometry={profileGeo(size, profileLen)} material={fm.anodized('#c3c8cd')} position={[0, 0, -size.cap]} castShadow receiveShadow />
      <EndCap size={size} z={zFrontCap} front />
      <EndCap size={size} z={zRearCap} front={false} />
      {/* ports + push-in fittings */}
      <PushInFitting od={0.008} position={rearPort} rotation={[-Math.PI / 2, 0, 0]} collar="#2a64c8" />
      <PushInFitting od={0.008} position={frontPort} rotation={[-Math.PI / 2, 0, 0]} collar="#2a64c8" />
      {/* blue (extend) tube with the reed leads tied to it, black (retract) tube */}
      <RoutedCable
        route={route}
        path={rearTube}
        from={[rearPort[0], rearPort[1] + 0.02, rearPort[2]]}
        dir={[0, 1, 0]}
        radius={0.004}
        color="#1f5fd0"
        lead={0.02}
        companions={leads.map((l, i) => ({ lead: l, joinAt: 0.16, offset: [0.0056, (i - 0.5) * 0.004] as [number, number], radius: 0.0014, color: '#2b2d30' }))}
      />
      <RoutedCable route={route} path={frontTube} from={[frontPort[0], frontPort[1] + 0.02, frontPort[2]]} dir={[0, 1, 0]} radius={0.004} color="#1a1b1d" lead={0.02} sag={0.02} />
      {tubes === false &&
        leads.map((l, i) => <Cable key={i} radius={0.0014} color="#2b2d30" points={[...l.slice(0, 3), [reedX + 0.004, -0.004 - i * 0.003, behind - 0.004]]} />)}
      {/* reed switches in the side slot (+X face) */}
      <ReedSwitch position={[reedX, 0, reedZ[0]!]} get={getExtendedSensor} />
      <ReedSwitch position={[reedX, 0, reedZ[1]!]} get={getRetractedSensor} />
      {/* front flange (MF1) with guide bushings */}
      {useFlange && (
        <group position={[0, 0, flangeT / 2 + 0.0001]}>
          <mesh geometry={rbox(flangeW, p * 1.05, flangeT, 0.003, 2)} material={fm.aluminum(0.45)} castShadow />
          {[
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ].map(([a, b], i) => (
            <CapScrew key={i} d={size.screw} position={[a! * p * 0.37, b! * p * 0.37, flangeT / 2]} />
          ))}
          {useGuides &&
            [-1, 1].map((sx) => (
              <group key={sx} position={[sx * guideX, 0, 0]}>
                <mesh geometry={cylZ(0.013, 0.045, 28)} material={fm.aluminum(0.4)} position={[0, 0, -0.0175]} castShadow />
                <mesh geometry={cylZ(0.0145, 0.004, 28)} material={fm.aluminum(0.4)} position={[0, 0, -0.038]} />
              </group>
            ))}
        </group>
      )}
      {/* printed catalog label on the profile top */}
      <mesh position={[0, p / 2 + 0.0003, -size.cap - profileLen / 2]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} material={fm.plate(isoLabelTex(bore, stroke))}>
        <planeGeometry args={[Math.min(0.07, profileLen * 0.6), Math.min(0.07, profileLen * 0.6) * 0.1875]} />
      </mesh>
      </Merge>
      {/* moving parts */}
      <group ref={moving} userData={{ noMerge: true }}>
        <Merge>
        <mesh geometry={rodGeo} material={fm.chrome()} position={[0, 0, rodLen / 2 - stroke]} castShadow />
        {pusher ? (
          <group position={[0, 0, size.wh + plateOffset]}>
            {/* rod flange + nut */}
            <mesh geometry={cylZ(size.rod * 1.5, 0.008, 28)} material={fm.aluminum(0.4)} position={[0, 0, 0.004]} />
            <mesh geometry={hexGeo(size.rod * 1.2, 0.006)} material={fm.zinc()} position={[0, 0, -0.003]} />
            {/* UHMW pusher plate */}
            <mesh geometry={rbox(pusher[0], pusher[1], 0.015, 0.003, 2)} material={pusherMat} position={[0, 0, 0.0155]} castShadow />
            {/* guide rods */}
            {useGuides &&
              [-1, 1].map((sx) => (
                <group key={sx} position={[sx * guideX, 0, 0]}>
                  <mesh geometry={cylZ(0.006, guideLen, 20)} material={fm.chrome()} position={[0, 0, 0.008 - guideLen / 2]} castShadow />
                  <mesh geometry={cylZ(0.0065, 0.004, 16)} material={fm.zinc()} position={[0, 0, 0.006 - guideLen]} />
                  <CapScrew d={0.006} position={[0, 0, 0.023]} />
                </group>
              ))}
          </group>
        ) : (
          <group position={[0, 0, size.wh]}>
            {/* rod end: jam nut + rod eye */}
            <mesh geometry={hexGeo(size.rod * 1.2, 0.006)} material={fm.zinc()} position={[0, 0, -0.004]} />
            <mesh
              geometry={latheZ(`rodEye:${size.rod}`, [
                [0, 0],
                [size.rod * 0.7, 0],
                [size.rod * 0.7, size.rod * 0.8],
                [size.rod * 0.55, size.rod * 1.1],
                [0, size.rod * 1.1],
              ], 24)}
              material={fm.zinc()}
            />
            <mesh geometry={rbox(size.rod * 1.6, size.rod * 0.9, size.rod * 1.6, size.rod * 0.4, 2)} material={fm.zinc()} position={[0, 0, size.rod * 1.7]} />
          </group>
        )}
        </Merge>
      </group>
    </group>
  );
}
