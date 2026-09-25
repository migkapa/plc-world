/**
 * Tank-local visual effects of the `tank-process` twin (all components go inside the same group as the <Tank>).
 * (The product's temperature tint and the boiling surface are the Tank device's own: `temperatureTint`, `getBoiling`.)
 *
 *  <HeaterCue>       additive glow on the immersion heater element (visible through the liquid in the cut-away) and a
 *                    HEATING lamp on the heater terminal box.
 *  <TankFx>          inlet stream + splash, small fresnel bubbles (nucleation on the heater, everywhere when boiling),
 *                    boiling surface pops, a steam plume out of the vent while boiling (the surface steam is the Tank
 *                    device's own), overflow: stream out of the vent, a wet film running down the shell, drips onto the
 *                    skid deck, a puddle that spreads to the deck edge and then onto the floor.
 *  <LocalIndicator>  LI/TI-101 dual-line field display on the platform handrail (level, temperature, heater / mixer).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { steel, unitCylY } from '../conveyor-sort/hall';
import { Glow } from '../conveyor-sort/kit';
import type { TankProcessState } from './logic';
import { SKID, SKID_H, TL } from './layout';

// ---------------------------------------------------------------------------
// Heater cue
// ---------------------------------------------------------------------------

const N = TL.nozzles;
const heaterDir = new THREE.Vector3(...N.heater.direction).normalize();
/** Point `d` metres along the heater nozzle axis (negative = into the tank), tank coordinates. */
export const alongHeater = (d: number): Vec3 => [N.heater.position[0] + heaterDir.x * d, N.heater.position[1] + heaterDir.y * d, N.heater.position[2] + heaterDir.z * d];

export function HeaterCue({ state }: { state: TankProcessState }) {
  const glow = () => THREE.MathUtils.clamp(state.heaterGlow, 0, 1) * (state.heaterDry ? 1.4 : 1);
  const lamp = useRef<THREE.Mesh>(null);
  const lampOn = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff9a1a', emissiveIntensity: 2.6, toneMapped: false, roughness: 0.3 }), []);
  const lampOff = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6a4a1c', emissive: '#000000', roughness: 0.35 }), []);
  useEffect(
    () => () => {
      lampOn.dispose();
      lampOff.dispose();
    },
    [lampOn, lampOff],
  );
  useFrame(() => {
    if (lamp.current) lamp.current.material = state.heaterOn ? lampOn : lampOff;
  });
  const lampPos = alongHeater(0.255);
  return (
    <group>
      {/* element glow (additive, drawn after the liquid) */}
      {[-0.3, -0.47, -0.64].map((d, i) => (
        <Glow key={i} get={glow} color="#ff5a14" position={alongHeater(d)} size={0.3} intensity={1.5} grow={0} />
      ))}
      {/* HEATING lamp on the terminal box cap */}
      <mesh ref={lamp} position={lampPos} rotation={[0, Math.atan2(heaterDir.x, heaterDir.z), 0]} material={lampOff}>
        <sphereGeometry args={[0.018, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <Glow get={() => state.heaterOn} color="#ffa01a" position={[lampPos[0] + heaterDir.x * 0.02, lampPos[1], lampPos[2] + heaterDir.z * 0.02]} size={0.12} intensity={1.6} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Liquid effects
// ---------------------------------------------------------------------------

function streamMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#b9d8ea', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false, emissive: '#27465c', emissiveIntensity: 0.3 });
}

let steamSprite: THREE.CanvasTexture | null = null;
function steamTexture() {
  if (steamSprite) return steamSprite;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  steamSprite = new THREE.CanvasTexture(c);
  return steamSprite;
}

/** Streaky height texture for the overflow film (scrolled downward; drives bump + alpha). */
let filmTex: THREE.CanvasTexture | null = null;
function filmTexture() {
  if (filmTex) return filmTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 64, 256);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 90; i++) {
    const v = Math.round(90 + rnd() * 165);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.35 + rnd() * 0.4})`;
    const x = rnd() * 64;
    const w = 1 + rnd() * 3;
    const y = rnd() * 256;
    ctx.fillRect(x, y, w, 20 + rnd() * 80);
    ctx.fillRect(x, y - 256, w, 20 + rnd() * 80);
  }
  filmTex = new THREE.CanvasTexture(c);
  filmTex.wrapS = filmTex.wrapT = THREE.RepeatWrapping;
  return filmTex;
}

/** Tiny bubble material: mostly transparent, bright fresnel rim (instanced). */
function bubbleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#eef8ff') } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        vec4 wp = m * vec4(position, 1.0);
        vN = normalize(mat3(m) * normal);
        vV = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float nv = abs(dot(normalize(vN), normalize(vV)));
        float f = pow(max(1.0 - nv, 0.0), 2.0);
        float spec = pow(max(nv, 0.0), 24.0) * 0.5;
        gl_FragColor = vec4(uColor * (0.7 + spec), clamp(0.06 + 0.8 * f + spec, 0.0, 1.0));
      }`,
  });
}

const NB = 120;
const NS = 24;
const NP = 14;
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const ringGeo = new THREE.RingGeometry(0.62, 1, 24).rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);

/** Deck top in tank-group coordinates (the group sits on the skid) and the skid edge. */
const DECK_Y = SKID.deckTop - SKID_H;

export function TankFx({ state }: { state: TankProcessState }) {
  const n = TL.nozzles;
  const inlet = useRef<THREE.Mesh>(null);
  const splash = useRef<THREE.Mesh>(null);
  const bubbles = useRef<THREE.InstancedMesh>(null);
  const pops = useRef<THREE.InstancedMesh>(null);
  const steam = useRef<THREE.Points>(null);
  const spillFall = useRef<THREE.Mesh>(null);
  const sheet = useRef<THREE.Mesh>(null);
  const drip = useRef<THREE.Mesh>(null);
  const dripSplash = useRef<THREE.Mesh>(null);
  const puddle = useRef<THREE.Mesh>(null);
  const floorPuddle = useRef<THREE.Mesh>(null);
  const edgeFall = useRef<THREE.Mesh>(null);
  const puddleVol = useRef(0);
  const mats = useMemo(() => {
    const film = filmTexture();
    return {
      stream: streamMaterial(),
      sheet: new THREE.MeshStandardMaterial({
        color: '#4f86a6',
        roughness: 0.03,
        metalness: 0.2,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
        bumpMap: film,
        bumpScale: 2.2,
        alphaMap: film,
        envMapIntensity: 1.4,
      }),
      puddle: new THREE.MeshStandardMaterial({ color: '#223a4a', roughness: 0.03, metalness: 0.25, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      pop: new THREE.MeshBasicMaterial({ color: '#f2f8ff', transparent: true, opacity: 0.55, depthWrite: false }),
      bubble: bubbleMaterial(),
    };
  }, []);
  useEffect(
    () => () => {
      mats.stream.dispose();
      mats.sheet.dispose();
      mats.puddle.dispose();
      mats.pop.dispose();
      mats.bubble.dispose();
    },
    [mats],
  );

  // per-instance seeds
  const seeds = useMemo(() => Array.from({ length: NB }, (_, i) => ({ a: (i * 0.6180339) % 1, b: (i * 0.4142135) % 1, c: (i * 0.7320508) % 1 })), []);
  const steamGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3));
    return g;
  }, []);
  const steamMat = useMemo(
    () => new THREE.PointsMaterial({ map: steamTexture(), size: 0.28, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false, color: '#f4f7fa' }),
    [],
  );
  useEffect(
    () => () => {
      steamGeo.dispose();
      steamMat.dispose();
    },
    [steamGeo, steamMat],
  );

  const o = useMemo(() => new THREE.Object3D(), []);
  const inletTopY = TL.yT2 + 0.17;
  const inletX = n.inlet.position[0];
  const inletZ = n.inlet.position[2];
  const ventOut: Vec3 = [n.vent.position[0] + 0.12, n.vent.position[1] + 0.02, n.vent.position[2]];
  // film + drips at 283° (front-left, clear of the leg at 305° and outside the cut-away)
  const phiSheet = (283 * Math.PI) / 180;
  const sheetBottom = TL.yT1 - 0.05;
  const sheetTop = TL.yT2 + 0.06;
  const dripX = Math.sin(phiSheet) * (TL.radius * 0.93);
  const dripZ = Math.cos(phiSheet) * (TL.radius * 0.93);
  const dripTop = TL.yT1 - 0.1;
  const dripLen = dripTop - DECK_Y;
  // the deck puddle spreads from the drip toward the front-left skid edge, then runs over it onto the floor
  const edgeX = -SKID.w / 2;
  const floorY = -SKID_H + 0.004;

  useFrame(({ clock }, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = clock.elapsedTime;
    const surf = TL.levelY(state.level);
    // ---- inlet stream ----
    const inflow = state.inflowRate / 4.5;
    const im = inlet.current;
    if (im) {
      im.visible = inflow > 0.01;
      if (im.visible) {
        const len = Math.max(0.02, inletTopY - surf);
        const r = 0.006 + 0.016 * Math.sqrt(inflow);
        im.scale.set(r * (1 + 0.08 * Math.sin(t * 31)), len, r);
        im.position.set(inletX, inletTopY - len / 2, inletZ);
      }
    }
    const sp = splash.current;
    if (sp) {
      sp.visible = inflow > 0.01 && state.level > 0.5;
      if (sp.visible) {
        sp.position.set(inletX, surf + 0.004, inletZ);
        const k = 0.05 + 0.08 * Math.sqrt(inflow) * (1 + 0.15 * Math.sin(t * 17));
        sp.scale.set(k, k, k);
      }
    }
    // ---- bubbles: small nucleation bubbles on the heater, everywhere when boiling ----
    const bm = bubbles.current;
    if (bm) {
      const covered = state.level >= 10;
      const heating = state.heaterGlow > 0.3 && covered;
      const boil = state.boiling;
      const hot = THREE.MathUtils.clamp((state.temperature - 40) / 55, 0, 1);
      const active = boil ? NB : heating ? Math.round(NB * (0.2 + 0.45 * hot)) : 0;
      let k = 0;
      for (let i = 0; i < active; i++) {
        const s = seeds[i]!;
        let x: number;
        let y0: number;
        let z: number;
        const speed = boil ? 0.8 + s.c * 0.6 : 0.3 + s.c * 0.25;
        if (boil && i % 2 === 0) {
          const rr = 0.1 + s.a * (TL.radius - 0.15);
          const ph = s.b * Math.PI * 2;
          x = Math.sin(ph) * rr;
          z = Math.cos(ph) * rr;
          y0 = TL.yBottom + 0.12;
        } else {
          const rr = 0.12 + s.a * 0.4;
          x = n.heater.position[0] - heaterDir.x * (0.75 - rr) + (s.b - 0.5) * 0.05;
          z = n.heater.position[2] - heaterDir.z * (0.75 - rr) + (s.c - 0.5) * 0.05;
          y0 = n.heater.position[1] - 0.01;
        }
        const span = surf - y0;
        if (span < 0.03) continue;
        const u = ((t * speed) / Math.max(span, 0.2) + s.a * 7.13) % 1;
        const y = y0 + u * span;
        // skip bubbles in the cut-away wedge in front (they would float in the air)
        if (z > 0 && Math.abs(Math.atan2(x, z)) < Math.PI / 4 + 0.05 && Math.hypot(x, z) > 0.1) continue;
        const size = (boil ? 0.0055 : 0.0035) * (0.65 + s.b * 0.7) * (0.8 + u * 0.5);
        o.position.set(x + Math.sin(t * 3 + i) * 0.005, y, z);
        o.scale.setScalar(size);
        o.updateMatrix();
        bm.setMatrixAt(k++, o.matrix);
      }
      bm.count = k;
      bm.instanceMatrix.needsUpdate = true;
    }
    // ---- boiling surface: pops ----
    const pm = pops.current;
    if (pm) {
      let k = 0;
      if (state.boiling) {
        for (let i = 0; i < NP; i++) {
          const s = seeds[i + 20]!;
          const u = (t * (1.1 + s.c) + s.a * 5) % 1;
          const cyc = Math.floor(t * (1.1 + s.c) + s.a * 5);
          const ph = (s.b + cyc * 0.37) * Math.PI * 2;
          const rr = (0.15 + ((s.a + cyc * 0.29) % 1) * 0.75) * (TL.radius - 0.08);
          const x = Math.sin(ph) * rr;
          const z = Math.cos(ph) * rr;
          if (z > 0 && Math.abs(Math.atan2(x, z)) < Math.PI / 4 + 0.05) continue;
          o.position.set(x, surf + 0.006, z);
          o.scale.setScalar(0.008 + u * 0.045);
          o.updateMatrix();
          pm.setMatrixAt(k++, o.matrix);
        }
      }
      pm.count = k;
      pm.instanceMatrix.needsUpdate = true;
      mats.pop.opacity = 0.28;
    }
    // ---- steam plume out of the vent while boiling (the surface steam is the Tank device's own) ----
    const st = steam.current;
    if (st) {
      st.visible = state.boiling;
      if (st.visible) {
        const arr = steamGeo.attributes.position!.array as Float32Array;
        for (let i = 0; i < NS; i++) {
          const s = seeds[i]!;
          const u = (t * (0.25 + s.c * 0.2) + s.a) % 1;
          arr[i * 3] = ventOut[0] + (s.b - 0.5) * 0.08 + u * 0.25 * Math.sin(s.a * 6);
          arr[i * 3 + 1] = ventOut[1] + 0.05 + u * 1.1;
          arr[i * 3 + 2] = ventOut[2] + (s.c - 0.5) * 0.08 + u * 0.2;
        }
        steamGeo.attributes.position!.needsUpdate = true;
      }
    }
    // ---- overflow: vent -> film down the shell -> drips -> deck puddle -> over the skid edge -> floor ----
    const spilling = state.spillRate > 0.01;
    puddleVol.current = Math.min(2.4, Math.max(0, puddleVol.current + (spilling ? 0.5 : -0.015) * dt));
    const v = puddleVol.current;
    if (spillFall.current) {
      spillFall.current.visible = spilling;
      if (spilling) spillFall.current.scale.set(0.012 * (1 + 0.1 * Math.sin(t * 29)), SPILL_FALL, 0.012);
    }
    if (sheet.current) {
      sheet.current.visible = spilling || v > 0.9;
      const f = filmTexture();
      f.offset.y = (t * 0.9) % 1;
    }
    if (drip.current) {
      drip.current.visible = spilling;
      if (spilling) drip.current.scale.set(0.016 * (1 + 0.15 * Math.sin(t * 23)), dripLen, 0.016);
    }
    if (dripSplash.current) {
      dripSplash.current.visible = spilling;
      if (spilling) {
        const k = 0.03 + 0.02 * ((t * 5) % 1);
        dripSplash.current.scale.set(k, 1, k);
      }
    }
    // deck puddle: radius grows with the volume up to the skid edge
    const deckR = Math.min(0.9, 0.12 + Math.sqrt(v) * 0.75);
    if (puddle.current) {
      puddle.current.visible = v > 0.003;
      puddle.current.scale.set(deckR, 1, deckR * 0.8);
    }
    // once the deck puddle reaches the edge, liquid runs over it onto the floor
    const over = Math.max(0, v - 1.0);
    if (edgeFall.current) edgeFall.current.visible = spilling && over > 0.01;
    if (floorPuddle.current) {
      floorPuddle.current.visible = over > 0.003;
      const r = 0.1 + Math.sqrt(over) * 0.7;
      floorPuddle.current.scale.set(r * 0.8, 1, r);
    }
  });

  const deckPuddleX = dripX * 0.75 - 0.18;
  const deckPuddleZ = dripZ * 1.1 + 0.05;
  return (
    <group>
      <mesh ref={inlet} geometry={unitCylY} material={mats.stream} visible={false} renderOrder={3} userData={{ noOcclude: true }} />
      <mesh ref={splash} rotation={[-Math.PI / 2, 0, 0]} visible={false} material={mats.stream} renderOrder={3} userData={{ noOcclude: true }}>
        <ringGeometry args={[0.25, 1, 24]} />
      </mesh>
      <instancedMesh ref={bubbles} args={[sphereGeo, mats.bubble, NB]} frustumCulled={false} renderOrder={3} userData={{ noOcclude: true }} />
      <instancedMesh ref={pops} args={[ringGeo, mats.pop, NP]} frustumCulled={false} renderOrder={3} userData={{ noOcclude: true }} />
      <points ref={steam} geometry={steamGeo} material={steamMat} frustumCulled={false} visible={false} renderOrder={4} />
      {/* spill: vent outlet -> top head */}
      <mesh ref={spillFall} geometry={unitCylY} material={mats.stream} position={[ventOut[0], ventOut[1] - SPILL_FALL / 2, ventOut[2]]} scale={[0.012, SPILL_FALL, 0.012]} visible={false} />
      {/* wet film running down the shell (front-left, outside the cut-away) */}
      <mesh ref={sheet} position={[0, (sheetTop + sheetBottom) / 2, 0]} material={mats.sheet} visible={false} renderOrder={3} userData={{ noOcclude: true }}>
        <cylinderGeometry args={[TL.radius + 0.004, TL.radius + 0.004, sheetTop - sheetBottom, 16, 1, true, phiSheet - 0.22, 0.44]} />
      </mesh>
      {/* drips off the bottom head onto the skid deck + splash */}
      <mesh ref={drip} geometry={unitCylY} material={mats.stream} position={[dripX, DECK_Y + dripLen / 2, dripZ]} scale={[0.012, dripLen, 0.012]} visible={false} />
      <mesh ref={dripSplash} geometry={ringGeo} material={mats.pop} position={[dripX, DECK_Y + 0.006, dripZ]} visible={false} renderOrder={3} />
      {/* puddle on the checker-plate deck, then over the skid edge onto the floor */}
      <mesh ref={puddle} geometry={discGeo} material={mats.puddle} position={[deckPuddleX, DECK_Y + 0.002, deckPuddleZ]} visible={false} renderOrder={2} userData={{ noOcclude: true }} />
      <mesh ref={edgeFall} geometry={unitCylY} material={mats.stream} position={[edgeX - 0.01, (DECK_Y + floorY) / 2, deckPuddleZ]} scale={[0.02, DECK_Y - floorY, 0.08]} visible={false} />
      <mesh ref={floorPuddle} geometry={discGeo} material={mats.puddle} position={[edgeX - 0.35, floorY, deckPuddleZ]} visible={false} renderOrder={2} userData={{ noOcclude: true }} />
    </group>
  );
}

const SPILL_FALL = 0.16;

// ---------------------------------------------------------------------------
// LI/TI-101 local indicator (dual-line LED field display on the platform handrail)
// ---------------------------------------------------------------------------

function drawIndicator(ctx: CanvasRenderingContext2D, w: number, h: number, s: { level: number; temp: number; heater: boolean; mixer: boolean }) {
  ctx.fillStyle = '#0b0d0e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#9aa3a8';
  ctx.font = '700 30px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('LI / TI-101  ·  T-101', 18, 30);
  const row = (label: string, value: string, unit: string, y: number, color: string) => {
    ctx.fillStyle = '#c4ccd0';
    ctx.font = '700 34px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 18, y);
    ctx.fillStyle = color;
    ctx.font = '700 84px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(value, w - 92, y + 4);
    ctx.font = '700 40px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(unit, w - 84, y + 8);
  };
  row('LEVEL', s.level.toFixed(1), '%', 104, '#ff3b2a');
  row('TEMP', s.temp.toFixed(1), '°C', 196, '#ff3b2a');
  const pill = (x: number, label: string, on: boolean, color: string) => {
    ctx.fillStyle = on ? color : '#22282b';
    ctx.fillRect(x, 250, 214, 52);
    ctx.fillStyle = on ? '#111' : '#5b6468';
    ctx.font = '800 32px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + 107, 277);
  };
  pill(18, on(s.heater, 'HEATER ON', 'HEATER OFF'), s.heater, '#ffa31a');
  pill(w - 232, on(s.mixer, 'MIXER ON', 'MIXER OFF'), s.mixer, '#3ddc68');
}
const on = (b: boolean, a: string, c: string) => (b ? a : c);

export function LocalIndicator({ state, position, rotationY = 0 }: { state: TankProcessState; position: Vec3; rotationY?: number }) {
  const W = 512;
  const H = 320;
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const last = useRef('');
  const acc = useRef(1);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.25) return;
    acc.current = 0;
    const s = { level: state.ltReading, temp: state.ttReading, heater: state.heaterOn, mixer: state.mixerEnergized };
    const key = `${s.level.toFixed(1)}|${s.temp.toFixed(1)}|${s.heater}|${s.mixer}`;
    if (key === last.current) return;
    last.current = key;
    const ctx = (tex.image as HTMLCanvasElement).getContext('2d');
    if (!ctx) return;
    drawIndicator(ctx, W, H, s);
    tex.needsUpdate = true;
  });
  const dw = 0.3;
  const dh = (dw * H) / W;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* enclosure + sun hood */}
      <mesh material={steel('#3b4046', 0.45)} position={[0, 0, -0.04]} castShadow>
        <boxGeometry args={[dw + 0.04, dh + 0.05, 0.08]} />
      </mesh>
      <mesh material={steel('#3b4046', 0.45)} position={[0, dh / 2 + 0.03, 0.02]}>
        <boxGeometry args={[dw + 0.05, 0.006, 0.07]} />
      </mesh>
      <mesh position={[0, -0.005, 0.0006]}>
        <planeGeometry args={[dw, dh]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.9} roughness={0.4} />
      </mesh>
      {/* rail clamp brackets */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} material={steel('#9aa1a8', 0.4)} position={[sx * (dw / 2 - 0.03), -dh / 2 - 0.06, -0.06]}>
          <boxGeometry args={[0.03, 0.12, 0.012]} />
        </mesh>
      ))}
    </group>
  );
}
