/**
 * The simulated Logix 5000 controller (1756-L8x ControlLogix 5580 / 5069-L3x CompactLogix 5380).
 *
 *   const plc = createController(project);     // key REM, mode REM_PROG
 *   plc.requestMode('RUN');                     // refused while verify() reports errors
 *   plc.writeInputFromField('Local:1:I.Data.0', true);
 *   plc.scan(10);
 *   plc.readOutputForField('Local:2:O.Data.0');
 *
 * Scan cycle (`scan(dtMs)`): apply input forces → (running) prescan on the first scan after entering
 * Run, S:FS, execute periodic + continuous tasks → apply output forces → update module status/echo.
 * Major faults stop logic (mode FAULTED); minor faults are logged and execution continues.
 * `scan()` never throws.
 */
import {
  controllerModule,
  hasIoModules,
  ioEchoPairs,
  ioKindOfPath,
  ioTagsForHardware,
  runModeOperands,
} from './catalog';
import { isNumericType, takeOverflow } from './convert';
import { Engine } from './engine';
import { PlcFault, faultId } from './errors';
import { createTagDatabase, type LogixTagDatabase, type OperandRef } from './tags';
import type {
  ControllerEvent,
  ControllerMode,
  ControllerStatus,
  FaultRecord,
  KeySwitch,
  PlcController,
  Program,
  Project,
  RoutineLiveState,
  Rung,
  TagDef,
  VerifyError,
} from './types';
import { verifyProject } from './verify';

/** Controller with a few runtime extras beyond the shared `PlcController` contract. */
export interface LogixController extends PlcController {
  readonly tags: LogixTagDatabase;
  getForce(operand: string, program?: string): boolean | number | undefined;
  /** Clear the minor fault log. */
  clearMinorFaults(): void;
  /** Reset every tag to its initial value (like re-downloading) without changing the mode. */
  resetTagValues(): void;
}

export interface ControllerOptions {
  /** Task watchdog in ms (default 500). Exceeding it faults the controller with T06:C01. */
  watchdogMs?: number;
}

/** Controller status flags available to logic, e.g. XIC(S:FS). */
export const SYSTEM_FLAGS: readonly TagDef[] = [
  { name: 'S:FS', dataType: 'BOOL', constant: true, description: 'First scan: set during the first scan after entering Run mode' },
  { name: 'S:N', dataType: 'BOOL', description: 'Negative: result of the last math/move instruction was negative' },
  { name: 'S:Z', dataType: 'BOOL', description: 'Zero: result of the last math/move instruction was zero' },
  { name: 'S:V', dataType: 'BOOL', description: 'Overflow: the last math/move instruction overflowed' },
  { name: 'S:C', dataType: 'BOOL', description: 'Carry' },
  { name: 'S:MINOR', dataType: 'BOOL', description: 'A minor fault occurred during this scan' },
];

/** Fixed overhead of a scan (I/O update, housekeeping) in ms. */
const BASE_SCAN_MS = 0.15;
const MAX_MINOR_FAULTS = 16;

interface ForceEntry {
  ref: OperandRef;
  value: boolean | number;
  dir: 'I' | 'O';
}

const lower = (s: string): string => s.toLowerCase();
const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

class LogixControllerImpl implements LogixController {
  readonly tags: LogixTagDatabase = createTagDatabase();
  private readonly engine: Engine;
  private proj!: Project;

  private key: KeySwitch = 'REM';
  private mode: ControllerMode = 'REM_PROG';
  private major: FaultRecord | undefined;
  private minors: FaultRecord[] = [];
  private readonly forces = new Map<string, ForceEntry>();
  private forcesOn = false;
  private readonly fieldShadow = new Map<string, boolean | number>();
  private readonly listeners = new Set<(e: ControllerEvent) => void>();

  private scanCount = 0;
  private lastScanMs = 0;
  private maxScanMs = 0;
  private uptimeMs = 0;
  private firstScan = false;
  private needsPrescan = false;

  private compiledStructure = -1;
  private readonly fieldRefs = new Map<string, OperandRef | null>();
  private echoRefs: Array<{ out: OperandRef; echo: OperandRef }> = [];
  private runModeRefs: OperandRef[] = [];
  private sFS: OperandRef | undefined;
  private sMinor: OperandRef | undefined;
  private hwHasIo = false;
  private speedFactor = 1;
  private readonly warned = new Set<string>();

  constructor(project: Project, options: ControllerOptions) {
    this.engine = new Engine(this.tags);
    if (options.watchdogMs !== undefined) this.engine.watchdogMs = options.watchdogMs;
    this.engine.onMinorFault = (f) => this.logMinor(f);
    this.loadProject(project);
  }

  get project(): Project {
    return this.proj;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  subscribe(listener: (e: ControllerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(e: ControllerEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        console.error('[plc] controller event listener failed', err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------

  private isRunning(): boolean {
    return this.mode === 'RUN' || this.mode === 'REM_RUN';
  }

  /** Switch the mode (internal state only, no event). Returns true when the mode changed. */
  private applyMode(next: ControllerMode): boolean {
    if (next === this.mode) return false;
    const was = this.isRunning();
    this.mode = next;
    const now = this.isRunning();
    if (!was && now) this.needsPrescan = true;
    if (was && !now) {
      this.engine.clearAllLive();
      this.firstScan = false;
      this.sFS?.writeB(false);
    }
    return true;
  }

  private setMode(next: ControllerMode): void {
    if (this.applyMode(next)) this.emit({ type: 'mode', mode: next });
  }

  setKeySwitch(pos: KeySwitch): void {
    if (pos === this.key) return;
    this.key = pos;
    if (this.mode === 'FAULTED') {
      // Turning the key to PROG clears a (recoverable) major fault, as on the real controller.
      if (pos === 'PROG') {
        this.major = undefined;
        this.setMode('PROG');
      } else this.emit({ type: 'mode', mode: this.mode });
      return;
    }
    if (pos === 'RUN') this.setMode('RUN');
    else if (pos === 'PROG') this.setMode('PROG');
    else this.setMode(this.mode === 'RUN' ? 'REM_RUN' : 'REM_PROG');
  }

  requestMode(mode: 'RUN' | 'PROG'): boolean {
    if (this.key !== 'REM' || this.mode === 'FAULTED') return false;
    if (mode === 'RUN') {
      if (this.verify().some((e) => e.severity === 'error')) return false;
      this.setMode('REM_RUN');
    } else this.setMode('REM_PROG');
    return true;
  }

  clearMajorFault(): void {
    const wasFaulted = this.mode === 'FAULTED';
    this.major = undefined;
    if (wasFaulted) this.setMode(this.key === 'REM' ? 'REM_PROG' : 'PROG');
  }

  clearMinorFaults(): void {
    this.minors = [];
    this.sMinor?.writeB(false);
  }

  // -------------------------------------------------------------------------
  // Project
  // -------------------------------------------------------------------------

  /**
   * Download. Refused (throws) with the key switch in RUN: Logix Designer can only download with the key
   * in REM or PROG. Key PROG → PROG, key REM → REM_PROG.
   */
  loadProject(project: Project): void {
    if (this.key === 'RUN') {
      throw new Error('Cannot download to the controller: the key switch is in RUN. Turn the key switch to REM or PROG, then download again.');
    }
    this.proj = structuredClone(project);
    this.forces.clear();
    this.forcesOn = false;
    this.fieldShadow.clear();
    this.rebuildTags();
    this.engine.compileProject(this.proj);
    this.engine.applyDownloadInitializers();
    this.compiledStructure = this.tags.structureVersion;
    this.refreshRefs();
    this.major = undefined;
    this.minors = [];
    this.scanCount = 0;
    this.lastScanMs = 0;
    this.maxScanMs = 0;
    this.firstScan = false;
    this.needsPrescan = false;
    this.sFS?.writeB(false);
    const mode: ControllerMode = this.key === 'PROG' ? 'PROG' : 'REM_PROG';
    const changed = mode !== this.mode;
    this.mode = mode;
    this.engine.clearAllLive();
    this.emit({ type: 'project' });
    this.emit({ type: 'forces' });
    if (changed) this.emit({ type: 'mode', mode });
  }

  /**
   * Rebuild the tag database from the project. Definitions that cannot be created are skipped here;
   * `verify()` re-evaluates and reports them (and broken aliases) every time it runs, so fixing a tag
   * online clears the error.
   */
  private rebuildTags(): void {
    const db = this.tags;
    const p = this.proj;
    db.clear();
    for (const t of p.dataTypes ?? []) {
      try {
        db.registerDataType(t);
      } catch {
        // reported by verify()
      }
    }
    const io = ioTagsForHardware(p.hardware);
    for (const t of io.types) db.registerDataType(t);
    for (const t of io.tags) db.define(t);
    for (const f of SYSTEM_FLAGS) db.defineSystem(f);
    const define = (def: TagDef, program?: string): void => {
      if (def.system) return; // reported by verify()
      try {
        db.define(def, program);
      } catch {
        // reported by verify()
      }
    };
    for (const def of p.tags) define(def);
    for (const prog of p.programs) for (const def of prog.tags) define(def, prog.name);
    this.hwHasIo = hasIoModules(p.hardware);
    const cpu = controllerModule(p.hardware);
    this.speedFactor = cpu?.catalog.startsWith('5069-') ? 1.6 : 1;
  }

  /** Re-resolve cached accessors after the tag structure changed. */
  private refreshRefs(): void {
    const db = this.tags;
    this.fieldRefs.clear();
    this.sFS = db.tryRef('S:FS');
    this.sMinor = db.tryRef('S:MINOR');
    this.echoRefs = [];
    for (const { output, echo } of ioEchoPairs(this.proj.hardware)) {
      const out = db.tryRef(output);
      const e = db.tryRef(echo);
      if (out && e) this.echoRefs.push({ out, echo: e });
    }
    this.runModeRefs = runModeOperands(this.proj.hardware)
      .map((o) => db.tryRef(o))
      .filter((r): r is OperandRef => r !== undefined);
    for (const [path, f] of [...this.forces]) {
      const r = db.tryRef(path);
      if (r) f.ref = r;
      else this.forces.delete(path);
    }
    this.installForceOverlay();
  }

  /**
   * Recompile the project after an online edit or a tag structure change. Instruction-box presets and
   * lengths are written only for instructions that are new to their tag (edited literal, rung that
   * compiles for the first time, re-created tag) — values set by logic are kept.
   */
  private recompile(): void {
    this.engine.compileProject(this.proj);
    this.engine.syncEditInitializers();
    this.compiledStructure = this.tags.structureVersion;
    this.refreshRefs();
  }

  private ensureCompiled(): void {
    if (this.tags.structureVersion !== this.compiledStructure) this.recompile();
  }

  private findProgram(name: string): Program {
    const p = this.proj.programs.find((x) => lower(x.name) === lower(name));
    if (!p) throw new Error(`Program '${name}' does not exist.`);
    return p;
  }

  updateRoutine(program: string, routine: string, rungs: Rung[]): void {
    const p = this.findProgram(program);
    const cloned = structuredClone(rungs);
    const r = p.routines.find((x) => lower(x.name) === lower(routine));
    if (r) r.rungs = cloned;
    else p.routines.push({ name: routine, type: 'RLL', rungs: cloned });
    this.recompile();
    this.emit({ type: 'project' });
  }

  upsertTag(def: TagDef, program?: string): void {
    if (def.system || def.name.includes(':')) throw new Error(`'${def.name}': I/O and system tags are created by the controller.`);
    const list = program === undefined ? this.proj.tags : this.findProgram(program).tags;
    const scope = program === undefined ? undefined : this.findProgram(program).name;
    const stored: TagDef = structuredClone(def);
    const existing = this.tags.getDefExact(def.name, scope);
    const compatible =
      existing !== undefined &&
      !existing.aliasFor &&
      !def.aliasFor &&
      lower(existing.dataType) === lower(def.dataType) &&
      (existing.dims ?? 0) === (def.dims ?? 0);
    if (compatible) this.tags.updateDefMetadata(stored, scope);
    else this.tags.define(stored, scope);
    const idx = list.findIndex((t) => lower(t.name) === lower(def.name));
    if (idx >= 0) {
      list[idx] = stored;
      for (let i = list.length - 1; i > idx; i--) if (lower(list[i]!.name) === lower(def.name)) list.splice(i, 1);
    } else list.push(stored);
    this.emit({ type: 'project' });
  }

  deleteTag(name: string, program?: string): void {
    if (name.includes(':')) throw new Error(`'${name}': I/O and system tags cannot be deleted.`);
    const list = program === undefined ? this.proj.tags : this.findProgram(program).tags;
    const scope = program === undefined ? undefined : this.findProgram(program).name;
    for (let i = list.length - 1; i >= 0; i--) if (lower(list[i]!.name) === lower(name)) list.splice(i, 1);
    this.tags.remove(name, scope);
    this.emit({ type: 'project' });
  }

  resetTagValues(): void {
    this.tags.resetValues(); // bumps the structure: storage (and the force overlay) is re-created
    this.ensureCompiled();
    this.engine.applyDownloadInitializers();
    this.installForceOverlay();
    this.emit({ type: 'project' });
  }

  verify(): VerifyError[] {
    try {
      return verifyProject(this.proj, this.tags);
    } catch (e) {
      return [{ program: '', routine: '', rungIndex: -1, message: `Verification failed: ${errMsg(e)}`, severity: 'error' }];
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  scan(dtMs: number): void {
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
    this.uptimeMs += dt;
    try {
      this.ensureCompiled();
      if (this.forcesOn) this.applyForces('I');
      if (this.isRunning()) this.runLogic(dt);
    } catch (e) {
      this.onScanError(e);
    }
    try {
      if (this.forcesOn) this.applyForces('O');
      this.updateModules();
    } catch (e) {
      this.onScanError(e);
    }
  }

  private runLogic(dt: number): void {
    const eng = this.engine;
    eng.now = this.uptimeMs;
    this.sMinor?.writeB(false);
    if (this.needsPrescan) {
      // Prescan; the engine then sets S:FS during each program's first execution.
      this.needsPrescan = false;
      eng.prescanAll();
      this.firstScan = true;
    } else if (this.firstScan) {
      this.firstScan = false;
    }
    try {
      eng.runScan(dt);
    } finally {
      this.scanCount++;
      const jitter = (((this.scanCount * 2654435761) >>> 0) % 9) * 0.001;
      this.lastScanMs = round3((BASE_SCAN_MS + eng.cost) * this.speedFactor + jitter);
      if (this.lastScanMs > this.maxScanMs) this.maxScanMs = this.lastScanMs;
      this.tags.markChanged();
    }
  }

  private onScanError(e: unknown): void {
    if (e instanceof PlcFault) {
      this.raiseMajor(e.type, e.code, e.message);
      return;
    }
    console.error('[plc] internal error during scan', e);
    this.raiseMajor(4, 16, `Internal simulator error: ${errMsg(e)}`);
  }

  private raiseMajor(type: number, code: number, message: string): void {
    const rec: FaultRecord = { type, code, message, ...this.engine.location(), timeMs: this.uptimeMs };
    // State first, so listeners see a consistent status (and may clear the fault from the event).
    this.major = rec;
    const changed = this.applyMode('FAULTED');
    this.emit({ type: 'fault', fault: { ...rec } });
    if (changed && this.mode === 'FAULTED') this.emit({ type: 'mode', mode: 'FAULTED' });
  }

  private logMinor(f: Omit<FaultRecord, 'timeMs'>): void {
    const same = (m: FaultRecord): boolean =>
      m.type === f.type && m.code === f.code && m.program === f.program && m.routine === f.routine && m.rungIndex === f.rungIndex && m.elementId === f.elementId;
    const idx = this.minors.findIndex(same);
    const rec: FaultRecord = { ...f, timeMs: this.uptimeMs };
    if (idx >= 0) this.minors.splice(idx, 1);
    this.minors.push(rec);
    if (this.minors.length > MAX_MINOR_FAULTS) this.minors.shift();
    if (idx < 0) this.emit({ type: 'fault', fault: { ...rec } });
  }

  getLiveState(program: string, routine: string): RoutineLiveState | undefined {
    try {
      this.ensureCompiled();
      if (!this.isRunning()) this.engine.monitor(program, routine);
    } catch {
      // live state stays as it is
    }
    return this.engine.getLive(program, routine);
  }

  // -------------------------------------------------------------------------
  // Forces
  // -------------------------------------------------------------------------

  private findRef(operand: string, program?: string): OperandRef | undefined {
    if (program !== undefined) return this.tags.tryRef(operand, this.findProgram(program).name);
    let ref = this.tags.tryRef(operand);
    for (const p of this.proj.programs) {
      if (ref) break;
      ref = this.tags.tryRef(operand, p.name);
    }
    return ref;
  }

  private resolveForce(operand: string): OperandRef {
    const ref = this.findRef(operand);
    if (!ref) {
      try {
        this.tags.ref(operand);
      } catch (e) {
        throw new Error(`Cannot force '${operand}': ${errMsg(e)}`);
      }
      throw new Error(`Cannot force '${operand}'.`);
    }
    if (ref.dynamic) {
      throw new Error(`Cannot force '${operand}': indirect addresses cannot be forced. Force a fixed address (e.g. Local:1:I.Data.3).`);
    }
    const kind = ioKindOfPath(ref.path);
    if (kind !== 'I' && kind !== 'O') {
      throw new Error(`Cannot force '${operand}': only module I/O data (Local:x:I / Local:x:O) and alias tags that point to it can be forced.`);
    }
    if (ref.dims !== undefined || !(ref.type === 'BOOL' || isNumericType(ref.type))) {
      throw new Error(`Cannot force '${operand}': only BOOL or numeric I/O points can be forced.`);
    }
    return ref;
  }

  /** Install the force table into tag memory (masks every write while forces are enabled). */
  private installForceOverlay(): void {
    this.tags.setForceOverlay(this.forcesOn ? [...this.forces.values()] : []);
  }

  /** Re-write forced values (defence in depth for writes that bypass the accessors). Never faults. */
  private applyForces(dir: 'I' | 'O'): void {
    for (const f of this.forces.values()) {
      if (f.dir !== dir) continue;
      try {
        if (typeof f.value === 'boolean') f.ref.writeB(f.value);
        else f.ref.writeN(f.value);
      } catch {
        // a force can never raise a fault outside logic execution
      }
    }
    takeOverflow();
  }

  /** Remember the field value of an input before a force hides it (restored when the force goes). */
  private captureField(path: string, f: ForceEntry): void {
    if (f.dir !== 'I' || this.fieldShadow.has(path)) return;
    try {
      this.fieldShadow.set(path, f.ref.type === 'BOOL' ? f.ref.readB() : f.ref.readN());
    } catch {
      // not readable: nothing to restore
    }
  }

  private restoreField(path: string, f: ForceEntry): void {
    const v = this.fieldShadow.get(path);
    this.fieldShadow.delete(path);
    if (f.dir !== 'I' || v === undefined) return;
    try {
      if (typeof v === 'boolean') f.ref.writeB(v);
      else f.ref.writeN(v);
    } catch {
      // ignore
    }
    takeOverflow();
  }

  setForce(operand: string, value: boolean | number): void {
    const ref = this.resolveForce(operand);
    const v = ref.type === 'BOOL' ? (typeof value === 'boolean' ? value : value !== 0) : Number(value);
    const entry: ForceEntry = { ref, value: v, dir: ioKindOfPath(ref.path) as 'I' | 'O' };
    if (this.forcesOn) this.captureField(ref.path, entry);
    this.forces.set(ref.path, entry);
    if (this.forcesOn) this.installForceOverlay();
    this.emit({ type: 'forces' });
  }

  removeForce(operand: string): void {
    let path = operand;
    try {
      path = this.resolveForce(operand).path;
    } catch {
      // fall back to the operand text (may be a canonical path whose tag no longer exists)
    }
    const f = this.forces.get(path);
    if (!f) return;
    this.forces.delete(path);
    if (this.forcesOn) {
      this.installForceOverlay();
      this.restoreField(path, f);
    }
    this.emit({ type: 'forces' });
  }

  removeAllForces(): void {
    if (this.forces.size === 0) return;
    const removed = [...this.forces];
    this.forces.clear();
    if (this.forcesOn) {
      this.installForceOverlay();
      for (const [path, f] of removed) this.restoreField(path, f);
    }
    this.emit({ type: 'forces' });
  }

  enableForces(enabled: boolean): void {
    if (enabled === this.forcesOn) return;
    this.forcesOn = enabled;
    if (enabled) {
      for (const [path, f] of this.forces) this.captureField(path, f);
      this.installForceOverlay();
    } else {
      this.installForceOverlay();
      for (const [path, f] of this.forces) this.restoreField(path, f);
    }
    this.emit({ type: 'forces' });
  }

  /**
   * Installed forces keyed by canonical, alias-resolved path (forcing alias 'Stop_PB' gives key
   * 'Local:1:I.Data.1'). Use `getForce(operand)` to look a force up by the operand text.
   */
  getForces(): Record<string, boolean | number> {
    const out: Record<string, boolean | number> = {};
    for (const [path, f] of this.forces) out[path] = f.value;
    return out;
  }

  /** Forced value of an operand (alias or canonical path), or undefined when it is not forced. */
  getForce(operand: string, program?: string): boolean | number | undefined {
    if (this.forces.size === 0) return undefined;
    try {
      const ref = this.findRef(operand, program);
      return ref ? this.forces.get(ref.path)?.value : undefined;
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Field I/O
  // -------------------------------------------------------------------------

  private fieldRef(operand: string): OperandRef | undefined {
    if (this.tags.structureVersion !== this.compiledStructure) this.ensureCompiled();
    let r = this.fieldRefs.get(operand);
    if (r === undefined) {
      r = this.tags.tryRef(operand) ?? null;
      this.fieldRefs.set(operand, r);
      if (!r && !this.warned.has(operand)) {
        this.warned.add(operand);
        console.warn(`[plc] field I/O operand '${operand}' does not exist in the controller`);
      }
    }
    return r ?? undefined;
  }

  writeInputFromField(operand: string, value: boolean | number): void {
    const ref = this.fieldRef(operand);
    if (!ref) return;
    if (this.forcesOn && this.forces.size > 0 && this.forces.has(ref.path)) {
      this.fieldShadow.set(ref.path, value);
      return;
    }
    try {
      if (typeof value === 'boolean') ref.writeB(value);
      else ref.writeN(value);
      takeOverflow();
    } catch {
      // not a scalar operand — ignore field writes to it
    }
  }

  /** The real field state of an input point: what the module sees before forces are applied. */
  readInputFromField(operand: string): boolean | number {
    const ref = this.fieldRef(operand);
    if (!ref) return false;
    const bool = ref.type === 'BOOL';
    if (this.forcesOn && this.forces.has(ref.path)) {
      const shadow = this.fieldShadow.get(ref.path);
      if (shadow !== undefined) return bool ? shadow === true || shadow === 1 : Number(shadow);
    }
    try {
      return bool ? ref.readB() : ref.readN();
    } catch {
      return bool ? false : 0;
    }
  }

  private fieldOut(ref: OperandRef): boolean | number {
    const bool = ref.type === 'BOOL';
    if (this.forcesOn && this.forces.size > 0) {
      const f = this.forces.get(ref.path);
      if (f) return bool ? f.value === true || f.value === 1 : Number(f.value);
    }
    if (!this.isRunning()) return bool ? false : 0;
    try {
      return bool ? ref.readB() : ref.readN();
    } catch {
      return bool ? false : 0;
    }
  }

  readOutputForField(operand: string): boolean | number {
    const ref = this.fieldRef(operand);
    return ref ? this.fieldOut(ref) : false;
  }

  private updateModules(): void {
    for (const { out, echo } of this.echoRefs) {
      const v = this.fieldOut(out);
      if (typeof v === 'boolean') {
        if (echo.readB() !== v) echo.writeB(v);
      } else if (echo.readN() !== v) {
        echo.writeN(v);
        takeOverflow();
      }
    }
    const running = this.isRunning();
    for (const r of this.runModeRefs) if (r.readB() !== running) r.writeB(running);
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  getStatus(): ControllerStatus {
    const running = this.isRunning();
    const major = this.major;
    return {
      mode: this.mode,
      keySwitch: this.key,
      running,
      ok: this.mode === 'FAULTED' ? 'flashing-red' : 'green',
      runLed: running ? 'green' : 'off',
      forceLed: this.forces.size === 0 ? 'off' : this.forcesOn ? 'amber' : 'flashing-amber',
      ioLed: this.hwHasIo ? 'green' : 'off',
      displayText: this.mode === 'FAULTED' && major ? `Major Fault ${faultId(major.type, major.code)}` : running ? 'RUN' : 'PROG',
      majorFault: major ? { ...major } : undefined,
      minorFaults: this.minors.map((m) => ({ ...m })),
      scanCount: this.scanCount,
      lastScanMs: this.lastScanMs,
      maxScanMs: this.maxScanMs,
      uptimeMs: this.uptimeMs,
      forcesInstalled: this.forces.size > 0,
      forcesEnabled: this.forcesOn,
      firstScan: this.firstScan,
    };
  }
}

/**
 * Create a controller loaded with `project` (a download): key switch REM, mode REM_PROG,
 * tags at their initial values. Call `requestMode('RUN')` (or turn the key) to run.
 */
export function createController(project: Project, options: ControllerOptions = {}): LogixController {
  return new LogixControllerImpl(project, options);
}
