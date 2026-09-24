/**
 * Scene-local panel parts for MCP-101 (a 460 V, 3-phase motor control panel) that the shared device library
 * does not provide (static, a few draw calls each):
 *
 *  - <Mpcb140M>          Bulletin 140M-C2E motor protection circuit breaker (rotary handle), DIN mounted
 *  - <FuseHolder1492>    1492-FB 1-pole DIN fuse holder (control-circuit secondary fuse)
 *  - <ControlTransformer1497>  1497 control power transformer (480 V -> 120 V) with primary fuse block
 *  - <Disconnect1494>    1494F flange-mounted main disconnect (switch body + operating rod)
 *  - <FlangeHandle>      its handle mechanism on the outside of the enclosure's right side wall
 *
 * Origins: DIN parts = clip plane at the rail centerline (like the shared panel devices), +Z out of the
 * backplate; bolted parts = center of their footprint on the backplate surface.
 */
import * as THREE from 'three';
import type { Vec3 } from '../../../twin/contracts';
import { CONTACTOR_GRAY } from '../../../twin/devices';
import { FONT, KBOX, KCYL, canvasTexture, fitFont, kgeo, km } from '../trainer/kit';

const GRAY = CONTACTOR_GRAY;

function Box({ s, p, m, cast = false }: { s: Vec3; p: Vec3; m: THREE.Material; cast?: boolean }) {
  return <mesh geometry={KBOX()} material={m} scale={s} position={p} castShadow={cast} />;
}

/** Row of screw heads (instanced by position list, small cylinders facing +Z). */
function Screws({ xs, y, z, r = 0.0026 }: { xs: number[]; y: number; z: number; r?: number }) {
  return (
    <>
      {xs.map((x) => (
        <mesh key={x} geometry={KCYL()} material={km.metal('#c9ccd0', 0.3)} rotation={[Math.PI / 2, 0, 0]} scale={[r * 2, 0.002, r * 2]} position={[x, y, z]} />
      ))}
    </>
  );
}

function labelTexture(key: string, w: number, h: number, lines: { t: string; px: number; weight?: number }[], bg = '#e9e9e4', ink = '#15171a') {
  return canvasTexture(`ms-label:${key}`, w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((l, i) => {
      fitFont(ctx, l.t, w * 0.9, l.px, l.weight ?? 700, FONT);
      ctx.fillText(l.t, w / 2, (h * (i + 0.5)) / n);
    });
  });
}

function Label({ tex, w, h, p }: { tex: THREE.Texture; w: number; h: number; p: Vec3 }) {
  return <mesh geometry={kgeo('ms:plane', () => new THREE.PlaneGeometry(1, 1))} material={km.label(tex, 0.55)} scale={[w, h, 1]} position={p} />;
}

// ---------------------------------------------------------------------------

/** 140M-C2E motor protection circuit breaker, 45 mm wide, rotary handle in the ON position. */
export function Mpcb140M({ position, catalog = '140M-C2E-C10', range = '6.3–10 A' }: { position?: Vec3; catalog?: string; range?: string }) {
  const body = km.plastic(GRAY, 0.55);
  const tex = labelTexture(`mpcb:${catalog}`, 256, 150, [
    { t: catalog, px: 30, weight: 800 },
    { t: range, px: 28 },
    { t: 'I  ON   ·   O  OFF', px: 24, weight: 600 },
  ]);
  return (
    <group position={position}>
      <Box s={[0.045, 0.09, 0.045]} p={[0, 0, 0.0225]} m={body} cast />
      <Box s={[0.045, 0.058, 0.03]} p={[0, 0, 0.06]} m={body} cast />
      {/* rotary handle (black, white pointer vertical = ON) + trip-indicator window */}
      <mesh geometry={KCYL()} material={km.plastic('#16181b', 0.45)} rotation={[Math.PI / 2, 0, 0]} scale={[0.028, 0.008, 0.028]} position={[0, 0.006, 0.079]} />
      <Box s={[0.006, 0.026, 0.009]} p={[0, 0.006, 0.084]} m={km.plastic('#1d2024', 0.4)} />
      <Box s={[0.0024, 0.011, 0.001]} p={[0, 0.013, 0.0886]} m={km.plastic('#f1f1ec', 0.5)} />
      <Label tex={tex} w={0.04} h={0.0235} p={[0, -0.0165, 0.0752]} />
      {/* terminals: line (top) / load (bottom) */}
      <Screws xs={[-0.0135, 0, 0.0135]} y={0.039} z={0.0452} />
      <Screws xs={[-0.0135, 0, 0.0135]} y={-0.039} z={0.0452} />
    </group>
  );
}

/** 1492-FB1 1-pole DIN fuse holder with hinged black cap. */
export function FuseHolder1492({ position, text = 'FU3 · 2 A' }: { position?: Vec3; text?: string }) {
  const tex = labelTexture(`fu:${text}`, 128, 48, [{ t: text, px: 30, weight: 800 }]);
  return (
    <group position={position}>
      <Box s={[0.0172, 0.082, 0.045]} p={[0, 0, 0.0225]} m={km.plastic(GRAY, 0.55)} cast />
      <Box s={[0.0172, 0.05, 0.022]} p={[0, 0, 0.056]} m={km.plastic('#1b1c1f', 0.45)} cast />
      <Box s={[0.006, 0.006, 0.001]} p={[0, 0.012, 0.0676]} m={km.plastic('#6b1a14', 0.3)} />
      <Label tex={tex} w={0.0165} h={0.0062} p={[0, -0.034, 0.0453]} />
      <Screws xs={[0]} y={0.035} z={0.0452} r={0.0022} />
      <Screws xs={[0]} y={-0.035} z={0.0452} r={0.0022} />
    </group>
  );
}

/** 1497 control power transformer, 250 VA, 480 V -> 120 V, with a 2-fuse primary fuse block on top. */
export function ControlTransformer1497({ position }: { position?: Vec3 }) {
  const steel = km.paint('#8e959b', 0.45, 0.5);
  const core = km.metal('#474d53', 0.5);
  const coil = km.plastic('#1d1e21', 0.6);
  const board = km.plastic('#2a2622', 0.5);
  const tex = labelTexture('cpt', 320, 160, [
    { t: 'T1 · 1497 CPT', px: 40, weight: 800 },
    { t: '250 VA  ·  60 Hz', px: 30 },
    { t: 'PRI 480 V  H1-H4', px: 30 },
    { t: 'SEC 120 V  X1-X2', px: 30 },
  ], '#d7c88f');
  return (
    <group position={position}>
      {/* mounting bracket + laminated core (two outer legs + yokes) */}
      <Box s={[0.1, 0.1, 0.003]} p={[0, 0, 0.0015]} m={steel} />
      <Box s={[0.088, 0.072, 0.046]} p={[0, 0, 0.026]} m={core} cast />
      {[-1, 1].map((sx) => (
        <Box key={sx} s={[0.004, 0.08, 0.05]} p={[sx * 0.046, 0, 0.028]} m={steel} />
      ))}
      {/* coil (taped, bulges out in front of the core) with its nameplate */}
      <mesh geometry={kgeo('ms:cpt-coil', () => new THREE.CapsuleGeometry(0.019, 0.034, 6, 16).rotateZ(Math.PI / 2))} material={coil} scale={[1, 1.55, 1.25]} position={[0, 0, 0.046]} castShadow />
      <Label tex={tex} w={0.052} h={0.026} p={[0, 0.0, 0.0725]} />
      {/* primary terminal board + fuse block on top */}
      <Box s={[0.09, 0.012, 0.03]} p={[0, 0.042, 0.03]} m={board} />
      <Screws xs={[-0.033, -0.011, 0.011, 0.033]} y={0.042} z={0.0455} r={0.0022} />
      <Box s={[0.07, 0.01, 0.026]} p={[0, 0.053, 0.028]} m={km.plastic('#16181a', 0.5)} />
      {[-0.017, 0.017].map((x) => (
        <group key={x} position={[x, 0.065, 0.03]}>
          <mesh geometry={KCYL()} material={km.plastic('#efece2', 0.5)} rotation={[Math.PI / 2, 0, 0]} scale={[0.01, 0.028, 0.01]} />
          {[-1, 1].map((sz) => (
            <mesh key={sz} geometry={KCYL()} material={km.metal('#c9b27a', 0.3)} rotation={[Math.PI / 2, 0, 0]} scale={[0.0104, 0.005, 0.0104]} position={[0, 0, sz * 0.0145]} />
          ))}
        </group>
      ))}
      {/* secondary terminal board X1 / X2 */}
      <Box s={[0.05, 0.012, 0.03]} p={[0, -0.042, 0.03]} m={board} />
      <Screws xs={[-0.012, 0.012]} y={-0.042} z={0.0455} r={0.0022} />
    </group>
  );
}

/** Height of the operating rod above the backplate (clears the wire ducts). */
export const ROD_Z = 0.075;

/** 1494F-D30 flange-operated main disconnect: switch body with line/load lugs and the operating rod to `rodTo` (x). */
export function Disconnect1494({ position, rodTo }: { position?: Vec3; rodTo: number }) {
  const x0 = position?.[0] ?? 0;
  const tex = labelTexture('ds1', 256, 96, [
    { t: 'DS1  MAIN DISCONNECT', px: 30, weight: 800 },
    { t: '1494F · 30 A · 600 V AC', px: 26 },
  ]);
  const rodLen = Math.max(0.01, rodTo - x0 - 0.045);
  return (
    <group position={position}>
      <Box s={[0.09, 0.125, 0.06]} p={[0, 0, 0.03]} m={km.plastic('#26282c', 0.5)} cast />
      <Box s={[0.07, 0.06, 0.02]} p={[0, 0.0, 0.07]} m={km.plastic('#303338', 0.45)} cast />
      <Label tex={tex} w={0.066} h={0.0248} p={[0, -0.042, 0.0602]} />
      {/* line lugs (top) and load lugs (bottom) */}
      {[-0.026, 0, 0.026].map((x) => (
        <group key={x}>
          <Box s={[0.014, 0.012, 0.014]} p={[x, 0.056, 0.05]} m={km.metal('#b9a26a', 0.35)} />
          <Box s={[0.014, 0.012, 0.014]} p={[x, -0.056, 0.05]} m={km.metal('#b9a26a', 0.35)} />
        </group>
      ))}
      {/* operating mechanism: bell crank + rod along +X to the flange handle */}
      <Box s={[0.02, 0.03, 0.03]} p={[0.055, 0.02, 0.066]} m={km.metal('#8f969c', 0.4)} />
      <Box s={[rodLen, 0.008, 0.008]} p={[0.045 + rodLen / 2, 0.02, ROD_Z]} m={km.metal('#b0b5ba', 0.35)} />
    </group>
  );
}

/** Flange handle mechanism on the outside of a side wall (+X facing), handle up = ON, with padlock hasp. */
export function FlangeHandle({ position }: { position?: Vec3 }) {
  const tex = labelTexture('ds1-handle', 96, 256, [
    { t: 'ON', px: 34, weight: 900 },
    { t: '', px: 10 },
    { t: '', px: 10 },
    { t: '', px: 10 },
    { t: 'OFF', px: 34, weight: 900 },
  ], '#1e2023', '#f2f2ee');
  return (
    <group position={position} rotation={[0, Math.PI / 2, 0]}>
      <Box s={[0.06, 0.2, 0.012]} p={[0, 0, 0.006]} m={km.paint('#2b2e33', 0.45, 0.4)} cast />
      <mesh geometry={kgeo('ms:plane', () => new THREE.PlaneGeometry(1, 1))} material={km.label(tex, 0.5)} scale={[0.05, 0.18, 1]} position={[0, 0, 0.0122]} />
      {/* handle: pivot hub + red lever pointing up (ON) */}
      <mesh geometry={KCYL()} material={km.metal('#9aa0a6', 0.35)} rotation={[Math.PI / 2, 0, 0]} scale={[0.03, 0.016, 0.03]} position={[0, -0.02, 0.02]} />
      <Box s={[0.024, 0.12, 0.02]} p={[0, 0.03, 0.034]} m={km.plastic('#c8102e', 0.35)} cast />
      <Box s={[0.03, 0.026, 0.024]} p={[0, 0.088, 0.036]} m={km.plastic('#c8102e', 0.35)} cast />
      {/* padlock hasp */}
      <Box s={[0.016, 0.022, 0.004]} p={[0.026, -0.07, 0.016]} m={km.metal('#c0c4c8', 0.3)} />
    </group>
  );
}
