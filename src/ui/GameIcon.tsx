import {
  Award,
  Bike,
  BookOpen,
  Briefcase,
  CircuitBoard,
  Clock,
  Cog,
  Cpu,
  Crown,
  Flame,
  Gauge,
  Hammer,
  HardHat,
  Hash,
  IdCard,
  Keyboard,
  Lightbulb,
  Link,
  Magnet,
  Medal,
  Moon,
  Mountain,
  Network,
  OctagonX,
  Pencil,
  Rocket,
  Ruler,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  Store,
  Target,
  Timer,
  ToggleRight,
  TrendingUp,
  Trophy,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

/**
 * lucide-react icons referenced BY NAME from game data (chapters, ranks, achievements).
 * Curated (instead of lucide's full `icons` map) to keep the bundle small; unknown names fall back to a trophy.
 */
const GAME_ICONS: Record<string, LucideIcon> = {
  Award,
  Bike,
  BookOpen,
  Briefcase,
  CircuitBoard,
  Clock,
  Cog,
  Cpu,
  Crown,
  Flame,
  Gauge,
  Hammer,
  HardHat,
  Hash,
  IdCard,
  Keyboard,
  Lightbulb,
  Link,
  Magnet,
  Medal,
  Moon,
  Mountain,
  Network,
  OctagonX,
  Pencil,
  Rocket,
  Ruler,
  ShieldCheck,
  Siren,
  Sparkles,
  Star,
  Store,
  Target,
  Timer,
  ToggleRight,
  TrendingUp,
  Trophy,
  Workflow,
  Wrench,
  Zap,
};

/** Resolve a lucide icon name used by game data (falls back to Trophy). */
export function gameIcon(name: string | undefined): LucideIcon {
  return (name && GAME_ICONS[name]) || Trophy;
}

/** Render a lucide icon by name (chapter / rank / achievement `icon` fields). */
export function GameIcon({ name, ...rest }: { name: string | undefined } & LucideProps) {
  const Icon = gameIcon(name);
  return <Icon {...rest} />;
}
