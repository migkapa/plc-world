/**
 * Showroom device list (grouped) with an "explored" progress meter, plus a compact picker for small screens.
 */
import { Cable, ChevronLeft, ChevronRight, CircleDot, Cpu, Factory, Gauge, PanelsTopLeft, Search, Server, TrafficCone, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ProgressBar, cn } from '../../ui';
import { routes } from '../routes';
import { SHOWROOM_DEVICES, SHOWROOM_GROUPS, devicesInGroup, type ShowroomDevice, type ShowroomGroup } from './catalog';
import { matchesQuery } from './search';

/** Search match over name, catalog number, family, tagline and nicknames (normalised: '24V' finds '24 V'). */
export function deviceMatches(d: ShowroomDevice, query: string): boolean {
  return matchesQuery(`${d.name} ${d.catalog} ${d.family} ${d.tagline} ${(d.keywords ?? []).join(' ')}`, query);
}

export const GROUP_ICONS: Record<ShowroomGroup['icon'], LucideIcon> = { Cpu, Cable, Server, Gauge, CircleDot, PanelsTopLeft, Factory, TrafficCone };

export function DeviceList({ current, explored, className }: { current: string; explored: ReadonlySet<string>; className?: string }) {
  const [query, setQuery] = useState('');
  const q = query.trim();
  const match = (d: ShowroomDevice) => deviceMatches(d, q);
  const total = SHOWROOM_DEVICES.length;
  const count = SHOWROOM_DEVICES.filter((d) => explored.has(d.id)).length;
  return (
    <nav className={cn('flex min-h-0 flex-col', className)} aria-label="Showroom devices">
      <div className="space-y-2.5 border-b border-edge px-3 pt-3 pb-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[15px] font-bold tracking-tight text-white">Hardware Showroom</h1>
          <span className="font-mono text-[11px] text-slate-400">
            {count}/{total}
          </span>
        </div>
        <div>
          <ProgressBar value={count / total} color="bg-gradient-to-r from-ab-red to-amber-400" className="h-1.5" />
          <div className="mt-1 text-[10.5px] text-slate-400">{count === total ? 'Every device explored — nice!' : 'Devices explored'}</div>
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-edge bg-panel px-2 text-slate-400 focus-within:border-slate-500">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hardware…"
            aria-label="Search hardware"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {SHOWROOM_GROUPS.map((g) => {
          const items = devicesInGroup(g.id).filter(match);
          if (items.length === 0) return null;
          const Icon = GROUP_ICONS[g.icon];
          return (
            <div key={g.id} className="mb-2">
              <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-slate-400 uppercase">
                <Icon size={12} style={{ color: g.accent }} />
                {g.title}
              </div>
              {items.map((d) => {
                const active = d.id === current;
                const seen = explored.has(d.id);
                return (
                  <Link
                    key={d.id}
                    href={routes.showroom(d.id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-2 rounded-lg py-1.5 pr-2 pl-3 transition-colors',
                      active ? 'bg-white/[0.07] text-white' : 'text-slate-300 hover:bg-white/[0.04] hover:text-white',
                    )}
                  >
                    {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full" style={{ background: g.accent }} />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-tight font-medium">{d.name}</span>
                      <span className="block truncate font-mono text-[10.5px] text-slate-400">{d.catalog}</span>
                    </span>
                    {!seen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Not explored yet" />}
                  </Link>
                );
              })}
            </div>
          );
        })}
        {q && SHOWROOM_DEVICES.filter(match).length === 0 && <div className="px-3 py-6 text-center text-[13px] text-slate-400">Nothing matches “{query}”.</div>}
      </div>
    </nav>
  );
}

/** Small-screen picker: native grouped select + previous/next. */
export function DevicePicker({ current, onPick, explored }: { current: string; onPick(id: string): void; explored: ReadonlySet<string> }) {
  const idx = SHOWROOM_DEVICES.findIndex((d) => d.id === current);
  const prev = SHOWROOM_DEVICES[(idx - 1 + SHOWROOM_DEVICES.length) % SHOWROOM_DEVICES.length]!;
  const next = SHOWROOM_DEVICES[(idx + 1) % SHOWROOM_DEVICES.length]!;
  const groups = useMemo(() => SHOWROOM_GROUPS.map((g) => ({ g, items: devicesInGroup(g.id) })), []);
  const count = SHOWROOM_DEVICES.filter((d) => explored.has(d.id)).length;
  return (
    <div className="flex items-center gap-2">
      <Link href={routes.showroom(prev.id)} aria-label={`Previous: ${prev.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-panel-2 text-slate-300">
        <ChevronLeft size={16} />
      </Link>
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Device</span>
        <select
          value={current}
          onChange={(e) => onPick(e.target.value)}
          className="h-9 w-full appearance-none rounded-lg border border-edge bg-panel-2 pr-12 pl-3 text-[13px] font-medium text-slate-100"
        >
          {groups.map(({ g, items }) => (
            <optgroup key={g.id} label={g.title}>
              {items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.catalog}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[10.5px] text-slate-400">
          {count}/{SHOWROOM_DEVICES.length}
        </span>
      </label>
      <Link href={routes.showroom(next.id)} aria-label={`Next: ${next.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-panel-2 text-slate-300">
        <ChevronRight size={16} />
      </Link>
    </div>
  );
}
