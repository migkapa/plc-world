/**
 * SVG rendering of one rung (Studio 5000 look) + its live binding.
 *
 * Rendering is pure (props → SVG) and memoized per rung. Online animation never re-renders: the
 * editor calls `binding.apply(frame)` (~25 Hz) and the binding flips `data-on` attributes on wire
 * paths / instructions / status bits and writes value texts directly into the DOM nodes it cached.
 */
import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { ElementLiveState, Rung, VerifyError } from '@/plc/types';
import { cn } from '@/ui/cn';
import {
  LD,
  evalPower,
  powerKey,
  type BranchLayout,
  type GapLayout,
  type InstrLayout,
  type PowerRef,
  type RungLayout,
  type TextSpan,
  type WireSeg,
} from './layout';
import { sameLegPath, type LadderSelection } from './ops';
import type { LiveReader } from './tagTools';

// ---------------------------------------------------------------------------
// Live binding
// ---------------------------------------------------------------------------

export interface LiveFrame {
  online: boolean;
  running: boolean;
  elements: Record<string, ElementLiveState> | undefined;
  reader: LiveReader | undefined;
}

export interface RungBinding {
  apply(frame: LiveFrame): void;
}

interface WireGroup {
  key: string;
  power: PowerRef;
  d: string;
}

function groupWires(wires: readonly WireSeg[]): WireGroup[] {
  const map = new Map<string, WireGroup>();
  for (const w of wires) {
    const key = powerKey(w.power);
    let g = map.get(key);
    if (!g) {
      g = { key, power: w.power, d: '' };
      map.set(key, g);
    }
    g.d += w.y1 === w.y2 ? `M${w.x1} ${w.y1}H${w.x2}` : `M${w.x1} ${w.y1}V${w.y2}`;
  }
  return [...map.values()];
}

function setOn(el: Element, on: boolean): void {
  if (on) el.setAttribute('data-on', '');
  else el.removeAttribute('data-on');
}

function createBinding(svg: SVGSVGElement, groups: WireGroup[]): RungBinding {
  const wires = groups.map((g, i) => ({ el: svg.querySelector(`[data-pk="${i}"]`), power: g.power, last: undefined as boolean | undefined }));
  const instrs = [...svg.querySelectorAll<SVGGElement>('g.ld-i')].map((el) => ({ el, id: el.getAttribute('data-el') ?? '', last: undefined as boolean | undefined }));
  const values = [...svg.querySelectorAll<SVGTextElement>('[data-val]')].map((el) => ({ el, op: el.getAttribute('data-val') ?? '', last: '' }));
  const chips = [...svg.querySelectorAll<SVGGElement>('[data-chip]')].map((el) => ({
    el,
    text: el.querySelector('text'),
    op: el.getAttribute('data-chip') ?? '',
    last: '',
  }));
  const status = [...svg.querySelectorAll<SVGGElement>('[data-st]')].map((el) => ({ el, op: el.getAttribute('data-st') ?? '', last: undefined as boolean | undefined }));
  const inline = [...svg.querySelectorAll<SVGTextElement>('[data-iv]')].map((el) => ({
    el,
    op: el.getAttribute('data-iv') ?? '',
    literal: el.getAttribute('data-lit') ?? '',
    last: undefined as string | undefined,
  }));
  return {
    apply(f) {
      const els = f.online ? f.elements : undefined;
      for (const w of wires) {
        const v = f.online && evalPower(w.power, els, f.running);
        if (v !== w.last && w.el) {
          setOn(w.el, v);
          w.last = v;
        }
      }
      for (const n of instrs) {
        const v = els?.[n.id]?.active === true;
        if (v !== n.last) {
          setOn(n.el, v);
          n.last = v;
        }
      }
      const r = f.online ? f.reader : undefined;
      for (const v of values) {
        const s = r ? r.format(v.op) : '';
        if (s !== v.last) {
          v.el.textContent = s;
          v.last = s;
        }
      }
      for (const c of chips) {
        const val = r?.read(c.op);
        const s = val === undefined ? '' : typeof val === 'boolean' ? (val ? '1' : '0') : String(val);
        if (s !== c.last) {
          if (s === '') c.el.removeAttribute('data-v');
          else c.el.setAttribute('data-v', s);
          setOn(c.el, s === '1');
          if (c.text) c.text.textContent = s;
          c.last = s;
        }
      }
      for (const s of status) {
        const v = r !== undefined && s.op !== '' && r.read(s.op) === true;
        if (v !== s.last) {
          setOn(s.el, v);
          s.last = v;
        }
      }
      for (const iv of inline) {
        const live = r ? r.format(iv.op) : '';
        const s = live !== '' ? live : iv.literal;
        if (s !== iv.last) {
          iv.el.textContent = s;
          if (live !== '') iv.el.setAttribute('data-live', '');
          else iv.el.removeAttribute('data-live');
          iv.last = s;
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RungSvgProps {
  rung: Rung;
  /** Rung number shown in the margin. */
  index: number;
  layout: RungLayout;
  zoom: number;
  /** Selection when it concerns this rung. */
  selection?: LadderSelection;
  /** Verification results of this rung. */
  errors?: readonly VerifyError[];
  /** Forced value lookup (only when forces are installed). */
  forceOf?: (operand: string) => boolean | number | undefined;
  /** Bumped when forces change (memo key). */
  forcesVersion?: number;
  /** Drag & drop insertion marker. */
  dropGap?: GapLayout;
  /** Values are drawn online (value texts start empty and are filled by the binding). */
  showValues?: boolean;
  /** Register the live binding (online animation). */
  register?: (rungId: string, binding: RungBinding | null) => void;
  /** Hide the margin (mini renderings). */
  bare?: boolean;
  /**
   * The margin (rung number, verify marker) is rendered separately by the host with `<RungMargin>`
   * (the ladder editor pins it with position: sticky so it stays visible when scrolling sideways).
   */
  separateMargin?: boolean;
  className?: string;
}

function span(t: TextSpan, key: string | number): ReactNode {
  return (
    <text key={key} className={`ld-t-${t.cls}`} x={t.x} y={t.y} textAnchor={t.anchor}>
      {t.text}
    </text>
  );
}

function squiggle(x: number, y: number, w: number): string {
  let d = `M${x} ${y}`;
  for (let i = 0; i < w; i += 4) d += `l2 ${i % 8 === 0 ? 2 : -2}l2 ${i % 8 === 0 ? -2 : 2}`;
  return d;
}

function Glyph({ n }: { n: InstrLayout }) {
  const { y } = n;
  const cx = n.sym.x + n.sym.w / 2;
  const hw = n.sym.w / 2;
  if (n.display === 'contact') {
    return (
      <>
        <rect className="ld-hl" x={cx - hw + 1.5} y={y - 8} width={2 * hw - 3} height={16} rx={2} />
        <path
          className="ld-g"
          d={`M${cx - hw - 3} ${y - 9}H${cx - hw}V${y + 9}H${cx - hw - 3}M${cx + hw + 3} ${y - 9}H${cx + hw}V${y + 9}H${cx + hw + 3}`}
        />
        {n.glyph === 'xio' && <path className="ld-g" d={`M${cx - hw + 3.5} ${y + 7}L${cx + hw - 3.5} ${y - 7}`} />}
      </>
    );
  }
  if (n.display === 'coil') {
    return (
      <>
        <rect className="ld-hl" x={cx - hw + 2} y={y - 8} width={2 * hw - 4} height={16} rx={7} />
        <path
          className="ld-g"
          d={`M${cx - hw + 4} ${y - 8}A10 10 0 0 0 ${cx - hw + 4} ${y + 8}M${cx + hw - 4} ${y - 8}A10 10 0 0 1 ${cx + hw - 4} ${y + 8}`}
        />
      </>
    );
  }
  const b = n.sym;
  const header = n.header ?? 28;
  return (
    <>
      <rect className="ld-box" x={b.x} y={b.y} width={b.w} height={b.h} rx={2} />
      <rect className="ld-box-h" x={b.x + 0.75} y={b.y + 0.75} width={b.w - 1.5} height={header - 0.75} rx={1.5} />
      {header < b.h && <line className="ld-box-sep" x1={b.x} y1={b.y + header} x2={b.x + b.w} y2={b.y + header} />}
    </>
  );
}

function InstrView({
  n,
  sel,
  errs,
  forceOf,
  showValues,
}: {
  n: InstrLayout;
  sel: LadderSelection | undefined;
  errs: readonly VerifyError[] | undefined;
  forceOf: ((operand: string) => boolean | number | undefined) | undefined;
  showValues: boolean;
}) {
  const selected = sel?.elementId === n.id;
  const elErrs = errs?.filter((e) => e.elementId === n.id);
  const hasErr = elErrs?.some((e) => e.severity === 'error');
  const hasWarn = !hasErr && elErrs && elErrs.length > 0;
  const badOps = new Set(elErrs?.filter((e) => e.operandIndex !== undefined && e.severity === 'error').map((e) => e.operandIndex!));
  const cell = { x: n.x - 5, y: n.top - 2, w: n.w + 10, h: n.bottom - n.top + 4 };
  return (
    <g className="ld-i" data-el={n.id}>
      <rect className="ld-cell" x={cell.x} y={cell.y} width={cell.w} height={cell.h} rx={5} />
      {(hasErr || hasWarn) && <rect className={hasErr ? 'ld-errbox' : 'ld-warnbox'} x={cell.x} y={cell.y} width={cell.w} height={cell.h} />}
      {selected && <rect className="ld-selbox" x={cell.x} y={cell.y} width={cell.w} height={cell.h} />}
      <g data-sym="">
        <Glyph n={n} />
      </g>
      {n.texts.map((t, i) => span(t, i))}
      {n.operands.map((o) => {
        const forced = forceOf && o.text !== '?' ? forceOf(o.text) : undefined;
        const missing = o.text === '?' || o.text === '';
        const opSel = selected && sel?.operandIndex === o.index;
        const cls = cn(`ld-t-${o.cls}`, missing && 'ld-t-missing', forced !== undefined && 'ld-t-forced', o.inlineValue && 'ld-iv');
        return (
          <g key={`o${o.index}`}>
            {opSel && <rect className="ld-opsel" x={o.hit.x} y={o.hit.y} width={o.hit.w} height={o.hit.h} />}
            {o.inlineValue && showValues ? (
              <text className={cls} x={o.x} y={o.y} textAnchor={o.anchor} data-iv={o.inlineValue} data-lit={o.shown} />
            ) : (
              <text className={cls} x={o.x} y={o.y} textAnchor={o.anchor}>
                {o.shown}
              </text>
            )}
            {badOps.has(o.index) && <path className="ld-squiggle" d={squiggle(o.hit.x, o.hit.y + o.hit.h + 1, o.hit.w)} />}
            {forced !== undefined && (
              <g className="ld-force">
                <rect x={o.hit.x + o.hit.w + 1} y={o.hit.y + 1} width={11} height={11} />
                <text x={o.hit.x + o.hit.w + 6.5} y={o.hit.y + 9.5}>
                  F
                </text>
              </g>
            )}
            <rect className="ld-ophit" x={o.hit.x} y={o.hit.y} width={o.hit.w} height={o.hit.h} fill="transparent" data-op={o.index} />
          </g>
        );
      })}
      {showValues &&
        n.values.map((v, i) =>
          v.style === 'chip' ? (
            <g key={`v${i}`} className="ld-chip" data-chip={v.operand}>
              <rect x={v.x - 8} y={v.y - 9.5} width={16} height={12.5} />
              <text x={v.x} y={v.y} />
            </g>
          ) : (
            <text key={`v${i}`} className="ld-val" x={v.x} y={v.y} textAnchor={v.anchor} data-val={v.operand} />
          ),
        )}
      {n.status.map((s, k) => (
        <g key={s.bit} className="ld-st" data-st={s.operand ?? ''}>
          {k > 0 && <line x1={s.x1} y1={s.y} x2={s.lx - 13} y2={s.y} />}
          <rect x={s.lx - 13} y={s.y - 6.5} width={26} height={13} rx={6.5} />
          <text x={s.lx} y={s.y + 3.4}>
            {s.bit}
          </text>
        </g>
      ))}
    </g>
  );
}

function BranchView({ n, sel, errs }: { n: BranchLayout; sel: LadderSelection | undefined; errs: readonly VerifyError[] | undefined }) {
  const last = n.legYs[n.legYs.length - 1]!;
  const selected = sel?.elementId === n.id;
  const mine = errs?.filter((e) => e.elementId === n.id) ?? [];
  const hasErr = mine.some((e) => e.severity === 'error');
  const hasWarn = !hasErr && mine.length > 0;
  const box = { x: n.x - 6, y: n.top - 2, w: n.x2 - n.x + 12, h: n.bottom - n.top + 4 };
  return (
    <g className="ld-br" data-el={n.id}>
      {(hasErr || hasWarn) && <rect className={hasErr ? 'ld-errbox' : 'ld-warnbox'} x={box.x} y={box.y} width={box.w} height={box.h} />}
      {selected && <rect className="ld-brsel" x={box.x} y={box.y} width={box.w} height={box.h} />}
      {/* empty legs are shorts: power always passes — drawn dashed amber so they cannot go unnoticed */}
      {n.emptyLegs.map((k) => (
        <line key={k} className={cn('ld-short', hasWarn && 'ld-short-warn')} x1={n.x + 5} y1={n.legYs[k]!} x2={n.x2 - 5} y2={n.legYs[k]!} />
      ))}
      <rect className="ld-brhit" x={n.x - 4} y={n.y - 5} width={8} height={last - n.y + 10} rx={3} />
      <rect className="ld-brhit" x={n.x2 - 4} y={n.y - 5} width={8} height={last - n.y + 10} rx={3} />
    </g>
  );
}

/** Wrap / continuation markers of a rung wrapped onto several lines (─▸ … ▸─). */
function WrapMarks({ L }: { L: RungLayout }) {
  if (L.wraps.length === 0) return null;
  return (
    <g className="ld-wrap">
      {L.wraps.map((w, i) => {
        const tx = w.side === 'out' ? w.x + 6 : w.x + 4;
        return (
          <g key={i}>
            <path d={`M${tx} ${w.y - 5}L${tx + 6} ${w.y}L${tx} ${w.y + 5}Z`} />
            <text x={tx + 3} y={w.y - 8} textAnchor="middle">
              {w.n}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface RungMarginProps {
  rungId: string;
  index: number;
  layout: RungLayout;
  zoom: number;
  selected?: boolean;
  errors?: readonly VerifyError[];
}

/**
 * The rung-number margin: number badge (double-click → edit as text) and the Studio 5000 verify marker
 * ('e' errors / 'w' warnings) in separate slots. Rendered inside the rung SVG, or on its own by hosts
 * that pin it (`RungSvg separateMargin`).
 */
function MarginContent({ index, L, errors }: { index: number; L: RungLayout; errors?: readonly VerifyError[] | undefined }) {
  const errs = errors?.filter((e) => e.severity === 'error').length ?? 0;
  const warns = errors?.filter((e) => e.severity === 'warning').length ?? 0;
  const numY = L.y;
  const mw = L.railL - 10;
  return (
    <>
      <rect className="ld-margin" x={0} y={0} width={mw} height={L.height} />
      <line className="ld-margin-edge" x1={mw - 0.5} y1={0} x2={mw - 0.5} y2={L.height} />
      <rect className="ld-numbox" x={mw - 32} y={numY - 10} width={29} height={19} rx={4} data-rungnum="" />
      <text className="ld-num" x={mw - 8} y={numY + 4} textAnchor="end">
        {index}
      </text>
      {(errs > 0 || warns > 0) && (
        <g className={cn('ld-marker', errs > 0 ? 'e' : 'w')} data-marker="">
          <rect x={2} y={numY - 7.5} width={12} height={15} />
          <text x={8} y={numY + 3.5} textAnchor="middle">
            {errs > 0 ? 'e' : 'w'}
          </text>
        </g>
      )}
    </>
  );
}

function RungMarginImpl({ rungId, index, layout: L, zoom, selected, errors }: RungMarginProps) {
  const mw = L.railL - 10;
  return (
    <svg
      className={cn('ld-rung ld-margin-svg', selected && 'ld-rung-selected')}
      width={Math.ceil(mw * zoom)}
      height={Math.ceil(L.height * zoom)}
      viewBox={`0 0 ${mw} ${L.height}`}
      data-rung={rungId}
      aria-hidden="true"
    >
      <MarginContent index={index} L={L} errors={errors} />
    </svg>
  );
}

/** Pinned rung margin (see `RungSvgProps.separateMargin`). */
export const RungMargin = memo(RungMarginImpl);

/** A blank margin plate (for the End rung of a pinned-margin editor). */
export function MarginPlate({ railL, height, zoom }: { railL: number; height: number; zoom: number }) {
  const mw = railL - 10;
  return (
    <svg className="ld-rung ld-margin-svg" width={Math.ceil(mw * zoom)} height={Math.ceil(height * zoom)} viewBox={`0 0 ${mw} ${height}`} aria-hidden="true">
      <rect className="ld-margin" x={0} y={0} width={mw} height={height} />
      <line className="ld-margin-edge" x1={mw - 0.5} y1={0} x2={mw - 0.5} y2={height} />
    </svg>
  );
}

function gapKey(g: { legPath?: { branchId: string; leg: number }; index: number }): string {
  return `${g.legPath ? `${g.legPath.branchId}:${g.legPath.leg}` : ''}/${g.index}`;
}

/** Parse the `data-gap` attribute of a wire hit rectangle. */
export function parseGapKey(key: string): { legPath?: { branchId: string; leg: number }; index: number } | undefined {
  const m = /^(?:([^:/]+):(\d+))?\/(\d+)$/.exec(key);
  if (!m) return undefined;
  return m[1] ? { legPath: { branchId: m[1], leg: Number(m[2]) }, index: Number(m[3]) } : { index: Number(m[3]) };
}

function RungSvgImpl(p: RungSvgProps) {
  const { layout: L, zoom, rung, selection: sel, errors } = p;
  const svgRef = useRef<SVGSVGElement>(null);
  const groups = useMemo(() => groupWires(L.wires), [L]);
  const register = p.register;
  const showValues = p.showValues === true;

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!register || !svg) return;
    register(rung.id, createBinding(svg, groups));
    return () => register(rung.id, null);
  }, [register, rung.id, groups, showValues, p.forcesVersion]);

  const rungSelected = sel !== undefined && !sel.elementId && sel.wireIndex === undefined && !sel.legPath;

  // wire position / leg selection
  let caret: ReactNode = null;
  if (sel && sel.wireIndex !== undefined) {
    const g = L.gaps.find((x) => x.index === sel.wireIndex && sameLegPath(x.legPath, sel.legPath));
    if (g) {
      caret = (
        <g>
          <line className="ld-caret-seg" x1={g.x0 + 2} y1={g.y} x2={g.x1 - 2} y2={g.y} />
          <line className="ld-caret" x1={g.x} y1={g.y - 9} x2={g.x} y2={g.y + 9} />
        </g>
      );
    }
  } else if (sel?.legPath && !sel.elementId) {
    const segs = L.wires.filter((w) => w.gap && sameLegPath(w.gap.legPath, sel.legPath));
    caret = (
      <g>
        {segs.map((w, i) => (
          <line key={i} className="ld-caret-seg" x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
        ))}
      </g>
    );
  }

  return (
    <svg
      ref={svgRef}
      className={cn('ld-rung', rungSelected && 'ld-rung-selected', p.className)}
      width={Math.ceil(L.width * zoom)}
      height={Math.ceil(L.height * zoom)}
      viewBox={`0 0 ${L.width} ${L.height}`}
      data-rung={rung.id}
      role="img"
      aria-label={`Rung ${p.index}${rung.comment ? `: ${rung.comment}` : ''}`}
    >
      <rect className="ld-rowbg" x={0} y={0} width={L.width} height={L.height} />
      {!p.bare && !p.separateMargin && <MarginContent index={p.index} L={L} errors={errors} />}
      <line className="ld-rail" x1={L.railL} y1={0} x2={L.railL} y2={L.height} />
      <line className="ld-rail" x1={L.railR} y1={0} x2={L.railR} y2={L.height} />
      {L.comment && (
        <g className="ld-comment" data-comment="">
          <rect x={L.comment.x} y={L.comment.y} width={L.comment.w} height={L.comment.h} />
          <rect className="ld-comment-accent" x={L.comment.x + 3} y={L.comment.y + 4} width={3} height={L.comment.h - 8} />
          {L.comment.lines.map((line, i) => (
            <text key={i} x={L.comment!.x + LD.commentPad + 7} y={L.comment!.y + LD.commentPad + 9 + i * LD.commentLine}>
              {line}
            </text>
          ))}
        </g>
      )}
      {groups.map((g, i) => (
        <path key={g.key} className="ld-w" d={g.d} data-pk={i} />
      ))}
      {L.wires.map((w, i) =>
        w.gap && w.x2 - w.x1 > 2 ? (
          <rect key={`h${i}`} className="ld-hitw" x={w.x1} y={w.y1 - 6} width={w.x2 - w.x1} height={12} data-gap={gapKey(w.gap)} />
        ) : null,
      )}
      <WrapMarks L={L} />
      {caret}
      {L.nodes.map((n) =>
        n.kind === 'instr' ? (
          <InstrView key={n.id} n={n} sel={sel} errs={errors} forceOf={p.forceOf} showValues={showValues} />
        ) : (
          <BranchView key={n.id} n={n} sel={sel} errs={errors} />
        ),
      )}
      {p.dropGap && (
        <g>
          <line className="ld-drop" x1={p.dropGap.x} y1={p.dropGap.y - 11} x2={p.dropGap.x} y2={p.dropGap.y + 11} />
          <circle className="ld-drop-dot" cx={p.dropGap.x} cy={p.dropGap.y} r={3.5} />
        </g>
      )}
    </svg>
  );
}

/** One rung (memoized: re-renders only when its own props change). */
export const RungSvg = memo(RungSvgImpl);

/** The "(End)" rung drawn after the last rung. */
export function EndRung({ width, zoom, railL, railR, children, separateMargin }: { width: number; zoom: number; railL: number; railR: number; children?: ReactNode; separateMargin?: boolean }) {
  const h = LD.endHeight;
  const mid = (railL + railR) / 2;
  return (
    <svg className="ld-rung" width={Math.ceil(width * zoom)} height={Math.ceil(h * zoom)} viewBox={`0 0 ${width} ${h}`} aria-label="End of routine">
      {!separateMargin && (
        <>
          <rect className="ld-margin" x={0} y={0} width={railL - 10} height={h} />
          <line className="ld-margin-edge" x1={railL - 10.5} y1={0} x2={railL - 10.5} y2={h} />
        </>
      )}
      <line className="ld-rail" x1={railL} y1={0} x2={railL} y2={h / 2 + 8} />
      <line className="ld-rail" x1={railR} y1={0} x2={railR} y2={h / 2 + 8} />
      <line className="ld-end-line" x1={railL} y1={h / 2} x2={mid - 26} y2={h / 2} />
      <line className="ld-end-line" x1={mid + 26} y1={h / 2} x2={railR} y2={h / 2} />
      <text className="ld-end-text" x={mid} y={h / 2 + 4} textAnchor="middle">
        (End)
      </text>
      {children}
    </svg>
  );
}
