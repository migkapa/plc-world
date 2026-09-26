/**
 * Guided first rung (mission 1-1): coach marks — a spotlight on the thing to use and a callout card — that walk the
 * player through operating the plant, building XIC(Switch_0) OTE(Light_0), watching it apply online, trying it and
 * pressing Verify & Test. Each step advances when the player does it (judged by `tourStepView` from the editor,
 * the running logic, the controls and the plant); "Show me" does it for them. Non-blocking: the page stays usable,
 * nothing steals the keyboard after the first card, and the card is a labelled region (not a dialog, so Ctrl+Enter
 * and the plant hotkeys keep working).
 */
import { CheckCircle2, ChevronRight, GraduationCap, Hand, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { sfx } from '../../../audio/sfx';
import type { LadderEditorHandle } from '../../../editor';
import { serializeRung } from '../../../plc/neutralText';
import { Button, Kbd, Markdown, cn } from '../../../ui';
import { observeCached } from '../hooks';
import { mainRungs } from '../program';
import type { WorkspaceRuntime } from '../useWorkspaceRuntime';
import { firstShown, instructionEl, isLaidOut, isShown, operandBox, padControl, paletteButton, placeCard, rectOf, rungRow, sameRect, twinPanel, typeAndEnter, type Rect } from './dom';
import { FIRST_RUNG_STEPS, editorHasFirstRung, firstRungInstr, runningHasFirstRung, tourStepView, type TourAction, type TourPanel, type TourSince, type TourStepView, type TourTarget, type TourWorld } from './firstRungTour';
import './onboarding.css';

export interface TourCoachMarksProps {
  ws: WorkspaceRuntime;
  editorRef: RefObject<LadderEditorHandle | null>;
  /** A Verify & Test run is active. */
  running: boolean;
  onRun(): void;
  /** Bring a panel on screen (phones show one panel at a time). */
  onShowPanel?(panel: TourPanel): void;
  onFinish(status: 'completed' | 'skipped'): void;
  reducedMotion: boolean;
}

const TICK_MS = 150;

function resolveTarget(t: TourTarget, ws: WorkspaceRuntime): HTMLElement | null {
  switch (t.kind) {
    case 'twin':
      return isShown(twinPanel()) ? twinPanel() : null;
    case 'control':
      return padControl(t.id) ?? firstShown('[data-testid="twin-panel"] [data-testid="control-pad"]') ?? (isShown(twinPanel()) ? twinPanel() : null);
    case 'rung': {
      const row = rungRow(t.index);
      return isLaidOut(row) ? row : null;
    }
    case 'palette':
      return paletteButton(t.op) ?? firstShown('[data-testid="ladder-panel"] [role="toolbar"]');
    case 'operand': {
      const open = operandBox(t.op);
      if (open && isLaidOut(open.box)) return open.box;
      const instr = firstRungInstr(ws.rungs, t.op)[0];
      const el = instr ? instructionEl(instr.id) : null;
      return el && isLaidOut(el) ? el : null;
    }
    case 'edits':
      return firstShown('[data-testid="edits-tile"]') ?? firstShown('[data-testid="edit-strip"]');
    case 'verify':
      return firstShown('[data-testid="verify-test"]');
  }
}

interface Shown {
  view: TourStepView;
  rect: Rect | null;
}

export function TourCoachMarks({ ws, editorRef, running, onRun, onShowPanel, onFinish, reducedMotion }: TourCoachMarksProps) {
  const [index, setIndex] = useState(0);
  const step = FIRST_RUNG_STEPS[index]!;
  const [shown, setShown] = useState<Shown | null>(null);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const runningRef = useRef(running);
  runningRef.current = running;
  const runtime = ws.runtime;
  const since = useRef<TourSince>({ sw0On: 0, sw0Off: 0, sw0AtStart: runtime.getControl('sw0') === true });
  const scrolledFor = useRef(-1);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ width: 340, height: 180 });
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  // clicks on a rung / keyboard focus on the ladder editor since the step started
  useEffect(() => {
    const onDown = (e: Event): void => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('[data-testid="ladder-panel"] [data-rung-row]')) since.current.ladder = (since.current.ladder ?? 0) + 1;
    };
    const onFocus = (e: FocusEvent): void => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.matches('[data-testid="ladder-panel"] [role="application"]')) since.current.ladder = (since.current.ladder ?? 0) + 1;
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('focusin', onFocus, true);
    };
  }, []);

  // Switch 0 flips since the step started (pad, hotkeys, 3D clicks and "Show me" all go through setControl)
  useEffect(
    () =>
      runtime.onControl((id, value) => {
        if (id !== 'sw0') return;
        if (value === true) since.current.sw0On++;
        else since.current.sw0Off++;
      }),
    [runtime],
  );

  const world = useCallback((): TourWorld => {
    const w = wsRef.current;
    const sel = editorRef.current?.getSelection() ?? null;
    let running: string[] = [];
    try {
      running = mainRungs(w.controller.project).map((r) => serializeRung(r));
    } catch {
      running = [];
    }
    return {
      rungs: w.rungs,
      selectedRungId: sel?.rungId ?? null,
      running,
      pendingReason: w.pendingReason,
      sw0: w.runtime.getControl('sw0') === true,
      light0: observeCached(w.runtime).light0 === true,
      testsRunning: runningRef.current,
    };
  }, [editorRef]);

  // entering a step: bring its panel on screen, restart the "since" counters
  useEffect(() => {
    since.current = { sw0On: 0, sw0Off: 0, sw0AtStart: runtime.getControl('sw0') === true, rungRunningAtStart: runningHasFirstRung(world().running) };
    setDoneAt(null);
    onShowPanel?.(step.panel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  /** The card had the keyboard focus when its step ended: the next card takes it (keyboard players stay on the card). */
  const focusNext = useRef(true);
  const advance = useCallback(() => {
    const ae = document.activeElement;
    focusNext.current = !!cardRef.current && !!ae && (cardRef.current.contains(ae) || ae === document.body);
    setShown(null);
    if (index >= FIRST_RUNG_STEPS.length - 1) {
      finishRef.current('completed');
      return;
    }
    setDoneAt(null); // same render as the new index: the next step never sees this step's "done"
    setIndex(index + 1);
  }, [index]);

  // the ticker: judge the step, follow the target on screen
  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      if (!alive) return;
      const w = world();
      // Verify & Test pressed with the rung built: the tour's job is done, whatever step it was on
      if (w.testsRunning && step.id !== 'verify' && editorHasFirstRung(w.rungs)) {
        finishRef.current('completed');
        return;
      }
      const view = tourStepView(step.id, w, since.current);
      const el = resolveTarget(step.target, wsRef.current);
      if (el && scrolledFor.current !== index && (step.target.kind === 'rung' || step.target.kind === 'palette')) {
        scrolledFor.current = index;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const rect = el ? rectOf(el, step.target.kind === 'twin' ? -4 : 5) : null;
      setShown((prev) => {
        const v = doneAt !== null && prev ? { ...view, done: true, body: prev.view.done ? prev.view.body : view.body } : view;
        if (prev && prev.view.done === v.done && prev.view.body === v.body && prev.view.hint === v.hint && sameRect(prev.rect, rect)) return prev;
        return { view: v, rect };
      });
      if (view.done && doneAt === null && !step.manual) setDoneAt(performance.now());
    };
    tick();
    const h = window.setInterval(tick, TICK_MS);
    const onResize = (): void => tick();
    window.addEventListener('resize', onResize);
    return () => {
      alive = false;
      window.clearInterval(h);
      window.removeEventListener('resize', onResize);
    };
  }, [world, step, index, doneAt]);

  // a finished step moves on by itself after its "beat"
  useEffect(() => {
    if (doneAt === null) return;
    if (step.beatMs <= 0) {
      advance();
      return;
    }
    sfx.play('success');
    const h = window.setTimeout(advance, step.beatMs);
    return () => window.clearTimeout(h);
  }, [doneAt, step, advance]);

  // the first card takes the keyboard focus; later ones only when the player was on the card (Next / Enter) — never
  // while they work in the editor or on the pad
  const hasCard = shown !== null;
  useEffect(() => {
    if (!hasCard || !focusNext.current) return;
    focusNext.current = false;
    cardRef.current?.querySelector<HTMLButtonElement>('[data-primary]')?.focus({ preventScroll: true });
  }, [hasCard, index]);

  // Alt+G: jump to the card from anywhere (the editor, the pad…) — keyboard players can always get back to it
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyG') return;
      const card = cardRef.current;
      const btn = card?.querySelector<HTMLButtonElement>('[data-primary]') ?? card?.querySelector<HTMLButtonElement>('button');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      btn.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - cardSize.width) > 1 || Math.abs(r.height - cardSize.height) > 1) setCardSize({ width: r.width, height: r.height });
  });

  const act = useCallback(
    (a: TourAction): void => {
      const w = wsRef.current;
      const ed = editorRef.current;
      const r0 = w.rungs[0];
      switch (a.kind) {
        case 'flip':
          w.runtime.setControl(a.id, a.value);
          sfx.play('toggle');
          return;
        case 'flipCycle': {
          const on = w.runtime.getControl(a.id) === true;
          if (on) {
            w.runtime.setControl(a.id, false);
            sfx.play('toggle');
            window.setTimeout(() => {
              w.runtime.setControl(a.id, true);
              sfx.play('toggle');
            }, 900);
          } else {
            w.runtime.setControl(a.id, true);
            sfx.play('toggle');
          }
          return;
        }
        case 'selectRung':
          if (!ed || !r0) return;
          ed.scrollToRung(a.index);
          ed.setSelection({ rungId: r0.id });
          since.current.ladder = (since.current.ladder ?? 0) + 1;
          ed.focus();
          return;
        case 'insert': {
          if (!ed || !r0) return;
          const last = [...r0.elements].reverse().find((e) => e.kind === 'instr');
          ed.setSelection(last ? { rungId: r0.id, elementId: last.id } : { rungId: r0.id });
          ed.insertInstruction(a.op);
          return;
        }
        case 'operand': {
          const fill = (): boolean => {
            const box = operandBox(a.op);
            if (!box) return false;
            typeAndEnter(box.input, a.value);
            return true;
          };
          if (fill()) return;
          const instr = firstRungInstr(w.rungs, a.op)[0];
          if (!ed || !r0 || !instr) return;
          ed.setSelection({ rungId: r0.id, elementId: instr.id, operandIndex: 0 });
          ed.editOperand();
          window.setTimeout(fill, 80);
          return;
        }
        case 'run':
          onRun();
          return;
      }
    },
    [editorRef, onRun],
  );

  if (!shown) return null;
  const { view, rect } = shown;
  const done = view.done || doneAt !== null;
  const pos = placeCard(rect, cardSize, { width: window.innerWidth, height: window.innerHeight }, 12, 10, step.place);
  const animate = reducedMotion ? undefined : '';
  const total = FIRST_RUNG_STEPS.length;
  const titleId = 'pw-tour-title';

  return createPortal(
    <>
      {rect && (
        <div
          aria-hidden
          className="pw-coach-hole pointer-events-none fixed z-[45] rounded-xl"
          data-animate={animate}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          data-testid="tour-spotlight"
        />
      )}
      <div
        ref={cardRef}
        role="region"
        aria-labelledby={titleId}
        aria-keyshortcuts="Alt+G"
        className="pw-coach-card fixed z-[46] w-[min(340px,calc(100vw-20px))] rounded-xl border border-sky-400/40 bg-panel-2/97 p-3.5 shadow-2xl shadow-black/60 backdrop-blur"
        data-animate={animate}
        style={{ left: pos.left, top: pos.top }}
        data-testid="tour-card"
        data-step={step.id}
        data-done={done ? '' : undefined}
      >
        <div className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold tracking-wide text-sky-300/90 uppercase">
          <GraduationCap size={13} />
          <span>
            Guided tour · {index + 1}/{total}
          </span>
          <span className="ml-1 flex flex-1 gap-0.5" aria-hidden>
            {FIRST_RUNG_STEPS.map((s, i) => (
              <span key={s.id} className={cn('h-1 flex-1 rounded-full', i < index || (i === index && done) ? 'bg-sky-400/80' : i === index ? 'bg-sky-400/40' : 'bg-white/10')} />
            ))}
          </span>
          <button
            type="button"
            onClick={() => finishRef.current('skipped')}
            className="-mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none"
            aria-label="Skip the guided tour"
            title="Skip the guided tour (replay it any time from the ? menu)"
            data-testid="tour-close"
          >
            <X size={14} />
          </button>
        </div>
        <div aria-live="polite">
          <h2 id={titleId} className="flex items-center gap-1.5 text-[14px] font-semibold text-white">
            {done && <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />}
            {step.title}
          </h2>
          <Markdown source={view.body} className={cn('mt-1 space-y-1 text-[12.5px] leading-snug', done ? 'text-emerald-100/90' : 'text-slate-300')} />
          {view.hint && !done && <p className="mt-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[12px] text-amber-100">{view.hint}</p>}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          {step.showMe && !done && (
            <Button size="xs" variant="secondary" icon={<Hand size={12} />} onClick={() => act(step.showMe!)} data-testid="tour-show-me" {...(!step.manual ? { 'data-primary': '' } : {})}>
              Show me
            </Button>
          )}
          {(step.manual || done) && (
            <Button size="xs" variant="primary" onClick={advance} data-primary="" data-testid="tour-next">
              {index === total - 1 ? 'Finish' : 'Next'} <ChevronRight size={12} />
            </Button>
          )}
          <span className="ml-auto hidden text-[10.5px] text-slate-500 sm:inline" title="Alt+G brings the keyboard back to this card from anywhere">
            <Kbd>Alt G</Kbd>
          </span>
          <button
            type="button"
            onClick={() => finishRef.current('skipped')}
            className="cursor-pointer rounded px-1 text-[11.5px] text-slate-400 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none max-sm:ml-auto"
            data-testid="tour-skip"
          >
            Skip tour
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
