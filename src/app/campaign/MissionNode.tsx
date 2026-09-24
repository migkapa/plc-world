/** A mission node on the campaign map: locked (padlock), available (pulsing), completed (stars), boss (hex + crown). */
import { Crown, Lock, Wrench } from 'lucide-react';
import { useId } from 'react';
import type { MissionDef } from '../../game/types';
import { cn } from '../../ui';
import { mix } from '../hud/RankInsignia';
import type { MapNode } from './layout';
import type { MissionState } from './progress';

function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    pts.push(`${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

function MiniStars({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span className="flex items-end gap-px">
      {[0, 1, 2].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" className={cn(i === 1 && '-translate-y-0.5')}>
          <path
            d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5-4.9-4.6 6.6-.8z"
            fill={i < value ? '#facc15' : '#1e293b'}
            stroke={i < value ? '#fde68a' : '#475569'}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}

export interface MissionNodeProps {
  node: MapNode;
  state: MissionState;
  stars: number;
  color: string;
  selected: boolean;
  current: boolean;
  reducedMotion: boolean;
  /** Docked card: the node selects (aria-current). Drawer: the node opens a dialog (aria-haspopup). */
  docked: boolean;
  drawerOpen: boolean;
  onSelect(m: MissionDef): void;
}

export function MissionNodeButton({ node, state, stars, color, selected, current, reducedMotion, docked, drawerOpen, onSelect }: MissionNodeProps) {
  const uid = useId().replace(/:/g, '');
  const { mission, r, boss } = node;
  const size = r * 2;
  const locked = state === 'locked';
  const done = state === 'completed';
  const shape = boss ? hexPath(r - 2) : undefined;
  const fillId = `nf-${uid}`;
  const ring = locked ? '#334155' : color;
  const labelCls =
    node.label === 'below'
      ? 'top-full left-1/2 mt-2 -translate-x-1/2 text-center items-center'
      : node.label === 'left'
        ? 'right-full top-1/2 mr-3 -translate-y-1/2 text-right items-end'
        : 'left-full top-1/2 ml-3 -translate-y-1/2 text-left items-start';

  return (
    <button
      type="button"
      id={`mission-node-${mission.id}`}
      onClick={() => onSelect(mission)}
      {...(docked
        ? { 'aria-current': selected ? ('true' as const) : undefined, 'aria-controls': selected ? 'mission-card' : undefined }
        : { 'aria-haspopup': 'dialog' as const, 'aria-expanded': selected && drawerOpen })}
      aria-label={`${mission.id} ${mission.title}: ${locked ? 'locked' : done ? `completed, ${stars} of 3 stars` : 'available'}${boss ? ', boss mission' : ''}`}
      className={cn(
        'group absolute z-10 flex cursor-pointer items-center justify-center rounded-full outline-none',
        'focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0b0f14]',
      )}
      style={{ left: node.x - r, top: node.y - r, width: size, height: size }}
    >
      {/* pulsing halo for the playable node */}
      {state === 'available' && (
        <span
          className={cn('pointer-events-none absolute inset-0', boss ? '' : 'rounded-full', !reducedMotion && 'pw-halo')}
          style={{
            boxShadow: `0 0 0 3px ${color}`,
            opacity: reducedMotion ? 0.35 : undefined,
            clipPath: boss ? 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' : undefined,
            background: boss ? `${color}55` : undefined,
          }}
        />
      )}
      {/* selection ring */}
      {selected && (
        <span
          className="pointer-events-none absolute -inset-[7px] rounded-full border-2 border-white/80 shadow-[0_0_18px_rgba(255,255,255,0.25)]"
          style={boss ? { borderRadius: 18 } : undefined}
        />
      )}

      <svg
        width={size}
        height={size}
        viewBox={`${-r} ${-r} ${size} ${size}`}
        className={cn('relative overflow-visible transition-transform duration-200', !locked && 'group-hover:scale-110', locked && 'group-hover:scale-105')}
        style={{ filter: done ? `drop-shadow(0 0 10px ${color}77)` : state === 'available' ? `drop-shadow(0 0 14px ${color}66)` : undefined }}
      >
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor={mix(color, '#ffffff', 0.25)} />
            <stop offset="1" stopColor={mix(color, '#000000', 0.45)} />
          </linearGradient>
        </defs>
        {/* drop base (3D token) */}
        {boss ? (
          <path d={shape} transform="translate(0 4)" fill="#05080b" opacity="0.8" />
        ) : (
          <circle r={r - 2} cy={4} fill="#05080b" opacity="0.8" />
        )}
        {boss ? (
          <path
            d={shape}
            fill={done ? `url(#${fillId})` : locked ? '#11161c' : mix(color, '#0b0f14', 0.82)}
            stroke={ring}
            strokeWidth={locked ? 2 : 3.5}
          />
        ) : (
          <circle r={r - 2} fill={done ? `url(#${fillId})` : locked ? '#11161c' : mix(color, '#0b0f14', 0.82)} stroke={ring} strokeWidth={locked ? 2 : 3.5} />
        )}
        {/* inner bevel */}
        {boss ? (
          <path d={hexPath(r - 9)} fill="none" stroke={done ? '#ffffff' : ring} strokeOpacity={done ? 0.35 : 0.3} strokeWidth="1.5" />
        ) : (
          <circle r={r - 8} fill="none" stroke={done ? '#ffffff' : ring} strokeOpacity={done ? 0.3 : 0.25} strokeWidth="1.5" />
        )}
        {/* boss hazard notches */}
        {boss && !locked && (
          <g stroke={done ? '#0b0f14' : color} strokeWidth="3" opacity="0.55">
            <line x1={-8} y1={r - 8} x2={-4} y2={r - 14} />
            <line x1={0} y1={r - 8} x2={4} y2={r - 14} />
            <line x1={8} y1={r - 8} x2={12} y2={r - 14} />
          </g>
        )}
      </svg>

      {/* face */}
      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {locked ? (
          <Lock size={boss ? 20 : 16} className="text-slate-500" />
        ) : boss ? (
          <>
            <Crown size={22} className={done ? 'text-white drop-shadow' : ''} style={done ? undefined : { color }} strokeWidth={2.4} />
            <span className={cn('mt-0.5 font-mono text-[11px] leading-none font-bold', done ? 'text-white' : 'text-slate-200')}>{mission.id}</span>
          </>
        ) : (
          <span className={cn('font-mono text-[14px] font-bold tracking-tight', done ? 'text-white drop-shadow' : '')} style={done ? undefined : { color: mix(color, '#ffffff', 0.35) }}>
            {mission.id}
          </span>
        )}
      </span>

      {/* troubleshoot badge */}
      {mission.kind === 'troubleshoot' && !locked && (
        <span
          className="pointer-events-none absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#0b0f14] text-[#0b0f14]"
          style={{ background: color }}
          title="Troubleshooting mission"
        >
          <Wrench size={11} strokeWidth={2.8} />
        </span>
      )}
      {/* boss tag */}
      {boss && (
        <span
          className={cn(
            'pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 rounded-md border px-1.5 font-mono text-[9px] leading-[15px] font-bold tracking-widest',
            locked ? 'border-slate-700 bg-slate-900 text-slate-400' : 'border-black/40 text-black',
          )}
          style={locked ? undefined : { background: `repeating-linear-gradient(135deg, ${color} 0 6px, ${mix(color, '#000000', 0.2)} 6px 12px)` }}
        >
          BOSS
        </span>
      )}

      {/* stars under the node */}
      {done && (
        <span className="pointer-events-none absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[#0b0f14]/90 px-1 py-px">
          <MiniStars value={stars} size={boss ? 13 : 11} />
        </span>
      )}

      {/* "you are here" marker */}
      {current && (
        <span className={cn('pointer-events-none absolute left-1/2 z-20', !reducedMotion && 'pw-bob')} style={{ bottom: `calc(100% + ${boss ? 18 : 10}px)`, transform: 'translateX(-50%)' }}>
          <span className="flex flex-col items-center">
            <span className="rounded-md bg-ab-red px-1.5 py-0.5 font-mono text-[10px] leading-none font-bold tracking-wider whitespace-nowrap text-white shadow-lg shadow-red-900/60">
              NEXT
            </span>
            <span className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-ab-red" />
          </span>
        </span>
      )}

      {/* label */}
      <span className={cn('pointer-events-none absolute flex flex-col gap-0.5', labelCls)} style={{ width: node.labelWidth }}>
        <span
          className={cn(
            'line-clamp-2 text-[12.5px] leading-tight font-semibold',
            locked ? 'text-slate-400' : selected ? 'text-white' : 'text-slate-200 group-hover:text-white',
            done && node.label === 'below' && 'mt-1.5',
          )}
        >
          {mission.title}
        </span>
      </span>
    </button>
  );
}
