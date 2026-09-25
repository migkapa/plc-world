/**
 * Glossary section: short illustrated explanations of Logix concepts, with links to instructions, hardware
 * and missions.
 */
import { BookA, Box, Map as MapIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { cn } from '../../ui';
import { getMission } from '../../game/missions';
import { routes } from '../routes';
import { getShowroomDevice } from '../showroom/catalog';
import { GLOSSARY, glossaryHref, type GlossaryEntry } from './glossaryData';
import { GlossaryArt } from './GlossaryArt';
import { InlineMd } from './InlineMd';
import { MnemonicBadge } from './InstructionList';

export function Glossary({ reducedMotion, term }: { reducedMotion: boolean; term?: string }) {
  const [, navigate] = useLocation();
  // deep link (/reference/glossary:<id>): bring that term into view
  useEffect(() => {
    if (!term) return;
    const raf = requestAnimationFrame(() => document.getElementById(`g-${term}`)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(raf);
  }, [term, reducedMotion]);
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
      <header className="mb-5">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-amber-300 uppercase">
          <BookA size={14} /> Glossary
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">The words controls techs use</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-slate-400">
          Ten ideas that explain most of the “why is it doing that?” moments on a Logix controller — each with a picture.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {GLOSSARY.map((g) => (
            <a
              key={g.id}
              href={`#${glossaryHref(g.id)}`}
              aria-current={term === g.id ? 'location' : undefined}
              onClick={(e) => {
                e.preventDefault();
                if (term === g.id) document.getElementById(`g-${g.id}`)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
                else navigate(glossaryHref(g.id), { replace: true });
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[12px] font-medium hover:border-slate-500 hover:text-white',
                term === g.id ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : 'border-edge bg-panel-3/60 text-slate-300',
              )}
            >
              {g.term}
            </a>
          ))}
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        {GLOSSARY.map((g, i) => (
          <GlossaryCard key={g.id} entry={g} index={i} highlighted={term === g.id} />
        ))}
      </div>
    </div>
  );
}

function GlossaryCard({ entry: g, index, highlighted }: { entry: GlossaryEntry; index: number; highlighted: boolean }) {
  return (
    <article
      id={`g-${g.id}`}
      className={cn('flex scroll-mt-4 flex-col overflow-hidden rounded-xl border bg-panel-2 transition-colors', highlighted ? 'border-amber-400/60 ring-1 ring-amber-400/30' : 'border-edge')}
    >
      <div className="border-b border-edge bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.07),transparent_70%)] px-3 pt-2 pb-1">
        <GlossaryArt id={g.art} />
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <h2 className="flex items-baseline gap-2 text-[16px] font-bold text-white">
          <span className="font-mono text-[11px] font-semibold text-slate-400">{String(index + 1).padStart(2, '0')}</span>
          {g.term}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-slate-200">
          <InlineMd text={g.short} />
        </p>
        <ul className="space-y-1.5">
          {g.points.map((p, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-slate-400">
              <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-slate-500" />
              <span>
                <InlineMd text={p} />
              </span>
            </li>
          ))}
        </ul>
        {(g.instructions?.length || g.devices?.length || g.missions?.length) && (
          <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-edge/70 pt-2.5">
            {g.instructions?.map((m) => (
              <Link key={m} href={routes.reference(m)} title={`Open ${m}`}>
                <MnemonicBadge mnemonic={m} className="hover:brightness-125" />
              </Link>
            ))}
            {g.devices?.map((id) => {
              const d = getShowroomDevice(id);
              return d ? (
                <Link key={id} href={routes.showroom(id)} className="inline-flex items-center gap-1 rounded border border-edge bg-panel-3/60 px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-white">
                  <Box size={11} /> {d.catalog}
                </Link>
              ) : null;
            })}
            {g.missions?.map((id) => {
              const m = getMission(id);
              return m ? (
                <Link key={id} href={routes.mission(id)} className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[11px] text-sky-200 hover:bg-sky-500/20">
                  <MapIcon size={11} /> {m.id} {m.title}
                </Link>
              ) : null;
            })}
          </div>
        )}
      </div>
    </article>
  );
}
