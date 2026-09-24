/**
 * <Controller1756L8/> — ControlLogix 5580 controller (1756-L85E / 1756-L83E), single-slot module.
 *
 * Front (top -> bottom): catalog legend, 4-character scrolling dot-matrix status display,
 * RUN / FORCE / SD / OK status indicators, 3-position RUN-REM-PROG key switch with the key
 * (rotates to the current position; click left/center/right of it to turn), SD-card door
 * (SD slot + reset button behind it), USB type-B port, NET / LINK indicators of the embedded
 * 1 Gb EtherNet/IP port whose RJ45 jack sits on the underside at the front.
 *
 * Origin: back-bottom-center of the module (backplane face), front = +Z.
 */
import { useCursor } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ControllerStatus, KeySwitch } from '../../../../plc/types';
import type { Placement } from '../../../contracts';
import { MOD_FRONT_Z, MOD_H, MOD_W } from './dims';
import {
  Art,
  ArtPlane,
  DotMatrixDisplay,
  FONT_COND,
  MAT,
  PatchCable,
  Rj45Jack,
  Selectable,
  StatusLed,
  UsbBPort,
  cachedGeo,
  canvasTexture,
  cylZ,
  merge,
  rboxAt,
  texMaterial,
  type StatusLedState,
} from './shared';

export type ControllerCatalog1756 = '1756-L85E' | '1756-L83E';

export interface Controller1756L8Props extends Placement {
  catalog?: ControllerCatalog1756;
  /** Live controller status (display text, LEDs, key position). Omit for an unpowered controller. */
  getStatus?: () => ControllerStatus;
  /** Called when the user clicks the key switch zones (left = RUN, center = REM, right = PROG). */
  onKeySwitch?: (pos: KeySwitch) => void;
  /** Embedded Ethernet port indicators (default: NET steady green, LINK flickering activity when powered). */
  getNet?: () => StatusLedState;
  getLink?: () => StatusLedState;
  /** Show a patch cable plugged into the embedded Ethernet port (default true). */
  cable?: boolean;
  onSelect?: () => void;
  highlighted?: boolean;
}

export const CPU_FRONT_Z = MOD_FRONT_Z + 0.0025;
const FACE = CPU_FRONT_Z;
const ART_X0 = -MOD_W / 2 + 0.0005;
const ART_X1 = MOD_W / 2 - 0.0005;
const ART_Y0 = 0.0005;
const ART_Y1 = MOD_H - 0.0005;
const LED_Z = FACE + 0.00035;

const DISPLAY_Y = 0.1245;
const LED_ROWS = [0.1128, 0.1082];
const LED_COLS = [-0.0118, 0.0022];
const KEY_Y = 0.0848;
const SD_Y = 0.0585;
const USB_Y = 0.0392;
const NET_Y = 0.0205;
const JACK_Z = 0.1288;

const KEY_ANGLE: Record<KeySwitch, number> = { RUN: Math.PI / 4, REM: 0, PROG: -Math.PI / 4 };

function frontTexture(catalog: ControllerCatalog1756) {
  return canvasTexture(`clx:cpu:${catalog}`, 288, Math.round((288 * (ART_Y1 - ART_Y0)) / (ART_X1 - ART_X0)), (ctx, w, h) => {
    const a = new Art(ctx, ART_X0, ART_X1, ART_Y0, ART_Y1, w, h);
    a.plastic('#202124', 6);
    const lab = { weight: 800, color: '#dcdcd6', font: FONT_COND } as const;
    a.text('ControlLogix 5580', 0, 0.1372, 0.0017, { weight: 600, color: '#a9aaa4' });
    a.text(catalog, 0, 0.1347, 0.0027, { weight: 800, color: '#f1f1ec' });
    // display bezel
    a.rect(0, DISPLAY_Y, 0.0292, 0.0122, '#0b0b0c', 'rgba(255,255,255,0.12)', 0.0003, 0.0012);
    // status indicators
    const names = [
      ['RUN', 'FORCE'],
      ['SD', 'OK'],
    ];
    LED_ROWS.forEach((y, r) =>
      LED_COLS.forEach((x, c) => {
        a.rect(x, y, 0.0033, 0.0023, '#050505');
        a.text(names[r]![c]!, x + 0.0028, y, 0.0021, { ...lab, align: 'left' });
      }),
    );
    // key switch legend
    a.rect(0, KEY_Y + 0.001, 0.0305, 0.0305, '#18191b', 'rgba(255,255,255,0.08)', 0.0003, 0.0016);
    const tick = (ang: number, label: string, lx: number, ly: number) => {
      const r0 = 0.0081;
      const r1 = 0.0098;
      a.line(Math.sin(-ang) * r0, KEY_Y + Math.cos(ang) * r0, Math.sin(-ang) * r1, KEY_Y + Math.cos(ang) * r1, '#dcdcd6', 0.0005);
      a.text(label, lx, ly, 0.0021, lab);
    };
    tick(KEY_ANGLE.RUN, 'RUN', -0.0104, KEY_Y + 0.0118);
    tick(KEY_ANGLE.REM, 'REM', 0, KEY_Y + 0.0133);
    tick(KEY_ANGLE.PROG, 'PROG', 0.0104, KEY_Y + 0.0118);
    // USB legend
    a.text('USB', -0.0103, USB_Y, 0.0019, lab);
    a.rect(0, USB_Y, 0.011, 0.0102, '#0e0e0f', 'rgba(255,255,255,0.08)', 0.0002, 0.0008);
    // Ethernet port indicators & legend (jack on the underside)
    a.rect(LED_COLS[0]!, NET_Y, 0.0033, 0.0023, '#050505');
    a.text('NET', LED_COLS[0]! + 0.0028, NET_Y, 0.0021, { ...lab, align: 'left' });
    a.rect(LED_COLS[1]!, NET_Y, 0.0033, 0.0023, '#050505');
    a.text('LINK', LED_COLS[1]! + 0.0028, NET_Y, 0.0021, { ...lab, align: 'left' });
    a.line(-0.014, 0.0158, 0.014, 0.0158, 'rgba(255,255,255,0.15)', 0.0002);
    a.text('EtherNet/IP', 0, 0.0122, 0.0019, { weight: 700, color: '#c9c9c3' });
    a.text('1 Gbps', 0, 0.0092, 0.0017, { weight: 600, color: '#a0a19b', font: FONT_COND });
    // arrow down to the port
    const ctx2 = a.ctx;
    ctx2.fillStyle = '#a0a19b';
    ctx2.beginPath();
    ctx2.moveTo(a.px(-0.0022), a.py(0.0062));
    ctx2.lineTo(a.px(0.0022), a.py(0.0062));
    ctx2.lineTo(a.px(0), a.py(0.0035));
    ctx2.closePath();
    ctx2.fill();
  });
}

function sdDoorTexture() {
  return canvasTexture('clx:cpu:sddoor', 160, 140, (ctx, w, h) => {
    const a = new Art(ctx, -0.012, 0.012, -0.0105, 0.0105, w, h);
    a.plastic('#1b1c1f', 5);
    a.rect(0, 0, 0.0232, 0.0202, undefined, 'rgba(255,255,255,0.12)', 0.0003, 0.001);
    // SD card pictogram
    const c = a.ctx;
    c.strokeStyle = '#cfcfc9';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(a.px(-0.004), a.py(0.0055));
    c.lineTo(a.px(0.0028), a.py(0.0055));
    c.lineTo(a.px(0.004), a.py(0.0043));
    c.lineTo(a.px(0.004), a.py(-0.0045));
    c.lineTo(a.px(-0.004), a.py(-0.0045));
    c.closePath();
    c.stroke();
    a.text('SD', 0, 0.0002, 0.0034, { weight: 900, color: '#cfcfc9' });
    // finger notch
    a.rect(0.0098, 0, 0.0012, 0.006, '#0a0a0b', undefined, 0, 0.0005);
  });
}

function keyGeometry() {
  return cachedGeo('clx:key', () => {
    // flat key head in the (axis, y) plane with a ring hole
    const s = new THREE.Shape();
    const u0 = 0.0092;
    const u1 = 0.0212;
    const v = 0.0074;
    const r = 0.0032;
    s.moveTo(u0, -0.0024);
    s.lineTo(u0 + 0.0018, -v + r * 0.4);
    s.quadraticCurveTo(u0 + 0.0024, -v, u0 + r + 0.001, -v);
    s.lineTo(u1 - r, -v);
    s.quadraticCurveTo(u1, -v, u1, -v + r);
    s.lineTo(u1, v - r);
    s.quadraticCurveTo(u1, v, u1 - r, v);
    s.lineTo(u0 + r + 0.001, v);
    s.quadraticCurveTo(u0 + 0.0024, v, u0 + 0.0018, v - r * 0.4);
    s.lineTo(u0, 0.0024);
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(u1 - 0.0036, 0, 0.0017, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const head = new THREE.ExtrudeGeometry(s, {
      depth: 0.0016,
      bevelEnabled: true,
      bevelThickness: 0.0003,
      bevelSize: 0.0003,
      bevelSegments: 2,
      curveSegments: 10,
    })
      .rotateY(-Math.PI / 2)
      .translate(0.0008, 0, 0);
    const shank = new THREE.BoxGeometry(0.0014, 0.0046, 0.0074).translate(0, 0, 0.0057);
    return merge([head, shank]);
  });
}

function lockGeometry() {
  return cachedGeo('clx:lock', () =>
    merge([
      cylZ(0.0074, 0.0012, 0, 0, 0.0006, 32), // bezel ring
      cylZ(0.0056, 0.0024, 0, 0, 0.0012, 28, 0.0053), // cylinder plug
    ]),
  );
}

const keyway = new THREE.BoxGeometry(0.0012, 0.0062, 0.0003);

/** Default activity flicker for LINK indicators. */
export function linkActivity(seed = 0): () => StatusLedState {
  return () => {
    const t = performance.now() * 0.001 + seed;
    return Math.sin(t * 23.1) + Math.sin(t * 7.3 + seed) > 0.4 ? 'off' : 'green';
  };
}

const NET_GREEN = (): StatusLedState => 'green';

export function Controller1756L8({
  catalog = '1756-L85E',
  getStatus,
  onKeySwitch,
  getNet,
  getLink,
  cable = true,
  onSelect,
  highlighted,
  position,
  rotation,
  scale,
}: Controller1756L8Props) {
  const front = frontTexture(catalog);
  const sd = sdDoorTexture();
  const body = cachedGeo('clx:cpuBody', () => rboxAt(MOD_W, MOD_H, FACE, 0, MOD_H / 2, FACE / 2, 0.0012));
  const sdDoor = cachedGeo('clx:cpuSdDoor', () => rboxAt(0.0236, 0.0206, 0.0012, 0, 0, 0, 0.0007));
  const sdPlane = cachedGeo('plane:sd', () => new THREE.PlaneGeometry(0.0232, 0.0202));

  const powered = !!getStatus;
  const linkDefault = useMemo(() => linkActivity(0.7), []);

  const getText = useCallback(() => (getStatus ? getStatus().displayText : ''), [getStatus]);
  const runLed = useCallback((): StatusLedState => (getStatus?.().runLed === 'green' ? 'green' : 'off'), [getStatus]);
  const forceLed = useCallback((): StatusLedState => {
    const f = getStatus?.().forceLed;
    return f === 'amber' ? 'amber' : f === 'flashing-amber' ? 'flashing-amber' : 'off';
  }, [getStatus]);
  const sdLed = useCallback((): StatusLedState => 'off', []);
  const okLed = useCallback((): StatusLedState => {
    const o = getStatus?.().ok;
    return o === 'green' ? 'green' : o === 'red' ? 'red' : o === 'flashing-red' ? 'flashing-red' : 'off';
  }, [getStatus]);
  const netLed = useCallback((): StatusLedState => (powered ? (getNet ?? NET_GREEN)() : 'off'), [powered, getNet]);
  const linkLed = useCallback((): StatusLedState => (powered ? (getLink ?? linkDefault)() : 'off'), [powered, getLink, linkDefault]);

  // --- key switch animation ---
  const keyRef = useRef<THREE.Group>(null);
  const keyAngle = useRef(KEY_ANGLE[getStatus?.().keySwitch ?? 'REM']);
  useFrame((_, dt) => {
    const g = keyRef.current;
    if (!g) return;
    const target = KEY_ANGLE[getStatus?.().keySwitch ?? 'REM'];
    const a = keyAngle.current;
    if (Math.abs(target - a) < 1e-4) {
      if (g.rotation.z !== target) g.rotation.z = target;
      return;
    }
    keyAngle.current = a + (target - a) * Math.min(1, dt * 12);
    g.rotation.z = keyAngle.current;
  });

  // --- key click zones ---
  const [hoverZone, setHoverZone] = useState<KeySwitch | null>(null);
  useCursor(hoverZone !== null && !!onKeySwitch);
  const zone = (pos: KeySwitch) =>
    onKeySwitch
      ? {
          onPointerOver: (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            setHoverZone(pos);
          },
          onPointerOut: () => setHoverZone((z) => (z === pos ? null : z)),
          onPointerDown: (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onKeySwitch(pos);
          },
          onPointerUp: (e: ThreeEvent<PointerEvent>) => e.stopPropagation(),
        }
      : {};
  const zoneGeo = cachedGeo('clx:keyzone', () => new THREE.BoxGeometry(0.0112, 0.03, 0.026));

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={[MOD_W + 0.0018, MOD_H + 0.0018, 0.016]} center={[0, MOD_H / 2, FACE - 0.0065]} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={body} material={MAT.body()} castShadow />
        <ArtPlane tex={front} x0={ART_X0} x1={ART_X1} y0={ART_Y0} y1={ART_Y1} z={FACE + 0.0001} />
        <DotMatrixDisplay getText={getText} width={0.0248} height={0.0082} position={[0, DISPLAY_Y, FACE + 0.00025]} />
        <StatusLed get={runLed} position={[LED_COLS[0]!, LED_ROWS[0]!, LED_Z]} />
        <StatusLed get={forceLed} offColor="amber" position={[LED_COLS[1]!, LED_ROWS[0]!, LED_Z]} />
        <StatusLed get={sdLed} position={[LED_COLS[0]!, LED_ROWS[1]!, LED_Z]} />
        <StatusLed get={okLed} position={[LED_COLS[1]!, LED_ROWS[1]!, LED_Z]} />
        <StatusLed get={netLed} position={[LED_COLS[0]!, NET_Y, LED_Z]} />
        <StatusLed get={linkLed} position={[LED_COLS[1]!, NET_Y, LED_Z]} />

        {/* key switch */}
        <group position={[0, KEY_Y, FACE]}>
          <mesh geometry={lockGeometry()} material={MAT.nickel()} />
          <group ref={keyRef} rotation-z={keyAngle.current}>
            <mesh geometry={keyway} material={MAT.hole()} position={[0, 0, 0.0025]} />
            <mesh geometry={keyGeometry()} material={MAT.nickel()} castShadow />
          </group>
          <mesh geometry={zoneGeo} material={MAT.invisible()} position={[-0.011, 0.001, 0.012]} {...zone('RUN')} />
          <mesh geometry={zoneGeo} material={MAT.invisible()} position={[0, 0.001, 0.012]} scale={[0.95, 1, 1]} {...zone('REM')} />
          <mesh geometry={zoneGeo} material={MAT.invisible()} position={[0.011, 0.001, 0.012]} {...zone('PROG')} />
        </group>

        {/* SD card door */}
        <group position={[0, SD_Y, FACE + 0.0006]}>
          <mesh geometry={sdDoor} material={MAT.face()} />
          <mesh geometry={sdPlane} material={texMaterial(sd)} position={[0, 0, 0.00062]} />
        </group>

        <UsbBPort position={[0, USB_Y, FACE + 0.0002]} />

        {/* embedded Ethernet port on the underside, at the front */}
        <Rj45Jack position={[0, -0.0002, JACK_Z]} rotation={[Math.PI / 2, 0, 0]} />
        {cable && <PatchCable position={[0, -0.0002, JACK_Z]} color="#2f9d62" />}
      </Selectable>
    </group>
  );
}
