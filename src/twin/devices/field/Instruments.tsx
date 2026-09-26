/**
 * Process instruments. Common origin: the PROCESS CONNECTION face (flange face / thread shoulder). The
 * electronics head is toward +Y, the sensor (fork, antenna, thermowell) toward −Y (into the vessel).
 * Mount on a tank with <OnNozzle nozzle={tankLayout().nozzles.lt}>…</OnNozzle>. Displays face local +Z.
 *
 *  <LevelSwitch>       vibrating-fork point level switch (compact stainless housing, LED ring, M12 plug)
 *  <LevelTransmitter>  80 GHz radar (lens/horn) or guided-wave radar (rod) with a round aluminum housing and
 *                      a live backlit LCD showing value, units, tag and a bar graph
 *  <TempTransmitter>   RTD assembly: thermowell + extension neck + round head transmitter with LCD
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { Led } from '../../common';
import type { LevelSwitchProps, TransmitterProps } from '../../contracts';
import { useDisposeOnUnmount } from '../../dispose';
import {
  type CableRoute,
  CABLE_YELLOW,
  canvasTex,
  clickable,
  cylY,
  cylZ,
  fm,
  geo,
  hexGeo,
  knurlGeo,
  latheY,
  latheZ,
  M12_CORDSET_LENGTH,
  M12Cordset,
  Merge,
  PanScrew,
  RoutedCable,
  roundRect,
  sphere,
  TAU,
  torus,
  useDisplayTexture,
  DEVICE_ROOT,
} from './shared';

type Click = {
  onClick?: () => void;
  /** Where the cable goes (parent coordinates; inside <OnNozzle> use nozzleLocal()), false = stop at the device. */
  cableTo?: CableRoute;
};


// ---------------------------------------------------------------------------
// LCD drawing
// ---------------------------------------------------------------------------

function fmt(v: number, decimals: number) {
  if (!Number.isFinite(v)) return '----';
  return v.toFixed(decimals);
}

function drawLcd(ctx: CanvasRenderingContext2D, w: number, h: number, value: number, units: string, tag: string, range: [number, number], decimals: number) {
  // backlit transflective LCD
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#d6e4dc');
  g.addColorStop(1, '#b9cbbf');
  ctx.fillStyle = '#1a1d1f';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = g;
  roundRect(ctx, 6, 6, w - 12, h - 12, 14);
  ctx.fill();
  ctx.fillStyle = '#1b2521';
  ctx.textBaseline = 'middle';
  ctx.font = '700 26px Arial, Helvetica, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(tag, 20, 30);
  ctx.textAlign = 'right';
  ctx.font = '600 22px Arial, Helvetica, sans-serif';
  ctx.fillText('PV', w - 20, 30);
  ctx.font = '700 76px "JetBrains Mono", Consolas, monospace';
  ctx.fillText(fmt(value, decimals), w - 84, h / 2 + 6);
  ctx.textAlign = 'left';
  ctx.font = '700 30px Arial, Helvetica, sans-serif';
  ctx.fillText(units, w - 78, h / 2 + 16);
  // bar graph
  const frac = Number.isFinite(value) ? THREE.MathUtils.clamp((value - range[0]) / (range[1] - range[0]), 0, 1) : 0;
  const bx = 20;
  const by = h - 40;
  const bw = w - 40;
  ctx.strokeStyle = '#1b2521';
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, 18);
  const segs = 25;
  for (let i = 0; i < Math.round(frac * segs); i++) ctx.fillRect(bx + 3 + (i * (bw - 6)) / segs, by + 3, (bw - 6) / segs - 2, 12);
}

// ---------------------------------------------------------------------------
// Vibrating fork level switch
// ---------------------------------------------------------------------------

export function LevelSwitch({ getActive, getWet, position, rotation, scale, onClick, cableTo }: LevelSwitchProps & Click) {
  const root = useRef<THREE.Group>(null);
  const ss = fm.polished();
  // tines covered by the product look wet (glossier, slightly darker) — independent of the output (N.C. / fail-safe)
  const forkMat = useMemo(() => fm.polished().clone(), []);
  useDisposeOnUnmount(forkMat);
  const wet = useRef(0);
  useFrame((_, dt) => {
    const submerged = getWet ? getWet() : getActive();
    wet.current += ((submerged ? 1 : 0) - wet.current) * Math.min(1, dt * 2);
    forkMat.roughness = 0.32 - 0.22 * wet.current;
    forkMat.color.setScalar(1 - 0.25 * wet.current).multiply(FORK_TINT);
  });
  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
        {/* process side: G1 thread + fork */}
        <mesh geometry={cylY(0.0125, 0.016, 24)} material={fm.nickelThread()} position={[0, -0.008, 0]} />
        <mesh geometry={cylY(0.012, 0.03, 24, 0.012)} material={forkMat} position={[0, -0.031, 0]} />
        {[-1, 1].map((sz) => (
          <mesh key={sz} geometry={forkTineGeo()} material={forkMat} position={[0, -0.046, sz * 0.0045]} castShadow />
        ))}
        {/* hex + housing */}
        <mesh geometry={hexGeo(0.032, 0.014)} material={fm.stainless()} position={[0, 0.007, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow />
        <mesh geometry={cylY(0.015, 0.075, 28)} material={ss} position={[0, 0.052, 0]} castShadow />
        {/* translucent top with LED ring */}
        <mesh geometry={cylY(0.0152, 0.012, 28)} material={fm.plastic('#d8dde0', 0.3)} position={[0, 0.095, 0]} />
        <Led color="green" get={() => true} size={[0.004, 0.003, 0.002]} position={[-0.006, 0.095, 0.0145]} intensity={2.5} />
        <Led color="yellow" get={getActive} size={[0.004, 0.003, 0.002]} position={[0.006, 0.095, 0.0145]} intensity={3.5} />
        <Led color="yellow" get={getActive} size={[0.004, 0.003, 0.002]} position={[0.006, 0.095, -0.0145]} intensity={3.5} />
        {/* M12 plug + cordset */}
        <mesh geometry={cylY(0.0065, 0.012, 20)} material={fm.nickelThread()} position={[0, 0.107, 0]} />
        <M12Cordset position={[0, 0.103, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <RoutedCable rootRef={root} route={cableTo} from={[0, 0.103 + M12_CORDSET_LENGTH - 0.001, 0]} dir={[0, 1, 0]} radius={0.0026} color={CABLE_YELLOW} lead={0.035} />
      </Merge>
    </group>
  );
}

const FORK_TINT = new THREE.Color('#d8dde1');

// ---------------------------------------------------------------------------
// Round aluminum transmitter head with a display window (shared by LT & TT)
// ---------------------------------------------------------------------------

function DisplayHead({
  radius,
  depth,
  getValue,
  units,
  tag,
  range,
  decimals,
  color = '#4f6f96',
  cableTo,
  rootRef,
}: {
  cableTo?: CableRoute;
  rootRef: RefObject<THREE.Object3D | null>;
  radius: number;
  depth: number;
  getValue: () => number;
  units: string;
  tag: string;
  range: [number, number];
  decimals: number;
  color?: string;
}) {
  const lcd = useDisplayTexture(512, 256, getValue, (ctx, w, h, v) => drawLcd(ctx, w, h, v, units, tag, range, decimals), Math.pow(10, -decimals));
  const body = fm.cast(color, 0.45);
  const r = radius;
  return (
    <group>
      <mesh geometry={cylZ(r, depth, 40)} material={body} position={[0, 0, -depth / 2]} castShadow />
      {/* screw-on cover with window (front) */}
      <mesh geometry={latheZ(`headCover:${r}`, [[r * 1.02, -0.012], [r * 1.02, 0.0], [r * 0.9, 0.012], [r * 0.78, 0.014]], 40)} material={body} />
      <mesh geometry={torus(r * 0.99, 0.0018, TAU, 40)} material={fm.dark()} position={[0, 0, -0.012]} />
      <mesh position={[0, 0, 0.0118]}>
        <circleGeometry args={[r * 0.78, 40]} />
        <meshStandardMaterial color="#0d1011" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.0122]}>
        <planeGeometry args={[r * 1.24, r * 0.62]} />
        <meshStandardMaterial map={lcd} emissiveMap={lcd} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.35} />
      </mesh>
      {/* glass reflection layer */}
      <mesh position={[0, 0, 0.0128]}>
        <circleGeometry args={[r * 0.78, 40]} />
        <meshPhysicalMaterial color="#ffffff" roughness={0.02} metalness={0} transparent opacity={0.08} clearcoat={1} />
      </mesh>
      {/* cable gland (left) + blanking plug (right) */}
      <group position={[-r, -r * 0.35, -depth / 2]} rotation={[0, 0, Math.PI / 2]}>
        <mesh geometry={cylY(0.009, 0.014, 20)} material={fm.nickel()} position={[0, 0.007, 0]} />
        <mesh geometry={hexGeo(0.024, 0.008)} material={fm.nickel()} position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={cylY(0.008, 0.012, 20, 0.006)} material={fm.nickel()} position={[0, 0.022, 0]} />
      </group>
      <mesh geometry={hexGeo(0.022, 0.006)} material={fm.nickel()} position={[r + 0.002, -r * 0.35, -depth / 2]} rotation={[0, Math.PI / 2, 0]} />
      <RoutedCable rootRef={rootRef} route={cableTo} from={[-r - 0.029, -r * 0.35, -depth / 2]} dir={[-1, 0, 0]} radius={0.004} color="#35383c" lead={0.02} />
      {/* ground screw + tag plate on the side */}
      <PanScrew d={0.004} position={[r * 0.7, -r * 0.72, -depth * 0.5]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh
        position={[0, r + 0.0005, -depth / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={fm.plate(
          canvasTex(`instTag:${tag}`, 256, 96, (ctx, w, h) => {
            ctx.fillStyle = '#c7cccf';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#5b6166';
            ctx.lineWidth = 4;
            ctx.strokeRect(2, 2, w - 4, h - 4);
            ctx.fillStyle = '#1b1e21';
            ctx.font = '800 50px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tag, w / 2, h / 2 + 2);
          }),
        )}
      >
        <planeGeometry args={[r * 1.1, depth * 0.55]} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Radar / guided-wave level transmitter
// ---------------------------------------------------------------------------

export interface LevelTransmitterExtraProps {
  /** 'lens' (80 GHz PTFE lens, default), 'horn' (stainless horn) or 'rod' (guided-wave radar probe). */
  antenna?: 'lens' | 'horn' | 'rod';
  /** Probe length for the rod antenna (m). */
  probeLength?: number;
  /** Display range for the bar graph. */
  range?: [number, number];
  decimals?: number;
  /** Live distance (m) from the process connection down to the product surface: the radar beam ends there. */
  getBeamLength?: () => number;
}

/** Beam half-angles: 80 GHz lens ≈ 3–4°, 26 GHz horn ≈ 8–10°. */
const BEAM_HALF: Record<'lens' | 'horn', number> = { lens: (4 * Math.PI) / 180, horn: (8 * Math.PI) / 180 };

function radarBeamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLen: { value: 1 }, uR0: { value: 0.03 }, uTan: { value: 0.07 }, uColor: { value: new THREE.Color(0.45, 0.75, 1.0) } },
    vertexShader: `
      uniform float uLen; uniform float uR0; uniform float uTan;
      varying float vT;
      varying float vRim;
      void main() {
        vT = -position.y;
        vec3 p = position;
        p.xz *= uR0 + uTan * uLen * vT;
        p.y *= uLen;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vRim = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uLen; uniform vec3 uColor;
      varying float vT;
      varying float vRim;
      void main() {
        float fade = pow(1.0 - clamp(vT, 0.0, 1.0), 0.7) * smoothstep(0.0, 0.03, vT);
        // pulses travelling from the antenna toward the surface (~2 per meter of path)
        float ph = fract(vT * uLen * 2.2 - uTime * 1.6);
        float pulse = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.08, 0.3, ph));
        float a = fade * (0.35 + 0.65 * vRim) * (0.14 + 0.5 * pulse);
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

export function LevelTransmitter({
  getValue,
  units,
  tagLabel = 'LT-101',
  antenna = 'lens',
  probeLength = 1.2,
  range = [0, 100],
  decimals = 1,
  getBeamLength,
  position,
  rotation,
  scale,
  onClick,
  cableTo,
}: TransmitterProps & LevelTransmitterExtraProps & Click) {
  const root = useRef<THREE.Group>(null);
  const ss = fm.polished();
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useMemo(() => radarBeamMaterial(), []);
  useDisposeOnUnmount(beamMat);
  const y0 = antenna === 'lens' ? -0.046 : -0.11;
  useFrame(({ clock }) => {
    const b = beam.current;
    if (!b || antenna === 'rod') return;
    const len = Math.max(0.05, (getBeamLength ? getBeamLength() : 0.9) + y0);
    const u = beamMat.uniforms;
    u.uTan!.value = Math.tan(BEAM_HALF[antenna]);
    u.uR0!.value = antenna === 'lens' ? 0.026 : 0.034;
    u.uTime!.value = clock.elapsedTime;
    u.uLen!.value = len;
  });
  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
        {/* DN80 flange with bolts */}
        <mesh geometry={cylY(0.1, 0.02, 40)} material={ss} position={[0, 0.01, 0]} castShadow />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * TAU + TAU / 16;
          return (
            <group key={i} position={[Math.cos(a) * 0.08, 0.02, Math.sin(a) * 0.08]}>
              <mesh geometry={hexGeo(0.024, 0.013)} material={fm.zinc()} position={[0, 0.0065, 0]} rotation={[Math.PI / 2, 0, 0]} />
              <mesh geometry={cylY(0.008, 0.022, 10)} material={fm.zinc()} position={[0, 0.012, 0]} />
            </group>
          );
        })}
        {/* process adapter & neck */}
        <mesh geometry={cylY(0.03, 0.05, 28)} material={ss} position={[0, 0.045, 0]} />
        <mesh geometry={hexGeo(0.05, 0.02)} material={ss} position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={cylY(0.022, 0.04, 24)} material={ss} position={[0, 0.108, 0]} />
        {/* housing */}
        <group position={[0, 0.19, 0.0]}>
          <mesh geometry={cylY(0.052, 0.045, 32, 0.048)} material={fm.cast('#4f6f96', 0.45)} position={[0, -0.045, -0.035]} />
          <group position={[0, 0, 0.02]}>
            <DisplayHead radius={0.062} depth={0.1} getValue={getValue} units={units} tag={tagLabel} range={range} decimals={decimals} cableTo={cableTo} rootRef={root} />
          </group>
        </group>
        {/* antenna (inside the vessel) */}
        {antenna === 'lens' && (
          <group>
            <mesh geometry={cylY(0.036, 0.03, 32)} material={ss} position={[0, -0.015, 0]} />
            <mesh geometry={latheY('radarLens', [[0.034, 0], [0.034, 0.006], [0.02, 0.014], [0, 0.016]], 32)} material={fm.plastic('#ece8dc', 0.35)} position={[0, -0.03, 0]} rotation={[Math.PI, 0, 0]} />
          </group>
        )}
        {antenna === 'horn' && <mesh geometry={cylY(0.037, 0.11, 32, 0.02, true)} material={ss} position={[0, -0.055, 0]} castShadow />}
        {antenna === 'rod' && (
          <group>
            <mesh geometry={cylY(0.014, 0.05, 20)} material={fm.plastic('#ece8dc', 0.4)} position={[0, -0.025, 0]} />
            <mesh geometry={cylY(0.004, probeLength, 12)} material={ss} position={[0, -probeLength / 2 - 0.05, 0]} />
            <mesh geometry={cylY(0.009, 0.03, 12)} material={ss} position={[0, -probeLength - 0.05, 0]} />
          </group>
        )}
      </Merge>
      {/* narrow radar beam (fades with distance, pulses travel to the surface) */}
      {antenna !== 'rod' && <mesh ref={beam} position={[0, y0, 0]} geometry={beamCone()} material={beamMat} renderOrder={4} frustumCulled={false} userData={{ noMerge: true }} raycast={() => {}} />}
    </group>
  );
}

/** Flat fork tine (paddle) hanging down from the origin, thickness along Z. */
function forkTineGeo() {
  return geo('forkTine', () => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.004, 0);
    sh.lineTo(0.004, 0);
    sh.lineTo(0.006, -0.018);
    sh.lineTo(0.006, -0.036);
    sh.quadraticCurveTo(0.006, -0.041, 0.0, -0.041);
    sh.quadraticCurveTo(-0.006, -0.041, -0.006, -0.036);
    sh.lineTo(-0.006, -0.018);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.0018, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -0.0009);
    return g;
  });
}

/** Unit open tube y ∈ [−1, 0]; the vertex shader widens it into the beam cone (no base disc). */
function beamCone() {
  return geo('radarBeamCone', () => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 32, 12, true);
    g.translate(0, -0.5, 0);
    return g;
  });
}

// ---------------------------------------------------------------------------
// RTD temperature transmitter assembly
// ---------------------------------------------------------------------------

export interface TempTransmitterExtraProps {
  /** Thermowell insertion length (m). */
  insertion?: number;
  range?: [number, number];
  decimals?: number;
}

export function TempTransmitter({
  getValue,
  units,
  tagLabel = 'TT-101',
  insertion = 0.22,
  range = [0, 150],
  decimals = 1,
  position,
  rotation,
  scale,
  onClick,
  cableTo,
}: TransmitterProps & TempTransmitterExtraProps & Click) {
  const root = useRef<THREE.Group>(null);
  const ss = fm.polished();
  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
      {/* small flange / thermowell */}
      <mesh geometry={cylY(0.045, 0.014, 32)} material={ss} position={[0, 0.007, 0]} castShadow />
      {Array.from({ length: 4 }, (_, i) => {
        const a = (i / 4) * TAU + TAU / 8;
        return <mesh key={i} geometry={hexGeo(0.017, 0.009)} material={fm.zinc()} position={[Math.cos(a) * 0.034, 0.0185, Math.sin(a) * 0.034]} rotation={[Math.PI / 2, 0, 0]} />;
      })}
      <mesh geometry={cylY(0.0075, insertion, 16, 0.006)} material={ss} position={[0, -insertion / 2, 0]} castShadow />
      <mesh geometry={sphere(0.006, 10)} material={ss} position={[0, -insertion, 0]} />
      {/* extension neck: hex, nipple, union */}
      <mesh geometry={hexGeo(0.022, 0.012)} material={ss} position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={cylY(0.0085, 0.07, 16)} material={ss} position={[0, 0.06, 0]} />
      <mesh geometry={knurlGeo(0.014, 0.018, 6)} material={ss} position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={cylY(0.0085, 0.03, 16)} material={ss} position={[0, 0.103, 0]} />
      {/* head */}
      <group position={[0, 0.16, 0.01]}>
        <mesh geometry={cylY(0.02, 0.02, 20)} material={fm.cast('#9aa2aa', 0.45)} position={[0, -0.045, -0.03]} />
        <DisplayHead radius={0.045} depth={0.065} getValue={getValue} units={units} tag={tagLabel} range={range} decimals={decimals} color="#9aa2aa" cableTo={cableTo} rootRef={root} />
      </group>
      </Merge>
    </group>
  );
}
