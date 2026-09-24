/**
 * Ladder execution engine: compiles routines into trees of closures bound to resolved operands and
 * executes them with Logix power-flow semantics.
 *
 *  - A rung starts with rung-condition-in = true (false inside a disabled MCR zone).
 *  - Series elements pass their rung-condition-out to the next element.
 *  - Every leg of a branch receives the same rung-condition-in; the branch output is the OR of its legs.
 *    All legs are always executed (outputs on false legs are still written false).
 *  - Program control (JSR/RET/JMP/TND) is signalled to the routine loop. RET and TND end the current
 *    routine (a subroutine returns to its caller, a main routine hands over to the next program).
 *  - S:FS is set while a program executes for the first time after entering Run (per program).
 *
 * Live animation state is written into persistent `RoutineLiveState` objects (no per-scan allocation).
 */
import { takeOverflow } from './convert';
import { PlcFault, faultText } from './errors';
import { compileOperandsFor, getInstruction, type CompileEnv, type ExecInstr, type Runtime } from './instructions';
import type { LogixTagDatabase, OperandRef } from './tags';
import type {
  BranchNode as BranchAst,
  ElementLiveState,
  FaultRecord,
  InstructionNode,
  Program,
  Project,
  Routine,
  RoutineLiveState,
  RungElement,
  TagValue,
  Task,
} from './types';

const SIG_NONE = 0;
const SIG_JMP = 1;
const SIG_RET = 2;
const SIG_TND = 3;

/** Nesting depth of JSR calls before a stack overflow fault (T04:C84). */
export const MAX_JSR_DEPTH = 32;
/** Rung executions per scan before the task watchdog trips (catches endless JMP loops). */
export const MAX_RUNGS_PER_SCAN = 200_000;

const lower = (s: string): string => s.toLowerCase();

interface CNode {
  run(rci: boolean): boolean;
  pre(): void;
  mon(): void;
  off(): void;
}

function clearLive(l: ElementLiveState): void {
  l.in = false;
  l.out = false;
  l.active = false;
}

class InstrNode implements CNode {
  private readonly eng: Engine;
  private readonly id: string;
  private readonly x: ExecInstr;
  private readonly live: ElementLiveState;
  private readonly cost: number;

  constructor(eng: Engine, id: string, x: ExecInstr, live: ElementLiveState, costMs: number) {
    this.eng = eng;
    this.id = id;
    this.x = x;
    this.live = live;
    this.cost = costMs;
  }

  run(rci: boolean): boolean {
    const e = this.eng;
    e.elementId = this.id;
    e.cost += this.cost;
    const l = this.live;
    l.in = rci;
    l.active = rci;
    const out = this.x.exec(rci, l);
    l.out = out;
    return out;
  }

  pre(): void {
    clearLive(this.live);
    if (!this.x.prescan) return;
    this.eng.elementId = this.id;
    try {
      this.x.prescan();
    } catch {
      // Faults are not raised during prescan (e.g. indirect subscripts evaluated before logic ran).
    }
  }

  mon(): void {
    const l = this.live;
    l.in = false;
    l.out = false;
    l.active = this.x.monitor ? this.x.monitor() : false;
  }

  off(): void {
    clearLive(this.live);
  }
}

/** Placeholder for an instruction that failed to compile. */
class DeadNode implements CNode {
  private readonly live: ElementLiveState;
  constructor(live: ElementLiveState) {
    this.live = live;
  }
  run(): boolean {
    clearLive(this.live);
    return false;
  }
  pre(): void {
    clearLive(this.live);
  }
  mon(): void {
    clearLive(this.live);
  }
  off(): void {
    clearLive(this.live);
  }
}

class SeriesNode implements CNode {
  private readonly nodes: CNode[];
  constructor(nodes: CNode[]) {
    this.nodes = nodes;
  }
  run(rci: boolean): boolean {
    let c = rci;
    const ns = this.nodes;
    for (let i = 0; i < ns.length; i++) c = ns[i]!.run(c);
    return c;
  }
  pre(): void {
    for (const n of this.nodes) n.pre();
  }
  mon(): void {
    for (const n of this.nodes) n.mon();
  }
  off(): void {
    for (const n of this.nodes) n.off();
  }
}

class ParallelNode implements CNode {
  private readonly legs: SeriesNode[];
  private readonly live: ElementLiveState;
  constructor(legs: SeriesNode[], live: ElementLiveState) {
    this.legs = legs;
    this.live = live;
  }
  run(rci: boolean): boolean {
    let out = false;
    const legs = this.legs;
    for (let i = 0; i < legs.length; i++) if (legs[i]!.run(rci)) out = true;
    const l = this.live;
    l.in = rci;
    l.out = out;
    l.active = out;
    return out;
  }
  pre(): void {
    clearLive(this.live);
    for (const leg of this.legs) leg.pre();
  }
  mon(): void {
    clearLive(this.live);
    for (const leg of this.legs) leg.mon();
  }
  off(): void {
    clearLive(this.live);
    for (const leg of this.legs) leg.off();
  }
}

/** A rung with verification errors: it is not executed (all elements shown de-energized). */
class DisabledRung implements CNode {
  private readonly inner: CNode;
  constructor(inner: CNode) {
    this.inner = inner;
  }
  run(): boolean {
    this.inner.off();
    return false;
  }
  pre(): void {
    this.inner.off();
  }
  mon(): void {
    this.inner.off();
  }
  off(): void {
    this.inner.off();
  }
}

interface CompiledRung {
  body: CNode;
  ok: boolean;
  errors: string[];
}

/**
 * Instruction-box initialiser (TON Preset → .PRE…). `key` identifies the target storage object, member
 * and literal: it is re-applied on a recompile only when that combination is new (literal edited, rung
 * newly compiled, or the tag storage was re-created), never for unchanged instructions.
 */
interface BoxInit {
  key: string;
  apply(): void;
}

interface CompiledRoutine {
  name: string;
  program: string;
  rungs: CompiledRung[];
  labels: Map<string, number>;
  live: RoutineLiveState;
  downloadInits: Array<() => void>;
  editInits: BoxInit[];
}

interface ProgramUnit {
  /** Lower-case program name. */
  key: string;
  name: string;
  def: Program;
  routines: Map<string, CompiledRoutine>;
  main: CompiledRoutine | undefined;
}

interface Inits {
  download: Array<() => void>;
  edit: BoxInit[];
}

interface Frame {
  inputs: readonly number[];
  returnValues: readonly number[] | null;
  sbrDone: boolean;
}

/** Location of the instruction being executed (for fault records). */
export interface ExecLocation {
  program?: string;
  routine?: string;
  rungIndex?: number;
  elementId?: string;
}

/** Callback used to log minor faults. */
export type MinorFaultSink = (fault: Omit<FaultRecord, 'timeMs'>) => void;

const DUMMY_FLAG: OperandRef = {
  path: '',
  type: 'BOOL',
  dims: undefined,
  array: undefined,
  constant: false,
  scope: '#sys',
  dynamic: false,
  isBit: false,
  real: false,
  readB: () => false,
  writeB: () => undefined,
  readN: () => 0,
  writeN: () => undefined,
  value: () => false,
  assign: () => undefined,
  arrayLoc: () => ({ arr: [], index: 0 }),
};

export class Engine implements Runtime {
  readonly db: LogixTagDatabase;
  now = 0;
  readonly timerStamps = new WeakMap<object, number>();
  /** Simulated execution cost (ms) accumulated in the current scan. */
  cost = 0;
  /** Task watchdog (ms). */
  watchdogMs = 500;
  elementId: string | undefined;
  onMinorFault: MinorFaultSink = () => undefined;

  private readonly programs = new Map<string, ProgramUnit>();
  private readonly liveMap = new Map<string, RoutineLiveState>();
  private continuous: Task | undefined;
  private periodic: Task[] = [];
  private readonly periodicAcc = new Map<string, number>();
  private program: ProgramUnit | undefined;
  private routine: CompiledRoutine | undefined;
  private rungIndex = -1;
  private rungCount = 0;
  private signal = SIG_NONE;
  private jmpLabel = '';
  private depth = 0;
  private readonly frames: Frame[] = [];
  private mcrInZone = false;
  private mcrFalse = false;
  private readonly prescanned = new Set<CompiledRoutine>();
  /** Programs (lower-case names) that have not executed yet since entering Run (S:FS). */
  private readonly firstScanPending = new Set<string>();
  /** Edit-initialiser keys of the last compile (see `BoxInit`). */
  private syncedInits = new Set<string>();
  private readonly objIds = new WeakMap<object, number>();
  private nextObjId = 1;
  private sFS = DUMMY_FLAG;
  private sN = DUMMY_FLAG;
  private sZ = DUMMY_FLAG;
  private sV = DUMMY_FLAG;
  private sMinor = DUMMY_FLAG;

  constructor(db: LogixTagDatabase) {
    this.db = db;
  }

  // -------------------------------------------------------------------------
  // Compilation
  // -------------------------------------------------------------------------

  /** Compile every program of a project (live-state objects are preserved by routine name / element id). */
  compileProject(project: Project): void {
    this.sFS = this.db.tryRef('S:FS') ?? DUMMY_FLAG;
    this.sN = this.db.tryRef('S:N') ?? DUMMY_FLAG;
    this.sZ = this.db.tryRef('S:Z') ?? DUMMY_FLAG;
    this.sV = this.db.tryRef('S:V') ?? DUMMY_FLAG;
    this.sMinor = this.db.tryRef('S:MINOR') ?? DUMMY_FLAG;
    this.programs.clear();
    for (const p of project.programs) this.programs.set(lower(p.name), this.compileProgram(p));
    this.continuous = project.tasks.find((t) => t.type === 'CONTINUOUS');
    this.periodic = project.tasks
      .filter((t) => t.type === 'PERIODIC' && (t.periodMs ?? 0) > 0)
      .sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));
    const keep = new Set<string>();
    for (const p of project.programs) for (const r of p.routines) keep.add(this.liveKey(p.name, r.name));
    for (const k of [...this.liveMap.keys()]) if (!keep.has(k)) this.liveMap.delete(k);
  }

  private liveKey(program: string, routine: string): string {
    return `${lower(program)}\u0000${lower(routine)}`;
  }

  private liveFor(program: string, routine: string): RoutineLiveState {
    const key = this.liveKey(program, routine);
    let l = this.liveMap.get(key);
    if (!l) {
      l = { elements: {}, rungs: [] };
      this.liveMap.set(key, l);
    }
    return l;
  }

  private compileProgram(p: Program): ProgramUnit {
    const unit: ProgramUnit = { key: lower(p.name), name: p.name, def: p, routines: new Map(), main: undefined };
    for (const r of p.routines) unit.routines.set(lower(r.name), this.compileRoutine(p, r));
    unit.main = unit.routines.get(lower(p.mainRoutine));
    return unit;
  }

  private compileRoutine(p: Program, r: Routine): CompiledRoutine {
    const live = this.liveFor(p.name, r.name);
    const labels = new Map<string, number>();
    r.rungs.forEach((rung, i) => {
      const first = rung.elements[0];
      if (first?.kind === 'instr' && first.op === 'LBL' && first.operands[0]) {
        const k = lower(first.operands[0].trim());
        if (!labels.has(k)) labels.set(k, i);
      }
    });
    // Routine / label targets are resolved at run time so that a JSR to a missing routine or a JMP to a
    // missing label raises the authentic major fault (T04:C31 / T04:C42) instead of disabling the rung.
    // verify() checks them statically and refuses Run.
    const env: CompileEnv = {
      db: this.db,
      program: p.name,
      hasRoutine: () => true,
      hasLabel: () => true,
    };
    const seen = new Set<string>();
    const downloadInits: Array<() => void> = [];
    const editInits: BoxInit[] = [];
    const rungs = r.rungs.map((rung) => {
      const errors: string[] = [];
      const inits: Inits = { download: [], edit: [] };
      const body = this.compileSeries(rung.elements, env, live, seen, errors, inits);
      if (errors.length > 0) return { body: new DisabledRung(body), ok: false, errors };
      downloadInits.push(...inits.download);
      editInits.push(...inits.edit);
      return { body: body as CNode, ok: true, errors };
    });
    for (const id of Object.keys(live.elements)) if (!seen.has(id)) delete live.elements[id];
    live.rungs.length = r.rungs.length;
    live.rungs.fill(false);
    return { name: r.name, program: p.name, rungs, labels, live, downloadInits, editInits };
  }

  private elementLive(live: RoutineLiveState, id: string, seen: Set<string>): ElementLiveState {
    seen.add(id);
    let l = live.elements[id];
    if (!l) {
      l = { in: false, out: false, active: false };
      live.elements[id] = l;
    }
    return l;
  }

  private compileSeries(
    elements: RungElement[],
    env: CompileEnv,
    live: RoutineLiveState,
    seen: Set<string>,
    errors: string[],
    inits: Inits,
  ): SeriesNode {
    return new SeriesNode(
      elements.map((el) =>
        el.kind === 'instr'
          ? this.compileInstr(el, env, live, seen, errors, inits)
          : this.compileBranch(el, env, live, seen, errors, inits),
      ),
    );
  }

  private compileBranch(
    el: BranchAst,
    env: CompileEnv,
    live: RoutineLiveState,
    seen: Set<string>,
    errors: string[],
    inits: Inits,
  ): CNode {
    const l = this.elementLive(live, el.id, seen);
    return new ParallelNode(
      el.legs.map((leg) => this.compileSeries(leg, env, live, seen, errors, inits)),
      l,
    );
  }

  private compileInstr(
    node: InstructionNode,
    env: CompileEnv,
    live: RoutineLiveState,
    seen: Set<string>,
    errors: string[],
    inits: Inits,
  ): CNode {
    const l = this.elementLive(live, node.id, seen);
    const def = getInstruction(node.op);
    if (!def) {
      errors.push(`Unknown instruction '${node.op}'.`);
      return new DeadNode(l);
    }
    const { ops, issues } = compileOperandsFor(def, node, env);
    if (!ops) {
      errors.push(...issues.map((i) => i.message));
      return new DeadNode(l);
    }
    let x: ExecInstr;
    try {
      x = def.compile(ops, this);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return new DeadNode(l);
    }
    def.operands.forEach((spec, i) => {
      if (spec.kind !== 'display' || !spec.init) return;
      const v = ops.literal(i);
      const target = ops.items[spec.init.operand];
      if (v === undefined || target?.k !== 'ref' || target.ref.dynamic) return;
      const ref = target.ref;
      const member = spec.init.member;
      const apply = (): void => {
        const s = ref.value();
        if (typeof s === 'object' && !Array.isArray(s)) (s as Record<string, TagValue>)[member] = v;
      };
      inits.download.push(apply);
      if (spec.init.onEdit) {
        const storage = ref.value();
        if (typeof storage === 'object') inits.edit.push({ key: `${this.objectId(storage)}\u0000${member}\u0000${v}`, apply });
      }
    });
    return new InstrNode(this, node.id, x, l, def.costUs / 1000);
  }

  private objectId(o: object): number {
    let id = this.objIds.get(o);
    if (id === undefined) {
      id = this.nextObjId++;
      this.objIds.set(o, id);
    }
    return id;
  }

  /**
   * Download: apply every instruction-box value (TON Preset and Accum, SQO Length and Position…) to its
   * tag, as a download of the project does.
   */
  applyDownloadInitializers(): void {
    const keys = new Set<string>();
    for (const unit of this.programs.values()) {
      for (const r of unit.routines.values()) {
        for (const fn of r.downloadInits) fn();
        for (const init of r.editInits) keys.add(init.key);
      }
    }
    this.syncedInits = keys;
  }

  /**
   * After a recompile (online edit, tag created/deleted): write the Preset/Length box values only of
   * instructions that are new to their tag — a literal that was edited, a rung that compiles for the
   * first time (e.g. TON typed before its TIMER tag existed) or a tag whose storage was re-created.
   * Values that logic wrote into unchanged instructions' tags are left alone, as on a real controller.
   */
  syncEditInitializers(): void {
    const prev = this.syncedInits;
    const next = new Set<string>();
    for (const unit of this.programs.values()) {
      for (const r of unit.routines.values()) {
        for (const init of r.editInits) {
          if (!prev.has(init.key)) init.apply();
          next.add(init.key);
        }
      }
    }
    this.syncedInits = next;
  }

  /** Compile errors per rung (for diagnostics); verify() reports the same problems. */
  compileErrors(): Array<{ program: string; routine: string; rungIndex: number; errors: string[] }> {
    const out: Array<{ program: string; routine: string; rungIndex: number; errors: string[] }> = [];
    for (const unit of this.programs.values()) {
      for (const r of unit.routines.values()) {
        r.rungs.forEach((rung, i) => {
          if (!rung.ok) out.push({ program: unit.name, routine: r.name, rungIndex: i, errors: rung.errors });
        });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Live state
  // -------------------------------------------------------------------------

  private findRoutine(program: string, routine: string): CompiledRoutine | undefined {
    return this.programs.get(lower(program))?.routines.get(lower(routine));
  }

  getLive(program: string, routine: string): RoutineLiveState | undefined {
    return this.findRoutine(program, routine)?.live;
  }

  /** Refresh highlight state from tag data while logic is not executing (online, Program mode). */
  monitor(program: string, routine: string): void {
    const r = this.findRoutine(program, routine);
    if (!r) return;
    r.rungs.forEach((rung, i) => {
      rung.body.mon();
      r.live.rungs[i] = false;
    });
  }

  /** De-energize every element of every routine (leaving Run mode). */
  clearAllLive(): void {
    for (const unit of this.programs.values()) {
      for (const r of unit.routines.values()) {
        for (const rung of r.rungs) rung.body.off();
        r.live.rungs.fill(false);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  location(): ExecLocation {
    return {
      ...(this.program ? { program: this.program.name } : {}),
      ...(this.routine ? { routine: this.routine.name } : {}),
      ...(this.rungIndex >= 0 ? { rungIndex: this.rungIndex } : {}),
      ...(this.elementId !== undefined ? { elementId: this.elementId } : {}),
    };
  }

  private scheduledPrograms(): ProgramUnit[] {
    const out: ProgramUnit[] = [];
    for (const t of [...this.periodic, ...(this.continuous ? [this.continuous] : [])]) {
      for (const name of t.programs) {
        const unit = this.programs.get(lower(name));
        if (unit && !unit.def.inhibited && unit.main && !out.includes(unit)) out.push(unit);
      }
    }
    return out;
  }

  /** Logix prescan: every scheduled program's main routine (and each JSR target once) is prescanned. */
  prescanAll(): void {
    this.prescanned.clear();
    this.resetScanState();
    this.periodicAcc.clear();
    this.firstScanPending.clear();
    for (const unit of this.scheduledPrograms()) {
      this.program = unit;
      this.firstScanPending.add(unit.key);
      this.prescanRoutineUnit(unit.main!);
    }
    this.program = undefined;
    this.routine = undefined;
    this.rungIndex = -1;
    this.elementId = undefined;
  }

  private prescanRoutineUnit(r: CompiledRoutine): void {
    if (this.prescanned.has(r)) return;
    this.prescanned.add(r);
    const prev = this.routine;
    this.routine = r;
    r.rungs.forEach((rung, i) => {
      this.rungIndex = i;
      rung.body.pre();
      r.live.rungs[i] = false;
    });
    this.routine = prev;
  }

  private resetScanState(): void {
    this.cost = 0;
    this.rungCount = 0;
    this.signal = SIG_NONE;
    this.depth = 0;
    this.mcrInZone = false;
    this.mcrFalse = false;
  }

  /** Execute one scan of all scheduled tasks. `dtMs` drives periodic task scheduling. */
  runScan(dtMs: number): void {
    this.resetScanState();
    for (const t of this.periodic) {
      const period = t.periodMs!;
      let acc = (this.periodicAcc.get(t.name) ?? 0) + dtMs;
      if (acc >= period) {
        acc -= period;
        if (acc >= period) acc %= period;
        this.periodicAcc.set(t.name, acc);
        this.runTask(t);
      } else this.periodicAcc.set(t.name, acc);
    }
    if (this.continuous) this.runTask(this.continuous);
    this.program = undefined;
    this.routine = undefined;
    this.rungIndex = -1;
    this.elementId = undefined;
  }

  private runTask(task: Task): void {
    for (const name of task.programs) {
      const unit = this.programs.get(lower(name));
      if (!unit || unit.def.inhibited || !unit.main) continue;
      this.program = unit;
      this.depth = 0;
      this.signal = SIG_NONE;
      // S:FS is set during the first scan of the routines of each program after entering Run.
      if (this.firstScanPending.size !== 0 && this.firstScanPending.delete(unit.key)) {
        this.sFS.writeB(true);
        this.runRoutine(unit.main);
        this.sFS.writeB(false);
      } else {
        this.runRoutine(unit.main);
      }
    }
  }

  private runRoutine(r: CompiledRoutine): void {
    this.routine = r;
    this.mcrInZone = false;
    this.mcrFalse = false;
    const rungs = r.rungs;
    const liveRungs = r.live.rungs;
    const n = rungs.length;
    let i = 0;
    while (i < n) {
      if (++this.rungCount > MAX_RUNGS_PER_SCAN || this.cost > this.watchdogMs) this.majorFault(6, 1);
      this.rungIndex = i;
      this.elementId = undefined;
      const out = rungs[i]!.body.run(!this.mcrFalse);
      liveRungs[i] = out;
      const sig = this.signal;
      if (sig !== SIG_NONE) {
        if (sig === SIG_JMP) {
          this.signal = SIG_NONE;
          const target = r.labels.get(lower(this.jmpLabel));
          if (target === undefined) {
            this.majorFault(4, 42, `JMP to label '${this.jmpLabel}' that does not exist in routine '${r.name}'.`);
          }
          for (let k = i + 1; k < target; k++) {
            rungs[k]!.body.off();
            liveRungs[k] = false;
          }
          i = target;
          continue;
        }
        // RET / TND: end of this routine (back to the calling JSR, or on to the next program).
        this.signal = SIG_NONE;
        for (let k = i + 1; k < n; k++) {
          rungs[k]!.body.off();
          liveRungs[k] = false;
        }
        return;
      }
      i++;
    }
  }

  // -------------------------------------------------------------------------
  // Runtime services (called by instructions)
  // -------------------------------------------------------------------------

  arith(result: number, overflow: boolean): void {
    this.sN.writeB(result < 0);
    this.sZ.writeB(result === 0);
    this.sV.writeB(overflow);
    if (overflow) this.minorFault(4, 4, 'Arithmetic overflow. An arithmetic instruction generated an overflow.');
  }

  minorFault(type: number, code: number, message: string): void {
    this.sMinor.writeB(true);
    this.onMinorFault({ type, code, message, ...this.location() });
  }

  majorFault(type: number, code: number, message?: string): never {
    throw new PlcFault(type, code, message ?? faultText(type, code));
  }

  private frameAt(depth: number): Frame {
    let f = this.frames[depth];
    if (!f) {
      f = { inputs: [], returnValues: null, sbrDone: false };
      this.frames[depth] = f;
    }
    return f;
  }

  jsr(routine: string, inputs: readonly number[], returns: readonly OperandRef[]): void {
    const unit = this.program;
    const target = unit?.routines.get(lower(routine));
    if (!unit || !target) {
      this.majorFault(4, 31, `JSR to routine '${routine}' that does not exist in program '${unit?.name ?? '?'}'.`);
    }
    if (this.depth >= MAX_JSR_DEPTH) {
      this.majorFault(4, 84, `Stack overflow: JSR nesting deeper than ${MAX_JSR_DEPTH} levels (routine '${routine}').`);
    }
    const frame = this.frameAt(this.depth);
    frame.inputs = inputs;
    frame.returnValues = null;
    frame.sbrDone = false;
    const prevRoutine = this.routine;
    const prevRung = this.rungIndex;
    const prevElement = this.elementId;
    const prevZone = this.mcrInZone;
    const prevFalse = this.mcrFalse;
    // A JMP/RET/TND earlier on the calling rung is still pending: it belongs to the caller and must not
    // act inside the subroutine. The subroutine's own signals are consumed by its routine loop.
    const prevSignal = this.signal;
    const prevLabel = this.jmpLabel;
    this.signal = SIG_NONE;
    this.depth++;
    this.runRoutine(target);
    this.depth--;
    this.signal = prevSignal;
    this.jmpLabel = prevLabel;
    this.routine = prevRoutine;
    this.rungIndex = prevRung;
    this.elementId = prevElement;
    this.mcrInZone = prevZone;
    this.mcrFalse = prevFalse;
    if (inputs.length > 0 && !frame.sbrDone) {
      this.majorFault(4, 31, `JSR passes ${inputs.length} input parameter(s) but routine '${routine}' has no SBR to receive them.`);
    }
    if (returns.length > 0) {
      // (set by RET during runRoutine — widen the type narrowed by the assignment above)
      const vals = frame.returnValues as readonly number[] | null;
      if (!vals || vals.length < returns.length) {
        this.majorFault(4, 31, `JSR expects ${returns.length} return parameter(s) but routine '${routine}' returned ${vals?.length ?? 0}.`);
      }
      for (let i = 0; i < returns.length; i++) returns[i]!.writeN(vals[i]!);
      takeOverflow();
    }
  }

  sbr(params: readonly OperandRef[]): void {
    if (this.depth === 0) return;
    const frame = this.frames[this.depth - 1]!;
    if (frame.inputs.length !== params.length) {
      this.majorFault(4, 31, `SBR has ${params.length} parameter(s) but the JSR passed ${frame.inputs.length}.`);
    }
    for (let i = 0; i < params.length; i++) params[i]!.writeN(frame.inputs[i]!);
    takeOverflow();
    frame.sbrDone = true;
  }

  ret(values: readonly number[]): void {
    if (this.depth > 0) this.frames[this.depth - 1]!.returnValues = values;
    this.signal = SIG_RET;
  }

  jmp(label: string): void {
    this.jmpLabel = label;
    this.signal = SIG_JMP;
  }

  tnd(): void {
    this.signal = SIG_TND;
  }

  mcr(rci: boolean): void {
    if (!this.mcrInZone) {
      this.mcrInZone = true;
      this.mcrFalse = !rci;
    } else {
      this.mcrInZone = false;
      this.mcrFalse = false;
    }
  }

  prescanRoutine(routine: string): void {
    const target = this.program?.routines.get(lower(routine));
    if (target) this.prescanRoutineUnit(target);
  }
}
