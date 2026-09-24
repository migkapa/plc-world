/**
 * Live timing diagram (SVG small multiples): one row per traced tag/bit over the last N seconds of simulated
 * time. BOOL rows are step waveforms (energised = green, like Studio 5000 power flow), numeric rows a
 * step line in their own band. Redrawn from the TraceRecorder with requestAnimationFrame (no React state
 * per frame). Hovering shows a crosshair with every row's value at that instant.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../ui';
import type { PlaygroundTrace } from './playgrounds';
import type { TraceRecorder } from './recorder';

const LABEL_W_WIDE = 150;
const LABEL_W_NARROW = 108;
const ROW_BOOL = 30;
const ROW_NUM = 52;
const PAD_T = 6;
const AXIS_H = 22;

const GREEN = '#22c55e';
const SKY = '#38bdf8';

export function formatValue(v: number, trace: Pick<PlaygroundTrace, 'kind' | 'format'>): string {
  if (!Number.isFinite(v)) return '—';
  if (trace.kind === 'bool') return v ? '1' : '0';
  if (trace.format === 'bin') return (v & 0xff).toString(2).padStart(8, '0').replace(/(\d{4})(\d{4})/, '$1 $2');
  if (trace.format === 'real') return v.toFixed(1);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

interface RowGeom {
  y: number;
  h: number;
}

export function TimingDiagram({ recorder, traces, windowMs, className }: { recorder: TraceRecorder; traces: PlaygroundTrace[]; windowMs: number; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  hoverRef.current = hoverX;

  const rows = useMemo(() => {
    let y = PAD_T;
    return traces.map((t): RowGeom => {
      const h = t.kind === 'bool' ? ROW_BOOL : ROW_NUM;
      const g = { y, h };
      y += h;
      return g;
    });
  }, [traces]);
  const plotH = (rows.length ? rows[rows.length - 1]!.y + rows[rows.length - 1]!.h : PAD_T) + 4;
  const height = plotH + AXIS_H;
  const narrow = width < 520;
  const labelW = narrow ? LABEL_W_NARROW : LABEL_W_WIDE;
  const x0 = labelW;
  const plotW = Math.max(40, width - labelW - 10);

  // element refs updated by the animation loop
  const strokes = useRef<Array<SVGPathElement | null>>([]);
  const fills = useRef<Array<SVGPathElement | null>>([]);
  const values = useRef<Array<SVGTextElement | null>>([]);
  const ranges = useRef<Array<SVGTextElement | null>>([]);
  const cursorVals = useRef<Array<SVGTextElement | null>>([]);
  const cursorLabel = useRef<SVGTextElement | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]!.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let lastVersion = -1;
    let lastHover: number | null = null;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const hv = hoverRef.current;
      if (recorder.version === lastVersion && hv === lastHover) return;
      lastVersion = recorder.version;
      lastHover = hv;
      const tEnd = recorder.timeMs;
      const tStart = tEnd - windowMs;
      const sx = (t: number) => x0 + ((t - tStart) / windowMs) * plotW;
      const hoverT = hv === null ? null : tStart + ((hv - x0) / plotW) * windowMs;
      traces.forEach((tr, k) => {
        const row = rows[k]!;
        const col = recorder.values[k]!;
        // value range for numeric rows
        let lo = tr.min;
        let hi = tr.max;
        if (tr.kind === 'number' && (lo === undefined || hi === undefined)) {
          let mn = Infinity;
          let mx = -Infinity;
          recorder.forEach((i) => {
            if (recorder.times[i]! < tStart) return;
            const v = col[i]!;
            if (Number.isFinite(v)) {
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
          });
          if (!Number.isFinite(mn)) {
            mn = 0;
            mx = 1;
          }
          if (mn === mx) {
            mn -= 1;
            mx += 1;
          }
          lo = lo ?? mn;
          hi = hi ?? mx;
        }
        const top = row.y + 5;
        const bot = row.y + row.h - 6;
        const sy = (v: number) => {
          if (tr.kind === 'bool') return v ? top + 2 : bot;
          const f = (v - lo!) / (hi! - lo! || 1);
          return bot - Math.max(-0.05, Math.min(1.05, f)) * (bot - top);
        };
        let d = '';
        let fill = '';
        let prevV = Number.NaN;
        let hoverV = Number.NaN;
        recorder.forEach((i) => {
          const t = recorder.times[i]!;
          const v = col[i]!;
          if (hoverT !== null && t <= hoverT) hoverV = v;
          if (t < tStart) {
            prevV = v;
            return;
          }
          const x = sx(t);
          if (!Number.isFinite(v)) {
            prevV = v;
            return;
          }
          const y = sy(v);
          if (d === '') {
            const xs = Number.isFinite(prevV) ? x0 : x;
            const ys = Number.isFinite(prevV) ? sy(prevV) : y;
            d = `M${xs.toFixed(1)} ${ys.toFixed(1)}`;
            if (xs !== x || ys !== y) d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
            fill = `M${xs.toFixed(1)} ${bot}V${ys.toFixed(1)}`;
            if (xs !== x || ys !== y) fill += `H${x.toFixed(1)}V${y.toFixed(1)}`;
          } else if (v !== prevV) {
            d += `H${x.toFixed(1)}V${y.toFixed(1)}`;
            fill += `H${x.toFixed(1)}V${y.toFixed(1)}`;
          }
          prevV = v;
        });
        if (d !== '') {
          d += `H${(x0 + plotW).toFixed(1)}`;
          fill += `H${(x0 + plotW).toFixed(1)}V${bot}Z`;
        }
        strokes.current[k]?.setAttribute('d', d);
        fills.current[k]?.setAttribute('d', fill);
        const latest = recorder.latest(k);
        const vEl = values.current[k];
        if (vEl) {
          vEl.textContent = formatValue(latest, tr);
          vEl.setAttribute('fill', tr.kind === 'bool' ? (latest ? '#86efac' : '#64748b') : '#e2e8f0');
        }
        const rEl = ranges.current[k];
        if (rEl && tr.kind === 'number') rEl.textContent = `${formatValue(lo!, { kind: 'number', format: tr.format === 'bin' ? undefined : tr.format })}…${formatValue(hi!, { kind: 'number', format: tr.format === 'bin' ? undefined : tr.format })}`;
        const cEl = cursorVals.current[k];
        if (cEl) {
          if (hv === null) cEl.textContent = '';
          else {
            cEl.textContent = formatValue(hoverV, tr);
            cEl.setAttribute('x', String(Math.min(hv + 6, x0 + plotW - 4)));
            cEl.setAttribute('text-anchor', hv + 6 > x0 + plotW - 60 ? 'end' : 'start');
          }
        }
      });
      if (cursorLabel.current) {
        cursorLabel.current.textContent = hoverT === null ? '' : `${((hoverT - tEnd) / 1000).toFixed(2)} s`;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [recorder, traces, rows, windowMs, plotW, x0]);

  const ticks = useMemo(() => {
    const step = windowMs >= 8000 ? 2000 : windowMs >= 4000 ? 1000 : windowMs >= 1500 ? 500 : 100;
    const out: number[] = [];
    for (let t = 0; t <= windowMs + 1e-6; t += step) out.push(t);
    return out;
  }, [windowMs]);

  return (
    <div ref={wrap} className={cn('relative w-full select-none', className)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Timing diagram of ${traces.map((t) => t.label ?? t.tag).join(', ')} over the last ${windowMs / 1000} seconds`}
        className="block"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = e.clientX - r.left;
          setHoverX(x >= x0 && x <= x0 + plotW ? x : null);
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        {/* row bands */}
        {rows.map((r, k) => (
          <g key={k}>
            <rect x={0} y={r.y} width={width} height={r.h} fill={k % 2 ? 'rgba(255,255,255,0.018)' : 'transparent'} />
            <line x1={x0} x2={x0 + plotW} y1={r.y + r.h - 6} y2={r.y + r.h - 6} stroke="#2a3441" strokeWidth={1} />
          </g>
        ))}
        {/* time grid */}
        {ticks.map((t) => {
          const x = x0 + (t / windowMs) * plotW;
          return (
            <g key={t}>
              <line x1={x} x2={x} y1={PAD_T} y2={plotH} stroke="#1f2a36" strokeWidth={1} strokeDasharray={t === windowMs ? undefined : '2 3'} />
              <text x={x} y={plotH + 14} textAnchor={t === 0 ? 'start' : t === windowMs ? 'end' : 'middle'} fontSize={10} fill="#64748b" fontFamily="JetBrains Mono, monospace">
                {t === windowMs ? 'now' : `−${((windowMs - t) / 1000).toFixed(windowMs < 2000 ? 1 : 0)} s`}
              </text>
            </g>
          );
        })}
        {/* traces */}
        {traces.map((tr, k) => {
          const r = rows[k]!;
          const color = tr.kind === 'bool' ? GREEN : SKY;
          return (
            <g key={tr.tag + k}>
              <text x={narrow ? 4 : 10} y={r.y + (tr.kind === 'bool' ? 19 : 22)} fontSize={narrow ? 10 : 11} fill="#cbd5e1" fontFamily="JetBrains Mono, monospace">
                {truncate(tr.label ?? tr.tag, tr.kind === 'number' ? (narrow ? 15 : 21) : narrow ? 11 : 16)}
              </text>
              <text
                ref={(el) => {
                  values.current[k] = el;
                }}
                x={x0 - 8}
                y={r.y + (tr.kind === 'bool' ? 19 : 38)}
                textAnchor="end"
                fontSize={tr.kind === 'bool' ? 11 : 11.5}
                fontWeight={600}
                fill="#e2e8f0"
                fontFamily="JetBrains Mono, monospace"
              />
              {tr.kind === 'number' && (
                <text
                  ref={(el) => {
                    ranges.current[k] = el;
                  }}
                  x={narrow ? 4 : 10}
                  y={r.y + 38}
                  fontSize={9.5}
                  fill="#64748b"
                  fontFamily="JetBrains Mono, monospace"
                />
              )}
              <path
                ref={(el) => {
                  fills.current[k] = el;
                }}
                fill={color}
                fillOpacity={tr.kind === 'bool' ? 0.16 : 0.08}
                stroke="none"
              />
              <path
                ref={(el) => {
                  strokes.current[k] = el;
                }}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <text
                ref={(el) => {
                  cursorVals.current[k] = el;
                }}
                y={r.y + 14}
                fontSize={10.5}
                fontWeight={700}
                fill="#f8fafc"
                fontFamily="JetBrains Mono, monospace"
                style={{ paintOrder: 'stroke', stroke: '#0b0f14', strokeWidth: 3 }}
              />
            </g>
          );
        })}
        {/* crosshair */}
        {hoverX !== null && (
          <g pointerEvents="none">
            <line x1={hoverX} x2={hoverX} y1={PAD_T} y2={plotH} stroke="#e2e8f0" strokeOpacity={0.55} strokeWidth={1} />
            <text ref={cursorLabel} x={hoverX} y={plotH + 14} textAnchor="middle" fontSize={10} fontWeight={700} fill="#f8fafc" fontFamily="JetBrains Mono, monospace" style={{ paintOrder: 'stroke', stroke: '#0f1419', strokeWidth: 4 }} />
          </g>
        )}
        <line x1={x0} x2={x0} y1={PAD_T} y2={plotH} stroke="#334155" strokeWidth={1} />
      </svg>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
