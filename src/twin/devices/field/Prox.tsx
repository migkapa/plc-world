/**
 * 872C WorldProx-style tubular inductive proximity sensor (M18 default, M12/M30 via `diameter`).
 *
 * Origin: center of the sensing face; the barrel axis points along +Z (sensing direction) and the body runs
 * back toward -Z: PBT sensing cap → nickel-plated brass M-thread with two jam nuts & tooth lock washers →
 * 360° amber LED ring → M12 micro QD with a yellow cordset.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ProxSensorProps } from '../../contracts';
import { CABLE_YELLOW, DEVICE_ROOT, lBracketGeo, clickable, cylZ, fm, hexGeo, latheZ, M12_CORDSET_LENGTH, M12Cordset, mat, Merge, PanScrew, RoutedCable, TAU, torus, type CableRoute } from './shared';

const LED_ON = new THREE.Color('#ffcf5a');
const LED_OFF = new THREE.Color('#6b4a10');

export interface ProxExtraProps {
  /** L-bracket clamped between the jam nuts (foot extends down, -Y). */
  bracket?: boolean;
  /** Non-flush (unshielded) sensing cap protrudes from the thread. Default true. */
  nonFlush?: boolean;
  /** Where the yellow 889D cordset goes (parent coordinates); default: drops to a floor conduit stub. */
  cableTo?: CableRoute;
  onClick?: () => void;
}

export function ProxSensor872C({ getActive, diameter = 0.018, bracket = true, nonFlush = true, cableTo, onClick, position, rotation, scale }: ProxSensorProps & ProxExtraProps) {
  const root = useRef<THREE.Group>(null);
  const r = diameter / 2;
  const s = diameter / 0.018;
  const threadLen = diameter >= 0.03 ? 0.065 : diameter >= 0.018 ? 0.058 : 0.045;
  const capLen = nonFlush ? 0.006 * s : 0.0015;
  const af = diameter * 1.34;
  const nutT = 0.004 * Math.max(0.8, s * 0.9);
  const zThreadFront = -capLen;
  const zThreadBack = zThreadFront - threadLen;
  const zLed = zThreadBack - 0.004;
  const zQD = zLed - 0.0065;
  const nut1 = zThreadFront - threadLen * 0.28;
  const nut2 = nut1 - 0.0035 * s - nutT;
  const plateZ = (nut1 + nut2) / 2;
  /** Coupling face of the mated cordset: right behind the connector shoulder. */
  const zCord = zQD - 0.0012;
  // bracket: 2.5 mm sheet, 3 mm inner bend; foot bottom below the barrel
  const BT = 0.0025;
  const BR = 0.003;
  const yTan = -diameter * 0.9 - 0.012 - BT / 2 + BT + BR;

  const ledMat = mat('f:proxLed', () => new THREE.MeshStandardMaterial({ color: '#6b4a10', roughness: 0.3, transparent: true, opacity: 0.9, emissive: new THREE.Color('#ffae00'), emissiveIntensity: 0, toneMapped: false }));
  // per-instance material state is set each frame: clone so sensors light independently
  const ledInst = useMemo(() => ledMat.clone(), [ledMat]);
  useEffect(() => () => ledInst.dispose(), [ledInst]);
  useFrame(() => {
    const m = ledInst;
    const on = getActive();
    m.emissiveIntensity = on ? 3.2 : 0;
    m.color.copy(on ? LED_ON : LED_OFF);
  });

  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} userData={DEVICE_ROOT} {...clickable(onClick)}>
      <Merge>
      {/* PBT sensing face */}
      <mesh
        geometry={latheZ(`proxCap:${diameter}:${nonFlush}`, [
          [r * 0.8, -capLen - 0.001],
          [r * 0.97, -capLen - 0.001],
          [r * 0.97, -0.0008],
          [r * 0.86, 0],
          [0, 0],
        ], 32)}
        material={fm.plastic('#6f7a84', 0.45)}
        castShadow
      />
      {/* threaded nickel-plated brass barrel */}
      <mesh geometry={cylZ(r, threadLen, 36, r, true)} material={fm.nickelThread()} position={[0, 0, zThreadFront - threadLen / 2]} castShadow />
      <mesh geometry={torus(r * 0.97, 0.0005, TAU, 32)} material={fm.nickel()} position={[0, 0, zThreadFront - 0.0004]} />
      {/* engraved marking band */}
      <mesh geometry={cylZ(r * 1.002, 0.009 * s, 36, r * 1.002, true)} material={fm.nickel()} position={[0, 0, zThreadBack + 0.008 * s]} />
      {/* jam nuts + tooth lock washers */}
      {[nut1, nut2].map((z, i) => (
        <group key={i}>
          <mesh geometry={hexGeo(af, nutT)} material={fm.nickel()} position={[0, 0, z]} castShadow />
          <mesh geometry={cylZ(r * 1.38, 0.0008, 24, r * 1.38)} material={fm.zinc()} position={[0, 0, i === 0 ? z - nutT / 2 - 0.0004 : z + nutT / 2 + 0.0004]} />
        </group>
      ))}
      {/* rear: LED ring + M12 connector */}
      <mesh geometry={cylZ(r * 0.92, 0.004, 32)} material={fm.nickel()} position={[0, 0, zThreadBack - 0.002]} />
      <mesh geometry={cylZ(r * 0.9, 0.0045, 32)} material={ledInst} position={[0, 0, zLed - 0.0012]} />
      <mesh geometry={cylZ(Math.min(r * 0.8, 0.0075), 0.004, 28)} material={fm.plastic('#2a2c30', 0.45)} position={[0, 0, zQD + 0.001]} />
      {/* male M12 receptacle (thread hidden inside the mated coupling nut) */}
      <mesh geometry={cylZ(0.006, 0.008, 20)} material={fm.nickelThread()} position={[0, 0, zQD - 0.003]} />
      {/* 889D straight female cordset: coupling nut screwed onto the receptacle, body & cable continue straight back */}
      <M12Cordset position={[0, 0, zCord]} />
      <RoutedCable rootRef={root} route={cableTo} from={[0, 0, zCord - M12_CORDSET_LENGTH + 0.001]} dir={[0, 0, -1]} radius={0.0026} color={CABLE_YELLOW} lead={0.05} />
      {/* one-piece stainless L bracket (bent sheet) clamped between the jam nuts, slotted foot */}
      {bracket && (
        <group position={[0, yTan, plateZ]}>
          <mesh
            geometry={lBracketGeo(`prox:${diameter}`, {
              w: diameter * 2.1,
              up: diameter * 0.55 - yTan,
              foot: 0.032,
              t: BT,
              r: BR,
              holes: [[0, -yTan, diameter + 0.0008]],
              slots: [
                [-diameter * 0.6, 0.018, 0.009, 0.0045],
                [diameter * 0.6, 0.018, 0.009, 0.0045],
              ],
            })}
            material={fm.stainless(0.35)}
            castShadow
          />
          {[-1, 1].map((sx) => (
            <PanScrew key={sx} d={0.004} position={[sx * diameter * 0.6 + 0.0015, -BR, -(BT / 2 + BR) - 0.018]} rotation={[-Math.PI / 2, 0, 0]} />
          ))}
        </group>
      )}
      </Merge>
    </group>
  );
}
