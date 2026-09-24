/**
 * Common Bulletin 800F (22.5 mm) parts: bezels, legend plates, mounting latch + contact blocks.
 *
 * 800F device origin: center of the 22.5 mm mounting hole ON THE FRONT SURFACE of the panel,
 * +Z out of the panel (front), +Y up. Everything behind the panel (latch, contact blocks) is at z < 0.
 *
 * Reference dimensions (Rockwell 800F dimension drawings, approximate):
 *  - mounting hole 22.3 mm, bezel Ø 29.7 mm, flush operator projection ≈ 7–8 mm
 *  - standard legend plate 30 × 50 mm (black, white text), E-stop legend Ø 60 mm yellow
 *  - latch + one tier of contact blocks ≈ 45 mm behind the panel
 */
import { memo } from 'react';
import * as THREE from 'three';
import type { LedColor } from '../../common';
import {
  LEGEND_FONT,
  LENS_HEX,
  Screw,
  arcPts,
  boxGeo,
  canvasTexture,
  cylZ,
  fitText,
  latheZ,
  mats,
  planeGeo,
  roundedBox,
  sharedMat,
  circleGeo,
} from './shared';

export const F800 = {
  holeR: 0.01115,
  bezelR: 0.01485,
  bezelH: 0.0072,
  guardH: 0.0128,
  boreR: 0.0119,
  capR: 0.0113,
  panelT: 0.002,
  legendW: 0.03,
  legendH: 0.05,
  /** Distance from the plate bottom edge to the hole center. */
  legendHoleFromBottom: 0.017,
} as const;

export type BezelKind = 'metal' | 'plastic';

// ---------------------------------------------------------------------------
// Bezels
// ---------------------------------------------------------------------------

function bezelProfile(h: number, rr: number): [number, number][] {
  const R = F800.bezelR;
  const rin = F800.boreR;
  return [
    [rin, 0],
    [R - 0.0003, 0],
    [R, 0.0003],
    [R, h - rr],
    ...arcPts(R - rr, h - rr, rr, 0, 90, 8),
    [rin + 0.0006, h],
    ...arcPts(rin + 0.0006, h - 0.0006, 0.0006, 90, 180, 3),
    [rin, 0.0004],
    [rin, 0],
  ];
}

export function bezelGeo(kind: 'flush' | 'guard') {
  return kind === 'guard'
    ? latheZ('800f-bezel-guard', bezelProfile(F800.guardH, 0.0016), 64)
    : latheZ('800f-bezel', bezelProfile(F800.bezelH, 0.0034), 64);
}

export function bezelMat(kind: BezelKind) {
  return kind === 'metal' ? mats.chrome() : mats.blackPlastic();
}

/** The round 800F bezel ring (sits on the panel front around the hole). */
export const Bezel800F = memo(function Bezel800F({ kind = 'metal', guard = false }: { kind?: BezelKind; guard?: boolean }) {
  return (
    <group>
      <mesh geometry={bezelGeo(guard ? 'guard' : 'flush')} material={bezelMat(kind)} castShadow />
      {/* dark cavity inside the bezel (visible around the cap) */}
      <mesh geometry={circleGeo(F800.boreR, 40)} material={mats.dark()} position={[0, 0, 0.0012]} />
    </group>
  );
});

// ---------------------------------------------------------------------------
// Legend plates
// ---------------------------------------------------------------------------

function legendTexture(lines: string[], positions: string[] | undefined, theme: 'black' | 'white') {
  const key = `800f-legend:${theme}:${lines.join('|')}:${(positions ?? []).join('|')}`;
  return canvasTexture(key, 512, 300, (ctx, w, h) => {
    ctx.fillStyle = theme === 'black' ? '#171717' : '#efefea';
    ctx.fillRect(0, 0, w, h);
    const fg = theme === 'black' ? '#f4f4f0' : '#111111';
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rows: { text: string[] }[] = [];
    for (const l of lines) rows.push({ text: [l] });
    if (positions && positions.length) rows.push({ text: positions });
    const n = Math.max(1, rows.length);
    const rowH = h / n;
    rows.forEach((row, i) => {
      const cy = rowH * (i + 0.5) + (n === 1 ? 4 : 0);
      if (row.text.length === 1) {
        const px = fitText(ctx, row.text[0]!, w - 40, n === 1 ? 150 : 120, 700);
        ctx.font = `700 ${px}px ${LEGEND_FONT}`;
        ctx.fillText(row.text[0]!, w / 2, cy);
      } else {
        const k = row.text.length;
        // one common font size for all position labels
        const px = Math.min(...row.text.map((t) => fitText(ctx, t, w / k - 12, n === 1 ? 110 : 96, 700)));
        ctx.font = `700 ${px}px ${LEGEND_FONT}`;
        row.text.forEach((t, j) => {
          const cx = k === 2 ? (j === 0 ? w * 0.25 : w * 0.75) : w * (0.5 / k + (1 - 1 / k) * (j / (k - 1)));
          ctx.fillText(t, cx, cy);
        });
      }
    });
  });
}

/**
 * Standard 30 × 50 mm 800F legend plate (placed so the hole center is at the origin).
 * `lines` = title lines; `positions` = position labels in one row (selector switches).
 */
export const LegendPlate800F = memo(function LegendPlate800F({
  lines,
  positions,
  theme = 'black',
  lift = 0,
}: {
  lines: string[];
  positions?: string[];
  theme?: 'black' | 'white';
  /** Extra plate height above the standard plate (for large operators such as 40 mm mushrooms). */
  lift?: number;
}) {
  const W = F800.legendW;
  const H = F800.legendH + lift;
  const cy = H / 2 - F800.legendHoleFromBottom;
  const tex = legendTexture(lines, positions, theme);
  const winW = 0.0268;
  const winH = 0.0152;
  const winY = F800.bezelR + 0.0012 + winH / 2 + lift;
  const plateColor = theme === 'black' ? '#151515' : '#e9e9e4';
  return (
    <group>
      <mesh geometry={roundedBox(W, H, 0.0014, 0.0012, 2)} material={mats.gloss(plateColor)} position={[0, cy, 0.0007]} castShadow receiveShadow />
      {/* printed insert, slightly recessed look */}
      <mesh geometry={planeGeo(winW, winH)} material={mats.label(tex, false, 0.5)} position={[0, winY, 0.00142]} />
    </group>
  );
});

function ringLegendTexture(text: string, bottomText?: string) {
  return canvasTexture(`ring-legend:${text}:${bottomText ?? ''}`, 1024, 1024, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = '#f3c300';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2, 0, Math.PI * 2);
    ctx.fill();
    // subtle molded rim
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#111111';
    const drawArc = (t: string, radius: number, top: boolean) => {
      const px = 92;
      ctx.font = `700 ${px}px ${LEGEND_FONT}`;
      const chars = [...t];
      const widths = chars.map((c) => ctx.measureText(c).width * 1.06);
      const total = widths.reduce((a, b) => a + b, 0);
      const span = total / radius;
      let a = top ? -Math.PI / 2 - span / 2 : Math.PI / 2 + span / 2;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chars.forEach((c, i) => {
        const cw = widths[i]! / radius;
        const mid = top ? a + cw / 2 : a - cw / 2;
        ctx.save();
        ctx.translate(cx + radius * Math.cos(mid), cy + radius * Math.sin(mid));
        ctx.rotate(top ? mid + Math.PI / 2 : mid - Math.PI / 2);
        ctx.fillText(c, 0, 0);
        ctx.restore();
        a = top ? a + cw : a - cw;
      });
    };
    drawArc(text, 405, true);
    if (bottomText) drawArc(bottomText, 405, false);
  });
}

/** Round yellow E-stop legend plate (Ø 60 mm by default) with curved text. */
export const RoundLegendPlate = memo(function RoundLegendPlate({
  text = 'EMERGENCY STOP',
  bottomText,
  diameter = 0.06,
}: {
  text?: string;
  bottomText?: string;
  diameter?: number;
}) {
  const tex = ringLegendTexture(text, bottomText);
  const r = diameter / 2;
  const mat = sharedMat(`ring-legend-mat:${tex.uuid}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0 }));
  return (
    <group>
      <mesh geometry={cylZ(r, r, 0.0016, 72)} material={mats.gloss('#e8b900')} position={[0, 0, 0.0008]} castShadow receiveShadow />
      <mesh geometry={circleGeo(r - 0.0004, 72)} material={mat} position={[0, 0, 0.00162]} />
    </group>
  );
});

// ---------------------------------------------------------------------------
// Rear: mounting latch + contact blocks / LED module
// ---------------------------------------------------------------------------

export type RearItem = 'NO' | 'NC' | 'LED' | null;

const BLOCK = { w: 0.0112, h: 0.0318, d: 0.0335, pitch: 0.0118 } as const;

function blockBackTexture(kind: Exclude<RearItem, null>, led?: LedColor) {
  return canvasTexture(`800f-block-back:${kind}:${led ?? ''}`, 64, 192, (ctx, w, h) => {
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(0, 0, w, h);
    const band = kind === 'NO' ? '#1c9b3f' : kind === 'NC' ? '#d0212a' : LENS_HEX[led ?? 'white'];
    ctx.fillStyle = band;
    ctx.fillRect(6, h * 0.42, w - 12, h * 0.16);
    ctx.fillStyle = '#f2f2f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 22px ${LEGEND_FONT}`;
    const [a, b] = kind === 'NO' ? ['13', '14'] : kind === 'NC' ? ['11', '12'] : ['X1', 'X2'];
    ctx.fillText(a, w / 2, h * 0.3);
    ctx.fillText(b, w / 2, h * 0.7);
    ctx.font = `700 13px ${LEGEND_FONT}`;
    ctx.fillStyle = kind === 'LED' ? '#111' : '#f2f2f2';
    ctx.fillText(kind === 'LED' ? 'LED' : kind === 'NO' ? 'N.O.' : 'N.C.', w / 2, h * 0.5);
  });
}

function ContactBlock({ kind, x, z, led }: { kind: Exclude<RearItem, null>; x: number; z: number; led?: LedColor }) {
  const tex = blockBackTexture(kind, led);
  return (
    <group position={[x, 0, z]}>
      <mesh geometry={roundedBox(BLOCK.w, BLOCK.h, BLOCK.d, 0.0008, 2)} material={kind === 'LED' ? mats.matte('#1d1e20') : mats.darkPlastic()} position={[0, 0, -BLOCK.d / 2]} castShadow />
      {/* terminal clamp windows on top & bottom */}
      <mesh geometry={boxGeo(BLOCK.w * 0.7, 0.0006, 0.006)} material={mats.dark()} position={[0, BLOCK.h / 2 + 0.0001, -BLOCK.d + 0.006]} />
      <mesh geometry={boxGeo(BLOCK.w * 0.7, 0.0006, 0.006)} material={mats.dark()} position={[0, -BLOCK.h / 2 - 0.0001, -BLOCK.d + 0.006]} />
      {/* back face print */}
      <mesh geometry={planeGeo(BLOCK.w * 0.92, BLOCK.h * 0.94)} material={mats.label(tex)} position={[0, 0, -BLOCK.d - 0.00005]} rotation={[0, Math.PI, 0]} />
      <Screw position={[0, BLOCK.h * 0.34, -BLOCK.d - 0.0001]} rotation={[0, Math.PI, 0]} r={0.0026} h={0.0014} />
      <Screw position={[0, -BLOCK.h * 0.34, -BLOCK.d - 0.0001]} rotation={[0, Math.PI, 0]} r={0.0026} h={0.0014} />
    </group>
  );
}

/**
 * Behind-the-panel assembly: operator body through the hole, 800F-ALP style mounting latch and up to
 * three contact blocks (left / center / right). Green actuator band = N.O., red = N.C.
 */
export const Rear800F = memo(function Rear800F({
  items,
  panelThickness = F800.panelT,
  led,
}: {
  items: [RearItem, RearItem, RearItem];
  panelThickness?: number;
  led?: LedColor;
}) {
  const z0 = -panelThickness;
  const latchD = 0.0115;
  return (
    <group>
      {/* operator body through the hole */}
      <mesh geometry={cylZ(0.0109, 0.0109, panelThickness + 0.004, 32)} material={mats.blackPlastic()} position={[0, 0, z0 / 2 - 0.001]} />
      {/* mounting latch */}
      <group position={[0, 0, z0]}>
        <mesh geometry={roundedBox(0.0355, 0.04, latchD, 0.0015, 2)} material={mats.blackPlastic()} position={[0, 0, -latchD / 2]} castShadow />
        {/* latch lever */}
        <mesh geometry={roundedBox(0.012, 0.004, 0.006, 0.001, 2)} material={mats.matte('#6d7176')} position={[0, 0.0215, -latchD * 0.55]} />
        {/* clamp jaws */}
        <mesh geometry={boxGeo(0.004, 0.012, 0.0025)} material={mats.darkPlastic()} position={[-0.0165, 0, -0.0012]} />
        <mesh geometry={boxGeo(0.004, 0.012, 0.0025)} material={mats.darkPlastic()} position={[0.0165, 0, -0.0012]} />
        {items.map((it, i) =>
          it ? <ContactBlock key={i} kind={it} x={(i - 1) * BLOCK.pitch} z={-latchD} led={led} /> : null,
        )}
      </group>
    </group>
  );
});
