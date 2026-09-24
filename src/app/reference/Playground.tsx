/**
 * "Try it" playground: a tiny live Logix controller (trainer-bench hardware, createDemoRuntime + useSimLoop)
 * running the instruction's example rungs in an online, editable LadderEditor, with input toggles / number
 * fields and a live timing diagram of the relevant tags and status bits.
 */
import { FlaskConical, Pause, Pencil, Play, RotateCcw, Sparkles } from 'lucide-react';
import { useCallback, useMemo, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { sfx } from '../../audio/sfx';
import { LadderEditor, MiniLadder } from '../../editor';
import { INSTRUCTIONS } from '../../plc/instructions';
import { parseRung } from '../../plc/neutralText';
import type { PlcController, Rung, VerifyError } from '../../plc/types';
import { createDemoRuntime } from '../../sim/demo';
import { trainerLogic } from '../../sim/scenes';
import type { SimRuntime } from '../../sim/types';
import { useSimLoop } from '../../sim/useSimLoop';
import { Button, cn } from '../../ui';
import type { PlaygroundDef, PlaygroundInput } from './playgrounds';
import { TraceRecorder, withStepHook } from './recorder';
import { InlineMd } from './InlineMd';
import { TimingDiagram } from './TimingDiagram';
import { useMedia } from './useMedia';

const PROGRAM = 'MainProgram';
const ROUTINE = 'MainRoutine';
const WINDOWS = [
  { ms: 10_000, label: '10 s' },
  { ms: 2_000, label: '2 s' },
  { ms: 500, label: '0.5 s' },
];

export function Playground({ mnemonic, def, className }: { mnemonic: string; def: PlaygroundDef; className?: string }) {
  const [epoch, setEpoch] = useState(0);
  return <Session key={`${mnemonic}:${epoch}`} mnemonic={mnemonic} def={def} onReset={() => setEpoch((e) => e + 1)} className={className} />;
}

function Session({ mnemonic, def, onReset, className }: { mnemonic: string; def: PlaygroundDef; onReset(): void; className?: string }) {
  const sim = useMemo(() => {
    const recorder = new TraceRecorder(def.traces, 10_000);
    const holder: { controller: PlcController | null } = { controller: null };
    const scene = withStepHook(trainerLogic, (dt) => {
      if (holder.controller) recorder.sample(holder.controller, dt);
    });
    const rungs = def.rungs.map((t, i) => (def.comments?.[i] ? parseRung(t, def.comments[i]) : parseRung(t)));
    const { controller, runtime } = createDemoRuntime(scene, rungs, { tags: def.tags, run: false });
    for (const r of def.routines ?? []) controller.updateRoutine(PROGRAM, r.name, r.rungs.map((t) => parseRung(t)));
    controller.requestMode('RUN');
    holder.controller = controller;
    return { controller, runtime, recorder };
  }, [def]);

  const [paused, setPaused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [windowMs, setWindowMs] = useState(10_000);
  const [rungs, setRungs] = useState<Rung[]>(() => sim.controller.project.programs[0]!.routines.find((r) => r.name === ROUTINE)!.rungs);
  const [errors, setErrors] = useState<VerifyError[]>(() => sim.controller.verify());
  const narrow = !useMedia('(min-width: 640px)');
  useSimLoop(sim.runtime, !paused);

  const onChange = (next: Rung[]) => {
    setRungs(next);
    sim.controller.updateRoutine(PROGRAM, ROUTINE, next);
    setErrors(sim.controller.verify());
  };

  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border border-edge bg-panel-2', className)} aria-label={`${mnemonic} playground`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-edge bg-gradient-to-r from-ab-red/15 via-transparent to-transparent px-3 py-2">
        <FlaskConical size={16} className="text-ab-red" />
        <h2 className="text-sm font-bold text-white">Try it live</h2>
        <StatusPill runtime={sim.runtime} controller={sim.controller} paused={paused} />
        <div className="flex-1" />
        <Button size="xs" variant={editing ? 'primary' : 'secondary'} icon={<Pencil size={12} />} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
          {editing ? 'Editing' : 'Edit rungs'}
        </Button>
        <Button size="xs" variant="secondary" icon={paused ? <Play size={12} /> : <Pause size={12} />} onClick={() => setPaused((p) => !p)}>
          {paused ? 'Run' : 'Pause'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          icon={<RotateCcw size={12} />}
          onClick={() => {
            sfx.play('click');
            onReset();
          }}
          title="Restart the controller with the original example"
        >
          Reset
        </Button>
      </header>

      <div className="ld-host border-b border-edge" style={{ height: Math.min(640, Math.round(editorHeight(def, editing) * (narrow ? 1.45 : 1))) }}>
        <LadderEditor
          rungs={rungs}
          onChange={onChange}
          program={PROGRAM}
          routine={ROUTINE}
          controller={sim.controller}
          online
          errors={errors}
          showToolbar={editing}
          showHeader={editing}
          onTagsChanged={() => setErrors(sim.controller.verify())}
          className="h-full"
        />
      </div>

      {def.routines?.map((r) => (
        <div key={r.name} className="border-b border-edge bg-panel/60 px-3 py-2">
          <div className="mb-1.5 font-mono text-[11px] font-semibold text-slate-400">
            Routine <span className="text-slate-200">{r.name}</span> <span className="text-slate-600">(called by JSR · read-only)</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {r.rungs.map((t, i) => (
              <MiniLadder key={i} text={t} width={560} />
            ))}
          </div>
        </div>
      ))}

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)]">
        <Inputs runtime={sim.runtime} controller={sim.controller} inputs={def.inputs} />
        <div className="border-t border-edge px-2 pt-2 pb-1">
          <div className="mb-1 flex items-center gap-2 px-1">
            <span className="text-[11px] font-bold tracking-[0.08em] text-slate-400 uppercase">Timing diagram</span>
            <span className="text-[11px] text-slate-500">one sample per scan · hover to read values</span>
            <div className="flex-1" />
            <div role="radiogroup" aria-label="Time window" className="flex rounded-md border border-edge bg-panel p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w.ms}
                  type="button"
                  role="radio"
                  aria-checked={windowMs === w.ms}
                  onClick={() => setWindowMs(w.ms)}
                  className={cn(
                    'h-6 cursor-pointer rounded px-2 font-mono text-[11px] font-semibold',
                    windowMs === w.ms ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-slate-200',
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <TimingDiagram recorder={sim.recorder} traces={def.traces} windowMs={windowMs} />
        </div>
      </div>

      {def.tryIt.length > 0 && (
        <div className="border-t border-edge bg-panel/50 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-amber-300/90 uppercase">
            <Sparkles size={13} /> Things to try
          </div>
          <ul className="space-y-1">
            {def.tryIt.map((t, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-300">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-safety" />
                <span>
                  <InlineMd text={t} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Rough editor height so the example rungs fit without scrolling (≈ layout of the ladder renderer). */
function editorHeight(def: PlaygroundDef, editing: boolean): number {
  let h = 40 + (editing ? 132 : 0);
  def.rungs.forEach((r, i) => {
    const ops = [...r.matchAll(/([A-Z]{2,4})\(/g)].map((m) => INSTRUCTIONS[m[1]!]).filter(Boolean);
    const boxRows = Math.max(0, ...ops.map((o) => (o!.display === 'box' ? o!.operands.length : 0)));
    h += 84 + (def.comments?.[i] ? 36 : 0) + (r.split('[').length - 1) * 56 + (boxRows > 0 ? 24 + boxRows * 15 : 0);
  });
  return Math.max(170, Math.min(editing ? 600 : 470, h));
}

/** Re-render at the runtime's notification rate (≈ 30 Hz). */
function useRuntimeVersion(runtime: SimRuntime): number {
  const subscribe = useCallback((cb: () => void) => runtime.subscribe(cb), [runtime]);
  return useSyncExternalStore(subscribe, () => runtime.version, () => runtime.version);
}

function StatusPill({ runtime, controller, paused }: { runtime: SimRuntime; controller: PlcController; paused: boolean }) {
  useRuntimeVersion(runtime);
  const st = controller.getStatus();
  const faulted = st.mode === 'FAULTED';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-semibold',
        faulted ? 'border-red-500/40 bg-red-500/10 text-red-300' : paused ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', faulted ? 'bg-red-400' : paused ? 'bg-amber-400' : 'animate-pulse bg-emerald-400')} />
      {faulted ? 'FAULTED' : paused ? 'PAUSED' : 'RUN'} · {(runtime.timeMs / 1000).toFixed(1)} s
    </span>
  );
}

function Inputs({ runtime, controller, inputs }: { runtime: SimRuntime; controller: PlcController; inputs: PlaygroundInput[] }) {
  useRuntimeVersion(runtime);
  if (inputs.length === 0) return null;
  return (
    <div className="flex flex-wrap items-stretch gap-2 px-3 py-2.5" aria-label="Inputs">
      {inputs.map((inp) => (
        <InputControl key={inp.tag} input={inp} controller={controller} />
      ))}
    </div>
  );
}

function read(controller: PlcController, tag: string, kind: 'bool' | 'number'): number {
  try {
    return kind === 'bool' ? (controller.tags.readBool(tag) ? 1 : 0) : controller.tags.readNumber(tag);
  } catch {
    return Number.NaN;
  }
}

function write(controller: PlcController, tag: string, v: boolean | number): void {
  try {
    if (typeof v === 'boolean') controller.tags.writeBool(tag, v);
    else controller.tags.writeNumber(tag, v);
  } catch {
    /* tag deleted by an edit */
  }
}

function InputControl({ input, controller }: { input: PlaygroundInput; controller: PlcController }) {
  const label = input.label ?? input.tag;
  if (input.kind === 'bool') {
    const on = read(controller, input.tag, 'bool') === 1;
    if (input.momentary) return <HoldButton label={label} tag={input.tag} controller={controller} on={on} />;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => {
          write(controller, input.tag, !on);
          sfx.play('toggle');
        }}
        className={cn(
          'flex min-w-[120px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
          on ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-edge bg-panel hover:border-slate-500',
        )}
      >
        <span className={cn('relative h-5 w-9 shrink-0 rounded-full border transition-colors', on ? 'border-emerald-400/50 bg-emerald-600/60' : 'border-edge bg-slate-800')}>
          <span className={cn('absolute top-[2px] h-3.5 w-3.5 rounded-full transition-all', on ? 'left-[18px] bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)]' : 'left-[2px] bg-slate-500')} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-mono text-[12px] font-semibold text-slate-100">{label}</span>
          <span className={cn('block font-mono text-[10.5px]', on ? 'text-emerald-300' : 'text-slate-500')}>{on ? '1 · ON' : '0 · OFF'}</span>
        </span>
      </button>
    );
  }
  if (input.kind === 'bits') {
    const v = read(controller, input.tag, 'number');
    return (
      <div className="rounded-lg border border-edge bg-panel px-2.5 py-1.5">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-mono text-[12px] font-semibold text-slate-100">{label}</span>
          <span className="font-mono text-[10.5px] text-slate-500">= {Number.isFinite(v) ? v : '—'}</span>
        </div>
        <div className="flex gap-[3px]">
          {[7, 6, 5, 4, 3, 2, 1, 0].map((b) => {
            const on = Number.isFinite(v) && ((v >> b) & 1) === 1;
            return (
              <button
                key={b}
                type="button"
                aria-pressed={on}
                aria-label={`${input.tag} bit ${b}`}
                onClick={() => {
                  write(controller, input.tag, (v ^ (1 << b)) | 0);
                  sfx.play('toggle');
                }}
                className={cn(
                  'flex h-7 w-6 cursor-pointer flex-col items-center justify-center rounded border font-mono leading-none transition-colors',
                  b === 3 && 'mr-1',
                  on ? 'border-emerald-400/60 bg-emerald-500/25 text-emerald-200' : 'border-edge bg-slate-800 text-slate-500 hover:border-slate-500',
                )}
              >
                <span className="text-[11px] font-bold">{on ? 1 : 0}</span>
                <span className="text-[8px] opacity-70">{b}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  const v = read(controller, input.tag, 'number');
  const min = input.min ?? 0;
  const max = input.max ?? 100;
  const step = input.step ?? 1;
  const p = Number.isFinite(v) ? ((v - min) / (max - min)) * 100 : 0;
  return (
    <label className="flex min-w-[200px] flex-1 basis-[200px] flex-col gap-1 rounded-lg border border-edge bg-panel px-2.5 py-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-mono text-[12px] font-semibold text-slate-100">{label}</span>
        <input
          type="number"
          value={Number.isFinite(v) ? Number(v.toFixed(step < 1 ? 1 : 0)) : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) write(controller, input.tag, n);
          }}
          aria-label={`${input.tag} value`}
          className="w-20 rounded border border-edge bg-black/30 px-1.5 py-0.5 text-right font-mono text-[12px] text-slate-100 focus:border-sky-500 focus:outline-none"
        />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(v) ? v : min}
        onChange={(e) => write(controller, input.tag, Number(e.target.value))}
        aria-label={input.tag}
        className="sr-range w-full cursor-pointer"
        style={{ ['--p' as string]: `${Math.max(0, Math.min(100, p))}%` }}
      />
    </label>
  );
}

function HoldButton({ label, tag, controller, on }: { label: string; tag: string; controller: PlcController; on: boolean }) {
  const set = useCallback(
    (v: boolean) => {
      write(controller, tag, v);
      sfx.play(v ? 'press' : 'release');
    },
    [controller, tag],
  );
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    set(true);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, v: boolean) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) set(v);
    }
  };
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${label} (hold)`}
      onPointerDown={onDown}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      className={cn(
        'flex min-w-[110px] cursor-pointer touch-none flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-all select-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        on ? 'translate-y-px border-emerald-400/60 bg-emerald-500/20' : 'border-edge bg-panel-3 shadow-[0_2px_0_rgba(0,0,0,0.5)] hover:border-slate-500',
      )}
    >
      <span className="font-mono text-[12px] font-semibold text-slate-100">{label}</span>
      <span className={cn('font-mono text-[10.5px]', on ? 'text-emerald-300' : 'text-slate-500')}>{on ? 'pressed · 1' : 'hold to press'}</span>
    </button>
  );
}
