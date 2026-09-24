/**
 * Instruction Reference (/reference/:mnemonic?): instruction browser, detail with InstructionHelp and a live
 * "Try it" playground (ladder + inputs + timing diagram), and the glossary (/reference/glossary).
 */
import { ArrowLeft, ArrowRight, BookA, BookOpen, ChevronLeft, FlaskConical, Map as MapIcon, Zap } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { InstructionHelp } from '../../editor';
import { MISSIONS } from '../../game/missions';
import { useGame } from '../../game/store';
import { INSTRUCTION_CATEGORIES, INSTRUCTIONS, instructionsByCategory } from '../../plc/instructions';
import { cn } from '../../ui';
import { useReducedMotion } from '../hud/prefs';
import { Glossary } from '../reference/Glossary';
import { GLOSSARY, glossaryHref, parseGlossaryParam } from '../reference/glossary';
import { InlineMd } from '../reference/InlineMd';
import { ALL_MNEMONICS, CATEGORY_STYLE, InstructionList, MnemonicBadge, matchInstruction } from '../reference/InstructionList';
import { Playground } from '../reference/Playground';
import { playgroundFor } from '../reference/playgrounds';
import { useMedia } from '../reference/useMedia';
import { routes } from '../routes';
import '../showroom/showroom.css';

const VIEWED_KEY = 'plc-world-reference-viewed-v1';

function loadViewed(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(VIEWED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveViewed(s: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(VIEWED_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

export default function ReferencePage() {
  const params = useParams<{ mnemonic?: string }>();
  const raw = params.mnemonic ? decodeURIComponent(params.mnemonic) : undefined;
  const glossaryRoute = parseGlossaryParam(raw);
  const glossary = glossaryRoute !== null;
  const glossaryTerm = glossaryRoute?.term;
  const mnemonic = raw && !glossary ? raw.toUpperCase() : undefined;
  const info = mnemonic ? INSTRUCTIONS[mnemonic] : undefined;
  const desktop = useMedia('(min-width: 1024px)');
  const reducedMotion = useReducedMotion();
  const recordEvent = useGame((s) => s.recordEvent);
  const [viewed, setViewed] = useState<Set<string>>(loadViewed);

  useEffect(() => {
    if (!info) return;
    setViewed((prev) => {
      if (prev.has(info.mnemonic)) return prev;
      const next = new Set(prev).add(info.mnemonic);
      saveViewed(next);
      return next;
    });
    recordEvent({ type: 'referenceViewed', mnemonic: info.mnemonic });
  }, [info, recordEvent]);

  // scroll the main pane to the top when the page changes (a glossary deep link scrolls to its term instead)
  useEffect(() => {
    if (!glossaryTerm) document.getElementById('ref-main')?.scrollTo({ top: 0 });
  }, [raw, glossaryTerm]);

  const main = glossary ? (
    <Glossary reducedMotion={reducedMotion} term={glossaryTerm} />
  ) : info ? (
    <Detail mnemonic={info.mnemonic} compact={!desktop} />
  ) : (
    <Landing unknown={raw} viewed={viewed} showList={!desktop} />
  );

  if (!desktop) {
    return (
      <div id="ref-main" className="h-full overflow-x-hidden overflow-y-auto">
        {(info || glossary) && <MobileBar mnemonic={info?.mnemonic} />}
        {main}
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[272px_minmax(0,1fr)]">
      <InstructionList current={info?.mnemonic} viewed={viewed} glossaryActive={glossary} className="min-h-0 border-r border-edge bg-panel/70" />
      <div id="ref-main" className="min-h-0 overflow-y-auto">
        {main}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function neighbours(m: string): { prev: string; next: string } {
  const i = ALL_MNEMONICS.indexOf(m);
  const n = ALL_MNEMONICS.length;
  return { prev: ALL_MNEMONICS[(i - 1 + n) % n]!, next: ALL_MNEMONICS[(i + 1) % n]! };
}

function MobileBar({ mnemonic }: { mnemonic?: string }) {
  const nb = mnemonic ? neighbours(mnemonic) : null;
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-edge bg-panel/95 px-3 py-2 backdrop-blur">
      <Link href={routes.reference()} className="flex h-8 items-center gap-1 rounded-lg border border-edge bg-panel-2 px-2.5 text-[12.5px] font-medium text-slate-300">
        <ChevronLeft size={14} /> All instructions
      </Link>
      <div className="flex-1" />
      {nb && (
        <>
          <Link href={routes.reference(nb.prev)} aria-label={`Previous: ${nb.prev}`} className="flex h-8 items-center gap-1 rounded-lg border border-edge bg-panel-2 px-2 font-mono text-[11px] text-slate-300">
            <ArrowLeft size={13} /> {nb.prev}
          </Link>
          <Link href={routes.reference(nb.next)} aria-label={`Next: ${nb.next}`} className="flex h-8 items-center gap-1 rounded-lg border border-edge bg-panel-2 px-2 font-mono text-[11px] text-slate-300">
            {nb.next} <ArrowRight size={13} />
          </Link>
        </>
      )}
    </div>
  );
}

function Detail({ mnemonic, compact }: { mnemonic: string; compact: boolean }) {
  const info = INSTRUCTIONS[mnemonic]!;
  const def = playgroundFor(mnemonic);
  const st = CATEGORY_STYLE[info.category];
  const { prev, next } = neighbours(mnemonic);
  const missions = useMemo(() => MISSIONS.filter((m) => m.concepts.some((c) => c.toUpperCase() === mnemonic)), [mnemonic]);
  const Icon = st.icon;
  return (
    <div className="mx-auto max-w-[1320px] px-3 py-4 sm:px-5 sm:py-5">
      {!compact && (
        <div className="mb-3 flex items-center gap-2 text-[12px] text-slate-400">
          <Link href={routes.reference()} className="hover:text-slate-200">
            Reference
          </Link>
          <span>/</span>
          <span className="flex items-center gap-1" style={{ color: st.color }}>
            <Icon size={12} /> {info.category}
          </span>
          <span>/</span>
          <span className="font-mono font-semibold text-slate-200">{mnemonic}</span>
          <div className="flex-1" />
          <Link href={routes.reference(prev)} className="flex items-center gap-1 rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-slate-300 hover:text-white">
            <ArrowLeft size={12} /> {prev}
          </Link>
          <Link href={routes.reference(next)} className="flex items-center gap-1 rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[11px] text-slate-300 hover:text-white">
            {next} <ArrowRight size={12} />
          </Link>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(340px,5fr)_minmax(0,7fr)]">
        <header className="flex items-start gap-3 xl:hidden">
          <MnemonicBadge mnemonic={mnemonic} className="h-8 min-w-[56px] px-2 text-[14px]" />
          <div className="min-w-0">
            <h1 className="text-lg leading-tight font-bold text-white">{info.name}</h1>
            <p className="mt-0.5 text-[13px] leading-snug text-slate-400">{info.summary}</p>
          </div>
        </header>
        <div className="order-2 space-y-4 xl:sticky xl:top-0 xl:order-none">
          <section className="relative overflow-hidden rounded-xl border border-edge bg-panel-2 p-4">
            <div className="pointer-events-none absolute -top-20 -right-16 h-48 w-48 rounded-full opacity-20 blur-3xl" style={{ background: st.color }} />
            <InstructionHelp info={info} />
          </section>
          {missions.length > 0 && (
            <section className="rounded-xl border border-edge bg-panel-2 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase">
                <MapIcon size={13} className="text-sky-400" /> Practised in the campaign
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {missions.map((m) => (
                  <Link key={m.id} href={routes.mission(m.id)} className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[12px] text-sky-100 hover:bg-sky-500/20">
                    <span className="font-mono text-[10.5px] text-sky-300">{m.id}</span> {m.title}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
        {def ? (
          <Playground mnemonic={mnemonic} def={def} className="order-1 xl:order-none" />
        ) : (
          <div className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-slate-400">No playground for {mnemonic} yet.</div>
        )}
      </div>
    </div>
  );
}

function Landing({ unknown, viewed, showList }: { unknown?: string; viewed: ReadonlySet<string>; showList: boolean }) {
  const [, navigate] = useLocation();
  const by = instructionsByCategory();
  const [q, setQ] = useState('');
  const hits = q.trim() ? ALL_MNEMONICS.filter((m) => matchInstruction(INSTRUCTIONS[m]!, q)) : [];
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
      {unknown && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">
          There is no instruction called “{unknown}”. Pick one below.
        </div>
      )}
      <section className="relative overflow-hidden rounded-2xl border border-edge bg-gradient-to-br from-panel-3 via-panel-2 to-panel p-5 sm:p-7">
        <div className="pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-ab-red/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-sky-300 uppercase">
            <BookOpen size={14} /> Instruction Reference
          </div>
          <h1 className="mt-2 text-2xl leading-tight font-bold tracking-tight text-white sm:text-[32px]">Every rung instruction, live on a real controller.</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-400">
            Read how it works, then flip the inputs and watch the timing diagram: every page runs its example on a simulated Logix 5000
            controller — edit the rungs online and see what changes.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Stat icon={<Zap size={14} />} value={ALL_MNEMONICS.length} label="instructions" />
            <Stat icon={<FlaskConical size={14} />} value={ALL_MNEMONICS.length} label="live playgrounds" />
            <Stat icon={<BookA size={14} />} value={GLOSSARY.length} label="glossary terms" />
            <Stat icon={<BookOpen size={14} />} value={`${ALL_MNEMONICS.filter((m) => viewed.has(m)).length}/${ALL_MNEMONICS.length}`} label="studied" />
          </div>
          {showList && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search instructions…"
              aria-label="Search instructions"
              className="mt-4 h-10 w-full rounded-lg border border-edge bg-panel px-3 text-[14px] text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
            />
          )}
          {showList && hits.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hits.slice(0, 24).map((m) => (
                <button key={m} type="button" onClick={() => navigate(routes.reference(m))} className="cursor-pointer">
                  <MnemonicBadge mnemonic={m} className="h-7 px-2 text-[12px]" />
                </button>
              ))}
            </div>
          )}
          {showList && q.trim() !== '' && hits.length === 0 && (
            <p className="mt-2 text-[13px] text-slate-400" role="status">
              Nothing matches “{q.trim()}”. Try a mnemonic (XIC, TON) or a word like “timer” or “compare”.
            </p>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {INSTRUCTION_CATEGORIES.map((c) => {
          const st = CATEGORY_STYLE[c];
          const Icon = st.icon;
          const items = by[c];
          const done = items.filter((i) => viewed.has(i.mnemonic)).length;
          return (
            <section key={c} className="group relative overflow-hidden rounded-xl border border-edge bg-panel-2 p-4 transition-colors hover:border-slate-600">
              <div className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full opacity-15 blur-2xl" style={{ background: st.color }} />
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${st.color}22`, color: st.color }}>
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-bold text-white">{c}</h2>
                  <p className="truncate text-[12px] text-slate-400">{st.blurb}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400">
                  {done}/{items.length}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {items.map((i) => (
                  <Link key={i.mnemonic} href={routes.reference(i.mnemonic)} title={`${i.mnemonic} — ${i.name}`} className="relative">
                    <MnemonicBadge mnemonic={i.mnemonic} className={cn('h-6 px-1.5 text-[11px] transition-transform hover:-translate-y-px hover:brightness-125', viewed.has(i.mnemonic) && 'ring-1 ring-emerald-400/40')} />
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.1em] text-amber-300 uppercase">
              <BookA size={14} /> Glossary
            </div>
            <h2 className="text-lg font-bold text-white">Concepts behind the rungs</h2>
          </div>
          <Link href={glossaryHref()} className="shrink-0 rounded-lg border border-edge bg-panel-2 px-3 py-1.5 text-[12.5px] font-semibold text-slate-200 hover:border-slate-500">
            Open glossary →
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {GLOSSARY.map((g) => (
            <Link key={g.id} href={glossaryHref(g.id)} className="rounded-lg border border-edge bg-panel-2 px-3 py-2.5 transition-colors hover:border-slate-600">
              <div className="text-[13px] font-semibold text-white">{g.term}</div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-slate-400">
                <InlineMd text={g.short} />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-edge bg-panel/70 px-3 py-1.5">
      <span className="text-slate-400">{icon}</span>
      <span className="font-mono text-[15px] font-bold text-white">{value}</span>
      <span className="text-[12px] text-slate-400">{label}</span>
    </div>
  );
}
