/**
 * Instruction help card: name, category, operands, status bits, teaching notes, a neutral-text example
 * and a mini ladder rendering of that example (same layout engine & renderer as the editor).
 */
import { ArrowRightFromLine, ArrowRightToLine, BookOpen } from 'lucide-react';
import { useMemo } from 'react';
import { INSTRUCTION_DEFS } from '@/plc/instructions';
import { parseRung } from '@/plc/neutralText';
import type { InstructionInfo } from '@/plc/types';
import { Markdown } from '@/ui/Markdown';
import { cn } from '@/ui/cn';
import { detailsWithoutExample, exampleFor } from './examples';
import { InstrGlyph } from './glyphs';
import { layoutRung } from './layout';
import { RungSvg } from './RungSvg';
import './ladder.css';

export interface InstructionHelpProps {
  /** Instruction metadata, or a mnemonic. */
  info: InstructionInfo | string;
  /** Short version for hover popovers (no details). */
  compact?: boolean;
  /** Ladder theme of the example rendering. */
  theme?: 'dark' | 'classic';
  /** Shown when the instruction is locked (e.g. not yet introduced by the mission). */
  locked?: boolean;
  className?: string;
}

const TYPE_LABEL: Record<string, string> = {
  ANY_NUM: 'SINT/INT/DINT/REAL',
  ANY_INT: 'SINT/INT/DINT',
  IMMEDIATE: 'Immediate',
  ROUTINE: 'Routine',
  EXPRESSION: 'Expression',
  LABEL: 'Label',
};

/** Mini static ladder rendering of a neutral-text rung. */
export function MiniLadder({ text, width = 460, theme = 'dark', className }: { text: string; width?: number; theme?: 'dark' | 'classic'; className?: string }) {
  const rendered = useMemo(() => {
    try {
      const rung = parseRung(text);
      const layout = layoutRung(rung, { width: 10, margin: 12, showDescriptions: false, showComment: false });
      return { rung, layout };
    } catch {
      return undefined;
    }
  }, [text]);
  if (!rendered) return null;
  const zoom = Math.min(1, width / rendered.layout.width);
  return (
    <div className={cn('ld-root inline-block max-w-full overflow-hidden rounded-md border border-[var(--ld-chrome-border)] align-top', `ld-theme-${theme}`, className)}>
      <RungSvg rung={rendered.rung} index={0} layout={rendered.layout} zoom={zoom} bare />
    </div>
  );
}

export function InstructionHelp({ info, compact, theme = 'dark', locked, className }: InstructionHelpProps) {
  const def = typeof info === 'string' ? INSTRUCTION_DEFS[info.toUpperCase()] : info;
  if (!def) {
    return <div className={cn('text-sm text-slate-400', className)}>Unknown instruction “{String(info)}”.</div>;
  }
  const example = exampleFor(def.mnemonic);
  const variadic = INSTRUCTION_DEFS[def.mnemonic]?.variadic;
  return (
    <div className={cn('space-y-3 text-slate-300', className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-edge bg-panel-3 text-emerald-300">
          <InstrGlyph op={def.mnemonic} width={40} height={16} />
          <span className="mt-0.5 font-mono text-[10px] font-bold text-slate-200">{def.mnemonic}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold text-white">{def.mnemonic}</span>
            <span className="text-sm font-semibold text-slate-200">{def.name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full border border-slate-600/60 bg-slate-700/50 px-2 py-0.5 font-semibold text-slate-200">{def.category}</span>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold',
                def.kind === 'input' ? 'border-sky-500/30 bg-sky-500/10 text-sky-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
              )}
            >
              {def.kind === 'input' ? <ArrowRightToLine size={11} /> : <ArrowRightFromLine size={11} />}
              {def.kind === 'input' ? 'Input (condition)' : 'Output'}
            </span>
            {def.statusBits?.map((b) => (
              <span key={b} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono font-semibold text-emerald-300">
                .{b}
              </span>
            ))}
            {locked && <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-semibold text-red-300">Locked</span>}
          </div>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-200">{def.summary}</p>
      {(def.operands.length > 0 || variadic) && (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wide text-slate-500 uppercase">
              <th className="border-b border-edge py-1 pr-2 font-semibold">Operand</th>
              <th className="border-b border-edge py-1 pr-2 font-semibold">Data type</th>
              <th className="border-b border-edge py-1 font-semibold">Use</th>
            </tr>
          </thead>
          <tbody>
            {[...def.operands, ...(variadic ? [{ ...variadic, name: `${variadic.name} …` }] : [])].map((o, i) => (
              <tr key={i} className="align-top">
                <td className="border-b border-edge/60 py-1 pr-2 font-medium text-slate-200">{o.name}</td>
                <td className="border-b border-edge/60 py-1 pr-2 font-mono text-[11px] text-slate-400">
                  {o.types.map((t) => TYPE_LABEL[t] ?? t).join(' | ')}
                </td>
                <td className="border-b border-edge/60 py-1 text-slate-400">{o.dest ? 'Destination (written)' : 'Source'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!compact && def.details && <Markdown source={detailsWithoutExample(def.details, example)} className="text-[13px]" />}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-slate-500 uppercase">
          <BookOpen size={12} /> Example
        </div>
        <code className="mb-2 block overflow-x-auto rounded-md border border-edge bg-black/40 px-2 py-1.5 font-mono text-[11.5px] whitespace-pre text-emerald-300">
          {example}
        </code>
        <MiniLadder text={example} theme={theme} width={compact ? 360 : 520} />
      </div>
    </div>
  );
}
