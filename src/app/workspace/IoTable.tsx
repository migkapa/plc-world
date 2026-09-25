/**
 * The plant's wired I/O points with LIVE values: alias, module operand, field device, N.O. / N.C.
 * wiring note and the current tag value (forces flagged). Hovering a row (or focusing its alias) highlights the
 * physical device in the 3D view; clicking the alias flies the camera to it (see highlight/AliasChips.tsx).
 */
import { ArrowDownToLine, ArrowUpFromLine, Zap } from 'lucide-react';
import { memo, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { PlcController } from '../../plc/types';
import type { IoPointDef, SimRuntime } from '../../sim/types';
import { Badge, LedDot, cn } from '../../ui';
import { useRuntimeValue } from './hooks';
import { AliasChip, useHighlightHandlers } from './highlight/AliasChips';

/** A table row that highlights its device in the 3D view while hovered / focused within. */
function IoRow({ alias, children, ...rest }: { alias: string; children: ReactNode } & HTMLAttributes<HTMLTableRowElement>) {
  const h = useHighlightHandlers([alias], 'io');
  return (
    <tr {...rest} {...h}>
      {children}
    </tr>
  );
}

/** N.O. / N.C. wiring of a point from its device / description text. */
export function contactKind(p: Pick<IoPointDef, 'device' | 'description'>): 'NO' | 'NC' | undefined {
  const s = `${p.device} ${p.description}`;
  if (/\bN\.?C\.?(?![a-z])|normally[- ]closed|fail-?safe/i.test(s)) return 'NC';
  if (/\bN\.?O\.?(?![a-z])|normally[- ]open/i.test(s)) return 'NO';
  return undefined;
}

function readPoint(controller: PlcController, p: IoPointDef): { value: boolean | number; forced: boolean } {
  let value: boolean | number = p.signal === 'analog' ? 0 : false;
  try {
    value = p.signal === 'analog' ? controller.tags.readNumber(p.alias) : controller.tags.readBool(p.alias);
  } catch {
    // alias deleted by the player: fall back to the operand
    try {
      value = p.signal === 'analog' ? controller.tags.readNumber(p.operand) : controller.tags.readBool(p.operand);
    } catch {
      // ignore
    }
  }
  let forced = false;
  try {
    forced = controller.getForce ? controller.getForce(p.operand) !== undefined : p.operand in controller.getForces();
  } catch {
    forced = false;
  }
  return { value, forced };
}

function fmtAnalog(v: number, units?: string): string {
  const s = Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
  return units ? `${s} ${units}` : s;
}

/** Live value cell: re-renders only when the (rounded) value or its force state changes. */
function PointValue({ p, controller, runtime }: { p: IoPointDef; controller: PlcController; runtime: SimRuntime }) {
  const key = useRuntimeValue(runtime, () => {
    const { value, forced } = readPoint(controller, p);
    const v = p.signal === 'analog' ? (Math.round(Number(value) * 100) / 100).toString() : value ? '1' : '0';
    return `${forced ? 'F' : '-'}${v}`;
  });
  const forced = key[0] === 'F';
  const raw = key.slice(1);
  const on = raw === '1';
  return (
    <span className="inline-flex items-center gap-1.5">
      {forced && (
        <span title="Forced" className="text-amber-400">
          <Zap size={12} />
        </span>
      )}
      {p.signal === 'analog' ? (
        <span className="font-mono text-[12px] text-sky-300">{fmtAnalog(Number(raw), p.units)}</span>
      ) : (
        <>
          <span className={cn('font-mono text-[12px] font-bold', on ? 'text-emerald-300' : 'text-slate-500')}>{raw}</span>
          <LedDot on={on} color={p.dir === 'output' ? 'amber' : 'green'} />
        </>
      )}
    </span>
  );
}

export interface IoTableProps {
  io: ReadonlyArray<IoPointDef>;
  controller: PlcController;
  runtime: SimRuntime;
  className?: string;
  /**
   * Narrow layout (device text clamped, description in the hover title). Default: automatic when the
   * table is narrower than COMPACT_IO_TABLE_BELOW_PX.
   */
  compact?: boolean;
}

export const COMPACT_IO_TABLE_BELOW_PX = 380;

function IoTableImpl({ io, controller, runtime, className, compact: compactProp }: IoTableProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || compactProp !== undefined || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth > 0 && el.clientWidth < COMPACT_IO_TABLE_BELOW_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, [compactProp]);
  const compact = compactProp ?? narrow;
  const inputs = io.filter((p) => p.dir === 'input');
  const outputs = io.filter((p) => p.dir === 'output');
  const section = (title: string, icon: ReactNode, list: IoPointDef[]) =>
    list.length > 0 && (
      <>
        <tr>
          <th colSpan={compact ? 2 : 3} className="bg-panel-3/70 px-2 py-1 text-left text-[10.5px] font-semibold tracking-wide text-slate-400 uppercase">
            <span className="flex items-center gap-1.5">
              {icon}
              {title} <span className="font-normal text-slate-500 normal-case">({list.length})</span>
            </span>
          </th>
        </tr>
        {list.map((p) => {
          const kind = contactKind(p);
          const badges = (
            <>
              {kind === 'NC' && (
                <Badge tone="amber" title="Normally closed: reads 1 when NOT actuated">
                  N.C.
                </Badge>
              )}
              {kind === 'NO' && (
                <Badge tone="neutral" title="Normally open: reads 1 while actuated">
                  N.O.
                </Badge>
              )}
              {p.signal === 'analog' && (
                <Badge tone="blue" title={p.range ? `Range ${p.range[0]}–${p.range[1]} ${p.units ?? ''}` : 'Analog'}>
                  analog
                </Badge>
              )}
            </>
          );
          const value = (
            <td className="px-2 py-1.5 text-right whitespace-nowrap">
              <PointValue p={p} controller={controller} runtime={runtime} />
            </td>
          );
          if (compact) {
            // narrow docks: one text column (alias · operand · badges, then the device on one line);
            // the full device text and wiring note are in the hover title
            return (
              <IoRow key={p.operand} alias={p.alias} className="border-t border-edge/60 align-top hover:bg-cyan-400/[0.05]" data-io={p.alias} title={`${p.alias} (${p.operand}) — ${p.device}${p.description ? `\n${p.description}` : ''}`}>
                <td className="min-w-0 px-2 py-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <AliasChip alias={p.alias} className="font-mono text-[12px] font-semibold text-slate-100">
                      {p.alias}
                    </AliasChip>
                    <span className="font-mono text-[10.5px] text-slate-500">{p.operand}</span>
                    {badges}
                  </div>
                  <div className="line-clamp-1 text-[11px] leading-snug text-slate-400">{p.device}</div>
                </td>
                {value}
              </IoRow>
            );
          }
          return (
            <IoRow key={p.operand} alias={p.alias} className="border-t border-edge/60 align-top hover:bg-cyan-400/[0.05]" data-io={p.alias}>
              <td className="px-2 py-1.5">
                <div>
                  <AliasChip alias={p.alias} className="font-mono text-[12px] font-semibold text-slate-100">
                    {p.alias}
                  </AliasChip>
                </div>
                <div className="font-mono text-[10.5px] text-slate-500">{p.operand}</div>
              </td>
              <td className="px-2 py-1.5 text-[11.5px] text-slate-300">
                <div className="flex flex-wrap items-center gap-1">
                  {badges}
                  <span>{p.device}</span>
                </div>
                {p.description && <div className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{p.description}</div>}
              </td>
              {value}
            </IoRow>
          );
        })}
      </>
    );
  return (
    <div ref={rootRef} className={cn('overflow-hidden rounded-lg border border-edge', className)} data-compact={compact ? '' : undefined}>
      <table className="w-full border-collapse text-left" data-testid="io-table">
        <tbody>
          {section('Inputs', <ArrowDownToLine size={12} />, inputs)}
          {section('Outputs', <ArrowUpFromLine size={12} />, outputs)}
        </tbody>
      </table>
    </div>
  );
}

export const IoTable = memo(IoTableImpl);
