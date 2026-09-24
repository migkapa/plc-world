/**
 * Right-hand info card of the showroom: catalog number, what / where, specs, indicator meanings,
 * wiring notes and links into the campaign.
 */
import { AlertTriangle, BookOpen, Cable, CircuitBoard, Info, Lightbulb, Lock, Map as MapIcon, Play, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { getMission } from '../../game/missions';
import { useGame } from '../../game/store';
import { SCENE_LOGICS } from '../../sim/scenes';
import { Markdown, cn } from '../../ui';
import { InlineMd } from '../reference/InlineMd';
import { routes } from '../routes';
import { SHOWROOM_GROUPS, getShowroomDevice, type IndicatorColor, type ShowroomDevice } from './catalog';

const SWATCH: Record<IndicatorColor, string> = {
  green: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
  red: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]',
  amber: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
  yellow: 'bg-yellow-300 shadow-[0_0_8px_rgba(253,224,71,0.8)]',
  orange: 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.8)]',
  blue: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]',
  white: 'bg-slate-100 shadow-[0_0_8px_rgba(241,245,249,0.7)]',
  off: 'bg-slate-700 ring-1 ring-slate-600',
  redgreen: 'bg-gradient-to-r from-red-500 to-emerald-400',
};

export function InfoCard({ device, reducedMotion, className, scroll = true }: { device: ShowroomDevice; reducedMotion: boolean; className?: string; scroll?: boolean }) {
  const group = SHOWROOM_GROUPS.find((g) => g.id === device.group)!;
  const hasApprox = device.specs.some((s) => s.approx);
  return (
    <article className={cn('flex min-h-0 flex-col', className)} aria-label={`${device.name} information`}>
      <header className="relative overflow-hidden border-b border-edge px-4 pt-4 pb-3">
        <div className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full opacity-25 blur-3xl" style={{ background: group.accent }} />
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          <span className="h-2 w-2 rounded-full" style={{ background: group.accent }} />
          {group.title}
          <span className="text-slate-600" aria-hidden>·</span>
          <span className="truncate normal-case">{device.family}</span>
        </div>
        <h2 className="mt-1.5">
          <span className="block font-mono text-2xl leading-tight font-bold tracking-tight text-white">{device.catalog}</span>
          <span className="block text-[15px] font-semibold text-slate-200">{device.name}</span>
        </h2>
        <p className="mt-1 text-[13px] leading-snug text-slate-400">{device.tagline}</p>
        <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="Sections">
          {[
            ['specs', 'Specs'],
            ...(device.indicators.length ? [['leds', 'Indicators']] : []),
            ['wiring', 'Wiring'],
            ['world', 'In PLC World'],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#sr-${id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(`sr-${id}`)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
              }}
              className="rounded-full border border-edge bg-panel-3/70 px-2.5 py-0.5 text-[11px] font-semibold text-slate-300 hover:border-slate-500 hover:text-white"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <div className={cn('space-y-5 px-4 py-4', scroll && 'min-h-0 flex-1 overflow-y-auto')} data-scroll="info">
        <Section icon={<Info size={14} />} title="What it is">
          <Markdown source={device.what} className="text-[13px]" />
        </Section>
        <Section icon={<Sparkles size={14} />} title="Where it’s used">
          <Markdown source={device.where} className="text-[13px]" />
        </Section>

        <Section id="sr-specs" icon={<CircuitBoard size={14} />} title="Key specs">
          <dl className="divide-y divide-edge/70 overflow-hidden rounded-lg border border-edge bg-panel/50">
            {device.specs.map((s) => (
              <div key={s.label} className="grid grid-cols-[minmax(0,38%)_1fr] gap-3 px-3 py-1.5 text-[12.5px]">
                <dt className="text-slate-400">{s.label}</dt>
                <dd className="flex items-start gap-1.5 text-slate-100">
                  <span className="min-w-0">
                    <InlineMd text={s.value} />
                  </span>
                  {s.approx && (
                    <span title="Not confirmed against a primary source — check the Rockwell data sheet" className="mt-0.5 shrink-0 text-amber-400">
                      <AlertTriangle size={12} />
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {hasApprox && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
              <AlertTriangle size={11} className="text-amber-400" /> = check the current data sheet before relying on it.
            </p>
          )}
        </Section>

        {device.indicators.length > 0 && (
          <Section id="sr-leds" icon={<Lightbulb size={14} />} title="LED / indicator meanings">
            <div className="space-y-3">
              {device.indicators.map((ind) => (
                <div key={ind.name} className="overflow-hidden rounded-lg border border-edge bg-panel/50">
                  <div className="border-b border-edge bg-panel-3/50 px-3 py-1 font-mono text-[11.5px] font-semibold text-slate-200">{ind.name}</div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {ind.states.map((st, i) => (
                        <tr key={i} className="border-b border-edge/50 align-top last:border-0">
                          <td className="w-7 py-1.5 pl-3">
                            <span
                              className={cn('mt-1 inline-block h-2.5 w-2.5 rounded-full', SWATCH[st.color], st.blink && !reducedMotion && 'animate-pulse')}
                              aria-hidden
                            />
                          </td>
                          <td className="w-[34%] py-1.5 pr-2 font-medium text-slate-200">{st.state}</td>
                          <td className="py-1.5 pr-3 text-slate-400">{st.meaning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section id="sr-wiring" icon={<Cable size={14} />} title="How it is wired">
          <Markdown source={device.wiring.summary} className="text-[13px]" />
          <ul className="mt-2 space-y-1.5">
            {device.wiring.notes.map((n, i) => (
              <li key={i} className="flex gap-2 rounded-md border border-edge/60 bg-panel/40 px-2.5 py-1.5 text-[12.5px] leading-snug text-slate-300">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-safety" />
                <span>
                  <InlineMd text={n} />
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="sr-world" icon={<MapIcon size={14} />} title="In PLC World">
          <InWorld device={device} />
        </Section>

        {device.related && device.related.length > 0 && (
          <Section icon={<BookOpen size={14} />} title="Related hardware">
            <div className="flex flex-wrap gap-1.5">
              {device.related.map((id) => {
                const r = getShowroomDevice(id);
                if (!r) return null;
                return (
                  <Link key={id} href={routes.showroom(id)} className="rounded-md border border-edge bg-panel-3/60 px-2 py-1 text-[12px] text-slate-300 hover:border-slate-500 hover:text-white">
                    <span className="font-mono text-[11px] text-slate-400">{r.catalog}</span> {r.name}
                  </Link>
                );
              })}
            </div>
          </Section>
        )}

        <p className="border-t border-edge pt-3 text-[11px] leading-relaxed text-slate-400">
          {device.note ?? 'Condensed from Rockwell Automation user manuals and technical data. Always follow the product’s own documentation on real equipment.'}{' '}
          PLC World is not affiliated with Rockwell Automation.
        </p>
      </div>
    </article>
  );
}

function Section({ id, icon, title, children }: { id?: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase">
        <span className="text-ab-red">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function InWorld({ device }: { device: ShowroomDevice }) {
  const profile = useGame((s) => s.profile);
  const isUnlocked = useGame((s) => s.isUnlocked);
  const { scenes, missions, note } = device.inWorld;
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] leading-snug text-slate-300">{note}</p>
      {scenes.length > 0 && (
        <div>
          <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Plants</div>
          <div className="flex flex-wrap gap-1.5">
            {scenes.map((id) => (
              <Link
                key={id}
                href={routes.sandbox(id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[12px] font-medium text-sky-200 hover:bg-sky-500/20"
              >
                <Play size={11} /> {SCENE_LOGICS[id]?.title ?? id}
              </Link>
            ))}
          </div>
        </div>
      )}
      {missions.length > 0 && (
        <div>
          <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">Missions</div>
          <div className="grid gap-1">
            {missions.map((id) => {
              const m = getMission(id);
              if (!m) return null;
              const unlocked = isUnlocked(id);
              const done = profile.missions[id]?.completed;
              return (
                <Link
                  key={id}
                  href={routes.mission(id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12.5px] transition-colors',
                    unlocked ? 'border-edge bg-panel-3/50 text-slate-200 hover:border-slate-500' : 'border-edge/60 bg-panel/40 text-slate-500',
                  )}
                >
                  <span className="w-8 shrink-0 font-mono text-[11px] text-slate-400">{m.id}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{m.title}</span>
                  {done ? (
                    <span className="text-[10.5px] font-semibold text-emerald-400">DONE</span>
                  ) : !unlocked ? (
                    <Lock size={12} className="text-slate-500" aria-label="Locked" />
                  ) : (
                    <span className="text-[10.5px] font-semibold text-slate-400">PLAY</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
