/**
 * Solenoid-operated valves.
 *
 *  variant 'process'   — 3-piece stainless ball valve on a pipe with an ISO 5211 bracket, rack & pinion
 *                        pneumatic actuator, NAMUR solenoid pilot valve (coil LED) and a rotating visual
 *                        position indicator (OPEN / SHUT). Origin: pipe centerline at the valve center;
 *                        the pipe runs along X, the actuator stands up (+Y). Opening takes ~1 s.
 *  variant 'pneumatic' — 5/2 single-solenoid valve on a 4-station sub-base manifold (station 1 is the live
 *                        one) with coil LED, manual override, silencers & push-in fittings. Origin: center of
 *                        the manifold's back (mounting) face at its bottom edge; valves face +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { Led } from '../../common';
import type { SolenoidValveProps, Vec3 } from '../../contracts';
import {
  box,
  type CableRoute,
  canvasTex,
  CapScrew,
  clickable,
  cylX,
  cylY,
  cylZ,
  fm,
  hexGeo,
  latheY,
  mat,
  Merge,
  PanScrew,
  PushInFitting,
  rbox,
  RoutedCable,
  TAU,
  DEVICE_ROOT,
} from './shared';

export interface SolenoidValveExtraProps {
  /** Instrument tag shown on a stainless tag plate, e.g. 'XV-101'. */
  tag?: string;
  /** Length of pipe stubs drawn on each side of a process valve (m). 0 = only the valve ends/flanges. */
  pipeStubs?: number;
  /** Pneumatic manifold: number of valve stations (1..8). */
  stations?: number;
  /** Pneumatic manifold: extra live getters for the other stations (index 1..). */
  getStation?: (index: number) => boolean;
  /** Process: solenoid coil cable; pneumatic: multicore from the D-sub connector. Parent coordinates ('floor' = floor stub; default none). */
  cableTo?: CableRoute;
  /** Process: air supply tube to the pilot valve; pneumatic: P supply tube on the end plate. */
  tubeTo?: CableRoute;
  /** Pneumatic: working-port tubes of station 1 (A = blue, B = black), or false for none. */
  portsTo?: { a?: CableRoute; b?: CableRoute } | false;
  /** Pneumatic: station-1 manual override pushed in (only moves when someone presses it). */
  getManualOverride?: () => boolean;
  /** Pneumatic: click on the station-1 manual override button. */
  onManualOverride?: () => void;
  onClick?: () => void;
}

type RootProps = { rootRef: RefObject<THREE.Group | null> };

function tagTex(tag: string) {
  return canvasTex(`valveTag:${tag}`, 256, 96, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#c9ced2');
    g.addColorStop(0.5, '#e3e6e8');
    g.addColorStop(1, '#c4c9cd');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#23272b';
    ctx.font = '700 54px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, w / 2, h / 2 + 2);
    ctx.fillStyle = '#8a9095';
    ctx.beginPath();
    ctx.arc(14, h / 2, 7, 0, TAU);
    ctx.arc(w - 14, h / 2, 7, 0, TAU);
    ctx.fill();
  });
}

function indicatorTex() {
  return canvasTex('valveIndicator', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#16181b';
    ctx.fillRect(0, 0, w, h);
    // yellow flow arrow along U (pipe direction when open)
    ctx.fillStyle = '#f5c400';
    ctx.fillRect(28, h / 2 - 22, w - 90, 44);
    ctx.beginPath();
    ctx.moveTo(w - 70, h / 2 - 52);
    ctx.lineTo(w - 18, h / 2);
    ctx.lineTo(w - 70, h / 2 + 52);
    ctx.fill();
    ctx.font = '800 30px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#16181b';
    ctx.fillText('OPEN', w / 2 - 20, h / 2 + 1);
  });
}

// ---------------------------------------------------------------------------
// Process valve
// ---------------------------------------------------------------------------

function ProcessValve({ getEnergized, pipeDiameter = 0.0603, tag, pipeStubs = 0.12, cableTo, tubeTo, rootRef }: SolenoidValveProps & SolenoidValveExtraProps & RootProps) {
  const pr = pipeDiameter / 2;
  const s = pipeDiameter / 0.0603;
  const bodyL = 0.19 * s;
  const flangeR = pr * 2.7;
  const actW = 0.2 * s; // actuator length (X)
  const actD = 0.085 * s; // actuator depth (Z)
  const actH = 0.1 * s;
  const yBracket = pr * 1.55;
  const bracketH = 0.06 * s;
  const yAct = yBracket + bracketH + actH / 2;
  const pos = useRef(0);
  const pinion = useRef<THREE.Group>(null);
  const shutText = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    const target = getEnergized() ? 1 : 0;
    const step = Math.min(dt, 0.1) / 0.9;
    pos.current = target > pos.current ? Math.min(target, pos.current + step) : Math.max(target, pos.current - step);
    const eased = pos.current * pos.current * (3 - 2 * pos.current);
    if (pinion.current) pinion.current.rotation.y = (1 - eased) * (Math.PI / 2);
    if (shutText.current) shutText.current.visible = pos.current < 0.5;
  });

  const indicatorMat = mat('f:valveIndMat', () => new THREE.MeshStandardMaterial({ map: indicatorTex(), roughness: 0.4 }));
  const domeMat = mat('f:valveDome', () => new THREE.MeshStandardMaterial({ color: '#e8f4ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }));
  const shutMat = mat('f:valveShut', () => new THREE.MeshStandardMaterial({ color: '#d42a1c', roughness: 0.5 }));
  const actMat = fm.anodized('#aeb6bd');
  const capMat = fm.plastic('#27509a', 0.4);

  const bolts: Vec3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    bolts.push([0, Math.sin(a) * pr * 1.55, Math.cos(a) * pr * 1.55]);
  }

  return (
    <Merge>
      {/* pipe stubs with flanges */}
      {pipeStubs > 0 &&
        [-1, 1].map((sx) => (
          <mesh key={sx} geometry={cylX(pr, pipeStubs, 32)} material={fm.stainless(0.3)} position={[sx * (bodyL / 2 + 0.02 * s + pipeStubs / 2), 0, 0]} castShadow />
        ))}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * (bodyL / 2 + 0.01 * s), 0, 0]}>
          <mesh geometry={cylX(flangeR, 0.018 * s, 40)} material={fm.stainless(0.3)} castShadow />
          <mesh geometry={cylX(flangeR, 0.018 * s, 40)} material={fm.stainless(0.3)} position={[sx * 0.019 * s, 0, 0]} castShadow />
          <mesh geometry={cylX(pr * 1.25, 0.03 * s, 32)} material={fm.stainless(0.3)} position={[sx * 0.04 * s, 0, 0]} />
          {[0, 1, 2, 3].map((i) => {
            const a = Math.PI / 4 + (i * Math.PI) / 2;
            return (
              <group key={i} position={[sx * 0.0095 * s, Math.sin(a) * flangeR * 0.78, Math.cos(a) * flangeR * 0.78]}>
                <mesh geometry={cylX(0.006 * s, 0.07 * s, 12)} material={fm.zinc()} />
                <mesh geometry={hexGeo(0.019 * s, 0.01 * s)} material={fm.zinc()} position={[-0.03 * s, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
                <mesh geometry={hexGeo(0.019 * s, 0.01 * s)} material={fm.zinc()} position={[0.03 * s, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
              </group>
            );
          })}
        </group>
      ))}
      {/* 3-piece ball valve: end connectors + center body + body bolts */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} geometry={cylX(pr * 1.35, 0.045 * s, 6)} material={fm.stainless(0.28)} position={[sx * (bodyL / 2 - 0.022 * s), 0, 0]} rotation={[Math.PI / 6, 0, 0]} castShadow />
      ))}
      <mesh geometry={rbox(bodyL * 0.52, pr * 2.9, pr * 2.9, pr * 0.5, 3)} material={fm.stainless(0.28)} castShadow />
      {bolts.map((b, i) => (
        <group key={i} position={b}>
          <mesh geometry={cylX(0.0045 * s, bodyL * 0.98, 12)} material={fm.zinc()} />
          <mesh geometry={hexGeo(0.013 * s, 0.007 * s)} material={fm.zinc()} position={[bodyL * 0.49, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
          <mesh geometry={hexGeo(0.013 * s, 0.007 * s)} material={fm.zinc()} position={[-bodyL * 0.49, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
        </group>
      ))}
      {/* ISO 5211 top pad + stem + open bracket */}
      <mesh geometry={rbox(0.07 * s, 0.012 * s, 0.07 * s, 0.004, 2)} material={fm.stainless(0.3)} position={[0, yBracket - 0.006 * s, 0]} />
      <mesh geometry={cylY(0.009 * s, bracketH, 16)} material={fm.stainless(0.25)} position={[0, yBracket + bracketH / 2, 0]} />
      {[-1, 1].map((sz) => (
        <mesh key={sz} geometry={box(0.075 * s, bracketH, 0.005 * s)} material={fm.stainless(0.35)} position={[0, yBracket + bracketH / 2, sz * 0.033 * s]} castShadow />
      ))}
      <mesh geometry={box(0.09 * s, 0.006 * s, 0.075 * s)} material={fm.stainless(0.35)} position={[0, yBracket + bracketH - 0.003 * s, 0]} />
      {/* rack & pinion actuator */}
      <group position={[0, yAct, 0]}>
        <mesh geometry={rbox(actW * 0.86, actH, actD, 0.018 * s, 3)} material={actMat} castShadow receiveShadow />
        {/* extrusion grooves */}
        {[-1, 1].map((sy) => (
          <mesh key={sy} geometry={box(actW * 0.86, 0.002 * s, 0.001)} material={fm.dark()} position={[0, sy * actH * 0.3, actD / 2 + 0.0002]} />
        ))}
        {[-1, 1].map((sx) => (
          <group key={sx} position={[sx * (actW * 0.43 + 0.012 * s), 0, 0]}>
            <mesh geometry={rbox(0.024 * s, actH * 1.02, actD * 1.02, 0.01 * s, 3)} material={capMat} castShadow />
            {[
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1],
            ].map(([a, b], i) => (
              <CapScrew key={i} d={0.006 * s} position={[sx * 0.012 * s, a! * actH * 0.36, b! * actD * 0.36]} rotation={[0, (sx * Math.PI) / 2, 0]} />
            ))}
          </group>
        ))}
        {/* NAMUR interface + solenoid pilot valve on the +Z face */}
        <group position={[0.045 * s, 0, actD / 2]}>
          <mesh geometry={box(0.032 * s, 0.05 * s, 0.022 * s)} material={fm.aluminum(0.45)} position={[0, 0, 0.011 * s]} castShadow />
          <mesh geometry={rbox(0.034 * s, 0.036 * s, 0.036 * s, 0.003, 2)} material={fm.plastic('#1b1c1f', 0.45)} position={[0, 0.036 * s, 0.018 * s]} castShadow />
          {/* DIN 43650 connector with LED */}
          <mesh geometry={rbox(0.028 * s, 0.028 * s, 0.022 * s, 0.003, 2)} material={fm.plastic('#2b2d31', 0.5)} position={[0, 0.036 * s, 0.047 * s]} />
          <Led color="amber" get={getEnergized} shape="round" size={[0.006 * s, 0, 0.002]} position={[0, 0.036 * s, 0.0585 * s]} intensity={4} />
          <PanScrew d={0.003 * s} position={[0, 0.047 * s, 0.058 * s]} />
          <mesh geometry={cylY(0.006 * s, 0.012 * s, 16)} material={fm.plastic('#2b2d31', 0.5)} position={[0, 0.018 * s, 0.047 * s]} />
          <RoutedCable rootRef={rootRef} route={cableTo} from={[0, 0.012 * s, 0.047 * s]} dir={[0, -1, 0]} radius={0.0035 * s} color="#2a2b2e" lead={0.03} />
          {/* exhaust silencer + supply fitting */}
          <mesh geometry={cylX(0.005 * s, 0.018 * s, 12)} material={fm.brass()} position={[-0.025 * s, -0.012 * s, 0.012 * s]} />
          <PushInFitting od={0.006} position={[0.016 * s, -0.012 * s, 0.012 * s]} rotation={[0, Math.PI / 2, 0]} />
          <RoutedCable rootRef={rootRef} route={tubeTo} from={[0.016 * s + 0.012, -0.012 * s, 0.012 * s]} dir={[1, 0, 0]} radius={0.003} color="#1f5fd0" lead={0.025} sag={0.05} />
        </group>
        {/* visual position indicator on the pinion (rotates 90°) */}
        <mesh geometry={cylY(0.022 * s, 0.01 * s, 32)} material={fm.plastic('#1b1c1f', 0.5)} position={[0, actH / 2 + 0.005 * s, 0]} />
        <group ref={pinion} position={[0, actH / 2 + 0.012 * s, 0]} userData={{ noMerge: true }}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} material={indicatorMat}>
            <circleGeometry args={[0.03 * s, 40]} />
          </mesh>
          <mesh ref={shutText} geometry={box(0.012 * s, 0.001, 0.05 * s)} material={shutMat} position={[0, 0.0012, 0]} rotation={[0, Math.PI / 2, 0]} visible={false} />
        </group>
        <mesh geometry={latheY('valveDome', [[0.032 * s, 0], [0.032 * s, 0.01 * s], [0.026 * s, 0.022 * s], [0.012 * s, 0.028 * s], [0, 0.029 * s]], 32)} material={domeMat} position={[0, actH / 2 + 0.008 * s, 0]} />
        {/* tag plate */}
        {tag && (
          <mesh position={[-0.048 * s, -actH * 0.12, actD / 2 + 0.0015]} material={fm.plate(tagTex(tag))}>
            <planeGeometry args={[0.058 * s, 0.021 * s]} />
          </mesh>
        )}
      </group>
    </Merge>
  );
}

// ---------------------------------------------------------------------------
// Pneumatic 5/2 valve manifold
// ---------------------------------------------------------------------------

function PneumaticManifold({ getEnergized, stations = 4, getStation, cableTo, tubeTo, portsTo, getManualOverride, onManualOverride, rootRef }: SolenoidValveProps & SolenoidValveExtraProps & RootProps) {
  const pitch = 0.016;
  const n = Math.max(1, Math.min(8, stations));
  const baseL = n * pitch;
  const endW = 0.014;
  const baseH = 0.024; // along Z (out of the panel)
  const len = 0.1; // along Y (valve length)
  const y0 = 0.012;
  const x0 = -baseL / 2 + pitch / 2;
  const getters = useMemo(() => Array.from({ length: n }, (_, i) => (i === 0 ? getEnergized : () => getStation?.(i) ?? false)), [n, getEnergized, getStation]);
  const valveMat = fm.plastic('#2a2c30', 0.45);
  const override = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (override.current) override.current.position.z = 0.031 - (getManualOverride?.() ? 0.0012 : 0);
  });
  const ports = portsTo === false ? null : (portsTo ?? {});
  return (
    <Merge>
      {/* manifold base (anodized aluminum) with end plates */}
      <mesh geometry={rbox(baseL, len * 0.78, baseH, 0.002, 2)} material={fm.anodized('#a9b0b6')} position={[0, y0 + len * 0.39, baseH / 2]} castShadow receiveShadow />
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * (baseL / 2 + endW / 2), y0 + len * 0.39, baseH / 2 + 0.002]}>
          <mesh geometry={rbox(endW, len * 0.82, baseH + 0.004, 0.002, 2)} material={fm.anodized('#8e969d')} castShadow />
          {/* P (supply) fitting and exhaust silencer */}
          <PushInFitting od={0.01} position={[sx * endW / 2, 0.012, 0]} rotation={[0, (sx * Math.PI) / 2, 0]} />
          <group position={[sx * endW / 2, -0.018, 0]} rotation={[0, 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2]}>
            <mesh geometry={hexGeo(0.012, 0.004)} material={fm.brass()} position={[0, 0.002, 0]} rotation={[Math.PI / 2, 0, 0]} />
            <mesh geometry={latheY('silencer', [[0.005, 0], [0.0055, 0.004], [0.0055, 0.02], [0.004, 0.024], [0, 0.025]], 16)} material={fm.cast('#8c7f63', 0.8)} position={[0, 0.004, 0]} />
          </group>
          <CapScrew d={0.004} position={[0, len * 0.33, baseH / 2 + 0.002]} />
          <CapScrew d={0.004} position={[0, -len * 0.33, baseH / 2 + 0.002]} />
        </group>
      ))}
      {/* D-sub connector on the left end + multicore cable */}
      <mesh geometry={rbox(0.012, 0.04, 0.018, 0.002, 2)} material={fm.plastic('#3a3d42', 0.5)} position={[-(baseL / 2 + endW + 0.006), y0 + len * 0.55, 0.012]} />
      <mesh geometry={rbox(0.016, 0.036, 0.02, 0.003, 2)} material={fm.plastic('#1d1e21', 0.5)} position={[-(baseL / 2 + endW + 0.02), y0 + len * 0.55, 0.012]} />
      <RoutedCable rootRef={rootRef} route={cableTo} from={[-(baseL / 2 + endW + 0.028), y0 + len * 0.55, 0.012]} dir={[-1, 0, 0]} radius={0.0045} color="#5d6166" lead={0.02} sag={0.04} />
      {/* P supply tube (right end plate) */}
      <RoutedCable rootRef={rootRef} route={tubeTo} from={[baseL / 2 + endW + 0.024, y0 + len * 0.39 + 0.012, baseH / 2 + 0.002]} dir={[1, 0, 0]} radius={0.005} color="#1f5fd0" lead={0.02} sag={0.04} />
      {getters.map((get, i) => (
        <group key={i} position={[x0 + i * pitch, 0, baseH]}>
          {/* valve body */}
          <mesh geometry={rbox(pitch - 0.0012, len * 0.62, 0.026, 0.002, 2)} material={valveMat} position={[0, y0 + len * 0.36, 0.013]} castShadow />
          {/* solenoid pilot head with LED & manual override */}
          <mesh geometry={rbox(pitch - 0.0012, len * 0.3, 0.03, 0.002, 2)} material={fm.plastic('#1a1b1e', 0.4)} position={[0, y0 + len * 0.82, 0.015]} castShadow />
          <Led color="amber" get={get} size={[0.004, 0.006, 0.001]} position={[0, y0 + len * 0.86, 0.0305]} intensity={4} />
          <mesh
            ref={i === 0 ? override : undefined}
            geometry={cylZ(0.0026, 0.002, 16)}
            material={fm.plastic('#2f6fd6', 0.4)}
            position={[0, y0 + len * 0.74, 0.031]}
            userData={i === 0 ? { noMerge: true } : undefined}
            onPointerDown={
              i === 0 && onManualOverride
                ? (e) => {
                    e.stopPropagation();
                    onManualOverride();
                  }
                : undefined
            }
          />
          {/* A (top) / B (bottom) push-in fittings on the base underside */}
          <PushInFitting od={0.006} position={[0, y0, -baseH * 0.7]} rotation={[Math.PI / 2, 0, 0]} />
          <PushInFitting od={0.006} position={[0, y0, -baseH * 0.28]} rotation={[Math.PI / 2, 0, 0]} />
          {i === 0 && ports && (
            <>
              <RoutedCable rootRef={rootRef} route={ports.a} from={[0, y0 - 0.016, -baseH * 0.7]} dir={[0, -1, 0]} radius={0.003} color="#1f5fd0" lead={0.02} />
              <RoutedCable rootRef={rootRef} route={ports.b} from={[0, y0 - 0.016, -baseH * 0.28]} dir={[0, -1, 0]} radius={0.003} color="#1a1b1d" lead={0.02} />
            </>
          )}
        </group>
      ))}
      {/* station label strip */}
      <mesh position={[0, y0 + len * 0.08, baseH + 0.0002]}>
        <planeGeometry args={[baseL, 0.008]} />
        <meshStandardMaterial
          map={canvasTex(`manifoldLabels:${n}`, 256, 32, (ctx, w, h) => {
            ctx.fillStyle = '#e9ebe8';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#16181b';
            ctx.font = '700 20px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < n; i++) ctx.fillText(`${i + 1}`, ((i + 0.5) / n) * w, h / 2 + 1);
          })}
          roughness={0.6}
        />
      </mesh>
    </Merge>
  );
}

export function SolenoidValve(props: SolenoidValveProps & SolenoidValveExtraProps) {
  const { variant = 'process', position, rotation, scale, onClick } = props;
  const root = useRef<THREE.Group>(null);
  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      {variant === 'process' ? <ProcessValve {...props} rootRef={root} /> : <PneumaticManifold {...props} rootRef={root} />}
    </group>
  );
}
