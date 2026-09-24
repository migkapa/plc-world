/**
 * <RankInsignia/> — SVG badge per rank tier, tinted with the rank colour.
 *
 *   tiers 0-2  shield   + 1..3 chevrons   (Apprentice → Maintenance Tech)
 *   tiers 3-5  hexagon  + 1..3 chevrons   (Controls Technician → Controls Engineer)
 *   tiers 6-8  gear     + 1..3 chevrons   (Automation Engineer → Principal Engineer)
 *   tier  9    starburst + 3 stars        (Master of Automation)
 *
 * The rank's lucide icon sits in the middle; `showLevel` adds a level ribbon.
 */
import { useId } from 'react';
import { levelForXp, RANKS, rankForLevel, type RankDef } from '../../game/ranks';
import { cn, gameIcon } from '../../ui';
import { rankTier } from './player';

const W = 120;
const H = 132;
const CX = 60;
const CY = 64;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a colour towards `to` by t (0..1). */
export function mix(hex: string, to: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(to);
  const c = a.map((x, i) => Math.round(x + (b[i]! - x) * t));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function polygon(points: Array<[number, number]>): string {
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L')} Z`;
}

function radial(n: number, rOuter: number, rInner: number, phase = -Math.PI / 2, cy = CY): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = phase + (i * Math.PI) / n;
    pts.push([CX + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polygon(pts);
}

function gear(teeth: number, rOuter: number, rRoot: number): string {
  const pts: Array<[number, number]> = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = -Math.PI / 2 + i * step;
    const q = step / 4;
    const at = (ang: number, r: number): [number, number] => [CX + r * Math.cos(ang), CY + r * Math.sin(ang)];
    pts.push(at(a - q * 1.25, rRoot), at(a - q * 0.7, rOuter), at(a + q * 0.7, rOuter), at(a + q * 1.25, rRoot));
  }
  return polygon(pts);
}

const SHAPES = {
  shield: 'M60 6 L108 20 V62 C108 94 86 116 60 127 C34 116 12 94 12 62 V20 Z',
  hex: polygon([
    [60, 5],
    [111, 34.5],
    [111, 93.5],
    [60, 123],
    [9, 93.5],
    [9, 34.5],
  ]),
  gear: gear(12, 59, 51),
  star: radial(12, 60, 50),
} as const;

function shapeFor(tier: number): keyof typeof SHAPES {
  if (tier >= 9) return 'star';
  if (tier >= 6) return 'gear';
  if (tier >= 3) return 'hex';
  return 'shield';
}

export interface RankInsigniaProps {
  /** Player level (rank derived from it). */
  level?: number;
  /** Or give the rank explicitly. */
  rank?: RankDef;
  /** Width in px (height = width × 1.1). */
  size?: number;
  /** Show a "LV n" ribbon at the bottom. */
  showLevel?: boolean;
  /** Greyed out (locked rank in a ladder). */
  dim?: boolean;
  /** Soft glow in the rank colour. */
  glow?: boolean;
  className?: string;
  title?: string;
}

export function RankInsignia({ level, rank: rankProp, size = 48, showLevel, dim, glow = true, className, title }: RankInsigniaProps) {
  const uid = useId().replace(/:/g, '');
  const rank = rankProp ?? rankForLevel(level ?? 1);
  const tier = rankTier(rank);
  const shape = SHAPES[shapeFor(tier)];
  const base = dim ? '#475569' : rank.color;
  const light = mix(base, '#ffffff', 0.45);
  const dark = mix(base, '#000000', 0.55);
  const Icon = gameIcon(rank.icon);
  const chevrons = tier >= 9 ? 0 : (tier % 3) + 1;
  const iconSize = 38;
  const iconY = chevrons > 0 ? CY - 30 : CY - 22;
  const inner = `translate(${CX} ${CY}) scale(0.8) translate(${-CX} ${-CY})`;
  const shownLevel = level ?? rank.minLevel;

  return (
    <svg
      viewBox={`0 0 ${W} ${H + (showLevel ? 6 : 0)}`}
      width={size}
      height={(size * (H + (showLevel ? 6 : 0))) / W}
      className={cn('shrink-0 overflow-visible', className)}
      style={glow && !dim ? { filter: `drop-shadow(0 0 ${Math.max(2, size / 14)}px ${rank.color}66)` } : undefined}
      role="img"
      aria-label={title ?? `${rank.title}${level ? ` — level ${level}` : ''}`}
    >
      <title>{title ?? `${rank.title}${level ? ` · Level ${level}` : ''}`}</title>
      <defs>
        <linearGradient id={`rim-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.45" stopColor={base} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
        <radialGradient id={`core-${uid}`} cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" stopColor={mix(base, '#1c242d', 0.78)} />
          <stop offset="1" stopColor="#0b0f14" />
        </radialGradient>
        <linearGradient id={`shine-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* rim */}
      <path d={shape} fill={`url(#rim-${uid})`} stroke={dark} strokeWidth="1.5" />
      {/* inner plate */}
      <path d={shape} transform={inner} fill={`url(#core-${uid})`} stroke={base} strokeOpacity="0.55" strokeWidth="2" />
      {/* rivets for the industrial look */}
      {tier < 9 &&
        [
          [CX - 34, CY - 30],
          [CX + 34, CY - 30],
        ].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.2" fill={light} opacity="0.55" />)}

      {/* rank icon */}
      <Icon x={CX - iconSize / 2} y={iconY} width={iconSize} height={iconSize} color={dim ? '#94a3b8' : light} strokeWidth={2} />

      {/* chevrons */}
      {Array.from({ length: chevrons }, (_, i) => {
        const y = CY + 16 + i * 10;
        return (
          <path
            key={i}
            d={`M${CX - 20} ${y} L${CX} ${y + 8} L${CX + 20} ${y}`}
            fill="none"
            stroke={dim ? '#64748b' : base}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
      {/* master: three stars */}
      {tier >= 9 &&
        [-18, 0, 18].map((dx, i) => (
          <path key={i} d={radial(5, i === 1 ? 7 : 5.5, i === 1 ? 3 : 2.4, -Math.PI / 2, 0)} transform={`translate(${dx} ${CY + 22 - (i === 1 ? 2 : 0)})`} fill={light} />
        ))}

      {/* shine */}
      <path d={shape} fill={`url(#shine-${uid})`} pointerEvents="none" />

      {showLevel && (
        <g>
          <path d={`M22 ${H - 20} H98 L92 ${H - 8} L98 ${H + 4} H22 L28 ${H - 8} Z`} fill="#0b0f14" stroke={base} strokeWidth="2.5" />
          <text
            x={CX}
            y={H - 2.5}
            textAnchor="middle"
            fontFamily="'JetBrains Mono', ui-monospace, monospace"
            fontWeight="700"
            fontSize="15"
            fill={dim ? '#94a3b8' : '#ffffff'}
            letterSpacing="1"
          >
            LV {shownLevel}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Insignia for a total XP amount. */
export function RankInsigniaForXp({ xp, ...rest }: Omit<RankInsigniaProps, 'level' | 'rank'> & { xp: number }) {
  return <RankInsignia level={levelForXp(xp).level} {...rest} />;
}

export { RANKS };
