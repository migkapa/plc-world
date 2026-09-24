/**
 * Levels and ranks. Cumulative XP to reach level n: round(120 * (n - 1)^1.6) (level 1 = 0 XP,
 * level 2 = 120, level 5 ≈ 1 100, level 10 ≈ 4 200, level 20 ≈ 13 300). Finishing the whole campaign
 * with three stars lands around level 20+, i.e. Master of Automation. Headless.
 */

export interface RankDef {
  /** First level of this rank. */
  minLevel: number;
  title: string;
  /** Accent colour (hex) for badges. */
  color: string;
  /** lucide-react icon name. */
  icon: string;
}

export const RANKS: readonly RankDef[] = [
  { minLevel: 1, title: 'Apprentice', color: '#94a3b8', icon: 'HardHat' },
  { minLevel: 3, title: 'Junior Technician', color: '#a3e635', icon: 'Wrench' },
  { minLevel: 5, title: 'Maintenance Tech', color: '#22c55e', icon: 'Hammer' },
  { minLevel: 7, title: 'Controls Technician', color: '#2dd4bf', icon: 'Cpu' },
  { minLevel: 9, title: 'Senior Controls Tech', color: '#38bdf8', icon: 'CircuitBoard' },
  { minLevel: 11, title: 'Controls Engineer', color: '#60a5fa', icon: 'Cog' },
  { minLevel: 13, title: 'Automation Engineer', color: '#a78bfa', icon: 'Workflow' },
  { minLevel: 15, title: 'Lead Integrator', color: '#f472b6', icon: 'Network' },
  { minLevel: 17, title: 'Principal Engineer', color: '#f97316', icon: 'Award' },
  { minLevel: 20, title: 'Master of Automation', color: '#f5c400', icon: 'Crown' },
];

/** Levels stop here (the curve keeps going, the display does not need to). */
export const MAX_LEVEL = 99;

/** Cumulative XP needed to reach `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return n <= 1 ? 0 : Math.round(120 * (n - 1) ** 1.6);
}

/** Rank held at `level`. */
export function rankForLevel(level: number): RankDef {
  let rank = RANKS[0]!;
  for (const r of RANKS) if (level >= r.minLevel) rank = r;
  return rank;
}

export interface LevelInfo {
  level: number;
  /** Rank title, e.g. 'Controls Technician'. */
  title: string;
  color: string;
  rank: RankDef;
  /** The next rank (undefined at the top). */
  nextRank?: RankDef;
  /** Progress through the current level, 0..1. */
  progress: number;
  /** Cumulative XP at which the current level started. */
  currentAt: number;
  /** Cumulative XP needed for the next level (= currentAt at MAX_LEVEL). */
  nextAt: number;
  /** XP still missing to the next level. */
  xpToNext: number;
}

/** Level, rank and progress for a total XP amount. */
export function levelForXp(xp: number): LevelInfo {
  const total = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let level = 1;
  while (level < MAX_LEVEL && total >= xpForLevel(level + 1)) level++;
  const currentAt = xpForLevel(level);
  const nextAt = level >= MAX_LEVEL ? currentAt : xpForLevel(level + 1);
  const span = nextAt - currentAt;
  const rank = rankForLevel(level);
  const nextRank = RANKS.find((r) => r.minLevel > level);
  const info: LevelInfo = {
    level,
    title: rank.title,
    color: rank.color,
    rank,
    progress: span > 0 ? Math.min(1, (total - currentAt) / span) : 1,
    currentAt,
    nextAt,
    xpToNext: Math.max(0, nextAt - total),
  };
  if (nextRank) info.nextRank = nextRank;
  return info;
}
