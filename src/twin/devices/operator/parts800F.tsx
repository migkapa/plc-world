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
  F,
  LEGEND_FONT,
  LENS_HEX,
  PartsMesh,
  addScrew,
  arcPts,
  boxGeo,
  canvasTexture,
  cylZ,
  fitText,
  latheZ,
  mats,
  partsGeo,
  planeGeo,
  roundedBox,
  sharedGeo,
  sharedMat,
  circleGeo,
  type Finish,
  type Parts,
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

export function bezelFinish(kind: BezelKind): Finish {
  return kind === 'metal' ? F.chrome : F.black;
}

/** Dark annulus visible between the bore and an operator of radius `innerR` (no full disc). */
function cavityGeo(innerR: number) {
  return sharedGeo(`800f-cavity:${innerR}`, () => new THREE.RingGeometry(Math.max(0.001, innerR - 0.0008), F800.boreR, 40, 1));
}

/** Adds the bezel ring (+ the dark gap annulus around an operator of radius `operatorR`). */
export function addBezel(b: Parts, kind: BezelKind, guard = false, operatorR: number = F800.capR): Parts {
  b.add(bezelGeo(guard ? 'guard' : 'flush'), bezelFinish(kind));
  b.add(cavityGeo(operatorR), F.hole, [0, 0, 0.0012]);
  return b;
}

/** The round 800F bezel ring (sits on the panel front around the hole). */
export const Bezel800F = memo(function Bezel800F({ kind = 'metal', guard = false }: { kind?: BezelKind; guard?: boolean }) {
  return <PartsMesh geo={partsGeo(`800f-bezel:${kind}:${guard}`, (b) => addBezel(b, kind, guard))} />;
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

/** Plate geometry parameters for a legend with `lift` (extra height above the standard plate). */
function plateDims(lift: number) {
  const W = F800.legendW;
  const H = F800.legendH + lift;
  const cy = H / 2 - F800.legendHoleFromBottom;
  const winW = 0.0268;
  const winH = 0.0152;
  const winY = F800.bezelR + 0.0012 + winH / 2 + lift;
  return { W, H, cy, winW, winH, winY };
}

/** Adds the molded 30 × 50 mm legend plate body (the printed insert is {@link LegendPrint800F}). */
export function addLegendPlate(b: Parts, lift = 0, theme: 'black' | 'white' = 'black'): Parts {
  const d = plateDims(lift);
  return b.add(roundedBox(d.W, d.H, 0.0014, 0.0012, 2), F.gloss(theme === 'black' ? '#151515' : '#e9e9e4'), [0, d.cy, 0.0007]);
}

/** The printed insert of a legend plate (one textured quad). */
export const LegendPrint800F = memo(function LegendPrint800F({
  lines,
  positions,
  theme = 'black',
  lift = 0,
}: {
  lines: string[];
  positions?: string[];
  theme?: 'black' | 'white';
  lift?: number;
}) {
  const d = plateDims(lift);
  const tex = legendTexture(lines, positions, theme);
  return <mesh geometry={planeGeo(d.winW, d.winH)} material={mats.label(tex, false, 0.5)} position={[0, d.winY, 0.00142]} />;
});

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
  return (
    <group>
      <PartsMesh geo={partsGeo(`800f-plate:${lift}:${theme}`, (b) => addLegendPlate(b, lift, theme))} />
      <LegendPrint800F lines={lines} positions={positions} theme={theme} lift={lift} />
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

/** Adds the molded body of a round E-stop legend plate. */
export function addRoundLegendPlate(b: Parts, diameter = 0.06): Parts {
  const r = diameter / 2;
  return b.add(cylZ(r, r, 0.0016, 72), F.gloss('#e8b900'), [0, 0, 0.0008]);
}

/** Printed face of the round E-stop legend plate. */
export const RoundLegendPrint = memo(function RoundLegendPrint({ text = 'EMERGENCY STOP', bottomText, diameter = 0.06 }: { text?: string; bottomText?: string; diameter?: number }) {
  const tex = ringLegendTexture(text, bottomText);
  const mat = sharedMat(`ring-legend-mat:${tex.uuid}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
  return <mesh geometry={circleGeo(diameter / 2 - 0.0004, 72)} material={mat} position={[0, 0, 0.00162]} />;
});

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
  return (
    <group>
      <PartsMesh geo={partsGeo(`800f-roundplate:${diameter}`, (b) => addRoundLegendPlate(b, diameter))} />
      <RoundLegendPrint text={text} bottomText={bottomText} diameter={diameter} />
    </group>
  );
});

// ---------------------------------------------------------------------------
// Rear: mounting latch + contact blocks / LED module
// ---------------------------------------------------------------------------

export type RearItem = 'NO' | 'NC' | 'LED' | null;

const BLOCK = { w: 0.0112, h: 0.0318, d: 0.0335, pitch: 0.0118 } as const;

/** Adds one 800F contact block / LED module (front face at z = 0, extending to −BLOCK.d). */
function addContactBlock(b: Parts, kind: Exclude<RearItem, null>, x: number, led?: LedColor) {
  const band = kind === 'NO' ? '#1c9b3f' : kind === 'NC' ? '#d0212a' : LENS_HEX[led ?? 'white'];
  b.at([x, 0, 0], undefined, (c) => {
    c.add(roundedBox(BLOCK.w, BLOCK.h, BLOCK.d, 0.0008, 2), kind === 'LED' ? F.matte('#1d1e20', 0.6) : F.darkPlastic, [0, 0, -BLOCK.d / 2]);
    // colored actuator band (green N.O. / red N.C. / lens color LED) wrapping the block
    c.add(boxGeo(BLOCK.w + 0.0003, BLOCK.h * 0.16, 0.0042), F.matte(band, 0.5), [0, 0, -BLOCK.d * 0.42]);
    // terminal clamp windows on top & bottom
    c.add(boxGeo(BLOCK.w * 0.7, 0.0006, 0.006), F.hole, [0, BLOCK.h / 2 + 0.0001, -BLOCK.d + 0.006]);
    c.add(boxGeo(BLOCK.w * 0.7, 0.0006, 0.006), F.hole, [0, -BLOCK.h / 2 - 0.0001, -BLOCK.d + 0.006]);
    // white marker strip on the back
    c.add(boxGeo(BLOCK.w * 0.6, BLOCK.h * 0.12, 0.0003), F.matte('#e8e8e2', 0.6), [0, 0, -BLOCK.d - 0.0001]);
    // terminal screws on the back face
    addScrew(c, [0, BLOCK.h * 0.34, -BLOCK.d - 0.0001], 0.0026, 0.0014, [0, Math.PI, 0]);
    addScrew(c, [0, -BLOCK.h * 0.34, -BLOCK.d - 0.0001], 0.0026, 0.0014, [0, Math.PI, 0]);
  });
}

/**
 * Adds the behind-the-panel assembly: operator body through the hole, 800F-ALP style mounting latch
 * and up to three contact blocks (left / center / right). Green actuator band = N.O., red = N.C.
 */
export function addRear800F(b: Parts, items: [RearItem, RearItem, RearItem], panelThickness: number = F800.panelT, led?: LedColor): Parts {
  const z0 = -panelThickness;
  const latchD = 0.0115;
  b.add(cylZ(0.0109, 0.0109, panelThickness + 0.004, 32), F.black, [0, 0, z0 / 2 - 0.001]);
  b.at([0, 0, z0], undefined, (r) => {
    r.add(roundedBox(0.0355, 0.04, latchD, 0.0015, 2), F.black, [0, 0, -latchD / 2]);
    r.add(roundedBox(0.012, 0.004, 0.006, 0.001, 2), F.matte('#6d7176', 0.5), [0, 0.0215, -latchD * 0.55]);
    r.add(boxGeo(0.004, 0.012, 0.0025), F.darkPlastic, [-0.0165, 0, -0.0012]);
    r.add(boxGeo(0.004, 0.012, 0.0025), F.darkPlastic, [0.0165, 0, -0.0012]);
    r.at([0, 0, -latchD], undefined, (c) => items.forEach((it, i) => it && addContactBlock(c, it, (i - 1) * BLOCK.pitch, led)));
  });
  return b;
}

/** Stable cache key for a rear assembly. */
export function rearKey(items: [RearItem, RearItem, RearItem], panelThickness: number = F800.panelT, led?: LedColor) {
  return `${items.join(',')}:${panelThickness}:${led ?? ''}`;
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
  return <PartsMesh geo={partsGeo(`800f-rear:${rearKey(items, panelThickness, led)}`, (b) => addRear800F(b, items, panelThickness, led))} />;
});
