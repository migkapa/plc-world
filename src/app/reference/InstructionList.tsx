/**
 * Instruction browser sidebar: search + category groups (mnemonic badge + name) + glossary entry.
 */
import { BookA, Binary, Calculator, GitBranch, Hash, Scale, Search, Shuffle, Timer, ToggleLeft, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { INSTRUCTION_CATEGORIES, INSTRUCTIONS, instructionsByCategory } from '../../plc/instructions';
import type { InstructionInfo } from '../../plc/types';
import { ProgressBar, cn } from '../../ui';
import { routes } from '../routes';
import { GLOSSARY } from './glossary';

export type Category = InstructionInfo['category'];

export const CATEGORY_STYLE: Record<Category, { icon: LucideIcon; color: string; badge: string; blurb: string }> = {
  Bit: { icon: ToggleLeft, color: '#22c55e', badge: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', blurb: 'Contacts, coils, latches and one-shots' },
  'Timer/Counter': { icon: Timer, color: '#38bdf8', badge: 'border-sky-500/40 bg-sky-500/10 text-sky-300', blurb: 'On/off-delay, retentive timers, counters' },
  Compare: { icon: Scale, color: '#a78bfa', badge: 'border-violet-500/40 bg-violet-500/10 text-violet-300', blurb: 'Equal, greater, less, limit, masked compare' },
  'Compute/Math': { icon: Calculator, color: '#f97316', badge: 'border-orange-500/40 bg-orange-500/10 text-orange-300', blurb: 'Arithmetic, expressions and scaling' },
  'Move/Logical': { icon: Binary, color: '#14b8a6', badge: 'border-teal-500/40 bg-teal-500/10 text-teal-300', blurb: 'Move, mask, bitwise logic, copy & fill' },
  'Program Control': { icon: GitBranch, color: '#f43f5e', badge: 'border-rose-500/40 bg-rose-500/10 text-rose-300', blurb: 'Subroutines, jumps, zones and placeholders' },
  Special: { icon: Shuffle, color: '#f59e0b', badge: 'border-amber-500/40 bg-amber-500/10 text-amber-300', blurb: 'Shift registers, sequencers, FIFOs' },
};

export const ALL_MNEMONICS: string[] = INSTRUCTION_CATEGORIES.flatMap((c) => instructionsByCategory()[c].map((i) => i.mnemonic));

export function matchInstruction(i: InstructionInfo, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return i.mnemonic.toLowerCase().includes(s) || i.name.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s) || i.category.toLowerCase().includes(s);
}

export function MnemonicBadge({ mnemonic, className }: { mnemonic: string; className?: string }) {
  const cat = INSTRUCTIONS[mnemonic]?.category ?? 'Bit';
  return (
    <span className={cn('inline-flex h-5 min-w-[42px] items-center justify-center rounded border px-1 font-mono text-[10.5px] font-bold', CATEGORY_STYLE[cat].badge, className)}>
      {mnemonic}
    </span>
  );
}

export function InstructionList({ current, viewed, glossaryActive, className }: { current?: string; viewed: ReadonlySet<string>; glossaryActive?: boolean; className?: string }) {
  const [query, setQuery] = useState('');
  const q = query.trim();
  const groups = useMemo(() => {
    const by = instructionsByCategory();
    return INSTRUCTION_CATEGORIES.map((c) => ({ c, items: by[c].filter((i) => matchInstruction(i, q)) }));
  }, [q]);
  const total = ALL_MNEMONICS.length;
  const seen = ALL_MNEMONICS.filter((m) => viewed.has(m)).length;
  const glossHits = q ? GLOSSARY.filter((g) => `${g.term} ${g.short}`.toLowerCase().includes(q.toLowerCase())) : [];
  return (
    <nav className={cn('flex min-h-0 flex-col', className)} aria-label="Instructions">
      <div className="space-y-2.5 border-b border-edge px-3 pt-3 pb-3">
        <div className="flex items-baseline justify-between">
          <Link href={routes.reference()} className="text-[15px] font-bold tracking-tight text-white hover:text-slate-200">
            Instruction Reference
          </Link>
          <span className="font-mono text-[11px] text-slate-400">
            {seen}/{total}
          </span>
        </div>
        <div>
          <ProgressBar value={seen / total} color="bg-gradient-to-r from-sky-500 to-emerald-400" className="h-1.5" />
          <div className="mt-1 text-[10.5px] text-slate-500">Instructions studied</div>
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-edge bg-panel px-2 text-slate-400 focus-within:border-slate-500">
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search XIC, timer, compare…"
            aria-label="Search instructions"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {q && (
            <button type="button" onClick={() => setQuery('')} className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-200">
              clear
            </button>
          )}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Link
          href={routes.reference('glossary')}
          className={cn(
            'mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors',
            glossaryActive ? 'bg-white/[0.07] text-white' : 'text-slate-300 hover:bg-white/[0.04] hover:text-white',
          )}
        >
          <BookA size={15} className="text-amber-300" /> Glossary
          <span className="ml-auto font-mono text-[10.5px] text-slate-500">{GLOSSARY.length} terms</span>
        </Link>
        {glossHits.map((g) => (
          <Link key={g.id} href={routes.reference('glossary')} className="ml-6 block truncate rounded px-2 py-1 text-[12px] text-amber-200/80 hover:text-amber-100">
            {g.term}
          </Link>
        ))}
        {groups.map(({ c, items }) => {
          if (items.length === 0) return null;
          const st = CATEGORY_STYLE[c];
          const Icon = st.icon;
          return (
            <div key={c} className="mb-1.5">
              <div className="flex items-center gap-1.5 px-2 pt-2.5 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-slate-500 uppercase">
                <Icon size={12} style={{ color: st.color }} />
                {c}
                <span className="ml-auto font-mono font-normal tracking-normal text-slate-600">{items.length}</span>
              </div>
              {items.map((i) => {
                const active = i.mnemonic === current;
                return (
                  <Link
                    key={i.mnemonic}
                    href={routes.reference(i.mnemonic)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-2 rounded-lg py-1 pr-2 pl-2 transition-colors',
                      active ? 'bg-white/[0.07] text-white' : 'text-slate-300 hover:bg-white/[0.04] hover:text-white',
                    )}
                  >
                    {active && <span className="absolute top-1 bottom-1 left-0 w-[3px] rounded-full" style={{ background: st.color }} />}
                    <MnemonicBadge mnemonic={i.mnemonic} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{i.name}</span>
                    {viewed.has(i.mnemonic) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/70" title="Studied" />}
                  </Link>
                );
              })}
            </div>
          );
        })}
        {q && groups.every((g) => g.items.length === 0) && glossHits.length === 0 && (
          <div className="px-3 py-6 text-center text-[13px] text-slate-500">
            <Hash size={16} className="mx-auto mb-1 opacity-60" />
            Nothing matches “{q}”.
          </div>
        )}
      </div>
    </nav>
  );
}
