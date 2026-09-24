/**
 * `trainer` 3D view — a PLC training lab: sturdy steel bench with a sloped input console (8 toggles,
 * 4 × 800F push buttons, 2 potentiometers) and an upright frame carrying an open control cabinet with the
 * live 1756-A7 ControlLogix rack (breakers, 24 V supply, DIN rails, 1492 terminals, ducts, wiring) and an
 * output panel (8 pilot lights, analog meter, LED bar graph, buzzer). A laptop is patched to the EN2T.
 *
 * Coordinates: world meters; bench centered at x = 0, its back against the wall at z = -0.62,
 * worktop surface at y = 0.80. The view never ticks the runtime; it only reads state in useFrame.
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import {
  AnalogMeter,
  CircuitBreaker1489,
  ControlLogixRack,
  controlLogixChassisLayout,
  DIN_RAIL,
  DinRail,
  Enclosure,
  LedBarGraph,
  PilotLight800F,
  Potentiometer,
  PowerSupply1606,
  PushButton800F,
  TB_COLORS,
  TB1492_J3,
  TerminalBlocks1492,
  terminalX,
  ToggleSwitch,
  WireBundle,
  WireDuct,
  Wires,
} from '../../../twin/devices';
import { rackLiveFromController } from '../../../twin/live';
import type { SceneViewProps } from '../../types';
import type { TrainerState } from './logic';
import {
  FONT,
  Instances,
  IoTag,
  KBOX,
  KCYL,
  KPLANE,
  MONO,
  Slab,
  TagLayer,
  Tube,
  canvasTexture,
  ioLine,
  kgeo,
  km,
  kmat,
  panelTexture,
  roundRectPath,
  textLine,
  useControls,
  useSfxLoops,
} from './kit';
import { LabRoom, ROOM, ROOM_OCCLUDERS } from './Room';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const TOP = 0.8;
const BENCH = { x0: -1.1, x1: 1.1, z0: -0.62, z1: 0.16 } as const;
const UPRIGHT = { x0: -1.05, x1: 0.75, z: -0.605, y1: 2.06 } as const;
/** Cabinet: Enclosure origin (back-bottom-center) and size. */
export const CAB = { pos: [-0.65, 1.05, UPRIGHT.z] as Vec3, size: [0.7, 0.8, 0.24] as Vec3 };
/** Output panel center (front surface) and size. */
const OUT = { c: [0.28, 1.47, UPRIGHT.z + 0.025] as Vec3, w: 0.72, h: 0.5 };
/** Sloped input console. */
const CON = { cx: -0.28, w: 1.34, zBack: -0.27, zFront: 0.05, hFront: 0.05, rise: 0.22 };
const CON_DEPTH = CON.zFront - CON.zBack;
const CON_ALPHA = Math.atan2(CON.rise, CON_DEPTH);
const CON_LEN = Math.hypot(CON.rise, CON_DEPTH);
const FACE_POS: Vec3 = [CON.cx, TOP + CON.hFront + CON.rise / 2, (CON.zBack + CON.zFront) / 2];
const FACE_ROT: Vec3 = [-(Math.PI / 2 - CON_ALPHA), 0, 0];
/** Panel-mounted devices sit on the front sheet surface. */
const DZ = 0.003;

const PANEL_BG = '#27303a';
const INK = '#eef2f5';

// Console face (local): toggles, push buttons, pots
const SW_X = (i: number) => -0.6 + i * 0.056;
const SW_Y = 0.035;
const PB = [
  { id: 'pb_green', alias: 'PB_Green', color: 'green', style: 'flush', legend: 'PB GREEN', contact: 'N.O.', x: -0.13, addr: 'I.Data.8' },
  { id: 'pb_red', alias: 'PB_Red', color: 'red', style: 'extended', legend: 'PB RED', contact: 'N.C.', x: -0.063, addr: 'I.Data.9' },
  { id: 'pb_black1', alias: 'PB_Black_1', color: 'black', style: 'flush', legend: 'PB BLK 1', contact: 'N.O.', x: 0.004, addr: 'I.Data.10' },
  { id: 'pb_black2', alias: 'PB_Black_2', color: 'black', style: 'flush', legend: 'PB BLK 2', contact: 'N.O.', x: 0.071, addr: 'I.Data.11' },
] as const;
const PB_Y = 0.02;
const POT_X = [0.215, 0.315];
const POT_Y = 0.03;

// Output panel (local, origin = panel center)
const LIGHT_COLORS = ['green', 'green', 'amber', 'amber', 'red', 'red', 'blue', 'blue'] as const;
const LIGHT_X = (i: number) => -0.2625 + i * 0.075;
const LIGHT_Y = 0.105;
const METER_P: Vec3 = [-0.225, -0.115, DZ];
const BAR_P: Vec3 = [-0.06, -0.115, DZ];
const BUZ_P: Vec3 = [0.205, -0.11, DZ];

// ---------------------------------------------------------------------------
// Silk-screen textures
// ---------------------------------------------------------------------------

function brushed(ctx: CanvasRenderingContext2D, w: number, h: number, seed = 1) {
  let s = seed * 9301;
  for (let i = 0; i < h; i += 2) {
    s = (s * 9301 + 49297) % 233280;
    ctx.fillStyle = `rgba(255,255,255,${0.008 + (s / 233280) * 0.018})`;
    ctx.fillRect(0, i, w, 1);
  }
}

function consoleFaceTexture() {
  const W = CON.w;
  const H = CON_LEN;
  return panelTexture('trainer-console', W, H, 1400, (ctx, m, w, h) => {
    const X = (x: number) => m(x + W / 2);
    const Y = (y: number) => m(H / 2 - y);
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, w, h);
    brushed(ctx, w, h, 3);
    ctx.strokeStyle = 'rgba(238,242,245,0.75)';
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const box = (x0: number, x1: number, y0: number, y1: number) => {
      ctx.lineWidth = 3;
      roundRectPath(ctx, X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1), m(0.008));
      ctx.stroke();
    };
    const heading = (text: string, x0: number, x1: number, y: number) => {
      ctx.font = `700 ${m(0.0115)}px ${FONT}`;
      const tw = ctx.measureText(text).width + m(0.012);
      const cx = (X(x0) + X(x1)) / 2;
      ctx.fillStyle = PANEL_BG;
      ctx.fillRect(cx - tw / 2, Y(y) - m(0.008), tw, m(0.016));
      ctx.fillStyle = INK;
      ctx.fillText(text, cx, Y(y));
    };
    // digital input group
    box(-0.645, 0.11, -0.085, 0.115);
    heading('DIGITAL INPUTS  ·  1756-IB16  ·  SLOT 1', -0.645, 0.11, 0.115);
    ctx.strokeStyle = 'rgba(238,242,245,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(-0.17), Y(0.09));
    ctx.lineTo(X(-0.17), Y(-0.07));
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      ctx.font = `700 ${m(0.0082)}px ${FONT}`;
      ctx.fillText(`Switch_${i}`, X(SW_X(i)), Y(-0.03));
      ctx.font = `500 ${m(0.0066)}px ${MONO}`;
      ctx.fillStyle = 'rgba(238,242,245,0.7)';
      ctx.fillText(`I.Data.${i}`, X(SW_X(i)), Y(-0.045));
      ctx.fillStyle = INK;
    }
    ctx.font = `600 ${m(0.0075)}px ${FONT}`;
    ctx.fillText('MAINTAINED  ·  UP = ON = 1', X(-0.404), Y(-0.068));
    for (const b of PB) {
      ctx.font = `700 ${m(0.0078)}px ${FONT}`;
      ctx.fillText(b.alias, X(b.x), Y(-0.03));
      ctx.font = `500 ${m(0.0064)}px ${MONO}`;
      ctx.fillStyle = b.contact === 'N.C.' ? '#ffb4b4' : 'rgba(238,242,245,0.7)';
      ctx.fillText(`${b.addr} · ${b.contact}`, X(b.x), Y(-0.045));
      ctx.fillStyle = INK;
    }
    ctx.font = `600 ${m(0.0075)}px ${FONT}`;
    ctx.fillText('MOMENTARY', X(-0.03), Y(-0.068));
    // analog input group
    box(0.15, 0.38, -0.085, 0.115);
    heading('ANALOG IN  ·  1756-IF8  ·  SLOT 3', 0.15, 0.38, 0.115);
    POT_X.forEach((x, i) => {
      ctx.font = `700 ${m(0.0082)}px ${FONT}`;
      ctx.fillText(`Pot_${i + 1}`, X(x), Y(-0.045));
      ctx.font = `500 ${m(0.0066)}px ${MONO}`;
      ctx.fillStyle = 'rgba(238,242,245,0.7)';
      ctx.fillText(`I.Ch${i}Data`, X(x), Y(-0.06));
      ctx.fillStyle = INK;
    });
    // brand block
    ctx.textAlign = 'left';
    ctx.font = `800 ${m(0.02)}px ${FONT}`;
    ctx.fillText('TR-1756', X(0.43), Y(0.07));
    ctx.font = `600 ${m(0.0095)}px ${FONT}`;
    ctx.fillStyle = 'rgba(238,242,245,0.8)';
    ctx.fillText('LOGIX PLC TRAINER', X(0.43), Y(0.04));
    ctx.font = `500 ${m(0.0072)}px ${FONT}`;
    ctx.fillText('24 V DC I/O  ·  120 V AC supply', X(0.43), Y(0.018));
    ctx.fillText('Key switch: controller, slot 0', X(0.43), Y(0.002));
    ctx.fillStyle = '#e0252b';
    ctx.fillRect(X(0.43), Y(0.095), m(0.05), m(0.003));
    // front edge label strip
    ctx.fillStyle = 'rgba(238,242,245,0.55)';
    ctx.font = `500 ${m(0.0065)}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('INPUT CONSOLE  ·  +24 V COMMON  ·  SINKING INPUTS', X(-0.25), Y(-0.15));
  });
}

function outputPanelTexture() {
  const W = OUT.w;
  const H = OUT.h;
  return panelTexture('trainer-outputs', W, H, 1400, (ctx, m, w, h) => {
    const X = (x: number) => m(x + W / 2);
    const Y = (y: number) => m(H / 2 - y);
    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, w, h);
    brushed(ctx, w, h, 7);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const box = (x0: number, x1: number, y0: number, y1: number, title: string) => {
      ctx.strokeStyle = 'rgba(238,242,245,0.75)';
      ctx.lineWidth = 3;
      roundRectPath(ctx, X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1), m(0.008));
      ctx.stroke();
      ctx.font = `700 ${m(0.0125)}px ${FONT}`;
      const tw = ctx.measureText(title).width + m(0.014);
      const cx = (X(x0) + X(x1)) / 2;
      ctx.fillStyle = PANEL_BG;
      ctx.fillRect(cx - tw / 2, Y(y1) - m(0.009), tw, m(0.018));
      ctx.fillStyle = INK;
      ctx.fillText(title, cx, Y(y1));
    };
    box(-0.335, 0.335, 0.02, 0.205, 'DIGITAL OUTPUTS  ·  1756-OB16E  ·  SLOT 2');
    for (let i = 0; i < 8; i++) {
      ctx.font = `700 ${m(0.0078)}px ${FONT}`;
      ctx.fillText(`Light_${i}`, X(LIGHT_X(i)), Y(0.058));
      ctx.font = `500 ${m(0.0062)}px ${MONO}`;
      ctx.fillStyle = 'rgba(238,242,245,0.7)';
      ctx.fillText(`O.Data.${i}`, X(LIGHT_X(i)), Y(0.043));
      ctx.fillStyle = INK;
    }
    box(-0.335, 0.075, -0.225, -0.02, 'ANALOG OUT  ·  1756-OF8  ·  SLOT 4');
    ctx.font = `700 ${m(0.0085)}px ${FONT}`;
    ctx.fillText('Meter_1', X(METER_P[0]), Y(-0.172));
    ctx.fillText('Meter_2', X(BAR_P[0] + 0.052), Y(-0.1));
    ctx.font = `500 ${m(0.0064)}px ${MONO}`;
    ctx.fillStyle = 'rgba(238,242,245,0.7)';
    ctx.fillText('O.Ch0Data · 0-100 %', X(METER_P[0]), Y(-0.188));
    ctx.fillText('O.Ch1Data', X(BAR_P[0] + 0.052), Y(-0.116));
    ctx.fillStyle = INK;
    box(0.105, 0.335, -0.225, -0.02, 'AUDIBLE  ·  SLOT 2');
    ctx.font = `700 ${m(0.0085)}px ${FONT}`;
    ctx.fillText('Buzzer', X(BUZ_P[0]), Y(-0.158));
    ctx.font = `500 ${m(0.0064)}px ${MONO}`;
    ctx.fillStyle = 'rgba(238,242,245,0.7)';
    ctx.fillText('O.Data.8 · 24 V DC', X(BUZ_P[0]), Y(-0.174));
  });
}

// ---------------------------------------------------------------------------
// Small local devices
// ---------------------------------------------------------------------------

/** 30 mm panel-mount piezo buzzer with a status LED; vibrates while sounding. */
function PanelBuzzer({ getOn, getPhase, position }: { getOn: () => boolean; getPhase: () => number; position: Vec3 }) {
  const body = useRef<THREE.Group>(null);
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const on = getOn();
    if (body.current) body.current.position.z = on ? Math.sin(getPhase() + clock.elapsedTime * 90) * 0.00025 : 0;
    if (led.current) led.current.emissiveIntensity = on ? 4 : 0;
  });
  const holes = useMemo(() => {
    const out: { p: Vec3 }[] = [{ p: [0, 0, 0.0142] }];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      out.push({ p: [Math.cos(a) * 0.006, Math.sin(a) * 0.006, 0.0142] });
    }
    return out;
  }, []);
  return (
    <group position={position}>
      {/* hex nut + bezel ring */}
      <mesh geometry={kgeo('buz-nut', () => new THREE.CylinderGeometry(0.019, 0.019, 0.003, 6).rotateX(Math.PI / 2))} material={km.metal('#b9bdc1', 0.35)} position={[0, 0, 0.0015]} />
      <group ref={body}>
        <mesh geometry={kgeo('buz-body', () => new THREE.CylinderGeometry(0.0155, 0.016, 0.011, 40).rotateX(Math.PI / 2))} material={km.plastic('#141517', 0.45)} position={[0, 0, 0.0085]} castShadow />
        <mesh geometry={kgeo('buz-top', () => new THREE.CylinderGeometry(0.0135, 0.0155, 0.002, 40).rotateX(Math.PI / 2))} material={km.plastic('#1d1f22', 0.35)} position={[0, 0, 0.0148]} />
        <Instances geometry={kgeo('buz-hole', () => new THREE.CylinderGeometry(0.0011, 0.0011, 0.0006, 10).rotateX(Math.PI / 2))} material={km.basic('#050505')} items={holes} castShadow={false} receiveShadow={false} />
        <mesh position={[0.0095, 0.0095, 0.012]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0018, 0.0018, 0.002, 12]} />
          <meshStandardMaterial ref={led} color="#ff3a2a" emissive="#ff3a2a" emissiveIntensity={0} toneMapped={false} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

function laptopScreenTexture() {
  return canvasTexture('trainer-laptop', 1024, 640, (ctx, w, h) => {
    ctx.fillStyle = '#e9edf2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2f3b4a';
    ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = '#dfe6ee';
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText('Logix Designer - TR1756 [1756-L85E]  ·  Rem Run  ·  Online', 14, 23);
    ctx.fillStyle = '#d4dbe3';
    ctx.fillRect(0, 34, w, 30);
    ctx.fillStyle = '#16a34a';
    ctx.fillRect(12, 42, 90, 16);
    ctx.fillStyle = '#fff';
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText('REM RUN', 28, 55);
    // organizer
    ctx.fillStyle = '#f6f8fa';
    ctx.fillRect(0, 64, 230, h - 64);
    ctx.fillStyle = '#334155';
    ctx.font = `500 14px ${FONT}`;
    ['Controller TR1756', '  Controller Tags', 'Tasks', '  MainTask', '    MainProgram', '      MainRoutine', 'I/O Configuration', '  1756 Backplane', '   [0] 1756-L85E', '   [1] 1756-IB16', '   [2] 1756-OB16E', '   [3] 1756-IF8', '   [4] 1756-OF8', '   [5] 1756-EN2T'].forEach((t, i) =>
      ctx.fillText(t, 10, 92 + i * 24),
    );
    // ladder
    const L = 270;
    const R = w - 30;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(240, 70, w - 250, h - 80);
    ctx.lineWidth = 3;
    for (let r = 0; r < 5; r++) {
      const y = 120 + r * 100;
      const on = r % 2 === 0;
      ctx.strokeStyle = '#16a34a';
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(L + 70, y);
      ctx.stroke();
      ctx.strokeStyle = on ? '#16a34a' : '#1f2937';
      ctx.beginPath();
      ctx.moveTo(L + 100, y);
      ctx.lineTo(R - 110, y);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(L + 70, y - 18);
      ctx.lineTo(L + 70, y + 18);
      ctx.moveTo(L + 100, y - 18);
      ctx.lineTo(L + 100, y + 18);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(R - 90, y, 18, Math.PI * 0.6, Math.PI * 1.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(R - 60, y, 18, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.fillStyle = '#1f2937';
      ctx.font = `500 13px ${MONO}`;
      ctx.fillText(`Switch_${r}`, L + 50, y - 26);
      ctx.fillText(`Light_${r}`, R - 100, y - 26);
      ctx.fillText(String(r), 248, y + 5);
    }
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(L, 80);
    ctx.lineTo(L, h - 20);
    ctx.stroke();
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.moveTo(R, 80);
    ctx.lineTo(R, h - 20);
    ctx.stroke();
  });
}

function Laptop({ position, rotation }: { position: Vec3; rotation: Vec3 }) {
  const screen = kmat(
    'trainer-laptop-screen',
    () => new THREE.MeshStandardMaterial({ map: laptopScreenTexture(), emissiveMap: laptopScreenTexture(), color: '#6d7278', emissive: '#ffffff', emissiveIntensity: 0.42, roughness: 0.2 }),
  );
  const shell = km.paint('#2b2f35', 0.4, 0.5);
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={KBOX()} material={shell} scale={[0.34, 0.018, 0.235]} position={[0, 0.009, 0]} castShadow receiveShadow />
      <mesh geometry={KPLANE()} material={km.plastic('#15171a', 0.6)} rotation={[-Math.PI / 2, 0, 0]} scale={[0.3, 0.11, 1]} position={[0, 0.0182, -0.025]} />
      <mesh geometry={KPLANE()} material={km.plastic('#1d2024', 0.5)} rotation={[-Math.PI / 2, 0, 0]} scale={[0.1, 0.06, 1]} position={[0, 0.0182, 0.075]} />
      <group position={[0, 0.018, -0.115]} rotation={[-0.3, 0, 0]}>
        <mesh geometry={KBOX()} material={shell} scale={[0.34, 0.225, 0.007]} position={[0, 0.1125, -0.0035]} castShadow />
        <mesh geometry={KPLANE()} material={screen} scale={[0.315, 0.197, 1]} position={[0, 0.115, 0.0002]} />
      </group>
    </group>
  );
}

/** Hand tools hanging on the pegboard between the cabinet and the output panel. */
function PegboardTools() {
  const z = UPRIGHT.z - 0.008;
  const hook = km.metal('#c9cdd1', 0.3);
  const hooks = useMemo(
    () =>
      [
        [-0.25, 1.83],
        [-0.215, 1.83],
        [-0.18, 1.83],
        [-0.145, 1.83],
        [-0.2, 1.55],
        [-0.14, 1.55],
        [0.66, 1.84],
        [0.7, 1.84],
      ].map(([x, y]) => ({ p: [x!, y!, z + 0.02] as Vec3, r: [Math.PI / 2, 0, 0] as Vec3, s: [0.003, 0.04, 0.003] as Vec3 })),
    [],
  );
  return (
    <group>
      <Instances geometry={KCYL()} material={hook} items={hooks} castShadow={false} />
      {/* screwdrivers */}
      {[
        [-0.25, '#d62828'],
        [-0.215, '#f4c20d'],
        [-0.18, '#1f5aa6'],
        [-0.145, '#d62828'],
      ].map(([x, c], i) => (
        <group key={i} position={[Number(x), 1.83, z + 0.025]}>
          <mesh geometry={KCYL()} material={km.plastic(String(c), 0.35)} scale={[0.02, 0.1, 0.02]} position={[0, -0.06, 0]} castShadow />
          <mesh geometry={KCYL()} material={km.metal('#d9dcdf', 0.25)} scale={[0.005, 0.1 + i * 0.02, 0.005]} position={[0, -0.16 - i * 0.01, 0]} castShadow />
        </group>
      ))}
      {/* multimeter on a hook */}
      <group position={[-0.17, 1.44, z + 0.03]} rotation={[0.06, 0, 0]}>
        <mesh geometry={KBOX()} material={km.plastic('#f2b705', 0.55)} scale={[0.09, 0.18, 0.045]} castShadow />
        <mesh geometry={KBOX()} material={km.plastic('#1d1f22', 0.5)} scale={[0.075, 0.16, 0.004]} position={[0, -0.005, 0.0235]} />
        <mesh geometry={KBOX()} material={km.paint('#a9b8a3', 0.3)} scale={[0.06, 0.035, 0.002]} position={[0, 0.045, 0.026]} />
        <mesh geometry={KCYL()} material={km.plastic('#2b2d30', 0.5)} rotation={[Math.PI / 2, 0, 0]} scale={[0.04, 0.008, 0.04]} position={[0, -0.02, 0.028]} />
        {[-0.022, 0, 0.022].map((x, i) => (
          <mesh key={x} geometry={KCYL()} material={km.plastic(i === 0 ? '#c62828' : '#111', 0.4)} rotation={[Math.PI / 2, 0, 0]} scale={[0.008, 0.006, 0.008]} position={[x, -0.068, 0.027]} />
        ))}
      </group>
      {/* test leads hanging */}
      <Tube points={[[-0.192, 1.37, z + 0.055], [-0.2, 1.3, z + 0.03], [-0.22, 1.2, z + 0.02], [-0.24, 1.14, z + 0.015]]} radius={0.0022} bend={0.04} material={km.plastic('#c62828', 0.5)} castShadow={false} />
      <Tube points={[[-0.17, 1.37, z + 0.055], [-0.165, 1.28, z + 0.03], [-0.15, 1.18, z + 0.02], [-0.135, 1.12, z + 0.015]]} radius={0.0022} bend={0.04} material={km.plastic('#16181a', 0.5)} castShadow={false} />
      {/* wire stripper */}
      <group position={[0.68, 1.8, z + 0.02]} rotation={[0, 0, 0.08]}>
        <mesh geometry={KBOX()} material={km.metal('#8f969c', 0.35)} scale={[0.025, 0.07, 0.01]} castShadow />
        {[-1, 1].map((sx) => (
          <mesh key={sx} geometry={KBOX()} material={km.plastic('#e35d12', 0.5)} scale={[0.014, 0.1, 0.014]} position={[sx * 0.012, -0.08, 0]} rotation={[0, 0, sx * 0.08]} castShadow />
        ))}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Bench structure
// ---------------------------------------------------------------------------

function consoleGeo() {
  return kgeo('trainer-console-body', () => {
    const s = new THREE.Shape();
    const d = CON_DEPTH;
    s.moveTo(-CON.zFront, 0);
    s.lineTo(-CON.zFront, CON.hFront);
    s.lineTo(-CON.zFront + d, CON.hFront + CON.rise);
    s.lineTo(-CON.zFront + d, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: CON.w, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(-CON.w / 2, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}

function Bench() {
  const frame = km.paint('#3d556e', 0.45, 0.35);
  const top = km.paint('#b9bec1', 0.55, 0.02);
  const extr = km.metal('#c3c8cc', 0.32);
  const legs = useMemo(
    () =>
      [
        [BENCH.x0 + 0.04, BENCH.z0 + 0.04],
        [BENCH.x1 - 0.04, BENCH.z0 + 0.04],
        [BENCH.x0 + 0.04, BENCH.z1 - 0.04],
        [BENCH.x1 - 0.04, BENCH.z1 - 0.04],
      ].map(([x, z]) => ({ p: [x!, (TOP - 0.035) / 2, z!] as Vec3, s: [0.05, TOP - 0.035, 0.05] as Vec3 })),
    [],
  );
  const drawerX0 = 0.52;
  return (
    <group>
      <Instances geometry={KBOX()} material={frame} items={legs} />
      {/* aprons + stretchers */}
      <Slab min={[BENCH.x0 + 0.02, TOP - 0.13, BENCH.z1 - 0.07]} max={[BENCH.x1 - 0.02, TOP - 0.035, BENCH.z1 - 0.02]} material={frame} castShadow />
      <Slab min={[BENCH.x0 + 0.02, TOP - 0.13, BENCH.z0 + 0.02]} max={[BENCH.x1 - 0.02, TOP - 0.035, BENCH.z0 + 0.07]} material={frame} />
      <Slab min={[BENCH.x0 + 0.02, 0.14, BENCH.z0 + 0.02]} max={[BENCH.x1 - 0.02, 0.19, BENCH.z0 + 0.07]} material={frame} />
      {/* lower shelf */}
      <Slab min={[BENCH.x0 + 0.06, 0.19, BENCH.z0 + 0.06]} max={[drawerX0, 0.21, BENCH.z1 - 0.06]} material={km.paint('#4a5a6a', 0.6, 0.2)} castShadow />
      {/* worktop with dark edge band */}
      <Slab min={[BENCH.x0, TOP - 0.035, BENCH.z0]} max={[BENCH.x1, TOP, BENCH.z1]} material={top} castShadow />
      <Slab min={[BENCH.x0, TOP - 0.036, BENCH.z1]} max={[BENCH.x1, TOP + 0.001, BENCH.z1 + 0.004]} material={km.plastic('#2a2d31', 0.5)} />
      {/* drawer unit */}
      <Slab min={[drawerX0, 0.12, BENCH.z0 + 0.05]} max={[BENCH.x1 - 0.06, TOP - 0.036, BENCH.z1 - 0.03]} material={frame} castShadow />
      {[0, 1, 2].map((i) => {
        const y0 = 0.14 + i * 0.2;
        return (
          <group key={i}>
            <Slab min={[drawerX0 + 0.012, y0, BENCH.z1 - 0.03]} max={[BENCH.x1 - 0.072, y0 + 0.185, BENCH.z1 - 0.012]} material={km.paint('#46627f', 0.45, 0.3)} />
            <mesh geometry={KBOX()} material={km.metal('#c9cdd1', 0.3)} scale={[0.16, 0.014, 0.018]} position={[(drawerX0 + BENCH.x1 - 0.06) / 2, y0 + 0.15, BENCH.z1 - 0.003]} />
            <mesh geometry={KBOX()} material={km.plastic('#f5f5f0', 0.6)} scale={[0.07, 0.022, 0.001]} position={[(drawerX0 + BENCH.x1 - 0.06) / 2, y0 + 0.11, BENCH.z1 - 0.011]} />
          </group>
        );
      })}
      {/* leveling feet */}
      {legs.map((l, i) => (
        <mesh key={i} geometry={KCYL()} material={km.plastic('#1a1a1a', 0.8)} scale={[0.05, 0.012, 0.05]} position={[l.p[0], 0.006, l.p[2]]} />
      ))}
      {/* upright frame (aluminum extrusion) + pegboard back panel */}
      {[UPRIGHT.x0 + 0.02, UPRIGHT.x1 - 0.02].map((x) => (
        <Slab key={x} min={[x - 0.02, TOP, UPRIGHT.z - 0.02]} max={[x + 0.02, UPRIGHT.y1, UPRIGHT.z + 0.02]} material={extr} castShadow />
      ))}
      <Slab min={[UPRIGHT.x0, UPRIGHT.y1 - 0.04, UPRIGHT.z - 0.02]} max={[UPRIGHT.x1, UPRIGHT.y1, UPRIGHT.z + 0.02]} material={extr} castShadow />
      <Slab min={[UPRIGHT.x0, TOP, UPRIGHT.z - 0.02]} max={[UPRIGHT.x1, TOP + 0.03, UPRIGHT.z + 0.02]} material={extr} />
      <mesh geometry={KPLANE()} material={pegboardMaterial()} position={[(UPRIGHT.x0 + UPRIGHT.x1) / 2, (TOP + UPRIGHT.y1) / 2, UPRIGHT.z - 0.012]} scale={[UPRIGHT.x1 - UPRIGHT.x0 - 0.08, UPRIGHT.y1 - TOP - 0.07, 1]} receiveShadow />
      <Slab min={[UPRIGHT.x0 + 0.04, TOP + 0.03, UPRIGHT.z - 0.02]} max={[UPRIGHT.x1 - 0.04, UPRIGHT.y1 - 0.04, UPRIGHT.z - 0.013]} material={km.paint('#9aa3ab', 0.6)} />
      {/* top shelf light bar */}
      <Slab min={[UPRIGHT.x0, UPRIGHT.y1, UPRIGHT.z - 0.03]} max={[UPRIGHT.x1, UPRIGHT.y1 + 0.03, UPRIGHT.z + 0.16]} material={extr} castShadow />
      <mesh geometry={KBOX()} material={km.emissive('#f4f6ff', 1.4)} scale={[UPRIGHT.x1 - UPRIGHT.x0 - 0.1, 0.004, 0.04]} position={[(UPRIGHT.x0 + UPRIGHT.x1) / 2, UPRIGHT.y1 - 0.002, UPRIGHT.z + 0.12]} />
      {/* sloped console body */}
      <mesh geometry={consoleGeo()} material={km.paint('#34404d', 0.5, 0.3)} position={[CON.cx, TOP, 0]} castShadow receiveShadow />
      <Slab min={[CON.cx - CON.w / 2, TOP, CON.zFront]} max={[CON.cx + CON.w / 2, TOP + CON.hFront, CON.zFront + 0.002]} material={km.metal('#b6bcc2', 0.35)} />
    </group>
  );
}

function pegboardMaterial() {
  return kmat('trainer-pegboard', () => {
    const t = canvasTexture(
      'pegboard',
      128,
      128,
      (ctx, w, h) => {
        ctx.fillStyle = '#d7dadc';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#6d7276';
        for (const [x, y] of [
          [32, 32],
          [96, 32],
          [32, 96],
          [96, 96],
        ])
          ctx.beginPath(), ctx.arc(x!, y!, 7, 0, Math.PI * 2), ctx.fill();
      },
      { repeat: true },
    ).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.72 / 0.05, 1.19 / 0.05);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, metalness: 0.2 });
  });
}

// ---------------------------------------------------------------------------
// Cabinet interior (backplate coordinates: origin = backplate center, +Z out)
// ---------------------------------------------------------------------------

const BP = { w: CAB.size[0] - 0.06, h: CAB.size[1] - 0.06 };
const R1_Y = 0.24;
const R2_Y = -0.28;
const DUCT_TOP = 0.335;
const DUCT_MID = 0.135;
const DUCT_LOW = -0.18;
const RACK_X = -0.07;
const RACK_Y = -0.085;

function CabinetInterior({ runtime }: Pick<SceneViewProps<TrainerState>, 'runtime'>) {
  const live = useMemo(() => rackLiveFromController(runtime.controller), [runtime.controller]);
  const hardware = runtime.scene.hardware;
  const psOk = () => true;
  const tbPower = { count: 10, x: 0.13 };
  const tbDi = { count: 18, x: -0.18 };
  const tbDo = { count: 12, x: 0.0 };
  const tbAi = { count: 10, x: 0.17 };
  const layout = controlLogixChassisLayout(hardware.chassis ?? '1756-A7');
  const zEntry = DIN_RAIL.height + 0.0115;
  const wiring = useMemo(() => {
    const out: { points: Vec3[]; color: string; radius?: number }[] = [];
    const up = (x: number, rail: number, duct: number, color: string, r = 0.0009) =>
      out.push({ color, radius: r, points: [[x, rail + TB1492_J3.length / 2, zEntry], [x, rail + TB1492_J3.length / 2 + 0.014, zEntry], [x, duct - 0.022, 0.03], [x, duct, 0.03]] });
    const down = (x: number, rail: number, duct: number, color: string, r = 0.0009) =>
      out.push({ color, radius: r, points: [[x, rail - TB1492_J3.length / 2, zEntry], [x, rail - TB1492_J3.length / 2 - 0.014, zEntry], [x, duct + 0.022, 0.03], [x, duct, 0.03]] });
    for (let i = 0; i < tbPower.count; i++) {
      const x = tbPower.x + terminalX(i, tbPower.count);
      const c = i < 2 ? '#111111' : i < 4 ? '#eeeeee' : i < 8 ? '#1f4fd1' : '#3f9a3a';
      up(x, R1_Y, DUCT_TOP, c);
      down(x, R1_Y, DUCT_MID, c);
    }
    const field = (s: { count: number; x: number }, color: (i: number) => string) => {
      for (let i = 0; i < s.count; i++) {
        const x = s.x + terminalX(i, s.count);
        up(x, R2_Y, DUCT_LOW, color(i));
      }
    };
    field(tbDi, (i) => (i >= 16 ? '#1f4fd1' : '#1f4fd1'));
    field(tbDo, (i) => (i >= 9 ? '#eeeeee' : '#1f4fd1'));
    field(tbAi, (i) => (i % 2 ? '#eeeeee' : '#111111'));
    // breakers line side (black) into top duct, load side (black/red) into mid duct
    for (const [x, c] of [
      [-0.265, '#111111'],
      [-0.2475, '#111111'],
      [-0.2175, '#c62828'],
      [-0.2, '#c62828'],
    ] as const) {
      out.push({ color: c, points: [[x, R1_Y + 0.045, zEntry + 0.03], [x, R1_Y + 0.07, zEntry + 0.03], [x, DUCT_TOP - 0.022, 0.03], [x, DUCT_TOP, 0.03]] });
      out.push({ color: c, points: [[x, R1_Y - 0.045, zEntry + 0.03], [x, R1_Y - 0.07, zEntry + 0.03], [x, DUCT_MID + 0.022, 0.03], [x, DUCT_MID, 0.03]] });
    }
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const diColors = Array.from({ length: tbDi.count }, (_, i) => (i >= 16 ? TB_COLORS.blue : TB_COLORS.gray));
  const doColors = Array.from({ length: tbDo.count }, (_, i) => (i >= 9 ? TB_COLORS.blue : TB_COLORS.gray));
  const aiColors = Array.from({ length: tbAi.count }, (_, i) => (i % 2 ? TB_COLORS.blue : TB_COLORS.gray));
  const pwrColors = Array.from({ length: tbPower.count }, (_, i) => (i < 4 ? TB_COLORS.gray : i < 8 ? TB_COLORS.blue : TB_COLORS.green));
  const ductWires = ['#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1', '#111111', '#c62828'];
  return (
    <group>
      <WireDuct length={BP.w - 0.05} position={[0, DUCT_TOP, 0]} width={0.035} height={0.05} wires={ductWires} />
      <WireDuct length={BP.w - 0.12} position={[0, DUCT_MID, 0]} width={0.035} height={0.05} wires={ductWires} />
      <WireDuct length={BP.w - 0.12} position={[0, DUCT_LOW, 0]} width={0.035} height={0.05} wires={ductWires} />
      <WireDuct length={BP.h - 0.12} vertical position={[BP.w / 2 - 0.03, -0.02, 0]} width={0.035} height={0.05} cover={false} wires={['#1f4fd1', '#1f4fd1', '#c62828', '#1f4fd1', '#111111']} />
      <DinRail length={BP.w - 0.06} position={[0, R1_Y, 0]}>
        <CircuitBreaker1489 poles={2} rating="C6" position={[-0.256, 0, 0]} getOn={() => true} />
        <CircuitBreaker1489 poles={1} rating="C2" position={[-0.2175, 0, 0]} getOn={() => true} />
        <CircuitBreaker1489 poles={1} rating="C4" position={[-0.2, 0, 0]} getOn={() => true} />
        <PowerSupply1606 position={[-0.125, 0, 0]} getOk={psOk} rating="24V DC 5A 120W" catalog="1606-XLS120E" />
        <TerminalBlocks1492 count={tbPower.count} colors={pwrColors} labels={['L1', 'L1', 'N', 'N', '+24', '+24', '+24', '+24', 'PE', 'PE']} position={[tbPower.x, 0, 0]} />
      </DinRail>
      <ControlLogixRack hardware={hardware} live={live} wired position={[RACK_X, RACK_Y, 0]} />
      <DinRail length={BP.w - 0.06} position={[0, R2_Y, 0]}>
        <TerminalBlocks1492 count={tbDi.count} colors={diColors} position={[tbDi.x, 0, 0]} labels={Array.from({ length: tbDi.count }, (_, i) => (i < 16 ? `I${i}` : 'C'))} />
        <TerminalBlocks1492 count={tbDo.count} colors={doColors} position={[tbDo.x, 0, 0]} labels={Array.from({ length: tbDo.count }, (_, i) => (i < 9 ? `O${i}` : '0V'))} />
        <TerminalBlocks1492 count={tbAi.count} colors={aiColors} position={[tbAi.x, 0, 0]} labels={['A0+', 'A0-', 'A1+', 'A1-', 'Q0+', 'Q0-', 'Q1+', 'Q1-', 'SH', 'SH']} />
      </DinRail>
      <Wires wires={wiring} />
      {/* field harness down through the bottom gland to the console */}
      <WireBundle
        colors={['#1f4fd1', '#1f4fd1', '#1f4fd1', '#eeeeee', '#1f4fd1', '#111111', '#1f4fd1', '#1f4fd1']}
        points={[
          [-0.05, R2_Y - TB1492_J3.length / 2 - 0.004, 0.04],
          [-0.05, -BP.h / 2 + 0.01, 0.05],
          [-0.05, -BP.h / 2 - 0.03, 0.08],
        ]}
        tieSpacing={0.03}
      />
      {/* module hover info (slot / catalog / name) */}
      {hardware.modules.map((mod) => (
        <IoTag
          key={mod.slot}
          position={[RACK_X - layout.width / 2 + layout.slotCenterX(mod.slot), RACK_Y + 0.075, 0.075]}
          size={[0.033, 0.145, 0.14]}
          anchor={[0, 0.082, 0.05]}
          title={`Slot ${mod.slot}`}
          lines={[textLine(mod.catalog, mod.name ?? (mod.slot === 0 ? 'Controller' : ''), `Local:${mod.slot}`)]}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const OCCLUDERS: Array<[Vec3, Vec3]> = [
  ...ROOM_OCCLUDERS,
  // upright pegboard panel
  [
    [UPRIGHT.x0, TOP + 0.03, UPRIGHT.z - 0.03],
    [UPRIGHT.x1, UPRIGHT.y1 - 0.04, UPRIGHT.z - 0.012],
  ],
  // worktop
  [
    [BENCH.x0, TOP - 0.035, BENCH.z0],
    [BENCH.x1, TOP - 0.002, BENCH.z1],
  ],
  // console body (lower part)
  [
    [CON.cx - CON.w / 2, TOP, CON.zBack],
    [CON.cx + CON.w / 2, TOP + CON.hFront, CON.zFront],
  ],
];

export function TrainerView({ state, runtime }: SceneViewProps<TrainerState>) {
  const ctl = useControls(runtime);
  useSfxLoops(['buzzer'], (l) => {
    l.buzzer = state.buzzer ? 1 : 0;
  });

  const faceTex = consoleFaceTexture();
  const outTex = outputPanelTexture();
  const lines = useMemo(() => {
    const L = (a: string) => ioLine(runtime, a);
    return {
      sw: Array.from({ length: 8 }, (_, i) => [L(`Switch_${i}`)]),
      pb: PB.map((b) => [L(b.alias)]),
      light: Array.from({ length: 8 }, (_, i) => [L(`Light_${i}`)]),
      pot: [[L('Pot_1')], [L('Pot_2')]],
      meter1: [L('Meter_1')],
      meter2: [L('Meter_2')],
      buzzer: [L('Buzzer')],
    };
  }, [runtime]);

  return (
    <TagLayer occluders={OCCLUDERS}>
      <LabRoom />
      {/* daylight from the window (no shadows: the main light owns them) */}
      <directionalLight position={[ROOM.leftX - 3, 3.2, 1.2]} intensity={0.55} color="#e4eeff" />
      <pointLight position={[0.0, 2.6, 1.6]} intensity={5} distance={6} decay={1.8} color="#fff4e6" />
      <Bench />
      <PegboardTools />

      {/* ---- cabinet with the live rack ---- */}
      <Enclosure size={CAB.size} position={CAB.pos} doorAngle={2.0} nameplate={'TR-1756 PLC TRAINER\n1756-A7 CONTROLLOGIX'} glands={3}>
        <CabinetInterior runtime={runtime} />
      </Enclosure>
      {/* harness from the cabinet gland down behind the console */}
      <Tube
        points={[
          [CAB.pos[0] - 0.05, CAB.pos[1] - 0.06, CAB.pos[2] + 0.12],
          [CAB.pos[0] - 0.05, TOP + 0.02, CAB.pos[2] + 0.14],
          [CAB.pos[0] - 0.02, TOP + 0.02, CON.zBack - 0.03],
          [CAB.pos[0] + 0.1, TOP + 0.08, CON.zBack - 0.005],
        ]}
        radius={0.009}
        bend={0.06}
        material={km.plastic('#2a2d31', 0.7)}
      />
      {/* 120 V supply cord to the wall outlet */}
      <Tube
        points={[
          [CAB.pos[0] - 0.22, CAB.pos[1] - 0.06, CAB.pos[2] + 0.12],
          [CAB.pos[0] - 0.22, TOP + 0.01, CAB.pos[2] + 0.12],
          [-1.02, TOP + 0.01, BENCH.z0 + 0.04],
          [-1.08, TOP - 0.02, BENCH.z0 - 0.01],
          [-1.3, 0.55, ROOM.backZ + 0.03],
          [-1.45, 0.38, ROOM.backZ + 0.03],
        ]}
        radius={0.004}
        bend={0.08}
        material={km.plastic('#16181a', 0.6)}
      />
      {/* Ethernet: laptop -> EN2T (slot 5) */}
      <Tube
        points={[
          [0.606, TOP + 0.009, -0.36],
          [0.56, TOP + 0.004, -0.46],
          [-0.2, TOP + 0.004, -0.47],
          [CAB.pos[0] + 0.12, TOP + 0.004, -0.5],
          [CAB.pos[0] + 0.12, CAB.pos[1] - 0.03, -0.5],
          [CAB.pos[0] + 0.12, CAB.pos[1] + 0.2, -0.43],
          [CAB.pos[0] + 0.056, CAB.pos[1] + 0.37, -0.41],
        ]}
        radius={0.0028}
        bend={0.05}
        material={km.plastic('#1f8f5a', 0.45)}
      />
      <Laptop position={[0.72, TOP, -0.22]} rotation={[0, -0.3, 0]} />
      {/* printed lab manual */}
      <group position={[0.97, TOP + 0.004, -0.02]} rotation={[0, 0.25, 0]}>
        <mesh geometry={KBOX()} material={km.paint('#f4f1e8', 0.8)} scale={[0.21, 0.008, 0.28]} castShadow />
        <mesh geometry={KBOX()} material={km.paint('#c62828', 0.6)} scale={[0.21, 0.001, 0.05]} position={[0, 0.0045, -0.1]} />
      </group>

      {/* ---- output panel on the upright ---- */}
      <group position={OUT.c}>
        {[
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].map(([sx, sy], i) => (
          <mesh key={i} geometry={KCYL()} material={km.metal('#bfc4c8', 0.3)} rotation={[Math.PI / 2, 0, 0]} scale={[0.012, 0.025, 0.012]} position={[sx! * (OUT.w / 2 - 0.02), sy! * (OUT.h / 2 - 0.02), -0.0125]} />
        ))}
        <mesh geometry={KBOX()} material={km.paint('#2b3440', 0.45, 0.35)} scale={[OUT.w, OUT.h, 0.003]} position={[0, 0, 0.0015]} castShadow receiveShadow />
        <mesh geometry={KPLANE()} material={km.label(outTex, 0.5)} scale={[OUT.w - 0.004, OUT.h - 0.004, 1]} position={[0, 0, 0.0031]} />
        {LIGHT_COLORS.map((c, i) => (
          <IoTag key={i} position={[LIGHT_X(i), LIGHT_Y, DZ]} size={[0.034, 0.058, 0.04]} center={[0, 0.008, 0.02]} anchor={[0, 0.045, 0.02]} title={`Pilot light ${i} · 800F ${c} LED`} lines={lines.light[i]!}>
            <PilotLight800F color={c} legend={`L${i}`} getLit={() => state.lights[i] === true} rear={false} />
          </IoTag>
        ))}
        <IoTag position={METER_P} size={[0.078, 0.078, 0.03]} center={[0, 0, 0.015]} anchor={[0, 0.045, 0.012]} title="Analog panel meter · 4-20 mA" lines={lines.meter1}>
          <AnalogMeter getValue={() => state.meter1} legend="METER 1" units="%" scaleLabels={['0', '100']} redFrom={90} rear={false} />
        </IoTag>
        <IoTag position={BAR_P} size={[0.036, 0.124, 0.03]} center={[0, 0, 0.015]} anchor={[0, 0.068, 0.012]} title="10-segment LED bar graph · 4-20 mA" lines={lines.meter2}>
          <LedBarGraph getValue={() => state.meter2} legend="METER 2" rear={false} />
        </IoTag>
        <IoTag position={BUZ_P} size={[0.042, 0.042, 0.035]} center={[0, 0, 0.0175]} anchor={[0, 0.03, 0.016]} title="Panel buzzer · 24 V DC" lines={lines.buzzer}>
          <PanelBuzzer position={[0, 0, 0]} getOn={() => state.buzzer} getPhase={() => state.buzzerPhase} />
        </IoTag>
      </group>

      {/* ---- sloped input console ---- */}
      <group position={FACE_POS} rotation={FACE_ROT}>
        <mesh geometry={KBOX()} material={km.paint('#2b3440', 0.45, 0.35)} scale={[CON.w - 0.01, CON_LEN - 0.01, 0.003]} position={[0, 0, 0.0015]} receiveShadow />
        <mesh geometry={KPLANE()} material={km.label(faceTex, 0.5)} scale={[CON.w - 0.014, CON_LEN - 0.014, 1]} position={[0, 0, 0.0031]} />
        {Array.from({ length: 8 }, (_, i) => (
          <IoTag key={i} position={[SW_X(i), SW_Y, DZ]} size={[0.034, 0.06, 0.045]} center={[0, 0.008, 0.0225]} anchor={[0, 0.042, 0.03]} title={`SW${i} · maintained toggle (N.O.) · click`} lines={lines.sw[i]!} onPress={ctl.toggle(`sw${i}`)}>
            <ToggleSwitch legend={`SW ${i}`} getOn={() => Boolean(state.controls[`sw${i}` as 'sw0'])} onToggle={ctl.toggle(`sw${i}`)} rear={false} />
          </IoTag>
        ))}
        {PB.map((b, i) => (
          <IoTag key={b.id} position={[b.x, PB_Y, DZ]} size={[0.034, 0.058, 0.045]} center={[0, 0.008, 0.0225]} anchor={[0, 0.045, 0.03]} title={`800F ${b.color} ${b.style} push button (${b.contact})`} lines={lines.pb[i]!}>
            <PushButton800F
              color={b.color}
              style={b.style}
              legend={b.legend}
              contact={b.contact}
              getPressed={() => Boolean(state.controls[b.id])}
              {...ctl.momentary(b.id)}
              rear={false}
            />
          </IoTag>
        ))}
        {POT_X.map((x, i) => (
          <IoTag key={x} position={[x, POT_Y, DZ]} size={[0.05, 0.06, 0.045]} center={[0, 0, 0.0225]} anchor={[0, 0.04, 0.03]} title={`Potentiometer ${i + 1} · drag or scroll`} lines={lines.pot[i]!}>
            <Potentiometer
              legend={`POT ${i + 1}`}
              getValue={() => (i === 0 ? state.controls.pot1 : state.controls.pot2)}
              onChange={(v) => runtime.setControl(i === 0 ? 'pot1' : 'pot2', Math.round(v * 10) / 10)}
              rear={false}
            />
          </IoTag>
        ))}
      </group>
    </TagLayer>
  );
}

export default TrainerView;
