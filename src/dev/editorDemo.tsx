/**
 * Dev harness for the ladder editor experience (editor-dev.html): OnlineToolbar, ControllerOrganizer,
 * LadderEditor (+ instruction toolbar), TagMonitor and a small trainer-bench control strip, around a
 * real controller running the trainer scene (sim runtime + requestAnimationFrame) — so screenshots
 * show the editor ONLINE with live power flow.
 *
 * Query params:
 *   theme=classic        Studio 5000 light ladder look
 *   offline=1            workstation offline (no animation, Offline tile)
 *   select=R[.I[.O]]     select rung R, instruction I (reading order), operand O
 *   zoom=1.2             initial ladder zoom
 *   rungs=100            stress test with N generated rungs (+ FPS meter)
 *   errors=1             add rungs with verification errors (controller stays in Program mode)
 *   empty=1              empty routine
 *   menu=1               open the context menu for the selection
 *   quick=XIC%20Sw       open ASCII quick entry with this text
 *   edit=1               open the operand editor for the selection
 *   text=R               edit rung R as neutral text
 *   comment=R            edit the comment of rung R
 *   help=TON             open instruction help
 *   forces=1             install & enable a force (Switch_5 ON)
 *   readonly=1           read-only ladder
 *   tags=edit            Tag monitor on the Edit Tags tab;  expand=Blink_Timer,Local:1:I  expand rows
 *   allowed=XIC,XIO,OTE  restrict the instruction palette
 *   fault=1              trigger a major fault (T04:C20)
 *   ladderOnly=1         only the ladder editor, full screen
 */
import { Cpu, Gauge, ToggleLeft } from 'lucide-react';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createController, instructionsOf, serializeRung, type LogixController, type Rung, type TagDef, type VerifyError } from '@/plc';
import { createProjectForScene } from '@/sim/project';
import { createSimRuntime, type SimRuntimeEx } from '@/sim/runtime';
import { trainerLogic } from '@/sim/scenes';
import { Toaster, toast } from '@/ui/toast';
import { cn } from '@/ui/cn';
import {
  ControllerOrganizer,
  LadderEditor,
  OnlineToolbar,
  TagMonitor,
  type LadderEditorHandle,
  type LadderSelection,
  type OrganizerNode,
  type OrganizerSelection,
} from '@/editor';
import '../index.css';

const params = new URLSearchParams(location.search);
const P = (k: string): string | null => params.get(k);

const DEMO_RUNGS: Array<[string, string?]> = [
  ['[XIC(PB_Green),XIC(Motor_Run)]XIC(PB_Red)OTE(Motor_Run);', 'Start/stop station with seal-in: the green push button starts the motor, the normally-closed red button (PB_Red) stops it.'],
  ['XIC(Motor_Run)OTE(Light_0);', 'Green pilot light: motor running.'],
  ['XIC(Motor_Run)XIO(Blink_Timer.DN)TON(Blink_Timer,1000,0);', 'Self-resetting 1 s timer while the motor runs.'],
  ['XIC(Motor_Run)LES(Blink_Timer.ACC,500)OTE(Light_2);', 'Amber lamp flashes: ON during the first half of every second.'],
  ['XIC(Blink_Timer.DN)CTU(Cycle_Count,10,0);'],
  ['XIC(Cycle_Count.DN)OTE(Light_4);'],
  ['XIC(Switch_7)RES(Cycle_Count);'],
  ['XIC(Switch_3)[XIC(Switch_4),XIO(Switch_5)[XIC(Switch_6),XIC(Switch_1)]]OTE(Light_6);', 'Nested branches: Switch 3 AND (Switch 4 OR (NOT Switch 5 AND (Switch 6 OR Switch 1))).'],
  ['GRT(Pot_1,50.0)OTE(Buzzer);', 'Buzzer when potentiometer 1 is above 50 %.'],
  ['CPT(Meter_1,Pot_1 * 0.8 + 10.0);'],
  ['XIC(Switch_0)OTL(Light_7);'],
  ['XIC(Switch_2)OTU(Light_7);'],
  ['XIC(PB_Black_1)ONS(Count_ONS)ADD(Press_Count,1,Press_Count);', 'Count presses of black button 1 (one-shot).'],
];

const EXTRA_TAGS: TagDef[] = [
  { name: 'Motor_Run', dataType: 'BOOL', description: 'Motor run command (sealed in)' },
  { name: 'Blink_Timer', dataType: 'TIMER', description: '1 s blink timer' },
  { name: 'Cycle_Count', dataType: 'COUNTER', description: 'Blink cycles' },
  { name: 'Press_Count', dataType: 'DINT', description: 'Black button 1 presses' },
  { name: 'Count_ONS', dataType: 'BOOL', description: 'One-shot storage bit' },
  { name: 'Recipe', dataType: 'DINT', dims: 10, description: 'Recipe values' },
  { name: 'Level_SP', dataType: 'REAL', description: 'Level setpoint (%)', initial: 55.5 },
];

function stressRungs(n: number): Array<[string, string?]> {
  const out: Array<[string, string?]> = [];
  for (let i = 0; i < n; i++) {
    const pat = i % 5;
    if (pat === 0) out.push([`[XIC(Switch_${i % 8}),XIC(Motor_Run)]XIO(Switch_${(i + 3) % 8})OTE(Light_${i % 8});`, i % 10 === 0 ? `Generated rung ${i}` : undefined]);
    else if (pat === 1) out.push([`XIC(Motor_Run)XIO(Blink_Timer.DN)TON(Blink_Timer,1000,0);`]);
    else if (pat === 2) out.push([`XIC(Blink_Timer.TT)LES(Blink_Timer.ACC,${(i * 37) % 1000})OTE(Light_${(i + 1) % 8});`]);
    else if (pat === 3) out.push([`XIC(Switch_${i % 8})XIC(Switch_${(i + 1) % 8})XIO(Switch_${(i + 2) % 8})[OTE(Light_${(i + 2) % 8}),OTE(Buzzer)];`]);
    else out.push([`GRT(Pot_1,${i % 100}.0)MOV(Pot_2,Meter_2);`]);
  }
  return [['[XIC(PB_Green),XIC(Motor_Run)]XIC(PB_Red)OTE(Motor_Run);', 'Seal-in'], ...out];
}

function buildRungs(): Array<[string, string?]> {
  if (P('empty')) return [['']];
  const n = Number(P('rungs'));
  const base = n > 0 ? stressRungs(n) : DEMO_RUNGS;
  if (P('errors')) {
    return [...base.slice(0, 2), ['XIC(Undefined_Tag)TON(Timer_X,?,0);', 'This rung does not verify: unknown tags and a missing preset.'], ['XIC(Switch_1)[OTE(Light_1),];'], ...base.slice(2)];
  }
  if (P('fault')) return [...base, ['XIC(Switch_0)MOV(Recipe[Press_Count],Level_SP);', 'Indirect address: faults when Press_Count is out of range.']];
  return base;
}

function parseSelect(rungs: Rung[], spec: string | null): LadderSelection | null {
  if (!spec) return null;
  const [r, i, o] = spec.split('.').map(Number);
  const rung = rungs[r ?? 0];
  if (!rung) return null;
  if (i === undefined || Number.isNaN(i)) return { rungId: rung.id };
  const instr = instructionsOf(rung.elements)[i];
  if (!instr) return { rungId: rung.id };
  return o === undefined || Number.isNaN(o) ? { rungId: rung.id, elementId: instr.id } : { rungId: rung.id, elementId: instr.id, operandIndex: o };
}

function useSim(): { controller: LogixController; runtime: SimRuntimeEx } {
  return useMemo(() => {
    const src = buildRungs();
    const project = createProjectForScene(trainerLogic, src.map((r) => r[0]), { comments: src.map((r) => r[1]), tags: EXTRA_TAGS });
    const controller = createController(project);
    const runtime = createSimRuntime(controller, trainerLogic) as SimRuntimeEx;
    runtime.setControl('sw3', true);
    runtime.setControl('sw4', true);
    runtime.setControl('sw0', true);
    runtime.setControl('pot1', 62.5);
    runtime.setControl('pot2', 40);
    if (P('forces')) {
      controller.setForce('Switch_5', true);
      controller.enableForces(true);
    }
    controller.requestMode('RUN');
    runtime.step(50);
    runtime.setControl('pb_green', true);
    runtime.step(120);
    runtime.setControl('pb_green', false);
    runtime.step(1730);
    if (P('fault')) {
      controller.tags.writeNumber('Press_Count', 99);
      runtime.step(20);
    }
    return { controller, runtime };
  }, []);
}

function FpsMeter() {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (t: number): void => {
      frames++;
      if (t - last >= 500) {
        setFps(Math.round((frames * 1000) / (t - last)));
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="fixed right-3 bottom-10 z-50 rounded bg-black/70 px-2 py-1 font-mono text-xs text-emerald-300">{fps} fps</div>;
}

/** Tiny field-device strip for the trainer bench (switches, push buttons, pots). */
function TrainerControls({ runtime }: { runtime: SimRuntimeEx }) {
  const [, setTick] = useState(0);
  useEffect(() => runtime.subscribe(() => setTick((t) => t + 1)), [runtime]);
  const sw = Array.from({ length: 8 }, (_, i) => `sw${i}`);
  return (
    <div className="space-y-2 p-2 text-[11px] text-slate-400">
      <div className="flex items-center gap-1.5 font-semibold tracking-wide text-slate-300 uppercase">
        <ToggleLeft size={13} /> Trainer bench
      </div>
      <div className="grid grid-cols-4 gap-1">
        {sw.map((id, i) => {
          const on = runtime.getControl(id) === true;
          return (
            <button
              key={id}
              type="button"
              onClick={() => runtime.setControl(id, !on)}
              className={cn('cursor-pointer rounded border px-1 py-0.5 font-mono text-[10px]', on ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-edge bg-black/20 text-slate-500')}
            >
              SW{i}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-1">
        {[
          ['pb_green', 'Green PB', 'bg-emerald-600'],
          ['pb_red', 'Red PB', 'bg-red-600'],
          ['pb_black1', 'Black 1', 'bg-slate-700'],
          ['pb_black2', 'Black 2', 'bg-slate-700'],
        ].map(([id, label, color]) => (
          <button
            key={id}
            type="button"
            onPointerDown={() => runtime.setControl(id!, true)}
            onPointerUp={() => runtime.setControl(id!, false)}
            onPointerLeave={() => runtime.getControl(id!) && runtime.setControl(id!, false)}
            className={cn('cursor-pointer rounded px-1 py-1 text-[10.5px] font-semibold text-white active:scale-95', color, runtime.getControl(id!) === true && 'ring-2 ring-white/60')}
          >
            {label}
          </button>
        ))}
      </div>
      {['pot1', 'pot2'].map((id) => (
        <label key={id} className="flex items-center gap-2">
          <Gauge size={12} />
          <span className="w-10 shrink-0 font-mono whitespace-nowrap">{id === 'pot1' ? 'Pot 1' : 'Pot 2'}</span>
          <input type="range" min={0} max={100} step={0.5} value={Number(runtime.getControl(id))} onChange={(e) => runtime.setControl(id, Number(e.target.value))} className="flex-1 accent-sky-500" />
          <span className="w-9 text-right font-mono text-slate-300">{Number(runtime.getControl(id)).toFixed(1)}</span>
        </label>
      ))}
    </div>
  );
}

function Demo() {
  const { controller, runtime } = useSim();
  const program = 'MainProgram';
  const routine = 'MainRoutine';
  const [rungs, setRungs] = useState<Rung[]>(() => controller.project.programs[0]!.routines[0]!.rungs);
  const [errors, setErrors] = useState<VerifyError[]>(() => controller.verify());
  const [online, setOnline] = useState(!P('offline'));
  const [orgSel, setOrgSel] = useState<OrganizerSelection>({ kind: 'routine', program, routine });
  const [tagScope, setTagScope] = useState<string>('controller');
  const editorRef = useRef<LadderEditorHandle>(null);
  const initialSel = useMemo(() => parseSelect(rungs, P('select')), []); // eslint-disable-line react-hooks/exhaustive-deps
  const ladderOnly = !!P('ladderOnly');

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number): void => {
      runtime.tick(Math.min(100, t - last));
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const t = window.setTimeout(() => {
      if (P('menu')) ed.openContextMenu();
      if (P('quick') !== null) ed.startQuickEntry(P('quick') ?? '');
      if (P('edit')) ed.editOperand();
      if (P('text') !== null) ed.editRungText(rungs[Number(P('text'))]?.id);
      if (P('comment') !== null) ed.editRungComment(rungs[Number(P('comment'))]?.id);
      if (P('help')) ed.showHelp(P('help')!);
      if (!P('menu') && !P('quick') && !P('edit') && !P('text') && !P('comment')) ed.focus();
    }, 350);
    return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // QA hook: current rungs as neutral text
  (window as unknown as { __ladder?: unknown }).__ladder = { text: () => rungs.map((r) => serializeRung(r)), controller };

  const onChange = (next: Rung[]): void => {
    setRungs(next);
    controller.updateRoutine(program, routine, next); // online edit
    setErrors(controller.verify());
  };

  const onOrganizer = (n: OrganizerNode): void => {
    setOrgSel({ id: n.id });
    if (n.kind === 'controllerTags') setTagScope('controller');
    else if (n.kind === 'programTags' && n.program) setTagScope(n.program);
    else if (n.kind === 'module') toast({ tone: 'info', title: n.label, body: 'Module properties are shown on the 3D rack in the full app.' });
  };

  const errorRoutines = useMemo(() => new Set(errors.filter((e) => e.severity === 'error' && e.rungIndex >= 0).map((e) => `${e.program}/${e.routine}`)), [errors]);
  const allowed = P('allowed')?.split(',').map((s) => s.trim().toUpperCase());

  const editor = (
    <LadderEditor
      ref={editorRef}
      rungs={rungs}
      onChange={onChange}
      program={program}
      routine={routine}
      controller={controller}
      online={online}
      readOnly={!!P('readonly')}
      errors={errors}
      theme={P('theme') === 'classic' ? 'classic' : 'dark'}
      zoom={Number(P('zoom')) || 1}
      initialSelection={initialSel}
      {...(allowed ? { allowedInstructions: allowed } : {})}
      className="min-h-0 flex-1"
    />
  );

  if (ladderOnly) {
    return (
      <div className="flex h-full flex-col">
        {editor}
        {P('rungs') && <FpsMeter />}
        <Toaster />
      </div>
    );
  }

  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr] bg-[#0b0f14] text-slate-200">
      <header className="flex h-9 items-center gap-3 border-b border-edge bg-panel px-3">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-ab-red text-white">
          <Cpu size={13} />
        </span>
        <span className="text-[13px] font-bold tracking-tight">PLC World</span>
        <span className="text-[12px] text-slate-500">Logix Designer — {controller.project.controllerName} · 1756-L85E · trainer bench</span>
        <div className="flex-1" />
        <button type="button" onClick={() => setOnline((o) => !o)} className="cursor-pointer rounded-md border border-edge px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/5">
          {online ? 'Go offline' : 'Go online'}
        </button>
      </header>
      <OnlineToolbar controller={controller} online={online} onGoOffline={() => setOnline(false)} onGoOnline={() => setOnline(true)} allowKeySwitch onModeChange={() => setErrors(controller.verify())} />
      <div className="grid min-h-0 grid-cols-[250px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-edge bg-panel">
          <div className="flex h-8 shrink-0 items-center border-b border-edge px-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Controller Organizer</div>
          <ControllerOrganizer project={controller.project} selected={orgSel} onSelect={onOrganizer} errorRoutines={errorRoutines} className="flex-1" />
          <div className="shrink-0 border-t border-edge">
            <TrainerControls runtime={runtime} />
          </div>
        </aside>
        <main className="grid min-h-0 grid-rows-[1fr_minmax(180px,34%)]">
          <div className="flex min-h-0 flex-col">{editor}</div>
          <TagMonitor
            key={tagScope}
            controller={controller}
            initialScope={tagScope}
            initialTab={P('tags') === 'edit' ? 'edit' : 'monitor'}
            onTagsChanged={() => setErrors(controller.verify())}
            className="min-h-0 border-t border-edge"
          />
        </main>
      </div>
      {P('rungs') && <FpsMeter />}
      <Toaster />
    </div>
  );
}

// reuse the root when Vite re-executes this entry module (hot updates of dependencies)
const holder = window as unknown as { __editorDemoRoot?: Root };
holder.__editorDemoRoot ??= createRoot(document.getElementById('root')!);
holder.__editorDemoRoot.render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
