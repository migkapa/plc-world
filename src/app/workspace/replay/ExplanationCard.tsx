/**
 * The "why did it fail" card of a test replay: what the test did, what it expected, what it saw, and where to look
 * (tag names highlighted, rung numbers jump to the rung in the ladder).
 */
import { CircleX, Crosshair, Eye, ListChecks, ShieldAlert, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../../ui';
import { fmtSeconds } from '../stepText';
import type { FailureExplanation, HintPart } from './explain';

export function HintLine({ parts, onRung }: { parts: ReadonlyArray<HintPart>; onRung?: ((rung: number) => void) | undefined }) {
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <span key={i}>{p}</span>;
        if ('tag' in p)
          return (
            <code key={i} className="rounded bg-amber-300/15 px-1 font-mono text-[0.95em] text-amber-100">
              {p.tag}
            </code>
          );
        if ('code' in p)
          return (
            <code key={i} className="rounded bg-white/10 px-1 font-mono text-[0.95em] text-slate-100">
              {p.code}
            </code>
          );
        return onRung ? (
          <button
            key={i}
            type="button"
            onClick={() => onRung(p.rung)}
            className="cursor-pointer rounded font-semibold text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
            title={`Show rung ${p.rung} in the ladder`}
            data-testid="explain-rung"
          >
            rung {p.rung}
          </button>
        ) : (
          <span key={i} className="font-semibold">
            rung {p.rung}
          </span>
        );
      })}
    </>
  );
}

function Row({ icon, label, children, tone }: { icon: ReactNode; label: string; children: ReactNode; tone?: 'bad' | 'hint' }) {
  return (
    <div className="flex gap-2">
      <span className={cn('mt-[1px] shrink-0', tone === 'bad' ? 'text-red-300' : tone === 'hint' ? 'text-amber-300' : 'text-slate-400')}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
        <div className="leading-snug">{children}</div>
      </div>
    </div>
  );
}

export interface ExplanationCardProps {
  explanation: FailureExplanation;
  onRung?: ((rung: number) => void) | undefined;
  /** Compact: no "what the test did" list (the banner in the 3D view). */
  compact?: boolean;
  className?: string;
}

export function ExplanationCard({ explanation: e, onRung, compact, className }: ExplanationCardProps) {
  const title = e.kind === 'invariant' ? 'A safety rule was broken' : e.kind === 'fault' ? 'The controller faulted' : e.kind === 'check' ? 'The check failed' : 'The test stopped';
  return (
    <div className={cn('space-y-1.5 text-[12px] text-slate-200', className)} data-testid="replay-explanation" role="group" aria-label="Why the test failed">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-red-200">
        {e.kind === 'invariant' ? <ShieldAlert size={14} /> : e.kind === 'fault' ? <Zap size={14} /> : <CircleX size={14} />}
        {title}
        <span className="font-mono text-[10.5px] font-normal text-red-300/70">at t = {fmtSeconds(e.atMs)}</span>
      </div>
      {!compact && e.did.length > 0 && (
        <Row icon={<ListChecks size={13} />} label="The test did">
          <ol className="space-y-0.5">
            {e.did.map((d, i) => (
              <li key={i} className="flex gap-1.5">
                {d.atMs !== undefined && <span className="shrink-0 font-mono text-[10.5px] text-slate-500">{fmtSeconds(d.atMs)}</span>}
                <span>{d.text}</span>
              </li>
            ))}
          </ol>
        </Row>
      )}
      <Row icon={<Crosshair size={13} />} label="Expected">
        <span className="text-slate-100">{e.expected}</span>
        {e.because && !compact && <span className="block text-[11px] text-slate-400">“{e.because}”</span>}
      </Row>
      <Row icon={<Eye size={13} />} label="Saw" tone="bad">
        <span className="text-red-100">{e.saw}</span>
      </Row>
      {e.hint.length > 0 && (
        <Row icon={<Zap size={13} />} label="Where to look" tone="hint">
          <div className="space-y-1" data-testid="replay-hint">
            {(compact ? e.hint.slice(0, 2) : e.hint).map((h, i) => (
              <p key={i}>
                <HintLine parts={h} onRung={onRung} />
              </p>
            ))}
          </div>
        </Row>
      )}
    </div>
  );
}
