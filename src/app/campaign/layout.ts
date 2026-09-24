/**
 * Campaign map geometry (pure): chapters are stacked "regions"; missions are nodes on one winding road.
 *
 *  wide (≥ 760 px):  each chapter is a horizontal band; the road snakes left→right, then U-turns down
 *                    the side margin into the next chapter (right→left), like a board game.
 *  narrow (< 760):   each chapter is a vertical zig-zag; chapter banners span the width and the road
 *                    runs behind them.
 */
import type { ChapterDef, MissionDef } from '../../game/types';

export interface MapNode {
  mission: MissionDef;
  x: number;
  y: number;
  /** Visual radius (bosses are bigger). */
  r: number;
  boss: boolean;
  /** Where the label goes relative to the node. */
  label: 'below' | 'left' | 'right';
  /** Max label width in px. */
  labelWidth: number;
}

export interface MapRegion {
  chapter: ChapterDef;
  index: number;
  top: number;
  height: number;
  header: { x: number; y: number; w: number; h: number };
  nodes: MapNode[];
}

export interface MapSegment {
  d: string;
  /** Mission ids at both ends (undefined = start / finish marker). */
  from?: string;
  to?: string;
  kind: 'road' | 'bridge' | 'start' | 'finish';
}

export interface MapLayout {
  mode: 'wide' | 'narrow';
  width: number;
  height: number;
  regions: MapRegion[];
  segments: MapSegment[];
  start?: { x: number; y: number };
  finish: { x: number; y: number };
}

export const WIDE_MIN = 760;

const R_NODE = 28;
const R_BOSS = 38;

const f = (n: number): string => n.toFixed(1);

function hCurve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = (b.x - a.x) / 2;
  return `M${f(a.x)} ${f(a.y)} C${f(a.x + dx)} ${f(a.y)} ${f(b.x - dx)} ${f(b.y)} ${f(b.x)} ${f(b.y)}`;
}

function vCurve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dy = (b.y - a.y) / 2;
  return `M${f(a.x)} ${f(a.y)} C${f(a.x)} ${f(a.y + dy)} ${f(b.x)} ${f(b.y - dy)} ${f(b.x)} ${f(b.y)}`;
}

function uTurn(a: { x: number; y: number }, b: { x: number; y: number }, side: 1 | -1, bulge: number): string {
  return `M${f(a.x)} ${f(a.y)} C${f(a.x + side * bulge)} ${f(a.y)} ${f(b.x + side * bulge)} ${f(b.y)} ${f(b.x)} ${f(b.y)}`;
}

export function computeMapLayout(width: number, chapters: ChapterDef[], missionsOf: (chapterId: string) => MissionDef[]): MapLayout {
  const W = Math.max(300, width);
  return W >= WIDE_MIN ? wideLayout(W, chapters, missionsOf) : narrowLayout(W, chapters, missionsOf);
}

function wideLayout(W: number, chapters: ChapterDef[], missionsOf: (chapterId: string) => MissionDef[]): MapLayout {
  const PAD_TOP = 20;
  const HEADER_H = 92;
  /** Clearance under the banner for the bobbing NEXT marker / BOSS tag of the top-most nodes. */
  const HEADER_GAP = 14;
  const BAND_H = 200;
  const REGION_H = PAD_TOP + HEADER_H + HEADER_GAP + BAND_H + 16;
  const GAP = 40;
  const MX = Math.min(120, Math.max(92, W * 0.08));
  const WAVE = 30;
  const headerW = Math.min(W - 2 * 150, 820);

  const regions: MapRegion[] = [];
  let top = 0;
  chapters.forEach((chapter, index) => {
    const list = missionsOf(chapter.id);
    const ltr = index % 2 === 0;
    const n = list.length;
    const bandMid = top + PAD_TOP + HEADER_H + HEADER_GAP + BAND_H / 2 - 12;
    const span = W - 2 * MX;
    const spacing = n > 1 ? span / (n - 1) : span;
    const nodes: MapNode[] = list.map((mission, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const x = ltr ? MX + t * span : W - MX - t * span;
      const boss = mission.kind === 'boss';
      const y = bandMid + WAVE * Math.sin(i * 1.25 + index * 0.9) * (boss ? 0.4 : 1);
      return { mission, x, y, r: boss ? R_BOSS : R_NODE, boss, label: 'below', labelWidth: Math.max(96, Math.min(160, spacing - 14)) };
    });
    regions.push({
      chapter,
      index,
      top,
      height: REGION_H,
      header: { x: (W - headerW) / 2, y: top + PAD_TOP, w: headerW, h: HEADER_H },
      nodes,
    });
    top += REGION_H + GAP;
  });
  const height = top - GAP + 90;

  const segments: MapSegment[] = [];
  regions.forEach((reg, ri) => {
    reg.nodes.forEach((node, i) => {
      const next = reg.nodes[i + 1];
      if (next) segments.push({ d: hCurve(node, next), from: node.mission.id, to: next.mission.id, kind: 'road' });
    });
    const nextReg = regions[ri + 1];
    const last = reg.nodes[reg.nodes.length - 1];
    const first = nextReg?.nodes[0];
    if (last && first) {
      const side: 1 | -1 = ri % 2 === 0 ? 1 : -1;
      const bulge = Math.min(MX - 12, 100) * 1.25;
      segments.push({ d: uTurn(last, first, side, bulge), from: last.mission.id, to: first.mission.id, kind: 'bridge' });
    }
  });

  const firstNode = regions[0]?.nodes[0];
  let start: { x: number; y: number } | undefined;
  if (firstNode) {
    start = { x: 30, y: firstNode.y };
    segments.unshift({ d: hCurve(start, firstNode), to: firstNode.mission.id, kind: 'start' });
  }
  const lastReg = regions[regions.length - 1];
  const lastNode = lastReg?.nodes[lastReg.nodes.length - 1];
  const finish = lastNode ? { x: W / 2, y: lastReg!.top + lastReg!.height + 50 } : { x: W / 2, y: height - 40 };
  if (lastNode) segments.push({ d: vCurve(lastNode, finish), from: lastNode.mission.id, kind: 'finish' });

  const out: MapLayout = { mode: 'wide', width: W, height: finish.y + 70, regions, segments, finish };
  if (start) out.start = start;
  return out;
}

function narrowLayout(W: number, chapters: ChapterDef[], missionsOf: (chapterId: string) => MissionDef[]): MapLayout {
  const PAD_TOP = 16;
  const HEADER_H = 112;
  const FIRST_GAP = 70;
  const STEP = 108;
  const BOTTOM = 36;
  const GAP = 24;
  const A = Math.min(W * 0.25, 130);
  const cx = W / 2;

  const regions: MapRegion[] = [];
  let top = 0;
  let k = 0;
  chapters.forEach((chapter, index) => {
    const list = missionsOf(chapter.id);
    const headerY = top + PAD_TOP;
    const y0 = headerY + HEADER_H + FIRST_GAP;
    const nodes: MapNode[] = list.map((mission, i) => {
      const boss = mission.kind === 'boss';
      const x = boss ? cx : cx + A * Math.sin(k++ * 1.1 + 0.4);
      const y = y0 + i * STEP + (boss ? 12 : 0);
      const label: MapNode['label'] = x > cx + 4 ? 'left' : 'right';
      const room = label === 'left' ? x - (boss ? R_BOSS : R_NODE) - 20 : W - x - (boss ? R_BOSS : R_NODE) - 20;
      return { mission, x, y, r: boss ? R_BOSS : R_NODE, boss, label, labelWidth: Math.max(80, Math.min(190, room)) };
    });
    const lastY = nodes.length ? nodes[nodes.length - 1]!.y : y0;
    const height = lastY - top + (nodes[nodes.length - 1]?.r ?? R_NODE) + BOTTOM;
    regions.push({ chapter, index, top, height, header: { x: 12, y: headerY, w: W - 24, h: HEADER_H }, nodes });
    top += height + GAP;
  });

  const segments: MapSegment[] = [];
  const all = regions.flatMap((r) => r.nodes);
  all.forEach((node, i) => {
    const next = all[i + 1];
    if (!next) return;
    const bridge = node.mission.chapter !== next.mission.chapter;
    segments.push({ d: vCurve(node, next), from: node.mission.id, to: next.mission.id, kind: bridge ? 'bridge' : 'road' });
  });
  const lastNode = all[all.length - 1];
  const finish = { x: cx, y: top + 30 };
  if (lastNode) segments.push({ d: vCurve(lastNode, finish), from: lastNode.mission.id, kind: 'finish' });
  return { mode: 'narrow', width: W, height: finish.y + 80, regions, segments, finish };
}
