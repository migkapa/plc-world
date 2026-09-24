/**
 * PLC training lab room around the trainer bench: vinyl-tile floor, painted walls with skirting, a window
 * with daylight, a whiteboard with a hand-drawn ladder diagram, a lab stool, a storage cabinet, a wall
 * outlet, ceiling light panels and a few small props. Static; world coordinates (the bench is at the origin,
 * its back against the wall at z = -0.62).
 */
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { FONT, Instances, KBOX, KCYL, KPLANE, SignPlate, Slab, TexturedFloor, TexturedWall, canvasTexture, drawSafetySign, kgeo, km, kmat, mulberry, plasterTexture, vinylTileTexture } from './kit';

export const ROOM = {
  backZ: -0.64,
  leftX: -2.75,
  rightX: 3.4,
  frontZ: 4.2,
  height: 3.0,
  window: { z0: 0.35, z1: 1.95, y0: 0.95, y1: 2.3 },
} as const;

const WALL = '#d3cfc6';
/** Lower wall band (behind the bench) and chair rail: gives the bench a darker backdrop. */
const DADO = '#5d7282';
const DADO_H = 1.0;
const SKIRT = '#3b3f44';

// ---------------------------------------------------------------------------
// Whiteboard with a ladder sketch
// ---------------------------------------------------------------------------

function whiteboardTexture() {
  return canvasTexture('wb-ladder-v2', 2048, 1280, (ctx, w, h) => {
    const rnd = mulberry(31);
    ctx.fillStyle = '#fbfcfc';
    ctx.fillRect(0, 0, w, h);
    // ghosting of old erased writing
    ctx.strokeStyle = 'rgba(120,130,150,0.07)';
    ctx.lineWidth = 18;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(rnd() * w, rnd() * h);
      ctx.bezierCurveTo(rnd() * w, rnd() * h, rnd() * w, rnd() * h, rnd() * w, rnd() * h);
      ctx.stroke();
    }
    const hand = `"Segoe Print", "Comic Sans MS", "Chalkboard SE", "Marker Felt", "Inter Variable", Inter, sans-serif`;
    const jitter = (v: number) => v + (rnd() - 0.5) * 3;
    const line = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.beginPath();
      ctx.moveTo(jitter(x0), jitter(y0));
      ctx.quadraticCurveTo(jitter((x0 + x1) / 2), jitter((y0 + y1) / 2), jitter(x1), jitter(y1));
      ctx.stroke();
    };
    const blue = '#1f4fa8';
    const black = '#1d1f22';
    const red = '#c02a2a';
    const green = '#1f7a3f';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // title
    ctx.fillStyle = black;
    ctx.font = `700 70px ${hand}`;
    ctx.fillText('LAB 2 - Start / Stop seal-in (bench)', 90, 120);
    ctx.strokeStyle = black;
    ctx.lineWidth = 5;
    line(90, 140, 960, 146);
    // rails
    const L = 170;
    const R = 1420;
    ctx.strokeStyle = blue;
    ctx.lineWidth = 7;
    line(L, 240, L, 1080);
    line(R, 240, R, 1080);
    const contact = (x: number, y: number, nc: boolean, label: string, color = blue) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      line(x, y - 38, x, y + 38);
      line(x + 44, y - 38, x + 44, y + 38);
      if (nc) line(x - 8, y + 34, x + 52, y - 34);
      ctx.fillStyle = black;
      ctx.font = `600 38px ${hand}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + 22, y - 58);
      ctx.textAlign = 'left';
    };
    const coil = (x: number, y: number, label: string) => {
      ctx.strokeStyle = blue;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(x + 10, y, 42, Math.PI * 0.62, Math.PI * 1.38);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 50, y, 42, -Math.PI * 0.38, Math.PI * 0.38);
      ctx.stroke();
      ctx.fillStyle = black;
      ctx.font = `600 38px ${hand}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + 30, y - 58);
      ctx.textAlign = 'left';
    };
    // rung 0: seal-in with the bench buttons: PB_Green starts, Light_0 seals in, PB_Red (N.C.) stops
    let y = 380;
    ctx.fillStyle = black;
    ctx.font = `600 34px ${hand}`;
    ctx.fillText('0', L - 60, y + 12);
    ctx.strokeStyle = blue;
    ctx.lineWidth = 6;
    line(L, y, 270, y);
    contact(270, y, false, 'PB_Green');
    line(314, y, 520, y);
    // seal-in branch
    line(230, y, 230, y + 170);
    line(230, y + 170, 270, y + 170);
    contact(270, y + 170, false, 'Light_0');
    line(314, y + 170, 470, y + 170);
    line(470, y + 170, 470, y);
    contact(520, y, false, 'PB_Red');
    line(564, y, 1200, y);
    coil(1200, y, 'Light_0');
    line(1262, y, R, y);
    // note about the N.C. stop button
    ctx.strokeStyle = red;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(542, y - 70, 120, 34, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = red;
    ctx.font = `600 34px ${hand}`;
    ctx.fillText('N.C. button -> XIC !', 470, y - 120);
    ctx.fillStyle = green;
    ctx.fillText('seal-in', 250, y + 250);
    // rung 1: both black buttons -> buzzer
    y = 760;
    ctx.fillStyle = black;
    ctx.fillText('1', L - 60, y + 12);
    ctx.strokeStyle = blue;
    ctx.lineWidth = 6;
    line(L, y, 270, y);
    contact(270, y, false, 'PB_Black_1');
    line(314, y, 520, y);
    contact(520, y, false, 'PB_Black_2');
    line(564, y, 1200, y);
    coil(1200, y, 'Buzzer');
    line(1262, y, R, y);
    // rung 2: XIO example
    y = 960;
    ctx.fillStyle = black;
    ctx.fillText('2', L - 60, y + 12);
    ctx.strokeStyle = blue;
    ctx.lineWidth = 6;
    line(L, y, 270, y);
    contact(270, y, true, 'Switch_0');
    line(314, y, 1200, y);
    coil(1200, y, 'Light_4');
    line(1262, y, R, y);
    // side notes
    ctx.fillStyle = green;
    ctx.font = `700 44px ${hand}`;
    ctx.fillText('XIC = "examine if closed"', 1510, 300);
    ctx.fillText('XIO = "examine if open"', 1510, 370);
    ctx.fillStyle = black;
    ctx.font = `600 36px ${hand}`;
    ctx.fillText('PB_Green = Local:1:I.Data.8', 1510, 480);
    ctx.fillText('PB_Red   = Local:1:I.Data.9 (N.C.)', 1510, 535);
    ctx.fillText('Light_0  = Local:2:O.Data.0', 1510, 590);
    ctx.fillText('Buzzer   = Local:2:O.Data.8', 1510, 645);
    ctx.fillStyle = red;
    ctx.font = `700 46px ${hand}`;
    ctx.fillText('Key: REM -> RUN', 1510, 770);
    ctx.fillStyle = blue;
    ctx.font = `600 38px ${hand}`;
    ctx.fillText('Quiz Fri: timers (TON)', 1510, 900);
    // frame shadow line at the bottom
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, h - 20, w, 20);
  });
}

function Whiteboard({ position }: { position: Vec3 }) {
  const tex = whiteboardTexture();
  const W = 1.6;
  const H = 1.0;
  const frame = km.metal('#c7ccd1', 0.35);
  return (
    <group position={position}>
      <mesh geometry={KBOX()} material={km.paint('#f5f6f6', 0.25)} scale={[W, H, 0.012]} position={[0, 0, 0.006]} />
      <mesh geometry={KPLANE()} material={kmat('k:wb', () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.18, metalness: 0 }))} scale={[W - 0.02, H - 0.02, 1]} position={[0, 0, 0.0125]} />
      {/* aluminum frame */}
      <mesh geometry={KBOX()} material={frame} scale={[W + 0.03, 0.018, 0.02]} position={[0, H / 2 + 0.006, 0.01]} />
      <mesh geometry={KBOX()} material={frame} scale={[W + 0.03, 0.018, 0.02]} position={[0, -H / 2 - 0.006, 0.01]} />
      <mesh geometry={KBOX()} material={frame} scale={[0.018, H + 0.03, 0.02]} position={[-W / 2 - 0.006, 0, 0.01]} />
      <mesh geometry={KBOX()} material={frame} scale={[0.018, H + 0.03, 0.02]} position={[W / 2 + 0.006, 0, 0.01]} />
      {/* marker tray with markers + eraser */}
      <mesh geometry={KBOX()} material={frame} scale={[W * 0.7, 0.012, 0.06]} position={[0, -H / 2 - 0.02, 0.035]} castShadow />
      {[
        ['#1f4fa8', -0.3],
        ['#1d1f22', -0.22],
        ['#c02a2a', -0.16],
        ['#1f7a3f', -0.1],
      ].map(([c, x]) => (
        <mesh key={String(x)} geometry={KCYL()} material={km.plastic(String(c), 0.4)} rotation={[0, 0, Math.PI / 2]} scale={[0.017, 0.13, 0.017]} position={[Number(x), -H / 2 - 0.006, 0.04]} castShadow />
      ))}
      <mesh geometry={KBOX()} material={km.plastic('#2b2b2b', 0.8)} scale={[0.14, 0.03, 0.05]} position={[0.25, -H / 2 + 0.001, 0.04]} castShadow />
      <mesh geometry={KBOX()} material={km.plastic('#e8e2cf', 0.9)} scale={[0.14, 0.012, 0.05]} position={[0.25, -H / 2 - 0.02, 0.04]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Window (daylight) on the left wall
// ---------------------------------------------------------------------------

function skyTexture() {
  return canvasTexture('lab-sky', 512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#9cc6f0');
    g.addColorStop(0.62, '#dcebf7');
    g.addColorStop(0.64, '#8fa38a');
    g.addColorStop(1, '#6f8468');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // distant building
    ctx.fillStyle = '#b8c0c8';
    ctx.fillRect(w * 0.08, h * 0.44, w * 0.42, h * 0.2);
    ctx.fillStyle = '#a3acb5';
    for (let i = 0; i < 7; i++) ctx.fillRect(w * 0.1 + i * w * 0.055, h * 0.48, w * 0.03, h * 0.04);
    // trees
    const rnd = mulberry(3);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${70 + rnd() * 30},${100 + rnd() * 30},${60 + rnd() * 20},0.9)`;
      ctx.beginPath();
      ctx.arc(w * (0.5 + rnd() * 0.5), h * (0.58 + rnd() * 0.05), 18 + rnd() * 26, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function Window() {
  const { z0, z1, y0, y1 } = ROOM.window;
  const x = ROOM.leftX;
  const wz = z1 - z0;
  const wy = y1 - y0;
  const cz = (z0 + z1) / 2;
  const cy = (y0 + y1) / 2;
  const frame = km.paint('#eceeed', 0.45);
  const sky = kmat('k:lab-sky', () => new THREE.MeshBasicMaterial({ map: skyTexture(), toneMapped: false, color: new THREE.Color(1.45, 1.45, 1.45) }));
  // horizontal blind slats (instanced), top third pulled down
  const slats = useMemo(() => {
    const out: { p: Vec3; r: Vec3 }[] = [];
    for (let i = 0; i < 16; i++) out.push({ p: [x + 0.06, y1 - 0.03 - i * 0.028, cz], r: [0.5, 0, 0] });
    return out;
  }, [x, y1, cz]);
  const slatGeo = kgeo('k:slat', () => new THREE.BoxGeometry(0.004, 0.026, wz - 0.06).rotateX(0));
  return (
    <group>
      <mesh geometry={KPLANE()} material={sky} rotation={[0, Math.PI / 2, 0]} position={[x - 0.12, cy, cz]} scale={[wz, wy, 1]} />
      {/* reveal (wall thickness) */}
      <Slab min={[x - 0.12, y0 - 0.005, z0 - 0.02]} max={[x, y0, z1 + 0.02]} material={frame} />
      <Slab min={[x - 0.12, y1, z0 - 0.02]} max={[x, y1 + 0.005, z1 + 0.02]} material={frame} />
      <Slab min={[x - 0.12, y0, z0 - 0.02]} max={[x, y1, z0]} material={frame} />
      <Slab min={[x - 0.12, y0, z1]} max={[x, y1, z1 + 0.02]} material={frame} />
      {/* frame + mullion */}
      <Slab min={[x - 0.1, y0, z0]} max={[x - 0.06, y0 + 0.05, z1]} material={frame} />
      <Slab min={[x - 0.1, y1 - 0.05, z0]} max={[x - 0.06, y1, z1]} material={frame} />
      <Slab min={[x - 0.1, y0, z0]} max={[x - 0.06, y1, z0 + 0.05]} material={frame} />
      <Slab min={[x - 0.1, y0, z1 - 0.05]} max={[x - 0.06, y1, z1]} material={frame} />
      <Slab min={[x - 0.1, y0, cz - 0.025]} max={[x - 0.06, y1, cz + 0.025]} material={frame} />
      {/* sill */}
      <Slab min={[x, y0 - 0.03, z0 - 0.06]} max={[x + 0.16, y0, z1 + 0.06]} material={km.paint('#e7e4dc', 0.35)} castShadow />
      {/* blinds (partially lowered) */}
      <Instances geometry={slatGeo} material={km.paint('#f2f2ef', 0.5)} items={slats} castShadow={false} />
      <Slab min={[x + 0.035, y1 - 0.02, z0]} max={[x + 0.085, y1 + 0.03, z1]} material={km.paint('#f2f2ef', 0.5)} />
    </group>
  );
}

/** Soft sun patch cast through the window onto the floor (additive decal, no extra shadow pass). */
function sunPatchTexture() {
  return canvasTexture(
    'lab-sunpatch',
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      // two panes (mullion shadow in the middle) with soft edges
      ctx.filter = 'blur(10px)';
      ctx.fillStyle = '#fff';
      ctx.fillRect(w * 0.1, h * 0.12, w * 0.8, h * 0.34);
      ctx.fillRect(w * 0.1, h * 0.54, w * 0.8, h * 0.34);
      ctx.filter = 'none';
      // blind slat stripes
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let x = w * 0.12; x < w * 0.9; x += w * 0.07) ctx.fillRect(x, 0, w * 0.018, h);
    },
    { color: false },
  );
}

/**
 * Warm daylight through the window: a directional light from outside the left wall (no shadows: the main
 * light owns them) plus a sun-patch decal on the floor in front of the window.
 */
export function WindowLight() {
  const { z0, z1 } = ROOM.window;
  const mat = kmat(
    'k:lab-sunpatch',
    () =>
      new THREE.MeshBasicMaterial({
        map: sunPatchTexture(),
        color: new THREE.Color('#ffd9a0').multiplyScalar(0.34),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
  );
  return (
    <group>
      <directionalLight position={[ROOM.leftX - 3, 3.0, (z0 + z1) / 2 + 0.6]} intensity={1.15} color="#ffe2b8" />
      <mesh geometry={KPLANE()} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[ROOM.leftX + 1.25, 0.003, (z0 + z1) / 2 + 0.25]} scale={[1.9, z1 - z0 + 0.3, 1]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Stool, storage cabinet, outlet, ceiling panels, bin
// ---------------------------------------------------------------------------

function LabStool({ position }: { position: Vec3 }) {
  const chrome = km.metal('#d3d7da', 0.22);
  const legGeo = kgeo('k:stoolleg', () => new THREE.CylinderGeometry(0.011, 0.012, 0.64, 12));
  const legs = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return { p: [Math.cos(a) * 0.16, 0.31, Math.sin(a) * 0.16] as Vec3, r: [Math.sin(a) * -0.18, 0, Math.cos(a) * 0.18] as Vec3 };
      }),
    [],
  );
  return (
    <group position={position}>
      <Instances geometry={legGeo} material={chrome} items={legs} />
      <mesh geometry={kgeo('k:stoolring', () => new THREE.TorusGeometry(0.17, 0.008, 8, 40))} material={chrome} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.24, 0]} castShadow />
      <mesh geometry={KCYL()} material={km.metal('#3a3d41', 0.5)} scale={[0.09, 0.03, 0.09]} position={[0, 0.63, 0]} />
      <mesh geometry={kgeo('k:stoolseat', () => new THREE.CylinderGeometry(0.175, 0.17, 0.055, 36))} material={km.plastic('#1f2429', 0.55)} position={[0, 0.672, 0]} castShadow receiveShadow />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return <mesh key={i} geometry={KCYL()} material={km.plastic('#222', 0.8)} scale={[0.026, 0.012, 0.026]} position={[Math.cos(a) * 0.215, 0.006, Math.sin(a) * 0.215]} />;
      })}
    </group>
  );
}

function StorageCabinet({ position }: { position: Vec3 }) {
  const body = km.paint('#c5c9cc', 0.5);
  const W = 0.9;
  const H = 1.95;
  const D = 0.45;
  return (
    <group position={position}>
      <Slab min={[-W / 2, 0.02, -D / 2]} max={[W / 2, H, D / 2]} material={body} castShadow />
      <Slab min={[-W / 2 + 0.005, 0.03, D / 2]} max={[-0.003, H - 0.01, D / 2 + 0.012]} material={body} castShadow />
      <Slab min={[0.003, 0.03, D / 2]} max={[W / 2 - 0.005, H - 0.01, D / 2 + 0.012]} material={body} castShadow />
      {[-1, 1].map((s) => (
        <mesh key={s} geometry={KBOX()} material={km.metal('#8e949a', 0.3)} scale={[0.012, 0.16, 0.02]} position={[s * 0.035, 1.05, D / 2 + 0.022]} />
      ))}
      <mesh geometry={KBOX()} material={km.plastic('#1b1d20')} scale={[W, 0.02, D]} position={[0, 0.01, 0]} />
      {/* label holder */}
      <SignPlate
        id="cab-label"
        size={[0.16, 0.05]}
        position={[-0.22, 1.6, D / 2 + 0.013]}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#fbfbf7';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#222';
          ctx.font = `700 ${h * 0.42}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('SPARE MODULES', w / 2, h / 2);
        }}
      />
      {/* boxes on top */}
      <Slab min={[-0.35, H, -0.15]} max={[-0.02, H + 0.2, 0.18]} material={km.paint('#b98c5d', 0.85)} castShadow />
      <Slab min={[0.05, H, -0.12]} max={[0.33, H + 0.14, 0.14]} material={km.paint('#a97d51', 0.85)} castShadow />
    </group>
  );
}

function WallOutlet({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh geometry={KBOX()} material={km.plastic('#f1f0ea', 0.4)} scale={[0.075, 0.12, 0.008]} position={[0, 0, 0.004]} />
      {[-0.028, 0.028].map((y) => (
        <group key={y} position={[0, y, 0.009]}>
          <mesh geometry={KBOX()} material={km.plastic('#e9e7df', 0.4)} scale={[0.036, 0.042, 0.004]} />
          {[-0.007, 0.007].map((x) => (
            <mesh key={x} geometry={KBOX()} material={km.basic('#1a1a1a')} scale={[0.0025, 0.009, 0.002]} position={[x, 0.005, 0.002]} />
          ))}
        </group>
      ))}
    </group>
  );
}

function CeilingPanel({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh geometry={KBOX()} material={km.paint('#e8e9e6', 0.5)} scale={[0.62, 0.03, 1.22]} />
      <mesh geometry={KBOX()} material={km.emissive('#fbfbff', 1.6)} scale={[0.56, 0.005, 1.16]} position={[0, -0.016, 0]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export function LabRoom() {
  const plaster = plasterTexture();
  const { backZ, leftX, rightX, frontZ, height } = ROOM;
  const w = rightX - leftX;
  const d = frontZ - backZ;
  const cx = (leftX + rightX) / 2;
  const cz = (backZ + frontZ) / 2;
  const win = ROOM.window;
  return (
    <group>
      <TexturedFloor center={[cx, cz]} size={[w, d]} texture={vinylTileTexture()} tile={1.2} roughness={0.42} />
      {/* back wall: painted dado band behind the bench + chair rail */}
      <TexturedWall position={[cx, (height + DADO_H) / 2, backZ]} size={[w, height - DADO_H]} texture={plaster} tile={[1.5, 1.5]} color={WALL} />
      <TexturedWall position={[cx, DADO_H / 2, backZ]} size={[w, DADO_H]} texture={plaster} tile={[1.5, 1.5]} color={DADO} />
      <Slab min={[leftX, DADO_H - 0.012, backZ]} max={[rightX, DADO_H + 0.012, backZ + 0.014]} material={km.paint('#e9e6df', 0.45)} />
      {/* left wall with window opening (4 pieces) */}
      <group>
        <TexturedWall position={[leftX, height / 2, (backZ + win.z0) / 2]} rotation={[0, Math.PI / 2, 0]} size={[win.z0 - backZ, height]} texture={plaster} tile={[1.5, 1.5]} color={WALL} />
        <TexturedWall position={[leftX, height / 2, (win.z1 + frontZ) / 2]} rotation={[0, Math.PI / 2, 0]} size={[frontZ - win.z1, height]} texture={plaster} tile={[1.5, 1.5]} color={WALL} />
        <TexturedWall position={[leftX, win.y0 / 2, (win.z0 + win.z1) / 2]} rotation={[0, Math.PI / 2, 0]} size={[win.z1 - win.z0, win.y0]} texture={plaster} tile={[1.5, 1.5]} color={WALL} />
        <TexturedWall position={[leftX, (win.y1 + height) / 2, (win.z0 + win.z1) / 2]} rotation={[0, Math.PI / 2, 0]} size={[win.z1 - win.z0, height - win.y1]} texture={plaster} tile={[1.5, 1.5]} color={WALL} />
      </group>
      {/* right wall */}
      <TexturedWall position={[rightX, height / 2, cz]} rotation={[0, -Math.PI / 2, 0]} size={[d, height]} texture={plaster} tile={[1.5, 1.5]} color={WALL} />
      {/* skirting */}
      <Slab min={[leftX, 0, backZ]} max={[rightX, 0.1, backZ + 0.012]} material={km.plastic(SKIRT, 0.6)} />
      <Slab min={[leftX, 0, backZ]} max={[leftX + 0.012, 0.1, frontZ]} material={km.plastic(SKIRT, 0.6)} />
      <Slab min={[rightX - 0.012, 0, backZ]} max={[rightX, 0.1, frontZ]} material={km.plastic(SKIRT, 0.6)} />
      {/* ceiling (hidden from below-horizon cameras, closes the reflections) */}
      <mesh geometry={KPLANE()} material={km.paint('#e3e4e0', 0.9)} rotation={[Math.PI / 2, 0, 0]} position={[cx, height, cz]} scale={[w, d, 1]} />
      {[
        [-1.2, 0.9],
        [1.4, 0.9],
        [-1.2, 2.9],
        [1.4, 2.9],
      ].map(([x, z]) => (
        <CeilingPanel key={`${x}:${z}`} position={[x!, height - 0.02, z!]} />
      ))}
      <Window />
      <Whiteboard position={[2.45, 1.55, backZ]} />
      <StorageCabinet position={[-2.15, 0, backZ + 0.24]} />
      <LabStool position={[-0.05, 0, 0.78]} />
      <WallOutlet position={[-1.45, 0.38, backZ]} />
      <WallOutlet position={[1.3, 0.38, backZ]} />
      {/* lab rules sign next to the whiteboard */}
      <SignPlate id="lab-rules" size={[0.3, 0.2]} position={[1.1, 1.85, backZ + 0.001]} draw={drawSafetySign('notice', ['KEY SWITCH TO PROG', 'BEFORE WIRING', 'LOCK OUT 120 V'])} />
      <SignPlate id="lab-ppe" size={[0.24, 0.16]} position={[-1.55, 2.05, backZ + 0.001]} draw={drawSafetySign('warning', ['120 V AC', 'INSIDE TRAINER'])} />
      {/* waste bin */}
      <mesh geometry={kgeo('k:bin', () => new THREE.CylinderGeometry(0.15, 0.13, 0.38, 28, 1, true))} material={kmat('k:binmat', () => new THREE.MeshStandardMaterial({ color: '#2d5f8f', roughness: 0.5, side: THREE.DoubleSide }))} position={[1.45, 0.19, -0.35]} castShadow />
    </group>
  );
}

/** Coarse occluder boxes of the room (for the tag chips). */
export const ROOM_OCCLUDERS: Array<[Vec3, Vec3]> = [
  [
    [ROOM.leftX - 0.2, 0, ROOM.backZ - 0.2],
    [ROOM.rightX + 0.2, ROOM.height, ROOM.backZ],
  ],
  [
    [ROOM.leftX - 0.2, 0, ROOM.backZ],
    [ROOM.leftX, ROOM.height, ROOM.frontZ],
  ],
  [
    [ROOM.rightX, 0, ROOM.backZ],
    [ROOM.rightX + 0.2, ROOM.height, ROOM.frontZ],
  ],
];
