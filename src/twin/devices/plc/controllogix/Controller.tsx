/**
 * <Controller1756L8/> — ControlLogix 5580 controller (1756-L85E / 1756-L83E), single-slot module.
 *
 * Front (top -> bottom): catalog legend, 4-character scrolling dot-matrix status display,
 * RUN / FORCE / SD / OK status indicators, 3-position RUN-REM-PROG key switch on a raised escutcheon
 * with the key (rotates to the current position; click the RUN side / the lock / the PROG side of the
 * escutcheon to turn it — resolved in lock-local coordinates so it works from any camera angle), SD-card door
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
  SideLabel,
  StatusLed,
  UsbBPort,
  cachedGeo,
  canvasTexture,
  cylZ,
  frameParts,
  lockingTabParts,
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
  /** Show the catalog label on the right side of the housing (default true; the rack shows it only where visible). */
  sideLabel?: boolean;
}

export const CPU_FRONT_Z = MOD_FRONT_Z + 0.0025;
const FACE = CPU_FRONT_Z;
const ART_X0 = -MOD_W / 2 + 0.0005;
const ART_X1 = MOD_W / 2 - 0.0005;
const ART_Y0 = 0.0005;
const ART_Y1 = MOD_H - 0.0005;
const LED_Z = FACE + 0.00035;

const DISPLAY_Y = 0.1245;
/** Molded display window: outer frame size, rim width and height above the face. */
const DISP_FRAME = { w: 0.0294, h: 0.0124, rim: 0.0019, height: 0.0009 } as const;
const LED_ROWS = [0.1128, 0.1082];
const LED_COLS = [-0.0118, 0.0022];
const KEY_Y = 0.0848;
/** Raised key-switch escutcheon plate. */
const ESC = { w: 0.0304, h: 0.0296, cy: KEY_Y + 0.0008, t: 0.001 } as const;
const ESC_Z = FACE + ESC.t;
/** Half-width of the center (REM) zone of the key-switch hit plate, lock-local. */
const REM_HALF = 0.004;
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
    // display window floor (inside the molded frame)
    a.rect(0, DISPLAY_Y, DISP_FRAME.w - 0.001, DISP_FRAME.h - 0.001, '#070708', undefined, 0, 0.0008);
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
    // USB legend + dark surround of the receptacle
    a.text('USB', -0.0108, USB_Y, 0.0019, lab);
    a.rect(0, USB_Y, 0.0104, 0.0098, '#0c0c0d', undefined, 0, 0.0008);
    // Ethernet port indicators & legend (jack on the underside)
    a.rect(LED_COLS[0]!, NET_Y, 0.0033, 0.0023, '#050505');
    a.text('NET', LED_COLS[0]! + 0.0028, NET_Y, 0.0021, { ...lab, align: 'left' });
    a.rect(LED_COLS[1]!, NET_Y, 0.0033, 0.0023, '#050505');
    a.text('LINK', LED_COLS[1]! + 0.0028, NET_Y, 0.0021, { ...lab, align: 'left' });
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

/** Printed legend on the raised key escutcheon: position ticks and RUN / REM / PROG. */
function escutcheonTexture() {
  const x0 = -ESC.w / 2;
  const y0 = -ESC.h / 2;
  return canvasTexture('clx:cpu:esc', 256, Math.round((256 * ESC.h) / ESC.w), (ctx, w, h) => {
    const a = new Art(ctx, x0, -x0, y0, -y0, w, h);
    a.plastic('#1a1b1d', 5);
    a.rect(0, 0, ESC.w - 0.0006, ESC.h - 0.0006, undefined, 'rgba(255,255,255,0.07)', 0.0003, 0.0014);
    const lab = { weight: 800, color: '#dcdcd6', font: FONT_COND } as const;
    const ky = KEY_Y - ESC.cy; // lock center, plate-local
    const tick = (ang: number, label: string, lx: number, ly: number) => {
      const r0 = 0.0081;
      const r1 = 0.0098;
      a.line(Math.sin(-ang) * r0, ky + Math.cos(ang) * r0, Math.sin(-ang) * r1, ky + Math.cos(ang) * r1, '#dcdcd6', 0.0005);
      a.text(label, lx, ly, 0.0021, lab);
    };
    tick(KEY_ANGLE.RUN, 'RUN', -0.0104, ky + 0.0118);
    tick(KEY_ANGLE.REM, 'REM', 0, ky + 0.0133);
    tick(KEY_ANGLE.PROG, 'PROG', 0.0104, ky + 0.0118);
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
const ghostMat = new THREE.MeshBasicMaterial({ color: '#9fdcff', transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false });
const _v = new THREE.Vector3();

function bodyGeometry() {
  return cachedGeo('clx:cpuBody', () =>
    merge([
      rboxAt(MOD_W, MOD_H, FACE, 0, MOD_H / 2, FACE / 2, 0.0012),
      // molded display window frame
      ...frameParts(0, DISPLAY_Y, DISP_FRAME.w, DISP_FRAME.h, DISP_FRAME.rim, DISP_FRAME.height, FACE),
      // raised key-switch escutcheon
      rboxAt(ESC.w, ESC.h, ESC.t + 0.0002, 0, ESC.cy, FACE + ESC.t / 2 - 0.0001, 0.0009),
      // molded rib above the EtherNet/IP port legend
      rboxAt(0.0282, 0.0008, 0.0007, 0, 0.0158, FACE + 0.00025, 0.0002),
      ...lockingTabParts(MOD_H),
    ]),
  );
}

/** Default activity flicker for LINK indicators. */
export function linkActivity(seed = 0): () => StatusLedState {
  return () => {
    const t = performance.now() * 0.001 + seed;
    return Math.sin(t * 23.1) + Math.sin(t * 7.3 + seed) > 0.4 ? 'off' : 'green';
  };
}

const NET_GREEN = (): StatusLedState => 'green';

const SIDE_LINES: Record<ControllerCatalog1756, string[]> = {
  '1756-L85E': ['40 MB user memory', '1 Gbps EtherNet/IP port', 'USB 2.0 · SD card'],
  '1756-L83E': ['10 MB user memory', '1 Gbps EtherNet/IP port', 'USB 2.0 · SD card'],
};

export function Controller1756L8({
  catalog = '1756-L85E',
  getStatus,
  onKeySwitch,
  getNet,
  getLink,
  cable = true,
  onSelect,
  highlighted,
  sideLabel = true,
  position,
  rotation,
  scale,
}: Controller1756L8Props) {
  const front = frontTexture(catalog);
  const sd = sdDoorTexture();
  const esc = escutcheonTexture();
  const body = bodyGeometry();
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
  const ghostRef = useRef<THREE.Mesh>(null);
  const keyAngle = useRef(KEY_ANGLE[getStatus?.().keySwitch ?? 'REM']);
  const hoverRef = useRef<KeySwitch | null>(null);
  useFrame((_, dt) => {
    const g = keyRef.current;
    if (!g) return;
    const current = getStatus?.().keySwitch ?? 'REM';
    const ghost = ghostRef.current;
    if (ghost) {
      const h = hoverRef.current;
      ghost.visible = h !== null && h !== current;
      if (h) ghost.rotation.z = KEY_ANGLE[h];
    }
    const target = KEY_ANGLE[current];
    const a = keyAngle.current;
    if (Math.abs(target - a) < 1e-4) {
      if (g.rotation.z !== target) g.rotation.z = target;
      return;
    }
    keyAngle.current = a + (target - a) * Math.min(1, dt * 12);
    g.rotation.z = keyAngle.current;
  });

  // --- key switch interaction ---
  // One thin hit plate on the escutcheon + the lock & key themselves. The clicked position is resolved in
  // lock-local coordinates (independent of the camera angle): left of the lock = RUN, the lock / key = REM,
  // right = PROG. Fires on pointer-up without dragging, so starting an orbit drag on the key never turns it.
  const lockRef = useRef<THREE.Group>(null);
  const hitRef = useRef<THREE.Mesh>(null);
  const keyDown = useRef(false);
  const [hoverZone, setHoverZone] = useState<KeySwitch | null>(null);
  useCursor(hoverZone !== null && !!onKeySwitch);
  const zoneOf = useCallback((e: ThreeEvent<PointerEvent>): KeySwitch => {
    const lock = lockRef.current;
    if (!lock || e.object !== hitRef.current) return 'REM';
    lock.worldToLocal(_v.copy(e.point));
    return _v.x < -REM_HALF ? 'RUN' : _v.x > REM_HALF ? 'PROG' : 'REM';
  }, []);
  const keyHandlers = onKeySwitch
    ? {
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const z = zoneOf(e);
          hoverRef.current = z;
          setHoverZone(z);
        },
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const z = zoneOf(e);
          hoverRef.current = z;
          setHoverZone(z);
        },
        onPointerOut: () => {
          hoverRef.current = null;
          setHoverZone(null);
          keyDown.current = false;
        },
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          keyDown.current = true;
        },
        onPointerUp: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (keyDown.current && e.delta < 8) onKeySwitch(zoneOf(e));
          keyDown.current = false;
        },
      }
    : {};
  const hitGeo = cachedGeo('clx:keyhit', () => new THREE.BoxGeometry(ESC.w, ESC.h, 0.0008));

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={[MOD_W + 0.0018, MOD_H + 0.0018, 0.016]} center={[0, MOD_H / 2, FACE - 0.0065]} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={body} material={MAT.body()} castShadow />
        <ArtPlane tex={front} x0={ART_X0} x1={ART_X1} y0={ART_Y0} y1={ART_Y1} z={FACE + 0.0001} />
        <DotMatrixDisplay getText={getText} width={0.0248} height={0.0082} position={[0, DISPLAY_Y, FACE + 0.0002]} />
        <StatusLed get={runLed} position={[LED_COLS[0]!, LED_ROWS[0]!, LED_Z]} />
        <StatusLed get={forceLed} offColor="amber" position={[LED_COLS[1]!, LED_ROWS[0]!, LED_Z]} />
        <StatusLed get={sdLed} position={[LED_COLS[0]!, LED_ROWS[1]!, LED_Z]} />
        <StatusLed get={okLed} position={[LED_COLS[1]!, LED_ROWS[1]!, LED_Z]} />
        <StatusLed get={netLed} position={[LED_COLS[0]!, NET_Y, LED_Z]} />
        <StatusLed get={linkLed} position={[LED_COLS[1]!, NET_Y, LED_Z]} />

        {/* key switch on its raised escutcheon */}
        <ArtPlane tex={esc} x0={-ESC.w / 2} x1={ESC.w / 2} y0={ESC.cy - ESC.h / 2} y1={ESC.cy + ESC.h / 2} z={ESC_Z + 0.0001} />
        <group ref={lockRef} position={[0, KEY_Y, ESC_Z]} {...keyHandlers}>
          <mesh geometry={lockGeometry()} material={MAT.nickel()} />
          <group ref={keyRef} rotation-z={keyAngle.current}>
            <mesh geometry={keyway} material={MAT.hole()} position={[0, 0, 0.0025]} />
            <mesh geometry={keyGeometry()} material={MAT.nickel()} castShadow />
          </group>
          <mesh ref={ghostRef} geometry={keyGeometry()} material={ghostMat} visible={false} raycast={() => null} />
          <mesh
            ref={hitRef}
            geometry={hitGeo}
            material={MAT.invisible()}
            position={[0, ESC.cy - KEY_Y, 0.0005]}
            visible={!!onKeySwitch}
          />
        </group>

        {/* SD card door */}
        <group position={[0, SD_Y, FACE + 0.0006]}>
          <mesh geometry={sdDoor} material={MAT.face()} />
          <mesh geometry={sdPlane} material={texMaterial(sd)} position={[0, 0, 0.0006 + 0.00025]} />
        </group>

        <UsbBPort position={[0, USB_Y, FACE]} />
        {sideLabel && <SideLabel catalog={catalog} title="ControlLogix 5580 Controller" lines={SIDE_LINES[catalog]} height={MOD_H} />}

        {/* embedded Ethernet port on the underside, at the front */}
        <Rj45Jack position={[0, -0.0002, JACK_Z]} rotation={[Math.PI / 2, 0, 0]} />
        {cable && <PatchCable position={[0, -0.0002, JACK_Z]} color="#2f9d62" />}
      </Selectable>
    </group>
  );
}
