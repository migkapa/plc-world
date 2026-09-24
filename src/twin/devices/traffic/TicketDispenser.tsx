/**
 * Parking entry ticket dispenser (entry station column, SKIDATA / Amano / Designa style, no branding):
 * two-tone powder-coated column on a plinth with a tilted driver-height control face, rain hood,
 * backlit LCD message display, large illuminated "PRESS" push button, ticket mouth with a blinking
 * LED surround and an ejecting paper ticket, intercom speaker + HELP call button, contactless card
 * reader pad, instruction legends, service door lock.
 *
 * Origin: ground at the column center; the control face looks +Z (toward the driver's window).
 */
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import {
  boxGeo,
  canvasTex,
  circleGeo,
  cylZ,
  damp,
  hitMat,
  latheZ,
  makeCanvas,
  mergeAll,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedTex,
  tmats,
  usePress,
  xf,
} from './shared';

export interface TicketDispenserProps extends Placement {
  getPressed: () => boolean;
  onPress?: () => void;
  onRelease?: () => void;
  /** Push-button ring illumination (default: on). */
  getButtonLit?: () => boolean;
  /** A ticket is presented in the mouth (slides out). */
  getTicketOut?: () => boolean;
  /** Display message; use '\n' for two lines. Default "PRESS BUTTON\nFOR TICKET". */
  getMessage?: () => string;
  bodyColor?: string;
  accentColor?: string;
}

export const TICKET_DISPENSER_DIMS = {
  width: 0.42,
  depth: 0.36,
  height: 1.46,
  /** Height of the push button center. */
  buttonY: 1.08,
} as const;
const T = TICKET_DISPENSER_DIMS;

const FACE_Y0 = 0.9;
const FACE_Y1 = 1.36;
const TILT = Math.atan2(0.07, FACE_Y1 - FACE_Y0);

function bodyGeometry(): THREE.BufferGeometry {
  return sharedGeo('tkt:body', () => {
    const D = T.depth;
    const s = new THREE.Shape();
    // side profile in (z, y): back at -D/2, front at +D/2
    s.moveTo(-D / 2, 0.1);
    s.lineTo(D / 2, 0.1);
    s.lineTo(D / 2, FACE_Y0);
    s.lineTo(D / 2 - 0.07, FACE_Y1);
    s.lineTo(-D / 2, FACE_Y1);
    s.closePath();
    const bevel = 0.018;
    const g = new THREE.ExtrudeGeometry(s, { depth: T.width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 });
    g.translate(0, 0, -(T.width - 2 * bevel) / 2);
    g.rotateY(-Math.PI / 2); // shape x(z-profile) -> +Z, extrusion -> X
    g.computeVertexNormals();
    return g;
  });
}

function hoodGeometry(): THREE.BufferGeometry {
  return sharedGeo('tkt:hood', () => {
    const parts = [xf(roundedBox(T.width + 0.05, 0.06, T.depth + 0.07, 0.02, 3), [0, FACE_Y1 + 0.05, 0.02])];
    parts.push(xf(roundedBox(T.width + 0.02, 0.05, T.depth, 0.015, 2), [0, FACE_Y1 + 0.005, 0]));
    return mergeAll(parts);
  });
}

function messageTexture(msg: string): THREE.CanvasTexture {
  return sharedTex(`tkt:msg:${msg}`, () => {
    const [c, ctx] = makeCanvas(256, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#0b3a66');
    g.addColorStop(1, '#062544');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#e8f4ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = msg.split('\n');
    const px = lines.length > 2 ? 26 : 32;
    ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, 128, 64 + (i - (lines.length - 1) / 2) * px * 1.2));
    return canvasTex(c);
  });
}

function legendTexture(): THREE.CanvasTexture {
  return sharedTex('tkt:legend', () => {
    const [c, ctx] = makeCanvas(512, 1024);
    ctx.clearRect(0, 0, 512, 1024);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px Arial, Helvetica, sans-serif';
    ctx.fillText('PRESS FOR TICKET', 256, 470);
    // arrow down to the button
    ctx.beginPath();
    ctx.moveTo(236, 500);
    ctx.lineTo(276, 500);
    ctx.lineTo(276, 520);
    ctx.lineTo(296, 520);
    ctx.lineTo(256, 552);
    ctx.lineTo(216, 520);
    ctx.lineTo(236, 520);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 34px Arial, Helvetica, sans-serif';
    ctx.fillText('TAKE TICKET', 256, 815);
    ctx.font = 'bold 26px Arial, Helvetica, sans-serif';
    ctx.fillText('HELP', 110, 965);
    ctx.fillText('CARD', 400, 965);
    return canvasTex(c);
  });
}

function headerTexture(): THREE.CanvasTexture {
  return sharedTex('tkt:header', () => {
    const [c, ctx] = makeCanvas(512, 96);
    ctx.fillStyle = '#1d5fbf';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(18, 12, 72, 72, 10);
    ctx.fill();
    ctx.fillStyle = '#1d5fbf';
    ctx.font = 'bold 62px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', 54, 51);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 50px Arial, Helvetica, sans-serif';
    ctx.fillText('TICKET', 290, 50);
    return canvasTex(c);
  });
}

function grilleTexture(): THREE.CanvasTexture {
  return sharedTex('tkt:grille', () => {
    const [c, ctx] = makeCanvas(128, 128);
    ctx.fillStyle = '#9ea3a8';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#111';
    for (let y = 12; y < 128; y += 14) for (let x = 12 + ((y / 14) % 2) * 7; x < 128; x += 14) {
      if ((x - 64) ** 2 + (y - 64) ** 2 > 56 ** 2) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvasTex(c);
  });
}

function ticketTexture(): THREE.CanvasTexture {
  return sharedTex('tkt:ticket', () => {
    const [c, ctx] = makeCanvas(128, 64);
    ctx.fillStyle = '#fbfaf3';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#222';
    for (let x = 10; x < 118; x += 3) if ((x * 7) % 5 < 3) ctx.fillRect(x, 8, 2, 22);
    ctx.fillStyle = '#c21';
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.fillText('ENTRY 07:42', 18, 48);
    ctx.fillStyle = '#6b4a1a';
    ctx.fillRect(0, 56, 128, 5);
    return canvasTex(c);
  });
}

function buttonGeometry(): THREE.BufferGeometry {
  const r = 0.03;
  return latheZ(
    'tkt:btn',
    [
      [r, 0],
      [r, 0.008],
      [r - 0.003, 0.012],
      [r * 0.6, 0.0135],
      [0, 0.014],
    ],
    40,
    r,
  );
}

export function TicketDispenser({
  getPressed,
  onPress,
  onRelease,
  getButtonLit,
  getTicketOut,
  getMessage,
  bodyColor = '#c9ccd0',
  accentColor = '#22303f',
  position,
  rotation,
  scale,
}: TicketDispenserProps) {
  const { hovered, handlers } = usePress(onPress, onRelease);
  const btn = useRef<THREE.Group>(null);
  const ticket = useRef<THREE.Group>(null);
  const ringMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0c3d18', emissive: '#18ff5a', emissiveIntensity: 0, roughness: 0.25, toneMapped: false }),
    [],
  );
  const capMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#16a34a', emissive: '#22ff66', emissiveIntensity: 0, roughness: 0.3, toneMapped: false }),
    [],
  );
  const slotMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#2a2a2a', emissive: '#ffb020', emissiveIntensity: 0, roughness: 0.3, toneMapped: false }),
    [],
  );
  const screenMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: messageTexture('PRESS BUTTON\nFOR TICKET'), emissive: '#ffffff', emissiveMap: messageTexture('PRESS BUTTON\nFOR TICKET'), emissiveIntensity: 0.9, roughness: 0.25, toneMapped: false }),
    [],
  );
  const g = useRef({ getPressed, getButtonLit, getTicketOut, getMessage });
  g.current = { getPressed, getButtonLit, getTicketOut, getMessage };
  const lastMsg = useRef('PRESS BUTTON\nFOR TICKET');
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const pressed = g.current.getPressed();
    if (btn.current) btn.current.position.z = damp(btn.current.position.z, pressed ? -0.006 : 0, 30, dt);
    const lit = g.current.getButtonLit ? g.current.getButtonLit() : true;
    const pulse = 0.75 + 0.25 * Math.sin(t * 3);
    ringMat.emissiveIntensity = lit ? (pressed ? 5 : 2.6 * pulse) : 0;
    capMat.emissiveIntensity = lit ? (pressed ? 1.6 : 0.5) : 0;
    const out = g.current.getTicketOut?.() ?? false;
    if (ticket.current) {
      ticket.current.position.z = damp(ticket.current.position.z, out ? 0.06 : -0.02, 6, dt);
      ticket.current.visible = ticket.current.position.z > -0.015;
    }
    slotMat.emissiveIntensity = out ? (t % 0.5 < 0.25 ? 3 : 0.4) : 0.35;
    const msg = g.current.getMessage?.() ?? 'PRESS BUTTON\nFOR TICKET';
    if (msg !== lastMsg.current) {
      lastMsg.current = msg;
      const tex = messageTexture(msg);
      screenMat.map = tex;
      screenMat.emissiveMap = tex;
    }
  });

  const body = tmats.paint(bodyColor, 0.4, 0.45);
  const accent = tmats.paint(accentColor, 0.45, 0.3);
  const faceH = Math.hypot(FACE_Y1 - FACE_Y0, 0.07);
  // local face frame: origin at the bottom-center of the tilted face, +Y up the face, +Z out
  const faceZ = T.depth / 2 + 0.018;
  return (
    <group position={position} rotation={rotation} scale={scale}>
      {/* plinth */}
      <mesh geometry={roundedBox(T.width + 0.06, 0.1, T.depth + 0.06, 0.01, 2)} material={tmats.paint('#2b2e32', 0.6, 0.3)} position={[0, 0.05, 0]} castShadow receiveShadow />
      <mesh geometry={bodyGeometry()} material={body} castShadow receiveShadow />
      <mesh geometry={hoodGeometry()} material={accent} castShadow receiveShadow />
      {/* header on the hood front */}
      <mesh geometry={planeGeo(T.width, 0.075)} position={[0, FACE_Y1 + 0.05, T.depth / 2 + 0.056]}>
        <meshStandardMaterial map={headerTexture()} emissive="#ffffff" emissiveMap={headerTexture()} emissiveIntensity={0.35} roughness={0.35} />
      </mesh>
      {/* lower front: accent service door with lock and vent slots */}
      <mesh geometry={roundedBox(T.width - 0.06, 0.66, 0.006, 0.015, 2)} material={accent} position={[0, 0.5, faceZ - 0.012]} castShadow />
      <mesh geometry={cylZ(0.013, 0.013, 0.012, 16)} material={tmats.metal('#d0d4d7', 0.25)} position={[T.width / 2 - 0.07, 0.72, faceZ - 0.004]} />
      {[0.26, 0.29, 0.32, 0.35].map((y) => (
        <mesh key={y} geometry={boxGeo(0.22, 0.01, 0.004)} material={tmats.plastic('#0c0c0c', 0.8)} position={[0, y, faceZ - 0.008]} />
      ))}
      {/* tilted control face */}
      <group position={[0, FACE_Y0, faceZ - 0.018]} rotation={[-TILT, 0, 0]}>
        <mesh geometry={roundedBox(T.width - 0.04, faceH - 0.03, 0.01, 0.02, 2)} material={accent} position={[0, faceH / 2, 0.004]} />
        {/* legends */}
        <mesh geometry={planeGeo(T.width - 0.06, faceH - 0.04)} position={[0, faceH / 2, 0.0095]}>
          <meshStandardMaterial map={legendTexture()} transparent roughness={0.5} />
        </mesh>
        {/* display */}
        <mesh geometry={roundedBox(0.23, 0.13, 0.012, 0.01, 2)} material={tmats.plastic('#0a0a0a', 0.3)} position={[0, 0.37, 0.01]} />
        <mesh geometry={planeGeo(0.2, 0.1)} material={screenMat} position={[0, 0.37, 0.0165]} />
        {/* push button */}
        <group position={[0, T.buttonY - FACE_Y0 - 0.01, 0.009]} {...handlers}>
          <mesh geometry={cylZ(0.044, 0.046, 0.012, 40)} material={tmats.metal('#b8bcc0', 0.25)} position={[0, 0, 0.006]} />
          <mesh geometry={cylZ(0.036, 0.036, 0.013, 40)} material={ringMat} position={[0, 0, 0.007]} />
          <group ref={btn}>
            <mesh geometry={buttonGeometry()} material={capMat} position={[0, 0, 0.006]} castShadow />
          </group>
          <mesh geometry={boxGeo(0.16, 0.16, 0.06)} material={hitMat()} position={[0, 0, 0.02]} />
          {hovered && (
            <mesh geometry={circleGeo(0.052, 40)} position={[0, 0, 0.0125]}>
              <meshBasicMaterial color="#7dd3fc" transparent opacity={0.45} toneMapped={false} />
            </mesh>
          )}
        </group>
        {/* ticket mouth */}
        <group position={[0, 0.095, 0.01]}>
          <mesh geometry={roundedBox(0.15, 0.04, 0.014, 0.008, 2)} material={slotMat} />
          <mesh geometry={boxGeo(0.105, 0.006, 0.02)} material={tmats.black()} position={[0, 0, 0.001]} />
          <group ref={ticket} position={[0, 0, -0.02]}>
            <mesh geometry={planeGeo(0.1, 0.075)} position={[0, 0, 0.0375]} rotation={[-Math.PI / 2 + 0.25, 0, 0]}>
              <meshStandardMaterial map={ticketTexture()} roughness={0.8} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
        {/* intercom: speaker grille + HELP button, contactless reader */}
        <mesh geometry={circleGeo(0.032, 32)} position={[-0.105, 0.045, 0.0105]}>
          <meshStandardMaterial map={grilleTexture()} roughness={0.5} metalness={0.4} />
        </mesh>
        <mesh geometry={cylZ(0.012, 0.012, 0.01, 20)} material={tmats.plastic('#f1c21b', 0.4)} position={[-0.105, 0.045, 0.012]} />
        <mesh geometry={roundedBox(0.075, 0.075, 0.008, 0.01, 2)} material={tmats.plastic('#101418', 0.3)} position={[0.105, 0.045, 0.012]} />
        <mesh geometry={contactlessGeo()} material={tmats.plastic('#e8eef3', 0.4)} position={[0.105, 0.045, 0.0165]} />
      </group>
      {/* side lock + service label */}
      <mesh geometry={cylX(0.012, 0.012, 0.01, 16)} material={tmats.metal('#d0d4d7', 0.25)} position={[T.width / 2 + 0.018, 1.0, -0.05]} />
    </group>
  );
}

function cylX(rTop: number, rBottom: number, len: number, seg: number): THREE.BufferGeometry {
  return sharedGeo(`tkt:cylx:${rTop}:${rBottom}:${len}:${seg}`, () => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

/** Contactless "waves" symbol (three arcs). */
function contactlessGeo(): THREE.BufferGeometry {
  return sharedGeo('tkt:contactless', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const r = 0.008 + i * 0.007;
      const s = new THREE.Shape();
      s.absarc(-0.012, 0, r + 0.0018, -0.7, 0.7, false);
      s.absarc(-0.012, 0, r - 0.0018, 0.7, -0.7, true);
      s.closePath();
      parts.push(new THREE.ShapeGeometry(s, 8));
    }
    return mergeAll(parts);
  });
}
