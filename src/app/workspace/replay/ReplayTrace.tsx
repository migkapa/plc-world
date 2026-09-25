/**
 * Expected-vs-actual trace of a replayed test: a compact timing diagram (same visual language as the Reference
 * page's TimingDiagram — BOOL rows green when energised, numbers as a sky step line) of every signal the test
 * operates or checks, over the whole test. Expected-value bands show what each check wanted and when; the failure
 * moment is marked; the recorded values are revealed up to the replay's playhead (clipped, redrawn with
 * requestAnimationFrame — no React state per frame). Click the plot to jump the replay to that moment.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../ui';
import { fmtSeconds } from '../stepText';
import type { ReplaySession, TraceBand, TraceRow } from './session';

const ROW_BOOL = 26;
const ROW_NUM = 40;
const PAD_T = 4;
const AXIS_H = 18;
const GREEN = '#22c55e';
const LOW = '#64748b';
const SKY = '#38bdf8';
const RED = '#f87171';
const EXPECT = '#a78bfa';
const TICKS = [100, 200, 250, 500, 1000, 2000, 5000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000];

let clipSeq = 0;

function valueText(v: number, row: Pick<TraceRow, 'kind'>): string {
  if (!Number.isFinite(v)) return '—';
  if (row.kind === 'bool') return v ? '1' : '0';
  return Number.isInteger(v) ? String(v) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function condShort(b: TraceBand, row: TraceRow): string {
  const c = b.cond;
  if (c.equals !== undefined) return row.kind === 'bool' || typeof c.equals === 'boolean' ? (c.equals ? '=1' : '=0') : `=${c.equals}`;
  if (c.min !== undefined && c.max !== undefined) return `${c.min}…${c.max}`;
  if (c.min !== undefined) return `≥${c.min}`;
  if (c.max !== undefined) return `≤${c.max}`;
  return '';
}

/** Index of the last sample at or before `t` (binary search). */
function sampleAt(times: Float64Array, count: number, t: number): number {
  let lo = 0;
  let hi = count - 1;
  if (count === 0 || t < times[0]!) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface ReplayTraceProps {
  session: ReplaySession;
  /** Jump the replay to a time (click on the plot). */
  onSeekTime?(ms: number): void;
  className?: string;
}

function ReplayTraceImpl({ session, onSeekTime, className }: ReplayTraceProps) {
  const trace = session.trace;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [clipId] = useState(() => `rtclip-${++clipSeq}`);
  const clipRect = useRef<SVGRectElement>(null);
  const playhead = useRef<SVGGElement>(null);
  const valueEls = useRef<Array<SVGTextElement | null>>([]);
  const hoverRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const w0 = Math.round(el.clientWidth);
    setWidth(w0 > 0 ? w0 : 320);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]!.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width < 360;
  const labelW = narrow ? 86 : 118;
  const x0 = labelW;
  const plotW = Math.max(40, width - labelW - 34);
  const endMs = Math.max(100, trace.endMs);
  const sx = (t: number): number => x0 + (Math.max(0, Math.min(endMs, t)) / endMs) * plotW;

  const rows = useMemo(() => {
    let y = PAD_T;
    return trace.rows.map((r) => {
      const h = r.kind === 'bool' ? ROW_BOOL : ROW_NUM;
      const g = { y, h };
      y += h;
      return g;
    });
  }, [trace]);
  const plotH = (rows.length ? rows[rows.length - 1]!.y + rows[rows.length - 1]!.h : PAD_T) + 2;
  const height = plotH + AXIS_H;

  // value range per numeric row (data + expected bounds)
  const ranges = useMemo(
    () =>
      trace.rows.map((r, k) => {
        if (r.kind === 'bool') return [0, 1] as const;
        let lo = Infinity;
        let hi = -Infinity;
        const col = trace.values[k]!;
        for (let i = 0; i < trace.count; i++) {
          const v = col[i]!;
          if (Number.isFinite(v)) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
        for (const b of r.bands) {
          for (const v of [b.cond.min, b.cond.max, typeof b.cond.equals === 'number' ? b.cond.equals : undefined]) {
            if (v !== undefined) {
              lo = Math.min(lo, v);
              hi = Math.max(hi, v);
            }
          }
        }
        if (!Number.isFinite(lo)) return [0, 1] as const;
        if (lo === hi) return [lo - 1, hi + 1] as const;
        const pad = (hi - lo) * 0.08;
        return [lo - pad, hi + pad] as const;
      }),
    [trace],
  );

  const yOf = (k: number, v: number): number => {
    const row = rows[k]!;
    const top = row.y + 5;
    const bot = row.y + row.h - 5;
    if (trace.rows[k]!.kind === 'bool') return v ? top + 1 : bot;
    const [lo, hi] = ranges[k]!;
    return bot - ((v - lo) / (hi - lo || 1)) * (bot - top);
  };

  // full waveforms (clipped at the playhead)
  const paths = useMemo(() => {
    if (width === 0) return [];
    return trace.rows.map((r, k) => {
      const col = trace.values[k]!;
      let d = '';
      let high = '';
      let fill = '';
      let last = Number.NaN;
      let lastX = x0;
      const bot = rows[k]!.y + rows[k]!.h - 5;
      const yTop = yOf(k, 1);
      for (let i = 0; i < trace.count; i++) {
        const v = col[i]!;
        if (!Number.isFinite(v)) continue;
        const x = sx(trace.times[i]!);
        if (d === '') {
          d = `M${x.toFixed(1)} ${yOf(k, v).toFixed(1)}`;
          fill = `M${x.toFixed(1)} ${bot}V${yOf(k, v).toFixed(1)}`;
          last = v;
          lastX = x;
          continue;
        }
        if (v !== last) {
          if (r.kind === 'bool' && last) high += `M${lastX.toFixed(1)} ${yTop.toFixed(1)}H${x.toFixed(1)}`;
          d += `H${x.toFixed(1)}V${yOf(k, v).toFixed(1)}`;
          fill += `H${x.toFixed(1)}V${yOf(k, v).toFixed(1)}`;
          last = v;
          lastX = x;
        }
      }
      const xEnd = sx(trace.endMs);
      if (d !== '') {
        d += `H${xEnd.toFixed(1)}`;
        fill += `H${xEnd.toFixed(1)}V${bot}Z`;
        if (r.kind === 'bool' && last) high += `M${lastX.toFixed(1)} ${yTop.toFixed(1)}H${xEnd.toFixed(1)}`;
      }
      return { d, high, fill };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, width, rows, ranges]);

  // playhead: clip width + line + the value column, following the replay (rAF, only when something changed)
  useEffect(() => {
    let raf = 0;
    let lastT = -1;
    let lastHover: number | null = -1;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const t = session.timeMs;
      const hv = hoverRef.current;
      if (t === lastT && hv === lastHover) return;
      lastT = t;
      lastHover = hv;
      const x = sx(t);
      clipRect.current?.setAttribute('width', String(Math.max(0, x - x0 + 0.5)));
      playhead.current?.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
      // values at the cursor (never ahead of the playhead) or at the playhead
      const i = sampleAt(trace.times, trace.count, hv === null ? t : Math.min(hv, t));
      trace.rows.forEach((r, k) => {
        const el = valueEls.current[k];
        if (!el) return;
        const v = i >= 0 ? trace.values[k]![i]! : Number.NaN;
        el.textContent = valueText(v, r);
        el.setAttribute('fill', r.kind === 'bool' ? (v ? '#86efac' : '#94a3b8') : '#e2e8f0');
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, trace, width, endMs]);

  const tick = TICKS.find((st) => (st / endMs) * plotW >= 52) ?? endMs;
  const ticks: number[] = [];
  for (let t = 0; t <= endMs + 1e-6; t += tick) ticks.push(t);

  const hoverT = hoverX === null ? null : ((hoverX - x0) / plotW) * endMs;
  hoverRef.current = hoverT;
  const failX = trace.failAtMs !== undefined ? sx(trace.failAtMs) : undefined;
  const actionTimes = session.test.steps
    .map((s, i) => ((s.do === 'control' || s.do === 'tap' || s.do === 'mode') && Number.isFinite(trace.stepStarts[i]) ? trace.stepStarts[i]! : Number.NaN))
    .filter((t) => Number.isFinite(t));

  const summary = `Timing trace of ${trace.rows.map((r) => r.label).join(', ')} over ${fmtSeconds(trace.endMs)} of the test${trace.failAtMs !== undefined ? `; it failed at ${fmtSeconds(trace.failAtMs)}` : ''}.`;

  return (
    <div ref={wrap} className={cn('relative w-full min-w-0 overflow-hidden select-none', className)} data-testid="replay-trace">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={summary}
          className={cn('block', onSeekTime && 'cursor-crosshair')}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = e.clientX - r.left;
            setHoverX(x >= x0 && x <= x0 + plotW ? x : null);
          }}
          onPointerLeave={() => setHoverX(null)}
          onClick={(e) => {
            if (!onSeekTime) return;
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = e.clientX - r.left;
            if (x < x0 || x > x0 + plotW) return;
            onSeekTime(((x - x0) / plotW) * endMs);
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect ref={clipRect} x={x0} y={0} width={0} height={plotH} />
            </clipPath>
          </defs>
          {/* row bands + labels */}
          {trace.rows.map((r, k) => {
            const g = rows[k]!;
            return (
              <g key={`bg${k}`}>
                <rect x={0} y={g.y} width={width} height={g.h} fill={r.failing ? 'rgba(248,113,113,0.07)' : k % 2 ? 'rgba(255,255,255,0.02)' : 'transparent'} />
                <line x1={x0} x2={x0 + plotW} y1={g.y + g.h - 5} y2={g.y + g.h - 5} stroke="#243040" strokeWidth={1} />
                <text x={4} y={g.y + (r.kind === 'bool' ? 17 : 19)} fontSize={narrow ? 9.5 : 10.5} fill={r.failing ? '#fecaca' : r.role === 'input' ? '#cbd5e1' : '#e2e8f0'} fontFamily="JetBrains Mono, monospace">
                  {truncate(r.label, narrow ? 12 : 17)}
                </text>
                <text x={4} y={g.y + (r.kind === 'bool' ? 17 : 19) + 10} fontSize={8.5} fill="#64748b" fontFamily="Inter, system-ui, sans-serif">
                  {r.kind === 'number' ? `${valueText(ranges[k]![0], r)}…${valueText(ranges[k]![1], r)}${r.units ? ` ${r.units}` : ''}` : ''}
                </text>
              </g>
            );
          })}
          {/* time grid */}
          {ticks.map((t) => (
            <g key={`t${t}`}>
              <line x1={sx(t)} x2={sx(t)} y1={PAD_T} y2={plotH} stroke="#1c2633" strokeWidth={1} strokeDasharray="2 3" />
              <text x={sx(t)} y={plotH + 12} textAnchor={t === 0 ? 'start' : 'middle'} fontSize={9.5} fill="#8b99ad" fontFamily="JetBrains Mono, monospace">
                {fmtSeconds(t)}
              </text>
            </g>
          ))}
          {/* the test's actions (operate / mode change) */}
          {actionTimes.map((t, i) => (
            <line key={`a${i}`} x1={sx(t)} x2={sx(t)} y1={PAD_T} y2={plotH} stroke="#94a3b8" strokeOpacity={0.35} strokeWidth={1} />
          ))}
          {/* expected-value bands */}
          {trace.rows.map((r, k) =>
            r.bands.map((b, j) => {
              const g = rows[k]!;
              const xa = sx(b.from);
              const xb = Math.max(xa + 2, sx(b.to));
              const color = b.failed ? RED : EXPECT;
              const c = b.cond;
              let guide: ReactNode = null;
              if (c.equals !== undefined) {
                const y = yOf(k, typeof c.equals === 'boolean' ? (c.equals ? 1 : 0) : c.equals);
                guide = <line x1={xa} x2={xb} y1={y} y2={y} stroke={color} strokeWidth={1.5} strokeDasharray="3 2" />;
              } else {
                const yLo = yOf(k, c.min ?? ranges[k]![0]);
                const yHi = yOf(k, c.max ?? ranges[k]![1]);
                guide = <rect x={xa} y={Math.min(yLo, yHi)} width={xb - xa} height={Math.max(1, Math.abs(yLo - yHi))} fill={color} fillOpacity={0.18} stroke={color} strokeOpacity={0.6} strokeDasharray="3 2" />;
              }
              return (
                <g key={`b${k}-${j}`} data-band={b.failed ? 'failed' : 'ok'}>
                  <rect x={xa} y={g.y + 1} width={xb - xa} height={g.h - 4} fill={color} fillOpacity={b.failed ? 0.14 : 0.07} />
                  {guide}
                  {b.deadline !== undefined && b.deadline <= trace.endMs + 1 && <line x1={sx(b.deadline)} x2={sx(b.deadline)} y1={g.y + 2} y2={g.y + g.h - 4} stroke={color} strokeWidth={1.5} />}
                  {xb - xa > 26 && (
                    <text x={xa + 2} y={g.y + 9} fontSize={8.5} fill={color} fontFamily="JetBrains Mono, monospace">
                      {condShort(b, r)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          {/* recorded values, revealed up to the playhead */}
          <g clipPath={`url(#${clipId})`}>
            {trace.rows.map((r, k) => {
              const p = paths[k];
              if (!p) return null;
              const bool = r.kind === 'bool';
              return (
                <g key={`w${k}`}>
                  <path d={p.fill} fill={bool ? GREEN : SKY} fillOpacity={bool ? 0.14 : 0.08} />
                  <path d={p.d} fill="none" stroke={bool ? LOW : SKY} strokeWidth={bool ? 1.5 : 1.75} strokeLinejoin="round" />
                  {bool && <path d={p.high} fill="none" stroke={GREEN} strokeWidth={2} strokeLinecap="round" />}
                </g>
              );
            })}
          </g>
          {/* failure moment */}
          {failX !== undefined && (
            <g data-testid="trace-fail-marker">
              <line x1={failX} x2={failX} y1={PAD_T} y2={plotH} stroke={RED} strokeWidth={1.5} strokeDasharray="4 2" />
              {trace.rows.map((r, k) => {
                if (!r.failing) return null;
                const i = sampleAt(trace.times, trace.count, trace.failAtMs!);
                const v = i >= 0 ? trace.values[k]![i]! : Number.NaN;
                return Number.isFinite(v) ? <circle key={`f${k}`} cx={failX} cy={yOf(k, v)} r={3.5} fill={RED} stroke="#0b0f14" strokeWidth={1.5} /> : null;
              })}
            </g>
          )}
          {/* playhead */}
          <g ref={playhead} pointerEvents="none">
            <line x1={0} x2={0} y1={PAD_T} y2={plotH} stroke="#e2e8f0" strokeOpacity={0.8} strokeWidth={1} />
          </g>
          {/* values at the cursor (or the playhead) */}
          {trace.rows.map((r, k) => (
            <text
              key={`v${k}`}
              ref={(el) => {
                valueEls.current[k] = el;
              }}
              x={width - 4}
              y={rows[k]!.y + (r.kind === 'bool' ? 17 : 19)}
              textAnchor="end"
              fontSize={10}
              fontWeight={600}
              fill="#e2e8f0"
              fontFamily="JetBrains Mono, monospace"
            />
          ))}
          {hoverX !== null && hoverT !== null && (
            <g pointerEvents="none">
              <line x1={hoverX} x2={hoverX} y1={PAD_T} y2={plotH} stroke="#e2e8f0" strokeOpacity={0.45} strokeWidth={1} />
              <text x={hoverX} y={plotH + 12} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#f8fafc" fontFamily="JetBrains Mono, monospace" style={{ paintOrder: 'stroke', stroke: '#0f1419', strokeWidth: 4 }}>
                {fmtSeconds(Math.max(0, hoverT))}
              </text>
            </g>
          )}
          <line x1={x0} x2={x0} y1={PAD_T} y2={plotH} stroke="#334155" strokeWidth={1} />
        </svg>
      )}
    </div>
  );
}

/** Memoized: the parent re-renders on a clock; the trace redraws its playhead itself. */
export const ReplayTrace = memo(ReplayTraceImpl);

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
