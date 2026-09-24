/**
 * Base-mounted traffic signal controller cabinet (NEMA TS-2 "P"-size style, ≈ 55" H × 44" W × 26" D):
 * mill-finish aluminum body with a sloped overhanging roof, rain drip over the door, louvered filtered
 * intake vents, 3-point latch handle with padlock hasp, piano hinges, a small POLICE PANEL door (for
 * flash / manual switches), anchor pad on a concrete base. The main door swings open (`doorAngle`) to
 * reveal the interior back panel where the controller (e.g. a CompactLogix rack) is mounted.
 *
 * Origin: ground at the cabinet center; the door faces +Z. Interior children use back-panel
 * coordinates (origin = center of the back panel's front surface, +Z toward the door).
 */
import { useFrame } from '@react-three/fiber';
import { useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Placement } from '../../contracts';
import { INCH, boxGeo, canvasTex, cylY, makeCanvas, mergeAll, planeGeo, roundedBox, sharedGeo, sharedMat, sharedTex, tmats, xf } from './shared';

export interface SignalCabinetProps extends Placement {
  /** Main door open angle (rad, 0 = closed). Ignored when `getDoorAngle` is given. */
  doorAngle?: number;
  getDoorAngle?: () => number;
  onDoorClick?: () => void;
  /** Interior equipment (back-panel coordinates). */
  children?: ReactNode;
  /** Items on the police panel (panel-local coords: origin = panel center, +Z out). */
  policePanel?: ReactNode;
  /** Body finish color (default mill-finish aluminum). */
  color?: string;
  /** Cabinet ID stenciled on the door. */
  label?: string;
}

export const SIGNAL_CABINET_DIMS = {
  width: 44 * INCH,
  height: 55 * INCH,
  depth: 26 * INCH,
  base: 0.12,
} as const;
const C = SIGNAL_CABINET_DIMS;

function stencilTexture(text: string): THREE.CanvasTexture {
  return sharedTex(`cab:stencil:${text}`, () => {
    const [c, ctx] = makeCanvas(512, 160);
    ctx.clearRect(0, 0, 512, 160);
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px "Arial Narrow", Arial, Helvetica, sans-serif';
    ctx.fillText(text, 256, 52);
    ctx.font = 'bold 30px Arial, Helvetica, sans-serif';
    ctx.fillText('DANGER — 120 VAC', 256, 118);
    return canvasTex(c);
  });
}

function policeTexture(): THREE.CanvasTexture {
  return sharedTex('cab:police', () => {
    const [c, ctx] = makeCanvas(256, 64);
    ctx.fillStyle = '#e8e8e2';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 34px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLICE', 128, 33);
    return canvasTex(c);
  });
}

export function SignalCabinet({ doorAngle = 0, getDoorAngle, onDoorClick, children, policePanel, color = '#b9bec2', label = 'SIGNAL CONTROLLER', position, rotation, scale }: SignalCabinetProps) {
  const door = useRef<THREE.Group>(null);
  const g = useRef(getDoorAngle);
  g.current = getDoorAngle;
  useFrame(() => {
    if (door.current) door.current.rotation.y = -(g.current ? g.current() : doorAngle);
  });
  const body = sharedMat(`cab:body:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.7 }));
  const W = C.width;
  const H = C.height;
  const D = C.depth;
  const B = C.base;
  const shell = sharedGeo('cab:shell', () => {
    const t = 0.004;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(xf(boxGeo(W, H, t), [0, B + H / 2, -D / 2 + t / 2])); // back
    for (const s of [-1, 1]) parts.push(xf(boxGeo(t, H, D), [s * (W / 2 - t / 2), B + H / 2, 0])); // sides
    parts.push(xf(boxGeo(W, t, D), [0, B + t / 2, 0])); // floor
    // sloped roof with overhang + drip edge
    const roof = new THREE.Shape();
    roof.moveTo(-D / 2 - 0.04, 0);
    roof.lineTo(D / 2 + 0.06, 0);
    roof.lineTo(D / 2 + 0.06, 0.02);
    roof.lineTo(-D / 2 - 0.04, 0.06);
    roof.closePath();
    const rg = new THREE.ExtrudeGeometry(roof, { depth: W + 0.06, bevelEnabled: false });
    rg.translate(0, 0, -(W + 0.06) / 2);
    rg.rotateY(-Math.PI / 2);
    parts.push(xf(rg, [0, B + H, 0]));
    // rain drip over the door
    parts.push(xf(boxGeo(W - 0.04, 0.012, 0.03), [0, B + H - 0.03, D / 2 + 0.015]));
    // door frame lip
    for (const s of [-1, 1]) parts.push(xf(boxGeo(0.03, H - 0.02, 0.012), [s * (W / 2 - 0.015), B + H / 2, D / 2 - 0.006]));
    return mergeAll(parts);
  });
  const baseG = sharedGeo('cab:base', () => mergeAll([xf(roundedBox(W + 0.3, 0.2, D + 0.3, 0.02, 1), [0, 0.02, 0]), xf(boxGeo(W + 0.02, B - 0.12, D + 0.02), [0, 0.12 + (B - 0.12) / 2, 0])]));
  const doorW = W - 0.02;
  const doorH = H - 0.06;
  const doorParts = sharedGeo('cab:door', () => {
    const parts: THREE.BufferGeometry[] = [xf(roundedBox(doorW, doorH, 0.02, 0.006, 1), [doorW / 2, 0, 0.01])];
    // stiffener flange around the door inside
    parts.push(xf(boxGeo(doorW - 0.04, 0.02, 0.03), [doorW / 2, doorH / 2 - 0.03, -0.015]));
    parts.push(xf(boxGeo(doorW - 0.04, 0.02, 0.03), [doorW / 2, -doorH / 2 + 0.03, -0.015]));
    // police panel door (upper right)
    parts.push(xf(roundedBox(0.22, 0.28, 0.012, 0.004, 1), [doorW - 0.2, doorH / 2 - 0.3, 0.026]));
    return mergeAll(parts);
  });
  const vents = sharedGeo('cab:vents', () => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) parts.push(xf(boxGeo(doorW * 0.6, 0.012, 0.02), [doorW / 2, -doorH / 2 + 0.08 + i * 0.03, 0.028], [0.6, 0, 0]));
    return mergeAll(parts);
  });
  const hardware = sharedGeo('cab:hw', () => {
    const parts: THREE.BufferGeometry[] = [];
    // piano hinge along the left edge
    parts.push(xf(cylY(0.008, 0.008, doorH - 0.08, 10), [-0.004, 0, 0.02]));
    // 3-point latch handle + hasp
    parts.push(xf(roundedBox(0.04, 0.2, 0.02, 0.008, 2), [doorW - 0.07, 0, 0.03]));
    parts.push(xf(roundedBox(0.03, 0.14, 0.03, 0.01, 2), [doorW - 0.07, -0.02, 0.05]));
    parts.push(xf(boxGeo(0.05, 0.015, 0.03), [doorW - 0.07, 0.13, 0.035]));
    // lock cylinder
    parts.push(xf(cylY(0.012, 0.012, 0.02, 14), [doorW - 0.07, 0.17, 0.03], [Math.PI / 2, 0, 0]));
    // police panel hinge + keyhole
    parts.push(xf(cylY(0.006, 0.006, 0.26, 8), [doorW - 0.31, doorH / 2 - 0.3, 0.03]));
    parts.push(xf(cylY(0.01, 0.01, 0.015, 12), [doorW - 0.12, doorH / 2 - 0.3, 0.035], [Math.PI / 2, 0, 0]));
    return mergeAll(parts);
  });
  const handlers = onDoorClick
    ? {
        onPointerDown: (e: { stopPropagation: () => void }) => {
          e.stopPropagation();
          onDoorClick();
        },
      }
    : {};
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={baseG} material={tmats.concrete()} receiveShadow castShadow />
      <mesh geometry={shell} material={body} castShadow receiveShadow />
      {/* interior: white back panel + side rails */}
      <mesh geometry={planeGeo(W - 0.06, H - 0.1)} position={[0, B + H / 2, -D / 2 + 0.006]} material={tmats.paint('#eeeeea', 0.7, 0)} receiveShadow />
      <mesh geometry={boxGeo(W - 0.06, 0.02, D - 0.1)} position={[0, B + H * 0.35, -0.03]} material={tmats.paint('#d9d9d4', 0.7, 0.2)} castShadow receiveShadow />
      <group position={[0, B + H / 2, -D / 2 + 0.008]}>{children}</group>
      {/* main door (hinged on the left edge) */}
      <group ref={door} position={[-doorW / 2, B + H / 2 - 0.01, D / 2]} {...handlers}>
        <mesh geometry={doorParts} material={body} castShadow receiveShadow />
        <mesh geometry={vents} material={tmats.metal('#8f9498', 0.5)} />
        <mesh geometry={hardware} material={tmats.metal('#d3d7da', 0.25)} castShadow />
        <mesh geometry={planeGeo(0.5, 0.156)} position={[doorW / 2 - 0.05, 0.12, 0.0205]}>
          <meshStandardMaterial map={stencilTexture(label)} transparent roughness={0.6} />
        </mesh>
        <mesh geometry={planeGeo(0.12, 0.03)} position={[doorW - 0.2, doorH / 2 - 0.19, 0.0325]}>
          <meshStandardMaterial map={policeTexture()} roughness={0.5} />
        </mesh>
        <group position={[doorW - 0.2, doorH / 2 - 0.3, 0.033]}>{policePanel}</group>
      </group>
    </group>
  );
}
